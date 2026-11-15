import { DEFAULT_INITIAL_BUFFER_SECONDS } from "./manifest";
import { classifyResolution, type VideoQualityTier } from "./playbackLabels";
import { playbackFailureCode } from "./playbackFailure";
import { findMatchingTrackIndex, useSettings } from "../stores/settings";

/** Samsung AVPlay is the only production playback engine.
 * Development/CI may inject the separately excluded simulation before UI mount.
 */
interface AVPlayListener {
  onbufferingstart?: () => void;
  /** How full the buffer is, 0 to 100, which is the only honest thing to show while waiting. */
  onbufferingprogress?: (percent: number) => void;
  onbufferingcomplete?: () => void;
  onstreamcompleted?: () => void;
  onerror?: (code: string) => void;
  /** The same failure with the engine's own sentence attached, where the firmware sends one. */
  onerrormsg?: (code: string, message: string) => void;
  /**
   * Everything else the player wants to say, of which one matters here.
   *
   * PLAYER_MSG_HTTP_ERROR_CODE carries the status the server actually returned. Without it a
   * refusal and a dead host are both PLAYER_ERROR_CONNECTION_FAILED, and the viewer is told
   * "the TV could not reach this channel's server" when the truth was a 403 and no amount of
   * waiting will help. The other events are resolution and bitrate changes during adaptive
   * playback, which are worth having later for a badge that reports what is playing rather
   * than what the playlist claims.
   */
  onevent?: (id: string, data: string) => void;
  onsubtitlechange?: (
    duration: number,
    text: string,
    type?: number,
    attriCount?: number,
    attributes?: unknown,
  ) => void;
}

/** The states AVPlay moves through. Most calls are legal in only some of them. */
type AVPlayState = "NONE" | "IDLE" | "READY" | "PLAYING" | "PAUSED";

interface AVPlayStreamInfo {
  index: number;
  type: "VIDEO" | "AUDIO" | "TEXT";
  extra_info: string;
}

interface AVPlay {
  open(url: string): void;
  close(): void;
  setDisplayRect(x: number, y: number, w: number, h: number): void;
  setDisplayMethod?(mode: string): void;
  setListener(l: AVPlayListener): void;
  prepareAsync(ok: () => void, fail: (e: unknown) => void): void;
  play(): void;
  pause?(): void;
  stop(): void;
  getState(): AVPlayState;
  /** Only ever read, and only to tell a playing picture from a frozen one. */
  getCurrentTime?(): number;
  getDuration?(): number;
  seekTo?(milliseconds: number, success?: () => void, failure?: (error: unknown) => void): void;
  jumpForward?(
    milliseconds: number,
    success?: () => void,
    failure?: (error: unknown) => void,
  ): void;
  jumpBackward?(
    milliseconds: number,
    success?: () => void,
    failure?: (error: unknown) => void,
  ): void;
  getCurrentStreamInfo?(): AVPlayStreamInfo[];
  getTotalTrackInfo?(): AVPlayStreamInfo[];
  setSelectTrack?(type: "AUDIO" | "TEXT", index: number): void;
  setSilentSubtitle?(silent: boolean): void;
  getStreamingProperty?(key: string): string;
  getVideoSeamlessInfo?(): { scan_type: number; rotation_degree: number };
  setStreamingProperty?(key: string, value: string): void;
  /** IDLE only, like setStreamingProperty. Optional because the older sets may not have it. */
  setBufferingParam?(option: string, unit: string, amount: number): void;
  suspend?(): void;
  restore?(): void;
  setTimeoutForBuffering?(seconds: number): void;
}

export interface AudioTrack {
  index: number;
  language: string;
  label: string;
  format?: string;
  channels?: number;
}

export interface SubtitleTrack {
  index: number;
  language: string;
  label: string;
  format?: string;
}

const LANG_MAP: Record<string, string> = {
  swe: "Swedish",
  sv: "Swedish",
  eng: "English",
  en: "English",
  nor: "Norwegian",
  no: "Norwegian",
  dan: "Danish",
  da: "Danish",
  fin: "Finnish",
  fi: "Finnish",
  ger: "German",
  de: "German",
  fra: "French",
  fr: "French",
  spa: "Spanish",
  es: "Spanish",
  ara: "Arabic",
  ar: "Arabic",
  ita: "Italian",
  it: "Italian",
  und: "Default",
  qaa: "Original",
};

export function formatTrackLanguage(code: string): string {
  if (!code) return "Default";
  const clean = code.toLowerCase().trim();
  return LANG_MAP[clean] || clean.toUpperCase();
}

export function formatAudioCodec(fourcc?: string): string {
  if (!fourcc) return "";
  const c = fourcc.toLowerCase();
  if (c.includes("eac3") || c.includes("ec-3")) return "E-AC3";
  if (c.includes("ac3") || c.includes("ac-3")) return "AC3";
  if (c.includes("mp4a") || c.includes("aac")) return "AAC";
  if (c.includes("mp3") || c.includes("mp3a")) return "MP3";
  if (c.includes("dts")) return "DTS";
  return fourcc.toUpperCase();
}

export function formatSubtitleFormat(format?: string): string {
  if (!format) return "";
  const f = format.toLowerCase();
  if (f.includes("dvb") || f.includes("subt")) return "DVB";
  if (f.includes("txt") || f.includes("teletext") || f.includes("txnt")) return "Teletext";
  if (f.includes("cea") || f.includes("708") || f.includes("608")) return "CC";
  if (f.includes("vtt")) return "VTT";
  return format.toUpperCase();
}

interface TVAudioControl {
  setMute(mute: boolean): void;
  isMute(): boolean;
  setVolumeUp?(): void;
  setVolumeDown?(): void;
}

export const NARROW_ASPECT = 1.6;

/**
 * How to fit a picture that is not the shape of the screen.
 *
 * Named after what the viewer sees rather than after either engine's vocabulary, since the
 * TV exposes these as display methods, applied without reopening the stream.
 */
export type Fit = "auto" | "fit" | "fill" | "stretch";

const AVPLAY_MODE: Record<Fit, string> = {
  auto: "PLAYER_DISPLAY_MODE_LETTER_BOX",
  fit: "PLAYER_DISPLAY_MODE_LETTER_BOX",
  fill: "PLAYER_DISPLAY_MODE_FULL_SCREEN",
  // AVPlay FULL_SCREEN fills the entire display rectangle regardless of source aspect ratio.
  stretch: "PLAYER_DISPLAY_MODE_FULL_SCREEN",
};

interface AppCommon {
  AppCommonScreenSaverState: {
    SCREEN_SAVER_ON: number;
    SCREEN_SAVER_OFF: number;
  };
  setScreenSaverState(state: number): void;
}

declare global {
  interface Window {
    webapis?: {
      avplay?: AVPlay;
      appcommon?: AppCommon;
      network?: { getIp?: () => string };
    };
    tizen?: { tvaudiocontrol?: TVAudioControl };
  }
}

/**
 * Enable or disable screen saver prevention on Samsung Tizen TVs.
 * @param prevent True to inhibit screen saver (SCREEN_SAVER_OFF) during playback;
 *                False to restore normal screen saver (SCREEN_SAVER_ON) on pause/stop/error.
 */
export function setScreenSaverState(prevent: boolean): void {
  try {
    const appcommon = typeof window !== "undefined" ? window.webapis?.appcommon : undefined;
    if (appcommon) {
      const state = prevent
        ? appcommon.AppCommonScreenSaverState.SCREEN_SAVER_OFF
        : appcommon.AppCommonScreenSaverState.SCREEN_SAVER_ON;
      appcommon.setScreenSaverState(state);
    }
  } catch {
    /* Screen saver API is optional on some firmware or browser environments */
  }
}

export type PlayerEvent =
  /** `percent` is how full the buffer is, where the engine will say, and absent otherwise. */
  | { type: "buffering"; percent?: number }
  | { type: "playing" }
  | { type: "ended" }
  /** `code` is the engine's own name for the fault, which the UI turns into a cause and
      a remedy. Checklist 4.6 asks for both, not for the raw code. */
  | { type: "error"; code: string }
  | {
      type: "tracks";
      audioTracks: AudioTrack[];
      subtitleTracks: SubtitleTrack[];
      audioIndex: number;
      subtitleIndex: number;
    }
  | { type: "resolution"; tier: VideoQualityTier | null; width?: number; height?: number }
  | { type: "subtitle"; text: string };

export interface PlaybackStats {
  engine: "AVPlay" | "Unavailable";
  width?: number;
  height?: number;
  scan?: "progressive" | "interlaced";
  videoCodec?: string;
  audioCodec?: string;
  bitrate?: number;
  bandwidth?: number;
  bufferSeconds?: number;
  frameRate?: number;
  droppedFrames?: number;
  totalFrames?: number;
  level?: number;
  levels?: number;
  switches: number;
}

/**
 * How long a channel may take to produce a picture before it counts as broken.
 *
 * Thirty seconds, not the fifteen or twenty a desktop would allow. These are public IPTV
 * relays reached over whatever connection the television has, and a first segment can
 * genuinely take twenty seconds to arrive on a slow link. Giving up early on a channel that
 * was about to start is worse than waiting, because the viewer has no way to tell the
 * difference and will conclude the channel is dead. The wait is not silent: the banner names
 * the channel throughout and says how it is getting on.
 */
const START_TIMEOUT_MS = 30000;

/**
 * How a picture that has stopped moving is noticed, and how long it is given first.
 *
 * A public relay does not usually fail cleanly. It freezes: the connection stays open, the
 * engine reports nothing wrong, and the last frame sits there indefinitely. Nothing in either
 * engine reports that, so it is found by watching the clock: if the playhead has not advanced
 * in twelve seconds and nobody pressed pause, there is no programme, whatever the engine says.
 *
 * Twelve, because a bad connection can genuinely stall for ten and recover, and a viewer who
 * has waited twelve seconds for a frozen picture would have given up on it anyway. It is
 * reported as an ordinary failure, so the automatic retry picks it up like any other.
 */
const STALL_TICK_MS = 3000;
const STALL_LIMIT_MS = 12000;

export const onTizen = (): boolean => typeof window !== "undefined" && !!window.webapis?.avplay;

/** AVPlay throws objects carrying its own error name; callers may also throw Errors. */
const codeOf = (e: unknown): string => {
  const o = e as { name?: string; message?: string } | null;
  return o?.name || o?.message || String(e);
};

/**
 * The engine's fault with the server's status alongside it, where there is one.
 *
 * "http 403" rather than a bare number, so that a status can never be mistaken for part of the
 * engine's own name, and so the mapping in services/errors.ts can look for one without matching
 * any three digits that happen to appear in a message.
 */
const withStatus = (code: string, status: string): string =>
  status && !code.includes(status) ? `${code} (http ${status})` : code;

/**
 * The surface AVPlay draws into.
 *
 * A Samsung TV does not decode into the page. The picture goes onto a hardware plane
 * *underneath* the browser, and the page is punched through with a transparent hole so it
 * can be seen. Two things follow, and both were wrong here.
 *
 * The page must actually be transparent over the video, which is what the `tizen` class on
 * <html> arranges. An opaque background anywhere in the chain, and the set plays the
 * channel perfectly into a hole nobody can see through: sound, no picture.
 *
 * And the guide requires an <object type="application/avplayer"> for the plane to bind to.
 * It is created once, outside React, as the first child of the body so nothing in the app
 * paints beneath it, and it is never recreated: webapis.avplay is a singleton with no
 * handle tying it to an element, so a second object element sends the video to the wrong
 * one. Its size must be non-zero and must track setDisplayRect.
 */
const SURFACE_ID = "avplay-surface";

function ensureSurface(): void {
  if (document.getElementById(SURFACE_ID)) return;
  const el = document.createElement("object");
  el.id = SURFACE_ID;
  el.setAttribute("type", "application/avplayer");
  el.setAttribute(
    "style",
    "position:absolute;top:0;left:0;width:1920px;height:1080px;background:transparent;pointer-events:none;",
  );
  document.body.insertBefore(el, document.body.firstChild);
}

const finite = (value: unknown): number | undefined => {
  const number = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  return Number.isFinite(number) && number > 0 ? number : undefined;
};

const nonNegative = (value: unknown): number | undefined => {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : undefined;
};

const streamInfo = (value: unknown): Record<string, unknown> => {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const normalized: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(parsed)) {
      normalized[key.toLowerCase().replace(/[^a-z0-9]/g, "")] = item;
    }
    return normalized;
  } catch {
    return {};
  }
};

export class Player {
  private attempt = 0;
  private phase = "setup";
  /** Whether this attempt has already reported why it failed. */
  private failed = false;
  private fit: Fit = "fit";
  private watchdog: number | undefined;
  private sink: (e: PlayerEvent) => void;
  /** Whether the viewer is holding the picture, so a still frame is not read as a fault. */
  private held = false;
  private mode: "live" | "finite" = "live";
  private resumeLimitation = "";
  private seeking = false;
  private progress: number | undefined;
  private lastPosition = -1;
  private stalledFor = 0;
  private muteBeforeSettings: boolean | null = null;
  private switches = 0;
  private lastBitrate = "";
  private audioTracks: AudioTrack[] = [{ index: 0, language: "und", label: "Default" }];
  private subtitleTracks: SubtitleTrack[] = [];
  private currentAudioIndex = 0;
  private currentSubtitleIndex = -2; // -2: native automatic selection not yet known; -1: off
  private subtitlesSuppressed = false;
  private subtitleTimer: number | undefined;

  private clearSubtitle(): void {
    window.clearTimeout(this.subtitleTimer);
    this.subtitleTimer = undefined;
    this.emit({ type: "subtitle", text: "" });
  }

  constructor(emit: (e: PlayerEvent) => void) {
    this.sink = emit;
  }

  /** Anything conclusive, good or bad, calls off the watchdog. */
  private emit(e: PlayerEvent) {
    if (e.type === "playing" || e.type === "ended" || e.type === "error") {
      window.clearTimeout(this.watchdog);
      this.watchdog = undefined;
    }
    if (e.type === "ended") {
      window.clearInterval(this.progress);
      this.progress = undefined;
    }
    if (e.type === "playing") {
      setScreenSaverState(true);
      // A picture has arrived, so from here the question stops being whether it will start and
      // becomes whether it is still moving.
      this.watchProgress();
    } else if (e.type === "ended" || e.type === "error") {
      setScreenSaverState(false);
    }
    this.sink(e);
  }

  /** Where the playhead is, in seconds, or null when neither engine will say. */
  getPosition(): number | null {
    if (onTizen()) {
      try {
        const av = window.webapis?.avplay;
        const state = av?.getState();
        if (!av || (state !== "READY" && state !== "PLAYING" && state !== "PAUSED"))
          return null;
        const ms = av.getCurrentTime?.();
        return typeof ms === "number" && Number.isFinite(ms) ? ms / 1000 : null;
      } catch {
        return null;
      }
    }
    return null;
  }

  getResumeLimitation(): string | null {
    return this.resumeLimitation || null;
  }

  getDuration(): number | null {
    if (onTizen()) {
      try {
        const value = window.webapis?.avplay?.getDuration?.();
        return typeof value === "number" && Number.isFinite(value) ? value / 1000 : null;
      } catch {
        return null;
      }
    }
    return null;
  }

  /**
   * Watch the picture keep moving, and say so when it stops.
   *
   * This is the one fault neither engine reports. A frozen relay looks exactly like a playing
   * one from the outside: no error, no buffering event, no end of stream, just a picture that
   * has stopped. Leaving the viewer to notice and press a Reload button would mean a
   * permanent control on screen for something that happens rarely, and no help at all to
   * anybody who did not know what the button was for.
   */
  private watchProgress() {
    window.clearInterval(this.progress);
    this.stalledFor = 0;
    this.lastPosition = this.getPosition() ?? -1;

    this.progress = window.setInterval(() => {
      if (this.held || this.seeking) return; // paused or seeking on purpose is not a stall
      const now = this.getPosition();
      if (now === null) return;
      // A tenth of a second, so a clock that only ticks per frame still counts as moving.
      if (now > this.lastPosition + 0.1) {
        this.lastPosition = now;
        this.stalledFor = 0;
        return;
      }
      this.stalledFor += STALL_TICK_MS;
      if (this.stalledFor < STALL_LIMIT_MS) return;
      window.clearInterval(this.progress);
      this.progress = undefined;
      this.fail("STALLED");
    }, STALL_TICK_MS);
  }

  /**
   * Report a failure, keeping the first explanation.
   *
   * One broken stream produces several errors in a row, and the later ones are the
   * consequences rather than the cause: a manifest that 404s leaves the element with no
   * source, and the NotSupportedError that follows would otherwise overwrite "could not
   * reach the server" with the far less useful "cannot decode this format".
   */
  private fail(code: string) {
    if (this.failed) return;
    this.failed = true;
    this.clearSubtitle();
    window.clearInterval(this.progress);
    this.progress = undefined;
    if (this.mode === "finite") {
      let state = "UNKNOWN";
      try {
        const value = window.webapis?.avplay?.getState();
        if (value && ["NONE", "IDLE", "READY", "PLAYING", "PAUSED"].includes(value))
          state = value;
      } catch {}
      code = `${this.phase}/${state}: ${playbackFailureCode(code)}`;
    }
    this.emit({ type: "error", code });
  }

  play(
    url: string,
    bufferSeconds = DEFAULT_INITIAL_BUFFER_SECONDS,
    mode: "live" | "finite" = "live",
    startSeconds = 0,
  ) {
    this.attempt++;
    this.phase = "setup";
    /*
     * Wound down, not destroyed.
     *
     * playAVPlay below is careful to reach a new channel through stop rather than close,
     * because close throws the instance away and the whole pipeline has to be rebuilt, which
     * is the last thing a television needs while somebody holds the channel key down. That
     * care was undone one line up: this called the public stop(), which closes, so every
     * channel change rebuilt the pipeline anyway and the comment describing the intent was
     * the only place the intent survived.
     */
    this.teardown(false);
    this.failed = false;
    this.held = false;
    this.mode = mode;
    this.resumeLimitation = "";
    this.seeking = false;
    this.switches = 0;
    this.lastBitrate = "";
    this.audioTracks = [{ index: 0, language: "und", label: "Default" }];
    this.subtitleTracks = [];
    this.currentAudioIndex = 0;
    this.currentSubtitleIndex = -2;
    this.subtitlesSuppressed = false;

    // A hard bound on how long a channel may sit there doing nothing.
    //
    // Firmware can leave a failed connection pending indefinitely. Keep a visible,
    // bounded attempt regardless of whether an engine callback arrives.
    window.clearTimeout(this.watchdog);
    this.watchdog = window.setTimeout(() => this.fail("TIMEOUT"), START_TIMEOUT_MS);
    if (onTizen()) this.playAVPlay(url, bufferSeconds, startSeconds);
    else this.fail("TV_ONLY");
  }

  /**
   * Start a channel on the TV.
   *
   * The order is not a matter of taste. Every AVPlay call is legal in only some states,
   * and the awkward one is setStreamingProperty, which is IDLE only: after open, before
   * prepare. Called any later it throws and the channel never starts.
   *
   * Changing channel goes through stop rather than close. Both leave a state open can be
   * called from, but close destroys the instance and the pipeline has to be rebuilt, which
   * is exactly the wrong thing to do when someone is holding the channel key down.
   */
  private playAVPlay(url: string, bufferSeconds: number, startSeconds: number) {
    const av = window.webapis!.avplay!;
    const attempt = this.attempt;
    const active = () => attempt === this.attempt && !this.failed;
    try {
      ensureSurface();

      const state = av.getState();
      if (state !== "NONE" && state !== "IDLE") av.stop(); // any state -> IDLE

      this.phase = "open";
      av.open(url); // NONE|IDLE -> IDLE
      if (this.mode === "finite" && startSeconds > 0) {
        if (av.seekTo) {
          try {
            av.seekTo(
              startSeconds * 1000,
              () => {},
              (error) => {
                if (!active()) return;
                this.resumeLimitation = `SEEK_FAILED ${codeOf(error)}`;
              },
            );
          } catch (error) {
            this.resumeLimitation = `SEEK_FAILED ${codeOf(error)}`;
          }
        } else {
          this.resumeLimitation = "SEEK_UNSUPPORTED";
        }
      }

      // The rect is always in a 1920x1080 space whatever the panel or the app resolution,
      // and letterbox keeps a channel of any aspect from being stretched to fill it.
      this.phase = "display";
      av.setDisplayRect(0, 0, 1920, 1080);
      av.setDisplayMethod?.(AVPLAY_MODE[this.fit]);

      /*
       * IDLE only. Joining on the lowest rendition puts a picture up quickly and the
       * adaptive logic climbs from there, which is what makes zapping feel immediate.
       *
       * `SKIPBITRATE=LOWEST` used to be here beside it and was costing quality. Samsung
       * documents that parameter twice and the two disagree: the adaptive streaming guide
       * calls it "bit rate to ignore during streaming", the AVPlay reference calls it "the
       * bandwidth to use after a skip operation". Under the first reading the pair asked the
       * set to start on the lowest rendition and to ignore the lowest rendition, in one
       * string, which is either contradictory or a way of skipping the rendition we had just
       * chosen. Neither is what anyone wanted, and nothing here skips: there is no timeline
       * to skip along.
       *
       * Worth knowing that this does nothing for a good many channels: plenty of playlists
       * point straight at a single rendition rather than at a master, and with no ladder to
       * choose from there is no choice to influence. It costs nothing where it does not
       * apply, and helps on the ones that do offer variants.
       */
      const playBufferSec =
        this.mode === "finite"
          ? 5
          : bufferSeconds !== DEFAULT_INITIAL_BUFFER_SECONDS
            ? bufferSeconds
            : 1;
      const resumeBufferSec = this.mode === "finite" ? 5 : 2;
      const initialBufferMs = playBufferSec * 1000;

      this.phase = "streaming";
      if (this.mode === "live") {
        av.setStreamingProperty?.(
          "ADAPTIVE_INFO",
          `STARTBITRATE=LOWEST|INITIAL_BUFFER_SIZE=${initialBufferMs}`,
        );
      } else if (/\.(?:m3u8|mpd)(?:[?#]|$)/i.test(url)) {
        // Progressive VOD has no adaptive ladder. On adaptive VOD this hint is
        // optional: Samsung documents protocol-dependent support for properties.
        try {
          av.setStreamingProperty?.("ADAPTIVE_INFO", "STARTBITRATE=LOWEST");
        } catch {}
      }

      /*
       * Low-latency 1000ms live zapping buffer tuned for IPTV Manager's Rust MPEG-TS proxy
       * (unless compatibility manifest probe dictates a larger segment duration), paired with
       * 5000ms finite VOD/catch-up buffers.
       */
      try {
        av.setBufferingParam?.(
          "PLAYER_BUFFER_FOR_PLAY",
          "PLAYER_BUFFER_SIZE_IN_SECOND",
          playBufferSec,
        );
        av.setBufferingParam?.(
          "PLAYER_BUFFER_FOR_RESUME",
          "PLAYER_BUFFER_SIZE_IN_SECOND",
          resumeBufferSec,
        );
      } catch {
        /* older firmware may not have it, and the default is only slower */
      }

      // How long to wait for a channel that is not coming. This only shortens the wait: the
      // player is documented to hang thirty seconds on a connection failure, and cutting that
      // to fifteen means AVPlay names the fault before the app's own watchdog gives up and
      // reports a bare timeout instead.
      try {
        av.setTimeoutForBuffering?.(15);
      } catch {
        /* older firmware may not have it */
      }

      /**
       * What the server said, kept until something fails and then spent on the explanation.
       *
       * AVPlay reports the HTTP status through onevent and the failure through onerror, in that
       * order and as two separate facts. Neither is much use alone: 403 with no failure is a
       * segment that will be retried, and PLAYER_ERROR_CONNECTION_FAILED with no status cannot
       * tell a refusal from a dead host. Joined, the viewer gets told the truth.
       */
      let status = "";

      this.phase = "listener";
      av.setListener({
        onbufferingstart: () => {
          if (active()) this.emit({ type: "buffering" });
        },
        onbufferingprogress: (percent) => {
          if (active()) this.emit({ type: "buffering", percent });
        },
        onbufferingcomplete: () => {
          if (active()) {
            this.inspectTracks();
            this.emit({ type: "playing" });
          }
        },
        onstreamcompleted: () => {
          if (active()) {
            this.clearSubtitle();
            this.emit({ type: "ended" });
          }
        },
        onevent: (id, data) => {
          if (!active()) return;
          const event = String(id);
          const value = String(data).trim();
          if (event === "PLAYER_MSG_HTTP_ERROR_CODE") status = value;
          if (event === "PLAYER_MSG_BITRATE_CHANGE") {
            if (this.lastBitrate && this.lastBitrate !== value) this.switches += 1;
            this.lastBitrate = value;
          }
          if (event === "PLAYER_MSG_RESOLUTION_CHANGED") {
            this.applyFit();
            this.emitVideoResolution();
          }
          if (/TRACK|STREAM_INFO/.test(event)) this.inspectTracks();
        },
        onsubtitlechange: (duration, text) => {
          if (!active()) return;
          if (this.subtitlesSuppressed) return;
          this.clearSubtitle();
          const cue = String(text ?? "").trim();
          if (!cue) return;
          this.emit({ type: "subtitle", text: cue });
          this.subtitleTimer = window.setTimeout(
            () => {
              if (active()) this.clearSubtitle();
            },
            Number.isFinite(duration) && duration > 0 ? duration : 5000,
          );
        },
        /*
         * onerrormsg where the firmware sends one, onerror otherwise, and never both: they
         * describe one failure, and `fail` keeps the first explanation on purpose, so whichever
         * arrives first is the one the viewer sees. The message is appended rather than
         * substituted because services/errors.ts matches on the code.
         */
        onerror: (code) => {
          if (active()) this.fail(withStatus(String(code), status));
        },
        onerrormsg: (code, message) => {
          if (active())
            this.fail(withStatus(`${String(code)} ${String(message)}`.trim(), status));
        },
      });

      this.phase = "prepare";
      this.emit({ type: "buffering" });
      av.prepareAsync(
        // IDLE -> READY
        () => {
          if (!active()) return;
          try {
            this.phase = "tracks";
            this.inspectTracks();
            this.applyFit();
            if (!active()) return;
            this.phase = "play";
            av.play(); // READY -> PLAYING
            this.applyFit();
            this.inspectTracks();
            this.phase = "playing";
            this.emit({ type: "playing" });
          } catch (error) {
            this.fail(withStatus(codeOf(error), status));
          }
        },
        (e) => {
          if (active()) this.fail(withStatus(codeOf(e), status));
        },
      );
    } catch (e) {
      this.fail(codeOf(e));
    }
  }

  inspectTracks(): void {
    if (onTizen()) {
      try {
        const av = window.webapis?.avplay;
        const trackList = av?.getTotalTrackInfo?.() ?? [];
        const audio: AudioTrack[] = [];
        const subs: SubtitleTrack[] = [];

        for (const track of trackList) {
          const extra = streamInfo(track.extra_info);
          const lang = String(extra.language ?? extra.tracklang ?? extra.lang ?? "").trim();
          const fourcc = String(
            extra.fourcc ?? extra.codec ?? extra.codectype ?? extra.encoding ?? "",
          ).trim();
          const channels = finite(extra.channels ?? extra.channel);

          if (track.type === "AUDIO") {
            const langLabel = formatTrackLanguage(lang);
            const codecLabel = formatAudioCodec(fourcc);
            const label = codecLabel ? `${langLabel} (${codecLabel})` : langLabel;
            audio.push({
              index: track.index,
              language: lang || "und",
              label,
              format: codecLabel || undefined,
              channels,
            });
          } else if (track.type === "TEXT") {
            const langLabel = formatTrackLanguage(lang);
            const subFormat = formatSubtitleFormat(fourcc || String(extra.subtype ?? ""));
            const label = subFormat ? `${langLabel} (${subFormat})` : langLabel;
            subs.push({
              index: track.index,
              language: lang || "und",
              label,
              format: subFormat || undefined,
            });
          }
        }

        if (audio.length > 0) {
          this.audioTracks = audio;
          if (!audio.some((t) => t.index === this.currentAudioIndex)) {
            this.currentAudioIndex = audio[0].index;
          }
        }
        this.subtitleTracks = subs;
        try {
          const selected = av?.getCurrentStreamInfo?.();
          const nativeAudio = selected?.find((track) => track.type === "AUDIO");
          const nativeSubtitle = selected?.find((track) => track.type === "TEXT");
          if (nativeAudio) this.currentAudioIndex = nativeAudio.index;
          if (this.subtitlesSuppressed) this.currentSubtitleIndex = -1;
          else if (nativeSubtitle) this.currentSubtitleIndex = nativeSubtitle.index;
          else this.currentSubtitleIndex = subs.length ? -2 : -1;

          const prefAudio = useSettings.getState().preferredAudioLanguage;
          if (prefAudio && prefAudio !== "none" && audio.length > 0) {
            const matchIdx = findMatchingTrackIndex(audio, prefAudio);
            if (matchIdx !== undefined && matchIdx !== this.currentAudioIndex) {
              try {
                av?.setSelectTrack?.("AUDIO", matchIdx);
                this.currentAudioIndex = matchIdx;
              } catch {
                // Ignore track switch error
              }
            }
          }

          const prefSub = useSettings.getState().preferredSubtitleLanguage;
          if (prefSub && prefSub !== "none" && subs.length > 0 && !this.subtitlesSuppressed) {
            const matchIdx = findMatchingTrackIndex(subs, prefSub);
            if (matchIdx !== undefined && matchIdx !== this.currentSubtitleIndex) {
              try {
                av?.setSelectTrack?.("TEXT", matchIdx);
                this.currentSubtitleIndex = matchIdx;
              } catch {
                // Ignore track switch error
              }
            }
          }
        } catch {
          // Automatic selection remains unknown rather than falsely reporting Off.
        }
        this.emit({
          type: "tracks",
          audioTracks: this.audioTracks,
          subtitleTracks: this.subtitleTracks,
          audioIndex: this.currentAudioIndex,
          subtitleIndex: this.currentSubtitleIndex,
        });
        this.emitVideoResolution();
      } catch {
        /* Track inspection is optional on older firmware */
      }
      return;
    }
  }

  private emitVideoResolution(): void {
    if (!onTizen()) return;
    try {
      const av = window.webapis?.avplay;
      const videoTrack = av?.getCurrentStreamInfo?.()?.find((track) => track.type === "VIDEO");
      if (!videoTrack) return;
      const info = streamInfo(videoTrack.extra_info);
      const width = finite(info.width);
      const height = finite(info.height);
      const tier = classifyResolution(width, height);
      if (tier) {
        this.emit({ type: "resolution", tier, width, height });
      }
    } catch {
      /* Video stream resolution inspection is optional */
    }
  }

  getAudioTracks(): AudioTrack[] {
    return this.audioTracks;
  }

  getSubtitleTracks(): SubtitleTrack[] {
    return this.subtitleTracks;
  }

  getCurrentAudioTrack(): number {
    return this.currentAudioIndex;
  }

  getCurrentSubtitleTrack(): number {
    return this.currentSubtitleIndex;
  }

  setAudioTrack(index: number): void {
    this.currentAudioIndex = index;
    if (onTizen()) {
      try {
        window.webapis?.avplay?.setSelectTrack?.("AUDIO", index);
      } catch {
        /* ignore */
      }
    }
    this.emit({
      type: "tracks",
      audioTracks: this.audioTracks,
      subtitleTracks: this.subtitleTracks,
      audioIndex: this.currentAudioIndex,
      subtitleIndex: this.currentSubtitleIndex,
    });
  }

  setSubtitleTrack(index: number): void {
    this.clearSubtitle();
    if (onTizen()) {
      try {
        const av = window.webapis?.avplay;
        if (index === -1) {
          av?.setSilentSubtitle?.(true);
        } else {
          av?.setSilentSubtitle?.(false);
          av?.setSelectTrack?.("TEXT", index);
        }
      } catch {
        this.inspectTracks();
        return;
      }
    }
    this.subtitlesSuppressed = index === -1;
    this.currentSubtitleIndex = index;
    if (this.subtitlesSuppressed) {
      this.emit({ type: "subtitle", text: "" });
    }
    this.emit({
      type: "tracks",
      audioTracks: this.audioTracks,
      subtitleTracks: this.subtitleTracks,
      audioIndex: this.currentAudioIndex,
      subtitleIndex: this.currentSubtitleIndex,
    });
  }

  /**
   * Change how the picture is fitted, now, without interrupting it.
   *
   * Both engines accept this mid playback, which is what makes it worth having as a setting
   * rather than something that only takes effect on the next channel.
   */
  private applyTizenDisplayMode(mode: string): void {
    if (!onTizen()) return;
    const av = window.webapis?.avplay;
    if (!av) return;
    try {
      av.setDisplayRect?.(0, 0, 1920, 1080);
    } catch {
      /* ignore when called before open or on unsupported firmware */
    }
    try {
      av.setDisplayMethod?.(mode);
    } catch {
      /* older firmware, or not playing yet: the next open/ready applies it */
    }
  }

  private applyFit(): void {
    if (this.fit === "auto") {
      this.applyAutoAspect();
      return;
    }
    this.applyTizenDisplayMode(AVPLAY_MODE[this.fit]);
  }

  setFit(fit: Fit) {
    this.fit = fit;
    this.applyFit();
  }

  /**
   * Auto 4:3 SD Aspect-Ratio Scaling (AssisTV `NARROW_ASPECT = 1.6`):
   * If decoded width/height < 1.6 (4:3 SD broadcast), stretch to full screen
   * (`PLAYER_DISPLAY_MODE_FULL_SCREEN` / `object-fit: fill`). Otherwise keep 16:9
   * letterboxed (`PLAYER_DISPLAY_MODE_LETTER_BOX` / `object-fit: contain`).
   */
  applyAutoAspect() {
    if (this.fit !== "auto") return;
    if (onTizen()) {
      let isNarrow = false;
      try {
        const av = window.webapis?.avplay;
        let width: number | undefined;
        let height: number | undefined;
        for (const track of av?.getCurrentStreamInfo?.() ?? []) {
          if (track.type === "VIDEO") {
            const info = streamInfo(track.extra_info);
            width = finite(info.width);
            height = finite(info.height);
            break;
          }
        }
        isNarrow = width !== undefined && height !== undefined && width / height < NARROW_ASPECT;
      } catch {
        /* older firmware, or not playing yet */
      }
      this.applyTizenDisplayMode(
        isNarrow ? "PLAYER_DISPLAY_MODE_FULL_SCREEN" : "PLAYER_DISPLAY_MODE_LETTER_BOX",
      );
      return;
    }
  }

  /** Temporarily silence the audio without changing the live playback clock. */
  setMuted(muted: boolean) {
    if (!onTizen()) return;

    const audio = window.tizen?.tvaudiocontrol;
    if (!audio) return;
    try {
      if (muted) {
        if (this.muteBeforeSettings === null) this.muteBeforeSettings = audio.isMute();
        audio.setMute(true);
      } else if (this.muteBeforeSettings !== null) {
        audio.setMute(this.muteBeforeSettings);
        this.muteBeforeSettings = null;
      }
    } catch {
      // The TV audio privilege is optional on older firmware, so playback must continue.
    }
  }

  /** Change audio level without touching the live playback pipeline. */
  adjustVolume(delta: number) {
    if (onTizen()) {
      const audio = window.tizen?.tvaudiocontrol;
      try {
        if (delta > 0) audio?.setVolumeUp?.();
        else if (delta < 0) audio?.setVolumeDown?.();
      } catch {
        // Volume belongs to the TV, so an unavailable audio API must not affect playback.
      }
      return;
    }
  }

  /**
   * Hand the decoder back while the app is off screen, and take it again on return.
   *
   * The guidance is explicit that a hidden app must suspend rather than pause: a TV short
   * of memory kills background apps, and the one holding a decoder goes first.
   *
   * AVPlay preserves the playback state through suspend/restore, including a viewer pause.
   */
  hide() {
    if (!onTizen()) return;
    const av = window.webapis!.avplay!;
    try {
      const state = av.getState();
      if (state === "READY" || state === "PLAYING" || state === "PAUSED") av.suspend?.();
    } catch {
      /* nothing to suspend */
    }
  }

  show() {
    if (!onTizen()) return;
    const av = window.webapis!.avplay!;
    try {
      if (av.getState() !== "NONE") av.restore?.();
    } catch {
      /* nothing to restore */
    }
  }

  getStats(): PlaybackStats {
    if (onTizen()) {
      const stats: PlaybackStats = { engine: "AVPlay", switches: this.switches };
      const av = window.webapis!.avplay!;
      let video: Record<string, unknown> = {};
      let audio: Record<string, unknown> = {};
      try {
        for (const track of av.getCurrentStreamInfo?.() ?? []) {
          if (track.type === "VIDEO") video = streamInfo(track.extra_info);
          if (track.type === "AUDIO") audio = streamInfo(track.extra_info);
        }
      } catch {}

      stats.width = finite(video.width);
      stats.height = finite(video.height);
      stats.videoCodec =
        String(video.fourcc ?? video.codec ?? video.codectype ?? "") || undefined;
      stats.audioCodec =
        String(audio.fourcc ?? audio.codec ?? audio.codectype ?? "") || undefined;
      stats.frameRate = finite(video.framerate);
      stats.bitrate = finite(video.bitrate);

      try {
        stats.bandwidth = finite(av.getStreamingProperty?.("CURRENT_BANDWIDTH"));
        const available = av.getStreamingProperty?.("AVAILABLE_BITRATE") ?? "";
        const levels = available
          .split(/[|,]/)
          .filter((value) => finite(value) !== undefined).length;
        if (levels) stats.levels = levels;
        stats.level = finite(av.getStreamingProperty?.("CURRENT_LEVEL"));
        stats.bufferSeconds = finite(av.getStreamingProperty?.("BUFFER_AHEAD"));
        stats.frameRate = finite(av.getStreamingProperty?.("FRAME_RATE")) ?? stats.frameRate;
        const totalFrames = av.getStreamingProperty?.("TOTAL_FRAMES");
        const droppedFrames = av.getStreamingProperty?.("DROPPED_FRAMES");
        if (totalFrames) stats.totalFrames = nonNegative(totalFrames);
        if (droppedFrames) stats.droppedFrames = nonNegative(droppedFrames);
      } catch {}
      try {
        const scan = av.getVideoSeamlessInfo?.().scan_type;
        if (scan === 0) stats.scan = "interlaced";
        if (scan === 1) stats.scan = "progressive";
      } catch {}
      return stats;
    }

    return { engine: "Unavailable", switches: 0 };
  }

  async seekTo(targetSeconds: number): Promise<boolean> {
    if (this.mode !== "finite" || !Number.isFinite(targetSeconds)) return false;
    const current = this.getPosition();
    if (current === null) return false;
    return this.seekBy(targetSeconds - current);
  }

  async seekBy(seconds: number): Promise<boolean> {
    if (this.mode !== "finite" || !Number.isFinite(seconds) || seconds === 0) return false;
    const current = this.getPosition();
    if (current === null) return false;
    const duration = this.getDuration();
    const target = Math.max(
      0,
      duration === null ? current + seconds : Math.min(duration, current + seconds),
    );
    const delta = target - current;
    if (delta === 0) return true;

    this.seeking = true;
    const finish = (success: boolean) => {
      this.seeking = false;
      this.lastPosition = this.getPosition() ?? target;
      this.stalledFor = 0;
      return success;
    };

    if (!onTizen()) return finish(false);

    const av = window.webapis!.avplay!;
    const state = av.getState();
    if (state !== "READY" && state !== "PLAYING" && state !== "PAUSED") {
      return finish(false);
    }
    const exact = state === "READY" || Math.abs(delta - seconds) > 0.001;
    const operation = exact ? av.seekTo : delta > 0 ? av.jumpForward : av.jumpBackward;
    if (!operation) return finish(false);

    return new Promise<boolean>((resolve) => {
      const succeeded = () => resolve(finish(true));
      const failed = () => resolve(finish(false));
      try {
        operation.call(av, exact ? target * 1000 : Math.abs(delta) * 1000, succeeded, failed);
      } catch {
        failed();
      }
    });
  }

  pause() {
    this.held = true;
    setScreenSaverState(false);
    if (onTizen()) {
      try {
        window.webapis!.avplay!.pause?.();
      } catch {
        /* nothing to pause */
      }
    }
  }

  /**
   * Come back from a pause, at the live edge.
   *
   * A pause on live television is a hole, not a bookmark. Resuming where it stopped leaves
   * the viewer permanently behind the broadcast with no way back, which was a genuine trap
   * once the seek bar went: five minutes on the telephone and every channel is five minutes
   * late for the rest of the evening, with nothing on screen explaining why.
   *
   * So resuming rejoins the channel. One native playback path, and it repairs the case
   * these servers make common anyway: a relay that dropped the connection while nobody was
   * watching. It costs the couple of seconds any channel change costs, which is exactly what
   * a viewer pressing Play after a pause expects to see.
   */
  resumePlayback() {
    this.held = false;
    if (onTizen()) {
      try {
        const av = window.webapis!.avplay!;
        if (av.getState() === "PAUSED") {
          av.play();
          setScreenSaverState(true);
        }
      } catch (error) {
        this.fail(codeOf(error));
      }
      return;
    }
  }

  resumeLive(url: string) {
    this.play(url);
  }

  resume(url: string) {
    this.resumeLive(url);
  }

  /** Invalidate native callbacks while keeping the decoder reusable for the next tune. */
  retire() {
    this.attempt++;
    this.teardown(false);
  }

  /** Give the decoder back and let go of the television's video plane entirely. */
  stop() {
    this.attempt++;
    this.setMuted(false);
    this.teardown(true);
  }

  /**
   * Put everything back to a state a new channel can start from.
   *
   * `release` is the difference between changing channel and finishing with the player.
   * Both reach a state open() is legal in, but close() destroys the AVPlay instance, so
   * only a real stop asks for it. Zapping stays one stop away from the next channel.
   */
  private teardown(release: boolean) {
    this.clearSubtitle();
    window.clearTimeout(this.watchdog);
    this.watchdog = undefined;
    window.clearInterval(this.progress);
    this.progress = undefined;
    this.held = false;
    this.seeking = false;
    setScreenSaverState(false);
    if (onTizen()) {
      const av = window.webapis!.avplay!;
      try {
        if (av.getState() !== "NONE") {
          av.stop();
          if (release) av.close();
        }
      } catch {
        // Closing an already closed player throws, which is not worth reporting.
      }
    }
  }
}
