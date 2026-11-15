import { afterEach, beforeEach, expect, test, vi } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { act, cleanup, render, renderHook, screen } from "@testing-library/react";
import { KEY } from "../src/hooks/useRemote";
import { useChrome } from "../src/hooks/useChrome";
import { PlaybackBanner } from "../src/components/PlaybackBanner";
import type { PlaybackTarget } from "../src/types";
import { mountApp, press, settle } from "./support/app";

/**
 * The banner names the channel and then goes away, and this is about the second half.
 *
 * A viewer reported it staying up for ever, occasionally, with no reproduction, and going away only
 * on right or back, which clear every overlay at once and so hide a fault rather than fix one. The
 * mechanism turned out to be exact. While a channel is joining the banner is held with no countdown,
 * deliberately, because a stream that takes fifteen seconds to arrive should keep saying which
 * channel it is. The countdown was then restarted by the picture arriving, and an arrival is
 * announced once per channel, also deliberately. So anything that made the app busy again on a
 * channel it had already announced left the banner held with nothing left to lower it.
 */

const PLAYLIST = `#EXTM3U
#EXTINF:-1 group-title="News",First Channel
http://example.invalid/1.m3u8
#EXTINF:-1 group-title="News",Second Channel
http://example.invalid/2.m3u8
`;

const FARSI_PLAYLIST = `#EXTM3U
#EXTINF:-1 group-title="شبکه ها",شبکه سه
http://example.invalid/farsi.m3u8
`;
const appCss = readFileSync("src/styles/app.css", "utf8");
const style = document.createElement("style");
style.textContent = appCss.replace('@import "./tokens.css";', "");
document.head.append(style);

/**
 * The banner is in the document while it is up, and gone when it is not.
 *
 * `.pb-stack` because that is what App renders it as. Worth stating since the hook calls the state
 * `banner` and there is no element by that name, which cost a first run of this file.
 */
const bannerUp = () => !!document.querySelector(".pb-stack");

/**
 * Skip past the banner's own eight seconds, which is not the panel's setting: the viewer chooses how long
 * the channel list stays open, and the banner has always had its own eight.
 */
const past = async () => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(8600);
  });
};

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.useRealTimers();
});

// ---- the contract, at the hook ----------------------------------------------------------

test("a raised banner counts itself down", () => {
  const { result } = renderHook(() => useChrome());
  act(() => {
    result.current.raiseBanner();
  });
  assert.equal(result.current.banner, true);

  act(() => {
    vi.advanceTimersByTime(8600);
  });
  assert.equal(result.current.banner, false);
});

test("a raised banner respects custom/configured duration (e.g. 2s)", () => {
  const { result } = renderHook(() => useChrome(2000));
  act(() => {
    result.current.raiseBanner();
  });
  assert.equal(result.current.banner, true);

  act(() => {
    vi.advanceTimersByTime(2100);
  });
  assert.equal(result.current.banner, false);
});

test("a raised banner with duration 'dismiss' (0ms) stays up until lowered", () => {
  const { result } = renderHook(() => useChrome(0));
  act(() => {
    result.current.raiseBanner();
  });
  assert.equal(result.current.banner, true);

  act(() => {
    vi.advanceTimersByTime(30000);
  });
  assert.equal(result.current.banner, true, "does not auto-dismiss when configured as dismiss");

  act(() => {
    result.current.lowerBanner();
  });
  assert.equal(result.current.banner, false);
});

test("a held banner stays up, because a channel still joining should keep saying which it is", () => {
  const { result } = renderHook(() => useChrome());
  act(() => {
    result.current.holdBanner();
  });

  act(() => {
    vi.advanceTimersByTime(30000);
  });
  assert.equal(
    result.current.banner,
    true,
    "a held banner must not time out while it is holding",
  );
});

test("settling a held banner gives it the count it never had", () => {
  // The fix. Whatever ends the waiting starts the five seconds, rather than only a picture arriving.
  const { result } = renderHook(() => useChrome());
  act(() => {
    result.current.holdBanner();
  });
  act(() => {
    result.current.settleBanner();
  });

  assert.equal(result.current.banner, true, "settling must not hide it immediately");
  act(() => {
    vi.advanceTimersByTime(8600);
  });
  assert.equal(result.current.banner, false, "a settled banner stayed up for ever");
});

test("settling does not raise a banner that is down", () => {
  /*
   * The other half of the same problem, and why this refuses to raise rather than simply restarting
   * the count. A stall recovering used to be treated as an arrival, the banner rose from the dead,
   * and since OK dismisses an arrival, OK could not get past it to open the channel list.
   */
  const { result } = renderHook(() => useChrome());
  act(() => {
    result.current.lowerBanner();
  });
  act(() => {
    result.current.settleBanner();
  });
  assert.equal(
    result.current.banner,
    false,
    "it resurrected a banner the viewer had dismissed",
  );
});

// ---- and in the application, on a channel that takes a moment to arrive -----------------

test("a Farsi category heading stays aligned with the LTR list", async () => {
  await mountApp(FARSI_PLAYLIST);

  const heading = document.querySelector(".list .panel-title");
  assert.ok(heading);
  assert.equal(heading.textContent, "شبکه ها");
  assert.equal(heading.getAttribute("dir"), "auto");
  assert.equal(getComputedStyle(heading).textAlign, "left");
});

test("a Farsi only channel title stays aligned with the LTR banner", async () => {
  await mountApp(FARSI_PLAYLIST);
  press(KEY.ENTER);

  const title = document.querySelector(".pb-title");
  assert.ok(title);
  assert.equal(title.textContent, "شبکه سه");
  assert.equal(title.getAttribute("dir"), "auto");
  assert.equal(getComputedStyle(title).textAlign, "left");
});

test("the live banner shows only the category name", async () => {
  await mountApp(PLAYLIST);
  press(KEY.ENTER);

  assert.equal(document.querySelector(".pb-group")?.textContent, "News");
});

test("the banner goes away on its own after a channel starts", async () => {
  await mountApp(PLAYLIST, { slowPicture: 300 });
  press(KEY.ENTER);
  await settle(500);
  assert.equal(bannerUp(), true, "the channel was never named");

  await past();
  assert.equal(bannerUp(), false, "the banner stayed up past its eight seconds");
});

test("the banner still goes away after pausing and playing the same channel", async () => {
  /*
   * The reported fault, pressed as the viewer pressed it. Play, wait for the banner to go, then pause
   * and play: the app is busy again on a channel whose arrival was already announced, so before the
   * fix nothing was left to start the countdown and the banner stayed until something cleared it.
   */
  await mountApp(PLAYLIST, { slowPicture: 300 });
  press(KEY.ENTER);
  await settle(500);
  await past();
  assert.equal(bannerUp(), false, "the banner had not gone before the interesting part began");

  press(KEY.PAUSE);
  await settle();
  press(KEY.PLAY);
  await settle(500);

  await past();
  assert.equal(bannerUp(), false, "the banner stayed up for ever after pause then play");
});

test("the banner goes away while a channel remains paused", async () => {
  await mountApp(PLAYLIST, { slowPicture: 300 });
  press(KEY.ENTER);
  await settle(500);
  await past();
  assert.equal(bannerUp(), false, "the banner had not gone before pausing");

  press(KEY.PAUSE);
  assert.equal(bannerUp(), true, "pausing did not show the channel banner");
  await past();
  assert.equal(bannerUp(), false, "paused state kept the expired banner visible");
});

const finiteTarget: PlaybackTarget = {
  id: "movie-1",
  playlistId: "playlist-1",
  mode: "finite",
  kind: "movie",
  name: "Feature film",
  group: "Cinema",
  logo: "",
  url: "http://example.invalid/movie.mp4",
};

test("finite playback shows elapsed and total time", () => {
  render(<PlaybackBanner target={finiteTarget} elapsed={65} duration={3600} />);
  assert.ok(screen.getByText("1:05 of 1:00:00"));
});

test("live playback does not show finite timing", () => {
  render(
    <PlaybackBanner
      target={{ ...finiteTarget, mode: "live", kind: "live" }}
      elapsed={65}
      duration={3600}
    />,
  );
  assert.equal(document.body.textContent?.includes("1:05 of 1:00:00"), false);
});

test("a live banner shows current and next programme names when available", () => {
  render(
    <PlaybackBanner
      channel={{
        id: "channel-1",
        name: "News",
        logo: "",
        group: "News",
        url: "http://example.invalid/live.m3u8",
        quality: "",
        number: 1,
      }}
      programme={{ current: "News at Noon", next: "Weather" }}
    />,
  );

  assert.ok(screen.getByText("Now: News at Noon"));
  assert.ok(screen.getByText("Next: Weather"));
});

test("PlaybackBanner renders EPG progress bar, archive badge, and Row 2 OSD track controls", () => {
  const onActivatePill = vi.fn();
  render(
    <PlaybackBanner
      channel={{
        id: "channel-1",
        name: "SVT 1 FHD",
        logo: "",
        group: "Sweden",
        url: "http://example.invalid/live.ts",
        quality: "FHD",
        number: 1,
        xtream: {
          playlistId: "pl-1",
          streamId: "101",
          categoryKey: "10",
          archiveDays: 7,
          directSource: "",
        },
      }}
      programme={{
        current: "Aktuellt",
        next: "Sportnytt",
        startTimestamp: 1700000000,
        stopTimestamp: 1700003600,
        progress: 0.5,
      }}
      osd={{
        active: true,
        cursor: 1,
        audioTracks: [
          { index: 1, language: "sv", format: "AAC", channels: 2, label: "Swedish (AAC)" },
        ],
        currentAudioTrack: 1,
        subtitleTracks: [{ index: 2, language: "sv", format: "DVB", label: "Swedish (DVB)" }],
        currentSubtitleTrack: 2,
        aspectId: "auto",
        canRestart: true,
        onActivatePill,
      }}
    />,
  );

  assert.equal(document.querySelector(".pb-archive")?.textContent, "A7");
  assert.equal(
    (document.querySelector(".pb-epg-fill") as HTMLElement | null)?.style.width,
    "50%",
  );
  assert.ok(document.querySelector(".pb-programme-time"));
  const pills = document.querySelectorAll(".pb-pill");
  assert.equal(pills.length, 4);
  assert.equal(pills[0]?.textContent, "Audio: Swedish (AAC)");
  assert.equal(pills[1]?.textContent, "Subtitles: Swedish (DVB)");
  assert.equal(pills[1]?.classList.contains("focused"), true);
  assert.equal(pills[2]?.textContent, "Aspect: Automatic 4:3");
  assert.equal(pills[3]?.textContent, "Play from start");

  (pills[2] as HTMLButtonElement).click();
  assert.equal(onActivatePill.mock.calls[0]?.[0], 2);
});

test("PlaybackBanner respects showNumbers prop/setting", () => {
  const channel = {
    id: "channel-1",
    num: 42,
    number: 42,
    name: "SVT 1",
    logo: "",
    group: "Sweden",
    url: "http://example.invalid/live.ts",
  };
  const { rerender } = render(<PlaybackBanner channel={channel} showNumbers={false} />);
  expect(document.querySelector(".pb-number")).toBeNull();

  rerender(<PlaybackBanner channel={channel} showNumbers={true} />);
  expect(document.querySelector(".pb-number")?.textContent).toBe("42");
});

test("pressing Right while watching focuses OSD controls and cycles Aspect Ratio without breaking Law 1", async () => {
  await mountApp(PLAYLIST);
  press(KEY.ENTER); // start watching channel 1
  await settle(500);

  // Press Right to focus OSD pill 0 (Audio), Right to pill 1 (Subtitles), Right to pill 2 (Aspect)
  press(KEY.RIGHT);
  assert.equal(document.querySelector(".pb-pill.focused")?.textContent, "Audio: Default");
  press(KEY.RIGHT);
  assert.equal(document.querySelector(".pb-pill.focused")?.textContent, "Subtitles: Automatic");
  press(KEY.RIGHT);
  assert.equal(document.querySelector(".pb-pill.focused")?.textContent, "Aspect: Original");

  // Press OK to cycle aspect ratio from Original -> Auto
  press(KEY.ENTER);
  assert.equal(document.querySelector(".pb-pill.focused")?.textContent, "Aspect: Automatic 4:3");
});

test("OSD playback banner is horizontally centered (TICKET-802)", () => {
  const css = readFileSync("src/styles/app.css", "utf8");
  expect(css).toMatch(/\.pb-stack\s*\{[^}]*left:\s*50%/);
  expect(css).toMatch(/\.pb-stack\s*\{[^}]*transform:\s*translateX\(-50%\)/);
});

test("OSD pills render color-coded badges and respond to color remote keys (TICKET-803)", async () => {
  await mountApp(PLAYLIST);
  press(KEY.ENTER); // start watching channel 1
  await settle(500);

  // Press OK to show OSD banner
  press(KEY.ENTER);
  expect(bannerUp()).toBe(true);

  // Verify color badges are present on pills
  const redBadge = document.querySelector(".pb-pill-badge.badge-red");
  const greenBadge = document.querySelector(".pb-pill-badge.badge-green");
  const yellowBadge = document.querySelector(".pb-pill-badge.badge-yellow");
  expect(redBadge).toBeTruthy();
  expect(greenBadge).toBeNull();
  expect(yellowBadge).toBeTruthy();

  // Press Yellow button on remote while OSD is active to cycle aspect ratio
  press(KEY.YELLOW);
  await settle(100);
  const aspectPill = document.querySelectorAll(".pb-pill")[2];
  expect(aspectPill?.textContent).toContain("Aspect:");

  // Green toggles favourites; subtitle state must remain unchanged.
  const priorSubtitle = document.querySelectorAll(".pb-pill")[1]?.textContent;
  press(KEY.GREEN);
  await settle(100);
  expect(document.querySelectorAll(".pb-pill")[1]?.textContent).toBe(priorSubtitle);
  const subPill = document.querySelectorAll(".pb-pill")[1];
  expect(subPill?.textContent).toContain("Subtitles:");

  // Active stream resolution badge renders with icon on Live TV OSD (TICKET-2167)
  const qualityBadge = document.querySelector(".pb-quality");
  expect(qualityBadge?.textContent).toBe("FHD");
  expect(qualityBadge?.querySelector(".pb-quality-icon")).toBeTruthy();
});

test("Resolution helper classifies SD, HD, FHD, 4K tiers and QualityBadge renders icons (TICKET-2167)", async () => {
  const { classifyResolution } = await import("../src/services/playbackLabels");
  expect(classifyResolution(720, 576)).toBe("SD");
  expect(classifyResolution(1280, 720)).toBe("HD");
  expect(classifyResolution(1920, 1080)).toBe("FHD");
  expect(classifyResolution(3840, 2160)).toBe("4K");
  expect(classifyResolution(0, 0)).toBeNull();

  const { QualityBadge } = await import("../src/components/QualityBadge");
  const { rerender } = render(<QualityBadge quality="SD" />);
  expect(document.querySelector(".pb-quality-sd svg.pb-quality-icon")).toBeTruthy();
  expect(document.querySelector(".pb-quality")?.textContent).toBe("SD");

  rerender(<QualityBadge quality="4K" />);
  expect(document.querySelector(".pb-quality-4k svg.pb-quality-icon")).toBeTruthy();
  expect(document.querySelector(".pb-quality")?.textContent).toBe("4K");
});

test("Live TV OSD Aspect button cycles single step per press without button double-activation (TICKET-2169)", async () => {
  await mountApp(PLAYLIST);
  press(KEY.ENTER); // start watching channel 1
  await settle(500);

  // Open OSD -> Audio pill -> move right twice to Aspect pill
  press(KEY.ENTER);
  press(KEY.RIGHT);
  press(KEY.RIGHT);
  await settle(50);

  const aspectPill = () => document.querySelectorAll(".pb-pill")[2];
  expect(aspectPill()?.getAttribute("tabindex")).toBe("-1");
  expect(aspectPill()?.textContent).toContain("Original");

  // Single OK press -> Auto
  press(KEY.ENTER);
  await settle(50);
  expect(aspectPill()?.textContent).toContain("Auto");

  // Single click -> Fill
  const { fireEvent } = await import("@testing-library/react");
  fireEvent.click(aspectPill()!);
  await settle(50);
  expect(aspectPill()?.textContent).toContain("Fill");

  // Single Yellow press -> Fit
  press(KEY.YELLOW);
  await settle(50);
  expect(aspectPill()?.textContent).toContain("Fit");
});
