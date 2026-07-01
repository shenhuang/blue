#!/usr/bin/env node
// 通用 NPC 信任系统门（2026-06-30·藏宝贸易与信任系统 SPEC §3.7）——把信任系统的结构约定钉成
// `npm run regress` 会红的检查。纯读文件·无 TS 依赖·进程隔离（同 check-upgrade-refs / check-boundaries）。
//
// Phase 1（机制层就位·零 NPC 使用）：数据里还没有 npc.trust.thresholds、也没有 npcTrustTier 引用
//   ⇒ 本门当前空过；先立住 → Phase 2+ 谁引用不存在的 NPC、给非法 minTier、或写非单调 thresholds，这门会红。
//
// 三条：
//   ① thresholds 单调递增（每 NPC 若声明 npc.trust.thresholds）——档才有意义（SPEC §3.2）。
//   ② npcTrustTier Condition 引用的 npcId 必须是真 NPC，且 0 ≤ minTier ≤ 该 NPC 档数（SPEC §3.4）。
//   ③〔红线桩·SPEC §8〕货架 minTrustTier>0 不得含通关必需标的——商店 minTrustTier 目前住 code（port.ts），
//      data 无此字段 → 当前空过；待 schema 长出 minTrustTier 再填实。
// 退出码：全过=0，任一违规=1。

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

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

// —— ② 递归校验所有 npcTrustTier 引用（扫 npcs + events 数据）——
let refCount = 0;
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
  for (const [k, v] of Object.entries(node)) walk(v, `${where}.${k}`);
}
for (const rel of [...listJson('src/data/npcs'), ...listJson('src/data/events')]) {
  walk(readJson(rel), rel);
}

// ③ 红线桩：商店 minTrustTier 目前住 code（engine/port.ts），data 无此字段 → 空过（待 schema 长出再填实·SPEC §8）。

if (errors.length) {
  console.error('✗ check-npc-trust 失败：');
  for (const e of errors) console.error('  - ' + e);
  process.exit(1);
}
console.log(
  `✓ check-npc-trust：${npcIds.size} 个 NPC·${Object.keys(npcThresholds).length} 个声明信任档·${refCount} 处 npcTrustTier 引用全合法（红线桩待商店 minTrustTier schema）`,
);
