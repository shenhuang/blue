// 拳脚扭打（fallbackOnly）门控专项：验证「有可用武器攻击 ⇒ 隐藏兜底攻击；赤手 / 远程无弹 ⇒ 露出」。
// 机制化 option 1（2026-06-27）：fist 不再常驻菜单——它曾是被刀/斧/带弹远程严格压制（伤更低·体/氧更贵·
// 噪声更高）的死按钮。单点判据 combat.ts::hasUsableWeaponAttack；本测钉死其四个分支，回归里失败即真红。
// 注意：此门只动**可见菜单**（listAvailableActions）；checkActionAvailability/applyPlayerAction 不读它，
// 故 scenario 直接 invoke fist 仍照常生效——既有 combat baseline 不受影响。

import { buildCombatEntryState, type CombatScenarioInput } from '../src/engine/combatScenario';
import { listAvailableActions } from '../src/engine/combat';
import type { EquipmentLoadout, InventoryItem } from '../src/types';

const FIST = 'action.fist';
const COMBAT = 'combat.tutorial_shark'; // 已注册遭遇（与 playthrough-combat 共用）·敌人本身与本测无关

function visibleActionIds(
  equipment: Partial<EquipmentLoadout>,
  inventory: InventoryItem[] = [],
): string[] {
  const input: CombatScenarioInput = { combatId: COMBAT, seed: 1, equipment, inventory };
  const entry = buildCombatEntryState(input);
  if (!entry.state) throw new Error(`构造战斗 state 失败：${entry.errors.join('; ')}`);
  return listAvailableActions(entry.state).map((a) => a.action.id);
}

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error('✗ ' + msg);
}

// 1) 持起手潜水刀（默认 loadout 即 tool=dive_knife·解锁 knife_slash）→ 有可用武器攻击 → 兜底隐藏
const armed = visibleActionIds({});
assert(armed.includes('action.knife_slash'), '持刀应能见刀法');
assert(!armed.includes(FIST), '持刀时拳脚扭打应隐藏（被刀严格压制的死按钮）');

// 2) 卸刀、无远程、无弹 → 没有任何武器攻击 → 兜底露出
const unarmed = visibleActionIds({ tool: null });
assert(!unarmed.includes('action.knife_slash'), '无刀不应见刀法');
assert(unarmed.includes(FIST), '赤手（无装无弹）时拳脚扭打应露出兜底');

// 3) 装鱼叉步枪但**无弹**、无刀 → fire_harpoon 解锁但弹药门不过 → 仍无可用武器攻击 → 兜底露出
const gunNoAmmo = visibleActionIds({
  tool: null,
  ranged: { itemId: 'item.weapon.harpoon_rifle', slot: 'ranged', level: 1 },
});
assert(gunNoAmmo.includes(FIST), '持枪但无弹时拳脚扭打应露出（弹药门把它判为无可用武器攻击）');

// 4) 同上 + 背 1 发鱼叉弹 → fire_harpoon 成为可用武器攻击 → 兜底重新隐藏
const gunWithAmmo = visibleActionIds(
  { tool: null, ranged: { itemId: 'item.weapon.harpoon_rifle', slot: 'ranged', level: 1 } },
  [{ itemId: 'item.ammo.harpoon', qty: 1 }],
);
assert(gunWithAmmo.includes('action.fire_harpoon'), '持枪带弹应能见鱼叉射击');
assert(!gunWithAmmo.includes(FIST), '持枪带弹时拳脚扭打应隐藏');

console.log('✓ fist-fallback 门控 playthrough 完成（持刀隐藏 / 赤手·持枪无弹露出 / 带弹复隐 四例通过）');
