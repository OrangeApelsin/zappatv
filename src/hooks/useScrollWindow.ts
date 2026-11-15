import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import { useViewport } from "./useViewport";
import { MAX_VISIBLE_ROWS, WINDOW_OVERSCAN } from "../services/vodMetrics";

export function scrollWindow(
  count: number,
  columns: number,
  rowHeight: number,
  height: number,
  top: number,
) {
  const rows = Math.ceil(count / columns);
  const visible = Math.min(
    columns > 1 ? 3 : MAX_VISIBLE_ROWS,
    Math.max(1, Math.ceil(height / rowHeight)),
  );
  const first = Math.max(0, Math.min(Math.floor(top / rowHeight), Math.max(0, rows - visible)));
  const startRow = Math.max(0, first - WINDOW_OVERSCAN);
  const endRow = Math.min(rows, first + visible + WINDOW_OVERSCAN);
  return {
    start: startRow * columns,
    end: Math.min(count, endRow * columns),
    height: rows * rowHeight,
    first,
    visible,
  };
}

/** Native wheel/touch scrolling and remote moving focus share the same spacers.
 * Remote movement scrolls only far enough to reveal its row, never smooth-scrolls
 * through unmounted rows. All offsets are in the element's CSS coordinate space. */
export function useScrollWindow(
  ref: RefObject<HTMLElement | null>,
  count: number,
  cursor: number,
  columns: number,
  rowHeight: number,
  identity: unknown,
  layoutKey?: unknown,
  initialTop = 0,
) {
  const measured = useViewport(ref, identity, layoutKey);
  const height = measured || (columns === 1 ? rowHeight * 12 : rowHeight * 2);
  const [top, setTop] = useState(initialTop);
  const previous = useRef<{ cursor: number; identity: unknown; height: number } | null>(null);
  let offset = top;
  if (
    !previous.current ||
    previous.current.cursor !== cursor ||
    previous.current.height !== height ||
    previous.current.identity !== identity
  ) {
    const rowTop = Math.floor(Math.max(0, cursor) / columns) * rowHeight;
    if (previous.current?.identity !== identity) offset = rowTop;
    else if (rowTop < top) offset = rowTop;
    else if (rowTop + rowHeight > top + height) offset = rowTop + rowHeight - height;
  }
  offset = Math.max(
    0,
    Math.min(offset, Math.max(0, Math.ceil(count / columns) * rowHeight - height)),
  );
  const win = scrollWindow(count, columns, rowHeight, height, offset);
  useLayoutEffect(() => {
    previous.current = { cursor, identity, height };
    if (ref.current && ref.current.scrollTop !== offset) ref.current.scrollTop = offset;
    if (top !== offset) setTop(offset);
  }, [ref, cursor, identity, offset, top]);
  return { ...win, top: offset, onScroll: () => setTop(ref.current?.scrollTop ?? 0) };
}
