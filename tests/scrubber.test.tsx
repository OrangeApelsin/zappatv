import { describe, expect, test, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { formatDelta, ScrubberTimeline, SEEK_STEPS } from "../src/components/ScrubberTimeline";

describe("ScrubberTimeline (TICKET-807)", () => {
  test("defines seek steps 10s, 30s, 1m, 5m, 10m", () => {
    expect(SEEK_STEPS).toEqual([10, 30, 60, 300, 600]);
  });
  test("formats deltas correctly with + and - signs", () => {
    expect(formatDelta(0)).toBe("0:00");
    expect(formatDelta(75)).toBe("+1:15");
    expect(formatDelta(-120)).toBe("-2:00");
    expect(formatDelta(3665)).toBe("+1:01:05");
  });

  test("renders elapsed time and duration correctly", () => {
    const { container } = render(
      <ScrubberTimeline elapsed={300} duration={3600} bufferedFraction={0.8} />,
    );

    expect(container.querySelector(".scrub-time")?.textContent).toBe("5:00");
    expect(container.querySelector(".scrub-duration")?.textContent).toBe("1:00:00");
    const bufferBar = container.querySelector(".scrub-buffer") as HTMLElement;
    expect(bufferBar?.style.width).toBe("80%");
  });

  test("Left and Right arrows trigger scrub stepping with acceleration and preview", () => {
    const onScrubStart = vi.fn();
    const onCommitSeek = vi.fn();

    const { container } = render(
      <ScrubberTimeline
        elapsed={500}
        duration={3600}
        activeScrub={true}
        focused={true}
        onScrubStart={onScrubStart}
        onCommitSeek={onCommitSeek}
      />,
    );

    const slider = container.querySelector('[role="slider"]')!;

    // Initial step right (+2s smooth step)
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    expect(onScrubStart).toHaveBeenCalledTimes(1);
    expect(container.querySelector(".seek-target")?.textContent).toBe("8:22"); // 500 + 2 = 502s = 8:22
    expect(container.querySelector(".seek-delta")?.textContent).toBe("+0:02");

    // Second step right (+2s => 502 + 2 = 504s = 8:24)
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    expect(container.querySelector(".seek-target")?.textContent).toBe("8:24");
    expect(container.querySelector(".seek-delta")?.textContent).toBe("+0:04");

    // Press Enter to commit seek
    fireEvent.keyDown(slider, { key: "Enter" });
    expect(onCommitSeek).toHaveBeenCalledWith(504);
  });

  test("Escape or Backspace cancels scrubbing without committing", () => {
    const onCommitSeek = vi.fn();
    const onCancelSeek = vi.fn();

    const { container } = render(
      <ScrubberTimeline
        elapsed={200}
        duration={1000}
        activeScrub={true}
        focused={true}
        onCommitSeek={onCommitSeek}
        onCancelSeek={onCancelSeek}
      />,
    );

    const slider = container.querySelector('[role="slider"]')!;
    fireEvent.keyDown(slider, { key: "ArrowLeft" });
    expect(container.querySelector(".seek-target")?.textContent).toBe("3:18"); // 200 - 2 = 198s = 3:18

    fireEvent.keyDown(slider, { key: "Escape" });
    expect(onCancelSeek).toHaveBeenCalledTimes(1);
    expect(onCommitSeek).not.toHaveBeenCalled();
  });
});
