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

/**
 * 某物品 qty 件的合计重量（kg·背包承载制的单一来源·作者 2026-06-21 由「格数」改「重量」）。
 * 按 qty **线性**累计（矿物/弹药/消耗品同口径），单件缺 weight 兜底 0.5。
 * dive-start::applyCarryItems / carry 容量 / events 拾取超载 / UI 行前装包共用。
 */
export function weightForItem(itemId: string, qty: number): number {
  if (qty <= 0) return 0;
  return (getItemDef(itemId)?.weight ?? 0.5) * qty;
}

/**
 * @deprecated 背包承载已由「格数」改「重量」（作者 2026-06-21·见 weightForItem / RUN_CARRY_WEIGHT）。
 * 当前无调用方（dive-start/UI 均已改用 weightForItem）；保留作历史参考，新代码勿用。
 * 旧语义：某物品 qty 件占用的背包格数——可叠道具按 ceil(qty/stackSize) 弹匣数，其余 slotsRequired×qty。
 */
export function slotsForItem(itemId: string, qty: number): number {
  if (qty <= 0) return 0;
  const def = getItemDef(itemId);
  if (def?.stackSize && def.stackSize > 0) return Math.ceil(qty / def.stackSize);
  return (def?.slotsRequired ?? 1) * qty;
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

/**
 * 该 loot 物品被采集后的资源耗尽持久层级（POI 固定资源耗尽·2026-06-25·缺省 'run'）。
 * applyOutcome 记账（run 级写 run.harvestedNodes / save 级暂存 run.harvestedSaveItems）的**单一来源**——
 * 别在别处手抄 `?? 'run'`。'save'＝采完永久没（profile.harvestedResources）；'run'＝本 run 采空、下次重进刷新。
 */
export function harvestPersistOf(itemId: string): 'save' | 'run' {
  return getItemDef(itemId)?.harvestPersist ?? 'run';
}
