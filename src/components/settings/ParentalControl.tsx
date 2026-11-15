import { useState } from "react";
import { useLocale } from "../../hooks/useLocale";
import { useSettings } from "../../stores/settings";
import { useParentalSession } from "../../stores/parental";
import { PageHeader, Row, Toggle } from "./Field";

export function ParentalControl() {
  const { t } = useLocale();
  const settings = useSettings();
  const session = useParentalSession();
  const [enabling, setEnabling] = useState(false);
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");

  const hasPin = Boolean(settings.parentalPin && settings.parentalPin.length === 4);
  const isEnabled = hasPin || enabling;

  const handleToggle = (active: boolean) => {
    if (!active) {
      settings.set("parentalPin", "");
      session.lock();
      setEnabling(false);
      setPin("");
      setError("");
    } else {
      setEnabling(true);
      setPin("");
      setError("");
    }
  };

  const handlePinChange = (val: string) => {
    const digits = val.replace(/\D/g, "").slice(0, 4);
    setPin(digits);
    if (digits.length === 4) {
      settings.set("parentalPin", digits);
      session.unlock();
      setEnabling(false);
      setError("");
    }
  };

  return (
    <>
      <PageHeader title={t("settings.parentalControl")} />

      <Row
        label={t("settings.parentalControl")}
        hint={
          hasPin
            ? t("settings.parentalStatusActiveHint")
            : t("settings.parentalStatusDisabledHint")
        }
      >
        <Toggle
          label={t("settings.parentalControl")}
          value={isEnabled}
          onChange={handleToggle}
        />
      </Row>

      {enabling && (
        <Row
          label={t("settings.enterNewPin")}
          hint={error || t("settings.enterNewPinHint")}
        >
          <div className="pin-setup-row">
            <input
              type="password"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={4}
              value={pin}
              onChange={(e) => handlePinChange(e.target.value)}
              placeholder="••••"
              className="pin-setup-input"
            />
          </div>
        </Row>
      )}

      {hasPin && !enabling && (
        <Row
          label={session.unlocked ? t("settings.parentalUnlocked") : t("settings.parentalLocked")}
          hint={t("settings.parentalSessionHint")}
        >
          <div className="parental-status-row">
            <button
              type="button"
              className="settings-btn"
              onClick={session.unlocked ? session.lock : session.unlock}
            >
              {session.unlocked ? t("settings.lockSessionNow") : t("settings.unlockSession")}
            </button>
          </div>
        </Row>
      )}
    </>
  );
}
