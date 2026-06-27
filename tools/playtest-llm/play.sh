#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Blue / 深海回响 · LLM-playtest driver wrapper.
# Thin shim so an agent (or scheduled task) drives the campaign harness with one
# command, without hand-wiring the sandbox esbuild each call.
#   bash .../play.sh step  --token /tmp/x.json [--seed N] [--zone id] [--o2 N] [--max-dives N]
#   bash .../play.sh apply --token /tmp/x.json --action <id>
# On Mac: uses npx tsx directly. On the Linux sandbox: provisions the platform
# esbuild (mount node_modules is macOS-native), version-aligned to tsx's esbuild.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BLUE_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$BLUE_ROOT"

if [ "$(uname)" = "Linux" ]; then
  V=$(node -e "try{console.log(require('$BLUE_ROOT/node_modules/tsx/node_modules/esbuild/package.json').version)}catch(e){try{console.log(require('$BLUE_ROOT/node_modules/esbuild/package.json').version)}catch(e){console.log('0.28.0')}}")
  case "$(uname -m)" in
    aarch64|arm64) PKG="@esbuild/linux-arm64" ;;
    *)             PKG="@esbuild/linux-x64" ;;
  esac
  EB="/tmp/eb-$PKG-$V"
  if [ ! -x "$EB/package/bin/esbuild" ]; then
    rm -rf "$EB" && mkdir -p "$EB" && ( cd "$EB" && npm pack "$PKG@$V" >/dev/null 2>&1 && tar -xzf ./*.tgz >/dev/null 2>&1 )
  fi
  [ -x "$EB/package/bin/esbuild" ] && export ESBUILD_BINARY_PATH="$EB/package/bin/esbuild"
fi

exec npx tsx --tsconfig "$SCRIPT_DIR/tsconfig.json" "$SCRIPT_DIR/campaign.ts" "$@"
