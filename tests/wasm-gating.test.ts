import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { isWasmSupported } from "../src/services/wasm";
import { needsRepair } from "../src/services/manifest";
import {
  remoteAccessState,
  startRemoteAccess,
  stopRemoteAccess,
} from "../src/services/remoteServer";

const BROKEN_MANIFEST = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:2
#EXT-X-MEDIA-SEQUENCE:4294966000
#EXTINF:2.0,
segment1.ts
`;

const HEALTHY_MANIFEST = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:2
#EXT-X-MEDIA-SEQUENCE:150
#EXTINF:2.0,
segment1.ts
`;

describe("WebAssembly Support Detection (TICKET-901)", () => {
  const originalWasm = window.WebAssembly;

  afterEach(() => {
    Object.defineProperty(window, "WebAssembly", {
      value: originalWasm,
      writable: true,
      configurable: true,
    });
  });

  test("detects native WebAssembly when instantiate is a function", () => {
    Object.defineProperty(window, "WebAssembly", {
      value: { instantiate: () => Promise.resolve() },
      writable: true,
      configurable: true,
    });
    expect(isWasmSupported()).toBe(true);
  });

  test("returns false when WebAssembly is undefined (Chromium 47 / Tizen 3.0)", () => {
    Object.defineProperty(window, "WebAssembly", {
      value: undefined,
      writable: true,
      configurable: true,
    });
    expect(isWasmSupported()).toBe(false);
  });

  test("returns false when WebAssembly.instantiate is missing or incomplete (Chromium 56 / Tizen 4.0)", () => {
    Object.defineProperty(window, "WebAssembly", {
      value: {},
      writable: true,
      configurable: true,
    });
    expect(isWasmSupported()).toBe(false);
  });
});

describe("Manifest repair detection", () => {
  test("identifies only overflowing media playlists", () => {
    expect(needsRepair(BROKEN_MANIFEST)).toBe(true);
    expect(needsRepair(HEALTHY_MANIFEST)).toBe(false);
  });
});

describe("LAN Remote Server Soft-Gating (TICKET-901)", () => {
  const originalWasm = window.WebAssembly;

  beforeEach(async () => {
    await stopRemoteAccess();
  });

  afterEach(async () => {
    await stopRemoteAccess();
    Object.defineProperty(window, "WebAssembly", {
      value: originalWasm,
      writable: true,
      configurable: true,
    });
  });

  test("marks status as unavailable and does not start worker when WebAssembly is absent", () => {
    Object.defineProperty(window, "WebAssembly", {
      value: undefined,
      writable: true,
      configurable: true,
    });

    const mockWorker = vi.fn();
    vi.stubGlobal("Worker", mockWorker);

    startRemoteAccess();

    const state = remoteAccessState();
    expect(state.status).toBe("unavailable");
    expect(state.error).toContain("WebAssembly is not supported");
    expect(mockWorker).not.toHaveBeenCalled();
  });
});

describe("Loopback Manifest Repair Soft-Gating (TICKET-901)", () => {
  const originalWasm = window.WebAssembly;

  afterEach(() => {
    Object.defineProperty(window, "WebAssembly", {
      value: originalWasm,
      writable: true,
      configurable: true,
    });
    vi.unstubAllGlobals();
  });

  test("prepare reports unavailable repair safely when WebAssembly is absent", async () => {
    Object.defineProperty(window, "WebAssembly", {
      value: undefined,
      writable: true,
      configurable: true,
    });

    vi.stubGlobal("fetch", () =>
      Promise.resolve({
        ok: true,
        text: () => Promise.resolve(BROKEN_MANIFEST),
      }),
    );

    const { prepare, repairState } = await import("../src/services/repair");

    const state = repairState();
    expect(state.state).toBe("unavailable");

    const result = await prepare("http://provider.example/live/broken.m3u8");
    expect(result).toBeNull();
  });
});
