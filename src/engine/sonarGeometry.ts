// 声呐取景/洞穴几何常量与纯钳制 helper —— 自 ui/SonarScanPanel.tsx 头部抽出的纯几何层
// （历史上 hash01/roomScale01 已迁 engine/sonar.ts·这是那次「渲染兼职库出 ui」的下半截）。
//
// 边界：纯常量 + 纯函数，零 React/DOM（engine ↛ ui·check-boundaries 规则一）。
// 消费方：ui/SonarScanPanel（SDF 渲染/取景）、ui/dev/MapDevPanel（全图烤洞）、scripts/smoke-chart-ui（直测）。

/**
 * 纯钳制 helper（smoke Q4 直测）：把取景窗（view 宽）中心夹进内容 [0,extent]——内容比取景窗还小（装得下）→
 * 居中（extent/2），否则夹到视窗刚好不越出内容 ± margin。声呐图 zoom/pan 经 clampViewToBox 用它把相机夹进
 * 「扫过区域的包围盒」（作者拍板的取景机制·见 SonarScanPanel 组件内 boxLo/boxHi + clampCam）。
 */
export function clampViewCenter(center: number, view: number, extent: number, margin: number): number {
  if (view >= extent + 2 * margin) return extent / 2;
  const lo = view / 2 - margin;
  const hi = extent - view / 2 + margin;
  return Math.min(hi, Math.max(lo, center));
}

/**
 * 把取景中心夹进任意世界盒 [lo, hi]（作者拍板的声呐取景机制）：盒比视窗大 → 夹到视窗不越出盒；盒比视窗小 → 居盒中。
 * 声呐图用它把相机锁在「点亮+暗区域的包围盒」里——无论怎么拖，相机都不离开扫过的那片、不会拖进无边黑雾。
 */
export function clampViewToBox(center: number, view: number, lo: number, hi: number): number {
  return lo + clampViewCenter(center - lo, view, Math.max(0, hi - lo), 0);
}

/** 声呐取景的布局比例：压短纵向（pxPerMeter 小·节点更近·§2）+ 同深横向铺开（colW·byLayer 见 mapLayout）。 */
export const SONAR_PX_PER_M = 13;
export const SONAR_COL_W = 32;

/**
 * 有机洞穴几何旋钮（世界单位·声呐渲染重做 §2「真实侧剖洞穴」作者验收 v3）。
 * 隧道＝按边路由的弯折胶囊链（宽度 CH_BASE..CH_BASE+CH_VAR）；房间＝主 blob + 散瓣（半径 ROOM_BASE..+ROOM_VAR）。
 * 域扭曲（domain warp）把直胶囊弯成蜿蜒水道 + 不规则岩壁；smin 平滑并集把相邻房间熔成一间大洞（多 POI 同室）。
 * 全部确定性纯函数（按 node/edge id 派生·同地点同洞·守洞穴一致性 quirk #100）；不入存档·不 bump SAVE_VERSION。
 * 这些是作者验收/调参旋钮（绿≠画对·quirk #91/#93·线上 ?dev 肉眼）。SDF/路由本体在 ui/SonarScanPanel。
 */
export const CH_BASE = 4; // 隧道基础半宽（窄·蜿蜒）
export const CH_VAR = 4; // 隧道半宽随边浮动
export const ROOM_BASE = 13; // 房间基础半径
export const ROOM_VAR = 20; // 房间半径随节点浮动（大小不一的洞室）
export const WARP_AMP = 14; // 域扭曲幅度（越大越蜿蜒/越不规则）
export const WARP_FREQ = 0.022; // 域扭曲频率
export const SMIN_K = 7; // 平滑并集半径（越大越熔成一团·越小房间越分明）
export const CTRL_OFF = 48; // 隧道弯折的最大垂向偏移
export const WALL_LO = -2; // SDF < WALL_LO ＝水道内（蓝）·导出给 smoke 断言投影闸
export const WALL_HI = 2.2; // [WALL_LO, WALL_HI) ＝发光岩壁带（越大壁越厚）

/**
 * 声呐 SDF→RGBA 三档上色（水/发光岩壁/透明岩）——单一来源。
 * 自 ui/SonarScanPanel::bakeCaveRGBA 抽出·洞穴与（未来）开阔水域共享同一段·防风格漂移。
 * 就地写入 out[i..i+3]（纯·无 DOM·无分配）。d=caveSdf/openWaterSdf 值·deepK∈[0,1] 越深越暗·tex=fbm 表面纹理。
 */
export function shadeSonarSdf(out: Uint8ClampedArray, i: number, d: number, deepK: number, tex: number): void {
  if (d < WALL_LO) {
    out[i] = 14 + 16 * tex;
    out[i + 1] = 120 - 50 * deepK + 40 * tex;
    out[i + 2] = 140 - 30 * deepK + 30 * tex;
    out[i + 3] = 235;
  } else if (d < WALL_HI) {
    out[i] = 110 + 40 * tex;
    out[i + 1] = 230;
    out[i + 2] = 215;
    out[i + 3] = 255;
  } else {
    out[i + 3] = 0;
  }
}

/**
 * 有机洞穴几何在「节点中心包围盒」之外可能鼓出的最大世界距离（四向同·房间散瓣/壁龛 ≤1.8×最大房间半径
 * + 域扭曲位移 + 发光岩壁带 + SDF 噪声/像素余量）。**单一来源**：任何把整张洞烤进「刚好等于节点包围盒」
 * 画布的全图渲染（MapDevPanel 全图概览）都要四周留这圈 margin，否则边缘洞壁被画布裁掉（游戏内是移动取景窗·不暴露）。
 * 跟随上面的几何旋钮自动调整·别手抄数字。
 */
export const CAVE_GEOM_MARGIN = Math.ceil(
  1.8 * (ROOM_BASE + ROOM_VAR) + // 房间主 blob + 最远散瓣/壁龛（≤1.8×最大半径）
    0.5 * WARP_AMP + // 域扭曲位移（±0.5×幅度）
    WALL_HI + // 发光岩壁带
    6, // SDF 噪声(±1.75) + 像素余量
);

// ─────────────────────────────────────────────────────────────────────────────
// 开阔水域几何旋钮（开阔水域 SPEC §2.4/§5·独立几何旋钮·作者 2026-07-13 定·quirk #252）。
//
// ⚠ 铁律：**绝不复用**上面洞穴那套 WARP_AMP/WARP_FREQ/SMIN_K/caveWarp——那些是 caveSdf 专用。
// 开阔水域自成一套 floor/结构旋钮 ⇒ 调开阔水域形状绝不牵动洞穴（唯一共享的是配色 shadeSonarSdf·§2.3）。
//
// 架构（openWaterSdf 在 ui/SonarScanPanel·镜像 caveSdf 的摆位）：
//   d = max( wy − floorY(wx),  结构 field union )   ——边缘型 floor（单值·不碎/不悬空）∪ 坐在海床上的离散结构。
//   喂进与洞穴同一段 shadeSonarSdf ⇒ 继承声呐观感（水/发光边/透明岩三档不变）。
// 数值＝SPEC §5 起步值（照 edge4 形态脚注）；**手感一律 defer 到进引擎对着真渲染器一次性调**（[[defer-number-tuning]]·§9）。

// floor contour（单值 heightfield·sin 谐波 + 极缓长起伏·SPEC §5「圆滑正弦沙波·低幅~10–14px + 更细谐波 + 极缓长起伏」）
export const OW_FLOOR_AMP = 11; // 主沙波幅（世界）
export const OW_FLOOR_WAVELEN = 88; // 主沙波长
export const OW_FLOOR_AMP2 = 3.5; // 次谐波幅（更细）
export const OW_FLOOR_WAVELEN2 = 31; // 次谐波长
export const OW_SWELL_AMP = 7; // 极缓长起伏幅
export const OW_SWELL_WAVELEN = 340; // 极缓长起伏波长
export const OW_FLOOR_GAP = 30; // 海床基线在「最深节点」之下的世界偏移（落进最深节点揭示圆内·仍可见）
export const OW_FLOOR_NOISE = 0; // floor SDF 层噪声（SPEC §2.4「少加或不加」·默认 0 避免平边零星青点·留旋钮）
export const OW_CULL_MARGIN = 40; // bake 时按取景窗 x 窗口剔除结构的余量（世界·结构可横跨整 zone·剔除令 bake 有界）

// 珊瑚（SPEC §5「低矮致密连片礁·软珊瑚扇＝短基+±55°宽扇细枝·枝端小绒球·宽≥高·别做树」·edge4 脚注）
export const OW_CORAL_SPACING = 21; // 珊瑚簇沿海床的列间距（密排略叠）
export const OW_CORAL_BASE_LEN = 4.5; // 扇短基长（3.5–5）
export const OW_CORAL_BASE_R = 2.1; // 扇短基半宽
export const OW_CORAL_FAN_LEN = 11; // 扇枝长
export const OW_CORAL_FAN_SPREAD = 0.96; // 扇张角半宽（rad·≈±55°）
export const OW_CORAL_BRANCH_R = 1.6; // 枝半宽（< WALL_HI=2.2 ⇒ 整根落发光带＝实心青线·SPEC §2.3「亮丛」）
export const OW_CORAL_TWIG_R = 1.3; // 分叉子枝半宽
export const OW_CORAL_TIP_R = 1.9; // 枝端绒球半径
export const OW_CORAL_BUMP_R = 3.6; // 圆钝小瘤半径（> WALL_HI ⇒ 暗芯+青边＝「暗块」）
export const OW_CORAL_DOME_R = 6.2; // 小圆顶半径（半沉入海床）

// 岩矿（SPEC §5「中等圆滑大礁石·几枚大圆盘并成圆钝丘·块间留缝·一块带圆顶拱洞·非嶙峋非尖刺」·edge4 脚注）
export const OW_ROCK_SPACING = 50; // 礁石沿海床的列间距（块间留缝）
export const OW_ROCK_MOUND_R = 16; // 主圆盘半径
export const OW_ROCK_MOUND_H = 0.78; // 主盘中心高度系数（edge4·中心露出海床 ≈ R×此值）
export const OW_ROCK_SIDE_R = 10; // 侧盘半径（并成圆钝丘）
export const OW_ROCK_ARCH_EVERY = 4; // 每第 N 座礁石改成拱洞（双腿+圆顶·内缝＝拱洞）
export const OW_ROCK_ARCH_SPAN = 15; // 拱两腿间距（半跨·内缝＝拱洞）
export const OW_ROCK_ARCH_H = 19; // 拱腿高（腿长·顶再由 RISE 起拱）
export const OW_ROCK_ARCH_RISE = 9; // 圆顶起拱高（抛物顶·SPEC「圆顶拱洞」非平横梁）
export const OW_ROCK_LEG_R = 3.6; // 拱腿半宽
export const OW_ROCK_BEAM_R = 3.6; // 圆顶弧半宽
