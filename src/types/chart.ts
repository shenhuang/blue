// 港口海图（POI 选点）类型
// 把"选哪个 zone 出海"从 Aldo 对话里的扁平下拉，升级成港口外的"兴趣点海图"：
// 每个 POI 引用一个 zone（zoneRef），叠加可选的环境修正（深度偏移 / 洋流 / 能见度），
// 并用 flag（是否发现）+ 升级（是否有能力抵达）两级门控。
//
// 引擎层 generateChart(profile) 是纯函数：anchor 点持久存在，roaming 点按
// profile.runsCompleted 做种子刷新——所以每完成一次出海回港，远海机会点会"换一批"，
// 不需要把海图本身写进存档（派生自 profile，零 SAVE_VERSION 影响）。
//
// 详见 src/engine/chart.ts 与 docs/STATUS.md §5「港口海图选点 UI」。

/** 洋流强度档位。MVP：仅叙事 + 落到 run.diveModifier 留接口；冲走/漂移效果待实装。 */
export type CurrentStrength = 'none' | 'mild' | 'strong';

/** 能见度档位。MVP：仅叙事 + 落到 run.diveModifier 留接口；光照/可见性效果待实装。 */
export type Visibility = 'clear' | 'murky' | 'dark';

/**
 * POI 环境修正 —— 全部可选，叠加在所引用 zone 的基础参数上。
 * 当前实装程度见各字段注释；未实装的留作"接口"，后续 session 接。
 */
export interface PoiModifier {
  /**
   * 深度偏移（米）：平移所引用 zone 的 depthRange（+ 更深 → 经 tickTurns / planAscent
   * 自然更耗氧、更长减压）。**已实装**（mapgen 生成时平移每层深度）。
   */
  depthOffset?: number;
  /** 洋流强度。MVP 仅落到 run.diveModifier + 叙事日志；冲走/漂移效果待实装。 */
  current?: CurrentStrength;
  /** 能见度。MVP 仅落到 run.diveModifier + 叙事日志；光照半径/事件可见性效果待实装。 */
  visibility?: Visibility;
  /**
   * 覆盖 zone.depthRange 的绝对深度窗口（米·与 band.depthRange 同义）。**已实装**（直通 GenOpts.depthRange）。
   * 「平廊」类 POI 用窄 span 表达横向洞——洞型谱 #114 的 span 旋钮在调用方，这就是那个调用方。
   */
  depthRange?: [number, number];
  /** 覆盖 zone.layerCount 的图规模（maze: N≈2×layerCount）。**已实装**。平廊靠它做「进来太远」回程预算。 */
  layerCount?: number;
  /** 钉死本 POI 剖面曲线 k（#114·缺省按 POI id 哈希在 zone.depthCurveRange 内派生性格）。**已实装**。 */
  depthCurve?: number;
}

/**
 * POI 在海图上的揭示态（区域揭示主实装块·三态·§10）：
 *   lit    = 圈内·已发现·可出海（亮）
 *   dim    = 已知但当下去不了（暗：能力门未解 / 天气遮成暗 / 勘测到但超出可达）——显示但过不去
 *   hidden = 未揭示（圈外 / flags 未满足 / 天气彻底盖住）——不进 chart.pois、不渲染
 * 诚实轴：暗/隐没是天气与能力的真话；anchor 永不被天气藏（进度安全）；mimic 恒 lit（唯一谎点）。
 */
export type PoiRevealState = 'lit' | 'dim' | 'hidden';

/** 海图上的一个兴趣点 */
export interface ChartPoi {
  /** 运行时稳定 id（anchor 在数据里写死；roaming 形如 `poi.roam.<runsCompleted>.<templateId>`，按模板键稳定·中途点亮灯塔不重洗） */
  id: string;
  /** 引用的 zone（ZoneDef.id） */
  zoneId: string;
  /** 海图上显示的点位名（叠在 zone 名之上，如「塌口北缘」） */
  name: string;
  /** 简短叙事描述（接替旧 Aldo warning 文案的位置） */
  blurb: string;
  /** 距离档位（0 = 近岸；越大 = 路上越久）。驱动「远 = 多耗氧 / 多 turn」接口。 */
  distance: number;
  /**
   * 海图 2D 视图上的归一化坐标（0–1，左→右 ≈ 离岸越远 / 越深，上下铺开）。
   * SeaChartView 据此摆放标记点。可选——缺省时视图按 distance 兜底推算。
   */
  mapX?: number;
  mapY?: number;
  /** 环境修正（可选） */
  modifier?: PoiModifier;
  /** true = 持久 anchor（永远在）；false = roaming（每次回港刷新） */
  persistent: boolean;
  /** 抵达能力门控：需要某全局升级（hasUpgrade）。未满足 → 海图上灰显可见但不能出海。 */
  requiresUpgrade?: string;
  /**
   * 抵达能力门控（灯塔设施版，基建地图 Phase C）：需要家灯塔建成某设施（如「船坞」）。
   * 与 requiresUpgrade 并列检查；用于 dockyard 迁灯塔后的「大船才出得了远海」门控。
   */
  requiresLighthouseUpgrade?: string;
  /** 发现门控：这些 flag 都满足才出现在海图上（镜像 ZoneDef.requiresFlags）。 */
  requiresFlags?: string[];
  /**
   * 「无灯之光」假 POI（深水区 Phase 3 mimic capstone，§3.5）。true = 这个点在海图上**点亮**（引诱），
   * 却**没有任何自家灯塔能解释**它为什么亮（宏观 tell：交叉比对灯塔网就看出「我的网点不亮那儿」）。
   * 远距分辨不出它和真信标；绝望/盲目的玩家照样横渡过去 → startDiveFromPoi 路由进 mimic 兑现事件。
   * isPoiLit 对 mimic 恒真（这是诱饵），isPoiExplainedByLighthouse 恒假（这是 tell）。
   */
  mimic?: boolean;
  /**
   * 一章剧情锚点（St1·剧情 SPEC §4.1·#117·沿 mimic「入潜强制开场事件」模板）：
   * anchor ∈ engine/story.ts::CH1_ANCHORS（'reef'|'wreck'|'midwater'|'vent'·quirk #118
   * 字面量守门归 playthrough-story）；eventId = 入潜强制开场的锚点节拍事件。
   * 触发规则（作者拍 2026-06-12·任意顺序）：该锚点 flag 未置位才强制开场；其中 vent
   * （结局分歧）额外要求其余三锚点全置位——否则都是普通下潜（回流重访自然成立）。
   */
  story?: { anchor: string; eventId: string };
  /**
   * 运行时揭示态（generateChart 派生写入·区域揭示三态·§10）。只有进了 chart.pois 的点带它（'lit'|'dim'）；
   * 'hidden' 点不入结果。纯派生、不入存档（同 roaming 的运行时 id 一样按 profile 重算）。
   */
  revealState?: PoiRevealState;
}

/**
 * 海况（声呐与房间 SPEC §6.5「灯塔＝海图声呐」之「POI 不总全揭、随回合变」）。
 * 派生自 profile.runsCompleted（同 roaming 的潮位套路·不入存档·零 SAVE_VERSION 影响）；
 * 宏观偏「天气/潮汐的不全」、相对可信（欺骗留微观声呐 + mimic 假 POI）。
 */
export interface ChartConditions {
  /** 潮汐：涨潮 / 退潮（叙事 + 影响遮蔽）。 */
  tide: 'flood' | 'ebb';
  /** 天气：晴 / 薄雾 / 浓雾。浓雾时一处 roaming 机会点被一时盖住、这一拍不显（下次回港潮退又回来）。 */
  weather: 'clear' | 'mist' | 'fog';
}

/** 一张生成出来的海图 */
export interface SeaChart {
  /** 生成时的 runsCompleted（roaming 的种子；UI 可据此显示「潮位已变」） */
  generatedForRun: number;
  /** 当前对玩家"可见"（requiresFlags 已满足）的 POI；能否出海另由 requiresUpgrade 决定 */
  pois: ChartPoi[];
  /** 本次海况（潮汐/天气）——§6.5「海图是活的、随回合变」。 */
  conditions: ChartConditions;
}

// ── 区域揭示配置（区域揭示配置化 SPEC·data-driven·跨章复用）─────────────────
// 单一来源 data/chart_regions.json：引擎读 radius（揭示半径）、UI 读 palette/shape/label。
// owner 灯塔在 profile.lighthouses 中存在＝本区揭示（圈出现）。每个区＝一座 owner 灯塔的揭示圈。

/** 揭示区调色板 token（CSS 类 .reveal-<palette>·作者 2026-06-13 配色）。 */
export type RegionPalette = 'cyan' | 'green' | 'blue' | 'amber' | 'navy' | 'violet' | 'ruin';

/** 揭示区形状：circle=离岸整圆 / coast=海岸半圆（clip 左半·家灯塔从海岸鼓进水里）。 */
export type RegionShape = 'circle' | 'coast';

/**
 * 一个揭示区的配置。揭示来源**两选一**（不变量·engine/regions.ts 加载时分类·
 * playthrough-chart 断言 regionConfigErrors() 为空＝焊成 regress 门）：
 *   - owner 灯塔锚定（reef/wreck/midwater/vent/trench）：owner 灯塔在 profile.lighthouses
 *     中存在＝本区揭示，圈心＝该灯塔 mapX/mapY、半径随前哨衰减（effectiveRevealRadius）。
 *   - flag-gated（owner-less·鲸落区起）：profile.flags 含 revealFlag＝本区揭示，圈心＝显式
 *     center、半径＝radius（无灯塔→无衰减）。这是「按条件揭示的隐藏区」**通用原语**——条件
 *     是 flag，触发可以是任何置 flag 的东西（剧情节拍 / NPC 对话 / 下潜捡到道具 / 目击
 *     计数…见 2026-06-14 架构讨论）。诚实轴不破：圈内 POI 走 isLit 正常揭示·mimic 仍唯一谎点。
 */
export interface ChartRegionDef {
  /** 区 id（'reef'|'trench'|'wreck'|'midwater'|'vent'|'whalefall'…）。 */
  id: string;
  /** UI 标签（'珊瑚区' 等）。 */
  label: string;
  /** owner 灯塔 id（全局唯一）。该灯塔存在＝本区揭示·圈心＝灯塔坐标。与 revealFlag 二选一。 */
  owner?: string;
  /** flag-gated 揭示门：profile.flags 含此 flag＝本区揭示（owner-less）。与 owner 二选一。 */
  revealFlag?: string;
  /** flag-gated 区的圈心（归一化坐标·owner-less 区必填——无 owner 灯塔可取坐标）。 */
  center?: { x: number; y: number };
  palette: RegionPalette;
  shape: RegionShape;
  /** 归一化揭示半径（世界单位·替代旧全局 BASE_LIGHT_RADIUS 巨值）。 */
  radius: number;
}

/** 一张地图的揭示区集合（ch1 / ch2 / 外传…按 mapId 分；owner 全局唯一·跨图按 owner 索引）。 */
export interface ChartMapRegionsFile {
  [mapId: string]: { regions: ChartRegionDef[] } | string;
}
