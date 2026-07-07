// 月相潮汐时间系统 · 纯函数派生层（SPEC: docs/spec/深海回响_月相潮汐_SPEC.md §3）。
// 只存 profile.day，月相/潮汐全在此派生（不入存档·对齐海图「派生不入存档」约定）。
// 纯函数·无副作用·无 ui 依赖（engine↛ui·check-boundaries 规则一·#95）。
// Phase 1 起被消费：chart.ts 用 lunarPhase/tideLevel/moonAge 派生海况 + 月相窗门；port.ts 用 daysToNextPhase 做港口等待。
import type { LunarPhase } from '@/types';
export type { LunarPhase };

/** 朔望周期天数（作者拍板·SPEC §11；realism 取真实量级）。 */
export const LUNAR_CYCLE_DAYS = 28;

/** 等分相位顺序（new→waxing→full→waning·每相 CYCLE/4 天）。 */
const PHASES: readonly LunarPhase[] = ['new', 'waxing', 'full', 'waning'];

/** 朔望相位龄：day 落在当前周期内的位置 0..CYCLE-1（负 day / 非整 day 也归一）。 */
export function moonAge(day: number): number {
  const c = LUNAR_CYCLE_DAYS;
  return ((Math.floor(day) % c) + c) % c;
}

/**
 * 当前月相（4 相·等分 7 天/相）：新 0–6 / 上弦 7–13 / 满 14–20 / 下弦 21–27。
 * SPEC §3「相位是窗口、非每天一相」。
 */
export function lunarPhase(day: number): LunarPhase {
  const seg = LUNAR_CYCLE_DAYS / PHASES.length;
  return PHASES[Math.floor(moonAge(day) / seg)] ?? 'new';
}

/** 到下一个相位边界还差几天（港口「等到下一相位」·Phase 1 消费·SPEC §6）。 */
export function daysToNextPhase(day: number): number {
  const seg = LUNAR_CYCLE_DAYS / PHASES.length;
  const into = moonAge(day) % seg;
  return into === 0 ? seg : seg - into;
}

/**
 * 潮位 ∈ [-1, 1]：月相派生的瞬时潮高代理。大潮（振幅大）在新月/满月、小潮在上/下弦——天文正确。
 * Phase 0 暂无消费者（Phase 2 接洋流/能见度·SPEC §8 第 2 层）；先定义占位，数值手感最后调
 * （defer-number-tuning）。
 */
export function tideLevel(day: number): number {
  const theta = (2 * Math.PI * moonAge(day)) / LUNAR_CYCLE_DAYS;
  const springNeap = 0.5 + 0.5 * Math.abs(Math.cos(theta)); // 1 在 new/full·0.5 在 quarters
  return Math.cos(2 * theta) * springNeap;
}

/** 月相中文名（UI 海况条 / 暗点提示·engine 产串同 poiLockReason）。 */
export function lunarPhaseLabel(phase: LunarPhase): string {
  switch (phase) {
    case 'new':
      return '新月';
    case 'waxing':
      return '上弦';
    case 'full':
      return '满月';
    case 'waning':
      return '下弦';
  }
}

/**
 * 当前相位内第几天（1..CYCLE/4）：moonAge % seg + 1。
 * UI 海况条「下弦 · 第 N 天」·纯派生·无副作用。
 */
export function dayWithinPhase(day: number): number {
  const seg = LUNAR_CYCLE_DAYS / PHASES.length;
  return (moonAge(day) % seg) + 1;
}

/**
 * 从 day 到「相位 ∈ phases」最近还要几天（港口等待 / 暗点「还 N 天」·SPEC §4/§6）。
 * 已在窗内 → 0；否则最小 n≥1（上限一个周期·空 phases → 0）。
 */
export function daysUntilAnyPhase(day: number, phases: LunarPhase[]): number {
  if (phases.length === 0) return 0;
  const d = Math.floor(day);
  for (let n = 0; n <= LUNAR_CYCLE_DAYS; n++) {
    if (phases.includes(lunarPhase(d + n))) return n;
  }
  return 0;
}

/**
 * 两个总天数之间跨越了几个相位边界（蜂群 boss SPEC §9.11「撤退/月相存档窗」·`warrenHunt.lastVisitDay`
 * 消费方）：数的是**相位边界**，不是天差——「窗非天差」（同一相位内往返仍算 0，哪怕隔了 6 天；
 * 跨 1 个边界＝1，如此类推）。纯函数·确定性·允许 fromDay > toDay（倒退返回负数，调用方按 `> 阈值` 判自然只在
 * 正向流逝时触发）。
 */
export function moonPhasesElapsed(fromDay: number, toDay: number): number {
  const seg = LUNAR_CYCLE_DAYS / PHASES.length;
  return Math.floor(toDay / seg) - Math.floor(fromDay / seg);
}
