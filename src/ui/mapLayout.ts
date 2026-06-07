// 节点图 → 2D 布局推导（共享纯函数）。
//
// DiveNode 不存 2D 坐标（types/dive.ts §6.1），但多处要把节点图画成图：
//   - ui/dev/MapDevPanel（mapgen 调试器）
//   - ui/SonarScanPanel（声呐探索图，声呐与房间 SPEC §5/§7 S0）
// 这两处此前各自铺点会漂移，故抽成一处：单一来源（深水区 SPEC §13「位置即深度」系统不变量）。
//
// 纵轴＝真实深度（#92·上＝浅 / 下＝深·真实米数·符合下潜剧情）：y ∝ node.depth，固定每米像素比例（pxPerMeter）
//   → 声呐取景窗里「上浅下深」绝对一致、深图更长无妨（取景窗本就只看附近一片；dev 面板要看整张则纵向可滚）。
// 横轴＝同深度并列分散：按 depth 分箱、箱内按 id 稳定排开、各箱共用中线居中对齐（x **无方向语义**·纯避重叠）。
// 边可上可下（朝浅＝朝上＝truthful·迷路回边天然朝上）；chord＝跨层回边近似，consumer 据此差异化/淡化。
//
// 注：只决定**几何**（在哪画），不决定**可见性**（画不画）——可见性由各 consumer 决定
// （MapDevPanel 全画；SonarScanPanel 只画已被声呐扫到的、且按余像渐隐）。
// 不重叠护栏：pxPerMeter 取得 > 单个 blip 直径 → 相邻整数米的节点纵向不叠；colW > 直径 → 同深并列不叠。

import type { DiveMap, DiveNode } from '@/types';

export interface MapLayout {
  /** nodeId → 画布坐标（y ∝ 真实深度·上浅下深） */
  pos: Record<string, { x: number; y: number }>;
  /** 无向去重边；chord = 跨层/同层（回边近似），便于 consumer 区分主干与绕回 */
  edges: Array<{ a: string; b: string; chord: boolean }>;
  width: number;
  height: number;
  /** 建议节点半径（consumer 可自取） */
  r: number;
}

export interface MapLayoutOpts {
  /** 每米深度对应的纵向像素（固定比例·上浅下深）。取 > blip 直径以免相邻整数米纵向重叠。 */
  pxPerMeter?: number;
  /** 同深度并列节点的横向间距（取 > blip 直径以免同深重叠）。 */
  colW?: number;
  padX?: number;
  padY?: number;
  r?: number;
}

// 默认值（#92 垂直化）：纵轴固定 pxPerMeter、横轴 colW 同深分散。
// pxPerMeter(20) > 最大 blip 直径（声呐房间 r10 → 20）→ 相邻整数米节点纵向不叠；colW(34) > 直径 → 同深并列不叠。
// 深图更长无妨（声呐取景窗只看附近一片；dev 面板自然尺寸渲染、纵向可滚）。
const DEFAULTS: Required<MapLayoutOpts> = { pxPerMeter: 20, colW: 34, padX: 30, padY: 24, r: 8 };

/**
 * 把一张 DiveMap 铺成 2D 布局。确定性（只依赖 map 结构 + node.depth + id 排序，不碰 RNG）。
 * y ∝ node.depth（上浅下深·真实米数）；x = 同深度内按 id 居中排开（无方向语义·纯避重叠）。
 */
export function deriveMapLayout(map: DiveMap, opts?: MapLayoutOpts): MapLayout {
  const { pxPerMeter, colW, padX, padY, r } = { ...DEFAULTS, ...opts };
  const nodes = Object.values(map.nodes);

  // 深度范围（上浅下深纵轴的基准；最浅 = 顶）。空图兜底到 0。
  let dMin = Infinity;
  let dMax = -Infinity;
  for (const n of nodes) {
    if (n.depth < dMin) dMin = n.depth;
    if (n.depth > dMax) dMax = n.depth;
  }
  if (!Number.isFinite(dMin)) {
    dMin = 0;
    dMax = 0;
  }

  // 横向＝按**到入口的树距（node.layer）**分组并列——保留洞穴的分叉形状。
  // （#98 修 #92：#92 按真实 depth 分箱铺 x，但迷路图各 depth 多为单节点 → 每箱 1 个 → 全塌成一条竖线、丢了洞穴形状。
  //   改回按 layer 分组＝同一树距的并列通道横向铺开，恢复「大改前那张洞穴图」的分叉，唯一区别是纵轴换成真实深度＝垂直视角。
  //   层状（开阔水域）图 depth 与 layer 一一对应 → byLayer ≡ byDepth、行为不变；只迷路图受益。）
  const byLayer = new Map<number, DiveNode[]>();
  for (const n of nodes) {
    if (!byLayer.has(n.layer)) byLayer.set(n.layer, []);
    byLayer.get(n.layer)!.push(n);
  }
  let maxConcurrent = 1;
  for (const col of byLayer.values()) {
    col.sort((a, b) => a.id.localeCompare(b.id));
    maxConcurrent = Math.max(maxConcurrent, col.length);
  }

  // 横向：各 layer 组共用一条中线、组内对称排开 → 同树距的并列通道横向分散（保留分叉·x 无深度方向语义·深浅只由 y 表达）。
  // 纵向：y ∝ 真实深度（上浅下深），与 x 的 layer 分组正交——同一 layer 的节点因 jitter 各在略不同深度，故是略错落的一排。
  const centerX = padX + ((maxConcurrent - 1) * colW) / 2;
  const pos: Record<string, { x: number; y: number }> = {};
  for (const col of byLayer.values()) {
    col.forEach((n, j) => {
      const x = centerX + (j - (col.length - 1) / 2) * colW;
      const y = padY + (n.depth - dMin) * pxPerMeter; // 上＝浅（小 depth → 小 y）/ 下＝深
      pos[n.id] = { x, y };
    });
  }

  const width = padX * 2 + (maxConcurrent - 1) * colW;
  const height = padY * 2 + (dMax - dMin) * pxPerMeter;

  // 边（无向去重）：跨层/同层差 ≠ 1 视作回边（chord）。layer 仍是「到入口树距」＝主干结构序，
  // 故 chord 仍标出绕回/回边——垂直化后这些边天然朝上或横走，consumer 据此差异化/淡化（深水区 SPEC §13）。
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
