#!/usr/bin/env node
// 交接定位再生器 —— 从 ground truth（git + 归档报告 + STATUS/CHANGELOG）打印「当前状态」。
//
// 取代交接 prompt 里手抄的「做了什么 / 当前进度」——那是最易随 session churn 漂移的一层
// （上一轮已亲眼见交接 prompt 写的 HEAD 落后于真实 HEAD）。起手只需 `npm run handoff`，
// 把「当前状态 / 定位」交给脚本，人写的交接（docs/HANDOFF.md·旧名 NEXT_SESSION_PROMPT.md）只保留方向 / 下一步；本脚本末尾内联它。
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
import { roadmapDrift, specBannerDrift } from './check-roadmap-stale.mjs';
import { isSandbox } from './lib/env.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const N = parseInt(process.argv[2], 10) || 8;
const CHANGELOG_TITLES_N = 12; // handoff 末尾只列最近这么多条 CHANGELOG「标题」（正文留盘·见 recentChangelogTitles·省上下文）

// 沙箱路径判定收口 lib/env.mjs（单点真相·取代此前散在 psm/handoff/setup-weekend 的复制粘贴·#1/#165）。
const inSandbox = isSandbox(ROOT);

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
// CHANGELOG 末尾 N 条只打「编号 + 加粗标题」一行——正文（巨型单行段落）留盘上、别每 session 灌全文。
// 旧版 tailLines(…,30) 把最近十几条全文（~53KB·占 handoff 输出 95%）塞进每次定位＝brain rot 主源。
// 要读某条全文：grep 编号 docs/archive/CHANGELOG.md。条数见 CHANGELOG_TITLES_N。
function recentChangelogTitles(text, n) {
  const lines = text.split('\n');
  const starts = [];
  for (let i = 0; i < lines.length; i++) {
    if (/^\d+\.\s/.test(lines[i])) starts.push(i);
  }
  const pick = starts.slice(Math.max(0, starts.length - n));
  const out = pick.map((i) => {
    const line = lines[i];
    const num = (line.match(/^(\d+)\./) || [])[1] || '?';
    const bold = line.match(/\*\*(.+?)\*\*/);
    let title = bold ? bold[1] : line.replace(/^\d+\.\s*/, '');
    if (title.length > 150) title = title.slice(0, 149) + '…';
    return `${num}. ${title}`;
  });
  return out.length ? out.join('\n') : '(CHANGELOG 无可解析条目)';
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

// —— 0. 运行环境边界（一次说清·省得每 session 重问「这步要不要我自己敲」）——
if (inSandbox) {
  console.log(
    '\n运行环境：沙箱（mount 不能 unlink）——push / `psm gc` / `psm land` 的 rebase+ff 都留 Mac 本机或夜间；\n' +
      '  沙箱内 `npm run regress` 自动跑 esbuild-free 子集（typecheck+静态门），tsx 行为测留 Mac/nightly（regress.mjs·#165）。',
  );
} else {
  console.log('\n运行环境：Mac 本机（可 push / gc / ff·regress 跑全量行为测）。');
}

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

// —— 1d. roadmap 漂移自检（当前状态 banner vs git·别照抄 stale banner·见 #3）——
try {
  const rd = roadmapDrift(ROOT);
  if (rd.ok && rd.moved.length) {
    console.log(hr('roadmap 漂移自检（banner vs git）'));
    console.log(
      `cave_roadmap 当前状态 banner（${rd.date}）之后，以下车道文件在 main 有新提交 → 这些任务可能已推进/落地，\n` +
        '核对其 ⬜/✓ 再规划，别照抄 banner（全量 `npm run roadmap:check`）：',
    );
    for (const mv of rd.moved) console.log(`  · ${mv.name}  (${mv.count})  最新：${mv.latest}`);
  }
} catch {
  /* 漂移自检失败绝不影响定位 */
}

// —— 1e. docs/spec 状态 banner advisory（check-roadmap-stale 泛化·不红·只摘要别刷屏）——
try {
  const sd = specBannerDrift(ROOT);
  if (sd.stale.length || sd.noBanner.length) {
    const SHOW = 3; // 只列 banner 最陈旧的前几条·全量清单走 node scripts/check-roadmap-stale.mjs
    console.log(
      `\ndocs/spec 状态 banner advisory：${sd.stale.length} 份可能过期` +
        (sd.noBanner.length ? ` + ${sd.noBanner.length} 份无状态头` : '') +
        '（读 SPEC 前以代码/git 为准·全量 `node scripts/check-roadmap-stale.mjs`）：',
    );
    const oldest = [...sd.stale].sort((a, b) => a.date.localeCompare(b.date));
    for (const s of oldest.slice(0, SHOW)) {
      console.log(`  ⚠ ${s.file}（banner ${s.date}·其后 ${s.count} 笔内容提交）`);
    }
    if (oldest.length > SHOW) console.log(`  …另 ${oldest.length - SHOW} 份见全量输出。`);
  }
} catch {
  /* advisory 失败绝不影响定位 */
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

// —— 4. CHANGELOG.md 末尾标题（最近条目·只打加粗标题·正文留盘·省上下文）——
console.log(hr(`CHANGELOG.md 末尾 ${CHANGELOG_TITLES_N} 条标题（正文见 docs/archive/CHANGELOG.md）`));
console.log(
  recentChangelogTitles(readOr('docs/archive/CHANGELOG.md', '(无 docs/archive/CHANGELOG.md)'), CHANGELOG_TITLES_N),
);

// —— 5. 人写方向 / 下一步（docs/HANDOFF.md·gitignored·每 session 重写·quirk #96·末尾内联省得再开一个文件）——
console.log(hr('HANDOFF.md 方向 / 下一步（人写·本地·不提交）'));
{
  const handoffPath = resolve(ROOT, 'docs/HANDOFF.md');
  if (existsSync(handoffPath)) {
    const hl = readFileSync(handoffPath, 'utf-8').trimEnd().split('\n');
    const CAP = 120;
    console.log(hl.slice(0, CAP).join('\n'));
    if (hl.length > CAP) console.log(`\n…（截断·全文见 docs/HANDOFF.md·共 ${hl.length} 行）`);
  } else {
    console.log('(无 docs/HANDOFF.md —— 尚无人写方向·起手靠上方 git 定位即可)');
  }
}

console.log('\n— 定位完毕。');
