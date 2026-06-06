// 深度 band —— 深水区 Phase 1「可扩展纵向深度轴」。
//
// 全局深度阶梯（跨 zone，SPEC §3.4 / §6 草案）：每个 band 是梯子上的一级，**引用一个 zone 提供内容**
// （mapgen 形状 / 事件池 / zoneTagsByDepth / ambushEncounters），但用自己的**绝对 depthRange 覆盖**该 zone
// 的 depthRange（band 决定「下到多深」，zone 决定「那里有什么」）。架构不硬编码地板——梯子可续写更深 band。
//
// **软门控（作者 2026-06-03）**：band **不带硬解锁 flag**——「能不能在这深度活下来」由装备（声呐解锁 + 电池/升级，
// 都吃深料，见深水区 Phase 0 升级轨 quirk #60）和（后续）强敌战斗力检测决定，不是一道开关。
// **成本（作者 2026-06-03）**：不在耗电上加深度税；深 band 更**暗**（visibility）→ 灯打不透 → 被迫用更耗电的
// 声呐 + 每个路口都要重 ping → 电量压力**间接**抬升（复用现有 visibility→clarity→forced-sonar→power 回路）。
// 故 band 的核心成本杠杆＝visibility，而非新的 depth→drain 项。

import type { CurrentStrength, Visibility } from './chart';
import type { ZoneTag } from './events';

export interface DepthBand {
  /** 稳定 id（如 band.trench_mouth）。 */
  id: string;
  /** 出潜面板显示名。 */
  name: string;
  /** 提供内容的 zone（ZoneDef.id）——mapgen 形状 / 事件池 / zoneTagsByDepth / ambushEncounters 都来自它。 */
  zoneId: string;
  /** 本 band 的绝对深度窗口（米）。覆盖 zone.depthRange（经 mapgen GenOpts.depthRange）。 */
  depthRange: [number, number];
  /** 梯子位置（升序＝越来越深）；UI 排序 +「下一级更深」语义。 */
  order: number;
  /** 能见度——深 band 越暗 → 灯打不透 → 被迫声呐（软门控核心压力）。缺省 clear。 */
  visibility?: Visibility;
  /** 洋流（可选，沿用 PoiModifier 接口；本期 demo 不设）。 */
  current?: CurrentStrength;
  /** 出潜面板叙事。 */
  blurb: string;
  /** 危险提示（软门控：不锁、只标——UI 提醒「装备不够别硬下」）。 */
  danger?: string;
  /**
   * 探测压力倍率（深水区 C，2026-06-04）：× alertDelta 的暴露增益。深度因子在 ALERT_DEPTH_FULL(60m)
   * 饱和后，更深 band 靠它继续「越深越凶」——trench_throat 比 trench_mouth 比 reef_deep 更快被盯上。
   * 只乘增益、不动消退（DECAY）：摸黑/浅水仍是逃出生天的阀门，倍率再高也甩得掉（守无脚本死）。
   * 缺省（reef_deep / 非 band 的 POI 下潜）→ 1，行为与 C 之前逐字节一致。
   */
  alertFactor?: number;
  /**
   * 本 band 的专属事件 tag 池（深水区内容期）：**覆盖** zone.zoneTagsByDepth，让 band 用自己的
   * 事件池、与「借来的」zone 内容隔离（trench 借蓝洞 mapgen 形状，但事件走 twilight/midnight 专属池）。
   * 约定**附加而非纯替换**——列表里带上 zone 自身的 tag（如 cave）＝保留 zone 回退池 + 叠加 band 专属，
   * 避免深 band 事件稀时退化成空水道。缺省（reef_deep 等不设）→ 回退 tagsForDepth，行为不变。
   */
  tags?: ZoneTag[];
  /**
   * 多事件「大房间」上限（声呐与房间 SPEC §6/§7 S1）：本 band 的事件房间最多含几个 feature。
   * 缺省 / ≤1（reef_deep 等不设）→ 永远单事件房间 ＝ 旧图逐字节不变（向后兼容、不破 mapgen 快照）。
   * >1（深 band 设 2–3）→ 事件房间偶尔升级成 2–3 feature 的大房间（大房间稀有）；深段内容（C）铺在其中，
   * 配合声呐扫描「先看见一个开阔房间、再凑近逐个点亮」的探索质感。透传 startDiveFromOutpost → mapgen。
   */
  maxRoomFeatures?: number;
  /**
   * 不可信声呐失真强度（声呐与房间 SPEC §5/§7 S2）：0..1。data 驱动、**非单调**——
   * 中深段（竖井喉/深渊/超渊）高、渊外 subhadal 回落（『那些骗你的把戏都停了』：越深越欺骗的梯度在最底反转，
   * 它不再骗你、只给你下去的理由）。双重作用：
   *   ① mapgen 据此给本 band 部分内部节点掷 spoofsSonar（声呐图上假装成朝上的出口/信标＝节点版 mimic）/
   *      evadesSonar（无回波，捕食者躲过你的 ping）——**确定性哈希、不耗 rng**，仅 >0 才进＝缺省零改动（守旧图/快照）；
   *   ② 落 run.sonarDeception，clarity.ts::effectiveFalseEchoSanity 据此抬高低 san 假回波/伪接触/读数乱码阈值
   *      （深 band 更易骗）。
   * 缺省（reef_deep / trench_mouth / 非 band 的 POI 下潜）→ 0 ＝声呐相对老实、零行为变化（守 sensors 回归）。
   */
  sonarDeception?: number;
  /**
   * 是否启用「猎手」（猎手 SPEC Phase 1·§2.6 范围门控）：true → 本 band 的高警觉遭遇升级成**有位置的逼近猎手**
   * （出现在你声呐量程外→逐回合沿图逼近→追到你才触发现有 ambushEncounters 伏击·复用现有捕食者不加新敌），
   * 配合声呐「知道它在哪」/ 灯「只知道有东西在接近」的感知分层（§2.1）。落 run.huntEnabled（startDiveFromOutpost 透传）。
   * 缺省 / false（reef_deep / 非 band 的 POI 下潜 / 浅水）→ 走旧 alert→伏击瞬时路径＝逐字节不变（向后兼容·守 playthrough-stealth）。
   * Phase 1 范围＝深 band（trench+·越深越会 evadesSonar 躲扫描）；浅水小概率弱变体留 Phase 2（猎手 SPEC §7）。
   */
  hunts?: boolean;
}

export interface BandsFile {
  bands: DepthBand[];
}
