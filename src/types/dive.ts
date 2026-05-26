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
  /** 节点选择时的简短预览文本 */
  preview: string;
  /** UI 提示：附近可能有尸体 */
  hasCorpseHint?: boolean;
}

export type NodeKind =
  | 'event' // 普通事件
  | 'ascent_point' // 上浮口
  | 'rest' // 休息点（可消耗回合恢复体力）
  | 'corpse' // 尸体回收点
  | 'shop' // 水下黑市（后期）
  | 'boss'; // 区域 BOSS
