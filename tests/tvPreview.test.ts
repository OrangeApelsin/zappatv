import { readFileSync } from "node:fs";
import vm from "node:vm";
import { parse } from "acorn";
import { afterEach, expect, test, vi } from "vitest";
import type {} from "../src/services/player";

type AVPlay = NonNullable<NonNullable<Window["webapis"]>["avplay"]>;
type Preview = {
  simulated: boolean;
  fail(code: string): void;
  stall(value: boolean): void;
  complete(): void;
};
const source = readFileSync("scripts/tv/shim.js", "utf8");
afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
  document.getElementById("zappa-preview-style")?.remove();
  document.documentElement.classList.remove("tizen");
});
function boot(existing: Record<string, unknown> = {}) {
  vi.useFakeTimers();
  const network = vi.fn();
  const context = vm.createContext({
    window: { setTimeout, clearTimeout, fetch: network, ...existing },
    document,
    Date,
  });
  vm.runInContext(source, context);
  return {
    av: vm.runInContext("window.webapis && window.webapis.avplay", context) as AVPlay,
    preview: vm.runInContext("window.__ZAPPA_TV_PREVIEW__", context) as Preview | undefined,
    network,
  };
}

test("preview is labelled, ES2015-compatible and never loads media or makes decoder requests", () => {
  expect(() => parse(source, { ecmaVersion: 2015, sourceType: "script" })).not.toThrow();
  const { av, preview, network } = boot();
  expect(preview?.simulated).toBe(true);
  expect(document.getElementById("zappa-preview-notice")?.textContent).toContain(
    "simulated playback",
  );
  const ready = vi.fn();
  av.open("https://example.invalid/movie/1.mp4");
  av.prepareAsync(ready, vi.fn());
  vi.advanceTimersByTime(100);
  av.play();
  expect(ready).toHaveBeenCalledOnce();
  expect(document.querySelector("video")).toBeNull();
  expect(network).not.toHaveBeenCalled();
});

test.each([
  { webapis: { avplay: { native: true } } },
  { tizen: { application: { native: true } } },
])("preview cannot replace real hardware or mask missing AVPlay on a TV", (existing) => {
  const { preview } = boot(existing);
  expect(preview).toBeUndefined();
  expect(document.getElementById("zappa-preview-notice")).toBeNull();
});

test("preview enforces AVPlay ordering and models pause, seek, suspend and a frozen clock", () => {
  const { av, preview } = boot();
  expect(() => av.play()).toThrow("unavailable in NONE");
  av.open("https://example.invalid/movie/1.mp4");
  av.setStreamingProperty!("ADAPTIVE_INFO", "STARTBITRATE=LOWEST");
  av.prepareAsync(vi.fn(), vi.fn());
  vi.advanceTimersByTime(100);
  av.play();
  vi.advanceTimersByTime(2500);
  expect(av.getCurrentTime!()).toBe(2500);
  av.pause!();
  vi.advanceTimersByTime(1000);
  expect(av.getCurrentTime!()).toBe(2500);
  av.seekTo!(10000);
  av.play();
  vi.advanceTimersByTime(1000);
  expect(av.getCurrentTime!()).toBe(11000);
  preview!.stall(true);
  vi.advanceTimersByTime(12000);
  expect(av.getCurrentTime!()).toBe(11000);
  preview!.stall(false);
  av.suspend!();
  vi.advanceTimersByTime(1000);
  expect(av.getCurrentTime!()).toBe(11000);
  av.restore!();
  vi.advanceTimersByTime(1000);
  expect(av.getCurrentTime!()).toBe(12000);
});

test("preview cancels an abandoned prepare and exposes failure/completion paths", () => {
  const { av, preview } = boot();
  const stale = vi.fn();
  const current = vi.fn();
  const error = vi.fn();
  const ended = vi.fn();
  av.setListener({ onerror: error, onstreamcompleted: ended });
  av.open("https://example.invalid/a.m3u8");
  av.prepareAsync(stale, vi.fn());
  av.open("https://example.invalid/movie/1.mp4");
  av.prepareAsync(current, vi.fn());
  vi.advanceTimersByTime(100);
  expect(stale).not.toHaveBeenCalled();
  expect(current).toHaveBeenCalledOnce();
  av.play();
  preview!.complete();
  expect(ended).toHaveBeenCalledOnce();
  preview!.fail("PLAYER_ERROR_CONNECTION_FAILED");
  expect(error).toHaveBeenCalledWith("PLAYER_ERROR_CONNECTION_FAILED");
  av.close();
  expect(vi.getTimerCount()).toBe(0);
});
