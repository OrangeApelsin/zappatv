import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { memoryIdb } from "./helpers/memoryIdb";

const root = "vod:provider:v1:signature";
const base = "xtream:provider:v1:signature:catalog:vod";
function catalog(name: string, count = 1) {
  const items = Array.from({ length: count }, (_, i) => ({
    kind: "movie",
    streamId: String(i + 1),
    key: `v${i + 1}`,
    name,
    skey: name,
    group: "G",
    logo: "",
    rating: "",
    num: i + 1,
  }));
  return {
    count,
    groups: [{ id: "G", name: "G", count }],
    pieces: Array.from({ length: Math.ceil(count / 1000) }, (_, i) =>
      JSON.stringify(items.slice(i * 1000, (i + 1) * 1000)),
    ),
  };
}

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal("requestIdleCallback", (work: IdleRequestCallback) =>
    setTimeout(() => work({ didTimeout: false, timeRemaining: () => 50 }), 0),
  );
  vi.stubGlobal("cancelIdleCallback", clearTimeout);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

test("aborting each piece/head write preserves the previous committed generation", async () => {
  const backend = memoryIdb();
  vi.stubGlobal("indexedDB", backend.factory);
  const cache = await import("../src/services/vodCache");
  await cache.saveResult(root, catalog("Old"));
  const values = backend.control.stores.get("values")!;
  const original = values.get(`${base}:head`);
  for (const boundary of [1, 2, 3]) {
    backend.control.puts = 0;
    backend.control.failAtPut = boundary;
    await cache.saveResult(root, catalog("New", 1001));
    expect(values.get(`${base}:head`)).toBe(original);
    cache.clearMemory();
    expect((await cache.dbGet<{ count: number }>(root))?.count).toBe(1);
    expect(JSON.parse((await cache.dbGet<string>(`${root}#0`))!)[0].name).toBe("Old");
  }
});

test("complete refresh flips the pointer and cold readers validate all pieces/counts", async () => {
  const backend = memoryIdb();
  vi.stubGlobal("indexedDB", backend.factory);
  const cache = await import("../src/services/vodCache");
  await cache.saveResult(root, catalog("Old"));
  const old = backend.control.stores.get("values")!.get(`${base}:head`);
  await cache.saveResult(root, catalog("New", 1001));
  expect(backend.control.stores.get("values")!.get(`${base}:head`)).not.toBe(old);
  cache.clearMemory();
  expect((await cache.dbGet<{ count: number }>(root))?.count).toBe(1001);
  expect(JSON.parse((await cache.dbGet<string>(`${root}#1`))!)).toHaveLength(1);
});

test("name-keyed schema-1 category heads are refetched instead of reused as provider IDs", async () => {
  const backend = memoryIdb();
  vi.stubGlobal("indexedDB", backend.factory);
  const cache = await import("../src/services/vodCache");
  await cache.saveResult(root, catalog("Old"));
  const values = backend.control.stores.get("values")!;
  const head = JSON.parse(values.get(`${base}:head`) as string);
  values.set(`${base}:head`, JSON.stringify({ ...head, schema: 1 }));
  cache.clearMemory();
  expect(await cache.getResult(root)).toBeNull();
  await cache.saveResult(root, catalog("Replacement"));
  cache.clearMemory();
  expect(JSON.parse((await cache.getResult(root))!.result.pieces[0])[0].name).toBe(
    "Replacement",
  );
});

test("an in-progress reader keeps its complete snapshot when another refresh publishes", async () => {
  vi.stubGlobal("indexedDB", undefined);
  const cache = await import("../src/services/vodCache");
  await cache.saveResult(root, catalog("Old"));
  const old = (await cache.getResult(root))!;
  await cache.saveResult(root, catalog("New"));
  const next = (await cache.getResult(root))!;
  expect(JSON.parse(old.result.pieces[0])[0].name).toBe("Old");
  cache.releaseResult(root, old.result);
  expect((await cache.getResult(root))?.result).toBe(next.result);
});

test.each(["missing", "corrupt", "read-failure", "count"])(
  "%s pieces cannot produce a successful partial catalog",
  async (fault) => {
    const backend = memoryIdb();
    vi.stubGlobal("indexedDB", backend.factory);
    const cache = await import("../src/services/vodCache");
    await cache.saveResult(root, catalog("Movie", 1001));
    cache.clearMemory();
    const values = backend.control.stores.get("values")!;
    const head = JSON.parse(values.get(`${base}:head`) as string);
    const key = `${base}:g:${head.generation}:1`;
    if (fault === "missing") values.delete(key);
    if (fault === "corrupt") values.set(key, "[");
    if (fault === "read-failure") backend.control.failReadKey = key;
    if (fault === "count") values.set(key, "[]");
    expect(await cache.dbGet(root)).toBeNull();
  },
);

test("old plus staging exceeding the budget refuses publication without evicting protected content", async () => {
  const backend = memoryIdb();
  vi.stubGlobal("indexedDB", backend.factory);
  const disk = await import("../src/services/disk");
  const large = "x".repeat(7 * 1024 * 1024); // 14 MiB each.
  expect(await disk.write("old", large)).toBe(true);
  expect(await disk.writeBatch([{ key: "new", value: large }], ["old"])).toBe(false);
  expect((await disk.read("old"))?.length).toBe(large.length);
  expect(await disk.read("new")).toBeNull();
  expect((await disk.usage()).bytes).toBeLessThanOrEqual(disk.BUDGET_BYTES);
});

test("blocked or never-answering IDB opens settle without hanging callers", async () => {
  vi.useFakeTimers();
  const backend = memoryIdb();
  backend.control.hangOpen = true;
  vi.stubGlobal("indexedDB", backend.factory);
  const disk = await import("../src/services/disk");
  const reading = disk.read("missing");
  await vi.advanceTimersByTimeAsync(disk.IDB_TIMEOUT_MS + 1);
  expect(await reading).toBeNull();
});

test("a never-completing write transaction aborts and releases the mutation queue", async () => {
  vi.useFakeTimers();
  const backend = memoryIdb();
  backend.control.hangTransactions = true;
  vi.stubGlobal("indexedDB", backend.factory);
  const disk = await import("../src/services/disk");
  const writing = disk.write("stuck", "value");
  await vi.advanceTimersByTimeAsync(disk.IDB_TIMEOUT_MS + 50);
  expect(await writing).toBe(false);
  backend.control.hangTransactions = false;
  const retry = disk.write("retry", "good");
  await vi.advanceTimersByTimeAsync(50);
  expect(await retry).toBe(true);
});

test("restart cleanup removes abandoned pieces without deleting the current generation", async () => {
  const backend = memoryIdb();
  vi.stubGlobal("indexedDB", backend.factory);
  const cache = await import("../src/services/vodCache");
  const vodDisk = await import("../src/services/vodDisk");
  await cache.saveResult(root, catalog("Current"));
  await vodDisk.write(`${base}:g:abandoned:0`, "[]");
  await cache.cleanupAbandonedCatalogs();
  expect(await vodDisk.read(`${base}:g:abandoned:0`)).toBeNull();
  cache.clearMemory();
  expect((await cache.dbGet<{ count: number }>(root))?.count).toBe(1);
});
