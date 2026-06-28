#!/usr/bin/env node
// 经济可达性门 v1（2026-06-27·机制先行·D-2/E/F 组的护栏·见 docs/playtest-findings.md）——
// 把「建造要的材料必须拿得到」钉成 `npm run regress` 里会失败的检查。纯读 JSON·无 TS 依赖·进程隔离友好。
//
// v1 两条硬门（**纯结构·不查数值大小** → 兼容 defer-number-tuning）：
//   ① 引用存在：所有建造/升级/配方 cost.materials 的 itemId 必在 items.json 在册。
//   ② 有获取源：每个 cost 材料 ≥1 获取源——事件/敌人掉落 · 深度柱 grantsItem 产出 · Mira 可买（material 且 tier∈{1,2}）。
//
// 不查（留 v2 DAG·待 E/F「材料→tier→各柱档」映射表·docs/playtest-findings.md F 组）：
//   · 数量/产率是否够（数值·defer）；· 区域解锁顺序（X 区建造要的料须在 X 或更早区可得）。
//
// 源收集刻意「宽」（新门零误报优先·仿 check-data-schema 保守原则）：events/enemies 里出现的任何 itemId
// 都算可获得。故 v1 只会因「某材料在全游戏任何掉落表/产出/商店都不出现」而红＝真·死材料（item.spare_tank 那类）。
// sink/源 shape 见 check-dive-refs.mjs / items.json / upgrades.json / lighthouse_upgrades.json / depth_columns.json。
// Mira 规则镜像 src/engine/port.ts::isBuyableFromMira（material 且 tier 在 SHOP_STOCK_BY_TIER={1,2}）。
//
// 退出码：全过=0，任一断裂=1。

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const DATA = join(ROOT, 'src', 'data');
const readJson = (p) => JSON.parse(readFileSync(join(DATA, p), 'utf8'));

const itemsFile = readJson('items.json');
const upgradesFile = readJson('upgrades.json');
const lhFile = readJson('lighthouse_upgrades.json');
const columnsFile = readJson('depth_columns.json');

const items = itemsFile.items ?? [];
const universe = new Set(items.map((it) => it.id)); // 在册道具全集

// ── 源收集（宽·避免新门误报）──────────────────────────────────────
const sources = new Set();

/** 递归收集任意 itemId 字符串（用于 events/enemies·它们里出现的 itemId 都是「可获得」）。 */
function collectItemIds(node, out) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const x of node) collectItemIds(x, out);
    return;
  }
  for (const [k, v] of Object.entries(node)) {
    if (k === 'itemId' && typeof v === 'string') out.add(v);
    else collectItemIds(v, out);
  }
}

for (const sub of ['events', 'enemies']) {
  const dir = join(DATA, sub);
  let files = [];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.json'));
  } catch {
    files = []; // 目录缺 → 跳过（非常规环境不破）
  }
  for (const f of files) {
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    } catch {
      continue; // 坏 JSON 由 check-data-schema 报·这里跳过
    }
    collectItemIds(parsed, sources);
  }
}

// 深度柱产出（仅 grantsItem·**不**收 cost.materials，否则会把 sink 误当 source）。
for (const c of columnsFile.columns ?? []) {
  for (const t of c.tiers ?? []) {
    if (t.grantsItem && typeof t.grantsItem.itemId === 'string') sources.add(t.grantsItem.itemId);
  }
}

// Mira 可买（port.ts::isBuyableFromMira）：category 'material' 且 tier∈{1,2}。
const MIRA_TIERS = new Set([1, 2]);
const miraBuyable = new Set();
for (const it of items) {
  if (it.category === 'material' && MIRA_TIERS.has(it.tier)) {
    sources.add(it.id);
    miraBuyable.add(it.id);
  }
}

// ── sink 收集（带出处·用于报错定位）────────────────────────────────
const sinks = []; // {itemId, where}
const addMats = (mats, where) => {
  for (const m of mats ?? []) if (m && typeof m.itemId === 'string') sinks.push({ itemId: m.itemId, where });
};

// items.json：装备 upgradeSteps + craftCost
for (const it of items) {
  const eq = it.equipment;
  if (!eq) continue;
  (eq.upgradeSteps ?? []).forEach((s, i) => addMats(s.materials, `items.json ${it.id} upgradeStep#${i + 1}`));
  if (eq.craftCost) addMats(eq.craftCost.materials, `items.json ${it.id} craftCost`);
}
// upgrades.json：lines[].upgrades[].cost
for (const ln of upgradesFile.lines ?? []) {
  for (const u of ln.upgrades ?? []) addMats(u.cost?.materials, `upgrades.json ${u.id}`);
}
// lighthouse_upgrades.json：outposts stages + ruins + tracks upgrades
for (const o of lhFile.outposts ?? []) {
  (o.stages ?? []).forEach((s, i) => addMats(s.cost?.materials, `lighthouse_upgrades ${o.id} stage#${i + 1}`));
}
for (const r of lhFile.ruins ?? []) addMats(r.cost?.materials, `lighthouse_upgrades ruin ${r.result?.id ?? r.id ?? '?'}`);
for (const tr of lhFile.tracks ?? []) {
  for (const u of tr.upgrades ?? []) addMats(u.cost?.materials, `lighthouse_upgrades ${u.id}`);
}
// depth_columns.json：tiers[].cost
for (const c of columnsFile.columns ?? []) {
  (c.tiers ?? []).forEach((t) => addMats(t.cost?.materials, `depth_columns ${c.id} t${t.tier}`));
}

// ── 判定 ───────────────────────────────────────────────────────────
const errors = [];

// ① 引用存在
const missingDef = new Map(); // itemId → where[]
for (const s of sinks) {
  if (!universe.has(s.itemId)) {
    if (!missingDef.has(s.itemId)) missingDef.set(s.itemId, []);
    missingDef.get(s.itemId).push(s.where);
  }
}
// ② 有获取源
const noSource = new Map(); // itemId → where[]
for (const s of sinks) {
  if (universe.has(s.itemId) && !sources.has(s.itemId)) {
    if (!noSource.has(s.itemId)) noSource.set(s.itemId, []);
    noSource.get(s.itemId).push(s.where);
  }
}

for (const [id, wheres] of missingDef) {
  errors.push(`[missing-item] 成本材料 ${id} 不在 items.json 在册 — 被引用于：${[...new Set(wheres)].join('；')}`);
}
for (const [id, wheres] of noSource) {
  errors.push(
    `[no-source] 成本材料 ${id} 无任何获取源（事件/敌人掉落 · 深度柱产出 · Mira 可买 T1-2 均无）— 被引用于：${[...new Set(wheres)].join('；')}`,
  );
}

// ── 汇报 ───────────────────────────────────────────────────────────
if (errors.length) {
  console.error(`✗ check-economy-reachability：${errors.length} 处供需断裂`);
  for (const e of errors) console.error('  - ' + e);
  console.error(
    '\n  怎么办：给该材料补一个获取源（事件 loot / 敌人掉落 / 深度柱 grantsItem），或把成本改指向有源的材料；' +
      '\n  T1/T2 材料可经 Mira 回购自动算源（port.ts）。区域顺序/产率不在本门（v2 DAG·见 findings.md F 组）。',
  );
  process.exit(1);
}

const distinctSinkMats = new Set(sinks.map((s) => s.itemId));
console.log(
  `✓ check-economy-reachability：${sinks.length} 处建造/升级成本 · ${distinctSinkMats.size} 种材料 · ` +
    `全部在册且有获取源（源池 ${sources.size} 种 · 含 Mira 可买 ${miraBuyable.size} 种）`,
);
process.exit(0);
