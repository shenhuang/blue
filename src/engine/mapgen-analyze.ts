// 结构分析器（纯函数·拓扑无关）——dev 面板可视化 + mapgen 回归断言共用
// getNextChoices（连通邻居）+ analyzeMap（连通/环/死路/深度剖面等结构性质）。对外经 mapgen.ts 门面。

import type { DiveMap, DiveNode } from '@/types';

/** 获取从某节点可达的下一批节点（连通邻居；迷路图双向，含来路） */
export function getNextChoices(map: DiveMap, fromNodeId: string): DiveNode[] {
  const from = map.nodes[fromNodeId];
  if (!from) return [];
  return from.connectsTo.map((id) => map.nodes[id]).filter(Boolean);
}

// ============================================================
// 结构分析器（纯函数）—— dev 面板可视化 + mapgen 回归断言共用
// ============================================================

export interface MapAnalysis {
  nodeCount: number;
  /** 无向边数（迷路图 connectsTo 对称，按无向对去重计数） */
  edgeCount: number;
  /** 从 startNodeId 沿 connectsTo 可达的节点数 */
  reachableCount: number;
  /** 全部节点是否都从起点可达（真 2D 撒点脊柱后迷路/层状同为无向连通 ⇒ 恒 true·2026-07-20 起层状不再有孤立同层起点节点） */
  allReachable: boolean;
  /** connectsTo 是否完全对称（双向） */
  isUndirected: boolean;
  /** 死路 = degree 1 且非 ascent_point 的节点 id（被困需回头的尽头） */
  deadEndIds: string[];
  hasDeadEnd: boolean;
  /** 独立环数 = 边 - 点 + 连通分量；>0 即存在回路 */
  cycleRank: number;
  hasCycle: boolean;
  /**
   * 「脊柱」＝图直径路径（最长最短路）上的节点数；`spineNodeCount / nodeCount` ＝**脊柱占比**。
   * 1.0 ＝整张图就是一条线（"一条线走到底"）；越低＝越多节点挂在主干两侧＝越网状。
   * 直径路径取法确定性：端点取 id 序最小的最远对、回溯父指针取 id 序最小前驱（同图恒得同一条脊柱）。
   */
  spineNodeCount: number;
  /** 脊柱占比 = spineNodeCount / nodeCount（0..1·nodeCount=0 时取 0）。 */
  spineRatio: number;
  /**
   * **离脊分支的最大节点数**：把脊柱节点从图里挖掉后，剩下各连通块的最大规模。
   * 1 ＝所有岔路都只是"单点凸起"（走一步就到头·玩家感受不到岔路）；≥2 ＝存在真正能走进去的支路。
   * 这是"一条线走到底"这个 bug 的判据——退化图的 spineRatio 高**且** maxOffSpineBranch 恒为 1。
   */
  maxOffSpineBranch: number;
  /** 离脊分支的条数（连通块个数）。 */
  offSpineBranchCount: number;
  maxDepth: number;
  /**
   * 平均深度占比：所有节点 (depth−minDepth)/(maxDepth−minDepth) 的均值（0..1·span=0 时取 0）。
   * 剖面形状的回归信号：k>1 廊+坑 → 低（大部分行程浅）；k<1 井+廊 → 高；线性 ≈ 0.5。
   */
  meanDepthFrac: number;
  /** 深度等于全图最大深度的节点 id（"最深点"） */
  deepestNodeIds: string[];
  /** 局部深度极大节点 id（depth ≥ 所有邻居 depth，degree≥1） */
  localMaximaIds: string[];
  ascentPointIds: string[];
  /** 从起点可达的 ascent_point 数 */
  reachableAscentCount: number;
  allAscentReachable: boolean;
  entranceIsAscent: boolean;
  startNodeId: string;
}

/** 无向 BFS 树距（不可达 = -1）。spine 计算与 analyzeMap 共用。 */
function bfsHops(ids: string[], undirected: Map<string, Set<string>>, src: string): Map<string, number> {
  const dist = new Map<string, number>(ids.map((id) => [id, -1]));
  dist.set(src, 0);
  const queue = [src];
  for (let head = 0; head < queue.length; head++) {
    const u = queue[head];
    for (const v of undirected.get(u)!) {
      if (dist.get(v)! < 0) {
        dist.set(v, dist.get(u)! + 1);
        queue.push(v);
      }
    }
  }
  return dist;
}

/**
 * 图直径路径（"脊柱"）——确定性：端点取 id 序最小的最远对，回溯时父指针取 id 序最小前驱。
 * 非连通图取任一分量内的最长测地线（analyzeMap 的 allReachable 会另行报不连通，这里不重复报错）。
 * 纯函数·O(N·(N+E))·N 是十几到几十的量级，回归里扫几千张图也不慢。
 */
function diameterPath(ids: string[], undirected: Map<string, Set<string>>): string[] {
  const sorted = [...ids].sort();
  let bestLen = -1;
  let bestFrom = '';
  let bestTo = '';
  for (const u of sorted) {
    const dist = bfsHops(sorted, undirected, u);
    for (const v of sorted) {
      const d = dist.get(v)!;
      if (d > bestLen) {
        bestLen = d;
        bestFrom = u;
        bestTo = v;
      }
    }
  }
  if (bestLen < 0) return [];
  const dist = bfsHops(sorted, undirected, bestFrom);
  const path = [bestTo];
  let cur = bestTo;
  while (cur !== bestFrom) {
    let prev: string | undefined;
    for (const nb of [...undirected.get(cur)!].sort()) {
      if (dist.get(nb) === dist.get(cur)! - 1) {
        prev = nb;
        break;
      }
    }
    if (prev === undefined) break; // 理论不可达（BFS 树保证有前驱）；防御式退出
    path.push(prev);
    cur = prev;
  }
  return path.reverse();
}

/** 挖掉脊柱节点后剩余各连通块的大小（= 每条离脊分支的节点数）。 */
function offSpineBranchSizes(ids: string[], undirected: Map<string, Set<string>>, spine: string[]): number[] {
  const onSpine = new Set(spine);
  const seen = new Set<string>();
  const sizes: number[] = [];
  for (const id of [...ids].sort()) {
    if (onSpine.has(id) || seen.has(id)) continue;
    let size = 0;
    const stack = [id];
    seen.add(id);
    while (stack.length) {
      const u = stack.pop()!;
      size++;
      for (const v of undirected.get(u)!) {
        if (onSpine.has(v) || seen.has(v)) continue;
        seen.add(v);
        stack.push(v);
      }
    }
    sizes.push(size);
  }
  return sizes;
}

/** 分析一张 DiveMap 的结构性质（拓扑无关，层状/迷路都能跑） */
export function analyzeMap(map: DiveMap): MapAnalysis {
  const ids = Object.keys(map.nodes);
  const nodeCount = ids.length;

  // 无向邻接 + 对称性检查
  const undirected = new Map<string, Set<string>>();
  for (const id of ids) undirected.set(id, new Set());
  let isUndirected = true;
  for (const id of ids) {
    for (const to of map.nodes[id].connectsTo) {
      if (!map.nodes[to]) continue;
      undirected.get(id)!.add(to);
      undirected.get(to)!.add(id);
      // 对称性：to 是否也连回 id
      if (!map.nodes[to].connectsTo.includes(id)) isUndirected = false;
    }
  }
  let edgeCount = 0;
  for (const id of ids) edgeCount += undirected.get(id)!.size;
  edgeCount = edgeCount / 2;

  // 从起点沿 connectsTo（有向）可达
  const reachable = new Set<string>();
  {
    const stack = [map.startNodeId];
    while (stack.length) {
      const u = stack.pop()!;
      if (reachable.has(u) || !map.nodes[u]) continue;
      reachable.add(u);
      for (const v of map.nodes[u].connectsTo) if (!reachable.has(v)) stack.push(v);
    }
  }

  // 无向连通分量数（算环秩）
  let components = 0;
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) continue;
    components++;
    const stack = [id];
    while (stack.length) {
      const u = stack.pop()!;
      if (seen.has(u)) continue;
      seen.add(u);
      for (const v of undirected.get(u)!) if (!seen.has(v)) stack.push(v);
    }
  }
  const cycleRank = edgeCount - nodeCount + components;

  // 脊柱（直径路径）+ 离脊分支——「一条线走到底」的量化判据（scripts/playthrough-mapshape.ts 门与
  // dev 面板共用本处派生·别在门脚本里另写一套图论）。
  const spine = diameterPath(ids, undirected);
  const branchSizes = offSpineBranchSizes(ids, undirected, spine);

  // 死路（degree 1 非 ascent_point）
  const deadEndIds: string[] = [];
  for (const id of ids) {
    if (undirected.get(id)!.size === 1 && map.nodes[id].kind !== 'ascent_point') {
      deadEndIds.push(id);
    }
  }

  // 深度极值 + 剖面形状信号
  let maxDepth = -Infinity;
  let minDepth = Infinity;
  for (const id of ids) {
    maxDepth = Math.max(maxDepth, map.nodes[id].depth);
    minDepth = Math.min(minDepth, map.nodes[id].depth);
  }
  const span = maxDepth - minDepth;
  const meanDepthFrac =
    span <= 0 || ids.length === 0
      ? 0
      : ids.reduce((s, id) => s + (map.nodes[id].depth - minDepth), 0) / (ids.length * span);
  const deepestNodeIds = ids.filter((id) => map.nodes[id].depth === maxDepth);
  const localMaximaIds = ids.filter((id) => {
    const nbs = undirected.get(id)!;
    if (nbs.size === 0) return false;
    const d = map.nodes[id].depth;
    for (const nb of nbs) if (map.nodes[nb].depth > d) return false;
    return true;
  });

  // ascent points + 可达性
  const ascentPointIds = ids.filter((id) => map.nodes[id].kind === 'ascent_point');
  const reachableAscent = ascentPointIds.filter((id) => reachable.has(id));

  return {
    nodeCount,
    edgeCount,
    reachableCount: reachable.size,
    allReachable: reachable.size === nodeCount,
    isUndirected,
    deadEndIds,
    hasDeadEnd: deadEndIds.length > 0,
    cycleRank,
    hasCycle: cycleRank > 0,
    spineNodeCount: spine.length,
    spineRatio: nodeCount === 0 ? 0 : spine.length / nodeCount,
    maxOffSpineBranch: branchSizes.length === 0 ? 0 : Math.max(...branchSizes),
    offSpineBranchCount: branchSizes.length,
    maxDepth,
    meanDepthFrac,
    deepestNodeIds,
    localMaximaIds,
    ascentPointIds,
    reachableAscentCount: reachableAscent.length,
    allAscentReachable: reachableAscent.length === ascentPointIds.length,
    entranceIsAscent: map.nodes[map.startNodeId]?.kind === 'ascent_point',
    startNodeId: map.startNodeId,
  };
}
