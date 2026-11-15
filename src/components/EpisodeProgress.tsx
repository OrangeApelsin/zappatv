import { memo } from "react";
import { usePersonal } from "../stores/personal";
import { useLocale } from "../hooks/useLocale";
import { clock } from "./PlaybackBanner";

/** Mounted only for the displayed slice in both layouts. Identity is the full
 * source-scoped episode key; equal provider IDs cannot share progress. */
export const EpisodeProgress = memo(function EpisodeProgress({
  itemKey,
  duration,
}: {
  itemKey: string;
  duration?: number;
}) {
  const progress = usePersonal((state) =>
    state.progress.find((item) => item.itemKey === itemKey),
  );
  const { t } = useLocale();
  if (!progress || progress.seconds <= 0) return null;
  const total = progress.duration || duration || 0;
  const percent = total > 0 ? Math.min(100, Math.round((progress.seconds / total) * 100)) : 0;
  const watched = total > 0 && progress.seconds >= total * 0.9;
  return (
    <span className="episode-progress" data-progress-key={itemKey}>
      <span>
        {watched
          ? `✓ ${t("library.watched")}`
          : `${t("library.resume")} ${clock(progress.seconds)}`}
      </span>
      {percent > 0 && (
        <span
          className="episode-progress-track"
          role="progressbar"
          aria-label={t("library.resume")}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
        >
          <i style={{ width: `${percent}%` }} />
        </span>
      )}
    </span>
  );
});
