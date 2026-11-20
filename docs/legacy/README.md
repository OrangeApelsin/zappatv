# Legacy Zappa TV

This folder contains everything required to build and run a **legacy** version of Zappa TV that works on Samsung Tizen 2.3/2.4 Smart‑TVs (e.g., 2015 models).

## What the legacy build includes
- Plain HTML, CSS and ES5‑compatible JavaScript (no React, no WebAssembly).
- The SipTV UI scaffold that is known to auto‑install when a `.zip`/`.wgt` is placed on the root of a USB drive.
- Core playback functionality (Live TV, channel zapping, remote‑relay) **plus** a minimal VOD browser for movies and series.
- All source code lives under the repository root `legacy/` directory; documentation lives here under `docs/legacy/`.

## Quick links
- [Packaging guide](packaging.md)
- [Testing Live‑TV playback](testing-player.md)
- [Testing UI & navigation](testing-ui.md)
- [Data flow & storage model](data-flow.md)

## How to get started
1. Check out the branch `ticket-2508-legacy`.
2. Run the build script (`legacy\build-legacy.ps1`).
3. Copy the generated `zappa-legacy.zip` to a USB stick and insert it into a legacy TV.
4. Follow the testing guides to verify functionality.

Happy hacking!