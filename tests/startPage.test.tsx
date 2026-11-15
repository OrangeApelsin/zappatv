import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { StartPage } from "../src/components/StartPage";
import { KEY } from "../src/hooks/useRemote";
import { useSettings } from "../src/stores/settings";
import { mountApp, press } from "./support/app";
import type { Channel } from "../types";
import type { ChannelGuide } from "../stores/library";

const PLAYLIST = `#EXTM3U
#EXTINF:-1 tvg-id="a" group-title="News",Alpha
http://example.invalid/a.m3u8
#EXTINF:-1 tvg-id="b" group-title="News",Beta
http://example.invalid/b.m3u8`;

const mount = (options: Parameters<typeof mountApp>[1] = {}) => mountApp(PLAYLIST, options);

const sampleChannel: Channel = {
  id: "ch-1",
  number: 101,
  name: "SVT1 HD",
  url: "http://stream.invalid/101.m3u8",
  group: "Sweden",
  logo: "http://logo.invalid/svt1.png",
};

const sampleGuide: ChannelGuide = {
  state: "ready",
  items: [],
  current: {
    id: "prog-1",
    channelId: "ch-1",
    title: "Rapport & Nyheter",
    start: "20:00",
    end: "20:30",
    startTimestamp: Math.floor(Date.now() / 1000) - 600,
    stopTimestamp: Math.floor(Date.now() / 1000) + 1200,
  },
};

beforeEach(() => {
  localStorage.clear();
  useSettings.getState().set("locale", "en");
});

afterEach(cleanup);

test("StartPage renders Live TV, Movies, Series, Search, and Settings cards", () => {
  render(
    <StartPage
      lastChannel={sampleChannel}
      guide={sampleGuide}
      movieCategoriesCount={42}
      seriesCategoriesCount={18}
      onSelectTv={() => {}}
      onSelectMovies={() => {}}
      onSelectSeries={() => {}}
      onSelectSearch={() => {}}
      onSelectSettings={() => {}}
      onExitApp={() => {}}
    />,
  );

  expect(screen.getByText("Zappa TV")).toBeTruthy();
  expect(screen.getByText("Live TV")).toBeTruthy();
  expect(screen.getByText("SVT1 HD")).toBeTruthy();
  expect(screen.getByText("101")).toBeTruthy();
  expect(screen.getByText("Rapport & Nyheter")).toBeTruthy();

  expect(screen.getByText("Movies")).toBeTruthy();
  expect(screen.getByText("42 categories")).toBeTruthy();

  expect(screen.getByText("Series")).toBeTruthy();
  expect(screen.getByText("18 categories")).toBeTruthy();

  expect(screen.getByText("Search")).toBeTruthy();
  expect(screen.getByText("Settings")).toBeTruthy();
});

test("navigates spatially across cards via D-pad", () => {
  render(
    <StartPage
      lastChannel={sampleChannel}
      onSelectTv={() => {}}
      onSelectMovies={() => {}}
      onSelectSeries={() => {}}
      onSelectSearch={() => {}}
      onSelectSettings={() => {}}
      onExitApp={() => {}}
    />,
  );

  const tvTile = document.querySelector(".tile-tv");
  const moviesTile = document.querySelector(".tile-movies");
  const seriesTile = document.querySelector(".tile-series");
  const searchBtn = document.querySelector(".btn-search");
  const settingsBtn = document.querySelector(".btn-settings");

  // Initial focus on Live TV
  expect(tvTile?.classList.contains("focused")).toBe(true);

  // Right to Movies
  fireEvent.keyDown(window, { keyCode: KEY.RIGHT });
  expect(moviesTile?.classList.contains("focused")).toBe(true);

  // Right to Series
  fireEvent.keyDown(window, { keyCode: KEY.RIGHT });
  expect(seriesTile?.classList.contains("focused")).toBe(true);

  // Left back to Movies
  fireEvent.keyDown(window, { keyCode: KEY.LEFT });
  expect(moviesTile?.classList.contains("focused")).toBe(true);

  // Left back to TV
  fireEvent.keyDown(window, { keyCode: KEY.LEFT });
  expect(tvTile?.classList.contains("focused")).toBe(true);

  // Down to Search
  fireEvent.keyDown(window, { keyCode: KEY.DOWN });
  expect(searchBtn?.classList.contains("focused")).toBe(true);

  // Right to Settings
  fireEvent.keyDown(window, { keyCode: KEY.RIGHT });
  expect(settingsBtn?.classList.contains("focused")).toBe(true);

  // Up to Series
  fireEvent.keyDown(window, { keyCode: KEY.UP });
  expect(seriesTile?.classList.contains("focused")).toBe(true);
});

test("triggers action callbacks on Enter key", () => {
  const onSelectTv = vi.fn();
  const onSelectMovies = vi.fn();
  const onSelectSeries = vi.fn();
  const onSelectSearch = vi.fn();
  const onSelectSettings = vi.fn();

  render(
    <StartPage
      lastChannel={sampleChannel}
      onSelectTv={onSelectTv}
      onSelectMovies={onSelectMovies}
      onSelectSeries={onSelectSeries}
      onSelectSearch={onSelectSearch}
      onSelectSettings={onSelectSettings}
      onExitApp={() => {}}
    />,
  );

  // Enter on initial TV
  fireEvent.keyDown(window, { keyCode: KEY.ENTER });
  expect(onSelectTv).toHaveBeenCalledTimes(1);

  // Move to Movies & Enter
  fireEvent.keyDown(window, { keyCode: KEY.RIGHT });
  fireEvent.keyDown(window, { keyCode: KEY.ENTER });
  expect(onSelectMovies).toHaveBeenCalledTimes(1);

  // Move to Series & Enter
  fireEvent.keyDown(window, { keyCode: KEY.RIGHT });
  fireEvent.keyDown(window, { keyCode: KEY.ENTER });
  expect(onSelectSeries).toHaveBeenCalledTimes(1);

  // Move to Settings & Enter
  fireEvent.keyDown(window, { keyCode: KEY.DOWN });
  fireEvent.keyDown(window, { keyCode: KEY.ENTER });
  expect(onSelectSettings).toHaveBeenCalledTimes(1);

  // Move to Search & Enter
  fireEvent.keyDown(window, { keyCode: KEY.LEFT });
  fireEvent.keyDown(window, { keyCode: KEY.ENTER });
  expect(onSelectSearch).toHaveBeenCalledTimes(1);
});

test("Return key on StartPage calls onExitApp", () => {
  const onExitApp = vi.fn();
  render(
    <StartPage
      onSelectTv={() => {}}
      onSelectMovies={() => {}}
      onSelectSeries={() => {}}
      onSelectSearch={() => {}}
      onSelectSettings={() => {}}
      onExitApp={onExitApp}
    />,
  );

  fireEvent.keyDown(window, { keyCode: KEY.BACK });
  expect(onExitApp).toHaveBeenCalledTimes(1);
});

test("App integration: startScreen='home' boots into StartPage, BACK at bare picture returns to home, BACK on home exits", async () => {
  await mount({ startScreen: "home" });

  // Boots into StartPage
  expect(document.querySelector("#view-home")).toBeTruthy();
  expect(document.querySelector(".dialog")).toBeNull();

  // Press Enter on Live TV card -> tunes to channel and plays
  press(KEY.ENTER);
  expect(document.querySelector("#view-home")).toBeNull();

  // Clear banner
  press(KEY.BACK);
  expect(document.querySelector(".dialog")).toBeNull();

  // Bare video: pressing BACK returns to StartPage (NEVER opens exit dialog)
  press(KEY.BACK);
  expect(document.querySelector("#view-home")).toBeTruthy();
  expect(document.querySelector(".dialog")).toBeNull();

  // On StartPage: pressing BACK is the ONLY place that opens the exit dialog
  press(KEY.BACK);
  expect(document.querySelector(".dialog")).toBeTruthy();
});

test("Home titles stay separate from loading, failure and Swedish category counts", () => {
  useSettings.getState().set("locale", "sv");
  const props = {
    onSelectTv: vi.fn(),
    onSelectMovies: vi.fn(),
    onSelectSeries: vi.fn(),
    onSelectSearch: vi.fn(),
    onSelectSettings: vi.fn(),
    onExitApp: vi.fn(),
  };
  const { rerender } = render(
    <StartPage {...props} movieCategoriesState="loading" seriesCategoriesState="failed" />,
  );
  expect(document.querySelector(".tile-movies b")?.textContent).toBe("Filmer");
  expect(document.querySelector(".tile-movies .home-tile-sub")?.textContent).not.toBe("Filmer");
  expect(document.querySelector(".tile-series b")?.textContent).toBe("Serier");
  rerender(
    <StartPage
      {...props}
      movieCategoriesState="loaded"
      movieCategoriesCount={56}
      seriesCategoriesState="empty"
    />,
  );
  expect(document.querySelector(".tile-movies .home-tile-sub")?.textContent).toBe(
    "56 kategorier",
  );
  expect(document.querySelector(".tile-series .home-tile-sub")?.textContent).toBe(
    "0 kategorier",
  );
});

test("StartPage shows Now Playing resume banner and navigates to it with UP + OK", () => {
  const onResumePlayback = vi.fn();
  render(
    <StartPage
      lastChannel={sampleChannel}
      nowPlaying={{ title: "Interstellar", subtitle: "Sci-Fi" }}
      onResumePlayback={onResumePlayback}
      onSelectTv={() => {}}
      onSelectMovies={() => {}}
      onSelectSeries={() => {}}
      onSelectSearch={() => {}}
      onSelectSettings={() => {}}
      onExitApp={() => {}}
    />,
  );

  const banner = document.querySelector(".home-now-playing");
  expect(banner).toBeTruthy();
  expect(banner?.textContent).toContain("Now Playing");
  expect(banner?.textContent).toContain("Interstellar");

  fireEvent.keyDown(window, { keyCode: KEY.UP });
  expect(banner?.classList.contains("focused")).toBe(true);
  fireEvent.keyDown(window, { keyCode: KEY.ENTER });
  expect(onResumePlayback).toHaveBeenCalledTimes(1);
});

test("StartPage preloads catalog when focusing movies or series card", () => {
  const onPreloadKind = vi.fn();
  render(
    <StartPage
      lastChannel={sampleChannel}
      onSelectTv={() => {}}
      onSelectMovies={() => {}}
      onSelectSeries={() => {}}
      onSelectSearch={() => {}}
      onSelectSettings={() => {}}
      onExitApp={() => {}}
      onPreloadKind={onPreloadKind}
    />,
  );

  // Initial focus on Live TV
  expect(onPreloadKind).not.toHaveBeenCalled();

  // Move right to movies
  fireEvent.keyDown(window, { keyCode: KEY.RIGHT });
  expect(onPreloadKind).toHaveBeenCalledWith("movie");

  // Move right to series
  fireEvent.keyDown(window, { keyCode: KEY.RIGHT });
  expect(onPreloadKind).toHaveBeenCalledWith("series");
});
