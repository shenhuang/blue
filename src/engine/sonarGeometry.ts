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
