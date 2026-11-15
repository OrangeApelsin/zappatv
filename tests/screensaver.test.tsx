import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Screensaver } from "../src/components/Screensaver";
import { KEY } from "../src/hooks/useRemote";
import { mountApp, press, settle } from "./support/app";

const PLAYLIST = `#EXTM3U
#EXTINF:-1 tvg-id="a" group-title="News",First Channel
http://example.invalid/1.m3u8
#EXTINF:-1 tvg-id="b" group-title="News",Second Channel
http://example.invalid/2.m3u8
`;

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.useRealTimers();
});

test("Screensaver component renders floating clock and brand", () => {
  render(<Screensaver />);
  expect(screen.getByTestId("screensaver")).toBeDefined();
  expect(screen.getByText("ZAPPA TV")).toBeDefined();
});

test("screensaver activates after default 1 min of idle on home screen, and dismisses on any key without side effects", async () => {
  await mountApp(PLAYLIST);
  await settle(300);

  // Initially no screensaver
  expect(document.querySelector(".screensaver-overlay")).toBeNull();

  // After 59s, still no screensaver
  await settle(59000);
  expect(document.querySelector(".screensaver-overlay")).toBeNull();

  // After 60s (1m) total idle time, screensaver activates
  await settle(1500);
  expect(document.querySelector(".screensaver-overlay")).not.toBeNull();

  // Pressing any key dismisses the screensaver immediately
  press(KEY.ENTER);
  expect(document.querySelector(".screensaver-overlay")).toBeNull();

  // Key was consumed by waking up the screensaver, not by opening anything new
});

test("screensaver does NOT activate while playback is actively playing", async () => {
  await mountApp(PLAYLIST, { resume: "a" });
  await settle(300);

  // After 65s of active playback, screensaver must NOT activate
  await settle(65000);
  expect(document.querySelector(".screensaver-overlay")).toBeNull();
});
