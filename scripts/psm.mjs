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
//   node scripts/psm.mjs gc                              Mac 本机：移除已合并/已弃/已并入的 worktree（含台账外孤儿）+ 失效注册项 + 已并入 main 的 wip/*·feat/* 分支（沙箱拒绝·不能 unlink）
//   node scripts/psm.mjs doctor                          清残锁 / 中断 rebase 态（崩溃卡死后自愈·沙箱 mv 进 .sandbox-junk·可恢复）
//
// 退出码：成功 0；「警告即停·等你确认」用 3（区别于真错误 1）。

import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, symlinkSync, rmSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join, relative as relPath, posix as ppath, basename } from 'node:path';
import { isSandbox as _isSandbox } from './lib/env.mjs';
import { parseFlags } from './lib/args.mjs';
import { matchesAnyLane, lanesOverlap } from './lib/glob.mjs';
// 车道匹配/重叠判定单点真相在 lib/glob.mjs；re-export 兼容任何外部曾从 psm import 的引用。
export { laneToRegExp, matchesAnyLane, lanesOverlap } from './lib/glob.mjs';

// ─────────────────────────── 基础 ───────────────────────────

const SELF = fileURLToPath(import.meta.url);
const SCRIPTS_DIR = dirname(SELF);
const PKG_ROOT = resolve(SCRIPTS_DIR, '..'); // psm.mjs 自身所在树（可能是 worktree！结构操作一律用 ROOT）

const DEFAULT_CONFIG = {
  mainBranch: 'main',
  branchPrefix: 'feat/',
  worktreeRoot: '.worktrees',
  gate: { full: 'npm run regress', sandbox: 'npm run regress -- --only typecheck,check', affected: true },
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

// 沙箱判定收口 lib/env.mjs（单点真相·#1/#165）；psm 默认按仓库主树根 ROOT() 判。
const isSandbox = (p) => _isSandbox(p || ROOT());

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

function junkDir() { const d = join(commonDir(), '.sandbox-junk'); if (!existsSync(d)) mkdirSync(d, { recursive: true }); return d; }

function walkLockFiles(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walkLockFiles(p));
    else if (e.name.endsWith('.lock')) out.push(p);
  }
  return out;
}

// 把 git 残锁 / 中断 rebase 态 mv 进 .sandbox-junk（rename 移目录也行·无 unlink）。返回清掉的相对路径列表。
// { verbose } 选项为真时逐条打印。沙箱和 Mac 通用（mv 不删·可恢复）。
function clearStaleLocks({ verbose = false } = {}) {
  const cd = commonDir();
  const cleared = [];
  const mvAside = (p) => {
    if (!existsSync(p)) return;
    try { renameSync(p, join(junkDir(), `${Date.now()}-${basename(p)}-${Math.random().toString(36).slice(2, 6)}`)); cleared.push(relPath(ROOT(), p)); }
    catch { /* 别人正占着 / 已没了——跳过 */ }
  };
  // common .git 顶层锁 + refs 锁（含 refs/heads/feat/<x>.lock 嵌套·"cannot lock ref" 的来源）
  for (const f of ['HEAD.lock', 'index.lock', 'packed-refs.lock', 'config.lock', 'ORIG_HEAD.lock']) mvAside(join(cd, f));
  for (const p of walkLockFiles(join(cd, 'refs'))) mvAside(p);
  // 各 worktree 的锁 + 中断的 rebase / cherry-pick / merge 态目录
  const wtDir = join(cd, 'worktrees');
  if (existsSync(wtDir)) for (const w of readdirSync(wtDir)) {
    for (const f of ['HEAD.lock', 'index.lock', 'MERGE_HEAD.lock', 'rebase-merge', 'rebase-apply', 'CHERRY_PICK_HEAD.lock']) mvAside(join(wtDir, w, f));
  }
  if (verbose) {
    if (cleared.length) { ok(`清了 ${cleared.length} 个残锁 / 中断 rebase 态（mv 进 .sandbox-junk·可恢复）：`); for (const t of cleared) info('  · ' + t); }
    else ok('没有残锁 / 中断态——git 这边干净。');
  }
  return cleared;
}

// ────────────────────────────────────────────────────────────────────────────
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
// 过期判定抽成纯函数（显式喂 now/阈值·可测·见 __tests__/psm.test.mjs）：没过期返回锁本身，过期视同无锁。
export function freshLock(lock, nowMs, staleMinutes = 30) {
  if (!lock) return null;
  if ((nowMs - new Date(lock.ts).getTime()) / 60000 > staleMinutes) return null; // 废弃
  return lock;
}
function lockHolder(led) { return freshLock(led.mergeLock, Date.now(), CFG.lockStaleMinutes || 30); }

// ── pendingFf 意图标记（land/merge 的 ff 崩溃原子性·守 main 不停在未验证 tip）──
// cmdLand(Mac)/doMerge 的 `git merge --ff-only` 把 main 推到分支 tip。若进程在「ff 之后、收尾确认之前」
// 被 ^C/崩溃，main 会停在**未验证**的 tip 且无任何记录（最坏：未跑绿门的代码上了唯一要守的 main）。
// pendingFf 在 ff 前落一个安全回滚点；收尾（回滚 or 正式落地）清掉；doctor 检测「标记在 + main 已前进」
// = 未确认的 land，给出回滚/接受两条出路。
function setPendingFf(led, name, rollbackSha) {
  if (led.pendingFf) return; // 已有更早（更安全）的标记（cmdLand 先于 doMerge 设）——别覆盖成已前进的 sha
  led.pendingFf = { name, rollbackSha, ts: new Date().toISOString() };
  writeLedger(led);
}
function clearPendingFf(led) {
  if (!led.pendingFf) return;
  led.pendingFf = null;
  writeLedger(led);
}
// null=无标记；{stale:true}=标记在但 main 未前进（安全·清即可）；{stale:false,main}=未确认的 land。
// 回滚决策抽成纯函数（显式喂 mainSha·可测）；main sha 读不出也按 stale 处理——别指着空值回滚。
export function classifyPendingFf(pf, mainSha) {
  if (!pf) return null;
  if (!mainSha || mainSha === pf.rollbackSha) return { stale: true, pf };
  return { stale: false, pf, main: mainSha };
}
function inspectPendingFf(led) { return classifyPendingFf(led.pendingFf, shaOf(CFG.mainBranch)); }

// ─────────────────────────── 车道匹配 ───────────────────────────
// 车道 glob 匹配 + 重叠判定收口 lib/glob.mjs（顶部 import + re-export）。旧手搓 lanesOverlap
// 用「去通配取目录前缀」近似——对中段通配（src/*/items.json vs src/data/items.json）漏判重叠
// ＝两条 session 静默撞车（最坏方向）。新实现走分段 glob 交集非空·见 lib/glob.mjs + __tests__/glob.test.mjs。

// ─────────────────────────── flags ───────────────────────────
// parseFlags 收口 lib/args.mjs（单点真相·与 regress/affected 同源·见顶部 import）。

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
      try { symlinkSync(relPath(wtAbs, join(root, 'node_modules')), wtNM, 'dir'); ok('node_modules → symlink 复用 main 树（相对路径·Mac+沙箱通用）'); }
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

const gitCountRange = (a, b) => git(['rev-list', '--count', `${a}..${b}`]);
// 基线落后 main 几个 commit。countRange 注入＝纯可测；sha 缺失 / count 抛错 → '?'。
export function driftFromMain(baseSha, mainSha, countRange) {
  if (!mainSha || !baseSha) return '?';
  try { return countRange(baseSha, mainSha); } catch { return '?'; }
}
// 纯判定：「分支已并入 main」＝tip 是 main 祖先（ahead==0 / is-ancestor）**且**确实有过提交（work>0）。
// 只看 is-ancestor 不够：刚开线零提交的分支 tip 就是旧 main、天然是祖先——照收会误伤在飞 session。
export function isMergedIntoMain(isAncestor, workCount) { return !!isAncestor && Number(workCount) > 0; }
// 台账 flag 可能 stale（沙箱不能可靠回写台账·并发 session 推进 main）——用 git 真值核对：分支的活已全
// 在 main（main..branch == 0）且分支确实有过提交（baseSha..branch > 0）= 实际已 land。返回提示串 or null。
// 守效率复盘 #4：别照台账 active/ready 判「在飞」，git 才是真相（同 #96 定位轴·同 mergedWipBranches 思路）。
function staleLandedNote(s) {
  if (!s.branch) return null;
  try {
    const ahead = git(['rev-list', '--count', `${CFG.mainBranch}..${s.branch}`]);
    const work = s.baseSha ? git(['rev-list', '--count', `${s.baseSha}..${s.branch}`]) : '0'; // base 未知→不冒「已 land」误报
    if (isMergedIntoMain(ahead === '0', work)) return `台账标 ${s.state} 但分支已并入 main——实际已 land（Mac 上 psm gc 收）。`;
  } catch { /* 分支不可解析（异常 worktree）→ 不判 */ }
  return null;
}
function cmdStatus() {
  const led = readLedger();
  const pend = inspectPendingFf(led);
  if (pend && !pend.stale) warn(`未确认的 land「${pend.pf.name}」——${CFG.mainBranch} 已前进过 ff 但没收尾。${C.bold('psm doctor')} 看怎么办。`);
  const sessions = Object.entries(led.sessions);
  info(C.bold('psm status') + C.dim(`  · 主干 ${CFG.mainBranch}@${(shaOf(CFG.mainBranch) || '?').slice(0, 8)}  · ${isSandbox() ? '沙箱' : 'Mac 本机'}`));
  const active = sessions.filter(([, s]) => s.state === 'active' || s.state === 'ready');
  if (!active.length) info(C.dim('  （无在飞 session）'));
  for (const [n, s] of active) {
    const drift = driftFromMain(s.baseSha, shaOf(CFG.mainBranch), gitCountRange);
    info(`  ${C.bold(n)}  [${s.state === 'ready' ? C.green('ready') : 'active'}]  ${s.branch}`);
    info(`      车道 [${s.lanes.join(', ')}]`);
    info(C.dim(`      worktree ${s.worktree} · 基线落后 main ${drift} commit${drift !== '0' && drift !== '?' ? '（land 会先 rebase）' : ''}`));
    const sl = staleLandedNote(s);
    if (sl) warn(`      ⚠ ${sl}`);
  }
  const names = active.map(([n]) => n);
  for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++)
    if (lanesOverlap(led.sessions[names[i]].lanes, led.sessions[names[j]].lanes)) warn(`车道重叠：${names[i]} ↔ ${names[j]}——并行有撞车风险。`);
  const lk = lockHolder(led);
  if (lk) info(C.yellow(`\n  merge 锁：${lk.holder} 持有中（${lk.ts}）`));
  const landed = sessions.filter(([, s]) => s.state === 'landed' || s.state === 'aborted');
  if (landed.length) info(C.dim(`\n  待清理（${isSandbox() ? 'Mac 上 ' : ''}psm gc）：${landed.map(([n, s]) => `${n}(${s.state})`).join(', ')}`));
  const mw = mergedWipBranches(led);
  if (mw.length) info(C.dim(`  已并入 main 的 wip/*·feat/* 分支（${isSandbox() ? 'Mac 上 ' : ''}psm gc 清）：${mw.join(', ')}`));
  const orph = orphanWorktrees(led);
  if (orph.length) info(C.dim(`  孤儿 worktree·分支已并入 main（${isSandbox() ? 'Mac 上 ' : ''}psm gc 收）：${orph.map((o) => `${CFG.worktreeRoot}/${o.name}(${o.branch})`).join(', ')}`));
  const dang = danglingWorktreeAdmins(led);
  if (dang.length) info(C.dim(`  失效 worktree 注册项·gitdir 指向不存在路径（${isSandbox() ? 'Mac 上 ' : ''}psm gc 清）：${dang.map((d) => d.name).join(', ')}`));
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
// 决定这次 land 跑哪条绿门命令。affected 模式：算改动→依赖图→受影响行为测，只精确跑那些 + 静态门。
// 健全回退：选测不可用 / 改动波及 ALL → 退回 full（Mac）或静态子集（沙箱）。沙箱无 esbuild 跑不了
// 行为测 → 只跑静态门，把受影响行为测列进 deferred（交接到 Mac 补跑）。
// sinceRef＝affected 选测的 diff 基准（默认 main）。Mac cmdLand 在 temp ff **之后**跑 gate——那一刻
// merge-base(main,HEAD)==HEAD、diff 恒空、行为测会被误判全跳过 → 必须传 ff 前捕获的 preFfSha 当基准。
function gatePlan(cwd, forceFull, sinceRef = CFG.mainBranch) {
  const sb = isSandbox(cwd);
  const fallback = sb ? CFG.gate.sandbox : CFG.gate.full;
  // 沙箱跑静态子集时行为测全没跑——「回退/affected→ALL」分支用 ['ALL'] 哨兵交接 Mac 补跑**全量**，
  // 否则 affected→ALL 的改动会在 Mac merge 时零行为覆盖就合入（#2 洞）。Mac 上 fallback 本就是全量·deferred 留空。
  const fallbackDeferred = sb ? ['ALL'] : [];
  if (forceFull) return { cmd: CFG.gate.full, note: '全量（--full）', deferred: [] };
  if (!CFG.gate.affected) return { cmd: fallback, note: sb ? '沙箱静态子集' : '全量', deferred: fallbackDeferred };
  let res = null;
  const r = spawnSync('node', ['scripts/affected-tests.mjs', '--since', sinceRef, '--json'], { cwd, encoding: 'utf-8' });
  if (r.status === 0) { try { res = JSON.parse(r.stdout); } catch { /* */ } }
  if (!res) return { cmd: fallback, note: '选测不可用·回退' + (sb ? '静态子集' : '全量'), deferred: fallbackDeferred };
  if (res.mode === 'all') return { cmd: fallback, note: `affected→ALL（${res.reason}）·跑${sb ? '静态子集' : '全量'}`, deferred: fallbackDeferred };
  const beh = res.tasks || [];
  if (!beh.length) return { cmd: 'npm run regress -- --only typecheck,check', note: '无受影响行为测·只跑静态门', deferred: [] };
  const runnable = !sb || !!process.env.ESBUILD_BINARY_PATH;
  if (runnable) return { cmd: `npm run regress -- --only typecheck,check --only-exact ${beh.join(',')}`, note: `affected：typecheck+check + ${beh.length} 受影响行为测`, deferred: [] };
  return { cmd: 'npm run regress -- --only typecheck,check', note: `沙箱无 esbuild·跑静态门；${beh.length} 受影响行为测留待 Mac`, deferred: beh };
}
function runGate(cwd, forceFull, sinceRef) {
  const plan = gatePlan(cwd, forceFull, sinceRef);
  info(C.bold('\n跑绿门：') + ` ${plan.cmd}  ${C.dim('（' + plan.note + '）')}`);
  return { ok: spawnSync(plan.cmd, { cwd, shell: true, stdio: 'inherit' }).status === 0, deferred: plan.deferred };
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

  // 沙箱护栏（mount 不能 unlink·quirk #1）：git rebase 必须删状态目录才能收尾——沙箱删不掉 → rebase 崩、
  // 残锁（HEAD.lock / index.lock / rebase-merge）留在**共享** .git 里，连 Mac 的 land 一起毒死（正是 ch1-st2
  // 那次级联卡死的根因）。所以沙箱**不在这里 rebase**：先 doctor 清掉上次留的残锁（自愈），跑分支自身绿门
  // （沙箱自动降级静态门·CFG.gate.sandbox），停下让 **Mac** 收尾（Mac 能 unlink·rebase + ff 正常）。
  if (isSandbox()) {
    const cleared = clearStaleLocks();
    if (cleared.length) ok(`doctor：先清了 ${cleared.length} 个残锁 / 中断 rebase 态（mv 进 .sandbox-junk·可恢复）。`);
    warn('沙箱（mount 不能 unlink·quirk #1）——不在沙箱跑 git rebase（会崩 + 残锁污染共享 .git、毒到 Mac 的 land）。');
    const gate = runGate(wtAbs, f.full);
    if (!gate.ok) { s.state = 'active'; writeLedger(led); stop(`绿门没过——先在 ${s.worktree} 修绿，再 psm land ${name}。`); }
    // deferred 存入台账：psm merge / land --yes 在 Mac 上看到非空列表时会自动补跑（#171）
    s.state = 'ready'; s.deferred = gate.deferred || []; s.updated = new Date().toISOString(); writeLedger(led);
    const dn = gate.deferred && gate.deferred.length
      ? '\n  ' + C.dim(`Mac 上将自动补跑受影响行为测（${gate.deferred.length} 个）：${gate.deferred.join(',')}`)
      : '';
    stop(`✓ 分支 ${C.bold(s.branch)} 绿门通过、已就绪（沙箱不 rebase / 不合并）。${dn}\n  在 ${C.bold('Mac 主树')} 跑 ${C.bold('node scripts/psm.mjs land ' + name + ' --yes')} 完成 rebase + ff（Mac 能 unlink）。${C.dim('（夜间任务也会在 Mac/CI 上自动收。）')}`);
  }

  const mainSha = shaOf(CFG.mainBranch);
  info(`rebase ${s.branch} → ${CFG.mainBranch}@${mainSha.slice(0, 8)} ...`);

  // Auto-stash：沙箱提交后 index 残留 staged/unstaged 文件会让 rebase 直接拒绝（quirk #104 副作用）。
  // 策略：rebase 前检测受跟踪文件的脏态（忽略 ?? 未追踪），有则 stash；rebase 后（成功或失败）drop。
  // drop 不 pop：stash 里是沙箱 index 残留，不是真正的 WIP，恢复只会制造噪声。
  const statusOut = spawnSync('git', ['--no-optional-locks', 'status', '--porcelain'], { cwd: wtAbs, encoding: 'utf-8' });
  const dirtyTracked = (statusOut.stdout || '').split('\n').filter(l => l.length >= 2 && !(l[0] === '?' && l[1] === '?') && l.trim());
  let autoStashed = false;
  if (dirtyTracked.length) {
    const st = spawnSync('git', ['--no-optional-locks', 'stash', 'push', '-m', 'psm-land-autostash'], { cwd: wtAbs, encoding: 'utf-8' });
    if (st.status !== 0) die(`auto-stash 失败（${dirtyTracked.length} 个脏文件·手动 git stash 后再 land）：\n${st.stderr || st.stdout}`);
    autoStashed = true;
    warn(`⚠ 工作区有 ${dirtyTracked.length} 个未提交改动（常见：沙箱 index 残留）——已自动 stash，rebase 后 drop。`);
  }

  const rb = spawnSync('git', ['--no-optional-locks', 'rebase', CFG.mainBranch], { cwd: wtAbs, encoding: 'utf-8' });
  if (autoStashed) spawnSync('git', ['--no-optional-locks', 'stash', 'drop'], { cwd: wtAbs, stdio: 'ignore' });
  if (rb.status !== 0) {
    spawnSync('git', ['rebase', '--abort'], { cwd: wtAbs, stdio: 'ignore' });
    warn((rb.stderr || rb.stdout || '').trim().split('\n').slice(-6).join('\n'));
    stop(`rebase 到 ${CFG.mainBranch} 有冲突——和别的 session 改到同一处了（车道重叠的代价）。\n  手动解：cd ${s.worktree} && git rebase ${CFG.mainBranch}，解完再 psm land ${name}。`);
  }
  s.baseSha = mainSha; s.updated = new Date().toISOString(); writeLedger(led);
  ok(`rebase 完成（基线对齐 ${CFG.mainBranch}@${mainSha.slice(0, 8)}）`);

  // ── gate ──────────────────────────────────────────────────────────────────
  // Mac：从 main 树 temp ff 后跑 gate（worktree esbuild 启动在 Mac 上有 ENOEXEC(-8) 问题）。
  // 沙箱：从 worktree 跑（esbuild-free 子集·原来路径不变）。
  const runningOnMac = !isSandbox();
  let gate;

  if (runningOnMac) {
    const root = ROOT();
    // 先清沙箱残留 lock——mv 沙箱/Mac 通用，不会留死 *.lock 挡 ff-merge
    clearStaleLocks();
    const preFfSha = shaOf(CFG.mainBranch);
    setPendingFf(led, name, preFfSha); // ff 前落安全回滚点（崩溃原子性·崩在下面随时可被 doctor 检测/回滚）
    const ffResult = spawnSync('git', ['merge', '--ff-only', s.branch], { cwd: root, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
    if (ffResult.status !== 0) {
      clearPendingFf(led); // ff 没发生·main 未动
      warn((ffResult.stderr || ffResult.stdout || '').trim());
      stop(`ff 预合并失败（main 树有未提交改动？或分支不可 ff？）`);
    }
    // 时序约束：main 已 ff 到分支 tip → 对 main 的 diff 恒空，affected 选测必须以 preFfSha（旧 main）为基准。
    gate = runGate(root, f.full, preFfSha);
    // 两种情况需要回滚 temp ff：绿门没过，或绿门过了但用户还没确认（无 --yes）
    if (!gate.ok || !f.yes) {
      spawnSync('git', ['reset', '--hard', preFfSha], { cwd: root, stdio: 'inherit' });
      clearPendingFf(led); // 已回到安全点
    }
    if (!gate.ok) {
      s.state = 'active'; writeLedger(led);
      stop(`绿门没过——main 已回滚。先在 ${s.worktree} 修绿，再 psm land ${name}。`);
    }
  } else {
    gate = runGate(wtAbs, f.full);
    if (!gate.ok) { s.state = 'active'; writeLedger(led); stop(`绿门没过——别合。先在 ${s.worktree} 修绿，再 psm land ${name}。`); }
  }

  // Mac gate 已跑全量 affected（含沙箱 deferred）→ 清空 deferred，doMerge 不重复跑（#171）
  s.state = 'ready'; s.deferred = []; s.updated = new Date().toISOString(); writeLedger(led);

  if (!f.yes) {
    info('\n' + C.green('✓ rebased + 绿门通过') + `（${s.branch} 基于 ${CFG.mainBranch}@${mainSha.slice(0, 8)}）`);
    stop(`要把「${name}」ff 合进 ${CFG.mainBranch} 吗？确认就在 ${C.bold('main 树')} 跑：${C.bold('node scripts/psm.mjs land ' + name + ' --yes')}（或 psm merge ${name}）。`);
  }

  // ── --yes：正式合并 ───────────────────────────────────────────────────────
  if (runningOnMac) {
    // Mac temp ff 在绿门阶段已做完且未回滚（gate.ok && f.yes）；
    // 更新 baseSha 让 doMerge 的幂等性检查通过（main 已在 branch tip，merge 会 no-op）
    s.baseSha = shaOf(CFG.mainBranch); s.updated = new Date().toISOString(); writeLedger(led);
  }
  doMerge(name);
}
function cmdMerge(argv) { const name = parseFlags(argv)._[0]; if (!name) die('用法：psm merge <name>（在 main 树跑）。'); doMerge(name); }
function doMerge(name) {
  const root = ROOT();
  const led = readLedger();
  const s = led.sessions[name];
  if (!s) die(`没这条 session：${name}。`);
  // 沙箱护栏（quirk #1）：`git merge --ff-only` 在沙箱里更新工作树/删文件会撞 unlink、崩了留残锁毒共享 .git。
  // ff 合并只在 Mac 主树（能 unlink）做。
  if (isSandbox()) stop(`沙箱不做 ff 合并（mount 不能 unlink·\`git merge\` 可能崩在工作树更新 / 残锁上、毒到 Mac）——在 ${C.bold('Mac 主树')}（能 unlink）跑 psm merge ${name} / land --yes。${C.dim('（或等夜间任务在 Mac/CI 上收。）')}`);
  if (s.state !== 'ready') stop(`「${name}」还没过绿门（state=${s.state}）。先 psm land ${name}。`);
  const br = currentBranch();
  if (br !== CFG.mainBranch) stop(`合并要在 ${C.bold('main 树')}（当前分支 ${br}）跑——advance ${CFG.mainBranch} 会动 main 树文件，必须在那棵树上做。切到 main session 里 psm merge ${name}。`);
  const mainSha = shaOf(CFG.mainBranch);
  if (mainSha !== s.baseSha) stop(`${CFG.mainBranch} 在你 rebase 后又前进了（${s.baseSha.slice(0, 8)} → ${mainSha.slice(0, 8)}）——别的 session 抢先合了。重新 psm land ${name} 再合。`);
  // 沙箱 deferred 行为测——Mac 上合并前补跑，防止 psm merge 绕过 gate（quirk #171）
  if (s.deferred && s.deferred.length) {
    const wtAbs = join(root, s.worktree);
    // 'ALL' 哨兵（沙箱 affected→ALL/回退·见 gatePlan）→ Mac 补跑全量行为测（--skip build：build 的 esbuild 在
    // worktree 启动有 ENOEXEC·由 Mac cmdLand 主树路径 / nightly 覆盖·#147）。否则按受影响精确补跑（#171）。
    const isAll = s.deferred.includes('ALL');
    const dCmd = isAll ? 'npm run regress -- --skip build' : `npm run regress -- --only-exact ${s.deferred.join(',')}`;
    info(C.bold('\n补跑 deferred 行为测：') + ` ${dCmd}  ${C.dim(`（沙箱未跑·Mac 补·quirk #171${isAll ? '·ALL 哨兵：沙箱当时无法收窄→全量' : ''}）`)}`);
    const dr = spawnSync(dCmd, { cwd: wtAbs, shell: true, stdio: 'inherit' });
    if (dr.status !== 0) stop(`deferred 行为测没过——先修绿再 psm merge ${name}。`);
    s.deferred = []; writeLedger(led);
  }

  const lk = lockHolder(led);
  if (lk && lk.holder !== name) stop(`merge 锁被「${lk.holder}」持有（${lk.ts}）。等它合完，或 ${CFG.lockStaleMinutes}min 后自动释放。`);
  led.mergeLock = { holder: name, ts: new Date().toISOString() }; writeLedger(led);

  info(`ff 合并 ${s.branch} → ${CFG.mainBranch} ...`);
  setPendingFf(led, name, shaOf(CFG.mainBranch)); // 独立 cmdMerge 路径的安全回滚点（cmdLand --yes 已设则不覆盖）
  const m = spawnSync('git', ['merge', '--ff-only', s.branch], { cwd: root, encoding: 'utf-8' });
  if (m.status !== 0) { clearPendingFf(led); led.mergeLock = null; writeLedger(led); warn((m.stderr || m.stdout || '').trim().split('\n').slice(-6).join('\n')); stop(`ff 合并没成（${CFG.mainBranch} 可能动过）。重新 psm land ${name}。`); }
  s.state = 'landed'; s.updated = new Date().toISOString(); led.mergeLock = null; writeLedger(led);
  clearPendingFf(led); // 正式落地·收尾确认
  ok(`「${name}」已 ff 合进 ${CFG.mainBranch}@${shaOf(CFG.mainBranch).slice(0, 8)}。`);
  info(C.dim(`  worktree ${s.worktree} 留在原地（沙箱不能删）。Mac 本机收：node scripts/psm.mjs gc`));
  info(C.dim('  追加 CHANGELOG/QUIRKS、push origin：照你现有 main 流程走（psm 不碰 append-only 文档·免冲突）。'));
}

// ─────────────────────────── abort / gc ───────────────────────────

// ─────────────────────────── unlock / doctor ───────────────────────────
// clearStaleLocks（上面已定义）用 mv（renameSync）——沙箱和 Mac 通用，不需要 unlink。
// unlock：Mac 本机工具（语义上为 Mac 清理），调 clearStaleLocks 即可。
// doctor：沙箱自愈工具·跨平台·同样调 clearStaleLocks（mv·可恢复）。
function cmdUnlock() {
  if (isSandbox()) die('unlock 要在 Mac 本机跑（沙箱请用 psm doctor·mv 不删·可恢复）。');
  clearStaleLocks({ verbose: true });
}
function cmdDoctor(argv = []) {
  const f = parseFlags(argv);
  clearStaleLocks({ verbose: true });
  // 未确认的 land 检测（ff 后崩在收尾确认前·main 可能停在未验证 tip·pendingFf 标记）
  const led = readLedger();
  const pend = inspectPendingFf(led);
  if (pend && pend.stale) { clearPendingFf(led); ok('清掉一个陈旧 pendingFf 标记（main 未前进·安全）。'); }
  else if (pend) {
    if (f['accept-landed']) { clearPendingFf(led); ok(`已接受「${pend.pf.name}」为正常落地·清掉 pendingFf 标记。`); }
    else {
      warn(`未确认的 land：「${pend.pf.name}」ff 后未收尾（${pend.pf.ts}）。`);
      info(`  ${CFG.mainBranch} 现在 ${pend.main.slice(0, 8)}，该 land 的安全回滚点 = ${pend.pf.rollbackSha.slice(0, 8)}。`);
      info(`  · 那次 land 没跑完绿门 / 没确认 → 在 main 树 ${C.bold('git reset --hard ' + pend.pf.rollbackSha)} 撤回未验证 tip。`);
      info(`  · 其实已正常落地 → ${C.bold('node scripts/psm.mjs doctor --accept-landed')} 清掉标记。`);
    }
  }
  if (!isSandbox()) info(C.dim('（非沙箱：git 通常自己清锁·doctor 只在崩溃卡死后兜底。）'));
}
function cmdAbort(argv) {
  const name = parseFlags(argv)._[0]; if (!name) die('用法：psm abort <name>');
  const led = readLedger(); const s = led.sessions[name];
  if (!s) die(`没这条 session：${name}。`);
  s.state = 'aborted'; s.updated = new Date().toISOString(); writeLedger(led);
  ok(`「${name}」已标记 aborted。`);
  info(C.dim(`  worktree ${s.worktree} 与分支 ${s.branch} 留着（沙箱不能删）。Mac 本机：node scripts/psm.mjs gc`));
}
// 已整体并入 main 的 wip/* + feat/* 分支：交互 session churn / 已收的 worktree 留下的陈旧本地指针。
// 「tip 已是 main 祖先」＝其改动全在 main 里 → 删之零损失。main / 当前分支 / auto/weekend（周末线·
// 永不自动删）一律排除；传 led 时再排除在飞 session 的分支（刚开线零提交也是 main 祖先·别误删）。
function mergedWipBranches(led = null) {
  let merged = [];
  try {
    merged = git(['branch', '--merged', CFG.mainBranch, '--format=%(refname:short)'])
      .split('\n').map((x) => x.trim()).filter(Boolean);
  } catch { return []; }
  const keep = new Set([CFG.mainBranch, 'auto/weekend', currentBranch()].filter(Boolean));
  if (led) for (const s of Object.values(led.sessions)) if (s.state === 'active' || s.state === 'ready') keep.add(s.branch);
  return merged.filter((b) => (b.startsWith('wip/') || b.startsWith(CFG.branchPrefix)) && !keep.has(b));
}
// 纯判定：gc 该不该收这条台账 session（git/fs 事实由调用侧喂·可测·见 __tests__/psm.test.mjs）。
// landed/aborted＝人已定性·直接收（旧行为不变）；active/ready 只有「确实已并入 main」才视同 landed，
// 且 auto/weekend / 当前分支永不自动收、脏树跳过（宁留勿删）。
export function shouldGcSession({ state, isAncestor, workCount, dirty, branch, currentBranch, protectedBranches = ['auto/weekend'] }) {
  if (state === 'landed' || state === 'aborted') return { reap: true, reason: state };
  if (state !== 'active' && state !== 'ready') return { reap: false, reason: 'unknown-state' };
  if (!isMergedIntoMain(isAncestor, workCount)) return { reap: false, reason: 'in-flight' };
  if (branch && (protectedBranches.includes(branch) || branch === currentBranch)) return { reap: false, reason: 'protected' };
  if (dirty) return { reap: false, reason: 'dirty' };
  return { reap: true, reason: 'merged' };
}
// worktree 脏态：受跟踪改动或未追踪文件都算脏（gc 宁留勿删）。node_modules 是 psm 挂的 symlink——
// .gitignore 的 `node_modules/` 尾斜杠不匹配 symlink、status 里会冒 ?? ——排除掉别当脏。
function worktreeDirty(wtAbs) {
  const r = spawnSync('git', ['--no-optional-locks', 'status', '--porcelain'], { cwd: wtAbs, encoding: 'utf-8' });
  if (r.status !== 0) return true; // 状态都读不出 → 按脏处理
  return (r.stdout || '').split('\n').some((l) => l.trim() && l.slice(3).replace(/\/$/, '') !== 'node_modules');
}
// ③ 不在台账但挂在 .worktrees/ 下的孤儿 worktree（手动 git worktree add 的残留·如 poi-roaming）：
//    分支已并入 main 才算可收。main / auto/weekend / 当前分支 / detached / 读不出分支的一律不碰。
function orphanWorktrees(led) {
  const wtRoot = join(ROOT(), CFG.worktreeRoot);
  if (!existsSync(wtRoot)) return [];
  const known = new Set(Object.values(led.sessions).map((s) => basename(s.worktree)));
  const out = [];
  for (const e of readdirSync(wtRoot, { withFileTypes: true })) {
    if (!e.isDirectory() || known.has(e.name)) continue;
    const wtAbs = join(wtRoot, e.name);
    if (!existsSync(join(wtAbs, '.git'))) continue; // 不是 worktree 的杂物不猜
    const br = currentBranch(wtAbs);
    if (!br || br === 'HEAD') continue;
    if (br === CFG.mainBranch || br === 'auto/weekend' || br === currentBranch()) continue;
    if (!gitOk(['merge-base', '--is-ancestor', br, CFG.mainBranch])) continue; // 还有没并入的活 → 在飞
    out.push({ name: e.name, wtAbs, branch: br });
  }
  return out;
}
// ④ .git/worktrees/ 下 gitdir 指向不存在路径的失效注册项（worktree 目录已没了、注册还挂着）。
//    与台账收割同款手法 rm -rf 注册目录——继续避开 `git worktree prune`（会误删相对指针的
//    weekend worktree·quirk #138）。台账内 session 与 weekend（HEAD 指 auto/weekend）不碰。
function danglingWorktreeAdmins(led) {
  const wtDir = join(commonDir(), 'worktrees');
  if (!existsSync(wtDir)) return [];
  const known = new Set(Object.values(led.sessions).map((s) => basename(s.worktree)));
  const out = [];
  for (const name of readdirSync(wtDir)) {
    if (known.has(name)) continue;
    const adminDir = join(wtDir, name);
    let gd = ''; let head = '';
    try { gd = readFileSync(join(adminDir, 'gitdir'), 'utf-8').trim(); } catch { continue; } // 没 gitdir 的不猜
    try { head = readFileSync(join(adminDir, 'HEAD'), 'utf-8').trim(); } catch { /* HEAD 读不出不拦 */ }
    if (head.includes('refs/heads/auto/weekend')) continue;
    if (existsSync(resolve(adminDir, gd))) continue; // 相对指针相对 admin 目录解析（quirk #138）·还在 → worktree 活着
    out.push({ name, adminDir });
  }
  return out;
}
function cmdGc() {
  const root = ROOT();
  if (isSandbox()) die('gc 要在 Mac 本机跑——沙箱不能 unlink，删不掉 worktree（quirk #1）。');
  const led = readLedger(); let n = 0;
  const curBr = currentBranch();
  for (const [name, s] of Object.entries(led.sessions)) {
    const wtAbs = join(root, s.worktree);
    // ① 收不收走纯函数判（shouldGcSession）：landed/aborted 直接收；active/ready 但分支已并入 main
    //    （is-ancestor + 有过真实提交）→ 视同 landed 收走；脏树跳过并 warn。
    const inFlight = s.state === 'active' || s.state === 'ready';
    const decision = shouldGcSession({
      state: s.state,
      isAncestor: inFlight && s.branch ? gitOk(['merge-base', '--is-ancestor', s.branch, CFG.mainBranch]) : false,
      workCount: inFlight && s.baseSha && s.branch ? Number(gitCountRange(s.baseSha, s.branch) || 0) : 0,
      dirty: inFlight && existsSync(wtAbs) ? worktreeDirty(wtAbs) : false,
      branch: s.branch, currentBranch: curBr,
    });
    if (!decision.reap) {
      if (decision.reason === 'dirty') warn(`跳过「${name}」：分支已并入 main 但 ${s.worktree} 有未提交改动——收拾干净再 gc。`);
      continue;
    }
    if (decision.reason === 'merged') info(`「${name}」台账标 ${s.state} 但分支已并入 main——视同 landed 收走。`);
    // git 2.34 的 `worktree remove` 不认相对 gitdir 指针（quirk #138 的代价）→ 手动删工作树 + admin 目录。
    // 不用 `git worktree prune`：它会把别的相对指针 worktree（如 weekend）误判可删（见 setup-weekend-worktree 注）。
    const adminDir = join(commonDir(), 'worktrees', name);
    try {
      if (existsSync(wtAbs)) rmSync(wtAbs, { recursive: true, force: true });
      if (existsSync(adminDir)) rmSync(adminDir, { recursive: true, force: true });
      ok(`移除 worktree ${s.worktree}`);
    } catch (e) { warn(`移除 ${s.worktree} 失败：${String(e.message || e).split('\n')[0]}`); continue; }
    if (gitOk(['rev-parse', '--verify', '--quiet', s.branch])) { try { execFileSync('git', ['branch', '-D', s.branch], { cwd: root }); ok(`删分支 ${s.branch}`); } catch { /* ignore */ } }
    delete led.sessions[name]; n++;
  }
  writeLedger(led);
  // ③ 孤儿 worktree（不在台账·分支已并入 main）——脏树同样跳过；分支留给下面 ② 的 merged 清扫收。
  let orphN = 0;
  for (const o of orphanWorktrees(led)) {
    if (worktreeDirty(o.wtAbs)) { warn(`跳过孤儿 worktree ${CFG.worktreeRoot}/${o.name}：有未提交改动。`); continue; }
    const adminDir = join(commonDir(), 'worktrees', o.name);
    try {
      rmSync(o.wtAbs, { recursive: true, force: true });
      if (existsSync(adminDir)) rmSync(adminDir, { recursive: true, force: true });
      ok(`移除孤儿 worktree ${CFG.worktreeRoot}/${o.name}（分支 ${o.branch} 已并入 main）`);
      orphN++;
    } catch (e) { warn(`移除孤儿 worktree ${o.name} 失败：${String(e.message || e).split('\n')[0]}`); }
  }
  // ④ 失效 worktree 注册项（gitdir 指向不存在路径）。
  let dangN = 0;
  for (const d of danglingWorktreeAdmins(led)) {
    try { rmSync(d.adminDir, { recursive: true, force: true }); ok(`清失效 worktree 注册项 .git/worktrees/${d.name}（gitdir 指向不存在路径）`); dangN++; }
    catch (e) { warn(`清注册项 ${d.name} 失败：${String(e.message || e).split('\n')[0]}`); }
  }
  // ② 已并入 main 的 wip/* + feat/* 分支——`git branch -d` 自带「未完全合并就拒删」安全门（mergedWipBranches 已预筛一道）。
  let wipN = 0;
  for (const b of mergedWipBranches(led)) {
    try { execFileSync('git', ['branch', '-d', b], { cwd: root }); ok(`删已并入分支 ${b}`); wipN++; }
    catch (e) { warn(`删 ${b} 失败（未完全合并？）：${String(e.message || e).split('\n')[0]}`); }
  }
  ok(`gc 完成·台账 worktree ${n} 条${orphN ? ` + 孤儿 worktree ${orphN} 条` : ''}${dangN ? ` + 失效注册项 ${dangN} 个` : ''}${wipN ? ` + 已并入分支 ${wipN} 个` : ''}。`);
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

// 只有直接 `node scripts/psm.mjs <cmd>` 才进 CLI dispatch；被 import（__tests__/psm.test.mjs 测
// 上面导出的纯判定）不执行——同 check-branch.mjs / affected-tests.mjs 的 isMain 门。
const isMain = process.argv[1] && resolve(process.argv[1]) === SELF;
if (isMain) {
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
    case 'unlock': cmdUnlock(); break;
    case 'doctor': cmdDoctor(rest); break;
    case 'hook': if (rest[0] === 'pre-commit') hookPreCommit(); else process.exit(0); break;
    default:
      info(C.bold('psm —— 并行 session 管理器'));
      info('  install                       一次性装（钩子 + 台账 + gitignore）');
      info('  start <name> --lane <g,...>   开一条并行线（独立 worktree + 车道）');
      info('  status                        看在飞 session / 车道 / 落差 / 锁 / 待清理项');
      info('  check <g,...>                  起手前自检车道重叠');
      info('  land [name] [--yes]           rebase + 绿门；绿了停下等确认；--yes 直接合');
      info('  merge <name>                  ff 合进 main（main 树跑）');
      info('  abort <name>                  放弃一条线');
      info('  gc                            Mac 本机清理：已合并/已弃/已并入 worktree + 孤儿 worktree + 失效注册项 + 已并入的 wip/*·feat/* 分支');
      info('  unlock                        清沙箱遗留 *.lock 文件（land 会自动调·手动备用）');
      info('  doctor                        清残锁 / 中断 rebase 态（崩溃卡死后自愈·只 mv 不删）');
      info('\n详见 docs/infra/parallel-sessions.md');
      process.exit(cmd ? 1 : 0);
  }
}
