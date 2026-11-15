import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { memoryIdb } from "./helpers/memoryIdb";

beforeEach(() => {
  vi.resetModules();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

test("concurrent catalog/logo writes share one budget and one committed index", async () => {
  const backend = memoryIdb();
  vi.stubGlobal("indexedDB", backend.factory);
  const disk = await import("../src/services/disk");
  const large = "x".repeat(8 * 1024 * 1024); // 16 MiB accounted text.
  const results = await Promise.all([
    disk.write("catalog:a", large),
    disk.write("catalog:b", large),
    disk.write("logo", "l".repeat(4 * 1024 * 1024)),
  ]);
  expect(results).toEqual([true, true, true]);
  expect((await disk.usage()).bytes).toBeLessThanOrEqual(disk.BUDGET_BYTES);
  const actual = [...backend.control.stores.get("values")!.values()].reduce<number>(
    (sum, value) => sum + (value as string).length * 2,
    0,
  );
  expect((await disk.usage()).bytes).toBe(actual);
  expect(backend.control.maxWriters).toBe(1);
});

test("aborted writes do not grow the committed budget mirror", async () => {
  const backend = memoryIdb();
  vi.stubGlobal("indexedDB", backend.factory);
  const disk = await import("../src/services/disk");
  expect(await disk.write("old", "good")).toBe(true);
  backend.control.failNextWrite = true;
  expect(await disk.write("failed", "not committed")).toBe(false);
  expect(await disk.usage()).toEqual({ bytes: 8, count: 1 });
  expect(await disk.read("old")).toBe("good");
});

test("reusable memory fallback is bounded and refuses oversized entries without deleting valid content", async () => {
  const { BoundedMemoryCache } = await import("../src/services/vodCache");
  const cache = new BoundedMemoryCache(20);
  expect(cache.put("good", "abc")).toBe(true);
  expect(cache.put("too-large", "x".repeat(11))).toBe(false);
  expect(cache.get("good")).toBe("abc");
  cache.put("next", "x".repeat(9));
  expect(cache.usage()).toBeLessThanOrEqual(20);
  expect(cache.get("good")).toBeNull();
});

test("catalogs larger than the cache remain completely readable through a bounded one-shot handoff", async () => {
  vi.stubGlobal("indexedDB", undefined);
  const cache = await import("../src/services/vodCache");
  const { BUDGET_BYTES } = await import("../src/services/disk");
  const item = {
    kind: "movie",
    name: "x".repeat(BUDGET_BYTES / 2),
    streamId: "1",
    key: "v1",
    logo: "",
    group: "Group",
    num: 1,
    skey: "x",
    rating: "",
  };
  expect(
    await cache.saveResult("vod:oversized:v1", {
      count: 1,
      groups: [{ id: "Group", name: "Group", count: 1 }],
      pieces: [JSON.stringify([item])],
    }),
  ).toBe(1);
  expect((await cache.dbGet<{ count: number }>("vod:oversized:v1"))?.count).toBe(1);
  expect((await cache.dbGet<string>("vod:oversized:v1#0"))!.length).toBeGreaterThan(
    BUDGET_BYTES / 2,
  );
  expect(cache.memoryUsage()).toBeLessThanOrEqual(BUDGET_BYTES);
  cache.releaseResult("vod:oversized:v1");
  expect(await cache.dbGet("vod:oversized:v1")).toBeNull();
});

test("source clearing removes its memory catalogs while preserving another source and personal state", async () => {
  vi.stubGlobal("indexedDB", undefined);
  const cache = await import("../src/services/vodCache");
  const result = { count: 0, groups: [], pieces: [] };
  localStorage.setItem("openiptv.personal", "preserve");
  await cache.saveResult("vod:a:v1", result);
  await cache.saveResult("vod:b:v1", result);
  cache.clearSourceMemory("a");
  expect(await cache.dbGet("vod:a:v1")).toBeNull();
  expect((await cache.dbGet<{ count: number }>("vod:b:v1"))?.count).toBe(0);
  expect(localStorage.getItem("openiptv.personal")).toBe("preserve");
});

test("dedicated VOD database preserves zappa-vod without legacy cleanup deletion (TICKET-2198)", async () => {
  const backend = memoryIdb();
  vi.stubGlobal("indexedDB", backend.factory);
  const { cleanupLegacyVodCache } = await import("../src/services/vodCache");
  const cleaning = cleanupLegacyVodCache();
  expect(await cleaning).toBe(true);
  expect(backend.control.deleted).toEqual([]);
});

test("VOD storage isolation uses dedicated zappa-vod database with 200MB budget (TICKET-2198)", async () => {
  const backend = memoryIdb();
  vi.stubGlobal("indexedDB", backend.factory);
  const vodDisk = await import("../src/services/vodDisk");
  const disk = await import("../src/services/disk");

  expect(vodDisk.VOD_BUDGET_BYTES).toBe(200 * 1024 * 1024);
  expect(disk.BUDGET_BYTES).toBe(24 * 1024 * 1024);

  // Write to VOD disk
  await vodDisk.write("vod-entry", "vod-data");
  // Write to Live TV disk
  await disk.write("live-logo", "logo-data");

  expect(await vodDisk.read("vod-entry")).toBe("vod-data");
  expect(await disk.read("live-logo")).toBe("logo-data");

  // Verify that live TV disk does not contain VOD entry and vice versa
  expect(await disk.read("vod-entry")).toBeNull();
  expect(await vodDisk.read("live-logo")).toBeNull();
});
