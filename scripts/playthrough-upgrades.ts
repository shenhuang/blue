// 港口升级 playthrough —— 验证 canPurchase / purchaseUpgrade / getUpgradeBonuses
// 双资源账单（材料 ＋ 金币，基建地图 Phase A）：材料不够 / 金币不够 都买不了；够了正确扣材料 + 扣金币。
// + 验证 dialog 的 startDive 加成链路 + 气瓶库 lv1 改 run.oxygenMax + 船坞迁灯塔后的 +1 槽（getRunBonuses）。
//
// 注意（Phase C）：dockyard 已从全局升级迁成**家灯塔「船坞」设施**（lighthouse.dockyard.lv1）。
// 全局升级线现在是 2 条（打捞行会 / 气瓶库）；dockyard 的覆盖移到 playthrough-lighthouse.ts +
// 本脚本 §5/§6/§7（门控旧灯塔礁）。
// 背包重量制（2026-06-21）：背包容量改为重量上限 carryWeightLimit（base RUN_CARRY_WEIGHT=15kg·见 state.ts）。
// dockyard 的 extraConsumableSlot（旧「+1 格」效果）已删（2026-07-10·上浮/背包均与它无关）——
// dockyard 现存功能＝门控远海 POI（§5/§6），不改 run 背包容量。§7 据此断言 carryWeightLimit 恒 15。
//
// 跑法：npx tsx scripts/playthrough-upgrades.ts

import { createInitialGameState, createNewRun, countInInventory, createStarterLoadout, HOME_LIGHTHOUSE_ID, RUN_CARRY_WEIGHT } from '../src/engine/state';
import { ROOM_FEATURE_CHANCE_MAX } from '../src/engine/clarity';
import {
  canPurchase,
  getUpgradeBonuses,
  getUpgradeLines,
  getUnlockedLevelInLine,
  purchaseUpgrade,
} from '../src/engine/upgrades';
import { getRunBonuses } from '../src/engine/lighthouses';
// 段2：声呐＝Otto 打造的装备件（§8·声呐无升级化 2026-07-19：打造＝解锁·Lv.1 到顶·无升级步）。
import { craftEquipment, canCraftEquipment, canUpgradeEquipment, hasSonarEquipped, equipmentMaxLevel } from '../src/engine/equipment';
import type { GameState, InventoryItem } from '../src/types';
import { makeHarness, type PtAssert } from './lib/pt';

let state: GameState = createInitialGameState();
const pt = makeHarness('港口升级 playthrough');
const { log } = pt;
const assert: PtAssert = pt.assert;

// 升级账单（与 data/upgrades.json 对齐，改动数值时同步）
//   tankhouse.lv1    = shark_tooth×4, lobster×4          ＋ 25 金
//   salvage_guild.lv1= scrap_alloy×3, brass_fitting×3    ＋ 30 金（coral→scrap·经济 2026-06-28）
//   salvage_guild.lv2= brass_fitting×4, crab_chitin×3, cave_octopus_beak×2 ＋ 70 金
// 灯塔设施（家灯塔，data/lighthouse_upgrades.json）：
//   lighthouse.dockyard.lv1 = scrap_alloy×3, old_fishing_net×3 ＋ 20 金（给 +1 消耗品槽·coral→scrap·经济 2026-06-28）
const DOCK_FACILITY = 'lighthouse.dockyard.lv1';
const tankLv1 = 'upgrade.tankhouse.lv1';
const tankLv2_NotExist = 'upgrade.tankhouse.lv2';
const guildLv1 = 'upgrade.salvage_guild.lv1';
const guildLv2 = 'upgrade.salvage_guild.lv2';

function withProfile(inv: InventoryItem[], gold: number): GameState {
  return { ...state, profile: { ...state.profile, inventory: inv.map((i) => ({ ...i })), bankedGold: gold } };
}

/** 在家灯塔建上「船坞」设施（直接写 builtUpgrades，省去账单——本脚本只测它的下游效果）。 */
function withHomeDockyard(g: GameState): GameState {
  return {
    ...g,
    profile: {
      ...g.profile,
      lighthouses: g.profile.lighthouses.map((l) =>
        l.id === HOME_LIGHTHOUSE_ID
          ? { ...l, builtUpgrades: new Set([...l.builtUpgrades, DOCK_FACILITY]) }
          : l,
      ),
    },
  };
}

log.push('========== 1. 升级数据可读 ==========');
const lines = getUpgradeLines();
log.push(`共 ${lines.length} 条升级线：${lines.map((l) => l.name).join('、')}`);
assert(lines.length === 2, '应有 2 条升级线（打捞行会 / 气瓶库；声呐/灯/规避三传感器线段2 已退役——声呐迁 Otto 打造装备件、灯/规避效果回基线·船坞已迁灯塔设施）');

log.push('\n========== 2. 双资源门控：材料不够 / 金币不够 都买不了 ==========');
// (a) 空仓 + 满金 → 材料不足（金币买不了升级——下深拿料是核心门控）
state = withProfile([], 9999);
const avNoMat = canPurchase(state.profile, tankLv1);
log.push(`空仓+满金 canPurchase(${tankLv1}) = ${JSON.stringify(avNoMat)}`);
assert(!avNoMat.ok && avNoMat.reason === 'notEnoughMaterials', '只有金币没材料 → notEnoughMaterials（金币买不了升级）');
assert(
  avNoMat.reason === 'notEnoughMaterials' &&
    avNoMat.shortfall.find((m) => m.itemId === 'item.shark_tooth')?.qty === 4 &&
    avNoMat.shortfall.find((m) => m.itemId === 'item.lobster')?.qty === 4,
  'shortfall 应列出完整缺口（shark×4, lobster×4）',
);

// (b) 部分材料 → shortfall 只列差额
state = withProfile([{ itemId: 'item.shark_tooth', qty: 3 }, { itemId: 'item.lobster', qty: 4 }], 9999);
const avPartial = canPurchase(state.profile, tankLv1);
log.push(`部分材料 canPurchase(${tankLv1}) = ${JSON.stringify(avPartial)}`);
assert(
  !avPartial.ok && avPartial.reason === 'notEnoughMaterials' &&
    avPartial.shortfall.length === 1 && avPartial.shortfall[0].itemId === 'item.shark_tooth' &&
    avPartial.shortfall[0].qty === 1,
  '已有 shark×3 → 只差 shark×1，lobster 不缺',
);

// (c) 材料够、金币不够 → notEnoughGold
state = withProfile([{ itemId: 'item.shark_tooth', qty: 4 }, { itemId: 'item.lobster', qty: 4 }], 5);
const avNoGold = canPurchase(state.profile, tankLv1);
log.push(`材料够+金币 5 canPurchase(${tankLv1}) = ${JSON.stringify(avNoGold)}`);
assert(!avNoGold.ok && avNoGold.reason === 'notEnoughGold' && avNoGold.goldShort === 20, '材料够但金币 5<25 → notEnoughGold 差 20');

// (d) purchaseUpgrade 在不可购买时是 no-op（不偷扣材料/金币）
const noOp = purchaseUpgrade(state, tankLv1);
assert(noOp === state, '账单不满足时 purchaseUpgrade 应 no-op（原样返回）');

// (e) 前置 / 不存在
state = withProfile([{ itemId: 'item.brass_fitting', qty: 9 }, { itemId: 'item.crab_chitin', qty: 9 }, { itemId: 'item.cave_octopus_beak', qty: 9 }], 9999);
const avPrereq = canPurchase(state.profile, guildLv2);
log.push(`canPurchase(${guildLv2}) [跳级] = ${JSON.stringify(avPrereq)}`);
assert(!avPrereq.ok && avPrereq.reason === 'needsPrev', 'lv2 在没买 lv1 前应被前置阻挡（即便材料金币都够）');
const avUnknown = canPurchase(state.profile, tankLv2_NotExist);
assert(!avUnknown.ok && avUnknown.reason === 'unknown', '未注册的升级 id 应返回 unknown');

log.push('\n========== 3. 购买正确扣材料 ＋ 扣金币 ==========');
// 给足 tankhouse.lv1：shark×4, lobster×4 + 富余 shark；金币 100
state = withProfile([{ itemId: 'item.shark_tooth', qty: 6 }, { itemId: 'item.lobster', qty: 4 }], 100);
const avOk = canPurchase(state.profile, tankLv1);
assert(avOk.ok, '材料 + 金币都够 → 应可购买');
const goldBefore = state.profile.bankedGold;
state = purchaseUpgrade(state, tankLv1);
log.push(`气瓶库 lv1 后：shark=${countInInventory(state.profile.inventory, 'item.shark_tooth')}（应 2）, lobster=${countInInventory(state.profile.inventory, 'item.lobster')}（应 0）, 金 ${goldBefore}→${state.profile.bankedGold}（应 -25）`);
assert(countInInventory(state.profile.inventory, 'item.shark_tooth') === 2, 'shark 应扣到 6-4=2');
assert(countInInventory(state.profile.inventory, 'item.lobster') === 0, 'lobster 应扣到 4-4=0（清空移出）');
assert(state.profile.bankedGold === goldBefore - 25, '应扣 25 金');
assert(state.profile.unlockedUpgrades.has(tankLv1), '应入 unlockedUpgrades');

const avOwned = canPurchase(state.profile, tankLv1);
assert(!avOwned.ok && avOwned.reason === 'alreadyOwned', '已购买应返回 alreadyOwned');

log.push('\n========== 4. 升级线进度（材料账单 lv1→lv2） ==========');
const salvageLine = lines.find((l) => l.id === 'line.salvage_guild')!;
// 给足 salvage lv1（scrap×3, brass×3 +30·coral→scrap 经济 2026-06-28）+ lv2（brass×4, chitin×3, beak×2 +70）
state = withProfile(
  [
    { itemId: 'item.scrap_alloy', qty: 3 },
    { itemId: 'item.brass_fitting', qty: 7 },
    { itemId: 'item.crab_chitin', qty: 3 },
    { itemId: 'item.cave_octopus_beak', qty: 2 },
  ],
  200,
);
state = { ...state, profile: { ...state.profile, unlockedUpgrades: new Set(state.profile.unlockedUpgrades) } };
state = purchaseUpgrade(state, guildLv1);
log.push(`打捞行会进度: lv ${getUnlockedLevelInLine(state.profile, salvageLine)} / 3`);
assert(getUnlockedLevelInLine(state.profile, salvageLine) === 1, 'salvage lv1 应入账');
assert(countInInventory(state.profile.inventory, 'item.brass_fitting') === 4, 'brass 应扣 3（7-3=4，留给 lv2）');
const av2b = canPurchase(state.profile, guildLv2);
log.push(`buy lv1 后 canPurchase(${guildLv2}) = ${JSON.stringify(av2b)}`);
assert(av2b.ok, '前置满足 + 材料金币够 → lv2 应可购买');
state = purchaseUpgrade(state, guildLv2);
assert(getUnlockedLevelInLine(state.profile, salvageLine) === 2, 'salvage lv2 应入账');
assert(countInInventory(state.profile.inventory, 'item.cave_octopus_beak') === 0, 'beak 应扣 2 清空');

log.push('\n========== 5. 派生加成聚合（全局 ＋ 家灯塔船坞桥） ==========');
// 全局：tankhouse(氧) + salvage lv1(保鲜/提示)；家灯塔船坞：+1 消耗品槽（经 getRunBonuses 并回）
state = createInitialGameState();
state = {
  ...state,
  profile: {
    ...state.profile,
    unlockedUpgrades: new Set([guildLv1]),
    inventory: [
      { itemId: 'item.shark_tooth', qty: 4 },
      { itemId: 'item.lobster', qty: 4 },
    ],
    bankedGold: 100,
  },
};
state = purchaseUpgrade(state, tankLv1);
assert(state.profile.unlockedUpgrades.has(tankLv1), '气瓶库 lv1 应入账（材料 shark×4+lobster×4 +25金）');
const bonuses = getUpgradeBonuses(state.profile);
log.push(`global bonuses = ${JSON.stringify({ ...bonuses, unlockedZones: [...bonuses.unlockedZones] })}`);
assert(bonuses.oxygenMaxBonus === 10, '气瓶库 lv1 给 +10 氧气');
assert(bonuses.preservationBonus === 2, '打捞行会 lv1 给保鲜 +2');
assert(bonuses.revealCorpseHint === true, '打捞行会 lv1 给 corpse hint');
log.push('  全局氧/保鲜/提示加成聚合正确（dockyard「+1格」效果已删 2026-07-10·其 POI 门控见 §6）✓');

// （§6「海图门控：旧灯塔礁（发现 flag ＋ 抵达＝家灯塔船坞）」随开放水域内容删除·2026-07-12 白板收口移除——
//   旧灯塔礁 zone 已删·且无存活 POI 用 requiresLighthouseUpgrade 抵达门·无存活等价可 repoint。
//   dockyard 设施本身仍在，其门控 POI 待内容重做后再补测。）

log.push('\n========== 7. 升级真正改变 run（getRunBonuses → createNewRun·气瓶库改 oxygenMax；背包承载＝重量制恒 15） ==========');
// 白板：aldo depart_east→东礁 dialog startDive 随开放水域内容删——直接走 getRunBonuses → createNewRun
//   （dialog 的 startDive 效果内部即此路径），测「升级→run.oxygenMax」链路不变。
let s3 = createInitialGameState();
s3 = {
  ...s3,
  profile: { ...s3.profile, unlockedUpgrades: new Set(['upgrade.tankhouse.lv1']) },
};
s3 = withHomeDockyard(s3); // 家灯塔船坞在场·验其「+1 格」效果已删（carryWeightLimit 不受影响·恒 15）
const s3run = createNewRun({ zoneId: 'zone.vertical_test', bonuses: getRunBonuses(s3.profile) });
log.push(`run.oxygenMax = ${s3run.oxygenMax} （应为 60 + 10 = 70）`);
log.push(`run.carryWeightLimit = ${s3run.carryWeightLimit} （重量制恒 ${RUN_CARRY_WEIGHT}kg）`);
assert(s3run.oxygenMax === 70, '气瓶库 lv1 应让 oxygenMax = 70');
assert(s3run.stats.oxygen === 70, '初始 oxygen 应填到上限');
assert(s3run.carryWeightLimit === RUN_CARRY_WEIGHT, `重量制：carryWeightLimit 恒 ${RUN_CARRY_WEIGHT}kg`);

log.push('\n========== 8. 段2：声呐＝Otto 打造的装备件（声呐无升级化 2026-07-19：打造＝解锁·Lv.1 到顶）==========');
// 声呐从「升级线 sonar_rig」迁成「Otto 打造的装备件」(item.sonar.handheld)；2026-07-19 声呐无升级化后
// upgradeSteps 整段从 items.json 删除——打造 Lv.1 即全功能（一记 ping 全图揭示·ping 耗电=常量 SONAR_PING_COST）。
state = createInitialGameState();
state = { ...state, profile: { ...state.profile, equipment: createStarterLoadout() } };
// 给足打造声呐的料 + 金（craft：lantern_gland 1 / eel_skin 2 / cave_octopus_beak 2 / iron_concretion 1 / 120 金）
state = withProfile(
  [
    { itemId: 'item.lantern_gland', qty: 1 },
    { itemId: 'item.eel_skin', qty: 2 },
    { itemId: 'item.cave_octopus_beak', qty: 2 },
    { itemId: 'item.iron_concretion', qty: 1 },
  ],
  200,
);

// (a) 空槽 → Otto 打造（null→Lv.1）＝解锁（声呐唯一的获得动作·无后续升级）
assert(state.profile.equipment!.sonar === null, '8: 起手声呐槽空（起手没声呐）');
assert(canCraftEquipment(state.profile.equipment!, state.profile.inventory, state.profile.bankedGold, 'item.sonar.handheld').ok, '8: 料+金够 → 可打造声呐');
state = craftEquipment(state, 'item.sonar.handheld');
assert(hasSonarEquipped(state.profile.equipment!), '8: 打造后声呐已装备（＝解锁）');
assert(getRunBonuses(state.profile).sonarUnlocked === true, '8: getRunBonuses.sonarUnlocked 由 hasSonarEquipped 派生');

// (b) 无升级：Lv.1 到顶（upgradeSteps 已删·canUpgradeEquipment 拒绝）
assert(equipmentMaxLevel('item.sonar.handheld') === 1, '8: 声呐件 Lv.1 到顶（无 upgradeSteps）');
assert(!canUpgradeEquipment(state.profile.equipment!, state.profile.inventory, state.profile.bankedGold, 'sonar').ok, '8: 声呐不可升级（无升级步·声呐无升级化）');
log.push('  声呐打造＝解锁 · Lv.1 到顶 · 无升级轴（ping 耗电常量·一记 ping 全图揭示）✓');

// ============================================================
// 9. 房间 feature 出现率升级（salvage_guild lv4·声呐与房间 §6/§8.3 续）
//    新 roomFeatureChanceBonus 沿 #80 同款传感器桥：UpgradeEffect→getUpgradeBonuses→getRunBonuses→createNewRun→deriveSensorTuning。
// ============================================================
{
  // 直接置 unlockedUpgrades 测 bonus 派生（lv4 续在 salvage_guild lv1-3 之后；purchase 流程已由前面节覆盖）
  const prof9 = {
    ...createInitialGameState().profile,
    unlockedUpgrades: new Set([
      'upgrade.salvage_guild.lv1', 'upgrade.salvage_guild.lv2',
      'upgrade.salvage_guild.lv3', 'upgrade.salvage_guild.lv4',
    ]),
  };
  const sb9 = getUpgradeBonuses(prof9);
  assert(Math.abs(sb9.roomFeatureChanceBonus - 0.18) < 1e-9, '9: salvage_guild lv4 → roomFeatureChanceBonus 0.18');
  // 桥：getRunBonuses 透传 → createNewRun 烤进 run.sensorTuning
  const run9 = createNewRun({ zoneId: 'zone.vertical_test', bonuses: getRunBonuses(prof9) });
  assert(Math.abs(run9.sensorTuning!.roomFeatureChanceBonus - 0.18) < 1e-9, '9: 烤进 run.sensorTuning.roomFeatureChanceBonus');
  // 缺省（未升级）→ 0（mapgen 逐字节不变的护栏）
  const base9 = createNewRun({ zoneId: 'zone.vertical_test' });
  assert(base9.sensorTuning!.roomFeatureChanceBonus === 0, '9: 未升级 → 0（旧图不变）');
  // 升满夹到上限（deriveSensorTuning clamp）
  const cap9 = createNewRun({ zoneId: 'zone.vertical_test', bonuses: { roomFeatureChanceBonus: 99 } });
  assert(cap9.sensorTuning!.roomFeatureChanceBonus === ROOM_FEATURE_CHANCE_MAX, '9: 升满夹到上限 ROOM_FEATURE_CHANCE_MAX');
  // 前置门控：lv4 需先买 lv3
  assert(!canPurchase(createInitialGameState().profile, 'upgrade.salvage_guild.lv4').ok, '9: salvage_guild lv4 需先买 lv3');
  log.push('  salvage_guild lv4 → roomFeatureChanceBonus 0.18 · 烤进 run · 缺省 0 · 夹上限 · 前置门控 ✓');
}

// §10（旧 evasion_rig 规避升级线测试）已随段2「三传感器线退役」删除——规避（吸声 T1 / 迷彩 T2）效果
//   回退基线（deriveSensorTuning 默认·stalker 管线 soundAbsorb/camo 缺省 0）；机制保留、可日后做成
//   防寒服档位件用 base effects 加回（见 CHANGELOG 段2）。规避缺省 0 的护栏改由 playthrough-stalker 守。

pt.done();
