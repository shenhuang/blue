// 温度系统（热/冷双极门控）：热应力累积 + 潜服保温抵消 + 探全门控 + 超阈后果的单点纯函数模型
// 见 docs/spec/深海回响_温度系统_SPEC.md
//
// 与氮气（engine/nitrogen.ts）正交的第二条环境债：氮气=深度/时间债（全局），温度=按洞双极债（局部）。
// 热极/冷极共用一根 0–100「热应力」轴（thermalStress）；极性只管叙事 + 未来分热/冷保温，数学同款。
//
// 【单写者·防解耦腐烂】温度的全部数学只在本模块（参照氮气 / 负伤 #116 单写者）。别在别处手算温度增减。
// 【纯函数·不碰 state】只输入 intensity/insulation/depth/stress + turns，输出数字与门控；落 state 由调用方决定。
// 【本棒边界】只到「纯函数 + 标注」；接入 dive/state（Stats.thermalStress + tickTurns 累积 + 入潜门控）属 T2 follow-up（SPEC §7）。

import type {
  CaveTemperatureEntry,
  CaveTemperatureTable,
  TempReach,
  ThermalAccess,
  ZoneTemperature,
} from '@/types/temperature';
import tableData from '@/data/cave_temperature.json';

const TABLE = tableData as CaveTemperatureTable;

/** 应力分档阈值（0–100·超阈后果用·与曲线同住单点可调）。 */
export const TEMP = { WARN: 40, HARM: 60, CRITICAL: 85 } as const;

/** 模型旋钮（首版·playtest 起点·SPEC §9·数值待作者统一调）。 */
const TEMP_MODEL = {
  /** 累积/恢复半衰期（回合）：每 τ 回合向 ceiling 靠拢一半。比氮气 15 略快（局部暴露见效快）。 */
  HALF_TIME: 12,
  /** 基线潜服保温（无升级·0–100）：侧表 reach 标注 = 此保温下派生的档（数据↔标注一致性门）。 */
  BASELINE_INSULATION: 30,
  /** 超阈扣体力系数：drain=K·over^2·turns（over=归一化超阈量）。 */
  DRAIN_K: 0.5,
} as const;

/** 探全门控阈值（deficit=intensity−insulation 在此两点落三档·SPEC §3）。 */
const GATE = { FULL_EXPLORE_AT: 0, ENTRY_BLOCK_OVER: 40 } as const;

export const TEMP_BASELINE_INSULATION = TEMP_MODEL.BASELINE_INSULATION;

/** 中性默认（侧表未命中·全可探）。同 getShopStock 缺条目即满货的懒默认语义。 */
const NEUTRAL: ZoneTemperature = { polarity: 'neutral', intensity: 0, reach: 'full' };

/**
 * 查某 zone 的温度（命中侧表给其语义·未命中给中性默认）。
 * 侧表只列非中性洞——27 洞里绝大多数中性·不各写一条（解耦侧表·SPEC §4）。
 */
export function getCaveTemperature(zoneId: string): ZoneTemperature {
  const e = TABLE.entries.find((x) => x.zoneId === zoneId);
  if (!e) return NEUTRAL;
  return { polarity: e.polarity, intensity: e.intensity, reach: e.reach };
}

/** 整张侧表（校验门 / dev 用·只读）。 */
export function caveTemperatureEntries(): readonly CaveTemperatureEntry[] {
  return TABLE.entries;
}

/**
 * 净暴露：洞的极端度被潜服保温抵消后的差额（>0 = 保温不足）。clamp 深度无关（温度是局部债·不随深度）。
 */
export function thermalDeficit(intensity: number, insulation: number): number {
  return intensity - insulation;
}

/**
 * 热应力上限（久留渐近值·0–100）：净暴露 clamp 到 [0,100]。
 * 保温 ≥ 强度 → 0（不积累）；同一函数同管热极/冷极（极性不进数学）。
 */
export function thermalCeiling(intensity: number, insulation: number): number {
  return Math.max(0, Math.min(100, thermalDeficit(intensity, insulation)));
}

/**
 * 推进 turns 回合后的热应力（指数逼近 ceiling·同管累积与恢复）。纯函数·clamp 0–100。
 * 离开热/冷洞（intensity=0）或保温足够 → ceiling=0 → 趋 0（自然恢复）。
 * 逐回合 step 与一次性 step(turns) 数值一致（指数可组合）→ 守 dive-stalker「逐字节同数」口径（同氮气）。
 */
export function stepThermalStress(
  current: number,
  intensity: number,
  insulation: number,
  turns: number,
): number {
  if (turns <= 0) return current;
  const ceiling = thermalCeiling(intensity, insulation);
  const next = ceiling + (current - ceiling) * Math.pow(2, -turns / TEMP_MODEL.HALF_TIME);
  return Math.max(0, Math.min(100, next));
}

/**
 * 探全门控：由 deficit 在两阈值上派生「能否进 / 能否探全 / 可达档」。零额外 per-zone 数据。
 * 玩家升级保温 → deficit 降 → partial 变 full、entry_blocked 变 partial（保温装备 = 温度洞的钥匙）。
 */
export function thermalAccess(intensity: number, insulation: number): ThermalAccess {
  const deficit = thermalDeficit(intensity, insulation);
  const canExploreFully = deficit <= GATE.FULL_EXPLORE_AT;
  const canEnter = deficit <= GATE.ENTRY_BLOCK_OVER;
  const reach: TempReach = !canEnter ? 'entry_blocked' : !canExploreFully ? 'partial' : 'full';
  return { deficit, canEnter, canExploreFully, reach };
}

/**
 * 作者标注 reach 的派生基准：在 BASELINE_INSULATION 下该 intensity 应落哪档。
 * 侧表里人写的 reach 必须 == 此结果（一致性门·数值/标注漂移即红·SPEC §8.5）。
 */
export function expectedReach(intensity: number): TempReach {
  return thermalAccess(intensity, TEMP_MODEL.BASELINE_INSULATION).reach;
}

/**
 * 超阈后果：应力越过 WARN 后按归一化超阈量连续扣体力（热极=过热脱力 / 冷极=失温麻木·叙事分极性·数学同款）。
 * 低超阈几乎为 0（平方）；纯输出数字·不碰 state（落由调用方·仿氮醉 narcosisSanityDrain）。
 */
export function thermalStaminaDrain(stress: number, turns: number): number {
  if (turns <= 0) return 0;
  const over = (Math.max(0, Math.min(100, stress)) - TEMP.WARN) / (100 - TEMP.WARN);
  if (over <= 0) return 0;
  return TEMP_MODEL.DRAIN_K * over * over * turns;
}
