// The Warren（蜂群 boss·the Gravid Queen）女王身体库存主线机制（战斗系统 SPEC §15·#271）。
//
// 从 combat-mechanics.ts 外移（#271·守 check-file-budget 900 默认·warren 自成子系统·参照 combat-mechanics/mapgen-* 拆法）：
// 六分支优先级树 dispatcher（maybeWarrenQueenAct·§15.3）+ feed/screen/lay/force-hatch/detonate/hatch/cocoon-boost 分支助手
// + 动态 screen 门（queenScreened·checkActionAvailability 复用）+ 近期伤害计数（recordQueenDamage·§15.4）+ 开战起盾
// （warrenInitScreen）+ 繁殖储备节流（退役 droneReplenish·§15.1）。全 GameState→GameState(|null)·仅女王 def 进分支·普通敌人逐字节不变。
//
// 依赖：combat.ts 的共享工具（getEnemyDef/setCombat/pushCombatLog/rollChance）+ combat-mechanics.ts 的 Puffer 自爆原语
// （pufferArmed/detonateSelfDestruct）。三者互为静态 import·模块顶层互不调用（只运行时进函数体）·ESM 循环加载安全。

import type { GameState, EnemyInstance } from '@/types';
import { getEnemyDef, setCombat, pushCombatLog, rollChance } from './combat';
import { pufferArmed, detonateSelfDestruct } from './combat-mechanics';

//
// §14 分散的吼叫/信息素/产卵/回血/结盾 → §15 收口成**一条主线＝耗空她的身体库存**（活的非女王单位 + 卵）。
// 女王每敌方回合从优先级树（maybeWarrenQueenAct）**择一**执行——一个池子、一个反制你打法的动作：
//   1 血低+可献祭 → feed（献祭回血·替 corpseEating）
//   2 近期挨打+无活盾+有身体 → screen（动态肉盾·替 shieldedBy）
//   3 作战单位少 → 有茧/卵 force-hatch·否则 lay（繁殖储备节流·退役 droneReplenish）
//   4 都不满足 → detonate > hatch > cocoon-boost（吼·填充档）
// 每分支 GameState→GameState|null（null＝条件不满足·落下一支）。roarChance 已退役（§15.6·按需触发·非每回合掷骰）。

/** 池子取一：按 priority defId 顺序取第一个满足 ok 的实例·表内取尽再任意兜底（feed 献祭用）。 */
function pickByPriority(
  enemies: EnemyInstance[],
  priority: string[] | undefined,
  ok: (e: EnemyInstance) => boolean,
): EnemyInstance | undefined {
  if (priority) {
    for (const defId of priority) {
      const hit = enemies.find((e) => e.defId === defId && ok(e));
      if (hit) return hit;
    }
  }
  return enemies.find(ok);
}

/** 该女王当前是否有活肉盾（screen 门·checkActionAvailability 与 screen 分支复用·§15.2）。 */
export function queenScreened(enemies: EnemyInstance[], queenInstanceId: string): boolean {
  const q = enemies.find((e) => e.instanceId === queenInstanceId && e.hp > 0);
  if (!q || !getEnemyDef(q.defId)?.warrenScreen) return false;
  return enemies.some((e) => e.hp > 0 && e.screeningFor === queenInstanceId);
}

/** 窗口内女王近期累计挨打伤害（screen 触发条件·§15.4）。 */
function sumRecentQueenDamage(queen: EnemyInstance, currentTurn: number, window: number): number {
  return (queen.recentDamageLog ?? [])
    .filter((r) => r.turn > currentTurn - window)
    .reduce((a, r) => a + r.dmg, 0);
}

/**
 * recordQueenDamage（screen 触发计数·§15.4）：applyAttack 命中带 warrenScreen 的女王后追加 {turn,dmg} 到其
 * recentDamageLog、按 recentDamageWindow 修剪。仅女王写此字段 ⇒ 普通敌人逐字节不变。
 */
export function recordQueenDamage(state: GameState, targetId: string, dmg: number): GameState {
  if (state.phase.kind !== 'combat' || dmg <= 0) return state;
  const tgt = state.phase.combat.enemies.find((e) => e.instanceId === targetId);
  const sc = tgt && getEnemyDef(tgt.defId)?.warrenScreen;
  if (!tgt || !sc) return state;
  return setCombat(state, (c) => ({
    ...c,
    enemies: c.enemies.map((e) =>
      e.instanceId === targetId
        ? { ...e, recentDamageLog: [...(e.recentDamageLog ?? []).filter((r) => r.turn > c.turn - sc.recentDamageWindow), { turn: c.turn, dmg }] }
        : e,
    ),
  }));
}

/**
 * warrenInitScreen（开战起手起初始肉盾·§15.2）：女王入场即从池子拉 shieldCount 只活的非女王非茧单位当盾
 * （否则第 1 回合玩家先手时女王裸露·丢「先破墙」手感）。startCombat 末调用一次。幂等（已有盾就跳过）。
 */
export function warrenInitScreen(state: GameState): GameState {
  if (state.phase.kind !== 'combat') return state;
  let s = state;
  for (const q of state.phase.combat.enemies) {
    const sc = getEnemyDef(q.defId)?.warrenScreen;
    if (!sc || q.hp <= 0) continue;
    const enemies = s.phase.kind === 'combat' ? s.phase.combat.enemies : [];
    if (enemies.some((e) => e.hp > 0 && e.screeningFor === q.instanceId)) continue; // 已有盾
    const pool = enemies.filter(
      (e) => e.hp > 0 && e.instanceId !== q.instanceId && e.metamorphosisStage !== 'cocoon' && !e.screeningFor,
    );
    if (pool.length === 0) continue;
    const chosen = pool.slice(0, Math.max(1, sc.shieldCount)).map((e) => e.instanceId);
    s = setCombat(s, (c) => ({
      ...c,
      enemies: c.enemies.map((e) => (chosen.includes(e.instanceId) ? { ...e, screeningFor: q.instanceId } : e)),
    }));
  }
  return s;
}

/**
 * 繁殖储备缓慢恢复（每女王回合·先于可能的产卵消耗·§15.1）。
 * **死角（the Hatchery）不恢复**——储备只降不升 ⇒ 有限窝（reserveMax/reserveCostPerLay 批后见底）⇒ 补池熄火 ⇒
 * 池子只出不进·女王吃光自己的卵后再无得吃、暴露窗常开、可杀（§4「卵有限·吃光即再无得吃」+ §15.1 跑步机护栏
 * 的**结构保证**·非仅靠数值节流——节流会自纠到非零平衡·不保证净耗尽，死角硬止恢复才保证。非死角照常缓慢恢复）。
 */
function warrenRecoverReserve(state: GameState, queenId: string): GameState {
  if (state.phase.kind !== 'combat') return state;
  if (state.phase.combat.warrenRoom?.isHatchery) return state; // 死角只出不进（§4/§15.1·见上）
  const q = state.phase.combat.enemies.find((e) => e.instanceId === queenId);
  const wr = q && getEnemyDef(q.defId)?.warrenReinforce;
  if (!q || !wr) return state;
  const cur = q.layReserve ?? wr.reserveMax;
  if (cur >= wr.reserveMax) return state;
  const next = Math.min(wr.reserveMax, cur + wr.reserveRecoveryPerTurn);
  return setCombat(state, (c) => ({
    ...c,
    enemies: c.enemies.map((e) => (e.instanceId === queenId ? { ...e, layReserve: next } : e)),
  }));
}

/** 分支 1·feed（献祭回血·§15.2/§15.3①）：血低+池子有可献祭单位 → 吞一只回血·被吞进 fledInstanceIds 不掉料。 */
function warrenTryFeed(state: GameState, queenId: string): GameState | null {
  if (state.phase.kind !== 'combat') return null;
  const enemies = state.phase.combat.enemies;
  const q = enemies.find((e) => e.instanceId === queenId && e.hp > 0);
  const def = q && getEnemyDef(q.defId);
  const fd = def?.warrenFeed;
  if (!q || !fd || q.hp > def!.hp * fd.triggerHpRatio) return null;
  // 可献祭：活·非女王·（非茧 或 是卵＝§4 吃己卵·fork 2）
  const eggId = def!.warrenReinforce?.eggDefId;
  const canSacrifice = (e: EnemyInstance) =>
    e.hp > 0 && e.instanceId !== queenId && (e.metamorphosisStage !== 'cocoon' || e.defId === eggId);
  const pick = pickByPriority(enemies, fd.sacrificePriority, canSacrifice);
  if (!pick) return null;
  const heal = Math.min(def!.hp, q.hp + fd.hpGainPerSacrifice) - q.hp;
  let s = pushCombatLog(state, { actor: 'enemy', text: fd.feedText });
  s = setCombat(s, (c) => ({
    ...c,
    enemies: c.enemies.map((e) =>
      e.instanceId === pick.instanceId ? { ...e, hp: 0 } : e.instanceId === queenId ? { ...e, hp: e.hp + heal } : e,
    ),
    fledInstanceIds: [...(c.fledInstanceIds ?? []), pick.instanceId], // 被吞≠被杀·不给玩家战利品（#244）
  }));
  return s;
}

/** 分支 2·screen（动态肉盾·§15.2/§15.3②）：近期挨打+无活盾+池子有可拉单位 → 拉 N 只当盾（screeningFor 标）。 */
function warrenTryScreen(state: GameState, queenId: string): GameState | null {
  if (state.phase.kind !== 'combat') return null;
  const enemies = state.phase.combat.enemies;
  const turn = state.phase.combat.turn;
  const q = enemies.find((e) => e.instanceId === queenId && e.hp > 0);
  const sc = q && getEnemyDef(q.defId)?.warrenScreen;
  if (!q || !sc) return null;
  if (enemies.some((e) => e.hp > 0 && e.screeningFor === queenId)) return null; // 已有活盾（§15.3②「盾破」）
  if (sumRecentQueenDamage(q, turn, sc.recentDamageWindow) < sc.recentDamageThreshold) return null;
  const pool = enemies.filter(
    (e) => e.hp > 0 && e.instanceId !== queenId && e.metamorphosisStage !== 'cocoon' && !e.screeningFor,
  );
  if (pool.length === 0) return null; // 池子空 → 拉不出盾（跑步机护栏·§15.2）
  const chosen = pool.slice(0, Math.max(1, sc.shieldCount)).map((e) => e.instanceId);
  let s = pushCombatLog(state, { actor: 'enemy', text: sc.screenText });
  s = setCombat(s, (c) => ({
    ...c,
    enemies: c.enemies.map((e) => (chosen.includes(e.instanceId) ? { ...e, screeningFor: queenId } : e)),
  }));
  return s;
}

/** 全部茧/卵 cocoonTurnsLeft→0 立即孵化（hatch·§15.2·lay 分支与 filler 复用）。 */
function warrenForceHatch(state: GameState, queenId: string): GameState {
  if (state.phase.kind !== 'combat') return state;
  const q = state.phase.combat.enemies.find((e) => e.instanceId === queenId);
  const ph = q && getEnemyDef(q.defId)?.warrenPheromones;
  if (!ph) return state;
  let s = pushCombatLog(state, { actor: 'enemy', text: ph.roarText });
  s = setCombat(s, (c) => ({
    ...c,
    enemies: c.enemies.map((e) => (e.hp > 0 && e.metamorphosisStage === 'cocoon' ? { ...e, cocoonTurnsLeft: 0 } : e)),
  }));
  return s;
}

/** 产卵（lay·繁殖储备节流·§15.1/§15.2）：储备越低→间隔越长、每次产卵量按储备比缩减·见底＝产不出（落 filler）。 */
function warrenLayEggs(state: GameState, queenId: string): GameState | null {
  if (state.phase.kind !== 'combat' || !state.run) return null;
  const combat = state.phase.combat;
  const q = combat.enemies.find((e) => e.instanceId === queenId && e.hp > 0);
  const wr = q && getEnemyDef(q.defId)?.warrenReinforce;
  if (!q || !wr) return null;
  const reserve = q.layReserve ?? wr.reserveMax;
  const ratio = wr.reserveMax > 0 ? Math.max(0, Math.min(1, reserve / wr.reserveMax)) : 0;
  // 间隔节流：储备见底额外拉长
  const interval = wr.minLayInterval + Math.round((1 - ratio) * wr.lowReserveIntervalBonus);
  if (q.lastLayTurn !== undefined && combat.turn - q.lastLayTurn < interval) return null;
  // 产卵量按储备比缩减（见底＝0＝产不出）
  const roomsCleared = state.run.warrenHunt?.roomsCleared ?? 0;
  const curTotal = combat.enemies.filter((e) => e.hp > 0).length;
  const want = Math.ceil((wr.baseCap + roomsCleared * wr.capPerRelocate) * ratio);
  const toLay = Math.min(want, Math.max(0, wr.maxPartySize - curTotal));
  if (toLay <= 0) return null;
  const eggDef = getEnemyDef(wr.eggDefId);
  if (!eggDef?.metamorphosis) return null;
  const meta = eggDef.metamorphosis;
  const seqStart = combat.spawnSeq ?? 0;
  const eggs = Array.from({ length: toLay }, (_, i) => ({
    instanceId: `${combat.combatId}.egg.${seqStart + i}`,
    defId: wr.eggDefId,
    hp: eggDef.hp,
    stance: 'unaware' as const,
    aggro: 0,
    statuses: [],
    metamorphosisStage: 'cocoon' as const,
    cocoonTurnsLeft: meta.cocoonMaxTurns,
    phaseArmorOverride: meta.cocoonArmor,
  }));
  let s = pushCombatLog(state, { actor: 'enemy', text: wr.layText });
  s = setCombat(s, (c) => ({
    ...c,
    enemies: [
      ...c.enemies.map((e) =>
        e.instanceId === queenId
          ? { ...e, layReserve: Math.max(0, reserve - wr.reserveCostPerLay), lastLayTurn: c.turn }
          : e,
      ),
      ...eggs,
    ],
    spawnSeq: seqStart + toLay,
  }));
  return s;
}

/** 分支 3·lay/force-hatch（补拦截·§15.3③）：作战单位（活·非女王·非茧）少 → 有茧/卵先 force-hatch·否则产卵。 */
function warrenTryLayOrHatch(state: GameState, queenId: string): GameState | null {
  if (state.phase.kind !== 'combat') return null;
  const enemies = state.phase.combat.enemies;
  const q = enemies.find((e) => e.instanceId === queenId && e.hp > 0);
  const wr = q && getEnemyDef(q.defId)?.warrenReinforce;
  if (!q || !wr) return null;
  const combatUnits = enemies.filter(
    (e) => e.hp > 0 && e.instanceId !== queenId && e.metamorphosisStage !== 'cocoon',
  ).length;
  if (combatUnits > wr.lowUnitThreshold) return null;
  const hasCocoon = enemies.some((e) => e.hp > 0 && e.metamorphosisStage === 'cocoon');
  if (hasCocoon && getEnemyDef(q.defId)?.warrenPheromones?.forceHatch) {
    return warrenForceHatch(state, queenId);
  }
  return warrenLayEggs(state, queenId); // 储备/间隔不允许 → null → 落 filler
}

/** 分支 4·filler（吼·§15.3④）：detonate armed Puffer > hatch 茧卵 > cocoon-boost larva·按此序取第一个有对象的。 */
function warrenTryFiller(state: GameState, queenId: string): GameState | null {
  if (state.phase.kind !== 'combat') return null;
  const q = state.phase.combat.enemies.find((e) => e.instanceId === queenId && e.hp > 0);
  const ph = q && getEnemyDef(q.defId)?.warrenPheromones;
  if (!ph) return null;
  const live = state.phase.combat.enemies.filter((e) => e.hp > 0);
  // detonate
  if (ph.detonatePuffers) {
    const armed = live.filter((e) => pufferArmed(getEnemyDef(e.defId), e));
    if (armed.length > 0) {
      let s = pushCombatLog(state, { actor: 'enemy', text: ph.roarText });
      for (const p of armed) s = detonateSelfDestruct(s, p.instanceId);
      return s;
    }
  }
  // hatch
  if (ph.forceHatch && live.some((e) => e.metamorphosisStage === 'cocoon')) {
    return warrenForceHatch(state, queenId);
  }
  // cocoon-boost
  if (ph.cocoonBoostChance && ph.cocoonBoostChance > 0) {
    const larvae = live.filter((e) => {
      const d = getEnemyDef(e.defId);
      return !!d?.metamorphosis && (e.metamorphosisStage ?? 'larva') === 'larva';
    });
    if (larvae.length > 0) {
      let s = pushCombatLog(state, { actor: 'enemy', text: ph.roarText });
      for (const l of larvae) {
        if (!rollChance(ph.cocoonBoostChance)) continue;
        const meta = getEnemyDef(l.defId)!.metamorphosis!;
        s = setCombat(s, (c) => ({
          ...c,
          enemies: c.enemies.map((e) =>
            e.instanceId === l.instanceId
              ? { ...e, metamorphosisStage: 'cocoon' as const, cocoonTurnsLeft: meta.cocoonMaxTurns, phaseArmorOverride: meta.cocoonArmor }
              : e,
          ),
        }));
      }
      return s;
    }
  }
  return null;
}

/**
 * maybeWarrenQueenAct（女王身体库存主线 dispatcher·§15.3）：每女王敌方回合起手——先缓慢恢复繁殖储备，再从
 * 六分支优先级树**择一**执行（feed > screen > lay/force-hatch > detonate > hatch > cocoon-boost）。女王仍无攻击表
 * （威胁来自巢·§5）。仅女王（带 warrenFeed/warrenScreen/warrenReinforce/warrenPheromones 任一）进分支；普通战斗逐字节不变。
 * 「一回合一动作」天然保「凿破卵窗」——lay 与 force-hatch 互斥不同回合，新产的卵不会同回合被秒孵（quirk #231/#232 语境不变）。
 */
export function maybeWarrenQueenAct(state: GameState): GameState {
  if (state.phase.kind !== 'combat' || !state.run) return state;
  let s = state;
  const queenIds = (s.phase.kind === 'combat' ? s.phase.combat.enemies : [])
    .filter((e) => {
      const d = getEnemyDef(e.defId);
      return e.hp > 0 && !!(d?.warrenFeed || d?.warrenScreen || d?.warrenReinforce || d?.warrenPheromones);
    })
    .map((e) => e.instanceId);
  for (const qid of queenIds) {
    s = warrenRecoverReserve(s, qid); // 储备恢复先于产卵消耗
    for (const branch of [warrenTryFeed, warrenTryScreen, warrenTryLayOrHatch, warrenTryFiller]) {
      const acted = branch(s, qid);
      if (acted !== null) {
        s = acted;
        break; // 择一：本回合本女王只做一件事
      }
    }
  }
  return s;
}
