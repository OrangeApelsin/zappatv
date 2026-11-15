#!/usr/bin/env bash
# Portable unsigned packaging is the default; Apps2Samsung performs owner signing.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TARGET="${TIZEN_TARGET:-5.5}"
export TIZEN_TARGET="$TARGET"
npm --prefix "$ROOT" run build
node "$ROOT/scripts/package-wgt.mjs" --target="$TARGET"
# Explicit optional developer profile: failures never become unsigned successes.
if [ -n "${SIGNING_PROFILE:-}" ]; then
  node "$ROOT/scripts/device-widget.mjs" --target="$TARGET"
fi
