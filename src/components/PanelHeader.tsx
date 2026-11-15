import { memo } from "react";
import { useLocale } from "../hooks/useLocale";
import { Icon } from "./Icon";
import { Text } from "./Text";

export type HeaderControlId = "content" | "search" | "layout" | "settings" | "nowPlaying";

export function availableHeaderControls(
  contentAvailable: boolean,
  _guideAvailable?: boolean,
  layoutAvailable = false,
  nowPlayingAvailable = false,
): HeaderControlId[] {
  const controls: HeaderControlId[] = [];
  if (contentAvailable) controls.push("content");
  controls.push("search");
  if (layoutAvailable) controls.push("layout");
  controls.push("settings");
  if (nowPlayingAvailable) controls.push("nowPlaying");
  return controls;
}

export const PanelHeader = memo(function PanelHeader({
  active,
  on,
  controls,
  searching,
  nowPlayingTitle,
  onSearch,
  onSettings,
  onToggleGrid,
  onResumePlayback,
}: {
  active: boolean;
  on: HeaderControlId;
  controls: readonly HeaderControlId[];
  searching: boolean;
  nowPlayingTitle?: string;
  onSearch: () => void;
  onSettings: () => void;
  onToggleGrid?: () => void;
  onResumePlayback?: () => void;
}) {
  const { t } = useLocale();

  return (
    <div className="panel-bar">
      <div className="brand" onClick={onToggleGrid}>
        <img className="brand-mark" src="./icon.svg" alt="" aria-hidden="true" />
        <p className="rail-brand">Zappa TV</p>
      </div>
      <div className="panel-keys">
        {controls.map((control) => {
          if (control === "content") return null;
          if (control === "layout")
            return (
              <button
                key={control}
                data-header-control={control}
                type="button"
                className={`panel-key ${active && on === control ? "selected" : ""}`}
                onClick={onToggleGrid}
              >
                {t("library.gridView")}
              </button>
            );
          if (control === "search") {
            return (
              <button
                key={control}
                data-header-control={control}
                type="button"
                className={
                  `panel-key ${active && on === control ? "selected" : ""} ` +
                  `${searching ? "on" : ""}`
                }
                onClick={onSearch}
                aria-label={t("common.search")}
                aria-pressed={searching}
              >
                <Icon name="search" />
                <span>{t("common.search")}</span>
              </button>
            );
          }
          if (control === "nowPlaying") {
            return (
              <button
                key={control}
                data-header-control={control}
                type="button"
                className={`panel-key panel-key-now-playing ${active && on === control ? "selected" : ""}`}
                onClick={onResumePlayback}
                aria-label={
                  nowPlayingTitle
                    ? `${t("start.nowPlaying")}: ${nowPlayingTitle}`
                    : t("library.backToPlayer")
                }
              >
                <Icon name="play" />
                <span className="now-playing-label">
                  <Text
                    value={nowPlayingTitle || t("library.backToPlayer")}
                    marquee
                  />
                </span>
              </button>
            );
          }
          return (
            <button
              key={control}
              type="button"
              className={`panel-key ${active && on === control ? "selected" : ""}`}
              onClick={onSettings}
              aria-label={t("common.settings")}
            >
              <Icon name="settings" />
              <span>{t("common.settings")}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
});
