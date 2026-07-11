#!/usr/bin/env node
// 通用 NPC 信任系统门（2026-06-30·藏宝贸易与信任系统 SPEC §3.7）——把信任系统的结构约定钉成
// `npm run regress` 会红的检查。纯读文件·无 TS 依赖·进程隔离（同 check-upgrade-refs / check-boundaries）。
//
// 三条（原 ⑤ Sela 相位窗 + §8「信任门不锁通关必需」红线随藏宝贸易 vertical 于 2026-07-12 删除·数据已消失）：
//   ① thresholds 单调递增（每 NPC 若声明 npc.trust.thresholds）——档才有意义（SPEC §3.2）。
//   ② npcTrustTier Condition 引用的 npcId 必须是真 NPC，且 0 ≤ minTier ≤ 该 NPC 档数（SPEC §3.4）。
//   ③ 货架实查：shop.json 货架 itemId 必须在 items.json 在册（挂不存在的物品＝静默死条目）。
//   ④ gainTrust/loseTrust effect 引用的 npcId 必须是真 NPC，amount 必须非负数字（SPEC §3.5·镜像 ②）。
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

// —— ③ 货架实查：shop.json 货架 itemId 必须在 items.json 在册（挂不存在的物品＝静默死条目）——
//   （2026-07-12：special-merchant / Sela 交头 / activePhases 相位窗随藏宝贸易 vertical 删除·
//    §8「信任门不锁通关必需」红线与 ⑤ 相位窗一致性因数据消失一并移除；信任机制本身仍在代码里·内容休眠。）
const shop = readJson('src/data/shop.json');
const dag = buildEconomyDag();

let shelfIdCount = 0;
for (const [where, table] of [
  ['mira.consumables', shop.mira?.consumables],
  ['mira.equipment', shop.mira?.equipment],
  ['mira.mods', shop.mira?.mods],
  ['mira.charts', shop.mira?.charts],
]) {
  for (const itemId of Object.keys(table ?? {})) {
    if (itemId.startsWith('_')) continue;
    shelfIdCount++;
    if (!dag.universe.has(itemId)) {
      errors.push(`src/data/shop.json ${where}: ${itemId} 不在 items.json 在册（货架挂了不存在的物品＝静默死条目）`);
    }
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
    `货架 ${shelfIdCount} 项在册`,
);
