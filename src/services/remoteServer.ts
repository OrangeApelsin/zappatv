import {
  authenticateDevice,
  clearPairingSession,
  createPairingSession,
  hasPairingSession,
  pairDevice,
  type PairingSessionView,
} from "./deviceAccess";
import { applyRemoteCommand, remoteSnapshot, type CommandRequest } from "./remoteProtocol";
import { isWasmSupported } from "./wasm";

export { isWasmSupported };

const PORT = 8976;
const BODY_MAX = 64 * 1024;
const STOP_TIMEOUT_MS = 1500;

export interface RemoteAccessState {
  status: "idle" | "starting" | "listening" | "unavailable";
  address: string;
  port: number;
  remotePath: string;
  pairing: PairingSessionView | null;
  pairingError: boolean;
  connectedDevice: string;
  error: string;
}

export interface RemoteRequest {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: string;
}

export interface RemoteResponse {
  status: number;
  contentType: string;
  body: string;
}

interface WorkerRequest extends RemoteRequest {
  type: "request";
  id: number;
}

const listeners = new Set<(state: RemoteAccessState) => void>();
let state: RemoteAccessState = {
  status: "idle",
  address: "",
  port: 0,
  remotePath: "",
  pairing: null,
  pairingError: false,
  connectedDevice: "",
  error: "",
};
let worker: Worker | null = null;
let developmentEvents: EventSource | null = null;
let developmentStart: Promise<void> | null = null;
let developmentGeneration = 0;
let stopPromise: Promise<void> | null = null;
let stopResolve: (() => void) | null = null;
let stopTimer: number | undefined;
let pairingTimer: number | undefined;
let restartRequested = false;

function publish(change: Partial<RemoteAccessState>): void {
  state = { ...state, ...change };
  for (const listener of listeners) listener(state);
}

function json(status: number, value: unknown): RemoteResponse {
  return {
    status,
    contentType: "application/json; charset=utf-8",
    body: JSON.stringify(value),
  };
}

function parseJson(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

function bearer(headers: Record<string, string>): { id: string; credential: string } | null {
  const value = headers.authorization;
  if (!value?.startsWith("Bearer ")) return null;
  const split = value.slice(7).indexOf(":");
  if (split <= 0) return null;
  return {
    id: value.slice(7, split + 7),
    credential: value.slice(split + 8),
  };
}

async function authorised(request: RemoteRequest): Promise<boolean> {
  const token = bearer(request.headers);
  return !!token && authenticateDevice(token.id, token.credential);
}

function validJsonPost(request: RemoteRequest): boolean {
  return (
    request.method === "POST" &&
    request.headers["content-type"]?.toLowerCase().startsWith("application/json") === true
  );
}

export function isPrivateIPv4(value: string): boolean {
  if (!value || typeof value !== "string") return false;
  const clean = value.trim();
  const parts = clean.split(".");
  if (parts.length !== 4) return false;
  const bytes = parts.map(Number);
  if (bytes.some((byte, index) => !/^\d+$/.test(parts[index]) || byte < 0 || byte > 255)) {
    return false;
  }
  return (
    bytes[0] === 10 ||
    (bytes[0] === 172 && bytes[1] >= 16 && bytes[1] <= 31) ||
    (bytes[0] === 192 && bytes[1] === 168) ||
    (bytes[0] === 100 && bytes[1] >= 64 && bytes[1] <= 127) || // RFC 6598 CGNAT
    (bytes[0] === 169 && bytes[1] === 254) // RFC 3927 Link-local
  );
}

export function getTvNetworkIp(): string {
  if (typeof window === "undefined") return "";

  // 1. Check window.webapis.network (Wi-Fi or Ethernet on Samsung Tizen)
  try {
    const net = window.webapis?.network as Record<string, unknown> | undefined;
    if (net) {
      const candidates: string[] = [];

      // Check both Samsung official capitalized and lowercase variations
      const checkMethods = [
        "getIP",
        "getIp",
        "getWiFiIP",
        "getWiFiIp",
        "getEthernetIP",
        "getEthernetIp",
      ];
      for (const m of checkMethods) {
        if (typeof net[m] === "function") {
          try {
            const ip = String((net[m] as () => unknown)() ?? "").trim();
            if (ip) candidates.push(ip);
          } catch {}
        }
      }

      for (const candidate of candidates) {
        if (candidate && isPrivateIPv4(candidate)) {
          return candidate;
        }
      }
    }
  } catch {
    /* webapis call failed */
  }

  // 2. Check Tizen systeminfo if available
  try {
    const tizenObj = (window as unknown as Record<string, unknown>).tizen as
      | Record<string, unknown>
      | undefined;
    const sys = tizenObj?.systeminfo as Record<string, unknown> | undefined;
    if (sys && typeof sys.getPropertyValueSync === "function") {
      for (const prop of ["ETHERNET_NETWORK", "WIFI_NETWORK", "NETWORK"]) {
        try {
          const val = sys.getPropertyValueSync(prop) as Record<string, unknown> | undefined;
          const ip = String(val?.ipAddress ?? val?.ip ?? "").trim();
          if (ip && isPrivateIPv4(ip)) return ip;
        } catch {}
      }
    }
  } catch {
    /* systeminfo call failed */
  }

  // 3. Fallback to location hostname if running in local browser/dev network
  try {
    const host = window.location?.hostname?.trim();
    if (host && isPrivateIPv4(host)) return host;
  } catch {
    /* ignore */
  }

  return "";
}

export function resolveTvNetworkIpAsync(): Promise<string> {
  const syncIp = getTvNetworkIp();
  if (syncIp && isPrivateIPv4(syncIp)) {
    return Promise.resolve(syncIp);
  }

  return new Promise((resolve) => {
    let resolved = false;
    let timer: number | undefined;

    const finish = (ip: string) => {
      if (!resolved && ip && isPrivateIPv4(ip)) {
        resolved = true;
        if (timer !== undefined) window.clearTimeout(timer);
        resolve(ip);
      }
    };

    // 1. Try async tizen.systeminfo
    try {
      const tizenObj = (window as unknown as Record<string, unknown>).tizen as
        | Record<string, unknown>
        | undefined;
      const sys = tizenObj?.systeminfo as Record<string, unknown> | undefined;
      if (sys && typeof sys.getPropertyValue === "function") {
        for (const prop of ["WIFI_NETWORK", "ETHERNET_NETWORK", "NETWORK"]) {
          try {
            sys.getPropertyValue(
              prop,
              (val: Record<string, unknown>) => {
                const ip = String(val?.ipAddress ?? val?.ip ?? "").trim();
                finish(ip);
              },
              () => {},
            );
          } catch {}
        }
      }
    } catch {
      /* ignore */
    }

    // 2. Try WebRTC RTCPeerConnection local host candidate gathering
    try {
      const PeerConnection =
        typeof window !== "undefined"
          ? window.RTCPeerConnection ||
            (window as unknown as Record<string, typeof RTCPeerConnection>).webkitRTCPeerConnection
          : undefined;
      if (PeerConnection) {
        const pc = new PeerConnection({ iceServers: [] });
        pc.createDataChannel("ip-check");
        pc.createOffer()
          .then((offer) => pc.setLocalDescription(offer))
          .catch(() => {});
        pc.onicecandidate = (event) => {
          if (!event?.candidate?.candidate) return;
          const match = /([0-9]{1,3}(?:\.[0-9]{1,3}){3})/.exec(event.candidate.candidate);
          if (match && isPrivateIPv4(match[1])) {
            try {
              pc.close();
            } catch {}
            finish(match[1]);
          }
        };
      }
    } catch {
      /* ignore */
    }

    // 3. Fallback timeout
    timer = window.setTimeout(() => {
      if (!resolved) {
        resolved = true;
        resolve(getTvNetworkIp());
      }
    }, 1500);
  });
}

export function remoteAccessState(): RemoteAccessState {
  return state;
}

export function subscribeRemoteAccess(
  listener: (state: RemoteAccessState) => void,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function developmentRemoteAccess(search = window.location.search): boolean {
  return import.meta.env.DEV && new URLSearchParams(search).has("tv-onboarding");
}

function clearPairing(): void {
  if (pairingTimer !== undefined) window.clearTimeout(pairingTimer);
  pairingTimer = undefined;
  clearPairingSession();
}

function publishIdle(): void {
  publish({
    status: "idle",
    address: "",
    port: 0,
    remotePath: "",
    pairing: null,
    pairingError: false,
    connectedDevice: "",
    error: "",
  });
}

export function cancelPairing(failed = false): void {
  clearPairing();
  publish({ pairing: null, pairingError: failed });
}

export function openPairing(): PairingSessionView | null {
  if (state.status !== "listening") return null;
  clearPairing();
  const pairing = createPairingSession();
  pairingTimer = window.setTimeout(() => cancelPairing(true), pairing.expiresAt - Date.now());
  publish({ pairing, pairingError: false, connectedDevice: "" });
  return pairing;
}

export async function routeRemoteRequest(request: RemoteRequest): Promise<RemoteResponse> {
  if (new TextEncoder().encode(request.body).length > BODY_MAX) {
    return json(413, { error: "payloadTooLarge" });
  }
  if (request.path === "/api/v1/status" && request.method === "GET") {
    const snapshot = remoteSnapshot();
    return json(200, {
      name: "Zappa TV",
      status: state.status,
      locale: snapshot.locale,
      direction: snapshot.direction,
      labels: snapshot.labels,
    });
  }
  if (request.path === "/api/v1/pair") {
    if (!validJsonPost(request)) return json(415, { error: "jsonRequired" });
    const input = parseJson(request.body);
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      return json(400, { error: "invalidRequest" });
    }
    const values = input as Record<string, unknown>;
    const keys = Object.keys(values).sort().join(",");
    const hasSecret = typeof values.secret === "string";
    const hasCode = typeof values.code === "string";
    if (
      typeof values.name !== "string" ||
      hasSecret === hasCode ||
      (keys !== "name,secret" && keys !== "code,name")
    ) {
      return json(400, { error: "invalidRequest" });
    }
    const paired = await pairDevice({
      name: values.name,
      ...(typeof values.secret === "string" ? { secret: values.secret } : {}),
      ...(typeof values.code === "string" ? { code: values.code } : {}),
    });
    if (!paired.ok) {
      if (!hasPairingSession()) cancelPairing(true);
      return json(paired.reason === "expired" ? 410 : 401, { error: paired.reason });
    }
    clearPairing();
    publish({
      pairing: null,
      pairingError: false,
      connectedDevice: values.name.trim() || "Device",
    });
    return json(200, paired);
  }
  if (request.path === "/api/v1/state") {
    if (request.method !== "GET") return json(405, { error: "methodNotAllowed" });
    if (!(await authorised(request))) return json(401, { error: "unauthorised" });
    return json(200, remoteSnapshot());
  }
  if (request.path === "/api/v1/command") {
    if (!validJsonPost(request)) return json(415, { error: "jsonRequired" });
    if (!(await authorised(request))) return json(401, { error: "unauthorised" });
    const input = parseJson(request.body) as CommandRequest | null;
    if (
      !input ||
      typeof input !== "object" ||
      Array.isArray(input) ||
      Object.keys(input).sort().join(",") !== "command,id,revision"
    ) {
      return json(400, { error: "invalidRequest" });
    }
    const result = await applyRemoteCommand(input);
    return json(result.reason === "conflict" ? 409 : result.ok ? 200 : 400, result);
  }
  return json(404, { error: "notFound" });
}

function routeSafely(request: RemoteRequest): Promise<RemoteResponse> {
  return routeRemoteRequest(request).catch(() => {
    if (request.path === "/api/v1/pair") cancelPairing(true);
    return json(500, { error: "internal" });
  });
}

function failWorker(reason: string): void {
  clearPairing();
  if (stopTimer !== undefined) window.clearTimeout(stopTimer);
  stopTimer = undefined;
  worker?.terminate();
  worker = null;
  stopResolve?.();
  stopResolve = null;
  stopPromise = null;
  publish({
    status: "unavailable",
    pairing: null,
    pairingError: false,
    connectedDevice: "",
    error: reason,
  });
}

function finishStop(): void {
  clearPairing();
  if (stopTimer !== undefined) window.clearTimeout(stopTimer);
  stopTimer = undefined;
  worker?.terminate();
  worker = null;
  const resolve = stopResolve;
  stopResolve = null;
  stopPromise = null;
  publishIdle();
  resolve?.();
}

export function startDevelopmentRemoteAccess(): Promise<void> {
  if (developmentEvents) return Promise.resolve();
  if (developmentStart) return developmentStart;
  const generation = developmentGeneration;
  publish({ status: "starting", error: "" });
  developmentStart = (async () => {
    try {
      const response = await fetch("/__openiptv/remote/info", { cache: "no-store" });
      if (!response.ok)
        throw new Error(`bridge information failed with HTTP ${response.status}`);
      const info = (await response.json()) as {
        address: string;
        port: number;
        remotePath: string;
      };
      if (generation !== developmentGeneration) return;
      if (!isPrivateIPv4(info.address) || !Number.isInteger(info.port) || !info.remotePath) {
        throw new Error("the development bridge has no private address");
      }
      const events = new EventSource("/__openiptv/remote/events");
      developmentEvents = events;
      events.onopen = () => {
        if (developmentEvents === events) {
          publish({ status: "listening", error: "" });
        }
      };
      events.onmessage = ({ data }) => {
        let message: Record<string, unknown>;
        try {
          message = JSON.parse(data) as Record<string, unknown>;
        } catch {
          return;
        }
        if (message.type === "replaced") {
          events.close();
          if (developmentEvents === events) {
            developmentEvents = null;
            publish({
              status: "unavailable",
              error: "another simulated TV tab took over",
            });
          }
          return;
        }
        const request = message as unknown as WorkerRequest;
        void routeSafely(request).then((result) =>
          fetch(`/__openiptv/remote/responses/${request.id}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(result),
          }),
        );
      };
      events.onerror = () => {
        if (developmentEvents === events) {
          publish({ status: "unavailable", error: "bridge disconnected" });
        }
      };
      publish({
        status: "listening",
        address: info.address,
        port: info.port,
        remotePath: info.remotePath,
        error: "",
      });
    } catch (error) {
      if (generation !== developmentGeneration) return;
      developmentEvents?.close();
      developmentEvents = null;
      publish({
        status: "unavailable",
        address: "",
        port: 0,
        remotePath: "",
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      if (generation === developmentGeneration) developmentStart = null;
    }
  })();
  return developmentStart;
}

function launchWorker(address: string): void {
  if (worker) return;
  publish({ status: "starting", address, port: PORT, remotePath: "", error: "" });
  try {
    worker = new Worker("./wasm/management-socket.worker.js");
  } catch (error) {
    publish({
      status: "unavailable",
      error: error instanceof Error ? error.message : String(error),
    });
    return;
  }
  worker.onerror = ({ message }) => failWorker(message);
  worker.onmessage = ({ data }) => {
    const message = data as Record<string, unknown>;
    if (message.type === "listening") {
      publish({
        status: "listening",
        address: String(message.address),
        port: Number(message.port),
      });
    } else if (message.type === "error") {
      failWorker(String(message.reason));
    } else if (message.type === "stopped") {
      finishStop();
    } else if (message.type === "request") {
      const request = message as unknown as WorkerRequest;
      void routeSafely(request).then((response) => {
        worker?.postMessage({ type: "response", id: request.id, ...response });
      });
    }
  };
  worker.postMessage({ type: "start", address, port: PORT });
}

export function startRemoteAccess(): void {
  if (stopPromise) {
    if (!restartRequested) {
      restartRequested = true;
      const stopping = stopPromise;
      void stopping.then(() => {
        if (!restartRequested) return;
        restartRequested = false;
        startRemoteAccess();
      });
    }
    return;
  }
  if (worker) return;
  if (!isWasmSupported()) {
    console.warn("[remoteServer] WebAssembly not supported; local HTTP server unavailable.");
    publish({
      status: "unavailable",
      address: "",
      port: 0,
      remotePath: "",
      error: "WebAssembly is not supported on this TV model",
    });
    return;
  }
  const syncAddress = getTvNetworkIp();
  if (isPrivateIPv4(syncAddress)) {
    launchWorker(syncAddress);
    return;
  }

  publish({ status: "starting", address: "", port: PORT, remotePath: "", error: "" });
  void resolveTvNetworkIpAsync().then((resolvedAddress) => {
    if (stopPromise || restartRequested || worker) return;
    if (isPrivateIPv4(resolvedAddress)) {
      launchWorker(resolvedAddress);
    } else {
      publish({ status: "unavailable", address: "", port: 0, error: "no private TV address" });
    }
  });
}

export function stopRemoteAccess(): Promise<void> {
  developmentGeneration += 1;
  developmentStart = null;
  restartRequested = false;
  clearPairing();
  if (developmentEvents) {
    developmentEvents.close();
    developmentEvents = null;
    publishIdle();
    return Promise.resolve();
  }
  if (!worker) {
    publishIdle();
    return Promise.resolve();
  }
  if (stopPromise) return stopPromise;
  stopPromise = new Promise((resolve) => {
    stopResolve = resolve;
    worker?.postMessage({ type: "stop" });
    stopTimer = window.setTimeout(finishStop, STOP_TIMEOUT_MS);
  });
  return stopPromise;
}
