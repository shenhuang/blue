// 猩红暴君 / Scarlet Tyrant boss 核心机制（猩红暴君 boss SPEC §2/§3/§4/§5·2026-07-17）——
// 「吃同类夺其优势」的头足猎手一族：弑亲者（scarlet_kinslayer）互吃预演 → 第五波暴君（scarlet_tyrant）
// 破场瞬吃三只、把词条集于一身。自包含钩子，全部由 EnemyDef.scarletFeed 数据字段驱动：不带该字段的
// 普通敌人在每个钩子里都是 no-op（守蜂群 SPEC §9「非对应 def 零成本」约定）⇒ 普通战斗逐字节不变。
//
// 依赖：combat.ts 的共享工具（getEnemyDef/setCombat/pushCombatLog）+ affixes.ts 的词条基元
// （AFFIX_IDS/rollAffixes）。combat.ts ↔ combat-scarlet.ts 互为静态 import，但两边模块顶层互不调用
// （只在运行时进函数体）——ESM 循环加载安全（同 combat-warren.ts / combat-affixes.ts 的约定）。
// affixes.ts 是叶子模块（不反向 import combat*），故从它取 AFFIX_IDS/rollAffixes 不入环。
//
// 范式来源（已核对代码）：
//   - warrenFeed / warrenTryFeed（combat-warren.ts）＝「主动献祭一只活单位回血 + 被吞进 fledInstanceIds 不掉料」形状
//     （回血口径改「回被吃者剩余血」·§2.1 风险①·借形状不借数值）。
//   - maybeWarrenQueenAct（combat-warren.ts）＝敌方回合起手「择一动作」dispatcher 范式（这里 maybeScarletAct 同族）。
//   - buildWarrenArrival（combat-warren.ts）＝遭遇程序化构造（这里 distributeScarletWaveAffixes 波级注入同族）。
//   - isWarrenWallEncounter（warren-hunt.ts）＝按 encounterId 识别专属遭遇的先例（这里 isScarletWave/Finale 同款）。

import type { GameState, EnemyInstance } from '@/types';
import { AFFIX_IDS, rollAffixes } from './affixes';
import { getEnemyDef, setCombat, pushCombatLog } from './combat';

// ——— 命名契约常量（跨 agent 钉死·SPEC §1.1/§4/§5·落点车道 anchor 词根 scarlet_tyrant） ———

/** 暴君 code id（boss·运行时由第五波剧情杀 spawn·非静态 party 成员）。 */
export const SCARLET_TYRANT_DEF_ID = 'enemy.scarlet_tyrant';
/** 弑亲者 code id（杂兵·1→3→4→5 逐波·互吃预演 + 被暴君吞并）。 */
export const SCARLET_KINSLAYER_DEF_ID = 'enemy.scarlet_kinslayer';
/**
 * 波次遭遇 id 前缀（§4）：`combat.scarlet_wave1`..`combat.scarlet_wave5`。distributeScarletWaveAffixes 据此
 * 识别「本场是猩红暴君的一波·该做跨怪无放回词条分发」——绕开 solo baseline（combat.scarlet_kinslayer_solo
 * 用 affixesOverride 钉死 berserk·不匹配本前缀 ⇒ 不被覆盖·baseline 复现不破）。落点车道把这些 id 钉到声呐图节点。
 */
export const SCARLET_WAVE_ENCOUNTER_PREFIX = 'combat.scarlet_wave';
/** 第五波剧情杀遭遇 id（§5·观察回合 + 首攻触发暴君登场）。前缀匹配 ⇒ 也参与波级词条分发（5 只各带 1 个不同词条）。 */
export const SCARLET_FINALE_ENCOUNTER_ID = 'combat.scarlet_wave5';
/** 第五波暴君登场瞬吃的弑亲者数（§5·吃 3 剩 2·占位·defer-number-tuning）。 */
export const SCARLET_FINALE_DEVOUR_COUNT = 3;

export function isScarletWaveEncounter(encounterId: string): boolean {
  return encounterId.startsWith(SCARLET_WAVE_ENCOUNTER_PREFIX);
}
export function isScarletFinaleEncounter(encounterId: string): boolean {
  return encounterId === SCARLET_FINALE_ENCOUNTER_ID;
}

// ——— §3.3 运行时夺词条去重（集合语义硬约束） ———

/**
 * 词条集合语义 merge（§3.3 硬约束·运行时不变量）：把 incoming 并进 existing，**显式去重**——已持有则丢弃。
 * check-boundaries 规则九只管**静态声明**的词条数组不重复；本 boss 的**运行时夺取**（把被吃者词条并进吃食者
 * EnemyInstance.affixes）必须在此镜像同一不变量，否则夺到两个 nimble → 未来若闪避改读计数即 100% 闪避卡死
 * （§3.3·当前效果层是 hasAffix 布尔门·重复不叠加，但集合语义仍是必须守死的运行时不变量·亦保 UI 词条 tag 不重画）。
 * **5 封顶**（§3.4）：AFFIX_IDS.length===5·集合语义 + 去重天然封顶·此处再加一道防御式硬顶。
 */
export function mergeAffixesDedup(
  existing: string[] | undefined,
  incoming: string[] | undefined,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of [...(existing ?? []), ...(incoming ?? [])]) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= AFFIX_IDS.length) break; // 5 封顶
  }
  return out;
}

// ——— §3.2 一波内跨怪无放回词条分发器（遭遇层小机制） ———

/**
 * 波级词条分发（§3.2·startCombat 末调用·非猩红波遭遇零成本早退）：对整波在场的弑亲者调**一次**
 * rollAffixes(AFFIX_IDS, N) 取 N 个**互不相同**的词条、逐一注入每只的 EnemyInstance.affixes——**绕开**
 * def.randomAffixes 的逐怪独立掷（那会跨怪撞词条·两只都抽到狂暴）。因 pool=5 且 N≤5，rollAffixes 天然给
 * 得出 N 个不同 id ⇒ 玩家看得清「每只一个不同优势」，暴君吞并时收进 N 个不同词条（读作「集大成」）。
 * 仅覆盖弑亲者（暴君靠吃·§3.4 不自带词条·且登场时还没上场）。数值/RNG 变动 ⇒ 其 baseline 须 bless:combat。
 */
export function distributeScarletWaveAffixes(state: GameState): GameState {
  if (state.phase.kind !== 'combat') return state;
  const combat = state.phase.combat;
  if (!isScarletWaveEncounter(combat.encounterId)) return state; // 非猩红波 ⇒ 逐字节不变
  const kinIds = combat.enemies
    .filter((e) => e.hp > 0 && e.defId === SCARLET_KINSLAYER_DEF_ID)
    .map((e) => e.instanceId);
  if (kinIds.length === 0) return state;
  const distinct = rollAffixes(AFFIX_IDS, kinIds.length); // 对整波一次·无放回·N 个不同 id
  return setCombat(state, (c) => ({
    ...c,
    enemies: c.enemies.map((e) => {
      const idx = kinIds.indexOf(e.instanceId);
      return idx >= 0 ? { ...e, affixes: [distinct[idx]] } : e; // 每只一个不同词条
    }),
  }));
}

// ——— §2 吃活同伴夺词条（核心新机制·借 warrenFeed 形状） ———

/**
 * 选一只可吞的活同伴（吃食者敌方回合·§2）：从场上活单位里挑 hp/maxhp ≤ 吃食者胃口 thresholdRatio 的一只
 * （弑亲者 0.2 / 暴君 0.5·占位·defer）。**只吃不比自己大的**（victimDef.hp ≤ eaterDef.hp）——守「更大的捕食者
 * 夺走优势」母题的方向（防小弑亲者反吃暴君）。**最濒死优先**（hp/maxhp 比最低·ties → instanceId 字典序）＝
 * 确定性无 RNG（baseline 稳）。无合格对象 ⇒ undefined（吃食者本回合不吃·落常规攻击）。
 */
function pickScarletVictim(
  state: GameState,
  eaterId: string,
  thresholdRatio: number,
): EnemyInstance | undefined {
  if (state.phase.kind !== 'combat') return undefined;
  const enemies = state.phase.combat.enemies;
  const eaterDef = getEnemyDef(enemies.find((e) => e.instanceId === eaterId)?.defId ?? '');
  if (!eaterDef) return undefined;
  const eligible = enemies.filter((e) => {
    if (e.hp <= 0 || e.instanceId === eaterId) return false;
    const d = getEnemyDef(e.defId);
    if (!d) return false;
    if (d.hp > eaterDef.hp) return false; // 不吃比自己大的（母题方向·§0）
    return e.hp <= d.hp * thresholdRatio; // 被吃者 hp/maxhp ≤ 吃食者胃口
  });
  if (eligible.length === 0) return undefined;
  return eligible.slice().sort((a, b) => {
    const ra = a.hp / (getEnemyDef(a.defId)?.hp || 1);
    const rb = b.hp / (getEnemyDef(b.defId)?.hp || 1);
    if (ra !== rb) return ra - rb;
    return a.instanceId < b.instanceId ? -1 : 1;
  })[0];
}

/**
 * 吞一只活同伴（§2·warrenFeed 形状 + 新回血口径）：吃食者**回被吃者剩余血**（封顶自身 def.hp·§2.1 风险①·
 * 非 warrenFeed 的固定量）+ **夺其词条**（mergeAffixesDedup 集合语义去重·§3.3）；被吃者 hp→0 并记入
 * fledInstanceIds（**被吞≠被杀·不给玩家战利品**·#244 同款）。silent=true 时不推 feedText（登场瞬吃 3 用一条
 * 合并叙事代替 3 条·见 triggerScarletTyrantEntrance）。吃食者/被吃者任一不存在或吃食者无 scarletFeed ⇒ no-op。
 */
function scarletDevour(
  state: GameState,
  eaterId: string,
  victimId: string,
  silent = false,
): GameState {
  if (state.phase.kind !== 'combat') return state;
  const enemies = state.phase.combat.enemies;
  const eater = enemies.find((e) => e.instanceId === eaterId && e.hp > 0);
  const victim = enemies.find((e) => e.instanceId === victimId && e.hp > 0);
  const eaterDef = eater && getEnemyDef(eater.defId);
  const sf = eaterDef?.scarletFeed;
  if (!eater || !victim || !sf) return state;
  const heal = sf.healByVictimHp === false
    ? 0
    : Math.max(0, Math.min(eaterDef!.hp, eater.hp + victim.hp) - eater.hp); // 回被吃者剩余血·封顶自身 def.hp
  const stolen = sf.stealAffixes === false
    ? eater.affixes ?? []
    : mergeAffixesDedup(eater.affixes, victim.affixes); // 夺词条·集合语义去重（§3.3）
  let s = state;
  if (!silent) s = pushCombatLog(s, { actor: 'enemy', text: sf.feedText });
  s = setCombat(s, (c) => ({
    ...c,
    enemies: c.enemies.map((e) => {
      if (e.instanceId === victimId) return { ...e, hp: 0 }; // 被吞
      if (e.instanceId === eaterId) return { ...e, hp: e.hp + heal, affixes: stolen };
      return e;
    }),
    fledInstanceIds: [...(c.fledInstanceIds ?? []), victimId], // 不掉料
  }));
  return s;
}

/**
 * maybeScarletAct（吃活同伴夺词条 dispatcher·§2·runEnemyTurn 起手·mirror maybeWarrenQueenAct）：每敌方回合
 * 起手，场上每只带 scarletFeed 的单位（弑亲者 / 暴君）**择一吞食**——挑一只 hp ≤ 自己胃口的活同伴吞下、回其
 * 剩余血、夺其词条。放在 order 捕获**之前**（同 maybeConsumeJuvenile·combat.ts）⇒ 被吞者 hp→0 不进本回合行动
 * 队列（无幽灵行动）。仅带 scarletFeed 的 def 进分支；无该字段的普通战斗逐字节不变（守 #99）。一回合一吞（不占
 * 其常规攻击·吞完仍在 runEnemyTurn 攻击循环里以夺来词条加持出手·§5.1 暴君行为②）。
 */
export function maybeScarletAct(state: GameState): GameState {
  if (state.phase.kind !== 'combat') return state;
  let s = state;
  const eaterIds = state.phase.combat.enemies
    .filter((e) => e.hp > 0 && !!getEnemyDef(e.defId)?.scarletFeed)
    .map((e) => e.instanceId);
  for (const eid of eaterIds) {
    const cur = s.phase.kind === 'combat'
      ? s.phase.combat.enemies.find((x) => x.instanceId === eid && x.hp > 0)
      : undefined;
    const feed = cur && getEnemyDef(cur.defId)?.scarletFeed;
    if (!cur || !feed) continue; // 可能已被同回合先行的同类吞掉
    const victim = pickScarletVictim(s, eid, feed.hpThresholdRatio);
    if (!victim) continue;
    s = scarletDevour(s, eid, victim.instanceId);
  }
  return s;
}

// ——— §5 第五波剧情杀：观察回合 + 首攻触发暴君登场瞬吃 3 ———

/**
 * 暴君登场瞬吃 3 夺 3（§5.3·演出定死）：那一刻暴君**破场而出**——spawn 一只 scarlet_tyrant（无初始词条·§3.4）、
 * 当场吞掉 SCARLET_FINALE_DEVOUR_COUNT 只弑亲者、把它们各自那 1 个（波级分发保证互不相同·§3.2）词条集于一身
 * （去重后＝3 个不同·§3.3），剩暴君 + 2 只。**玩家瞄准的那只优先被吃**（playerTargetId·若是活弑亲者）——刀未落、
 * 猎物已被更大的怪抢吞（§5.4「那一击落空」）。spawn 用 CombatState.spawnSeq 派生唯一 instanceId（同 maybeEnemySplit）。
 * 暴君 def 缺失（注册表未 gen:enemies 重生）⇒ 安全 no-op（不崩·整合阶段 gen:enemies 补齐后即生效）。
 */
export function triggerScarletTyrantEntrance(
  state: GameState,
  playerTargetId?: string,
): GameState {
  if (state.phase.kind !== 'combat') return state;
  const tyrantDef = getEnemyDef(SCARLET_TYRANT_DEF_ID);
  if (!tyrantDef) return state; // 注册表未含暴君 def ⇒ no-op（整合阶段 gen:enemies 补）
  const combat = state.phase.combat;
  const seq = combat.spawnSeq ?? 0;
  const tyrantId = `${combat.combatId}.tyrant.${seq}`;

  // 1) 暴君破场（spawn·无初始词条·§3.4「全靠吃」）
  let s = pushCombatLog(state, {
    actor: 'system',
    text: '水被从更深处挤开——一只远比其余更大的猩红身体撞进场中，一圈腕足已经张开。',
  });
  s = setCombat(s, (c) => ({
    ...c,
    enemies: [
      ...c.enemies,
      {
        instanceId: tyrantId,
        defId: SCARLET_TYRANT_DEF_ID,
        hp: tyrantDef.hp,
        stance: 'attacking' as const,
        aggro: tyrantDef.threat,
        statuses: [],
        affixes: [], // 空·靠吃夺（§3.4）
      },
    ],
    spawnSeq: seq + 1,
  }));

  // 2) 选 3 只弑亲者（玩家瞄准的那只优先·§5.4）
  const livingKin = () =>
    (s.phase.kind === 'combat' ? s.phase.combat.enemies : []).filter(
      (e) => e.hp > 0 && e.defId === SCARLET_KINSLAYER_DEF_ID,
    );
  const pool = livingKin();
  const targetFirst = pool
    .slice()
    .sort((a, b) => {
      const at = a.instanceId === playerTargetId ? 0 : 1;
      const bt = b.instanceId === playerTargetId ? 0 : 1;
      if (at !== bt) return at - bt; // 玩家瞄准的那只排最前
      return a.instanceId < b.instanceId ? -1 : 1; // 其余确定性顺序
    });
  const victims = targetFirst.slice(0, SCARLET_FINALE_DEVOUR_COUNT);

  // 3) 瞬吃 3（silent·用一条合并叙事代替 3 条 feedText）+ 夺 3 词条（去重·§3.3）
  for (const v of victims) s = scarletDevour(s, tyrantId, v.instanceId, true);
  if (victims.length > 0) {
    s = pushCombatLog(s, {
      actor: 'system',
      text: '它连挣扎都没给它们——离它最近的几只同类被腕足卷进口中，身上的斑纹随即层层叠到了它自己身上。',
    });
  }

  // 4) 玩家那一击落空（§5.4）
  s = pushCombatLog(s, {
    actor: 'player',
    text: '你这一击落进原地翻起的血水里——你瞄准的那只，已经被先一步卷走了。',
  });
  return s;
}

/**
 * 第五波首攻拦截（§5.1·combat.ts::applyAttack 起手一行调用）：本场是第五波剧情杀遭遇、且暴君**尚未登场**
 * （场上无 tyrant 实例）时——玩家这次 attack 被拦成暴君登场 phase 脚本（triggerScarletTyrantEntrance），返回
 * 非 null ⇒ applyAttack 直接 return 之、玩家伤害不结算（那一击落空）。暴君登场后（场上有 tyrant）⇒ 返回 null
 * ⇒ 普通攻击照常。**一次性**由「无 tyrant 实例」派生·无需新 CombatState latch 字段。非 finale 遭遇 ⇒ null（逐字节不变）。
 */
export function maybeScarletFinaleInterception(
  state: GameState,
  playerTargetId?: string,
): GameState | null {
  if (state.phase.kind !== 'combat') return null;
  const combat = state.phase.combat;
  if (!isScarletFinaleEncounter(combat.encounterId)) return null;
  if (combat.enemies.some((e) => e.defId === SCARLET_TYRANT_DEF_ID)) return null; // 暴君已登场 → 普通攻击
  return triggerScarletTyrantEntrance(state, playerTargetId);
}
