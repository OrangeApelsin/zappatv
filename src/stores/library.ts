import { create } from "zustand";
import { CatalogIndex } from "../services/catalogIndex";
import { resetCatalogTimings, startCatalogTiming } from "../services/catalogTiming";
import { read as readDisk, write as writeDisk } from "../services/disk";
import { applyGuideOffset, BATCH_EPG_TTL_MS, fetchBatchEpg } from "../services/epgBatch";
import { whenIdle } from "../services/idle";
import { ownsMediaKey, sourceIdentity } from "../services/mediaIdentity";
import { getGuideTimeOffsetSeconds } from "./settings";
import { read, write } from "../services/store";
import { vodPrefetch } from "../services/vodPrefetch";
import {
  probeVodVersion,
  recordVersionChecked,
  shouldCheckVersion,
  type VersionCheckResult,
} from "../services/vodSync";
import {
  authenticateXtream,
  buildXtreamCatchupUrl,
  buildXtreamEpisodeUrl,
  buildXtreamMovieUrl,
  endpoint,
  loadXtreamContentCategories,
  loadXtreamGuide,
  loadXtreamMovieDetail,
  loadXtreamSeriesDetail,
  type XtreamCategory,
  type XtreamContentKind,
  type XtreamEpisode,
  type XtreamMovie,
  type XtreamMovieDetail,
  type XtreamProgramme,
  type XtreamSeries,
  type XtreamSeriesDetail,
  type XtreamSession,
} from "../services/xtream";
import type { Channel, PlaybackTarget } from "../types";
import type { ShapedVodItem, VodGroup } from "../workers/vodWorker";
import { usePersonal } from "./personal";
import type { Playlist } from "./settings";
import { useSettings } from "./settings";
import { useVodBrowse } from "./vodBrowse";

export type LibraryKind = Exclude<XtreamContentKind, "live">;
export type LibraryItem = XtreamMovie | XtreamSeries;
export type LibraryLoadState = "loading" | "loaded" | "empty" | "failed";

export interface LibraryList<T> {
  state: LibraryLoadState;
  items: T[];
  error?: string;
}

export interface LibraryDetail<T> {
  state: LibraryLoadState;
  value?: T;
  error?: string;
}

export interface GuideProgramme extends XtreamProgramme {
  target?: PlaybackTarget;
}

export interface ChannelGuide extends LibraryList<GuideProgramme> {
  current?: GuideProgramme;
  next?: GuideProgramme;
  fetchedAt?: number;
}

interface CatalogCounters {
  kind: "movie" | "series" | "idle";
  state: "idle" | "loading" | "loaded" | "failed";
  percent: number;
  loaded: number;
  total: number;
  error?: string;
}

export type CatalogLoadPhase =
  | "cache"
  | "connect"
  | "categories"
  | "request"
  | "download"
  | "parse"
  | "prepare"
  | "ingest"
  | "index"
  | "ready"
  | "failed";
export interface CatalogLoadProgress extends CatalogCounters {
  phase: CatalogLoadPhase;
  phasePercent?: number;
  bytes?: number;
  totalBytes?: number;
}

interface LibraryState {
  sourceKey: string;
  playlistId: string;
  sourceVersion: number;
  categories: Record<LibraryKind, LibraryList<XtreamCategory>>;
  categoryItems: Record<string, LibraryList<LibraryItem>>;
  searchItems: Record<LibraryKind, LibraryList<LibraryItem>>;
  movieDetails: Record<string, LibraryDetail<XtreamMovieDetail>>;
  seriesDetails: Record<string, LibraryDetail<XtreamSeriesDetail>>;
  guides: Record<string, ChannelGuide>;
  catalogs: Partial<Record<LibraryKind, CatalogIndex>>;
  vodItems: ShapedVodItem[];
  seriesItems: ShapedVodItem[];
  vodGroups: VodGroup[];
  seriesGroups: VodGroup[];
  catalogProgress: Record<LibraryKind, CatalogLoadProgress>;
  selectPlaylist: (playlist: Playlist | undefined) => void;
  loadCategories: (kind: LibraryKind) => Promise<void>;
  loadHomeCategories: (kind: LibraryKind) => Promise<void>;
  loadCategory: (categoryKey: string) => Promise<void>;
  loadSearch: (kind: LibraryKind) => Promise<void>;
  loadVodCatalog: (
    kind: "movie" | "series",
    forceRefresh?: boolean,
    checkVersion?: boolean,
  ) => Promise<void>;
  loadMovie: (movieKey: string, forceRefresh?: boolean) => Promise<void>;
  loadSeries: (seriesKey: string, forceRefresh?: boolean) => Promise<void>;
  loadGuide: (channel: Channel) => Promise<void>;
  loadBatchGuides: (channels: readonly Channel[]) => Promise<void>;
  guideFor: (channelId: string) => ChannelGuide;
  clearGuides: () => void;
  retry: (frameKey: string) => Promise<void>;
  clear: () => void;
}

const GUIDE_TTL_MS = 5 * 60 * 1000;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const emptyList = <T>(): LibraryList<T> => ({ state: "empty", items: [] });
const emptyGuide = (): ChannelGuide => ({ state: "empty", items: [] });
const initialCategories = (): Record<LibraryKind, LibraryList<XtreamCategory>> => ({
  movie: emptyList(),
  series: emptyList(),
});
const initialSearch = (): Record<LibraryKind, LibraryList<LibraryItem>> => ({
  movie: emptyList(),
  series: emptyList(),
});
const initialCatalogCounters = (): CatalogCounters => ({
  kind: "idle",
  state: "idle",
  percent: 0,
  loaded: 0,
  total: 0,
});

const initialCatalogProgress = (): Record<LibraryKind, CatalogLoadProgress> => ({
  movie: { ...initialCatalogCounters(), kind: "movie", phase: "cache" },
  series: { ...initialCatalogCounters(), kind: "series", phase: "cache" },
});

let selected: Playlist | undefined;
let generation = 0;
const controllers = new Set<AbortController>();
const requests = new Map<string, Promise<void>>();
const idleRefreshes = new Map<string, () => void>();
const cacheWrites = new Map<string, () => void>();
const sessions = new Map<string, XtreamSession>();
const sessionRequests = new Map<string, Promise<XtreamSession>>();
let sessionController: AbortController | undefined;
let guideController: AbortController | undefined;
let guideChannelId = "";

const selectionKey = sourceIdentity;
const cachePrefix = (playlist: Playlist) => `xtream:${sourceIdentity(playlist)}`;
const detailCacheKey = (playlist: Playlist, kind: LibraryKind, id: string) =>
  `${cachePrefix(playlist)}:${kind}:${id}`;
const stampKey = (key: string) => `openiptv.at.${key}`;
const fresh = (key: string) => Date.now() - (Number(read(stampKey(key))) || 0) < CACHE_TTL_MS;

function message(error: unknown): string {
  return error instanceof Error ? error.message : "The provider request failed";
}

function providerId(key: string, kind: LibraryKind): string {
  if (!selected) return "";
  const prefix = `xtream:${sourceIdentity(selected)}:${kind}:`;
  return key.startsWith(prefix) ? key.slice(prefix.length) : "";
}

async function cached<T>(key: string): Promise<T | null> {
  const value = await readDisk(key);
  if (typeof value !== "string") return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function abortRequests() {
  vodPrefetch.cancelAll();
  generation += 1;
  sessionController?.abort();
  sessionController = undefined;
  sessionRequests.clear();
  guideController?.abort();
  guideController = undefined;
  guideChannelId = "";
  for (const controller of controllers) controller.abort();
  controllers.clear();
  for (const cancel of idleRefreshes.values()) cancel();
  idleRefreshes.clear();
  for (const cancel of cacheWrites.values()) cancel();
  cacheWrites.clear();
  requests.clear();
}

async function sessionFor(playlist: Playlist): Promise<XtreamSession> {
  if (playlist.source.kind !== "xtream")
    throw new Error("This playlist has no on demand library");
  const key = selectionKey(playlist);
  const held = sessions.get(key);
  if (held) return held;
  const pending = sessionRequests.get(key);
  if (pending) return pending;

  const owned = generation;
  const controller = new AbortController();
  sessionController = controller;
  const request = authenticateXtream(playlist.source, controller.signal)
    .then((session) => {
      if (
        controller.signal.aborted ||
        owned !== generation ||
        !selected ||
        selectionKey(selected) !== key
      )
        throw new DOMException("Aborted", "AbortError");
      sessions.set(key, session);
      return session;
    })
    .finally(() => {
      if (sessionRequests.get(key) === request) sessionRequests.delete(key);
      if (sessionController === controller) sessionController = undefined;
    });
  sessionRequests.set(key, request);
  return request;
}

export async function libraryPlaybackUrl(item: XtreamMovie | XtreamEpisode): Promise<string> {
  const playlist = selected;
  if (!playlist || !ownsMediaKey(item.key, playlist))
    throw new Error("This item belongs to another source");
  const owned = generation;
  const session = await sessionFor(playlist);
  if (owned !== generation) throw new DOMException("Aborted", "AbortError");
  return "streamId" in item
    ? buildXtreamMovieUrl(session, item.streamId, item.extension)
    : buildXtreamEpisodeUrl(session, item.episodeId, item.extension);
}

function deduplicate(frameKey: string, work: () => Promise<void>): Promise<void> {
  const held = requests.get(frameKey);
  if (held) return held;
  const request = work().finally(() => {
    if (requests.get(frameKey) === request) requests.delete(frameKey);
  });
  requests.set(frameKey, request);
  return request;
}

function persistCache(key: string, value: string, owned: number): void {
  cacheWrites.get(key)?.();
  cacheWrites.set(
    key,
    whenIdle(() => {
      cacheWrites.delete(key);
      if (owned !== generation) return;
      void writeDisk(key, value, () => owned === generation).then((accepted) => {
        if (accepted && owned === generation) write(stampKey(key), String(Date.now()));
      });
    }, 2000),
  );
}

function refreshWhenIdle(key: string, owned: number, work: () => Promise<void>) {
  if (idleRefreshes.has(key)) return;
  const cancel = whenIdle(() => {
    idleRefreshes.delete(key);
    if (owned === generation) void work();
  }, 4000);
  idleRefreshes.set(key, cancel);
}

function catchupTarget(
  playlist: Playlist,
  session: XtreamSession,
  channel: Channel,
  programme: XtreamProgramme,
  now: number,
): PlaybackTarget | undefined {
  const metadata = channel.xtream;
  const start = programme.startTimestamp;
  const stop = programme.stopTimestamp;
  if (
    !metadata ||
    !programme.archived ||
    metadata.archiveDays < 1 ||
    start === undefined ||
    stop === undefined ||
    start >= stop ||
    stop > now ||
    start < now - metadata.archiveDays * 86400 ||
    !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(?::\d{2})?$/.test(programme.start)
  )
    return undefined;
  return {
    id: `xtream:${playlist.id}:catchup:${metadata.streamId}:${programme.id}`,
    playlistId: playlist.id,
    mode: "finite",
    kind: "catchup",
    name: programme.title,
    group: channel.name,
    logo: channel.logo,
    url: buildXtreamCatchupUrl(
      session,
      metadata.streamId,
      Math.ceil((stop - start) / 60),
      programme.start,
    ),
  };
}

export const useLibrary = create<LibraryState>((set, get) => ({
  sourceKey: "",
  playlistId: "",
  sourceVersion: 0,
  categories: initialCategories(),
  categoryItems: {},
  searchItems: initialSearch(),
  movieDetails: {},
  seriesDetails: {},
  guides: {},
  catalogs: {},
  vodItems: [],
  seriesItems: [],
  vodGroups: [],
  seriesGroups: [],

  catalogProgress: initialCatalogProgress(),

  selectPlaylist(playlist) {
    const nextKey = playlist ? selectionKey(playlist) : "";
    const currentKey = selected ? selectionKey(selected) : "";
    if (nextKey === currentKey) return;
    resetCatalogTimings();
    abortRequests();
    selected = playlist?.source.kind === "xtream" ? playlist : undefined;
    const configured = useSettings.getState().playlists;
    if (configured.length) usePersonal.getState().migrateVodPersonal(configured);
    set({
      playlistId: selected?.id ?? "",
      sourceKey: selected ? sourceIdentity(selected) : "",
      sourceVersion: selected?.sourceVersion ?? 0,
      categories: initialCategories(),
      categoryItems: {},
      searchItems: initialSearch(),
      movieDetails: {},
      seriesDetails: {},
      guides: {},
      catalogs: {},
      vodItems: [],
      seriesItems: [],
      vodGroups: [],
      seriesGroups: [],

      catalogProgress: initialCatalogProgress(),
    });
  },

  async loadHomeCategories(kind) {
    const playlist = selected;
    if (!playlist || get().catalogs[kind] || get().categories[kind].state === "loaded") return;
    const owned = generation;
    return deduplicate(`home-categories:${kind}`, async () => {
      const scope = sourceIdentity(playlist);
      const workerKind = kind === "movie" ? "vod" : "series";
      const localHead = await vodPrefetch.getHead(scope, workerKind);
      if (owned !== generation) return;
      if (localHead?.groups?.length) {
        const items = localHead.groups.map((group) => ({
          key: `${kind}:${group.id}`,
          id: group.id,
          kind,
          name: group.name,
          count: group.count,
        }));
        set({
          categories: {
            ...get().categories,
            [kind]: { state: "loaded", items },
          },
          ...(kind === "movie"
            ? { vodGroups: localHead.groups }
            : { seriesGroups: localHead.groups }),
        });
        return;
      }
      const controller = new AbortController();
      controllers.add(controller);
      const held = get().categories[kind];
      set({ categories: { ...get().categories, [kind]: { ...held, state: "loading" } } });
      let timer: number | undefined;
      try {
        const work = async () => {
          const session = await sessionFor(playlist);
          if (controller.signal.aborted || owned !== generation) return [];
          return loadXtreamContentCategories(
            session,
            kind,
            sourceIdentity(playlist),
            controller.signal,
          );
        };
        const items = await Promise.race([
          work(),
          new Promise<never>((_, reject) => {
            timer = window.setTimeout(() => {
              controller.abort();
              reject(new Error("Home category request timed out"));
            }, 15000);
          }),
        ]);
        if (controller.signal.aborted || owned !== generation || get().catalogs[kind]) return;
        set({
          categories: {
            ...get().categories,
            [kind]: { state: items.length ? "loaded" : "empty", items },
          },
        });
      } catch (error) {
        if (owned === generation && !get().catalogs[kind])
          set({
            categories: {
              ...get().categories,
              [kind]: { ...held, state: "failed", error: message(error) },
            },
          });
      } finally {
        window.clearTimeout(timer);
        controllers.delete(controller);
      }
    });
  },

  async loadCategories(kind) {
    return get().loadVodCatalog(kind);
  },

  async loadCategory(categoryKey) {
    const kind = categoryKey.startsWith("movie:")
      ? "movie"
      : categoryKey.startsWith("series:")
        ? "series"
        : undefined;
    if (!selected || !kind) return;
    const current = get().categoryItems[categoryKey];
    const existing = get().catalogs[kind];
    if (
      existing &&
      Date.now() - existing.completedAt < CACHE_TTL_MS &&
      (current?.state === "loaded" || current?.state === "empty")
    )
      return;
    const owned = generation;
    set({
      categoryItems: { ...get().categoryItems, [categoryKey]: { state: "loading", items: [] } },
    });
    await get().loadVodCatalog(kind);
    if (owned !== generation) return;
    const owner = get().catalogs[kind];
    const items = owner?.byCategory.get(categoryKey) ?? [];
    const error = get().searchItems[kind].error;
    set({
      categoryItems: {
        ...get().categoryItems,
        [categoryKey]: {
          state: owner ? (items.length ? "loaded" : "empty") : "failed",
          items,
          error: owner ? undefined : error,
        },
      },
    });
  },

  async loadSearch(kind) {
    return get().loadVodCatalog(kind);
  },

  async loadVodCatalog(kind, forceRefresh = false, checkVersion = false) {
    const playlist = selected;
    if (!playlist) return;
    const held = get().catalogs[kind];
    if (!forceRefresh && held && Date.now() - held.completedAt < CACHE_TTL_MS) {
      const timing = startCatalogTiming(kind);
      timing.record.mode = "memory";
      timing.record.count = held.items.length;
      timing.publish("ready");
      return;
    }
    const scope = sourceIdentity(playlist);
    const workerKind = kind === "movie" ? "vod" : "series";
    return deduplicate(`vod-catalog:${kind}`, async () => {
      const timing = startCatalogTiming(kind);
      const owned = generation;
      const controller = new AbortController();
      controllers.add(controller);
      let finished = false;
      let lastProgressAt = -Infinity;
      const report = (
        phase: CatalogLoadPhase,
        patch: Partial<CatalogLoadProgress> = {},
        force = false,
      ) => {
        if (finished || owned !== generation || controller.signal.aborted) return;
        const now = performance.now();
        if (!force && get().catalogProgress[kind].phase === phase && now - lastProgressAt < 100)
          return;
        lastProgressAt = now;
        set({
          catalogProgress: {
            ...get().catalogProgress,
            [kind]: {
              ...get().catalogProgress[kind],
              state: "loading",
              phase,
              phasePercent: undefined,
              ...patch,
            },
          },
        });
      };
      const progress = (loaded: number, total: number) => ({
        kind,
        state: "loading" as const,
        loaded,
        total,
        percent: total ? Math.min(99, Math.round((loaded / total) * 100)) : 0,
      });
      set({
        catalogProgress: {
          ...get().catalogProgress,
          [kind]: { ...progress(0, 0), phase: "cache" },
        },
        categories: {
          ...get().categories,
          [kind]: { ...get().categories[kind], state: "loading", error: undefined },
        },
        searchItems: {
          ...get().searchItems,
          [kind]: { ...get().searchItems[kind], state: "loading", error: undefined },
        },
      });
      try {
        // Disk browsing needs no authentication; only a miss/refresh needs HTTP.
        const localHead = await vodPrefetch.getHead(scope, workerKind);
        let total = !forceRefresh && localHead ? localHead.count : -1;
        if (owned !== generation || controller.signal.aborted) return;
        timing.phase("cacheRead");
        timing.record.mode = total < 0 ? "network" : "disk";
        if (total >= 0 && localHead?.groups?.length) {
          const cachedCategories = localHead.groups.map((group) => ({
            key: `${kind}:${group.id}`,
            id: group.id,
            kind,
            name: group.name,
            count: group.count,
          }));
          set({
            categories: {
              ...get().categories,
              [kind]: { state: "loaded", items: cachedCategories },
            },
            ...(kind === "movie"
              ? { vodGroups: localHead.groups }
              : { seriesGroups: localHead.groups }),
          });
        }
        if (total < 0) {
          report("connect");
          const session = await sessionFor(playlist);
          timing.phase("authentication");
          if (owned !== generation || controller.signal.aborted) return;
          report("categories");
          const headings = await loadXtreamContentCategories(
            session,
            kind,
            scope,
            controller.signal,
            forceRefresh,
          );
          if (owned !== generation || controller.signal.aborted) return;
          timing.phase("categories");
          // Headings are small and valid independently of the full catalogue.
          // Publish them during transfer, retaining a held catalogue on refresh.
          if (!held)
            set({
              categories: {
                ...get().categories,
                [kind]: { state: "loading", items: headings },
              },
            });
          report("request");
          let probe: VersionCheckResult | null = null;
          try {
            probe = await probeVodVersion(playlist, kind, localHead, controller.signal);
          } catch {
            // Probe is optional; generic Xtream servers still work
          }
          total = await vodPrefetch.fetch({
            playlistId: scope,
            kind: workerKind,
            force: forceRefresh,
            ttl: 0,
            version: probe?.version,
            updatedAt: probe?.updatedAt,
            etag: probe?.etag,
            catsUrl: endpoint(
              session.server,
              session.username,
              session.password,
              kind === "movie" ? "get_vod_categories" : "get_series_categories",
            ),
            listUrl: endpoint(
              session.server,
              session.username,
              session.password,
              kind === "movie" ? "get_vod_streams" : "get_series",
            ),
            signal: controller.signal,
            onProgress: (progress) =>
              report(progress.phase === "download" ? "download" : "parse", {
                loaded: progress.loaded,
                bytes: progress.bytes,
                totalBytes: progress.totalBytes,
                phasePercent:
                  progress.totalBytes > 0
                    ? Math.min(100, Math.round((progress.bytes / progress.totalBytes) * 100))
                    : undefined,
              }),
            onPreparing: () => report("prepare"),
            onTimings: (phases) => Object.assign(timing.record.phases, phases),
            categories: headings.map((category) => ({
              category_id: category.id,
              category_name: category.name,
            })),
          });
          recordVersionChecked(playlist.id, kind);
        }
        if (owned !== generation || controller.signal.aborted) return;
        timing.phase("fetchParseCache");
        report("ingest", { loaded: 0, total, phasePercent: 0 });
        let owner: CatalogIndex | undefined;
        let first = true;
        await vodPrefetch.take(
          scope,
          workerKind,
          0,
          (batch, groups, done) => {
            if (owned !== generation || controller.signal.aborted) return;
            owner ??= new CatalogIndex(scope, kind, groups);
            owner.add(batch);
            // One bounded preview, then progress only. No growing-prefix copies.
            if (first && !held) {
              const preview = owner.items.slice();
              set(
                kind === "movie"
                  ? { vodItems: preview, vodGroups: groups }
                  : { seriesItems: preview, seriesGroups: groups },
              );
            }
            first = false;

            report(
              "ingest",
              {
                ...progress(owner.items.length, total),
                phasePercent: total ? Math.round((owner.items.length / total) * 100) : 100,
              },
              done,
            );
          },
          controller.signal,
          false,
        );
        if (!owner || owned !== generation || controller.signal.aborted) return;
        timing.phase("ingestion");
        report("index", { phasePercent: 0 }, true);
        await owner.finish(controller.signal, (completed, total) =>
          report("index", { phasePercent: Math.round((completed / total) * 100) }, true),
        );
        timing.phase("index");
        if (owned !== generation || controller.signal.aborted) return;
        const items = owner.items;
        const categories = owner.groups.map((group) => ({
          key: `${kind}:${group.id}`,
          id: group.id,
          kind,
          name: group.name,
          count: group.count,
        }));
        const categoryItems = { ...get().categoryItems };
        for (const [key, frame] of Object.entries(categoryItems)) {
          if (!key.startsWith(`${kind}:`)) continue;
          const rows = owner.byCategory.get(key) ?? [];
          categoryItems[key] = {
            ...frame,
            state: rows.length ? "loaded" : "empty",
            items: rows,
            error: undefined,
          };
        }
        set({
          catalogs: { ...get().catalogs, [kind]: owner },
          categoryItems,
          ...(kind === "movie"
            ? { vodItems: items, vodGroups: owner.groups }
            : { seriesItems: items, seriesGroups: owner.groups }),
          categories: {
            ...get().categories,
            [kind]: { state: categories.length ? "loaded" : "empty", items: categories },
          },
          searchItems: {
            ...get().searchItems,
            [kind]: { state: items.length ? "loaded" : "empty", items },
          },
          catalogProgress: {
            ...get().catalogProgress,
            [kind]: {
              kind,
              state: "loaded",
              phase: "ready",
              percent: 100,
              phasePercent: 100,
              loaded: items.length,
              total: items.length,
            },
          },
        });
        timing.phase("publication");
        timing.record.count = items.length;
        timing.publish("ready");

        if (checkVersion && !forceRefresh && total >= 0 && shouldCheckVersion(playlist.id, kind)) {
          void (async () => {
            try {
              const probe = await probeVodVersion(playlist, kind, localHead);
              recordVersionChecked(playlist.id, kind);
              if (probe.status === "changed") {
                void get().loadVodCatalog(kind, true, false);
              }
            } catch {
              // Background check is non-fatal; existing local catalog remains valid
            }
          })();
        }
      } catch (error) {
        timing.publish(controller.signal.aborted ? "cancelled" : "failed");
        if (owned !== generation || controller.signal.aborted) return;
        const detail = message(error);
        set({
          ...(!held
            ? kind === "movie"
              ? { vodItems: [], vodGroups: [] }
              : { seriesItems: [], seriesGroups: [] }
            : {}),
          categories: {
            ...get().categories,
            [kind]: { ...get().categories[kind], state: "failed", error: detail },
          },
          searchItems: {
            ...get().searchItems,
            [kind]: { ...get().searchItems[kind], state: "failed", error: detail },
          },
          catalogProgress: {
            ...get().catalogProgress,
            [kind]: {
              ...get().catalogProgress[kind],
              state: "failed",
              phase: "failed",
              error: detail,
            },
          },
        });
      } finally {
        finished = true;
        controllers.delete(controller);
      }
    });
  },

  async loadMovie(movieKey, forceRefresh = false) {
    const playlist = selected;
    if (!playlist) return;
    const current = get().movieDetails[movieKey];
    if (current?.state === "loading" || (!forceRefresh && current?.state === "loaded")) return;
    return deduplicate(movieKey, async () => {
      const owned = generation;
      set({
        movieDetails: {
          ...get().movieDetails,
          [movieKey]: { ...current, state: "loading", error: undefined },
        },
      });
      const id = providerId(movieKey, "movie");
      if (!id) {
        set({
          movieDetails: {
            ...get().movieDetails,
            [movieKey]: { state: "failed", error: "Movie details are unavailable" },
          },
        });
        return;
      }
      const key = detailCacheKey(playlist, "movie", id);
      const refresh = async () => {
        const controller = new AbortController();
        controllers.add(controller);
        try {
          const session = await sessionFor(playlist);
          const value = await loadXtreamMovieDetail(
            session,
            sourceIdentity(playlist),
            id,
            controller.signal,
          );
          if (owned !== generation || controller.signal.aborted) return;
          set({
            movieDetails: { ...get().movieDetails, [movieKey]: { state: "loaded", value } },
          });
          persistCache(key, JSON.stringify(value), owned);
        } catch (error) {
          if (owned === generation && !controller.signal.aborted) {
            set({
              movieDetails: {
                ...get().movieDetails,
                [movieKey]: {
                  ...get().movieDetails[movieKey],
                  state: "failed",
                  error: message(error),
                },
              },
            });
          }
        } finally {
          controllers.delete(controller);
        }
      };
      const fromCache = forceRefresh ? null : await cached<XtreamMovieDetail>(key);
      if (owned !== generation) return;
      if (fromCache) {
        set({
          movieDetails: {
            ...get().movieDetails,
            [movieKey]: { state: "loaded", value: fromCache },
          },
        });
        if (!fresh(key)) refreshWhenIdle(key, owned, refresh);
        return;
      }
      await refresh();
    });
  },

  async loadSeries(seriesKey, forceRefresh = false) {
    const playlist = selected;
    if (!playlist) return;
    const current = get().seriesDetails[seriesKey];
    if (current?.state === "loading" || (!forceRefresh && current?.state === "loaded")) return;
    return deduplicate(seriesKey, async () => {
      const owned = generation;
      set({
        seriesDetails: {
          ...get().seriesDetails,
          [seriesKey]: { ...current, state: "loading", error: undefined },
        },
      });
      const id = providerId(seriesKey, "series");
      if (!id) {
        set({
          seriesDetails: {
            ...get().seriesDetails,
            [seriesKey]: { state: "failed", error: "Series details are unavailable" },
          },
        });
        return;
      }
      const key = detailCacheKey(playlist, "series", id);
      const refresh = async () => {
        const controller = new AbortController();
        controllers.add(controller);
        try {
          const session = await sessionFor(playlist);
          const value = await loadXtreamSeriesDetail(
            session,
            sourceIdentity(playlist),
            id,
            controller.signal,
          );
          if (owned !== generation || controller.signal.aborted) return;
          set({
            seriesDetails: { ...get().seriesDetails, [seriesKey]: { state: "loaded", value } },
          });
          persistCache(key, JSON.stringify(value), owned);
        } catch (error) {
          if (owned === generation && !controller.signal.aborted) {
            set({
              seriesDetails: {
                ...get().seriesDetails,
                [seriesKey]: {
                  ...get().seriesDetails[seriesKey],
                  state: "failed",
                  error: message(error),
                },
              },
            });
          }
        } finally {
          controllers.delete(controller);
        }
      };
      const fromCache = forceRefresh ? null : await cached<XtreamSeriesDetail>(key);
      if (owned !== generation) return;
      if (fromCache) {
        set({
          seriesDetails: {
            ...get().seriesDetails,
            [seriesKey]: { state: "loaded", value: fromCache },
          },
        });
        if (!fresh(key)) refreshWhenIdle(key, owned, refresh);
        return;
      }
      await refresh();
    });
  },

  async loadGuide(channel) {
    const playlist = selected;
    const metadata = channel.xtream;
    if (!playlist || !metadata || metadata.playlistId !== playlist.id) return;
    const held = get().guides[channel.id];
    if (held?.fetchedAt && Date.now() - held.fetchedAt <= GUIDE_TTL_MS) return;
    if (guideChannelId === channel.id && guideController) return;

    if (guideController) {
      guideController.abort();
      const abandoned = get().guides[guideChannelId];
      if (abandoned?.state === "loading") {
        set({ guides: { ...get().guides, [guideChannelId]: emptyGuide() } });
      }
    }
    const controller = new AbortController();
    guideController = controller;
    guideChannelId = channel.id;
    const owned = generation;
    const timeout = window.setTimeout(() => {
      controller.abort();
      if (guideController !== controller || owned !== generation) return;
      guideController = undefined;
      guideChannelId = "";
      set({
        guides: {
          ...get().guides,
          [channel.id]: {
            ...held,
            state: "failed",
            items: held?.items ?? [],
            error: "Guide request timed out",
          },
        },
      });
    }, 15000);
    set({
      guides: {
        ...get().guides,
        [channel.id]: { state: "loading", items: held?.items ?? [] },
      },
    });
    try {
      const session = await sessionFor(playlist);
      if (controller.signal.aborted || owned !== generation) return;
      const rawProgrammes = await loadXtreamGuide(session, metadata.streamId, controller.signal);
      if (controller.signal.aborted || owned !== generation) return;
      const offsetSeconds = getGuideTimeOffsetSeconds(useSettings.getState().guideTimeOffset);
      const programmes = applyGuideOffset(rawProgrammes, offsetSeconds);
      if (controller.signal.aborted || owned !== generation) return;
      const now = Math.floor(Date.now() / 1000);
      const items: GuideProgramme[] = programmes
        .map((programme) => {
          const target = catchupTarget(playlist, session, channel, programme, now);
          return target ? { ...programme, target } : programme;
        })
        .sort(
          (left, right) =>
            (left.startTimestamp ?? Number.MAX_SAFE_INTEGER) -
            (right.startTimestamp ?? Number.MAX_SAFE_INTEGER),
        );
      const current = items.find(
        (programme) =>
          programme.startTimestamp !== undefined &&
          programme.stopTimestamp !== undefined &&
          programme.startTimestamp <= now &&
          programme.stopTimestamp > now,
      );
      const nextAfter = current?.stopTimestamp ?? now;
      const next = items.find(
        (programme) =>
          programme !== current &&
          programme.startTimestamp !== undefined &&
          programme.startTimestamp >= nextAfter,
      );
      set({
        guides: {
          ...get().guides,
          [channel.id]: {
            state: items.length ? "loaded" : "empty",
            items,
            ...(current ? { current } : {}),
            ...(next ? { next } : {}),
            fetchedAt: Date.now(),
          },
        },
      });
    } catch (error) {
      if (!controller.signal.aborted && owned === generation) {
        set({
          guides: {
            ...get().guides,
            [channel.id]: {
              ...held,
              state: "failed",
              items: held?.items ?? [],
              error: message(error),
            },
          },
        });
      }
    } finally {
      window.clearTimeout(timeout);
      if (guideController === controller) {
        guideController = undefined;
        guideChannelId = "";
      }
    }
  },

  guideFor(channelId) {
    return get().guides[channelId] ?? emptyGuide();
  },

  clearGuides() {
    set({ guides: {} });
  },

  async loadBatchGuides(channels) {
    const playlist = selected;
    if (!playlist) return;
    const nowMs = Date.now();
    const pendingChannels = channels.filter((channel) => {
      const metadata = channel.xtream;
      if (!metadata || metadata.playlistId !== playlist.id) return false;
      const held = get().guides[channel.id];
      return !held?.fetchedAt || nowMs - held.fetchedAt > BATCH_EPG_TTL_MS;
    });
    if (!pendingChannels.length) return;

    const controller = new AbortController();
    controllers.add(controller);
    const owned = generation;
    try {
      const session = await sessionFor(playlist);
      if (controller.signal.aborted || owned !== generation) return;
      const streamIds = pendingChannels
        .map((channel) => channel.xtream?.streamId ?? "")
        .filter(Boolean);
      const offsetSeconds = getGuideTimeOffsetSeconds(useSettings.getState().guideTimeOffset);
      const batch = await fetchBatchEpg(
        session.server,
        session.token ?? session.username,
        streamIds,
        {
          signal: controller.signal,
          fallbackSession: session,
          guideOffsetSeconds: offsetSeconds,
        },
      );
      if (controller.signal.aborted || owned !== generation) return;

      const nowSeconds = Math.floor(Date.now() / 1000);
      const nextGuides = { ...get().guides };
      const fetchedAt = Date.now();
      for (const channel of pendingChannels) {
        const streamId = channel.xtream?.streamId;
        if (!streamId) continue;
        const snapshot = batch[streamId];
        if (!snapshot) continue;
        const items: GuideProgramme[] = snapshot.programmes.map((programme) => {
          const target = catchupTarget(playlist, session, channel, programme, nowSeconds);
          return target ? { ...programme, target } : programme;
        });
        const current = items.find((item) => item.id === snapshot.current?.id);
        const next = items.find((item) => item.id === snapshot.next?.id);
        nextGuides[channel.id] = {
          state: items.length ? "loaded" : "empty",
          items,
          ...(current ? { current } : {}),
          ...(next ? { next } : {}),
          fetchedAt,
        };
      }
      set({ guides: nextGuides });
    } catch {
      // Ignore background batch EPG errors so UI navigation is unaffected
    } finally {
      controllers.delete(controller);
    }
  },

  async retry(frameKey) {
    if (frameKey === "categories:movie" || frameKey === "categories:series") {
      const kind = frameKey.slice("categories:".length) as LibraryKind;
      set({ categories: { ...get().categories, [kind]: emptyList() } });
      return get().loadVodCatalog(kind, true);
    }
    if (frameKey === "vod:movie" || frameKey === "vod:series") {
      const kind = frameKey.slice("vod:".length) as "movie" | "series";
      return get().loadVodCatalog(kind, true);
    }
    if (frameKey === "search:movie" || frameKey === "search:series") {
      const kind = frameKey.slice("search:".length) as LibraryKind;
      set({ searchItems: { ...get().searchItems, [kind]: emptyList() } });
      return get().loadVodCatalog(kind, true);
    }
    if (frameKey.startsWith("movie:") || frameKey.startsWith("series:")) {
      const categoryItems = { ...get().categoryItems };
      delete categoryItems[frameKey];
      set({ categoryItems });
      return get().loadCategory(frameKey);
    }
    if (frameKey.includes(":movie:")) {
      return get().loadMovie(frameKey, true);
    }
    if (frameKey.includes(":series:")) {
      return get().loadSeries(frameKey, true);
    }
  },

  clear() {
    resetCatalogTimings();
    useVodBrowse.getState().reset();
    abortRequests();
    selected = undefined;
    set({
      playlistId: "",
      sourceKey: "",
      sourceVersion: 0,
      categories: initialCategories(),
      categoryItems: {},
      searchItems: initialSearch(),
      movieDetails: {},
      seriesDetails: {},
      guides: {},
      catalogs: {},
      vodItems: [],
      seriesItems: [],
      vodGroups: [],
      seriesGroups: [],

      catalogProgress: initialCatalogProgress(),
    });
  },
}));
