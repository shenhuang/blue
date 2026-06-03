// 下潜地图与节点图类型
// 对应主 SPEC §6.1 节点图生成

import type { ZoneTag } from './events';

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
}

/** 下潜地图（运行时生成） */
export interface DiveMap {
  zoneId: string;
  generatedAt: number;
  nodes: Record<string, DiveNode>;
  startNodeId: string;
  /** 教学关固定指向第一个事件；随机图指向第一层第一个节点 */
}

/** 节点 */
export interface DiveNode {
  id: string;
  layer: number;
  depth: number;
  zoneTag: ZoneTag;
  /** 节点类型 */
  kind: NodeKind;
  /** 事件型节点的事件 id（运行时根据池子抽取） */
  eventId?: string;
  /** corpse 节点指向的 DeathRecord.id */
  corpseRecordId?: string;
  /** 该节点能去往下一层的节点 ids */
  connectsTo: string[];
  /** 节点选择时的简短预览文本（灯下看到的"地面真相"；声呐表象 / 盲航由 clarity 在选点时改写） */
  preview: string;
  /** UI 提示：附近可能有尸体 */
  hasCorpseHint?: boolean;
  /**
   * 深水区 Phase 0a 声呐钩子（默认 unset，留 Phase 3 mimic / 深水生物填；先加字段不改写）：
   *  - evadesSonar：该节点对声呐"没回波"（生物躲开声呐）。
   *  - spoofsSonar：该节点给声呐"喂假回波"——把自己显示成此处写的东西（地形 / 信标 / 空水，mimic 即此类）。
   * 仅影响 `engine/clarity.ts::sonarReturn` 的不可信表象；灯（近距真相）不被改写。
   */
  evadesSonar?: boolean;
  spoofsSonar?: string;
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
