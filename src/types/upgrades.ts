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
  unlockedZones: Set<string>;
  unlockedShopItems: Set<string>;
}
