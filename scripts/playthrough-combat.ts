// 战斗系统专项 playthrough：
// 1. 走教学关到沉船事件
// 2. 选 "engage" 进入战斗
// 3. 用潜水刀对鲨鱼一通砍直到胜利
// 4. 验证战斗后跳回 tutorial.deeper 事件链
// 5. 「flee/scare 不掉料」硬门（#244）：跑两个结局场景断言 lootGained 为空
//    （scenario 套件的 expect.lootGained 只能断「至少有」·断「没有」收口在这里）

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createInitialGameState } from '../src/engine/state';
import { getDialogNode, getNpc, selectChoice } from '../src/engine/dialog';
import { resolveOption } from '../src/engine/events';
import { getEventById } from '../src/engine/zones';
import { listAvailableActions } from '../src/engine/combat';
import { runCombatScenario, type CombatScenarioInput } from '../src/engine/combatScenario';
import { makeLcg } from '../src/engine/rng';
import type { GameState, DialogNode } from '../src/types';

// 种子化焊死 flaky（quirk #129 同源）：教学事件检定 + 战斗命中/敌 AI 都走 Math.random → 定死随机变确定性。
// golden seed 落「潜行过检 → 鲨鱼战 victory → tutorial.deeper」路径；PT_SEED=<n> 可临时换种探路。
Math.random = makeLcg(Number(process.env.PT_SEED) || 20260702);

let state: GameState = createInitialGameState();
const log: string[] = [];

function snap(label: string) {
  if (state.run) {
    log.push(
      `  [${label}] phase=${state.phase.kind} depth=${state.run.currentDepth}m ` +
        `O2=${state.run.stats.oxygen.toFixed(1)} N2=${state.run.stats.nitrogen.toFixed(1)} ` +
        `San=${state.run.stats.sanity.toFixed(0)} HP=${state.run.stats.stamina.toFixed(0)}`,
    );
  } else {
    log.push(`  [${label}] phase=${state.phase.kind}`);
  }
}

// 走对话到出海
function walkDialogTo(npcId: string, picks: Record<string, string>) {
  const npc = getNpc(npcId)!;
  let node: DialogNode | null = getDialogNode(npc.dialogRoot.id)!;
  let safety = 0;
  while (node && safety++ < 20) {
    const choice = node.choices?.find((c) => c.id === picks[node!.id]);
    if (!choice) break;
    log.push(`dialog ${node.id} → ${choice.label}`);
    const result = selectChoice(state, node, choice);
    state = result.state;
    if (state.phase.kind !== 'port') break;
    node = result.next;
  }
}

walkDialogTo('npc.aldo', {
  'aldo.root': 'ready',
  'aldo.briefing': 'depart_east',
});
snap('after-startDive');

// 走教学事件链直到 wreck，然后选 engage。
// 教学关 node 化（#221+/#222）：descent→wreck_approach 已是**节点边界**（非 triggerEventId·靠走到下一节点）；本测只为测鲨鱼战斗，
// 直接从 wreck_approach 入口起（wreck_approach→wreck 是节点内 triggerEventId 链·仍连）⇒ wreck_approach→press_on→wreck→engage→combat。
function runEvent(id: string, optionId: string): string {
  const ev = getEventById(id)!;
  log.push(`event ${ev.id} → ${ev.options.find((o) => o.id === optionId)?.label}`);
  const opt = ev.options.find((o) => o.id === optionId)!;
  const result = resolveOption(state, opt);
  state = result.state;
  for (const line of result.narrative) log.push(`    ${line.split('\n')[0].slice(0, 80)}`);
  if (result.next.kind === 'continueEvent') {
    state = { ...state, phase: { kind: 'dive', subPhase: { kind: 'event', eventId: result.next.eventId } } };
    return result.next.eventId;
  }
  if (result.next.kind === 'startCombat') {
    // EventView 会调用 startCombat
    return '__COMBAT__:' + result.next.combatId;
  }
  if (result.next.kind === 'forceAscend') return '__ASCEND__';
  if (result.next.kind === 'death') return '__DEATH__';
  return '';
}

let ev = 'tutorial.wreck_approach';
while (ev && !ev.startsWith('__')) {
  ev = runEvent(ev, ev === 'tutorial.descent' ? 'continue' : ev === 'tutorial.wreck_approach' ? 'press_on' : ev === 'tutorial.wreck' ? 'engage' : ev === 'tutorial.deeper' ? 'ascend_now' : ev === 'tutorial.captain_quarters' ? 'grab_log' : 'continue');
}
snap('after-tutorial-events');
log.push(`reached: ${ev}`);

// 期望：ev = __COMBAT__:combat.tutorial_shark
if (!ev.startsWith('__COMBAT__:')) throw new Error('应进入战斗，实际: ' + ev);
const combatId = ev.split(':')[1];

// 手动启动战斗（EventView 会做这件事）
import('../src/engine/combat').then(async (mod) => {
  state = mod.startCombat(state, combatId);
  snap('combat-start');
  if (state.phase.kind !== 'combat') throw new Error('startCombat 后应在战斗中');
  log.push(`战斗：${combatId}，敌人 ${state.phase.combat.enemies.map((e) => mod.getEnemyDef(e.defId)?.name).join(', ')}`);

  // 战斗循环：潜水刀砍砍砍到胜利（低血闪避保命）
  let round = 0;
  let outcome: string = 'continue';
  while (outcome === 'continue' && round++ < 20) {
    log.push(`\n--- round ${round} ---`);
    const avail = listAvailableActions(state).filter((a) => a.availability.available);
    log.push(`可用：${avail.map((a) => a.action.name).join(', ')}`);
    // 策略：低血闪避保命；其余回合潜水刀挥砍
    let actionId: string;
    const hp = state.run?.stats.stamina ?? 100;
    if (hp <= 50 && round > 2) actionId = 'action.evade';
    else actionId = 'action.knife_slash';

    if (!avail.find((a) => a.action.id === actionId)) {
      // 退化为可用的第一个
      actionId = avail[0]?.action.id;
    }
    if (!actionId) {
      log.push('没有可用行动了');
      break;
    }

    const target = state.phase.kind === 'combat'
      ? state.phase.combat.enemies.find((e) => e.hp > 0)?.instanceId
      : undefined;
    const result = mod.applyPlayerAction(state, actionId, target);
    state = result.state;
    outcome = result.outcome;

    // 取最近的几条战斗日志
    if (state.phase.kind === 'combat') {
      const c = state.phase.combat;
      const recent = c.log.slice(-3);
      for (const l of recent) log.push(`    [${l.actor}] ${l.text}`);
      const enemyHp = c.enemies.map((e) => `${mod.getEnemyDef(e.defId)?.name}=${e.hp}HP/${e.stance}`).join(', ');
      log.push(`    敌人：${enemyHp}`);
    }
    snap(`r${round}`);
  }

  log.push(`\n战斗结果: ${outcome}`);
  log.push(`最终 phase: ${state.phase.kind}`);
  if (state.phase.kind === 'dive') {
    log.push(`subPhase: ${(state.phase as any).subPhase.kind}`);
    if ((state.phase as any).subPhase.kind === 'event') {
      log.push(`下一事件: ${(state.phase as any).subPhase.eventId}`);
    }
  }
  log.push(`战利品: ${state.run?.inventory.map((i) => `${i.itemId}×${i.qty}`).join(', ')}`);

  // —— 断言（文件头目标 3/4）：胜利收尾 + 跳回 tutorial.deeper 事件链（seeded 确定性·quirk #129）——
  function fail(msg: string): never {
    console.log(log.join('\n'));
    throw new Error(`[playthrough-combat] ${msg}`);
  }
  if (outcome !== 'victory') fail(`战斗应以 victory 收（实际 ${outcome}）`);
  if (state.phase.kind !== 'dive' || state.phase.subPhase.kind !== 'event') {
    fail(`战斗后应回 dive/event（实际 ${state.phase.kind}${state.phase.kind === 'dive' ? '/' + state.phase.subPhase.kind : ''}）`);
  }
  if (state.phase.subPhase.eventId !== 'tutorial.deeper') {
    fail(`战斗后应跳 tutorial.deeper（实际 ${state.phase.subPhase.eventId}）`);
  }

  // —— 「flee/scare 不掉料」硬门（#244·文件头目标 5）——
  // 直接跑黄金套件里两个结局场景（同一份 JSON·单一场景来源），断言战利品为空：
  // flee＝finalizeFlee 从不结算 loot；scare＝敌人自行离场（fledInstanceIds）被 finalizeVictory 跳过。
  const scenarioDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'scenarios', 'combat');
  for (const [file, wantOutcome] of [
    ['tutorial_shark__flee_no_loot.json', 'flee'],
    ['wreck_spider_crab_solo__scare_no_loot.json', 'victory'],
  ] as const) {
    const raw = JSON.parse(readFileSync(resolve(scenarioDir, file), 'utf8')) as Record<string, unknown>;
    const { _comment, expect, ...input } = raw;
    void _comment; void expect;
    const r = runCombatScenario(input as CombatScenarioInput);
    if (r.summary.outcome !== wantOutcome) fail(`${file}: outcome 应 ${wantOutcome}（实际 ${r.summary.outcome}）`);
    if (r.summary.lootGained.length !== 0) {
      fail(`${file}: flee/scare 结局不该有任何战利品（#244·实际 ${r.summary.lootGained.map((l) => `${l.itemId}×${l.qty}`).join(', ')}）`);
    }
  }
  log.push('flee/scare 零战利品门 ✓');

  console.log(log.join('\n'));
  console.log('\n✓ 战斗 playthrough 完成');
});
