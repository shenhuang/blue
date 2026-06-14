// 战斗引擎
// 入口：startCombat（拉起 CombatState）、applyPlayerAction（玩家行动 + 全场敌人响应）
// 战斗系统 SPEC §2–§7

import type {
  GameState,
  RunState,
  CombatState,
  CombatAction,
  CombatLogEntry,
  CombatEncounterDef,
  PlayerStatus,
  EnemyInstance,
  EnemyDef,
  EnemyAttack,
  Stats,
} from '@/types';
import actionData from '@/data/actions.json';
import { ENEMY_FILE_MODULES } from '@/data/enemies/registry.generated';
import { appendLog, addToInventory, removeFromInventory, clampStats } from './state';
import { executeDeath } from './death';
import { getItemDef } from './items';
import { computeModifiers, effectiveStaminaMax } from './modifiers';
import { addInjury, injuryIdForDamageType, applyMedkitHeal } from './injuries';
import { resolveEncounterMember, enemySeenFlag } from './enemyLibrary';

// ——— 数据索引 ———

const ACTIONS: Map<string, CombatAction> = new Map();
for (const a of (actionData as { actions: CombatAction[] }).actions) ACTIONS.set(a.id, a);

// 敌人库 SPEC 支柱三：从生成的注册表（src/data/enemies/registry.generated.ts·目录自动加载）灌入。
// 新增纯数据敌人＝丢一个 JSON + `npm run gen:enemies`，本文件零改动（registry 过期由 regress 门拦）。
const ENEMY_DEFS: Map<string, EnemyDef> = new Map();
const COMBAT_ENCOUNTERS: Map<string, CombatEncounterDef> = new Map();
for (const file of ENEMY_FILE_MODULES) {
  for (const e of (file.enemies as unknown as EnemyDef[]) ?? []) ENEMY_DEFS.set(e.id, e);
  for (const c of (file.combatEncounters as unknown as CombatEncounterDef[]) ?? []) {
    COMBAT_ENCOUNTERS.set(c.id, c);
  }
}

export function getAction(id: string): CombatAction | undefined { return ACTIONS.get(id); }
export function getEnemyDef(id: string): EnemyDef | undefined { return ENEMY_DEFS.get(id); }
export function getEncounter(id: string): CombatEncounterDef | undefined {
  return COMBAT_ENCOUNTERS.get(id);
}
export function listActions(): CombatAction[] { return [...ACTIONS.values()]; }
/** 全部已注册的 EnemyDef（顺序：JSON 文件加载顺序） */
export function listAllEnemyDefs(): EnemyDef[] { return [...ENEMY_DEFS.values()]; }
/** 全部已注册的 CombatEncounterDef（顺序：JSON 文件加载顺序） */
export function listAllEncounters(): CombatEncounterDef[] { return [...COMBAT_ENCOUNTERS.values()]; }

// ——— 战斗发起 ———

export function startCombat(
  state: GameState,
  combatId: string,
  initialPlayerStatuses?: PlayerStatus[],
): GameState {
  const enc = COMBAT_ENCOUNTERS.get(combatId);
  if (!enc || !state.run) return state;

  // scent（负伤 SPEC §6.1）：玩家流血·重时嗅觉系敌种开局就闻到你——unaware 直接 alerted
  // （潜行/突袭红利对它失效·骗局在你身上）。无伤/非嗅觉系 → initialStance 逐字节不变。
  const scentTrail = computeModifiers(state.run).scentTrail;
  const enemies: EnemyInstance[] = enc.party.members.map((m, idx) => {
    // 敌人库 SPEC §4/支柱二：defId 直查 · enemyRef 经 pickEnemy 取一只合适的（route B 加法·非破坏）。
    const def = resolveEncounterMember(m);
    if (!def) throw new Error(`Enemy def not resolved for party member: ${JSON.stringify(m)}`);
    return {
      instanceId: `${combatId}.${idx}`,
      defId: def.id,
      hp: def.hp,
      sanityHp: def.sanityHp,
      stance: scentTrail && def.scent && def.initialStance === 'unaware' ? 'alerted' : def.initialStance,
      aggro: def.threat,
      statuses: [],
    };
  });

  const combat: CombatState = {
    combatId,
    encounterId: enc.id,
    enemies,
    reinforcementPool: enc.reinforcementPool,
    // 迎战先手（猎手 SPEC §5）：standAndFight 传入 ambushing → 你先发制人；缺省 []＝旧调用逐字节不变。
    playerStatuses: initialPlayerStatuses ? [...initialPlayerStatuses] : [],
    turn: 0,
    log: [],
    victoryEventId: enc.victoryEventId,
    resumeNodeId: state.run.currentNodeId,
  };

  // 图鉴发现门（敌人库·只显示已遭遇）：开战即把本场敌人（含 enemyRef 取到的）记入
  // profile.flags 的 enemy_seen:<id>（持久·跨 run）。单一来源——所有真实开战路径（事件
  // triggerCombatId / 猎手伏击）都经 startCombat；事件 scenario 遇 triggerCombatId 即停步、
  // 不进战斗（见 eventScenario）故不污染其 profileFlags 断言。纯加 flag 串·不 bump SAVE_VERSION（#99）。
  let profile = state.profile;
  const seenFlags = new Set(profile.flags);
  let sawNew = false;
  for (const e of enemies) {
    const key = enemySeenFlag(e.defId);
    if (!seenFlags.has(key)) {
      seenFlags.add(key);
      sawNew = true;
    }
  }
  if (sawNew) profile = { ...profile, flags: seenFlags };

  let s: GameState = { ...state, profile, phase: { kind: 'combat', combat } };
  if (enc.introText) {
    s = pushCombatLog(s, { actor: 'system', text: enc.introText });
  }
  return s;
}

// ——— 工具：日志推送 ———

function pushCombatLog(state: GameState, entry: Omit<CombatLogEntry, 'turn'>): GameState {
  if (state.phase.kind !== 'combat') return state;
  const combat = state.phase.combat;
  const newLog: CombatLogEntry[] = [...combat.log, { turn: combat.turn, ...entry }];
  return {
    ...state,
    phase: { ...state.phase, combat: { ...combat, log: newLog } },
  };
}

function setCombat(state: GameState, mutator: (c: CombatState) => CombatState): GameState {
  if (state.phase.kind !== 'combat') return state;
  return { ...state, phase: { ...state.phase, combat: mutator(state.phase.combat) } };
}

// ——— 玩家行动可用性 ———

export interface ActionAvailability {
  available: boolean;
  reason?: string;
}

/**
 * 行动的实际资源消耗（负伤 SPEC §5：costStamina × staminaCostMult、costOxygenTurns × o2CostMult，
 * 向上取整）。无伤时乘数恒 1 → ceil(整数×1) 逐字节不变。availability 与扣费共用本函数＝面板诚实。
 */
function actionCosts(run: RunState, action: CombatAction): { stamina: number; oxygen: number } {
  const mods = computeModifiers(run);
  return {
    stamina: Math.ceil(action.costStamina * mods.staminaCostMult),
    oxygen: Math.ceil(action.costOxygenTurns * mods.o2CostMult),
  };
}

export function checkActionAvailability(state: GameState, action: CombatAction): ActionAvailability {
  const run = state.run;
  if (!run) return { available: false, reason: '无 run state' };

  const costs = actionCosts(run, action);
  if (run.stats.stamina < costs.stamina) {
    return { available: false, reason: `体力不足（需 ${costs.stamina}）` };
  }
  if (run.stats.oxygen < costs.oxygen) {
    return { available: false, reason: `氧气不足（需 ${costs.oxygen} 回合）` };
  }
  if (action.requiresEquipment) {
    if (!run.equipment[action.requiresEquipment]) {
      return { available: false, reason: `需要装备：${action.requiresEquipment}` };
    }
  }
  if (action.requiresItemId) {
    const inv = run.inventory.find((i) => i.itemId === action.requiresItemId);
    if (!inv || inv.qty <= 0) {
      return { available: false, reason: `缺少物品：${action.requiresItemId}` };
    }
  }
  return { available: true };
}

// ——— 一次玩家行动的应用 ———

export interface CombatTurnResult {
  state: GameState;
  outcome: 'continue' | 'victory' | 'flee' | 'defeat' | 'emergency_ascend';
}

export function applyPlayerAction(
  state: GameState,
  actionId: string,
  targetInstanceId?: string,
): CombatTurnResult {
  if (state.phase.kind !== 'combat' || !state.run) {
    return { state, outcome: 'continue' };
  }
  const action = ACTIONS.get(actionId);
  if (!action) return { state, outcome: 'continue' };
  const avail = checkActionAvailability(state, action);
  if (!avail.available) return { state, outcome: 'continue' };

  let s = state;
  // —— 0. 回合开始 tick（负伤 SPEC §5：流血·重等持续身体债·modifiers 单点折算）——
  // 在付行动费前结算；availability 是按 tick 前体力校验的——带着重流血硬挥这一下，
  // 力气可能在半途漏光（死亡螺旋是意图·SPEC §1）。文案 [待过稿]。
  const tick = computeModifiers(state.run).staminaTickPerTurn;
  if (tick !== 0) {
    s = applyStatsDelta(s, { stamina: tick });
    s = pushCombatLog(s, {
      actor: 'system',
      text: `伤口没合上，力气跟着血走（体力 ${tick}）。`,
    });
  }
  // —— 1. 扣资源（负伤修正后的实际消耗·与 availability 同一函数） ——
  const costs = actionCosts(s.run!, action);
  s = applyStatsDelta(s, {
    stamina: -costs.stamina,
    oxygen: -costs.oxygen,
  });

  // —— 1b. 物品消耗统一在此（任何 requiresItemId + consumesItem 的行动·#108）——
  // 此前只有 use_item 在 applyUseItem 里自扣；decoy 是 flee 效果也带道具，消耗就近收口到行动入口，
  // 效果分发各分支不再各管各的（availability 已在上面校验过持有）。
  if (action.consumesItem && action.requiresItemId && s.run) {
    s = {
      ...s,
      run: { ...s.run, inventory: removeFromInventory(s.run.inventory, action.requiresItemId, 1) },
    };
  }

  // —— 2. 应用效果 ——
  s = applyActionEffect(s, action, targetInstanceId);

  // —— 3. 移除一次性玩家状态（ambushing 消耗后清除） ——
  s = setCombat(s, (c) => ({
    ...c,
    playerStatuses: c.playerStatuses
      .map((st) => ({ ...st, remaining: st.remaining - 1 }))
      .filter((st) => st.remaining > 0),
  }));

  // —— 4. 战后判定：是否胜利 ——
  const after = (s.phase.kind === 'combat' ? s.phase.combat : null);
  if (after && allEnemiesDefeated(after)) {
    return finalizeVictory(s);
  }

  // —— 5. 检查脱战 ——
  if (action.effect.kind === 'flee') {
    // applyActionEffect 内部会设置 pendingFleeResult，我们读取
    const c = (s.phase.kind === 'combat') ? s.phase.combat : null;
    if (c?.log[c.log.length - 1]?.text.includes('脱战成功')) {
      return finalizeFlee(s);
    }
  }

  // —— 6. 检查应急上浮 ——
  if (s.phase.kind === 'combat' && s.phase.combat.pendingEmergencyAscent) {
    return { state: { ...s, phase: { kind: 'ascent', targetDepth: 0 } }, outcome: 'emergency_ascend' };
  }

  // —— 7. 敌人回合 ——
  s = runEnemyTurn(s);

  // —— 8. 玩家死亡判定 ——
  if (!s.run) return { state: s, outcome: 'defeat' };
  if (s.run.stats.oxygen <= 0) {
    return { state: executeDeath(s, '战斗中窒息'), outcome: 'defeat' };
  }
  if (s.run.stats.stamina <= 0) {
    return { state: executeDeath(s, '被敌人撕碎'), outcome: 'defeat' };
  }
  if (s.run.stats.sanity <= 0) {
    return { state: executeDeath(s, '理智崩溃，疯狂上浮'), outcome: 'defeat' };
  }

  // —— 9. 回合 +1 ——
  s = setCombat(s, (c) => ({ ...c, turn: c.turn + 1 }));

  return { state: s, outcome: 'continue' };
}

// ——— 行动效果分发 ———

function applyActionEffect(state: GameState, action: CombatAction, targetId?: string): GameState {
  let s = state;
  switch (action.effect.kind) {
    case 'attack':
      return applyAttack(s, action, targetId);
    case 'defend':
      s = setCombat(s, (c) => ({
        ...c,
        playerStatuses: addOrReplace(c.playerStatuses, {
          kind: 'evading',
          remaining: action.effect.kind === 'defend' ? action.effect.turns + 1 : 1, // +1 因为本回合末会 -1
          param: action.effect.kind === 'defend' ? action.effect.damageReduction : 0.5,
        }),
      }));
      s = pushCombatLog(s, { actor: 'player', text: `${action.name}：你下蹲身体，准备闪避下一次冲击。` });
      return s;
    case 'recover':
      return applyRecover(s, action);
    case 'flee':
      return applyFlee(s, action);
    case 'crowd_control':
      return applyCrowdControl(s, action);
    case 'use_item':
      return applyUseItem(s, action);
    case 'ambush':
      s = setCombat(s, (c) => ({
        ...c,
        playerStatuses: addOrReplace(c.playerStatuses, {
          kind: 'ambushing',
          remaining: 2, // 持续到下次攻击
          param: action.effect.kind === 'ambush' ? action.effect.nextAttackMultiplier : 1.5,
        }),
      }));
      s = pushCombatLog(s, { actor: 'player', text: `${action.name}：你压住浮力，等待时机。` });
      return s;
  }
  return s;
}

function addOrReplace(list: PlayerStatus[], st: PlayerStatus): PlayerStatus[] {
  const filtered = list.filter((s) => s.kind !== st.kind);
  return [...filtered, st];
}

function applyAttack(state: GameState, action: CombatAction, targetId?: string): GameState {
  if (state.phase.kind !== 'combat') return state;
  if (action.effect.kind !== 'attack') return state;
  const combat = state.phase.combat;
  const target =
    combat.enemies.find((e) => e.instanceId === targetId && e.hp > 0) ??
    combat.enemies.find((e) => e.hp > 0);
  if (!target) return state;

  const eff = action.effect;
  const def = ENEMY_DEFS.get(target.defId);
  if (!def) return state;

  // 命中判定（基础 85%，减去敌人 evasion）
  const hitChance = Math.max(0.4, 0.95 - def.evasion * 0.04);
  if (Math.random() > hitChance) {
    return pushCombatLog(state, { actor: 'player', text: `${action.name}：${def.name} 闪开了。` });
  }

  // 伤害
  let dmg = randRange(eff.damage);
  // ambush 暴击
  const ambushing = combat.playerStatuses.find((s) => s.kind === 'ambushing');
  if (ambushing) {
    dmg = Math.floor(dmg * (ambushing.param ?? 1));
  }
  // 物理装甲
  if (eff.damageType === 'physical') {
    dmg = Math.max(1, dmg - def.armor);
  }
  // 免疫
  if (def.immunity?.includes(eff.damageType)) {
    return pushCombatLog(state, { actor: 'player', text: `${action.name}：${def.name} 免疫此种伤害。` });
  }

  // 应用
  let s = setCombat(state, (c) => ({
    ...c,
    enemies: c.enemies.map((e) =>
      e.instanceId === target.instanceId
        ? {
            ...e,
            hp: Math.max(0, e.hp - dmg),
            aggro: e.aggro + Math.ceil(dmg / 5),
            stance: e.stance === 'unaware' ? 'alerted' : e.stance === 'alerted' ? 'attacking' : e.stance,
            statuses: eff.applyStatusOnHit
              ? [...e.statuses.filter((st) => st.kind !== eff.applyStatusOnHit!.kind), { kind: eff.applyStatusOnHit.kind, remainingTurns: eff.applyStatusOnHit.turns }]
              : e.statuses,
          }
        : e,
    ),
  }));
  s = pushCombatLog(s, {
    actor: 'player',
    text: `${action.name}：你击中 ${def.name}，造成 ${dmg} 点伤害。${target.hp - dmg <= 0 ? `${def.name} 失去战斗力。` : ''}`,
  });

  // 噪声触发其他敌人警戒
  if ((eff.noise ?? 0) >= 1) {
    s = setCombat(s, (c) => ({
      ...c,
      enemies: c.enemies.map((e) => ({
        ...e,
        stance: e.stance === 'unaware' ? 'alerted' : e.stance,
      })),
    }));
  }
  return s;
}

function applyRecover(state: GameState, action: CombatAction): GameState {
  if (action.effect.kind !== 'recover') return state;
  let s = applyStatsDelta(state, action.effect.deltas);
  s = pushCombatLog(s, { actor: 'player', text: `${action.name}：你稳住呼吸。` });
  // disruptable 标记由敌人回合处理：如果本回合被打中且玩家有 'recovering' 标签则惩罚
  // MVP 简化：不实现 disrupt，让 recover 总是生效
  return s;
}

function applyFlee(state: GameState, action: CombatAction): GameState {
  if (state.phase.kind !== 'combat') return state;
  if (action.effect.kind !== 'flee') return state;
  const combat = state.phase.combat;
  // 必成脱战（猎手 SPEC §4 decoy·北极星「decoy 永远是出路」）：跳过掷骰——烧一枚消耗品＝代价本身。
  // 注意文案必须含「脱战成功」：applyPlayerAction 第 5 步靠这个子串判定脱战（既有机制·勿改丢）。
  if (action.effect.guaranteed) {
    return pushCombatLog(state, {
      actor: 'player',
      text: `${action.name}：假信号在你身后炸开——那东西猛地调头扑过去。你贴着石壁滑出它的世界，脱战成功。`,
    });
  }
  // 成功率 = baseChance + 警戒度低的敌人加成
  const avgStance = combat.enemies.filter((e) => e.hp > 0).reduce(
    (a, e) => a + (e.stance === 'attacking' ? -0.1 : e.stance === 'alerted' ? 0 : 0.2),
    0,
  ) / Math.max(1, combat.enemies.filter((e) => e.hp > 0).length);
  const chance = Math.max(0.2, Math.min(0.95, action.effect.baseChance + avgStance));
  const success = Math.random() < chance;

  if (success) {
    return pushCombatLog(state, { actor: 'player', text: `${action.name}：你溜进礁石阴影，脱战成功。` });
  }
  // 失败：敌人立刻打你 N 次
  let s = pushCombatLog(state, { actor: 'player', text: `${action.name}：你的气泡出卖了你。` });
  for (let i = 0; i < action.effect.failExposure; i++) {
    s = enemyAttackPlayer(s, combat.enemies.find((e) => e.hp > 0)!);
  }
  return s;
}

function applyCrowdControl(state: GameState, action: CombatAction): GameState {
  if (action.effect.kind !== 'crowd_control') return state;
  const eff = action.effect;
  return setCombat(state, (c) => ({
    ...c,
    enemies: c.enemies.map((e) => ({
      ...e,
      aggro: Math.max(0, e.aggro + (eff.threatDelta ?? 0)),
      statuses: eff.applyStatusToAll
        ? [...e.statuses, { kind: eff.applyStatusToAll.kind, remainingTurns: eff.applyStatusToAll.turns }]
        : e.statuses,
    })),
  }));
}

function applyUseItem(state: GameState, action: CombatAction): GameState {
  if (!state.run || !action.requiresItemId) return state;
  const itemDef = getItemDef(action.requiresItemId);
  if (!itemDef?.consumable) return state;

  // 消耗已在 applyPlayerAction 第 1b 步统一扣（#108·任何带道具行动同一处），这里只管效果。
  let s: GameState = state;
  s = applyStatsDelta(s, itemDef.consumable.effectOnUse.deltas ?? {});
  if (itemDef.consumable.effectOnUse.text) {
    s = pushCombatLog(s, { actor: 'player', text: itemDef.consumable.effectOnUse.text });
  }

  // 急救包治伤（负伤 SPEC §8·consumable.medkit 数据旗标·#117）：整包结算住 injuries.ts
  // 唯一写者（applyMedkitHeal·「全部能治的一起处理」），这里只落库 + 推 onHeal 叙事
  // （actor=system 与 onGain/onWorsen 同口径）。止血副效应零接线：scentTrail 住
  // tierEffects，伤一消、下个读点折算自然失效（#116）。
  if (itemDef.consumable.medkit && s.run) {
    const healed = applyMedkitHeal(s.run);
    s = { ...s, run: healed.run };
    for (const text of healed.texts) {
      s = pushCombatLog(s, { actor: 'system', text });
    }
  }
  return s;
}

function applyStatsDelta(state: GameState, deltas: Partial<Record<keyof Stats, number>>): GameState {
  if (!state.run) return state;
  let stats: Stats = { ...state.run.stats };
  for (const [k, v] of Object.entries(deltas) as [keyof Stats, number][]) {
    stats[k] = stats[k] + v;
  }
  // 体力上限走负伤折算（负伤 SPEC §5 体力上限消费点）；无伤＝run.staminaMax 逐字节不变。
  stats = clampStats(stats, { stamina: effectiveStaminaMax(state.run), oxygen: state.run.oxygenMax });
  return { ...state, run: { ...state.run, stats } };
}

function randRange([min, max]: [number, number]): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

// ——— 敌人回合 ———

function runEnemyTurn(state: GameState): GameState {
  if (state.phase.kind !== 'combat' || !state.run) return state;
  let s: GameState = state;
  const combat = state.phase.combat;

  // 按 aggro 降序，每个活着且未眩晕的敌人依次行动
  const order = [...combat.enemies]
    .filter((e) => e.hp > 0 && !e.statuses.some((st) => st.kind === 'stunned'))
    .sort((a, b) => b.aggro - a.aggro);

  for (const e of order) {
    const def = ENEMY_DEFS.get(e.defId);
    if (!def) continue;
    // 逃跑的敌人不打人
    if (e.stance === 'fleeing') {
      s = pushCombatLog(s, { actor: 'enemy', text: `${def.name} 向远处游开。` });
      // 真正离场（HP=0 让结算认为已击退）
      s = setCombat(s, (c) => ({
        ...c,
        enemies: c.enemies.map((x) => (x.instanceId === e.instanceId ? { ...x, hp: 0 } : x)),
      }));
      continue;
    }
    // 低血主动撤退（territorial / passive 类敌人）
    if (
      e.hp <= def.hp * 0.3 &&
      e.stance !== 'enraged' &&
      (def.hostility === 'territorial' || def.hostility === 'passive') &&
      def.victoryConditions.includes('flee') &&
      Math.random() < 0.5
    ) {
      s = pushCombatLog(s, { actor: 'enemy', text: `${def.name} 转身向深处游去。` });
      s = setCombat(s, (c) => ({
        ...c,
        enemies: c.enemies.map((x) => (x.instanceId === e.instanceId ? { ...x, stance: 'fleeing' } : x)),
      }));
      continue;
    }
    // 警戒中：30% 进入攻击
    if (e.stance === 'alerted' && Math.random() < 0.7) {
      s = pushCombatLog(s, { actor: 'enemy', text: `${def.name} 在你周围游动，没有出手。` });
      s = setCombat(s, (c) => ({
        ...c,
        enemies: c.enemies.map((x) => (x.instanceId === e.instanceId ? { ...x, stance: 'attacking' } : x)),
      }));
      continue;
    }
    s = enemyAttackPlayer(s, e);
  }

  // 状态衰减
  s = setCombat(s, (c) => ({
    ...c,
    enemies: c.enemies.map((e) => ({
      ...e,
      statuses: e.statuses
        .map((st) => ({ ...st, remainingTurns: st.remainingTurns - 1 }))
        .filter((st) => st.remainingTurns > 0),
    })),
  }));

  return s;
}

function enemyAttackPlayer(state: GameState, enemy: EnemyInstance): GameState {
  if (state.phase.kind !== 'combat' || !state.run) return state;
  const def = ENEMY_DEFS.get(enemy.defId);
  if (!def) return state;
  // 挑一个攻击
  const attacks = def.attacks;
  const weights = attacks.map((a) => a.weight ?? 1);
  const totalW = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * totalW;
  let chosen: EnemyAttack | undefined;
  for (let i = 0; i < attacks.length; i++) {
    r -= weights[i];
    if (r <= 0) { chosen = attacks[i]; break; }
  }
  chosen ??= attacks[0];

  // 计算伤害
  let dmg = randRange(chosen.damage);
  // 闪避减伤
  const evading = state.phase.combat.playerStatuses.find((s) => s.kind === 'evading');
  if (evading) {
    dmg = Math.ceil(dmg * (1 - (evading.param ?? 0.5)));
  }
  // 潜水服减伤（简化）
  const suit = state.run.equipment.suit;
  if (suit) {
    dmg = Math.max(1, dmg - 1);
  }

  let s = applyStatsDelta(state, { stamina: -dmg });
  s = pushCombatLog(s, {
    actor: 'enemy',
    text: `${chosen.description}（体力 -${dmg}）`,
  });

  // 理智伤害（负伤 SPEC §5 敌攻理智消费点：sd × sanityTakenMult·向上取整；无伤 ×1 逐字节不变）
  if (chosen.sanityDamage) {
    const sd = Math.ceil(randRange(chosen.sanityDamage) * computeModifiers(state.run).sanityTakenMult);
    s = applyStatsDelta(s, { sanity: -sd });
    s = pushCombatLog(s, { actor: 'enemy', text: `你的脑子里像是被人按了一下（理智 -${sd}）。` });
  }

  // 负伤判定（负伤 SPEC §4.1）：**仅带 injuryOnHit 的攻击才掷骰**——不带的攻击零额外 RNG 消耗，
  // 既有 seed 基线不被搅（只有配了数据的敌人的 baseline 需要重抄）。injuryId 缺省 → 按
  // damageType 查 cause 默认派生（physical→流血）；同类升档/上限顶替封死在 addInjury。
  if (chosen.injuryOnHit && s.run && Math.random() < chosen.injuryOnHit.chance) {
    const injuryId = chosen.injuryOnHit.injuryId ?? injuryIdForDamageType(chosen.damageType);
    if (injuryId) {
      const change = addInjury(s.run, injuryId);
      s = { ...s, run: change.run };
      if (change.text) {
        s = pushCombatLog(s, { actor: 'system', text: change.text });
      }
    }
  }
  return s;
}

// ——— 终局 ———

function allEnemiesDefeated(c: CombatState): boolean {
  return c.enemies.every((e) => e.hp <= 0);
}

function finalizeVictory(state: GameState): CombatTurnResult {
  if (state.phase.kind !== 'combat' || !state.run) return { state, outcome: 'victory' };
  const combat = state.phase.combat;

  let s = state;

  // 战利品
  for (const e of combat.enemies) {
    const def = ENEMY_DEFS.get(e.defId);
    if (!def) continue;
    for (const l of def.loot.guaranteed ?? []) {
      const qty = randRange(l.qty);
      if (qty > 0 && s.run) {
        s = { ...s, run: { ...s.run, inventory: addToInventory(s.run.inventory, l.itemId, qty) } };
      }
    }
  }

  s = appendLog(s, { tone: 'realistic', text: `战斗结束。` });

  // 跳转
  if (combat.victoryEventId) {
    s = { ...s, phase: { kind: 'dive', subPhase: { kind: 'event', eventId: combat.victoryEventId } } };
  } else {
    s = { ...s, phase: { kind: 'dive', subPhase: { kind: 'rest' } } };
  }

  return { state: s, outcome: 'victory' };
}

function finalizeFlee(state: GameState): CombatTurnResult {
  if (state.phase.kind !== 'combat') return { state, outcome: 'flee' };
  // 脱战：回到 nodeSelect
  let s = appendLog(state, { tone: 'realistic', text: `你脱离了战斗。` });
  s = { ...s, phase: { kind: 'dive', subPhase: { kind: 'rest' } } };
  return { state: s, outcome: 'flee' };
}

/** 玩家选择应急上浮（战斗中可用） */
export function triggerEmergencyAscent(state: GameState): GameState {
  if (state.phase.kind !== 'combat') return state;
  return setCombat(state, (c) => ({ ...c, pendingEmergencyAscent: true }));
}

/**
 * 暴露给 UI：当前可见的所有 actions。
 * 带道具的行动（use_medkit / use_decoy_*）**没货就不上清单**（而非常驻灰按钮——道具行动会随内容增多，
 * 全部摊开＝每场战斗一排「缺少物品」噪音）；有货但氧/体不足仍列出置灰给理由。applyPlayerAction 仍自校验。
 */
export function listAvailableActions(state: GameState): Array<{ action: CombatAction; availability: ActionAvailability }> {
  return listActions()
    .filter(
      (a: CombatAction) =>
        !a.requiresItemId ||
        (state.run?.inventory.find((i) => i.itemId === a.requiresItemId)?.qty ?? 0) > 0,
    )
    .map((a: CombatAction) => ({ action: a, availability: checkActionAvailability(state, a) }));
}
