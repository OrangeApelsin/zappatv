# Data Flow & Storage Model (Legacy Zappa TV)

This document describes how the legacy build stores and retrieves data on a Tizen 2.3/2.4 device. All components are written in plain ES5 JavaScript and rely on the **Tizen File API** (`webapis.file`) and simple XHR calls.

## 1. Overview diagram

```mermaid
flowchart TD
    subgraph UI [UI Layer]
        Home[Home Screen]
        VOD[VOD Browser]
        Settings[Remote Relay Settings]
    end
    subgraph Net [Network Layer]
        API[XHR to IPTV‑Manager]
    end
    subgraph Store [Local Storage]
        JSON[JSON Files on widget storage]
        LS[localStorage (tiny flags)]
    end
    Home -->|click channel| Player[AVPlay Engine]
    VOD -->|select movie/series| Player
    Settings -->|save URL| Store
    API -->|fetch channels / VOD| JSON
    Player -->|writes watch state| JSON
    Store -->|read/write| JSON
    Store -->|simple flags| LS
```

## 2. Files & Keys
| File / Key | Location | Purpose |
|------------|----------|---------|
| `legacy/channels.json` | Widget storage (root of `legacy/`) | Static list of live TV channels (ID, name, stream URL). Loaded on app start. |
| `legacy/vodCatalog.json` | Widget storage | Remote‑fetched VOD catalog (array of objects). Cached locally for offline fallback. |
| `legacy/lastVOD.json` (via `storage.js`) | Widget storage | Stores the most recently played VOD (URL and timestamp) for the *Resume* feature. |
| `legacy/lastChannel.json` | Widget storage | Stores the last selected live channel (for quick resume on app launch). |
| `localStorage['remoteRelayUrl']` | Browser `localStorage` | Persists the Remote Relay URL entered in Settings. |
| `localStorage['debug']` | Browser `localStorage` | Enables verbose logging when set to `true`. |

## 3. Storage API (wrapper in `legacy/storage.js`)
```javascript
// Simple wrapper around webapis.file
window.storageSave = function(key, obj) {
    var json = JSON.stringify(obj);
    var file = webapis.file.resolve('data/' + key + '.json');
    file.open('w');
    file.write(json);
    file.close();
};

window.storageLoad = function(key, callback) {
    var file = webapis.file.resolve('data/' + key + '.json');
    if (!file.exists()) { callback(null); return; }
    file.open('r');
    var content = file.readAll();
    file.close();
    try { callback(JSON.parse(content)); }
    catch (e) { callback(null); }
};
```
*All file operations are synchronous because the legacy Tizen API does not provide promises.*

## 4. Network flow (via `ajax.js`)
```javascript
function ajaxGet(url, cb) {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.onreadystatechange = function () {
        if (xhr.readyState === 4) {
            if (xhr.status === 200) cb(xhr.responseText);
            else cb(null);
        }
    };
    xhr.send();
}
```
*The same helper is used for the VOD catalog (`/api/vod/catalog`) and for the live channel list if you decide to fetch it dynamically.*

## 5. Playback integration
- **Live TV** – `player.js` opens a stream URL from `channels.json` via `webapis.avplay`. Buffer size is set to **1 s** for live zapping.
- **VOD** – `vod.js` calls `player.playVOD(url)` which sets a **5 s** buffer and starts playback. The playback state (current position) can be stored via `storageSave('lastVOD', {...})`.

## 6. Data refresh strategy
1. **On first launch** the app loads `channels.json` and `vodCatalog.json` from local storage.
2. **If network is reachable**, it fetches the fresh catalog via XHR and overwrites the local copy (`storageSave`).
3. **If the fetch fails**, the app continues using the cached JSON.
4. **User actions** (selecting a channel, playing a VOD) update the *last* records immediately.

## 7. Troubleshooting tips
- Verify that the `data/` folder exists on the widget storage. If `webapis.file.resolve('data/')` fails, create it once during app init:
  ```javascript
  var dir = webapis.file.resolve('data');
  if (!dir.exists()) dir.mkdir();
  ```
- Ensure the widget has the required privileges in `config.xml` (e.g., `filesystem.read`, `filesystem.write`). Without them, any file operation will silently fail.
- Check `localStorage` via the TV’s Web Inspector (if available) to confirm that the Remote Relay URL is correctly saved.

---
**Next steps** – After confirming the data flow works, you can extend the VOD catalog format (add genre tags, thumbnails, etc.) without changing any of the core storage code.
