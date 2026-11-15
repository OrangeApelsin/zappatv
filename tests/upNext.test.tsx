import { afterEach, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { UpNextPrompt } from "../src/components/UpNextPrompt";
import { getUpNextSeconds, UP_NEXT_DURATIONS } from "../src/stores/settings";
import { KEY } from "../src/hooks/useRemote";
import {
  mountApp,
  played,
  press,
  setPlaybackTime,
  settle,
  XTREAM_SOURCE,
} from "./support/app";

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test("UpNextPrompt renders next episode details and triggers actions", () => {
  const onPlayNow = vi.fn();
  const onCancel = vi.fn();

  render(
    <UpNextPrompt
      title="The Great Escape"
      season={2}
      episode={4}
      seconds={10}
      onPlayNow={onPlayNow}
      onCancel={onCancel}
    />,
  );

  expect(screen.getByText("S2 E4")).toBeDefined();
  expect(screen.getByText("The Great Escape")).toBeDefined();
  expect(screen.getByText(/10s/)).toBeDefined();

  const playBtn = screen.getByRole("button", { name: /Play Now/i });
  fireEvent.click(playBtn);
  expect(onPlayNow).toHaveBeenCalledTimes(1);

  const cancelBtn = screen.getByRole("button", { name: /Cancel/i });
  fireEvent.click(cancelBtn);
  expect(onCancel).toHaveBeenCalledTimes(1);
});

test("TICKET-2308: Minimalist Up Next card renders #upNextCard, #playNowBtn with SVG circular progress ring, #cancelNextBtn, and handles D-pad focus", () => {
  const onPlayNow = vi.fn();
  const onCancel = vi.fn();

  const { container } = render(
    <UpNextPrompt
      title="The Final Countdown"
      season={3}
      episode={8}
      thumbnail="http://example.com/ep8.jpg"
      seconds={10}
      onPlayNow={onPlayNow}
      onCancel={onCancel}
    />,
  );

  // 1. Structural inspection: #upNextCard, #playNowBtn, #cancelNextBtn
  const card = container.querySelector("#upNextCard");
  expect(card).toBeTruthy();
  expect(card?.getAttribute("role")).toBe("dialog");

  const playBtn = container.querySelector("#playNowBtn") as HTMLButtonElement | null;
  expect(playBtn).toBeTruthy();
  expect(playBtn?.querySelector(".up-next-thumb-img")?.getAttribute("src")).toBe("http://example.com/ep8.jpg");

  const scrim = playBtn?.querySelector(".up-next-scrim");
  expect(scrim).toBeTruthy();

  const svg = scrim?.querySelector("svg.up-next-ring");
  expect(svg).toBeTruthy();
  expect(svg?.getAttribute("viewBox")).toBe("0 0 56 56");

  const circles = svg?.querySelectorAll("circle");
  expect(circles?.length).toBe(2);
  const [track, progress] = Array.from(circles ?? []);
  expect(track?.getAttribute("cx")).toBe("28");
  expect(track?.getAttribute("cy")).toBe("28");
  expect(track?.getAttribute("r")).toBe("24");
  expect(progress?.getAttribute("cx")).toBe("28");
  expect(progress?.getAttribute("r")).toBe("24");

  const secondsSpan = scrim?.querySelector(".up-next-seconds");
  expect(secondsSpan?.textContent).toBe("10s");

  const eyebrow = card?.querySelector(".up-next-eyebrow");
  expect(eyebrow?.textContent?.toUpperCase()).toContain("UP NEXT");

  const epMeta = card?.querySelector(".up-next-ep-meta");
  expect(epMeta?.textContent).toBe("S3 E8");

  const videoTitle = card?.querySelector(".up-next-video-title");
  expect(videoTitle?.textContent).toBe("The Final Countdown");

  const cancelBtn = container.querySelector("#cancelNextBtn") as HTMLButtonElement | null;
  expect(cancelBtn).toBeTruthy();

  // 2. D-pad navigation: starts on playBtn, Right moves to cancelBtn, Enter triggers onCancel
  expect(playBtn?.classList.contains("focused")).toBe(true);
  expect(cancelBtn?.classList.contains("focused")).toBe(false);

  press(KEY.RIGHT);
  expect(playBtn?.classList.contains("focused")).toBe(false);
  expect(cancelBtn?.classList.contains("focused")).toBe(true);

  press(KEY.ENTER);
  expect(onCancel).toHaveBeenCalledTimes(1);
  expect(onPlayNow).not.toHaveBeenCalled();

  // Move back left to playBtn and press Enter to trigger onPlayNow
  press(KEY.LEFT);
  expect(playBtn?.classList.contains("focused")).toBe(true);
  press(KEY.ENTER);
  expect(onPlayNow).toHaveBeenCalledTimes(1);

  // Press Return to cancel
  press(KEY.BACK);
  expect(onCancel).toHaveBeenCalledTimes(2);
});


test("UP_NEXT_DURATIONS contains (off, 10s, 15s, 20s, 30s) and getUpNextSeconds maps correctly", () => {
  expect(UP_NEXT_DURATIONS.map((d) => d.id)).toEqual([
    "off",
    "10s",
    "15s",
    "20s",
    "30s",
  ]);

  expect(getUpNextSeconds("off")).toBe(0);
  expect(getUpNextSeconds("10s")).toBe(10);
  expect(getUpNextSeconds("15s")).toBe(15);
  expect(getUpNextSeconds("20s")).toBe(20);
  expect(getUpNextSeconds("30s")).toBe(30);
});

function seriesFetch() {
  return vi.fn(async (input: string | URL) => {
    const url = new URL(String(input));
    const action = url.searchParams.get("action") ?? "authenticate";
    const bodies: Record<string, unknown> = {
      authenticate: {
        user_info: { auth: 1, status: "Active" },
        server_info: { server_protocol: "http", url: "provider.example" },
      },
      get_live_categories: [{ category_id: "1", category_name: "Live" }],
      get_vod_categories: [],
      get_series_categories: [{ category_id: "20", category_name: "Drama" }],
      get_live_streams: [{ stream_id: "1", category_id: "1", name: "Live One" }],
      get_vod_streams: [],
      get_series: [
        {
          series_id: "10",
          category_id: "20",
          name: "Sample Series",
          cover: "",
        },
      ],
      get_series_info: {
        info: { name: "Sample Series", category_id: "20" },
        episodes: {
          "1": [
            { id: "201", episode_num: 1, title: "Pilot, exactly", container_extension: "mp4" },
            { id: "202", episode_num: 2, title: "Second episode", container_extension: "mp4" },
          ],
        },
      },
    };
    return { ok: true, status: 200, json: async () => bodies[action] };
  });
}

async function startSeriesEpisode() {
  await mountApp("", {
    source: XTREAM_SOURCE,
    fetchImplementation: seriesFetch(),
  });
  setPlaybackTime(0, 100);

  fireEvent.click(screen.getByRole("button", { name: "Series" }));
  await act(async () => Promise.resolve());
  await settle(100);

  const cat = screen.getAllByText("Drama").find((item) => item.closest("button"));
  fireEvent.click(cat!.closest("button")!);
  await act(async () => Promise.resolve());
  await settle(100);

  const seriesBtn = screen.getAllByText("Sample Series").find((item) => item.closest("button"));
  fireEvent.click(seriesBtn!.closest("button")!);
  await act(async () => Promise.resolve());
  await settle(100);

  const seasonBtn = screen.getAllByText("Season 1").find((item) => item.closest("button"));
  fireEvent.click(seasonBtn!.closest("button")!);
  await act(async () => Promise.resolve());
  await settle(100);

  const epBtn = screen.getAllByText("Pilot, exactly").find((item) => item.closest("button"));
  fireEvent.click(epBtn!.closest("button")!);
  await act(async () => Promise.resolve());
  await settle(100);
}

test("countdown prompt triggers at setting + 1s (11s for 10s default), counts down configured setting, remote keys isolate OSD, Return cancels without exiting", async () => {
  await startSeriesEpisode();

  expect(played[0]).toBe("http://provider.example/series/viewer/secret/201.mp4");
  expect(screen.queryByTestId("up-next-prompt")).toBeNull();

  // Position at 88s remaining (12s remaining of 100s) -> should NOT trigger yet because threshold is 11s (10 + 1)
  act(() => {
    setPlaybackTime(88, 100);
  });
  await settle(50);
  expect(screen.queryByTestId("up-next-prompt")).toBeNull();

  // Position at 89s (11s remaining of 100s) -> triggers countdown prompt at 11s (setting + 1s)!
  // Counter starts counting down from configured setting (10s), leaving 1s remaining when reaching zero.
  act(() => {
    setPlaybackTime(89, 100);
  });
  await settle(1100);
  const prompt = screen.getByTestId("up-next-prompt");
  expect(prompt).toBeDefined();
  expect(within(prompt).getByText("Second episode")).toBeDefined();
  expect(within(prompt).getByText(/10s/)).toBeDefined();

  // Pressing remote keys (Up, Down, Left, Right) must NOT trigger OSD banner
  press(KEY.UP);
  await settle(50);
  expect(document.querySelector(".pb-stack")).toBeNull();

  press(KEY.RIGHT);
  await settle(50);
  expect(document.querySelector(".pb-stack")).toBeNull();

  // Pressing Return (KEY.BACK) must cancel and close prompt without exiting fullscreen playback
  press(KEY.BACK);
  await settle(50);
  expect(screen.queryByTestId("up-next-prompt")).toBeNull();
  // Player remains actively playing Episode 1
  expect(played.length).toBe(1);
  expect(played[0]).toBe("http://provider.example/series/viewer/secret/201.mp4");
});

test("countdown reaches zero or Enter pressed automatically plays next episode", async () => {
  await startSeriesEpisode();

  expect(played.length).toBe(1);

  // Position at 98s (2s remaining of 100s episode -> 1s countdown left until 1s episode remaining)
  act(() => {
    setPlaybackTime(98, 100);
  });
  await settle(1100);
  expect(screen.getByTestId("up-next-prompt")).toBeDefined();
  expect(within(screen.getByTestId("up-next-prompt")).getByText(/1s/)).toBeDefined();

  // Pressing Enter (OK) immediately plays next episode
  press(KEY.ENTER);
  await settle(100);

  expect(played.length).toBe(2);
  expect(played[1]).toBe("http://provider.example/series/viewer/secret/202.mp4");
  expect(screen.queryByTestId("up-next-prompt")).toBeNull();
});

test("countdown reaches zero automatically plays next episode without user interaction leaving 1s of current episode", async () => {
  await startSeriesEpisode();

  expect(played.length).toBe(1);

  // Position at 98s (2s remaining of episode -> counter shows 1s)
  act(() => {
    setPlaybackTime(98, 100);
  });
  await settle(1100);
  expect(screen.getByTestId("up-next-prompt")).toBeDefined();
  expect(within(screen.getByTestId("up-next-prompt")).getByText(/1s/)).toBeDefined();

  // Advance timer by 1s so countdown reaches 0 -> triggers auto-play with 1s of current episode remaining
  await settle(1100);

  expect(played.length).toBe(2);
  expect(played[1]).toBe("http://provider.example/series/viewer/secret/202.mp4");
  expect(screen.queryByTestId("up-next-prompt")).toBeNull();
});

test("near-end threshold with <= 1s remaining automatically initiates next episode immediately", async () => {
  await startSeriesEpisode();

  expect(played.length).toBe(1);

  // Position at 99s (1s remaining of 100s episode -> 0s countdown)
  act(() => {
    setPlaybackTime(99, 100);
  });
  await settle(1100);

  // Automatically initiates next episode without blocking
  expect(played.length).toBe(2);
  expect(played[1]).toBe("http://provider.example/series/viewer/secret/202.mp4");
  expect(screen.queryByTestId("up-next-prompt")).toBeNull();
});

test("cross-season next episode resolution", async () => {
  const multiSeasonFetch = vi.fn(async (input: string | URL) => {
    const url = new URL(String(input));
    const action = url.searchParams.get("action") ?? "authenticate";
    const bodies: Record<string, unknown> = {
      authenticate: {
        user_info: { auth: 1, status: "Active" },
        server_info: { server_protocol: "http", url: "provider.example" },
      },
      get_live_categories: [{ category_id: "1", category_name: "Live" }],
      get_vod_categories: [],
      get_series_categories: [{ category_id: "20", category_name: "Drama" }],
      get_live_streams: [{ stream_id: "1", category_id: "1", name: "Live One" }],
      get_vod_streams: [],
      get_series: [
        {
          series_id: "10",
          category_id: "20",
          name: "Multi Season Show",
          cover: "",
        },
      ],
      get_series_info: {
        info: { name: "Multi Season Show", category_id: "20" },
        episodes: {
          "1": [
            { id: "101", episode_num: 1, title: "Season Finale", container_extension: "mp4" },
          ],
          "2": [
            { id: "201", episode_num: 1, title: "Season Premiere", container_extension: "mp4" },
          ],
        },
      },
    };
    return { ok: true, status: 200, json: async () => bodies[action] };
  });

  await mountApp("", {
    source: XTREAM_SOURCE,
    fetchImplementation: multiSeasonFetch,
  });
  setPlaybackTime(0, 100);

  fireEvent.click(screen.getByRole("button", { name: "Series" }));
  await act(async () => Promise.resolve());
  await settle(100);

  const cat = screen.getAllByText("Drama").find((item) => item.closest("button"));
  fireEvent.click(cat!.closest("button")!);
  await act(async () => Promise.resolve());
  await settle(100);

  const seriesBtn = screen.getAllByText("Multi Season Show").find((item) => item.closest("button"));
  fireEvent.click(seriesBtn!.closest("button")!);
  await act(async () => Promise.resolve());
  await settle(100);

  const seasonBtn = screen.getAllByText("Season 1").find((item) => item.closest("button"));
  fireEvent.click(seasonBtn!.closest("button")!);
  await act(async () => Promise.resolve());
  await settle(100);

  const epBtn = screen.getAllByText("Season Finale").find((item) => item.closest("button"));
  fireEvent.click(epBtn!.closest("button")!);
  await act(async () => Promise.resolve());
  await settle(100);

  expect(played[0]).toBe("http://provider.example/series/viewer/secret/101.mp4");

  // Near end of S1 Finale -> up next prompt shows S2 Premiere
  act(() => {
    setPlaybackTime(95, 100);
  });
  await settle(1100);

  const prompt = screen.getByTestId("up-next-prompt");
  expect(prompt).toBeDefined();
  expect(within(prompt).getByText("Season Premiere")).toBeDefined();
  expect(within(prompt).getByText("S2 E1")).toBeDefined();

  // Enter plays S2 E1
  press(KEY.ENTER);
  await settle(100);

  expect(played.length).toBe(2);
  expect(played[1]).toBe("http://provider.example/series/viewer/secret/201.mp4");
});

test("TICKET-2402: UpNextPrompt corner card renders compact structure and truncated title", () => {
  const onPlayNow = vi.fn();
  const onCancel = vi.fn();

  const { container } = render(
    <UpNextPrompt
      title="Very Long Episode Title That Exceeds Normal Card Boundaries And Must Be Clamped"
      season={1}
      episode={5}
      seconds={15}
      onPlayNow={onPlayNow}
      onCancel={onCancel}
    />,
  );

  const card = container.querySelector("#upNextCard");
  expect(card).toBeTruthy();
  const title = container.querySelector(".up-next-video-title");
  expect(title?.textContent).toContain("Very Long Episode Title");

  const cancelBtn = container.querySelector("#cancelNextBtn");
  expect(cancelBtn).toBeTruthy();

  const ring = container.querySelector(".up-next-ring");
  expect(ring?.getAttribute("width")).toBe("44");
  expect(ring?.getAttribute("height")).toBe("44");
});
