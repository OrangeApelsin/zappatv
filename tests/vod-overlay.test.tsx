import { afterEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { KEY } from "../src/hooks/useRemote";
import { VodPlaybackBanner } from "../src/components/VodPlaybackBanner";
import type { PlaybackTarget } from "../src/types";
import {
  mountApp,
  press,
  seekChanges,
  setPlaybackTime,
  settle,
  XTREAM_SOURCE,
} from "./support/app";

const movieTarget: PlaybackTarget = {
  id: "xtream:10:movie:100",
  playlistId: "pl-1",
  mode: "finite",
  kind: "movie",
  name: "Interstellar (2014)",
  group: "Sci-Fi",
  logo: "http://example.invalid/interstellar.png",
  url: "http://provider.example/movie/100.mp4",
};

const seriesTarget: PlaybackTarget = {
  id: "xtream:20:episode:201",
  playlistId: "pl-1",
  mode: "finite",
  kind: "episode",
  name: "Pilot",
  group: "Drama",
  logo: "http://example.invalid/breaking-bad.png",
  url: "http://provider.example/series/201.mp4",
};

const categories = {
  movie: [{ category_id: "10", category_name: "Sci-Fi" }],
};

const movieItem = {
  stream_id: "100",
  category_id: "10",
  name: "Interstellar (2014)",
  container_extension: "mp4",
};

function libraryFetch() {
  return vi.fn(async (input: string | URL) => {
    const url = new URL(String(input));
    const action = url.searchParams.get("action") ?? "authenticate";
    const bodies: Record<string, unknown> = {
      authenticate: {
        user_info: { auth: 1, status: "Active" },
        server_info: { server_protocol: "http", url: "provider.example" },
      },
      get_live_categories: [],
      get_vod_categories: categories.movie,
      get_series_categories: [],
      get_live_streams: [],
      get_vod_streams: [movieItem],
      get_vod_info: {
        info: {
          name: "Interstellar (2014)",
          plot: "A team of explorers travel through a wormhole",
        },
        movie_data: { stream_id: "100", category_id: "10", container_extension: "mp4" },
      },
    };
    return { ok: true, status: 200, json: async () => bodies[action] };
  });
}

async function startMovie() {
  await mountApp("", {
    source: XTREAM_SOURCE,
    fetchImplementation: libraryFetch(),
  });
  setPlaybackTime(120, 7200);
  fireEvent.click(screen.getByRole("button", { name: "Movies" }));
  await act(async () => Promise.resolve());
  await settle(100);

  const cat = screen.getAllByText("Sci-Fi").find((item) => item.closest("button"));
  fireEvent.click(cat!.closest("button")!);
  await act(async () => Promise.resolve());
  await settle(100);

  const row = screen.getAllByText("Interstellar (2014)").find((item) => item.closest("button"));
  fireEvent.click(row!.closest("button")!);
  await act(async () => Promise.resolve());
  await settle(100);

  fireEvent.click(screen.getByRole("button", { name: /Play|Resume/ }));
  await settle(100);
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("VodPlaybackBanner Component (TICKET-806)", () => {
  test("renders movie header, timeline, transport row, and color pills", () => {
    const onTogglePause = vi.fn();
    const onSeekBy = vi.fn();

    const { container } = render(
      <VodPlaybackBanner
        target={movieTarget}
        elapsed={120}
        duration={7200}
        paused={false}
        osdActive={true}
        activeRow="transport"
        rowIndex={2}
        onTogglePause={onTogglePause}
        onSeekBy={onSeekBy}
      />,
    );

    expect(container.querySelector(".pb-title")?.textContent).toBe("Interstellar (2014)");
    expect(container.querySelector(".pb-group")?.textContent).toBe("Sci-Fi");
    expect(container.querySelector(".pb-quality")?.textContent).toBe("HD");

    // Transport buttons
    const transportBtns = container.querySelectorAll(".vod-btn");
    expect(transportBtns.length).toBe(7);
    expect(transportBtns[6].textContent).toBe("Settings");
    expect(transportBtns[2].textContent).toContain("Pause");
    expect(transportBtns[2].classList.contains("focused")).toBe(true);

    // Color pills
    const pills = container.querySelectorAll(".pb-pill");
    expect(pills.length).toBe(4);
    expect(pills[0].textContent).toContain("Audio:");
    expect(pills[1].textContent).toContain("Subtitles:");
    expect(pills[2].textContent).toContain("Aspect:");
    expect(pills[3].textContent).toContain("Play from start");
  });

  test("renders series episode badge, resolution icon badge, and series label on pill 4", () => {
    const { container } = render(
      <VodPlaybackBanner
        target={seriesTarget}
        elapsed={60}
        duration={3000}
        quality="4K"
        episodeInfo={{
          seriesTitle: "Breaking Bad",
          seasonNum: 1,
          episodeNum: 1,
          episodeTitle: "Pilot",
        }}
      />,
    );

    expect(container.querySelector(".pb-title")?.textContent).toBe("Breaking Bad");
    expect(container.querySelector(".vod-episode-badge")?.textContent).toBe("S01E01 · Pilot");
    const qualityBadge = container.querySelector(".pb-quality");
    expect(qualityBadge?.textContent).toBe("4K");
    expect(qualityBadge?.querySelector(".pb-quality-icon")).toBeTruthy();
    const pills = container.querySelectorAll(".pb-pill");
    expect(pills[3].textContent).toContain("Series");
  });
});

describe("VOD OSD Navigation & Transport Remote Keys (TICKET-806 & TICKET-807)", () => {
  test("Up/Down navigates rows and Left/Right moves within transport row", async () => {
    await startMovie();

    // Summon OSD with Up
    press(KEY.UP);
    await settle(50);
    expect(document.querySelector(".pb-stack.vod-stack")).toBeTruthy();

    // Default focus is on transport row button 2 (Play/Pause)
    const playBtn = document.querySelectorAll(".vod-btn")[2];
    expect(playBtn?.classList.contains("focused")).toBe(true);

    // Move Right to Forward 10s button
    press(KEY.RIGHT);
    await settle(50);
    const forwardBtn = document.querySelectorAll(".vod-btn")[3] as HTMLButtonElement;
    expect(forwardBtn?.classList.contains("focused")).toBe(true);

    // Press OK on Forward 10s button -> seeks exactly 10s (never 20s)
    forwardBtn.focus();
    press(KEY.ENTER);
    await settle(50);
    expect(seekChanges).toEqual([10]);

    // Move Down to Pills row
    press(KEY.DOWN);
    await settle(50);
    const audioPill = document.querySelectorAll(".pb-pill")[0];
    expect(audioPill?.classList.contains("focused")).toBe(true);

    // Move Up back to Transport row
    press(KEY.UP);
    await settle(50);
    expect(document.querySelectorAll(".vod-btn")[2]?.classList.contains("focused")).toBe(true);

    // Move Up to Scrubber row: scrubbing previews without seeking until OK commits
    press(KEY.UP);
    await settle(50);
    expect(document.querySelector(".scrub-container.focused")).toBeTruthy();

    press(KEY.RIGHT);
    await settle(50);
    expect(document.querySelector(".seek-preview")).toBeTruthy();
    expect(seekChanges).toEqual([10]);

    // Return cancels preview without seeking
    press(KEY.BACK);
    await settle(50);
    expect(document.querySelector(".seek-preview")).toBeNull();
    expect(seekChanges).toEqual([10]);

    // Scrub again and confirm with OK to seek (smooth fine step: +2s, target 2s)
    press(KEY.RIGHT);
    await settle(50);
    press(KEY.ENTER);
    await settle(50);
    expect(seekChanges).toEqual([10, 2]);
  });

  test("Direct remote color buttons switch audio, subtitle, and aspect", async () => {
    await startMovie();

    // Summon OSD first
    press(KEY.UP);
    await settle(50);
    expect(document.querySelector(".pb-stack")).toBeTruthy();

    // Press Yellow -> cycles Aspect ratio
    press(KEY.YELLOW);
    await settle(50);
    expect(document.querySelector(".pb-stack")).toBeTruthy();

    // Press Red -> switches Audio track
    press(KEY.RED);
    await settle(50);
    expect(document.querySelector(".pb-stack")).toBeTruthy();

    // Press Green -> switches Subtitle track
    press(KEY.GREEN);
    await settle(50);
    expect(document.querySelector(".pb-stack")).toBeTruthy();
  });
});
