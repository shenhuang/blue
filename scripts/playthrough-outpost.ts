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
//  11. 多前哨链续（方向 D）：hadal_deep（超渊静水前哨）服务 subhadal（渊外 >180m）蛙跳、是最深起跳点
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
  getHomeLighthouse,
  revealRadius,
  outpostStage,
  outpostStageFlag,
  isOutpostLit,
  getOutpostDef,
  getOutposts,
  canAdvanceOutpost,
  devAdvanceOutpost,
  isChapterOutpost,
  isChapterBand,
  chapterOutpostForBand,
  outpostUnlocked,
  OUTPOST_MAX_STAGE,
  OUTPOST_USABLE_STAGE,
} from '../src/engine/lighthouses';
import { ch1AnchorFlag, CH1_ANCHORS, type Ch1Anchor } from '../src/engine/story';
import { getBand } from '../src/engine/bands';
import {
  outpostEnergy,
  effectiveOutpostBonuses,
  effectiveRevealRadius,
  outpostDecayLevel,
  effectiveOutpostStage,
  maintainOutpost,
  canMaintainOutpost,
  depotCapacity,
  effectiveStored,
  storedUnits,
  depotDecayLevel,
  depositToDepot,
  withdrawFromDepot,
  canDeposit,
  canWithdraw,
  DEPOT_LOSS_PER_LEVEL,
  OUTPOST_MAINTENANCE_COST,
  OUTPOST_BASE_ENERGY,
  OUTPOST_DECAY_MAX,
  OUTPOST_REVEAL_DECAY_SHRINK,
} from '../src/engine/outposts';
import { startDiveFromOutpost } from '../src/engine/dive';
import { isPoiVisible } from '../src/engine/chart';
import { isOptionVisible } from '../src/engine/events';
import { getEventById } from '../src/engine/zones';
import type { ChartPoi, GameState, InventoryItem } from '../src/types';

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
// 深前哨脊柱（home→reef_deep→trench_deep→abyssal_deep→hadal_deep）全员 3 阶段、band 单调更深
const SPINE = ['outpost.reef_deep', 'outpost.trench_deep', 'outpost.abyssal_deep', 'outpost.hadal_deep'];
for (const id of SPINE) {
  const d = getOutpostDef(id);
  assert(d, `0: ${id} 已注册`);
  assert(d!.stages.length === OUTPOST_MAX_STAGE, `0: ${id} stages 数 = OUTPOST_MAX_STAGE`);
}
const abyDef = getOutpostDef('outpost.abyssal_deep')!;
assert(abyDef.bandId === 'band.abyssal', '0: abyssal_deep 在 band.abyssal');
assert(abyDef.submerged && !abyDef.current, '0: abyssal_deep 水下·静水（无水力·base 能源 1）');
L(`  脊柱四前哨各 3 阶段；abyssal_deep @ band.abyssal（静水）✓`);
// 章节哨站批：三章节前哨（②③④锚点区）自洽——3 阶段、requiresAnchor 合法、band 是章节区 band、
// result id 全局唯一、深脊柱前哨不带 requiresAnchor（章节标记不污染脊柱）。
const CHAPTER_OUTPOSTS: Array<[string, Ch1Anchor, string]> = [
  ['outpost.ch1_wreck', 'wreck', 'band.ch1_wreck'],
  ['outpost.ch1_midwater', 'midwater', 'band.ch1_midwater'],
  ['outpost.ch1_vent', 'vent', 'band.ch1_vent'],
];
const allResultIds = getOutposts().map((o) => o.result.id);
assert(new Set(allResultIds).size === allResultIds.length, '0: 所有前哨 result.id 全局唯一');
for (const [oid, anchor, bandId] of CHAPTER_OUTPOSTS) {
  const cd = getOutpostDef(oid);
  assert(cd, `0: ${oid} 已注册`);
  assert(cd!.stages.length === OUTPOST_MAX_STAGE, `0: ${oid} 3 阶段`);
  assert(cd!.requiresAnchor === anchor, `0: ${oid} requiresAnchor=${anchor}`);
  assert(isChapterOutpost(cd!), `0: ${oid} 是章节前哨`);
  assert(cd!.bandId === bandId, `0: ${oid} @ ${bandId}`);
  assert(getBand(bandId), `0: 章节 band ${bandId} 已注册`);
  assert(isChapterBand(bandId), `0: ${bandId} 是章节区 band`);
  assert(chapterOutpostForBand(bandId)?.id === oid, `0: ${bandId} ↔ ${oid} 反查一致`);
  assert(CH1_ANCHORS.includes(anchor), `0: ${anchor} ∈ CH1_ANCHORS`);
}
// reef 锚点①由 home 灯塔覆盖、不设哨站（无 band.ch1_reef / 无 requiresAnchor=reef 的前哨）
assert(!getOutposts().some((o) => o.requiresAnchor === 'reef'), '0: 锚点①(reef)无哨站（home 灯塔覆盖）');
// 深脊柱前哨不带 requiresAnchor（章节标记不污染脊柱·不被章节网排除逻辑误伤）
for (const id of SPINE) assert(!isChapterOutpost(getOutpostDef(id)!), `0: 脊柱 ${id} 非章节前哨`);
L(`  三章节哨站（沉船/中层/热液）各 3 阶段·requiresAnchor·章节区 band 双向一致；reef 无哨站；脊柱不带章节标记 ✓`);

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

// ============================================================
// 10. 多前哨链续（方向 D）：hadal_deep（超渊·静水前哨）服务 subhadal（渊外 >180m）蛙跳、最深起跳点
//     #66/#67 模板：脊柱再延一段 home → reef_deep → trench_deep → hadal_deep，让 C 开的渊外 band 蛙跳可达
// ============================================================
L('\n========== 10. 多前哨链：hadal_deep → subhadal ==========');
const HADAL = 'outpost.hadal_deep';
const hdef = getOutpostDef(HADAL);
assert(hdef && hdef.bandId === 'band.hadal', '10: hadal_deep 在 band.hadal');
assert(hdef!.submerged && !hdef!.current, '10: hadal_deep 是静水(无 current)水下前哨——base 能源吃紧（最深的基地养不起几盏补给）');
assert(hdef!.stages.length === OUTPOST_MAX_STAGE, `10: hadal_deep 三阶段（${hdef!.stages.length}）`);
// 备半亮料：s1 beak×2 / s2 eel×4+brass×3 → beak2 eel4 brass3，gold 320
let sH = stateWith(
  [
    { itemId: 'item.cave_octopus_beak', qty: 2 },
    { itemId: 'item.eel_skin', qty: 4 },
    { itemId: 'item.brass_fitting', qty: 3 },
  ],
  320,
);
sH = advanceOutpost(sH, HADAL); // 1
sH = advanceOutpost(sH, HADAL); // 2 半亮
assert(outpostStage(sH.profile, HADAL) === OUTPOST_USABLE_STAGE, '10: hadal_deep 半亮');
const homeSub = startDiveFromOutpost(base, 'band.subhadal').run!.turn;
const hSub = startDiveFromOutpost(sH, 'band.subhadal').run!.turn;
assert(hSub < homeSub, `10: hadal_deep 半亮 → subhadal 蛙跳更省（home ${homeSub} → 超渊前哨 ${hSub}）`);
// hadal_deep（order5）不服务更浅的 abyssal（order4）——前哨须比目标更浅
const hAby = startDiveFromOutpost(sH, 'band.abyssal').run!.turn;
assert(hAby === homeAby, '10: hadal_deep（order5）不服务更浅的 abyssal（order4）');
// 三前哨都半亮 → subhadal 从最深的 hadal_deep 起跳
const allFlags = new Set([...sBoth.profile.flags, ...sH.profile.flags]);
const sAll: GameState = {
  ...sBoth,
  profile: {
    ...sBoth.profile,
    flags: allFlags,
    outpostState: { ...sBoth.profile.outpostState, ...sH.profile.outpostState },
  },
};
const allSub = startDiveFromOutpost(sAll, 'band.subhadal').run!.turn;
assert(allSub === hSub, '10: reef_deep+trench_deep+hadal_deep 都半亮 → subhadal 从最深的 hadal_deep 起跳');
L(`  hadal_deep 半亮服务 subhadal（home ${homeSub}→${hSub}）/ 不服务更浅 band / 三前哨选最深 ✓`);

// ============================================================
// 11. 真·reveal dimming（Phase 2b 收尾，方向 D）：前哨衰减 → 海图点亮半径收缩 → 远点重新隐没
//     home/废墟灯塔不受影响（既有 reveal 行为不变）。复用 §6 的 sE（reef_deep 已点亮 promote 出 RESULT_LH）。
// ============================================================
L('\n========== 11. 真 reveal dimming：衰减→海图变暗 ==========');
const lhRD = getLighthouse(sE.profile, RESULT_LH)!;
const fullR = revealRadius(lhRD);
// 零衰减 → 有效半径 = 原始 revealRadius
assert(effectiveRevealRadius(sE.profile, lhRD) === fullR, '11: 零衰减→有效半径=原始 revealRadius');
// 满衰减（runsCompleted+8）→ 缩到 (1 − SHRINK) 倍、永不归零
const dMaxR = atRuns(sE, 8);
assert(outpostDecayLevel(dMaxR.profile, OUTPOST) === OUTPOST_DECAY_MAX, '11: 封顶衰减');
const shrunkR = effectiveRevealRadius(dMaxR.profile, lhRD);
assert(Math.abs(shrunkR - fullR * (1 - OUTPOST_REVEAL_DECAY_SHRINK)) < 1e-9, `11: 满衰减→半径缩到 (1−${OUTPOST_REVEAL_DECAY_SHRINK}) 倍`);
assert(shrunkR > 0 && shrunkR < fullR, '11: 收缩但永不归零（结构还在）');
// 中度衰减单调：在原始与封顶之间
const dMidR = atRuns(sE, 4); // 衰减 2
const midR = effectiveRevealRadius(dMidR.profile, lhRD);
assert(midR < fullR && midR > shrunkR, '11: 中度衰减→半径在原始与封顶之间（单调收缩）');
// home 灯塔不是前哨 → 不受衰减影响（既有 reveal 逐字节不变）
const home = getHomeLighthouse(dMaxR.profile)!;
assert(effectiveRevealRadius(dMaxR.profile, home) === revealRadius(home), '11: home 灯塔无衰减·半径原样');
// 海图后果：在前哨外、满半径内、背向 home 方向放一个探针 POI → 满衰减时该远点重新隐没
const ax = lhRD.mapX - home.mapX, ay = lhRD.mapY - home.mapY;
const nrm = Math.hypot(ax, ay) || 1;
const probe: ChartPoi = {
  id: 'poi.__reveal_probe',
  zoneId: 'zone.blue_caves',
  name: '探针',
  blurb: '',
  distance: 1,
  mapX: lhRD.mapX + (ax / nrm) * fullR * 0.75,
  mapY: lhRD.mapY + (ay / nrm) * fullR * 0.75,
  persistent: false,
};
assert(isPoiVisible(sE.profile, probe), '11: 零衰减→前哨满半径点亮该远点');
assert(!isPoiVisible(dMaxR.profile, probe), '11: 满衰减→前哨光圈缩小·该远点重新隐没（海图变暗，须 re-ferry 补回）');
L(`  零衰减半径 ${fullR.toFixed(2)} → 满衰减 ${shrunkR.toFixed(2)}（单调收缩·永不归零）/ home 不受影响 / 远点重新隐没 ✓`);

// ============================================================
// 12. 材料中转/寄存（Phase 2b 续，方向 D）：存/取/容量/衰减损耗（派生·提交）/维护就近付料免金费/建造保留寄存
// ============================================================
L('\n========== 12. 材料中转/寄存 ==========');
// 起手：lit reef_deep（静水·decay .5）+ 建中转站 lv1（cap 6）。给足岸上料。
function litReefWithDepot(gold = 800): GameState {
  let s = stateWith(
    [
      { itemId: 'item.coral_shard', qty: 4 },
      { itemId: 'item.brass_fitting', qty: 12 },
      { itemId: 'item.crab_chitin', qty: 4 },
      { itemId: 'item.cave_octopus_beak', qty: 2 },
      { itemId: 'item.eel_skin', qty: 4 },
    ],
    gold,
  );
  s = advanceOutpost(s, OUTPOST);
  s = advanceOutpost(s, OUTPOST);
  s = advanceOutpost(s, OUTPOST); // 点亮
  s = buildAtLighthouse(s, RESULT_LH, 'lighthouse.depot.lv1'); // outpostOnly·storageCapacity 6
  return s;
}
const brassAt = (st: GameState) =>
  st.profile.inventory.find((i) => i.itemId === 'item.brass_fitting')?.qty ?? 0;

let sD = litReefWithDepot();
assert(depotCapacity(stateWith([], 0).profile, OUTPOST) === 0, '12: 未建中转站→容量 0');
assert(depotCapacity(sD.profile, OUTPOST) === 6, `12: 中转站 lv1→容量 6（实 ${depotCapacity(sD.profile, OUTPOST)}）`);
// 存料：从岸上仓库扣，进寄存
assert(canDeposit(sD.profile, OUTPOST, 'item.brass_fitting', 3).ok, '12: 可存 brass×3');
const brassBefore = brassAt(sD);
sD = depositToDepot(sD, OUTPOST, 'item.brass_fitting', 3);
assert(storedUnits(effectiveStored(sD.profile, OUTPOST)) === 3, '12: 存后寄存用量 3');
assert(brassAt(sD) === brassBefore - 3, '12: 存料从岸上仓库扣');
// 容量上限：room=3，存 eel×4 → full（no-op）；存 eel×3 → 填满
assert(!canDeposit(sD.profile, OUTPOST, 'item.eel_skin', 4).ok, '12: 超容量→full');
sD = depositToDepot(sD, OUTPOST, 'item.eel_skin', 4); // no-op
assert(storedUnits(effectiveStored(sD.profile, OUTPOST)) === 3, '12: 超容量存料 no-op');
sD = depositToDepot(sD, OUTPOST, 'item.eel_skin', 3); // 填满到 6
assert(storedUnits(effectiveStored(sD.profile, OUTPOST)) === 6, '12: 填满到容量 6');
assert(!canDeposit(sD.profile, OUTPOST, 'item.brass_fitting', 1).ok, '12: 满了→再存不下');
// 取料：回岸上仓库
sD = withdrawFromDepot(sD, OUTPOST, 'item.brass_fitting', 1);
assert(storedUnits(effectiveStored(sD.profile, OUTPOST)) === 5, '12: 取回 1→用量 5');
assert(brassAt(sD) === brassBefore - 3 + 1, '12: 取回的料进岸上仓库');
assert(!canWithdraw(sD.profile, OUTPOST, 'item.brass_fitting', 99).ok, '12: 取超量→不可');
// 衰减损耗（派生·未提交）：静水过 4 run → 损耗级 2 → 流失 2 单位；raw stored 不变
const decayed = atRuns(sD, 4);
assert(depotDecayLevel(decayed.profile, OUTPOST) === 2, `12: 静水过 4 run→寄存损耗级 2（实 ${depotDecayLevel(decayed.profile, OUTPOST)}）`);
assert(storedUnits(effectiveStored(decayed.profile, OUTPOST)) === 5 - 2 * DEPOT_LOSS_PER_LEVEL, '12: 损耗→有效寄存减少（派生）');
assert(storedUnits(sD.profile.outpostState![OUTPOST].stored) === 5, '12: raw stored 不变（损耗 derive-only·未提交）');
// 提交：在损耗态存料 → 烤入损耗 + 重置 storedRun → 不再继续流失
const committed = depositToDepot(decayed, OUTPOST, 'item.brass_fitting', 1);
assert(depotDecayLevel(committed.profile, OUTPOST) === 0, '12: 存料重置 storedRun→损耗归零');
assert(storedUnits(effectiveStored(committed.profile, OUTPOST)) === 5 - 2 + 1, '12: 提交损耗后再加新料（不复活已锈蚀）');
// 维护就近付料 → 免 ferry 金费（home 没钱没料也维护得起＝寄存的战略回报）
let sMd = litReefWithDepot(800);
sMd = depositToDepot(sMd, OUTPOST, 'item.brass_fitting', 2); // 寄存 brass 2
sMd = {
  ...sMd,
  profile: {
    ...sMd.profile,
    bankedGold: 5, // < 维护金费 20
    inventory: sMd.profile.inventory.filter((i) => i.itemId !== 'item.brass_fitting'), // 岸上无 brass
  },
};
const sMd2 = atRuns(sMd, 2); // 结构衰减 1（可维护）· 寄存损耗 1 → 有效 brass 1（仍覆盖维护 brass×1）
assert(outpostDecayLevel(sMd2.profile, OUTPOST) === 1, '12: maintain 前结构衰减 1');
assert(canMaintainOutpost(sMd2.profile, OUTPOST).ok, '12: 中转站覆盖维护料→可维护（即便没钱没岸上料）');
const sMd3 = maintainOutpost(sMd2, OUTPOST);
assert(sMd3.profile.bankedGold === 5, '12: 就近付料→免 ferry 金费（金不变）');
assert(outpostDecayLevel(sMd3.profile, OUTPOST) === 0, '12: 维护→结构衰减归零');
assert(storedUnits(effectiveStored(sMd3.profile, OUTPOST)) === 0, '12: 维护从中转站取走那 1 单位（eff 1−1=0）');
// 空中转站 → 走岸上料 + 全额 ferry 金费（既有行为不被免）
const sEmpty2 = atRuns(litReefWithDepot(800), 2);
const goldBefore = sEmpty2.profile.bankedGold;
const sEmpty3 = maintainOutpost(sEmpty2, OUTPOST);
assert(sEmpty3.profile.bankedGold === goldBefore - OUTPOST_MAINTENANCE_COST.gold, '12: 空中转站→走岸上料 + 全额 ferry 金费（不免）');
// 建造保留既有寄存（防御性：advanceOutpost 写 outpostState 不丢 stored/storedRun）
let sAdv = stateWith(
  [
    { itemId: 'item.coral_shard', qty: 4 },
    { itemId: 'item.brass_fitting', qty: 5 },
    { itemId: 'item.crab_chitin', qty: 2 },
  ],
  300,
);
sAdv = advanceOutpost(sAdv, OUTPOST); // stage 1
sAdv = {
  ...sAdv,
  profile: {
    ...sAdv.profile,
    outpostState: { [OUTPOST]: { maintainedRun: 0, stored: [{ itemId: 'item.brass_fitting', qty: 2 }], storedRun: 0 } },
  },
};
sAdv = advanceOutpost(sAdv, OUTPOST); // stage 2
const advEntry = sAdv.profile.outpostState![OUTPOST];
assert(advEntry.stored && storedUnits(advEntry.stored) === 2, '12: advanceOutpost 保留既有寄存（不丢 stored）');
assert(advEntry.maintainedRun === sAdv.profile.runsCompleted, '12: advanceOutpost 重置结构衰减计时');
L('  存/取/容量上限/衰减损耗（派生·提交不复活）/维护就近免金费/空站走岸上金费/建造保留寄存 ✓');

// ============================================================
// 13. abyssal_deep 蛙跳：脊柱补 abyssal 缺口——服务更深 band（hadal/subhadal）、不服务更浅、缩短预耗氧
// ============================================================
L('\n========== 13. abyssal_deep 蛙跳（补脊柱 abyssal 缺口） ==========');
const ABY = 'outpost.abyssal_deep';
const RESULT_ABY = 'lighthouse.abyssal_deep_outpost';
// 建到半亮（stage 2）：s1 beak×2/110 + s2 eel×3+brass×3/180
let sAby = stateWith(
  [
    { itemId: 'item.cave_octopus_beak', qty: 2 },
    { itemId: 'item.eel_skin', qty: 3 },
    { itemId: 'item.brass_fitting', qty: 3 },
  ],
  400,
);
sAby = advanceOutpost(sAby, ABY);
sAby = advanceOutpost(sAby, ABY); // 半亮 stage 2
assert(effectiveOutpostStage(sAby.profile, ABY) >= OUTPOST_USABLE_STAGE, '13: abyssal_deep 半亮可蛙跳');
assert(!hasLh(sAby, RESULT_ABY), '13: 半亮未点亮（stage 2 < 3）→ 未 push 灯塔');
const noOut = stateWith([], 0);
const homeHadal = startDiveFromOutpost(noOut, 'band.hadal').run!.turn;
const abyHadal = startDiveFromOutpost(sAby, 'band.hadal').run!.turn;
assert(abyHadal < homeHadal, `13: abyssal_deep 半亮→缩短 hadal 蛙跳预耗氧（home ${homeHadal}→${abyHadal}）`);
const homeSubB = startDiveFromOutpost(noOut, 'band.subhadal').run!.turn;
const abySub = startDiveFromOutpost(sAby, 'band.subhadal').run!.turn;
assert(abySub < homeSubB, '13: abyssal_deep 也缩短更深的 subhadal 蛙跳');
// 不服务更浅 band：trench_mouth（order 2 < abyssal order 4）→ 蛙跳点须更浅 → 仍从 home 起跳
const homeTM = startDiveFromOutpost(noOut, 'band.trench_mouth').run!.turn;
const abyTM = startDiveFromOutpost(sAby, 'band.trench_mouth').run!.turn;
assert(abyTM === homeTM, '13: abyssal_deep 不服务更浅的 trench_mouth（蛙跳点须更浅）');
L(`  abyssal_deep 半亮：hadal ${homeHadal}→${abyHadal} / subhadal 缩短 / 不服务 trench_mouth ✓`);

// ============================================================
// 14. 章节哨站批：解锁门（锚点 flag）+ dev 免解 + 章节蛙跳（显式起跳·不污染深脊柱）
// ============================================================
L('\n========== 14. 章节哨站：解锁门 / dev / 蛙跳 ==========');
const WRECK_OUT = 'outpost.ch1_wreck';
const WRECK_BAND = 'band.ch1_wreck';
const WRECK_LH = 'lighthouse.ch1_wreck_outpost';

// 备齐残骸前哨全程料（s1 coral×3/40 · s2 crab×2+brass×2/70 · s3 lantern×2/110）
function wreckStock(): GameState {
  return stateWith(
    [
      { itemId: 'item.coral_shard', qty: 3 },
      { itemId: 'item.crab_chitin', qty: 2 },
      { itemId: 'item.brass_fitting', qty: 2 },
      { itemId: 'item.lantern_gland', qty: 2 },
    ],
    400,
  );
}

// 14a 锁态：锚点 flag 未置 → outpostUnlocked false · canAdvance false · advanceOutpost 不动 stage
let sLock = wreckStock();
assert(!sLock.profile.flags.has(ch1AnchorFlag('wreck')), '14a: 起手无 wreck 锚点 flag');
assert(!outpostUnlocked(sLock.profile, WRECK_OUT), '14a: 暗（未解锁）');
assert(!canAdvanceOutpost(sLock.profile, WRECK_OUT), '14a: 锁态不可建（料够也不行）');
const sTryLocked = advanceOutpost(sLock, WRECK_OUT);
assert(outpostStage(sTryLocked.profile, WRECK_OUT) === 0, '14a: 锁态 advanceOutpost 不推进 stage');
assert(countInInventory(sTryLocked.profile.inventory, 'item.coral_shard') === 3, '14a: 锁态不扣料');
assert(sTryLocked.profile.bankedGold === 400, '14a: 锁态不扣金');

// 14b 置锚点 flag → 解锁 → 可建（料够）→ 三阶推进点亮
let sUnlk: GameState = {
  ...sLock,
  profile: { ...sLock.profile, flags: new Set([...sLock.profile.flags, ch1AnchorFlag('wreck')]) },
};
assert(outpostUnlocked(sUnlk.profile, WRECK_OUT), '14b: 锚点置位后解锁');
assert(canAdvanceOutpost(sUnlk.profile, WRECK_OUT), '14b: 解锁+料够 → 可建');
sUnlk = advanceOutpost(sUnlk, WRECK_OUT);
assert(outpostStage(sUnlk.profile, WRECK_OUT) === 1, '14b: 解锁后能推进');
assert(countInInventory(sUnlk.profile.inventory, 'item.coral_shard') === 0, '14b: 推进扣料');
sUnlk = advanceOutpost(sUnlk, WRECK_OUT);
sUnlk = advanceOutpost(sUnlk, WRECK_OUT);
assert(isOutpostLit(sUnlk.profile, WRECK_OUT), '14b: 三阶建满点亮');
assert(hasLh(sUnlk, WRECK_LH), '14b: 点亮 push 残骸前哨灯塔');

// 14c dev 免解：锁态直接 devAdvanceOutpost → 跳过门+跳过料，置 stage、不扣资源
let sDev = wreckStock();
assert(!outpostUnlocked(sDev.profile, WRECK_OUT), '14c: dev 前仍是锁态');
sDev = devAdvanceOutpost(sDev, WRECK_OUT);
assert(outpostStage(sDev.profile, WRECK_OUT) === 1, '14c: dev 免解锁推进一阶');
assert(countInInventory(sDev.profile.inventory, 'item.coral_shard') === 3, '14c: dev 不扣料');
assert(sDev.profile.bankedGold === 400, '14c: dev 不扣金');
sDev = devAdvanceOutpost(sDev, WRECK_OUT);
sDev = devAdvanceOutpost(sDev, WRECK_OUT);
assert(isOutpostLit(sDev.profile, WRECK_OUT), '14c: dev 三连点亮');
const sDevNoop = devAdvanceOutpost(sDev, WRECK_OUT);
assert(outpostStage(sDevNoop.profile, WRECK_OUT) === OUTPOST_MAX_STAGE, '14c: 已点亮 dev no-op');

// 14d 章节蛙跳：显式 launchOutpostId 从点亮的残骸前哨跳入本区 band，落到 wreck 区 zone
const litWreck = sDev; // dev 点亮的残骸前哨
const wreckBand = getBand(WRECK_BAND)!;
const dive = startDiveFromOutpost(litWreck, WRECK_BAND, { launchOutpostId: WRECK_OUT });
assert(dive.run, '14d: 蛙跳产生 run');
assert(dive.run!.zoneId === wreckBand.zoneId, `14d: 落到本区 zone（${wreckBand.zoneId}）`);

// 14e 章节网解耦：章节前哨不参与深脊柱 deepestOutpostLaunch——
// 即便点亮了残骸前哨，对深 band（trench_mouth）的蛙跳预耗氧与没有它时相同（没被误选为起跳点）。
const noOutpost = stateWith([], 0);
const baseTM = startDiveFromOutpost(noOutpost, 'band.trench_mouth').run!.turn;
const withWreckTM = startDiveFromOutpost(litWreck, 'band.trench_mouth').run!.turn;
assert(withWreckTM === baseTM, '14e: 章节前哨不污染深脊柱自动起跳（trench_mouth 预耗氧不变）');

// 14f 半亮门：未达 USABLE 的章节前哨，显式起跳忽略（退回 home stand-in）——与点亮版起跳点不同则预耗氧不同
let sChHalf = wreckStock();
sChHalf = { ...sChHalf, profile: { ...sChHalf.profile, flags: new Set([...sChHalf.profile.flags, ch1AnchorFlag('wreck')]) } };
sChHalf = advanceOutpost(sChHalf, WRECK_OUT); // stage 1 < USABLE(2)
assert(effectiveOutpostStage(sChHalf.profile, WRECK_OUT) < OUTPOST_USABLE_STAGE, '14f: stage1 未达半亮');
const diveHalf = startDiveFromOutpost(sChHalf, WRECK_BAND, { launchOutpostId: WRECK_OUT });
assert(diveHalf.run, '14f: 未半亮显式起跳被忽略·仍能蛙跳（退回 home）');
L('  锁态不可建/不扣料 → 锚点置位解锁建满 → dev 免解三连 → 章节蛙跳落本区 → 不污染深脊柱 → 半亮门 ✓');

console.log(log.join('\n'));
console.log(
  '\n✓ 深水前哨（Phase 2a 建造/蛙跳 + Phase 2b 能源/衰减/维护/寄存/多前哨链/reveal dimming + abyssal 脊柱 + 章节哨站批解锁门/dev/蛙跳）回归通过',
);
