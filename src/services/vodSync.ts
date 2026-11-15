/**
 * Lightweight VOD version check service for IPTV Manager and Xtream Codes.
 *
 * Checks if the remote server's VOD catalog has been modified before
 * downloading full multi-megabyte catalog payloads.
 *
 * Supported Probes:
 * 1. IPTV Manager Token mode:
 *    GET {server}/api/vod/version?kind={kind} with header `x-zappa-token: {token}`
 * 2. Xtream Codes endpoint:
 *    GET {server}/player_api.php?username={u}&password={p}&action=get_vod_version&kind={kind}
 * 3. Conditional HTTP (ETag / If-Modified-Since) fallback for generic Xtream servers.
 *
 * Check interval is throttled to once every 15 minutes per playlist + kind.
 */

import type { Playlist } from "../stores/settings";
import type { CatalogHead } from "./vodCache";

export const VERSION_CHECK_THROTTLE_MS = 15 * 60 * 1000; // 15 minutes

const cleanServer = (server: string) => server.trim().replace(/\/+$/, "");

const lastChecked = new Map<string, number>();

export interface VersionCheckResult {
  status: "unchanged" | "changed" | "unsupported" | "error";
  version?: string;
  updatedAt?: number | string;
  etag?: string;
}

export function shouldCheckVersion(
  playlistId: string,
  kind: "movie" | "series",
  force = false,
): boolean {
  if (force) return true;
  const key = `${kind}:${playlistId}`;
  const last = lastChecked.get(key) ?? 0;
  return Date.now() - last >= VERSION_CHECK_THROTTLE_MS;
}

export function recordVersionChecked(playlistId: string, kind: "movie" | "series"): void {
  const key = `${kind}:${playlistId}`;
  lastChecked.set(key, Date.now());
}

export function clearVersionCheckHistory(playlistId?: string): void {
  if (!playlistId) {
    lastChecked.clear();
    return;
  }
  lastChecked.delete(`movie:${playlistId}`);
  lastChecked.delete(`series:${playlistId}`);
}

/**
 * Perform a lightweight version probe against the server.
 */
export async function probeVodVersion(
  playlist: Playlist,
  kind: "movie" | "series",
  localHead: CatalogHead | null,
  signal?: AbortSignal,
): Promise<VersionCheckResult> {
  if (playlist.source.kind !== "xtream") {
    return { status: "unsupported" };
  }

  const { server, username, password, token } = playlist.source;
  const normalized = cleanServer(server);

  // 1. If using IPTV Manager with token, probe /api/vod/version
  if (token?.trim()) {
    try {
      const url = `${normalized}/api/vod/version?kind=${encodeURIComponent(kind)}`;
      const response = await fetch(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
          "x-zappa-token": token.trim(),
        },
        signal,
      });

      if (response.ok) {
        const data = (await response.json()) as {
          version?: string;
          updated_at?: number | string;
          movie_version?: string;
          series_version?: string;
          movie_updated_at?: number | string;
          series_updated_at?: number | string;
        };

        const serverVersion =
          (kind === "movie" ? data.movie_version : data.series_version) ??
          data.version?.toString();
        const serverUpdatedAt =
          (kind === "movie" ? data.movie_updated_at : data.series_updated_at) ??
          data.updated_at;

        if (serverVersion && localHead?.version && serverVersion === localHead.version) {
          return { status: "unchanged", version: serverVersion, updatedAt: serverUpdatedAt };
        }
        if (
          serverUpdatedAt &&
          localHead?.updatedAt &&
          String(serverUpdatedAt) === String(localHead.updatedAt)
        ) {
          return { status: "unchanged", version: serverVersion, updatedAt: serverUpdatedAt };
        }

        return {
          status: "changed",
          version: serverVersion,
          updatedAt: serverUpdatedAt,
        };
      }
    } catch {
      // Endpoint might not exist on older or standard Xtream instances; fall through to action probe
    }
  }

  // 2. Probe action=get_vod_version on player_api.php
  try {
    const params = new URLSearchParams({
      username,
      password,
      action: "get_vod_version",
      kind,
    });
    const url = `${normalized}/player_api.php?${params.toString()}`;
    const response = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal,
    });

    if (response.ok) {
      const data = (await response.json()) as {
        version?: string;
        updated_at?: number | string;
      };
      if (data && (data.version || data.updated_at)) {
        const serverVersion = data.version?.toString();
        const serverUpdatedAt = data.updated_at;

        if (serverVersion && localHead?.version && serverVersion === localHead.version) {
          return { status: "unchanged", version: serverVersion, updatedAt: serverUpdatedAt };
        }
        if (
          serverUpdatedAt &&
          localHead?.updatedAt &&
          String(serverUpdatedAt) === String(localHead.updatedAt)
        ) {
          return { status: "unchanged", version: serverVersion, updatedAt: serverUpdatedAt };
        }

        return {
          status: "changed",
          version: serverVersion,
          updatedAt: serverUpdatedAt,
        };
      }
    }
  } catch {
    // Non-standard Xtream server; fall through to conditional check
  }

  // 3. Conditional HTTP (ETag / If-Modified-Since) fallback
  if (localHead?.etag || localHead?.t) {
    try {
      const action = kind === "movie" ? "get_vod_streams" : "get_series";
      const params = new URLSearchParams({ username, password, action });
      const url = `${normalized}/player_api.php?${params.toString()}`;
      const headers: Record<string, string> = {};
      if (localHead.etag) {
        headers["If-None-Match"] = localHead.etag;
      }
      if (localHead.t) {
        headers["If-Modified-Since"] = new Date(localHead.t).toUTCString();
      }

      const response = await fetch(url, {
        method: "HEAD",
        headers,
        signal,
      });

      if (response.status === 304) {
        return { status: "unchanged" };
      }
      if (response.ok) {
        const newEtag = response.headers.get("etag") ?? undefined;
        return { status: "changed", etag: newEtag };
      }
    } catch {
      // Conditional probe failed; treat as unsupported
    }
  }

  return { status: "unsupported" };
}
