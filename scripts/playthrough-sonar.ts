// 声呐探索扫描回归（声呐与房间 SPEC §5/§7「S0」）。纯引擎断言（不碰 UI/combat）：
//   1. revealSonarScan：有限程无向 BFS——range 决定揭示几跳、永不照全洞、含 origin、缺 origin → []
//   2. sonarScanRange：S0 基线常量（升级轨留后续）
//   3. pingSonar 写 scanMemory（揭示集合 stamp 当前 turn）+ 扣电 + sonar='ping'
//   4. 软门控：声呐未解锁 → ping 无效（不写记忆、不扣电）
//   5. 1 scan / 停留：已 ping（未移动）→ 再 ping no-op（不重复扣电/写记忆）
//   6. ping 当场抬警觉：深水 spike / 浅水免压（深度因子 0）/ 深 band 倍率 / clamp 上限
//   7. 会过时的记忆：移动后 sonar 归 off + turn 前进；再 ping 刷新被扫到的 stamp，没扫到的留旧 stamp（staleness）
//   8. scanFreshness：age 0→满、中段线性、≥fade→0（余像渐隐、重复 ping 不超过 1）
//   9. 不动存档：scanMemory 走 JSON round-trip，SAVE_VERSION 仍 4
//
// 跑法： npx tsx scripts/playthrough-sonar.ts

import type { GameState, RunState, DiveMap } from '../src/types';
import {
  createInitialGameState,
  createNewRun,
  serializeGameState,
  deserializeGameState,
} from '../src/engine/state';
import { pingSonar, moveToNode, enterNodeSelection, exploreFeature } from '../src/engine/dive';
import {
  POWER_MAX,
  SONAR_PING_COST,
  SONAR_PING_ALERT,
  ALERT_MAX,
  sonarPingAlertDelta,
  alertDepthFactor,
  sonarReturn,
  nodeSonarView,
  sonarPhantoms,
  effectiveFalseEchoSanity,
  SONAR_FALSE_ECHO_SANITY,
  SONAR_FALSE_ECHO_SANITY_BAND_MAX,
} from '../src/engine/clarity';
import { generateDiveMap } from '../src/engine/mapgen';
import { getZone } from '../src/engine/zones';
import { getBand } from '../src/engine/bands';
import type { DiveNode } from '../src/types';
import {
  revealSonarScan,
  sonarScanRange,
  scanFreshness,
  SONAR_SCAN_RANGE,
  SCAN_FADE_TURNS,
} from '../src/engine/sonar';

const log: string[] = [];
const L = (s: string) => log.push(s);
function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    console.error(log.join('\n'));
    throw new Error('断言失败：' + msg);
  }
}
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
    bandAlertFactor: opts?.bandAlertFactor,
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
// 2. sonarScanRange：S0 基线常量
// ============================================================
L('\n========== 2. sonarScanRange 基线 ==========');
{
  assert(sonarScanRange(mk().run!) === SONAR_SCAN_RANGE, '2: 范围 = 基线常量（升级轨留后续）');
  L(`  基线范围 ${SONAR_SCAN_RANGE} 跳 ✓`);
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
    sameSet(sortedKeys(run.scanMemory ?? {}), ['n0', 'n1', 'n2', 'n3', 'n5']),
    '3: scanMemory = 该 ping 揭示集合（range2）',
  );
  assert(Object.values(run.scanMemory!).every((t) => t === run.turn), '3: 揭示节点 stamp 当前 turn');
  L('  ping 揭示 range2 + 扣电 + stamp turn ✓');
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
// 7. 会过时的记忆：移动后归 off + turn 前进；再 ping 刷新，没扫到的留旧 stamp
// ============================================================
L('\n========== 7. 会过时的记忆（staleness）==========');
{
  const first = pingSonar(mk({ depth: 50 })); // 在 n0，turn 0，stamp {n0,n1,n2,n3,n5}=0
  const t0 = first.run!.turn;
  const moved = moveToNode(first, 'n1'); // 去 n1，turn 前进、sonar 归 off
  assert(moved.run!.sensors.sonar === 'off', '7: 移动后 sonar 归 off（脉冲瞬时）');
  assert(moved.run!.turn > t0, '7: 移动后 turn 前进');
  assert(moved.run!.scanMemory!['n5'] === t0, '7: 旧记忆（n5）随你而留——还带着旧 turn');
  const reping = pingSonar(moved); // 在 n1 再 ping：range2 够不到 n5
  const t1 = reping.run!.turn;
  assert(reping.run!.scanMemory!['n0'] === t1, '7: 重新扫到的 n0 刷新成新 turn');
  assert(reping.run!.scanMemory!['n5'] === t0, '7: 没被这记 ping 扫到的 n5 仍是旧 turn（过时的图）');
  assert(t1 > t0, '7: 新 stamp 比旧 stamp 新');
  L('  移动后归 off + 旧记忆留存 + 再 ping 只刷新扫到的（staleness）✓');
}

// ============================================================
// 8. scanFreshness：余像渐隐
// ============================================================
L('\n========== 8. scanFreshness 渐隐 ==========');
{
  assert(scanFreshness(0) === 1, '8: age 0 → 满亮（刚扫到）');
  assert(scanFreshness(-3) === 1, '8: 重复 ping（age≤0）不超过 1（固定亮度）');
  assert(scanFreshness(SCAN_FADE_TURNS) === 0, '8: age≥fade → 淡尽');
  assert(scanFreshness(SCAN_FADE_TURNS + 5) === 0, '8: 更旧仍 0（不为负）');
  const mid = scanFreshness(SCAN_FADE_TURNS / 2);
  assert(mid > 0 && mid < 1, '8: 中段线性渐隐');
  L('  满亮 / 不超 1 / 中段线性 / 淡尽 ✓');
}

// ============================================================
// 9. 不动存档：scanMemory round-trip，SAVE_VERSION 仍 4
// ============================================================
L('\n========== 9. scanMemory round-trip ==========');
{
  const s = pingSonar(mk({ depth: 50 }));
  const back = deserializeGameState(serializeGameState(s));
  assert(back !== null, '9: 反序列化成功');
  assert(back!.version === 4, '9: SAVE_VERSION 仍 4（未 bump）');
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
  // 纯 run（只喂 clarity 需要的字段：sanity / turn / sonarDeception）。
  const run = (o?: { sanity?: number; turn?: number; dec?: number }): RunState =>
    ({ stats: { sanity: o?.sanity ?? 100 }, turn: o?.turn ?? 0, sonarDeception: o?.dec } as unknown as RunState);
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

  // (c) effectiveFalseEchoSanity：缺省＝基线（守 sensors 回归）/ 深 band 抬高（越深越易骗）/ subhadal 回落 / 封顶
  assert(effectiveFalseEchoSanity(run({})) === SONAR_FALSE_ECHO_SANITY, '11c: 缺省 band → 恰好基线（零行为变化）');
  const thrThroat = effectiveFalseEchoSanity(run({ dec: getBand('band.trench_throat')!.sonarDeception }));
  const thrHadal = effectiveFalseEchoSanity(run({ dec: getBand('band.hadal')!.sonarDeception }));
  const thrSub = effectiveFalseEchoSanity(run({ dec: getBand('band.subhadal')!.sonarDeception }));
  assert(thrThroat > SONAR_FALSE_ECHO_SANITY && thrHadal > thrThroat, '11c: 越深越易骗（throat < hadal）');
  assert(thrSub < thrThroat, '11c: subhadal 失真回落＝『把戏都停了』（< throat，越深越骗的梯度在最底反转）');
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
  const genHadal = (seed: number, dec: number) =>
    generateDiveMap({ zone, profileFlags: new Set(['flag.tutorial_complete']), deaths: [], rng: makeRng(seed), depthRange: [140, 180], maxRoomFeatures: 3, sonarDeception: dec });
  let totalDeceived = 0, totalBadExempt = 0, totalGated = 0;
  for (let seed = 1; seed <= 12; seed++) {
    const dirty = genHadal(seed, 0.32);
    const clean = genHadal(seed, 0);
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
  assert(fp(genHadal(5, 0.32)) === fp(genHadal(5, 0.32)), '11f: 欺骗确定性（同 seed 两次一致·FNV 哈希不耗 rng）');

  // (g) 数据守则：band.sonarDeception 非单调（throat→hadal 升、subhadal 回落）；浅 band 不设
  assert(getBand('band.reef_deep')!.sonarDeception === undefined, '11g: reef_deep 不设欺骗（浅段相对老实）');
  assert(getBand('band.trench_mouth')!.sonarDeception === undefined, '11g: trench_mouth 不设欺骗');
  assert(
    (getBand('band.subhadal')!.sonarDeception ?? 0) < (getBand('band.trench_throat')!.sonarDeception ?? 0),
    '11g: subhadal 欺骗 < throat（越深越骗的梯度在渊外反转＝诱饵）',
  );

  L('  spoof/evade 表象 + 深 band 失真阈值(封顶/回落) + 低 san 伪接触/乱码 + mapgen 欺骗(门控/豁免/确定性) ✓');
}

console.log(log.join('\n'));
console.log('\n✓ 声呐探索扫描回归通过（S0 + S1 多事件房间 + S2 不可信扫描）');
