// 深水前哨：跨 run 分阶段建造 + 真蛙跳出潜点回归（深水区 Phase 2a 脊柱 + Phase 2b 能源/衰减/多前哨链）。
// 覆盖：
//   1. advanceOutpost 三阶段推进（按当前阶段扣材料＋金币、置阶段 flag、进度靠 flag 持久）
//   2. 不够料 / 已点亮 → no-op（半亮扛过死亡：进度不退）
//   3. 点亮（OUTPOST_MAX_STAGE）→ promote：push 一座灯塔到 profile.lighthouses（复用 Phase C reveal/reach）
//   4. 真蛙跳出潜点：半亮（≥ USABLE）的前哨缩短**更深** band 的蛙跳预耗氧（run.turn）；本层/更浅 band 不受益
//   5. 建造事件 lighthouse.outpost_reef_deep 的阶段门控（isOptionVisible：每阶段只露当前阶段的选项）
//   6. 阶段进度 round-trip（flag 持久、不动存档形状、不 bump SAVE_VERSION）
//   —— Phase 2b ——
//   7. 能源：静水前哨 base 能源只够 1 个补给设施在线；占用超容量 → 设施掉线（不计加成）
//   8. 衰减：水下前哨按 run 累积衰减 → 容量缩（补给掉线＝变暗）/ 重度衰减回退有效阶段（蛙跳失效）
//   9. 维护（re-ferry）：扣账单、重置衰减计时；无衰减/未建不可维护
//  10. 多前哨链：trench_deep（水流前哨）服务 abyssal 蛙跳、不服务更浅 band、多前哨选最深起跳
//
// 跑法： npx tsx scripts/playthrough-outpost.ts

import {
  createInitialGameState,
  serializeGameState,
  deserializeGameState,
  countInInventory,
} from '../src/engine/state';
import {
  advanceOutpost,
  buildAtLighthouse,
  getLighthouse,
  outpostStage,
  outpostStageFlag,
  isOutpostLit,
  getOutpostDef,
  OUTPOST_MAX_STAGE,
  OUTPOST_USABLE_STAGE,
} from '../src/engine/lighthouses';
import {
  outpostEnergy,
  effectiveOutpostBonuses,
  outpostDecayLevel,
  effectiveOutpostStage,
  maintainOutpost,
  canMaintainOutpost,
  OUTPOST_BASE_ENERGY,
  OUTPOST_DECAY_MAX,
} from '../src/engine/outposts';
import { startDiveFromOutpost } from '../src/engine/dive';
import { isOptionVisible } from '../src/engine/events';
import { getEventById } from '../src/engine/zones';
import type { GameState, InventoryItem } from '../src/types';

const log: string[] = [];
const L = (s: string) => log.push(s);
function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    console.error(log.join('\n'));
    throw new Error('断言失败：' + msg);
  }
}

const OUTPOST = 'outpost.reef_deep';
const RESULT_LH = 'lighthouse.reef_deep_outpost';

function stateWith(inv: InventoryItem[], gold: number): GameState {
  const base = createInitialGameState();
  return {
    ...base,
    profile: { ...base.profile, inventory: inv.map((i) => ({ ...i })), bankedGold: gold },
  };
}
const hasLh = (s: GameState, id: string) => s.profile.lighthouses.some((l) => l.id === id);

// ============================================================
// 0. OutpostDef 自洽：stages 数 = OUTPOST_MAX_STAGE
// ============================================================
L('========== 0. OutpostDef 自洽 ==========');
const def = getOutpostDef(OUTPOST);
assert(def, '0: outpost.reef_deep 已注册');
assert(def!.stages.length === OUTPOST_MAX_STAGE, `0: stages 数(${def!.stages.length}) = OUTPOST_MAX_STAGE(${OUTPOST_MAX_STAGE})`);
assert(def!.bandId === 'band.reef_deep', '0: 前哨在 band.reef_deep');
L(`  「${def!.name}」${def!.stages.length} 阶段 @ ${def!.bandId} ✓`);

// ============================================================
// 1. 三阶段推进：扣料＋金、置 flag、点亮 promote
// ============================================================
L('\n========== 1. 三阶段推进 + promote ==========');
// 备齐全程料：s1 coral×4 / s2 brass×3+crab×2 / s3 beak×2+brass×2 → coral4 brass5 crab2 beak2, gold 300
let s = stateWith(
  [
    { itemId: 'item.coral_shard', qty: 4 },
    { itemId: 'item.brass_fitting', qty: 5 },
    { itemId: 'item.crab_chitin', qty: 2 },
    { itemId: 'item.cave_octopus_beak', qty: 2 },
  ],
  300,
);
assert(outpostStage(s.profile, OUTPOST) === 0, '1: 起手 stage 0');
assert(!hasLh(s, RESULT_LH), '1: 起手没有前哨灯塔');

// 阶段 1（勘察清理：coral×4 + 50 金）
s = advanceOutpost(s, OUTPOST);
assert(outpostStage(s.profile, OUTPOST) === 1, '1: 推进后 stage 1');
assert(s.profile.flags.has(outpostStageFlag(OUTPOST, 1)), '1: 置 s1 flag');
assert(countInInventory(s.profile.inventory, 'item.coral_shard') === 0, '1: coral 扣 4→0');
assert(s.profile.bankedGold === 250, '1: 金 300→250');
assert(!hasLh(s, RESULT_LH), '1: stage 1 还没 promote 灯塔');

// 阶段 2（运件：brass×3+crab×2 + 90 金）—— 半亮
s = advanceOutpost(s, OUTPOST);
assert(outpostStage(s.profile, OUTPOST) === 2, '1: 推进后 stage 2（半亮）');
assert(countInInventory(s.profile.inventory, 'item.brass_fitting') === 2, '1: brass 扣 3→剩 2');
assert(countInInventory(s.profile.inventory, 'item.crab_chitin') === 0, '1: crab 扣 2→0');
assert(s.profile.bankedGold === 160, '1: 金 250→160');
assert(!isOutpostLit(s.profile, OUTPOST), '1: 半亮还没点亮');
assert(!hasLh(s, RESULT_LH), '1: 半亮还没 promote 灯塔');

// 阶段 3（通电：beak×2+brass×2 + 140 金）—— 点亮 promote
s = advanceOutpost(s, OUTPOST);
assert(outpostStage(s.profile, OUTPOST) === 3, '1: 推进后 stage 3');
assert(isOutpostLit(s.profile, OUTPOST), '1: stage 3 = 点亮');
assert(countInInventory(s.profile.inventory, 'item.cave_octopus_beak') === 0, '1: beak 扣 2→0');
assert(countInInventory(s.profile.inventory, 'item.brass_fitting') === 0, '1: brass 再扣 2→0');
assert(s.profile.bankedGold === 20, '1: 金 160→20');
assert(hasLh(s, RESULT_LH), '1: 点亮 → promote 一座灯塔到 profile.lighthouses（reveal/reach）');
L('  stage 0→1→2→3：逐阶扣料＋金 / 置 flag / 点亮 promote 灯塔 ✓');

// ============================================================
// 2. 已点亮 + 不够料 → no-op（进度不退）
// ============================================================
L('\n========== 2. no-op（幂等 / 半亮扛死）==========');
const litLhCount = s.profile.lighthouses.length;
s = advanceOutpost(s, OUTPOST); // 已满
assert(outpostStage(s.profile, OUTPOST) === 3, '2: 已点亮再推进 → stage 仍 3');
assert(s.profile.lighthouses.length === litLhCount, '2: 不重复 push 灯塔（幂等）');

// 空仓推进 → no-op，stage 不动
let sPoor = stateWith([], 0);
sPoor = advanceOutpost(sPoor, OUTPOST);
assert(outpostStage(sPoor.profile, OUTPOST) === 0, '2: 不够料 → stage 仍 0（进度不退）');
assert(!sPoor.profile.flags.has(outpostStageFlag(OUTPOST, 1)), '2: 不够料 → 不置 flag');
// 推到 stage 1 后断料 → 停在 1（半亮扛过死亡：下次带够再来）
let sHalf = stateWith([{ itemId: 'item.coral_shard', qty: 4 }], 50);
sHalf = advanceOutpost(sHalf, OUTPOST); // stage 1
assert(outpostStage(sHalf.profile, OUTPOST) === 1, '2: stage 1 达成');
sHalf = advanceOutpost(sHalf, OUTPOST); // 没 s2 的料 → no-op
assert(outpostStage(sHalf.profile, OUTPOST) === 1, '2: 断料 → 停在 stage 1（不退、可续）');
L('  已满幂等 / 不够料不退 / 断料停在当前阶段 ✓');

// ============================================================
// 3. 真蛙跳出潜点：半亮前哨缩短更深 band 预耗氧
// ============================================================
L('\n========== 3. 蛙跳出潜点缩短预耗氧 ==========');
const base = createInitialGameState();
// 无前哨：trench_mouth 从 home（水面）起跳
const homeMouth = startDiveFromOutpost(base, 'band.trench_mouth');
const turnHome = homeMouth.run!.turn;
// 把前哨推到半亮（stage 2）：trench_mouth 从前哨（reef_deep 底 60m）起跳 → 更省
let sUsable = stateWith(
  [
    { itemId: 'item.coral_shard', qty: 4 },
    { itemId: 'item.brass_fitting', qty: 3 },
    { itemId: 'item.crab_chitin', qty: 2 },
  ],
  200,
);
sUsable = advanceOutpost(sUsable, OUTPOST); // 1
sUsable = advanceOutpost(sUsable, OUTPOST); // 2（半亮）
assert(outpostStage(sUsable.profile, OUTPOST) === OUTPOST_USABLE_STAGE, '3: 前哨半亮（USABLE）');
const opMouth = startDiveFromOutpost(sUsable, 'band.trench_mouth');
const turnOutpost = opMouth.run!.turn;
assert(turnOutpost < turnHome, `3: 半亮前哨缩短 trench_mouth 蛙跳预耗氧（home ${turnHome} → 前哨 ${turnOutpost}）`);
assert(opMouth.run!.stats.oxygen >= homeMouth.run!.stats.oxygen, '3: 省下的预耗氧反映在起手氧气上');
// 本层（reef_deep，order 同前哨）不受益：前哨必须比目标更浅
const opSelf = startDiveFromOutpost(sUsable, 'band.reef_deep');
const homeSelf = startDiveFromOutpost(base, 'band.reef_deep');
assert(opSelf.run!.turn === homeSelf.run!.turn, '3: 同层 band（reef_deep）不被同层前哨缩短（前哨须更浅）');
// 仅 stage 1（未达 USABLE）→ 不受益
let sStage1 = stateWith([{ itemId: 'item.coral_shard', qty: 4 }], 50);
sStage1 = advanceOutpost(sStage1, OUTPOST); // stage 1
const s1Mouth = startDiveFromOutpost(sStage1, 'band.trench_mouth');
assert(s1Mouth.run!.turn === turnHome, '3: stage 1（未半亮）→ 还不能当出潜点、预耗氧同 home');
L(`  trench_mouth：home ${turnHome} 回合 → 半亮前哨 ${turnOutpost} 回合 / 同层不受益 / stage1 未受益 ✓`);

// ============================================================
// 4. 建造事件阶段门控（isOptionVisible）
// ============================================================
L('\n========== 4. 建造事件阶段门控 ==========');
const ev = getEventById('lighthouse.outpost_reef_deep');
assert(ev, '4: 建造事件已注册');
assert((ev!.forbiddenFlags ?? []).includes(outpostStageFlag(OUTPOST, OUTPOST_MAX_STAGE)), '4: 点亮 flag 门控掉整个事件');
const optById = (id: string) => ev!.options.find((o) => o.id === id)!;
function visibleAt(stageState: GameState) {
  return {
    scout: isOptionVisible(stageState, optById('scout')),
    ferry: isOptionVisible(stageState, optById('ferry_parts')),
    power: isOptionVisible(stageState, optById('power_on')),
    leave: isOptionVisible(stageState, optById('leave')),
  };
}
// 用 flag 构造各阶段的 state（事件门控只读 profile.flags）
const stageState = (stage: number): GameState => {
  const flags = new Set<string>();
  for (let i = 1; i <= stage; i++) flags.add(outpostStageFlag(OUTPOST, i));
  return { ...base, profile: { ...base.profile, flags } };
};
const v0 = visibleAt(stageState(0));
assert(v0.scout && !v0.ferry && !v0.power && v0.leave, '4: stage 0 只露「勘察」(+leave)');
const v1 = visibleAt(stageState(1));
assert(!v1.scout && v1.ferry && !v1.power && v1.leave, '4: stage 1 只露「运件」(+leave)');
const v2 = visibleAt(stageState(2));
assert(!v2.scout && !v2.ferry && v2.power && v2.leave, '4: stage 2 只露「通电」(+leave)');
const v3 = visibleAt(stageState(3));
assert(!v3.scout && !v3.ferry && !v3.power && v3.leave, '4: stage 3 三个建造选项全隐（事件本身也被 forbiddenFlags 门掉）');
L('  每阶段只露当前阶段选项 / 点亮后事件门掉 ✓');

// ============================================================
// 5. 阶段进度 round-trip（flag 持久、不动存档形状）
// ============================================================
L('\n========== 5. 进度 round-trip ==========');
const round = deserializeGameState(serializeGameState(sUsable));
assert(round, '5: deserialize 不为 null');
assert(outpostStage(round!.profile, OUTPOST) === 2, '5: round-trip 后 stage 仍 2（flag 持久、未 bump SAVE_VERSION）');
assert(round!.version === 4, '5: SAVE_VERSION 仍为 4（未发布不迁移）');
L('  stage flag round-trip / SAVE_VERSION 4 不变 ✓');

// ============================================================
// 6. 能源（Phase 2b）：静水前哨 base 能源只够 1 个补给设施在线
// ============================================================
L('\n========== 6. 能源：静水前哨只够 1 个补给在线 ==========');
let sE = stateWith(
  [
    { itemId: 'item.coral_shard', qty: 4 },
    { itemId: 'item.brass_fitting', qty: 7 }, // 5 建造 + 2 充电桩
    { itemId: 'item.crab_chitin', qty: 4 }, // 2 建造 + 2 制氧机
    { itemId: 'item.cave_octopus_beak', qty: 2 },
    { itemId: 'item.eel_skin', qty: 1 }, // 充电桩
    { itemId: 'item.lantern_gland', qty: 1 }, // 制氧机
  ],
  500,
);
sE = advanceOutpost(sE, OUTPOST);
sE = advanceOutpost(sE, OUTPOST);
sE = advanceOutpost(sE, OUTPOST); // 点亮
assert(isOutpostLit(sE.profile, OUTPOST), '6: reef_deep 点亮');
sE = buildAtLighthouse(sE, RESULT_LH, 'lighthouse.recharge.lv1'); // 充电桩 draw1 / +20 电池
sE = buildAtLighthouse(sE, RESULT_LH, 'lighthouse.oxygen_supply.lv1'); // 制氧机 draw1 / +10 氧
const lhE = getLighthouse(sE.profile, RESULT_LH)!;
assert(
  lhE.builtUpgrades.has('lighthouse.recharge.lv1') &&
    lhE.builtUpgrades.has('lighthouse.oxygen_supply.lv1'),
  '6: 两个补给设施都建上',
);
const en = outpostEnergy(sE.profile, lhE);
assert(en.capacity === OUTPOST_BASE_ENERGY, `6: 静水前哨容量 = base ${OUTPOST_BASE_ENERGY}（无水力、无衰减）`);
assert(en.demand === 2, '6: 两个补给设施占用共 2');
const drawOnline = [...en.online].filter(
  (id) => id === 'lighthouse.recharge.lv1' || id === 'lighthouse.oxygen_supply.lv1',
);
assert(drawOnline.length === 1, `6: 容量 1 → 只能 1 个补给在线（实 ${drawOnline.length}）`);
const effE = effectiveOutpostBonuses(sE.profile, lhE);
const onlineSupplies = (effE.rechargeBonus > 0 ? 1 : 0) + (effE.oxygenSupply > 0 ? 1 : 0);
assert(onlineSupplies === 1, '6: 有效加成只反映 1 个在线补给设施（超容量的掉线）');
L(`  静水 reef_deep：容量 ${en.capacity} / 占用 ${en.demand} / 在线补给 ${drawOnline.length} ✓`);

// ============================================================
// 7. 衰减（Phase 2b）：容量缩（补给掉线）/ 重度衰减回退有效阶段（蛙跳失效）
// ============================================================
L('\n========== 7. 衰减：变暗 / 半亮回退 ==========');
const atRuns = (st: GameState, n: number): GameState => ({
  ...st,
  profile: { ...st.profile, runsCompleted: n },
});
assert(outpostDecayLevel(sE.profile, OUTPOST) === 0, '7: 刚建零衰减');
const d2 = atRuns(sE, 2); // elapsed 2，静水速率 .5 → 衰减 1
assert(outpostDecayLevel(d2.profile, OUTPOST) === 1, `7: 静水过 2 run → 衰减 1（实 ${outpostDecayLevel(d2.profile, OUTPOST)}）`);
const enD = outpostEnergy(d2.profile, getLighthouse(d2.profile, RESULT_LH)!);
assert(enD.capacity === OUTPOST_BASE_ENERGY - 1, '7: 衰减 1 → 容量 -1');
const effD = effectiveOutpostBonuses(d2.profile, getLighthouse(d2.profile, RESULT_LH)!);
assert(effD.rechargeBonus === 0 && effD.oxygenSupply === 0, '7: 容量被吃空 → 补给全掉线（变暗/补给减）');
const d8 = atRuns(sE, 8); // elapsed 8 → 衰减封顶
assert(outpostDecayLevel(d8.profile, OUTPOST) === OUTPOST_DECAY_MAX, '7: 久不维护 → 衰减封顶');
assert(
  effectiveOutpostStage(d8.profile, OUTPOST) < OUTPOST_USABLE_STAGE,
  '7: 重度衰减 → 有效阶段回退到 < USABLE（蛙跳失效）',
);
const d8Mouth = startDiveFromOutpost(d8, 'band.trench_mouth');
assert(d8Mouth.run!.turn === turnHome, '7: 重度衰减前哨 → trench_mouth 蛙跳退回 home 预耗氧');
L(`  衰减 0→1（过2run·容量-1·补给掉线）→ 封顶 ${OUTPOST_DECAY_MAX}（有效阶段回退·蛙跳失效）✓`);

// ============================================================
// 8. 维护（re-ferry）：扣账单、重置衰减；无衰减/未建不可维护
// ============================================================
L('\n========== 8. 维护重置衰减 ==========');
let sM: GameState = {
  ...d2,
  profile: { ...d2.profile, inventory: [{ itemId: 'item.brass_fitting', qty: 1 }], bankedGold: 50 },
};
assert(canMaintainOutpost(sM.profile, OUTPOST).ok, '8: 衰减 + 有料 → 可维护');
sM = maintainOutpost(sM, OUTPOST);
assert(outpostDecayLevel(sM.profile, OUTPOST) === 0, '8: 维护后衰减归 0');
assert(countInInventory(sM.profile.inventory, 'item.brass_fitting') === 0, '8: 扣维护料 brass×1');
assert(sM.profile.bankedGold === 30, '8: 扣维护金 20');
assert(!canMaintainOutpost(sM.profile, OUTPOST).ok, '8: 已维护（零衰减）→ 不可再维护（noDecay）');
assert(
  !canMaintainOutpost(createInitialGameState().profile, OUTPOST).ok,
  '8: 没建过的前哨不可维护',
);
L('  维护扣料＋金 / 衰减归 0 / 零衰减·未建不可维护 ✓');

// ============================================================
// 9. 多前哨链（Phase 2b）：trench_deep 服务 abyssal 蛙跳
// ============================================================
L('\n========== 9. 多前哨链：trench_deep → abyssal ==========');
const TRENCH = 'outpost.trench_deep';
const tdef = getOutpostDef(TRENCH);
assert(tdef && tdef.bandId === 'band.trench_throat', '9: trench_deep 在 band.trench_throat');
assert(tdef!.submerged && tdef!.current, '9: trench_deep 是水流(current)水下前哨');
let sT = stateWith(
  [
    { itemId: 'item.cave_octopus_beak', qty: 2 }, // s1
    { itemId: 'item.eel_skin', qty: 3 }, // s2
    { itemId: 'item.brass_fitting', qty: 3 }, // s2
  ],
  300,
);
sT = advanceOutpost(sT, TRENCH); // 1
sT = advanceOutpost(sT, TRENCH); // 2 半亮
assert(outpostStage(sT.profile, TRENCH) === OUTPOST_USABLE_STAGE, '9: trench_deep 半亮');
const homeAby = startDiveFromOutpost(base, 'band.abyssal').run!.turn;
const tAby = startDiveFromOutpost(sT, 'band.abyssal').run!.turn;
assert(tAby < homeAby, `9: trench_deep 半亮 → abyssal 蛙跳更省（home ${homeAby} → 竖井前哨 ${tAby}）`);
const tMouth = startDiveFromOutpost(sT, 'band.trench_mouth').run!.turn;
assert(tMouth === turnHome, '9: trench_deep（order3）不服务更浅的 trench_mouth（order2）');
// reef_deep + trench_deep 都半亮 → abyssal 从最深的 trench_deep 起跳
const bothFlags = new Set([...sUsable.profile.flags, ...sT.profile.flags]);
const sBoth: GameState = {
  ...sUsable,
  profile: {
    ...sUsable.profile,
    flags: bothFlags,
    outpostState: { ...sUsable.profile.outpostState, ...sT.profile.outpostState },
  },
};
const bothAby = startDiveFromOutpost(sBoth, 'band.abyssal').run!.turn;
assert(bothAby === tAby, '9: reef_deep + trench_deep 都半亮 → abyssal 从最深的 trench_deep 起跳');
L(`  trench_deep 半亮服务 abyssal（home ${homeAby}→${tAby}）/ 不服务更浅 band / 多前哨选最深 ✓`);

console.log(log.join('\n'));
console.log(
  '\n✓ 深水前哨（Phase 2a 建造/蛙跳 + Phase 2b 能源/衰减/维护/多前哨链）回归通过',
);
