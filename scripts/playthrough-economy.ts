// 经济系统验证：
//   1. profile.inventory 在 handleReturnToPort 后落账（含 eternal 长存）
//   2. computeLootValue 用 sellPrice × Mira 收购系数估算战利品价值
//   3. Mira 面板：listMiraSellables + sellItemToMira → bankedGold 增长
//   4. eternal / 0 售价物品不被收购，留在仓库
//   5. Mira 回购（基建地图 Phase A）：T1/T2 可买(买价>卖价)、T3/T4 不可买；
//      shopStock 限量 + 回港补货；金币买不了升级
//   6. 消耗品货架 + 出发前选带（猎手 SPEC §4·#108）：decoy 上架（同一套限量/加价）·
//      applyCarryItems 只认消耗品/夹库存/容量截断/不选原样·生还自动归库
//
// 跑法： npx tsx scripts/playthrough-economy.ts

import { createInitialGameState, createNewRun, countInInventory } from '../src/engine/state';
import { applyCarryItems } from '../src/engine/dive-start';
import {
  handleReturnToPort,
  listMiraSellables,
  miraOfferFor,
  isSellableToMira,
  sellItemToMira,
  buyFromMira,
  isBuyableFromMira,
  miraBuyPriceFor,
  maxShopStockFor,
  getShopStock,
  listMiraBuyables,
  MIRA_BUY_MARKUP,
} from '../src/engine/port';
import { canPurchase } from '../src/engine/upgrades';
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
  ['item.med_kit', 20], // floor(25 * 0.8)·#117 定价后可卖回（同 decoy 口径：有价消耗品她收）
];
for (const [id, expected] of priceTable) {
  const got = miraOfferFor(id);
  L(`  ${id.padEnd(24)} 期望 ${expected} 金 / 实际 ${got} 金`);
  assert(got === expected, `${id} Mira 收购价对不上：${got} ≠ ${expected}`);
}
L('  剧情物 / 无价物不收：');
const refused = ['item.captain_log', 'item.old_chart'];
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
      { itemId: 'item.med_kit', qty: 1 }, // #117 定价 25 → offer 20，计入 loot 价值
    ],
    currentDepth: 30,
  },
};

const expectedLootValue = 12 * 2 + 20 * 1 + 20 * 1; // sharkTooth + lobster + med_kit（#117）
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
  '急救包也该入仓库等玩家用',
);
L(`  profile.inventory: ${state.profile.inventory.map((i) => `${i.itemId}×${i.qty}`).join(', ')}`);

// 把 cutscene 当走完了：phase 回 port（这样后续才能开 Mira 柜台）
state = { ...state, phase: { kind: 'port' } };

// ============================================
// Phase 3: Mira 面板 —— listMiraSellables / sellItemToMira
// ============================================
L('\n========== Mira 柜台 ==========');
let sellables = listMiraSellables(state.profile.inventory);
L(`  可卖项：${sellables.length}（应为 3：shark_tooth + lobster + med_kit·#117 有价消耗品她收·同 decoy 口径）`);
assert(sellables.length === 3, '可卖项数不对');
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

// captain_log（eternal）不应被卖；med_kit #117 定价后可卖回（有价消耗品她收·同 decoy 口径）
const beforeRefuse = state.profile.bankedGold;
state = sellItemToMira(state, 'item.captain_log', 1);
assert(
  state.profile.bankedGold === beforeRefuse,
  'eternal 不该让 bankedGold 变化',
);
assert(
  findQty(state.profile.inventory, 'item.captain_log') === 1,
  'captain_log 还该留在仓库',
);
state = sellItemToMira(state, 'item.med_kit', 1);
L(`  卖回急救包：银行 = ${state.profile.bankedGold}（应 64）`);
assert(state.profile.bankedGold === 64, 'med_kit 卖回应 +20（offer = floor(25×0.8)·#117）');
assert(
  findQty(state.profile.inventory, 'item.med_kit') === 0,
  '卖回后急救包该被移出仓库',
);
L(`  拒收测试通过：captain_log 仍在仓库，银行 ${state.profile.bankedGold}`);

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

// ============================================
// Phase 5: Mira 回购（出售侧）—— 买价>卖价 / 分档门控 / shopStock 限量 + 回港补货
// ============================================
L('\n========== Mira 回购：买价 > 卖价 + 分档门控 ==========');
// 分档门控：T1/T2 可买，T3/T4 只卖不买
const buyGate: [string, boolean][] = [
  ['item.coral_shard', true], // T1
  ['item.shark_tooth', true], // T1
  ['item.brass_fitting', true], // T2
  ['item.crab_chitin', true], // T2
  ['item.eel_skin', false], // T3
  ['item.cave_octopus_beak', false], // T3
  ['item.lantern_gland', false], // T4
  ['item.med_kit', true], // 消耗品货架（#117 上架）
  ['item.captain_log', false], // 剧情物
];
for (const [id, expected] of buyGate) {
  const got = isBuyableFromMira(id);
  L(`  ${id.padEnd(24)} isBuyable=${got}（期望 ${expected}）`);
  assert(got === expected, `${id} 回购门控不对：${got} ≠ ${expected}`);
}
// 买价 = 卖价 × markup，恒 > 卖价
for (const id of ['item.coral_shard', 'item.brass_fitting', 'item.lobster']) {
  const sell = miraOfferFor(id);
  const buy = miraBuyPriceFor(id);
  L(`  ${id.padEnd(24)} 卖价 ${sell} / 买价 ${buy}（×${MIRA_BUY_MARKUP}）`);
  assert(buy === sell * MIRA_BUY_MARKUP, `${id} 买价应 = 卖价×${MIRA_BUY_MARKUP}`);
  assert(buy > sell, `${id} 买价必须 > 卖价`);
}
// T3/T4 买价 = 0（不可买）
assert(miraBuyPriceFor('item.eel_skin') === 0, 'T3 eel_skin 买价应为 0（不可买）');
assert(miraBuyPriceFor('item.lantern_gland') === 0, 'T4 lantern_gland 买价应为 0（不可买）');

L('\n========== Mira 回购：买入扣金 + 进仓库 ==========');
state = createInitialGameState();
state = { ...state, profile: { ...state.profile, bankedGold: 1000 } };
const coralBuy = miraBuyPriceFor('item.coral_shard'); // 8*2 = 16
const goldB = state.profile.bankedGold;
state = buyFromMira(state, 'item.coral_shard', 1);
L(`  买 1 珊瑚：银行 ${goldB} → ${state.profile.bankedGold}（应 -${coralBuy}）, 仓库 coral=${countInInventory(state.profile.inventory, 'item.coral_shard')}`);
assert(state.profile.bankedGold === goldB - coralBuy, '买 1 珊瑚应扣对应买价');
assert(countInInventory(state.profile.inventory, 'item.coral_shard') === 1, '买入的珊瑚应进仓库');
// T3 不可买 → no-op
const sBeforeT3 = state;
state = buyFromMira(state, 'item.eel_skin', 1);
assert(state === sBeforeT3, 'T3 eel_skin 不可买 → buyFromMira 应 no-op');

L('\n========== shopStock 限量 + 回港补货 ==========');
const coralMax = maxShopStockFor('item.coral_shard'); // 8
L(`  coral_shard 备货上限 = ${coralMax}`);
assert(coralMax === 8 && maxShopStockFor('item.brass_fitting') === 4, '备货上限：T1=8 / T2=4');
// 把珊瑚买空（已买 1，再买一大笔）
state = { ...state, profile: { ...state.profile, bankedGold: 100000 } };
state = buyFromMira(state, 'item.coral_shard', 999);
const coralStock = getShopStock(state.profile, 'item.coral_shard');
L(`  狂买后 coral 剩余备货 = ${coralStock}（应 0）, 仓库 coral=${countInInventory(state.profile.inventory, 'item.coral_shard')}（应 ${coralMax}）`);
assert(coralStock === 0, '买空后剩余备货应为 0');
assert(countInInventory(state.profile.inventory, 'item.coral_shard') === coralMax, `总共只能买到上限 ${coralMax} 个`);
// 售罄后再买 → no-op
const sBeforeSoldOut = state;
state = buyFromMira(state, 'item.coral_shard', 1);
assert(state === sBeforeSoldOut, '售罄后再买应 no-op');
// listMiraBuyables 反映余量
const buyablesNow = listMiraBuyables(state.profile);
const coralEntry = buyablesNow.find((b) => b.itemId === 'item.coral_shard')!;
assert(coralEntry && coralEntry.stock === 0 && coralEntry.maxStock === coralMax, 'listMiraBuyables 应反映 coral 余 0/上限');
assert(!buyablesNow.some((b) => b.itemId === 'item.eel_skin'), '回购清单不应含 T3 eel_skin');

// 回港补满：构造一次 run 走 handleReturnToPort，断言 shopStock 清空（= 满货）
state = { ...state, run: { ...createNewRun({ zoneId: 'zone.east_reef' }), inventory: [] } };
state = handleReturnToPort(state).state;
const coralStockAfterReturn = getShopStock(state.profile, 'item.coral_shard');
L(`  回港后 coral 备货 = ${coralStockAfterReturn}（应补满到 ${coralMax}）`);
assert(coralStockAfterReturn === coralMax, '回港应把 shopStock 补满');

L('\n========== 金币买不了升级（材料是硬门控） ==========');
// 满金 + 无材料 → canPurchase(tankhouse.lv1) 落 notEnoughMaterials，不是 ok / notEnoughGold
// （dockyard 已迁灯塔设施，用仍为全局的气瓶库验证"金币买不了升级"）
state = createInitialGameState();
state = { ...state, profile: { ...state.profile, bankedGold: 100000, inventory: [] } };
const upAvail = canPurchase(state.profile, 'upgrade.tankhouse.lv1');
L(`  满金空仓 canPurchase(tankhouse.lv1) = ${JSON.stringify(upAvail)}`);
assert(!upAvail.ok && upAvail.reason === 'notEnoughMaterials', '只有金币买不了升级（应 notEnoughMaterials）');

// ============================================
// Phase 6: 消耗品货架（猎手 SPEC §4·#108）+ 出发前选带闭环
// ============================================
L('\n========== Mira 消耗品货架（decoy + med_kit）·买价/限量 ==========');
// decoy 上架：买价 = floor(30×0.8)×2 = 48、备货 2；med_kit 上架（#117·负伤 SPEC §8「medkit 治伤」·
// 作者拍 sellPrice 25 → 买价 floor(25×0.8)×2 = 40、备货 2·价/量后续可调）——货架仍是显式白名单·材料门控不破
assert(isBuyableFromMira('item.decoy_sound') && isBuyableFromMira('item.decoy_light'), 'decoy 两种应可购');
assert(isBuyableFromMira('item.med_kit'), 'med_kit 上货架（负伤 SPEC §8·#117）');
assert(miraBuyPriceFor('item.decoy_sound') === Math.floor(30 * 0.8) * MIRA_BUY_MARKUP, 'decoy 买价沿同一套 offer×markup');
assert(miraBuyPriceFor('item.med_kit') === Math.floor(25 * 0.8) * MIRA_BUY_MARKUP, 'med_kit 买价沿同一套 offer×markup（=40）');
assert(maxShopStockFor('item.decoy_sound') === 2, 'decoy 备货上限 2（保命开销·不是无限弹药）');
assert(maxShopStockFor('item.med_kit') === 2, 'med_kit 备货上限 2（同货架口径）');
const shelfList = listMiraBuyables(state.profile);
assert(
  shelfList.some((b) => b.itemId === 'item.decoy_sound') && shelfList.some((b) => b.itemId === 'item.decoy_light'),
  'listMiraBuyables 应列出 decoy 货架',
);
assert(shelfList.some((b) => b.itemId === 'item.med_kit'), 'listMiraBuyables 应列出 med_kit');
state = buyFromMira(state, 'item.decoy_sound', 2);
assert(countInInventory(state.profile.inventory, 'item.decoy_sound') === 2, '买 2 枚声诱标进仓库');
assert(getShopStock(state.profile, 'item.decoy_sound') === 0, '货架剩 0（限量生效）');
L(`  decoy 买价 ${miraBuyPriceFor('item.decoy_light')} 金/枚 · 限量 2 · 买空 ✓`);

L('\n========== 出发前选带（applyCarryItems·作者拍板「不全带·死了就没」） ==========');
{
  // 仓库：2 声诱标 + 1 急救包 + 5 珊瑚（材料·不可随身）
  let s6 = state;
  s6 = {
    ...s6,
    profile: {
      ...s6.profile,
      inventory: [
        { itemId: 'item.decoy_sound', qty: 2 },
        { itemId: 'item.med_kit', qty: 1 },
        { itemId: 'item.coral_shard', qty: 5 },
      ],
    },
  };
  const r0 = createNewRun({ zoneId: 'zone.east_reef' });
  // 勾 1 声诱标 + 1 急救包 + 妄图带材料/超量 → 只有消耗品进 run、qty 夹库存
  const c1 = applyCarryItems(s6.profile, r0, [
    { itemId: 'item.decoy_sound', qty: 1 },
    { itemId: 'item.med_kit', qty: 99 },
    { itemId: 'item.coral_shard', qty: 5 },
  ]);
  assert(findQty(c1.run.inventory, 'item.decoy_sound') === 1, '选带 1 枚声诱标进 run');
  assert(findQty(c1.run.inventory, 'item.med_kit') === 1, '急救包 qty 夹到库存（99→1）');
  assert(findQty(c1.run.inventory, 'item.coral_shard') === 0, '材料不可随身（只认 consumable）');
  assert(findQty(c1.profile.inventory, 'item.decoy_sound') === 1, '仓库对应扣减（2→1）');
  assert(findQty(c1.profile.inventory, 'item.coral_shard') === 5, '仓库材料原样');
  // 没选 → 原对象原样（既有调用零变化）
  const c0 = applyCarryItems(s6.profile, r0, []);
  assert(c0.profile === s6.profile && c0.run === r0, '不选带 → profile/run 原对象（向后兼容）');
  // 容量截断：背包 8 格 → 勾超过 8 件只装 8
  let bigProfile = { ...s6.profile, inventory: [{ itemId: 'item.med_kit', qty: 20 }] };
  const cCap = applyCarryItems(bigProfile, r0, [{ itemId: 'item.med_kit', qty: 20 }]);
  assert(findQty(cCap.run.inventory, 'item.med_kit') === r0.inventoryCapacity, `超容量截断（只装 ${r0.inventoryCapacity}）`);
  // 生还闭环：随身没用完的 decoy 回港自动并回仓库（现有 handleReturnToPort 合并·零新代码）
  let s6back: GameState = { ...s6, profile: c1.profile, run: c1.run };
  s6back = handleReturnToPort(s6back).state;
  assert(findQty(s6back.profile.inventory, 'item.decoy_sound') === 2, '生还 → 没用的诱饵自动归库（1+1=2）');
  L('  只认消耗品 · qty 夹库存 · 容量截断 · 不选=原样 · 生还自动归库 ✓');
}

console.log(log.join('\n'));
console.log('\n✓ economy playthrough 完成');
console.log(`最终：银行 ${state.profile.bankedGold} 金 / 仓库 ${state.profile.inventory.length} 项`);
