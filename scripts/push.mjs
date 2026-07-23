#!/usr/bin/env node
// push.mjs — 收尾后在作者 Mac 上一条命令收掉「每次沙箱 session 都留的手动尾巴」：
//   ① 清沙箱残骸（.git/.sandbox-junk + strand 的 *.lock·mount 不能 unlink→留给 Mac 清·见 [[sandbox_git_commit]]）
//   ② push main（优先用 gitignored .deploy-token 走直连·token 永不打印·见 [[github_pages_deploy]]）
//   ③ fetch 刷新 tracking ref（免 quirk #103 幻影 [ahead N]）
//
// 只在 Mac 跑（有 git 凭证 + 原生 FS 能 unlink）。沙箱无凭证 → 照旧 push 留这里。
//
// 用法：
//   npm run push            预览待 push 的 commit → 确认 → 清残骸 + push + fetch
//   npm run push -- -y      跳过确认（push 会触发线上 GitHub Actions 部署·慎用）
//   npm run push -- --dry-run   只看会 push 什么 + 清残骸，不真 push

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_URL = 'github.com/shenhuang/blue.git';
const args = new Set(process.argv.slice(2));
const DRY = args.has('--dry-run') || args.has('-n');
const YES = args.has('-y') || args.has('--yes');

const NOPROXY = ['-c', 'http.proxy=', '-c', 'https.proxy=']; // 公开仓库直连·绕死代理（[[github_pages_deploy]] 坑②）
function git(gitArgs, opts = {}) {
  return spawnSync('git', gitArgs, { cwd: ROOT, encoding: 'utf8', ...opts });
}
function gitOut(gitArgs) {
  return (git(gitArgs).stdout || '').trim();
}

// ── ① 清沙箱残骸 ───────────────────────────────────────────────
const junkDir = join(ROOT, '.git', '.sandbox-junk');
const cleaned = [];
const failed = [];
function tryRm(p, label, recursive = false) {
  if (!existsSync(p)) return;
  try { rmSync(p, { recursive, force: true }); cleaned.push(label); }
  catch { failed.push(label); } // 在沙箱 mount 上 unlink 被拒是预期（本脚本是给 Mac 跑的）
}
tryRm(junkDir, '.sandbox-junk', true);
const staleLocks = ['index.lock', 'HEAD.lock', join('refs', 'heads', 'main.lock')];
try {
  for (const f of readdirSync(join(ROOT, '.git'))) if (/^next-index-.*\.lock$/.test(f)) staleLocks.push(f);
} catch {}
for (const rel of staleLocks) tryRm(join(ROOT, '.git', rel), rel);
if (cleaned.length) console.log(`[push] 清残骸: ${cleaned.join(', ')}`);
if (failed.length) console.log(`[push] ⚠ 删不掉（在沙箱？本脚本请在 Mac 跑）: ${failed.join(', ')}`);
if (!cleaned.length && !failed.length) console.log('[push] 无沙箱残骸');

// ── 定位待 push ────────────────────────────────────────────────
const branch = gitOut(['rev-parse', '--abbrev-ref', 'HEAD']);
if (branch !== 'main') {
  console.error(`[push] ✗ 当前在 '${branch}' 不是 main——本脚本只发 main。先 checkout main。`);
  process.exit(1);
}
// 先静默 fetch 一次拿真值（免 quirk #103 幻影）；无网则继续用本地 tracking ref。
git([...NOPROXY, 'fetch', 'origin', 'main'], { stdio: 'ignore' });
const ahead = gitOut(['rev-list', '--count', 'origin/main..HEAD']);
const behind = gitOut(['rev-list', '--count', 'HEAD..origin/main']);
if (behind && behind !== '0') {
  console.log(`[push] ⚠ 落后 origin/main ${behind} 笔（可能 nightly 推的 .gitkeep 之类）——push 前你可能想先 rebase/merge。`);
}
if (!ahead || ahead === '0') {
  console.log('[push] 无待 push 的 commit（origin/main 已是最新）。收工。');
  process.exit(0);
}
console.log(`[push] 待 push ${ahead} 笔：`);
console.log(gitOut(['log', '--oneline', '--no-decorate', 'origin/main..HEAD']).split('\n').map((l) => '  ' + l).join('\n'));

if (DRY) { console.log('[push] --dry-run：到此为止，未 push。'); process.exit(0); }

// ── ② push（token 走直连·永不打印 token）─────────────────────────
async function confirm() {
  if (YES) return true;
  const rl = createInterface({ input: stdin, output: stdout });
  const a = (await rl.question(`[push] push 这 ${ahead} 笔到 origin/main？会触发线上部署。[y/N] `)).trim().toLowerCase();
  rl.close();
  return a === 'y' || a === 'yes';
}

if (!(await confirm())) { console.log('[push] 取消。'); process.exit(0); }

const tokenFile = join(ROOT, '.deploy-token');
let push;
if (existsSync(tokenFile)) {
  const token = readFileSync(tokenFile, 'utf8').trim();
  const url = `https://x-access-token:${token}@${REPO_URL}`;
  console.log(`[push] push via .deploy-token → https://x-access-token:***@${REPO_URL}`);
  push = git([...NOPROXY, 'push', url, 'HEAD:main'], { stdio: 'inherit' });
} else {
  console.log('[push] 无 .deploy-token → 退回 `git push origin HEAD:main`（走你配置的凭证/代理）');
  push = git(['push', 'origin', 'HEAD:main'], { stdio: 'inherit' });
}
if (push.status !== 0) { console.error('[push] ✗ push 失败（见上）。'); process.exit(push.status ?? 1); }

// ── ③ fetch 刷 tracking ref（quirk #103）─────────────────────────
git([...NOPROXY, 'fetch', 'origin', 'main'], { stdio: 'ignore' });
const left = gitOut(['rev-list', '--count', 'origin/main..HEAD']);
console.log(`[push] ✓ 完成。origin/main..HEAD = ${left}（应为 0）。线上：https://shenhuang.github.io/blue/ （Actions 部署完后看页脚 build 戳）`);
