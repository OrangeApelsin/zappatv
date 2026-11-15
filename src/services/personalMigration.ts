import type { Playlist } from "../stores/settings";
import type { SavedPersonal } from "../stores/personal";
import { mediaKey, ownsMediaKey, sourceIdentity } from "./mediaIdentity";

/** A rollback/recovery copy is kept by the caller before replacing schema 1.
 * A short key has an owner only when exactly one original Xtream source exists.
 * Ambiguous records stay in recovery, never applied to the active provider.
 */
export function migratePersonal(saved: SavedPersonal, playlists: Playlist[]): SavedPersonal {
  const sources = playlists.filter((p) => p.source.kind === "xtream");
  const remap = (key: string, owner?: string): string | undefined => {
    if (sources.some((p) => ownsMediaKey(key, p))) return key;
    const scoped = /^xtream:(.+):(movie|series|episode):([^:]+)$/.exec(key);
    const short = /^([vs])([0-9]+)$/.exec(key);
    if (!scoped && !short) return key; // Existing live/M3U identities are stable.
    const possible = scoped
      ? sources.filter((p) => p.id === scoped[1])
      : owner
        ? sources.filter((p) => p.id === owner)
        : sources;
    const playlist = possible.length === 1 ? possible[0] : undefined;
    if (playlist?.sourceVersion !== 1) return undefined;
    const kind = scoped
      ? (scoped[2] as "movie" | "series" | "episode")
      : short![1] === "v"
        ? "movie"
        : "series";
    return mediaKey(sourceIdentity(playlist), kind, scoped ? scoped[3] : short![2]);
  };
  return {
    favourites: saved.favourites.flatMap((item) => {
      const key = remap(item.itemKey, item.playlistId);
      return key ? [{ ...item, itemKey: key }] : [];
    }),
    progress: saved.progress.flatMap((item) => {
      const key = remap(item.itemKey);
      return key ? [{ ...item, itemKey: key }] : [];
    }),
    lastPlayed: saved.lastPlayed
      ? (() => {
          const key = remap(saved.lastPlayed.itemKey, saved.lastPlayed.playlistId);
          return key ? { ...saved.lastPlayed, itemKey: key } : null;
        })()
      : null,
  };
}
