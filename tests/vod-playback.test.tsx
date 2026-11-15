import { afterEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { KEY } from "../src/hooks/useRemote";
import {
  mountApp,
  panelOpen,
  playCalls,
  played,
  playerLifecycle,
  press,
  seekChanges,
  setPlaybackTime,
  settle,
  XTREAM_SOURCE,
} from "./support/app";

const categories = {
  movie: [{ category_id: "10", category_name: "Cinema, exactly" }],
};

const movie = (id: number, name = `Movie ${id}`) => ({
  stream_id: String(id),
  category_id: "10",
  name,
  container_extension: "mp4",
});

function libraryFetch() {
  return vi.fn(async (input: string | URL) => {
    const url = new URL(String(input));
    const action = url.searchParams.get("action") ?? "authenticate";
    const bodies: Record<string, unknown> = {
      authenticate: {
        user_info: { auth: 1, status: "Active" },
        server_info: { server_protocol: "http", url: "provider.example" },
      },
      get_live_categories: [{ category_id: "1", category_name: "Live" }],
      get_vod_categories: categories.movie,
      get_series_categories: [],
      get_live_streams: [{ stream_id: "1", category_id: "1", name: "Live One" }],
      get_vod_streams: [movie(100, "Film, exactly")],
      get_vod_info: {
        info: { name: "Film, exactly", plot: "A provider supplied plot" },
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
  setPlaybackTime(120, 3600);
  fireEvent.click(screen.getByRole("button", { name: "Movies" }));
  await act(async () => Promise.resolve());
  await settle(100);

  const cat = screen.getAllByText("Cinema, exactly").find((item) => item.closest("button"));
  fireEvent.click(cat!.closest("button")!);
  await act(async () => Promise.resolve());
  await settle(100);

  const row = screen.getAllByText("Film, exactly").find((item) => item.closest("button"));
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

describe("VOD Playback State Machine & Remote Key Laws (TICKET-805)", () => {
  test("movie starts in finite mode and OK toggles play/pause", async () => {
    await startMovie();

    expect(panelOpen()).toBe(false);
    expect(played[0]).toBe("http://provider.example/movie/viewer/secret/100.mp4");
    expect(playCalls[0].slice(1)).toEqual([undefined, "finite", undefined]);

    // Press OK (ENTER) at bare finite playback -> pauses
    press(KEY.ENTER);
    await settle(50);
    expect(
      document.querySelector(".picture-state.paused") ||
        document.body.textContent?.includes("Paused"),
    ).toBeTruthy();

    // Press OK again -> resumes
    press(KEY.ENTER);
    await settle(50);
    expect(document.querySelector(".picture-state.paused")).toBeNull();
  });

  test("Up and Down summon VOD OSD without changing channels", async () => {
    await startMovie();

    // Up summons OSD
    press(KEY.UP);
    await settle(50);
    expect(document.querySelector(".pb-stack")).toBeTruthy();

    // Verify channel did not change
    expect(played.length).toBe(1);
    expect(played[0]).toBe("http://provider.example/movie/viewer/secret/100.mp4");

    // Down also keeps OSD open and does not change channel
    press(KEY.DOWN);
    await settle(50);
    expect(document.querySelector(".pb-stack")).toBeTruthy();
    expect(played.length).toBe(1);
  });

  test("BACK keeps VOD playing in background when returning to grid, while OSD Stop stops playback", async () => {
    await startMovie();

    // 1. Open OSD
    press(KEY.UP);
    await settle(50);
    expect(document.querySelector(".pb-stack")).toBeTruthy();

    // 2. BACK dismisses OSD
    press(KEY.BACK);
    await settle(50);
    expect(document.querySelector(".pb-stack")?.classList.contains("fade-out") ?? true).toBe(
      true,
    );
    expect(document.querySelector(".dialog")).toBeNull();

    // 3. BACK at bare picture returns to catalog (never stops playback or opens exit dialog)
    press(KEY.BACK);
    await settle(50);
    expect(document.querySelector(".dialog")).toBeNull();
    expect(playerLifecycle.includes("stop")).toBe(false);
    const resumeBtn = document.querySelector("[data-header-control='nowPlaying']");
    expect(resumeBtn).toBeTruthy();
    const saved = JSON.parse(localStorage.getItem("openiptv.personal") ?? "{}");
    expect(saved.progress?.length).toBeGreaterThan(0);

    // 3b (TICKET-2172): In list view, first BACK closes detail frame to catalogue list;
    // subsequent BACK transitions cleanly to Home screen with background playback active
    press(KEY.BACK);
    await settle(50);
    press(KEY.BACK);
    await settle(50);
    expect(document.querySelector(".home-now-playing")).toBeTruthy();
    expect(playerLifecycle.includes("stop")).toBe(false);

    // Resuming from Home screen Now Playing card returns to fullscreen playback
    fireEvent.click(document.querySelector(".home-now-playing")!);
    await settle(50);
    expect(document.querySelector(".panel")?.classList.contains("away")).toBe(true);

    // 4. Return to grid via BACK, resume fullscreen from top toolbar Now Playing button, then stop via OSD Stop button
    press(KEY.BACK);
    await settle(50);
    const toolbarResumeBtn = document.querySelector("[data-header-control='nowPlaying']");
    expect(toolbarResumeBtn).toBeTruthy();
    fireEvent.click(toolbarResumeBtn!);
    await settle(50);
    expect(document.querySelector(".panel")?.classList.contains("away")).toBe(true);

    press(KEY.UP);
    await settle(50);
    const stopBtn = [...document.querySelectorAll(".vod-btn")][5];
    fireEvent.click(stopBtn);
    await settle(50);
    expect(playerLifecycle.includes("stop")).toBe(true);
    expect(document.querySelector("[data-header-control='nowPlaying']")).toBeNull();
  });

  test("direct Left/Right at bare VOD picture escalates total offset 10s -> 30s -> 1m -> 5m -> 10m and cancels on BACK (TICKET-2191)", async () => {
    await startMovie();

    // Rapid 3x Right presses set total offset +60s (1m), not cumulative
    press(KEY.RIGHT);
    press(KEY.RIGHT);
    press(KEY.RIGHT);
    await settle(50);
    expect(seekChanges).toEqual([]);
    expect(document.querySelector(".vod-pb")).toBeNull();
    expect(document.querySelector(".scrub-track")).toBeNull();
    expect(document.querySelector(".direct-seek-chip")).toBeTruthy();
    expect(document.querySelector(".seek-target")?.textContent).toBe("3:00");
    expect(document.querySelector(".seek-delta")?.textContent).toBe("+1:00");

    // Settle delay fires exact +60s seek once and chip dismisses without raising OSD
    await settle(650);
    expect(seekChanges).toEqual([60]);
    expect(document.querySelector(".direct-seek-chip")).toBeNull();
    expect(document.querySelector(".vod-pb")).toBeNull();

    // 5x Left presses escalate to 10m (-600s, clamped at 0:00 from 3:00), then BACK cancels before settle
    press(KEY.LEFT);
    press(KEY.LEFT);
    press(KEY.LEFT);
    press(KEY.LEFT);
    press(KEY.LEFT);
    expect(document.querySelector(".seek-delta")?.textContent).toBe("-3:00");
    press(KEY.BACK);
    await settle(700);
    expect(seekChanges).toEqual([60]);
  });

  test("OSD skip 10s button seeks exactly 10s (never 20s) and Stop button is labeled Stop (TICKET-2191)", async () => {
    await startMovie();

    // Summon OSD with Up
    press(KEY.UP);
    await settle(50);
    expect(document.querySelector(".pb-stack")).toBeTruthy();

    // Transport buttons: index 2 is playPause, index 3 is forward 10s, index 5 is stop
    const stopBtn = [...document.querySelectorAll(".vod-btn")][5];
    expect(stopBtn?.textContent).toContain("Stop");
    expect(stopBtn?.classList.contains("vod-btn-stop")).toBe(true);

    // Move to forward 10s button
    press(KEY.RIGHT);
    await settle(50);
    const forwardBtn = document.querySelectorAll(".vod-btn")[3];
    expect(forwardBtn?.classList.contains("focused")).toBe(true);

    // Press OK (ENTER) -> seeks exactly +10s (never 20s)
    press(KEY.ENTER);
    await settle(50);
    expect(seekChanges).toEqual([10]);
  });

  test("OSD Previous button restarts episode/movie when playtime > 60s (TICKET-2195)", async () => {
    await startMovie();

    // Summon OSD with Up
    press(KEY.UP);
    await settle(50);

    // Playtime is 120s (> 60s). Move to index 0 (Previous/Restart)
    press(KEY.LEFT);
    press(KEY.LEFT);
    await settle(50);
    const prevBtn = document.querySelectorAll(".vod-btn")[0];
    expect(prevBtn?.classList.contains("focused")).toBe(true);

    // Press OK (ENTER) -> seeks to 0:00 (restart: from position 120 to 0 = -120s)
    press(KEY.ENTER);
    await settle(50);
    expect(seekChanges).toContain(-120);
  });
});
