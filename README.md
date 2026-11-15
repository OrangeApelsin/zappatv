# <img src="public/icon.svg" alt="Zappa TV icon" width="48" align="absmiddle"> Zappa TV

[CI](../../actions) · [Releases](../../releases) · [Licence](LICENSE)
[![Node](https://img.shields.io/badge/Node-22.23.4-339933?logoColor=white&logo=nodedotjs)](https://nodejs.org/)

Zappa TV is a private, open source IPTV player for Samsung TVs. Add an [extended M3U playlist or Xtream login](#add-playlists), then browse and play your channels through an interface designed for the television.

Your playlists, preferences, and favourites stay on your device. Zappa TV has no accounts, analytics, advertising, or project operated service.

> [!TIP]
> Browser UI preview is local development tooling: run `npm ci` and `npm run dev`, then use the arrow keys and Enter. The Gitea repository is not a hosted app/demo. Development preview is visibly labelled and simulates playback without decoding media or requesting streams. Production widgets use Samsung AVPlay only; other devices receive TV-only guidance. The simulation is excluded from production packages.

> [!IMPORTANT]
> Zappa TV is a player and provides no channels or other content. The project is not affiliated with any broadcaster, channel, streaming service, or playlist provider. Make sure you have the right to access what you add.

## See Zappa TV

### On the television

|  |  |
|:--|:--|
| [<img src="docs/screenshots/01-first-run.png" alt="Zappa TV setup on a television with M3U, Xtream, and setup from another device">](docs/screenshots/01-first-run.png) | [<img src="docs/screenshots/02-channels.png" alt="The channel panel on a television with categories and channel rows">](docs/screenshots/02-channels.png) |
| [**Set up Zappa TV**](#add-playlists) | **Browse channels** |
| [<img src="docs/screenshots/04-search.png" alt="Search on a television with the query news and matching channels">](docs/screenshots/04-search.png) | [<img src="docs/screenshots/06-settings.png" alt="Settings on a television with the Playback section open">](docs/screenshots/06-settings.png) |
| **Search channels** | **Change Playback settings** |

<details>
<summary>More television screenshots</summary>

|  |  |
|:--|:--|
| [<img src="docs/screenshots/03-categories.png" alt="The Categories list on a television with Sport selected">](docs/screenshots/03-categories.png) | [<img src="docs/screenshots/05-favourites.png" alt="A channel added to Favourites on a television">](docs/screenshots/05-favourites.png) |
| [**Browse Categories**](#add-playlists) | **Add channels to Favourites** |
| [<img src="docs/screenshots/07-category-management.png" alt="Settings on a television with Categories for a playlist open">](docs/screenshots/07-category-management.png) | [<img src="docs/screenshots/08-playback-information.png" alt="Playback information over a channel on a television">](docs/screenshots/08-playback-information.png) |
| [**Manage Categories for a playlist**](#add-playlists) | **View Playback information** |

</details>

### Remote access on a phone

|  |  |
|:--:|:--:|
| [<img src="docs/screenshots/09-remote-access.png" alt="Remote access on a phone showing Playlists, Devices, and About" width="215">](docs/screenshots/09-remote-access.png) | [<img src="docs/screenshots/10-smart-remote.png" alt="Both Smart Remote pages showing navigation, channel, volume, number, colour, and playback controls" width="410">](docs/screenshots/10-smart-remote.png) |
| [**Manage Zappa TV from another device**](#remote-access) | [**Use every Smart Remote control**](#remote-button-reference) |

## What you can do

- Browse original playlist categories, manage their visibility, and keep Favourites.
- Search every live channel or tune directly with channel numbers.
- Watch Xtream live television, movies, series, episodes, programme information, and provider catchup.
- Dual VOD browsing: Switch seamlessly between visual poster grid and fast linear list layouts.
- Dedicated 200 MB persistent VOD storage in IndexedDB (`zappa-vod`) with instant cache-first cold start (<300ms) and lightweight server version handshake.
- Up Next episode autoplay with calibrated countdown margin (1s episode remaining buffer) and remote key isolation.
- Direct bare fullscreen Left/Right progressive seek preview stepping (`10s`->`30s`->`1m`->`5m`->`10m`) without raising OSD.
- VOD OSD smart Previous restart logic (>60s restarts current item, <=60s changes episode) and crimson Stop transport button.
- Modern aqua glassmorphism modals with 14px button spacing and non-wrapping localized labels in English, Swedish, and Arabic.
- Hardware track switching: multi-audio and native DVB/Teletext/CEA subtitles via `webapis.avplay`.
- Parental PIN lock toggle and configurable screensaver timeouts (`1m`/`3m`/`5m`/`10m`).
- Resume the last channel or finite video, then pause or seek movies, episodes, and catchup.
- Use English, Swedish or Arabic, including right to left layout for Arabic.

Zappa TV does not provide recording management or provider administration.

## Install on a Samsung TV

The confirmed working baseline is **v3.0.0 (and recovery candidate `dab0a69`) on the owner's Tizen 5 Samsung QE55Q70RATXXC** (firmware `T-MSMDEUC-1510.0`). Tizen 5.0+ is the priority target; 3.0/4.0 packages are experimental. The television and computer used for installation must share the same local network.

The owner uses **Apps2Samsung automatic signing** and has no local WGT signing certificate. Download an unsigned versioned WGT and checksum from Gitea, then start with [Prepare the television](#prepare-the-television). No local/CI certificate or Tizen Studio signing profile is required for this route.

| Installer | Runs on | Worth knowing |
|:--|:--|:--|
| **[Apps2Samsung](#install-with-apps2samsung)** | Windows, macOS, and Linux, with an Android application as well | Signs the widget for the connected television on every supported Tizen version. You download the release yourself. |

### Prepare the television

1. Open Apps and press `12345` on the remote.
2. Turn Developer mode on and enter the computer's IP address.
3. Restart the television. If an installer cannot reach it afterwards, unplug the television for ten to fifteen seconds, because a full power cycle is what opens the port it installs through.

### Install with Apps2Samsung

1. Install [Apps2Samsung](https://github.com/Apps2Samsung/Apps2Samsung/releases/latest) on the computer, open it, and let it find the television or enter the television's IP address.
2. Download the correct `zappa-<version>-tizen5.wgt` (Tizen 5.0) or `zappa-<version>.wgt` (5.5+) and its `.sha256` from the project releases. The confirmed baseline is `zappa-2.1.0-tizen5.wgt` (or `v3.0.0`); newer candidates require TV acceptance.
3. Turn **Custom WGT** on under Advanced options, then choose the file you downloaded.
4. Install Zappa TV, then launch it from the television application list.

> [!NOTE]
> A retail television only accepts a widget signed for itself, so Apps2Samsung signs Zappa TV for the connected set before installing it. It asks for a Samsung account only when it has to create a certificate, then reuses that certificate for later installations. Its Android application can run the same installation from a phone, in which case Developer mode needs the phone's IP address rather than the computer's.

### Update an installed copy

Install the new release exactly as before, from the same computer and through the same installer, and the television keeps your playlists, favourites, and settings.

If an upgrade reports an author-certificate mismatch, stop and recover the original Apps2Samsung installation/signing context. Do not uninstall the working app or clear its data to bypass the error; agree a recovery procedure first. The required acceptance path preserves playlists, favourites and resume state.

### Build and sign manually

<details>
<summary>Show manual build instructions</summary>

Use Node 22.23.4 (pinned in `.nvmrc` and Gitea CI). Tizen Studio and the certificates below are only needed for this optional manual signing route; unsigned WGTs installed through Apps2Samsung use its automatic signing instead. In Certificate Manager, create an author certificate and a Samsung distributor certificate for your television. Install the Samsung Certificate Extension, sign in with a Samsung account, and keep the television on and connected while creating the certificate.

Call the signing profile `Zappa TV`, or set `SIGNING_PROFILE` to its name.

```bash
git clone https://github.com/example/zappa2.git
cd zappa2
npm ci
TV_IP=192.168.0.10 npm run deploy
```

For unsigned packages without local certificates, run `npm run package:all`. Output is versioned under `build/`; install with Apps2Samsung automatic signing. Build/ZIP success alone does not establish target-engine or TV compatibility.

</details>

## Add playlists

| Source | What to enter |
|:--|:--|
| **Extended M3U** | A complete HTTP or HTTPS playlist address. |
| **Xtream login** | The server address, username, password, and HLS or MPEG TS live stream format. Live television, movies, series, episodes, programme information, and provider catchup are supported. |

Save several playlists and activate one at a time. Each playlist keeps its own category visibility, and password values stay concealed in the interface. For Xtream sources, choose Live, Movies, or Series from the content switcher. Movie and series summary indexes provide complete search and category counts without opening every category.

## Remote access

Remote access is available from the first run screen or Settings, then Remote access. Keep Zappa TV open and connect a phone or tablet to the same trusted local network, then scan the QR code or enter the displayed address and pairing code.

A paired device can manage playlists, ordinary settings, application data, authorised devices, and playback. [Smart Remote](#remote-button-reference) provides navigation, number, colour, channel, volume, and playback controls.

### Remote button reference

<details>
<summary>Show remote controls</summary>

| Key | Watching | Channel panel | Search |
|:--|:--|:--|:--|
| <kbd>↑</kbd> <kbd>↓</kbd> | Change channel | Move through the list | Move between the field and results |
| <kbd>←</kbd> | Open the channel panel | Move toward Categories, then close the panel | Move the caret |
| <kbd>→</kbd> | Hide the title badge | Move toward channels, then play | Move the caret |
| <kbd>OK</kbd> | Open the channel panel | Play the highlighted channel | Show matches, then play |
| Hold <kbd>OK</kbd> | Toggle Playback information | No action | No action |
| <kbd>Return</kbd> | Close the visible layer | Go back | Clear Search, then close it |
| <kbd>Ch+</kbd> <kbd>Ch-</kbd> | Change channel | Change channel | Change channel |
| <kbd>0</kbd> to <kbd>9</kbd> | Tune to a channel number | Tune to a channel number | Type a digit |
| <kbd>Green</kbd> | Toggle Favourites | Toggle Favourites | Toggle Favourites |
| <kbd>Red</kbd> | No action | Change category visibility | No action |
| Hold <kbd>Red</kbd> | No action | Show or conceal hidden categories | No action |
| <kbd>Yellow</kbd> | Open Settings | Open Settings | Open Settings |

<kbd>Play</kbd>, <kbd>Pause</kbd>, <kbd>Stop</kbd>, and the track keys work throughout the app.

</details>

## Help

> [!NOTE]
> The hosted HTTPS demo can use only provider API, artwork, and stream addresses that support HTTPS and permit browser access through Cross Origin Resource Sharing. A provider that lacks either can still work in the packaged television app. Browser codec and container support can also be narrower than Samsung AVPlay support, especially for movie and episode files.

<details>
<summary>Common issues</summary>

- **An installer cannot connect to the television.** Repeat [Prepare the television](#prepare-the-television), including the restart, and avoid guest networks that isolate devices. Some televisions store the address in reverse, so enter your IP address backwards if the installer still cannot find the set.
- **Installation reports certificate error 118 or -12.** Use [Apps2Samsung](#install-with-apps2samsung) automatic signing for the connected TV. Local certificates are needed only for the optional manual signing route.
- **Installation reports that the author certificate does not match.** Preserve the working installation and follow [update an installed copy](#update-an-installed-copy) to recover the original signing context.
- **A playlist address is refused.** Review the supported details under [Add playlists](#add-playlists).
- **An Xtream stream will not play.** Try the other live stream format under [Add playlists](#add-playlists). The packaged television app retries eligible HTTPS connection failures once over HTTP. Browser preview/simulation is development tooling and does not prove TV decoder compatibility.
- **A channel shows one frame and stops.** Turn on Compatibility mode under Settings, then Playback.
- **A remote key does nothing.** Open Settings, About, Support, Diagnostics, then Remote buttons, then compare it with the [remote button reference](#remote-button-reference).
- **Logos are slow to appear.** Turn Show channel logos off under Settings, then Appearance.

</details>

## Contributing

Issues and pull requests are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) for the development workflow, [the design notes](docs/design.md) for interface decisions, and [the testing notes](docs/testing.md) for compatibility checks. Report security problems through [SECURITY.md](SECURITY.md).

## Licence

Zappa TV uses the MIT licence in [LICENSE](LICENSE). Runtime projects included in the application are listed in [THIRD-PARTY-NOTICES.md](public/THIRD-PARTY-NOTICES.md).

Candidate compatibility checks and their hardware limits are documented in [packaged engine verification](docs/testing-engines.md). Unsigned CI candidates are available from their Gitea Actions run; Apps2Samsung performs signing.
