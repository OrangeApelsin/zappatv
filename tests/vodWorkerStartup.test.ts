import { afterEach, expect, test, vi } from "vitest";
import {
  VodPrefetchService,
  WORKER_READY_TIMEOUT_MS,
  WORKER_REQUEST_TIMEOUT_MS,
} from "../src/services/vodPrefetch";
import { readWhole } from "../src/workers/vodWorker";

class FakeWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  terminate = vi.fn();
  postMessage = vi.fn((message: Record<string, unknown>) => {
    if (message.op === "read")
      this.reply({
        ...message,
        type: "success",
        result: readWhole(new Uint8Array(message.buf as ArrayBuffer), "vod", undefined),
      });
  });
  reply(data: Record<string, unknown>) {
    this.onmessage?.({ data } as MessageEvent);
  }
}
const services: VodPrefetchService[] = [];
let serial = 0;
const buffer = () => new TextEncoder().encode('[{"stream_id":1,"name":"Retained"}]').buffer;
afterEach(() => {
  for (const service of services.splice(0)) service.dispose();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
function client() {
  vi.useFakeTimers();
  vi.stubGlobal("Worker", FakeWorker);
  const worker = new FakeWorker();
  const factory = vi.fn(() => worker as unknown as Worker);
  const service = new VodPrefetchService(factory);
  services.push(service);
  return { worker, factory, service };
}
function read(service: VodPrefetchService, signal?: AbortSignal) {
  return service.read({
    playlistId: `lifecycle-${++serial}`,
    kind: "vod",
    buffer: buffer(),
    signal,
  });
}
const tick = () => vi.advanceTimersByTimeAsync(30);

test("concurrent requests wait for one ready acknowledgement and clean up", async () => {
  const { worker, factory, service } = client();
  const first = read(service);
  const second = read(service);
  await tick();
  expect(factory).toHaveBeenCalledOnce();
  expect(worker.postMessage).not.toHaveBeenCalled();
  worker.reply({ type: "ready", ready: true });
  await tick();
  expect(await Promise.all([first, second])).toEqual([1, 1]);
  expect(service.pendingCount).toBe(0);
  expect(service.inFlightCount).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
});
test("silent startup falls back once, retaining the input", async () => {
  const { worker, factory, service } = client();
  const result = read(service);
  await vi.advanceTimersByTimeAsync(WORKER_READY_TIMEOUT_MS + 40);
  expect(await result).toBe(1);
  expect(worker.terminate).toHaveBeenCalledOnce();
  const second = read(service);
  await tick();
  expect(await second).toBe(1);
  expect(factory).toHaveBeenCalledOnce();
});
test.each(["onerror", "onmessageerror"] as const)(
  "%s before readiness falls back",
  async (event) => {
    const { worker, service } = client();
    const result = read(service);
    await tick();
    worker[event]?.();
    await tick();
    expect(await result).toBe(1);
    expect(service.pendingCount).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  },
);
test("constructor failure and unsupported workers use validated fallback", async () => {
  const { factory, service } = client();
  factory.mockImplementation(() => {
    throw new Error("blocked");
  });
  const first = read(service);
  await tick();
  expect(await first).toBe(1);
  expect(factory).toHaveBeenCalledOnce();
  vi.stubGlobal("Worker", undefined);
  const second = read(service);
  await tick();
  expect(await second).toBe(1);
});
test.each(["post", "crash", "timeout"])(
  "%s after readiness replays an undetached buffer",
  async (mode) => {
    const { worker, service } = client();
    const input = buffer();
    worker.postMessage.mockImplementation(() => {
      if (mode === "post") throw new Error("post");
      if (mode === "crash") worker.onerror?.();
    });
    const result = service.read({
      playlistId: `replay-${++serial}`,
      kind: "vod",
      buffer: input,
    });
    await tick();
    worker.reply({ ready: true });
    await vi.advanceTimersByTimeAsync(
      (mode === "timeout" ? WORKER_REQUEST_TIMEOUT_MS : 0) + 40,
    );
    expect(await result).toBe(1);
    expect(input.byteLength).toBeGreaterThan(0);
    expect(worker.postMessage.mock.calls[0]).toHaveLength(1);
    expect(service.pendingCount).toBe(0);
    expect(service.inFlightCount).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  },
);
test("progress and foreign replies cannot settle a request; invalid data is a failure", async () => {
  const { worker, service } = client();
  worker.postMessage.mockImplementation(() => {});
  const result = read(service);
  const rejected = expect(result).rejects.toThrow("invalid");
  await tick();
  worker.reply({ ready: true });
  await tick();
  const message = worker.postMessage.mock.calls[0][0];
  worker.reply({ ...message, type: "progress", loaded: 2, bytes: 10, totalBytes: 20 });
  worker.reply({
    ...message,
    generation: 999,
    type: "success",
    result: readWhole(new Uint8Array(buffer()), "vod", undefined),
  });
  expect(service.pendingCount).toBe(1);
  worker.reply({ ...message, type: "error", code: "invalid" });
  await rejected;
  expect(service.pendingCount).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
});
test.each(["ready", "request"])(
  "source cancellation during %s rejects without fallback or stale publication",
  async (phase) => {
    const { worker, service } = client();
    worker.postMessage.mockImplementation(() => {});
    const result = read(service);
    const rejected = expect(result).rejects.toMatchObject({ name: "AbortError" });
    await tick();
    if (phase === "request") {
      worker.reply({ ready: true });
      await tick();
    }
    service.cancelAll();
    await rejected;
    await tick();
    expect(service.pendingCount).toBe(0);
    expect(service.inFlightCount).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    if (phase === "request")
      expect(worker.postMessage.mock.calls.some(([m]) => m.op === "cancel")).toBe(true);
    service.dispose();
    await expect(read(service)).rejects.toMatchObject({ name: "AbortError" });
  },
);
