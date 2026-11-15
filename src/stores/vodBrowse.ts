import { create } from "zustand";
import { useCallback } from "react";
import type { CatalogSort } from "../services/catalogIndex";
export type VodKind = "movie" | "series";
export interface VodPosition {
  selectedGroup: string | null;
  sortMode: CatalogSort;
  focusZone: "tabs" | "categories" | "grid" | "alphabet" | "status" | "search";
  categoryIndex: number;
  gridIndex: number;
  alphabetIndex: number;
  selectedKey: string;
  scrollTop: number;
  tabIndex: number;
  favouritesOnly: boolean;
  resumeOnly: boolean;
  query: string;
  searchOpen: boolean;
  searchReturn: { key: string; index: number; top: number } | null;
}
export interface EpisodePosition {
  selectedSeason: number | null;
  episodeKey: string;
  fallbackIndex: number;
  focusZone: "seasons" | "episodes" | "status" | "actions";
  scrollTop: number;
  seasons: Record<number, string>;
}
const position = (): VodPosition => ({
  selectedGroup: null,
  sortMode: "name",
  focusZone: "grid",
  categoryIndex: 0,
  gridIndex: 0,
  alphabetIndex: 0,
  selectedKey: "",
  scrollTop: 0,
  tabIndex: 0,
  favouritesOnly: false,
  resumeOnly: false,
  query: "",
  searchOpen: false,
  searchReturn: null,
});
const emptyEpisode: EpisodePosition = {
  selectedSeason: null,
  episodeKey: "",
  fallbackIndex: 0,
  focusZone: "episodes",
  scrollTop: 0,
  seasons: {},
};
interface State {
  source: string;
  movie: VodPosition;
  series: VodPosition;
  episodes: Record<string, EpisodePosition>;
  selectSource: (source: string) => void;
  reset: () => void;
  update: (kind: VodKind, patch: Partial<VodPosition>) => void;
  updateEpisode: (key: string, patch: Partial<EpisodePosition>) => void;
}
/** Session-only focus/context. One current opaque source; never writes on a key
 * path. App restart clears search/browse state, while existing layout preference
 * remains in settings storage. Episode histories are bounded to 32 series. */
export const useVodBrowse = create<State>((set, get) => ({
  source: "",
  movie: position(),
  series: position(),
  episodes: {},
  selectSource(source) {
    if (source !== get().source)
      set({ source, movie: position(), series: position(), episodes: {} });
  },
  reset() {
    set({ source: "", movie: position(), series: position(), episodes: {} });
  },
  update(kind, patch) {
    const current = get()[kind];
    if (
      Object.keys(patch).every(
        (key) => current[key as keyof VodPosition] === patch[key as keyof VodPosition],
      )
    )
      return;
    set({ [kind]: { ...current, ...patch } });
  },
  updateEpisode(key, patch) {
    const current = get().episodes[key] ?? emptyEpisode;
    if (
      Object.keys(patch).every(
        (field) =>
          current[field as keyof EpisodePosition] === patch[field as keyof EpisodePosition],
      )
    )
      return;
    const episodes = { ...get().episodes, [key]: { ...current, ...patch } };
    while (Object.keys(episodes).length > 32) delete episodes[Object.keys(episodes)[0]];
    set({ episodes });
  },
}));
type Update<T> = T | ((current: T) => T);
export function useVodField<K extends keyof VodPosition>(
  kind: VodKind,
  key: K,
): [VodPosition[K], (value: Update<VodPosition[K]>) => void] {
  const value = useVodBrowse((state) => state[kind][key]);
  const update = useCallback(
    (next: Update<VodPosition[K]>) => {
      const state = useVodBrowse.getState();
      const value =
        typeof next === "function"
          ? (next as (current: VodPosition[K]) => VodPosition[K])(state[kind][key])
          : next;
      state.update(kind, { [key]: value, ...(key === "gridIndex" ? { selectedKey: "" } : {}) });
    },
    [kind, key],
  );
  return [value, update];
}
export function useEpisodeField<K extends keyof EpisodePosition>(
  seriesKey: string,
  key: K,
): [EpisodePosition[K], (value: Update<EpisodePosition[K]>) => void] {
  const value = useVodBrowse((state) => (state.episodes[seriesKey] ?? emptyEpisode)[key]);
  const update = useCallback(
    (next: Update<EpisodePosition[K]>) => {
      const state = useVodBrowse.getState();
      const current = (state.episodes[seriesKey] ?? emptyEpisode)[key];
      state.updateEpisode(seriesKey, {
        [key]:
          typeof next === "function"
            ? (next as (current: EpisodePosition[K]) => EpisodePosition[K])(current)
            : next,
      });
    },
    [seriesKey, key],
  );
  return [value, update];
}
