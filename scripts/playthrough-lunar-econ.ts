// 月相经济浮动验证（Phase 3 MVP · SPEC §8 · lunar-econ 车道）：
//   1. lunarPriceMultiplier 纯函数：确定性（同 day 同结果）
//   2. 乘子 BOUNDED：任意 day 结果 ∈ [0.8, 1.2]，收购价恒 > 0
//   3. 中性相位（waxing / waning）保留基线价：multiplier = 1.0
//   4. 非中性相位（new / full）实际偏离基线（有效浮动不为 0）
//   5. sellItemToMira 在不同月相产生不同实收金额（新月 > 平期 > 满月）
//   6. buyFromMira 买价同向随月相浮动（新月贵买·满月便宜买）
//   7. day=undefined 早期存档回退 1.0（不破旧档）
//
// 跑法：npx tsx scripts/playthrough-lunar-econ.ts

import {
  lunarPriceMultiplier,
  miraOfferFor,
  sellItemToMira,
  buyFromMira,
  isBuyableFromMira,
  miraBuyPriceFor,
} from '../src/engine/port';
import { lunarPhase } from '../src/engine/lunar';
import { createInitialGameState } from '../src/engine/state';
import type { GameState } from '../src/types';

const log: string[] = [];
const L = (s: string) => log.push(s);

function assert(cond: unknown, msg: string) {
  if (!cond) {
    console.error(log.join('\n'));
    throw new Error('断言失败：' + msg);
  }
}

// 月相代表日（LUNAR_CYCLE_DAYS=28，4 相各 7 天）
const DAY_NEW    = 2;  // 新月：day 0–6
const DAY_WAXING = 9;  // 上弦：day 7–13
const DAY_FULL   = 16; // 满月：day 14–20
const DAY_WANING = 23; // 下弦：day 21–27

// 验证相位分配正确
assert(lunarPhase(DAY_NEW)    === 'new',    `DAY_NEW=${DAY_NEW} 应是新月，实际 ${lunarPhase(DAY_NEW)}`);
assert(lunarPhase(DAY_WAXING) === 'waxing', `DAY_WAXING=${DAY_WAXING} 应是上弦，实际 ${lunarPhase(DAY_WAXING)}`);
assert(lunarPhase(DAY_FULL)   === 'full',   `DAY_FULL=${DAY_FULL} 应是满月，实际 ${lunarPhase(DAY_FULL)}`);
assert(lunarPhase(DAY_WANING) === 'waning', `DAY_WANING=${DAY_WANING} 应是下弦，实际 ${lunarPhase(DAY_WANING)}`);

// ============================================
// 1. 确定性：同 day → 同乘子
// ============================================
L('========== 1. lunarPriceMultiplier 确定性 ==========');
for (const day of [DAY_NEW, DAY_WAXING, DAY_FULL, DAY_WANING, 0, 27, 28, 100]) {
  const a = lunarPriceMultiplier(day);
  const b = lunarPriceMultiplier(day);
  L(`  day=${day} phase=${lunarPhase(day)} multiplier=${a}`);
  assert(a === b, `day=${day} 乘子应确定性：${a} ≠ ${b}`);
}

// ============================================
// 2. BOUNDED：任意 day 乘子 ∈ [0.8, 1.2]，且收购价 > 0
// ============================================
L('\n========== 2. 乘子 BOUNDED ∈ [0.8, 1.2] ==========');
const TEST_ITEM = 'item.shark_tooth'; // sellPrice 15 → baseOffer 12
const baseOffer = miraOfferFor(TEST_ITEM);
L(`  baseOffer(shark_tooth) = ${baseOffer}`);
assert(baseOffer > 0, '基线收购价必须 > 0（前提）');
for (let day = 0; day < 28 * 4; day++) {
  const m = lunarPriceMultiplier(day);
  assert(m >= 0.8 && m <= 1.2, `day=${day} 乘子 ${m} 超出 [0.8, 1.2]`);
  const price = Math.max(1, Math.floor(baseOffer * m));
  assert(price > 0, `day=${day} 收购价 ${price} 必须 > 0`);
}
L('  全 4 周期 (112 天) 乘子均在 [0.8, 1.2]，收购价恒 > 0 ✓');

// ============================================
// 3. 中性相位保留基线（multiplier = 1.0）
// ============================================
L('\n========== 3. 中性相位（waxing/waning）= 1.0 ==========');
const mWaxing = lunarPriceMultiplier(DAY_WAXING);
const mWaning = lunarPriceMultiplier(DAY_WANING);
L(`  waxing multiplier = ${mWaxing}（期望 1.0）`);
L(`  waning multiplier = ${mWaning}（期望 1.0）`);
assert(mWaxing === 1.0, `上弦 multiplier 应 1.0，实际 ${mWaxing}`);
assert(mWaning === 1.0, `下弦 multiplier 应 1.0，实际 ${mWaning}`);
// 中性相位收购价 = floor(baseOffer × 1.0) = baseOffer（整数不变）
const neutralPrice = Math.max(1, Math.floor(baseOffer * mWaxing));
assert(neutralPrice === baseOffer, `中性相位收购价应等于基线 ${baseOffer}，实际 ${neutralPrice}`);
L('  中性相位收购价 === 基线 ✓');

// ============================================
// 4. 非中性相位有效偏离基线
// ============================================
L('\n========== 4. 非中性相位偏离基线 ==========');
const mNew  = lunarPriceMultiplier(DAY_NEW);
const mFull = lunarPriceMultiplier(DAY_FULL);
L(`  new  multiplier = ${mNew}（期望 > 1.0）`);
L(`  full multiplier = ${mFull}（期望 < 1.0）`);
assert(mNew  > 1.0, `新月乘子应 > 1.0（当前 ${mNew}）`);
assert(mFull < 1.0, `满月乘子应 < 1.0（当前 ${mFull}）`);
// 方向性：新月出价高于满月
const priceNew  = Math.max(1, Math.floor(baseOffer * mNew));
const priceFull = Math.max(1, Math.floor(baseOffer * mFull));
L(`  新月收购价 ${priceNew} > 满月收购价 ${priceFull}（期望新月更高）`);
assert(priceNew > priceFull, `新月价 ${priceNew} 应 > 满月价 ${priceFull}`);

// ============================================
// 5. sellItemToMira 实收金额按月相浮动
// ============================================
L('\n========== 5. sellItemToMira 月相浮动 ==========');

function makeStateWithDay(day: number, gold = 0): GameState {
  const s = createInitialGameState();
  return {
    ...s,
    profile: {
      ...s.profile,
      day,
      bankedGold: gold,
      inventory: [{ itemId: TEST_ITEM, qty: 1 }],
    },
  };
}

const sNew    = sellItemToMira(makeStateWithDay(DAY_NEW),    TEST_ITEM, 1);
const sWaxing = sellItemToMira(makeStateWithDay(DAY_WAXING), TEST_ITEM, 1);
const sFull   = sellItemToMira(makeStateWithDay(DAY_FULL),   TEST_ITEM, 1);

const goldNew    = sNew.profile.bankedGold;
const goldWaxing = sWaxing.profile.bankedGold;
const goldFull   = sFull.profile.bankedGold;

L(`  新月实收  ${goldNew} 金`);
L(`  上弦实收  ${goldWaxing} 金（应 = baseOffer ${baseOffer}）`);
L(`  满月实收  ${goldFull} 金`);

// 中性相位收益 = 基线
assert(goldWaxing === baseOffer, `上弦实收应等于基线 ${baseOffer}，实际 ${goldWaxing}`);
// 新月 > 上弦 > 满月
assert(goldNew > goldWaxing, `新月实收 ${goldNew} 应 > 上弦 ${goldWaxing}`);
assert(goldWaxing >= goldFull, `上弦实收 ${goldWaxing} 应 ≥ 满月 ${goldFull}`);
L('  sellItemToMira 月相浮动方向正确 ✓');

// 同一天多次卖：结果确定性（调两次 makeStateWithDay 相同 day）
const sNew2 = sellItemToMira(makeStateWithDay(DAY_NEW), TEST_ITEM, 1);
assert(sNew.profile.bankedGold === sNew2.profile.bankedGold,
  `同 day=${DAY_NEW} sellItemToMira 结果必须确定性`);
L('  同 day 卖出确定性 ✓');

// ============================================
// 6. buyFromMira 买价同向浮动
// ============================================
L('\n========== 6. buyFromMira 月相浮动 ==========');
const BUY_ITEM = 'item.coral_shard'; // T1 可回购
assert(isBuyableFromMira(BUY_ITEM), `${BUY_ITEM} 必须可回购（前提）`);
const baseBuyPrice = miraBuyPriceFor(BUY_ITEM);
L(`  baseBuyPrice(coral_shard) = ${baseBuyPrice}`);

function makeStateForBuy(day: number, gold: number): GameState {
  const s = createInitialGameState();
  return {
    ...s,
    profile: {
      ...s.profile,
      day,
      bankedGold: gold,
      inventory: [],
    },
  };
}

const GOLD = 10000;
const bNew    = buyFromMira(makeStateForBuy(DAY_NEW,    GOLD), BUY_ITEM, 1);
const bWaxing = buyFromMira(makeStateForBuy(DAY_WAXING, GOLD), BUY_ITEM, 1);
const bFull   = buyFromMira(makeStateForBuy(DAY_FULL,   GOLD), BUY_ITEM, 1);

// 扣除金额 = 实际买价
const costNew    = GOLD - bNew.profile.bankedGold;
const costWaxing = GOLD - bWaxing.profile.bankedGold;
const costFull   = GOLD - bFull.profile.bankedGold;

L(`  新月买价 ${costNew} 金（应最高）`);
L(`  上弦买价 ${costWaxing} 金（应 = baseBuyPrice ${baseBuyPrice}）`);
L(`  满月买价 ${costFull} 金（应最低）`);

// 中性相位买价 = 基线
assert(costWaxing === baseBuyPrice,
  `上弦买价应等于基线 ${baseBuyPrice}，实际 ${costWaxing}`);
// 新月最贵、满月最便宜
assert(costNew > costWaxing, `新月买价 ${costNew} 应 > 上弦 ${costWaxing}`);
assert(costWaxing >= costFull, `上弦买价 ${costWaxing} 应 ≥ 满月 ${costFull}`);
L('  buyFromMira 月相浮动方向正确 ✓');

// 所有月相买入后仓库均有 1 件
const countInInv = (s: GameState, id: string) =>
  s.profile.inventory.find((i) => i.itemId === id)?.qty ?? 0;
assert(countInInv(bNew,    BUY_ITEM) === 1, '新月买入后仓库应有 1 珊瑚');
assert(countInInv(bWaxing, BUY_ITEM) === 1, '上弦买入后仓库应有 1 珊瑚');
assert(countInInv(bFull,   BUY_ITEM) === 1, '满月买入后仓库应有 1 珊瑚');
L('  买入后道具入库正确 ✓');

// ============================================
// 7. day=undefined 早期存档回退 1.0（纯函数层·旧档兜底）
// ============================================
L('\n========== 7. day=undefined 回退基线（不破旧档） ==========');
// lunarPriceMultiplier(undefined) 纯函数层断言：回退 1.0。
// 注：createInitialGameState() 的 profile.day 是 0（新月）而非 undefined——这是新游戏的正确行为。
// 旧档（hydrateGameState 前 profile 无 day 字段）才会到这里；纯函数层是唯一防线。
const mUndef = lunarPriceMultiplier(undefined);
L(`  lunarPriceMultiplier(undefined) = ${mUndef}（期望 1.0）`);
assert(mUndef === 1.0, `undefined day 应回退 1.0，实际 ${mUndef}`);
// 直接构造「剥掉 day 字段」的 profile 模拟旧档，断言 sellItemToMira 给基线价。
const sBase = createInitialGameState();
const sOldArchive = {
  ...sBase,
  profile: {
    ...sBase.profile,
    day: undefined as unknown as number, // 旧档：无 day 字段
    inventory: [{ itemId: TEST_ITEM, qty: 1 }],
  },
};
const afterSellOldArchive = sellItemToMira(sOldArchive, TEST_ITEM, 1);
const gotOldArchive = afterSellOldArchive.profile.bankedGold;
L(`  旧档（day=undefined）卖出 ${TEST_ITEM}：获得 ${gotOldArchive} 金（应 = 基线 ${baseOffer}）`);
assert(gotOldArchive === baseOffer, `旧档卖出应等于基线 ${baseOffer}，实际 ${gotOldArchive}`);
L('  day=undefined 回退中性（不破旧档） ✓');

console.log(log.join('\n'));
console.log('\n✓ playthrough-lunar-econ 完成（Phase 3 MVP · SPEC §8）');
