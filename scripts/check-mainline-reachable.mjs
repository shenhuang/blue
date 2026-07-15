#!/usr/bin/env node
// 主线可达性门（经济「不 grind 化」D-2·M 组「check-mainline-reachable」·2026-06-27·见 docs/playtest-findings.md）——
// 把「主线链无环、无死结、起点→章尾可达」钉成 `npm run regress` 里会失败的检查。纯读 JSON·无 TS 依赖·进程隔离友好。
// 仿 scripts/check-dive-refs.mjs / check-economy-reachability.mjs 的纯 node 风格。
//
// 背景（2026-07-12 re-home）：主线 beat = chart_pois.json 里带 `story` 字段的静态 anchor（原由 depth_columns.json
// storyTier 派生·深度柱系统删除后落成静态锚点）。每个 anchor：id（=运行时 poiId）、owner（host 灯塔）、
// story:{eventId, beatFlag, chainTail?, revisit*?}。隶属灯塔（owner = home 或某前哨 result.id）建成才下得去。前哨
// 「可建门」改成「上一步进度 flag」解死锁（slope←reef…）。本门把这条链做静态可判：沿「灯塔解锁序」走一遍，确认
// 每个 beat 的 reach 门都能被**前面步骤**满足、整条链无环、起点（教学完成）能走到章尾（链尾 beat）。
//
// 检查的不变量（**纯结构·不查数值** → 兼容 defer-number-tuning）：
//   (a) 引用完整：每个 story anchor 的 eventId 必在某 events/*.json 在册；beatFlag 必形如 story.*（由 story.ts 登记·
//       与 playthrough-story「story.* ⊆ allStoryFlags()」互补·这里只查命名形）；该 anchor 的 story 潜点 id
//       必被某道具 story.marksPois 标记（reveal 产出源·导师日志「携带」四坐标·
//       2026-06-28 内容自洽回归：reveal 从裸 revealFlag 改回「文献坐标」机制·#117 续）——否则坐标永不揭示·主线 beat 进不去。
//   (b) host 可达：每个 story anchor 的 owner 灯塔 = home（恒在）或某前哨 result.id（可经建造点亮）。
//   (c) 前哨解锁链无环、可达：前哨可建门（requiresAnchor 本区锚点 / requiresFlag 上一步 flag）指向的前置 flag，
//       必能由**更早一环**产出（canon 锚点 flag 由四锚点事件产出·恒在教学后；前哨链 flag 由上一前哨/锚点产出）——
//       构图后必无环（拓扑序存在）、且每个前哨从「教学完成」起可达。
//   (e) 链尾存在且唯一可判：若存在 story anchor beat，则恰有 ≥1 个 chainTail（章尾·结局判定读它）；多个 chainTail 警告。
//       若当前无任何 story anchor beat（canon 锚点仍在 chart_pois）→ 本门 no-op 绿（链由锚点承载·playthrough-story 守）。
//
// 跑法： node scripts/check-mainline-reachable.mjs   或在 npm run regress 里作 check-mainline-reachable 任务。
// 退出码：全过=0，任一断裂=1。

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const DATA = join(ROOT, 'src', 'data');
const readJson = (p) => JSON.parse(readFileSync(join(DATA, p), 'utf8'));

const HOME_LIGHTHOUSE_ID = 'lighthouse.home';
const TUTORIAL_COMPLETE_FLAG = 'flag.tutorial_complete';
// canon 一章四锚点 flag（chart_pois 锚点事件产出·恒在教学后·= engine/story.ts ch1AnchorFlag 输出）。
// 这里写出来作「教学后即可得的种子 flag」集——前哨链/柱门指向它们时算「可达前置」。
const CH1_ANCHORS = ['reef', 'slope', 'midwater', 'vent'];
const ANCHOR_FLAGS = new Set(CH1_ANCHORS.map((a) => `story.ch1.anchor.${a}`));

const lhFile = readJson('lighthouse_upgrades.json');
const chartFile = readJson('chart_pois.json');

const outposts = lhFile.outposts ?? [];
const ruins = lhFile.ruins ?? [];

// 主线 beat 潜点＝chart_pois.json 里带 `story` 字段的静态 anchor（2026-07-12 深度柱删除后 re-home·
// 原由 depth_columns.json storyTier 派生）。每个：{ id（=运行时稳定 poiId）, owner（host 灯塔）,
// story:{eventId, beatFlag, chainTail?, revisit*?} }。递归收集这些 anchor。
const storyAnchors = [];
const collectStoryAnchors = (node) => {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) return node.forEach(collectStoryAnchors);
  if (typeof node.id === 'string' && node.story && typeof node.story === 'object' && typeof node.story.eventId === 'string') {
    storyAnchors.push(node);
  }
  for (const v of Object.values(node)) collectStoryAnchors(v);
};
collectStoryAnchors(chartFile);

// —— 事件 id 全集（columnStory.eventId 引用完整性）——
const eventIds = new Set();
const EVENTS_DIR = join(DATA, 'events');
const collectEventIds = (node) => {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) return node.forEach(collectEventIds);
  if (typeof node.id === 'string' && Array.isArray(node.options)) eventIds.add(node.id);
  for (const v of Object.values(node)) collectEventIds(v);
};
try {
  for (const f of readdirSync(EVENTS_DIR).filter((n) => n.endsWith('.json'))) {
    try {
      collectEventIds(JSON.parse(readFileSync(join(EVENTS_DIR, f), 'utf8')));
    } catch {
      /* 坏 JSON 由 check-data-schema 报·这里跳过 */
    }
  }
} catch {
  /* 目录缺 → 跳过（非常规环境不破） */
}

// —— 道具在册 + capstone 产出表（跨柱 item 门）——
const itemsFile = readJson('items.json');
// 道具 story.marksPois 标记的全部海图点 id（「文献坐标」产出侧·主线 beat reveal 单一来源·2026-06-28 内容自洽回归）：
// 主线 beat 的派生 story 潜点（poi.dive.<短名>.story）必被某道具（导师日志 mentor_logbook）marksPois ——
// 否则该坐标在海图上永不揭示（早揭示门没产出源＝主线 beat 进不去·与旧「revealFlag 无产出源」同性质的死结）。
const markedPoiTargets = new Set();
for (const it of itemsFile.items ?? []) for (const pid of it.story?.marksPois ?? []) if (typeof pid === 'string') markedPoiTargets.add(pid);

const errors = [];
const warnings = [];

// ── 「可被某处产出的 flag」全集（producer-aware·让死结/坏 flip 真能被抓住）──
// 产出源：① 道具 story.setsFlag（item-as-unlock·如鲸落手记 → whalefall_found）；② 任意事件 outcome/check 的
// setProfileFlags（锚点节拍 / 剧情节拍·递归扫 events/*.json）；③ 深度柱 tier setsFlag（capstone 揭示 flag）。
// 这是「谁来置 flag」的产出侧普查——前哨门 flag 若指向**没有任何产出源**的字符串（typo / 未接节拍）即死结（下面拦）。
const producedFlags = new Set([TUTORIAL_COMPLETE_FLAG, ...ANCHOR_FLAGS]); // 教学完成 + 四锚点（chart_pois 锚点事件恒产出·playthrough-story §5 守在场）
const collectSetFlags = (node) => {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) return node.forEach(collectSetFlags);
  if (Array.isArray(node.setProfileFlags)) for (const f of node.setProfileFlags) if (typeof f === 'string') producedFlags.add(f);
  for (const v of Object.values(node)) collectSetFlags(v);
};
try {
  for (const f of readdirSync(EVENTS_DIR).filter((n) => n.endsWith('.json'))) {
    try {
      collectSetFlags(JSON.parse(readFileSync(join(EVENTS_DIR, f), 'utf8')));
    } catch {
      /* 坏 JSON 由 check-data-schema 报 */
    }
  }
} catch {
  /* 目录缺 → 跳过 */
}
for (const it of itemsFile.items ?? []) for (const f of it.story?.setsFlag ?? []) if (typeof f === 'string') producedFlags.add(f);

// ── (b/c) 灯塔解锁图：node = 灯塔 id；可达性从「教学完成 + 四锚点 flag（恒在教学后）」种子起不动点迭代 ──
// 灯塔来源：home（恒在）+ 每前哨 result.id（建成点亮）+ 废墟 result.id（修复点亮·无门）。
// 前哨「可建门」= requiresAnchor（本区锚点 flag）/ requiresFlag（上一步 flag·flip 后）——指向的前置 flag 必须
// 「有产出源」（producedFlags）才算可达前置。建模为「flag 依赖」：前哨可达 ⟺ 其门 flag 有产出源。
const litLighthouses = new Set([HOME_LIGHTHOUSE_ID]); // home 恒在
for (const r of ruins) if (r.result?.id) litLighthouses.add(r.result.id); // 废墟无门·视为可达（修复即点亮）

// 可达 flag 种子＝有产出源的 flag（producer-aware·上面普查所得）。前哨建成本身不置 flag（result 不置）→
// 前哨链 flag 只可能来自锚点 / 剧情节拍 / 道具 / capstone setsFlag·全已并入 producedFlags。
const reachableFlags = new Set(producedFlags);

// 前哨门 flag（要建该前哨需先有的 flag）。requiresAnchor 'X' → story.ch1.anchor.X；requiresFlag 直用。
const outpostGateFlag = (o) => {
  if (typeof o.requiresAnchor === 'string') return `story.ch1.anchor.${o.requiresAnchor}`;
  if (typeof o.requiresFlag === 'string') return o.requiresFlag;
  return null; // 无门（深脊柱·#131 后应无）
};
let changed = true;
let guard = 0;
while (changed && guard++ < 64) {
  changed = false;
  for (const o of outposts) {
    if (!o.result?.id || litLighthouses.has(o.result.id)) continue;
    const g = outpostGateFlag(o);
    if (g === null || reachableFlags.has(g)) {
      litLighthouses.add(o.result.id);
      changed = true;
    }
  }
}
if (guard >= 64) errors.push('[cycle] 前哨解锁链疑似成环（不动点迭代未收敛）——检查 requiresFlag 是否相互指向');

// 哪些灯塔承载主线 beat（= 某 story anchor 的 owner）——
// 决定「前哨门不可达」是硬错（断主线）还是软提示（St1 留白·如海沟 trench 前哨无主线 beat）。
const hostsMainlineBeat = new Set(storyAnchors.map((a) => a.owner).filter(Boolean));

// 任一前哨门 flag 不可达 → 死结。**分级**（兼容 QUIRKS #126「缺 producer = St1 有意留白」）：
//   · 该前哨 host 着主线 beat（某 story anchor 的 owner）→ 硬错（主线真断·建不了它就下不去该区主线）。
//   · 否则（无主线 beat 的前哨·如海沟这类 St1 未接节拍的留白）→ 警告·不红（producer 侧由
//     playthrough-story §5「story.* ⊆ allStoryFlags」+ check-economy 守·本门不重复对「有意留白」判红）。
for (const o of outposts) {
  if (!o.result?.id || litLighthouses.has(o.result.id)) continue;
  const g = outpostGateFlag(o);
  const msg = `前哨 ${o.id}（→${o.result?.id}）的可建门 flag「${g}」不可达——无更早步骤产出它`;
  if (hostsMainlineBeat.has(o.result.id)) {
    errors.push(`[dead-end] ${msg}（链断·该区主线 beat 下不去）`);
  } else {
    warnings.push(`[dead-end?] ${msg}（该区无主线 beat 潜点·疑 St1 未接节拍的留白·QUIRKS #126）`);
  }
}

// ── 主线 beat（chart_pois story anchor·re-home 2026-07-12）收集 + 校验 ──
// 一个 anchor「承载主线 beat」⟺ 带 `story` 字段。beat 的 reach 门 = host（owner）灯塔可达（建成）。
const beats = []; // {poiId, host, eventId, beatFlag, chainTail}
for (const a of storyAnchors) {
  const s = a.story;
  const poiId = a.id;
  const host = a.owner;
  beats.push({ poiId, host, eventId: s.eventId, beatFlag: s.beatFlag, chainTail: s.chainTail === true });
  // (a) 引用完整
  if (typeof s.eventId !== 'string' || !eventIds.has(s.eventId)) {
    errors.push(`[beat-event] 主线 beat 潜点 ${poiId}：eventId「${s.eventId}」不在任何 events/*.json 在册`);
  }
  if (typeof s.beatFlag !== 'string' || !/^story\./.test(s.beatFlag)) {
    errors.push(`[beat-flag] 主线 beat 潜点 ${poiId}：beatFlag「${s.beatFlag}」须形如 story.*（由 engine/story.ts 登记）`);
  }
  // 早揭示门（2026-06-28 内容自洽回归后）：reveal 单一来源＝「日志文献坐标」——该 story 潜点 id
  // 必被某道具（导师日志 mentor_logbook）story.marksPois 标记，否则坐标永不揭示＝主线 beat 进不去
  // （与旧「revealFlag 无产出源」同性质的死结·只是产出侧走 marksPois·见 chart.ts #117）。
  if (!markedPoiTargets.has(poiId)) {
    errors.push(`[beat-reveal] 主线 beat 潜点 ${poiId} 无 marksPois 产出源（应由某道具 story.marksPois 带它·如 mentor_logbook）——否则坐标永不揭示·主线 beat 进不去`);
  }
  // (b) host 可达（建成）：host=home 恒在，或某前哨 result.id 可经建造链点亮。
  if (host && !litLighthouses.has(host)) {
    errors.push(`[beat-host] 主线 beat 潜点 ${poiId}：host 灯塔 ${host} 不可达（前哨链未通到它）`);
  }
}

// （原 (d) 跨柱 capstone item 门随深度柱/capstone 系统删除·2026-07-12 移除。）

// (e) 链尾：有 beat 则恰需 ≥1 chainTail（结局判定读它）。
if (beats.length > 0) {
  const tails = beats.filter((b) => b.chainTail);
  if (tails.length === 0) {
    errors.push('[chain-tail] 存在主线 beat，但无任一标记 chainTail（章尾）——结局判定无锚（D-2 改动③）');
  } else if (tails.length > 1) {
    warnings.push(
      `[chain-tail] 有 ${tails.length} 个 chainTail（${tails.map((t) => t.poiId).join('、')}）——通常一章一个章尾·确认是否有意`,
    );
  }
  // beatFlag 唯一（两 beat 同 flag = 进度判定撞车）。
  const seen = new Map();
  for (const b of beats) seen.set(b.beatFlag, (seen.get(b.beatFlag) ?? 0) + 1);
  for (const [f, n] of seen) if (n > 1) errors.push(`[beat-flag] beatFlag「${f}」被 ${n} 个 beat 共用（进度判定撞车）`);
}

// —— 汇报 ——
for (const w of warnings) console.warn('  ⚠ ' + w);
if (errors.length) {
  console.error(`✗ check-mainline-reachable：${errors.length} 处主线链断裂`);
  for (const e of errors) console.error('  - ' + e);
  console.error(
    '\n  怎么办：主线 beat 的 reach 门（host 灯塔建成 / 探深升级 / 跨区 item·flag）必须能被**前面步骤**满足；' +
      '\n  前哨「可建门」改用「上一步 flag」别相互指向（防环）；跨柱 key item 的产出柱 host 须更早可达。',
  );
  process.exit(1);
}

console.log(
  `✓ check-mainline-reachable：前哨解锁链无环·${litLighthouses.size} 座灯塔可达 · ` +
    (beats.length > 0
      ? `${beats.length} 个主线 beat 潜点（链尾 ${beats.filter((b) => b.chainTail).length}）host/引用/reveal 门均可达`
      : '当前无 story anchor beat（主线由 chart_pois canon 锚点承载·playthrough-story 守）— 链结构 no-op 绿'),
);
process.exit(0);
