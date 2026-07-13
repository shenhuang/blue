// 开阔水域 SDF / 渲染（开阔水域 SPEC §2·Phase 2·quirk #252）—— caveSdf/bakeCaveRGBA 的**兄弟**。
//
// 抽成独立模块（check-file-budget 拆分·SonarScanPanel 超预算·按 gate 建议「拆私有模块」）；仍在 ui 层
// （作者 2026-07-13 选「摆 ui·不进 engine」）·纯函数·无 React/DOM（headless 可跑·look-dev 靠它出图）。
// 独立几何旋钮 OW_* 在 engine/sonarGeometry（**绝不复用** caveWarp/WARP_*/SMIN_K·quirk #252）；上色**共享**
// shadeSonarSdf（防风格漂移·§2.3）；纯噪声/距离 helper（distSeg/fbm/hash01）自 engine/sonar 单一来源 import
// （与洞穴同源·不复制）。
//   d = max( wy − floorY(wx),  结构 field union )  →  边缘型 floor（单值·不碎/不悬空）∪ 坐在海床上的离散结构。
// Phase 2/3 契约：openWaterSdf 吃 OwGeom（floor 规格 + 结构表）；本 Phase 由 buildOpenWaterGeometry 从
// layout+zoneId+zoneTag **临时**确定性派生，Phase 3 之后改由 mapgen 从节点派生（同一 OwGeom 形状·换喂料源）。

import { hash01, distSeg, fbm } from '@/engine/sonar';
import type { ZoneDef } from '@/types';
import type { MapLayout } from './mapLayout';
import {
  shadeSonarSdf,
  OW_FLOOR_AMP,
  OW_FLOOR_WAVELEN,
  OW_FLOOR_AMP2,
  OW_FLOOR_WAVELEN2,
  OW_SWELL_AMP,
  OW_SWELL_WAVELEN,
  OW_FLOOR_GAP,
  OW_FLOOR_NOISE,
  OW_CULL_MARGIN,
  OW_CORAL_SPACING,
  OW_CORAL_BASE_LEN,
  OW_CORAL_BASE_R,
  OW_CORAL_FAN_LEN,
  OW_CORAL_FAN_SPREAD,
  OW_CORAL_BRANCH_R,
  OW_CORAL_TWIG_R,
  OW_CORAL_TIP_R,
  OW_CORAL_BUMP_R,
  OW_CORAL_DOME_R,
  OW_ROCK_SPACING,
  OW_ROCK_MOUND_R,
  OW_ROCK_MOUND_H,
  OW_ROCK_SIDE_R,
  OW_ROCK_ARCH_EVERY,
  OW_ROCK_ARCH_SPAN,
  OW_ROCK_ARCH_H,
  OW_ROCK_ARCH_RISE,
  OW_ROCK_LEG_R,
  OW_ROCK_BEAM_R,
} from '@/engine/sonarGeometry';

/** 世界取景矩形（烤图用·结构等价 SonarScanPanel 的 CaveRect）。 */
export interface OwRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 开阔水域档（沙/珊瑚/岩·由 zone.zoneTagsByDepth 的 tag 派生·SPEC §4 单一真相）。 */
export type OwStyle = 'sand' | 'coral' | 'rock';

/** 边缘型海床 contour 参数（单值 heightfield·派生不入存档·由 zone id 确定性算·SPEC §3）。 */
export interface OwFloor {
  /** 海床基线世界 y（越大越深）＝最深节点之下 OW_FLOOR_GAP。 */
  baseY: number;
  /** 每 zone 相位（hash(zoneId) 派生·同 zone 同海床·可复现）。 */
  phase: number;
}

/** 坐在海床上的离散结构（正内 field·max 并集·SPEC §2.2）：胶囊（枝/腿/梁）+ 圆盘（丘/瘤/顶/绒球）。 */
export interface OwStructures {
  disks: Array<{ x: number; y: number; r: number }>;
  caps: Array<{ ax: number; ay: number; bx: number; by: number; r: number }>;
}

export interface OwGeom {
  floor: OwFloor;
  structs: OwStructures;
}

/** 某列 wx 的海床世界 y（单值·sin 谐波 + 极缓长起伏·SPEC §2.4「仍单值·不碎」）。 */
export function owFloorY(wx: number, floor: OwFloor): number {
  const TWO_PI = Math.PI * 2;
  return (
    floor.baseY +
    OW_FLOOR_AMP * Math.sin((wx + floor.phase) * (TWO_PI / OW_FLOOR_WAVELEN)) +
    OW_FLOOR_AMP2 * Math.sin((wx + floor.phase * 0.7) * (TWO_PI / OW_FLOOR_WAVELEN2)) +
    OW_SWELL_AMP * Math.sin((wx + floor.phase) * (TWO_PI / OW_SWELL_WAVELEN))
  );
}

/**
 * 开阔水域「水/岩 SDF」（caveSdf 的兄弟·SPEC §2.1/§2.2）：
 *  - 边缘型 floor：垂直有符号距离 wy−floorY(wx)（floor 上=水=负·下=岩=正·单值 ⇒ 不碎/无悬空碎片）；
 *  - 结构层：每个正内 field（r−dist）取 max 并集叠上 floor ⇒ 一像素是岩 ⟺ 在海床下 或 落在任一结构内。
 * < WALL_LO＝水·[WALL_LO,WALL_HI)＝发光边·≥＝透明岩（同 shadeSonarSdf 三档·细结构半宽<WALL_HI ⇒ 整根实心青线）。
 * 确定性·纯函数（headless 可跑·look-dev 靠它出图）。
 */
export function openWaterSdf(wx: number, wy: number, geom: OwGeom): number {
  let d = wy - owFloorY(wx, geom.floor);
  if (OW_FLOOR_NOISE > 0) d += (fbm(wx * 0.05, wy * 0.05) - 0.5) * OW_FLOOR_NOISE;
  const { disks, caps } = geom.structs;
  for (let k = 0; k < caps.length; k++) {
    const s = caps[k];
    const f = s.r - distSeg(wx, wy, s.ax, s.ay, s.bx, s.by);
    if (f > d) d = f;
  }
  for (let k = 0; k < disks.length; k++) {
    const s = disks[k];
    const f = s.r - Math.hypot(wx - s.x, wy - s.y);
    if (f > d) d = f;
  }
  return d;
}

/** zone tag → 开阔水域档（既有 tag 兜底·缺省 sand）。 */
export function openWaterStyleOf(zone: ZoneDef | undefined): OwStyle {
  const tags = zone?.zoneTagsByDepth?.flatMap((s) => s.tags) ?? [];
  if (tags.includes('coral')) return 'coral';
  if (tags.includes('rock')) return 'rock';
  return 'sand';
}

/** 软珊瑚扇 + 圆钝小瘤/圆顶（SPEC §5·edge4：短基 + ±55°宽扇 5–8 细枝·各分1次·枝端绒球；宽≥高·非树）。 */
function emitCoral(structs: OwStructures, x: number, y: number, key: string): void {
  const { caps, disks } = structs;
  const oy = y - OW_CORAL_BASE_LEN; // 短基（trunk）顶＝扇origin
  caps.push({ ax: x, ay: y, bx: x, by: oy, r: OW_CORAL_BASE_R });
  const nB = 5 + Math.floor(hash01('cbn' + key) * 4); // 5–8 枝
  for (let b = 0; b < nB; b++) {
    const t = nB > 1 ? b / (nB - 1) : 0.5;
    const ang = -Math.PI / 2 + (t - 0.5) * 2 * OW_CORAL_FAN_SPREAD; // 上开口·±spread（宽扇）
    const len = OW_CORAL_FAN_LEN * (0.8 + 0.4 * hash01(`cbl${b}` + key));
    const tx = x + Math.cos(ang) * len;
    const ty = oy + Math.sin(ang) * len;
    caps.push({ ax: x, ay: oy, bx: tx, by: ty, r: OW_CORAL_BRANCH_R });
    for (let c = -1; c <= 1; c += 2) {
      // 各分一次（子枝）+ 枝端绒球
      const a2 = ang + c * 0.5;
      const l2 = len * 0.45;
      const cx = tx + Math.cos(a2) * l2;
      const cy = ty + Math.sin(a2) * l2;
      caps.push({ ax: tx, ay: ty, bx: cx, by: cy, r: OW_CORAL_TWIG_R });
      disks.push({ x: cx, y: cy, r: OW_CORAL_TIP_R });
    }
  }
  if (hash01('cbp' + key) < 0.5) disks.push({ x: x + (hash01('cbx' + key) - 0.5) * 8, y, r: OW_CORAL_BUMP_R });
  if (hash01('cdm' + key) < 0.35) {
    const dx = x + (hash01('cdx' + key) - 0.5) * 10;
    disks.push({ x: dx, y: y + OW_CORAL_DOME_R * 0.4, r: OW_CORAL_DOME_R }); // 半沉入海床
  }
}

/** 圆钝礁丘（几枚大圆盘并成·非嶙峋）+ 每 N 座一个圆顶拱洞（双腿+抛物圆顶·内缝＝拱·SPEC §5）。 */
function emitRock(structs: OwStructures, x: number, y: number, key: string, idx: number): void {
  const { caps, disks } = structs;
  if (idx % OW_ROCK_ARCH_EVERY === OW_ROCK_ARCH_EVERY - 2) {
    // 圆顶拱洞（SPEC §5「双腿 + 厚横梁·圆顶拱洞·内角小圆角」）：双腿 + 抛物圆顶（非平横梁）+ 低基座（坐进礁体·不悬空）。
    const lx = x - OW_ROCK_ARCH_SPAN, rx = x + OW_ROCK_ARCH_SPAN;
    const legTopY = y - OW_ROCK_ARCH_H;
    caps.push({ ax: lx, ay: y, bx: lx, by: legTopY, r: OW_ROCK_LEG_R }); // 左腿
    caps.push({ ax: rx, ay: y, bx: rx, by: legTopY, r: OW_ROCK_LEG_R }); // 右腿
    const segs = 6; // 抛物圆顶：左腿顶→apex→右腿顶（上凸弧·apex 抬 RISE·内角自然圆滑）
    let px = lx, py = legTopY;
    for (let s = 1; s <= segs; s++) {
      const tt = s / segs;
      const bx = lx + (rx - lx) * tt;
      const by = legTopY - OW_ROCK_ARCH_RISE * (1 - (2 * tt - 1) * (2 * tt - 1));
      caps.push({ ax: px, ay: py, bx, by, r: OW_ROCK_BEAM_R });
      px = bx; py = by;
    }
    disks.push({ x, y: y + OW_ROCK_SIDE_R * (1 - OW_ROCK_MOUND_H), r: OW_ROCK_SIDE_R * 1.15 }); // 低基座
    return;
  }
  const R = OW_ROCK_MOUND_R * (0.8 + 0.4 * hash01('rm' + key));
  disks.push({ x, y: y + R * (1 - OW_ROCK_MOUND_H), r: R }); // 主盘：中心沉 (1−H)R·顶露出 H·R
  const sr = OW_ROCK_SIDE_R * (0.7 + 0.5 * hash01('rs' + key));
  const scy = y + sr * (1 - OW_ROCK_MOUND_H);
  disks.push({ x: x - R * 0.72, y: scy, r: sr }); // 侧盘并成圆钝丘
  disks.push({ x: x + R * 0.72, y: scy, r: sr });
}

/**
 * 由布局派生开阔水域几何（Phase 2 临时派生·Phase 3 交给 mapgen·契约＝OwGeom）：
 * 海床基线＝最深节点之下 OW_FLOOR_GAP（落进其揭示圆内·游戏内可见）；结构按档沿海床确定性撒（seed=zoneId）。
 * 确定性·纯函数（同 zone 同海床同结构·守感知诚实/可复现·SPEC §3）。
 */
export function buildOpenWaterGeometry(layout: MapLayout, zone: ZoneDef | undefined): OwGeom {
  const ids = Object.keys(layout.pos);
  const style = openWaterStyleOf(zone);
  const seed = zone?.id ?? 'ow';
  let minX = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const id of ids) {
    const p = layout.pos[id];
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  if (!isFinite(minX)) { minX = 0; maxX = layout.width; maxY = layout.height; }
  const floor: OwFloor = { baseY: maxY + OW_FLOOR_GAP, phase: hash01('owph' + seed) * 997 };
  const structs: OwStructures = { disks: [], caps: [] };
  if (style !== 'sand') {
    const spacing = style === 'coral' ? OW_CORAL_SPACING : OW_ROCK_SPACING;
    let i = 0;
    for (let x = minX - OW_CULL_MARGIN; x <= maxX + OW_CULL_MARGIN; x += spacing, i++) {
      const key = `${seed}:${i}`;
      const sx = x + (hash01('owj' + key) - 0.5) * spacing * 0.6;
      const sy = owFloorY(sx, floor);
      if (style === 'coral') emitCoral(structs, sx, sy, key);
      else emitRock(structs, sx, sy, key, i);
    }
  }
  return { floor, structs };
}

/**
 * 开阔水域几何的世界「下沿」（海床最深谷 + 坐海床结构实际下探的最大值·再留像素余量）。
 * 单一来源给「把整张开阔水域烤进固定画布」的全图渲染（MapDevPanel dev 概览）定取景框下边界——
 * 海床基线在最深节点之下 OW_FLOOR_GAP，若只取节点包围盒会把海床/礁体裁掉（游戏内是移动取景窗·不暴露）。
 * 扫真实结构 ⇒ OW_* 手感旋钮改了也不用手抄数字（跟 CAVE_GEOM_MARGIN 同理·随几何自适应）。纯函数。
 */
export function owFloorBottom(geom: OwGeom): number {
  // floor 三谐波都在同相时的最深谷（保守下界）。
  let lo = geom.floor.baseY + OW_FLOOR_AMP + OW_FLOOR_AMP2 + OW_SWELL_AMP;
  for (const s of geom.structs.disks) lo = Math.max(lo, s.y + s.r);
  for (const s of geom.structs.caps) lo = Math.max(lo, Math.max(s.ay, s.by) + s.r);
  return lo + 6; // SDF 噪声 + 像素余量
}

/**
 * 把开阔水域几何烤成 RGBA（镜像 bakeCaveRGBA·喂同一段 shadeSonarSdf ⇒ 同调色板/观感·守 §0「继承声呐观感」）。
 * 结构可横跨整 zone → 先按取景窗 x 窗口剔除（bake 有界·与洞穴 per-pixel 全扫等价成本）。纯函数·不碰 DOM。
 */
export function bakeOpenWaterRGBA(
  geom: OwGeom,
  rect: OwRect,
  outW: number,
  outH: number,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(outW * outH * 4);
  const lo = rect.x - OW_CULL_MARGIN, hi = rect.x + rect.w + OW_CULL_MARGIN;
  const culled: OwGeom = {
    floor: geom.floor,
    structs: {
      disks: geom.structs.disks.filter((s) => s.x + s.r >= lo && s.x - s.r <= hi),
      caps: geom.structs.caps.filter((s) => Math.max(s.ax, s.bx) + s.r >= lo && Math.min(s.ax, s.bx) - s.r <= hi),
    },
  };
  for (let gy = 0; gy < outH; gy++) {
    for (let gx = 0; gx < outW; gx++) {
      const wx = rect.x + ((gx + 0.5) / outW) * rect.w;
      const wy = rect.y + ((gy + 0.5) / outH) * rect.h;
      const d = openWaterSdf(wx, wy, culled);
      const i = (gy * outW + gx) * 4;
      const tex = fbm(wx * 0.12, wy * 0.12); // 表面纹理（同洞穴）
      const deepK = Math.min(1, Math.max(0, (wy - rect.y) / rect.h));
      shadeSonarSdf(out, i, d, deepK, tex);
    }
  }
  return out;
}
