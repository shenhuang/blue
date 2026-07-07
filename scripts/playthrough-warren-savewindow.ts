// 撤退/月相存档窗回归（蜂群 boss SPEC §9.11）：
//   The Warren 追猎进度（RunState.warrenHunt）离港时结转到 profile.warrenHunt（连同 lastVisitDay 盖章离港
//   那一刻的总天数），下次开潜据跨过几个相位边界（moonPhasesElapsed）决定续上还是蜂巢重新聚拢清零。
//
// 覆盖：
//   1. moonPhasesElapsed 纯函数边界（同相位内 0·跨 1 边界 1·跨周期正确·允许倒退出负数）。
//   2. handleReturnToPort：run.warrenHunt 存在 → 结转进 profile.warrenHunt + 盖章 lastVisitDay；
//      run.warrenHunt 缺席（非 Warren 追猎）→ 不新建结转档（原样跳过）。
//   3. startDive：≤ 阈值（WARREN_SAVE_WINDOW_PHASES=1）→ 原样续上 roomsCleared/queenNodeId/inHatchery；
//      > 阈值 → 蜂巢重新聚拢，run.warrenHunt 回到 undefined（同「从未结转过」的新追猎起点）。
//   4. 全程无 profile.warrenHunt（普通潜水·非 Warren）→ startDive 后 run.warrenHunt 仍 undefined（零回归）。
//
// 跑法： npx tsx scripts/playthrough-warren-savewindow.ts

import type { GameState } from '../src/types';
import { createInitialGameState, createNewRun } from '../src/engine/state';
import { handleReturnToPort, advanceDays } from '../src/engine/port';
import { startDive } from '../src/engine/dive';
import { moonPhasesElapsed, LUNAR_CYCLE_DAYS } from '../src/engine/lunar';
import { makeHarness, type PtAssert } from './lib/pt';

const pt = makeHarness('撤退/月相存档窗（The Warren·SPEC §9.11）');
const { L } = pt;
const assert: PtAssert = pt.assert;

const ZONE = 'zone.blue_caves';

// ── A. moonPhasesElapsed 纯函数边界 ─────────────────────────────────────
L('========== A. moonPhasesElapsed 边界 ==========');
{
  // 7 天/相（LUNAR_CYCLE_DAYS=28 ÷ 4 相）。
  const seg = LUNAR_CYCLE_DAYS / 4;
  assert(seg === 7, `每相天数应为 7（当前 ${seg}）`);

  assert(moonPhasesElapsed(0, 0) === 0, 'day 相同 → 0 个边界');
  assert(moonPhasesElapsed(0, 6) === 0, '同一相位内往返（day 0→6，仍在第 0 相内）→ 0（窗非天差）');
  assert(moonPhasesElapsed(0, 7) === 1, '恰好跨 1 个相位边界（day 0→7）→ 1');
  assert(moonPhasesElapsed(3, 10) === 1, '相内出发+跨 1 边界（day 3→10）→ 1');
  assert(moonPhasesElapsed(0, 14) === 2, '跨 2 个边界（day 0→14）→ 2');
  assert(moonPhasesElapsed(6, 7) === 1, '边界正卡在两天之间（day 6→7）→ 1（跨过 1 条线）');
  assert(moonPhasesElapsed(0, LUNAR_CYCLE_DAYS) === 4, '整一个周期（28 天）→ 4 个边界（4 相）');
  assert(moonPhasesElapsed(7, 0) === -1, '允许倒退出负数（调用方按 >阈值 判自然只在正向流逝时触发）');
  L('  ✓ moonPhasesElapsed 边界全部符合预期');
}

// ── 构造一个"带 Warren 追猎进度"的 GameState 的小 helper ──────────────
function stateWithWarrenRun(day: number, warrenHunt: { roomsCleared: number; queenNodeId?: string; inHatchery?: boolean }): GameState {
  const base = createInitialGameState();
  const profile = { ...base.profile, day };
  const run = { ...createNewRun({ zoneId: ZONE }), warrenHunt };
  return { ...base, profile, run };
}

// ── B. handleReturnToPort：结转 + 盖章 lastVisitDay ─────────────────────
L('\n========== B. handleReturnToPort 结转 ==========');
{
  const s0 = stateWithWarrenRun(10, { roomsCleared: 2, queenNodeId: 'node.room3', inHatchery: false });
  const { state: s1 } = handleReturnToPort(s0);
  assert(s1.run === null, '回港后 run 应清空');
  assert(s1.profile.warrenHunt !== undefined, '回港后 profile.warrenHunt 应被写入（结转挂点）');
  assert(s1.profile.warrenHunt!.roomsCleared === 2, `roomsCleared 应原样结转（当前 ${s1.profile.warrenHunt!.roomsCleared}）`);
  assert(s1.profile.warrenHunt!.queenNodeId === 'node.room3', `queenNodeId 应原样结转（当前 ${s1.profile.warrenHunt!.queenNodeId}）`);
  assert(s1.profile.warrenHunt!.inHatchery === false, 'inHatchery 应原样结转');
  assert(s1.profile.warrenHunt!.lastVisitDay === 10, `lastVisitDay 应盖章离港时的 profile.day=10（当前 ${s1.profile.warrenHunt!.lastVisitDay}）`);
  L('  ✓ run.warrenHunt 存在时正确结转到 profile.warrenHunt 并盖章 lastVisitDay');
}
{
  // 非 Warren 追猎（run.warrenHunt 缺席）→ 不新建结转档。
  const base = createInitialGameState();
  const s0: GameState = { ...base, profile: { ...base.profile, day: 5 }, run: createNewRun({ zoneId: ZONE }) };
  assert(s0.run!.warrenHunt === undefined, '前置条件：普通 run 起手 warrenHunt 应缺席');
  const { state: s1 } = handleReturnToPort(s0);
  assert(s1.profile.warrenHunt === undefined, '非 Warren 追猎回港 → profile.warrenHunt 不应被新建（真条件字段·原样跳过）');
  L('  ✓ run.warrenHunt 缺席时 handleReturnToPort 不新建结转档');
}

// ── C. startDive：窗内续上 / 窗外清零 ────────────────────────────────────
L('\n========== C. startDive 存档窗判断 ==========');
{
  // 窗内（≤1 个相位边界）：离港 day=10，隔 3 天后开潜（day=13，仍在同一相位窗内·10 和 13 都落在同一 7 天段）。
  const s0 = stateWithWarrenRun(10, { roomsCleared: 3, queenNodeId: 'node.hatchery', inHatchery: true });
  const { state: afterPort } = handleReturnToPort(s0);
  assert(afterPort.profile.warrenHunt!.lastVisitDay === 10, '前置：lastVisitDay=10');

  let s1 = advanceDays(afterPort, 3); // day 10 → 13（同一相位段内：Math.floor(10/7)=1, Math.floor(13/7)=1 → 0 个边界）
  assert((s1.profile.day ?? 0) === 13, `advanceDays(3) 后 day 应为 13（当前 ${s1.profile.day}）`);
  s1 = { ...s1, run: createNewRun({ zoneId: ZONE }) };
  const dived1 = startDive(s1, ZONE);
  assert(dived1.run !== null, 'startDive 后 run 不应为 null');
  assert(dived1.run!.warrenHunt !== undefined, '窗内（≤1 相位边界）→ run.warrenHunt 应被续上（非 undefined）');
  assert(dived1.run!.warrenHunt!.roomsCleared === 3, `窗内续上 roomsCleared 应为 3（当前 ${dived1.run!.warrenHunt!.roomsCleared}）`);
  assert(dived1.run!.warrenHunt!.queenNodeId === 'node.hatchery', 'queenNodeId 应原样续上');
  assert(dived1.run!.warrenHunt!.inHatchery === true, 'inHatchery 应原样续上');
  L('  ✓ 窗内（≤1 相位边界）：run.warrenHunt 原样续上');
}
{
  // 窗外（>1 个相位边界）：离港 day=10，隔 15 天再开潜（day=25，跨了 2 个边界：floor(10/7)=1 → floor(25/7)=3 → elapsed=2）。
  const s0 = stateWithWarrenRun(10, { roomsCleared: 3, queenNodeId: 'node.hatchery', inHatchery: true });
  const { state: afterPort } = handleReturnToPort(s0);

  let s1 = advanceDays(afterPort, 15); // day 10 → 25
  assert((s1.profile.day ?? 0) === 25, `advanceDays(15) 后 day 应为 25（当前 ${s1.profile.day}）`);
  const elapsed = moonPhasesElapsed(10, 25);
  assert(elapsed === 2, `前置：day 10→25 应跨 2 个相位边界（当前 ${elapsed}）`);

  s1 = { ...s1, run: createNewRun({ zoneId: ZONE }) };
  const dived2 = startDive(s1, ZONE);
  assert(dived2.run !== null, 'startDive 后 run 不应为 null');
  assert(dived2.run!.warrenHunt === undefined, '窗外（>1 相位边界）→ 蜂巢重新聚拢，run.warrenHunt 应清零回 undefined');
  L('  ✓ 窗外（>1 相位边界）：run.warrenHunt 重置为 undefined（追猎从头开始）');
}
{
  // 恰好卡在阈值上（=1 个相位边界）：应仍算窗内（判据是 >阈值 才重置，非 ≥）。
  const s0 = stateWithWarrenRun(6, { roomsCleared: 1 });
  const { state: afterPort } = handleReturnToPort(s0);
  let s1 = advanceDays(afterPort, 1); // day 6 → 7：跨恰好 1 个边界（floor(6/7)=0 → floor(7/7)=1）
  const elapsed = moonPhasesElapsed(6, 7);
  assert(elapsed === 1, `前置：day 6→7 应恰好跨 1 个边界（当前 ${elapsed}）`);
  s1 = { ...s1, run: createNewRun({ zoneId: ZONE }) };
  const dived3 = startDive(s1, ZONE);
  assert(dived3.run!.warrenHunt !== undefined, '恰好=阈值（1 个边界）应仍判窗内 → 续上（非重置）');
  assert(dived3.run!.warrenHunt!.roomsCleared === 1, '恰好=阈值时 roomsCleared 应原样续上');
  L('  ✓ 恰好 = 阈值（1 个相位边界）仍判窗内（阈值是 >n 才重置，非 ≥）');
}

// ── D. 全程无 profile.warrenHunt（非 Warren 潜水）→ 零回归 ──────────────
L('\n========== D. 非 Warren 潜水零回归 ==========');
{
  const base = createInitialGameState();
  assert(base.profile.warrenHunt === undefined, '前置：起手 profile 不应带 warrenHunt');
  const s: GameState = { ...base, run: createNewRun({ zoneId: ZONE }) };
  const dived = startDive(s, ZONE);
  assert(dived.run!.warrenHunt === undefined, '无 profile.warrenHunt → startDive 后 run.warrenHunt 仍应缺席（零影响·同旧行为）');
  L('  ✓ 无结转档时 startDive 对 run.warrenHunt 零影响（旧行为逐字节不变）');
}

pt.done();
