import { describe, expect, test, vi } from "vitest";
import {
  PolyfillTextDecoder,
  PolyfillTextEncoder,
  createAbortSignalFetch,
  polyfillArrayIncludes,
  polyfillObjectEntries,
  polyfillObjectValues,
  polyfillStringPadEnd,
  polyfillStringPadStart,
} from "../src/polyfills";

describe("Chromium 47/56/63 Extended Polyfills", () => {
  test("defines globalThis", () => {
    expect(globalThis).toBeDefined();
    expect((window as unknown as { globalThis: typeof window }).globalThis).toBe(window);
  });

  test("defines queueMicrotask", async () => {
    let ran = false;
    window.queueMicrotask(() => {
      ran = true;
    });
    await Promise.resolve();
    expect(ran).toBe(true);
  });

  test("AbortController and AbortSignal dispatch abort events", () => {
    const controller = new AbortController();
    let aborted = false;
    controller.signal.addEventListener("abort", () => {
      aborted = true;
    });
    expect(controller.signal.aborted).toBe(false);
    controller.abort();
    expect(controller.signal.aborted).toBe(true);
    expect(aborted).toBe(true);
  });

  test("ResizeObserver instantiates and observes elements without throwing", () => {
    const observer = new ResizeObserver(() => {});
    const div = document.createElement("div");
    document.body.appendChild(div);
    observer.observe(div);
    observer.unobserve(div);
    observer.disconnect();
    document.body.removeChild(div);
    expect(observer).toBeDefined();
  });

  test("Array.prototype.flat and flatMap work correctly", () => {
    const arr = [1, [2, [3, 4]]];
    expect(arr.flat()).toEqual([1, 2, [3, 4]]);
    expect(arr.flat(2)).toEqual([1, 2, 3, 4]);

    const mapped = [1, 2, 3].flatMap((x) => [x, x * 2]);
    expect(mapped).toEqual([1, 2, 2, 4, 3, 6]);
  });

  test("Object.fromEntries constructs objects from key-value pairs", () => {
    const entries: [string, number][] = [
      ["a", 1],
      ["b", 2],
    ];
    expect(Object.fromEntries(entries)).toEqual({ a: 1, b: 2 });
  });

  describe("Object.values & Object.entries", () => {
    test("Object.values returns array of property values", () => {
      const obj = { x: 10, y: "hello", z: true };
      expect(Object.values(obj)).toEqual([10, "hello", true]);
      expect(polyfillObjectValues(obj)).toEqual([10, "hello", true]);
    });

    test("Object.entries returns key-value pairs", () => {
      const obj = { id: 1, name: "Zappa" };
      expect(Object.entries(obj)).toEqual([
        ["id", 1],
        ["name", "Zappa"],
      ]);
      expect(polyfillObjectEntries(obj)).toEqual([
        ["id", 1],
        ["name", "Zappa"],
      ]);
    });

    test("throws TypeError when passed null or undefined", () => {
      expect(() => polyfillObjectValues(null as unknown as object)).toThrow(TypeError);
      expect(() => polyfillObjectEntries(undefined as unknown as object)).toThrow(TypeError);
    });
  });

  describe("Array.prototype.includes", () => {
    test("finds elements in arrays", () => {
      const list = ["apple", "banana", "cherry"];
      expect(list.includes("banana")).toBe(true);
      expect(list.includes("grape")).toBe(false);
      expect(polyfillArrayIncludes(list, "cherry")).toBe(true);
      expect(polyfillArrayIncludes(list, "pear")).toBe(false);
    });

    test("handles fromIndex and negative offsets", () => {
      const nums = [10, 20, 30, 40, 50];
      expect(polyfillArrayIncludes(nums, 20, 2)).toBe(false);
      expect(polyfillArrayIncludes(nums, 30, 2)).toBe(true);
      expect(polyfillArrayIncludes(nums, 40, -2)).toBe(true);
      expect(polyfillArrayIncludes(nums, 10, -2)).toBe(false);
    });

    test("correctly finds NaN", () => {
      const arrWithNaN = [1, Number.NaN, 3];
      expect(polyfillArrayIncludes(arrWithNaN, Number.NaN)).toBe(true);
      expect(arrWithNaN.includes(Number.NaN)).toBe(true);
    });

    test("throws on null or undefined array target", () => {
      expect(() => polyfillArrayIncludes(null as unknown as unknown[], 1)).toThrow(TypeError);
    });
  });

  describe("String.prototype.padStart & padEnd", () => {
    test("padStart pads strings to target length", () => {
      expect("7".padStart(3, "0")).toBe("007");
      expect(polyfillStringPadStart("7", 3, "0")).toBe("007");
      expect(polyfillStringPadStart("test", 10, "123")).toBe("123123test");
      expect(polyfillStringPadStart("long string", 5)).toBe("long string");
    });

    test("padEnd pads strings at end", () => {
      expect("42".padEnd(5, ".")).toBe("42...");
      expect(polyfillStringPadEnd("42", 5, ".")).toBe("42...");
      expect(polyfillStringPadEnd("ok", 6, "-+")).toBe("ok-+-+");
      expect(polyfillStringPadEnd("already long", 4)).toBe("already long");
    });

    test("throws on null or undefined string target", () => {
      expect(() => polyfillStringPadStart(null as unknown as string, 5)).toThrow(TypeError);
      expect(() => polyfillStringPadEnd(undefined as unknown as string, 5)).toThrow(TypeError);
    });
  });

  describe("PolyfillTextEncoder & PolyfillTextDecoder", () => {
    const encoder = new PolyfillTextEncoder();
    const decoder = new PolyfillTextDecoder();

    test("encodes and decodes ASCII string", () => {
      const text = "Hello, World! 123";
      const bytes = encoder.encode(text);
      expect(bytes).toBeInstanceOf(Uint8Array);
      expect(bytes.length).toBe(text.length);
      const decoded = decoder.decode(bytes);
      expect(decoded).toBe(text);
    });

    test("encodes and decodes multi-byte UTF-8 and emojis", () => {
      const text = "Zappa 2 TV · Åland · Москва · 日本 · 🎬🍿📺";
      const bytes = encoder.encode(text);
      const decoded = decoder.decode(bytes);
      expect(decoded).toBe(text);
    });

    test("encodeInto properly copies bytes and reports count", () => {
      const text = "Zappa TV";
      const buffer = new Uint8Array(20);
      const res = encoder.encodeInto(text, buffer);
      expect(res.written).toBe(text.length);
      expect(res.read).toBe(text.length);
      expect(decoder.decode(buffer.subarray(0, res.written))).toBe(text);
    });

    test("decodes ArrayBuffer and DataView inputs", () => {
      const text = "Stream buffer test";
      const bytes = encoder.encode(text);
      expect(decoder.decode(bytes.buffer)).toBe(text);

      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      expect(decoder.decode(view)).toBe(text);
    });

    test("strips UTF-8 BOM when ignoreBOM is false (default)", () => {
      const bomAndText = new Uint8Array([0xef, 0xbb, 0xbf, 0x48, 0x69]);
      const normalDecoder = new PolyfillTextDecoder("utf-8");
      expect(normalDecoder.decode(bomAndText)).toBe("Hi");

      const preservingDecoder = new PolyfillTextDecoder("utf-8", {
        ignoreBOM: true,
      });
      const decoded = preservingDecoder.decode(bomAndText);
      expect(decoded.charCodeAt(0)).toBe(0xfeff);
      expect(decoded.slice(1)).toBe("Hi");
    });

    test("throws RangeError on unsupported encoding label", () => {
      expect(() => new PolyfillTextDecoder("iso-8859-1")).toThrow(RangeError);
    });

    test("fatal mode throws TypeError on invalid/incomplete sequences", () => {
      const fatalDecoder = new PolyfillTextDecoder("utf-8", { fatal: true });
      // Incomplete 2-byte sequence
      expect(() => fatalDecoder.decode(new Uint8Array([0xc3]))).toThrow(TypeError);
      // Invalid continuation byte
      expect(() => fatalDecoder.decode(new Uint8Array([0xc3, 0x28]))).toThrow(TypeError);
      // Invalid leader byte
      expect(() => fatalDecoder.decode(new Uint8Array([0xff]))).toThrow(TypeError);
    });

    test("non-fatal mode replaces invalid bytes with U+FFFD", () => {
      const nonFatalDecoder = new PolyfillTextDecoder("utf-8", {
        fatal: false,
      });
      const decoded = nonFatalDecoder.decode(new Uint8Array([0xff, 0x41]));
      expect(decoded).toBe("\uFFFDA");
    });
  });

  describe("Fetch compatibility installation", () => {
    test("native fetch retains the exact signal and function identity", async () => {
      const original = vi.fn(
        async (_input: RequestInfo | URL, _init?: RequestInit) => new Response("ok"),
      );
      const fetcher = createAbortSignalFetch(original, { nativeSignals: true });
      const controller = new AbortController();
      const init = { headers: { "x-example": "fixture" }, signal: controller.signal };
      expect(fetcher).toBe(original);
      expect(await (await fetcher("https://fixture.invalid/", init)).text()).toBe("ok");
      expect(original.mock.calls[0][1]).toBe(init);
      expect(original.mock.calls[0][1]?.signal).toBe(controller.signal);
    });

    test("an already-aborted legacy request creates no transport", async () => {
      const original = vi.fn();
      const createXHR = vi.fn(() => {
        throw new Error("must not create transport");
      });
      const fetcher = createAbortSignalFetch(original, { nativeSignals: false, createXHR });
      const controller = new AbortController();
      controller.abort();
      await expect(
        fetcher("https://fixture.invalid/", { signal: controller.signal }),
      ).rejects.toMatchObject({ name: "AbortError" });
      expect(original).not.toHaveBeenCalled();
      expect(createXHR).not.toHaveBeenCalled();
    });

    test("legacy requests without cancellation keep the original fetch path", async () => {
      const original = vi.fn(async () => new Response("ok"));
      const createXHR = vi.fn(() => {
        throw new Error("must not create transport");
      });
      const fetcher = createAbortSignalFetch(original, { nativeSignals: false, createXHR });
      expect(await (await fetcher("https://fixture.invalid/")).text()).toBe("ok");
      expect(original).toHaveBeenCalledOnce();
      expect(createXHR).not.toHaveBeenCalled();
    });
  });
});
