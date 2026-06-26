// 月相潮汐时间系统 · 纯函数派生层（SPEC: docs/spec/深海回响_月相潮汐_SPEC.md §3）。
// 只存 profile.day，月相/潮汐全在此派生（不入存档·对齐海图「派生不入存档」约定）。
// 纯函数·无副作用·无 ui 依赖（engine↛ui·check-boundaries 规则一·#95）。
// Phase 0：定义但暂未被任何门消费——tide 仍由 chart.ts 旧式 condHash 派生（守逐字节不变），
// 月相窗门 / tide 重派生 / 等待 留 Phase 1（见 SPEC §4–§6/§10）。

/** 朔望周期天数（作者拍板·SPEC §11；realism 取真实量级）。 */
export const LUNAR_CYCLE_DAYS = 28;

export type LunarPhase = 'new' | 'waxing' | 'full' | 'waning';

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
