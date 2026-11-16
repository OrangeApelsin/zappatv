# Changelog

Notable changes, newest first, in the format of [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [1.3.0] - 2026-11-16

### Added

- Opt-in HTTPS relay setup and Smart Remote through IPTV Manager, with native outbound WebSocket and bounded polling fallback on Tizen 5.0+.
- Relay URL configuration, QR/manual pairing, localized connection diagnostics, retry and cancellation in English, Swedish and Arabic.
- Persistent relay ownership, suspend/resume handling, fenced reconnects and command expiry without replaying stale input.
- Versioned IPTV Manager relay contract and a real HTTPS packaged-client integration check using disposable registrations.

### Fixed

- Restore the Samsung WebAPI startup loader and handle unavailable network interfaces without ending discovery prematurely.
- Preserve phone credentials when a queued command expires and restore focus when cancelling pairing.
- Account for connection round-trip uncertainty when checking relay deadlines, while expiring dispatch conservatively.

Candidate only until owner acceptance of the exact Tizen 5 package. Packages retain application identity and data and remain unsigned for Apps2Samsung.

## [1.1] - 2026-11-15

### Added

- **Subtitle HTML/CSS Formatting (`TICKET-2301`)**: Built dedicated `SubtitleRenderer` that interprets HTML and CSS markup in subtitle cues. Converts `<br>` to clean line breaks and formats `<b>`/`<strong>` (bold), `<i>`/`<em>` (italics), and `<font color="...">` (colored spans), while stripping unhandled tags so raw markup never leaks onto the picture.
- **"Original" Screen Fit Option & Default (`TICKET-2303`)**: Added `"original"` screen fit mode preserving native untouched broadcast geometry without scaling or zoom distortion via AVPlay letterbox, and configured it as the application default.
- **Minimalist "Up Next" Corner Card + Circular Progress Ring (`TICKET-2308`)**: Replaced the countdown overlay with a sleek 480px bottom-right preview card anchored in the TV title-safe area (`bottom: 64px; right: 72px;`). Features a 16:9 episode thumbnail with dark scrim, centered 56×56 SVG progress ring ($r=24$, circumference $\approx 150.8$) animated proportionally each second with tabular-nums countdown, clamped episode title, and close button. GPU-composited for Tizen 5.0 without `backdrop-filter: blur()`.
- **Grid View "Now Playing" Title Display with Horizontal Marquee (`TICKET-2307`)**: The "Now Playing" toolbar button in VOD and tile grid views now displays the currently playing media title, with smooth CSS horizontal marquee scrolling on long titles while preserving locked button geometry.

### Changed

- **VOD Startup Caching & Incremental Sync Optimization in `zappa-vod` (`TICKET-2302`)**: Enforced a strict cache-first startup strategy using the dedicated 200MB IndexedDB database (`zappa-vod`). Catalogs hydrate in $<300$ms on cold boot before network requests, and background sync leverages timestamps and catalog versions (`action=get_vod_version` / `/api/vod/version`) to skip redundant full-catalog re-downloads.
- **Settings About QR-Code & Repository Target (`TICKET-2305`)**: Updated QR code and repository links across the About page in Settings to target `https://git.halvmj.uk/dany/zappatv`.
- **Modernized Authentic Screenshots (`TICKET-2309`)**: Refreshed all 10 high-resolution application screenshots in `README.md` and `screenshots/` representing the current Zappa TV Aqua translucent interface.

### Performance

- **Zero-Delay Home Card Navigation (`TICKET-2306`)**: Eliminated main-thread lag when pressing cards on the Start Page to transition into Movie or Series grid views through category pre-warming and $O(1)$ resume key matching, matching Live TV's instant 0ms transition.

### Fixed

- **Remote Access LAN Resolution (`TICKET-2304`)**: Resolved false-positive *"Remote setup is unavailable on this network"* error when opening Remote Access in Settings by supporting active Wi-Fi, Ethernet, and CGNAT interface detection on Samsung Tizen TVs.

## [1.0] - 2026-11-14

### Added

- **Dedicated 200MB Persistent VOD Storage (`zappa-vod`)**: Implemented a separate, dedicated IndexedDB database (`zappa-vod`) for movie and series catalogs and metadata, strictly isolated from the 24MB Live TV logo and EPG cache (`openiptv`). Ensures instant cache-first cold start (<300ms) with zero eviction of live channel logos, paired with a 15-minute throttled background version check (`GET /api/vod/version` / `action=get_vod_version`).
- **Up Next Autoplay with Calibrated Timing Buffer**: Smart episode transition countdown overlay (`Off`, `10s`, `15s`, `20s`, `30s`) starting at `setting + 1s` before episode end. The countdown counts down the configured duration to leave exactly 1s of current episode when reaching zero, ensuring uninterrupted playback and seamless stream handover across episodes and seasons. Remote navigation is strictly isolated (`Return` dismisses staying in fullscreen, arrows block OSD).
- **Bare Fullscreen Progressive Seek**: Direct Left/Right seek stepping (`10s` -> `30s` -> `1m` -> `5m` -> `10m`) at bare picture playback is isolated strictly to a transient preview badge without raising the OSD playback banner or moving the scrubber timeline.
- **Smart Previous Transport Logic**: In VOD playback, pressing Previous when playback position exceeds 60 seconds restarts the current item to `0:00`; pressing Previous within the first 60 seconds navigates to the previous episode.
- **Crimson Stop Transport Button**: Added a dedicated, high-contrast crimson Stop button to the VOD playback transport controls for immediate return to the parent navigation view.
- **Modern Aqua Glassmorphism Modal Styling**: Movie Details and Series Resume modals feature dark aqua glassmorphism pills (`.vod-btn`), standard 14px vertical button spacing, and expanded button widths for non-wrapping localized text in English, Swedish, and Arabic.
- **Parental PIN Lock Toggle**: 4-digit parental security slider toggle with persistent lock state across TV sessions.
- **Configurable Screensaver Idle Timeouts**: Added configurable screensaver delays (`1m`, `3m`, `5m`, `10m`) to prevent OLED/QLED burn-in during pauses.
- **Live TV OSD Channel Numbers Toggle**: Configurable setting (`settings.showChannelNumbers`) to show or hide numeric channel identifiers in the Live TV playback banner.
- **IPTV Manager Default Placeholder**: Clean URL input experience in Setup and Onboarding displaying default server address as HTML placeholder rather than prefilled text.
- **AssisTV Adaptive Channel Tile Grid & Skewed Ribbon**: 4–6 column adaptive tile grid with real-time EPG progress bars, channel badges, centered logos, and skewed group ribbon (`HomeTileGrid.tsx`).
- **Side-by-Side Translucent Channel List & 7-Day EPG Schedule**: Dual-column overlay (`ChannelEpgPanel.tsx`) preserving live broadcast visibility on the right third of the screen with replay catch-up indicators.
- **Hardware Multi-Audio & Subtitle Track Switching**: Instant native audio and DVB/Teletext/CEA subtitle track enumeration and hardware switching via `webapis.avplay`.
- **WASM Loopback Manifest Repair & QR Phone Remote**: WebAssembly loopback socket server for 32-bit HLS sequence repair, paired with LAN WebAssembly management socket powering the on-TV QR setup and Smart Remote.

### Changed

- **React 19 & Zustand 5 Foundation**: Upgraded core architecture with strict TypeScript, Vite 8 bundler, Biome formatting, and automated Vitest verification.
- **Low-Latency Live Buffer**: 1000ms live playback buffer tuned for IPTV Manager's Rust MPEG-TS proxy (`Port 8001`), paired with 5000ms VOD streaming buffers.
- **Dual Authentication Support**: Seamless support for standard Xtream Codes credentials and streamlined single-token IPTV Manager authentication (`x-zappa-token`).
- **Batch EPG Loading**: Single-request `/api/epg/batch` integration for instantaneous home grid guide population.
- **SD Aspect Ratio Detection**: Automatic 4:3 SD aspect-ratio detection (`NARROW_ASPECT = 1.6`) and scaling in `Player`.

### Fixed

- **Logo Eviction Regression**: Completely eliminated live channel logo drops caused by VOD catalog persistence by isolating VOD into its own database.
- **Direct Fullscreen Seek Jitter**: Eliminated unintended OSD banner raises and scrubber jumps during rapid directional seeking at bare picture.
- **Return Navigation Hierarchy**: Strictly aligned all modal and panel dismissals to the 4 Remote Key Laws and 5-layer screen stack.


