// 揭示区配置访问层（区域揭示配置化 SPEC）——单一来源 data/chart_regions.json。
// 引擎读 radius（揭示半径·revealRadius 消费）；UI(SeaChartView) 读 palette/shape/label 渲染。
// owner 灯塔 id 全局唯一 → 跨图(ch1/ch2/外传)合并按 owner 索引；Ch.2 只需在 JSON 加一个 mapId 段。
// 零 UI / fs / console 依赖（纯数据查询·engine 安全）。

import type { ChartRegionDef } from '@/types';
import regionsData from '@/data/chart_regions.json';

const FILE = regionsData as unknown as Record<string, { regions: ChartRegionDef[] } | string>;

/** owner 灯塔 id → 区域配置（跨全部地图合并·owner 全局唯一）。 */
const BY_OWNER = new Map<string, ChartRegionDef>();
for (const key of Object.keys(FILE)) {
  const entry = FILE[key];
  if (key.startsWith('_') || typeof entry === 'string') continue; // 跳过 _doc 等说明字段
  for (const r of entry.regions) BY_OWNER.set(r.owner, r);
}

/**
 * 区域默认揭示半径（owner 未在配置里时回退·替代旧全局 BASE_LIGHT_RADIUS=0.72 巨值）。
 * 适用于：修复的废弃灯塔（ruin）等没有专属区域配置的灯塔——给一个适中的离岸圈，不盖满全图。
 */
export const DEFAULT_REVEAL_RADIUS = 0.18;

/** 按 owner 灯塔 id 取区域配置（无 → undefined）。UI 取 palette/shape/label。 */
export function regionForOwner(lighthouseId: string): ChartRegionDef | undefined {
  return BY_OWNER.get(lighthouseId);
}

/** owner 灯塔的区域揭示半径（无配置回 DEFAULT_REVEAL_RADIUS）。revealRadius 的基准来源。 */
export function regionRadius(lighthouseId: string): number {
  return BY_OWNER.get(lighthouseId)?.radius ?? DEFAULT_REVEAL_RADIUS;
}

/** 全部已配置区域（按声明顺序·UI 图例/调试用）。 */
export function allRegions(): ChartRegionDef[] {
  return [...BY_OWNER.values()];
}
