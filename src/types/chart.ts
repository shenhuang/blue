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

import type { CaveRegion, ChartRegionId, NodeGate } from './dive';

/** 洋流强度档位。MVP：仅叙事 + 落到 run.diveModifier 留接口；冲走/漂移效果待实装。 */
export type CurrentStrength = 'none' | 'mild' | 'strong';

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
  /**
   * 整潜门（感知门 SPEC §2.1·取代旧 `visibility:'clear'|'dark'`）：落到 `run.diveModifier.gate`＝live-combine 的
   * run 属性（非 stamp 进 mapgen·见 dive-select.ts::effectiveGate）。给非豁免节点盖同一个门。
   *   - `{sense:'lamp',mode:'locked'}`＝旧 `visibility:'dark'`（黑处·可见但锁·没灯全黑）；
   *   - `{sense:'sonar',mode:'locked'}`＝整潜浑浊（灯没用·得扫一记声呐）；
   *   - 缺省（无 gate）＝旧 `'clear'`（不需灯就看清近场）。
   * 整潜门**只用 `locked`**（可见但锁·沿用 #221 预告语义）；`hidden` 只由 per-node 撒点产生（SPEC §2.1）。
   * 海图入口门（chart.ts::poiDiveBlock）读它判「缺该感官时挡下潜」。
   */
  gate?: NodeGate;
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
 *   dim    = 已知但当下去不了（暗：能力门未解 / 天气遮成暗 / 深度柱档未及）——显示但过不去
 *   hidden = 未揭示（圈外 / flags 未满足 / 天气彻底盖住）——不进 chart.pois、不渲染
 * 诚实轴：暗/隐没是天气与能力的真话；anchor 永不被天气藏（进度安全）；mimic 恒 lit（唯一谎点）。
 */
export type PoiRevealState = 'lit' | 'dim' | 'hidden';

/**
 * 月相（4 相·等分 7 天/相·SPEC §3）。类型落 types 层（foundational）；纯函数/常量在 engine/lunar.ts
 * （moonAge/lunarPhase/tideLevel·import 本类型）。给 ChartPoi.lunarWindow / ChartConditions.phase 用。
 */
export type LunarPhase = 'new' | 'waxing' | 'full' | 'waning';

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
   * 显式归属（owner 灯塔 id·区域揭示 owner-anchored）：设了 ⇒ 本 POI 属于该灯塔的揭示区——
   *   ① mapX/mapY 解释为**相对 owner 灯塔的偏移**（generateChart 用 owner 的「声明坐标」resolve 成绝对坐标）；
   *   ② 点亮判定走「owner 灯塔是否在 profile.lighthouses 里」而非几何（见 chart.ts isLit）。
   * 缺省 ⇒ owner-less：mapX/mapY 为绝对坐标、走几何点亮（mimic / 将来手工特例·须配 absolute:true）。
   * 注：story 锚点也带 owner（坐标基准 + 区域标签），但可达性仍由 story 短路恒可达、不被 owner 门控（见 isPoiLit）。
   */
  owner?: string;
  /**
   * owner-less「绝对坐标」lane 的显式 opt-in（保留未来手工特例 + 守门用）：true ⇒ 本 POI 有意无 owner、
   * 用绝对 mapX/mapY + 几何点亮。守门规则（playthrough-chart）：authored POI 必须有 owner，除非 absolute===true——
   * 自动内容生成不会登记 absolute ⇒ 漏不进这条 lane（守「自动内容只产 owner-bound 节点」）。
   */
  absolute?: boolean;
  /**
   * 海图 2D 视图上的归一化坐标（0–1，左→右 ≈ 离岸越远 / 越深，上下铺开）。SeaChartView 据此摆放标记点。
   * 可选——缺省时视图按 distance 兜底推算。**有 owner 时为相对 owner 的偏移**，generateChart resolve 后变绝对坐标
   * （此后 isLit / poiRevealState / effectiveDistance / UI 一律用绝对坐标，逻辑一行不改）。
   */
  mapX?: number;
  mapY?: number;
  /** 环境修正（可选） */
  modifier?: PoiModifier;
  /**
   * 主线剧情 beat 的入潜强制开场（「主线柱迁移」→ 2026-07-12 深度柱删除后 re-home 成 chart_pois 静态 anchor）：
   * 本 POI 是某条主线 beat 时，dive-start.ts::applyStoryOpen 据此把 eventId 作入潜强制开场——beatFlag 未置位时
   * 强制开场；已置位＝回流重访＝普通下潜（只读 flag 不写·quirk #118）。reveal 单一来源＝日志文献坐标
   * （mentor_logbook marksPois 本 POI id ⇒ documentKnowsPoi ⇒ poiRevealState 揭示·没抄到坐标则 hidden）；
   * reach 无额外门（深度柱 host-built/probe 解锁经济已删·深度门待经济重做·见 TODO）。缺省 ⇒ 普通 POI（零影响）。
   */
  story?: {
    /** 入潜强制开场的主线节拍事件 id。 */
    eventId: string;
    /** 本 beat「完成」flag（节拍事件 setProfileFlags 置位·主线链判定据此·∈ engine/story.ts allStoryFlags()）。 */
    beatFlag: string;
    /** 主线链尾（章尾 beat）：结局判定读它的 beatFlag 已置而非硬编码锚点齐（数据驱动·D-2 改动③）。 */
    chainTail?: boolean;
    /**
     * 留白结局重访（St2·剧情 SPEC §4.1）：beat **已完成**后再次入潜——若已置 revisitRequiresFlag 且未置
     * revisitDoneFlag——强制开场 revisitEventId（dive-start applyStoryOpen 读 flag 不写）。
     * 一章仅 vent beat 用：圆满后持破损饰品（charm_found·⟺ fulfilled-first）重访 → 留白结局（ending_blank）。缺省 ⇒ 无重访。
     */
    revisitEventId?: string;
    revisitRequiresFlag?: string;
    revisitDoneFlag?: string;
  };
  /**
   * 多口持久洞入口绑定（多口持久洞 SPEC §2.3）：设了 ⇒ 本 POI 是某持久洞的一个**入口**。
   * 下潜走持久洞路径（load-or-generate caveMaps[caveId]·起手 = 解析出的入口节点），而非 zone/band 每潜重生路径。
   * **解耦/数据驱动**：别处再开一个口 = 加一条带 caveEntry 的 POI 绑到现成入口门户，不重生、不改码。
   * 与 bandId/columnId 路径互斥（dive-start 先判 caveEntry）。
   */
  caveEntry?: {
    /** 目标洞稳定 id（= 持久图 seed·= caveMaps key·命名空间 cave.<短名>）。多口共享同一 caveId ⇒ 落同一张图。 */
    caveId: string;
    /**
     * 显式绑定到地图的某入口门户节点 id（最稳·作者钉死「这个口落这个节点」）。
     * 缺省 → 由 regionBias（或 mouthDepth 分桶）在该洞 entrance 门户里**确定性**派生（FNV(caveId::poiId)·零 rng·同口永远同节点）。
     */
    entryNodeId?: string;
    /** 区域偏置（缺省 entryNodeId 时用·按口的地理把它落到 rim/flank/deep 的入口门户）。 */
    regionBias?: CaveRegion;
    /** 该入口的声明深度（reef 口浅/vent 口深·生成时门户钉此深度）。缺省 → 取绑定节点 depth。 */
    mouthDepth?: number;
    /**
     * 入口被「封口」不可起手（上游 §5b/§6·温度过热过冷/只能当出口/得从别洞穿过去）：
     * true ⇒ 海图标已知但 dim、不能从此下潜（仍可作为洞内上浮的出口）。T4 温度门控的接入点。
     */
    entranceBlocked?: boolean;
  };
  /** true = 持久 anchor（永远在）；false = roaming（每次回港刷新） */
  persistent: boolean;
  /**
   * roaming 机会点的**稳定模板身份**（roaming 专属内容·2026-06-25）：运行时 `id` 形如
   * `poi.roam.<runsCompleted>.<templateId>` 每次出现都变（含 runsCompleted），无法被静态写的事件 `poiId`
   * 匹配；故 generateChart 在构造 roaming POI 时把模板的 `templateId`（数据里稳定）原样带上。
   * dive-start 透传给 buildEventPool（opts.poiTemplateId）做 POI 专属事件匹配——**roaming 内容按 templateId 钉**。
   * anchor / 深度柱 / mimic POI 不设此字段（缺省 undefined·零影响·它们的 `id` 本就稳定、走 poiId 精确匹配）。
   */
  templateId?: string;
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
   * 「故事重访变体」按深度途中触发（非锚点·不占 4 canon anchor 名额·quirk #174）：
   * 设了 storyOpenEvents ⇒ 入潜时 dive-start 按**顺序**选第一个「门控通过且未见过」的事件，透传 mapgen
   * **钉放到该事件 `depthRange` 的途中节点**（保证出现·不进随机池）——玩家下潜到那个深度才撞见（不是开场瞬移）；
   * 没下到该深度就上浮＝不进该节点＝事件 oncePerSave 不写 event_seen＝下次再钉·不可错过地等着。
   * 都不合（已全部走过）→ 普通下潜。**变体切换读各事件自身的 prereqFlags/forbiddenFlags/oncePerSave(event_seen)/
   * prereqEventIds（单一真相·POI 不重复写 flag 逻辑）**。用于「重返同一地点·随进度换节拍」的剧情点
   * （如教学后重返东礁老沉船＝tutorial.captain_revisit〔没见过怪相·可下去看〕→ captain_revisit_empty〔见过了·空了〕）。
   * 这些事件必须 `weight: 0`（不进随机池·只经本机制钉放·否则会被内容库淹没＝命中率个位数%·见 quirk #174）。
   * 仅 layered 图（reef/wreck）实现放置。置位归事件 setProfileFlags（dive-start 只读不写）。
   */
  storyOpenEvents?: string[];
  /**
   * 月相潮窗（SPEC §2.3·additive·缺省＝不受月相限制·现有 POI 零改动）：本 POI 仅在这些相位「窗内」可达。
   * 豁免 story/persistent/mimic（同 climateOcclusion·SPEC §2.3）——Ch.1 关键路径恒无窗（check-lunar-reach 守门）。
   * roaming 模板带它＝只在该相位入池（generateChart 选取过滤·随相位浮现/消失）。
   */
  lunarWindow?: LunarPhase[];
  /**
   * 窗外表现（缺省 'dim'·守诚实轴）：'dim'＝可见不可去（「满月再来」·可规划）；'hidden'＝彻底消失
   * （秘密/惊喜·仅在有情报时降级回 dim）。逐点拍·跟内容走（SPEC §2.3）。
   */
  lunarOffWindow?: 'hidden' | 'dim';
  /**
   * NPC/情报 flag（§5 可发现性·marksPois 之外的第二源）：profile.flags 含此 flag ⇒ 本 POI「已知」——
   * 窗外从 hidden 降级成 dim（「知道这儿某相位有东西、值得等」）。NPC 进度对话 setsFlag 置位（内容侧·守灯人 Aldo 讲潮汐）。
   */
  intelFlag?: string;
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
  /** 潮汐：涨潮 / 退潮。月相潮汐 SPEC §3 起由 tideLevel(day) 符号派生（>0 flood / ≤0 ebb·大潮在新月/满月）。 */
  tide: 'flood' | 'ebb';
  /** 天气：晴 / 薄雾 / 浓雾。浓雾时一处 roaming 机会点被一时盖住、这一拍不显。天气与月相独立两轴（SPEC §1）。 */
  weather: 'clear' | 'mist' | 'fog';
  /** 当前月相（SPEC §3·additive·UI 海况条显示月相盘）。派生自 day·不入存档。 */
  phase?: LunarPhase;
  /** 朔望相位龄 0..27（SPEC §3·additive·UI「下弦还有 N 天」周期带）。派生自 day。 */
  moonAge?: number;
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
  /** 区 id（单一来源见 types/dive.ts::ChartRegionId）。 */
  id: ChartRegionId;
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
