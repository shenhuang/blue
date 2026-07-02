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
// 2026-07-02 泛化（文档修复批）：同一哲学扩到 docs/spec/*.md 的「状态 banner」——SPEC 档头
// 常见「状态：…（YYYY-MM-DD…）」型手写状态行，同样随 churn 漂移（quirk #208 修复批实例：
// 主线柱迁移提案落地半月后 banner 仍写「提案·待作者拍」）。能解析出带日期状态行的 spec，
// banner 日期之后该文件在 main 有非 move 提交（--diff-filter=M·纯改名/迁移不算）→ advisory
// 「banner 可能过期」；解析不出任何状态头 → advisory「无状态头」。**都只是 advisory·退出码不变**。
//
// 用法：
//   node scripts/check-roadmap-stale.mjs                         # 默认 docs/spec/cave_roadmap.md + spec banner 扫描
//   node scripts/check-roadmap-stale.mjs docs/spec/<其它>.md     # 指定 roadmap
//   （也被 scripts/handoff.mjs import·起手定位时顺带打一行）

import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
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

// ── spec 状态 banner 扫描（2026-07-02 泛化·见档头）──

// 解析 spec 档头的「状态 banner 日期」：只看头 HEAD_LINES 行，找**同一行**里既有「状态」
// 又有 YYYY-MM-DD 的（「状态：已实装（2026-07-02…）」「**状态（2026-07-02）**：…」都中），
// 取该行第一个日期。解析不到 → null（degrade 成「无状态头」advisory，同 parseRoadmap 哲学）。
const HEAD_LINES = 15;
export function parseSpecBanner(text) {
  for (const line of text.split('\n').slice(0, HEAD_LINES)) {
    if (!/状态/.test(line)) continue;
    const dm = line.match(/(\d{4}-\d{2}-\d{2})/);
    if (dm) return dm[1];
  }
  return null;
}

// 返回 { stale:[{file,date,count,latest}], noBanner:[file] }。advisory 专用·不产生退出码。
export function specBannerDrift(root = DEFAULT_ROOT, specDir = 'docs/spec', mainBranch = 'main') {
  let names;
  try {
    names = readdirSync(resolve(root, specDir)).filter((n) => n.endsWith('.md')).sort();
  } catch {
    return { stale: [], noBanner: [] };
  }
  const git = (args) => {
    try {
      return execFileSync('git', ['--no-optional-locks', ...args], { cwd: root, encoding: 'utf-8' }).trim();
    } catch {
      return '';
    }
  };
  const stale = [];
  const noBanner = [];
  for (const name of names) {
    const rel = `${specDir}/${name}`;
    let text;
    try {
      text = readFileSync(resolve(root, rel), 'utf-8');
    } catch {
      continue;
    }
    const date = parseSpecBanner(text);
    if (!date) {
      noBanner.push(rel);
      continue;
    }
    // banner 日期**次日**起（--since 当天 23:59:59 之后）、main 上、非 merge、内容真改过（M·
    // 纯 move/rename 在当前路径上显示为 A / 不显示，天然排除）的提交——当天提交多半就是落 banner
    // 那笔，算进去全是自指噪音。
    const out = git(['log', mainBranch, `--since=${date} 23:59:59`, '--no-merges', '--diff-filter=M', '--format=%h %s', '--', rel]);
    if (out) {
      const commits = out.split('\n').filter(Boolean);
      stale.push({ file: rel, date, count: commits.length, latest: commits[0] });
    }
  }
  return { stale, noBanner };
}

// ── CLI ──（同 affected-tests.mjs：isMain 时才跑·被 import 时静默）
const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const roadmapRel = process.argv[2] || DEFAULT_ROADMAP;
  const r = roadmapDrift(DEFAULT_ROOT, roadmapRel);
  if (!r.ok) {
    console.error(`# roadmap 漂移自检跳过：${r.reason}`);
  } else if (!r.moved.length) {
    console.log(`roadmap「${roadmapRel}」当前状态 banner（${r.date}）之后，${r.total} 条车道文件在 main 上均无新提交——banner 可信。`);
  } else {
    console.log(
      `⚠ roadmap「${roadmapRel}」当前状态 banner（${r.date}）可能已 stale——以下车道文件在该日期后于 main 有提交，\n` +
        `  这些任务很可能已推进/落地：落地前先核对其 ⬜/✓ 状态，别照抄 banner（定位走 git·#96/#3）。`,
    );
    for (const mv of r.moved) {
      console.log(`  · ${mv.name}  (${mv.count} commit)  [${mv.files.join(', ')}]`);
      console.log(`      最新：${mv.latest}`);
    }
  }

  // —— spec 状态 banner 扫描（advisory·不红·见档头 2026-07-02 泛化）——
  const sd = specBannerDrift(DEFAULT_ROOT);
  if (sd.stale.length || sd.noBanner.length) {
    console.log('\n# docs/spec 状态 banner 自检（advisory·不阻断）：');
    for (const s of sd.stale) {
      console.log(`  ⚠ ${s.file} 的状态 banner（${s.date}）可能过期——该日期后在 main 有 ${s.count} 笔内容提交（最新：${s.latest}）；以代码/git 为准，顺手翻面 banner。`);
    }
    for (const f of sd.noBanner) {
      console.log(`  · ${f} 无状态头——读它前先 git log 该文件核实时效；顺手补一行「状态：…（YYYY-MM-DD）」banner 更好。`);
    }
  }
  process.exit(0);
}
