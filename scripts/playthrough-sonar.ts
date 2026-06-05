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
import { pingSonar, moveToNode } from '../src/engine/dive';
import {
  POWER_MAX,
  SONAR_PING_COST,
  SONAR_PING_ALERT,
  ALERT_MAX,
  sonarPingAlertDelta,
  alertDepthFactor,
} from '../src/engine/clarity';
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

console.log(log.join('\n'));
console.log('\n✓ 声呐探索扫描回归通过（S0）');
