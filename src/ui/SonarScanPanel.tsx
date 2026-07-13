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
// 感知重做后声呐诚实（SPEC §2.2）：不再有欺骗表象/伪接触——节点按真 kind 画。威胁是 clarity 单一来源（threatContact·诚实）；
// 猎手位置 stalkerSonarBlip（§8.7 会过时·mid-edge 插值）。ping 是一记诚实动作（车道 4 落地·SPEC §2.2「ping 才扫」）：
// 一记 ping 揭示 sonarScanRange 跳的规划纵深（scanReveal stamp 进 scanMemory·这里把「几跳之外」的节点也画出来供规划）——
// 射程 = 看多远。几何揭示圆（SONAR_REVEAL_R·SDF/雷达扫/猎手红点）整套渲染留用（与单记 ping 兼容）。

import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import type { GameState, NodeChoice, RunState } from '@/types';
import { deriveMapLayout, type MapLayout } from './mapLayout';
import { moveToNode } from '@/engine/dive';
import { threatContact } from '@/engine/clarity';
import { stalkerSonarBlip } from '@/engine/stalker';
import { hash01, roomScale01, distSeg, fbm } from '@/engine/sonar';
import {
  clampViewToBox,
  SONAR_PX_PER_M,
  SONAR_COL_W,
  CH_BASE,
  CH_VAR,
  ROOM_BASE,
  ROOM_VAR,
  WARP_AMP,
  WARP_FREQ,
  SMIN_K,
  CTRL_OFF,
  WALL_LO,
  shadeSonarSdf,
} from '@/engine/sonarGeometry';
import { buildOpenWaterGeometry, bakeOpenWaterRGBA } from './openWaterRender';
import { zoneAllowsBacktrack, getZone } from '@/engine/zones';
import { persistentExploredForRun } from '@/engine/caves';

/** 纵向取景窗（窄×高·#92 上浅下深）：只显当前节点周围一片（SPEC「默认放大、几乎看不到全貌」）。 */
const VIEW_W = 220;
const VIEW_H = 300;
const VIEW_R = Math.min(VIEW_W, VIEW_H);
/** 缩放/平移（#2·作者 06-10）：z＝缩放（1=默认取景），dx/dy＝视野中心相对你的世界偏移。纯视图态·不入存档。 */
const ZOOM_MIN = 0.6;
const ZOOM_MAX = 2.5;
const PAN_MARGIN = 60; // 平移可越出布局边界的余量（世界单位·防飞出找不回·配「回正」按钮）

// 取景钳制（clampViewCenter/clampViewToBox）、布局比例（SONAR_PX_PER_M/COL_W）与有机洞穴几何旋钮
// （CH_*/ROOM_*/WARP_*/SMIN_K/CTRL_OFF/WALL_*/CAVE_GEOM_MARGIN）迁 engine/sonarGeometry.ts（纯几何出 ui·
// 与 hash01/roomScale01 迁 engine/sonar.ts 同一脉络）——消费方（MapDevPanel/smoke）改从那里 import。

/** canvas 内部超采样（清晰度）；洞穴 SDF 在其半分辨率算（§2 半分辨率提速）。 */
const RENDER_SCALE = 2;
/**
 * 雷达扫描扩散时长（ms）。作者 06-10 实测：1.2s + easeOut 前 0.3s 就掠过大半屏＝「根本没看到波」——
 * 放慢 + **线性前缘**（frame 里 eased=k·恒速）：SVG 标记「波到才亮」的延迟（dist/maxR×SWEEP_MS）可与波前精确同步。
 */
const SWEEP_MS = 2600;
/** 半揭示残段（#1「平时全黑」修正）：边只有一端被扫过 → 从已知端画一小截变窄的隧道口（房间的出口看得见、通向哪看不见·防剧透轴不破）。 */
const STUB_FRAC = 0.38; // 半揭示边的猎手 blip 路由截断比例（stalkerRoutePoint·#1 残段几何已被 06-13 敞口通道取代，但 blip 仍按此截断不画进未扫黑岩）
/**
 * 敞口通道收窄系数（作者 06-13 重设计·洞穴固定·不完整揭示）：半揭示边（一端已扫）不再画短残段封口，
 * 而是沿整条路由画一条**敞口、向未扫端逐渐收窄到 r×此值、没入黑暗**的通道，伸到未扫节点位置——
 * 可去但未扫的相邻节点落在开口处的水里（不再浮在墙外）；未画其房间＝内容仍不剧透（只露「这边还有路」）。
 */
const OPEN_TAPER_MIN = 0.32;

/**
 * 面板自带的布局/动画 CSS（客户端注入 document.head·见 useEffect）。
 * **不走 JSX <style>**——那样 class 名会进 SSR 文本、污染 smoke 的子串断言（`!includes('sonar-stalker')` 会误中）。
 * 走 head 注入＝SSR 输出干净（只出结构），浏览器仍拿到样式。颜色用高特异性盖过 styles.css 通用 .sonar-stalker circle（quirk #91）。
 */
const CAVE_STYLE = `
@keyframes sonarBreath { 0%,100% { opacity: .55; } 50% { opacity: 1; } }
@keyframes sonarWaveIn { from { opacity: 0; } to { opacity: 1; } }
/* 拖动手势独占（06-11·作者「拖动偶尔把图里元素拖走」）：禁文本选中与原生 drag ghost——
   拖图必须永远是平移，不能偶尔变成「拖走一段文字/图形的半透明残影」。 */
.sonar-scan-stack { position: relative; touch-action: none; user-select: none; -webkit-user-select: none; }
.sonar-scan-stack * { -webkit-user-drag: none; }
.sonar-cave-canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; object-fit: contain; }
.sonar-overlay { position: absolute; inset: 0; width: 100%; height: 100%; }
.sonar-pulse { animation: sonarBreath 2.2s ease-in-out infinite; }
.sonar-node-marker { cursor: pointer; }
/* 点击选中节点时浏览器给 role=button 的 <g> 画的方框焦点环——鼠标点不要（选中态由 pending-ring 表达）；
   键盘 tab（:focus-visible）仍保留可见焦点＝守可达性（作者 06-13「高亮外的方框不要」）。 */
.sonar-node-marker:focus { outline: none; }
.sonar-node-marker:focus:not(:focus-visible) { outline: none; }
.sonar-node-marker:focus-visible { outline: 2px solid #8cffeb; outline-offset: 2px; }
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


// hash01/hash2/vnoise/fbm/distSeg 迁居 engine/sonar.ts（渲染同源单一来源·洞穴 + 开阔水域 openWaterRender 共用·顶部 import）——输出逐字相同。
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
 * 几何圆战争迷雾三态（作者 06-13 重设计）：洞穴**整张固定**（buildCaveGeometry 喂全节点·同地同图），bakeCaveRGBA
 * 只把它烤成「整张全亮的洞」；三态遮罩在**合成层用几何圆**做（SonarScanPanel 常驻 rAF 循环·clip 到圆）：
 *   黑＝不在任何扫描圆里（没扫过）/ 暗＝只落在以前回合的扫描圆里（FOG_DIM·常驻·不回黑）/ 亮＝落在本回合扫描圆里（随扩散圆点亮）。
 * 圆＝以「扫描中心」节点（run.scanMemory 的键·见 engine/dive-sensors.scanReveal）为心、半径 SONAR_REVEAL_R 的世界圆。
 */
export const FOG_DIM = 0.4; // 「暗」层亮度（以前回合扫过的残留·合成层 globalAlpha）

/**
 * 一次扫描在声呐图上点亮的圆的**世界半径**（layout 坐标·≈照亮你身边一圈洞）。固定·不随升级——
 * 升级走「猎手听觉量程」（sonar.ts::sonarScanRange·BFS 跳数·只管能否听到猎手），与这个视觉揭示圆有意分开（作者「R 一开始就是 1」）。
 */
export const SONAR_REVEAL_R = 64;

/** 取景包围盒「略微再大一圈」的世界余量（作者拍板）：盒＝扫过区域(点亮+暗) + 这点余量，边缘留一圈黑透气。 */
const SONAR_BOX_PAD = 26;

/**
 * 房间半径（按 node id 派生·大小不一）。buildCaveGeometry 与 poiOffset 共用＝标记落在房间内。
 * 标度来自 engine/sonar.ts::roomScale01（猎手 §5：游戏性「容得下多大」与画出来的房间大小**同一来源**——
 * 你看到的最小那挡房间＝大型猎手钻不进的窄缝）。
 */
function roomRadius(id: string): number {
  const base = ROOM_BASE + ROOM_VAR * roomScale01(id);
  // 三卵室（蜂群 boss·SPEC §8）＝统一的大房间：三间同为主战场，别随 id hash 大小不一（否则中间那间可能偏小）。
  // 纯渲染放大·不碰 roomScale01（那是猎手可通行的游戏语义单一来源）。
  if (id.startsWith('w.chamber.')) return (ROOM_BASE + ROOM_VAR) * 1.7;
  return base;
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
    // 敞口通道（作者 06-13 重设计·取代旧短残段#1）：洞穴是固定的，扫描不足显示「不完整的洞穴」而非闭合墙。
    // 一端已扫 → 沿整条确定性路由画一条**敞口、向未扫端逐渐收窄（r→r×OPEN_TAPER_MIN）、没入黑暗**的通道，
    // 一直伸到未扫节点位置：可去但未扫的相邻节点因此落在开口处的水里（marker 不再浮在墙外）；
    // 不画该节点房间＝内容仍不剧透（只露「这边还有路、通向暗处」）。两端都扫到后换成整条匀宽隧道（同路由·不跳变）。
    const walk = haveA ? pts : [...pts].reverse();
    let total = 0;
    for (let i = 0; i + 1 < walk.length; i++) total += Math.hypot(walk[i + 1].x - walk[i].x, walk[i + 1].y - walk[i].y);
    let acc = 0;
    for (let i = 0; i + 1 < walk.length; i++) {
      const segL = Math.hypot(walk[i + 1].x - walk[i].x, walk[i + 1].y - walk[i].y) || 1;
      const fMid = total > 0 ? (acc + segL / 2) / total : 0; // 0=已扫端 → 1=未扫端
      acc += segL;
      tuns.push({
        ax: walk[i].x,
        ay: walk[i].y,
        bx: walk[i + 1].x,
        by: walk[i + 1].y,
        r: r * (1 - (1 - OPEN_TAPER_MIN) * fMid),
      });
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

/**
 * 标记点投影回最近的「水」里（06-11 三修·红点/接触出墙的**最后一道闸**）：
 * 不管上游怎么错位（路由近似 / voidTrack 一阶误差 / 极坐标接触不看墙），渲染前用**画面同一块 SDF**
 * 裁决——图就是 caveSdf 烤的，caveSdf 说在岩里就螺旋采样找最近水点（确定性·≤42px·找不到原样返回）。
 * 目标取 WALL_LO 再进 1.2＝点落在明显的水里、不贴发光壁。
 */
export function projectIntoWater(
  p: { x: number; y: number },
  cave: { tuns: CaveTun[]; rooms: CaveRoom[] },
): { x: number; y: number } {
  const TARGET = WALL_LO - 1.2;
  if (caveSdf(p.x, p.y, cave.tuns, cave.rooms) <= TARGET) return p;
  // 搜索半径放到 120（作者 06-13「远点出现在墙外」）：远处的琥珀威胁接触本就摆得离你较远（极坐标·far 更远），
  // 42px 够不到洞穴水体 → 留在岩里；放大搜索把它吸到洞穴边缘最近的水里（仍在威胁的大致方向上）。
  for (let r = 3; r <= 120; r += 3) {
    for (let k = 0; k < 14; k++) {
      const ang = (k / 14) * Math.PI * 2 + r * 0.37; // 每圈相位旋开，别全卡同一方向
      const qx = p.x + Math.cos(ang) * r;
      const qy = p.y + Math.sin(ang) * r;
      if (caveSdf(qx, qy, cave.tuns, cave.rooms) <= TARGET) return { x: qx, y: qy };
    }
  }
  return p; // 周围全是岩（不该发生·锚点房已渲染侧并入）——原样返回总比不画好
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
  // 整张「全亮的洞」（水/壁/岩）——揭示三态（黑/暗/亮）由合成层用几何圆遮罩做（见 SonarScanPanel rAF 循环·FOG_DIM 注）。
  for (let gy = 0; gy < outH; gy++) {
    for (let gx = 0; gx < outW; gx++) {
      const wx = rect.x + ((gx + 0.5) / outW) * rect.w;
      const wy = rect.y + ((gy + 0.5) / outH) * rect.h;
      const d = caveSdf(wx, wy, cave.tuns, cave.rooms);
      const i = (gy * outW + gx) * 4;
      const tex = fbm(wx * 0.12, wy * 0.12); // 表面纹理
      const deepK = Math.min(1, Math.max(0, (wy - rect.y) / rect.h));
      shadeSonarSdf(out, i, d, deepK, tex);
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
  // 取景窗横向比例随方框实测宽高比走（作者 06-13「方框很宽但地图窄·该全框显示」）：默认 = 旧 portrait
  // （VIEW_W/VIEW_H·SSR/首帧逐字节同旧）；measure 后 viewW = VIEW_H × frameAspect → viewBox/烤图比例＝方框比例
  // ⇒ `meet`/`object-fit:contain` 不再 letterbox、宽框里横向铺满显示更多世界（纵向深度窗 VIEW_H 不变）。
  const [frameAspect, setFrameAspect] = useState(VIEW_W / VIEW_H);
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const movedRef = useRef(0);
  const camAccRef = useRef<{ dx: number; dy: number; zk: number }>({ dx: 0, dy: 0, zk: 1 });
  const camRafRef = useRef(0);
  // 滚轮缩放走原生 listener（passive:false 才能 preventDefault 页面滚动）；handler 每渲染重指（闭包取最新取景）。
  const wheelRef = useRef<((e: WheelEvent) => void) | null>(null);
  const wheelCleanupRef = useRef<(() => void) | null>(null);
  /** 扫描波班次（06-11 六修·常驻循环制）：key=这班扫描（lastScanTurn）·t0=起播时刻。
   *  播放进度由常驻 rAF 循环按真实流逝时间推——effect/cleanup 永远砍不掉一班进行中的波。 */
  const sweepRef = useRef<{ key: string; t0: number } | null>(null);
  /** 重烤数据（bake effect 写·常驻循环读）：离屏洞穴位图 + 本帧合成所需几何参数。 */
  const bakeRef = useRef<{
    off: HTMLCanvasElement;
    ow: number;
    oh: number;
    haveCave: boolean;
    /** 以前回合扫过的中心圆心（本 canvas 像素）＝暗底并集。 */
    dimCentersPx: { x: number; y: number }[];
    /** 本回合扫描中心圆心（本 canvas 像素）＝亮圆·随扩散点亮；null＝本回合没扫。 */
    brightCenterPx: { x: number; y: number } | null;
    /** 揭示圆半径（本 canvas 像素）。 */
    Rpx: number;
  } | null>(null);
  /** 循环节流：放完且无新烤 → 跳帧（needsRedraw 由 bake effect 置位；doneSweepKey 记最后放完的班次）。 */
  const needsRedrawRef = useRef<boolean>(true);
  const doneSweepKeyRef = useRef<string | null>(null);
  // 面板 CSS 客户端注入 head（一次·SSR 不跑＝输出干净·不污染 smoke 子串断言）。
  useEffect(() => {
    if (typeof document === 'undefined' || document.getElementById(CAVE_STYLE_ID)) return;
    const el = document.createElement('style');
    el.id = CAVE_STYLE_ID;
    el.textContent = CAVE_STYLE;
    document.head.appendChild(el);
  }, []);
  // 实测方框宽高比 → frameAspect（全框显示，作者 06-13）。ResizeObserver 跟随窗口/布局变化；夹 [0.5,3] 防极端。
  useEffect(() => {
    const el = stackRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        const a = Math.min(3, Math.max(0.5, r.width / r.height));
        setFrameAspect((prev) => (Math.abs(prev - a) > 0.01 ? a : prev));
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const run: RunState | undefined = state.run ?? undefined;
  const map = run?.map ?? null;
  const memory = run?.scanMemory ?? {};
  // 持久洞「已探片」预亮（多口持久洞 §6.1）：当前洞跨 run 已探节点叠加进「known」——同一张图、不同已探片。
  // 非洞下潜（run.caveId 缺）→ undefined ⇒ known 计算逐字节不变（旧行为）。
  const persistentExplored = persistentExploredForRun(state.profile, run);
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

  // viewW 随方框比例横向铺开（全框显示·作者 06-13）；纵向深度窗 VIEW_H 不变。默认 frameAspect=VIEW_W/VIEW_H ⇒ viewW=VIEW_W（逐字节同旧）。
  const viewW = VIEW_H * frameAspect;

  // 选中即入画（#118·作者反馈「离得远要调地图才能看到」）：列表/图上选中相邻节点时，
  // 若它在当前视窗外（10% 安全边距），平移视角到「你与它的中点」——两头尽量同框；
  // 保留缩放档、钳制同 clampCam 口径（PAN_MARGIN）。只在选中那一刻平移，不锁视角。
  const panCtxRef = useRef<{ p: { x: number; y: number } | null; here: { x: number; y: number }; w: number; h: number; viewW: number }>({ p: null, here, w: 0, h: 0, viewW: VIEW_W });
  panCtxRef.current = {
    p: (pendingNodeId && layout?.pos[pendingNodeId]) || null,
    here,
    w: layout?.width ?? 0,
    h: layout?.height ?? 0,
    viewW,
  };
  useEffect(() => {
    const { p, here: h0, w, h, viewW: vWidth } = panCtxRef.current;
    if (!p) return;
    setCam((c) => {
      const vw = vWidth / c.z;
      const vh = VIEW_H / c.z;
      const cx = h0.x + c.dx;
      const cy = h0.y + c.dy;
      const inView =
        p.x >= cx - vw / 2 + vw * 0.1 &&
        p.x <= cx + vw / 2 - vw * 0.1 &&
        p.y >= cy - vh / 2 + vh * 0.1 &&
        p.y <= cy + vh / 2 - vh * 0.1;
      if (inView) return c;
      const tx = Math.min(w + PAN_MARGIN, Math.max(-PAN_MARGIN, (h0.x + p.x) / 2));
      const ty = Math.min(h + PAN_MARGIN, Math.max(-PAN_MARGIN, (h0.y + p.y) / 2));
      return { dx: tx - h0.x, dy: ty - h0.y, z: c.z };
    });
  }, [pendingNodeId]);
  const isOpenWater = run ? !zoneAllowsBacktrack(run.zoneId) : false;
  // 渲染侧并入（不写 scanMemory·存档/引擎零变化·揭示与欺骗语义仍归 clarity/sonar）：
  //  ① 你脚下那间永远可见（#1）：人都站在这儿了，眼前这间洞不该是黑的；
  //  ② 猎手 fix 锚点那间也画出来（06-11 二修「红点仍刷在墙外」·quirk #116 补全）：声呐既然回了
  //     它的位置，「那里有水」已被回波证实——只画它所在的房间（及随之自然出现的残段口），通向哪
  //     仍不画（边照旧双端齐才整条·防剧透轴不破）。红点从此永远站在画出来的水里。
  const fixForRender = run && !isOpenWater ? stalkerSonarBlip(run) : null;
  const mergeIds: string[] = [];
  if (!isOpenWater && curId && map?.nodes[curId] && memory[curId] === undefined) mergeIds.push(curId);
  if (
    fixForRender &&
    map?.nodes[fixForRender.nodeId] &&
    memory[fixForRender.nodeId] === undefined &&
    !mergeIds.includes(fixForRender.nodeId)
  ) {
    mergeIds.push(fixForRender.nodeId);
  }
  const renderIds = mergeIds.length > 0 ? [...scannedIds, ...mergeIds] : scannedIds;
  const renderMemory: Record<string, number> =
    mergeIds.length > 0 ? { ...memory, ...Object.fromEntries(mergeIds.map((id) => [id, -1])) } : memory;
  // 最近一次扫描的 turn（任一节点被刷新的最大 stamp）→ 变化即重新雷达扫一遍（波重播 key）。
  let lastScanTurn = -1;
  for (const id of scannedIds) lastScanTurn = Math.max(lastScanTurn, memory[id] ?? -1);
  const curTurn = run?.turn ?? 0;
  // 几何圆战争迷雾（作者 06-13 重设计·见 FOG_DIM/SONAR_REVEAL_R 注）：渲染按「扫描中心」（scanMemory 的键＝在该节点扫过的回合）
  // + 半径 SONAR_REVEAL_R 画圆。暗底＝**所有**扫描中心圆并集（含本回合·会被亮圆盖住）；亮圆＝**本回合**扫描中心
  // （当前节点·若本回合扫到）随扩散圆点亮、盖在暗底上；圆外＝黑（没扫过）。合成在常驻 rAF 循环里 clip 到圆做。
  const dimCenters: { x: number; y: number }[] = [];
  let brightCenter: { x: number; y: number } | null = null;
  if (layout) {
    for (const id of scannedIds) {
      const p = layout.pos[id];
      if (!p) continue;
      dimCenters.push({ x: p.x, y: p.y }); // 所有中心进暗底（本回合那个也在·亮圆会盖上去＝不闪黑）
      if (memory[id] === curTurn) brightCenter = { x: p.x, y: p.y }; // 本回合扫到的中心（scanReveal 只盖当前节点）
    }
  }
  // 「已揭示」＝落在任一扫描中心圆里（几何·与节点 BFS 无关）——给标记定「known/未知」。
  const isRevealed = (p: { x: number; y: number }): boolean =>
    dimCenters.some((c) => Math.hypot(p.x - c.x, p.y - c.y) <= SONAR_REVEAL_R);
  // bake signature 用的扫描指纹（哪些中心·各自回合）→ 扫描或回合推进后重烤。
  const stateSig = `${curTurn}|${scannedIds
    .map((id) => `${id}:${memory[id]}`)
    .sort()
    .join(',')}`;

  // 取景框＝「点亮+暗区域」（所有扫描中心圆·半径 SONAR_REVEAL_R）的世界包围盒 + 略大一圈余量（作者拍板的 zoom/pan 机制）：
  // 无论怎么拖，取景中心都夹在这个盒里（clampViewToBox·见 vbX/vbY + clampCam）＝相机不离开扫过的那片、不会拖进无边黑雾。
  // 盒比视窗大 → 可在盒内平移；盒比视窗小（刚起手只一圈）→ 锁定居中、拖不动（整片已在框内）。
  let boxLoX = here.x - SONAR_REVEAL_R, boxHiX = here.x + SONAR_REVEAL_R;
  let boxLoY = here.y - SONAR_REVEAL_R, boxHiY = here.y + SONAR_REVEAL_R;
  for (const id of scannedIds) {
    const p = layout?.pos[id];
    if (!p) continue;
    boxLoX = Math.min(boxLoX, p.x - SONAR_REVEAL_R);
    boxHiX = Math.max(boxHiX, p.x + SONAR_REVEAL_R);
    boxLoY = Math.min(boxLoY, p.y - SONAR_REVEAL_R);
    boxHiY = Math.max(boxHiY, p.y + SONAR_REVEAL_R);
  }
  boxLoX -= SONAR_BOX_PAD; boxHiX += SONAR_BOX_PAD; boxLoY -= SONAR_BOX_PAD; boxHiY += SONAR_BOX_PAD;

  // 取景窗（#2 缩放/平移）：z 缩放视野尺寸，dx/dy 平移视野中心（世界单位·相对你）。
  const vw = viewW / cam.z;
  const vh = VIEW_H / cam.z;
  // 取景中心 = 你的房间 here + 用户平移 cam，再夹进上面「扫过区域包围盒」（相机不离开矩形·作者拍板）。
  const vbX = clampViewToBox(here.x + cam.dx, vw, boxLoX, boxHiX) - vw / 2;
  const vbY = clampViewToBox(here.y + cam.dy, vh, boxLoY, boxHiY) - vh / 2;

  // 整张固定洞穴（作者 06-13）：geometry 喂**全部节点**＝同地同图、不随扫描 morph、下次来同一洞；
  // 「看不看得到」全交给合成层的几何圆遮罩（黑=圆外 / 暗=旧圆 / 亮=本回合圆），不按扫描子集重建几何。
  const allIds = layout ? Object.keys(layout.pos) : [];
  const fullMemory: Record<string, number> = {};
  for (const id of allIds) fullMemory[id] = 0;
  const cave = layout && !isOpenWater ? buildCaveGeometry(layout, allIds, fullMemory) : { tuns: [], rooms: [] };
  // 开阔水域几何（Phase 2·SPEC §2/§8）：填此前的 isOpenWater 空占位（旧 = 无声呐图·只黑底节点）。
  // 临时从 layout+zone 确定性派生（Phase 2/3 契约·Phase 3 改由 mapgen 从节点喂）；非开阔 / 无 run → null。
  const owGeom = layout && isOpenWater && run ? buildOpenWaterGeometry(layout, getZone(run.zoneId)) : null;

  // canvas（06-11 六修·常驻渲染循环）：本 effect 只负责「重烤数据」（离屏洞穴位图 + 几何参数 → bakeRef）
  // 与「开新一班波」（sweepRef）；**真正的逐帧合成由下面常驻 rAF 循环做**——effect 重跑/cleanup 永远
  // 砍不掉动画（此前五修的「波偶尔被吞」全部源于把 rAF 班次挂在 effect 单次执行里）。
  const signature = `${vbX.toFixed(1)},${vbY.toFixed(1)},${vw.toFixed(1)}|${isOpenWater}|${allIds
    .slice()
    .sort()
    .join(',')}|${stateSig}`;
  useEffect(() => {
    // 画布像素与离屏烤图比例随 viewW（=方框比例）走＝全框显示不 letterbox（作者 06-13）；默认 viewW=VIEW_W 逐字节同旧。
    const W = Math.round(viewW * RENDER_SCALE);
    const rect: CaveRect = { x: vbX, y: vbY, w: vw, h: vh };

    // 离屏半分辨率算洞穴 SDF（§2 半分辨率提速）→ 一次性烤成静态洞穴图（水/壁/岩 + 噪声），之后只做雷达揭示合成。
    const ow = Math.max(1, Math.round(viewW / 2));
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
    } else if (octx && isOpenWater && owGeom) {
      // 开阔水域声呐图（Phase 2·SPEC §2）：边缘型海床 ∪ 结构层·喂同一段 shadeSonarSdf（继承观感·§0）。
      const img = octx.createImageData(ow, oh);
      img.data.set(bakeOpenWaterRGBA(owGeom, rect, ow, oh));
      octx.putImageData(img, 0, 0);
      haveCave = true;
    }

    // 世界 → 本 canvas 像素（缩放/平移后中心不一定在正中）：sx 为 world→px 等比标度（宽高同标度·见 viewW 注）。
    const sx = W / rect.w;
    const toPx = (p: { x: number; y: number }) => ({ x: (p.x - rect.x) * sx, y: (p.y - rect.y) * sx });
    const dimCentersPx = dimCenters.map(toPx); // 以前 + 本回合所有扫描中心圆心（暗底并集）
    const brightCenterPx = brightCenter ? toPx(brightCenter) : null; // 本回合扫描中心圆心（亮·随扩散）
    const Rpx = SONAR_REVEAL_R * sx; // 揭示圆半径（本 canvas 像素）
    // 只更新数据，不画：合成交给常驻循环（cleanup 砍不到它）。三态遮罩＝几何圆 clip（见循环）。
    bakeRef.current = { off, ow, oh, haveCave, dimCentersPx, brightCenterPx, Rpx };
    const keyNow = `${lastScanTurn}`;
    if (!sweepRef.current || sweepRef.current.key !== keyNow) {
      // 新扫描（lastScanTurn 变）→ 开一班新波（一圈装饰余辉·叠在常驻迷雾上·不裁底图）。
      sweepRef.current = {
        key: keyNow,
        t0: typeof performance !== 'undefined' ? performance.now() : Date.now(),
      };
    }
    needsRedrawRef.current = true; // 重烤（含纯平移/缩放）至少重画一帧
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  // 常驻渲染循环（06-11 六修·挂载期唯一一个 rAF·SSR 不跑）：每帧读 bakeRef/sweepRef 合成。
  // 波进行中逐帧画；波放完且无新烤 → 跳帧（零开销）。signature churn 只会改 ref 数据，永远砍不掉这班波。
  useEffect(() => {
    if (typeof requestAnimationFrame !== 'function') return;
    let raf = 0;
    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      const canvas = canvasRef.current;
      const bake = bakeRef.current;
      const sw = sweepRef.current;
      if (!canvas || !bake || !sw) return;
      const k = Math.min(1, (t - sw.t0) / SWEEP_MS); // 线性前缘（恒速·与 SVG 标记「波到才亮」延迟同步）
      const animating = k < 1;
      if (!animating && !needsRedrawRef.current && doneSweepKeyRef.current === sw.key) return; // 静止帧跳过
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const { off, ow, oh, haveCave, dimCentersPx, brightCenterPx, Rpx } = bake;
      // 画布内部分辨率从 bakeRef 的 ow/oh 派生（= viewW/2 × VIEW_H/2·全框比例）——常驻循环读 ref 不拿 viewW 旧闭包。
      const W = ow * 2 * RENDER_SCALE;
      const H = oh * 2 * RENDER_SCALE;
      if (canvas.width !== W) canvas.width = W;
      if (canvas.height !== H) canvas.height = H;

      ctx.clearRect(0, 0, W, H);
      ctx.imageSmoothingEnabled = true;
      if (haveCave) {
        // ① 暗底＝所有扫描中心圆并集、压暗（FOG_DIM）：落在里头＝暗（以前扫过·常驻不回黑·#4）；圆外不画＝黑（没扫过·#2）。
        if (dimCentersPx.length) {
          ctx.save();
          ctx.beginPath();
          for (const c of dimCentersPx) ctx.arc(c.x, c.y, Rpx, 0, Math.PI * 2);
          ctx.clip();
          ctx.globalAlpha = FOG_DIM;
          ctx.drawImage(off, 0, 0, ow, oh, 0, 0, W, H);
          ctx.restore(); // 还原 globalAlpha=1
        }
        // ② 亮圆＝本回合扫描中心，随扩散圆（半径 Rpx*k → Rpx）点亮、盖在暗底上（圆内全亮·#3；圆外仍暗/黑·#4）。
        if (brightCenterPx) {
          const r = animating ? Rpx * k : Rpx;
          ctx.save();
          ctx.beginPath();
          ctx.arc(brightCenterPx.x, brightCenterPx.y, r, 0, Math.PI * 2);
          ctx.clip();
          ctx.drawImage(off, 0, 0, ow, oh, 0, 0, W, H);
          ctx.restore();
          if (animating) {
            // 扩散圆的亮前缘环（雷达余辉装饰·只动画时·标出「点亮到哪了」）。
            ctx.strokeStyle = 'rgba(170,255,240,0.85)';
            ctx.lineWidth = 2 * RENDER_SCALE;
            ctx.beginPath();
            ctx.arc(brightCenterPx.x, brightCenterPx.y, r, 0, Math.PI * 2);
            ctx.stroke();
          }
        }
      }
      if (!animating) doneSweepKeyRef.current = sw.key; // 这班扩散放完→跳帧静止态
      needsRedrawRef.current = false;
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

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

  // 相邻可去节点（§2·只这些画可点标记）：用 NodeSelectView 同一份 choices＝点击声呐图＝触发同一条 move。
  const adj = choices.filter((c) => layout.pos[c.nodeId]);

  // 猎手（§8.7 会过时·mid-edge 插值）：上次被扫到的位置（可能在通道中段）→ 红呼吸点（不要 X）。
  // 落点沿**渲染同源路由**（stalkerRoutePoint·作者 06-11「红点出墙」修复）：隧道是弯折折线，
  // 房心直线插值会把通道中段的点画进岩里；远端未扫时再截进半揭示残段口内。开阔水域无洞壁仍走直线。
  const stalkerFix = !isOpenWater ? fixForRender : stalkerSonarBlip(run);
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
  let threatPos =
    threat && !stalkerFix
      ? {
          x: here.x + Math.cos(threat.angle) * VIEW_R * 0.42 * (0.38 + 0.55 * (1 - threat.proximity)),
          y: here.y + Math.sin(threat.angle) * VIEW_R * 0.42 * (0.38 + 0.55 * (1 - threat.proximity)),
        }
      : null;

  // 出墙最后一道闸（06-11 三修）：红点与琥珀接触在渲染前都过 projectIntoWater——极坐标接触本就不看墙、
  // 路由/voidTrack 也只是近似，最终裁决交给画面同一块 SDF（在岩里就挪到最近的水里）。
  const haveCaveGeom = !isOpenWater && (cave.tuns.length > 0 || cave.rooms.length > 0);
  if (stalkerPos && haveCaveGeom) stalkerPos = projectIntoWater(stalkerPos, cave);
  if (threatPos && haveCaveGeom) threatPos = projectIntoWater(threatPos, cave);

  // 低 san 伪接触（S2）：**感知重做已删**（声呐诚实·SPEC §2.2/§3）——不再画幻影 blip。

  // 你的呼吸点：voidTrack 跟随扭曲后的洞（不浮在岩里）；量程环/取景仍以房间中心 here 为准。
  const youMark = voidTrack(here.x, here.y);

  // —— 「波到才亮」（#3）：标记按波前到达时刻延迟淡入（线性波前 → delay = dist/maxR × SWEEP_MS·与 canvas 同一比例）。
  // 外层 <g key=lastScanTurn>＝只有真扫描会重挂载重播；纯平移/缩放不重弹。 ——
  // 标记淡入（「波到才亮」）与 canvas 扩散圆同径：同一 SONAR_REVEAL_R（以本回合扫描中心为心·扩散到圆边才点亮）。
  const maxRWorld = SONAR_REVEAL_R;
  const waveDelay = (x: number, y: number): CSSProperties => ({
    animationDelay: `${Math.round(Math.min(1, Math.hypot(x - here.x, y - here.y) / Math.max(1, maxRWorld)) * SWEEP_MS)}ms`,
  });

  // —— 缩放/平移交互（#2）：1 指拖动平移 / 2 指捏合缩放 / 滚轮缩放（光标为锚）。rAF 合并＝每帧至多一次重烤。 ——
  const clampCam = (c: { dx: number; dy: number; z: number }) => {
    const z = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, c.z));
    // 平移夹进「扫过区域包围盒」（作者拍板·见上 boxLo/boxHi）：cam 把取景中心推开，clampViewToBox 再把它夹回盒内——
    // 无论怎么拖，相机都不离开点亮+暗的那片（替代旧 PAN_KEEP「以你为锚」夹法）。
    const cx = clampViewToBox(here.x + c.dx, viewW / z, boxLoX, boxHiX);
    const cy = clampViewToBox(here.y + c.dy, VIEW_H / z, boxLoY, boxHiY);
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
    if (!el) return vw / viewW;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return vw / viewW;
    // viewBox 比例已＝方框比例（全框显示）⇒ 不再 letterbox，可视宽＝整框宽（min 防 measure 滞后一帧的过冲）。
    const fitW = Math.min(r.width, r.height * (viewW / VIEW_H));
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
    const fitW = Math.min(r.width, r.height * (viewW / VIEW_H));
    const fitH = fitW * (VIEW_H / viewW);
    const bx = r.left + (r.width - fitW) / 2;
    const by = r.top + (r.height - fitH) / 2;
    const fx = Math.min(1, Math.max(0, (e.clientX - bx) / fitW));
    const fy = Math.min(1, Math.max(0, (e.clientY - by) / fitH));
    const wxp = vbX + fx * vw;
    const wyp = vbY + fy * vh;
    setCam((c) => {
      const z = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, c.z * zk));
      const nvw = viewW / z;
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
          // 原生 dragstart 在 pointer 阈值捕获之前就会开火（选中文本/图形被「拖走」的残影来源）——一律掐掉。
          onDragStart={(e) => e.preventDefault()}
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
            {/* 量程环（已解锁声呐时显示·半径＝SONAR_REVEAL_R 与揭示圆同大）：一眼看出「一记 ping 从你这儿点亮多大一圈」。
                感知重做后声呐＝一记诚实 ping（SPEC §2.2）：射程升级揭示更多跳之外的节点供规划，几何揭示圆本身固定。 */}
            {run.sensors.sonarUnlocked && (
              <circle className="sonar-range-ring" cx={here.x} cy={here.y} r={SONAR_REVEAL_R} />
            )}
            {/* 「波到才亮」组（#3）：key=lastScanTurn＝真扫描重挂载重播淡入；平移/缩放不重弹。 */}
            <g key={`wave-${lastScanTurn}`}>
            {/* 低 san 伪接触（S2）：感知重做已删（声呐诚实·SPEC §2.2）——不再画幻影 blip。 */}
            {/* 相邻可去节点（§2·只这些可点·点击＝触发那条 move choice·与 NodeSelectView 同步）。
                声呐诚实（感知重做 SPEC §2.2）：按真 kind 画·无欺骗表象/无回波/读数乱码。 */}
            {adj.map((c) => {
              const p = layout.pos[c.nodeId];
              if (!p) return null;
              const node = map.nodes[c.nodeId];
              // POI 落点：已扫节点 → 偏心 + voidTrack 跟随扭曲后的洞；未扫但可去的相邻节点（作者 06-13）→
              // 吸附到敞口通道的水里（projectIntoWater·配合上面的敞口通道伸到该节点）＝落在开口处、不再浮在墙外。
              let m = { x: p.x, y: p.y };
              // 已知＝落在某扫描圆里（几何·isRevealed）或脚下/锚点并入（你在那儿/回波证实）或**持久洞跨 run 已探**（§6.1 预亮）。
              // 未知＝可去但本局没扫到、且非持久已探。非洞下潜 persistentExplored=undefined ⇒ 逐字节不变。
              const known = isRevealed(p) || mergeIds.includes(c.nodeId) || (persistentExplored?.has(c.nodeId) ?? false);
              if (known) {
                const o = poiOffset(c.nodeId, node.kind);
                m = voidTrack(p.x + o.dx, p.y + o.dy);
              } else if (haveCaveGeom) {
                m = projectIntoWater({ x: p.x, y: p.y }, cave);
              }
              const glyph = kindGlyph(node.kind);
              const feats = node.features ?? [];
              const isRoom = feats.length > 1;
              const baseR = isRoom ? 9 : 6;
              const isPending = pendingNodeId === c.nodeId;
              return (
                <g
                  key={c.nodeId}
                  className={`sonar-blip sonar-node-marker sonar-wave-in ${kindClass(node.kind)} ${isRoom ? 'is-room' : ''} ${isPending ? 'is-pending' : ''}`}
                  style={waveDelay(m.x, m.y)}
                  onClick={(ev) => {
                    // 图上点击**只做选中/切换选中**（作者 06-11 拍板·替代 06-10 的「再击同点＝前往」）：
                    // 出发永远走下方列表项——图是纯定位层，配合拖拽手势后不会误触发移动/事件。
                    // 拖拽（>6px）不算点；未接 onPendingChange 的调用方（无两段态）保持旧「一击即走」。
                    ev.stopPropagation();
                    if (movedRef.current > 6) return;
                    if (!onPendingChange) onStateChange(moveToNode(state, c.nodeId));
                    else onPendingChange(c.nodeId);
                  }}
                  role="button"
                  tabIndex={0}
                  aria-label={
                    !known
                      ? '选定 未扫到的方向（可去·但还不知道那里有什么）'
                      : isPending
                        ? `已选定 ${node.depth}m——出发请点下方选项`
                        : `选定 ${node.depth}m`
                  }
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
                  <text className="sonar-blip-depth" x={m.x} y={m.y - 10}>
                    {!known ? '? m' : `${node.depth}m`}
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
