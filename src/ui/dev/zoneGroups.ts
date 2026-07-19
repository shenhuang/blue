// zone 大区分组（dev 桶共享·2026-07-19 自 MapDevPanel 抽取）：
// 按 ZoneDef.regionId 分 5 个大区（顺序/label 单一来源 engine/regions.ts::allRegions·同海图揭示圈顺序）
// + 1 个「未分区/开发测试」兜底桶（深渊无锚点 zone + dev 测试 zone·不强塞进大区）。
// 使用方：PlaytestPanel 左栏（MapDevPanel 2026-07-19 同日删除）——分组逻辑单点维护、免漂移。

import { allRegions } from '@/engine/regions';
import type { ZoneDef } from '@/types';

export const UNCLASSIFIED = 'unclassified' as const;
export type ZoneTabKey = string | typeof UNCLASSIFIED;

export interface ZoneGroup {
  id: ZoneTabKey;
  label: string;
  zones: ZoneDef[];
}

export function groupZonesByRegion(zones: ZoneDef[]): ZoneGroup[] {
  const regionTabs = allRegions().map((r) => ({
    id: r.id as ZoneTabKey,
    label: r.label,
    zones: zones.filter((z) => z.regionId === r.id),
  }));
  const unclassified = zones.filter((z) => !z.regionId);
  return [...regionTabs, { id: UNCLASSIFIED as ZoneTabKey, label: '未分区 / 开发测试', zones: unclassified }];
}
