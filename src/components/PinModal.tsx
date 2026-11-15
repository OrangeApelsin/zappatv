import { useCallback, useEffect, useState } from "react";
import { useLocale } from "../hooks/useLocale";
import { KEY } from "../hooks/useRemote";

export interface PinModalProps {
  title?: string;
  expectedPin: string;
  onSuccess: () => void;
  onCancel: () => void;
}

export function PinModal({
  title,
  expectedPin,
  onSuccess,
  onCancel,
}: PinModalProps) {
  const { t } = useLocale();
  const [digits, setDigits] = useState("");
  const [error, setError] = useState(false);

  const handleDigit = useCallback(
    (d: string) => {
      setError(false);
      setDigits((prev) => {
        if (prev.length >= 4) return prev;
        const next = prev + d;
        if (next.length === 4) {
          if (next === expectedPin) {
            setTimeout(onSuccess, 100);
          } else {
            setTimeout(() => {
              setError(true);
              setDigits("");
            }, 200);
          }
        }
        return next;
      });
    },
    [expectedPin, onSuccess],
  );

  const handleBackspace = useCallback(() => {
    setError(false);
    setDigits((prev) => prev.slice(0, -1));
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      e.stopPropagation();
      const code = e.keyCode;
      if (code === KEY.BACK || code === KEY.ESC) {
        e.preventDefault();
        onCancel();
        return;
      }
      if (code >= 48 && code <= 57) {
        e.preventDefault();
        handleDigit(String(code - 48));
        return;
      }
      if (code >= 96 && code <= 105) {
        e.preventDefault();
        handleDigit(String(code - 96));
        return;
      }
      if (code === 8 || code === 46) {
        e.preventDefault();
        handleBackspace();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [handleDigit, handleBackspace, onCancel]);

  const keypadButtons = [
    ["1", "2", "3"],
    ["4", "5", "6"],
    ["7", "8", "9"],
    ["clear", "0", "cancel"],
  ];

  return (
    <div
      className="pin-modal-overlay"
      data-testid="pin-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pin-modal-title"
    >
      <div className="pin-modal-card">
        <h2 id="pin-modal-title" className="pin-modal-title">
          {title ?? t("settings.enterPin")}
        </h2>
        <p className="pin-modal-hint">{t("settings.enterPinHint")}</p>

        <div className={`pin-slots ${error ? "pin-slots-error" : ""}`}>
          {[0, 1, 2, 3].map((idx) => (
            <div
              key={idx}
              className={`pin-slot ${idx < digits.length ? "filled" : ""}`}
            >
              {idx < digits.length ? "●" : "○"}
            </div>
          ))}
        </div>

        {error && (
          <div className="pin-error-text" role="alert">
            {t("settings.incorrectPin")}
          </div>
        )}

        <div className="pin-keypad">
          {keypadButtons.map((row) => (
            <div key={row.join("-")} className="pin-keypad-row">
              {row.map((btn) => (
                <button
                  key={btn}
                  type="button"
                  className="pin-keypad-btn"
                  onClick={() => {
                    if (btn === "clear") handleBackspace();
                    else if (btn === "cancel") onCancel();
                    else handleDigit(btn);
                  }}
                  aria-label={
                    btn === "clear"
                      ? t("common.clear")
                      : btn === "cancel"
                        ? t("common.cancel")
                        : btn
                  }
                >
                  {btn === "clear" ? "⌫" : btn === "cancel" ? "✕" : btn}
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

