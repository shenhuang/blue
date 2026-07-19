// 深水前哨：跨 run 分阶段建造 + 章节哨站解锁门 + 点亮 promote 灯塔（带深度柱）回归。
// #131 探深「深度柱」重构后：**老「前哨蛙跳出潜点」已删**（startDiveFromOutpost / deepestOutpostLaunch /
// OutpostDef.bandId / 深脊柱前哨 reef_deep…hadal_deep / isChapterBand / chapterOutpostForBand 全删）。
// 深入下潜改走每座灯塔的**深度柱**（depth_columns.json·engine/columns.ts）——前哨建满 promote 成灯塔后，
// 海图上该灯塔的深度柱给出更深潜点。蛙跳相关覆盖整组移除（其下潜路径覆盖归 playthrough-columns）。
// 本文件主线锚定一座**章节前哨**（陆坡前哨·outpost.ch1_slope），它代表新模型下唯一活着的前哨形态。
// 覆盖（still-valid·与新模型一致）：
//   0. OutpostDef 自洽：留存的章节前哨各 3 阶段（= OUTPOST_MAX_STAGE）、requiresFlag 合法（主线柱迁移后四座
//      章节前哨全用 requiresFlag·三主线前哨=上一 beat flag·链式 build-gate）、result.id 全局唯一、isChapterOutpost 判定。
//   1. advanceOutpost 三阶段推进（按当前阶段扣材料＋金币、置阶段 flag、进度靠 flag 持久）；
//      点亮（OUTPOST_MAX_STAGE）→ promote：push 一座灯塔到 profile.lighthouses（复用 Phase C reveal）。
//   2. 不够料 / 已点亮 → no-op（半亮扛过死亡：进度不退）。
//   （旧 §3「建造事件阶段门控」已删·#131——深脊柱建造事件随前哨一并删·见正文注。）
//   4. 阶段进度 round-trip（flag 持久、不动存档形状·SAVE_VERSION = 5）。
//   5. 补给设施：充电/制氧建成即全额生效（能源容量门控已删·2026-06-21；衰减/维护更早删·#125）。
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
  getLighthouseBonuses,
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
import { ch1AnchorFlag } from '../src/engine/story';
import { isPoiVisible } from '../src/engine/chart';
import type { ChartPoi, GameState, InventoryItem } from '../src/types';
import { makeHarness, type PtAssert } from './lib/pt';

const pt = makeHarness('深水前哨（章节哨站建造/补给设施/解锁门/发现门 + 点亮 promote 灯塔）回归');
const { L } = pt;
const assert: PtAssert = pt.assert;

// 主线锚一座**章节前哨**（陆坡前哨）——#131 后唯一活着的前哨形态（深脊柱前哨已删）。
// **主线柱迁移**：建造门从「本区锚点（requiresAnchor: 'slope'）」翻成「**上一 beat** flag」——
// 陆坡前哨 requiresFlag = story.ch1.anchor.reef（reef beat 做完才能建陆坡前哨·解死锁·链式 build-gate）。
const OUTPOST = 'outpost.ch1_slope';
const RESULT_LH = 'lighthouse.ch1_slope_outpost';
// 陆坡前哨的「可建门」flag = 上一 beat（reef）完成 flag（翻转后·单一来源 lighthouse_upgrades.json requiresFlag）。
const GATE_FLAG = ch1AnchorFlag('reef');

function stateWith(inv: InventoryItem[], gold: number): GameState {
  const base = createInitialGameState();
  return {
    ...base,
    profile: { ...base.profile, inventory: inv.map((i) => ({ ...i })), bankedGold: gold },
  };
}
const hasLh = (s: GameState, id: string) => s.profile.lighthouses.some((l) => l.id === id);
// 主线前哨带 requiresFlag（上一 beat）→ 测建造前先种该 gate flag（让 outpostUnlocked 为 true·走真路径 advanceOutpost）。
const withGate = (s: GameState): GameState => ({
  ...s,
  profile: { ...s.profile, flags: new Set([...s.profile.flags, GATE_FLAG]) },
});

// ============================================================
// 0. OutpostDef 自洽：留存章节前哨各 3 阶段、requiresAnchor/Flag 合法、result.id 唯一
// ============================================================
L('========== 0. OutpostDef 自洽 ==========');
const def = getOutpostDef(OUTPOST);
assert(def, '0: outpost.ch1_slope 已注册');
assert(def!.stages.length === OUTPOST_MAX_STAGE, `0: stages 数(${def!.stages.length}) = OUTPOST_MAX_STAGE(${OUTPOST_MAX_STAGE})`);
// 主线柱迁移：陆坡前哨建造门 = 上一 beat（reef）完成 flag（翻转后·不再是 requiresAnchor: 'slope'）。
assert(def!.requiresFlag === GATE_FLAG, `0: 陆坡前哨 requiresFlag=${GATE_FLAG}（上一 beat reef·翻转后）`);
assert(def!.requiresAnchor === undefined, '0: 陆坡前哨不再用 requiresAnchor（已翻成 requiresFlag·主线柱迁移）');
assert(isChapterOutpost(def!), '0: 主线前哨是章节前哨');
assert(def!.submerged, '0: 主线前哨水下');
L(`  「${def!.name}」${def!.stages.length} 阶段·requiresFlag=${def!.requiresFlag}（上一 beat reef）✓`);
// 全部留存前哨（主线柱迁移后：四座章节前哨 slope/midwater/vent **翻成 requiresFlag=上一 beat flag**·
// 海沟 requiresFlag=trench_found·鲸落 requiresFlag=whalefall_found）自洽——3 阶段、是章节前哨、result.id 全局唯一。
// 链式 build-gate 单一来源 = lighthouse_upgrades.json requiresFlag；这里断言「翻转后无任何 requiresAnchor 残留」。
const CHAIN_GATE: Record<string, string> = {
  'outpost.ch1_slope': ch1AnchorFlag('reef'),
  'outpost.ch1_midwater': ch1AnchorFlag('slope'),
  'outpost.ch1_vent': ch1AnchorFlag('midwater'),
};
const allOutposts = getOutposts();
assert(allOutposts.length > 0, '0: 至少留存一座前哨');
const allResultIds = allOutposts.map((o) => o.result.id);
assert(new Set(allResultIds).size === allResultIds.length, '0: 所有前哨 result.id 全局唯一');
for (const o of allOutposts) {
  assert(o.stages.length === OUTPOST_MAX_STAGE, `0: ${o.id} 3 阶段`);
  assert(isChapterOutpost(o), `0: ${o.id} 是章节前哨（#131 后无深脊柱裸前哨）`);
  // 主线柱迁移：四座章节前哨全用 requiresFlag（无 requiresAnchor 残留）。
  assert(o.requiresAnchor === undefined, `0: ${o.id} 不应再有 requiresAnchor（主线柱迁移已翻成 requiresFlag）`);
  assert(typeof o.requiresFlag === 'string' && o.requiresFlag.length > 0, `0: ${o.id} 须有非空 requiresFlag（链式 build-gate）`);
  // 三座主线区前哨（slope/midwater/vent）的 requiresFlag = **上一 beat** flag（reef←·slope←·midwater←·防死锁）。
  if (CHAIN_GATE[o.id]) {
    assert(o.requiresFlag === CHAIN_GATE[o.id], `0: ${o.id} requiresFlag 应=上一 beat flag「${CHAIN_GATE[o.id]}」（链式 build-gate），实 ${o.requiresFlag}`);
  }
}
// reef beat①由 home 灯塔覆盖（免费入口）、不设哨站——无任何前哨的 requiresFlag 指向「建好后才有 reef」。
assert(!allOutposts.some((o) => o.requiresFlag === ch1AnchorFlag('reef') && o.id !== 'outpost.ch1_slope'), '0: reef beat 免费入口·仅作为陆坡前哨的解锁前置·不另设 reef 哨站');
L(`  ${allOutposts.length} 座留存前哨各 3 阶段·全为章节前哨·result.id 唯一·三主线前哨 requiresFlag=上一 beat（链式 build-gate）✓`);

// ============================================================
// 1. 三阶段推进：扣料＋金、置 flag、点亮 promote
// ============================================================
L('\n========== 1. 三阶段推进 + promote ==========');
// 备齐陆坡前哨全程料（s1 scrap×2/40·coral→scrap 经济 2026-06-28 · s2 crab×2+brass×2/70 · s3 lantern×2/110）→ scrap2 crab2 brass2 lantern2, gold 300
let s = withGate(
  stateWith(
    [
      { itemId: 'item.scrap_alloy', qty: 2 },
      { itemId: 'item.crab_chitin', qty: 2 },
      { itemId: 'item.brass_fitting', qty: 2 },
      { itemId: 'item.lantern_gland', qty: 2 },
    ],
    300,
  ),
);
assert(outpostStage(s.profile, OUTPOST) === 0, '1: 起手 stage 0');
assert(!hasLh(s, RESULT_LH), '1: 起手没有前哨灯塔');

// 阶段 1（清出塔基：scrap×2 + 40 金）
s = advanceOutpost(s, OUTPOST);
assert(outpostStage(s.profile, OUTPOST) === 1, '1: 推进后 stage 1');
assert(s.profile.flags.has(outpostStageFlag(OUTPOST, 1)), '1: 置 s1 flag');
assert(countInInventory(s.profile.inventory, 'item.scrap_alloy') === 0, '1: scrap 扣 2→0');
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
let sPoor = withGate(stateWith([], 0));
sPoor = advanceOutpost(sPoor, OUTPOST);
assert(outpostStage(sPoor.profile, OUTPOST) === 0, '2: 不够料 → stage 仍 0（进度不退）');
assert(!sPoor.profile.flags.has(outpostStageFlag(OUTPOST, 1)), '2: 不够料 → 不置 flag');
// 推到 stage 1 后断料 → 停在 1（半亮扛过死亡：下次带够再来）
let sHalf = withGate(stateWith([{ itemId: 'item.scrap_alloy', qty: 2 }], 40));
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
let sUsable = withGate(
  stateWith(
    [
      { itemId: 'item.scrap_alloy', qty: 2 },
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
assert(round!.version === 18, '4: SAVE_VERSION 18（round-trip 后不变·声呐无升级化 bump）');
L('  stage flag round-trip / SAVE_VERSION 18 不变 ✓');

// ============================================================
// 5. 补给设施：建成即全额生效（能源容量门控已删·2026-06-21）
// ============================================================
L('\n========== 5. 补给设施建成即全额生效 ==========');
// 陆坡前哨点亮后建充电桩(+20 电池) + 制氧机(+10 氧)：两者都该全额计入（不再有「同时在线几个」的能源门）。
let sE = withGate(
  stateWith(
    [
      { itemId: 'item.scrap_alloy', qty: 2 }, // s1（coral→scrap·经济 2026-06-28）
      { itemId: 'item.crab_chitin', qty: 4 }, // s2 建造×2 + 制氧机×2
      { itemId: 'item.brass_fitting', qty: 4 }, // s2 建造×2 + 充电桩×2
      { itemId: 'item.lantern_gland', qty: 2 }, // s3 建造×2（制氧机改吃铁结核·材料主题 2026-06-28）
      { itemId: 'item.quartz_crystal', qty: 1 }, // 充电桩（鳗皮→石英·2026-06-28）
      { itemId: 'item.iron_concretion', qty: 1 }, // 制氧机（冷光腺→铁结核·2026-06-28）
    ],
    500,
  ),
);
sE = advanceOutpost(sE, OUTPOST);
sE = advanceOutpost(sE, OUTPOST);
sE = advanceOutpost(sE, OUTPOST); // 点亮
assert(isOutpostLit(sE.profile, OUTPOST), '5: 陆坡前哨点亮');
sE = buildAtLighthouse(sE, RESULT_LH, 'lighthouse.recharge.lv1'); // 充电桩 +20 电池
sE = buildAtLighthouse(sE, RESULT_LH, 'lighthouse.oxygen_supply.lv1'); // 制氧机 +10 氧
const lhE = getLighthouse(sE.profile, RESULT_LH)!;
assert(
  lhE.builtUpgrades.has('lighthouse.recharge.lv1') &&
    lhE.builtUpgrades.has('lighthouse.oxygen_supply.lv1'),
  '5: 两个补给设施都建上',
);
const bonE = getLighthouseBonuses(lhE);
assert(bonE.rechargeBonus === 20, `5: 充电设施全额生效 → rechargeBonus 20（实 ${bonE.rechargeBonus}）`);
assert(bonE.oxygenSupply === 10, `5: 制氧设施全额生效 → oxygenSupply 10（实 ${bonE.oxygenSupply}）`);
L(`  陆坡前哨：充电 +${bonE.rechargeBonus} / 制氧 +${bonE.oxygenSupply}（两者都在·无能源门）✓`);

// ============================================================
// 6. reveal 半径恒定（衰减删除后既有 reveal 行为不变）：前哨灯塔半径 = 区域配置值·满半径点亮远点。
//    复用 §5 的 sE（陆坡前哨已点亮 promote 出 RESULT_LH）。
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
  zoneId: 'zone.vertical_test',
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

// 备齐陆坡前哨全程料（s1 scrap×2/40·coral→scrap 经济 2026-06-28 · s2 crab×2+brass×2/70 · s3 lantern×2/110）
function slopeStock(): GameState {
  return stateWith(
    [
      { itemId: 'item.scrap_alloy', qty: 2 },
      { itemId: 'item.crab_chitin', qty: 2 },
      { itemId: 'item.brass_fitting', qty: 2 },
      { itemId: 'item.lantern_gland', qty: 2 },
    ],
    400,
  );
}

// 7a 锁态：上一 beat（reef）gate flag 未置 → outpostUnlocked false · canAdvance false · advanceOutpost 不动 stage
let sLock = slopeStock();
assert(!sLock.profile.flags.has(GATE_FLAG), '7a: 起手无上一 beat（reef）gate flag');
assert(!outpostUnlocked(sLock.profile, OUTPOST), '7a: 暗（未解锁）');
assert(!canAdvanceOutpost(sLock.profile, OUTPOST), '7a: 锁态不可建（料够也不行）');
const sTryLocked = advanceOutpost(sLock, OUTPOST);
assert(outpostStage(sTryLocked.profile, OUTPOST) === 0, '7a: 锁态 advanceOutpost 不推进 stage');
assert(countInInventory(sTryLocked.profile.inventory, 'item.scrap_alloy') === 2, '7a: 锁态不扣料');
assert(sTryLocked.profile.bankedGold === 400, '7a: 锁态不扣金');

// 7b 置上一 beat（reef）gate flag → 解锁 → 可建（料够）→ 三阶推进点亮
let sUnlk = withGate(slopeStock());
assert(outpostUnlocked(sUnlk.profile, OUTPOST), '7b: 上一 beat（reef）gate flag 置位后解锁');
assert(canAdvanceOutpost(sUnlk.profile, OUTPOST), '7b: 解锁+料够 → 可建');
sUnlk = advanceOutpost(sUnlk, OUTPOST);
assert(outpostStage(sUnlk.profile, OUTPOST) === 1, '7b: 解锁后能推进');
assert(countInInventory(sUnlk.profile.inventory, 'item.scrap_alloy') === 0, '7b: 推进扣料');
sUnlk = advanceOutpost(sUnlk, OUTPOST);
sUnlk = advanceOutpost(sUnlk, OUTPOST);
assert(isOutpostLit(sUnlk.profile, OUTPOST), '7b: 三阶建满点亮');
assert(hasLh(sUnlk, RESULT_LH), '7b: 点亮 push 陆坡前哨灯塔');

// 7c dev 免解：锁态直接 devAdvanceOutpost → 跳过门+跳过料，置 stage、不扣资源
let sDev = slopeStock();
assert(!outpostUnlocked(sDev.profile, OUTPOST), '7c: dev 前仍是锁态');
sDev = devAdvanceOutpost(sDev, OUTPOST);
assert(outpostStage(sDev.profile, OUTPOST) === 1, '7c: dev 免解锁推进一阶');
assert(countInInventory(sDev.profile.inventory, 'item.scrap_alloy') === 2, '7c: dev 不扣料');
assert(sDev.profile.bankedGold === 400, '7c: dev 不扣金');
sDev = devAdvanceOutpost(sDev, OUTPOST);
sDev = devAdvanceOutpost(sDev, OUTPOST);
assert(isOutpostLit(sDev.profile, OUTPOST), '7c: dev 三连点亮');
const sDevNoop = devAdvanceOutpost(sDev, OUTPOST);
assert(outpostStage(sDevNoop.profile, OUTPOST) === OUTPOST_MAX_STAGE, '7c: 已点亮 dev no-op');

// 7d dev 一键解锁本区：锁态直接 devUnlockChapterRegion → 点亮 + 置上游「可建门」flag（主线柱迁移后=上一 beat reef·requiresFlag）
//    + 置 tutorial_complete（海图门）。
//    （#217「dev 解锁代置本区自身 beat anchor.slope」随深度柱 beatFlag 系统删除·2026-07-12 白板收口移除——本区 beat 不再代置。）
let sRegion = slopeStock();
assert(!sRegion.profile.flags.has(GATE_FLAG), '7d: 解锁前无上一 beat（reef）gate flag');
sRegion = devUnlockChapterRegion(sRegion, OUTPOST);
assert(isOutpostLit(sRegion.profile, OUTPOST), '7d: dev 解锁本区 → 前哨点亮');
assert(sRegion.profile.flags.has(GATE_FLAG), '7d: dev 解锁本区 → 置上游「可建门」flag（=上一 beat reef·requiresFlag·主线柱迁移）');
assert(sRegion.profile.flags.has('flag.tutorial_complete'), '7d: dev 解锁本区 → 置 tutorial_complete（海图门）');
assert(countInInventory(sRegion.profile.inventory, 'item.scrap_alloy') === 2, '7d: dev 解锁本区不扣料');
assert(hasLh(sRegion, RESULT_LH), '7d: dev 解锁本区 push 灯塔');

// （7d′ chainTail 回归门随深度柱 columnBeatFlagForLighthouse 删除·2026-07-12 移除·主线 beat 已 re-home
//  至 chart_pois 静态 story 锚点·其可达性由 check-mainline-reachable / playthrough-story 守。）
L('  dev 一键解锁本区：点亮 + 上游门 + tutorial_complete ✓');

// 7e 发现门（作者 2026-06-14·非恒显·见 isOutpostDiscovered 注释）：本前哨未设 discoveredFlag（St1 剧情未接）→
// 起手既未动工又无 discovered 标记 → 海图上不可见；devRevealOutpost 显式标记后 → 可见；动过工（建过一阶）→ 必可见。
assert(def!.discoveredFlag === undefined, '7e: 主线章节前哨未设 discoveredFlag（St1 剧情未接·有意留白·quirk #126）');
assert(!isOutpostDiscovered(createInitialGameState().profile, OUTPOST), '7e: 起手未动工·无 discoveredFlag → 海图不可见');
const sReveal = devRevealOutpost(createInitialGameState(), OUTPOST);
assert(isOutpostDiscovered(sReveal.profile, OUTPOST), '7e: devRevealOutpost 显式标记 → 已发现（海图可见）');
assert(isOutpostDiscovered(sUnlk.profile, OUTPOST), '7e: 已建过工（§7b 点亮）→ 必可见');
L('  锁态不可建/不扣料 → 锚点置位解锁建满 → dev 免解三连 → dev 一键解锁本区 → 发现门（未动工不可见/devReveal 现身/动工必现）✓');

// （§8「promote 出的章节前哨灯塔带一根深度柱」随深度柱系统删除·2026-07-12 移除·深入下潜入口经济待重做。）

pt.done();
