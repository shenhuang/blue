// 开阔水域 SDF / 渲染（开阔水域 SPEC §2·Phase 2·quirk #252）—— caveSdf/bakeCaveRGBA 的**兄弟**。
//
// 抽成独立模块（check-file-budget 拆分·SonarScanPanel 超预算·按 gate 建议「拆私有模块」）；仍在 ui 层
// （作者 2026-07-13 选「摆 ui·不进 engine」）·纯函数·无 React/DOM（headless 可跑·look-dev 靠它出图）。
// 独立几何旋钮 OW_* 在 engine/sonarGeometry（**绝不复用** caveWarp/WARP_*/SMIN_K·quirk #252）；上色**共享**
// shadeSonarSdf（防风格漂移·§2.3）；纯噪声/距离 helper（distSeg/fbm/hash01）自 engine/sonar 单一来源 import
// （与洞穴同源·不复制）。
//   d = max( wy − floorY(wx),  结构 field union )  →  边缘型 floor（单值·不碎/不悬空）∪ 坐在海床上的离散结构。
// 2026-07-13 look-dev 反馈三改（本文件这版·二轮：初版按「每个节点插值」实测会在列间距抖出尖峰·收窄成
// 只用分支终点·见 terminalNodeIds）：
//   ① floor 低频形状改由**终点节点**锚点反距离加权插值（不再是单一 baseY 常数）——每条分支的终点自身 x 处
//      海床贴着它的实际深度走·不再飘空；高频细节改「折叠 sin 出尖脊窄谷 + 域扭曲」的 ridge 沙纹，不是圆头正弦。
//   ② rock 去掉「圆顶拱洞」变体（悬空倒 U）·统一走圆钝礁丘。
//   ③ 结构（rock/coral）不再由 buildOpenWaterGeometry 一次性按节点 x 包围盒预建列表，改成 bake 时按
//      实际取景矩形现算（structsInRange）——不管相机怎么平移缩放、开发面板画多大，地形都铺到看得见的最外范围。
// Phase 2/3 契约：buildOpenWaterGeometry 从 layout+zoneId+zoneTag **临时**确定性派生 OwGeom（floor 规格 +
// style + seed）；bakeOpenWaterRGBA 按取景矩形现算结构再喂 openWaterSdf。Phase 3 之后改由 mapgen 派生
// （同一套契约·换喂料源）。

import { hash01, distSeg, fbm } from '@/engine/sonar';
import type { ZoneDef, DiveMap } from '@/types';
import type { MapLayout } from './mapLayout';
import {
  shadeSonarSdf,
  OW_FLOOR_AMP,
  OW_FLOOR_WAVELEN,
  OW_RIPPLE_WARP_DEPTH,
  OW_RIPPLE_WARP_FREQ,
  OW_FLOOR_GAP,
  OW_FLOOR_NOISE,
  OW_CULL_MARGIN,
  OW_STRUCT_MAX_DROP,
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
} from '@/engine/sonarGeometry';

/** 世界取景矩形（烤图用·结构等价 SonarScanPanel 的 CaveRect）。 */
export interface OwRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 开阔水域档（沙/珊瑚/岩/珊瑚礁(岩+珊瑚混合)·由 zone.zoneTagsByDepth 的 tag 派生·SPEC §4 单一真相）。 */
export type OwStyle = 'sand' | 'coral' | 'rock' | 'reef';

/** 边缘型海床 contour 参数（单值 heightfield·派生不入存档·由 zone id + 节点布局确定性算·SPEC §3）。 */
export interface OwFloor {
  /** 每个节点一条锚点（x, y + OW_FLOOR_GAP）：海床低频形状由此反距离加权插值（见 interpAnchorY）——
   *  每个节点（含分支终点）自身 x 附近海床都贴着它走·不再靠一个全局 baseY 常数碰运气对齐。 */
  anchors: Array<{ x: number; y: number }>;
  /** 无锚点兜底基线（anchors 为空时的极端 fallback）。 */
  fallbackY: number;
  /** 每 zone 相位（hash(zoneId) 派生·同 zone 同海床·可复现）。 */
  phase: number;
}

/** 坐在海床上的离散结构（正内 field·max 并集·SPEC §2.2）：胶囊（枝/腿/梁）+ 圆盘（丘/瘤/顶/绒球）。 */
export interface OwStructures {
  disks: Array<{ x: number; y: number; r: number }>;
  caps: Array<{ ax: number; ay: number; bx: number; by: number; r: number }>;
}

/** OwGeom 不再随身带结构列表（结构按取景窗现算·见 structsInRange）——只留 floor + 撒结构要用的 style/seed。 */
export interface OwGeom {
  floor: OwFloor;
  style: OwStyle;
  seed: string;
}

/**
 * 锚点低频形状——反距离加权（IDW·power=2）而非按 x 排序分段插值：
 * 分层布局里同一层的节点共享同一个 y，但不同层的节点常落在**相近甚至相同的 x**（列位置按层各自居中分配·
 * 边之间交叉画）——按 x 排序做分段插值会把「隔壁列一个很浅、隔壁列一个很深」直接拉成尖锐的斜线/尖峰
 * （像倒挂的冰柱），不是海床。IDW 按距离加权平均**所有**锚点，天然平滑、不会在列与列之间炸出尖峰，
 * 且结果恒落在 [min(anchor.y), max(anchor.y)] 之内——离所有节点都远时自然趋于整体的加权平均，不会跑出
 * 取景框下沿（owFloorBottom 的上界推导仍成立）。SPEC「（分支）终点节点贴合海床面」。
 */
function interpAnchorY(wx: number, anchors: Array<{ x: number; y: number }>, fallbackY: number): number {
  if (anchors.length === 0) return fallbackY;
  let wSum = 0, ySum = 0;
  for (const a of anchors) {
    const d = Math.abs(wx - a.x) + 1e-3;
    const w = 1 / (d * d);
    wSum += w;
    ySum += w * a.y;
  }
  return ySum / wSum;
}

/**
 * 高频沙纹细节：**单一圆滑正弦·扁平·波长不规则**（2026-07-14 五轮定稿）。踩过三个坑：
 * ①折叠幂出尖峰——理解错了「尖头朝上」；②双正弦错相位叠加——两个不同波长的正弦相加会在波峰内部炸出
 * 局部小拐点（干涉·flips 从纯正弦 6 次跳到 13 次），肉眼看着有尖角，即使数学上处处光滑；③给相位加
 * fbm 域扭曲想整出"不规则"——量过：这片定义域内 fbm 太接近线性，扭曲不出明显的疏密变化，等于白改。
 * 这版换成**保证不折叠的相位调制**：局部瞬时角速率 rate(t) = k·(1 + m·sin(t·s))，m<1 恒正 ⇒ 相位
 * u(wx)=∫rate 严格单调递增 ⇒ 数学上保证永不折叠/不会长出干涉尖角，同时局部波长真的在
 * WAVELEN/(1+m) 到 WAVELEN/(1−m) 之间来回伸缩（验证过：flips 仍是基线 7 次，但相邻波峰间距从
 * ~29 到 ~68 世界单位不等，肉眼可见的疏密不均）。振幅也调扁（OW_FLOOR_AMP 相对波长更小）。
 */
function rippleDetail(wx: number, floor: OwFloor): number {
  const k = (Math.PI * 2) / OW_FLOOR_WAVELEN;
  const t = wx + floor.phase;
  const u = k * t - ((k * OW_RIPPLE_WARP_DEPTH) / OW_RIPPLE_WARP_FREQ) * Math.cos(t * OW_RIPPLE_WARP_FREQ);
  return OW_FLOOR_AMP * Math.sin(u);
}

/** 某列 wx 的海床世界 y（低频＝节点锚点插值·高频＝ridge 沙纹细节·SPEC §2.4「仍单值·不碎」）。 */
export function owFloorY(wx: number, floor: OwFloor): number {
  return interpAnchorY(wx, floor.anchors, floor.fallbackY) + rippleDetail(wx, floor);
}

/**
 * 开阔水域「水/岩 SDF」（caveSdf 的兄弟·SPEC §2.1/§2.2）：
 *  - 边缘型 floor：垂直有符号距离 wy−floorY(wx)（floor 上=水=负·下=岩=正·单值 ⇒ 不碎/无悬空碎片）；
 *  - 结构层：每个正内 field（r−dist）取 max 并集叠上 floor ⇒ 一像素是岩 ⟺ 在海床下 或 落在任一结构内。
 * < WALL_LO＝水·[WALL_LO,WALL_HI)＝发光边·≥＝透明岩（同 shadeSonarSdf 三档·细结构半宽<WALL_HI ⇒ 整根实心青线）。
 * 确定性·纯函数（headless 可跑·look-dev 靠它出图）。structs 由调用方按取景窗现算好传入（见 structsInRange）。
 */
export function openWaterSdf(wx: number, wy: number, floor: OwFloor, structs: OwStructures): number {
  let d = wy - owFloorY(wx, floor);
  if (OW_FLOOR_NOISE > 0) d += (fbm(wx * 0.05, wy * 0.05) - 0.5) * OW_FLOOR_NOISE;
  const { disks, caps } = structs;
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

/**
 * zone tag → 开阔水域档（既有 tag 兜底·缺省 sand·atoll 优先于单档 tag——同时挂 rock/coral+atoll 时按混合档算）。
 * 注：tag 用 `'atoll'` 不用 `'reef'`——`'reef'` 早已是通用深度带内容池 tag（见 ZoneTag 定义），拿来当
 * 开阔水域渲染档会跟别处「reef 主题内容池」语义打架。
 */
export function openWaterStyleOf(zone: ZoneDef | undefined): OwStyle {
  const tags = zone?.zoneTagsByDepth?.flatMap((s) => s.tags) ?? [];
  if (tags.includes('atoll')) return 'reef';
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

/** 圆钝礁丘（几枚大圆盘并成·非嶙峋·SPEC §5·2026-07-13 去掉「圆顶拱洞」变体：悬空倒 U 视觉上像漂浮的拱门）。 */
function emitRock(structs: OwStructures, x: number, y: number, key: string): void {
  const { disks } = structs;
  const R = OW_ROCK_MOUND_R * (0.8 + 0.4 * hash01('rm' + key));
  disks.push({ x, y: y + R * (1 - OW_ROCK_MOUND_H), r: R }); // 主盘：中心沉 (1−H)R·顶露出 H·R
  const sr = OW_ROCK_SIDE_R * (0.7 + 0.5 * hash01('rs' + key));
  const scy = y + sr * (1 - OW_ROCK_MOUND_H);
  disks.push({ x: x - R * 0.72, y: scy, r: sr }); // 侧盘并成圆钝丘
  disks.push({ x: x + R * 0.72, y: scy, r: sr });
}

/** 沿等距网格（整数网格 `x = i*spacing` 锚定·带 ±0.6·spacing 抖动）在 [xLo,xHi] 内撒点，每点回调 emit(sx,key)。 */
function walkSpacing(
  spacing: number,
  seed: string,
  tag: string,
  xLo: number,
  xHi: number,
  emit: (sx: number, key: string) => void,
): void {
  const jitterSpan = spacing * 0.6;
  const iLo = Math.floor((xLo - jitterSpan) / spacing);
  const iHi = Math.ceil((xHi + jitterSpan) / spacing);
  for (let i = iLo; i <= iHi; i++) {
    const key = `${seed}:${tag}:${i}`;
    const sx = i * spacing + (hash01('owj' + key) - 0.5) * jitterSpan;
    if (sx >= xLo && sx <= xHi) emit(sx, key);
  }
}

/** 某 x 处「实际能站的顶面」：裸沙面，或（若被岩盘覆盖）取岩盘在该 x 处的圆顶弧面——取两者中更浅的一个
 * （谁的顶面更靠水面·谁就是可见表面）。reef 档给珊瑚定根用：珊瑚长在岩盘表面而不是穿模沉进岩体里。 */
function surfaceYAt(sx: number, floor: OwFloor, rockDisks: OwStructures['disks']): number {
  let y = owFloorY(sx, floor);
  for (const d of rockDisks) {
    const ox = sx - d.x;
    if (Math.abs(ox) < d.r) {
      const topY = d.y - Math.sqrt(d.r * d.r - ox * ox);
      if (topY < y) y = topY;
    }
  }
  return y;
}

/**
 * 在 [xLo, xHi] 世界窗口内按档确定性撒结构（sand 档返回空）。索引 i 用整数网格 `x = i * spacing` 锚定
 * （不是从窗口左边界数起）——保证同一格换算出同一个 key，窗口平移/缩放（相机 pan/zoom、dev 面板改画布）
 * 时同一段海床上的礁石/珊瑚形状不变，也不再受节点 x 包围盒限制——铺满调用方给的任意可见范围（SPEC「铺到
 * 看得见的最外范围」，2026-07-13 改·此前用节点包围盒预建一次性列表，两侧超出包围盒的部分永远铺不到）。
 * reef 档＝礁石打底（稀·OW_ROCK_SPACING）+ 珊瑚密布其上（密·OW_CORAL_SPACING·根扎在 surfaceYAt 算出的
 * 岩面/沙面上，不是统一贴平地——礁石区珊瑚长在礁顶、礁石间隙珊瑚长在沙面，SPEC §4「珊瑚礁混合档」）。
 */
function structsInRange(style: OwStyle, seed: string, floor: OwFloor, xLo: number, xHi: number): OwStructures {
  const structs: OwStructures = { disks: [], caps: [] };
  if (style === 'sand') return structs;
  if (style === 'reef') {
    walkSpacing(OW_ROCK_SPACING, seed, 'rk', xLo, xHi, (sx, key) => emitRock(structs, sx, owFloorY(sx, floor), key));
    const rockDisks = structs.disks.slice(); // 珊瑚定根前先定住「已有几块岩盘」·别把珊瑚自己的绒球圈进来当岩面
    walkSpacing(OW_CORAL_SPACING, seed, 'cr', xLo, xHi, (sx, key) =>
      emitCoral(structs, sx, surfaceYAt(sx, floor, rockDisks), key),
    );
    return structs;
  }
  const spacing = style === 'coral' ? OW_CORAL_SPACING : OW_ROCK_SPACING;
  walkSpacing(spacing, seed, style, xLo, xHi, (sx, key) => {
    const sy = owFloorY(sx, floor);
    if (style === 'coral') emitCoral(structs, sx, sy, key);
    else emitRock(structs, sx, sy, key);
  });
  return structs;
}

/**
 * 一节点「没有更深的邻居」⇒ 分支终点（下潜到此必须掉头/上浮的地方·涵盖真死路 + 全图最深层——
 * 后者彼此深度相同、天然共线，前者可能比全图最深浅得多）。分层图 connectsTo 对称（双向含来路），
 * 用「深度」而非「度」判终点——不用另跑 analyzeMap（那是 dev 面板可视化用的重分析，这里只要终点集合）。
 */
function terminalNodeIds(map: DiveMap): Set<string> {
  const terminals = new Set<string>();
  for (const id of Object.keys(map.nodes)) {
    const n = map.nodes[id];
    const hasDeeper = n.connectsTo.some((nid) => (map.nodes[nid]?.depth ?? -Infinity) > n.depth);
    if (!hasDeeper) terminals.add(id);
  }
  return terminals;
}

/**
 * 由布局派生开阔水域几何（Phase 2 临时派生·Phase 3 交给 mapgen·契约＝OwGeom）：
 * floor 锚点＝**分支终点节点**（自身 x）之下 OW_FLOOR_GAP（落进其揭示圆内·游戏内可见）——只挑终点、不是
 * 每个节点：分层图里同一层节点常常落在相近的 x（列位置按层各自居中分配·边之间交叉画），若给路过的每个
 * 中间节点都强行按精确深度插值，会在列与列之间炸出尖锐的尖峰（沙纹变成一排倒挂冰柱，不是海床——2026-07-13
 * look-dev 二轮反馈实测过）。终点数量少、间距天然更宽，IDW 插值出的海床形状更接近真实起伏而非逐点强拟合。
 * 没有 map（理论上不该发生·两个调用方都传了）时退化为用全部节点，不炸但也不精确贴终点。
 * 结构不在这里生成，留给 bake 时按实际取景窗现算（structsInRange）。
 * 确定性·纯函数（同 zone 同 layout 同海床·守感知诚实/可复现·SPEC §3）。
 */
export function buildOpenWaterGeometry(
  layout: MapLayout,
  zone: ZoneDef | undefined,
  map?: DiveMap,
): OwGeom {
  const style = openWaterStyleOf(zone);
  const seed = zone?.id ?? 'ow';
  const anchorIds = map ? terminalNodeIds(map) : new Set(Object.keys(layout.pos));
  let maxY = -Infinity;
  const anchors: Array<{ x: number; y: number }> = [];
  for (const id of anchorIds) {
    const p = layout.pos[id];
    if (!p) continue; // map 与 layout 理论同源·防御一下缺列
    if (p.y > maxY) maxY = p.y;
    anchors.push({ x: p.x, y: p.y + OW_FLOOR_GAP });
  }
  const fallbackY = (isFinite(maxY) ? maxY : layout.height) + OW_FLOOR_GAP;
  const floor: OwFloor = { anchors, fallbackY, phase: hash01('owph' + seed) * 997 };
  return { floor, style, seed };
}

/**
 * 开阔水域几何的世界「下沿」（海床最深谷 + 结构最大下探 OW_STRUCT_MAX_DROP·再留像素余量）。
 * 单一来源给「把整张开阔水域烤进固定画布」的全图渲染（MapDevPanel dev 概览）定取景框下边界——
 * 海床基线在节点之下 OW_FLOOR_GAP，若只取节点包围盒会把海床/礁体裁掉（游戏内是移动取景窗·不暴露）。
 * OW_STRUCT_MAX_DROP 由结构旋钮算·手感调了也不用手抄数字（跟 CAVE_GEOM_MARGIN 同理）。纯函数。
 */
export function owFloorBottom(geom: OwGeom): number {
  let maxAnchorY = geom.floor.fallbackY;
  for (const a of geom.floor.anchors) if (a.y > maxAnchorY) maxAnchorY = a.y;
  return maxAnchorY + OW_FLOOR_AMP + OW_STRUCT_MAX_DROP; // OW_FLOOR_AMP＝正弦幅值上界
}

/**
 * 把开阔水域几何烤成 RGBA（镜像 bakeCaveRGBA·喂同一段 shadeSonarSdf ⇒ 同调色板/观感·守 §0「继承声呐观感」）。
 * 结构按本次取景窗现算（structsInRange·± OW_CULL_MARGIN 余量）——铺满这次实际要画的范围，不再受节点
 * x 包围盒限制。纯函数·不碰 DOM。
 */
export function bakeOpenWaterRGBA(
  geom: OwGeom,
  rect: OwRect,
  outW: number,
  outH: number,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(outW * outH * 4);
  const lo = rect.x - OW_CULL_MARGIN, hi = rect.x + rect.w + OW_CULL_MARGIN;
  const structs = structsInRange(geom.style, geom.seed, geom.floor, lo, hi);
  for (let gy = 0; gy < outH; gy++) {
    for (let gx = 0; gx < outW; gx++) {
      const wx = rect.x + ((gx + 0.5) / outW) * rect.w;
      const wy = rect.y + ((gy + 0.5) / outH) * rect.h;
      const d = openWaterSdf(wx, wy, geom.floor, structs);
      const i = (gy * outW + gx) * 4;
      const tex = fbm(wx * 0.12, wy * 0.12); // 表面纹理（同洞穴）
      const deepK = Math.min(1, Math.max(0, (wy - rect.y) / rect.h));
      shadeSonarSdf(out, i, d, deepK, tex);
    }
  }
  return out;
}
