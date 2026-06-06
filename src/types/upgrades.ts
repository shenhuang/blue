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
  | { kind: 'unlockSonar'; value: boolean }
  // 深水区 Phase 0 升级轨：让 0a/0b 造的传感器随材料经济成长（聚合进 run.sensorTuning / powerMax，见 clarity.ts）。
  | { kind: 'powerMaxBonus'; value: number } // 电池总量 +value
  | { kind: 'sonarPingCostReduction'; value: number } // 声呐 ping 耗电 −value（有地板）
  | { kind: 'lampEfficiency'; value: number } // 灯耗电乘子 −value（更省电，有地板）
  | { kind: 'sonarRobustness'; value: number } // 声呐假回波 san 阈值 −value（更抗欺骗，有地板）
  | { kind: 'lampRobustness'; value: number } // 灯幻觉 san 阈值 −value（灯更晚崩，有地板）
  | { kind: 'signatureReduction'; value: number } // signature 减免 +value（更隐蔽，有上限）
  // 深水区 Phase 1 续·节点级 clarity 范围/分辨：灯/声呐 reach（够到的深度差）随升级扩，有上限。
  | { kind: 'lampRangeBonus'; value: number } // 灯 reach +value m（节点级 clarity，有上限）
  | { kind: 'sonarRangeBonus'; value: number } // 声呐 reach +value m（节点级 clarity·深度差，有上限）
  // 声呐与房间 §8.1：声呐探索扫描跳数 +value（一记 ping 照得更广），有上限 SONAR_SCAN_RANGE_MAX。
  | { kind: 'sonarScanRangeBonus'; value: number }
  // 声呐与房间 §6/§8.3 续：大房间（多事件房间）出现率 +value（更会在大洞室里翻找·band maxRoomFeatures 仍是天花板），有上限。
  | { kind: 'roomFeatureChanceBonus'; value: number }
  // 猎手 SPEC §3 升级规避：玩家侧规避——压低你对某感官猎手的特征 → 它这一记丢锁（对称于它 evadesScan 躲你；有上限/深处仍找得到你）。
  | { kind: 'soundAbsorbBonus'; value: number } // T1 吸声：规避声感猎手（0..STEALTH_BONUS_MAX）
  | { kind: 'camoBonus'; value: number } // T2 主动迷彩：规避光感猎手（0..STEALTH_BONUS_MAX）
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
  /** 声呐能力是否已解锁（深水区 Phase 0a：门控在深料升级 upgrade.sonar.lv1）。 */
  sonarUnlocked: boolean;
  // 深水区 Phase 0 升级轨（sum 聚合）：经 getRunBonuses → createNewRun → run.powerMax / run.sensorTuning。
  /** 电池总量加成（+到 POWER_MAX）。 */
  powerMaxBonus: number;
  /** 声呐 ping 耗电减免（从 SONAR_PING_COST 减，有地板）。 */
  sonarPingCostReduction: number;
  /** 灯耗电乘子减免（从 1 减，更省电，有地板）。 */
  lampEfficiency: number;
  /** 声呐抗欺骗（从假回波 san 阈值减，有地板）。 */
  sonarRobustness: number;
  /** 灯抗欺骗（从灯幻觉 san 阈值减，有地板）。 */
  lampRobustness: number;
  /** 隐蔽（signature 减免，有上限）。 */
  signatureReduction: number;
  /** 灯 reach 加成（节点级 clarity·范围/分辨，深水区 Phase 1 续；有上限）。 */
  lampRangeBonus: number;
  /** 声呐 reach 加成（节点级 clarity·深度差；有上限）。 */
  sonarRangeBonus: number;
  /** 声呐扫描跳数加成（声呐与房间 §8.1 主升级轴；有上限 SONAR_SCAN_RANGE_MAX）。 */
  sonarScanRangeBonus: number;
  /** 大房间（多事件房间）出现率加成（声呐与房间 §6/§8.3 续；有上限 ROOM_FEATURE_CHANCE_MAX·band cap 仍是天花板）。 */
  roomFeatureChanceBonus: number;
  /** 猎手规避 T1 吸声（规避声感猎手·sum，有上限 STEALTH_BONUS_MAX）。 */
  soundAbsorbBonus: number;
  /** 猎手规避 T2 主动迷彩（规避光感猎手·sum，有上限 STEALTH_BONUS_MAX）。 */
  camoBonus: number;
  unlockedZones: Set<string>;
  unlockedShopItems: Set<string>;
}
