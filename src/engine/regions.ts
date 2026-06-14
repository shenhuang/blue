// 揭示区配置访问层（区域揭示配置化 SPEC）——单一来源 data/chart_regions.json。
// 引擎读 radius（揭示半径·revealRadius 消费）；UI(SeaChartView) 读 palette/shape/label 渲染。
// owner 灯塔 id 全局唯一 → 跨图(ch1/ch2/外传)合并按 owner 索引；Ch.2 只需在 JSON 加一个 mapId 段。
// 零 UI / fs / console 依赖（纯数据查询·engine 安全）。

import type { ChartRegionDef } from '@/types';
import regionsData from '@/data/chart_regions.json';

const FILE = regionsData as unknown as Record<string, { regions: ChartRegionDef[] } | string>;

/** owner 灯塔 id → 区域配置（跨全部地图合并·owner 全局唯一）。 */
const BY_OWNER = new Map<string, ChartRegionDef>();
/** flag-gated（owner-less·按 revealFlag 揭示）的区域配置（按声明顺序）。 */
const FLAG_GATED: ChartRegionDef[] = [];
/** 区域配置不变量违例（加载时收集·regionConfigErrors 暴露给 regress 断言；不抛＝坏数据不白屏，由门拦）。 */
const CONFIG_ERRORS: string[] = [];
for (const key of Object.keys(FILE)) {
  const entry = FILE[key];
  if (key.startsWith('_') || typeof entry === 'string') continue; // 跳过 _doc 等说明字段
  for (const r of entry.regions) {
    const hasOwner = typeof r.owner === 'string' && r.owner.length > 0;
    const hasFlag = typeof r.revealFlag === 'string' && r.revealFlag.length > 0;
    // 不变量：每区恰好「owner 灯塔锚定」或「flag-gated」其一（既非既两者）。
    if (hasOwner === hasFlag) {
      CONFIG_ERRORS.push(
        `区「${r.id}」必须恰好声明 owner 或 revealFlag 其一（owner=${r.owner ?? '∅'} revealFlag=${r.revealFlag ?? '∅'}）`,
      );
    }
    if (hasOwner) {
      BY_OWNER.set(r.owner!, r);
    } else if (hasFlag) {
      // flag-gated 区必须带 center（无 owner 灯塔可取坐标）。
      if (!r.center) CONFIG_ERRORS.push(`flag-gated 区「${r.id}」缺 center（owner-less 区必填圈心）`);
      FLAG_GATED.push(r);
    }
  }
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

/** flag-gated（owner-less·按 revealFlag 揭示的隐藏区·鲸落区起）配置列表（按声明顺序）。 */
export function flagGatedRegions(): ChartRegionDef[] {
  return [...FLAG_GATED];
}

/**
 * 区域配置不变量违例（空数组＝全部合法）。playthrough-chart 断言其为空＝把
 * 「每区恰好 owner 或 revealFlag 其一·flag-gated 必带 center」焊成 regress 门
 * （CLAUDE.md「约定落成机制」）。
 */
export function regionConfigErrors(): string[] {
  return [...CONFIG_ERRORS];
}

/** 全部已配置区域（owner-anchored + flag-gated·按声明顺序·UI 图例/调试用）。 */
export function allRegions(): ChartRegionDef[] {
  return [...BY_OWNER.values(), ...FLAG_GATED];
}
