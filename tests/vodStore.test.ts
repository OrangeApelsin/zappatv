import { beforeEach, describe, expect, it, test, vi } from "vitest";
import { vodPrefetch } from "../src/services/vodPrefetch";
import { useLibrary } from "../src/stores/library";
import type { Playlist } from "../src/stores/settings";

const TEST_PLAYLIST: Playlist = {
  id: "pl_vod_store_1",
  name: "Xtream VOD Test",
  createdAt: 1000,
  sourceVersion: 1,
  source: {
    kind: "xtream",
    server: "http://tv.example:8080",
    username: "testuser",
    password: "testpass",
    output: "ts",
  },
};

describe("VOD Store Progressive Ingestion & State Machine", () => {
  beforeEach(() => {
    useLibrary.getState().clear();
    vi.restoreAllMocks();
    globalThis.fetch = vi.fn().mockImplementation(async (input: string | URL) => ({
      ok: true,
      status: 200,
      json: async () =>
        new URL(String(input)).searchParams.get("action")?.endsWith("categories")
          ? []
          : {
              user_info: { auth: 1, status: "Active" },
              server_info: { server_protocol: "http", url: "tv.example:8080" },
            },
    }));
  });

  it("forced refresh bypasses freshness without deleting the last valid cache", async () => {
    useLibrary.getState().selectPlaylist(TEST_PLAYLIST);
    const clear = vi.spyOn(vodPrefetch, "clear");
    const fetch = vi.spyOn(vodPrefetch, "fetch").mockResolvedValue(0);
    vi.spyOn(vodPrefetch, "take").mockImplementation(async (_pid, _kind, _ttl, onChunk) => {
      onChunk?.([], [], true);
      return { items: [], groups: [] };
    });
    await useLibrary.getState().loadVodCatalog("movie", true);
    expect(fetch).toHaveBeenCalledWith(expect.objectContaining({ force: true }));
    expect(clear).not.toHaveBeenCalled();
  });

  it("initializes with empty VOD slices and idle progress", () => {
    const state = useLibrary.getState();
    expect(state.vodItems).toEqual([]);
    expect(state.seriesItems).toEqual([]);
    expect(state.vodGroups).toEqual([]);
    expect(state.seriesGroups).toEqual([]);
    expect(state.catalogProgress.movie).toMatchObject({
      kind: "movie",
      state: "idle",
      percent: 0,
      loaded: 0,
      total: 0,
    });
  });

  it("selectPlaylist sets playlistId and resets state", () => {
    useLibrary.getState().selectPlaylist(TEST_PLAYLIST);
    const state = useLibrary.getState();
    expect(state.playlistId).toBe("pl_vod_store_1");
    expect(state.catalogProgress.movie.state).toBe("idle");
  });

  it("progressively streams VOD chunks into vodItems and groups", async () => {
    useLibrary.getState().selectPlaylist(TEST_PLAYLIST);

    // Mock vodPrefetch fetch & take
    vi.spyOn(vodPrefetch, "fetch").mockResolvedValue(2);
    vi.spyOn(vodPrefetch, "take").mockImplementation(async (_pid, _kind, _ttl, onChunk) => {
      const chunk1 = [
        {
          kind: "movie" as const,
          name: "The Matrix",
          skey: "the matrix",
          key: "v101",
          streamId: "101",
          logo: "https://img.example/matrix.jpg",
          group: "Action",
          categoryId: "1",
          num: 1,
          ext: "mp4",
          rating: "8.7",
          year: "1999",
        },
      ];
      const groups = [{ id: "Action", name: "Action", count: 2 }];
      onChunk?.(chunk1, groups, false);

      const chunk2 = [
        {
          kind: "movie" as const,
          name: "John Wick",
          skey: "john wick",
          key: "v102",
          streamId: "102",
          logo: "https://img.example/wick.jpg",
          group: "Action",
          categoryId: "1",
          num: 2,
          ext: "mp4",
          rating: "7.4",
          year: "2014",
        },
      ];
      onChunk?.(chunk2, groups, true);

      return { items: [...chunk1, ...chunk2], groups };
    });

    await useLibrary.getState().loadVodCatalog("movie");

    const state = useLibrary.getState();
    expect(state.vodItems.length).toBe(2);
    expect(state.vodItems[0].name).toBe("The Matrix");
    expect(state.vodItems[1].name).toBe("John Wick");
    expect(state.vodGroups.length).toBe(1);
    expect(state.vodGroups[0].name).toBe("Action");

    expect(state.catalogProgress.movie).toMatchObject({
      kind: "movie",
      state: "loaded",
      percent: 100,
      loaded: 2,
      total: 2,
    });

    // Verify searchItems was also populated with converted items
    const searchMovies = state.searchItems.movie;
    expect(searchMovies.state).toBe("loaded");
    expect(searchMovies.items.length).toBe(2);
    expect(searchMovies.items[0].streamId).toBe("101");
  });

  it("handles series catalog progressive ingestion", async () => {
    useLibrary.getState().selectPlaylist(TEST_PLAYLIST);

    vi.spyOn(vodPrefetch, "fetch").mockResolvedValue(1);
    vi.spyOn(vodPrefetch, "take").mockImplementation(async (_pid, _kind, _ttl, onChunk) => {
      const chunk = [
        {
          kind: "series" as const,
          name: "Severance",
          skey: "severance",
          key: "s201",
          seriesId: "201",
          logo: "https://img.example/sev.jpg",
          group: "Thriller",
          categoryId: "5",
          num: 1,
          rating: "8.7",
          year: "2022",
          plot: "Mark leads a team of office workers...",
        },
      ];
      const groups = [{ id: "Thriller", name: "Thriller", count: 1 }];
      onChunk?.(chunk, groups, true);
      return { items: chunk, groups };
    });

    await useLibrary.getState().loadVodCatalog("series");

    const state = useLibrary.getState();
    expect(state.seriesItems.length).toBe(1);
    expect(state.seriesItems[0].name).toBe("Severance");
    expect(state.seriesGroups[0].name).toBe("Thriller");
    expect(state.catalogProgress.series.state).toBe("loaded");
    expect(state.searchItems.series.items.length).toBe(1);
  });

  it("clear resets all VOD state back to initial", () => {
    useLibrary.setState({
      vodItems: [
        {
          kind: "movie",
          name: "Test",
          skey: "test",
          key: "v1",
          logo: "",
          group: "",
          num: 1,
          rating: "",
        },
      ],
      vodGroups: [{ id: "A", name: "A", count: 1 }],
      catalogProgress: {
        ...useLibrary.getState().catalogProgress,
        movie: {
          kind: "movie",
          state: "loaded",
          phase: "ready",
          percent: 100,
          loaded: 1,
          total: 1,
        },
      },
    });

    useLibrary.getState().clear();

    const state = useLibrary.getState();
    expect(state.vodItems).toEqual([]);
    expect(state.vodGroups).toEqual([]);
    expect(state.catalogProgress.movie.state).toBe("idle");
  });
  test("phase progress is not catalogue success and late source callbacks cannot publish", async () => {
    useLibrary.getState().selectPlaylist(TEST_PLAYLIST);
    let release!: (count: number) => void;
    const held = new Promise<number>((resolve) => {
      release = resolve;
    });
    const fetch = vi.spyOn(vodPrefetch, "fetch").mockReturnValue(held);
    const task = useLibrary.getState().loadVodCatalog("movie", true);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    const options = fetch.mock.calls[0][0];
    options.onProgress?.({ phase: "download", loaded: 0, bytes: 500, totalBytes: 1000 });
    expect(useLibrary.getState().catalogProgress.movie).toMatchObject({
      phase: "download",
      phasePercent: 50,
      state: "loading",
    });
    options.onProgress?.({ phase: "parse", loaded: 10, bytes: 1000, totalBytes: 1000 });
    expect(useLibrary.getState().catalogProgress.movie.phase).toBe("parse");
    expect(useLibrary.getState().catalogs.movie).toBeUndefined();
    options.onPreparing?.();
    expect(useLibrary.getState().catalogProgress.movie.phase).toBe("prepare");
    useLibrary.getState().selectPlaylist({ ...TEST_PLAYLIST, id: "different-source" });
    options.onProgress?.({ phase: "download", loaded: 99, bytes: 100, totalBytes: 100 });
    release(0);
    await task;
    expect(useLibrary.getState().catalogProgress.movie.state).toBe("idle");
    expect(useLibrary.getState().catalogs.movie).toBeUndefined();
  });
});
