import { useEnterToEdit } from "../hooks/useEnterToEdit";
import { useEffect, useRef } from "react";
import { useLocale } from "../hooks/useLocale";
import { KEY, useRemote } from "../hooks/useRemote";
import { Icon } from "./Icon";

/**
 * The query, in the channel column's header, where that column's heading otherwise goes.
 *
 * A real input rather than anything built here, because on a television focusing one is what
 * raises the set's own on-screen keyboard. That is the same thing the playlist address field in
 * Settings relies on, and it is worth having for two reasons beyond the work it saves: it is the
 * keyboard the viewer already knows how to drive, and it is the one their remote's voice and
 * pointer input already talk to.
 *
 * It takes the place of the heading rather than sitting above it, so the results start on the
 * same line as the categories beside them. A field that pushed the rows down would leave the two
 * columns out of step, which is the ragged layout the checklist's grid rule exists to prevent.
 */
export function SearchField({
  value,
  focused,
  windowKeys = false,
  shown,
  total,
  placeholder,
  ariaLabel,
  onChange,
  onExitUp,
  onExitDown,
  onExitStart,
  onReturn,
}: {
  value: string;
  windowKeys?: boolean;
  /** Whether the cursor is on the field, as opposed to down among the results. */
  focused: boolean;
  /** How many results the column is holding. */
  shown: number;
  /** How many matched altogether, which is the larger number when the list has been capped. */
  total: number;
  placeholder?: string;
  ariaLabel?: string;
  onChange: (value: string) => void;
  onExitUp?: () => void;
  onExitDown?: () => void;
  onExitStart?: () => void;
  onReturn?: () => void;
}) {
  const { t, number, direction } = useLocale();
  const field = useRef<HTMLInputElement>(null);
  const shield = useEnterToEdit(field, {
    onCancel: () => {
      if (!onReturn) return;
      field.current?.blur();
      field.current?.focus();
    },
  });
  useRemote((code, event) => {
    if (
      !windowKeys ||
      !focused ||
      event.target instanceof Node ||
      ![KEY.ENTER, KEY.BACK, KEY.ESC, KEY.UP, KEY.DOWN, KEY.LEFT, KEY.RIGHT].includes(
        code as never,
      )
    )
      return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const next = new KeyboardEvent("keydown", { bubbles: true, cancelable: true });
    Object.defineProperty(next, "keyCode", { value: code });
    field.current?.dispatchEvent(next);
  });

  /*
   * Focus follows the cursor, in both directions.
   *
   * Arriving on the field focuses the element in read-only mode so the virtual keyboard (IME)
   * does not auto-open and obscure the results. Pressing ENTER enables editing and summons
   * the keyboard.
   */
  useEffect(() => {
    const el = field.current;
    if (!el) return;
    if (focused) {
      el.focus();
    } else {
      shield.lock();
      if (document.activeElement === el) el.blur();
    }
  }, [focused]);

  return (
    <div
      className={`search ${focused ? "focused" : ""} ${shield.editing ? "editing" : "locked"}`}
    >
      <span className="search-icon">
        <Icon name="search" />
      </span>
      <input
        ref={field}
        className="search-field"
        value={value}
        readOnly={shield.readOnly}
        onChange={(e) => onChange(e.target.value)}
        onBlur={shield.lock}
        onKeyDown={(event) => {
          if (shield.handleKeyDown(event)) return;
          if (event.nativeEvent.isComposing || event.keyCode === 229) return;
          if (
            onReturn &&
            (event.keyCode === KEY.BACK || event.keyCode === KEY.ESC || event.keyCode === 27)
          ) {
            event.preventDefault();
            event.stopPropagation();
            onReturn();
            return;
          }

          const start = direction === "rtl" ? 39 : 37;
          if (
            event.keyCode === start &&
            event.currentTarget.selectionStart === 0 &&
            event.currentTarget.selectionEnd === 0
          ) {
            event.preventDefault();
            event.stopPropagation();
            onExitStart?.();
            return;
          }
          if (event.keyCode !== 38 && event.keyCode !== 40) return;
          event.preventDefault();
          event.stopPropagation();
          shield.lock();
          if (event.keyCode === 38) onExitUp?.();
          else onExitDown?.();
        }}
        placeholder={placeholder ?? t("search.channelName")}
        aria-label={ariaLabel ?? t("search.ariaLabel")}
        dir="auto"
        spellCheck={false}
        autoComplete="off"
        type="text"
      />
      {/*
       * How many, in the same chip the rail uses for a category's count.
       *
       * Silent until something has been typed, because "0" against an empty field reads as a
       * search that failed rather than one that has not happened yet.
       *
       * "300+" rather than the true total when the list has been capped. The exact number is
       * known and printing it would be worse: a chip reading 4,211 above a list holding three
       * hundred invites somebody to scroll to the end looking for the rest.
       */}
      {!!value.trim() && (
        <span className="count">{total > shown ? `${number(shown)}+` : number(total)}</span>
      )}
    </div>
  );
}
