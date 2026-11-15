/** Shared viewer-facing phase labels for both VOD layouts. */
export const CATALOG_PHASE_LABELS = {
  cache: "library.loadCache",
  connect: "library.loadConnect",
  categories: "library.loadCategories",
  request: "library.loadWaiting",
  download: "library.loadDownload",
  parse: "library.loadRead",
  prepare: "library.loadPrepare",
  ingest: "library.loadPrepare",
  index: "library.loadSort",
  ready: "library.loading",
  failed: "library.loading",
} as const;
