// 事件解析器：处理 Outcome、Condition、SkillCheck
// 输入 (state, option) → 输出 (newState, narrative text[])

import type {
  GameState,
  RunState,
  DiveEvent,
  EventOption,
  Outcome,
  Condition,
  Stats,
  Visibility,
} from '@/types';
import { addToInventory, appendLog, clampStats } from './state';
import { restoreLighthouse, advanceOutpost } from './lighthouses';
import { lampPowerDrain, alertDelta, ALERT_MAX } from './clarity';
import { effectiveStaminaMax } from './modifiers';
import { stepNitrogen, narcosisSanityDrain } from './nitrogen';

// —— 数据装载 ——
// 单一事件库是 zones.ts::EVENT_DB（含全部 zone 的事件）。getEvent 直接委托给它，
// 不再维护第二份只装 tutorial.json 的索引——旧实现导致 EventView / PortEventView
// （都走 getEvent）解析不到任何非教学事件，在浏览器里渲染成"[事件未找到]"。
// playthrough 脚本走 getEventById，所以引擎测试一直绿、UI 却是坏的（典型只测引擎的盲区）。
import { getEventById } from './zones';

export function getEvent(id: string): DiveEvent | undefined {
  return getEventById(id);
}

// —— Condition 解析 ——

export function evalCondition(state: GameState, c: Condition): boolean {
  const run = state.run;
  const profile = state.profile;
  switch (c.kind) {
    case 'hasEquipment':
      return run !== null && run.equipment[c.slot] !== null;
    case 'hasItem': {
      if (!run) return false;
      const inv = run.inventory.find((i) => i.itemId === c.itemId);
      return inv !== undefined && inv.qty >= (c.minQty ?? 1);
    }
    case 'statAtLeast':
      return run !== null && run.stats[c.stat] >= c.value;
    case 'statAtMost':
      return run !== null && run.stats[c.stat] <= c.value;
    case 'hasFlag':
      return profile.flags.has(c.flag) || (run?.activeFlags.has(c.flag) ?? false);
    case 'notHasFlag':
      return (
        !profile.flags.has(c.flag) && !(run?.activeFlags.has(c.flag) ?? false)
      );
    case 'hasUpgrade':
      return profile.unlockedUpgrades.has(c.upgradeId);
    case 'depthAtLeast':
      return run !== null && run.currentDepth >= c.value;
    case 'all':
      return c.of.every((sub) => evalCondition(state, sub));
    case 'any':
      return c.of.some((sub) => evalCondition(state, sub));
  }
}

/** 一个选项是否对当前 state 可见 */
export function isOptionVisible(state: GameState, opt: EventOption): boolean {
  if (opt.hallucination) {
    if (!state.run || state.run.stats.sanity > 50) return false;
  }
  if (opt.visibleIf && !evalCondition(state, opt.visibleIf)) {
    return opt.hiddenIfFails === false; // false = 仅灰显
  }
  return true;
}

/** 该选项是否可点（满足 visibleIf 才可点） */
export function isOptionEnabled(state: GameState, opt: EventOption): boolean {
  if (opt.visibleIf && !evalCondition(state, opt.visibleIf)) return false;
  return true;
}

// —— SkillCheck ——

export function performCheck(stats: Stats, stat: keyof Stats, dc: number): boolean {
  // 概率模型：以 (stat - dc) 为差值映射到 [-30, +30] 的成功率窗口
  // diff = 0 时 50%；每 1 点 ±1.5%；clamp 到 [5%, 95%]
  const val = stats[stat];
  const diff = val - dc;
  const successRate = Math.max(0.05, Math.min(0.95, 0.5 + diff * 0.015));
  return Math.random() < successRate;
}

// —— Outcome 应用 ——

export interface OutcomeResult {
  state: GameState;
  narrative: string[];
  /** 引擎后续应进行的 phase 转换提示 */
  next:
    | { kind: 'continueEvent'; eventId: string }
    | { kind: 'startCombat'; combatId: string }
    | { kind: 'forceAscend' }
    | { kind: 'death' }
    | { kind: 'remainOnEvent' };
}

export function applyOutcome(state: GameState, outcome: Outcome): OutcomeResult {
  let s = state;
  const narrative: string[] = [];

  if (outcome.text) narrative.push(outcome.text);

  // ---- 数值变更 ----
  if (s.run) {
    let stats = { ...s.run.stats };
    if (outcome.deltas) {
      for (const [stat, delta] of Object.entries(outcome.deltas) as [
        keyof Stats,
        number,
      ][]) {
        stats[stat] = stats[stat] + delta;
      }
    }
    // 额外氧气消耗（按"标准回合数"）
    if (outcome.oxygenTurnCost) {
      stats.oxygen -= outcome.oxygenTurnCost;
    }
    stats = clampStats(stats, {
      stamina: effectiveStaminaMax(s.run),
      oxygen: s.run.oxygenMax,
    });
    s = { ...s, run: { ...s.run, stats } };
  }

  // ---- 战利品 ----
  // 有 run = dive 期间 → run.inventory（上岸结算）；无 run = 港口事件（如教学收尾发导师日志）→ profile.inventory（持久）。
  if (outcome.loot) {
    let inv = s.run ? s.run.inventory : s.profile.inventory;
    for (const roll of outcome.loot) {
      const chance = roll.chance ?? 1;
      if (Math.random() <= chance) {
        const min = roll.qty[0];
        const max = roll.qty[1];
        const qty = min + Math.floor(Math.random() * (max - min + 1));
        if (qty > 0) inv = addToInventory(inv, roll.itemId, qty);
      }
    }
    if (s.run) s = { ...s, run: { ...s.run, inventory: inv } };
    else s = { ...s, profile: { ...s.profile, inventory: inv } };
  }

  // ---- Flags ----
  // 有 run = dive 期间，flag 进 run.activeFlags（run 结束后丢弃）；
  // 无 run = 港口 cutscene（portEvent），flag 直接进 profile.flags（永久）。
  if (outcome.applyFlags) {
    if (s.run) {
      const flags = new Set(s.run.activeFlags);
      for (const f of outcome.applyFlags) flags.add(f);
      s = { ...s, run: { ...s.run, activeFlags: flags } };
    } else {
      const flags = new Set(s.profile.flags);
      for (const f of outcome.applyFlags) flags.add(f);
      s = { ...s, profile: { ...s.profile, flags } };
    }
  }
  if (outcome.removeFlags) {
    if (s.run) {
      const flags = new Set(s.run.activeFlags);
      for (const f of outcome.removeFlags) flags.delete(f);
      s = { ...s, run: { ...s.run, activeFlags: flags } };
    } else {
      const flags = new Set(s.profile.flags);
      for (const f of outcome.removeFlags) flags.delete(f);
      s = { ...s, profile: { ...s.profile, flags } };
    }
  }

  // ---- 金币 ----
  if (outcome.goldDelta) {
    if (s.run) {
      s = { ...s, run: { ...s.run, gold: s.run.gold + outcome.goldDelta } };
    } else {
      s = {
        ...s,
        profile: {
          ...s.profile,
          bankedGold: Math.max(0, s.profile.bankedGold + outcome.goldDelta),
        },
      };
    }
  }

  // ---- Lore ----（单条或多条·如教学收尾「两本日志」一拍解锁两条）
  if (outcome.loreEntry) {
    const entries = new Set(s.profile.loreEntries);
    for (const id of Array.isArray(outcome.loreEntry) ? outcome.loreEntry : [outcome.loreEntry]) {
      entries.add(id);
    }
    s = { ...s, profile: { ...s.profile, loreEntries: entries } };
  }

  // ---- 修复废弃灯塔（Phase C）----
  // 与 loreEntry 同属"少数能从下潜里持久写 profile 的 outcome"：restoreLighthouse 权威校验账单
  // （按 profile 银行材料＋金币），成功则 push 新灯塔到 profile.lighthouses，否则只叙事不改档。
  if (outcome.restoreRuinId) {
    s = restoreLighthouse(s, outcome.restoreRuinId);
  }

  // ---- 推进深水前哨建造一阶（深水区 Phase 2a）----
  // 同 restoreRuinId：从下潜里持久写 profile。advanceOutpost 按当前阶段权威校验账单（profile 银行）、
  // 扣料、置阶段 flag（持久进度，半亮扛过死亡）；建满（点亮）则 push 一座灯塔到 profile.lighthouses。
  if (outcome.advanceOutpostId) {
    s = advanceOutpost(s, outcome.advanceOutpostId);
  }

  // ---- 持久 profile flag（深水区 Phase 3 mimic capstone）----
  // 区别于 applyFlags（dive 中只进 run.activeFlags）：直接、跨 run 持久地写 profile.flags
  // （如 flag.d_reveal：读穿 mimic 活下来后翻转死者名；保持暧昧 #42/#54）。
  if (outcome.setProfileFlags) {
    const flags = new Set(s.profile.flags);
    for (const f of outcome.setProfileFlags) flags.add(f);
    s = { ...s, profile: { ...s.profile, flags } };
  }

  // ---- 叙事日志 ----
  if (outcome.text) {
    s = appendLog(s, { tone: 'realistic', text: outcome.text });
  }

  // ---- 后续 phase 决定 ----
  if (outcome.endDive === 'death') {
    return { state: s, narrative, next: { kind: 'death' } };
  }
  if (outcome.endDive === 'forceAscend') {
    return { state: s, narrative, next: { kind: 'forceAscend' } };
  }
  if (outcome.triggerCombatId) {
    return {
      state: s,
      narrative,
      next: { kind: 'startCombat', combatId: outcome.triggerCombatId },
    };
  }
  if (outcome.triggerEventId) {
    return {
      state: s,
      narrative,
      next: { kind: 'continueEvent', eventId: outcome.triggerEventId },
    };
  }
  return { state: s, narrative, next: { kind: 'remainOnEvent' } };
}

/** 选项 → Outcome（处理 check 分支） */
export function resolveOption(state: GameState, opt: EventOption): OutcomeResult {
  if (opt.check && state.run) {
    const succeeded = performCheck(state.run.stats, opt.check.stat, opt.check.dc);
    const outcome = succeeded ? opt.check.onSuccess : opt.check.onFailure;
    const result = applyOutcome(state, outcome);
    return {
      ...result,
      narrative: [
        `检定 [${opt.check.stat} vs ${opt.check.dc}] ${succeeded ? '成功' : '失败'}`,
        ...result.narrative,
      ],
    };
  }
  if (opt.outcome) {
    return applyOutcome(state, opt.outcome);
  }
  return { state, narrative: ['（这个选项暂时没接好。）'], next: { kind: 'remainOnEvent' } };
}

/**
 * 能见度（海图 POI 修正）对理智的额外消耗：看不清越久越压抑。
 * 纯函数，便于回归断言。clear / 未设 → 0。
 */
export function visibilitySanityDrain(
  visibility: Visibility | undefined,
  turns: number,
): number {
  if (visibility === 'dark') return 0.35 * turns;
  if (visibility === 'murky') return 0.15 * turns;
  return 0;
}

/** 将一个 RunState 推进 N 个标准回合的氧气/氮气消耗（不处理事件内额外消耗） */
export function tickTurns(
  run: RunState,
  turns: number,
  /**
   * 可选消耗修正（负伤 SPEC §5 dive-move 消费点）：o2CostMult 乘进本次 tick 的氧耗。
   * 由调用方（dive-move 移动）从 computeModifiers 取值传入——本函数不自读伤势列表
   * （check-boundaries 规则四），其余调用点（休息/事件）不传＝行为逐字节不变。
   */
  opts?: { o2CostMult?: number },
): RunState {
  if (turns <= 0) return run;
  const depth = run.currentDepth;
  const depthFactor = 1 + depth / 50;
  const oxygenDrain = turns * 1 * depthFactor * (opts?.o2CostMult ?? 1);

  const stats: Stats = {
    ...run.stats,
    oxygen: Math.max(0, run.stats.oxygen - oxygenDrain),
    // 氮气：饱和模型（深度定 ceiling·停留定逼近·同一式同管吸/排）·见 engine/nitrogen.ts
    nitrogen: stepNitrogen(run.stats.nitrogen, depth, turns),
  };
  // 深度→理智的「即时压抑」基础衰减（与氮气无关·一沉到深就压）
  if (depth >= 30) {
    const decayPerTurn = depth < 60 ? 0.2 : depth < 100 ? 0.5 : 1.0;
    stats.sanity = Math.max(0, stats.sanity - decayPerTurn * turns);
  }
  // 氮醉：高氮 × 深度 → 额外扣理智（连续·叠加在基础衰减之上·氮气 SPEC §3）
  const narcosisDrain = narcosisSanityDrain(run.stats.nitrogen, depth, turns);
  if (narcosisDrain > 0) {
    stats.sanity = Math.max(0, stats.sanity - narcosisDrain);
  }
  // 能见度（海图 POI 修正）：看不清 → 额外理智压力
  const visDrain = visibilitySanityDrain(run.diveModifier?.visibility, turns);
  if (visDrain > 0) {
    stats.sanity = Math.max(0, stats.sanity - visDrain);
  }

  // 深水区 Phase 0a：灯耗电（清水因子 0＝有自然光不点灯；黑水/微浊才耗；归零 → clarity 强制摸黑）。
  // litThisTurn（#118·作者拍）：本回合开过灯（哪怕看一眼又关了）＝按整回合开灯收电费，
  // 与进回合前就开着等价——零电费偷看缝焊死。只动电费口；警觉仍按瞬时开关算（隐身轴
  // 语义独立·要不要同样补收留电池经济批一起拍）。
  const billRun =
    !run.sensors.light && run.sensors.litThisTurn
      ? { ...run, sensors: { ...run.sensors, light: true } }
      : run;
  const power = Math.max(0, run.power - lampPowerDrain(billRun, turns));

  // 深水区 Phase 0b：警觉积累（点灯/ping 在深水抬、摸黑/浅水降）；clamp 0–ALERT_MAX。
  const alert = Math.max(0, Math.min(ALERT_MAX, run.alert + alertDelta(run, turns)));

  // 结算后复位 litThisTurn（缺席=本回合没开过灯·真条件字段不留尸）。
  const sensors = run.sensors.litThisTurn ? { ...run.sensors, litThisTurn: undefined } : run.sensors;
  return { ...run, sensors, stats, power, alert, turn: run.turn + turns };
}
