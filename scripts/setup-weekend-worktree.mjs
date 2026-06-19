#!/usr/bin/env node
// 方案 B 一次性搭建：给周末引擎一棵独立 worktree（挂 auto/weekend·物理隔离工作树）。
// 跑通后，周末内容 / POI 引擎在 .worktrees/weekend 里跑——与交互 session 的 main 树
// 连「同一份工作目录文件 + 同一个 HEAD」都不共享 → 彻底消除共享 HEAD 被翻（2026-06-19）
// 和 index 互踩（本 session 实测 chart.ts/items.ts 被并发改 42 行）这两类争用。见 quirk #104 / 并发提案 §3 方案 B。
//
// **必须在你的 Mac 本机跑，不能在沙箱跑**：`git worktree add` 会把工作树的绝对路径写进
// `.git/worktrees/weekend/gitdir`；沙箱里那是 /sessions/... 路径，到 Mac 上就失效。本脚本
// 检测到沙箱路径会硬停。
//
//   npm run weekend:worktree        （在 ~/Desktop/Blue 本机跑·幂等）
//
// 之后按提示给 worktree 接 node_modules（symlink 复用 main 树的 macOS-native·或独立 npm install）。

import { execFileSync } from 'node:child_process';
import { existsSync, writeFileSync, symlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WT_REL = '.worktrees/weekend';
const WT = join(ROOT, WT_REL);
const BRANCH = 'auto/weekend';

// 沙箱护栏：worktree 的 gitdir 会记绝对路径，沙箱路径到 Mac 失效 → 硬停。
if (ROOT.startsWith('/sessions/') || ROOT.includes('/mnt/')) {
  console.error(
    `✘ 检测到沙箱路径（${ROOT}）。\n` +
      `  git worktree add 会把绝对路径写进 .git/worktrees/，沙箱路径到你 Mac 上会失效。\n` +
      `  请在 Mac 本机的 ~/Desktop/Blue 里跑 \`npm run weekend:worktree\`。`,
  );
  process.exit(1);
}

function git(args, opts = {}) {
  return execFileSync('git', ['--no-optional-locks', ...args], {
    cwd: ROOT,
    encoding: 'utf-8',
    ...opts,
  }).trim();
}
function gitOk(args) {
  // 只问退出码、不读输出——别走 git()（它对 stdout 做 .trim()，stdio:'ignore' 时返回 null→.trim() 抛错→误判失败）。
  try {
    execFileSync('git', ['--no-optional-locks', ...args], { cwd: ROOT, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

// 1. 确保 auto/weekend 分支存在
if (!gitOk(['rev-parse', '--verify', '--quiet', BRANCH])) {
  git(['branch', BRANCH]);
  console.log(`✓ 已建分支 ${BRANCH}（从当前 HEAD）。`);
} else {
  console.log(`✓ 分支 ${BRANCH} 已存在。`);
}

// 2. 挂 worktree（幂等）
if (existsSync(WT)) {
  console.log(`✓ worktree ${WT_REL} 已存在·跳过 add。`);
} else {
  git(['worktree', 'add', WT_REL, BRANCH]);
  console.log(`✓ 已挂 worktree ${WT_REL} → ${BRANCH}。`);
}

// 指针改相对路径——**关键**：Cowork 每个 session 在沙箱里把 ~/Desktop/Blue 挂到不同的绝对路径
// （/sessions/<session-id>/mnt/Blue），git worktree add 默认写**绝对**路径 → 在别的 session / 沙箱里
// 解析不到、worktree 里跑 git 直接 fatal。只有**相对**指针在 Mac + 任意沙箱都通。沙箱 git 2.34 无
// `--relative-paths`（2.48 才有）→ 手写两个指针文件最稳·幂等。见 quirk #138 / concurrency_method_b_rollout.md。
// 注意：旧 git（含沙箱 2.34）对**反向** gitdir 的相对路径不认 → `git worktree prune` 会误判可删；
// 别在沙箱/旧 git 里跑 `git worktree prune`（周末流程 gc.auto 0·不自动 prune·安全）。
try {
  writeFileSync(join(WT, '.git'), 'gitdir: ../../.git/worktrees/weekend\n');
  writeFileSync(join(ROOT, '.git', 'worktrees', 'weekend', 'gitdir'), '../../../.worktrees/weekend/.git\n');
  console.log('✓ worktree 指针已改相对路径（Mac + 任意 Cowork 沙箱通用）。');
} catch (e) {
  console.warn(
    `⚠ 改相对指针失败：${String(e.message || e).split('\n')[0]}\n` +
      `  worktree 仍可在 Mac 本机用·但 Cowork 沙箱 session 里可能跑不了 git（绝对路径解析不到）。`,
  );
}

// 3. node_modules：symlink 复用 main 树的（macOS-native·同主机安全·省一次 install）
const wtNodeModules = join(WT, 'node_modules');
if (!existsSync(wtNodeModules)) {
  try {
    symlinkSync(join(ROOT, 'node_modules'), wtNodeModules, 'dir');
    console.log('✓ 已 symlink worktree/node_modules → main 树（复用 macOS-native·省装）。');
  } catch (e) {
    console.warn(
      `⚠ symlink node_modules 失败：${String(e.message || e).split('\n')[0]}\n` +
        `  改为独立装：(cd ${WT_REL} && npm install)。`,
    );
  }
} else {
  console.log('✓ worktree/node_modules 已就位。');
}

// 4. 写 weekend 写手标记（check-branch 在此树放行 auto/weekend·拦其它分支）
writeFileSync(join(WT, '.blue-writer'), 'weekend\n');
console.log('✓ 已写 .worktrees/weekend/.blue-writer=weekend。');

console.log(
  `\n方案 B 工作树就绪。下一步：\n` +
    `  · 周末引擎/手动周末 session 在 \`${WT_REL}\` 里干活（已永久钉在 ${BRANCH}）。\n` +
    `  · 沙箱里跑 regress：node_modules 是 macOS-native，build/esbuild 仍套用「Linux esbuild 装 /tmp + ESBUILD_BINARY_PATH/NODE_PATH」那招（见自动记忆 blue-regress-sandbox）；typecheck/纯 node check 直接能跑。\n` +
    `  · 夜间合并＝从 main 树 \`git branch -f main ${BRANCH}\`（移 ref 不动树·quirk #104b）再 push。\n` +
    `  · 拆除（少用）：\`git worktree remove ${WT_REL}\`（Mac 本机·沙箱不能 unlink）。\n` +
    `  · 自动化 3 任务的接入改法见 docs/infra/concurrency_method_b_rollout.md。`,
);
