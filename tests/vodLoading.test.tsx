import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { KEY } from "../src/hooks/useRemote";
import { mountApp, played, playerLifecycle, press, settle, XTREAM_SOURCE } from "./support/app";
import { vodProvider } from "./support/vodProvider";

function gate() {
  let release!: () => void;
  const task = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { task, release };
}
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
async function setup() {
  const movies = gate(),
    series = gate();
  const provider = vodProvider();
  const fetcher = vi.fn(async (input: string | URL, _init?: RequestInit) => {
    const response = await provider(input);
    const action = new URL(String(input)).searchParams.get("action");
    if (action === "get_vod_streams") await movies.task;
    if (action === "get_series") await series.task;
    return response;
  });
  localStorage.setItem("zappa.viewMode", "grid");
  await mountApp("", { source: XTREAM_SOURCE, fetchImplementation: fetcher });
  fireEvent.click(
    screen
      .getAllByText("TV4")
      .find((el) => el.closest("button"))!
      .closest("button")!,
  );
  await settle(100);
  await home();
  fireEvent.click(document.querySelector(".tile-movies")!);
  await settle(100);
  return { movies, series, fetcher };
}
async function home() {
  for (let index = 0; index < 2 && !document.querySelector(".tile-movies"); index++) {
    press(KEY.BACK);
    await settle(50);
  }
  expect(document.querySelector(".tile-movies")).toBeTruthy();
}
const phase = () => document.querySelector(".vod-load")?.getAttribute("data-load-phase");

test("waiting catalogue shows categories and Back detaches immediately; reopening joins the one load", async () => {
  const { movies, series, fetcher } = await setup();
  const starts = played.length,
    events = playerLifecycle.length;
  expect(phase()).toBe("request");
  expect(screen.getByText("Waiting for titles")).toBeTruthy();
  const category = [...document.querySelectorAll(".vod-cat")].find((el) =>
    el.textContent?.includes("Cinema"),
  );
  expect(category).toBeTruthy();
  expect(category!.querySelector(".vod-cat-count")?.textContent).toBe("…");
  expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBeNull();
  press(KEY.BACK);
  await settle(50);
  expect(document.querySelector("#view-vod")).toBeNull();
  expect(played).toHaveLength(starts);
  expect(playerLifecycle).toHaveLength(events);
  const request = fetcher.mock.calls.find(
    ([input]) => new URL(String(input)).searchParams.get("action") === "get_vod_streams",
  )!;
  expect(request[1]?.signal?.aborted).toBe(false);
  await home();
  fireEvent.click(document.querySelector(".tile-movies")!);
  await settle(50);
  expect(phase()).toBe("request");
  expect(
    fetcher.mock.calls.filter(
      ([input]) => new URL(String(input)).searchParams.get("action") === "get_vod_streams",
    ),
  ).toHaveLength(1);
  fireEvent.click(document.querySelectorAll(".vod-tab")[1]);
  await settle(100);
  expect(phase()).toBe("request");
  await act(async () => {
    movies.release();
    await vi.advanceTimersByTimeAsync(300);
  });
  const { useLibrary } = await import("../src/stores/library");
  expect(useLibrary.getState().catalogProgress.movie.phase).toBe("ready");
  expect(useLibrary.getState().catalogProgress.series.phase).toBe("request");
  expect(document.querySelector(".vod-tab.active")?.textContent).toBe("Series");
  expect(phase()).toBe("request");
  await act(async () => {
    series.release();
    await vi.advanceTimersByTimeAsync(300);
  });
  expect(document.querySelector(".vod-load")).toBeNull();
  expect(document.querySelectorAll(".vod-tile")).toHaveLength(3);
  expect(played).toHaveLength(starts);
  expect(playerLifecycle).toHaveLength(events);
});

test("a detached load can finish behind Home without reopening the grid or downloading again", async () => {
  const { movies, fetcher } = await setup();
  press(KEY.BACK);
  await settle(50);
  await home();
  await act(async () => {
    movies.release();
    await vi.advanceTimersByTimeAsync(300);
  });
  expect(document.querySelector(".tile-movies")).toBeTruthy();
  expect(document.querySelector("#view-vod")).toBeNull();
  fireEvent.click(document.querySelector(".tile-movies")!);
  await settle(50);
  expect(document.querySelectorAll(".vod-tile")).toHaveLength(3);
  expect(document.querySelector(".vod-load")).toBeNull();
  expect(
    fetcher.mock.calls.filter(
      ([input]) => new URL(String(input)).searchParams.get("action") === "get_vod_streams",
    ),
  ).toHaveLength(1);
});

test("Back also detaches during index construction with posters already visible", async () => {
  const { movies } = await setup();
  const { CatalogIndex } = await import("../src/services/catalogIndex");
  const finish = CatalogIndex.prototype.finish;
  const indexing = gate();
  vi.spyOn(CatalogIndex.prototype, "finish").mockImplementation(
    async function (signal, onProgress) {
      await indexing.task;
      return finish.call(this, signal, onProgress);
    },
  );
  await act(async () => {
    movies.release();
    await vi.advanceTimersByTimeAsync(150);
  });
  expect(phase()).toBe("index");
  expect(document.querySelectorAll(".vod-tile")).toHaveLength(3);
  press(KEY.BACK);
  await settle(50);
  await home();
  await act(async () => {
    indexing.release();
    await vi.advanceTimersByTimeAsync(200);
  });
  expect(document.querySelector(".tile-movies")).toBeTruthy();
  expect(document.querySelector("#view-vod")).toBeNull();
});

test("list layout shares the cold-load stage and keeps its categories reachable", async () => {
  const { movies } = await setup();
  fireEvent.click(document.querySelectorAll(".vod-tab")[2]);
  await settle(100);
  expect(document.querySelector("#view-vod")).toBeNull();
  expect(document.querySelector(".media-state")?.textContent).toContain("Waiting for titles");
  expect(screen.getAllByText("Cinema").length).toBeGreaterThan(0);
  press(KEY.BACK);
  await settle(50);
  await act(async () => {
    movies.release();
    await vi.advanceTimersByTimeAsync(300);
  });
  expect(document.querySelector(".panel")?.classList.contains("away")).toBe(true);
});
