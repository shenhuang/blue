// 节点图 → 2D 布局推导（共享纯函数）。
//
// DiveNode 不存 2D 坐标（types/dive.ts §6.1），但多处要把节点图画成图：
//   - ui/dev/MapDevPanel（mapgen 调试器）
//   - ui/SonarScanPanel（声呐探索图，声呐与房间 SPEC §5/§7 S0）
// 这两处此前各自铺点会漂移，故抽成一处：按 layer 分列（列 = 到入口的树距）、列内按 id 堆叠，
// 无向去重连边（跨层/同层 = 回边近似）。纯函数、零 React 依赖 → 既给 UI 用、也能在回归脚本里断言。
//
// 注：只决定**几何**（在哪画），不决定**可见性**（画不画）——可见性由各 consumer 决定
// （MapDevPanel 全画；SonarScanPanel 只画已被声呐扫到的、且按余像渐隐）。

import type { DiveMap, DiveNode } from '@/types';

export interface MapLayout {
  /** nodeId → 画布坐标 */
  pos: Record<string, { x: number; y: number }>;
  /** 无向去重边；chord = 跨层/同层（回边近似），便于 consumer 区分主干与绕回 */
  edges: Array<{ a: string; b: string; chord: boolean }>;
  width: number;
  height: number;
  /** 建议节点半径（consumer 可自取） */
  r: number;
}

export interface MapLayoutOpts {
  colW?: number;
  rowH?: number;
  padX?: number;
  padY?: number;
  r?: number;
}

// 默认间距沿用 MapDevPanel 的历史取值（抽取前它内联在面板里），保证调试器观感不变。
const DEFAULTS: Required<MapLayoutOpts> = { colW: 116, rowH: 64, padX: 44, padY: 40, r: 17 };

/**
 * 把一张 DiveMap 铺成 2D 布局。确定性（只依赖 map 结构 + id 排序，不碰 RNG）。
 */
export function deriveMapLayout(map: DiveMap, opts?: MapLayoutOpts): MapLayout {
  const { colW, rowH, padX, padY, r } = { ...DEFAULTS, ...opts };
  const nodes = Object.values(map.nodes);

  // 按 layer 分列，列内按 id 稳定排序
  const byLayer = new Map<number, DiveNode[]>();
  for (const n of nodes) {
    if (!byLayer.has(n.layer)) byLayer.set(n.layer, []);
    byLayer.get(n.layer)!.push(n);
  }
  const layers = [...byLayer.keys()].sort((a, b) => a - b);
  for (const l of layers) byLayer.get(l)!.sort((a, b) => a.id.localeCompare(b.id));

  const pos: Record<string, { x: number; y: number }> = {};
  let maxRows = 1;
  layers.forEach((l, ci) => {
    const col = byLayer.get(l)!;
    maxRows = Math.max(maxRows, col.length);
    col.forEach((n, ri) => {
      pos[n.id] = { x: padX + ci * colW, y: padY + ri * rowH };
    });
  });
  const width = padX * 2 + Math.max(1, layers.length - 1) * colW;
  const height = padY * 2 + Math.max(0, maxRows - 1) * rowH;

  // 边（无向去重）：跨层/同层差 ≠ 1 视作回边（chord）
  const edges: Array<{ a: string; b: string; chord: boolean }> = [];
  const seen = new Set<string>();
  for (const n of nodes) {
    for (const to of n.connectsTo) {
      if (!map.nodes[to]) continue;
      const key = n.id < to ? `${n.id}|${to}` : `${to}|${n.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const layerDiff = Math.abs(map.nodes[n.id].layer - map.nodes[to].layer);
      edges.push({ a: n.id, b: to, chord: layerDiff !== 1 });
    }
  }

  return { pos, edges, width, height, r };
}
