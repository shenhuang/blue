// 图上跳数（无权最短路）——单一真相
//
// 为什么是 BFS 而不是「邻居最高热度 −1」的不动点迭代：每条边恒减 1 ⇒ 「最高邻居 −1」的不动点
// 恰是「到源点的最短跳数」的对偶。而无权图的最短跳数**不需要迭代到收敛**——BFS 按跳数非降序访问，
// 第一次碰到某节点时拿到的就是它的最小 dist，不会再被更新。松弛到不动点最坏 O(V·E)；BFS 一趟 O(V+E)，
// 结果完全一样（作者 2026-07-08 讨论）。
//
// **别把「热度」当作要传播的量**：传播的是 `dist`，热度/密度只是它的一个纯函数（查表·见 warren-hunt.ts）。
// 这样 f 怎么改都不碰遍历，遍历也能被别处直接复用。
//
// 泛化（都在同一趟里）：多热源 → 把所有源一起入队（多源 BFS·仍 O(V+E)）；源初始值不等 → 按偏移入桶队列；
// 边有代价 → 那才升级成 Dijkstra O(E log V)（目前边全等权·用不上）。
//
// **无向语义**：邻接按无向算（layered 图的 connectsTo 是单向的，warren/maze 是双向的）。声呐
// （sonar.ts::revealSonarScan）特意也用无向（「照得到你来时的上游」），两者是同一个「图上跳数」概念。
// 声呐那份暂不动（已测机制·不为了漂亮去撕），将来可表达成本函数的一次射程过滤。

import type { DiveMap } from '@/types';

/** 无向邻接表（connectsTo 两端都登记·与 sonar/mapLayout 同口径）。 */
function undirectedAdj(map: DiveMap): Record<string, string[]> {
  const adj: Record<string, string[]> = {};
  const add = (a: string, b: string) => {
    (adj[a] ??= []).push(b);
  };
  for (const id of Object.keys(map.nodes)) adj[id] ??= [];
  for (const [id, n] of Object.entries(map.nodes)) {
    for (const v of n.connectsTo) {
      if (!map.nodes[v]) continue; // 悬挂边防御
      add(id, v);
      add(v, id);
    }
  }
  return adj;
}

/**
 * 从 `sources`（一个或多个源点）出发的无向 BFS 跳数场：`nodeId → 到最近源点的跳数`。
 * 源点自身 = 0。不可达节点**不出现在结果里**（调用方用 `?? Infinity` 或视作「够远」兜底）。
 * 纯函数·零 RNG·O(V+E)。`maxHops` 给定时提前截断（省遍历·超出者不出现）。
 */
export function hopField(map: DiveMap, sources: string[], maxHops?: number): Record<string, number> {
  const adj = undirectedAdj(map);
  const dist: Record<string, number> = {};
  const queue: string[] = [];
  for (const s of sources) {
    if (!map.nodes[s] || dist[s] !== undefined) continue;
    dist[s] = 0;
    queue.push(s);
  }
  for (let head = 0; head < queue.length; head++) {
    const u = queue[head];
    const du = dist[u];
    if (maxHops !== undefined && du >= maxHops) continue;
    for (const v of adj[u] ?? []) {
      if (dist[v] !== undefined) continue;
      dist[v] = du + 1;
      queue.push(v);
    }
  }
  return dist;
}
