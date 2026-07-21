// 声呐探索扫描回归（声呐无升级化 2026-07-19「一记 ping = 全图揭示」+ 声呐与房间 S1 存留段）。纯引擎断言（不碰 UI/combat）：
//   1. buildUndirectedAdjacency：无向邻接（照得到来时的上游）+ 幽灵边过滤
//   2. 全图揭示 + 声呐门活条件：ping 前 sonar 门锁 / ping 后开（sensors.sonar==='ping'·同灯 lampOn 语义）/ 移动后回锁
//   3. pingSonar 写 lastScanTurn（全图迷雾班次·无 BFS 无射程）+ 扣常量电 + sonar='ping'
//   4. 软门控：声呐未解锁 → ping 无效（不写班次、不扣电）
//   5. 1 scan / 停留：已 ping（未移动）→ 再 ping no-op（不重复扣电/写班次）
//   6. ping 当场抬警觉：深水 spike / 浅水免压（深度因子 0）/ 深 band 倍率 / clamp 上限
//   7. 全图三态生命周期：黑（没 ping 过）→ 亮（这一站 ping 过）→ 灰（移动后 sonar 归 off·lastScanTurn 常驻不回黑）→ 再 ping 刷新班次
//   8. 猎手全图必闻：无量程——几跳外的猎手每记 ping 也快照（seenNodeId/seenTurn）·快照随后过期（stale 增长）
//   9. 存档：lastScanTurn round-trip·SAVE_VERSION = 20（撒点域横纵比地板 bump）
//   （旧 §1 revealSonarScan BFS / §2 sonarScanRange 升级轴 / §2b sonarRevealRadius 迷雾圆——整套随「无射程无升级」删除。）
//
// 跑法： npx tsx scripts/playthrough-sonar.ts

import type { GameState, RunState, DiveMap, Stalker } from '../src/types';
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
  sonarPingAlertDelta,
  alertDelta,
  alertDepthFactor,
} from '../src/engine/clarity';
import { buildUndirectedAdjacency } from '../src/engine/sonar';
import { gateUnlocked } from '../src/engine/dive-select';
import { makeHarness, type PtAssert } from './lib/pt';

const pt = makeHarness('声呐探索扫描回归（无升级全图揭示 + S1 多事件房间 + 一记 ping 单动作·2026-07-19）');
const { L } = pt;
const assert: PtAssert = pt.assert;
const sameSet = (a: string[], b: string[]) =>
  a.length === b.length && [...a].sort().join('|') === [...b].sort().join('|');

/**
 * 一张分叉的小洞图（无向连通，两条支链各两节点深）：
 *   n0 ─ n1 ─ n3 ─ n4        n6 离 n0 三跳——旧射程 1 听不到那么远；
 *    └─ n2 ─ n5 ─ n6         无升级化后一记 ping 全图必闻（§8 用它验证）。
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
// 1. buildUndirectedAdjacency：无向邻接（猎手等图算法的底座·BFS 已随射程删除）
// ============================================================
L('========== 1. buildUndirectedAdjacency 无向邻接 ==========');
{
  const adj = buildUndirectedAdjacency(makeMap());
  assert(sameSet(adj['n0'] ?? [], ['n1', 'n2']), '1: n0 的无向邻居 = n1+n2');
  assert((adj['n1'] ?? []).includes('n0'), '1: 无向——照得到来时的上游（n1 → n0）');
  const ghost: DiveMap = { ...makeMap(), nodes: { ...makeMap().nodes } };
  ghost.nodes.n0 = { ...ghost.nodes.n0, connectsTo: ['n1', 'nope'] };
  assert(!(buildUndirectedAdjacency(ghost)['n0'] ?? []).includes('nope'), '1: 幽灵边（目标不在图）被过滤');
  L('  无向邻接 + 上游可达 + 幽灵边过滤 ✓');
}

// ============================================================
// 2. 声呐门＝活条件（声呐无升级化·作者拍板「和灯一样」）：ping 前锁 / ping 后开（sensors.sonar==='ping'）/
//    移动后脉冲散了 → 回锁（同灯关掉即回锁·旧「scanMemory 一记 ping 全潜粘住」已删）
// ============================================================
L('\n========== 2. 声呐门活条件（同灯 lampOn 语义）==========');
{
  const gated = { ...makeMap().nodes.n1, gate: { sense: 'sonar' as const, mode: 'locked' as const } };
  const s0 = mk();
  assert(!gateUnlocked(gated, s0.run!, false), '2: ping 前——sonar 门锁住');
  const pinged = pingSonar(s0);
  assert(gateUnlocked(gated, pinged.run!, false), '2: 这一站 ping 过——sonar 门解锁（活条件）');
  const moved = moveToNode(pinged, 'n1');
  assert(!gateUnlocked(gated, moved.run!, false), '2: 移动后脉冲散了——sonar 门回锁（同灯关掉回锁·非全潜粘住）');
  L('  ping 前锁 / ping 后开 / 移动回锁（与灯同构的活条件）✓');
}

// ============================================================
// 3. pingSonar 写 lastScanTurn（全图迷雾班次）+ 扣常量电 + sonar=ping
// ============================================================
L('\n========== 3. ping 写 lastScanTurn（全图揭示·无射程）+ 扣电 ==========');
{
  const s = pingSonar(mk());
  const run = s.run!;
  assert(run.power === POWER_MAX - SONAR_PING_COST, `3: ping 扣 ${SONAR_PING_COST} 电（常量·无省电升级轴）`);
  assert(run.sensors.sonar === 'ping', '3: ping 后 sonar=ping');
  // 声呐无升级化：一记 ping 揭示整张图——引擎只记班次（lastScanTurn）·无逐节点 stamp 表。
  assert(run.lastScanTurn === run.turn, '3: lastScanTurn = 当前 turn（全图迷雾班次·黑→非黑）');
  L('  ping 记班次（整图揭示）+ 扣常量电 + sonar=ping ✓');
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
  assert(s.run!.lastScanTurn === undefined, '4: 未解锁 ping 不写班次（图保持全黑）');
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
  assert(twice.run!.lastScanTurn === once.run!.lastScanTurn, '5: 第二记 ping 不改班次（移动后才能再扫）');
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
// 7. 全图三态生命周期（用户需求 2026-07-19）：黑（没 ping 过）→ 亮（这一站 ping 过）→
//    灰（移动后·lastScanTurn 常驻不回黑）→ 到新一站再 ping → 新班次（图刷新回亮）
// ============================================================
L('\n========== 7. 全图三态生命周期（黑→亮→灰→再亮）==========');
{
  const s0 = mk({ depth: 50 });
  assert(s0.run!.lastScanTurn === undefined, '7: 起手没 ping 过 → 黑（lastScanTurn 空）');
  const first = pingSonar(s0); // 在 n0·turn t0
  const t0 = first.run!.turn;
  assert(first.run!.lastScanTurn === t0 && first.run!.sensors.sonar === 'ping', '7: ping 后 → 亮（班次=t0·sonar=ping）');
  const moved = moveToNode(first, 'n1'); // 去 n1：脉冲消散归 off·turn 前进
  assert(moved.run!.sensors.sonar === 'off', '7: 移动后脉冲归 off → 全图变灰（不自动扫）');
  assert(moved.run!.lastScanTurn === t0, '7: 变灰不回黑——班次留旧值（图还在·只是旧了）');
  assert(moved.run!.turn > t0, '7: 移动后 turn 前进');
  const rescan = pingSonar(moved); // 在 n1 再 ping：新班次
  const t1 = rescan.run!.turn;
  assert(rescan.run!.lastScanTurn === t1 && t1 > t0, '7: 到新一站再 ping → 新班次（图刷新回亮）');
  L('  黑（空）→ 亮（ping）→ 灰（移动·不回黑）→ 再 ping 新班次 ✓');
}

// ============================================================
// 8. 猎手全图必闻（声呐无升级化·作者拍板）：无量程——几跳外的猎手每记 ping 也快照；
//    快照随后过期（红点是 ping 那刻的旧影·stalkerSonarBlip.stale 增长）
// ============================================================
L('\n========== 8. 猎手全图必闻（无量程·快照会过期）==========');
{
  // n6 离 n0 三跳（旧射程 1 听不到）；sensesBy:'light' + 浅于躲扫深度 ⇒ 确定性不 evade。
  const far: Stalker = {
    nodeId: 'n6',
    sensesBy: 'light',
    onLostSignal: 'wait',
    waitTurns: 1,
    state: 'hunting',
    encounterId: 'enc.test',
    lastSignalNodeId: 'n6',
    turnsSinceSignal: 0,
    waitedTurns: 0,
  };
  const s0 = mk({ depth: 50 });
  const withStalker: GameState = { ...s0, run: { ...s0.run!, huntEnabled: true, stalker: far } };
  assert(withStalker.run!.stalker!.seenNodeId === undefined, '8: ping 前——从没定位过（seenNodeId 空）');
  const pinged = pingSonar(withStalker);
  assert(pinged.run!.stalker!.seenNodeId === 'n6', '8: 一记 ping 三跳外也必闻（无量程·全图快照）');
  assert(pinged.run!.stalker!.seenTurn === pinged.run!.turn, '8: 快照 stamp 当前 turn（红点=ping 那刻的位置）');
  L('  三跳外必闻 + 快照 stamp（会过期·§8.7 语义不变）✓');
}

// ============================================================
// 9. 存档：lastScanTurn round-trip·SAVE_VERSION = 20（撒点域横纵比地板 bump·quirk #99 不迁移）
// ============================================================
L('\n========== 9. lastScanTurn round-trip ==========');
{
  const s = pingSonar(mk({ depth: 50 }));
  const back = deserializeGameState(serializeGameState(s));
  assert(back !== null, '9: 反序列化成功');
  assert(back!.version === 20, '9: SAVE_VERSION 20（撒点域横纵比地板 bump·旧档作废不迁移）');
  assert(back!.run!.lastScanTurn === s.run!.lastScanTurn, '9: lastScanTurn 原样 round-trip（普通数字·真条件字段）');
  const fresh = deserializeGameState(serializeGameState(mk())); // 没 ping 过：absent 保持 absent
  assert(fresh!.run!.lastScanTurn === undefined, '9: 没 ping 过 round-trip 后仍是黑（absent 不被补种）');
  L('  lastScanTurn round-trip + absent 保真 + SAVE_VERSION 20 ✓');
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
// 12. 威胁定位（S3 廉价版琥珀接触）：**整节随 #316 删除**（作者拍板删掉琥珀——alert 驱动·方位按 turn
//     漂移＝不扫描也每回合动，与「信息只在扫描时更新」相悖；threatContact/ThreatContact/THREAT_CONTACT_ALERT
//     已从 engine/clarity.ts 移除。敌显只剩：追猎红点〔扫描快照·§8〕+ 女王常显〔smoke-chart-ui §W〕）。
// ============================================================

// ============================================================
// 14. 声呐一记 ping 单动作（感知重做 SPEC §2.2「ping 才扫、不 ping 不扫」）：
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

  // (e) 存档 round-trip：sonar 普通枚举·保真
  const rt = deserializeGameState(serializeGameState(movedOff));
  assert(rt!.version === 20, '14e: SAVE_VERSION 20（撒点域横纵比地板 bump）');
  assert(rt!.run!.sensors.sonar === 'off', '14e: sensors.sonar round-trip 保真');
  L('  默认不扫 / ping 付暴露 / 移动归 off(不自动扫) / 暴露按状态 / 存档 round-trip ✓');
}

// ============================================================
// 15. 落地不自动扫（感知重做 SPEC §2.2「ping 才扫、不 ping 不扫」）：落地全黑（lastScanTurn 空·sonar off），
//     想看＝落地后主动 ping 一记。旧「按 profile 偏好落地自动扫 + setSonarNext 跨 run 持久」已删。
// ============================================================
L('\n========== 15. 落地不自动扫（§2.2·ping 才扫）==========');
{
  const base = createInitialGameState();
  // 已解锁声呐 → startDive 落地仍不自动扫（lastScanTurn 空·sonar off·全黑·隐蔽）。
  const onState: GameState = { ...base, run: createNewRun({ zoneId: 'zone.vertical_test', bonuses: { sonarUnlocked: true } }) };
  const dived = startDive(onState, 'zone.vertical_test');
  assert(dived.run!.lastScanTurn === undefined, '15: 落地不自动扫（lastScanTurn 空·全黑·感知重做 §2.2）');
  assert(dived.run!.sensors.sonar === 'off', '15: 落地 sonar=off（不发射·不暴露·想看再主动 ping）');

  // 落地后主动 ping → 整图揭示（一记诚实 ping·付电 + 暴露）。
  const pinged = pingSonar(dived);
  assert(pinged.run!.lastScanTurn === pinged.run!.turn, '15: 落地后主动 ping → 整图揭示（班次=本回合）');
  assert(pinged.run!.sensors.sonar === 'ping', '15: 主动 ping → sonar=ping（付电 + 暴露）');
  assert(pinged.run!.power < dived.run!.power, '15: 主动 ping 付电');

  // 未解锁声呐 → 落地同样全黑，且 ping no-op（不扫·不扣电）。
  const noSonar: GameState = { ...base, run: createNewRun({ zoneId: 'zone.vertical_test', bonuses: { sonarUnlocked: false } }) };
  const divedNo = startDive(noSonar, 'zone.vertical_test');
  assert(divedNo.run!.lastScanTurn === undefined && divedNo.run!.sensors.sonar === 'off', '15: 未解锁声呐 → 落地全黑');
  L('  落地不自动扫(全黑) / 落地后主动 ping 整图揭示付电 / 未解锁全黑 ✓');
}

pt.done();
