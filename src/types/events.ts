// 事件 schema —— 与主 SPEC §12 对齐
// 数据驱动：所有事件由 JSON 配置，引擎在运行时按 depth/sanity/flags 过滤抽取

import type { Stat } from './state';

export type Tone = 'realistic' | 'uncanny' | 'cosmic';

export type ZoneTag =
  | 'shallow'
  | 'reef'
  | 'wreck'
  | 'cave'
  | 'coastal'
  | 'twilight'
  | 'midnight'
  | 'abyssal'
  | 'ruins'
  | 'tutorial';

/** 一个下潜事件 */
export interface DiveEvent {
  id: string;

  // —— 触发条件 ——
  depthRange: [number, number]; // [min, max] 米
  zoneTags?: ZoneTag[];
  sanityRange?: [number, number];
  weight: number; // 抽取权重；教程事件可设为 0（仅通过 forceTrigger 进入）
  cooldown?: number; // 同次下潜事件冷却（多少回合后才能再次抽取）
  oncePerRun?: boolean;
  oncePerSave?: boolean;
  prereqEventIds?: string[];
  prereqFlags?: string[];
  forbiddenFlags?: string[];

  // —— 文本与呈现 ——
  title: string;
  body: string; // 支持模板：{player.name} {depth}
  tone: Tone;

  options: EventOption[];

  /** 进入此事件时的"被动"结果，可选 */
  onEnter?: Outcome;
}

/** 事件选项 */
export interface EventOption {
  id: string;
  label: string;

  /** 显示条件（不满足则灰显或隐藏） */
  visibleIf?: Condition;
  hiddenIfFails?: boolean; // visibleIf 不满足时是否隐藏（true）或灰显（false）

  /** 幻觉选项：仅当玩家理智低于阈值时出现，且结果通常是坏的 */
  hallucination?: boolean;

  /** 是否需要属性检定 */
  check?: SkillCheck;

  /** 无检定时直接结算 */
  outcome?: Outcome;
}

export interface SkillCheck {
  stat: Stat;
  dc: number; // 难度
  onSuccess: Outcome;
  onFailure: Outcome;
}

/** 选项触发的结果 */
export interface Outcome {
  text?: string;
  deltas?: Partial<Record<Stat, number>>;
  /** 额外消耗 N 个"标准下潜回合"的氧气（除常规 -1 之外） */
  oxygenTurnCost?: number;
  loot?: LootRoll[];
  applyFlags?: string[];
  removeFlags?: string[];
  triggerEventId?: string; // 链式事件
  triggerCombatId?: string; // 引发战斗
  endDive?: 'forceAscend' | 'death';
  goldDelta?: number;
  loreEntry?: string;
}

/** 掉落表条目 */
export interface LootRoll {
  itemId: string;
  qty: [number, number]; // 范围
  chance?: number; // 0-1，默认 1
}

/** 显示条件（visibleIf） */
export type Condition =
  | { kind: 'hasEquipment'; slot: 'tank' | 'suit' | 'light' | 'tool' | 'charm' }
  | { kind: 'hasItem'; itemId: string; minQty?: number }
  | { kind: 'statAtLeast'; stat: Stat; value: number }
  | { kind: 'statAtMost'; stat: Stat; value: number }
  | { kind: 'hasFlag'; flag: string }
  | { kind: 'notHasFlag'; flag: string }
  | { kind: 'depthAtLeast'; value: number }
  | { kind: 'all'; of: Condition[] }
  | { kind: 'any'; of: Condition[] };
