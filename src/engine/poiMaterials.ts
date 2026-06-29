// 港口海图潜点「可能收获」材料派生（只读叶子·2026-06-28·作者要求：选潜点时看见这里可能产出的材料·不剧透）。
//
// 单一真相链（不在此重写任何匹配/路由逻辑）：
//   事件 id 并集  ← poiEvents.poiAllEventIds（= buildEventPool 路由 + open/story/scoped 各钩子源）
//   每事件 loot   ← zones.eventLootItemIds（onEnter + options.outcome + check 成败两支）
//   物品定义       ← items.getItemDef（role/tier/name/category 单源 items.json）
//
// **无剧透唯一闸口**：只保留 category==='material' 的物品——钥匙(other)/剧情(story)/装备/消耗/能力道具一律不出现。
//   ⇒ 想调「露不露某类材料」只改这一个 filter（如要藏 special 跨区件，加 `&& def.role !== 'special'`）。
// 颜色由 UI 按 role 上色（作者 2026-06-28 选定「A 彩色分类」）；本层只产数据 + 确定性排序，不掺表现。

import type { MaterialRole, MaterialTier } from '@/types';
import { poiAllEventIds } from './poiEvents';
import { eventLootItemIds } from './zones';
import { getItemDef } from './items';

export interface HarvestMaterial {
  id: string;
  name: string;
  /** 材料功能角色（驱动 UI 颜色分类）；缺省＝未分类（UI 走中性色）。 */
  role?: MaterialRole;
  tier?: MaterialTier;
}

// 展示顺序：结构 → 光学 → 有机 → 特殊 → 未分类（确定性·与颜色分组一致·便于一眼按大类扫）。
const ROLE_ORDER: Record<MaterialRole, number> = { structural: 0, optic: 1, organic: 2, special: 3 };
const roleRank = (r?: MaterialRole): number => (r ? ROLE_ORDER[r] : 9);

/**
 * 一个 POI 可能收获的材料（去重 + 确定性排序）。key＝anchor 的 id 或 roaming 的 templateId。
 * memoized 上游（derivePoiDivePool）已缓存；本函数轻量、可在 UI 渲染时按选中 POI 直接调。
 */
export function poiHarvestMaterials(key: string): HarvestMaterial[] {
  const out = new Map<string, HarvestMaterial>();
  for (const evId of poiAllEventIds(key)) {
    for (const itemId of eventLootItemIds(evId)) {
      if (out.has(itemId)) continue;
      const def = getItemDef(itemId);
      if (!def || def.category !== 'material') continue; // ← 无剧透闸口
      out.set(itemId, { id: def.id, name: def.name, role: def.role, tier: def.tier });
    }
  }
  return [...out.values()].sort(
    (a, b) =>
      roleRank(a.role) - roleRank(b.role) ||
      (a.tier ?? 0) - (b.tier ?? 0) ||
      a.name.localeCompare(b.name)
  );
}
