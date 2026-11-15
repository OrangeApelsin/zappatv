import { create } from "zustand";
import { isLocalePreference, type LocalePreference } from "../services/locale";
import {
  m3uSource,
  parseXtreamPlaylistUrl,
  type PlaylistSource,
  xtreamSource,
} from "../services/playlistUrl";
import { readJSON, write } from "../services/store";
import { usePersonal } from "./personal";

/**
 * Everything the viewer can change, persisted to localStorage.
 *
 * The type face is not among them, and deliberately so. It was offered for a while and it did
 * nothing on a television: the alternatives named families no Tizen set carries, so every choice
 * resolved back to the one font the device has, and the setting only worked on the desktop build
 * nobody watches television in. Whatever the set draws its own interface in is what this uses, and
 * the device supplies the glyphs for the playlist's language.
 */

/**
 * What to do with a picture that is not the shape of the screen.
 *
 * Live channels arrive in whatever shape the broadcaster sends, and plenty of them are not
 * sixteen by nine: standard definition feeds, old archive material, and streams whose
 * encoder has rounded the height to something odd. The names are the viewer's words for it
 * rather than the platform's, and each maps onto a display mode the TV already has.
 */
export const GUIDE_TIME_OFFSETS = [
  { id: "auto", label: "settings.guideOffsetAuto", hours: 0 },
  { id: "-2h", label: "-2h", hours: -2 },
  { id: "-1h", label: "-1h", hours: -1 },
  { id: "0h", label: "0h", hours: 0 },
  { id: "+1h", label: "+1h", hours: 1 },
  { id: "+2h", label: "+2h", hours: 2 },
] as const;

export type GuideTimeOffset = (typeof GUIDE_TIME_OFFSETS)[number]["id"];

export function getGuideTimeOffsetSeconds(offset: GuideTimeOffset | string | undefined): number {
  switch (offset) {
    case "-2h":
      return -2 * 3600;
    case "-1h":
      return -1 * 3600;
    case "+1h":
      return 1 * 3600;
    case "+2h":
      return 2 * 3600;
    default:
      return 0;
  }
}

export const ASPECTS = [
  {
    id: "original",
    label: "Original",
    note: "Native untouched aspect ratio without scaling or cropping",
  },
  {
    id: "auto",
    label: "Auto (4:3 Fill)",
    note: "Stretches 4:3 SD channels to full screen while keeping 16:9 letterboxed",
  },
  { id: "fill", label: "Fill", note: "Fills the screen, cropping the edges of the picture" },
  {
    id: "fit",
    label: "Fit",
    note: "The whole picture, with bars if it does not fill the screen",
  },
  { id: "stretch", label: "Stretch", note: "Fills the screen by distorting the picture" },
] as const;

export type StartScreen = "home" | "live";

export type AspectId = (typeof ASPECTS)[number]["id"];

export const FONT_SIZES = [
  { id: "s", label: "Small", scale: 0.85 },
  { id: "m", label: "Medium", scale: 1 },
  { id: "l", label: "Large", scale: 1.15 },
  { id: "xl", label: "Extra large", scale: 1.3 },
];

export const SUBTITLE_SIZES = [
  { id: "s", label: "settings.small" },
  { id: "m", label: "settings.medium" },
  { id: "l", label: "settings.large" },
  { id: "xl", label: "settings.extraLarge" },
] as const;

export type SubtitleSize = (typeof SUBTITLE_SIZES)[number]["id"];

export const SUBTITLE_STYLES = [
  { id: "translucent", label: "settings.subtitleStyleTranslucent" },
  { id: "black", label: "settings.subtitleStyleBlack" },
  { id: "outline", label: "settings.subtitleStyleOutline" },
] as const;

export type SubtitleStyle = (typeof SUBTITLE_STYLES)[number]["id"];

export const SUBTITLE_POSITIONS = [
  { id: "bottom", label: "settings.subtitlePositionBottom" },
  { id: "lower", label: "settings.subtitlePositionLower" },
  { id: "elevated", label: "settings.subtitlePositionElevated" },
] as const;

export type SubtitlePosition = (typeof SUBTITLE_POSITIONS)[number]["id"];

export const OSD_DURATIONS = [
  { id: "2s", label: "2s", ms: 2000 },
  { id: "4s", label: "4s", ms: 4000 },
  { id: "6s", label: "6s", ms: 6000 },
  { id: "8s", label: "8s", ms: 8000 },
  { id: "dismiss", label: "settings.osdDurationDismiss", ms: 0 },
] as const;

export type OsdDuration = (typeof OSD_DURATIONS)[number]["id"];

export function getOsdDurationMs(duration: OsdDuration): number {
  switch (duration) {
    case "2s":
      return 2000;
    case "4s":
      return 4000;
    case "6s":
      return 6000;
    case "8s":
      return 8000;
    case "dismiss":
      return 0;
    default:
      return 8000;
  }
}

export const UP_NEXT_DURATIONS = [
  { id: "off", label: "common.off" },
  { id: "10s", label: "10s" },
  { id: "15s", label: "15s" },
  { id: "20s", label: "20s" },
  { id: "30s", label: "30s" },
] as const;

export type UpNextDuration = (typeof UP_NEXT_DURATIONS)[number]["id"];

export function getUpNextSeconds(duration: UpNextDuration): number {
  switch (duration) {
    case "10s":
      return 10;
    case "15s":
      return 15;
    case "20s":
      return 20;
    case "30s":
      return 30;
    default:
      return 0;
  }
}

export const SCREENSAVER_TIMEOUTS = [
  { id: "1m", label: "settings.timeout1m", seconds: 60 },
  { id: "3m", label: "settings.timeout3m", seconds: 180 },
  { id: "5m", label: "settings.timeout5m", seconds: 300 },
  { id: "10m", label: "settings.timeout10m", seconds: 600 },
] as const;

export type ScreensaverTimeout = (typeof SCREENSAVER_TIMEOUTS)[number]["id"];

export const getScreensaverTimeoutSeconds = (id?: ScreensaverTimeout): number => {
  const match = SCREENSAVER_TIMEOUTS.find((opt) => opt.id === id);
  return match ? match.seconds : 60;
};

export function isAdultCategory(name: string): boolean {
  if (!name) return false;
  const n = name.toLowerCase();
  return (
    n.includes("xxx") ||
    n.includes("adult") ||
    n.includes("18+") ||
    n.includes("porn") ||
    n.includes("erotic") ||
    n.includes("for adults") ||
    n.includes("+18")
  );
}

export function isCategoryLocked(
  categoryKey: string,
  categoryName: string,
  parentalPin: string,
  lockedCategoryKeys: string[] = [],
): boolean {
  if (parentalPin?.length !== 4) return false;
  if (lockedCategoryKeys.includes(categoryKey)) return true;
  return isAdultCategory(categoryName);
}

export type HiddenCategoryMode = "exclude" | "search";

export type ZappingDirection = "standard" | "inverted";

export const PREFERRED_LANGUAGES = [
  { id: "none", label: "settings.langNone", codes: [] },
  { id: "eng", label: "settings.langEnglish", codes: ["eng", "en"] },
  { id: "swe", label: "settings.langSwedish", codes: ["swe", "sv"] },
  { id: "ara", label: "settings.langArabic", codes: ["ara", "ar"] },
  { id: "spa", label: "settings.langSpanish", codes: ["spa", "es"] },
  { id: "fra", label: "settings.langFrench", codes: ["fra", "fr"] },
  { id: "ger", label: "settings.langGerman", codes: ["ger", "de", "deu"] },
  { id: "fin", label: "settings.langFinnish", codes: ["fin", "fi"] },
  { id: "dan", label: "settings.langDanish", codes: ["dan", "da"] },
  { id: "nor", label: "settings.langNorwegian", codes: ["nor", "no", "nob", "nno"] },
  { id: "ita", label: "settings.langItalian", codes: ["ita", "it"] },
] as const;

export type PreferredLanguage = (typeof PREFERRED_LANGUAGES)[number]["id"];

export function findMatchingTrackIndex<T extends { index: number; language: string; label: string }>(
  tracks: readonly T[],
  preferredLanguageId: string | undefined,
): number | undefined {
  if (!preferredLanguageId || preferredLanguageId === "none") return undefined;
  const pref = PREFERRED_LANGUAGES.find((l) => l.id === preferredLanguageId);
  if (!pref?.codes.length) return undefined;
  const codes = new Set(pref.codes.map((c) => c.toLowerCase()));

  // 1. Direct language code match
  const direct = tracks.find((t) => codes.has(t.language.toLowerCase().trim()));
  if (direct) return direct.index;

  // 2. Substring or label match
  const labelMatch = tracks.find((t) => {
    const lowerLabel = t.label.toLowerCase();
    const lowerLang = t.language.toLowerCase();
    return (
      pref.codes.some((c) => lowerLang.includes(c) || lowerLabel.includes(c)) ||
      lowerLabel.includes(pref.id)
    );
  });
  if (labelMatch) return labelMatch.index;

  return undefined;
}

export interface Playlist {
  id: string;
  name: string;
  source: PlaylistSource;
  sourceVersion: number;
  hiddenCategories: string[];
  hiddenCategoryMode: HiddenCategoryMode;
  categoryCount?: number;
}

interface Settings {
  locale: LocalePreference;
  fontSizeId: string;
  playlists: Playlist[];
  activePlaylistId: string;
  showNumbers: boolean;
  showLogos: boolean;
  /** How a picture that is not the shape of the screen should be fitted to it. */
  aspectId: AspectId;
  showClock: boolean;
  showPlaybackStats: boolean;
  resumeLast: boolean;
  startScreen: StartScreen;
  bufferProfile: "fast" | "stable";
  epgBatchMode: boolean;
  guideTimeOffset: GuideTimeOffset;
  zappingDirection: ZappingDirection;
  preferredAudioLanguage: PreferredLanguage;
  preferredSubtitleLanguage: PreferredLanguage;
  subtitleSize: SubtitleSize;
  subtitleStyle: SubtitleStyle;
  subtitlePosition: SubtitlePosition;
  osdDuration: OsdDuration;
  upNextCountdown: UpNextDuration;
  screensaverTimeout: ScreensaverTimeout;
  parentalPin: string;
  lockedCategoryKeys: string[];
  sortAlphabetically: boolean;
  /**
   * Whether to repair playlists this television cannot read, on the television.
   *
   * Off by default and deliberately so. It exists for one firmware defect: AVPlay keeps a
   * playlist's media sequence in a signed 32 bit integer, and a packager that numbers segments
   * from a microsecond clock overflows it, so the channel shows one frame and stops. Repairing it
   * means the application serving a corrected playlist to the set's own player over a loopback
   * socket, which is a great deal of machinery to have running for the majority of viewers who
   * never meet such a channel.
   */
  compatibility: boolean;

  set: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  addPlaylist: (name: string, source: PlaylistSource) => void;
  removePlaylist: (id: string) => void;
  updatePlaylist: (id: string, name: string, source: PlaylistSource) => void;
  setHiddenCategories: (playlistId: string, categories: string[]) => void;
  setCategoryHidden: (playlistId: string, category: string, hidden: boolean) => void;
  setHiddenCategoryMode: (playlistId: string, mode: HiddenCategoryMode) => void;
  setPlaylistCategoryCount: (playlistId: string, count: number) => void;
  replacePlaylists: (
    playlists: Playlist[],
    activePlaylistId: string,
    locale?: LocalePreference,
  ) => void;
  reset: () => void;
  scale: () => number;
  activePlaylist: () => Playlist | undefined;
}

const KEY = "openiptv.settings";

// A fresh install ships with no playlist. There is no neutral one to choose: any list
// bundled here would be a decision about what somebody in some country should watch, made
// by the app rather than by them. The first run asks for a URL instead.
const DEFAULTS = {
  locale: "system" as LocalePreference,
  fontSizeId: "m",
  playlists: [] as Playlist[],
  activePlaylistId: "",
  showNumbers: true,
  showLogos: true,
  /* Original is the default: displays video strictly in its native untouched aspect ratio
     without scaling, stretching, or cropping. */
  aspectId: "original" as AspectId,
  showClock: true,
  showPlaybackStats: false,
  resumeLast: true,
  startScreen: "home" as StartScreen,
  bufferProfile: "fast" as "fast" | "stable",
  epgBatchMode: true,
  guideTimeOffset: "auto" as GuideTimeOffset,
  zappingDirection: "standard" as ZappingDirection,
  preferredAudioLanguage: "none" as PreferredLanguage,
  preferredSubtitleLanguage: "none" as PreferredLanguage,
  subtitleSize: "m" as SubtitleSize,
  subtitleStyle: "translucent" as SubtitleStyle,
  subtitlePosition: "bottom" as SubtitlePosition,
  osdDuration: "8s" as OsdDuration,
  upNextCountdown: "10s" as UpNextDuration,
  screensaverTimeout: "1m" as ScreensaverTimeout,
  parentalPin: "",
  lockedCategoryKeys: [] as string[],
  sortAlphabetically: false,
  /* Off. Nothing that only some channels need should cost the others anything. */
  compatibility: false,
};

/**
 * An id no existing playlist is using.
 *
 * The clock alone is not enough. It has a resolution of one millisecond, and adding two
 * playlists within the same millisecond is not a race anyone has to try for: it happens
 * whenever anything adds two in a row. Two playlists carrying one id is not a cosmetic
 * problem, because removal filters by id, so removing either removes both, takes the active
 * playlist with them and drops the app back to its first run screen.
 */
function freshId(existing: Playlist[]): string {
  const used = new Set(existing.map((p) => p.id));
  const stamp = Date.now().toString(36);
  let id = `pl-${stamp}`;
  for (let n = 2; used.has(id); n += 1) id = `pl-${stamp}-${n}`;
  return id;
}

function sourceFrom(value: Record<string, unknown>): PlaylistSource | null {
  const source = value.source;
  if (source && typeof source === "object" && !Array.isArray(source)) {
    const saved = source as Record<string, unknown>;
    if (saved.kind === "m3u" && typeof saved.url === "string") {
      return { kind: "m3u", url: saved.url };
    }
    if (
      saved.kind === "xtream" &&
      typeof saved.server === "string" &&
      typeof saved.username === "string" &&
      typeof saved.password === "string" &&
      (saved.output === "m3u8" || saved.output === "ts")
    ) {
      const built = xtreamSource(saved.server, saved.username, saved.password, saved.output);
      if (built && typeof saved.token === "string" && saved.token.trim()) {
        built.token = saved.token.trim();
      }
      return built;
    }
    return null;
  }
  if (typeof value.url !== "string") return null;
  return (
    parseXtreamPlaylistUrl(value.url) ?? m3uSource(value.url) ?? { kind: "m3u", url: value.url }
  );
}

function sameSource(left: PlaylistSource, right: PlaylistSource): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === "m3u" && right.kind === "m3u") return left.url === right.url;
  if (left.kind === "xtream" && right.kind === "xtream") {
    return (
      left.server === right.server &&
      left.username === right.username &&
      left.password === right.password &&
      left.output === right.output &&
      (left.token ?? "") === (right.token ?? "")
    );
  }
  return false;
}

function replacesAccount(left: PlaylistSource, right: PlaylistSource): boolean {
  if (left.kind !== right.kind) return true;
  return (
    left.kind === "xtream" &&
    right.kind === "xtream" &&
    (left.server !== right.server ||
      left.username !== right.username ||
      left.token !== right.token)
  );
}

function load(): typeof DEFAULTS {
  // Merged rather than replaced, so a settings file written by an older version keeps working
  // when new keys appear.
  const raw = readJSON<unknown>(KEY, {});
  const saved =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const merged = { ...DEFAULTS } as Record<string, unknown>;
  /*
   * And only keys this version knows, so a setting that has been removed does not live on in the
   * file for ever. The type face was a real one: every install that had chosen a font kept carrying
   * `fontId` after the setting itself was gone, written back on every change, meaning nothing and
   * explaining nothing to whoever read the file next.
   */
  for (const key of Object.keys(DEFAULTS)) {
    if (key in saved) merged[key] = saved[key];
  }
  if (!isLocalePreference(merged.locale)) merged.locale = DEFAULTS.locale;
  if (merged.startScreen !== "home" && merged.startScreen !== "live") {
    merged.startScreen = DEFAULTS.startScreen;
  }
  if (!GUIDE_TIME_OFFSETS.some((opt) => opt.id === merged.guideTimeOffset)) {
    merged.guideTimeOffset = DEFAULTS.guideTimeOffset;
  }
  if (merged.zappingDirection !== "standard" && merged.zappingDirection !== "inverted") {
    merged.zappingDirection = DEFAULTS.zappingDirection;
  }
  if (!PREFERRED_LANGUAGES.some((opt) => opt.id === merged.preferredAudioLanguage)) {
    merged.preferredAudioLanguage = DEFAULTS.preferredAudioLanguage;
  }
  if (!PREFERRED_LANGUAGES.some((opt) => opt.id === merged.preferredSubtitleLanguage)) {
    merged.preferredSubtitleLanguage = DEFAULTS.preferredSubtitleLanguage;
  }
  if (!SUBTITLE_SIZES.some((opt) => opt.id === merged.subtitleSize)) {
    merged.subtitleSize = DEFAULTS.subtitleSize;
  }
  if (!SUBTITLE_STYLES.some((opt) => opt.id === merged.subtitleStyle)) {
    merged.subtitleStyle = DEFAULTS.subtitleStyle;
  }
  if (!SUBTITLE_POSITIONS.some((opt) => opt.id === merged.subtitlePosition)) {
    merged.subtitlePosition = DEFAULTS.subtitlePosition;
  }
  if (!OSD_DURATIONS.some((opt) => opt.id === merged.osdDuration)) {
    merged.osdDuration = DEFAULTS.osdDuration;
  }
  if (!UP_NEXT_DURATIONS.some((opt) => opt.id === merged.upNextCountdown)) {
    merged.upNextCountdown = DEFAULTS.upNextCountdown;
  }
  if (!SCREENSAVER_TIMEOUTS.some((opt) => opt.id === merged.screensaverTimeout)) {
    merged.screensaverTimeout = DEFAULTS.screensaverTimeout;
  }
  if (typeof merged.parentalPin !== "string" || (!/^\d{4}$/.test(merged.parentalPin) && merged.parentalPin !== "")) {
    merged.parentalPin = DEFAULTS.parentalPin;
  }
  if (!Array.isArray(merged.lockedCategoryKeys)) {
    merged.lockedCategoryKeys = DEFAULTS.lockedCategoryKeys;
  } else {
    merged.lockedCategoryKeys = merged.lockedCategoryKeys.filter(
      (k: unknown): k is string => typeof k === "string",
    );
  }
  merged.playlists = Array.isArray(merged.playlists)
    ? merged.playlists.reduce<Playlist[]>((playlists, value) => {
        if (!value || typeof value !== "object" || Array.isArray(value)) return playlists;
        const savedPlaylist = value as Record<string, unknown>;
        const source = sourceFrom(savedPlaylist);
        if (!source) return playlists;
        playlists.push({
          id: typeof savedPlaylist.id === "string" ? savedPlaylist.id : "",
          name: typeof savedPlaylist.name === "string" ? savedPlaylist.name : "",
          source,
          sourceVersion:
            typeof savedPlaylist.sourceVersion === "number" && savedPlaylist.sourceVersion >= 1
              ? Math.floor(savedPlaylist.sourceVersion)
              : 1,
          hiddenCategories: Array.isArray(savedPlaylist.hiddenCategories)
            ? savedPlaylist.hiddenCategories.filter(
                (category): category is string => typeof category === "string",
              )
            : [],
          hiddenCategoryMode:
            savedPlaylist.hiddenCategoryMode === "search" ? "search" : "exclude",
          ...(typeof savedPlaylist.categoryCount === "number" &&
          savedPlaylist.categoryCount >= 0
            ? { categoryCount: Math.floor(savedPlaylist.categoryCount) }
            : {}),
        });
        return playlists;
      }, [])
    : [];
  const canonical = JSON.stringify(merged);
  if (JSON.stringify(saved) !== canonical) write(KEY, canonical);
  return merged as typeof DEFAULTS;
}

function persist(state: Settings) {
  const {
    set: _s,
    addPlaylist: _a,
    removePlaylist: _r,
    updatePlaylist: _u,
    setHiddenCategories: _hc,
    setCategoryHidden: _ch,
    setHiddenCategoryMode: _cm,
    setPlaylistCategoryCount: _cc,
    replacePlaylists: _rp,
    reset: _re,
    scale: _sc,
    activePlaylist: _ap,
    ...data
  } = state;
  write(KEY, JSON.stringify(data));
}

export const useSettings = create<Settings>((set, get) => ({
  ...load(),

  set(key, value) {
    set({ [key]: value } as Pick<Settings, typeof key>);
    persist(get());
  },

  addPlaylist(name, source) {
    const playlist = {
      id: freshId(get().playlists),
      name: name.trim(),
      source,
      sourceVersion: 1,
      hiddenCategories: [],
      hiddenCategoryMode: "exclude" as HiddenCategoryMode,
    };
    const first = !get().playlists.length;
    set({
      playlists: [...get().playlists, playlist],
      // The first one added becomes the active one, so adding a playlist is the whole of
      // first run rather than adding then choosing.
      activePlaylistId: first ? playlist.id : get().activePlaylistId,
    });
    persist(get());
  },

  removePlaylist(id) {
    const remaining = get().playlists.filter((p) => p.id !== id);
    set({
      playlists: remaining,
      activePlaylistId:
        get().activePlaylistId === id ? (remaining[0]?.id ?? "") : get().activePlaylistId,
    });
    usePersonal.getState().clearPlaylistPersonal(id);
    persist(get());
  },

  updatePlaylist(id, name, source) {
    const existing = get().playlists.find((playlist) => playlist.id === id);
    const replaceAccount = existing ? replacesAccount(existing.source, source) : false;
    if (existing && !sameSource(existing.source, source)) {
      usePersonal.getState().migrateVodPersonal(get().playlists);
      usePersonal.getState().preserveSourcePersonal(existing);
    }
    set({
      playlists: get().playlists.map((p) => {
        if (p.id !== id) return p;
        const changed = !sameSource(p.source, source);
        return {
          ...p,
          name: name.trim(),
          source,
          sourceVersion: changed ? p.sourceVersion + 1 : p.sourceVersion,
          hiddenCategories: replaceAccount ? [] : p.hiddenCategories,
          categoryCount: changed ? undefined : p.categoryCount,
        };
      }),
    });
    if (replaceAccount) usePersonal.getState().clearPlaylistPersonal(id);
    else if (existing) {
      const next = get().playlists.find((playlist) => playlist.id === id);
      if (next && !sameSource(existing.source, source))
        usePersonal.getState().rekeySourcePersonal(existing, next);
    }
    persist(get());
  },

  setHiddenCategories(playlistId, categories) {
    set({
      playlists: get().playlists.map((playlist) =>
        playlist.id === playlistId ? { ...playlist, hiddenCategories: categories } : playlist,
      ),
    });
    persist(get());
  },

  setCategoryHidden(playlistId, category, hidden) {
    const playlist = get().playlists.find((item) => item.id === playlistId);
    if (!playlist) return;
    const without = playlist.hiddenCategories.filter((name) => name !== category);
    get().setHiddenCategories(playlistId, hidden ? [...without, category] : without);
  },

  setHiddenCategoryMode(playlistId, mode) {
    set({
      playlists: get().playlists.map((playlist) =>
        playlist.id === playlistId ? { ...playlist, hiddenCategoryMode: mode } : playlist,
      ),
    });
    persist(get());
  },

  setPlaylistCategoryCount(playlistId, count) {
    const playlist = get().playlists.find((item) => item.id === playlistId);
    const next = Math.max(0, Math.floor(count));
    if (!playlist || playlist.categoryCount === next) return;
    set({
      playlists: get().playlists.map((item) =>
        item.id === playlistId ? { ...item, categoryCount: next } : item,
      ),
    });
    persist(get());
  },

  replacePlaylists(playlists, activePlaylistId, locale) {
    set({ playlists, activePlaylistId, ...(locale ? { locale } : {}) });
    persist(get());
  },

  reset() {
    set({ ...DEFAULTS });
    usePersonal.getState().clearPersonal();
    persist(get());
  },

  scale: () => FONT_SIZES.find((s) => s.id === get().fontSizeId)?.scale ?? 1,
  activePlaylist: () =>
    get().playlists.find((p) => p.id === get().activePlaylistId) ?? get().playlists[0],
}));
