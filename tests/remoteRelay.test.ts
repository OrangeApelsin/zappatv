import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { configuredRelayUrl, normalizeRelayUrl, RemoteRelayClient, saveRelayUrl } from "../src/services/remoteRelay";

const secret = "ownership-secret-long-enough";
const credential = "connection-secret-long-enough";
let sequence = 0;
let wsEnabled = true;
let rejectOwnership = false;
let holdCapabilities = false;
class Xhr {
  static all: Xhr[] = [];
  method = ""; url = ""; body: unknown; headers: Record<string, string> = {};
  status = 200; responseText = ""; timeout = 0; withCredentials = false; aborted = false;
  onload = () => {}; onerror = () => {}; onabort = () => {}; ontimeout = () => {};
  constructor() { Xhr.all.push(this); }
  open(method: string, url: string) { this.method = method; this.url = url; }
  setRequestHeader(key: string, value: string) { this.headers[key] = value; }
  send(body?: string) {
    this.body = body ? JSON.parse(body) : undefined;
    if (holdCapabilities && this.url.endsWith("capabilities")) return;
    let result: unknown = {};
    if (this.url.endsWith("capabilities")) result = { protocolVersion: 1, transports: wsEnabled ? ["websocket", "polling"] : ["polling"] };
    else if (this.url.endsWith("/tvs")) result = { tvId: "tv-one", ownershipSecret: secret };
    else if (this.url.endsWith("/connections")) {
      if (rejectOwnership) this.status = 401;
      result = { generation: `g${++sequence}`, credential, serverTime: Date.now() };
    } else if (this.url.endsWith("/socket-ticket")) result = { ticket: "one-time-ticket" };
    else if (this.url.endsWith("/poll")) result = { messages: [] };
    this.responseText = JSON.stringify(result);
    queueMicrotask(() => { if (!this.aborted) this.onload(); });
  }
  abort() { this.aborted = true; this.onabort(); }
}
class Socket {
  static all: Socket[] = [];
  readyState = 0; bufferedAmount = 0; sent: Record<string, unknown>[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public url: string) { Socket.all.push(this); }
  open() { this.readyState = 1; this.onopen?.(); }
  emit(value: unknown) { this.onmessage?.({ data: JSON.stringify(value) }); }
  send(value: string) { this.sent.push(JSON.parse(value)); }
  close() { this.readyState = 3; this.onclose?.(); }
}
const clients: RemoteRelayClient[] = [];
const flush = async () => { for (let i = 0; i < 25; i++) await Promise.resolve(); };
function client(url = "https://relay.test/prefix/") {
  const route = vi.fn(async () => ({ status: 200, contentType: "application/json", body: "{}" }));
  const change = vi.fn();
  const value = new RemoteRelayClient(url, route, change);
  clients.push(value);
  return { value, route, change };
}
function envelope(extra: Record<string, unknown> = {}) {
  return { type: "request", id: "r1", tvId: "tv-one", generation: `g${sequence}`, deadline: Date.now() + 400,
    method: "GET", path: "/api/v1/status", headers: {}, body: "", ...extra };
}
async function listening() {
  const result = client(); result.value.start(); await flush();
  const socket = Socket.all[0]; socket.open(); socket.emit({ type: "ready", generation: `g${sequence}` });
  await flush(); return { ...result, socket };
}
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(1800000000000); localStorage.clear();
  vi.stubGlobal("XMLHttpRequest", Xhr); vi.stubGlobal("WebSocket", Socket);
  sequence = 0; Xhr.all = []; Socket.all = []; wsEnabled = true; rejectOwnership = false; holdCapabilities = false;
});
afterEach(() => { for (const value of clients.splice(0)) value.stop(); vi.useRealTimers(); vi.unstubAllGlobals(); });

test("canonical HTTPS prefix rejects credentials, queries and insecure configurations", () => {
  expect(normalizeRelayUrl(" https://RELAY.test/prefix ")).toBe("https://relay.test/prefix/");
  for (const url of ["http://relay.test", "https://u:p@relay.test", "https://relay.test/?token=x", "https://relay.test/#pair=x", "garbage"]) {
    expect(() => normalizeRelayUrl(url)).toThrow("remote.relayInvalid");
  }
  saveRelayUrl("https://relay.test"); expect(configuredRelayUrl()).toBe("https://relay.test/");
  saveRelayUrl(""); expect(configuredRelayUrl()).toBe("");
});

test("socket authenticates in first frame and publishes only acknowledged readiness without WASM", async () => {
  vi.stubGlobal("WebAssembly", undefined);
  const { value, change } = client(); value.start(); value.start(); await flush();
  expect(change).toHaveBeenCalledTimes(1);
  expect(Socket.all).toHaveLength(1);
  const socket = Socket.all[0];
  expect(socket.url).toBe("wss://relay.test/prefix/api/relay/v1/tvs/tv-one/ws");
  socket.open();
  expect(socket.sent).toEqual([{ type: "authenticate", protocolVersion: 1, ticket: "one-time-ticket" }]);
  socket.emit({ type: "ready", generation: "g1" }); await flush();
  expect(change).toHaveBeenLastCalledWith("listening", "https://relay.test/prefix/t/tv-one/");
  expect(Xhr.all.filter((x) => x.url.endsWith("/tvs"))).toHaveLength(1);
});

test("ownership survives reconnect but is isolated by canonical relay prefix", async () => {
  wsEnabled = false;
  const one = client(); one.value.start(); await flush(); one.value.stop();
  one.value.start(); await flush();
  expect(Xhr.all.filter((x) => x.url.endsWith("/tvs"))).toHaveLength(1);
  const other = client("https://relay.test/other/"); other.value.start(); await flush();
  expect(Xhr.all.filter((x) => x.url.endsWith("/tvs"))).toHaveLength(2);
  expect(Xhr.all.find((x) => x.url.endsWith("/connections"))?.headers.Authorization).toBe(`Bearer ${secret}`);
});

test("polling advertises pairing metadata without forwarding secrets or opening workers", async () => {
  wsEnabled = false;
  const { value, change } = client(); value.start(); await flush();
  expect(change).toHaveBeenLastCalledWith("listening", "https://relay.test/prefix/t/tv-one/");
  value.pairing(Date.now() + 300000); await flush();
  expect(Xhr.all.filter((x) => x.url.endsWith("/messages")).at(-1)?.body).toEqual({ type: "pairing", generation: "g1", expiresAt: Date.now() + 300000 });
  const polls = Xhr.all.filter((x) => x.url.endsWith("/poll"));
  expect(polls).toHaveLength(1); expect(polls[0].timeout).toBe(25000);
});

test("socket failure falls back with a fresh fenced polling generation", async () => {
  const { socket, change } = await listening(); socket.close();
  expect(change).toHaveBeenLastCalledWith("unavailable", "", "remote.relayOffline");
  await vi.advanceTimersByTimeAsync(4600); await flush();
  expect(sequence).toBe(2);
  expect(Xhr.all.some((x) => x.url.endsWith("/poll"))).toBe(true);
  expect(Socket.all).toHaveLength(1);
});

test("socket authentication timeout also falls back to polling", async () => {
  const { value } = client(); value.start(); await flush();
  await vi.advanceTimersByTimeAsync(9600); await flush();
  expect(sequence).toBe(2); expect(Socket.all[0].readyState).toBe(3);
});

test("stop aborts connection work and no late completion restarts it", async () => {
  holdCapabilities = true;
  const { value, change } = client(); value.start(); await flush(); value.stop();
  expect(Xhr.all[0].aborted).toBe(true);
  Xhr.all[0].responseText = '{"protocolVersion":1,"transports":["polling"]}'; Xhr.all[0].onload();
  await vi.advanceTimersByTimeAsync(60000); await flush();
  expect(change).toHaveBeenCalledTimes(1); expect(Socket.all).toHaveLength(0);
});

test("expired, wrong-TV, stale-generation, oversized and arbitrary-path messages never dispatch", async () => {
  const { socket, route } = await listening();
  for (const extra of [{ deadline: Date.now() - 1 }, { tvId: "other" }, { generation: "old" },
    { path: "/admin" }, { body: "x".repeat(65537) }, { deadline: Date.now() + 30000 }]) socket.emit(envelope(extra));
  await flush(); expect(route).not.toHaveBeenCalled();
});

test("duplicate envelopes execute once and responses use the live generation", async () => {
  const { socket, route } = await listening();
  socket.emit(envelope()); socket.emit(envelope()); await flush();
  expect(route).toHaveBeenCalledTimes(1);
  expect(socket.sent).toContainEqual({ type: "response", id: "r1", generation: "g1", status: 200, contentType: "application/json", body: "{}" });
});

test("request guard expires during queueing and is fenced immediately on stop", async () => {
  const { socket, route, value } = await listening(); socket.emit(envelope()); await flush();
  const request = route.mock.calls[0]?.[0] as unknown as { canDispatch: () => boolean };
  expect(request.canDispatch()).toBe(true);
  await vi.advanceTimersByTimeAsync(501); expect(request.canDispatch()).toBe(false);
  value.stop(); expect(request.canDispatch()).toBe(false);
});

test("rejected ownership fails closed without registering a replacement TV", async () => {
  wsEnabled = false; const { value, change } = client(); value.start(); await flush(); value.stop();
  rejectOwnership = true; value.start(); await flush(); await vi.advanceTimersByTimeAsync(60000);
  expect(change).toHaveBeenLastCalledWith("unavailable", "", "remote.relayIdentity");
  expect(Xhr.all.filter((x) => x.url.endsWith("/tvs"))).toHaveLength(1);
});

test("relay service delegates to the normal TV pairing and authorization routes", async () => {
  wsEnabled = false;
  saveRelayUrl("https://relay.test/prefix/");
  vi.resetModules();
  const server = await import("../src/services/remoteServer");
  server.startRemoteAccess(); await flush();
  expect(server.remoteAccessState().status).toBe("listening");
  expect(server.remoteAccessState().phoneUrl).toBe("https://relay.test/prefix/t/tv-one/");
  const pairing = server.openPairing(); expect(pairing).toBeTruthy();
  const response = await server.routeRemoteRequest({ method: "POST", path: "/api/v1/pair", headers: { "content-type": "application/json" }, body: JSON.stringify({ secret: pairing?.secret, name: "Phone" }) });
  expect(response.status).toBe(200);
  await server.stopRemoteAccess(); expect(server.remoteAccessState().status).toBe("idle");
});
