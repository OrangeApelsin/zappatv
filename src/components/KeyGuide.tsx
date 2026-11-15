/**
 * The line of "press this, get that" that appears on every screen.
 *
 * It is the whole of this application's manual, which is why it is one component rather than
 * six similar ones: it was written out by hand in the banner, the channel panel, settings,
 * first run, the empty playlist screen and the failed channel card, in three different markups
 * with three separate definitions of the key badge in the stylesheet, and the banner's copy had
 * quietly missed the badge altogether and was drawing bare text.
 *
 * One component and one style means a change to how a key is drawn happens once and appears
 * everywhere, and it is impossible for one screen's guide to drift out of step with the rest.
 */

import { useLocale } from "../hooks/useLocale";

export interface Guide {
  /** The keys to press, drawn as badges. Arrows are written as the arrows themselves. */
  keys: string[];
  beforeKeys?: React.ReactNode;
  label: React.ReactNode;
}

export function SettingsPath({
  items,
  direction,
}: {
  items: string[];
  direction: "ltr" | "rtl";
}) {
  return (
    <span className="settings-path">
      {items.map((item, index) => (
        <span key={item}>
          {index > 0 && <span aria-hidden="true">{direction === "rtl" ? "‹" : "›"}</span>}
          <span>{item}</span>
        </span>
      ))}
    </span>
  );
}

export function KeyGuide({
  items,
  className = "",
}: {
  items: Guide[];
  /** A layout variant, since the same guide sits along a banner, a panel and a column. */
  className?: string;
}) {
  const { t } = useLocale();

  return (
    <div className={`hints ${className}`}>
      {items.map((item) => (
        <span key={item.keys.join("|")}>
          {item.beforeKeys && <span className="guide-prefix">{item.beforeKeys}</span>}
          {item.keys.map((key) => {
            const color = (
              { Red: "red", Green: "green", Yellow: "yellow", Blue: "blue" } as Record<
                string,
                string
              >
            )[key];
            if (color)
              return (
                <span
                  key={key}
                  className={`remote-color remote-color-${color}`}
                  role="img"
                  aria-label={t(`remote.${color}` as Parameters<typeof t>[0])}
                />
              );
            const keyLabel = key === "Return" ? t("common.returnKey") : key;
            return <kbd key={key}>{keyLabel}</kbd>;
          })}
          {item.label}
        </span>
      ))}
    </div>
  );
}
