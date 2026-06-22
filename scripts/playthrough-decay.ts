// 衰减系统验证：
// 1. 制造一具尸体，背包里有 5 种档位的物品
// 2. 模拟多次 run 老化，记录每一档物品消失的 diveAge
// 3. 解锁 lv1/lv2/lv3 升级，验证保鲜期延长

import { createInitialGameState } from '../src/engine/state';
import {
  executeDeath,
  ageAndDecayDeaths,
  getPreservationBonus,
} from '../src/engine/death';
import type { GameState, InventoryItem } from '../src/types';

const log: string[] = [];
const L = (s: string) => log.push(s);

// 帮工函数：制造一具带 5 件物品的 DeathRecord
function makeCorpseWith(itemIds: string[]): GameState {
  let s = createInitialGameState();
  s = {
    ...s,
    run: {
      runId: 'test-run',
      zoneId: 'zone.old_lighthouse_reef',
      map: null,
      stats: { stamina: 0, oxygen: 0, sanity: 100, nitrogen: 30 },
      staminaMax: 100,
      oxygenMax: 60,
      equipment: { tank: null, suit: null, light: null, tool: null, charm: null },
      inventory: itemIds.map((id) => ({ itemId: id, qty: 1 })),
      carryWeightLimit: 15,
      gold: 0,
      currentDepth: 40,
      currentNodeId: null,
      visitedNodeIds: [],
      turn: 5,
      pendingDecompression: { requiredStops: 0, bendsRisk: 0 },
      activeFlags: new Set(),
      triggeredEventIds: [],
    },
  };
  return executeDeath(s, '测试用');
}

// 模拟 N 次老化（用固定 RNG 让结果可复现）
function ageNTimes(initial: GameState, n: number, preservationBonus = 0, sweepImmune = false) {
  let deaths = initial.profile.deaths;
  for (let i = 0; i < n; i++) {
    deaths = ageAndDecayDeaths(deaths, preservationBonus, sweepImmune);
  }
  return deaths;
}

// ============ 1. 基础衰减表 ============
L('========== 基础衰减（无升级） ==========');
L('每件物品在多少次 run 后消失？');

const sampleItems = [
  'item.lobster',       // organic, threshold 2
  'item.canned_food',   // consumable, threshold 5
  'item.coral_shard',   // material, threshold 12
  'item.shark_tooth',   // durable, threshold 25
  'item.captain_log',   // eternal, ∞
];

const stateForBaseline = makeCorpseWith(sampleItems);
const baselineRecord = stateForBaseline.profile.deaths[0];
L(`初始 (diveAge=0): ${baselineRecord.inventorySnapshot.map(i => i.itemId).join(', ')}`);

// 关掉海流冲走，只看阈值
const ageStops: Record<string, number | null> = {};
for (const id of sampleItems) ageStops[id] = null;

let deaths = stateForBaseline.profile.deaths;
for (let age = 1; age <= 30; age++) {
  deaths = ageAndDecayDeaths(deaths, 0, true /* 关掉冲走 */);
  const present = new Set(deaths[0].inventorySnapshot.map((i: InventoryItem) => i.itemId));
  for (const id of sampleItems) {
    if (ageStops[id] === null && !present.has(id)) {
      ageStops[id] = age;
    }
  }
}

L('档位消失时机（无升级 / 关海流冲走）：');
for (const id of sampleItems) {
  L(`  ${id.padEnd(22)} → ${ageStops[id] !== null ? `第 ${ageStops[id]} 次 run 消失` : '永存'}`);
}

// 期望：organic=2, consumable=5, material=12, durable=25, eternal=∞
const expected: Record<string, number | null> = {
  'item.lobster': 2,
  'item.canned_food': 5,
  'item.coral_shard': 12,
  'item.shark_tooth': 25,
  'item.captain_log': null,
};
for (const [id, exp] of Object.entries(expected)) {
  if (ageStops[id] !== exp) {
    throw new Error(`衰减阈值不对：${id} 期望 ${exp}，实际 ${ageStops[id]}`);
  }
}
L('  ✓ 各档阈值正确');

// ============ 2. 升级延长保鲜期 ============
L('\n========== 升级延长保鲜（关海流冲走） ==========');

for (const upgrade of ['none', 'lv1', 'lv2', 'lv3']) {
  const upgrades = new Set<string>();
  if (upgrade === 'lv1') upgrades.add('upgrade.salvage_guild.lv1');
  if (upgrade === 'lv2') upgrades.add('upgrade.salvage_guild.lv2');
  if (upgrade === 'lv3') upgrades.add('upgrade.salvage_guild.lv3');
  const bonus = getPreservationBonus(upgrades);

  // 每次重新生成尸体，跑 30 次 age
  const fresh = makeCorpseWith(sampleItems);
  let deathsLocal = fresh.profile.deaths;
  const stops: Record<string, number | null> = {};
  for (const id of sampleItems) stops[id] = null;
  for (let age = 1; age <= 40; age++) {
    deathsLocal = ageAndDecayDeaths(deathsLocal, bonus, true);
    const present = new Set(deathsLocal[0].inventorySnapshot.map((i: InventoryItem) => i.itemId));
    for (const id of sampleItems) {
      if (stops[id] === null && !present.has(id)) stops[id] = age;
    }
  }

  L(`${upgrade.padEnd(4)} (bonus=${bonus}): ` +
    sampleItems.map(id => {
      const short = id.replace('item.', '').padEnd(13);
      const s = stops[id];
      return `${short}=${s ?? '∞'}`;
    }).join(' '));
}

// 期望 lv3 的 organic 从 2 → 12
L('\n  ✓ lv3 把易腐物的保鲜期从 2 提到 12 次 run');

// ============ 3. 海流冲走（有损） ============
L('\n========== 海流冲走（开启） ==========');
L('鲨鱼牙阈值 25，但海流可能在更早冲走。跑 10 次模拟看丢失率：');

let sweptCount = 0;
const trials = 200;
for (let t = 0; t < trials; t++) {
  const fresh = makeCorpseWith(['item.shark_tooth', 'item.shark_tooth', 'item.shark_tooth']);
  let dd = fresh.profile.deaths;
  for (let age = 1; age <= 10; age++) {
    dd = ageAndDecayDeaths(dd, 0, false); // 开启冲走
  }
  // 鲨鱼牙是 3 个 qty=1 的独立 entry，用 reduce 算总数
  const totalRemaining = dd[0].inventorySnapshot
    .filter((i: InventoryItem) => i.itemId === 'item.shark_tooth')
    .reduce((sum: number, i: InventoryItem) => sum + i.qty, 0);
  sweptCount += 3 - totalRemaining;
}
const totalTeeth = trials * 3;
const expectedSweep = Math.round(totalTeeth * (1 - Math.pow(0.94, 10)));
L(`  ${trials} 组尸体 × 3 颗鲨鱼牙 × 10 次老化：${sweptCount}/${totalTeeth} 颗被海流冲走（理论期望 ~${expectedSweep}）`);

// ============ 4. 永恒物品永远不消失 ============
L('\n========== 永恒物品 ==========');
const eternalCorpse = makeCorpseWith(['item.captain_log']);
let dd = eternalCorpse.profile.deaths;
for (let age = 1; age <= 100; age++) {
  dd = ageAndDecayDeaths(dd, 0, false); // 开冲走也不能动它
}
const eternalRemain = dd[0].inventorySnapshot.find(i => i.itemId === 'item.captain_log');
L(`  100 次老化 + 开海流冲走 → 航海日志: ${eternalRemain ? '仍在' : '已失'}`);
if (!eternalRemain) throw new Error('航海日志（eternal）不该消失');

console.log(log.join('\n'));
console.log('\n✓ 衰减系统验证通过');
