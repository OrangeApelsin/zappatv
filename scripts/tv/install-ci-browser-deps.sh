#!/bin/sh
# Disposable Debian bookworm CI containers only. No certificates or host changes.
set -eu
apt-get update
apt-get install -y --no-install-recommends chromium fonts-liberation unzip xvfb xauth libdbus-glib-1-2 libxss1 libgtk2.0-0
# Old Chromium links GConf, which modern Chromium no longer needs. Extract only
# this checksum-pinned Debian library into the job workspace; do not install an
# obsolete service or use an unverified third-party PPA.
mkdir -p build/tv-runtime
python3 - <<'PY'
from pathlib import Path
from urllib.request import urlopen
from hashlib import sha256
url = 'https://deb.debian.org/debian/pool/main/g/gconf/libgconf-2-4_3.2.6-8_amd64.deb'
data = urlopen(url, timeout=60).read()
assert sha256(data).hexdigest() == '0fad57869b4074899625e2747afefbf32318224ede8e17c59d0ed2a703d0f095', 'GConf checksum mismatch'
Path('build/tv-runtime/gconf.deb').write_bytes(data)
PY
dpkg-deb -x build/tv-runtime/gconf.deb build/tv-runtime
