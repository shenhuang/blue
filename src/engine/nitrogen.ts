// 氮气系统：饱和累积的单点模型
// 见 docs/spec/深海回响_氮气系统_SPEC.md
//
// 单房间饱和模型（Haldane-lite）：深度定饱和上限 ceiling，停留定逼近程度；
// 同一公式同管吸氮（深处 N<ceiling → 涨）与排氮（升浅/水面 ceiling 低 → 降）。
// 本模块是潜水期氮气演化的【唯一计算点】——tickTurns 调用；升浮 surfacing 与
// 物品效果是另两个合法写者。别在别处手算氮气增减（见 SPEC §2 单写者原则）。
// 氮气已脱钩旧「头脑不正常」轴（2026-07-10 理智系统移除）：只喂减压债·不产生任何额外压力。

/** 氮气分档阈值（0–100）。减压停留次数与减压病分型共用——与饱和曲线同住，单点可调。 */
export const N2 = { SAFE: 40, ONE_STOP: 60, TWO_STOP: 80 } as const;

/** 模型旋钮（首版·playtest 起点·SPEC §8）。 */
const NITROGEN = {
  /** 环境压代理斜率：P(d)=1+d/PRESSURE_SCALE（与氧耗 depthFactor 同族·游戏调校非真实物理）。 */
  PRESSURE_SCALE: 50,
  /** 饱和上限曲线常数：ceiling(d)=100·(1−e^(−d/CEILING_D0))。越大 → 深处越不易顶满。 */
  CEILING_D0: 100,
  /** 吸/排氮半衰期（回合）：每 τ 回合向 ceiling 靠拢一半。越小 → 停留越快见效。 */
  HALF_TIME: 4,
} as const;

/** 当前深度的氮气饱和上限（久留渐近值·0–100）。 */
export function nitrogenCeiling(depth: number): number {
  const d = Math.max(0, depth);
  return 100 * (1 - Math.exp(-d / NITROGEN.CEILING_D0));
}

/**
 * 推进 turns 回合后的氮气（指数逼近 ceiling·同管吸/排）。纯函数·clamp 0–100。
 * 定深时「逐回合 step」与「一次性 step(turns)」数值一致（指数可组合）→ 猎手逐回合 tick
 * 与无猎手一次性 tick 同数，守 dive-stalker「additive 守恒/逐字节同数」口径。
 */
export function stepNitrogen(current: number, depth: number, turns: number): number {
  if (turns <= 0) return current;
  const ceiling = nitrogenCeiling(depth);
  const next = ceiling + (current - ceiling) * Math.pow(2, -turns / NITROGEN.HALF_TIME);
  return Math.max(0, Math.min(100, next));
}

// ============================================================
// 战斗氮气耦合（战斗系统 SPEC §2.1/§10「与主系统的耦合」）
// ============================================================

/** 战斗氮气累积倍率（剧烈呼吸加速吸收·战斗 SPEC §2.1/§10「系数建议 ×1.5」·占位·defer-number-tuning）。 */
export const COMBAT_NITROGEN_MULT = 1.5;

/**
 * 战斗氮气累积增量（战斗 SPEC §2.1/§10）：战斗按当前深度累积氮气，与下潜同一饱和公式（stepNitrogen），
 * 唯「等效停留时间」×COMBAT_NITROGEN_MULT（剧烈呼吸加速吸收）——**时间制**：仍走同一指数逼近、渐近同一
 * 深度 ceiling、绝不越过（分压物理）。此前战斗完全不累积氮气（只扣氧气）是 gap，本函数补上、统一进饱和模型。
 * **仅氮气→减压债（ascent.ts）**——氮气已与旧「头脑不正常」轴脱钩（2026-07-10 理智系统移除）：那条留待
 * 地点缝 seam 接管，战斗此处不产生任何额外压力。
 * 纯函数·返回 stat 增量（stepNitrogen 已 clamp [0,100]·delta＝目标−当前·±）。combat.ts::applyPlayerAction
 * 单点调用并经 applyStatsDelta 落账（债数学不出本模块·守 check-boundaries 规则六 nitrogen 单写口）。
 */
export function combatNitrogenGain(nitrogen: number, depth: number, turns: number): number {
  if (turns <= 0) return 0;
  const target = stepNitrogen(nitrogen, depth, turns * COMBAT_NITROGEN_MULT);
  return target - nitrogen;
}

/**
 * 氮气可读状态（单源 N2 阈值·与 ascent.computeRequiredStops 同阈——同读 N2·绝不本地复刻数字）：
 * 把 0–100 氮浓度映射到「上浮需几次减压停留 + 一句话」。让「氮气是债」在债真正攒起来时**可见**——
 * playtest 报告④说「85m 氮 7.5 上浮无惩罚·机制没咬人」，实则减压病系统早已实装（ascent.ts：减压停留 /
 * 减压病 I–IV / 持久 debuff / 致死），只是短潜攒不够氮债 + 试玩 harness 只打裸数字看不出状态。本函数给「状态」，
 * harness 摘要 / UI 据此显化。debt 的**触发条件**（攒氮速度 HALF_TIME·ch1 是否有够长够深的潜）是数值/内容侧·留作者调。
 */
export function nitrogenStatus(nitrogen: number): { stops: 0 | 1 | 2 | 3; label: string } {
  if (nitrogen < N2.SAFE) return { stops: 0, label: '安全·可直接上浮' };
  if (nitrogen < N2.ONE_STOP) return { stops: 1, label: '积压·上浮需 1 次减压停留' };
  if (nitrogen < N2.TWO_STOP) return { stops: 2, label: '偏高·上浮需 2 次减压停留' };
  return { stops: 3, label: '危险·硬冲上浮会重度减压病' };
}
