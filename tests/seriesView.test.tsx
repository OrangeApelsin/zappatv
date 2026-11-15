import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SeriesView } from "../src/components/SeriesView";
import { KEY } from "../src/hooks/useRemote";
import type { XtreamEpisode } from "../src/services/xtream";
import { useLibrary } from "../src/stores/library";
import { useVodBrowse } from "../src/stores/vodBrowse";
import type { ShapedVodItem } from "../src/workers/vodWorker";
import { press } from "./support/app";

const MOCK_SERIES: ShapedVodItem = {
  kind: "series",
  name: "Succession",
  skey: "succession",
  key: "s501",
  seriesId: "501",
  logo: "https://img.example/succession.jpg",
  group: "Drama",
  num: 1,
  rating: "8.9",
  year: "2018",
  plot: "The Roy family is known for controlling the biggest media and entertainment company in the world...",
  genre: "Drama",
};

const MOCK_EPISODES: XtreamEpisode[] = [
  {
    key: "ep-101",
    episodeId: "101",
    seriesKey: "s501",
    season: 1,
    number: 1,
    name: "Celebration",
    extension: "mp4",
    durationSeconds: 3600,
  },
  {
    key: "ep-102",
    episodeId: "102",
    seriesKey: "s501",
    season: 1,
    number: 2,
    name: "Shit Show at the Hit Factory",
    extension: "mp4",
    durationSeconds: 3500,
  },
  {
    key: "ep-201",
    episodeId: "201",
    seriesKey: "s501",
    season: 2,
    number: 1,
    name: "The Summer Palace",
    extension: "mp4",
    durationSeconds: 3700,
  },
];

describe("Dedicated Series Episodes Hub (SeriesView)", () => {
  beforeEach(() => {
    useVodBrowse.getState().reset();
    useLibrary.setState({
      seriesDetails: {
        s501: {
          state: "loaded",
          value: {
            key: "s501",
            seriesId: "501",
            categoryKey: "series:Drama",
            name: "Succession",
            logo: "https://img.example/succession.jpg",
            year: "2018",
            rating: "8.9",
            plot: "The Roy family is known for controlling the biggest media and entertainment company...",
            genre: "Drama",
            cast: "Brian Cox, Jeremy Strong",
            episodes: MOCK_EPISODES,
          },
        },
      },
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("renders large left poster, series metadata, season pills, and episodes", () => {
    render(<SeriesView series={MOCK_SERIES} onPlayEpisode={() => {}} onBack={() => {}} />);

    // Left and right titles
    expect(screen.getAllByText("Succession").length).toBeGreaterThan(0);
    expect(screen.getByText("2 seasons")).toBeTruthy();
    expect(screen.getByText("3 episodes")).toBeTruthy();

    // Season pills
    expect(screen.getByRole("button", { name: "Season 1" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Season 2" })).toBeTruthy();

    // Episode titles in season 1
    expect(screen.getByText("Celebration")).toBeTruthy();
    expect(screen.getByText("Shit Show at the Hit Factory")).toBeTruthy();
  });

  it("switches season when clicking a season button", () => {
    render(<SeriesView series={MOCK_SERIES} onPlayEpisode={() => {}} onBack={() => {}} />);

    // Click Season 2
    fireEvent.click(screen.getByRole("button", { name: "Season 2" }));

    // Season 2 episode should be visible
    expect(screen.getByText("The Summer Palace")).toBeTruthy();
    // Season 1 episode should not be rendered
    expect(screen.queryByText("Celebration")).toBeNull();
  });

  it("navigates remote D-pad up/down across episodes and seasons, and launches episode on OK", () => {
    const onPlay = vi.fn();
    const onBack = vi.fn();

    render(<SeriesView series={MOCK_SERIES} onPlayEpisode={onPlay} onBack={onBack} />);

    // Initial focus starts on first episode (Celebration)
    // Press OK to play
    press(KEY.ENTER);
    expect(onPlay).toHaveBeenCalledWith(MOCK_EPISODES[0]);

    // Press Down to move to episode 2
    press(KEY.DOWN);
    press(KEY.ENTER);
    expect(onPlay).toHaveBeenCalledWith(MOCK_EPISODES[1]);

    // Press Up twice to move up to Season pills
    press(KEY.UP);
    press(KEY.UP);
    expect(document.querySelector(".sr-season.focused")).toBeTruthy();

    // Press Right to switch to Season 2
    press(KEY.RIGHT);
    expect(screen.getByText("The Summer Palace")).toBeTruthy();

    // Press Return to go back
    press(KEY.BACK);
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
