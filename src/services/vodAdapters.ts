import type { ShapedVodItem } from "../workers/vodWorker";
import type { XtreamMovieDetail } from "./xtream";

/** Shared playback handoff; never replace provider metadata with UI labels. */
export function shapedMovie(item: ShapedVodItem): XtreamMovieDetail {
  if (item.kind !== "movie" || !item.streamId || !item.key.startsWith("xtream:"))
    throw new Error("Movie identity is unavailable");
  return {
    key: item.key,
    streamId: item.streamId,
    name: item.name,
    logo: item.logo,
    extension: item.ext || "mp4",
    categoryKey: `movie:${item.categoryId ?? ""}`,
    rating: item.rating,
    year: item.year ?? "",
    plot: item.plot ?? "",
    cast: "",
    director: "",
    genre: item.genre ?? "",
    releaseDate: item.year ?? "",
  };
}
