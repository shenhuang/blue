// 迷路图生成器（洞穴：蓝洞群）——generateMazeMap
// 双向边的连通图：成树 + 弦边（环）+ 死路 + 多个最深点；入口与「洞另一头的出口」都是
// ascent_point。剖面曲线 k（洞型谱）与横向廊模式见函数内注释。公共工具见 mapgen-shared。

import type { DiveMap, DiveNode, NodeFeature, NodeKind, ZoneTag } from '@/types';
import { buildEventPool, pickWeighted, tagsForDepth } from './zones';
import {
  type GenOpts,
  randInt,
  pickFrom,
  clamp,
  resolveDepthCurve,
  resolveLayoutStyle,
  nodeCountMultiplier,
  maybeMultiFeatureRoom,
  roomPreview,
  placeCorpses,
} from './mapgen-shared';

// ============================================================
// 迷路图（洞穴）—— 双向连通图：环 + 死路 + 多个最深点
// ============================================================
//
// 生成步骤：
//   1. 随机生成成树（spanning tree）——保证连通 + 自然产生死路（树叶）。父节点从"最近放置的
//      几个"里挑，使树更像蜿蜒的主水道而非星形。
//   2. 选定受保护的叶子：deepCount 个"最深点"（深度强制 = d1，且邻居更浅 → 局部极大）+ 1 个
//      "另一头的出口"（far exit, ascent_point）。受保护叶子不接弦边，保证它们维持 degree 1。
//   3. 加弦边（chord）制造环（绕回原点的回路），只连"距离相近"的非保护节点，不破坏深点/出口。
//   4. 赋深度：按到入口的树距递增（远 = 深）+ 抖动；入口最浅；最深点钉死 d1。
//   5. 赋节点类型：入口 + far exit = ascent_point；其余 event（洞里事件密度高）/ 偶尔 rest。
//   6. corpse pass：在非入口非出口节点按 depth ±10m 植入尸体。
//   7. connectsTo 双向：邻接表两边都写，玩家可回头/重访（重访不重播事件见 dive.ts::moveToNode）。

export function generateMazeMap(opts: GenOpts, baseD0: number, baseD1: number): DiveMap {
  const { zone, profileFlags, rng = Math.random, deaths = [], corpseChance = 0.6, targetCorpseId, maxRoomFeatures = 1, roomFeatureChanceBonus = 0 } = opts;
  const d0 = baseD0;
  const d1 = baseD1;
  const canFreeAscend = zone.canFreeAscend !== false;

  // —— 节点数：从 zone 派生（layerCount × 布局倍率）；opts.layerCount 可覆盖（平廊拉长图）。
  // 竖向 ×2（历史规模·逐字节不变）；宽布局（横/蛇行/环/螺旋）×3＝POI 更多（作者 2026-06-27·见 nodeCountMultiplier）。——
  const minN = Math.max(8, (opts.layerCount ?? zone.layerCount) * nodeCountMultiplier(resolveLayoutStyle(zone)));
  const maxN = minN + 4;
  const N = randInt(minN, maxN, rng);

  const adj: Set<number>[] = Array.from({ length: N }, () => new Set<number>());
  const link = (a: number, b: number) => {
    adj[a].add(b);
    adj[b].add(a);
  };

  // —— 1. 随机成树：i 接到 [i-window, i-1] 里随机一个已放置节点（偏近 → 蜿蜒主道）——
  for (let i = 1; i < N; i++) {
    const lo = Math.max(0, i - 4);
    const p = randInt(lo, i - 1, rng);
    link(i, p);
  }

  // —— 树距（hop distance from 入口 node 0），同时是 DiveNode.layer 的新语义 ——
  const dist = new Array<number>(N).fill(0);
  {
    const seen = new Array<boolean>(N).fill(false);
    const queue: number[] = [0];
    seen[0] = true;
    while (queue.length) {
      const u = queue.shift()!;
      for (const v of adj[u]) {
        if (!seen[v]) {
          seen[v] = true;
          dist[v] = dist[u] + 1;
          queue.push(v);
        }
      }
    }
  }
  const maxDist = Math.max(1, ...dist);

  // —— 2. 选受保护叶子：最深点 + far exit ——
  const leaves: number[] = [];
  for (let i = 1; i < N; i++) if (adj[i].size === 1) leaves.push(i);
  leaves.sort((a, b) => dist[b] - dist[a]); // 远的优先

  const protectedSet = new Set<number>();
  const deepCount = Math.min(leaves.length, N >= 13 ? 3 : 2);
  const deepPoints = leaves.slice(0, deepCount);
  for (const dp of deepPoints) protectedSet.add(dp);

  // far exit：另一片叶子（不与最深点重叠）；没有富余叶子时退化为最远的非保护节点
  let farExit: number | undefined = leaves.find((l) => !protectedSet.has(l));
  if (farExit === undefined) {
    let best = -1;
    let bestDist = -1;
    for (let i = 1; i < N; i++) {
      if (protectedSet.has(i)) continue;
      if (dist[i] > bestDist) {
        bestDist = dist[i];
        best = i;
      }
    }
    if (best >= 0) farExit = best;
  }
  if (farExit !== undefined) protectedSet.add(farExit);

  // —— 3. 加弦边制造环（不碰受保护叶子）——
  const nonProtected: number[] = [];
  for (let i = 0; i < N; i++) if (!protectedSet.has(i)) nonProtected.push(i);
  const targetChords = randInt(2, 3, rng);
  let chords = 0;
  let attempts = 0;
  while (chords < targetChords && attempts < N * 6 && nonProtected.length >= 2) {
    attempts++;
    const a = pickFrom(nonProtected, rng);
    const b = pickFrom(nonProtected, rng);
    if (a === b || adj[a].has(b)) continue;
    if (Math.abs(dist[a] - dist[b]) > 2) continue; // 只连距离相近的水道，回路才可信
    link(a, b);
    chords++;
  }
  // 兜底：保证至少一个环（万一上面没凑到相近的一对）
  if (chords === 0) {
    outer: for (const a of nonProtected) {
      for (const b of nonProtected) {
        if (a !== b && !adj[a].has(b)) {
          link(a, b);
          chords++;
          break outer;
        }
      }
    }
  }

  // —— 4. 赋深度（按朝向分流）——
  const kCurve = resolveDepthCurve(opts);
  const isHorizontal = zone.orientation === 'horizontal';
  const depth = new Array<number>(N).fill(d0);

  if (isHorizontal) {
    // 水平廊模式：深度锁在 [d0,d1] 中值附近小幅浮动；探索距离（layer/dist）替代深度成为主压力轴。
    // depthRange 语义 = 「基准深度 ± (span/2)」；不强制最深点钉死 d1（深度轴已不是压力来源）。
    const baseMid = (d0 + d1) / 2;
    const hVariance = (d1 - d0) / 2;
    for (let i = 0; i < N; i++) {
      const jitter = (rng() * 2 - 1) * hVariance;
      depth[i] = Math.round(clamp(baseMid + jitter, d0, d1));
    }
  } else {
    // 垂直模式（默认）：k=1 走原式（逐字节复现旧图）；k≠1 时 pow 单调 ⇒ 「位置即深度」#92 对任意 k>0 保持。
    // jitter 的 rng 消耗每节点恒一次、与 k 无关 ⇒ 曲线只改深度值、不动结构 rng 流。
    const jitterRange = (d1 - d0) * 0.12;
    for (let i = 1; i < N; i++) {
      const frac = dist[i] / maxDist;
      const curved = kCurve === 1 ? frac : Math.pow(frac, kCurve);
      const jitter = (rng() * 2 - 1) * jitterRange;
      depth[i] = Math.round(clamp(d0 + (d1 - d0) * curved + jitter, d0, d1));
    }
    // 最深点钉死 d1，并把其（唯一）邻居压到更浅 → 严格局部极大
    for (const dp of deepPoints) {
      depth[dp] = d1;
      for (const nb of adj[dp]) {
        if (depth[nb] >= depth[dp]) {
          depth[nb] = clamp(depth[dp] - randInt(3, 8, rng), d0, d1 - 1);
        }
      }
    }
  }

  // —— 5. 节点类型 + 事件抽取 ——
  const idOf = (i: number) => `node.${i}`;
  const triggeredFakeIds: string[] = [];
  const nodes: Record<string, DiveNode> = {};

  // 地标节点（气穴 / 扎营点）：从非保护内部节点里挑，给迷路的岔路 / 死路加"值得绕"的理由。
  // 它们不是事件池事件——不受洞穴内容稀薄影响；也不算 ascent_point，不动迷路结构不变量。
  const landmarkEligible: number[] = [];
  for (let i = 1; i < N; i++) if (!protectedSet.has(i)) landmarkEligible.push(i);
  const byDepthDesc = [...landmarkEligible].sort((a, b) => depth[b] - depth[a]);
  let airPocketIdx = -1;
  let campIdx = -1;
  if (byDepthDesc.length > 0 && rng() < 0.7) {
    // 气穴偏深处布点（越深越是救命）
    const deepHalf = byDepthDesc.slice(0, Math.max(1, Math.ceil(byDepthDesc.length / 2)));
    airPocketIdx = pickFrom(deepHalf, rng);
  }
  const campPool = landmarkEligible.filter((i) => i !== airPocketIdx);
  if (campPool.length > 0 && rng() < 0.5) {
    campIdx = pickFrom(campPool, rng);
  }

  for (let i = 0; i < N; i++) {
    const depthI = depth[i];
    const zoneTag: ZoneTag = pickFrom(opts.bandTags ?? tagsForDepth(zone, depthI), rng) ?? 'reef';
    let kind: NodeKind;
    let eventId: string | undefined;
    let features: NodeFeature[] | undefined;
    let preview: string;

    if (i === 0) {
      kind = 'ascent_point';
      preview = '洞口在你身后，水面的光从这里漏进来。回头还能从这儿出去。';
    } else if (i === farExit) {
      kind = 'ascent_point';
      preview = '岩壁裂开一道朝上的缝，有光渗下来——洞另一头的出口。';
    } else if (i === airPocketIdx) {
      kind = 'air_pocket';
      preview = '礁顶一道裂缝，水面在晃——像是个气穴。';
    } else if (i === campIdx) {
      kind = 'camp';
      preview = '洞壁上一处天然的窄台，刚好够卡住浮力坐下。';
    } else {
      // 洞里事件密度高；偶尔是空水道（rest）。没有匹配事件时也退化 rest。
      const wantRest = rng() < (canFreeAscend ? 0.2 : 0.15);
      if (wantRest) {
        kind = 'rest';
        preview = '一处可以稳住呼吸的水兜。';
      } else {
        const pool = buildEventPool({
          zone,
          depth: depthI,
          sanity: 100,
          profileFlags,
          triggeredEventIds: triggeredFakeIds,
          tagsOverride: opts.bandTags,
          poiId: opts.poiId,
          poiTemplateId: opts.poiTemplateId,
        });
        if (pool.length === 0) {
          kind = 'rest';
          preview = '一段空荡的水道，只有你的气泡声。';
        } else {
          const chosen = pickWeighted(pool, rng)!;
          kind = 'event';
          eventId = chosen.id;
          preview = chosen.title;
          triggeredFakeIds.push(chosen.id);
          // 多事件房间（S1）：洞里大房间偶尔含多个 feature（maxRoomFeatures>1 才进；缺省零额外 rng＝旧迷路图不变）。
          const feats = maybeMultiFeatureRoom(chosen, {
            zone, depth: depthI, profileFlags, triggeredFakeIds, bandTags: opts.bandTags, poiId: opts.poiId, poiTemplateId: opts.poiTemplateId, rng, maxFeatures: maxRoomFeatures, chanceBonus: roomFeatureChanceBonus,
          });
          if (feats) {
            features = feats;
            eventId = undefined; // 大房间不用单 eventId：moveToNode 据 features 路由到房间菜单
            preview = roomPreview(feats.length);
          }
        }
      }
    }

    nodes[idOf(i)] = {
      id: idOf(i),
      layer: dist[i], // 迷路图里 layer = 到入口的树距（深度层级近似）
      depth: depthI,
      zoneTag,
      kind,
      eventId,
      features,
      connectsTo: [...adj[i]].map(idOf), // 双向边
      preview,
    };
  }

  // —— 6. Corpse pass（迷路版）——
  // 候选 = 非入口（i!==0）、非 ascent_point 的节点。
  // 候选 = 非入口、非 ascent_point、非地标（气穴/扎营）的节点
  const corpseCandidateIds: string[] = [];
  for (let i = 1; i < N; i++) {
    const k = nodes[idOf(i)].kind;
    if (k !== 'ascent_point' && k !== 'air_pocket' && k !== 'camp') corpseCandidateIds.push(idOf(i));
  }
  placeCorpses(nodes, corpseCandidateIds, { deaths, zoneId: zone.id, targetCorpseId, corpseChance, rng });

  return {
    zoneId: zone.id,
    generatedAt: Date.now(),
    nodes,
    startNodeId: idOf(0),
  };
}
