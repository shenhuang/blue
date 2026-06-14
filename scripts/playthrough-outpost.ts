// 深水前哨：跨 run 分阶段建造 + 真蛙跳出潜点回归（深水区 Phase 2a 脊柱 + Phase 2b 能源/多前哨链）。
// 覆盖：
//   1. advanceOutpost 三阶段推进（按当前阶段扣材料＋金币、置阶段 flag、进度靠 flag 持久）
//   2. 不够料 / 已点亮 → no-op（半亮扛过死亡：进度不退）
//   3. 点亮（OUTPOST_MAX_STAGE）→ promote：push 一座灯塔到 profile.lighthouses（复用 Phase C reveal）
//   4. 蛙跳出潜点：每次蛙跳都从第 0 回合起算（无 turn 偏移 / 路上耗气·作者 2026-06-14 删距离预耗氧）
//   5. 建造事件 lighthouse.outpost_reef_deep 的阶段门控（isOptionVisible：每阶段只露当前阶段的选项）
//   6. 阶段进度 round-trip（flag 持久、不动存档形状、不 bump SAVE_VERSION）
//   —— Phase 2b ——
//   6. 能源：静水前哨 base 能源只够 1 个补给设施在线；占用超容量 → 设施掉线（不计加成）
//      （衰减/维护已删·CHANGELOG #125：前哨一次性基建、建成长亮·不随 run 荒废）
//   9. 多前哨链：trench_deep（水流前哨）能蛙跳 abyssal、不污染更浅 band（仍从第 0 回合起算）
//  10. 多前哨链续（方向 D）：hadal_deep（超渊静水前哨）能蛙跳 subhadal（渊外 >180m）
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
  devUnlockChapterRegion,
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
  OUTPOST_BASE_ENERGY,
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
// 3. 蛙跳出潜点：每次下潜都从第 0 回合起算（距离预耗氧已删·作者 2026-06-14）
// ============================================================
L('\n========== 3. 蛙跳出潜点从第 0 回合起算 ==========');
const base = createInitialGameState();
// 无前哨：trench_mouth 蛙跳（home stand-in）从第 0 回合起算
const homeMouth = startDiveFromOutpost(base, 'band.trench_mouth');
assert(homeMouth.run!.turn === 0, '3: 无前哨蛙跳从第 0 回合起算（无 turn 偏移）');
// 把前哨推到半亮（stage 2）：仍是半亮（USABLE）态，供后续 round-trip / 多前哨链复用
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
// 半亮前哨蛙跳更深 band 同样从第 0 回合起算（不再有「前哨缩短预耗氧」）
const opMouth = startDiveFromOutpost(sUsable, 'band.trench_mouth');
assert(opMouth.run!.turn === 0, '3: 半亮前哨蛙跳同样从第 0 回合起算（距离预耗氧已删）');
L('  trench_mouth：无前哨/半亮前哨蛙跳一律从第 0 回合起算 ✓');

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
const en = outpostEnergy(lhE);
assert(en.capacity === OUTPOST_BASE_ENERGY, `6: 静水前哨容量 = base ${OUTPOST_BASE_ENERGY}（无水力）`);
assert(en.demand === 2, '6: 两个补给设施占用共 2');
const drawOnline = [...en.online].filter(
  (id) => id === 'lighthouse.recharge.lv1' || id === 'lighthouse.oxygen_supply.lv1',
);
assert(drawOnline.length === 1, `6: 容量 1 → 只能 1 个补给在线（实 ${drawOnline.length}）`);
const effE = effectiveOutpostBonuses(lhE);
const onlineSupplies = (effE.rechargeBonus > 0 ? 1 : 0) + (effE.oxygenSupply > 0 ? 1 : 0);
assert(onlineSupplies === 1, '6: 有效加成只反映 1 个在线补给设施（超容量的掉线）');
L(`  静水 reef_deep：容量 ${en.capacity} / 占用 ${en.demand} / 在线补给 ${drawOnline.length} ✓`);

// ============================================================
// （原 §7 衰减 / §8 维护 已随系统删除·CHANGELOG #125：前哨建成长亮、不锈蚀、无 re-ferry）
// ============================================================

// ============================================================
// 9. 多前哨链（Phase 2b）：trench_deep 可蛙跳 abyssal（脊柱自洽 + 蛙跳从第 0 回合起算）
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
// 蛙跳从第 0 回合起算（距离预耗氧已删·作者 2026-06-14）：半亮前哨不再缩短预耗氧
assert(startDiveFromOutpost(sT, 'band.abyssal').run!.turn === 0, '9: trench_deep 蛙跳 abyssal 从第 0 回合起算');
// reef_deep + trench_deep 都半亮的合并态（供 §10 三前哨链复用）
const bothFlags = new Set([...sUsable.profile.flags, ...sT.profile.flags]);
const sBoth: GameState = {
  ...sUsable,
  profile: {
    ...sUsable.profile,
    flags: bothFlags,
    outpostState: { ...sUsable.profile.outpostState, ...sT.profile.outpostState },
  },
};
assert(startDiveFromOutpost(sBoth, 'band.abyssal').run!.turn === 0, '9: 多前哨半亮蛙跳 abyssal 仍从第 0 回合起算');
L('  trench_deep 半亮 / 多前哨合并态蛙跳 abyssal 一律从第 0 回合起算 ✓');

// ============================================================
// 10. 多前哨链续（方向 D）：hadal_deep（超渊·静水前哨）可蛙跳 subhadal（渊外 >180m）
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
// 蛙跳从第 0 回合起算（距离预耗氧已删·作者 2026-06-14）
assert(startDiveFromOutpost(sH, 'band.subhadal').run!.turn === 0, '10: hadal_deep 蛙跳 subhadal 从第 0 回合起算');
// 三前哨都半亮的合并态：蛙跳同样从第 0 回合起算
const allFlags = new Set([...sBoth.profile.flags, ...sH.profile.flags]);
const sAll: GameState = {
  ...sBoth,
  profile: {
    ...sBoth.profile,
    flags: allFlags,
    outpostState: { ...sBoth.profile.outpostState, ...sH.profile.outpostState },
  },
};
assert(startDiveFromOutpost(sAll, 'band.subhadal').run!.turn === 0, '10: 三前哨半亮合并态蛙跳 subhadal 仍从第 0 回合起算');
L('  hadal_deep 半亮 / 三前哨合并态蛙跳 subhadal 一律从第 0 回合起算 ✓');

// ============================================================
// 11. reveal 半径恒定（衰减删除后既有 reveal 行为不变）：前哨灯塔半径 = 裸 revealRadius·home/废墟同理。
//     复用 §6 的 sE（reef_deep 已点亮 promote 出 RESULT_LH）。
// ============================================================
L('\n========== 11. reveal 半径恒定 ==========');
const lhRD = getLighthouse(sE.profile, RESULT_LH)!;
const fullR = revealRadius(lhRD);
assert(fullR > 0, '11: 前哨灯塔有正 reveal 半径');
// 海图后果：在前哨外、满半径内、背向 home 方向放一个探针 POI → 前哨满半径点亮该远点
const home = getHomeLighthouse(sE.profile)!;
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
assert(isPoiVisible(sE.profile, probe), '11: 前哨满半径点亮该远点（reveal 恒定·不随 run 收缩）');
L(`  前哨 reveal 半径 ${fullR.toFixed(2)}（恒定·不衰减）/ 满半径点亮远点 ✓`);

// ============================================================
// 13. abyssal_deep 蛙跳：脊柱补 abyssal 缺口——半亮可蛙跳更深 band（hadal/subhadal），从第 0 回合起算
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
assert(outpostStage(sAby.profile, ABY) >= OUTPOST_USABLE_STAGE, '13: abyssal_deep 半亮可蛙跳');
assert(!hasLh(sAby, RESULT_ABY), '13: 半亮未点亮（stage 2 < 3）→ 未 push 灯塔');
// 蛙跳从第 0 回合起算（距离预耗氧已删·作者 2026-06-14）：半亮 abyssal_deep 蛙跳更深 band 不再缩短预耗氧
assert(startDiveFromOutpost(sAby, 'band.hadal').run!.turn === 0, '13: abyssal_deep 蛙跳 hadal 从第 0 回合起算');
assert(startDiveFromOutpost(sAby, 'band.subhadal').run!.turn === 0, '13: abyssal_deep 蛙跳 subhadal 从第 0 回合起算');
L('  abyssal_deep 半亮（未点亮·未 push 灯塔）/ 蛙跳 hadal·subhadal 一律从第 0 回合起算 ✓');

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

// 14e 章节网解耦：章节前哨不参与深脊柱 deepestOutpostLaunch——即便点亮了残骸前哨，对深 band
// （trench_mouth）的自动蛙跳也不会误选它为起跳点。蛙跳从第 0 回合起算（距离预耗氧已删·作者 2026-06-14）。
const withWreckTM = startDiveFromOutpost(litWreck, 'band.trench_mouth').run!.turn;
assert(withWreckTM === 0, '14e: 点亮章节前哨后深 band 蛙跳仍从第 0 回合起算（章节前哨不污染深脊柱）');

// 14f 半亮门：未达 USABLE 的章节前哨，显式起跳忽略（退回 home stand-in）——仍能蛙跳产生 run
let sChHalf = wreckStock();
sChHalf = { ...sChHalf, profile: { ...sChHalf.profile, flags: new Set([...sChHalf.profile.flags, ch1AnchorFlag('wreck')]) } };
sChHalf = advanceOutpost(sChHalf, WRECK_OUT); // stage 1 < USABLE(2)
assert(outpostStage(sChHalf.profile, WRECK_OUT) < OUTPOST_USABLE_STAGE, '14f: stage1 未达半亮');
const diveHalf = startDiveFromOutpost(sChHalf, WRECK_BAND, { launchOutpostId: WRECK_OUT });
assert(diveHalf.run, '14f: 未半亮显式起跳被忽略·仍能蛙跳（退回 home）');
// 14g dev 一键解锁本区：锁态直接 devUnlockChapterRegion → 点亮 + 置锚点 flag + 置 tutorial_complete（潜点门开）
let sRegion = wreckStock();
assert(!sRegion.profile.flags.has(ch1AnchorFlag('wreck')), '14g: 解锁前无 wreck 锚点 flag');
sRegion = devUnlockChapterRegion(sRegion, WRECK_OUT);
assert(isOutpostLit(sRegion.profile, WRECK_OUT), '14g: dev 解锁本区 → 前哨点亮');
assert(sRegion.profile.flags.has(ch1AnchorFlag('wreck')), '14g: dev 解锁本区 → 置 wreck 锚点 flag（潜点门）');
assert(sRegion.profile.flags.has('flag.tutorial_complete'), '14g: dev 解锁本区 → 置 tutorial_complete（海图门）');
assert(countInInventory(sRegion.profile.inventory, 'item.coral_shard') === 3, '14g: dev 解锁本区不扣料');
assert(hasLh(sRegion, WRECK_LH), '14g: dev 解锁本区 push 灯塔');
L('  锁态不可建/不扣料 → 锚点置位解锁建满 → dev 免解三连 → 章节蛙跳落本区 → 不污染深脊柱 → 半亮门 → dev 一键解锁本区 ✓');

console.log(log.join('\n'));
console.log(
  '\n✓ 深水前哨（Phase 2a 建造/蛙跳 + Phase 2b 能源/多前哨链 + abyssal 脊柱 + 章节哨站批解锁门/dev/蛙跳）回归通过',
);
