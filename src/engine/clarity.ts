// 微观 clarity（下潜内感知）—— 感知重做 SPEC（docs/spec/深海回响_感知重做_SPEC.md）。
// 与 chart.ts 的"宏观 clarity（海图灯塔网）"平行：本文件只管"这一潜你带的灯 / 声呐"的近场诚实门 + 暴露脊柱。
//
// 新北极星（替代旧「越深越欺骗」·SPEC §1）：三件感知各司其职、诚实。
//   灯 = 诚实近场硬门：黑处（visibility:'dark'）没有效灯 → 可见但锁住；开灯 → 解锁可探。灯到即真、不再有「灯下幻觉」。
//   声呐 = 诚实远场侦察：ping 才扫、揭示前方地图规划纵深；永不撒谎、不碰选点（渲染在 SonarScanPanel）。
//   欺骗 = 只剩低理智轴（本文件不再承担）：san 低 → 改选项 / 改怪物；世界诚实。
// 深度不再降档预览——**darkness（visibility 标志）是唯一的门**（SPEC §2.1 / CLARITY COLLAPSE）。
// 灯门判定收在 dive-select.ts（enterNodeSelection·per-choice locked + preview）；本文件留传感器派生态 + 暴露脊柱。
//
// 纯函数 + 防御性读取（run 字段可能因脚本构造的部分 run 而缺失 → 用默认兜底）。

import type { RunState, DiveNode, ClarityTier, SensorTuning } from '@/types';
// 声呐量程跳数的基线/上限住 sonar.ts（声呐的家）；deriveSensorTuning 在此夹紧它。
import { SONAR_SCAN_RANGE, SONAR_SCAN_RANGE_MAX } from './sonar';

// ============================================================
// 可调参数（tunables，SPEC §8）
// ============================================================

/** 默认电池总量（升级可提升，留 Phase 2）。 */
export const POWER_MAX = 40;
/** 一次声呐 ping 的耗电（声呐 >> 灯，SPEC §3.2）。 */
export const SONAR_PING_COST = 6;
/** 灯每回合基准耗电（再乘水况因子；清水因子 0 → 浅水近免费，Q2）。 */
export const LIGHT_POWER_PER_TURN = 1;

// 假回波 / 伪接触 / 灯幻觉的**行为**（连同深 band 失真标度、伪装表象常量、假回波阈值曲线·及曾种进
// SensorTuning 的 sonarFalseEchoSanity/lampHallucinationSanity 阈值字段与其 _MIN 地板）已随感知重做**彻底删除**——
// 欺骗全部移交低理智轴（SPEC §2.3/§3），灯到即真、诚实侦察永不撒谎（车道 4 收尾·task #8 清干净惰性旋钮）。

/** signature（被探测度，0b 消费遭遇/伏击；0a 只派生）权重：灯高、声呐中、静默低。 */
export const SIGNATURE_BASE = 1;
export const SIGNATURE_LIGHT = 6;
export const SIGNATURE_SONAR = 3;

// ----- 升级轨地板/上限（深水区 Phase 0 升级轨，SPEC §8 / §11「升级」） -----
// 升级把上面的基线常量往"更强"推；这里的地板/上限守铁律：
//   读真相永远要自曝（§3.2/§3.3）——隐蔽能降 signature，但点灯/ping 暴露永不为 0。
//   （旧「无完全可信传感器」失真阈值地板已随感知重做删——声呐诚实、欺骗只剩低 san，不再有可调的失真阈值。）
/** 声呐 ping 耗电下限（升级最省也到此为止）。 */
export const SONAR_PING_COST_MIN = 3;
/** 灯耗电乘子下限（升级最省也到此为止；清水仍 0，只压黑/浊水那段）。 */
export const LAMP_DRAIN_MULT_MIN = 0.25;
/** signature 减免上限（隐蔽升满也到此为止）。 */
export const SIGNATURE_REDUCTION_MAX = 3;
/** 灯/声呐开着时的暴露下限（signature 超基线部分的地板）——保"自曝"结构张力，隐蔽再强也甩不掉。 */
export const SIGNATURE_MIN_ACTIVE = 2;

// 深度降档 reach 常量（LAMP_DEPTH_REACH / SONAR_DEPTH_REACH / *_MAX / CLARITY_FULL_DEPTH）+ 它们种进
// SensorTuning 的 lampDepthReach/sonarDepthReach 字段已随感知重做**彻底删除**（SPEC §2.1 CLARITY COLLAPSE：
// 深度不再降档预览·darkness 是唯一的门；task #8 清干净惰性旋钮·见报告决策）。
/** 大房间（多事件房间）出现率加成上限（声呐与房间 §6/§8.3 续）：升满也到此为止——大房间仍稀有、band maxRoomFeatures 仍是天花板。 */
export const ROOM_FEATURE_CHANCE_MAX = 0.3;
/** 猎手规避上限（猎手 SPEC §3 守地板）：单条规避旋钮（吸声/迷彩）升满也到此为止——规避永不到 1，最深/最凶仍找得到你（对称 SIGNATURE_MIN_ACTIVE 的「永不全隐」铁律）。 */
export const STEALTH_BONUS_MAX = 0.6;

/** 升级派生的传感器加成（来自 getRunBonuses；各项可缺，缺＝0）。 */
export interface SensorUpgradeBonus {
  sonarPingCostReduction?: number;
  lampEfficiency?: number; // 从灯耗电乘子 1 里减去的量（sum）
  signatureReduction?: number; // signature 减免（sum）
  sonarScanRangeBonus?: number; // 声呐一记 ping 的规划纵深跳数加成（视觉 lookahead + 猎手听觉同轴·sum，有上限 SONAR_SCAN_RANGE_MAX）
  roomFeatureChanceBonus?: number; // 大房间出现率加成（声呐与房间 §6/§8.3 续·sum，有上限 ROOM_FEATURE_CHANCE_MAX）
  soundAbsorbBonus?: number; // 猎手规避 T1 吸声（规避声感猎手·sum，有上限 STEALTH_BONUS_MAX）
  camoBonus?: number; // 猎手规避 T2 主动迷彩（规避光感猎手·sum，有上限 STEALTH_BONUS_MAX）
}

/**
 * 把"升级加成"烤成本次下潜的有效传感器参数（应用地板/上限）。createNewRun 出海前调一次，结果存 run.sensorTuning。
 * 空入参（未升级）→ 全基线（与 0a/0b 行为逐字节一致）。
 */
export function deriveSensorTuning(b: SensorUpgradeBonus = {}): SensorTuning {
  return {
    pingCost: Math.max(SONAR_PING_COST_MIN, SONAR_PING_COST - (b.sonarPingCostReduction ?? 0)),
    lampDrainMult: Math.max(LAMP_DRAIN_MULT_MIN, 1 - (b.lampEfficiency ?? 0)),
    signatureReduction: Math.min(SIGNATURE_REDUCTION_MAX, Math.max(0, b.signatureReduction ?? 0)),
    // 声呐一记 ping 的规划纵深跳数（感知重做 SPEC §2.2「更远的声呐 = 预判未来的选项」）：基线 + 加成，
    // 夹到上限＝再升也扫不穿整洞（守北极星）。同一值驱动视觉 lookahead 揭示 + 猎手听觉量程（不再分两轴）。
    sonarScanRange: Math.min(SONAR_SCAN_RANGE_MAX, SONAR_SCAN_RANGE + (b.sonarScanRangeBonus ?? 0)),
    // 大房间出现率加成（声呐与房间 §6/§8.3 续）：0..ROOM_FEATURE_CHANCE_MAX，缺省 0＝mapgen 输出逐字节不变。
    roomFeatureChanceBonus: Math.min(ROOM_FEATURE_CHANCE_MAX, Math.max(0, b.roomFeatureChanceBonus ?? 0)),
    // 猎手规避（猎手 SPEC §3）：0..STEALTH_BONUS_MAX，缺省 0＝无规避（stalker.ts::playerEvadesStalker 算 0 概率＝advanceStalker 逐字节不变·向后兼容）。
    soundAbsorbBonus: Math.min(STEALTH_BONUS_MAX, Math.max(0, b.soundAbsorbBonus ?? 0)),
    camoBonus: Math.min(STEALTH_BONUS_MAX, Math.max(0, b.camoBonus ?? 0)),
  };
}

/** 本次下潜声呐 ping 的有效耗电（升级派生·sensorTuning 必有〔createNewRun 种/hydrate 补〕）。dive.ts / NodeSelectView 共用。 */
export function sonarPingCost(run: RunState): number {
  return run.sensorTuning.pingCost;
}

/** 'none' 档（摸黑 / 灯打不透）的盲航预览文案——沿用旧 visibility:dark 行为（quirk #27/#41）。 */
export const BLIND_PREVIEW = '看不清，一团黑影。';
/** 'none' 档且该路已来过：你记得这片黑，但仍看不清里头。 */
export const BLIND_VISITED_PREVIEW = '来过的方向，记得这片黑。';
/** 灯门锁住（黑处无有效灯·可见但锁住·SPEC §2.1）的预览文案。 */
export const LOCKED_DARK_PREVIEW = '太暗，看不清——需要灯';

// ============================================================
// 传感器派生状态
// ============================================================

/**
 * 灯是否亮着（在发光 / 耗电 / 抬 signature）＝开 + 有电。**感知重做后这也就是「灯门是否开」**：
 * 新模型里黑处正是灯起作用的地方（不再有旧 lampEffective 的「dark 打不透」——那条 `越深越看不见` 已删）。
 * 灯门判定（黑处可见但锁住·SPEC §2.1）读的就是本函数（lamp on-and-powered），不是旧的排除 dark 的 lampEffective。
 * signature / power / exposure 读的「灯是否亮」也是本函数——保持不变。
 */
export function lampOn(run: RunState): boolean {
  return run.sensors.light && run.power > 0;
}

/** 这一潜的水是否全黑（visibility:'dark'·由 band/chart/column 派生落 diveModifier）——灯门的输入（SPEC §2.1）。 */
export function waterIsDark(run: RunState): boolean {
  return run.diveModifier?.visibility === 'dark';
}

/**
 * 灯门是否**锁住**这个下潜（SPEC §2.1「诚实近场硬门」）：黑处（waterIsDark）+ 没有效灯（灯没开或没电）→ 锁。
 * 开灯（且有电）→ 解锁。非黑水→从不锁（浅/清/浊水不需要灯就看得清近场）。
 * **触发是 lamp-on-and-powered，不是旧的排除 dark 的 lampEffective**（新模型里黑处正是灯起作用的地方）。
 */
export function lampGateLocked(run: RunState): boolean {
  return waterIsDark(run) && !lampOn(run);
}

/** 声呐是否在发挥作用（本回合发过一记 ping·感知重做 SPEC §2.2「ping 才扫」）：已解锁 + 本回合 sonar==='ping' + 有电。 */
export function sonarActive(run: RunState): boolean {
  return (
    run.sensors.sonarUnlocked &&
    run.sensors.sonar === 'ping' &&
    run.power > 0
  );
}

/**
 * run 级预览档（感知重做后塌成灯门二态·SPEC §2.1）：灯门锁住（黑处无有效灯）→ 'none'（盲）；否则 → 'full'（近场诚实真相）。
 * **关键**：非黑水（清 / 浊水）不需要灯就看得清近场 → 恒 'full'，即便灯关 / 没电（与 dive-select per-choice 灯门语义一致）。
 * 声呐不再产生 per-choice 预览档（声呐＝诚实远场侦察·渲染在 SonarScanPanel·永不撒谎、不碰选点）——故 'sonar' 档不再由本函数产出。
 * 深度不再降档（旧 clarityForNode 已删）：唯一的门是 darkness（lampGateLocked）。
 * ClarityTier 的 'sonar' 成员保留于类型（NodeSelectView/CSS 仍引用·lane 3/4 语义）——只是引擎不再产出它。
 */
export function clarity(run: RunState): ClarityTier {
  return lampGateLocked(run) ? 'none' : 'full';
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
  const mult = run.sensorTuning.lampDrainMult;
  return LIGHT_POWER_PER_TURN * lightDrainFactor(run) * mult * turns;
}

/** signature（被探测度）：灯亮高、声呐 ping 中、全关低。0a 只派生，0b 接遭遇/combat。 */
export function signature(run: RunState): number {
  const raw = (lampOn(run) ? SIGNATURE_LIGHT : 0) + (sonarActive(run) ? SIGNATURE_SONAR : 0);
  if (raw <= 0) return SIGNATURE_BASE; // 摸黑：最低暴露（隐蔽升级不影响关灯静默）
  // 升级轨：隐蔽降 signature 超基线部分，但留 SIGNATURE_MIN_ACTIVE 地板（点灯/ping 永远暴露你，守"读真相必自曝"）。
  const reduction = run.sensorTuning.signatureReduction;
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
/**
 * 一记声呐 ping 的**直接**警觉尖峰（声呐与房间 SPEC §5「每 ping … 抬 alert：点亮水里＝招捕食者」）。
 * 主动发声当场暴露你，区别于点灯/ping 在 tickTurns 里逐回合积累的那份（signature→alertDelta）。
 * 同守浅水免压（× alertDepthFactor，浅水 0）+ 越深越狠（× bandAlertFactor）；摸黑消退阀门不受影响。
 */
export const SONAR_PING_ALERT = 8;

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
  // 但摸黑/浅水的净消退不变＝逃生阀门倍率买不断。POI 下潜 / reef_deep → 1（createNewRun 种），逐字节复现旧行为。
  const gain = exposure * alertDepthFactor(run) * ALERT_GAIN * run.bandAlertFactor;
  return (gain - ALERT_DECAY) * turns;
}

/** 警觉是否已到「捕食者接近」线（moveToNode 据此触发遭遇）；需够深（§7.5）。 */
export function predatorApproaches(run: RunState): boolean {
  return run.alert >= ALERT_THRESHOLD && run.currentDepth >= ALERT_MIN_DEPTH;
}

// ============================================================
// 低理智轴：改怪物钩子（感知重做 SPEC §2.3/§7① 形态 a）
// ============================================================
// 欺骗只剩「低 san」这一根轴：san 够低 → 除了改选项（events.ts::isOptionVisible 读的 EventOption.hallucination·
// 阈值 HALLUCINATION_SANITY_MAX=50〕），还能**改怪物**——注入只在低 san 才出现的幻觉遭遇（看破/打赢即消·无实体伤）。
// 北极星：是**你疯了**、不是世界骗你；san 回上来 → 幻觉消失、控制组（高 san）永不出幻觉怪。
// 判定纯派生（读 run·不掷 RNG）；注入 wiring 在 dive-stalker.ts::maybeHallucinationEncounter（复用 zone 现有怪·
// 起战时标 hallucination:true·结算软化在 combat.ts）。

/**
 * 低理智幻觉怪的 san 阈值（≤ 此值才可能出幻觉遭遇）。占位·defer-number-tuning（作者最终统一调）。
 * 与选项半边 eventSatisfy.ts::HALLUCINATION_SANITY_MAX / events.ts::isOptionVisible 的 `sanity > 50` 同档，
 * 让「低 san = 改选项 + 改怪物」两半在同一根轴、同一条线上翻（SPEC §2.3 单轴）。
 */
export const HALLUCINATION_SANITY = 50;

/**
 * 是否可能撞上低理智幻觉遭遇（moveToNode 据此走注入钩子·mirror predatorApproaches）：
 * san ≤ HALLUCINATION_SANITY 且够深（§7.5 浅水免压·与真遭遇同守——浅水/教学区绝对安全）。
 * 高 san → 恒 false（控制组：世界诚实、无幻觉怪）。纯派生·不掷 RNG。
 */
export function hallucinationApproaches(run: RunState): boolean {
  return run.stats.sanity <= HALLUCINATION_SANITY && run.currentDepth >= ALERT_MIN_DEPTH;
}

/**
 * 一记扫描当场抬升的警觉量（pingSonar 调用）：浅水免压（深度因子 0）、深 band 更狠（band 倍率）。
 * 与逐回合积累分开——扫描是离散的主动暴露事件，故在动作里直接结算、不依赖之后是否移动。
 */
export function sonarPingAlertDelta(run: RunState): number {
  return SONAR_PING_ALERT * alertDepthFactor(run) * run.bandAlertFactor;
}

// ============================================================
// 威胁定位（声呐与房间 SPEC §7 S3 · 廉价版）
// ============================================================
// 把 Phase 0b 一直抽象的 run.alert 做成声呐图上一处**近似接触**：警觉高＝水里有东西循着你逼近，
// 声呐能听出个大概方位 + 远近，但读不准——廉价版**不定位到具体节点**（那是 stalker 版，§8.7 留作者拍板）。
// 单一来源（SonarScanPanel 纯渲染、不加判定分支）。威胁由 alert 驱动＝真危险（诚实·感知重做后无 san 侧失真）。

/** 声呐图上开始听得到威胁接触的警觉线（沿用 ALERT_WARN＝既有「熄灯反应窗口」预警线）。 */
export const THREAT_CONTACT_ALERT = ALERT_WARN;

export interface ThreatContact {
  /** 近似方位角（弧度）——按 turn 漂移，你定不住它（廉价版不锚到节点·确定性）。 */
  angle: number;
  /** 逼近度 0..1（0＝预警线刚到/最远，1＝最高警觉/最近）；blip 画得离你越近＝越逼近。 */
  proximity: number;
  /** 粗距标签：远 / 中 / 近（读不出精确距离·廉价版只给档）。 */
  range: 'far' | 'mid' | 'near';
  /** 已越过接近线（ALERT_THRESHOLD）——它到你跟前了、下一步移动会被接近遭遇（predatorApproaches）。 */
  imminent: boolean;
  /**
   * 读数损坏——**感知重做后恒为 false**：威胁接触由 alert（真危险）驱动、诚实（SPEC §2.2 声呐永不撒谎）。
   * 「读不出距离」这类失真属低理智轴（SPEC §2.3·非本车道），字段暂留给 UI 类型稳定（SonarScanPanel 仍读）。
   */
  garbled: boolean;
}

/**
 * 声呐图上的近似威胁接触（S3 廉价版）：由 run.alert 派生。alert < 预警线 → null（水里还算静、无接触）。
 * 越过预警线 → 一处听得见、定不住的接触：方位按 turn 漂移、距离只给粗档。诚实（garbled 恒 false·欺骗移交低 san 轴）。
 * 确定性哈希（不耗 RNG·SSR 安全）。
 */
export function threatContact(run: RunState): ThreatContact | null {
  const alert = run.alert;
  if (alert < THREAT_CONTACT_ALERT) return null;
  const span = Math.max(1, ALERT_MAX - THREAT_CONTACT_ALERT);
  const proximity = Math.min(1, (alert - THREAT_CONTACT_ALERT) / span);
  const imminent = alert >= ALERT_THRESHOLD;
  const range: ThreatContact['range'] = imminent ? 'near' : proximity > 0.45 ? 'mid' : 'far';
  const angle = (hashStr(`threat:${run.turn}`) % 360) * (Math.PI / 180);
  return { angle, proximity, range, imminent, garbled: false };
}

// ============================================================
// 预览文案：灯下诚实真相（感知重做后不再有低 san 幻觉改写·SPEC §2.1）
// ============================================================
// 声呐的不可信表象 / 结构化表象 / 低 san 伪接触 / 假回波阈值曲线整套已随感知重做删除——
// 声呐＝诚实远场侦察，永不撒谎（SPEC §2.2/§3）。

// 确定性哈希（FNV-1a）——威胁接触方位 / 未来低 san 钩子的稳定选择用（不消耗 RNG·SSR 安全）。
function hashStr(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * 灯下看到的预览＝地面真相（node.preview），恒诚实。
 * 感知重做删掉了旧的「san 足够低 → 灯也产幻觉」分支（欺骗全部移交低理智轴·SPEC §2.1/§2.3）：灯到即真。
 */
export function lampPreview(_run: RunState, node: DiveNode): string {
  return node.preview;
}
