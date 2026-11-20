# Testing Live‑TV Playback (Legacy Build)

This guide explains how to manually verify that the **Live‑TV** functionality works on a Samsung Tizen 2.3/2.4 TV after building the legacy widget.

## Prerequisites
- A TV that runs Tizen 2.3 or 2.4 (e.g., a 2015 Samsung model).  
- The `zappa-legacy.zip` package built with `legacy\build-legacy.ps1`.  
- Access to the IPTV Manager server (the same one used by the modern Zappa TV) – you need the base URL, username and password.

## Test Steps
1. **Install the widget**
   - Copy `zappa-legacy.zip` to the root of a USB stick.
   - Insert the stick into the TV and let the TV install the widget automatically.
   - Launch *Zappa TV* from the Home screen.
2. **Verify the Home screen**
   - You should see a grid of channel tiles (copied from SipTV) and a **VOD** button added by `menu.js`.
3. **Select a channel**
   - Use the remote D‑pad to focus a tile and press **OK**.
   - The video should start within **1 second**.  
   - Observe the overlay banner (displayed by `player.js`) showing the channel name and signal quality.
4. **Test channel zapping**
   - While a channel is playing, press the **Ch+** or **Ch‑** hardware keys on the remote.  
   - The app must debounce the request (≈450 ms) before calling `webapis.avplay.open`.  
   - Verify that the picture switches cleanly without a long freeze.
5. **Watchdog behaviour**
   - Simulate a stalled stream (e.g., disconnect the network briefly).  
   - After **12 seconds** the on‑screen banner should display “Stalled – retrying…”.  
   - The widget should automatically attempt to reconnect (back‑off: 4 s → 8 s → 15 s).  
   - When the stream recovers, playback should resume.
6. **Remote‑relay URL field**
   - Open the **Remote Access** settings (via the Settings tile).  
   - The **Remote relay URL** input must be pre‑filled with `https://tv.halvmj.uk/companion/`.  
   - Change the value, press **OK**, and then reopen the page – the new value should persist (stored via `storage.js`).
7. **Log inspection (optional)**
   - If the TV provides a developer console (some Tizen TVs expose `webapis.logging`), enable it in `player.js` by setting `DEBUG=true`.  
   - Look for messages like `AVPlay init`, `Channel change`, `Watchdog triggered`.

## Success Criteria
- Video starts and plays without codec errors.
- Channel navigation respects the 450 ms debounce.
- The watchdog correctly detects a stall and retries.
- Remote‑relay URL persists across app restarts.
- No JavaScript runtime errors appear in the console.

If any step fails, note the exact error message and screen state, then open an issue on the repository with the details.
