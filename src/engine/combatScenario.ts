// 战斗回归测试框架 —— 纯引擎层 API（无 UI 依赖）
//
// 目的：调战斗平衡（HP / 伤害 / AI 撤退阈值 / 玩家行动消耗）时，给定一个 combatId（或一组
// 自定义敌人）+ 自定义 player state + RNG seed + 玩家行动序列，能跑通该战斗并产出每回合的
// 全部 diff。绕开"必须从港口出海 → 抽到目标事件 → 触发战斗"的链路。
//
// 设计原则（与 eventScenario.ts 同源套路）：
//   1. 不复刻 combat.ts 的内部逻辑（reducer / AI / 撤退阈值 / loot），全部复用。
//   2. 复用 eventScenario.ts 的 withSeededRandom——quirk #22 已立规矩，不发明新机制。
//   3. 战斗边界：碰到 victory / defeat / flee / emergency_ascend / 回合数上限 / 行动用完 → 停步，
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
  Stat,
  CombatLogEntry,
  CombatAction,
  EnemyDef,
  EnemyInstance,
  EnemyStance,
  EnemyStatus,
  EnemyAttack,
  EnemyTier,
  Hostility,
  VictoryPath,
  LootEntry,
  InventoryItem,
  EquipmentLoadout,
  ActiveInjury,
} from '../types';

import {
  createInitialGameState,
  createNewRun,
  createStarterLoadout,
} from './state';
import { seedInjuries } from './injuries';
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
import { withSeededRandom } from './eventScenario';

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

  /** 起始 stats 覆写（默认满状态：stamina=staminaMax, oxygen=oxygenMax, sanity=100, nitrogen=0） */
  stats?: Partial<Stats>;
  /** 起始装备覆写（默认 createStarterLoadout()） */
  equipment?: Partial<EquipmentLoadout>;
  /** 起始 inventory（默认空） */
  inventory?: InventoryItem[];
  /**
   * 起始伤势铺设（负伤 SPEC §10 baseline 用·经 injuries.ts::seedInjuries 单点落库）。
   * 缺省＝无伤。quirk #106 注意：fixture 要么写全这个 key 要么别写——显式 undefined 与缺省同义
   * （这里用 if 守护不用展开，不会盖种子），但别依赖这一点养成习惯。
   */
  injuries?: ActiveInjury[];
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
   * 尸衣者专属：开战时为带 skinLoot 的敌人指定穿戴皮囊 id（透传 startCombat 的 wornSkin·见 combat.ts）。
   * 缺省 → 该敌 def.defaultSkin；普通敌人忽略。baseline 用它钉定「皮囊→loot 变体」路径。
   */
  wornSkin?: string;
}

/** 战斗结束的原因（细化于 combat.ts 的 outcome） */
export type CombatScenarioOutcome =
  | 'victory'              // 全敌人 hp ≤ 0
  | 'defeat'               // 玩家死亡（窒息 / 失血 / 理智崩溃）
  | 'flee'                 // 屏息潜逃成功
  | 'emergency_ascend'     // 应急上浮
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
  statuses: EnemyStatus[];
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
  outcome: 'continue' | 'victory' | 'flee' | 'defeat' | 'emergency_ascend';
}

/** 整局战斗 scenario 的最终汇总 */
export interface CombatScenarioSummary {
  outcome: CombatScenarioOutcome;
  turnsElapsed: number;
  finalHp: number;
  finalOxygen: number;
  finalSanity: number;
  finalNitrogen: number;
  /** 玩家 stats 起→终 delta */
  statsDelta: Partial<Stats>;
  /** 战利品（inventory diff，胜利时会有，其它情况通常为空） */
  lootGained: InventoryItem[];
  /** 战斗剩余 enemies（还有 hp > 0 的） */
  enemiesAlive: EnemySnapshot[];
  /** 战斗结束时所有 enemies（含死的）的最终切片 */
  enemiesFinal: EnemySnapshot[];
  /** 战斗结束时身上的伤（负伤 SPEC §10 baseline 断言用：受伤/升档走到哪一档） */
  injuriesFinal: ActiveInjury[];
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
// 初始 state 构造
// ---------------------------------------------------------------------------

function buildEquipment(override: Partial<EquipmentLoadout> | undefined): EquipmentLoadout {
  const base = createStarterLoadout();
  if (!override) return base;
  // 9 槽起改用 spread：base 含全 9 槽、override 只含已覆写键（不含显式 undefined）＝加新槽不必动这里。
  return { ...base, ...override };
}

function buildInitialState(input: CombatScenarioInput): GameState {
  const base = createInitialGameState();

  // ----- profile -----
  const profile = {
    ...base.profile,
    unlockedUpgrades: new Set(input.unlockedUpgrades ?? []),
  };

  // ----- run -----
  const zoneId = input.zoneId ?? 'zone.old_lighthouse_reef';
  let run: RunState = createNewRun({ zoneId });
  if (input.depth !== undefined) run.currentDepth = input.depth;
  run.equipment = buildEquipment(input.equipment);
  run.inventory = (input.inventory ?? []).map((i) => ({ ...i }));
  // 起始伤势（负伤 baseline 用）：走 injuries.ts 的 fixture 单点，不直写 run.injuries
  if (input.injuries) run = seedInjuries(run, input.injuries);

  const defaultStats: Stats = {
    stamina: run.staminaMax,
    oxygen: run.oxygenMax,
    sanity: 100,
    nitrogen: 0,
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
function startAdHocCombat(state: GameState, enemyDefIds: string[], wornSkin?: string): GameState | null {
  if (!state.run) return null;
  const enemies: EnemyInstance[] = [];
  for (let idx = 0; idx < enemyDefIds.length; idx++) {
    const def = getEnemyDef(enemyDefIds[idx]);
    if (!def) return null;
    const inst: EnemyInstance = {
      instanceId: `adhoc.${idx}`,
      defId: def.id,
      hp: def.hp,
      sanityHp: def.sanityHp,
      stance: def.initialStance,
      aggro: def.threat,
      statuses: [],
    };
    // 尸衣者：与 startCombat 同口径——仅带 skinLoot 的敌人记 wornSkin（缺省 defaultSkin）·普通敌人形状不变。
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
      },
    },
  };
}

// ---------------------------------------------------------------------------
// 工具：snapshot 与 diff
// ---------------------------------------------------------------------------

function snapshotEnemies(state: GameState): EnemySnapshot[] {
  if (state.phase.kind !== 'combat') return [];
  return state.phase.combat.enemies.map((e) => {
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
    };
  });
}

/** 终局态："胜利后" combat 不在 state 里了——用最后一次 combat 快照衍生 */
function deriveTerminalEnemiesSnapshot(
  preTurn: EnemySnapshot[],
  outcome: CombatTurnSnapshot['outcome'],
): EnemySnapshot[] {
  if (outcome === 'victory') {
    return preTurn.map((e) => ({ ...e, hp: 0, stance: 'unaware' as EnemyStance, statuses: [] }));
  }
  // flee / defeat / emergency_ascend：state.phase 已不是 combat，用 preTurn 的最后切片
  return preTurn.map((e) => ({ ...e }));
}

function diffStats(before: Stats, after: Stats): Partial<Stats> {
  const out: Partial<Stats> = {};
  const keys: Stat[] = ['stamina', 'oxygen', 'sanity', 'nitrogen'];
  for (const k of keys) {
    const d = after[k] - before[k];
    if (Math.abs(d) > 1e-9) out[k] = Number(d.toFixed(4));
  }
  return out;
}

function diffInventory(before: InventoryItem[], after: InventoryItem[]): InventoryItem[] {
  const beforeMap = new Map(before.map((i) => [i.itemId, i.qty]));
  const out: InventoryItem[] = [];
  for (const item of after) {
    const prev = beforeMap.get(item.itemId) ?? 0;
    const delta = item.qty - prev;
    if (delta > 0) out.push({ itemId: item.itemId, qty: delta });
  }
  return out;
}

// ---------------------------------------------------------------------------
// 主执行
// ---------------------------------------------------------------------------

function emptyStats(): Stats {
  return { stamina: 0, oxygen: 0, sanity: 0, nitrogen: 0 };
}

function makeEmptySummary(reason: CombatScenarioOutcome, state: GameState): CombatScenarioSummary {
  const stats = state.run?.stats ?? emptyStats();
  return {
    outcome: reason,
    turnsElapsed: 0,
    finalHp: stats.stamina,
    finalOxygen: stats.oxygen,
    finalSanity: stats.sanity,
    finalNitrogen: stats.nitrogen,
    statsDelta: {},
    lootGained: [],
    enemiesAlive: [],
    enemiesFinal: [],
    injuriesFinal: snapshotInjuries(state),
    finalPhase: state.phase.kind,
    survived: true,
  };
}

/** 终局伤势快照（深拷贝防外部改动；写路径全在 injuries.ts，此处只读） */
function snapshotInjuries(state: GameState): ActiveInjury[] {
  return (state.run?.injuries ?? []).map((i) => ({ ...i }));
}

export function runCombatScenario(input: CombatScenarioInput): CombatScenarioResult {
  const errors: string[] = [];

  // ----- 输入校验 -----
  if (!input.combatId && !input.enemyDefIds) {
    const s = buildInitialState(input);
    return {
      input,
      resolvedInitialState: s,
      turns: [],
      summary: makeEmptySummary('invalidCombatId', s),
      errors: ['必须提供 combatId 或 enemyDefIds 之一'],
    };
  }
  if (input.combatId && input.enemyDefIds) {
    const s = buildInitialState(input);
    return {
      input,
      resolvedInitialState: s,
      turns: [],
      summary: makeEmptySummary('invalidCombatId', s),
      errors: ['combatId 与 enemyDefIds 不能同时提供'],
    };
  }

  // ----- 初始 state -----
  let state = buildInitialState(input);
  const resolvedInitialState: GameState = state;
  const startStats: Stats = { ...state.run!.stats };
  const startInventory: InventoryItem[] = state.run!.inventory.map((i) => ({ ...i }));

  // ----- 进入战斗 -----
  if (input.combatId) {
    const enc = getEncounter(input.combatId);
    if (!enc) {
      return {
        input,
        resolvedInitialState,
        turns: [],
        summary: makeEmptySummary('invalidCombatId', state),
        errors: [`combatId "${input.combatId}" 未在 COMBAT_ENCOUNTERS 中找到`],
      };
    }
    // 校验每个 member 可解析（defId 已注册 或 enemyRef 至少匹配一只·不掷 RNG）
    for (const m of enc.party.members) {
      if (!canResolveMember(m)) {
        return {
          input,
          resolvedInitialState,
          turns: [],
          summary: makeEmptySummary('invalidEnemyDef', state),
          errors: [`combat "${input.combatId}" 的 party 成员无法解析：${JSON.stringify(m)}`],
        };
      }
    }
    // 敌人库 SPEC §4：enemyRef 成员经 pickEnemy 取一只——pick 会掷一次 Math.random，必须落在
    // seeded 窗口内，否则当 enemyRef 匹配多于一只敌人时 baseline 不可复现（此前 startCombat 在
    // seeded 块外·见 enemyLibrary 注释）。defId 成员零 Math.random 消耗，故现有 defId 战斗 baseline
    // 逐字节不变；下方回合循环另起的 withSeededRandom(seed) 各自从 seed 重置 LCG，turn RNG 流不受影响。
    withSeededRandom(input.seed, () => {
      state = startCombat(
        state,
        input.combatId!,
        undefined,
        input.wornSkin !== undefined ? { wornSkin: input.wornSkin } : undefined,
      );
    });
  } else if (input.enemyDefIds) {
    for (const id of input.enemyDefIds) {
      if (!getEnemyDef(id)) {
        return {
          input,
          resolvedInitialState,
          turns: [],
          summary: makeEmptySummary('invalidEnemyDef', state),
          errors: [`enemyDefId "${id}" 未注册`],
        };
      }
    }
    const next = startAdHocCombat(state, input.enemyDefIds, input.wornSkin);
    if (!next) {
      return {
        input,
        resolvedInitialState,
        turns: [],
        summary: makeEmptySummary('invalidEnemyDef', state),
        errors: ['ad-hoc encounter 构造失败（无 run 或 enemyDef 缺失）'],
      };
    }
    state = next;
  }

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

      const avail = checkActionAvailability(state, action);
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
      if (result.outcome === 'emergency_ascend') {
        finalOutcome = 'emergency_ascend';
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
    finalHp: finalStats.stamina,
    finalOxygen: finalStats.oxygen,
    finalSanity: finalStats.sanity,
    finalNitrogen: finalStats.nitrogen,
    statsDelta: diffStats(startStats, finalStats),
    lootGained,
    enemiesAlive,
    enemiesFinal,
    injuriesFinal: snapshotInjuries(state),
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
  armor: number;
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
}

export interface EnemyAttackSummary {
  id: string;
  name: string;
  damage: [number, number];
  sanityDamage?: [number, number];
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
      armor: def.armor,
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
    sanityDamage: a.sanityDamage,
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
    case 'defend':
      return `defend reduce=${(eff.damageReduction * 100).toFixed(0)}% turns=${eff.turns}`;
    case 'recover':
      return `recover ${Object.entries(eff.deltas)
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
    case 'ambush':
      return `ambush nextMul=${eff.nextAttackMultiplier}`;
  }
}

// ---------------------------------------------------------------------------
// re-export withSeededRandom（方便外部一处 import）
// ---------------------------------------------------------------------------

export { withSeededRandom } from './eventScenario';
