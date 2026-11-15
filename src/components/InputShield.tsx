import {
  type ChangeEvent,
  type InputHTMLAttributes,
  type KeyboardEvent,
  forwardRef,
  useImperativeHandle,
  useRef,
} from "react";
import { useEnterToEdit } from "../hooks/useEnterToEdit";

export interface InputShieldProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "onChange"> {
  onChange?: (e: ChangeEvent<HTMLInputElement>) => void;
  onCommit?: (value: string) => void;
  onCancel?: () => void;
}

/**
 * TV Input Field with Enter-to-Edit Shield.
 *
 * On Samsung Tizen Smart TVs, focusing an editable <input> element automatically
 * summons the full on-screen keyboard (IME), obscuring the viewport and trapping D-pad focus.
 *
 * InputShield keeps the underlying input in `readOnly` mode during D-pad navigation.
 * Visual focus indicators remain fully active. Pressing `KEY.ENTER` unlocks the field,
 * invokes `.focus()`, and raises the IME for editing. Pressing Enter or Return closes
 * the keyboard and locks the field again.
 */
export const InputShield = forwardRef<HTMLInputElement, InputShieldProps>(function InputShield(
  {
    onChange,
    onCommit,
    onCancel,
    onKeyDown,
    onFocus,
    onBlur,
    className = "",
    readOnly: explicitReadOnly,
    ...props
  },
  ref,
) {
  const inputRef = useRef<HTMLInputElement>(null);
  useImperativeHandle(ref, () => inputRef.current as HTMLInputElement);

  const shield = useEnterToEdit(inputRef, {
    readOnly: explicitReadOnly,
    disabled: props.disabled,
    caretAtEnd: true,
    onCommit,
    onCancel,
  });
  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!shield.handleKeyDown(event)) onKeyDown?.(event);
  };

  return (
    <input
      ref={inputRef}
      readOnly={shield.readOnly}
      onFocus={onFocus}
      onBlur={(event) => {
        shield.lock();
        onBlur?.(event);
      }}
      onKeyDown={handleKeyDown}
      onChange={onChange}
      className={`input-shield ${className} ${shield.editing ? "editing" : "locked"}`.trim()}
      {...props}
    />
  );
});
