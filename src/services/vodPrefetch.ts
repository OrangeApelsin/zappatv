import type { CatalogProgress, CatalogWork } from "../workers/catalogProtocol";
import {
  type RawCategory,
  type ReadResult,
  readCategories,
  readList,
  type ShapedVodItem,
  type VodGroup,
} from "../workers/vodWorker";
import vodWorkerUrl from "../workers/vodWorker?worker&url";
import {
  abortable,
  abortError,
  catalogController,
  throwIfAborted,
} from "./catalogCancellation";
import { httpRequest, MAX_CATALOG_BYTES } from "./catalogTransport";
import { catalogYield } from "./catalogYield";
import {
  type CatalogHead,
  cancelCacheRequests,
  dbDrop,
  getCatalogHead,
  getResult,
  prepareVodCache,
  releaseResult,
  saveResult,
} from "./vodCache";

export interface VodFetchOptions {
  playlistId: string;
  kind: "vod" | "series";
  catsUrl: string;
  listUrl: string;
  baseUrl?: string;
  ttl?: number;
  force?: boolean;
  version?: string;
  updatedAt?: number | string;
  etag?: string;
  signal?: AbortSignal;
  categories?: RawCategory[];
  onProgress?: (progress: CatalogProgress) => void;
  onPreparing?: () => void;
  onTimings?: (phases: {
    transfer?: number;
    providerResponse?: number;
    download?: number;
    parse?: number;
    cachePreparePersist: number;
  }) => void;
}
export interface VodReadOptions {
  playlistId: string;
  kind: "vod" | "series";
  buffer: ArrayBuffer;
  categories?: RawCategory[];
  baseUrl?: string;
  signal?: AbortSignal;
}
export interface VodTakeResult {
  items: ShapedVodItem[];
  groups: VodGroup[];
}
export const WORKER_READY_TIMEOUT_MS = 5000;
export const WORKER_REQUEST_TIMEOUT_MS = 125000;
export const CATALOG_OPERATION_TIMEOUT_MS = 150000;
class WorkerUnavailable extends Error {
  constructor() {
    super("Catalog worker unavailable");
  }
}
class CatalogFailure extends Error {
  constructor(code: string) {
    super(code === "invalid" ? "Catalog data is invalid" : "Catalog request failed");
  }
}
type Pending = {
  key: string;
  generation: number;
  resolve: (result: ReadResult) => void;
  reject: (error: Error) => void;
  progress?: (progress: CatalogProgress) => void;
};
type ActiveFetch = {
  task: Promise<number>;
  users: number;
  unabortable: boolean;
  settled: boolean;
};

export class VodPrefetchService {
  private worker: Worker | null = null;
  private workerReady: Promise<Worker | null> | null = null;
  private readyCancel: (() => void) | null = null;
  private workerDisabled = false;
  private disposed = false;
  private reqId = 0;
  private generation = 0;
  private pending = new Map<number, Pending>();
  private controllers = new Map<ReturnType<typeof catalogController>, string>();
  private activeFetches = new Map<string, ActiveFetch>();
  constructor(
    private readonly createWorker: () => Worker = () =>
      new Worker(vodWorkerUrl, import.meta.env.DEV ? { type: "module" } : undefined),
  ) {}
  get pendingCount(): number {
    return this.pending.size;
  }
  get inFlightCount(): number {
    return this.controllers.size;
  }

  private resetWorker(disabled: boolean, error: Error): void {
    const worker = this.worker;
    this.worker = null;
    this.workerReady = null;
    this.workerDisabled = disabled;
    this.readyCancel?.();
    this.readyCancel = null;
    try {
      worker?.terminate();
    } catch {}
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }
  cancelAll(): void {
    this.generation++;
    for (const controller of this.controllers.keys()) controller.abort();
    this.controllers.clear();
    this.activeFetches.clear();
    cancelCacheRequests();
    this.resetWorker(false, abortError());
  }
  dispose(): void {
    this.cancelAll();
    this.disposed = true;
  }

  private owned<T>(
    key: string,
    work: (signal: AbortSignal) => Promise<T>,
    external?: AbortSignal,
    deadline = CATALOG_OPERATION_TIMEOUT_MS,
  ): Promise<T> {
    if (this.disposed || external?.aborted) return Promise.reject(abortError());
    const controller = catalogController();
    const abort = () => controller.abort();
    this.controllers.set(controller, key);
    external?.addEventListener("abort", abort, { once: true });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      abort();
    }, deadline);
    const task = Promise.resolve().then(() => {
      throwIfAborted(controller.signal);
      return work(controller.signal);
    });
    return abortable(task, controller.signal)
      .catch((error) => {
        if (timedOut) throw new Error("Catalog operation timed out");
        throw error;
      })
      .finally(() => {
        clearTimeout(timer);
        external?.removeEventListener("abort", abort);
        this.controllers.delete(controller);
      });
  }

  private getWorker(): Promise<Worker | null> {
    if (this.disposed || this.workerDisabled || typeof Worker === "undefined")
      return Promise.resolve(null);
    if (this.workerReady) return this.workerReady;
    let settle: (worker: Worker | null) => void = () => {};
    const waiting = new Promise<Worker | null>((resolve) => {
      settle = resolve;
    });
    this.workerReady = waiting;
    let timer: ReturnType<typeof setTimeout>;
    this.readyCancel = () => {
      clearTimeout(timer);
      settle(null);
    };
    try {
      const worker = this.createWorker();
      this.worker = worker;
      const fail = () => {
        if (this.worker === worker) this.resetWorker(true, new WorkerUnavailable());
      };
      worker.onmessage = (event: MessageEvent) => {
        if (this.worker !== worker) return;
        const data = event.data as Record<string, unknown>;
        if (!data || typeof data !== "object") {
          fail();
          return;
        }
        if (data.ready === true) {
          clearTimeout(timer);
          this.readyCancel = null;
          settle(worker);
          return;
        }
        const pending = this.pending.get(Number(data.id));
        if (!pending || pending.key !== data.key || pending.generation !== data.generation)
          return;
        if (data.type === "progress") {
          try {
            pending.progress?.({
              loaded: Number(data.loaded),
              bytes: Number(data.bytes),
              totalBytes: Number(data.totalBytes),
              phase: data.phase === "download" ? "download" : "parse",
            });
          } catch {
            pending.reject(new CatalogFailure("invalid"));
          }
        } else if (data.type === "success" && data.result && typeof data.result === "object")
          pending.resolve(data.result as ReadResult);
        else if (data.type === "error" && data.code === "cancelled")
          pending.reject(abortError());
        else if (data.type === "error" && (data.code === "invalid" || data.code === "network"))
          pending.reject(new CatalogFailure(data.code));
        else fail();
      };
      worker.onerror = fail;
      worker.onmessageerror = fail;
      timer = setTimeout(fail, WORKER_READY_TIMEOUT_MS);
    } catch {
      this.resetWorker(true, new WorkerUnavailable());
    }
    return waiting;
  }

  private async send(
    message: CatalogWork,
    signal: AbortSignal,
    progress?: (progress: CatalogProgress) => void,
  ): Promise<ReadResult> {
    const generation = this.generation;
    const worker = await abortable(this.getWorker(), signal);
    throwIfAborted(signal);
    if (generation !== this.generation) throw abortError();
    if (!worker) throw new WorkerUnavailable();
    return new Promise((resolve, reject) => {
      const id = ++this.reqId;
      let timer: ReturnType<typeof setTimeout>;
      const finish = (error?: Error, result?: ReadResult) => {
        if (!this.pending.has(id)) return;
        this.pending.delete(id);
        clearTimeout(timer);
        signal.removeEventListener("abort", cancelled);
        if (error) reject(error);
        else resolve(result!);
      };
      const cancelled = () => {
        finish(abortError());
        try {
          worker.postMessage({ op: "cancel", id, generation });
        } catch {}
      };
      this.pending.set(id, {
        key: message.key,
        generation,
        resolve: (result) => finish(undefined, result),
        reject: (error) => finish(error),
        progress,
      });
      signal.addEventListener("abort", cancelled, { once: true });
      timer = setTimeout(
        () => this.resetWorker(true, new WorkerUnavailable()),
        WORKER_REQUEST_TIMEOUT_MS,
      );
      // No transfer list: retain the input for replay if posting or the worker fails.
      try {
        worker.postMessage({ ...message, id, generation });
      } catch {
        this.resetWorker(true, new WorkerUnavailable());
      }
    });
  }

  has(playlistId: string, kind: "vod" | "series", ttl = 0): Promise<number> {
    const key = `${kind}:${playlistId}`;
    return this.owned(
      key,
      async (signal) => (await getResult(key, ttl, signal))?.meta.count ?? 0,
      undefined,
      10000,
    );
  }
  cached(playlistId: string, kind: "vod" | "series", ttl = 0): Promise<boolean> {
    const key = `${kind}:${playlistId}`;
    return this.owned(
      key,
      async (signal) => !!(await getResult(key, ttl, signal)),
      undefined,
      10000,
    );
  }

  getHead(playlistId: string, kind: "vod" | "series"): Promise<CatalogHead | null> {
    const key = `${kind}:${playlistId}`;
    return getCatalogHead(key);
  }

  fetch(options: VodFetchOptions): Promise<number> {
    if (options.signal?.aborted || this.disposed) return Promise.reject(abortError());
    const key = `${options.kind}:${options.playlistId}`;
    let active = this.activeFetches.get(key);
    if (!active) {
      prepareVodCache();
      const task = this.owned(key, async (signal) => {
        const held = options.force ? null : await getResult(key, options.ttl ?? 0, signal);
        throwIfAborted(signal);
        if (held) return held.meta.count; // A successful empty catalog is a hit.
        let result: ReadResult;
        try {
          result = await this.send(
            {
              op: "fetch",
              key,
              kind: options.kind,
              catsUrl: options.catsUrl,
              listUrl: options.listUrl,
              cats: options.categories,
            },
            signal,
            options.onProgress,
          );
        } catch (error) {
          throwIfAborted(signal);
          if (!(error instanceof WorkerUnavailable)) throw error;
          const cached = options.force ? null : await getResult(key, options.ttl ?? 0, signal);
          throwIfAborted(signal);
          if (cached) return cached.meta.count;
          const cats =
            options.categories ??
            readCategories(String(await httpRequest(options.catsUrl, "text", 30000, signal)));
          const transferStart = performance.now();
          let transportTiming: { providerResponse: number; download: number } | undefined;
          const buffer = (await httpRequest(
            options.listUrl,
            "arraybuffer",
            90000,
            signal,
            (timing) => {
              transportTiming = timing;
            },
            (progress) => options.onProgress?.({ ...progress, loaded: 0, phase: "download" }),
          )) as ArrayBuffer;
          const parseStart = performance.now();
          result = await readList(buffer, options.kind, cats, "", {
            signal,
            onProgress: (progress) => options.onProgress?.({ ...progress, phase: "parse" }),
          });
          result.timings = {
            ...transportTiming,
            transfer: parseStart - transferStart,
            parse: performance.now() - parseStart,
          };
        }
        throwIfAborted(signal);
        const cacheStart = performance.now();
        options.onPreparing?.();
        const count = await saveResult(key, result, () => !signal.aborted, {
          version: options.version,
          updatedAt: options.updatedAt,
          etag: options.etag,
        });
        options.onTimings?.({
          ...result.timings,
          cachePreparePersist: performance.now() - cacheStart,
        });
        return count;
      });
      active = { task, users: 0, unabortable: false, settled: false };
      const selected = active;
      const finish = () => {
        selected.settled = true;
        if (this.activeFetches.get(key) === selected) this.activeFetches.delete(key);
      };
      void task.then(finish, finish);
      this.activeFetches.set(key, active);
    }
    if (!options.signal) {
      active.unabortable = true;
      return active.task;
    }
    active.users++;
    const selected = active;
    return abortable(active.task, options.signal).finally(() => {
      selected.users--;
      if (!selected.users && !selected.unabortable && !selected.settled)
        for (const [controller, owner] of this.controllers)
          if (owner === key) controller.abort();
    });
  }

  read(options: VodReadOptions): Promise<number> {
    const key = `${options.kind}:${options.playlistId}`;
    return this.owned(
      key,
      async (signal) => {
        if (options.buffer.byteLength > MAX_CATALOG_BYTES) throw new CatalogFailure("invalid");
        let result: ReadResult;
        try {
          result = await this.send(
            {
              op: "read",
              key,
              kind: options.kind,
              buf: options.buffer,
              cats: options.categories,
            },
            signal,
          );
        } catch (error) {
          throwIfAborted(signal);
          if (!(error instanceof WorkerUnavailable)) throw error;
          result = await readList(options.buffer, options.kind, options.categories, "", {
            signal,
          });
        }
        throwIfAborted(signal);
        return saveResult(key, result, () => !signal.aborted);
      },
      options.signal,
    );
  }

  take(
    playlistId: string,
    kind: "vod" | "series",
    ttl = 0,
    onChunk?: (items: ShapedVodItem[], groups: VodGroup[], done: boolean) => void,
    external?: AbortSignal,
    collect = true,
  ): Promise<VodTakeResult> {
    const key = `${kind}:${playlistId}`;
    return this.owned(
      key,
      async (signal) => {
        const held = await getResult(key, ttl, signal);
        throwIfAborted(signal);
        if (!held) throw new CatalogFailure("invalid");
        const items: ShapedVodItem[] = [];
        const yieldWork = catalogYield();
        try {
          if (!held.result.pieces.length) onChunk?.([], held.result.groups, true);
          for (let i = 0; i < held.result.pieces.length; i++) {
            throwIfAborted(signal);
            const piece = JSON.parse(held.result.pieces[i]) as ShapedVodItem[];
            for (let start = 0; start < piece.length; start += 250) {
              throwIfAborted(signal);
              const batch = piece.slice(start, start + 250);
              if (collect) for (const item of batch) items.push(item);
              onChunk?.(
                batch,
                held.result.groups,
                i + 1 === held.result.pieces.length && start + 250 >= piece.length,
              );
              await yieldWork();
            }
          }
          throwIfAborted(signal);
          return { items, groups: held.result.groups };
        } finally {
          releaseResult(key, held.result);
        }
      },
      external,
      10000,
    );
  }

  async clear(playlistId: string): Promise<void> {
    const keys = [`vod:${playlistId}`, `series:${playlistId}`];
    for (const [controller, key] of this.controllers)
      if (keys.includes(key)) controller.abort();
    await Promise.all(keys.map((key) => dbDrop(key)));
  }
}
export const vodPrefetch = new VodPrefetchService();
