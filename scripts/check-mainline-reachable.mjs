#!/usr/bin/env node
// 主线可达性门（经济「不 grind 化」D-2·M 组「check-mainline-reachable」·2026-06-27·见 docs/playtest-findings.md）——
// 把「主线链无环、无死结、起点→章尾可达」钉成 `npm run regress` 里会失败的检查。纯读 JSON·无 TS 依赖·进程隔离友好。
// 仿 scripts/check-dive-refs.mjs / check-economy-reachability.mjs 的纯 node 风格。
//
// 背景（D-2·A 案）：主线＝「带 story 的深度柱阶梯」——一区一根柱、由浅到深的主线 beat（DepthColumnTier.story）；
// 隶属灯塔（柱 host = home 或某前哨 result.id）建成、且探深升到该档，才下得去（reveal/reach 分离）。前哨「可建门」
// 改成「上一步进度 flag」解死锁（wreck←reef…）。本门把这条链做静态可判：沿「灯塔解锁序 + 柱 tier + 跨区 item/flag」
// 走一遍，确认每个 beat 的 reach 门都能被**前面步骤**满足、整条链无环、起点（教学完成）能走到章尾（链尾 beat）。
//
// 检查的不变量（**纯结构·不查数值** → 兼容 defer-number-tuning）：
//   (a) 引用完整：每个 columnStory beat 的 eventId 必在某 events/*.json 在册；beatFlag 必形如 story.*（由 story.ts 登记·
//       与 playthrough-story §5「story.* ⊆ allStoryFlags()」互补·这里只查命名形）；该 beat 的派生 story 潜点
//       （poi.dive.<短名>.story·reveal 门）必被某道具 story.marksPois 标记（reveal 产出源·导师日志「携带」四坐标·
//       2026-06-28 内容自洽回归：reveal 从裸 revealFlag 改回「文献坐标」机制·#117 续）——否则坐标永不揭示·主线 beat 进不去。
//   (b) host 可达：每根「承载主线 beat 的柱」host 灯塔 = home（恒在）或某前哨 result.id（可经建造点亮）。
//   (c) 前哨解锁链无环、可达：前哨可建门（requiresAnchor 本区锚点 / requiresFlag 上一步 flag）指向的前置 flag，
//       必能由**更早一环**产出（canon 锚点 flag 由四锚点事件产出·恒在教学后；前哨链 flag 由上一前哨/锚点产出）——
//       构图后必无环（拓扑序存在）、且每个前哨从「教学完成」起可达。
//   (d) 跨柱 item 门：capstone cost 消费的关键 item（如 station_module）必由某「更早可达」的柱 capstone 产出
//       （grantsItem）——与 check-dive-refs (l) 互补：那条只查「有产出来源」，这条查「产出来源在消费者之前可达」。
//   (e) 链尾存在且唯一可判：若存在 columnStory beat，则恰有 ≥1 个 chainTail（章尾·结局判定读它）；多个 chainTail 警告。
//       若当前无任何 columnStory beat（迁移未落·canon 锚点仍在 chart_pois）→ 本门 no-op 绿（链由锚点承载·playthrough-story 守）。
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
const CH1_ANCHORS = ['reef', 'wreck', 'midwater', 'vent'];
const ANCHOR_FLAGS = new Set(CH1_ANCHORS.map((a) => `story.ch1.anchor.${a}`));

const columnsFile = readJson('depth_columns.json');
const lhFile = readJson('lighthouse_upgrades.json');

const columns = columnsFile.columns ?? [];
const outposts = lhFile.outposts ?? [];
const ruins = lhFile.ruins ?? [];

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
const itemUniverse = new Set((itemsFile.items ?? []).map((it) => it.id));
// 道具 story.marksPois 标记的全部海图点 id（「文献坐标」产出侧·主线 beat reveal 单一来源·2026-06-28 内容自洽回归）：
// 主线 beat 的派生 story 潜点（poi.dive.<短名>.story）必被某道具（导师日志 mentor_logbook）marksPois ——
// 否则该坐标在海图上永不揭示（早揭示门没产出源＝主线 beat 进不去·与旧「revealFlag 无产出源」同性质的死结）。
const markedPoiTargets = new Set();
for (const it of itemsFile.items ?? []) for (const pid of it.story?.marksPois ?? []) if (typeof pid === 'string') markedPoiTargets.add(pid);
// 派生主线柱 story 潜点 id（与 engine/columns.ts::columnStoryDivePoiId 同构）。
const columnShort = (id) => String(id).replace(/^col\./, '');
const columnStoryDivePoiId = (colId) => `poi.dive.${columnShort(colId)}.story`;

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
for (const c of columns) for (const t of c.tiers ?? []) if (typeof t.setsFlag === 'string') producedFlags.add(t.setsFlag);

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

// 哪些灯塔承载主线 beat（柱带 storyTier·主线柱迁移：beat 单列于 DepthColumn.storyTier·不进刷怪 tiers[]）——
// 决定「前哨门不可达」是硬错（断主线）还是软提示（St1 留白·如海沟 trench 无 storyTier）。
const hostsMainlineBeat = new Set();
for (const c of columns) if (c.storyTier) hostsMainlineBeat.add(c.lighthouseId);

// 任一前哨门 flag 不可达 → 死结。**分级**（兼容 QUIRKS #126「缺 producer = St1 有意留白」）：
//   · 该前哨 host 着主线 beat（其柱带 columnStory）→ 硬错（主线真断·建不了它就下不去该区主线）。
//   · 否则（仅深入刷怪柱 / 鲸落·海沟这类 St1 未接节拍的留白）→ 警告·不红（producer 侧由
//     playthrough-story §5「story.* ⊆ allStoryFlags」+ check-economy 守·本门不重复对「有意留白」判红）。
for (const o of outposts) {
  if (!o.result?.id || litLighthouses.has(o.result.id)) continue;
  const g = outpostGateFlag(o);
  const msg = `前哨 ${o.id}（→${o.result?.id}）的可建门 flag「${g}」不可达——无更早步骤产出它`;
  if (hostsMainlineBeat.has(o.result.id)) {
    errors.push(`[dead-end] ${msg}（链断·该区主线 beat 下不去）`);
  } else {
    warnings.push(`[dead-end?] ${msg}（该区无 columnStory 主线 beat·疑 St1 未接节拍的留白·QUIRKS #126）`);
  }
}

// ── 主线 beat（storyTier·主线柱迁移）收集 + 校验 ──
// 一根柱「承载主线 beat」⟺ 带 storyTier（单列·不进刷怪 tiers[]）。beat 的 reach 门 = host 灯塔可达（建成）。
const beats = []; // {colId, host, eventId, beatFlag, chainTail}
for (const c of columns) {
  const s = c.storyTier;
  if (!s) continue;
  beats.push({
    colId: c.id,
    host: c.lighthouseId,
    eventId: s.eventId,
    beatFlag: s.beatFlag,
    chainTail: s.chainTail === true,
  });
  // (a) 引用完整
  if (typeof s.eventId !== 'string' || !eventIds.has(s.eventId)) {
    errors.push(`[beat-event] 柱 ${c.id} storyTier：eventId「${s.eventId}」不在任何 events/*.json 在册`);
  }
  if (typeof s.beatFlag !== 'string' || !/^story\./.test(s.beatFlag)) {
    errors.push(`[beat-flag] 柱 ${c.id} storyTier：beatFlag「${s.beatFlag}」须形如 story.*（由 engine/story.ts 登记）`);
  }
  // 早揭示门（主线柱迁移·点 4·2026-06-28 内容自洽回归后）：reveal 单一来源＝「日志文献坐标」——该柱的派生 story
  // 潜点 id（poi.dive.<短名>.story）必被某道具（导师日志 mentor_logbook）story.marksPois 标记，否则坐标永不揭示
  // ＝主线 beat 进不去（与旧「revealFlag 无产出源」同性质的死结·只是产出侧从 setsFlag 换成 marksPois·见 chart.ts #117）。
  const storyPoiId = columnStoryDivePoiId(c.id);
  if (!markedPoiTargets.has(storyPoiId)) {
    errors.push(`[beat-reveal] 柱 ${c.id} storyTier：派生 story 潜点 ${storyPoiId} 无 marksPois 产出源（应由某道具 story.marksPois 带它·如 mentor_logbook）——否则坐标永不揭示·主线 beat 进不去`);
  }
  // (b) host 可达（建成）：host=home 恒在，或某前哨 result.id 可经建造链点亮。
  if (!litLighthouses.has(c.lighthouseId)) {
    errors.push(`[beat-host] 柱 ${c.id} storyTier（主线 beat）：host 灯塔 ${c.lighthouseId} 不可达（前哨链未通到它）`);
  }
}

// (d) 跨柱 item 门：capstone cost 消费的「在册关键 item」必由「host 可达的某柱」capstone 产出（grantsItem）。
//     与 check-dive-refs (l)「有产出来源」互补——这里加「产出柱 host 也可达」（不可达柱产不出 → 消费者卡死）。
const grantedByReachableCapstone = new Set();
for (const c of columns) {
  if (!litLighthouses.has(c.lighthouseId)) continue; // host 不可达的柱产不出东西
  for (const t of c.tiers ?? []) {
    if (t.capstone === true && t.grantsItem && typeof t.grantsItem.itemId === 'string') {
      grantedByReachableCapstone.add(t.grantsItem.itemId);
    }
  }
}
for (const c of columns) {
  for (const t of c.tiers ?? []) {
    if (t.capstone !== true) continue;
    for (const m of t.cost?.materials ?? []) {
      // 「关键跨柱 item」= 在册、非卖品（station_module 那类·sellPrice 0）、且确由某 capstone 产出（grantsItem 全集）。
      const def = (itemsFile.items ?? []).find((it) => it.id === m.itemId);
      const isCrossCapstoneItem =
        def && (def.sellPrice ?? 0) === 0 && columns.some((cc) => (cc.tiers ?? []).some((tt) => tt.capstone && tt.grantsItem?.itemId === m.itemId));
      if (isCrossCapstoneItem && !grantedByReachableCapstone.has(m.itemId)) {
        errors.push(
          `[cross-item] 柱 ${c.id} t${t.tier}：capstone 消费跨柱关键 item「${m.itemId}」，但其唯一产出柱 host 不可达（链断·消费者建不了）`,
        );
      }
      if (def === undefined && !itemUniverse.has(m.itemId)) {
        // 引用不在册由 check-economy/check-dive-refs 主报；这里不重复（保守·避免双报）。
      }
    }
  }
}

// (e) 链尾：有 beat 则恰需 ≥1 chainTail（结局判定读它）。
if (beats.length > 0) {
  const tails = beats.filter((b) => b.chainTail);
  if (tails.length === 0) {
    errors.push('[chain-tail] 存在主线 columnStory beat，但无任一标记 chainTail（章尾）——结局判定无锚（D-2 改动③）');
  } else if (tails.length > 1) {
    warnings.push(
      `[chain-tail] 有 ${tails.length} 个 chainTail（${tails.map((t) => `${t.colId} storyTier`).join('、')}）——通常一章一个章尾·确认是否有意`,
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
      ? `${beats.length} 个主线 columnStory beat（链尾 ${beats.filter((b) => b.chainTail).length}）host/引用/跨柱 item 门均可达`
      : '当前无 columnStory beat（主线由 chart_pois canon 锚点承载·playthrough-story 守）— 链结构 no-op 绿'),
);
process.exit(0);
