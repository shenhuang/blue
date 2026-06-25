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
 * flag 触发的港口 cutscene（与剧情物触发并行）：某些回港 cutscene 没有「带回的剧情物」做载体
 * （如教学「上浮（任务完成）」一路——没拿船长日志，但仍要在岸上把导师日志的四坐标圈上海图＝完成教学）。
 * 约定：profile 有 `whenFlag`、且 `unlessFlag`（若给）未置、且该事件没播过 → 触发。剧情物触发优先（先扫库存）。
 *
 * 顺序很重要：精确路径在前，兜底路径在后（后者被 eventDoneFlag 防重播屏蔽）。
 */
const FLAG_RETURN_TRIGGERS: Array<{ whenFlag: string; eventId: string; unlessFlag?: string }> = [
  // 精确路径：拿到图筒后自愿上浮（tutorial.deeper → ascend_now 设此 flag）
  { whenFlag: 'flag.tutorial_ascended', eventId: 'tutorial.ending_safe', unlessFlag: 'flag.tutorial_complete' },
  // 兜底：prologue 已见但教学未完成——逃跑/提前上浮等边缘路径均由此收口。
  // event_seen:tutorial.prologue 由引擎机制写（oncePerSave resolveOption）比 story.ch1.hook（内容 setProfileFlags）
  // 更可靠：旧存档只要跑过 prologue 就一定有此 flag，不受内容字段加入时间影响。
  // tutorial.ending_safe 的 eventDoneFlag 防止与上条双播；flag.tutorial_complete 防止教学后重触。
  { whenFlag: 'event_seen:tutorial.prologue', eventId: 'tutorial.ending_safe', unlessFlag: 'flag.tutorial_complete' },
];

/**
 * 在玩家从 resolution 点"回到港口"那一刻，查触发：先剧情物（run.inventory 的 item.story.triggersEventId），
 * 再 flag 触发（FLAG_RETURN_TRIGGERS）。都没有返回 null。
 */
export function pickReturnTrigger(state: GameState): string | null {
  if (!state.run) return null;
  const fromItem = pickFromInventory(state.run.inventory, state.profile.flags);
  if (fromItem) return fromItem;
  return pickFlagTrigger(state.profile.flags);
}

/** flag 触发的回港 cutscene（无剧情物载体）。返回第一个满足且没播过的事件 id，没有返回 null。 */
export function pickFlagTrigger(profileFlags: Set<string>): string | null {
  for (const t of FLAG_RETURN_TRIGGERS) {
    if (!profileFlags.has(t.whenFlag)) continue;
    if (t.unlessFlag && profileFlags.has(t.unlessFlag)) continue;
    if (profileFlags.has(eventDoneFlag(t.eventId))) continue;
    return t.eventId;
  }
  return null;
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
