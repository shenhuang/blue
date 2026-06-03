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
}

export interface BandsFile {
  bands: DepthBand[];
}
