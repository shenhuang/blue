// 深水前哨「能源经济 + 材料中转/寄存」（深水区 Phase 2b）—— 与 engine/lighthouses.ts（前哨建造脊柱 Phase 2a）
// **平行、单向依赖它**（本文件 import lighthouses.ts，lighthouses.ts 不 import 本文件 → 无循环）。
//
// 衰减 / 维护已删（作者 2026-06-14·CHANGELOG #125）：前哨是**一次性基建**——建成即长亮，不随 run 荒废、
// 无需 re-ferry 维护。原「effectiveOutpostStage / effectiveRevealRadius」随衰减回退的有效层一并删除
// （改用裸 outpostStage / revealRadius）。保留两件仍有牙的事：
//   1. 能源（base 层资源）：每座点亮前哨有基础能源 + 水力发电（仅水流前哨产出）；补给设施（充电/充氧）占用能源，
//      占用超出容量的设施**掉线**＝不贡献加成。能源决定「同时在线几个设施」——静态分配取舍，不随时间变。
//   2. 材料中转/寄存：深水前哨建「材料中转站」后可寄存材料（把料前置到深处），纯库房、不锈蚀。

import type {
  GameState,
  Lighthouse,
  LighthouseBonuses,
  MaterialCost,
  OutpostDef,
  PlayerProfile,
} from '@/types';
import { appendLog, addToInventory, removeFromInventory } from './state';
import { getItemDef } from './items';
import {
  getLighthouse,
  getLighthouseBonuses,
  getLighthouseUpgradeDef,
  getOutpostDef,
  getOutposts,
} from './lighthouses';

// ============================================================
// tunables
// ============================================================
/** 点亮前哨的基础能源（不靠水力也有这么多——够跑 1 个补给设施）。 */
export const OUTPOST_BASE_ENERGY = 1;

// ============================================================
// 前哨 ↔ 灯塔映射
// ============================================================

/** 产生某座灯塔的前哨定义（result.id === lighthouseId）；home / ruin 灯塔非前哨 → undefined（无能源经济）。 */
export function getOutpostForLighthouse(lighthouseId: string): OutpostDef | undefined {
  return getOutposts().find((o) => o.result.id === lighthouseId);
}

// ============================================================
// 能源结算（容量 / 占用 / 在线设施）
// ============================================================

export interface OutpostEnergy {
  /** 可用能源 = base + 水力（仅水流前哨产出）。衰减删除后不再随时间下降。 */
  capacity: number;
  /** 全部设施的能源占用之和（不论在线与否）。 */
  demand: number;
  /** 在线设施的 upgrade id（draw 累加 ≤ capacity 的部分；无占用设施恒在线）。 */
  online: Set<string>;
}

/**
 * 结算某座前哨灯塔的能源（深水区 Phase 2b）。home / 非前哨灯塔：用 base 能源、无水力。
 * 在线判定确定性：按 builtUpgrades 排序累加 energyDraw，≤ capacity 的在线；无占用设施（信标/船坞/水力）恒在线。
 * 衰减删除后能源不再依赖 profile（纯按灯塔自身设施算）。
 */
export function outpostEnergy(lighthouse: Lighthouse): OutpostEnergy {
  const def = getOutpostForLighthouse(lighthouse.id);
  const raw = getLighthouseBonuses(lighthouse);
  const hydro = def?.current ? raw.energyGen : 0; // 水力发电只在水流前哨真有产出
  const capacity = Math.max(0, OUTPOST_BASE_ENERGY + hydro);

  const online = new Set<string>();
  let used = 0;
  for (const id of [...lighthouse.builtUpgrades].sort()) {
    const fdef = getLighthouseUpgradeDef(id);
    if (!fdef) continue;
    const draw = fdef.effects.reduce((s, e) => s + (e.kind === 'energyDraw' ? e.value : 0), 0);
    if (draw <= 0) {
      online.add(id); // 无占用设施（信标/船坞/水力）恒在线
      continue;
    }
    if (used + draw <= capacity) {
      used += draw;
      online.add(id);
    }
  }
  return { capacity, demand: raw.energyDraw, online };
}

/**
 * 计入能源在线状态后的**有效**前哨加成（深水区 Phase 2b）：离线（能源不够）的充电 / 充氧设施不贡献。
 * 其余字段（reveal/reach/槽）原样透传。
 */
export function effectiveOutpostBonuses(lighthouse: Lighthouse): LighthouseBonuses {
  const raw = getLighthouseBonuses(lighthouse);
  const { online } = outpostEnergy(lighthouse);
  let rechargeBonus = 0;
  let oxygenSupply = 0;
  for (const id of online) {
    const fdef = getLighthouseUpgradeDef(id);
    if (!fdef) continue;
    for (const e of fdef.effects) {
      if (e.kind === 'rechargeBonus') rechargeBonus += e.value;
      else if (e.kind === 'oxygenSupply') oxygenSupply += e.value;
    }
  }
  return { ...raw, rechargeBonus, oxygenSupply };
}

// ============================================================
// 材料中转/寄存（深水区 Phase 2b 续，SPEC §3.6「材料中转/寄存」）
// ============================================================
// 深水前哨建「材料中转站」(lhtrack.depot) 后可寄存材料：把料前置到深处（建更深一阶时就近取用）。
// 衰减删除后中转站是**纯库房**——存进去不锈蚀、不流失（原 storedRun/损耗计时随衰减一并删）。
// 中转站**不耗能源**（被动库房，outpostEnergy 里 draw=0 恒在线）。

/** 某前哨的寄存容量（单位材料数）＝其点亮灯塔已建中转站设施的 storageCapacity 之和；未点亮/无设施＝0。 */
export function depotCapacity(profile: PlayerProfile, outpostId: string): number {
  const def = getOutpostDef(outpostId);
  if (!def) return 0;
  const lh = getLighthouse(profile, def.result.id);
  return lh ? getLighthouseBonuses(lh).storageCapacity : 0;
}

/** 寄存列表的总材料单位数（qty 之和）。 */
export function storedUnits(stored: MaterialCost[] | undefined): number {
  return (stored ?? []).reduce((s, m) => s + m.qty, 0);
}

/** 某前哨寄存的材料列表（衰减删除后即原始 stored·不锈蚀·拷贝返回防外部改）。 */
export function storedMaterials(profile: PlayerProfile, outpostId: string): MaterialCost[] {
  return (profile.outpostState[outpostId]?.stored ?? []).map((m) => ({ ...m }));
}

/** 往寄存列表加 qty 个 itemId（纯函数，同 addToInventory 但作用于 MaterialCost[]）。 */
function addStored(stored: MaterialCost[], itemId: string, qty: number): MaterialCost[] {
  const existing = stored.find((m) => m.itemId === itemId);
  if (existing) return stored.map((m) => (m.itemId === itemId ? { ...m, qty: m.qty + qty } : m));
  return [...stored, { itemId, qty }];
}

/** 从寄存列表扣一份账单（纯函数）。 */
function subtractCost(have: MaterialCost[], need: MaterialCost[]): MaterialCost[] {
  let out = have.map((m) => ({ ...m }));
  for (const n of need) {
    out = out.map((m) => (m.itemId === n.itemId ? { ...m, qty: m.qty - n.qty } : m));
  }
  return out.filter((m) => m.qty > 0);
}

function itemLabel(itemId: string, qty: number): string {
  return `${getItemDef(itemId)?.name ?? itemId}×${qty}`;
}

/** 写 outpostState 某前哨条目（保留既有字段＝不丢 stored/discovered，只覆盖 patch）。 */
function writeOutpostEntry(
  profile: PlayerProfile,
  outpostId: string,
  patch: Partial<{ stored: MaterialCost[]; discovered: boolean }>,
): PlayerProfile['outpostState'] {
  const prev = profile.outpostState[outpostId] ?? {};
  return { ...profile.outpostState, [outpostId]: { ...prev, ...patch } };
}

export type DepotAvailability =
  | { ok: true }
  | { ok: false; reason: 'unknown' | 'noDepot' | 'full' | 'notInWarehouse' | 'notStored' };

/** 能否往某前哨中转站存入 qty 个 itemId（已建中转站 · 岸上仓库有料 · 不超容量）。 */
export function canDeposit(
  profile: PlayerProfile,
  outpostId: string,
  itemId: string,
  qty = 1,
): DepotAvailability {
  if (!getOutpostDef(outpostId)) return { ok: false, reason: 'unknown' };
  if (depotCapacity(profile, outpostId) <= 0) return { ok: false, reason: 'noDepot' };
  const room = depotCapacity(profile, outpostId) - storedUnits(storedMaterials(profile, outpostId));
  if (room < qty) return { ok: false, reason: 'full' };
  const have = profile.inventory.find((i) => i.itemId === itemId)?.qty ?? 0;
  if (have < qty) return { ok: false, reason: 'notInWarehouse' };
  return { ok: true };
}

/** 把 qty 个 itemId 从岸上仓库（profile.inventory）寄存到某前哨中转站。不可存 → 仅叙事、不改档。 */
export function depositToDepot(state: GameState, outpostId: string, itemId: string, qty = 1): GameState {
  const def = getOutpostDef(outpostId);
  const avail = canDeposit(state.profile, outpostId, itemId, qty);
  if (!def || !avail.ok) {
    const reason = !avail.ok ? avail.reason : 'unknown';
    const why =
      reason === 'noDepot'
        ? '这座前哨还没建中转站，没处寄存。'
        : reason === 'full'
          ? '中转站满了，存不下了。'
          : reason === 'notInWarehouse'
            ? '岸上仓库里没有这种材料。'
            : '没有这座前哨。';
    return appendLog(state, { tone: 'system', text: why });
  }
  const inventory = removeFromInventory(state.profile.inventory, itemId, qty);
  const stored = addStored(storedMaterials(state.profile, outpostId), itemId, qty);
  const outpostState = writeOutpostEntry(state.profile, outpostId, { stored });
  let next: GameState = { ...state, profile: { ...state.profile, inventory, outpostState } };
  next = appendLog(next, {
    tone: 'system',
    text: `你把 ${itemLabel(itemId, qty)} 运到「${def.name}」存了起来。`,
  });
  return next;
}

/** 能否从某前哨中转站取回 qty 个 itemId（寄存里有这么多）。 */
export function canWithdraw(
  profile: PlayerProfile,
  outpostId: string,
  itemId: string,
  qty = 1,
): DepotAvailability {
  if (!getOutpostDef(outpostId)) return { ok: false, reason: 'unknown' };
  const have = storedMaterials(profile, outpostId).find((m) => m.itemId === itemId)?.qty ?? 0;
  if (have < qty) return { ok: false, reason: 'notStored' };
  return { ok: true };
}

/** 从某前哨中转站取回 qty 个 itemId 到岸上仓库。 */
export function withdrawFromDepot(state: GameState, outpostId: string, itemId: string, qty = 1): GameState {
  const def = getOutpostDef(outpostId);
  const avail = canWithdraw(state.profile, outpostId, itemId, qty);
  if (!def || !avail.ok) {
    return appendLog(state, { tone: 'system', text: '中转站里没有这么多这种材料了。' });
  }
  const stored = subtractCost(storedMaterials(state.profile, outpostId), [{ itemId, qty }]);
  const inventory = addToInventory(state.profile.inventory, itemId, qty);
  const outpostState = writeOutpostEntry(state.profile, outpostId, { stored });
  let next: GameState = { ...state, profile: { ...state.profile, inventory, outpostState } };
  next = appendLog(next, {
    tone: 'system',
    text: `你从「${def.name}」取回了 ${itemLabel(itemId, qty)}。`,
  });
  return next;
}
