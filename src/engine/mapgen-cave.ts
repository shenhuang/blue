// 持久多口洞生成器（方案 B·多口持久洞 SPEC）——generatePersistentCaveMap + 门户/overlay/分析
// 一张冻结进存档的多入口地图：模型 B 剖面坐标 + 门户标注（portalKind）+ 核心唯一最深；
// 尸体/采尽不冻进图，走加载时 applyCaveOverlays。结构守门断言见 analyzeCave。公共工具见 mapgen-shared。

import type { DiveMap, DiveNode, NodeFeature, NodeKind, ZoneDef, ZoneTag, DeathRecord, CavePortal, CaveRegion, CaveGenParams } from '@/types';
import { buildEventPool, pickWeighted, tagsForDepth } from './zones';
import {
  type GenOpts,
  randInt,
  pickFrom,
  clamp,
  caveDepthCurveForPlace,
  resolveLayoutStyle,
  maybeMultiFeatureRoom,
  roomPreview,
  placeCorpses,
  sprinkleGates,
  applyHarvestDepletion,
} from './mapgen-shared';

// ============================================================
// 持久多口洞（方案 B · 多口持久洞 SPEC §3）—— 一张冻结进存档的多入口地图
// ============================================================
//
// 与 generateMazeMap 的关系（§3.1）：复用「成树 + 弦边 + 死路」连通骨架，但
//   ① 深度走「模型 B 剖面坐标」——每节点**自采深度**、不依赖 hop 树距（避免横向距离被算成深度·#175/#176 正交），
//      核心钉 d1（唯一最深）、入口/出口门户散布、内部按 k 密度剖面采样；边按**深度排名**相邻相连 ⇒ 剖面平滑、横廊等深；
//   ② 标注入口/出口门户（portalKind）+ 核心（唯一最深终点）。
// **单口旧路径（generateMazeMap）一行不改、逐字节复现旧图**——本函数是另一条专用入口（仅 caveEntry 下潜走·§4）。
// 内容（事件/休息/地标/尸体）仍走 buildEventPool(zone) + placeCorpses ＝复用现有内容管道（zone 提供内容）。

/** 深度 → 区域标签（rim/flank/deep·按 [d0,d1] 三分·门户区域偏置绑定用·§2.1）。纯函数。 */
export function caveRegionForDepth(depth: number, d0: number, d1: number): CaveRegion {
  const span = Math.max(1, d1 - d0);
  const f = (depth - d0) / span;
  if (f < 1 / 3) return 'rim';
  if (f < 2 / 3) return 'flank';
  return 'deep';
}

/** 把 count 个门户深度铺在 [lo,hi]：有 authored 用之（跨 beacon 洞钉口深·如 reef 20 / vent 90），否则均布。 */
function spreadPortalDepths(authored: number[] | undefined, count: number, lo: number, hi: number): number[] {
  const out: number[] = [];
  for (let j = 0; j < count; j++) {
    out.push(authored && authored[j] != null ? authored[j] : lo + (hi - lo) * ((j + 0.5) / Math.max(1, count)));
  }
  return out;
}

/** 从一张持久洞地图派生门户清单（扫 portalKind 节点·区域按深度三分）。PersistentCave.portals 的单一来源。 */
export function cavePortalsOf(map: DiveMap): CavePortal[] {
  const depths = Object.values(map.nodes).map((n) => n.depth);
  const d0 = Math.min(...depths);
  const d1 = Math.max(...depths);
  const out: CavePortal[] = [];
  for (const n of Object.values(map.nodes)) {
    if (n.portalKind) out.push({ nodeId: n.id, kind: n.portalKind, depth: n.depth, region: caveRegionForDepth(n.depth, d0, d1) });
  }
  return out;
}

export function generatePersistentCaveMap(opts: GenOpts, params: CaveGenParams): DiveMap {
  // 注：尸体/采尽**不冻进图**——它们是加载时 overlay（applyCaveOverlays·§4.3）·读 live profile.deaths/harvest·
  // 故首次进生成的冻结图＝稳定结构+内容（无尸体）。corpse/harvest 在 dive-start 对 run 的图副本上叠加。
  const { profileFlags, rng = Math.random } = opts;
  const zone = opts.zone;
  const d0 = Math.max(0, params.depthRange[0]);
  const d1 = Math.max(d0 + 1, params.depthRange[1]);
  const span = d1 - d0;
  // 深度密度剖面 k（#114 复用·零 rng·情报同源）：用 caveDepthCurveForPlace、以 caveId 作 id+seed。
  // caveDepthCurveForPlace 只读 zone.id + zone.depthCurveRange（FNV log-uniform·零 rng）——传最小投影即可。
  const kCurve = caveDepthCurveForPlace(
    { id: params.caveId, depthCurveRange: params.depthCurveRange } as unknown as ZoneDef,
    params.caveId,
  );

  const nE = Math.max(1, params.entrancePortals);
  const nX = Math.max(1, params.exitPortals);
  // 节点数：规模派生（N≈2×sizeScale·#175）+ 至少容下 核心(1)+入口+出口+几个内部。
  const minN = Math.max(8, params.sizeScale * 2, 1 + nE + nX + 3);
  const N = randInt(minN, minN + 4, rng);

  // —— 1. 深度坐标（模型 B：每节点自采深度·不依赖 hop 距离）——
  //   索引分配：0=核心(d1·唯一最深)；1..nE=入口；nE+1..nE+nX=出口；其余=内部。
  const depth = new Array<number>(N).fill(d0);
  depth[0] = d1;
  const flat = resolveLayoutStyle(zone) === 'horizontal';
  if (flat) {
    // 横向洞：深度在 [d0,d1] 带内**随机散布**（与 generateMazeMap 的 isHorizontal 同算法·作者验好看·图 51–54）。
    // **不强制核心独占 d1**——那会把一个节点吊到底、拖出一条斜下去的长隧道（作者「奇怪的斜向」·图 82）。
    // 配 mapLayout 的 horizontal（X=进洞树距铺宽）⇒「房间 + 可见隧道」的横洞，而非细扁线。
    const baseMid = (d0 + d1) / 2;
    const hVar = (d1 - d0) / 2;
    for (let i = 0; i < N; i++) depth[i] = clamp(Math.round(baseMid + (rng() * 2 - 1) * hVar), d0, d1);
  } else {
    // 模型 B（竖向/默认·**逐字节同旧**）：核心独占 d1·门户按声明深度散布·内部按 k 剖面采样。
    depth[0] = d1;
    const entDepths = spreadPortalDepths(params.entranceDepths, nE, d0, d0 + 0.55 * span);
    const exitDepths = spreadPortalDepths(params.exitDepths, nX, d0 + 0.35 * span, d1 - Math.max(1, 0.05 * span));
    for (let j = 0; j < nE; j++) depth[1 + j] = clamp(Math.round(entDepths[j]), d0, d1 - 1);
    for (let j = 0; j < nX; j++) depth[1 + nE + j] = clamp(Math.round(exitDepths[j]), d0, d1 - 1);
    const interiorStart = 1 + nE + nX;
    const interiorCount = N - interiorStart;
    for (let m = 0; m < interiorCount; m++) {
      const frac = (m + 0.5) / Math.max(1, interiorCount);
      const shaped = kCurve === 1 ? frac : Math.pow(frac, kCurve);
      const jitter = (rng() * 2 - 1) * span * 0.04;
      // 内部不触 d1（核心独占最深）；横向不污染深度·§3.3。
      depth[interiorStart + m] = clamp(Math.round(d0 + span * shaped + jitter), d0, d1 - 1);
    }
  }

  // —— 2. 建连通 ——
  // 非横向（默认）：按**深度排名**连（边连深度相邻 ⇒ 剖面平滑·不依赖 hop·§3.3·逐字节同旧）。
  // 横向：按**原始 index**连（同 generateMazeMap 的随机树）⇒ 进洞树距(layer)与深度脱钩 ⇒ 配 mapLayout horizontal
  //   摊成 2D 团（房间+可见隧道·图 51–54），不再因「连线追着深度走」被拖成斜线（图 82/91）。
  const order = flat
    ? Array.from({ length: N }, (_, i) => i)
    : Array.from({ length: N }, (_, i) => i).sort((a, b) => depth[a] - depth[b]);
  const rankOf = new Array<number>(N);
  order.forEach((idx, r) => (rankOf[idx] = r));
  const adj: Set<number>[] = Array.from({ length: N }, () => new Set<number>());
  const link = (a: number, b: number) => { adj[a].add(b); adj[b].add(a); };
  // 成树：order[r] 接到 order[r-4..r-1] 里随机一个（深度相邻 → 蜿蜒主道·平滑）。核心是最深 rank=N-1 ⇒ 自然成 degree-1 死路终点。
  for (let r = 1; r < N; r++) {
    const pr = randInt(Math.max(0, r - 4), r - 1, rng);
    link(order[r], order[pr]);
  }
  // 弦边：连深度排名相近的非核心对（环/绕回·不跳深）。核心(0)受保护不接弦 → 守唯一最深 + 深处终点感。
  const targetChords = randInt(2, 3, rng);
  let chords = 0;
  let attempts = 0;
  while (chords < targetChords && attempts < N * 6) {
    attempts++;
    const a = randInt(0, N - 1, rng);
    const b = randInt(0, N - 1, rng);
    if (a === b || a === 0 || b === 0 || adj[a].has(b)) continue;
    if (Math.abs(rankOf[a] - rankOf[b]) > 2) continue; // 只连深度排名相近 ⇒ 回路可信、不跳深
    link(a, b);
    chords++;
  }

  // —— 3. 标注 + 内容（门户=ascent_point+portalKind；核心/内部=事件/休息/地标·复用 zone 内容）——
  const idOf = (i: number) => `node.${i}`;
  const triggeredFakeIds: string[] = [];
  const nodes: Record<string, DiveNode> = {};
  const maxRoomFeatures = opts.maxRoomFeatures ?? 1;
  const roomFeatureChanceBonus = opts.roomFeatureChanceBonus ?? 0;
  const isEntrance = (i: number) => i >= 1 && i < 1 + nE;
  const isExit = (i: number) => i >= 1 + nE && i < 1 + nE + nX;

  for (let i = 0; i < N; i++) {
    const depthI = depth[i];
    const zoneTag: ZoneTag = pickFrom(opts.bandTags ?? tagsForDepth(zone, depthI), rng) ?? 'reef';
    let kind: NodeKind;
    let eventId: string | undefined;
    let features: NodeFeature[] | undefined;
    let preview: string;
    let portalKind: 'entrance' | 'exit' | undefined;

    if (isEntrance(i)) {
      kind = 'ascent_point';
      portalKind = 'entrance';
      preview = '一道通向海面的口，光从这里漏进来——能从这儿下去，也能回到这儿出去。';
    } else if (isExit(i)) {
      kind = 'ascent_point';
      portalKind = 'exit';
      preview = '水从这道缝里往外涌，能顺着浮上去——可逆着回不来，不是下潜的口。';
    } else {
      const wantRest = rng() < 0.15;
      if (wantRest) {
        kind = 'rest';
        preview = '一处可以稳住呼吸的水兜。';
      } else {
        const pool = buildEventPool({
          zone, depth: depthI, sanity: 100, profileFlags, triggeredEventIds: triggeredFakeIds,
          tagsOverride: opts.bandTags, poiId: opts.poiId, poiTemplateId: opts.poiTemplateId,
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
          const feats = maybeMultiFeatureRoom(chosen, {
            zone, depth: depthI, profileFlags, triggeredFakeIds, bandTags: opts.bandTags,
            poiId: opts.poiId, poiTemplateId: opts.poiTemplateId, rng, maxFeatures: maxRoomFeatures, chanceBonus: roomFeatureChanceBonus,
          });
          if (feats) {
            features = feats;
            eventId = undefined;
            preview = roomPreview(feats.length);
          }
        }
      }
    }

    nodes[idOf(i)] = {
      id: idOf(i),
      layer: rankOf[i], // 持久洞 layer = 深度排名（mapLayout 横向分列近似·渲染细节归增量 D）
      depth: depthI,
      zoneTag,
      kind,
      eventId,
      features,
      connectsTo: [...adj[i]].map(idOf),
      preview,
      portalKind,
    };
  }

  const map: DiveMap = {
    zoneId: zone.id,
    generatedAt: Date.now(),
    // 渲染自描述（与 generateDiveMap 同·盖章 layoutStyle）——**持久洞走这条路径**，不盖的话洞在真实游戏里
    // 一律按 vertical 渲染、形状只在 dev 面板可见（dev↔游戏脱节·2026-06-27 修）。cloneDiveMap 是 JSON 深拷贝·会带上。
    layoutStyle: resolveLayoutStyle(zone),
    orientation: zone.orientation,
    nodes,
    // 默认起手 = 第一个入口门户（idOf(1)）；load 时按绑定入口（caveEntry 解析·§2.3/§4.1）覆盖 currentNodeId。
    startNodeId: idOf(1),
  };
  // 感知门撒布（感知门 SPEC §6·确定性·零 rng·冻进洞结构·无 zone.gates→no-op·byte-identical）。
  sprinkleGates(map, zone, params.caveId);
  return map;
}

/**
 * 持久洞加载 overlay（多口持久洞 SPEC §4.3）：在**本潜的图副本**上叠加尸体 + 采尽抹平（确定性·读 live 状态）。
 * 冻结图保持干净（稳定真相）；每潜按 live profile.deaths（#36 定位不变·recovered 不再布）+ harvest（by caveId·
 * save 级 harvestedItemIds / run 级 harvestedNodeIds）叠加。原地改 map.nodes——**调用方传图副本**（别改 caveMaps 冻结原图）。
 * 候选 = 非门户、非地标节点（同迷路 corpse 候选）。rng 缺省 Math.random（per-dive·新尸体可随时间出现）。
 */
export function applyCaveOverlays(
  map: DiveMap,
  opts: {
    deaths?: DeathRecord[];
    zoneId: string;
    corpseChance?: number;
    targetCorpseId?: string;
    rng?: () => number;
    harvestedItemIds?: Set<string>;
    harvestedNodeIds?: Set<string>;
  },
): void {
  const candidateIds: string[] = [];
  for (const n of Object.values(map.nodes)) {
    if (n.portalKind) continue; // 门户（入口/出口）不布尸
    if (n.kind === 'ascent_point' || n.kind === 'air_pocket' || n.kind === 'camp' || n.kind === 'corpse') continue;
    candidateIds.push(n.id);
  }
  placeCorpses(map.nodes, candidateIds, {
    deaths: opts.deaths ?? [],
    zoneId: opts.zoneId,
    targetCorpseId: opts.targetCorpseId,
    corpseChance: opts.corpseChance ?? 0.6,
    rng: opts.rng ?? Math.random,
  });
  applyHarvestDepletion(map, opts.harvestedItemIds, opts.harvestedNodeIds);
}

/** 持久洞结构分析（多口持久洞 SPEC §7 守门 + 新 baseline 断言用）。 */
export interface CaveAnalysis {
  entranceCount: number;
  exitCount: number;
  /** 唯一最深节点 id（核心）；最深点不止一个 → undefined（违反「核心唯一最深」）。 */
  coreNodeId: string | undefined;
  coreIsUniqueDeepest: boolean;
  /** 从每个入口门户出发都能沿 connectsTo 到达全图（连通·从不死胡同）。 */
  allReachableFromEntrances: boolean;
  /** 全节点 depth ∈ [d0,d1]。 */
  depthInRange: boolean;
  /** 相邻节点最大深度差（剖面平滑信号·廊道不跳深）。 */
  maxNeighborDepthGap: number;
}

export function analyzeCave(map: DiveMap, depthRange: [number, number]): CaveAnalysis {
  const nodes = Object.values(map.nodes);
  const entrances = nodes.filter((n) => n.portalKind === 'entrance');
  const exits = nodes.filter((n) => n.portalKind === 'exit');
  const maxDepth = Math.max(...nodes.map((n) => n.depth));
  const deepest = nodes.filter((n) => n.depth === maxDepth);
  const [d0, d1] = depthRange;

  const reachAll = entrances.every((e) => {
    const seen = new Set<string>([e.id]);
    const stack = [e.id];
    while (stack.length) {
      const u = stack.pop()!;
      for (const v of map.nodes[u].connectsTo) if (!seen.has(v)) { seen.add(v); stack.push(v); }
    }
    return seen.size === nodes.length;
  });

  let maxGap = 0;
  for (const n of nodes) {
    for (const v of n.connectsTo) maxGap = Math.max(maxGap, Math.abs(n.depth - map.nodes[v].depth));
  }

  return {
    entranceCount: entrances.length,
    exitCount: exits.length,
    coreNodeId: deepest.length === 1 ? deepest[0].id : undefined,
    coreIsUniqueDeepest: deepest.length === 1,
    allReachableFromEntrances: entrances.length > 0 && reachAll,
    depthInRange: nodes.every((n) => n.depth >= d0 && n.depth <= d1),
    maxNeighborDepthGap: maxGap,
  };
}
