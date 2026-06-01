// 港口升级引擎
// - 把 src/data/upgrades.json 解析为带索引的注册表
// - 提供 canPurchase / purchaseUpgrade / getUpgradeBonuses

import type {
  GameState,
  PlayerProfile,
  UpgradeBonuses,
  UpgradeDef,
  UpgradeLine,
  UpgradesFile,
} from '@/types';
import upgradesData from '@/data/upgrades.json';
import { appendLog } from './state';

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

/** 一条升级目前是否可购买。返回 reason 解释不可购买的原因 */
export type PurchaseAvailability =
  | { ok: true }
  | { ok: false; reason: 'unknown' | 'alreadyOwned' | 'needsPrev' | 'notEnoughPoints' };

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

  if (profile.buildingPoints < def.cost) {
    return { ok: false, reason: 'notEnoughPoints' };
  }
  return { ok: true };
}

/** 扣除建设值 + 加入 unlockedUpgrades。不在 port phase 时也允许（脚本/测试用） */
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

  let next: GameState = {
    ...state,
    profile: {
      ...state.profile,
      buildingPoints: state.profile.buildingPoints - def.cost,
      unlockedUpgrades,
    },
  };
  next = appendLog(next, {
    tone: 'system',
    text: `港口修缮：${def.name}（-${def.cost} 建设值）。`,
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
