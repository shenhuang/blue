// 真·端到端 playthrough 测试 —— 用项目自身的引擎模块
// 跑法： npx tsx scripts/playthrough.ts

import { createInitialGameState, createNewRun, mergeIntoInventory, HOME_LIGHTHOUSE_ID } from '../src/engine/state';
import {
  getDialogNode,
  getNpc,
  selectChoice,
} from '../src/engine/dialog';
import {
  resolveOption,
  isOptionVisible,
  evalCondition,
} from '../src/engine/events';
import { getEventById } from '../src/engine/zones';
import {
  moveToNode,
  enterNodeSelection,
  startDiveFromPoi,
} from '../src/engine/dive';
import { generateChart, poiLockReason } from '../src/engine/chart';
import { planAscent, executeAscent } from '../src/engine/ascent';
import { buildAtLighthouse } from '../src/engine/lighthouses';
import { eventDoneFlag, pickReturnTrigger } from '../src/engine/portEvents';
import { CH1_HOOK_FLAG, ch1Story } from '../src/engine/story';
import { handleReturnToPort } from '../src/engine/port';
import type { GameState, DialogNode, DiveEvent, NodeChoice } from '../src/types';
import { makeLcg } from '../src/engine/rng';

// ── 焊死 flaky（quirk #129）─────────────────────────────────────────────────
// 本脚本走「真引擎」端到端：教学关含潜行检定（events.ts::performCheck → Math.random），
// RUN 2 又走随机图（mapgen）。不种子化时 ~7% 检定失败 → 分支偏离上浮路径 →
// 「应在上浮，实际 dive」偶发抛（旧 #18/#22「~12% flake」一直靠 runner 重试 2 次盖着，
// 见 quirk #129）。用 eventScenario.ts::withSeededRandom 同一份 LCG（src/engine/rng.ts）
// 全程定死随机：整条 playthrough 变确定性，golden seed 已验证落在「潜行成功 → 上浮」happy
// path。内容改动若让该 seed 落到失败分支，regress 会**确定性**变红（而非 flaky）→ 调
// PLAYTHROUGH_SEED 重选即可。调试：PT_SEED=<n> npx tsx scripts/playthrough.ts 临时换种子。
const PLAYTHROUGH_SEED = Number(process.env.PT_SEED) || 20260622;
Math.random = makeLcg(PLAYTHROUGH_SEED);

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
      return evalCondition(state, c.visibleIf);
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

// 教学事件链 —— node-aware 导航（#222 教学 node 化：descent→wreck_approach / wreck→deeper 是**节点边界**·
// 事件链尾不再 triggerEventId 续接·须像玩家一样落 node-select 逐节点前进·见 quirk #191 +
// playthrough-tutorial-e2e §D 同款驱动。旧版纯事件链 walk 走到节点边界即停 → 卡 dive 到不了 forceAscend）。
const tutorialPick = (ev: DiveEvent): string => {
  if (ev.id === 'tutorial.prologue') return 'dive_in'; // St0 开场钩「半本日志」（#115）
  if (ev.id === 'tutorial.descent') return 'continue';
  if (ev.id === 'tutorial.wreck_approach') return 'press_on';
  if (ev.id === 'tutorial.wreck') return 'stealth_grab'; // 走潜行成功路径（不进战斗）
  if (ev.id === 'tutorial.deeper') return 'go_deeper';
  if (ev.id === 'tutorial.captain_quarters') return 'grab_log';
  return ev.options[0].id;
};
let navGuard = 0;
while (state.phase.kind === 'dive' && navGuard++ < 40) {
  const sub = (state.phase as any).subPhase;
  if (sub.kind === 'event') {
    const ret = runEvent(sub.eventId, tutorialPick);
    if (ret === '__FORCE_ASCEND__' || ret === '__DEATH__') break;
    if (ret === '__COMBAT__') { state = enterNodeSelection(state); continue; }
    // 非空非'__' = continueEvent（runEvent 已把 phase 设到下一事件·节点内 triggerEventId 链）→ 继续处理；
    // '' = 事件链尾（remainOnEvent / 无后续）→ 落 node-select 前进到下一节点（这正是旧 walk 漏掉的一步）。
    if (!ret) state = enterNodeSelection(state);
    continue;
  }
  if (sub.kind === 'nodeSelect') {
    const choices: NodeChoice[] = sub.choices ?? [];
    const forward = choices.filter((c) => !c.isAscentPoint);
    const target = forward[0] ?? choices[0];
    if (!target) { state = { ...state, phase: { kind: 'ascent', targetDepth: 0 } }; break; }
    log.push(`节点前进: ${target.depth}m "${target.preview}"`);
    state = moveToNode(state, target.nodeId);
    continue;
  }
  // rest/其它子相位：继续下潜（最深死端 enterNodeSelection 自然转 ascent）。
  state = state.run?.map ? enterNodeSelection(state) : { ...state, phase: { kind: 'ascent', targetDepth: 0 } };
}
pretty(`after-events (${state.phase.kind})`);

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
log.push(`结算: 深度=${out1.maxDepthReached}m 金币+${out1.goldEarned} 战利品=${out1.loot.length} 件`);
if (out1.loot.length > 0) {
  log.push(`战利品: ${out1.loot.map((l: any) => `${l.itemId}×${l.qty}`).join(', ')}`);
}

// 模拟"回到港口"按钮：handleReturnToPort 合并 inventory + 检剧情物
const returnResult = handleReturnToPort(state);
state = returnResult.state;
const trigger = returnResult.cutsceneEventId;
if (!trigger) throw new Error('教学跑完应带回 captain_log → 自动触发 tutorial.ending_log');
log.push(`\n========== 港口 cutscene ==========`);
log.push(`回港触发：${trigger}`);

// captain_log 必须已经搬进 profile.inventory（不能像旧版那样直接丢）
const captainLog = state.profile.inventory.find((i) => i.itemId === 'item.captain_log');
if (!captainLog || captainLog.qty < 1) {
  throw new Error('handleReturnToPort 应把 captain_log 合并到 profile.inventory');
}

// 走 cutscene 的唯一选项（close_book）
const endingEv = getEventById(trigger)!;
const closeOpt = endingEv.options[0];
log.push(`  → ${closeOpt.label}`);
{
  const result = resolveOption(state, closeOpt);
  state = result.state;
  for (const line of result.narrative) log.push(`     ${line.split('\n')[0].slice(0, 80)}`);
}
// 模拟 PortEventView.finalize：写入 event_done flag、null run、回 port
state = {
  ...state,
  profile: {
    ...state.profile,
    flags: new Set([...state.profile.flags, eventDoneFlag(trigger)]),
  },
  run: null,
  phase: { kind: 'port' },
};

// 关键断言：flag.tutorial_complete 必须从 cutscene 自然产生（不是脚本硬塞）
if (!state.profile.flags.has('flag.tutorial_complete')) {
  throw new Error('close_book 应让 flag.tutorial_complete 落到 profile.flags');
}
if (!state.profile.loreEntries.has('lore.ch1.captains_page')) {
  throw new Error('close_book 应解锁 lore.ch1.captains_page（旧 lore.father_first_entry 已随 canon 改名·#115）');
}
// St0 剧情脊柱：开场钩 flag 经 setProfileFlags 在 dive 中持久落 profile，回港后仍在；
// ch1Story 派生应读到 hooked + tutorialComplete（engine/story.ts 单一来源）。
if (!state.profile.flags.has(CH1_HOOK_FLAG)) {
  throw new Error('教学关跑完 profile.flags 应有 story.ch1.hook（prologue setProfileFlags）');
}
{
  const st = ch1Story(state.profile);
  if (!st.hooked || !st.tutorialComplete || st.nextAnchor !== 'reef') {
    throw new Error('ch1Story 派生应为 hooked+tutorialComplete+nextAnchor=reef，实际 ' + JSON.stringify(st));
  }
}
// 二次触发要被吃掉（防 cutscene 重播）：构造一个新 run 把日志再塞回去
const fakeState: GameState = {
  ...state,
  run: {
    ...createNewRun({ zoneId: 'zone.east_reef' }),
    inventory: [{ itemId: 'item.captain_log', qty: 1 }],
  },
};
const trigger2 = pickReturnTrigger(fakeState);
if (trigger2 !== null) {
  throw new Error('event_done 标记已写入，再次回港不应重复触发，但拿到了 ' + trigger2);
}
log.push(`flag.tutorial_complete ✓ / lore.ch1.captains_page ✓ / story.ch1.hook ✓ / 重播被防住 ✓`);

// ========== 港口修缮：买下船坞 Lv.1 解锁旧灯塔礁 ==========
// 船坞 Lv.1 账单 = scrap_alloy×3, old_fishing_net×3 ＋ 20 金（基建地图 Phase A·coral→scrap·经济 2026-06-28）。
// 教学关带不回这么多料，脚本里直接补足材料 + 金币以测试购买流程。
state = {
  ...state,
  profile: {
    ...state.profile,
    inventory: mergeIntoInventory(state.profile.inventory, [
      { itemId: 'item.scrap_alloy', qty: 3 },
      { itemId: 'item.old_fishing_net', qty: 3 },
    ]),
    bankedGold: Math.max(state.profile.bankedGold, 20),
  },
};
log.push(`\n========== 港口修缮（建家灯塔船坞） ==========`);
log.push(`修缮前: 银行 ${state.profile.bankedGold} 金 / 仓库 ${state.profile.inventory.map((i) => `${i.itemId}×${i.qty}`).join(', ')}`);
// dockyard 已迁成家灯塔「船坞」设施（Phase C）：走 buildAtLighthouse 而非 purchaseUpgrade。
state = buildAtLighthouse(state, HOME_LIGHTHOUSE_ID, 'lighthouse.dockyard.lv1');
const homeLh = state.profile.lighthouses.find((l) => l.id === HOME_LIGHTHOUSE_ID)!;
log.push(`修缮后: 银行 ${state.profile.bankedGold} 金, home.builtUpgrades=[${[...homeLh.builtUpgrades].join(',')}]`);
if (!homeLh.builtUpgrades.has('lighthouse.dockyard.lv1')) {
  throw new Error('船坞 Lv.1（家灯塔设施）应在建造后入账');
}

// ========== Run 2: 随机图旧灯塔礁 ==========
log.push('\n========== RUN 2: 旧灯塔礁（随机图） ==========');
pretty('init-run2');

// RUN 2 出海：Aldo briefing 不再直接列 zone，而是「摊开海图」(open_chart → phase chart)，
// 再在海图上选旧灯塔礁 anchor POI（dockyard.lv1 已购 → 可出海）。
walkConvo('npc.aldo', (nodeId, visible) => {
  if (nodeId === 'aldo.root') return 'ready';
  if (nodeId === 'aldo.briefing') {
    const chart = visible.find((v) => v.id === 'open_chart');
    if (!chart) throw new Error('教学完成后应见 open_chart，实际: ' + visible.map((v) => v.id).join(','));
    return 'open_chart';
  }
  return visible[0].id;
});
if (state.phase.kind !== 'chart') {
  throw new Error('open_chart 应切到 chart phase，实际 ' + state.phase.kind);
}
const chart = generateChart({ profile: state.profile });
const lhPoi = chart.pois.find((p) => p.zoneId === 'zone.old_lighthouse_reef' && p.persistent);
if (!lhPoi) throw new Error('海图应含旧灯塔礁 anchor POI');
const lhLock = poiLockReason(state.profile, lhPoi);
if (lhLock) throw new Error('买了船坞 Lv.1 后旧灯塔礁应可出海，但被锁：' + lhLock);
log.push(`海图选点：${lhPoi.name} → ${lhPoi.zoneId}（距离 ${lhPoi.distance}）`);
state = startDiveFromPoi(state, lhPoi);
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
    log.push(`结算: 深度=${out2.maxDepthReached}m 金币+${out2.goldEarned} 战利品=${out2.loot.length} 件`);
    if (out2.cause) log.push(`后果: ${out2.cause}`);
  }
} else if (state.phase.kind === 'gameOver') {
  log.push(`game over: ${(state.phase as any).reason}`);
}

console.log(log.join('\n'));
console.log('\n✓ playthrough 完成');
console.log(`profile.flags: ${[...state.profile.flags].join(', ')}`);
console.log(`profile.bankedGold: ${state.profile.bankedGold} / 仓库 ${state.profile.inventory.length} 项`);
