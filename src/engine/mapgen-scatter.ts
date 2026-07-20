// mapgen 撒点脊柱（地图2D坐标 SPEC·Phase 2·2026-07-20）——真 2D 坐标的「先撒点、后连边」核心管线
//
// 病根（SPEC §0）：旧 mapgen 连边按放置序号窗口（`[i-4,i-1]`）不看位置，渲染层事后铺点 ⇒「画得近的没连边」。
// 根治＝倒转因果：**先有位置（撒点·y≡深度）、后有边（Gabriel∪MST 邻近图）**。maze / layered 两个生成器共用本
// 脊柱（提取不复制·SPEC §4「四车道」之 mapgen 车道），各自只做「节点类型/事件/地标」上层。
//
// —— 撒点 = 预置种子 + **分层撒点**（stratified·非纯 Bridson·因「点少+深度跨度大」·见 scatterPoints 头注）——
// 预置：entrance（域顶 y=d0）+ 两个最深点（域底 y=d1·x-分离）；其余按深度分层、每层一带各钉一点（层内 x 抖动）。
// 由此深度**铺满全跨度、绝无中缝** ⇒ 连通骨架（含 MST）只连相邻带、边天然短（组织式生长 Bridson 在此规模会围
// 种子聚成上下两团、留大中缝→MST 跨缝成度量几十的长边·实测换分层后最长边骤降）。
//
// —— 诚实靠「构造」而非「事后修补」（坐标诚实门 scripts/playthrough-coords2d.ts 靠这个绿）——
//   ③ 非相邻不假熔：分层间距 + 层内 minDist ⇒ 任意两点足够分开；删边（把死路/最深点/出口修剪成 degree-1）只动
//      **边**、不动**点** ⇒ 剩下的非相邻对间距不变 ⇒ 永不假熔（不需要「分离修复」推点·那会连带拉长边→自相矛盾）。
//      阈值 NONADJ_MIN_FACTOR 取整数量化下限（见其注·depth 是整数·同 x 差 1 米恰度量 1.0）。
//   ② 起点全局唯一最浅：entrance 钉域顶 y=d0·填充区留 1m 顶带（fill y≥d0+DY）⇒ 其余点 round(depth)>d0 严格。
//   最深点：2 个 x-分离的预置种子在 d1（不后移·边即真实相邻）⇒ deepestNodeIds≥2·局部极大·且不塌陷不互相假熔。
// ④ 有边不画远＝EDGE_MAX_FACTOR（占位·按实测最长 Gabriel/MST 骨架边定·节点少+深度跨度大的图边天然偏长）。
//
// —— 洞型谱 k：作用于**分层撒点的层位映射**（在最终 y 空间采样·纯确定性·不耗 rng·2026-07-20 修正）——
// 分层把 n−3 个填充点摊到 numLevels 层·每层**均匀**层位 frac_u∈[0,1] 先经 `frac_u^k` 压成最终深度比例、
// 再落点（层边界映到 y = yLo + frac_u^k·(yHi−yLo)）⇒ 撒点/连边/结构编排**全在最终坐标上做**、minDist 也在
// 最终 y 上判 ⇒ 诚实不变量（②起点唯一最浅·③非相邻不假熔）**构造性成立于真实坐标**。填充区始终留 1m 顶带
// （fill y≥yLo=d0+DY·曲线作用在层位、不作用在保留带）⇒ 无论 k 多大填充点都 round>d0、入口严格唯一最浅。
// 旧法「撒点/连边在 k=1 空间做完、末端只重映射 y 不动边」在 k≠1 时把点挤过 minDist / 挤出域顶带 → 假熔 + 入口
// 并列（复审 9 万图 fuzz 实证：k=2.6 下 100% 入口非唯一、78% 假熔）——本次根治即把 k 移进最终空间采样。
// k=1（含缺省无 seedKey 路径）时 `frac_u^1=frac_u` ⇒ 与显式 k=1 **逐字节同图**（同路径·pow 不耗 rng）。k≠1 的
// rng 流会随 minDist 接受与否而漂（点集因 k 不同）——无测试要求跨 k 同流；洞型谱①三档 meanDepthFrac 仍随 k
// 单调（frac_u^k 逐层单调·聚合档差由「域按容量推宽」腾出的横向空间保住）·②极端 k 不破迷路·③缺省=k1。
// horizontal 深度锁带传 k=1（忽略洞型谱）。决策见 SPEC §3③ / §2① 注。
//
// 全流程只用传入 `rng`（禁 Math.random/Date·守 #98 同地同图）；迭代顺序显式确定。本文件自足·不依赖 mapgen-shared。

// ============================================================
// 常量（**全部占位待调**·[[defer-number-tuning]]·作者末期统调）
// ============================================================

/** Poisson 最小间距椭圆**横**半轴（米）＝换算自现视觉密度（colW34 / pxPerMeter20 = 1.7m·SPEC §3③）。占位待调。 */
export const SCATTER_MIN_DX = 1.7;
/** Poisson 最小间距椭圆**纵**半轴（米）＝纵向 blip 直径当量（pxPerMeter20 → ~1m）。占位待调。 */
export const SCATTER_MIN_DY = 1.0;
/**
 * 非相邻分离阈值系数（× 椭圆度量单位）＝warren 诚实门同思路「非相邻不假熔」（SPEC §2/§3）。
 * 取 1.0：depth 入 DiveNode 是**整数**（渲染 y=depth·量化到 1m）⇒ 同 x、深度差 1 的两点度量恰 =1.0，是
 * 「非相邻」能达到的几何下限；再高就会被整数量化的合法邻近对擦穿。撒点实际按**分层间距**铺开（见 scatterPoints·
 * 每层一深度带·层内 minDist 拦叠）⇒ 绝大多数对远大于此·此阈值只兜「整数量化下限」。占位待调。
 */
export const NONADJ_MIN_FACTOR = 1.0;
/**
 * 边长上限系数（× 椭圆度量单位）：超此长度的非 MST 边裁掉——「有边不许画老远」（SPEC §0 病根反向）。
 * 节点少 + 深度跨度大（如 vertical_test 13 点跨 43m）⇒ 相邻天然隔数米、连通所需的骨架边（含 MST）偏长，
 * 故此上限不是「几米」而是「十几个椭圆单位」；按实测最长骨架边留裕量定（占位·坐标诚实门 ④ 用它·
 * 真要更短须加节点预算或缩深度窗·集成侧协调·[[defer-number-tuning]]）。占位待调。
 * 20.0＝覆盖洞型谱极端档（k=0.45 稀顶入口井边 / k=2.6 稀底深井边·coords2d 门 D 段 k 三档×40 seed 实测
 * 最长 18.0——「廊+坑」的长竖井是**设计**·非画远缺陷；k=1 实测最长 14）。
 */
export const EDGE_MAX_FACTOR = 20.0;

/** 边数预算系数（≈ N × 此值·超预算按长度从长到短裁·MST 边不拆）。占位待调。 */
const EDGE_BUDGET_FACTOR = 1.7;
/** Bridson 每个活跃点的候选尝试数。占位待调。 */
const BRIDSON_K = 30;
/**
 * 分层撒点**同深最小间距**（椭圆度量·略高于 NONADJ·含整数 round 裕量）——scatterPoints 拦「同深 x-叠」+
 * buildDomain 容量推宽（每点占一个 minDist×minDist 椭圆单元）**共用同一源**。占位待调（[[defer-number-tuning]]）。
 */
const SAME_DEPTH_MIN_DIST = NONADJ_MIN_FACTOR + 0.3;

// ============================================================
// 类型
// ============================================================

export type ScatterDomain = 'vertical' | 'horizontal' | 'serpentine';

export interface ScatterOpts {
  rng: () => number;
  /** 目标节点数（由生成器按 zone 派生·内容预算不变）。 */
  n: number;
  d0: number;
  d1: number;
  /** 洞型谱指数 k（resolveDepthCurve 派生·作用于分层撒点的层位映射 frac^k·在最终 y 空间落点·见文件头注）。horizontal 域忽略（深度锁带）。 */
  curveK: number;
  domain: ScatterDomain;
  /** 域宽系数（占位·layered 开阔水域传 >1 拉「宽感」；缺省 1＝maze 竖条·SPEC §2④）。 */
  widthScale?: number;
}

export interface ScatterGraph {
  /** 撒点坐标（米·x 保留小数·y≡depth·k 已在撒点层位生效·最终坐标）。 */
  pts: Array<{ x: number; y: number }>;
  /** 无向邻接表（对称·索引制）。 */
  adj: Set<number>[];
  /** 到 entrance 的 BFS 树距（最终图·= DiveNode.layer 新语义）。 */
  dist: number[];
  /** 入口索引（恒 0·全局唯一最浅·y=d0）。 */
  entrance: number;
  /** 最深点索引（2 个·y=d1·x-分离·degree-1 叶·局部极大）。 */
  deepPoints: number[];
  /** 「洞另一头出口」索引（degree-1 或图距最远的可修剪点·可能 undefined 兜底态）。 */
  farExit: number | undefined;
}

type Pt = { x: number; y: number };

// ============================================================
// 椭圆度量
// ============================================================

/** 椭圆归一距离（≥1 ＝满足一个椭圆单位）：hypot(dx/DX, dy/DY)。 */
export function scatterMetric(a: Pt, b: Pt): number {
  return Math.hypot((a.x - b.x) / SCATTER_MIN_DX, (a.y - b.y) / SCATTER_MIN_DY);
}

// ============================================================
// 撒点域（§3① 参数化条带·mapgen 全权决定形状·渲染层不再管形状）
// ============================================================

interface Domain {
  /** 入口点（域底浅端·y=d0·恒为撒点第 0 个）。 */
  entrance: () => Pt;
  /** 两个**最深点**种子（y=d1·x-分离 ≥ NONADJ·恒为撒点第 1、2 个）——与 entrance 一起作 Bridson 初始活跃点，
   *  使填充从**上下两端同时生长**、铺满整个深度跨度（否则单顶种子只填出一个浅团·深点被孤悬→长边）。 */
  deepSeeds: () => [Pt, Pt];
  /** 在**指定深度比例**（0..1·映到填充区 [d0+DY,d1−DY]）取一个域内点·x 按域形状分布（竖条均布/蛇行沿折线）。
   *  分层撒点用——每层钉一个深度 ⇒ 深度均匀铺满全跨度（不留中缝·否则 MST 跨缝成长边）。确定性·只用传入 rng。 */
  fill: (depthFrac: number, rng: () => number) => Pt;
  /** 填充候选是否落在域内（**含上下保留带**：y∈[d0+DY, d1−DY]·entrance/deep 种子预置在带外·豁免）。 */
  contains: (x: number, y: number) => boolean;
  /** 域宽（米·供最深点 x-分离选择用）。 */
  width: number;
}

/**
 * 域尺寸（SPEC §3①·必修3 域宽由容量推·2026-07-20）：深度铺满靠 scatterPoints 的**分层撒点**（每层一深度带）·
 * 域宽由**容量**推——N 点铺进 availH 高的带、每点占一个椭圆间距单元(cellW×cellH)、留 PACK<1 填充余量 ⇒ 所需列宽
 * capW；再兜两条地板：deepPairMinW（放得下两 x-分离最深点）+ 分层每带并排点列地板（COLS_FLOOR）。旧式
 * `nominalArea/span` 恒 =deepPairMinW（常数 ≈2.79m·与 N 无关）⇒ 真实 N 下 Poisson 欠交付成常态（复审实证 horizontal
 * N=22 缺点率 99.5%·vertical N=12 50% seed 缺点）；改容量推后 7 zone 各 200 seed 交付 ≥95%。横向域**宽高语义对调**
 * （宽为主轴 ≥ span×H_ASPECT ⇒ 出图长宽比 >1·真横条）。**退化带**（span ≤ 2·SCATTER_MIN_DY·现无 zone 踩·未来窄 band
 * 覆盖会）：availH 由 `max(cellH, …)` clamp 出最小可用带 ⇒ capW 不除零、fill 落单深度线·不崩不 throw。全占位待调。
 */
function buildDomain(kind: ScatterDomain, d0: number, d1: number, widthScale: number, n: number): Domain {
  const span = Math.max(1, d1 - d0);
  const yLo = d0 + SCATTER_MIN_DY; // 填充下界（顶带留给 entrance）
  const yHi = Math.max(yLo, d1 - SCATTER_MIN_DY); // 填充上界（底带留给最深点）
  // 两最深点 x-分离最小宽（种子放 0.15w/0.85w ⇒ 分离 0.7w·要 0.7w/DX ≥ NONADJ·带 1.15 裕量）
  const deepPairMinW = (NONADJ_MIN_FACTOR * SCATTER_MIN_DX * 1.15) / 0.7;
  // 容量推列宽：每点占 cellW×cellH 椭圆单元·PACK 填充余量·availH clamp 兜退化带（不除零）。
  const cellW = SAME_DEPTH_MIN_DIST * SCATTER_MIN_DX;
  const cellH = SAME_DEPTH_MIN_DIST * SCATTER_MIN_DY;
  const availH = Math.max(cellH, yHi - yLo);
  const PACK = 0.55; // 面积填充效率余量（<1·欠估容量⇒域偏大⇒交付≥95%）·占位待调
  const COLS_FLOOR = 2.2; // 分层每带并排点最小列数地板·占位待调
  const capW = (n * cellW * cellH) / (PACK * availH);
  const baseW = Math.max(deepPairMinW, capW, COLS_FLOOR * cellW);

  if (kind === 'serpentine') {
    // 折返带（下行 switchback·参考 ui/mapLayout.ts layoutSerpentine 的三角波）：中线随深度左右折返·带宽=width·振幅随带宽。
    const width = baseW * widthScale;
    const folds = Math.max(2, Math.round(span / 18));
    const amp = width * 1.2;
    const half = width / 2;
    const tri = (p: number) => {
      const q = ((p % 1) + 1) % 1;
      return q < 0.5 ? q * 4 - 1 : 3 - q * 4;
    };
    const center = (y: number) => amp + tri(((y - d0) / span) * folds) * amp;
    const bboxW = amp * 2 + width;
    return {
      entrance: () => ({ x: center(d0), y: d0 }),
      deepSeeds: () => [
        { x: center(d1) - half * 0.7, y: d1 },
        { x: center(d1) + half * 0.7, y: d1 },
      ],
      fill: (depthFrac, rng) => {
        const y = yLo + depthFrac * Math.max(0, yHi - yLo);
        return { x: center(y) + (rng() - 0.5) * width, y }; // 沿折线中线 ± 半带宽
      },
      contains: (x, y) => y >= yLo && y <= yHi && Math.abs(x - center(y)) <= half,
      width: bboxW,
    };
  }

  // vertical（默认）／ horizontal（深度锁带·宽高语义对调·x 为主轴）：同「竖条 + 上下保留带」骨架。
  const H_ASPECT = 1.4; // 横向域宽 ≥ span×此 ⇒ 出图长宽比 >1（真横条·占位待调）
  const width = kind === 'horizontal' ? Math.max(baseW, span * H_ASPECT) * widthScale : baseW * widthScale;
  return {
    entrance: () => ({ x: width / 2, y: d0 }),
    deepSeeds: () => [
      { x: width * 0.15, y: d1 },
      { x: width * 0.85, y: d1 },
    ],
    fill: (depthFrac, rng) => ({ x: rng() * width, y: yLo + depthFrac * Math.max(0, yHi - yLo) }),
    contains: (x, y) => x >= 0 && x <= width && y >= yLo && y <= yHi,
    width,
  };
}

// ============================================================
// Poisson-disk（Bridson·椭圆度量·确定性·最小间距 = NONADJ）
// ============================================================

/**
 * **分层撒点**（stratified·关键：保深度均匀覆盖）：预置三种子——entrance（第 0·域顶）+ 两最深点（第 1、2·域底），
 * 其余 n−3 个按**深度分层**——摊到 numLevels 层、每层**均匀**层位 fracU 经洞型谱 `fracU^k` 压成最终深度比例、
 * 映到填充区 [yLo,yHi] 落点（层内 + x 都抖动）⇒ 曲线在**最终 y 空间**作用、minDist 也在最终 y 上判（诚实构造·见文件头注）。
 * 由此深度**铺满整个跨度、绝无中缝** ⇒ 连通骨架/MST 只连相邻层、边天然短（Bridson 组织式生长在「点少+跨度大」
 * 时会围种子聚成上下两团、留大中缝→MST 跨缝成度量几十的长边·实测换分层后 p95/最长边骤降·见文件头注 ④）。
 * 每层试若干 x 抖动落一个满足最小间距的点·实在放不下就跳过该层（宁可节点略少·不肯降间距破诚实·门脚本兜底断言）。
 * 最小间距只需拦「同深 x-叠」——纵向由分层拉开·故取略高于 NONADJ（含整数量化裕量）。返回 { pts, deepCount }。
 */
function scatterPoints(rng: () => number, n: number, k: number, dom: Domain): { pts: Pt[]; deepCount: number } {
  const minDist = SAME_DEPTH_MIN_DIST; // 同深 x-分离下限（略高于 NONADJ·含整数 round 裕量）
  const JITTER = 0.7; // 层内深度抖动幅度（× 层高·破规整）·占位待调
  const PTS_PER_LEVEL = 1.4; // 每层约放几个点：>1 ⇒ 部分层并排两点 ⇒ Gabriel 成二列梯格（有环 + 内部可修剪成死路·破纯路径）·占位待调
  const pts: Pt[] = [dom.entrance()];
  const [dsA, dsB] = dom.deepSeeds();
  let deepCount = 0;
  if (n >= 3) {
    pts.push(dsA, dsB); // 索引 1、2 = 最深点种子
    deepCount = 2;
  }
  const fillCount = Math.max(0, n - pts.length);
  const numLevels = Math.max(1, Math.round(fillCount / PTS_PER_LEVEL));
  for (let i = 0; i < fillCount; i++) {
    const level = Math.floor((i * numLevels) / fillCount); // 把 fillCount 点摊到 numLevels 层（约 PTS_PER_LEVEL/层）
    // 均匀层位（分层 + 抖动·先耗 rng·与 k 无关 ⇒ k=1 逐字节）；再经洞型谱 frac^k 压成最终深度比例（k=1 恒等·pow 不耗 rng）。
    const fracU = Math.min(1, Math.max(0, (level + 0.5 + (rng() - 0.5) * JITTER) / numLevels));
    const frac = k === 1 ? fracU : Math.pow(fracU, k);
    for (let t = 0; t < BRIDSON_K; t++) {
      const cand = dom.fill(frac, rng);
      if (!dom.contains(cand.x, cand.y)) continue;
      let ok = true;
      for (const p of pts) {
        if (scatterMetric(cand, p) < minDist) {
          ok = false;
          break;
        }
      }
      if (ok) {
        pts.push(cand);
        break;
      }
    }
  }
  return { pts, deepCount };
}

// ============================================================
// 邻近图（Gabriel ∪ 短边优先 MST）
// ============================================================

type Edge = { a: number; b: number; w: number };

/** Gabriel 图（椭圆度量下·以 ab 为直径的圆内无第三点则连）∪ 短边偏好 MST（Prim·保底连通·tie-break 索引）。 */
function buildGraph(pts: Pt[]): { adj: Set<number>[]; mst: Set<string> } {
  const n = pts.length;
  const adj: Set<number>[] = Array.from({ length: n }, () => new Set<number>());
  const link = (a: number, b: number) => {
    adj[a].add(b);
    adj[b].add(a);
  };
  const key = (a: number, b: number) => (a < b ? `${a}:${b}` : `${b}:${a}`);

  // —— MST（Prim·椭圆度量权·短边优先·保底连通）——
  const mst = new Set<string>();
  if (n > 0) {
    const inTree = new Array<boolean>(n).fill(false);
    const bestW = new Array<number>(n).fill(Infinity);
    const bestFrom = new Array<number>(n).fill(-1);
    bestW[0] = 0;
    for (let it = 0; it < n; it++) {
      let u = -1;
      let uw = Infinity;
      for (let i = 0; i < n; i++) if (!inTree[i] && bestW[i] < uw) ((uw = bestW[i]), (u = i));
      if (u < 0) break;
      inTree[u] = true;
      if (bestFrom[u] >= 0) {
        link(u, bestFrom[u]);
        mst.add(key(u, bestFrom[u]));
      }
      for (let v = 0; v < n; v++) {
        if (inTree[v]) continue;
        const w = scatterMetric(pts[u], pts[v]);
        if (w < bestW[v]) ((bestW[v] = w), (bestFrom[v] = u));
      }
    }
  }

  // —— Gabriel：ab 为直径的圆内无第三点则连（椭圆度量→归一坐标下判圆）——
  const cx = pts.map((p) => p.x / SCATTER_MIN_DX);
  const cy = pts.map((p) => p.y / SCATTER_MIN_DY);
  for (let a = 0; a < n; a++) {
    for (let b = a + 1; b < n; b++) {
      const mx = (cx[a] + cx[b]) / 2;
      const my = (cy[a] + cy[b]) / 2;
      const r2 = ((cx[a] - cx[b]) ** 2 + (cy[a] - cy[b]) ** 2) / 4;
      let empty = true;
      for (let c = 0; c < n; c++) {
        if (c === a || c === b) continue;
        if ((cx[c] - mx) ** 2 + (cy[c] - my) ** 2 < r2 - 1e-9) {
          empty = false;
          break;
        }
      }
      if (empty) link(a, b);
    }
  }

  return { adj, mst };
}

/**
 * 边预算 + 边长上限裁剪（MST 边永不拆·守连通）：先删「非 MST 且超 EDGE_MAX_FACTOR 长」的边，
 * 再若仍超预算（≈N×EDGE_BUDGET_FACTOR）按长度从长到短删非 MST 边。确定性（长度 tie-break 用端点索引）。
 */
function pruneEdges(pts: Pt[], adj: Set<number>[], mst: Set<string>): void {
  const n = pts.length;
  const key = (a: number, b: number) => (a < b ? `${a}:${b}` : `${b}:${a}`);
  const edges: Edge[] = [];
  for (let a = 0; a < n; a++) for (const b of adj[a]) if (a < b) edges.push({ a, b, w: scatterMetric(pts[a], pts[b]) });
  const cut = (e: Edge) => {
    adj[e.a].delete(e.b);
    adj[e.b].delete(e.a);
  };
  edges.sort((p, q) => q.w - p.w || p.a - q.a || p.b - q.b); // 长边优先删
  const budget = Math.round(n * EDGE_BUDGET_FACTOR);
  let count = edges.length;
  for (const e of edges) {
    if (mst.has(key(e.a, e.b))) continue; // MST 边不拆
    if (e.w > EDGE_MAX_FACTOR || count > budget) {
      cut(e);
      count--;
    }
  }
}

// ============================================================
// 图算法小工具（BFS / 连通 / 环秩）
// ============================================================

function bfsDist(adj: Set<number>[], src: number): number[] {
  const n = adj.length;
  const dist = new Array<number>(n).fill(-1);
  dist[src] = 0;
  const q = [src];
  for (let h = 0; h < q.length; h++) {
    const u = q[h];
    for (const v of adj[u]) if (dist[v] < 0) ((dist[v] = dist[u] + 1), q.push(v));
  }
  return dist;
}

function isConnected(adj: Set<number>[]): boolean {
  const n = adj.length;
  if (n === 0) return true;
  const seen = new Array<boolean>(n).fill(false);
  seen[0] = true;
  const q = [0];
  let cnt = 1;
  for (let h = 0; h < q.length; h++) {
    for (const v of adj[q[h]]) if (!seen[v]) ((seen[v] = true), cnt++, q.push(v));
  }
  return cnt === n;
}

function edgeCount(adj: Set<number>[]): number {
  let e = 0;
  for (const s of adj) e += s.size;
  return e / 2;
}

/** 环秩 = 边 − 点 + 连通分量。 */
function cycleRank(adj: Set<number>[]): number {
  const n = adj.length;
  const seen = new Array<boolean>(n).fill(false);
  let comps = 0;
  for (let i = 0; i < n; i++) {
    if (seen[i]) continue;
    comps++;
    const q = [i];
    seen[i] = true;
    for (let h = 0; h < q.length; h++) for (const v of adj[q[h]]) if (!seen[v]) ((seen[v] = true), q.push(v));
  }
  return edgeCount(adj) - n + comps;
}

// ============================================================
// 结构编排（§3③ 对照旧 mapgen-maze 步 2–3 语义·保迷路不变量·**只删边/只往下移·不破 ③**）
// ============================================================

/**
 * 把 `node` 修剪成 degree-1 叶（只留最近邻居一条边）：优先保最近邻居；若删其余边会使图不连通则换下一近的保。
 * 全部候选都会断连 ⇒ node 是割点 ⇒ 放弃修剪（返 false·调用方另选点）。只删边·不动点 ⇒ 不破 ③。原地改 adj。
 */
function pruneToLeaf(pts: Pt[], adj: Set<number>[], node: number): boolean {
  const nbrs = [...adj[node]];
  if (nbrs.length <= 1) return true;
  nbrs.sort((a, b) => scatterMetric(pts[node], pts[a]) - scatterMetric(pts[node], pts[b]) || a - b);
  for (const keep of nbrs) {
    const removed: number[] = [];
    for (const nb of nbrs) {
      if (nb === keep) continue;
      adj[node].delete(nb);
      adj[nb].delete(node);
      removed.push(nb);
    }
    if (isConnected(adj)) return true;
    for (const nb of removed) {
      adj[node].add(nb);
      adj[nb].add(node);
    }
  }
  return false;
}

/** 补一条最短合法弦（连 dist 差 ≤2 的非保护对·制造环）。原地改 adj。 */
function addShortChord(pts: Pt[], adj: Set<number>[], dist: number[], locked: Set<number>): void {
  const n = pts.length;
  let best: [number, number] | null = null;
  let bestW = Infinity;
  for (let a = 0; a < n; a++) {
    if (locked.has(a)) continue;
    for (let b = a + 1; b < n; b++) {
      if (locked.has(b) || adj[a].has(b)) continue;
      if (Math.abs(dist[a] - dist[b]) > 2) continue;
      const w = scatterMetric(pts[a], pts[b]);
      if (w < bestW) ((bestW = w), (best = [a, b]));
    }
  }
  if (best) {
    adj[best[0]].add(best[1]);
    adj[best[1]].add(best[0]);
  }
}

// ============================================================
// 主管线
// ============================================================

/**
 * 撒点（层位过洞型谱 frac^k·最终 y 空间）→ 邻近图 → 结构编排 → BFS 树距。返回坐标 + 无向图 + 角色索引（生成器据此赋 kind/深度）。
 * 全程只用 `opts.rng`·确定性·迭代顺序显式（守 #98 同地同图）。深度语义 y≡depth（SPEC §1「位置即深度」构造保证）。
 * **诚实构造**：最小间距=NONADJ + 只删边/只往下钉 ⇒ ③ 非相邻不假熔恒成立、无需分离修复（见文件头注）。
 */
export function buildScatterGraph(opts: ScatterOpts): ScatterGraph {
  const { rng, n, d0, d1, curveK, domain, widthScale = 1 } = opts;
  // 洞型谱 k：horizontal 深度锁带忽略（传 1）；其余走 curveK。曲线在分层撒点的层位映射生效（最终 y 空间·见文件头注）。
  const k = domain === 'horizontal' ? 1 : curveK;

  // 1. 撒点（预置种子：entrance=第 0·域顶 y=d0；最深点=第 1、2·域底 y=d1·x-分离；填充从上下两端同时长满全深度）
  const dom = buildDomain(domain, d0, d1, widthScale, n);
  const { pts, deepCount } = scatterPoints(rng, n, k, dom);
  const entrance = 0;
  // 2. 最深点索引 = 预置种子（不后钉·不移点 ⇒ 边即真实相邻·天然短；y 已=d1 且 x-分离 ⇒ deepestNodeIds≥2 不塌陷不假熔）
  const deepPoints: number[] = [];
  for (let i = 1; i <= deepCount && i < pts.length; i++) deepPoints.push(i);

  // 3. Gabriel ∪ MST（**在最终位置上连边**·含已置好的 entrance/deep ⇒ 边即真实相邻）→ 预算/边长裁剪
  const { adj, mst } = buildGraph(pts);
  pruneEdges(pts, adj, mst);

  // 4. 最深点修剪成 degree-1 叶（死路·非 ascent ⇒ minDeadEnds:2）——只删边·不动点。
  //    先断「deep↔deep」直连（两卵室各自是独立死角·不该串成一条：否则内侧那个被外侧挂着、只有一个能成叶）·
  //    断后若某 deep 悬空则接到最近的**非 deep** 点 ⇒ 各自挂在 fill 上 ⇒ 都能修成叶。
  const isDeep = new Set(deepPoints);
  if (deepPoints.length === 2) {
    const [a, b] = deepPoints;
    if (adj[a].has(b)) {
      adj[a].delete(b);
      adj[b].delete(a);
    }
    for (const dp of deepPoints) {
      if (adj[dp].size > 0) continue;
      let best = -1;
      let bestW = Infinity;
      for (let j = 0; j < pts.length; j++) {
        if (j === dp || isDeep.has(j)) continue;
        const w = scatterMetric(pts[dp], pts[j]);
        if (w < bestW) ((bestW = w), (best = j));
      }
      if (best >= 0) {
        adj[dp].add(best);
        adj[best].add(dp);
      }
    }
  }
  const protectedSet = new Set<number>([entrance, ...deepPoints]);
  for (const dp of deepPoints) pruneToLeaf(pts, adj, dp);

  // 5. far exit：除最深点外图距 entrance 最远的可修剪点 → degree-1 叶（生成器标 ascent_point）。
  let farExit: number | undefined;
  {
    const dist0 = bfsDist(adj, entrance);
    const cands = [...Array(pts.length).keys()]
      .filter((i) => !protectedSet.has(i) && dist0[i] >= 0)
      .sort((a, b) => dist0[b] - dist0[a] || a - b);
    for (const cand of cands) {
      if (pruneToLeaf(pts, adj, cand)) {
        farExit = cand;
        break;
      }
    }
    if (farExit === undefined && cands.length > 0) farExit = cands[0]; // 兜底：最远点（不修剪·仍标上浮口）
    if (farExit !== undefined) protectedSet.add(farExit);
  }

  // 5b. 保证 ≥2 死路（degree-1 且非 entrance/farExit ＝ maze 死路·minDeadEnds:2）：两最深点通常已够，但若其一是割点
  //     修剪失败（degree>1）⇒ 不足 ⇒ 再把内部点（图距远的·外围）修剪成叶补齐。只删边·不动点 ⇒ 不破 ③。
  {
    const isDeadEnd = (i: number) => adj[i].size === 1 && i !== entrance && i !== farExit;
    let deadEnds = 0;
    for (let i = 0; i < pts.length; i++) if (isDeadEnd(i)) deadEnds++;
    if (deadEnds < 2) {
      const dist0 = bfsDist(adj, entrance);
      const cands = [...Array(pts.length).keys()]
        .filter((i) => !protectedSet.has(i) && adj[i].size >= 2 && dist0[i] >= 0)
        .sort((a, b) => dist0[b] - dist0[a] || a - b); // 外围（图距远）优先
      for (const c of cands) {
        if (deadEnds >= 2) break;
        if (pruneToLeaf(pts, adj, c)) {
          deadEnds++;
          protectedSet.add(c);
        }
      }
    }
  }

  // 6. 环：环秩为 0 时补一条最短合法弦（连 dist 差≤2 的非保护对）
  if (cycleRank(adj) <= 0) addShortChord(pts, adj, bfsDist(adj, entrance), protectedSet);

  // 7. BFS 树距（最终图）——k 已在撒点层位生效（最终 y 空间）·此处不再重映射（诚实构造于真实坐标·见文件头注）。
  const dist = bfsDist(adj, entrance);

  return { pts, adj, dist, entrance, deepPoints, farExit };
}
