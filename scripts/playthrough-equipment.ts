// 穿戴装备升级 + 换装回归（段1 升级·作者 2026-06-19 / base 激活 + 换装 + 武器·作者 2026-06-20）：
//   §1 base 激活：starter 读 base（护甲/光照）·氧/体 base 跳过（floor 不双计·quirk #142）+ 净氧仍 60
//   §2 equipmentMaxLevel = baseLevel + steps.length；无 steps → 恒 baseLevel
//   §3 逐级氧增量按 statDeltas 累加（气瓶 +10/+12/+15）+ 超满级夹紧
//   §4 canUpgradeEquipment 账单门：材料先于金币·空槽/满级各自 reason
//   §5 upgradeEquipment 应用：扣材料+金币·profile.equipment[slot].level+1（持久）
//   §6 getRunBonuses 并入装备氧增量（端到端：升级后随之上升）
//   §7 满级链 + 全账对账
//   §8 仓库↔槽换装（equip/unequip·旧件回仓库·护甲随变·升级件守挡防丢等级·B）
//   §9 武器 weaponDamage 按槽读（不跨武器串伤·C）
//   §10 不变量：可入仓库备件 ⊆ 无 upgradeSteps（固定件·防换装丢等级·quirk #142）
//
// 跑法： npx tsx scripts/playthrough-equipment.ts

import { createInitialGameState, createStarterLoadout, createNewRun } from '../src/engine/state';
import {
  getEquipmentStats,
  equipmentMaxLevel,
  nextUpgradeStep,
  canUpgradeEquipment,
  upgradeEquipment,
  spareEquipmentForSlot,
  canEquipItem,
  equipItem,
  canUnequipSlot,
  unequipItem,
  weaponDamageForSlot,
} from '../src/engine/equipment';
import { getRunBonuses } from '../src/engine/lighthouses';
import { isBuyableFromMira } from '../src/engine/port';
import { allItems } from '../src/engine/items';
import type { GameState, EquipmentLoadout } from '../src/types';

const log: string[] = [];
const L = (s: string) => log.push(s);
function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    console.error(log.join('\n'));
    throw new Error('断言失败：' + msg);
  }
}

// ── §1 base 激活：starter 读 base（护甲/光照）+ 氧/体 base 跳过（floor 不双计）+ 净氧 60 ──
const s0 = getEquipmentStats(createStarterLoadout());
assert(s0.physicalArmor === 1, `starter 护甲读 base 防寒服 physicalArmor=1（实得 ${s0.physicalArmor}）`);
assert(s0.lightRadius === 2, `starter 光照读 base 手电 lightRadius=2（实得 ${s0.lightRadius}）`);
assert(
  s0.oxygenMaxBonus === 0 && s0.staminaMaxBonus === 0,
  '氧/体上限 base 跳过（其 Lv.1 base＝createNewRun 60/100 地板·读会双计·quirk #142）',
);
assert(
  s0.lampRangeBonus === 0 && s0.soundAbsorbBonus === 0 && s0.camoBonus === 0 && s0.weaponDamage === 0,
  'starter 灯/规避/武器 base 全 0（起手件无这些）',
);
// 净氧：base 激活后氧 run-start 路径逐字节不变（floor 60 + eq 增量 0）。
assert(
  createNewRun({ zoneId: 'zone.east_reef' }).stats.oxygen === 60,
  '净氧：starter 出海 oxygenMax 仍 60（防双计·floor 60 不变）',
);
L('§1 base 激活：护甲1/光照2 读 base · 氧体 base 跳过 · 净氧 60 ✓');

// ── §2 maxLevel ──
assert(equipmentMaxLevel('item.tank.bluefin_mk1') === 4, '气瓶 maxLevel = 1 + 3 steps = 4');
assert(equipmentMaxLevel('item.dive_knife.standard') === 4, '潜水刀 maxLevel = 1 + 3 weaponDamage steps = 4（C·2026-06-20）');
assert(equipmentMaxLevel('item.suit.thermal_basic') === 1, '基础防寒服无 upgradeSteps → maxLevel = baseLevel 1');
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

// ── §8 仓库↔槽换装（B·作者 2026-06-20）──
function lockerState(): GameState {
  const base = createInitialGameState();
  return {
    ...base,
    profile: {
      ...base.profile,
      inventory: [
        { itemId: 'item.suit.reinforced', qty: 1 },
        { itemId: 'item.light.spotlight', qty: 1 },
      ],
      equipment: createStarterLoadout(),
    },
  };
}
let g: GameState = lockerState();
assert(
  spareEquipmentForSlot(g.profile, 'suit').some((x) => x.itemId === 'item.suit.reinforced'),
  '仓库加固服列为 suit 槽备件',
);
assert(spareEquipmentForSlot(g.profile, 'tank').length === 0, '气瓶槽无备件（单副本·不入仓库）');
assert(canEquipItem(g.profile, 'item.suit.reinforced').ok, '可装加固服');
g = equipItem(g, 'item.suit.reinforced');
assert(g.profile.equipment!.suit!.itemId === 'item.suit.reinforced', '加固服已上身');
assert(
  g.profile.inventory.some((i) => i.itemId === 'item.suit.thermal_basic' && i.qty === 1),
  '换下的基础防寒服回仓库',
);
assert(
  !g.profile.inventory.some((i) => i.itemId === 'item.suit.reinforced' && i.qty > 0),
  '加固服已从仓库取出',
);
assert(getEquipmentStats(g.profile.equipment!).physicalArmor === 3, '换加固服后护甲读 base=3');
assert(canUnequipSlot(g.profile, 'suit'), '加固服可卸（基线等级）');
g = unequipItem(g, 'suit');
assert(g.profile.equipment!.suit === null, 'suit 槽卸空');
assert(
  g.profile.inventory.some((i) => i.itemId === 'item.suit.reinforced' && i.qty === 1),
  '加固服回仓库',
);
// 升级件守挡（防丢等级）：tank Lv2 不可卸 + 卸＝no-op
const upState: GameState = {
  ...g,
  profile: {
    ...g.profile,
    equipment: { ...g.profile.equipment!, tank: { itemId: 'item.tank.bluefin_mk1', slot: 'tank', level: 2 } },
  },
};
assert(!canUnequipSlot(upState.profile, 'tank'), '升级件（tank Lv2）不可卸（防丢等级）');
assert(unequipItem(upState, 'tank').profile.equipment!.tank!.level === 2, '卸升级件 = no-op（tank 仍 Lv2 在槽）');
L('§8 换装：装上/换下回仓库/护甲随变/卸下/升级件守挡 ✓');

// ── §9 武器 weaponDamage 按槽读（C·作者 2026-06-20）──
assert(weaponDamageForSlot(createStarterLoadout(), 'tool') === 0, 'starter 刀 Lv1 weaponDamage 0');
const knifeLo: EquipmentLoadout = {
  ...createStarterLoadout(),
  tool: { itemId: 'item.dive_knife.standard', slot: 'tool', level: 3 },
};
assert(
  weaponDamageForSlot(knifeLo, 'tool') === 5,
  `刀 Lv3 weaponDamage 2+3=5（实得 ${weaponDamageForSlot(knifeLo, 'tool')}）`,
);
assert(weaponDamageForSlot(knifeLo, 'ranged') === 0, '副手空 → 0（不跨武器串伤）');
L('§9 武器 weaponDamage 按槽读 ✓');

// ── §10 不变量：可入仓库备件 ⊆ 无 upgradeSteps（固定件·防换装丢等级·quirk #142）──
// equip 恒置 baseLevel / unequip 退 {itemId,qty} 对固定件无损；可升级件单副本走 Otto·不上 Mira 货架。
for (const def of allItems()) {
  if (!def.equipment) continue;
  if (isBuyableFromMira(def.id)) {
    assert(
      !def.equipment.upgradeSteps,
      `${def.id} 可从 Mira 买（成仓库备件）却有 upgradeSteps——换装会丢等级·应设固定件或改 Otto 打造（quirk #142）`,
    );
  }
}
L('§10 不变量：可买备件 ⊆ 无 upgradeSteps ✓');

console.log(log.join('\n'));
console.log('playthrough-equipment ✓ 全绿');
