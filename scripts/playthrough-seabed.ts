// 开阔水域「贴底节点」判定回归（开阔水域 SPEC §3/§4·engine/seabed.ts 单一真相）。
//
// A. 无坐标兜底路径（手写 fixture·纯引擎断言·不碰 UI）——这些图没有 `node.x`，走 terminalNodeIds 拓扑近似：
//   1. terminalNodeIds：没有更深邻居的节点＝分支终点（真死路 + 全图最深层）·connectsTo 对称
//   2. seabedNodeIds：分支终点 ∧ zoneTag 是有海床档（sand/coral/rock/atoll）；midwater 终点不算贴底
//   3. isFlooredOpenWaterTag：档集锁定——sand/coral/rock/atoll 为真；midwater/reef 为假（守 reef≠atoll 的语义分界）
//   4. floorless：整图终点全 midwater ⇒ seabedNodeIds 空＝纯中层无底蓝水（作者要的「无贴底节点图」能力）
//   5. atSeabed Condition：evalCondition 只在当前节点 ∈ seabedNodeIds 时为真（渲染层锚海床同源·SPEC §4）
//
// B. 带坐标几何路径（`node.x` 存在·#326 起的撒点 mapgen 全走这条）：
//   6. 下包络语义（手写带 x fixture）：两端够不着的浅节点被裁掉、链中间真正更深的节点留住、非包络点不入选
//   7. **真 mapgen 形状门**（5 个开阔 zone × 40 seed = 200 图·用真 deriveMapLayout + 真 buildOpenWaterGeometry
//      + 真 owFloorY·不在门里重写几何）：
//        ① 无埋节点  ∀node: pos.y ≤ owFloorY(pos.x) − layout.r   （节点整个 blip 都得在海床之上）
//        ② 坡度上界  max|dy/dx| ≤ 1（45°·0.5px 步长采样）
//
// 为什么补 6/7（CLAUDE.md「约定要落成会在 regress 里变红的检查」）：本文件此前只有手写 5 节点 fixture，
// 那张图恰好是「同深 + 严格向下」的旧层状拓扑＝**把旧假设固化成了夹具**，从不调 generateDiveMap、从不断言
// floor 形状。于是 #326 把生成器换成撒点 + Gabriel∪MST 无向邻近图、「分支终点」退化成散在中层的局部极大点、
// IDW 被逼成阶跃（近垂直悬崖 + 针尖 + 106 个节点被埋进不透明岩体）时，本回归**全程绿灯**。
// ①② 两条实测：改前 200 图里 159 图超 45°（最大坡 23.2）、67 图共 106 个埋点；改后 0/200 + 最大坡 0.30。
//
// 跑法： npx tsx scripts/playthrough-seabed.ts

import type { DiveMap, DiveNode, GameState, Condition, ZoneTag } from '../src/types';
import { createInitialGameState, createNewRun } from '../src/engine/state';
import { terminalNodeIds, seabedNodeIds, isFlooredOpenWaterTag } from '../src/engine/seabed';
import { evalCondition } from '../src/engine/events';
import { generateDiveMap } from '../src/engine/mapgen';
import { getZone } from '../src/engine/zones';
import { deriveMapLayout } from '../src/ui/mapLayout';
import { buildOpenWaterGeometry, owFloorY } from '../src/ui/openWaterRender';
import { makeHarness, type PtAssert } from './lib/pt';

const pt = makeHarness('开阔水域贴底节点判定回归（terminalNodeIds / seabedNodeIds / atSeabed·SPEC §4）');
const { L } = pt;
const assert: PtAssert = pt.assert;

const sameSet = (a: Set<string>, want: string[]) =>
  a.size === want.length && want.every((k) => a.has(k));

/** connectsTo 对称（双向含来路·同真实分层图）的一张小开阔图：两条支链各到深处一个终点。 */
function node(id: string, depth: number, zoneTag: ZoneTag, connectsTo: string[]): DiveNode {
  return { id, layer: Math.round(depth / 10), depth, zoneTag, kind: 'event', connectsTo, preview: '' };
}
function makeMap(deepTags: { n3: ZoneTag; n4: ZoneTag }): DiveMap {
  return {
    zoneId: 'zone.openwater_sand_test',
    generatedAt: 0,
    startNodeId: 'n0',
    nodes: {
      n0: node('n0', 0, 'sand', ['n1', 'n2']),
      n1: node('n1', 10, 'sand', ['n0', 'n3']),
      n2: node('n2', 10, 'midwater', ['n0', 'n4']),
      n3: node('n3', 20, deepTags.n3, ['n1']), // 支链 A 终点
      n4: node('n4', 20, deepTags.n4, ['n2']), // 支链 B 终点
    },
  };
}

// 1+2：有海床图（终点 n3=sand·n4=midwater）
{
  const map = makeMap({ n3: 'sand', n4: 'midwater' });
  assert(sameSet(terminalNodeIds(map), ['n3', 'n4']), '1: 分支终点＝{n3,n4}（无更深邻居）');
  assert(sameSet(seabedNodeIds(map), ['n3']), '2: 贴底节点＝{n3}（sand 终点·midwater 终点 n4 不算）');
  L('  终点 {n3,n4} / 贴底仅 sand 终点 n3 ✓');
}

// 3：档集锁定（reef 是通用内容 tag·不是开阔水域海床档·别跟 atoll 混）
{
  for (const t of ['sand', 'coral', 'rock', 'atoll'] as ZoneTag[])
    assert(isFlooredOpenWaterTag(t), `3: ${t} 是有海床档`);
  for (const t of ['midwater', 'reef'] as ZoneTag[])
    assert(!isFlooredOpenWaterTag(t), `3: ${t} 不是有海床档（midwater=无底·reef=通用内容 tag）`);
  L('  有海床档＝{sand,coral,rock,atoll}·midwater/reef 排除 ✓');
}

// 4：floorless——整图终点全 midwater ⇒ 无贴底节点（纯中层）
{
  const map = makeMap({ n3: 'midwater', n4: 'midwater' });
  assert(sameSet(terminalNodeIds(map), ['n3', 'n4']), '4: 终点仍是 {n3,n4}');
  assert(seabedNodeIds(map).size === 0, '4: 终点全 midwater ⇒ seabedNodeIds 空＝无底蓝水（无贴底节点图）');
  L('  整图 midwater 终点 ⇒ 零贴底节点（floorless 能力）✓');
}

// 5：atSeabed Condition 只在贴底节点为真（与 seabedNodeIds 同源）
{
  const base: GameState = createInitialGameState();
  const run = createNewRun({ zoneId: 'zone.openwater_sand_test' });
  run.map = makeMap({ n3: 'sand', n4: 'midwater' });
  const at: Condition = { kind: 'atSeabed' };
  const gs = (cid: string | null): GameState => ({ ...base, run: { ...run, currentNodeId: cid } });
  assert(evalCondition(gs('n3'), at), '5: 站 sand 终点 n3 ⇒ atSeabed 真');
  assert(!evalCondition(gs('n4'), at), '5: 站 midwater 终点 n4 ⇒ atSeabed 假（悬空中层·无贴底内容）');
  assert(!evalCondition(gs('n0'), at), '5: 站非终点 n0 ⇒ atSeabed 假');
  assert(!evalCondition(gs(null), at), '5: 无当前节点 ⇒ atSeabed 假');
  assert(!evalCondition({ ...base, run: null }, at), '5: 无 run（港口）⇒ atSeabed 假');
  L('  atSeabed 仅贴底节点真·中层/非终点/无节点/无 run 皆假 ✓');
}

// ============================================================
// B. 带坐标几何路径（node.x 存在 ⇒ 走几何下包络）
// ============================================================

/** 带真 2D 横坐标（米）的节点——有 x 的图走几何下包络，不再走 terminalNodeIds 拓扑近似。 */
function xnode(id: string, x: number, depth: number, zoneTag: ZoneTag, connectsTo: string[] = []): DiveNode {
  return { id, layer: Math.round(depth / 10), depth, x, zoneTag, kind: 'event', connectsTo, preview: '' };
}
function xmap(nodes: DiveNode[]): DiveMap {
  const rec: Record<string, DiveNode> = {};
  for (const n of nodes) rec[n.id] = n;
  return { zoneId: 'zone.openwater_sand_test', generatedAt: 0, startNodeId: nodes[0].id, nodes: rec };
}

// 6：下包络语义（复刻 #326 现场的病灶形状 + 反例）
{
  // 6a 裁两端：a0(x=0,d=73) 与 a1(x=1,d=100) 只差 1m 却差 27m 深（＝实测 node.3/node.1 的形状）——
  //     a0 当锚点会让海床在 1m 内立起 27m（IDW 直接阶跃成悬崖）；它比 a1 浅 ⇒ 海床走 a1 也仍在它之下 ⇒ 该裁。
  //     a4(x=10,d=85) 悬在链之上（非包络点）⇒ 不入选。a3(x=21,d=82) 是右端浅点 ⇒ 同理裁掉。
  const m6a = xmap([
    xnode('a0', 0, 73, 'sand'),
    xnode('a1', 1, 100, 'sand'),
    xnode('a4', 10, 85, 'sand'),
    xnode('a2', 20, 100, 'sand'),
    xnode('a3', 21, 82, 'sand'),
  ]);
  assert(sameSet(seabedNodeIds(m6a), ['a1', 'a2']), '6a: 下包络＝{a1,a2}（两端够不着的浅点 a0/a3 裁掉·链上方的 a4 不入选）');

  // 6b 留中间真深点：坡度都在预算内（±0.2）⇒ 整条链保留＝海床贴着起伏走（宽图上的自适应能力·别退化成平面）
  const m6b = xmap([xnode('b0', 0, 100, 'sand'), xnode('b1', 50, 110, 'sand'), xnode('b2', 100, 100, 'sand')]);
  assert(sameSet(seabedNodeIds(m6b), ['b0', 'b1', 'b2']), '6b: 缓坡链整条保留（中间更深的 b1 是包络点·不被凸包吃掉）');

  // 6c tag 过滤仍在几何路径上生效：midwater 再深也不当海床锚点
  const m6c = xmap([xnode('c0', 0, 100, 'sand'), xnode('c1', 50, 130, 'midwater'), xnode('c2', 100, 100, 'sand')]);
  assert(sameSet(seabedNodeIds(m6c), ['c0', 'c2']), '6c: midwater 节点不入包络（哪怕它最深）——isFlooredOpenWaterTag 过滤先行');

  // 6d floorless（带 x 版）：整图 midwater ⇒ 空集
  const m6d = xmap([xnode('d0', 0, 100, 'midwater'), xnode('d1', 50, 110, 'midwater')]);
  assert(seabedNodeIds(m6d).size === 0, '6d: 整图 midwater（带 x）⇒ seabedNodeIds 空＝无底蓝水');

  // 6e 兜底谓词与 deriveMapLayout 的 `stored` 对齐：**只要有一个节点缺 x** 就整图退回拓扑近似
  //    （渲染层那时走重心排序派生槽位·px 不再是 node.x 的仿射像·几何包络会与画面对不上）。
  const m6e = xmap([
    xnode('e0', 0, 73, 'sand'),
    xnode('e1', 1, 100, 'sand', ['e2']),
    { ...xnode('e2', 20, 100, 'sand'), x: undefined },
  ]);
  assert(
    sameSet(seabedNodeIds(m6e), ['e0', 'e1', 'e2']),
    '6e: 有节点缺 x ⇒ 整图退回 terminalNodeIds 兜底（三个都没有更深邻居 ⇒ 全是终点；' +
      '几何路径本会裁掉浅端 e0 只留 {e1,e2}——两者不同正说明确实走了兜底）',
  );
  L('  下包络：裁陡端 / 留缓坡链 / tag 先过滤 / floorless / 缺 x 整图兜底 ✓');
}

// 7：真 mapgen 形状门——无埋节点 + 坡度上界
{
  const OPEN_WATER_ZONES = [
    'zone.scarlet_tyrant_grounds',
    'zone.openwater_sand_test',
    'zone.openwater_coral_test',
    'zone.openwater_rock_test',
    'zone.openwater_reef_test',
  ];
  const SEEDS = 40;
  const MAX_SLOPE = 1.0; // 45°
  const SAMPLE_STEP = 0.5; // px·够细才抓得住 IDW 在锚点附近的尖峰（步长 2px 会低估一个量级）
  const EDGE_PAD = 40; // 节点包围盒外再看一段（相机会平移过去）
  const FLAGS = new Set(['flag.tutorial_complete']);
  const makeRng = (seed: number): (() => number) => {
    let s = seed >>> 0;
    return () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 0x100000000;
    };
  };

  const buriedFails: string[] = [];
  const slopeFails: string[] = [];
  let maps = 0;
  let worstSlope = 0;
  let anchorTotal = 0;

  for (const zoneId of OPEN_WATER_ZONES) {
    const zone = getZone(zoneId);
    assert(zone, `7: zone ${zoneId} 应存在（开阔水域档案夹具）`);
    for (let seed = 1; seed <= SEEDS; seed++) {
      const map = generateDiveMap({ zone, profileFlags: FLAGS, deaths: [], rng: makeRng(seed) });
      const layout = deriveMapLayout(map);
      const geom = buildOpenWaterGeometry(layout, zone, map);
      maps++;
      const tag = `${zoneId} seed=${seed}`;
      // 这 5 个 zone 的 zoneTagsByDepth 全是有海床档 ⇒ 必须真有海床可测（否则下面两条断言等于空跑）
      assert(geom.floored, `7: ${tag} 应有海床（floored）——否则形状门空跑`);
      anchorTotal += geom.floor.anchors.length;

      // ① 无埋节点：节点整个 blip（半径 layout.r）都要在海床之上。被不透明岩体埋住＝玩法可见的正确性破坏。
      for (const id of Object.keys(layout.pos)) {
        const p = layout.pos[id];
        const fy = owFloorY(p.x, geom.floor);
        if (!(p.y <= fy - layout.r)) {
          buriedFails.push(`${tag} ${id}: y=${p.y.toFixed(1)} 但海床 y=${fy.toFixed(1)}（深度 ${map.nodes[id].depth}m）`);
        }
      }

      // ② 坡度上界：海床是可站可读的地形，不是悬崖/针尖。
      const xs = Object.values(layout.pos).map((p) => p.x);
      const lo = Math.min(...xs) - EDGE_PAD;
      const hi = Math.max(...xs) + EDGE_PAD;
      let maxSlope = 0;
      let atX = lo;
      for (let x = lo; x <= hi; x += SAMPLE_STEP) {
        const s = Math.abs((owFloorY(x + SAMPLE_STEP, geom.floor) - owFloorY(x, geom.floor)) / SAMPLE_STEP);
        if (s > maxSlope) {
          maxSlope = s;
          atX = x;
        }
      }
      if (maxSlope > worstSlope) worstSlope = maxSlope;
      if (maxSlope > MAX_SLOPE) slopeFails.push(`${tag}: |dy/dx|=${maxSlope.toFixed(2)} @ x=${atX.toFixed(1)}`);
    }
  }

  const brief = (a: string[]): string => a.slice(0, 5).join(' | ') + (a.length > 5 ? ` …（共 ${a.length} 处）` : '');
  assert(
    buriedFails.length === 0,
    `7①: ${buriedFails.length} 个节点被海床埋住（应 0）——海床必须恒在全部节点之下：${brief(buriedFails)}`,
  );
  assert(
    slopeFails.length === 0,
    `7②: ${slopeFails.length}/${maps} 图海床坡度超 45°（应 0·最陡 ${worstSlope.toFixed(2)}）：${brief(slopeFails)}`,
  );
  L(
    `  真 mapgen ${maps} 图（${OPEN_WATER_ZONES.length} zone × ${SEEDS} seed）：0 埋点 · 最大坡 ` +
      `${worstSlope.toFixed(2)} ≤ ${MAX_SLOPE} · 锚点均 ${(anchorTotal / maps).toFixed(1)} 个 ✓`,
  );
}

pt.done();
