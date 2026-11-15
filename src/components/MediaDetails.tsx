import { usePersonal } from "../stores/personal";
import { memo, type ReactNode } from "react";
import { useLocale } from "../hooks/useLocale";
import {
  formatXtreamRating,
  type XtreamEpisode,
  type XtreamMovieDetail,
  type XtreamSeriesDetail,
} from "../services/xtream";
import type { LibraryLoadState } from "../stores/library";
import { Icon } from "./Icon";
import { Poster } from "./Poster";
import { BrowseStatus } from "./BrowseStatus";
import { clock } from "./PlaybackBanner";

export type FiniteSelection =
  | { kind: "movie"; item: XtreamMovieDetail; itemKeys: string[]; restart?: boolean }
  | { kind: "episode"; item: XtreamEpisode; restart?: boolean };

export function MediaHero({
  detail,
  compact = false,
  actions,
}: {
  detail: XtreamMovieDetail | XtreamSeriesDetail;
  compact?: boolean;
  actions?: ReactNode;
}) {
  const duration = "durationSeconds" in detail ? detail.durationSeconds : undefined;
  const rating = formatXtreamRating(detail.rating);
  return (
    <div className={`media-hero ${compact ? "compact" : ""}`}>
      <div className="media-poster">
        {detail.logo ? (
          <Poster src={detail.logo} name={detail.name} />
        ) : (
          <Icon name={"seriesId" in detail ? "series" : "movie"} />
        )}
      </div>
      <div className="media-hero-copy">
        <h2 className="media-title">{detail.name}</h2>
        <div className="media-badges">
          {detail.year && <span className="media-badge">{detail.year}</span>}
          {duration !== undefined && <span className="media-badge">{clock(duration)}</span>}
          {detail.genre && <span className="media-badge">{detail.genre}</span>}
          {rating && (
            <span className="media-badge rating">
              <Icon name="star" />
              <span>{rating}</span>
            </span>
          )}
        </div>
        {actions}
        {detail.plot && <p className="media-plot">{detail.plot}</p>}
        {detail.cast && <p className="media-cast">{detail.cast}</p>}
        {!compact && detail.director && <p className="media-cast">{detail.director}</p>}
      </div>
    </div>
  );
}

export function MediaBreadcrumb({ items }: { items: readonly string[] }) {
  const shown = items.slice(0, -1).slice(-2);
  return (
    <div className="media-breadcrumb" aria-hidden="true">
      {shown.map((item, index) => (
        <span
          key={item}
          className={`media-breadcrumb-part ${index === shown.length - 1 ? "current" : ""}`}
        >
          {index > 0 && <span className="media-breadcrumb-separator">›</span>}
          <span>{item}</span>
        </span>
      ))}
    </div>
  );
}

export const MediaDetails = memo(function MediaDetails({
  state,
  title,
  trail,
  detail,
  itemKeys,
  resumeAt,
  focused,
  backFocused,
  retryFocused = false,
  onBack,
  onPlay,
  onRetry,
  extraActions,
}: {
  state: LibraryLoadState;
  title: string;
  trail: readonly string[];
  detail?: XtreamMovieDetail;
  itemKeys: string[];
  resumeAt?: number;
  focused: boolean;
  backFocused: boolean;
  retryFocused?: boolean;
  onBack: () => void;
  onPlay: (selection: FiniteSelection) => void;
  onRetry: () => void;
  extraActions?: ReactNode;
}) {
  const { t } = useLocale();
  const storedResume = usePersonal(
    (s) => s.progress.find((entry) => entry.itemKey === detail?.key)?.seconds,
  );
  const currentResume = storedResume ?? resumeAt;
  const playAction = detail ? (
    currentResume ? (
      <>
        <button
          type="button"
          className={`btn tonal media-play-action media-resume-action ${focused && !backFocused && !retryFocused ? "selected" : ""}`}
          onClick={() => onPlay({ kind: "movie", item: detail, itemKeys })}
        >
          <Icon name="play" />
          <span>{`${t("library.resume")} ${clock(currentResume)}`}</span>
        </button>
        <button
          type="button"
          className="btn tonal media-play-action media-restart-action"
          onClick={() => onPlay({ kind: "movie", item: detail, itemKeys, restart: true })}
        >
          <Icon name="refresh" />
          <span>{t("library.playFromBeginning")}</span>
        </button>
      </>
    ) : (
      <button
        type="button"
        className={`btn tonal media-play-action ${focused && !backFocused && !retryFocused ? "selected" : ""}`}
        onClick={() => onPlay({ kind: "movie", item: detail, itemKeys })}
      >
        <Icon name="play" />
        <span>{t("common.play")}</span>
      </button>
    )
  ) : null;
  return (
    <div className={`list pane media-details ${focused ? "focused" : ""}`}>
      <div className="pane-head media-appbar">
        <button
          type="button"
          className={`media-back ${backFocused ? "selected" : ""}`}
          aria-label={t("common.back")}
          onClick={onBack}
        >
          <Icon name="back" />
        </button>
        <p className="panel-title">{detail?.name || title}</p>
      </div>
      <MediaBreadcrumb items={trail} />
      {state === "loading" && (
        <div className="media-state" role="status">
          <span className="spinner" />
          <span>{t("library.loading")}</span>
        </div>
      )}
      {state === "failed" && (
        <BrowseStatus
          state="failed"
          stale={!!detail}
          focused={retryFocused}
          onRetry={onRetry}
        />
      )}
      {detail && (state === "loaded" || state === "failed" || state === "loading") && (
        <div className="media-detail-body">
          <MediaHero
            detail={detail}
            actions={
              extraActions ? (
                <div className="media-side-actions">
                  {playAction}
                  {extraActions}
                </div>
              ) : undefined
            }
          />
          {!extraActions && playAction}
        </div>
      )}
      {!detail && extraActions && <div className="media-side-actions">{extraActions}</div>}
    </div>
  );
});
