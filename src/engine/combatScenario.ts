// 战斗回归测试框架 —— 纯引擎层 API（无 UI 依赖）
//
// 目的：调战斗平衡（HP / 伤害 / AI 撤退阈值 / 玩家行动消耗）时，给定一个 combatId（或一组
// 自定义敌人）+ 自定义 player state + RNG seed + 玩家行动序列，能跑通该战斗并产出每回合的
// 全部 diff。绕开"必须从港口出海 → 抽到目标事件 → 触发战斗"的链路。
//
// 设计原则（与 eventScenario.ts 同源套路）：
//   1. 不复刻 combat.ts 的内部逻辑（reducer / AI / 撤退阈值 / loot），全部复用。
//   2. 复用 scenarioShared.ts 的 withSeededRandom / diff helper——quirk #22 已立规矩，不发明新机制。
//   3. 战斗边界：碰到 victory / defeat / flee / 回合数上限 / 行动用完 → 停步，
//      不进入战斗外的事件链路（"AI 联动事件"不是这一层的事）。
//   4. input.actions[i] = { actionId, targetIndex? }。targetIndex 是 enemies 数组下标（不是 instanceId），
//      因为外部调用方（dev 面板 / scenarios JSON / CLI）不应该感知 instanceId 命名约定。
//   5. 这套 API 之后被 CombatDevPanel 复用，所以保持纯净，不引 UI / 不引 console / 不引 fs。
//
// 详见 docs/STATUS.md "战斗回归框架（Phase 3）" 一节。

import type {
  GameState,
  RunState,
  Stats,
  CombatLogEntry,
  CombatAction,
  EnemyDef,
  EnemyInstance,
  EnemyStance,
  StatusInstance,
  EnemyAttack,
  EnemyTier,
  Hostility,
  VictoryPath,
  LootEntry,
  InventoryItem,
  EquipmentLoadout,
} from '../types';

import {
  createInitialGameState,
  createNewRun,
} from './state';
import {
  applyPlayerAction,
  checkActionAvailability,
  getAction,
  getEnemyDef,
  getEncounter,
  listActions,
  listAllEnemyDefs,
  listAllEncounters,
  startCombat,
} from './combat';
import { canResolveMember } from './enemyLibrary';
import { isSegmentReachable } from './chain-eel';
import {
  withSeededRandom,
  diffStats,
  diffInventory,
  buildEquipment,
} from './scenarioShared';

// ---------------------------------------------------------------------------
// 输入 / 输出类型
// ---------------------------------------------------------------------------

/** 单回合玩家行动。targetIndex 是当回合"未阵亡敌人"列表的下标（按 enemies 数组原序）。 */
export interface CombatActionInput {
  actionId: string;
  targetIndex?: number;
}

export interface CombatScenarioInput {
  /** 引用 enemies/*.json 的 combat.* id；与 enemyDefIds 互斥。 */
  combatId?: string;
  /** ad-hoc encounter：直接列出 EnemyDef.id（不用注册）。与 combatId 互斥。 */
  enemyDefIds?: string[];

  /** 起始 stats 覆写（默认满状态：stamina=staminaMax, oxygen=oxygenMax, nitrogen=0） */
  stats?: Partial<Stats>;
  /** 起始装备覆写（默认 createStarterLoadout()） */
  equipment?: Partial<EquipmentLoadout>;
  /** 起始 inventory（默认空） */
  inventory?: InventoryItem[];
  /** profile.unlockedUpgrades 起始集合 */
  unlockedUpgrades?: string[];
  /** 起始 zoneId（影响 run.zoneId，对战斗本身无副作用） */
  zoneId?: string;
  /** 起始 depth */
  depth?: number;

  /** RNG 种子；缺省用真随机 */
  seed?: number;
  /** 回合上限，防失控；默认 30 */
  maxTurns?: number;
  /** 每回合玩家行动；i ≥ actions.length 时停步 */
  actions?: CombatActionInput[];

  /**
   * 水鬼专属：开战时为带 skinLoot 的敌人指定穿戴皮囊 id（透传 startCombat 的 wornSkin·见 combat.ts）。
   * 缺省 → 该敌 def.defaultSkin；普通敌人忽略。baseline 用它钉定「皮囊→loot 变体」路径。
   */
  wornSkin?: string;
  /**
   * The Warren 背水一战（蜂群 boss SPEC §4·透传 startCombat 的 warrenLastStand）：把本场标为「女王无处可退」
   * ⇒ 禁撤 + 崩解取胜可落地 + 繁殖储备零恢复。真实玩法从 `warrenHunt.roomsCleared>=2` 派生；baseline 用本项
   * 直接构造，**不动 roomsCleared**（否则连带抬高产卵上限、改变既有 baseline 输出）。缺省 ⇒ 逐字节不变。
   */
  warrenLastStand?: boolean;
  /**
   * createNewRun bonuses 透传（staminaMaxBonus / oxygenMaxBonus / hpMaxBonus 等）。
   * 主要用途：boss 战 baseline 需要超过默认上限的生存力——hpMaxBonus 抬 HP 上限（战斗系统改版 2026-07-10：
   * 伤害落 HP·boss 长战靠它撑住），staminaMaxBonus 抬体力上限（行动预算·长脚本别中途没力气行动）。
   * 缺省 → 无加成（hpMax=100 / staminaMax=100 / oxygenMax 默认值）。
   */
  bonuses?: {
    staminaMaxBonus?: number;
    oxygenMaxBonus?: number;
    hpMaxBonus?: number;
  };
}

/** 战斗结束的原因（细化于 combat.ts 的 outcome） */
export type CombatScenarioOutcome =
  | 'victory'              // 全敌人 hp ≤ 0
  | 'defeat'               // 玩家死亡（窒息 / 失血）
  | 'flee'                 // 屏息潜逃成功
  | 'maxTurns'             // 达到 maxTurns 上限，未分出胜负
  | 'noActionProvided'     // actions 用完
  | 'actionUnavailable'    // 给定 action 不可用（资源不足/装备缺失），战斗中止扫描
  | 'invalidActionId'      // actionId 不存在
  | 'invalidCombatId'      // combatId 找不到 encounter
  | 'invalidEnemyDef';     // ad-hoc enemyDefIds 含未注册的 def

/** 敌人在战斗某一刻的状态切片 */
export interface EnemySnapshot {
  instanceId: string;
  defId: string;
  name: string;
  hp: number;
  hpMax: number;
  stance: EnemyStance;
  aggro: number;
  statuses: StatusInstance[];
  /**
   * boss 阶段：当前已触发的最高阶段索引（= CombatState.bossPhaseIndices[instanceId]）。
   * -1 = 尚未进入任何阶段 / 非 boss。配合 phaseCount 在预览里标「进入阶段 N / 共 M」。
   */
  phaseIndex: number;
  /** 该敌 def.phases 的阶段数（0 = 非 boss/miniboss）。让 UI 不必回查 def 即可显示「共 M 阶段」。 */
  phaseCount: number;
  /**
   * 当前是否可被单体攻击命中：attackInOrder（链鳗分节）遭遇 = 是否「最前存活节」；
   * 普通遭遇 = hp > 0。供按序门可视化（actions 编辑器禁用非最前节）与实战目标提示。
   */
  reachable: boolean;
}

/** 单回合产出的 diff */
export interface CombatTurnSnapshot {
  turnIndex: number; // 0-based, 与 actions[] 下标对齐

  /** 玩家选择 */
  actionId: string;
  actionName: string;
  /** 实际打到的敌人 instanceId（如果 action 是 single 攻击且有目标） */
  targetInstanceId?: string;
  targetName?: string;

  /** 行动可用性（不可用时该回合不应用，scenario 停步） */
  available: boolean;
  unavailableReason?: string;

  /** 本回合产生的所有 log 条目（player + enemy + system） */
  log: CombatLogEntry[];
  /** 玩家本回合 stats 的 delta */
  playerStatsDelta: Partial<Stats>;
  /** 本回合结束时玩家 stats（绝对值） */
  playerStatsAfter: Stats;
  /** 本回合结束时所有敌人状态切片（包括已死的，用于 UI 展示 HP 0） */
  enemiesAfter: EnemySnapshot[];

  /** 引擎吐回的 outcome（与 applyPlayerAction 一致） */
  outcome: 'continue' | 'victory' | 'flee' | 'defeat';
}

/** 整局战斗 scenario 的最终汇总 */
export interface CombatScenarioSummary {
  outcome: CombatScenarioOutcome;
  turnsElapsed: number;
  finalHp: number;
  finalOxygen: number;
  finalNitrogen: number;
  /** 玩家 stats 起→终 delta */
  statsDelta: Partial<Stats>;
  /** 战利品（inventory diff，胜利时会有，其它情况通常为空） */
  lootGained: InventoryItem[];
  /** 战斗剩余 enemies（还有 hp > 0 的） */
  enemiesAlive: EnemySnapshot[];
  /** 战斗结束时所有 enemies（含死的）的最终切片 */
  enemiesFinal: EnemySnapshot[];
  /** 引擎吐回的最终 phase.kind */
  finalPhase: string;
  survived: boolean;
}

export interface CombatScenarioResult {
  input: CombatScenarioInput;
  /** 解析完成、即将开跑的初始 state 快照 */
  resolvedInitialState: GameState;
  turns: CombatTurnSnapshot[];
  summary: CombatScenarioSummary;
  errors: string[];
}

// ---------------------------------------------------------------------------
// 初始 state 构造（buildEquipment 共用件在 scenarioShared.ts）
// ---------------------------------------------------------------------------

function buildInitialState(input: CombatScenarioInput): GameState {
  const base = createInitialGameState();

  // ----- profile -----
  const profile = {
    ...base.profile,
    unlockedUpgrades: new Set(input.unlockedUpgrades ?? []),
  };

  // ----- run -----
  const zoneId = input.zoneId ?? 'zone.old_lighthouse_reef';
  let run: RunState = createNewRun({ zoneId, bonuses: input.bonuses });
  if (input.depth !== undefined) run.currentDepth = input.depth;
  run.equipment = buildEquipment(input.equipment);
  run.inventory = (input.inventory ?? []).map((i) => ({ ...i }));

  const defaultStats: Stats = {
    hp: run.hpMax,
    stamina: run.staminaMax,
    oxygen: run.oxygenMax,
    nitrogen: 0,
    thermalStress: 0,
  };
  run.stats = { ...defaultStats, ...(input.stats ?? {}) };

  // phase 起步保持 port——战斗会用 startCombat 或 manualStart 切到 combat
  return {
    ...base,
    profile,
    run,
    phase: { kind: 'port' },
  };
}

/** ad-hoc encounter：手工合成一个 CombatState（不经 startCombat 注册） */
function startAdHocCombat(state: GameState, enemyDefIds: string[], wornSkin?: string, warrenLastStand?: boolean): GameState | null {
  if (!state.run) return null;
  const enemies: EnemyInstance[] = [];
  for (let idx = 0; idx < enemyDefIds.length; idx++) {
    const def = getEnemyDef(enemyDefIds[idx]);
    if (!def) return null;
    const inst: EnemyInstance = {
      instanceId: `adhoc.${idx}`,
      defId: def.id,
      hp: def.hp,
      stance: def.initialStance,
      aggro: def.threat,
      statuses: [],
    };
    // 水鬼：与 startCombat 同口径——仅带 skinLoot 的敌人记 wornSkin（缺省 defaultSkin）·普通敌人形状不变。
    if (def.skinLoot) {
      const worn = wornSkin ?? def.defaultSkin;
      if (worn !== undefined) inst.wornSkin = worn;
    }
    enemies.push(inst);
  }
  return {
    ...state,
    phase: {
      kind: 'combat',
      combat: {
        combatId: 'adhoc',
        encounterId: 'adhoc',
        enemies,
        reinforcementPool: undefined,
        playerStatuses: [],
        turn: 0,
        log: [],
        victoryEventId: undefined,
        resumeNodeId: state.run.currentNodeId,
        // The Warren 背水一战（§4）：adhoc fixture 显式构造；缺省不写 ⇒ 逐字节不变。
        ...(warrenLastStand ? { warrenLastStand: true as const } : {}),
      },
    },
  };
}

// ---------------------------------------------------------------------------
// 不变量
// ---------------------------------------------------------------------------

/**
 * 不变量：combat.enemies 的 instanceId 不得重复——撞号时 applyAttack 按 instanceId map 更新会
 * 一击打多只 + React key 冲突（历史根因：spawn 用 Date.now()+i 同毫秒批次必撞·已改 CombatState.spawnSeq）。
 * 每回合步进后与开战时各查一次；违反即 throw ⇒ 任何跑 scenario 的 playthrough 都会红（机制门）。
 */
function assertUniqueEnemyInstanceIds(state: GameState, where: string): void {
  if (state.phase.kind !== 'combat') return;
  const seen = new Set<string>();
  for (const e of state.phase.combat.enemies) {
    if (seen.has(e.instanceId)) {
      throw new Error(`combat 不变量违反（${where}）：enemies 里 instanceId 重复 "${e.instanceId}"`);
    }
    seen.add(e.instanceId);
  }
}

// ---------------------------------------------------------------------------
// 工具：snapshot 与 diff
// ---------------------------------------------------------------------------

function snapshotEnemies(state: GameState): EnemySnapshot[] {
  if (state.phase.kind !== 'combat') return [];
  const combat = state.phase.combat;
  const attackInOrder = combat.attackInOrder === true;
  return combat.enemies.map((e) => {
    const def = getEnemyDef(e.defId);
    return {
      instanceId: e.instanceId,
      defId: e.defId,
      name: def?.name ?? e.defId,
      hp: e.hp,
      hpMax: def?.hp ?? e.hp,
      stance: e.stance,
      aggro: e.aggro,
      statuses: e.statuses.map((s) => ({ ...s })),
      // boss 阶段索引（仅有 phases 的敌人在 bossPhaseIndices 里有条目·普通敌人 → -1）
      phaseIndex: combat.bossPhaseIndices?.[e.instanceId] ?? -1,
      phaseCount: def?.phases?.length ?? 0,
      // 按序门可视：链鳗只有最前存活节可打；普通遭遇任意活敌可打（与既有目标解析同义）
      reachable: attackInOrder ? isSegmentReachable(combat.enemies, e.instanceId) : e.hp > 0,
    };
  });
}

/** 终局态："胜利后" combat 不在 state 里了——用最后一次 combat 快照衍生 */
function deriveTerminalEnemiesSnapshot(
  preTurn: EnemySnapshot[],
  outcome: CombatTurnSnapshot['outcome'],
): EnemySnapshot[] {
  if (outcome === 'victory') {
    return preTurn.map((e) => ({ ...e, hp: 0, stance: 'unaware' as EnemyStance, statuses: [], reachable: false }));
  }
  // flee / defeat：state.phase 已不是 combat，用 preTurn 的最后切片
  return preTurn.map((e) => ({ ...e }));
}

// ---------------------------------------------------------------------------
// 主执行
// ---------------------------------------------------------------------------

function emptyStats(): Stats {
  return { hp: 0, stamina: 0, oxygen: 0, nitrogen: 0, thermalStress: 0 };
}

function makeEmptySummary(reason: CombatScenarioOutcome, state: GameState): CombatScenarioSummary {
  const stats = state.run?.stats ?? emptyStats();
  return {
    outcome: reason,
    turnsElapsed: 0,
    finalHp: stats.hp,
    finalOxygen: stats.oxygen,
    finalNitrogen: stats.nitrogen,
    statsDelta: {},
    lootGained: [],
    enemiesAlive: [],
    enemiesFinal: [],
    finalPhase: state.phase.kind,
    survived: true,
  };
}

/**
 * 「进入战斗」单一路径（runCombatScenario 与 buildCombatEntryState 共用）：
 *   校验输入 → buildInitialState → startCombat（注册遭遇）/ startAdHocCombat（ad-hoc）。
 * 抽出来＝「怎么开战」收口一处，免得批处理与实战两条入口各拼一份、日后悄悄漂。
 * 行为对批处理逐字节不变：校验顺序、buildInitialState 时机、startCombat 的 seeded 窗口都原样保留
 * （回合循环的另一个 withSeededRandom 仍留在 runCombatScenario·各自从 seed 重置 LCG）。
 */
type EnterCombatResult =
  | { ok: true; state: GameState; resolvedInitialState: GameState }
  | { ok: false; resolvedInitialState: GameState; reason: CombatScenarioOutcome; errors: string[] };

function enterCombat(input: CombatScenarioInput): EnterCombatResult {
  // ----- 输入校验 -----
  if (!input.combatId && !input.enemyDefIds) {
    const s = buildInitialState(input);
    return { ok: false, resolvedInitialState: s, reason: 'invalidCombatId', errors: ['必须提供 combatId 或 enemyDefIds 之一'] };
  }
  if (input.combatId && input.enemyDefIds) {
    const s = buildInitialState(input);
    return { ok: false, resolvedInitialState: s, reason: 'invalidCombatId', errors: ['combatId 与 enemyDefIds 不能同时提供'] };
  }

  // ----- 初始 state -----
  let state = buildInitialState(input);
  const resolvedInitialState: GameState = state;

  // ----- 进入战斗 -----
  if (input.combatId) {
    const enc = getEncounter(input.combatId);
    if (!enc) {
      return { ok: false, resolvedInitialState, reason: 'invalidCombatId', errors: [`combatId "${input.combatId}" 未在 COMBAT_ENCOUNTERS 中找到`] };
    }
    // 校验每个 member 可解析（defId 已注册 或 enemyRef 至少匹配一只·不掷 RNG）
    for (const m of enc.party.members) {
      if (!canResolveMember(m)) {
        return { ok: false, resolvedInitialState, reason: 'invalidEnemyDef', errors: [`combat "${input.combatId}" 的 party 成员无法解析：${JSON.stringify(m)}`] };
      }
    }
    // 敌人库 SPEC §4：enemyRef 成员经 pickEnemy 取一只——pick 会掷一次 Math.random，必须落在
    // seeded 窗口内，否则当 enemyRef 匹配多于一只敌人时 baseline 不可复现（此前 startCombat 在
    // seeded 块外·见 enemyLibrary 注释）。defId 成员零 Math.random 消耗，故现有 defId 战斗 baseline
    // 逐字节不变；回合循环另起的 withSeededRandom(seed) 各自从 seed 重置 LCG，turn RNG 流不受影响。
    // 只在 fixture 显式给了 wornSkin / warrenLastStand 时才传 options 对象（都没给 ⇒ 传 undefined ⇒ 逐字节不变）。
    const startOpts =
      input.wornSkin !== undefined || input.warrenLastStand !== undefined
        ? {
            ...(input.wornSkin !== undefined ? { wornSkin: input.wornSkin } : {}),
            ...(input.warrenLastStand !== undefined ? { warrenLastStand: input.warrenLastStand } : {}),
          }
        : undefined;
    withSeededRandom(input.seed, () => {
      state = startCombat(state, input.combatId!, startOpts);
    });
  } else if (input.enemyDefIds) {
    for (const id of input.enemyDefIds) {
      if (!getEnemyDef(id)) {
        return { ok: false, resolvedInitialState, reason: 'invalidEnemyDef', errors: [`enemyDefId "${id}" 未注册`] };
      }
    }
    const next = startAdHocCombat(state, input.enemyDefIds, input.wornSkin, input.warrenLastStand);
    if (!next) {
      return { ok: false, resolvedInitialState, reason: 'invalidEnemyDef', errors: ['ad-hoc encounter 构造失败（无 run 或 enemyDef 缺失）'] };
    }
    state = next;
  }

  return { ok: true, state, resolvedInitialState };
}

/** buildCombatEntryState 的产出：开战那一刻的 combat 相位 state（喂 CombatView）+ 进入前快照 + 错误。 */
export interface CombatEntryState {
  /** 已进入 combat 相位、可直接喂 <CombatView> 的 state；构造失败 → null（看 errors）。 */
  state: GameState | null;
  /** 进入前（port 相位）的初始 state 快照（loot diff 基线·与 runCombatScenario.resolvedInitialState 同义）。 */
  resolvedInitialState: GameState;
  errors: string[];
}

/**
 * 「实战预览」入口（dev 工作台战斗面板用）：复用 enterCombat 的同一条进入路径
 * （buildInitialState → startCombat / ad-hoc），但**只造到开战那一刻就停**、不跑回合循环——
 * 把 combat 相位 state 交给真实 <CombatView> 反应式地打（活的 RNG·像游戏内遭遇；seed 仅定 enemyRef 取样）。
 * phase 构造全留在引擎（守 check-boundaries 规则二：src/ui 不手搓 phase 字面量）。
 */
export function buildCombatEntryState(input: CombatScenarioInput): CombatEntryState {
  const entered = enterCombat(input);
  if (!entered.ok) {
    return { state: null, resolvedInitialState: entered.resolvedInitialState, errors: entered.errors };
  }
  assertUniqueEnemyInstanceIds(entered.state, '开战');
  return { state: entered.state, resolvedInitialState: entered.resolvedInitialState, errors: [] };
}

export function runCombatScenario(input: CombatScenarioInput): CombatScenarioResult {
  const errors: string[] = [];

  // ----- 进入战斗（与 buildCombatEntryState 共用 enterCombat 单一路径）-----
  const entered = enterCombat(input);
  if (!entered.ok) {
    return {
      input,
      resolvedInitialState: entered.resolvedInitialState,
      turns: [],
      summary: makeEmptySummary(entered.reason, entered.resolvedInitialState),
      errors: entered.errors,
    };
  }
  let state = entered.state;
  assertUniqueEnemyInstanceIds(state, '开战');
  const resolvedInitialState: GameState = entered.resolvedInitialState;
  const startStats: Stats = { ...state.run!.stats };
  const startInventory: InventoryItem[] = state.run!.inventory.map((i) => ({ ...i }));

  // ----- 跑回合 -----
  const turns: CombatTurnSnapshot[] = [];
  const actions = input.actions ?? [];
  const maxTurns = input.maxTurns ?? 30;
  // Cast to widen literal — TS 否则会把 finalOutcome 当字面量 'noActionProvided'，
  // 在 withSeededRandom 回调里的赋值不进入主控制流分析（quirk: callback narrowing）。
  let finalOutcome = 'noActionProvided' as CombatScenarioOutcome;

  withSeededRandom(input.seed, () => {
    for (let i = 0; i < maxTurns; i++) {
      if (state.phase.kind !== 'combat') break;
      const actionInput = actions[i];
      if (!actionInput) {
        finalOutcome = 'noActionProvided';
        break;
      }
      const action = getAction(actionInput.actionId);
      if (!action) {
        errors.push(`turn ${i}: action "${actionInput.actionId}" 不存在`);
        finalOutcome = 'invalidActionId';
        break;
      }

      // 解析 target：targetIndex 是 enemies 数组的下标（包含已死敌人下标，与 dev 面板渲染对齐）
      const preTurnEnemies = snapshotEnemies(state);
      let targetInstanceId: string | undefined;
      let targetName: string | undefined;
      if (
        action.targeting === 'single' &&
        actionInput.targetIndex !== undefined &&
        actionInput.targetIndex >= 0 &&
        actionInput.targetIndex < preTurnEnemies.length
      ) {
        const t = preTurnEnemies[actionInput.targetIndex];
        targetInstanceId = t.instanceId;
        targetName = t.name;
      } else if (action.targeting === 'single') {
        // 缺省目标 = 第一个活敌人
        const firstAlive = preTurnEnemies.find((e) => e.hp > 0);
        if (firstAlive) {
          targetInstanceId = firstAlive.instanceId;
          targetName = firstAlive.name;
        }
      }

      // 链鳗按序门：透传已解析的 targetInstanceId——指向非最前存活节的攻击 → actionUnavailable（停步）。
      // 既有无序遭遇 targetInstanceId 不触发按序门（checkActionAvailability 内守 attackInOrder）⇒ 逐字节不变。
      const avail = checkActionAvailability(state, action, targetInstanceId);
      if (!avail.available) {
        // 记一笔不可用回合，停步
        const enemiesAfter = preTurnEnemies;
        turns.push({
          turnIndex: i,
          actionId: actionInput.actionId,
          actionName: action.name,
          targetInstanceId,
          targetName,
          available: false,
          unavailableReason: avail.reason,
          log: [],
          playerStatsDelta: {},
          playerStatsAfter: { ...state.run!.stats },
          enemiesAfter,
          outcome: 'continue',
        });
        finalOutcome = 'actionUnavailable';
        break;
      }

      // —— 应用一回合 ——
      const beforeStats: Stats = { ...state.run!.stats };
      const beforeLogLen =
        state.phase.kind === 'combat' ? state.phase.combat.log.length : 0;

      const result = applyPlayerAction(state, actionInput.actionId, targetInstanceId);
      state = result.state;
      assertUniqueEnemyInstanceIds(state, `turn ${i} 步进后`); // 分裂/补蜂 spawn 都发生在行动内

      const afterStats: Stats = state.run ? { ...state.run.stats } : beforeStats;
      const turnLog: CombatLogEntry[] =
        state.phase.kind === 'combat'
          ? state.phase.combat.log.slice(beforeLogLen).map((l) => ({ ...l }))
          : // 战斗结束：从 state.phase.combat 拿不到 log；只能记录到引擎仅暴露的部分
            [];

      let enemiesAfter: EnemySnapshot[];
      if (state.phase.kind === 'combat') {
        enemiesAfter = snapshotEnemies(state);
      } else {
        enemiesAfter = deriveTerminalEnemiesSnapshot(preTurnEnemies, result.outcome);
      }

      turns.push({
        turnIndex: i,
        actionId: actionInput.actionId,
        actionName: action.name,
        targetInstanceId,
        targetName,
        available: true,
        log: turnLog,
        playerStatsDelta: diffStats(beforeStats, afterStats),
        playerStatsAfter: afterStats,
        enemiesAfter,
        outcome: result.outcome,
      });

      if (result.outcome === 'victory') {
        finalOutcome = 'victory';
        break;
      }
      if (result.outcome === 'flee') {
        finalOutcome = 'flee';
        break;
      }
      if (result.outcome === 'defeat') {
        finalOutcome = 'defeat';
        break;
      }
      // continue → 下一回合
    }

    // 如果跑完循环还在 combat（actions 还在但 maxTurns 到了），标 maxTurns
    if (
      finalOutcome === 'noActionProvided' &&
      turns.length >= maxTurns &&
      state.phase.kind === 'combat'
    ) {
      finalOutcome = 'maxTurns';
    }
  });

  // ----- summary -----
  const finalStats: Stats = state.run?.stats ?? startStats;
  const finalInventory: InventoryItem[] = state.run?.inventory ?? startInventory;
  const lootGained = diffInventory(startInventory, finalInventory);

  // 终局态的 enemies：state.phase 可能不是 combat 了，需要拿"最后一回合的快照"
  const lastTurn = turns[turns.length - 1];
  const enemiesFinal: EnemySnapshot[] = lastTurn ? lastTurn.enemiesAfter : snapshotEnemies(state);
  const enemiesAlive = enemiesFinal.filter((e) => e.hp > 0);

  const summary: CombatScenarioSummary = {
    outcome: finalOutcome,
    turnsElapsed: turns.length,
    finalHp: finalStats.hp,
    finalOxygen: finalStats.oxygen,
    finalNitrogen: finalStats.nitrogen,
    statsDelta: diffStats(startStats, finalStats),
    lootGained,
    enemiesAlive,
    enemiesFinal,
    finalPhase: state.phase.kind,
    survived: finalOutcome !== 'defeat',
  };

  return {
    input,
    resolvedInitialState,
    turns,
    summary,
    errors,
  };
}

// ---------------------------------------------------------------------------
// 列表 / 描述 API
// ---------------------------------------------------------------------------

export interface EnemyListEntry {
  id: string;
  name: string;
  tier: EnemyTier;
  hp: number;
  defense: number;
  threat: number;
  hostility: Hostility;
  attackCount: number;
}

export interface CombatListEntry {
  id: string;
  memberCount: number;
  memberDefIds: string[];
  victoryEventId?: string;
  introText?: string;
  /** 链鳗（分节实体）：本遭遇是否「按序攻击」分节链（enc.attackInOrder）。供面板标记 + 目标禁用。 */
  attackInOrder?: boolean;
}

export interface EnemyAttackSummary {
  id: string;
  name: string;
  damage: [number, number];
  damageType: string;
  weight: number;
  description: string;
}

export interface EnemyDescription {
  def: EnemyDef;
  attackSummary: EnemyAttackSummary[];
  victoryConditions: VictoryPath[];
  loot: { guaranteed: LootEntry[]; rolls: LootEntry[]; rollCount: number };
  /** 主动撤退阈值描述（territorial / passive 类敌人 hp ≤ 30% 时 50% 撤退） */
  fleeThresholdDescription: string;
}

export interface ActionDescription {
  action: CombatAction;
  /** 一行的"效果概要"，渲染给 dev 面板的左栏 */
  effectSummary: string;
}

export function listAllCombats(): CombatListEntry[] {
  const out: CombatListEntry[] = [];
  for (const enc of listAllEncounters()) {
    out.push({
      id: enc.id,
      memberCount: enc.party.members.length,
      memberDefIds: enc.party.members.map((m) => m.defId ?? `<ref:${m.enemyRef?.band ?? '?'}>`),
      victoryEventId: enc.victoryEventId,
      introText: enc.introText,
      ...(enc.attackInOrder ? { attackInOrder: true as const } : {}),
    });
  }
  out.sort((a, b) => a.id.localeCompare(b.id));
  return out;
}

export function listAllEnemies(): EnemyListEntry[] {
  const out: EnemyListEntry[] = [];
  for (const def of listAllEnemyDefs()) {
    out.push({
      id: def.id,
      name: def.name,
      tier: def.tier,
      hp: def.hp,
      defense: def.defense,
      threat: def.threat,
      hostility: def.hostility,
      attackCount: def.attacks.length,
    });
  }
  out.sort((a, b) => a.id.localeCompare(b.id));
  return out;
}

export function listAllActions(): CombatAction[] {
  return listActions();
}

export function describeEnemy(enemyId: string): EnemyDescription | null {
  const def = getEnemyDef(enemyId);
  if (!def) return null;
  const attackSummary: EnemyAttackSummary[] = def.attacks.map((a: EnemyAttack) => ({
    id: a.id,
    name: a.name,
    damage: a.damage,
    damageType: a.damageType,
    weight: a.weight ?? 1,
    description: a.description,
  }));
  const flees =
    def.victoryConditions.includes('flee') &&
    (def.hostility === 'territorial' || def.hostility === 'passive')
      ? `hp ≤ 30% 时 50% 概率撤退（hostility=${def.hostility}）`
      : '无主动撤退（hostility=' + def.hostility + '）';
  return {
    def,
    attackSummary,
    victoryConditions: def.victoryConditions,
    loot: {
      guaranteed: def.loot.guaranteed ?? [],
      rolls: def.loot.rolls,
      rollCount: def.loot.rollCount,
    },
    fleeThresholdDescription: flees,
  };
}

export function describeAction(actionId: string): ActionDescription | null {
  const action = getAction(actionId);
  if (!action) return null;
  return {
    action,
    effectSummary: summarizeEffect(action),
  };
}

function summarizeEffect(a: CombatAction): string {
  const eff = a.effect;
  switch (eff.kind) {
    case 'attack':
      return `attack[${eff.damageType}] dmg=${eff.damage[0]}-${eff.damage[1]} noise=${eff.noise ?? 0}`;
    case 'recover':
      return `recover ${Object.entries(eff.deltas ?? {})
        .map(([k, v]) => `${k}${(v as number) >= 0 ? '+' : ''}${v}`)
        .join(',')}`;
    case 'flee':
      return `flee base=${(eff.baseChance * 100).toFixed(0)}% failExposure=${eff.failExposure}`;
    case 'crowd_control':
      return `crowdControl threatΔ=${eff.threatDelta ?? 0}${
        eff.applyStatusToAll ? ` status=${eff.applyStatusToAll.kind}×${eff.applyStatusToAll.turns}` : ''
      }`;
    case 'use_item':
      return `useItem requires=${a.requiresItemId ?? '?'}`;
  }
}

// ---------------------------------------------------------------------------
// re-export withSeededRandom（方便外部一处 import）
// ---------------------------------------------------------------------------

export { withSeededRandom } from './eventScenario';
