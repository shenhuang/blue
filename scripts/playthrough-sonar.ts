// 声呐探索扫描回归（声呐与房间 SPEC §5/§7「S0」）。纯引擎断言（不碰 UI/combat）：
//   1. revealSonarScan：有限程无向 BFS——range 决定揭示几跳、永不照全洞、含 origin、缺 origin → []
//   2. sonarScanRange：S0 基线常量（升级轨留后续）
//   3. pingSonar 写 scanMemory（揭示 sonarScanRange 跳内的**全部节点**·规划纵深·SPEC §2.2）+ 扣电 + sonar='ping'
//   4. 软门控：声呐未解锁 → ping 无效（不写记忆、不扣电）
//   5. 1 scan / 停留：已 ping（未移动）→ 再 ping no-op（不重复扣电/写记忆）
//   6. ping 当场抬警觉：深水 spike / 浅水免压（深度因子 0）/ 深 band 倍率 / clamp 上限
//   7. 会过时的记忆：移动→脉冲归 off（不自动扫）·turn 前进；到新一站再 ping 刷新量程内 stamp，量程外留旧 stamp（staleness）
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
import { pingSonar, moveToNode, enterNodeSelection, exploreFeature, startDive } from '../src/engine/dive';
import {
  POWER_MAX,
  SONAR_PING_COST,
  ALERT_MAX,
  ALERT_THRESHOLD,
  THREAT_CONTACT_ALERT,
  sonarPingAlertDelta,
  alertDelta,
  alertDepthFactor,
  threatContact,
  deriveSensorTuning,
} from '../src/engine/clarity';
import {
  revealSonarScan,
  sonarScanRange,
  SONAR_SCAN_RANGE,
  SONAR_SCAN_RANGE_MAX,
} from '../src/engine/sonar';
import { makeHarness, type PtAssert } from './lib/pt';

const pt = makeHarness('声呐探索扫描回归（S0 + S1 多事件房间 + S3 威胁定位 + 一记 ping 单动作·感知重做 §2.2·S2 不可信扫描已删）');
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
    zoneId: 'zone.vertical_test',
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
  const r0 = createNewRun({ zoneId: 'zone.vertical_test', bonuses: { sonarUnlocked: opts?.sonarUnlocked ?? true } });
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
    zoneId: 'zone.vertical_test',
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
  const up1 = createNewRun({ zoneId: 'zone.vertical_test', bonuses: { sonarUnlocked: true, sonarScanRangeBonus: 1 } });
  assert(sonarScanRange(up1) === SONAR_SCAN_RANGE + 1, '2: +1 升级 → 扫描范围 +1');
  // 升满有上限——守北极星「扫不穿整洞、照不到最深」
  const upMax = createNewRun({ zoneId: 'zone.vertical_test', bonuses: { sonarUnlocked: true, sonarScanRangeBonus: 99 } });
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
L('\n========== 3. ping 写 scanMemory（揭示量程内全部节点·规划纵深）+ 扣电 ==========');
{
  const s = pingSonar(mk());
  const run = s.run!;
  assert(run.power === POWER_MAX - SONAR_PING_COST, `3: ping 扣 ${SONAR_PING_COST} 电`);
  assert(run.sensors.sonar === 'ping', '3: ping 后 sonar=ping');
  // 感知重做 SPEC §2.2：一记 ping 揭示 sonarScanRange 跳内的全部节点（基线 range 1 从 n0 → {n0,n1,n2}）。
  assert(
    sameSet(sortedKeys(run.scanMemory ?? {}), ['n0', 'n1', 'n2']),
    '3: scanMemory = 一记 ping 揭示量程内全部节点（range1 从 n0 = n0+直接邻居·规划纵深·SPEC §2.2）',
  );
  assert(run.scanMemory!['n0'] === run.turn && run.scanMemory!['n1'] === run.turn, '3: 揭示的节点全 stamp 当前 turn');
  L('  ping 揭示量程内节点（规划纵深）+ 扣电 + stamp turn ✓');
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
// 7. 会过时的记忆（感知重做 §2.2）：ping 揭示量程内节点·移动→脉冲归 off（不自动扫）·turn 前进；
//    到新一站再 ping → 刷新新量程内的 stamp，旧量程外的节点留旧 stamp（staleness）。
// ============================================================
L('\n========== 7. 会过时的记忆（§2.2·staleness）==========');
{
  const first = pingSonar(mk({ depth: 50 })); // 在 n0·turn 0·range1 揭示 {n0,n1,n2} → 全 stamp 0
  const t0 = first.run!.turn;
  assert(first.run!.scanMemory!['n2'] === t0, '7: 首 ping 揭示 n2（range1 从 n0·stamp t0）');
  const moved = moveToNode(first, 'n1'); // 去 n1：脉冲消散归 off（不自动扫·感知重做 §2.2）·turn 前进
  assert(moved.run!.sensors.sonar === 'off', '7: 移动后脉冲归 off（不自动扫·感知重做 §2.2）');
  assert(moved.run!.turn > t0, '7: 移动后 turn 前进');
  const t1 = moved.run!.turn;
  const rescan = pingSonar(moved); // 在 n1 再 ping：range1 从 n1 = {n1,n0,n3} 刷新成 t1；n2 不在量程内 → 留旧 t0
  assert(rescan.run!.scanMemory!['n1'] === t1 && rescan.run!.scanMemory!['n0'] === t1, '7: 到新一站再 ping → 量程内 n1/n0 刷新成新 turn');
  assert(rescan.run!.scanMemory!['n2'] === t0, '7: 量程外的旧节点 n2 留旧 turn（记忆会过时·staleness）');
  assert(t1 > t0, '7: 新 stamp 比旧 stamp 新');
  L('  ping 揭示量程 + 移动归 off(不自动扫) + 再 ping 刷新量程内 + 旧节点留存(staleness) ✓');
}

// ============================================================
// 9. 不动存档：scanMemory round-trip，SAVE_VERSION = 6（#131 §10）
// ============================================================
L('\n========== 9. scanMemory round-trip ==========');
{
  const s = pingSonar(mk({ depth: 50 }));
  const back = deserializeGameState(serializeGameState(s));
  assert(back !== null, '9: 反序列化成功');
  assert(back!.version === 17, '9: SAVE_VERSION 17（白板收口 bump·scanMemory 本身不影响）');
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
// 11. 不可信扫描（声呐与房间 S2）：spoof/evade 表象 + 深 band 失真阈值 + mapgen 欺骗 pass
//   → **整节随感知重做删除**（声呐诚实、欺骗移交地点缝·SPEC §2.2/§2.3/§3）。
// ============================================================

// ============================================================
// 12. 威胁定位（声呐与房间 S3 廉价版）：run.alert → 近似接触 + 粗距档（诚实·感知重做后无失真）
// ============================================================
// ============================================================
L('\n========== 12. 威胁定位（S3 廉价版）==========');
{
  const tr = (o: { alert?: number; turn?: number }): RunState =>
    ({ alert: o.alert ?? 0, stats: {}, turn: o.turn ?? 0, sensorTuning: deriveSensorTuning({}) } as unknown as RunState);

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
  // (d) 感知重做：威胁诚实（garbled 恒 false·失真移交地点缝·SPEC §2.2/§2.3）。
  assert(!threatContact(tr({ alert: ALERT_MAX }))!.garbled, '12d: 威胁诚实（garbled 恒 false）');
  // (e) 确定性（不耗 RNG·SSR 安全）：同输入同方位/逼近度
  const a = threatContact(tr({ alert: 70, turn: 3 }))!;
  const b = threatContact(tr({ alert: 70, turn: 3 }))!;
  assert(a.angle === b.angle && a.proximity === b.proximity, '12e: 威胁接触确定性（同输入同结果）');
  L('  预警线门 / 逼近度随 alert / imminent 近 / 威胁诚实(不 garbled) / 确定性 ✓');
}

// ============================================================
// 14. 声呐一记 ping 单动作（感知重做 SPEC §2.2「ping 才扫、不 ping 不扫」·本 session 重做）：
//     默认不扫（sonar=off）·主动 ping 付电+暴露·移动脉冲归 off·不跨回合持续
// ============================================================
L('\n========== 14. 一记 ping 单动作（§2.2）==========');
{
  // (a) 默认不扫（sonar 缺省 off·感知重做后无 sonarOn/sonarNext 双态）
  const fresh = enterNodeSelection(mk({ depth: 50 }));
  assert(fresh.run!.sensors.sonar === 'off', '14a: 默认不扫（sonar=off·ping 才扫）');

  // (b) 主动 ping → sonar=ping·付暴露尖峰
  const pinged = pingSonar(fresh);
  assert(pinged.run!.sensors.sonar === 'ping', '14b: ping 后 sonar=ping');
  assert(pinged.run!.alert > fresh.run!.alert, '14b: ping 付了暴露尖峰（alert 抬升·主动感知=暴露）');

  // (c) 移动：脉冲消散归 off（不自动扫·不跨回合持续）
  const movedOff = moveToNode(pinged, 'n1');
  assert(movedOff.run!.sensors.sonar === 'off', '14c: 移动后脉冲归 off（不自动扫·不跨回合持续·§2.2）');

  // (d) 暴露按状态付：本回合发过 ping（sonar=ping）每回合暴露 > 没 ping（off）——ping 那一回合暴露照付
  const offLike = { ...pinged, run: { ...pinged.run!, sensors: { ...pinged.run!.sensors, sonar: 'off' as const } } };
  assert(alertDelta(pinged.run!, 1) > alertDelta(offLike.run!, 1), '14d: 发过 ping 那回合每回合暴露 > 没 ping（暴露按状态付）');

  // (e) 存档 round-trip：sonar 普通枚举·保真·不 bump SAVE_VERSION
  const rt = deserializeGameState(serializeGameState(movedOff));
  assert(rt!.version === 17, '14e: SAVE_VERSION 17（白板收口 bump·感知重做删 sonarOn 不影响）');
  assert(rt!.run!.sensors.sonar === 'off', '14e: sensors.sonar round-trip 保真');
  L('  默认不扫 / ping 付暴露 / 移动归 off(不自动扫) / 暴露按状态 / 存档 round-trip ✓');
}

// ============================================================
// 15. 落地不自动扫（感知重做 SPEC §2.2「ping 才扫、不 ping 不扫」）：落地全黑（scanMemory 空·sonar off），
//     想看＝落地后主动 ping 一记。旧「按 profile 偏好落地自动扫 + setSonarNext 跨 run 持久」已删。
// ============================================================
L('\n========== 15. 落地不自动扫（§2.2·ping 才扫）==========');
{
  const base = createInitialGameState();
  // 已解锁声呐 → startDive 落地仍不自动扫（scanMemory 空·sonar off·全黑·隐蔽）。
  const onState: GameState = { ...base, run: createNewRun({ zoneId: 'zone.vertical_test', bonuses: { sonarUnlocked: true } }) };
  const dived = startDive(onState, 'zone.vertical_test');
  assert(Object.keys(dived.run!.scanMemory).length === 0, '15: 落地不自动扫（scanMemory 空·全黑·感知重做 §2.2）');
  assert(dived.run!.sensors.sonar === 'off', '15: 落地 sonar=off（不发射·不暴露·想看再主动 ping）');

  // 落地后主动 ping → 揭示起始节点周围（一记诚实 ping·付电 + 暴露）。
  const start = dived.run!.currentNodeId!;
  const pinged = pingSonar(dived);
  assert(pinged.run!.scanMemory[start] === pinged.run!.turn, '15: 落地后主动 ping → 揭示起始节点（本回合 stamp）');
  assert(pinged.run!.sensors.sonar === 'ping', '15: 主动 ping → sonar=ping（付电 + 暴露）');
  assert(pinged.run!.power < dived.run!.power, '15: 主动 ping 付电');

  // 未解锁声呐 → 落地同样全黑，且 ping no-op（不扫·不扣电）。
  const noSonar: GameState = { ...base, run: createNewRun({ zoneId: 'zone.vertical_test', bonuses: { sonarUnlocked: false } }) };
  const divedNo = startDive(noSonar, 'zone.vertical_test');
  assert(Object.keys(divedNo.run!.scanMemory).length === 0 && divedNo.run!.sensors.sonar === 'off', '15: 未解锁声呐 → 落地全黑');
  L('  落地不自动扫(全黑) / 落地后主动 ping 揭示付电 / 未解锁全黑 ✓');
}

pt.done();
