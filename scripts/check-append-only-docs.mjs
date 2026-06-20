#!/usr/bin/env node
// Append-only 文档门（机制化 quirk #130·2026-06-20 夜间）。
//
// 背景：`docs/archive/CHANGELOG.md` / `docs/QUIRKS.md` 是**编号只增**的 append-only 文档。
// 约定（quirk #130）：它们**只在 main 整合时写、别在 feature / auto/weekend 分支碰**——否则
// 并发写手各自「续最新编号 +1」会撞号（2026-06-20：周末 POI 引擎在 auto/weekend 写了 #143、
// 与 main 自己的 #143 撞号，夜间整合时被迫 renumber→#146·见 docs/archive/nightly/REPORT-2026-06-20.md）。
// 此前这条约定只是散文（CLAUDE.md / quirk #130），随 session churn 会被忘。这道门把它做成
// 「会在 npm run regress 里失败的检查」（CLAUDE.md 顶部原则·与 check-branch / check-boundaries 同类）。
//
// 规则（branch × 改动）：
//   branch == main                          → 放行（main 是整合分支·append-only 文档就该在这写）
//   branch != main 且 未改 CHANGELOG/QUIRKS  → 放行（feature/auto 分支只动内容·常态）
//   branch != main 且 改了 CHANGELOG/QUIRKS  → 红（Hazard：会与 main 并发编号撞号）
//   非 git / 无 main / 取不到 merge-base      → 跳过（不破坏非常规环境·同 check-branch）
//
// 「改了」= 自 merge-base(main, HEAD) 起的 committed 改动 ∪ 工作树未提交 ∪ staged 三处任一。
//
// 怎么办（红了）：把 CHANGELOG/QUIRKS 的内容**留给夜间 verify/publish 在 main 整合时写**
//   （摘要放进 commit message·夜间据此续编号落在 main）。feature/auto 分支只 commit 内容文件。
//
// 跑法： node scripts/check-append-only-docs.mjs    或在 npm run regress 里作为 check-append-only-docs 任务。

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const TRUNK = 'main';
const GUARDED = ['docs/archive/CHANGELOG.md', 'docs/QUIRKS.md'];

/**
 * 纯决策函数（无 IO·便于单测）。
 * @param {string} branch        当前分支（detached → 'HEAD'）
 * @param {string[]} changedDocs GUARDED 中实际被改动的子集
 * @returns {{ok:boolean, code:string, hits:string[]}}
 */
export function decide(branch, changedDocs) {
  if (branch === TRUNK) return { ok: true, code: 'pass-trunk', hits: [] };
  const hits = changedDocs.filter((f) => GUARDED.includes(f));
  if (hits.length === 0) return { ok: true, code: 'pass-clean', hits: [] };
  return { ok: false, code: 'fail-append-on-branch', hits };
}

function git(root, args) {
  return execFileSync('git', ['--no-optional-locks', ...args], {
    cwd: root,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

/** 当前分支；非 git 返回 null。detached 返回 'HEAD'。 */
function currentBranch(root) {
  try {
    return git(root, ['rev-parse', '--abbrev-ref', 'HEAD']);
  } catch {
    return null;
  }
}

/** GUARDED 文档相对 merge-base(main,HEAD) + 工作树 + staged 的并集改动；main 不存在/取不到 base → null（跳过）。 */
function changedGuardedDocs(root) {
  let base;
  try {
    base = git(root, ['merge-base', TRUNK, 'HEAD']);
  } catch {
    return null; // 无 main 分支 / 无共同祖先 → 跳过门
  }
  const set = new Set();
  const collect = (args) => {
    try {
      for (const f of git(root, args).split('\n')) if (f) set.add(f);
    } catch {
      /* ignore single diff failure */
    }
  };
  collect(['diff', '--name-only', `${base}..HEAD`, '--', ...GUARDED]); // committed since divergence
  collect(['diff', '--name-only', '--', ...GUARDED]); // unstaged working tree
  collect(['diff', '--name-only', '--cached', '--', ...GUARDED]); // staged
  return [...set];
}

// ── CLI ──（被 import 时不执行）
const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const branch = currentBranch(ROOT);
  if (branch === null) {
    console.log('✓ 非 git 仓库或读不到分支·跳过 append-only 文档门');
    process.exit(0);
  }
  if (branch === TRUNK) {
    console.log(`✓ append-only 文档门：在 ${TRUNK}·CHANGELOG/QUIRKS 允许在此写（整合分支）`);
    process.exit(0);
  }
  const changed = changedGuardedDocs(ROOT);
  if (changed === null) {
    console.log(`✓ append-only 文档门：取不到 merge-base(${TRUNK}, HEAD)·跳过（非常规环境）`);
    process.exit(0);
  }
  const r = decide(branch, changed);
  if (r.ok) {
    console.log(`✓ append-only 文档门：分支「${branch}」未改动 CHANGELOG/QUIRKS·OK`);
    process.exit(0);
  }
  console.error(`✘ append-only 文档门（${r.code}）：分支「${branch}」改动了 append-only 文档：`);
  for (const f of r.hits) console.error(`    · ${f}`);
  console.error(
    '\n  CHANGELOG.md / QUIRKS.md 是编号只增的 append-only 文档（quirk #130）——\n' +
      `  只在 ${TRUNK} 整合时写、别在 feature / auto/weekend 分支碰，否则与 ${TRUNK} 并发续号会撞号。\n` +
      '  怎么办：把摘要放进 commit message，让夜间 verify/publish 在 main 整合时据此续编号落条目；\n' +
      '  本分支只 commit 内容文件（事件 / scenarios / chart_pois 等）。',
  );
  process.exit(1);
}
