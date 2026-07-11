// 事件回归测试框架 —— 纯引擎层 API（无 UI 依赖）
//
// 目的：给定一个 eventId + 自定义的起始 state，跑通该事件（及其 triggerEventId 链），
// 在不需要让 mapgen "刚好" 抽到目标事件的情况下测试事件分支。
//
// 设计原则：
//   1. 不复刻 events.ts / zones.ts / items.ts 已有的逻辑（resolveOption / isOptionVisible /
//      evalCondition / getEventById / getItemDef），全部复用。
//   2. RNG 可 seed：用 withSeededRandom 临时 patch 全局 Math.random（因为 performCheck / loot /
//      mapgen / death 多处直接调 Math.random，patch 全局比改每个调用点干净）。
//   3. 战斗边界：遇 triggerCombatId 不自动打，记录 "would trigger combat X" 后停步。
//   4. visibleIf 严格生效，但同时把不可见选项也列出来并标明被哪个 Condition 挡住——这是调
//      visibleIf 时的核心需求。
//   5. 这套 API 之后会被 Phase 2 的网页 dev 面板复用，所以保持纯净，不引 UI / 不引 console。
//
// 详见 docs/STATUS.md "事件回归框架" 一节。

import type {
  GameState,
  RunState,
  Stats,
  Stat,
  Tone,
  DiveEvent,
  EventOption,
  Condition,
  InventoryItem,
  EquipmentLoadout,
} from '../types';

import {
  createInitialGameState,
  createNewRun,
} from './state';
import {
  withSeededRandom,
  diffStats,
  diffInventory,
  buildEquipment,
} from './scenarioShared';
import {
  isOptionVisible,
  resolveOption,
} from './events';
import { getEventById, EVENT_DB } from './zones';

// ---------------------------------------------------------------------------
// 公共类型
// ---------------------------------------------------------------------------

export interface ScenarioInput {
  /** 起始事件 id */
  eventId: string;
  /** 覆写 stats（默认满状态：stamina/oxygen 取 staminaMax/oxygenMax，nitrogen=0） */
  stats?: Partial<Stats>;
  /** 起始 inventory（默认空） */
  inventory?: InventoryItem[];
  /** 起始装备（默认 createStarterLoadout()） */
  equipment?: Partial<EquipmentLoadout>;
  /** profile.flags */
  profileFlags?: string[];
  /** run.activeFlags */
  runFlags?: string[];
  /** profile.unlockedUpgrades */
  unlockedUpgrades?: string[];
  /** profile.loreEntries 起始集合 */
  loreEntries?: string[];
  /** profile.bankedGold 起始值 */
  bankedGold?: number;
  /** 起始 zoneId（默认根据 eventId zoneTags 推断，cave→zone.blue_caves，其它→zone.old_lighthouse_reef） */
  zoneId?: string;
  /** 起始 depth（默认事件 depthRange[0]） */
  depth?: number;
  /** 每一步选哪个 option.id；缺省或 undefined 时该步结束扫描 */
  choices?: string[];
  /** RNG 种子（数值），缺省时用真随机 Math.random */
  seed?: number;
  /**
   * 链路模式：
   *   - 'follow'：遇到 outcome.triggerEventId 自动续上下一个事件（默认）
   *   - 'isolated'：只跑当前事件这一步，不跟链
   */
  chain?: 'isolated' | 'follow';
  /** 步数上限，防失控；默认 10 */
  maxSteps?: number;
}

export interface VisibleOption {
  id: string;
  label: string;
  hasCheck: boolean;
  checkInfo?: { stat: Stat; dc: number; estimatedSuccessRate: number };
}

export interface HiddenOption {
  id: string;
  label: string;
  /** 人类可读的"被什么挡住"说明 */
  blockedBy: string;
}

export type ScenarioNext =
  | { kind: 'continueEvent'; eventId: string }
  | { kind: 'forceAscend' }
  | { kind: 'death' }
  | { kind: 'startCombat'; combatId: string }
  | { kind: 'remainOnEvent' }
  | {
      kind: 'end';
      reason:
        | 'noChoiceProvided'
        | 'optionNotVisible'
        | 'chainExhausted'
        | 'isolated'
        | 'maxSteps';
    };

export interface ScenarioStep {
  stepIndex: number;
  eventId: string;
  eventTitle: string;
  eventTone: Tone;
  eventBody: string;
  visibleOptions: VisibleOption[];
  hiddenOptions: HiddenOption[];
  chosenId: string | null;
  /** 仅在该步执行了 SkillCheck 时有值 */
  checkResult?: {
    stat: Stat;
    dc: number;
    rate: number;
    roll: number;
    passed: boolean;
  };
  narrative: string[];
  deltas: {
    stats: Partial<Stats>;
    inventoryAdded: InventoryItem[];
    flagsAdded: string[];
    goldDelta: number;
    loreAdded: string[];
  };
  next: ScenarioNext;
}

export interface ScenarioResult {
  input: ScenarioInput;
  /** 状态覆写解析完成、准备开跑的 state，方便外部 introspect */
  resolvedInitialState: GameState;
  steps: ScenarioStep[];
  summary: {
    statsDelta: Partial<Stats>;
    inventoryGained: InventoryItem[];
    profileFlagsAdded: string[];
    runFlagsAdded: string[];
    bankedGoldDelta: number;
    loreAdded: string[];
    /** 第一个被触发的战斗 id（如有） */
    combatTriggered?: string;
    /** 玩家是否还活着 */
    survived: boolean;
    /** 最终 phase.kind（dive / ascent / gameOver / port / ...） */
    finalPhase: string;
  };
  errors: string[];
}

// ---------------------------------------------------------------------------
// RNG patch（本体迁 scenarioShared.ts·此处 re-export 保住既有 import 面）
// ---------------------------------------------------------------------------

export { withSeededRandom } from './scenarioShared';

// ---------------------------------------------------------------------------
// Condition 人类可读化
// ---------------------------------------------------------------------------

export function describeCondition(c: Condition): string {
  switch (c.kind) {
    case 'hasEquipment':
      return c.actionId ? `需要装备槽位 ${c.slot}（解锁 ${c.actionId}）` : `需要装备槽位 ${c.slot}`;
    case 'hasItem':
      return `需要物品 ${c.itemId}${c.minQty ? ` × ${c.minQty}` : ''}`;
    case 'notHasItem':
      return `不能持有物品 ${c.itemId}${c.minQty ? ` × ${c.minQty}` : ''}`;
    case 'statAtLeast':
      return `需要 ${c.stat} ≥ ${c.value}`;
    case 'statAtMost':
      return `需要 ${c.stat} ≤ ${c.value}`;
    case 'hasFlag':
      return `需要 flag ${c.flag}`;
    case 'notHasFlag':
      return `不能持有 flag ${c.flag}`;
    case 'hasUpgrade':
      return `需要升级 ${c.upgradeId}`;
    case 'depthAtLeast':
      return `需要深度 ≥ ${c.value}m`;
    case 'hasCapability':
      return `需要工具能力 ${c.capability}（cut＝潜水刀·mine＝岩凿）`;
    case 'npcTrustTier':
      return `需要对 ${c.npcId} 的信任达 ${c.minTier} 档`;
    case 'all':
      return `全部满足: [${c.of.map(describeCondition).join(' & ')}]`;
    case 'any':
      return `任一满足: [${c.of.map(describeCondition).join(' | ')}]`;
  }
}

function describeHiddenReason(opt: EventOption): string {
  if (opt.visibleIf) return describeCondition(opt.visibleIf);
  return '未知条件';
}

// ---------------------------------------------------------------------------
// 估算成功率（与 events.ts::performCheck 同公式）
// ---------------------------------------------------------------------------

function estimateSuccessRate(stats: Stats, stat: Stat, dc: number): number {
  const diff = stats[stat] - dc;
  return Math.max(0.05, Math.min(0.95, 0.5 + diff * 0.015));
}

// ---------------------------------------------------------------------------
// 初始 state 构造
// ---------------------------------------------------------------------------

/** 从事件 zoneTags 推断一个 zoneId，没法推断时回退 'zone.old_lighthouse_reef' */
function inferZoneId(ev: DiveEvent): string {
  const tags = new Set(ev.zoneTags ?? []);
  if (tags.has('cave')) return 'zone.blue_caves';
  if (tags.has('tutorial')) return 'zone.east_reef';
  return 'zone.old_lighthouse_reef';
}

function buildInitialState(input: ScenarioInput, ev: DiveEvent): GameState {
  const base = createInitialGameState();

  // ----- profile 覆写 -----
  const profileFlags = new Set(input.profileFlags ?? []);
  const unlocked = new Set(input.unlockedUpgrades ?? []);
  const lore = new Set(input.loreEntries ?? []);
  const profile = {
    ...base.profile,
    flags: profileFlags,
    unlockedUpgrades: unlocked,
    loreEntries: lore,
    bankedGold: input.bankedGold ?? base.profile.bankedGold,
  };

  // ----- run 覆写 -----
  const zoneId = input.zoneId ?? inferZoneId(ev);
  const depth = input.depth ?? ev.depthRange[0];
  const run: RunState = createNewRun({ zoneId });
  run.currentDepth = depth;
  run.equipment = buildEquipment(input.equipment);
  run.inventory = (input.inventory ?? []).map((i) => ({ ...i }));
  run.activeFlags = new Set(input.runFlags ?? []);

  // stats：默认满状态，再按 input 覆写
  const defaultStats: Stats = {
    hp: run.hpMax,
    stamina: run.staminaMax,
    oxygen: run.oxygenMax,
    nitrogen: 0,
    thermalStress: 0,
  };
  run.stats = { ...defaultStats, ...(input.stats ?? {}) };

  // phase 直接置到目标事件
  return {
    ...base,
    profile,
    run,
    phase: { kind: 'dive', subPhase: { kind: 'event', eventId: ev.id } },
  };
}

// ---------------------------------------------------------------------------
// 一步内的 diff 计算（diffStats / diffInventory 共用件在 scenarioShared.ts）
// ---------------------------------------------------------------------------

function diffFlags(before: Set<string>, after: Set<string>): string[] {
  const out: string[] = [];
  for (const f of after) if (!before.has(f)) out.push(f);
  return out;
}

function diffLore(before: Set<string>, after: Set<string>): string[] {
  return diffFlags(before, after);
}

// ---------------------------------------------------------------------------
// 主执行函数
// ---------------------------------------------------------------------------

/**
 * 构造一个「落在指定事件、状态已按 input 覆写」的 GameState——给剧情编辑器做「像游戏内」实时回放的起点。
 * events 覆盖优先（测内存里未保存的编辑）。事件不存在 → null。
 */
export function buildScenarioState(
  input: ScenarioInput,
  opts?: { events?: Map<string, DiveEvent> },
): GameState | null {
  const ev = opts?.events?.get(input.eventId) ?? getEventById(input.eventId);
  if (!ev) return null;
  return buildInitialState(input, ev);
}

export function runEventScenario(
  input: ScenarioInput,
  opts?: { events?: Map<string, DiveEvent> },
): ScenarioResult {
  const errors: string[] = [];
  // 内存事件覆盖优先（剧情编辑器测未保存的编辑）；缺省走 EVENT_DB。
  const resolve = (id: string): DiveEvent | undefined => opts?.events?.get(id) ?? getEventById(id);

  // ----- 起步事件存在性 -----
  const startEvent = resolve(input.eventId);
  if (!startEvent) {
    return {
      input,
      resolvedInitialState: createInitialGameState(),
      steps: [],
      summary: {
        statsDelta: {},
        inventoryGained: [],
        profileFlagsAdded: [],
        runFlagsAdded: [],
        bankedGoldDelta: 0,
        loreAdded: [],
        survived: true,
        finalPhase: 'unknown',
      },
      errors: [`event id "${input.eventId}" 未在 EVENT_DB 中找到`],
    };
  }

  const resolvedInitialState = buildInitialState(input, startEvent);

  // 让对外 result.resolvedInitialState 是只读快照（深拷贝 sets / inventory 不必，因 buildInitialState 已重建）
  const initialSnapshot: GameState = resolvedInitialState;

  const steps: ScenarioStep[] = [];
  const chain = input.chain ?? 'follow';
  const maxSteps = input.maxSteps ?? 10;
  const choices = input.choices ?? [];

  // 记录起点用以最终 summary diff
  const startStatsClone: Stats = { ...resolvedInitialState.run!.stats };
  const startInventoryClone: InventoryItem[] = resolvedInitialState.run!.inventory.map((i) => ({ ...i }));
  const startRunFlagsClone = new Set(resolvedInitialState.run!.activeFlags);
  const startProfileFlagsClone = new Set(resolvedInitialState.profile.flags);
  const startLoreClone = new Set(resolvedInitialState.profile.loreEntries);
  const startGold = resolvedInitialState.profile.bankedGold;

  let state: GameState = resolvedInitialState;
  let currentEventId: string | null = startEvent.id;
  let combatTriggered: string | undefined;
  let survived = true;
  let finalPhase = state.phase.kind;

  // 整个执行被 seeded RNG 包起来（fn 返回时恢复 Math.random）
  withSeededRandom(input.seed, () => {
    for (let stepIndex = 0; stepIndex < maxSteps; stepIndex++) {
      if (currentEventId === null) break;
      const ev = resolve(currentEventId);
      if (!ev) {
        errors.push(`step ${stepIndex}: 事件 "${currentEventId}" 未找到`);
        break;
      }

      // ----- 列出 visible / hidden options -----
      const visibleOptions: VisibleOption[] = [];
      const hiddenOptions: HiddenOption[] = [];
      for (const opt of ev.options) {
        if (isOptionVisible(state, opt)) {
          const info: VisibleOption = {
            id: opt.id,
            label: opt.label,
            hasCheck: !!opt.check,
          };
          if (opt.check && state.run) {
            info.checkInfo = {
              stat: opt.check.stat,
              dc: opt.check.dc,
              estimatedSuccessRate: Number(
                estimateSuccessRate(state.run.stats, opt.check.stat, opt.check.dc).toFixed(4),
              ),
            };
          }
          visibleOptions.push(info);
        } else {
          hiddenOptions.push({
            id: opt.id,
            label: opt.label,
            blockedBy: describeHiddenReason(opt),
          });
        }
      }

      // ----- 选项决定 -----
      const chosenId: string | undefined = choices[stepIndex];
      const step: ScenarioStep = {
        stepIndex,
        eventId: ev.id,
        eventTitle: ev.title,
        eventTone: ev.tone,
        eventBody: ev.body,
        visibleOptions,
        hiddenOptions,
        chosenId: null,
        narrative: [],
        deltas: {
          stats: {},
          inventoryAdded: [],
          flagsAdded: [],
          goldDelta: 0,
          loreAdded: [],
        },
        next: { kind: 'end', reason: 'noChoiceProvided' },
      };

      if (chosenId === undefined) {
        steps.push(step);
        break;
      }

      const targetOpt = ev.options.find((o) => o.id === chosenId);
      if (!targetOpt) {
        errors.push(
          `step ${stepIndex}: 选项 id "${chosenId}" 在事件 "${ev.id}" 中不存在`,
        );
        step.next = { kind: 'end', reason: 'optionNotVisible' };
        steps.push(step);
        break;
      }
      if (!isOptionVisible(state, targetOpt)) {
        errors.push(
          `step ${stepIndex}: 选项 "${chosenId}" 当前不可见（${describeHiddenReason(targetOpt)}）`,
        );
        step.next = { kind: 'end', reason: 'optionNotVisible' };
        steps.push(step);
        break;
      }

      step.chosenId = chosenId;

      // ----- 执行 option，记 diff -----
      const before = state;
      const beforeStats: Stats = before.run ? { ...before.run.stats } : { ...startStatsClone };
      const beforeInv: InventoryItem[] = before.run ? before.run.inventory.map((i) => ({ ...i })) : [];
      const beforeRunFlags = before.run ? new Set(before.run.activeFlags) : new Set<string>();
      const beforeProfileFlags = new Set(before.profile.flags);
      const beforeLore = new Set(before.profile.loreEntries);
      const beforeRunGold = before.run?.gold ?? 0;
      const beforeBankedGold = before.profile.bankedGold;

      // 如果是 check，先手动算 rate + roll（patch 过的 Math.random）
      let checkInfo: ScenarioStep['checkResult'] | undefined;
      if (targetOpt.check && state.run) {
        const rate = estimateSuccessRate(
          state.run.stats,
          targetOpt.check.stat,
          targetOpt.check.dc,
        );
        // 我们不能预先 roll 而不让 events.ts 再 roll（performCheck 也会 Math.random()）。
        // 但 LCG 是确定性的：这里 peek 一下，再让 events.ts 用同一个 RNG roll——会得到不同的数。
        // 所以让 events.ts 自己 roll；这里只在 resolveOption 之后从 narrative 反推 passed。
        checkInfo = {
          stat: targetOpt.check.stat,
          dc: targetOpt.check.dc,
          rate: Number(rate.toFixed(4)),
          roll: NaN, // 暂用 NaN，下面从 narrative 推
          passed: false,
        };
      }

      const result = resolveOption(state, targetOpt, ev);
      state = result.state;

      // narrative 第一行带 "检定 [stat vs dc] 成功/失败"——我们靠这个回填 passed
      if (checkInfo) {
        const checkLine = result.narrative[0] ?? '';
        const passed = checkLine.includes('成功');
        checkInfo.passed = passed;
        // roll 实际值无法回填（events.ts 用一次 Math.random 就丢了），用 sentinel -1
        checkInfo.roll = -1;
        step.checkResult = checkInfo;
      }

      step.narrative = result.narrative;

      // ----- 计算 deltas -----
      const afterStats: Stats = state.run ? state.run.stats : beforeStats;
      const afterInv: InventoryItem[] = state.run ? state.run.inventory : [];
      const afterRunFlags = state.run ? state.run.activeFlags : new Set<string>();
      const afterProfileFlags = state.profile.flags;
      const afterLore = state.profile.loreEntries;
      const afterRunGold = state.run?.gold ?? 0;
      const afterBankedGold = state.profile.bankedGold;

      step.deltas = {
        stats: diffStats(beforeStats, afterStats),
        inventoryAdded: diffInventory(beforeInv, afterInv),
        flagsAdded: [
          ...diffFlags(beforeRunFlags, afterRunFlags),
          ...diffFlags(beforeProfileFlags, afterProfileFlags),
        ],
        goldDelta:
          afterRunGold - beforeRunGold + (afterBankedGold - beforeBankedGold),
        loreAdded: diffLore(beforeLore, afterLore),
      };

      // ----- 解析 next，决定循环走向 -----
      const next = result.next;
      switch (next.kind) {
        case 'continueEvent':
          step.next = { kind: 'continueEvent', eventId: next.eventId };
          if (chain === 'isolated') {
            // 强制停在这里
            step.next = { kind: 'end', reason: 'isolated' };
            currentEventId = null;
          } else {
            currentEventId = next.eventId;
            // 把 dive subPhase 同步到下一个事件，让后续 isOptionVisible / Condition 评估正确
            if (state.run) {
              state = {
                ...state,
                phase: {
                  kind: 'dive',
                  subPhase: { kind: 'event', eventId: next.eventId },
                },
              };
            }
          }
          break;
        case 'forceAscend':
          step.next = { kind: 'forceAscend' };
          state = { ...state, phase: { kind: 'ascent', targetDepth: 0 } };
          currentEventId = null;
          break;
        case 'death':
          step.next = { kind: 'death' };
          survived = false;
          state = { ...state, phase: { kind: 'gameOver', reason: 'event death' } };
          currentEventId = null;
          break;
        case 'startCombat':
          step.next = { kind: 'startCombat', combatId: next.combatId };
          combatTriggered = combatTriggered ?? next.combatId;
          // 战斗边界：不自动打，停步
          currentEventId = null;
          break;
        case 'remainOnEvent':
          step.next = { kind: 'remainOnEvent' };
          // 没有续点，本事件结束
          currentEventId = null;
          break;
      }

      steps.push(step);
      // 防御性：如果接下来没事件可跑，但循环条件还允许，下一次循环会自然停
      if (currentEventId === null) break;
    }

    // ----- 收尾 next 判断 -----
    if (steps.length > 0) {
      const last = steps[steps.length - 1];
      // 如果最后一步是 continueEvent 但因为 maxSteps 到了没继续，把 reason 改 maxSteps
      if (last.next.kind === 'continueEvent' && steps.length >= maxSteps) {
        // 注意：不修改 next 类型，只追加一个解释性 next 'end'
        // 但简洁起见：直接把 last.next 替换为 end{reason:'maxSteps'}
        // —— 这破坏了"continueEvent 表示后面还要继续"的语义。所以宁愿保留原 continueEvent，
        // 用 errors 记一笔。
        errors.push(`达到 maxSteps=${maxSteps}，剩余链路未跑完`);
      }
      // 如果 currentEventId 是 null 但没有 next end（即 chain 自然走完没续点），把它标 chainExhausted
      // 但实际上我们已经在 remainOnEvent / forceAscend / death / startCombat / isolated 里都设了 next，
      // 唯一可能"自然走完"的是 continueEvent 链尾被处理为 remainOnEvent。所以不再额外处理。
    }

    finalPhase = state.phase.kind;
  });

  // ----- summary -----
  const finalStats: Stats = state.run ? state.run.stats : startStatsClone;
  const finalInv: InventoryItem[] = state.run
    ? state.run.inventory
    : startInventoryClone;
  const finalRunFlags = state.run ? state.run.activeFlags : new Set<string>();
  const finalProfileFlags = state.profile.flags;
  const finalLore = state.profile.loreEntries;
  const finalGold = state.profile.bankedGold;

  const summary: ScenarioResult['summary'] = {
    statsDelta: diffStats(startStatsClone, finalStats),
    inventoryGained: diffInventory(startInventoryClone, finalInv),
    profileFlagsAdded: diffFlags(startProfileFlagsClone, finalProfileFlags),
    runFlagsAdded: diffFlags(startRunFlagsClone, finalRunFlags),
    bankedGoldDelta: finalGold - startGold,
    loreAdded: diffLore(startLoreClone, finalLore),
    combatTriggered,
    survived,
    finalPhase,
  };

  return {
    input,
    resolvedInitialState: initialSnapshot,
    steps,
    summary,
    errors,
  };
}

// ---------------------------------------------------------------------------
// 辅助查询 API
// ---------------------------------------------------------------------------

export interface EventListEntry {
  id: string;
  title: string;
  depthRange: [number, number];
  zoneTags?: string[];
  tone: string;
}

export function listAllEvents(filter?: {
  zoneTag?: string;
  depthAtLeast?: number;
  depthAtMost?: number;
}): EventListEntry[] {
  const out: EventListEntry[] = [];
  for (const ev of EVENT_DB.values()) {
    if (filter?.zoneTag && !(ev.zoneTags ?? []).some((t) => t === filter.zoneTag)) continue;
    if (filter?.depthAtLeast !== undefined && ev.depthRange[1] < filter.depthAtLeast) continue;
    if (filter?.depthAtMost !== undefined && ev.depthRange[0] > filter.depthAtMost) continue;
    out.push({
      id: ev.id,
      title: ev.title,
      depthRange: ev.depthRange,
      zoneTags: ev.zoneTags,
      tone: ev.tone,
    });
  }
  // 按 id 排序便于 diff 稳定
  out.sort((a, b) => a.id.localeCompare(b.id));
  return out;
}

export interface OptionSummary {
  id: string;
  label: string;
  hasCheck: boolean;
  /** 该选项可能流向的"出口"概述（continueEvent X / forceAscend / triggerCombat X / death / loot+/...） */
  outcomes: string[];
}

function describeOutcome(prefix: string, o: NonNullable<EventOption['outcome']>): string[] {
  const parts: string[] = [];
  if (o.text) parts.push(`narrative`);
  if (o.deltas) {
    const d = Object.entries(o.deltas)
      .map(([k, v]) => `${k}${(v as number) >= 0 ? '+' : ''}${v}`)
      .join(' ');
    parts.push(`deltas{${d}}`);
  }
  if (o.oxygenTurnCost) parts.push(`oxygenTurnCost=${o.oxygenTurnCost}`);
  if (o.loot && o.loot.length > 0) {
    parts.push(`loot[${o.loot.map((l) => `${l.itemId}×${l.qty[0]}-${l.qty[1]}`).join(',')}]`);
  }
  if (o.applyFlags) parts.push(`+flags[${o.applyFlags.join(',')}]`);
  if (o.removeFlags) parts.push(`-flags[${o.removeFlags.join(',')}]`);
  if (o.loreEntry) parts.push(`lore=${o.loreEntry}`);
  if (o.goldDelta) parts.push(`gold${o.goldDelta >= 0 ? '+' : ''}${o.goldDelta}`);
  if (o.triggerEventId) parts.push(`→event ${o.triggerEventId}`);
  if (o.triggerCombatId) parts.push(`→combat ${o.triggerCombatId}`);
  if (o.endDive) parts.push(`endDive=${o.endDive}`);
  return [`${prefix}: ${parts.join(' ')}`];
}

export function describeEvent(id: string):
  | {
      event: DiveEvent;
      optionSummary: OptionSummary[];
    }
  | null {
  const ev = getEventById(id);
  if (!ev) return null;
  const summary: OptionSummary[] = ev.options.map((opt) => {
    const outcomes: string[] = [];
    if (opt.check) {
      outcomes.push(`check[${opt.check.stat} vs ${opt.check.dc}]`);
      outcomes.push(...describeOutcome('  ✓', opt.check.onSuccess));
      outcomes.push(...describeOutcome('  ✗', opt.check.onFailure));
    } else if (opt.outcome) {
      outcomes.push(...describeOutcome('outcome', opt.outcome));
    } else {
      outcomes.push('(no outcome / no check)');
    }
    return {
      id: opt.id,
      label: opt.label,
      hasCheck: !!opt.check,
      outcomes,
    };
  });
  return { event: ev, optionSummary: summary };
}
