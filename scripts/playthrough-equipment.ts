// 穿戴装备升级回归（段1·物品栏与装备 SPEC §4·作者 2026-06-19）：
//   §1 getEquipmentStats 在 starter（全 Lv.1·无 step）→ 全 0（护栏：对既有基线零扰动）
//   §2 equipmentMaxLevel = baseLevel + steps.length；无 steps → 恒 baseLevel
//   §3 逐级氧增量按 statDeltas 累加（气瓶 +10/+12/+15）+ 超满级夹紧
//   §4 canUpgradeEquipment 账单门：材料先于金币·空槽/满级各自 reason
//   §5 upgradeEquipment 应用：扣材料+金币·profile.equipment[slot].level+1（持久）
//   §6 getRunBonuses 并入装备氧增量（端到端：升级后随之上升）
//   §7 满级链 + 全账对账
//
// 跑法： npx tsx scripts/playthrough-equipment.ts

import { createInitialGameState, createStarterLoadout } from '../src/engine/state';
import {
  getEquipmentStats,
  equipmentMaxLevel,
  nextUpgradeStep,
  canUpgradeEquipment,
  upgradeEquipment,
} from '../src/engine/equipment';
import { getRunBonuses } from '../src/engine/lighthouses';
import type { GameState, EquipmentLoadout } from '../src/types';

const log: string[] = [];
const L = (s: string) => log.push(s);
function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    console.error(log.join('\n'));
    throw new Error('断言失败：' + msg);
  }
}

// ── §1 starter 全 0 ──
const s0 = getEquipmentStats(createStarterLoadout());
assert(
  s0.oxygenMaxBonus === 0 && s0.staminaMaxBonus === 0 && s0.physicalArmor === 0 && s0.sanityResist === 0 && s0.lightRadius === 0,
  'starter getEquipmentStats 应全 0（护栏：升级增量起手为 0、对既有基线零扰动）',
);
L('§1 starter getEquipmentStats 全 0 ✓');

// ── §2 maxLevel ──
assert(equipmentMaxLevel('item.tank.bluefin_mk1') === 4, '气瓶 maxLevel = 1 + 3 steps = 4');
assert(equipmentMaxLevel('item.dive_knife.standard') === 1, '潜水刀无 upgradeSteps → maxLevel = baseLevel 1');
assert(equipmentMaxLevel('item.coral_shard') === 0, '非装备 → maxLevel 0');
L('§2 equipmentMaxLevel ✓');

// ── §3 逐级氧增量 + 满级夹紧 ──
function tankOxyAt(level: number): number {
  const lo: EquipmentLoadout = { ...createStarterLoadout(), tank: { itemId: 'item.tank.bluefin_mk1', slot: 'tank', level } };
  return getEquipmentStats(lo).oxygenMaxBonus;
}
assert(tankOxyAt(1) === 0, 'Lv1 氧增量 0');
assert(tankOxyAt(2) === 10, 'Lv2 氧增量 10');
assert(tankOxyAt(3) === 22, 'Lv3 氧增量 10+12=22');
assert(tankOxyAt(4) === 37, 'Lv4 氧增量 10+12+15=37');
assert(tankOxyAt(99) === 37, '超满级仍夹在 37（applied 上限 = steps.length）');
assert(nextUpgradeStep({ itemId: 'item.tank.bluefin_mk1', slot: 'tank', level: 4 }) === null, 'Lv4 满级 nextUpgradeStep → null');
L('§3 逐级氧增量 + 满级夹紧 ✓');

// ── §4 账单门 reason ──
const starterLo = createStarterLoadout(); // tank Lv1（有下一步）·ranged 空
let a = canUpgradeEquipment(starterLo, [], 999, 'tank');
assert(!a.ok && a.reason === 'notEnoughMaterials', '无材料 → notEnoughMaterials');
a = canUpgradeEquipment(starterLo, [{ itemId: 'item.shark_tooth', qty: 2 }], 0, 'tank');
assert(!a.ok && a.reason === 'notEnoughGold', '材料够钱不够 → notEnoughGold');
a = canUpgradeEquipment(starterLo, [], 999, 'ranged');
assert(!a.ok && a.reason === 'empty', '空槽 → empty');
a = canUpgradeEquipment(starterLo, [{ itemId: 'item.shark_tooth', qty: 2 }], 999, 'tank');
assert(a.ok, '材料+金币都够 → ok');
L('§4 账单门 reason ✓');

// ── §5 upgradeEquipment 应用 ──
function richState(tankLevel = 1): GameState {
  const base = createInitialGameState();
  return {
    ...base,
    profile: {
      ...base.profile,
      inventory: [
        { itemId: 'item.shark_tooth', qty: 5 },
        { itemId: 'item.brass_fitting', qty: 4 },
        { itemId: 'item.crab_chitin', qty: 3 },
      ],
      bankedGold: 300,
      equipment: { ...createStarterLoadout(), tank: { itemId: 'item.tank.bluefin_mk1', slot: 'tank', level: tankLevel } },
    },
  };
}
let s: GameState = richState();
s = upgradeEquipment(s, 'tank');
assert(s.profile.equipment!.tank!.level === 2, '升级后 tank Lv2');
assert((s.profile.inventory.find((i) => i.itemId === 'item.shark_tooth')?.qty ?? -1) === 3, 'shark_tooth 5-2=3');
assert(s.profile.bankedGold === 260, 'gold 300-40=260');
L('§5 upgradeEquipment 扣账 + level+1 ✓');

// ── §6 getRunBonuses 端到端 ──
const oxy1 = getRunBonuses(richState(1).profile).oxygenMaxBonus;
const oxy2 = getRunBonuses(richState(2).profile).oxygenMaxBonus;
assert(oxy2 - oxy1 === 10, `getRunBonuses 氧增量随气瓶升级 +10（实得 ${oxy2 - oxy1}）`);
L('§6 getRunBonuses 并入装备氧 ✓');

// ── §7 满级链 + 全账对账 ──
let f: GameState = richState();
f = upgradeEquipment(f, 'tank'); // →2
f = upgradeEquipment(f, 'tank'); // →3
f = upgradeEquipment(f, 'tank'); // →4
assert(f.profile.equipment!.tank!.level === 4, '三次升级 → Lv4');
const maxed = canUpgradeEquipment(f.profile.equipment!, f.profile.inventory, f.profile.bankedGold, 'tank');
assert(!maxed.ok && maxed.reason === 'maxed', 'Lv4 → maxed');
assert((f.profile.inventory.find((i) => i.itemId === 'item.shark_tooth')?.qty ?? 0) === 0, 'shark_tooth 5-2-3=0');
assert((f.profile.inventory.find((i) => i.itemId === 'item.brass_fitting')?.qty ?? 0) === 0, 'brass_fitting 4-2-2=0');
assert((f.profile.inventory.find((i) => i.itemId === 'item.crab_chitin')?.qty ?? 0) === 0, 'crab_chitin 3-3=0');
assert(f.profile.bankedGold === 40, 'gold 300-40-80-140=40');
// 满级后再 upgrade = no-op（容错）
const before = JSON.stringify(f.profile.equipment);
f = upgradeEquipment(f, 'tank');
assert(JSON.stringify(f.profile.equipment) === before, '满级再 upgrade → no-op');
L('§7 满级链 + 全账对账 + no-op ✓');

console.log(log.join('\n'));
console.log('playthrough-equipment ✓ 全绿');
