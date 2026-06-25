// 温度系统（热/冷双极门控）类型
// 见 docs/spec/深海回响_温度系统_SPEC.md
//
// 解耦侧表：温度数据按 zoneId 旁挂（src/data/cave_temperature.json·不进 zones.json）。
// 本棒只到「纯函数 + 标注」；接入 dive/state（Stats.thermalStress + tickTurns 累积）属 T2 follow-up。

/** 温度极性。中性洞不入侧表（未命中即中性·见 getCaveTemperature 懒默认）。 */
export type TempPolarity = 'hot' | 'cold' | 'neutral';

/**
 * 可达档（探全门控）。**派生量**：由 deficit=intensity−insulation 在两阈值上落档（见 engine/temperature.ts::thermalAccess）。
 * 侧表里另存一份作者标注的 reach（设计意图·人读）；机制门校验它 == 在 BASELINE_INSULATION 下派生的档（数据↔标注一致性）。
 *  - 'full'          全可探（保温 ≥ 强度）
 *  - 'partial'       能进·核心/深处探不全
 *  - 'entry_blocked' 入口不可达（差太多·过热/过冷封口）
 */
export type TempReach = 'full' | 'partial' | 'entry_blocked';

/**
 * 侧表一条（按 zoneId·只列非中性洞）。
 * intensity = 洞的极端度（0–100·潜服保温 insulation 直接抵消）；占位待作者调（SPEC §9）。
 * reach = 作者标注的预期可达档（一致性门校验·见 SPEC §3/§8.5）。
 */
export interface CaveTemperatureEntry {
  zoneId: string;
  polarity: Exclude<TempPolarity, 'neutral'>;
  /** 0–100·热/冷极端度（保温抵消的对象）。 */
  intensity: number;
  /** 作者标注的预期可达档（BASELINE_INSULATION 下应派生出此档·机制门守一致）。 */
  reach: TempReach;
  /** 设计来源 / 备注（人读·不参与数学）。 */
  note?: string;
}

/** 整张侧表（cave_temperature.json 形状）。 */
export interface CaveTemperatureTable {
  /** SPEC 版本号（人读·不参与逻辑）。 */
  version: number;
  entries: CaveTemperatureEntry[];
}

/** 查表结果（命中给侧表条目语义·未命中给中性默认）。 */
export interface ZoneTemperature {
  polarity: TempPolarity;
  intensity: number;
  reach: TempReach;
}

/** thermalAccess 门控输出（纯派生·不碰 state）。 */
export interface ThermalAccess {
  /** intensity − insulation（>0 = 保温不足）。 */
  deficit: number;
  /** 入口是否可达（deficit ≤ ENTRY_BLOCK_OVER）。 */
  canEnter: boolean;
  /** 是否可探全（deficit ≤ FULL_EXPLORE_AT）。 */
  canExploreFully: boolean;
  /** 由 deficit 派生的可达档。 */
  reach: TempReach;
}
