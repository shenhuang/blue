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
  | { kind: 'unlockShopItem'; itemId: string };

/** 一级升级 */
export interface UpgradeDef {
  id: string;
  level: number; // 1..N，同一 line 内必须连续
  name: string;
  cost: number; // 建设值
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
  unlockedZones: Set<string>;
  unlockedShopItems: Set<string>;
}
