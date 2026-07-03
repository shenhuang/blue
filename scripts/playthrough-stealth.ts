// 探测 / 隐身 / 警觉回归（深水区 Phase 0b）。
// 覆盖 SPEC §11 0b 的核心断言（依赖 0a 的 signature，纯引擎）：
//   1. 深水 + 点灯 → 警觉逐回合抬升（被探测）
//   2. 摸黑（关灯）→ 警觉消退（逃出生天的阀门）
//   3. 浅水 + 点灯 → 警觉不积累、且 predatorApproaches 永假（§7.5 浅水免探测压力）
//   4. 警觉越线 + 该 zone 有 ambushEncounters + 进事件节点 → 潜伏捕食者接近、触发遭遇（复用 zone 现有敌）
//   5. 摸黑低警觉进同一节点 → 滑过、不触发遭遇（照常进节点）
//   6. zone 无 ambushEncounters（教学/浅水）→ 即便高警觉也不触发（数据门控 = §7.5 兜底）
//
// 跑法： npx tsx scripts/playthrough-stealth.ts

import type { GameState, RunState, DiveMap } from '../src/types';
import { createInitialGameState, createNewRun } from '../src/engine/state';
import { moveToNode } from '../src/engine/dive';
import { tickTurns } from '../src/engine/events';
import {
  alertDepthFactor,
  predatorApproaches,
  ALERT_THRESHOLD,
  ALERT_AFTER_TRIGGER,
} from '../src/engine/clarity';
import { makeHarness, type PtAssert } from './lib/pt';

const pt = makeHarness('探测 / 隐身 / 警觉回归');
const { L } = pt;
const assert: PtAssert = pt.assert;

const CAVE_POOL = ['combat.blind_eel_solo', 'combat.cave_octopus_solo'];

/** n0 连到 n1（同深度、事件节点、无 eventId → 不触发遭遇时退化成安静水域）。 */
function makeMap(depth: number): DiveMap {
  return {
    zoneId: 'zone.blue_caves',
    generatedAt: 0,
    startNodeId: 'n0',
    nodes: {
      n0: { id: 'n0', layer: 0, depth, zoneTag: 'cave', kind: 'event', connectsTo: ['n1'], preview: '起点。' },
      n1: { id: 'n1', layer: 1, depth, zoneTag: 'cave', kind: 'event', connectsTo: [], preview: '前方一段水道。' },
    },
  };
}

function mk(opts: {
  zoneId?: string;
  depth?: number;
  light?: boolean;
  alert?: number;
}): GameState {
  const base = createInitialGameState();
  const zoneId = opts.zoneId ?? 'zone.blue_caves';
  const r0 = createNewRun({ zoneId });
  const depth = opts.depth ?? 50;
  const run: RunState = {
    ...r0,
    zoneId,
    map: makeMap(depth),
    currentNodeId: 'n0',
    currentDepth: depth,
    sensors: { ...r0.sensors, light: opts.light ?? true },
    alert: opts.alert ?? 0,
  };
  return { ...base, run, phase: { kind: 'dive', subPhase: { kind: 'nodeSelect', choices: [] } } };
}

// ============================================================
// 1. 深水 + 点灯 → 警觉抬升
// ============================================================
L('========== 1. 深水点灯 → 警觉抬升 ==========');
{
  const run = mk({ depth: 50, light: true, alert: 0 }).run!;
  const after = tickTurns(run, 6);
  L(`  alert 0 → ${after.alert.toFixed(1)}（深 50m 点灯 6 回合）`);
  assert(after.alert > 0, '1: 深水点灯应让警觉抬升');
  L('  深水点灯被探测、警觉积累 ✓');
}

// ============================================================
// 2. 摸黑 → 警觉消退
// ============================================================
L('\n========== 2. 摸黑 → 警觉消退 ==========');
{
  const run = mk({ depth: 50, light: false, alert: 50 }).run!;
  const after = tickTurns(run, 3);
  L(`  alert 50 → ${after.alert.toFixed(1)}（摸黑 3 回合）`);
  assert(after.alert < 50, '2: 摸黑应让警觉消退（逃出生天的阀门）');
  L('  摸黑降暴露、警觉消退 ✓');
}

// ============================================================
// 3. 浅水免探测压力（§7.5）
// ============================================================
L('\n========== 3. 浅水免探测压力 ==========');
{
  const run = mk({ depth: 15, light: true, alert: 30 }).run!;
  assert(alertDepthFactor(run) === 0, '3: 浅水深度因子为 0');
  const after = tickTurns(run, 3);
  L(`  alert 30 → ${after.alert.toFixed(1)}（浅 15m 点灯 3 回合，应只降不升）`);
  assert(after.alert < 30, '3: 浅水点灯警觉不积累（反而消退）');
  assert(
    !predatorApproaches({ ...run, alert: 99 }),
    '3: 浅水即便满警觉也不触发接近（depth < ALERT_MIN_DEPTH）',
  );
  L('  浅水：不积累 + 不触发（§7.5）✓');
}

// ============================================================
// 4. 警觉越线 + 深水 zone → 潜伏捕食者接近、触发遭遇
// ============================================================
L('\n========== 4. 高警觉 → 接近触发遭遇 ==========');
{
  const s = mk({ zoneId: 'zone.blue_caves', depth: 50, light: true, alert: ALERT_THRESHOLD });
  const after = moveToNode(s, 'n1');
  assert(after.phase.kind === 'combat', '4: 高警觉进事件节点应触发遭遇（phase=combat）');
  const combatId = after.phase.kind === 'combat' ? after.phase.combat.combatId : '';
  L(`  触发遭遇：${combatId}`);
  assert(CAVE_POOL.includes(combatId), '4: 触发的应是该 zone 的潜伏捕食者（cave 池）');
  assert(after.run!.alert === ALERT_AFTER_TRIGGER, '4: 触发后警觉落回缓冲值（避免连环伏击）');
  L('  高警觉 → 捕食者接近、复用 zone 敌、警觉重置 ✓');
}

// ============================================================
// 5. 摸黑低警觉 → 滑过（不触发遭遇）
// ============================================================
L('\n========== 5. 摸黑低警觉 → 滑过 ==========');
{
  const s = mk({ zoneId: 'zone.blue_caves', depth: 50, light: false, alert: 0 });
  const after = moveToNode(s, 'n1');
  assert(after.phase.kind === 'dive', '5: 摸黑低警觉应滑过、不触发遭遇（phase 仍 dive）');
  assert((after.run!.alert ?? 0) < ALERT_THRESHOLD, '5: 摸黑后警觉仍在阈值下');
  L('  摸黑滑过、无遭遇 ✓');
}

// ============================================================
// 6. zone 无 ambushEncounters → 即便高警觉也不触发（数据门控）
// ============================================================
L('\n========== 6. 无伏击池的 zone → 不触发 ==========');
{
  // 教学海域 east_reef 不配 ambushEncounters（§7.5 兜底）
  const s = mk({ zoneId: 'zone.east_reef', depth: 50, light: true, alert: 99 });
  const after = moveToNode(s, 'n1');
  assert(after.phase.kind === 'dive', '6: 无 ambushEncounters 的 zone 即便满警觉也不触发遭遇');
  L('  无伏击池 zone：满警觉也不触发（数据门控）✓');
}

pt.done();
