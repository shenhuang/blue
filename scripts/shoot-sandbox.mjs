#!/usr/bin/env node
// 沙箱一键产图（版本自派生·幂等）——在 Cowork Linux 沙箱把「装 Linux 原生 + 下 chromium + 起 vite + 截图」
// 一条命令跑通。详见 docs/infra/ui-shoot.md。
//
// 为什么沙箱需要它：作者 node_modules 是 macOS 原生（esbuild/rolldown 均 darwin）→ vite 起不来；且沙箱无 chromium。
// 本脚本只补 **Linux 侧**，版本全从**已装** node_modules / playwright browsers.json 派生（不写死·随升级自动跟）：
//   1. Linux esbuild@<installed>                     → ESBUILD_BINARY_PATH
//   2. @rolldown/binding-linux-<arch>-<libc>@<installed> → NODE_PATH（不污染作者 node_modules）
//   3. Playwright + chromium-headless-shell（rev 自派生·curl -C - 续传·抗 45s 上限）→ SHOOT_CHROMIUM
//   4. ldd 补缺失系统库（apt-get download·非 root）  → LD_LIBRARY_PATH
// 产物全落 /tmp（幂等·已存在则跳过）。然后起 shoot-serve（子进程·带 env）+ 调 shoot.mjs（透传 --scenes/--all/--view）。
//
// 用法：node scripts/shoot-sandbox.mjs [--scenes a,b | --all] [--view mobile|desktop|both]

import { execSync, spawn } from 'node:child_process';
import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const passArgs = process.argv.slice(2);
const log = (...a) => console.log('[shoot-sandbox]', ...a);
const run = (cmd) => execSync(cmd, { stdio: 'inherit', shell: '/bin/bash' });
const cap = (cmd) => execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8', shell: '/bin/bash' }).trim();
const ver = (name) => JSON.parse(readFileSync(resolve(ROOT, 'node_modules', name, 'package.json'), 'utf8')).version;

const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
const tripletArch = arch === 'arm64' ? 'aarch64' : 'x86_64';
let libc = 'gnu';
try { if (/musl/i.test(cap('ldd --version 2>&1 || true'))) libc = 'musl'; } catch { /* default gnu */ }

// /tmp 布局（幂等复用）
const EB = '/tmp/eb', RD = '/tmp/rd', PW = '/tmp/pw';
const HS_ZIP = '/tmp/hs.zip', HS = '/tmp/hs', XLIBS = '/tmp/xlibs';
const EB_BIN = `${EB}/node_modules/@esbuild/linux-${arch}/bin/esbuild`;
const HS_BIN = `${HS}/chrome-linux/headless_shell`;
const XLIB_DIR = `${XLIBS}/usr/lib/${tripletArch}-linux-gnu`;

// 1. Linux esbuild（== 已装版本）
if (!existsSync(EB_BIN)) { const v = ver('esbuild'); log(`装 Linux esbuild@${v}`); run(`npm i --no-audit --no-fund --prefix ${EB} esbuild@${v}`); }

// 2. rolldown linux binding（== 已装版本·NODE_PATH 注入·不碰作者 node_modules）
const RD_PKG = `@rolldown/binding-linux-${arch}-${libc}`;
if (!existsSync(`${RD}/node_modules/${RD_PKG}`)) { const v = ver('rolldown'); log(`装 ${RD_PKG}@${v}`); run(`npm i --no-audit --no-fund --prefix ${RD} ${RD_PKG}@${v}`); }

// 3. Playwright API（跳自动下载·下面手动 curl 续传）
if (!existsSync(`${PW}/node_modules/.bin/playwright`)) { log('装 playwright'); run(`PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm i --no-audit --no-fund --prefix ${PW} playwright`); }

// 4. chromium-headless-shell（rev 从 browsers.json 派生·curl -C - 续传抗 45s 上限）
if (!existsSync(HS_BIN)) {
  const bj = JSON.parse(readFileSync(`${PW}/node_modules/playwright-core/browsers.json`, 'utf8'));
  const rev = bj.browsers.find((b) => b.name === 'chromium-headless-shell').revision;
  const url = `https://cdn.playwright.dev/dbazure/download/playwright/builds/chromium/${rev}/chromium-headless-shell-linux-${arch}.zip`;
  log(`下 chromium-headless-shell rev ${rev}（首次约 110MB·若被 45s 上限打断，重跑本命令续传）`);
  let ok = false;
  for (let i = 0; i < 30 && !ok; i++) {
    run(`curl -sSL --fail -C - -o ${HS_ZIP} "${url}" || true`);
    try { execSync(`unzip -t ${HS_ZIP} >/dev/null 2>&1`); ok = true; } catch { log('zip 未完·继续续传'); }
  }
  if (!ok) { console.error('[shoot-sandbox] chromium zip 下载未完成·重跑续传'); process.exit(1); }
  run(`rm -rf ${HS} && mkdir -p ${HS} && unzip -q ${HS_ZIP} -d ${HS} && chmod +x ${HS_BIN}`);
}

// 5. 补缺失系统库（ldd → apt-get download → dpkg -x → LD_LIBRARY_PATH·非 root·幂等）
mkdirSync(XLIBS, { recursive: true });
const missing = () => [...cap(`LD_LIBRARY_PATH=${XLIB_DIR} ldd ${HS_BIN} 2>&1 | grep -i 'not found' || true`)
  .matchAll(/(\S+\.so\S*)\s*=>?\s*not found/gi)].map((m) => m[1]);
let libs = missing();
if (libs.length) {
  // .so → deb 包名（chromium 常见依赖·缺映射会明确报错让人补）
  const MAP = {
    'libXdamage.so.1': 'libxdamage1', 'libXtst.so.6': 'libxtst6', 'libXcomposite.so.1': 'libxcomposite1',
    'libXrandr.so.2': 'libxrandr2', 'libXcursor.so.1': 'libxcursor1', 'libXi.so.6': 'libxi6',
    'libgbm.so.1': 'libgbm1', 'libasound.so.2': 'libasound2', 'libcups.so.2': 'libcups2',
    'libatk-1.0.so.0': 'libatk1.0-0', 'libatk-bridge-2.0.so.0': 'libatk-bridge2.0-0',
    'libxkbcommon.so.0': 'libxkbcommon0', 'libpango-1.0.so.0': 'libpango-1.0-0', 'libcairo.so.2': 'libcairo2',
  };
  const debs = [...new Set(libs.map((l) => MAP[l]).filter(Boolean))];
  const unmapped = libs.filter((l) => !MAP[l]);
  if (unmapped.length) { console.error(`[shoot-sandbox] 无 .so→deb 映射：${unmapped.join(', ')}（在 MAP 里补一条）`); process.exit(1); }
  log(`补库：${libs.join(', ')} → ${debs.join(', ')}`);
  for (const d of debs) run(`cd /tmp && apt-get download ${d} 2>/dev/null && dpkg -x ${d}*.deb ${XLIBS} && rm -f ${d}*.deb`);
  libs = missing();
  if (libs.length) { console.error(`[shoot-sandbox] 仍缺库：${libs.join(', ')}`); process.exit(1); }
}

// 6. 起 vite（子进程·带 Linux 原生 env）
const serveEnv = { ...process.env, NODE_PATH: `${RD}/node_modules`, ESBUILD_BINARY_PATH: EB_BIN, SHOOT_VITE_CACHE: '/tmp/blue-vite-cache', SHOOT_PORT: '5199' };
log('起 vite dev …');
const vite = spawn('node', [resolve(ROOT, 'scripts/shoot-serve.mjs')], { cwd: ROOT, env: serveEnv, stdio: ['ignore', 'pipe', 'pipe'] });
let up = false;
vite.stdout.on('data', (d) => { process.stdout.write(`[vite] ${d}`); if (/VITE_UP/.test(String(d))) up = true; });
vite.stderr.on('data', (d) => process.stderr.write(`[vite] ${d}`));
const t0 = Date.now();
while (!up && Date.now() - t0 < 25000) { await new Promise((r) => setTimeout(r, 300)); }
if (!up) { log('vite 未起·退出'); vite.kill(); process.exit(1); }

// 7. 跑 shoot（透传参数·带 chromium/LD/base env）
const shootEnv = { ...process.env, SHOOT_BASE: 'http://127.0.0.1:5199', SHOOT_CHROMIUM: HS_BIN, LD_LIBRARY_PATH: `${XLIB_DIR}:${process.env.LD_LIBRARY_PATH || ''}`, SHOOT_PLAYWRIGHT: `${PW}/node_modules/playwright` };
log('截图 …');
const shoot = spawn('node', [resolve(ROOT, 'scripts/shoot.mjs'), ...passArgs], { cwd: ROOT, env: shootEnv, stdio: 'inherit' });
const code = await new Promise((r) => shoot.on('exit', r));
vite.kill();

// 可选视觉 diff：--bless 认可 current 为新基线；--check 比对基线（有差异 exit 1）。
const wantDiff = passArgs.includes('--check') || passArgs.includes('--bless');
if (wantDiff && code === 0) {
  if (!existsSync(`${PW}/node_modules/pixelmatch`)) { log('装 pixelmatch/pngjs'); run(`npm i --no-audit --no-fund --prefix ${PW} pixelmatch@5 pngjs`); }
  const diffEnv = { ...process.env, SHOOT_NODEMODULES: `${PW}/node_modules` };
  const d = spawn('node', [resolve(ROOT, 'scripts/shoot-diff.mjs'), ...(passArgs.includes('--bless') ? ['--bless'] : [])], { cwd: ROOT, env: diffEnv, stdio: 'inherit' });
  process.exit((await new Promise((r) => d.on('exit', r))) ?? 0);
}
process.exit(code ?? 0);
