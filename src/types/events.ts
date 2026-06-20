// 事件 schema —— 与主 SPEC §12 对齐
// 数据驱动：所有事件由 JSON 配置，引擎在运行时按 depth/sanity/flags 过滤抽取

import type { Stat } from './state';
import type { EquipmentSlot } from './items';

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
  | 'hadal'
  | 'subhadal'
  | 'nameless'
  | 'ruins'
  | 'tutorial'
  // St1 一章锚点专属 zone 的事件池（剧情 SPEC §4.1·#117）：
  | 'midwater' // 远洋中层（开阔无底蓝水·锚点③）
  | 'vent' // 海沟热液场（黑烟柱·锚点④）
  | 'whalefall'; // 鲸落（碎屑→机会种→食骨蠕虫的死亡生态·非主线·St1 支线·#137）

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

  /**
   * 隐藏判定（①根治版·#109）：true → EventView 不渲染 check 徽章（玩家看不出这是检定——惊吓/直觉类事件的设计权）。
   * 缺省 → 有 check 就显示「属性 DC」徽章（单一来源＝check.{stat,dc}·label 回归纯 fiction·check-event-dc lint 禁 label 标注回潮）。
   */
  hideCheck?: boolean;

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
  /** 解锁见闻：单条或多条（一拍解锁多条·如教学收尾「两本日志」同时解锁船长日志页 + 导师日志）。 */
  loreEntry?: string | string[];
  /**
   * 修复废弃灯塔（基建地图 Phase C）：引用一个 LighthouseRuinDef.id。
   * applyOutcome 会权威地校验账单（按 profile 银行材料＋金币）并 push 新灯塔到 profile.lighthouses。
   * 与 loreEntry 同属"少数能从下潜里持久写 profile 的 outcome"（其余 flag/loot/gold 都是 run 局部）。
   */
  restoreRuinId?: string;
  /**
   * 推进一座深水前哨的建造一阶（深水区 Phase 2a）：引用一个 OutpostDef.id。applyOutcome 调
   * `engine/lighthouses.ts::advanceOutpost` 按当前阶段权威校验账单（profile 银行材料＋金币）、扣料、
   * 置阶段 flag（持久进度）；建到点亮（OUTPOST_MAX_STAGE）则 push 一座灯塔到 profile.lighthouses。
   * 与 restoreRuinId 同属"少数能从下潜里持久写 profile 的 outcome"。
   */
  advanceOutpostId?: string;
  /**
   * 直接、持久地置一个或多个 **profile** flag（深水区 Phase 3 mimic capstone）。
   * 区别于 `applyFlags`（下潜中只进 run.activeFlags、run 结束即丢）：这些写进 `profile.flags`、跨 run 永久。
   * 与 loreEntry/restoreRuinId/advanceOutpostId 同属"少数能从下潜里持久写 profile 的 outcome"。
   * 用于终局开关（如 `flag.d_reveal`：读穿 mimic 活下来后翻转死者名）+ 跨 run 解锁钩子。**保持暧昧**（#42/#54）。
   */
  setProfileFlags?: string[];
}

/** 掉落表条目 */
export interface LootRoll {
  itemId: string;
  qty: [number, number]; // 范围
  chance?: number; // 0-1，默认 1
}

/** 显示条件（visibleIf） */
export type Condition =
  /**
   * 装备槽门控。slot 单独给＝该槽非空即满足（旧语义·逐字节不变）。
   * 可选 actionId（武器解锁行动门·作者 2026-06-20）：进一步要求该槽装的件**解锁了指定行动**
   * （equipment.effects 含 `{kind:'unlocksAction', actionId}`·见 engine/equipment.ts::equipmentUnlocksAction）。
   * 让「撬开舱门 / 破障」类事件选项只在持救援斧（解锁 action.axe_pry）时可见——数据驱动·不硬编码物品 id。
   */
  | { kind: 'hasEquipment'; slot: EquipmentSlot; actionId?: string }
  | { kind: 'hasItem'; itemId: string; minQty?: number }
  | { kind: 'notHasItem'; itemId: string; minQty?: number }
  | { kind: 'statAtLeast'; stat: Stat; value: number }
  | { kind: 'statAtMost'; stat: Stat; value: number }
  | { kind: 'hasFlag'; flag: string }
  | { kind: 'notHasFlag'; flag: string }
  | { kind: 'hasUpgrade'; upgradeId: string }
  | { kind: 'depthAtLeast'; value: number }
  /**
   * 装备能力门控（工具能力·对应 EquipmentEffect grantsCapability）：
   * 检查所有已装备槽中是否存在任意件带有指定 capability 的 grantsCapability effect。
   * 'cut'  ＝ 持潜水刀才可用的「切割」选项；'mine' ＝ 持岩凿才可用的「采矿」选项。
   * evalCondition 遍历 run.equipment 全槽·engine/events.ts。
   */
  | { kind: 'hasCapability'; capability: string }
  | { kind: 'all'; of: Condition[] }
  | { kind: 'any'; of: Condition[] };
