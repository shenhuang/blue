// 剧情编辑器支撑（纯叶子·只读 EVENT_DB / 不引 UI）—— 「一键满足条件」的脑子。
//
// 目的：给一个 eventId，算出一组状态覆写（ScenarioInput），让该事件能落点、且其选项
// 尽量全部可见/可过——这样剧情编辑器里「永远满足任何条件」是一个纯函数，可被 regress 守。
//
// 设计要点：
//   1. 两层满足。**门槛满足**（depth/zone/sanity/prereqFlags/¬forbiddenFlags/¬event_seen）恒做；
//      **选项揭示**（每个 option.visibleIf / check / hallucination）尽力做。
//   2. 诚实暴露互斥。有些条件天生不能同时满足（幻觉 sanity≤50 vs 正常、statAtMost vs 高 DC、
//      同一 flag 既被要求又被禁止）——这些进 conflicts[]，不假装全亮（守「越深越欺骗」设计轴）。
//   3. 不复刻 evalCondition/isOptionVisible：本函数只「产出覆写」，真正判定仍由 events.ts 跑。
//      由 playthrough-satisfy.ts 闭环校验：satisfyEvent → runEventScenario 首步无意外 hidden。
//   4. 数据现状（2026-06：仅 hasEquipment{tool} + 少量 sanityRange/prereq/forbiddenFlags 在用）下
//      多数事件本就默认可满足；本函数覆盖全 Condition 种类，为编辑器后续加门控选项留好机制。

import type {
  DiveEvent,
  Condition,
  Stat,
  Stats,
  ZoneTag,
  EquipmentLoadout,
  EquipmentInstance,
} from '@/types';
import type { ScenarioInput } from './eventScenario';
import { getEventById } from './zones';
import { createStarterLoadout } from './state';

type EquipSlot = keyof EquipmentLoadout; // 'tank' | 'suit' | 'light' | 'tool' | 'charm'

// ---------------------------------------------------------------------------
// 事件级触发门槛（只读快照）——给「条件读出」UI 与 satisfyEvent 共用一份来源
// ---------------------------------------------------------------------------

export interface EventGate {
  eventId: string;
  depthRange: [number, number];
  zoneTags: ZoneTag[];
  sanityRange: [number, number] | null;
  prereqFlags: string[];
  forbiddenFlags: string[];
  prereqEventIds: string[];
  oncePerRun: boolean;
  oncePerSave: boolean;
  cooldown: number | null;
  /** weight<=0：mapgen 抽不到、只能强制触发。对编辑器不是阻塞（本就直接落点），仅作信息提示。 */
  forceOnly: boolean;
}

/** 取事件级门槛快照；events 覆盖优先（测内存里未保存的编辑）。 */
export function eventGate(
  eventId: string,
  events?: Map<string, DiveEvent>,
): EventGate | null {
  const ev = events?.get(eventId) ?? getEventById(eventId);
  if (!ev) return null;
  return {
    eventId: ev.id,
    depthRange: ev.depthRange,
    zoneTags: ev.zoneTags ?? [],
    sanityRange: ev.sanityRange ?? null,
    prereqFlags: ev.prereqFlags ?? [],
    forbiddenFlags: ev.forbiddenFlags ?? [],
    prereqEventIds: ev.prereqEventIds ?? [],
    oncePerRun: !!ev.oncePerRun,
    oncePerSave: !!ev.oncePerSave,
    cooldown: ev.cooldown ?? null,
    forceOnly: ev.weight <= 0,
  };
}

// ---------------------------------------------------------------------------
// satisfyEvent 结果
// ---------------------------------------------------------------------------

export interface SatisfyConflict {
  scope: 'flag' | 'stat' | 'depth' | 'sanity' | 'equipment' | 'prereqEvent';
  /** 人类可读的「为什么调和不了」。 */
  detail: string;
  /** 受影响的选项 id（如该互斥来自某个 option.visibleIf）。 */
  optionId?: string;
}

export interface SatisfyResult {
  /** 直接喂 runEventScenario(...)。 */
  input: ScenarioInput;
  /** 事件级门槛快照（UI 条件读出复用）。 */
  gate: EventGate;
  /** 调和不了的互斥点（逐条）。空 = 该事件所有门槛+选项可一次同时满足。 */
  conflicts: SatisfyConflict[];
  /** 有意留作隐藏的选项 id（未开幻觉模式时的 hallucination 选项 / 因冲突无法揭示者）。regress 放行用。 */
  intentionallyHidden: string[];
}

export interface SatisfyOptions {
  /** 走幻觉分支：把 sanity 压到 ≤50 让 hallucination 选项现身（与正常 sanity 互斥）。默认 false。 */
  hallucinations?: boolean;
  /** 让带检定的选项倾向通过：把对应属性顶到 dc+30。默认 true（只影响成功率，不影响可见性）。 */
  passChecks?: boolean;
  /** 固定 RNG 种子（默认 1·确定性）。 */
  seed?: number;
  /** 测内存里未保存的事件（编辑器用）；缺省走 EVENT_DB。 */
  events?: Map<string, DiveEvent>;
}

// ---------------------------------------------------------------------------
// 条件收集器：把一棵 Condition 树摊平成「需要的状态」累加器
// ---------------------------------------------------------------------------

const HALLUCINATION_SANITY_MAX = 50; // 与 events.ts isOptionVisible / eventScenario describeHiddenReason 同阈值

interface Accum {
  requiredFlags: Set<string>;
  forbiddenFlags: Set<string>;
  statFloor: Map<Stat, number>;
  statCap: Map<Stat, number>;
  items: Map<string, number>;
  equipSlots: Set<EquipSlot>;
  upgrades: Set<string>;
  depthFloor: number | null;
}

function newAccum(): Accum {
  return {
    requiredFlags: new Set(),
    forbiddenFlags: new Set(),
    statFloor: new Map(),
    statCap: new Map(),
    items: new Map(),
    equipSlots: new Set(),
    upgrades: new Set(),
    depthFloor: null,
  };
}

function raiseFloor(m: Map<Stat, number>, stat: Stat, v: number): void {
  m.set(stat, Math.max(m.get(stat) ?? -Infinity, v));
}
function lowerCap(m: Map<Stat, number>, stat: Stat, v: number): void {
  m.set(stat, Math.min(m.get(stat) ?? Infinity, v));
}

/** 把一棵 visibleIf Condition 摊进累加器。'any' 取一个最省的子条件。 */
function collect(cond: Condition, acc: Accum): void {
  switch (cond.kind) {
    case 'hasFlag':
      acc.requiredFlags.add(cond.flag);
      return;
    case 'notHasFlag':
      acc.forbiddenFlags.add(cond.flag);
      return;
    case 'statAtLeast':
      raiseFloor(acc.statFloor, cond.stat, cond.value);
      return;
    case 'statAtMost':
      lowerCap(acc.statCap, cond.stat, cond.value);
      return;
    case 'depthAtLeast':
      acc.depthFloor = Math.max(acc.depthFloor ?? -Infinity, cond.value);
      return;
    case 'hasItem':
      acc.items.set(cond.itemId, Math.max(acc.items.get(cond.itemId) ?? 0, cond.minQty ?? 1));
      return;
    case 'hasEquipment':
      acc.equipSlots.add(cond.slot);
      return;
    case 'hasUpgrade':
      acc.upgrades.add(cond.upgradeId);
      return;
    case 'all':
      for (const sub of cond.of) collect(sub, acc);
      return;
    case 'any': {
      if (cond.of.length === 0) return;
      // 取一个「不会立刻和已累加的 required/forbidden 撞」的子条件；都撞就取第一个（交给冲突检测）。
      const clean =
        cond.of.find(
          (c) =>
            !(c.kind === 'hasFlag' && acc.forbiddenFlags.has(c.flag)) &&
            !(c.kind === 'notHasFlag' && acc.requiredFlags.has(c.flag)),
        ) ?? cond.of[0];
      collect(clean, acc);
      return;
    }
  }
}

// ---------------------------------------------------------------------------
// 装备槽位填充：起手装备已填 tank/suit/light/tool，charm 缺省 null
// ---------------------------------------------------------------------------

function equipInstanceForSlot(slot: EquipSlot): EquipmentInstance {
  const starter = createStarterLoadout();
  const fromStarter = starter[slot];
  if (fromStarter) return fromStarter;
  // 起手没有这个槽（如 charm）：合成一个占位实例——hasEquipment 只校验该槽非空。
  return { itemId: `item.__satisfy_${slot}`, slot, level: 1 } as EquipmentInstance;
}

// ---------------------------------------------------------------------------
// 主函数
// ---------------------------------------------------------------------------

const ALL_STATS: Stat[] = ['stamina', 'oxygen', 'sanity', 'nitrogen'];

export function satisfyEvent(eventId: string, opts: SatisfyOptions = {}): SatisfyResult {
  const passChecks = opts.passChecks ?? true;
  const seed = opts.seed ?? 1;
  const ev = opts.events?.get(eventId) ?? getEventById(eventId);

  const gate = eventGate(eventId, opts.events);
  const conflicts: SatisfyConflict[] = [];
  const intentionallyHidden: string[] = [];

  if (!ev || !gate) {
    return {
      input: { eventId, seed, chain: 'follow' },
      gate: gate ?? {
        eventId,
        depthRange: [0, 0],
        zoneTags: [],
        sanityRange: null,
        prereqFlags: [],
        forbiddenFlags: [],
        prereqEventIds: [],
        oncePerRun: false,
        oncePerSave: false,
        cooldown: null,
        forceOnly: true,
      },
      conflicts: [{ scope: 'flag', detail: `事件 "${eventId}" 不在库中` }],
      intentionallyHidden: [],
    };
  }

  // ----- 累加事件级门槛 -----
  const acc = newAccum();
  for (const f of gate.prereqFlags) acc.requiredFlags.add(f);
  for (const f of gate.forbiddenFlags) acc.forbiddenFlags.add(f);

  // ----- 累加每个选项的可见性条件（只看 visibleIf；check 不影响可见性，稍后单独抬属性） -----
  const wantHalluc = !!opts.hallucinations;
  const hasHalluc = ev.options.some((o) => o.hallucination);
  for (const opt of ev.options) {
    // 幻觉选项：要 sanity ≤ 50 才现身。不开幻觉模式则有意留它隐藏（非冲突·是模式）。
    if (opt.hallucination && !wantHalluc) {
      intentionallyHidden.push(opt.id);
      continue;
    }
    if (opt.visibleIf) collect(opt.visibleIf, acc);
  }

  // ----- check：让带检定选项倾向通过——抬属性地板，但不越过 statAtMost 的 cap（可见性优先于过检定） -----
  // sanity 不在此抬：它由下方单独钉（与幻觉模式 ≤50 互斥·默认满血对 sanity 检定本就最有利）。
  if (passChecks) {
    for (const opt of ev.options) {
      if (opt.hallucination && !wantHalluc) continue;
      if (!opt.check || opt.check.stat === 'sanity') continue;
      const want = opt.check.dc + 30;
      const cap = acc.statCap.get(opt.check.stat);
      raiseFloor(acc.statFloor, opt.check.stat, cap !== undefined ? Math.min(want, cap) : want);
    }
  }

  // ----- sanity 单独定：唯一影响可见性的是 hallucination 阈值；sanityRange 只是池门（runner 直接落点·不需要） -----
  // 默认满血（对正常选项 + sanity 检定都最有利）；幻觉模式压到 ≤50 让 hallucination 选项现身。
  const sanity = wantHalluc && hasHalluc ? HALLUCINATION_SANITY_MAX : 100;

  // ----- flag 调和：required ∩ forbidden = 冲突 -----
  for (const f of acc.requiredFlags) {
    if (acc.forbiddenFlags.has(f)) {
      conflicts.push({ scope: 'flag', detail: `flag "${f}" 既被要求又被禁止` });
    }
  }
  const finalFlags = [...acc.requiredFlags].filter((f) => !acc.forbiddenFlags.has(f));
  // oncePerSave：只要不带 event_seen:<id> 就过——finalFlags 本就不含它。

  // ----- 非 sanity 属性调和：floor > cap = 真冲突（statAtLeast/检定 vs statAtMost·同一属性） -----
  const statsOverride: Partial<Stats> = { sanity };
  for (const stat of ALL_STATS) {
    if (stat === 'sanity') continue;
    const floor = acc.statFloor.get(stat);
    const cap = acc.statCap.get(stat);
    if (floor !== undefined && cap !== undefined && floor > cap) {
      conflicts.push({ scope: 'stat', detail: `${stat} 需 ≥${floor} 又需 ≤${cap}` });
      statsOverride[stat] = cap; // 取 cap 保 statAtMost 硬门槛过
    } else if (floor !== undefined) {
      statsOverride[stat] = floor;
    } else if (cap !== undefined) {
      statsOverride[stat] = cap;
    }
  }

  // ----- depth 调和：落进 depthRange，且 ≥ depthFloor -----
  let depth = gate.depthRange[0];
  if (acc.depthFloor !== null) {
    if (acc.depthFloor > gate.depthRange[1]) {
      conflicts.push({
        scope: 'depth',
        detail: `选项需深度 ≥${acc.depthFloor}m，但事件 depthRange 上限 ${gate.depthRange[1]}m 更浅`,
      });
      depth = gate.depthRange[1];
    } else {
      depth = Math.min(Math.max(acc.depthFloor, gate.depthRange[0]), gate.depthRange[1]);
    }
  }

  // ----- 装备 / 物品 / 升级 -----
  const equipment: Partial<EquipmentLoadout> = {};
  for (const slot of acc.equipSlots) equipment[slot] = equipInstanceForSlot(slot);
  const inventory = [...acc.items].map(([itemId, qty]) => ({ itemId, qty }));
  const unlockedUpgrades = [...acc.upgrades];

  // ----- 组装 ScenarioInput -----
  const input: ScenarioInput = {
    eventId,
    depth,
    stats: statsOverride,
    profileFlags: finalFlags,
    seed,
    chain: 'follow',
    maxSteps: 12,
  };
  if (inventory.length > 0) input.inventory = inventory;
  if (Object.keys(equipment).length > 0) input.equipment = equipment;
  if (unlockedUpgrades.length > 0) input.unlockedUpgrades = unlockedUpgrades;

  return { input, gate, conflicts, intentionallyHidden };
}

// ---------------------------------------------------------------------------
// 事件级门槛人类可读化（条件读出 UI 用·每条一行）
// ---------------------------------------------------------------------------

export function describeEventGate(gate: EventGate): string[] {
  const lines: string[] = [];
  lines.push(`深度 ${gate.depthRange[0]}–${gate.depthRange[1]}m`);
  if (gate.zoneTags.length > 0) lines.push(`区域标签 ∈ {${gate.zoneTags.join(', ')}}`);
  if (gate.sanityRange) lines.push(`理智 ${gate.sanityRange[0]}–${gate.sanityRange[1]}`);
  if (gate.prereqFlags.length > 0) lines.push(`需要 flag：${gate.prereqFlags.join(', ')}`);
  if (gate.forbiddenFlags.length > 0) lines.push(`禁止 flag：${gate.forbiddenFlags.join(', ')}`);
  if (gate.prereqEventIds.length > 0) lines.push(`需先经过事件：${gate.prereqEventIds.join(', ')}`);
  if (gate.oncePerSave) lines.push('本存档只触发一次');
  if (gate.oncePerRun) lines.push('本次下潜只触发一次');
  if (gate.cooldown !== null) lines.push(`冷却 ${gate.cooldown} 回合`);
  if (gate.forceOnly) lines.push('weight=0：仅强制触发（mapgen 随机抽不到）');
  return lines;
}
