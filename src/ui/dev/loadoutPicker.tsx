// 共享装备选择器（数据/逻辑单一来源）—— 潜点（PlaytestPanel）与战斗（CombatDevPanel）dev 面板共用。
//
// 抽出前两边各抄一份 SLOT_LABEL / optionsBySlot 构造 / picks→loadout（改一处漏一处·quirk 类）。
// 只放**纯数据 + 纯函数 + hook**（无 JSX、无 css import）——两个面板各自的三栏布局/样式仍各管各的，
// 只把「哪些件进哪个槽、每槽中文名、picks 如何还原成真实 EquipmentLoadout」收成一处。
//
// 住 src/ui/dev/＝dev 桶：import '@/engine/items' 属 dev→engine（check-boundaries 规则五只禁 game→dev·允许）。

import { useMemo } from 'react';
import type { EquipmentLoadout, EquipmentInstance, EquipmentSlot } from '@/types';
import { EQUIPMENT_SLOTS } from '@/types/items';
import { allItems } from '@/engine/items';

/** 槽 → 中文标签（仅 UI·不进引擎键名）。 */
export const SLOT_LABEL: Record<EquipmentSlot, string> = {
  tank: '气瓶',
  suit: '潜水衣',
  light: '潜水灯',
  sonar: '声呐',
  tool: '武器·主',
  ranged: '武器·副',
  charm: '饰品 1',
  charm2: '饰品 2',
  charm3: '饰品 3',
};

/**
 * dev 默认装备（作者 2026-07-19 #317：**自带声呐**）：声呐＝地图本体（#315/#316），没它图全黑；
 * 其余槽镜像起始装备。战斗面板也复用它作默认对局装备——tool 自带匕首 ⇒ 一进战斗就有攻击可选。
 * 想测「无声呐盲潜」/「赤手空拳」把对应槽改回（空）即可。
 */
export const DEFAULT_PICKS: Record<EquipmentSlot, string | null> = {
  tank: 'item.tank.bluefin_mk1',
  suit: 'item.suit.thermal_basic',
  light: 'item.light.hand_torch',
  sonar: 'item.sonar.handheld',
  tool: 'item.dive_knife.standard',
  ranged: null,
  charm: null,
  charm2: null,
  charm3: null,
};

export interface EquipmentOption {
  id: string;
  name: string;
  baseLevel: number;
}
export type EquipmentOptionsBySlot = Record<EquipmentSlot, EquipmentOption[]>;
/** 每槽当前选中的 itemId（null = 空槽）。 */
export type EquipmentPicks = Record<EquipmentSlot, string | null>;

/**
 * 每槽的全部**基础**装备候选（不含升级档·作者 2026-07-18「先 2」）。
 * 单一来源＝allItems（category==='equipment' 且 equipment.slot 命中）。
 */
export function buildEquipmentOptionsBySlot(): EquipmentOptionsBySlot {
  const map = {} as EquipmentOptionsBySlot;
  for (const slot of EQUIPMENT_SLOTS) {
    map[slot] = allItems()
      .filter((it) => it.category === 'equipment' && it.equipment?.slot === slot)
      .map((it) => ({ id: it.id, name: it.name, baseLevel: it.equipment?.baseLevel ?? 1 }));
  }
  return map;
}

/** React 版：memo 一次（装备表在一次会话内不变）。 */
export function useEquipmentOptionsBySlot(): EquipmentOptionsBySlot {
  return useMemo(() => buildEquipmentOptionsBySlot(), []);
}

/**
 * picks（每槽 itemId | null）→ 真实 EquipmentLoadout（喂引擎入口·startDive / buildCombatEntryState）。
 * 全 9 槽都产出（选空 ⇒ null），故作为 buildEquipment 的 override 时**整体替换**、不残留 starter 槽。
 */
export function picksToLoadout(
  picks: EquipmentPicks,
  optionsBySlot: EquipmentOptionsBySlot,
): EquipmentLoadout {
  const loadout = {} as EquipmentLoadout;
  for (const slot of EQUIPMENT_SLOTS) {
    const id = picks[slot];
    const opt = id ? optionsBySlot[slot].find((o) => o.id === id) : null;
    loadout[slot] = opt
      ? ({ itemId: opt.id, slot, level: opt.baseLevel } as EquipmentInstance)
      : null;
  }
  return loadout;
}
