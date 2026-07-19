// 节点图 → 2D 布局推导（共享纯函数·**渲染单一来源**）。
//
// DiveNode 不存 2D 坐标（types/dive.ts §6.1），但多处要把节点图画成图：
//   - ui/dev/SonarMapView（dev 声呐全图预览·原 MapDevPanel·2026-07-19 删并入）
//   - ui/SonarScanPanel（声呐探索图，声呐与房间 SPEC §5/§7 S0）
// 这两处此前各自铺点会漂移，故抽成一处：单一来源（深水区 SPEC §13「位置即深度」系统不变量）。
//
// 布局风格（LayoutStyle·见 types/dive.ts + docs/spec/深海回响_地图渲染补全_SPEC.md）：
//   渲染层是「形状」的唯一瓶颈——同一张拓扑图按不同 style 铺成不同形状。style 由 map.layoutStyle（mapgen 盖章）决定，
//   `opts.layoutStyle` 仍可临时覆盖（纯渲染·当前无 UI 暴露——MapDevPanel 已撤「换形状」下拉·2026-06-27/#229）。**'vertical' 是默认且逐字节复现旧图**（所有不声明的 zone/旧图走这条）。
//   - vertical：纵轴＝真实深度（#92·上浅下深·y∝depth）·横轴＝同深兄弟摊开（x 无方向语义·纯避重叠）。
//   - horizontal：进洞树距(layer)→横轴（进来多远＝主压力轴）·深度退成纵向弱带（配 orientation='horizontal'）。
//   - serpentine：层按行蛇形折返（盘绕·难辨来路）。
//   - radial：层按同心环（蜂巢/塌陷火口/月池·圆形大洞·入口居中）。
//   - spiral：层沿外旋臂（下旋甬道·迷向）。
//
// 注：只决定**几何**（在哪画），不决定**可见性**（画不画）——可见性由各 consumer 决定
// （SonarMapView 全画；SonarScanPanel 只画已被声呐扫到的、且按余像渐隐）。
// 确定性：只依赖 map 结构 + node.depth + id 排序（+ 按 id 派生的 jitter/角度），不碰 RNG（守同地同图 #98/#100）。

import type { DiveMap, DiveNode, LayoutStyle } from '@/types';

export interface MapLayout {
  /** nodeId → 画布坐标（vertical 下 y∝真实深度·上浅下深；其它 style 见各自策略） */
  pos: Record<string, { x: number; y: number }>;
  /** 无向去重边；chord = 跨层/同层（回边近似），便于 consumer 区分主干与绕回 */
  edges: Array<{ a: string; b: string; chord: boolean }>;
  width: number;
  height: number;
  /** 建议节点半径（consumer 可自取） */
  r: number;
}

export interface MapLayoutOpts {
  /** 每米深度对应的纵向像素（vertical 主轴·横向时退为弱带）。取 > blip 直径以免相邻整数米纵向重叠。 */
  pxPerMeter?: number;
  /** 同深度/同层并列节点的横向间距（取 > blip 直径以免重叠）。 */
  colW?: number;
  padX?: number;
  padY?: number;
  r?: number;
  /** 覆盖 map.layoutStyle（纯渲染·缺省走 map 盖章的 style；MapDevPanel 已撤「换形状」下拉·#229·当前无 consumer 用此覆盖）。 */
  layoutStyle?: LayoutStyle;
}

// 默认值（#92 垂直化）：纵轴固定 pxPerMeter、横轴 colW 同深分散。
// pxPerMeter(20) > 最大 blip 直径（声呐房间 r10 → 20）→ 相邻整数米节点纵向不叠；colW(34) > 直径 → 同深并列不叠。
const DEFAULTS: Required<Omit<MapLayoutOpts, 'layoutStyle'>> = { pxPerMeter: 20, colW: 34, padX: 30, padY: 24, r: 8 };

/** 确定性小 hash → [0,1)（按 node id 派生 jitter/角度·FNV-1a·守同地同图·不碰 RNG）。 */
function h01(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return (h >>> 8) / (1 << 24);
}

/** 几何上下文（各 style 共用的派生量）。 */
interface Geom {
  pxPerMeter: number;
  colW: number;
  padX: number;
  padY: number;
  dMin: number;
  dMax: number;
  maxConcurrent: number;
  maxLayer: number;
}
type Built = { pos: Record<string, { x: number; y: number }>; width: number; height: number };

/**
 * 把任意原始坐标平移到 [pad, ·] 并按实际包围盒定画布尺寸——**保证所有节点落在 [0,width]×[0,height] 内**
 * （非竖向策略共用·免每个策略各算尺寸出错·dev 全图画布据此不裁切）。vertical 不走这条（保持逐字节旧值）。
 */
function normalize(raw: Record<string, { x: number; y: number }>, padX: number, padY: number): Built {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const id in raw) {
    const p = raw[id];
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  if (!Number.isFinite(minX)) return { pos: {}, width: padX * 2, height: padY * 2 };
  const pos: Record<string, { x: number; y: number }> = {};
  for (const id in raw) pos[id] = { x: raw[id].x - minX + padX, y: raw[id].y - minY + padY };
  return { pos, width: maxX - minX + padX * 2, height: maxY - minY + padY * 2 };
}

/**
 * 把一张 DiveMap 铺成 2D 布局。确定性（只依赖 map 结构 + node.depth + id 排序 + id 派生 jitter，不碰 RNG）。
 * style 取 opts.layoutStyle ?? map.layoutStyle ?? 'vertical'。
 */
export function deriveMapLayout(map: DiveMap, opts?: MapLayoutOpts): MapLayout {
  const { pxPerMeter, colW, padX, padY, r } = { ...DEFAULTS, ...opts };
  const style: LayoutStyle = opts?.layoutStyle ?? map.layoutStyle ?? 'vertical';
  const nodes = Object.values(map.nodes);

  // 深度范围（vertical 纵轴基准；最浅 = 顶）。空图兜底到 0。
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

  // 按**到入口的树距（node.layer）**分组并列——保留洞穴的分叉形状（#98 修 #92：按 layer 分组而非按 depth 分箱）。
  // 组内按 id 稳定排序（确定性）；maxConcurrent = 最宽并列数；maxLayer = 最大树距。
  const byLayer = new Map<number, DiveNode[]>();
  for (const n of nodes) {
    if (!byLayer.has(n.layer)) byLayer.set(n.layer, []);
    byLayer.get(n.layer)!.push(n);
  }
  let maxConcurrent = 1;
  let maxLayer = 0;
  for (const [lay, col] of byLayer) {
    col.sort((a, b) => a.id.localeCompare(b.id));
    maxConcurrent = Math.max(maxConcurrent, col.length);
    maxLayer = Math.max(maxLayer, lay);
  }

  const g: Geom = { pxPerMeter, colW, padX, padY, dMin, dMax, maxConcurrent, maxLayer };
  let built: Built;
  switch (style) {
    case 'horizontal':
      built = layoutHorizontal(byLayer, g);
      break;
    case 'serpentine':
      built = layoutSerpentine(byLayer, g);
      break;
    case 'warren':
      built = layoutWarren(byLayer, g);
      break;
    case 'vertical':
    default:
      built = layoutVertical(byLayer, g);
      break;
  }
  const { pos, width, height } = built;

  // 左右手性（#100 确定性·按图内容派生·约一半朝左一半朝右·**只镜像 X·Y=真实深度不动**）——
  // 别让所有洞都朝一个方向（作者 2026-06-27「都往右」）。同一张图永远同一手性（同地同图不变）。
  const handKey = nodes.reduce((s, n) => s + n.depth * 7 + n.layer * 3 + n.id.length, 0);
  if (style !== 'warren' && h01('hand:' + handKey) < 0.5) {
    for (const id in pos) pos[id] = { x: width - pos[id].x, y: pos[id].y };
  }

  // 边（无向去重）：跨层/同层差 ≠ 1 视作回边（chord）。layer 仍是「到入口树距」＝主干结构序，
  // 故 chord 仍标出绕回/回边（与 style 无关·consumer 据此差异化/淡化·深水区 SPEC §13）。
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

// ============================================================
// 布局策略（确定性纯函数·各返回 pos + 画布尺寸·尺寸须包住所有 pos）
// ============================================================

/**
 * vertical（默认·**逐字节复现旧图**）：纵轴 y∝真实深度（上浅下深），横轴各 layer 组共用中线、组内对称排开。
 * 同 layer 因 depth jitter 各在略不同纵位＝略错落的一排；x 无深度方向语义（纯避重叠）。
 */
function layoutVertical(byLayer: Map<number, DiveNode[]>, g: Geom): Built {
  const centerX = g.padX + ((g.maxConcurrent - 1) * g.colW) / 2;
  const pos: Record<string, { x: number; y: number }> = {};
  for (const col of byLayer.values()) {
    col.forEach((n, j) => {
      const x = centerX + (j - (col.length - 1) / 2) * g.colW;
      const y = g.padY + (n.depth - g.dMin) * g.pxPerMeter; // 上＝浅（小 depth → 小 y）/ 下＝深
      pos[n.id] = { x, y };
    });
  }
  const width = g.padX * 2 + (g.maxConcurrent - 1) * g.colW;
  const height = g.padY * 2 + (g.dMax - g.dMin) * g.pxPerMeter;
  return { pos, width, height };
}

/**
 * horizontal：进洞树距(layer)→横轴＝「进来多远」主压力轴；深度退成纵向弱带 + 同层兄弟纵向分隔。
 * 配 orientation='horizontal'（深度锁带·#176）＝图横着长、深度只是带状微动。
 */
function layoutHorizontal(byLayer: Map<number, DiveNode[]>, g: Geom): Built {
  // y＝真实深度（#92「位置即深度」·上浅下深·与 vertical 同一条 y 公式·**绝不脱钩**——
  // 作者 2026-06-27「节点深度要和视觉深度吻合」）；x＝进洞树距(layer)·把图铺宽。
  // 仅当深度锁在窄带(orientation:horizontal)时才呈横向条带；深度随距离爬升的洞用这个会**如实**呈斜向
  // （那种洞本就不该用横向布局——斜是诚实的，不是 bug）。
  const stepX = g.colW * 1.6;
  const pos: Record<string, { x: number; y: number }> = {};
  for (const col of byLayer.values()) {
    const baseX = g.padX + (col[0]?.layer ?? 0) * stepX;
    col.forEach((n, j) => {
      const xo = (j - (col.length - 1) / 2) * (g.colW * 0.45); // 同层兄弟仅微 x 错开·不动 y(=深度)
      pos[n.id] = { x: baseX + xo, y: g.padY + (n.depth - g.dMin) * g.pxPerMeter };
    });
  }
  return normalize(pos, g.padX, g.padY);
}

/**
 * serpentine：层按 cols 个一行蛇形折返（奇数行反向）＝盘绕长廊；同层兄弟在落点附近按 id 抖开。
 */
function layoutSerpentine(byLayer: Map<number, DiveNode[]>, g: Geom): Built {
  // Y＝真实深度（#92·**不脱钩**）；X 随深度三角波左右折返＝下行 switchback 蛇形（横→下降→反向横…）。
  // 作者 2026-06-27 厘清：蛇行 ≠ 把深度塞进折返行；是「深度照常下行、水平方向来回摆」——故 Y 仍是真实深度。
  const span = Math.max(1, g.dMax - g.dMin);
  const folds = Math.max(2, Math.round(span / 18)); // ≈每下降 18m 折返一次（随深度跨度自适应）
  const amp = g.colW * 3.2; // 横向折返幅度
  const tri = (p: number) => { const q = ((p % 1) + 1) % 1; return q < 0.5 ? q * 4 - 1 : 3 - q * 4; }; // -1..1 三角波
  const pos: Record<string, { x: number; y: number }> = {};
  for (const col of byLayer.values()) {
    col.forEach((n, j) => {
      const dn = (n.depth - g.dMin) / span;
      const x = g.padX + amp + tri(dn * folds) * amp + (j - (col.length - 1) / 2) * (g.colW * 0.4);
      const y = g.padY + (n.depth - g.dMin) * g.pxPerMeter; // = 真实深度
      pos[n.id] = { x, y };
    });
  }
  return normalize(pos, g.padX, g.padY);
}

/**
 * warren（蜂群巢·SPEC §8·三卵室三角）——**横版·刻意破 #92**（作者 2026-07-09·仅 zone.warren·QUIRKS #240）：
 * y 不再＝深度（其它 zone 仍守 #92）。核心 13 点（洞口/两段接近/三甬道/三气穴/三卵室）按**固定角色锚位**摆成作者 mock
 * 「洞口左·下切·三卵室错落摊右」；卵室间距拉大＝声呐里三卵室分明不熔（配 roomRadius 卵室统一放大）。
 * **侧死路（`w.b*`·degree-1·挂 app1/app2/卵室·数量随 seed 变）**：逐个放到「离宿主最近的**空位**」——连得上宿主（画隧道），
 * 但与**任何非相邻房间**保持 ≥ 分离阈值（`minSep`＝两房半径 + 熔并余量），**保证不出现「无墙却不连通」的假通路**（作者要求·守玩法诚实）。
 * 单位＝colW（随声呐/节点图各自比例缩放）。
 */
function layoutWarren(byLayer: Map<number, DiveNode[]>, g: Geom): Built {
  const u = g.colW;
  const ROLE: Record<string, [number, number]> = {
    'w.entrance': [1, -4], 'w.app1': [1.5, 0], 'w.app2': [4, 0.5],
    'w.mid.ab': [7.5, -2.5], 'w.mid.ca': [7.5, 3], 'w.mid.bc': [16.5, 0],
    'w.air.ab': [8.5, -5], 'w.air.ca': [8.5, 5.5], 'w.air.bc': [18, 0],
    'w.chamber.a': [11, 0], 'w.chamber.b': [14, -4.5], 'w.chamber.c': [14, 4.5],
  };
  const all = [...byLayer.values()].flat();
  const adj: Record<string, Set<string>> = {};
  for (const n of all) adj[n.id] = new Set(n.connectsTo);
  const linked = (a: string, b: string) => !!(adj[a]?.has(b) || adj[b]?.has(a));
  // 分离阈值（colW 单位·保守 ≥ 真实 smin 合并距离≈两房半径+WARP*2+SMIN）：非相邻房间间距须 ≥ 此值＝不熔。
  const rrU = (id: string) => (id.startsWith('w.chamber.') ? 1.9 : 1.15);
  const MARGIN = 1.5;
  const minSep = (a: string, b: string) => rrU(a) + rrU(b) + MARGIN;
  const pos: Record<string, { x: number; y: number }> = {};
  for (const n of all) if (ROLE[n.id]) pos[n.id] = { x: ROLE[n.id][0], y: ROLE[n.id][1] };
  let cx0 = 0, cy0 = 0, nc = 0;
  for (const id in pos) { cx0 += pos[id].x; cy0 += pos[id].y; nc++; }
  cx0 /= nc || 1; cy0 /= nc || 1;
  // 点到线段距离（查叶子→宿主的隧道是否会穿过非相邻房间）。
  const segDist = (px: number, py: number, ax: number, ay: number, bx: number, by: number) => {
    const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
    let t = L2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / L2 : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  };
  const TUN = 0.2; // 隧道半宽(u)+余
  const leaves = all.filter((n) => !ROLE[n.id]).sort((a, b) => a.id.localeCompare(b.id));
  const RADII = [2.4, 3.0, 3.7, 4.5, 5.4, 6.5, 7.8, 9.2];
  for (const leaf of leaves) {
    const host = [...(adj[leaf.id] ?? [])].find((h) => pos[h]) ?? 'w.app2';
    const hp = pos[host] ?? { x: 4, y: 0.5 };
    const baseAng = Math.atan2(hp.y - cy0, hp.x - cx0); // 质心→宿主＝往外甩
    const nonAdj = Object.keys(pos).filter((id) => id !== host && !linked(leaf.id, id));
    const pEdges: Array<[string, string]> = []; // 已放节点间的边（核心隧道·别让叶子房间压上去）
    for (const u in pos) for (const v of adj[u] ?? []) if (pos[v] && u < v) pEdges.push([u, v]);
    let placed: { x: number; y: number } | null = null;
    let fb: { x: number; y: number } | null = null, fbScore = -Infinity;
    outer: for (const R of RADII) {
      for (let s = 0; s < 24; s++) {
        const ang = baseAng + (s % 2 === 0 ? 1 : -1) * Math.ceil(s / 2) * (Math.PI / 12);
        const c = { x: hp.x + Math.cos(ang) * R, y: hp.y + Math.sin(ang) * R };
        let score = Infinity;
        for (const id2 of nonAdj) {
          const p2 = pos[id2];
          const roomClr = Math.hypot(c.x - p2.x, c.y - p2.y) - minSep(leaf.id, id2);
          const tunClr = segDist(p2.x, p2.y, hp.x, hp.y, c.x, c.y) - (rrU(id2) + TUN + MARGIN);
          score = Math.min(score, roomClr, tunClr);
        }
        for (const [eu, ev] of pEdges) {
          if (linked(leaf.id, eu) || linked(leaf.id, ev)) continue;
          const ed = segDist(c.x, c.y, pos[eu].x, pos[eu].y, pos[ev].x, pos[ev].y);
          score = Math.min(score, ed - (rrU(leaf.id) + TUN + MARGIN));
        }
        if (score >= 0) { placed = c; break outer; } // 最近的「房间+隧道都不撞」空位
        if (score > fbScore) { fbScore = score; fb = c; }
      }
    }
    pos[leaf.id] = placed ?? fb ?? { x: hp.x, y: hp.y + 5.4 };
  }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const id in pos) { minX = Math.min(minX, pos[id].x); maxX = Math.max(maxX, pos[id].x); minY = Math.min(minY, pos[id].y); maxY = Math.max(maxY, pos[id].y); }
  const out: Record<string, { x: number; y: number }> = {};
  for (const id in pos) out[id] = { x: g.padX + (pos[id].x - minX) * u, y: g.padY + (pos[id].y - minY) * u };
  return { pos: out, width: g.padX * 2 + (maxX - minX) * u, height: g.padY * 2 + (maxY - minY) * u };
}
