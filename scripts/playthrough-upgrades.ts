// 港口升级 playthrough —— 验证 canPurchase / purchaseUpgrade / getUpgradeBonuses
// 双资源账单（材料 ＋ 金币，基建地图 Phase A）：材料不够 / 金币不够 都买不了；够了正确扣材料 + 扣金币。
// + 验证 dialog 的 hasUpgrade gating + 验证气瓶库 lv1 实际改变了 run.oxygenMax
//
// 跑法：npx tsx scripts/playthrough-upgrades.ts

import { createInitialGameState, countInInventory } from '../src/engine/state';
import {
  canPurchase,
  getUpgradeBonuses,
  getUpgradeLines,
  getUnlockedLevelInLine,
  purchaseUpgrade,
} from '../src/engine/upgrades';
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
//   dockyard.lv1     = coral_shard×6, old_fishing_net×3  ＋ 20 金
//   tankhouse.lv1    = shark_tooth×4, lobster×4          ＋ 25 金
//   salvage_guild.lv1= coral_shard×5, brass_fitting×3    ＋ 30 金
//   salvage_guild.lv2= brass_fitting×4, crab_chitin×3, cave_octopus_beak×2 ＋ 70 金
const dockLv1 = 'upgrade.dockyard.lv1';
const dockLv2_NotExist = 'upgrade.dockyard.lv2';
const guildLv1 = 'upgrade.salvage_guild.lv1';
const guildLv2 = 'upgrade.salvage_guild.lv2';
const tankLv1 = 'upgrade.tankhouse.lv1';

function withProfile(inv: InventoryItem[], gold: number): GameState {
  return { ...state, profile: { ...state.profile, inventory: inv.map((i) => ({ ...i })), bankedGold: gold } };
}

log.push('========== 1. 升级数据可读 ==========');
const lines = getUpgradeLines();
log.push(`共 ${lines.length} 条升级线：${lines.map((l) => l.name).join('、')}`);
assert(lines.length === 3, '应有 3 条升级线（船坞 / 打捞行会 / 气瓶库）');

log.push('\n========== 2. 双资源门控：材料不够 / 金币不够 都买不了 ==========');
// (a) 空仓 + 满金 → 材料不足（金币买不了升级——下深拿料是核心门控）
state = withProfile([], 9999);
const avNoMat = canPurchase(state.profile, dockLv1);
log.push(`空仓+满金 canPurchase(${dockLv1}) = ${JSON.stringify(avNoMat)}`);
assert(!avNoMat.ok && avNoMat.reason === 'notEnoughMaterials', '只有金币没材料 → notEnoughMaterials（金币买不了升级）');
assert(
  avNoMat.reason === 'notEnoughMaterials' &&
    avNoMat.shortfall.find((m) => m.itemId === 'item.coral_shard')?.qty === 6 &&
    avNoMat.shortfall.find((m) => m.itemId === 'item.old_fishing_net')?.qty === 3,
  'shortfall 应列出完整缺口（coral×6, net×3）',
);

// (b) 部分材料 → shortfall 只列差额
state = withProfile([{ itemId: 'item.coral_shard', qty: 4 }, { itemId: 'item.old_fishing_net', qty: 3 }], 9999);
const avPartial = canPurchase(state.profile, dockLv1);
log.push(`部分材料 canPurchase(${dockLv1}) = ${JSON.stringify(avPartial)}`);
assert(
  !avPartial.ok && avPartial.reason === 'notEnoughMaterials' &&
    avPartial.shortfall.length === 1 && avPartial.shortfall[0].itemId === 'item.coral_shard' &&
    avPartial.shortfall[0].qty === 2,
  '已有 coral×4 → 只差 coral×2，net 不缺',
);

// (c) 材料够、金币不够 → notEnoughGold
state = withProfile([{ itemId: 'item.coral_shard', qty: 6 }, { itemId: 'item.old_fishing_net', qty: 3 }], 5);
const avNoGold = canPurchase(state.profile, dockLv1);
log.push(`材料够+金币 5 canPurchase(${dockLv1}) = ${JSON.stringify(avNoGold)}`);
assert(!avNoGold.ok && avNoGold.reason === 'notEnoughGold' && avNoGold.goldShort === 15, '材料够但金币 5<20 → notEnoughGold 差 15');

// (d) purchaseUpgrade 在不可购买时是 no-op（不偷扣材料/金币）
const noOp = purchaseUpgrade(state, dockLv1);
assert(noOp === state, '账单不满足时 purchaseUpgrade 应 no-op（原样返回）');

// (e) 前置 / 不存在
state = withProfile([{ itemId: 'item.brass_fitting', qty: 9 }, { itemId: 'item.crab_chitin', qty: 9 }, { itemId: 'item.cave_octopus_beak', qty: 9 }], 9999);
const avPrereq = canPurchase(state.profile, guildLv2);
log.push(`canPurchase(${guildLv2}) [跳级] = ${JSON.stringify(avPrereq)}`);
assert(!avPrereq.ok && avPrereq.reason === 'needsPrev', 'lv2 在没买 lv1 前应被前置阻挡（即便材料金币都够）');
const avUnknown = canPurchase(state.profile, dockLv2_NotExist);
assert(!avUnknown.ok && avUnknown.reason === 'unknown', '未注册的升级 id 应返回 unknown');

log.push('\n========== 3. 购买正确扣材料 ＋ 扣金币 ==========');
// 给足 dockyard.lv1：coral×6, net×3 + 富余 coral；金币 100
state = withProfile([{ itemId: 'item.coral_shard', qty: 8 }, { itemId: 'item.old_fishing_net', qty: 3 }], 100);
const avOk = canPurchase(state.profile, dockLv1);
assert(avOk.ok, '材料 + 金币都够 → 应可购买');
const goldBefore = state.profile.bankedGold;
state = purchaseUpgrade(state, dockLv1);
log.push(`船坞 lv1 后：coral=${countInInventory(state.profile.inventory, 'item.coral_shard')}（应 2）, net=${countInInventory(state.profile.inventory, 'item.old_fishing_net')}（应 0）, 金 ${goldBefore}→${state.profile.bankedGold}（应 -20）`);
assert(countInInventory(state.profile.inventory, 'item.coral_shard') === 2, 'coral 应扣到 8-6=2');
assert(countInInventory(state.profile.inventory, 'item.old_fishing_net') === 0, 'net 应扣到 3-3=0（清空移出）');
assert(state.profile.bankedGold === goldBefore - 20, '应扣 20 金');
assert(state.profile.unlockedUpgrades.has(dockLv1), '应入 unlockedUpgrades');

const avOwned = canPurchase(state.profile, dockLv1);
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

log.push('\n========== 5. 派生加成聚合 ==========');
// 重置成"已购 dockyard.lv1 + salvage lv1 + 给足 tankhouse 账单"
state = createInitialGameState();
state = {
  ...state,
  profile: {
    ...state.profile,
    unlockedUpgrades: new Set([dockLv1, guildLv1]),
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
log.push(`bonuses = ${JSON.stringify({ ...bonuses, unlockedZones: [...bonuses.unlockedZones], unlockedShopItems: [...bonuses.unlockedShopItems] })}`);
assert(bonuses.oxygenMaxBonus === 10, '气瓶库 lv1 给 +10 氧气');
assert(bonuses.extraConsumableSlot === 1, '船坞 lv1 给 +1 消耗品槽');
assert(bonuses.preservationBonus === 2, '打捞行会 lv1 给保鲜 +2');
assert(bonuses.revealCorpseHint === true, '打捞行会 lv1 给 corpse hint');
assert(bonuses.unlockedZones.has('zone.old_lighthouse_reef'), '船坞 lv1 解锁旧灯塔礁');

log.push('\n========== 6. 海图的 hasUpgrade gating ==========');
// 升级门控已从 Aldo 对话迁到海图 POI（requiresUpgrade）。验证旧灯塔礁两级门控：
// 发现（requiresFlags=flag.tutorial_complete）+ 抵达（requiresUpgrade=dockyard.lv1）。
let s2 = createInitialGameState();
const lhOf = (g: GameState) =>
  generateChart({ profile: g.profile }).pois.find(
    (p) => p.zoneId === 'zone.old_lighthouse_reef' && p.persistent,
  );
assert(!lhOf(s2), '没通教学时旧灯塔礁不应出现在海图（发现门控）');
s2 = { ...s2, profile: { ...s2.profile, flags: new Set(['flag.tutorial_complete']) } };
const lhVisible = lhOf(s2);
assert(lhVisible, '过教学后旧灯塔礁应出现在海图（可见）');
assert(!isPoiDepartable(s2.profile, lhVisible!), '只过教学缺船坞 lv1 → 可见但不可出海');
assert(poiLockReason(s2.profile, lhVisible!) !== null, '锁定应给出原因');
s2 = { ...s2, profile: { ...s2.profile, unlockedUpgrades: new Set(['upgrade.dockyard.lv1']) } };
assert(isPoiDepartable(s2.profile, lhOf(s2)!), '通教学 + 船坞 lv1 → 可出海');
log.push('  ✓ 旧灯塔礁门控迁到海图：发现=flag.tutorial_complete，抵达=dockyard.lv1');

log.push('\n========== 7. 升级真正改变 run（startDive 链路） ==========');
// 走 Aldo 出海到东礁，断言 run.oxygenMax 已经带上气瓶库 lv1 加成
let s3 = createInitialGameState();
s3 = {
  ...s3,
  profile: { ...s3.profile, unlockedUpgrades: new Set(['upgrade.tankhouse.lv1', 'upgrade.dockyard.lv1']) },
};
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
log.push(`run.stats.oxygen = ${s3.run!.stats.oxygen}`);
log.push(`run.inventoryCapacity = ${s3.run!.inventoryCapacity} （应为 8 + 1 = 9）`);
assert(s3.run!.oxygenMax === 70, '气瓶库 lv1 应让 oxygenMax = 70');
assert(s3.run!.stats.oxygen === 70, '初始 oxygen 应填到上限');
assert(s3.run!.inventoryCapacity === 9, '船坞 lv1 应让 inventoryCapacity = 9');

console.log(log.join('\n'));
console.log('\n✓ 港口升级 playthrough 通过');
