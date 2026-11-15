/** Check at the existing bounded work quanta, but yield the event loop only when
 * the time budget is spent. A timer per tiny batch incurs Chromium's 4ms clamp
 * thousands of times, even when each batch takes a fraction of a millisecond. */
export const CATALOG_SLICE_MS = 4;
export function catalogYield() {
  let start = performance.now();
  return async () => {
    if (performance.now() - start < CATALOG_SLICE_MS) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    start = performance.now();
  };
}
