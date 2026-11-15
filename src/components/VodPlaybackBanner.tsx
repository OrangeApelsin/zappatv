import { useLocale } from "../hooks/useLocale";
import type { AudioTrack, Fit, SubtitleTrack } from "../services/player";
import type { PlaybackTarget } from "../types";
import { trackLabel, type VideoQualityTier } from "../services/playbackLabels";
import { formatAspectBadge } from "./PlaybackBanner";
import { Icon } from "./Icon";
import { KeyGuide } from "./KeyGuide";
import { Logo } from "./Logo";
import { QualityBadge } from "./QualityBadge";
import { ScrubberTimeline } from "./ScrubberTimeline";
import { Text } from "./Text";

const BANNER_LOGO = { width: 132, height: 68 };

export interface SeriesEpisodeInfo {
  seriesTitle?: string;
  seasonNum?: number;
  episodeNum?: number;
  episodeTitle?: string;
}

export interface VodPlaybackBannerProps {
  target: PlaybackTarget;
  elapsed?: number | null;
  duration?: number | null;
  paused?: boolean;
  osdActive?: boolean;
  activeRow?: "scrubber" | "transport" | "pills";
  rowIndex?: number;
  audioTracks?: readonly AudioTrack[];
  currentAudioTrack?: number;
  subtitleTracks?: readonly SubtitleTrack[];
  currentSubtitleTrack?: number;
  aspectId?: Fit;
  quality?: VideoQualityTier | null;
  episodeInfo?: SeriesEpisodeInfo;
  scrubPreview?: number | null;
  hasPrev?: boolean;
  hasNext?: boolean;
  onTogglePause?: () => void;
  onSeekBy?: (seconds: number) => void;
  onSeekTo?: (seconds: number) => void;
  onStepEpisode?: (delta: number) => void;
  onStop?: () => void;
  onSettings?: () => void;
  onSetAudioTrack?: (index: number) => void;
  onSetSubtitleTrack?: (index: number) => void;
  onCycleAspect?: () => void;
  onOpenEpisodes?: () => void;
  onSelectControl?: (row: "scrubber" | "transport" | "pills", index: number) => void;
}

export function VodPlaybackBanner({
  target,
  elapsed,
  duration,
  paused = false,
  osdActive = true,
  activeRow = "transport",
  rowIndex = 2, // default on play/pause
  audioTracks = [],
  currentAudioTrack,
  subtitleTracks = [],
  currentSubtitleTrack,
  aspectId = "auto",
  quality,
  episodeInfo,
  scrubPreview,
  hasPrev = true,
  hasNext = true,
  onTogglePause,
  onSeekBy,
  onSeekTo,
  onStepEpisode,
  onStop,
  onSettings,
  onSetAudioTrack,
  onSetSubtitleTrack,
  onCycleAspect,
  onOpenEpisodes,
  onSelectControl,
}: VodPlaybackBannerProps) {
  const { t, direction } = useLocale();
  const inlineEndArrow = direction === "rtl" ? "←" : "→";

  const isSeries = target.kind === "episode" || Boolean(episodeInfo?.seriesTitle);
  const displayTitle = isSeries
    ? episodeInfo?.seriesTitle || target.name
    : target.name || t("channel.unnamed");

  const episodeBadge = isSeries
    ? `S${String(episodeInfo?.seasonNum ?? 1).padStart(2, "0")}E${String(episodeInfo?.episodeNum ?? 1).padStart(2, "0")}${
        episodeInfo?.episodeTitle ? ` · ${episodeInfo.episodeTitle}` : ""
      }`
    : undefined;

  const activeAudio = audioTracks.find((track) => track.index === currentAudioTrack);
  const activeSubtitle =
    currentSubtitleTrack !== undefined && currentSubtitleTrack >= 0
      ? subtitleTracks.find((track) => track.index === currentSubtitleTrack)
      : undefined;

  const pills = [
    {
      key: "audio",
      color: "red",
      label: `${t("osd.audio")}: ${trackLabel(activeAudio, t)}`,
      onClick: () => {
        if (!audioTracks.length) return;
        const currentPos = audioTracks.findIndex((track) => track.index === currentAudioTrack);
        const nextTrack = audioTracks[(currentPos + 1) % audioTracks.length];
        if (nextTrack) onSetAudioTrack?.(nextTrack.index);
      },
    },
    {
      key: "subtitles",
      color: "none",
      label: `${t("osd.subtitles")}: ${activeSubtitle ? trackLabel(activeSubtitle, t) : t(currentSubtitleTrack === -1 ? "common.off" : "osd.auto")}`,
      onClick: () => {
        const options = [-1, ...subtitleTracks.map((track) => track.index)];
        const currentPos = options.indexOf(currentSubtitleTrack ?? -1);
        const nextSub = options[(currentPos + 1) % options.length] ?? -1;
        onSetSubtitleTrack?.(nextSub);
      },
    },
    {
      key: "aspect",
      color: "yellow",
      label: `${t("osd.aspect")}: ${formatAspectBadge(aspectId, t)}`,
      onClick: () => onCycleAspect?.(),
    },
    {
      key: "extra",
      color: "blue",
      label: isSeries ? t("content.series") : t("guide.playFromStart"),
      onClick: () => {
        if (isSeries) onOpenEpisodes?.();
        else onSeekTo?.(0);
      },
    },
  ];

  const transportButtons = [
    {
      key: "prev",
      icon: "previous" as const,
      label: "",
      badge: undefined,
      title:
        isSeries && (elapsed ?? 0) > 60
          ? t("osd.restart")
          : isSeries
            ? t("osd.previousEpisode")
            : t("osd.restart"),
      disabled: (elapsed ?? 0) > 60 ? false : isSeries ? !hasPrev : false,
      onClick: () => {
        if (isSeries && (elapsed ?? 0) > 60) onSeekTo?.(0);
        else if (isSeries) onStepEpisode?.(-1);
        else onSeekTo?.(0);
      },
    },
    {
      key: "rewind",
      icon: "rewind" as const,
      label: "",
      badge: "-10s",
      title: t("osd.rewind10"),
      disabled: false,
      onClick: () => onSeekBy?.(-10),
    },
    {
      key: "playPause",
      icon: paused ? "play" : "pause",
      label: paused ? t("common.play") : t("osd.pause"),
      badge: undefined,
      title: paused ? t("common.play") : t("osd.pause"),
      primary: true,
      disabled: false,
      onClick: () => onTogglePause?.(),
    },
    {
      key: "forward",
      icon: "forward" as const,
      label: "",
      badge: "+10s",
      title: t("osd.forward10"),
      disabled: false,
      onClick: () => onSeekBy?.(10),
    },
    {
      key: "next",
      icon: "next" as const,
      label: "",
      badge: undefined,
      title: t("osd.nextEpisode"),
      disabled: !hasNext,
      onClick: () => onStepEpisode?.(1),
    },
    {
      key: "stop",
      icon: "stop" as const,
      label: t("common.stop"),
      badge: undefined,
      title: t("common.stop"),
      disabled: false,
      onClick: () => onStop?.(),
    },
    {
      key: "settings",
      icon: "settings" as const,
      label: t("common.settings"),
      badge: undefined,
      title: t("common.settings"),
      disabled: false,
      onClick: () => onSettings?.(),
    },
  ];

  return (
    <div className="pb-stack vod-stack">
      {/* Top Media Info Header */}
      <div className="pb vod-header">
        <Logo
          src={target.logo}
          alt={displayTitle}
          className="pb-logo"
          width={BANNER_LOGO.width}
          height={BANNER_LOGO.height}
          intrinsic
        />
        <div className="pb-id">
          <Text value={displayTitle} className="pb-title" />
          <div className="pb-meta">
            {episodeBadge && <span className="vod-episode-badge">{episodeBadge}</span>}
            <Text value={target.group} className="pb-group" />
            <QualityBadge quality={quality === undefined ? "HD" : quality} />
          </div>
        </div>
      </div>

      {/* Scrubbable Timeline Track */}
      <div className="vod-timeline-row">
        <ScrubberTimeline
          elapsed={elapsed}
          duration={duration}
          focused={osdActive && activeRow === "scrubber"}
          activeScrub={(osdActive && activeRow === "scrubber") || scrubPreview != null}
          previewSeconds={scrubPreview}
          onCommitSeek={(targetSec) => onSeekTo?.(targetSec)}
          onCancelSeek={() => {}}
        />
      </div>

      {/* Netflix-Style Transport Buttons Row */}
      <div className="vod-transport-row" role="toolbar" aria-label={t("osd.transport")}>
        {transportButtons.map((btn, idx) => (
          <button
            key={btn.key}
            type="button"
            tabIndex={-1}
            className={`vod-btn ${btn.primary ? "vod-btn-primary" : ""} ${
              btn.key === "stop" ? "vod-btn-stop" : ""
            } ${
              osdActive && activeRow === "transport" && rowIndex === idx ? "focused" : ""
            }`}
            disabled={btn.disabled}
            onMouseDown={(e) => e.preventDefault()}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.keyCode === 13 || e.key === " ") {
                e.preventDefault();
              }
            }}
            onClick={() => {
              onSelectControl?.("transport", idx);
              btn.onClick();
            }}
          >
            {btn.icon && <Icon name={btn.icon} />}
            {btn.badge && <span className="vod-btn-badge">{btn.badge}</span>}
            {btn.label && <span>{btn.label}</span>}
          </button>
        ))}
      </div>

      {/* Color-Coded Controls Pills Row */}
      <div
        className="pb-controls vod-controls-row"
        role="toolbar"
        aria-label={t("osd.controls")}
      >
        {pills.map((pill, pillIndex) => (
          <button
            key={pill.key}
            type="button"
            tabIndex={-1}
            className={`pb-pill ${
              osdActive && activeRow === "pills" && rowIndex === pillIndex ? "focused" : ""
            }`}
            onMouseDown={(e) => e.preventDefault()}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.keyCode === 13 || e.key === " ") {
                e.preventDefault();
              }
            }}
            onClick={() => {
              onSelectControl?.("pills", pillIndex);
              pill.onClick();
            }}
          >
            {pill.color !== "none" && (
              <span className={`pb-pill-badge badge-${pill.color}`} aria-hidden="true" />
            )}
            <span>{pill.label}</span>
          </button>
        ))}
      </div>

      {/* Bottom Key Hints */}
      <KeyGuide
        className="pb-hints"
        items={[
          { keys: ["\u2190", "\u2192"], label: t("guide.seek") },
          { keys: ["OK"], label: t("common.playPause") },
          { keys: ["Green"], label: t("guide.favourite") },
          { keys: ["Return", inlineEndArrow], label: t("guide.hideThis") },
        ]}
      />
    </div>
  );
}
