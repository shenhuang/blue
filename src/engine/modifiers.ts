// 派生修正单点 —— 全游戏唯一的「负伤 → 数值修正」折算点（负伤 SPEC §5）
//
// 消费点全部走 computeModifiers，引擎内禁止散读 run.injuries（check-boundaries 规则四）：
//   - engine/combat.ts：行动消耗（costStamina/costOxygenTurns ×mult·向上取整）、行动可用性、
//     回合开始 staminaTickPerTurn、clamp 上限。
//   - engine/dive-move.ts：移动 tick 氧耗 ×o2CostMult、洋流额外消耗 ×mult。
//   - effectiveStaminaMax：体力上限派生（staminaMaxDelta 与装备加成同点折算——装备加成在
//     createNewRun 烤进 run.staminaMax，负伤是 run 中途发生的债，故在读点叠）。
//   - Wave 2 消费点（字段已留）：scentTrail × enemy.scent 嗅觉旁路（stalker/遭遇）、paralyzed 行动集过滤。
//
// 折算规则：乘数相乘（默认 1）、加数相加（默认 0）、布尔取或——多处伤叠加语义封死在这里，
// 消费点永远只看折算结果。无伤时返回值恒等于 IDENTITY＝全部消费点行为逐字节不变。
//
// 与装备的关系：EquipmentEffect 枚举不动；本模块是折算层不是存储层（SPEC §5）。
// 将来药物压制层（run.activeDrugs·SPEC §8）也在此折算——调用方签名不变。

import type { RunState, DerivedModifiers } from '@/types';
import { getInjuryDef } from './injuries';

export function computeModifiers(run: RunState): DerivedModifiers {
  const m: DerivedModifiers = {
    staminaCostMult: 1,
    o2CostMult: 1,
    staminaMaxDelta: 0,
    staminaTickPerTurn: 0,
    scentTrail: false,
    paralyzed: false,
  };
  for (const inj of run.injuries) {
    const def = getInjuryDef(inj.defId);
    if (!def) continue;
    const eff = def.tierEffects[inj.tier - 1];
    if (!eff) continue;
    if (eff.staminaCostMult !== undefined) m.staminaCostMult *= eff.staminaCostMult;
    if (eff.o2CostMult !== undefined) m.o2CostMult *= eff.o2CostMult;
    if (eff.staminaMaxDelta) m.staminaMaxDelta += eff.staminaMaxDelta;
    if (eff.staminaTickPerTurn) m.staminaTickPerTurn += eff.staminaTickPerTurn;
    if (eff.scentTrail) m.scentTrail = true;
    if (eff.paralyzed) m.paralyzed = true;
  }
  return m;
}

/**
 * 体力上限的有效值（负伤 staminaMaxDelta 折算后·地板 1 防归零除零）。
 * 所有「恢复/clamp 到上限」的读点用它，别直读 run.staminaMax
 * （run.staminaMax 仍是「装备/升级基线」的存储值，负伤不改写它——伤好了上限自然回来）。
 */
export function effectiveStaminaMax(run: RunState): number {
  return Math.max(1, run.staminaMax + computeModifiers(run).staminaMaxDelta);
}
