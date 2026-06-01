// 蓝洞群手动探索 —— 跑多次完整下潜，覆盖不同选择路径。
// 不是 assert-style 单元测试，是"我来当玩家试 N 局，看引擎有没有死角"。
//
// 跑法： npx tsx scripts/explore-bluecaves.ts

import { createInitialGameState, createNewRun } from '../src/engine/state';
import { generateDiveMap } from '../src/engine/mapgen';
import {
  resolveOption,
  isOptionVisible,
} from '../src/engine/events';
import { getEventById, getZone } from '../src/engine/zones';
import {
  moveToNode,
  enterNodeSelection,
} from '../src/engine/dive';
import { planAscent, executeAscent, isAscentBlocked } from '../src/engine/ascent';
import {
  startCombat,
  applyPlayerAction,
  listAvailableActions,
  getEnemyDef,
} from '../src/engine/combat';
import { handleReturnToPort, sellItemToMira } from '../src/engine/port';
import type { GameState, DiveEvent, EventOption } from '../src/types';

// —— Seeded RNG，让每局可复现 ——
function makeRng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

// 选择策略：根据 strategy + rng 决定事件选项 / 战斗动作 / 上浮模式
type Strategy = 'greedy' | 'cautious' | 'reckless';

interface RunReport {
  seed: number;
  strategy: Strategy;
  eventIds: string[];
  combatCount: number;
  bends: number;
  finalPhase: string;
  cause?: string;
  loot: Array<{ id: string; qty: number }>;
  deepestDepth: number;
  errors: string[];
}

function pickEventOption(
  ev: DiveEvent,
  visible: EventOption[],
  strategy: Strategy,
  rng: () => number,
): EventOption {
  if (visible.length === 0) return ev.options[0];
  if (visible.length === 1) return visible[0];

  // 不同策略给不同偏好
  if (strategy === 'cautious') {
    // 优先选不带 check 的安全选项，再优先纯 outcome 的"绕开/退开"类
    const safe = visible.find(
      (o) => !o.check && /绕|退|不|算了|skip|leave|背|ignore|continue/i.test(o.label),
    );
    if (safe) return safe;
    const nonCheck = visible.find((o) => !o.check);
    if (nonCheck) return nonCheck;
    return visible[visible.length - 1];
  }
  if (strategy === 'reckless') {
    // 优先选检定项 / 战斗 / 看一眼
    const risky = visible.find((o) => o.check || /冲|抓|拿|进入|看|approach|fight|engage|grab/i.test(o.label));
    if (risky) return risky;
    return visible[0];
  }
  // greedy = 拿东西，但不主动战斗
  const loot = visible.find((o) => /拿|捡|割|刀|grab|pick|salvage/i.test(o.label));
  if (loot) return loot;
  const fight = visible.find((o) => /战斗|engage|fight|刀/.test(o.label));
  if (fight) return fight;
  return visible[Math.floor(rng() * visible.length)];
}

function runOneDive(seed: number, strategy: Strategy): RunReport {
  const rng = makeRng(seed);
  const report: RunReport = {
    seed,
    strategy,
    eventIds: [],
    combatCount: 0,
    bends: 0,
    finalPhase: '',
    loot: [],
    deepestDepth: 0,
    errors: [],
  };

  try {
    // 港口初始 state，跳过教学，直接打开蓝洞
    let state: GameState = createInitialGameState();
    state = {
      ...state,
      profile: {
        ...state.profile,
        flags: new Set(['flag.tutorial_complete']),
      },
      run: createNewRun({ zoneId: 'zone.blue_caves' }),
    };
    const zone = getZone('zone.blue_caves')!;
    const map = generateDiveMap({
      zone,
      profileFlags: state.profile.flags,
      deaths: [],
      rng,
    });
    state = {
      ...state,
      run: {
        ...state.run!,
        map,
        currentNodeId: map.startNodeId,
        currentDepth: map.nodes[map.startNodeId].depth,
        visitedNodeIds: [map.startNodeId],
      },
      phase:
        map.nodes[map.startNodeId].kind === 'event' && map.nodes[map.startNodeId].eventId
          ? { kind: 'dive', subPhase: { kind: 'event', eventId: map.nodes[map.startNodeId].eventId! } }
          : { kind: 'dive', subPhase: { kind: 'nodeSelect', choices: [] } },
    };
    if (state.phase.kind === 'dive' && state.phase.subPhase.kind === 'nodeSelect') {
      state = enterNodeSelection(state);
    }

    let safety = 0;
    // 迷路图没有"图到尽头自动上浮"——玩家要么找到上浮口主动上浮，要么氧气见底。
    // 上限放宽到 250：保证最坏情况下也是氧气耗尽收尾，而不是被 safety 截断。
    while (safety++ < 250) {
      report.deepestDepth = Math.max(report.deepestDepth, state.run?.currentDepth ?? 0);

      // —— Phase 处理 ——
      if (state.phase.kind === 'dive') {
        const sub = state.phase.subPhase;
        if (sub.kind === 'event') {
          const ev = getEventById(sub.eventId);
          if (!ev) {
            report.errors.push(`event ${sub.eventId} 未找到`);
            break;
          }
          report.eventIds.push(ev.id);
          const visible = ev.options.filter((o) => isOptionVisible(state, o));
          const opt = pickEventOption(ev, visible, strategy, rng);
          const result = resolveOption(state, opt);
          state = result.state;

          switch (result.next.kind) {
            case 'continueEvent':
              state = {
                ...state,
                phase: { kind: 'dive', subPhase: { kind: 'event', eventId: result.next.eventId } },
              };
              break;
            case 'startCombat':
              state = startCombat(state, result.next.combatId);
              report.combatCount++;
              break;
            case 'forceAscend':
              state = { ...state, phase: { kind: 'ascent', targetDepth: 0 } };
              break;
            case 'death':
              report.cause = '事件结算判定死亡';
              state = { ...state, phase: { kind: 'gameOver', reason: 'event-death' } };
              break;
            case 'remainOnEvent':
              // 当前 event 继续；按事件结束处理回到节点选择
              state = enterNodeSelection(state);
              break;
          }
          continue;
        }
        if (sub.kind === 'nodeSelect') {
          if (sub.choices.length === 0) {
            // mapgen 走到尾，按设计应该 enterNodeSelection 自动转 ascent
            // 但保险起见手动转
            state = { ...state, phase: { kind: 'ascent', targetDepth: 0 } };
            continue;
          }
          // 策略：往深处推（greedy / reckless），cautious 优先 ascent_point
          let pick = sub.choices[0];
          if (strategy === 'cautious') {
            const a = sub.choices.find((c) => c.isAscentPoint);
            if (a) pick = a;
          } else {
            const deeper = sub.choices.filter((c) => c.depth > (state.run?.currentDepth ?? 0));
            if (deeper.length > 0) pick = deeper[Math.floor(rng() * deeper.length)];
          }
          state = moveToNode(state, pick.nodeId);
          continue;
        }
        if (sub.kind === 'rest') {
          // 迷路图：找到上浮口（入口/远端出口都是 ascent_point）就上浮；氧气见底也强行上浮；
          // reckless 偶尔随机上浮（试 block）。否则继续探索。
          const curNode = state.run?.map?.nodes[state.run.currentNodeId ?? ''];
          const atExit = curNode?.kind === 'ascent_point';
          const ox = state.run?.stats.oxygen ?? 0;
          if (atExit || ox < 12 || (strategy === 'reckless' && rng() < 0.3)) {
            state = { ...state, phase: { kind: 'ascent', targetDepth: 0 } };
            continue;
          }
          state = enterNodeSelection(state);
          continue;
        }
        if (sub.kind === 'corpse') {
          // 蓝洞群目前不会自然产生 corpse（profile.deaths 是空的），但保险
          state = enterNodeSelection(state);
          continue;
        }
      }

      if (state.phase.kind === 'combat') {
        // 简单战斗 AI：低血闪避，否则砍
        const hp = state.run?.stats.stamina ?? 100;
        const avail = listAvailableActions(state).filter((a) => a.availability.available);
        let actionId: string | undefined;
        if (hp <= 40) actionId = avail.find((a) => a.action.id === 'action.evade')?.action.id;
        if (!actionId) actionId = avail.find((a) => a.action.id === 'action.knife_slash')?.action.id;
        if (!actionId) actionId = avail.find((a) => a.action.id === 'action.knife_stab')?.action.id;
        if (!actionId) actionId = avail[0]?.action.id;
        if (!actionId) {
          report.errors.push('战斗中没有可用 action');
          break;
        }
        const target = state.phase.combat.enemies.find((e) => e.hp > 0)?.instanceId;
        const r = applyPlayerAction(state, actionId, target);
        state = r.state;
        continue;
      }

      if (state.phase.kind === 'ascent') {
        const blocked = state.run ? isAscentBlocked(state.run) : false;
        const plan = state.run ? planAscent(state.run) : null;
        const ox = state.run?.stats.oxygen ?? 0;
        let mode: 'normal' | 'rushed' | 'emergency' = 'emergency';
        if (blocked) {
          mode = 'emergency'; // 洞里只能凿穿
        } else if (plan && ox >= plan.normalTurns && strategy !== 'reckless') {
          mode = 'normal';
        } else if (plan && ox >= plan.rushedTurns) {
          mode = 'rushed';
        }
        const r = executeAscent(state, mode);
        state = r.state;
        report.bends = r.bendsType;
        continue;
      }

      if (state.phase.kind === 'resolution' || state.phase.kind === 'funeral' || state.phase.kind === 'gameOver') {
        break;
      }

      report.errors.push(`未处理的 phase: ${state.phase.kind}`);
      break;
    }

    if (safety >= 250) report.errors.push('safety 上限触发：循环没收尾');

    report.finalPhase = state.phase.kind;
    if (state.phase.kind === 'resolution') {
      const out = (state.phase as any).outcome;
      report.cause = out.cause ?? (out.survived ? '正常归来' : '未归');
      report.loot = (out.loot ?? []).map((i: any) => ({ id: i.itemId, qty: i.qty }));
    } else if (state.phase.kind === 'funeral') {
      const rec = (state.phase as any).record;
      report.cause = rec.cause;
    }

    // 顺手验证回港 + Mira 收购走通（如果活着）
    if (state.phase.kind === 'resolution' && state.run) {
      const ret = handleReturnToPort(state);
      state = ret.state;
      // 卖光所有可卖项
      let sold = 0;
      for (const item of [...state.profile.inventory]) {
        const before = state.profile.bankedGold;
        state = sellItemToMira(state, item.itemId, item.qty);
        if (state.profile.bankedGold > before) sold += state.profile.bankedGold - before;
      }
      if (sold > 0) {
        // 把卖出 gold 也写进 report（不再需要 sold 变量在外部，但保留信号）
      }
    }
  } catch (e) {
    report.errors.push('异常：' + (e as Error).message);
  }

  return report;
}

// —— Main ——
const log: string[] = [];
const L = (s: string) => log.push(s);

const strategies: Strategy[] = ['greedy', 'cautious', 'reckless'];
const seedsPerStrategy = 10;
const allReports: RunReport[] = [];

for (const strat of strategies) {
  L(`\n========== 策略 ${strat}（${seedsPerStrategy} 局） ==========`);
  for (let seed = 1; seed <= seedsPerStrategy; seed++) {
    const r = runOneDive(seed * 17 + strat.length, strat);
    allReports.push(r);
    const lootStr = r.loot.length > 0 ? r.loot.map((l) => `${l.id.replace('item.', '')}×${l.qty}`).join(',') : '空';
    const errStr = r.errors.length > 0 ? ` ⚠ ${r.errors.join('; ')}` : '';
    L(
      `  seed=${r.seed.toString().padStart(3)} | depth ${r.deepestDepth}m | ` +
        `${r.eventIds.length} 事件 / ${r.combatCount} 战斗 / 减压 ${r.bends} | ` +
        `phase=${r.finalPhase}${r.cause ? ` (${r.cause})` : ''} | loot: ${lootStr}${errStr}`,
    );
  }
}

// —— 汇总 ——
L('\n========== 汇总 ==========');
const total = allReports.length;
const survived = allReports.filter((r) => r.finalPhase === 'resolution').length;
const died = allReports.filter((r) => r.finalPhase === 'funeral' || r.finalPhase === 'gameOver').length;
const withCombat = allReports.filter((r) => r.combatCount > 0).length;
const withErrors = allReports.filter((r) => r.errors.length > 0);
const eventFreq = new Map<string, number>();
for (const r of allReports) for (const e of r.eventIds) eventFreq.set(e, (eventFreq.get(e) ?? 0) + 1);

L(`  总局数: ${total}`);
L(`  幸存: ${survived} / 死亡: ${died}`);
L(`  遭遇战斗的局数: ${withCombat}`);
L(`  事件出现频次（top 12）：`);
const sorted = [...eventFreq.entries()].sort((a, b) => b[1] - a[1]);
for (const [id, n] of sorted.slice(0, 12)) {
  L(`    ${n.toString().padStart(3)}x  ${id}`);
}
L(`  ${eventFreq.size} 个不同事件被触发过`);

if (withErrors.length > 0) {
  L(`\n  ⚠⚠⚠ ${withErrors.length} 局出现错误：`);
  for (const r of withErrors) {
    L(`    seed=${r.seed} (${r.strategy}): ${r.errors.join('; ')}`);
  }
} else {
  L(`\n  ✓ 全部 ${total} 局无未处理状态 / 无异常`);
}

console.log(log.join('\n'));
