// 特殊敌人机制钩子（战斗系统 SPEC §7 一族·数据驱动）
//
// 11 个自包含钩子，全部由 EnemyDef 数据字段驱动（phases / headEnrage / environmentalPressure /
// splitBehavior / corpseEating / droneReplenish / metamorphosis / maternalBehavior）：不带对应字段的
// 普通敌人在每个钩子里都是 no-op ⇒ 普通战斗逐字节不变。形状统一 GameState→GameState
// （maybeInterceptJuvenile 例外：返回 GameState|null，供 applyAttack 在截击命中时短路返回）。
//
// 共享工具（getEnemyDef / setCombat / pushCombatLog / applyStatsDelta / randRange / rollChance）
// 留在 combat.ts 导出（主流程与钩子两边共用）——combat ↔ combat-mechanics 互为静态 import，
// 但两边模块顶层互不调用（只在运行时进函数体），ESM 循环加载安全。

import type { GameState, EnemyInstance, BossPhase, InventoryItem } from '@/types';
import { addToInventory, enqueuePickup } from './state';
import { frontmostLivingSegment } from './chain-eel';
import {
  getEnemyDef,
  setCombat,
  pushCombatLog,
  applyStatsDelta,
  randRange,
  rollChance,
} from './combat';

// ——— Boss 阶段系统 ———

/**
 * maybeBossPhaseShift：HP 变化后检查是否进入新 boss 阶段。
 *
 * 规则：phases 以 hpThreshold 降序排列（[0.6, 0.3, 0.1]）。
 * "最高已触发阶段" = 数组里满足 phase.hpThreshold >= currentHpRatio 的最大 index。
 * 若比 bossPhaseIndices 记录的更高，则视为进入新阶段：
 *   - 推 transitionText 进 log
 *   - 若有 stanceForce → 更新 instance.stance
 *   - 若有 attacksOverride / aiPatternOverride → 写入 instance.phaseAttacksOverride / phaseAiPattern
 */
export function maybeBossPhaseShift(state: GameState, instanceId: string): GameState {
  if (state.phase.kind !== 'combat') return state;
  const combat = state.phase.combat;
  const instance = combat.enemies.find((e) => e.instanceId === instanceId);
  if (!instance || instance.hp <= 0) return state;
  const def = getEnemyDef(instance.defId);
  if (!def?.phases?.length) return state;

  const currentHpRatio = instance.hp / def.hp;
  // 找满足 hpThreshold >= currentHpRatio 的最大 index（phases 降序·越大 index = 越深触发）
  let highestTriggeredIndex = -1;
  for (let i = 0; i < def.phases.length; i++) {
    if (def.phases[i].hpThreshold >= currentHpRatio) {
      highestTriggeredIndex = i;
    }
  }

  const currentIndex = combat.bossPhaseIndices?.[instanceId] ?? -1;
  if (highestTriggeredIndex <= currentIndex) return state; // 无新阶段

  const newPhase = def.phases[highestTriggeredIndex] as BossPhase;

  // 更新阶段索引
  let s = setCombat(state, (c) => ({
    ...c,
    bossPhaseIndices: { ...(c.bossPhaseIndices ?? {}), [instanceId]: highestTriggeredIndex },
  }));

  // 过渡叙事
  s = pushCombatLog(s, { actor: 'system', text: newPhase.transitionText });

  // 写入实例覆盖（stance / attacksOverride / aiPatternOverride）
  s = setCombat(s, (c) => ({
    ...c,
    enemies: c.enemies.map((e) => {
      if (e.instanceId !== instanceId) return e;
      return {
        ...e,
        ...(newPhase.stanceForce ? { stance: newPhase.stanceForce } : {}),
        ...(newPhase.attacksOverride ? { phaseAttacksOverride: newPhase.attacksOverride } : {}),
        ...(newPhase.aiPatternOverride ? { phaseAiPattern: newPhase.aiPatternOverride } : {}),
      };
    }),
  }));

  return s;
}

/**
 * maybeChainEelEnrage：链鳗（分节实体）头节 enrage —— **party-state 触发**（≠ HP 阈值）。
 *
 * 触发：在 attackInOrder 遭遇里，**最前存活节**（lowest-index living）带 def.headEnrage 且尚未 enrage 时，
 * 视为「头节被逼到最前」（前置体节全死）→ 推 transitionText 进 log、按 headEnrage 写实例覆盖
 * （stance / phaseAttacksOverride / phaseAiPattern·复用 BossPhase 的写法）。
 * 幂等：链鳗里只有本函数把 stance 设 'enraged'，故已 enraged ⇒ 跳过（不重复推文本）。
 *
 * 与 maybeBossPhaseShift（HP 路径·#149/#159）**完全独立**——不改其分发，只共用 stance/attacks 写法套在新触发上。
 * 非 attackInOrder 遭遇 / 最前节无 headEnrage（是体节）→ 直接返回（普通战斗逐字节不变）。
 */
export function maybeChainEelEnrage(state: GameState): GameState {
  if (state.phase.kind !== 'combat') return state;
  const combat = state.phase.combat;
  if (!combat.attackInOrder) return state;
  const front = frontmostLivingSegment(combat.enemies);
  if (!front || front.stance === 'enraged') return state; // 无存活节 / 已 enrage（幂等）
  const def = getEnemyDef(front.defId);
  const enr = def?.headEnrage;
  if (!enr) return state; // 当前最前节是体节（无 headEnrage）→ 不动

  // 过渡叙事（[待过稿]·#117）
  let s = pushCombatLog(state, { actor: 'system', text: enr.transitionText });
  // 写实例覆盖（复用 BossPhase 写法·触发改为 party-state）
  s = setCombat(s, (c) => ({
    ...c,
    enemies: c.enemies.map((e) =>
      e.instanceId === front.instanceId
        ? {
            ...e,
            stance: enr.stanceForce ?? 'enraged',
            ...(enr.attacksOverride ? { phaseAttacksOverride: enr.attacksOverride } : {}),
            ...(enr.aiPatternOverride ? { phaseAiPattern: enr.aiPatternOverride } : {}),
          }
        : e,
    ),
  }));
  return s;
}

/**
 * applyEnvironmentalPressure：累计所有存活 boss 的战场压力并扣减资源。
 * 在每回合 tick 处调用（applyPlayerAction 步骤 0b·紧随 staminaTickPerTurn）。
 * 多 boss 并存时线性叠加（oxygenDrainBonus / staminaTickBonus / sanityDamagePerTurn）。
 */
export function applyEnvironmentalPressure(state: GameState): GameState {
  if (state.phase.kind !== 'combat' || !state.run) return state;
  const combat = state.phase.combat;

  let oxygenDrain = 0;
  let staminaDrain = 0;
  let sanityDmg = 0;

  for (const e of combat.enemies) {
    if (e.hp <= 0) continue;
    const def = getEnemyDef(e.defId);
    if (!def?.environmentalPressure) continue;
    const ep = def.environmentalPressure;
    oxygenDrain += ep.oxygenDrainBonus ?? 0;
    staminaDrain += ep.staminaTickBonus ?? 0;
    sanityDmg += ep.sanityDamagePerTurn ?? 0;
  }

  if (oxygenDrain === 0 && staminaDrain === 0 && sanityDmg === 0) return state;

  let s = state;
  if (oxygenDrain > 0) {
    s = applyStatsDelta(s, { oxygen: -oxygenDrain });
    s = pushCombatLog(s, { actor: 'system', text: `它堵住了出口——氧气消耗加快（氧气 -${oxygenDrain}）。` });
  }
  if (staminaDrain > 0) {
    s = applyStatsDelta(s, { stamina: -staminaDrain });
    s = pushCombatLog(s, { actor: 'system', text: `战场压力让你消耗更快（体力 -${staminaDrain}）。` });
  }
  if (sanityDmg > 0) {
    s = applyStatsDelta(s, { sanity: -sanityDmg });
    s = pushCombatLog(s, { actor: 'system', text: `它的存在本身就在消磨你（理智 -${sanityDmg}）。` });
  }

  return s;
}

// ——— 新 boss 机制钩子 ———

/**
 * maybeEnemySplit（裂球·split-proliferation）：每 intervalTurns 回合检查一次，若目标在本检查周期内
 * 受到伤害 < minDamageToDeny → 分裂产生最多 spawnCount 只新个体（HP = spawnHpRatio × spawnDefId.hp），
 * 总 party 不超 maxPartySize。检查结束后重置 splitDamageAccum + 更新 splitLastCheckTurn。
 * 仅带 splitBehavior 的敌人进分支；普通敌人逐字节不变。
 */
export function maybeEnemySplit(state: GameState): GameState {
  if (state.phase.kind !== 'combat') return state;
  const combat = state.phase.combat;
  const currentTurn = combat.turn;
  let s = state;

  for (const e of combat.enemies) {
    if (e.hp <= 0) continue;
    const def = getEnemyDef(e.defId);
    const sb = def?.splitBehavior;
    if (!sb) continue;

    const lastCheck = e.splitLastCheckTurn ?? 0;
    if (currentTurn - lastCheck < sb.intervalTurns) continue; // 未到检查点

    const damageAccum = e.splitDamageAccum ?? 0;
    const spawnDef = getEnemyDef(sb.spawnDefId);

    // 重置累计伤害 + 记录检查回合
    s = setCombat(s, (c) => ({
      ...c,
      enemies: c.enemies.map((x) =>
        x.instanceId === e.instanceId
          ? { ...x, splitDamageAccum: 0, splitLastCheckTurn: currentTurn }
          : x,
      ),
    }));

    if (damageAccum >= sb.minDamageToDeny) continue; // 受伤够多，不分裂

    const curPartySize = (s.phase.kind === 'combat' ? s.phase.combat.enemies : []).filter((x) => x.hp > 0).length;
    const slots = Math.max(0, sb.maxPartySize - curPartySize);
    if (slots <= 0 || !spawnDef) continue;

    const toSpawn = Math.min(sb.spawnCount, slots);
    const spawnHp = Math.max(1, Math.round(spawnDef.hp * sb.spawnHpRatio));
    const spawnName = spawnDef.name;
    const encId = s.phase.kind === 'combat' ? s.phase.combat.combatId : 'split';

    s = pushCombatLog(s, {
      actor: 'system',
      text: `${def.name} 崩开——裂成 ${toSpawn} 只更小的。`,
    });

    // 唯一性后缀＝状态内单调计数 spawnSeq（同毫秒多批次 spawn 用 Date.now() 必撞号·见 CombatState.spawnSeq）
    const seqStart = (s.phase.kind === 'combat' ? s.phase.combat.spawnSeq : undefined) ?? 0;
    const newInstances = Array.from({ length: toSpawn }, (_, i) => ({
      instanceId: `${encId}.split.${seqStart + i}`,
      defId: sb.spawnDefId,
      hp: spawnHp,
      stance: 'attacking' as const,
      aggro: spawnDef.threat,
      statuses: [],
      // 新分裂个体的检查周期从**它出生的回合**起算——不种则缺省 0＝「从开战起算」，出生即到期、
      // 下回合立刻再分裂（旧撞号 bug 曾把这条级联掩盖成「一击打多只」·见 CombatState.spawnSeq）。
      splitLastCheckTurn: currentTurn,
    }));

    s = setCombat(s, (c) => ({ ...c, enemies: [...c.enemies, ...newInstances], spawnSeq: seqStart + toSpawn }));
    s = pushCombatLog(s, { actor: 'system', text: `${toSpawn} 只${spawnName}出现在你周围。` });
  }

  return s;
}

/**
 * maybeCorpseEat（清道夫·corpse-eating）：killedInstanceId 所代表的敌人 HP ≤ 0 时，
 * party 内带 corpseEating 的敌人获得 HP 回复，并吸收 absorbsAttacksFrom 列出的 defId 的攻击。
 * 若 killedInstanceId 的敌人仍然存活（HP > 0），本函数为 no-op（守幂等）。
 */
export function maybeCorpseEat(state: GameState, killedInstanceId: string): GameState {
  if (state.phase.kind !== 'combat') return state;
  const combat = state.phase.combat;

  const killed = combat.enemies.find((e) => e.instanceId === killedInstanceId);
  if (!killed || killed.hp > 0) return state; // 目标未死

  const killedDef = getEnemyDef(killed.defId);
  let s = state;

  for (const e of combat.enemies) {
    if (e.hp <= 0 || e.instanceId === killedInstanceId) continue;
    const def = getEnemyDef(e.defId);
    const ce = def?.corpseEating;
    if (!ce) continue;

    // HP 回复（不超过自身 def.hp 上限）
    const newHp = Math.min(def.hp, e.hp + ce.hpGainPerCorpse);
    s = setCombat(s, (c) => ({
      ...c,
      enemies: c.enemies.map((x) =>
        x.instanceId === e.instanceId ? { ...x, hp: newHp } : x,
      ),
    }));
    s = pushCombatLog(s, {
      actor: 'enemy',
      text: `${def.name} 扑上去吃掉了尸体——它恢复了 ${newHp - e.hp} 点生命。`,
    });

    // 吸收攻击（仅当死亡敌人的 defId 在 absorbsAttacksFrom 列表中）
    if (ce.absorbsAttacksFrom?.includes(killed.defId) && killedDef) {
      const newAttacks = killedDef.attacks.map((a) => ({
        ...a,
        id: `absorbed.${a.id}`, // 避免 id 冲突
      }));
      s = setCombat(s, (c) => ({
        ...c,
        enemies: c.enemies.map((x) =>
          x.instanceId === e.instanceId
            ? { ...x, absorbedAttacks: [...(x.absorbedAttacks ?? []), ...newAttacks] }
            : x,
        ),
      }));
      s = pushCombatLog(s, {
        actor: 'system',
        text: `${def.name} 消化了${killedDef.name}——它的本能变成了它自己的。`,
      });
    }
  }

  return s;
}

/**
 * maybeReplenishDrones（菌群鱼·droneReplenish）：女王行动前检查场上工蜂数量，
 * 不足 minCount 则补充（总 party 不超 maxPartySize）。仅带 droneReplenish 的敌人触发；普通敌人逐字节不变。
 */
export function maybeReplenishDrones(state: GameState): GameState {
  if (state.phase.kind !== 'combat') return state;
  const combat = state.phase.combat;
  let s = state;

  for (const e of combat.enemies) {
    if (e.hp <= 0) continue;
    const def = getEnemyDef(e.defId);
    const dr = def?.droneReplenish;
    if (!dr) continue;

    const liveDrones = combat.enemies.filter((x) => x.hp > 0 && x.defId === dr.spawnDefId).length;
    if (liveDrones >= dr.minCount) continue;

    const curTotal = combat.enemies.filter((x) => x.hp > 0).length;
    const need = dr.minCount - liveDrones;
    const slots = Math.max(0, dr.maxPartySize - curTotal);
    const toSpawn = Math.min(need, slots);
    if (toSpawn <= 0) continue;

    const spawnDef = getEnemyDef(dr.spawnDefId);
    if (!spawnDef) continue;

    const encId = s.phase.kind === 'combat' ? s.phase.combat.combatId : 'drone';
    // 唯一性后缀＝状态内单调计数 spawnSeq（同 maybeEnemySplit·同毫秒批次 Date.now() 必撞号）
    const seqStart = (s.phase.kind === 'combat' ? s.phase.combat.spawnSeq : undefined) ?? 0;
    const newDrones = Array.from({ length: toSpawn }, (_, i) => ({
      instanceId: `${encId}.drone.${seqStart + i}`,
      defId: dr.spawnDefId,
      hp: spawnDef.hp,
      stance: 'attacking' as const,
      aggro: spawnDef.threat,
      statuses: [],
    }));

    s = setCombat(s, (c) => ({ ...c, enemies: [...c.enemies, ...newDrones], spawnSeq: seqStart + toSpawn }));
    s = pushCombatLog(s, {
      actor: 'system',
      text: `${def.name} 排出 ${toSpawn} 只${spawnDef.name}——它们从缝隙里钻出来。`,
    });
  }

  return s;
}

/**
 * maybeMetamorphosis（茧化居民·metamorphosis）：每回合检查带 metamorphosis 的敌人的阶段状态。
 * - larva + 玩家氧气 ≤ cocoonTriggerOxygen → 茧化（phaseArmorOverride=cocoonArmor，计时开始）。
 * - cocoon + hp 已在 applyAttack 降至 0 → 茧破（奖励掉落 + 成体复活）。
 * - cocoon + cocoonTurnsLeft 已由 maybeCocoonCountdown 清零 → 羽化成体。
 * 非 metamorphosis 敌人逐字节不变。
 */
export function maybeMetamorphosis(state: GameState): GameState {
  if (state.phase.kind !== 'combat' || !state.run) return state;
  const oxygen = state.run.stats.oxygen;
  let s = state;

  for (const e of (s.phase.kind === 'combat' ? s.phase.combat.enemies : [])) {
    const def = getEnemyDef(e.defId);
    const meta = def?.metamorphosis;
    if (!meta) continue;

    const stage = e.metamorphosisStage ?? 'larva';

    if (stage === 'larva' && oxygen <= meta.cocoonTriggerOxygen) {
      // 幼体→茧化
      s = setCombat(s, (c) => ({
        ...c,
        enemies: c.enemies.map((x) =>
          x.instanceId === e.instanceId
            ? { ...x, metamorphosisStage: 'cocoon', cocoonTurnsLeft: meta.cocoonMaxTurns, phaseArmorOverride: meta.cocoonArmor }
            : x,
        ),
      }));
      s = pushCombatLog(s, {
        actor: 'system',
        text: `${def.name} 开始包裹自己——它在缩紧，外壳变硬。`,
      });
    } else if (stage === 'cocoon' && e.hp <= 0) {
      // 茧被击破
      if (meta.cocoonBreakBonus && s.run) {
        const bonusLoot: InventoryItem[] = [];
        for (const bonus of meta.cocoonBreakBonus) {
          const qty = randRange(bonus.qty);
          if (qty > 0 && s.run) {
            s = { ...s, run: { ...s.run!, inventory: addToInventory(s.run.inventory, bonus.itemId, qty) } };
            bonusLoot.push({ itemId: bonus.itemId, qty });
          }
        }
        s = enqueuePickup(s, bonusLoot, '战利品');
      }
      // 成体复活（HP 恢复 adultHp·清除护甲覆盖·换攻击表）
      s = setCombat(s, (c) => ({
        ...c,
        enemies: c.enemies.map((x) =>
          x.instanceId === e.instanceId
            ? {
                ...x,
                hp: meta.adultHp,
                metamorphosisStage: 'adult' as const,
                cocoonTurnsLeft: undefined,
                phaseArmorOverride: undefined,
                phaseAttacksOverride: meta.adultAttacksOverride,
                stance: 'attacking' as const,
              }
            : x,
        ),
      }));
      s = pushCombatLog(s, {
        actor: 'system',
        text: `茧壳从内部炸开——${def.name} 羽化出来，比原来快了三倍。`,
      });
    } else if (stage === 'cocoon' && (e.cocoonTurnsLeft ?? 1) <= 0) {
      // 茧化计时归零→羽化成体（HP 满格·攻击表替换）
      s = setCombat(s, (c) => ({
        ...c,
        enemies: c.enemies.map((x) =>
          x.instanceId === e.instanceId
            ? {
                ...x,
                hp: meta.adultHp,
                metamorphosisStage: 'adult' as const,
                cocoonTurnsLeft: undefined,
                phaseArmorOverride: undefined,
                phaseAttacksOverride: meta.adultAttacksOverride,
                stance: 'attacking' as const,
              }
            : x,
        ),
      }));
      s = pushCombatLog(s, {
        actor: 'system',
        text: `茧化完成——${def.name} 撑破外壳，以全新的姿态出现。`,
      });
    }
  }

  return s;
}

/**
 * maybeCocoonCountdown（茧化居民·每轮末倒计时）：递减 cocoonTurnsLeft；到 0 时
 * 下一次 maybeMetamorphosis 将触发羽化。分离计时与转换逻辑，避免同回合双重判断。
 */
export function maybeCocoonCountdown(state: GameState): GameState {
  if (state.phase.kind !== 'combat') return state;
  return setCombat(state, (c) => ({
    ...c,
    enemies: c.enemies.map((e) => {
      if (e.metamorphosisStage !== 'cocoon' || e.cocoonTurnsLeft === undefined) return e;
      return { ...e, cocoonTurnsLeft: Math.max(0, e.cocoonTurnsLeft - 1) };
    }),
  }));
}

// ——— 口孵深鱼（maternalBehavior）钩子 ———

/**
 * maybeInterceptJuvenile（口孵深鱼·截击）：玩家攻击命中护巢仔时，母鱼以 interceptChance 概率
 * 跃出截击——伤害以 armorWhileProtected 减伤后转移到母鱼，护巢仔不受伤。
 *
 * 在 applyAttack 的装甲计算**之前**调用（rawDmg = pre-armor 命中强度）：
 *   - interceptChance ≥ 1 → rollChance 不掷骰（零 RNG 消耗·既有 baseline 逐字节不变）。
 *   - interceptChance < 1 → 掷一次骰（⚠️ 改变 RNG 流·需重新录 baseline·defer-number-tuning）。
 *
 * 返回 non-null = 截击已处理，applyAttack 应直接 return 此值；null = 未截击，继续正常流程。
 */
export function maybeInterceptJuvenile(
  state: GameState,
  target: EnemyInstance,
  rawDmg: number,
  damageType: string,
  attackName: string,
): GameState | null {
  if (state.phase.kind !== 'combat') return null;
  const combat = state.phase.combat;

  // 找带 maternalBehavior + shieldedBy 含此护巢仔 defId 的母鱼（存活）
  for (const e of combat.enemies) {
    if (e.hp <= 0) continue;
    const def = getEnemyDef(e.defId);
    const mb = def?.maternalBehavior;
    if (!mb) continue;
    if (!def.shieldedBy?.includes(target.defId)) continue;

    // interceptChance≥1 → rollChance 必触发且零 RNG；<1 → 掷一次骰
    if (!rollChance(mb.interceptChance)) return null;

    // 截击触发：母鱼以 armorWhileProtected 减伤（非双重减伤·raw dmg 尚未经护巢仔装甲）
    const interceptDmg = damageType === 'physical'
      ? Math.max(1, rawDmg - mb.armorWhileProtected)
      : rawDmg;

    let s = setCombat(state, (c) => ({
      ...c,
      enemies: c.enemies.map((x) =>
        x.instanceId === e.instanceId
          ? { ...x, hp: Math.max(0, x.hp - interceptDmg), aggro: x.aggro + Math.ceil(interceptDmg / 5) }
          : x,
      ),
    }));
    s = pushCombatLog(s, {
      actor: 'enemy',
      text: `${def.name} 冲到前面截下了这一击——${attackName}命中母鱼，造成 ${interceptDmg} 点伤害。`,
    });
    // boss 阶段检查（截击可能推过 HP 阈值）
    s = maybeBossPhaseShift(s, e.instanceId);
    return s;
  }

  return null; // 目标不是任何母鱼的护巢仔，或截击未触发
}

/**
 * maybeConsumeJuvenile（口孵深鱼·消耗护巢仔）：母鱼 HP < 50% 时，于敌方回合开头消耗一只存活护巢仔
 * 回血（consumeJuvenileHpGain，不超过 def.hp 上限）。per-turn 自然节流——每次调用至多消耗一只。
 * 消耗后立即调用 applyMaternalEnrageIfAlone（若是最后一只护巢仔则触发 enrage）。
 * 仅带 maternalBehavior 的敌人进分支；普通敌人逐字节不变。
 */
export function maybeConsumeJuvenile(state: GameState): GameState {
  if (state.phase.kind !== 'combat') return state;
  const combat = state.phase.combat;
  let s = state;

  for (const e of combat.enemies) {
    if (e.hp <= 0) continue;
    const def = getEnemyDef(e.defId);
    const mb = def?.maternalBehavior;
    if (!mb) continue;

    // 触发条件：HP < 50%
    if (e.hp >= def.hp * 0.5) continue;

    // 找一只存活护巢仔
    const shieldedDefIds = def.shieldedBy ?? [];
    const juvenile = (s.phase.kind === 'combat' ? s.phase.combat.enemies : [])
      .find((x) => x.hp > 0 && shieldedDefIds.includes(x.defId));
    if (!juvenile) continue;

    const juvenileDef = getEnemyDef(juvenile.defId);
    const newMothHp = Math.min(def.hp, e.hp + mb.consumeJuvenileHpGain);
    const actualHeal = newMothHp - e.hp;

    // 护巢仔 HP→0（被母鱼吞回·非战斗击杀·不触发 corpseEating·不给玩家战利品）
    s = setCombat(s, (c) => ({
      ...c,
      enemies: c.enemies.map((x) =>
        x.instanceId === juvenile.instanceId ? { ...x, hp: 0 } : x,
      ),
    }));
    // 母鱼回血
    s = setCombat(s, (c) => ({
      ...c,
      enemies: c.enemies.map((x) =>
        x.instanceId === e.instanceId ? { ...x, hp: newMothHp } : x,
      ),
    }));
    s = pushCombatLog(s, {
      actor: 'enemy',
      text: `${def.name} 将一只${juvenileDef?.name ?? '护巢幼鱼'}重新噙入口中——它恢复了 ${actualHeal} 点生命。`,
    });
    // 护巢仔全灭检查（吞仔后可能触发 enrage）
    s = applyMaternalEnrageIfAlone(s);
  }

  return s;
}

/**
 * applyMaternalEnrageIfAlone（口孵深鱼·护巢仔全灭 enrage）：检查带 maternalBehavior 的母鱼，
 * 若 shieldedBy 列出的所有护巢仔均已死亡（hp ≤ 0）→ 写入 phaseAttacksOverride（enragedAttacks），
 * 切换 stance = 'enraged'。
 * 复用 BossPhase.attacksOverride 同款字段（enemyAttackPlayer 已读 phaseAttacksOverride·无额外改动）。
 * 幂等：已有 phaseAttacksOverride 的母鱼跳过（防重复触发）。非 maternalBehavior 敌人逐字节不变。
 */
export function applyMaternalEnrageIfAlone(state: GameState): GameState {
  if (state.phase.kind !== 'combat') return state;
  const combat = state.phase.combat;
  let s = state;

  for (const e of combat.enemies) {
    if (e.hp <= 0) continue;
    if (e.phaseAttacksOverride) continue; // 已 enrage（幂等守卫）
    const def = getEnemyDef(e.defId);
    const mb = def?.maternalBehavior;
    if (!mb) continue;

    const shieldedDefIds = def.shieldedBy ?? [];
    if (shieldedDefIds.length === 0) continue;

    // 所有护巢仔均已不在（hp ≤ 0）？
    const anyAlive = (s.phase.kind === 'combat' ? s.phase.combat.enemies : [])
      .some((x) => x.hp > 0 && shieldedDefIds.includes(x.defId));
    if (anyAlive) continue;

    // 护巢仔全灭 → enrage
    s = setCombat(s, (c) => ({
      ...c,
      enemies: c.enemies.map((x) =>
        x.instanceId === e.instanceId
          ? { ...x, phaseAttacksOverride: mb.enragedAttacks, stance: 'enraged' as const }
          : x,
      ),
    }));
    s = pushCombatLog(s, {
      actor: 'enemy',
      text: `${def.name} 的护巢幼鱼全部消失了——它的身体突然膨胀，出击节律完全变了。`,
    });
  }

  return s;
}
