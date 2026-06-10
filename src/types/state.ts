// 游戏全局状态
// 与主 SPEC §3 四属性、§7 死亡与元进度对齐

import type { EquipmentSlot } from './items';
import type { DiveMap, NodeKind } from './dive';
import type { CombatState } from './combat';
import type { PoiModifier } from './chart';
import type { Lighthouse } from './lighthouse';
import type { MaterialCost } from './upgrades';

/** 四属性 stat 名称（注意：氧气在战斗/事件中以"回合数"消耗） */
export type Stat = 'stamina' | 'oxygen' | 'sanity' | 'nitrogen';

/** 四属性即时数值 */
export interface Stats {
  stamina: number; // 0–staminaMax
  oxygen: number; // 0–oxygenMax（按"剩余回合数"计）
  sanity: number; // 0–100
  nitrogen: number; // 0–100
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
   * 水下前哨的维护 + 寄存状态（深水区 Phase 2b / 2b 续）：outpostId → { maintainedRun, stored?, storedRun? }。
   * - maintainedRun = 上次建造/维护时的 runsCompleted；结构衰减 = (runsCompleted − maintainedRun) × 速率（水流前哨更快）。
   * - stored = 寄存在该前哨「材料中转站」里的材料（Phase 2b 续：深水前哨可寄存材料、维护就近取用并免 ferry 金费）。
   * - storedRun = 上次「打理寄存」（存/取/维护）时的 runsCompleted；寄存损耗 = (runsCompleted − storedRun) × 速率独立计
   *   （与 maintainedRun 解耦——建造一阶重置结构衰减但不一定补寄存；维护两者都重置）。
   * 条目内字段可选（懒默认＝刚维护、空寄存、零损耗·语义留在 outposts.ts 读点），JSON 原生 round-trip，
   * 无需迁移、不 bump SAVE_VERSION（同 shopStock 套路；作者 2026-06-04 未发布不迁移）。
   * 容器必填：createInitialProfile 种 {}，旧存档缺它由 hydrateGameState 单点补 {}（CHANGELOG #107）。
   * advanceOutpost / maintainOutpost / depositToDepot / withdrawFromDepot 写它。
   */
  outpostState: Record<string, { maintainedRun: number; stored?: MaterialCost[]; storedRun?: number }>;
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
  /** 已被回收 = 所有物品都被拿走 */
  recovered: boolean;
  /** 距离死亡经过的 run 数（用于衰减） */
  diveAge: number;
  timestamp: number;
}

/**
 * 微观感知预览档（深水区 Phase 0a，SPEC §3.1/§3.2）：
 *  - 'full'：灯有效——相邻节点的"地面真相"（细节高、能读 tell）。
 *  - 'sonar'：关灯但声呐 ping——远端"不可信的返回"（≠ 真内容，可被躲 / 骗 / 低 san 幻觉改写）。
 *  - 'none'：摸黑——无预览、盲航（沿用旧 visibility:dark 行为，quirk #27/#41）。
 */
export type ClarityTier = 'full' | 'sonar' | 'none';

/**
 * 定向 ping 的聚焦方向（声呐与房间 SPEC §5「定向 ping」）：按节点 layer 差分的三向扇区——
 * 朝深处（layer 更大·声呐图右侧）/ 朝来路（layer 更小·上浮口一侧）/ 侧向（同层旁支）。
 * undefined ＝全向 ping（旧行为）。作者 2026-06-06 拍板「方向扇区」（其口述「朝深处/侧向/朝来路」即此三向）。
 */
export type SonarDir = 'deeper' | 'lateral' | 'back';

/**
 * 微观双传感器状态（深水区 Phase 0a）。灯＝近距真相 + 解锁信息、暴露(signature)高；
 * 声呐＝远距不可信回波、暴露低、费电。关灯关声呐＝致盲但最隐蔽（主动感知是双向的）。
 * 声呐能力本身是后期解锁（sonarUnlocked，门控在深料升级 upgrade.sonar.lv1）——
 * 早期＝仅有灯，黑水区天然探索受限，玩家先经历"黑暗中无声呐"（作者 2026-06-02）。
 */
export interface SensorState {
  /** 探照灯开关。开＝灯有效时近距真相 + 解锁信息，但抬高 signature。默认开。 */
  light: boolean;
  /** 声呐模式。'ping'＝本次选点扫一发（耗电、回波不可信）；'off'＝不扫。默认 off。移动后归 off（脉冲是瞬时的）。 */
  sonar: 'off' | 'ping';
  /** 声呐能力是否已解锁（升级派生，后期才有）。未解锁则 ping 不可用、黑水保持盲航。 */
  sonarUnlocked: boolean;
  /**
   * 上一记 ping 的聚焦方向（定向 ping·SPEC §5）；undefined＝全向。仅供声呐图标注「这一记朝哪打」，
   * 不影响存档形状（run 级·随 sonar 一道移动后清掉）。
   */
  sonarDir?: SonarDir;
  /**
   * 声呐持续开/关——**本回合已承诺的状态**（声呐渲染重做 SPEC §4「开/关窗口规则」）。缺省（undefined）→ 视为开（缺省开）。
   * 开＝本回合处于暴露/发射态（sonarActive 计暴露·到站自动扫一记 scan-on-open）；关＝不自动扫、只看保留的旧图。
   * 「本回合开/关是上回合定的」：移动时由 sonarNext 提交进来（applyTransit）。**仅 sonarUnlocked 才落字段**＝未解锁逐字节不变。additive·不 bump SAVE_VERSION。
   */
  sonarOn?: boolean;
  /**
   * 声呐**下回合**的预承诺（SPEC §4「玩家的控制点＝决定下一回合是否关」）。缺省 → 跟随 sonarOn。
   * 切换开关只改这里（本回合不变·预先承诺）；移动时 sonarNext→sonarOn 落定。本回合仍可主动扫一记反悔（pingSonar·扫了就算本回合开·付暴露）。
   */
  sonarNext?: boolean;
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
  /** 声呐注入假回波的 san 阈值（默认 SONAR_FALSE_ECHO_SANITY；升级下调＝更抗欺骗，但留地板＝永不全可信）。 */
  sonarFalseEchoSanity: number;
  /** 灯产生幻觉的 san 阈值（默认 LAMP_HALLUCINATION_SANITY；升级下调＝灯更晚崩，但留地板＝灯也终会崩）。 */
  lampHallucinationSanity: number;
  /** signature 减免（默认 0；升级上调＝更隐蔽，有上限＝点灯/ping 暴露永不归零，守"读真相必自曝"）。 */
  signatureReduction: number;
  /** 灯给真相的最大深度差 m（默认 LAMP_DEPTH_REACH；升级上调＝灯探得更深，有上限＝再陡的坑仍照不穿）。节点级 clarity·范围/分辨。 */
  lampDepthReach: number;
  /** 声呐够到的最大深度差 m（默认 SONAR_DEPTH_REACH，> 灯；升级上调，有上限）。 */
  sonarDepthReach: number;
  /**
   * 声呐探索扫描的有效跳数（声呐与房间 SPEC §8.1：范围是声呐主升级轴）。默认 SONAR_SCAN_RANGE，
   * 升级上调、有上限 SONAR_SCAN_RANGE_MAX（< 最深 + < 全洞——再升也扫不穿整洞、照不到最深处）。
   * sonar.ts::sonarScanRange(run) 读它；缺省（旧档/部分 run）→ 回退基线常量。
   */
  sonarScanRange: number;
  /**
   * 定向 ping 各扇区「reach 各自升级」的额外焦距（声呐与房间 §5「各方向 reach 各自升级」·#86 续）。
   * 逐向独立（deeper/lateral/back 各一档·缺省全 0），每向夹到 [0, SONAR_DIR_REACH_MAX]——你能专精某一向比基线焦距再多探几跳，
   * 但守北极星「再聚焦也扫不穿整洞」（别向仍短）。sonar.ts::sonarDirReach(run,dir) 读它；缺省（旧档/部分 run）→ 全 0＝定向行为逐字节不变。
   */
  sonarDirReach: Record<SonarDir, number>;
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
 * **run 级·派生·不入 profile·不 bump SAVE_VERSION**（同 scanMemory/sonarDeception；纯对象，JSON 自动 round-trip）。
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
   */
  large?: boolean;
}

/** 玩家在当次下潜中的资源、装备、背包 */
export interface RunState {
  runId: string;
  zoneId: string; // 所在海域
  map: DiveMap | null; // 随机生成的节点图；教学线性脚本下潜为 null
  stats: Stats;
  staminaMax: number;
  oxygenMax: number; // 满气瓶可支撑的回合数
  equipment: EquipmentLoadout;
  inventory: InventoryItem[];
  inventoryCapacity: number; // 格子上限
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
   * 本次蛙跳下潜所在 band 的探测压力倍率（深水区 C）：startDiveFromOutpost 从 band.alertFactor 落到 run，
   * clarity.ts::alertDelta 乘进暴露增益＝更深 band 在深度因子饱和后仍「越深越凶」。
   * createNewRun 种 1（无加压）＝POI 下潜默认；旧档由 hydrateGameState 单点补 1。派生自 band，
   * 未发布不 bump SAVE_VERSION（JSON 自动 round-trip）。
   */
  bandAlertFactor: number;
  /**
   * 声呐探索图记忆（声呐与房间 SPEC §5「会过时的记忆」）：nodeId → 上次被 ping 扫到时的 run.turn。
   * 累积（每次 ping 把扫到的节点 stamp 成当前 turn）；UI 据 (turn − stamp) 渐隐余像。run 级、不入存档、
   * 不 bump SAVE_VERSION——createNewRun 种 {} + 旧档由 hydrateGameState 单点补 {}（同 shopStock/outpostState）。
   */
  scanMemory: Record<string, number>;
  /**
   * 本次蛙跳下潜所在 band 的不可信声呐失真强度（声呐与房间 SPEC §5/§7 S2）：startDiveFromOutpost 从
   * band.sonarDeception 落到 run，clarity.ts::effectiveFalseEchoSanity 据此抬高低 san 假回波/伪接触/读数乱码阈值
   * （深 band 更易骗，subhadal 回落＝『把戏都停了』）。createNewRun 种 0（声呐相对老实）＝POI 下潜 / 浅水默认；
   * 旧档由 hydrateGameState 单点补 0。派生自 band，未发布不 bump SAVE_VERSION（JSON 自动 round-trip）。
   */
  sonarDeception: number;
  /**
   * 本次下潜是否启用「猎手」（猎手 SPEC Phase 1·§2.6 范围门控）：startDiveFromOutpost 从 DepthBand.hunts 落到 run。
   * 真 → moveToNode 走有位置的逼近猎手（出现→逼近→接触触发现有伏击）；假（createNewRun 种 false＝
   * POI 下潜/浅水默认·旧档由 hydrateGameState 单点补 false）→ 走旧 alert→maybeApproachEncounter 瞬时
   * 伏击（逐字节不变·守 playthrough-stealth）。派生自 band，不 bump SAVE_VERSION。
   */
  huntEnabled: boolean;
  /**
   * 当前追猎你的猎手（猎手 SPEC Phase 1）。run 级·派生·不入 profile·`?? undefined` 兜底·不 bump SAVE_VERSION。
   * 仅 huntEnabled 时由 engine/stalker.ts 生成/推进；纯对象（无 Set）→ JSON 自动 round-trip。
   */
  stalker?: Stalker;
}

/** 装备配置 */
export interface EquipmentLoadout {
  tank: EquipmentInstance | null;
  suit: EquipmentInstance | null;
  light: EquipmentInstance | null;
  tool: EquipmentInstance | null;
  charm: EquipmentInstance | null;
}

/** 装备实例（带等级，未来可加词缀） */
export interface EquipmentInstance {
  itemId: string;
  slot: EquipmentSlot;
  level: number;
  affixes?: string[]; // 词缀 id（M5+）
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
  | { kind: 'ascent'; targetDepth: number }
  | { kind: 'resolution'; outcome: RunOutcome }
  | { kind: 'funeral'; record: DeathRecord }
  | { kind: 'gameOver'; reason: string };

export type DiveSubPhase =
  | { kind: 'event'; eventId: string }
  | { kind: 'nodeSelect'; choices: NodeChoice[]; features?: FeatureChoice[] }
  | { kind: 'rest' }
  | { kind: 'corpse'; deathRecordId: string };

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
   * 该选项预览的感知档（深水区 Phase 0a）：'full' 灯下真相 / 'sonar' 声呐不可信表象 / 'none' 盲。
   * enterNodeSelection 计算并把对应 preview 文案烤进本结构（引擎侧门控，便于回归断言）；UI 据此渲染样式。
   */
  clarity?: ClarityTier;
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
  /** 感知档（房内＝近处，通常 full；低 san 幻觉仍可由引擎改写）。 */
  clarity?: ClarityTier;
}

/** 下潜结算结果 */
export interface RunOutcome {
  survived: boolean;
  maxDepthReached: number;
  eventsTriggered: number;
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
}

export interface LogEntry {
  id: string;
  turn: number; // 0 = 港口；下潜中 = run.turn
  tone: 'realistic' | 'uncanny' | 'cosmic' | 'system';
  text: string;
}
