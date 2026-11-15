import { useEffect, useState } from "react";
import { useLocale } from "../hooks/useLocale";
import { KEY, useRemote } from "../hooks/useRemote";
import { programmeProgress } from "../services/epgBatch";
import type { ChannelGuide, LibraryLoadState } from "../stores/library";
import type { Channel } from "../types";
import { Icon } from "./Icon";
import { KeyGuide } from "./KeyGuide";

export type StartFocusId = "nowPlaying" | "tv" | "movies" | "series" | "search" | "settings";

export interface StartNowPlaying {
  title: string;
  subtitle?: string;
}

export interface StartPageProps {
  lastChannel?: Channel;
  guide?: ChannelGuide;
  nowPlaying?: StartNowPlaying | null;
  movieCategoriesCount?: number;
  seriesCategoriesCount?: number;
  movieCategoriesState?: LibraryLoadState;
  seriesCategoriesState?: LibraryLoadState;
  onResumePlayback?: () => void;
  onSelectTv: () => void;
  onSelectMovies: () => void;
  onSelectSeries: () => void;
  onSelectSearch: () => void;
  onSelectSettings: () => void;
  onExitApp: () => void;
  onPreloadKind?: (kind: "movie" | "series") => void;
}

export function StartPage({
  lastChannel,
  guide,
  nowPlaying,
  movieCategoriesCount = 0,
  seriesCategoriesCount = 0,
  movieCategoriesState = "empty",
  seriesCategoriesState = "empty",
  onResumePlayback,
  onSelectTv,
  onSelectMovies,
  onSelectSeries,
  onSelectSearch,
  onSelectSettings,
  onExitApp,
  onPreloadKind,
}: StartPageProps) {
  const { t, direction, number } = useLocale();
  const [focus, setFocus] = useState<StartFocusId>("tv");
  const hasNowPlaying = Boolean(nowPlaying && onResumePlayback);

  useEffect(() => {
    if (focus === "movies") onPreloadKind?.("movie");
    else if (focus === "series") onPreloadKind?.("series");
  }, [focus, onPreloadKind]);

  const nowSeconds = Math.floor(Date.now() / 1000);
  const currentProg = guide?.current;
  const progressRatio = currentProg ? programmeProgress(currentProg, nowSeconds) : 0;
  const progressPercent = Math.round(progressRatio * 100);

  const activate = (id: StartFocusId) => {
    switch (id) {
      case "nowPlaying":
        onResumePlayback?.();
        break;
      case "tv":
        onSelectTv();
        break;
      case "movies":
        onSelectMovies();
        break;
      case "series":
        onSelectSeries();
        break;
      case "search":
        onSelectSearch();
        break;
      case "settings":
        onSelectSettings();
        break;
    }
  };

  useRemote((code, event) => {
    if (code === KEY.BACK || code === KEY.ESC) {
      event.preventDefault();
      onExitApp();
      return;
    }

    if (code === KEY.ENTER) {
      event.preventDefault();
      activate(focus === "nowPlaying" && !hasNowPlaying ? "tv" : focus);
      return;
    }

    const inlineStart = direction === "rtl" ? KEY.RIGHT : KEY.LEFT;
    const inlineEnd = direction === "rtl" ? KEY.LEFT : KEY.RIGHT;

    if (code === KEY.UP) {
      event.preventDefault();
      if (focus === "search") setFocus("tv");
      else if (focus === "settings") setFocus("series");
      else if (hasNowPlaying && (focus === "tv" || focus === "movies" || focus === "series")) {
        setFocus("nowPlaying");
      }
      return;
    }

    if (code === KEY.DOWN) {
      event.preventDefault();
      if (focus === "nowPlaying") setFocus("tv");
      else if (focus === "tv" || focus === "movies") setFocus("search");
      else if (focus === "series") setFocus("settings");
      return;
    }

    if (code === inlineStart) {
      event.preventDefault();
      if (focus === "movies") setFocus("tv");
      else if (focus === "series") setFocus("movies");
      else if (focus === "settings") setFocus("search");
      return;
    }

    if (code === inlineEnd) {
      event.preventDefault();
      if (focus === "tv") setFocus("movies");
      else if (focus === "movies") setFocus("series");
      else if (focus === "search") setFocus("settings");
      return;
    }
  });

  return (
    <section id="view-home" className="view" aria-label="Start Page">
      <div className="home-logo brand-logo">
        <img src="./icon.svg" alt="" aria-hidden="true" />
        <h1>Zappa TV</h1>
      </div>

      {hasNowPlaying && nowPlaying && (
        <button
          type="button"
          className={`home-now-playing ${focus === "nowPlaying" ? "focused" : ""}`}
          aria-label={`${t("start.nowPlaying")}: ${nowPlaying.title}`}
          onClick={() => {
            setFocus("nowPlaying");
            onResumePlayback?.();
          }}
          onMouseEnter={() => setFocus("nowPlaying")}
        >
          <span className="home-now-playing-inner">
            <span className="home-now-badge">
              <Icon name="play" />
              <span>{t("start.nowPlaying")}</span>
            </span>
            <span className="home-now-meta">
              <strong>{nowPlaying.title}</strong>
              {nowPlaying.subtitle && <span>{nowPlaying.subtitle}</span>}
            </span>
            <span className="home-now-cta">{t("start.resumePlayback")}</span>
          </span>
        </button>
      )}

      <div className="home-tiles" id="home-tiles">
        {/* 1. Live TV Card */}
        <button
          type="button"
          className={`home-tile tile-tv ${focus === "tv" ? "focused" : ""}`}
          aria-label={t("start.liveTv")}
          onClick={() => {
            setFocus("tv");
            onSelectTv();
          }}
          onMouseEnter={() => setFocus("tv")}
        >
          <div className="home-tile-icon" aria-hidden="true">
            <Icon name="tv" />
          </div>
          <b>{t("start.liveTv")}</b>

          {lastChannel ? (
            <>
              <div className="home-tile-channel">
                {lastChannel.number > 0 && (
                  <span className="home-tile-badge">{lastChannel.number}</span>
                )}
                <span>{lastChannel.name}</span>
              </div>
              {currentProg && (
                <>
                  <div className="home-tile-prog">{currentProg.title}</div>
                  <div className="home-tile-progress-bar">
                    <div
                      className="home-tile-progress-fill"
                      style={{ width: `${progressPercent}%` }}
                    />
                  </div>
                </>
              )}
            </>
          ) : (
            <span className="home-tile-sub">{t("start.watchLive")}</span>
          )}
        </button>

        {/* 2 & 3. Movies & Series Pair */}
        <div className="home-pair">
          <button
            type="button"
            className={`home-tile half tile-movies ${focus === "movies" ? "focused" : ""}`}
            aria-label={t("start.movies")}
            onClick={() => {
              setFocus("movies");
              onSelectMovies();
            }}
            onMouseEnter={() => {
              setFocus("movies");
              onPreloadKind?.("movie");
            }}
          >
            <div className="home-vod-content">
              <div className="home-tile-icon" aria-hidden="true">
                <Icon name="movie" />
              </div>
              <b>{t("start.movies")}</b>
              <span className="home-tile-sub">
                {movieCategoriesCount > 0 ||
                movieCategoriesState === "loaded" ||
                movieCategoriesState === "empty"
                  ? t("start.categories", { count: number(movieCategoriesCount) })
                  : t(movieCategoriesState === "failed" ? "library.failed" : "library.loading")}
              </span>
            </div>
          </button>

          <button
            type="button"
            className={`home-tile half tile-series ${focus === "series" ? "focused" : ""}`}
            aria-label={t("start.series")}
            onClick={() => {
              setFocus("series");
              onSelectSeries();
            }}
            onMouseEnter={() => {
              setFocus("series");
              onPreloadKind?.("series");
            }}
          >
            <div className="home-vod-content">
              <div className="home-tile-icon" aria-hidden="true">
                <Icon name="series" />
              </div>
              <b>{t("start.series")}</b>
              <span className="home-tile-sub">
                {seriesCategoriesCount > 0 ||
                seriesCategoriesState === "loaded" ||
                seriesCategoriesState === "empty"
                  ? t("start.categories", { count: number(seriesCategoriesCount) })
                  : t(
                      seriesCategoriesState === "failed" ? "library.failed" : "library.loading",
                    )}
              </span>
            </div>
          </button>
        </div>
      </div>

      {/* 4 & 5. Bottom Action Row: Search & Settings */}
      <div className="home-foot" id="home-foot">
        <button
          type="button"
          className={`home-btn btn-search ${focus === "search" ? "focused" : ""}`}
          aria-label={t("start.search")}
          onClick={() => {
            setFocus("search");
            onSelectSearch();
          }}
          onMouseEnter={() => setFocus("search")}
        >
          <span className="ico" aria-hidden="true">
            <Icon name="search" />
          </span>
          <span className="hb-label">{t("start.search")}</span>
        </button>

        <button
          type="button"
          className={`home-btn btn-settings ${focus === "settings" ? "focused" : ""}`}
          aria-label={t("start.settings")}
          onClick={() => {
            setFocus("settings");
            onSelectSettings();
          }}
          onMouseEnter={() => setFocus("settings")}
        >
          <span className="ico" aria-hidden="true">
            <Icon name="settings" />
          </span>
          <span className="hb-label">{t("start.settings")}</span>
        </button>
      </div>

      <KeyGuide
        className="onboard-foot ruled"
        items={[
          { keys: ["\u2190", "\u2191", "\u2192", "\u2193"], label: t("common.move") },
          { keys: ["OK"], label: t("common.select") },
          { keys: ["Return"], label: t("common.closeApp") },
        ]}
      />
    </section>
  );
}
