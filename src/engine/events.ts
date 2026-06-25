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
  InventoryItem,
} from '@/types';
import { addToInventory, addToPoiSetMap, appendLog, clampStats, enqueuePickup, totalRunInventoryWeight } from './state';
import { getItemDef, harvestPersistOf, weightForItem } from './items';
import { equipmentUnlocksAction, loadoutInsulation } from './equipment';
import { EQUIPMENT_SLOTS } from '@/types/items';
import { restoreLighthouse, advanceOutpost } from './lighthouses';
import { lampPowerDrain, alertDelta, ALERT_MAX } from './clarity';
import { effectiveStaminaMax } from './modifiers';
import { stepNitrogen, narcosisSanityDrain } from './nitrogen';
import { getCaveTemperature, stepThermalStress, thermalStaminaDrain } from './temperature';

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

/** 玩家持有某物的总数 = profile 仓库 + 当前 run 背包（港口无 run 时只算 profile）。hasItem/notHasItem 单点。 */
function ownedQty(state: GameState, itemId: string): number {
  const r = state.run?.inventory.find((i) => i.itemId === itemId)?.qty ?? 0;
  const p = state.profile.inventory.find((i) => i.itemId === itemId)?.qty ?? 0;
  return r + p;
}

export function evalCondition(state: GameState, c: Condition): boolean {
  const run = state.run;
  const profile = state.profile;
  switch (c.kind) {
    case 'hasEquipment':
      if (run === null || run.equipment[c.slot] === null) return false;
      // actionId（可选·武器解锁行动门·武器系统 2026-06-20）：进一步要求该槽的件解锁了指定行动
      // （持救援斧解锁 action.axe_pry ⇒ 才显示「撬门/破障」选项）。无 actionId ＝ 旧语义（槽非空即可·逐字节不变）。
      return c.actionId === undefined || equipmentUnlocksAction(run.equipment, c.slot, c.actionId);
    case 'hasItem':
      return ownedQty(state, c.itemId) >= (c.minQty ?? 1);
    case 'notHasItem':
      return ownedQty(state, c.itemId) < (c.minQty ?? 1);
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
    case 'hasCapability': {
      // 双源扫描：装备槽（run.equipment）+ 当前潜水背包（run.inventory）
      // 任意来源的道具在 ItemDef.grantsCapability 中声明了该能力即满足。
      if (!run) return false;
      const cap = c.capability;
      for (const slot of EQUIPMENT_SLOTS) {
        const inst = run.equipment[slot];
        if (!inst) continue;
        if (getItemDef(inst.itemId)?.grantsCapability?.includes(cap)) return true;
      }
      for (const inv of run.inventory) {
        if (inv.qty <= 0) continue;
        if (getItemDef(inv.itemId)?.grantsCapability?.includes(cap)) return true;
      }
      return false;
    }
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
    // 固定资源耗尽记账（POI 固定资源耗尽·2026-06-25）：dive 期间统计本事件「采到了什么」——
    // harvestedAnything ＝ 这个节点采过（任意 loot·入 run.harvestedNodes 做 run 级耗尽）；
    // savePersistItems ＝ harvestPersist:'save' 的件（暂存 run.harvestedSaveItems·回港永久入账）。
    let harvestedAnything = false;
    const savePersistItems: string[] = [];
    const gained: InventoryItem[] = []; // 本事件实际拾到的件·收齐后批量一格弹「获得物品」（enqueuePickup·见 state.ts）
    for (const roll of outcome.loot) {
      const chance = roll.chance ?? 1;
      if (Math.random() <= chance) {
        const min = roll.qty[0];
        const max = roll.qty[1];
        const qty = min + Math.floor(Math.random() * (max - min + 1));
        if (qty > 0) {
          // 背包承载（重量制·#资源重量制 2026-06-21）：dive 期间 run 背包加这件后超 carryWeightLimit → 跳过该件并日志提示
          // （不阻断整个事件·其余 loot 继续 roll）。inv 是本事件累计的工作副本——含本轮已拾的其它件，焊死「一个事件塞爆」。
          // 港口侧（无 run）仓库无承载上限，照旧不限。
          if (s.run && totalRunInventoryWeight(inv) + weightForItem(roll.itemId, qty) > s.run.carryWeightLimit) {
            const name = getItemDef(roll.itemId)?.name ?? roll.itemId;
            s = appendLog(s, { tone: 'system', text: `背包超载，无法拾取 ${name}。` });
            continue;
          }
          inv = addToInventory(inv, roll.itemId, qty);
          gained.push({ itemId: roll.itemId, qty });
          if (s.run) {
            harvestedAnything = true;
            if (harvestPersistOf(roll.itemId) === 'save') savePersistItems.push(roll.itemId);
          }
        }
      }
    }
    if (s.run) {
      const run = { ...s.run, inventory: inv };
      // 固定资源耗尽记账：仅「固定地图 POI 下潜」（run.poiId 有值）+ 在某节点上（currentNodeId）才记。
      // 节点入 run.harvestedNodes（run 级·下次重进刷新）；save 级件暂存 run.harvestedSaveItems（回港永久入账·死则不入）。
      if (harvestedAnything && run.poiId && run.currentNodeId) {
        run.harvestedNodes = addToPoiSetMap(run.harvestedNodes, run.poiId, run.currentNodeId);
        if (savePersistItems.length > 0) {
          const staged = new Set(run.harvestedSaveItems ?? []);
          for (const id of savePersistItems) staged.add(id);
          run.harvestedSaveItems = staged;
        }
      }
      s = { ...s, run };
    } else {
      s = { ...s, profile: { ...s.profile, inventory: inv } };
    }
    // 获得物品提示（玩家感知·2026-06-25）：dive 拾取 + 港口事件发物（如教学收尾导师日志）都弹；
    // 超载跳过的件不在 gained 里（已单独日志提示）。
    s = enqueuePickup(s, gained, '事件');
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

/** 选项 → Outcome（处理 check 分支）
 * @param event 可选：父事件（用于写 event_seen 标记·oncePerSave 门）
 */
export function resolveOption(
  state: GameState,
  opt: EventOption,
  event?: Pick<DiveEvent, 'id' | 'oncePerSave'>,
): OutcomeResult {
  let result: OutcomeResult;
  if (opt.check && state.run) {
    const succeeded = performCheck(state.run.stats, opt.check.stat, opt.check.dc);
    const outcome = succeeded ? opt.check.onSuccess : opt.check.onFailure;
    const r = applyOutcome(state, outcome);
    result = {
      ...r,
      narrative: [
        `检定 [${opt.check.stat} vs ${opt.check.dc}] ${succeeded ? '成功' : '失败'}`,
        ...r.narrative,
      ],
    };
  } else if (opt.outcome) {
    result = applyOutcome(state, opt.outcome);
  } else {
    result = { state, narrative: ['（这个选项暂时没接好。）'], next: { kind: 'remainOnEvent' } };
  }

  // oncePerSave 事件：选完即写 event_seen 到 profile.flags（持久·跨 run）
  if (event?.oncePerSave) {
    const flags = new Set(result.state.profile.flags);
    flags.add(`event_seen:${event.id}`);
    result = { ...result, state: { ...result.state, profile: { ...result.state.profile, flags } } };
  }

  return result;
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

  // 温度：按洞双极局部债（按 run.zoneId 查侧表·潜服 insulation 抵消·深度无关）·见 engine/temperature.ts。
  // 中性洞（侧表未命中·绝大多数 zone）→ intensity 0 → ceiling 0 → thermalStress 趋 0（恢复）⇒ 行为逐字节不变。
  const thermalIntensity = getCaveTemperature(run.zoneId).intensity;
  const insulation = loadoutInsulation(run.equipment);

  const stats: Stats = {
    ...run.stats,
    oxygen: Math.max(0, run.stats.oxygen - oxygenDrain),
    // 氮气：饱和模型（深度定 ceiling·停留定逼近·同一式同管吸/排）·见 engine/nitrogen.ts
    nitrogen: stepNitrogen(run.stats.nitrogen, depth, turns),
    // 温度：指数逼近 ceiling（同管累积/恢复）·逐回合 step == 一次性 step(turns)（守 stalker 一致性·同氮气）
    thermalStress: stepThermalStress(run.stats.thermalStress, thermalIntensity, insulation, turns),
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
  // 温度超阈后果（温度 SPEC §5）：热应力过 WARN → 扣体力（热极脱力 / 冷极麻木·叙事分极性·数学同款）。
  // 用进入本段前的应力估算（与 narcosis 同口径·确定性）。中性洞应力恒 0 ⇒ drain 0 ⇒ 体力不动（逐字节不变）。
  const thermalDrain = thermalStaminaDrain(run.stats.thermalStress, turns);
  if (thermalDrain > 0) {
    stats.stamina = Math.max(0, stats.stamina - thermalDrain);
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
