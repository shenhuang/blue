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
  InventoryItem,
} from '@/types';
import { addToInventory, addToPoiSetMap, appendLog, clampStats, enqueuePickup, totalRunInventoryWeight } from './state';
import { getItemDef, harvestPersistOf, weightForItem } from './items';
import { getUpgradeDef } from './upgrades';
import { equipmentUnlocksAction, loadoutInsulation, weightO2Mult, weightStaminaMult } from './equipment';
import { EQUIPMENT_SLOTS } from '@/types/items';
import { restoreLighthouse, advanceOutpost } from './lighthouses';
import { lampPowerDrain, alertDelta, ALERT_MAX } from './clarity';
import { stepNitrogen } from './nitrogen';
import { getCaveTemperature, stepThermalStress, thermalStaminaDrain } from './temperature';
import { trustTier } from './trust';
import { seabedNodeIds } from './seabed';

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
    case 'npcTrustTier':
      // NPC 信任档门控（通用信任系统·SPEC §3.4）：派生档 ≥ minTier。信任读派生一律走 engine/trust.ts（单源）。
      return trustTier(profile, c.npcId) >= c.minTier;
    case 'atSeabed':
      // 开阔水域贴底门控（SPEC §4）：当前节点 ∈ 贴底节点集（engine/seabed.ts 单源·渲染层同源）。
      return run !== null && run.map !== null && run.currentNodeId !== null && seabedNodeIds(run.map).has(run.currentNodeId);
    case 'all':
      return c.of.every((sub) => evalCondition(state, sub));
    case 'any':
      return c.of.some((sub) => evalCondition(state, sub));
  }
}

/** 一个选项是否对当前 state 可见 */
export function isOptionVisible(state: GameState, opt: EventOption): boolean {
  if (opt.visibleIf && !evalCondition(state, opt.visibleIf)) {
    return opt.hiddenIfFails === false; // false = 仅灰显
  }
  return true;
}

// —— 揭示归因（感知重做 SPEC §2.1 · 车道 5-2）——
//
// 「带了某道具才**显示**某选项 → 选项旁提示是靠这件解锁的」（作者请求）。
// isOptionVisible 只回 bool；本节把「因何可见」这层信息**从满足的持有条件里派生**出来，
// 供 EventView 在选项旁渲染一枚「（持有 <显示名>）」小标（渲染在 UI 层·此处只出纯数据）。
//
// 可扩展性（作者价值：落成机制别硬编码）——显示名一律从**满足条件的那件持有物**的真实
// `name`（ItemDef / UpgradeDef / 装备槽件）派生，不为每个选项、每种能力手写文案：
//   - hasCapability：扫玩家实际持有、且 grantsCapability 含该能力的第一件（装备槽优先，其次背包），
//     取它的 def.name。⇒ **任何未来「授予某能力」的新道具自动带标**（新增道具零改动·新事件只问能力）。
//     万一没扫到具体件（理论上 evalCondition 已保证有）才回退能力标签。
//   - hasEquipment：该槽当前装的件名（run.equipment[slot].name），回退到槽的通用名。
//   - hasItem：条件里 itemId 的 def.name。
//   - hasUpgrade：条件里 upgradeId 的 UpgradeDef.name。
//   - all/any：递归取**第一个满足的持有类**子条件（欺骗/数值/flag 类不产出归因·它们不是「你带了什么」）。
//
// 【内容作者约定（写在此处·代码不强制）】哪些选项该 item-gate、灯/声呐/其它各揭示什么，属内容：
//   - **灯**揭示近场 INTERACTION 选项（凑近、伸手、翻找——光照到才敢碰）；
//   - **声呐**揭示 STRUCTURAL / 导航选项（前方结构、暗流、绕路——回波先探清）；
//   - **其它道具**按其性质（刀→切割、岩凿→采矿、相机→取证……）。
//   本车道只做渲染 + 派生；具体给哪些选项挂 visibleIf 由内容车道逐条铺。

/** 能力标签的名词兜底（仅在扫不到具体持有件时用·正常路径走真实道具名）。 */
function capabilityFallbackLabel(cap: string): string {
  switch (cap) {
    case 'cut':
      return '切割工具';
    case 'mine':
      return '采矿工具';
    default:
      return cap;
  }
}

/** 装备槽的通用名（仅在该槽件查不到 def 时兜底·正常走件名）。 */
function equipmentSlotFallbackLabel(slot: string): string {
  switch (slot) {
    case 'light':
      return '灯';
    case 'sonar':
      return '声呐';
    case 'tool':
      return '手中的工具';
    case 'ranged':
      return '副手武器';
    case 'tank':
      return '气瓶';
    case 'suit':
      return '潜水服';
    default:
      return '装备';
  }
}

/**
 * 若一个**已可见**选项的可见性来自某个持有条件（hasCapability / hasEquipment / hasItem / hasUpgrade），
 * 返回其归因显示名（供「（持有 X）」小标）；否则（无 visibleIf、或 visibleIf 是数值/flag/欺骗类非持有条件）返回 null。
 *
 * 调用前提：选项已通过 isOptionVisible（本函数不重复判可见）。纯函数·便于回归断言。
 */
export function revealAttribution(state: GameState, opt: EventOption): string | null {
  if (!opt.visibleIf) return null;
  return attributionOf(state, opt.visibleIf);
}

/** 从一个（已满足的）Condition 递归取「你带了什么」的显示名·非持有类返回 null。 */
function attributionOf(state: GameState, c: Condition): string | null {
  const run = state.run;
  switch (c.kind) {
    case 'hasCapability': {
      // 数据驱动：取玩家实际持有、grantsCapability 含该能力的第一件的真实名（装备槽优先·其次背包）。
      // ⇒ 未来任何授予该能力的新道具自动命名·无需在此登记。
      if (run) {
        for (const slot of EQUIPMENT_SLOTS) {
          const inst = run.equipment[slot];
          if (!inst) continue;
          const def = getItemDef(inst.itemId);
          if (def?.grantsCapability?.includes(c.capability)) return def.name;
        }
        for (const inv of run.inventory) {
          if (inv.qty <= 0) continue;
          const def = getItemDef(inv.itemId);
          if (def?.grantsCapability?.includes(c.capability)) return def.name;
        }
      }
      return capabilityFallbackLabel(c.capability);
    }
    case 'hasEquipment': {
      const inst = run?.equipment[c.slot] ?? null;
      const name = inst ? getItemDef(inst.itemId)?.name : undefined;
      return name ?? equipmentSlotFallbackLabel(c.slot);
    }
    case 'hasItem':
      return getItemDef(c.itemId)?.name ?? c.itemId;
    case 'hasUpgrade':
      return getUpgradeDef(c.upgradeId)?.name ?? c.upgradeId;
    case 'all':
    case 'any':
      // 复合条件：取第一个满足的**持有类**子条件的归因（跳过数值/flag/欺骗类——它们不是「你带了什么」）。
      // any：满足的那条即产出归因；all：全满足·取第一条有归因的（通常一件门·多件时报头一件）。
      for (const sub of c.of) {
        if (!evalCondition(state, sub)) continue;
        const a = attributionOf(state, sub);
        if (a) return a;
      }
      return null;
    // 非持有类（数值 / flag / 信任 / notHas*）：不产出「持有某道具」归因。
    case 'notHasItem':
    case 'statAtLeast':
    case 'statAtMost':
    case 'hasFlag':
    case 'notHasFlag':
    case 'depthAtLeast':
    case 'npcTrustTier':
    case 'atSeabed':
      return null;
  }
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

/**
 * 用力动作（exertion）的默认基础体力消耗（#289·作者 2026-07-11·占位·defer-number-tuning）。
 * 挖矿/凿洞等 exertion 结果若没显式 staminaCost，就按此值扣（再乘负重体力倍率）——
 * 让「负重同时放大体力与氧耗」对挖矿也成立（挖矿旧数据只有 oxygenTurnCost、无体力字段）。
 */
const EXERTION_BASE_STAMINA = 3;

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
    // 额外氧气消耗（按"标准回合数"）。exertion（用力动作·挖矿/凿洞等·#289·作者 2026-07-11）⇒ ×负重氧耗倍率（轻＝×1 逐字节不变）。
    if (outcome.oxygenTurnCost) {
      const cost = outcome.exertion
        ? Math.ceil(outcome.oxygenTurnCost * weightO2Mult(s.run.equipment))
        : outcome.oxygenTurnCost;
      stats.oxygen -= cost;
    }
    // 用力动作的体力消耗（#289·作者 2026-07-11「负重同时加体力和氧」）：exertion ⇒ 默认基础体力（staminaCost 覆盖）×负重体力倍率；
    // 非 exertion 仅按显式 staminaCost 扣、不乘负重（旧数据无此字段＝0＝逐字节不变）。
    if (outcome.exertion) {
      const base = outcome.staminaCost ?? EXERTION_BASE_STAMINA;
      stats.stamina -= Math.ceil(base * weightStaminaMult(s.run.equipment));
    } else if (outcome.staminaCost) {
      stats.stamina -= outcome.staminaCost;
    }
    stats = clampStats(stats, {
      stamina: s.run.staminaMax,
      oxygen: s.run.oxygenMax,
      hp: s.run.hpMax,
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
        // 深度加权战利品（lootFactorForDepth）已随深度柱/band 系统删除（2026-07-12）——loot 现为平量 roll·
        // 深度加权待经济重做（TODO）。
        const qty = min + Math.floor(Math.random() * (max - min + 1));
        if (qty > 0) {
          // 背包承载（重量制·#资源重量制 2026-06-21）：dive 期间 run 背包加这件后超 carryWeightLimit → 跳过该件并日志提示
          // （不阻断整个事件·其余 loot 继续 roll）。inv 是本事件累计的工作副本——含本轮已拾的其它件，焊死「一个事件塞爆」。
          // 港口侧（无 run）仓库无承载上限，照旧不限。
          // dev 试玩 unlimitedSupplies：拾取不计负重（缺省 undefined ⇒ 照常超载跳过·逐字节等价）。
          if (s.run && !s.run.devFlags?.unlimitedSupplies && totalRunInventoryWeight(inv) + weightForItem(roll.itemId, qty) > s.run.carryWeightLimit) {
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
 * @param event 父事件（用于写 event_seen 标记·oncePerSave 门）。**凡解析「真·游戏内事件」都必须传**——
 *   漏传则 oncePerSave 的 event_seen 不会落 profile.flags，该事件会跨 run 静默重播（LLM 试玩 harness 曾因此
 *   每次复潜重播整段教学 + 复制 mentor_logbook·见 QUIRKS）。形参留 `?` 仅为少数「合成选项·无父事件」
 *   的回归脚本便利；harness/真实路径一律传。守门：`check-harness-resolveoption`（tools/playtest-llm 内调用须 3 参）。
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
  // dev 试玩 godMode：氧气不耗、氮气不累积 ⇒ 潜行不因缺氧溺亡、也不攒减压债（缺省 undefined 逐字节等价）。
  const god = run.devFlags?.godMode ?? false;
  const oxygenDrain = god ? 0 : turns * 1 * depthFactor * (opts?.o2CostMult ?? 1);

  // 温度：按洞双极局部债（按 run.zoneId 查侧表·潜服 insulation 抵消·深度无关）·见 engine/temperature.ts。
  // 中性洞（侧表未命中·绝大多数 zone）→ intensity 0 → ceiling 0 → thermalStress 趋 0（恢复）⇒ 行为逐字节不变。
  const thermalIntensity = getCaveTemperature(run.zoneId).intensity;
  const insulation = loadoutInsulation(run.equipment);

  const stats: Stats = {
    ...run.stats,
    oxygen: Math.max(0, run.stats.oxygen - oxygenDrain),
    // 氮气：饱和模型（深度定 ceiling·停留定逼近·同一式同管吸/排）·见 engine/nitrogen.ts（godMode 冻结＝不攒债）
    nitrogen: god ? run.stats.nitrogen : stepNitrogen(run.stats.nitrogen, depth, turns),
    // 温度：指数逼近 ceiling（同管累积/恢复）·逐回合 step == 一次性 step(turns)（守 stalker 一致性·同氮气）
    thermalStress: stepThermalStress(run.stats.thermalStress, thermalIntensity, insulation, turns),
  };
  // 温度超阈后果（温度 SPEC §5）：热应力过 WARN → 扣体力（热极脱力 / 冷极麻木·叙事分极性·数学同款）。
  // 用进入本段前的应力估算（与氧耗同口径·确定性）。中性洞应力恒 0 ⇒ drain 0 ⇒ 体力不动（逐字节不变）。
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
