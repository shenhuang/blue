// scripts/playthrough-mapshape.ts —— 地图**形状**回归门（「一条线走到底」的机制化判据·2026-07-21）
//
// 背景：#326 把 mapgen 改成「先撒点、后连边」（Gabriel∪MST 邻近图·见 src/engine/mapgen-scatter.ts）。
// 撒点域的宽度由容量公式 `capW = n·cellW·cellH /(PACK·availH)` 推出——它与**深度跨度成反比**，代入真实
// zone 后恒被 `COLS_FLOOR·cellW`（≈4.86m）兜底 ⇒ 竖直/蛇行域被钉死成「≈4.9m 宽 × 数十米高」的窄条。
// 近共线点集上 Gabriel 图**必然**退化成一条路径（p_i 与 p_{i+2} 的直径圆恒包含 p_{i+1}，跨层斜边全被否决），
// 于是 9/10 zone 的图都是「一条线走到底」——玩家报的正是这个。当时只有 horizontal 域有「域宽 ≥ span×比例」
// 的地板（旧 `H_ASPECT`），也正是唯一没退化的域。
//
// 教训是：**既有的 mapgen 门全是「拓扑是否合法」，没有一条管「形状好不好玩」**——
// `hasCycle` 只问"有没有环"（一条线加一根弦也算有环）、`hasDeadEnd` 只问"有没有尽头"。
// 退化图把这些布尔门全部骗过去了。本门把「网状/分叉」从散文变成会在 `npm run regress` 里变红的量化断言
// （CLAUDE.md：能变成检查的约定就别写成散文）。命名 `playthrough-*.ts` ⇒ scripts/regress.mjs 自动收编·零接线。
//
// 四条断言（每 zone 扫 SEEDS 个 seed）：
//   ① spineRatio ≤ 0.65（≥90% seed 满足）—— 直接盯「一条线走到底」。spineRatio = 直径路径节点数 / 总节点数，
//      1.0 ＝整张图就是一条线。留 10% 容差是因为小图（N≈18）本就偶尔抽出瘦长的一张，不该为单个 seed 打红。
//   ② cycleRank 中位数 ≥ 2 —— 把既有的 `hasCycle` 布尔升级成**量级**：不是"有没有环"，是"有几个环"。
//   ③ maxOffSpineBranch ≥ 2（≥90% seed 满足）—— 本 bug 最锋利的判据。退化图的岔路**恒是单点凸起**
//      （实测均值＝最大值＝1.00：走一步就到头，玩家根本感觉不到"岔路"）。≥2 才叫真能走进去的支路。
//   ④ xSpread / ySpan ≥ 0.25 —— 撒点域横纵比地板（**逐图强制·无容差**）：域尺寸是确定性几何、不是随机结果，
//      一张不合格就说明域公式又退化了。直接拦住"再次被压成竖条"这个根因，而不只是拦它的症状。
//
// ①②③ 全部读 `analyzeMap()` 的派生字段（src/engine/mapgen-analyze.ts::spineRatio / maxOffSpineBranch /
// cycleRank）——**门与 dev 面板共用同一处图论实现**，本文件刻意不自己写 BFS/直径（两套实现必然漂）。
// ④ 只用 node.x / node.depth 取 min/max，不涉及图论。
//
// 覆盖：从 ZONES 注册表**数据驱动**枚举所有走撒点脊柱的 zone（mapShape ∈ {maze, layered}），
// 新增 zone 自动进门、不需要改本文件。`warren` 是手工三卵室拓扑、不走撒点脊柱 ⇒ 由
// scripts/playthrough-warren-mapgen.ts 管，本门跳过。
//
// 与既有门的分工（别重复造）：
//   - scripts/playthrough-coords2d.ts   坐标**诚实**（近而无边必隔墙 / 有边不画远 / 起点唯一最浅）
//   - scripts/playthrough-mapgen-scenarios.ts  拓扑**合法**（可达/双向/有环/有死路/确定性/洞型谱剖面）
//   - 本门                              形状**好玩**（网状 vs 一条线·分叉是否走得进去·域没被压扁）
//
// 跑法： npx tsx scripts/playthrough-mapshape.ts

import { generateDiveMap, analyzeMap } from '../src/engine/mapgen';
import { ZONES } from '../src/engine/zones';
import type { DiveMap, ZoneDef } from '../src/types';
import { makeHarness, type PtAssert } from './lib/pt';

const pt = makeHarness('地图形状回归（网状 vs 一条线走到底）');
const { L } = pt;
const assert: PtAssert = pt.assert;

const FLAGS = new Set(['flag.tutorial_complete']);

// ============================================================
// 门槛（全部有名字 + 出处·别散魔数）
// ============================================================

/** 每 zone 扫多少 seed。200＝够让 90% 容差有统计意义，又不至于把 regress 拖慢（实测全门 <10s）。 */
const SEEDS = 200;

/** 走撒点脊柱（mapgen-scatter.ts）的 mapShape——只有它们受域尺寸/采样密度影响，本门才管得着。 */
const SPINE_SHAPES = new Set(['maze', 'layered']);

/** ① 脊柱占比上限。0.65：实测改后各 zone 均值 0.33–0.48、最差单 seed 0.66；改前竖直/蛇行均值 0.80–0.81。 */
const SPINE_RATIO_MAX = 0.65;
/** ①③ 的容差：至少这么大比例的 seed 要满足。实测改后 ①③ 都是 199–200/200 ⇒ 0.90 留了足够余量。 */
const MIN_PASS_RATE = 0.9;
/** ② 环秩中位数下限。2：实测改后各 zone 中位数 8–18；改前竖直/蛇行/多数开阔是 1（＝仅补弦那一个环）。 */
const CYCLE_RANK_MEDIAN_MIN = 2;
/** ③ 离脊分支节点数下限。2＝「真能走进去的支路」；改前退化图恒为 1（单点凸起）。 */
const OFF_SPINE_BRANCH_MIN = 2;
/** ④ 撒点域横纵比地板（xSpread / ySpan）。0.25：实测改后全局最小 0.371（1.5× 余量）；改前竖直图 0.08。 */
const ASPECT_MIN = 0.25;
/** 覆盖下限：防「zone 表被改空 / 过滤条件写错 ⇒ 一个 zone 都没扫却绿」这种假门。 */
const MIN_ZONES_COVERED = 5;

// 与 scripts/playthrough-mapgen-scenarios.ts / playthrough-coords2d.ts 等同款 LCG（确定性）。
function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function genMap(zone: ZoneDef, seed: number): DiveMap {
  return generateDiveMap({ zone, profileFlags: FLAGS, deaths: [], rng: makeRng(seed) });
}

/** 撒点域横纵比：x 展布 / 深度跨度。ySpan=0（退化单深度线）时返回 Infinity＝不设限（④ 无意义·不误红）。 */
function domainAspect(map: DiveMap): number {
  const nodes = Object.values(map.nodes);
  const xs = nodes.map((n) => n.x).filter((x): x is number => typeof x === 'number' && Number.isFinite(x));
  if (xs.length !== nodes.length) return Number.NaN; // x 缺失＝坐标契约断了（coords2d 门会报·这里标 NaN 让 ④ 红）
  const ds = nodes.map((n) => n.depth);
  const ySpan = Math.max(...ds) - Math.min(...ds);
  if (ySpan <= 0) return Number.POSITIVE_INFINITY;
  return (Math.max(...xs) - Math.min(...xs)) / ySpan;
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);

// ============================================================
// 扫描
// ============================================================

const zones = [...ZONES.values()].filter((z) => SPINE_SHAPES.has(z.mapShape ?? 'layered'));

L(`覆盖 ${zones.length} 个撒点脊柱 zone（mapShape ∈ {${[...SPINE_SHAPES].join(', ')}}）× ${SEEDS} seed`);
L(
  `门槛：spineRatio ≤ ${SPINE_RATIO_MAX}（≥${(100 * MIN_PASS_RATE).toFixed(0)}% seed） · ` +
    `cycleRank 中位数 ≥ ${CYCLE_RANK_MEDIAN_MIN} · 离脊分支 ≥ ${OFF_SPINE_BRANCH_MIN} 节点（≥${(100 * MIN_PASS_RATE).toFixed(0)}% seed） · ` +
    `横纵比 ≥ ${ASPECT_MIN}（逐图）`,
);
L('');
L('zone'.padEnd(30) + 'shape'.padEnd(9) + '  N  spine  ok%  cycRk  offBr  ok%  aspect(min)');

assert(
  zones.length >= MIN_ZONES_COVERED,
  `覆盖 zone 数 ${zones.length} < ${MIN_ZONES_COVERED}——本门可能因 zone 表/过滤条件变动而空扫（假绿）。` +
    `确认 ZONES 里还有 mapShape ∈ {${[...SPINE_SHAPES].join(', ')}} 的 zone，或调 MIN_ZONES_COVERED。`,
);

for (const zone of zones) {
  const shape = zone.mapShape ?? 'layered';
  const spineRatios: number[] = [];
  const cycleRanks: number[] = [];
  const offBranches: number[] = [];
  const aspects: number[] = [];
  const nodeCounts: number[] = [];
  let worstAspect = { seed: 0, v: Number.POSITIVE_INFINITY };
  let worstSpine = { seed: 0, v: Number.NEGATIVE_INFINITY };

  for (let seed = 1; seed <= SEEDS; seed++) {
    const map = genMap(zone, seed);
    const a = analyzeMap(map);
    const asp = domainAspect(map);
    spineRatios.push(a.spineRatio);
    cycleRanks.push(a.cycleRank);
    offBranches.push(a.maxOffSpineBranch);
    aspects.push(asp);
    nodeCounts.push(a.nodeCount);
    // NaN（x 缺失）比较恒 false ⇒ 走下面显式判断，保证它一定被记成最差、④ 必红。
    if (!(asp >= worstAspect.v)) worstAspect = { seed, v: asp };
    if (a.spineRatio > worstSpine.v) worstSpine = { seed, v: a.spineRatio };
  }

  const spineOk = spineRatios.filter((r) => r <= SPINE_RATIO_MAX).length / SEEDS;
  const branchOk = offBranches.filter((b) => b >= OFF_SPINE_BRANCH_MIN).length / SEEDS;
  const cycMedian = median(cycleRanks);
  const minAspect = worstAspect.v; // 用显式跟踪值而非 Math.min（后者遇 NaN 会静默传染成 NaN·断言反而说不清哪个 seed）

  L(
    zone.id.padEnd(30) +
      shape.padEnd(9) +
      mean(nodeCounts).toFixed(0).padStart(3) +
      '  ' +
      mean(spineRatios).toFixed(2).padStart(5) +
      ' ' +
      (100 * spineOk).toFixed(0).padStart(4) +
      '% ' +
      cycMedian.toFixed(0).padStart(5) +
      '  ' +
      mean(offBranches).toFixed(1).padStart(5) +
      ' ' +
      (100 * branchOk).toFixed(0).padStart(4) +
      '% ' +
      minAspect.toFixed(2).padStart(11),
  );

  // ① 一条线走到底
  assert(
    spineOk >= MIN_PASS_RATE,
    `${zone.id}: 只有 ${(100 * spineOk).toFixed(1)}% 的 seed 满足 spineRatio ≤ ${SPINE_RATIO_MAX}` +
      `（要求 ≥${(100 * MIN_PASS_RATE).toFixed(0)}%·均值 ${mean(spineRatios).toFixed(2)}·最差 seed=${worstSpine.seed} → ${worstSpine.v.toFixed(2)}）` +
      `——图退化成「一条线走到底」。多半是撒点域又被压成窄条（见 mapgen-scatter.ts::DOMAIN_ASPECT_FLOOR），` +
      `或每层点数（PTS_PER_LEVEL）不够并排、Gabriel 连不出跨层斜边。`,
  );
  // ② 环的量级
  assert(
    cycMedian >= CYCLE_RANK_MEDIAN_MIN,
    `${zone.id}: cycleRank 中位数 ${cycMedian} < ${CYCLE_RANK_MEDIAN_MIN}` +
      `——只剩「一条线 + 补的那一根弦」级别的环。注意 hasCycle 这种布尔门抓不到本情形（它对 cycleRank=1 也是 true）。`,
  );
  // ③ 岔路是不是真能走进去
  assert(
    branchOk >= MIN_PASS_RATE,
    `${zone.id}: 只有 ${(100 * branchOk).toFixed(1)}% 的 seed 存在 ≥${OFF_SPINE_BRANCH_MIN} 节点的离脊分支` +
      `（要求 ≥${(100 * MIN_PASS_RATE).toFixed(0)}%·均值 ${mean(offBranches).toFixed(2)}）` +
      `——岔路退化成"单点凸起"（走一步就到头），玩家感受不到分叉。`,
  );
  // ④ 域横纵比（逐图·无容差）
  assert(
    minAspect >= ASPECT_MIN,
    `${zone.id}: 撒点域横纵比最小 ${minAspect.toFixed(3)} < ${ASPECT_MIN}（seed=${worstAspect.seed}）` +
      `——域被压成竖条，Gabriel 图必然退化成路径（近共线点集上跨层斜边全被直径圆否决）。` +
      `根因在 mapgen-scatter.ts::buildDomain 的域宽推导，不在连边算法。`,
  );
}

L('');
L(`✓ ${zones.length} zone × ${SEEDS} seed：非「一条线走到底」· 有真环 · 岔路走得进去 · 域没被压扁`);

pt.done();
