import { catalogController, throwIfAborted } from "../services/catalogCancellation";
import { httpRequest, MAX_CATALOG_BYTES } from "../services/catalogTransport";
import { CatalogDecoder, CatalogParser } from "./catalogParser";
import type { CatalogProgress, CatalogRequest, CatalogResponse } from "./catalogProtocol";
/**
 * vodWorker.ts — High-Performance Streaming ArrayBuffer VOD Parser & Chunking Engine
 *
 * Adapted from AquaPlay's battle-tested vodwork.js for Samsung Tizen Smart TVs.
 *
 * Key Architectural Optimizations:
 * 1. Slices 256KB ArrayBuffer chunks via streaming TextDecoder without allocating whole JSON string.
 * 2. Incremental bracket-depth parser parses individual JSON objects on the fly.
 * 3. Event-loop yielding (6ms setTimeout) bounds fallback parsing work; TV performance needs hardware checks.
 * 4. Chunks 1000 records per piece; only the main-thread owner persists complete validated results.
 * 5. Can run both inside a DedicatedWorkerGlobalScope and directly on the main thread as fallback.
 */

export const PIECE_SIZE = 1000;
export const SLICE_SIZE = 262144; // 256 KB
export const REST_MS = 6;

const PUNCT_REGEX = /[\s\-_.,:;!?'"()[\]{}/\\|+*&^%$#@~`<>=‐-‧‰-⁞]+/g;

export interface RawCategory {
  category_id?: string | number;
  category_name?: string;
  name?: string;
}

export function readCategories(text: string): RawCategory[] {
  const value: unknown = JSON.parse(text.replace(/^\uFEFF/, "").trim());
  if (
    !Array.isArray(value) ||
    value.some(
      (item) =>
        !item ||
        typeof item !== "object" ||
        (typeof item.category_id !== "string" && typeof item.category_id !== "number"),
    )
  )
    throw new Error("Invalid catalog categories");
  return value;
}

export interface VodGroup {
  id: string;
  name: string;
  count: number;
}

export interface ShapedVodItem {
  kind: "movie" | "series";
  name: string;
  skey: string;
  key: string;
  streamId?: string;
  seriesId?: string;
  logo: string;
  group: string;
  categoryId?: string;
  num: number;
  ext?: string;
  rating: string;
  year?: string;
  added?: number;
  tmdb?: number;
  plot?: string;
  genre?: string;
  url?: string;
}

export interface VodMeta {
  t: number;
  count: number;
  groups: VodGroup[];
  n: number; // number of pieces
}

export interface ReadResult {
  timings?: { transfer: number; parse: number; providerResponse?: number; download?: number };
  count: number;
  groups: VodGroup[];
  pieces: string[]; // JSON serialized arrays of ShapedVodItem[]
}

export function searchKey(name: string | null | undefined): string {
  return String(name || "")
    .toLowerCase()
    .replace(PUNCT_REGEX, " ")
    .trim();
}

export function categoryIndex(categories: RawCategory[] | undefined): Record<string, string> {
  const index: Record<string, string> = Object.create(null);
  if (!categories) return index;
  for (const cat of categories) {
    const id = String(cat.category_id ?? "");
    const name = cat.category_name || cat.name || "";
    if (id) index[id] = name;
  }
  return index;
}

export function buildGroups(
  categories: RawCategory[] | undefined,
  groupCounts: Record<string, number>,
): VodGroup[] {
  const result: VodGroup[] = [];
  const seen = new Set<string>();
  for (const category of categories ?? []) {
    const id = String(category.category_id ?? "");
    if (seen.has(id)) continue;
    seen.add(id);
    result.push({
      id,
      name: category.category_name || category.name || "Ungrouped",
      count: groupCounts[id] ?? 0,
    });
  }
  for (const id of Object.keys(groupCounts))
    if (!seen.has(id)) result.push({ id, name: "Ungrouped", count: groupCounts[id] });
  return result;
}

export function rest(delay = REST_MS): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delay);
  });
}

export function shapeOne(
  kind: "vod" | "movie" | "series",
  catMap: Record<string, string>,
  raw: Record<string, unknown> | null | undefined,
  num: number,
  baseUrl = "",
): ShapedVodItem | null {
  if (!raw || typeof raw !== "object") return null;

  const rawCatId = String(raw.category_id ?? "");
  const group = catMap[rawCatId] || "Ungrouped";
  const name = String(raw.name || "Unnamed");
  const skey = searchKey(name);

  if (kind === "vod" || kind === "movie") {
    const rawId = raw.stream_id ?? raw.id;
    if (rawId == null) return null;
    const streamId = String(rawId);
    const ext = String(raw.container_extension || "mp4");
    const logo = String(raw.stream_icon || raw.cover || "");
    const rating = String(raw.rating || "");
    const year = raw.year ? String(raw.year) : undefined;
    const added = raw.added ? Number(raw.added) : undefined;
    const tmdbRaw = raw.tmdb ?? raw.tmdb_id;
    const tmdb = tmdbRaw ? Number(tmdbRaw) : undefined;
    void baseUrl; // Playback URLs are built only when selected, never cached.

    return {
      kind: "movie",
      name,
      skey,
      key: `v${streamId}`,
      streamId,
      logo,
      group,
      categoryId: rawCatId,
      num,
      ext,
      rating,
      year,
      added,
      tmdb,
      url: "",
    };
  }

  const rawSeriesId = raw.series_id ?? raw.id;
  if (rawSeriesId == null) return null;
  const seriesId = String(rawSeriesId);
  const logo = String(raw.cover || raw.stream_icon || "");
  const rating = String(raw.rating || "");
  const plot = String(raw.plot || "");
  const genre = String(raw.genre || "");
  const rawRelease = String(raw.releaseDate || raw.release_date || "");
  const year = raw.year ? String(raw.year) : rawRelease ? rawRelease.slice(0, 4) : undefined;
  const added = raw.last_modified ? Number(raw.last_modified) : undefined;

  return {
    kind: "series",
    name,
    skey,
    key: `s${seriesId}`,
    seriesId,
    logo,
    group,
    categoryId: rawCatId,
    num,
    rating,
    year,
    added,
    plot,
    genre,
    url: "",
  };
}

function catalogBuilder(
  kind: "vod" | "movie" | "series",
  categories: RawCategory[] | undefined,
) {
  const catMap = categoryIndex(categories);
  const groupCounts: Record<string, number> = Object.create(null);
  const pieces: string[] = [];
  let piece: ShapedVodItem[] = [];
  let count = 0;
  const seen = new Set<string>();
  const parser = new CatalogParser((raw) => {
    const id = kind === "series" ? (raw.series_id ?? raw.id) : (raw.stream_id ?? raw.id);
    if ((typeof id !== "string" && typeof id !== "number") || !String(id).trim())
      throw new Error("Invalid catalog identity");
    const item = shapeOne(kind, catMap, raw, count + 1);
    if (!item) throw new Error("Invalid catalog record");
    if (seen.has(item.key)) return;
    seen.add(item.key);
    groupCounts[item.categoryId ?? ""] = (groupCounts[item.categoryId ?? ""] ?? 0) + 1;
    piece.push(item);
    count++;
    if (piece.length === PIECE_SIZE) {
      pieces.push(JSON.stringify(piece));
      piece = [];
    }
  });
  return {
    parser,
    get count() {
      return count;
    },
    finish(): ReadResult {
      parser.finish();
      if (piece.length) pieces.push(JSON.stringify(piece));
      return { count, groups: buildGroups(categories, groupCounts), pieces };
    },
  };
}

/** Complete validation precedes cache publication, including the final bracket. */
export async function readList(
  buffer: ArrayBuffer | Uint8Array,
  kind: "vod" | "movie" | "series",
  categories: RawCategory[] | undefined,
  _baseUrl = "",
  options: { signal?: AbortSignal; onProgress?: (progress: CatalogProgress) => void } = {},
): Promise<ReadResult> {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (bytes.byteLength > MAX_CATALOG_BYTES) throw new Error("Catalog exceeds transfer limit");
  throwIfAborted(options.signal);
  const decoder = new CatalogDecoder();
  const builder = catalogBuilder(kind, categories);
  for (let offset = 0; offset < bytes.length; offset += SLICE_SIZE) {
    throwIfAborted(options.signal);
    builder.parser.feed(
      decoder.decode(bytes.subarray(offset, Math.min(bytes.length, offset + SLICE_SIZE))),
    );
    options.onProgress?.({
      loaded: builder.count,
      bytes: Math.min(bytes.length, offset + SLICE_SIZE),
      totalBytes: bytes.length,
    });
    await rest();
  }
  throwIfAborted(options.signal);
  builder.parser.feed(decoder.decode(new Uint8Array(), true));
  return builder.finish();
}

/** Synchronous fixture/helper entry uses exactly the same UTF-8/framing rules. */
export function readWhole(
  bytes: Uint8Array,
  kind: "vod" | "movie" | "series",
  categories: RawCategory[] | undefined,
  _baseUrl = "",
): ReadResult {
  const builder = catalogBuilder(kind, categories);
  builder.parser.feed(new CatalogDecoder().decode(bytes, true));
  return builder.finish();
}

// The worker owns only transport/parsing. Persistence belongs to the main
// thread and receives a complete validated result, never partial cache writes.
if (
  typeof self !== "undefined" &&
  typeof (self as unknown as Worker).postMessage === "function" &&
  typeof window === "undefined"
) {
  const active = new Map<
    number,
    { generation: number; controller: ReturnType<typeof catalogController> }
  >();
  const post = (response: CatalogResponse) => (self as unknown as Worker).postMessage(response);
  self.onmessage = (event: MessageEvent) => {
    const data = event.data as
      | CatalogRequest
      | { op: "cancel"; id: number; generation: number };
    if (!data || !Number.isInteger(data.id) || !Number.isInteger(data.generation)) return;
    if (data.op === "cancel") {
      const request = active.get(data.id);
      if (request?.generation === data.generation) request.controller.abort();
      return;
    }
    const controller = catalogController();
    active.set(data.id, { generation: data.generation, controller });
    void (async () => {
      const identity = { id: data.id, generation: data.generation, key: data.key };
      try {
        const transferStart = performance.now();
        let transportTiming: { providerResponse: number; download: number } | undefined;
        let buffer: ArrayBuffer;
        let cats = data.cats;
        if (data.op === "fetch") {
          cats ??= readCategories(
            String(await httpRequest(String(data.catsUrl), "text", 30000, controller.signal)),
          );
          buffer = (await httpRequest(
            String(data.listUrl),
            "arraybuffer",
            90000,
            controller.signal,
            (timing) => {
              transportTiming = timing;
            },
            (progress) =>
              post({
                type: "progress",
                ...identity,
                ...progress,
                loaded: 0,
                phase: "download",
              }),
          )) as ArrayBuffer;
        } else if (data.op === "read" && data.buf instanceof ArrayBuffer) buffer = data.buf;
        else throw new Error("Invalid catalog request");
        const parseStart = performance.now();
        const result = await readList(buffer, data.kind, cats, "", {
          signal: controller.signal,
          onProgress: (progress) =>
            post({ type: "progress", ...identity, ...progress, phase: "parse" }),
        });
        throwIfAborted(controller.signal);
        result.timings = {
          ...transportTiming,
          transfer: parseStart - transferStart,
          parse: performance.now() - parseStart,
        };
        post({ type: "success", ...identity, result });
      } catch (error) {
        const name = error instanceof Error ? error.name : "";
        post({
          type: "error",
          ...identity,
          code: controller.signal.aborted
            ? "cancelled"
            : name === "CatalogNetworkError"
              ? "network"
              : name === "DataCloneError"
                ? "unavailable"
                : "invalid",
        });
      } finally {
        active.delete(data.id);
      }
    })();
  };
  post({ type: "ready", ready: true });
}
