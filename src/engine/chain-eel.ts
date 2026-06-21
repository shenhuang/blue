// 链鳗（分节实体）—— 纯函数层（boss 设计蓝图 2026-06-21「链鳗（分节实体）」）。
//
// 设计：N 个节段共用一个 EnemyParty（party.members 即节序·**头在末端**·index 0 = 最前节）。
//   ① 按序门：玩家只能命中「最前存活节」（lowest-index living）·前节死后才解锁下一节。
//   ② 头节 enraged：最前存活节带 headEnrage 时 enrage（成为最前存活节＝前置节全死·party-state 触发·见 combat.ts）。
//   ③ 越杀越短越快越危险：随存活节数派生威胁的纯函数（不入存档）。
//
// 与既有系统的关系：链鳗**只在**现有 EnemyParty 多成员之上加「按序」一层——核心是一个纯目标门 + 一个
//   party-state 触发，不另起战斗范式。本文件只放纯决策（可单测·无副作用）；状态写入在 combat.ts。
//
// 硬约束：这些函数只被「显式标 attackInOrder 的遭遇」路径调用 ⇒ 无序多成员 party 行为逐字节不变。

import type { EnemyInstance } from '../types';

/**
 * 最前存活节 = members 数组里 **lowest-index 的存活成员**（hp > 0）。
 * 节序约定：index 0 = 最前节（须先死）…末 index = 头节（最后死·会 enrage）。
 * 与 combat.ts 既有 `enemies.find(e => e.hp > 0)`（取数组首个活敌）同义——按序门即复用此自然序。
 */
export function frontmostLivingSegment(
  enemies: readonly EnemyInstance[],
): EnemyInstance | undefined {
  return enemies.find((e) => e.hp > 0);
}

/**
 * 某 instance 是否「当前可被攻击」（= 它就是最前存活节）。
 * 按序门谓词：玩家攻击只允许命中最前存活节；指向更后的节（含已死的前节）→ false（面板诚实给 reason）。
 * 无存活节（全死）→ 任何目标都 false（战斗已应在上层判胜）。
 */
export function isSegmentReachable(
  enemies: readonly EnemyInstance[],
  instanceId: string,
): boolean {
  const front = frontmostLivingSegment(enemies);
  return front !== undefined && front.instanceId === instanceId;
}

/**
 * 威胁派生（纯函数·**不入存档**）：链鳗存活节越少 → 余节越凶（「越杀越短越快越危险」）。
 * 返回加到本次敌方攻击伤害上的整数加成：满节（living>=total）= 0（无加成·与未引入前同量级）；
 * 每死一节 +1（占位线性·**数值待作者调**·见 [[defer-number-tuning]]）。
 * 纯整数算术·无 RNG ⇒ 仅 attackInOrder 遭遇调用即可保证无序 party 的 Math.random 流逐字节不变。
 */
export function chainSegmentDamageBonus(living: number, total: number): number {
  if (total <= 1 || living >= total) return 0;
  const dead = total - living;
  return Math.max(0, dead);
}
