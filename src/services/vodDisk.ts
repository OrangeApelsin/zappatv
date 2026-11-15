/**
 * Dedicated persistent VOD storage over IndexedDB (database: "zappa-vod").
 *
 * Isolated from the primary "openiptv" database so that bulk movie and series
 * catalog caches never compete with or evict live TV channels or channel logos,
 * and live TV cold-start logo loading is never delayed by VOD disk writes.
 *
 * Allocated a dedicated 200 MB budget (safe for TV hardware with 1 GB storage).
 */

import { whenIdle } from "./idle";

const DB_NAME = "zappa-vod";
const DB_VERSION = 1;

const VALUES = "values";
const META = "meta";

/** Dedicated VOD budget: 200 MB. */
export const VOD_BUDGET_BYTES = 200 * 1024 * 1024;

export interface Entry {
  key: string;
  bytes: number;
  /** When it was last read or written, so the least useful thing goes first. */
  at: number;
}

export interface CacheWrite {
  key: string;
  value: Blob | string;
}

export function evictionPlan(
  entries: Entry[],
  incoming: { key: string; bytes: number },
  budget = VOD_BUDGET_BYTES,
): { evict: string[]; refused: boolean } {
  if (incoming.bytes > budget) return { evict: [], refused: true };

  const others = entries.filter((e) => e.key !== incoming.key);
  let used = others.reduce((sum, e) => sum + e.bytes, 0) + incoming.bytes;
  if (used <= budget) return { evict: [], refused: false };

  const evict: string[] = [];
  for (const entry of [...others].sort((a, b) => a.at - b.at)) {
    evict.push(entry.key);
    used -= entry.bytes;
    if (used <= budget) break;
  }
  return { evict, refused: false };
}

let opening: Promise<IDBDatabase | null> | null = null;
let mutations: Promise<unknown> = Promise.resolve();

function serialize<T>(work: () => Promise<T>): Promise<T> {
  const task = mutations.then(work, work);
  mutations = task.catch(() => {});
  return task;
}

export const IDB_TIMEOUT_MS = 3000;
let indexHealthy = false;

function open(): Promise<IDBDatabase | null> {
  if (opening) return opening;
  opening = new Promise((settle) => {
    let finished = false;
    const timer = setTimeout(() => finish(null), IDB_TIMEOUT_MS);
    function finish(db: IDBDatabase | null) {
      if (finished) {
        db?.close();
        return;
      }
      finished = true;
      clearTimeout(timer);
      if (db)
        db.onversionchange = () => {
          db.close();
          opening = null;
          indexing = null;
          indexHealthy = false;
        };
      else {
        opening = null;
        indexHealthy = false;
      }
      settle(db);
    }
    if (typeof indexedDB === "undefined") {
      finish(null);
      return;
    }
    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(VALUES)) db.createObjectStore(VALUES);
        if (!db.objectStoreNames.contains(META)) db.createObjectStore(META);
      };
      request.onsuccess = () => finish(request.result);
      request.onerror = request.onblocked = () => finish(null);
    } catch {
      finish(null);
    }
  });
  return opening;
}

function get<T>(
  db: IDBDatabase,
  store: string,
  work: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T | null> {
  return new Promise((settle) => {
    let tx: IDBTransaction | undefined;
    let finished = false;
    const timer = setTimeout(() => {
      try {
        tx?.abort();
      } catch {}
      finish(null);
    }, IDB_TIMEOUT_MS);
    function finish(value: T | null) {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      settle(value);
    }
    try {
      tx = db.transaction([store], "readonly");
      tx.onerror = tx.onabort = () => finish(null);
      const request = work(tx.objectStore(store));
      request.onsuccess = () => finish(request.result ?? null);
      request.onerror = () => finish(null);
    } catch {
      finish(null);
    }
  });
}

function commit(
  db: IDBDatabase,
  stores: string[],
  work: (tx: IDBTransaction) => void,
): Promise<boolean> {
  return new Promise((settle) => {
    let tx: IDBTransaction | undefined;
    let finished = false;
    const timer = setTimeout(() => {
      try {
        tx?.abort();
      } catch {}
      finish(false);
    }, IDB_TIMEOUT_MS);
    function finish(ok: boolean) {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      settle(ok);
    }
    try {
      tx = db.transaction(stores, "readwrite");
      tx.oncomplete = () => finish(true);
      tx.onerror = tx.onabort = () => finish(false);
      work(tx);
    } catch {
      try {
        tx?.abort();
      } catch {}
      finish(false);
    }
  });
}

let indexing: Promise<Map<string, Omit<Entry, "key">>> | null = null;

function loadIndex(): Promise<Map<string, Omit<Entry, "key">>> {
  indexing ??= (async () => {
    const fresh = new Map<string, Omit<Entry, "key">>();
    const db = await open();
    if (!db) {
      indexing = null;
      indexHealthy = false;
      return fresh;
    }
    const keys = await get<IDBValidKey[]>(db, META, (s) => s.getAllKeys());
    const values = await get<Omit<Entry, "key">[]>(db, META, (s) => s.getAll());
    if (
      keys &&
      values &&
      keys.length === values.length &&
      values.every(
        (entry) =>
          entry &&
          Number.isFinite(entry.bytes) &&
          entry.bytes >= 0 &&
          Number.isFinite(entry.at),
      )
    ) {
      indexHealthy = true;
      for (let i = 0; i < keys.length; i++) fresh.set(String(keys[i]), values[i]);
    } else {
      indexing = null;
      indexHealthy = false;
    }
    return fresh;
  })();
  return indexing;
}

export async function entries(): Promise<Entry[]> {
  return [...(await loadIndex())].map(([key, meta]) => ({ key, ...meta }));
}

export async function usage(): Promise<{ bytes: number; count: number }> {
  const all = await entries();
  return { bytes: all.reduce((sum, e) => sum + e.bytes, 0), count: all.length };
}

const unflushed = new Map<string, number>();
let flushing: (() => void) | null = null;

function flushSoon(): void {
  if (flushing) return;
  flushing = whenIdle(() => {
    flushing = null;
    void flushTouches();
  }, 4000);
}

async function flushTouchesNow(): Promise<void> {
  const db = await open();
  if (!db || !unflushed.size) return;
  const held = await loadIndex();
  if (!indexHealthy) return;
  const touched = [...unflushed];
  unflushed.clear();
  const ok = await commit(db, [META], (tx) => {
    const store = tx.objectStore(META);
    for (const [key, at] of touched) {
      const meta = held.get(key);
      if (!meta) continue;
      meta.at = at;
      store.put(meta, key);
    }
  });
  if (!ok) for (const [key, at] of touched) if (held.has(key)) unflushed.set(key, at);
}

const flushTouches = () => serialize(flushTouchesNow);

export async function read(key: string): Promise<Blob | string | null> {
  const db = await open();
  if (!db) return null;
  const value = await get<Blob | string>(db, VALUES, (s) => s.get(key));
  if (value == null) return null;

  unflushed.set(key, Date.now());
  flushSoon();
  return value;
}

const sizeOf = (value: Blob | string) =>
  typeof value === "string" ? value.length * 2 : value.size;

async function writeBatchNow(
  records: readonly CacheWrite[],
  protectedKeys: readonly string[],
  current: () => boolean,
): Promise<boolean> {
  const db = await open();
  if (!db || !current()) return false;
  const incoming = new Map(
    records.map((record) => [record.key, { ...record, bytes: sizeOf(record.value) }]),
  );
  if (incoming.size !== records.length) return false;
  const held = await loadIndex();
  if (!indexHealthy || !current()) return false;
  const others = [...held]
    .filter(([key]) => !incoming.has(key))
    .map(([key, value]) => ({ key, ...value }));
  let used =
    others.reduce((sum, entry) => sum + entry.bytes, 0) +
    [...incoming.values()].reduce((sum, entry) => sum + entry.bytes, 0);
  const protectedSet = new Set(protectedKeys);
  const evict: string[] = [];
  for (const entry of others.sort((a, b) => a.at - b.at)) {
    if (used <= VOD_BUDGET_BYTES) break;
    if (protectedSet.has(entry.key)) continue;
    evict.push(entry.key);
    used -= entry.bytes;
  }
  if (used > VOD_BUDGET_BYTES || !current()) return false;
  const at = Date.now();
  const ok = await commit(db, [VALUES, META], (tx) => {
    for (const key of evict) {
      tx.objectStore(VALUES).delete(key);
      tx.objectStore(META).delete(key);
    }
    for (const record of incoming.values()) {
      tx.objectStore(VALUES).put(record.value, record.key);
      tx.objectStore(META).put({ bytes: record.bytes, at }, record.key);
    }
  });
  if (!ok) return false;
  for (const key of evict) {
    held.delete(key);
    unflushed.delete(key);
  }
  for (const record of incoming.values()) {
    held.set(record.key, { bytes: record.bytes, at });
    unflushed.delete(record.key);
  }
  return true;
}

export const writeBatch = (
  records: readonly CacheWrite[],
  protectedKeys: readonly string[] = [],
  current = () => true,
): Promise<boolean> => serialize(() => writeBatchNow(records, protectedKeys, current));

async function writeNow(
  key: string,
  value: Blob | string,
  current: () => boolean,
): Promise<boolean> {
  return writeBatchNow([{ key, value }], [], current);
}

async function forgetNow(doomed: (key: string) => boolean): Promise<number> {
  const db = await open();
  if (!db) return 0;
  const going = (await entries()).filter((e) => doomed(e.key)).map((e) => e.key);
  if (!going.length) return 0;
  const ok = await commit(db, [VALUES, META], (tx) => {
    for (const key of going) {
      tx.objectStore(VALUES).delete(key);
      tx.objectStore(META).delete(key);
    }
  });
  if (!ok) return 0;
  const held = await loadIndex();
  for (const key of going) {
    held.delete(key);
    unflushed.delete(key);
  }
  return going.length;
}

export const write = (
  key: string,
  value: Blob | string,
  current = () => true,
): Promise<boolean> => serialize(() => writeNow(key, value, current));

export const forget = (doomed: (key: string) => boolean): Promise<number> =>
  serialize(() => forgetNow(doomed));

export const forgetAll = () =>
  serialize(async () => {
    const db = await open();
    if (!db) return 0;
    const held = await loadIndex();
    const count = held.size;
    const ok = await commit(db, [VALUES, META], (tx) => {
      tx.objectStore(VALUES).clear();
      tx.objectStore(META).clear();
    });
    if (!ok) return 0;
    indexing = Promise.resolve(new Map());
    indexHealthy = true;
    unflushed.clear();
    return count;
  });

