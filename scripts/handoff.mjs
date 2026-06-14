#!/usr/bin/env node
// 交接定位再生器 —— 从 ground truth（git + 归档报告 + STATUS/CHANGELOG）打印「当前状态」。
//
// 取代交接 prompt 里手抄的「做了什么 / 当前进度」——那是最易随 session churn 漂移的一层
// （上一轮已亲眼见交接 prompt 写的 HEAD 落后于真实 HEAD）。起手只需 `npm run handoff`，
// 把「当前状态 / 定位」交给脚本，人写的交接（NEXT_SESSION_PROMPT.md）只保留方向 / 下一步。
//
// 纯只读 · 不改任何东西：
//   - git 一律 --no-optional-locks（不产生 index.lock，守 [[sandbox-git-commit]] 约定）。
//   - 不写文件 / 不碰 index / 不碰 ref。
//
// 跑法： npm run handoff          或    node scripts/handoff.mjs [N]
//   N = git log 条数（默认 8）

import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const N = parseInt(process.argv[2], 10) || 8;

function hr(title) {
  return `\n${'═'.repeat(64)}\n  ${title}\n${'═'.repeat(64)}`;
}
function git(args) {
  try {
    return execFileSync('git', ['--no-optional-locks', ...args], {
      cwd: ROOT,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trimEnd();
  } catch (e) {
    return `(git ${args.join(' ')} 失败：${e.message})`;
  }
}
function readOr(rel, fallback) {
  try {
    return readFileSync(resolve(ROOT, rel), 'utf-8');
  } catch {
    return fallback;
  }
}
function headLines(text, n) {
  return text.split('\n').slice(0, n).join('\n');
}
function tailLines(text, n) {
  const lines = text.split('\n');
  return lines.slice(Math.max(0, lines.length - n)).join('\n');
}
// STATUS.md 顶部 blockquote：第一段连续 '>' 引用块（= 滚动的「最近 ~2 session + 当前状态」指针）。
function topBlockquote(text) {
  const out = [];
  let started = false;
  for (const l of text.split('\n')) {
    if (l.startsWith('>')) {
      out.push(l);
      started = true;
    } else if (started) break; // 引用块后第一条非引用行即终止
  }
  return out.length ? out.join('\n') : '(STATUS.md 无顶部 blockquote)';
}

console.log('深海回响 · 交接定位（从 git + 报告 + STATUS/CHANGELOG 再生·纯只读）');

// —— 1. git 定位 ——
console.log(hr(`git log（最近 ${N}）+ status`));
console.log(git(['log', '--oneline', '-' + N]));
console.log('');
console.log(git(['status', '-sb']));
console.log(
  '（注意：[ahead N] 可能是幻影——显式 URL push 不更新 tracking ref·quirk #103；' +
    '拿不准就 fetch origin main 或查 GitHub API 后再说）',
);

// —— 1b. 并发隔离（方案 A·quirk #104）：当前分支 + auto/weekend 待合并状态 ——
{
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
  console.log(`\n当前分支：${branch}`);
  const verify = git(['rev-parse', '--verify', '--quiet', 'auto/weekend']);
  const weekendExists = verify && !verify.startsWith('(git');
  if (weekendExists) {
    const pending = git(['rev-list', '--count', 'main..auto/weekend']);
    if (pending === '0') {
      console.log('auto/weekend：无未合并 commit（已并平）。');
    } else {
      console.log(
        `auto/weekend：领先 main ${pending} commit（周末引擎内容·待夜间 verify 绿后 ff 收进 main）。`,
      );
    }
  } else {
    console.log('auto/weekend：分支不存在（周末引擎首跑时自建）。');
  }
  if (branch === 'auto/weekend') {
    console.log(
      '（树停在 auto/weekend＝周末引擎停的位置——正常。交互要回 main：沙箱切不回去' +
        '〔分支新增文件删不掉·quirk #104〕，等夜间合并自动回、或作者本机 git checkout main。）',
    );
  }
}

// —— 1c. 并行工作树（git worktree·多 feature 并行·quirk #130）：>1 棵才报 ——
{
  const wt = git(['worktree', 'list']);
  const trees = wt.split('\n').filter((l) => l.trim() && !l.startsWith('('));
  if (trees.length > 1) {
    console.log('\n并行工作树（各自独立 node_modules/regress·quirk #130）：');
    console.log(wt);
    console.log(
      '（append-only 文档〔CHANGELOG/QUIRKS〕只在 main 整合时写·别在 feature 树里碰＝免 merge 冲突。）',
    );
  }
}

// —— 2. 最新 nightly REPORT 头部 ——
console.log(hr('最新 nightly REPORT 头部'));
const nightlyDir = resolve(ROOT, 'docs/archive/nightly');
if (existsSync(nightlyDir)) {
  const reports = readdirSync(nightlyDir)
    .filter((f) => /^REPORT-.*\.md$/.test(f))
    .sort();
  const latest = reports[reports.length - 1];
  if (latest) {
    console.log(`(docs/archive/nightly/${latest})\n`);
    console.log(headLines(readFileSync(join(nightlyDir, latest), 'utf-8'), 14));
  } else {
    console.log('(无 nightly REPORT)');
  }
} else {
  console.log('(docs/archive/nightly 不存在)');
}

// —— 3. STATUS.md 顶部 blockquote（当前状态 + 最近 session）——
console.log(hr('STATUS.md 顶部（当前状态 + 最近 session）'));
console.log(topBlockquote(readOr('docs/STATUS.md', '(无 docs/STATUS.md)')));

// —— 4. CHANGELOG.md 末尾几条（新条目追加在末尾）——
console.log(hr('CHANGELOG.md 末尾'));
console.log(tailLines(readOr('docs/archive/CHANGELOG.md', '(无 docs/archive/CHANGELOG.md)'), 30));

console.log('\n— 定位完毕。方向 / 下一步见 docs/NEXT_SESSION_PROMPT.md（人写·本地·不提交）。');
