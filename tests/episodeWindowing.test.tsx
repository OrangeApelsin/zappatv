import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { SeriesView } from "../src/components/SeriesView";
import { MediaList } from "../src/components/MediaList";
import { useLibrary } from "../src/stores/library";
import { usePersonal } from "../src/stores/personal";
import { KEY } from "../src/hooks/useRemote";
import { press } from "./support/app";
import type { XtreamEpisode } from "../src/services/xtream";
import { useRef } from "react";
import { useScrollWindow } from "../src/hooks/useScrollWindow";
const series = {
  kind: "series" as const,
  key: "xtream:source-a:series:1",
  seriesId: "1",
  name: "Long Series",
  skey: "long series",
  group: "Shows",
  logo: "",
  rating: "",
  num: 1,
};
const episodes: XtreamEpisode[] = Array.from({ length: 1000 }, (_, i) => ({
  key: `xtream:source-a:episode:${i + 1}`,
  episodeId: String(i + 1),
  seriesKey: series.key,
  season: 0,
  number: i + 1,
  name: `Episode ${i + 1}`,
  extension: i % 2 ? "mkv" : "mp4",
  durationSeconds: 100,
}));
const next: XtreamEpisode = {
  ...episodes[0],
  key: "xtream:source-a:episode:1001",
  episodeId: "1001",
  season: 7,
  name: "Sparse season",
};
function seed(items = [...episodes, next]) {
  useLibrary.setState({
    seriesDetails: {
      [series.key]: {
        state: "loaded",
        value: {
          key: series.key,
          seriesId: "1",
          categoryKey: "series:1",
          name: series.name,
          logo: "",
          year: "",
          rating: "",
          plot: "",
          cast: "",
          genre: "",
          episodes: items,
        },
      },
    },
  });
  vi.spyOn(useLibrary.getState(), "loadSeries").mockResolvedValue();
}
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  useLibrary.getState().clear();
  usePersonal.setState({ progress: [] });
});
test("metadata-driven viewport shrink remeasures without native ResizeObserver support", () => {
  let height = 835;
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(() => height);
  function Probe({ identity }: { identity: string }) {
    const ref = useRef<HTMLDivElement>(null);
    const win = useScrollWindow(ref, 1000, 999, 1, 92, identity);
    return <div ref={ref} data-testid="viewport" data-top={win.top} />;
  }
  const view = render(<Probe identity="loading" />);
  expect(screen.getByTestId("viewport").scrollTop).toBe(92000 - 835);
  height = 745;
  view.rerender(<Probe identity="loaded" />);
  expect(screen.getByTestId("viewport").scrollTop).toBe(92000 - 745);
});
test("a long zero-numbered season has bounded DOM and remembers canonical selection across sparse seasons", () => {
  seed();
  const play = vi.fn();
  render(<SeriesView series={series} onPlayEpisode={play} onBack={() => {}} />);
  expect(screen.getByRole("button", { name: "Season 0" })).toBeTruthy();
  expect(document.querySelectorAll(".sr-ep").length).toBeLessThanOrEqual(14);
  act(() => {
    for (let i = 0; i < 999; i++) press(KEY.DOWN);
  });
  expect(document.querySelector(".sr-ep.focused")?.getAttribute("data-episode-key")).toBe(
    episodes[999].key,
  );
  expect(document.querySelectorAll(".sr-ep").length).toBeLessThanOrEqual(14);
  press(KEY.ENTER);
  expect(play).toHaveBeenLastCalledWith(episodes[999]);
  expect(play.mock.calls[0][0].extension).toBe("mkv");
  fireEvent.click(screen.getByRole("button", { name: "Season 7" }));
  expect(screen.getByText("Sparse season")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Season 0" }));
  expect(document.querySelector(".sr-ep.focused")?.getAttribute("data-episode-key")).toBe(
    episodes[999].key,
  );
});
test("refresh reordering retains the selected episode key and removal falls back to an existing episode", () => {
  seed();
  render(<SeriesView series={series} onPlayEpisode={() => {}} onBack={() => {}} />);
  press(KEY.DOWN);
  act(() => seed([episodes[1], episodes[0]]));
  expect(document.querySelector(".sr-ep.focused")?.getAttribute("data-episode-key")).toBe(
    episodes[1].key,
  );
  act(() => seed([episodes[0]]));
  expect(document.querySelector(".sr-ep.focused")?.getAttribute("data-episode-key")).toBe(
    episodes[0].key,
  );
  act(() => seed([]));
  expect(document.querySelectorAll(".sr-ep")).toHaveLength(0);
  expect(document.querySelector(".sr-ep-scroller")?.scrollTop).toBe(0);
});
test("both layouts react to the same source-scoped resume/watched record and ignore equal foreign provider IDs", () => {
  seed([episodes[0]]);
  usePersonal.setState({
    progress: [
      { itemKey: episodes[0].key, seconds: 30 },
      { itemKey: "xtream:source-b:episode:1", seconds: 99, duration: 100 },
    ],
  });
  render(
    <>
      <SeriesView series={series} onPlayEpisode={() => {}} onBack={() => {}} />
      <MediaList
        title="Episodes"
        items={[
          {
            key: episodes[0].key,
            kind: "episode",
            name: episodes[0].name,
            durationSeconds: 100,
          },
        ]}
        state="loaded"
        index={0}
        focused
        scale={1}
        onSelect={() => {}}
        onRetry={() => {}}
        onWheel={() => {}}
      />
    </>,
  );
  expect(
    screen.getAllByRole("progressbar").map((el) => el.getAttribute("aria-valuenow")),
  ).toEqual(["30", "30"]);
  act(() =>
    usePersonal.setState({
      progress: [{ itemKey: episodes[0].key, seconds: 95, duration: 100 }],
    }),
  );
  expect(screen.getAllByText("✓ Watched")).toHaveLength(2);
  act(() => usePersonal.getState().completeProgress(episodes[0].key));
  expect(screen.queryAllByRole("progressbar")).toHaveLength(0);
});
