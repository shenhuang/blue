// 微观 clarity（下潜内双传感器感知）—— 深水区 Phase 0a。
// 与 chart.ts 的"宏观 clarity（海图灯塔网）"平行：本文件只管"这一潜你带的灯 / 声呐"
// 能预读多清楚的相邻节点。设计源真见 docs/深海回响_深水区_SPEC.md §3.1/§3.2。
//
// 三态权衡（不是谁压谁）：
//   灯（近）   → 地面真相、能读 tell；暴露(signature)最高；清水近免费、黑水/深水耗电。
//   声呐 ping（远）→ 不可信的"返回"（≠ 真内容，可被生物躲/骗、低 san 幻觉）；暴露较低；耗电大。后期才解锁。
//   摸黑（关灯关声呐）→ 无预览、盲航；暴露最低、省电。
// "没有完全可信的传感器"：san 越低声呐先失真、san 足够低连灯也产幻觉（灯最稳、最后崩）。
//
// 纯函数 + 防御性读取（run 字段可能因脚本构造的部分 run 而缺失 → 用默认兜底）。
// 低 san 腐蚀走确定性哈希（不消耗 Math.random）——既不扰动 withSeededRandom 的场景回归，又让 playthrough-sensors 可稳定断言。

import type { RunState, DiveNode, ClarityTier } from '@/types';

// ============================================================
// 可调参数（tunables，SPEC §8）
// ============================================================

/** 默认电池总量（升级可提升，留 Phase 2）。 */
export const POWER_MAX = 40;
/** 一次声呐 ping 的耗电（声呐 >> 灯，SPEC §3.2）。 */
export const SONAR_PING_COST = 6;
/** 灯每回合基准耗电（再乘水况因子；清水因子 0 → 浅水近免费，Q2）。 */
export const LIGHT_POWER_PER_TURN = 1;

/** 低 san 阈值：理智 < 此值 → 声呐返回开始注入假回波（声呐先失真）。 */
export const SONAR_FALSE_ECHO_SANITY = 60;
/** 低 san 阈值：理智 < 此值 → 连灯（full 档）也产假预览（灯最稳、最后崩，比声呐低很多）。 */
export const LAMP_HALLUCINATION_SANITY = 25;

/** signature（被探测度，0b 消费遭遇/伏击；0a 只派生）权重：灯高、声呐中、静默低。 */
export const SIGNATURE_BASE = 1;
export const SIGNATURE_LIGHT = 6;
export const SIGNATURE_SONAR = 3;

/** 'none' 档（摸黑 / 灯打不透）的盲航预览文案——沿用旧 visibility:dark 行为（quirk #27/#41）。 */
export const BLIND_PREVIEW = '看不清，一团黑影。';
/** 'none' 档且该路已来过：你记得这片黑，但仍看不清里头。 */
export const BLIND_VISITED_PREVIEW = '来过的方向，记得这片黑。';

// ============================================================
// 传感器派生状态
// ============================================================

/** 灯是否亮着（在发光 / 耗电 / 抬 signature）——与"是否有效给出真相"(lampEffective)不同：黑水里灯亮着却打不透。 */
export function lampOn(run: RunState): boolean {
  return (run.sensors?.light ?? true) && (run.power ?? 0) > 0;
}

/**
 * 灯是否"有效"——能给出近距地面真相。开 + 有电 + 水不是全黑（dark 打不透，沿用 visibility 作输入，SPEC §11 Q1）。
 * murky（悬浮物）不挡灯：灯仍 full，只是耗电 + 有理智压力（visibilitySanityDrain，不在本文件）。
 */
export function lampEffective(run: RunState): boolean {
  return lampOn(run) && run.diveModifier?.visibility !== 'dark';
}

/** 声呐是否在发挥作用：已解锁 + 本次选点设为 ping + 有电。 */
export function sonarActive(run: RunState): boolean {
  return (
    (run.sensors?.sonarUnlocked ?? false) &&
    (run.sensors?.sonar ?? 'off') === 'ping' &&
    (run.power ?? 0) > 0
  );
}

/**
 * 本次预览档：灯有效 → 'full'（真相）；否则声呐在跑 → 'sonar'（不可信表象）；否则 → 'none'（盲）。
 * 注：node 级细分（按深度/band 提高成本曲线）留 Phase 1，故 0a 的 clarity 只读 run 级传感器状态。
 */
export function clarity(run: RunState): ClarityTier {
  if (lampEffective(run)) return 'full';
  if (sonarActive(run)) return 'sonar';
  return 'none';
}

/** 灯每回合耗电的水况因子：清水/未设 ≈ 0（浅水近免费，Q2）/ 微浊 0.5 / 黑水 1（+ 深 band 斜坡留 Phase 1）。 */
export function lightDrainFactor(run: RunState): number {
  const vis = run.diveModifier?.visibility;
  if (vis === 'dark') return 1;
  if (vis === 'murky') return 0.5;
  return 0;
}

/** 灯每回合耗电（仅灯亮时）。tickTurns 调用，类比 oxygen 的 turn 消耗。 */
export function lampPowerDrain(run: RunState, turns: number): number {
  if (turns <= 0 || !lampOn(run)) return 0;
  return LIGHT_POWER_PER_TURN * lightDrainFactor(run) * turns;
}

/** signature（被探测度）：灯亮高、声呐 ping 中、全关低。0a 只派生，0b 接遭遇/combat。 */
export function signature(run: RunState): number {
  let s = SIGNATURE_BASE;
  if (lampOn(run)) s += SIGNATURE_LIGHT;
  if (sonarActive(run)) s += SIGNATURE_SONAR;
  return s;
}

// ============================================================
// 预览文案：灯下真相（可被极低 san 幻觉改写）/ 声呐不可信表象
// ============================================================

// 确定性哈希（FNV-1a），用于在不消耗 RNG 的前提下稳定地挑选表象/幻觉文案。
function hashStr(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function pick<T>(arr: T[], key: string): T {
  return arr[hashStr(key) % arr.length];
}

// 声呐"真实但粗糙"的表象（≠ 真 preview）——给得到部分信息，但永远不是地面真相。
const SONAR_PLAUSIBLE: Record<string, string[]> = {
  corpse: ['一团比周围密实些的回波，形状不规整。', '回声在那儿堆出个轮廓，比石头软。'],
  default: ['回波画出一处空腔，边缘是乱石。', '一片密度不均的回声，说不好是岩还是别的。', '脉冲撞回来一个形状，毛糙、读不细。'],
};
// 低 san 假回波——扫出根本不存在 / 对不上的东西，叙述永不交底（quirk #54）。
const SONAR_FAKE: string[] = [
  '声呐回来一团你说不清的形状——再扫一次，它就不在那儿了。',
  '回波里多了一道，像是有什么夹在你和石壁之间。也许没有。',
  '脉冲撞回来的东西，比你记得的近。或者是你记错了。',
];
// 极低 san 灯幻觉——看清的那一刻反而不确定，两种读法叠着（quirk #54）。
const LAMP_HALLUCINATION: string[] = [
  '灯扫过去，那轮廓动了一下——也许只是你的手在抖。',
  '灯下看清的那一刻，它好像换了个样子。你说不准哪个是真的。',
];

/**
 * 声呐对一个节点的"返回"——不可信表象（≠ 真 preview）。改写来源（你分辨不了是哪个）：
 *   ① 生物躲开声呐（evadesSonar）→ 没回波；② 生物喂假回波（spoofsSonar，mimic/Phase 3）→ 显示成别的；
 *   ③ 低 san（< SONAR_FALSE_ECHO_SANITY）→ 注入假回波。否则给"真实但粗糙"的表象。
 */
export function sonarReturn(run: RunState, node: DiveNode): string {
  if (node.evadesSonar) return '声呐打过去，那片水把脉冲吞了——什么都没回来。';
  if (node.spoofsSonar) return `回波很干净，太干净了——像${node.spoofsSonar}。`;
  if ((run.stats?.sanity ?? 100) < SONAR_FALSE_ECHO_SANITY) {
    return pick(SONAR_FAKE, `fake:${node.id}:${Math.round(run.stats?.sanity ?? 100)}`);
  }
  const table = SONAR_PLAUSIBLE[node.kind] ?? SONAR_PLAUSIBLE.default;
  return pick(table, `son:${node.id}`);
}

/**
 * 灯下看到的预览：默认是地面真相（node.preview）；但 san 足够低（< LAMP_HALLUCINATION_SANITY）时，
 * 连灯也产生假预览（无完全可信的传感器、灯最后崩）。
 */
export function lampPreview(run: RunState, node: DiveNode): string {
  if ((run.stats?.sanity ?? 100) < LAMP_HALLUCINATION_SANITY) {
    return pick(LAMP_HALLUCINATION, `lamp:${node.id}:${Math.round(run.stats?.sanity ?? 100)}`);
  }
  return node.preview;
}
