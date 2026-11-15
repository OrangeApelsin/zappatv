import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale } from "../hooks/useLocale";
import { clock } from "./PlaybackBanner";

export interface ScrubberTimelineProps {
  elapsed: number | null | undefined;
  duration: number | null | undefined;
  bufferedFraction?: number;
  focused?: boolean;
  activeScrub?: boolean;
  previewSeconds?: number | null;
  onScrubStart?: () => void;
  onCommitSeek?: (targetSeconds: number) => void;
  onCancelSeek?: () => void;
}

export const SEEK_STEPS = [10, 30, 60, 300, 600] as const;

export const clampSeekTarget = (targetSeconds: number, durationSeconds?: number | null) => {
  const positive = Math.max(0, targetSeconds);
  return durationSeconds && durationSeconds > 0 ? Math.min(durationSeconds, positive) : positive;
};

export const calcScrubStep = (
  consecutiveCount = 0,
  durationSeconds?: number | null,
): number => {
  const base = durationSeconds && durationSeconds > 7200 ? 4 : 2;
  if (consecutiveCount <= 2) return base;
  if (consecutiveCount <= 6) return base * 2;
  if (consecutiveCount <= 12) return base * 5;
  if (consecutiveCount <= 20) return base * 12;
  return base * 25;
};

export const formatDelta = (delta: number): string => {
  const sign = delta > 0 ? "+" : delta < 0 ? "-" : "";
  return `${sign}${clock(Math.abs(delta))}`;
};

export function ScrubberTimeline({
  elapsed,
  duration,
  bufferedFraction = 1,
  focused = false,
  activeScrub = false,
  previewSeconds,
  onScrubStart,
  onCommitSeek,
  onCancelSeek,
}: ScrubberTimelineProps) {
  const { t } = useLocale();
  const currentPos = Math.max(0, elapsed ?? 0);
  const totalDuration = Math.max(0, duration ?? 0);

  const [scrubSeconds, setScrubSeconds] = useState<number | null>(null);
  const scrubHoldRef = useRef<{ lastTime: number; count: number; dir: number }>({
    lastTime: 0,
    count: 0,
    dir: 0,
  });

  const controlled = previewSeconds !== undefined;
  const activePreview = controlled ? previewSeconds : scrubSeconds;
  const isScrubbing = (activeScrub || controlled) && activePreview !== null;
  const displayPos = isScrubbing ? activePreview : currentPos;
  const progressRatio = totalDuration > 0 ? Math.min(1, displayPos / totalDuration) : 0;
  const delta = isScrubbing ? activePreview - currentPos : 0;

  const handleStep = useCallback(
    (direction: -1 | 1) => {
      if (controlled) return;
      const now = Date.now();
      const prev = scrubHoldRef.current;
      const isRapid = now - prev.lastTime < 280 && prev.dir === direction;
      const count = isRapid ? prev.count + 1 : 0;
      scrubHoldRef.current = { lastTime: now, count, dir: direction };
      const stepSize = calcScrubStep(count, totalDuration);
      const base = scrubSeconds !== null ? scrubSeconds : currentPos;
      const nextTarget = clampSeekTarget(base + direction * stepSize, totalDuration);
      setScrubSeconds(nextTarget);
      onScrubStart?.();
    },
    [controlled, currentPos, onScrubStart, scrubSeconds, totalDuration],
  );

  useEffect(() => {
    if (!activeScrub && !controlled) {
      setScrubSeconds(null);
    }
  }, [activeScrub, controlled]);

  return (
    <div
      className={`scrub-container ${focused ? "focused" : ""} ${isScrubbing ? "scrubbing" : ""}`}
      tabIndex={controlled ? -1 : 0}
      role="slider"
      aria-label={t("osd.timeline")}
      aria-valuemin={0}
      aria-valuemax={totalDuration}
      aria-valuenow={displayPos}
      onKeyDown={(e) => {
        if (controlled) return;
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          handleStep(-1);
        } else if (e.key === "ArrowRight") {
          e.preventDefault();
          handleStep(1);
        } else if (e.key === "Enter" && isScrubbing) {
          e.preventDefault();
          onCommitSeek?.(activePreview);
          setScrubSeconds(null);
        } else if ((e.key === "Escape" || e.key === "Backspace") && isScrubbing) {
          e.preventDefault();
          onCancelSeek?.();
          setScrubSeconds(null);
        }
      }}
    >
      <span className="scrub-time">{clock(displayPos)}</span>

      <div
        className="scrub-track-wrapper"
        onClick={(e) => {
          if (totalDuration <= 0 || !onCommitSeek) return;
          const rect = e.currentTarget.getBoundingClientRect();
          if (rect.width <= 0) return;
          const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
          onCommitSeek(Math.round(ratio * totalDuration));
        }}
      >
        {isScrubbing && (
          <div className="seek-preview" style={{ left: `${Math.round(progressRatio * 100)}%` }}>
            <span className="seek-target">{clock(activePreview)}</span>
            <span className={`seek-delta ${delta >= 0 ? "plus" : "minus"}`}>
              {formatDelta(delta)}
            </span>
          </div>
        )}

        <div className="scrub-track">
          <div
            className="scrub-buffer"
            style={{ width: `${Math.round(Math.min(1, bufferedFraction) * 100)}%` }}
          />
          <div
            className="scrub-fill"
            style={{ width: `${Math.round(progressRatio * 100)}%` }}
          />
          <div className="scrub-knob" style={{ left: `${Math.round(progressRatio * 100)}%` }} />
        </div>
      </div>

      <span className="scrub-duration">
        {totalDuration > 0 ? clock(totalDuration) : "--:--"}
      </span>
    </div>
  );
}
