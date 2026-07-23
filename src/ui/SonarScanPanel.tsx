// 声呐探索图（下潜内）—— 有机洞穴剖面 + 战争迷雾**三层解耦**（声呐渲染重做 SPEC 谱系·2026-07-18 重构）。
//
// 三层（各司其职·互不越界）：
//   ① **背景地图层**（canvas 底图·**不吃揭示**）：整张固定的有机洞穴剖面（buildCaveGeometry(layout)·SDF 并集：
//      边→弯折路由隧道 + 节点→主 blob+散瓣房间·域扭曲+smin·半分辨率）或开阔水域海床（openWaterRender）。
//      确定性按 node/edge id 派生＝同地同图（#100）；纵轴＝真实深度（#92）。
//   ② **战争迷雾层**（合成层·**全图三态**·声呐无升级化 2026-07-19）：声呐无射程无升级——一记 ping 揭示**整张图**。
//      三态＝黑（run.lastScanTurn 空＝本潜没 ping 过·**结构上不合成底图**＝防剧透）/ 亮（sensors.sonar==='ping'＝
//      这一站 ping 过·整图全亮·新 ping 从脚下荡开扩散点亮）/ 灰（ping 过但移动了·整图 FOG_DIM·常驻不回黑——
//      图还在、只是旧了）。旧「逐原点 punch 圆 + 半径=射程」已删。洞穴与开阔水域同一套迷雾。
//   ③ **标记层**（SVG 覆盖·压迷雾之上·2026-07-19 #316 收窄「只画能抵达的 + 敌」）：**只画**相邻可去节点
//      （＝下方 move choices 一一对应·可点·含可退回的来路）+ 你 + 敌——追猎红点（scanStalker 扫描快照·会过期）
//      与女王（warrenHunt.queenNodeId·**扫过后实时常显**·唯一实时敌显·boss 特权）。非相邻节点**不再画定位标记**
//      （旧「位置点总可见/? m 全图」已删）；known（走过/本潜 ping 过/持久已探）→ 字形+深度；未知 → 「? m」。
//      POI 标记偏心落房间内（poiOffset 按 kind）+ voidTrack 跟随扭曲后的洞。琥珀「威胁接触」与残图小地图已删（#316）。
//
// 纯渲染：canvas 在 useEffect 里画（SSR 不跑·只出空 canvas）；语义/可点标记走 SVG 覆盖层（SSR 可断言 + 可点 + 无障碍）。
// 感知重做后声呐诚实（SPEC §2.2）：无欺骗表象——节点按真 kind 画。猎手 stalkerSonarBlip（扫描快照·会过时）。
// 旧 scanMemory（BFS 量程集）/scanOrigins（ping 原点表）已删：门解锁改读 sensors.sonar（活条件·engine/dive-select），
// 猎手听觉改全图必闻（engine/stalker）——渲染只吃 lastScanTurn + sensors.sonar 两个标量。

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import type { GameState, NodeChoice, RunState } from '@/types';
import { deriveMapLayout, type MapLayout } from './mapLayout';
import { moveToNode } from '@/engine/dive';
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
  OW_WALL_MARGIN,
  OW_FLOOR_GAP,
  OW_OPENSIDE_SLOPE,
  OW_OPENSIDE_REVEAL,
  shadeSonarSdf,
} from '@/engine/sonarGeometry';
import { buildOpenWaterGeometry, bakeOpenWaterRGBA, owFloorY } from './openWaterRender';

/** SSR 安全的 useLayoutEffect：renderToString 对 useLayoutEffect 有 dev 告警（smoke 走 SSR），服务端退化为 useEffect（都不跑·无行为差）。 */
const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;
import { zoneAllowsBacktrack, getZone } from '@/engine/zones';
import { persistentExploredForRun } from '@/engine/caves';

/** 纵向取景窗（窄×高·#92 上浅下深）：只显当前节点周围一片（SPEC「默认放大、几乎看不到全貌」）。 */
const VIEW_W = 220;
const VIEW_H = 300;
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
// （旧「半揭示残段 / 敞口通道」STUB_FRAC / OPEN_TAPER_MIN 已随三层解耦删除：背景几何恒完整，
//  「看不看得到」全归迷雾层的全图三态（黑/亮/灰）——几何不再按揭示裁剪。）

/**
 * 已播过扫描波的班次（**模块级·跨挂载**·作者 07-18 bug①「事件推进会重扫一遍」）：
 * 面板随事件视图切换会卸载重挂，ref 归零——若只看 ref，每次重挂都把最新一班波再播一遍（观感＝凭空重扫，
 * 且波心是上一记 ping 的原点、不是你脚下）。一班扫描物理上只发生一次 ⇒ 全局只播一次：挂载时发现这班
 * 已播过 → 直接落「已放完」状态（静态三态即位）；只有真·新 ping（班次变、没播过）才起波。
 */
let sweepPlayedKey: string | null = null;

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
/* （旧 .sonar-node-far 非相邻定位标记已删·#316「只画能抵达的 + 敌」。） */
/* 女王（The Warren·#316·扫过后实时常显·唯一实时敌显）：大一号的红——弥散团 + 环 + 核。 */
.sonar-queen circle.sonar-queen-mass { fill: #ff5a5a; stroke: none; opacity: .14; }
.sonar-queen circle.sonar-queen-ring { fill: none; stroke: #ff5a5a; stroke-width: 2; }
.sonar-queen circle.sonar-queen-core { fill: #ff5a5a; stroke: none; }
/* 「波到才亮」（#3·§3）：标记随扫描波前到达时刻淡入（delay 内联·与线性波前同步）。CSS 客户端注入＝SSR 输出元素照常在（smoke 断言不受影响）。 */
.sonar-wave-in { opacity: 0; animation: sonarWaveIn .4s ease-out forwards; }
/* 两段点击（#5）：图上选中高亮＝下方事件列表项 .event-option.is-pending 同款光边（规则同住此处＝单一来源·列表 DOM 在 NodeSelectView）。 */
.sonar-node-marker.is-pending circle { stroke: #eafffa; stroke-width: 2.2; filter: drop-shadow(0 0 5px rgba(140,255,235,.95)); }
.sonar-pending-ring { fill: none; stroke: #eafffa; stroke-width: 1.6; stroke-dasharray: 4 3; animation: sonarBreath 1.6s ease-in-out infinite; }
.event-option.is-pending { border-color: #7defdc; box-shadow: 0 0 0 1px #7defdc, 0 0 10px rgba(125, 239, 220, .45); }
/* 回正＝图内浮动小图标（作者 2026-07-19 #320）：绝对定位在声呐图右上角——出现/消失**零回流**
   （旧「面板头部行内按钮」出现时会挤动标题行/把图往下推＝加载/拖动后图的位置突变）。 */
.sonar-recenter {
  position: absolute;
  top: 6px;
  right: 6px;
  z-index: 3;
  width: 26px;
  height: 26px;
  padding: 0;
  background: rgba(6, 14, 17, 0.82);
  border: 1px solid rgba(140, 255, 235, 0.35);
  border-radius: 4px;
  color: #8cffeb;
  font-size: 15px;
  line-height: 24px;
  text-align: center;
  cursor: pointer;
}
.sonar-recenter:hover { background: rgba(10, 24, 28, 0.92); border-color: rgba(140, 255, 235, 0.65); }
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
 * 战争迷雾**全图三态**（声呐无升级化 2026-07-19）：洞穴**整张固定**（buildCaveGeometry(layout)·同地同图），
 * bakeCaveRGBA 只把它烤成「整张全亮的洞」；三态在**合成层整幅**做（常驻 rAF 循环）：
 *   黑＝本潜没 ping 过（run.lastScanTurn 空）——**不 drawImage**＝结构上不合成·防剧透；
 *   亮＝这一站 ping 过（sensors.sonar==='ping'）——整图全亮·新 ping 从脚下扩散圆点亮（仅动画期 clip）；
 *   灰＝ping 过但移动了——整图 FOG_DIM（常驻·不回黑＝图还在、只是旧了）。
 * 旧「逐原点 punch 圆·半径=射程」已删（无射程无升级·一记 ping 揭示整张图）。
 */
export const FOG_DIM = 0.4; // 「灰」层亮度（过期整图的残留·合成层 globalAlpha·占位·defer-number-tuning）

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
 * 猎手 blip 的路由落点（作者 06-11「红点出墙」修复）：沿渲染同源路由按弧长取 prog——红点永远落在画出来的
 * 那条水道里（隧道是弯折折线·房心直线插值会画进岩里）。三层解耦后背景几何恒完整、标记压在迷雾之上，
 * 旧「按 scanMemory 截进残段口」已删（位置本就诚实·黑区标记合法）。没这条边 → null（调用方回退直线·罕见）。
 */
export function stalkerRoutePoint(
  layout: MapLayout,
  from: string,
  to: string,
  prog: number,
): { x: number; y: number } | null {
  const pts = edgeRoutePts(layout, from, to);
  if (!pts || pts.length < 2) return null;
  const segL: number[] = [];
  let total = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    const l = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
    segL.push(l);
    total += l;
  }
  if (total <= 0) return pts[0];
  let target = Math.max(0, Math.min(1, prog)) * total;
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
 * 由布局派生有机洞穴几何（确定性·按 node/edge id 派生·同地点同洞·守 #100）——**背景层·不吃揭示**（三层解耦）：
 *  - 每条边 → 弯折路由的隧道（1-2 控制点垂向偏移）+ 随边浮动半宽；
 *  - 每个节点 → 主房间 blob + 1-2 散瓣（不规则形状）+ 偶发死路壁龛（alcove）。
 * 整张洞穴恒完整——「看不看得到」全归迷雾层的全图三态（黑/亮/灰）；旧「按揭示画残段/敞口通道」已删。
 */
export function buildCaveGeometry(layout: MapLayout): { tuns: CaveTun[]; rooms: CaveRoom[] } {
  const tuns: CaveTun[] = [];
  const rooms: CaveRoom[] = [];
  for (const e of layout.edges) {
    const route = routeForEdgeEntry(layout, e);
    if (!route) continue;
    const { pts, r } = route;
    for (let i = 0; i + 1 < pts.length; i++) {
      tuns.push({ ax: pts[i].x, ay: pts[i].y, bx: pts[i + 1].x, by: pts[i + 1].y, r });
    }
  }
  for (const id of Object.keys(layout.pos)) {
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
 * **单一来源**：声呐取景窗（SonarScanPanel，rect＝220×300 窗）与 dev 全图概览（SonarMapView·原 MapDevPanel，rect＝整图）
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
  // 整张「全亮的洞」（水/壁/岩）——迷雾全图三态（黑/亮/灰）由合成层整幅做（见 SonarScanPanel rAF 循环·FOG_DIM 注）。
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
  /** 重烤数据（bake effect 写·常驻循环读）：离屏洞穴位图 + 本帧合成所需迷雾态（全图三态·声呐无升级化）。 */
  const bakeRef = useRef<{
    off: HTMLCanvasElement;
    ow: number;
    oh: number;
    haveCave: boolean;
    /** 全图迷雾三态：'black'＝没扫过（不合成）/ 'dim'＝扫过已过期（FOG_DIM 整图）/ 'bright'＝这一站扫过（整图全亮）。 */
    fog: 'black' | 'dim' | 'bright';
    /** 新 ping 扩散动画期间、波前未及处的底色（ping 前一刻的态）：首扫＝'black'（圆外仍黑）/ 重扫＝'dim'（圆外保持灰）。 */
    underFog: 'black' | 'dim';
    /** 扩散动画原点（本 canvas 像素·波从你脚下荡开）。 */
    originPx: { x: number; y: number };
    /** 扩散完整半径（本 canvas 像素·＝世界 maxRWorld 换算·与 SVG「波到才亮」同速同径）。 */
    sweepRpx: number;
  } | null>(null);
  /** 循环节流：放完且无新烤 → 跳帧（needsRedraw 由 bake effect 置位；doneSweepKey 记最后放完的班次）。 */
  const needsRedrawRef = useRef<boolean>(true);
  const doneSweepKeyRef = useRef<string | null>(null);
  /** 本实例拥有的 SVG「波到才亮」班次（配 sweepPlayedKey·播放中 re-render 不掉 class·重挂载不重弹）。 */
  const waveAnimKeyRef = useRef<string | null>(null);
  // 面板 CSS 客户端注入 head（一次·SSR 不跑＝输出干净·不污染 smoke 子串断言）。
  useEffect(() => {
    if (typeof document === 'undefined' || document.getElementById(CAVE_STYLE_ID)) return;
    const el = document.createElement('style');
    el.id = CAVE_STYLE_ID;
    el.textContent = CAVE_STYLE;
    document.head.appendChild(el);
  }, []);
  // 实测方框宽高比 → frameAspect（全框显示，作者 06-13）。夹 [0.5,3] 防极端；0.01 阈值防抖动 churn。
  // 只碰 refs + setState（稳定）⇒ 下面两个 [] effect 捕获首个实例即可。
  const measureAspect = () => {
    const el = stackRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) {
      const a = Math.min(3, Math.max(0.5, r.width / r.height));
      setFrameAspect((prev) => (Math.abs(prev - a) > 0.01 ? a : prev));
    }
  };
  // **首绘前**同步测量（2026-07-20 修「两边黑边→突跳全宽」）：frameAspect 初值是竖窄默认（220/300），
  // 方框实际更宽时首帧以 letterbox 上屏（object-fit:contain 两侧留黑），等 ResizeObserver（passive effect·
  // paint 后才 observe）补测才跳成全宽——面板随事件视图卸载重挂（见 sweepPlayedKey 注），每次重挂都重演一遍。
  // useLayoutEffect 在 paint 前同步跑：量到真实比例立刻 setState ⇒ React 在浏览器上屏前就以正确比例重渲，
  // 黑边帧根本不产生。SSR 不跑（useIsoLayoutEffect）＝smoke 输出逐字节同旧。
  useIsoLayoutEffect(() => {
    measureAspect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // ResizeObserver 跟随后续窗口/布局变化（首帧已由上面 layout effect 保底）。
  useEffect(() => {
    const el = stackRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measureAspect);
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const run: RunState | undefined = state.run ?? undefined;
  const map = run?.map ?? null;
  // 迷雾层唯一数据源（声呐无升级化·全图三态）：lastScanTurn（黑/非黑 + 扫描波班次）+ sensors.sonar（亮/灰）。
  const everScanned = run?.lastScanTurn !== undefined;
  const fresh = run?.sensors.sonar === 'ping';
  // 持久洞「已探片」预亮（多口持久洞 §6.1）：当前洞跨 run 已探节点叠加进「known」——同一张图、不同已探片。
  // 非持久下潜（run.diveMapId 缺）→ undefined ⇒ known 计算不变（旧行为）。
  const persistentExplored = persistentExploredForRun(state.profile, run);
  // 走过的节点（known 判定 + 标记层 hidden 门豁免来路·§2.4 同口径）。
  const visitedSet = new Set(run?.visitedNodeIds ?? []);

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
  // **量化到偶整数**（2026-07-20·配 frameAspect 实测小数比例）：viewW 的三个消费点各自取整——离屏 ow=round(viewW/2)、
  // bake 的 sx 用 round(viewW×RS)、常驻循环画布宽 ow×2×RS——小数 viewW 会互差 1–2px ⇒ 扩散圆原点/半径微偏 +
  // canvas 光栅比例与 viewBox 精确比例错位 ~1px。偶整数让三处逐字相等（默认 220 本就是偶数＝行为不变）。
  const viewW = Math.round((VIEW_H * frameAspect) / 2) * 2;

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
  // 最近一记 ping 的 turn（run 字段直读·声呐无升级化）→ 迷雾黑/非黑 + 波重播 key；-1＝本潜没 ping 过。
  const lastScanTurn = run?.lastScanTurn ?? -1;
  // 全图迷雾三态（见 FOG_DIM 注）：黑＝没 ping 过 / 亮＝这一站 ping 过（fresh）/ 灰＝ping 过但移动了（stale）。
  // **不 ping 脚下不亮**语义自然保留：落地没 ping ＝黑；ping 过一次后图常驻（亮或灰）、不回黑。
  const fog: 'black' | 'dim' | 'bright' = !everScanned ? 'black' : fresh ? 'bright' : 'dim';
  // bake signature 用的迷雾指纹 → 新 ping / 移动变灰后重合成。
  const stateSig = `${lastScanTurn}|${fog}`;
  // 扫描波班次 key（全局唯一到「这张图的这一班」）：generatedAt+startNode 区分图/潜次，lastScanTurn 区分班次——
  // 供 sweepPlayedKey「一班只播一次」记账（跨挂载·跨 run 不误撞）。
  const sweepKey = `${map?.generatedAt ?? 0}|${map?.startNodeId ?? ''}|${lastScanTurn}`;
  // 本次渲染 SVG「波到才亮」（威胁/猎手）播不播动画：这班没播过（本实例即将播）或本实例正拥有这班（播放中
  // re-render 不掉 class）→ 播；重挂载回来（别处已播）→ 静态直显不重弹。SSR 不跑 effect ⇒ 恒「未播」＝输出不变。
  const waveAnim = (lastScanTurn >= 0 && sweepPlayedKey !== sweepKey) || waveAnimKeyRef.current === sweepKey;
  if (waveAnim) waveAnimKeyRef.current = sweepKey;

  // 开阔水域几何（Phase 2·SPEC §2/§8）：填此前的 isOpenWater 空占位（旧 = 无声呐图·只黑底节点）。临时从
  // layout+zone 确定性派生（Phase 2/3 契约·Phase 3 改由 mapgen 从节点喂）；非开阔 / 无 run → null。
  // **提前到取景盒之前算**（原在 bake 处）：临渊侧要用它的墙包络放开取景盒（下方 #333 续）。
  const owGeom =
    layout && isOpenWater && run
      ? buildOpenWaterGeometry(layout, getZone(run.zoneId), run.map ?? undefined)
      : null;

  // 取景包围盒（三层解耦调整）：位置点层总可见 ⇒ 相机得能拖到全图任意标记——盒＝整张布局范围 ∪ 你，
  // 加余量（clampViewToBox 夹取景中心·钳制机制本身不变）。旧「只框扫过区」/「外扩揭示圆半径」随 punch 圆一起退役。
  let boxLoX = Math.min(0, here.x), boxHiX = Math.max(layout?.width ?? 0, here.x);
  let boxLoY = Math.min(0, here.y), boxHiY = Math.max(layout?.height ?? 0, here.y);
  boxLoX -= SONAR_BOX_PAD; boxHiX += SONAR_BOX_PAD; boxLoY -= SONAR_BOX_PAD; boxHiY += SONAR_BOX_PAD;
  // 单侧墙敞侧放开取景盒（#333 midwater·#335 taper）：默认盒夹在节点包络 + PAD 里，看不到节点外的坡折几何
  // （openSideDrop）——潜水中也该能平移出去看敞侧。横向两态同扩；纵向 midwater 往下（看断崖坠进深渊）·
  // taper 往上（看缓坡升起封边）。boxLoY 上扩只在缓坡真会升出盒顶时才生效（min 夹·深坡折＝no-op）。
  const owWallBox = owGeom?.wall;
  if (owWallBox && owWallBox.side !== 'both') {
    const spanX = OW_WALL_MARGIN + OW_OPENSIDE_REVEAL / OW_OPENSIDE_SLOPE;
    const openLeft = owWallBox.side === 'right'; // 墙在右 ⇒ 左敞
    const breakX = openLeft ? owWallBox.minNodeX - OW_WALL_MARGIN : owWallBox.maxNodeX + OW_WALL_MARGIN;
    if (openLeft) boxLoX = Math.min(boxLoX, owWallBox.minNodeX - spanX); // 左敞
    else boxHiX = Math.max(boxHiX, owWallBox.maxNodeX + spanX); // 右敞
    if (owWallBox.otherSide === 'midwater') {
      boxHiY = Math.max(boxHiY, owWallBox.deepestY + OW_FLOOR_GAP + OW_OPENSIDE_REVEAL); // 往下看坡折坠进深渊一截
    } else if (owGeom) {
      boxLoY = Math.min(boxLoY, owFloorY(breakX, owGeom.floor) - OW_OPENSIDE_REVEAL); // 往上看缓坡升起封边一截
    }
  }

  // 扫描波完整半径（世界单位）：从你脚下荡到布局最远角＝波扫完整张图（canvas 扩散圆与 SVG「波到才亮」同用＝同速同径）。
  const maxRWorld = Math.max(
    1,
    Math.hypot(here.x - boxLoX, here.y - boxLoY),
    Math.hypot(here.x - boxHiX, here.y - boxLoY),
    Math.hypot(here.x - boxLoX, here.y - boxHiY),
    Math.hypot(here.x - boxHiX, here.y - boxHiY),
  );

  // 取景窗（#2 缩放/平移）：z 缩放视野尺寸，dx/dy 平移视野中心（世界单位·相对你）。
  const vw = viewW / cam.z;
  const vh = VIEW_H / cam.z;
  // 取景中心 = 你的房间 here + 用户平移 cam，再夹进上面「扫过区域包围盒」（相机不离开矩形·作者拍板）。
  const vbX = clampViewToBox(here.x + cam.dx, vw, boxLoX, boxHiX) - vw / 2;
  const vbY = clampViewToBox(here.y + cam.dy, vh, boxLoY, boxHiY) - vh / 2;

  // 背景层（三层解耦）：整张固定洞穴＝同地同图、不随扫描 morph、下次来同一洞；「看不看得到」全归迷雾层 punch 圆。
  const allIds = layout ? Object.keys(layout.pos) : [];
  const cave = layout && !isOpenWater ? buildCaveGeometry(layout) : { tuns: [], rooms: [] };
  // （owGeom 已在取景盒之前算·见上方 #333 续 hoist——临渊侧放开取景盒要用其墙包络。）

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
      // 取景窗与 dev 全图概览（SonarMapView）共用同一像素外观（bakeCaveRGBA·单一来源·守洞穴一致性 #100）。
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
    // 全图迷雾三态 + 扩散参数：波从你脚下荡开、半径到世界最远角（maxRWorld·与 SVG「波到才亮」同速同径）。
    // underFog＝新一班波开播前的底态（首扫黑/重扫灰）——波前未及处保持 ping 前一刻的样子（不闪黑）。
    const prevFog = bakeRef.current?.fog;
    const underFog: 'black' | 'dim' =
      sweepRef.current?.key === sweepKey
        ? (bakeRef.current?.underFog ?? 'black') // 同一班（纯平移/缩放重烤）：底态不变
        : prevFog === 'dim' || prevFog === 'bright'
          ? 'dim'
          : 'black';
    bakeRef.current = {
      off, ow, oh, haveCave, fog,
      underFog,
      originPx: toPx(here),
      sweepRpx: maxRWorld * sx,
    };
    if (sweepRef.current?.key !== sweepKey) {
      // 一班扫描全局只播一次（sweepPlayedKey 模块级·跨挂载·作者 07-18 bug①）：真·新 ping（没播过）→ 起波；
      // 重挂载回来（事件推进/视图切换·这班已播过）→ 落「已放完」班次（t0=-∞ ⇒ k=1）＝静态三态即位、不重播。
      const shouldPlay = lastScanTurn >= 0 && sweepPlayedKey !== sweepKey;
      sweepRef.current = {
        key: sweepKey,
        t0: shouldPlay
          ? typeof performance !== 'undefined'
            ? performance.now()
            : Date.now()
          : Number.NEGATIVE_INFINITY,
      };
      if (shouldPlay) sweepPlayedKey = sweepKey;
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
      const { off, ow, oh, haveCave, fog, underFog, originPx, sweepRpx } = bake;
      // 画布内部分辨率从 bakeRef 的 ow/oh 派生（= viewW/2 × VIEW_H/2·全框比例）——常驻循环读 ref 不拿 viewW 旧闭包。
      const W = ow * 2 * RENDER_SCALE;
      const H = oh * 2 * RENDER_SCALE;
      if (canvas.width !== W) canvas.width = W;
      if (canvas.height !== H) canvas.height = H;

      ctx.clearRect(0, 0, W, H);
      ctx.imageSmoothingEnabled = true;
      // 全图迷雾三态（声呐无升级化）：黑＝不 drawImage（结构上不合成·防剧透）/ 灰＝整图 FOG_DIM /
      // 亮＝整图全亮（新 ping 扩散动画期间用扩散圆 clip 从脚下点亮·波前未及处保持 underFog 底态＝首扫黑外圈、重扫灰外圈）。
      if (haveCave && fog !== 'black') {
        if (fog === 'dim') {
          ctx.globalAlpha = FOG_DIM;
          ctx.drawImage(off, 0, 0, ow, oh, 0, 0, W, H);
          ctx.globalAlpha = 1;
        } else {
          // bright
          if (animating && underFog === 'dim') {
            // 重扫：波前未及处保持旧灰底（不闪黑）。
            ctx.globalAlpha = FOG_DIM;
            ctx.drawImage(off, 0, 0, ow, oh, 0, 0, W, H);
            ctx.globalAlpha = 1;
          }
          const r = animating ? sweepRpx * k : 0;
          if (animating) {
            ctx.save();
            ctx.beginPath();
            ctx.arc(originPx.x, originPx.y, r, 0, Math.PI * 2);
            ctx.clip();
            ctx.drawImage(off, 0, 0, ow, oh, 0, 0, W, H);
            ctx.restore();
            // 扩散圆的亮前缘环（雷达余辉装饰·只动画时·标出「点亮到哪了」）。
            ctx.strokeStyle = 'rgba(170,255,240,0.85)';
            ctx.lineWidth = 2 * RENDER_SCALE;
            ctx.beginPath();
            ctx.arc(originPx.x, originPx.y, r, 0, Math.PI * 2);
            ctx.stroke();
          } else {
            ctx.drawImage(off, 0, 0, ow, oh, 0, 0, W, H);
          }
        }
      }
      if (!animating) doneSweepKeyRef.current = sw.key; // 这班扩散放完→跳帧静止态
      needsRedrawRef.current = false;
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  // callback ref：stack 可能晚于 mount 出现（先空态后成图），用它挂/卸 wheel listener（passive:false）。
  // useCallback 稳定身份（2026-07-20）：内联函数每次 render 重建会让 React 每帧「先 null 卸再挂」——
  // wheel listener 反复拆装 + stackRef 短暂置空，纯 churn。只碰 refs ⇒ [] 恒安全。
  const stackCb = useCallback((el: HTMLDivElement | null) => {
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
  }, []);

  // ---- 早退（hooks 已全部在上方按序调用）----
  if (!run || !map || !layout) return null;
  // 没有单独的「空态面板」（三层解耦）：没 ping 过＝画布全黑 + 位置点标记照常压在迷雾上（位置总可见）——
  // 头部副标给「扫一记」提示。旧 renderIds 空态早退随 mergeIds 一起退役。

  // 位置点层·相邻可去（可点档）：用 NodeSelectView 同一份 choices＝点击声呐图＝触发同一条 move。
  const adj = choices.filter((c) => layout.pos[c.nodeId]);

  // 猎手（§8.7 会过时·mid-edge 插值）：上次被扫到的位置（可能在通道中段）→ 红呼吸点（不要 X）。
  // 落点沿**渲染同源路由**（stalkerRoutePoint·作者 06-11「红点出墙」修复）：隧道是弯折折线，
  // 房心直线插值会把通道中段的点画进岩里。开阔水域无洞壁仍走直线。
  const stalkerFix = stalkerSonarBlip(run);
  let stalkerPos: { x: number; y: number } | null = null;
  if (stalkerFix) {
    const a = layout.pos[stalkerFix.nodeId];
    if (a) {
      if (stalkerFix.edgeTo && layout.pos[stalkerFix.edgeTo] && stalkerFix.edgeProg !== undefined) {
        const b = layout.pos[stalkerFix.edgeTo];
        const t = stalkerFix.edgeProg;
        const onRoute = !isOpenWater
          ? stalkerRoutePoint(layout, stalkerFix.nodeId, stalkerFix.edgeTo, t)
          : null;
        stalkerPos = onRoute
          ? voidTrack(onRoute.x, onRoute.y)
          : voidTrack(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t); // 直线回退（开阔水域/极端无知态）
      } else {
        stalkerPos = voidTrack(a.x, a.y);
      }
    }
  }

  // （旧「威胁接触」琥珀 blip 已删·#316：alert 驱动·方位按 turn 漂移＝不扫描也每回合动，与「信息只在扫描时更新」相悖。）

  // 出墙最后一道闸（06-11 三修）：敌显标记在渲染前都过 projectIntoWater——路由/voidTrack 只是近似，
  // 最终裁决交给画面同一块 SDF（在岩里就挪到最近的水里）。
  const haveCaveGeom = !isOpenWater && (cave.tuns.length > 0 || cave.rooms.length > 0);
  if (stalkerPos && haveCaveGeom) stalkerPos = projectIntoWater(stalkerPos, cave);

  // 女王（The Warren·#316 作者拍板「扫过后实时常显」）：本潜 ping 过一次后、她的**真实**卵室位置常显——
  // 唯一的实时敌显（boss 特权·声呐成为追猎女王的搜寻工具）；她撤退（relocate）标记跟着走、图变灰也不消失。
  // 追猎红点仍是扫描快照（别把实时语义下放给普通猎手）。没扫过＝不画（图还全黑·quirk #263）。
  const queenId = run.warrenHunt?.queenNodeId;
  let queenPos =
    everScanned && queenId && layout.pos[queenId]
      ? voidTrack(layout.pos[queenId].x, layout.pos[queenId].y)
      : null;
  if (queenPos && haveCaveGeom) queenPos = projectIntoWater(queenPos, cave);

  // 低 san 伪接触（S2）：**感知重做已删**（声呐诚实·SPEC §2.2/§3）——不再画幻影 blip。

  // 你的呼吸点：voidTrack 跟随扭曲后的洞（不浮在岩里）；取景仍以房间中心 here 为准（量程环已随无射程删）。
  const youMark = voidTrack(here.x, here.y);

  // —— 「波到才亮」（#3·现只作用于**扫描驱动**的标记＝威胁/猎手快照）：按波前到达时刻延迟淡入
  // （线性波前 → delay = dist/maxRWorld × SWEEP_MS·与 canvas 扩散圆同径同速——maxRWorld 在上方与包围盒一起算）。
  // 位置点层总可见＝**不再**随扫描重挂载重弹（每记 ping 全图标记闪一遍会打脸「总可见」）——canvas 扩散动画仍在。
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
  const camMoved = cam.z !== 1 || cam.dx !== 0 || cam.dy !== 0;

  // （旧「非相邻定位标记」farMarkers 层与残图小地图已删·#316「只画能抵达的 + 敌」：
  //   非相邻节点不再画任何标记——地形轮廓扫过仍全图可见，但「哪里有节点」只显示你此刻能去的；
  //   hidden 门过滤对标记层不再需要（choices 已经过 enterNodeSelection 的 nodeMarkerVisible 过滤）。）

  return (
    <div className={`sonar-panel ${isOpenWater ? 'is-open-water' : ''}`}>
      <div className="sonar-panel-head">
        <span className="sonar-panel-title">声呐图</span>
        <span className="sonar-panel-sub">
          {!everScanned
            ? '一片黑。扫一记，听听四周。'
            : isOpenWater
              ? '开阔水域——没有洞壁可循，只有黑暗里的接触与读数。'
              : '回波凿出的洞——蓝是水路，暗是岩。会过时，信几分由你。'}
        </span>
        {/* （回正按钮 #320 移进图内右上角浮动小图标——头部行内出现/消失会挤动布局·见 stack 内 .sonar-recenter。） */}
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
            {/* （旧「量程环」已随声呐无升级化删；旧「非相邻定位标记」已随 #316 删——只画能抵达的 + 敌。） */}
            {/* —— 标记层（压迷雾之上·只画相邻可去 + 你 + 敌）—— */}
            {/* 相邻可去节点（可点·点击＝触发那条 move choice·与 NodeSelectView 同步）。
                声呐诚实（感知重做 SPEC §2.2）：按真 kind 画·无欺骗表象/无回波/读数乱码。 */}
            {adj.map((c) => {
              const p = layout.pos[c.nodeId];
              if (!p) return null;
              const node = map.nodes[c.nodeId];
              // known＝走过（visited）/本潜 ping 过（一记 ping 全图具名）/持久洞跨 run 已探（§6.1 预亮）；未知＝还没扫过。
              const known = visitedSet.has(c.nodeId) || everScanned || (persistentExplored?.has(c.nodeId) ?? false);
              // 落点**恒用同一锚**（作者 2026-07-19 #319「ping 后节点不许突然跳位」）：known 与否都取 poiOffset
              // 偏心位——旧「未知＝房心、扫到瞬间跳去偏心位」的突变已删。known 只切字形/深度文案（「? m」→真值），
              // 位置从头到尾稳定。kind 不因此泄漏：相邻节点的地标身份在下方选项列表本就恒诚实（豁免门·§2.3）。
              // 都过 voidTrack 跟随扭曲后的洞——背景几何恒完整（每节点必有房间＝落点必在水里）。
              const o = poiOffset(c.nodeId, node.kind);
              const m = voidTrack(p.x + o.dx, p.y + o.dy);
              const glyph = kindGlyph(node.kind);
              const feats = node.features ?? [];
              const isRoom = feats.length > 1;
              const baseR = isRoom ? 9 : 6;
              const isPending = pendingNodeId === c.nodeId;
              return (
                <g
                  key={c.nodeId}
                  className={`sonar-blip sonar-node-marker ${kindClass(node.kind)} ${isRoom ? 'is-room' : ''} ${isPending ? 'is-pending' : ''}`}
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
            {/* 「波到才亮」组（#3·只剩**扫描驱动**的快照标记＝猎手；琥珀威胁已删 #316）：key=lastScanTurn＝
                真扫描重挂载重播淡入；平移/缩放不重弹。 */}
            <g key={`wave-${lastScanTurn}`}>
            {/* 猎手（§5 观感·§8.7 会过时）：红呼吸点 + 外圈（不要 X）·mid-edge 插值·大型生物一大团。
                wave-in 包外层（与 sonar-pulse 的 animation 互斥·同元素会互盖）。 */}
            {stalkerFix && stalkerPos && (
              <g className={waveAnim ? 'sonar-wave-in' : undefined} style={waveAnim ? waveDelay(stalkerPos.x, stalkerPos.y) : undefined}>
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
            {/* 女王（The Warren·#316·扫过后**实时**常显·不在 wave 组＝不随扫描班次重弹）：
                大一号的红——她撤退标记跟着走；图变灰也不消失（boss 特权·quirk #263）。 */}
            {queenPos && (
              <g className="sonar-queen sonar-pulse" aria-label="女王">
                <circle className="sonar-queen-mass" cx={queenPos.x} cy={queenPos.y} r={22} />
                <circle className="sonar-queen-ring" cx={queenPos.x} cy={queenPos.y} r={13} />
                <circle className="sonar-queen-core" cx={queenPos.x} cy={queenPos.y} r={5} />
              </g>
            )}
            {/* 你（呼吸点 + 外圈·青·不要 X·§5 观感） */}
            <g className="sonar-you sonar-pulse">
              <circle className="sonar-you-ring" cx={youMark.x} cy={youMark.y} r={7} />
              <circle className="sonar-you-core" cx={youMark.x} cy={youMark.y} r={3} />
            </g>
          </svg>
          {/* 回正（#2 → #320 图内浮动小图标）：缩放/平移过才出现（绝对定位＝出现/消失零回流；
              SSR 默认视角＝不渲染·smoke Q2 断言零影响）。stopPropagation：别让点它触发平移跟踪/取消选中。 */}
          {camMoved && (
            <button
              className="sonar-recenter"
              title="回正（回到你所在位置·恢复默认缩放）"
              aria-label="回正"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                setCam({ dx: 0, dy: 0, z: 1 });
              }}
            >
              ⌖
            </button>
          )}
        </div>
        {/* （残图小地图已删·#316：已扫全图点位泄拓扑、与「不显示所有节点」相悖；方位感靠主图缩放/平移。） */}
      </div>
    </div>
  );
}
