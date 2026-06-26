// 衰减系统验证（月相 Phase 0b·按「天」·SPEC §2.2/§7）：
// 1. 基础衰减表：每档物品在第几天消失（age = profile.day − diedOnDay·纯派生）
// 2. 升级延长保鲜期（lv1/lv2/lv3）
// 3. 确定性海流冲走（取代旧每潜 Math.random）：确定性 + 单调 + **jump≡step**（一跳到第 N 天 ≡ 逐天走 N 次·路径无关）
// 4. 永恒物品永不消失
// 注：尸体超过 CORPSE_VISIBLE_AGE(25) 天散失（recovered=true）；snapshot 仍按当天 age 重算 ⇒ 内容路径无关。

import { createInitialGameState } from '../src/engine/state';
import { executeDeath, ageAndDecayDeaths, getPreservationBonus } from '../src/engine/death';
import type { GameState, DeathRecord } from '../src/types';

const log: string[] = [];
const L = (s: string) => log.push(s);
function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error('衰减验证失败：' + msg);
}

// 帮工：制造一具带物品的尸体（diedOnDay 由 executeDeath 种当天·此刻 age=0·确定性 id=death-0-test-run）
function makeCorpseWith(itemIds: string[]): GameState {
  let s = createInitialGameState();
  s = {
    ...s,
    run: {
      runId: 'test-run',
      zoneId: 'zone.old_lighthouse_reef',
      map: null,
      stats: { stamina: 0, oxygen: 0, sanity: 100, nitrogen: 30, thermalStress: 0 },
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

function idSet(record: DeathRecord): Set<string> {
  return new Set(record.inventorySnapshot.map((i) => i.itemId));
}
// 规范化快照（itemId×qty·排序）用于逐字节比较
function snapshotKey(record: DeathRecord): string {
  const totals = new Map<string, number>();
  for (const it of record.inventorySnapshot) totals.set(it.itemId, (totals.get(it.itemId) ?? 0) + it.qty);
  return [...totals.entries()].sort().map(([id, q]) => `${id}×${q}`).join(',');
}

const sampleItems = [
  'item.lobster', // organic, threshold 2
  'item.canned_food', // consumable, threshold 5
  'item.coral_shard', // material, threshold 12
  'item.shark_tooth', // durable, threshold 25
  'item.captain_log', // eternal, ∞
];

// ============ 1. 基础衰减表（无升级·关海流冲走） ============
L('========== 基础衰减（无升级·关海流冲走·按天） ==========');
{
  const base = makeCorpseWith(sampleItems);
  const diedOnDay = base.profile.deaths[0].diedOnDay;
  L(`初始 (age=0): ${[...idSet(base.profile.deaths[0])].join(', ')}`);

  const stops: Record<string, number | null> = {};
  for (const id of sampleItems) stops[id] = null;
  let deaths = base.profile.deaths;
  for (let age = 1; age <= 30; age++) {
    deaths = ageAndDecayDeaths(deaths, diedOnDay + age, 0, true /* 关冲走 */);
    const present = idSet(deaths[0]);
    for (const id of sampleItems) if (stops[id] === null && !present.has(id)) stops[id] = age;
  }
  L('档位消失时机（无升级 / 关海流冲走）：');
  for (const id of sampleItems) {
    L(`  ${id.padEnd(22)} → ${stops[id] !== null ? `第 ${stops[id]} 天消失` : '永存'}`);
  }
  const expected: Record<string, number | null> = {
    'item.lobster': 2,
    'item.canned_food': 5,
    'item.coral_shard': 12,
    'item.shark_tooth': 25,
    'item.captain_log': null,
  };
  for (const [id, exp] of Object.entries(expected)) {
    assert(stops[id] === exp, `衰减阈值不对：${id} 期望第 ${exp} 天，实际 ${stops[id]}`);
  }
  L('  ✓ 各档阈值正确（organic=2 / consumable=5 / material=12 / durable=25 / eternal=∞ 天）');
}

// ============ 2. 升级延长保鲜（关海流冲走） ============
L('\n========== 升级延长保鲜（关海流冲走·按天） ==========');
{
  const stopsByUpgrade: Record<string, Record<string, number | null>> = {};
  for (const upgrade of ['none', 'lv1', 'lv2', 'lv3']) {
    const upgrades = new Set<string>();
    if (upgrade === 'lv1') upgrades.add('upgrade.salvage_guild.lv1');
    if (upgrade === 'lv2') upgrades.add('upgrade.salvage_guild.lv2');
    if (upgrade === 'lv3') upgrades.add('upgrade.salvage_guild.lv3');
    const bonus = getPreservationBonus(upgrades);

    const fresh = makeCorpseWith(sampleItems);
    const diedOnDay = fresh.profile.deaths[0].diedOnDay;
    let deaths = fresh.profile.deaths;
    const stops: Record<string, number | null> = {};
    for (const id of sampleItems) stops[id] = null;
    for (let age = 1; age <= 40; age++) {
      deaths = ageAndDecayDeaths(deaths, diedOnDay + age, bonus, true);
      const present = idSet(deaths[0]);
      for (const id of sampleItems) if (stops[id] === null && !present.has(id)) stops[id] = age;
    }
    stopsByUpgrade[upgrade] = stops;
    L(
      `${upgrade.padEnd(4)} (bonus=${bonus}): ` +
        sampleItems
          .map((id) => `${id.replace('item.', '').padEnd(13)}=${stops[id] ?? '∞'}`)
          .join(' '),
    );
  }
  // lv3 把 organic（基 2）延到 12 天（注：snapshot 按天重算 ⇒ 阈值即便 > 可见年龄也可测）
  assert(
    stopsByUpgrade['lv3']['item.lobster'] === 12,
    `lv3 organic 应在第 12 天消失，实际 ${stopsByUpgrade['lv3']['item.lobster']}`,
  );
  L('  ✓ lv3 把易腐物保鲜期从 2 → 12 天');
}

// ============ 3. 确定性海流冲走 + jump≡step（SPEC §7·路径无关） ============
L('\n========== 确定性海流冲走 + jump≡step ==========');
{
  // (a) 确定性：同一尸体两次跑到同一天 → 逐字节相同（无 Math.random）
  const c1 = makeCorpseWith(sampleItems);
  const d1 = c1.profile.deaths[0].diedOnDay;
  const r1 = ageAndDecayDeaths(c1.profile.deaths, d1 + 18, 0, false);
  const r2 = ageAndDecayDeaths(c1.profile.deaths, d1 + 18, 0, false);
  assert(snapshotKey(r1[0]) === snapshotKey(r2[0]), '确定性：同输入两次结果应逐字节相同');
  L(`  ✓ 确定性（无 Math.random）：第 18 天快照两跑一致 = {${snapshotKey(r1[0])}}`);

  // (b) jump≡step：逐天走 N 次 == 一跳到第 N 天（开海流冲走·多 N 覆盖跨可见年龄 25 边界）
  for (const N of [5, 12, 18, 24, 30, 40]) {
    const cs = makeCorpseWith(sampleItems);
    const ds = cs.profile.deaths[0].diedOnDay;
    let stepDeaths = cs.profile.deaths;
    for (let k = 1; k <= N; k++) stepDeaths = ageAndDecayDeaths(stepDeaths, ds + k, 0, false);

    const cj = makeCorpseWith(sampleItems);
    const dj = cj.profile.deaths[0].diedOnDay;
    const jumpDeaths = ageAndDecayDeaths(cj.profile.deaths, dj + N, 0, false);

    assert(
      snapshotKey(stepDeaths[0]) === snapshotKey(jumpDeaths[0]),
      `jump≡step 破：第 ${N} 天 step={${snapshotKey(stepDeaths[0])}} ≠ jump={${snapshotKey(jumpDeaths[0])}}`,
    );
    assert(
      stepDeaths[0].recovered === jumpDeaths[0].recovered,
      `jump≡step 破：第 ${N} 天 recovered 标志不一致（step=${stepDeaths[0].recovered} jump=${jumpDeaths[0].recovered}）`,
    );
  }
  L('  ✓ jump≡step：第 5/12/18/24/30/40 天 逐天走 ≡ 一跳（快照 + recovered 均逐字节一致·跨 25 天散失边界）');

  // (c) 单调：一旦冲走/衰减永不复现（鲨鱼牙 durable·阈值 25）
  const cm = makeCorpseWith(['item.shark_tooth']);
  const dm = cm.profile.deaths[0].diedOnDay;
  let gone = -1;
  let deaths = cm.profile.deaths;
  for (let age = 1; age <= 25; age++) {
    deaths = ageAndDecayDeaths(deaths, dm + age, 0, false);
    const has = idSet(deaths[0]).has('item.shark_tooth');
    if (!has && gone < 0) gone = age;
    if (gone >= 0) assert(!has, `单调破：鲨鱼牙第 ${gone} 天消失后第 ${age} 天又出现`);
  }
  assert(gone > 0, '鲨鱼牙应在第 25 天内消失（冲走或阈值）');
  L(`  ✓ 单调：鲨鱼牙第 ${gone} 天消失后不再复现`);
}

// ============ 4. 永恒物品永不消失 ============
L('\n========== 永恒物品（开海流冲走也不动） ==========');
{
  const ce = makeCorpseWith(['item.captain_log']);
  const de = ce.profile.deaths[0].diedOnDay;
  const jumped = ageAndDecayDeaths(ce.profile.deaths, de + 100, 0, false); // 一跳第 100 天
  assert(idSet(jumped[0]).has('item.captain_log'), '航海日志（eternal）不该被冲走/衰减');
  L('  100 天 + 开海流冲走 → 航海日志：仍在 ✓');
}

console.log(log.join('\n'));
console.log('\n✓ 衰减系统验证通过（按天 · 确定性冲走 · jump≡step）');
