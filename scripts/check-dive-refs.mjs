#!/usr/bin/env node
// 探深「深度柱」机制门（#131·重写自旧「探深↔深入 POI flag 配对」门·见 CHANGELOG #128 的旧四条）——
// 把 depth_columns.json 的不变量变成会在 `npm run regress` 里失败的检查（仿 check-enemy-refs）。
// 纯读 JSON·无 TS 依赖。任一不过 → exit 1。
//
// 九条门：
//   (a) lighthouseId 合法     —— 每根柱的宿主灯塔 id 真实存在（home / 前哨 result.id / 废墟 result.id）。
//   (b) 一柱一灯塔            —— lighthouseId 不重复（一座灯塔至多一根柱）。
//   (c) 柱 id 唯一            —— column.id 不重复、且形如 `col.<短名>`。
//   (d) tier 连续单调         —— tiers 非空·tier 从 1 连续递增·每档 depthRange[0]<[1]·档间顶深非降（越深档越深）。
//   (e) 账单在场              —— 每 tier cost.materials 是数组 + cost.gold 是数（≥0）。
//   (f) zoneId 合法           —— column.zoneId 在 zones.json 注册。
//   (g) 派生 band id 不撞     —— band.<短名>.t<tier> 不与 depth_bands.json 既有 id 冲突、彼此不重。
//   (h) 派生 probe 升级 id 不撞 —— lighthouse.probe.<短名>.lv<tier> 不与 lighthouse_upgrades.json 既有 upgrade id 冲突。
//   (i) 残留 bandId 可解析    —— 任何手写 ChartPoi.bandId（现应无·防回流）仍指向 depth_bands.json 注册 band。
//   (l) capstone 产出/消费闭环 —— tier.grantsItem 合法且在册；capstone 消费的 key item（decay eternal·非卖品）必有 capstone 产出来源（跨柱硬依赖「必经」不断裂）。

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const DATA = join(ROOT, 'src', 'data');

const HOME_LIGHTHOUSE_ID = 'lighthouse.home';

const errors = [];
const readJson = (p) => JSON.parse(readFileSync(join(DATA, p), 'utf8'));

const columnsFile = readJson('depth_columns.json');
const bandsFile = readJson('depth_bands.json');
const lhFile = readJson('lighthouse_upgrades.json');
const chartPois = readJson('chart_pois.json');
const zonesFile = readJson('zones.json');

const columns = columnsFile.columns ?? [];

// —— 既有 id 集（用于碰撞检测）——
const bandIds = new Set((bandsFile.bands ?? []).map((b) => b.id));
const zoneIds = new Set((zonesFile.zones ?? []).map((z) => z.id));
const existingUpgradeIds = new Set();
for (const track of lhFile.tracks ?? []) {
  for (const u of track.upgrades ?? []) existingUpgradeIds.add(u.id);
}

// —— 合法灯塔 id：home + 前哨 result.id + 废墟 result.id ——
const lighthouseIds = new Set([HOME_LIGHTHOUSE_ID]);
for (const o of lhFile.outposts ?? []) if (o.result?.id) lighthouseIds.add(o.result.id);
for (const r of lhFile.ruins ?? []) if (r.result?.id) lighthouseIds.add(r.result.id);

const short = (id) => String(id).replace(/^col\./, '');

const seenColumnIds = new Set();
const seenLighthouseIds = new Set();
const derivedBandIds = new Set();

for (const c of columns) {
  const cid = c.id ?? '(无 id)';

  // (c) 柱 id 唯一 + 命名
  if (seenColumnIds.has(c.id)) errors.push(`[col-id] 柱 id 重复：${cid}`);
  seenColumnIds.add(c.id);
  if (typeof c.id !== 'string' || !/^col\./.test(c.id)) {
    errors.push(`[col-id] 柱 id ${cid} 不形如 col.<短名>`);
  }

  // (a) lighthouseId 合法
  if (!lighthouseIds.has(c.lighthouseId)) {
    errors.push(`[host] 柱 ${cid}：lighthouseId ${c.lighthouseId} 不是合法灯塔 id（home / 前哨 / 废墟 result.id）`);
  }
  // (b) 一柱一灯塔
  if (seenLighthouseIds.has(c.lighthouseId)) {
    errors.push(`[host] 柱 ${cid}：lighthouseId ${c.lighthouseId} 被多根柱占用（一座灯塔至多一根柱）`);
  }
  seenLighthouseIds.add(c.lighthouseId);

  // (f) zoneId 合法
  if (!zoneIds.has(c.zoneId)) {
    errors.push(`[zone] 柱 ${cid}：zoneId ${c.zoneId} 不在 zones.json`);
  }

  const tiers = c.tiers ?? [];
  if (tiers.length === 0) errors.push(`[tier] 柱 ${cid}：tiers 为空`);

  let prevTop = -Infinity;
  tiers.forEach((t, i) => {
    // (d) tier 连续递增（1-based）
    if (t.tier !== i + 1) {
      errors.push(`[tier] 柱 ${cid}：第 ${i + 1} 个 tier 的 tier=${t.tier}（应连续从 1 递增）`);
    }
    // (d) depthRange 合法
    const dr = t.depthRange;
    if (!Array.isArray(dr) || dr.length !== 2 || !(dr[0] < dr[1])) {
      errors.push(`[tier] 柱 ${cid} t${t.tier}：depthRange 非法（需 [min,max] 且 min<max）`);
    } else {
      // (d) 档间顶深非降（越深档越深）
      if (dr[0] < prevTop) {
        errors.push(`[tier] 柱 ${cid} t${t.tier}：顶深 ${dr[0]} < 上一档顶深 ${prevTop}（档须越来越深）`);
      }
      prevTop = dr[0];
    }
    // (e) 账单在场
    const cost = t.cost ?? {};
    if (!Array.isArray(cost.materials) || typeof cost.gold !== 'number' || cost.gold < 0) {
      errors.push(`[cost] 柱 ${cid} t${t.tier}：cost 非法（需 materials[] + gold≥0）`);
    }
    // (g) 派生 band id 不撞
    const bid = `band.${short(c.id)}.t${t.tier}`;
    if (bandIds.has(bid)) errors.push(`[band] 柱 ${cid} t${t.tier}：派生 band id ${bid} 与 depth_bands.json 既有 id 冲突`);
    if (derivedBandIds.has(bid)) errors.push(`[band] 派生 band id ${bid} 重复`);
    derivedBandIds.add(bid);
    // (h) 派生 probe 升级 id 不撞
    const uid = `lighthouse.probe.${short(c.id)}.lv${t.tier}`;
    if (existingUpgradeIds.has(uid)) {
      errors.push(`[upgrade] 柱 ${cid} t${t.tier}：派生 probe 升级 id ${uid} 与 lighthouse_upgrades.json 既有 upgrade id 冲突`);
    }
  });
}

// (i) 残留手写 ChartPoi.bandId 仍可解析（现应无 poi.deep.*；派生 POI 不在 JSON 里·防回流悬空）。
const allBandIds = new Set([...bandIds, ...derivedBandIds]);
// chart_pois 现按 mapId 分段（对齐 chart_regions）——flatten 所有段（跳过 _doc 等字符串）。
const authoredPois = Object.values(chartPois)
  .filter((seg) => seg && typeof seg === 'object' && !Array.isArray(seg))
  .flatMap((seg) => [...(seg.anchors ?? []), ...(seg.roamingTemplates ?? [])]);
for (const p of authoredPois) {
  if (typeof p.bandId === 'string' && !allBandIds.has(p.bandId)) {
    errors.push(`[poi-band] 手写 POI ${p.id ?? p.templateId}：bandId ${p.bandId} 不在 depth_bands.json / 派生 band`);
  }
}

// (j) 事件 advanceOutpostId 必指向在册前哨（#131·防回流：旧深脊柱建造事件指向已删前哨＝无声 no-op）。
const outpostIds = new Set((lhFile.outposts ?? []).map((o) => o.id));
const EVENTS_DIR = join(DATA, 'events');
const walkAdvance = (o, file) => {
  if (!o || typeof o !== 'object') return;
  if (Array.isArray(o)) return o.forEach((x) => walkAdvance(x, file));
  if (typeof o.advanceOutpostId === 'string' && !outpostIds.has(o.advanceOutpostId)) {
    errors.push(`[advanceOutpost] ${file}：advanceOutpostId ${o.advanceOutpostId} 不是在册前哨（lighthouse_upgrades.json outposts[]）`);
  }
  for (const k of Object.keys(o)) walkAdvance(o[k], file);
};
for (const f of readdirSync(EVENTS_DIR).filter((n) => n.endsWith('.json'))) {
  let ev;
  try {
    ev = JSON.parse(readFileSync(join(EVENTS_DIR, f), 'utf8'));
  } catch {
    continue;
  }
  walkAdvance(ev, `events/${f}`);
}

// (k) 道具「文献坐标」marksPois 必指向在册 authored POI（#140 续·文献坐标功能·防 typo 静默成「不在你的海图上」）。
const authoredPoiIds = new Set(authoredPois.map((p) => p.id).filter(Boolean));
const itemsFile = readJson('items.json');
for (const it of itemsFile.items ?? []) {
  for (const pid of it.story?.marksPois ?? []) {
    if (!authoredPoiIds.has(pid)) {
      errors.push(
        `[marksPois] 道具 ${it.id}：marksPois ${pid} 不是在册 authored POI（chart_pois.json anchors）`,
      );
    }
  }
}

// (l) capstone 产出/消费闭环（核心+情报·2026-06-20·「必经热液」落成机制）：
//   · 任何 tier.grantsItem 必形如 {itemId, qty≥1} 且 itemId 是 items.json 在册道具；
//   · capstone 消费的「key item」（decay 'eternal' 且 sellPrice 0＝非卖品关键道具）必有某 capstone 产出（grantsItem）来源——
//     否则跨柱硬依赖断裂（如海沟电梯 cost 含 item.station_module 却无人产出 ⇒ 玩家永远建不了电梯·下不去深渊路）。
const itemIndex = new Map((itemsFile.items ?? []).map((it) => [it.id, it]));
const isKeyItem = (id) => {
  const it = itemIndex.get(id);
  return !!it && it.decay === 'eternal' && (it.sellPrice ?? 0) === 0;
};
const grantedByCapstone = new Set();
for (const c of columns) {
  for (const t of c.tiers ?? []) {
    const g = t.grantsItem;
    if (g === undefined) continue;
    if (typeof g.itemId !== 'string' || typeof g.qty !== 'number' || g.qty < 1) {
      errors.push(`[grant] 柱 ${c.id} t${t.tier}：grantsItem 非法（需 {itemId, qty≥1}）`);
      continue;
    }
    if (!itemIndex.has(g.itemId)) {
      errors.push(`[grant] 柱 ${c.id} t${t.tier}：grantsItem.itemId ${g.itemId} 不在 items.json`);
    }
    if (t.capstone === true) grantedByCapstone.add(g.itemId);
  }
}
for (const c of columns) {
  for (const t of c.tiers ?? []) {
    if (t.capstone !== true) continue;
    for (const m of t.cost?.materials ?? []) {
      if (isKeyItem(m.itemId) && !grantedByCapstone.has(m.itemId)) {
        errors.push(
          `[capstone-dep] 柱 ${c.id} t${t.tier}：capstone 消费关键道具 ${m.itemId}，但无任何 capstone 产出它（跨柱硬依赖断裂·「必经」落空）`,
        );
      }
    }
  }
}

// —— 汇报 ——
if (errors.length) {
  console.error(`✗ check-dive-refs：${errors.length} 处问题`);
  for (const e of errors) console.error('  - ' + e);
  process.exit(1);
}
const tierCount = columns.reduce((a, c) => a + (c.tiers?.length ?? 0), 0);
console.log(
  `✓ check-dive-refs：${columns.length} 根深度柱 / ${tierCount} 档 · 宿主合法 · 一柱一灯塔 · tier 连续单调 · 账单在场 · zone 合法 · 派生 band/probe id 不撞 · capstone 产出/消费闭环`,
);
