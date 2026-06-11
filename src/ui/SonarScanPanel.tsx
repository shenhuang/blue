// 声呐探索图（下潜内）—— 声呐渲染重做 SPEC（docs/spec/深海回响_声呐渲染重做_SPEC.md §2/§3/§4）。
//
// 重做：从「示意 node graph（圆点 + 连线）」改成**有机洞穴垂直剖面 + 雷达式扫描**（作者逐拍 demo 拍板·别再画连线）。
//   - 背景＝**真实侧剖洞穴**（canvas·作者验收 v3）：深色岩石里凿出蓝色水道（SDF 并集：边→弯折路由隧道 + 节点→主 blob+散瓣房间·**域扭曲**把直胶囊弯成蜿蜒水道+不规则岩壁·**smin 平滑并集**把相邻房间熔成大洞〔多 POI 同室〕·半分辨率提速）。图是**隐藏骨架**(节点图)的有机皮·连通＝开阔水域·**无连线**。
//   - 纵轴＝真实深度（#92 上浅下深·压短 pxPerMeter·作者要节点更近）；横向自由铺开（byLayer 分散·见 mapLayout.ts）。
//   - 雷达式揭示（canvas）：一记扫描＝从你当前位置扩散的亮前缘 + 淡化拖尾·墙/点随波前到达才点亮；旧图**保留到下次扫描**才刷新（不逐回合淡出·§4）。
//   - 节点显隐（防剧透 + 自由感·§2）：只对**可立即前往的相邻节点**（＝ NodeSelectView 的移动 choices）画**可点**标记（点击＝触发那条 move choice）；其余节点只显洞的几何、不标点。
//     POI 标记**偏心**落在房间内（不必正中·可贴洞壁·作者要求）+ 落点按节点语义（kind）相关：出口/气袋偏顶、休整偏底、事件贴壁（poiOffset）；再 voidTrack 跟随扭曲后的洞、不浮在岩里。点击仍触发同一条 move（偏移纯视觉）。
//   - 非洞穴场景（层状·沉船/礁）：先全黑只显节点占位（§2·留后续专属背景）。
//
// 纯渲染：canvas 在 useEffect 里画（SSR 不跑·只出空 canvas）；语义/可点标记走 SVG 覆盖层（SSR 可断言 + 可点 + 无障碍）。
// 欺骗/威胁仍是 clarity 单一来源（nodeSonarView/sonarPhantoms/threatContact·面板不加判定分支·§7/§10）；猎手位置 stalkerSonarBlip（§8.7 会过时·mid-edge 插值）。

import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import type { GameState, NodeChoice, RunState, SonarDir } from '@/types';
import { deriveMapLayout, type MapLayout } from './mapLayout';
import { moveToNode } from '@/engine/dive';
import { nodeSonarView, sonarPhantoms, threatContact } from '@/engine/clarity';
import { stalkerSonarBlip } from '@/engine/stalker';
import { hash01, roomScale01 } from '@/engine/sonar';
import { zoneAllowsBacktrack } from '@/engine/zones';

/** 纵向取景窗（窄×高·#92 上浅下深）：只显当前节点周围一片（SPEC「默认放大、几乎看不到全貌」）。 */
const VIEW_W = 220;
const VIEW_H = 300;
const VIEW_R = Math.min(VIEW_W, VIEW_H);
/** 缩放/平移（#2·作者 06-10）：z＝缩放（1=默认取景），dx/dy＝视野中心相对你的世界偏移。纯视图态·不入存档。 */
const ZOOM_MIN = 0.6;
const ZOOM_MAX = 2.5;
const PAN_MARGIN = 60; // 平移可越出布局边界的余量（世界单位·防飞出找不回·配「回正」按钮）
/** canvas 内部超采样（清晰度）；洞穴 SDF 在其半分辨率算（§2 半分辨率提速）。 */
const RENDER_SCALE = 2;
/** 声呐取景的布局比例：压短纵向（pxPerMeter 小·节点更近·§2）+ 同深横向铺开（colW·byLayer 见 mapLayout）。 */
export const SONAR_PX_PER_M = 13;
export const SONAR_COL_W = 32;
/**
 * 有机洞穴几何旋钮（世界单位·声呐渲染重做 §2「真实侧剖洞穴」作者验收 v3）。
 * 隧道＝按边路由的弯折胶囊链（宽度 CH_BASE..CH_BASE+CH_VAR）；房间＝主 blob + 散瓣（半径 ROOM_BASE..+ROOM_VAR）。
 * 域扭曲（domain warp）把直胶囊弯成蜿蜒水道 + 不规则岩壁；smin 平滑并集把相邻房间熔成一间大洞（多 POI 同室）。
 * 全部确定性纯函数（按 node/edge id 派生·同地点同洞·守洞穴一致性 quirk #100）；不入存档·不 bump SAVE_VERSION。
 * 这些是作者验收/调参旋钮（绿≠画对·quirk #91/#93·线上 ?dev 肉眼）。
 */
const CH_BASE = 4; // 隧道基础半宽（窄·蜿蜒）
const CH_VAR = 4; // 隧道半宽随边浮动
const ROOM_BASE = 13; // 房间基础半径
const ROOM_VAR = 20; // 房间半径随节点浮动（大小不一的洞室）
const WARP_AMP = 14; // 域扭曲幅度（越大越蜿蜒/越不规则）
const WARP_FREQ = 0.022; // 域扭曲频率
const SMIN_K = 7; // 平滑并集半径（越大越熔成一团·越小房间越分明）
const CTRL_OFF = 48; // 隧道弯折的最大垂向偏移
const WALL_LO = -2; // SDF < WALL_LO ＝水道内（蓝）
const WALL_HI = 2.2; // [WALL_LO, WALL_HI) ＝发光岩壁带（越大壁越厚）
/**
 * 雷达扫描扩散时长（ms）。作者 06-10 实测：1.2s + easeOut 前 0.3s 就掠过大半屏＝「根本没看到波」——
 * 放慢 + **线性前缘**（frame 里 eased=k·恒速）：SVG 标记「波到才亮」的延迟（dist/maxR×SWEEP_MS）可与波前精确同步。
 */
const SWEEP_MS = 2600;
/** 半揭示残段（#1「平时全黑」修正）：边只有一端被扫过 → 从已知端画一小截变窄的隧道口（房间的出口看得见、通向哪看不见·防剧透轴不破）。 */
const STUB_FRAC = 0.38; // 残段占该边路由总长的比例
const STUB_R_K = 0.72; // 残段半宽缩窄系数

/**
 * 面板自带的布局/动画 CSS（客户端注入 document.head·见 useEffect）。
 * **不走 JSX <style>**——那样 class 名会进 SSR 文本、污染 smoke 的子串断言（`!includes('sonar-stalker')` 会误中）。
 * 走 head 注入＝SSR 输出干净（只出结构），浏览器仍拿到样式。颜色用高特异性盖过 styles.css 通用 .sonar-stalker circle（quirk #91）。
 */
const CAVE_STYLE = `
@keyframes sonarBreath { 0%,100% { opacity: .55; } 50% { opacity: 1; } }
@keyframes sonarWaveIn { from { opacity: 0; } to { opacity: 1; } }
.sonar-scan-stack { position: relative; touch-action: none; }
.sonar-cave-canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; object-fit: contain; }
.sonar-overlay { position: absolute; inset: 0; width: 100%; height: 100%; }
.sonar-pulse { animation: sonarBreath 2.2s ease-in-out infinite; }
.sonar-node-marker { cursor: pointer; }
/* 「波到才亮」（#3·§3）：标记随扫描波前到达时刻淡入（delay 内联·与线性波前同步）。CSS 客户端注入＝SSR 输出元素照常在（smoke 断言不受影响）。 */
.sonar-wave-in { opacity: 0; animation: sonarWaveIn .4s ease-out forwards; }
/* 两段点击（#5）：图上选中高亮＝下方事件列表项 .event-option.is-pending 同款光边（规则同住此处＝单一来源·列表 DOM 在 NodeSelectView）。 */
.sonar-node-marker.is-pending circle { stroke: #eafffa; stroke-width: 2.2; filter: drop-shadow(0 0 5px rgba(140,255,235,.95)); }
.sonar-pending-ring { fill: none; stroke: #eafffa; stroke-width: 1.6; stroke-dasharray: 4 3; animation: sonarBreath 1.6s ease-in-out infinite; }
.event-option.is-pending { border-color: #7defdc; box-shadow: 0 0 0 1px #7defdc, 0 0 10px rgba(125, 239, 220, .45); }
.sonar-recenter { margin-left: auto; flex-shrink: 0; }
.sonar-you circle.sonar-you-core { fill: #4ed1c1; stroke: none; }
.sonar-you circle.sonar-you-ring { fill: none; stroke: #4ed1c1; stroke-width: 1.4; }
.sonar-stalker circle.sonar-stalker-core { fill: #ff5a5a; stroke: none; }
.sonar-stalker circle.sonar-stalker-ring { fill: none; stroke: #ff5a5a; stroke-width: 1.6; }
.sonar-stalker circle.sonar-stalker-mass { fill: #ff5a5a; stroke: none; opacity: .18; }
`;
const CAVE_STYLE_ID = 'sonar-cave-style';

const SONAR_DIR_LABEL: Record<string, string> = { deeper: '朝深处', lateral: '侧向', back: '来路' };

/** 定向聚焦扇区楔形（§5 可视化·与 y∝depth 一致：deeper↓/back↑/lateral 左右）。SVG y 朝下。纯几何·SSR 安全。 */
function focusWedgePath(cx: number, cy: number, r: number, dir: string): string {
  const H = 0.85;
  const slice = (a0: number, a1: number) => {
    const x0 = cx + r * Math.cos(a0);
    const y0 = cy + r * Math.sin(a0);
    const x1 = cx + r * Math.cos(a1);
    const y1 = cy + r * Math.sin(a1);
    return `M${cx.toFixed(1)} ${cy.toFixed(1)} L${x0.toFixed(1)} ${y0.toFixed(1)} A${r.toFixed(1)} ${r.toFixed(1)} 0 0 1 ${x1.toFixed(1)} ${y1.toFixed(1)} Z`;
  };
  if (dir === 'deeper') return slice(Math.PI / 2 - H, Math.PI / 2 + H);
  if (dir === 'back') return slice(-Math.PI / 2 - H, -Math.PI / 2 + H);
  return `${slice(-H, H)} ${slice(Math.PI - H, Math.PI + H)}`;
}

function kindClass(kind: string | undefined): string {
  switch (kind) {
    case 'ascent_point':
      return 'is-exit';
    case 'air_pocket':
      return 'is-air';
    case 'camp':
      return 'is-camp';
    default:
      return '';
  }
}
function kindGlyph(kind: string | undefined): string | null {
  switch (kind) {
    case 'ascent_point':
      return '↑';
    case 'air_pocket':
      return '○';
    case 'camp':
      return '⌂';
    default:
      return null;
  }
}

// ============================================================
// 有机洞穴场（确定性纯函数·canvas 用·也便于单测）
// ============================================================

/** 确定性 hash → [0,1)（值噪声用·不碰 RNG）。 */
function hash2(x: number, y: number): number {
  let h = (Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return (h % 1000) / 1000;
}
/** 平滑值噪声（双线性 + smoothstep）。 */
function vnoise(x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi);
  const b = hash2(xi + 1, yi);
  const c = hash2(xi, yi + 1);
  const d = hash2(xi + 1, yi + 1);
  return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
}
/** 分形叠加（不规则岩壁的有机感）。 */
function fbm(x: number, y: number): number {
  return 0.6 * vnoise(x, y) + 0.3 * vnoise(x * 2.1 + 11, y * 2.1 + 7) + 0.1 * vnoise(x * 4.3 + 3, y * 4.7 + 19);
}
/** 点到线段距离。 */
function distSeg(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

// hash01 迁居 engine/sonar.ts（猎手 §5「容得下多大」与渲染同源·顶部 import）——输出逐字相同。
/** 平滑最小值（多项式 smin）：把相邻形状熔成连续有机表面（相邻房间并成一间大洞·非硬交线）。 */
function smin(a: number, b: number, k: number): number {
  const h = Math.max(0, Math.min(1, 0.5 + (0.5 * (b - a)) / k));
  return a * h + b * (1 - h) - k * h * (1 - h);
}
/** 域扭曲向量（domain warp）：把直胶囊/圆房间弯成蜿蜒水道 + 不规则岩壁。确定性。 */
export function caveWarp(x: number, y: number): [number, number] {
  const wx = fbm(x * WARP_FREQ + 3.1, y * WARP_FREQ + 1.7) - 0.5;
  const wy = fbm(x * WARP_FREQ + 9.2, y * WARP_FREQ + 5.3) - 0.5;
  return [wx * WARP_AMP, wy * WARP_AMP];
}

/** 带半宽的隧道子段（弯折路由后的一节）。 */
export interface CaveTun { ax: number; ay: number; bx: number; by: number; r: number; }
/** 带半径的房间 blob（主 blob + 散瓣）。 */
export interface CaveRoom { x: number; y: number; r: number; }

/**
 * 房间半径（按 node id 派生·大小不一）。buildCaveGeometry 与 poiOffset 共用＝标记落在房间内。
 * 标度来自 engine/sonar.ts::roomScale01（猎手 §5：游戏性「容得下多大」与画出来的房间大小**同一来源**——
 * 你看到的最小那挡房间＝大型猎手钻不进的窄缝）。
 */
function roomRadius(id: string): number {
  return ROOM_BASE + ROOM_VAR * roomScale01(id);
}

/**
 * 有机洞穴剖面的「水/岩 SDF」：域扭曲后对隧道/房间取 smin 平滑并集 + 值噪声扰动。
 * < WALL_LO ＝水道内（蓝）；[WALL_LO,WALL_HI) ＝岩壁（发光交界）；≥ ＝岩石（暗）。确定性·纯函数（便于单测）。
 */
export function caveSdf(wx: number, wy: number, tuns: CaveTun[], rooms: CaveRoom[]): number {
  const [ox, oy] = caveWarp(wx, wy);
  const px = wx + ox;
  const py = wy + oy;
  let d = Infinity;
  let first = true;
  for (const t of tuns) {
    const dd = distSeg(px, py, t.ax, t.ay, t.bx, t.by) - t.r;
    d = first ? dd : smin(d, dd, SMIN_K);
    first = false;
  }
  for (const rm of rooms) {
    const dd = Math.hypot(px - rm.x, py - rm.y) - rm.r;
    d = first ? dd : smin(d, dd, SMIN_K);
    first = false;
  }
  return d + (fbm(px * 0.08, py * 0.08) - 0.5) * 3.5;
}

/**
 * 一条边的确定性弯折路由 + 半宽（**单一来源**·作者 06-11「红点出墙」修复的根）：
 * buildCaveGeometry 画隧道与猎手 blip 落点（stalkerRoutePoint）共用同一条折线——
 * 红点永远落在画出来的那条水道里，别再各写各的房心直线插值。
 * pts 顺序 = layout.edges 条目的 (a→b)：控制点偏移依赖建造方向，换向是另一条曲线，
 * 所以方向无关的读者必须经 edgeRoutePts 取向，不要自己重算。
 */
function routeForEdgeEntry(
  layout: MapLayout,
  e: { a: string; b: string },
): { pts: Array<{ x: number; y: number }>; r: number } | null {
  const pa = layout.pos[e.a];
  const pb = layout.pos[e.b];
  if (!pa || !pb) return null;
  const key = e.a < e.b ? `${e.a}|${e.b}` : `${e.b}|${e.a}`;
  const L = Math.hypot(pb.x - pa.x, pb.y - pa.y) || 1;
  const nx = -(pb.y - pa.y) / L;
  const ny = (pb.x - pa.x) / L;
  const nc = L < 50 ? 1 : 2;
  const pts: Array<{ x: number; y: number }> = [{ x: pa.x, y: pa.y }];
  for (let i = 1; i <= nc; i++) {
    const f = i / (nc + 1);
    const offv = (hash01(`${key}:${i}`) - 0.5) * Math.min(L * 0.5, CTRL_OFF);
    pts.push({ x: pa.x + (pb.x - pa.x) * f + nx * offv, y: pa.y + (pb.y - pa.y) * f + ny * offv });
  }
  pts.push({ x: pb.x, y: pb.y });
  return { pts, r: CH_BASE + CH_VAR * hash01('w' + key) };
}

/** 按 (from→to) 方向取该边路由（找 layout.edges 真实条目·必要时反转输出）。没这条边 → null。 */
export function edgeRoutePts(
  layout: MapLayout,
  from: string,
  to: string,
): Array<{ x: number; y: number }> | null {
  const e = layout.edges.find((x) => (x.a === from && x.b === to) || (x.a === to && x.b === from));
  if (!e) return null;
  const route = routeForEdgeEntry(layout, e);
  if (!route) return null;
  return e.a === from ? route.pts : [...route.pts].reverse();
}

/**
 * 猎手 blip 的路由落点（作者 06-11「红点出墙」修复）：沿渲染同源路由按弧长取 prog；
 * 只有一端被扫过 → 截进半揭示残段口内（STUB_FRAC·留 8% 边距别顶死封口）——位置仍诚实
 * （在哪条水道、朝哪头走都对），只是不画进没揭示的岩里；双端都没扫 → null（调用方回退直线·罕见）。
 */
export function stalkerRoutePoint(
  layout: MapLayout,
  from: string,
  to: string,
  prog: number,
  memory: Record<string, number>,
): { x: number; y: number } | null {
  const pts = edgeRoutePts(layout, from, to);
  if (!pts || pts.length < 2) return null;
  const haveFrom = memory[from] !== undefined;
  const haveTo = memory[to] !== undefined;
  if (!haveFrom && !haveTo) return null;
  const segL: number[] = [];
  let total = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    const l = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
    segL.push(l);
    total += l;
  }
  if (total <= 0) return pts[0];
  let target = Math.max(0, Math.min(1, prog)) * total;
  const stub = total * STUB_FRAC * 0.92;
  if (haveFrom && !haveTo) target = Math.min(target, stub);
  else if (!haveFrom && haveTo) target = Math.max(target, total - stub);
  for (let i = 0; i < segL.length; i++) {
    if (target <= segL[i] || i === segL.length - 1) {
      const t = segL[i] > 0 ? Math.min(1, target / segL[i]) : 0;
      return {
        x: pts[i].x + (pts[i + 1].x - pts[i].x) * t,
        y: pts[i].y + (pts[i + 1].y - pts[i].y) * t,
      };
    }
    target -= segL[i];
  }
  return pts[pts.length - 1];
}

/**
 * 由布局派生有机洞穴几何（确定性·按 node/edge id 派生·同地点同洞·守 #100）：
 *  - 每条**两端都已揭示**的边 → 弯折路由的隧道（1-2 控制点垂向偏移）+ 随边浮动半宽；
 *  - 每个**已揭示**的节点 → 主房间 blob + 1-2 散瓣（不规则形状）+ 偶发死路壁龛（alcove）。
 * scannedIds/memory 决定哪些点/边已被声呐揭示（其余不画＝防剧透·渐进揭示·§2/§3）。
 */
export function buildCaveGeometry(
  layout: MapLayout,
  scannedIds: string[],
  memory: Record<string, number>,
): { tuns: CaveTun[]; rooms: CaveRoom[] } {
  const tuns: CaveTun[] = [];
  const rooms: CaveRoom[] = [];
  for (const e of layout.edges) {
    const haveA = memory[e.a] !== undefined;
    const haveB = memory[e.b] !== undefined;
    if (!haveA && !haveB) continue;
    const route = routeForEdgeEntry(layout, e);
    if (!route) continue;
    const { pts, r } = route;
    if (haveA && haveB) {
      for (let i = 0; i + 1 < pts.length; i++) {
        tuns.push({ ax: pts[i].x, ay: pts[i].y, bx: pts[i + 1].x, by: pts[i + 1].y, r });
      }
      continue;
    }
    // 半揭示残段（#1·作者 06-10「平时全黑」修正）：只有一端被扫过 → 沿同一条确定性路由，从已知端截取
    // STUB_FRAC 画一截变窄的「隧道口」。房间的出口因此看得见（墙不再只在双端齐时凭空出现），通向哪仍是黑的
    // （防剧透/欺骗轴不动）；两端都扫到后自然换成整条隧道（同一路由几何·不跳变）。
    const walk = haveA ? pts : [...pts].reverse();
    let total = 0;
    for (let i = 0; i + 1 < walk.length; i++) total += Math.hypot(walk[i + 1].x - walk[i].x, walk[i + 1].y - walk[i].y);
    let budget = total * STUB_FRAC;
    for (let i = 0; i + 1 < walk.length && budget > 0; i++) {
      const segL = Math.hypot(walk[i + 1].x - walk[i].x, walk[i + 1].y - walk[i].y) || 1;
      const t = Math.min(1, budget / segL);
      tuns.push({
        ax: walk[i].x,
        ay: walk[i].y,
        bx: walk[i].x + (walk[i + 1].x - walk[i].x) * t,
        by: walk[i].y + (walk[i + 1].y - walk[i].y) * t,
        r: r * STUB_R_K,
      });
      budget -= segL;
    }
  }
  for (const id of scannedIds) {
    const p = layout.pos[id];
    if (!p) continue;
    const R = roomRadius(id);
    rooms.push({ x: p.x, y: p.y, r: R });
    const nLobes = (hash01('lobes' + id) < 0.65 ? 1 : 0) + (hash01('lb2' + id) < 0.35 ? 1 : 0);
    for (let i = 0; i < nLobes; i++) {
      const a = hash01(`la${i}` + id) * Math.PI * 2;
      const dist = (0.5 + 0.55 * hash01(`ld${i}` + id)) * R;
      rooms.push({ x: p.x + Math.cos(a) * dist, y: p.y + Math.sin(a) * dist, r: (0.4 + 0.35 * hash01(`lr${i}` + id)) * R });
    }
    if (hash01('alcove' + id) < 0.4) {
      const a = hash01('aa' + id) * Math.PI * 2;
      const len = (0.9 + 0.9 * hash01('al' + id)) * R;
      tuns.push({ ax: p.x, ay: p.y, bx: p.x + Math.cos(a) * len, by: p.y + Math.sin(a) * len, r: CH_BASE * 0.8 });
    }
  }
  return { tuns, rooms };
}

/**
 * POI 在房间内的「偏心」落点（相对节点中心的世界偏移·作者：点不必正中·可贴边·且与节点语义相关）：
 *  - ascent_point / air_pocket → 偏房间顶部（出口/气往上）；
 *  - camp / rest → 偏房间底部（在底歇脚）；
 *  - 其余（event 等）→ 贴一面（hash 派生）洞壁。
 * 确定性·纯函数。
 */
export function poiOffset(id: string, kind: string | undefined): { dx: number; dy: number } {
  let ang: number;
  if (kind === 'ascent_point' || kind === 'air_pocket') ang = -Math.PI / 2 + (hash01('aj' + id) - 0.5) * 0.9;
  else if (kind === 'camp' || kind === 'rest') ang = Math.PI / 2 + (hash01('aj' + id) - 0.5) * 0.9;
  else ang = hash01('ang' + id) * Math.PI * 2;
  const mag = (0.42 + 0.4 * hash01('mag' + id)) * roomRadius(id);
  return { dx: Math.cos(ang) * mag, dy: Math.sin(ang) * mag };
}

/**
 * 把一个世界点搬到「域扭曲后的水道一侧」＝ p − warp(p)（一阶近似）：
 * 渲染的水道在屏幕点 P 处可见 ⟺ caveSdf(P)=baseSdf(P+warp(P))<0，故骨架点 S 对应的水道点 ≈ S − warp(S)。
 * 让 POI / 猎手标记跟随扭曲后的洞、不浮在岩里。
 */
export function voidTrack(wx: number, wy: number): { x: number; y: number } {
  const [ox, oy] = caveWarp(wx, wy);
  return { x: wx - ox, y: wy - oy };
}

/** 世界取景矩形（烤洞穴像素用）：x/y＝左上角世界坐标，w/h＝世界尺寸。 */
export interface CaveRect { x: number; y: number; w: number; h: number; }

/**
 * 把洞穴几何烤成 RGBA 像素（水道蓝绿·岩壁发光青·岩石透明，越深越暗）。
 * **单一来源**：声呐取景窗（SonarScanPanel，rect＝220×300 窗）与地图调试器全图概览（MapDevPanel，rect＝整图）
 * 共用同一像素外观，避免两处洞穴长得不一样（守洞穴一致性 #100·别 churn 成两套着色）。
 * deepK 按 rect 纵向（上浅下深·与 y∝depth 一致）。纯函数·不碰 DOM·返回可直接喂 `ImageData.data.set(...)` 的数组。
 */
export function bakeCaveRGBA(
  cave: { tuns: CaveTun[]; rooms: CaveRoom[] },
  rect: CaveRect,
  outW: number,
  outH: number,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(outW * outH * 4);
  for (let gy = 0; gy < outH; gy++) {
    for (let gx = 0; gx < outW; gx++) {
      const wx = rect.x + ((gx + 0.5) / outW) * rect.w;
      const wy = rect.y + ((gy + 0.5) / outH) * rect.h;
      const d = caveSdf(wx, wy, cave.tuns, cave.rooms);
      const i = (gy * outW + gx) * 4;
      const tex = fbm(wx * 0.12, wy * 0.12); // 表面纹理
      if (d < WALL_LO) {
        // 水道内：蓝绿·越深越暗（wy 越靠 rect 底越深）
        const deepK = Math.min(1, Math.max(0, (wy - rect.y) / rect.h));
        out[i] = 14 + 16 * tex;
        out[i + 1] = 120 - 50 * deepK + 40 * tex;
        out[i + 2] = 140 - 30 * deepK + 30 * tex;
        out[i + 3] = 235;
      } else if (d < WALL_HI) {
        // 岩壁：发光青交界（回波轮廓）
        out[i] = 110 + 40 * tex;
        out[i + 1] = 230;
        out[i + 2] = 215;
        out[i + 3] = 255;
      } else {
        // 岩石：透明（露出面板暗底＝岩）
        out[i + 3] = 0;
      }
    }
  }
  return out;
}

interface Props {
  state: GameState;
  /** NodeSelectView 当前的移动 choices＝可立即前往的相邻节点（§2·只这些画可点标记·点击触发同一条 move）。 */
  choices: NodeChoice[];
  onStateChange: (s: GameState) => void;
  /** 两段点击（#5·作者 06-10）：当前「选中待确认」的节点——图上高亮 + 列表项同款高亮（状态由 NodeSelectView 持有＝联动单一来源）。 */
  pendingNodeId?: string | null;
  /** 第一击选中 / 点空处清除；不传＝保持旧「一击即走」（既有调用方零迁移）。 */
  onPendingChange?: (nodeId: string | null) => void;
}

export function SonarScanPanel({ state, choices, onStateChange, pendingNodeId, onPendingChange }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stackRef = useRef<HTMLDivElement | null>(null);
  // 缩放/平移（#2）：纯视图态（不入存档）。pointers＝活跃触点（1 指拖动平移·2 指捏合缩放）；
  // pan/pinch 经 rAF 合并再 setCam（每帧至多重烤一次洞穴）；movedRef＝按下以来累计位移（>阈值＝拖拽·吞掉随后的 click）。
  const [cam, setCam] = useState<{ dx: number; dy: number; z: number }>({ dx: 0, dy: 0, z: 1 });
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const movedRef = useRef(0);
  const camAccRef = useRef<{ dx: number; dy: number; zk: number }>({ dx: 0, dy: 0, zk: 1 });
  const camRafRef = useRef(0);
  // 滚轮缩放走原生 listener（passive:false 才能 preventDefault 页面滚动）；handler 每渲染重指（闭包取最新取景）。
  const wheelRef = useRef<((e: WheelEvent) => void) | null>(null);
  const wheelCleanupRef = useRef<(() => void) | null>(null);
  // 旧图持续（§4「旧图保留到下次扫描」）：上一次烤好的洞穴位图 + 其世界矩形——新扫描的波前外侧仍显示旧图（不再黑屏等波）。
  const prevBakeRef = useRef<{ canvas: HTMLCanvasElement; rect: CaveRect } | null>(null);
  // 扫描波只在「真有新扫描」时重播（lastScanTurn 变化/面板重挂载）；纯平移/缩放只重烤不重播（别放假波）。
  const lastSweepRef = useRef<string | null>(null);
  // 面板 CSS 客户端注入 head（一次·SSR 不跑＝输出干净·不污染 smoke 子串断言）。
  useEffect(() => {
    if (typeof document === 'undefined' || document.getElementById(CAVE_STYLE_ID)) return;
    const el = document.createElement('style');
    el.id = CAVE_STYLE_ID;
    el.textContent = CAVE_STYLE;
    document.head.appendChild(el);
  }, []);
  const run: RunState | undefined = state.run ?? undefined;
  const map = run?.map ?? null;
  const memory = run?.scanMemory ?? {};
  const scannedIds = map ? Object.keys(memory).filter((id) => map.nodes[id]) : [];

  // 换节点＝视角跟人走：清平移偏移（保留缩放档·玩家调好的倍率是偏好）。hooks 在早退前。
  const curIdDep = run?.currentNodeId ?? null;
  useEffect(() => {
    setCam((c) => (c.dx !== 0 || c.dy !== 0 ? { ...c, dx: 0, dy: 0 } : c));
  }, [curIdDep]);

  // 布局（压短纵向 + byLayer 横向铺开·§2）。空图/无 run 兜底空布局（hooks 仍按序调用·见下早退）。
  const layout = map ? deriveMapLayout(map, { pxPerMeter: SONAR_PX_PER_M, colW: SONAR_COL_W }) : null;
  const curId = run?.currentNodeId ?? null;
  const here = (layout && curId && layout.pos[curId]) || { x: (layout?.width ?? 0) / 2, y: (layout?.height ?? 0) / 2 };
  const isOpenWater = run ? !zoneAllowsBacktrack(run.zoneId) : false;
  // 你脚下那间永远可见（#1·纯渲染侧）：人都站在这儿了，眼前这间洞不该是黑的——
  // 不写 scanMemory（存档/引擎零变化·揭示与欺骗语义仍归 clarity/sonar），只在渲染时并进当前节点。
  const renderIds =
    !isOpenWater && curId && map?.nodes[curId] && memory[curId] === undefined ? [...scannedIds, curId] : scannedIds;
  const renderMemory: Record<string, number> = renderIds === scannedIds ? memory : { ...memory, [curId as string]: -1 };
  // 最近一次扫描的 turn（任一节点被刷新的最大 stamp）→ 变化即重新雷达扫一遍（旧图保留到此刻·§4）。
  let lastScanTurn = -1;
  for (const id of scannedIds) lastScanTurn = Math.max(lastScanTurn, memory[id] ?? -1);

  // 取景窗（#2 缩放/平移）：z 缩放视野尺寸，dx/dy 平移视野中心（世界单位·相对你）。
  const vw = VIEW_W / cam.z;
  const vh = VIEW_H / cam.z;
  const vbX = here.x + cam.dx - vw / 2;
  const vbY = here.y + cam.dy - vh / 2;

  // 揭示几何（世界坐标·canvas 画有机洞穴用·确定性 buildCaveGeometry）：扫到的点/两端都扫到的边才画＝渐进揭示防剧透；
  // 半揭示边给残段隧道口（#1）。开放水域不画洞壁。
  const cave = layout && !isOpenWater ? buildCaveGeometry(layout, renderIds, renderMemory) : { tuns: [], rooms: [] };

  // canvas：有机洞穴剖面 + 雷达扫描（useEffect·SSR 不跑）。signature 变（新扫描/移动/缩放/平移）→ 重画；是否重播扫描波由 lastSweepRef 决定。
  const signature = `${vbX.toFixed(1)},${vbY.toFixed(1)},${vw.toFixed(1)}|${lastScanTurn}|${isOpenWater}|${renderIds
    .slice()
    .sort()
    .join(',')}`;
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const W = VIEW_W * RENDER_SCALE;
    const H = VIEW_H * RENDER_SCALE;
    canvas.width = W;
    canvas.height = H;
    const rect: CaveRect = { x: vbX, y: vbY, w: vw, h: vh };

    // 离屏半分辨率算洞穴 SDF（§2 半分辨率提速）→ 一次性烤成静态洞穴图（水/壁/岩 + 噪声），之后只做雷达揭示合成。
    const ow = Math.max(1, Math.round(VIEW_W / 2));
    const oh = Math.max(1, Math.round(VIEW_H / 2));
    const off = document.createElement('canvas');
    off.width = ow;
    off.height = oh;
    const octx = off.getContext('2d');
    let haveCave = false;
    if (octx && !isOpenWater && cave.tuns.length + cave.rooms.length > 0) {
      // 取景窗与 MapDevPanel 全图概览共用同一像素外观（bakeCaveRGBA·单一来源·守洞穴一致性 #100）。
      const img = octx.createImageData(ow, oh);
      img.data.set(bakeCaveRGBA(cave, rect, ow, oh));
      octx.putImageData(img, 0, 0);
      haveCave = true;
    }

    // 世界 → 本 canvas 像素（缩放/平移后 here 不一定在正中）。
    const hx = ((here.x - rect.x) / rect.w) * W;
    const hy = ((here.y - rect.y) / rect.h) * H;
    const maxR = Math.hypot(Math.max(hx, W - hx), Math.max(hy, H - hy)) + 8;
    // 旧图（上一次烤好的位图·可能对应另一个取景矩形）按世界坐标贴到当前取景——波前外侧保旧图（§4），不再黑屏等波扫完。
    const drawBakeAt = (b: { canvas: HTMLCanvasElement; rect: CaveRect }) => {
      const dx = ((b.rect.x - rect.x) / rect.w) * W;
      const dy = ((b.rect.y - rect.y) / rect.h) * H;
      ctx.drawImage(b.canvas, dx, dy, (b.rect.w / rect.w) * W, (b.rect.h / rect.h) * H);
    };

    const compose = (revealR: number, animating: boolean) => {
      ctx.clearRect(0, 0, W, H);
      ctx.imageSmoothingEnabled = true;
      const prev = prevBakeRef.current;
      if (animating && prev) drawBakeAt(prev); // 波前外侧：旧图打底
      if (haveCave) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(hx, hy, revealR, 0, Math.PI * 2); // 雷达波前门控：新图只露已被波前扫到的那片
        ctx.clip();
        if (animating && prev) ctx.clearRect(0, 0, W, H); // 波前内侧先清旧图（岩区透明·别让旧水道残留）
        ctx.drawImage(off, 0, 0, ow, oh, 0, 0, W, H);
        ctx.restore();
      }
      if (animating) {
        // 亮前缘 + 淡化拖尾（雷达余辉·径向渐变环带·§3·06-10 调亮调宽——波要「很明显」）
        const inner = Math.max(0, revealR - 34 * RENDER_SCALE);
        const grd = ctx.createRadialGradient(hx, hy, inner, hx, hy, revealR);
        grd.addColorStop(0, 'rgba(78,209,193,0)');
        grd.addColorStop(0.7, 'rgba(110,235,215,0.16)');
        grd.addColorStop(1, 'rgba(165,255,238,0.55)');
        ctx.fillStyle = grd;
        ctx.beginPath();
        ctx.arc(hx, hy, revealR, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(170,255,240,0.8)';
        ctx.lineWidth = 2 * RENDER_SCALE;
        ctx.beginPath();
        ctx.arc(hx, hy, revealR, 0, Math.PI * 2);
        ctx.stroke();
      }
    };

    // 扫描波只在真有新扫描时重播（到站自动扫/手动 ping → lastScanTurn 变；面板重挂载〔事件回来〕重播上一记）；
    // 纯缩放/平移＝重烤直出，不放假波。
    const replay = lastSweepRef.current !== `${lastScanTurn}`;
    let raf = 0;
    if (replay && typeof requestAnimationFrame === 'function') {
      // 重挂载（过完事件回来/重开面板）旧图 ref 是空的——已扫区域是**测绘记忆**，不该回到全黑再被波
      // 重新点亮（作者 06-11「每次扫描都从黑开始」反馈）：拿本帧烤图当「旧图」打底，重播的波只剩动画职责；
      // 同一挂载内的真·新扫描仍是「旧图打底 + 波前内换新图」（§4 语义不变）。
      if (!prevBakeRef.current && haveCave) prevBakeRef.current = { canvas: off, rect };
      lastSweepRef.current = `${lastScanTurn}`;
      const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const frame = (t: number) => {
        const k = Math.min(1, (t - t0) / SWEEP_MS);
        compose(maxR * k, k < 1); // 线性前缘（恒速·与 SVG 标记「波到才亮」延迟同步）
        if (k < 1) raf = requestAnimationFrame(frame);
        else prevBakeRef.current = { canvas: off, rect };
      };
      raf = requestAnimationFrame(frame);
    } else {
      compose(maxR, false);
      prevBakeRef.current = { canvas: off, rect };
    }
    return () => {
      if (raf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  // ---- 早退（hooks 已全部在上方按序调用）----
  if (!run || !map || !layout) return null;
  // 洞穴图里 renderIds 至少含你脚下那间（#1）＝空态只剩「开阔水域 + 没扫过」。
  if (renderIds.length === 0) {
    return (
      <div className="sonar-panel">
        <div className="sonar-panel-head">
          <span className="sonar-panel-title">声呐图</span>
          <span className="sonar-panel-sub">一片黑。开着声呐往前走，或扫一记，听听四周。</span>
        </div>
        <div className="sonar-scan sonar-scan-empty">
          <span className="sonar-empty-note">· · ·</span>
        </div>
      </div>
    );
  }

  const focusDir: SonarDir | undefined = run.sensors.sonar === 'ping' ? run.sensors.sonarDir : undefined;

  // 相邻可去节点（§2·只这些画可点标记）：用 NodeSelectView 同一份 choices＝点击声呐图＝触发同一条 move。
  const adj = choices.filter((c) => layout.pos[c.nodeId]);

  // 猎手（§8.7 会过时·mid-edge 插值）：上次被扫到的位置（可能在通道中段）→ 红呼吸点（不要 X）。
  // 落点沿**渲染同源路由**（stalkerRoutePoint·作者 06-11「红点出墙」修复）：隧道是弯折折线，
  // 房心直线插值会把通道中段的点画进岩里；远端未扫时再截进半揭示残段口内。开阔水域无洞壁仍走直线。
  const stalkerFix = stalkerSonarBlip(run);
  let stalkerPos: { x: number; y: number } | null = null;
  if (stalkerFix) {
    const a = layout.pos[stalkerFix.nodeId];
    if (a) {
      if (stalkerFix.edgeTo && layout.pos[stalkerFix.edgeTo] && stalkerFix.edgeProg !== undefined) {
        const b = layout.pos[stalkerFix.edgeTo];
        const t = stalkerFix.edgeProg;
        const onRoute = !isOpenWater
          ? stalkerRoutePoint(layout, stalkerFix.nodeId, stalkerFix.edgeTo, t, renderMemory)
          : null;
        stalkerPos = onRoute
          ? voidTrack(onRoute.x, onRoute.y)
          : voidTrack(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t); // 直线回退（开阔水域/极端无知态）
      } else {
        stalkerPos = voidTrack(a.x, a.y);
      }
    }
  }

  // 威胁接触（S3 廉价版·alert 驱动）：没被声呐精确定位时画一处模糊琥珀接触（同一只猎手不重复标记）。
  const threat = threatContact(run);
  const threatPos =
    threat && !stalkerFix
      ? {
          x: here.x + Math.cos(threat.angle) * VIEW_R * 0.42 * (0.38 + 0.55 * (1 - threat.proximity)),
          y: here.y + Math.sin(threat.angle) * VIEW_R * 0.42 * (0.38 + 0.55 * (1 - threat.proximity)),
        }
      : null;

  // 低 san 伪接触（S2·锚在扫到的节点附近·subtle）。
  const phantoms = sonarPhantoms(run, memory);

  // 你的呼吸点：voidTrack 跟随扭曲后的洞（不浮在岩里）；量程环/取景仍以房间中心 here 为准。
  const youMark = voidTrack(here.x, here.y);

  // —— 「波到才亮」（#3）：标记按波前到达时刻延迟淡入（线性波前 → delay = dist/maxR × SWEEP_MS·与 canvas 同一比例）。
  // 外层 <g key=lastScanTurn>＝只有真扫描会重挂载重播；纯平移/缩放不重弹。 ——
  const hereVx = here.x - vbX;
  const hereVy = here.y - vbY;
  const maxRWorld =
    Math.hypot(Math.max(hereVx, vw - hereVx), Math.max(hereVy, vh - hereVy)) + (8 * vw) / (VIEW_W * RENDER_SCALE);
  const waveDelay = (x: number, y: number): CSSProperties => ({
    animationDelay: `${Math.round(Math.min(1, Math.hypot(x - here.x, y - here.y) / Math.max(1, maxRWorld)) * SWEEP_MS)}ms`,
  });

  // —— 缩放/平移交互（#2）：1 指拖动平移 / 2 指捏合缩放 / 滚轮缩放（光标为锚）。rAF 合并＝每帧至多一次重烤。 ——
  const clampCam = (c: { dx: number; dy: number; z: number }) => {
    const z = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, c.z));
    const cx = Math.min(layout.width + PAN_MARGIN, Math.max(-PAN_MARGIN, here.x + c.dx));
    const cy = Math.min(layout.height + PAN_MARGIN, Math.max(-PAN_MARGIN, here.y + c.dy));
    return { dx: cx - here.x, dy: cy - here.y, z };
  };
  const flushCamAcc = () => {
    camRafRef.current = 0;
    const a = camAccRef.current;
    camAccRef.current = { dx: 0, dy: 0, zk: 1 };
    if (a.dx === 0 && a.dy === 0 && a.zk === 1) return;
    setCam((c) => clampCam({ dx: c.dx + a.dx, dy: c.dy + a.dy, z: c.z * a.zk }));
  };
  const queueCam = (ddx: number, ddy: number, zk: number) => {
    const a = camAccRef.current;
    a.dx += ddx;
    a.dy += ddy;
    a.zk *= zk;
    if (!camRafRef.current && typeof requestAnimationFrame === 'function') {
      camRafRef.current = requestAnimationFrame(flushCamAcc);
    }
  };
  /** CSS px → 世界单位（canvas object-fit:contain 与 SVG meet 同一等比适配＝同一换算）。 */
  const cssToWorld = (): number => {
    const el = stackRef.current;
    if (!el) return vw / VIEW_W;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return vw / VIEW_W;
    const fitW = Math.min(r.width, r.height * (VIEW_W / VIEW_H));
    return vw / fitW;
  };
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointersRef.current.size === 1) movedRef.current = 0;
    // 注意：不在 down 时 setPointerCapture——立即捕获会把后续 click 重定向到容器、吞掉 POI 标记的点击；
    // 拖过阈值（确认是拖拽）才捕获（防拖出边界丢跟踪），此时 click 本就该被 movedRef 闸掉。
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const pts = pointersRef.current;
    const prev = pts.get(e.pointerId);
    if (!prev) return;
    const cur = { x: e.clientX, y: e.clientY };
    if (pts.size === 1) {
      const s = cssToWorld();
      movedRef.current += Math.hypot(cur.x - prev.x, cur.y - prev.y);
      if (movedRef.current > 6) e.currentTarget.setPointerCapture?.(e.pointerId);
      queueCam(-(cur.x - prev.x) * s, -(cur.y - prev.y) * s, 1); // 拖右＝看左边的世界
    } else if (pts.size === 2) {
      const entries = [...pts.entries()];
      const other = entries[0][0] === e.pointerId ? entries[1][1] : entries[0][1];
      const d0 = Math.hypot(prev.x - other.x, prev.y - other.y) || 1;
      const d1 = Math.hypot(cur.x - other.x, cur.y - other.y) || 1;
      movedRef.current += Math.abs(d1 - d0);
      queueCam(0, 0, d1 / d0);
    }
    pts.set(e.pointerId, cur);
  };
  const onPointerEnd = (e: ReactPointerEvent<HTMLDivElement>) => {
    pointersRef.current.delete(e.pointerId);
  };
  // 滚轮缩放（光标锚定：保持光标下的世界点不动）。handler 每渲染重指＝闭包总拿最新取景。
  wheelRef.current = (e: WheelEvent) => {
    e.preventDefault();
    const el = stackRef.current;
    if (!el) return;
    const zk = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    const r = el.getBoundingClientRect();
    const fitW = Math.min(r.width, r.height * (VIEW_W / VIEW_H));
    const fitH = fitW * (VIEW_H / VIEW_W);
    const bx = r.left + (r.width - fitW) / 2;
    const by = r.top + (r.height - fitH) / 2;
    const fx = Math.min(1, Math.max(0, (e.clientX - bx) / fitW));
    const fy = Math.min(1, Math.max(0, (e.clientY - by) / fitH));
    const wxp = vbX + fx * vw;
    const wyp = vbY + fy * vh;
    setCam((c) => {
      const z = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, c.z * zk));
      const nvw = VIEW_W / z;
      const nvh = VIEW_H / z;
      return clampCam({ dx: wxp - fx * nvw + nvw / 2 - here.x, dy: wyp - fy * nvh + nvh / 2 - here.y, z });
    });
  };
  // callback ref：stack 可能晚于 mount 出现（先空态后成图），用它挂/卸 wheel listener（passive:false）。
  const stackCb = (el: HTMLDivElement | null) => {
    stackRef.current = el;
    if (wheelCleanupRef.current) {
      wheelCleanupRef.current();
      wheelCleanupRef.current = null;
    }
    if (el) {
      const h = (e: WheelEvent) => wheelRef.current?.(e);
      el.addEventListener('wheel', h, { passive: false });
      wheelCleanupRef.current = () => el.removeEventListener('wheel', h);
    }
  };
  const camMoved = cam.z !== 1 || cam.dx !== 0 || cam.dy !== 0;

  // 残图小地图（方位感·保留·不逐回合淡出·§4）：全洞外框 + 已 mapped 的点 + 你。
  const MINI_W = 60;
  const MINI_H = 96;
  const miniScale = Math.min(MINI_W / Math.max(1, layout.width), (MINI_H - 4) / Math.max(1, layout.height));

  return (
    <div className={`sonar-panel ${isOpenWater ? 'is-open-water' : ''}`}>
      <div className="sonar-panel-head">
        <span className="sonar-panel-title">声呐图</span>
        {focusDir && <span className="sonar-focus-tag">聚焦 · {SONAR_DIR_LABEL[focusDir]}</span>}
        <span className="sonar-panel-sub">
          {isOpenWater
            ? '开阔水域——没有洞壁可循，只有黑暗里的接触与读数。'
            : '回波凿出的洞——蓝是水路，暗是岩。会过时，信几分由你。'}
        </span>
        {/* 回正（#2）：缩放/平移过才出现（SSR 默认视角＝不渲染·smoke 零影响）。 */}
        {camMoved && (
          <button className="btn small sonar-recenter" onClick={() => setCam({ dx: 0, dy: 0, z: 1 })}>
            回正
          </button>
        )}
      </div>
      <div className="sonar-scan-wrap">
        <div
          className="sonar-scan sonar-scan-stack"
          ref={stackCb}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
        >
          {/* 有机洞穴剖面 + 雷达扫描（canvas·SSR 出空 canvas·画对靠 dev-server 肉眼·quirk #91/#93） */}
          <canvas ref={canvasRef} className="sonar-cave-canvas" aria-hidden="true" />
          {/* 语义/可点覆盖层（SVG·SSR 可断言 + 可点） */}
          <svg
            className="sonar-overlay"
            viewBox={`${vbX} ${vbY} ${vw} ${vh}`}
            preserveAspectRatio="xMidYMid meet"
            role="img"
            aria-label="声呐探索图"
            onClick={() => {
              // 点空处＝取消选中（两段点击 #5）；拖拽（>6px）不算点。标记 onClick 已 stopPropagation。
              if (movedRef.current <= 6) onPendingChange?.(null);
            }}
          >
            <circle className="sonar-range-ring" cx={here.x} cy={here.y} r={VIEW_R * 0.42} />
            {focusDir && (
              <path
                className="sonar-focus-wedge"
                data-dir={focusDir}
                d={focusWedgePath(here.x, here.y, VIEW_R * 0.5, focusDir)}
              />
            )}
            {/* 「波到才亮」组（#3）：key=lastScanTurn＝真扫描重挂载重播淡入；平移/缩放不重弹。 */}
            <g key={`wave-${lastScanTurn}`}>
            {/* 低 san 伪接触（S2）：与真接触无异的幻影·subtle */}
            {phantoms.map((ph) => {
              const anchor = layout.pos[ph.nearNodeId];
              if (!anchor) return null;
              return (
                <circle
                  key={ph.id}
                  className="sonar-phantom sonar-wave-in"
                  style={waveDelay(anchor.x + ph.dx, anchor.y + ph.dy)}
                  cx={anchor.x + ph.dx}
                  cy={anchor.y + ph.dy}
                  r={5}
                />
              );
            })}
            {/* 相邻可去节点（§2·只这些可点·点击＝触发那条 move choice·与 NodeSelectView 同步）。
                欺骗仍走 clarity（nodeSonarView）：evade→无回波(不画)·spoof→假信标(is-spoof)·低 san→读数乱码(is-garbled)。 */}
            {adj.map((c) => {
              const p = layout.pos[c.nodeId];
              if (!p) return null;
              const node = map.nodes[c.nodeId];
              const view = nodeSonarView(run, node);
              if (view.noEcho) return null; // evade：无回波·这处空缺（捕食者躲过你的扫描）
              // POI 偏心落点（语义相关·可贴边）+ voidTrack 跟随扭曲后的洞（仅已揭示节点·未扫到的保持节点中心·防漂进岩里）。
              let m = { x: p.x, y: p.y };
              if (memory[c.nodeId] !== undefined) {
                const o = poiOffset(c.nodeId, view.displayKind ?? node.kind);
                m = voidTrack(p.x + o.dx, p.y + o.dy);
              }
              const glyph = kindGlyph(view.displayKind);
              const feats = node.features ?? [];
              const isRoom = feats.length > 1 && !view.deceptive;
              const baseR = isRoom ? 9 : 6;
              const isPending = pendingNodeId === c.nodeId;
              return (
                <g
                  key={c.nodeId}
                  className={`sonar-blip sonar-node-marker sonar-wave-in ${kindClass(view.displayKind)} ${isRoom ? 'is-room' : ''} ${view.deceptive ? 'is-spoof' : ''} ${isPending ? 'is-pending' : ''}`}
                  style={waveDelay(m.x, m.y)}
                  onClick={(ev) => {
                    // 两段点击（#5·作者 06-10）：第一击选中（图上高亮 + 列表项同款高亮·状态在 NodeSelectView），
                    // 再击同一点＝确认前往。拖拽（>6px）不算点；未接 onPendingChange 的调用方保持旧「一击即走」。
                    ev.stopPropagation();
                    if (movedRef.current > 6) return;
                    if (!onPendingChange || isPending) onStateChange(moveToNode(state, c.nodeId));
                    else onPendingChange(c.nodeId);
                  }}
                  role="button"
                  tabIndex={0}
                  aria-label={isPending ? `再点一次前往 ${node.depth}m` : `选定 ${node.depth}m`}
                >
                  {isPending && <circle className="sonar-pending-ring" cx={m.x} cy={m.y} r={baseR + 5} />}
                  <circle cx={m.x} cy={m.y} r={baseR} />
                  {isRoom &&
                    feats.map((_, fi) => {
                      const ang = (fi / feats.length) * Math.PI * 2 - Math.PI / 2;
                      return (
                        <circle
                          key={fi}
                          className="sonar-feature-dot"
                          cx={m.x + Math.cos(ang) * 4.5}
                          cy={m.y + Math.sin(ang) * 4.5}
                          r={1.5}
                        />
                      );
                    })}
                  {glyph && (
                    <text className="sonar-blip-glyph" x={m.x} y={m.y + 3}>
                      {glyph}
                    </text>
                  )}
                  <text className={`sonar-blip-depth ${view.garbled ? 'is-garbled' : ''}`} x={m.x} y={m.y - 10}>
                    {view.garbled ? '▓▓m' : `${node.depth}m`}
                  </text>
                </g>
              );
            })}
            {/* 威胁接触（S3 廉价版·琥珀·读不准方位/距离） */}
            {threat && threatPos && (
              <g
                className={`sonar-threat sonar-wave-in ${threat.imminent ? 'is-near' : ''}`}
                style={waveDelay(threatPos.x, threatPos.y)}
              >
                <circle cx={threatPos.x} cy={threatPos.y} r={6} />
                <text className="sonar-threat-label" x={threatPos.x} y={threatPos.y - 9}>
                  {threat.garbled ? '?' : threat.range === 'near' ? '近' : threat.range === 'mid' ? '中' : '远'}
                </text>
              </g>
            )}
            {/* 猎手（§5 观感·§8.7 会过时）：红呼吸点 + 外圈（不要 X）·mid-edge 插值·大型生物一大团。
                wave-in 包外层（与 sonar-pulse 的 animation 互斥·同元素会互盖）。 */}
            {stalkerFix && stalkerPos && (
              <g className="sonar-wave-in" style={waveDelay(stalkerPos.x, stalkerPos.y)}>
                <g className={`sonar-stalker sonar-pulse ${stalkerFix.large ? 'is-large' : ''}`}>
                  {stalkerFix.large && (
                    <circle className="sonar-stalker-mass" cx={stalkerPos.x} cy={stalkerPos.y} r={18} />
                  )}
                  <circle className="sonar-stalker-ring" cx={stalkerPos.x} cy={stalkerPos.y} r={stalkerFix.large ? 13 : 8} />
                  <circle className="sonar-stalker-core" cx={stalkerPos.x} cy={stalkerPos.y} r={stalkerFix.large ? 5 : 3} />
                </g>
              </g>
            )}
            </g>
            {/* 你（呼吸点 + 外圈·青·不要 X·§5 观感） */}
            <g className="sonar-you sonar-pulse">
              <circle className="sonar-you-ring" cx={youMark.x} cy={youMark.y} r={7} />
              <circle className="sonar-you-core" cx={youMark.x} cy={youMark.y} r={3} />
            </g>
          </svg>
        </div>

        {/* 残图小地图：外框 = 全洞范围·点 = 已 mapped·亮点 = 你（保留·不逐回合淡出·§4） */}
        <svg
          className="sonar-mini"
          viewBox={`0 0 ${MINI_W} ${MINI_H}`}
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label="残图小地图"
        >
          <rect className="sonar-mini-extent" x={1} y={1} width={MINI_W - 2} height={MINI_H - 2} />
          {renderIds.map((id) => {
            const p = layout.pos[id];
            if (!p) return null;
            const isCurrent = id === curId;
            return (
              <circle
                key={id}
                className={`sonar-mini-blip ${isCurrent ? 'is-here' : ''}`}
                cx={2 + p.x * miniScale}
                cy={2 + p.y * miniScale}
                r={isCurrent ? 2.6 : 1.6}
              />
            );
          })}
        </svg>
      </div>
    </div>
  );
}
