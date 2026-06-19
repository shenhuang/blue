// 物品注册表（轻量版）
// 现状：items.json 的索引在 death.ts / combat.ts / ui/CorpseView.tsx 各自重复 new Map。
// 这里给一个集中的 getItemDef，新代码统一用它；旧重复以后顺手清。

import type { ItemDef, PlayerProfile } from '@/types';
import itemsData from '@/data/items.json';

interface ItemsFile {
  items: ItemDef[];
}

const ITEMS = (itemsData as unknown as ItemsFile).items;
const INDEX = new Map<string, ItemDef>(ITEMS.map((i) => [i.id, i]));

export function getItemDef(id: string): ItemDef | undefined {
  return INDEX.get(id);
}

export function allItems(): ItemDef[] {
  return ITEMS;
}

// 「可读文献」单一来源规则（#140 续·作者 2026-06-18「提供文字信息的道具应在日志里」）：
// 一件道具是「文献」当且仅当它通过 story.unlocksLoreEntry 关联一条见闻——这类道具携带可读文本
// （航海日志 / 怀表刻字 / 泡水的日志…），在港口物品栏的「日志 tab · 航海志」里陈列、点开读文。
// 反例＝公会浮标 / 锈蚀指南针等纯任务/钥匙道具（无 unlocksLoreEntry）→ 仍归「其它」。
// 数据驱动·零硬编码清单：新加的可读道具只要写了 unlocksLoreEntry 就自动进日志。

/** 该道具关联的见闻 id（＝读它时解锁的那条）；非文献道具返回 undefined。 */
export function documentLoreId(itemId: string): string | undefined {
  return getItemDef(itemId)?.story?.unlocksLoreEntry;
}

/** 该道具是否为「可读文献」（携带文字信息·应在日志 tab 陈列）。 */
export function isDocumentItem(itemId: string): boolean {
  return documentLoreId(itemId) !== undefined;
}

/**
 * 该道具点击时是否「摊开海图」（＝旧海图·解锁海图的信物·作者 2026-06-18）。
 * 数据驱动（story.opensChart·无硬编码 id）；门控仍由调用方（受 tutorial_complete 同口径）把关。
 */
export function itemOpensChart(itemId: string): boolean {
  return getItemDef(itemId)?.story?.opensChart === true;
}

/** 该道具标记的海图坐标（POI id 列表·「文献坐标」功能·缺省＝[]）。可达性/名字由 chart.ts::resolveMarkedPois 解析。 */
export function itemMarkedPois(itemId: string): string[] {
  return getItemDef(itemId)?.story?.marksPois ?? [];
}

/**
 * 玩家「持有的文献」所揭示的海图点集合（物品即解锁·marksPois ⇒ reveal·作者 2026-06-19）：
 * 持有任一标记某点的剧情道具（旧海图 / 导师日志 / 鲸落手记 / 将来藏宝图…）即「已知该坐标」。
 * chart.ts::poiRevealState 据此绕过**发现门**（requiresFlags + 灯塔网/揭示圈），但仍受能力/天气门
 * （知道 ≠ 去得了）。承接并推广 #117「story 锚点＝日志已知坐标」到任意带 marksPois 的道具——
 * 「知道一个坐标」的唯一真相＝你手里有没有写着它的那张纸。数据驱动·零硬编码 id·纯函数（读 profile.inventory）。
 */
export function poisKnownFromItems(profile: PlayerProfile): Set<string> {
  const known = new Set<string>();
  for (const inv of profile.inventory) {
    if (inv.qty <= 0) continue;
    for (const poiId of itemMarkedPois(inv.itemId)) known.add(poiId);
  }
  return known;
}

/**
 * 获得该道具时置位的 story flag 列表（物品即里程碑·`story.setsFlag`·缺省＝[]）。
 * 在 engine/state.ts::acquireIntoProfile 单点兑现——「持有那张纸＝你做过那件事」。
 */
export function itemSetsFlags(itemId: string): string[] {
  return getItemDef(itemId)?.story?.setsFlag ?? [];
}
