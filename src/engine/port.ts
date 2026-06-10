// 港口侧 reducer：
//  - handleReturnToPort：上岸结算后玩家点"回到港口"的统一入口
//  - sellItemToMira：从 profile.inventory 卖物给 Mira 换金币（收购侧，income）
//  - buyFromMira：从 Mira 回购低阶材料（出售侧，花金币补料）
//
// 把这些从 App.tsx / UI 里拎出来的好处：playthrough 脚本能直接调，行为与 UI 一致。

import type { GameState, InventoryItem, MaterialTier, PlayerProfile } from '@/types';
import { pickReturnTrigger } from './portEvents';
import { mergeIntoInventory, removeFromInventory } from './state';
import { allItems, getItemDef } from './items';

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
    // 回港即补满 Mira 备货（清空 shopStock → getShopStock 懒默认成满货）：soft per-run 限量
    profile: { ...state.profile, inventory: mergedInventory, shopStock: {} },
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

// ============================================================
// Mira 出售侧（回购）—— 低阶材料花金币补货（基建地图 SPEC §2.5）
// ============================================================
//
// - 仅 T1/T2 材料可回购；T3/T4 只卖不买（保住"深度 = 进度"门控）。
// - 买价 = 卖价（miraOfferFor）× markup，恒 > 卖价（markup>1），给金币一个去处又不破材料门控。
// - 店铺限量：每种可买材料按 tier 有 shopStock 上限，购买递减、每次回港补满（handleReturnToPort 清空）。
//   都是 tunable（见 SPEC §9），集中在下面三个常量。

/** 回购加价倍率：买价 = 卖价 × 此值（默认 2×，恒 > 卖价）。 */
export const MIRA_BUY_MARKUP = 2;

/** 可回购的材料分档 → 每次回港的备货上限（深档更稀、备货更少）。不在表里的 tier = 不可买。 */
const SHOP_STOCK_BY_TIER: Partial<Record<MaterialTier, number>> = {
  1: 8,
  2: 4,
};

/** 取某材料的 tier（非 material / 无 tier → undefined）。 */
function tierOf(itemId: string): MaterialTier | undefined {
  const def = getItemDef(itemId);
  if (!def || def.category !== 'material') return undefined;
  return def.tier;
}

/** Mira 是否回购此物品：material 且 tier 在 SHOP_STOCK_BY_TIER 表里（T1/T2）。 */
export function isBuyableFromMira(itemId: string): boolean {
  const tier = tierOf(itemId);
  return tier !== undefined && SHOP_STOCK_BY_TIER[tier] !== undefined;
}

/** 单件回购买价（不可买 → 0）。买价 = 卖价 × markup，恒 > 卖价。 */
export function miraBuyPriceFor(itemId: string): number {
  if (!isBuyableFromMira(itemId)) return 0;
  return miraOfferFor(itemId) * MIRA_BUY_MARKUP;
}

/** 某材料每次回港的备货上限（不可买 → 0）。 */
export function maxShopStockFor(itemId: string): number {
  const tier = tierOf(itemId);
  if (tier === undefined) return 0;
  return SHOP_STOCK_BY_TIER[tier] ?? 0;
}

/** 当前剩余备货：profile.shopStock 缺该项 = 视作满货（懒默认，回港即如此·条目级语义，容器必有）。 */
export function getShopStock(profile: PlayerProfile, itemId: string): number {
  const recorded = profile.shopStock[itemId];
  return recorded ?? maxShopStockFor(itemId);
}

/** 列出 Mira 当前回购的全部材料（含买价 + 剩余/上限备货）。遍历物品库而非玩家背包——缺料也能补。 */
export function listMiraBuyables(profile: PlayerProfile): {
  itemId: string;
  unitPrice: number;
  stock: number;
  maxStock: number;
}[] {
  const out: { itemId: string; unitPrice: number; stock: number; maxStock: number }[] = [];
  for (const def of allItems()) {
    if (!isBuyableFromMira(def.id)) continue;
    out.push({
      itemId: def.id,
      unitPrice: miraBuyPriceFor(def.id),
      stock: getShopStock(profile, def.id),
      maxStock: maxShopStockFor(def.id),
    });
  }
  return out;
}

/**
 * 从 Mira 回购 `itemId` `qty` 件。买得起多少 + 备货够多少就买多少（min(qty, stock, 金币能买的)）。
 * 不可买 / 买不起 1 件 / 没货 → 原样返回（UI 会按 disabled 兜，脚本可断言 no-op）。
 */
export function buyFromMira(state: GameState, itemId: string, qty: number): GameState {
  if (qty <= 0) return state;
  if (!isBuyableFromMira(itemId)) return state;
  const unitPrice = miraBuyPriceFor(itemId);
  if (unitPrice <= 0) return state;

  const stock = getShopStock(state.profile, itemId);
  const affordable = Math.floor(state.profile.bankedGold / unitPrice);
  const buyQty = Math.min(qty, stock, affordable);
  if (buyQty <= 0) return state;

  const newStock: Record<string, number> = {
    ...state.profile.shopStock,
    [itemId]: stock - buyQty,
  };
  return {
    ...state,
    profile: {
      ...state.profile,
      inventory: mergeIntoInventory(state.profile.inventory, [{ itemId, qty: buyQty }]),
      bankedGold: state.profile.bankedGold - unitPrice * buyQty,
      shopStock: newStock,
    },
  };
}
