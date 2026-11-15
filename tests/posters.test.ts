import { afterEach, expect, test, vi } from "vitest";
import { PosterPool, POSTER_CACHE_BYTES } from "../src/services/posters";
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});
class ImageStub {
  src = "";
  naturalWidth = 1000;
  naturalHeight = 1500;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
}
test("poster work has two lanes, bounded surfaces, cancelled offscreen jobs and no late artwork", () => {
  vi.useFakeTimers();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    drawImage: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
  const images: ImageStub[] = [];
  const pool = new PosterPool(() => {
    const image = new ImageStub();
    images.push(image);
    return image as unknown as HTMLImageElement;
  });
  const releases = Array.from({ length: 20000 }, (_, i) =>
    pool.subscribe(`poster-${i}`, vi.fn()),
  );
  expect(pool.stats.active).toBe(2);
  expect(images).toHaveLength(2);
  expect(pool.stats.entries).toBeLessThanOrEqual(48);
  const late = images[0].onload;
  releases[0]();
  expect(images[0].src).toBe("");
  late?.();
  expect(pool.peek("poster-0")).toBeUndefined();
  let position = 1;
  while (position < images.length) images[position++].onload?.();
  expect(pool.stats.bytes).toBeLessThanOrEqual(POSTER_CACHE_BYTES);
  expect(pool.stats.decoded).toBeLessThanOrEqual(32);
  for (const release of releases) release();
  expect(pool.stats.active).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
});
test("poster errors and deadlines release lanes and leave a usable fallback", () => {
  vi.useFakeTimers();
  const images: ImageStub[] = [];
  const pool = new PosterPool(() => {
    const image = new ImageStub();
    images.push(image);
    return image as unknown as HTMLImageElement;
  });
  const listener = vi.fn();
  const first = pool.subscribe("bad", listener);
  const second = pool.subscribe("silent", listener);
  images[0].onerror?.();
  vi.advanceTimersByTime(8000);
  expect(pool.stats.active).toBe(0);
  expect(listener).toHaveBeenCalledTimes(2);
  expect(pool.peek("bad")).toBeUndefined();
  first();
  second();
});

test("a released grid poster is reusable by a list consumer without another decode", () => {
  vi.useFakeTimers();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    drawImage: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
  const images: ImageStub[] = [];
  const pool = new PosterPool(() => {
    const image = new ImageStub();
    images.push(image);
    return image as unknown as HTMLImageElement;
  });
  const leaveGrid = pool.subscribe("shared-artwork", vi.fn());
  images[0].onload?.();
  const surface = pool.peek("shared-artwork");
  expect(surface).toBeTruthy();
  leaveGrid();
  const leaveList = pool.subscribe("shared-artwork", vi.fn());
  expect(pool.peek("shared-artwork")).toBe(surface);
  expect(images).toHaveLength(1);
  expect(pool.stats.active).toBe(0);
  leaveList();
});
