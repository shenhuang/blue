// 港口升级 playthrough —— 验证 canPurchase / purchaseUpgrade / getUpgradeBonuses
// 双资源账单（材料 ＋ 金币，基建地图 Phase A）：材料不够 / 金币不够 都买不了；够了正确扣材料 + 扣金币。
// + 验证 dialog 的 startDive 加成链路 + 气瓶库 lv1 改 run.oxygenMax + 船坞迁灯塔后的 +1 槽（getRunBonuses）。
//
// 注意（Phase C）：dockyard 已从全局升级迁成**家灯塔「船坞」设施**（lighthouse.dockyard.lv1）。
// 全局升级线现在是 2 条（打捞行会 / 气瓶库）；dockyard 的覆盖移到 playthrough-lighthouse.ts +
// 本脚本 §5/§6/§7（验证它仍给 +1 消耗品槽 + 门控旧灯塔礁）。
//
// 跑法：npx tsx scripts/playthrough-upgrades.ts

import { createInitialGameState, createNewRun, countInInventory, HOME_LIGHTHOUSE_ID } from '../src/engine/state';
import { POWER_MAX, SONAR_PING_COST, LAMP_DEPTH_REACH, SONAR_DEPTH_REACH, ROOM_FEATURE_CHANCE_MAX, STEALTH_BONUS_MAX } from '../src/engine/clarity';
import { SONAR_SCAN_RANGE_MAX, SONAR_DIR_REACH_MAX } from '../src/engine/sonar';
import {
  canPurchase,
  getUpgradeBonuses,
  getUpgradeLines,
  getUnlockedLevelInLine,
  purchaseUpgrade,
} from '../src/engine/upgrades';
import { getRunBonuses } from '../src/engine/lighthouses';
import { getDialogNode, getNpc, selectChoice } from '../src/engine/dialog';
import { generateChart, poiLockReason, isPoiDepartable } from '../src/engine/chart';
import type { GameState, InventoryItem } from '../src/types';

let state: GameState = createInitialGameState();
const log: string[] = [];

function assert(cond: unknown, msg: string) {
  if (!cond) {
    console.error(log.join('\n'));
    throw new Error('断言失败: ' + msg);
  }
}

// 升级账单（与 data/upgrades.json 对齐，改动数值时同步）
//   tankhouse.lv1    = shark_tooth×4, lobster×4          ＋ 25 金
//   salvage_guild.lv1= coral_shard×5, brass_fitting×3    ＋ 30 金
//   salvage_guild.lv2= brass_fitting×4, crab_chitin×3, cave_octopus_beak×2 ＋ 70 金
// 灯塔设施（家灯塔，data/lighthouse_upgrades.json）：
//   lighthouse.dockyard.lv1 = coral_shard×6, old_fishing_net×3 ＋ 20 金（给 +1 消耗品槽）
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
assert(lines.length === 5, '应有 5 条升级线（打捞行会 / 气瓶库 / 声呐组件 / 潜水装备 / 规避装备〔猎手 §3〕；船坞已迁灯塔设施）');

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
// 给足 salvage lv1（coral×5, brass×3 +30）+ lv2（brass×4, chitin×3, beak×2 +70）
state = withProfile(
  [
    { itemId: 'item.coral_shard', qty: 5 },
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
log.push(`global bonuses = ${JSON.stringify({ ...bonuses, unlockedZones: [...bonuses.unlockedZones], unlockedShopItems: [...bonuses.unlockedShopItems] })}`);
assert(bonuses.oxygenMaxBonus === 10, '气瓶库 lv1 给 +10 氧气');
assert(bonuses.preservationBonus === 2, '打捞行会 lv1 给保鲜 +2');
assert(bonuses.revealCorpseHint === true, '打捞行会 lv1 给 corpse hint');
assert(bonuses.extraConsumableSlot === 0, '消耗品槽不再来自全局升级（船坞已迁灯塔）');
// 家灯塔建上船坞 → getRunBonuses 把 +1 槽并进来
const withDock = withHomeDockyard(state);
assert(getRunBonuses(withDock.profile).extraConsumableSlot === 1, '家灯塔船坞 → getRunBonuses 给 +1 槽');
assert(getRunBonuses(state.profile).extraConsumableSlot === 0, '没建船坞 → 0 槽');
log.push('  全局氧/保鲜/提示 ＋ 家灯塔船坞 +1 槽（getRunBonuses 并回）✓');

log.push('\n========== 6. 海图门控：旧灯塔礁（发现 flag ＋ 抵达＝家灯塔船坞） ==========');
// dockyard 迁灯塔后，旧灯塔礁的"抵达"门改读 requiresLighthouseUpgrade（家灯塔 builtUpgrades）。
let s2 = createInitialGameState();
const lhOf = (g: GameState) =>
  generateChart({ profile: g.profile }).pois.find(
    (p) => p.zoneId === 'zone.old_lighthouse_reef' && p.persistent,
  );
assert(!lhOf(s2), '没通教学时旧灯塔礁不应出现在海图（发现门控）');
s2 = { ...s2, profile: { ...s2.profile, flags: new Set(['flag.tutorial_complete']) } };
const lhVisible = lhOf(s2);
assert(lhVisible, '过教学后旧灯塔礁应出现在海图（home 灯塔点亮 + flag 满足）');
assert(!isPoiDepartable(s2.profile, lhVisible!), '只过教学缺船坞 → 可见但不可出海');
assert(poiLockReason(s2.profile, lhVisible!) !== null, '锁定应给出原因');
s2 = withHomeDockyard(s2);
assert(isPoiDepartable(s2.profile, lhOf(s2)!), '通教学 + 家灯塔船坞 → 可出海');
log.push('  ✓ 旧灯塔礁门控：发现=flag.tutorial_complete，抵达=家灯塔 lighthouse.dockyard.lv1');

log.push('\n========== 7. 升级真正改变 run（startDive 链路 ＋ 船坞 +1 槽） ==========');
// 走 Aldo 出海到东礁，断言 run.oxygenMax 带气瓶库加成、inventoryCapacity 带家灯塔船坞 +1 槽
let s3 = createInitialGameState();
s3 = {
  ...s3,
  profile: { ...s3.profile, unlockedUpgrades: new Set(['upgrade.tankhouse.lv1']) },
};
s3 = withHomeDockyard(s3);
const aldo = getNpc('npc.aldo')!;
const root = getDialogNode(aldo.dialogRoot.id)!;
const choiceReady = root.choices!.find((c) => c.id === 'ready')!;
const r1 = selectChoice(s3, root, choiceReady);
s3 = r1.state;
const briefingNode = r1.next!;
const departEast = briefingNode.choices!.find((c) => c.id === 'depart_east')!;
const r2 = selectChoice(s3, briefingNode, departEast);
s3 = r2.state;
log.push(`run.oxygenMax = ${s3.run!.oxygenMax} （应为 60 + 10 = 70）`);
log.push(`run.inventoryCapacity = ${s3.run!.inventoryCapacity} （应为 8 + 1 = 9）`);
assert(s3.run!.oxygenMax === 70, '气瓶库 lv1 应让 oxygenMax = 70');
assert(s3.run!.stats.oxygen === 70, '初始 oxygen 应填到上限');
assert(s3.run!.inventoryCapacity === 9, '家灯塔船坞应让 inventoryCapacity = 9');

log.push('\n========== 8. 深水区 Phase 0 升级轨：传感器随材料成长 ==========');
// 给足 dive_kit lv1-3 + sonar lv1-2 的全部材料 + 金币，逐级买，断言 bonuses → getRunBonuses → createNewRun。
state = createInitialGameState();
state = withProfile(
  [
    { itemId: 'item.coral_shard', qty: 4 }, // dk lv1
    { itemId: 'item.lobster', qty: 3 }, // dk lv1
    { itemId: 'item.brass_fitting', qty: 3 }, // dk lv2
    { itemId: 'item.crab_chitin', qty: 5 }, // dk lv2(2) + dk lv4(3)
    { itemId: 'item.lantern_gland', qty: 5 }, // dk lv3 + sonar lv1 + sonar lv2 + sonar lv5(2)
    { itemId: 'item.cave_octopus_beak', qty: 15 }, // dk lv3(3) + dk lv4(2) + sonar lv1(2) + lv3(2) + lv4(3) + lv5(3)
    { itemId: 'item.eel_skin', qty: 11 }, // sonar lv1(2) + lv2(3) + lv3(3) + lv4(3)
  ],
  1800,
);
state = { ...state, profile: { ...state.profile, unlockedUpgrades: new Set() } };

// 前置门控：lv2 在 lv1 前买不了（即便材料金币都够）
const dkPrereq = canPurchase(state.profile, 'upgrade.dive_kit.lv2');
assert(!dkPrereq.ok && dkPrereq.reason === 'needsPrev', '8: dive_kit lv2 需先买 lv1');
const sonarPrereq = canPurchase(state.profile, 'upgrade.sonar.lv2');
assert(!sonarPrereq.ok && sonarPrereq.reason === 'needsPrev', '8: sonar lv2 需先买 lv1');

for (const id of ['upgrade.dive_kit.lv1', 'upgrade.dive_kit.lv2', 'upgrade.dive_kit.lv3', 'upgrade.dive_kit.lv4', 'upgrade.sonar.lv1', 'upgrade.sonar.lv2', 'upgrade.sonar.lv3', 'upgrade.sonar.lv4', 'upgrade.sonar.lv5']) {
  const av = canPurchase(state.profile, id);
  assert(av.ok, `8: 应可购买 ${id}（${JSON.stringify(av)}）`);
  state = purchaseUpgrade(state, id);
  assert(state.profile.unlockedUpgrades.has(id), `8: ${id} 入账`);
}

const sb = getUpgradeBonuses(state.profile);
log.push(`  传感器升级聚合: powerMax+${sb.powerMaxBonus} ping-${sb.sonarPingCostReduction} lampEff${sb.lampEfficiency} 隐蔽${sb.signatureReduction} 灯抗${sb.lampRobustness} 声抗${sb.sonarRobustness}`);
assert(sb.powerMaxBonus === 40, '8: powerMaxBonus = 20(lv1)+20(lv3)');
assert(sb.lampEfficiency === 0.5, '8: lampEfficiency = 0.5（lv2 聚光灯具）');
assert(sb.signatureReduction === 3, '8: signatureReduction = 3（lv2）');
assert(sb.lampRobustness === 10, '8: lampRobustness = 10（lv3 抗扰灯罩）');
assert(sb.sonarUnlocked === true, '8: 声呐解锁（sonar lv1）');
assert(sb.sonarPingCostReduction === 2, '8: sonarPingCostReduction = 2（sonar lv2）');
assert(sb.sonarRobustness === 20, '8: sonarRobustness = 20（sonar lv2）');
// 深水区 Phase 1 续·节点级 clarity 范围/分辨（dk lv4 灯 reach / sonar lv3 声呐 reach）
assert(sb.lampRangeBonus === 4, '8: lampRangeBonus = 4（dive_kit lv4 远摄灯组）');
assert(sb.sonarRangeBonus === 8, '8: sonarRangeBonus = 8（sonar lv3）');
// 声呐与房间 §8.1：扫描跳数主升级轴（sonar lv4+lv5 各 +1）
assert(sb.sonarScanRangeBonus === 2, '8: sonarScanRangeBonus = 2（sonar lv4 + lv5 各 +1）');

// 桥：getRunBonuses 透传 → createNewRun 把升级烤进 run.powerMax / run.sensorTuning
const rb = getRunBonuses(state.profile);
assert(rb.powerMaxBonus === 40 && rb.sonarRobustness === 20 && rb.sonarUnlocked === true, '8: getRunBonuses 透传升级轨');
const upRun = createNewRun({ zoneId: 'zone.old_lighthouse_reef', bonuses: rb });
assert(upRun.powerMax === POWER_MAX + 40, `8: createNewRun powerMax = ${POWER_MAX}+40`);
assert(upRun.power === upRun.powerMax, '8: 电池起手＝满');
assert(upRun.sensors.sonarUnlocked === true, '8: run 声呐解锁');
assert(upRun.sensorTuning!.pingCost === SONAR_PING_COST - 2, '8: run.sensorTuning.pingCost');
assert(upRun.sensorTuning!.lampDrainMult === 0.5, '8: run.sensorTuning.lampDrainMult');
assert(upRun.sensorTuning!.sonarFalseEchoSanity === 40, '8: run.sensorTuning.sonarFalseEchoSanity');
assert(upRun.sensorTuning!.lampHallucinationSanity === 15, '8: run.sensorTuning.lampHallucinationSanity');
assert(upRun.sensorTuning!.signatureReduction === 3, '8: run.sensorTuning.signatureReduction');
assert(upRun.sensorTuning!.lampDepthReach === LAMP_DEPTH_REACH + 4, '8: run.sensorTuning.lampDepthReach（dk lv4 扩灯 reach）');
assert(upRun.sensorTuning!.sonarDepthReach === SONAR_DEPTH_REACH + 8, '8: run.sensorTuning.sonarDepthReach（sonar lv3 扩声呐 reach）');
// 声呐与房间 §8.1：扫描跳数烤进 run（2 基线 + 2 升级 = 4 = 上限·守「扫不穿整洞/最深」）
assert(upRun.sensorTuning!.sonarScanRange === SONAR_SCAN_RANGE_MAX, '8: run.sensorTuning.sonarScanRange = 上限（sonar lv4+lv5 升满）');
log.push('  dive_kit lv1-4 + sonar lv1-5 → bonuses 聚合 → getRunBonuses 透传 → createNewRun 烤进 run（含扫描范围轴）✓');

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
  const run9 = createNewRun({ zoneId: 'zone.old_lighthouse_reef', bonuses: getRunBonuses(prof9) });
  assert(Math.abs(run9.sensorTuning!.roomFeatureChanceBonus - 0.18) < 1e-9, '9: 烤进 run.sensorTuning.roomFeatureChanceBonus');
  // 缺省（未升级）→ 0（mapgen 逐字节不变的护栏）
  const base9 = createNewRun({ zoneId: 'zone.old_lighthouse_reef' });
  assert(base9.sensorTuning!.roomFeatureChanceBonus === 0, '9: 未升级 → 0（旧图不变）');
  // 升满夹到上限（deriveSensorTuning clamp）
  const cap9 = createNewRun({ zoneId: 'zone.old_lighthouse_reef', bonuses: { roomFeatureChanceBonus: 99 } });
  assert(cap9.sensorTuning!.roomFeatureChanceBonus === ROOM_FEATURE_CHANCE_MAX, '9: 升满夹到上限 ROOM_FEATURE_CHANCE_MAX');
  // 前置门控：lv4 需先买 lv3
  assert(!canPurchase(createInitialGameState().profile, 'upgrade.salvage_guild.lv4').ok, '9: salvage_guild lv4 需先买 lv3');
  log.push('  salvage_guild lv4 → roomFeatureChanceBonus 0.18 · 烤进 run · 缺省 0 · 夹上限 · 前置门控 ✓');
}

// ============================================================
// 10. 猎手规避升级（evasion_rig·猎手 SPEC §3·吸声 T1 / 迷彩 T2）
//    新 soundAbsorbBonus/camoBonus 沿同款传感器桥：UpgradeEffect→getUpgradeBonuses→getRunBonuses→createNewRun→deriveSensorTuning。
// ============================================================
{
  const prof10 = {
    ...createInitialGameState().profile,
    unlockedUpgrades: new Set(['upgrade.evasion_rig.lv1', 'upgrade.evasion_rig.lv2']),
  };
  const sb10 = getUpgradeBonuses(prof10);
  assert(Math.abs(sb10.soundAbsorbBonus - 0.5) < 1e-9, '10: evasion_rig lv1 → soundAbsorbBonus 0.5');
  assert(Math.abs(sb10.camoBonus - 0.5) < 1e-9, '10: evasion_rig lv2 → camoBonus 0.5');
  // 桥：getRunBonuses 透传 → createNewRun 烤进 run.sensorTuning
  const run10 = createNewRun({ zoneId: 'zone.old_lighthouse_reef', bonuses: getRunBonuses(prof10) });
  assert(Math.abs(run10.sensorTuning!.soundAbsorbBonus - 0.5) < 1e-9, '10: 烤进 run.sensorTuning.soundAbsorbBonus');
  assert(Math.abs(run10.sensorTuning!.camoBonus - 0.5) < 1e-9, '10: 烤进 run.sensorTuning.camoBonus');
  // 缺省（未升级）→ 0（advanceStalker 逐字节不变的护栏·向后兼容）
  const base10 = createNewRun({ zoneId: 'zone.old_lighthouse_reef' });
  assert(base10.sensorTuning!.soundAbsorbBonus === 0 && base10.sensorTuning!.camoBonus === 0, '10: 未升级 → 规避 0（向后兼容）');
  // 升满夹到上限 STEALTH_BONUS_MAX
  const cap10 = createNewRun({ zoneId: 'zone.old_lighthouse_reef', bonuses: { soundAbsorbBonus: 99, camoBonus: 99 } });
  assert(cap10.sensorTuning!.soundAbsorbBonus === STEALTH_BONUS_MAX && cap10.sensorTuning!.camoBonus === STEALTH_BONUS_MAX, '10: 升满夹到上限 STEALTH_BONUS_MAX');
  // 前置门控：lv2 需先买 lv1
  assert(!canPurchase(createInitialGameState().profile, 'upgrade.evasion_rig.lv2').ok, '10: evasion_rig lv2 需先买 lv1');
  log.push('  evasion_rig lv1/lv2 → soundAbsorb/camo 0.5 · 烤进 run · 缺省 0 · 夹上限 STEALTH_BONUS_MAX · 前置门控 ✓');
}

// ============================================================
// 11. 定向 ping 各方向 reach 各自升级（sonar lv6/7/8·声呐与房间 §5「各方向 reach 各自升级」）
//    新 sonarDirReachBonus（带 dir 判别）沿同款传感器桥：逐向累加 → deriveSensorTuning 逐向夹 [0, SONAR_DIR_REACH_MAX]。
// ============================================================
{
  const prof11 = {
    ...createInitialGameState().profile,
    unlockedUpgrades: new Set([
      'upgrade.sonar.lv1', 'upgrade.sonar.lv2', 'upgrade.sonar.lv3', 'upgrade.sonar.lv4', 'upgrade.sonar.lv5',
      'upgrade.sonar.lv6', 'upgrade.sonar.lv7', 'upgrade.sonar.lv8',
    ]),
  };
  const sb11 = getUpgradeBonuses(prof11);
  assert(
    sb11.sonarDirReach.deeper === 1 && sb11.sonarDirReach.lateral === 1 && sb11.sonarDirReach.back === 1,
    '11: sonar lv6/7/8 → 逐向 reach 各 +1（deeper/lateral/back）',
  );
  // 桥：getRunBonuses 透传 → createNewRun 烤进 run.sensorTuning（逐向）
  const run11 = createNewRun({ zoneId: 'zone.old_lighthouse_reef', bonuses: getRunBonuses(prof11) });
  assert(
    run11.sensorTuning!.sonarDirReach.deeper === 1 && run11.sensorTuning!.sonarDirReach.back === 1,
    '11: 烤进 run.sensorTuning.sonarDirReach（逐向）',
  );
  // 缺省（未升级）→ 全 0（定向逐字节不变的护栏）
  const base11 = createNewRun({ zoneId: 'zone.old_lighthouse_reef' });
  assert(
    base11.sensorTuning!.sonarDirReach.deeper === 0 && base11.sensorTuning!.sonarDirReach.lateral === 0 && base11.sensorTuning!.sonarDirReach.back === 0,
    '11: 未升级 → 各向 0（定向行为逐字节不变）',
  );
  // 升满逐向夹到上限 SONAR_DIR_REACH_MAX
  const cap11 = createNewRun({ zoneId: 'zone.old_lighthouse_reef', bonuses: { sonarDirReach: { deeper: 99, lateral: 99, back: 99 } } });
  assert(
    cap11.sensorTuning!.sonarDirReach.deeper === SONAR_DIR_REACH_MAX && cap11.sensorTuning!.sonarDirReach.back === SONAR_DIR_REACH_MAX,
    '11: 升满逐向夹到 SONAR_DIR_REACH_MAX',
  );
  // 前置门控：未买 lv5 → 不可买 lv6（线内连续·镜像 §9/§10 的前置断言）
  assert(!canPurchase(createInitialGameState().profile, 'upgrade.sonar.lv6').ok, '11: sonar lv6 需先买 lv5（前置门控）');
  log.push('  sonar lv6/7/8 → 逐向 reach 各 +1 · 烤进 run · 缺省全 0 · 逐向夹上限 SONAR_DIR_REACH_MAX · 前置门控 ✓');
}

console.log(log.join('\n'));
console.log('\n✓ 港口升级 playthrough 通过');
