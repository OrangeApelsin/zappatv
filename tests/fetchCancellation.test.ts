// @vitest-environment node
import { createServer } from "node:http";
import { once } from "node:events";
import { afterEach, expect, test, vi } from "vitest";
import { JSDOM } from "jsdom";
import {
  createAbortSignalFetch,
  supportsNativeAbortFetch,
} from "../src/services/abortableFetch";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
class FakeXHR {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  responseType = "";
  withCredentials = false;
  status = 200;
  statusText = "OK";
  response = new TextEncoder().encode('{"count":2}').buffer;
  responseURL = "https://fixture.invalid/data";
  open = vi.fn();
  send = vi.fn();
  abort = vi.fn();
  headers: Record<string, string> = {};
  setRequestHeader(name: string, value: string) {
    this.headers[name] = value;
  }
  getAllResponseHeaders() {
    return "Content-Type: application/json\r\nX-Fixture: yes\r\n";
  }
}
function legacy() {
  const xhr = new FakeXHR();
  const original = vi.fn();
  return {
    xhr,
    original,
    fetcher: createAbortSignalFetch(original, {
      nativeSignals: false,
      createXHR: () => xhr as unknown as XMLHttpRequest,
    }),
  };
}

test("native support is detected through a real Request-followed signal", () => {
  expect(supportsNativeAbortFetch()).toBe(true);
  vi.stubGlobal("AbortController", undefined);
  expect(supportsNativeAbortFetch()).toBe(false);
});

test.each([null, false, 0, ""])(
  "legacy cancellation preserves falsy reason %s",
  async (reason) => {
    const { fetcher, xhr } = legacy();
    const controller = new AbortController();
    const result = fetcher("https://fixture.invalid/data", { signal: controller.signal });
    controller.abort(reason);
    await expect(result).rejects.toBe(reason);
    expect(xhr.abort).toHaveBeenCalledOnce();
  },
);

test("legacy abort stops transport, detaches handlers and ignores a queued late response", async () => {
  const { xhr, original, fetcher } = legacy();
  const controller = new AbortController();
  const remove = vi.spyOn(controller.signal, "removeEventListener");
  const result = fetcher("https://fixture.invalid/data", { signal: controller.signal });
  const late = xhr.onload!;
  controller.abort();
  await expect(result).rejects.toMatchObject({ name: "AbortError" });
  expect(xhr.abort).toHaveBeenCalledOnce();
  expect(original).not.toHaveBeenCalled();
  expect(remove).toHaveBeenCalledOnce();
  expect(xhr.onload).toBeNull();
  expect(xhr.onerror).toBeNull();
  late();
  expect(xhr.abort).toHaveBeenCalledOnce();
});

test("legacy request preserves method, headers, cache, credentials and buffered response metadata", async () => {
  const { xhr, fetcher } = legacy();
  const controller = new AbortController();
  const remove = vi.spyOn(controller.signal, "removeEventListener");
  const result = fetcher("https://fixture.invalid/data", {
    signal: controller.signal,
    headers: { "x-example": "fixture" },
    credentials: "include",
    cache: "no-cache",
  });
  expect(xhr.open).toHaveBeenCalledWith("GET", "https://fixture.invalid/data", true);
  expect(xhr.withCredentials).toBe(true);
  expect(xhr.responseType).toBe("arraybuffer");
  expect(xhr.headers).toMatchObject({
    "x-example": "fixture",
    "Cache-Control": "no-cache",
    Pragma: "no-cache",
  });
  xhr.onload!();
  const response = await result;
  expect(response.status).toBe(200);
  expect(response.url).toBe(xhr.responseURL);
  expect(response.redirected).toBe(false);
  expect(response.headers.get("x-fixture")).toBe("yes");
  expect(await response.json()).toEqual({ count: 2 });
  expect(remove).toHaveBeenCalledOnce();
  controller.abort();
  expect(xhr.abort).not.toHaveBeenCalled();
});

test("aborting after load prevents late body or cloned-response consumption", async () => {
  const { xhr, fetcher } = legacy();
  const controller = new AbortController();
  const result = fetcher("https://fixture.invalid/data", { signal: controller.signal });
  xhr.onload!();
  const response = await result;
  const clone = response.clone();
  controller.abort();
  await expect(response.json()).rejects.toMatchObject({ name: "AbortError" });
  await expect(clone.text()).rejects.toMatchObject({ name: "AbortError" });
});

test("a Request-carried signal and a pending body read retain cancellation", async () => {
  const { xhr, fetcher } = legacy();
  const controller = new AbortController();
  const result = fetcher(
    new Request("https://fixture.invalid/data", { signal: controller.signal }),
    { signal: undefined },
  );
  xhr.onload!();
  const body = (await result).json();
  controller.abort();
  await expect(body).rejects.toMatchObject({ name: "AbortError" });
});

test("successive cancelled transfers do not accumulate active transport work", async () => {
  let active = 0;
  let peak = 0;
  const fetcher = createAbortSignalFetch(vi.fn(), {
    nativeSignals: false,
    createXHR: () => {
      const xhr = new FakeXHR();
      xhr.send.mockImplementation(() => {
        active++;
        peak = Math.max(peak, active);
      });
      xhr.abort.mockImplementation(() => {
        active--;
      });
      return xhr as unknown as XMLHttpRequest;
    },
  });
  for (let i = 0; i < 40; i++) {
    const controller = new AbortController();
    const result = fetcher("https://fixture.invalid/data", { signal: controller.signal });
    controller.abort();
    await expect(result).rejects.toMatchObject({ name: "AbortError" });
  }
  expect(active).toBe(0);
  expect(peak).toBe(1);
});

test("legacy cookie-omission restrictions fail before sending rather than silently leaking cookies", async () => {
  vi.stubGlobal("window", { location: { origin: "https://fixture.invalid" } });
  const { xhr, fetcher } = legacy();
  await expect(
    fetcher("https://fixture.invalid/data", {
      credentials: "omit",
      signal: new AbortController().signal,
    }),
  ).rejects.toThrow("omit same-origin cookies");
  expect(xhr.open).not.toHaveBeenCalled();
});

test("M63 Request without cache/keepalive/referrerPolicy getters preserves explicit policies", async () => {
  const NativeRequest = Request;
  vi.stubGlobal(
    "Request",
    class extends NativeRequest {
      constructor(input: RequestInfo | URL, init?: RequestInit) {
        super(input, init);
        for (const name of ["cache", "keepalive", "referrerPolicy"])
          Object.defineProperty(this, name, { value: undefined });
      }
    },
  );
  const { fetcher, xhr } = legacy();
  const controller = new AbortController();
  const result = fetcher("https://fixture.invalid/data", {
    signal: controller.signal,
    cache: "no-store",
  });
  expect(xhr.headers["Cache-Control"]).toBe("no-store");
  xhr.onload!();
  await expect(result).resolves.toBeInstanceOf(Response);
  await expect(
    fetcher("https://fixture.invalid/data", { signal: controller.signal, keepalive: true }),
  ).rejects.toThrow("fetch policy");
});

test("legacy POST body is serialized once and an abort before send prevents transfer", async () => {
  const { xhr, fetcher } = legacy();
  const controller = new AbortController();
  const result = fetcher(
    new Request("https://fixture.invalid/data", { method: "POST", body: '{"a":1}' }),
    { signal: controller.signal },
  );
  await vi.waitFor(() => expect(xhr.send).toHaveBeenCalledOnce());
  expect(new TextDecoder().decode(xhr.send.mock.calls[0][0])).toBe('{"a":1}');
  xhr.onload!();
  await result;
  const next = legacy();
  const other = new AbortController();
  const pending = next.fetcher("https://fixture.invalid/data", {
    method: "POST",
    body: "fixture",
    signal: other.signal,
  });
  other.abort();
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  await Promise.resolve();
  expect(next.xhr.send).not.toHaveBeenCalled();
});

test.each(["onerror", "ontimeout", "onabort"] as const)(
  "%s settles once and removes abort listeners",
  async (event) => {
    const { xhr, fetcher } = legacy();
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    const result = fetcher("https://fixture.invalid/data", { signal: controller.signal });
    xhr[event]!();
    await expect(result).rejects.toThrow();
    expect(remove).toHaveBeenCalledOnce();
    controller.abort();
    expect(xhr.abort).not.toHaveBeenCalled();
  },
);

test("bodyless statuses and redirects retain useful response semantics", async () => {
  const { xhr, fetcher } = legacy();
  xhr.status = 304;
  xhr.statusText = "Not Modified";
  xhr.responseURL = "https://fixture.invalid/changed";
  const result = fetcher("https://fixture.invalid/data", {
    signal: new AbortController().signal,
  });
  xhr.onload!();
  const response = await result;
  expect(response.status).toBe(304);
  expect(response.redirected).toBe(true);
  expect(await response.text()).toBe("");
});

test("a successful local widget read maps XHR status zero to a readable response", async () => {
  const { xhr, fetcher } = legacy();
  xhr.status = 0;
  xhr.statusText = "";
  xhr.responseURL = "file:///widget/data.json";
  const result = fetcher("file:///widget/data.json#local", {
    signal: new AbortController().signal,
  });
  xhr.onload!();
  const response = await result;
  expect(response.status).toBe(200);
  expect(response.url).toBe("file:///widget/data.json");
  expect(response.redirected).toBe(false);
  expect(await response.json()).toEqual({ count: 2 });
});

test("unsupported legacy fetch policies fail before opening a connection", async () => {
  for (const policy of [
    { redirect: "manual" },
    { mode: "no-cors" },
    { cache: "only-if-cached", mode: "same-origin" },
  ] as RequestInit[]) {
    const { xhr, fetcher } = legacy();
    await expect(
      fetcher("https://fixture.invalid/data", {
        ...policy,
        signal: new AbortController().signal,
      }),
    ).rejects.toBeInstanceOf(TypeError);
    expect(xhr.open).not.toHaveBeenCalled();
  }
});

for (const transport of ["native", "legacy"] as const)
  test(`${transport} cancellation closes an actual server response, not only its promise`, async () => {
    let sawRequest!: () => void;
    let sawClose!: () => void;
    const started = new Promise<void>((resolve) => {
      sawRequest = resolve;
    });
    const closed = new Promise<void>((resolve) => {
      sawClose = resolve;
    });
    const server = createServer((_request, response) => {
      response.on("close", sawClose);
      sawRequest();
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing test listener");
    const url = `http://127.0.0.1:${address.port}/pending`;
    const dom = transport === "legacy" ? new JSDOM("", { url }) : null;
    const controller = new AbortController();
    const fetcher = createAbortSignalFetch(fetch, {
      nativeSignals: transport === "native",
      createXHR: () => new dom!.window.XMLHttpRequest(),
    });
    try {
      const pending = fetcher(url, { signal: controller.signal });
      await started;
      controller.abort();
      await expect(pending).rejects.toMatchObject({ name: "AbortError" });
      await closed;
    } finally {
      dom?.window.close();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
