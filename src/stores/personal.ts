import { create } from "zustand";
import { keys, read, readJSON, remove, write } from "../services/store";
import type { Channel } from "../types";
import type { Playlist } from "./settings";
import { migratePersonal } from "../services/personalMigration";
import { sourceIdentity } from "../services/mediaIdentity";

export type PersonalContentKind = "live" | "movie" | "series" | "episode" | "catchup";

export interface FavouriteSnapshot {
  itemKey: string;
  playlistId: string;
  kind: "live" | "movie" | "series";
  providerId: string;
  categoryKey: string;
  name: string;
  logo: string;
  extension?: string;
}

export interface LastPlayed {
  playlistId: string;
  kind: PersonalContentKind;
  itemKey: string;
  categoryKey: string;
}

export interface PlaybackProgress {
  itemKey: string;
  seconds: number;
  duration?: number;
}

export interface SavedPersonal {
  favourites: FavouriteSnapshot[];
  lastPlayed: LastPlayed | null;
  progress: PlaybackProgress[];
}

interface PersonalState extends SavedPersonal {
  migrateVodPersonal: (playlists: Playlist[]) => void;
  preserveSourcePersonal: (playlist: Playlist) => void;
  rekeySourcePersonal: (previous: Playlist, next: Playlist) => void;
  unresolvedLast: boolean;
  toggleFavourite: (snapshot: FavouriteSnapshot) => void;
  rememberLast: (last: LastPlayed) => void;
  progressFor: (itemKey: string) => PlaybackProgress | undefined;
  rememberProgress: (
    itemKey: string,
    seconds: number,
    duration?: number,
    lifecycleBoundary?: boolean,
  ) => void;
  completeProgress: (itemKey: string) => void;
  clearPlaylistPersonal: (playlistId: string) => void;
  adoptLegacyPersonal: (
    playlists: Playlist[],
    loadedPlaylistId: string,
    channels: Channel[],
  ) => void;
  hasRememberedLast: () => boolean;
  clearPersonal: () => void;
}

const KEY = "openiptv.personal";
export const PERSONAL_RECOVERY_KEY = "openiptv.personal.recovery.v1";
let schemaVersion = readJSON<{ schemaVersion?: number } | null>(KEY, null)?.schemaVersion ?? 1;
const LEGACY_FAVOURITES_KEY = "openiptv.favourites";
const LEGACY_LAST_KEY = "openiptv.last";
const MAX_PROGRESS = 100;
const PROGRESS_STEP = 15;

const favouriteKinds = new Set(["live", "movie", "series"]);
const contentKinds = new Set(["live", "movie", "series", "episode", "catchup"]);
const loadedPlaylists = new Set<string>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function favouriteFrom(value: unknown): FavouriteSnapshot | null {
  if (!isRecord(value) || !favouriteKinds.has(String(value.kind))) return null;
  if (
    typeof value.itemKey !== "string" ||
    typeof value.playlistId !== "string" ||
    typeof value.providerId !== "string" ||
    typeof value.categoryKey !== "string" ||
    typeof value.name !== "string" ||
    typeof value.logo !== "string"
  ) {
    return null;
  }
  return {
    itemKey: value.itemKey,
    playlistId: value.playlistId,
    kind: value.kind as FavouriteSnapshot["kind"],
    providerId: value.providerId,
    categoryKey: value.categoryKey,
    name: value.name,
    logo: value.logo,
    ...(typeof value.extension === "string" ? { extension: value.extension } : {}),
  };
}

function lastFrom(value: unknown): LastPlayed | null {
  if (
    !isRecord(value) ||
    !contentKinds.has(String(value.kind)) ||
    typeof value.playlistId !== "string" ||
    typeof value.itemKey !== "string" ||
    typeof value.categoryKey !== "string"
  ) {
    return null;
  }
  return {
    playlistId: value.playlistId,
    kind: value.kind as PersonalContentKind,
    itemKey: value.itemKey,
    categoryKey: value.categoryKey,
  };
}

function progressFrom(value: unknown): PlaybackProgress | null {
  if (
    !isRecord(value) ||
    typeof value.itemKey !== "string" ||
    typeof value.seconds !== "number" ||
    !Number.isFinite(value.seconds) ||
    value.seconds < 0
  ) {
    return null;
  }
  return {
    itemKey: value.itemKey,
    seconds: value.seconds,
    ...(typeof value.duration === "number" && Number.isFinite(value.duration)
      ? { duration: value.duration }
      : {}),
  };
}

function load(): SavedPersonal {
  const saved = readJSON<unknown>(KEY, {});
  if (!isRecord(saved)) return { favourites: [], lastPlayed: null, progress: [] };
  const favourites = Array.isArray(saved.favourites)
    ? saved.favourites.reduce<FavouriteSnapshot[]>((items, value) => {
        const favourite = favouriteFrom(value);
        if (favourite && !items.some((item) => item.itemKey === favourite.itemKey)) {
          items.push(favourite);
        }
        return items;
      }, [])
    : [];
  const progress = Array.isArray(saved.progress)
    ? saved.progress.reduce<PlaybackProgress[]>((items, value) => {
        const entry = progressFrom(value);
        if (entry) items.push(entry);
        return items;
      }, [])
    : [];
  return {
    favourites,
    lastPlayed: lastFrom(saved.lastPlayed),
    progress: progress.slice(-MAX_PROGRESS),
  };
}

function legacyFavourites(): string[] {
  const saved = readJSON<unknown>(LEGACY_FAVOURITES_KEY, []);
  return Array.isArray(saved)
    ? saved.filter((value): value is string => typeof value === "string")
    : [];
}

function persist(state: Pick<PersonalState, "favourites" | "lastPlayed" | "progress">) {
  write(
    KEY,
    JSON.stringify({
      schemaVersion,
      favourites: state.favourites,
      lastPlayed: state.lastPlayed,
      progress: state.progress,
    }),
  );
}

function snapshotFor(playlistId: string, channel: Channel): FavouriteSnapshot {
  return {
    itemKey: channel.id,
    playlistId,
    kind: "live",
    providerId: channel.xtream?.streamId ?? channel.id,
    categoryKey: channel.xtream?.categoryKey ?? channel.group,
    name: channel.name,
    logo: channel.logo,
  };
}

function legacyChannel(
  value: string,
  playlists: Playlist[],
  loadedPlaylistId: string,
  channels: Channel[],
): Channel | undefined {
  const exact = channels.find((channel) => channel.id === value);
  if (exact) return exact;
  const match = /^xtream:live:(.+)$/.exec(value);
  if (
    !match ||
    playlists.filter((playlist) => playlist.source.kind === "xtream").length !== 1
  ) {
    return undefined;
  }
  const only = playlists.find((playlist) => playlist.source.kind === "xtream");
  if (only?.id !== loadedPlaylistId) return undefined;
  return channels.find((channel) => channel.xtream?.streamId === match[1]);
}

export const usePersonal = create<PersonalState>((set, get) => ({
  ...load(),
  unresolvedLast: false,

  preserveSourcePersonal(playlist) {
    const key = `${PERSONAL_RECOVERY_KEY}:${sourceIdentity(playlist)}`;
    if (read(key)) return;
    const snapshot = JSON.stringify({
      favourites: get().favourites,
      lastPlayed: get().lastPlayed,
      progress: get().progress,
    });
    write(key, snapshot);
    if (read(key) !== snapshot)
      throw new Error("Saved state could not be preserved; source was not changed");
  },

  rekeySourcePersonal(previous, next) {
    const before = `xtream:${sourceIdentity(previous)}:`;
    const after = `xtream:${sourceIdentity(next)}:`;
    const key = (value: string) =>
      value.startsWith(before) ? after + value.slice(before.length) : value;
    set({
      favourites: get().favourites.map((item) => ({ ...item, itemKey: key(item.itemKey) })),
      progress: get().progress.map((item) => ({ ...item, itemKey: key(item.itemKey) })),
      lastPlayed: get().lastPlayed
        ? { ...get().lastPlayed!, itemKey: key(get().lastPlayed!.itemKey) }
        : null,
    });
    persist(get());
  },

  migrateVodPersonal(playlists) {
    if (schemaVersion >= 2 || !playlists.length) return;
    // Preserve exact old bytes for recovery/rollback, even ambiguous records.
    const original = read(KEY);
    if (original && !read(PERSONAL_RECOVERY_KEY)) write(PERSONAL_RECOVERY_KEY, original);
    if (original && !read(PERSONAL_RECOVERY_KEY)) return;
    const migrated = migratePersonal(get(), playlists);
    schemaVersion = 2;
    set(migrated);
    persist(get());
  },

  toggleFavourite(snapshot) {
    if (!favouriteKinds.has(snapshot.kind)) return;
    const next = get().favourites.some((item) => item.itemKey === snapshot.itemKey)
      ? get().favourites.filter((item) => item.itemKey !== snapshot.itemKey)
      : [...get().favourites, snapshot];
    set({ favourites: next });
    persist(get());
  },

  rememberLast(last) {
    set({ lastPlayed: last });
    persist(get());
  },

  progressFor(itemKey) {
    return get().progress.find((entry) => entry.itemKey === itemKey);
  },

  rememberProgress(itemKey, seconds, duration, lifecycleBoundary = false) {
    if (!Number.isFinite(seconds) || seconds < 0) return;
    const current = get().progressFor(itemKey);
    if (!lifecycleBoundary && seconds - (current?.seconds ?? 0) < PROGRESS_STEP) return;
    const entry = {
      itemKey,
      seconds,
      ...(typeof duration === "number" && Number.isFinite(duration) ? { duration } : {}),
    };
    const next = [...get().progress.filter((item) => item.itemKey !== itemKey), entry].slice(
      -MAX_PROGRESS,
    );
    set({ progress: next });
    persist(get());
  },

  completeProgress(itemKey) {
    const next = get().progress.filter((entry) => entry.itemKey !== itemKey);
    if (next.length === get().progress.length) return;
    set({ progress: next });
    persist(get());
  },

  clearPlaylistPersonal(playlistId) {
    const prefix = `xtream:${playlistId}:`;
    const next = {
      favourites: get().favourites.filter((item) => item.playlistId !== playlistId),
      lastPlayed: get().lastPlayed?.playlistId === playlistId ? null : get().lastPlayed,
      progress: get().progress.filter((entry) => !entry.itemKey.startsWith(prefix)),
    };
    set(next);
    persist(next);
  },

  adoptLegacyPersonal(playlists, loadedPlaylistId, channels) {
    const configured = new Set(playlists.map((playlist) => playlist.id));
    for (const playlistId of loadedPlaylists) {
      if (!configured.has(playlistId)) loadedPlaylists.delete(playlistId);
    }
    loadedPlaylists.add(loadedPlaylistId);
    const complete = playlists.every((playlist) => loadedPlaylists.has(playlist.id));

    const remainingFavourites: string[] = [];
    const adopted = [...get().favourites];
    for (const value of legacyFavourites()) {
      const channel = legacyChannel(value, playlists, loadedPlaylistId, channels);
      if (!channel) {
        if (!complete) remainingFavourites.push(value);
        continue;
      }
      if (!adopted.some((item) => item.itemKey === channel.id)) {
        adopted.push(snapshotFor(loadedPlaylistId, channel));
      }
    }

    const savedLast = read(LEGACY_LAST_KEY);
    let lastPlayed = get().lastPlayed;
    let unresolvedLast = get().unresolvedLast;
    if (savedLast && !lastPlayed) {
      const channel = legacyChannel(savedLast, playlists, loadedPlaylistId, channels);
      if (channel) {
        lastPlayed = {
          playlistId: loadedPlaylistId,
          kind: "live",
          itemKey: channel.id,
          categoryKey: channel.xtream?.categoryKey ?? channel.group,
        };
        unresolvedLast = false;
        remove(LEGACY_LAST_KEY);
      } else if (complete) {
        unresolvedLast = true;
      }
    }
    if (savedLast && complete) remove(LEGACY_LAST_KEY);

    if (remainingFavourites.length) {
      write(LEGACY_FAVOURITES_KEY, JSON.stringify(remainingFavourites));
    } else {
      remove(LEGACY_FAVOURITES_KEY);
    }
    if (
      adopted.length !== get().favourites.length ||
      lastPlayed !== get().lastPlayed ||
      unresolvedLast !== get().unresolvedLast
    ) {
      set({ favourites: adopted, lastPlayed, unresolvedLast });
      persist(get());
    }
  },

  hasRememberedLast() {
    return !!get().lastPlayed || get().unresolvedLast || !!read(LEGACY_LAST_KEY);
  },

  clearPersonal() {
    loadedPlaylists.clear();
    remove(KEY);
    remove(PERSONAL_RECOVERY_KEY);
    for (const key of keys()) if (key.startsWith(`${PERSONAL_RECOVERY_KEY}:`)) remove(key);
    remove(LEGACY_FAVOURITES_KEY);
    remove(LEGACY_LAST_KEY);
    set({ favourites: [], lastPlayed: null, progress: [], unresolvedLast: false });
  },
}));
