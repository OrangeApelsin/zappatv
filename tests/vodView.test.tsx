import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VodView } from "../src/components/VodView";
import { KEY } from "../src/hooks/useRemote";
import { useLibrary } from "../src/stores/library";
import { useSettings } from "../src/stores/settings";
import { useVodBrowse } from "../src/stores/vodBrowse";
import type { ShapedVodItem } from "../workers/vodWorker";
import { press } from "./support/app";

const MOCK_MOVIES: ShapedVodItem[] = [
  {
    kind: "movie",
    name: "Avatar",
    skey: "avatar",
    key: "v1",
    streamId: "1",
    logo: "https://img.example/avatar.jpg",
    group: "Sci-Fi",
    num: 1,
    rating: "7.9",
    year: "2009",
    added: 100,
  },
  {
    kind: "movie",
    name: "Batman Begins",
    skey: "batman begins",
    key: "v2",
    streamId: "2",
    logo: "https://img.example/batman.jpg",
    group: "Action",
    num: 2,
    rating: "8.2",
    year: "2005",
    added: 200,
  },
  {
    kind: "movie",
    name: "Casablanca",
    skey: "casablanca",
    key: "v3",
    streamId: "3",
    logo: "https://img.example/casa.jpg",
    group: "Classic",
    num: 3,
    rating: "8.5",
    year: "1942",
    added: 300,
  },
  {
    kind: "movie",
    name: "Dune",
    skey: "dune",
    key: "v4",
    streamId: "4",
    logo: "https://img.example/dune.jpg",
    group: "Sci-Fi",
    num: 4,
    rating: "8.0",
    year: "2021",
    added: 400,
  },
  {
    kind: "movie",
    name: "Elf",
    skey: "elf",
    key: "v5",
    streamId: "5",
    logo: "https://img.example/elf.jpg",
    group: "Comedy",
    num: 5,
    rating: "7.1",
    year: "2003",
    added: 500,
  },
  {
    kind: "movie",
    name: "Fight Club",
    skey: "fight club",
    key: "v6",
    streamId: "6",
    logo: "https://img.example/fight.jpg",
    group: "Drama",
    num: 6,
    rating: "8.8",
    year: "1999",
    added: 600,
  },
  {
    kind: "movie",
    name: "Gladiator",
    skey: "gladiator",
    key: "v7",
    streamId: "7",
    logo: "https://img.example/glad.jpg",
    group: "Action",
    num: 7,
    rating: "8.5",
    year: "2000",
    added: 700,
  },
];
afterEach(() => {
  cleanup();
  useSettings.setState({ locale: "en" });
});

describe("Fullscreen VOD Poster Grid & Category Navigation (VodView)", () => {
  beforeEach(() => {
    useVodBrowse.getState().reset();
    useLibrary.setState({
      vodItems: MOCK_MOVIES,
      vodGroups: [
        { id: "Action", name: "Action", count: 2 },
        { id: "Sci-Fi", name: "Sci-Fi", count: 2 },
      ],
      catalogProgress: {
        ...useLibrary.getState().catalogProgress,
        movie: {
          kind: "movie",
          state: "loaded",
          phase: "ready",
          percent: 100,
          loaded: 7,
          total: 7,
        },
      },
    });
  });

  it("mirrors category/grid movement and poster columns in Arabic", () => {
    useSettings.setState({ locale: "ar" });
    render(<VodView onPlayMovie={() => {}} onOpenSeries={() => {}} onBack={() => {}} />);
    const labels = [...document.querySelectorAll(".vod-tab")].map(
      (button) => button.textContent,
    );
    expect(new Set(labels).size).toBe(5);
    expect((document.querySelector(".vod-tile") as HTMLElement).style.right).toBe("8px");
    press(KEY.LEFT);
    expect(document.querySelector(".vod-tile.focused")?.getAttribute("data-media-key")).toBe(
      "v2",
    );
    press(KEY.RIGHT);
    expect(document.querySelector(".vod-tile.focused")?.getAttribute("data-media-key")).toBe(
      "v1",
    );
    press(KEY.RIGHT);
    expect(document.querySelector(".vod-cat.focused")).toBeTruthy();
    press(KEY.LEFT);
    expect(document.querySelector(".vod-tile.focused")).toBeTruthy();
  });

  it("renders movies grid with 6 columns, category rail, and detail preview", () => {
    render(
      <VodView
        initialKind="movie"
        onPlayMovie={() => {}}
        onOpenSeries={() => {}}
        onBack={() => {}}
      />,
    );

    expect(screen.getByRole("button", { name: "Movies" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Series" })).toBeTruthy();
    expect(screen.getAllByText("All Movies").length).toBeGreaterThan(0);

    // Check titles rendered in grid / header
    expect(screen.getAllByText("Gladiator").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Fight Club").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Avatar").length).toBeGreaterThan(0);
  });

  it("navigates remote D-pad between Grid, Categories, and Alphabet rail", () => {
    const onPlay = vi.fn();
    const onBack = vi.fn();

    render(
      <VodView
        initialKind="movie"
        onPlayMovie={onPlay}
        onOpenSeries={() => {}}
        onBack={onBack}
      />,
    );

    // Initial focus starts in grid (index 0: Gladiator since sorted by added desc)
    // Press Left to move to categories
    press(KEY.LEFT);
    expect(document.querySelector(".vod-cat.focused")).toBeTruthy();

    // Press Right to return to grid
    press(KEY.RIGHT);
    expect(document.querySelector(".vod-tile.focused")).toBeTruthy();

    // Press OK on focused movie in grid
    press(KEY.ENTER);
    expect(onPlay).toHaveBeenCalledTimes(1);
  });

  it("cycles sort modes on Yellow key press", () => {
    render(
      <VodView
        initialKind="movie"
        onPlayMovie={() => {}}
        onOpenSeries={() => {}}
        onBack={() => {}}
      />,
    );

    expect(screen.getAllByText(/Sort: Name/).length).toBeGreaterThan(0);

    press(KEY.YELLOW);
    expect(screen.getAllByText(/Sort: Year/).length).toBeGreaterThan(0);

    press(KEY.YELLOW);
    expect(screen.getAllByText(/Sort: Rating/).length).toBeGreaterThan(0);
  });

  it("jumps to alphabet letter on selection", () => {
    render(
      <VodView
        initialKind="movie"
        onPlayMovie={() => {}}
        onOpenSeries={() => {}}
        onBack={() => {}}
      />,
    );

    // Click 'B' in alphabet rail
    const alphabetLetters = [...document.querySelectorAll(".vod-az b")];
    const letterB = alphabetLetters.find((el) => el.textContent === "B");
    expect(letterB).toBeTruthy();
    fireEvent.click(letterB!);

    // Grid should jump to Batman Begins
    const detailTitle = document.querySelector(".vod-title");
    expect(detailTitle?.textContent).toBe("Batman Begins");
  });

  it("places Now Playing button last in top toolbar when playback is active", () => {
    const onResumePlayback = vi.fn();
    render(
      <VodView
        initialKind="movie"
        onPlayMovie={() => {}}
        onOpenSeries={() => {}}
        onBack={() => {}}
        onResumePlayback={onResumePlayback}
      />,
    );

    const tabs = [...document.querySelectorAll(".vod-tab")];
    expect(tabs.length).toBe(6);
    expect(tabs[tabs.length - 1]?.getAttribute("data-tool")).toBe("nowPlaying");
    fireEvent.click(tabs[tabs.length - 1]!);
    expect(onResumePlayback).toHaveBeenCalledTimes(1);
  });
});
