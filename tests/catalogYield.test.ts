import { afterEach, expect, test, vi } from "vitest";
import {
  catalogTimings,
  resetCatalogTimings,
  startCatalogTiming,
} from "../src/services/catalogTiming";
import { CATALOG_SLICE_MS, catalogYield } from "../src/services/catalogYield";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

test("catalogue work yields after its time budget rather than sleeping at every checkpoint", async () => {
  vi.useFakeTimers();
  let time = 0;
  vi.spyOn(performance, "now").mockImplementation(() => time);
  const checkpoint = catalogYield();
  for (let index = 0; index < 20; index++) await checkpoint();
  expect(vi.getTimerCount()).toBe(0);
  time = CATALOG_SLICE_MS;
  const yielded = checkpoint();
  expect(vi.getTimerCount()).toBe(1);
  await vi.advanceTimersByTimeAsync(0);
  await yielded;
  time += CATALOG_SLICE_MS - 1;
  await checkpoint();
  expect(vi.getTimerCount()).toBe(0);
});

test("phase diagnostics retain only one sanitized snapshot per kind and cache mode", () => {
  for (let iteration = 0; iteration < 12; iteration++) {
    for (const kind of ["movie", "series"] as const) {
      for (const mode of ["network", "disk", "memory"] as const) {
        const timing = startCatalogTiming(kind);
        timing.record.mode = mode;
        timing.record.count = 51881;
        timing.phase("index");
        timing.publish("ready");
      }
    }
  }
  expect(catalogTimings()).toHaveLength(6);
  const copy = catalogTimings();
  copy[0].phases.index = -1;
  expect(catalogTimings()[0].phases.index).toBeGreaterThanOrEqual(0);
  expect(Object.keys(copy[0]).sort()).toEqual([
    "count",
    "kind",
    "mode",
    "phases",
    "status",
    "totalMs",
  ]);
  const stale = startCatalogTiming("movie");
  resetCatalogTimings();
  stale.publish("ready");
  expect(catalogTimings()).toEqual([]);
});
