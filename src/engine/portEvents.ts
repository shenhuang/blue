// 港口侧 cutscene 触发器
// 现在只跑一种触发：玩家带回了 ItemDef.story.triggersEventId 指向的剧情物
// 用 profile.flags 上的 `flag.event_done.<eventId>` 标记防重复（oncePerSave 同义）。

import type { GameState, InventoryItem } from '@/types';
import { getItemDef } from './items';

/** flag 约定：某个港口 cutscene 已经播过 */
export function eventDoneFlag(eventId: string): string {
  return `flag.event_done.${eventId}`;
}

/**
 * 在玩家从 resolution 点"回到港口"那一刻，查 run.inventory 是否有
 * 任意 item.story.triggersEventId 还没播过。返回第一个匹配，没有返回 null。
 */
export function pickReturnTrigger(state: GameState): string | null {
  if (!state.run) return null;
  return pickFromInventory(state.run.inventory, state.profile.flags);
}

/** 同上，但允许传入任意 inventory（脚本/测试） */
export function pickFromInventory(
  inventory: InventoryItem[],
  profileFlags: Set<string>,
): string | null {
  for (const inv of inventory) {
    if (inv.qty <= 0) continue;
    const def = getItemDef(inv.itemId);
    const evId = def?.story?.triggersEventId;
    if (!evId) continue;
    if (profileFlags.has(eventDoneFlag(evId))) continue;
    return evId;
  }
  return null;
}
