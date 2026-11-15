import { useLocale } from "../hooks/useLocale";

export interface UpNextPromptProps {
  title: string;
  season: number;
  episode: number;
  seconds: number;
  onPlayNow: () => void;
  onCancel: () => void;
}

export function UpNextPrompt({
  title,
  season,
  episode,
  seconds,
  onPlayNow,
  onCancel,
}: UpNextPromptProps) {
  const { t } = useLocale();

  return (
    <div
      className="up-next-prompt"
      data-testid="up-next-prompt"
      role="dialog"
      aria-labelledby="up-next-title"
    >
      <div className="up-next-header">
        <span className="up-next-badge">
          {t("vod.upNext")} ({seconds}s)
        </span>
      </div>
      <div id="up-next-title" className="up-next-title">
        <span className="up-next-ep-meta">
          S{season} E{episode}
        </span>
        <span className="up-next-ep-name">{title}</span>
      </div>
      <div className="up-next-actions">
        <button
          type="button"
          className="vod-btn vod-btn-primary up-next-btn-play"
          onClick={onPlayNow}
          aria-label={t("vod.playNow")}
        >
          {t("vod.playNow")} (OK)
        </button>
        <button
          type="button"
          className="vod-btn up-next-btn-cancel"
          onClick={onCancel}
          aria-label={t("common.cancel")}
        >
          {t("common.cancel")} (Return)
        </button>
      </div>
    </div>
  );
}

