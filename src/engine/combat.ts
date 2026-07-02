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
  EnemyStatus,
  EnemyDef,
  EnemyAttack,
  Stats,
  LootTable,
  InventoryItem,
} from '@/types';
import actionData from '@/data/actions.json';
import { ENEMY_FILE_MODULES } from '@/data/enemies/registry.generated';
import { appendLog, addToInventory, enqueuePickup, removeFromInventory, clampStats } from './state';
import {
  getEquipmentStats,
  weaponDamageForSlot,
  weightStaminaMult,
  weightHitMod,
  isOverloaded,
  equipmentUnlocksAction,
  installedModMeta,
} from './equipment';
import { executeDeath } from './death';
import { getItemDef } from './items';
import { computeModifiers, effectiveStaminaMax } from './modifiers';
import { addInjury, injuryIdForDamageType, applyMedkitHeal } from './injuries';
import { resolveEncounterMember, enemySeenFlag } from './enemyLibrary';
import { frontmostLivingSegment, isSegmentReachable, chainSegmentDamageBonus } from './chain-eel';
// 特殊敌人机制钩子（boss 阶段 / 链鳗 enrage / 环境压力 / 分裂 / 食尸 / 补蜂 / 茧化 / 口孵——
// 全部 EnemyDef 数据字段驱动·普通敌人恒 no-op）：见 combat-mechanics.ts。
import {
  maybeBossPhaseShift,
  maybeChainEelEnrage,
  applyEnvironmentalPressure,
  maybeEnemySplit,
  maybeCorpseEat,
  maybeReplenishDrones,
  maybeMetamorphosis,
  maybeCocoonCountdown,
  maybeInterceptJuvenile,
  maybeConsumeJuvenile,
  applyMaternalEnrageIfAlone,
} from './combat-mechanics';

// ——— 数据索引 ———

const ACTIONS: Map<string, CombatAction> = new Map();
for (const a of (actionData as { actions: CombatAction[] }).actions) ACTIONS.set(a.id, a);

// 敌人基础命中率（负重战斗·作者 2026-06-20）：轻档（weightHitMod=0）下 enemyHitChance = 1.0 + hitBonus ≥ 1.0
// ⇒ 必中、且 enemyHitChance≥1 时**不掷骰**（见 enemyAttackPlayer）——与旧「敌攻必中」逐字节一致，既有 combat
// baseline 不动；负重越重双方命中越降（weightHitMod<0 才让命中 <1 触发掷骰），叠加各敌种自己的 hitBonus。
const ENEMY_BASE_HIT = 1.0;

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

/** startCombat 可选项。 */
export interface StartCombatOptions {
  /**
   * 尸衣者专属：开战时为带 skinLoot 的敌人指定当前穿戴的皮囊 id（= 被翻动尸体所属敌种）。
   * 缺省 → 该敌 def.defaultSkin；普通敌人忽略此项（不写 wornSkin·EnemyInstance 形状不变）。
   * 这是未来「拾尸触发」钩子注入「翻的是哪具尸体」的入口（boss 设计蓝图 2026-06-21「尸衣者新定位」）。
   * 注：EnemyPartyMemberDef.wornSkin 优先于此全局值（成员级 > 战斗级 > def.defaultSkin）。
   */
  wornSkin?: string;
  /**
   * 尸衣者占据玩家尸体专属：战斗结束（胜/逃）后路由回此 DeathRecord.id 的 corpse subPhase。
   * 未设 → 普通路由（victoryEventId / rest）。由 dive-move.ts case 'corpse': 注入。
   */
  sourceCorpseId?: string;
}

export function startCombat(
  state: GameState,
  encOrId: string | CombatEncounterDef,
  initialPlayerStatuses?: PlayerStatus[],
  options?: StartCombatOptions,
): GameState {
  const enc = typeof encOrId === 'string' ? COMBAT_ENCOUNTERS.get(encOrId) : encOrId;
  if (!enc || !state.run) return state;
  const combatId = enc.id;

  // scent（负伤 SPEC §6.1）：玩家流血·重时嗅觉系敌种开局就闻到你——unaware 直接 alerted
  // （潜行/突袭红利对它失效·骗局在你身上）。无伤/非嗅觉系 → initialStance 逐字节不变。
  const scentTrail = computeModifiers(state.run).scentTrail;
  const enemies: EnemyInstance[] = enc.party.members.map((m, idx) => {
    // 敌人库 SPEC §4/支柱二：defId 直查 · enemyRef 经 pickEnemy 取一只合适的（route B 加法·非破坏）。
    const def = resolveEncounterMember(m);
    if (!def) throw new Error(`Enemy def not resolved for party member: ${JSON.stringify(m)}`);
    const inst: EnemyInstance = {
      instanceId: `${combatId}.${idx}`,
      defId: def.id,
      hp: def.hp,
      sanityHp: def.sanityHp,
      stance: scentTrail && def.scent && def.initialStance === 'unaware' ? 'alerted' : def.initialStance,
      aggro: def.threat,
      statuses: [],
    };
    // 尸衣者：记录开战时穿戴的皮囊（loot-trigger 的尸体来源·成员级 > 战斗级 > defaultSkin）。
    // 仅对带 skinLoot 的敌人写此字段 ⇒ 普通敌人 EnemyInstance 逐字节不变（守 #99 + 既有 combat baseline）。
    if (def.skinLoot) {
      const worn = m.wornSkin ?? options?.wornSkin ?? def.defaultSkin;
      if (worn !== undefined) inst.wornSkin = worn;
    }
    // 运行时攻击覆盖（尸衣者穿玩家武器时注入·静态 JSON 不设此字段 → 逐字节不变）。
    if (m.attacksOverride) {
      inst.phaseAttacksOverride = m.attacksOverride;
    }
    // 茧化居民：开战时初始化为幼体阶段（仅带 metamorphosis 的敌人写此字段·普通敌人逐字节不变）。
    if (def.metamorphosis) {
      inst.metamorphosisStage = 'larva';
    }
    return inst;
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
    // 尸衣者玩家尸体战斗：胜/逃后路由回 corpse subPhase（未设 → 普通路由不变）。
    ...(options?.sourceCorpseId ? { sourceCorpseId: options.sourceCorpseId } : {}),
    // 链鳗（分节实体）：按序攻击分节链标记（仅显式标 true 的遭遇带·普通 party 不写 ⇒ 逐字节不变）。
    ...(enc.attackInOrder ? { attackInOrder: true as const } : {}),
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

// ——— 工具：日志推送（主流程与 combat-mechanics 钩子共用·故 export） ———

export function pushCombatLog(state: GameState, entry: Omit<CombatLogEntry, 'turn'>): GameState {
  if (state.phase.kind !== 'combat') return state;
  const combat = state.phase.combat;
  const newLog: CombatLogEntry[] = [...combat.log, { turn: combat.turn, ...entry }];
  return {
    ...state,
    phase: { ...state.phase, combat: { ...combat, log: newLog } },
  };
}

export function setCombat(state: GameState, mutator: (c: CombatState) => CombatState): GameState {
  if (state.phase.kind !== 'combat') return state;
  return { ...state, phase: { ...state.phase, combat: mutator(state.phase.combat) } };
}

// ——— 玩家行动可用性 ———

export interface ActionAvailability {
  available: boolean;
  reason?: string;
}

/**
 * 屏息潜逃的「纠缠代价」体力加成（机制·playtest 报告①「对警戒鲨 0 体力直接脱逃·无风险脱战」）：
 * 每个**已警戒 / 进攻**的活敌 +FLEE_STAMINA_PER_ENGAGED 体力——逃离已咬住你的猎手要拼真体力、不再零成本白嫖；
 * unaware 敌不计（偷偷溜走本就便宜·守住 flee「对警戒度低的敌人代价低」轴）。系数占位·defer-number-tuning。
 */
const FLEE_STAMINA_PER_ENGAGED = 3; // 占位·defer-number-tuning（作者最终统一调手感）
function fleeEngagedSurcharge(enemies: readonly EnemyInstance[] | undefined): number {
  if (!enemies) return 0;
  const engaged = enemies.filter((e) => e.hp > 0 && (e.stance === 'alerted' || e.stance === 'attacking')).length;
  return engaged * FLEE_STAMINA_PER_ENGAGED;
}

/**
 * 行动的实际资源消耗（负伤 SPEC §5：costStamina × staminaCostMult、costOxygenTurns × o2CostMult，
 * 向上取整）。无伤时乘数恒 1 → ceil(整数×1) 逐字节不变。availability 与扣费共用本函数＝面板诚实。
 * flee 额外叠加 fleeEngagedSurcharge（仅 effect.kind==='flee' 且传了 enemies 时生效·非 flee/无敌 ⇒ +0 逐字节不变）。
 */
function actionCosts(
  run: RunState,
  action: CombatAction,
  enemies?: readonly EnemyInstance[],
): { stamina: number; oxygen: number } {
  const mods = computeModifiers(run);
  // 负重档位体力倍率（武器系统·作者 2026-06-20）：与负伤 staminaCostMult 相乘。轻档 ×1 ⇒ ceil(整数×1×1) 逐字节不变。
  const wMult = weightStaminaMult(run.equipment);
  // 屏息潜逃纠缠代价（机制·见 fleeEngagedSurcharge）：与基础 costStamina 相加后同过负伤/负重乘子。
  const fleeSurcharge = action.effect.kind === 'flee' ? fleeEngagedSurcharge(enemies) : 0;
  return {
    stamina: Math.ceil((action.costStamina + fleeSurcharge) * mods.staminaCostMult * wMult),
    oxygen: Math.ceil(action.costOxygenTurns * mods.o2CostMult),
  };
}

/**
 * 战斗入口（含 pre_combat 前序叙事门·boss 设计蓝图 2026-06-21）。
 * 遭遇标记 showIntro:true + 有 introText → 先切到 pre_combat 子阶段；玩家确认后 confirmEncounter → startCombat。
 * 猎手伏击等即时 combat 直接调 startCombat，不经此门（不停顿）。
 * EventView 的 startCombat 调用改走这里（case 'startCombat'）。
 */
export function enterCombat(
  state: GameState,
  encOrId: string | CombatEncounterDef,
  initialPlayerStatuses?: PlayerStatus[],
  options?: StartCombatOptions,
): GameState {
  const enc = typeof encOrId === 'string' ? COMBAT_ENCOUNTERS.get(encOrId) : encOrId;
  if (!enc || !state.run) return state;
  if (enc.showIntro && enc.introText) {
    return {
      ...state,
      phase: {
        kind: 'dive',
        subPhase: { kind: 'pre_combat', encounterId: enc.id, introText: enc.introText },
      },
    };
  }
  return startCombat(state, enc, initialPlayerStatuses, options);
}

/**
 * 玩家在 PreCombatView 确认「进入战斗」（pre_combat → combat）。
 * 读取 subPhase.encounterId 直接调 startCombat；状态不符则原样返回。
 */
export function confirmEncounter(state: GameState): GameState {
  if (state.phase.kind !== 'dive' || state.phase.subPhase.kind !== 'pre_combat') return state;
  const { encounterId } = state.phase.subPhase;
  return startCombat(state, encounterId);
}

export function checkActionAvailability(
  state: GameState,
  action: CombatAction,
  targetInstanceId?: string,
): ActionAvailability {
  const run = state.run;
  if (!run) return { available: false, reason: '无 run state' };

  // 负重过载（武器系统·作者 2026-06-20）：过载档全行动封锁（「负重过载，无法行动」）。出发门已拦过载下潜，
  // 故实战几乎触不到（run.equipment 一潜固定）；此为防御性双保险。轻档不触发。
  if (isOverloaded(run.equipment)) {
    return { available: false, reason: '负重过载，无法行动' };
  }

  const costs = actionCosts(run, action, state.phase.kind === 'combat' ? state.phase.combat.enemies : undefined);
  if (run.stats.stamina < costs.stamina) {
    return { available: false, reason: `体力不足（需 ${costs.stamina}）` };
  }
  if (run.stats.oxygen < costs.oxygen) {
    return { available: false, reason: `氧气不足（需 ${costs.oxygen} 回合）` };
  }
  if (action.requiresEquipment) {
    const slot = action.requiresEquipment;
    if (!run.equipment[slot]) {
      return { available: false, reason: `需要装备：${slot}` };
    }
    // 武器解锁行动门（严格·作者 2026-06-20）：该槽的件必须解锁本行动——持刀只出刀法、持斧只出斧法、
    // 持枪只出对应射击、盾不解锁任何攻击。起手刀解锁 knife_slash ⇒ 既有战斗逐字节不变。
    if (!equipmentUnlocksAction(run.equipment, slot, action.id)) {
      return { available: false, reason: '当前武器不支持此动作' };
    }
  }
  if (action.requiresItemId) {
    const inv = run.inventory.find((i) => i.itemId === action.requiresItemId);
    if (!inv || inv.qty <= 0) {
      return { available: false, reason: `缺少物品：${action.requiresItemId}` };
    }
  }

  // —— 链鳗（分节实体）按序门（面板诚实）——
  // 仅 attackInOrder 遭遇 + 攻击行动 + 指定了具体目标时校验：玩家攻击只允许命中**最前存活节**，
  // 指向更后的节（含未解锁的头节）→ 不可用并给 reason（applyPlayerAction 据此把该击当作无操作=「被拒」）。
  // 缺省（无目标=自动打最前节）/ 非攻击行动 / 非按序遭遇 → 跳过 ⇒ 既有无序 party 与所有非攻击行动逐字节不变。
  if (
    targetInstanceId !== undefined &&
    action.effect.kind === 'attack' &&
    state.phase.kind === 'combat' &&
    state.phase.combat.attackInOrder &&
    !isSegmentReachable(state.phase.combat.enemies, targetInstanceId)
  ) {
    return { available: false, reason: '够不到——它身前还有节段挡着，先清掉最前面的。' };
  }

  // —— 菌群鱼（shieldedBy）目标门——
  // 被工蜂护卫的女王：场上还有护卫存活时，任何攻击行动均无法指向女王。
  // 仅 attackInOrder 以外的普通遭遇走这条检查；attackInOrder 遭遇已有 isSegmentReachable 覆盖。
  if (
    targetInstanceId !== undefined &&
    action.effect.kind === 'attack' &&
    state.phase.kind === 'combat' &&
    !state.phase.combat.attackInOrder
  ) {
    const tgt = state.phase.combat.enemies.find((e) => e.instanceId === targetInstanceId && e.hp > 0);
    if (tgt) {
      const tgtDef = ENEMY_DEFS.get(tgt.defId);
      if (tgtDef?.shieldedBy?.length) {
        const shielded = state.phase.combat.enemies.some(
          (e) => e.hp > 0 && e.instanceId !== targetInstanceId && tgtDef.shieldedBy!.includes(e.defId),
        );
        if (shielded) {
          return { available: false, reason: '工蜂还在——女王躲在蜂群之后，先清光工蜂再出手。' };
        }
      }
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
  // —— 前置全灭结算：DoT / 敌人自灭可在敌人回合末清场，胜负按既有时序留到下个行动点判（见 runEnemyTurn
  // DoT 注释）——这里把判定提到行动最前：场上已无活敌就直接收战，玩家不再对空场出招（付资源 / 掷 flee
  // 骰都不该发生；也堵死 applyFlee 失败分支找不到活敌的崩溃窗）。有活敌时零影响（既有 baseline 不变）。
  if (allEnemiesDefeated(state.phase.combat)) {
    return finalizeVictory(state);
  }
  const action = ACTIONS.get(actionId);
  if (!action) return { state, outcome: 'continue' };
  // 链鳗按序门：把目标透传给可用性检查——指向非最前存活节的攻击 = 不可用 → 本击当无操作（被拒）。
  const avail = checkActionAvailability(state, action, targetInstanceId);
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
  // —— 0b. boss 战场压力 tick（boss 存活即施加·叠加基础 tick·每回合触发一次）——
  s = applyEnvironmentalPressure(s);
  // —— 0c. 茧化居民变态发育检查（氧气阈值触发·仅带 metamorphosis 的敌人进分支·其余逐字节不变）——
  s = maybeMetamorphosis(s);
  // —— 0d. 裂球分裂检查（回合开头·在玩家行动造伤之前检查·这样本回合的伤害不会逆向抑制「之前 N 回合」的分裂门）——
  // 仅带 splitBehavior 的敌人进分支；普通敌人逐字节不变。
  s = maybeEnemySplit(s);
  // —— 1. 扣资源（负伤修正后的实际消耗·与 availability 同一函数） ——
  const costs = actionCosts(s.run!, action, s.phase.kind === 'combat' ? s.phase.combat.enemies : undefined);
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

  // —— 2b. 链鳗（分节实体）头节 enrage：本次行动若杀掉最后一节体节，头节成为最前存活节 → 立即 enrage，
  // 其 enraged 攻击表当回合即生效（紧接的敌人回合用上）。maybeChainEelEnrage 内首行守 attackInOrder ⇒
  // 非链鳗遭遇逐字节不变（不触 maybeBossPhaseShift 的 HP 路径）。
  s = maybeChainEelEnrage(s);

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

  // —— 5. 检查脱战（applyFlee 成功时写 pendingFleeSuccess·与第 6 步 pendingEmergencyAscent 同款 typed flag）——
  if (s.phase.kind === 'combat' && s.phase.combat.pendingFleeSuccess) {
    return finalizeFlee(s);
  }

  // —— 6. 检查应急上浮 ——
  if (s.phase.kind === 'combat' && s.phase.combat.pendingEmergencyAscent) {
    return { state: { ...s, phase: { kind: 'ascent', targetDepth: 0, duress: true } }, outcome: 'emergency_ascend' };
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
  // 链鳗（分节实体）按序：攻击锁定**最前存活节**（防御纵深——可用性门已拒非法目标·此处保证即便被绕过
  // 也绝不伤到后节）。非按序遭遇 → 既有解析（指定目标活则打它·否则首个活敌）逐字节不变。
  const target = combat.attackInOrder
    ? frontmostLivingSegment(combat.enemies)
    : (combat.enemies.find((e) => e.instanceId === targetId && e.hp > 0) ??
       combat.enemies.find((e) => e.hp > 0));
  if (!target) return state;

  const eff = action.effect;
  const def = ENEMY_DEFS.get(target.defId);
  if (!def) return state;

  // 命中判定（基础 85%，减去敌人 evasion；负重档位 weightHitMod 调·武器系统 2026-06-20·轻档 +0 ⇒ 逐字节不变）
  const hitChance = Math.max(0.4, 0.95 - def.evasion * 0.04) + (state.run ? weightHitMod(state.run.equipment) : 0);
  if (Math.random() > hitChance) {
    return pushCombatLog(state, { actor: 'player', text: `${action.name}：${def.name} 闪开了。` });
  }

  // 伤害（含武器件伤害加成·按 action.requiresEquipment 槽读·避免跨武器串伤·C 2026-06-20）
  const weaponSlot = action.requiresEquipment;
  const weaponBonus = weaponSlot && state.run ? weaponDamageForSlot(state.run.equipment, weaponSlot) : 0;
  let dmg = randRange(eff.damage) + weaponBonus;
  // 武器改装组件（武器系统·作者 2026-06-20）：仅装了 mod 的武器才进分支 ⇒ 无 mod 战斗零额外 RNG（既有 baseline 不变）。
  const modMeta = weaponSlot && state.run ? installedModMeta(state.run.equipment, weaponSlot) : undefined;
  let powerSpent = 0;
  if (modMeta?.effect === 'shock' && state.run) {
    // 放电芯：电量够 + 命中触发（chance≥1 不掷骰）→ 该击附加 bonusDamage、扣电（电量不足＝不触发·无副作用）。
    const cost = modMeta.powerCost ?? 0;
    if (state.run.power >= cost && rollChance(modMeta.chance)) {
      dmg += modMeta.bonusDamage ?? 0;
      powerSpent = cost;
    }
  }
  // ambush 暴击
  const ambushing = combat.playerStatuses.find((s) => s.kind === 'ambushing');
  if (ambushing) {
    dmg = Math.floor(dmg * (ambushing.param ?? 1));
  }
  // 口孵深鱼截击（maternalBehavior·interceptChance）：命中护巢仔时母鱼有概率截下这一击。
  // interceptChance≥1 时 rollChance 不消耗 RNG ⇒ 零额外 RNG 成本·既有 baseline 逐字节不变（守 #99）。
  // 在装甲计算**之前**截住 pre-armor rawDmg，母鱼用自己的 armorWhileProtected 减伤（非双重减伤）。
  {
    const intercepted = maybeInterceptJuvenile(state, target, dmg, eff.damageType, action.name);
    if (intercepted !== null) return intercepted;
  }
  // 物理装甲（茧化居民：茧化期用 phaseArmorOverride 替代 def.armor·其余时段与普通敌人一致）
  if (eff.damageType === 'physical') {
    const effectiveArmor = target.phaseArmorOverride ?? def.armor;
    dmg = Math.max(1, dmg - effectiveArmor);
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
            // 裂球：累计本周期内玩家造成的伤害（maybeEnemySplit 读取·仅带 splitBehavior 的敌人才写）
            ...(ENEMY_DEFS.get(e.defId)?.splitBehavior
              ? { splitDamageAccum: (e.splitDamageAccum ?? 0) + dmg }
              : {}),
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
  // boss 阶段检查（HP 因玩家攻击下降·每次命中后触发）
  s = maybeBossPhaseShift(s, target.instanceId);
  // 清道夫（corpseEating）：玩家攻击致死 → 触发尸食钩子
  s = maybeCorpseEat(s, target.instanceId);
  // 口孵深鱼护巢仔全灭检查（玩家攻击致死护巢仔时·幂等·护巢仔未全灭 = no-op）
  s = applyMaternalEnrageIfAlone(s);

  // 放电芯扣电（命中触发后结算·run.power 单点扣·非 Stats clamp 范畴）。
  if (powerSpent > 0 && s.run) {
    s = { ...s, run: { ...s.run, power: Math.max(0, s.run.power - powerSpent) } };
  }

  // 毒囊 / 倒刺套件（武器系统·作者 2026-06-20）：命中且触发 → 给**该目标**挂 DoT 敌人状态
  // （中毒 poisoned / 撕裂 bleeding·每回合 dmgPerTurn·敌人回合末结算·见 runEnemyTurn）。注意：敌人的
  // 中毒/撕裂走 EnemyStatus DoT，与玩家专属的负伤系统（injuries.ts·check-boundaries 规则四守的那套）无关。仅装了 mod 才进此分支。
  if (modMeta && (modMeta.effect === 'poison' || modMeta.effect === 'barb') && rollChance(modMeta.chance)) {
    const kind: EnemyStatus['kind'] = modMeta.effect === 'poison' ? 'poisoned' : 'bleeding';
    const dpt = modMeta.dmgPerTurn ?? 0;
    const turns = modMeta.turns ?? 1;
    s = setCombat(s, (c) => ({
      ...c,
      enemies: c.enemies.map((e) =>
        e.instanceId === target.instanceId && e.hp > 0
          ? { ...e, statuses: [...e.statuses.filter((st) => st.kind !== kind), { kind, remainingTurns: turns, dmgPerTurn: dpt }] }
          : e,
      ),
    }));
    s = pushCombatLog(s, {
      actor: 'system',
      text: modMeta.effect === 'poison' ? `毒液渗进伤口——${def.name} 开始溃烂。` : `倒刺撕开一道长口子——${def.name} 血流不止。`,
    });
  }

  // 噪声触发其他敌人警戒（静音套：近战不触发 signature 上升＝该击噪声归零·武器系统 2026-06-20）
  const silent = modMeta?.effect === 'silent';
  if (!silent && (eff.noise ?? 0) >= 1) {
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
  if (action.effect.guaranteed) {
    const s = setCombat(state, (c) => ({ ...c, pendingFleeSuccess: true }));
    return pushCombatLog(s, {
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
    const s = setCombat(state, (c) => ({ ...c, pendingFleeSuccess: true }));
    return pushCombatLog(s, { actor: 'player', text: `${action.name}：你溜进礁石阴影，脱战成功。` });
  }
  // 失败：敌人立刻打你 N 次（防御纵深：无活敌就不出手——全灭窗已由 applyPlayerAction 前置结算堵住）
  let s = pushCombatLog(state, { actor: 'player', text: `${action.name}：你的气泡出卖了你。` });
  for (let i = 0; i < action.effect.failExposure; i++) {
    const attacker = (s.phase.kind === 'combat' ? s.phase.combat.enemies : []).find((e) => e.hp > 0);
    if (!attacker) break;
    s = enemyAttackPlayer(s, attacker);
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

export function applyStatsDelta(state: GameState, deltas: Partial<Record<keyof Stats, number>>): GameState {
  if (!state.run) return state;
  let stats: Stats = { ...state.run.stats };
  for (const [k, v] of Object.entries(deltas) as [keyof Stats, number][]) {
    stats[k] = stats[k] + v;
  }
  // 体力上限走负伤折算（负伤 SPEC §5 体力上限消费点）；无伤＝run.staminaMax 逐字节不变。
  stats = clampStats(stats, { stamina: effectiveStaminaMax(state.run), oxygen: state.run.oxygenMax });
  return { ...state, run: { ...state.run, stats } };
}

export function randRange([min, max]: [number, number]): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

/**
 * 概率触发（武器改装组件用）：chance 缺省 / ≥1 ⇒ 必触发且**不掷骰**（零 RNG 消耗·守既有 baseline）；
 * <1 才 Math.random() 掷一次。仅在装了 mod 的攻击里调用 ⇒ 无 mod 战斗零额外 RNG。
 */
export function rollChance(chance?: number): boolean {
  if (chance === undefined || chance >= 1) return true;
  return Math.random() < chance;
}

// ——— 敌人回合 ———

function runEnemyTurn(state: GameState): GameState {
  if (state.phase.kind !== 'combat' || !state.run) return state;
  let s: GameState = state;

  // 菌群鱼（droneReplenish）：女王行动前补充工蜂（仅带 droneReplenish 的敌人进分支）。
  s = maybeReplenishDrones(s);
  // 口孵深鱼（maternalBehavior）：母鱼回合开头检查 HP < 50%——有存活护巢仔时消耗一只回血。
  // 在 order 捕获**之前**执行：被消耗的护巢仔 HP→0 后不会出现在行动队列里（无幽灵行动）。
  s = maybeConsumeJuvenile(s);

  // 按 aggro 降序，每个活着且未眩晕的敌人依次行动
  const order = [...(s.phase.kind === 'combat' ? s.phase.combat.enemies : [])]
    .filter((e) => e.hp > 0 && !e.statuses.some((st) => st.kind === 'stunned'))
    .sort((a, b) => b.aggro - a.aggro);

  for (const e of order) {
    // 实时检查：order 快照后由前置钩子（maybeConsumeJuvenile 等）降至 0 的敌人跳过
    {
      const live = s.phase.kind === 'combat'
        ? s.phase.combat.enemies.find((x) => x.instanceId === e.instanceId)
        : null;
      if (!live || live.hp <= 0) continue;
    }
    const def = ENEMY_DEFS.get(e.defId);
    if (!def) continue;
    // 茧化居民幼体（metamorphosisStage='larva'）：passive，不发起攻击——直接跳过。
    if (def.metamorphosis && e.metamorphosisStage === 'larva') {
      s = pushCombatLog(s, { actor: 'enemy', text: `${def.name} 停在原地，像一颗等待爆发的蛋。` });
      continue;
    }
    // 茧化居民茧（metamorphosisStage='cocoon'）：同样 passive，不出手。
    if (def.metamorphosis && e.metamorphosisStage === 'cocoon') continue;
    // 逃跑的敌人不打人
    if (e.stance === 'fleeing') {
      s = pushCombatLog(s, { actor: 'enemy', text: `${def.name} 向远处游开。` });
      // 真正离场（HP=0 让结算认为已击退）；记入 fledInstanceIds——它没被打死，
      // finalizeVictory 不给它的战利品（#244「逃跑/吓退不给材料」）。
      s = setCombat(s, (c) => ({
        ...c,
        enemies: c.enemies.map((x) => (x.instanceId === e.instanceId ? { ...x, hp: 0 } : x)),
        fledInstanceIds: [...(c.fledInstanceIds ?? []), e.instanceId],
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

  // 持续伤害（DoT·撕裂/中毒·武器改装 2026-06-20）：敌人回合末按各状态 dmgPerTurn 掉血（先于衰减）。
  // 仅 dmgPerTurn>0 的状态生效 ⇒ 既有 bleeding 标记（缺省 0）逐字节不变。DoT 致死＝hp→0，胜负在下个
  // 玩家行动结算点判定（与「最后一只逃跑 hp=0」同口径·不在敌人回合内提前 finalize·守既有时序）。
  {
    const cur = s.phase.kind === 'combat' ? s.phase.combat.enemies : [];
    for (const e of cur) {
      if (e.hp <= 0) continue;
      const dot = e.statuses.reduce((a, st) => a + (st.dmgPerTurn ?? 0), 0);
      if (dot <= 0) continue;
      const dname = ENEMY_DEFS.get(e.defId)?.name ?? '它';
      s = setCombat(s, (c) => ({
        ...c,
        enemies: c.enemies.map((x) => (x.instanceId === e.instanceId ? { ...x, hp: Math.max(0, x.hp - dot) } : x)),
      }));
      s = pushCombatLog(s, { actor: 'system', text: `${dname} 因持续伤势失去 ${dot} 点生命。` });
      // boss 阶段检查（HP 因 DoT 下降）
      s = maybeBossPhaseShift(s, e.instanceId);
      // 清道夫（corpseEating）：DoT 致死同样触发尸食钩子
      s = maybeCorpseEat(s, e.instanceId);
      // 口孵深鱼护巢仔全灭检查（DoT 致死护巢仔时·幂等）
      s = applyMaternalEnrageIfAlone(s);
    }
  }

  // 链鳗（分节实体）头节 enrage：DoT 可能杀掉最后一节体节 → 头节成为最前存活节（守 attackInOrder·非链鳗逐字节不变）。
  s = maybeChainEelEnrage(s);

  // 茧化居民茧化倒计时：每轮结束后递减（归零时下一个 maybeMetamorphosis 触发羽化成体）。
  s = maybeCocoonCountdown(s);

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
  // 挑一个攻击（优先读阶段覆盖攻击表·BossPhase.attacksOverride·无覆盖则 def.attacks；
  // 清道夫吸收的攻击追加到攻击池末尾·absorbedAttacks 仅清道夫写入·普通敌人零影响）
  const baseAttacks = enemy.phaseAttacksOverride ?? def.attacks;
  const attacks = enemy.absorbedAttacks?.length
    ? [...baseAttacks, ...enemy.absorbedAttacks]
    : baseAttacks;
  const weights = attacks.map((a) => a.weight ?? 1);
  const totalW = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * totalW;
  let chosen: EnemyAttack | undefined;
  for (let i = 0; i < attacks.length; i++) {
    r -= weights[i];
    if (r <= 0) { chosen = attacks[i]; break; }
  }
  chosen ??= attacks[0];

  // 敌人命中判定（负重战斗·武器系统 2026-06-20）：ENEMY_BASE_HIT(1.0) + 该敌 hitBonus + 负重 weightHitMod。
  // ≥1.0 ⇒ 必中且**不掷骰**（轻档 weightHitMod=0 + hitBonus≥0 ⇒ 既有敌攻逐字节不变·守 seeded baseline）；
  // <1.0 才掷一次骰，失手＝0 伤、不触发负伤（守「仅命中才结算」）。hitBonus 让暗伏/突袭型在你笨重时仍咬得准。
  const enemyHit = ENEMY_BASE_HIT + (def.hitBonus ?? 0) + weightHitMod(state.run.equipment);
  if (enemyHit < 1 && Math.random() >= enemyHit) {
    return pushCombatLog(state, { actor: 'enemy', text: `${def.name} 的${chosen.name}落空了。` });
  }

  // 计算伤害
  let dmg = randRange(chosen.damage);
  // 链鳗（分节实体）威胁派生（boss 设计蓝图「越杀越短越快越危险」）：按序遭遇里存活节越少 → 余节攻击越凶。
  // chainSegmentDamageBonus 是纯整数算术·无 RNG ⇒ 仅 attackInOrder 遭遇进此分支 ⇒ 无序 party 的 RNG 流逐字节不变。
  if (state.phase.combat.attackInOrder) {
    const seg = state.phase.combat.enemies;
    dmg += chainSegmentDamageBonus(seg.filter((e) => e.hp > 0).length, seg.length);
  }
  // 闪避减伤
  const evading = state.phase.combat.playerStatuses.find((s) => s.kind === 'evading');
  if (evading) {
    dmg = Math.ceil(dmg * (1 - (evading.param ?? 0.5)));
  }
  // 潜水服减伤：读穿戴件 physicalArmor 累计（A·2026-06-20·替旧 if(suit)-1·改读数值·防双计 quirk #142）
  const armor = getEquipmentStats(state.run.equipment).physicalArmor;
  if (armor > 0) {
    dmg = Math.max(1, dmg - armor);
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

/**
 * effectiveLoot：尸衣者 loot 变体解析（纯函数·无副作用·可单测）。
 * 穿着某皮囊（instance.wornSkin 命中 def.skinLoot）→ 返回该皮囊的 LootTable（**替换** def.loot·非叠加）；
 * 否则（普通敌人无 skinLoot / 无 wornSkin / 皮囊不在表内）→ 返回 def.loot 原对象（同一引用）。
 * ⇒ 普通敌人恒返回 def.loot ⇒ finalizeVictory 普通路径的 randRange 调用次数与结果逐字节不变
 * （守「不改 finalizeVictory 普通敌人路径」·boss 路径只读 loot 不受影响）。
 */
export function effectiveLoot(def: EnemyDef, instance: EnemyInstance): LootTable {
  const worn = instance.wornSkin;
  if (worn && def.skinLoot && def.skinLoot[worn]) return def.skinLoot[worn];
  return def.loot;
}

function finalizeVictory(state: GameState): CombatTurnResult {
  if (state.phase.kind !== 'combat' || !state.run) return { state, outcome: 'victory' };
  const combat = state.phase.combat;

  let s = state;

  // 战利品（尸衣者按 wornSkin 替换 loot·普通敌人 effectiveLoot 恒回 def.loot ⇒ 逐字节不变）
  const looted: InventoryItem[] = []; // 本次战斗所有掉落·收齐后批量一格弹「获得物品」（enqueuePickup·见 state.ts）
  const fled = new Set(combat.fledInstanceIds ?? []);
  for (const e of combat.enemies) {
    // #244 裁决「逃跑/吓退不给材料」：自行离场的敌人（runEnemyTurn fleeing 分支）不算击杀、不掉料
    // （数据侧 victoryModifier flee/scare=0 的机制化落点）；转身逃跑时被砍死（hp 因攻击归零）仍照常掉。
    if (fled.has(e.instanceId)) continue;
    const def = ENEMY_DEFS.get(e.defId);
    if (!def) continue;
    const loot = effectiveLoot(def, e);
    for (const l of loot.guaranteed ?? []) {
      const qty = randRange(l.qty);
      if (qty > 0 && s.run) {
        s = { ...s, run: { ...s.run, inventory: addToInventory(s.run.inventory, l.itemId, qty) } };
        looted.push({ itemId: l.itemId, qty });
      }
    }
  }
  s = enqueuePickup(s, looted, '战利品');

  s = appendLog(s, { tone: 'realistic', text: `战斗结束。` });

  // 跳转：尸衣者玩家尸体战斗 → 回 corpse subPhase 让玩家仍可打捞；普通战斗 → 旧路由。
  if (combat.sourceCorpseId) {
    s = { ...s, phase: { kind: 'dive', subPhase: { kind: 'corpse', deathRecordId: combat.sourceCorpseId } } };
  } else if (combat.victoryEventId) {
    s = { ...s, phase: { kind: 'dive', subPhase: { kind: 'event', eventId: combat.victoryEventId } } };
  } else {
    s = { ...s, phase: { kind: 'dive', subPhase: { kind: 'rest' } } };
  }

  return { state: s, outcome: 'victory' };
}

function finalizeFlee(state: GameState): CombatTurnResult {
  if (state.phase.kind !== 'combat') return { state, outcome: 'flee' };
  const sourceCorpseId = state.phase.combat.sourceCorpseId;
  let s = appendLog(state, { tone: 'realistic', text: `你脱离了战斗。` });
  // 尸衣者玩家尸体战斗：脱战后仍可回 corpse subPhase 打捞；普通脱战 → rest。
  if (sourceCorpseId) {
    s = { ...s, phase: { kind: 'dive', subPhase: { kind: 'corpse', deathRecordId: sourceCorpseId } } };
  } else {
    s = { ...s, phase: { kind: 'dive', subPhase: { kind: 'rest' } } };
  }
  return { state: s, outcome: 'flee' };
}

/** 玩家选择应急上浮（战斗中可用） */
export function triggerEmergencyAscent(state: GameState): GameState {
  if (state.phase.kind !== 'combat') return state;
  return setCombat(state, (c) => ({ ...c, pendingEmergencyAscent: true }));
}

/**
 * 是否「手里有能用的武器攻击」——存在任一**非兜底**攻击行动，其装备解锁门 + 弹药持有门都过。
 * 只看**持有**（装备解锁 / 弹药在背包）·**不看**体/氧 affordability：体力不够 ≠ 没武器（该去调息/闪避
 * 回体力，而非露出赤手）。fallbackOnly 行动（拳脚扭打）上清单门控的单一判据。纯函数·零 RNG。
 */
function hasUsableWeaponAttack(state: GameState): boolean {
  const run = state.run;
  if (!run) return false;
  return listActions().some((a) => {
    if (a.effect.kind !== 'attack' || a.fallbackOnly) return false;
    if (a.requiresEquipment && !equipmentUnlocksAction(run.equipment, a.requiresEquipment, a.id)) return false;
    if (a.requiresItemId && (run.inventory.find((i) => i.itemId === a.requiresItemId)?.qty ?? 0) <= 0) return false;
    return true;
  });
}

/**
 * 暴露给 UI：当前可见的所有 actions。
 * 带道具的行动（use_medkit / use_decoy_*）**没货就不上清单**（而非常驻灰按钮——道具行动会随内容增多，
 * 全部摊开＝每场战斗一排「缺少物品」噪音）；有货但氧/体不足仍列出置灰给理由。applyPlayerAction 仍自校验。
 * **fallbackOnly 行动（拳脚扭打）**：仅在 hasUsableWeaponAttack=false（无解锁武器 + 无弹药）时上清单——
 * 有武器时它被严格压制成死按钮，故隐藏（option 1·2026-06-27）。注意此门只动**可见菜单**：
 * checkActionAvailability / applyPlayerAction 不读它，故 scenario 直接 invoke fist 仍照常生效（baseline 不受影响）。
 */
export function listAvailableActions(state: GameState): Array<{ action: CombatAction; availability: ActionAvailability }> {
  const hasWeapon = hasUsableWeaponAttack(state);
  return listActions()
    .filter(
      (a: CombatAction) =>
        !a.requiresItemId ||
        (state.run?.inventory.find((i) => i.itemId === a.requiresItemId)?.qty ?? 0) > 0,
    )
    // 武器行动只在「装着解锁它的武器」时上清单（武器系统 2026-06-20）：持斧才见斧法、持枪才见射击、
    // 盾不解锁任何攻击；没带的武器不摆灰按钮（同道具行动「没货不上清单」口径）。起手刀解锁刀法 ⇒ 既有清单不变。
    .filter(
      (a: CombatAction) =>
        !a.requiresEquipment ||
        (state.run != null && equipmentUnlocksAction(state.run.equipment, a.requiresEquipment, a.id)),
    )
    // 兜底攻击（fallbackOnly·拳脚扭打）：有可用武器攻击就隐藏——否则常驻一颗被武器严格压制的死按钮（option 1·2026-06-27）。
    .filter((a: CombatAction) => !a.fallbackOnly || !hasWeapon)
    .map((a: CombatAction) => ({ action: a, availability: checkActionAvailability(state, a) }));
}
