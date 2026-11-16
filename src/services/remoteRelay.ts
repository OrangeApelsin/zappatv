import { read, readJSON, write } from "./store";
import type { RemoteRequest, RemoteResponse } from "./remoteServer";

export const RELAY_URL_KEY = "zappa.remote.relayUrl";
const OWNER_KEY = "zappa.remote.relayOwners";
const MAX_FRAME = 1024 * 1024;
const ID = /^[A-Za-z0-9_-]{1,128}$/;
export type RelayError = "remote.relayInvalid" | "remote.relayVersion" |
  "remote.relayIdentity" | "remote.relayStorage" | "remote.relayOffline";
type RelayStatus = "starting" | "listening" | "unavailable";
interface Owner { tvId: string; ownershipSecret: string }
type ObjectValue = Record<string, unknown>;
const object = (value: unknown): value is ObjectValue =>
  !!value && typeof value === "object" && !Array.isArray(value);
const bytes = (value: string) => new TextEncoder().encode(value).length;

class RelayFailure extends Error {
  constructor(public code: RelayError, public terminal = false) { super(code); }
}

export function normalizeRelayUrl(value: string): string {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
      throw new Error("invalid");
    }
    url.pathname = `${url.pathname.replace(/\/+$/, "")}/`;
    return url.href;
  } catch { throw new RelayFailure("remote.relayInvalid", true); }
}

export function configuredRelayUrl(): string { return read(RELAY_URL_KEY); }

export function saveRelayUrl(value: string): void {
  const url = value.trim() ? normalizeRelayUrl(value) : "";
  write(RELAY_URL_KEY, url);
  if (configuredRelayUrl() !== url) throw new RelayFailure("remote.relayStorage", true);
}

/** Outbound-only native WebSocket / XHR client. Never touches WASM or IndexedDB. */
export class RemoteRelayClient {
  private readonly base: string;
  private running = false;
  private epoch = 0;
  private socket: WebSocket | null = null;
  private requests = new Set<XMLHttpRequest>();
  private timers = new Set<number>();
  private heartbeat: number | undefined;
  private generation = "";
  private credential = "";
  private owner: Owner | null = null;
  private clockOffset = 0;
  private clockUncertainty = 0;
  private ready = false;
  private polling = false;
  private failures = 0;
  private lastContact = 0;
  private pairingExpires: number | null = null;
  private inFlight = new Set<string>();
  private seen = new Map<string, number>();

  constructor(url: string, private readonly route: (request: RemoteRequest) => Promise<RemoteResponse>,
    private readonly change: (status: RelayStatus, phoneUrl: string, error?: RelayError) => void) {
    this.base = normalizeRelayUrl(url);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    void this.connect();
  }

  stop(): void {
    this.running = false;
    this.epoch += 1;
    this.cleanup();
    this.pairingExpires = null;
    this.credential = "";
  }

  pairing(expiresAt: number | null): void {
    this.pairingExpires = expiresAt;
    if (!this.ready) return;
    const epoch = this.epoch;
    void this.send({ type: "pairing", generation: this.generation,
      expiresAt: expiresAt === null ? null : expiresAt + this.clockOffset }, epoch)
      .catch((error) => this.failed(error, epoch));
  }

  private current(epoch: number): boolean { return this.running && epoch === this.epoch; }

  private later(callback: () => void, delay: number): void {
    const timer = window.setTimeout(() => { this.timers.delete(timer); callback(); }, delay);
    this.timers.add(timer);
  }

  private cleanup(): void {
    this.ready = false;
    for (const timer of this.timers) window.clearTimeout(timer);
    this.timers.clear();
    if (this.heartbeat !== undefined) window.clearInterval(this.heartbeat);
    this.heartbeat = undefined;
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.onopen = socket.onmessage = socket.onclose = socket.onerror = null;
      socket.close();
    }
    for (const request of this.requests) request.abort();
    this.requests.clear();
    this.inFlight.clear();
    this.seen.clear();
  }

  private http(path: string, method = "GET", body?: unknown, credential?: string,
    timeout = 10000): Promise<unknown> {
    return new Promise<unknown>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      this.requests.add(xhr);
      const done = () => { this.requests.delete(xhr); };
      xhr.open(method, new URL(`api/relay/v1/${path}`, this.base).href);
      xhr.timeout = timeout;
      xhr.withCredentials = false;
      xhr.setRequestHeader("Accept", "application/json");
      if (credential) xhr.setRequestHeader("Authorization", `Bearer ${credential}`);
      if (body !== undefined) xhr.setRequestHeader("Content-Type", "application/json");
      xhr.onprogress = () => { if (xhr.responseText.length > MAX_FRAME * 2) xhr.abort(); };
      xhr.onload = () => {
        done();
        if (xhr.status < 200 || xhr.status >= 300) {
          if (path === "capabilities" && [400, 404, 405, 426].includes(xhr.status)) {
            reject(new RelayFailure("remote.relayVersion", true));
            return;
          }
          // An expired connection credential is renewable using the durable
          // owner secret. Only rejection of that owner proof is terminal.
          const ownershipRejected = path.endsWith("/connections") && (xhr.status === 401 || xhr.status === 403);
          reject(new RelayFailure(ownershipRejected ? "remote.relayIdentity" : "remote.relayOffline", ownershipRejected));
          return;
        }
        try {
          if (bytes(xhr.responseText) > MAX_FRAME * 2) throw new Error("large");
          resolve(xhr.responseText ? JSON.parse(xhr.responseText) : {});
        } catch { reject(new RelayFailure("remote.relayVersion", true)); }
      };
      xhr.onerror = xhr.ontimeout = xhr.onabort = () => {
        done(); reject(new RelayFailure("remote.relayOffline"));
      };
      try { xhr.send(body === undefined ? undefined : JSON.stringify(body)); }
      catch { done(); reject(new RelayFailure("remote.relayOffline")); }
    });
  }

  private async connect(): Promise<void> {
    const epoch = ++this.epoch;
    this.cleanup();
    this.change("starting", "");
    try {
      const capabilities = await this.http("capabilities");
      if (!this.current(epoch)) return;
      if (!object(capabilities) || capabilities.protocolVersion !== 1 ||
        !Array.isArray(capabilities.transports) || !capabilities.transports.includes("polling")) {
        throw new RelayFailure("remote.relayVersion", true);
      }
      const owners = readJSON<Record<string, Owner>>(OWNER_KEY, {});
      const saved = object(owners) ? owners[this.base] : null;
      if (saved && ID.test(saved.tvId) && typeof saved.ownershipSecret === "string" && saved.ownershipSecret.length >= 16) {
        this.owner = saved;
      } else {
        const created = await this.http("tvs", "POST", { protocolVersion: 1, name: "Zappa TV" });
        if (!this.current(epoch)) return;
        if (!object(created) || typeof created.tvId !== "string" || !ID.test(created.tvId) ||
          typeof created.ownershipSecret !== "string" || created.ownershipSecret.length < 16) {
          throw new RelayFailure("remote.relayVersion", true);
        }
        this.owner = { tvId: created.tvId, ownershipSecret: created.ownershipSecret };
        const next = { ...(object(owners) ? owners : {}), [this.base]: this.owner };
        // Prevent unbounded accumulation when a relay URL is repeatedly changed.
        if (Object.keys(next).length > 8) throw new RelayFailure("remote.relayStorage", true);
        write(OWNER_KEY, JSON.stringify(next));
        if (readJSON<Record<string, Owner>>(OWNER_KEY, {})[this.base]?.ownershipSecret !== this.owner.ownershipSecret) {
          throw new RelayFailure("remote.relayStorage", true);
        }
      }
      const connectionStarted = Date.now();
      const connection = await this.http(`tvs/${this.owner.tvId}/connections`, "POST",
        { protocolVersion: 1 }, this.owner.ownershipSecret);
      if (!this.current(epoch)) return;
      if (!object(connection) || typeof connection.generation !== "string" || !ID.test(connection.generation) ||
        typeof connection.credential !== "string" || connection.credential.length < 16 ||
        typeof connection.serverTime !== "number" || !Number.isFinite(connection.serverTime)) {
        throw new RelayFailure("remote.relayVersion", true);
      }
      this.generation = connection.generation;
      this.credential = connection.credential;
      this.clockOffset = connection.serverTime - Date.now();
      // serverTime is sampled before the response reaches us. Bound that
      // uncertainty by the connection round trip instead of treating it as zero.
      this.clockUncertainty = Math.max(0, Date.now() - connectionStarted);
      if (!this.polling && capabilities.transports.includes("websocket") && typeof WebSocket !== "undefined") {
        await this.openSocket(epoch);
      } else {
        this.polling = true;
        // Only publish readiness after the server has accepted the first poll.
        await this.poll(epoch, true);
      }
    } catch (error) { this.failed(error, epoch); }
  }

  private async openSocket(epoch: number): Promise<void> {
    const ticket = await this.http(`tvs/${this.owner?.tvId}/socket-ticket`, "POST", {}, this.credential);
    if (!this.current(epoch)) return;
    if (!object(ticket) || typeof ticket.ticket !== "string" || !ticket.ticket) throw new RelayFailure("remote.relayVersion", true);
    return new Promise<void>((resolve, reject) => {
      const url = new URL(`api/relay/v1/tvs/${this.owner?.tvId}/ws`, this.base);
      url.protocol = "wss:";
      const socket = new WebSocket(url.href);
      this.socket = socket;
      let authenticated = false;
      this.later(() => {
        if (this.current(epoch) && !authenticated) reject(new RelayFailure("remote.relayOffline"));
      }, 5000);
      socket.onopen = () => {
        if (this.current(epoch)) socket.send(JSON.stringify({ type: "authenticate", protocolVersion: 1, ticket: ticket.ticket }));
      };
      socket.onmessage = ({ data }) => {
        if (!this.current(epoch)) return;
        try {
          if (typeof data !== "string" || bytes(data) > MAX_FRAME) throw new Error("frame");
          const value: unknown = JSON.parse(data);
          if (!object(value) || value.generation !== this.generation) throw new Error("generation");
          this.lastContact = Date.now();
          if (!authenticated) {
            if (value.type !== "ready") throw new Error("handshake");
            authenticated = true;
            this.connected(epoch);
            resolve();
          } else { this.receive(value, epoch); }
        } catch { this.failed(new RelayFailure("remote.relayVersion", true), epoch); }
      };
      socket.onerror = socket.onclose = () => {
        if (!this.current(epoch)) return;
        // New HTTP connection generation fences the failed socket before polling.
        this.polling = true;
        if (authenticated) this.failed(new RelayFailure("remote.relayOffline"), epoch);
        else reject(new RelayFailure("remote.relayOffline"));
      };
    }).catch((error) => { this.polling = true; throw error; });
  }

  private connected(epoch: number): void {
    if (!this.current(epoch) || this.ready) return;
    this.ready = true;
    this.failures = 0;
    this.lastContact = Date.now();
    this.change("listening", new URL(`t/${this.owner?.tvId}/`, this.base).href);
    if (!this.current(epoch)) return;
    this.pairing(this.pairingExpires);
    this.heartbeat = window.setInterval(() => {
      if (!this.current(epoch)) return;
      if (Date.now() - this.lastContact > 45000) { this.failed(new RelayFailure("remote.relayOffline"), epoch); return; }
      void this.send({ type: "heartbeat", generation: this.generation }, epoch).catch((error) => this.failed(error, epoch));
    }, 15000);
  }

  private async poll(epoch: number, initial = false): Promise<void> {
    const result = await this.http(`tvs/${this.owner?.tvId}/poll`, "GET", undefined, this.credential, 25000);
    if (!this.current(epoch)) return;
    if (!object(result) || !Array.isArray(result.messages) || result.messages.length > 8) throw new RelayFailure("remote.relayVersion", true);
    this.lastContact = Date.now();
    if (initial) this.connected(epoch);
    for (const message of result.messages) this.receive(message, epoch);
    this.later(() => { if (this.current(epoch)) void this.poll(epoch).catch((error) => this.failed(error, epoch)); }, 50);
  }

  private async send(message: ObjectValue, epoch: number): Promise<void> {
    if (!this.current(epoch)) return;
    const data = JSON.stringify(message);
    if (bytes(data) > MAX_FRAME * 2) throw new RelayFailure("remote.relayVersion", true);
    if (!this.polling && this.socket?.readyState === 1) {
      if (this.socket.bufferedAmount > MAX_FRAME * 2) throw new RelayFailure("remote.relayOffline");
      this.socket.send(data);
    } else {
      await this.http(`tvs/${this.owner?.tvId}/messages`, "POST", message, this.credential);
    }
  }

  private receive(value: unknown, epoch: number): void {
    if (!this.current(epoch) || !object(value) || value.generation !== this.generation) return;
    if (value.type === "heartbeat") return;
    if (value.type !== "request" || value.tvId !== this.owner?.tvId ||
      typeof value.id !== "string" || !ID.test(value.id) ||
      typeof value.deadline !== "number" || !Number.isFinite(value.deadline)) return;
    const now = Date.now() + this.clockOffset;
    // Use the earliest possible expiry; calibration must never extend execution.
    const valid = () => this.current(epoch) && Date.now() + this.clockOffset + this.clockUncertainty <= (value.deadline as number);
    if (!valid() || value.deadline > now + 2000 + this.clockUncertainty || this.inFlight.size >= 8 || this.inFlight.has(value.id)) return;
    if ((value.method !== "GET" && value.method !== "POST") || typeof value.path !== "string" ||
      !["/api/v1/status", "/api/v1/pair", "/api/v1/state", "/api/v1/command"].includes(value.path) ||
      typeof value.body !== "string" || bytes(value.body) > 65536 || !object(value.headers)) return;
    const headers: Record<string, string> = {};
    for (const name of ["authorization", "content-type"]) {
      const field = value.headers[name];
      if (field !== undefined && (typeof field !== "string" || field.length > 2048)) return;
      if (typeof field === "string") headers[name] = field;
    }
    try {
      if (value.path === "/api/v1/command") {
        const command = JSON.parse(value.body)?.command;
        if ((command?.type === "remote.key" || command?.type === "remote.action") && value.deadline > now + 500 + this.clockUncertainty) return;
      }
    } catch { return; }
    for (const [id, expiry] of this.seen) if (expiry < now) this.seen.delete(id);
    if (this.seen.has(value.id) || this.seen.size >= 512) return;
    this.seen.set(value.id, value.deadline);
    this.inFlight.add(value.id);
    const request: RemoteRequest = { method: value.method, path: value.path, headers, body: value.body, canDispatch: valid };
    void this.route(request).catch(() => ({ status: 500, contentType: "application/json", body: '{"error":"internal"}' }))
      .then(async (result) => {
        if (!this.current(epoch)) return;
        if (bytes(result.body) > MAX_FRAME) result = { status: 413, contentType: "application/json", body: '{"error":"payloadTooLarge"}' };
        await this.send({ type: "response", id: value.id, generation: this.generation, ...result }, epoch);
      }).catch((error) => this.failed(error, epoch)).finally(() => {
        if (this.current(epoch)) this.inFlight.delete(value.id as string);
      });
  }

  private failed(error: unknown, epoch: number): void {
    if (!this.current(epoch)) return;
    const failure = error instanceof RelayFailure ? error : new RelayFailure("remote.relayOffline");
    this.epoch += 1;
    this.cleanup();
    this.pairingExpires = null;
    this.change("unavailable", "", failure.code);
    if (failure.terminal) { this.running = false; return; }
    const nextEpoch = this.epoch;
    const delay = [4000, 8000, 15000][Math.min(this.failures++, 2)] + Math.floor(Math.random() * 500);
    this.later(() => { if (this.current(nextEpoch)) void this.connect(); }, delay);
  }
}
