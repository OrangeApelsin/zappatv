# Changelog

Notable changes, newest first, in the format of [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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


