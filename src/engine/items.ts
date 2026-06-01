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
