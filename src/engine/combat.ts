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
  EnemyInstance,
  StatusKind,
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
  weightO2Mult,
  equipmentUnlocksAction,
  installedModMeta,
} from './equipment';
import { executeDeath } from './death';
import { settleStatusesAtTurnStart, isStatusImmune } from './status';
import { getItemDef } from './items';
import { resolveEncounterMember, enemySeenFlag } from './enemyLibrary';
// 敌人词条系统试点（2026-07-12·#298 拆分守 file-budget）：元数据在 src/data/affixes.json，效果常量 +
// hasAffix 判定 + 纯函数（rollAffixes/resolveDodge）在 affixes.ts；状态可变钩子（berserk/regen/venom）
// 外移进 combat-affixes.ts（见下方 import）；hardshell 防御力乘数因贴 applyAttack 伤害管线仍留在本文件内联。
import { hasAffix, rollAffixes, resolveDodge, HARDSHELL_DEFENSE_MULT } from './affixes';
import { combatNitrogenGain } from './nitrogen';
import { frontmostLivingSegment, isSegmentReachable, chainSegmentDamageBonus } from './chain-eel';
// 特殊敌人机制钩子（boss 阶段 / 链鳗 enrage / 环境压力 / 分裂 / 食尸 / 补蜂 / 茧化 / 口孵——
// 全部 EnemyDef 数据字段驱动·普通敌人恒 no-op）：见 combat-mechanics.ts。
import {
  maybeBossPhaseShift,
  maybeChainEelEnrage,
  applyEnvironmentalPressure,
  maybeEnemySplit,
  maybeCorpseEat,
  maybeMetamorphosis,
  maybeCocoonCountdown,
  maybeInterceptJuvenile,
  maybeConsumeJuvenile,
  applyMaternalEnrageIfAlone,
  maybeSwarmQueenRelocate,
  maybeSwarmCollapse,
  pufferArmed,
  detonateSelfDestruct,
  maybePufferMeleeDetonate,
} from './combat-mechanics';
// The Warren 女王身体库存主线（§15·#271·从 combat-mechanics 外移·守 file-budget）：六分支树 + 动态 screen 门 + 起盾 + 伤害计数。
import { maybeWarrenQueenAct, queenScreened, recordQueenDamage, warrenInitScreen, finalizeSwarmRelocate, applyWarrenVictory } from './combat-warren';
import { isWarrenLastStand } from './warren-hunt';
import { applyScarletVictory } from './scarlet-hunt'; // 猩红暴君追猎波次编排（run 级·非机制层·见 scarlet-hunt.ts 头注）
// 敌人词条系统试点·状态可变钩子（berserk 二次攻击 / regen 回合开头回血 / venom 命中挂毒·2026-07-12 #298
// 从本文件外移·守 file-budget）：同 combat-mechanics.ts 的互为静态 import 约定，模块顶层互不调用。
import { applyBerserkExtraAttacks, applyRegenAtTurnStart, applyVenomOnHit } from './combat-affixes';
import { maybeScarletAct, distributeScarletWaveAffixes, maybeScarletFinaleInterception } from './combat-scarlet'; // 猩红暴君 boss（§2/§3/§5·外移守 file-budget·顶层互不调用不入环）

// ——— 数据索引 ———

const ACTIONS: Map<string, CombatAction> = new Map();
for (const a of (actionData as { actions: CombatAction[] }).actions) ACTIONS.set(a.id, a);

// 命中率系统已删（战斗系统改版 2026-07-10·必中）：不再有 ENEMY_BASE_HIT / 负重命中折算——
// 每击必然连上，伤害由 resolveDamage(攻击力 − 防御力·下限0) 单点结算。负重仍影响体力消耗（weightStaminaMult·未删）。
// def.evasion/hitBonus/weightHitMod 三个数据字段已随 #291 全删（惰性数据轴清理·别再指望这里读它们）。

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
   * 水鬼专属：开战时为带 skinLoot 的敌人指定当前穿戴的皮囊 id（= 被翻动尸体所属敌种）。
   * 缺省 → 该敌 def.defaultSkin；普通敌人忽略此项（不写 wornSkin·EnemyInstance 形状不变）。
   * 这是未来「拾尸触发」钩子注入「翻的是哪具尸体」的入口（boss 设计蓝图 2026-06-21「水鬼新定位」）。
   * 注：EnemyPartyMemberDef.wornSkin 优先于此全局值（成员级 > 战斗级 > def.defaultSkin）。
   */
  wornSkin?: string;
  /**
   * 水鬼占据玩家尸体专属：战斗结束（胜/逃）后路由回此 DeathRecord.id 的 corpse subPhase。
   * 未设 → 普通路由（victoryEventId / rest）。由 dive-move.ts case 'corpse': 注入。
   */
  sourceCorpseId?: string;
  /**
   * The Warren 背水一战覆写（§4·详见 types/combat.ts::CombatState.warrenLastStand）。未设 → 从追猎进度派生
   * （`isWarrenLastStand(run)`）。只给 scenario/adhoc 用：构造背水一战而不必拨动 roomsCleared（那会连带改产卵上限）。
   */
  warrenLastStand?: boolean;
  /**
   * 首回合免费行动（战斗系统改版 2026-07-10·取代 ambushing 突袭暴击）：迎战/先发制人开战传 true → 你抢先出手、
   * 第一手行动后敌人这一轮不还击（applyPlayerAction 跳过一次敌人回合并清标）。缺省 → 普通开战。
   */
  preemptive?: boolean;
}

export function startCombat(
  state: GameState,
  encOrId: string | CombatEncounterDef,
  options?: StartCombatOptions,
): GameState {
  const enc = typeof encOrId === 'string' ? COMBAT_ENCOUNTERS.get(encOrId) : encOrId;
  if (!enc || !state.run) return state;
  const combatId = enc.id;

  // 负伤系统整套下线（战斗系统改版 2026-07-10）：原「玩家流血·重→嗅觉系敌开局 alerted」的 scent 门已删
  // （驱动它的 run.injuries scentTrail 没了）→ 初始姿态恒 def.initialStance。
  const enemies: EnemyInstance[] = enc.party.members.map((m, idx) => {
    // 敌人库 SPEC §4/支柱二：defId 直查 · enemyRef 经 pickEnemy 取一只合适的（route B 加法·非破坏）。
    const def = resolveEncounterMember(m);
    if (!def) throw new Error(`Enemy def not resolved for party member: ${JSON.stringify(m)}`);
    const inst: EnemyInstance = {
      instanceId: `${combatId}.${idx}`,
      defId: def.id,
      hp: def.hp,
      stance: def.initialStance,
      aggro: def.threat,
      statuses: [],
    };
    // 水鬼：记录开战时穿戴的皮囊（loot-trigger 的尸体来源·成员级 > 战斗级 > defaultSkin）。
    // 仅对带 skinLoot 的敌人写此字段 ⇒ 普通敌人 EnemyInstance 逐字节不变（守 #99 + 既有 combat baseline）。
    if (def.skinLoot) {
      const worn = m.wornSkin ?? options?.wornSkin ?? def.defaultSkin;
      if (worn !== undefined) inst.wornSkin = worn;
    }
    // 词条运行时副本（敌人词条系统试点·2026-07-12·单词条随机化修正）：优先级
    // member.affixesOverride（encounter/scenario 钉死·确定性测试）> def.randomAffixes（开战随机抽取，
    // 消耗 Math.random——只对带 randomAffixes 的敌人，非词条敌人恒零 RNG）> def.affixes（固定集，仍支持）。
    // 只对最终抽到非空词条集的敌人写 inst.affixes ⇒ 普通敌人 EnemyInstance 逐字节不变（守 #99）；
    // 带 randomAffixes 的敌人：本次 spawn 消耗 RNG，其 baseline 需 bless on Mac（affixesOverride 可绕开）。
    const rolledAffixes =
      m.affixesOverride ??
      (def.randomAffixes ? rollAffixes(def.randomAffixes.pool, def.randomAffixes.count) : def.affixes);
    if (rolledAffixes?.length) inst.affixes = rolledAffixes;
    // 运行时攻击覆盖（水鬼穿玩家武器时注入·静态 JSON 不设此字段 → 逐字节不变）。
    if (m.attacksOverride) {
      inst.phaseAttacksOverride = m.attacksOverride;
    }
    // 茧化居民：开战默认幼体阶段；成员可显式覆写（The Warren 到达路由注入卵＝'cocoon'·蜂群 boss SPEC §9.5/§15·buildWarrenArrival）。
    if (def.metamorphosis) {
      const stage = m.metamorphosisStage ?? 'larva';
      inst.metamorphosisStage = stage;
      if (stage === 'cocoon') {
        inst.cocoonTurnsLeft = def.metamorphosis.cocoonMaxTurns;
        inst.phaseArmorOverride = def.metamorphosis.cocoonArmor;
      }
    }
    return inst;
  });

  const combat: CombatState = {
    combatId,
    encounterId: enc.id,
    enemies,
    reinforcementPool: enc.reinforcementPool,
    playerStatuses: [],
    // 迎战先手（猎手 SPEC §5·战斗系统改版 2026-07-10）：standAndFight 传 preemptive → 首回合免费行动（敌人这一轮不还击）。缺省 → 普通开战逐字节不变。
    ...(options?.preemptive ? { preemptive: true as const } : {}),
    turn: 0,
    log: [],
    victoryEventId: enc.victoryEventId,
    resumeNodeId: state.run.currentNodeId,
    // 水鬼玩家尸体战斗：胜/逃后路由回 corpse subPhase（未设 → 普通路由不变）。
    ...(options?.sourceCorpseId ? { sourceCorpseId: options.sourceCorpseId } : {}),
    // 链鳗（分节实体）：按序攻击分节链标记（仅显式标 true 的遭遇带·普通 party 不写 ⇒ 逐字节不变）。
    ...(enc.attackInOrder ? { attackInOrder: true as const } : {}),
    // The Warren 背水一战＝**状态不是地点**，从追猎进度派生；scenario/adhoc 可覆写。非 Warren 恒 false ⇒ 逐字节不变。
    ...(options?.warrenLastStand ?? isWarrenLastStand(state.run) ? { warrenLastStand: true as const } : {}),
    // The Warren 封口墙（她那间门口·§5）：破墙胜利 → finalizeVictory 置 warrenHunt.wallDown。仅到达路由构造的墙遭遇带此标 ⇒ 逐字节不变。
    ...(enc.warrenWall ? { warrenWall: true as const } : {}),
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
  s = warrenInitScreen(s); // The Warren 女王·开战起手起初始肉盾（§15.2·否则第 1 回合玩家先手·女王裸露·丢「先破墙」手感）
  s = distributeScarletWaveAffixes(s); // 猩红暴君波·一波内跨怪无放回词条分发（§3.2·非猩红波遭遇零成本早退）
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
  // 负重档位体力倍率（武器系统·作者 2026-06-20）。负伤系统下线后不再有 staminaCostMult/o2CostMult 折算（恒 1）。
  const wMult = weightStaminaMult(run.equipment);
  // 负重档位氧耗倍率（#289·作者 2026-07-11）：战斗＝全用力动作 ⇒ 氧耗同体力一起吃负重税·轻档 ×1 逐字节不变。
  // （负伤 o2CostMult 已随负伤系统下线移除，此处只余负重税。）
  const wO2 = weightO2Mult(run.equipment);
  // 屏息潜逃纠缠代价（机制·见 fleeEngagedSurcharge）：与基础 costStamina 相加后过负重乘子。
  const fleeSurcharge = action.effect.kind === 'flee' ? fleeEngagedSurcharge(enemies) : 0;
  return {
    stamina: Math.ceil((action.costStamina + fleeSurcharge) * wMult),
    oxygen: Math.ceil(action.costOxygenTurns * wO2),
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
  return startCombat(state, enc, options);
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

  // 负重过载：无战斗内检查——出发门（dive-start.ts::isOverloaded）已拦过载下潜，且 run.equipment 在
  // 整个下潜期冻结（无游戏内路径改写），故战斗中 isOverloaded(run.equipment) 恒假、不可能为真。
  // 曾有一份「防御性双保险」分支覆盖这条恒假路径，删（作者 2026-07-11：别放不可达代码，会误导）。

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

  // The Warren 女王·动态 screen 门（§15.2·替静态 shieldedBy·queenScreened 仅 warrenScreen 女王）：女王拉的肉盾（screeningFor）还有活的 → 不可选中女王·杀穿才够得着。
  if (targetInstanceId !== undefined && action.effect.kind === 'attack' &&
      state.phase.kind === 'combat' && queenScreened(state.phase.combat.enemies, targetInstanceId)) {
    return { available: false, reason: '肉盾还挡在她前面——先凿穿挡路的，才够得着她。' };
  }

  return { available: true };
}

// ——— 一次玩家行动的应用 ———

export interface CombatTurnResult {
  state: GameState;
  outcome: 'continue' | 'victory' | 'flee' | 'defeat';
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
  // —— 0. 回合开始 tick：负伤系统整套下线（战斗系统改版 2026-07-10）——原「流血·重持续掉体力」的
  // staminaTickPerTurn 折算已随 run.injuries 删除，此处不再有玩家侧回合债。
  // —— 0b. boss 战场压力 tick（boss 存活即施加·每回合触发一次）——
  s = applyEnvironmentalPressure(s);
  // —— 0c. 茧化居民变态发育检查（氧气阈值触发·仅带 metamorphosis 的敌人进分支·其余逐字节不变）——
  s = maybeMetamorphosis(s);
  // —— 0d. 裂球分裂检查（回合开头·在玩家行动造伤之前检查·这样本回合的伤害不会逆向抑制「之前 N 回合」的分裂门）——
  // 仅带 splitBehavior 的敌人进分支；普通敌人逐字节不变。
  s = maybeEnemySplit(s);

  // —— 0e. 玩家状态结算（自己回合开头·战斗状态系统 SPEC §2.3）：DoT 求和落 HP + stun 判定 + 状态减 1 清零移除。
  // 与 runEnemyTurn 里敌人的结算共用同一个 settleStatusesAtTurnStart（对称·单一结算函数）。
  // `?? []` 兜底：CombatState 设计上是战斗内瞬态（不序列化的意图），但 saveGame 按整个 GameState
  // 落盘（App.tsx 每次 state 变化都存）、旧同版本存档若恰好停在战斗中会缺这个新加字段——按 quirk #99
  // 「纯加字段不 bump SAVE_VERSION、读点 `?? 默认` 兜底」同一口径处理，别为此专门 bump。
  let playerStunned = false;
  if (s.phase.kind === 'combat' && s.run) {
    const settled = settleStatusesAtTurnStart(s.run.stats.hp, s.phase.combat.playerStatuses ?? []);
    const dot = s.run.stats.hp - settled.hp;
    if (dot > 0) {
      s = applyStatsDelta(s, { hp: -dot });
      s = pushCombatLog(s, { actor: 'system', text: `持续伤势带走你 ${dot} 点生命。` });
    }
    s = setCombat(s, (c) => ({ ...c, playerStatuses: settled.statuses }));
    // DoT 致死：与敌人侧 settleStatusesAtTurnStart 后 `if (settled.hp <= 0) continue` 同一时点判定
    // （SPEC §2.6 对称设计）——玩家这侧「回合到此为止」＝直接走死亡收束，不再应用本次选择的行动
    // （否则一次 recover 治疗能在同一回合把「刚被毒死」的结果原地复活，或靠这一击顺手放倒最后一个
    // 敌人躲过死亡判定：finalizeVictory/finalizeFlee/finalizeSwarmRelocate 都不读玩家 HP，必须在它们之前拦）。
    if (settled.hp <= 0) {
      return { state: executeDeath(s, '重伤不治'), outcome: 'defeat' };
    }
    playerStunned = settled.stunned;
  }

  if (playerStunned) {
    // 眩晕：本回合玩家行动被消耗为「挣扎·无效」（SPEC §2.3）——不扣资源、不应用效果，直接进入战后判定/敌人回合。
    s = pushCombatLog(s, { actor: 'player', text: `${action.name}：你还在挣扎——这一下没能作数。` });
  } else {
    // —— 1. 扣资源（负伤修正后的实际消耗·与 availability 同一函数） ——
    const costs = actionCosts(s.run!, action, s.phase.kind === 'combat' ? s.phase.combat.enemies : undefined);
    s = applyStatsDelta(s, {
      stamina: -costs.stamina,
      oxygen: -costs.oxygen,
    });

    // —— 1a. 战斗氮气累积（战斗 SPEC §2.1/§10 与主系统耦合）：按当前深度累积氮气，逼近速率 ×1.5（剧烈呼吸·
    //   时间制·渐近深度 ceiling 不越过）。**仅喂减压债**（氮气已与旧「头脑不正常」轴脱钩·2026-07-10 理智系统移除·
    //   那条留待地点缝 seam）。此前战斗不累积氮气是 gap。债数学单点在 nitrogen.ts::combatNitrogenGain·此处只经
    //   applyStatsDelta 落增量（守规则六 nitrogen 单写口·无内联 ± 债务算术）。
    const nitrogenGain = combatNitrogenGain(s.run!.stats.nitrogen, s.run!.currentDepth, action.costOxygenTurns);
    if (nitrogenGain !== 0) {
      s = applyStatsDelta(s, { nitrogen: nitrogenGain });
    }

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

    // —— 3. 一次性玩家状态清理已删（战斗系统改版 2026-07-10）：PlayerStatus（evading/ambushing）下线，无一次性状态需消耗。
  }

  // —— The Warren：女王死（仅死角 the Hatchery）→ 残余崩解（取胜＝女王死·§9.6 演出·令 allEnemiesDefeated 成立）——
  s = maybeSwarmCollapse(s);

  // —— 4a. The Warren：女王被巢撤走 → 房间清空·女王逃脱（非死角·**先于**胜负判定·§9.1）——
  //   非死角她被打进暴露窗即被拖走，即便本击/DoT overkill 到 hp≤0 也算「逃脱」而非「击杀」——故须先于 allEnemiesDefeated。
  if (s.phase.kind === 'combat' && s.phase.combat.pendingSwarmRelocate) {
    return finalizeSwarmRelocate(s);
  }

  // —— 4. 战后判定：是否胜利 ——
  const after = (s.phase.kind === 'combat' ? s.phase.combat : null);
  if (after && allEnemiesDefeated(after)) {
    return finalizeVictory(s);
  }

  // —— 5. 检查脱战（applyFlee 成功时写 pendingFleeSuccess·typed flag）——
  if (s.phase.kind === 'combat' && s.phase.combat.pendingFleeSuccess) {
    return finalizeFlee(s);
  }

  // —— 6. 敌人回合（首回合免费行动·战斗系统改版 2026-07-10）：迎战/先发制人（preemptive）时你抢先出手，
  // 敌人这一轮不还击——跳过一次敌人回合并清标；其余回合照常。取代旧 ambushing 突袭暴击。
  if (s.phase.kind === 'combat' && s.phase.combat.preemptive) {
    s = setCombat(s, (c) => ({ ...c, preemptive: false }));
    s = pushCombatLog(s, { actor: 'system', text: '你抢先出手——它们这一轮没能还击。' });
  } else {
    s = runEnemyTurn(s);
  }

  // —— 7. 玩家死亡判定 ——
  if (!s.run) return { state: s, outcome: 'defeat' };
  // 战斗中两条即死窗（战斗系统改版 2026-07-10）：氧气耗尽（窒息）/ 生命耗尽（重伤不治）。
  // **体力≤0 不再致死**（体力＝行动预算·只是无法行动·须调息回复）；伤害归 HP，HP≤0 才死。
  // 出口是 flee / beginAscent（都不经本函数）：开阔水或站在上浮口 → CombatView 弃战上浮（beginAscent·零成本·任意回合）；
  // 其余水域靠 action.flee（需氧≥3）。**封闭水域低氧确实无出路＝有意 attrition**（蓝洞头顶岩顶·作者 2026-07-05 拍·非 bug）。
  if (s.run.stats.oxygen <= 0) {
    return { state: executeDeath(s, '战斗中窒息'), outcome: 'defeat' };
  }
  if (s.run.stats.hp <= 0) {
    return { state: executeDeath(s, '重伤不治'), outcome: 'defeat' };
  }

  // —— 8. 回合 +1 ——
  s = setCombat(s, (c) => ({ ...c, turn: c.turn + 1 }));

  return { state: s, outcome: 'continue' };
}

// ——— 行动效果分发 ———

function applyActionEffect(state: GameState, action: CombatAction, targetId?: string): GameState {
  let s = state;
  switch (action.effect.kind) {
    case 'attack':
      return applyAttack(s, action, targetId);
    // 'defend'（闪避）分支已删（战斗系统改版 2026-07-10）：闪避动作下线。
    case 'recover':
      return applyRecover(s, action);
    case 'flee':
      return applyFlee(s, action);
    case 'crowd_control':
      return applyCrowdControl(s, action);
    case 'use_item':
      return applyUseItem(s, action);
  }
  return s;
}

function applyAttack(state: GameState, action: CombatAction, targetId?: string): GameState {
  if (state.phase.kind !== 'combat') return state;
  if (action.effect.kind !== 'attack') return state;
  const combat = state.phase.combat;
  { const fin = maybeScarletFinaleInterception(state, targetId); if (fin) return fin; } // §5 第五波剧情杀·首攻触发暴君瞬吃3夺3·玩家这一击落空（暴君登场后 null·普通攻击照常）
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

  // 命中判定已删（战斗系统改版 2026-07-10·必中）：不再摇命中骰——每击必然连上，
  // 伤害由 resolveDamage(攻击力 − 防御力·下限0) 单点结算（重甲敌人对弱武器可为 0 伤＝逼换武器/找弱点）。
  // def.evasion 字段本身已随 #291 删（不只是不读，是不存在了）。

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
  // 突袭暴击已删（战斗系统改版 2026-07-10）：ambushing 玩家状态下线（迎战先手改由「首回合免费行动」承载·task6）。
  // 口孵深鱼截击（maternalBehavior·interceptChance）：命中护巢仔时母鱼有概率截下这一击。
  // interceptChance≥1 时 rollChance 不消耗 RNG ⇒ 零额外 RNG 成本·既有 baseline 逐字节不变（守 #99）。
  // 在装甲计算**之前**截住 pre-armor rawDmg，母鱼用自己的 armorWhileProtected 减伤（非双重减伤）。
  {
    const intercepted = maybeInterceptJuvenile(state, target, dmg, eff.damageType, action.name);
    if (intercepted !== null) return intercepted;
  }
  // 灵巧词条（nimble·敌人词条系统试点 2026-07-12）：伤害结算前掷一次闪避——命中则这一击归零，
  // 且下面 setCombat 里不再施加 applyStatusOnHit（闪开的攻击算不上命中，见 dodged 门）。
  const dodged = resolveDodge(target.affixes);
  // 防御力减伤（战斗系统改版 2026-07-10·resolveDamage 单点·下限0）：物理伤扣目标防御（茧化期用 phaseArmorOverride
  // 替代 def.armor）；非物理伤（电/火）绕过防御（弱点/免疫轴另走）→ defense=0。原 max(1,…) 地板 1 改为下限 0。
  // 硬壳词条（hardshell）：仅物理伤——防御力乘 HARDSHELL_DEFENSE_MULT（与非物理绕过防御的既有语义正交）。
  {
    let effectiveDefense = eff.damageType === 'physical' ? (target.phaseArmorOverride ?? def.defense) : 0;
    if (eff.damageType === 'physical' && hasAffix(target.affixes, 'hardshell')) {
      effectiveDefense = Math.round(effectiveDefense * HARDSHELL_DEFENSE_MULT);
    }
    dmg = dodged ? 0 : resolveDamage(dmg, effectiveDefense);
  }
  // 免疫
  if (def.immunity?.includes(eff.damageType)) {
    return pushCombatLog(state, { actor: 'player', text: `${action.name}：${def.name} 免疫此种伤害。` });
  }

  // 应用
  let s = setCombat(state, (c) => ({
    ...c,
    enemies: c.enemies.map((e) => {
      if (e.instanceId !== target.instanceId) return e;
      const newHp = Math.max(0, e.hp - dmg);
      // 只堆叠·无刷新（战斗状态系统 SPEC §2.2）：每次 apply = push 独立实例，不去重/不按 kind 合并。
      // 布尔免疫（§2.5）：声明了 statusImmunity 的目标，该 kind 完全无效（不是减时长/减潜力）。
      // 击杀同一击不再上状态（newHp<=0）：别给这一下顺手打死的尸体挂新状态——与武器件 DoT 分支
      // 的 `e.hp > 0` 门同口径（那边守的是「已死不再上」，这里守的是「这一下刚打死不再上」）。
      // 闪避短路（nimble）：dodged=true 时这一击算没打中，不施加 applyStatusOnHit。
      const applyStatus = !dodged && eff.applyStatusOnHit && newHp > 0 && !isStatusImmune(def.statusImmunity, eff.applyStatusOnHit.kind);
      return {
        ...e,
        hp: newHp,
        aggro: e.aggro + Math.ceil(dmg / 5),
        stance: e.stance === 'unaware' ? 'alerted' : e.stance === 'alerted' ? 'attacking' : e.stance,
        // 裂球：累计本周期内玩家造成的伤害（maybeEnemySplit 读取·仅带 splitBehavior 的敌人才写）
        ...(ENEMY_DEFS.get(e.defId)?.splitBehavior
          ? { splitDamageAccum: (e.splitDamageAccum ?? 0) + dmg }
          : {}),
        statuses: applyStatus
          ? [...e.statuses, { kind: eff.applyStatusOnHit!.kind, remainingTurns: eff.applyStatusOnHit!.turns, dmgPerTurn: eff.applyStatusOnHit!.dmgPerTurn }]
          : e.statuses,
      };
    }),
  }));
  s = pushCombatLog(s, {
    actor: 'player',
    text: dodged
      ? `${action.name}：${def.name} 灵巧一闪，你的攻击落了空。`
      : `${action.name}：你击中 ${def.name}，造成 ${dmg} 点伤害。${target.hp - dmg <= 0 ? `${def.name} 失去战斗力。` : ''}`,
  });
  // boss 阶段检查（HP 因玩家攻击下降·每次命中后触发）
  s = maybeBossPhaseShift(s, target.instanceId);
  // The Warren 女王：被打进暴露窗（HP≤阈值·非死角）→ 巢把她撤走（§9.1·置 pendingSwarmRelocate·applyPlayerAction 4a 收束）
  s = maybeSwarmQueenRelocate(s, target.instanceId);
  s = recordQueenDamage(s, target.instanceId, dmg); // §15.4 screen 触发计数：本次对女王伤害记进滚动窗口
  // The Warren·Puffer 自爆（§9.9）：近战命中 armed Puffer → 当场引爆·溅玩家；远程命中豁免（不溅）。见 combat-mechanics。
  s = maybePufferMeleeDetonate(s, action.requiresEquipment === 'ranged', target.instanceId);
  // 清道夫（corpseEating）：玩家攻击致死 → 触发尸食钩子
  s = maybeCorpseEat(s, target.instanceId);
  // 口孵深鱼护巢仔全灭检查（玩家攻击致死护巢仔时·幂等·护巢仔未全灭 = no-op）
  s = applyMaternalEnrageIfAlone(s);

  // 放电芯扣电（命中触发后结算·run.power 单点扣·非 Stats clamp 范畴）。
  if (powerSpent > 0 && s.run) {
    s = { ...s, run: { ...s.run, power: Math.max(0, s.run.power - powerSpent) } };
  }

  // 毒囊 / 倒刺套件（武器系统·作者 2026-06-20）：命中且触发 → 给**该目标**挂 DoT 状态
  // （中毒 poisoned / 撕裂 bleeding·每回合 dmgPerTurn·回合开头结算·见 runEnemyTurn/settleStatusesAtTurnStart）。
  // 注意：敌人的中毒/撕裂走 StatusInstance DoT，与玩家专属的负伤系统（injuries.ts·check-boundaries 规则四守的那套）无关。仅装了 mod 才进此分支。
  if (modMeta && (modMeta.effect === 'poison' || modMeta.effect === 'barb') && rollChance(modMeta.chance)) {
    const kind: StatusKind = modMeta.effect === 'poison' ? 'poisoned' : 'bleeding';
    // 布尔免疫（SPEC §2.5）：免疫 ⇒ 该 status 完全无效——不挂、不日志（伤害已在上面正常结算，只是这次没带毒/撕裂）。
    if (!isStatusImmune(def.statusImmunity, kind)) {
      const dpt = modMeta.dmgPerTurn ?? 0;
      const turns = modMeta.turns ?? 1;
      // 只堆叠·无刷新（§2.2）：去掉「先删同类再加」的 filter，纯 append。
      s = setCombat(s, (c) => ({
        ...c,
        enemies: c.enemies.map((e) =>
          e.instanceId === target.instanceId && e.hp > 0
            ? { ...e, statuses: [...e.statuses, { kind, remainingTurns: turns, dmgPerTurn: dpt }] }
            : e,
        ),
      }));
      s = pushCombatLog(s, {
        actor: 'system',
        text: modMeta.effect === 'poison' ? `毒液渗进伤口——${def.name} 开始溃烂。` : `倒刺撕开一道长口子——${def.name} 血流不止。`,
      });
    }
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
  let s = applyStatsDelta(state, action.effect.deltas ?? {});
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
  // 纯 append（既有写法·战斗状态系统 SPEC §2.2 作为「只堆叠」的对照参考，无需改动）；
  // 新增布尔免疫门控（§2.5）：对所有敌人一视同仁施加，但各按自己的 statusImmunity 单独判。
  // hp>0 门：已死的敌人不再挂新状态（同其余两处施加点口径），避免死尸状态数组随后续 crowd_control 无限堆。
  return setCombat(state, (c) => ({
    ...c,
    enemies: c.enemies.map((e) => {
      const canApply = e.hp > 0 && eff.applyStatusToAll && !isStatusImmune(ENEMY_DEFS.get(e.defId)?.statusImmunity, eff.applyStatusToAll.kind);
      return {
        ...e,
        aggro: Math.max(0, e.aggro + (eff.threatDelta ?? 0)),
        statuses: canApply
          ? [...e.statuses, { kind: eff.applyStatusToAll!.kind, remainingTurns: eff.applyStatusToAll!.turns }]
          : e.statuses,
      };
    }),
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

  // 负伤系统整套下线（战斗系统改版 2026-07-10）：原急救包治伤（applyMedkitHeal·consumable.medkit 旗标）已删——
  // 急救包现只经 effectOnUse.deltas 回 HP（上面已套用），不再有治伤副效应。
  return s;
}

export function applyStatsDelta(state: GameState, deltas: Partial<Record<keyof Stats, number>>): GameState {
  if (!state.run) return state;
  let stats: Stats = { ...state.run.stats };
  for (const [k, v] of Object.entries(deltas) as [keyof Stats, number][]) {
    stats[k] = stats[k] + v;
  }
  // 上限 clamp（战斗系统改版 2026-07-10）：负伤下线后体力上限恒 run.staminaMax（无 staminaMaxDelta 折算）；生命上限＝run.hpMax。
  stats = clampStats(stats, { stamina: state.run.staminaMax, oxygen: state.run.oxygenMax, hp: state.run.hpMax });
  return { ...state, run: { ...state.run, stats } };
}

export function randRange([min, max]: [number, number]): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

/**
 * 伤害结算单点（战斗系统改版 2026-07-10·作者「任何单位攻击任何单位都是这个逻辑」）：
 * 落到目标的伤害 = max(0, 攻击力 − 防御力)。**下限 0**（重甲挡弱器＝真打不动·逼换武器/找弱点）、**必中**（无命中骰）。
 * 玩家↔敌人↔敌人共用本函数（对称·可拓展）。防御力语义＝物理减伤：非物理伤（电/火）调用方传 defense=0（弱点/免疫轴另走）。
 * 纯函数·零 RNG（伤害区间的随机在调用方 randRange 已摇好·此处只做减法）。
 */
export function resolveDamage(rawAttack: number, defense: number): number {
  return Math.max(0, rawAttack - Math.max(0, defense));
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

  // The Warren 女王·身体库存主线 dispatcher（§15·#271）：每女王敌方回合从六分支优先级树择一（feed>screen>lay/force-hatch>detonate>hatch>cocoon-boost·
  // 女王无攻击表·威胁来自巢）·「一回合一动作」天然保凿破卵窗（lay/force-hatch 互斥回合）·退役 droneReplenish→繁殖储备节流（§15.1）。
  s = maybeWarrenQueenAct(s);
  // 口孵深鱼（maternalBehavior）：母鱼回合开头检查 HP < 50%——有存活护巢仔时消耗一只回血。
  // 在 order 捕获**之前**执行：被消耗的护巢仔 HP→0 后不会出现在行动队列里（无幽灵行动）。
  s = maybeConsumeJuvenile(s);
  s = maybeScarletAct(s); // 猩红暴君/弑亲者·吃活同伴夺词条（§2·非 scarletFeed def 零成本 no-op·先于 order 捕获·被吞不进行动队列）

  // 按 aggro 降序，每个活着的敌人依次行动（战斗状态系统 SPEC §2.3：眩晕不再是「预先滤掉」——
  // order 含本回合全部活敌，走到自己回合时才结算 settleStatusesAtTurnStart 知道是否眩晕，
  // 语义与旧「statuses.some(kind==='stunned') 排除在外」一致，只是判定点从「回合前」挪到「自己回合开头」）。
  const order = [...(s.phase.kind === 'combat' ? s.phase.combat.enemies : [])]
    .filter((e) => e.hp > 0)
    .sort((a, b) => b.aggro - a.aggro);

  for (const e of order) {
    // 实时检查：order 快照后由前置钩子（maybeConsumeJuvenile 等）降至 0 的敌人跳过
    const live = s.phase.kind === 'combat'
      ? s.phase.combat.enemies.find((x) => x.instanceId === e.instanceId)
      : null;
    if (!live || live.hp <= 0) continue;
    const def = ENEMY_DEFS.get(e.defId);
    if (!def) continue;

    // —— 状态结算（自己回合开头·SPEC §2.3）：DoT 求和落 HP + stun 判定（减 1 之前读）+ 状态减 1 清零移除 ——
    // 取代原「回合末」全局 DoT tick + 状态衰减两块：order 快照含本回合全部活敌，逐一结算 ⇒ 覆盖面不变，只挪时点。
    const settled = settleStatusesAtTurnStart(live.hp, live.statuses);
    const dot = live.hp - settled.hp;
    s = setCombat(s, (c) => ({
      ...c,
      enemies: c.enemies.map((x) =>
        x.instanceId === e.instanceId ? { ...x, hp: settled.hp, statuses: settled.statuses } : x,
      ),
    }));
    if (dot > 0) {
      s = pushCombatLog(s, { actor: 'system', text: `${def.name} 因持续伤势失去 ${dot} 点生命。` });
      // boss 阶段检查（HP 因 DoT 下降）——可能改写该敌人的 stance/攻击表覆盖，下面重读 cur 拿最新值。
      s = maybeBossPhaseShift(s, e.instanceId);
      // The Warren 女王：DoT 也可能把她打进暴露窗（非死角）→ 巢撤走（§9.1·下一玩家行动 4a 收束）
      s = maybeSwarmQueenRelocate(s, e.instanceId);
      // 清道夫（corpseEating）：DoT 致死同样触发尸食钩子
      s = maybeCorpseEat(s, e.instanceId);
      // 口孵深鱼护巢仔全灭检查（DoT 致死护巢仔时·幂等）
      s = applyMaternalEnrageIfAlone(s);
    }
    // 自愈词条（regen·敌人词条系统试点 2026-07-12）：己方回合开头（DoT 结算之后）按最大 HP 比例回血，
    // 封顶 def.hp——与眩晕/是否出手正交（活着就回，这是被动·不占行动）。外移进 combat-affixes.ts（#298）。
    s = applyRegenAtTurnStart(s, e.instanceId, def, settled.hp, live.affixes);
    // DoT 致死＝hp→0，胜负在下个玩家行动结算点判定（与「最后一只逃跑 hp=0」同口径·不在敌人回合内提前 finalize·守既有时序）。
    if (settled.hp <= 0) continue;
    // 眩晕：这回合不行动（语义与旧 order 预过滤一致，只是判定点挪到这里·无日志——旧行为本就静默跳过）。
    if (settled.stunned) continue;

    // 结算期间的钩子（boss 阶段迁移等，见上）可能已经改写了这只敌人的 stance / 攻击表覆盖——
    // 重读一次当前值，后续判断与出手都基于结算后的最新状态，不再用回合开头捕获的 order 快照 `e`
    // （旧代码里 DoT 恒在全部行动之后才结算，天然不会有这个问题；挪到回合开头后，同一敌人自己的
    // DoT 结算钩子现在可能先于它自己的行动决策生效，必须读新值，否则会打出「上阶段前」的旧攻击表/旧 stance）。
    const cur = s.phase.kind === 'combat' ? s.phase.combat.enemies.find((x) => x.instanceId === e.instanceId) : undefined;
    if (!cur || cur.hp <= 0) continue;

    // 茧化居民幼体（metamorphosisStage='larva'）：passive，不发起攻击——直接跳过。
    if (def.metamorphosis && cur.metamorphosisStage === 'larva') {
      s = pushCombatLog(s, { actor: 'enemy', text: `${def.name} 停在原地，像一颗等待爆发的蛋。` });
      continue;
    }
    // 茧化居民茧（metamorphosisStage='cocoon'）：同样 passive，不出手。
    if (def.metamorphosis && cur.metamorphosisStage === 'cocoon') continue;
    // The Warren·Puffer 到点自爆（§9.9）：羽化成 armed Puffer 的单位在它的回合自爆（AoE 溅玩家）·随即自毁。
    // **必须先于**下方「无攻击表 passive 守栏」——adult Puffer 的 phaseAttacksOverride=[] 否则会被当 passive 跳过（不炸）。
    if (pufferArmed(def, cur)) {
      s = detonateSelfDestruct(s, e.instanceId);
      continue;
    }
    // 无攻击表的敌人（The Warren 女王·蜂群 boss SPEC §5/§9.3「别给女王塞攻击表」）：passive 存在体，不出手——
    // 直接跳过（威胁来自巢·非女王本体）。**同时是 enemyAttackPlayer 空 attacks 的护栏**（否则 chosen=undefined→.name 崩）。
    // 全库通用（守 SPEC §3「不给单只敌人写专属分支」）：任何 attacks 空且无覆盖/吸收的敌人皆 passive。
    if ((cur.phaseAttacksOverride ?? def.attacks).length === 0 && !cur.absorbedAttacks?.length) continue;
    // 逃跑的敌人不打人
    if (cur.stance === 'fleeing') {
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
    // 低血主动撤退（territorial / passive 类敌人）：用 cur.hp（本回合已结算 DoT + 结算钩子之后的当前值）——
    // 状态结算挪到回合开头后，这一判定自然吃到「本回合刚落的 DoT」，无需特判（§2.3 时点变化的自然结果）。
    if (
      cur.hp <= def.hp * 0.3 &&
      cur.stance !== 'enraged' &&
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
    if (cur.stance === 'alerted' && Math.random() < 0.7) {
      s = pushCombatLog(s, { actor: 'enemy', text: `${def.name} 在你周围游动，没有出手。` });
      s = setCombat(s, (c) => ({
        ...c,
        enemies: c.enemies.map((x) => (x.instanceId === e.instanceId ? { ...x, stance: 'attacking' } : x)),
      }));
      continue;
    }
    s = enemyAttackPlayer(s, cur);
    // 狂暴词条（berserk·敌人词条系统试点 2026-07-12）：本回合再追加 BERSERK_EXTRA_ATTACKS 次攻击。
    // 外移进 combat-affixes.ts（#298·守 file-budget）——细节注释见该文件。
    s = applyBerserkExtraAttacks(s, cur);
  }

  // 旧「回合末」全局 DoT tick + 状态衰减两块已删（战斗状态系统 SPEC §2.3）：改在循环内每个敌人
  // 自己回合开头结算（settleStatusesAtTurnStart，见上）——order 快照覆盖本回合全部活敌，逐一结算，
  // 覆盖面与旧全局块等价，只是判定点从「回合末」挪到「自己回合开头」。

  // 链鳗（分节实体）头节 enrage：DoT 可能杀掉最后一节体节 → 头节成为最前存活节（守 attackInOrder·非链鳗逐字节不变）。
  s = maybeChainEelEnrage(s);

  // 茧化居民茧化倒计时：每轮结束后递减（归零时下一个 maybeMetamorphosis 触发羽化成体）。
  s = maybeCocoonCountdown(s);

  return s;
}

export function enemyAttackPlayer(state: GameState, enemy: EnemyInstance): GameState {
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

  // 敌人命中判定已删（战斗系统改版 2026-07-10·必中）：不再摇命中骰——每击必然连上，
  // 伤害由 resolveDamage(攻击力 − 玩家防御·下限0) 单点结算。
  // hitBonus 字段 + weightHitMod 函数本身已随 #291 删（不只是不读，是不存在了）。

  // 计算伤害
  let dmg = randRange(chosen.damage);
  // 链鳗（分节实体）威胁派生（boss 设计蓝图「越杀越短越快越危险」）：按序遭遇里存活节越少 → 余节攻击越凶。
  // chainSegmentDamageBonus 是纯整数算术·无 RNG ⇒ 仅 attackInOrder 遭遇进此分支 ⇒ 无序 party 的 RNG 流逐字节不变。
  if (state.phase.combat.attackInOrder) {
    const seg = state.phase.combat.enemies;
    dmg += chainSegmentDamageBonus(seg.filter((e) => e.hp > 0).length, seg.length);
  }
  // 闪避已删（战斗系统改版 2026-07-10·evading 玩家状态下线）。
  // 玩家防御力（战斗系统改版 2026-07-10·＝潜水衣 physicalArmor·resolveDamage 单点·下限0）：物理伤扣防御，
  // 非物理伤（电/火）绕过防御（defense=0）。原 max(1,…) 地板 1 改为下限 0——重甲挡弱敌可为 0 伤。
  const defense = chosen.damageType === 'physical' ? getEquipmentStats(state.run.equipment).physicalArmor : 0;
  dmg = resolveDamage(dmg, defense);

  // 伤害落点＝生命值（战斗系统改版 2026-07-10）：敌攻改扣 HP（体力≤0 不再致死·体力＝行动预算）。
  let s = applyStatsDelta(state, { hp: -dmg });
  s = pushCombatLog(s, {
    actor: 'enemy',
    text: `${chosen.description}（生命 -${dmg}）`,
  });

  // 负伤判定已删（战斗系统改版 2026-07-10·负伤系统整套下线）：敌攻不再掷骰给玩家负伤——伤害统一落 HP。

  // 敌→玩家施状态（战斗状态系统 SPEC §2.6）：镜像玩家攻击的 applyStatusOnHit 通道。确定命中
  // （v1 玩家缺省无免疫·§2.5）·只堆叠无刷新（§2.2·纯 append，不 filter 去重）。
  if (chosen.applyStatusOnHit && s.phase.kind === 'combat') {
    const onHit = chosen.applyStatusOnHit;
    s = setCombat(s, (c) => ({
      ...c,
      playerStatuses: [...(c.playerStatuses ?? []), { kind: onHit.kind, remainingTurns: onHit.turns, dmgPerTurn: onHit.dmgPerTurn }],
    }));
  }

  // 剧毒词条（venom·敌人词条系统试点 2026-07-12）：带此词条的敌人每次攻击额外挂一层中毒——
  // 与上面 chosen.applyStatusOnHit（若该攻击本身也带状态）叠加，不互斥、不去重（§2.2 纯堆叠约定）。
  // 外移进 combat-affixes.ts（#298·守 file-budget）。
  s = applyVenomOnHit(s, enemy);

  return s;
}

// ——— 终局 ———

function allEnemiesDefeated(c: CombatState): boolean {
  return c.enemies.every((e) => e.hp <= 0);
}

/**
 * effectiveLoot：水鬼 loot 变体解析（纯函数·无副作用·可单测）。
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

  // The Warren 胜利态回写（破封口墙→wallDown / 清空非女王卵室→存卵清零·§5/§8·外移守 file-budget·见 combat-warren.ts）。
  s = applyWarrenVictory(s);
  // 猩红暴君追猎波次推进（run 级·非机制层·见 scarlet-hunt.ts 头注）：胜利的 encounterId 命中当前波次 → scarletWave+1。
  s = applyScarletVictory(s);

  // 战利品（水鬼按 wornSkin 替换 loot·普通敌人 effectiveLoot 恒回 def.loot ⇒ 逐字节不变）
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

  // 跳转：水鬼玩家尸体战斗 → 回 corpse subPhase 让玩家仍可打捞；普通战斗 → 旧路由。
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
  // 水鬼玩家尸体战斗：脱战后仍可回 corpse subPhase 打捞；普通脱战 → rest。
  if (sourceCorpseId) {
    s = { ...s, phase: { kind: 'dive', subPhase: { kind: 'corpse', deathRecordId: sourceCorpseId } } };
  } else {
    s = { ...s, phase: { kind: 'dive', subPhase: { kind: 'rest' } } };
  }
  return { state: s, outcome: 'flee' };
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
