# Testing UI & Navigation (Legacy Build)

This document describes the manual UI tests you should run after building the legacy widget. The goal is to verify that all interactive elements work with the TV remote (D‑pad) and that the layout is correct on a 720×1280 screen.

## Prerequisites
- `zappa-legacy.zip` installed on a Samsung Tizen 2.3/2.4 TV.
- The TV remote (arrow keys, OK, RETURN, Ch+, Ch‑, Left/Right for progressive seek).

## Test Matrix
| UI Element | Navigation key | Expected behaviour |
|------------|----------------|--------------------|
| **Home grid** (channel tiles) | Up/Down/Left/Right – move focus between tiles; OK – start playback | Focus moves one tile at a time; the selected tile shows a visual focus ring (as defined in `css/*.css`). |
| **VOD button** (added by `menu.js`) | Arrow keys to focus; OK – open VOD view (`vod.html.spm`) | The VOD page loads, showing a grid of movie/series thumbnails. |
| **Back button** on VOD page | LEFT or custom Back button – returns to Home screen | Home screen re‑appears, playback (if any) continues in background. |
| **Series tile** | OK on a series entry (type="series") – opens an episode overlay | Overlay lists episodes; each episode is selectable with the remote. |
| **Episode list** | Arrow keys navigate the list; OK – start playback of that episode | Playback starts and the overlay disappears. |
| **Remote‑relay Settings** | Navigate to Settings tile → OK → focus the URL input → OK toggles edit mode. Use the remote’s alphanumeric keys (if supported) or a paired keyboard to type. Press OK again to save. | The URL field retains the new value after leaving the page and after app restart. |
| **Return key** | Press RETURN on any modal or overlay | The overlay closes (e.g., episode list) or the app returns one layer up (VOD → Home, Settings → Home). |
| **Progressive seek** (Live TV only) | While playing a live channel, press Left/Right on the remote | The OSD shows a seek preview (10 s → 30 s → 1 min → 5 min → 10 min) without exiting playback. |

## Visual Checks
- All text must be readable on a 720×1280 screen (no clipping).  
- Icons and thumbnails must preserve aspect ratio (no stretched images).  
- The focus ring should be clearly visible (bright colour, contrast against background).  
- No flicker or drop‑frames when navigating between screens.

## Debugging Tips
- If a tile does not receive focus, open `legacy/css/*.css` and check the `:focus` selector – it may be overridden by a later rule.
- Use the TV’s built‑in **Web Inspector** (if available) to inspect the DOM.  
- Enable verbose logging in `legacy/js/common.js.spm` by setting `window.DEBUG = true;` – look for messages like `focus moved to …`.

## Pass / Fail Criteria
- **Pass** – Every UI element in the matrix responds correctly, navigation is smooth, and no runtime errors appear in the console.
- **Fail** – Any mismatch (e.g., focus stuck, overlay not closing, VOD button missing) must be recorded with a screenshot and a brief description; create an issue on the repo with the details.

---
**Next steps** after UI testing: proceed to the VOD functional tests described in `testing-vod.md` (to be added later).
