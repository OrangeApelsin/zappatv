import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  detectGridColumns,
  GROUP_TAB_WIDTH,
  HomeTileGrid,
  ROWS_VISIBLE,
  stepTileGrid,
} from "../src/components/HomeTileGrid";
import { KEY } from "../src/hooks/useRemote";
import type { ChannelGuide } from "../src/stores/library";
import type { Channel } from "../src/types";
import { press } from "./support/app";

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});

function makeChannels(count: number, group = "Nordic"): Channel[] {
  return Array.from({ length: count }, (_, idx) => ({
    id: `ch-${idx + 1}`,
    name: `Channel ${idx + 1}`,
    logo: "",
    group,
    url: `http://example.invalid/live/${idx + 1}.ts`,
    quality: "HD",
    number: idx + 1,
    xtream: {
      playlistId: "pl-1",
      streamId: String(100 + idx),
      categoryKey: "live:1",
      archiveDays: idx === 0 ? 7 : 0,
      directSource: "",
    },
  }));
}

test("detectGridColumns selects 4, 5, or 6 columns from Samsung TV model diagonal", () => {
  expect(detectGridColumns("UE32T5300AUXRU")).toBe(4);
  expect(detectGridColumns("UE43TU7090UXZG")).toBe(5);
  expect(detectGridColumns("QN55Q80TAFXZA")).toBe(6);
  expect(detectGridColumns("QE65S95BATXXC")).toBe(6);
  expect(detectGridColumns("", 1024)).toBe(4);
  expect(detectGridColumns("", 1440)).toBe(5);
  expect(detectGridColumns("", 1920)).toBe(6);
});

test("stepTileGrid wraps horizontally and vertically across rows", () => {
  // 14 items across 6 columns -> 3 rows (row 0: 0..5, row 1: 6..11, row 2: 12..13)
  expect(stepTileGrid(0, 14, 6, "left")).toBe(13);
  expect(stepTileGrid(13, 14, 6, "right")).toBe(0);
  // Up from row 0 col 1 wraps to row 2 col 1 (index 13)
  expect(stepTileGrid(1, 14, 6, "up")).toBe(13);
  // Up from row 0 col 4 wraps to row 2 col 4, clamped to last item (13)
  expect(stepTileGrid(4, 14, 6, "up")).toBe(13);
  // Down from row 2 col 1 (index 13) wraps to row 0 col 1 (index 1)
  expect(stepTileGrid(13, 14, 6, "down")).toBe(1);
});

test("HomeTileGrid mounts at most 18 tile DOM nodes and displays live EPG progress and archive badge", () => {
  const now = Math.floor(Date.now() / 1000);
  const channels = makeChannels(40);
  const guides: Record<string, ChannelGuide> = {
    "ch-1": {
      state: "loaded",
      items: [],
      current: {
        key: "p-1",
        title: "Morning News Live",
        description: "",
        start: "",
        stop: "",
        startTimestamp: now - 900,
        stopTimestamp: now + 900,
        archive: true,
      },
    },
  };
  const onPrefetchBatchEpg = vi.fn();

  const { container } = render(
    <HomeTileGrid
      channels={channels}
      categories={[
        { key: "live:1", name: "Nordic" },
        { key: "live:2", name: "Sports" },
      ]}
      guides={guides}
      model="QN55Q80TAFXZA"
      onPrefetchBatchEpg={onPrefetchBatchEpg}
    />,
  );

  const tiles = container.querySelectorAll(".home-tile");
  expect(tiles.length).toBe(ROWS_VISIBLE * 6);
  expect(tiles.length).toBeLessThanOrEqual(18);

  expect(screen.getByText("Channel 1")).toBeTruthy();
  expect(screen.getByText("Morning News Live")).toBeTruthy();
  expect(container.querySelector(".home-tile-archive")?.textContent).toBe("A7");

  const progressFill = container.querySelector(".home-tile-progress-fill") as HTMLElement | null;
  expect(progressFill?.style.width).toBe("50%");

  // Batch EPG prefetches visible window (18) + 1 row buffer (6) = 24 channels
  expect(onPrefetchBatchEpg).toHaveBeenCalledTimes(1);
  expect(onPrefetchBatchEpg.mock.calls[0]?.[0]).toHaveLength(24);
});

test("HomeTileGrid supports 3-zone D-pad navigation, Ch+/Ch- jumps, and skewed parallelogram group switching", () => {
  const channels = makeChannels(12);
  const onSelectCategory = vi.fn();
  const onSelectChannel = vi.fn();

  const { container } = render(
    <HomeTileGrid
      channels={channels}
      categories={[
        { key: "live:1", name: "Nordic" },
        { key: "live:2", name: "Sports" },
        { key: "live:3", name: "Cinema" },
      ]}
      xtreamAvailable
      model="QN55Q80TAFXZA"
      onSelectCategory={onSelectCategory}
      onSelectChannel={onSelectChannel}
    />,
  );

  // Starts in grid zone on tile 0
  expect(container.querySelector(".home-view")?.getAttribute("data-zone")).toBe("grid");
  expect(
    container.querySelector(".home-tile.selected .home-tile-name")?.textContent,
  ).toBe("Channel 1");

  // Move right to Channel 2
  press(KEY.RIGHT);
  expect(
    container.querySelector(".home-tile.selected .home-tile-name")?.textContent,
  ).toBe("Channel 2");

  // Press Ch+ to jump directly to header zone
  press(KEY.CH_UP);
  expect(container.querySelector(".home-view")?.getAttribute("data-zone")).toBe("header");
  expect(container.querySelector(".home-header.focused")).toBeTruthy();

  // Press Down in header zone to return to grid zone
  press(KEY.DOWN);
  expect(container.querySelector(".home-view")?.getAttribute("data-zone")).toBe("grid");

  // Press Ch- to jump directly to groups zone
  press(KEY.CH_DOWN);
  expect(container.querySelector(".home-view")?.getAttribute("data-zone")).toBe("groups");
  expect(container.querySelector(".home-groups.focused")).toBeTruthy();

  const pill = container.querySelector(".home-groups-pill") as HTMLElement | null;
  expect(pill?.style.transform).toBe("translateX(0px) skewX(-20deg)");

  // Press Right in groups zone to switch to Sports (index 1)
  press(KEY.RIGHT);
  expect(onSelectCategory).toHaveBeenCalledWith(1);
  expect(pill?.style.transform).toBe(`translateX(${GROUP_TAB_WIDTH}px) skewX(-20deg)`);

  // Press Up from groups zone to return to grid and press Enter to tune
  press(KEY.UP);
  expect(container.querySelector(".home-view")?.getAttribute("data-zone")).toBe("grid");

  fireEvent.click(screen.getByText("Channel 3").closest("button")!);
  expect(onSelectChannel).toHaveBeenCalledWith(2, channels[2]);
});

