import { POSTER_WIDTH, POSTER_HEIGHT } from "./vodMetrics";

export const POSTER_CACHE_BYTES = 8 * 1024 * 1024;
export const POSTER_DECODE_LANES = 2;
const MAX_ENTRIES = 48;
const IMAGE_TIMEOUT = 8000;
type Entry = {
  url: string;
  listeners: Set<() => void>;
  image?: HTMLCanvasElement;
  failedAt?: number;
  cancel?: () => void;
  delivered?: boolean;
};

/** Two source images at a time, reduced to a fixed surface. Releasing the last
 * consumer stops queued/active work. No persistence or lazy-image dependency.
 * Native original-image decode costs remain browser/provider dependent; retained
 * surfaces, mounted canvases and active source-image counts are deterministic. */
export class PosterPool {
  private entries = new Map<string, Entry>();
  private active = 0;
  constructor(private readonly makeImage: () => HTMLImageElement = () => new Image()) {}
  get stats() {
    return {
      active: this.active,
      entries: this.entries.size,
      decoded: [...this.entries.values()].filter((e) => e.image).length,
      bytes: [...this.entries.values()].reduce(
        (sum, e) => sum + (e.image ? POSTER_WIDTH * POSTER_HEIGHT * 4 : 0),
        0,
      ),
    };
  }
  peek(url: string): HTMLCanvasElement | undefined {
    return this.entries.get(url)?.image;
  }
  subscribe(url: string, listener: () => void): () => void {
    let entry = this.entries.get(url);
    if (!entry) {
      if (this.entries.size >= MAX_ENTRIES) {
        const unused = [...this.entries].find(
          ([, value]) => !value.listeners.size && !value.cancel,
        );
        if (unused) this.entries.delete(unused[0]);
        else return () => {};
      }
      entry = { url, listeners: new Set() };
      this.entries.set(url, entry);
    } else {
      this.entries.delete(url);
      this.entries.set(url, entry);
    }
    if (entry.failedAt !== undefined && Date.now() - entry.failedAt >= 30000)
      entry.failedAt = undefined;
    entry.listeners.add(listener);
    if (!entry.image && entry.failedAt === undefined && !entry.cancel) entry.delivered = false;
    this.trim();
    this.pump();
    const owned = entry;
    return () => {
      owned.listeners.delete(listener);
      if (!owned.listeners.size) {
        owned.cancel?.();
        if (!owned.image && owned.failedAt === undefined) this.entries.delete(url);
      }
      this.trim();
      this.pump();
    };
  }
  private trim() {
    let bytes = this.stats.bytes;
    for (const [key, entry] of this.entries) {
      if (bytes <= POSTER_CACHE_BYTES && this.entries.size <= MAX_ENTRIES) break;
      if (entry.cancel) continue;
      // Consumers already drew their own bounded canvas; evicting this reusable
      // copy does not remove the visible artwork.
      if (entry.image) bytes -= POSTER_WIDTH * POSTER_HEIGHT * 4;
      entry.image = undefined;
      if (!entry.listeners.size) this.entries.delete(key);
    }
  }
  private pump() {
    for (const entry of this.entries.values()) {
      if (this.active >= POSTER_DECODE_LANES) break;
      if (
        entry.image ||
        entry.delivered ||
        entry.failedAt !== undefined ||
        entry.cancel ||
        !entry.listeners.size
      )
        continue;
      this.start(entry);
    }
  }
  private start(entry: Entry) {
    this.active++;
    const image = this.makeImage();
    let finished = false;
    const finish = (success: boolean, cancelled = false) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      image.onload = image.onerror = null;
      if (success && entry.listeners.size) {
        try {
          if (!image.naturalWidth || !image.naturalHeight) throw new Error("Empty poster");
          const canvas = document.createElement("canvas");
          canvas.width = POSTER_WIDTH;
          canvas.height = POSTER_HEIGHT;
          const context = canvas.getContext("2d");
          if (!context) throw new Error("Poster canvas unavailable");
          const fit = Math.min(
            POSTER_WIDTH / image.naturalWidth,
            POSTER_HEIGHT / image.naturalHeight,
          );
          const width = image.naturalWidth * fit;
          const height = image.naturalHeight * fit;
          context.drawImage(
            image,
            (POSTER_WIDTH - width) / 2,
            (POSTER_HEIGHT - height) / 2,
            width,
            height,
          );
          entry.image = canvas;
        } catch {
          entry.failedAt = Date.now();
        }
      } else if (!cancelled) entry.failedAt = Date.now();
      image.src = "";
      entry.delivered = !cancelled;
      entry.cancel = undefined;
      this.active--;
      for (const listener of entry.listeners) listener();
      this.trim();
      this.pump();
    };
    const timer = setTimeout(() => finish(false), IMAGE_TIMEOUT);
    entry.cancel = () => finish(false, true);
    image.onload = () => finish(true);
    image.onerror = () => finish(false);
    image.src = entry.url;
  }
}
export const posters = new PosterPool();
