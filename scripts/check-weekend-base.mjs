#!/usr/bin/env node
// 周末引擎基线新鲜度门（并发隔离方案 A 的补门·与 check-branch 同族·quirk #104）。
//
// 背景：周末内容引擎在 auto/weekend 分支上生成内容，夜间任务 verify 绿后才把它 ff 收进 main。
// 交互 session 平日在 main 上推进（含 rename/retheme 类改动·如 #246 silas→Sela）——若周末引擎
// 起手时 auto/weekend 落后 main 一大截，它会**在旧 id / 旧命名上生成内容**，夜间合并时要么冲突
// 要么静默引用已改名的实体（比冲突更糟）。此前这只是散文提醒；本门把「周末写手起手先 rebase main」
// 焊成会红的检查。
//
// 规则（writer 判定沿用 check-branch：BLUE_WRITER 环境变量 > .blue-writer 文件 > 默认交互）：
//   writer == weekend 且 auto/weekend 落后 main N>0 commit → 红（先 rebase/ff main 再生成）。
//   writer == weekend 且不落后                            → 绿。
//   其他 writer（交互/nightly/未声明）/ 非 git / 无 auto/weekend 分支 → 绿色 no-op（本门只管周末起手）。
//
// 跑法：node scripts/check-weekend-base.mjs

import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const WEEKEND_BRANCH = 'auto/weekend';
const BASE_BRANCH = 'main';

/**
 * 纯决策函数（无 IO·便于单测）。
 * @param {string} writer  写手标识（大小写/空白不敏感·''＝默认交互）
 * @param {?number} behind auto/weekend 落后 main 的 commit 数；null＝算不出（非 git / 无该分支）
 * @returns {{ok:boolean, code:string, message:string}}
 */
export function decide(writer, behind) {
  const w = String(writer || '').trim().toLowerCase();
  if (w !== 'weekend') {
    return { ok: true, code: 'pass-not-weekend', message: `写手「${w || '交互'}」非周末引擎·本门 no-op` };
  }
  if (behind === null) {
    return { ok: true, code: 'pass-no-ref', message: `算不出 ${WEEKEND_BRANCH}..${BASE_BRANCH}（非 git / 分支缺失）·跳过` };
  }
  if (behind > 0) {
    return {
      ok: false,
      code: 'fail-stale-base',
      message:
        `周末引擎起手先 rebase ${BASE_BRANCH}（基线落后 ${behind} commit·含 rename 类改动·否则会在旧 id 上生成内容）。\n` +
        `  ${WEEKEND_BRANCH} 落后 ${BASE_BRANCH} ${behind} 个 commit——期间交互 session 可能改过实体 id/命名\n` +
        `  （如 #246 silas→Sela 这类 retheme）。先把 ${BASE_BRANCH} 收进来（ff/rebase）再开始生成，\n` +
        `  否则新内容会引用旧 id，夜间合并要么冲突、要么静默烂引用。`,
    };
  }
  return { ok: true, code: 'pass-fresh', message: `${WEEKEND_BRANCH} 已含 ${BASE_BRANCH} 全部 commit·基线新鲜` };
}

/** 解析写手身份（同 check-branch：BLUE_WRITER 环境变量 > .blue-writer 文件 > ''＝默认交互）。 */
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

/** auto/weekend 落后 main 的 commit 数；非 git / 分支缺失 → null（门跳过）。 */
function behindCount(root) {
  try {
    const out = execFileSync(
      'git',
      ['--no-optional-locks', 'rev-list', '--count', `${WEEKEND_BRANCH}..${BASE_BRANCH}`],
      { cwd: root, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim();
    const n = Number.parseInt(out, 10);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

// ── CLI ──（被 import 时不执行）
const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const { writer, src } = resolveWriter(ROOT);
  // 非 weekend 写手连 git 都不必碰——本门只管周末起手基线。
  const behind = String(writer).trim().toLowerCase() === 'weekend' ? behindCount(ROOT) : null;
  const r = decide(writer, behind);
  if (r.ok) {
    console.log(`✓ 周末基线门：写手「${writer || '交互'}」（${src}）· ${r.message}`);
    process.exit(0);
  }
  console.error(`✘ 周末基线门（${r.code}）：写手「${writer}」（${src}）\n`);
  console.error('  ' + r.message.split('\n').join('\n  '));
  process.exit(1);
}
