/** Test-only native API stand-in, injected before the final WGT boots. No decoder
 * or provider claim: exercise the real packaged Player, event ownership and UI. */
export function installAvplayFixture() {
  var state = "NONE",
    url = "",
    listener = null,
    position = 0;
  var probe = { state: state, urls: [], fail: false, rejectedHints: 0 };
  window.__nativePlaybackProbe = probe;
  // Desktop Chromium has no Samsung video plane/plugin. Supply its identity
  // without instantiating the unsupported application/avplayer plugin.
  document.addEventListener("DOMContentLoaded", () => {
    if (document.getElementById("avplay-surface")) return;
    var surface = document.createElement("div");
    surface.id = "avplay-surface";
    surface.hidden = true;
    document.body.insertBefore(surface, document.body.firstChild);
  });
  function change(next) {
    state = next;
    probe.state = next;
  }
  window.webapis = {
    avplay: {
      getState: () => state,
      open: (next) => {
        if (state !== "NONE" && state !== "IDLE")
          throw new DOMException("Invalid open state", "InvalidStateError");
        url = next;
        probe.urls.push(next);
        if (probe.urls.length > 16) probe.urls.shift();
        position = 0;
        change("IDLE");
      },
      stop: () => {
        var old = listener;
        if (state === "PLAYING" && old)
          setTimeout(() => {
            if (old.onerror) old.onerror("PLAYER_ERROR_INVALID_OPERATION");
          }, 1);
        change("IDLE");
      },
      close: () => {
        change("NONE");
      },
      setDisplayRect: () => {},
      setDisplayMethod: () => {},
      setListener: (next) => {
        listener = next;
      },
      setStreamingProperty: () => {
        if (/\.(mp4|mkv)([?#]|$)/i.test(url)) {
          probe.rejectedHints++;
          throw new DOMException("Unsupported progressive hint", "InvalidValuesError");
        }
      },
      setBufferingParam: () => {
        if (state !== "IDLE")
          throw new DOMException("Invalid buffer state", "InvalidStateError");
      },
      setTimeoutForBuffering: () => {},
      prepareAsync: (ok, fail) => {
        if (state !== "IDLE")
          throw new DOMException("Invalid prepare state", "InvalidStateError");
        setTimeout(() => {
          if (probe.fail) {
            fail({ name: "PLAYER_ERROR_INVALID_PARAMETER" });
            return;
          }
          change("READY");
          ok();
        }, 10);
      },
      play: () => {
        if (state !== "READY" && state !== "PAUSED")
          throw new DOMException("Invalid play state", "InvalidStateError");
        change("PLAYING");
      },
      pause: () => {
        change("PAUSED");
      },
      getCurrentTime: () => position,
      getDuration: () => 3600000,
      seekTo: (ms, ok) => {
        position = ms;
        if (ok) ok();
      },
      getTotalTrackInfo: () => [],
      getCurrentStreamInfo: () => [],
    },
  };
}
