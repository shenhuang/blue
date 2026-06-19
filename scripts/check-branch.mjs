#!/usr/bin/env node
// 写手↔分支 一致性门（并发隔离方案 A 的机制化·quirk #104）。
//
// 背景：三写手（交互 / 周末内容 / 夜间 verify）共用一棵裸工作树时，分支只隔离
// 「已提交历史」，不隔离活的 HEAD —— 全仓只有一个 HEAD，被并发翻动就会让提交落错分支
// （2026-06-19：周末 POI 引擎本要落 auto/weekend，HEAD 被交互 session 并发翻回 main，
//  内容落进了 main，靠 ref 手术救回·见自动记忆 sandbox-git-commit）。方案 A 此前只有
// `npm run handoff` 把分支状态「报出来」（read-only），没有一道「会红的门」。这个脚本补上：
// 把「谁该在哪条分支提交」从散文约定变成 `npm run regress` 里会失败的检查。
//
// 写手身份来源（按优先级）：环境变量 BLUE_WRITER  >  仓库根 .blue-writer 文件（gitignore）  >  默认交互。
//   - 交互 session：默认即可（不需声明）。要回 main：`npm run main:resume`（清标记）。
//   - 周末内容 / POI session：起手 `npm run weekend:start`（落 auto/weekend + 写标记 weekend）。
//   - 夜间 verify/publish：跨分支操作，设 BLUE_WRITER=nightly 跳过本门。
//
// 规则（writer × branch）：
//   nightly                          → 放行（跨分支 verify/publish）
//   branch == auto/weekend  且 weekend → 放行（周末写手在自己车道）
//   branch == auto/weekend  且 非weekend→ 红（Hazard 1：未声明的写手在周末车道提交＝会污染 auto/weekend）
//   branch != auto/weekend  且 weekend → 红（Hazard 2：周末写手漂出车道＝06-19 那种 HEAD 被翻、内容要落错 main）
//   branch != auto/weekend  且 非weekend→ 放行（交互在 main / feat/* worktree＝常态）
//
// 注：共享工作树上「标记文件」可能因上一个 session 没清而陈旧（lingering）。真正消除
// 共享 HEAD/标记串味的是方案 B（周末引擎独立 worktree·物理隔离·见 concurrency 提案 §3）。
// 本门是方案 A 之上的「会红的backstop」；worktree 隔离后每棵树各自一份 .blue-writer，天然不串。
//
// 在 scripts/regress.mjs 注册为 check-branch 任务（纯 node·与 check-boundaries 同类）。
// 跑法：node scripts/check-branch.mjs        或  npm run check:branch

import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const WEEKEND_BRANCH = 'auto/weekend';

/**
 * 纯决策函数（无 IO·便于单测全 6 种 writer×branch 组合）。
 * @param {string} branch  当前分支名（detached 时调用方传 'HEAD'）
 * @param {string} writer  规范化前的写手标识（大小写/空白不敏感）
 * @returns {{ok:boolean, code:string, message:string}}
 */
export function decide(branch, writer) {
  const w = String(writer || '').trim().toLowerCase();
  const onWeekendLane = branch === WEEKEND_BRANCH;

  if (w === 'nightly') {
    return { ok: true, code: 'pass-nightly', message: `BLUE_WRITER=nightly·跨分支 verify/publish·跳过分支门（当前 ${branch}）` };
  }

  if (onWeekendLane) {
    if (w === 'weekend') {
      return { ok: true, code: 'pass-weekend', message: `周末写手在 ${WEEKEND_BRANCH}·车道正确` };
    }
    return {
      ok: false,
      code: 'fail-hazard1',
      message:
        `当前在 ${WEEKEND_BRANCH}，但未声明 weekend 写手身份。\n` +
        `  · 若你是周末内容 / POI session：先跑 \`npm run weekend:start\`（声明 weekend·见 quirk #104）。\n` +
        `  · 若你是交互 session：树停在 ${WEEKEND_BRANCH} 是周末引擎停的位置（quirk #104a），别在此提交——会污染周末车道。\n` +
        `    沙箱切不回 main（unlink 约束·quirk #104b）；让作者本机 \`git checkout main\`，或在 main 树/独立 worktree 工作。`,
    };
  }

  // 非周末车道（main / feat/* / 其它 / detached）
  if (w === 'weekend') {
    return {
      ok: false,
      code: 'fail-hazard2',
      message:
        `声明了 weekend 写手，但当前在 \`${branch}\`（应在 ${WEEKEND_BRANCH}）。\n` +
        `  周末内容只落 ${WEEKEND_BRANCH}（方案 A·quirk #104）。这正是 2026-06-19 的事故形态：\n` +
        `  HEAD 被并发翻动 → 周末提交要落错 ${branch}。先 \`git checkout ${WEEKEND_BRANCH}\` 再提交；\n` +
        `  若 HEAD 反复被翻见自动记忆 sandbox-git-commit 的「提交前一刻再验分支 + ref 手术」护栏。`,
    };
  }

  return { ok: true, code: 'pass-interactive', message: `交互写手在 \`${branch}\`·常态（非周末车道）` };
}

/** 读当前分支；非 git 仓库返回 null（门跳过·不破坏非 git 环境）。 */
function currentBranch(root) {
  try {
    const out = execFileSync('git', ['--no-optional-locks', 'rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: root,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.trim(); // detached 时为 'HEAD'
  } catch {
    return null;
  }
}

/** 解析写手身份：BLUE_WRITER 环境变量 > .blue-writer 文件 > ''（默认交互）。 */
function resolveWriter(root) {
  if (process.env.BLUE_WRITER && process.env.BLUE_WRITER.trim()) {
    return { writer: process.env.BLUE_WRITER.trim(), src: 'BLUE_WRITER 环境变量' };
  }
  const markerPath = join(root, '.blue-writer');
  if (existsSync(markerPath)) {
    try {
      const v = readFileSync(markerPath, 'utf-8').trim();
      if (v) return { writer: v, src: '.blue-writer 文件' };
    } catch {
      /* ignore */
    }
  }
  return { writer: '', src: '默认（交互·无标记）' };
}

// ── CLI ──（被 import 时不执行；直接跑时执行）
const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const branch = currentBranch(ROOT);
  if (branch === null) {
    console.log('✓ 非 git 仓库或读不到分支·跳过写手↔分支门');
    process.exit(0);
  }
  const { writer, src } = resolveWriter(ROOT);
  const r = decide(branch, writer);
  const who = writer || '交互';
  if (r.ok) {
    console.log(`✓ 写手↔分支一致：写手「${who}」（${src}）· 分支「${branch}」· ${r.message}`);
    process.exit(0);
  }
  console.error(`✘ 写手↔分支冲突门（${r.code}）：写手「${who}」（${src}）· 分支「${branch}」\n`);
  console.error('  ' + r.message.split('\n').join('\n  '));
  console.error(
    `\n这道门把并发隔离方案 A 的「谁在哪条分支提交」从散文做成会红的检查（quirk #104）。` +
      `\n误报？声明写手：交互＝\`npm run main:resume\`／周末＝\`npm run weekend:start\`／夜间＝\`BLUE_WRITER=nightly\`。\n`,
  );
  process.exit(1);
}
