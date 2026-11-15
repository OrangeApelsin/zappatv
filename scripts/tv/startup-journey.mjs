/** Browser-side predicate: the home shell can paint before source initialization.
 * Wait for its first channel before navigating, so the initial source reset cannot
 * overwrite the Movies selection. Serialized into CDP; keep this self-contained.
 */
export function openFixtureMovies(kind = "movie") {
  const button = document.querySelector(kind === "series" ? ".tile-series" : ".tile-movies");
  if (!button || !document.querySelector(".home-tile-channel")) return false;
  if (document.querySelector(".splash .spinner")) return false;
  button.click();
  return true;
}
