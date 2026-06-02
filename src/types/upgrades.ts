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
  unlockedZones: Set<string>;
  unlockedShopItems: Set<string>;
}
