#!/usr/bin/env node
// 通用 NPC 信任系统门（2026-06-30·藏宝贸易与信任系统 SPEC §3.7）——把信任系统的结构约定钉成
// `npm run regress` 会红的检查。纯读文件·无 TS 依赖·进程隔离（同 check-upgrade-refs / check-boundaries）。
//
// 五条：
//   ① thresholds 单调递增（每 NPC 若声明 npc.trust.thresholds）——档才有意义（SPEC §3.2）。
//   ② npcTrustTier Condition 引用的 npcId 必须是真 NPC，且 0 ≤ minTier ≤ 该 NPC 档数（SPEC §3.4）。
//   ③〔红线·SPEC §8〕货架实查（数据住 src/data/shop.json·2026-07-02 从 port.ts 抽出后本条由空桩转实）：
//      货架 itemId 必须在 items.json 在册（挂不存在的物品＝静默死条目）；且 minTrustTier>0 的条目
//      不得**锁**通关必需——「通关必需」复用单一真相（scripts/lib/economy-dag.mjs·别自造清单）＝
//      建造 cost 材料全集（check-economy-reachability 的 sink 集）∪ 主线 reveal 道具（story.marksPois
//      命中 storyTier 柱派生 story 潜点·check-mainline-reachable (a) 口径）；「锁」＝该必需物在信任门外
//      无任何获取源（economy-dag 源池：事件/敌人/柱产出/Mira·全不看信任）——有门外来源＝「多一条路」合法。
//   ④ gainTrust/loseTrust effect 引用的 npcId 必须是真 NPC，amount 必须非负数字（SPEC §3.5·镜像 ②）。
//   ⑤ Sela 交头 POI（chart_pois.json roam.sela_meet*）的 lunarWindow 并集 ≡ shop.json
//      specialMerchant.activePhases（浅层/深层各自成组判）——「在港窗=交头窗」由此机制强连（SPEC §6.2/§12.4）。
// 退出码：全过=0，任一违规=1。

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildEconomyDag } from './lib/economy-dag.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const readJson = (rel) => JSON.parse(readFileSync(join(ROOT, rel), 'utf8'));
const listJson = (dir) =>
  readdirSync(join(ROOT, dir))
    .filter((f) => f.endsWith('.json'))
    .map((f) => `${dir}/${f}`);

// 默认梯档数（与 engine/trust.ts::DEFAULT_TRUST_THRESHOLDS 长度一致·NPC 未声明 thresholds 时的档数上限）
const DEFAULT_TIER_COUNT = 4;

const errors = [];

// —— NPC id 集 + per-NPC thresholds（① 单调）——
const npcThresholds = {}; // npcId → number[]
const npcIds = new Set();
for (const rel of listJson('src/data/npcs')) {
  const npc = readJson(rel).npc;
  if (!npc || typeof npc.id !== 'string') continue;
  npcIds.add(npc.id);
  const th = npc.trust?.thresholds;
  if (th === undefined) continue;
  if (!Array.isArray(th) || th.some((n) => typeof n !== 'number')) {
    errors.push(`${rel}: npc ${npc.id} 的 trust.thresholds 必须是数字数组`);
    continue;
  }
  npcThresholds[npc.id] = th;
  for (let i = 1; i < th.length; i++) {
    if (th[i] <= th[i - 1]) {
      errors.push(`${rel}: npc ${npc.id} 的 trust.thresholds 非严格递增（${th.join(',')}）——档阈值须单调`);
      break;
    }
  }
}

// —— ②④ 递归校验所有 npcTrustTier / gainTrust / loseTrust 引用（扫 npcs + events 数据）——
let refCount = 0;
let effectCount = 0;
function walk(node, where) {
  if (Array.isArray(node)) {
    node.forEach((v, i) => walk(v, `${where}[${i}]`));
    return;
  }
  if (!node || typeof node !== 'object') return;
  if (node.kind === 'npcTrustTier') {
    refCount++;
    const { npcId, minTier } = node;
    if (typeof npcId !== 'string' || !npcIds.has(npcId)) {
      errors.push(`${where}: npcTrustTier 引用了不存在的 NPC ${JSON.stringify(npcId)}`);
    } else {
      const tierCount = npcThresholds[npcId]?.length ?? DEFAULT_TIER_COUNT;
      if (typeof minTier !== 'number' || minTier < 0 || minTier > tierCount) {
        errors.push(`${where}: npcTrustTier minTier=${minTier} 超范围（${npcId} 档数 0..${tierCount}）`);
      }
    }
  }
  if (node.kind === 'gainTrust' || node.kind === 'loseTrust') {
    effectCount++;
    const { npcId, amount } = node;
    if (typeof npcId !== 'string' || !npcIds.has(npcId)) {
      errors.push(`${where}: ${node.kind} 引用了不存在的 NPC ${JSON.stringify(npcId)}`);
    }
    if (typeof amount !== 'number' || amount < 0) {
      errors.push(`${where}: ${node.kind} amount=${JSON.stringify(amount)} 须为非负数字（增减方向在 kind·不在符号）`);
    }
  }
  for (const [k, v] of Object.entries(node)) walk(v, `${where}.${k}`);
}
for (const rel of [...listJson('src/data/npcs'), ...listJson('src/data/events')]) {
  walk(readJson(rel), rel);
}

// —— ③ 红线（SPEC §8）：shop.json 货架实查 ——
const shop = readJson('src/data/shop.json');
const dag = buildEconomyDag();

// 货架 itemId 在册（mira 四表 + sela 货架·跳过 _doc* 注释键）。
let shelfIdCount = 0;
for (const [where, table] of [
  ['mira.consumables', shop.mira?.consumables],
  ['mira.equipment', shop.mira?.equipment],
  ['mira.mods', shop.mira?.mods],
  ['mira.charts', shop.mira?.charts],
  ['specialMerchant.stock', shop.specialMerchant?.stock],
]) {
  for (const itemId of Object.keys(table ?? {})) {
    if (itemId.startsWith('_')) continue;
    shelfIdCount++;
    if (!dag.universe.has(itemId)) {
      errors.push(`src/data/shop.json ${where}: ${itemId} 不在 items.json 在册（货架挂了不存在的物品＝静默死条目）`);
    }
  }
}

// 「通关必需」集合（单一真相·economy-dag）：建造 cost 材料全集 ∪ 主线 reveal 道具。
const requiredItems = new Set();
for (const b of dag.builds) for (const m of b.mats) requiredItems.add(m.itemId);
const columnsFile = readJson('src/data/depth_columns.json');
const storyPoiIds = new Set(
  (columnsFile.columns ?? [])
    .filter((c) => c.storyTier)
    .map((c) => `poi.dive.${String(c.id).replace(/^col\./, '')}.story`),
);
for (const [id, def] of dag.items) {
  if ((def.story?.marksPois ?? []).some((p) => storyPoiIds.has(p))) requiredItems.add(id);
}

let gatedCount = 0;
for (const [itemId, entry] of Object.entries(shop.specialMerchant?.stock ?? {})) {
  if (itemId.startsWith('_')) continue;
  const minTier = entry?.minTrustTier;
  if (typeof minTier !== 'number' || minTier < 0) {
    errors.push(`src/data/shop.json specialMerchant.stock.${itemId}: minTrustTier=${JSON.stringify(minTier)} 须为非负数字`);
    continue;
  }
  if (minTier === 0) continue;
  gatedCount++;
  if (!requiredItems.has(itemId)) continue; // 奢侈/冗余货·随便锁（§8）
  if (!(dag.sourcesByItem.get(itemId)?.length)) {
    errors.push(
      `src/data/shop.json specialMerchant.stock.${itemId}: minTrustTier=${minTier} 且是通关必需（建造料/主线 reveal），` +
        `但信任门外无任何获取源（事件/敌人/柱产出/Mira 全无）——信任门锁死通关必需·SPEC §8 红线`,
    );
  }
}

// —— ⑤ Sela 交头 POI 相位窗 ≡ shop.json activePhases（机制强连·chart_pois _doc 指回本门）——
const chartFile = readJson('src/data/chart_pois.json');
const selaWindowByGroup = new Map(); // 'shallow' | 'deep' → Set(phase)
let selaTemplateCount = 0;
const walkChart = (node) => {
  if (Array.isArray(node)) return node.forEach(walkChart);
  if (!node || typeof node !== 'object') return;
  if (typeof node.templateId === 'string' && node.templateId.startsWith('roam.sela_meet')) {
    selaTemplateCount++;
    const group = node.templateId.startsWith('roam.sela_meet_deep') ? 'deep' : 'shallow';
    if (!selaWindowByGroup.has(group)) selaWindowByGroup.set(group, new Set());
    for (const p of node.lunarWindow ?? []) selaWindowByGroup.get(group).add(p);
  }
  for (const v of Object.values(node)) walkChart(v);
};
walkChart(chartFile);
const activePhases = [...(shop.specialMerchant?.activePhases ?? [])].sort().join(',');
if (selaTemplateCount === 0) {
  errors.push('src/data/chart_pois.json: 找不到任何 roam.sela_meet* 交头模板——⑤ 相位窗一致性检查落空（模板改名？同步更新本门）');
}
for (const [group, set] of selaWindowByGroup) {
  const got = [...set].sort().join(',');
  if (got !== activePhases) {
    errors.push(
      `src/data/chart_pois.json roam.sela_meet*（${group === 'deep' ? '深层' : '浅层'}）lunarWindow 并集 [${got}] ≠ ` +
        `shop.json specialMerchant.activePhases [${activePhases}]——「在港窗=交头窗」须一致（改窗两边一起改）`,
    );
  }
}

if (errors.length) {
  console.error('✗ check-npc-trust 失败：');
  for (const e of errors) console.error('  - ' + e);
  process.exit(1);
}
console.log(
  `✓ check-npc-trust：${npcIds.size} 个 NPC·${Object.keys(npcThresholds).length} 个声明信任档·` +
    `${refCount} 处 npcTrustTier + ${effectCount} 处 gainTrust/loseTrust 引用全合法·` +
    `货架 ${shelfIdCount} 项在册（信任门 ${gatedCount} 项不锁通关必需·§8）·` +
    `Sela 交头窗 ${selaTemplateCount} 模板 ≡ activePhases[${activePhases}]`,
);
