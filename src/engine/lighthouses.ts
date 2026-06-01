// 灯塔基地引擎（每灯塔设施升级）—— 与全局随身装备升级 engine/upgrades.ts **平行、互不污染**。
// 基建地图 SPEC §3（Phase B：数据模型 + 引擎脚手架）。
//
// 两套升级轨的分工（SPEC §3.3）：
//   - 随身潜水装备（tank/suit/light/tool，全局）→ profile.unlockedUpgrades + getUpgradeBonuses（upgrades.ts）
//   - 灯塔设施（点亮半径/reach/后续服务防御，每灯塔）→ lighthouse.builtUpgrades + getLighthouseBonuses（本文件）
// 账单复用 Phase A 的材料＋金币双资源（materialShortfall / describeUpgradeCost 直接借用，不重复实现）。
//
// Phase B 灯塔 inert：下面这些函数已就位 + 有回归，但游戏流程还没调用它们；
// 设施效果（LighthouseBonuses）由 Phase C 的 chart.ts（reveal）/ dive.ts（reach distance）消费。

import type {
  GameState,
  Lighthouse,
  LighthouseBonuses,
  LighthouseTrack,
  LighthouseUpgradeDef,
  LighthouseUpgradesFile,
  MaterialCost,
  PlayerProfile,
} from '@/types';
import lighthouseData from '@/data/lighthouse_upgrades.json';
import { appendLog, removeFromInventory } from './state';
import { materialShortfall, describeUpgradeCost } from './upgrades';

const file = lighthouseData as unknown as LighthouseUpgradesFile;
const TRACKS: LighthouseTrack[] = file.tracks;
const INDEX = new Map<string, { track: LighthouseTrack; def: LighthouseUpgradeDef }>();
for (const track of TRACKS) {
  for (const def of track.upgrades) INDEX.set(def.id, { track, def });
}

/** 全部灯塔设施升级轨（按 JSON 顺序）。 */
export function getLighthouseTracks(): LighthouseTrack[] {
  return TRACKS;
}

export function getLighthouseUpgradeDef(id: string): LighthouseUpgradeDef | undefined {
  return INDEX.get(id)?.def;
}

/** 按 id 取某座灯塔（找不到 undefined）。 */
export function getLighthouse(profile: PlayerProfile, lighthouseId: string): Lighthouse | undefined {
  return profile.lighthouses.find((l) => l.id === lighthouseId);
}

/** 某座灯塔在某轨内已建的最高 level（没建过返回 0）。 */
export function getBuiltLevelInTrack(lighthouse: Lighthouse, track: LighthouseTrack): number {
  let lv = 0;
  for (const u of track.upgrades) {
    if (lighthouse.builtUpgrades.has(u.id)) lv = Math.max(lv, u.level);
  }
  return lv;
}

/** 一条灯塔设施升级当前是否可建。reason 解释不可建的原因（与全局 upgrades 的 PurchaseAvailability 平行）。 */
export type LighthouseBuildAvailability =
  | { ok: true }
  | { ok: false; reason: 'unknown' | 'alreadyBuilt' | 'needsPrev' | 'needsLighthouseLevel' }
  | { ok: false; reason: 'notEnoughMaterials'; shortfall: MaterialCost[] }
  | { ok: false; reason: 'notEnoughGold'; goldShort: number };

export function canBuildAt(
  profile: PlayerProfile,
  lighthouse: Lighthouse,
  upgradeId: string,
): LighthouseBuildAvailability {
  const entry = INDEX.get(upgradeId);
  if (!entry) return { ok: false, reason: 'unknown' };
  const { track, def } = entry;

  if (lighthouse.builtUpgrades.has(def.id)) return { ok: false, reason: 'alreadyBuilt' };

  // 同轨必须先建低一级
  const have = getBuiltLevelInTrack(lighthouse, track);
  if (def.level > have + 1) return { ok: false, reason: 'needsPrev' };

  // 灯塔 level 门槛（缺省 1）
  if (lighthouse.level < (def.requiresLighthouseLevel ?? 1)) {
    return { ok: false, reason: 'needsLighthouseLevel' };
  }

  // 双资源账单：材料先于金币（同全局升级，材料是核心门控）
  const shortfall = materialShortfall(profile, def.cost);
  if (shortfall.length > 0) return { ok: false, reason: 'notEnoughMaterials', shortfall };
  if (profile.bankedGold < def.cost.gold) {
    return { ok: false, reason: 'notEnoughGold', goldShort: def.cost.gold - profile.bankedGold };
  }
  return { ok: true };
}

/** 在某灯塔建一条设施升级：扣材料 ＋ 扣金币 + 写入该灯塔 builtUpgrades（不可建时 no-op）。 */
export function buildAtLighthouse(
  state: GameState,
  lighthouseId: string,
  upgradeId: string,
): GameState {
  const entry = INDEX.get(upgradeId);
  if (!entry) {
    console.warn(`Lighthouse upgrade ${upgradeId} not found`);
    return state;
  }
  const { def } = entry;
  const idx = state.profile.lighthouses.findIndex((l) => l.id === lighthouseId);
  if (idx < 0) {
    console.warn(`Lighthouse ${lighthouseId} not found`);
    return state;
  }
  const lighthouse = state.profile.lighthouses[idx];
  const avail = canBuildAt(state.profile, lighthouse, upgradeId);
  if (!avail.ok) {
    console.warn(`Cannot build ${upgradeId} at ${lighthouseId}: ${avail.reason}`);
    return state;
  }

  // 扣材料
  let inventory = state.profile.inventory;
  for (const m of def.cost.materials) {
    inventory = removeFromInventory(inventory, m.itemId, m.qty);
  }

  // 写入该灯塔的 builtUpgrades（不可变更新：只换这一座）
  const builtUpgrades = new Set(lighthouse.builtUpgrades);
  builtUpgrades.add(def.id);
  const lighthouses = state.profile.lighthouses.map((l, i) =>
    i === idx ? { ...l, builtUpgrades } : l,
  );

  let next: GameState = {
    ...state,
    profile: {
      ...state.profile,
      inventory,
      bankedGold: state.profile.bankedGold - def.cost.gold,
      lighthouses,
    },
  };
  next = appendLog(next, {
    tone: 'system',
    text: `灯塔修缮（${lighthouse.name}）：${def.name}（${describeUpgradeCost(def.cost)}）。`,
  });
  return next;
}

/** 聚合某座灯塔已建设施的派生加成（Phase C 读取消费 reveal/reach）。 */
export function getLighthouseBonuses(lighthouse: Lighthouse): LighthouseBonuses {
  const bonuses: LighthouseBonuses = { lightRadiusBonus: 0, reachReduction: 0 };
  for (const id of lighthouse.builtUpgrades) {
    const def = getLighthouseUpgradeDef(id);
    if (!def) continue;
    for (const e of def.effects) {
      switch (e.kind) {
        case 'lightRadiusBonus':
          bonuses.lightRadiusBonus += e.value;
          break;
        case 'reachReduction':
          bonuses.reachReduction += e.value;
          break;
      }
    }
  }
  return bonuses;
}

/** 海图归一化坐标上的欧氏距离。 */
export function distanceBetween(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by);
}

/**
 * 离给定坐标最近的已拥有灯塔 + 距离（无灯塔 → null）。
 * Phase C 用它把"出海 distance"从写死数字过渡到"按最近灯塔算"（SPEC §3.4 reach / §4）。
 */
export function nearestLighthouse(
  profile: PlayerProfile,
  mapX: number,
  mapY: number,
): { lighthouse: Lighthouse; distance: number } | null {
  let best: { lighthouse: Lighthouse; distance: number } | null = null;
  for (const lh of profile.lighthouses) {
    const distance = distanceBetween(lh.mapX, lh.mapY, mapX, mapY);
    if (!best || distance < best.distance) best = { lighthouse: lh, distance };
  }
  return best;
}
