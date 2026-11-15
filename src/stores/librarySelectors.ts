import type { useLibrary } from "./library";
type LibraryState = ReturnType<typeof useLibrary.getState>;

// Shell-owned data only. Catalogue byte/ingest progress and preview arrays belong
// to their view consumers; retaining actions by reference preserves current reads.
export function selectShellLibrary(s: LibraryState) {
  return {
    catalogs: s.catalogs,
    categories: s.categories,
    categoryItems: s.categoryItems,
    searchItems: s.searchItems,
    movieDetails: s.movieDetails,
    seriesDetails: s.seriesDetails,
    guides: s.guides,
    playlistId: s.playlistId,
    sourceVersion: s.sourceVersion,
    selectPlaylist: s.selectPlaylist,
    loadCategories: s.loadCategories,
    loadCategory: s.loadCategory,
    loadSearch: s.loadSearch,
    loadMovie: s.loadMovie,
    loadSeries: s.loadSeries,
    loadGuide: s.loadGuide,
    loadBatchGuides: s.loadBatchGuides,
    guideFor: s.guideFor,
    retry: s.retry,
  };
}
