import { vi } from "vitest";
export function vodProvider(
  flags: { failMovies?: boolean; failSeries?: boolean; failDetail?: boolean } = {},
) {
  const movies = [
    { stream_id: "100", category_id: "10", name: "Film A", container_extension: "mkv" },
    { stream_id: "101", category_id: "10", name: "Film B", container_extension: "mp4" },
    { stream_id: "102", category_id: "11", name: "Film C", container_extension: "mkv" },
  ];
  const series = [
    { series_id: "200", category_id: "20", name: "Show A" },
    { series_id: "201", category_id: "20", name: "Show B" },
    { series_id: "202", category_id: "21", name: "Show C" },
  ];
  return vi.fn(async (input: string | URL) => {
    const url = new URL(String(input));
    const action = url.searchParams.get("action") ?? "authenticate";
    if (action === "get_vod_streams" && flags.failMovies) throw new Error("Offline movies");
    if (action === "get_series" && flags.failSeries) throw new Error("Offline series");
    if (action === "get_vod_info" && flags.failDetail) throw new Error("Offline detail");
    const id = url.searchParams.get("vod_id") ?? "100";
    const movie = movies.find((item) => item.stream_id === id) ?? movies[0];
    const responses: Record<string, unknown> = {
      authenticate: {
        user_info: { auth: 1, status: "Active" },
        server_info: { server_protocol: "http", url: "provider.example" },
      },
      get_live_categories: [{ category_id: "1", category_name: "Live" }],
      get_live_streams: [
        { stream_id: "1", category_id: "1", name: "TV1" },
        { stream_id: "4", category_id: "1", name: "TV4" },
      ],
      get_vod_categories: [
        { category_id: "10", category_name: "Cinema" },
        { category_id: "11", category_name: "Elsewhere" },
      ],
      get_series_categories: [
        { category_id: "20", category_name: "Shows" },
        { category_id: "21", category_name: "Other shows" },
      ],
      get_vod_streams: movies,
      get_series: series,
      get_vod_info: { info: { name: movie.name, plot: "Provider detail" }, movie_data: movie },
      get_series_info: {
        info: { name: "Show B", category_id: "20" },
        episodes: {
          "0": [
            { id: "201", episode_num: 1, title: "Pilot", container_extension: "mkv" },
            { id: "202", episode_num: 2, title: "Second", container_extension: "mp4" },
          ],
          "7": [{ id: "203", episode_num: 1, title: "Sparse", container_extension: "mkv" }],
        },
      },
    };
    return { ok: true, status: 200, json: async () => responses[action] };
  });
}
