import { sourceIdentity, mediaKey } from "../src/services/mediaIdentity";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { XtreamSource } from "../src/services/playlistUrl";
import type { Playlist } from "../src/stores/settings";
import type { Channel } from "../src/types";

const disk = new Map<string, string | Blob>();

const source: XtreamSource = {
  kind: "xtream",
  server: "http://provider.example",
  username: "viewer",
  password: "secret",
  output: "m3u8",
};

const playlist = (id = "pl-1", sourceVersion = 1): Playlist => ({
  id,
  name: "Provider",
  source,
  sourceVersion,
  hiddenCategories: [],
  hiddenCategoryMode: "exclude",
});

const scope = sourceIdentity(playlist());

const response = (body: unknown) => ({ ok: true, status: 200, json: async () => body });

const provider = (overrides: Record<string, unknown> = {}) =>
  vi.fn(async (input: string | URL) => {
    const url = new URL(String(input));
    const action = url.searchParams.get("action") ?? "authenticate";
    const defaults: Record<string, unknown> = {
      authenticate: {
        user_info: { auth: 1, status: "Active" },
        server_info: { server_protocol: "http", url: "provider.example" },
      },
      get_live_categories: [],
      get_vod_categories: [{ category_id: "10", category_name: "Provider Movies" }],
      get_series_categories: [{ category_id: "20", category_name: "Provider Series" }],
      get_vod_streams: [
        {
          stream_id: "100",
          category_id: "10",
          name: "Provider Movie Name",
          container_extension: "mp4",
        },
      ],
      get_series: [{ series_id: "200", category_id: "20", name: "Provider Series Name" }],
      get_vod_info: {
        info: { name: "Provider Movie Name", plot: "Movie plot" },
        movie_data: { stream_id: "100", category_id: "10", container_extension: "mp4" },
      },
      get_series_info: {
        info: { name: "Provider Series Name", category_id: "20" },
        episodes: {
          "2": [
            { id: "202", episode_num: 1, title: "Second season", container_extension: "mkv" },
          ],
          "1": [{ id: "201", episode_num: 1, title: "Pilot", container_extension: "mp4" }],
        },
      },
    };
    return response(action in overrides ? overrides[action] : defaults[action]);
  });

async function loadStore() {
  vi.resetModules();
  // Exercise the real catalog parser/cache/prefetch with this provider fixture.
  // XHR abort/deadline behavior has dedicated transport tests.
  vi.doMock("../src/services/catalogTransport", () => ({
    MAX_CATALOG_BYTES: 64 * 1024 * 1024,
    httpRequest: async (url: string, type: string, _timeout: number, signal?: AbortSignal) => {
      const reply = await fetch(url, { signal });
      const body = await reply.json();
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      const text = JSON.stringify(body);
      return type === "arraybuffer" ? new TextEncoder().encode(text).buffer : text;
    },
  }));
  vi.doMock("../src/services/disk", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../src/services/disk")>()),
    read: async (key: string) => disk.get(key) ?? null,
    write: async (key: string, value: string | Blob) => {
      disk.set(key, value);
      return true;
    },
  }));
  return import("../src/stores/library");
}

beforeEach(() => {
  localStorage.clear();
  disk.clear();
  vi.unstubAllGlobals();
});

afterEach(() => vi.useRealTimers());

test("movie and series categories authenticate lazily and preserve provider names", async () => {
  const fetch = provider();
  vi.stubGlobal("fetch", fetch);
  const { useLibrary } = await loadStore();

  useLibrary.getState().selectPlaylist(playlist());
  expect(fetch).not.toHaveBeenCalled();

  await useLibrary.getState().loadCategories("movie");
  expect(useLibrary.getState().categories.movie).toMatchObject({
    state: "loaded",
    items: [{ key: "movie:10", name: "Provider Movies" }],
  });

  await useLibrary.getState().loadCategories("series");
  expect(useLibrary.getState().categories.series).toMatchObject({
    state: "loaded",
    items: [{ key: "series:20", name: "Provider Series" }],
  });
  expect(
    fetch.mock.calls.filter(([input]) => !new URL(String(input)).searchParams.get("action")),
  ).toHaveLength(1);
});

test("duplicate requests share one category load and remember an empty category", async () => {
  const fetch = provider({ get_vod_streams: [] });
  vi.stubGlobal("fetch", fetch);
  const { useLibrary } = await loadStore();
  useLibrary.getState().selectPlaylist(playlist());

  await Promise.all([
    useLibrary.getState().loadCategories("movie"),
    useLibrary.getState().loadCategories("movie"),
  ]);
  await Promise.all([
    useLibrary.getState().loadCategory("movie:10"),
    useLibrary.getState().loadCategory("movie:10"),
  ]);
  await useLibrary.getState().loadCategory("movie:10");

  expect(
    fetch.mock.calls.filter(
      ([input]) => new URL(String(input)).searchParams.get("action") === "get_vod_streams",
    ),
  ).toHaveLength(1);
  expect(useLibrary.getState().categoryItems["movie:10"]).toMatchObject({
    state: "empty",
    items: [],
  });
});

test("switching playlists cancels older writes", async () => {
  let settleMovies: ((value: ReturnType<typeof response>) => void) | undefined;
  const fetch = provider();
  fetch.mockImplementation(async (input: string | URL) => {
    const action = new URL(String(input)).searchParams.get("action") ?? "authenticate";
    if (action === "get_vod_streams") {
      return new Promise<ReturnType<typeof response>>((resolve) => {
        settleMovies = resolve;
      });
    }
    return provider()(input);
  });
  vi.stubGlobal("fetch", fetch);
  const { useLibrary } = await loadStore();
  useLibrary.getState().selectPlaylist(playlist("old"));
  const pending = useLibrary.getState().loadCategory("movie:10");
  await vi.waitFor(() => expect(settleMovies).toBeDefined());

  useLibrary.getState().selectPlaylist(playlist("new"));
  settleMovies?.(response([{ stream_id: "100", category_id: "10", name: "Old Movie" }]));
  await pending;

  expect(useLibrary.getState().playlistId).toBe("new");
  expect(useLibrary.getState().categoryItems["movie:10"]).toBeUndefined();
});

test("editing a server without changing playlist ID/version cannot reuse catalog, session or playback ownership", async () => {
  const fetch = provider();
  vi.stubGlobal("fetch", fetch);
  const { useLibrary, libraryPlaybackUrl } = await loadStore();
  const a = playlist();
  useLibrary.getState().selectPlaylist(a);
  await useLibrary.getState().loadCategory("movie:10");
  const old = useLibrary.getState().categoryItems["movie:10"].items[0];
  const b: Playlist = {
    ...a,
    source: { ...source, server: "http://other.invalid", password: "changed" },
  };
  useLibrary.getState().selectPlaylist(b);
  expect(useLibrary.getState().categoryItems).toEqual({});
  await expect(
    libraryPlaybackUrl(old as import("../src/services/xtream").XtreamMovie),
  ).rejects.toThrow("another source");
  await useLibrary.getState().loadCategory("movie:10");
  const next = useLibrary.getState().categoryItems["movie:10"].items[0];
  expect(next.key).not.toBe(old.key);
  expect(
    fetch.mock.calls.filter(
      ([input]) => new URL(String(input)).searchParams.get("action") === "get_vod_streams",
    ),
  ).toHaveLength(2);
});

test("canceling a guide during authentication does not fail a concurrent category load", async () => {
  let authenticationRequests = 0;
  let authenticationSignal: AbortSignal | null = null;
  let settleAuthentication: ((value: ReturnType<typeof response>) => void) | undefined;
  const live = (streamId: string): Channel => ({
    id: `xtream:pl-1:live:${streamId}`,
    name: `Live ${streamId}`,
    logo: "",
    group: "live:1",
    url: `http://provider.example/live/${streamId}.m3u8`,
    quality: "",
    number: Number(streamId),
    xtream: {
      playlistId: "pl-1",
      streamId,
      categoryKey: "live:1",
      archiveDays: 0,
      directSource: "",
    },
  });
  const fetch = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const action = new URL(String(input)).searchParams.get("action") ?? "authenticate";
    if (action === "authenticate") {
      authenticationRequests += 1;
      if (authenticationRequests === 1) {
        authenticationSignal = init?.signal ?? null;
        return new Promise<ReturnType<typeof response>>((resolve, reject) => {
          settleAuthentication = resolve;
          const abort = () => reject(new DOMException("Aborted", "AbortError"));
          if (init?.signal?.aborted) abort();
          else init?.signal?.addEventListener("abort", abort);
        });
      }
      return response({
        user_info: { auth: 1, status: "Active" },
        server_info: { server_protocol: "http", url: "provider.example" },
      });
    }
    if (action === "get_vod_streams") {
      return response([
        {
          stream_id: "100",
          category_id: "10",
          name: "Provider Movie Name",
          container_extension: "mp4",
        },
      ]);
    }
    if (action === "get_short_epg") return response({ epg_listings: [] });
    return response([]);
  });
  vi.stubGlobal("fetch", fetch);
  const { useLibrary } = await loadStore();
  useLibrary.getState().selectPlaylist(playlist());

  const abandonedGuide = useLibrary.getState().loadGuide(live("1"));
  await Promise.resolve();
  const category = useLibrary.getState().loadCategory("movie:10");
  await Promise.resolve();
  await Promise.resolve();
  expect(authenticationRequests).toBe(1);

  const currentGuide = useLibrary.getState().loadGuide(live("2"));
  expect(authenticationSignal?.aborted).toBe(false);
  settleAuthentication?.(
    response({
      user_info: { auth: 1, status: "Active" },
      server_info: { server_protocol: "http", url: "provider.example" },
    }),
  );
  await Promise.all([abandonedGuide, category, currentGuide]);

  expect(authenticationRequests).toBe(1);
  expect(useLibrary.getState().categoryItems["movie:10"]).toMatchObject({
    state: "loaded",
    items: [{ name: "Provider Movie Name" }],
  });
});

test("a movie category failure is isolated and Retry reloads only that frame", async () => {
  let fail = true;
  const fetch = provider();
  fetch.mockImplementation(async (input: string | URL) => {
    const action = new URL(String(input)).searchParams.get("action") ?? "authenticate";
    if (action === "get_vod_streams" && fail) {
      fail = false;
      throw new Error("Movies unavailable");
    }
    return provider()(input);
  });
  vi.stubGlobal("fetch", fetch);
  const { useLibrary } = await loadStore();
  useLibrary.getState().selectPlaylist(playlist());
  await useLibrary.getState().loadCategories("series");
  await useLibrary.getState().loadCategory("movie:10");

  expect(useLibrary.getState().categoryItems["movie:10"]).toMatchObject({ state: "failed" });
  expect(useLibrary.getState().categories.series.state).toBe("loaded");

  await useLibrary.getState().retry("movie:10");
  expect(useLibrary.getState().categoryItems["movie:10"].state).toBe("loaded");
});

test("a complete source-scoped catalog serves categories/search offline without authentication", async () => {
  const fetch = provider();
  vi.stubGlobal("fetch", fetch);
  const { useLibrary } = await loadStore();
  useLibrary.getState().selectPlaylist(playlist());
  const { saveResult, releaseResult } = await import("../src/services/vodCache");
  const { readWhole } = await import("../src/workers/vodWorker");
  await saveResult(
    `vod:${scope}`,
    readWhole(
      new TextEncoder().encode(
        JSON.stringify([
          {
            stream_id: 100,
            category_id: 10,
            name: "Cached Provider Name",
            container_extension: "mkv",
          },
        ]),
      ),
      "vod",
      [{ category_id: 10, category_name: "Cached Movies" }],
    ),
  );
  releaseResult(`vod:${scope}`);
  await Promise.all([
    useLibrary.getState().loadCategory("movie:10"),
    useLibrary.getState().loadSearch("movie"),
    useLibrary.getState().loadCategories("movie"),
  ]);
  const state = useLibrary.getState();
  expect(state.categoryItems["movie:10"].items[0].name).toBe("Cached Provider Name");
  expect(state.searchItems.movie.items).toBe(state.vodItems);
  expect(state.categoryItems["movie:10"].items[0]).toBe(state.vodItems[0]);
  expect(fetch).not.toHaveBeenCalled();
});

test("legacy per-category cache cannot masquerade as the complete shared catalog", async () => {
  disk.set(`xtream:${scope}:movie-category:10`, JSON.stringify([{ name: "Old partial" }]));
  const fetch = provider();
  vi.stubGlobal("fetch", fetch);
  const { useLibrary } = await loadStore();
  useLibrary.getState().selectPlaylist(playlist());
  await useLibrary.getState().loadCategory("movie:10");
  await useLibrary.getState().loadSearch("movie");
  await useLibrary.getState().loadVodCatalog("movie");
  expect(useLibrary.getState().vodItems[0].name).toBe("Provider Movie Name");
  expect(
    fetch.mock.calls.filter(
      ([input]) => new URL(String(input)).searchParams.get("action") === "get_vod_streams",
    ),
  ).toHaveLength(1);
});

test("stale detail cache still renders first and refreshes once while idle", async () => {
  vi.useFakeTimers();
  const detailKey = `xtream:${scope}:movie:100`;
  disk.set(
    detailKey,
    JSON.stringify({
      key: mediaKey(scope, "movie", "100"),
      streamId: "100",
      categoryKey: "movie:10",
      name: "Stale movie",
      logo: "",
      extension: "mp4",
      year: "",
      rating: "",
      plot: "Stale plot",
      cast: "",
      director: "",
      genre: "",
      releaseDate: "",
    }),
  );
  localStorage.setItem(`openiptv.at.${detailKey}`, String(Date.now() - 7 * 60 * 60 * 1000));
  const fetch = provider();
  vi.stubGlobal("fetch", fetch);
  const { useLibrary } = await loadStore();
  useLibrary.getState().selectPlaylist(playlist());
  await useLibrary.getState().loadMovie(mediaKey(scope, "movie", "100"));
  await useLibrary.getState().loadMovie(mediaKey(scope, "movie", "100"));
  expect(useLibrary.getState().movieDetails[mediaKey(scope, "movie", "100")].value?.plot).toBe(
    "Stale plot",
  );
  expect(fetch).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(500);
  expect(useLibrary.getState().movieDetails[mediaKey(scope, "movie", "100")].value?.plot).toBe(
    "Movie plot",
  );
  expect(
    fetch.mock.calls.filter(
      ([input]) => new URL(String(input)).searchParams.get("action") === "get_vod_info",
    ),
  ).toHaveLength(1);
});

test("movie details and series seasons and episodes are cached independently", async () => {
  vi.stubGlobal("fetch", provider());
  const { useLibrary } = await loadStore();
  useLibrary.getState().selectPlaylist(playlist());
  await useLibrary.getState().loadCategories("movie");
  await useLibrary.getState().loadCategory("movie:10");
  await useLibrary.getState().loadMovie(mediaKey(scope, "movie", "100"));

  expect(useLibrary.getState().movieDetails[mediaKey(scope, "movie", "100")]).toMatchObject({
    state: "loaded",
    value: { name: "Provider Movie Name", plot: "Movie plot" },
  });

  await useLibrary.getState().loadCategories("series");
  await useLibrary.getState().loadCategory("series:20");
  await useLibrary.getState().loadSeries(mediaKey(scope, "series", "200"));
  const detail = useLibrary.getState().seriesDetails[mediaKey(scope, "series", "200")];
  expect(detail).toMatchObject({ state: "loaded", value: { name: "Provider Series Name" } });
  expect(detail.value?.episodes.map((episode) => [episode.season, episode.name])).toEqual([
    [1, "Pilot"],
    [2, "Second season"],
  ]);
  await vi.waitFor(() => {
    expect(disk.has(`xtream:${scope}:movie:100`)).toBe(true);
    expect(disk.has(`xtream:${scope}:series:200`)).toBe(true);
  });
});

test("a favourite snapshot opens details before its category has loaded", async () => {
  localStorage.setItem(
    "openiptv.personal",
    JSON.stringify({
      favourites: [
        {
          itemKey: mediaKey(scope, "movie", "100"),
          playlistId: "pl-1",
          kind: "movie",
          providerId: "100",
          categoryKey: "movie:10",
          name: "Saved Provider Name",
          logo: "",
          extension: "mp4",
        },
      ],
      lastPlayed: null,
      progress: [],
    }),
  );
  vi.stubGlobal("fetch", provider());
  const { useLibrary } = await loadStore();
  useLibrary.getState().selectPlaylist(playlist());

  await useLibrary.getState().loadMovie(mediaKey(scope, "movie", "100"));

  expect(useLibrary.getState().movieDetails[mediaKey(scope, "movie", "100")].state).toBe(
    "loaded",
  );
  expect(useLibrary.getState().categoryItems["movie:10"]).toBeUndefined();
});

test("20k oversized series share one uncached owner across categories, search and retained views", async () => {
  const entries = Array.from({ length: 20000 }, (_, index) => ({
    series_id: index + 1,
    category_id: index % 2 ? "20" : "21",
    name: `Series ${index}`,
    plot: "x".repeat(900),
  }));
  const fetch = provider({
    get_series: entries,
    get_series_categories: [
      { category_id: "20", category_name: "Same" },
      { category_id: "21", category_name: "Same" },
    ],
  });
  vi.stubGlobal("fetch", fetch);
  const { useLibrary } = await loadStore();
  useLibrary.getState().selectPlaylist(playlist());
  const { vodPrefetch } = await import("../src/services/vodPrefetch");
  const take = vi.spyOn(vodPrefetch, "take");
  const publications: number[] = [];
  let last: unknown;
  const stop = useLibrary.subscribe((state) => {
    if (state.seriesItems !== last) {
      last = state.seriesItems;
      publications.push(state.seriesItems.length);
    }
  });
  await Promise.all([
    useLibrary.getState().loadCategories("series"),
    useLibrary.getState().loadSearch("series"),
    useLibrary.getState().loadCategory("series:20"),
  ]);
  const owner = useLibrary.getState().catalogs.series!;
  expect(owner.items).toHaveLength(20000);
  expect(owner.maxIngestBatch).toBe(250);
  expect(useLibrary.getState().searchItems.series.items).toBe(owner.items);
  expect(useLibrary.getState().seriesItems).toBe(owner.items);
  expect(publications.filter((count) => count > 0)).toEqual([250, 20000]);
  await useLibrary.getState().loadCategory("series:21");
  await useLibrary.getState().loadSearch("series");
  await useLibrary.getState().loadVodCatalog("series");
  expect(take).toHaveBeenCalledOnce();
  expect(useLibrary.getState().categoryItems["series:21"].items).toHaveLength(10000);
  const actions = fetch.mock.calls.map(([input]) =>
    new URL(String(input)).searchParams.get("action"),
  );
  expect(actions.filter((action) => action === "get_series")).toHaveLength(1);
  expect(actions.filter((action) => action === "get_series_categories")).toHaveLength(1);
  expect(await vodPrefetch.cached(scope, "series")).toBe(false);
  stop();
  take.mockRestore();
}, 20000);

test("Home headings load without downloading either catalogue and deduplicate requests", async () => {
  const fetch = provider();
  vi.stubGlobal("fetch", fetch);
  const { useLibrary } = await loadStore();
  useLibrary.getState().selectPlaylist(playlist());
  await Promise.all([
    useLibrary.getState().loadHomeCategories("movie"),
    useLibrary.getState().loadHomeCategories("movie"),
    useLibrary.getState().loadHomeCategories("series"),
  ]);
  expect(useLibrary.getState().categories.movie.items).toHaveLength(1);
  expect(useLibrary.getState().categories.series.items).toHaveLength(1);
  expect(useLibrary.getState().catalogs).toEqual({});
  const actions = fetch.mock.calls.map(([url]) =>
    new URL(String(url)).searchParams.get("action"),
  );
  expect(actions.filter((action) => action === "get_vod_categories")).toHaveLength(1);
  expect(actions).not.toContain("get_vod_streams");
  expect(actions).not.toContain("get_series");
});

test("expired hover guide requests release ownership after a stalled fetch", async () => {
  vi.useFakeTimers();
  const base = provider({ get_short_epg: { epg_listings: [] } });
  let stalled = true;
  const fetch = vi.fn(async (input: string | URL) => {
    if (new URL(String(input)).searchParams.get("action") === "get_short_epg" && stalled)
      return new Promise<ReturnType<typeof response>>(() => {});
    return base(input);
  });
  vi.stubGlobal("fetch", fetch);
  const { useLibrary } = await loadStore();
  useLibrary.getState().selectPlaylist(playlist());
  const channel: Channel = {
    id: "hover",
    name: "Hover",
    logo: "",
    group: "News",
    url: "http://provider.example/live",
    number: 1,
    xtream: {
      playlistId: "pl-1",
      streamId: "1",
      categoryKey: "live:1",
      archiveDays: 0,
      directSource: "",
    },
  };
  const held = {
    state: "loaded" as const,
    items: [{ id: "held", title: "Still usable", start: "", end: "", archived: false }],
    fetchedAt: Date.now() - 300001,
  };
  useLibrary.setState({ guides: { hover: held } });
  void useLibrary.getState().loadGuide(channel);
  await vi.advanceTimersByTimeAsync(15000);
  expect(useLibrary.getState().guides.hover.state).toBe("failed");
  expect(useLibrary.getState().guides.hover.items[0].title).toBe("Still usable");
  stalled = false;
  await useLibrary.getState().loadGuide(channel);
  expect(useLibrary.getState().guides.hover.state).toBe("empty");
});
