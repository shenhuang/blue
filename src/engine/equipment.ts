// 穿戴装备实力派生（纯叶子·物品栏与装备 SPEC §4·作者 2026-06-19）
// ──────────────────────────────────────────────────────────────────────────
// 「穿戴件升级带来的属性增量」的**唯一计算点**（仿 #116 负伤双单点的单一来源约定）。
//
// 段1 边界（重要·避免双计）：这里**只累加 upgradeSteps 的 statDeltas**（每级增量），
//   **不**累加 EquipmentMeta.effects 的 base 值——那些 base（如气瓶 oxygenMaxBonus:60、
//   潜水服 physicalArmor:2）当前仍由旧路径消费（氧上限 60 硬编码在 createNewRun；
//   combat 只看 suit 是否存在做 −1）。段1 升级=纯增量叠加，starter（全 Lv.1·无 step）→ 全 0，
//   故 getRunBonuses 并入后对既有基线零扰动。
// 段2：把声呐/潜水灯/规避三条传感器线端口进对应件 upgradeSteps 后，再在此扩出
//   sonar*/lamp*/evasion* 等字段（下游 deriveSensorTuning 不动·只换来源）。
//
// 边界：纯叶子——只 import 类型 + state.ts（库存/日志工具）+ items.ts（getItemDef）。engine↛ui 干净。

import type { GameState, EquipmentLoadout, EquipmentInstance, PlayerProfile } from '@/types';
import type { EquipmentEffect, UpgradeStep, EquipmentSlot, ItemDef } from '@/types/items';
import { getItemDef, allItems } from './items';
import { appendLog, countInInventory, removeFromInventory } from './state';

/** 装备升级累计加成（EquipmentEffect 的数值 kind·unlocksAction/unlockSonar 非数值不计）。 */
export interface EquipmentStats {
  oxygenMaxBonus: number;
  staminaMaxBonus: number;
  physicalArmor: number;
  sanityResist: number;
  lightRadius: number;
  // 声呐件升级增量（段2·作者 2026-06-19）：随 sonar 件 upgradeSteps 累加；
  // getRunBonuses 把这四项喂进 deriveSensorTuning（同名字段·下游形状不变·只换来源）。
  sonarPingCostReduction: number;
  sonarRobustness: number;
  sonarRangeBonus: number;
  sonarScanRangeBonus: number;
}

export function emptyEquipmentStats(): EquipmentStats {
  return {
    oxygenMaxBonus: 0, staminaMaxBonus: 0, physicalArmor: 0, sanityResist: 0, lightRadius: 0,
    sonarPingCostReduction: 0, sonarRobustness: 0, sonarRangeBonus: 0, sonarScanRangeBonus: 0,
  };
}

function addEffects(acc: EquipmentStats, effects: EquipmentEffect[]): void {
  for (const e of effects) {
    switch (e.kind) {
      case 'oxygenMaxBonus': acc.oxygenMaxBonus += e.value; break;
      case 'staminaMaxBonus': acc.staminaMaxBonus += e.value; break;
      case 'physicalArmor': acc.physicalArmor += e.value; break;
      case 'sanityResist': acc.sanityResist += e.value; break;
      case 'lightRadius': acc.lightRadius += e.value; break;
      case 'sonarPingCostReduction': acc.sonarPingCostReduction += e.value; break;
      case 'sonarRobustness': acc.sonarRobustness += e.value; break;
      case 'sonarRangeBonus': acc.sonarRangeBonus += e.value; break;
      case 'sonarScanRangeBonus': acc.sonarScanRangeBonus += e.value; break;
      // 'unlocksAction' / 'unlockSonar'：非数值加成（声呐解锁由 hasSonarEquipped 派生）·跳过
    }
  }
}

/** 该装备件可达最高等级 = baseLevel + 升级步数。无 equipment meta → 0。 */
export function equipmentMaxLevel(itemId: string): number {
  const eq = getItemDef(itemId)?.equipment;
  if (!eq) return 0;
  return eq.baseLevel + (eq.upgradeSteps?.length ?? 0);
}

/**
 * 从当前 level 再升一级要吃的那一步（账单 + 增量）。已满级 / 不可升 → null。
 * 约定：从 Lv.N 升到 Lv.(N+1) 吃 upgradeSteps[N - baseLevel]。
 */
export function nextUpgradeStep(inst: EquipmentInstance): UpgradeStep | null {
  const eq = getItemDef(inst.itemId)?.equipment;
  if (!eq?.upgradeSteps) return null;
  return eq.upgradeSteps[inst.level - eq.baseLevel] ?? null;
}

/**
 * 整套穿戴装备的「升级增量」加成（单点）。getRunBonuses 并入、combat 读 physicalArmor 等。
 * 遍历 Object.values(loadout)＝加新槽自动纳入（不必改这里·维护性）。
 * level=N ⇒ 累加 upgradeSteps[0..N-baseLevel-1].statDeltas。
 */
export function getEquipmentStats(loadout: EquipmentLoadout): EquipmentStats {
  const acc = emptyEquipmentStats();
  for (const inst of Object.values(loadout) as (EquipmentInstance | null)[]) {
    if (!inst) continue;
    const eq = getItemDef(inst.itemId)?.equipment;
    if (!eq?.upgradeSteps) continue;
    const applied = Math.max(0, Math.min(inst.level - eq.baseLevel, eq.upgradeSteps.length));
    for (let i = 0; i < applied; i++) addEffects(acc, eq.upgradeSteps[i].statDeltas);
  }
  return acc;
}

// ── Otto 改装：账单检查 + 应用（港口·写 profile.equipment[slot].level） ──────────────

export type EquipmentUpgradeAvailability =
  | { ok: true }
  | { ok: false; reason: 'empty' | 'maxed' | 'notEnoughMaterials' | 'notEnoughGold'; shortfall?: { itemId: string; qty: number }[]; goldShort?: number };

/** 某槽现在能否升级（材料先于金币检查·与 upgrades.ts::canPurchase 同口径）。 */
export function canUpgradeEquipment(
  loadout: EquipmentLoadout,
  inventory: { itemId: string; qty: number }[],
  bankedGold: number,
  slot: keyof EquipmentLoadout,
): EquipmentUpgradeAvailability {
  const inst = loadout[slot];
  if (!inst) return { ok: false, reason: 'empty' };
  const step = nextUpgradeStep(inst);
  if (!step) return { ok: false, reason: 'maxed' };
  const shortfall: { itemId: string; qty: number }[] = [];
  for (const m of step.materials) {
    const owned = countInInventory(inventory, m.itemId);
    if (owned < m.qty) shortfall.push({ itemId: m.itemId, qty: m.qty - owned });
  }
  if (shortfall.length > 0) return { ok: false, reason: 'notEnoughMaterials', shortfall };
  if (bankedGold < step.gold) return { ok: false, reason: 'notEnoughGold', goldShort: step.gold - bankedGold };
  return { ok: true };
}

/**
 * 应用一次改装：扣材料+金币、profile.equipment[slot].level +1（持久·跨 run 保留）。
 * 不可升级 → 原样 no-op（同 purchaseUpgrade 容错口径）。仅改 profile，不碰 run。
 */
export function upgradeEquipment(state: GameState, slot: keyof EquipmentLoadout): GameState {
  const loadout = state.profile.equipment;
  if (!loadout) return state;
  const avail = canUpgradeEquipment(loadout, state.profile.inventory, state.profile.bankedGold, slot);
  if (!avail.ok) return state;
  const inst = loadout[slot]!;
  const step = nextUpgradeStep(inst)!;

  let inventory = state.profile.inventory;
  for (const m of step.materials) inventory = removeFromInventory(inventory, m.itemId, m.qty);

  const next: GameState = {
    ...state,
    profile: {
      ...state.profile,
      inventory,
      bankedGold: state.profile.bankedGold - step.gold,
      equipment: { ...loadout, [slot]: { ...inst, level: inst.level + 1 } },
    },
  };
  const name = getItemDef(inst.itemId)?.name ?? inst.itemId;
  return appendLog(next, { tone: 'system', text: `Otto 改装：${name} → Lv.${inst.level + 1}。` });
}

// ── 声呐解锁派生 + Otto 打造（从空槽用材料打造一件·段2·作者 2026-06-19） ──────────────────

/**
 * 声呐能力是否已解锁（新模型**单一来源**·段2）：声呐从「升级线 unlockSonar」迁成「Otto 打造的装备件」，
 * 「声呐槽装着一台达基线等级的声呐件」＝旧 upgrade.sonar.lv1 的解锁。getRunBonuses/createNewRun 据此置
 * run.sensors.sonarUnlocked（替代旧 g.sonarUnlocked）。防御：未知 itemId/坏档不算解锁。
 */
export function hasSonarEquipped(loadout: EquipmentLoadout): boolean {
  const inst = loadout.sonar;
  if (!inst) return false;
  const eq = getItemDef(inst.itemId)?.equipment;
  return !!eq && inst.level >= eq.baseLevel;
}

/**
 * 已解锁的饰品槽数（charm / charm2 / charm3 渐解锁·**单一来源**·作者 2026-06-19）。
 * **占位**（段2 D 项「先不接」）：当前恒返 1（只开第 1 个饰品槽·charm2/charm3 锁显「升级解锁」）。
 * 解锁来源（升级 / 里程碑 flag / 材料门）作者待定——定了之后**只改这一处**（读 profile.flags /
 * unlockedUpgrades / 灯塔设施…），EquipmentDoll 等消费方零改。返回 1..3（最多 3 个饰品槽）。
 */
export function unlockedAccessorySlots(_profile: PlayerProfile): number {
  return 1;
}

/** 某槽对应的「可打造件」（equipment.craftCost 非空 + slot 匹配·扫注册表·数据驱动·零硬编码 id）。无 → undefined。 */
export function craftableEquipmentForSlot(slot: EquipmentSlot): ItemDef | undefined {
  return allItems().find((it) => it.equipment?.slot === slot && it.equipment.craftCost);
}

export type EquipmentCraftAvailability =
  | { ok: true }
  | { ok: false; reason: 'occupied' | 'notCraftable' | 'notEnoughMaterials' | 'notEnoughGold'; shortfall?: { itemId: string; qty: number }[]; goldShort?: number };

/** 能否把 itemId 打造进它的槽（槽须空·账单材料先于金币·与 canUpgradeEquipment 同口径）。 */
export function canCraftEquipment(
  loadout: EquipmentLoadout,
  inventory: { itemId: string; qty: number }[],
  bankedGold: number,
  itemId: string,
): EquipmentCraftAvailability {
  const eq = getItemDef(itemId)?.equipment;
  if (!eq?.craftCost) return { ok: false, reason: 'notCraftable' };
  if (loadout[eq.slot]) return { ok: false, reason: 'occupied' };
  const shortfall: { itemId: string; qty: number }[] = [];
  for (const m of eq.craftCost.materials) {
    const owned = countInInventory(inventory, m.itemId);
    if (owned < m.qty) shortfall.push({ itemId: m.itemId, qty: m.qty - owned });
  }
  if (shortfall.length > 0) return { ok: false, reason: 'notEnoughMaterials', shortfall };
  if (bankedGold < eq.craftCost.gold) return { ok: false, reason: 'notEnoughGold', goldShort: eq.craftCost.gold - bankedGold };
  return { ok: true };
}

/**
 * 打造一件进空槽：扣材料+金币、profile.equipment[slot] = { itemId, slot, level: baseLevel }（持久·跨 run）。
 * 不可打造 / 槽已占 / 料不足 → 原样 no-op（同 upgradeEquipment 容错口径）。仅改 profile，不碰 run。
 */
export function craftEquipment(state: GameState, itemId: string): GameState {
  const loadout = state.profile.equipment;
  if (!loadout) return state;
  const avail = canCraftEquipment(loadout, state.profile.inventory, state.profile.bankedGold, itemId);
  if (!avail.ok) return state;
  const eq = getItemDef(itemId)!.equipment!;
  let inventory = state.profile.inventory;
  for (const m of eq.craftCost!.materials) inventory = removeFromInventory(inventory, m.itemId, m.qty);
  const inst: EquipmentInstance = { itemId, slot: eq.slot, level: eq.baseLevel };
  const next: GameState = {
    ...state,
    profile: {
      ...state.profile,
      inventory,
      bankedGold: state.profile.bankedGold - eq.craftCost!.gold,
      equipment: { ...loadout, [eq.slot]: inst },
    },
  };
  const name = getItemDef(itemId)?.name ?? itemId;
  return appendLog(next, { tone: 'system', text: `Otto 打造：${name}（${describeCraftCost(eq.craftCost!)}）。` });
}

function describeCraftCost(cost: { materials: { itemId: string; qty: number }[]; gold: number }): string {
  const mats = cost.materials.map((m) => `${getItemDef(m.itemId)?.name ?? m.itemId}×${m.qty}`).join('、');
  if (cost.gold <= 0) return mats || '免费';
  return mats ? `${mats} ＋ ${cost.gold} 金` : `${cost.gold} 金`;
}
