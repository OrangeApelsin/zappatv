# Packaging guide for Legacy Zappa TV

This document explains how to build the legacy widget, verify the package, and publish a release.

## Prerequisites
- Windows PowerShell (available on Windows 10+).  
- The repository must be on the branch `ticket-2508-legacy`.  
- All source files are under the `legacy/` directory.

## Build steps
1. **Open PowerShell** in the repository root (`d:\Web\zappa2`).
2. **Run the build script**:
   ```powershell
   .\legacy\build-legacy.ps1
   ```
   The script compresses the entire `legacy/` folder into `zappa-legacy.zip` and places the zip next to the script.
3. **Verify the zip** contains the expected files:
   ```powershell
   Expand-Archive -Path zappa-legacy.zip -DestinationPath .\legacy\tmp_test
   Get-ChildItem .\legacy\tmp_test
   ```
   You should see `config.xml`, all HTML/JS/CSS assets, and the VOD placeholder files.
4. **(Optional) Sign the package** – for the legacy build we rely on Samsung’s **Apps2Samsung** automatic signing, so no local certificate is needed.

## Install on a TV (manual test)
1. Copy `zappa-legacy.zip` to the **root** of a USB stick (no folder hierarchy).
2. Insert the USB stick into the TV’s USB port.
3. The TV should automatically detect the widget and prompt for installation.
4. After installation, launch the app from the Home screen.

## Creating a release
1. Commit any final changes on `ticket-2508-legacy` and push to remote.
2. Tag the commit:
   ```bash
   git tag -a v1.0-legacy -m "Legacy build with VOD support"
   git push origin v1.0-legacy
   ```
3. In the repository’s **Releases** page, create a new release using the tag `v1.0-legacy` and upload `zappa-legacy.zip` as the asset.
4. Update this README with the new release version if needed.

---
**Tip:** If you ever need to rebuild after changing source files, simply re‑run `build-legacy.ps1`. The script overwrites the existing zip.
