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
import { startDive, startDiveFromPoi, enterNodeSelection, moveToNode } from '../src/engine/dive';
import { generateChart, getPoiById } from '../src/engine/chart';
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

// 节点导航驱动（教学关 node 化·#221+·SPEC 深海回响_教学关node化）：像玩家一样逐节点把教学潜到「上浮」相位——
// 复刻 EventView next.kind 分发 + nodeSelect 前进（强制单向：locked ⇒ choices 里没有上浮·只一个前进节点）+ 战斗 flee。
// 记录：途中 tutorial beats / 是否全程锁上浮（run.ascentLocked）/ 每个 nodeSelect 是否都恰一个前进选择（强制线性）/ 打过哪场战斗。
// **不**执行上浮——到 phase==='ascent' 即返回·由调用方 surfaceAndReturn 走 executeAscent + 回港（避免双执行）。
function driveTutorialToSurface(state: GameState, picks: Record<string, string>) {
  let s = state;
  const beats: string[] = [];
  let lockedThroughout = true;
  let forcedLinear = true;
  let sawCombat: string | null = null;
  for (let guard = 0; guard < 200; guard++) {
    const ph = s.phase as { kind: string; combatId?: string; subPhase?: { kind: string; eventId?: string; choices?: Array<{ nodeId: string; depth: number; isAscentPoint: boolean }> } };
    if (ph.kind === 'dive' && s.run && !s.run.ascentLocked) lockedThroughout = false;
    if (ph.kind === 'ascent') return { state: s, beats, lockedThroughout, forcedLinear, sawCombat, ended: 'surfaced' as const };
    if (ph.kind === 'gameOver') return { state: s, beats, lockedThroughout, forcedLinear, sawCombat, ended: 'died' as const };
    if (ph.kind === 'combat') {
      if (ph.combatId) sawCombat = ph.combatId;
      let fled = false;
      for (let t = 0; t < 40 && (s.phase as { kind: string }).kind === 'combat'; t++) {
        const r = applyPlayerAction(s, 'action.flee'); s = r.state;
        if (r.outcome === 'flee' || r.outcome === 'emergency_ascend') { fled = true; break; }
        if ((s.phase as { kind: string }).kind === 'gameOver') return { state: s, beats, lockedThroughout, forcedLinear, sawCombat, ended: 'died' as const };
      }
      if (!fled) return { state: s, beats, lockedThroughout, forcedLinear, sawCombat, ended: 'stuck-combat' as const };
      continue;
    }
    if (ph.kind !== 'dive') return { state: s, beats, lockedThroughout, forcedLinear, sawCombat, ended: `phase:${ph.kind}` as const };
    const sub = ph.subPhase!;
    if (sub.kind === 'event') {
      if (sub.eventId!.startsWith('tutorial.')) beats.push(sub.eventId!.replace('tutorial.', ''));
      const r = driveEvent(s, sub.eventId!, (ev) => picks[ev.id] ?? ev.options[0].id);
      let next = r.state;
      if (r.next.kind === 'continueEvent') next = { ...next, phase: { kind: 'dive', subPhase: { kind: 'event', eventId: r.next.eventId } } };
      else if (r.next.kind === 'startCombat') { sawCombat = r.next.combatId; next = startCombat(next, r.next.combatId); }
      else if (r.next.kind === 'forceAscend') next = { ...next, phase: { kind: 'ascent', targetDepth: 0 } };
      else if (r.next.kind === 'death') next = { ...next, phase: { kind: 'gameOver', reason: 'died' } as GameState['phase'] };
      else if (r.next.kind === 'remainOnEvent') next = next.run?.map ? enterNodeSelection(next) : next;
      s = next; continue;
    }
    if (sub.kind === 'nodeSelect') {
      const choices = sub.choices ?? [];
      const forward = choices.filter((c) => !c.isAscentPoint);
      if (forward.length !== 1) forcedLinear = false; // 强制线性：恰好一个前进节点（locked ⇒ choices 里无上浮逃·见 NodeSelectView gate）
      const target = forward[0] ?? choices[0];
      if (!target) { s = { ...s, phase: { kind: 'ascent', targetDepth: 0 } }; continue; }
      s = moveToNode(s, target.nodeId); continue;
    }
    s = s.run?.map ? enterNodeSelection(s) : { ...s, phase: { kind: 'ascent', targetDepth: 0 } };
  }
  return { state: s, beats, lockedThroughout, forcedLinear, sawCombat, ended: 'guard' as const };
}

function surfaceAndReturn(state: GameState): { state: GameState; trigger: string | null } {
  let s: GameState = { ...state, phase: { kind: 'ascent', targetDepth: 0 } };
  s = executeAscent(s, 'normal').state;
  const ret = handleReturnToPort(s);
  s = ret.state;
  if (ret.cutsceneEventId) s = drivePortEvent(s, ret.cutsceneEventId);
  return { state: s, trigger: ret.cutsceneEventId };
}

// 教学首潜：走真 startDive（教学关 node 化·#221+ ⇒ layered 3-node 图 + scriptedNodeEvents 钉 beats + run.ascentLocked 锁上浮）。
function freshRun(): GameState {
  const base = createInitialGameState();
  const run = createNewRun({ zoneId: 'zone.east_reef', equipment: base.profile.equipment });
  return startDive({ ...base, run }, 'zone.east_reef');
}

// §0 教学首潜＝3-node 图·beats 钉到各层（与重访共用布局·#221+ 教学关 node 化）
L('§0 教学首潜 node 图（prologue@0 / grouper@1 / deeper@2·与重访共用布局）');
{
  const map = generateDiveMap({ zone: getZone('zone.east_reef')!, profileFlags: new Set<string>() });
  const nodes = Object.values(map.nodes);
  const byLayer = (layer: number) => nodes.find((n) => n.layer === layer);
  assert(nodes.length === 3, `§0 教学首潜应 3 节点（与重访共用布局·实际 ${nodes.length}）`);
  assert(map.nodes[map.startNodeId]?.eventId === 'tutorial.prologue', '§0 起点节点 = tutorial.prologue');
  assert(byLayer(1)?.eventId === 'tutorial.wreck_approach', '§0 layer 1 = tutorial.wreck_approach（沉船入口前·氛围·无生物·#222 续）');
  assert(byLayer(2)?.eventId === 'tutorial.deeper', '§0 layer 2 = tutorial.deeper');
  L('  3-node scripted layout ✓');
}

// §A 上浮一路（node 导航·deeper.ascend_now → ending_safe）
L('§A 上浮一路（node 导航·ascend_now → ending_safe）');
{
  const out = driveTutorialToSurface(freshRun(), { 'tutorial.prologue': 'dive_in', 'tutorial.descent': 'continue', 'tutorial.wreck_approach': 'press_on', 'tutorial.wreck': 'stealth_grab', 'tutorial.deeper': 'ascend_now' });
  assert(out.ended === 'surfaced', `§A 应正常上浮（实际 ${out.ended}）`);
  assert(out.lockedThroughout, '§A 教学全程 run.ascentLocked（强制下行·锁自愿上浮）');
  assert(out.forcedLinear, '§A 每个 nodeSelect 恰一个前进节点（强制单向·无上浮逃）');
  assert(out.beats.join(',') === 'prologue,descent,wreck_approach,wreck,deeper', `§A beats 顺序应 prologue→descent→wreck_approach→wreck→deeper（实际 ${out.beats.join(',')}）`);
  assert(out.state.profile.flags.has('event_seen:tutorial.prologue'), '§A prologue 写 event_seen:tutorial.prologue');
  assert(out.state.profile.flags.has('flag.tutorial_ascended'), '§A deeper.ascend_now 写 flag.tutorial_ascended');
  const { state, trigger } = surfaceAndReturn(out.state);
  assert(trigger === 'tutorial.ending_safe', `§A 回港触发 ending_safe（实际 ${trigger}）`);
  assert(state.profile.flags.has('flag.tutorial_complete'), '§A flag.tutorial_complete 落 profile（海图解锁）');
  assert(pickReturnTrigger({ ...state, run: createNewRun({ zoneId: 'zone.east_reef' }) }) === null, '§A 完成后不再重播');
  L('  上浮一路 → tutorial_complete ✓');
}

// §B 鲨鱼一路（node 导航·engage→真战斗 flee→锁着续行 deeper.ascend_now→ending_safe）
L('§B 鲨鱼一路（node 导航·engage→flee→续行→ending_safe）');
{
  const out = driveTutorialToSurface(freshRun(), { 'tutorial.prologue': 'dive_in', 'tutorial.descent': 'continue', 'tutorial.wreck_approach': 'press_on', 'tutorial.wreck': 'engage', 'tutorial.deeper': 'ascend_now' });
  assert(out.ended === 'surfaced', `§B 应正常上浮（实际 ${out.ended}）`);
  assert(out.sawCombat === 'combat.tutorial_shark', `§B wreck/engage → 真战斗（实际 ${out.sawCombat}）`);
  assert(out.lockedThroughout, '§B 全程锁上浮（含战斗·不给应急上浮逃出教学）');
  assert(out.forcedLinear, '§B flee 脱战后仍强制单向续行到 deeper（不能就地上浮）');
  assert(!out.state.profile.flags.has('flag.seen_first_uncanny'), '§B 没进船长室·无 seen_first_uncanny');
  assert(!out.state.run?.inventory.some((i) => i.itemId === 'item.captain_log'), '§B 无 captain_log（→ ending_safe 非 log）');
  const { state, trigger } = surfaceAndReturn(out.state);
  assert(trigger === 'tutorial.ending_safe', `§B 回港 ending_safe（实际 ${trigger}）`);
  assert(state.profile.flags.has('flag.tutorial_complete'), '§B flag.tutorial_complete 落 profile');
  L('  鲨鱼一路 → tutorial_complete ✓');
}

// §C 船长日志一路（node 导航·deeper.go_deeper → captain_quarters → grab_log → ending_log）
L('§C 船长日志一路（node 导航·grab_log → ending_log）');
{
  const out = driveTutorialToSurface(freshRun(), { 'tutorial.prologue': 'dive_in', 'tutorial.descent': 'continue', 'tutorial.wreck_approach': 'press_on', 'tutorial.wreck': 'stealth_grab', 'tutorial.deeper': 'go_deeper', 'tutorial.captain_quarters': 'grab_log' });
  assert(out.ended === 'surfaced', `§C 应正常上浮（实际 ${out.ended}）`);
  assert(out.lockedThroughout, '§C 教学全程锁上浮');
  assert(out.beats.includes('captain_quarters'), '§C 真进了船长室（go_deeper → captain_quarters）');
  assert(out.state.run?.inventory.some((i) => i.itemId === 'item.captain_log'), '§C run.inventory 含 captain_log');
  const { state, trigger } = surfaceAndReturn(out.state);
  assert(trigger === 'tutorial.ending_log', `§C 回港触发 ending_log（实际 ${trigger}）`);
  assert(state.profile.flags.has('flag.tutorial_complete'), '§C flag.tutorial_complete 落 profile');
  L('  船长日志一路 → tutorial_complete ✓');
}

// §D 重访东礁「二次下潜」真引擎**导航式**端到端（quirk #189 回归门）
//   旧 bug：`tutorial.captain_quarters` 的 grab_log 出口**不**置 `flag.seen_first_uncanny`（按教学剧本 §5 该 flag
//   只在 look_closer 置位·保留给未来深海事件），而旧版重访门用它 gate `captain_revisit_empty` → 走 grab_log 进过
//   船长室后，二次重访静默回普通下潜（_empty 永不解锁·「资格区第二次去没修好」）。三次「修」都只动 §2d 手搓 flag、
//   没接这条真路径（#184/#200/#200-cont）→ 反复回归。门键已改 `event_seen:tutorial.captain_quarters`（引擎自维护·
//   单一真相·grab_log/look_closer 皆算）。**本 §D 不再"直接结算钉放事件"·而是像玩家一样逐节点导航下潜**——
//   复刻 EventView.handleChoose 的 next.kind 分发 + 节点选择 + RestView「继续下潜」（中途上浮口往深走、不提前撤），
//   断言玩家**真的遇到**（而非仅"钉到图上"）正确的重访变体。这把"钉了但导航到不了"（如剧情点被早一层上浮口挡住·
//   2026-06-27 实跑发现）也一并纳入守门。

// 像玩家一样把一整潜导航到水面：复刻 EventView next.kind + 节点选择 + RestView；记录途中遇到的 story 事件 id。
function diveDeepToSurface(state: GameState, picks: Record<string, string>): { state: GameState; seen: string[] } {
  const STORY = ['tutorial.captain_revisit', 'tutorial.captain_revisit_empty', 'tutorial.captain_quarters'];
  let s = state;
  const seen: string[] = [];
  for (let guard = 0; guard < 300; guard++) {
    const ph = s.phase as { kind: string; subPhase?: { kind: string; eventId?: string; choices?: Array<{ nodeId: string; depth: number; isAscentPoint: boolean; visited: boolean }> } };
    if (ph.kind === 'ascent') { s = executeAscent(s, 'normal').state; return { state: s, seen }; }
    if (ph.kind === 'gameOver') return { state: s, seen };
    if (ph.kind === 'combat') {
      for (let t = 0; t < 40 && (s.phase as { kind: string }).kind === 'combat'; t++) {
        const r = applyPlayerAction(s, 'action.flee'); s = r.state;
        if (r.outcome === 'flee' || r.outcome === 'emergency_ascend') break;
        if ((s.phase as { kind: string }).kind === 'gameOver') return { state: s, seen };
      }
      continue;
    }
    if (ph.kind !== 'dive') return { state: s, seen };
    const sub = ph.subPhase!;
    if (sub.kind === 'event') {
      if (STORY.includes(sub.eventId!)) seen.push(sub.eventId!);
      const r = driveEvent(s, sub.eventId!, (ev) => picks[ev.id] ?? ev.options[0].id);
      let next = r.state;
      if (r.next.kind === 'continueEvent') next = { ...next, phase: { kind: 'dive', subPhase: { kind: 'event', eventId: (r.next as { eventId: string }).eventId } } };
      else if (r.next.kind === 'startCombat') next = startCombat(next, (r.next as { combatId: string }).combatId);
      else if (r.next.kind === 'forceAscend') next = { ...next, phase: { kind: 'ascent', targetDepth: 0 } };
      else if (r.next.kind === 'death') next = { ...next, phase: { kind: 'gameOver', reason: 'died' } as GameState['phase'] };
      else if (r.next.kind === 'remainOnEvent') next = next.run?.map ? enterNodeSelection(next) : next;
      s = next; continue;
    }
    if (sub.kind === 'nodeSelect') {
      const choices = sub.choices ?? [];
      const forward = choices.filter((c) => !c.isAscentPoint && !c.visited).sort((a, b) => b.depth - a.depth);
      const target = forward[0] ?? choices.find((c) => c.isAscentPoint) ?? choices[0];
      if (!target) { s = { ...s, phase: { kind: 'ascent', targetDepth: 0 } }; continue; }
      s = moveToNode(s, target.nodeId); continue;
    }
    // rest/corpse/其它：复刻 RestView「继续下潜」往深走（最深死端时 enterNodeSelection 自然转 ascent）。
    s = s.run?.map ? enterNodeSelection(s) : { ...s, phase: { kind: 'ascent', targetDepth: 0 } };
  }
  return { state: s, seen };
}

// 重访资格区并像玩家一样下潜到底：startDiveFromPoi（= SeaChartView 出海）→ 导航 → 回港。返回途中遇到的 story 事件。
function revisitQualZone(state: GameState, picks: Record<string, string>): { state: GameState; seen: string[]; pinned: string | null } {
  const poi = getPoiById(generateChart({ profile: state.profile }), 'poi.anchor.east_reef');
  assert(poi, '§D east_reef anchor（东礁·资格区）教学后应在海图');
  const dived = startDiveFromPoi(state, poi!);
  const hit = Object.values(dived.run?.map?.nodes ?? {}).find(
    (n) => n.eventId === 'tutorial.captain_revisit' || n.eventId === 'tutorial.captain_revisit_empty',
  );
  const run = diveDeepToSurface(dived, picks);
  const back = surfaceAndReturn(run.state);
  return { state: back.state, seen: run.seen, pinned: hit?.eventId ?? null };
}

// 重访潜水时的统一选择：撞上 captain_revisit→下去；进船长室→抓日志走（旧 bug 精确路径·不置 seen_first_uncanny）；空房间→出来。
const REVISIT_PICKS = { 'tutorial.captain_revisit': 'go_down', 'tutorial.captain_quarters': 'grab_log', 'tutorial.captain_revisit_empty': 'leave' };

L('§D 重访东礁二次下潜·导航式真跑（grab_log 路径必"遇到"_empty·quirk #189）');
{
  // 种子化焊死 flaky（quirk #129）：§D 跑在 §A/§B/§C 之后·全局 Math.random 已被消耗；每个场景前重置到
  // 确定性种子，保证教学含潜行检定 + 重访图生成可复现（导航能稳定走到 captain_revisit·与单跑无关）。
  Math.random = makeLcg(20260627);
  // —— 场景 A：教学只上浮（没下船长室）→ 重访#1 真遇到 captain_revisit（下去 grab_log）→ 重访#2 必遇到 _empty ——
  const outA = driveTutorialToSurface(freshRun(), { 'tutorial.prologue': 'dive_in', 'tutorial.descent': 'continue', 'tutorial.wreck_approach': 'press_on', 'tutorial.wreck': 'stealth_grab', 'tutorial.deeper': 'ascend_now' });
  let s = surfaceAndReturn(outA.state).state;
  assert(s.profile.flags.has('flag.tutorial_complete'), '§D/A 教学完成（海图解锁）');
  assert(!s.profile.flags.has('event_seen:tutorial.captain_quarters'), '§D/A 教学未下船长室');

  const a1 = revisitQualZone(s, REVISIT_PICKS); s = a1.state;
  assert(a1.pinned === 'tutorial.captain_revisit', `§D/A 重访#1 钉放 captain_revisit（实际 ${a1.pinned}）`);
  assert(a1.seen.includes('tutorial.captain_revisit'), `§D/A 重访#1 玩家**真遇到** captain_revisit（实际途中 story=[${a1.seen.join(',')}]·若空＝被早层上浮口挡住没导航到）`);
  assert(a1.seen.includes('tutorial.captain_quarters'), '§D/A 重访#1 下去后进了船长室（grab_log）');
  assert(s.profile.flags.has('event_seen:tutorial.captain_quarters'), '§D/A grab_log 写 event_seen:captain_quarters（门键）');
  assert(!s.profile.flags.has('flag.seen_first_uncanny'), '§D/A grab_log 不置 seen_first_uncanny（正是旧门失灵处·门已不依赖它）');

  const a2 = revisitQualZone(s, REVISIT_PICKS); s = a2.state;
  assert(a2.pinned === 'tutorial.captain_revisit_empty', `§D/A 重访#2 钉放 _empty（旧 bug 回 ${a2.pinned}）`);
  assert(a2.seen.includes('tutorial.captain_revisit_empty'), `§D/A 重访#2 玩家**真遇到** _empty（"第二次去"·旧 bug 此处什么都没有·实际 story=[${a2.seen.join(',')}]）`);

  const a3 = revisitQualZone(s, REVISIT_PICKS); s = a3.state;
  assert(a3.pinned === null, `§D/A 重访#3 不再钉放（实际 ${a3.pinned}）`);
  assert(!a3.seen.includes('tutorial.captain_revisit') && !a3.seen.includes('tutorial.captain_revisit_empty'), '§D/A 重访#3 普通下潜·无重访剧情');
  L('  场景A：教学上浮 → 重访#1 真遇 revisit→grab_log → 重访#2 真遇 _empty → 重访#3 普通 ✓');

  // —— 场景 C：教学就下到船长室抓日志走（grab_log·旧 bug 触发路径）→ 重访#1 直接遇到 _empty ——
  Math.random = makeLcg(20260627); // 同上·场景独立可复现
  const outC = driveTutorialToSurface(freshRun(), { 'tutorial.prologue': 'dive_in', 'tutorial.descent': 'continue', 'tutorial.wreck_approach': 'press_on', 'tutorial.wreck': 'stealth_grab', 'tutorial.deeper': 'go_deeper', 'tutorial.captain_quarters': 'grab_log' });
  let sc = surfaceAndReturn(outC.state).state;
  assert(sc.profile.flags.has('event_seen:tutorial.captain_quarters'), '§D/C 教学经 grab_log 进过船长室');
  assert(!sc.profile.flags.has('flag.seen_first_uncanny'), '§D/C grab_log 教学路径同样不置 seen_first_uncanny');
  const c1 = revisitQualZone(sc, REVISIT_PICKS); sc = c1.state;
  assert(c1.pinned === 'tutorial.captain_revisit_empty', `§D/C 重访#1 钉放 _empty（教学已下船长室·实际 ${c1.pinned}）`);
  assert(c1.seen.includes('tutorial.captain_revisit_empty'), `§D/C 重访#1 玩家**真遇到** _empty（实际 story=[${c1.seen.join(',')}]）`);
  assert(!c1.seen.includes('tutorial.captain_revisit'), '§D/C 重访#1 不再误放"你上次没有下去"的 captain_revisit（旧 bug：grab_log 没置 flag→错放 revisit）');
  const c2 = revisitQualZone(sc, REVISIT_PICKS); sc = c2.state;
  assert(c2.pinned === null && !c2.seen.includes('tutorial.captain_revisit_empty'), '§D/C 重访#2 普通下潜');
  L('  场景C：教学 grab_log 进船长室 → 重访#1 真遇 _empty → 重访#2 普通 ✓');
}

console.log('playthrough-tutorial-e2e ✓ — §0 起点 / §A 上浮 / §B 逃跑 / §C 船长日志 → tutorial_complete / §D 导航式重访：A 真遇 revisit→_empty→普通·C 真遇 _empty→普通（#189）');
