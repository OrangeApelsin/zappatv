import {
  FONT_SIZES,
  SUBTITLE_SIZES,
  type SubtitleSize,
  SUBTITLE_STYLES,
  type SubtitleStyle,
  SUBTITLE_POSITIONS,
  type SubtitlePosition,
  useSettings,
} from "../../stores/settings";
import { useChannels } from "../../stores/channels";
import { useLocale } from "../../hooks/useLocale";
import { Choice, PageHeader, Row, Toggle } from "./Field";
import { LanguagePicker } from "../LanguagePicker";

export function Appearance() {
  const s = useSettings();
  const { t } = useLocale();
  const fontOptions = FONT_SIZES.map((option) => ({
    ...option,
    label:
      option.id === "s"
        ? t("settings.small")
        : option.id === "m"
          ? t("settings.medium")
          : option.id === "l"
            ? t("settings.large")
            : t("settings.extraLarge"),
  }));
  const subtitleSizeOptions = SUBTITLE_SIZES.map((opt) => ({
    ...opt,
    label:
      opt.id === "s"
        ? t("settings.small")
        : opt.id === "m"
          ? t("settings.medium")
          : opt.id === "l"
            ? t("settings.large")
            : t("settings.extraLarge"),
  }));
  const subtitleStyleOptions = SUBTITLE_STYLES.map((opt) => ({
    ...opt,
    label:
      opt.id === "translucent"
        ? t("settings.subtitleStyleTranslucent")
        : opt.id === "black"
          ? t("settings.subtitleStyleBlack")
          : t("settings.subtitleStyleOutline"),
  }));
  const subtitlePositionOptions = SUBTITLE_POSITIONS.map((opt) => ({
    ...opt,
    label:
      opt.id === "bottom"
        ? t("settings.subtitlePositionBottom")
        : opt.id === "lower"
          ? t("settings.subtitlePositionLower")
          : t("settings.subtitlePositionElevated"),
  }));
  // `load` because sorting rebuilds the lists from the playlist that is already in hand: the order
  // is applied while the channels are read, so nothing changes on screen until they are read again.
  const { load } = useChannels();
  return (
    <>
      <PageHeader title={t("settings.appearance")} />
      <Row label={t("settings.language")} hint={t("settings.languageHint")}>
        <LanguagePicker
          value={s.locale}
          onChange={(id) => {
            s.set("locale", id);
            if (s.sortAlphabetically) void load();
          }}
        />
      </Row>
      {/*
       * Every row here says what it changes, including the three that used to say nothing.
       *
       * A label alone answers "what is this called" and not "what happens if I turn it off", and
       * these three were the ambiguous ones: numbers could plausibly mean dialling rather than
       * showing, a clock could be anywhere on the screen, and text size could be the channel names
       * alone rather than the whole interface. A viewer at three metres should not have to try a
       * setting to find out what it does.
       */}
      <Row label={t("settings.textSize")} hint={t("settings.textSizeHint")}>
        <Choice
          label={t("settings.textSize")}
          options={fontOptions}
          value={s.fontSizeId}
          onChange={(id) => s.set("fontSizeId", id)}
        />
      </Row>
      <Row label={t("settings.subtitleSize")} hint={t("settings.subtitleSizeHint")}>
        <Choice
          label={t("settings.subtitleSize")}
          options={subtitleSizeOptions}
          value={s.subtitleSize}
          onChange={(id) => s.set("subtitleSize", id as SubtitleSize)}
        />
      </Row>
      <Row label={t("settings.subtitleStyle")} hint={t("settings.subtitleStyleHint")}>
        <Choice
          label={t("settings.subtitleStyle")}
          options={subtitleStyleOptions}
          value={s.subtitleStyle}
          onChange={(id) => s.set("subtitleStyle", id as SubtitleStyle)}
        />
      </Row>
      <Row label={t("settings.subtitlePosition")} hint={t("settings.subtitlePositionHint")}>
        <Choice
          label={t("settings.subtitlePosition")}
          options={subtitlePositionOptions}
          value={s.subtitlePosition}
          onChange={(id) => s.set("subtitlePosition", id as SubtitlePosition)}
        />
      </Row>
      <Row label={t("settings.showNumbers")} hint={t("settings.showNumbersHint")}>
        <Toggle
          label={t("settings.showNumbers")}
          value={s.showNumbers}
          onChange={(v) => s.set("showNumbers", v)}
        />
      </Row>
      <Row label={t("settings.showLogos")} hint={t("settings.showLogosHint")}>
        <Toggle
          label={t("settings.showLogos")}
          value={s.showLogos}
          onChange={(v) => s.set("showLogos", v)}
        />
      </Row>
      <Row label={t("settings.showClock")} hint={t("settings.showClockHint")}>
        <Toggle
          label={t("settings.showClock")}
          value={s.showClock}
          onChange={(v) => s.set("showClock", v)}
        />
      </Row>
      {/*
       * Sorting lives here rather than under Watching, where it used to be.
       *
       * It changes the order of the list on this screen's own terms, beside the two rows that decide
       * what else that list shows. Watching is about the picture, and a channel order is not part of
       * the picture: it was there only because it is not about the picture, which is a reason to
       * exclude it from somewhere rather than a reason to put it here.
       */}
      <Row label={t("settings.sortAlphabetically")} hint={t("settings.sortAlphabeticallyHint")}>
        <Toggle
          label={t("settings.sortAlphabetically")}
          value={s.sortAlphabetically}
          onChange={(v) => {
            s.set("sortAlphabetically", v);
            load();
          }}
        />
      </Row>
    </>
  );
}
