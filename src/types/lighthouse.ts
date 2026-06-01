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
  | { kind: 'extraConsumableSlot'; value: number }; // 随身消耗品槽 +value（家灯塔「船坞」设施，桥接进 run 加成；Phase C 迁移自全局 dockyard）

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

/** lighthouse_upgrades.json 顶层结构。 */
export interface LighthouseUpgradesFile {
  tracks: LighthouseTrack[];
  /** 可修复的废弃灯塔（Phase C 修复循环；缺省空）。 */
  ruins?: LighthouseRuinDef[];
}

/** 聚合某座灯塔已建设施的派生加成（Phase C 读取消费）。 */
export interface LighthouseBonuses {
  lightRadiusBonus: number;
  reachReduction: number;
  /** 随身消耗品槽 +value（仅家灯塔的「船坞」设施会贡献；桥接进 createNewRun 的 run 加成）。 */
  extraConsumableSlot: number;
}
