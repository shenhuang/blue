#!/usr/bin/env node
// 经济 DAG 单一真相（2026-06-29·E/F 组 v2·见 docs/playtest-findings.md F 组 + docs/QUIRKS.md #197/#198/#199）——
// 把「物品 / 建造账单 / 获取源 / 区域序」收成一份纯函数图，给三个消费者共用，别各搞一份：
//   · scripts/check-economy-roles.mjs        ← auditRoles（#197 角色分离 + #198 reveal）
//   · scripts/check-economy-reachability.mjs ← auditReachability（①引用存在 ②有源 + F1 单调 / F2 无结 / F4 稀疏）
//   · scripts/emit-economy-graph.mjs         ← buildEconomyDag + toMermaid（违规染红·docs/economy-dag.mmd）
//
// 纯读 JSON·无 TS 依赖·进程隔离/沙箱友好（同 check-economy-* 约定·不吃 esbuild）。
// 数值不判大小（产率/数量留 [[defer-number-tuning]]）；只判**结构**关系——故 defer-number-tuning 不破。
//
// —— 区域 / 深度归属（这门能比 v1 多判 F1/F2/F4 的关键）——
//   · 事件 loot 区域 = **事件文件名**（reef.json→reef…）；深度 = 事件 depthRange[0]
//     （zoneTags 是 biome/深带标如 twilight·**不是**区域名·别拿来当区域）。
//   · 敌人 loot 区域 = enemy.bands[0]（zone.X→X）；深度未知→0（保守＝当作浅可得·不造假违规）。
//   · Mira 可买（material 且 tier∈{1,2}·镜像 port.ts::isBuyableFromMira）：深度 0（恒在浅档兜底）。
//   （2026-07-12：深度柱系统已删除——柱 grantsItem / 柱建造 sink / 柱区域序均已随之移除。）
//   未知深度的源一律记 0＝「浅可得」：保守方向（只会少报违规·不会误红绿 main）。

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const DATA = join(ROOT, 'src', 'data');
const readJson = (p) => JSON.parse(readFileSync(join(DATA, p), 'utf8'));

// ── 区域归一（单一来源）────────────────────────────────────────────
// 事件文件名 stem → 区域（只列「区域清晰」的现存事件文件；ch1/tutorial 等跨切横贯件归 null＝区域无关）。
const REGION_BY_EVENTFILE = {
  reef: 'reef',
  wreck_graveyard: 'wreck',
  midwater: 'midwater',
  vent: 'vent',
  blue_caves: 'cave',
};
/** zone./band. 字符串（敌人 bands / 前哨 result.region）→ 规范区域名。 */
export function cleanRegion(raw) {
  if (!raw) return null;
  let r = String(raw).replace(/^zone\./, '').replace(/^band\./, '').replace(/\.t\d+$/, '');
  const map = {
    old_lighthouse_reef: 'reef',
    reef: 'reef',
    reef_tropical: 'reef',
    wreck_graveyard: 'wreck',
    wreck_field: 'wreck',
    open_midwater: 'midwater',
    midwater: 'midwater',
    vent_trench: 'vent', // vent 与 trench 共用 zone；柱侧按柱短名区分（见 REGION_BY_COLUMN）
    vent: 'vent',
    blue_caves: 'cave',
    deep_cave: 'cave',
    trench: 'trench',
  };
  return map[r] ?? r;
}

/** 递归收集任意 itemId 字符串（宽收·镜像 v1 check-economy-reachability：少误报优先）。 */
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

const MIRA_TIERS = new Set([1, 2]);

/**
 * 构建经济 DAG（纯函数·每次重算）。
 * @returns {{
 *   items: Map<string, any>, roleOf: Map, tierOf: Map, sellPriceOf: Map, categoryOf: Map,
 *   universe: Set<string>, miraBuyable: Set<string>,
 *   sourcesByItem: Map<string, Array<{kind:string, region:?string, depth:number, columnTier?:number, capstone?:boolean, from:string}>>,
 *   builds: Array<{where:string, label:string, region:?string, depth:?number, tier:?number, early:boolean, light:boolean, capstone:boolean, kind:string, mats:Array<{itemId:string, qty:number}>}>,
 *   regions: string[], regionOrder: string[], regionMinDepth: Map<string, number>,
 *   shallowestSourceDepth:(id:string)=>number, sourceRegions:(id:string)=>Set<string>,
 *   onlyFromCapstone:(id:string)=>boolean, hasNonMiraSource:(id:string)=>boolean,
 * }}
 */
export function buildEconomyDag() {
  const itemsFile = readJson('items.json');
  const upgradesFile = readJson('upgrades.json');
  const lhFile = readJson('lighthouse_upgrades.json');

  const items = itemsFile.items ?? [];
  const itemsById = new Map(items.map((it) => [it.id, it]));
  const roleOf = new Map();
  const tierOf = new Map();
  const sellPriceOf = new Map();
  const categoryOf = new Map();
  for (const it of items) {
    if (it.role) roleOf.set(it.id, it.role);
    if (typeof it.tier === 'number') tierOf.set(it.id, it.tier);
    if (typeof it.sellPrice === 'number') sellPriceOf.set(it.id, it.sellPrice);
    if (it.category) categoryOf.set(it.id, it.category);
  }
  const universe = new Set(items.map((it) => it.id));

  // ── 源收集（带 区域 + 深度）───────────────────────────────────────
  const sourcesByItem = new Map();
  const addSource = (itemId, src) => {
    if (!sourcesByItem.has(itemId)) sourcesByItem.set(itemId, []);
    sourcesByItem.get(itemId).push(src);
  };

  // 事件：每文件按文件名定区域·每事件按 depthRange[0] 定深度·宽收事件内全部 itemId。
  {
    const dir = join(DATA, 'events');
    let files = [];
    try {
      files = readdirSync(dir).filter((f) => f.endsWith('.json'));
    } catch {
      files = [];
    }
    for (const f of files) {
      const stem = f.replace(/\.json$/, '');
      const region = REGION_BY_EVENTFILE[stem] ?? null; // 未列＝区域无关（不造跨区边）
      let parsed;
      try {
        parsed = JSON.parse(readFileSync(join(dir, f), 'utf8'));
      } catch {
        continue;
      }
      const evs = parsed.events ?? (Array.isArray(parsed) ? parsed : []);
      for (const ev of evs) {
        const depth = Array.isArray(ev.depthRange) ? ev.depthRange[0] : 0;
        const ids = new Set();
        collectItemIds(ev, ids);
        for (const id of ids) addSource(id, { kind: 'event', region, depth, from: `${stem}.json ${ev.id ?? '?'}` });
      }
    }
  }

  // 敌人：每敌按 bands[0] 定区域·深度未知→0·宽收该敌子树 itemId。
  {
    const dir = join(DATA, 'enemies');
    let files = [];
    try {
      files = readdirSync(dir).filter((f) => f.endsWith('.json'));
    } catch {
      files = [];
    }
    for (const f of files) {
      let parsed;
      try {
        parsed = JSON.parse(readFileSync(join(dir, f), 'utf8'));
      } catch {
        continue;
      }
      const list = parsed.enemies ?? (Array.isArray(parsed) ? parsed : []);
      for (const en of list) {
        const region = cleanRegion(Array.isArray(en.bands) ? en.bands[0] : null);
        const ids = new Set();
        collectItemIds(en, ids);
        for (const id of ids) addSource(id, { kind: 'enemy', region, depth: 0, from: `enemies ${en.id ?? f}` });
      }
    }
  }

  // Mira 可买（material 且 tier∈{1,2}）：深度 0 恒在。
  const miraBuyable = new Set();
  for (const it of items) {
    if (it.category === 'material' && MIRA_TIERS.has(it.tier)) {
      miraBuyable.add(it.id);
      addSource(it.id, { kind: 'mira', region: null, depth: 0, from: 'Mira T1-2' });
    }
  }

  // ── sink/建造收集（带 区域/深度/early/light/capstone）──────────────
  const builds = [];
  const pushBuild = (b) => {
    if ((b.mats ?? []).length) builds.push({ light: false, capstone: false, tier: null, depth: null, region: null, ...b });
  };
  const lightLabel = (s) => /点亮|通电|感知/.test(s || '');

  // 前哨阶（地表·无深度·F1 不适用）。
  for (const o of lhFile.outposts ?? []) {
    (o.stages ?? []).forEach((s, i) => {
      pushBuild({
        where: `${o.id} stage#${i + 1}`,
        label: s.label ?? '',
        region: cleanRegion(o.result?.region) ?? null,
        early: i === 0,
        light: lightLabel(s.label),
        kind: 'outpost',
        mats: s.cost?.materials ?? [],
      });
    });
  }
  // 废墟（修复·中期）。
  for (const r of lhFile.ruins ?? []) {
    pushBuild({
      where: `ruin ${r.result?.id ?? r.id ?? '?'}`,
      label: r.result?.name ?? '',
      region: cleanRegion(r.result?.region) ?? null,
      kind: 'ruin',
      mats: r.cost?.materials ?? [],
    });
  }
  // 设施轨道（港口·无深度）。
  for (const tr of lhFile.tracks ?? []) {
    for (const u of tr.upgrades ?? []) {
      pushBuild({
        where: `${u.id}`,
        label: u.name ?? '',
        region: '港口',
        early: (u.requiresLighthouseLevel ?? 1) === 1,
        light: lightLabel(u.name),
        kind: 'track',
        mats: u.cost?.materials ?? [],
      });
    }
  }
  // 港口升级线（guild/salvage·无深度）。
  for (const ln of upgradesFile.lines ?? []) {
    for (const u of ln.upgrades ?? []) {
      pushBuild({
        where: `upgrades ${u.id}`,
        label: u.name ?? '',
        region: '港口',
        early: (u.level ?? 1) === 1,
        kind: 'portUpgrade',
        mats: u.cost?.materials ?? [],
      });
    }
  }
  // 装备配方（升级步 + craftCost·无深度）。
  for (const it of items) {
    const eq = it.equipment;
    if (!eq) continue;
    (eq.upgradeSteps ?? []).forEach((s, i) =>
      pushBuild({
        where: `items ${it.id} upgradeStep#${i + 1}`,
        label: it.name ?? '',
        region: '装备',
        kind: 'equip',
        mats: s.materials ?? [],
      }),
    );
    if (eq.craftCost)
      pushBuild({
        where: `items ${it.id} craftCost`,
        label: it.name ?? '',
        region: '装备',
        kind: 'equip',
        mats: eq.craftCost.materials ?? [],
      });
  }

  // ── 区域序（按区域内最浅内容深度·升序）────────────────────────────
  const regionMinDepth = new Map();
  const noteDepth = (region, depth) => {
    if (!region || typeof depth !== 'number') return;
    const cur = regionMinDepth.get(region);
    if (cur == null || depth < cur) regionMinDepth.set(region, depth);
  };
  // 只用 事件 源定区域序（敌人/Mira 深度 0·会把所有区域压成 0·污染排序）。
  for (const [, srcs] of sourcesByItem) for (const s of srcs) if (s.kind === 'event') noteDepth(s.region, s.depth);
  const regions = [...regionMinDepth.keys()].sort();
  const regionOrder = [...regions].sort(
    (a, b) => (regionMinDepth.get(a) ?? 1e9) - (regionMinDepth.get(b) ?? 1e9) || a.localeCompare(b),
  );

  // ── 派生 helper ────────────────────────────────────────────────────
  const shallowestSourceDepth = (id) => {
    const srcs = sourcesByItem.get(id);
    if (!srcs || !srcs.length) return Infinity;
    return Math.min(...srcs.map((s) => (typeof s.depth === 'number' ? s.depth : 0)));
  };
  const sourceRegions = (id) => {
    const out = new Set();
    for (const s of sourcesByItem.get(id) ?? []) if (s.region) out.add(s.region);
    return out;
  };
  const onlyFromCapstone = (id) => {
    const srcs = sourcesByItem.get(id) ?? [];
    return srcs.length > 0 && srcs.every((s) => s.kind === 'grant' && s.capstone);
  };
  const hasNonMiraSource = (id) => (sourcesByItem.get(id) ?? []).some((s) => s.kind !== 'mira');

  return {
    items: itemsById,
    roleOf,
    tierOf,
    sellPriceOf,
    categoryOf,
    universe,
    miraBuyable,
    sourcesByItem,
    builds,
    regions,
    regionOrder,
    regionMinDepth,
    shallowestSourceDepth,
    sourceRegions,
    onlyFromCapstone,
    hasNonMiraSource,
  };
}

// ════════════════════════════════════════════════════════════════════
//  审计：角色分离（#197）+ reveal（#198）
// ════════════════════════════════════════════════════════════════════
/** @returns {{violations: Array<{code:string, msg:string}>}} */
export function auditRoles(dag) {
  const v = [];
  const sp = (id) => dag.sellPriceOf.get(id);
  const role = (id) => dag.roleOf.get(id);

  // #197 ① scrap_alloy = 纯建材：sellPrice===0 且 role structural。
  if (dag.universe.has('item.scrap_alloy')) {
    if (sp('item.scrap_alloy') !== 0)
      v.push({ code: 'roles/scrap-sellprice', msg: `scrap_alloy 应为纯建材 sellPrice===0（现 ${sp('item.scrap_alloy')}）——给它加价会复活「珊瑚双职」(#197)` });
    if (role('item.scrap_alloy') !== 'structural')
      v.push({ code: 'roles/scrap-role', msg: `scrap_alloy 应 role='structural'（现 ${role('item.scrap_alloy') ?? '未标'}）` });
  }
  // #197 ② coral_shard = 纯货币：sellPrice>0；且早期建造不得用 coral 当建材。
  if (dag.universe.has('item.coral_shard')) {
    if (!(sp('item.coral_shard') > 0))
      v.push({ code: 'roles/coral-currency', msg: `coral_shard 应为纯货币 sellPrice>0（现 ${sp('item.coral_shard')}）(#197)` });
  }
  for (const b of dag.builds) {
    if (b.early && b.mats.some((m) => m.itemId === 'item.coral_shard'))
      v.push({ code: 'roles/early-coral', where: b.where, itemId: 'item.coral_shard', msg: `${b.where}〔${b.label}〕早期建造用了 coral_shard 当建材——早期一律用 scrap 不用 coral(#197)` });
  }

  // #198 reveal：mentor_logbook 必须用 marksPois（日志文献坐标）·不得用 setsFlag·须覆盖各带 storyTier 柱的 story 潜点。
  const lb = dag.items.get('item.mentor_logbook');
  if (lb) {
    const marks = lb.story?.marksPois ?? [];
    const setsFlag = lb.story?.setsFlag ?? [];
    if (Array.isArray(setsFlag) && setsFlag.length)
      v.push({ code: 'reveal/logbook-setsflag', msg: `mentor_logbook.story.setsFlag 非空（${setsFlag.join(',')}）——reveal 必须走 marksPois 文献坐标·别回退裸 flag(#198)` });
    if (!Array.isArray(marks) || !marks.length)
      v.push({ code: 'reveal/logbook-nomarks', msg: `mentor_logbook.story.marksPois 缺失——四柱坐标须经日志 marksPois 揭示(#198)` });
  } else {
    v.push({ code: 'reveal/logbook-missing', msg: `items.json 缺 item.mentor_logbook(#198)` });
  }

  return { violations: v };
}

// ════════════════════════════════════════════════════════════════════
//  审计：可达性 / DAG 公理（① 引用存在 · ② 有源 · F1 单调 · F2 无结 · F4 稀疏）
//  F5（tier≈源深）= 软警告（数值·defer）；F6（bio=光）= 交给 check-build-material-theming（不重复实现）。
// ════════════════════════════════════════════════════════════════════
const F4_CROSSREGION_LIMIT = 2; // 每柱跨区门 ≤2（findings F4「稀疏」·1–2 处）

/** @returns {{violations: Array, warnings: Array, crossByColumn: Map}} */
export function auditReachability(dag) {
  const violations = [];
  const warnings = [];

  // ① 引用存在 + ② 有源（沿用 v1·宽源池）。
  const missingDef = new Map();
  const noSource = new Map();
  for (const b of dag.builds) {
    for (const m of b.mats) {
      if (!dag.universe.has(m.itemId)) {
        if (!missingDef.has(m.itemId)) missingDef.set(m.itemId, new Set());
        missingDef.get(m.itemId).add(b.where);
      } else if (!(dag.sourcesByItem.get(m.itemId)?.length)) {
        if (!noSource.has(m.itemId)) noSource.set(m.itemId, new Set());
        noSource.get(m.itemId).add(b.where);
      }
    }
  }
  for (const [id, w] of missingDef)
    violations.push({ code: 'reach/missing-item', itemId: id, msg: `成本材料 ${id} 不在 items.json 在册 — 引用于：${[...w].join('；')}` });
  for (const [id, w] of noSource)
    violations.push({ code: 'reach/no-source', itemId: id, msg: `成本材料 ${id} 无任何获取源 — 引用于：${[...w].join('；')}` });

  // F1 单调：有深度的柱档·成本材料的「最浅源深度」≤ 本档深度（别要求「比自己更深才产」的料）。
  //   Mira(T1/2)/敌人 → 深度 0 → 恒过；只有「只在更深事件/产出里出现」的料会触发＝真·倒置依赖。
  for (const b of dag.builds) {
    if (typeof b.depth !== 'number') continue;
    for (const m of b.mats) {
      if (!dag.universe.has(m.itemId)) continue;
      const sd = dag.shallowestSourceDepth(m.itemId);
      if (sd !== Infinity && sd > b.depth)
        violations.push({
          code: 'reach/F1-monotonic',
          where: b.where,
          itemId: m.itemId,
          msg: `${b.where}〔${b.label}〕@${b.depth}m 要 ${m.itemId}·但其最浅源在 ${sd}m（更深）——「要先更深才能建浅档」(F1 单调)`,
        });
    }
  }

  // F2b 无结·capstone 依赖：只由 capstone 产出的料·只能被 capstone 档消费（station_module 模板＝vent capstone→trench capstone·过）。
  for (const b of dag.builds) {
    if (b.capstone) continue;
    for (const m of b.mats) {
      if (dag.universe.has(m.itemId) && dag.onlyFromCapstone(m.itemId))
        violations.push({
          code: 'reach/F2-capstone-dep',
          where: b.where,
          itemId: m.itemId,
          msg: `${b.where}〔${b.label}〕(非 capstone) 依赖只由 capstone 产出的 ${m.itemId}——跨区门须指向已可达浅档·非 capstone(F2 无结)`,
        });
    }
  }

  // F2a 无结·区域环：跨区边 region(build)→region(source) 不得成环。
  const edges = new Map(); // region → Set(region)
  const addEdge = (a, b) => {
    if (!a || !b || a === b) return;
    if (!edges.has(a)) edges.set(a, new Set());
    edges.get(a).add(b);
  };
  for (const b of dag.builds) {
    // 区域环只看深度柱潜行经济（前哨/废墟由 story flag 链门控·非材料流·trench 前哨名义区 blue_caves 会造假环）。
    if (b.kind !== 'column' || !b.region) continue;
    for (const m of b.mats) {
      if (!dag.universe.has(m.itemId) || dag.miraBuyable.has(m.itemId)) continue; // Mira 可买＝港口兜底·非跨区旅行门
      const srcRegions = dag.sourceRegions(m.itemId);
      if (srcRegions.has(b.region)) continue; // 本区有源＝非跨区
      for (const sr of srcRegions) addEdge(b.region, sr);
    }
  }
  const cyc = findCycle(edges);
  if (cyc) violations.push({ code: 'reach/F2-region-cycle', regions: cyc, msg: `区域依赖成环：${cyc.join(' → ')}（F2 无结·最关键）` });

  // F4 稀疏：每柱（深度柱·tier≥2 非 capstone 中/深档）真·跨区门 ≤ ${F4_CROSSREGION_LIMIT}。
  //   真·跨区＝强制旅行的料：排除 Mira 可买（港口兜底）+ capstone 模板料（station_module·F4 钦定模板）；capstone 终局档豁免。
  //   = **硬门**（2026-06-29 #239 由软警告提升·密度 pass 已收到 ≤2·trench/midwater 现各 2）：超限即红·别再加第 3 条跨区门。
  const crossByColumn = new Map(); // region → Set(crossMatId)
  for (const b of dag.builds) {
    if (b.kind !== 'column' || !b.region || (b.tier ?? 1) < 2 || b.capstone) continue;
    const key = b.region;
    if (!crossByColumn.has(key)) crossByColumn.set(key, new Set());
    for (const m of b.mats) {
      if (!dag.universe.has(m.itemId) || dag.miraBuyable.has(m.itemId) || dag.onlyFromCapstone(m.itemId)) continue;
      const srcRegions = dag.sourceRegions(m.itemId);
      if (srcRegions.size && !srcRegions.has(b.region)) crossByColumn.get(key).add(m.itemId);
    }
  }
  for (const [region, set] of crossByColumn) {
    if (set.size > F4_CROSSREGION_LIMIT)
      violations.push({
        code: 'reach/F4-sparse',
        region,
        items: [...set],
        msg: `${region} 柱中/深档真·跨区门 ${set.size} 处 > ${F4_CROSSREGION_LIMIT}（${[...set].map((s) => s.replace('item.', '')).join('、')}）——跨区门偏密·收到 ≤${F4_CROSSREGION_LIMIT}(F4 稀疏)`,
      });
  }

  // F5 tier≈源深（软·数值 defer）：申报 tier 与源深档不符 → 警告（不红）。
  const tierBand = (depth) => (depth <= 44 ? 1 : depth <= 80 ? 2 : depth <= 175 ? 3 : 4);
  for (const [id, srcs] of dag.sourcesByItem) {
    const declared = dag.tierOf.get(id);
    if (declared == null || declared >= 5) continue; // 5＝跨区特殊件(station_module)·豁免
    const realDepths = srcs.filter((s) => s.kind === 'event' || s.kind === 'grant').map((s) => s.depth);
    if (!realDepths.length) continue;
    const band = tierBand(Math.min(...realDepths));
    if (Math.abs(band - declared) >= 2)
      warnings.push({ code: 'reach/F5-tier-depth', itemId: id, msg: `${id} 申报 T${declared}·但最浅事件/产出源在 ${Math.min(...realDepths)}m≈T${band}（F5 tier≈源深·数值 defer）` });
  }

  return { violations, warnings, crossByColumn };
}

/** 有向图找环（DFS）·返回环路径或 null。 */
function findCycle(edges) {
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map();
  const stack = [];
  const nodes = new Set();
  for (const [a, bs] of edges) {
    nodes.add(a);
    for (const b of bs) nodes.add(b);
  }
  for (const n of nodes) color.set(n, WHITE);
  let found = null;
  const dfs = (u) => {
    color.set(u, GRAY);
    stack.push(u);
    for (const w of edges.get(u) ?? []) {
      if (found) return;
      const c = color.get(w) ?? WHITE;
      if (c === GRAY) {
        const i = stack.indexOf(w);
        found = stack.slice(i).concat(w);
        return;
      }
      if (c === WHITE) dfs(w);
    }
    stack.pop();
    color.set(u, BLACK);
  };
  for (const n of nodes) {
    if (found) break;
    if (color.get(n) === WHITE) dfs(n);
  }
  return found;
}

// ════════════════════════════════════════════════════════════════════
//  Mermaid 输出（违规染红·确定性排序·docs/economy-dag.mmd）
// ════════════════════════════════════════════════════════════════════
const mmId = (s) => s.replace(/[^a-zA-Z0-9_]/g, '_');

/** 生成 Mermaid flowchart 源码；bad* = 硬违规(红)·warn* = 软警告(琥珀)。 */
export function toMermaid(
  dag,
  { badItems = new Set(), badBuilds = new Set(), warnItems = new Set(), warnRegions = new Set(), badRegions = new Set() } = {},
) {
  const L = [];
  L.push('%% 自动生成·勿手改——`node scripts/emit-economy-graph.mjs --write` 再生（见 scripts/lib/economy-dag.mjs）');
  L.push('%% 边 = 建造 --需要--> 材料；红 = 违反 F1/F2/F4 硬门·琥珀 = F5 软警告（详情跑 npm run regress --only economy）');
  L.push('flowchart LR');
  L.push('  classDef bad fill:#fdd,stroke:#c00,stroke-width:2px,color:#900;');
  L.push('  classDef warn fill:#fff3d6,stroke:#c90,stroke-width:1px,color:#850;');
  L.push('  classDef mat fill:#eef,stroke:#88a,color:#225;');

  // 区域子图（按 regionOrder）·每区域内列该区域产出的材料 + 该区域的柱建造。
  const buildsByRegion = new Map();
  for (const b of dag.builds) {
    if (b.kind !== 'column') continue;
    if (!buildsByRegion.has(b.region)) buildsByRegion.set(b.region, []);
    buildsByRegion.get(b.region).push(b);
  }
  const matRegion = (id) => [...dag.sourceRegions(id)].sort()[0] ?? '其他';
  const matsByRegion = new Map();
  for (const id of dag.universe) {
    if (dag.categoryOf.get(id) !== 'material') continue;
    if (!(dag.sourcesByItem.get(id)?.length)) continue;
    const r = matRegion(id);
    if (!matsByRegion.has(r)) matsByRegion.set(r, []);
    matsByRegion.get(r).push(id);
  }

  const allRegions = [...new Set([...dag.regionOrder, ...buildsByRegion.keys(), ...matsByRegion.keys()])];
  const cls = (id) => (badItems.has(id) ? ':::bad' : warnItems.has(id) ? ':::warn' : ':::mat');
  for (const region of allRegions) {
    const title = `${region}${badRegions.has(region) ? ' ✗F4' : warnRegions.has(region) ? ' ⚠F4' : ''}`;
    L.push(`  subgraph ${mmId(region)}["${title}"]`);
    for (const id of (matsByRegion.get(region) ?? []).sort()) {
      const t = dag.tierOf.get(id);
      L.push(`    ${mmId(id)}(["${id.replace('item.', '')}${t ? ` T${t}` : ''}"])${cls(id)}`);
    }
    for (const b of (buildsByRegion.get(region) ?? []).sort((x, y) => (x.tier ?? 0) - (y.tier ?? 0))) {
      L.push(`    ${mmId(b.where)}["${b.region} t${b.tier}"]${badBuilds.has(b.where) ? ':::bad' : ''}`);
    }
    L.push('  end');
  }
  // 边（去重·确定性）。
  const seen = new Set();
  for (const b of dag.builds) {
    if (b.kind !== 'column') continue;
    for (const m of b.mats) {
      const key = `${b.where}->${m.itemId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      L.push(`  ${mmId(b.where)} --> ${mmId(m.itemId)}`);
    }
  }
  return L.join('\n') + '\n';
}
