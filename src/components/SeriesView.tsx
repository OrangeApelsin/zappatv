import { useSettings } from "../stores/settings";
import type { FC } from "react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Poster } from "./Poster";
import { useScrollWindow } from "../hooks/useScrollWindow";
import { EPISODE_ROW_HEIGHT, EPISODE_ROW_GAP } from "../services/vodMetrics";
import { useLocale } from "../hooks/useLocale";
import { KEY, useRemote } from "../hooks/useRemote";
import type { XtreamEpisode } from "../services/xtream";
import { useLibrary } from "../stores/library";
import { usePersonal } from "../stores/personal";
import { useEpisodeField } from "../stores/vodBrowse";
import { BrowseStatus } from "./BrowseStatus";
import { EpisodeProgress } from "./EpisodeProgress";
import { Icon } from "./Icon";
import { clock } from "./PlaybackBanner";
import type { ShapedVodItem } from "../workers/vodWorker";

export interface SeriesViewProps {
  series: ShapedVodItem;
  onPlayEpisode: (episode: XtreamEpisode, restart?: boolean) => void;
  onBack: () => void;
  onToggleLayout?: () => void;
  onToggleFavourite?: () => void;
  onResumePlayback?: () => void;
}

export const SeriesView: FC<SeriesViewProps> = ({
  series,
  onPlayEpisode,
  onBack,
  onToggleLayout,
  onToggleFavourite,
  onResumePlayback,
}) => {
  const { t, number, locale, direction } = useLocale();
  const fontSize = useSettings((state) => state.fontSizeId);
  const inlineStart = direction === "rtl" ? KEY.RIGHT : KEY.LEFT;
  const inlineEnd = direction === "rtl" ? KEY.LEFT : KEY.RIGHT;
  const loadSeries = useLibrary((s) => s.loadSeries);
  const seriesDetails = useLibrary((s) => s.seriesDetails);

  const [focusZone, setFocusZone] = useEpisodeField(series.key, "focusZone");
  const [actionIndex, setActionIndex] = useState(0);
  const [promptEpisode, setPromptEpisode] = useState<{
    episode: XtreamEpisode;
    resumeSeconds: number;
  } | null>(null);
  const [promptAction, setPromptAction] = useState<0 | 1 | 2>(0);
  const [selectedSeason, setSelectedSeason] = useEpisodeField(series.key, "selectedSeason");
  const [episodeKey, setEpisodeKey] = useEpisodeField(series.key, "episodeKey");
  const [fallbackIndex, setFallbackIndex] = useEpisodeField(series.key, "fallbackIndex");
  const [remembered, setRemembered] = useEpisodeField(series.key, "seasons");
  const [savedScroll, setSavedScroll] = useEpisodeField(series.key, "scrollTop");
  const cursor = useRef(0);
  const scrollerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    void loadSeries(series.key);
  }, [series.key, loadSeries]);
  const entry = seriesDetails[series.key];
  const detail = entry?.value;
  const state = entry?.state ?? "loading";
  const retry = () => {
    void useLibrary.getState().retry(series.key);
  };
  useEffect(() => {
    if (state === "failed" && !detail) setFocusZone("status");
  }, [state, detail, setFocusZone]);
  const episodes = useMemo(() => detail?.episodes || [], [detail?.episodes]);
  const { seasonsMap, locations } = useMemo(() => {
    const seasonsMap = new Map<number, XtreamEpisode[]>();
    const locations = new Map<string, { season: number; index: number }>();
    for (const episode of episodes) {
      const season =
        Number.isInteger(episode.season) && episode.season >= 0 ? episode.season : 1;
      let items = seasonsMap.get(season);
      if (!items) {
        items = [];
        seasonsMap.set(season, items);
      }
      locations.set(episode.key, { season, index: items.length });
      items.push(episode);
    }
    return { seasonsMap, locations };
  }, [episodes]);
  const seasonNumbers = useMemo(
    () => [...seasonsMap.keys()].sort((a, b) => a - b),
    [seasonsMap],
  );
  const activeSeason =
    selectedSeason !== null && seasonsMap.has(selectedSeason)
      ? selectedSeason
      : (seasonNumbers[0] ?? 0);
  const currentEpisodes = seasonsMap.get(activeSeason) ?? [];
  const position = locations.get(episodeKey);
  const safeEpIndex =
    position?.season === activeSeason
      ? position.index
      : Math.min(Math.max(0, fallbackIndex), Math.max(0, currentEpisodes.length - 1));
  cursor.current = safeEpIndex;
  const selectEpisode = (index: number) => {
    const next = Math.min(Math.max(0, index), Math.max(0, currentEpisodes.length - 1));
    cursor.current = next;
    setFallbackIndex(next);
    const key = currentEpisodes[next]?.key ?? "";
    setEpisodeKey(key);
    setRemembered({ ...remembered, [activeSeason]: key });
  };
  const selectSeason = (season: number) => {
    const items = seasonsMap.get(season) ?? [];
    const key = remembered[season];
    const at = key ? locations.get(key) : undefined;
    setSelectedSeason(season);
    setEpisodeKey(at?.season === season ? key! : (items[0]?.key ?? ""));
    setFallbackIndex(0);
    cursor.current = at?.season === season ? at.index : 0;
  };
  const activateEpisode = (ep: XtreamEpisode) => {
    const progress = usePersonal.getState().progress.find((p) => p.itemKey === ep.key);
    if (progress && progress.seconds > 0) {
      setPromptEpisode({ episode: ep, resumeSeconds: progress.seconds });
      setPromptAction(0);
    } else {
      onPlayEpisode(ep);
    }
  };
  const win = useScrollWindow(
    scrollerRef,
    currentEpisodes.length,
    safeEpIndex,
    1,
    EPISODE_ROW_HEIGHT,
    currentEpisodes,
    `${state}:${locale}:${fontSize}`,
    savedScroll,
  );
  useEffect(() => {
    setSavedScroll(win.top);
  }, [win.top, setSavedScroll]);
  useLayoutEffect(() => {
    document.querySelector<HTMLElement>("#view-series .focused")?.focus();
  }, [focusZone, safeEpIndex, activeSeason, actionIndex, state, promptEpisode, promptAction]);

  // Remote key navigation
  useRemote((code, event) => {
    if (event.defaultPrevented) return;
    if (promptEpisode) {
      if (code === KEY.BACK || code === KEY.ESC) {
        event.preventDefault();
        setPromptEpisode(null);
        return;
      }
      if (code === KEY.UP) {
        event.preventDefault();
        setPromptAction((prev) => (prev > 0 ? ((prev - 1) as 0 | 1 | 2) : 2));
        return;
      }
      if (code === KEY.DOWN) {
        event.preventDefault();
        setPromptAction((prev) => (prev < 2 ? ((prev + 1) as 0 | 1 | 2) : 0));
        return;
      }
      if (code === KEY.ENTER) {
        event.preventDefault();
        const ep = promptEpisode.episode;
        if (promptAction === 0) {
          setPromptEpisode(null);
          onPlayEpisode(ep, false);
        } else if (promptAction === 1) {
          setPromptEpisode(null);
          onPlayEpisode(ep, true);
        } else {
          setPromptEpisode(null);
        }
        return;
      }
      return;
    }
    if (code === KEY.GREEN) {
      event.preventDefault();
      onToggleFavourite?.();
      return;
    }
    if (event.defaultPrevented) return;
    if (code === KEY.GRID) {
      event.preventDefault();
      onToggleLayout?.();
      return;
    }
    if (focusZone === "actions") {
      const actionCount = onResumePlayback ? 3 : 2;
      if (code === inlineStart || code === inlineEnd) {
        event.preventDefault();
        const delta = code === inlineStart ? -1 : 1;
        setActionIndex((index) => Math.max(0, Math.min(actionCount - 1, index + delta)));
        return;
      }
      if (code === KEY.DOWN) {
        event.preventDefault();
        setFocusZone("seasons");
        return;
      }
      if (code === KEY.ENTER) {
        event.preventDefault();
        if (actionIndex === 0) onBack();
        else if (actionIndex === 1) onToggleLayout?.();
        else if (actionIndex === 2) onResumePlayback?.();
        return;
      }
    }
    if (focusZone === "status" && code === KEY.ENTER) {
      event.preventDefault();
      retry();
      return;
    }
    if (focusZone === "status" && (code === KEY.UP || code === KEY.DOWN)) {
      event.preventDefault();
      setFocusZone("seasons");
      return;
    }
    if (code === KEY.BACK || code === KEY.ESC) {
      event.preventDefault();
      onBack();
      return;
    }

    if (focusZone === "seasons") {
      if (code === KEY.UP) {
        event.preventDefault();
        setFocusZone("actions");
        return;
      }
      const currentIdx = seasonNumbers.indexOf(activeSeason);
      if (code === inlineStart) {
        event.preventDefault();
        if (currentIdx > 0) {
          const prevSeason = seasonNumbers[currentIdx - 1];
          if (prevSeason !== undefined) {
            selectSeason(prevSeason);
          }
        }
      } else if (code === inlineEnd) {
        event.preventDefault();
        if (currentIdx < seasonNumbers.length - 1) {
          const nextSeason = seasonNumbers[currentIdx + 1];
          if (nextSeason !== undefined) {
            selectSeason(nextSeason);
          }
        }
      } else if (code === KEY.DOWN || code === KEY.ENTER) {
        event.preventDefault();
        if (currentEpisodes.length > 0) {
          setFocusZone("episodes");
        }
      }
      return;
    }

    if (focusZone === "episodes") {
      if (code === KEY.UP) {
        event.preventDefault();
        if (cursor.current > 0) {
          selectEpisode(cursor.current - 1);
        } else {
          setFocusZone("seasons");
        }
      } else if (code === KEY.DOWN) {
        event.preventDefault();
        if (cursor.current < currentEpisodes.length - 1) {
          selectEpisode(cursor.current + 1);
        }
      } else if (code === inlineStart) {
        event.preventDefault();
        setFocusZone("seasons");
      } else if (code === KEY.ENTER) {
        event.preventDefault();
        const ep = currentEpisodes[safeEpIndex];
        if (ep) {
          activateEpisode(ep);
        }
      }
    }
  });

  const plotText = detail?.plot || series.plot || "";

  return (
    <div id="view-series">
      {/* Left Column: Large Artwork Poster & Metadata */}
      <div className="sr-left">
        <div className="sr-poster">
          <Poster src={series.logo} name={series.name} />
        </div>
        <div className="sr-left-info">
          <div className="sr-left-title">{series.name}</div>
          <div className="sr-left-meta">
            {series.year && <span>{series.year} · </span>}
            {series.rating && <span>★ {series.rating} · </span>}
            {series.group || t("content.series")}
          </div>
        </div>
        <div className="sr-hint" onClick={onBack}>
          <span>
            {t("common.returnKey")}: {t("library.backToSeries")}
          </span>
        </div>
      </div>

      {/* Right Column: Series Title, Plot, Season Pills, Episode Scroller */}
      <div className="sr-right">
        <div className="sr-actions">
          <button
            type="button"
            className={focusZone === "actions" && actionIndex === 0 ? "focused" : ""}
            onClick={onBack}
          >
            {t("common.back")}
          </button>
          <button
            type="button"
            className={focusZone === "actions" && actionIndex === 1 ? "focused" : ""}
            onClick={onToggleLayout}
          >
            {t("library.listView")}
          </button>
          {onResumePlayback && (
            <button
              type="button"
              className={`sr-now-playing ${focusZone === "actions" && actionIndex === 2 ? "focused" : ""}`}
              onClick={onResumePlayback}
            >
              {t("library.backToPlayer")}
            </button>
          )}
        </div>
        <div className="sr-head">
          <div className="sr-title">{series.name}</div>
          <div className="sr-meta">
            {series.year && <span>{series.year}</span>}
            {series.rating && <span style={{ color: "#ffb44c" }}>★ {series.rating}</span>}
            {series.genre && <span>{series.genre}</span>}
            <span>{t("library.seasonCount", { count: number(seasonNumbers.length) })}</span>
            <span>{t("library.episodeCount", { count: number(episodes.length) })}</span>
          </div>
          {plotText && <div className="sr-plot">{plotText}</div>}
        </div>

        {state !== "loaded" && (
          <BrowseStatus
            state={state}
            stale={!!detail}
            focused={focusZone === "status"}
            onRetry={retry}
          />
        )}
        {/* Season Selector Pills */}
        <div className="sr-seasons">
          {seasonNumbers.map((seasonNum) => {
            const isActive = activeSeason === seasonNum;
            const isFocused = focusZone === "seasons" && isActive;
            return (
              <button
                key={seasonNum}
                type="button"
                className={`sr-season ${isActive ? "active" : ""} ${isFocused ? "focused" : ""}`}
                onClick={() => {
                  selectSeason(seasonNum);
                  setFocusZone("episodes");
                }}
              >
                {t("library.season", { number: number(seasonNum) })}
              </button>
            );
          })}
        </div>

        {/* Episodes Scroller */}
        <div className="sr-ep-scroller" ref={scrollerRef} onScroll={win.onScroll}>
          <div style={{ position: "relative", height: win.height }}>
            {currentEpisodes.slice(win.start, win.end).map((ep, offset) => {
              const idx = win.start + offset;
              const isFocused = focusZone === "episodes" && safeEpIndex === idx;
              const epNum = number(ep.number || idx + 1);
              const subText = ep.durationSeconds
                ? t("library.minutes", { count: number(Math.round(ep.durationSeconds / 60)) })
                : "";

              return (
                <button
                  type="button"
                  data-episode-key={ep.key}
                  style={{
                    position: "absolute",
                    top: idx * EPISODE_ROW_HEIGHT,
                    height: EPISODE_ROW_HEIGHT - EPISODE_ROW_GAP,
                    width: "100%",
                    border: 0,
                    textAlign: "start",
                  }}
                  key={ep.key}
                  className={`sr-ep ${isFocused ? "focused" : ""}`}
                  onClick={() => {
                    selectEpisode(idx);
                    setFocusZone("episodes");
                    activateEpisode(ep);
                  }}
                >
                  <div className="sr-ep-num">{epNum}</div>
                  <div className="sr-ep-text">
                    <div className="sr-ep-title">
                      {ep.name ||
                        t("library.episode", { number: number(ep.number || idx + 1) })}
                    </div>
                    {subText && <div className="sr-ep-sub">{subText}</div>}
                  </div>

                  <EpisodeProgress itemKey={ep.key} duration={ep.durationSeconds} />
                </button>
              );
            })}
          </div>
        </div>
      </div>
      {promptEpisode && (
        <div
          id="view-episode-details"
          className="episode-prompt-overlay"
          role="dialog"
          aria-modal="true"
          aria-label={
            promptEpisode.episode.name ||
            t("library.episode", { number: number(promptEpisode.episode.number || 1) })
          }
        >
          <div className="card episode-resume-modal">
            <h3 className="modal-title">
              {promptEpisode.episode.name ||
                t("library.episode", { number: number(promptEpisode.episode.number || 1) })}
            </h3>
            <p className="modal-subtitle">
              {`${t("library.resume")} · ${clock(promptEpisode.resumeSeconds)}`}
            </p>
            <div className="modal-actions">
              <button
                type="button"
                className={`btn tonal ${promptAction === 0 ? "selected focused" : ""}`}
                onClick={() => {
                  const ep = promptEpisode.episode;
                  setPromptEpisode(null);
                  onPlayEpisode(ep, false);
                }}
              >
                <Icon name="play" />
                <span>{`${t("library.resume")} ${clock(promptEpisode.resumeSeconds)}`}</span>
              </button>
              <button
                type="button"
                className={`btn tonal ${promptAction === 1 ? "selected focused" : ""}`}
                onClick={() => {
                  const ep = promptEpisode.episode;
                  setPromptEpisode(null);
                  onPlayEpisode(ep, true);
                }}
              >
                <Icon name="refresh" />
                <span>{t("library.playFromBeginning")}</span>
              </button>
              <button
                type="button"
                className={`btn tonal modal-cancel ${promptAction === 2 ? "selected focused" : ""}`}
                onClick={() => setPromptEpisode(null)}
              >
                <span>{t("common.cancel")}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
