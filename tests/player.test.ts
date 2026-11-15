import assert from "node:assert/strict";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { playbackFailureCode } from "../src/services/playbackFailure";
import {
  formatAudioCodec,
  formatSubtitleFormat,
  formatTrackLanguage,
  onTizen,
  Player,
  type PlayerEvent,
} from "../src/services/player";
import { findMatchingTrackIndex, useSettings } from "../src/stores/settings";

/**
 * The player, which is the riskiest thing in the application and had no tests at all.
 *
 * It drives the native AVPlay engine, and almost all of its interesting
 * behaviour is about time: how long a channel may take to start, how long a still picture is
 * allowed before it counts as frozen, and whether the timers that decide both are called off
 * when they should be. None of that can be reached by looking at the code, and all of it is
 * what the viewer actually experiences when a relay misbehaves.
 *
 * The AVPlay path is the one covered here, because it is the one that runs on a television
 * and the one whose call ordering is load bearing: several of its calls are legal in only
 * one state, so getting the sequence wrong means the channel silently never starts.
 */

/** A stand in for webapis.avplay that records what it was asked to do, and in what order. */
function fakeAVPlay() {
  const calls: string[] = [];
  let state = "NONE";
  let currentTime = 0;
  let duration = 120_000;
  const av = {
    listener: null as null | Record<string, (arg?: unknown) => void>,
    prepared: null as null | { ok: () => void; fail: (e: unknown) => void },
    calls,
    open: (url: string) => {
      calls.push(`open:${url}`);
      state = "IDLE";
    },
    close: () => {
      calls.push("close");
      state = "NONE";
    },
    stop: () => {
      calls.push("stop");
      state = "IDLE";
    },
    play: () => {
      calls.push("play");
      state = "PLAYING";
    },
    pause: () => {
      calls.push("pause");
      state = "PAUSED";
    },
    getState: () => state,
    getCurrentTime: () => currentTime,
    getDuration: () => duration,
    seekTo: (ms: number, ok: () => void, _fail: (e: unknown) => void) => {
      calls.push(`seekTo:${ms}`);
      currentTime = ms;
      ok();
    },
    jumpForward: (ms: number, ok: () => void, _fail: (e: unknown) => void) => {
      calls.push(`jumpForward:${ms}`);
      currentTime = Math.min(duration, currentTime + ms);
      ok();
    },
    jumpBackward: (ms: number, ok: () => void, _fail: (e: unknown) => void) => {
      calls.push(`jumpBackward:${ms}`);
      currentTime = Math.max(0, currentTime - ms);
      ok();
    },
    getCurrentStreamInfo: () => [
      {
        index: 0,
        type: "VIDEO",
        extra_info: JSON.stringify({
          Width: 1920,
          Height: 1080,
          FourCC: "H264",
          Bit_rate: 4_500_000,
          Frame_rate: 50,
        }),
      },
      {
        index: 1,
        type: "AUDIO",
        extra_info: JSON.stringify({ FourCC: "AAC", Bit_rate: 192_000 }),
      },
    ],
    getTotalTrackInfo: () => [
      {
        index: 0,
        type: "VIDEO",
        extra_info: JSON.stringify({ Width: 1920, Height: 1080, FourCC: "H264" }),
      },
      {
        index: 1,
        type: "AUDIO",
        extra_info: JSON.stringify({ language: "swe", four_cc: "mp4a", channels: 2 }),
      },
      {
        index: 2,
        type: "AUDIO",
        extra_info: JSON.stringify({ language: "eng", four_cc: "ac-3", channels: 6 }),
      },
      {
        index: 3,
        type: "TEXT",
        extra_info: JSON.stringify({ track_lang: "swe", four_cc: "dvb" }),
      },
      {
        index: 4,
        type: "TEXT",
        extra_info: JSON.stringify({ track_lang: "eng", subtype: "teletext" }),
      },
    ],
    setSelectTrack: (type: string, index: number) =>
      calls.push(`setSelectTrack:${type},${index}`),
    setSilentSubtitle: (silent: boolean) => calls.push(`setSilentSubtitle:${silent}`),
    getStreamingProperty: (key: string) =>
      (
        ({
          CURRENT_BANDWIDTH: "6200000",
          AVAILABLE_BITRATE: "1500000|3000000|4500000",
          CURRENT_LEVEL: "3",
          BUFFER_AHEAD: "5.5",
          FRAME_RATE: "49.9",
          TOTAL_FRAMES: "100",
          DROPPED_FRAMES: "2",
        }) as Record<string, string>
      )[key] ?? "",
    getVideoSeamlessInfo: () => ({ scan_type: 1, rotation_degree: 0 }),
    setDisplayRect: () => calls.push("setDisplayRect"),
    setDisplayMethod: (m: string) => calls.push(`setDisplayMethod:${m}`),
    // The value as well as the key, since what is asked for matters as much as when.
    setStreamingProperty: (k: string, v: string) =>
      calls.push(`setStreamingProperty:${k}=${v}`),
    setTimeoutForBuffering: (s: number) => calls.push(`setTimeoutForBuffering:${s}`),
    setBufferingParam: (option: string, unit: string, amount: number) =>
      calls.push(`setBufferingParam:${option},${unit},${amount}`),
    suspend: () => calls.push("suspend"),
    restore: () => calls.push("restore"),
    setListener: (l: Record<string, (arg?: unknown) => void>) => {
      av.listener = l;
    },
    prepareAsync: (ok: () => void, fail: (e: unknown) => void) => {
      calls.push("prepareAsync");
      av.prepared = {
        ok: () => {
          state = "READY";
          ok();
        },
        fail,
      };
    },
    advance: (by: number) => {
      currentTime += by;
    },
    setTime: (t: number) => {
      currentTime = t;
    },
    setDuration: (ms: number) => {
      duration = ms;
    },
  };
  return av;
}

let av: ReturnType<typeof fakeAVPlay>;
let events: PlayerEvent[];
let player: Player;
let tvMuted = false;

const codes = () => events.filter((e) => e.type === "error").map((e) => e.code);

beforeEach(() => {
  vi.useFakeTimers();
  av = fakeAVPlay();
  (window as unknown as { webapis: unknown }).webapis = { avplay: av };
  tvMuted = false;
  (window as unknown as { tizen: unknown }).tizen = {
    tvaudiocontrol: {
      isMute: () => tvMuted,
      setMute: (mute: boolean) => {
        tvMuted = mute;
      },
    },
  };
  events = [];
  player = new Player((e) => events.push(e));
});

afterEach(() => {
  player.stop();
  vi.useRealTimers();
  delete (window as unknown as { webapis?: unknown }).webapis;
  delete (window as unknown as { tizen?: unknown }).tizen;
  document.getElementById("avplay-surface")?.remove();
});

test("the TV path is taken when AVPlay is present", () => {
  assert.equal(onTizen(), true);
});

test("unsupported production devices report TV-only playback without media or network work", () => {
  delete (window as unknown as { webapis?: unknown }).webapis;
  const fetch = vi.spyOn(globalThis, "fetch");
  const media = vi.spyOn(HTMLMediaElement.prototype, "play");
  player.play("https://example.invalid/live.m3u8");
  expect(codes()).toEqual(["TV_ONLY"]);
  expect(player.getStats().engine).toBe("Unavailable");
  expect(player.getPosition()).toBeNull();
  expect(player.getDuration()).toBeNull();
  expect(fetch).not.toHaveBeenCalled();
  expect(media).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
  fetch.mockRestore();
  media.mockRestore();
});

test("starting a channel calls AVPlay in the order its states require", () => {
  player.play("http://example.invalid/a.m3u8");

  // setStreamingProperty is legal in IDLE only, which is after open and before prepare.
  // Called any later it throws and the channel never starts, so the order is the behaviour.
  const order = av.calls;
  const at = (needle: string) => order.findIndex((c) => c.startsWith(needle));
  assert.ok(at("open:") >= 0, "never opened");
  assert.ok(at("setStreamingProperty") > at("open:"), "configured before open");
  assert.ok(at("prepareAsync") > at("setStreamingProperty"), "configured after prepare");
  assert.equal(order.filter((c) => c === "play").length, 0, "played before it was ready");
});

test("the status the server sent reaches the explanation, not just the engine's own name", () => {
  player.play("http://example.invalid/a.m3u8");
  // Two facts, in the order the TV sends them: the status through onevent, the failure through
  // onerror. Joined, because CONNECTION_FAILED alone cannot tell a refusal from a dead host.
  av.listener?.onevent?.("PLAYER_MSG_HTTP_ERROR_CODE", "403");
  av.listener?.onerror?.("PLAYER_ERROR_CONNECTION_FAILED");

  const fault = events.find((e) => e.type === "error");
  assert.equal(fault?.type, "error");
  assert.match(fault.code, /PLAYER_ERROR_CONNECTION_FAILED/, "the engine's name is kept");
  assert.match(fault.code, /http 403/, "and the status is carried with it");
});

test("a failure with a message keeps both, and only reports once", () => {
  player.play("http://example.invalid/a.m3u8");
  av.listener?.onerrormsg?.("PLAYER_ERROR_NOT_SUPPORTED_FILE", "codec not supported");
  // The same failure arriving twice is one failure: onerror and onerrormsg describe one event,
  // and the first explanation is the one that survives.
  av.listener?.onerror?.("PLAYER_ERROR_NOT_SUPPORTED_FILE");

  const faults = events.filter((e) => e.type === "error");
  assert.equal(faults.length, 1, "reported twice");
  assert.match(faults[0].code, /codec not supported/);
});

test("buffering progress is passed on, and is absent when the engine says nothing", () => {
  player.play("http://example.invalid/a.m3u8");
  av.listener?.onbufferingstart?.();
  av.listener?.onbufferingprogress?.(42);

  const buffering = events.filter((e) => e.type === "buffering");
  /*
   * Found rather than indexed. play() reports buffering itself before the engine is even asked,
   * so the progress report is the third of three here, and an index would be asserting the
   * order of events that have no reason to keep one.
   */
  assert.equal(buffering.find((e) => e.percent !== undefined)?.percent, 42);
  // A start that said nothing about progress must not read as nought per cent.
  assert.ok(
    buffering.some((e) => e.percent === undefined),
    "the start invented a figure",
  );
});

test("AVPlay statistics normalize current engine values without using playlist labels", () => {
  player.play("http://example.invalid/a.m3u8");
  av.prepared?.ok();

  expect(player.getStats()).toEqual({
    engine: "AVPlay",
    width: 1920,
    height: 1080,
    scan: "progressive",
    videoCodec: "H264",
    audioCodec: "AAC",
    bitrate: 4_500_000,
    bandwidth: 6_200_000,
    bufferSeconds: 5.5,
    frameRate: 49.9,
    droppedFrames: 2,
    totalFrames: 100,
    level: 3,
    levels: 3,
    switches: 0,
  });
});

test("AVPlay statistics stay available when newer optional firmware APIs are absent", () => {
  delete (av as Partial<typeof av>).getVideoSeamlessInfo;
  delete (av as Partial<typeof av>).getStreamingProperty;
  player.play("http://example.invalid/a.m3u8");
  av.prepared?.ok();

  expect(player.getStats()).toEqual({
    engine: "AVPlay",
    width: 1920,
    height: 1080,
    videoCodec: "H264",
    audioCodec: "AAC",
    bitrate: 4_500_000,
    frameRate: 50,
    switches: 0,
  });
});

test("AVPlay counts actual adaptive bitrate changes rather than the initial selection", () => {
  player.play("http://example.invalid/a.m3u8");
  av.listener?.onevent?.("PLAYER_MSG_BITRATE_CHANGE", "1500000");
  av.listener?.onevent?.("PLAYER_MSG_BITRATE_CHANGE", "1500000");
  av.listener?.onevent?.("PLAYER_MSG_BITRATE_CHANGE", "4500000");

  assert.equal(player.getStats().switches, 1);
});

test("the adaptive request starts low and asks the set to skip nothing", () => {
  player.play("http://example.invalid/a.m3u8");
  const asked = av.calls.find((c) => c.startsWith("setStreamingProperty:ADAPTIVE_INFO"));

  // Starting on the lowest rendition is what makes zapping feel immediate, and the adaptive
  // logic climbs from there.
  assert.ok(asked?.includes("STARTBITRATE=LOWEST"), `asked for ${asked}`);
  /*
   * SKIPBITRATE is not to come back. Samsung documents it as both "the bit rate to ignore
   * during streaming" and "the bandwidth to use after a skip operation", and under the first
   * reading `SKIPBITRATE=LOWEST` forbids the very rendition STARTBITRATE has just asked for.
   * Nothing in this app skips anywhere, so there is no reading of it that we want.
   */
  assert.ok(!asked?.includes("SKIPBITRATE"), `asked for ${asked}`);
});

test("the picture is only reported once the engine says it is ready", () => {
  player.play("http://example.invalid/a.m3u8");
  expect(events.map((e) => e.type)).toEqual(["subtitle", "buffering"]);

  av.prepared?.ok();
  expect(events.map((e) => e.type)).toContain("playing");
  assert.ok(av.calls.includes("play"));
});

test("the hardware surface is created once and never replaced", () => {
  player.play("http://example.invalid/a.m3u8");
  player.play("http://example.invalid/b.m3u8");
  // webapis.avplay is a singleton with nothing tying it to an element, so a second object
  // element would send the video to the wrong one.
  assert.equal(document.querySelectorAll("#avplay-surface").length, 1);
});

test("a channel that never starts is given up on after thirty seconds", () => {
  player.play("http://example.invalid/a.m3u8");
  vi.advanceTimersByTime(29_000);
  assert.deepEqual(codes(), [], "gave up early on a channel that was still coming");

  vi.advanceTimersByTime(2_000);
  assert.deepEqual(codes(), ["TIMEOUT"]);
});

test("a channel that starts calls off the watchdog", () => {
  player.play("http://example.invalid/a.m3u8");
  av.prepared?.ok();
  // The programme keeps running, so the only thing that could still fire is the start
  // timeout, and it must not: the channel plainly started.
  for (let i = 0; i < 20; i++) {
    av.advance(3000);
    vi.advanceTimersByTime(3_000);
  }
  assert.deepEqual(codes(), [], "the start timeout fired after the picture had arrived");
});

test("a picture that stops moving is reported as stalled", () => {
  player.play("http://example.invalid/a.m3u8");
  av.prepared?.ok();

  // A frozen relay looks exactly like a playing one: no error, no buffering, no end of
  // stream. The only evidence is a playhead that has stopped.
  vi.advanceTimersByTime(11_000);
  assert.deepEqual(codes(), [], "twelve seconds is the limit, not eleven");

  vi.advanceTimersByTime(3_000);
  assert.deepEqual(codes(), ["STALLED"]);
});

test("a picture that keeps moving is never called stalled", () => {
  player.play("http://example.invalid/a.m3u8");
  av.prepared?.ok();
  for (let i = 0; i < 20; i++) {
    av.advance(3000); // three seconds of programme per tick
    vi.advanceTimersByTime(3_000);
  }
  assert.deepEqual(codes(), []);
});

test("a picture held on purpose is not a fault", () => {
  player.play("http://example.invalid/a.m3u8");
  av.prepared?.ok();
  player.pause();

  // The viewer stopped it, so the frame is still because they asked. Reporting that as a
  // frozen channel is the app arguing with the person using it.
  vi.advanceTimersByTime(60_000);
  assert.deepEqual(codes(), []);
});

test("only the first explanation of a failure is kept", () => {
  player.play("http://example.invalid/a.m3u8");
  av.prepared?.fail({ name: "PLAYER_ERROR_CONNECTION_FAILED" });
  av.listener?.onerror?.("PLAYER_ERROR_NOT_SUPPORTED_FILE");

  // One broken stream produces several errors and the later ones are consequences. The
  // cause is worth more to the viewer than the symptom.
  assert.deepEqual(codes(), ["PLAYER_ERROR_CONNECTION_FAILED"]);
});

test("stopping clears the timers, so nothing is reported afterwards", () => {
  player.play("http://example.invalid/a.m3u8");
  av.prepared?.ok();
  player.stop();
  vi.advanceTimersByTime(120_000);
  assert.deepEqual(codes(), []);
});

test("changing channel goes through stop rather than close", () => {
  player.play("http://example.invalid/a.m3u8");
  av.prepared?.ok();
  av.calls.length = 0;

  player.play("http://example.invalid/b.m3u8");
  // close destroys the instance and the whole pipeline has to be rebuilt, which is the
  // wrong thing to do to a television while somebody is holding the channel key down.
  assert.ok(av.calls.includes("stop"));
  assert.ok(!av.calls.includes("close"));
});

test("the aspect setting reaches the engine and survives a channel change", () => {
  player.setFit("fill");
  assert.ok(av.calls.some((c) => c === "setDisplayMethod:PLAYER_DISPLAY_MODE_FULL_SCREEN"));

  av.calls.length = 0;
  player.play("http://example.invalid/a.m3u8");
  // A fresh AVPlay instance starts on its own default, so the choice has to be reapplied.
  assert.ok(av.calls.some((c) => c === "setDisplayMethod:PLAYER_DISPLAY_MODE_FULL_SCREEN"));
});

test("mid-playback aspect switching refreshes display rect and stretches cleanly on stretch mode (TICKET-2169)", () => {
  player.play("http://example.invalid/live.ts");
  av.prepared?.ok();
  av.calls.length = 0;

  player.setFit("fit");
  assert.deepEqual(av.calls.slice(-2), [
    "setDisplayRect",
    "setDisplayMethod:PLAYER_DISPLAY_MODE_LETTER_BOX",
  ]);

  av.calls.length = 0;
  player.setFit("stretch");
  assert.deepEqual(av.calls.slice(-2), [
    "setDisplayRect",
    "setDisplayMethod:PLAYER_DISPLAY_MODE_FULL_SCREEN",
  ]);

  // Dynamic resolution change on a live stream preserves the active non-auto aspect mode too.
  av.calls.length = 0;
  av.listener?.onevent?.("PLAYER_MSG_RESOLUTION_CHANGED", "");
  assert.deepEqual(av.calls.slice(-2), [
    "setDisplayRect",
    "setDisplayMethod:PLAYER_DISPLAY_MODE_FULL_SCREEN",
  ]);
});

test("muting audio leaves AVPlay running and restores the prior TV mute state", () => {
  player.play("http://example.invalid/a.m3u8");
  av.prepared?.ok();
  av.calls.length = 0;

  player.setMuted(true);
  assert.equal(tvMuted, true);
  assert.equal(av.getState(), "PLAYING");
  assert.ok(!av.calls.includes("stop"), "muting restarted or stopped playback");

  player.setMuted(false);
  assert.equal(tvMuted, false);
  assert.equal(av.getState(), "PLAYING");
});

test("going off screen suspends the decoder rather than pausing it", () => {
  player.play("http://example.invalid/a.m3u8");
  av.prepared?.ok();
  player.hide();
  // A set short of memory kills the background app holding a decoder first.
  assert.ok(av.calls.includes("suspend"));
  player.show();
  assert.ok(av.calls.includes("restore"));
});

test("resuming rejoins the broadcast instead of continuing from the hole", () => {
  player.play("http://example.invalid/a.m3u8");
  av.prepared?.ok();
  player.pause();
  av.calls.length = 0;

  player.resume("http://example.invalid/a.m3u8");
  // Live television has moved on and there is no seek bar to catch up with, so a pause is a
  // hole rather than a bookmark.
  assert.ok(av.calls.some((c) => c.startsWith("open:")));
});

test("a stream that ends is reported, and only once", () => {
  player.play("http://example.invalid/a.m3u8");
  av.prepared?.ok();
  av.listener?.onstreamcompleted?.();
  expect(events.filter((e) => e.type === "ended")).toHaveLength(1);
});

test("how much to buffer before starting is asked for while the player will still accept it", () => {
  /*
   * Both of these are IDLE only, so after open and before prepareAsync or they throw and the
   * channel never starts. One second live buffer gives low-latency IPTV Manager zapping.
   */
  player.play("http://example.invalid/a.m3u8");
  av.prepared?.ok();

  const asked = av.calls.indexOf(
    "setBufferingParam:PLAYER_BUFFER_FOR_PLAY,PLAYER_BUFFER_SIZE_IN_SECOND,1",
  );
  assert.ok(asked !== -1, `never asked: ${av.calls.join(" ")}`);
  assert.ok(
    av.calls.includes(
      "setBufferingParam:PLAYER_BUFFER_FOR_RESUME,PLAYER_BUFFER_SIZE_IN_SECOND,2",
    ),
    "live resume buffer was not set to 2s",
  );
  assert.ok(
    av.calls.includes(
      "setStreamingProperty:ADAPTIVE_INFO=STARTBITRATE=LOWEST|INITIAL_BUFFER_SIZE=1000",
    ),
    "live INITIAL_BUFFER_SIZE=1000 was not set",
  );
  assert.ok(
    av.calls.findIndex((c) => c.startsWith("open")) < asked,
    "asked before the stream was open",
  );
  assert.ok(
    asked < av.calls.indexOf("prepareAsync"),
    "asked once it was too late to be accepted",
  );
});

test("progressive VOD uses the native 5s buffers without adaptive-stream properties", () => {
  player.play("http://example.invalid/movie/1.mp4", 6, "finite");
  av.prepared?.ok();

  assert.ok(!av.calls.some((call) => call.startsWith("setStreamingProperty:ADAPTIVE_INFO")));
  assert.ok(
    av.calls.includes(
      "setBufferingParam:PLAYER_BUFFER_FOR_PLAY,PLAYER_BUFFER_SIZE_IN_SECOND,5",
    ),
    "finite play buffer was not set to 5s",
  );
  assert.ok(
    av.calls.includes(
      "setBufferingParam:PLAYER_BUFFER_FOR_RESUME,PLAYER_BUFFER_SIZE_IN_SECOND,5",
    ),
    "finite resume buffer was not set to 5s",
  );
});

test("screen saver is inhibited while playing and restored on pause, error, and stop", () => {
  const screenStates: number[] = [];
  (window as unknown as { webapis: unknown }).webapis = {
    avplay: av,
    appcommon: {
      AppCommonScreenSaverState: {
        SCREEN_SAVER_ON: 1,
        SCREEN_SAVER_OFF: 0,
      },
      setScreenSaverState: (s: number) => screenStates.push(s),
    },
  };

  player.play("http://example.invalid/a.m3u8");
  screenStates.length = 0;

  av.prepared?.ok();
  assert.equal(screenStates.at(-1), 0, "screen saver should be OFF when playing starts");

  player.pause();
  assert.equal(screenStates.at(-1), 1, "screen saver should be ON when paused");

  player.resumePlayback();
  assert.equal(screenStates.at(-1), 0, "screen saver should be OFF when resumed");

  av.listener.onerror?.("PLAYER_ERROR_CONNECTION_FAILED");
  assert.equal(screenStates.at(-1), 1, "screen saver should be ON on error");

  player.play("http://example.invalid/b.m3u8");
  av.prepared?.ok();
  assert.equal(screenStates.at(-1), 0);

  player.stop();
  assert.equal(screenStates.at(-1), 1, "screen saver should be ON when stopped");
});

test("a longer diagnosed segment can raise the initial buffer", () => {
  player.play("http://example.invalid/a.m3u8", 11);
  av.prepared?.ok();

  assert.ok(
    av.calls.includes(
      "setBufferingParam:PLAYER_BUFFER_FOR_PLAY,PLAYER_BUFFER_SIZE_IN_SECOND,11",
    ),
    "the diagnosed buffer was not passed to AVPlay",
  );
});

test("firmware without the optional calls does not stop a channel starting", () => {
  // Older sets lack setTimeoutForBuffering, setBufferingParam and setDisplayMethod. An app that
  // assumes them throws on open and plays nothing at all.
  const bare = fakeAVPlay() as Partial<ReturnType<typeof fakeAVPlay>>;
  delete bare.setTimeoutForBuffering;
  delete bare.setBufferingParam;
  delete bare.setDisplayMethod;
  delete bare.suspend;
  (window as unknown as { webapis: unknown }).webapis = { avplay: bare };

  const events2: PlayerEvent[] = [];
  const p = new Player((e) => events2.push(e));
  assert.doesNotThrow(() => p.play("http://example.invalid/a.m3u8"));
  assert.deepEqual(
    events2.filter((e) => e.type === "error"),
    [],
  );
  p.stop();
});

test("finite AVPlay reports position and duration in seconds", () => {
  player.play("http://example.invalid/movie/1.mp4", 6, "finite");
  av.prepared?.ok();
  av.setTime(12_500);
  av.setDuration(90_000);

  assert.equal(player.getPosition(), 12.5);
  assert.equal(player.getDuration(), 90);
});

test("finite AVPlay applies a positive initial seek in IDLE before prepare", () => {
  player.play("http://example.invalid/movie/1.mp4", 6, "finite", 35);

  const seek = av.calls.indexOf("seekTo:35000");
  assert.ok(seek > av.calls.findIndex((call) => call.startsWith("open:")));
  assert.ok(seek < av.calls.indexOf("prepareAsync"));
});

test("finite AVPlay continues from zero when initial seek is unavailable", () => {
  delete (av as Partial<typeof av>).seekTo;
  player.play("http://example.invalid/movie/1.mp4", 6, "finite", 35);

  assert.ok(av.calls.includes("prepareAsync"));
  assert.deepEqual(codes(), []);
  assert.equal(player.getResumeLimitation(), "SEEK_UNSUPPORTED");
  av.prepared?.ok();
  assert.ok(av.calls.includes("play"));
});

test("finite AVPlay continues from zero when initial seek is rejected", () => {
  av.seekTo = (_ms: number, _ok: () => void, fail: (error: unknown) => void) => {
    av.calls.push("seekTo:rejected");
    fail({ name: "InvalidStateError" });
  };
  player.play("http://example.invalid/movie/1.mp4", 6, "finite", 35);

  assert.ok(av.calls.includes("prepareAsync"));
  assert.deepEqual(codes(), []);
  assert.match(player.getResumeLimitation() ?? "", /SEEK_FAILED InvalidStateError/);
  av.prepared?.ok();
  assert.ok(av.calls.includes("play"));
});

test("finite AVPlay seeks forward and backward by ten seconds with clamping", async () => {
  player.play("http://example.invalid/movie/1.mp4", 6, "finite");
  av.prepared?.ok();
  av.setTime(115_000);

  assert.equal(await player.seekBy(10), true);
  assert.equal(player.getPosition(), 120);
  assert.equal(await player.seekBy(-10), true);
  assert.equal(player.getPosition(), 110);
});

test("unsupported finite AVPlay seeking is nonfatal and does not change position", async () => {
  delete (av as Partial<typeof av>).seekTo;
  delete (av as Partial<typeof av>).jumpForward;
  delete (av as Partial<typeof av>).jumpBackward;
  player.play("http://example.invalid/movie/1.mp4", 6, "finite");
  av.prepared?.ok();
  av.setTime(20_000);

  assert.equal(await player.seekBy(10), false);
  assert.equal(player.getPosition(), 20);
  assert.deepEqual(codes(), []);
});

test("rejected finite AVPlay seeking is nonfatal and playback can continue", async () => {
  av.jumpForward = (_ms: number, _ok: () => void, fail: (error: unknown) => void) => {
    av.calls.push("jumpForward:rejected");
    fail({ name: "InvalidStateError" });
  };
  player.play("http://example.invalid/movie/1.mp4", 6, "finite");
  av.prepared?.ok();
  av.setTime(20_000);

  assert.equal(await player.seekBy(10), false);
  assert.equal(player.getPosition(), 20);
  assert.deepEqual(codes(), []);
  assert.equal(av.getState(), "PLAYING");
});

test("finite pause resumes in place while live resume opens the live edge", () => {
  player.play("http://example.invalid/movie/1.mp4", 6, "finite");
  av.prepared?.ok();
  player.pause();
  av.calls.length = 0;
  player.resumePlayback();
  assert.deepEqual(av.calls, ["play"]);

  player.resumeLive("http://example.invalid/live.m3u8");
  assert.ok(av.calls.some((call) => call.startsWith("open:http://example.invalid/live.m3u8")));
});

test("a pending finite seek suspends the stall watchdog", async () => {
  let finish = () => {};
  av.jumpForward = (ms: number, ok: () => void) => {
    av.calls.push(`jumpForward:${ms}`);
    finish = ok;
  };
  player.play("http://example.invalid/movie/1.mp4", 6, "finite");
  av.prepared?.ok();
  const seeking = player.seekBy(10);

  vi.advanceTimersByTime(60_000);
  assert.deepEqual(codes(), []);
  finish();
  assert.equal(await seeking, true);
});

test("track language, audio codec, and subtitle format helpers normalize metadata", () => {
  assert.equal(formatTrackLanguage("swe"), "Swedish");
  assert.equal(formatTrackLanguage("eng"), "English");
  assert.equal(formatTrackLanguage("und"), "Default");
  assert.equal(formatTrackLanguage(""), "Default");
  assert.equal(formatTrackLanguage("pol"), "POL");

  assert.equal(formatAudioCodec("eac3"), "E-AC3");
  assert.equal(formatAudioCodec("ac-3"), "AC3");
  assert.equal(formatAudioCodec("mp4a.40.2"), "AAC");
  assert.equal(formatAudioCodec("mp3"), "MP3");
  assert.equal(formatAudioCodec("dts"), "DTS");

  assert.equal(formatSubtitleFormat("dvb"), "DVB");
  assert.equal(formatSubtitleFormat("teletext"), "Teletext");
  assert.equal(formatSubtitleFormat("cea-708"), "CC");
  assert.equal(formatSubtitleFormat("vtt"), "VTT");
});

test("AVPlay inspectTracks enumerates AUDIO and TEXT tracks and switches via setSelectTrack", () => {
  player.play("http://example.invalid/a.m3u8");
  av.prepared?.ok();

  expect(player.getAudioTracks()).toEqual([
    { index: 1, language: "swe", label: "Swedish (AAC)", format: "AAC", channels: 2 },
    { index: 2, language: "eng", label: "English (AC3)", format: "AC3", channels: 6 },
  ]);
  expect(player.getSubtitleTracks()).toEqual([
    { index: 3, language: "swe", label: "Swedish (DVB)", format: "DVB" },
    { index: 4, language: "eng", label: "English (Teletext)", format: "Teletext" },
  ]);
  assert.equal(player.getCurrentAudioTrack(), 1);
  assert.equal(player.getCurrentSubtitleTrack(), -2);

  player.setAudioTrack(2);
  assert.ok(av.calls.includes("setSelectTrack:AUDIO,2"));
  assert.equal(player.getCurrentAudioTrack(), 2);

  player.setSubtitleTrack(3);
  assert.ok(av.calls.includes("setSilentSubtitle:false"));
  assert.ok(av.calls.includes("setSelectTrack:TEXT,3"));
  assert.equal(player.getCurrentSubtitleTrack(), 3);

  (av.listener as Record<string, (duration: number, text: string) => void>)?.onsubtitlechange?.(
    2000,
    "Hej världen",
  );
  const subEvents = events.filter((e) => e.type === "subtitle");
  assert.equal(subEvents.at(-1)?.text, "Hej världen");

  player.setSubtitleTrack(-1);
  assert.ok(av.calls.includes("setSilentSubtitle:true"));
  assert.equal(player.getCurrentSubtitleTrack(), -1);
  assert.equal(
    events.filter((e) => e.type === "subtitle").at(-1)?.text,
    "",
    "disabling subtitles clears active subtitle text",
  );
});

test("auto aspect mode scales 4:3 SD streams to full screen and keeps 16:9 letterboxed", () => {
  // Default fakeAVPlay has 1920x1080 (ratio 1.777 >= 1.6 -> LETTER_BOX)
  player.setFit("auto");
  player.play("http://example.invalid/hd.m3u8");
  av.prepared?.ok();
  assert.equal(
    av.calls.filter((c) => c.startsWith("setDisplayMethod:")).at(-1),
    "setDisplayMethod:PLAYER_DISPLAY_MODE_LETTER_BOX",
  );

  // Switch stream info to 720x576 (4:3 SD, ratio 1.25 < 1.6 -> FULL_SCREEN)
  av.getCurrentStreamInfo = () => [
    {
      index: 0,
      type: "VIDEO",
      extra_info: JSON.stringify({ Width: 720, Height: 576, FourCC: "H264" }),
    },
  ];
  av.listener?.onevent?.("PLAYER_MSG_RESOLUTION_CHANGED", "");
  assert.equal(
    av.calls.filter((c) => c.startsWith("setDisplayMethod:")).at(-1),
    "setDisplayMethod:PLAYER_DISPLAY_MODE_FULL_SCREEN",
  );
});

test("callbacks from the previous live tune cannot fail or play the new VOD attempt", () => {
  player.play("http://example.invalid/live/1.ts");
  const oldListener = av.listener!;
  const oldPrepare = av.prepared!;
  player.play("http://example.invalid/movie/2.mkv", undefined, "finite");
  const before = events.length;
  oldListener.onerror?.("PLAYER_ERROR_INVALID_OPERATION");
  oldListener.onbufferingcomplete?.();
  oldListener.onstreamcompleted?.();
  oldPrepare.fail({ name: "UnknownError" });
  oldPrepare.ok();
  expect(events).toHaveLength(before);
  expect(av.calls.filter((call) => call === "play")).toHaveLength(0);
  av.prepared!.ok();
  expect(av.calls.filter((call) => call === "play")).toHaveLength(1);
  expect(codes()).toEqual([]);
});

test("stop invalidates pending preparation and native callbacks", () => {
  player.play("http://example.invalid/movie/1.mp4", undefined, "finite");
  const pending = av.prepared!;
  const listener = av.listener!;
  player.stop();
  const before = events.length;
  pending.ok();
  pending.fail({ name: "UnknownError" });
  listener.onerror?.("PLAYER_ERROR_CONNECTION_FAILED");
  expect(events).toHaveLength(before);
  expect(av.calls).not.toContain("play");
});

test("finite asynchronous play exceptions report safe stage and state instead of escaping", () => {
  player.play("http://example.invalid/movie/1.mp4", undefined, "finite");
  av.play = () => {
    throw new DOMException(
      "https://private.invalid/movie/secret/token/1.mp4",
      "InvalidStateError",
    );
  };
  expect(() => av.prepared!.ok()).not.toThrow();
  expect(codes()).toEqual(["play/READY: InvalidStateError"]);
});

test("finite prepare failure retains HTTP status without exposing native message credentials", () => {
  player.play("http://example.invalid/movie/1.mp4", undefined, "finite");
  (av.listener!.onevent as (...args: unknown[]) => void)("PLAYER_MSG_HTTP_ERROR_CODE", "403");
  av.prepared!.fail({
    name: "PLAYER_ERROR_CONNECTION_FAILED",
    message: "https://private.invalid/movie/secret/token/1.mp4",
  });
  expect(codes()).toEqual(["prepare/IDLE: PLAYER_ERROR_CONNECTION_FAILED (http 403)"]);
});

test("an unsupported optional adaptive hint does not prevent finite HLS preparation", () => {
  av.setStreamingProperty = () => {
    throw new DOMException("Unsupported hint", "NotSupportedError");
  };
  player.play("http://example.invalid/movie/1.m3u8", undefined, "finite");
  av.prepared!.ok();
  expect(av.calls).toContain("play");
  expect(codes()).toEqual([]);
});

test("failure diagnostics keep engine identity and HTTP status while dropping native URLs and tokens", () => {
  expect(
    playbackFailureCode(
      "PLAYER_ERROR_UNKNOWN https://viewer:secret@private.invalid/movie/token/1.mp4?password=secret (http 502)",
    ),
  ).toBe("PLAYER_ERROR_UNKNOWN (http 502)");
  expect(
    playbackFailureCode(
      "https://viewer:secret@private.invalid/movie/token/1.mp4?password=secret",
    ),
  ).toBe("UNKNOWN_NATIVE_ERROR");
});

test("subtitle replacement, whitespace and expiry cannot leave an empty pill", () => {
  player.play("http://example.invalid/movie.mp4", 5, "finite");
  av.prepared?.ok();
  const cue = (duration: number, text: string) =>
    (av.listener as Record<string, (duration: number, text: string) => void>).onsubtitlechange(
      duration,
      text,
    );
  const last = () => events.filter((event) => event.type === "subtitle").at(-1)?.text;
  cue(2000, "First\nline");
  vi.advanceTimersByTime(1000);
  cue(2000, "Replacement");
  vi.advanceTimersByTime(1000);
  expect(last()).toBe("Replacement");
  vi.advanceTimersByTime(1000);
  expect(last()).toBe("");
  cue(2000, "   \n  ");
  expect(last()).toBe("");
});

test("retired native callbacks cannot restore subtitles during the next tune", () => {
  player.play("http://example.invalid/movie.mp4", 5, "finite");
  av.prepared?.ok();
  const old = av.listener as Record<string, (duration: number, text: string) => void>;
  old.onsubtitlechange(2000, "Old movie");
  player.retire();
  old.onsubtitlechange(2000, "Late old cue");
  vi.advanceTimersByTime(3000);
  expect(events.filter((event) => event.type === "subtitle").at(-1)?.text).toBe("");
  expect(av.calls).not.toContain("close");
});

test("native active subtitle defaults are reported and explicit off survives inspection", () => {
  const streamInfo = av.getCurrentStreamInfo;
  av.getCurrentStreamInfo = () => [
    ...streamInfo(),
    { type: "TEXT", index: 4, extra_info: "{}" },
  ];
  player.play("http://example.invalid/movie.mp4", 5, "finite");
  av.prepared?.ok();
  expect(player.getCurrentSubtitleTrack()).toBe(4);
  player.setSubtitleTrack(-1);
  player.inspectTracks();
  expect(player.getCurrentSubtitleTrack()).toBe(-1);
});

test("findMatchingTrackIndex matches direct codes and labels", () => {
  const audioTracks = [
    { index: 1, language: "eng", label: "English (AAC)" },
    { index: 2, language: "swe", label: "Swedish (AC3)" },
    { index: 3, language: "ara", label: "Arabic (AAC)" },
  ];
  expect(findMatchingTrackIndex(audioTracks, "swe")).toBe(2);
  expect(findMatchingTrackIndex(audioTracks, "ara")).toBe(3);
  expect(findMatchingTrackIndex(audioTracks, "eng")).toBe(1);
  expect(findMatchingTrackIndex(audioTracks, "fra")).toBeUndefined();
  expect(findMatchingTrackIndex(audioTracks, "none")).toBeUndefined();
});

test("inspectTracks automatically selects preferred audio and subtitle tracks when available", () => {
  useSettings.getState().set("preferredAudioLanguage", "swe");
  useSettings.getState().set("preferredSubtitleLanguage", "eng");

  av.getTotalTrackInfo = () => [
    { type: "AUDIO", index: 1, extra_info: JSON.stringify({ language: "eng", fourcc: "aac" }) },
    { type: "AUDIO", index: 2, extra_info: JSON.stringify({ language: "swe", fourcc: "ac3" }) },
    { type: "TEXT", index: 3, extra_info: JSON.stringify({ language: "swe", fourcc: "subt" }) },
    { type: "TEXT", index: 4, extra_info: JSON.stringify({ language: "eng", fourcc: "subt" }) },
  ];

  player.play("http://example.invalid/movie.mp4", 5, "finite");
  av.prepared?.ok();
  player.inspectTracks();

  expect(player.getCurrentAudioTrack()).toBe(2);
  expect(player.getCurrentSubtitleTrack()).toBe(4);

  useSettings.getState().set("preferredAudioLanguage", "none");
  useSettings.getState().set("preferredSubtitleLanguage", "none");
});
