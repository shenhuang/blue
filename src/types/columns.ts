// 探深「深度柱」（probe depth columns）—— 取代旧「一脊柱·一级一点·flag.probe.* 解锁」模型（#131）。
//
// 北极星「灯塔＝信息基建」的**垂直**实装：每座灯塔自带一根向下的深度柱（水平揭示圈之外·再往下看得更深）。
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

import type { UpgradeCost, MaterialCost } from './upgrades';
import type { Visibility, CurrentStrength } from './chart';
import type { ZoneTag } from './events';

/**
 * 深度柱的一级（一个深度档）。tier 1-based、同柱内连续递增；depthRange 越深档越深（check-dive-refs 守单调）。
 * 各 band 旋钮（visibility/tags/alertFactor/maxRoomFeatures/hunts）语义同 DepthBand——
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
  /** 能见度（缺省 clear；深档转 dark＝灯门核心压力，见 DepthBand.visibility）。感知重做删 murky 中间档（#262）。 */
  visibility?: Visibility;
  /** 洋流（缺省 none）。 */
  current?: CurrentStrength;
  /** 专属事件 tag 池（覆盖 zone.zoneTagsByDepth·附加而非纯替换·见 DepthBand.tags）。缺省＝走 zone 自身池。 */
  tags?: ZoneTag[];
  /** 探测压力倍率（深档越凶·见 DepthBand.alertFactor）。缺省 1。 */
  alertFactor?: number;
  /** 战利品深度倍率（深档越值钱·× loot roll 整数 qty·见 DepthBand.lootFactor）。缺省 1。 */
  lootFactor?: number;
  /** 多事件「大房间」上限（深档 2–3·见 DepthBand.maxRoomFeatures）。缺省 1。 */
  maxRoomFeatures?: number;
  // 不可信声呐失真强度（曾深档越骗）：**感知重做已删**（声呐诚实·SPEC §2.2/§3）。
  /** 是否启用「有位置的逼近猎手」（深/洞档 true·见 DepthBand.hunts）。缺省 false。 */
  hunts?: boolean;
  /** 出潜叙事（派生 band.blurb；缺省回退 column.blurb 或自动串）。 */
  blurb?: string;
  /** 危险提示（软门控·派生 band.danger）。 */
  danger?: string;
  /**
   * 标记为 capstone 档（非普通刷怪 band·如海沟科考站电梯入口·SPEC §10）。纯语义 + 派生 probe 升级文案分支；
   * band/POI 仍正常派生（它就是「那一个下潜点」），但通常不设 hunts＝不是普通深 band。
   */
  capstone?: boolean;
  /**
   * 建该级 probe 升级时置的 profile flag（buildAtLighthouse / devForceBuild 应用 def.setsFlag）。
   * capstone 用它揭示 flag-gated 区（如科考站·复用 #124 owner-less 区原语·= chart_regions.revealFlag）；
   * 必须 ∈ story.ts allStoryFlags()（playthrough-story §4 守「data story.* 字面量 ⊆ allStoryFlags()」）。
   */
  setsFlag?: string;
  /**
   * 建该级 probe 升级时**授予**的关键道具（capstone 产出·buildAtLighthouse / devBuildAtLighthouse 应用
   * def.grantsItem → addToInventory(profile.inventory)）。**跨柱硬依赖的载体**：热液 capstone 产出「下行动力核心」
   * （item.station_module）→ 海沟电梯 capstone 的 cost 消费同一 item ⇒ 不把热液探到底就拿不到核心、建不了电梯、
   * 下不去深渊路（「必经热液」）。该「capstone cost 消费的 key item 必有 capstone 产出来源」不变量由
   * check-dive-refs 守门（断了即 regress 红·CLAUDE.md 顶部「约定落成机制」）。
   */
  grantsItem?: MaterialCost;
  /**
   * capstone 专属解锁文案（覆盖 columns.ts 默认「探针到 ~Xm·唯一落脚处是…入口」泛文案）。各 capstone 含义不同
   * （海沟＝电梯入口／热液＝撬下古机械模块 + 读到更深处情报）时给各自的 note；缺省回退泛文案。
   */
  capstoneNote?: string;
  /**
   * 显式海图坐标（归一化·覆盖默认「宿主灯塔附近按 tier 扇开」的自动布点）。capstone（电梯）等需要摆到
   * 独立位置、脱离本柱密集簇时用——与对应 chart_regions flag-gated 区 center 对齐＝圈内含该点（不空圈）。
   */
  mapX?: number;
  mapY?: number;
  /**
   * 不在海图上生成下潜 POI（竖井等单入口深度柱的中间档）。设此的 tier 仍正常派生 band + probe 升级轨，
   * 只是不在海图上产生可点击的下潜点。仅 capstone POI 保留（如海沟科考站电梯入口·t4）。
   */
  noPoi?: boolean;
}

/**
 * 主线剧情档（「主线柱迁移」·D-2·A 案·作者 2026-06-28）——挂在 DepthColumn 上、**与刷怪 `tiers[]` 梯子并列、
 * 不进梯子**（区别于上一阶段把 story 塞进 DepthColumnTier 的草案：那会把主线 beat 拖进 probe 升级链 +
 * 单调约束，使「reef 免费入口」与「探深档位制」打架·见 docs/spec/深海回响_主线柱迁移_提案 A-2 的 ⚠️）。
 *
 * **为什么单列而非进 tiers[]（设计摩擦的干净解）**：beat 落该区入口的**原深度**（reef 10–30m·vent 井缘…），
 * 不受刷怪档「tier 连续 + 顶深单调」约束；reach 走「**host 灯塔建成**」一道门（链式 build-gate）而非 probe 档位
 * （depthTierRevealState 是探深刷怪档的事·与主线无关）；reveal 走「日志早揭示」（revealFlag 持有即知坐标·先于建前哨）。
 * 刷怪 tiers[] / probe 梯子 / columnBuiltLevel 全**逐字节不变**（不撕已测探深机制·CLAUDE.md「加法扩展」）。
 *
 * 复用上一阶段的 columnStory 下游管线（engine/columns.ts::storyTierPoi 透传到 ChartPoi.columnStory →
 * dive-start.ts 据此把 eventId 作入潜强制开场·与 4 canon 锚点强制块同源但不占 canon 名额）。
 */
export interface ColumnStoryTier {
  /** 该 beat 的绝对深度窗口（米·派生 story band 的 depthRange·落该区入口的原深度·不受刷怪档单调约束）。 */
  depthRange: [number, number];
  /** beat 档名（海图潜点名 + 派生 story band 名）。 */
  label: string;
  /** 入潜强制开场的主线节拍事件 id（dive-start.ts 据此设 forced open·getEventById 必解析·check-mainline-reachable 守）。 */
  eventId: string;
  /**
   * 本 beat「完成」flag（节拍事件 outcome.setProfileFlags 置位·主线链「上一步做完没」据此判）。
   * 必须 ∈ story.ts allStoryFlags()（playthrough-story §5「data story.* ⊆ allStoryFlags()」守门）。
   */
  beatFlag: string;
  // reveal 门（日志早揭示·「主线柱迁移」点 4）已**不在此 schema 上**：reveal 的单一来源＝「日志文献坐标」——
  // 导师日志（items.json mentor_logbook）的 story.marksPois 带这条柱的派生 story 潜点 id（poi.dive.<短名>.story·
  // columnStoryDivePoiId）⇒ poisKnownFromItems 据此「知道坐标」；engine/columns.ts::storyPoiRevealState 用它派生
  // hasReveal（不再裸 revealFlag）。揭示态（storyTierRevealState）：日志没标记 → hidden；标记且 host 未建 → dim
  // （看得到去不了·blockReason「需先建〈host〉」）；host 已建 → lit（下得去）。reef host=lighthouse.home 恒在 →
  // 教学完即 lit（免费入口）。「知道一个坐标」的唯一真相＝手里有没有写着它的那张纸（#117 续·物品即解锁同径）。
  /** 标记为主线链尾（章尾 beat）：结局判定读「它的 beatFlag 已置」而非硬编码锚点齐（数据驱动·dive-start/story.ts）。 */
  chainTail?: boolean;
  /**
   * 留白结局重访（St2·迁自旧 chart_pois 锚点 story.revisit*）：beat 已完成后再次入潜·持 revisitRequiresFlag
   * 且未置 revisitDoneFlag ⇒ 强制开场 revisitEventId（dive-start 据此·镜像旧锚点重访块）。一章仅 vent beat 用。
   * 三字段都 ∈ allStoryFlags() 范畴（revisitRequiresFlag/revisitDoneFlag 是 story.* flag·playthrough-story §5 守）。
   */
  revisitEventId?: string;
  revisitRequiresFlag?: string;
  revisitDoneFlag?: string;
  /** 出潜叙事（派生 story band.blurb；缺省回退 column.blurb 或自动串）。 */
  blurb?: string;
  /** 危险提示（软门控·派生 story band.danger）。 */
  danger?: string;
  /** 能见度（缺省 clear·派生 story band.visibility）。 */
  visibility?: Visibility;
  /** 洋流（缺省 none·派生 story band.current）。 */
  current?: CurrentStrength;
  /** 显式海图坐标（归一化·覆盖默认「宿主灯塔附近扇开」自动布点）。缺省走自动布点。 */
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
  /**
   * 主线剧情 beat（「主线柱迁移」·D-2）：设了 ⇒ 本柱**额外**承载一拍主线 beat（与刷怪 tiers[] 并列·不进梯子）。
   * 派生 story band（id=band.<短名>.story）+ 海图 story 潜点（id=poi.dive.<短名>.story·带 columnStory → dive-start
   * 入潜强制开场）；reach 走 host 灯塔建成（链式 build-gate）、reveal 走日志 revealFlag 早揭示——见 ColumnStoryTier。
   * 不派生 probe 升级（主线 beat 非探深刷怪档）。缺省 ⇒ 无主线 beat（普通刷怪柱·逐字节不变）。
   */
  storyTier?: ColumnStoryTier;
}

/** depth_columns.json 顶层结构。 */
export interface DepthColumnsFile {
  columns: DepthColumn[];
}
