/** Main-thread VOD cache owner. Workers may parse/fetch, but never open IDB. */

import type { ReadResult, ShapedVodItem, VodMeta } from "../workers/vodWorker";
import { catalogYield } from "./catalogYield";
import * as vodDisk from "./vodDisk";
import { whenIdle } from "./idle";
import { mediaKey } from "./mediaIdentity";

export const MEMORY_BUDGET_BYTES = 24 * 1024 * 1024;

export class BoundedMemoryCache {
  private values = new Map<string, string>();
  private bytes = 0;
  constructor(private readonly budget = MEMORY_BUDGET_BYTES) {}
  get(key: string): string | null {
    const value = this.values.get(key);
    if (value === undefined) return null;
    this.values.delete(key);
    this.values.set(key, value);
    return value;
  }
  put(key: string, value: string): boolean {
    if (value.length * 2 > this.budget) return false;
    this.drop((candidate) => candidate === key);
    while (this.bytes + value.length * 2 > this.budget) {
      const oldest = this.values.keys().next().value;
      if (oldest === undefined) return false;
      this.drop((candidate) => candidate === oldest);
    }
    this.values.set(key, value);
    this.bytes += value.length * 2;
    return true;
  }
  putBatch(
    records: readonly { key: string; value: string }[],
    protectedKeys: readonly string[],
  ): boolean {
    const fresh = new Map(this.values);
    const incoming = new Set(records.map((record) => record.key));
    if (incoming.size !== records.length) return false;
    for (const key of incoming) fresh.delete(key);
    const protectedSet = new Set(protectedKeys);
    let bytes =
      [...fresh.values()].reduce((sum, value) => sum + value.length * 2, 0) +
      records.reduce((sum, record) => sum + record.value.length * 2, 0);
    for (const [key, value] of fresh) {
      if (bytes <= this.budget) break;
      if (protectedSet.has(key)) continue;
      fresh.delete(key);
      bytes -= value.length * 2;
    }
    if (bytes > this.budget) return false;
    for (const record of records) fresh.set(record.key, record.value);
    this.values = fresh;
    this.bytes = bytes;
    return true;
  }

  drop(predicate: (key: string) => boolean): void {
    for (const [key, value] of this.values)
      if (predicate(key)) {
        this.values.delete(key);
        this.bytes -= value.length * 2;
      }
  }
  usage(): number {
    return this.bytes;
  }
}

const memory = new BoundedMemoryCache();
// At most one parsed handoff per kind, consumed by take(). This is in-flight
// fetched data, separate from the 24 MB reusable memory/disk caches. A finite
// bound permits catalogs larger than the cache without an unbounded fallback.
export const HANDOFF_LIMIT_BYTES = 128 * 1024 * 1024;
const handoffs = new Map<string, { result: ReadResult; meta: VodMeta }>();
const epochs = new Map<string, number>();
const storageKey = (key: string): string => {
  const piece = key.indexOf("#");
  const root = piece < 0 ? key : key.slice(0, piece);
  const suffix = piece < 0 ? "" : key.slice(piece);
  const split = root.indexOf(":");
  if (split < 0) return `vod-cache:${root}${suffix}`;
  return `xtream:${root.slice(split + 1)}:catalog:${root.slice(0, split)}${suffix}`;
};
const idle = (work: () => Promise<boolean>) =>
  new Promise<boolean>((resolve) => {
    if (typeof window === "undefined") {
      void work().then(resolve, () => resolve(false));
      return;
    }
    whenIdle(() => {
      void work().then(resolve, () => resolve(false));
    }, 1000);
  });

export async function dbGet<T>(key: string): Promise<T | null> {
  for (const [root, held] of handoffs) {
    if (key === root) return held.meta as T;
    if (key.startsWith(`${root}#`))
      return (held.result.pieces[Number(key.slice(root.length + 1))] ?? null) as T | null;
  }
  const split = key.indexOf("#");
  const root = split < 0 ? key : key.slice(0, split);
  const catalog = await readCommitted(root);
  if (catalog)
    return (
      split < 0 ? catalog.meta : (catalog.result.pieces[Number(key.slice(split + 1))] ?? null)
    ) as T | null;
  if (/^(vod|series):/.test(root)) return null;
  const text = await raw(storageKey(key));
  if (text === null) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export async function dbPut(
  key: string,
  value: unknown,
  current = () => true,
): Promise<boolean> {
  if (!current()) return false;
  const text = JSON.stringify(value);
  const accepted =
    typeof indexedDB !== "undefined" &&
    (await idle(() => vodDisk.write(storageKey(key), text, current)));
  // Memory is bounded independently, and cannot make a refused write claim
  // durability. Callers receive whether either reusable cache accepted it.
  return current() && (accepted || memory.put(storageKey(key), text));
}

async function dropStored(prefix: string): Promise<void> {
  memory.drop(
    (key) =>
      key === storageKey(prefix) ||
      key.startsWith(`${storageKey(prefix)}:`) ||
      key.startsWith(`${storageKey(prefix)}#`),
  );
  releaseResult(prefix);
  if (typeof indexedDB !== "undefined")
    await idle(async () => {
      await vodDisk.forget(
        (key) =>
          key === storageKey(prefix) ||
          key.startsWith(`${storageKey(prefix)}:`) ||
          key.startsWith(storageKey(`${prefix}#`)),
      );
      return true;
    });
}

export async function dbDrop(prefix: string): Promise<void> {
  epochs.set(prefix, (epochs.get(prefix) ?? 0) + 1);
  await queueCatalog(prefix, () => dropStored(prefix));
}

export function clearSourceMemory(playlistId: string): void {
  const owned = (key: string) =>
    ["vod", "series"].some(
      (kind) => key === `${kind}:${playlistId}` || key.startsWith(`${kind}:${playlistId}:`),
    );
  for (const [key, epoch] of epochs) if (owned(key)) epochs.set(key, epoch + 1);
  for (const key of handoffs.keys()) if (owned(key)) handoffs.delete(key);
  memory.drop((key) => key.startsWith(`xtream:${playlistId}:`));
}

export function releaseResult(key: string, expected?: ReadResult): void {
  if (!expected || handoffs.get(key)?.result === expected) handoffs.delete(key);
}
export function cancelCacheRequests(): void {
  for (const [key, epoch] of epochs) epochs.set(key, epoch + 1);
  handoffs.clear();
}
export function clearMemory(): void {
  for (const [key, epoch] of epochs) epochs.set(key, epoch + 1);
  memory.drop(() => true);
  handoffs.clear();
}
export const memoryUsage = () => memory.usage();

export async function getResult(
  key: string,
  ttl = 0,
  signal?: AbortSignal,
): Promise<{ result: ReadResult; meta: VodMeta } | null> {
  const held = handoffs.get(key) ?? (await readCommitted(key, signal));
  return held && isFresh(held.meta, ttl) ? held : null;
}

let prepared = false;
export function prepareVodCache(): void {
  if (prepared || typeof window === "undefined") return;
  prepared = true;
  whenIdle(() => {
    void cleanupAbandonedCatalogs();
  }, 3000);
}

export function isFresh(meta: VodMeta | null | undefined, ttl = 0): boolean {
  return (
    !!meta &&
    Number.isInteger(meta.count) &&
    meta.count >= 0 &&
    Number.isInteger(meta.n) &&
    meta.n >= 0 &&
    (!ttl || Date.now() - meta.t <= ttl)
  );
}

export interface CatalogHead extends VodMeta {
  schema: 2;
  generation: string;
  version?: string;
  updatedAt?: number | string;
  etag?: string;
}
let nextGeneration = 0;
const writers = new Map<string, Promise<unknown>>();
function queueCatalog<T>(key: string, work: () => Promise<T>): Promise<T> {
  const task = (writers.get(key) ?? Promise.resolve()).then(work, work);
  writers.set(key, task);
  const finish = () => {
    if (writers.get(key) === task) writers.delete(key);
  };
  void task.then(finish, finish);
  return task;
}
const headKey = (root: string) => `${storageKey(root)}:head`;
const pieceKey = (root: string, generation: string, index: number) =>
  `${storageKey(root)}:g:${generation}:${index}`;
async function raw(key: string): Promise<string | null> {
  const held = memory.get(key);
  if (held !== null) return held;
  const value = typeof indexedDB === "undefined" ? null : await vodDisk.read(key);
  return typeof value === "string" ? value : null;
}
function headFrom(text: string | null): CatalogHead | null {
  if (!text) return null;
  try {
    const head = JSON.parse(text) as CatalogHead;
    if (
      head?.schema !== 2 ||
      typeof head.generation !== "string" ||
      !/^[a-z0-9-]+$/.test(head.generation) ||
      !Number.isInteger(head.count) ||
      head.count < 0 ||
      !Number.isInteger(head.n) ||
      head.n > 10000 ||
      head.n !== Math.ceil(head.count / 1000) ||
      !Number.isFinite(head.t) ||
      !Array.isArray(head.groups) ||
      head.groups.some(
        (group) =>
          !group ||
          typeof group.id !== "string" ||
          typeof group.name !== "string" ||
          !Number.isInteger(group.count) ||
          group.count < 0,
      )
    )
      return null;
    return head;
  } catch {
    return null;
  }
}

export async function getCatalogHead(key: string): Promise<CatalogHead | null> {
  const held = handoffs.get(key);
  if (held?.meta && "generation" in held.meta) return held.meta as CatalogHead;
  return headFrom(await raw(headKey(key)));
}
function holdResult(key: string, result: ReadResult, meta: VodMeta): void {
  const kind = key.split(":")[0];
  for (const existing of handoffs.keys())
    if (existing.split(":")[0] === kind) handoffs.delete(existing);
  if (handoffs.size >= 2) handoffs.delete(handoffs.keys().next().value!);
  handoffs.set(key, { result, meta });
}
async function readCommitted(
  key: string,
  signal?: AbortSignal,
): Promise<{ result: ReadResult; meta: CatalogHead } | null> {
  const epoch = epochs.get(key) ?? 0;
  epochs.set(key, epoch);
  const head = headFrom(await raw(headKey(key)));
  if (!head) return null;
  const pieces: string[] = [];
  const yieldWork = catalogYield();
  const scope = key.slice(key.indexOf(":") + 1);
  try {
    for (let i = 0; i < head.n; i++) {
      if (signal?.aborted || epochs.get(key) !== epoch) return null;
      const text = await raw(pieceKey(key, head.generation, i));
      if (text === null) return null;
      const items = JSON.parse(text) as ShapedVodItem[];
      const expected = Math.min(1000, head.count - i * 1000);
      if (
        !Array.isArray(items) ||
        items.length !== expected ||
        items.some(
          (item) =>
            !item ||
            (item.kind !== "movie" && item.kind !== "series") ||
            item.key !== mediaKey(scope, item.kind, item.streamId ?? item.seriesId ?? "") ||
            !(item.streamId ?? item.seriesId) ||
            item.url,
        )
      )
        return null;
      pieces.push(text);
      await yieldWork();
    }
  } catch {
    return null;
  }
  if (signal?.aborted || epochs.get(key) !== epoch) return null;
  const result = { count: head.count, groups: head.groups, pieces };
  holdResult(key, result, head);
  return { result, meta: head };
}

async function saveGeneration(
  key: string,
  input: ReadResult,
  epoch: number,
  accepted: () => boolean,
  options?: SaveCatalogOptions,
): Promise<number> {
  const current = () => epochs.get(key) === epoch && accepted();
  if (!current()) throw new Error("Catalog source was cleared");
  const scope = key.slice(key.indexOf(":") + 1);
  let count = 0;
  const pieces: string[] = [];
  const yieldWork = catalogYield();
  for (const piece of input.pieces) {
    if (!current()) throw new Error("Catalog source was cleared");
    const items: ShapedVodItem[] = JSON.parse(piece);
    if (!Array.isArray(items) || items.length > 1000) throw new Error("Invalid catalog piece");
    for (let start = 0; start < items.length; start += 250) {
      for (let index = start; index < Math.min(start + 250, items.length); index++) {
        const item = items[index];
        if (
          !item ||
          (item.kind !== "movie" && item.kind !== "series") ||
          !(item.streamId ?? item.seriesId)
        )
          throw new Error("Invalid catalog piece");
        item.key = mediaKey(scope, item.kind, item.streamId ?? item.seriesId ?? "");
        delete item.url;
      }
      await yieldWork();
      if (!current()) throw new Error("Catalog source was cleared");
    }
    count += items.length;
    pieces.push(JSON.stringify(items));
  }
  if (
    count !== input.count ||
    pieces.length !== Math.ceil(count / 1000)
  )
    throw new Error("Invalid catalog count");
  if (pieces.reduce((sum, piece) => sum + piece.length * 2, 0) > HANDOFF_LIMIT_BYTES)
    throw new Error("Catalog exceeds bounded handoff capacity");
  const previous = headFrom(await raw(headKey(key)));
  if (!current()) throw new Error("Catalog source was cleared");
  const head: CatalogHead = {
    schema: 2,
    generation: `${Date.now().toString(36)}-${(++nextGeneration).toString(36)}`,
    t: Date.now(),
    count,
    n: pieces.length,
    groups: input.groups,
    version: options?.version,
    updatedAt: options?.updatedAt,
    etag: options?.etag,
  };
  const result = { ...input, pieces };
  holdResult(key, result, head);
  const records = pieces.map((value, index) => ({
    key: pieceKey(key, head.generation, index),
    value,
  }));
  records.push({ key: headKey(key), value: JSON.stringify(head) });
  const protectedKeys = previous
    ? [
        headKey(key),
        ...Array.from({ length: previous.n }, (_, index) =>
          pieceKey(key, previous.generation, index),
        ),
      ]
    : [];
  const persisted =
    typeof indexedDB !== "undefined" &&
    (await idle(() => vodDisk.writeBatch(records, protectedKeys, current)));
  if (!current()) {
    releaseResult(key, result);
    throw new Error("Catalog source was cleared");
  }
  if (persisted) memory.drop((candidate) => candidate.startsWith(`${storageKey(key)}:`));
  else memory.putBatch(records, protectedKeys);
  if (persisted) scheduleCleanup(key);
  return count;
}

export interface SaveCatalogOptions {
  version?: string;
  updatedAt?: number | string;
  etag?: string;
}

export function saveResult(
  key: string,
  input: ReadResult,
  accepted = () => true,
  options?: SaveCatalogOptions,
): Promise<number> {
  const epoch = epochs.get(key) ?? 0;
  epochs.set(key, epoch);
  return queueCatalog(key, () => saveGeneration(key, input, epoch, accepted, options));
}

function scheduleCleanup(key: string): void {
  if (typeof window === "undefined") return;
  whenIdle(() => {
    void queueCatalog(key, async () => {
      const head = headFrom(await raw(headKey(key)));
      if (!head) return;
      const prefix = `${storageKey(key)}:g:`;
      const keep = `${prefix}${head.generation}:`;
      await vodDisk.forget(
        (candidate) => candidate.startsWith(prefix) && !candidate.startsWith(keep),
      );
    });
  }, 3000);
}

export async function cleanupAbandonedCatalogs(): Promise<void> {
  const all = await vodDisk.entries();
  const bases = new Set(
    all
      .filter((entry) => entry.key.includes(":catalog:") && entry.key.includes(":g:"))
      .map((entry) => entry.key.slice(0, entry.key.indexOf(":g:"))),
  );
  for (const base of bases) {
    const separator = base.lastIndexOf(":catalog:");
    const root = `${base.slice(separator + 9)}:${base.slice(7, separator)}`;
    await queueCatalog(root, async () => {
      const head = headFrom(await raw(`${base}:head`));
      if (!head && (await vodDisk.entries()).some((entry) => entry.key === `${base}:head`)) return;
      const keep = head ? `${base}:g:${head.generation}:` : "";
      await vodDisk.forget(
        (entry) => entry.startsWith(`${base}:g:`) && (!keep || !entry.startsWith(keep)),
      );
    });
  }
}

export function cleanupLegacyVodCache(): Promise<boolean> {
  return Promise.resolve(true);
}
