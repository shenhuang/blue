// 声呐探索扫描回归（声呐与房间 SPEC §5/§7「S0」）。纯引擎断言（不碰 UI/combat）：
//   1. revealSonarScan：有限程无向 BFS——range 决定揭示几跳、永不照全洞、含 origin、缺 origin → []
//   2. sonarScanRange：S0 基线常量（升级轨留后续）
//   3. pingSonar 写 scanMemory（盖当前节点为扫描中心·stamp 当前 turn）+ 扣电 + sonar='ping'
//   4. 软门控：声呐未解锁 → ping 无效（不写记忆、不扣电）
//   5. 1 scan / 停留：已 ping（未移动）→ 再 ping no-op（不重复扣电/写记忆）
//   6. ping 当场抬警觉：深水 spike / 浅水免压（深度因子 0）/ 深 band 倍率 / clamp 上限
//   7. 会过时的记忆：持续开到站自动扫(盖新中心)·turn 前进；再 ping 刷新被扫到的 stamp，没扫到的留旧 stamp（staleness）
//   9. 不动存档：scanMemory 走 JSON round-trip，SAVE_VERSION = 6（#131 §10）
//
// 跑法： npx tsx scripts/playthrough-sonar.ts

import type { GameState, RunState, DiveMap } from '../src/types';
import {
  createInitialGameState,
  createNewRun,
  serializeGameState,
  deserializeGameState,
} from '../src/engine/state';
import { pingSonar, moveToNode, enterNodeSelection, exploreFeature, setSonarNext, startDive } from '../src/engine/dive';
import {
  POWER_MAX,
  SONAR_PING_COST,
  ALERT_MAX,
  ALERT_THRESHOLD,
  THREAT_CONTACT_ALERT,
  sonarPingAlertDelta,
  alertDelta,
  sonarStandingOn,
  sonarStandingNext,
  alertDepthFactor,
  sonarReturn,
  nodeSonarView,
  sonarPhantoms,
  threatContact,
  effectiveFalseEchoSanity,
  SONAR_FALSE_ECHO_SANITY,
  SONAR_FALSE_ECHO_SANITY_BAND_MAX,
  deriveSensorTuning,
} from '../src/engine/clarity';
import { generateDiveMap } from '../src/engine/mapgen';
import { getZone } from '../src/engine/zones';
import { getBand } from '../src/engine/bands';
import type { DiveNode } from '../src/types';
import {
  revealSonarScan,
  sonarScanRange,
  SONAR_SCAN_RANGE,
  SONAR_SCAN_RANGE_MAX,
} from '../src/engine/sonar';
import { makeHarness, type PtAssert } from './lib/pt';

const pt = makeHarness('声呐探索扫描回归（S0 + S1 多事件房间 + S2 不可信扫描 + S3 威胁定位 + 开/关窗口 §4）');
const { L } = pt;
const assert: PtAssert = pt.assert;
const sortedKeys = (o: Record<string, number>) => Object.keys(o).sort();
const sameSet = (a: string[], b: string[]) =>
  a.length === b.length && [...a].sort().join('|') === [...b].sort().join('|');

/**
 * 一张分叉的小洞图（无向连通，两条支链各两节点深），用于测有限程 BFS：
 *   n0 ─ n1 ─ n3 ─ n4        从 n0：range1={n0,n1,n2} / range2=+{n3,n5} / range3=+{n4,n6}（全）
 *    └─ n2 ─ n5 ─ n6         从 n1 range2 够不到 n5（留作 staleness 的"旧记忆"）
 */
function makeMap(): DiveMap {
  return {
    zoneId: 'zone.blue_caves',
    generatedAt: 0,
    startNodeId: 'n0',
    nodes: {
      n0: { id: 'n0', layer: 0, depth: 50, zoneTag: 'cave', kind: 'event', connectsTo: ['n1', 'n2'], preview: '起点。' },
      n1: { id: 'n1', layer: 1, depth: 56, zoneTag: 'cave', kind: 'event', connectsTo: ['n3'], preview: '' },
      n2: { id: 'n2', layer: 1, depth: 56, zoneTag: 'cave', kind: 'event', connectsTo: ['n5'], preview: '' },
      n3: { id: 'n3', layer: 2, depth: 62, zoneTag: 'cave', kind: 'event', connectsTo: ['n4'], preview: '' },
      n4: { id: 'n4', layer: 3, depth: 70, zoneTag: 'cave', kind: 'event', connectsTo: [], preview: '' },
      n5: { id: 'n5', layer: 2, depth: 62, zoneTag: 'cave', kind: 'event', connectsTo: ['n6'], preview: '' },
      n6: { id: 'n6', layer: 3, depth: 70, zoneTag: 'cave', kind: 'event', connectsTo: [], preview: '' },
    },
  };
}

function mk(opts?: {
  depth?: number;
  sonarUnlocked?: boolean;
  power?: number;
  alert?: number;
  bandAlertFactor?: number;
}): GameState {
  const base = createInitialGameState();
  const r0 = createNewRun({ zoneId: 'zone.blue_caves', bonuses: { sonarUnlocked: opts?.sonarUnlocked ?? true } });
  const run: RunState = {
    ...r0,
    map: makeMap(),
    currentNodeId: 'n0',
    currentDepth: opts?.depth ?? 50,
    power: opts?.power ?? r0.power,
    alert: opts?.alert ?? 0,
    bandAlertFactor: opts?.bandAlertFactor ?? 1, // 必填化（#107）：显式 undefined 会盖掉 createNewRun 种子 → 给 canonical 默认
  };
  return { ...base, run, phase: { kind: 'dive', subPhase: { kind: 'nodeSelect', choices: [] } } };
}

/**
 * 多事件房间地图（声呐与房间 S1）：r0 = 3-feature 大房间，连到单事件房间 r1 + 上浮口 rx。
 * 事件 id 任意（本脚本只测「地图层」路由——不查事件表）。
 */
function makeRoomMap(): DiveMap {
  return {
    zoneId: 'zone.blue_caves',
    generatedAt: 0,
    startNodeId: 'r0',
    nodes: {
      r0: {
        id: 'r0', layer: 0, depth: 120, zoneTag: 'cave', kind: 'event',
        features: [
          { id: 'f0', eventId: 'ev.a', preview: '一处 A' },
          { id: 'f1', eventId: 'ev.b', preview: '一处 B' },
          { id: 'f2', eventId: 'ev.c', preview: '一处 C' },
        ],
        connectsTo: ['r1', 'rx'], preview: '前方水域开阔。',
      },
      r1: { id: 'r1', layer: 1, depth: 128, zoneTag: 'cave', kind: 'event', eventId: 'ev.single', connectsTo: ['rx'], preview: '单事件房间' },
      rx: { id: 'rx', layer: 2, depth: 120, zoneTag: 'cave', kind: 'ascent_point', connectsTo: [], preview: '出口' },
    },
  };
}

function mkAt(map: DiveMap, nodeId: string): GameState {
  const base = createInitialGameState();
  const r0 = createNewRun({ zoneId: map.zoneId });
  const node = map.nodes[nodeId];
  const run: RunState = {
    ...r0,
    map,
    currentNodeId: nodeId,
    currentDepth: node.depth,
    visitedNodeIds: [nodeId],
  };
  return { ...base, run, phase: { kind: 'dive', subPhase: { kind: 'nodeSelect', choices: [] } } };
}

// ============================================================
// 1. revealSonarScan：有限程无向 BFS
// ============================================================
L('========== 1. revealSonarScan 有限程 BFS ==========');
{
  const map = makeMap();
  assert(sameSet(revealSonarScan(map, 'n0', 1), ['n0', 'n1', 'n2']), '1: range1 = origin + 直接邻居');
  assert(sameSet(revealSonarScan(map, 'n0', 2), ['n0', 'n1', 'n2', 'n3', 'n5']), '1: range2 = 两跳（未及最深 n4/n6）');
  assert(
    sameSet(revealSonarScan(map, 'n0', 3), ['n0', 'n1', 'n2', 'n3', 'n4', 'n5', 'n6']),
    '1: range3 = 照全（小洞够大 range 才全揭）',
  );
  // 无向：从 n1 也照得到上游 n0
  assert(revealSonarScan(map, 'n1', 1).includes('n0'), '1: 无向 BFS——照得到来时的上游');
  // origin 永远含自己；缺 origin → []
  assert(revealSonarScan(map, 'n0', 0).join() === 'n0', '1: range0 = 只有你自己');
  assert(revealSonarScan(map, 'nope', 2).length === 0, '1: 不存在的 origin → 空');
  L('  range1/2/3 限程 + 无向上游 + origin 兜底 ✓');
}

// ============================================================
// 2. sonarScanRange：范围升级轴（声呐与房间 §8.1）——基线 + 升级逐级扩、有上限（< 最深 + < 全洞）
// ============================================================
L('\n========== 2. sonarScanRange 范围升级轴（§8.1）==========');
{
  // 缺省（未升级 / 部分 run）→ 基线
  assert(sonarScanRange(mk().run!) === SONAR_SCAN_RANGE, '2: 缺省 = 基线常量');
  // 升级 +1（经 deriveSensorTuning 烤进 run.sensorTuning）→ 范围 +1
  const up1 = createNewRun({ zoneId: 'zone.blue_caves', bonuses: { sonarUnlocked: true, sonarScanRangeBonus: 1 } });
  assert(sonarScanRange(up1) === SONAR_SCAN_RANGE + 1, '2: +1 升级 → 扫描范围 +1');
  // 升满有上限——守北极星「扫不穿整洞、照不到最深」
  const upMax = createNewRun({ zoneId: 'zone.blue_caves', bonuses: { sonarUnlocked: true, sonarScanRangeBonus: 99 } });
  assert(sonarScanRange(upMax) === SONAR_SCAN_RANGE_MAX, '2: 升满夹到上限 SONAR_SCAN_RANGE_MAX');
  // 范围 +1 → 一记 ping 揭示更多节点（makeMap：range2=5 → range3=7 全揭）
  const baseReveal = revealSonarScan(makeMap(), 'n0', SONAR_SCAN_RANGE);
  const upReveal = revealSonarScan(makeMap(), 'n0', SONAR_SCAN_RANGE + 1);
  assert(upReveal.length > baseReveal.length, '2: 范围 +1 → 一记 ping 揭示更多节点');
  L(`  基线 ${SONAR_SCAN_RANGE} → 升级 ${SONAR_SCAN_RANGE + 1} → 上限 ${SONAR_SCAN_RANGE_MAX}；揭示 ${baseReveal.length}→${upReveal.length} 节点 ✓`);
}

// ============================================================
// 3. pingSonar 写 scanMemory + 扣电 + sonar=ping
// ============================================================
L('\n========== 3. ping 写 scanMemory + 扣电 ==========');
{
  const s = pingSonar(mk());
  const run = s.run!;
  assert(run.power === POWER_MAX - SONAR_PING_COST, `3: ping 扣 ${SONAR_PING_COST} 电`);
  assert(run.sensors.sonar === 'ping', '3: ping 后 sonar=ping');
  assert(
    sameSet(sortedKeys(run.scanMemory ?? {}), ['n0']),
    '3: scanMemory = 本回合扫描中心＝当前节点（几何圆揭示·scanReveal 只盖当前节点·作者 06-13 重设计）',
  );
  assert(run.scanMemory!['n0'] === run.turn, '3: 扫描中心 stamp 当前 turn');
  L('  ping 盖当前节点为扫描中心 + 扣电 + stamp turn ✓');
}

// ============================================================
// 4. 软门控：未解锁声呐 → ping 无效
// ============================================================
L('\n========== 4. 未解锁 → ping 无效 ==========');
{
  const s0 = mk({ sonarUnlocked: false });
  const p0 = s0.run!.power;
  const s = pingSonar(s0);
  assert(s.run!.power === p0, '4: 未解锁 ping 不扣电');
  assert(Object.keys(s.run!.scanMemory ?? {}).length === 0, '4: 未解锁 ping 不写 scanMemory（图保持全黑）');
  L('  未解锁声呐：ping no-op、声呐图保持全黑 ✓');
}

// ============================================================
// 5. 1 scan / 停留：已 ping → 再 ping no-op
// ============================================================
L('\n========== 5. 1 scan / 停留 ==========');
{
  const once = pingSonar(mk());
  const twice = pingSonar(once);
  assert(twice.run!.power === once.run!.power, '5: 同一站第二记 ping 不重复扣电');
  assert(
    sameSet(sortedKeys(twice.run!.scanMemory ?? {}), sortedKeys(once.run!.scanMemory ?? {})),
    '5: 第二记 ping 不改 scanMemory（移动后才能再扫）',
  );
  L('  已 ping → 再 ping no-op（移动后才能刷新）✓');
}

// ============================================================
// 6. ping 当场抬警觉：深水 spike / 浅水免压 / 深 band 倍率 / clamp
// ============================================================
L('\n========== 6. ping 抬警觉 ==========');
{
  // 深水（50m）：alert 从 0 抬到 sonarPingAlertDelta
  const deep0 = mk({ depth: 50 });
  const deep = pingSonar(deep0);
  const expect = sonarPingAlertDelta(deep0.run!);
  assert(expect > 0 && Math.abs(deep.run!.alert - expect) < 1e-9, '6: 深水 ping 抬警觉 = sonarPingAlertDelta');
  // 浅水（15m）：深度因子 0 → 免压
  assert(alertDepthFactor(mk({ depth: 15 }).run!) === 0, '6: 浅水深度因子 0');
  const shallow = pingSonar(mk({ depth: 15 }));
  assert(shallow.run!.alert === 0, '6: 浅水 ping 不抬警觉（§7.5 免压）');
  // 深 band 倍率：×2 → spike 翻倍
  const band = pingSonar(mk({ depth: 50, bandAlertFactor: 2 }));
  assert(Math.abs(band.run!.alert - 2 * expect) < 1e-9, '6: 深 band 倍率把 ping spike 翻倍（越深越狠）');
  // clamp 上限
  const capped = pingSonar(mk({ depth: 50, alert: 99 }));
  assert(capped.run!.alert === ALERT_MAX, '6: ping 抬警觉 clamp 到 ALERT_MAX');
  L(`  深水 +${expect.toFixed(2)} / 浅水免压 / band×2 翻倍 / clamp ✓`);
}

// ============================================================
// 7. 会过时的记忆 + scan-on-open（声呐渲染重做 §4）：声呐持续开 → 到站自动扫一记（sonar 保持 ping）；
//    量程外的旧记忆随你而留（保留到下次被扫到才刷新·staleness），量程内的刷新成新 turn。
// ============================================================
L('\n========== 7. 会过时的记忆 + scan-on-open（§4·staleness）==========');
{
  const first = pingSonar(mk({ depth: 50 })); // 在 n0·turn 0·scanReveal 只盖中心 → scanMemory={n0:0}
  const t0 = first.run!.turn;
  const moved = moveToNode(first, 'n1'); // 去 n1：声呐持续开 → 到站自动扫一记（scan-on-open §4）·turn 前进·盖新中心 n1
  assert(moved.run!.sensors.sonar === 'ping', '7: 声呐持续开 → 到站自动扫（sonar 保持 ping·scan-on-open §4，不再「移动归 off」）');
  assert(moved.run!.turn > t0, '7: 移动后 turn 前进');
  const t1 = moved.run!.turn;
  assert(moved.run!.scanMemory!['n1'] === t1, '7: 到站自动扫＝盖新扫描中心 n1（新 turn）');
  assert(moved.run!.scanMemory!['n0'] === t0, '7: 旧扫描中心 n0 随你而留——仍是旧 turn（中心记忆持久·staleness）');
  assert(t1 > t0, '7: 新 stamp 比旧 stamp 新');
  L('  持续开→到站自动扫(scan-on-open·盖新中心) + 旧中心留存(staleness) ✓');
}

// ============================================================
// 9. 不动存档：scanMemory round-trip，SAVE_VERSION = 6（#131 §10）
// ============================================================
L('\n========== 9. scanMemory round-trip ==========');
{
  const s = pingSonar(mk({ depth: 50 }));
  const back = deserializeGameState(serializeGameState(s));
  assert(back !== null, '9: 反序列化成功');
  assert(back!.version === 12, '9: SAVE_VERSION 12（月相 Phase 0b bump·scanMemory 本身不影响）');
  assert(
    sameSet(sortedKeys(back!.run!.scanMemory ?? {}), sortedKeys(s.run!.scanMemory ?? {})),
    '9: scanMemory 原样 round-trip（普通对象、无需迁移）',
  );
  L('  scanMemory JSON round-trip、版本不 bump ✓');
}

// ============================================================
// 10. 多事件房间（声呐与房间 S1）：房间菜单 + 连探付氧 + 已探过滤 + 路由 + 向后兼容
// ============================================================
L('\n========== 10. 多事件房间（S1）==========');
{
  const map = makeRoomMap();

  // (a) enterNodeSelection 在大房间里把未探 feature + 出口一起摆出
  const sel = enterNodeSelection(mkAt(map, 'r0'));
  assert(sel.phase.kind === 'dive' && sel.phase.subPhase.kind === 'nodeSelect', '10a: 大房间→nodeSelect');
  assert(sel.phase.subPhase.features?.length === 3, '10a: 房内 3 个未探 feature 全摆出');
  assert(sel.phase.subPhase.choices.length === 2, '10a: 出口（r1 + rx）作为 choices 并列');

  // (b) exploreFeature 触发其事件 + 连探付氧 + 标记已探 + 不离开房间
  const oxBefore = sel.run!.stats.oxygen;
  const ex = exploreFeature(sel, 'f0');
  assert(ex.phase.kind === 'dive' && ex.phase.subPhase.kind === 'event' && ex.phase.subPhase.eventId === 'ev.a', '10b: 探 f0 → 触发 ev.a');
  assert(ex.run!.stats.oxygen < oxBefore, '10b: 连探付氧（氧减少）');
  assert(ex.run!.activeFlags.has('feat:r0:f0'), '10b: 标记 f0 已探');
  assert(ex.run!.currentNodeId === 'r0', '10b: 没离开房间（currentNodeId 不变）');

  // (c) 事件结算后回房间菜单：f0 不再列出，剩 f1/f2
  const back = enterNodeSelection(ex);
  assert(back.phase.kind === 'dive' && back.phase.subPhase.kind === 'nodeSelect', '10c: 回 nodeSelect');
  const remain = back.phase.subPhase.features ?? [];
  assert(remain.length === 2 && remain.every((f) => f.featureId !== 'f0'), '10c: f0 已探→不再列出，剩 f1/f2');

  // (d) 已探的 feature 再 explore = no-op（守卫，原样返回）
  const noop = exploreFeature(ex, 'f0');
  assert(noop === ex, '10d: 已探 feature 再探 no-op（原样返回）');

  // (e) moveToNode 进多事件房间 → 房间菜单（不自动触发事件）
  const entered = moveToNode(mkAt(map, 'r1'), 'r0');
  assert(entered.phase.kind === 'dive' && entered.phase.subPhase.kind === 'nodeSelect', '10e: 进大房间→nodeSelect 菜单（非 event）');
  assert(entered.phase.subPhase.features?.length === 3, '10e: 菜单含 3 feature');

  // (f) 向后兼容：单事件节点 moveToNode → 仍自动触发事件（旧行为）
  const single = moveToNode(mkAt(map, 'r0'), 'r1');
  assert(single.phase.kind === 'dive' && single.phase.subPhase.kind === 'event' && single.phase.subPhase.eventId === 'ev.single', '10f: 单事件节点仍自动触发（向后兼容）');

  // (g) 探完所有 feature 后回菜单：只剩出口（features 为空）
  let s2 = sel;
  for (const fid of ['f0', 'f1', 'f2']) {
    s2 = exploreFeature(s2, fid);
    s2 = enterNodeSelection(s2);
  }
  assert(s2.phase.kind === 'dive' && s2.phase.subPhase.kind === 'nodeSelect', '10g: 探完回 nodeSelect');
  assert((s2.phase.subPhase.features ?? []).length === 0, '10g: 全探完→features 清空，只剩出口');

  L('  房间菜单 / 连探付氧 / 已探过滤 / 进房路由 / 向后兼容 / 探完清空 ✓');
}

// ============================================================
// 11. 不可信扫描（声呐与房间 S2）：spoof/evade 表象 + 深 band 失真阈值(封顶/回落) + 低 san 伪接触/读数乱码 + mapgen 欺骗 pass
// ============================================================
L('\n========== 11. 不可信扫描（S2）==========');
{
  const makeRng = (seed: number) => { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 0x100000000; }; };
  // 纯 run（只喂 clarity 需要的字段；必填化〔#107〕后读点直读 → fixture 显式种 canonical 默认）。
  const run = (o?: { sanity?: number; turn?: number; dec?: number }): RunState =>
    ({ stats: { sanity: o?.sanity ?? 100 }, turn: o?.turn ?? 0, sonarDeception: o?.dec ?? 0, sensorTuning: deriveSensorTuning({}) } as unknown as RunState);
  const node = (o: Partial<DiveNode>): DiveNode =>
    ({ id: 'x', layer: 1, depth: 150, zoneTag: 'cave', kind: 'event', connectsTo: [], preview: '真相', ...o });

  // (a) evadesSonar → 无回波：文本「吞了」、nodeSonarView.noEcho + deceptive（声呐图不画）
  const ev = node({ id: 'ev', evadesSonar: true });
  assert(sonarReturn(run({ sanity: 100 }), ev).includes('吞'), '11a: evade 文本＝无回波（脉冲被吞）');
  const evv = nodeSonarView(run({}), ev);
  assert(evv.noEcho && evv.deceptive, '11a: evade → noEcho + deceptive');

  // (b) spoofsSonar → 假信标（节点版 mimic）：文本「像…」、displayKind 画成上浮口、deceptive、不 noEcho
  const sp = node({ id: 'sp', spoofsSonar: '一道朝上的出口' });
  assert(sonarReturn(run({}), sp).includes('一道朝上的出口'), '11b: spoof 文本＝伪装成假信标');
  const spv = nodeSonarView(run({}), sp);
  assert(spv.displayKind === 'ascent_point' && spv.deceptive && !spv.noEcho, '11b: spoof → 声呐图画成上浮口(假信标)、deceptive');

  // (c) effectiveFalseEchoSanity：缺省＝基线（守 sensors 回归）/ 欺骗越强阈值越高（越深越易骗）/ 封顶
  assert(effectiveFalseEchoSanity(run({})) === SONAR_FALSE_ECHO_SANITY, '11c: 缺省 band → 恰好基线（零行为变化）');
  const thrT2 = effectiveFalseEchoSanity(run({ dec: getBand('band.trench.t2')!.sonarDeception })); // 0.1
  const thrT3 = effectiveFalseEchoSanity(run({ dec: getBand('band.trench.t3')!.sonarDeception })); // 0.15
  assert(thrT2 > SONAR_FALSE_ECHO_SANITY && thrT3 > thrT2, '11c: 欺骗越强越易骗（trench.t2 0.1 < trench.t3 0.15）');
  assert(effectiveFalseEchoSanity(run({ dec: 99 })) === SONAR_FALSE_ECHO_SANITY_BAND_MAX, '11c: 深 band 失真有封顶（高 san 仍留一线可信）');

  // (d) 低 san 伪接触：低 san + 深 band → 幻影 blip；高 san → 无（大致为真）；锚在真实接触上
  const mem: Record<string, number> = {}; for (let i = 0; i < 6; i++) mem['n' + i] = 0;
  const ph = sonarPhantoms(run({ sanity: 18, dec: 0.32 }), mem);
  assert(ph.length >= 1, '11d: 低 san + 深 band → 伪接触（幻影 blip）');
  assert(ph.every((p) => mem[p.nearNodeId] !== undefined), '11d: 伪接触锚在真实接触附近（随其余像渐隐）');
  assert(sonarPhantoms(run({ sanity: 100, dec: 0.32 }), mem).length === 0, '11d: 高 san → 无伪接触（大致为真）');

  // (e) 读数乱码：低 san 时部分节点 garbled；高 san 不坏
  const someGarbled = (sanity: number) =>
    ['n0', 'n1', 'n2', 'n3', 'n4', 'n5'].some((id) => nodeSonarView(run({ sanity, dec: 0.32, turn: 0 }), node({ id })).garbled);
  assert(someGarbled(18), '11e: 低 san → 部分读数乱码（garbled）');
  assert(!someGarbled(100), '11e: 高 san → 读数不坏');

  // (f) mapgen 欺骗 pass：深 band 给部分内部节点挂 spoofs/evades；门控缺省零改动；地标/起点/尸体豁免；确定性
  const zone = getZone('zone.blue_caves')!;
  const genDeep = (seed: number, dec: number) =>
    generateDiveMap({ zone, profileFlags: new Set(['flag.tutorial_complete']), deaths: [], rng: makeRng(seed), depthRange: [140, 180], maxRoomFeatures: 3, sonarDeception: dec });
  let totalDeceived = 0, totalBadExempt = 0, totalGated = 0;
  for (let seed = 1; seed <= 12; seed++) {
    const dirty = genDeep(seed, 0.32);
    const clean = genDeep(seed, 0);
    for (const n of Object.values(dirty.nodes)) {
      if (n.evadesSonar || n.spoofsSonar) {
        totalDeceived++;
        if (['ascent_point', 'air_pocket', 'camp', 'corpse'].includes(n.kind) || n.id === dirty.startNodeId) totalBadExempt++;
      }
    }
    for (const n of Object.values(clean.nodes)) if (n.evadesSonar || n.spoofsSonar) totalGated++;
  }
  assert(totalDeceived >= 6, `11f: 深 band 12 seed 累计有欺骗节点（实得 ${totalDeceived}）`);
  assert(totalBadExempt === 0, '11f: 地标/起点/尸体永不被欺骗（结构性可感、守 #36）');
  assert(totalGated === 0, '11f: 门控缺省（sonarDeception=0）→ 零欺骗字段＝旧图逐字节不变（向后兼容）');
  const fp = (m: DiveMap) => Object.values(m.nodes).map((n) => `${n.id}:${n.evadesSonar ? 'E' : ''}${n.spoofsSonar ? 'S' : ''}`).sort().join('|');
  assert(fp(genDeep(5, 0.32)) === fp(genDeep(5, 0.32)), '11f: 欺骗确定性（同 seed 两次一致·FNV 哈希不耗 rng）');

  // (g) 数据守则：柱越深 sonarDeception 越强（trench.t2 0.1 → t3 0.15）；浅 band 不设
  assert(getBand('band.home.t1')!.sonarDeception === undefined, '11g: 浅柱档（home.t1）不设欺骗（浅段相对老实）');
  assert(getBand('band.trench.t1')!.sonarDeception === undefined, '11g: 海沟柱浅档（trench.t1）不设欺骗');
  assert(
    (getBand('band.trench.t2')!.sonarDeception ?? 0) < (getBand('band.trench.t3')!.sonarDeception ?? 0),
    '11g: 海沟柱越深欺骗越强（trench.t2 0.1 < trench.t3 0.15）',
  );

  L('  spoof/evade 表象 + 深 band 失真阈值(封顶/回落) + 低 san 伪接触/乱码 + mapgen 欺骗(门控/豁免/确定性) ✓');
}

// ============================================================
// 12. 威胁定位（声呐与房间 S3 廉价版）：run.alert → 近似接触 + 粗距档 + 低 san 读不出
// ============================================================
L('\n========== 12. 威胁定位（S3 廉价版）==========');
{
  const tr = (o: { alert?: number; sanity?: number; turn?: number; dec?: number }): RunState =>
    ({ alert: o.alert ?? 0, stats: { sanity: o.sanity ?? 100 }, turn: o.turn ?? 0, sonarDeception: o.dec ?? 0, sensorTuning: deriveSensorTuning({}) } as unknown as RunState);

  // (a) 预警线下 → 无接触（水里还算静）
  assert(threatContact(tr({ alert: THREAT_CONTACT_ALERT - 1 })) === null, '12a: 警觉未到预警线 → 无威胁接触');
  // (b) 越过预警线 → 有接触；逼近度随 alert 涨（blip 离你越近）
  const warn = threatContact(tr({ alert: THREAT_CONTACT_ALERT }))!;
  const hi = threatContact(tr({ alert: ALERT_MAX }))!;
  assert(warn && hi, '12b: 越过预警线 → 有威胁接触');
  assert(hi.proximity > warn.proximity, '12b: 警觉越高逼近度越高');
  // (c) 越过接近线（ALERT_THRESHOLD）→ imminent + range=near；预警线刚到 → 未 imminent
  const near = threatContact(tr({ alert: ALERT_THRESHOLD }))!;
  assert(near.imminent && near.range === 'near', '12c: 越过接近线 → imminent + 近');
  assert(!warn.imminent, '12c: 预警线刚到 → 未 imminent（还有熄灯反应窗口）');
  // (d) 低 san + 深 band → 距离偶尔读不出（garbled·按 turn 变）；高 san 读得出
  const hiSan = threatContact(tr({ alert: ALERT_MAX, sanity: 100 }))!;
  assert(!hiSan.garbled, '12d: 高 san → 威胁距离读得出（不 garbled）');
  let everGarbled = false;
  for (let t = 0; t < 12; t++) if (threatContact(tr({ alert: ALERT_MAX, sanity: 15, dec: 0.32, turn: t }))!.garbled) everGarbled = true;
  assert(everGarbled, '12d: 低 san → 威胁距离偶尔读不出（garbled）');
  // (e) 确定性（不耗 RNG·SSR 安全）：同输入同方位/逼近度
  const a = threatContact(tr({ alert: 70, turn: 3 }))!;
  const b = threatContact(tr({ alert: 70, turn: 3 }))!;
  assert(a.angle === b.angle && a.proximity === b.proximity, '12e: 威胁接触确定性（同输入同结果）');
  L('  预警线门 / 逼近度随 alert / imminent 近 / 低 san 读不出 / 确定性 ✓');
}

// ============================================================
// 14. 声呐开/关窗口规则（声呐渲染重做 §4·本 session 重做）：缺省开·预承诺下回合·暴露按状态·本回合反悔·旧图保留
// ============================================================
L('\n========== 14. 声呐开/关窗口（§4 重做）==========');
{
  // (a) 缺省开（sonarOn 缺字段 → 视为开）
  const fresh = enterNodeSelection(mk({ depth: 50 }));
  assert(sonarStandingOn(fresh.run!) === true, '14a: 缺省开（sonarOn 缺字段 → 视为开）');
  assert(sonarStandingNext(fresh.run!) === true, '14a: 下回合缺省跟随＝开');

  // (b) 预承诺（§4 控制点）：setSonarNext 只改下回合·本回合不变
  const pre = setSonarNext(fresh, false);
  assert(sonarStandingOn(pre.run!) === true, '14b: 切「关」只改下回合 → 本回合仍开（本回合是上回合定的）');
  assert(sonarStandingNext(pre.run!) === false, '14b: 下回合预承诺=关');

  // (c) 落定：移动把 sonarNext→sonarOn（关）·到站不自动扫（sonar=off·看保留旧图）
  const movedOff = moveToNode(pre, 'n1');
  assert(movedOff.run!.sensors.sonarOn === false, '14c: 移动落定本回合=关（sonarNext→sonarOn）');
  assert(movedOff.run!.sensors.sonar === 'off', '14c: 关着到站不自动扫（sonar off·保留旧图）');

  // (d) 暴露按状态付（§4）：同深同灯下，发射态(sonar=ping)每回合暴露 > 关态(off)——开＝暴露照付
  const onAfter = moveToNode(enterNodeSelection(mk({ depth: 50 })), 'n1');
  assert(onAfter.run!.sensors.sonar === 'ping', '14d: 持续开移动后处于发射态(sonar=ping·scan-on-open)');
  const offLike = { ...onAfter, run: { ...onAfter.run!, sensors: { ...onAfter.run!.sensors, sonar: 'off' as const, sonarOn: false } } };
  assert(alertDelta(onAfter.run!, 1) > alertDelta(offLike.run!, 1), '14d: 开着每回合暴露 > 关着（暴露按状态付·§4）');

  // (e) 本回合反悔：即使是关态，pingSonar 仍可主动扫一记（扫了就算本回合开·付暴露）
  const offState = { ...fresh, run: { ...fresh.run!, sensors: { ...fresh.run!.sensors, sonar: 'off' as const, sonarOn: false, sonarNext: false } } };
  const revoked = pingSonar(offState);
  assert(revoked.run!.sensors.sonar === 'ping', '14e: 关着仍可主动扫一记反悔（sonar→ping·§4）');
  assert(revoked.run!.alert > offState.run!.alert, '14e: 反悔扫付了暴露尖峰（alert 抬升＝扫了就算本回合开）');

  // (f) 存档 round-trip：sonarOn/sonarNext 普通布尔·保真·不 bump SAVE_VERSION
  const rt = deserializeGameState(serializeGameState(movedOff));
  assert(rt!.version === 12, '14f: SAVE_VERSION 12（月相 Phase 0b bump·sonarOn 本身不影响）');
  assert(rt!.run!.sensors.sonarOn === false && rt!.run!.sensors.sonarNext === false, '14f: sonarOn/sonarNext round-trip 保真');
  L('  缺省开 / 切换只改下回合 / 移动落定 / 暴露按状态(on>off) / 本回合反悔扫一记 / 存档 round-trip ✓');
}

// ============================================================
// 15. 落地即扫 + 声呐开关偏好跨 run 持久（作者拍板·所有下潜·startDive 当到站处理）
// ============================================================
L('\n========== 15. 落地即扫 + 偏好持久 ==========');
{
  const base = createInitialGameState();
  // 偏好开（默认）+ 已解锁 → startDive 落地立刻扫一记起始节点（看见掉进的那片洞）。
  const onState: GameState = { ...base, run: createNewRun({ zoneId: 'zone.blue_caves', bonuses: { sonarUnlocked: true } }) };
  const dived = startDive(onState, 'zone.blue_caves');
  const start = dived.run!.currentNodeId;
  assert(start !== null && dived.run!.scanMemory[start] === dived.run!.turn, '15: 落地即扫——起始节点＝本回合扫描中心（声呐开+解锁）');
  assert(dived.run!.sensors.sonar === 'ping', '15: 落地处于发射态 sonar=ping（exposed·与到站自动扫一致）');
  assert(dived.run!.sensors.sonarOn === true && dived.run!.sensors.sonarNext === true, '15: 偏好开 → 种 sonarOn/sonarNext=true');

  // 偏好关（profile.sonarOn=false）→ 落地不扫、不发射（全黑·隐蔽）。
  const offState: GameState = { ...base, profile: { ...base.profile, sonarOn: false }, run: createNewRun({ zoneId: 'zone.blue_caves', bonuses: { sonarUnlocked: true } }) };
  const divedOff = startDive(offState, 'zone.blue_caves');
  assert(Object.keys(divedOff.run!.scanMemory).length === 0, '15: 偏好关 → 落地不扫（scanMemory 空·全黑）');
  assert(divedOff.run!.sensors.sonarOn === false && divedOff.run!.sensors.sonar === 'off', '15: 偏好关 → 种 sonarOn=false·不发射');

  // setSonarNext 把偏好写进 profile（跨 run 持久的单一来源·下次落地按它种）。
  const stOn: GameState = { ...base, run: createNewRun({ zoneId: 'zone.blue_caves', bonuses: { sonarUnlocked: true } }) };
  const turnedOff = setSonarNext(stOn, false);
  assert(turnedOff.profile.sonarOn === false, '15: setSonarNext(false) 写 profile.sonarOn=false（跨 run 持久）');
  assert(setSonarNext(turnedOff, true).profile.sonarOn === true, '15: setSonarNext(true) 写 profile.sonarOn=true');
  L('  落地即扫(开) / 落地全黑(关) / 偏好写 profile 跨 run ✓');
}

pt.done();
