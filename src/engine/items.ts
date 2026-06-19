// 物品注册表（轻量版）
// 现状：items.json 的索引在 death.ts / combat.ts / ui/CorpseView.tsx 各自重复 new Map。
// 这里给一个集中的 getItemDef，新代码统一用它；旧重复以后顺手清。

import type { ItemDef } from '@/types';
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
