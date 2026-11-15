/** Development/CI AVPlay simulation. No media element, decoder or network requests.
 * Imported only behind import.meta.env.DEV, or injected by a test harness.
 */
(() => {
  const nativeApis = window.webapis || {};
  const nativeHost = window.tizen || {};
  if (nativeApis.avplay || nativeHost.application) return;
  let state = "NONE";
  let source = "";
  let listener = {};
  let position = 0;
  let started = Date.now();
  let duration = 0;
  let suspended = false;
  let stalled = false;
  let muted = false;
  let generation = 0;
  let pending;
  let preparationFailure = null;
  let width = 1920;
  let height = 1080;
  const allowed = {
    open: ["NONE", "IDLE"],
    prepareAsync: ["IDLE", "READY"],
    play: ["READY", "PLAYING", "PAUSED"],
    pause: ["PLAYING", "PAUSED"],
    setStreamingProperty: ["IDLE"],
    setBufferingParam: ["IDLE"],
    setDisplayRect: ["IDLE", "READY", "PLAYING", "PAUSED"],
    setDisplayMethod: ["IDLE", "READY", "PLAYING", "PAUSED"],
    setSelectTrack: ["READY", "PLAYING", "PAUSED"],
    suspend: ["READY", "PLAYING", "PAUSED"],
    restore: ["READY", "PLAYING", "PAUSED"],
    seekTo: ["IDLE", "READY", "PLAYING", "PAUSED"],
    jumpForward: ["PLAYING", "PAUSED"],
    jumpBackward: ["PLAYING", "PAUSED"],
  };
  const guard = (name) => {
    if (allowed[name] && allowed[name].indexOf(state) < 0) {
      const error = new Error(`${name} is unavailable in ${state}`);
      error.name = "InvalidStateError";
      throw error;
    }
  };
  const now = () =>
    position + (state === "PLAYING" && !suspended && !stalled ? Date.now() - started : 0);
  const freeze = () => {
    position = now();
    started = Date.now();
  };
  const cancel = () => {
    window.clearTimeout(pending);
    preparationFailure = null;
    generation += 1;
  };
  const notify = (name, value) => {
    if (listener[name]) listener[name](value);
  };
  const seek = (value, done) => {
    position = Math.max(0, duration ? Math.min(duration, value) : value);
    started = Date.now();
    if (done) done();
  };
  const streamInfo = () => [
    { index: 0, type: "VIDEO", extra_info: JSON.stringify({ width, height, fourcc: "H264" }) },
    {
      index: 0,
      type: "AUDIO",
      extra_info: JSON.stringify({ language: "eng", fourcc: "AAC", channels: 2 }),
    },
  ];
  const preview = {
    simulated: true,
    fail(code) {
      const reject = preparationFailure;
      cancel();
      freeze();
      state = "IDLE";
      if (reject) reject({ name: code || "PLAYER_ERROR_CONNECTION_FAILED" });
      else notify("onerror", code || "PLAYER_ERROR_CONNECTION_FAILED");
    },
    stall(value) {
      freeze();
      stalled = !!value;
    },
    complete() {
      freeze();
      if (duration) position = duration;
      state = "READY";
      notify("onstreamcompleted");
    },
    setVideoDimensions(w, h) {
      width = w;
      height = h;
      if (listener.onevent) listener.onevent("PLAYER_MSG_RESOLUTION_CHANGED", "");
    },
    getState: () => state,
    getSource: () => source,
  };
  window.__ZAPPA_TV_PREVIEW__ = preview;
  const avplay = {
    getState: () => state,
    open(url) {
      guard("open");
      cancel();
      source = url;
      position = 0;
      suspended = false;
      stalled = false;
      duration = /\/(movie|series|timeshift)\/|\.(mp4|mkv)(?:[?#]|$)/i.test(url) ? 5400000 : 0;
      state = "IDLE";
    },
    stop() {
      cancel();
      freeze();
      state = "IDLE";
    },
    close() {
      cancel();
      freeze();
      state = "NONE";
    },
    setDisplayRect() {
      guard("setDisplayRect");
    },
    setDisplayMethod() {
      guard("setDisplayMethod");
    },
    setStreamingProperty() {
      guard("setStreamingProperty");
    },
    setBufferingParam() {
      guard("setBufferingParam");
    },
    setTimeoutForBuffering() {},
    setListener(value) {
      listener = value || {};
    },
    prepareAsync(ok, fail) {
      guard("prepareAsync");
      const owned = generation;
      preparationFailure = fail;
      notify("onbufferingstart");
      pending = window.setTimeout(() => {
        if (owned !== generation) return;
        preparationFailure = null;
        state = "READY";
        notify("onbufferingcomplete");
        if (ok) ok();
      }, 100);
    },
    play() {
      guard("play");
      freeze();
      state = "PLAYING";
    },
    pause() {
      guard("pause");
      freeze();
      state = "PAUSED";
    },
    suspend() {
      guard("suspend");
      freeze();
      suspended = true;
    },
    restore() {
      guard("restore");
      started = Date.now();
      suspended = false;
    },
    getCurrentTime() {
      const value = now();
      if (duration && value >= duration && state === "PLAYING") preview.complete();
      return Math.round(duration ? Math.min(duration, value) : value);
    },
    getDuration: () => duration,
    seekTo(value, ok) {
      guard("seekTo");
      seek(value, ok);
    },
    jumpForward(value, ok) {
      guard("jumpForward");
      seek(now() + value, ok);
    },
    jumpBackward(value, ok) {
      guard("jumpBackward");
      seek(now() - value, ok);
    },
    getCurrentStreamInfo: streamInfo,
    getTotalTrackInfo: () =>
      streamInfo().concat([
        { index: 0, type: "TEXT", extra_info: '{"language":"swe","fourcc":"DVB_SUBTITLE"}' },
      ]),
    setSelectTrack() {
      guard("setSelectTrack");
    },
    setSilentSubtitle() {},
    getVideoSeamlessInfo: () => ({ scan_type: 1, rotation_degree: 0 }),
    getStreamingProperty: (key) => (key === "IS_LIVE" ? (duration ? "0" : "1") : ""),
  };
  window.webapis = Object.assign({}, window.webapis, { avplay });
  window.tizen = {
    tvinputdevice: { registerKey() {}, unregisterKey() {}, getKey: (name) => ({ name }) },
    tvaudiocontrol: {
      isMute: () => muted,
      setMute(value) {
        muted = !!value;
      },
      setVolumeUp() {},
      setVolumeDown() {},
    },
    application: {
      getCurrentApplication: () => ({
        exit() {
          preview.complete();
        },
      }),
    },
  };
  function draw() {
    if (!document.body || document.getElementById("zappa-preview-notice")) return;
    document.documentElement.classList.add("tizen");
    const style = document.createElement("style");
    style.id = "zappa-preview-style";
    style.textContent =
      "html.tizen,html.tizen body{background:#071018!important}#avplay-surface{display:none!important}";
    document.head.appendChild(style);
    const notice = document.createElement("div");
    notice.id = "zappa-preview-notice";
    notice.textContent = "Preview — simulated playback";
    notice.style.cssText =
      "position:fixed;bottom:12px;right:16px;z-index:2147483647;padding:8px 12px;background:#071018;color:#bfe9ff;font:18px sans-serif;pointer-events:none";
    document.body.appendChild(notice);
  }
  if (document.body) draw();
  else document.addEventListener("DOMContentLoaded", draw);
})();
