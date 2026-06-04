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

import type { RunState, DiveNode, ClarityTier, SensorTuning } from '@/types';

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

// ----- 升级轨地板/上限（深水区 Phase 0 升级轨，SPEC §8 / §11「升级」） -----
// 升级把上面的基线常量往"更强"推；这里的地板/上限守两条铁律：
//   ① 无完全可信传感器（§3.2）——抗欺骗能下调失真阈值，但不归零（声呐≥30、灯≥10 仍会崩）。
//   ② 读真相永远要自曝（§3.2/§3.3）——隐蔽能降 signature，但点灯/ping 暴露永不为 0。
/** 声呐 ping 耗电下限（升级最省也到此为止）。 */
export const SONAR_PING_COST_MIN = 3;
/** 灯耗电乘子下限（升级最省也到此为止；清水仍 0，只压黑/浊水那段）。 */
export const LAMP_DRAIN_MULT_MIN = 0.25;
/** 声呐假回波 san 阈值下限（抗欺骗升满也到此为止——声呐永不全可信）。 */
export const SONAR_FALSE_ECHO_SANITY_MIN = 30;
/** 灯幻觉 san 阈值下限（抗欺骗升满也到此为止——灯最后崩、但仍会崩）。 */
export const LAMP_HALLUCINATION_SANITY_MIN = 10;
/** signature 减免上限（隐蔽升满也到此为止）。 */
export const SIGNATURE_REDUCTION_MAX = 3;
/** 灯/声呐开着时的暴露下限（signature 超基线部分的地板）——保"自曝"结构张力，隐蔽再强也甩不掉。 */
export const SIGNATURE_MIN_ACTIVE = 2;

// ----- 节点级 clarity：范围/分辨（深水区 Phase 1 续，clarityForNode 消费） -----
// run 级 clarity(run) 是"这一潜你带的灯/声呐能给的最好档"；clarityForNode 在它之上按节点的
// **深度差**（节点比你深多少 m）降档——灯只照得到近处，陡降的深坑灯打不透 → 声呐表象 → 黑。
// 浅水（≤ CLARITY_FULL_DEPTH）豁免：所见为真、不按深度降档（§7.5，与警觉 ALERT_MIN_DEPTH 同一条浅水线）。
/** 当前深度 ≤ 此值：浅水所见为真，所有选项给 run 级天花板档、不按深度差降档（§7.5）。 */
export const CLARITY_FULL_DEPTH = 25;
/** 深水里灯给"地面真相"的最大深度差（m）：节点比你深 ≤ 此值＝灯照得到 full；更深的陡降灯打不透。 */
export const LAMP_DEPTH_REACH = 6;
/** 深水里声呐够得到的最大深度差（m，> 灯）：更深的坑连回波都没有＝黑。 */
export const SONAR_DEPTH_REACH = 14;
/** 灯 reach 升满上限（守"永远有比最深更深的"：灯不可能照穿任意深的陡降，最深处必须自己摸黑下去）。 */
export const LAMP_DEPTH_REACH_MAX = 14;
/** 声呐 reach 升满上限。 */
export const SONAR_DEPTH_REACH_MAX = 26;

/** 升级派生的传感器加成（来自 getRunBonuses；各项可缺，缺＝0）。 */
export interface SensorUpgradeBonus {
  sonarPingCostReduction?: number;
  lampEfficiency?: number; // 从灯耗电乘子 1 里减去的量（sum）
  sonarRobustness?: number; // 从声呐假回波阈值里减去的量（sum）
  lampRobustness?: number; // 从灯幻觉阈值里减去的量（sum）
  signatureReduction?: number; // signature 减免（sum）
  lampRangeBonus?: number; // 灯 reach 加成（节点级 clarity·范围/分辨，sum，有上限）
  sonarRangeBonus?: number; // 声呐 reach 加成（sum，有上限）
}

/**
 * 把"升级加成"烤成本次下潜的有效传感器参数（应用地板/上限）。createNewRun 出海前调一次，结果存 run.sensorTuning。
 * 空入参（未升级）→ 全基线（与 0a/0b 行为逐字节一致）。
 */
export function deriveSensorTuning(b: SensorUpgradeBonus = {}): SensorTuning {
  return {
    pingCost: Math.max(SONAR_PING_COST_MIN, SONAR_PING_COST - (b.sonarPingCostReduction ?? 0)),
    lampDrainMult: Math.max(LAMP_DRAIN_MULT_MIN, 1 - (b.lampEfficiency ?? 0)),
    sonarFalseEchoSanity: Math.max(
      SONAR_FALSE_ECHO_SANITY_MIN,
      SONAR_FALSE_ECHO_SANITY - (b.sonarRobustness ?? 0),
    ),
    lampHallucinationSanity: Math.max(
      LAMP_HALLUCINATION_SANITY_MIN,
      LAMP_HALLUCINATION_SANITY - (b.lampRobustness ?? 0),
    ),
    signatureReduction: Math.min(SIGNATURE_REDUCTION_MAX, Math.max(0, b.signatureReduction ?? 0)),
    lampDepthReach: Math.min(LAMP_DEPTH_REACH_MAX, LAMP_DEPTH_REACH + (b.lampRangeBonus ?? 0)),
    sonarDepthReach: Math.min(SONAR_DEPTH_REACH_MAX, SONAR_DEPTH_REACH + (b.sonarRangeBonus ?? 0)),
  };
}

/** 本次下潜声呐 ping 的有效耗电（升级派生，缺省回退 SONAR_PING_COST）。dive.ts / NodeSelectView 共用。 */
export function sonarPingCost(run: RunState): number {
  return run.sensorTuning?.pingCost ?? SONAR_PING_COST;
}

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

/**
 * 节点级预览档（深水区 Phase 1 续）：在 run 级 clarity(run)「天花板」之上，按节点的**深度差**降档。
 * 你的灯只照得到近处——一个比你深得多的陡降，灯打不透（→ 声呐表象，没声呐就是黑）；够深连声呐都没回波（→ 黑）。
 *   - 浅水（currentDepth ≤ CLARITY_FULL_DEPTH）：所见为真，所有节点给天花板档、不降档（§7.5）。
 *   - 横行 / 上行（节点不比你深）：始终给天花板档（只有"往下要"才读不到）。
 * reach（灯/声呐各自够到的深度差）由 run.sensorTuning 派生（升级可扩，有上限＝最深处必须自己摸黑下去）。
 */
export function clarityForNode(run: RunState, node: DiveNode): ClarityTier {
  const ceiling = clarity(run); // 灯 full / 声呐 sonar / 摸黑 none
  if (ceiling === 'none') return 'none';
  const cur = run.currentDepth ?? 0;
  if (cur <= CLARITY_FULL_DEPTH) return ceiling; // 浅水所见为真
  const dd = Math.max(0, (node.depth ?? cur) - cur); // 只有"比你深"的陡降才读不到
  const lampReach = run.sensorTuning?.lampDepthReach ?? LAMP_DEPTH_REACH;
  const sonarReach = run.sensorTuning?.sonarDepthReach ?? SONAR_DEPTH_REACH;
  if (ceiling === 'full') {
    if (dd <= lampReach) return 'full'; // 灯够得到：地面真相
    if (sonarActive(run) && dd <= sonarReach) return 'sonar'; // 灯够不到、声呐还够到：粗略回波
    return 'none'; // 灯声呐都够不到＝黑（没 ping 的陡降也是黑）
  }
  // ceiling === 'sonar'（灯无效 / dark band，仅声呐在跑）
  return dd <= sonarReach ? 'sonar' : 'none';
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
  // 升级轨：lampDrainMult 缺省 1（未升级＝基线）；只压黑/浊水那段（清水因子本就 0）。
  const mult = run.sensorTuning?.lampDrainMult ?? 1;
  return LIGHT_POWER_PER_TURN * lightDrainFactor(run) * mult * turns;
}

/** signature（被探测度）：灯亮高、声呐 ping 中、全关低。0a 只派生，0b 接遭遇/combat。 */
export function signature(run: RunState): number {
  const raw = (lampOn(run) ? SIGNATURE_LIGHT : 0) + (sonarActive(run) ? SIGNATURE_SONAR : 0);
  if (raw <= 0) return SIGNATURE_BASE; // 摸黑：最低暴露（隐蔽升级不影响关灯静默）
  // 升级轨：隐蔽降 signature 超基线部分，但留 SIGNATURE_MIN_ACTIVE 地板（点灯/ping 永远暴露你，守"读真相必自曝"）。
  const reduction = run.sensorTuning?.signatureReduction ?? 0;
  return SIGNATURE_BASE + Math.max(SIGNATURE_MIN_ACTIVE, raw - reduction);
}

// ============================================================
// 探测 / 被探测：警觉（深水区 Phase 0b）
// ============================================================
// 主动感知是双向的——你照亮 / ping 越久越深，潜伏的捕食者越「警觉」；摸黑让它消退。
// 警觉越过阈值 → 进节点时捕食者接近、触发遭遇（dive.ts::moveToNode）。摸黑是逃出生天的阀门；
// 浅水不积累、不触发（§7.5「浅水免探测压力」）。可生存无脚本死：预警有窗口、摸黑能甩、遭遇本身可打可逃。

export const ALERT_MAX = 100;
/** ≥ 此值：进节点时潜伏捕食者接近、触发遭遇（dive.ts）。 */
export const ALERT_THRESHOLD = 60;
/** ≥ 此值：UI/日志预警，给玩家熄灯反应的窗口（读 tell → 主动降暴露）。 */
export const ALERT_WARN = 35;
/**
 * 暴露增益系数（× signature 超出静默基线 × 深度因子）。
 * 校准：60m（因子 1）灯亮 exposure 6 → gain 9、净 +6/回合 → 约 10 回合到阈值（一段持续点灯的深水穿行）；
 * 声呐 ping（exposure 3）净 +1.5/回合，比举灯安全得多。50m（因子≈0.71）更慢。§8 tunable，作者可调。
 */
export const ALERT_GAIN = 1.5;
/** 每回合基础消退（摸黑 / 浅水时净消退——逃出生天的阀门；高警觉摸黑约 8 回合回到预警线下）。 */
export const ALERT_DECAY = 3;
/** 浅于此深度不积累 / 不触发警觉（浅水免探测压力 §7.5；与深 band 斜坡共用）。 */
export const ALERT_MIN_DEPTH = 25;
/**
 * 警觉深度因子到达「满档 1」的深度（深水区 Phase 1：命名替代曾写死的 60）。
 * 更深 band（> 此值）在此饱和＝维持最高探测压力，不封顶、不报错（Math.min 兜底）。
 * 「越深越狠、不饱和」由 band 级倍率 DepthBand.alertFactor 承担（深水区 C，2026-06-04）：
 * 深度因子在这里饱和，band.alertFactor 在 alertDelta 里继续把更深 band 的增益往上推
 * （trench_throat > trench_mouth > reef_deep）。只乘增益、不动消退＝逃生阀门不被加压买断。
 */
export const ALERT_DEPTH_FULL = 60;
/** 触发遭遇后警觉落到的值（留一段缓冲，避免连环伏击）。 */
export const ALERT_AFTER_TRIGGER = 0;

/** 深度因子：浅水 0（§7.5），ALERT_MIN_DEPTH 起线性爬升、60m 满（更深 band 的斜坡留 Phase 1）。 */
export function alertDepthFactor(run: RunState): number {
  const d = run.currentDepth ?? 0;
  if (d <= ALERT_MIN_DEPTH) return 0;
  return Math.min(1, (d - ALERT_MIN_DEPTH) / (ALERT_DEPTH_FULL - ALERT_MIN_DEPTH));
}

/** 警觉每回合净变化：暴露增益（signature 超基线 × 深度因子 × GAIN）− 基础消退。摸黑/浅水 → 负（消退）。 */
export function alertDelta(run: RunState, turns: number): number {
  if (turns <= 0) return 0;
  const exposure = Math.max(0, signature(run) - SIGNATURE_BASE); // 灯 +6 / 声呐 +3 / 摸黑 0
  // 深水区 C：band 探测压力倍率只乘暴露增益（不动消退）——更深 band 在深度因子饱和后仍「越深越凶」，
  // 但摸黑/浅水的净消退不变＝逃生阀门倍率买不断。缺省（POI 下潜 / reef_deep）→ 1，逐字节复现旧行为。
  const gain = exposure * alertDepthFactor(run) * ALERT_GAIN * (run.bandAlertFactor ?? 1);
  return (gain - ALERT_DECAY) * turns;
}

/** 警觉是否已到「捕食者接近」线（moveToNode 据此触发遭遇）；需够深（§7.5）。 */
export function predatorApproaches(run: RunState): boolean {
  return (run.alert ?? 0) >= ALERT_THRESHOLD && (run.currentDepth ?? 0) >= ALERT_MIN_DEPTH;
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
  // 升级轨：抗欺骗下调失真阈值（缺省回退基线常量），但 deriveSensorTuning 留地板＝声呐永不全可信。
  const falseEchoSanity = run.sensorTuning?.sonarFalseEchoSanity ?? SONAR_FALSE_ECHO_SANITY;
  if ((run.stats?.sanity ?? 100) < falseEchoSanity) {
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
  // 升级轨：抗欺骗下调灯幻觉阈值（缺省回退基线），但留地板＝灯最后崩、仍会崩。
  const halluSanity = run.sensorTuning?.lampHallucinationSanity ?? LAMP_HALLUCINATION_SANITY;
  if ((run.stats?.sanity ?? 100) < halluSanity) {
    return pick(LAMP_HALLUCINATION, `lamp:${node.id}:${Math.round(run.stats?.sanity ?? 100)}`);
  }
  return node.preview;
}
