import { beforeEach, expect, test, vi } from "vitest";
import { sourceIdentity, mediaKey } from "../src/services/mediaIdentity";
import { migratePersonal } from "../src/services/personalMigration";
import type { Playlist } from "../src/stores/settings";
import type { SavedPersonal } from "../src/stores/personal";

const playlist = (id = "a", password = "secret"): Playlist => ({
  id,
  name: id,
  sourceVersion: 1,
  hiddenCategories: [],
  hiddenCategoryMode: "exclude",
  source: {
    kind: "xtream",
    server: "https://provider.invalid",
    username: "viewer",
    password,
    output: "ts",
  },
});
const saved = (key: string): SavedPersonal => ({
  favourites: [],
  lastPlayed: null,
  progress: [{ itemKey: key, seconds: 120 }],
});
beforeEach(() => {
  localStorage.clear();
  vi.resetModules();
});

test("source identity isolates equal IDs, credential edits and same-version URL edits without persisting credentials", () => {
  const a = playlist();
  const b = playlist("b");
  const edited = playlist("a", "changed");
  const moved = { ...a, source: { ...a.source, server: "https://other.invalid" } } as Playlist;
  expect(
    new Set([a, b, edited, moved].map((p) => mediaKey(sourceIdentity(p), "movie", "7"))).size,
  ).toBe(4);
  expect(sourceIdentity(a)).not.toMatch(/secret|viewer|https/);
  expect(sourceIdentity({ ...a, sourceVersion: 2 })).not.toBe(sourceIdentity(a));
  expect(sourceIdentity({ ...a, name: "Renamed" })).toBe(sourceIdentity(a));
});

test("single-source legacy progress migrates, but equal short IDs across providers remain unapplied", () => {
  const a = playlist();
  expect(migratePersonal(saved("v7"), [a]).progress[0].itemKey).toBe(
    mediaKey(sourceIdentity(a), "movie", "7"),
  );
  expect(migratePersonal(saved("v7"), [a, playlist("b")]).progress).toEqual([]);
  expect(migratePersonal(saved("xtream:a:episode:7"), [a]).progress[0].itemKey).toBe(
    mediaKey(sourceIdentity(a), "episode", "7"),
  );
  expect(
    migratePersonal(saved("xtream:a:movie:7"), [{ ...a, sourceVersion: 2 }]).progress,
  ).toEqual([]);
});

test("migration retains exact recovery bytes, is idempotent across reload, and preserves favourites and live identities", async () => {
  const original = {
    ...saved("v7"),
    favourites: [
      {
        itemKey: "xtream:a:movie:7",
        playlistId: "a",
        kind: "movie",
        providerId: "7",
        categoryKey: "movie:1",
        name: "Movie",
        logo: "",
      },
    ],
    lastPlayed: {
      itemKey: "xtream:a:live:8",
      playlistId: "a",
      kind: "live",
      categoryKey: "live:1",
    },
  };
  const bytes = JSON.stringify(original);
  localStorage.setItem("openiptv.personal", bytes);
  const { usePersonal, PERSONAL_RECOVERY_KEY } = await import("../src/stores/personal");
  usePersonal.getState().migrateVodPersonal([playlist(), playlist("b")]);
  expect(usePersonal.getState().progress).toEqual([]);
  expect(usePersonal.getState().favourites[0].itemKey).toBe(
    mediaKey(sourceIdentity(playlist()), "movie", "7"),
  );
  expect(usePersonal.getState().lastPlayed).toEqual(original.lastPlayed);
  expect(localStorage.getItem(PERSONAL_RECOVERY_KEY)).toBe(bytes);
  vi.resetModules();
  const reloaded = await import("../src/stores/personal");
  reloaded.usePersonal.getState().migrateVodPersonal([playlist()]);
  expect(reloaded.usePersonal.getState().progress).toEqual([]);
  expect(localStorage.getItem(PERSONAL_RECOVERY_KEY)).toBe(bytes);
});
