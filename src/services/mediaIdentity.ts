import type { Playlist } from "../stores/settings";

/** Opaque source fingerprint, not an authorization credential. Include every
 * account field and the generation: changing a URL/token cannot reuse a cache.
 * Four independent 32-bit lanes keep source material out of persisted keys.
 */
export function sourceIdentity(playlist: Playlist): string {
  const source = playlist.source;
  const text = JSON.stringify(
    source.kind === "xtream"
      ? [
          source.kind,
          source.server,
          source.username,
          source.password,
          source.token ?? "",
          source.output,
        ]
      : [source.kind, source.url],
  );
  const lanes = [2166136261, 2246822507, 3266489909, 668265263];
  for (let i = 0; i < text.length; i++) {
    for (let lane = 0; lane < lanes.length; lane++) {
      lanes[lane] = Math.imul(lanes[lane] ^ (text.charCodeAt(i) + lane), 16777619);
    }
  }
  const signature = lanes
    .map((value) => `00000000${(value >>> 0).toString(16)}`.slice(-8))
    .join("");
  return `${playlist.id}:v${playlist.sourceVersion}:${signature}`;
}

export const mediaKey = (scope: string, kind: "movie" | "series" | "episode", id: string) =>
  `xtream:${scope}:${kind}:${id}`;

export function ownsMediaKey(key: string, playlist: Playlist): boolean {
  return key.startsWith(`xtream:${sourceIdentity(playlist)}:`);
}
