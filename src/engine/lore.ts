// 见闻/生态志注册表（#137·图鉴 LoreView 的显示来源·纯叶子）。
// 事件 outcome.loreEntry 只写一个 id 进 profile.loreEntries（Set·持久·engine/events.ts applyOutcome）；
// 本模块给每个 id 配显示文案（src/data/lore.json）。LoreView 按 profile.loreEntries 过滤「已记录」的渲染。
// 未登记的 id（既有散落 lore.* 还没补显示文案）→ getLoreEntry 返回 undefined、LoreView 跳过不显示（不崩）。
// 边界：engine↛ui（check-boundaries 规则一）；本模块只 import 数据 + 自身类型，零 ui 依赖。

import loreData from '@/data/lore.json';

export interface LoreEntryDef {
  id: string;
  title: string;
  body: string;
  /** 分组标签（如「鲸落」）·UI 可据此聚类·缺省＝无组。 */
  group?: string;
}

const LORE_DB = new Map<string, LoreEntryDef>();
for (const e of (loreData as { entries: LoreEntryDef[] }).entries) {
  LORE_DB.set(e.id, e);
}

/** 取一条见闻的显示定义（未登记→undefined·LoreView 跳过不崩）。 */
export function getLoreEntry(id: string): LoreEntryDef | undefined {
  return LORE_DB.get(id);
}

/** 全部已登记的见闻定义（注册表顺序＝lore.json 顺序）。 */
export function allLoreEntries(): LoreEntryDef[] {
  return [...LORE_DB.values()];
}
