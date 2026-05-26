// 真·端到端 playthrough 测试 —— 用项目自身的引擎模块
// 跑法： npx tsx scripts/playthrough.ts

import { createInitialGameState } from '../src/engine/state';
import {
  getDialogNode,
  getNpc,
  selectChoice,
} from '../src/engine/dialog';
import {
  resolveOption,
  isOptionVisible,
} from '../src/engine/events';
import { getEventById } from '../src/engine/zones';
import {
  moveToNode,
  enterNodeSelection,
} from '../src/engine/dive';
import { planAscent, executeAscent } from '../src/engine/ascent';
import type { GameState, DialogNode, DiveEvent } from '../src/types';

let state: GameState = createInitialGameState();
const log: string[] = [];

function pretty(label: string) {
  if (state.run) {
    log.push(
      `  [${label}] phase=${state.phase.kind} depth=${state.run.currentDepth}m ` +
        `O2=${state.run.stats.oxygen.toFixed(1)} N2=${state.run.stats.nitrogen.toFixed(1)} ` +
        `San=${state.run.stats.sanity.toFixed(0)} HP=${state.run.stats.stamina.toFixed(0)} ` +
        `turn=${state.run.turn}`,
    );
  } else {
    log.push(`  [${label}] phase=${state.phase.kind} (no run)`);
  }
}

/** 把一个 NPC 对话从 root 完整走完 / 直到 startDive 切换 phase。每个节点用 chooseFn 决定下一步 */
function walkConvo(
  npcId: string,
  chooseFn: (nodeId: string, visible: { id: string; label: string }[]) => string,
) {
  const npc = getNpc(npcId)!;
  let node: DialogNode | null = getDialogNode(npc.dialogRoot.id)!;
  let safety = 0;
  while (node && safety++ < 20) {
    log.push(`dialog:${node.id}`);
    const visible = (node.choices ?? []).filter((c) => {
      if (!c.visibleIf) return true;
      if (c.visibleIf.kind === 'hasFlag') return state.profile.flags.has(c.visibleIf.flag);
      if (c.visibleIf.kind === 'notHasFlag') return !state.profile.flags.has(c.visibleIf.flag);
      return true;
    });
    if (visible.length === 0) break;
    const targetId = chooseFn(
      node.id,
      visible.map((c) => ({ id: c.id, label: c.label })),
    );
    const choice = node.choices!.find((c) => c.id === targetId);
    if (!choice) {
      log.push(`  ⚠ choice ${targetId} not found, breaking`);
      break;
    }
    log.push(`  → ${choice.label}`);
    const result = selectChoice(state, node, choice);
    state = result.state;
    if (state.phase.kind !== 'port') {
      log.push(`  ✱ 对话触发 phase=${state.phase.kind}`);
      break;
    }
    node = result.next;
  }
}

function runEvent(eventId: string, pickFn: (ev: DiveEvent) => string): string {
  const ev = getEventById(eventId)!;
  log.push(`event:${ev.id} [${ev.title}]`);
  const visible = ev.options.filter((o) => isOptionVisible(state, o));
  const targetId = pickFn(ev);
  const opt = visible.find((o) => o.id === targetId) ?? visible[0];
  log.push(`  → ${opt.label}`);
  const result = resolveOption(state, opt);
  state = result.state;
  for (const line of result.narrative) log.push(`     ${line.split('\n')[0].slice(0, 80)}`);

  switch (result.next.kind) {
    case 'continueEvent':
      state = { ...state, phase: { kind: 'dive', subPhase: { kind: 'event', eventId: result.next.eventId } } };
      return result.next.eventId;
    case 'forceAscend':
      state = { ...state, phase: { kind: 'ascent', targetDepth: 0 } };
      return '__FORCE_ASCEND__';
    case 'startCombat':
      log.push(`     ⚔ combat ${result.next.combatId}（占位）`);
      return '__COMBAT__';
    case 'death':
      state = { ...state, phase: { kind: 'gameOver', reason: 'event death' } };
      return '__DEATH__';
    case 'remainOnEvent':
      return '';
  }
  return '';
}

// ========== Run 1: 教学关 ==========
log.push('\n========== RUN 1: 教学关（东礁） ==========');
pretty('init');

walkConvo('npc.aldo', (nodeId, visible) => {
  if (nodeId === 'aldo.root') return 'ready';
  if (nodeId === 'aldo.briefing') {
    const east = visible.find((v) => v.id === 'depart_east');
    if (!east) throw new Error('教学前应见 depart_east，实际: ' + visible.map((v) => v.id).join(','));
    return 'depart_east';
  }
  return visible[0].id;
});
pretty('after-startDive');

if (state.phase.kind !== 'dive') throw new Error('应进入 dive，实际 ' + state.phase.kind);
log.push(`zone=${state.run!.zoneId}`);

// 教学事件链
let nextEv: string = (state.phase as any).subPhase.eventId;
while (nextEv && !nextEv.startsWith('__')) {
  const id: string = nextEv;
  nextEv = runEvent(id, (ev) => {
    if (ev.id === 'tutorial.descent') return 'continue';
    if (ev.id === 'tutorial.grouper') return 'sneak';
    if (ev.id === 'tutorial.wreck') return 'stealth_grab'; // 走潜行成功路径
    if (ev.id === 'tutorial.deeper') return 'go_deeper';
    if (ev.id === 'tutorial.captain_quarters') return 'grab_log';
    return ev.options[0].id;
  });
}
pretty(`after-events (${nextEv})`);

if (state.phase.kind !== 'ascent') throw new Error('应在上浮，实际 ' + state.phase.kind);
const plan = planAscent(state.run!);
log.push(`ascent plan: stops=${plan.stops}, normal=${plan.normalTurns}, rushed=${plan.rushedTurns} turns`);

const ascentResult = executeAscent(state, 'normal');
state = ascentResult.state;
log.push(`  → 正常上浮，减压病 ${ascentResult.bendsType}`);
for (const l of ascentResult.narrative) log.push(`     ${l.split('\n')[0].slice(0, 80)}`);
pretty('after-ascent');

if (state.phase.kind !== 'resolution') throw new Error('上浮后应 resolution，实际 ' + state.phase.kind);
const out1 = (state.phase as any).outcome;
log.push(`结算: 深度=${out1.maxDepthReached}m 建设值+${out1.buildingPointsEarned} 战利品=${out1.loot.length} 件`);
if (out1.loot.length > 0) {
  log.push(`战利品: ${out1.loot.map((l: any) => `${l.itemId}×${l.qty}`).join(', ')}`);
}

// 模拟读完日志后回港 + 设置 flag
state = {
  ...state,
  profile: { ...state.profile, flags: new Set([...state.profile.flags, 'flag.tutorial_complete']) },
  run: null,
  phase: { kind: 'port' },
};

// ========== Run 2: 随机图旧灯塔礁 ==========
log.push('\n========== RUN 2: 旧灯塔礁（随机图） ==========');
pretty('init-run2');

walkConvo('npc.aldo', (nodeId, visible) => {
  if (nodeId === 'aldo.root') return 'ready';
  if (nodeId === 'aldo.briefing') {
    const lh = visible.find((v) => v.id === 'depart_lighthouse');
    if (!lh) throw new Error('教学完成后应见 depart_lighthouse，实际: ' + visible.map((v) => v.id).join(','));
    return 'depart_lighthouse';
  }
  return visible[0].id;
});
pretty('after-startDive-lighthouse');

if (!state.run?.map) throw new Error('旧灯塔礁应生成 DiveMap');
log.push(`生成节点图：${Object.keys(state.run.map.nodes).length} 节点 / ${state.run.zoneId}`);

// 走图
let safety = 0;
while (state.phase.kind === 'dive' && safety++ < 30) {
  const sub = (state.phase as any).subPhase;
  if (sub.kind === 'event') {
    const ret = runEvent(sub.eventId, (ev) => ev.options[0].id);
    if (ret === '__COMBAT__') {
      state = enterNodeSelection(state);
      continue;
    }
    if (ret === '__FORCE_ASCEND__') break;
    if (ret.startsWith('__')) break;
    if (state.phase.kind === 'dive' && (state.phase as any).subPhase.kind === 'event') {
      state = enterNodeSelection(state);
    }
  } else if (sub.kind === 'nodeSelect') {
    const choices = sub.choices;
    if (choices.length === 0) break;
    const pick = choices[0];
    log.push(`节点选择 (${choices.length} 个): 选 ${pick.depth}m "${pick.preview}"${pick.isAscentPoint ? ' (上浮口)' : ''}`);
    state = moveToNode(state, pick.nodeId);
    pretty('after-move');
  } else if (sub.kind === 'rest') {
    log.push('  rest 节点：直接继续');
    state = enterNodeSelection(state);
  } else {
    break;
  }
}

log.push(`最终 phase=${state.phase.kind}`);

if (state.phase.kind === 'ascent') {
  const plan2 = planAscent(state.run!);
  log.push(`第二次上浮 plan: stops=${plan2.stops}, normal=${plan2.normalTurns}, rushed=${plan2.rushedTurns}`);

  const ascR = executeAscent(state, 'rushed');
  state = ascR.state;
  log.push(`  → 强行上浮，减压病 ${ascR.bendsType}`);
  for (const l of ascR.narrative) log.push(`     ${l.split('\n')[0].slice(0, 80)}`);
  pretty('after-rushed-ascent');

  if (state.phase.kind === 'resolution') {
    const out2 = (state.phase as any).outcome;
    log.push(`结算: 深度=${out2.maxDepthReached}m 建设值+${out2.buildingPointsEarned} 战利品=${out2.loot.length} 件`);
    if (out2.cause) log.push(`后果: ${out2.cause}`);
  }
} else if (state.phase.kind === 'gameOver') {
  log.push(`game over: ${(state.phase as any).reason}`);
}

console.log(log.join('\n'));
console.log('\n✓ playthrough 完成');
console.log(`profile.flags: ${[...state.profile.flags].join(', ')}`);
console.log(`profile.buildingPoints: ${state.profile.buildingPoints}`);
