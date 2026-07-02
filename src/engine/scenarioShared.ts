// scenario 公共层 —— 事件回归（eventScenario.ts）与战斗回归（combatScenario.ts）共用的
// 纯 helper 单一来源（此前两边各抄一份、逐字节相同，改一处漏一处）。
//
// 边界：与两个 scenario 框架同层（engine 叶子），无 UI / 无 console / 无 fs——
// 保持纯净的理由同 eventScenario.ts 设计原则 5（dev 面板会复用）。
// fixture 构造（buildInitialState）**不在这里**：两边的输入形状不同（事件覆写 flags/lore、
// 战斗覆写 injuries/bonuses），强行合并只会长出参数沼泽——各留各的。

import type { Stats, Stat, InventoryItem, EquipmentLoadout } from '../types';
import { createStarterLoadout } from './state';
import { makeLcg } from './rng';

// ---------------------------------------------------------------------------
// RNG patch
// ---------------------------------------------------------------------------

/**
 * 在 fn 期间临时把 Math.random 替换成线性同余 RNG。fn 跑完恢复原 random。
 * 用法见 runEventScenario / runCombatScenario。**注意：不要在它运行时并发跑别的引擎代码**（全局副作用）。
 */
export function withSeededRandom<T>(seed: number | undefined, fn: () => T): T {
  if (seed === undefined) return fn();
  const original = Math.random;
  Math.random = makeLcg(seed); // 与 chart.ts / MapDevPanel 同一份 LCG（src/engine/rng.ts）
  try {
    return fn();
  } finally {
    Math.random = original;
  }
}

// ---------------------------------------------------------------------------
// diff 计算
// ---------------------------------------------------------------------------

export function diffStats(before: Stats, after: Stats): Partial<Stats> {
  const out: Partial<Stats> = {};
  const keys: Stat[] = ['stamina', 'oxygen', 'sanity', 'nitrogen'];
  for (const k of keys) {
    const d = after[k] - before[k];
    if (Math.abs(d) > 1e-9) out[k] = Number(d.toFixed(4));
  }
  return out;
}

export function diffInventory(before: InventoryItem[], after: InventoryItem[]): InventoryItem[] {
  const beforeMap = new Map(before.map((i) => [i.itemId, i.qty]));
  const out: InventoryItem[] = [];
  for (const item of after) {
    const prev = beforeMap.get(item.itemId) ?? 0;
    const delta = item.qty - prev;
    if (delta > 0) out.push({ itemId: item.itemId, qty: delta });
  }
  return out;
}

// ---------------------------------------------------------------------------
// 装备 fixture
// ---------------------------------------------------------------------------

export function buildEquipment(override: Partial<EquipmentLoadout> | undefined): EquipmentLoadout {
  const base = createStarterLoadout();
  if (!override) return base;
  // 9 槽起改用 spread：base 含全 9 槽、override 只含已覆写键（不含显式 undefined）＝加新槽不必动这里。
  return { ...base, ...override };
}
