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
  OutpostDef,
  PlayerProfile,
  UpgradeCost,
} from '@/types';
import { appendLog, removeFromInventory } from './state';
import { materialShortfall, describeUpgradeCost } from './upgrades';
import {
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
  const shortfall = materialShortfall(profile, OUTPOST_MAINTENANCE_COST);
  if (shortfall.length > 0) return { ok: false, reason: 'notEnoughMaterials' };
  if (profile.bankedGold < OUTPOST_MAINTENANCE_COST.gold) return { ok: false, reason: 'notEnoughGold' };
  return { ok: true };
}

/**
 * 维护一座衰减的水下前哨：扣维护账单（profile 银行） + 把 maintainedRun 重置到当前 run（衰减归零）。
 * 不可维护（不衰减 / 没建过 / 料不够）→ 仅叙事、不改档（幂等安全）。
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
  let inventory = state.profile.inventory;
  for (const m of OUTPOST_MAINTENANCE_COST.materials) {
    inventory = removeFromInventory(inventory, m.itemId, m.qty);
  }
  const outpostState = {
    ...(state.profile.outpostState ?? {}),
    [outpostId]: { maintainedRun: state.profile.runsCompleted },
  };
  let next: GameState = {
    ...state,
    profile: {
      ...state.profile,
      inventory,
      bankedGold: state.profile.bankedGold - OUTPOST_MAINTENANCE_COST.gold,
      outpostState,
    },
  };
  next = appendLog(next, {
    tone: 'system',
    text: `你又往「${def.name}」运了一趟料，清掉锈蚀和淤积——灯重新稳住了。（${describeUpgradeCost(
      OUTPOST_MAINTENANCE_COST,
    )}）`,
  });
  return next;
}
