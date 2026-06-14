// 深水前哨：跨 run 分阶段建造 + 能源经济 + 章节哨站解锁门 + 点亮 promote 灯塔（带深度柱）回归。
// #131 探深「深度柱」重构后：**老「前哨蛙跳出潜点」已删**（startDiveFromOutpost / deepestOutpostLaunch /
// OutpostDef.bandId / 深脊柱前哨 reef_deep…hadal_deep / isChapterBand / chapterOutpostForBand 全删）。
// 深入下潜改走每座灯塔的**深度柱**（depth_columns.json·engine/columns.ts）——前哨建满 promote 成灯塔后，
// 海图上该灯塔的深度柱给出更深潜点。蛙跳相关覆盖整组移除（其下潜路径覆盖归 playthrough-columns）。
// 本文件主线锚定一座**章节前哨**（残骸前哨·outpost.ch1_wreck），它代表新模型下唯一活着的前哨形态。
// 覆盖（still-valid·与新模型一致）：
//   0. OutpostDef 自洽：留存的章节前哨各 3 阶段（= OUTPOST_MAX_STAGE）、requiresAnchor/requiresFlag 合法、
//      result.id 全局唯一、isChapterOutpost 判定；reef 锚点①由 home 灯塔覆盖（无 requiresAnchor=reef 的前哨）。
//   1. advanceOutpost 三阶段推进（按当前阶段扣材料＋金币、置阶段 flag、进度靠 flag 持久）；
//      点亮（OUTPOST_MAX_STAGE）→ promote：push 一座灯塔到 profile.lighthouses（复用 Phase C reveal）。
//   2. 不够料 / 已点亮 → no-op（半亮扛过死亡：进度不退）。
//   （旧 §3「建造事件阶段门控」已删·#131——深脊柱建造事件随前哨一并删·见正文注。）
//   4. 阶段进度 round-trip（flag 持久、不动存档形状·SAVE_VERSION = 5）。
//   5. 能源：静水前哨 base 能源只够 1 个补给设施在线；占用超容量 → 设施掉线（不计加成）。
//      （衰减/维护已删·CHANGELOG #125：前哨一次性基建、建成长亮·不随 run 荒废）。
//   6. reveal 半径恒定（衰减删除后既有 reveal 行为不变）：前哨灯塔半径 = 区域配置值（不随 run 收缩）。
//   7. 章节哨站解锁门（锚点 flag 未置 → canAdvance/advanceOutpost no-op；置位后可建）+ dev 免解三连
//      + dev 一键解锁本区（devUnlockChapterRegion）+ isOutpostDiscovered 发现门（未动工不可见/devReveal 现身/动工必现·quirk #126）。
//   8. promote 出的章节前哨灯塔带一根**深度柱**（getColumnForLighthouse·#131 探深下潜入口）。
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
  devRevealOutpost,
  isChapterOutpost,
  isOutpostDiscovered,
  outpostUnlocked,
  OUTPOST_MAX_STAGE,
  OUTPOST_USABLE_STAGE,
} from '../src/engine/lighthouses';
import { ch1AnchorFlag, CH1_ANCHORS, type Ch1Anchor } from '../src/engine/story';
import {
  outpostEnergy,
  effectiveOutpostBonuses,
  OUTPOST_BASE_ENERGY,
} from '../src/engine/outposts';
import { getColumnForLighthouse } from '../src/engine/columns';
import { isPoiVisible } from '../src/engine/chart';
import type { ChartPoi, GameState, InventoryItem } from '../src/types';

const log: string[] = [];
const L = (s: string) => log.push(s);
function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    console.error(log.join('\n'));
    throw new Error('断言失败：' + msg);
  }
}

// 主线锚一座**章节前哨**（残骸前哨）——#131 后唯一活着的前哨形态（深脊柱前哨已删）。
// requiresAnchor 'wreck'：建造前需置锚点 flag（ch1AnchorFlag('wreck')）或走 dev 免解。
const OUTPOST = 'outpost.ch1_wreck';
const RESULT_LH = 'lighthouse.ch1_wreck_outpost';
const ANCHOR: Ch1Anchor = 'wreck';

function stateWith(inv: InventoryItem[], gold: number): GameState {
  const base = createInitialGameState();
  return {
    ...base,
    profile: { ...base.profile, inventory: inv.map((i) => ({ ...i })), bankedGold: gold },
  };
}
const hasLh = (s: GameState, id: string) => s.profile.lighthouses.some((l) => l.id === id);
// 主线前哨带 requiresAnchor → 测建造前先种锚点 flag（让 outpostUnlocked 为 true，走真路径 advanceOutpost）。
const withAnchor = (s: GameState): GameState => ({
  ...s,
  profile: { ...s.profile, flags: new Set([...s.profile.flags, ch1AnchorFlag(ANCHOR)]) },
});

// ============================================================
// 0. OutpostDef 自洽：留存章节前哨各 3 阶段、requiresAnchor/Flag 合法、result.id 唯一
// ============================================================
L('========== 0. OutpostDef 自洽 ==========');
const def = getOutpostDef(OUTPOST);
assert(def, '0: outpost.ch1_wreck 已注册');
assert(def!.stages.length === OUTPOST_MAX_STAGE, `0: stages 数(${def!.stages.length}) = OUTPOST_MAX_STAGE(${OUTPOST_MAX_STAGE})`);
assert(def!.requiresAnchor === ANCHOR, `0: 主线前哨 requiresAnchor=${ANCHOR}`);
assert(isChapterOutpost(def!), '0: 主线前哨是章节前哨');
assert(def!.submerged, '0: 主线前哨水下');
L(`  「${def!.name}」${def!.stages.length} 阶段·requiresAnchor=${def!.requiresAnchor} ✓`);
// 全部留存前哨（#131 后：四座章节前哨·沉船/中层/热液 requiresAnchor + 海沟 requiresFlag）自洽——
// 3 阶段、是章节前哨、result.id 全局唯一、要么 requiresAnchor 是合法锚点要么 requiresFlag 非空。
const allOutposts = getOutposts();
assert(allOutposts.length > 0, '0: 至少留存一座前哨');
const allResultIds = allOutposts.map((o) => o.result.id);
assert(new Set(allResultIds).size === allResultIds.length, '0: 所有前哨 result.id 全局唯一');
for (const o of allOutposts) {
  assert(o.stages.length === OUTPOST_MAX_STAGE, `0: ${o.id} 3 阶段`);
  assert(isChapterOutpost(o), `0: ${o.id} 是章节前哨（#131 后无深脊柱裸前哨）`);
  if (o.requiresAnchor !== undefined) {
    assert(CH1_ANCHORS.includes(o.requiresAnchor as Ch1Anchor), `0: ${o.id} requiresAnchor=${o.requiresAnchor} ∈ CH1_ANCHORS`);
  } else {
    assert(typeof o.requiresFlag === 'string' && o.requiresFlag.length > 0, `0: ${o.id} 无锚点则须有非空 requiresFlag`);
  }
}
// reef 锚点①由 home 灯塔覆盖、不设哨站（无 requiresAnchor=reef 的前哨）。
assert(!allOutposts.some((o) => o.requiresAnchor === 'reef'), '0: 锚点①(reef)无哨站（home 灯塔覆盖）');
L(`  ${allOutposts.length} 座留存前哨各 3 阶段·全为章节前哨·result.id 唯一·reef 无哨站 ✓`);

// ============================================================
// 1. 三阶段推进：扣料＋金、置 flag、点亮 promote
// ============================================================
L('\n========== 1. 三阶段推进 + promote ==========');
// 备齐残骸前哨全程料（s1 coral×3/40 · s2 crab×2+brass×2/70 · s3 lantern×2/110）→ coral3 crab2 brass2 lantern2, gold 300
let s = withAnchor(
  stateWith(
    [
      { itemId: 'item.coral_shard', qty: 3 },
      { itemId: 'item.crab_chitin', qty: 2 },
      { itemId: 'item.brass_fitting', qty: 2 },
      { itemId: 'item.lantern_gland', qty: 2 },
    ],
    300,
  ),
);
assert(outpostStage(s.profile, OUTPOST) === 0, '1: 起手 stage 0');
assert(!hasLh(s, RESULT_LH), '1: 起手没有前哨灯塔');

// 阶段 1（清出塔基：coral×3 + 40 金）
s = advanceOutpost(s, OUTPOST);
assert(outpostStage(s.profile, OUTPOST) === 1, '1: 推进后 stage 1');
assert(s.profile.flags.has(outpostStageFlag(OUTPOST, 1)), '1: 置 s1 flag');
assert(countInInventory(s.profile.inventory, 'item.coral_shard') === 0, '1: coral 扣 3→0');
assert(s.profile.bankedGold === 260, '1: 金 300→260');
assert(!hasLh(s, RESULT_LH), '1: stage 1 还没 promote 灯塔');

// 阶段 2（落脚架与浮筒：crab×2+brass×2 + 70 金）—— 半亮
s = advanceOutpost(s, OUTPOST);
assert(outpostStage(s.profile, OUTPOST) === 2, '1: 推进后 stage 2（半亮）');
assert(countInInventory(s.profile.inventory, 'item.crab_chitin') === 0, '1: crab 扣 2→0');
assert(countInInventory(s.profile.inventory, 'item.brass_fitting') === 0, '1: brass 扣 2→0');
assert(s.profile.bankedGold === 190, '1: 金 260→190');
assert(!isOutpostLit(s.profile, OUTPOST), '1: 半亮还没点亮');
assert(!hasLh(s, RESULT_LH), '1: 半亮还没 promote 灯塔');

// 阶段 3（通电点亮：lantern×2 + 110 金）—— 点亮 promote
s = advanceOutpost(s, OUTPOST);
assert(outpostStage(s.profile, OUTPOST) === 3, '1: 推进后 stage 3');
assert(isOutpostLit(s.profile, OUTPOST), '1: stage 3 = 点亮');
assert(countInInventory(s.profile.inventory, 'item.lantern_gland') === 0, '1: lantern 扣 2→0');
assert(s.profile.bankedGold === 80, '1: 金 190→80');
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

// 空仓推进（已解锁但无料）→ no-op，stage 不动
let sPoor = withAnchor(stateWith([], 0));
sPoor = advanceOutpost(sPoor, OUTPOST);
assert(outpostStage(sPoor.profile, OUTPOST) === 0, '2: 不够料 → stage 仍 0（进度不退）');
assert(!sPoor.profile.flags.has(outpostStageFlag(OUTPOST, 1)), '2: 不够料 → 不置 flag');
// 推到 stage 1 后断料 → 停在 1（半亮扛过死亡：下次带够再来）
let sHalf = withAnchor(stateWith([{ itemId: 'item.coral_shard', qty: 3 }], 40));
sHalf = advanceOutpost(sHalf, OUTPOST); // stage 1
assert(outpostStage(sHalf.profile, OUTPOST) === 1, '2: stage 1 达成');
sHalf = advanceOutpost(sHalf, OUTPOST); // 没 s2 的料 → no-op
assert(outpostStage(sHalf.profile, OUTPOST) === 1, '2: 断料 → 停在 stage 1（不退、可续）');
L('  已满幂等 / 不够料不退 / 断料停在当前阶段 ✓');

// 注：旧「§3 建造事件阶段门控」已删（#131）——它测的深脊柱建造事件 lighthouse.outpost_* 已随深脊柱前哨
// 一并删除（章节前哨改由海图 OutpostPopup 的「建造」按钮直接 advanceOutpost·不走下潜事件）。isOptionVisible
// 通用机制仍由带 visibleIf 选项的事件经场景/事件 runner 覆盖。

// ============================================================
// 4. 阶段进度 round-trip（flag 持久、不动存档形状）
// ============================================================
L('\n========== 4. 进度 round-trip ==========');
// 把主线前哨推到半亮（stage 2）做 round-trip
let sUsable = withAnchor(
  stateWith(
    [
      { itemId: 'item.coral_shard', qty: 3 },
      { itemId: 'item.crab_chitin', qty: 2 },
      { itemId: 'item.brass_fitting', qty: 2 },
    ],
    200,
  ),
);
sUsable = advanceOutpost(sUsable, OUTPOST); // 1
sUsable = advanceOutpost(sUsable, OUTPOST); // 2（半亮）
assert(outpostStage(sUsable.profile, OUTPOST) === OUTPOST_USABLE_STAGE, '4: 主线前哨半亮（USABLE）');
const round = deserializeGameState(serializeGameState(sUsable));
assert(round, '4: deserialize 不为 null');
assert(outpostStage(round!.profile, OUTPOST) === 2, '4: round-trip 后 stage 仍 2（flag 持久）');
assert(round!.version === 5, '4: SAVE_VERSION 5（round-trip 后不变·#131 已 bump）');
L('  stage flag round-trip / SAVE_VERSION 5 不变 ✓');

// ============================================================
// 5. 能源：静水前哨 base 能源只够 1 个补给设施在线
// ============================================================
L('\n========== 5. 能源：静水前哨只够 1 个补给在线 ==========');
// 主线残骸前哨是 submerged 但非 current（静水）→ 无水力·容量 = base 1。备齐建造料 + 两个补给设施料。
let sE = withAnchor(
  stateWith(
    [
      { itemId: 'item.coral_shard', qty: 3 }, // s1
      { itemId: 'item.crab_chitin', qty: 4 }, // s2 建造×2 + 制氧机×2
      { itemId: 'item.brass_fitting', qty: 4 }, // s2 建造×2 + 充电桩×2
      { itemId: 'item.lantern_gland', qty: 3 }, // s3 建造×2 + 制氧机×1
      { itemId: 'item.eel_skin', qty: 1 }, // 充电桩
    ],
    500,
  ),
);
sE = advanceOutpost(sE, OUTPOST);
sE = advanceOutpost(sE, OUTPOST);
sE = advanceOutpost(sE, OUTPOST); // 点亮
assert(isOutpostLit(sE.profile, OUTPOST), '5: 残骸前哨点亮');
sE = buildAtLighthouse(sE, RESULT_LH, 'lighthouse.recharge.lv1'); // 充电桩 draw1 / +20 电池
sE = buildAtLighthouse(sE, RESULT_LH, 'lighthouse.oxygen_supply.lv1'); // 制氧机 draw1 / +10 氧
const lhE = getLighthouse(sE.profile, RESULT_LH)!;
assert(
  lhE.builtUpgrades.has('lighthouse.recharge.lv1') &&
    lhE.builtUpgrades.has('lighthouse.oxygen_supply.lv1'),
  '5: 两个补给设施都建上',
);
const en = outpostEnergy(lhE);
assert(en.capacity === OUTPOST_BASE_ENERGY, `5: 静水前哨容量 = base ${OUTPOST_BASE_ENERGY}（无水力）`);
assert(en.demand === 2, '5: 两个补给设施占用共 2');
const drawOnline = [...en.online].filter(
  (id) => id === 'lighthouse.recharge.lv1' || id === 'lighthouse.oxygen_supply.lv1',
);
assert(drawOnline.length === 1, `5: 容量 1 → 只能 1 个补给在线（实 ${drawOnline.length}）`);
const effE = effectiveOutpostBonuses(lhE);
const onlineSupplies = (effE.rechargeBonus > 0 ? 1 : 0) + (effE.oxygenSupply > 0 ? 1 : 0);
assert(onlineSupplies === 1, '5: 有效加成只反映 1 个在线补给设施（超容量的掉线）');
L(`  静水残骸前哨：容量 ${en.capacity} / 占用 ${en.demand} / 在线补给 ${drawOnline.length} ✓`);

// ============================================================
// 6. reveal 半径恒定（衰减删除后既有 reveal 行为不变）：前哨灯塔半径 = 区域配置值·满半径点亮远点。
//    复用 §5 的 sE（残骸前哨已点亮 promote 出 RESULT_LH）。
// ============================================================
L('\n========== 6. reveal 半径恒定 ==========');
const lhRD = getLighthouse(sE.profile, RESULT_LH)!;
const fullR = revealRadius(lhRD);
assert(fullR > 0, '6: 前哨灯塔有正 reveal 半径');
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
assert(isPoiVisible(sE.profile, probe), '6: 前哨满半径点亮该远点（reveal 恒定·不随 run 收缩）');
L(`  前哨 reveal 半径 ${fullR.toFixed(2)}（恒定·不衰减）/ 满半径点亮远点 ✓`);

// ============================================================
// 7. 章节哨站：解锁门（锚点 flag）+ dev 免解 + dev 一键解锁本区 + 发现门
// ============================================================
L('\n========== 7. 章节哨站：解锁门 / dev / 发现门 ==========');

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

// 7a 锁态：锚点 flag 未置 → outpostUnlocked false · canAdvance false · advanceOutpost 不动 stage
let sLock = wreckStock();
assert(!sLock.profile.flags.has(ch1AnchorFlag(ANCHOR)), '7a: 起手无 wreck 锚点 flag');
assert(!outpostUnlocked(sLock.profile, OUTPOST), '7a: 暗（未解锁）');
assert(!canAdvanceOutpost(sLock.profile, OUTPOST), '7a: 锁态不可建（料够也不行）');
const sTryLocked = advanceOutpost(sLock, OUTPOST);
assert(outpostStage(sTryLocked.profile, OUTPOST) === 0, '7a: 锁态 advanceOutpost 不推进 stage');
assert(countInInventory(sTryLocked.profile.inventory, 'item.coral_shard') === 3, '7a: 锁态不扣料');
assert(sTryLocked.profile.bankedGold === 400, '7a: 锁态不扣金');

// 7b 置锚点 flag → 解锁 → 可建（料够）→ 三阶推进点亮
let sUnlk = withAnchor(wreckStock());
assert(outpostUnlocked(sUnlk.profile, OUTPOST), '7b: 锚点置位后解锁');
assert(canAdvanceOutpost(sUnlk.profile, OUTPOST), '7b: 解锁+料够 → 可建');
sUnlk = advanceOutpost(sUnlk, OUTPOST);
assert(outpostStage(sUnlk.profile, OUTPOST) === 1, '7b: 解锁后能推进');
assert(countInInventory(sUnlk.profile.inventory, 'item.coral_shard') === 0, '7b: 推进扣料');
sUnlk = advanceOutpost(sUnlk, OUTPOST);
sUnlk = advanceOutpost(sUnlk, OUTPOST);
assert(isOutpostLit(sUnlk.profile, OUTPOST), '7b: 三阶建满点亮');
assert(hasLh(sUnlk, RESULT_LH), '7b: 点亮 push 残骸前哨灯塔');

// 7c dev 免解：锁态直接 devAdvanceOutpost → 跳过门+跳过料，置 stage、不扣资源
let sDev = wreckStock();
assert(!outpostUnlocked(sDev.profile, OUTPOST), '7c: dev 前仍是锁态');
sDev = devAdvanceOutpost(sDev, OUTPOST);
assert(outpostStage(sDev.profile, OUTPOST) === 1, '7c: dev 免解锁推进一阶');
assert(countInInventory(sDev.profile.inventory, 'item.coral_shard') === 3, '7c: dev 不扣料');
assert(sDev.profile.bankedGold === 400, '7c: dev 不扣金');
sDev = devAdvanceOutpost(sDev, OUTPOST);
sDev = devAdvanceOutpost(sDev, OUTPOST);
assert(isOutpostLit(sDev.profile, OUTPOST), '7c: dev 三连点亮');
const sDevNoop = devAdvanceOutpost(sDev, OUTPOST);
assert(outpostStage(sDevNoop.profile, OUTPOST) === OUTPOST_MAX_STAGE, '7c: 已点亮 dev no-op');

// 7d dev 一键解锁本区：锁态直接 devUnlockChapterRegion → 点亮 + 置锚点 flag + 置 tutorial_complete（潜点门开）
let sRegion = wreckStock();
assert(!sRegion.profile.flags.has(ch1AnchorFlag(ANCHOR)), '7d: 解锁前无 wreck 锚点 flag');
sRegion = devUnlockChapterRegion(sRegion, OUTPOST);
assert(isOutpostLit(sRegion.profile, OUTPOST), '7d: dev 解锁本区 → 前哨点亮');
assert(sRegion.profile.flags.has(ch1AnchorFlag(ANCHOR)), '7d: dev 解锁本区 → 置 wreck 锚点 flag（潜点门）');
assert(sRegion.profile.flags.has('flag.tutorial_complete'), '7d: dev 解锁本区 → 置 tutorial_complete（海图门）');
assert(countInInventory(sRegion.profile.inventory, 'item.coral_shard') === 3, '7d: dev 解锁本区不扣料');
assert(hasLh(sRegion, RESULT_LH), '7d: dev 解锁本区 push 灯塔');

// 7e 发现门（作者 2026-06-14·非恒显·见 isOutpostDiscovered 注释）：本前哨未设 discoveredFlag（St1 剧情未接）→
// 起手既未动工又无 discovered 标记 → 海图上不可见；devRevealOutpost 显式标记后 → 可见；动过工（建过一阶）→ 必可见。
assert(def!.discoveredFlag === undefined, '7e: 主线章节前哨未设 discoveredFlag（St1 剧情未接·有意留白·quirk #126）');
assert(!isOutpostDiscovered(createInitialGameState().profile, OUTPOST), '7e: 起手未动工·无 discoveredFlag → 海图不可见');
const sReveal = devRevealOutpost(createInitialGameState(), OUTPOST);
assert(isOutpostDiscovered(sReveal.profile, OUTPOST), '7e: devRevealOutpost 显式标记 → 已发现（海图可见）');
assert(isOutpostDiscovered(sUnlk.profile, OUTPOST), '7e: 已建过工（§7b 点亮）→ 必可见');
L('  锁态不可建/不扣料 → 锚点置位解锁建满 → dev 免解三连 → dev 一键解锁本区 → 发现门（未动工不可见/devReveal 现身/动工必现）✓');

// ============================================================
// 8. promote 出的章节前哨灯塔带一根深度柱（#131 探深下潜入口）。
//    复用 §7b 的 sUnlk（残骸前哨已点亮 promote 出 RESULT_LH）。
// ============================================================
L('\n========== 8. 前哨灯塔带深度柱（#131 探深下潜入口） ==========');
const col = getColumnForLighthouse(RESULT_LH);
assert(col, `8: 点亮后 ${RESULT_LH} 有一根深度柱（getColumnForLighthouse 命中）`);
assert(col!.lighthouseId === RESULT_LH, `8: 深度柱 lighthouseId 指回该灯塔（${col!.lighthouseId}）`);
assert(Array.isArray(col!.tiers) && col!.tiers.length > 0, '8: 深度柱至少一档（深入下潜可达）');
// tier 连续从 1 递增（深入潜点档位制·与 columns.ts depthTierRevealState 一致）
assert(col!.tiers.every((t, i) => t.tier === i + 1), '8: 深度柱 tier 连续从 1 递增');
L(`  ${RESULT_LH} 深度柱「${col!.name}」${col!.tiers.length} 档 → 深入下潜走深度柱（#131）✓`);

console.log(log.join('\n'));
console.log(
  '\n✓ 深水前哨（章节哨站建造/能源/解锁门/发现门 + 点亮 promote 灯塔带深度柱·#131 探深重构后）回归通过',
);
