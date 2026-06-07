// 战斗引擎
// 入口：startCombat（拉起 CombatState）、applyPlayerAction（玩家行动 + 全场敌人响应）
// 战斗系统 SPEC §2–§7

import type {
  GameState,
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
import sharkData from '@/data/enemies/reef_shark.json';
import eelData from '@/data/enemies/blind_eel.json';
import crabData from '@/data/enemies/wreck_spider_crab.json';
import barracudaData from '@/data/enemies/reef_barracuda.json';
import octopusData from '@/data/enemies/cave_octopus.json';
import lanternData from '@/data/enemies/drowned_lantern.json';
import grouperData from '@/data/enemies/reef_grouper.json';
import { appendLog, addToInventory, clampStats } from './state';
import { executeDeath } from './death';
import { getItemDef } from './items';

// ——— 数据索引 ———

const ACTIONS: Map<string, CombatAction> = new Map();
for (const a of (actionData as { actions: CombatAction[] }).actions) ACTIONS.set(a.id, a);

const ENEMY_DEFS: Map<string, EnemyDef> = new Map();
for (const e of sharkData.enemies as unknown as EnemyDef[]) ENEMY_DEFS.set(e.id, e);
for (const e of eelData.enemies as unknown as EnemyDef[]) ENEMY_DEFS.set(e.id, e);
for (const e of crabData.enemies as unknown as EnemyDef[]) ENEMY_DEFS.set(e.id, e);
for (const e of barracudaData.enemies as unknown as EnemyDef[]) ENEMY_DEFS.set(e.id, e);
for (const e of octopusData.enemies as unknown as EnemyDef[]) ENEMY_DEFS.set(e.id, e);
for (const e of lanternData.enemies as unknown as EnemyDef[]) ENEMY_DEFS.set(e.id, e);
for (const e of grouperData.enemies as unknown as EnemyDef[]) ENEMY_DEFS.set(e.id, e);

const COMBAT_ENCOUNTERS: Map<string, CombatEncounterDef> = new Map();
for (const c of (sharkData.combatEncounters as unknown as CombatEncounterDef[]) ?? []) {
  COMBAT_ENCOUNTERS.set(c.id, c);
}
for (const c of (eelData.combatEncounters as unknown as CombatEncounterDef[]) ?? []) {
  COMBAT_ENCOUNTERS.set(c.id, c);
}
for (const c of (crabData.combatEncounters as unknown as CombatEncounterDef[]) ?? []) {
  COMBAT_ENCOUNTERS.set(c.id, c);
}
for (const c of (barracudaData.combatEncounters as unknown as CombatEncounterDef[]) ?? []) {
  COMBAT_ENCOUNTERS.set(c.id, c);
}
for (const c of (octopusData.combatEncounters as unknown as CombatEncounterDef[]) ?? []) {
  COMBAT_ENCOUNTERS.set(c.id, c);
}
for (const c of (lanternData.combatEncounters as unknown as CombatEncounterDef[]) ?? []) {
  COMBAT_ENCOUNTERS.set(c.id, c);
}
for (const c of (grouperData.combatEncounters as unknown as CombatEncounterDef[]) ?? []) {
  COMBAT_ENCOUNTERS.set(c.id, c);
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

  const enemies: EnemyInstance[] = enc.party.members.map((m, idx) => {
    const def = ENEMY_DEFS.get(m.defId);
    if (!def) throw new Error(`Enemy def not found: ${m.defId}`);
    return {
      instanceId: `${combatId}.${idx}`,
      defId: def.id,
      hp: def.hp,
      sanityHp: def.sanityHp,
      stance: def.initialStance,
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

  let s: GameState = { ...state, phase: { kind: 'combat', combat } };
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

export function checkActionAvailability(state: GameState, action: CombatAction): ActionAvailability {
  const run = state.run;
  if (!run) return { available: false, reason: '无 run state' };

  if (run.stats.stamina < action.costStamina) {
    return { available: false, reason: `体力不足（需 ${action.costStamina}）` };
  }
  if (run.stats.oxygen < action.costOxygenTurns) {
    return { available: false, reason: `氧气不足（需 ${action.costOxygenTurns} 回合）` };
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
  // —— 1. 扣资源 ——
  s = applyStatsDelta(s, {
    stamina: -action.costStamina,
    oxygen: -action.costOxygenTurns,
  });

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

  // 消耗
  let inv = state.run.inventory;
  if (action.consumesItem) {
    inv = inv.map((i) => (i.itemId === action.requiresItemId ? { ...i, qty: i.qty - 1 } : i)).filter((i) => i.qty > 0);
  }

  // 效果
  let s: GameState = { ...state, run: { ...state.run, inventory: inv } };
  s = applyStatsDelta(s, itemDef.consumable.effectOnUse.deltas ?? {});
  if (itemDef.consumable.effectOnUse.text) {
    s = pushCombatLog(s, { actor: 'player', text: itemDef.consumable.effectOnUse.text });
  }
  return s;
}

function applyStatsDelta(state: GameState, deltas: Partial<Record<keyof Stats, number>>): GameState {
  if (!state.run) return state;
  let stats: Stats = { ...state.run.stats };
  for (const [k, v] of Object.entries(deltas) as [keyof Stats, number][]) {
    stats[k] = stats[k] + v;
  }
  stats = clampStats(stats, { stamina: state.run.staminaMax, oxygen: state.run.oxygenMax });
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

  // 理智伤害
  if (chosen.sanityDamage) {
    const sd = randRange(chosen.sanityDamage);
    s = applyStatsDelta(s, { sanity: -sd });
    s = pushCombatLog(s, { actor: 'enemy', text: `你的脑子里像是被人按了一下（理智 -${sd}）。` });
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

/** 暴露给 UI：当前可见的所有 actions */
export function listAvailableActions(state: GameState): Array<{ action: CombatAction; availability: ActionAvailability }> {
  return listActions().map((a: CombatAction) => ({ action: a, availability: checkActionAvailability(state, a) }));
}
