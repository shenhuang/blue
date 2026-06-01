// 港口侧 reducer：
//  - handleReturnToPort：上岸结算后玩家点"回到港口"的统一入口
//  - sellItemToMira：从 profile.inventory 卖物给 Mira 换金币
//
// 把这些从 App.tsx / UI 里拎出来的好处：playthrough 脚本能直接调，行为与 UI 一致。

import type { GameState, InventoryItem } from '@/types';
import { pickReturnTrigger } from './portEvents';
import { mergeIntoInventory, removeFromInventory } from './state';
import { getItemDef } from './items';

export interface ReturnToPortResult {
  state: GameState;
  /** 若有 story.triggersEventId 命中，则是触发的 portEvent id；否则 null。 */
  cutsceneEventId: string | null;
}

/**
 * 玩家从 resolution 点"回到港口"。
 *  1. 用 run.inventory 检查是否触发港口侧 cutscene（剧情物）
 *  2. 把 run.inventory 合并到 profile.inventory（eternal 长存 + 材料等待变卖）
 *  3. null run
 *  4. phase 切到 portEvent（有 cutscene）或 port（没有）
 *
 * Note: cutscene 自己的 finalize 不再做 inventory 处理，这里已经合并干净。
 */
export function handleReturnToPort(state: GameState): ReturnToPortResult {
  if (!state.run) {
    return {
      state: { ...state, phase: { kind: 'port' } },
      cutsceneEventId: null,
    };
  }
  const trigger = pickReturnTrigger(state);
  const mergedInventory = mergeIntoInventory(
    state.profile.inventory,
    state.run.inventory,
  );
  const next: GameState = {
    ...state,
    profile: { ...state.profile, inventory: mergedInventory },
    run: null,
    phase: trigger
      ? { kind: 'portEvent', eventId: trigger }
      : { kind: 'port' },
  };
  return { state: next, cutsceneEventId: trigger };
}

/** Mira 收购价系数：sellPrice 是市场价，Mira 转手收 0.8 折 */
export const MIRA_BUY_RATIO = 0.8;

/** 单件物品在 Mira 这里能换到的金币（向下取整，0 表示她不收）。 */
export function miraOfferFor(itemId: string): number {
  const def = getItemDef(itemId);
  if (!def) return 0;
  if (!isSellableToMira(def.id)) return 0;
  return Math.floor((def.sellPrice ?? 0) * MIRA_BUY_RATIO);
}

/** Mira 收哪些：sellPrice > 0 且不是 eternal 类（剧情物不卖）。 */
export function isSellableToMira(itemId: string): boolean {
  const def = getItemDef(itemId);
  if (!def) return false;
  if (!def.sellPrice || def.sellPrice <= 0) return false;
  if (def.decay === 'eternal') return false; // 剧情物保留
  if (def.category === 'story') return false;
  return true;
}

/** 列出 profile.inventory 中可卖的项（含 offer 价）。 */
export function listMiraSellables(
  inventory: InventoryItem[],
): { item: InventoryItem; unitPrice: number; total: number }[] {
  return inventory
    .filter((i) => i.qty > 0 && isSellableToMira(i.itemId))
    .map((item) => {
      const unitPrice = miraOfferFor(item.itemId);
      return { item, unitPrice, total: unitPrice * item.qty };
    });
}

/**
 * 把 profile.inventory 中的 `itemId` 卖 `qty` 件给 Mira。
 * 不够卖的（库存不足 / 不收）原样返回。
 */
export function sellItemToMira(
  state: GameState,
  itemId: string,
  qty: number,
): GameState {
  if (qty <= 0) return state;
  const def = getItemDef(itemId);
  if (!def || !isSellableToMira(itemId)) return state;
  const inv = state.profile.inventory;
  const have = inv.find((i) => i.itemId === itemId)?.qty ?? 0;
  const sellQty = Math.min(have, qty);
  if (sellQty <= 0) return state;
  const unitPrice = miraOfferFor(itemId);
  if (unitPrice <= 0) return state;

  return {
    ...state,
    profile: {
      ...state.profile,
      inventory: removeFromInventory(inv, itemId, sellQty),
      bankedGold: state.profile.bankedGold + unitPrice * sellQty,
    },
  };
}
