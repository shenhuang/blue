// 节点图生成器
// 给定 zone，生成一张有向图：5 层，每层 2-3 个节点，深度从 zone.depthRange[0] 渐变到 [1]

import type { DiveMap, DiveNode, ZoneDef, NodeKind, ZoneTag, DeathRecord } from '@/types';
import { buildEventPool, pickWeighted, tagsForDepth } from './zones';
import { findRecoverableCorpse } from './death';

interface GenOpts {
  zone: ZoneDef;
  profileFlags: Set<string>;
  /** profile.deaths 列表，用于尸体生成 */
  deaths?: DeathRecord[];
  /** 尸体出现概率（0–1）。后续按打捞行会升级提高 */
  corpseChance?: number;
  rng?: () => number;
}

function randInt(min: number, max: number, rng = Math.random): number {
  return Math.floor(rng() * (max - min + 1)) + min;
}

function pickFrom<T>(arr: T[], rng = Math.random): T {
  return arr[Math.floor(rng() * arr.length)];
}

function chooseNodeKind(layer: number, totalLayers: number, rng = Math.random): NodeKind {
  // 第一层全部 event；最后一层至少有一个 ascent_point
  if (layer === 0) return 'event';
  if (layer === totalLayers - 1) return 'ascent_point';
  const roll = rng();
  if (roll < 0.8) return 'event';
  if (roll < 0.9) return 'rest';
  return 'ascent_point';
}

export function generateDiveMap(opts: GenOpts): DiveMap {
  const { zone, profileFlags, rng = Math.random, deaths = [], corpseChance = 0.6 } = opts;

  if (zone.generation === 'linearScripted') {
    // 教学关：单节点指向起始事件
    const startNode: DiveNode = {
      id: 'scripted.start',
      layer: 0,
      depth: zone.depthRange[0],
      zoneTag: 'tutorial',
      kind: 'event',
      eventId: zone.scriptedStartEventId,
      connectsTo: [],
      preview: '出发。',
    };
    return {
      zoneId: zone.id,
      generatedAt: Date.now(),
      nodes: { [startNode.id]: startNode },
      startNodeId: startNode.id,
    };
  }

  // 随机图：layerCount 层，深度均匀分布
  const totalLayers = zone.layerCount;
  const [d0, d1] = zone.depthRange;
  const depthStep = (d1 - d0) / Math.max(1, totalLayers - 1);

  const nodes: Record<string, DiveNode> = {};
  const layerNodes: string[][] = [];
  const triggeredFakeIds: string[] = []; // 用来传给 buildEventPool 防止同 run 重复

  for (let L = 0; L < totalLayers; L++) {
    const depth = Math.round(d0 + depthStep * L);
    const count = randInt(zone.nodesPerLayer[0], zone.nodesPerLayer[1], rng);
    const ids: string[] = [];

    for (let i = 0; i < count; i++) {
      const id = `node.${L}.${i}`;
      const kind = chooseNodeKind(L, totalLayers, rng);

      let eventId: string | undefined;
      let preview = '';
      let zoneTag: ZoneTag = pickFrom(tagsForDepth(zone, depth), rng) ?? 'reef';

      if (kind === 'event') {
        const pool = buildEventPool({
          zone,
          depth,
          sanity: 100, // 生成时按 100 算；真实 sanity 在抽取那一刻可能改变可见性，但 MVP 阶段先这样
          profileFlags,
          triggeredEventIds: triggeredFakeIds,
        });
        if (pool.length === 0) {
          // 没有匹配事件，退化为 rest
          preview = '一片空旷的水域。';
          ids.push(id);
          nodes[id] = { id, layer: L, depth, zoneTag, kind: 'rest', connectsTo: [], preview };
          continue;
        }
        const chosen = pickWeighted(pool, rng)!;
        eventId = chosen.id;
        preview = chosen.title;
        triggeredFakeIds.push(chosen.id); // 同 run 不再选
      } else if (kind === 'rest') {
        preview = '一片可以喘息的水域。';
      } else if (kind === 'ascent_point') {
        preview = '一道斜向上的礁脊，可以从这里上浮。';
      }

      nodes[id] = {
        id,
        layer: L,
        depth,
        zoneTag,
        kind,
        eventId,
        connectsTo: [],
        preview,
      };
      ids.push(id);
    }

    layerNodes.push(ids);
  }

  // —— 连线：每个上一层节点连到下一层 1-2 个节点 ——
  for (let L = 0; L < totalLayers - 1; L++) {
    const cur = layerNodes[L];
    const next = layerNodes[L + 1];
    for (const fromId of cur) {
      const linkCount = Math.min(next.length, randInt(1, 2, rng));
      // 随机挑 linkCount 个
      const shuffled = [...next].sort(() => rng() - 0.5);
      const links = shuffled.slice(0, linkCount);
      nodes[fromId].connectsTo = links;
    }
    // 确保下一层每个节点都至少有一个入边
    const inEdges: Record<string, number> = {};
    for (const nid of next) inEdges[nid] = 0;
    for (const fromId of cur) {
      for (const toId of nodes[fromId].connectsTo) {
        inEdges[toId] = (inEdges[toId] ?? 0) + 1;
      }
    }
    for (const [nid, deg] of Object.entries(inEdges)) {
      if (deg === 0) {
        // 找到任何一个 cur 节点，强制加一条
        const donor = pickFrom(cur, rng);
        if (!nodes[donor].connectsTo.includes(nid)) {
          nodes[donor].connectsTo.push(nid);
        }
      }
    }
  }

  // —— Corpse pass：尝试为本图植入一具尸体 ——
  // 跳过第一层（出发点）和最后一层（上浮口），从中间层挑一个深度匹配的节点
  if (deaths.length > 0 && rng() < corpseChance) {
    const placedCorpses = new Set<string>();
    const candidateLayers = layerNodes.slice(1, -1);
    // 打乱候选层
    const shuffledLayers = [...candidateLayers].sort(() => rng() - 0.5);
    outer: for (const layerIds of shuffledLayers) {
      for (const nodeId of layerIds) {
        const node = nodes[nodeId];
        // 跳过 ascent_point（不要替换上浮口）
        if (node.kind === 'ascent_point') continue;
        const corpse = findRecoverableCorpse(deaths, zone.id, node.depth, placedCorpses);
        if (corpse) {
          nodes[nodeId] = {
            ...node,
            kind: 'corpse',
            eventId: undefined,
            corpseRecordId: corpse.id,
            preview: '一个熟悉的轮廓，挂在水中。',
            hasCorpseHint: true,
          };
          placedCorpses.add(corpse.id);
          break outer;
        }
      }
    }
  }

  return {
    zoneId: zone.id,
    generatedAt: Date.now(),
    nodes,
    startNodeId: layerNodes[0][0],
  };
}

/** 获取从某节点可达的下一批节点 */
export function getNextChoices(map: DiveMap, fromNodeId: string): DiveNode[] {
  const from = map.nodes[fromNodeId];
  if (!from) return [];
  return from.connectsTo.map((id) => map.nodes[id]).filter(Boolean);
}
