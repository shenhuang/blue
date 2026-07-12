// 持久多口洞回归（多口持久洞 SPEC §3·方案 B·模型 B）：
//   generatePersistentCaveMap 的结构 + 深度坐标不变量。守「模型 B」修正（深度=自采坐标·非 hop 距离）焊死。
//   断言：①入口/出口门户数随参数 ②核心唯一最深 ③从每个入口都连通（从不死胡同）④全节点 depth∈[d0,d1]
//        ⑤迷路骨架仍在（死路+环+双向+全可达）⑥跨 beacon 钉口深（authored entranceDepths）落到位
//        ⑦横向不污染深度（加大 sizeScale·门户/核心深度不变）⑧确定性（同 seed 同图·#98）⑨单口退化仍合法。
// 跑法： npx tsx scripts/playthrough-cave.ts

import { generatePersistentCaveMap, analyzeCave, analyzeMap, cavePortalsOf } from '../src/engine/mapgen';
import { getZone } from '../src/engine/zones';
import { getCave, persistentExploredForRun, cavePortalsForChart } from '../src/engine/caves';
import { createInitialGameState } from '../src/engine/state';
import { startDiveFromPoi } from '../src/engine/dive-start';
import { handleReturnToPort } from '../src/engine/port';
import type { CaveGenParams, ChartPoi, ZoneDef } from '../src/types';
import { makeHarness, type PtAssert } from './lib/pt';

const pt = makeHarness('持久多口洞回归');
const { L } = pt;
const assert: PtAssert = pt.assert;

/** 确定性 PRNG（同 mapgen makeSeededRng·测试自带种子·不依赖全局 Math.random patch）。 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ZONE = getZone('zone.vertical_test') as ZoneDef;
assert(ZONE, '前置：zone.vertical_test 应存在（caves.json 引用它）');
const optsFor = (rng: () => number) => ({ zone: ZONE, profileFlags: new Set<string>(), deaths: [], rng });

// —— 0. caves.json 登记表可加载 ——
const registered = getCave('cave.vertical_test');
assert(registered && registered.zoneId === 'zone.vertical_test', '0: getCave(cave.vertical_test) 应解析到登记参数');
L('  0 caves.json 登记表加载 + getCave 解析 ✓');

// —— 1–5. 用登记的 cave.vertical_test 生成 → 结构 + 深度不变量 ——
{
  const params = registered!;
  const [d0, d1] = params.depthRange;
  const map = generatePersistentCaveMap(optsFor(mulberry32(3)), params);
  const ca = analyzeCave(map, params.depthRange);
  const ma = analyzeMap(map);

  assert(ca.entranceCount === params.entrancePortals, `1: 入口门户数应=${params.entrancePortals}，实=${ca.entranceCount}`);
  assert(ca.exitCount === params.exitPortals, `1: 出口门户数应=${params.exitPortals}，实=${ca.exitCount}`);
  assert(ca.coreIsUniqueDeepest, '2: 核心应唯一最深（coreNodeId 唯一）');
  assert(ca.depthInRange, '4: 全节点 depth 应 ∈ [d0,d1]');
  assert(ca.allReachableFromEntrances, '3: 从每个入口都应连通全图（从不死胡同·≥1 出口）');
  // 剖面平滑：相邻深度差不应跨越大半个 span（廊道不跳深·守模型 B）
  assert(ca.maxNeighborDepthGap <= (d1 - d0) * 0.6, `5: 相邻深度差应有界（剖面平滑），实=${ca.maxNeighborDepthGap}/${d1 - d0}`);
  // 迷路骨架仍在
  assert(ma.isUndirected, '5: connectsTo 应双向');
  assert(ma.allReachable, '5: 全节点应从 startNode 可达');
  assert(ma.hasDeadEnd, '5: 应有死路（核心=深处死路终点 + 树叶）');
  assert(ma.hasCycle, '5: 应有环（弦边）');
  // 核心 = 唯一最深 + 是死路终点
  assert(ca.coreNodeId && map.nodes[ca.coreNodeId].depth === d1, '2: 核心深度应=d1');
  // 门户派生
  const portals = cavePortalsOf(map);
  assert(portals.length === params.entrancePortals + params.exitPortals, '门户清单数应=入口+出口');
  L(`  1-5 结构+深度：入口${ca.entranceCount}/出口${ca.exitCount}·核心唯一最深·全连通·depth∈[${d0},${d1}]·邻深差≤${ca.maxNeighborDepthGap}·死路+环+双向 ✓`);
}

// —— 6. 跨 beacon 钉口深（authored entranceDepths·reef 浅口 + vent 深口）——
{
  const params: CaveGenParams = {
    caveId: 'cave.test_crossbeacon', zoneId: 'zone.vertical_test',
    depthRange: [20, 95], sizeScale: 14, entrancePortals: 2, exitPortals: 2,
    entranceDepths: [25, 90], depthCurveRange: [0.8, 1.6],
  };
  const map = generatePersistentCaveMap(optsFor(mulberry32(7)), params);
  const portals = cavePortalsOf(map);
  const ents = portals.filter((p) => p.kind === 'entrance').map((p) => p.depth).sort((a, b) => a - b);
  assert(ents.length === 2, '6: 应有 2 入口门户');
  assert(Math.abs(ents[0] - 25) <= 2 && Math.abs(ents[1] - 90) <= 2, `6: 入口深度应≈[25,90]（钉口深），实=[${ents}]`);
  const ca = analyzeCave(map, params.depthRange);
  assert(ca.coreIsUniqueDeepest && ca.allReachableFromEntrances && ca.depthInRange, '6: 跨 beacon 洞结构不变量仍成立');
  // 区域：浅口=rim·深口=deep（核心更深）
  const entPortals = portals.filter((p) => p.kind === 'entrance');
  assert(entPortals.some((p) => p.region === 'rim') && entPortals.some((p) => p.region === 'deep'), '6: 浅口落 rim、深口落 deep');
  L(`  6 跨 beacon 钉口深：入口深度=[${ents}]（≈[25,90]）·rim+deep·结构不变量保持 ✓`);
}

// —— 7. 横向不污染深度（加大 sizeScale·门户/核心深度不随规模变）——
{
  const base: CaveGenParams = {
    caveId: 'cave.test_size', zoneId: 'zone.vertical_test',
    depthRange: [30, 80], sizeScale: 8, entrancePortals: 2, exitPortals: 1,
    entranceDepths: [35, 50], depthCurveRange: [1, 1],
  };
  const small = generatePersistentCaveMap(optsFor(mulberry32(11)), base);
  const big = generatePersistentCaveMap(optsFor(mulberry32(11)), { ...base, sizeScale: 24 });
  const cs = analyzeCave(small, base.depthRange);
  const cb = analyzeCave(big, base.depthRange);
  // 节点更多
  assert(Object.keys(big.nodes).length > Object.keys(small.nodes).length, '7: 加大 sizeScale 应有更多节点');
  // 但门户深度 + 核心深度 不随规模变（深度是采样坐标·非 hop 距离）
  const ed = (m: typeof small) => cavePortalsOf(m).filter((p) => p.kind === 'entrance').map((p) => p.depth).sort((a, b) => a - b);
  assert(JSON.stringify(ed(small)) === JSON.stringify(ed(big)), `7: 入口深度应与规模无关（横向不污染深度），small=${ed(small)} big=${ed(big)}`);
  assert(cs.coreNodeId && cb.coreNodeId && small.nodes[cs.coreNodeId].depth === 80 && big.nodes[cb.coreNodeId].depth === 80, '7: 核心深度应恒=d1（与规模无关）');
  // 非核心最深点不随规模"变深"（都被 clamp 到 < d1·横向再多也不加深）
  const maxNonCore = (m: typeof small, coreId: string) => Math.max(...Object.values(m.nodes).filter((n) => n.id !== coreId).map((n) => n.depth));
  assert(maxNonCore(small, cs.coreNodeId!) < 80 && maxNonCore(big, cb.coreNodeId!) < 80, '7: 非核心最深点应 < d1（核心独占·横向不加深）');
  L(`  7 横向不污染深度：节点 ${Object.keys(small.nodes).length}→${Object.keys(big.nodes).length}·入口深度不变=[${ed(small)}]·核心恒 d1 ✓`);
}

// —— 8. 确定性（同 caveId + 同 seed → 同图·#98 家族）——
{
  const params = registered!;
  const a = generatePersistentCaveMap(optsFor(mulberry32(42)), params);
  const b = generatePersistentCaveMap(optsFor(mulberry32(42)), params);
  // generatedAt 是时间戳·剔除后比对结构
  const strip = (m: typeof a) => JSON.stringify({ ...m, generatedAt: 0 });
  assert(strip(a) === strip(b), '8: 同 seed 同参数应生成逐字节相同的图（确定性·#98）');
  L('  8 确定性：同 seed 同参数 → 同图（剔 generatedAt）✓');
}

// —— 9. 单口退化（entrancePortals 1·exitPortals 1）仍合法 ——
{
  const params: CaveGenParams = {
    caveId: 'cave.test_single', zoneId: 'zone.vertical_test',
    depthRange: [15, 45], sizeScale: 4, entrancePortals: 1, exitPortals: 1,
  };
  const map = generatePersistentCaveMap(optsFor(mulberry32(99)), params);
  const ca = analyzeCave(map, params.depthRange);
  assert(ca.entranceCount === 1 && ca.exitCount === 1, '9: 单口洞应 1 入口 + 1 出口');
  assert(ca.coreIsUniqueDeepest && ca.allReachableFromEntrances && ca.depthInRange, '9: 单口洞结构不变量仍成立');
  L('  9 单口退化：1 入口 + 1 出口·结构不变量保持 ✓');
}

// —— 10. 下潜集成：load-or-generate + 换口进续上次（§4·绑定 + 持久续存）——
{
  let gs = createInitialGameState();
  gs = { ...gs, profile: { ...gs.profile, flags: new Set(['flag.tutorial_complete']) } };
  const poiA = {
    id: 'poi.test.caveA', zoneId: 'zone.vertical_test', name: '口A', blurb: '', distance: 0,
    persistent: true, caveEntry: { caveId: 'cave.vertical_test', regionBias: 'rim' as const },
  } as unknown as ChartPoi;

  // 首次进 → 生成并冻结进 caveMaps（入存档）
  const s = startDiveFromPoi(gs, poiA);
  assert(s.run && s.run.caveId === 'cave.vertical_test', '10: run.caveId 应= cave.vertical_test');
  assert(s.run!.map && s.run!.map.nodes[s.run!.currentNodeId!]?.portalKind === 'entrance', '10: 首次进起手应在入口门户');
  const frozen = s.profile.caveMaps.get('cave.vertical_test');
  assert(frozen, '10: 首次进应把 cave 冻结进 caveMaps');
  const nodeCountFirst = Object.keys(frozen!.map.nodes).length;

  // 模拟探了几个点 → 回港写回 explored（生还才落袋）
  const visited = Object.keys(s.run!.map!.nodes).slice(0, 3);
  const s1 = { ...s, run: { ...s.run!, visitedNodeIds: visited } };
  const r1 = handleReturnToPort(s1);
  const exploredAfter = r1.state.profile.caveMaps.get('cave.vertical_test')!.explored;
  assert(visited.every((id) => exploredAfter.has(id)), '10: 回港应把访问节点写回 caveMaps.explored');

  // 换口再进（同 caveId·不同 regionBias）→ 同一张冻结图（未重生·节点数不变）+ explored 保留
  const poiB = {
    id: 'poi.test.caveB', zoneId: 'zone.vertical_test', name: '口B', blurb: '', distance: 0,
    persistent: true, caveEntry: { caveId: 'cave.vertical_test', regionBias: 'deep' as const },
  } as unknown as ChartPoi;
  const s2 = startDiveFromPoi(r1.state, poiB);
  const frozen2 = s2.profile.caveMaps.get('cave.vertical_test')!;
  assert(Object.keys(frozen2.map.nodes).length === nodeCountFirst, '10: 换口再进应是同一张图（不重生·节点数不变）');
  assert(frozen2.explored.size >= visited.length, '10: 换口再进 explored 应保留（续上次）');
  assert(s2.run!.map!.nodes[s2.run!.currentNodeId!]?.portalKind === 'entrance', '10: 换口再进起手仍在入口门户');
  L(`  10 下潜集成：首次冻结(${nodeCountFirst}节点)·回港写回 explored(${exploredAfter.size})·换口再进同图+续存(explored ${frozen2.explored.size}) ✓`);
}

// —— 11. 渲染契约助手（§6·纯函数·给声呐图预亮 + T3b 海图分组）——
{
  let gs = createInitialGameState();
  gs = { ...gs, profile: { ...gs.profile, flags: new Set(['flag.tutorial_complete']) } };
  const poi = {
    id: 'poi.test.caveH', zoneId: 'zone.vertical_test', name: '口', blurb: '', distance: 0,
    persistent: true, caveEntry: { caveId: 'cave.vertical_test' },
  } as unknown as ChartPoi;
  const s = startDiveFromPoi(gs, poi);
  // persistentExploredForRun：洞下潜 → Set（首次进为空）；无 run → undefined（非洞零影响）
  assert(persistentExploredForRun(s.profile, s.run ?? undefined) instanceof Set, '11: 洞下潜 persistentExploredForRun 应返回 Set');
  assert(persistentExploredForRun(s.profile, undefined) === undefined, '11: 无 run → undefined（非洞下潜预亮零影响）');
  // cavePortalsForChart：已进过 → 门户清单（入口+出口）；未进过 → undefined
  const portals = cavePortalsForChart(s.profile, 'cave.vertical_test');
  assert(portals && portals.length === registered!.entrancePortals + registered!.exitPortals, '11: cavePortalsForChart 应返回门户清单');
  assert(portals!.some((p) => p.kind === 'entrance') && portals!.some((p) => p.kind === 'exit'), '11: 门户清单含入口+出口');
  assert(cavePortalsForChart(s.profile, 'cave.never_entered') === undefined, '11: 未进过的洞 → undefined');
  L(`  11 渲染契约助手：persistentExploredForRun(Set)·cavePortalsForChart(${portals!.length}口·含入口+出口) ✓`);
}

pt.done();
