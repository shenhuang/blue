// 灯塔基地（多基地）数据模型 + 每灯塔设施升级 —— 基建地图 SPEC §3
//
// Phase B 范围：**数据模型 + 引擎脚手架**。灯塔此刻 inert——
// 设施效果（点亮半径 reveal / 出海拉近 reach）由 Phase C 的 chart.ts/dive.ts 消费；
// 本阶段只把类型钉死 + 聚合成 LighthouseBonuses 供 Phase C 读取。

import type { UpgradeCost } from './upgrades';

/**
 * 一座灯塔基地（持久，进存档）。家＝第一座灯塔（lighthouse.home，守灯人 Aldo 所在的港口）。
 * 其它灯塔是前哨，靠"修复下潜中发现的废弃灯塔"获得（Phase C）。
 */
export interface Lighthouse {
  id: string;
  name: string;
  /** 海图坐标（0–1 归一化，复用 POI 那套；港口/家在最左 mapX≈0.06） */
  mapX: number;
  mapY: number;
  /** 灯塔等级：决定点亮半径基准 + 可建哪些设施升级（reveal 由 Phase C 消费） */
  level: number;
  /** 该灯塔自己的设施升级集合（与全局随身装备升级 profile.unlockedUpgrades 分开，互不污染） */
  builtUpgrades: Set<string>;
  /** —— 以下为 Phase D（invasion/defense）预留，现在 inert（引擎不读不写、不进任何分支）—— */
  integrity?: number;
  /** 锚定的海域 region id（inert，留给 region 级 threat） */
  region?: string;
}

/**
 * 灯塔设施升级的效果。Phase C 消费（reveal/reach）；Phase B 仅由 getLighthouseBonuses 聚合。
 * 未来扩：服务型（尸体提示/自由上浮/减压）、防御型。
 */
export type LighthouseEffect =
  | { kind: 'lightRadiusBonus'; value: number } // 揭示半径 +value（叠加在 level 基准上）
  | { kind: 'reachReduction'; value: number } // 出海 distance -value（reach 拉近）
  | { kind: 'extraConsumableSlot'; value: number } // 随身消耗品槽 +value（家灯塔「船坞」设施，桥接进 run 加成；Phase C 迁移自全局 dockyard）
  // —— 深水区 Phase 2b 前哨能源经济（base 层；engine/outposts.ts 消费）——
  | { kind: 'energyGen'; value: number } // 水力发电：能源产出 +value（仅在水流 current 前哨有产出，否则计 0）
  | { kind: 'energyDraw'; value: number } // 设施能源占用 +value（超出该前哨能源容量的设施掉线）
  | { kind: 'rechargeBonus'; value: number } // 充电设施：从该前哨蛙跳时电池总量 +value（设施在线才生效）
  | { kind: 'oxygenSupply'; value: number } // 充氧设施：从该前哨蛙跳时氧气上限 +value（设施在线才生效）
  | { kind: 'storageCapacity'; value: number } // 材料中转/寄存设施：该前哨可寄存 +value 单位材料（深水区 Phase 2b 续；engine/outposts.ts 消费，**不耗能源**＝被动库房恒可用）
  | { kind: 'dimRevealBonus'; value: number }; // 勘测站：在该灯塔正常点亮半径之外再多照一圈「暗区」（dim·可见但过不去）；value 级数乘 LIGHT_RADIUS_PER_BONUS = 额外勘测半径（Req A·chart.ts 消费）

/** 一条灯塔设施升级定义。账单复用全局的材料＋金币双资源 UpgradeCost（Phase A）。 */
export interface LighthouseUpgradeDef {
  id: string;
  /** 在所属设施轨内的级数（1..N，同轨连续） */
  level: number;
  name: string;
  cost: UpgradeCost;
  effects: LighthouseEffect[];
  description: string;
  /** 需要灯塔达到该 level 才能建（缺省 1） */
  requiresLighthouseLevel?: number;
}

/** 一条灯塔设施升级轨（如"信标光源"）。 */
export interface LighthouseTrack {
  id: string;
  name: string;
  description: string;
  upgrades: LighthouseUpgradeDef[];
  /** true = 只能建在家灯塔（如船坞）。建造 UI 对前哨灯塔隐藏此轨。 */
  homeOnly?: boolean;
  /** true = 只能建在 OutpostDef 支撑的深水前哨（充电/制氧/水力等能源设施）；家/废墟灯塔隐藏。深水区 Phase 2b。 */
  outpostOnly?: boolean;
  /** true = 只能建在水流（current）前哨（水力发电；静水前哨建了也不产电）。深水区 Phase 2b。 */
  currentOnly?: boolean;
}

/**
 * 一座废弃灯塔的修复定义（基建地图 Phase C）。下潜中遇到 `lighthouse_ruin` 事件，
 * 付一份材料＋金币账单（复用 UpgradeCost，T2/T3 量级）即可点亮一座新灯塔。
 * 修复＝把 `result` push 进 profile.lighthouses（builtUpgrades 由引擎初始化为空 Set）。
 */
export interface LighthouseRuinDef {
  id: string;
  /** 账单：材料 ＋ 金币，复用全局双资源模型（engine/lighthouses.ts 消费）。 */
  cost: UpgradeCost;
  /** 修复成功后上线的灯塔。 */
  result: {
    id: string;
    name: string;
    mapX: number;
    mapY: number;
    level: number;
    region?: string;
  };
}

/**
 * 一个前哨建造阶段（深水区 Phase 2a 跨 run 前哨脊柱）。每个 OutpostDef 有 OUTPOST_MAX_STAGE 个阶段
 * （勘察清理 / 运来部件 / 通电点亮）。账单复用全局材料＋金币双资源；advanceOutpost 按当前阶段校验、扣料、
 * 推进一阶。进度靠 profile.flags 的阶段标记持久（半亮扛过死亡）——**不动存档形状、不需迁移**（作者 2026-06-04）。
 */
export interface OutpostStageDef {
  /** 该阶段建造选项的 UI 标签（含账单，给玩家看）。 */
  label: string;
  cost: UpgradeCost;
  /** 完成该阶段（未到点亮）的叙事。 */
  narrative?: string;
}

/**
 * 一座可分阶段建造的深水前哨（深水区 Phase 2a）。复用灯塔网——**点亮即 push 一座 Lighthouse**（沿用 Phase C
 * reveal/reach），但建造是**多阶段、跨 run 持久**（进度＝profile.flags 的 outpostStageFlag，不入 lighthouses 形状）。
 * 建到 OUTPOST_MAX_STAGE（点亮）→ promote：把 result push 进 profile.lighthouses。半亮（≥ OUTPOST_USABLE_STAGE）
 * 即可作蛙跳出潜点：缩短下一更深 band 的蛙跳预耗氧（从前哨所在 band 底起跳、而非从水面）。
 */
export interface OutpostDef {
  id: string;
  name: string;
  /** 本前哨所在的 band（决定蛙跳出潜深度 = 该 band 底；只服务 order 更深的 band）。 */
  bandId: string;
  /**
   * 章节哨站解锁门（章节哨站批·#118 §10 2026-06-12）：设了 = 本哨站是**章节前哨**，
   * 在对应一章锚点节拍（ch1AnchorFlag(requiresAnchor)）置位前为「暗」（已知但不可建·见 outpostUnlocked），
   * 锚点完成后才转「可建」。值为 Ch1Anchor 字符串（'wreck'|'midwater'|'vent'；reef 由 home 灯塔覆盖不设哨站）。
   * **同时把本哨站标记为「章节网」**——与 blue_caves 深 band 线性脊柱解耦：deepestOutpostLaunch
   * 跳过章节哨站（不参与深脊柱自动起跳链），章节蛙跳走显式 launchOutpostId（startDiveFromOutpost）。
   * 缺省（深脊柱前哨 reef_deep/trench_deep/… 不设）→ 无门、行为逐字节不变。
   */
  requiresAnchor?: string;
  /**
   * 章节前哨解锁门（非锚点版·区域揭示配置化 SPEC）：设了 = 本哨站也是**章节前哨**
   * （isChapterOutpost/isChapterBand/isOutpostDiscovered/decoupling 同 requiresAnchor），
   * 但解锁门是任意一个剧情 flag（不占用 story.ts 的 4 个 canon anchor·守 quirk #117/#118）。
   * 海沟区用它：剧情节拍待作者接（占位 flag），dev 一键解锁（devUnlockChapterRegion）置该 flag。
   * requiresAnchor 与 requiresFlag 二选一（前者优先）；都缺省 → 深脊柱前哨·无门。
   */
  requiresFlag?: string;
  /**
   * 发现门（作者 2026-06-14·区域揭示）：章节前哨的「暗·待解锁」标记**只在此剧情 flag 置位后**才在海图现身
   * （不再恒显·见 isOutpostDiscovered）。与解锁门正交：discoveredFlag 决定「看不看得到位置」、
   * requiresFlag/requiresAnchor 决定「能不能建」。缺省＝剧情未接（St1）→ 非 dev 不显示；dev 用海图顶「解锁大区」
   * 直接点亮、或 devRevealOutpost（置 profile.outpostState[id].discovered）模拟发现。
   */
  discoveredFlag?: string;
  /**
   * 水下前哨（会衰减；深水区 Phase 2b）。缺省/false = 水上或前期前哨（只增不减，如 home / ruin_north）。
   * 衰减按"自上次维护以来经过的 run 数"算（profile.outpostState），后果＝设施掉线 / 半亮回退 / 蛙跳失效，
   * 可重新 ferry 材料维护补回（engine/outposts.ts）。
   */
  submerged?: boolean;
  /**
   * 位于水流（激流）区（深水区 Phase 2b §3.6 选址权衡）。true → 衰减更快（维护压力大），
   * 但 energyGen（水力发电）设施才有产出 → 能源足 → 更多补给设施同时在线。缺省 false = 静水（省维护、能源少）。
   */
  current?: boolean;
  /** 建造阶段（索引 0 = 第一阶段；长度 = OUTPOST_MAX_STAGE）。 */
  stages: OutpostStageDef[];
  /** 点亮后 push 进 profile.lighthouses 的灯塔（复用 LighthouseRuinDef.result 形状）。 */
  result: {
    id: string;
    name: string;
    mapX: number;
    mapY: number;
    level: number;
    region?: string;
  };
}

/** lighthouse_upgrades.json 顶层结构。 */
export interface LighthouseUpgradesFile {
  tracks: LighthouseTrack[];
  /** 可修复的废弃灯塔（Phase C 修复循环；缺省空）。 */
  ruins?: LighthouseRuinDef[];
  /** 可分阶段建造的深水前哨（深水区 Phase 2a 跨 run 前哨脊柱；缺省空）。 */
  outposts?: OutpostDef[];
}

/** 聚合某座灯塔已建设施的派生加成（Phase C 读取消费）。 */
export interface LighthouseBonuses {
  lightRadiusBonus: number;
  reachReduction: number;
  /** 随身消耗品槽 +value（仅家灯塔的「船坞」设施会贡献；桥接进 createNewRun 的 run 加成）。 */
  extraConsumableSlot: number;
  // —— 深水区 Phase 2b 前哨能源（engine/outposts.ts 据此做能源容量/在线判定）。这些是**原始**聚合值，
  //     设施是否真在线（受能源容量影响）由 outposts.ts 的 effectiveOutpostBonuses 二次结算。——
  /** 能源产出（水力；仅水流前哨实际产出，见 outposts.ts::outpostEnergy）。 */
  energyGen: number;
  /** 能源占用（所有设施的 draw 之和；用于在线判定）。 */
  energyDraw: number;
  /** 充电设施给的电池总量加成（在线才计入蛙跳 run）。 */
  rechargeBonus: number;
  /** 充氧设施给的氧气上限加成（在线才计入蛙跳 run）。 */
  oxygenSupply: number;
  /** 材料中转/寄存设施给的寄存容量（单位材料数；深水区 Phase 2b 续，engine/outposts.ts 的 depotCapacity 读它）。 */
  storageCapacity: number;
  /**
   * 勘测站加成（Req A）：在该灯塔正常点亮半径之外再多照一圈「暗区」——
   * 勘测半径 = revealRadius + dimRevealBonus × LIGHT_RADIUS_PER_BONUS。
   * 勘测圈内但 reveal 圈外的 POI 显示为 dim（可见不可去）；chart.ts 的 isSurveyDim 消费。
   */
  dimRevealBonus: number;
}
