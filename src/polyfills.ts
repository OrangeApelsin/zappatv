/**
 * Browser polyfills for Chromium 47/56/63 (Tizen 3.0 / 4.0 / 5.0).
 *
 * Tizen 3.0 runs Chromium 47 (released Dec 2015).
 * Tizen 4.0 runs Chromium 56 (released Jan 2017).
 * Tizen 5.0 runs Chromium 63 (released Dec 2017).
 *
 * Key web APIs that arrived in later engines:
 * - Object.values / Object.entries: Chromium 54 (ES2017)
 * - Array.prototype.includes: Chromium 47/49 (ES2016)
 * - String.prototype.padStart / padEnd: Chromium 57 (ES2017)
 * - TextEncoder / TextDecoder: Missing in early embedded Chromium / workers
 * - ResizeObserver: Chromium 64
 * - AbortController / AbortSignal: Chromium 66
 * - Array.prototype.flat / flatMap: Chromium 69
 * - queueMicrotask: Chromium 71
 * - globalThis: Chromium 71
 * - Object.fromEntries: Chromium 73
 * - Promise.allSettled: Chromium 76
 */

import { createAbortSignalFetch, supportsNativeAbortFetch } from "./services/abortableFetch";
export { createAbortSignalFetch } from "./services/abortableFetch";

export class PolyfillTextEncoder {
  readonly encoding = "utf-8";

  encode(input = ""): Uint8Array {
    const str = String(input);
    const len = str.length;
    const res: number[] = [];
    for (let i = 0; i < len; i++) {
      let code = str.charCodeAt(i);
      // Handle surrogate pairs (UTF-16 high surrogate: 0xD800 - 0xDBFF)
      if (code >= 0xd800 && code <= 0xdbff) {
        if (i + 1 < len) {
          const next = str.charCodeAt(i + 1);
          if (next >= 0xdc00 && next <= 0xdfff) {
            code = (code - 0xd800) * 0x400 + (next - 0xdc00) + 0x10000;
            i++;
          }
        }
      }
      if (code <= 0x7f) {
        res.push(code);
      } else if (code <= 0x7ff) {
        res.push(0xc0 | (code >> 6));
        res.push(0x80 | (code & 0x3f));
      } else if (code <= 0xffff) {
        res.push(0xe0 | (code >> 12));
        res.push(0x80 | ((code >> 6) & 0x3f));
        res.push(0x80 | (code & 0x3f));
      } else {
        res.push(0xf0 | (code >> 18));
        res.push(0x80 | ((code >> 12) & 0x3f));
        res.push(0x80 | ((code >> 6) & 0x3f));
        res.push(0x80 | (code & 0x3f));
      }
    }
    return new Uint8Array(res);
  }

  encodeInto(
    source: string,
    destination: Uint8Array,
  ): { read: number; written: number } {
    const bytes = this.encode(source);
    const written = Math.min(bytes.length, destination.length);
    destination.set(bytes.subarray(0, written));

    let read = 0;
    let b = 0;
    for (let i = 0; i < source.length; i++) {
      const code = source.codePointAt(i) || 0;
      let bytesForChar = 1;
      if (code > 0x7f) {
        bytesForChar = code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
      }
      if (b + bytesForChar > written) break;
      b += bytesForChar;
      read++;
      if (code > 0xffff) i++;
    }
    return { read, written };
  }
}

export class PolyfillTextDecoder {
  readonly encoding: string;
  readonly fatal: boolean;
  readonly ignoreBOM: boolean;

  constructor(
    label = "utf-8",
    options?: { fatal?: boolean; ignoreBOM?: boolean },
  ) {
    const normalized = String(label).toLowerCase().trim();
    if (
      normalized !== "utf-8" &&
      normalized !== "utf8" &&
      normalized !== "unicode-1-1-utf-8"
    ) {
      throw new RangeError(`Unsupported encoding: ${label}`);
    }
    this.encoding = "utf-8";
    this.fatal = Boolean(options?.fatal);
    this.ignoreBOM = Boolean(options?.ignoreBOM);
  }

  decode(input?: BufferSource, _options?: { stream?: boolean }): string {
    if (!input) return "";
    let bytes: Uint8Array;
    if (input instanceof Uint8Array) {
      bytes = input;
    } else if (ArrayBuffer.isView(input)) {
      bytes = new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    } else if (input instanceof ArrayBuffer) {
      bytes = new Uint8Array(input);
    } else {
      return "";
    }

    let out = "";
    let i = 0;
    const len = bytes.length;

    // Strip UTF-8 BOM if present and not ignoreBOM
    if (
      !this.ignoreBOM &&
      len >= 3 &&
      bytes[0] === 0xef &&
      bytes[1] === 0xbb &&
      bytes[2] === 0xbf
    ) {
      i = 3;
    }

    while (i < len) {
      const b1 = bytes[i++];
      if ((b1 & 0x80) === 0) {
        // 1-byte ASCII
        out += String.fromCharCode(b1);
      } else if ((b1 & 0xe0) === 0xc0) {
        // 2-byte sequence
        if (i >= len) {
          if (this.fatal) throw new TypeError("Incomplete UTF-8 sequence");
          out += "\uFFFD";
          break;
        }
        const b2 = bytes[i++];
        if ((b2 & 0xc0) !== 0x80) {
          if (this.fatal) throw new TypeError("Invalid UTF-8 sequence");
          out += "\uFFFD";
          continue;
        }
        const code = ((b1 & 0x1f) << 6) | (b2 & 0x3f);
        if (code < 0x80) {
          if (this.fatal) throw new TypeError("Overlong UTF-8 sequence");
          out += "\uFFFD";
        } else {
          out += String.fromCharCode(code);
        }
      } else if ((b1 & 0xf0) === 0xe0) {
        // 3-byte sequence
        if (i + 1 >= len) {
          if (this.fatal) throw new TypeError("Incomplete UTF-8 sequence");
          out += "\uFFFD";
          break;
        }
        const b2 = bytes[i++];
        const b3 = bytes[i++];
        if ((b2 & 0xc0) !== 0x80 || (b3 & 0xc0) !== 0x80) {
          if (this.fatal) throw new TypeError("Invalid UTF-8 sequence");
          out += "\uFFFD";
          continue;
        }
        const code = ((b1 & 0x0f) << 12) | ((b2 & 0x3f) << 6) | (b3 & 0x3f);
        if (code < 0x0800 || (code >= 0xd800 && code <= 0xdfff)) {
          if (this.fatal) throw new TypeError("Invalid UTF-8 code point");
          out += "\uFFFD";
        } else {
          out += String.fromCharCode(code);
        }
      } else if ((b1 & 0xf8) === 0xf0) {
        // 4-byte sequence
        if (i + 2 >= len) {
          if (this.fatal) throw new TypeError("Incomplete UTF-8 sequence");
          out += "\uFFFD";
          break;
        }
        const b2 = bytes[i++];
        const b3 = bytes[i++];
        const b4 = bytes[i++];
        if (
          (b2 & 0xc0) !== 0x80 ||
          (b3 & 0xc0) !== 0x80 ||
          (b4 & 0xc0) !== 0x80
        ) {
          if (this.fatal) throw new TypeError("Invalid UTF-8 sequence");
          out += "\uFFFD";
          continue;
        }
        let code =
          ((b1 & 0x07) << 18) |
          ((b2 & 0x3f) << 12) |
          ((b3 & 0x3f) << 6) |
          (b4 & 0x3f);
        if (code < 0x10000 || code > 0x10ffff) {
          if (this.fatal) throw new TypeError("Invalid UTF-8 code point");
          out += "\uFFFD";
        } else {
          code -= 0x10000;
          out += String.fromCharCode(
            0xd800 + (code >> 10),
            0xdc00 + (code & 0x3ff),
          );
        }
      } else {
        if (this.fatal) throw new TypeError("Invalid UTF-8 leader byte");
        out += "\uFFFD";
      }
    }

    return out;
  }
}

export function polyfillObjectValues(obj: object): unknown[] {
  if (obj === null || obj === undefined) {
    throw new TypeError("Cannot convert undefined or null to object");
  }
  return Object.keys(obj).map((key) => (obj as Record<string, unknown>)[key]);
}

export function polyfillObjectEntries(obj: object): [string, unknown][] {
  if (obj === null || obj === undefined) {
    throw new TypeError("Cannot convert undefined or null to object");
  }
  return Object.keys(obj).map((key) => [
    key,
    (obj as Record<string, unknown>)[key],
  ]);
}

export function polyfillArrayIncludes(
  arr: unknown[],
  searchElement: unknown,
  fromIndex = 0,
): boolean {
  if (arr === null || arr === undefined) {
    throw new TypeError("Array.prototype.includes called on null or undefined");
  }
  const len = arr.length >>> 0;
  if (len === 0) return false;
  const n = Math.trunc(fromIndex) || 0;
  let k = n >= 0 ? n : Math.max(0, len + n);
  const isSameValueZero = (x: unknown, y: unknown) =>
    x === y ||
    (typeof x === "number" &&
      typeof y === "number" &&
      Number.isNaN(x) &&
      Number.isNaN(y));
  while (k < len) {
    if (isSameValueZero(arr[k], searchElement)) {
      return true;
    }
    k++;
  }
  return false;
}

export function polyfillStringPadStart(
  strVal: string,
  targetLength: number,
  padString = " ",
): string {
  if (strVal === null || strVal === undefined) {
    throw new TypeError(
      "String.prototype.padStart called on null or undefined",
    );
  }
  const str = String(strVal);
  const targetLen = Math.trunc(targetLength) || 0;
  if (str.length >= targetLen) return str;
  let pad = String(padString);
  if (pad === "") return str;
  const fillLen = targetLen - str.length;
  while (pad.length < fillLen) {
    pad += pad;
  }
  return pad.slice(0, fillLen) + str;
}

export function polyfillStringPadEnd(
  strVal: string,
  targetLength: number,
  padString = " ",
): string {
  if (strVal === null || strVal === undefined) {
    throw new TypeError("String.prototype.padEnd called on null or undefined");
  }
  const str = String(strVal);
  const targetLen = Math.trunc(targetLength) || 0;
  if (str.length >= targetLen) return str;
  let pad = String(padString);
  if (pad === "") return str;
  const fillLen = targetLen - str.length;
  while (pad.length < fillLen) {
    pad += pad;
  }
  return str + pad.slice(0, fillLen);
}

if (typeof window !== "undefined") {
  // globalThis
  if (typeof globalThis === "undefined") {
    (window as unknown as { globalThis: typeof window }).globalThis = window;
  }

  // queueMicrotask
  if (typeof window.queueMicrotask !== "function") {
    window.queueMicrotask = (fn: () => void) => {
      Promise.resolve()
        .then(fn)
        .catch((e) => {
          setTimeout(() => {
            throw e;
          }, 0);
        });
    };
  }

  // Object.values (Chromium 54 / ES2017)
  if (
    typeof (Object as unknown as { values?: unknown }).values !== "function"
  ) {
    (Object as unknown as { values: typeof polyfillObjectValues }).values =
      polyfillObjectValues;
  }

  // Object.entries (Chromium 54 / ES2017)
  if (
    typeof (Object as unknown as { entries?: unknown }).entries !== "function"
  ) {
    (Object as unknown as { entries: typeof polyfillObjectEntries }).entries =
      polyfillObjectEntries;
  }

  // Array.prototype.includes (Chromium 47/49 / ES2016)
  if (!Array.prototype.includes) {
    (
      Array.prototype as unknown as {
        includes: (searchElement: unknown, fromIndex?: number) => boolean;
      }
    ).includes = function (
      this: unknown[],
      searchElement: unknown,
      fromIndex = 0,
    ): boolean {
      return polyfillArrayIncludes(this, searchElement, fromIndex);
    };
  }

  // String.prototype.padStart (Chromium 57 / ES2017)
  if (!String.prototype.padStart) {
    (
      String.prototype as unknown as {
        padStart: (targetLength: number, padString?: string) => string;
      }
    ).padStart = function (
      this: string,
      targetLength: number,
      padString = " ",
    ): string {
      return polyfillStringPadStart(this, targetLength, padString);
    };
  }

  // String.prototype.padEnd (Chromium 57 / ES2017)
  if (!String.prototype.padEnd) {
    (
      String.prototype as unknown as {
        padEnd: (targetLength: number, padString?: string) => string;
      }
    ).padEnd = function (
      this: string,
      targetLength: number,
      padString = " ",
    ): string {
      return polyfillStringPadEnd(this, targetLength, padString);
    };
  }

  // TextEncoder (Chromium 47 fallback)
  if (typeof window.TextEncoder === "undefined") {
    (window as unknown as { TextEncoder: unknown }).TextEncoder =
      PolyfillTextEncoder;
    if (typeof globalThis !== "undefined") {
      (globalThis as unknown as { TextEncoder: unknown }).TextEncoder =
        PolyfillTextEncoder;
    }
  }

  // TextDecoder (Chromium 47 fallback)
  if (typeof window.TextDecoder === "undefined") {
    (window as unknown as { TextDecoder: unknown }).TextDecoder =
      PolyfillTextDecoder;
    if (typeof globalThis !== "undefined") {
      (globalThis as unknown as { TextDecoder: unknown }).TextDecoder =
        PolyfillTextDecoder;
    }
  }

  // Detect real fetch/signal support before installing a lookalike controller.
  const nativeFetchSignals = supportsNativeAbortFetch();

  // AbortController & AbortSignal
  if (typeof window.AbortController === "undefined") {
    class SimpleEventTarget {
      private _listeners: Record<
        string,
        Array<{
          listener: EventListenerOrEventListenerObject;
          once?: boolean;
        }>
      > = {};

      addEventListener(
        type: string,
        listener: EventListenerOrEventListenerObject,
        options?: boolean | AddEventListenerOptions,
      ) {
        if (!listener) return;
        if (!this._listeners[type]) this._listeners[type] = [];
        const once = typeof options === "object" ? Boolean(options.once) : false;
        this._listeners[type].push({ listener, once });
      }

      removeEventListener(
        type: string,
        listener: EventListenerOrEventListenerObject,
      ) {
        if (!this._listeners[type]) return;
        this._listeners[type] = this._listeners[type].filter(
          (l) => l.listener !== listener,
        );
      }

      dispatchEvent(event: Event): boolean {
        const list = this._listeners[event.type];
        if (!list) return true;
        for (const item of [...list]) {
          if (item.once) {
            this.removeEventListener(event.type, item.listener);
          }
          try {
            if (typeof item.listener === "function") {
              item.listener.call(this, event);
            } else if (
              item.listener &&
              typeof item.listener.handleEvent === "function"
            ) {
              item.listener.handleEvent(event);
            }
          } catch (e) {
            console.error(e);
          }
        }
        return !event.defaultPrevented;
      }
    }

    class PolyfillAbortSignal extends SimpleEventTarget {
      aborted = false;
      reason: unknown = undefined;
      onabort: ((this: AbortSignal, ev: Event) => unknown) | null = null;

      throwIfAborted() {
        if (this.aborted) throw this.reason;
      }
    }

    class PolyfillAbortController {
      readonly signal: AbortSignal =
        new PolyfillAbortSignal() as unknown as AbortSignal;

      abort(reason?: unknown) {
        const s = this.signal as unknown as PolyfillAbortSignal;
        if (s.aborted) return;
        s.aborted = true;
        s.reason =
          reason !== undefined
            ? reason
            : new DOMException("The operation was aborted", "AbortError");
        const ev = new Event("abort");
        s.dispatchEvent(ev);
        if (typeof s.onabort === "function") {
          s.onabort.call(this.signal, ev);
        }
      }
    }

    (window as unknown as { AbortController: unknown }).AbortController =
      PolyfillAbortController;
    (window as unknown as { AbortSignal: unknown }).AbortSignal =
      PolyfillAbortSignal;
  }

  // Hook AbortSignal into fetch if signal was not natively supported (Chromium 47/56/63)
  if (typeof window.fetch === "function" && !nativeFetchSignals) {
    window.fetch = createAbortSignalFetch(window.fetch, { nativeSignals: false });
  }

  // ResizeObserver
  if (typeof window.ResizeObserver === "undefined") {
    class PolyfillResizeObserver {
      private callback: ResizeObserverCallback;
      private targets = new Set<Element>();
      private onResize: () => void;

      constructor(callback: ResizeObserverCallback) {
        this.callback = callback;
        this.onResize = () => {
          if (this.targets.size === 0) return;
          const entries: ResizeObserverEntry[] = Array.from(this.targets).map(
            (target) => {
              const rect = target.getBoundingClientRect();
              return {
                target,
                contentRect: rect,
                borderBoxSize: [],
                contentBoxSize: [],
                devicePixelContentBoxSize: [],
              } as unknown as ResizeObserverEntry;
            },
          );
          try {
            this.callback(entries, this as unknown as ResizeObserver);
          } catch (err) {
            console.error("ResizeObserver callback error:", err);
          }
        };
      }

      observe(target: Element) {
        if (!target) return;
        this.targets.add(target);
        if (this.targets.size === 1) {
          window.addEventListener("resize", this.onResize);
        }
        if (typeof requestAnimationFrame === "function") {
          requestAnimationFrame(() => {
            if (this.targets.has(target)) {
              this.onResize();
            }
          });
        } else {
          setTimeout(() => {
            if (this.targets.has(target)) {
              this.onResize();
            }
          }, 0);
        }
      }

      unobserve(target: Element) {
        this.targets.delete(target);
        if (this.targets.size === 0) {
          window.removeEventListener("resize", this.onResize);
        }
      }

      disconnect() {
        this.targets.clear();
        window.removeEventListener("resize", this.onResize);
      }
    }

    (window as unknown as { ResizeObserver: unknown }).ResizeObserver =
      PolyfillResizeObserver;
  }

  // Array.prototype.flat
  if (!Array.prototype.flat) {
    (Array.prototype as unknown as { flat: (depth?: number) => unknown[] }).flat =
      function (this: unknown[], depth = 1): unknown[] {
        return depth > 0
          ? Array.prototype.reduce.call(
              this,
              (acc: unknown, val: unknown) =>
                (acc as unknown[]).concat(
                  Array.isArray(val)
                    ? (val as unknown as { flat: (d: number) => unknown[] }).flat(
                        depth - 1,
                      )
                    : val,
                ),
              [],
            ) as unknown[]
          : Array.prototype.slice.call(this);
      };
  }

  // Array.prototype.flatMap
  if (!Array.prototype.flatMap) {
    (
      Array.prototype as unknown as {
        flatMap: <T, U>(
          callback: (value: T, index: number, array: T[]) => U | readonly U[],
          thisArg?: unknown,
        ) => U[];
      }
    ).flatMap = function <T, U>(
      this: T[],
      callback: (value: T, index: number, array: T[]) => U | readonly U[],
      thisArg?: unknown,
    ): U[] {
      return (
        this.map(callback, thisArg) as unknown as {
          flat: () => U[];
        }
      ).flat();
    };
  }

  // Object.fromEntries
  if (
    typeof (Object as unknown as { fromEntries?: unknown }).fromEntries !==
    "function"
  ) {
    (Object as unknown as { fromEntries: unknown }).fromEntries = (
      entries: Iterable<readonly [PropertyKey, unknown]>,
    ) => {
      const obj: Record<PropertyKey, unknown> = {};
      for (const [k, v] of entries) {
        obj[k] = v;
      }
      return obj;
    };
  }
}
