// 迷路图生成器（洞穴：蓝洞群）——generateMazeMap
// 真 2D 坐标版（地图2D坐标 SPEC·Phase 2·2026-07-20）：**先撒点、后连边**——节点位置由 Poisson-disk 撒点产出、
// y≡depth（「位置即深度」构造保证）、连边＝Gabriel∪MST 邻近图（近而无边⇒中间必隔点或墙）。撒点脊柱见
// mapgen-scatter.ts（与 layered 共用）；本文件只做上层：节点类型 / 事件抽取 / 地标 / corpse / 双向 connectsTo。
// 剖面曲线 k（洞型谱）与横向廊模式（orientation/serpentine）经 domain + curveK 传给脊柱。公共工具见 mapgen-shared。

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
import { buildScatterGraph, type ScatterDomain } from './mapgen-scatter';

// ============================================================
// 迷路图（洞穴）—— 真 2D 撒点连图：环 + 死路 + 多个最深点
// ============================================================
//
// 生成步骤（因果倒置：先位置、后边——SPEC §0/§2）：
//   1. 节点数 N：从 zone 派生（layerCount × 布局倍率）；opts.layerCount 可覆盖（平廊拉长图）。
//   2. buildScatterGraph（撒点脊柱·mapgen-scatter.ts）：分层撒点（最终空间·洞型谱 k 进采样）→ Gabriel∪MST 连边 →
//      结构编排（entrance 钉最浅 / 2–3 最深点钉 d1 成 degree-1 叶 / far exit 叶 / 补环）→ BFS 树距。
//      （无「分离修复」pass——分层 minDist + 只删边不动点已构造性保住分离·SPEC §2③ 实装修正。）
//      产出：pts(x,y=depth) / adj(无向) / dist(树距=layer) / entrance / deepPoints / farExit。
//   3. depth[i] = round(clamp(pts[i].y))（deepPoints 保证 = d1·entrance = d0）；节点带 x=pts[i].x（保留小数）。
//   4. 节点类型：entrance + far exit = ascent_point；其余 event（洞里事件密度高）/ 偶尔 rest。
//   5. 地标（气穴 / 扎营点）：从非保护内部节点里挑，给迷路的岔路 / 死路加"值得绕"的理由。
//   6. corpse pass：在非入口非出口非地标节点按 depth ±10m 植入尸体。
//   7. connectsTo 双向：邻接表两边都写，玩家可回头/重访（重访不重播事件见 dive.ts::moveToNode）。

export function generateMazeMap(opts: GenOpts, baseD0: number, baseD1: number): DiveMap {
  const { zone, profileFlags, rng = Math.random, deaths = [], corpseChance = 0.6, targetCorpseId, maxRoomFeatures = 1, roomFeatureChanceBonus = 0 } = opts;
  const d0 = baseD0;
  const d1 = baseD1;
  const canFreeAscend = zone.canFreeAscend !== false;

  // —— 1. 节点数：从 zone 派生（layerCount × 布局倍率）；opts.layerCount 可覆盖（平廊拉长图）。
  // 竖向 ×2（历史规模）；宽布局（横/蛇行）×3＝POI 更多（作者 2026-06-27·见 nodeCountMultiplier）。——
  // 下限 12（复审 fuzz 实证 N<10 撒点脊柱不安全：MST 边免修剪→边长超上限 / 不足两死路等）——经 layerCount POI 覆盖
  // 可把节点数压到低值故须防御（现役 zone 本就 ≥12·此地板对它们 no-op·只兜低 layerCount 覆盖）。
  const minN = Math.max(12, (opts.layerCount ?? zone.layerCount) * nodeCountMultiplier(resolveLayoutStyle(zone)));
  const maxN = minN + 4;
  const N = randInt(minN, maxN, rng);

  // —— 2. 撒点脊柱：domain 按朝向/布局分流（横向锁带 / 蛇行折返 / 竖向下行）；curveK 走洞型谱链（照旧）——
  const domain: ScatterDomain =
    zone.orientation === 'horizontal' ? 'horizontal' : resolveLayoutStyle(zone) === 'serpentine' ? 'serpentine' : 'vertical';
  const curveK = resolveDepthCurve(opts);
  const { pts, adj, dist, entrance, deepPoints, farExit } = buildScatterGraph({ rng, n: N, d0, d1, curveK, domain });
  // 实际节点数（撒点自适应间距下可能略少于目标 N·内容预算近似即可）——以下全用它，别用目标 N。
  const nodeCount = pts.length;

  // —— 3. 深度（= 撒点 y·deepPoints 保证 d1·entrance d0）——
  const depth = pts.map((p) => Math.round(clamp(p.y, d0, d1)));

  // 保护集（entrance / 最深点 / far exit·地标与 corpse 都绕开它们·守迷路结构不变量）
  const protectedSet = new Set<number>([entrance, ...deepPoints]);
  if (farExit !== undefined) protectedSet.add(farExit);

  const idOf = (i: number) => `node.${i}`;

  // —— 5. 节点类型 + 事件抽取 ——
  const triggeredFakeIds: string[] = [];
  const nodes: Record<string, DiveNode> = {};

  // 地标节点（气穴 / 扎营点）：从非保护内部节点里挑，给迷路的岔路 / 死路加"值得绕"的理由。
  // 它们不是事件池事件——不受洞穴内容稀薄影响；也不算 ascent_point，不动迷路结构不变量。
  const landmarkEligible: number[] = [];
  for (let i = 0; i < nodeCount; i++) if (!protectedSet.has(i)) landmarkEligible.push(i);
  const byDepthDesc = [...landmarkEligible].sort((a, b) => depth[b] - depth[a] || a - b); // 显式 tie-break（同深按索引·house style·确定性）
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

  for (let i = 0; i < nodeCount; i++) {
    const depthI = depth[i];
    const zoneTag: ZoneTag = pickFrom(opts.bandTags ?? tagsForDepth(zone, depthI), rng) ?? 'reef';
    let kind: NodeKind;
    let eventId: string | undefined;
    let features: NodeFeature[] | undefined;
    let preview: string;

    if (i === entrance) {
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
          profileFlags,
          triggeredEventIds: triggeredFakeIds,
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
      layer: dist[i], // 迷路图里 layer = 到入口的树距（BFS·深度层级近似）
      depth: depthI,
      x: pts[i].x, // 真 2D 横坐标（米·保留小数·渲染 px = x·pxPerMeter·SPEC §1）
      zoneTag,
      kind,
      eventId,
      features,
      connectsTo: [...adj[i]].map(idOf), // 双向边
      preview,
    };
  }

  // —— 6. Corpse pass（迷路版）——
  // 候选 = 非入口、非 ascent_point、非地标（气穴/扎营）的节点。
  const corpseCandidateIds: string[] = [];
  for (let i = 0; i < nodeCount; i++) {
    const k = nodes[idOf(i)].kind;
    if (k !== 'ascent_point' && k !== 'air_pocket' && k !== 'camp') corpseCandidateIds.push(idOf(i));
  }
  placeCorpses(nodes, corpseCandidateIds, { deaths, zoneId: zone.id, targetCorpseId, corpseChance, rng });

  return {
    zoneId: zone.id,
    generatedAt: Date.now(),
    nodes,
    startNodeId: idOf(entrance),
  };
}
