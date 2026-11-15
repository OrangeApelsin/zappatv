import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  clearVersionCheckHistory,
  probeVodVersion,
  recordVersionChecked,
  shouldCheckVersion,
} from "../src/services/vodSync";
import type { Playlist } from "../src/stores/settings";

beforeEach(() => {
  clearVersionCheckHistory();
  vi.restoreAllMocks();
});

afterEach(() => {
  clearVersionCheckHistory();
  vi.unstubAllGlobals();
});

const mockTokenPlaylist: Playlist = {
  id: "token-pl",
  name: "My Token Playlist",
  source: {
    kind: "xtream",
    server: "http://provider.example:8000",
    username: "secret-token",
    password: "secret-token",
    token: "secret-token",
    output: "ts",
  },
  liveCategoryPositions: {},
  categoryItemsCount: {},
  sort: "default",
  viewMode: "mosaic",
  liveViewMode: "tile",
  sourceVersion: 1,
};

const mockXtreamPlaylist: Playlist = {
  id: "xtream-pl",
  name: "My Xtream Playlist",
  source: {
    kind: "xtream",
    server: "http://xtream.example:8000",
    username: "user1",
    password: "pass1",
    output: "ts",
  },
  liveCategoryPositions: {},
  categoryItemsCount: {},
  sort: "default",
  viewMode: "mosaic",
  liveViewMode: "tile",
  sourceVersion: 1,
};

test("throttles version checks to once every 15 minutes unless forced", () => {
  expect(shouldCheckVersion("token-pl", "movie")).toBe(true);

  recordVersionChecked("token-pl", "movie");
  expect(shouldCheckVersion("token-pl", "movie")).toBe(false);
  expect(shouldCheckVersion("token-pl", "movie", true)).toBe(true);

  // Different kind is not throttled
  expect(shouldCheckVersion("token-pl", "series")).toBe(true);

  // Clearing history removes throttle
  clearVersionCheckHistory("token-pl");
  expect(shouldCheckVersion("token-pl", "movie")).toBe(true);
});

test("probes IPTV Manager /api/vod/version with token and detects unchanged version", async () => {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({
      movie_version: "gen-2026-v1",
      movie_updated_at: 1731531600,
    }),
  });
  vi.stubGlobal("fetch", fetchMock);

  const localHead = {
    schema: 2 as const,
    generation: "gen-local",
    t: Date.now(),
    count: 100,
    n: 1,
    groups: [],
    version: "gen-2026-v1",
    updatedAt: 1731531600,
  };

  const result = await probeVodVersion(mockTokenPlaylist, "movie", localHead);

  expect(fetchMock).toHaveBeenCalledWith(
    "http://provider.example:8000/api/vod/version?kind=movie",
    expect.objectContaining({
      headers: expect.objectContaining({
        "x-zappa-token": "secret-token",
      }),
    }),
  );
  expect(result.status).toBe("unchanged");
  expect(result.version).toBe("gen-2026-v1");
});

test("probes IPTV Manager /api/vod/version with token and detects updated version", async () => {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({
      movie_version: "gen-2026-v2",
      movie_updated_at: 1731539999,
    }),
  });
  vi.stubGlobal("fetch", fetchMock);

  const localHead = {
    schema: 2 as const,
    generation: "gen-local",
    t: Date.now(),
    count: 100,
    n: 1,
    groups: [],
    version: "gen-2026-v1",
    updatedAt: 1731531600,
  };

  const result = await probeVodVersion(mockTokenPlaylist, "movie", localHead);

  expect(result.status).toBe("changed");
  expect(result.version).toBe("gen-2026-v2");
  expect(result.updatedAt).toBe(1731539999);
});

test("probes generic Xtream action=get_vod_version on player_api.php", async () => {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({
      version: "v-xtream-1",
      updated_at: 1731530000,
    }),
  });
  vi.stubGlobal("fetch", fetchMock);

  const localHead = {
    schema: 2 as const,
    generation: "gen-local",
    t: Date.now(),
    count: 50,
    n: 1,
    groups: [],
    version: "v-xtream-1",
  };

  const result = await probeVodVersion(mockXtreamPlaylist, "movie", localHead);

  expect(fetchMock).toHaveBeenCalledWith(
    expect.stringContaining("action=get_vod_version"),
    expect.anything(),
  );
  expect(result.status).toBe("unchanged");
});

test("falls back to conditional HTTP 304 Not Modified when version endpoint is missing", async () => {
  const fetchMock = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
    if (init?.method === "HEAD") {
      return Promise.resolve({
        ok: false,
        status: 304,
        headers: new Headers(),
      });
    }
    return Promise.resolve({
      ok: false,
      status: 404,
    });
  });
  vi.stubGlobal("fetch", fetchMock);

  const localHead = {
    schema: 2 as const,
    generation: "gen-local",
    t: 1731530000000,
    count: 50,
    n: 1,
    groups: [],
    etag: '"etag-123"',
  };

  const result = await probeVodVersion(mockXtreamPlaylist, "movie", localHead);

  expect(result.status).toBe("unchanged");
});
