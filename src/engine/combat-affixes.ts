// 敌人词条（affix）系统试点·状态可变钩子（2026-07-12 #298·从 combat.ts 外移·守 file-budget）——
// combat-mechanics.ts / combat-warren.ts 同族拆法：自包含钩子，全部由 EnemyInstance.affixes 数据驱动，
// 不带词条的普通敌人在每个钩子里都是 no-op（或早退）⇒ 无词条战斗逐字节不变。
//
// 依赖：combat.ts 的共享工具（setCombat/pushCombatLog/enemyAttackPlayer）+ affixes.ts 的判定/常量
// （hasAffix/BERSERK_EXTRA_ATTACKS/REGEN_HP_FRACTION/VENOM_STATUS）。combat.ts ↔ combat-affixes.ts
// 互为静态 import，但两边模块顶层互不调用（只在运行时进函数体）——ESM 循环加载安全（同 combat-mechanics.ts 的约定）。
//
// 硬壳（hardshell）防御力乘数与灵巧（nimble）闪避判定不在本文件：hardshell 计算太贴 applyAttack 的伤害管线、
// 留在 combat.ts 内联；nimble 判定（resolveDodge）无状态可变、纯函数，已外移进 affixes.ts（见该文件）。

import type { GameState, EnemyInstance, EnemyDef } from '@/types';
import { hasAffix, BERSERK_EXTRA_ATTACKS, REGEN_HP_FRACTION, VENOM_STATUS } from './affixes';
import { setCombat, pushCombatLog, enemyAttackPlayer } from './combat';

/**
 * 狂暴词条（berserk）：本回合出手后再追加 BERSERK_EXTRA_ATTACKS 次攻击（runEnemyTurn 敌人常规攻击之后调用）。
 * 每次追加前重新读一遍活状态（不吃调用方传入 `cur` 的过期快照）：攻击者本身还活着且没被眩晕（当前没有会在
 * 敌人回合中途反过来眩晕攻击者的机制，但这里按规范防御式检查，为将来的反击/荆棘类效果留口）、
 * 玩家还活着（player HP≤0 时下面 applyPlayerAction 会走 executeDeath 收束，这里不必再打）。
 * 无 berserk 词条 → 首行早退，零额外 RNG/状态改动（既有 baseline 逐字节不变）。
 */
export function applyBerserkExtraAttacks(state: GameState, cur: EnemyInstance): GameState {
  let s = state;
  if (!hasAffix(cur.affixes, 'berserk')) return s;
  for (let i = 0; i < BERSERK_EXTRA_ATTACKS; i++) {
    const attackerNow = s.phase.kind === 'combat'
      ? s.phase.combat.enemies.find((x) => x.instanceId === cur.instanceId)
      : undefined;
    if (!attackerNow || attackerNow.hp <= 0) break;
    if (attackerNow.statuses.some((st) => st.kind === 'stunned')) break;
    if (!s.run || s.run.stats.hp <= 0) break;
    s = enemyAttackPlayer(s, attackerNow);
  }
  return s;
}

/**
 * 自愈词条（regen）：己方回合开头（DoT 结算之后）按最大 HP 比例回血，封顶 def.hp——与眩晕/是否出手正交
 * （活着就回，这是被动·不占行动）。`settledHp` 传结算 DoT 之后的当前 HP（runEnemyTurn 在 settleStatusesAtTurnStart
 * 之后调用）；`liveAffixes` 传该敌人实例的 affixes 数组。无 regen 词条 / 已死 / 满血 → 早退，零状态改动。
 */
export function applyRegenAtTurnStart(
  state: GameState,
  enemyInstanceId: string,
  def: EnemyDef,
  settledHp: number,
  liveAffixes: string[] | undefined,
): GameState {
  let s = state;
  if (!hasAffix(liveAffixes, 'regen') || settledHp <= 0) return s;
  const healAmt = Math.min(def.hp - settledHp, Math.ceil(def.hp * REGEN_HP_FRACTION));
  if (healAmt <= 0) return s;
  s = setCombat(s, (c) => ({
    ...c,
    enemies: c.enemies.map((x) => (x.instanceId === enemyInstanceId ? { ...x, hp: x.hp + healAmt } : x)),
  }));
  s = pushCombatLog(s, { actor: 'system', text: `${def.name} 的伤口以肉眼可见的速度收合，回复 ${healAmt} 点生命。` });
  return s;
}

/**
 * 剧毒词条（venom）：带此词条的敌人每次攻击命中玩家额外挂一层中毒——与该次攻击本身的 applyStatusOnHit
 * （若攻击表那一击也带状态）叠加，不互斥、不去重（战斗状态系统 SPEC §2.2 纯堆叠约定）。
 * 由 enemyAttackPlayer 在结算完常规命中效果之后调用；无 venom 词条 → 早退，零状态改动。
 */
export function applyVenomOnHit(state: GameState, enemy: EnemyInstance): GameState {
  let s = state;
  if (!hasAffix(enemy.affixes, 'venom') || s.phase.kind !== 'combat') return s;
  s = setCombat(s, (c) => ({
    ...c,
    playerStatuses: [
      ...(c.playerStatuses ?? []),
      { kind: VENOM_STATUS.kind, remainingTurns: VENOM_STATUS.turns, dmgPerTurn: VENOM_STATUS.dmgPerTurn },
    ],
  }));
  return s;
}
