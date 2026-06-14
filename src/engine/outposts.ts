// 深水前哨「能源经济」（深水区 Phase 2b）—— 与 engine/lighthouses.ts（前哨建造脊柱 Phase 2a）
// **平行、单向依赖它**（本文件 import lighthouses.ts，lighthouses.ts 不 import 本文件 → 无循环）。
//
// 衰减 / 维护已删（作者 2026-06-14·CHANGELOG #125）；材料中转/寄存（depot）整套删除（作者 2026-06-14·
// 灯塔/蛙跳重构 step ②③）：前哨是**一次性基建**——建成即长亮，不随 run 荒废、无需 re-ferry 维护。原
// 「effectiveOutpostStage / effectiveRevealRadius」随衰减回退的有效层一并删除（改用裸 outpostStage /
// revealRadius）。保留一件仍有牙的事：
//   能源（base 层资源）：每座点亮前哨有基础能源 + 水力发电（仅水流前哨产出）；补给设施（充电/充氧）占用
//   能源，占用超出容量的设施**掉线**＝不贡献加成。能源决定「同时在线几个设施」——静态分配取舍，不随时间变。

import type { Lighthouse, LighthouseBonuses, OutpostDef } from '@/types';
import { getLighthouseBonuses, getLighthouseUpgradeDef, getOutposts } from './lighthouses';

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
