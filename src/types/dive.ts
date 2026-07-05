// 下潜地图与节点图类型
// 对应主 SPEC §6.1 节点图生成

import type { ZoneTag } from './events';

// ============================================================
// 统一门模型（感知门 SPEC·灯/声呐 × 隐藏/锁住·2×2）—— 一个门 = 哪种感官解锁 × 不满足时怎么表现。
// 取代 #262 的 `DiveNode.dark:boolean` + 旧整潜级 `diveModifier.visibility:'clear'|'dark'`（收成一处 per-node·
// live-combine 语义见 dive-select.ts::effectiveGate/gateUnlocked）。runtime 生成·不入存档 → 干净替换。
// ============================================================

/** 哪种感官能解锁这个门（灯＝持续装备态·声呐＝一记 ping 粘住·SPEC §2.2）。 */
export type GateSense = 'lamp' | 'sonar';
/** 门不满足时的表现（SPEC §2）：locked＝看得见但不能选（多数）/ hidden＝根本不显示（伏笔岔口）。 */
export type GateMode = 'hidden' | 'locked';

/** 一个门（感知门 SPEC §2.1）。缺省（无 gate）＝普通节点：有没有灯/声呐都看得见、都能选。 */
export interface NodeGate {
  sense: GateSense;
  mode: GateMode;
  /** 作者供的「为什么这里非这感官不可」成因文案（按剧情/环境而定）·缺省用 sense 的中性兜底（LOCKED_FALLBACK）。 */
  reason?: string;
}

/** 某一 sense 的门密度配比（zone.gates 撒点规格·SPEC §6·dormant·缺省全 0⇒byte-identical）。 */
export interface GateDensity {
  /** 深档密度 0..1（占位·defer-number-tuning）。 */
  deep?: number;
  /** 中档密度 0..1。 */
  mid?: number;
  /** 浅档密度 0..1。 */
  shallow?: number;
  /** 撒到的门里判 hidden 的比例 0..1（其余为 locked·缺省 0＝全 locked）。 */
  hiddenRatio?: number;
}

/** 一个 zone 的门撒点规格（每 sense 一组密度 + hidden/locked 配比·SPEC §6）。缺省全关（dormant）。 */
export interface ZoneGates {
  lamp?: GateDensity;
  sonar?: GateDensity;
}

/**
 * 地图布局风格（**纯渲染**·决定节点图怎么"铺"·不改拓扑/深度/存档）。**三者纵轴 Y 都＝真实深度**
 * （#92「位置即深度」·绝不脱钩·2026-06-27 作者拍），只是横轴 X 用法不同。
 * 单一来源在渲染层 `ui/mapLayout.ts`（按此分派铺点）；engine 只「盖章」到 DiveMap.layoutStyle 让渲染自描述。
 *  - 'vertical'（默认）：X＝同深兄弟摊开（#92 历史行为·所有不声明的 zone 走这条·逐字节不变）。
 *  - 'horizontal'：X＝进洞树距(layer)·铺宽。仅深度锁带(orientation='horizontal')的洞才呈横向条带；
 *    深度爬升的洞用它会如实呈斜（故那种洞不该横）。
 *  - 'serpentine'：X 随深度三角波左右折返＝下行 switchback（横→下降→反向横·Y 仍是真实深度）。
 * （radial / spiral 已废——它们把深度塞进半径/角度、违反「位置即深度」。）
 * 「宽」布局（非 vertical）POI 普遍更多——见 mapgen `nodeCountMultiplier`。
 */
export type LayoutStyle = 'vertical' | 'horizontal' | 'serpentine';

/** Zone 定义 —— 一个海域 */
export interface ZoneDef {
  id: string;
  name: string;
  description: string;
  /** 节点图深度跨度 [浅, 深] */
  depthRange: [number, number];
  /** 节点图层数（每层 = 一次选择） */
  layerCount: number;
  /** 每层节点数（min, max） */
  nodesPerLayer: [number, number];
  /** 抽取事件用的 zoneTag 池（每层可不同） */
  zoneTagsByDepth: Array<{ minDepth: number; tags: ZoneTag[] }>;
  /** 解锁条件：哪些 flag 必须存在 */
  requiresFlags?: string[];
  /** MVP 阶段：教学关用 'linearScripted' 表示线性脚本下潜 */
  generation: 'random' | 'linearScripted';
  /** 线性脚本下潜的起始事件 id */
  scriptedStartEventId?: string;
  /**
   * 教学关 node 化（#221+·SPEC docs/spec/深海回响_教学关node化_SPEC.md）：把脚本 beats 钉到 layered 图的指定层首节点
   * （layer 索引 → eventId）。配了它 ⇒ 教学首潜走 layered 多节点图（与重访**共用同一布局**）而非旧单节点图；节点间靠
   * forceAscend 事件退出（玩家被 `run.ascentLocked` 锁住、只能沿单向图前进）。仅首潜生效（mapgen 按 `event_seen:scriptedStartEventId` 门控·重访不钉）。
   */
  scriptedNodeEvents?: Array<{ layer: number; eventId: string; preview?: string }>;
  /**
   * 随机图（generation='random'）的拓扑形态。与 canFreeAscend 正交：
   *  - 'layered'（默认，缺省即此）：层状 DAG——每层 2–3 节点、深度单调递增、只连下一层。
   *    旧灯塔礁 / 沉船墓园等开阔海域用这套。
   *  - 'maze'：洞穴"迷路"图——双向边的连通图，有环（绕一圈回到原点）、死路（dead-end）、
   *    多个"最深点"（局部深度极大）。入口与"洞另一头的出口"都是 ascent_point，其余内部节点
   *    在 canFreeAscend=false 时仍被 isAscentBlocked 锁住。蓝洞群用这套。
   * 注：mapShape 只决定拓扑；上浮语义仍由 canFreeAscend 单独控制（解耦，便于未来组合）。
   */
  mapShape?: 'layered' | 'maze';
  /**
   * 地图朝向（仅 mapShape='maze' 生效）：
   *  - 'vertical'（默认）：深度随树距递增，危险轴 = 「太深了」（现有行为）。
   *  - 'horizontal'：深度锁在 depthRange 中值 ± (span/2) 小幅浮动，节点沿水平轴延伸；
   *    危险轴从「太深」换成「进来太远——回得去吗」（探索距离替代深度成为主要压力）。
   *    depthRange 在此模式下表示「基准深度 ± span/2」，而非单调下行窗口。
   */
  orientation?: 'vertical' | 'horizontal';
  /**
   * 地图布局风格（纯渲染·见 LayoutStyle）。缺省时由渲染层兜底：
   * `layoutStyle ?? (orientation==='horizontal' ? 'horizontal' : 'vertical')`。
   * 想让某 zone 在调试器/声呐图里长成特定形状＝在这里声明一条，别改渲染码。
   */
  layoutStyle?: LayoutStyle;
  /**
   * 洞穴剖面曲线指数 k 的派生区间（仅 mapShape='maze' 生效·洞型谱机制）：
   * 迷路图深度按 depth = d0 + span·frac^k 赋值（frac=树距比例），k 决定「落差发生在行进的哪一段」：
   *  - k<1：进洞先掉竖井、深处横向铺开（井+廊）
   *  - k≈1：匀速下行（旧线性剖面）
   *  - k>1：长平廊道、尽头才突然掉深坑（广中藏深）
   * 配了区间 → 每个地点（seedKey=POI/band id）由 FNV 哈希在 [min,max] 内 log-uniform 派生自己的 k
   * ＝每个洞口有固定「性格」（与 #98 同地点同图同思路·零 rng·不动任何 seed 的生成顺序）。
   * 缺省或无 seedKey → k=1＝逐字节复现旧图。显式 GenOpts.depthCurve 优先（scenario / dev 面板用）。
   * 未来更多剖面变种（虹吸/双坑…）统一在 mapgen 的曲线求值点上扩，别在别处再写深度公式。
   */
  depthCurveRange?: [number, number];
  /**
   * 是否允许在任意节点自由上浮（normal / rushed 模式）。
   *  - true（默认，开阔海域）：玩家可在任何 NodeSelect / RestView 触发 AscentView，三种模式都可用。
   *  - false（洞穴/封闭水道）：normal / rushed 必须在 ascent_point 节点才允许；其它地方只能 emergency，
   *    叙事是"凿穿洞顶"。mapgen 也会避免在中间层生成 ascent_point；末层仍保留 ascent_point 作为洞穴另一端的出口。
   */
  canFreeAscend?: boolean;
  /**
   * 深水区 Phase 0b：该 zone 潜伏捕食者可用的遭遇 id 池。警觉越过阈值时 moveToNode 触发其一
   * （复用该 zone 现有的 solo encounter）。空 / 未设 → 该 zone 无主动遭遇——浅水 / 教学 zone 不设，
   * §7.5「浅水免探测压力」天然成立。
   */
  ambushEncounters?: string[];
  /**
   * Q3 浅水弱变体（猎手 SPEC §2.6「浅水小且弱」）：true → 本 zone 的**浅水段**（< ALERT_MIN_DEPTH·
   * 警觉积累不到的那段）有小概率出一只**弱猎手**（慢、单感、不躲声呐、不主动探测）。
   * 与警觉/predatorApproaches 无关（§7.5 浅水免压不破：alert 仍不积累·瞬时伏击路径不变）；
   * 缺省/false ＝浅水照旧绝对安全（逐字节不变）。数据 opt-in（dive-stalker.ts::weakStalkerStep）。
   */
  weakHunts?: boolean;
  /**
   * 弱猎手的专属遭遇池（作者 2026-06-10 拍「更小敌」·#110）：weakHunts 中奖时接触触发的战斗
   * 从这里选（幼体等「小且弱」专属遭遇）；缺省 → 回落 ambushEncounters（旧行为＝撞上成年体）。
   * 只在 weakHunts=true 的 zone 有意义。
   */
  weakHuntEncounters?: string[];
  /**
   * 感知门撒点规格（感知门 SPEC §6·取代 #262 的 `darkEligible:boolean`）：每 sense（灯/声呐）一组深度档密度 +
   * hidden/locked 配比，`sprinkleGates` 据此在候选节点（event/rest）确定性标 `node.gate`。**dormant**（所有 zone
   * 缺省不设 ⇒ 一个门都不撒·byte-identical·浅水/教学/reef 默认关）；激活＝给参与 zone 填 `gates`（内容 session）。
   * 浅水段(<DARK_MIN_DEPTH)即便配了也不撒（守「浅水绝对安全」）。见 `gateDensityForNode`。
   */
  gates?: ZoneGates;
}

/** 下潜地图（运行时生成） */
export interface DiveMap {
  zoneId: string;
  generatedAt: number;
  nodes: Record<string, DiveNode>;
  startNodeId: string;
  /** 教学关固定指向第一个事件；随机图指向第一层第一个节点 */
  /**
   * 渲染自描述（mapgen 生成时盖章·纯渲染·不入存档/不影响拓扑）：
   * 让 `deriveMapLayout` 与所有消费者（dev 面板/声呐图/猎手 blip）无需拿到 zone 就知道这张图该怎么铺。
   * 缺省（旧图/教学单节点）→ 渲染层兜底 vertical。
   */
  layoutStyle?: LayoutStyle;
  orientation?: 'vertical' | 'horizontal';
}

/** 节点 */
export interface DiveNode {
  id: string;
  layer: number;
  depth: number;
  zoneTag: ZoneTag;
  /** 节点类型 */
  kind: NodeKind;
  /**
   * 事件型节点的事件 id（运行时根据池子抽取）。
   * 「单 feature 房间」(声呐与房间 SPEC §6/§7 S1) 仍走这条：到房间即自动触发＝旧行为不变。
   * 多 feature 房间用下面的 `features`，此字段留空（moveToNode 据 features 路由到房间菜单而非自动触发）。
   */
  eventId?: string;
  /**
   * 多事件房间（声呐与房间 SPEC §6「房间可含多个事件点」· §7 S1）。设了即「大房间」：
   * 到达不自动触发，而是把房内**未探**的 feature ＋ 出口一起摆成选项（enterNodeSelection），
   * 玩家逐个凑近看、每探一处付氧（dive.ts::exploreFeature），选出口走人。
   * 缺省（绝大多数房间）→ 走 `eventId` 单事件 ＝ 旧行为（向后兼容，#19 单 tag / #44/#47 loot 隔离在事件数据侧成立）。
   * run 级探索进度记在 run.activeFlags（`feat:<nodeId>:<featureId>`），不入存档形状、不 bump SAVE_VERSION。
   */
  features?: NodeFeature[];
  /** corpse 节点指向的 DeathRecord.id */
  corpseRecordId?: string;
  /** 该节点能去往下一层的节点 ids */
  connectsTo: string[];
  /** 节点选择时的简短预览文本（灯下看到的"地面真相"；被门锁住时由 dive-select 在选点时改写·感知门 SPEC §2.3） */
  preview: string;
  /** UI 提示：附近可能有尸体 */
  hasCorpseHint?: boolean;
  // 节点级声呐欺骗钩子（曾喂假回波/无回波表象）：**感知重做已删**——声呐诚实（SPEC §2.2/§3）。
  /**
   * 该节点自带的门（感知门 SPEC §2.1·取代 #262 的 `dark:boolean`）：撒点 post-pass `sprinkleGates` 在配了
   * `zone.gates` 的区按深度密度确定性标记（sense=lamp/sonar·mode=hidden/locked）。
   *   - mode='hidden'：不满足对应感官时**不显示此选项**（dive-select 过滤掉·满足才现）——伏笔式岔口。
   *   - mode='locked'：**看得见但不能选**、标「需要灯/声呐」（沿用 #221 预告语义）。
   * 与 run 级整潜门（`run.diveModifier.gate`·live-combine）正交：per-node gate 优先，缺省则落整潜门
   * （见 dive-select.ts::effectiveGate）。地标（上浮口/气穴/扎营）+ Lv.1 尸体永不撒门＝骨架永远通。缺省 undefined＝普通节点。
   */
  gate?: NodeGate;
  /**
   * 多口持久洞（多口持久洞 SPEC §2.2）：该 ascent_point 是洞的哪类口。
   *  - 'entrance'：带 POI 的入口（可下潜起手 + 上浮）。
   *  - 'exit'：只能上浮的出口（非 POI·穿流泄流口/烟囱/塌口）。
   * 缺省（undefined）＝普通 ascent_point（单口洞的「洞另一头出口」/ 开阔海域末层上浮口）＝旧语义逐字节不变。
   * 用薄标注而非新 NodeKind：入口/出口在移动/上浮/可达性/声呐上与 ascent_point 全同，避免触动既有 kind 判据。
   */
  portalKind?: 'entrance' | 'exit';
}

/**
 * 房间内的一个「事件点」（声呐与房间 SPEC §6 S1）。一个多事件房间含 1..N 个 feature，
 * 玩家在房内逐个探索（每探付氧），各自触发自己的事件。
 */
export interface NodeFeature {
  /** 节点内唯一 id（f0/f1/f2）。run.activeFlags 用 `feat:<nodeId>:<id>` 记「已探」。 */
  id: string;
  /** 探索该 feature 触发的事件 id。 */
  eventId: string;
  /** 灯下/近处真相短标签（事件标题）——你就在房间里、灯照得到，故按 full 档真相显示。 */
  preview: string;
}

export type NodeKind =
  | 'event' // 普通事件
  | 'ascent_point' // 上浮口
  | 'rest' // 休息点（可消耗回合恢复体力）
  | 'air_pocket' // 气穴：上浮换气，恢复氧气（一次性，用过即枯）
  | 'camp' // 扎营点：消耗较多回合，恢复体力/理智（可重复，自带氧气代价）
  | 'corpse' // 尸体回收点
  | 'shop' // 水下黑市（后期）
  | 'boss'; // 区域 BOSS

// ============================================================
// 多口持久洞（方案 B · 多口持久洞 SPEC §2）—— 一个洞 = 一张冻结进存档的持久地图 + 多口绑定
// ============================================================

/** 门户口位的区域标签（多口持久洞 SPEC §2·按 depth 分桶派生）：浅缘 / 侧翼 / 深处。 */
export type CaveRegion = 'rim' | 'flank' | 'deep';

/** 一个门户口位——入口或出口（多口持久洞 SPEC §1/§2.1）。 */
export interface CavePortal {
  /** 对应 DiveMap.nodes 里的节点 id。 */
  nodeId: string;
  /** 'entrance' 可下潜起手 + 上浮；'exit' 仅上浮（非 POI·穿流口）。 */
  kind: 'entrance' | 'exit';
  /** 该口位的绝对深度（= 节点 depth·冗余存便于按深度选口/区域偏置）。 */
  depth: number;
  /** 口位区域（rim/flank/deep·区域偏置绑定用·生成时按 depth 分桶派生）。 */
  region: CaveRegion;
}

/**
 * 一个持久洞的存档记录（多口持久洞 SPEC §2.1·方案 B）。首次进洞生成并冻结于
 * `profile.caveMaps[caveId]`；再进（含换口进）从这里加载＝同一空间续上次。
 * 序列化：`saveReplacer/saveReviver` 的 __map 分支（value 内含 DiveMap 纯对象 + explored:Set
 * 自底向上 revive）——零新序列化代码（同 harvestedResources 先例）。改洞设计＝全局 bump 弃档（#99·无单洞迁移）。
 */
export interface PersistentCave {
  /** 稳定洞 id（= 生成 seed·= caveMaps key·= harvest 记账 key·命名空间 cave.<短名>）。 */
  caveId: string;
  /** 冻结的地图（首次进生成→冻结；运行时突变机制〔未来〕在此就地改写）。 */
  map: DiveMap;
  /** 曾被探明过的节点 id（跨 run 持久·驱动声呐图「已探片」预亮 + 海图认知）。 */
  explored: Set<string>;
  /** 生成时落定的入口/出口门户清单。绑定/渲染/守门读它，不必扫全图。 */
  portals: CavePortal[];
}

/**
 * 一个持久洞的生成参数（多口持久洞 SPEC §2.4·**数据驱动**·单一来源 data/caves.json·engine/caves.ts::getCave）。
 * 这组数据＝生成器的**全部**输入：「加大洞」改 sizeScale/depthRange；「这洞将来要挂很多口」调大 entrancePortals。
 * **没有任何口数/形状写死在 mapgen 代码里**——全是这张表（§5 可扩展硬要求落成机制·§7 守门）。
 */
export interface CaveGenParams {
  /** 稳定洞 id（= 生成 seed·= caveMaps key·命名空间 cave.<短名>）。 */
  caveId: string;
  /** 复用哪个 zone 的内容池/标签/敌人（事件抽取走 buildEventPool(zone)·内容仍是 zone 的）。 */
  zoneId: string;
  /** 绝对深度窗口 [浅, 深]（核心钉 d1·入口/出口散布其间·§3.3 模型 B）。 */
  depthRange: [number, number];
  /** 图规模（节点数派生·N≈2×sizeScale·沿用 maze layerCount 语义·#175）。 */
  sizeScale: number;
  /** 要预留的**入口门户**数（≥ 预期挂口数·留余量给「以后别处加口」·§3.2/§3.4）。 */
  entrancePortals: number;
  /** 要预留的**出口门户**数（≥1·从不死胡同·穿流口·§1）。 */
  exitPortals: number;
  /**
   * 入口门户的声明深度（可选·跨 beacon 洞用·如 [20,90]=reef 浅口 + vent 深口）。
   * 缺省 → 在 [d0, d0+0.55·span] 浅—中段自动均布。绑定时 POI 的 mouthDepth 反挑最近的入口门户（§2.3）。
   */
  entranceDepths?: number[];
  /** 出口门户的声明深度（可选）。缺省 → 在 [d0+0.35·span, ~d1) 中—深段自动均布。 */
  exitDepths?: number[];
  /** 深度密度剖面曲线 k 区间（沿用 #114 depthCurveRange·决定哪段深度节点多＝洞胖瘦·§3.3 模型 B）。 */
  depthCurveRange?: [number, number];
  /**
   * 穿越发现 flag（多口持久洞 SPEC §6.2·跨 beacon T3b）：设了 ⇒ 玩家**从本洞任一出口门户（portalKind:'exit'）
   * 上浮**时 engine（ascent.ts::executeAscent）置此 flag——揭示对侧口 POI（副口 anchor 的 requiresFlags 消费它·
   * 跨 beacon「一口入、对侧出」＝顺穿流·§1）。单一来源在此（caves.json）：副口 POI 的 requiresFlags 与此值
   * **同串**（check-cave-bindings 焊死漂移＝红）。缺省（单口/双口都直接可见的洞·如 cave.blue_caves）⇒ 不置任何穿越 flag。
   */
  traversalFlag?: string;
}
