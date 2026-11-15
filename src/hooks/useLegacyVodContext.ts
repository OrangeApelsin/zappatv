import { useLayoutEffect, useRef } from "react";
import { useVodBrowse, type VodKind } from "../stores/vodBrowse";
import type { CatalogIndex } from "../services/catalogIndex";
import type { LibraryItem, LibraryList } from "../stores/library";
import type { XtreamCategory } from "../services/xtream";

/** Bridge the retained list/detail stack to the same catalog position as the
 * poster view. No subscription/copy of the catalog in the shell's input loop. */
export function useLegacyVodContext({
  active,
  source,
  kind,
  categories,
  category,
  index,
  frame,
  owner,
  restore,
}: {
  active: boolean;
  source: string;
  kind: VodKind | null;
  categories: XtreamCategory[];
  category: number;
  index: number;
  frame: LibraryList<LibraryItem>;
  owner?: CatalogIndex;
  restore: (category: number, index: number) => void;
}) {
  const previous = useRef<{
    active: boolean;
    source: string;
    kind: VodKind | null;
    group: string;
    items: LibraryItem[];
  }>({ active: false, source: "", kind: null, group: "", items: [] });
  useLayoutEffect(() => {
    if (!active || !kind || !source) {
      previous.current.active = false;
      return;
    }
    const state = useVodBrowse.getState();
    const saved = state[kind];
    const first =
      !previous.current.active ||
      previous.current.source !== source ||
      previous.current.kind !== kind;
    const current = categories[category];
    if (first) {
      if (!categories.length) return;
      const selected = saved.selectedKey ? owner?.byKey.get(saved.selectedKey) : undefined;
      const target = saved.favouritesOnly
        ? `${kind}:favourites`
        : saved.selectedGroup !== null
          ? `${kind}:${saved.selectedGroup}`
          : selected?.categoryKey;
      const found = target ? categories.findIndex((item) => item.key === target) : -1;
      const chosen =
        found >= 0 ? found : Math.max(0, Math.min(category, categories.length - 1));
      if (chosen !== category) {
        restore(chosen, 0);
        return;
      }
      if (frame.state === "loading") return;
      const at = saved.selectedKey
        ? frame.items.findIndex((item) => item.key === saved.selectedKey)
        : -1;
      const cursor =
        at >= 0 ? at : Math.max(0, Math.min(saved.gridIndex, frame.items.length - 1));
      previous.current = {
        active: true,
        source,
        kind,
        group: current?.key ?? "",
        items: frame.items,
      };
      if (cursor !== index) {
        restore(chosen, cursor);
        return;
      }
    } else if (
      previous.current.group === current?.key &&
      previous.current.items !== frame.items &&
      frame.state !== "loading"
    ) {
      const at = frame.items.findIndex((item) => item.key === saved.selectedKey);
      previous.current.items = frame.items;
      if (at >= 0 && at !== index) {
        restore(category, at);
        return;
      }
    }
    if (frame.state === "loading") return;
    previous.current = {
      active: true,
      source,
      kind,
      group: current?.key ?? "",
      items: frame.items,
    };
    const item = frame.items[index];
    state.update(kind, {
      selectedGroup: current?.id === "favourites" ? null : (current?.id ?? null),
      favouritesOnly: current?.id === "favourites",
      selectedKey: item?.key ?? "",
      gridIndex: Math.max(0, index),
      focusZone: "grid",
    });
  }, [active, source, kind, categories, category, index, frame, owner, restore]);
}
