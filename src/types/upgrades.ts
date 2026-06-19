// 港口升级 schema —— 与主 SPEC §7 元进度对齐
// 数据驱动：所有升级条目由 src/data/upgrades.json 配置，
// 引擎在运行时把已购 upgrade.id 写进 profile.unlockedUpgrades，
// 派生加成由 getUpgradeBonuses() 聚合。

/** 单条升级的副作用 —— 引擎按 kind 分发 */
export type UpgradeEffect =
  | { kind: 'unlockZone'; zoneId: string }
  | { kind: 'extraConsumableSlot'; value: number }
  | { kind: 'oxygenMaxBonus'; value: number }
  | { kind: 'staminaMaxBonus'; value: number }
  | { kind: 'preservationBonus'; value: number }
  | { kind: 'revealCorpseHint'; value: boolean }
  | { kind: 'preDiveCorpseSelect'; value: boolean }
  | { kind: 'currentSweepImmune'; value: boolean }
  // 段2（作者 2026-06-19）：三传感器线（sonar_rig/dive_kit/evasion_rig）退役 → 它们独有的 effect kind 全删：
  //   unlockSonar / powerMaxBonus / sonarPingCostReduction / lampEfficiency / sonarRobustness / lampRobustness /
  //   signatureReduction / lampRangeBonus / sonarRangeBonus / sonarScanRangeBonus / soundAbsorbBonus / camoBonus。
  //   声呐迁成 Otto 打造的装备件（EquipmentEffect 同名数值 kind·types/items.ts）；灯/规避效果回基线，可日后做成
  //   灯/服档位件用 EquipmentEffect base effects 加回（deriveSensorTuning 旋钮仍在·clarity.ts::SensorUpgradeBonus）。
  // 声呐与房间 §6/§8.3 续：大房间（多事件房间）出现率 +value（salvage_guild lv4·仍为全局升级线·band maxRoomFeatures 仍是天花板），有上限。
  | { kind: 'roomFeatureChanceBonus'; value: number }
  | { kind: 'unlockShopItem'; itemId: string };

/** 一条升级要求的某种材料及数量（qty 量级 ∈ [1,10]） */
export interface MaterialCost {
  itemId: string;
  qty: number;
}

/**
 * 升级 / 灯塔的双资源账单（材料 ＋ 金币）。
 * 金币必要但不充分：每条升级都有金币价，但金币不能替代材料——高阶升级仍要实打实的（深）材料，
 * 借此把"下深拿料"门控钉死（见 基建地图 SPEC §2.3）。
 */
export interface UpgradeCost {
  materials: MaterialCost[];
  gold: number;
}

/** 一级升级 */
export interface UpgradeDef {
  id: string;
  level: number; // 1..N，同一 line 内必须连续
  name: string;
  cost: UpgradeCost; // 材料 ＋ 金币（替换旧"建设值"单一数字）
  effects: UpgradeEffect[];
  description: string;
}

/** 一条升级线（船坞 / 气瓶库 / 打捞行会 / 教堂 ...） */
export interface UpgradeLine {
  id: string;
  name: string;
  description: string;
  upgrades: UpgradeDef[];
}

/** upgrades.json 顶层结构 */
export interface UpgradesFile {
  lines: UpgradeLine[];
}

/** 派生的全局加成（由 getUpgradeBonuses 聚合） */
export interface UpgradeBonuses {
  oxygenMaxBonus: number;
  staminaMaxBonus: number;
  extraConsumableSlot: number;
  preservationBonus: number;
  revealCorpseHint: boolean;
  preDiveCorpseSelect: boolean;
  currentSweepImmune: boolean;
  // 段2（作者 2026-06-19）：传感器派生字段（sonarUnlocked / powerMaxBonus / sonarPingCostReduction /
  //   lampEfficiency / sonarRobustness / lampRobustness / signatureReduction / lampRangeBonus /
  //   sonarRangeBonus / sonarScanRangeBonus / soundAbsorbBonus / camoBonus）已随三传感器线退役删除——
  //   声呐迁装备件（hasSonarEquipped / getEquipmentStats）·灯/规避回基线·getRunBonuses 不再从这里取它们。
  /** 大房间（多事件房间）出现率加成（声呐与房间 §6/§8.3 续；salvage_guild lv4·有上限 ROOM_FEATURE_CHANCE_MAX·band cap 仍是天花板）。 */
  roomFeatureChanceBonus: number;
  unlockedZones: Set<string>;
  unlockedShopItems: Set<string>;
}
