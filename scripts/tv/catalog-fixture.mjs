/** Sanitized Xtream-shaped data for repeatable large-catalog/long-season journeys.
 * Test tooling only; no production import, network access, secrets or wall clock.
 */
export function catalogFixture({ count = 10_000, plotBytes = 0, source = "a" } = {}) {
  if (
    ![10_000, 20_000, 28_316, 51_881].includes(count) ||
    !Number.isInteger(plotBytes) ||
    plotBytes < 0 ||
    plotBytes > 4096 ||
    !["a", "b"].includes(source)
  )
    throw new Error(
      "Use 10000/20000/28316/51881 records, 0..4096 plot bytes and fixture source a/b.",
    );
  const categories = [
    { category_id: "1", category_name: "Latin ÅÄÖ" },
    { category_id: "2", category_name: "العربية" },
    { category_id: "3", category_name: "Duplicate" },
    { category_id: "4", category_name: "Duplicate" },
    { category_id: "empty", category_name: "Empty" },
  ];
  // Sources deliberately reuse numeric IDs; callers must retain source identity.
  const items = (kind) =>
    Array.from({ length: count }, (_, index) => ({
      [kind === "movie" ? "stream_id" : "series_id"]: index + 1,
      name: `${source} ${kind} ${String(index + 1).padStart(5, "0")} ${index % 2 ? "العربية" : "ÅÄÖ"}${index === count - 1 ? " FINAL" : ""}`,
      category_id: String((index % 4) + 1),
      stream_icon: "/icon.png",
      cover: "/icon.png",
      container_extension: "mp4",
      year: "2026",
      rating: "8.0",
      plot: "x".repeat(plotBytes),
    }));
  return {
    source: `https://provider-${source}.example.invalid`,
    categories,
    movies: items("movie"),
    series: items("series"),
    seriesInfo: {
      info: { name: `${source} Long season`, plot: "Synthetic fixture" },
      episodes: {
        1: Array.from({ length: 1000 }, (_, index) => ({
          id: index + 1,
          episode_num: index + 1,
          title: `Episode ${index + 1} ÅÄÖ العربية${index === 999 ? " FINAL" : ""}`,
          container_extension: index % 2 ? "mkv" : "mp4",
          info: { duration_secs: 2700 },
        })),
        2: [{ id: 1001, episode_num: 1, title: "Next season", container_extension: "mp4" }],
      },
    },
  };
}
