import { saveResult } from "../src/services/vodCache";
import { afterEach, expect, test, vi } from "vitest";
import { CatalogParser } from "../src/workers/catalogParser";
import { readList, readWhole, readCategories, SLICE_SIZE } from "../src/workers/vodWorker";
import { VodPrefetchService } from "../src/services/vodPrefetch";
import { shapedMovie } from "../src/services/vodAdapters";

const bytes = (text: string) => new TextEncoder().encode(text);
afterEach(() => vi.unstubAllGlobals());

test("malformed category responses fail instead of publishing a successful ungrouped catalog", () => {
  for (const payload of ['[{"category_id":1}', "{}", "[null]"])
    expect(() => readCategories(payload)).toThrow();
  expect(readCategories('[{"category_id":1,"category_name":"Movies"}]')).toHaveLength(1);
});

test("provider category names cannot collide with object prototypes", async () => {
  const result = await readList(bytes('[{"stream_id":1,"category_id":"__proto__"}]'), "vod", [
    { category_id: "__proto__", category_name: "constructor" },
  ]);
  expect(result.groups).toEqual([{ id: "__proto__", name: "constructor", count: 1 }]);
});

test.each([
  '[{"stream_id":1}',
  '[{"stream_id":1},',
  '[{"stream_id":1}] trailing',
  '[{"stream_id":1},]',
  '[{"stream_id":1}{"stream_id":2}]',
  '{"stream_id":1}',
  "[null]",
  "[1]",
  '[{"stream_id":{}}]',
  '[{"name":"Missing ID"}]',
  '[{"stream_id":1,"name":"unfinished}]',
  "",
])("stream and whole parsers reject incomplete or invalid catalogs: %s", async (payload) => {
  await expect(readList(bytes(payload), "vod", [])).rejects.toThrow();
  expect(() => readWhole(bytes(payload), "vod", [])).toThrow();
});

test("array framing handles nested objects, escaped quotes and every character boundary", () => {
  const input = [{ stream_id: 1, name: 'A \\" [ ] { } 🎬', info: { nested: [1, { x: "}" }] } }];
  const records: unknown[] = [];
  const parser = new CatalogParser((item) => records.push(item));
  for (const char of JSON.stringify(input)) parser.feed(char);
  parser.finish();
  expect(records).toEqual(input);
});

test.each([false, true])(
  "Unicode spanning slices remains correct with fallback=%s",
  async (fallback) => {
    const prefix = '[{"stream_id":1,"name":"';
    const name = `${"x".repeat(SLICE_SIZE - bytes(prefix).length - 1)}🎬العربية åäö`;
    const payload = bytes(`${prefix}${name}"}]`);
    if (fallback) vi.stubGlobal("TextDecoder", undefined);
    const result = await readList(payload, "vod", []);
    expect(JSON.parse(result.pieces[0])[0].name).toBe(name);
    expect(readWhole(payload, "vod", []).count).toBe(1);
  },
);

test.each([false, true])("invalid UTF-8 fails with fallback=%s", async (fallback) => {
  const payload = new Uint8Array([
    ...bytes('[{"stream_id":1,"name":"'),
    0xf0,
    0x80,
    0x80,
    0x80,
    ...bytes('"}]'),
  ]);
  if (fallback) vi.stubGlobal("TextDecoder", undefined);
  await expect(readList(payload, "vod", [])).rejects.toThrow();
});

test("empty catalog succeeds and failed refresh never replaces an existing catalog", async () => {
  vi.stubGlobal("Worker", undefined);
  expect((await readList(bytes("\uFEFF [] \n"), "vod", [])).count).toBe(0);
  const service = new VodPrefetchService();
  await service.read({
    playlistId: "validation",
    kind: "vod",
    buffer: bytes('[{"stream_id":1,"name":"Good"}]').buffer,
  });
  await expect(
    service.read({
      playlistId: "validation",
      kind: "vod",
      buffer: bytes('[{"stream_id":2}').buffer,
    }),
  ).rejects.toThrow();
  expect((await service.take("validation", "vod")).items.map((item) => item.name)).toEqual([
    "Good",
  ]);
  await expect(
    saveResult("invalid-count", { count: 9, groups: [], pieces: [] }),
  ).rejects.toThrow();
});

test.each(["mkv", "mp4"])(
  "movie adapter retains %s identity/category/container and builds no URL",
  (ext) => {
    const item = shapedMovie({
      kind: "movie",
      key: "xtream:source:movie:1",
      streamId: "1",
      name: "Movie",
      skey: "movie",
      logo: "",
      group: "Label",
      categoryId: "17",
      num: 1,
      rating: "8",
      ext,
    });
    expect(item).toMatchObject({
      key: "xtream:source:movie:1",
      extension: ext,
      categoryKey: "movie:17",
      streamId: "1",
    });
    expect(item).not.toHaveProperty("url");
  },
);
