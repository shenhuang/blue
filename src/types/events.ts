// 事件 schema —— 与主 SPEC §12 对齐
// 数据驱动：所有事件由 JSON 配置，引擎在运行时按 depth/flags 过滤抽取

import type { Stat } from './state';
import type { EquipmentSlot } from './items';

export type Tone = 'realistic' | 'uncanny' | 'cosmic';

export type ZoneTag =
  | 'shallow'
  | 'reef'
  | 'slope'
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
  // 开阔水域声呐渲染档（开阔水域 SPEC §4·节点 zoneTag 一物两用：选声呐海床形态 + 偏置事件/材质池）：
  | 'sand' // 沙原（平滑沙波·无结构）
  | 'coral' // 珊瑚礁（低矮致密软珊瑚扇 + 圆钝瘤/顶）
  | 'rock' // 岩矿礁（圆钝大礁石·岩矿档 mine-gated 矿物掉落）
  | 'atoll' // 珊瑚礁混合档（2026-07-14·礁石打底+珊瑚密布其上·别跟上面通用内容 tag 'reef' 搞混——那个是深度带内容池标签、这个是开阔水域渲染档专属）
  // 洞型谱三变体新区（mapShape='maze'·各带专属事件池·depthCurveRange 把同一迷路机制铺成三种洞型·见 mapgen.ts caveShapeBucket）
  // ——2026-07-12 洞穴内容整删：本段原举例的三条 zone（shaft_crack/chamber_network/flooded_gallery）已随
  // 27 条真实洞穴 zone 一并删除（见 QUIRKS）；tag 定义本身仍有效，留给作者未来重建洞穴内容时复用：
  | 'crack' // 竖穴裂缝（depthCurveRange 低·k<0.8 井+廊·先陡降后横走·窄）
  | 'chamber' // 稀疏蜂巢（depthCurveRange 中·匀速~廊道·连通蜂房·节点疏）
  | 'flooded'  // 漫水回廊（depthCurveRange 高·k>1.45 长平廊+尽头深坑·横向探索·窄 span）
  // 洞穴扩充 Batch 0 新标签（cave_zones_spec.md·现为历史参考·实际 zone 已随 2026-07-12 整删）：
  | 'tide'      // 浅潮洞（8–44m）：潮汐主导、涨退压力、藤壶顶、气腔
  | 'grotto'    // 石窟厅（20–82m）：矿物柱、骨床、声学异常、静态美与不安
  | 'deep_cave' // 深穴（35–124m）：黑暗+静水+地质+设备边缘
  | 'chasm';    // 深裂隙（90–148m）：氮醉边界+设备极限+"这里不像水"

/** 一个下潜事件 */
export interface DiveEvent {
  id: string;

  // —— 触发条件 ——
  depthRange: [number, number]; // [min, max] 米
  zoneTags?: ZoneTag[];
  weight: number; // 抽取权重；教程事件可设为 0（仅通过 forceTrigger 进入）
  /**
   * POI 专属事件池（POI 固定资源耗尽 SPEC·2026-06-25 / roaming 内容·2026-06-25）。设了 poiId ⇒ 本事件**只**在
   * 下潜该 POI 时进 buildEventPool；没设 ⇒ 照旧按 zoneTags/depthRange/flags 过滤（存量事件零影响）。匹配两条 lane：
   *   - **anchor**：poiId ＝ anchor 的稳定 `id`（运行时 opts.poiId === poiId·精确匹配）。
   *   - **roaming**：poiId ＝ roaming 模板的 `templateId`（实例 id `poi.roam.<runs>.<tpl>` 每次变、配不上静态值；
   *     dive-start 另透传稳定 templateId·opts.poiTemplateId === poiId 即命中）。**roaming 内容按 templateId 钉**。
   * poiId 必须命中 chart_pois.json 里的 `id`（anchors）或 `templateId`（roamingTemplates）——
   * scripts/check-event-poi.mjs 守成 regress 门（拼错＝事件永不进池＝软锁·被挡）。
   */
  poiId?: string;
  cooldown?: number; // 同次下潜事件冷却（多少回合后才能再次抽取）
  oncePerRun?: boolean;
  oncePerSave?: boolean;
  prereqEventIds?: string[];
  /**
   * 钉放剧情变体专用「禁经过事件」门（forbiddenFlags 的事件版·镜像 prereqEventIds）：
   * 列出的事件**任一**已被见过（profile.flags 有 `event_seen:<id>`）⇒ 本事件不合规、跳过。
   * 与 prereqEventIds 同样**只在 dive-start.ts::startDiveFromPoi 的 storyOpenEvents 选择处生效**
   * （weight<=0 钉放变体不进 buildEventPool·见 zones.ts 注释）。用于「同一地点·进度互斥的两个节拍」：
   * 一个 prereqEventIds:[X]（X 后才出），另一个 forbiddenEventIds:[X]（X 前才出）——
   * 用引擎自维护的 `event_seen:` 做单一真相，免去靠手写 flag 在每个 outcome 里记得置位（那正是
   * `flag.seen_first_uncanny` 漏在 grab_log 没置、二次重访静默断链的根因·quirk #174/#189）。
   */
  forbiddenEventIds?: string[];
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
  /**
   * 额外体力消耗（用力动作·挖矿/凿洞等·作者 2026-07-11）。与 oxygenTurnCost 对称：applyOutcome 直接扣。
   * exertion 为真时再乘负重体力倍率（weightStaminaMult）；不填而 exertion 为真则走引擎默认基础体力。
   */
  staminaCost?: number;
  /**
   * 该结果是否为「用力动作」（战斗以外的用力·挖矿/凿洞/撬开等·作者 2026-07-11）。
   * 为真 ⇒ applyOutcome 把 oxygenTurnCost×weightO2Mult、（默认/显式）staminaCost×weightStaminaMult（负重档位放大·轻＝×1 逐字节不变）。
   * 缺省/假 ⇒ 逐字节不变（普通「花时间看一眼」的事件不吃负重税·符合「用力才加税」约定）。
   */
  exertion?: boolean;
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
  /**
   * NPC 信任档门控（通用信任系统·藏宝贸易与信任系统 SPEC §3.4）：该 NPC 的派生信任档 ≥ minTier 即满足。
   * 复用本 DSL ⇒ 同一原语同时门控对话 visibleIf 与商店货品 minTrustTier；档由 engine/trust.ts::trustTier 派生。
   * npcId 必须是真 NPC（check-npc-trust 守）。
   */
  | { kind: 'npcTrustTier'; npcId: string; minTier: number }
  | { kind: 'all'; of: Condition[] }
  | { kind: 'any'; of: Condition[] };
