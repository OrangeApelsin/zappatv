import { afterEach, expect, test, vi } from "vitest";
import { catalogController } from "../src/services/catalogCancellation";
import { httpRequest, MAX_CATALOG_BYTES } from "../src/services/catalogTransport";
import { VodPrefetchService } from "../src/services/vodPrefetch";

class Xhr {
  static instances: Xhr[] = [];
  constructor() {
    Xhr.instances.push(this);
  }
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  onprogress:
    | ((event: { loaded: number; total?: number; lengthComputable?: boolean }) => void)
    | null = null;
  onreadystatechange: (() => void) | null = null;
  readyState = 0;
  status = 200;
  response: string | ArrayBuffer = "[]";
  responseType = "";
  timeout = 0;
  open = vi.fn();
  send = vi.fn();
  abort = vi.fn();
  complete(value: unknown) {
    const text = JSON.stringify(value);
    this.response =
      this.responseType === "arraybuffer" ? new TextEncoder().encode(text).buffer : text;
    this.onload?.();
  }
}
let service: VodPrefetchService | undefined;
afterEach(() => {
  service?.dispose();
  service = undefined;
  vi.useRealTimers();
  vi.unstubAllGlobals();
  Xhr.instances = [];
});
function setup() {
  vi.stubGlobal("XMLHttpRequest", Xhr);
  vi.stubGlobal("Worker", undefined);
}
async function until(count: number) {
  for (let i = 0; i < 50 && Xhr.instances.length < count; i++)
    await new Promise((resolve) => setTimeout(resolve, 2));
  expect(Xhr.instances.length).toBe(count);
}

test("transport abort detaches handlers, stops the request and ignores late completion", async () => {
  setup();
  const controller = catalogController();
  const request = httpRequest("/list", "text", 1000, controller.signal);
  const rejected = expect(request).rejects.toMatchObject({ name: "AbortError" });
  const xhr = Xhr.instances[0];
  const late = xhr.onload;
  controller.abort();
  await rejected;
  expect(xhr.abort).toHaveBeenCalledOnce();
  expect(xhr.onload).toBeNull();
  expect(xhr.onerror).toBeNull();
  expect(xhr.onprogress).toBeNull();
  late?.();
  await expect(httpRequest("/list", "text", 1000, controller.signal)).rejects.toMatchObject({
    name: "AbortError",
  });
  expect(Xhr.instances).toHaveLength(1);
});
test.each(["timeout", "oversize", "network"])(
  "transport %s rejects and removes listeners",
  async (mode) => {
    setup();
    vi.useFakeTimers();
    const request = httpRequest("/list", "text", 50);
    const rejected = expect(request).rejects.toThrow();
    const xhr = Xhr.instances[0];
    if (mode === "timeout") await vi.advanceTimersByTimeAsync(50);
    else if (mode === "oversize") xhr.onprogress?.({ loaded: MAX_CATALOG_BYTES + 1 });
    else xhr.onerror?.();
    await rejected;
    expect(xhr.onload).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    if (mode !== "network") expect(xhr.abort).toHaveBeenCalledOnce();
  },
);
test("shared fetch survives one subscriber cancelling and caches a successful empty catalog", async () => {
  setup();
  service = new VodPrefetchService();
  const a = catalogController();
  const b = catalogController();
  const options = {
    playlistId: "shared-empty-lifecycle",
    kind: "vod" as const,
    catsUrl: "/cats",
    listUrl: "/list",
  };
  const first = service.fetch({ ...options, signal: a.signal });
  const rejected = expect(first).rejects.toMatchObject({ name: "AbortError" });
  const second = service.fetch({ ...options, signal: b.signal });
  await until(1);
  a.abort();
  await rejected;
  expect(Xhr.instances[0].abort).not.toHaveBeenCalled();
  Xhr.instances[0].complete([]);
  await until(2);
  Xhr.instances[1].complete([]);
  expect(await second).toBe(0);
  expect(await service.fetch(options)).toBe(0);
  expect(Xhr.instances).toHaveLength(2);
  expect(service.inFlightCount).toBe(0);
  expect((await service.take(options.playlistId, "vod")).items).toEqual([]);
});
test("all subscribers cancelling aborts the single transport and permits retry", async () => {
  setup();
  service = new VodPrefetchService();
  const a = catalogController();
  const b = catalogController();
  const options = {
    playlistId: "cancel-shared-lifecycle",
    kind: "vod" as const,
    catsUrl: "/cats",
    listUrl: "/list",
  };
  const first = service.fetch({ ...options, signal: a.signal });
  const second = service.fetch({ ...options, signal: b.signal });
  const rejected = Promise.all([
    expect(first).rejects.toMatchObject({ name: "AbortError" }),
    expect(second).rejects.toMatchObject({ name: "AbortError" }),
  ]);
  await until(1);
  a.abort();
  b.abort();
  await rejected;
  await new Promise((resolve) => setTimeout(resolve, 5));
  expect(Xhr.instances[0].abort).toHaveBeenCalledOnce();
  expect(service.inFlightCount).toBe(0);
  expect(await service.cached(options.playlistId, "vod")).toBe(false);
  const retry = service.fetch(options);
  await until(2);
  Xhr.instances[1].complete([]);
  await until(3);
  Xhr.instances[2].complete([{ stream_id: 8, name: "Retry" }]);
  expect(await retry).toBe(1);
});

test("headers and download bytes report real progress; cancellation ignores late events", async () => {
  setup();
  const controller = catalogController();
  const progress = vi.fn();
  const request = httpRequest(
    "/list",
    "arraybuffer",
    1000,
    controller.signal,
    undefined,
    progress,
  );
  const rejected = expect(request).rejects.toMatchObject({ name: "AbortError" });
  const xhr = Xhr.instances[0];
  xhr.readyState = 2;
  xhr.onreadystatechange?.();
  expect(progress).toHaveBeenLastCalledWith({ bytes: 0, totalBytes: 0 });
  xhr.onprogress?.({ loaded: 150, total: 300, lengthComputable: true });
  expect(progress).toHaveBeenLastCalledWith({ bytes: 150, totalBytes: 300 });
  const late = xhr.onprogress;
  controller.abort();
  await rejected;
  expect(xhr.onreadystatechange).toBeNull();
  late?.({ loaded: 250, total: 300, lengthComputable: true });
  expect(progress).toHaveBeenCalledTimes(2);
});
