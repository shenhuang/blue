// 港口海图引擎 —— 纯查询/生成层（无 UI / fs / console 依赖）
// 设计见 src/types/chart.ts。两个核心约定：
//   1. generateChart(profile) 派生自 profile，不写存档：anchor 持久，roaming 按
//      runsCompleted 做种子 → 每次回港换一批（"潮位变了"），零 SAVE_VERSION 影响。
//   2. 两级门控：requiresFlags = 发现（不满足不出现）；requiresUpgrade = 抵达能力
//      （不满足则海图上灰显可见但不能出海）。

import type { ChartPoi, PoiModifier, PlayerProfile, SeaChart } from '@/types';
import chartData from '@/data/chart_pois.json';
import { getUpgradeDef } from './upgrades';
import {
  distanceBetween,
  nearestLighthouse,
  revealRadius,
  getLighthouseBonuses,
  getHomeLighthouse,
  getLighthouseUpgradeDef,
} from './lighthouses';
import { makeLcg } from './rng';

/**
 * 归一化海图距离 → "distance 档"的换算系数（reach，SPEC §4/§9 tunable）。
 * 选 0.3 使现有 4 个锚点从 home 算出的档位与写死值一致（0/1/1/2，不破手感）；
 * roaming 点按几何略有出入（本就是"潮位常变"的机会点）。
 */
export const REACH_NORM_PER_TIER = 0.3;

/** roaming 模板（数据形状：无运行时 id / persistent，generateChart 补齐） */
interface RoamingTemplate {
  templateId: string;
  zoneId: string;
  name: string;
  blurb: string;
  distance: number;
  mapX?: number;
  mapY?: number;
  weight?: number;
  requiresFlags?: string[];
  requiresUpgrade?: string;
  requiresLighthouseUpgrade?: string;
  modifier?: PoiModifier;
}

interface ChartPoiFile {
  anchors: ChartPoi[];
  roamingTemplates: RoamingTemplate[];
}

const FILE = chartData as unknown as ChartPoiFile;

/** 每次出海海图上展示的 roaming 机会点数量 */
const ROAMING_COUNT = 2;

/** requiresFlags 是否全满足 */
function flagsSatisfied(profile: PlayerProfile, requiresFlags?: string[]): boolean {
  if (!requiresFlags) return true;
  return requiresFlags.every((f) => profile.flags.has(f));
}

/**
 * 给定坐标是否被某座已拥有灯塔点亮（落在其 revealRadius 内）。
 * 无坐标 → 默认点亮（不因缺坐标而隐藏，向后兼容）。
 */
function isLit(profile: PlayerProfile, mapX?: number, mapY?: number): boolean {
  if (mapX === undefined || mapY === undefined) return true;
  for (const lh of profile.lighthouses) {
    if (distanceBetween(lh.mapX, lh.mapY, mapX, mapY) <= revealRadius(lh)) return true;
  }
  return false;
}

/** POI 是否被灯塔点亮（reveal，基建地图 Phase C）。 */
export function isPoiLit(profile: PlayerProfile, poi: ChartPoi): boolean {
  return isLit(profile, poi.mapX, poi.mapY);
}

/**
 * POI 是否对玩家"可见"。两道门：
 *   ① requiresFlags 已满足（发现）；② 落在某座已拥有灯塔的点亮半径内（reveal）。
 * home 灯塔默认点亮现有 4 个锚点 + 近端机会点；远端机会点要修复前哨灯塔才点亮。
 */
export function isPoiVisible(profile: PlayerProfile, poi: ChartPoi): boolean {
  return flagsSatisfied(profile, poi.requiresFlags) && isPoiLit(profile, poi);
}

/**
 * POI 不能出海的原因（已假定 visible）。可出海返回 null。
 * 能力门两类：requiresUpgrade（全局随身升级）+ requiresLighthouseUpgrade（家灯塔设施，如船坞）。
 */
export function poiLockReason(profile: PlayerProfile, poi: ChartPoi): string | null {
  if (poi.requiresUpgrade && !profile.unlockedUpgrades.has(poi.requiresUpgrade)) {
    const def = getUpgradeDef(poi.requiresUpgrade);
    return `需要「${def?.name ?? poi.requiresUpgrade}」`;
  }
  if (poi.requiresLighthouseUpgrade) {
    const home = getHomeLighthouse(profile);
    if (!home || !home.builtUpgrades.has(poi.requiresLighthouseUpgrade)) {
      const def = getLighthouseUpgradeDef(poi.requiresLighthouseUpgrade);
      return `需要「${def?.name ?? poi.requiresLighthouseUpgrade}」`;
    }
  }
  return null;
}

/**
 * 一次下潜的"距离档"——按**最近的已拥有灯塔**到该 POI 的归一化距离换算（reach，SPEC §3.4/§4）。
 * 再减最近灯塔的 reachReduction，clamp ≥ 0。无坐标 / 无灯塔 → 退回写死的 poi.distance（fallback）。
 */
export function effectiveDistance(profile: PlayerProfile, poi: ChartPoi): number {
  if (poi.mapX === undefined || poi.mapY === undefined) return poi.distance;
  const near = nearestLighthouse(profile, poi.mapX, poi.mapY);
  if (!near) return poi.distance;
  const tier = Math.round(near.distance / REACH_NORM_PER_TIER);
  return Math.max(0, tier - getLighthouseBonuses(near.lighthouse).reachReduction);
}

/** 是否可从该 POI 出海（可见且无能力门拦截） */
export function isPoiDepartable(profile: PlayerProfile, poi: ChartPoi): boolean {
  return isPoiVisible(profile, poi) && poiLockReason(profile, poi) === null;
}

/** 加权不放回抽 n 个 */
function pickWithoutReplacement(
  templates: RoamingTemplate[],
  n: number,
  rng: () => number,
): RoamingTemplate[] {
  const pool = [...templates];
  const out: RoamingTemplate[] = [];
  while (out.length < n && pool.length > 0) {
    const total = pool.reduce((a, t) => a + (t.weight ?? 1), 0);
    let r = rng() * total;
    let idx = pool.length - 1;
    for (let i = 0; i < pool.length; i++) {
      r -= pool[i].weight ?? 1;
      if (r <= 0) {
        idx = i;
        break;
      }
    }
    out.push(pool[idx]);
    pool.splice(idx, 1);
  }
  return out;
}

/**
 * 生成当前海图。
 * @param opts.profile 玩家档案（门控 + 种子来源）
 * @param opts.rng     可选 RNG（测试可传确定性 rng）；默认按 runsCompleted 种子化
 */
export function generateChart(opts: {
  profile: PlayerProfile;
  rng?: () => number;
}): SeaChart {
  const { profile } = opts;
  // +1 避免 runsCompleted=0 时种子为 0
  const rng = opts.rng ?? makeLcg(profile.runsCompleted + 1);

  const pois: ChartPoi[] = [];

  // anchor：所有"已发现"的都进
  for (const a of FILE.anchors) {
    if (isPoiVisible(profile, a)) pois.push(a);
  }

  // roaming：从"已发现 + 已点亮"的模板里加权不放回抽 ROAMING_COUNT 个
  // （远端机会点不在 home 半径内 → 修复前哨灯塔点亮后才会进池）
  const visibleTemplates = FILE.roamingTemplates.filter(
    (t) => flagsSatisfied(profile, t.requiresFlags) && isLit(profile, t.mapX, t.mapY),
  );
  const picked = pickWithoutReplacement(visibleTemplates, ROAMING_COUNT, rng);
  picked.forEach((t, i) => {
    pois.push({
      id: `poi.roam.${profile.runsCompleted}.${i}`,
      zoneId: t.zoneId,
      name: t.name,
      blurb: t.blurb,
      distance: t.distance,
      mapX: t.mapX,
      mapY: t.mapY,
      modifier: t.modifier,
      persistent: false,
      requiresUpgrade: t.requiresUpgrade,
      requiresLighthouseUpgrade: t.requiresLighthouseUpgrade,
      requiresFlags: t.requiresFlags,
    });
  });

  return { generatedForRun: profile.runsCompleted, pois };
}

/** 从一张海图里按 id 取 POI */
export function getPoiById(chart: SeaChart, poiId: string): ChartPoi | undefined {
  return chart.pois.find((p) => p.id === poiId);
}

/** 人类可读的修正摘要（UI 标签 / CLI 日志用）。无修正返回空数组。 */
export function describeModifier(mod?: PoiModifier): string[] {
  if (!mod) return [];
  const tags: string[] = [];
  if (mod.depthOffset && mod.depthOffset !== 0) {
    tags.push(mod.depthOffset > 0 ? `更深 +${mod.depthOffset}m` : `更浅 ${mod.depthOffset}m`);
  }
  if (mod.current && mod.current !== 'none') {
    tags.push(mod.current === 'strong' ? '急流' : '缓流');
  }
  if (mod.visibility && mod.visibility !== 'clear') {
    tags.push(mod.visibility === 'dark' ? '黑暗' : '浑浊');
  }
  return tags;
}

/** CLI / 日志用的一行描述 */
export function describePoi(profile: PlayerProfile, poi: ChartPoi): string {
  const d = effectiveDistance(profile, poi);
  const dist = d > 0 ? ` 距离${d}` : '';
  const mods = describeModifier(poi.modifier);
  const modStr = mods.length > 0 ? ` [${mods.join('/')}]` : '';
  const lock = poiLockReason(profile, poi);
  const lockStr = lock ? ` (锁:${lock})` : '';
  return `${poi.name} → ${poi.zoneId}${dist}${modStr}${lockStr}`;
}
