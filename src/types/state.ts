// 游戏全局状态
// 与主 SPEC §3 四属性、§7 死亡与元进度对齐

import type { EquipmentSlot, DecoyKind } from './items';
import type { DiveMap, NodeKind, PersistentCave, GateSense } from './dive';
import type { CombatState } from './combat';
import type { ActiveInjury } from './injuries';
import type { PoiModifier } from './chart';
import type { Lighthouse } from './lighthouse';

/** 四属性 stat 名称（注意：氧气在战斗/事件中以"回合数"消耗） */
export type Stat = 'stamina' | 'oxygen' | 'sanity' | 'nitrogen';

/** 四属性即时数值 */
export interface Stats {
  stamina: number; // 0–staminaMax
  oxygen: number; // 0–oxygenMax（按"剩余回合数"计）
  sanity: number; // 0–100
  nitrogen: number; // 0–100
  /**
   * 热应力（温度系统·热/冷双极局部环境债·0–100·见 engine/temperature.ts）。
   * 只在热极/冷极洞累积（按 run.zoneId 查侧表·潜服 insulation 抵消）、离开即恢复；过 WARN 后扣体力。
   * 与 nitrogen 正交（氮气=深度/时间全局债·温度=按洞双极局部债）。**非事件可投递 stat**——环境驱动，
   * 故不进 `Stat` 联合（事件 stat-delta 枚举数组无需改）。形状变 → SAVE_VERSION 10→11（quirk #99·bump 弃旧档）。
   */
  thermalStress: number; // 0–100
}

/** 玩家档案（永久数据，跨次下潜保留） */
export interface PlayerProfile {
  name: string;
  bankedGold: number; // 港口银行存款
  unlockedUpgrades: Set<string>; // upgrade.id 集合
  flags: Set<string>; // 全局 flag（剧情触发器）
  loreEntries: Set<string>; // 已解锁的图鉴条目
  deaths: DeathRecord[]; // 历次死亡记录（驱动尸体回收）
  runsCompleted: number;
  /**
   * 世界天数（月相潮汐时间系统·SPEC `docs/spec/深海回响_月相潮汐_SPEC.md` §2.1）：潜一次 +1，
   * 起步＝runsCompleted；港口「等待」可单独推进（Phase 1）⇒ 与 runsCompleted 分离（两个时钟）。
   * additive·**optional**：旧档 / 未 hydrate（如 dev 面板建的裸 profile）缺它 → 读点走
   * `?? runsCompleted` 回退（守逐字节不变·不 bump SAVE·#99）。hydrateGameState 单点补 day=runsCompleted（#107）。
   */
  day?: number;
  /**
   * 港口仓库。run 结束回港时 run.inventory 合并到这里：eternal 物品天然长存，
   * 其它物品要么主动卖给 Mira 要么放着。dive 中的临时背包是 run.inventory，不要和这里搞混。
   */
  inventory: InventoryItem[];
  /**
   * Mira 店铺当前剩余备货（itemId → 剩余可买数量），仅低阶材料回购用（基建地图 SPEC §2.5）。
   * 软性 per-run 限量：每次回港 handleReturnToPort 清空（= 视作全部补满，靠 getShopStock 的懒默认——
   * 注意：条目缺失＝满货的懒默认语义保留在 getShopStock，与容器是否存在无关）。
   * 容器必填：createInitialProfile 种 {}，旧存档缺它由 hydrateGameState 单点补 {}（CHANGELOG #107）。
   */
  shopStock: Record<string, number>;
  /**
   * 灯塔基地（基建地图 SPEC §3，Phase B）。家＝第一座（lighthouse.home）。
   * 现有岸边港口重构成 home 灯塔；其它是前哨（修复废弃灯塔获得，Phase C）。
   * Phase B 仅是数据模型——灯塔的"点亮海域"（reveal/reach）由 Phase C 消费。
   */
  lighthouses: Lighthouse[];
  /**
   * 水下前哨的发现状态（深水区 Phase 2b·衰减删除 #125·中转/寄存删除 step ②③）：outpostId → { discovered? }。
   * - discovered = 该前哨是否已被发现（上图可见）。
   * 条目内字段全可选（懒默认＝未发现·语义留在 lighthouses.ts 读点），JSON 原生 round-trip。
   * 容器必填：createInitialProfile 种 {}，旧存档缺它由 hydrateGameState 单点补 {}（CHANGELOG #107）。
   * 发现门写 discovered。旧档残留 maintainedRun/storedRun/stored 字段无害·代码不再读；未发布·不写迁移（quirk #99）。
   */
  outpostState: Record<string, { discovered?: boolean }>;
  /**
   * 海图测绘扫描·**每哨站**已扫签名（区域揭示·作者 2026-06-14：解锁/潮汐只扫**受影响的灯塔**、非全图一起扫）。
   * key=灯塔 id，value=该灯塔上次扫到的「点亮 POI 集 + 有效半径」签名（SeaChartView 算）。当前签名 ≠ 记录 → 只扫该灯塔，
   * 动画播完写回。additive·JSON 原生 round-trip·不 bump SAVE_VERSION·旧档缺省 {} = 各灯塔第一次开图必扫。
   */
  outpostScanSig?: Record<string, string>;
  /**
   * 持久装备配置（玩家穿戴的 5 件·跨 run 保留·港口物品栏读此·Otto 升级写此·P3）。
   * 新 run 起手从这里 copy 进 RunState.equipment。
   * additive·缺省补 createStarterLoadout()·不 bump SAVE_VERSION（#99 纯加字段）。
   */
  equipment?: EquipmentLoadout;
  /**
   * 固定资源**永久耗尽**追踪（POI 固定资源耗尽 SPEC·2026-06-25）：poiId → 该 POI 已永久采尽的 itemId 集。
   * `harvestPersist:'save'` 的 loot 采到后（生还回港）合并进此处（handleReturnToPort·见 engine/port.ts）。
   * mapgen 据此把产出已采尽物品的资源点抹平成空节点（玩家不再看到）。run 级耗尽走 RunState.harvestedNodes。
   * 容器必填：createInitialProfile 种 new Map()，旧档缺它由 hydrateGameState 单点补（#107）。
   * 序列化由 saveReplacer/saveReviver 的 Map 分支处理（同 Set·见 state.ts）。
   */
  harvestedResources: Map<string, Set<string>>;
  /**
   * 持久洞地图（多口持久洞 SPEC §2.1·方案 B）：caveId → 该洞的冻结地图 + 持久探索态。
   * 首次进洞生成并冻结于此；再进（含换口进）从这里加载＝同一空间续上次（料/尸/已探）。
   * 容器必填：createInitialProfile 种 new Map()，旧档缺它由 hydrateGameState 单点补（同 harvestedResources·#107）。
   * 序列化由 saveReplacer/saveReviver 的 __map 分支处理（value 内含 DiveMap 纯对象 + explored:Set·自底向上 revive·零新代码）。
   * SAVE_VERSION 9→10：形状变·按 #99 不写迁移、bump 弃旧档从头开始。
   */
  caveMaps: Map<string, PersistentCave>;
  /**
   * 通用 NPC 信任系统（藏宝贸易与信任系统 SPEC §3·2026-06-30）：npcId → 信任原始数值（累加·「档」由
   * engine/trust.ts::trustTier 派生·不另存档）。触碰只经 engine/trust.ts（读写派生）+ state.ts（种子/水合）——
   * check-boundaries 规则七守。additive·**optional**（裸 profile / 旧档缺它 → 读点 trustValue 兜 0）·
   * JSON 原生 round-trip（Record·非 Set/Map·不碰 saveReplacer）·**不 bump SAVE_VERSION**（quirk #99）。
   * 将来阵营（§3.9）：另加 profile.factionRep 并存·别改此字段语义。
   */
  trust?: Record<string, number>;
  /**
   * 对话选项"新/已聊"分档（对话选项面板收窄·作者 2026-07-03 拍板）：记录选过的对话选项，key=
   * `${dialogNodeId}::${choiceId}`（choice.id 只在所属节点内唯一，须拼节点 id 才全局唯一）。
   * 唯一写口 engine/dialog.ts::selectChoice（选中即记录·幂等）；读点 selectDisplayChoices——
   * 没记录＝「新」（高优先级，优先占显示位）、有记录＝「已聊」（次优先级 + 面板灰显）。
   * additive·**optional**（裸 profile / 旧档缺它 → 读点兜空 Set）·Set 走 saveReplacer/saveReviver
   * 通用 __set 分支原生 round-trip（同 flags）·**不 bump SAVE_VERSION**（quirk #99）。
   */
  seenChoices?: Set<string>;
  /**
   * The Warren 追猎进度的**离港结转**（蜂群 boss SPEC §9.11「撤退/月相存档窗」）：`RunState.warrenHunt`
   * 是 run 级、`run: null` 时連 roomsCleared/queenNodeId 一起被丢弃——本字段是它跨越港口边界的唯一挂点。
   * `engine/port.ts::handleReturnToPort` 离港时把 `run.warrenHunt`（若存在）整个搬来这里、附带
   * `lastVisitDay`（离港那一刻的总天数·profile.day 口径）；`engine/dive-start.ts::startDive` 下次开潜时
   * 读它：`moonPhasesElapsed(lastVisitDay, 当前 day) ≤ 阈值` ⇒ 原样接回 `run.warrenHunt`（续追猎）；
   * `> 阈值` ⇒ 蜂巢重新聚拢，追猎从头开始（本字段清掉·run.warrenHunt 保持 undefined 让新战斗从零建）。
   * 真条件字段（quirk #106·absent＝从未有过 Warren 追猎结转，或已过窗被清）：createInitialProfile 不种、
   * hydrateGameState 不补（同 `trust?`/`stalker?`/`decoy?` 同族·纯对象 JSON 原生 round-trip）；
   * additive·不 bump SAVE_VERSION（#99）。
   */
  warrenHunt?: {
    roomsCleared: number;
    queenNodeId?: string;
    // `inHatchery` **已删**（作者 2026-07-08 三卵室重设计）：三间卵室都是 hatchery，此标记恒真无意义。
    // 「无处可退」改由 `roomsCleared >= WARREN_LAST_STAND_ROOMS` 派生（combat-warren.ts::isWarrenLastStand）。
    usedChambers?: string[];
    wallDown?: boolean;
    /** 每间卵室的存卵数（提前凿卵→她撤过去时库存更少·§15.1·蜂群 boss SPEC §8）。随 warrenHunt 一并 bank / 窗过期重置。 */
    eggs?: Record<string, number>;
    /** 离港那一刻的总天数（profile.day 口径）——下次开潜据此算跨过几个相位边界。 */
    lastVisitDay: number;
  };
}

/** 死亡记录，用于尸体回收 */
export interface DeathRecord {
  /** DeathRecord 自己的 id（用于节点引用） */
  id: string;
  /** 死亡时所在 run 的 id */
  runId: string;
  /** 程生姓名（D-reveal 用，达成条件后会替换） */
  diverName: string;
  depthAtDeath: number;
  zoneId: string;
  zoneTag: string;
  cause: string; // 死亡原因（窒息/失血/疯狂上浮/...）
  inventorySnapshot: InventoryItem[];
  goldAtDeath: number;
  /** 已被回收 = 所有物品都被拿走，**或**已超过 CORPSE_VISIBLE_AGE 天散失（两种「不再可回收」收口同一 flag·death.ts） */
  recovered: boolean;
  /**
   * 死亡当天的世界日（= 当时 profile.day）。尸体「年龄」是纯派生 age = profile.day − diedOnDay
   * （SPEC §2.2「腐烂挂天不挂次」）——不再存 diveAge，等潮的那几天尸体也在烂。死亡/上浮/港口等待都推进 day。
   * 形状变 → SAVE 11→12（state.ts·quirk #99 不写迁移）。
   */
  diedOnDay: number;
  timestamp: number;
}

/**
 * 微观感知预览档（感知重做后塌成灯门二态·SPEC §2.1）：
 *  - 'full'：灯下（或非黑水）诚实近场真相。
 *  - 'none'：黑处无有效灯——盲 / 锁住（沿用旧 visibility:dark 行为，quirk #27/#41）。
 *  - 'sonar'：**引擎不再产出**（声呐＝诚实远场侦察·不碰选点·SPEC §2.2）——成员留在类型里仅供 UI 样式/lane 3/4 引用。
 */
export type ClarityTier = 'full' | 'sonar' | 'none';

/**
 * 微观双传感器状态（深水区 Phase 0a）。灯＝近距真相 + 解锁信息、暴露(signature)高；
 * 声呐＝一记 ping 诚实远场侦察、暴露低、费电（感知重做 SPEC §2.2「ping 才扫、不 ping 不扫」）。
 * 关灯不 ping＝致盲但最隐蔽（主动感知是双向的）。
 * 声呐能力本身是后期解锁（sonarUnlocked，段2：收集材料后找 Otto 打造声呐件即解锁·hasSonarEquipped）——
 * 早期＝仅有灯，黑水区天然探索受限，玩家先经历"黑暗中无声呐"（作者 2026-06-02）。
 */
export interface SensorState {
  /** 探照灯开关。开＝灯有效时近距真相 + 解锁信息，但抬高 signature。默认开。 */
  light: boolean;
  /**
   * 本回合是否开过灯（#118·作者拍 2026-06-12「只要看清了这回合的选项，就按这回合开灯
   * 计算电量，和进回合前就开着一样」）：setLight(true) 置位，回合结算（tickTurns）按它
   * 补收灯电费后清掉——焊死「开灯瞄一眼再关」的零电费偷看缝。真条件字段：缺席＝本回合
   * 没开过灯（hydrate 不补·quirk #106 同族·additive 不 bump SAVE_VERSION）。
   */
  litThisTurn?: boolean;
  /**
   * 声呐模式（感知重做 SPEC §2.2「ping 才扫、不 ping 不扫」）：'ping'＝本回合发过一记 ping（诚实远场侦察·付电 + 暴露）；
   * 'off'＝没 ping（默认·不扫）。**移动后归 off（脉冲是瞬时的·不跨回合持续）**——旧「本回合开/关 + 预约下回合」双态状态机已删。
   * 一潜内一站至多一记 ping（1 scan/停留）；weakStalkerHasSignal / signature 据 'ping' 判「你这回合响不响」。
   */
  sonar: 'off' | 'ping';
  /** 声呐能力是否已解锁（升级派生，后期才有）。未解锁则 ping 不可用、黑水保持盲航。 */
  sonarUnlocked: boolean;
}

/**
 * 本次下潜的"有效传感器参数"（深水区 Phase 0 升级轨）。由港口升级派生、出海前由 createNewRun 一次性烤进 run，
 * 之后下潜内不再变（同 powerMax / sonarUnlocked 的快照模式）。clarity.ts 的纯函数读这里，缺省回退到文件顶常量
 * （故脚本构造的部分 run / 旧存档 缺此字段时行为＝未升级基线）。各值的下限/上限（地板）集中在 clarity.ts::deriveSensorTuning。
 */
export interface SensorTuning {
  /** 声呐 ping 单次耗电（默认 SONAR_PING_COST；升级下调，有地板）。 */
  pingCost: number;
  /** 灯每回合耗电的乘子（默认 1；升级下调＝更省电，有地板）。清水因子仍 0，只在黑/浊水生效。 */
  lampDrainMult: number;
  /** signature 减免（默认 0；升级上调＝更隐蔽，有上限＝点灯/ping 暴露永不归零，守"读真相必自曝"）。 */
  signatureReduction: number;
  /**
   * 声呐一记 ping 的有效跳数＝**规划纵深**（感知重做 SPEC §2.2「更远的声呐 = 预判未来的选项」）：一记 ping
   * 从当前节点无向 BFS 揭示这么多跳之外的节点（进 run.scanMemory·SonarScanPanel 画出来供规划）+ 同量程内的猎手听觉。
   * 默认 SONAR_SCAN_RANGE，升级上调（sonarScanRangeBonus·声呐主升级轴）、有上限 SONAR_SCAN_RANGE_MAX
   * （< 最深 + < 全洞——再升也扫不穿整洞、照不到最深处·守北极星）。sonar.ts::sonarScanRange(run) 读它；
   * 缺省（旧档/部分 run）→ 回退基线常量。
   */
  sonarScanRange: number;
  /**
   * 大房间（多事件房间）出现率加成（声呐与房间 §6/§8.3 续）。默认 0，升级上调、有上限 ROOM_FEATURE_CHANCE_MAX。
   * mapgen.rollExtraFeatures 读它抬大房间概率；**band 的 maxRoomFeatures 仍是房间最大 feature 数的天花板**
   * （升级只让大房间更常出现、不突破深 band 的尺寸上限）。缺省（旧档/部分 run）→ 回退 0＝mapgen 输出逐字节不变。
   */
  roomFeatureChanceBonus: number;
  /** 猎手规避 T1 吸声（猎手 SPEC §3）：规避声感猎手的概率贡献（默认 0，升级上调、有上限 STEALTH_BONUS_MAX）。stalker.ts::playerEvadesStalker 读它；缺省 0＝无规避·advanceStalker 逐字节不变。 */
  soundAbsorbBonus: number;
  /** 猎手规避 T2 主动迷彩（猎手 SPEC §3）：规避光感猎手的概率贡献（默认 0，有上限 STEALTH_BONUS_MAX）。双感猎手要 min(吸声,迷彩) 两者都有才甩得动。 */
  camoBonus: number;
}

/**
 * 猎手感官模态（猎手 SPEC §2.2）：它用什么感官锁定你 → 切断哪种信号源能甩它。
 *  - light：你点灯它锁定（关灯=切断）；sound：你 ping/发声它锁定（停 ping/摸黑=切断）；both：光声任一都锁定。
 */
export type SenseModality = 'light' | 'sound' | 'both';
/** 猎手状态（猎手 SPEC §2.3-2.4）：hunting=有你的信号在逼近 / searching=信号切断后按性格搜 / lost=跟丢（despawn）。 */
export type StalkerState = 'hunting' | 'searching' | 'lost';
/**
 * 信号切断后的性格（猎手 SPEC §2.3·两种机制 × lingerTurns 等待时长）：
 *   - wait：原地等 lingerTurns 回合再脱离。lingerTurns=0 ＝「掉头就走」、>0 ＝「过一段时间再走」（作者：1 就是 2 等 0 回合）。
 *   - seek_last：先去上次有信号的位置，到了再徘徊 lingerTurns 回合、试图找到你，再走。
 */
export type StalkerLostBehavior = 'wait' | 'seek_last';

/**
 * 一只在下潜内追猎你的「猎手」（猎手 SPEC Phase 1 spine）。把抽象的警觉（run.alert·#59）做成一个
 * **有位置、会逼近、按你用哪种感官显示不同保真度**的实体（灯＝知道在接近 / 声呐＝知道位置+距离·同一只猎手）。
 * **run 级·派生·不入 profile·不 bump SAVE_VERSION**（同 scanMemory；纯对象，JSON 自动 round-trip）。
 * 仅在 run.huntEnabled（DepthBand.hunts·深 band）时 engage；缺省 → 引擎走旧 alert→伏击瞬时路径（向后兼容）。
 */
export interface Stalker {
  /**
   * 真实当前位置的**锚节点**（每回合朝你逼近·你未必看得到——声呐才定位、且会过时）。
   * mid-edge（猎手 SPEC §5）：当 edgeTo 有值时 nodeId＝它正离开的「起点」节点，真实位置在 nodeId→edgeTo 边上的 edgeProg 处；
   * edgeTo 为空＝正处在 nodeId 节点上（贴节点）。扇区/距离/哈希仍用 nodeId 锚（粗粒度足够）。
   */
  nodeId: string;
  /** 正前往的相邻节点（mid-edge·猎手 SPEC §5）；undefined＝在 nodeId 节点上（非中段）。additive·不 bump SAVE_VERSION。 */
  edgeTo?: string;
  /** 沿 nodeId→edgeTo 已走的边分数 0–1（mid-edge）；undefined/0＝在 nodeId。渲染对 nodeId→edgeTo 线性插值。 */
  edgeProg?: number;
  /** 用什么感官找你（§2.2）。 */
  sensesBy: SenseModality;
  /** 信号切断后的性格（§2.3）：原地等 / 先去上次信号点再等。 */
  onLostSignal: StalkerLostBehavior;
  /** 脱离前要等的回合数（原地 wait 或抵达上次信号点后皆同此一个「等」时长）；0 ＝丢信号就走（「掉头就走」＝等 0 回合）。 */
  waitTurns: number;
  /** 当前状态（§2.3-2.4）。 */
  state: StalkerState;
  /** 接触时触发的伏击遭遇 id（复用该 zone 的 ambushEncounters·#59·不加新敌）。 */
  encounterId: string;
  /** 上次「有你的信号」时你所在节点（seek_last 往这里搜）。 */
  lastSignalNodeId: string;
  /** 信号切断已持续几回合（'seek_last' 走向上次信号点的总搜索硬上限·防够不到时无限追）。 */
  turnsSinceSignal: number;
  /** 已在「等候点」（原地 / 抵达的上次信号点）等了几回合；> waitTurns → 脱离。 */
  waitedTurns: number;
  /** 声呐上次扫到它的位置（§8.7「只在被扫到时更新」·渲染用这个＝会过时）；从没扫到 → undefined（你只「感觉」到它）。 */
  seenNodeId?: string;
  /** 上次被扫到时它所在边的 to 端（mid-edge 快照·§5/§8.7）；空＝那一刻它在 seenNodeId 节点上。渲染据此插值出「中段红点」。 */
  seenEdgeTo?: string;
  /** 上次被扫到时的 edgeProg（mid-edge 快照·配合 seenEdgeTo）。 */
  seenEdgeProg?: number;
  /** 上次被声呐扫到的 run.turn（余像渐隐用）。 */
  seenTurn?: number;
  /**
   * 大型生物（声呐与房间 §5 later「接触带大小」）：比玩家还大的深渊猎手（abyssal the_rising / apex 类·≥ STALKER_LARGE_DEPTH）
   * 在声呐图上读成**一大团**而非小点。spawn 时按深度派生·缺省（浅段猎手 / undefined）→ 普通小 blip（逐字节不变）。
   * **猎手 SPEC §5（钻狭缝）**：large 猎手钻不进「窄」节点（engine/sonar.ts::nodeIsNarrow·与声呐图房间大小同源）——
   * 寻路绕开窄节点、你躲进窄缝时它只能守在口外（见 patience/guardedTurns）。
   */
  large?: boolean;
  /**
   * 主动探测（猎手 SPEC §2.2/§2.3「后期会有能主动探测玩家的」）：信号切断后它不只被动等/搜——
   * searching 态每 STALKER_ACTIVE_PROBE_PERIOD 回合自己发一记探测，量程内（STALKER_ACTIVE_PROBE_HOPS 跳）
   * 且未被你的 T2 主动迷彩规避（§3）→ 重新咬上（摸黑对它不再万灵·要升级装备）。
   * per-encounter 数据标签（CombatEncounterDef.stalker.active）；缺省 undefined＝不会主动探测（逐字节不变）。
   */
  active?: boolean;
  /**
   * 执着度（猎手 SPEC §6「执着的等待者」）：你躲进它钻不进的窄缝（§5）而它**有你的信号**时，
   * 它守在口外最多这么多回合（guardedTurns 累计）；等够 → 放弃离开。缺省 → STALKER_PATIENCE。
   * per-encounter 标签（执着等待者给大值）。只管「有信号围守」；丢信号仍走 §2.3 wait/seek 计时。
   */
  patience?: number;
  /** 已在窄缝口外守了几回合（§6·配合 patience）；脱困/重新追起来即清零。缺省 0。 */
  guardedTurns?: number;
  /**
   * 个体速率（猎手 SPEC §7「速率分布」·边分数/回合）：缺省 → STALKER_HSPEED（0.8）。
   * Q3 浅水弱变体给更慢（纯逃跑甩得开＝「小且弱」）；per-encounter 标签可调快/慢。
   */
  hspeed?: number;
  /** Q3 浅水弱变体标记（§2.6「浅水小且弱」）：叙事/观感用（小东西）；缺省 undefined＝常规猎手。 */
  weak?: boolean;
  /**
   * 嗅觉系猎手（负伤 SPEC §6.1 scent 第三感官通道·spawn 时从 StalkerProfile.scent ?? 成员 EnemyDef.scent 派生）。
   * 玩家流血·重（modifiers.scentTrail）期间：光声切断/迷彩规避对它失效＝恒「有你的信号」（stalker.ts 旁路分支·
   * sensesBy 对抗矩阵不重写），守口 patience ×1.5（闻着血，等得起）。decoy 不受影响（仍 guaranteed·北极星）。
   * 缺省 undefined＝非嗅觉系（逐字节不变）。
   */
  scent?: boolean;
}

/**
 * 水里现存的一枚诱饵（猎手 SPEC §4）：投放在 nodeId、替你发声/发光到 expiresTurn（run.turn ≥ 此值＝失效）。
 * 一次至多一枚（再投覆盖）。感官匹配的猎手会被它引开（engine/stalker.ts::advanceStalker 的 decoy 分支）。
 * **真条件字段**（quirk #106）：缺席＝水里没有诱饵即语义——createNewRun 不种、hydrateGameState 不补；
 * 纯对象 JSON 自动 round-trip、不 bump SAVE_VERSION（同 run.stalker）。
 */
export interface DiveDecoy {
  /** 投放节点（投放那一刻你所在的节点）。 */
  nodeId: string;
  /** 声诱 / 光诱（骗哪种感官·按 ItemDef.decoy.kind 落）。 */
  kind: DecoyKind;
  /** 失效回合：投放时 run.turn + DECOY_TURNS；run.turn ≥ 此值＝哑了/熄了。 */
  expiresTurn: number;
}

/** 玩家在当次下潜中的资源、装备、背包 */
export interface RunState {
  runId: string;
  zoneId: string; // 所在海域
  /**
   * 本次下潜的 POI 身份串（POI 固定资源耗尽 SPEC·2026-06-25）：startDiveFromPoi/diveIntoBand 落 poi.id
   * （= 地图 seedKey·同图）。固定资源耗尽记账（harvestedNodes 写、harvestedResources 合并）皆按它做 key。
   * 缺省（教学/港口 zone/scenario 下潜·非 POI）→ undefined ⇒ harvest 记账整段 no-op（真条件字段·不种不补）。
   */
  poiId?: string;
  /**
   * 本次下潜所属持久洞 id（多口持久洞 SPEC §4.2）：caveEntry 路径下潜时落 caveId。
   * 出洞结算据它把 explored/harvest 写回正确的 caveMaps[caveId]（探/采记账 by caveId·资源空间是「洞」非「单口」）。
   * 缺省（非洞下潜·zone/band/教学）→ undefined ⇒ 走 poiId 记账旧路径（真条件字段·不种不补）。
   */
  caveId?: string;
  map: DiveMap | null; // 随机生成的节点图；教学线性脚本下潜为 null
  stats: Stats;
  staminaMax: number;
  oxygenMax: number; // 满气瓶可支撑的回合数
  equipment: EquipmentLoadout;
  inventory: InventoryItem[];
  carryWeightLimit: number; // 背包承载上限（kg）：拾取/装载按重量截断；装备负重(equipment.ts)是另一套，互不相干
  gold: number; // 本次下潜身上的金币（死亡会丢失）
  currentDepth: number; // 米
  currentNodeId: string | null;
  visitedNodeIds: string[];
  turn: number; // 已经过的回合数
  pendingDecompression: DecompressionDebt;
  activeFlags: Set<string>; // 本次下潜临时 flag
  triggeredEventIds: string[]; // 用于 oncePerRun / cooldown 判定
  /**
   * 微观双传感器状态（深水区 Phase 0a）。createNewRun 设默认（灯开 / 声呐 off / 声呐能力按升级派生）。
   * 未发布故不做存档迁移（作者 2026-06-03）；旧档缺字段由 hydrateGameState 反序列化单点补默认
   * （CHANGELOG #107·读取处不再 `?? 默认` 兜底），不 bump SAVE_VERSION。
   */
  sensors: SensorState;
  /** 电池储备（类比 oxygen 的 run 级储备）：灯/声呐耗电；归零 → 强制摸黑（致盲不直接死）。 */
  power: number;
  /** 电池总量（深水区 Phase 0 升级轨：POWER_MAX + powerMaxBonus；createNewRun 种、power 起手＝powerMax）。 */
  powerMax: number;
  /**
   * 本次下潜的有效传感器参数（深水区 Phase 0 升级轨：耗电/抗欺骗/隐蔽随港口升级成长）。
   * 由 createNewRun 从 getRunBonuses 一次性派生（deriveSensorTuning）；旧存档缺字段 → hydrateGameState
   * 反序列化单点补基线（deriveSensorTuning({})＝未升级），读取处直读。未发布不迁移、不 bump SAVE_VERSION。
   */
  sensorTuning: SensorTuning;
  /**
   * 被探测度 / 「警觉」（深水区 Phase 0b）：点灯/ping 在深水逐回合抬升、摸黑消退（见 clarity.ts::alertDelta）；
   * 越过 ALERT_THRESHOLD 时进节点 → 潜伏捕食者接近、触发遭遇（moveToNode）。浅水不积累（§7.5）。
   * 未发布故不做迁移（同 sensors/power）：createNewRun 种 0 + 旧档由 hydrateGameState 单点补 0。
   */
  alert: number;
  /**
   * 本次下潜所选 POI 的环境修正（来自海图）。depthOffset 已在 mapgen 生成时消化进各层深度；
   * current / visibility 暂存于此供未来 hook 读取（冲走 / 光照效果待实装）。可选 → 旧存档/脚本省略即无修正。
   */
  diveModifier?: PoiModifier;
  /**
   * 本次蛙跳下潜所在 band 的探测压力倍率（深水区 C）：diveIntoBand（经 startDiveFromPoi） 从 band.alertFactor 落到 run，
   * clarity.ts::alertDelta 乘进暴露增益＝更深 band 在深度因子饱和后仍「越深越凶」。
   * createNewRun 种 1（无加压）＝POI 下潜默认；旧档由 hydrateGameState 单点补 1。派生自 band，
   * 未发布不 bump SAVE_VERSION（JSON 自动 round-trip）。
   */
  bandAlertFactor: number;
  /**
   * 声呐探索图记忆（声呐与房间 SPEC §5「会过时的记忆」）：nodeId → 上次被 ping 扫到时的 run.turn。
   * 累积（每记 ping 把**量程内 BFS 揭示的所有节点**〔sonarScanRange 跳·规划纵深·感知重做 SPEC §2.2〕stamp 成当前 turn）；
   * UI 据 (turn − stamp) 渐隐余像 + 据此把这些「几跳之外」的节点画出来供规划。run 级、不入存档、
   * 不 bump SAVE_VERSION——createNewRun 种 {} + 旧档由 hydrateGameState 单点补 {}（同 shopStock/outpostState）。
   */
  scanMemory: Record<string, number>;
  // 本次下潜的不可信声呐失真强度（曾派生自 band·抬高低 san 假回波阈值）：**感知重做已删**（声呐诚实·SPEC §2.2/§3）。
  /**
   * 本次下潜是否启用「猎手」（猎手 SPEC Phase 1·§2.6 范围门控）：diveIntoBand（经 startDiveFromPoi） 从 DepthBand.hunts 落到 run。
   * 真 → moveToNode 走有位置的逼近猎手（出现→逼近→接触触发现有伏击）；假（createNewRun 种 false＝
   * POI 下潜/浅水默认·旧档由 hydrateGameState 单点补 false）→ 走旧 alert→maybeApproachEncounter 瞬时
   * 伏击（逐字节不变·守 playthrough-stealth）。派生自 band，不 bump SAVE_VERSION。
   */
  huntEnabled: boolean;
  /**
   * 教学首潜「强制下行」锁（教学关 node 化·#221+·SPEC docs/spec/深海回响_教学关node化_SPEC.md）：
   * true ⇒ `isAscentBlocked` 整潜恒挡（先于 zone.canFreeAscend）+ UI 藏「此处上浮 / 从此上浮」钮 ⇒ 玩家只能沿单向图前进、靠 forceAscend 事件退出。
   * run 级·真条件字段（不种不补·absent＝不锁）·不 bump SAVE。仅 `dive-start.ts` 教学 node 化分支置 true；重访/普通潜不置（east_reef 重访仍 free-ascend）。
   */
  ascentLocked?: boolean;
  /**
   * 当前追猎你的猎手（猎手 SPEC Phase 1）。run 级·派生·不入 profile·`?? undefined` 兜底·不 bump SAVE_VERSION。
   * 仅 huntEnabled 时由 engine/stalker.ts 生成/推进；纯对象（无 Set）→ JSON 自动 round-trip。
   */
  stalker?: Stalker;
  /**
   * 水里现存的诱饵（猎手 SPEC §4·deployDecoy 写、advanceStalker 读、过期由 stalkerStep 顺手清）。
   * 真条件字段：缺席＝没有诱饵（quirk #106·不种不补·不 bump SAVE_VERSION）。
   */
  decoy?: DiveDecoy;
  /**
   * 身上的负伤（负伤 SPEC §3·run 级身体债·同时最多 3 处）。回港随 run 销毁＝全愈（SPEC §8）。
   * 纯加字段不 bump SAVE_VERSION：createNewRun 种 []、旧档由 hydrateGameState 单点补 []（quirk #99/#106）。
   * **写入只许 engine/injuries.ts 三入口（add/worsen/heal），读取只许 engine/modifiers.ts 折算**
   * （UI 渲染徽章直读不限）——check-boundaries 规则四强制。
   */
  injuries: ActiveInjury[];
  /**
   * 固定资源**run 级耗尽**追踪（POI 固定资源耗尽 SPEC·2026-06-25）：poiId → 本 run 已采过的 nodeId 集。
   * applyOutcome 在 loot 落包成功时把 currentNodeId 写进来（任意 harvestPersist 的 loot 都算「采过这个点」）。
   * mapgen 据此把本 run 已采的资源点抹平成空节点；run 结束即弃 ⇒「下次重进刷新」（新 run 种空 Map）。
   * 容器必填：createNewRun 种 new Map()，旧档缺它由 hydrateGameState 单点补（#107）。Map 序列化见 saveReplacer。
   */
  harvestedNodes: Map<string, Set<string>>;
  /**
   * 本 run 已采、待**永久**入账的 `harvestPersist:'save'` 物品 id 集（POI 固定资源耗尽 SPEC·2026-06-25）。
   * 暂存于 run（poiId 即 run.poiId·单 POI 一个 Set 够用）；生还回港由 handleReturnToPort 合并进
   * profile.harvestedResources[run.poiId] 后随 run 销毁——**死亡则不入账**（资源留给下次·与 acquireIntoProfile
   * 同走「生还才落袋」语义）。真条件字段（quirk #106）：无 save 级采集即缺席·createNewRun 不种·hydrate 不补。
   */
  harvestedSaveItems?: Set<string>;
  /**
   * The Warren 追猎态（蜂群 boss SPEC §9.11·map-level hybrid 追猎循环）：跨房间进度。
   * roomsCleared＝已把女王「撤」走的次数（撤一次 +1·`>=WARREN_LAST_STAND_ROOMS` 即背水一战）；
   * queenNodeId＝女王当前所在的**卵室节点**（三间之一·追猎搜寻的唯一真相·密度热度场的源点）。
   * `inHatchery` **已删**（三卵室重设计·2026-07-08）：三间都是 hatchery，恒真无意义。
   * **唯一写者＝engine 战斗收束（finalizeSwarmRelocate）+ 追猎推进**（UI 只读）。
   * 真条件字段（quirk #106·absent＝不在 Warren 追猎中）：createNewRun 不种、hydrateGameState 不补；
   * 纯对象 JSON 自动 round-trip、不 bump SAVE_VERSION（#99）。读取处 `run.warrenHunt?.roomsCleared ?? 0` 兜底。
   * 撤退/月相存档窗（§9.11·按总天数 bank）的结转挂点在 `PlayerProfile.warrenHunt`（离港时 bank·见那里的
   * `lastVisitDay`）——本 run 级字段只在潜水中累积 roomsCleared，跨港口边界靠 profile 那份镜像、run 内不带 lastVisitDay。
   */
  warrenHunt?: {
    roomsCleared: number;
    queenNodeId?: string;
    /** 她用过的卵室（每间只用一次：起始 + 两次撤退＝三间用尽＝背水一战）——撤退候选＝三间减去这些。 */
    usedChambers?: string[];
    /** 她当前那间卵室门口的封口墙是否已被打穿（每次 relocate 重置＝新一道墙·SPEC §5）。 */
    wallDown?: boolean;
    /** 每间卵室的存卵数（提前凿卵→她撤过去时库存更少·§15.1）。ensureQueenPlaced 初始化·advanceQueenRelocation 清旧那间。 */
    eggs?: Record<string, number>;
  };
}

/** 装备配置（9 槽纸娃娃·作者 2026-06-19·见 types/items.ts EquipmentSlot 注释） */
export interface EquipmentLoadout {
  tank: EquipmentInstance | null;
  suit: EquipmentInstance | null;
  light: EquipmentInstance | null;
  sonar: EquipmentInstance | null; // 声呐（独立槽·新增 2026-06-19·段2 接传感器线）
  tool: EquipmentInstance | null; // 武器·主（近战·潜水刀·历史 key 名）
  ranged: EquipmentInstance | null; // 武器·副（双持占主+副两格·单手只占主）
  charm: EquipmentInstance | null; // 饰品 1
  charm2: EquipmentInstance | null; // 饰品 2（升级「饰品槽」解锁）
  charm3: EquipmentInstance | null; // 饰品 3（升级「饰品槽」解锁）
}

/** 装备实例（带等级，未来可加词缀） */
export interface EquipmentInstance {
  itemId: string;
  slot: EquipmentSlot;
  level: number;
  affixes?: string[]; // 词缀 id（M5+）
  /**
   * 装入的改装组件 itemId（武器改装槽·作者 2026-06-20）：仅当该件 equipment.modSlot===true 时有意义。
   * 命中后 combat 读它按 id 分支应用效果（见 engine/combat.ts）。装/换由 engine/equipment.ts::installMod
   * 单点写（消耗组件·旧 mod 不返还）。additive·缺省 undefined＝无改装·JSON 原生 round-trip·不 bump SAVE_VERSION（#99）。
   */
  mod?: string;
}

/** 背包物品 */
export interface InventoryItem {
  itemId: string;
  qty: number;
}

/** 减压债 —— 玩家累计欠下的减压停留 */
export interface DecompressionDebt {
  requiredStops: number; // 当前需要的减压停留次数
  bendsRisk: 0 | 1 | 2 | 3 | 4; // I/II/III/IV 型减压病预警
}

/** 顶层游戏状态机 phase */
export type GamePhase =
  | { kind: 'port' }
  | { kind: 'portEvent'; eventId: string } // 港口侧 cutscene（带回剧情物自动触发）
  | { kind: 'chart' } // 港口海图选点（出海前选 POI）
  | { kind: 'shop'; shopId: string } // 港口商店（目前只有 Mira）
  | { kind: 'dive'; subPhase: DiveSubPhase }
  | { kind: 'combat'; combat: CombatState }
  | { kind: 'ascent'; targetDepth: number; returnTo?: DiveSubPhase; duress?: boolean } // returnTo：主动上浮（beginAscentFromDive）记下的来处子阶段·给上浮界面「取消」回退点；forced 上浮（事件/战斗应急/走到死路自动）不带 → 不可取消。duress：弃战逃上浮（战斗→上浮·正被咬着）→ resolveAscent 否决干净上浮（上浮系统 SPEC §5）
  | { kind: 'resolution'; outcome: RunOutcome }
  | { kind: 'funeral'; record: DeathRecord }
  | { kind: 'gameOver'; reason: string };

export type DiveSubPhase =
  | { kind: 'event'; eventId: string }
  | { kind: 'nodeSelect'; choices: NodeChoice[]; features?: FeatureChoice[] }
  | { kind: 'rest' }
  | { kind: 'corpse'; deathRecordId: string }
  /**
   * 高等级遭遇前序叙事停顿（boss 设计蓝图 2026-06-21）：encounterId 标记了 showIntro:true + introText 时，
   * enterCombat 先落这里让玩家读完文案、点确认再进战斗。
   * 仅事件触发的 combat（EventView）走这条；猎手伏击不经此门（已有即时叙事行）。
   */
  | { kind: 'pre_combat'; encounterId: string; introText: string };

/** 下潜节点（运行时） */
export interface NodeChoice {
  nodeId: string;
  depth: number;
  zoneTag: string;
  preview: string; // "你看到..." 简短描述
  hasCorpseHint?: boolean;
  isAscentPoint?: boolean;
  /** 节点类型（供选点界面把 air_pocket / camp 等地标渲染成可见标签；盲航时地标仍显示） */
  kind?: NodeKind;
  /** 迷路图：该节点此前是否已到访过（回头/绕回时给"已来过"提示，盲航时也显示） */
  visited?: boolean;
  /**
   * 该选项预览的感知档（感知重做后塌成门二态·感知门 SPEC §2.3）：'full' 灯下诚实真相 / 'none' 盲（门锁住）。
   * 'sonar' 档不再由引擎产出（声呐＝诚实远场侦察·不碰选点）；该成员仍在 ClarityTier 类型里供样式引用。
   * enterNodeSelection 计算并把对应 preview 文案烤进本结构（引擎侧门控，便于回归断言）；UI 据此渲染样式。
   */
  clarity?: ClarityTier;
  /**
   * 门锁住（可见但不能选·感知门 SPEC §2.3）：图上/选项里照画但点不了、按 gateSense 标「需要灯/需要声呐」。
   * enterNodeSelection 置位（dive-select.ts::effectiveGate/gateUnlocked·per-node gate 优先·缺省落整潜门）；
   * 满足对应感官（开灯 / 扫一记声呐）→ 解锁。渲染层（NodeSelectView）据此出禁用态 + handlePick 拦截。
   */
  locked?: boolean;
  /**
   * locked 时是哪种感官的门（感知门 SPEC §2.3）：'lamp'→提示「需要灯」/ 'sonar'→「需要声呐」。
   * 仅 locked 时置；渲染层据此选禁用态提示文案。
   */
  gateSense?: GateSense;
}

/**
 * 多事件房间里的一个可探索「事件点」（声呐与房间 SPEC §6 S1）。enterNodeSelection 在 nodeSelect 阶段
 * 把**当前房间**未探的 feature 摆进 subPhase.features（与去往别处的 choices 并列）；UI 渲染成「凑近看」一组，
 * 点选触发 dive.ts::exploreFeature（付氧 + 触发其事件）。你就在房间里、灯照得到 → preview 取 full 档真相。
 */
export interface FeatureChoice {
  /** 对应 DiveNode.features[].id（节点内唯一）。 */
  featureId: string;
  /** 探索触发的事件 id。 */
  eventId: string;
  /** 灯下真相短标签（事件标题）。 */
  preview: string;
  /** 感知档（房内＝近处·恒 'full' 诚实真相；感知重做后无低 san 改写）。 */
  clarity?: ClarityTier;
}

/** 下潜结算结果 */
export interface RunOutcome {
  survived: boolean;
  maxDepthReached: number;
  /** 上岸时即时入袋的金币（事件给的 goldDelta + run.gold）。 */
  goldEarned: number;
  /** 战利品的"潜在变卖价值"——按 Mira 的收购价估的，需要回港找她兑现。0 = 没东西可卖。 */
  lootValue: number;
  loot: InventoryItem[];
  newLoreEntries: string[];
  cause?: string;
}

/** 总游戏状态 */
export interface GameState {
  version: number; // 存档版本号
  profile: PlayerProfile;
  run: RunState | null; // 不在下潜时为 null
  phase: GamePhase;
  log: LogEntry[]; // 文本叙事日志
  // 获得物品提示队列（玩家感知·2026-06-25）：每次「真正捡到东西」的动作（战利品/事件发物/建造发物）入一格，
  // 一格＝一次动作里所有物品（批量·不每件一弹）。**transient·不从存档恢复**（hydrateGameState 强制清空）——
  // reload 不该重弹；纯加字段不 bump SAVE_VERSION（quirk #99）。UI 侧 PickupModal 阻塞弹窗逐格出队。
  // 不接「回港入库结算」（结算屏已汇总）与「商店购买」（Mira 已有 flash）——见动作侧注释。
  pendingPickups: PickupBox[];
}

/** 一次获得动作的物品提示（批量一格·见 GameState.pendingPickups）。 */
export interface PickupBox {
  id: string;
  items: InventoryItem[]; // 本次动作获得的所有物品（{itemId, qty}）
  source?: string; // 来源标签（如 '战利品' / '事件' / '建造'）——纯展示
}

export interface LogEntry {
  id: string;
  turn: number; // 0 = 港口；下潜中 = run.turn
  tone: 'realistic' | 'uncanny' | 'cosmic' | 'system';
  text: string;
}
