// 经济系统验证：
//   1. profile.inventory 在 handleReturnToPort 后落账（含 eternal 长存）
//   2. computeLootValue 用 sellPrice × Mira 收购系数估算战利品价值
//   3. Mira 面板：listMiraSellables + sellItemToMira → bankedGold 增长
//   4. eternal / 0 售价物品不被收购，留在仓库
//
// 跑法： npx tsx scripts/playthrough-economy.ts

import { createInitialGameState, createNewRun } from '../src/engine/state';
import {
  handleReturnToPort,
  listMiraSellables,
  miraOfferFor,
  isSellableToMira,
  sellItemToMira,
} from '../src/engine/port';
import { computeLootValue, executeAscent } from '../src/engine/ascent';
import type { GameState, InventoryItem } from '../src/types';

const log: string[] = [];
const L = (s: string) => log.push(s);

function assert(cond: unknown, msg: string) {
  if (!cond) {
    console.error(log.join('\n'));
    throw new Error('断言失败：' + msg);
  }
}

function findQty(inv: InventoryItem[], id: string): number {
  return inv.find((i) => i.itemId === id)?.qty ?? 0;
}

// ============================================
// Phase 1: Mira 收购单价基线
// ============================================
L('========== Mira 单价表 ==========');
const priceTable: [string, number][] = [
  ['item.shark_tooth', 12], // floor(15 * 0.8)
  ['item.coral_shard', 8], // floor(10 * 0.8)
  ['item.lobster', 20], // floor(25 * 0.8)
  ['item.canned_food', 6], // floor(8 * 0.8)
  ['item.old_fishing_net', 9], // floor(12 * 0.8)
];
for (const [id, expected] of priceTable) {
  const got = miraOfferFor(id);
  L(`  ${id.padEnd(24)} 期望 ${expected} 金 / 实际 ${got} 金`);
  assert(got === expected, `${id} Mira 收购价对不上：${got} ≠ ${expected}`);
}
L('  剧情物 / 消耗品不收：');
const refused = ['item.captain_log', 'item.marker_buoy', 'item.med_kit'];
for (const id of refused) {
  const ok = isSellableToMira(id);
  L(`    ${id.padEnd(24)} isSellable=${ok}`);
  assert(!ok, `${id} 不应该被 Mira 收购`);
}

// ============================================
// Phase 2: 构造一次 run 的战利品 + handleReturnToPort
// ============================================
L('\n========== 回港：run.inventory → profile.inventory ==========');
let state: GameState = createInitialGameState();

// 模拟一次成功上浮：构造 run，inventory 里有材料 + 剧情物 + 消耗品
state = {
  ...state,
  run: {
    ...createNewRun({ zoneId: 'zone.east_reef' }),
    inventory: [
      { itemId: 'item.shark_tooth', qty: 2 },
      { itemId: 'item.lobster', qty: 1 },
      { itemId: 'item.captain_log', qty: 1 }, // eternal，进仓库长存
      { itemId: 'item.med_kit', qty: 1 }, // sellPrice 0，留用
    ],
    currentDepth: 30,
  },
};

const expectedLootValue = 12 * 2 + 20 * 1; // sharkTooth + lobster
const lv = computeLootValue(state.run!);
L(`  computeLootValue = ${lv}（期望 ${expectedLootValue}）`);
assert(lv === expectedLootValue, `lootValue 不对：${lv} ≠ ${expectedLootValue}`);

const ret = handleReturnToPort(state);
state = ret.state;
L(`  cutsceneEventId = ${ret.cutsceneEventId}`);
assert(
  ret.cutsceneEventId === 'tutorial.ending_log',
  'captain_log 该自动触发 tutorial.ending_log',
);
assert(state.run === null, 'handleReturnToPort 后 run 必须 null');
assert(
  findQty(state.profile.inventory, 'item.shark_tooth') === 2,
  '鲨鱼牙没合并到仓库',
);
assert(
  findQty(state.profile.inventory, 'item.lobster') === 1,
  '龙虾没合并到仓库',
);
assert(
  findQty(state.profile.inventory, 'item.captain_log') === 1,
  'eternal captain_log 必须长存到 profile.inventory',
);
assert(
  findQty(state.profile.inventory, 'item.med_kit') === 1,
  '急救包（sellPrice=0）也该入仓库等玩家用',
);
L(`  profile.inventory: ${state.profile.inventory.map((i) => `${i.itemId}×${i.qty}`).join(', ')}`);

// 把 cutscene 当走完了：phase 回 port（这样后续才能开 Mira 柜台）
state = { ...state, phase: { kind: 'port' } };

// ============================================
// Phase 3: Mira 面板 —— listMiraSellables / sellItemToMira
// ============================================
L('\n========== Mira 柜台 ==========');
let sellables = listMiraSellables(state.profile.inventory);
L(`  可卖项：${sellables.length}（应为 2：shark_tooth + lobster）`);
assert(sellables.length === 2, '可卖项数不对');
const totalOffer = sellables.reduce((a, b) => a + b.total, 0);
L(`  柜台总价：${totalOffer} 金（期望 ${expectedLootValue}）`);
assert(totalOffer === expectedLootValue, '柜台总价对不上 computeLootValue');

// 卖 1 个鲨鱼牙
const goldBefore = state.profile.bankedGold;
state = sellItemToMira(state, 'item.shark_tooth', 1);
L(
  `  卖 1 鲨鱼牙：银行 ${goldBefore} → ${state.profile.bankedGold}（应 +${12}）`,
);
assert(state.profile.bankedGold - goldBefore === 12, '鲨鱼牙单价不对');
assert(
  findQty(state.profile.inventory, 'item.shark_tooth') === 1,
  '卖完后鲨鱼牙剩余该是 1',
);

// 卖光剩下的鲨鱼牙
state = sellItemToMira(state, 'item.shark_tooth', 99);
L(`  全卖鲨鱼牙：银行 = ${state.profile.bankedGold}（应 24）`);
assert(state.profile.bankedGold === 24, '鲨鱼牙总收益应为 24');
assert(
  findQty(state.profile.inventory, 'item.shark_tooth') === 0,
  '卖光后鲨鱼牙该被移出 inventory',
);

// 卖龙虾
state = sellItemToMira(state, 'item.lobster', 1);
L(`  卖 1 龙虾：银行 = ${state.profile.bankedGold}（应 44）`);
assert(state.profile.bankedGold === 44, '龙虾收益对不上');

// captain_log / med_kit 不应被卖
const beforeRefuse = state.profile.bankedGold;
state = sellItemToMira(state, 'item.captain_log', 1);
state = sellItemToMira(state, 'item.med_kit', 1);
assert(
  state.profile.bankedGold === beforeRefuse,
  'eternal / sellPrice=0 不该让 bankedGold 变化',
);
assert(
  findQty(state.profile.inventory, 'item.captain_log') === 1,
  'captain_log 还该留在仓库',
);
assert(
  findQty(state.profile.inventory, 'item.med_kit') === 1,
  '急救包还该留在仓库',
);
L(`  拒收测试通过：captain_log / med_kit 仍在仓库，银行 ${state.profile.bankedGold}`);

// 卖空仓库后 listMiraSellables 应空
sellables = listMiraSellables(state.profile.inventory);
L(`  柜台清空后剩余可卖项：${sellables.length}`);
assert(sellables.length === 0, '材料卖光后 sellables 应为空');

// ============================================
// Phase 4: 真的跑一次 executeAscent，确认 outcome.lootValue 走通
// ============================================
L('\n========== 真上浮 → outcome.lootValue ==========');
state = createInitialGameState();
state = {
  ...state,
  run: {
    ...createNewRun({ zoneId: 'zone.east_reef' }),
    inventory: [
      { itemId: 'item.shark_tooth', qty: 1 },
      { itemId: 'item.coral_shard', qty: 3 },
    ],
    currentDepth: 20,
    visitedNodeIds: ['n0', 'n1'],
  },
};
const ascR = executeAscent(state, 'normal');
state = ascR.state;
assert(state.phase.kind === 'resolution', '上浮后应到 resolution');
const out = (state.phase as { kind: 'resolution'; outcome: any }).outcome;
const expected = 12 * 1 + 8 * 3;
L(`  outcome.lootValue = ${out.lootValue}（期望 ${expected}）`);
assert(out.lootValue === expected, 'outcome.lootValue 不对');
L(`  outcome.goldEarned = ${out.goldEarned}（run.gold = 0 → 应 0）`);
assert(out.goldEarned === 0, 'goldEarned 应只反映 run.gold（事件给的），不含 lootValue');

console.log(log.join('\n'));
console.log('\n✓ economy playthrough 完成');
console.log(`最终：银行 ${state.profile.bankedGold} 金 / 仓库 ${state.profile.inventory.length} 项`);
