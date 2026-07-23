// 声呐取景/洞穴几何常量与纯钳制 helper —— 自 ui/SonarScanPanel.tsx 头部抽出的纯几何层
// （历史上 hash01/roomScale01 已迁 engine/sonar.ts·这是那次「渲染兼职库出 ui」的下半截）。
//
// 边界：纯常量 + 纯函数，零 React/DOM（engine ↛ ui·check-boundaries 规则一）。
// 消费方：ui/SonarScanPanel（SDF 渲染/取景）、ui/dev/SonarMapView（全图烤洞·原 MapDevPanel）、scripts/smoke-chart-ui（直测）。

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

// （旧「战争迷雾揭示圆」sonarRevealRadius/SONAR_REVEAL_R_BASE/_STEP 已随声呐无升级化删·2026-07-19：
//   一记 ping 揭示整张图·迷雾成全图三态开关〔黑/亮/灰·SonarScanPanel〕·无 punch 圆无半径。）

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

// floor contour（2026-07-13 改·edge5 反馈·2026-07-14 五轮定稿「扁平·波长不规则」）：低频形状＝节点锚点
// 插值（每节点贴海床面·终点节点不再飘空·见 openWaterRender::owFloorY／buildOpenWaterGeometry 的 anchors）；
// 高频细节＝单一正弦，但相位走「保证不折叠」的调制（rate=k(1+m·sin(t·s))恒正⇒相位积分严格单调）让局部
// 波长在 WAVELEN/(1±OW_RIPPLE_WARP_DEPTH) 间伸缩——量过 flips 不变（纯正弦基线）、波峰间距真的疏密不均。
// 踩过的坑见 SPEC §5.2/§5.3：折叠幂出尖峰／双正弦干涉出尖角／fbm 相位扭曲在这个定义域内太接近线性、
// 扭不出可见疏密。总幅上界 = OW_FLOOR_AMP 必须明显小于 OW_FLOOR_GAP，否则沙纹会在节点锚点处顶穿海床。
export const OW_FLOOR_AMP = 3; // 波幅（世界·2026-07-14 六轮再压——上一版 6 作者反馈仍然「太高」）
export const OW_FLOOR_WAVELEN = 95; // 基准波长（局部随 WARP_DEPTH/WARP_FREQ 在这个值附近伸缩）
export const OW_RIPPLE_WARP_DEPTH = 0.55; // 局部波长伸缩深度（<1·越大疏密差越大·恒正保证相位不折叠）
export const OW_RIPPLE_WARP_FREQ = 0.045; // 疏密调制的空间频率（多远切换一次疏/密）
export const OW_FLOOR_GAP = 30; // 海床基线在节点之下的世界偏移（落进节点揭示圆内·仍可见）
export const OW_FLOOR_NOISE = 0; // floor SDF 层噪声（SPEC §2.4「少加或不加」·默认 0 避免平边零星青点·留旋钮）
export const OW_CULL_MARGIN = 40; // bake 时按取景窗 x 窗口现算/剔除结构的余量（世界·结构按需现算·不再靠预建列表）

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

// 岩矿（SPEC §5「中等圆滑大礁石·几枚大圆盘并成圆钝丘·块间留缝·非嶙峋非尖刺」·edge4 脚注·
// 2026-07-13 去掉「一块带圆顶拱洞」变体——双腿+抛物顶的悬空倒 U 视觉上像漂浮的拱门·作者反馈去掉·
// 2026-07-14 七轮再压间距——作者反馈「平坦部分少点、多点岩石」，块间裸沙缝隙太宽了）
export const OW_ROCK_SPACING = 34; // 礁石沿海床的列间距（原 50·压密后块间仍留缝但明显更挤）
export const OW_ROCK_MOUND_R = 16; // 主圆盘半径
export const OW_ROCK_MOUND_H = 0.78; // 主盘中心高度系数（edge4·中心露出海床 ≈ R×此值）
export const OW_ROCK_SIDE_R = 10; // 侧盘半径（并成圆钝丘）
// 结构最大下探（供 owFloorBottom 算画布下沿·跟随上面旋钮自动调整·别手抄数字·同 CAVE_GEOM_MARGIN 手法）
export const OW_STRUCT_MAX_DROP = Math.ceil(
  Math.max(
    OW_ROCK_MOUND_R * (2 - OW_ROCK_MOUND_H), // 主盘沉入 (1−H)R 后·盘身仍下探到中心+R
    OW_ROCK_SIDE_R * (2 - OW_ROCK_MOUND_H),
    OW_CORAL_DOME_R * 1.4,
  ) + 6,
);

// ─── 侧壁 / 峡谷（#330·开阔水域 SPEC §6·独立旋钮·绝不借 floor/cave 的 WARP_*/SMIN_K）──────────────
// 墙内面＝深度的单值函数 wallInnerX(wy)（每深度一个内壁 x·墙后恒岩）·union 进 openWaterSdf 的 max。
// 起步值·手感一律 defer 作者对真渲染器一次性调（§9·[[defer-number-tuning]]）——别每 session 当 todo 催。
export const OW_WALL_MARGIN = 24; // 墙内面离该侧最外节点 x 的世界余量（防埋点·§6.5 构造保证的 margin）
export const OW_WALL_TAPER = 0.35; // V/U 张开系数：每上浮 1 世界单位·墙内面离图心退多少（0=竖直壁·>0=上宽下窄峡谷·底最窄贴防埋点 clamp·见 wallInnerX 头注 #330）
export const OW_WALL_RIPPLE_AMP = 4; // 墙内面微起伏幅（世界·圆钝非尖脊·被防埋点裁到不越过节点侧）
export const OW_WALL_RIPPLE_WAVELEN = 60; // 墙起伏基准波长（世界）
export const OW_WALL_RIPPLE_WARP_DEPTH = 0.5; // 墙起伏疏密调制深度（<1·瞬时速率恒正保证不折叠·同 §5.3 教训）
export const OW_WALL_RIPPLE_WARP_FREQ = 0.05; // 墙起伏疏密调制空间频率
