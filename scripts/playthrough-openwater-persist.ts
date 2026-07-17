// 开阔水域持久化回归（开阔水域持久化 SPEC §2/§3·Lane B 分叉收口实证 + §9 风险#5 验收）：
//   北极星「开阔＝没有墙的洞穴」——开阔持久海域复用 generateDiveMap 层状生成器，走与洞穴**同一条**
//   load-or-generate 持久轨（getPersistentTarget → startDiveIntoPersistent）。本脚本用**脚本内夹具**
//   （seaEntry POI + 现成 openwater 测试 zone）构造持久开阔目标——**不碰 chart_pois.json**（正式登记＝Lane C）。
//   断言：①解析器 seaEntry→kind:'openwater'·无绑定→undefined（落回普通 zone 兜底）
//        ②首次进冻结进 diveMaps[seaId]·run.diveMapId=seaId·单入口起手＝图起点
//        ③冻结图＝层状（vertical layoutStyle）·干净（无尸体节点·portals 空）——尸体/采尽不冻进图（§3）
//        ④生还回港把 visitedNodeIds 写回 diveMaps[seaId].explored（跨潜续存）
//        ⑤再进同一张冻结图（未重生·节点数不变）+ explored 续存 + persistentExploredForRun 对开阔生效（声呐预亮白拿）
//        ⑥applyCaveOverlays 叠上层状图无回归（§9 风险#5）——尸体落工作副本、冻结原图仍干净
//        ⑦save 级采尽 by seaId（run.harvestedSaveItems → harvestedResources[seaId]）跨潜永久。
// 跑法： npx tsx scripts/playthrough-openwater-persist.ts

import { getZone } from '../src/engine/zones';
import { getPersistentTarget, startDiveFromPoi } from '../src/engine/dive-start';
import { persistentExploredForRun } from '../src/engine/caves';
import { applyCaveOverlays } from '../src/engine/mapgen';
import { createInitialGameState } from '../src/engine/state';
import { handleReturnToPort } from '../src/engine/port';
import type { ChartPoi, DeathRecord, DiveMap, ZoneDef } from '../src/types';
import { makeHarness, type PtAssert } from './lib/pt';

const pt = makeHarness('开阔水域持久化回归');
const { L } = pt;
const assert: PtAssert = pt.assert;

/** 确定性 PRNG（同 mapgen makeSeededRng·测试自带种子·不依赖全局 Math.random patch·quirk #129）。 */
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

// 夹具：现成 openwater 测试 zone（layered·canFreeAscend·无 requiresFlags/温度门）+ 脚本内 seaId。
const SEA_ZONE = 'zone.openwater_sand_test';
const SEA_ID = 'sea.qa_sand';
assert(getZone(SEA_ZONE) as ZoneDef | undefined, `前置：${SEA_ZONE} 应存在（openwater 层状测试 zone）`);

/** openwater 入口 POI 夹具（seaEntry 绑到 SEA_ID·脚本内构造·不入 chart_pois.json）。 */
function seaPoi(id: string): ChartPoi {
  return { id, zoneId: SEA_ZONE, name: '开阔口', blurb: '', distance: 0, persistent: true, seaEntry: { seaId: SEA_ID } };
}

// —— 1. 解析器：seaEntry → kind:'openwater'；无绑定 → undefined（落回普通 zone 兜底）——
{
  const t = getPersistentTarget(seaPoi('poi.test.sea'));
  assert(t !== undefined && t.kind === 'openwater' && t.id === SEA_ID, '1: seaEntry POI 应解析成 kind:openwater·id=seaId');
  const plain: ChartPoi = { id: 'poi.plain', zoneId: SEA_ZONE, name: '普通', blurb: '', distance: 0, persistent: false };
  assert(getPersistentTarget(plain) === undefined, '1: 无 caveEntry/seaEntry → undefined（普通 zone 确定性重生兜底）');
  L('  1 解析器：seaEntry→openwater(id=seaId)·无绑定→undefined ✓');
}

// —— 2-3. 首次进：冻结进 diveMaps[seaId]·层状干净图·单入口起手 ——
const gs0 = createInitialGameState();
const s = startDiveFromPoi(gs0, seaPoi('poi.test.seaA'));
assert(s.run != null && s.run.diveMapId === SEA_ID, '2: run.diveMapId 应= seaId');
const frozen = s.profile.diveMaps.get(SEA_ID);
assert(frozen !== undefined, '2: 首次进应把开阔海域冻结进 diveMaps[seaId]（写存档）');
const nodeCountFirst = Object.keys(frozen!.map.nodes).length;
assert(nodeCountFirst > 1, `2: 层状开阔图应多节点，实=${nodeCountFirst}`);
assert(s.run!.currentNodeId === frozen!.map.startNodeId, '2: 开阔 MVP 单入口起手＝图起点（map.startNodeId）');
assert(frozen!.map.layoutStyle === 'vertical', `3: 层状开阔图 layoutStyle 应= vertical（resolveLayoutStyle 兜底），实=${frozen!.map.layoutStyle}`);
assert(!Object.values(frozen!.map.nodes).some((n) => n.kind === 'corpse'), '3: 冻结原图应无尸体节点（干净·尸体是加载时 overlay·不冻进图·§3）');
assert(frozen!.portals.length === 0, `3: 开阔 MVP portals 应为空（单入口·层状不标 portalKind·多入口 defer §5），实=${frozen!.portals.length}`);
L(`  2-3 首次进：冻结(${nodeCountFirst}节点)·run.diveMapId=seaId·单入口起手·层状 vertical·干净无尸·portals 空 ✓`);

// —— 4. 生还回港写回 explored（by seaId·生还才落袋）——
const visited = Object.keys(s.run!.map!.nodes).slice(0, 3);
const s1 = { ...s, run: { ...s.run!, visitedNodeIds: visited } };
const r1 = handleReturnToPort(s1);
const exploredAfter = r1.state.profile.diveMaps.get(SEA_ID)!.explored;
assert(visited.every((id) => exploredAfter.has(id)), '4: 生还回港应把 visitedNodeIds 写回 diveMaps[seaId].explored');
L(`  4 回港写回：explored[seaId] += 访问节点(${exploredAfter.size}) ✓`);

// —— 5. 再进：同一张冻结图（未重生·节点数不变）+ explored 续存 + 声呐预亮契约 ——
const s2 = startDiveFromPoi(r1.state, seaPoi('poi.test.seaB'));
const frozen2 = s2.profile.diveMaps.get(SEA_ID)!;
assert(Object.keys(frozen2.map.nodes).length === nodeCountFirst, '5: 再进应是同一张冻结图（未每潜重生·节点数不变）');
assert(frozen2.explored.size >= visited.length, `5: 再进 explored 应续存（≥${visited.length}），实=${frozen2.explored.size}`);
assert(persistentExploredForRun(s2.profile, s2.run ?? undefined) instanceof Set, '5: persistentExploredForRun 对开阔海域生效（声呐图「已探片预亮」白拿）');
assert(persistentExploredForRun(s2.profile, undefined) === undefined, '5: 无 run → undefined（预亮零影响）');
L(`  5 再进续存：同图(${nodeCountFirst}节点·未重生)·explored 续存(${frozen2.explored.size})·persistentExploredForRun→Set ✓`);

// —— 6. applyCaveOverlays 叠上层状图（§9 风险#5·尸体落工作副本·冻结原图仍干净）——
{
  const corpse: DeathRecord = {
    id: 'death.qa.sand', runId: 'run.qa', diverName: 'QA', depthAtDeath: 28,
    zoneId: SEA_ZONE, zoneTag: 'sand', cause: 'test', inventorySnapshot: [{ itemId: 'scrap.test', qty: 1 }],
    goldAtDeath: 0, recovered: false, diedOnDay: 0, timestamp: 0,
  };
  // 工作副本（JSON 深拷贝·同 dive-start.cloneDiveMap）——overlay 只改副本、不碰冻结原图。
  const work: DiveMap = JSON.parse(JSON.stringify(frozen!.map));
  // targetCorpseId 强制布点（绕 corpseChance·确定性）——证明 overlay 能在层状图落尸。
  applyCaveOverlays(work, { deaths: [corpse], zoneId: SEA_ZONE, targetCorpseId: 'death.qa.sand', rng: mulberry32(7) });
  const corpseNodes = Object.values(work.nodes).filter((n) => n.kind === 'corpse');
  assert(corpseNodes.length === 1 && corpseNodes[0].corpseRecordId === 'death.qa.sand', '6: applyCaveOverlays 应把尸体叠上层状图工作副本（overlay 对开阔生效）');
  assert(!Object.values(frozen!.map.nodes).some((n) => n.kind === 'corpse'), '6: 冻结原图应仍干净（overlay 只改工作副本·不冻进图·§3）');
  L(`  6 overlay 无回归：层状工作副本落尸 1（${corpseNodes[0].id}）·冻结原图仍干净 ✓`);
}

// —— 7. save 级采尽 by seaId（跨潜永久·记账 key = diveMapId·§4）——
{
  const sDive = startDiveFromPoi(createInitialGameState(), seaPoi('poi.test.seaHarvest'));
  const s7 = { ...sDive, run: { ...sDive.run!, harvestedSaveItems: new Set(['ore.test']), visitedNodeIds: [sDive.run!.currentNodeId!] } };
  const r7 = handleReturnToPort(s7);
  const depleted = r7.state.profile.harvestedResources.get(SEA_ID);
  assert(depleted !== undefined && depleted.has('ore.test'), '7: save 级采尽应 by seaId 写回 harvestedResources[seaId]（记账 key = diveMapId·跨潜永久）');
  L(`  7 save 采尽：harvestedResources[seaId] ⊇ {ore.test}（by diveMapId·任一口进都算同一海采尽）✓`);
}

pt.done();
