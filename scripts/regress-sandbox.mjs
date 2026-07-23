#!/usr/bin/env node
// regress-sandbox.mjs — 在 Cowork linux 沙箱里一条命令跑 `npm run regress`。
//
// 背景（把 [[blue_regress_sandbox]] 那篇散文落成机制·CLAUDE.md 元准则）：
//   Blue 的 node_modules 从作者 Mac mount 进来＝darwin 原生；沙箱是 linux。
//   `regress.mjs` 的 tsx 行为测在 linux 上只有当 ESBUILD_BINARY_PATH 指向一个
//   linux 原生 esbuild 时才会跑（否则 canRunTsx=false·静默跳过 → 假绿）。
//   本包装：探测所需 esbuild 版本 → 取一份匹配的 linux esbuild（缓存进 tmp·
//   绝不碰作者 node_modules）→ 设 env → 透传参数调 regress.mjs。
//
// 用法：
//   npm run regress:sandbox                 全量（沙箱缺 rollup/rolldown 原生·build 自动跳·留 Mac/nightly）
//   npm run regress:sandbox -- --only typecheck,combat   透传任意 regress.mjs 参数
//
// 在 Mac（darwin）上跑＝直接透传给 regress.mjs（原生二进制本就能跑·无需任何 env）。

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, cpSync, chmodSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const passthrough = process.argv.slice(2);

function runRegress(env) {
  const r = spawnSync('node', ['scripts/regress.mjs', ...passthrough], {
    cwd: ROOT,
    stdio: 'inherit',
    env,
  });
  process.exit(r.status ?? 1);
}

// Mac / 非 linux：原生 node_modules 直接能跑 tsx 与 build，无需借二进制。
if (process.platform !== 'linux') {
  console.log(`[regress:sandbox] ${process.platform}/${process.arch} 原生环境 → 直接跑 npm run regress`);
  runRegress(process.env);
}

// 已有人显式设了就尊重（例如 nightly / 手动）。
if (process.env.ESBUILD_BINARY_PATH) {
  console.log(`[regress:sandbox] 沿用已设 ESBUILD_BINARY_PATH=${process.env.ESBUILD_BINARY_PATH}`);
  runRegress(process.env);
}

// 探测 regress 的 tsx 任务实际用的 esbuild 版本：tsx 优先用自己嵌套的那份，
// 没有嵌套（当前仓即如此）就用顶层 esbuild。二者取到哪个就必须精确匹配哪个，
// 否则 tsx 报 "Host version does not match binary"。
function esbuildVersionFrom(pkgRel) {
  const p = join(ROOT, pkgRel, 'package.json');
  try { return JSON.parse(readFileSync(p, 'utf8')).version; } catch { return null; }
}
const version =
  esbuildVersionFrom('node_modules/tsx/node_modules/esbuild') ||
  esbuildVersionFrom('node_modules/esbuild');

if (!version) {
  console.error('[regress:sandbox] ✗ 找不到 esbuild（node_modules 没 mount？）先 `npm ci`。');
  process.exit(1);
}

const pkg = `@esbuild/linux-${process.arch}`; // linux-arm64 / linux-x64
const cacheDir = join(tmpdir(), 'blue-sandbox-esbuild', `linux-${process.arch}`, version);
const binary = join(cacheDir, 'bin', 'esbuild');

if (!existsSync(binary)) {
  console.log(`[regress:sandbox] 取 ${pkg}@${version} → ${cacheDir}`);
  const work = join(tmpdir(), `blue-esb-pack-${process.pid}-${Date.now()}`);
  mkdirSync(work, { recursive: true });
  // npm pack 只下 tgz、不 install、不动 node_modules、不校平台 → 安全。
  const packed = spawnSync('npm', ['pack', `${pkg}@${version}`], { cwd: work, encoding: 'utf8' });
  if (packed.status !== 0) {
    console.error(`[regress:sandbox] ✗ npm pack 失败（沙箱无 npm 网络？）:\n${packed.stderr || packed.stdout || ''}`);
    console.error('  退路：手动取 linux esbuild 后设 ESBUILD_BINARY_PATH 再 `npm run regress`（见 [[blue_regress_sandbox]]）。');
    process.exit(1);
  }
  const tgz = readdirSync(work).find((f) => f.endsWith('.tgz'));
  spawnSync('tar', ['xzf', tgz], { cwd: work, stdio: 'inherit' });
  mkdirSync(cacheDir, { recursive: true });
  cpSync(join(work, 'package'), cacheDir, { recursive: true });
  try { chmodSync(binary, 0o755); } catch {}
}

const check = spawnSync(binary, ['--version'], { encoding: 'utf8' });
if (check.status !== 0 || !check.stdout?.trim().startsWith(version.split('.')[0])) {
  console.error(`[regress:sandbox] ✗ 缓存的 esbuild 跑不动或版本不符（${check.stdout?.trim()}），删 ${cacheDir} 重试。`);
  process.exit(1);
}
console.log(`[regress:sandbox] esbuild ${check.stdout.trim()} ✓ → 跑 regress（build 沙箱自动跳·#147/#272）`);
runRegress({ ...process.env, ESBUILD_BINARY_PATH: binary });
