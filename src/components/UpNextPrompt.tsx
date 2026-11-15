import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale } from "../hooks/useLocale";
import { KEY, useRemote } from "../hooks/useRemote";
import { Icon } from "./Icon";

export interface UpNextPromptProps {
  title: string;
  season?: number;
  episode?: number;
  seriesTitle?: string;
  thumbnail?: string;
  seconds: number;
  onPlayNow: () => void;
  onCancel: () => void;
}

const RADIUS = 24;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS; // ~150.796447

export function UpNextPrompt({
  title,
  season,
  episode,
  thumbnail,
  seconds,
  onPlayNow,
  onCancel,
}: UpNextPromptProps) {
  const { t } = useLocale();
  const [focus, setFocus] = useState<"play" | "cancel">("play");
  const [animated, setAnimated] = useState(false);
  const playBtnRef = useRef<HTMLButtonElement>(null);
  const cancelBtnRef = useRef<HTMLButtonElement>(null);

  const initialSecRef = useRef(seconds > 0 ? seconds : 10);

  // Initialize ring animation on next animation frame
  useEffect(() => {
    const handle = requestAnimationFrame(() => {
      setAnimated(true);
    });
    return () => cancelAnimationFrame(handle);
  }, []);

  // Auto-focus the thumbnail/Play Now button when card appears
  useEffect(() => {
    playBtnRef.current?.focus();
  }, []);

  const handleRemote = useCallback(
    (code: number, event: KeyboardEvent) => {
      if (code === KEY.LEFT || code === KEY.RIGHT) {
        event.preventDefault();
        event.stopPropagation();
        setFocus((prev) => {
          const next = prev === "play" ? "cancel" : "play";
          if (next === "play") playBtnRef.current?.focus();
          else cancelBtnRef.current?.focus();
          return next;
        });
        return;
      }
      if (code === KEY.ENTER) {
        event.preventDefault();
        event.stopPropagation();
        if (focus === "cancel") {
          onCancel();
        } else {
          onPlayNow();
        }
        return;
      }
      if (code === KEY.BACK || code === KEY.ESC) {
        event.preventDefault();
        event.stopPropagation();
        onCancel();
        return;
      }
    },
    [focus, onCancel, onPlayNow],
  );

  useRemote(handleRemote);

  const total = initialSecRef.current > 0 ? initialSecRef.current : 10;
  const elapsed = Math.max(0, total - seconds);
  const elapsedRatio = Math.min(1, elapsed / total);
  const offset = CIRCUMFERENCE * elapsedRatio;

  const hasEpMeta = season !== undefined && episode !== undefined;

  return (
    <div
      id="upNextCard"
      className="up-next-card up-next-prompt"
      data-testid="up-next-prompt"
      role="dialog"
      aria-labelledby="up-next-title"
    >
      {/* 1. Thumbnail + Progress Ring Button */}
      <button
        id="playNowBtn"
        ref={playBtnRef}
        type="button"
        className={`up-next-play-btn ${focus === "play" ? "focused" : ""}`}
        onClick={onPlayNow}
        onMouseEnter={() => {
          setFocus("play");
          playBtnRef.current?.focus();
        }}
        aria-label={`${t("vod.playNow")} (${seconds}s)`}
      >
        {thumbnail ? (
          <img src={thumbnail} alt="" className="up-next-thumb-img" />
        ) : (
          <div className="up-next-thumb-fallback">
            <Icon name="play" />
          </div>
        )}
        <div className="up-next-scrim">
          <svg
            className="up-next-ring"
            width="56"
            height="56"
            viewBox="0 0 56 56"
            aria-hidden="true"
          >
            <circle
              className="up-next-track"
              cx="28"
              cy="28"
              r="24"
              strokeWidth="3.5"
              fill="none"
            />
            <circle
              className="up-next-progress"
              cx="28"
              cy="28"
              r="24"
              strokeWidth="3.5"
              strokeLinecap="round"
              fill="none"
              style={{
                strokeDasharray: CIRCUMFERENCE,
                strokeDashoffset: offset,
                transition: animated ? "stroke-dashoffset 1s linear" : "none",
              }}
            />
          </svg>
          <span className="up-next-seconds">{seconds}s</span>
        </div>
      </button>

      {/* 2. Metadata Column */}
      <div className="up-next-meta">
        <span className="up-next-eyebrow">{t("vod.upNext")}</span>
        {hasEpMeta && (
          <span className="up-next-ep-meta">
            S{season} E{episode}
          </span>
        )}
        <div id="up-next-title" className="up-next-video-title up-next-ep-name">
          {title}
        </div>
      </div>

      {/* 3. Dismiss / Cancel Button */}
      <button
        id="cancelNextBtn"
        ref={cancelBtnRef}
        type="button"
        className={`up-next-cancel-btn ${focus === "cancel" ? "focused" : ""}`}
        onClick={onCancel}
        onMouseEnter={() => {
          setFocus("cancel");
          cancelBtnRef.current?.focus();
        }}
        aria-label={t("common.cancel")}
      >
        <Icon name="close" />
      </button>
    </div>
  );
}
