// 穿戴装备实力派生（纯叶子·物品栏与装备 SPEC §4·作者 2026-06-19）
// ──────────────────────────────────────────────────────────────────────────
// 「穿戴件升级带来的属性增量」的**唯一计算点**（仿 #116 负伤双单点的单一来源约定）。
//
// base 激活边界（作者 2026-06-20·A 档位件落地·解 #140 双计·见 quirk #142）：
//   getEquipmentStats 现累加 **base effects（Lv.1）＋ upgradeSteps 增量**，唯一例外＝
//   **氧/体上限的 base 跳过**（oxygenMaxBonus/staminaMaxBonus 的 Lv.1 base ＝ createNewRun 的
//   60/100「地板」·在此读会与地板双计）——其升级增量仍计。故氧/体 run-start 路径逐字节不变
//   （createNewRun 不改·几十处 createNewRun({zoneId}) 仍得 60 氧）。
//   其余 kind（护甲/灯/规避/武器/lightRadius/sonar）base+增量都计：固定属性件（灯/服/charm·无
//   upgradeSteps）数值全在 base effects；声呐/气瓶/武器（可升级件）数值在 upgradeSteps。
//   防双计同步删旧来源：护甲 combat 旧 if(suit)-1 → 改读 eq.physicalArmor；灯/规避旧字面 0 →
//   getRunBonuses 改读 eq.*。氧 60 floor 仍唯一住 createNewRun（未来「按件分氧」再迁、届时删 floor）。
//
// 边界：纯叶子——只 import 类型 + state.ts（库存/日志工具）+ items.ts（getItemDef）。engine↛ui 干净。

import type { GameState, EquipmentLoadout, EquipmentInstance, PlayerProfile } from '@/types';
import type { EquipmentEffect, UpgradeStep, EquipmentSlot, ItemDef, WeaponModMeta } from '@/types/items';
import { getItemDef, allItems, itemSetsFlags } from './items';
import { appendLog, countInInventory, removeFromInventory, addToInventory } from './state';

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
  // 灯/电池/规避「档位件」base 效果累计（A·作者 2026-06-20）：喂 getRunBonuses → deriveSensorTuning 同名旋钮。
  lampEfficiency: number;
  lampRobustness: number;
  lampRangeBonus: number;
  signatureReduction: number;
  soundAbsorbBonus: number;
  camoBonus: number;
  powerMaxBonus: number;
  // 武器件伤害累计（C·作者 2026-06-20）：combat 玩家攻击读。
  weaponDamage: number;
}

export function emptyEquipmentStats(): EquipmentStats {
  return {
    oxygenMaxBonus: 0, staminaMaxBonus: 0, physicalArmor: 0, sanityResist: 0, lightRadius: 0,
    sonarPingCostReduction: 0, sonarRobustness: 0, sonarRangeBonus: 0, sonarScanRangeBonus: 0,
    lampEfficiency: 0, lampRobustness: 0, lampRangeBonus: 0, signatureReduction: 0,
    soundAbsorbBonus: 0, camoBonus: 0, powerMaxBonus: 0, weaponDamage: 0,
  };
}

function addEffects(acc: EquipmentStats, effects: EquipmentEffect[], isBase: boolean): void {
  for (const e of effects) {
    // 氧/体上限的 Lv.1 base ＝ createNewRun 的 60/100「地板」：读 base 时跳过它俩（在此累加会与地板双计·quirk #142）。
    // 升级增量（isBase=false）则全计——增量是纯装备贡献、不碰地板。其余 kind base+增量都计。
    if (isBase && (e.kind === 'oxygenMaxBonus' || e.kind === 'staminaMaxBonus')) continue;
    switch (e.kind) {
      case 'oxygenMaxBonus': acc.oxygenMaxBonus += e.value; break;
      case 'staminaMaxBonus': acc.staminaMaxBonus += e.value; break;
      case 'physicalArmor': acc.physicalArmor += e.value; break;
      case 'sanityResist': acc.sanityResist += e.value; break;
      case 'lightRadius': acc.lightRadius += e.value; break;
      case 'lampEfficiency': acc.lampEfficiency += e.value; break;
      case 'lampRobustness': acc.lampRobustness += e.value; break;
      case 'lampRangeBonus': acc.lampRangeBonus += e.value; break;
      case 'signatureReduction': acc.signatureReduction += e.value; break;
      case 'soundAbsorbBonus': acc.soundAbsorbBonus += e.value; break;
      case 'camoBonus': acc.camoBonus += e.value; break;
      case 'powerMaxBonus': acc.powerMaxBonus += e.value; break;
      case 'weaponDamage': acc.weaponDamage += e.value; break;
      case 'sonarPingCostReduction': acc.sonarPingCostReduction += e.value; break;
      case 'sonarRobustness': acc.sonarRobustness += e.value; break;
      case 'sonarRangeBonus': acc.sonarRangeBonus += e.value; break;
      case 'sonarScanRangeBonus': acc.sonarScanRangeBonus += e.value; break;
      // 'unlocksAction' / 'unlockSonar'：非数值加成·跳过（声呐解锁由 hasSonarEquipped 派生）。
      // grantsCapability 已迁至 ItemDef 顶层字段·不再是 EquipmentEffect·不在此处理。
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
    if (!eq) continue;
    // ① base 效果（Lv.1）：固定属性件（灯/服/charm·无 upgradeSteps）的数值全在这。氧/体 base 跳过防双计（见 addEffects）。
    addEffects(acc, eq.effects, true);
    // ② 升级增量（逐级·全 kind 计）：level=N ⇒ 累加 upgradeSteps[0..N-baseLevel-1].statDeltas。
    if (eq.upgradeSteps) {
      const applied = Math.max(0, Math.min(inst.level - eq.baseLevel, eq.upgradeSteps.length));
      for (let i = 0; i < applied; i++) addEffects(acc, eq.upgradeSteps[i].statDeltas, false);
    }
  }
  return acc;
}

/**
 * 单件武器的伤害加成（base + 升级增量·**只读该槽**）。combat 按 action.requiresEquipment 槽读，
 * 避免用 getEquipmentStats 全局 weaponDamage（会把副手/其它武器的加成串到这一击·语义错·C 2026-06-20）。
 */
export function weaponDamageForSlot(loadout: EquipmentLoadout, slot: EquipmentSlot): number {
  const inst = loadout[slot];
  const eq = inst ? getItemDef(inst.itemId)?.equipment : undefined;
  if (!inst || !eq) return 0;
  let dmg = 0;
  for (const e of eq.effects) if (e.kind === 'weaponDamage') dmg += e.value;
  if (eq.upgradeSteps) {
    const applied = Math.max(0, Math.min(inst.level - eq.baseLevel, eq.upgradeSteps.length));
    for (let i = 0; i < applied; i++)
      for (const e of eq.upgradeSteps[i].statDeltas) if (e.kind === 'weaponDamage') dmg += e.value;
  }
  return dmg;
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

const ACCESSORY_SLOTS: readonly EquipmentSlot[] = ['charm', 'charm2', 'charm3'];

/**
 * 某槽是否已解锁（**engine 单一来源**·EquipmentDoll/equipItem 共用·别在 UI 重写锁逻辑）。
 * 非饰品槽恒解锁；饰品槽按 unlockedAccessorySlots(profile) 渐解（charm 第1槽常开·charm2/3 待 D 项·二章）。
 */
export function isSlotUnlocked(profile: PlayerProfile, slot: EquipmentSlot): boolean {
  const idx = ACCESSORY_SLOTS.indexOf(slot);
  if (idx < 0) return true;
  return idx < unlockedAccessorySlots(profile);
}

// ── 仓库↔槽换装（B·作者 2026-06-20·买/换件模型的地基）──────────────────────────────────
// 单点 equip/unequip：仓库备件（profile.inventory·category equipment）装进槽 / 卸下回仓库。
// **swap-centric·只在固定件（无 upgradeSteps）间换**：可升级件（气瓶/声呐/武器）单副本·在 Otto 升级、
// 不进仓库当备件（playthrough 门焊「可入库备件 ⊆ 无 upgradeSteps」防丢等级·quirk #142）。故 equip 恒置
// level=baseLevel、unequip 把件以 {itemId,qty} 退回仓库——对固定件无损（升级件被 isAtBaseLevel 守挡）。

function itemBaseLevel(itemId: string): number {
  return getItemDef(itemId)?.equipment?.baseLevel ?? 1;
}
function isAtBaseLevel(inst: EquipmentInstance): boolean {
  return inst.level <= itemBaseLevel(inst.itemId);
}

/** 某槽现在可换上的仓库备件（inventory 里 slot 匹配的装备件·qty>0）。 */
export function spareEquipmentForSlot(profile: PlayerProfile, slot: EquipmentSlot): { itemId: string; qty: number }[] {
  return profile.inventory.filter((i) => i.qty > 0 && getItemDef(i.itemId)?.equipment?.slot === slot);
}

export type EquipAvailability =
  | { ok: true }
  | { ok: false; reason: 'notEquippable' | 'notOwned' | 'lockedSlot' | 'wouldLoseUpgrade' };

/** 能否把仓库里的 itemId 装上（须装备件·库存有·目标槽未锁·不挤掉在槽升级件丢等级）。 */
export function canEquipItem(profile: PlayerProfile, itemId: string): EquipAvailability {
  const eq = getItemDef(itemId)?.equipment;
  const loadout = profile.equipment;
  if (!eq || !loadout) return { ok: false, reason: 'notEquippable' };
  if (countInInventory(profile.inventory, itemId) <= 0) return { ok: false, reason: 'notOwned' };
  if (!isSlotUnlocked(profile, eq.slot)) return { ok: false, reason: 'lockedSlot' };
  const current = loadout[eq.slot];
  if (current && !isAtBaseLevel(current)) return { ok: false, reason: 'wouldLoseUpgrade' };
  return { ok: true };
}

/**
 * 把仓库里的 itemId 装上它的槽（旧件退回仓库·持久写 profile）。不可装 → no-op（容错口径同 craft/upgrade）。
 * 仅改 profile，不碰 run（run.equipment 出海时从 profile copy·见 createNewRun）。
 */
export function equipItem(state: GameState, itemId: string): GameState {
  const profile = state.profile;
  if (!canEquipItem(profile, itemId).ok) return state;
  const eq = getItemDef(itemId)!.equipment!;
  const loadout = profile.equipment!;
  const current = loadout[eq.slot];
  let inventory = removeFromInventory(profile.inventory, itemId, 1);
  if (current) inventory = addToInventory(inventory, current.itemId, 1); // 换下的旧件退回仓库
  const inst: EquipmentInstance = { itemId, slot: eq.slot, level: eq.baseLevel };
  const next: GameState = {
    ...state,
    profile: { ...profile, inventory, equipment: { ...loadout, [eq.slot]: inst } },
  };
  const name = getItemDef(itemId)?.name ?? itemId;
  const swapped = current ? `（换下 ${getItemDef(current.itemId)?.name ?? current.itemId}）` : '';
  return appendLog(next, { tone: 'system', text: `装备：${name}${swapped}。` });
}

/** 某槽现在能否卸下（有件 + 该件在基线等级·升级件不卸防丢等级）。 */
export function canUnequipSlot(profile: PlayerProfile, slot: EquipmentSlot): boolean {
  const inst = profile.equipment?.[slot];
  return !!inst && isAtBaseLevel(inst);
}

/**
 * 卸下某槽的件回仓库（持久写 profile）。空槽 / 升级件 → no-op（升级件留在 Otto 管理·防丢等级）。
 */
export function unequipItem(state: GameState, slot: EquipmentSlot): GameState {
  const profile = state.profile;
  const loadout = profile.equipment;
  const current = loadout?.[slot];
  if (!loadout || !current || !isAtBaseLevel(current)) return state;
  const inventory = addToInventory(profile.inventory, current.itemId, 1);
  const next: GameState = {
    ...state,
    profile: { ...profile, inventory, equipment: { ...loadout, [slot]: null } },
  };
  const name = getItemDef(current.itemId)?.name ?? current.itemId;
  return appendLog(next, { tone: 'system', text: `卸下：${name}（回仓库）。` });
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
  let next: GameState = {
    ...state,
    profile: {
      ...state.profile,
      inventory,
      bankedGold: state.profile.bankedGold - eq.craftCost!.gold,
      equipment: { ...loadout, [eq.slot]: inst },
    },
  };
  // 打造件与购买件一样兑现 story.setsFlag（单点约定 acquireIntoProfile·craft 路径不走 inventory·故在此显式补）。
  const setFlags = itemSetsFlags(itemId);
  if (setFlags.length > 0) {
    const flags = new Set(next.profile.flags);
    for (const f of setFlags) flags.add(f);
    next = { ...next, profile: { ...next.profile, flags } };
  }
  const name = getItemDef(itemId)?.name ?? itemId;
  return appendLog(next, { tone: 'system', text: `Otto 打造：${name}（${describeCraftCost(eq.craftCost!)}）。` });
}

function describeCraftCost(cost: { materials: { itemId: string; qty: number }[]; gold: number }): string {
  const mats = cost.materials.map((m) => `${getItemDef(m.itemId)?.name ?? m.itemId}×${m.qty}`).join('、');
  if (cost.gold <= 0) return mats || '免费';
  return mats ? `${mats} ＋ ${cost.gold} 金` : `${cost.gold} 金`;
}

// ════════════════════════════════════════════════════════════════════════════
// 负重档位（武器系统·作者 2026-06-20）
// ════════════════════════════════════════════════════════════════════════════
// 整套穿戴件总负重 → 档位 → 战斗修正（体力消耗倍率·命中率补正）+ 出发过载门。阈值/数值＝提案可调。
// **轻装＝中性基线**（命中最高·体力 ×1·作者 2026-06-20 拍板）：起手装＝8＝轻 ⇒ 全部既有战斗 baseline
// 逐字节不变（新机制只在更重负载下生效）；越重越钝（双方命中都降、行动更费力）；过载＝无法行动 + 拦出发
// （逃生阀门＝卸装即走）。作者答疑：「light 会增加自己和敌人的命中率」——轻档双方都最准、越重越钝（命中补正
// 同一加数同时作用玩家与敌人·见 engine/combat.ts），叠加各敌种自己的 hitBonus（有些更善于黑暗中偷袭）。

export type WeightTier = 'light' | 'medium' | 'heavy' | 'overloaded';

/** 档位阈值（含上界）：0–8 轻 / 9–14 中 / 15–20 重 / 21+ 过载。数值＝提案可调。 */
export function weightTier(weight: number): WeightTier {
  if (weight <= 8) return 'light';
  if (weight <= 14) return 'medium';
  if (weight <= 20) return 'heavy';
  return 'overloaded';
}

/** 整套穿戴件总负重（缺 weight 的件按 0）。遍历 Object.values＝加新槽自动纳入（维护性）。 */
export function totalLoadoutWeight(loadout: EquipmentLoadout): number {
  let w = 0;
  for (const inst of Object.values(loadout) as (EquipmentInstance | null)[]) {
    if (!inst) continue;
    w += getItemDef(inst.itemId)?.weight ?? 0;
  }
  return w;
}

/** 当前负载档位（loadout → 总重 → 档位·单点）。 */
export function loadoutWeightTier(loadout: EquipmentLoadout): WeightTier {
  return weightTier(totalLoadoutWeight(loadout));
}

const WEIGHT_STAMINA_MULT: Record<WeightTier, number> = {
  light: 1, medium: 1.5, heavy: 2, overloaded: 2,
};
/** 行动体力消耗倍率（combat actionCosts 乘进·与负伤 staminaCostMult 相乘·轻＝×1 基线不变）。 */
export function weightStaminaMult(loadout: EquipmentLoadout): number {
  return WEIGHT_STAMINA_MULT[loadoutWeightTier(loadout)];
}

const WEIGHT_HIT_MOD: Record<WeightTier, number> = {
  light: 0, medium: -0.07, heavy: -0.15, overloaded: -0.25,
};
/** 命中率补正（玩家与敌人同此加数·轻＝0 基线·越重双方越钝·combat 命中判定读）。 */
export function weightHitMod(loadout: EquipmentLoadout): number {
  return WEIGHT_HIT_MOD[loadoutWeightTier(loadout)];
}

/** 是否过载（出发门控 + 战斗全行动封锁的单一判据）。 */
export function isOverloaded(loadout: EquipmentLoadout): boolean {
  return loadoutWeightTier(loadout) === 'overloaded';
}

// ════════════════════════════════════════════════════════════════════════════
// 武器解锁行动（unlocksAction·combat 可用性 + 事件 hasEquipment.actionId 共用单点）
// ════════════════════════════════════════════════════════════════════════════
/**
 * 某槽装的件是否解锁了指定行动（读 equipment.effects 的 unlocksAction effect）。数据驱动·零硬编码武器 id。
 *   - combat：带 requiresEquipment 的攻击行动**严格**按此门控——持刀只出刀法、持斧只出斧法、持枪只出对应射击、
 *     盾不解锁任何攻击。起手刀解锁 knife_slash ⇒ 既有战斗逐字节不变。
 *   - 事件：hasEquipment{slot, actionId} 据此判「持救援斧（解锁 action.axe_pry）才有的撬门/破障选项」。
 */
export function equipmentUnlocksAction(
  loadout: EquipmentLoadout,
  slot: EquipmentSlot,
  actionId: string,
): boolean {
  const inst = loadout[slot];
  const eq = inst ? getItemDef(inst.itemId)?.equipment : undefined;
  if (!eq) return false;
  return eq.effects.some((e) => e.kind === 'unlocksAction' && e.actionId === actionId);
}

// ════════════════════════════════════════════════════════════════════════════
// 武器改装组件（装/读·命中效果由 combat 应用·作者 2026-06-20）
// ════════════════════════════════════════════════════════════════════════════
/** 取已装在某槽武器上的改装组件 meta（无武器/无改装/未注册 → undefined）。combat 命中后读它按 effect 分支。 */
export function installedModMeta(loadout: EquipmentLoadout, slot: EquipmentSlot): WeaponModMeta | undefined {
  const inst = loadout[slot];
  if (!inst?.mod) return undefined;
  return getItemDef(inst.mod)?.weaponMod;
}

export type ModInstallAvailability =
  | { ok: true }
  | { ok: false; reason: 'slotUnsupported' | 'noWeapon' | 'noModSlot' | 'notAMod' | 'notOwned' };

/**
 * 能否把 modItemId 装到 slot 的武器上：
 *   - 当前仅近战 tool 槽支持（ranged/未来武器专属组件后续再设计·SPEC 范围外）；
 *   - slot 有武器件、且该件 equipment.modSlot===true；
 *   - modItemId 是 category==='weaponMod' 组件、且库存（profile.inventory）有 ≥1。
 */
export function canInstallMod(
  profile: PlayerProfile,
  slot: EquipmentSlot,
  modItemId: string,
): ModInstallAvailability {
  if (slot !== 'tool') return { ok: false, reason: 'slotUnsupported' };
  const inst = profile.equipment?.[slot];
  const eq = inst ? getItemDef(inst.itemId)?.equipment : undefined;
  if (!inst || !eq) return { ok: false, reason: 'noWeapon' };
  if (!eq.modSlot) return { ok: false, reason: 'noModSlot' };
  if (getItemDef(modItemId)?.category !== 'weaponMod') return { ok: false, reason: 'notAMod' };
  if (countInInventory(profile.inventory, modItemId) <= 0) return { ok: false, reason: 'notOwned' };
  return { ok: true };
}

/**
 * 应用一次改装：扣组件、写 profile.equipment[slot].mod = modItemId（旧 mod 不返还·SPEC）。持久写 profile·不碰 run
 * （run.equipment 出海时从 profile copy）。不可装 → no-op（容错口径同 equip/upgrade/craft）。
 */
export function installMod(state: GameState, slot: EquipmentSlot, modItemId: string): GameState {
  const profile = state.profile;
  if (!canInstallMod(profile, slot, modItemId).ok) return state;
  const loadout = profile.equipment!;
  const inst = loadout[slot]!;
  const inventory = removeFromInventory(profile.inventory, modItemId, 1);
  const next: GameState = {
    ...state,
    profile: { ...profile, inventory, equipment: { ...loadout, [slot]: { ...inst, mod: modItemId } } },
  };
  const wname = getItemDef(inst.itemId)?.name ?? inst.itemId;
  const mname = getItemDef(modItemId)?.name ?? modItemId;
  return appendLog(next, { tone: 'system', text: `改装：${wname} 装上${mname}。` });
}

// ── Dev 免费升级 / 打造 / 改装（?dev 门后·镜像 lighthouses.ts::devBuildAtLighthouse「0 成本」）─────────
// 与设施「测试建造（0 成本）」同口径：跳过材料/金币/持有，真路径（upgrade/craft/install）零触碰，UI 仅
// DEV_TOOLS 渲染（普通玩家恒 false）。便于 dev 一键测武器系统（升级/打造/各改装件），不必先刷料。

/** dev：免料把某槽件升一级（封顶 maxLevel）。无件 / 已满级 → no-op。 */
export function devUpgradeEquipment(state: GameState, slot: keyof EquipmentLoadout): GameState {
  const loadout = state.profile.equipment;
  const inst = loadout?.[slot];
  if (!loadout || !inst) return state;
  if (inst.level >= equipmentMaxLevel(inst.itemId)) return state;
  const next: GameState = {
    ...state,
    profile: { ...state.profile, equipment: { ...loadout, [slot]: { ...inst, level: inst.level + 1 } } },
  };
  const name = getItemDef(inst.itemId)?.name ?? inst.itemId;
  return appendLog(next, { tone: 'system', text: `测试升级（dev·0 成本）：${name} → Lv.${inst.level + 1}。` });
}

/** dev：免料把可打造件打造进空槽（兑现 setsFlag·同 craftEquipment 口径）。槽非空 / 不可打造 → no-op。 */
export function devCraftEquipment(state: GameState, itemId: string): GameState {
  const loadout = state.profile.equipment;
  const eq = getItemDef(itemId)?.equipment;
  if (!loadout || !eq?.craftCost) return state;
  if (loadout[eq.slot]) return state;
  const inst: EquipmentInstance = { itemId, slot: eq.slot, level: eq.baseLevel };
  let next: GameState = {
    ...state,
    profile: { ...state.profile, equipment: { ...loadout, [eq.slot]: inst } },
  };
  const setFlags = itemSetsFlags(itemId);
  if (setFlags.length > 0) {
    const flags = new Set(next.profile.flags);
    for (const f of setFlags) flags.add(f);
    next = { ...next, profile: { ...next.profile, flags } };
  }
  const name = getItemDef(itemId)?.name ?? itemId;
  return appendLog(next, { tone: 'system', text: `测试打造（dev·0 成本）：${name}。` });
}

/** dev：免件把改装组件装上某槽武器（跳过持有/消耗·仅校验该件有 modSlot + modItemId 是 weaponMod）。 */
export function devInstallMod(state: GameState, slot: EquipmentSlot, modItemId: string): GameState {
  const loadout = state.profile.equipment;
  const inst = loadout?.[slot];
  const eq = inst ? getItemDef(inst.itemId)?.equipment : undefined;
  if (!loadout || !inst || !eq?.modSlot) return state;
  if (getItemDef(modItemId)?.category !== 'weaponMod') return state;
  const next: GameState = {
    ...state,
    profile: { ...state.profile, equipment: { ...loadout, [slot]: { ...inst, mod: modItemId } } },
  };
  const wname = getItemDef(inst.itemId)?.name ?? inst.itemId;
  const mname = getItemDef(modItemId)?.name ?? modItemId;
  return appendLog(next, { tone: 'system', text: `测试改装（dev·0 成本）：${wname} 装上${mname}。` });
}
