// 港口海图引擎 —— 纯查询/生成层（无 UI / fs / console 依赖）
// 设计见 src/types/chart.ts。两个核心约定：
//   1. generateChart(profile) 派生自 profile，不写存档：anchor 持久，roaming 按
//      runsCompleted 做种子 → 每次回港换一批（"潮位变了"），零 SAVE_VERSION 影响。
//   2. 两级门控：requiresFlags = 发现（不满足不出现）；requiresUpgrade = 抵达能力
//      （不满足则海图上灰显可见但不能出海）。

import type { ChartPoi, PoiModifier, PlayerProfile, SeaChart } from '@/types';
import chartData from '@/data/chart_pois.json';
import { getUpgradeDef } from './upgrades';
import { makeLcg } from './rng';

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

/** POI 是否对玩家"可见"（requiresFlags 已满足 = 已发现） */
export function isPoiVisible(profile: PlayerProfile, poi: ChartPoi): boolean {
  return flagsSatisfied(profile, poi.requiresFlags);
}

/**
 * POI 不能出海的原因（已假定 visible）。可出海返回 null。
 * 目前唯一的能力门是 requiresUpgrade。
 */
export function poiLockReason(profile: PlayerProfile, poi: ChartPoi): string | null {
  if (poi.requiresUpgrade && !profile.unlockedUpgrades.has(poi.requiresUpgrade)) {
    const def = getUpgradeDef(poi.requiresUpgrade);
    return `需要「${def?.name ?? poi.requiresUpgrade}」`;
  }
  return null;
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

  // roaming：从"已发现"的模板里加权不放回抽 ROAMING_COUNT 个
  const visibleTemplates = FILE.roamingTemplates.filter((t) =>
    flagsSatisfied(profile, t.requiresFlags),
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
  const dist = poi.distance > 0 ? ` 距离${poi.distance}` : '';
  const mods = describeModifier(poi.modifier);
  const modStr = mods.length > 0 ? ` [${mods.join('/')}]` : '';
  const lock = poiLockReason(profile, poi);
  const lockStr = lock ? ` (锁:${lock})` : '';
  return `${poi.name} → ${poi.zoneId}${dist}${modStr}${lockStr}`;
}
