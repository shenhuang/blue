// scripts/playthrough-mapgen-scenarios.ts —— mapgen（节点图生成）回归脚本
//
// 第三类 scenario，遵循 quirk #26「子目录 + 独立 playthrough」约定：JSON 放 scenarios/mapgen/，
// 由本脚本单独扫（不与事件/战斗 scenario 撞 schema）。
//
// 每份 scenario = { zoneId, seed, depthOffset?, expect }。脚本用 seeded LCG 复现生成，跑
// analyzeMap()，按 expect 断言结构性质。除了 curated scenarios，还额外做：
//   - 确定性：同 seed 生成两次，结构必须逐字节一致
//   - 种子扫描：blue_caves seeds 1..60，断言迷路不变量对每个 seed 都成立（curated 只覆盖几个点，
//     扫描覆盖鲁棒性——这是真正值钱的部分）
//
// 迷路不变量（每个 seed 都该成立）：全节点从起点可达 / 双向边 / 有环(回边) / 有死路 /
//   ≥2 个最深点 / 入口即上浮口 / ≥2 个 ascent_point 且全部可达。
//
// 跑法： npx tsx scripts/playthrough-mapgen-scenarios.ts
// 详见 docs/STATUS.md「真'迷路' mapgen」+「mapgen 回归」。

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { generateDiveMap, analyzeMap, type MapAnalysis } from '../src/engine/mapgen';
import { getZone } from '../src/engine/zones';
import type { DiveMap } from '../src/types';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCENARIO_DIR = resolve(__dirname, '..', 'scenarios', 'mapgen');
const FLAGS = new Set(['flag.tutorial_complete']);

// 与 scripts/playthrough-bluecaves.ts 等同款 LCG
function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

interface MapgenExpect {
  shape?: 'layered' | 'maze';
  nodeCount?: number;
  edgeCount?: number;
  maxDepth?: number;
  entranceDepth?: number;
  allReachable?: boolean;
  isUndirected?: boolean;
  hasCycle?: boolean;
  hasDeadEnd?: boolean;
  minDeadEnds?: number;
  minDeepestPoints?: number;
  minLocalMaxima?: number;
  minAscentPoints?: number;
  allAscentReachable?: boolean;
  entranceIsAscent?: boolean;
  lastLayerHasAscent?: boolean;
  /** 剖面形状包络（洞型谱·#114）：meanDepthFrac 的上下界（k>1 廊+坑 → 低；k<1 井+廊 → 高） */
  meanDepthFracMin?: number;
  meanDepthFracMax?: number;
}

interface MapgenScenario {
  _comment?: string;
  zoneId: string;
  seed: number;
  depthOffset?: number;
  /** 剖面曲线指数 k（洞型谱·显式覆盖·见 GenOpts.depthCurve）；缺省 → 无 seedKey 路径 k=1 */
  depthCurve?: number;
  /** 深度窗口覆盖（POI/band 平廊三件套·#114 续）：直通 GenOpts.depthRange */
  depthRange?: [number, number];
  /** 图规模覆盖（平廊拉长图）：直通 GenOpts.layerCount */
  layerCount?: number;
  expect?: MapgenExpect;
}

function genMap(
  zoneId: string,
  seed: number,
  depthOffset = 0,
  depthCurve?: number,
  depthRange?: [number, number],
  layerCount?: number,
): DiveMap {
  const zone = getZone(zoneId);
  if (!zone) throw new Error(`zone ${zoneId} 不存在`);
  return generateDiveMap({
    zone, profileFlags: FLAGS, deaths: [], rng: makeRng(seed), depthOffset, depthCurve, depthRange, layerCount,
  });
}

function entranceDepth(map: DiveMap): number {
  return map.nodes[map.startNodeId].depth;
}

function lastLayerHasAscent(map: DiveMap): boolean {
  const nodes = Object.values(map.nodes);
  const maxLayer = Math.max(...nodes.map((n) => n.layer));
  return nodes.some((n) => n.layer === maxLayer && n.kind === 'ascent_point');
}

/** 把 map 序列化成稳定字符串，用于确定性比对 */
function fingerprint(map: DiveMap): string {
  const ids = Object.keys(map.nodes).sort();
  return JSON.stringify(
    ids.map((id) => {
      const n = map.nodes[id];
      return [id, n.kind, n.depth, n.layer, [...n.connectsTo].sort()];
    }),
  ) + `|start=${map.startNodeId}`;
}

const fails: string[] = [];
function expectEq(name: string, label: string, got: unknown, want: unknown) {
  if (got !== want) fails.push(`[${name}] ${label}: 期望 ${String(want)}，实际 ${String(got)}`);
}
function expectGte(name: string, label: string, got: number, min: number) {
  if (!(got >= min)) fails.push(`[${name}] ${label}: 期望 ≥ ${min}，实际 ${got}`);
}

function assertExpect(name: string, map: DiveMap, a: MapAnalysis, zoneShape: string, e?: MapgenExpect) {
  if (!e) return;
  if (e.shape !== undefined) expectEq(name, 'shape', zoneShape, e.shape);
  if (e.nodeCount !== undefined) expectEq(name, 'nodeCount', a.nodeCount, e.nodeCount);
  if (e.edgeCount !== undefined) expectEq(name, 'edgeCount', a.edgeCount, e.edgeCount);
  if (e.maxDepth !== undefined) expectEq(name, 'maxDepth', a.maxDepth, e.maxDepth);
  if (e.entranceDepth !== undefined) expectEq(name, 'entranceDepth', entranceDepth(map), e.entranceDepth);
  if (e.allReachable !== undefined) expectEq(name, 'allReachable', a.allReachable, e.allReachable);
  if (e.isUndirected !== undefined) expectEq(name, 'isUndirected', a.isUndirected, e.isUndirected);
  if (e.hasCycle !== undefined) expectEq(name, 'hasCycle', a.hasCycle, e.hasCycle);
  if (e.hasDeadEnd !== undefined) expectEq(name, 'hasDeadEnd', a.hasDeadEnd, e.hasDeadEnd);
  if (e.minDeadEnds !== undefined) expectGte(name, 'deadEnds', a.deadEndIds.length, e.minDeadEnds);
  if (e.minDeepestPoints !== undefined) expectGte(name, 'deepestPoints', a.deepestNodeIds.length, e.minDeepestPoints);
  if (e.minLocalMaxima !== undefined) expectGte(name, 'localMaxima', a.localMaximaIds.length, e.minLocalMaxima);
  if (e.minAscentPoints !== undefined) expectGte(name, 'ascentPoints', a.ascentPointIds.length, e.minAscentPoints);
  if (e.allAscentReachable !== undefined) expectEq(name, 'allAscentReachable', a.allAscentReachable, e.allAscentReachable);
  if (e.entranceIsAscent !== undefined) expectEq(name, 'entranceIsAscent', a.entranceIsAscent, e.entranceIsAscent);
  if (e.lastLayerHasAscent !== undefined) expectEq(name, 'lastLayerHasAscent', lastLayerHasAscent(map), e.lastLayerHasAscent);
  if (e.meanDepthFracMin !== undefined) expectGte(name, 'meanDepthFrac(min)', a.meanDepthFrac, e.meanDepthFracMin);
  if (e.meanDepthFracMax !== undefined && a.meanDepthFrac > e.meanDepthFracMax)
    fails.push(`[${name}] meanDepthFrac(max): 期望 ≤ ${e.meanDepthFracMax}，实际 ${a.meanDepthFrac.toFixed(3)}`);
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

function main() {
  let files: string[] = [];
  try {
    files = readdirSync(SCENARIO_DIR).filter((f) => f.endsWith('.json'));
  } catch (err) {
    console.error(`无法读取 scenarios/mapgen/ 目录：${err}`);
    process.exitCode = 1;
    return;
  }
  files.sort();
  if (files.length === 0) {
    console.error(`scenarios/mapgen/ 目录里没有 .json 文件`);
    process.exitCode = 1;
    return;
  }

  console.log(`========== mapgen 回归 (${files.length} scenarios) ==========`);
  let okCount = 0;
  for (const f of files) {
    const before = fails.length;
    try {
      const sc = JSON.parse(readFileSync(resolve(SCENARIO_DIR, f), 'utf8')) as MapgenScenario;
      const zone = getZone(sc.zoneId);
      const shape = zone?.mapShape ?? 'layered';
      const map = genMap(sc.zoneId, sc.seed, sc.depthOffset ?? 0, sc.depthCurve, sc.depthRange, sc.layerCount);
      const a = analyzeMap(map);
      assertExpect(f, map, a, shape, sc.expect);

      // 确定性：同 seed 再生成一次，指纹必须一致
      const map2 = genMap(sc.zoneId, sc.seed, sc.depthOffset ?? 0, sc.depthCurve, sc.depthRange, sc.layerCount);
      if (fingerprint(map) !== fingerprint(map2)) {
        fails.push(`[${f}] 非确定性：同 seed 两次生成结构不一致`);
      }

      if (fails.length === before) {
        okCount++;
        console.log(
          `  ✓ ${f}  [${shape}] N=${a.nodeCount} E=${a.edgeCount} ` +
            `cyc=${a.cycleRank} dead=${a.deadEndIds.length} deepest=${a.deepestNodeIds.length} ` +
            `asc=${a.ascentPointIds.length} maxD=${a.maxDepth}m mdf=${a.meanDepthFrac.toFixed(2)}`,
        );
      } else {
        console.log(`  ✗ ${f}`);
        for (const m of fails.slice(before)) console.log(`      ${m}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      fails.push(`[${f}] 加载/执行异常：${msg}`);
      console.log(`  ✗ ${f}  (异常: ${msg})`);
    }
  }

  // —— 种子扫描：迷路不变量对每个 seed 都成立 ——
  console.log(`\n========== 迷路不变量种子扫描 (zone.blue_caves, seeds 1–60) ==========`);
  const SWEEP = 60;
  const badSeeds: string[] = [];
  let airSeeds = 0;
  let campSeeds = 0;
  for (let seed = 1; seed <= SWEEP; seed++) {
    const map = genMap('zone.blue_caves', seed);
    const a = analyzeMap(map);
    const problems: string[] = [];
    if (!a.allReachable) problems.push('不全可达');
    if (!a.isUndirected) problems.push('非双向');
    if (!a.hasCycle) problems.push('无环');
    if (!a.hasDeadEnd) problems.push('无死路');
    if (a.deepestNodeIds.length < 2) problems.push(`最深点<2(${a.deepestNodeIds.length})`);
    if (a.ascentPointIds.length < 2) problems.push(`上浮口<2(${a.ascentPointIds.length})`);
    if (!a.allAscentReachable) problems.push('上浮口不全可达');
    if (!a.entranceIsAscent) problems.push('入口非上浮口');
    if (problems.length > 0) badSeeds.push(`seed=${seed}: ${problems.join(', ')}`);
    const kinds = new Set(Object.values(map.nodes).map((n) => n.kind));
    if (kinds.has('air_pocket')) airSeeds++;
    if (kinds.has('camp')) campSeeds++;
  }
  if (badSeeds.length === 0) {
    console.log(`  ✓ 全部 ${SWEEP} 个 seed 满足迷路不变量`);
  } else {
    console.log(`  ✗ ${badSeeds.length}/${SWEEP} 个 seed 违反不变量：`);
    for (const b of badSeeds) console.log(`      ${b}`);
    fails.push(`种子扫描有 ${badSeeds.length} 个 seed 违反迷路不变量`);
  }
  // 地标（气穴 / 扎营点）应在扫描内出现过——结构地标不依赖事件池，给迷路加值得绕的理由
  console.log(`  地标出现：气穴 ${airSeeds}/${SWEEP} 局 · 扎营点 ${campSeeds}/${SWEEP} 局`);
  if (airSeeds === 0) fails.push('60 seed 内从未生成气穴节点');
  if (campSeeds === 0) fails.push('60 seed 内从未生成扎营点节点');

  // —— 「位置即深度」垂直性不变量（#92·深水区 SPEC §13）——
  // 声呐图 / MapDevPanel 纵轴 y∝真实深度（上浅下深）→ 要 mapgen 把「往下＝更深」做实：起点最浅(=图顶)、
  // 主下行 depth 随树距(layer)上升。这是「系统不变量」（以后放事件/房间/猎手按深度都靠它），由本块兜住能兜的那半。
  //   迷路：起点=全局最浅 + 深度随树距正相关（近半/远半均值）+ 最深点不在起点层；分支/回边允许朝浅（不查逐节点单调）。
  //   层状(开阔水域)：更强——逐层 depth 严格非减（上层 max ≤ 下层 min）+ 同层 depth 相等（depth=round(d0+step·L)）。
  console.log(`\n========== 「位置即深度」垂直性不变量 (#92·SPEC §13) ==========`);
  {
    const vfails: string[] = [];
    const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / Math.max(1, xs.length);
    // (a) 迷路：blue_caves seeds 1–60
    for (let seed = 1; seed <= SWEEP; seed++) {
      const map = genMap('zone.blue_caves', seed);
      const ns = Object.values(map.nodes);
      const depths = ns.map((n) => n.depth);
      const minD = Math.min(...depths);
      const maxD = Math.max(...depths);
      if (entranceDepth(map) !== minD) vfails.push(`maze seed=${seed}: 起点非全局最浅(起点 ${entranceDepth(map)} vs min ${minD}·应在图顶)`);
      if (ns.filter((n) => n.depth === maxD).every((n) => n.layer === 0)) vfails.push(`maze seed=${seed}: 最深点落在起点层(layer0)`);
      const maxLayer = Math.max(...ns.map((n) => n.layer));
      if (maxLayer >= 2) {
        const near = ns.filter((n) => n.layer <= maxLayer / 2).map((n) => n.depth);
        const far = ns.filter((n) => n.layer > maxLayer / 2).map((n) => n.depth);
        if (near.length > 0 && far.length > 0 && !(mean(far) > mean(near)))
          vfails.push(`maze seed=${seed}: 深度未随树距上升(近半均值 ${mean(near).toFixed(1)} ≥ 远半 ${mean(far).toFixed(1)})`);
      }
    }
    // (b) 层状(开阔水域)：wreck_graveyard seeds 1–30·逐层严格非减 + 同层相等 + 起点最浅
    for (let seed = 1; seed <= 30; seed++) {
      const map = genMap('zone.wreck_graveyard', seed);
      const ns = Object.values(map.nodes);
      if (entranceDepth(map) !== Math.min(...ns.map((n) => n.depth))) vfails.push(`layered seed=${seed}: 起点非全局最浅`);
      const byLayer = new Map<number, number[]>();
      for (const n of ns) {
        if (!byLayer.has(n.layer)) byLayer.set(n.layer, []);
        byLayer.get(n.layer)!.push(n.depth);
      }
      const layers = [...byLayer.keys()].sort((a, b) => a - b);
      for (let i = 0; i < layers.length; i++) {
        const ds = byLayer.get(layers[i])!;
        if (Math.max(...ds) !== Math.min(...ds)) vfails.push(`layered seed=${seed}: layer${layers[i]} 同层 depth 不等(${Math.min(...ds)}–${Math.max(...ds)})`);
        if (i > 0 && Math.min(...ds) < Math.max(...byLayer.get(layers[i - 1])!))
          vfails.push(`layered seed=${seed}: layer${layers[i]} 比上层更浅(破坏 y∝depth 单调)`);
      }
    }
    if (vfails.length === 0) {
      console.log(`  ✓ 迷路 60 + 层状 30 seed：起点=图顶最浅 · 迷路深度随树距上升·最深点在下行 · 层状逐层严格非减+同层相等`);
    } else {
      console.log(`  ✗ ${vfails.length} 处违反「位置即深度」：`);
      for (const v of vfails.slice(0, 12)) { console.log(`      ${v}`); fails.push(v); }
    }
  }

  // —— 洞型谱（剖面曲线 depthCurve·#114）不变量 ——
  // 守则：① 同 seed 下 meanDepthFrac 随 k 单调递减（井+廊 0.45 ≥ 线性 1 ≥ 廊+坑 2.6·逐点数学保证，断言非严格 +
  //        全扫描聚合差距严格）② 极端 k 不破迷路不变量与「位置即深度」#92（pow 单调）③ 缺省（无 seedKey）＝显式 k=1
  //        逐字节（zone 接线 depthCurveRange 不得影响既有回归路径——护栏）④ seedKey 派生：同 key 确定性、不同 POI
  //        的 k 拉开成不同洞型（性格分布）。
  console.log(`\n========== 洞型谱·剖面曲线不变量 (zone.blue_caves, k=0.45/1/2.6, seeds 1–30) ==========`);
  {
    const cfails: string[] = [];
    const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / Math.max(1, xs.length);
    const K_SHAFT = 0.45, K_LINEAR = 1, K_GALLERY = 2.6;
    const aggr: Record<string, number[]> = { shaft: [], linear: [], gallery: [] };
    for (let seed = 1; seed <= 30; seed++) {
      const mShaft = genMap('zone.blue_caves', seed, 0, K_SHAFT);
      const mLin = genMap('zone.blue_caves', seed, 0, K_LINEAR);
      const mGal = genMap('zone.blue_caves', seed, 0, K_GALLERY);
      const aS = analyzeMap(mShaft), aL = analyzeMap(mLin), aG = analyzeMap(mGal);
      aggr.shaft.push(aS.meanDepthFrac); aggr.linear.push(aL.meanDepthFrac); aggr.gallery.push(aG.meanDepthFrac);
      // ① 同 seed 同 jitter 流 ⇒ 逐点 frac^0.45 ≥ frac ≥ frac^2.6 ⇒ 非严格排序必须成立
      if (!(aS.meanDepthFrac >= aL.meanDepthFrac && aL.meanDepthFrac >= aG.meanDepthFrac))
        cfails.push(`seed=${seed}: meanDepthFrac 未随 k 单调（${aS.meanDepthFrac.toFixed(3)} / ${aL.meanDepthFrac.toFixed(3)} / ${aG.meanDepthFrac.toFixed(3)}）`);
      // ② 极端 k 不破迷路不变量 + #92 垂直性
      for (const [tag, m, a] of [['k0.45', mShaft, aS], ['k2.6', mGal, aG]] as const) {
        if (!a.allReachable || !a.isUndirected || !a.hasCycle || !a.hasDeadEnd) cfails.push(`seed=${seed} ${tag}: 破迷路不变量`);
        if (a.deepestNodeIds.length < 2) cfails.push(`seed=${seed} ${tag}: 最深点<2`);
        if (!a.allAscentReachable || !a.entranceIsAscent) cfails.push(`seed=${seed} ${tag}: 上浮口/入口异常`);
        const ns = Object.values(m.nodes);
        if (m.nodes[m.startNodeId].depth !== Math.min(...ns.map((n) => n.depth))) cfails.push(`seed=${seed} ${tag}: 起点非全局最浅`);
        const maxLayer = Math.max(...ns.map((n) => n.layer));
        if (maxLayer >= 2) {
          const near = ns.filter((n) => n.layer <= maxLayer / 2).map((n) => n.depth);
          const far = ns.filter((n) => n.layer > maxLayer / 2).map((n) => n.depth);
          if (near.length > 0 && far.length > 0 && !(mean(far) > mean(near))) cfails.push(`seed=${seed} ${tag}: 深度未随树距上升`);
        }
      }
      // ③ 护栏：缺省（无 seedKey·无显式 k）＝显式 k=1 逐字节 —— zone 接线不得改变既有回归路径
      if (fingerprint(genMap('zone.blue_caves', seed)) !== fingerprint(mLin))
        cfails.push(`seed=${seed}: 缺省 ≠ 显式 k=1（zone 接线泄漏进无 seedKey 路径）`);
    }
    // ① 聚合差距严格：三档平均 meanDepthFrac 拉开（井+廊 vs 线性 vs 廊+坑 各差 ≥0.05）
    const mS = mean(aggr.shaft), mL = mean(aggr.linear), mG = mean(aggr.gallery);
    if (!(mS > mL + 0.05 && mL > mG + 0.05))
      cfails.push(`聚合差距不足：shaft ${mS.toFixed(3)} / linear ${mL.toFixed(3)} / gallery ${mG.toFixed(3)}`);
    // ④ seedKey 派生：同 key 确定性 + 不同 POI 拉开洞型
    {
      const zone = getZone('zone.blue_caves')!;
      const genByKey = (key: string) =>
        generateDiveMap({ zone, profileFlags: FLAGS, deaths: [], seedKey: key });
      if (fingerprint(genByKey('poi.test.7')) !== fingerprint(genByKey('poi.test.7')))
        cfails.push('seedKey 派生非确定性（poi.test.7 两次不一致）');
      const mdfs: number[] = [];
      for (let i = 0; i < 12; i++) mdfs.push(analyzeMap(genByKey(`poi.test.${i}`)).meanDepthFrac);
      const spread = Math.max(...mdfs) - Math.min(...mdfs);
      if (!(spread >= 0.12)) cfails.push(`POI 洞型性格未拉开：12 个 key 的 meanDepthFrac 极差仅 ${spread.toFixed(3)}（期望 ≥0.12）`);
    }
    if (cfails.length === 0) {
      console.log(`  ✓ 30 seed 三档单调（均值 ${mean(aggr.shaft).toFixed(2)}/${mean(aggr.linear).toFixed(2)}/${mean(aggr.gallery).toFixed(2)}）· 极端 k 守迷路+#92 · 缺省=k1 逐字节 · POI 性格拉开`);
    } else {
      console.log(`  ✗ ${cfails.length} 处洞型谱问题：`);
      for (const c of cfails.slice(0, 12)) { console.log(`      ${c}`); fails.push(c); }
    }
  }

  // —— 多事件房间（声呐与房间 S1）不变量：maxRoomFeatures>1 时偶尔生成 2–3 feature「大房间」——
  // 守则：features 只挂 event 节点 / 每房 2–3 feature（≥2 才叫大房间、≤maxRoomFeatures）/ 大房间不再带单 eventId /
  //       同图事件不重复（features + 单事件共用 triggeredFakeIds 去重）/ 同 seed 确定性。
  console.log(`\n========== 多事件房间不变量 (zone.blue_caves, maxRoomFeatures=3, seeds 1–60) ==========`);
  let roomsTotal = 0;
  let featuresTotal = 0;
  let maxFeatSeen = 0;
  const featProblems: string[] = [];
  const featFp = (m: DiveMap) =>
    Object.keys(m.nodes)
      .sort()
      .map((id) => `${id}:${(m.nodes[id].features ?? []).map((f) => f.id + '=' + f.eventId).join(',')}`)
      .join('|');
  for (let seed = 1; seed <= SWEEP; seed++) {
    const zone = getZone('zone.blue_caves')!;
    const map = generateDiveMap({ zone, profileFlags: FLAGS, deaths: [], rng: makeRng(seed), maxRoomFeatures: 3 });
    for (const n of Object.values(map.nodes)) {
      if (n.features && n.features.length > 0) {
        if (n.kind !== 'event') featProblems.push(`seed=${seed} ${n.id}: features 挂在非 event 节点(${n.kind})`);
        if (n.features.length < 2) featProblems.push(`seed=${seed} ${n.id}: features 数<2(${n.features.length})`);
        if (n.features.length > 3) featProblems.push(`seed=${seed} ${n.id}: features 数>3(${n.features.length})`);
        if (n.eventId !== undefined) featProblems.push(`seed=${seed} ${n.id}: 大房间不应再带单 eventId`);
        // 同房不放重复 feature（excludeIds 硬去重）；跨房非 oncePerRun 事件可重复＝既有行为，不查。
        const ids = n.features.map((f) => f.eventId);
        if (new Set(ids).size !== ids.length) featProblems.push(`seed=${seed} ${n.id}: 同房重复 feature`);
        roomsTotal++;
        featuresTotal += n.features.length;
        maxFeatSeen = Math.max(maxFeatSeen, n.features.length);
      }
    }
    const map2 = generateDiveMap({ zone, profileFlags: FLAGS, deaths: [], rng: makeRng(seed), maxRoomFeatures: 3 });
    if (featFp(map) !== featFp(map2)) featProblems.push(`seed=${seed}: feature 非确定性`);
  }
  if (featProblems.length > 0) {
    for (const p of featProblems.slice(0, 10)) {
      console.log(`      ${p}`);
      fails.push(p);
    }
  } else if (roomsTotal === 0) {
    // 多事件房间机制 dormant（随机内容层拆除·2026-07-12）：blue_caves 随机池已删空（只留 2 条 poiId 事件），
    // 无内容填「大房间」⇒ 机制代码留但无对象可查。结构不变量（features 只挂 event / 2–3 个 / 不重复 / 确定性）
    // 若有房间成形仍强制（featProblems），0 房间＝合法 dormant 态。多事件房间待随洞内容重做（见 TODO）。
    console.log(`  ⊘ 大房间机制 dormant：blue_caves 随机池已空·无内容填多事件房（结构不变量无对象·机制留·内容待重做 TODO）。`);
  } else {
    console.log(`  ✓ 60 seed 共 ${roomsTotal} 个大房间 / ${featuresTotal} feature / 最大 ${maxFeatSeen}·全 2–3·同图不重复·确定性`);
  }

  // —— 房间 feature 出现率升级（声呐与房间 §6/§8.3 续·roomFeatureChanceBonus）不变量 ——
  // 守则：bonus=0（缺省）逐字节复现旧图（rollExtraFeatures 阈值/rng 消耗不变）；bonus>0 抬大房间率（更多 roll 越线成多事件房）。
  console.log(`\n========== 房间出现率升级不变量 (zone.blue_caves, maxRoomFeatures=3, seeds 1–60) ==========`);
  {
    const zone = getZone('zone.blue_caves')!;
    const fpAll = (bonus: number | undefined) =>
      Array.from({ length: SWEEP }, (_, i) =>
        featFp(generateDiveMap({ zone, profileFlags: FLAGS, deaths: [], rng: makeRng(i + 1), maxRoomFeatures: 3, roomFeatureChanceBonus: bonus })),
      ).join('#');
    const countRooms = (bonus: number) => {
      let rooms = 0;
      for (let seed = 1; seed <= SWEEP; seed++) {
        const m = generateDiveMap({ zone, profileFlags: FLAGS, deaths: [], rng: makeRng(seed), maxRoomFeatures: 3, roomFeatureChanceBonus: bonus });
        for (const n of Object.values(m.nodes)) if ((n.features?.length ?? 0) > 1) rooms++;
      }
      return rooms;
    };
    // (a) bonus=0（显式）＝缺省（不传）＝逐字节（阈值不变·rng 流不变·向后兼容护栏）
    if (fpAll(0) !== fpAll(undefined)) fails.push('房间升级：bonus=0 与缺省不一致（应逐字节相同）');
    // (b) bonus>0 抬大房间率——随机内容层拆除后 blue_caves 池空·无大房间可抬（0→0·dormant·内容待重做 TODO）；
    //     池空态跳过本断言（有内容时仍强制 up>base）。
    const base = countRooms(0);
    const up = countRooms(0.3);
    const dormant = base === 0 && up === 0;
    if (!dormant && !(up > base)) fails.push(`房间升级：bonus 未抬大房间率（${base}→${up}）`);
    // (c) 确定性（同 seed + bonus 两次一致）
    const one = (b: number) => featFp(generateDiveMap({ zone, profileFlags: FLAGS, deaths: [], rng: makeRng(7), maxRoomFeatures: 3, roomFeatureChanceBonus: b }));
    if (one(0.3) !== one(0.3)) fails.push('房间升级：bonus>0 非确定性');
    console.log(`  ${dormant ? '⊘' : '✓'} bonus=0 逐字节 · bonus0.3 抬大房间率(${base}→${up})${dormant ? '·dormant 池空·内容待重做' : ''} · 确定性`);
  }

  // —— 不可信声呐失真（声呐与房间 S2）不变量：**整节随感知重做删除**（声呐诚实·SPEC §2.2/§3）。 ——

  console.log('');
  if (fails.length > 0) {
    console.log(`✗ 失败 ${fails.length} / 通过 ${okCount}`);
    process.exitCode = 1;
    return;
  }
  console.log(`✓ playthrough 完成`);
  console.log(`全部场景通过（${okCount}/${files.length}） + 种子扫描 ${SWEEP}/${SWEEP}`);
}

main();
