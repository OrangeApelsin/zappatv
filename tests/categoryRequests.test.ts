import { afterEach, expect, test, vi } from "vitest";
import { categoryRequest } from "../src/services/categoryRequests";
const rows = [{ key: "movie:1", id: "1", kind: "movie" as const, name: "Movies" }];
afterEach(() => vi.useRealTimers());

test("oversized category headings fail explicitly and preserve the previous valid headings", async () => {
  await categoryRequest("oversize-headings:movie", async () => rows);
  await expect(
    categoryRequest(
      "oversize-headings:movie",
      async () => [{ ...rows[0], name: "x".repeat(2 * 1024 * 1024) }],
      undefined,
      true,
    ),
  ).rejects.toThrow("memory limit");
  expect(await categoryRequest("oversize-headings:movie", async () => [])).toBe(rows);
});

test("source-scoped headings deduplicate concurrent live and VOD subscribers with independent cancellation", async () => {
  let complete!: (value: typeof rows) => void;
  let underlying!: AbortSignal;
  const load = vi.fn((signal: AbortSignal) => {
    underlying = signal;
    return new Promise<typeof rows>((resolve) => {
      complete = resolve;
    });
  });
  const a = new AbortController();
  const b = new AbortController();
  const first = categoryRequest("shared-category-source:movie", load, a.signal);
  const rejected = expect(first).rejects.toMatchObject({ name: "AbortError" });
  const second = categoryRequest("shared-category-source:movie", load, b.signal);
  await Promise.resolve();
  a.abort();
  await rejected;
  expect(underlying.aborted).toBe(false);
  complete(rows);
  expect(await second).toBe(rows);
  expect(await categoryRequest("shared-category-source:movie", load)).toBe(rows);
  expect(load).toHaveBeenCalledOnce();
  expect(await categoryRequest("different-category-source:movie", async () => [])).toEqual([]);
});
test("last cancellation stops headings transport, discards late data and permits immediate retry", async () => {
  let signal!: AbortSignal;
  let late!: (value: typeof rows) => void;
  const a = new AbortController();
  const first = categoryRequest(
    "cancel-category-source:movie",
    (owned) => {
      signal = owned;
      return new Promise<typeof rows>((resolve) => {
        late = resolve;
      });
    },
    a.signal,
  );
  const rejected = expect(first).rejects.toMatchObject({ name: "AbortError" });
  await Promise.resolve();
  a.abort();
  await rejected;
  expect(signal.aborted).toBe(true);
  expect(await categoryRequest("cancel-category-source:movie", async () => [])).toEqual([]);
  late(rows);
  await Promise.resolve();
  expect(await categoryRequest("cancel-category-source:movie", async () => rows)).toEqual([]);
});
test("a hung category transport reaches its deadline and failures preserve prior headings", async () => {
  vi.useFakeTimers();
  await categoryRequest("deadline-category-source:movie", async () => rows);
  let signal!: AbortSignal;
  const hung = categoryRequest(
    "deadline-category-source:movie",
    (owned) => {
      signal = owned;
      return new Promise(() => {});
    },
    undefined,
    true,
  );
  const rejected = expect(hung).rejects.toMatchObject({ name: "AbortError" });
  await vi.advanceTimersByTimeAsync(30000);
  await rejected;
  expect(signal.aborted).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
  expect(await categoryRequest("deadline-category-source:movie", async () => [])).toBe(rows);
});
