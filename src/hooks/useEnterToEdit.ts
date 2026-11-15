import { useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { KEY } from "./useRemote";

export function useEnterToEdit(
  field: RefObject<HTMLInputElement | null>,
  options: {
    readOnly?: boolean;
    disabled?: boolean;
    caretAtEnd?: boolean;
    onCommit?: (value: string) => void;
    onCancel?: () => void;
  } = {},
) {
  const [editing, setEditing] = useState(false);
  const owned = useRef(false);
  const lock = () => {
    owned.current = false;
    setEditing(false);
    if (field.current) field.current.readOnly = options.readOnly ?? true;
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>): boolean => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) {
      event.stopPropagation();
      return true;
    }
    if (options.disabled || options.readOnly === true) return false;
    if (event.keyCode === KEY.ENTER || event.keyCode === 13) {
      event.preventDefault();
      event.stopPropagation();
      if (owned.current) {
        lock();
        options.onCommit?.(field.current?.value ?? "");
      } else {
        owned.current = true;
        setEditing(true);
        const input = field.current;
        if (input) {
          input.readOnly = false;
          input.focus();
          if (options.caretAtEnd) {
            try {
              input.setSelectionRange(input.value.length, input.value.length);
            } catch {
              /* Numeric inputs have no selection range. */
            }
          }
        }
      }
      return true;
    }
    if (
      owned.current &&
      (event.keyCode === KEY.BACK || event.keyCode === KEY.ESC || event.keyCode === 27)
    ) {
      event.preventDefault();
      event.stopPropagation();
      lock();
      options.onCancel?.();
      return true;
    }
    return false;
  };
  return { editing, readOnly: options.readOnly ?? !editing, lock, handleKeyDown };
}
