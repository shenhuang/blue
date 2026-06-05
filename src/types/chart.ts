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
}

/** 海图上的一个兴趣点 */
export interface ChartPoi {
  /** 运行时稳定 id（anchor 在数据里写死；roaming 形如 `poi.roam.<seed>.<i>`） */
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
