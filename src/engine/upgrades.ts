// 港口升级引擎
// - 把 src/data/upgrades.json 解析为带索引的注册表
// - 提供 canPurchase / purchaseUpgrade / getUpgradeBonuses

import type {
  GameState,
  MaterialCost,
  PlayerProfile,
  UpgradeBonuses,
  UpgradeCost,
  UpgradeDef,
  UpgradeLine,
  UpgradesFile,
} from '@/types';
import upgradesData from '@/data/upgrades.json';
import { appendLog, countInInventory, removeFromInventory } from './state';
import { getItemDef } from './items';

const file = upgradesData as unknown as UpgradesFile;

const LINES: UpgradeLine[] = file.lines;
const UPGRADE_INDEX: Map<string, { line: UpgradeLine; def: UpgradeDef }> = new Map();
for (const line of LINES) {
  for (const def of line.upgrades) {
    UPGRADE_INDEX.set(def.id, { line, def });
  }
}

/** 全部升级线（按 JSON 中顺序） */
export function getUpgradeLines(): UpgradeLine[] {
  return LINES;
}

export function getUpgradeDef(upgradeId: string): UpgradeDef | undefined {
  return UPGRADE_INDEX.get(upgradeId)?.def;
}

export function getUpgradeLineOf(upgradeId: string): UpgradeLine | undefined {
  return UPGRADE_INDEX.get(upgradeId)?.line;
}

/** 同一 line 内已购的最高 level，没买过返回 0 */
export function getUnlockedLevelInLine(
  profile: PlayerProfile,
  line: UpgradeLine,
): number {
  let lv = 0;
  for (const u of line.upgrades) {
    if (profile.unlockedUpgrades.has(u.id)) lv = Math.max(lv, u.level);
  }
  return lv;
}

/**
 * 一条升级目前是否可购买。返回 reason 解释不可购买的原因。
 * 双资源账单（材料 ＋ 金币）：
 *  - `notEnoughMaterials` 带 `shortfall`（每条 = 还差几个某材料），供 UI 显示"还差 brass_fitting ×2"。
 *  - `notEnoughGold` 带 `goldShort`（还差多少金）。
 * 材料先于金币检查——下深拿料是核心门控，所以"只有钱没有料"会落到 notEnoughMaterials。
 */
export type PurchaseAvailability =
  | { ok: true }
  | { ok: false; reason: 'unknown' | 'alreadyOwned' | 'needsPrev' }
  | { ok: false; reason: 'notEnoughMaterials'; shortfall: MaterialCost[] }
  | { ok: false; reason: 'notEnoughGold'; goldShort: number };

/** 算出账单里还缺哪些材料（owned < qty 的，列出缺口数）。够了返回空数组。 */
export function materialShortfall(
  profile: PlayerProfile,
  cost: UpgradeCost,
): MaterialCost[] {
  const out: MaterialCost[] = [];
  for (const m of cost.materials) {
    const owned = countInInventory(profile.inventory, m.itemId);
    if (owned < m.qty) out.push({ itemId: m.itemId, qty: m.qty - owned });
  }
  return out;
}

export function canPurchase(
  profile: PlayerProfile,
  upgradeId: string,
): PurchaseAvailability {
  const entry = UPGRADE_INDEX.get(upgradeId);
  if (!entry) return { ok: false, reason: 'unknown' };
  const { line, def } = entry;

  if (profile.unlockedUpgrades.has(def.id)) {
    return { ok: false, reason: 'alreadyOwned' };
  }

  // 必须先买 level-1
  const have = getUnlockedLevelInLine(profile, line);
  if (def.level > have + 1) {
    return { ok: false, reason: 'needsPrev' };
  }

  // ① 材料（核心门控）：逐条 countInInventory >= qty
  const shortfall = materialShortfall(profile, def.cost);
  if (shortfall.length > 0) {
    return { ok: false, reason: 'notEnoughMaterials', shortfall };
  }

  // ② 金币：必要但不充分——材料够了才轮到查钱
  if (profile.bankedGold < def.cost.gold) {
    return { ok: false, reason: 'notEnoughGold', goldShort: def.cost.gold - profile.bankedGold };
  }
  return { ok: true };
}

/** 把一份账单格式化成 "珊瑚碎片×6、旧渔网×3 ＋ 20 金"（log + UI 共用，避免两份格式漂移）。 */
export function describeUpgradeCost(cost: UpgradeCost): string {
  const mats = cost.materials
    .map((m) => `${getItemDef(m.itemId)?.name ?? m.itemId}×${m.qty}`)
    .join('、');
  if (cost.gold <= 0) return mats || '免费';
  return mats ? `${mats} ＋ ${cost.gold} 金` : `${cost.gold} 金`;
}

/** 扣材料 ＋ 扣金币 + 加入 unlockedUpgrades。不在 port phase 时也允许（脚本/测试用） */
export function purchaseUpgrade(state: GameState, upgradeId: string): GameState {
  const entry = UPGRADE_INDEX.get(upgradeId);
  if (!entry) {
    console.warn(`Upgrade ${upgradeId} not found`);
    return state;
  }
  const { def } = entry;
  const avail = canPurchase(state.profile, upgradeId);
  if (!avail.ok) {
    console.warn(`Cannot purchase ${upgradeId}: ${avail.reason}`);
    return state;
  }

  const unlockedUpgrades = new Set(state.profile.unlockedUpgrades);
  unlockedUpgrades.add(def.id);

  // 逐条扣材料
  let inventory = state.profile.inventory;
  for (const m of def.cost.materials) {
    inventory = removeFromInventory(inventory, m.itemId, m.qty);
  }

  let next: GameState = {
    ...state,
    profile: {
      ...state.profile,
      inventory,
      bankedGold: state.profile.bankedGold - def.cost.gold,
      unlockedUpgrades,
    },
  };
  next = appendLog(next, {
    tone: 'system',
    text: `港口修缮：${def.name}（${describeUpgradeCost(def.cost)}）。`,
  });
  return next;
}

/** 聚合所有已购升级的派生加成，供 startDive / 检定 / 数据图过滤使用 */
export function getUpgradeBonuses(profile: PlayerProfile): UpgradeBonuses {
  const bonuses: UpgradeBonuses = {
    oxygenMaxBonus: 0,
    staminaMaxBonus: 0,
    extraConsumableSlot: 0,
    preservationBonus: 0,
    revealCorpseHint: false,
    preDiveCorpseSelect: false,
    currentSweepImmune: false,
    sonarUnlocked: false,
    powerMaxBonus: 0,
    sonarPingCostReduction: 0,
    lampEfficiency: 0,
    sonarRobustness: 0,
    lampRobustness: 0,
    signatureReduction: 0,
    lampRangeBonus: 0,
    sonarRangeBonus: 0,
    unlockedZones: new Set(),
    unlockedShopItems: new Set(),
  };

  for (const id of profile.unlockedUpgrades) {
    const def = getUpgradeDef(id);
    if (!def) continue;
    for (const e of def.effects) {
      switch (e.kind) {
        case 'oxygenMaxBonus':
          bonuses.oxygenMaxBonus += e.value;
          break;
        case 'staminaMaxBonus':
          bonuses.staminaMaxBonus += e.value;
          break;
        case 'extraConsumableSlot':
          bonuses.extraConsumableSlot += e.value;
          break;
        case 'preservationBonus':
          // 保鲜按"最大值"取（与 engine/death.ts::getPreservationBonus 保持一致）
          bonuses.preservationBonus = Math.max(bonuses.preservationBonus, e.value);
          break;
        case 'revealCorpseHint':
          bonuses.revealCorpseHint = bonuses.revealCorpseHint || e.value;
          break;
        case 'preDiveCorpseSelect':
          bonuses.preDiveCorpseSelect = bonuses.preDiveCorpseSelect || e.value;
          break;
        case 'currentSweepImmune':
          bonuses.currentSweepImmune = bonuses.currentSweepImmune || e.value;
          break;
        case 'unlockSonar':
          bonuses.sonarUnlocked = bonuses.sonarUnlocked || e.value;
          break;
        // 深水区 Phase 0 升级轨：sum 聚合（地板/上限在 clarity.ts::deriveSensorTuning 出海时统一夹紧）。
        case 'powerMaxBonus':
          bonuses.powerMaxBonus += e.value;
          break;
        case 'sonarPingCostReduction':
          bonuses.sonarPingCostReduction += e.value;
          break;
        case 'lampEfficiency':
          bonuses.lampEfficiency += e.value;
          break;
        case 'sonarRobustness':
          bonuses.sonarRobustness += e.value;
          break;
        case 'lampRobustness':
          bonuses.lampRobustness += e.value;
          break;
        case 'signatureReduction':
          bonuses.signatureReduction += e.value;
          break;
        // 深水区 Phase 1 续·节点级 clarity 范围/分辨（sum 聚合，上限在 deriveSensorTuning）。
        case 'lampRangeBonus':
          bonuses.lampRangeBonus += e.value;
          break;
        case 'sonarRangeBonus':
          bonuses.sonarRangeBonus += e.value;
          break;
        case 'unlockZone':
          bonuses.unlockedZones.add(e.zoneId);
          break;
        case 'unlockShopItem':
          bonuses.unlockedShopItems.add(e.itemId);
          break;
      }
    }
  }
  return bonuses;
}
