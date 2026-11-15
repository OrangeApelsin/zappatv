import { expect, test, vi } from "vitest";
import {
  CatalogIndex,
  INGEST_BATCH_SIZE,
  INDEX_BATCH_SIZE,
} from "../src/services/catalogIndex";
import { catalogController } from "../src/services/catalogCancellation";
import { readWhole } from "../src/workers/vodWorker";

test.each([10000, 20000])(
  "%i items use bounded ingestion/sorting and reusable reference indexes",
  async (count) => {
    const groups = [
      { category_id: "a", category_name: "Same" },
      { category_id: "b", category_name: "Same" },
      { category_id: "empty", category_name: "Empty" },
    ];
    const raw = Array.from({ length: count }, (_, id) => ({
      stream_id: id + 1,
      name: `Film ${String(count - id).padStart(5, "0")}`,
      category_id: id % 2 ? "a" : "b",
      container_extension: "mkv",
      added: id,
      year: 2000 + (id % 20),
      rating: id % 10,
    }));
    const parsed = readWhole(new TextEncoder().encode(JSON.stringify(raw)), "vod", groups);
    const owner = new CatalogIndex("index-source", "movie", parsed.groups);
    for (const piece of parsed.pieces) {
      const items = JSON.parse(piece);
      for (let start = 0; start < items.length; start += INGEST_BATCH_SIZE)
        owner.add(items.slice(start, start + INGEST_BATCH_SIZE));
    }
    await owner.finish(catalogController().signal);
    expect(owner.maxIngestBatch).toBe(250);
    expect(owner.maxIndexBatch).toBeLessThanOrEqual(INDEX_BATCH_SIZE);
    expect(owner.groups.map((group) => [group.id, group.count])).toEqual([
      ["a", count / 2],
      ["b", count / 2],
      ["empty", 0],
    ]);
    const byName = owner.query(null, "name");
    const byAdded = owner.query("a", "added");
    expect(byName[0].name).toBe("Film 00001");
    expect(byAdded[0].added).toBe(count - 1);
    expect(owner.query("empty")).toEqual([]);
    expect(owner.byKey.get(byName[0].key)).toBe(byName[0]);
    expect(byName[0].extension).toBe("mkv");
    const sort = vi.spyOn(Array.prototype, "sort");
    for (let i = 0; i < 20; i++) {
      expect(owner.query(null, "name")).toBe(byName);
      expect(owner.query("a", "added")).toBe(byAdded);
    }
    expect(sort).not.toHaveBeenCalled();
    sort.mockRestore();
    expect(owner.search("film 00001")[0]).toBe(byName[0]);
    expect(owner.availableLetters(byName)).toEqual(new Set(["F"]));
  },
  20000,
);

test("cancelling index construction cannot publish a complete owner", async () => {
  const controller = catalogController();
  const owner = new CatalogIndex("cancel-index", "movie", []);
  for (let i = 0; i < 10; i++)
    owner.add(
      Array.from({ length: 250 }, (_, id) => ({
        kind: "movie",
        streamId: String(i * 250 + id),
        name: "Movie",
        skey: "movie",
        key: "",
        logo: "",
        group: "",
        num: 1,
        rating: "",
      })),
    );
  const task = owner.finish(controller.signal);
  const rejected = expect(task).rejects.toMatchObject({ name: "AbortError" });
  controller.abort();
  await rejected;
  expect(owner.completedAt).toBe(0);
});

test("default title order and A-Z buckets agree for accents, punctuation, numbers and Arabic", async () => {
  const names = ["Zulu", "beta", "123", "العربية", "Örebro", "Äpple", "Alpha", '"Åland"'];
  const parsed = readWhole(
    new TextEncoder().encode(
      JSON.stringify(
        names.map((name, id) => ({
          stream_id: id + 1,
          name,
          category_id: id % 2 ? "a" : "b",
          added: id,
        })),
      ),
    ),
    "vod",
    [],
  );
  const owner = new CatalogIndex("letters", "movie", parsed.groups);
  for (const piece of parsed.pieces) owner.add(JSON.parse(piece));
  await owner.finish(catalogController().signal);
  const ordered = owner.query();
  expect(ordered.map((item) => item.name)).toEqual([
    '"Åland"',
    "Alpha",
    "Äpple",
    "beta",
    "Örebro",
    "Zulu",
    "123",
    "العربية",
  ]);
  expect(owner.letterIndex(ordered, "A")).toBe(0);
  expect(owner.letterIndex(ordered, "O")).toBe(4);
  expect(owner.letterIndex(ordered, "#")).toBe(6);
  expect(owner.letterIndex(ordered, "X")).toBe(-1);
  const subset = ordered.filter((item) => item.name !== "Alpha");
  expect(owner.letterIndex(subset, "B")).toBe(2);
  expect(owner.query("a").map((item) => item.name)).toEqual([
    '"Åland"',
    "Äpple",
    "beta",
    "العربية",
  ]);
});

test("equal normalized titles use stable canonical identity rather than provider order", async () => {
  const orders: string[][] = [];
  for (const ids of [
    [10, 2],
    [2, 10],
  ]) {
    const parsed = readWhole(
      new TextEncoder().encode(
        JSON.stringify(ids.map((id) => ({ stream_id: id, name: "Same title" }))),
      ),
      "vod",
      [],
    );
    const owner = new CatalogIndex("duplicates", "movie", parsed.groups);
    for (const piece of parsed.pieces) owner.add(JSON.parse(piece));
    await owner.finish(catalogController().signal);
    orders.push(owner.query().map((item) => item.streamId!));
  }
  expect(orders).toEqual([
    ["2", "10"],
    ["2", "10"],
  ]);
});
