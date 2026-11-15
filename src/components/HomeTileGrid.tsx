import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocale } from "../hooks/useLocale";
import { KEY, useRemote } from "../hooks/useRemote";
import { programmeProgress } from "../services/epgBatch";
import { wrap } from "../services/lineup";
import { dropQueuedWarming, warmChain } from "../services/logos";
import type { XtreamContentKind } from "../services/xtream";
import type { ChannelGuide } from "../stores/library";
import type { Channel } from "../types";
import { Icon } from "./Icon";
import { Logo } from "./Logo";
import { Text } from "./Text";

export const ROWS_VISIBLE = 3;
export const GROUP_TAB_WIDTH = 168;

const TILE_LOGO_BOX = {
  width: 96,
  height: 56,
} as const;

const MONOGRAM_PALETTE = [
  "#1f6feb",
  "#238636",
  "#8957e5",
  "#d29922",
  "#da3633",
  "#0969da",
  "#bf3989",
  "#2ea043",
] as const;

const EMPTY_SET: ReadonlySet<string> = new Set<string>();

export function monogramColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0;
  }
  return MONOGRAM_PALETTE[Math.abs(hash) % MONOGRAM_PALETTE.length];
}

export function monogramText(name: string): string {
  const cleaned = name.trim();
  if (!cleaned) return "TV";
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
  }
  return cleaned.slice(0, 2).toUpperCase();
}

/**
 * Compute adaptive column count (4, 5, or 6) from Samsung TV model diagonal
 * (`webapis.productinfo.getRealModel()`), defaulting to 6 columns on 48"+ or 1080p desktop.
 */
export function detectGridColumns(model?: string, viewportWidth?: number): 4 | 5 | 6 {
  const rawModel =
    model ??
    (
      window as unknown as {
        webapis?: { productinfo?: { getRealModel?: () => string } };
      }
    ).webapis?.productinfo?.getRealModel?.() ??
    "";

  if (rawModel) {
    const match = rawModel.match(/^[A-Z]{1,3}(\d{2})/i) ?? rawModel.match(/(\d{2})/);
    if (match?.[1]) {
      const inches = Number.parseInt(match[1], 10);
      if (inches > 0 && inches < 40) return 4;
      if (inches >= 40 && inches <= 47) return 5;
      if (inches >= 48) return 6;
    }
  }

  const width =
    viewportWidth ??
    (typeof window !== "undefined" && window.innerWidth ? window.innerWidth : 1920);
  if (width < 1280) return 4;
  if (width < 1600) return 5;
  return 6;
}

/**
 * Step the selected tile index across the grid with AssisTV wrap-around ergonomics.
 */
export function stepTileGrid(
  index: number,
  total: number,
  cols: number,
  direction: "left" | "right" | "up" | "down",
): number {
  if (total <= 0) return 0;
  const clamped = Math.max(0, Math.min(total - 1, index));
  if (direction === "left") {
    return clamped > 0 ? clamped - 1 : total - 1;
  }
  if (direction === "right") {
    return clamped < total - 1 ? clamped + 1 : 0;
  }
  const totalRows = Math.max(1, Math.ceil(total / cols));
  const row = Math.floor(clamped / cols);
  const col = clamped % cols;
  if (direction === "up") {
    const nextRow = row > 0 ? row - 1 : totalRows - 1;
    return Math.min(total - 1, nextRow * cols + col);
  }
  const nextRow = row < totalRows - 1 ? row + 1 : 0;
  return Math.min(total - 1, nextRow * cols + col);
}

export type HomeZone = "header" | "grid" | "groups";

export type HomeHeaderControl =
  | "live"
  | "movie"
  | "series"
  | "panel"
  | "search"
  | "settings"
  | "nowPlaying";

export interface HomeCategoryItem {
  key: string;
  name: string;
  count?: number;
  hidden?: boolean;
}

interface TileProps {
  channel: Channel;
  index: number;
  selected: boolean;
  playing: boolean;
  favourite: boolean;
  showNumbers: boolean;
  showLogos: boolean;
  settled: boolean;
  programmeTitle?: string;
  programmeProgress?: number;
  archiveDays?: number;
  onPick: (index: number) => void;
}

const HomeTile = memo(function HomeTile({
  channel,
  index,
  selected,
  playing,
  favourite,
  showNumbers,
  showLogos,
  settled,
  programmeTitle,
  programmeProgress: progProgress,
  archiveDays,
  onPick,
}: TileProps) {
  const { t } = useLocale();
  const displayName = channel.name || t("channel.unnamed");
  const monogramBg = useMemo(() => monogramColor(displayName), [displayName]);
  const monogramLabel = useMemo(() => monogramText(displayName), [displayName]);

  return (
    <button
      type="button"
      className={`home-tile ${selected ? "selected" : ""} ${playing ? "playing" : ""}`}
      onClick={() => onPick(index)}
    >
      <div className="home-tile-top">
        {showNumbers ? (
          <span className="home-tile-number">{String(channel.number)}</span>
        ) : (
          <span className="home-tile-number" />
        )}
        <div className="home-tile-badges">
          {favourite && (
            <span className="home-tile-star">
              <Icon name="star" />
            </span>
          )}
          {archiveDays !== undefined && archiveDays > 0 && (
            <span className="home-tile-archive">{`A${Math.min(99, archiveDays)}`}</span>
          )}
        </div>
      </div>

      <div className="home-tile-logo">
        {showLogos && channel.logo ? (
          <Logo
            src={channel.logo}
            alt={displayName}
            fetchable={settled}
            label={monogramLabel}
            width={TILE_LOGO_BOX.width}
            height={TILE_LOGO_BOX.height}
            className="home-tile-artwork"
          />
        ) : (
          <span className="home-tile-monogram" style={{ backgroundColor: monogramBg }}>
            {monogramLabel}
          </span>
        )}
      </div>

      <div className="home-tile-meta">
        <span className="home-tile-name">{displayName}</span>
        <span className="home-tile-now">{programmeTitle ?? "\u00A0"}</span>
      </div>

      <span className="home-tile-progress">
        <span
          className="home-tile-progress-fill"
          style={{
            width:
              progProgress !== undefined ? `${Math.round(progProgress * 100)}%` : "0%",
          }}
        />
      </span>
    </button>
  );
});

export interface HomeTileGridProps {
  channels: Channel[];
  categories: readonly HomeCategoryItem[];
  category?: number;
  index?: number;
  zone?: HomeZone;
  headerControl?: HomeHeaderControl;
  contentKind?: XtreamContentKind;
  xtreamAvailable?: boolean;
  playingId?: string;
  favourites?: ReadonlySet<string>;
  guides?: Record<string, ChannelGuide>;
  showNumbers?: boolean;
  showLogos?: boolean;
  listenKeys?: boolean;
  model?: string;
  viewportWidth?: number;
  onSelectChannel?: (index: number, channel?: Channel) => void;
  onMoveIndex?: (index: number) => void;
  onSelectCategory?: (categoryIndex: number) => void;
  onChangeZone?: (zone: HomeZone) => void;
  onChangeContent?: (kind: XtreamContentKind) => void;
  onToggleViewMode?: () => void;
  onOpenSearch?: () => void;
  onOpenSettings?: () => void;
  onResumePlayback?: () => void;
  nowPlayingTitle?: string;
  onClose?: () => void;
  onPrefetchBatchEpg?: (channels: readonly Channel[]) => void;
}

export const HomeTileGrid = memo(function HomeTileGrid({
  channels,
  categories,
  category: categoryProp,
  index: indexProp,
  zone: zoneProp,
  headerControl: headerControlProp,
  contentKind = "live",
  xtreamAvailable = false,
  playingId = "",
  favourites = EMPTY_SET,
  guides,
  showNumbers = true,
  showLogos = true,
  listenKeys = true,
  model,
  viewportWidth,
  onSelectChannel,
  onMoveIndex,
  onSelectCategory,
  onChangeZone,
  onChangeContent,
  onToggleViewMode,
  onOpenSearch,
  onOpenSettings,
  onResumePlayback,
  nowPlayingTitle,
  onClose,
  onPrefetchBatchEpg,
}: HomeTileGridProps) {
  const { t } = useLocale();
  const cols = useMemo(
    () => detectGridColumns(model, viewportWidth),
    [model, viewportWidth],
  );

  const [internalCategory, setInternalCategory] = useState(categoryProp ?? 0);
  const [internalIndex, setInternalIndex] = useState(indexProp ?? 0);
  const [internalZone, setInternalZone] = useState<HomeZone>(zoneProp ?? "grid");

  const headerControls = useMemo<HomeHeaderControl[]>(() => {
    const list: HomeHeaderControl[] = [];
    if (xtreamAvailable) {
      list.push("live", "movie", "series");
    }
    if (onToggleViewMode) list.push("panel");
    list.push("search", "settings");
    if (onResumePlayback) list.push("nowPlaying");
    return list;
  }, [onResumePlayback, onToggleViewMode, xtreamAvailable]);

  const [internalHeaderControl, setInternalHeaderControl] = useState<HomeHeaderControl>(
    headerControlProp ?? headerControls[0] ?? "search",
  );

  useEffect(() => {
    if (categoryProp !== undefined) setInternalCategory(categoryProp);
  }, [categoryProp]);

  useEffect(() => {
    if (indexProp !== undefined) setInternalIndex(indexProp);
  }, [indexProp]);

  useEffect(() => {
    if (zoneProp !== undefined) setInternalZone(zoneProp);
  }, [zoneProp]);

  useEffect(() => {
    if (headerControlProp !== undefined) setInternalHeaderControl(headerControlProp);
  }, [headerControlProp]);

  const activeCategory = categoryProp ?? internalCategory;
  const activeIndex = indexProp ?? internalIndex;
  const activeZone = zoneProp ?? internalZone;
  const activeHeaderControl = headerControlProp ?? internalHeaderControl;

  const clampedIndex = Math.max(0, Math.min(Math.max(0, channels.length - 1), activeIndex));
  const totalRows = Math.max(1, Math.ceil(channels.length / cols));
  const currentRow = Math.floor(clampedIndex / cols);

  const startRowRef = useRef(0);
  if (currentRow < startRowRef.current) {
    startRowRef.current = currentRow;
  } else if (currentRow >= startRowRef.current + ROWS_VISIBLE) {
    startRowRef.current = currentRow - ROWS_VISIBLE + 1;
  }
  const maxStartRow = Math.max(0, totalRows - ROWS_VISIBLE);
  if (startRowRef.current > maxStartRow) {
    startRowRef.current = maxStartRow;
  }
  const startRow = startRowRef.current;

  const visibleStart = startRow * cols;
  const visibleEnd = Math.min(channels.length, (startRow + ROWS_VISIBLE) * cols);
  const visibleChannels = useMemo(
    () => channels.slice(visibleStart, visibleEnd),
    [channels, visibleStart, visibleEnd],
  );

  const [settled, setSettled] = useState(true);
  useEffect(() => {
    if (!channels.length) {
      setSettled(true);
      return;
    }
    setSettled(false);
    const timer = window.setTimeout(() => setSettled(true), 120);
    return () => window.clearTimeout(timer);
  }, [channels]);

  // Trigger batch EPG fetch for currently visible tile window + 1 row buffer.
  useEffect(() => {
    if (!onPrefetchBatchEpg || !channels.length) return;
    const bufferEnd = Math.min(channels.length, (startRow + ROWS_VISIBLE + 1) * cols);
    const slice = channels.slice(visibleStart, bufferEnd);
    if (slice.length > 0) {
      onPrefetchBatchEpg(slice);
    }
  }, [channels, cols, onPrefetchBatchEpg, startRow, visibleStart]);

  // Warm logos for the next row buffer when idle.
  useEffect(() => {
    if (!showLogos || !settled || !channels.length) return;
    dropQueuedWarming();
    const bufferEnd = Math.min(channels.length, (startRow + ROWS_VISIBLE + 1) * cols);
    const urls: string[] = [];
    for (let i = visibleEnd; i < bufferEnd; i++) {
      const logo = channels[i]?.logo;
      if (logo) urls.push(logo);
    }
    return warmChain(urls, { delay: 80, timeout: 400 });
  }, [channels, cols, settled, showLogos, startRow, visibleEnd]);

  const updateZone = useCallback(
    (nextZone: HomeZone) => {
      setInternalZone(nextZone);
      onChangeZone?.(nextZone);
    },
    [onChangeZone],
  );

  const updateIndex = useCallback(
    (nextIndex: number) => {
      setInternalIndex(nextIndex);
      onMoveIndex?.(nextIndex);
    },
    [onMoveIndex],
  );

  const updateCategory = useCallback(
    (nextCategory: number) => {
      if (!categories.length) return;
      const wrapped = wrap(nextCategory, categories.length);
      setInternalCategory(wrapped);
      setInternalIndex(0);
      startRowRef.current = 0;
      onSelectCategory?.(wrapped);
    },
    [categories.length, onSelectCategory],
  );

  const handleTilePick = useCallback(
    (tileIndex: number) => {
      updateZone("grid");
      updateIndex(tileIndex);
      onSelectChannel?.(tileIndex, channels[tileIndex]);
    },
    [channels, onSelectChannel, updateIndex, updateZone],
  );

  const onKey = useCallback(
    (code: number, event: KeyboardEvent) => {
      if (!listenKeys) return;

      if (code === KEY.CH_UP) {
        event.preventDefault();
        updateZone("header");
        return;
      }
      if (code === KEY.CH_DOWN) {
        event.preventDefault();
        if (categories.length > 0) updateZone("groups");
        return;
      }

      if (activeZone === "header") {
        if (code === KEY.LEFT) {
          event.preventDefault();
          const pos = Math.max(0, headerControls.indexOf(activeHeaderControl));
          const prev = headerControls[wrap(pos - 1, headerControls.length)];
          if (prev) setInternalHeaderControl(prev);
          return;
        }
        if (code === KEY.RIGHT) {
          event.preventDefault();
          const pos = Math.max(0, headerControls.indexOf(activeHeaderControl));
          const next = headerControls[wrap(pos + 1, headerControls.length)];
          if (next) setInternalHeaderControl(next);
          return;
        }
        if (code === KEY.DOWN) {
          event.preventDefault();
          updateZone("grid");
          return;
        }
        if (code === KEY.ENTER) {
          event.preventDefault();
          if (
            activeHeaderControl === "live" ||
            activeHeaderControl === "movie" ||
            activeHeaderControl === "series"
          ) {
            onChangeContent?.(activeHeaderControl);
          } else if (activeHeaderControl === "panel") {
            onToggleViewMode?.();
          } else if (activeHeaderControl === "search") {
            onOpenSearch?.();
          } else if (activeHeaderControl === "settings") {
            onOpenSettings?.();
          } else if (activeHeaderControl === "nowPlaying") {
            onResumePlayback?.();
          }
          return;
        }
        if (code === KEY.BACK || code === KEY.ESC) {
          event.preventDefault();
          updateZone("grid");
          return;
        }
        return;
      }

      if (activeZone === "groups") {
        if (code === KEY.LEFT) {
          event.preventDefault();
          updateCategory(activeCategory - 1);
          return;
        }
        if (code === KEY.RIGHT) {
          event.preventDefault();
          updateCategory(activeCategory + 1);
          return;
        }
        if (code === KEY.UP || code === KEY.ENTER || code === KEY.BACK || code === KEY.ESC) {
          event.preventDefault();
          updateZone("grid");
          return;
        }
        return;
      }

      // activeZone === "grid"
      if (code === KEY.LEFT) {
        event.preventDefault();
        updateIndex(stepTileGrid(clampedIndex, channels.length, cols, "left"));
        return;
      }
      if (code === KEY.RIGHT) {
        event.preventDefault();
        updateIndex(stepTileGrid(clampedIndex, channels.length, cols, "right"));
        return;
      }
      if (code === KEY.UP) {
        event.preventDefault();
        updateIndex(stepTileGrid(clampedIndex, channels.length, cols, "up"));
        return;
      }
      if (code === KEY.DOWN) {
        event.preventDefault();
        updateIndex(stepTileGrid(clampedIndex, channels.length, cols, "down"));
        return;
      }
      if (code === KEY.ENTER) {
        event.preventDefault();
        onSelectChannel?.(clampedIndex, channels[clampedIndex]);
        return;
      }
      if (code === KEY.BACK || code === KEY.ESC) {
        event.preventDefault();
        onClose?.();
      }
    },
    [
      activeCategory,
      activeHeaderControl,
      activeZone,
      categories.length,
      channels,
      clampedIndex,
      cols,
      headerControls,
      listenKeys,
      onChangeContent,
      onClose,
      onOpenSearch,
      onOpenSettings,
      onSelectChannel,
      onToggleViewMode,
      updateCategory,
      updateIndex,
      updateZone,
    ],
  );

  useRemote(onKey);

  const activeCategoryIndex = Math.max(
    0,
    Math.min(Math.max(0, categories.length - 1), activeCategory),
  );
  const pillOffset = activeCategoryIndex * GROUP_TAB_WIDTH;

  return (
    <div className="home-view" data-zone={activeZone}>
      {/* Zone 1: Header */}
      <div className={`home-header ${activeZone === "header" ? "focused" : ""}`}>
        <div className="brand">
          <img className="brand-mark" src="./icon.svg" alt="" aria-hidden="true" />
          <p className="rail-brand">Zappa TV</p>
        </div>

        {xtreamAvailable && (
          <div className="home-content-tabs">
            {(["live", "movie", "series"] as const).map((kind) => (
              <button
                key={kind}
                type="button"
                className={`home-header-btn ${contentKind === kind ? "active" : ""} ${
                  activeZone === "header" && activeHeaderControl === kind ? "selected" : ""
                }`}
                onClick={() => onChangeContent?.(kind)}
              >
                {t(
                  kind === "live"
                    ? "content.live"
                    : kind === "movie"
                      ? "content.movies"
                      : "content.series",
                )}
              </button>
            ))}
          </div>
        )}

        <div className="home-header-actions">
          {onToggleViewMode && (
            <button
              type="button"
              className={`home-header-btn ${
                activeZone === "header" && activeHeaderControl === "panel" ? "selected" : ""
              }`}
              onClick={onToggleViewMode}
              aria-label={t("common.allChannels")}
            >
              <Icon name="categories" />
              <span>{t("common.allChannels")}</span>
            </button>
          )}
          <button
            type="button"
            className={`home-header-btn ${
              activeZone === "header" && activeHeaderControl === "search" ? "selected" : ""
            }`}
            onClick={() => onOpenSearch?.()}
            aria-label={t("common.search")}
          >
            <Icon name="search" />
            <span>{t("common.search")}</span>
          </button>
          <button
            type="button"
            className={`home-header-btn ${
              activeZone === "header" && activeHeaderControl === "settings" ? "selected" : ""
            }`}
            onClick={() => onOpenSettings?.()}
            aria-label={t("common.settings")}
          >
            <Icon name="settings" />
            <span>{t("common.settings")}</span>
          </button>
          {onResumePlayback && (
            <button
              type="button"
              className={`home-header-btn home-header-now-playing ${
                activeZone === "header" && activeHeaderControl === "nowPlaying" ? "selected" : ""
              }`}
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
          )}
        </div>
      </div>

      {/* Zone 2: Adaptive 4-6 Column Tile Grid (max ROWS_VISIBLE * cols <= 18 tiles mounted) */}
      <div
        className={`home-grid cols-${cols} ${activeZone === "grid" ? "focused" : ""}`}
        style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
        data-columns={cols}
      >
        {visibleChannels.map((channel, offset) => {
          const tileIndex = visibleStart + offset;
          const chGuide = guides?.[channel.id];
          const currentProg = chGuide?.current;
          const progProgress = currentProg ? programmeProgress(currentProg) : undefined;
          return (
            <HomeTile
              key={channel.id}
              channel={channel}
              index={tileIndex}
              selected={activeZone === "grid" && tileIndex === clampedIndex}
              playing={channel.id === playingId}
              favourite={favourites.has(channel.id)}
              showNumbers={showNumbers}
              showLogos={showLogos}
              settled={settled}
              programmeTitle={currentProg?.title}
              programmeProgress={progProgress}
              archiveDays={channel.xtream?.archiveDays}
              onPick={handleTilePick}
            />
          );
        })}
      </div>

      {/* Zone 3: AssisTV Skewed Parallelogram Group Ribbon */}
      {categories.length > 0 && (
        <div className={`home-groups ${activeZone === "groups" ? "focused" : ""}`}>
          <div className="home-groups-track">
            <div
              className="home-groups-pill"
              style={{
                width: `${GROUP_TAB_WIDTH}px`,
                transform: `translateX(${pillOffset}px) skewX(-20deg)`,
              }}
            />
            {categories.map((cat, idx) => (
              <button
                key={cat.key}
                type="button"
                className={`home-group-tab ${idx === activeCategoryIndex ? "active" : ""} ${
                  activeZone === "groups" && idx === activeCategoryIndex ? "selected" : ""
                }`}
                style={{ width: `${GROUP_TAB_WIDTH}px` }}
                onClick={() => {
                  updateZone("groups");
                  updateCategory(idx);
                }}
              >
                <span className="home-group-label">{cat.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
});
