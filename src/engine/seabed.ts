// 开阔水域「贴底节点」判定（单一真相·派生不入存档·守感知诚实/可复现·开阔水域 SPEC §3/§4）。
//
// engine 层：渲染层 openWaterRender（ui·锚海床）与事件层 events（engine·atSeabed Condition）
// 共用同一个源——若留在 ui 层，engine 的 events 就没法 import（check-boundaries 规则一 engine↛ui）。
// 故下沉到 engine：ui 可 import engine，反之被守。原 terminalNodeIds 从 ui/openWaterRender 迁来（同逻辑）。

import type { DiveMap, DiveNode, ZoneTag } from '@/types';

/**
 * 「有海床」的开阔水域渲染档 tag（对应 openWaterStyleOf 的实心底面：沙/珊瑚/岩/珊瑚礁混合）。
 * midwater（远洋中层·开阔无底蓝水·锚点③）**不在此集**＝无海床 ⇒ 其终点节点不算贴底、渲染层不铺 floor。
 * 单一真相：改「哪些档有海床」只动这一处（openWaterStyleOf 的档与此对齐）。
 */
const FLOORED_OPENWATER_TAGS: ReadonlySet<ZoneTag> = new Set<ZoneTag>(['sand', 'coral', 'rock', 'atoll']);

export function isFlooredOpenWaterTag(tag: ZoneTag): boolean {
  return FLOORED_OPENWATER_TAGS.has(tag);
}

/**
 * 分支终点＝没有更深邻居的节点（下潜到此必须掉头/上浮）。**仅剩无坐标图的兜底路径在用**（见 seabedNodeIds）。
 *
 * ⚠ 这是个**拓扑近似**：它等价于「全图最深一层」只在**旧层状 DAG**（同层同深 + 边严格向下）下成立。
 * #326 起 mapgen 换成撒点 + Gabriel∪MST **无向**邻近图，「没有更深邻居」退化成「局部深度极大点」——
 * 散落在中层也算数（实测 zone 深度域 70–100m 里 78m/73m 的中层节点被判终点）。故带坐标的图一律走
 * 几何下包络（lowerEnvelopeIds），本函数只服务还没有 `node.x` 的存量图。纯拓扑·确定性。
 */
export function terminalNodeIds(map: DiveMap): Set<string> {
  const terminals = new Set<string>();
  for (const id of Object.keys(map.nodes)) {
    const n = map.nodes[id];
    const hasDeeper = n.connectsTo.some((nid) => (map.nodes[nid]?.depth ?? -Infinity) > n.depth);
    if (!hasDeeper) terminals.add(id);
  }
  return terminals;
}

/**
 * 海床最大**坡度预算**（无量纲 |Δdepth/Δx|·`node.x` 与 `depth` 同为米 ⇒ 与 px 空间同值）。
 * 只用来裁包络链两端那两条「为了够到边缘节点而立起来」的陡边（见 lowerEnvelopeIds），不是画面手感旋钮
 * ——所以留在 engine 这条判定旁边，而不是 sonarGeometry 的 OW_* 里。
 *
 * 取值依据（实测·5 开阔 zone × 40 seed × 宽度倍率 1/4/16/32 扫描·采样步长 0.5px）：渲染层 IDW（power=2·
 * 锚点附近权重发散会把过渡压进极窄的 x 区间）会把**链的弦坡放大约 3 倍**，再叠上沙纹自身的解析坡度上界
 * `OW_FLOOR_AMP·2π/OW_FLOOR_WAVELEN·(1+OW_RIPPLE_WARP_DEPTH) ≈ 0.31`。0.25 的预算实测最终成图坡度
 * ≤ 0.78（含把图撑宽 32× 的极端），对 45°（＝1.0）的门留了约两成余量；再往上（0.35）在宽图上会摸到 0.97。
 */
const SEABED_MAX_GRADE = 0.25;

/**
 * 几何**下包络**＝点集 `(x, depth)` 的上凸包链（Andrew 单调链·单调栈 O(n log n)·确定性纯函数·不碰 RNG），
 * 再把两端过陡的边裁掉。「上」按 depth 轴朝下看＝**最深**那一侧：链上没有任何节点比它更深 ⇒ 全部节点恒在
 * 链**之上**。这就是开阔水域 SPEC §3 原文契约「每 X 列最深可达节点」的连续化版本。
 *
 * 为什么是凸包而不是逐点折线：凸包链是「落在全部节点之下的折线」里最贴的那条，且**斜率沿 x 单调递减**
 * （凹链）⇒ 没有锯齿，且**最陡的两条边必然是首尾两条**——这条性质是下面裁边能奏效的全部原因。
 *
 * **为什么还要裁两端**：单调链的首尾恒是 x 最小/最大的那个点（凸包的极点），哪怕它很浅。硬把它当锚点，
 * 海床就得在图边缘拔起来够它——#326 实测里 `node.3(x=1.2m,d=73)` 与 `node.1(x=1.3m,d=100)` 只差 0.1m 却差
 * 27m 深，IDW 在这 2px 内直接立成 270 的坡（近垂直悬崖 + 针尖，正是本次回归的观感病根）。而「海床在浅节点
 * 下方很远」本就不违反任何不变量（埋节点只可能发生在节点**比脚下海床更深**时），所以这种点根本不需要当
 * 锚点。裁法：只要首边坡 > 预算就丢掉首点、尾边坡 < −预算就丢掉尾点。因为凹链斜率单调，
 * **首尾都合格 ⟺ 全链合格** ⇒ 裁完即得「全链 |坡| ≤ SEABED_MAX_GRADE」的构造保证。
 * 被裁掉的点恒比留下的链首/链尾**浅**（否则那条边不会超预算），而它们所在 x 区间的节点又都在链之下
 * ⇒ 海床仍在它们之下 ⇒ **裁边不会制造埋节点**。
 * 窄深的图（今天 5 个开阔 zone：深度域 30m 而 x 域仅 ~7m）会一路裁到最深那个平台＝近似平海床，
 * 与 #326 之前作者验收过的观感一致；图被撒宽后链会自然多留几个锚点、重新贴合起伏（自适应·无需改这里）。
 *
 * 单位＝**米**（`node.x` 与 `node.depth` 同尺·地图2D坐标 SPEC §1）。渲染层 `deriveMapLayout` 对带坐标图做的是
 * `px = (x, depth) · pxPerMeter` 再整体平移（+ 可能的 X 镜像）＝**等比仿射**，而仿射变换保凸包、保坡度
 * ⇒ **engine 侧按米算出的包络集合与 ui 侧按 px 算的逐点相同**。这正是本判定可以留在 engine（不破
 * check-boundaries 规则一 `engine ↛ ui`·quirk #95）而 renderer 只做米→px 换算的原因。
 *
 * 排序 tie-break：x 升 → depth 降（同 x 只留最深的·浅的会被下面的 cross≥0 弹出）→ id 升（确定性兜底）。
 */
function lowerEnvelopeIds(nodes: DiveNode[]): Set<string> {
  const pts = nodes
    .map((n) => ({ id: n.id, x: n.x as number, d: n.depth }))
    .sort((a, b) => a.x - b.x || b.d - a.d || a.id.localeCompare(b.id));
  // 上凸包（在 (x, depth) 平面上「depth 朝上」＝越深越上）：弹出使链发生逆时针拐折的中间点。
  const cross = (
    o: { x: number; d: number },
    a: { x: number; d: number },
    b: { x: number; d: number },
  ): number => (a.x - o.x) * (b.d - o.d) - (a.d - o.d) * (b.x - o.x);
  const hull: Array<{ id: string; x: number; d: number }> = [];
  for (const p of pts) {
    while (hull.length >= 2 && cross(hull[hull.length - 2], hull[hull.length - 1], p) >= 0) hull.pop();
    hull.push(p);
  }
  // 裁两端超预算的陡边（凹链 ⇒ 首尾边是最陡的两条 ⇒ 裁到首尾合格即全链合格）。
  const grade = (a: { x: number; d: number }, b: { x: number; d: number }): number =>
    b.x === a.x ? Infinity : (b.d - a.d) / (b.x - a.x);
  let lo = 0;
  let hi = hull.length - 1;
  while (hi - lo >= 1 && grade(hull[lo], hull[lo + 1]) > SEABED_MAX_GRADE) lo++;
  while (hi - lo >= 1 && grade(hull[hi - 1], hull[hi]) < -SEABED_MAX_GRADE) hi--;
  return new Set(hull.slice(lo, hi + 1).map((p) => p.id));
}

/**
 * 贴底节点＝**有海床档**（isFlooredOpenWaterTag）节点的**几何下包络**（lowerEnvelopeIds）。
 * midwater（无底蓝水）不参与 ⇒ 整图无有海床档节点＝纯中层 floorless（seabedNodeIds 空）。
 *
 * 语义（单一真相·渲染锚点与事件 atSeabed 门共用此源·**别分裂成两套**）：
 *   「贴底」＝**渲染出来的海床正贴在这个节点身下**。渲染层拿这批节点当 IDW 锚点（各自下沉 OW_FLOOR_GAP），
 *   事件层 atSeabed 用同一批门控珊瑚采集/矿床/海底爬行生物等贴底专属内容——两者恒等是构造保证，不是约定。
 *   被裁掉的两端浅点**不算贴底**（海床在它们下方很远·画面上确实悬空），这与门的语义一致：
 *   门为真 ⟺ 画面上脚下就是海床。旧的「分支终点」近似没有这个性质——#326 后它会把悬在中层的局部深度
 *   极大点判成贴底（实测 70–100m 域里 73m 的节点），采集/矿床内容因此在半空触发。
 *
 * **无坐标兜底**：`node.x` 是 #326（地图2D坐标 SPEC §1）才引入的可选字段，教学单节点 / `zone.warren` /
 * 旧路径生成的图仍然没有。缺 x 时几何包络无从算起，退回旧的 `terminalNodeIds` 拓扑近似（行为与 #326 前一致）。
 * 判据刻意**逐字镜像 `ui/mapLayout.ts::deriveMapLayout` 的 `stored` 谓词（全节点都有有限 x）**：那条谓词决定
 * 渲染层是「直接用真坐标」还是「重心排序派生槽位」——只要有一个节点缺 x，渲染就走派生路径，px 坐标不再是
 * `node.x` 的仿射像，engine 侧按 x 算的包络会与画面对不上。两处必须同进同退。
 * **何时可以拆掉这条兜底**：等所有 mapgen 路径（含教学/warren）都产 `node.x`、`deriveMapLayout` 的派生分支
 * 随之删除时，本分支与 `terminalNodeIds` 一起删。
 *
 * 确定性·纯函数（派生不入存档）。
 */
export function seabedNodeIds(map: DiveMap): Set<string> {
  const all = Object.values(map.nodes);
  const floored = all.filter((n) => isFlooredOpenWaterTag(n.zoneTag));
  if (floored.length === 0) return new Set();
  // 兜底谓词与 deriveMapLayout 的 `stored` 对齐：**全图**（不只 floored 子集）都有有限 x 才走几何包络。
  const stored = all.length > 0 && all.every((n) => typeof n.x === 'number' && Number.isFinite(n.x));
  if (!stored) {
    const seabed = new Set<string>();
    for (const id of terminalNodeIds(map)) {
      const tag = map.nodes[id]?.zoneTag;
      if (tag && isFlooredOpenWaterTag(tag)) seabed.add(id);
    }
    return seabed;
  }
  return lowerEnvelopeIds(floored);
}
