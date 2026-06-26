// 港口侧 reducer：
//  - handleReturnToPort：上岸结算后玩家点"回到港口"的统一入口
//  - sellItemToMira：从 profile.inventory 卖物给 Mira 换金币（收购侧，income）
//  - buyFromMira：从 Mira 回购低阶材料（出售侧，花金币补料）
//
// 把这些从 App.tsx / UI 里拎出来的好处：playthrough 脚本能直接调，行为与 UI 一致。

import type { GameState, InventoryItem, MaterialTier, PlayerProfile } from '@/types';
import type { LunarPhase } from '@/types';
import { pickReturnTrigger } from './portEvents';
import { acquireIntoProfile, addToPoiSetMap, appendLog, removeFromInventory } from './state';
import { allItems, getItemDef } from './items';
import { ageAndDecayDeaths, getPreservationBonus } from './death';
import { daysToNextPhase, lunarPhase, lunarPhaseLabel } from './lunar';
import { knownLunarPoints } from './chart';

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
  // 物品入袋统一入口：合并 run.inventory 并兑现被获得物品的 story.setsFlag（acquireIntoProfile·见 state.ts）。
  let acquired = acquireIntoProfile(state.profile, state.run.inventory);
  // 固定资源**永久**耗尽入账（POI 固定资源耗尽·2026-06-25）：生还回港才把本 run 采到的 save 级件
  // 合并进 profile.harvestedResources[key]（死亡走 gameOver/funeral·不经此 ⇒ 资源留给下次·与物品入袋同走「生还才落袋」）。
  // 持久洞（多口持久洞 §4.3/§4.4）：记账 key = caveId（资源空间是「洞」非「单口」·任一口进采都算同一洞采尽）；非洞 = poiId。
  const harvestKey = state.run.caveId ?? state.run.poiId;
  if (harvestKey && state.run.harvestedSaveItems && state.run.harvestedSaveItems.size > 0) {
    let harvested = acquired.harvestedResources;
    for (const itemId of state.run.harvestedSaveItems) {
      harvested = addToPoiSetMap(harvested, harvestKey, itemId);
    }
    acquired = { ...acquired, harvestedResources: harvested };
  }
  // 持久洞已探写回（多口持久洞 §4.4）：本潜访问过的节点并进 caveMaps[caveId].explored（生还才落袋·驱动再进「已探片」预亮）。
  if (state.run.caveId) {
    const cave = acquired.caveMaps.get(state.run.caveId);
    if (cave) {
      const explored = new Set(cave.explored);
      for (const id of state.run.visitedNodeIds) explored.add(id);
      const caveMaps = new Map(acquired.caveMaps);
      caveMaps.set(state.run.caveId, { ...cave, explored });
      acquired = { ...acquired, caveMaps };
    }
  }
  const next: GameState = {
    ...state,
    // 回港即补满 Mira 备货（清空 shopStock → getShopStock 懒默认成满货）：soft per-run 限量
    profile: { ...acquired, shopStock: {} },
    run: null,
    phase: trigger
      ? { kind: 'portEvent', eventId: trigger }
      : { kind: 'port' },
  };
  return { state: next, cutsceneEventId: trigger };
}

/**
 * 港口「等待」动作（月相潮汐 SPEC §6）：推进世界 n 天但**不计一次 run**（day 与 runsCompleted 在此分离）。
 * 等的那几天海底尸体照样腐烂（ageAndDecayDeaths 按新 day 重算·路径无关＝逐天走≡一次跳·SPEC §2.2/§7）；
 * 月相/潮汐/机会点随 day 自动变（纯派生·下次 generateChart 即新）。停在 {kind:'port'}、不新增 GamePhase。
 * 仅港口（无 run）可等·n≤0 原样返回。
 */
export function advanceDays(state: GameState, n: number): GameState {
  if (state.run || n <= 0) return state;
  const profile = state.profile;
  const newDay = (profile.day ?? profile.runsCompleted) + n;
  const agedDeaths = ageAndDecayDeaths(
    profile.deaths,
    newDay,
    getPreservationBonus(profile.unlockedUpgrades),
    profile.unlockedUpgrades.has('upgrade.salvage_guild.lv3'),
  );
  let s: GameState = { ...state, profile: { ...profile, deaths: agedDeaths, day: newDay } };
  s = appendLog(s, {
    tone: 'realistic',
    text: `你在港口等了 ${n} 天。海面换了脸色——${lunarPhaseLabel(lunarPhase(newDay))}。`,
  });
  return s;
}

/** 「等到下一相位边界」还要几天（港口等待主形式·UI 按钮 + advanceDays 入参·SPEC §6）。 */
export function daysToNextLunarBoundary(profile: PlayerProfile): number {
  return daysToNextPhase(profile.day ?? profile.runsCompleted);
}

/**
 * 等待预览（SPEC §6：等待是看得见账的决定）。纯函数·无副作用。
 * 告知玩家等 n 天之后的三项变化：
 *   - targetPhase: 等完之后的月相
 *   - corpseItemsLost: 海底遗存上当前还有、等完就没了的物品件数（sum of qty·≥0）
 *   - opening: 玩家已知的潮窗点中，等完进入其窗（现在窗外 → 等完窗内）
 *   - closing: 玩家已知的潮窗点中，等完离开其窗（现在窗内 → 等完窗外）
 */
export interface WaitPreview {
  /** 等待的天数 */
  days: number;
  /** 等完之后的月相 */
  targetPhase: LunarPhase;
  /** 海底遗存：可回收尸体上「现在还在、等完就没了」的物品件数（≥0） */
  corpseItemsLost: number;
  /** 玩家「已知」的潮窗点中，等完进入其窗的点名字列表 */
  opening: string[];
  /** 玩家「已知」的潮窗点中，等完离开其窗的点名字列表 */
  closing: string[];
}

export function waitPreview(state: GameState, n: number): WaitPreview {
  const profile = state.profile;
  const day = profile.day ?? profile.runsCompleted ?? 0;
  const currentPhase = lunarPhase(day);
  const targetPhase = lunarPhase(day + n);

  // 海底遗存损耗：现在的 inventorySnapshot 总件数 vs 等完之后
  const preservationBonus = getPreservationBonus(profile.unlockedUpgrades);
  const sweepImmune = profile.unlockedUpgrades.has('upgrade.salvage_guild.lv3');

  // 当前可回收尸体（未 recovered）的当前物品总数
  const recoverableDeaths = profile.deaths.filter((d) => !d.recovered && d.inventorySnapshot.length > 0);

  const nowTotal = recoverableDeaths.reduce((sum, d) => {
    return sum + d.inventorySnapshot.reduce((s, it) => s + it.qty, 0);
  }, 0);

  // 等完之后的物品总数（只看这些可回收的尸体）
  const agedSet = ageAndDecayDeaths(recoverableDeaths, day + n, preservationBonus, sweepImmune);
  const thenTotal = agedSet.reduce((sum, d) => {
    return sum + d.inventorySnapshot.reduce((s, it) => s + it.qty, 0);
  }, 0);

  const corpseItemsLost = Math.max(0, nowTotal - thenTotal);

  // 潮窗点变化（只看玩家已知的点）
  const knownPoints = knownLunarPoints(profile);
  const opening: string[] = [];
  const closing: string[] = [];
  for (const pt of knownPoints) {
    const nowIn = pt.window.includes(currentPhase);
    const thenIn = pt.window.includes(targetPhase);
    if (!nowIn && thenIn) opening.push(pt.name);
    if (nowIn && !thenIn) closing.push(pt.name);
  }

  return { days: n, targetPhase, corpseItemsLost, opening, closing };
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
// Mira 出售侧（回购）—— 低阶材料花金币补货（基建地图 SPEC §2.5）+ 消耗品货架（猎手 SPEC §4·#108）
// ============================================================
//
// - 仅 T1/T2 材料可回购；T3/T4 只卖不买（保住"深度 = 进度"门控）。
// - 另有少量「装备性消耗品」（decoy/med_kit·SHOP_STOCK_CONSUMABLES）：同一套限量/加价机制走货。
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

/**
 * Mira 柜台的「装备性消耗品」货架（猎手 SPEC §4 data 面·#108）：itemId → 每次回港备货上限。
 * 材料回购之外的第二类货——花金币买、出发前选带下水（dive-start.ts carryItems）。买价沿
 * miraOfferFor × MIRA_BUY_MARKUP 同一套（恒 > 卖价）；限量同 shopStock 机制（回港补满）。
 * 备货故意少（2）＝「带一两枚保命」的开销，不是无限弹药（守可生存但代价巨大）。
 * med_kit 上架（负伤 SPEC §8「medkit 治伤、药物买时间」·作者拍 2026-06-12·价/量后续可调）。
 */
const SHOP_STOCK_CONSUMABLES: Record<string, number> = {
  'item.decoy_sound': 2,
  'item.decoy_light': 2,
  'item.med_kit': 2,
  // 弹药（武器系统·作者 2026-06-20）：按发补货；携带承载按重量（每发 0.05kg·items.ts::weightForItem）。数值＝提案可调。
  'item.ammo.pneumatic': 16,
  'item.ammo.harpoon': 60,
};

/**
 * Mira 柜台的「基础装备件」货架（段2·作者 2026-06-19）：itemId → 每次回港备货上限。
 * 与消耗品货架平行——花金币买**基础装备件**（手电＝基础潜水灯·Mira 购买、不升级·见段2 装备模型：
 * 灯/规避＝固定属性买/换件、声呐＝Otto 打造、唯它逐级升）。买价/限量同一套（miraOfferFor × markup·回港补满）。
 * 注：买到的件进仓库（未装备备件）；换装流程（仓库↔槽·equipItem/unequipItem 单点）已实装（B·作者 2026-06-20·
 *   物品栏装备 tab / Otto 纸娃娃点槽→选仓库备件装上·旧件回仓库·见 engine/equipment.ts）。加可买件＝往这表加一行（数据驱动）。
 * A（作者 2026-06-20）：退役的灯/电池/规避升级做回「固定属性档位件」上架（数值在 base effects·占位待调·别重建 upgrades.json 三线·quirk #142）。
 */
const SHOP_STOCK_EQUIPMENT: Record<string, number> = {
  'item.light.hand_torch': 1,
  'item.light.spotlight': 1,
  'item.light.floodlamp': 1,
  'item.light.eco_lamp': 1,
  'item.suit.reinforced': 1,
  'item.suit.sound_absorb': 1,
  'item.suit.camo': 1,
  'item.charm.quiet_pendant': 1,
  'item.charm.spare_cell': 1,
  // 武器 / 盾（武器系统·作者 2026-06-20）：买进仓库当备件·换装上槽（无 upgradeSteps＝固定件·守 quirk #142）。
  'item.weapon.rescue_axe': 1,
  'item.weapon.pneumatic_pistol': 1,
  'item.weapon.harpoon_rifle': 1,
  'item.shield.basic': 1,
};

/**
 * 武器改装组件货架（武器系统·作者 2026-06-20）：itemId → 每次回港备货上限。
 * 买进仓库·Otto 装上有 modSlot 的武器（engine/equipment.ts::installMod）。数值＝提案可调。
 */
const SHOP_STOCK_MODS: Record<string, number> = {
  'item.mod.poison_sac': 2,
  'item.mod.barb_kit': 2,
  'item.mod.silent_wrap': 1,
  'item.mod.shock_core': 1,
};

/** 取某材料的 tier（非 material / 无 tier → undefined）。 */
function tierOf(itemId: string): MaterialTier | undefined {
  const def = getItemDef(itemId);
  if (!def || def.category !== 'material') return undefined;
  return def.tier;
}

/** Mira 是否出售此物品：material 且 tier 在 SHOP_STOCK_BY_TIER 表里（T1/T2），或消耗品货架上的（decoy 等）。 */
export function isBuyableFromMira(itemId: string): boolean {
  if (SHOP_STOCK_CONSUMABLES[itemId] !== undefined) return true;
  if (SHOP_STOCK_EQUIPMENT[itemId] !== undefined) return true;
  if (SHOP_STOCK_MODS[itemId] !== undefined) return true;
  const tier = tierOf(itemId);
  return tier !== undefined && SHOP_STOCK_BY_TIER[tier] !== undefined;
}

/** 单件回购买价（不可买 → 0）。买价 = 卖价 × markup，恒 > 卖价。 */
export function miraBuyPriceFor(itemId: string): number {
  if (!isBuyableFromMira(itemId)) return 0;
  return miraOfferFor(itemId) * MIRA_BUY_MARKUP;
}

/** 某物品每次回港的备货上限（不可买 → 0）。消耗品货架查自己的表；材料按 tier。 */
export function maxShopStockFor(itemId: string): number {
  const fromShelf = SHOP_STOCK_CONSUMABLES[itemId];
  if (fromShelf !== undefined) return fromShelf;
  const fromGear = SHOP_STOCK_EQUIPMENT[itemId];
  if (fromGear !== undefined) return fromGear;
  const fromMod = SHOP_STOCK_MODS[itemId];
  if (fromMod !== undefined) return fromMod;
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
      ...acquireIntoProfile(state.profile, [{ itemId, qty: buyQty }]),
      bankedGold: state.profile.bankedGold - unitPrice * buyQty,
      shopStock: newStock,
    },
  };
}

/**
 * Dev 测试货架（#109·作者要求「dev 模式 Mira 0 元卖所有道具」）：把任意道具**白送**进仓库——
 * 不动金币、不动 shopStock、不走加价/限量（真经济代码零触碰＝playthrough-economy 不受影响）。
 * 仅 dev UI（MiraShopView 的测试货架·DEV_TOOLS 门后）调用；引擎侧无门（纯函数·便于脚本断言），
 * 门在 UI——同 MapDevPanel 口径（dev 入口不进 GameState/存档语义）。
 */
export function devGrantItem(state: GameState, itemId: string, qty = 1): GameState {
  if (qty <= 0 || !getItemDef(itemId)) return state;
  // 走物品入袋统一入口 ⇒ 作弊发物也兑现 story.setsFlag（鲸落手记 → 解锁鲸落区·作者 2026-06-19）。
  return { ...state, profile: acquireIntoProfile(state.profile, [{ itemId, qty }]) };
}
