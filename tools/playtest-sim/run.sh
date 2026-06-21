#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Blue / 深海回响 · 自动试玩 runner（随时可跑 / 可挂 schedule）
# 跑「理性玩家」机器人 sim（真引擎），产出每区图谱 + meta 可达性报告。
# 用法：
#   bash tools/playtest-sim/run.sh           # 默认：atlas + reach-check（快·高信号）
#   bash tools/playtest-sim/run.sh --deep    # 额外跑全分档 sweep（慢·~2000 潜）
# 自适应环境：Mac 本机直接用 npx tsx；Linux 沙箱自动补平台版 esbuild（mount 的
# node_modules 是 macOS 原生·跑不了），版本对齐 tsx 自带的 esbuild。
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BLUE_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$BLUE_ROOT"

# Linux 沙箱：补平台版 esbuild（版本对齐 tsx 自带的那份）
if [ "$(uname)" = "Linux" ]; then
  V=$(node -e "try{console.log(require('$BLUE_ROOT/node_modules/tsx/node_modules/esbuild/package.json').version)}catch(e){try{console.log(require('$BLUE_ROOT/node_modules/esbuild/package.json').version)}catch(e){console.log('0.28.0')}}")
  case "$(uname -m)" in
    aarch64|arm64) PKG="@esbuild/linux-arm64" ;;
    *)             PKG="@esbuild/linux-x64" ;;
  esac
  EB="/tmp/eb-$PKG-$V"
  if [ ! -x "$EB/package/bin/esbuild" ]; then
    echo "[run] fetching $PKG@$V for linux sandbox ..."
    rm -rf "$EB" && mkdir -p "$EB" && ( cd "$EB" && npm pack "$PKG@$V" >/dev/null 2>&1 && tar -xzf ./*.tgz >/dev/null 2>&1 )
  fi
  if [ -x "$EB/package/bin/esbuild" ]; then
    export ESBUILD_BINARY_PATH="$EB/package/bin/esbuild"
    echo "[run] ESBUILD_BINARY_PATH=$ESBUILD_BINARY_PATH"
  else
    echo "[run] WARN: could not provision linux esbuild; tsx may fail." >&2
  fi
fi

STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="$SCRIPT_DIR/reports/REPORT-$STAMP.txt"
mkdir -p "$SCRIPT_DIR/reports"

{
  echo "==================================================================="
  echo "Blue 试玩 sim 报告 · $STAMP · HEAD $(git rev-parse --short HEAD 2>/dev/null || echo '?')"
  echo "==================================================================="
  echo ""
  echo "########## 每区图谱（avoider vs fighter） ##########"
  npx tsx tools/playtest-sim/atlas.ts
  echo ""
  echo "########## Meta 可达性（锚点/前哨/深柱/station 门控） ##########"
  npx tsx tools/playtest-sim/reach-check.ts
  if [ "${1:-}" = "--deep" ]; then
    echo ""
    echo "########## 全分档 sweep（深扫·慢） ##########"
    npx tsx tools/playtest-sim/sweep.ts
  fi
} 2>&1 | tee "$OUT"

echo ""
echo "[run] 报告已存：$OUT"
echo "[run] 上一次报告对比：ls -t $SCRIPT_DIR/reports/ | head"
