// 港口升级 playthrough —— 验证 canPurchase / purchaseUpgrade / getUpgradeBonuses
// + 验证 dialog 的 hasUpgrade gating + 验证气瓶库 lv1 实际改变了 run.oxygenMax
//
// 跑法：npx tsx scripts/playthrough-upgrades.ts

import { createInitialGameState } from '../src/engine/state';
import {
  canPurchase,
  getUpgradeBonuses,
  getUpgradeLines,
  getUnlockedLevelInLine,
  purchaseUpgrade,
} from '../src/engine/upgrades';
import { getDialogNode, getNpc, selectChoice } from '../src/engine/dialog';
import { generateChart, poiLockReason, isPoiDepartable } from '../src/engine/chart';
import type { GameState } from '../src/types';

let state: GameState = createInitialGameState();
const log: string[] = [];

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error('断言失败: ' + msg);
}

// 给玩家一笔虚拟建设值
state = { ...state, profile: { ...state.profile, buildingPoints: 100 } };

log.push('========== 1. 升级数据可读 ==========');
const lines = getUpgradeLines();
log.push(`共 ${lines.length} 条升级线：${lines.map((l) => l.name).join('、')}`);
assert(lines.length === 3, '应有 3 条升级线（船坞 / 打捞行会 / 气瓶库）');

log.push('\n========== 2. 初始购买能力 ==========');
const dockLv1 = 'upgrade.dockyard.lv1';
const dockLv2_NotExist = 'upgrade.dockyard.lv2';
const guildLv2 = 'upgrade.salvage_guild.lv2';
const guildLv1 = 'upgrade.salvage_guild.lv1';

const av1 = canPurchase(state.profile, dockLv1);
log.push(`canPurchase(${dockLv1}) = ${JSON.stringify(av1)}`);
assert(av1.ok, '建设值 100 + 未购买 → 应可购买船坞 lv1');

const av2 = canPurchase(state.profile, guildLv2);
log.push(`canPurchase(${guildLv2}) [跳级] = ${JSON.stringify(av2)}`);
assert(!av2.ok && av2.reason === 'needsPrev', 'lv2 在没买 lv1 前应被前置阻挡');

const av3 = canPurchase(state.profile, dockLv2_NotExist);
log.push(`canPurchase(${dockLv2_NotExist}) [不存在] = ${JSON.stringify(av3)}`);
assert(!av3.ok && av3.reason === 'unknown', '未注册的升级 id 应返回 unknown');

log.push('\n========== 3. 购买扣除建设值 ==========');
const before = state.profile.buildingPoints;
state = purchaseUpgrade(state, dockLv1);
log.push(`船坞 lv1 购买：${before} → ${state.profile.buildingPoints} 建设值`);
assert(state.profile.buildingPoints === before - 10, '应扣除 10 建设值');
assert(state.profile.unlockedUpgrades.has(dockLv1), '应入 unlockedUpgrades');

const av1b = canPurchase(state.profile, dockLv1);
log.push(`再次 canPurchase(${dockLv1}) = ${JSON.stringify(av1b)}`);
assert(!av1b.ok && av1b.reason === 'alreadyOwned', '已购买应返回 alreadyOwned');

log.push('\n========== 4. 升级线进度 ==========');
const salvageLine = lines.find((l) => l.id === 'line.salvage_guild')!;
state = purchaseUpgrade(state, guildLv1);
log.push(`打捞行会进度: lv ${getUnlockedLevelInLine(state.profile, salvageLine)} / 3`);
assert(getUnlockedLevelInLine(state.profile, salvageLine) === 1);

// 现在 lv2 可买了
const av2b = canPurchase(state.profile, guildLv2);
log.push(`buy lv1 后 canPurchase(${guildLv2}) = ${JSON.stringify(av2b)}`);
assert(av2b.ok, '前置满足后 lv2 应可购买');

log.push('\n========== 5. 派生加成聚合 ==========');
state = purchaseUpgrade(state, 'upgrade.tankhouse.lv1');
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
