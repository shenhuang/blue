// 前哨 ↔ 灯塔映射。
//
// 能源经济（base 能源 + 水力发电 + 容量/在线判定）已删（作者 2026-06-21）：前哨补给设施（充电/充氧）
// 建成即全额生效，不再受「同时在线几个」的能源容量门控。衰减/维护/depot 更早已删（#125）。
// 此处只剩前哨↔灯塔映射，供建造 UI 的 outpostOnly 轨可见性判定。
//
// 单向依赖 lighthouses.ts（本文件 import 它、反之不 import → 无循环）。

import type { OutpostDef } from '@/types';
import { getOutposts } from './lighthouses';

/** 产生某座灯塔的前哨定义（result.id === lighthouseId）；home / ruin 灯塔非前哨 → undefined。 */
export function getOutpostForLighthouse(lighthouseId: string): OutpostDef | undefined {
  return getOutposts().find((o) => o.result.id === lighthouseId);
}
