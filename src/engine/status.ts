// 战斗状态结算 —— 单一结算函数（战斗状态系统 SPEC §2.3）。
// 玩家与每个敌人都在**各自回合开始**调用同一个函数：runEnemyTurn 每个敌人回合开头一次、
// applyPlayerAction 顶部一次。纯函数·零 RNG（施加是确定命中，结算这里也没有骰子）。

import type { StatusInstance, StatusKind } from '@/types';

export interface SettleStatusesResult {
  hp: number;
  statuses: StatusInstance[];
  /** 本回合是否被眩晕（stunned≥1 条活跃即真·多实例取并集/最长者，无需特判）。 */
  stunned: boolean;
}

/**
 * 顺序是唯一会咬人的 off-by-one，写死在这一处、别在调用方重新推：
 *   1. DoT 求和落 HP（一次死亡判定）
 *   2. stunned 判定（读**减 1 之前**的 statuses）
 *   3. 所有实例 remainingTurns -1、归零移除
 * 这样「N 回合的效果」正好作用在该角色自己的 N 个回合上（1 回合的晕＝恰好跳过 1 次行动后消失）。
 * hp 下限 0（与既有 DoT 落点 Math.max(0, …) 同口径，避免生命值转负）。
 */
export function settleStatusesAtTurnStart(hp: number, statuses: StatusInstance[]): SettleStatusesResult {
  const dot = statuses.reduce((sum, st) => sum + (st.dmgPerTurn ?? 0), 0);
  const newHp = Math.max(0, hp - dot);
  const stunned = statuses.some((st) => st.kind === 'stunned');
  const newStatuses = statuses
    .map((st) => ({ ...st, remainingTurns: st.remainingTurns - 1 }))
    .filter((st) => st.remainingTurns > 0);
  return { hp: newHp, statuses: newStatuses, stunned };
}

/**
 * 布尔免疫判定（SPEC §2.5）单一来源：三处施加点（玩家攻击 applyStatusOnHit / 武器件毒囊·倒刺 DoT /
 * 群体控制 applyStatusToAll）共用本函数，别各写各的 `statusImmunity?.includes(kind)`。
 */
export function isStatusImmune(statusImmunity: StatusKind[] | undefined, kind: StatusKind): boolean {
  return statusImmunity?.includes(kind) ?? false;
}
