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
}

interface MapgenScenario {
  _comment?: string;
  zoneId: string;
  seed: number;
  depthOffset?: number;
  expect?: MapgenExpect;
}

function genMap(zoneId: string, seed: number, depthOffset = 0): DiveMap {
  const zone = getZone(zoneId);
  if (!zone) throw new Error(`zone ${zoneId} 不存在`);
  return generateDiveMap({ zone, profileFlags: FLAGS, deaths: [], rng: makeRng(seed), depthOffset });
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
      const map = genMap(sc.zoneId, sc.seed, sc.depthOffset ?? 0);
      const a = analyzeMap(map);
      assertExpect(f, map, a, shape, sc.expect);

      // 确定性：同 seed 再生成一次，指纹必须一致
      const map2 = genMap(sc.zoneId, sc.seed, sc.depthOffset ?? 0);
      if (fingerprint(map) !== fingerprint(map2)) {
        fails.push(`[${f}] 非确定性：同 seed 两次生成结构不一致`);
      }

      if (fails.length === before) {
        okCount++;
        console.log(
          `  ✓ ${f}  [${shape}] N=${a.nodeCount} E=${a.edgeCount} ` +
            `cyc=${a.cycleRank} dead=${a.deadEndIds.length} deepest=${a.deepestNodeIds.length} ` +
            `asc=${a.ascentPointIds.length} maxD=${a.maxDepth}m`,
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
  if (featProblems.length === 0 && roomsTotal >= 5) {
    console.log(`  ✓ 60 seed 共 ${roomsTotal} 个大房间 / ${featuresTotal} feature / 最大 ${maxFeatSeen}·全 2–3·同图不重复·确定性`);
  } else {
    if (roomsTotal < 5) {
      console.log(`  ✗ 大房间太少（${roomsTotal}），机制疑似没触发`);
      fails.push(`多事件房间机制 60 seed 只生成 ${roomsTotal} 个大房间`);
    }
    for (const p of featProblems.slice(0, 10)) {
      console.log(`      ${p}`);
      fails.push(p);
    }
  }

  // —— 不可信声呐失真（声呐与房间 S2）不变量：sonarDeception>0 时给部分内部节点挂 spoofs/evades ——
  // 守则：只挂非地标/非起点/非尸体的内部节点 / 不同时 evade+spoof / spoof 是非空伪装串 / 门控缺省零改动 /
  //       确定性（FNV·不耗 rng）/ 欺骗 pass 不破迷路结构不变量（只加派生字段、不动 connectsTo/depth/kind）。
  console.log(`\n========== 不可信声呐失真不变量 (zone.blue_caves, 140–180m, sonarDeception=0.32, seeds 1–60) ==========`);
  const decProblems: string[] = [];
  let decTotal = 0, gatedTotal = 0;
  const decFp = (m: DiveMap) =>
    Object.keys(m.nodes).sort().map((id) => `${id}:${m.nodes[id].evadesSonar ? 'E' : ''}${m.nodes[id].spoofsSonar ?? ''}`).join('|');
  for (let seed = 1; seed <= SWEEP; seed++) {
    const zone = getZone('zone.blue_caves')!;
    const base = { zone, profileFlags: FLAGS, deaths: [], depthRange: [140, 180] as [number, number], maxRoomFeatures: 3 };
    const dirty = generateDiveMap({ ...base, rng: makeRng(seed), sonarDeception: 0.32 });
    const clean = generateDiveMap({ ...base, rng: makeRng(seed), sonarDeception: 0 });
    for (const n of Object.values(dirty.nodes)) {
      if (n.evadesSonar || n.spoofsSonar) {
        decTotal++;
        if (['ascent_point', 'air_pocket', 'camp', 'corpse'].includes(n.kind)) decProblems.push(`seed=${seed} ${n.id}: 地标/尸体被欺骗(${n.kind})`);
        if (n.id === dirty.startNodeId) decProblems.push(`seed=${seed} ${n.id}: 起点被欺骗`);
        if (n.evadesSonar && n.spoofsSonar) decProblems.push(`seed=${seed} ${n.id}: 同时 evade+spoof`);
        if (n.spoofsSonar !== undefined && (typeof n.spoofsSonar !== 'string' || n.spoofsSonar.length === 0)) decProblems.push(`seed=${seed} ${n.id}: spoof 串为空`);
      }
    }
    for (const n of Object.values(clean.nodes)) if (n.evadesSonar || n.spoofsSonar) gatedTotal++;
    // 欺骗 pass 不破迷路结构不变量（只加派生字段）
    const a = analyzeMap(dirty);
    if (!a.allReachable || !a.isUndirected || !a.hasCycle || !a.hasDeadEnd) decProblems.push(`seed=${seed}: 欺骗 pass 破坏迷路不变量`);
    if (decFp(generateDiveMap({ ...base, rng: makeRng(seed), sonarDeception: 0.32 })) !== decFp(dirty)) decProblems.push(`seed=${seed}: 欺骗非确定性`);
  }
  if (decProblems.length === 0 && decTotal >= 20 && gatedTotal === 0) {
    console.log(`  ✓ 60 seed 共 ${decTotal} 个欺骗节点·只挂内部节点·门控缺省零改动(${gatedTotal})·确定性·不破迷路不变量`);
  } else {
    if (decTotal < 20) { console.log(`  ✗ 欺骗节点太少（${decTotal}），机制疑似没触发`); fails.push(`S2 欺骗 60 seed 只生成 ${decTotal} 个`); }
    if (gatedTotal !== 0) { console.log(`  ✗ 门控失效：sonarDeception=0 仍有 ${gatedTotal} 欺骗`); fails.push(`S2 门控失效（${gatedTotal}）`); }
    for (const p of decProblems.slice(0, 10)) { console.log(`      ${p}`); fails.push(p); }
  }

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
