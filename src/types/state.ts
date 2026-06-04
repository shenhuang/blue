// 游戏全局状态
// 与主 SPEC §3 四属性、§7 死亡与元进度对齐

import type { EquipmentSlot } from './items';
import type { DiveMap, NodeKind } from './dive';
import type { CombatState } from './combat';
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
   * 软性 per-run 限量：每次回港 handleReturnToPort 清空（= 视作全部补满，靠 getShopStock 的懒默认）。
   * 可选 + 普通对象 → 旧存档缺它无妨（懒默认满货），JSON 原生 round-trip，无需额外迁移。
   */
  shopStock?: Record<string, number>;
  /**
   * 灯塔基地（基建地图 SPEC §3，Phase B）。家＝第一座（lighthouse.home）。
   * 现有岸边港口重构成 home 灯塔；其它是前哨（修复废弃灯塔获得，Phase C）。
   * Phase B 仅是数据模型——灯塔的"点亮海域"（reveal/reach）由 Phase C 消费。
   */
  lighthouses: Lighthouse[];
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
   * 未发布故不做存档迁移（作者 2026-06-03）；反序列化读取处用 `?? 默认` 兜底，不 bump SAVE_VERSION。
   */
  sensors: SensorState;
  /** 电池储备（类比 oxygen 的 run 级储备）：灯/声呐耗电；归零 → 强制摸黑（致盲不直接死）。 */
  power: number;
  /** 电池总量（深水区 Phase 0 升级轨：POWER_MAX + powerMaxBonus；createNewRun 种、power 起手＝powerMax）。 */
  powerMax: number;
  /**
   * 本次下潜的有效传感器参数（深水区 Phase 0 升级轨：耗电/抗欺骗/隐蔽随港口升级成长）。
   * 由 createNewRun 从 getRunBonuses 一次性派生（deriveSensorTuning）；缺省（旧存档/部分 run）→ clarity.ts 回退基线常量。
   * 未发布故不做迁移（同 sensors/power/alert）：JSON 自动 round-trip + 读取处 `?? 常量` 兜底，不 bump SAVE_VERSION。
   */
  sensorTuning?: SensorTuning;
  /**
   * 被探测度 / 「警觉」（深水区 Phase 0b）：点灯/ping 在深水逐回合抬升、摸黑消退（见 clarity.ts::alertDelta）；
   * 越过 ALERT_THRESHOLD 时进节点 → 潜伏捕食者接近、触发遭遇（moveToNode）。浅水不积累（§7.5）。
   * 未发布故不做迁移（同 sensors/power）：createNewRun 种 0 + 反序列化处 `?? 0` 兜底。
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
   * 可选 → POI 下潜 / 旧存档省略即 1（无加压）。派生自 band，未发布不 bump SAVE_VERSION（JSON 自动 round-trip）。
   */
  bandAlertFactor?: number;
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
  | { kind: 'nodeSelect'; choices: NodeChoice[] }
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
