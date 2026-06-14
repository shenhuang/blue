// 探深「深度柱」（probe depth columns）—— 取代旧「一脊柱·一级一点·flag.probe.* 解锁」模型（#131）。
//
// 北极星「灯塔＝信息基建」的**垂直**实装：每座灯塔自带一根向下的深度柱（勘测站暗圈的垂直版）。
// 建到第 K 级（probe Lv.K）→ 深度档 1…K 可下潜（lit）、第 K+1 档以暗点现身（dim·看得到去不了）、
// 更深 hidden。一级露一档（depthTierRevealState：tier≤built → lit / ==built+1 → dim / else hidden）。
//
// **可拓展＝硬要求（作者 2026-06-14）**：每座灯塔的柱配置走数据（级数 + 每级深度/band 参数/账单），
// 不硬编码这 5 座——新灯塔（鲸落营地 / 后续章节新大地图）只加一条 DepthColumn 配置即有自己的柱。
// 故一根柱的「深度档」就是一组**派生 band**（engine/columns.ts::columnBands 由 tier 直接生成 DepthBand·
// 绝对 depthRange 覆盖 zone）+ 一条**派生 probe 升级轨**（columnProbeTracks·onlyLighthouse=宿主灯塔·
// 各级 cost＝该 tier 的账单）——bands.ts / lighthouses.ts 在加载时把它们并进各自注册表，
// 现成的 getBand / canBuildAt / buildAtLighthouse / 设施面板渲染零改即可消费。
//
// 最深留后续 Phase：各柱只下到「能见底」的中段（海沟 6 级止于 ~108m）；abyssal/hadal/nameless
// 「另一个世界」是专门 Phase（depth_bands.json 保留这些 band 作预留·暂无柱档抵达·见 deep_game_vision）。

import type { UpgradeCost } from './upgrades';
import type { Visibility, CurrentStrength } from './chart';
import type { ZoneTag } from './events';

/**
 * 深度柱的一级（一个深度档）。tier 1-based、同柱内连续递增；depthRange 越深档越深（check-dive-refs 守单调）。
 * 各 band 旋钮（visibility/tags/alertFactor/maxRoomFeatures/sonarDeception/hunts）语义同 DepthBand——
 * engine/columns.ts 把本 tier 直接生成一个 DepthBand（id＝band.<柱短名>.t<tier>）。
 */
export interface DepthColumnTier {
  /** 级数（1-based·同柱连续）。建到第 K 级 → 1…K 档 lit。 */
  tier: number;
  /** 本档的绝对深度窗口（米）。覆盖 zone.depthRange（与 DepthBand.depthRange 同义）。 */
  depthRange: [number, number];
  /** 档名（海图深入潜点名 + 派生 band 名 + probe 升级名后缀）。 */
  label: string;
  /** 建该级 probe 升级的账单（材料＋金币·派生进 LighthouseUpgradeDef.cost）。 */
  cost: UpgradeCost;
  /** 能见度（缺省 clear；深档转 murky/dark＝软门控核心压力，见 DepthBand.visibility）。 */
  visibility?: Visibility;
  /** 洋流（缺省 none）。 */
  current?: CurrentStrength;
  /** 专属事件 tag 池（覆盖 zone.zoneTagsByDepth·附加而非纯替换·见 DepthBand.tags）。缺省＝走 zone 自身池。 */
  tags?: ZoneTag[];
  /** 探测压力倍率（深档越凶·见 DepthBand.alertFactor）。缺省 1。 */
  alertFactor?: number;
  /** 多事件「大房间」上限（深档 2–3·见 DepthBand.maxRoomFeatures）。缺省 1。 */
  maxRoomFeatures?: number;
  /** 不可信声呐失真强度 0..1（深档越骗·见 DepthBand.sonarDeception）。缺省 0。 */
  sonarDeception?: number;
  /** 是否启用「有位置的逼近猎手」（深/洞档 true·见 DepthBand.hunts）。缺省 false。 */
  hunts?: boolean;
  /** 出潜叙事（派生 band.blurb；缺省回退 column.blurb 或自动串）。 */
  blurb?: string;
  /** 危险提示（软门控·派生 band.danger）。 */
  danger?: string;
  /**
   * 标记为 capstone 档（非普通刷怪 band·如海沟科考站电梯入口·SPEC §10）。纯语义 + 派生 probe 升级文案分支；
   * band/POI 仍正常派生（它就是「那一个下潜点」），但通常不设 hunts/sonarDeception＝不是普通深 band。
   */
  capstone?: boolean;
  /**
   * 建该级 probe 升级时置的 profile flag（buildAtLighthouse / devForceBuild 应用 def.setsFlag）。
   * capstone 用它揭示 flag-gated 区（如科考站·复用 #124 owner-less 区原语·= chart_regions.revealFlag）；
   * 必须 ∈ story.ts allStoryFlags()（playthrough-story §4 守「data story.* 字面量 ⊆ allStoryFlags()」）。
   */
  setsFlag?: string;
  /**
   * 显式海图坐标（归一化·覆盖默认「宿主灯塔附近按 tier 扇开」的自动布点）。capstone（电梯）等需要摆到
   * 独立位置、脱离本柱密集簇时用——与对应 chart_regions flag-gated 区 center 对齐＝圈内含该点（不空圈）。
   */
  mapX?: number;
  mapY?: number;
}

/**
 * 一根深度柱：挂在一座灯塔（lighthouseId）上、借一个 zone（zoneId）提供内容、由若干 tier 组成。
 * 柱 id 形如 `col.<短名>`（短名用于派生 band id / probe 升级 id / 深入 POI id）。
 */
export interface DepthColumn {
  /** 柱 id（`col.<短名>`·全局唯一）。 */
  id: string;
  /** 宿主灯塔 id（该灯塔在 profile.lighthouses 中存在＝柱激活·深入潜点现于其揭示圈内）。一柱一灯塔。 */
  lighthouseId: string;
  /** 借内容的 zone（ZoneDef.id）——各 tier 的 mapgen 形状 / 事件池来自它。 */
  zoneId: string;
  /** 柱显示名（probe 轨描述 / 派生 band 名用）。 */
  name: string;
  /** 柱级默认出潜叙事（tier 未写 blurb 时回退）。 */
  blurb?: string;
  /** 各深度档（索引顺序＝tier 升序·check-dive-refs 守连续单调）。 */
  tiers: DepthColumnTier[];
}

/** depth_columns.json 顶层结构。 */
export interface DepthColumnsFile {
  columns: DepthColumn[];
}
