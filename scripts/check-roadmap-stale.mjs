#!/usr/bin/env node
// roadmap 漂移自检 —— 把「roadmap 顶部那条手写『当前状态』banner」和 git 真相对账。
//
// 起因（见效率复盘 #3）：roadmap（docs/spec/cave_roadmap.md）顶部的「当前状态（DATE）」banner 是
// 人写的、随 session churn 漂移；多次出现「banner 说全未落 main，实则 T1/E1–E4/T3a/T3b/T4 早已 land」，
// 害得新 session 照抄 banner 规划、再从 git 当场重新发现真相（白跑半程）。这条检查把「哪些车道其实
// 已推进」交给 git：banner 日期之后、车道文件在 main 上有提交 → 那条任务很可能已动过，落地前先核对其
// ⬜/✓ 状态，别照抄 banner。
//
// 与 handoff 同哲学（#96「定位从 git ground truth 再生·别手抄」）：纯只读 · git 一律 --no-optional-locks
// （守 [[sandbox-git-commit]]）· 退出码恒 0（这是 advisory 查询/定位，不是会红的门——任务间漂移是常态，
// 不该拦提交；同 deadstock advisory #166 的取舍）。
//
// 信号选择「车道文件在 banner 日期后于 main 有提交」＝健全性优先于最小性（同 affected-tests）：宁可多
// 报一条「这块动过、去核对」，绝不漏报一条已落地却仍标 ⬜ 的任务。无关提交触发的误报，代价只是多瞄一眼。
//
// 用法：
//   node scripts/check-roadmap-stale.mjs                         # 默认 docs/spec/cave_roadmap.md
//   node scripts/check-roadmap-stale.mjs docs/spec/<其它>.md     # 指定 roadmap
//   （也被 scripts/handoff.mjs import·起手定位时顺带打一行）

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = resolve(__dirname, '..');
const DEFAULT_ROADMAP = 'docs/spec/cave_roadmap.md';

// 解析 roadmap：① 顶部「当前状态（YYYY-MM-DD …）」banner 日期；② 每条 `psm.mjs start <name> --lane "<files>"`
// 车道（name + 逗号分隔的仓库相对文件）。两者都是机械可解析的稳定锚点；解析不到就优雅跳过（degrade）。
export function parseRoadmap(text) {
  const dm = text.match(/当前状态[（(]\s*(\d{4}-\d{2}-\d{2})/);
  const date = dm ? dm[1] : null;
  const lanes = [];
  const seen = new Set();
  const re = /psm\.mjs\s+start\s+(\S+)\s+--lane\s+"([^"]+)"/g;
  let m;
  while ((m = re.exec(text))) {
    const name = m[1];
    if (seen.has(name)) continue;
    seen.add(name);
    const files = m[2].split(',').map((s) => s.trim()).filter(Boolean);
    if (files.length) lanes.push({ name, files });
  }
  return { date, lanes };
}

// 返回 { ok, reason?, date, total, moved:[{name, files, count, latest}] }
export function roadmapDrift(root = DEFAULT_ROOT, roadmapRel = DEFAULT_ROADMAP, mainBranch = 'main') {
  let text;
  try {
    text = readFileSync(resolve(root, roadmapRel), 'utf-8');
  } catch {
    return { ok: false, reason: `读不到 ${roadmapRel}` };
  }
  const { date, lanes } = parseRoadmap(text);
  if (!date || !lanes.length) {
    return { ok: false, reason: `解析不到 banner 日期或车道（date=${date ?? '?'}·lanes=${lanes.length}）`, date, lanes };
  }
  const git = (args) => {
    try {
      return execFileSync('git', ['--no-optional-locks', ...args], { cwd: root, encoding: 'utf-8' }).trim();
    } catch {
      return '';
    }
  };
  const moved = [];
  for (const lane of lanes) {
    // banner 日期当天 00:00 起、main 上、动过这些文件的非 merge 提交（车道文件即任务的「写边界」）。
    const out = git(['log', mainBranch, `--since=${date} 00:00:00`, '--no-merges', '--format=%h %s', '--', ...lane.files]);
    if (out) {
      const commits = out.split('\n').filter(Boolean);
      moved.push({ name: lane.name, files: lane.files, count: commits.length, latest: commits[0] });
    }
  }
  return { ok: true, date, total: lanes.length, moved };
}

// ── CLI ──（同 affected-tests.mjs：isMain 时才跑·被 import 时静默）
const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const roadmapRel = process.argv[2] || DEFAULT_ROADMAP;
  const r = roadmapDrift(DEFAULT_ROOT, roadmapRel);
  if (!r.ok) {
    console.error(`# roadmap 漂移自检跳过：${r.reason}`);
    process.exit(0);
  }
  if (!r.moved.length) {
    console.log(`roadmap「${roadmapRel}」当前状态 banner（${r.date}）之后，${r.total} 条车道文件在 main 上均无新提交——banner 可信。`);
    process.exit(0);
  }
  console.log(
    `⚠ roadmap「${roadmapRel}」当前状态 banner（${r.date}）可能已 stale——以下车道文件在该日期后于 main 有提交，\n` +
      `  这些任务很可能已推进/落地：落地前先核对其 ⬜/✓ 状态，别照抄 banner（定位走 git·#96/#3）。`,
  );
  for (const mv of r.moved) {
    console.log(`  · ${mv.name}  (${mv.count} commit)  [${mv.files.join(', ')}]`);
    console.log(`      最新：${mv.latest}`);
  }
  process.exit(0);
}
