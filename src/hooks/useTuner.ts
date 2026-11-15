import { useCallback, useEffect, useRef, useState } from "react";
import { findMatchingTrackIndex, useSettings } from "../stores/settings";
import { releaseLogos } from "../services/logos";
import { classifyResolution, type VideoQualityTier } from "../services/playbackLabels";
import type { AudioTrack, Fit, SubtitleTrack } from "../services/player";
import { onTizen, type PlaybackStats, Player, type PlayerEvent } from "../services/player";
import {
  idleRepair,
  pauseRepair,
  prepare,
  rememberNeedsRepair,
  repair,
  resumeRepair,
  revalidate,
  stopRepair,
} from "../services/repair";
import type { Channel, PlaybackTarget } from "../types";

/*
 * Everything to do with getting a picture on the screen and keeping it there.
 *
 * The player's lifetime, which channel is on, which one the viewer has landed on but not yet
 * tuned, whether it is busy, paused or broken, and what to do about it when it breaks. All of
 * that used to sit in the component alongside the panel's cursor and the settings sheet, and
 * it is the part with the timers in it, which is the part that repays being on its own.
 */

/**
 * How long channel up and down wait before actually tuning.
 *
 * Holding the channel key sends thirty presses a second, and each one used to tear down the
 * decoder and rebuild it against a new server. That is the worst thing this app can do to a
 * television: the picture never appears, the sound stutters, and on the set it eventually
 * gives up entirely. So the name changes at once and the tuning waits for the viewer to stop.
 *
 * Just under half a second. Long enough that walking through ten channels tunes once, short
 * enough that a single deliberate press does not feel like a delay.
 */
const ZAP_SETTLE_MS = 450;

const HTTP_FALLBACK_FAULT =
  /CONNECTION_FAILED|NETWORK|manifestLoad|levelLoad|fragLoad|TIMEOUT|CIPHER|CERT|NOT_SUPPORTED/i;

const canUseHttpFallback = onTizen;

export const httpFallback = (
  address: string,
  pageProtocol = typeof window === "undefined" ? "" : window.location.protocol,
  pageOrigin = typeof window === "undefined" ? "" : window.location.origin,
): string => {
  try {
    const url = new URL(address);
    if (url.origin === pageOrigin && url.pathname === "/__openiptv_http_relay__") return "";
    if (url.protocol === "https:") url.protocol = "http:";
    else if (url.protocol !== "http:" || pageProtocol !== "http:") return "";
    if (pageProtocol === "http:") {
      const relay = new URL("/__openiptv_http_relay__", pageOrigin);
      relay.searchParams.set("url", url.toString());
      return relay.toString();
    }
    return url.toString();
  } catch {
    return "";
  }
};

/**
 * How long to wait before trying a failed channel again, and how many times.
 *
 * These are public relays and the commonest fault by far is temporary: a stream that returns
 * on its own within half a minute. Expecting the viewer to sit there pressing a button to
 * find out is the wrong way round, so the app keeps trying while they watch it happen, and
 * stops rather than retrying for ever behind a black screen.
 */
export const RETRY_DELAYS_MS = [4000, 8000, 15000];
export const RETRY_WINDOW_MS = 5 * 60 * 1000;

type TuneItem = Channel | PlaybackTarget;

const targetOf = (item: TuneItem): PlaybackTarget =>
  "mode" in item
    ? item
    : {
        id: item.id,
        playlistId: item.xtream?.playlistId ?? "",
        mode: "live",
        kind: "live",
        name: item.name,
        group: item.group,
        logo: item.logo,
        url: item.url,
      };

export interface TunerOptions {
  /** The list channel up and down walks, which is whatever the viewer is looking at. */
  list: TuneItem[];
  /** How the picture should be fitted, reapplied after every start. */
  fit: Fit;
  /** Remember what was on, so the app can come back to it. */
  rememberLast: (id: string) => void;
  /** A channel has been named. The banner wants to come up and stay up. */
  onNamed: () => void;
  /** A picture has arrived, and its name is worth reading now rather than before. */
  onPicture: () => void;
  /** The channel failed. The card over the picture says everything, so the banner goes. */
  onFault: () => void;
  /**
   * Whether the viewer has turned compatibility on, which is the only thing that allows a
   * channel to be played through a playlist this application has repaired.
   */
  compatibility: boolean;
}

export interface Tuner {
  /** The channel actually being played. */
  current: PlaybackTarget | null;
  /** The channel landed on but not yet tuned, while the channel key is still going. */
  preview: PlaybackTarget | null;
  /** What the banner should name: the one being walked to, or failing that the one on. */
  shown: PlaybackTarget | null;
  busy: boolean;
  paused: boolean;
  /** How full the buffer is while connecting, where the engine reports it, and null otherwise. */
  filling: number | null;
  /** The engine's own name for the fault, or empty when there is none. */
  fault: string;
  /** Seconds the channel now tuning has been tuning, so a slow one can say so. */
  waited: number;
  /** Seconds until the next automatic attempt, or zero when none is pending. */
  retryIn: number;
  /** Automatic attempts already made at this channel. */
  attempt: number;
  position: number | null;
  duration: number | null;
  completed: boolean;
  start: (target: TuneItem) => void;
  retune: () => void;
  /** Give up on the channel entirely, leaving nothing playing. */
  clear: () => void;
  /** Walk the list by one, naming at once and tuning when the pressing stops. */
  step: (delta: number) => void;
  setPlaying: (play: boolean) => void;
  togglePause: () => void;
  seek: (deltaSeconds: number) => Promise<boolean>;
  seekTo: (targetSeconds: number) => Promise<boolean>;
  setMuted: (muted: boolean) => void;
  adjustVolume: (delta: number) => void;
  getStats: () => PlaybackStats | null;
  audioTracks: AudioTrack[];
  currentAudioTrack: number;
  subtitleTracks: SubtitleTrack[];
  currentSubtitleTrack: number;
  subtitleText: string;
  resolution: VideoQualityTier | null;
  setAudioTrack: (index: number) => void;
  setSubtitleTrack: (index: number) => void;
}

export function useTuner(options: TunerOptions): Tuner {
  const { list, fit, rememberLast, onNamed, onPicture, onFault, compatibility } = options;

  const [current, setCurrent] = useState<PlaybackTarget | null>(null);
  const [preview, setPreview] = useState<PlaybackTarget | null>(null);
  const [busy, setBusy] = useState(false);
  const [paused, setPaused] = useState(false);
  const [fault, setFault] = useState("");
  const [filling, setFilling] = useState<number | null>(null);
  const [waited, setWaited] = useState(0);
  const [retryIn, setRetryIn] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [position, setPosition] = useState<number | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [completed, setCompleted] = useState(false);
  const [audioTracks, setAudioTracks] = useState<AudioTrack[]>([
    { index: 0, language: "und", label: "Default" },
  ]);
  const [currentAudioTrack, setCurrentAudioTrack] = useState(0);
  const [subtitleTracks, setSubtitleTracks] = useState<SubtitleTrack[]>([]);
  const [currentSubtitleTrack, setCurrentSubtitleTrack] = useState(-2);
  const [subtitleText, setSubtitleText] = useState("");
  const [resolution, setResolution] = useState<VideoQualityTier | null>(null);

  const player = useRef<Player | null>(null);
  /** The current channel as it is now, for callbacks that run between renders. */
  const currentRef = useRef<PlaybackTarget | null>(null);
  currentRef.current = current;
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const mutedRef = useRef(false);
  /**
   * The pending channel, as a ref as well as state.
   *
   * State because the banner has to redraw for it, and a ref because the next press has to
   * count from it before React has caught up. Counting from the playing channel instead
   * meant every press in a burst stepped from the same place, so the tenth press landed on
   * the second channel.
   */
  const previewRef = useRef<PlaybackTarget | null>(null);
  const zapTimer = useRef<number | undefined>(undefined);
  const retryTimer = useRef<number | undefined>(undefined);
  /** The channel whose arrival has been announced, so it is announced only once. */
  const announced = useRef("");
  /** Attempts made, as a ref, so an automatic retry cannot reset its own budget. */
  const attempts = useRef(0);
  const retryHistory = useRef<number[]>([]);
  const faultRef = useRef(fault);
  faultRef.current = fault;

  // The callbacks are held so the player's listener can be built once and still reach the
  // latest of them. Rebuilding the player when a parent re-renders would tear the picture
  // down for no reason at all.
  const hooks = useRef({ onNamed, onPicture, onFault });
  hooks.current = { onNamed, onPicture, onFault };

  /** One AVPlay controller per mount; stop its decoder/timers on cleanup. */
  useEffect(() => {
    const onEvent = (e: PlayerEvent) => {
      if (e.type === "buffering") {
        setBusy(true);
        /*
         * How full the buffer is, when the engine says so, and nothing when it does not.
         *
         * Only the television reports this, so a browser shows what it always showed. Kept as
         * null rather than 0 for the difference between "no progress reported" and "reported
         * nothing yet": a nought on screen reads as a channel that is getting nowhere.
         */
        if (e.percent !== undefined)
          setFilling(Math.min(100, Math.max(0, Math.round(e.percent))));
        return;
      }
      if (e.type === "playing") {
        faultRef.current = "";
        window.clearTimeout(retryTimer.current);
        setRetryIn(0);
        setBusy(false);
        setFilling(null);
        setFault("");
        setPaused(false);
        /*
         * Announce the channel once, when its picture first arrives.
         *
         * A stream that recovers from a stall reports playing again, and that fires four
         * times in twenty quiet seconds on a live channel. Treating each one as an arrival
         * kept the banner rising from the dead, and since OK dismisses an arrival, OK could
         * never get past it to open the channel list.
         */
        const playing = currentRef.current?.id ?? "";
        const stats = player.current?.getStats();
        const tier = classifyResolution(stats?.width, stats?.height);
        if (tier) setResolution(tier);
        if (announced.current !== playing) {
          announced.current = playing;
          hooks.current.onPicture();
        }
        return;
      }
      if (e.type === "resolution") {
        setResolution(e.tier);
        return;
      }
      if (e.type === "tracks") {
        setAudioTracks(e.audioTracks);
        setSubtitleTracks(e.subtitleTracks);
        let audioIdx = e.audioIndex;
        let subIdx = e.subtitleIndex;

        const prefAudio = useSettings.getState().preferredAudioLanguage;
        if (prefAudio && prefAudio !== "none") {
          const match = findMatchingTrackIndex(e.audioTracks, prefAudio);
          if (match !== undefined && match !== audioIdx) {
            player.current?.setAudioTrack(match);
            audioIdx = match;
          }
        }

        const prefSub = useSettings.getState().preferredSubtitleLanguage;
        if (prefSub && prefSub !== "none" && subIdx !== -1) {
          const match = findMatchingTrackIndex(e.subtitleTracks, prefSub);
          if (match !== undefined && match !== subIdx) {
            player.current?.setSubtitleTrack(match);
            subIdx = match;
          }
        }

        setCurrentAudioTrack(audioIdx);
        setCurrentSubtitleTrack(subIdx);
        const stats = player.current?.getStats();
        const tier = classifyResolution(stats?.width, stats?.height);
        if (tier) setResolution(tier);
        return;
      }
      if (e.type === "subtitle") {
        setSubtitleText(e.text.trim());
        return;
      }
      if (e.type === "ended" && currentRef.current?.mode === "finite") {
        setBusy(false);
        setPaused(false);
        setCompleted(true);
        setPosition(player.current?.getPosition() ?? null);
        setDuration(player.current?.getDuration() ?? null);
        hooks.current.onFault();
        return;
      }
      /*
       * A failure puts the banner away as well as raising the card.
       *
       * The card carries the name and everything else, so the banner is not drawn over a
       * fault, and leaving it up while it is invisible would quietly cost the viewer a press.
       */
      setBusy(false);
      hooks.current.onFault();
      faultRef.current = e.type === "ended" ? "STREAM_ENDED" : e.code;
      setFault(faultRef.current);
    };

    const made = new Player(onEvent);
    player.current = made;
    made.setMuted(mutedRef.current);
    return () => {
      tuneToken.current += 1;
      made.stop();
      player.current = null;
    };
  }, []);

  useEffect(() => {
    if (current?.mode !== "finite" || completed) {
      if (!current) {
        setPosition(null);
        setDuration(null);
      }
      return;
    }
    const update = () => {
      setPosition(player.current?.getPosition() ?? null);
      setDuration(player.current?.getDuration() ?? null);
    };
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [current, completed]);

  // Applied on every change and after every channel start, since a fresh AVPlay instance
  // begins on its own default.
  useEffect(() => {
    player.current?.setFit(fit);
  }, [fit, current?.id]);

  /**
   * Give back what the television needs while the app is off screen.
   *
   * The decoder first, because the guidance is explicit that a hidden app suspends rather
   * than pauses, and an app holding a decoder is the first one a set short of memory kills.
   * The logo cache with it: a few hundred small bitmaps nobody can see is exactly the memory
   * that decides whether this app is still running when the viewer comes back.
   */
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) {
        player.current?.hide();
        releaseLogos();
        // The socket stays, the refetching stops: bandwidth is the expensive half and nobody is
        // watching. See services/repair.
        pauseRepair();
      } else {
        player.current?.show();
        resumeRepair();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  useEffect(
    () => () => {
      window.clearTimeout(zapTimer.current);
      window.clearTimeout(retryTimer.current);
    },
    [],
  );

  /**
   * Count the seconds a channel has been tuning, so a slow one can say so.
   *
   * A slow connection and a channel that is off the air look exactly alike, and the viewer is
   * the one deciding whether to keep waiting, so the wait has to report on itself.
   */
  useEffect(() => {
    if (!busy) {
      setWaited(0);
      return;
    }
    const started = Date.now();
    const t = window.setInterval(
      () => setWaited(Math.round((Date.now() - started) / 1000)),
      1000,
    );
    return () => window.clearInterval(t);
  }, [busy, current?.id]);

  /**
   * Where a channel is played from, which is the one place that decides it.
   *
   * Compatibility mode checks the playlist before tuning, so a stream this television cannot read
   * never has to show its first frame and then stall. When the check finds nothing to repair, the
   * original address is used.
   *
   * The token is what makes it safe to be asynchronous. A viewer holding the channel key can
   * start three channels while one repair is in flight, and only the newest tune may reach the
   * player: without this, an old repair landing late would tune away from what they are watching.
   */
  /**
   * The toggle as it is now, read from a ref because `tuneTo` must not be rebuilt when it changes.
   *
   * Rebuilding it would rebuild `start` and `retune` with it, and those are handed to the key
   * handler and to the retry effect: a new identity means the effect that schedules retries tears
   * itself down and starts again, which resets the countdown a viewer is watching.
   */
  const wantsRepair = useRef(compatibility);
  wantsRepair.current = compatibility;

  const tuneToken = useRef(0);
  const httpFallbackTried = useRef("");
  const tuneTo = useCallback((target: PlaybackTarget, automatic = false) => {
    // Retire native callbacks before awaiting manifest repair for a new tune.
    player.current?.retire();
    setSubtitleText("");
    setSubtitleTracks([]);
    setCurrentSubtitleTrack(-2);
    tuneToken.current += 1;
    const token = tuneToken.current;
    const play = (url: string, bufferSeconds?: number) => {
      if (tuneToken.current !== token || currentRef.current !== target) return;
      if (automatic && target.mode === "live") {
        retryHistory.current = retryHistory.current.filter(
          (at) => Date.now() - at < RETRY_WINDOW_MS,
        );
        if (retryHistory.current.length >= RETRY_DELAYS_MS.length) {
          attempts.current = retryHistory.current.length;
          setAttempt(attempts.current);
          setBusy(false);
          faultRef.current = "NETWORK";
          setFault("NETWORK");
          hooks.current.onFault();
          return;
        }
        retryHistory.current.push(Date.now());
        attempts.current = retryHistory.current.length;
        setAttempt(attempts.current);
      }
      player.current?.play(url, bufferSeconds, target.mode, target.resumeAt);
    };

    if (!onTizen() || target.mode === "finite") {
      idleRepair();
      play(target.url);
      return;
    }

    if (!wantsRepair.current) {
      /*
       * Compatibility is off, so the original stream is used without probing it.
       *
       * This used to tear the worker down, which closed a socket and threw away a compiled
       * WebAssembly module on every switch away from a repaired channel, and built both again on
       * every switch back. Walking a list of channels crosses that boundary once per press, and a
       * viewer doing it quickly found the consequence: the socket was leaking, because the platform
       * holds the descriptor for the application rather than for the worker.
       */
      idleRepair();
      play(target.url);
      return;
    }
    void prepare(target.url, target.playlistId).then((prepared) => {
      if (tuneToken.current !== token) return;
      if (!wantsRepair.current || !prepared) {
        idleRepair();
        play(target.url);
        return;
      }
      if (!prepared.repaired) {
        idleRepair();
        play(target.url, prepared.bufferSeconds);
        return;
      }
      play(prepared.url, prepared.bufferSeconds);

      if (prepared.cached) {
        void revalidate(target.url, target.playlistId).then((changed) => {
          if (!changed || tuneToken.current !== token || !wantsRepair.current) return;
          setFault("");
          setPaused(false);
          setBusy(true);
          setWaited(0);
          setRetryIn(0);
          announced.current = "";
          tuneTo(target, true);
        });
      }
    });
  }, []);

  useEffect(() => {
    const target = currentRef.current;
    if (!fault || !target || !canUseHttpFallback() || !HTTP_FALLBACK_FAULT.test(fault)) return;
    const fallback = httpFallback(target.url);
    const attemptKey = `${target.id}:${target.url}`;
    if (!fallback || httpFallbackTried.current === attemptKey) return;

    httpFallbackTried.current = attemptKey;
    const downgraded = { ...target, url: fallback };
    currentRef.current = downgraded;
    setCurrent(downgraded);
    setFault("");
    setPaused(false);
    setBusy(true);
    setWaited(0);
    setRetryIn(0);
    announced.current = "";
    tuneTo(downgraded, true);
  }, [fault, tuneTo]);

  /**
   * Try the channel that is already on again, from nothing.
   *
   * Deliberately not through start(): that resets the count of attempts already made, and an
   * automatic retry calling it would retry for ever.
   */
  const retune = useCallback(
    (automatic = false) => {
      const channel = currentRef.current;
      if (!channel) return;
      setFault("");
      setPaused(false);
      setBusy(true);
      setWaited(0);
      setRetryIn(0);
      announced.current = "";
      tuneTo(channel, automatic);
    },
    [tuneTo],
  );

  /**
   * Once per channel, ask whether this is the fault we can repair.
   *
   * The normal path has already checked before tuning. This second check covers a probe that
   * timed out or a stream that changed between the probe and the failure.
   *
   * The test is narrow on purpose. `repair` answers with an address only for a playlist whose
   * media sequence overflows the set's parser, so a channel that is off the air or sending an
   * undecodable codec falls straight through to the retries below and the viewer is told what
   * actually happened. Telling somebody a dead channel is being repaired would be a lie that
   * costs them another twelve seconds.
   *
   * Marked as attempted before the await, so a fault that repeats while the fetch is in flight
   * cannot start a second one.
   */
  const repairAsked = useRef("");
  useEffect(() => {
    if (!fault || fault === "TV_ONLY" || !current || current.mode !== "live" || !compatibility)
      return;
    if (repairAsked.current === current.id) return;
    repairAsked.current = current.id;

    let live = true;
    void repair(current.url, current.playlistId).then((repaired) => {
      if (!live || !repaired) return;
      // Remembered by host, so the next channel from the same source skips the failure entirely,
      // this launch and the next.
      rememberNeedsRepair(current.url, current.playlistId);
      retune(true);
    });
    return () => {
      live = false;
    };
  }, [fault, current, compatibility, retune]);

  /** Three automatic reconnects in a rolling window; recovery preserves recent history. */
  useEffect(() => {
    if (!fault || fault === "TV_ONLY" || !current || current.mode !== "live" || preview) return;
    const target = current;
    const token = tuneToken.current;
    const prune = () => {
      retryHistory.current = retryHistory.current.filter(
        (at) => Date.now() - at < RETRY_WINDOW_MS,
      );
      attempts.current = retryHistory.current.length;
      setAttempt(attempts.current);
    };
    prune();
    const blocked = attempts.current >= RETRY_DELAYS_MS.length;
    const due = blocked
      ? retryHistory.current[0] + RETRY_WINDOW_MS
      : Date.now() + RETRY_DELAYS_MS[attempts.current];
    const stillOwned = () =>
      currentRef.current === target &&
      tuneToken.current === token &&
      !!faultRef.current &&
      !previewRef.current;
    const retry = () => {
      if (!stillOwned() || document.hidden) return;
      prune();
      if (retryHistory.current.length >= RETRY_DELAYS_MS.length) return;
      faultRef.current = "";
      retune(true);
    };
    const update = () =>
      setRetryIn(blocked ? 0 : Math.max(0, Math.ceil((due - Date.now()) / 1000)));
    update();
    const tick = window.setInterval(update, 500);
    const schedule = () => {
      window.clearTimeout(retryTimer.current);
      if (!document.hidden && stillOwned())
        retryTimer.current = window.setTimeout(retry, Math.max(0, due - Date.now()));
    };
    schedule();
    document.addEventListener("visibilitychange", schedule);
    return () => {
      window.clearInterval(tick);
      window.clearTimeout(retryTimer.current);
      document.removeEventListener("visibilitychange", schedule);
    };
  }, [fault, current, preview, retune]);

  /**
   * Start a channel from nothing.
   *
   * Everything transient goes back to where it was before any channel was chosen: a pending
   * automatic retry belongs to a channel nobody is watching any more and is called off, a
   * tune that had not happened yet is abandoned, and the channel becomes unannounced so its
   * arrival is announced again.
   */
  const start = useCallback(
    (item: TuneItem) => {
      const target = targetOf(item);
      if (
        currentRef.current?.id === target.id &&
        currentRef.current?.playlistId === target.playlistId &&
        currentRef.current?.url === target.url
      ) {
        previewRef.current = null;
        setPreview(null);
        return;
      }
      // Written here as well as during render, because anything that starts a channel and then
      // acts on it in the same tick, such as opening the panel onto whatever is playing, would
      // otherwise read the one before.
      httpFallbackTried.current = "";
      currentRef.current = target;
      setCurrent(target);
      setFault("");
      setPaused(false);
      setCompleted(false);
      setPosition(target.resumeAt ?? null);
      setDuration(null);
      setResolution(null);

      window.clearTimeout(retryTimer.current);
      window.clearTimeout(zapTimer.current);
      setRetryIn(0);
      attempts.current = 0;
      retryHistory.current = [];
      setAttempt(0);
      previewRef.current = null;
      setPreview(null);

      // Said immediately rather than waiting for the engine to report buffering, so the gap
      // between asking and the engine answering is not silent.
      setBusy(true);
      setWaited(0);
      announced.current = "";
      hooks.current.onNamed();

      rememberLast(target.id);
      tuneTo(target);
    },
    [rememberLast, tuneTo, retune],
  );

  const clear = useCallback(() => {
    tuneToken.current += 1;
    setSubtitleText("");
    player.current?.stop();
    // Nothing is playing, so nothing needs a socket listening on the set's loopback address.
    stopRepair();
    window.clearTimeout(retryTimer.current);
    window.clearTimeout(zapTimer.current);
    httpFallbackTried.current = "";
    currentRef.current = null;
    previewRef.current = null;
    setCurrent(null);
    setPreview(null);
    setFault("");
    setBusy(false);
    setRetryIn(0);
    setPosition(null);
    setDuration(null);
    setCompleted(false);
    setResolution(null);
    retryHistory.current = [];
    attempts.current = 0;
    setAttempt(0);
    faultRef.current = "";
    announced.current = "";
  }, []);

  /**
   * Channel up and down: name it now, tune it once the pressing stops.
   *
   * Holding the channel key sends about thirty presses a second and each one used to tear
   * down the decoder and open a new connection, so walking ten channels opened ten streams,
   * abandoned nine of them mid-handshake and left the set fighting itself. Now the name
   * changes on every press and the tuning happens once, when the viewer settles, which is
   * also how a television has always behaved.
   */
  const step = useCallback(
    (delta: number) => {
      if (!list.length) return;
      const from = previewRef.current ?? currentRef.current;
      const fromIndex = list.findIndex((item) => item.id === from?.id);
      const origin = fromIndex === -1 ? (delta > 0 ? -1 : 0) : fromIndex;
      const next = (((origin + delta) % list.length) + list.length) % list.length;
      const target = targetOf(list[next]);

      window.clearTimeout(retryTimer.current);
      setResolution(null);
      previewRef.current = target;
      setPreview(target);
      hooks.current.onNamed();

      window.clearTimeout(zapTimer.current);
      zapTimer.current = window.setTimeout(() => start(target), ZAP_SETTLE_MS);
      return next;
    },
    [list, start],
  );

  /**
   * Pause, or come back from a pause and rejoin the broadcast.
   *
   * Coming back re-tunes rather than continuing from where it stopped, because live
   * television has moved on and there is no seek bar to catch up with. Without this a pause
   * left the viewer permanently behind, with nothing on screen to explain it.
   */
  const setPlaying = useCallback(
    (play: boolean) => {
      const channel = currentRef.current;
      if (!channel) return;
      // Nothing to pause until there is a picture. Without this, pausing a channel that was
      // still connecting put "Paused" over a programme that had never started.
      if (!play && busyRef.current) return;
      if (play) {
        setPaused(false);
        if (channel.mode === "finite") {
          player.current?.resumePlayback();
        } else {
          setBusy(true);
          setWaited(0);
          tuneTo(channel);
        }
      } else {
        setPaused(true);
        player.current?.pause();
      }
    },
    [tuneTo],
  );

  const togglePause = useCallback(() => setPlaying(paused), [paused, setPlaying]);

  const seek = useCallback(async (deltaSeconds: number) => {
    if (currentRef.current?.mode !== "finite") return false;
    const moved = (await player.current?.seekBy(deltaSeconds)) ?? false;
    if (moved) {
      setPosition(player.current?.getPosition() ?? null);
      setDuration(player.current?.getDuration() ?? null);
    }
    return moved;
  }, []);

  const seekTo = useCallback(
    async (targetSeconds: number) => {
      if (currentRef.current?.mode !== "finite") return false;
      const currentPos = player.current?.getPosition() ?? 0;
      return seek(targetSeconds - currentPos);
    },
    [seek],
  );

  const setMuted = useCallback((muted: boolean) => {
    mutedRef.current = muted;
    player.current?.setMuted(muted);
  }, []);

  const adjustVolume = useCallback((delta: number) => {
    player.current?.adjustVolume(delta);
  }, []);

  const getStats = useCallback(() => player.current?.getStats() ?? null, []);

  const setAudioTrack = useCallback((index: number) => {
    player.current?.setAudioTrack(index);
  }, []);

  const setSubtitleTrack = useCallback((index: number) => {
    player.current?.setSubtitleTrack(index);
  }, []);

  return {
    current,
    preview,
    shown: preview ?? current,
    busy,
    paused,
    filling,
    fault,
    waited,
    retryIn,
    attempt,
    position,
    duration,
    completed,
    start,
    retune,
    clear,
    step: step as (delta: number) => void,
    setPlaying,
    togglePause,
    seek,
    seekTo,
    setMuted,
    adjustVolume,
    getStats,
    audioTracks,
    currentAudioTrack,
    subtitleTracks,
    currentSubtitleTrack,
    subtitleText,
    resolution,
    setAudioTrack,
    setSubtitleTrack,
  };
}
