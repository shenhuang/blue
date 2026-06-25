// 教学关「真·端到端」回归（quirk #173 续）—— 用真实引擎从下潜驱动到回港过场，补「只验 flag 逻辑、
// 不验真实运行时」的盲区（旧 §2b/§2c 手搓 flag 集合调 pickFlagTrigger·regress 绿但 bug 仍在·#172/#173 教训）。
//
// 忠实复刻真实 UI 路径：
//   - 潜水事件 = EventView.tsx：resolveOption(state, opt, event)  ← **带 event 参数**（oncePerSave 才写 event_seen）
//   - 港口过场 = PortEventView.tsx：resolveOption(state, opt, event) + finalize（event_done / null run / toPort）
//   - 回港 = port.ts::handleReturnToPort（真）；战斗 = combat.ts::startCombat + applyPlayerAction（真·逃跑）
//
// 三条完成路径都必须自然产生 flag.tutorial_complete（海图解锁门）：
//   §A 上浮一路（ascend_now → flag.tutorial_ascended → ending_safe）
//   §B 逃跑一路（engage → 真打 → 逃跑 → rest → 上浮 → event_seen:prologue 兜底 → ending_safe）
//   §C 船长日志一路（grab_log → item 触发 ending_log）
//
// 跑法：npx tsx scripts/playthrough-tutorial-e2e.ts （regress.mjs 按 playthrough*.ts 自动注册）

import { createInitialGameState, createNewRun } from '../src/engine/state';
import { resolveOption, isOptionVisible } from '../src/engine/events';
import { getEventById, getZone } from '../src/engine/zones';
import { generateDiveMap } from '../src/engine/mapgen';
import { startCombat, applyPlayerAction } from '../src/engine/combat';
import { executeAscent } from '../src/engine/ascent';
import { handleReturnToPort } from '../src/engine/port';
import { eventDoneFlag, pickReturnTrigger } from '../src/engine/portEvents';
import { toPort } from '../src/engine/transitions';
import { makeLcg } from '../src/engine/rng';
import type { GameState, DiveEvent } from '../src/types';

// 种子化焊死 flaky（quirk #129 同源）：教学含潜行检定 + 逃跑判定（Math.random）→ 定死随机变确定性。
Math.random = makeLcg(Number(process.env.PT_SEED) || 20260625);

const log: string[] = [];
const L = (s: string) => log.push(s);
function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) { console.log(log.join('\n')); throw new Error(`[playthrough-tutorial-e2e] ${msg}`); }
}

// —— 忠实复刻 EventView：解析潜水事件某选项，带 event 参数 ——
function driveEvent(state: GameState, eventId: string, pickId: (ev: DiveEvent) => string) {
  const ev = getEventById(eventId)!;
  const visible = ev.options.filter((o) => isOptionVisible(state, o));
  const opt = visible.find((o) => o.id === pickId(ev)) ?? visible[0];
  return resolveOption(state, opt, ev); // ← 带 event（EventView.tsx:33）
}

// —— 忠实复刻 PortEventView：解析港口过场选项 + finalize ——
function drivePortEvent(state: GameState, eventId: string): GameState {
  const ev = getEventById(eventId)!;
  const opt = ev.options.filter((o) => isOptionVisible(state, o))[0];
  const result = resolveOption(state, opt, ev);
  const flags = new Set(result.state.profile.flags);
  flags.add(eventDoneFlag(eventId));
  return toPort({ ...result.state, profile: { ...result.state.profile, flags }, run: null });
}

function diveUntilExit(state: GameState, picks: Record<string, string>) {
  let s = state;
  let cur = 'tutorial.prologue';
  for (let guard = 0; guard < 30; guard++) {
    const result = driveEvent(s, cur, (ev) => picks[ev.id] ?? ev.options[0].id);
    s = result.state;
    const next = result.next;
    if (next.kind === 'continueEvent') { cur = next.eventId; continue; }
    if (next.kind === 'forceAscend') return { state: s, ended: 'ascend' as const };
    if (next.kind === 'startCombat') return { state: s, ended: 'combat' as const, combatId: next.combatId };
    if (next.kind === 'death') return { state: s, ended: 'death' as const };
    return { state: s, ended: 'stuck' as const };
  }
  return { state: s, ended: 'stuck' as const };
}

function surfaceAndReturn(state: GameState): { state: GameState; trigger: string | null } {
  let s: GameState = { ...state, phase: { kind: 'ascent', targetDepth: 0 } };
  s = executeAscent(s, 'normal').state;
  const ret = handleReturnToPort(s);
  s = ret.state;
  if (ret.cutsceneEventId) s = drivePortEvent(s, ret.cutsceneEventId);
  return { state: s, trigger: ret.cutsceneEventId };
}

function freshRun(): GameState {
  const base = createInitialGameState();
  return { ...base, run: createNewRun({ zoneId: 'zone.east_reef' }), phase: { kind: 'dive', subPhase: { kind: 'event', eventId: 'tutorial.prologue' } } };
}

// §0 east_reef 首次脚本起点 = tutorial.prologue
L('§0 east_reef 脚本起点');
{
  const map = generateDiveMap({ zone: getZone('zone.east_reef')!, profileFlags: new Set<string>() });
  assert(map.nodes[map.startNodeId]?.eventId === 'tutorial.prologue', '§0 首次 east_reef startNode = tutorial.prologue');
  L('  scripted start ✓');
}

// §A 上浮一路
L('§A 上浮一路（ascend_now → ending_safe）');
{
  const out = diveUntilExit(freshRun(), { 'tutorial.prologue': 'dive_in', 'tutorial.descent': 'continue', 'tutorial.grouper': 'sneak', 'tutorial.wreck': 'stealth_grab', 'tutorial.deeper': 'ascend_now' });
  assert(out.ended === 'ascend', `§A 应强制上浮（实际 ${out.ended}）`);
  assert(out.state.profile.flags.has('event_seen:tutorial.prologue'), '§A prologue 写 event_seen:tutorial.prologue');
  assert(out.state.profile.flags.has('flag.tutorial_ascended'), '§A ascend_now 写 flag.tutorial_ascended');
  const { state, trigger } = surfaceAndReturn(out.state);
  assert(trigger === 'tutorial.ending_safe', `§A 回港触发 ending_safe（实际 ${trigger}）`);
  assert(state.profile.flags.has('flag.tutorial_complete'), '§A flag.tutorial_complete 落 profile（海图解锁）');
  assert(pickReturnTrigger({ ...state, run: createNewRun({ zoneId: 'zone.east_reef' }) }) === null, '§A 完成后不再重播');
  L('  上浮一路 → tutorial_complete ✓');
}

// §B 逃跑一路（真战斗）
L('§B 逃跑一路（真战斗 → 兜底 ending_safe）');
{
  const out = diveUntilExit(freshRun(), { 'tutorial.prologue': 'dive_in', 'tutorial.descent': 'continue', 'tutorial.grouper': 'sneak', 'tutorial.wreck': 'engage' });
  assert(out.ended === 'combat' && out.combatId === 'combat.tutorial_shark', `§B wreck/engage → 战斗（实际 ${out.ended}/${(out as any).combatId}）`);
  assert(out.state.profile.flags.has('event_seen:tutorial.prologue'), '§B prologue 写 event_seen');
  let s = startCombat(out.state, out.combatId!);
  let fled = false;
  for (let t = 0; t < 30 && s.phase.kind === 'combat'; t++) {
    const r = applyPlayerAction(s, 'action.flee');
    s = r.state;
    if (r.outcome === 'flee' || r.outcome === 'emergency_ascend') { fled = true; break; }
    if (s.phase.kind === 'gameOver') break;
  }
  assert(fled, '§B 逃跑脱战成功');
  assert(!s.profile.flags.has('flag.tutorial_ascended'), '§B 逃跑一路无 tutorial_ascended（未经 deeper）');
  const { state, trigger } = surfaceAndReturn(s);
  assert(trigger === 'tutorial.ending_safe', `§B 逃跑回港兜底 ending_safe（实际 ${trigger}）`);
  assert(state.profile.flags.has('flag.tutorial_complete'), '§B flag.tutorial_complete 落 profile');
  L('  逃跑一路 → tutorial_complete ✓');
}

// §C 船长日志一路
L('§C 船长日志一路（grab_log → ending_log）');
{
  const out = diveUntilExit(freshRun(), { 'tutorial.prologue': 'dive_in', 'tutorial.descent': 'continue', 'tutorial.grouper': 'sneak', 'tutorial.wreck': 'stealth_grab', 'tutorial.deeper': 'go_deeper', 'tutorial.captain_quarters': 'grab_log' });
  assert(out.ended === 'ascend', `§C 应强制上浮（实际 ${out.ended}）`);
  assert(out.state.run?.inventory.some((i) => i.itemId === 'item.captain_log'), '§C run.inventory 含 captain_log');
  const { state, trigger } = surfaceAndReturn(out.state);
  assert(trigger === 'tutorial.ending_log', `§C 回港触发 ending_log（实际 ${trigger}）`);
  assert(state.profile.flags.has('flag.tutorial_complete'), '§C flag.tutorial_complete 落 profile');
  L('  船长日志一路 → tutorial_complete ✓');
}

console.log('playthrough-tutorial-e2e ✓ — §0 脚本起点 / §A 上浮 / §B 逃跑 / §C 船长日志 三路均自然产生 tutorial_complete');
