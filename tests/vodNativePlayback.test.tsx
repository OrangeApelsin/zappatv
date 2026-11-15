import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { KEY } from "../src/hooks/useRemote";
import { mountApp, press, settle, XTREAM_SOURCE } from "./support/app";
import { vodProvider } from "./support/vodProvider";

// Real Player + tuner + App. AVPlay state transitions follow Samsung's documented
// API states; this verifies the native handoff, not codecs/provider/TV decoding.
function nativeApi(failVOD = false) {
  let state = "NONE";
  let time = 0;
  const urls: string[] = [];
  const calls: string[] = [];
  let listener: { onerror?: (code: string) => void } | null = null;
  const av = {
    urls,
    calls,
    getState: () => state,
    open: (url: string) => {
      expect(["NONE", "IDLE"]).toContain(state);
      urls.push(url);
      state = "IDLE";
      calls.push("open");
    },
    stop: () => {
      const previous = listener;
      if (state === "PLAYING" && /\/live\//.test(urls[urls.length - 1]))
        setTimeout(() => previous?.onerror?.("PLAYER_ERROR_INVALID_OPERATION"), 1);
      state = "IDLE";
      calls.push("stop");
    },
    close: () => {
      state = "NONE";
      calls.push("close");
    },
    setDisplayRect: vi.fn(),
    setDisplayMethod: vi.fn(),
    setStreamingProperty: () => {
      expect(state).toBe("IDLE");
      if (/\.(mp4|mkv)$/.test(urls[urls.length - 1]))
        throw new DOMException(
          "Adaptive properties unsupported for this engine",
          "NotSupportedError",
        );
    },
    setBufferingParam: () => {
      expect(state).toBe("IDLE");
    },
    setTimeoutForBuffering: vi.fn(),
    setListener: (next: typeof listener) => {
      listener = next;
    },
    prepareAsync: (ok: () => void, fail: (error: unknown) => void) => {
      expect(state).toBe("IDLE");
      calls.push("prepare");
      setTimeout(() => {
        if (failVOD && !/\/live\//.test(urls[urls.length - 1])) {
          fail({ name: "PLAYER_ERROR_INVALID_PARAMETER" });
          return;
        }
        state = "READY";
        ok();
      }, 10);
    },
    play: () => {
      expect(["READY", "PAUSED"]).toContain(state);
      state = "PLAYING";
      calls.push("play");
    },
    pause: () => {
      state = "PAUSED";
    },
    getCurrentTime: () => time,
    getDuration: () => 3600000,
    getTotalTrackInfo: () => [],
    getCurrentStreamInfo: () => [],
    seekTo: (ms: number, ok?: () => void) => {
      time = ms;
      ok?.();
    },
  };
  return av;
}
async function row(label: string) {
  const tile = [...document.querySelectorAll<HTMLButtonElement>(".vod-tile")].find(
    (item) => item.getAttribute("aria-label") === label,
  );
  if (tile) {
    fireEvent.click(tile);
    await settle(100);
    return;
  }
  const el = screen.getAllByText(label).find((item) => item.closest("button"));
  expect(el).toBeTruthy();
  fireEvent.click(el!.closest("button")!);
  await settle(100);
}
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.getElementById("avplay-surface")?.remove();
});

async function startNative(
  av: ReturnType<typeof nativeApi>,
  grid: boolean,
  kind: string,
  resume: boolean,
) {
  vi.stubGlobal("webapis", { avplay: av });
  localStorage.setItem("zappa.viewMode", grid ? "grid" : "panel");
  await mountApp("", {
    source: XTREAM_SOURCE,
    fetchImplementation: vodProvider(),
    nativePlayer: true,
  });
  await row("TV4");
  expect(av.getState()).toBe("PLAYING");
  if (grid) {
    press(KEY.BACK);
    press(KEY.BACK);
    await settle(100);
    fireEvent.click(
      document.querySelector(kind === "movie" ? ".tile-movies" : ".tile-series")!,
    );
  } else {
    press(KEY.LEFT);
    await settle(100);
    fireEvent.click(
      screen.getAllByRole("button", { name: kind === "movie" ? "Movies" : "Series" }).at(-1)!,
    );
  }
  await settle(100);
  if (!grid) await row(kind === "movie" ? "Cinema" : "Shows");
  await row(kind === "movie" ? "Film A" : "Show B");
  const { useLibrary } = await import("../src/stores/library");
  const item =
    kind === "movie"
      ? Object.values(useLibrary.getState().movieDetails)[0]?.value
      : Object.values(useLibrary.getState().seriesDetails)[0]?.value?.episodes[0];
  expect(item).toBeTruthy();
  if (resume) {
    const { usePersonal } = await import("../src/stores/personal");
    usePersonal.getState().rememberProgress(item!.key, 40, 3600, true);
    await settle(20);
  }
  if (kind === "movie") fireEvent.click(screen.getAllByRole("button", { name: /^(Play|Resume)/ })[0]);
  else if (grid) {
    fireEvent.click(document.querySelector(".sr-ep")!);
    await settle(50);
    const modalBtn = document.querySelector("#view-episode-details button");
    if (modalBtn) fireEvent.click(modalBtn);
  }
  else {
    await row("Season 0");
    await row("Pilot");
  }
  await settle(100);
}

test.each(
  [true, false].flatMap((grid) =>
    ["movie", "episode"].flatMap((kind) =>
      [false, true].map((resume) => ({ grid, kind, resume })),
    ),
  ),
)(
  "real native $kind reaches PLAYING from grid=$grid resume=$resume",
  async ({ grid, kind, resume }) => {
    const av = nativeApi();
    await startNative(av, grid, kind, resume);
    expect(av.urls.at(-1)).toBe(
      `http://provider.example/${kind === "movie" ? "movie/viewer/secret/100" : "series/viewer/secret/201"}.mkv`,
    );
    if (resume) expect(av.getCurrentTime()).toBe(40000);
    expect(av.getState()).toBe("PLAYING");
    expect(document.querySelector(".picture-state.failed")).toBeNull();
  },
);

test.each([13, 10009])(
  "finite native failure shows its safe cause and Go back works with key %s",
  async (key) => {
    const av = nativeApi(true);
    await startNative(av, true, "movie", false);
    await settle(600);
    expect(document.querySelector(".picture-state.failed")).toBeTruthy();
    expect(document.querySelector(".picture-state-code")?.textContent).toBe(
      "prepare/IDLE: PLAYER_ERROR_INVALID_PARAMETER",
    );
    press(key);
    await settle(100);
    expect(document.querySelector(".picture-state.failed")).toBeNull();
    expect(document.querySelector("#view-vod")).toBeTruthy();
    expect(document.querySelector(".vod-tile.focused")).toBeTruthy();
    expect(av.getState()).toBe("NONE");
  },
);
