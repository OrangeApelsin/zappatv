import {
  ASPECTS,
  GUIDE_TIME_OFFSETS,
  type GuideTimeOffset,
  OSD_DURATIONS,
  type OsdDuration,
  PREFERRED_LANGUAGES,
  type PreferredLanguage,
  SCREENSAVER_TIMEOUTS,
  type ScreensaverTimeout,
  UP_NEXT_DURATIONS,
  type UpNextDuration,
  useSettings,
  type ZappingDirection,
} from "../../stores/settings";
import { useLibrary } from "../../stores/library";
import { useLocale } from "../../hooks/useLocale";
import { Choice, PageHeader, Row, Toggle } from "./Field";
import { OptionPicker } from "../OptionPicker";
import { ParentalControl } from "./ParentalControl";
import { stopRepair } from "../../services/repair";

export function Playback() {
  const s = useSettings();
  const { t } = useLocale();
  const aspects = ASPECTS.map((aspect) => ({
    ...aspect,
    label:
      aspect.id === "auto"
        ? aspect.label
        : t(
          aspect.id === "fill"
            ? "settings.fill"
            : aspect.id === "fit"
              ? "settings.fit"
              : "settings.stretch",
        ),
    note:
      aspect.id === "auto"
        ? aspect.note
        : t(
          aspect.id === "fill"
            ? "settings.fillHint"
            : aspect.id === "fit"
              ? "settings.fitHint"
              : "settings.stretchHint",
        ),
  }));

  return (
    <>
      <PageHeader title={t("settings.playback")} />
      <Row
        label={t("settings.screenFit")}
        hint={aspects.find((a) => a.id === s.aspectId)?.note}
      >
        <Choice
          label={t("settings.screenFit")}
          options={aspects}
          value={s.aspectId}
          onChange={(id) => s.set("aspectId", id)}
        />
      </Row>
      <Row label={t("settings.resumeLast")} hint={t("settings.resumeLastHint")}>
        <Toggle
          label={t("settings.resumeLast")}
          value={s.resumeLast}
          onChange={(value) => s.set("resumeLast", value)}
        />
      </Row>
      <Row
        label={t("settings.startScreen")}
        hint={
          s.startScreen === "home"
            ? t("settings.startScreenHomeHint")
            : t("settings.startScreenLiveHint")
        }
      >
        <Choice
          label={t("settings.startScreen")}
          options={[
            {
              id: "home",
              label: t("settings.startScreenHome"),
            },
            {
              id: "live",
              label: t("settings.startScreenLive"),
            },
          ]}
          value={s.startScreen}
          onChange={(id) => s.set("startScreen", id)}
        />
      </Row>
      <Row label={t("settings.bufferProfile")} hint={t("settings.bufferProfileHint")}>
        <Choice
          label={t("settings.bufferProfile")}
          options={[
            { id: "fast", label: t("settings.bufferFast") },
            { id: "stable", label: t("settings.bufferStable") },
          ]}
          value={s.bufferProfile}
          onChange={(id) => s.set("bufferProfile", id as "fast" | "stable")}
        />
      </Row>
      <Row label={t("settings.epgBatch")} hint={t("settings.epgBatchHint")}>
        <Toggle
          label={t("settings.epgBatch")}
          value={s.epgBatchMode}
          onChange={(value) => s.set("epgBatchMode", value)}
        />
      </Row>
      <Row
        label={t("settings.guideTimeOffset")}
        hint={t("settings.guideTimeOffsetHint")}
      >
        <Choice
          label={t("settings.guideTimeOffset")}
          options={GUIDE_TIME_OFFSETS.map((opt) => ({
            id: opt.id,
            label: opt.id === "auto" ? t("settings.guideOffsetAuto") : opt.label,
          }))}
          value={s.guideTimeOffset}
          onChange={(id) => {
            s.set("guideTimeOffset", id as GuideTimeOffset);
            useLibrary.getState().clearGuides();
          }}
        />
      </Row>
      <Row
        label={t("settings.zappingDirection")}
        hint={
          s.zappingDirection === "inverted"
            ? t("settings.zappingInvertedHint")
            : t("settings.zappingStandardHint")
        }
      >
        <Choice
          label={t("settings.zappingDirection")}
          options={[
            { id: "standard", label: t("settings.zappingStandard") },
            { id: "inverted", label: t("settings.zappingInverted") },
          ]}
          value={s.zappingDirection}
          onChange={(id) => s.set("zappingDirection", id as ZappingDirection)}
        />
      </Row>
      <Row
        label={t("settings.preferredAudioLanguage")}
        hint={t("settings.preferredAudioLanguageHint")}
      >
        <OptionPicker
          id="pref-audio-lang"
          label={t("settings.preferredAudioLanguage")}
          options={PREFERRED_LANGUAGES.map((l) => ({
            value: l.id,
            label: t(l.label),
          }))}
          value={s.preferredAudioLanguage}
          onChange={(id) => s.set("preferredAudioLanguage", id as PreferredLanguage)}
        />
      </Row>
      <Row
        label={t("settings.preferredSubtitleLanguage")}
        hint={t("settings.preferredSubtitleLanguageHint")}
      >
        <OptionPicker
          id="pref-sub-lang"
          label={t("settings.preferredSubtitleLanguage")}
          options={PREFERRED_LANGUAGES.map((l) => ({
            value: l.id,
            label: t(l.label),
          }))}
          value={s.preferredSubtitleLanguage}
          onChange={(id) => s.set("preferredSubtitleLanguage", id as PreferredLanguage)}
        />
      </Row>
      <Row label={t("settings.osdDuration")} hint={t("settings.osdDurationHint")}>
        <Choice
          label={t("settings.osdDuration")}
          options={OSD_DURATIONS.map((opt) => ({
            id: opt.id,
            label: opt.id === "dismiss" ? t("settings.osdDurationDismiss") : opt.label,
          }))}
          value={s.osdDuration}
          onChange={(id) => s.set("osdDuration", id as OsdDuration)}
        />
      </Row>
      <Row label={t("settings.upNextCountdown")} hint={t("settings.upNextCountdownHint")}>
        <Choice
          label={t("settings.upNextCountdown")}
          options={UP_NEXT_DURATIONS.map((opt) => ({
            id: opt.id,
            label: opt.id === "off" ? t("common.off") : opt.label,
          }))}
          value={s.upNextCountdown}
          onChange={(id) => s.set("upNextCountdown", id as UpNextDuration)}
        />
      </Row>
      <Row
        label={t("settings.screensaverTimeout")}
        hint={t("settings.screensaverTimeoutHint")}
      >
        <Choice
          label={t("settings.screensaverTimeout")}
          options={SCREENSAVER_TIMEOUTS.map((opt) => ({
            id: opt.id,
            label: t(opt.label),
          }))}
          value={s.screensaverTimeout}
          onChange={(id) => s.set("screensaverTimeout", id as ScreensaverTimeout)}
        />
      </Row>
      <Row label={t("settings.compatibility")} hint={t("settings.compatibilityHint")}>
        <Toggle
          label={t("settings.compatibility")}
          value={s.compatibility}
          onChange={(v) => {
            s.set("compatibility", v);
            // Turning it off has to take effect now, not at the next channel: the socket and its
            // refresh loop are exactly what the viewer just asked to be rid of.
            if (!v) stopRepair();
          }}
        />
      </Row>
      <Row label={t("settings.playbackInfo")} hint={t("settings.playbackInfoHint")}>
        <Toggle
          label={t("settings.playbackInfo")}
          value={s.showPlaybackStats}
          onChange={(value) => s.set("showPlaybackStats", value)}
        />
      </Row>
      <ParentalControl />
    </>
  );
}
