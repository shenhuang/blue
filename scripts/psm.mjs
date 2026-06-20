#!/usr/bin/env node
// psm —— 并行 session 管理器（方案 C·在方案 A 写手门 + 方案 B worktree 隔离之上的编排层）。
//
// 目标：把「多个 Cowork session 同时在一个仓库上干活」从「手动 git worktree + 人脑记谁碰了啥」
// 收成几条命令，让并行的串行占比逼近零，同时把三类冲突按各自能拦的最早时机拦住：
//   1) 工作区互踩  → 每个 session 一棵独立 worktree（物理隔离·复用方案 B 的相对指针·quirk #138）。
//   2) 文本/越界    → 每个 session 申报「车道」(lane)；pre-commit 钩子在提交那一刻警告并停下。
//   3) 语义冲突     → 只有测试能逮：land 串行 + 每次合并前 rebase 最新 main + 跑 regress 绿门。
//
// 设计约束（都已在沙箱实测·见 docs/infra/parallel-sessions.md）：
//   · 沙箱 mount 只能 创建/改/rename，不能 unlink（quirk #1）→ land 不在沙箱删 worktree，清理留给 Mac（psm gc）。
//   · git 2.34·无 --relative-paths → worktree add 后手写相对指针（quirk #138）才能 Mac+任意沙箱通用。
//   · 多 worktree 共享同一个 .git（common dir）→ 台账/锁放 .git/psm/，天然跨 session 共享且永不提交；
//     仓库主树根 = dirname(git-common-dir)，所以钩子在 worktree 里跑也能算回主树（别用脚本自身位置）。
//   · 绿门＝调用项目自己的 `npm run regress`；沙箱无 native esbuild → 默认跑 esbuild-free 子集（typecheck+check-*），
//     完整 playthrough/build 留给 Mac/nightly 全绿（与 CLAUDE.md「全量 regress 是 ship 前的门」一致）。
//
// 用法速查（详见 docs/infra/parallel-sessions.md）：
//   node scripts/psm.mjs install                         一次性装：wire 钩子 + 建台账 + 补 .gitignore
//   node scripts/psm.mjs start <name> --lane <glob,...>  开一条并行线（独立 worktree + 申报车道）
//   node scripts/psm.mjs status                          看所有在飞 session / 车道 / 与 main 的落差 / 锁
//   node scripts/psm.mjs check <glob,...>                起手前自检：这条车道和谁重叠？
//   node scripts/psm.mjs land [name]                     rebase 最新 main + 跑绿门；绿了停下等你确认（不自动合）
//   node scripts/psm.mjs land [name] --yes               确认后：ff 合进 main（须在 main 树跑）
//   node scripts/psm.mjs merge <name>                    = land --yes 的合并那一步（须在 main 树跑）
//   node scripts/psm.mjs abort <name>                    放弃一条线（沙箱里 worktree 留着·Mac 上 psm gc 清）
//   node scripts/psm.mjs gc                              Mac 本机：移除已合并/已弃的 worktree（沙箱拒绝·不能 unlink）
//
// 退出码：成功 0；「警告即停·等你确认」用 3（区别于真错误 1）。

import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, symlinkSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join, relative as relPath, posix as ppath } from 'node:path';

// ─────────────────────────── 基础 ───────────────────────────

const SELF = fileURLToPath(import.meta.url);
const SCRIPTS_DIR = dirname(SELF);
const PKG_ROOT = resolve(SCRIPTS_DIR, '..'); // psm.mjs 自身所在树（可能是 worktree！结构操作一律用 ROOT）

const DEFAULT_CONFIG = {
  mainBranch: 'main',
  branchPrefix: 'feat/',
  worktreeRoot: '.worktrees',
  gate: { full: 'npm run regress', sandbox: 'npm run regress -- --only typecheck,check' },
  reuseNodeModules: true,
  lockStaleMinutes: 30,
};

const C = {
  red: (s) => `\x1b[31m${s}\x1b[0m`, green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`, dim: (s) => `\x1b[2m${s}\x1b[0m`, bold: (s) => `\x1b[1m${s}\x1b[0m`,
};
function info(s) { console.log(s); }
function warn(s) { console.error(C.yellow('⚠ ') + s); }
function ok(s) { console.log(C.green('✓ ') + s); }
function die(s, code = 1) { console.error(C.red('✘ ') + s); process.exit(code); }
// 「警告即停·等你回复」：不是错误，是要人确认的检查点 → 退出码 3。
function stop(s) { console.error('\n' + C.yellow('■ 停下等你确认：') + ' ' + s); process.exit(3); }

function loadConfig() {
  const p = join(PKG_ROOT, 'psm.config.json');
  if (existsSync(p)) {
    try { const j = JSON.parse(readFileSync(p, 'utf-8')); return { ...DEFAULT_CONFIG, ...j, gate: { ...DEFAULT_CONFIG.gate, ...(j.gate || {}) } }; }
    catch (e) { warn(`psm.config.json 解析失败（用默认）：${String(e.message || e).split('\n')[0]}`); }
  }
  return DEFAULT_CONFIG;
}
const CFG = loadConfig();

function isSandbox(p) { const x = p || ROOT(); return x.startsWith('/sessions/') || x.includes('/mnt/'); }

// ─────────────────────────── git ───────────────────────────

function git(args, opts = {}) {
  return execFileSync('git', ['--no-optional-locks', ...args], {
    cwd: opts.cwd || PKG_ROOT, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'], ...opts,
  }).trim();
}
function gitOk(args, opts = {}) {
  try { execFileSync('git', ['--no-optional-locks', ...args], { cwd: opts.cwd || PKG_ROOT, stdio: 'ignore' }); return true; } catch { return false; }
}
function repoRoot(cwd = process.cwd()) { try { return git(['rev-parse', '--show-toplevel'], { cwd }); } catch { return null; } }
function commonDir() { return resolve(PKG_ROOT, git(['rev-parse', '--git-common-dir'])); }
// 仓库主树根 = git-common-dir 的父目录。无论 psm.mjs 是从 main 树还是某 worktree 里跑，这都指向主树。
let _root = null;
function ROOT() { if (_root) return _root; try { _root = dirname(commonDir()); } catch { _root = PKG_ROOT; } return _root; }
function currentBranch(cwd) { try { return git(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: cwd || ROOT() }); } catch { return null; } }
function shaOf(ref) { try { return git(['rev-parse', ref]); } catch { return null; } }

// ─────────────────── 台账 / 锁（.git/psm/·跨 session 共享） ───────────────────

function psmDir() { const d = join(commonDir(), 'psm'); if (!existsSync(d)) mkdirSync(d, { recursive: true }); return d; }
function ledgerPath() { return join(psmDir(), 'ledger.json'); }
function readLedger() {
  const p = ledgerPath();
  if (!existsSync(p)) return { sessions: {}, mergeLock: null };
  try { const j = JSON.parse(readFileSync(p, 'utf-8')); j.sessions = j.sessions || {}; return j; }
  catch (e) { die(`台账损坏（${p}）：${String(e.message || e).split('\n')[0]}\n  手动修复或删掉重来。`); }
}
function writeLedger(led) { const p = ledgerPath(); const tmp = p + '.tmp-' + process.pid; writeFileSync(tmp, JSON.stringify(led, null, 2) + '\n'); renameSync(tmp, p); }
// merge 锁＝台账字段（不用 mkdir/rmdir——沙箱不能 rmdir 释放）。真正安全网是 doMerge 里的 staleness 校验。
function lockHolder(led) {
  const lk = led.mergeLock; if (!lk) return null;
  if ((Date.now() - new Date(lk.ts).getTime()) / 60000 > (CFG.lockStaleMinutes || 30)) return null; // 废弃
  return lk;
}

// ─────────────────────────── 车道匹配 ───────────────────────────

// glob → RegExp：支持 ** / * / ?；无通配且不以 / 结尾的当「目录前缀」（lane 自身及其下全部）。
export function laneToRegExp(lane) {
  let g = String(lane).trim().replace(/^\.?\//, '').replace(/\/+$/, '');
  if (!/[*?]/.test(g)) g = g + '/**|' + g;
  const toRe = (glob) => {
    let re = '';
    for (let i = 0; i < glob.length; i++) {
      const c = glob[i];
      if (c === '*') { if (glob[i + 1] === '*') { re += '.*'; i++; if (glob[i + 1] === '/') i++; } else re += '[^/]*'; }
      else if (c === '?') re += '[^/]';
      else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
    return re;
  };
  return new RegExp('^(?:' + g.split('|').map(toRe).join('|') + ')$');
}
export function matchesAnyLane(file, lanes) { const f = String(file).replace(/^\.?\//, ''); return lanes.some((l) => laneToRegExp(l).test(f)); }
// 两组车道是否可能重叠（保守：去掉通配后取目录前缀，前缀相交即判重叠）。
export function lanesOverlap(a, b) {
  const norm = (l) => String(l).trim().replace(/^\.?\//, '').replace(/\/+$/, '').replace(/\/?\*\*?$/, '').replace(/\/[^/]*\*[^/]*$/, '');
  for (const x of a) for (const y of b) {
    const nx = norm(x), ny = norm(y);
    if (nx === ny || nx === '' || ny === '' || nx.startsWith(ny + '/') || ny.startsWith(nx + '/')) return true;
  }
  return false;
}

// ─────────────────────────── flags ───────────────────────────

function parseFlags(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) { const k = a.slice(2); if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) out[k] = argv[++i]; else out[k] = true; }
    else out._.push(a);
  }
  return out;
}

// ─────────────────────────── install ───────────────────────────

function cmdInstall() {
  const root = ROOT();
  info(C.bold('psm install —— 装并行 session 编排层'));
  const hooksDir = join(root, '.githooks');
  if (!existsSync(hooksDir)) mkdirSync(hooksDir, { recursive: true });
  const preCommit = join(hooksDir, 'pre-commit');
  writeFileSync(preCommit,
    '#!/bin/sh\n# psm 车道边界门（方案 C）。fail-open：缺 node/脚本绝不挡提交。\n' +
    'root="$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0\n' +
    '[ -f "$root/scripts/psm.mjs" ] || exit 0\n' +
    'command -v node >/dev/null 2>&1 || exit 0\n' +
    'exec node "$root/scripts/psm.mjs" hook pre-commit\n');
  try { execFileSync('chmod', ['+x', preCommit]); } catch { /* best-effort */ }
  const existing = (() => { try { return git(['config', '--local', 'core.hooksPath'], { cwd: root }); } catch { return ''; } })();
  if (existing && existing !== '.githooks')
    warn(`core.hooksPath 已是「${existing}」。psm 没覆盖它——把 .githooks/pre-commit 并进你现有钩子，或手动设 core.hooksPath=.githooks。`);
  else { execFileSync('git', ['config', '--local', 'core.hooksPath', '.githooks'], { cwd: root }); ok('core.hooksPath = .githooks（车道门只对登记过的 session worktree 生效·main 树照常提交）'); }
  const gi = join(root, '.gitignore');
  let giTxt = existsSync(gi) ? readFileSync(gi, 'utf-8') : '';
  if (!/^\/?\.worktrees\/?\s*$/m.test(giTxt)) { writeFileSync(gi, giTxt + (giTxt.endsWith('\n') ? '' : '\n') + '\n# psm 并行 session worktree（物理隔离·never commit）\n/.worktrees/\n'); ok('.gitignore 补上 /.worktrees/'); }
  else ok('.gitignore 已忽略 .worktrees/');
  writeLedger(readLedger()); ok(`台账就绪：${relPath(root, ledgerPath())}`);
  try { execFileSync('chmod', ['+x', SELF]); } catch { /* ignore */ }
  info('\n装好了。下一步：');
  info(`  · 把 scripts/psm.mjs / .githooks / psm.config.json 提交到 ${CFG.mainBranch}（新 worktree 从 main checkout 才带得上车道门）。`);
  info('  · 开第一条并行线：' + C.bold('node scripts/psm.mjs start <name> --lane <glob,...>'));
}

// ─────────────────────────── start ───────────────────────────

function cmdStart(argv) {
  const root = ROOT();
  const f = parseFlags(argv);
  const name = f._[0];
  if (!name || !/^[a-z0-9][a-z0-9._-]*$/i.test(name)) die('用法：psm start <name> --lane <glob[,glob...]>（name 用字母数字-_.）');
  const laneArg = f.lane || f.lanes;
  if (!laneArg || laneArg === true) die('必须申报车道：--lane <glob[,glob...]>（例 --lane "src/engine/**,src/data/items.json"）');
  const lanes = String(laneArg).split(',').map((s) => s.trim()).filter(Boolean);

  const led = readLedger();
  const prev = led.sessions[name];
  if (prev && prev.state !== 'landed' && prev.state !== 'aborted') die(`session「${name}」已存在（state=${prev.state}）。换名或先 abort。`);

  const clashes = [];
  for (const [n, s] of Object.entries(led.sessions)) {
    if (n === name || s.state === 'landed' || s.state === 'aborted') continue;
    if (lanesOverlap(lanes, s.lanes)) clashes.push({ n, lanes: s.lanes });
  }
  if (clashes.length && !f.force) {
    warn('车道和在飞 session 重叠：');
    for (const c of clashes) info(`    · ${c.n}：[${c.lanes.join(', ')}]`);
    stop('并行会撞车。换不重叠的车道，或把这条串行做。确认照开：加 --force。');
  }

  const mainSha = shaOf(CFG.mainBranch);
  if (!mainSha) die(`找不到主干分支「${CFG.mainBranch}」（改 psm.config.json 的 mainBranch）。`);
  const branch = CFG.branchPrefix + name;
  const wtRel = ppath.join(CFG.worktreeRoot, name);
  const wtAbs = join(root, CFG.worktreeRoot, name);
  if (existsSync(wtAbs)) die(`worktree 目录已存在：${wtRel}（沙箱删不掉——换 name，或 Mac 上清掉）。`);
  if (gitOk(['rev-parse', '--verify', '--quiet', branch])) die(`分支 ${branch} 已存在。换 name 或先收掉旧的。`);

  info(`开 session「${name}」→ 分支 ${branch} · 车道 [${lanes.join(', ')}]`);
  try { execFileSync('git', ['--no-optional-locks', 'worktree', 'add', wtRel, '-b', branch, CFG.mainBranch], { cwd: root, stdio: 'pipe' }); }
  catch (e) { die(`git worktree add 失败：${String(e.stderr || e.message || e).toString().split('\n')[0]}`); }
  ok(`worktree 挂在 ${wtRel}（从 ${CFG.mainBranch}@${mainSha.slice(0, 8)}）`);

  fixWorktreePointers(name, wtAbs);

  if (CFG.reuseNodeModules) {
    const wtNM = join(wtAbs, 'node_modules');
    if (!existsSync(wtNM) && existsSync(join(root, 'node_modules'))) {
      try { symlinkSync(join(root, 'node_modules'), wtNM, 'dir'); ok('node_modules → symlink 复用 main 树（macOS-native·省装）'); }
      catch { warn(`symlink node_modules 失败·改独立装：(cd ${wtRel} && npm install)`); }
    }
  }
  try { writeFileSync(join(wtAbs, '.blue-writer'), 'interactive\n'); } catch { /* ignore */ }

  led.sessions[name] = { branch, worktree: wtRel, lanes, baseSha: mainSha, state: 'active', started: new Date().toISOString(), updated: new Date().toISOString() };
  writeLedger(led);

  info('\n' + C.bold('这条线就绪。') + ' 在这个 session 里：');
  info(`  · 工作目录：${C.bold(wtAbs)}`);
  info(`  · 只动车道内文件：[${lanes.join(', ')}]——越界提交会被 pre-commit 警告并停下。`);
  info(`  · 收工：${C.bold('node scripts/psm.mjs land ' + name)}（rebase+绿门·绿了停下等你确认再合）。`);
}

function fixWorktreePointers(name, wtAbs) {
  try {
    const cgwt = join(commonDir(), 'worktrees', name);
    const wtDotGit = join(wtAbs, '.git');
    writeFileSync(wtDotGit, `gitdir: ${relPath(wtAbs, cgwt).split('\\').join('/')}\n`);
    writeFileSync(join(cgwt, 'gitdir'), `${relPath(cgwt, wtDotGit).split('\\').join('/')}\n`);
    ok('worktree 指针改相对路径（Mac + 任意 Cowork 沙箱通用·quirk #138）');
  } catch (e) { warn(`改相对指针失败：${String(e.message || e).split('\n')[0]}\n  本沙箱能用·但换 session/Mac 可能解析不到。`); }
}

// ─────────────────────────── status / check ───────────────────────────

function driftFromMain(baseSha) {
  const mainSha = shaOf(CFG.mainBranch); if (!mainSha || !baseSha) return '?';
  try { return git(['rev-list', '--count', `${baseSha}..${mainSha}`]); } catch { return '?'; }
}
function cmdStatus() {
  const led = readLedger();
  const sessions = Object.entries(led.sessions);
  info(C.bold('psm status') + C.dim(`  · 主干 ${CFG.mainBranch}@${(shaOf(CFG.mainBranch) || '?').slice(0, 8)}  · ${isSandbox() ? '沙箱' : 'Mac 本机'}`));
  const active = sessions.filter(([, s]) => s.state === 'active' || s.state === 'ready');
  if (!active.length) info(C.dim('  （无在飞 session）'));
  for (const [n, s] of active) {
    const drift = driftFromMain(s.baseSha);
    info(`  ${C.bold(n)}  [${s.state === 'ready' ? C.green('ready') : 'active'}]  ${s.branch}`);
    info(`      车道 [${s.lanes.join(', ')}]`);
    info(C.dim(`      worktree ${s.worktree} · 基线落后 main ${drift} commit${drift !== '0' && drift !== '?' ? '（land 会先 rebase）' : ''}`));
  }
  const names = active.map(([n]) => n);
  for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++)
    if (lanesOverlap(led.sessions[names[i]].lanes, led.sessions[names[j]].lanes)) warn(`车道重叠：${names[i]} ↔ ${names[j]}——并行有撞车风险。`);
  const lk = lockHolder(led);
  if (lk) info(C.yellow(`\n  merge 锁：${lk.holder} 持有中（${lk.ts}）`));
  const landed = sessions.filter(([, s]) => s.state === 'landed' || s.state === 'aborted');
  if (landed.length) info(C.dim(`\n  待清理（${isSandbox() ? 'Mac 上 ' : ''}psm gc）：${landed.map(([n, s]) => `${n}(${s.state})`).join(', ')}`));
}
function cmdCheck(argv) {
  const lanes = String(argv[0] || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!lanes.length) die('用法：psm check <glob[,glob...]>');
  const led = readLedger();
  let clash = false;
  for (const [n, s] of Object.entries(led.sessions)) {
    if (s.state === 'landed' || s.state === 'aborted') continue;
    if (lanesOverlap(lanes, s.lanes)) { warn(`和「${n}」重叠：[${s.lanes.join(', ')}]`); clash = true; }
  }
  if (clash) stop('有重叠。换车道、或把这条串行做。');
  ok(`车道 [${lanes.join(', ')}] 和所有在飞 session 都不重叠——可以安全并行。`);
}

// ─────────────────────────── land / merge ───────────────────────────

function resolveSessionFromCwd(led) {
  const cur = repoRoot(); if (!cur) return null;
  for (const [n, s] of Object.entries(led.sessions)) if (resolve(ROOT(), s.worktree) === cur) return n;
  return null;
}
function runGate(cwd) {
  const cmd = isSandbox(cwd) ? CFG.gate.sandbox : CFG.gate.full;
  info(C.bold('\n跑绿门：') + ` ${cmd}  ${C.dim(isSandbox(cwd) ? '（沙箱·esbuild-free 子集·build/playthrough 留给 Mac/nightly 全绿）' : '（全量）')}`);
  return spawnSync(cmd, { cwd, shell: true, stdio: 'inherit' }).status === 0;
}
function cmdLand(argv) {
  const f = parseFlags(argv);
  const led = readLedger();
  const name = f._[0] || resolveSessionFromCwd(led);
  if (!name) die('说不清是哪条 session。psm land <name>，或在该 worktree 里跑。');
  const s = led.sessions[name];
  if (!s) die(`没这条 session：${name}（psm status 看在飞的）。`);
  if (s.state === 'landed') die(`「${name}」已合并。`);
  const wtAbs = join(ROOT(), s.worktree);
  if (!existsSync(wtAbs)) die(`worktree 不在：${s.worktree}（换 session 或 Mac 上重建）。`);

  const mainSha = shaOf(CFG.mainBranch);
  info(`rebase ${s.branch} → ${CFG.mainBranch}@${mainSha.slice(0, 8)} ...`);
  const rb = spawnSync('git', ['--no-optional-locks', 'rebase', CFG.mainBranch], { cwd: wtAbs, encoding: 'utf-8' });
  if (rb.status !== 0) {
    spawnSync('git', ['rebase', '--abort'], { cwd: wtAbs, stdio: 'ignore' });
    warn((rb.stderr || rb.stdout || '').trim().split('\n').slice(-6).join('\n'));
    stop(`rebase 到 ${CFG.mainBranch} 有冲突——和别的 session 改到同一处了（车道重叠的代价）。\n  手动解：cd ${s.worktree} && git rebase ${CFG.mainBranch}，解完再 psm land ${name}。`);
  }
  s.baseSha = mainSha; s.updated = new Date().toISOString(); writeLedger(led);
  ok(`rebase 完成（基线对齐 ${CFG.mainBranch}@${mainSha.slice(0, 8)}）`);

  if (!runGate(wtAbs)) { s.state = 'active'; writeLedger(led); stop(`绿门没过——别合。先在 ${s.worktree} 修绿，再 psm land ${name}。`); }
  s.state = 'ready'; s.updated = new Date().toISOString(); writeLedger(led);

  if (!f.yes) {
    info('\n' + C.green('✓ rebased + 绿门通过') + `（${s.branch} 基于 ${CFG.mainBranch}@${mainSha.slice(0, 8)}）` +
      (isSandbox(wtAbs) ? '\n  ' + C.dim('注：沙箱只跑了 typecheck+check-*（esbuild-free）。完整 playthrough/build 的语义绿留给 Mac/nightly 全量 regress。') : ''));
    stop(`要把「${name}」ff 合进 ${CFG.mainBranch} 吗？确认就在 ${C.bold('main 树')} 跑：${C.bold('node scripts/psm.mjs land ' + name + ' --yes')}（或 psm merge ${name}）。`);
  }
  doMerge(name);
}
function cmdMerge(argv) { const name = parseFlags(argv)._[0]; if (!name) die('用法：psm merge <name>（在 main 树跑）。'); doMerge(name); }
function doMerge(name) {
  const root = ROOT();
  const led = readLedger();
  const s = led.sessions[name];
  if (!s) die(`没这条 session：${name}。`);
  if (s.state !== 'ready') stop(`「${name}」还没过绿门（state=${s.state}）。先 psm land ${name}。`);
  const br = currentBranch();
  if (br !== CFG.mainBranch) stop(`合并要在 ${C.bold('main 树')}（当前分支 ${br}）跑——advance ${CFG.mainBranch} 会动 main 树文件，必须在那棵树上做。切到 main session 里 psm merge ${name}。`);
  const mainSha = shaOf(CFG.mainBranch);
  if (mainSha !== s.baseSha) stop(`${CFG.mainBranch} 在你 rebase 后又前进了（${s.baseSha.slice(0, 8)} → ${mainSha.slice(0, 8)}）——别的 session 抢先合了。重新 psm land ${name} 再合。`);
  const lk = lockHolder(led);
  if (lk && lk.holder !== name) stop(`merge 锁被「${lk.holder}」持有（${lk.ts}）。等它合完，或 ${CFG.lockStaleMinutes}min 后自动释放。`);
  led.mergeLock = { holder: name, ts: new Date().toISOString() }; writeLedger(led);

  info(`ff 合并 ${s.branch} → ${CFG.mainBranch} ...`);
  const m = spawnSync('git', ['merge', '--ff-only', s.branch], { cwd: root, encoding: 'utf-8' });
  if (m.status !== 0) { led.mergeLock = null; writeLedger(led); warn((m.stderr || m.stdout || '').trim().split('\n').slice(-6).join('\n')); stop(`ff 合并没成（${CFG.mainBranch} 可能动过）。重新 psm land ${name}。`); }
  s.state = 'landed'; s.updated = new Date().toISOString(); led.mergeLock = null; writeLedger(led);
  ok(`「${name}」已 ff 合进 ${CFG.mainBranch}@${shaOf(CFG.mainBranch).slice(0, 8)}。`);
  info(C.dim(`  worktree ${s.worktree} 留在原地（沙箱不能删）。Mac 本机收：node scripts/psm.mjs gc`));
  info(C.dim('  追加 CHANGELOG/QUIRKS、push origin：照你现有 main 流程走（psm 不碰 append-only 文档·免冲突）。'));
}

// ─────────────────────────── abort / gc ───────────────────────────

function cmdAbort(argv) {
  const name = parseFlags(argv)._[0]; if (!name) die('用法：psm abort <name>');
  const led = readLedger(); const s = led.sessions[name];
  if (!s) die(`没这条 session：${name}。`);
  s.state = 'aborted'; s.updated = new Date().toISOString(); writeLedger(led);
  ok(`「${name}」已标记 aborted。`);
  info(C.dim(`  worktree ${s.worktree} 与分支 ${s.branch} 留着（沙箱不能删）。Mac 本机：node scripts/psm.mjs gc`));
}
function cmdGc() {
  const root = ROOT();
  if (isSandbox()) die('gc 要在 Mac 本机跑——沙箱不能 unlink，删不掉 worktree（quirk #1）。');
  const led = readLedger(); let n = 0;
  for (const [name, s] of Object.entries(led.sessions)) {
    if (s.state !== 'landed' && s.state !== 'aborted') continue;
    // git 2.34 的 `worktree remove` 不认相对 gitdir 指针（quirk #138 的代价）→ 手动删工作树 + admin 目录。
    // 不用 `git worktree prune`：它会把别的相对指针 worktree（如 weekend）误判可删（见 setup-weekend-worktree 注）。
    const wtAbs = join(root, s.worktree);
    const adminDir = join(commonDir(), 'worktrees', name);
    try {
      if (existsSync(wtAbs)) rmSync(wtAbs, { recursive: true, force: true });
      if (existsSync(adminDir)) rmSync(adminDir, { recursive: true, force: true });
      ok(`移除 worktree ${s.worktree}`);
    } catch (e) { warn(`移除 ${s.worktree} 失败：${String(e.message || e).split('\n')[0]}`); continue; }
    if (gitOk(['rev-parse', '--verify', '--quiet', s.branch])) { try { execFileSync('git', ['branch', '-D', s.branch], { cwd: root }); ok(`删分支 ${s.branch}`); } catch { /* ignore */ } }
    delete led.sessions[name]; n++;
  }
  writeLedger(led); ok(`gc 完成·清理 ${n} 条。`);
}

// ─────────────────────────── pre-commit 车道门 ───────────────────────────

function hookPreCommit() {
  const led = readLedger();
  const name = resolveSessionFromCwd(led);
  if (!name) process.exit(0); // 不是登记过的 session worktree（如 main 树）→ 不限制
  const s = led.sessions[name];
  let staged = '';
  try { staged = git(['diff', '--cached', '--name-only'], { cwd: repoRoot() }); } catch { process.exit(0); }
  const files = staged.split('\n').map((x) => x.trim()).filter(Boolean);
  if (!files.length) process.exit(0);
  const others = Object.entries(led.sessions).filter(([n, o]) => n !== name && (o.state === 'active' || o.state === 'ready'));
  const outOfLane = [], intrude = [];
  for (const fpath of files) {
    if (!matchesAnyLane(fpath, s.lanes)) {
      outOfLane.push(fpath);
      for (const [on, o] of others) if (matchesAnyLane(fpath, o.lanes)) { intrude.push(`${fpath} → ${on} 的车道`); break; }
    }
  }
  if (!outOfLane.length) process.exit(0);
  if (process.env.PSM_CONFIRM === '1') { warn(`车道门：放行 ${outOfLane.length} 个越界文件（PSM_CONFIRM=1）。`); process.exit(0); }
  console.error('\n' + C.yellow('■ 车道门·提交停下等你确认') + ` —— session「${name}」车道 [${s.lanes.join(', ')}]`);
  console.error('  这些 staged 文件在车道外：');
  for (const fpath of outOfLane) console.error('    · ' + fpath);
  if (intrude.length) { console.error(C.red('  其中踩进别的 session 的车道（并行撞车高危）：')); for (const i of intrude) console.error('    · ' + i); }
  console.error('\n  怎么办：');
  console.error('    · 本就该改 → 扩车道（重开 session 时把它们纳入 --lane，或改台账 lanes）。');
  console.error('    · 不该改 → git restore --staged <file> 撤出暂存。');
  console.error('    · 确认照提交（自负风险）→ ' + C.bold('PSM_CONFIRM=1 git commit ...'));
  process.exit(1);
}

// ─────────────────────────── CLI ───────────────────────────

const [cmd, ...rest] = process.argv.slice(2);
switch (cmd) {
  case 'install': cmdInstall(); break;
  case 'start': cmdStart(rest); break;
  case 'status': case 'st': cmdStatus(); break;
  case 'check': cmdCheck(rest); break;
  case 'land': cmdLand(rest); break;
  case 'merge': cmdMerge(rest); break;
  case 'abort': cmdAbort(rest); break;
  case 'gc': cmdGc(); break;
  case 'hook': if (rest[0] === 'pre-commit') hookPreCommit(); else process.exit(0); break;
  default:
    info(C.bold('psm —— 并行 session 管理器'));
    info('  install                       一次性装（钩子 + 台账 + gitignore）');
    info('  start <name> --lane <g,...>   开一条并行线（独立 worktree + 车道）');
    info('  status                        看在飞 session / 车道 / 落差 / 锁');
    info('  check <g,...>                  起手前自检车道重叠');
    info('  land [name] [--yes]           rebase + 绿门；绿了停下等确认；--yes 直接合');
    info('  merge <name>                  ff 合进 main（main 树跑）');
    info('  abort <name>                  放弃一条线');
    info('  gc                            Mac 本机清理已合并/已弃 worktree');
    info('\n详见 docs/infra/parallel-sessions.md');
    process.exit(cmd ? 1 : 0);
}
