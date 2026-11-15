import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useLocale } from "../hooks/useLocale";
import { KEY, useRemote } from "../hooks/useRemote";
import { useScrollWindow } from "../hooks/useScrollWindow";
import { CATALOG_PHASE_LABELS } from "../services/catalogProgress";
import { catalogPaint } from "../services/catalogTiming";
import { titleLetter } from "../services/catalogTitle";
import {
  POSTER_GAP,
  POSTER_HEIGHT,
  POSTER_WIDTH,
  VOD_COLUMNS,
  VOD_ROW_HEIGHT,
} from "../services/vodMetrics";
import { useLibrary } from "../stores/library";
import { usePersonal } from "../stores/personal";
import { isCategoryLocked, useSettings } from "../stores/settings";
import { useParentalSession } from "../stores/parental";
import { useVodBrowse, useVodField } from "../stores/vodBrowse";
import { type ShapedVodItem, searchKey } from "../workers/vodWorker";
import { BrowseStatus } from "./BrowseStatus";
import { Icon } from "./Icon";
import { PinModal } from "./PinModal";
import { Poster } from "./Poster";
import { KeyGuide } from "./KeyGuide";
import { SearchField } from "./SearchField";

export interface VodViewProps {
  active?: boolean;
  initialKind?: "movie" | "series";
  onPlayMovie: (movie: ShapedVodItem) => void;
  onOpenSeries: (series: ShapedVodItem) => void;
  onBack: () => void;
  onKindChange?: (kind: "movie" | "series") => void;
  onToggleLayout?: () => void;
  onSettings?: () => void;
  onResumePlayback?: () => void;
  onToggleFavourite?: (item: ShapedVodItem) => void;
}

const ALPHABET = [
  "A",
  "B",
  "C",
  "D",
  "E",
  "F",
  "G",
  "H",
  "I",
  "J",
  "K",
  "L",
  "M",
  "N",
  "O",
  "P",
  "Q",
  "R",
  "S",
  "T",
  "U",
  "V",
  "W",
  "X",
  "Y",
  "Z",
  "#",
];

const COLUMNS = VOD_COLUMNS;

export const VodView: React.FC<VodViewProps> = ({
  active = true,
  initialKind = "movie",
  onPlayMovie,
  onOpenSeries,
  onBack,
  onKindChange,
  onToggleLayout,
  onSettings,
  onResumePlayback,
  onToggleFavourite,
}) => {
  const { t, direction, number, locale } = useLocale();
  const settings = useSettings();
  const fontSize = settings.fontSizeId;
  const inlineStart = direction === "rtl" ? KEY.RIGHT : KEY.LEFT;
  const inlineEnd = direction === "rtl" ? KEY.LEFT : KEY.RIGHT;
  const [localKind, setLocalKind] = useState(initialKind);
  const kind = onKindChange ? initialKind : localKind;
  useEffect(() => {
    setLocalKind(initialKind);
  }, [initialKind]);
  const setKind = (next: "movie" | "series") => {
    if (next !== kind) {
      for (const target of [kind, next]) {
        const saved = useVodBrowse.getState()[target].searchReturn;
        useVodBrowse.getState().update(target, {
          searchOpen: false,
          query: "",
          searchReturn: null,
          ...(saved
            ? { selectedKey: saved.key, gridIndex: saved.index, scrollTop: saved.top }
            : {}),
        });
      }
    }
    if (onKindChange) onKindChange(next);
    else setLocalKind(next);
  };
  const [selectedGroup, setSelectedGroup] = useVodField(kind, "selectedGroup");
  const [sortMode, setSortMode] = useVodField(kind, "sortMode");
  const [focusZone, setFocusZone] = useVodField(kind, "focusZone");
  const [categoryIndex, setCategoryIndex] = useVodField(kind, "categoryIndex");
  const [gridIndex, setGridIndex] = useVodField(kind, "gridIndex");
  const [alphabetIndex, setAlphabetIndex] = useVodField(kind, "alphabetIndex");
  const [tabIndex, setTabIndex] = useVodField(kind, "tabIndex");
  const [favouritesOnly, setFavouritesOnly] = useVodField(kind, "favouritesOnly");
  const [resumeOnly, setResumeOnly] = useVodField(kind, "resumeOnly");
  const [query, setQuery] = useVodField(kind, "query");
  const [searchOpen, setSearchOpen] = useVodField(kind, "searchOpen");
  const [appliedQuery, setAppliedQuery] = useState(query);
  const queryKind = useRef(kind);
  useEffect(() => {
    if (queryKind.current !== kind) {
      queryKind.current = kind;
      setAppliedQuery(query);
      return;
    }
    if (!searchOpen) {
      setAppliedQuery(query);
      return;
    }
    if (query === appliedQuery) return;
    const timer = setTimeout(() => {
      setAppliedQuery(query);
      setGridIndex(0);
    }, 150);
    return () => clearTimeout(timer);
  }, [query, appliedQuery, kind, setGridIndex, searchOpen]);
  const restoreSearchTop = useRef<number | null>(null);

  const selectedKey = useVodBrowse((state) => state[kind].selectedKey);
  const savedScroll = useVodBrowse((state) => state[kind].scrollTop);
  const favourites = usePersonal((state) => state.favourites);
  const progress = usePersonal((state) => state.progress);
  const seriesDetails = useLibrary((state) => state.seriesDetails);
  const sourceKey = useLibrary((state) => state.sourceKey);
  const frame = useLibrary((state) => state.searchItems[kind]);
  useLayoutEffect(() => {
    useVodBrowse.getState().selectSource(sourceKey || "preview");
  }, [sourceKey]);

  const catalogs = useLibrary((s) => s.catalogs);
  const vodItems = useLibrary((s) => s.vodItems);
  const seriesItems = useLibrary((s) => s.seriesItems);
  const vodGroups = useLibrary((s) => s.vodGroups);
  const seriesGroups = useLibrary((s) => s.seriesGroups);
  const loadProgress = useLibrary((s) => s.catalogProgress[kind]);
  const headings = useLibrary((s) => s.categories[kind].items);
  const loadVodCatalog = useLibrary((s) => s.loadVodCatalog);

  const gridBoxRef = useRef<HTMLDivElement>(null);
  const catsBoxRef = useRef<HTMLDivElement>(null);

  // Load catalog on mount or when switching kind
  useEffect(() => {
    void loadVodCatalog(kind, false, true);
  }, [kind, loadVodCatalog]);

  const rawItems = kind === "movie" ? vodItems : seriesItems;
  const rawGroups = kind === "movie" ? vodGroups : seriesGroups;
  const groups = useMemo(
    () =>
      rawGroups.length
        ? rawGroups
        : headings.map((group) => ({ id: group.id, name: group.name, count: group.count })),
    [rawGroups, headings],
  );
  const loading =
    frame.state === "loading" ||
    loadProgress.state === "loading" ||
    (!catalogs[kind] && loadProgress.state === "idle" && frame.state !== "failed");
  const phaseText = t(CATALOG_PHASE_LABELS[loadProgress.phase]);

  const resumeKeys = useMemo(() => {
    const activeProgress = progress.filter(
      (p) => p.seconds > 0 && (!p.duration || p.seconds < p.duration * 0.95),
    );
    if (!activeProgress.length) return new Set<string>();

    const progressKeys = new Set(activeProgress.map((p) => p.itemKey));
    const set = new Set<string>();
    const items = catalogs[kind]?.items ?? rawItems;

    for (const item of items) {
      if (kind === "movie") {
        const streamId = item.streamId;
        const matched =
          progressKeys.has(item.key) ||
          (streamId &&
            activeProgress.some(
              (p) =>
                p.itemKey.endsWith(`:movie:${streamId}`) ||
                p.itemKey === `movie:${streamId}` ||
                p.itemKey === `v${streamId}` ||
                p.itemKey === streamId,
            ));
        if (matched) set.add(item.key);
      } else {
        const seriesId = item.seriesId;
        const matched =
          progressKeys.has(item.key) ||
          activeProgress.some(
            (p) =>
              (seriesId &&
                (p.itemKey.includes(`:series:${seriesId}`) ||
                  p.itemKey.startsWith(`s${seriesId}:`) ||
                  p.itemKey === `s${seriesId}` ||
                  p.itemKey === seriesId)) ||
              p.itemKey.startsWith(`${item.key}:`) ||
              p.itemKey.includes(item.key),
          ) ||
          Boolean(seriesDetails[item.key]?.value?.episodes.some((ep) => progressKeys.has(ep.key)));
        if (matched) set.add(item.key);
      }
    }
    return set;
  }, [progress, catalogs, kind, rawItems, seriesDetails]);

  const owner = catalogs[kind];

  // Build categories list: All first, then Resume, Favourites, then groups with items
  const categoryList = useMemo(() => {
    const list: {
      id: string | null;
      name: string;
      count?: number;
      favourite?: boolean;
      resume?: boolean;
    }[] = [
      {
        id: null,
        name: t(kind === "movie" ? "library.allMovies" : "library.allSeries"),
        count: catalogs[kind]
          ? catalogs[kind]!.items.length
          : loading
            ? loadProgress.total || undefined
            : rawItems.length,
      },
    ];
    const favouritesCount = favourites.filter(
      (item) => item.kind === kind && catalogs[kind]?.byKey.has(item.itemKey),
    ).length;
    list.push({
      id: null,
      name: t("channel.favourites"),
      count: favouritesCount,
      favourite: true,
    });
    list.push({
      id: null,
      name: t("library.resume"),
      count: resumeKeys.size,
      resume: true,
    });
    for (const g of groups) {
      if (g.count === 0) continue;
      if (owner) {
        const count = owner.query(g.id).length;
        if (count > 0) {
          list.push({ id: g.id, name: g.name, count });
        }
      } else if (!loading) {
        const count =
          g.count !== undefined
            ? g.count
            : rawItems.filter((item) => (item.categoryId ?? "") === g.id).length;
        if (count > 0) {
          list.push({ id: g.id, name: g.name, count });
        }
      } else {
        list.push({ id: g.id, name: g.name, count: g.count });
      }
    }
    return list;
  }, [
    groups,
    rawItems,
    loading,
    loadProgress.total,
    kind,
    favourites,
    resumeKeys.size,
    catalogs,
    owner,
    t,
  ]);
  const favouriteKeys = useMemo(
    () => new Set(favourites.filter((item) => item.kind === kind).map((item) => item.itemKey)),
    [favourites, kind],
  );
  const searchTerm = searchKey(queryKind.current === kind ? appliedQuery : query);
  const filteredItems = useMemo(() => {
    let items = owner
      ? owner.query(selectedGroup, sortMode)
      : selectedGroup !== null
        ? rawItems.filter((item) => item.categoryId === selectedGroup)
        : rawItems;
    if (searchOpen) {
      if (searchTerm) items = items.filter((item) => item.skey.includes(searchTerm));
    }
    if (favouritesOnly) return items.filter((item) => favouriteKeys.has(item.key));
    if (resumeOnly) return items.filter((item) => resumeKeys.has(item.key));
    return items;
  }, [
    owner,
    selectedGroup,
    sortMode,
    rawItems,
    favouritesOnly,
    favouriteKeys,
    resumeOnly,
    resumeKeys,
    searchOpen,
    searchTerm,
  ]);
  const availableLetters = useMemo(
    () =>
      owner
        ? owner.availableLetters(filteredItems as ReturnType<typeof owner.query>)
        : new Set<string>(),
    [owner, filteredItems],
  );

  // A list/grid transition may change the category without mounting this rail.
  // Remap only when its model changes; held-key cursor moves remain debounced.
  useLayoutEffect(() => {
    if (!owner) return;
    const saved = useVodBrowse.getState()[kind];
    const at = categoryList.findIndex((category) =>
      saved.favouritesOnly
        ? category.favourite
        : saved.resumeOnly
          ? category.resume
          : !category.favourite && !category.resume && category.id === saved.selectedGroup,
    );
    setCategoryIndex(Math.max(0, at));
    if (at < 0) {
      setSelectedGroup(null);
      setFavouritesOnly(false);
      setResumeOnly(false);
    }
  }, [kind, owner, categoryList, setCategoryIndex, setSelectedGroup, setFavouritesOnly, setResumeOnly]);

  // Clamped focused item
  const restoredIndex =
    selectedKey && filteredItems[gridIndex]?.key !== selectedKey
      ? owner
        ? owner.indexOfKey(filteredItems, selectedKey)
        : filteredItems.findIndex((item) => item.key === selectedKey)
      : gridIndex;
  const safeGridIndex = Math.min(
    Math.max(0, restoredIndex < 0 ? gridIndex : restoredIndex),
    Math.max(0, filteredItems.length - 1),
  );
  const focusedItem = filteredItems[safeGridIndex] || null;
  const isFavourite = !!focusedItem && favouriteKeys.has(focusedItem.key);

  const state =
    frame.state === "failed"
      ? "failed"
      : owner
        ? filteredItems.length
          ? "loaded"
          : "empty"
        : loadProgress.state === "loaded"
          ? "empty"
          : "loading";
  useEffect(() => {
    if (!active || !owner || state !== "loaded") return;
    const start = performance.now();
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => catalogPaint(kind, performance.now() - start));
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, [active, kind, owner, state]);
  const retry = () => {
    void loadVodCatalog(kind, true, true);
  };
  useLayoutEffect(() => {
    if (state === "loading" && selectedKey && restoredIndex < 0) return;
    useVodBrowse
      .getState()
      .update(kind, { gridIndex: safeGridIndex, selectedKey: focusedItem?.key ?? "" });
  }, [kind, safeGridIndex, focusedItem?.key, state, selectedKey, restoredIndex]);
  useEffect(() => {
    if (state === "failed" && !filteredItems.length) setFocusZone("status");
  }, [state, filteredItems.length, setFocusZone]);
  useEffect(() => {
    if (selectedGroup !== null && !groups.some((group) => group.id === selectedGroup)) {
      setSelectedGroup(null);
      setGridIndex(0);
    }
  }, [groups, selectedGroup, setSelectedGroup, setGridIndex]);

  // Cycle sort mode
  const cycleSort = useCallback(() => {
    setSortMode((prev) => {
      if (prev === "added") return "name";
      if (prev === "name") return "year";
      if (prev === "year") return "rating";
      return "added";
    });
    setGridIndex(0);
  }, [setSortMode, setGridIndex]);

  // Jump to letter in grid
  const jumpToLetter = useCallback(
    (letter: string) => {
      const visibleKeys = new Set(filteredItems.map((item) => item.key));
      const ordered =
        owner && sortMode !== "name"
          ? owner.query(selectedGroup, "name").filter((item) => visibleKeys.has(item.key))
          : filteredItems;
      const targetIndex = owner
        ? owner.letterIndex(ordered, letter)
        : ordered.findIndex((item) => titleLetter(item.name) === letter);
      if (targetIndex !== -1) {
        useVodBrowse.getState().update(kind, {
          sortMode: "name",
          gridIndex: targetIndex,
          selectedKey: ordered[targetIndex].key,
          focusZone: "grid",
        });
      }
    },
    [filteredItems, owner, sortMode, searchOpen, selectedGroup, kind],
  );

  const gridWindow = useScrollWindow(
    gridBoxRef,
    filteredItems.length,
    safeGridIndex,
    COLUMNS,
    VOD_ROW_HEIGHT,
    filteredItems,
    `${state}:${locale}:${fontSize}`,
    savedScroll,
  );
  const categoryWindow = useScrollWindow(
    catsBoxRef,
    categoryList.length,
    categoryIndex,
    1,
    62,
    categoryList,
  );
  const session = useParentalSession();
  const [pinPrompt, setPinPrompt] = useState<number | null>(null);

  const activateCategory = (at: number) => {
    const category = categoryList[at];
    if (!category) return;
    const isLocked =
      !session.unlocked &&
      isCategoryLocked(
        category.id ?? "",
        category.name,
        settings.parentalPin,
        settings.lockedCategoryKeys,
      );
    if (isLocked) {
      setPinPrompt(at);
      return;
    }
    useVodBrowse.getState().update(kind, {
      categoryIndex: at,
      selectedGroup: category.id,
      favouritesOnly: !!category.favourite,
      resumeOnly: !!category.resume,
      gridIndex: 0,
      selectedKey: "",
      scrollTop: 0,
      focusZone: "grid",
      searchOpen: false,
      query: "",
      searchReturn: null,
    });
  };
  useEffect(() => {
    useVodBrowse.getState().update(kind, { scrollTop: gridWindow.top });
  }, [kind, gridWindow.top]);
  useLayoutEffect(() => {
    if (!active) return;
    const root = document.getElementById("view-vod");
    root
      ?.querySelector<HTMLElement>(
        focusZone === "search"
          ? "input"
          : focusZone === "status"
            ? ".browse-status button"
            : ".focused",
      )
      ?.focus();
  }, [active, focusZone, safeGridIndex, categoryIndex, tabIndex, alphabetIndex, state]);
  const openGridSearch = () => {
    const state = useVodBrowse.getState();
    if (!searchOpen)
      state.update(kind, {
        query: "",
        searchReturn: { key: selectedKey, index: safeGridIndex, top: gridWindow.top },
      });
    setSearchOpen(true);
    setFocusZone("search");
  };
  const closeGridSearch = () => {
    const saved = useVodBrowse.getState()[kind].searchReturn;
    useVodBrowse.getState().update(kind, {
      searchOpen: false,
      query: "",
      searchReturn: null,
      focusZone: "grid",
      tabIndex: 3,
      ...(saved
        ? { selectedKey: saved.key, gridIndex: saved.index, scrollTop: saved.top }
        : {}),
    });
    restoreSearchTop.current = saved?.top ?? null;
  };
  useLayoutEffect(() => {
    if (!searchOpen && restoreSearchTop.current !== null && gridBoxRef.current) {
      gridBoxRef.current.scrollTop = restoreSearchTop.current;
      restoreSearchTop.current = null;
      gridWindow.onScroll();
    }
  });
  const tools: readonly (readonly [string, string])[] = onResumePlayback
    ? [
        ["movie", t("content.movies")],
        ["series", t("content.series")],
        ["layout", t("library.listView")],
        ["search", t("common.search")],
        ["settings", t("common.settings")],
        ["nowPlaying", t("library.backToPlayer")],
      ]
    : [
        ["movie", t("content.movies")],
        ["series", t("content.series")],
        ["layout", t("library.listView")],
        ["search", t("common.search")],
        ["settings", t("common.settings")],
      ];
  const activateTool = (at: number) => {
    if (at < 2) {
      const next = at === 0 ? "movie" : "series";
      useVodBrowse.getState().update(next, { focusZone: "tabs", tabIndex: at });
      setKind(next);
    } else if (at === 2) {
      setFocusZone("grid");
      onToggleLayout?.();
    } else if (at === 3) openGridSearch();
    else if (at === 4) onSettings?.();
    else if (at === 5) onResumePlayback?.();
  };

  // Remote key navigation
  useRemote((code, event) => {
    if (!active || event.defaultPrevented) return;
    if (focusZone === "search" && !(event.target instanceof Node)) return;
    if (code === KEY.GRID) {
      event.preventDefault();
      setFocusZone("grid");
      onToggleLayout?.();
      return;
    }
    if (code === KEY.GREEN && focusedItem) {
      event.preventDefault();
      onToggleFavourite?.(focusedItem);
      return;
    }
    if (focusZone === "status" && code === KEY.ENTER) {
      event.preventDefault();
      retry();
      return;
    }
    if (focusZone === "status" && (code === KEY.UP || code === KEY.DOWN)) {
      event.preventDefault();
      setFocusZone("tabs");
      return;
    }
    if (code === KEY.YELLOW) {
      event.preventDefault();
      cycleSort();
      return;
    }

    if (code === KEY.BACK || code === KEY.ESC) {
      event.preventDefault();
      if (searchOpen) {
        closeGridSearch();
        return;
      }
      if (loading) {
        // This view detaches immediately; the source-owned shared request stays
        // available to other consumers and a subsequent reopen.
        onBack();
        return;
      }
      if (focusZone === "alphabet") {
        setFocusZone("grid");
      } else {
        onBack();
      }
      return;
    }

    if (focusZone === "search") return;
    if (focusZone === "tabs") {
      if (code === inlineStart || code === inlineEnd) {
        event.preventDefault();
        const next = Math.max(
          0,
          Math.min(tools.length - 1, tabIndex + (code === inlineStart ? -1 : 1)),
        );
        setTabIndex(next);
      } else if (code === KEY.ENTER) {
        event.preventDefault();
        activateTool(tabIndex);
      } else if (code === KEY.DOWN) {
        event.preventDefault();
        setFocusZone(
          searchOpen
            ? "search"
            : state === "failed" && !filteredItems.length
              ? "status"
              : "categories",
        );
      }
      return;
    }

    if (focusZone === "categories") {
      if (code === inlineStart) {
        event.preventDefault();
        setTabIndex(kind === "movie" ? 0 : 1);
        setFocusZone("tabs");
      } else if (code === KEY.UP) {
        event.preventDefault();
        if (categoryIndex > 0) {
          setCategoryIndex((prev) => prev - 1);
        } else {
          setFocusZone("tabs");
        }
      } else if (code === KEY.DOWN) {
        event.preventDefault();
        if (categoryIndex < categoryList.length - 1) {
          setCategoryIndex((prev) => prev + 1);
        }
      } else if (code === KEY.ENTER) {
        event.preventDefault();
        activateCategory(categoryIndex);
      } else if (code === inlineEnd) {
        event.preventDefault();
        if (filteredItems.length > 0) setFocusZone("grid");
      }
      return;
    }

    if (focusZone === "grid") {
      const row = Math.floor(safeGridIndex / COLUMNS);
      const col = safeGridIndex % COLUMNS;
      const totalRows = Math.ceil(filteredItems.length / COLUMNS);

      if (code === inlineStart) {
        event.preventDefault();
        if (col === 0) {
          setFocusZone("categories");
        } else {
          setGridIndex((prev) => Math.max(0, prev - 1));
        }
      } else if (code === inlineEnd) {
        event.preventDefault();
        if (col === COLUMNS - 1 || safeGridIndex === filteredItems.length - 1) {
          setFocusZone("alphabet");
        } else {
          setGridIndex((prev) => Math.min(filteredItems.length - 1, prev + 1));
        }
      } else if (code === KEY.UP) {
        event.preventDefault();
        if (row > 0) {
          setGridIndex((prev) => Math.max(0, prev - COLUMNS));
        } else {
          setFocusZone("tabs");
        }
      } else if (code === KEY.DOWN) {
        event.preventDefault();
        if (row < totalRows - 1) {
          setGridIndex((prev) => Math.min(filteredItems.length - 1, prev + COLUMNS));
        }
      } else if (code === KEY.ENTER) {
        event.preventDefault();
        if (focusedItem) {
          if (kind === "movie") {
            onPlayMovie(focusedItem);
          } else {
            onOpenSeries(focusedItem);
          }
        }
      }
      return;
    }

    if (focusZone === "alphabet") {
      if (code === inlineStart) {
        event.preventDefault();
        setFocusZone("grid");
      } else if (code === KEY.UP) {
        event.preventDefault();
        setAlphabetIndex((prev) => Math.max(0, prev - 1));
      } else if (code === KEY.DOWN) {
        event.preventDefault();
        setAlphabetIndex((prev) => Math.min(ALPHABET.length - 1, prev + 1));
      } else if (code === KEY.ENTER) {
        event.preventDefault();
        jumpToLetter(ALPHABET[alphabetIndex]);
      }
    }
  });

  return (
    <div id="view-vod" aria-hidden={!active}>
      {/* Left Column: Switcher Tabs & Category Rail */}
      <div className="vod-left">
        <div className="vod-tabs">
          {tools.map(([id, label], at) => (
            <button
              type="button"
              key={id}
              data-tool={id}
              className={`vod-tab ${at < 2 && at === (kind === "movie" ? 0 : 1) ? "active" : ""} ${focusZone === "tabs" && tabIndex === at ? "focused" : ""}`}
              onClick={() => {
                setTabIndex(at);
                setFocusZone("tabs");
                activateTool(at);
              }}
            >
              <span className="vod-tool-label">{label}</span>
            </button>
          ))}
          <KeyGuide
            className="vod-favourite-hint"
            items={[
              {
                keys: ["Green"],
                label: t(isFavourite ? "library.removeFavourite" : "library.addFavourite"),
              },
            ]}
          />
        </div>

        <div className="vod-cats-box" ref={catsBoxRef} onScroll={categoryWindow.onScroll}>
          <div style={{ position: "relative", height: categoryWindow.height }}>
            {categoryList.slice(categoryWindow.start, categoryWindow.end).map((cat, offset) => {
              const idx = categoryWindow.start + offset;
              const isFocused = focusZone === "categories" && categoryIndex === idx;
              const isActive = cat.favourite
                ? favouritesOnly
                : cat.resume
                  ? resumeOnly
                  : !favouritesOnly && !resumeOnly && selectedGroup === cat.id;
              const isLocked =
                !session.unlocked &&
                isCategoryLocked(
                  cat.id ?? "",
                  cat.name,
                  settings.parentalPin,
                  settings.lockedCategoryKeys,
                );
              return (
                <button
                  key={
                    cat.favourite
                      ? "favourites"
                      : cat.resume
                        ? "resume"
                        : cat.id === null
                          ? "all"
                          : `category:${cat.id}`
                  }
                  type="button"
                  style={{ position: "absolute", top: idx * 62 }}
                  className={`vod-cat ${isActive ? "active" : ""} ${isFocused ? "focused" : ""}`}
                  onMouseEnter={() => {
                    setCategoryIndex(idx);
                    setFocusZone("categories");
                  }}
                  onFocus={() => {
                    setCategoryIndex(idx);
                    setFocusZone("categories");
                  }}
                  onClick={() => activateCategory(idx)}
                >
                  <span className="vod-cat-name">{cat.name}</span>
                  {isLocked && (
                    <span
                      className="vod-cat-lock"
                      role="img"
                      aria-label={t("settings.locked")}
                    >
                      <Icon name="lock" />
                    </span>
                  )}
                  <span className="vod-cat-count">
                    {cat.count === undefined ? "…" : number(cat.count)}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="vod-hint">
          <span>
            {t("common.returnKey")}: {t("common.back")}
          </span>
        </div>
      </div>

      {/* Right Column: Header, Detail Preview, 6-Poster Grid & Alphabet Jump */}
      <div className={`vod-right ${searchOpen ? "searching" : ""}`}>
        {searchOpen && (
          <div className="vod-search">
            <SearchField
              windowKeys
              value={query}
              focused={active && focusZone === "search"}
              shown={filteredItems.length}
              total={filteredItems.length}
              onChange={setQuery}
              onReturn={closeGridSearch}
              placeholder={t("search.mediaName")}
              ariaLabel={t("search.mediaAria")}
              onExitUp={() => setFocusZone("tabs")}
              onExitDown={() => {
                if (filteredItems.length) setFocusZone("grid");
              }}
              onExitStart={() => setFocusZone("categories")}
            />
          </div>
        )}
        {/* Top Header & Focused Item Details */}
        <div className="vod-head" style={{ top: searchOpen ? 188 : 124 }}>
          <div className={`vod-headline${loading ? " loading" : ""}`}>
            <span>
              {searchOpen
                ? t("common.search")
                : categoryList.find((category) =>
                    favouritesOnly
                      ? category.favourite
                      : resumeOnly
                        ? category.resume
                        : !category.favourite && !category.resume && category.id === selectedGroup,
                  )?.name || t(kind === "movie" ? "library.allMovies" : "library.allSeries")}
              <span className="vod-count">
                {" "}
                ·{" "}
                {loading
                  ? t("library.loading")
                  : t("library.titleCount", { count: number(filteredItems.length) })}
              </span>
            </span>

            {loading && (
              <div className="vod-load" data-load-phase={loadProgress.phase}>
                <div className="vod-load-meter">
                  <span>
                    {loadProgress.phase === "ingest"
                      ? t("library.loadingCount", {
                          kind: t(kind === "movie" ? "content.movies" : "content.series"),
                          count: number(loadProgress.loaded),
                        })
                      : loadProgress.phasePercent === undefined
                        ? t("library.loading")
                        : `${number(loadProgress.phasePercent)}%`}
                  </span>
                  <i
                    role="progressbar"
                    aria-label={phaseText}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={loadProgress.phasePercent}
                    aria-valuetext={phaseText}
                  >
                    <b
                      className={loadProgress.phasePercent === undefined ? "indeterminate" : ""}
                      style={{ width: `${loadProgress.phasePercent ?? 30}%` }}
                    />
                  </i>
                </div>
                <span className="vod-load-stage" role="status" aria-live="polite">
                  {phaseText}
                </span>
              </div>
            )}
          </div>

          {focusedItem && (
            <div className="vod-detail-row">
              <div className="vod-detail-thumb">
                <Poster src={focusedItem.logo} name={focusedItem.name} />
              </div>
              <div className="vod-detail-info">
                <div className="vod-title">{focusedItem.name}</div>
                <div className="vod-meta">
                  {focusedItem.year && <span>{focusedItem.year}</span>}
                  {focusedItem.rating && (
                    <span className="rating-star">★ {focusedItem.rating}</span>
                  )}
                  {focusedItem.genre && <span>{focusedItem.genre}</span>}
                  <span>
                    {t("library.sort", {
                      mode: t(
                        (
                          {
                            added: "library.sortAdded",
                            name: "library.sortName",
                            year: "library.sortYear",
                            rating: "library.sortRating",
                          } as const
                        )[sortMode],
                      ),
                      key: t("common.yellow"),
                    })}
                  </span>
                </div>
                {focusedItem.plot && <div className="vod-plot">{focusedItem.plot}</div>}
              </div>
            </div>
          )}
        </div>

        {!loading && state !== "loaded" && (
          <BrowseStatus
            loadingText={phaseText}
            emptyText={
              favouritesOnly
                ? t("library.emptyFavourites")
                : resumeOnly
                  ? t("library.emptyResume")
                  : undefined
            }
            state={state}
            stale={!!owner && !!owner.items.length}
            focused={focusZone === "status"}
            onRetry={retry}
          />
        )}
        {/* 6-Poster Grid */}
        <div
          className="vod-grid-box"
          style={{ top: (state !== "loaded" ? 376 : 312) + (searchOpen ? 64 : 0) }}
          ref={gridBoxRef}
          onScroll={gridWindow.onScroll}
        >
          <div
            className="vod-grid"
            data-total={filteredItems.length}
            style={{ height: gridWindow.height }}
          >
            {filteredItems.slice(gridWindow.start, gridWindow.end).map((item, offset) => {
              const idx = gridWindow.start + offset;
              const isFocused = focusZone === "grid" && safeGridIndex === idx;
              return (
                <button
                  type="button"
                  aria-label={item.name}
                  data-media-key={item.key}
                  style={{
                    position: "absolute",
                    top: 8 + Math.floor(idx / COLUMNS) * VOD_ROW_HEIGHT,
                    [direction === "rtl" ? "right" : "left"]:
                      8 + (idx % COLUMNS) * (POSTER_WIDTH + POSTER_GAP),
                    width: POSTER_WIDTH,
                    height: VOD_ROW_HEIGHT - POSTER_GAP,
                  }}
                  key={item.key}
                  className={`vod-tile ${isFocused ? "focused" : ""}`}
                  onClick={() => {
                    setGridIndex(idx);
                    useVodBrowse.getState().update(kind, { selectedKey: item.key });
                    setFocusZone("grid");
                    if (kind === "movie") {
                      onPlayMovie(item);
                    } else {
                      onOpenSeries(item);
                    }
                  }}
                >
                  <div
                    className="vod-poster"
                    style={{ width: POSTER_WIDTH, height: POSTER_HEIGHT }}
                  >
                    <Poster src={item.logo} name={item.name} />
                    {favouriteKeys.has(item.key) && (
                      <span
                        role="img"
                        className="vod-favourite"
                        aria-label={t("channel.favourites")}
                      >
                        ★
                      </span>
                    )}
                    {item.rating && <div className="vod-poster-rating">★ {item.rating}</div>}
                  </div>
                  <div className="vod-name" style={{ width: POSTER_WIDTH }}>
                    <span>{item.name}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Right Alphabet Jump Rail */}
        <div
          className="vod-az"
          style={{ top: (state !== "loaded" ? 376 : 312) + (searchOpen ? 64 : 0) }}
        >
          {ALPHABET.map((letter, idx) => {
            const hasItems = availableLetters.has(letter);
            const isFocused = focusZone === "alphabet" && alphabetIndex === idx;
            return (
              <b
                key={letter}
                className={`${hasItems ? "has-items" : "none"} ${isFocused ? "focused" : ""}`}
                onClick={() => {
                  setAlphabetIndex(idx);
                  jumpToLetter(letter);
                }}
              >
                {letter}
              </b>
            );
          })}
        </div>
      </div>
      {pinPrompt !== null && (
        <PinModal
          expectedPin={settings.parentalPin}
          onSuccess={() => {
            const idx = pinPrompt;
            setPinPrompt(null);
            session.unlock();
            activateCategory(idx);
          }}
          onCancel={() => setPinPrompt(null)}
        />
      )}
    </div>
  );
};
