// 游戏全局状态
// 与主 SPEC §3 四属性、§7 死亡与元进度对齐

import type { EquipmentSlot } from './items';
import type { DiveMap, NodeKind } from './dive';
import type { CombatState } from './combat';
import type { PoiModifier } from './chart';

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
   * 本次下潜所选 POI 的环境修正（来自海图）。depthOffset 已在 mapgen 生成时消化进各层深度；
   * current / visibility 暂存于此供未来 hook 读取（冲走 / 光照效果待实装）。可选 → 旧存档/脚本省略即无修正。
   */
  diveModifier?: PoiModifier;
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
