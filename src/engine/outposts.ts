// 深水前哨「能源经济 + 衰减」（深水区 Phase 2b）—— 与 engine/lighthouses.ts（前哨建造脊柱 Phase 2a）
// **平行、单向依赖它**（本文件 import lighthouses.ts，lighthouses.ts 不 import 本文件 → 无循环）。
//
// SPEC §3.6 的三件事，全部 derive-only（不动存档形状，仅读 profile.outpostState 的 maintainedRun 计时）：
//   1. 能源（base 层资源）：每座点亮前哨有基础能源 + 水力发电（仅水流前哨产出）；补给设施（充电/充氧）占用能源，
//      占用超出容量的设施**掉线**＝不贡献加成。能源决定「同时在线几个设施」。
//   2. 衰减：水下前哨按"自上次维护以来过了几个 run"累积衰减（水流区更快）。后果：能源容量下降（设施掉线＝变暗/补给减）
//      + 有效建造阶段回退（半亮 → 蛙跳失效）。**非永久全损**——maintainOutpost 重新 ferry 材料即可补回。
//   3. 选址权衡：静水前哨省维护但能源少（只有 base）；水流前哨费维护但可水力发电、能源足 → 更多设施在线。
//
// 设计边界（MVP）：衰减/能源**只在蛙跳出潜层**（dive.ts::startDiveFromOutpost）兑现——
//   - 变暗＝补给设施掉线（少电/少氧）+ 衰减到一定程度蛙跳资格丢失（effectiveOutpostStage < USABLE）。
//   - **不**改 chart.ts 的 reveal 半径（前哨在海图上仍点亮）——真·reveal dimming 留后续，避免 reveal 回归漂移。

import type {
  GameState,
  Lighthouse,
  LighthouseBonuses,
  MaterialCost,
  OutpostDef,
  PlayerProfile,
  UpgradeCost,
} from '@/types';
import { appendLog, addToInventory, removeFromInventory } from './state';
import { getItemDef } from './items';
import { materialShortfall, describeUpgradeCost } from './upgrades';
import {
  getLighthouse,
  getLighthouseBonuses,
  getLighthouseUpgradeDef,
  getOutpostDef,
  getOutposts,
  outpostStage,
  revealRadius,
} from './lighthouses';

// ============================================================
// tunables（SPEC §8；集中文件顶，便于平衡）
// ============================================================
// —— 平衡基准（深水区 Phase 2b 经济 · 2026-06-05 平衡 pass 复核）——
// 前哨建造账单阶梯（总金，单调随深度↑，料随深度升到 lantern_gland/beak 深料）：
//   reef_deep 50/90/140（Σ280·静水） < trench_deep 90/150/240（Σ480·激流）
//   < abyssal_deep 110/180/290（Σ580·静水） < hadal_deep 120/200/340（Σ660·静水）。
// 衰减节奏：静水 1 级/2run（满 4 级＝8run 不维护→蛙跳失效）；激流 ×2（满 4 级＝4run）。维护 re-ferry 重置。
// 寄存（材料中转站）经济：容量 6（lv1）/12（lv2）单位；损耗 DEPOT_LOSS_PER_LEVEL=1 单位/损耗级（满 4 级＝最多 4 单位锈掉、
//   永不全失结构）；维护从寄存就近付料则免 ferry 金费＝把料前置到深处的回报、且 home 金/料紧时仍维护得起。
// 复核结论：本 pass 只**新增**寄存/abyssal 的值并钉进上述阶梯；既有衰减/能源/reveal-dimming（#67/#76）+ S2 声呐失真梯度
//   （clarity.ts 顶·非单调 0.2/0.28/0.32→0.06，#78）+ mapgen rollExtraFeatures（62/26/12，#74）均复核为自洽、未改
//   （无实测数据不擅动作者已调过的值）。下一档可调：维护账单随前哨深度分级（现 flat 1 brass+20g）/ 寄存容量随 band。
/** 点亮前哨的基础能源（不靠水力也有这么多——够跑 1 个补给设施）。 */
export const OUTPOST_BASE_ENERGY = 1;
/** 静水前哨每过 1 个 run 累积的衰减量（水流前哨再乘 OUTPOST_CURRENT_DECAY_MULT）。 */
export const OUTPOST_DECAY_PER_RUN = 0.5;
/** 水流（激流）前哨衰减倍率（§3.6：水流区维护压力更大）。 */
export const OUTPOST_CURRENT_DECAY_MULT = 2;
/** 衰减级上限（非永久全损：再久不维护也封顶，可 ferry 补回）。 */
export const OUTPOST_DECAY_MAX = 4;
/** 每多少衰减级回退一个有效建造阶段（半亮回退 → 蛙跳失效）。 */
export const OUTPOST_DECAY_PER_STAGE_DROP = 2;
/**
 * 真·reveal dimming（深水区 Phase 2b 收尾，SPEC §3.6）：满衰减时前哨在海图上的点亮半径最多收缩这么多。
 * 0.5 ＝荒废到顶的前哨只剩半径的一半（仍照亮自身近处，但它点亮的远海机会点重新隐没＝海图「变暗」）；
 * 永不归零（结构还在）→ 守「衰减非永久全损、可 re-ferry 补回」。
 */
export const OUTPOST_REVEAL_DECAY_SHRINK = 0.5;
/** 维护（re-ferry）账单：小额材料 + 金，重置衰减计时（§3.6 可重新 ferry 补回）。tunable。 */
export const OUTPOST_MAINTENANCE_COST: UpgradeCost = {
  materials: [{ itemId: 'item.brass_fitting', qty: 1 }],
  gold: 20,
};
/**
 * 寄存（材料中转站）每个**寄存损耗级**流失的材料单位数（深水区 Phase 2b 续，§3.6「寄存材料丢失」）。
 * 损耗级与结构衰减同速率、但用独立 storedRun 计时（水流前哨更快＝料锈得更快）。tunable。
 */
export const DEPOT_LOSS_PER_LEVEL = 1;

// ============================================================
// 前哨 ↔ 灯塔映射 + 衰减
// ============================================================

/** 产生某座灯塔的前哨定义（result.id === lighthouseId）；home / ruin 灯塔非前哨 → undefined（不衰减、无能源经济）。 */
export function getOutpostForLighthouse(lighthouseId: string): OutpostDef | undefined {
  return getOutposts().find((o) => o.result.id === lighthouseId);
}

/** 该前哨上次维护时的 runsCompleted（懒默认＝当前 run＝零衰减；同 shopStock 套路，旧档/脚本缺它无妨）。 */
function maintainedRun(profile: PlayerProfile, outpostId: string): number {
  return profile.outpostState?.[outpostId]?.maintainedRun ?? profile.runsCompleted;
}

/**
 * 前哨当前衰减级（0..OUTPOST_DECAY_MAX）。水上 / 前期前哨（!submerged）永不衰减＝0（只增不减）。
 * = floor( (runsCompleted − maintainedRun) × 速率 )，水流前哨速率乘 OUTPOST_CURRENT_DECAY_MULT。
 */
export function outpostDecayLevel(profile: PlayerProfile, outpostId: string): number {
  const def = getOutpostDef(outpostId);
  if (!def || !def.submerged) return 0; // 水上 / 前期前哨：只增不减
  const elapsed = Math.max(0, profile.runsCompleted - maintainedRun(profile, outpostId));
  const rate = OUTPOST_DECAY_PER_RUN * (def.current ? OUTPOST_CURRENT_DECAY_MULT : 1);
  return Math.min(OUTPOST_DECAY_MAX, Math.floor(elapsed * rate));
}

/**
 * 衰减后的**有效**建造阶段（raw outpostStage − 衰减回退；floored 0）。
 * 蛙跳资格（dive.ts::deepestOutpostLaunch）用它＝荒废的前哨会先半亮回退、再彻底失去蛙跳；
 * **建造仍用 raw outpostStage**（你已 ferry 的进度＝flag 真相，且建造会顺手重置衰减）。
 */
export function effectiveOutpostStage(profile: PlayerProfile, outpostId: string): number {
  const raw = outpostStage(profile, outpostId);
  const drop = Math.floor(outpostDecayLevel(profile, outpostId) / OUTPOST_DECAY_PER_STAGE_DROP);
  return Math.max(0, raw - drop);
}

/**
 * 一座灯塔在海图上的**有效**点亮半径（深水区 Phase 2b·真 reveal dimming，SPEC §3.6）。
 * 前哨灯塔随衰减线性收缩（满衰减时缩到 1 − OUTPOST_REVEAL_DECAY_SHRINK 倍，永不归零）——久不维护＝海图「变暗」，
 * 它点亮的远海机会点重新隐没（chart.ts::isLit 用本函数取代裸 revealRadius）。
 * home / 废墟 / 水上（!submerged）灯塔：无衰减 → 原样 revealRadius（既有 reveal 行为逐字节不变）。
 */
export function effectiveRevealRadius(profile: PlayerProfile, lighthouse: Lighthouse): number {
  const base = revealRadius(lighthouse);
  const def = getOutpostForLighthouse(lighthouse.id);
  if (!def || !def.submerged) return base;
  const decay = outpostDecayLevel(profile, def.id);
  if (decay <= 0) return base;
  return base * (1 - (decay / OUTPOST_DECAY_MAX) * OUTPOST_REVEAL_DECAY_SHRINK);
}

// ============================================================
// 能源结算（容量 / 占用 / 在线设施）
// ============================================================

export interface OutpostEnergy {
  /** 可用能源 = base + 水力（仅水流前哨产出）− 衰减级（floored 0）。 */
  capacity: number;
  /** 全部设施的能源占用之和（不论在线与否）。 */
  demand: number;
  /** 在线设施的 upgrade id（draw 累加 ≤ capacity 的部分；无占用设施恒在线）。 */
  online: Set<string>;
  decayLevel: number;
}

/**
 * 结算某座前哨灯塔的能源（深水区 Phase 2b）。home / 非前哨灯塔：用 base 能源、无衰减、无水力。
 * 在线判定确定性：按 builtUpgrades 排序累加 energyDraw，≤ capacity 的在线；无占用设施（信标/船坞/水力）恒在线。
 */
export function outpostEnergy(profile: PlayerProfile, lighthouse: Lighthouse): OutpostEnergy {
  const def = getOutpostForLighthouse(lighthouse.id);
  const decayLevel = def ? outpostDecayLevel(profile, def.id) : 0;
  const raw = getLighthouseBonuses(lighthouse);
  const hydro = def?.current ? raw.energyGen : 0; // 水力发电只在水流前哨真有产出
  const capacity = Math.max(0, OUTPOST_BASE_ENERGY + hydro - decayLevel);

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
  return { capacity, demand: raw.energyDraw, online, decayLevel };
}

/**
 * 计入能源在线状态后的**有效**前哨加成（深水区 Phase 2b）：离线（能源不够 / 被衰减吃掉容量）的
 * 充电 / 充氧设施不贡献。其余字段（reveal/reach/槽）原样透传——MVP 不把 reveal 接进能源（见文件顶边界）。
 */
export function effectiveOutpostBonuses(
  profile: PlayerProfile,
  lighthouse: Lighthouse,
): LighthouseBonuses {
  const raw = getLighthouseBonuses(lighthouse);
  const { online } = outpostEnergy(profile, lighthouse);
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
// 材料中转/寄存（深水区 Phase 2b 续，SPEC §3.6「材料中转/寄存」+「寄存材料丢失」）
// ============================================================
// 深水前哨建「材料中转站」(lhtrack.depot) 后可寄存材料：维护就近取料、料够时**免去 ferry 金费**
//   （前哨上自带补给＝不必再雇船运料下来）——这是把料前置到深处的回报。
// 但寄存的料随前哨荒废而锈蚀流失（水流前哨更快）；可重新存料补回（守 §3.6「非永久全损」）。
// 寄存损耗用**独立的 storedRun 计时**（与结构 maintainedRun 解耦）：建造一阶只重置结构衰减、不动寄存；
//   存/取/维护会「打理」寄存（提交已锈蚀的损耗 + 重置 storedRun）。损耗 derive-only、提交只发生在玩家动作时
//   （同本文件其余派生风格：profile.outpostState 是唯一持久态，其余全派生）。
// 中转站**不耗能源**（被动库房，outpostEnergy 里 draw=0 恒在线）——避免「能源不够→取不到自己存的料」的双重惩罚。

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

/** 该前哨上次「打理寄存」时的 runsCompleted（懒默认＝当前 run＝零损耗；同 maintainedRun 套路、旧档缺它无妨）。 */
function storedRun(profile: PlayerProfile, outpostId: string): number {
  return profile.outpostState?.[outpostId]?.storedRun ?? profile.runsCompleted;
}

/**
 * 寄存损耗级（0..OUTPOST_DECAY_MAX）：与结构衰减同速率、但用独立 storedRun 计时。
 * 水上 / 非前哨（!submerged）＝0（料不锈蚀）；水流前哨速率乘 OUTPOST_CURRENT_DECAY_MULT（料锈得更快＝§3.6 水流区更快）。
 */
export function depotDecayLevel(profile: PlayerProfile, outpostId: string): number {
  const def = getOutpostDef(outpostId);
  if (!def || !def.submerged) return 0;
  const elapsed = Math.max(0, profile.runsCompleted - storedRun(profile, outpostId));
  const rate = OUTPOST_DECAY_PER_RUN * (def.current ? OUTPOST_CURRENT_DECAY_MULT : 1);
  return Math.min(OUTPOST_DECAY_MAX, Math.floor(elapsed * rate));
}

/** 从寄存列表确定性流失 n 个单位（先排空 qty 最大的堆，itemId 字典序破平局）。纯函数。 */
function drainUnits(stored: MaterialCost[], n: number): MaterialCost[] {
  let out = stored.map((m) => ({ ...m })).filter((m) => m.qty > 0);
  let remaining = n;
  while (remaining > 0 && out.length > 0) {
    out.sort((a, b) => b.qty - a.qty || a.itemId.localeCompare(b.itemId));
    out[0].qty -= 1;
    remaining -= 1;
    out = out.filter((m) => m.qty > 0);
  }
  return out;
}

/** 往寄存列表加 qty 个 itemId（纯函数，同 addToInventory 但作用于 MaterialCost[]）。 */
function addStored(stored: MaterialCost[], itemId: string, qty: number): MaterialCost[] {
  const existing = stored.find((m) => m.itemId === itemId);
  if (existing) return stored.map((m) => (m.itemId === itemId ? { ...m, qty: m.qty + qty } : m));
  return [...stored, { itemId, qty }];
}

/**
 * 该前哨**有效**寄存（raw stored 减去按 depotDecayLevel 累积的锈蚀损耗）——派生、不提交（同 effectiveRevealRadius 风格）。
 * 损耗量 = depotDecayLevel × DEPOT_LOSS_PER_LEVEL 单位（封顶全部排空）。提交发生在存/取/维护时（见下）。
 */
export function effectiveStored(profile: PlayerProfile, outpostId: string): MaterialCost[] {
  const raw = profile.outpostState?.[outpostId]?.stored ?? [];
  const loss = depotDecayLevel(profile, outpostId) * DEPOT_LOSS_PER_LEVEL;
  return loss <= 0 ? raw.map((m) => ({ ...m })) : drainUnits(raw, loss);
}

/** 一份寄存列表覆盖一份材料账单（每种 itemId 的 qty 都够）。 */
function listCovers(have: MaterialCost[], need: MaterialCost[]): boolean {
  return need.every((n) => (have.find((h) => h.itemId === n.itemId)?.qty ?? 0) >= n.qty);
}

/** 从寄存列表扣一份账单（假定已 listCovers，纯函数）。 */
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

/** 写 outpostState 某前哨条目（保留既有字段＝不丢 maintainedRun/stored/storedRun，只覆盖 patch）。 */
function writeOutpostEntry(
  profile: PlayerProfile,
  outpostId: string,
  patch: Partial<{ maintainedRun: number; stored: MaterialCost[]; storedRun: number }>,
): NonNullable<PlayerProfile['outpostState']> {
  const prev = profile.outpostState?.[outpostId] ?? { maintainedRun: profile.runsCompleted };
  return { ...(profile.outpostState ?? {}), [outpostId]: { ...prev, ...patch } };
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
  const room = depotCapacity(profile, outpostId) - storedUnits(effectiveStored(profile, outpostId));
  if (room < qty) return { ok: false, reason: 'full' };
  const have = profile.inventory.find((i) => i.itemId === itemId)?.qty ?? 0;
  if (have < qty) return { ok: false, reason: 'notInWarehouse' };
  return { ok: true };
}

/**
 * 把 qty 个 itemId 从岸上仓库（profile.inventory）寄存到某前哨中转站。
 * 先提交已锈蚀的损耗（stored := effectiveStored）+ 重置 storedRun（打理过了），再加新料。不可存 → 仅叙事、不改档。
 */
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
  const settled = effectiveStored(state.profile, outpostId);
  const inventory = removeFromInventory(state.profile.inventory, itemId, qty);
  const stored = addStored(settled, itemId, qty);
  const outpostState = writeOutpostEntry(state.profile, outpostId, {
    stored,
    storedRun: state.profile.runsCompleted,
  });
  let next: GameState = { ...state, profile: { ...state.profile, inventory, outpostState } };
  next = appendLog(next, {
    tone: 'system',
    text: `你把 ${itemLabel(itemId, qty)} 运到「${def.name}」存了起来。`,
  });
  return next;
}

/** 能否从某前哨中转站取回 qty 个 itemId（有效寄存里有这么多）。 */
export function canWithdraw(
  profile: PlayerProfile,
  outpostId: string,
  itemId: string,
  qty = 1,
): DepotAvailability {
  if (!getOutpostDef(outpostId)) return { ok: false, reason: 'unknown' };
  const have = effectiveStored(profile, outpostId).find((m) => m.itemId === itemId)?.qty ?? 0;
  if (have < qty) return { ok: false, reason: 'notStored' };
  return { ok: true };
}

/**
 * 从某前哨中转站取回 qty 个 itemId 到岸上仓库。先提交损耗（结算被锈蚀的部分）+ 重置 storedRun，再扣寄存、加仓库。
 */
export function withdrawFromDepot(state: GameState, outpostId: string, itemId: string, qty = 1): GameState {
  const def = getOutpostDef(outpostId);
  const avail = canWithdraw(state.profile, outpostId, itemId, qty);
  if (!def || !avail.ok) {
    return appendLog(state, { tone: 'system', text: '中转站里没有这么多这种材料了。' });
  }
  const settled = effectiveStored(state.profile, outpostId);
  const stored = subtractCost(settled, [{ itemId, qty }]);
  const inventory = addToInventory(state.profile.inventory, itemId, qty);
  const outpostState = writeOutpostEntry(state.profile, outpostId, {
    stored,
    storedRun: state.profile.runsCompleted,
  });
  let next: GameState = { ...state, profile: { ...state.profile, inventory, outpostState } };
  next = appendLog(next, {
    tone: 'system',
    text: `你从「${def.name}」取回了 ${itemLabel(itemId, qty)}。`,
  });
  return next;
}

// ============================================================
// 维护（re-ferry）—— 把衰减计时重置（§3.6 可补回）
// ============================================================

export type MaintainAvailability =
  | { ok: true }
  | {
      ok: false;
      reason: 'unknown' | 'notSubmerged' | 'noDecay' | 'notEnoughMaterials' | 'notEnoughGold';
    };

export function canMaintainOutpost(profile: PlayerProfile, outpostId: string): MaintainAvailability {
  const def = getOutpostDef(outpostId);
  if (!def) return { ok: false, reason: 'unknown' };
  if (!def.submerged) return { ok: false, reason: 'notSubmerged' }; // 水上前哨不衰减、无需维护
  if (outpostStage(profile, outpostId) <= 0) return { ok: false, reason: 'noDecay' }; // 没建过无从维护
  if (outpostDecayLevel(profile, outpostId) <= 0) return { ok: false, reason: 'noDecay' };
  // 中转站就近付料 → 免 ferry 金费（前哨上有料、不必雇船运下来）；此路即便没金币也维护得起＝寄存的战略回报。
  if (listCovers(effectiveStored(profile, outpostId), OUTPOST_MAINTENANCE_COST.materials)) {
    return { ok: true };
  }
  // 否则从岸上仓库运料 + 付全额 ferry 金费（既有行为）。
  const shortfall = materialShortfall(profile, OUTPOST_MAINTENANCE_COST);
  if (shortfall.length > 0) return { ok: false, reason: 'notEnoughMaterials' };
  if (profile.bankedGold < OUTPOST_MAINTENANCE_COST.gold) return { ok: false, reason: 'notEnoughGold' };
  return { ok: true };
}

/**
 * 维护一座衰减的水下前哨：把 maintainedRun 重置到当前 run（结构衰减归零）。
 * 付料两条路（canMaintainOutpost 已挑过）：
 *   - **中转站就近付料**（effectiveStored 覆盖维护材料）→ 从寄存扣料、**免 ferry 金费**；
 *   - 否则从岸上仓库运料 + 全额金费（既有行为）。
 * 维护＝你正在前哨上、顺手打理了寄存：提交寄存的锈蚀损耗 + 重置 storedRun。无中转站活动（从没寄存过）的前哨
 * 仍只写 { maintainedRun }＝既有行为逐字节不变（守 -outpost / -save 回归）。不可维护 → 仅叙事、不改档（幂等安全）。
 */
export function maintainOutpost(state: GameState, outpostId: string): GameState {
  const def = getOutpostDef(outpostId);
  const avail = canMaintainOutpost(state.profile, outpostId);
  if (!def || !avail.ok) {
    const reason = !avail.ok ? avail.reason : 'unknown';
    const why =
      reason === 'noDecay'
        ? '这座前哨还稳得很，暂时不用维护。'
        : reason === 'notSubmerged'
          ? '这座前哨在水面上，不会荒废。'
          : reason === 'notEnoughMaterials' || reason === 'notEnoughGold'
            ? '材料或金币不够，这趟维护跑不成。'
            : '没有这座前哨。';
    return appendLog(state, { tone: 'system', text: why });
  }
  const settled = effectiveStored(state.profile, outpostId); // 先结算寄存损耗
  const fromDepot = listCovers(settled, OUTPOST_MAINTENANCE_COST.materials);

  let inventory = state.profile.inventory;
  let bankedGold = state.profile.bankedGold;
  let stored = settled;
  if (fromDepot) {
    stored = subtractCost(settled, OUTPOST_MAINTENANCE_COST.materials); // 就近扣料、免金费
  } else {
    for (const m of OUTPOST_MAINTENANCE_COST.materials) {
      inventory = removeFromInventory(inventory, m.itemId, m.qty);
    }
    bankedGold -= OUTPOST_MAINTENANCE_COST.gold;
  }

  // 无中转站活动（从没寄存过）→ 只写 maintainedRun＝既有行为不变；有寄存 → 顺手提交损耗 + 重置 storedRun。
  const hadDepot = state.profile.outpostState?.[outpostId]?.stored !== undefined;
  const patch = hadDepot
    ? { maintainedRun: state.profile.runsCompleted, stored, storedRun: state.profile.runsCompleted }
    : { maintainedRun: state.profile.runsCompleted };
  const outpostState = writeOutpostEntry(state.profile, outpostId, patch);

  let next: GameState = {
    ...state,
    profile: { ...state.profile, inventory, bankedGold, outpostState },
  };
  next = appendLog(next, {
    tone: 'system',
    text: fromDepot
      ? `你就着「${def.name}」中转站里的存料清掉了锈蚀和淤积——灯重新稳住了，省下一趟运料的船钱。（${describeUpgradeCost(
          { materials: OUTPOST_MAINTENANCE_COST.materials, gold: 0 },
        )}）`
      : `你又往「${def.name}」运了一趟料，清掉锈蚀和淤积——灯重新稳住了。（${describeUpgradeCost(
          OUTPOST_MAINTENANCE_COST,
        )}）`,
  });
  return next;
}
