// 开阔水域「贴底节点」判定回归（开阔水域 SPEC §4·engine/seabed.ts 单一真相）。纯引擎断言（不碰 UI）：
//   1. terminalNodeIds：没有更深邻居的节点＝分支终点（真死路 + 全图最深层）·connectsTo 对称
//   2. seabedNodeIds：分支终点 ∧ zoneTag 是有海床档（sand/coral/rock/atoll）；midwater 终点不算贴底
//   3. isFlooredOpenWaterTag：档集锁定——sand/coral/rock/atoll 为真；midwater/reef 为假（守 reef≠atoll 的语义分界）
//   4. floorless：整图终点全 midwater ⇒ seabedNodeIds 空＝纯中层无底蓝水（作者要的「无贴底节点图」能力）
//   5. atSeabed Condition：evalCondition 只在当前节点 ∈ seabedNodeIds 时为真（渲染层锚海床同源·SPEC §4）
//
// 跑法： npx tsx scripts/playthrough-seabed.ts

import type { DiveMap, DiveNode, GameState, Condition, ZoneTag } from '../src/types';
import { createInitialGameState, createNewRun } from '../src/engine/state';
import { terminalNodeIds, seabedNodeIds, isFlooredOpenWaterTag } from '../src/engine/seabed';
import { evalCondition } from '../src/engine/events';
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

pt.done();
