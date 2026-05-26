// Dive 引擎：节点移动、回合 tick、上浮判定
// 与 events.ts 解耦：events 负责事件内的 outcome 应用；dive 负责事件间的"地图层"逻辑

import type { GameState, RunState, DiveNode, DiveMap } from '@/types';
import { tickTurns } from './events';
import { generateDiveMap, getNextChoices } from './mapgen';
import { getZone } from './zones';
import { appendLog } from './state';
import { executeDeath } from './death';

/** 在港口选定 zone，开始一次下潜 */
export function startDive(state: GameState, zoneId: string): GameState {
  const zone = getZone(zoneId);
  if (!zone) {
    console.warn(`Zone ${zoneId} not found`);
    return state;
  }
  if (!state.run) {
    console.warn('Cannot startDive without a RunState');
    return state;
  }

  const map = generateDiveMap({
    zone,
    profileFlags: state.profile.flags,
    deaths: state.profile.deaths,
  });

  const run: RunState = {
    ...state.run,
    zoneId,
    map,
    currentNodeId: map.startNodeId,
    currentDepth: map.nodes[map.startNodeId].depth,
    visitedNodeIds: [map.startNodeId],
  };

  const startNode = map.nodes[map.startNodeId];

  // 教学关 / 脚本下潜：直接进入起始事件
  if (zone.generation === 'linearScripted' && startNode.eventId) {
    return {
      ...state,
      run,
      phase: { kind: 'dive', subPhase: { kind: 'event', eventId: startNode.eventId } },
    };
  }

  // 随机下潜：起始节点也是事件类型，直接进入；否则进入节点选择
  if (startNode.kind === 'event' && startNode.eventId) {
    return {
      ...state,
      run,
      phase: { kind: 'dive', subPhase: { kind: 'event', eventId: startNode.eventId } },
    };
  }

  // 否则直接显示下一节点选择
  return enterNodeSelection({ ...state, run });
}

/** 事件结束后，进入"选择下一节点"阶段 */
export function enterNodeSelection(state: GameState): GameState {
  const run = state.run;
  if (!run || !run.map || !run.currentNodeId) return state;

  const nextChoices = getNextChoices(run.map, run.currentNodeId);

  // 没有下一节点 = 走到了图的尽头，自动进入上浮
  if (nextChoices.length === 0) {
    return {
      ...state,
      phase: { kind: 'ascent', targetDepth: 0 },
    };
  }

  return {
    ...state,
    phase: {
      kind: 'dive',
      subPhase: {
        kind: 'nodeSelect',
        choices: nextChoices.map((n) => ({
          nodeId: n.id,
          depth: n.depth,
          zoneTag: n.zoneTag,
          preview: n.preview,
          isAscentPoint: n.kind === 'ascent_point',
          hasCorpseHint: n.kind === 'corpse',
        })),
      },
    },
  };
}

/** 玩家点选了一个节点 → 进入该节点。中间 tick 一定数量的"过渡回合" */
export function moveToNode(state: GameState, nodeId: string): GameState {
  let s = state;
  const run = s.run;
  if (!run || !run.map) return s;
  const target = run.map.nodes[nodeId];
  if (!target) return s;

  // 过渡回合：1 个标准回合 + 深度差 / 5 取整
  const depthDelta = Math.abs(target.depth - run.currentDepth);
  const transitionTurns = 1 + Math.floor(depthDelta / 5);

  // tick 当前深度的回合（在到达前），然后切换深度
  let tickedRun = tickTurns(run, transitionTurns);
  tickedRun = {
    ...tickedRun,
    currentDepth: target.depth,
    currentNodeId: target.id,
    visitedNodeIds: [...tickedRun.visitedNodeIds, target.id],
  };

  s = { ...s, run: tickedRun };
  s = appendLog(s, {
    tone: 'system',
    text: `你向下游了 ${transitionTurns} 回合，到达 ${target.depth}m。`,
  });

  // 检查氧气/理智死亡
  if (tickedRun.stats.oxygen <= 0) {
    return executeDeath(s, '氧气耗尽，溺亡');
  }
  if (tickedRun.stats.sanity <= 0) {
    return executeDeath(s, '理智崩溃，疯狂上浮');
  }

  // 根据节点 kind 决定下一步
  switch (target.kind) {
    case 'event':
      if (target.eventId) {
        return {
          ...s,
          phase: { kind: 'dive', subPhase: { kind: 'event', eventId: target.eventId } },
        };
      }
      // 没事件 ID 的 event 节点，退化为休息
      return { ...s, phase: { kind: 'dive', subPhase: { kind: 'rest' } } };

    case 'rest':
      return { ...s, phase: { kind: 'dive', subPhase: { kind: 'rest' } } };

    case 'ascent_point':
      // 让玩家选择：在此上浮 / 继续深入
      return { ...s, phase: { kind: 'dive', subPhase: { kind: 'rest' } } };

    case 'corpse':
      if (target.corpseRecordId) {
        return { ...s, phase: { kind: 'dive', subPhase: { kind: 'corpse', deathRecordId: target.corpseRecordId } } };
      }
      return { ...s, phase: { kind: 'dive', subPhase: { kind: 'rest' } } };

    case 'shop':
    case 'boss':
      return { ...s, phase: { kind: 'dive', subPhase: { kind: 'rest' } } };
  }
}

/** 休息节点：消耗 N 回合换体力恢复 */
export function restAtNode(state: GameState, turns: number = 3): GameState {
  let s = state;
  if (!s.run) return s;
  const run = tickTurns(s.run, turns);
  const stats = {
    ...run.stats,
    stamina: Math.min(run.staminaMax, run.stats.stamina + 15),
  };
  s = { ...s, run: { ...run, stats } };
  s = appendLog(s, { tone: 'realistic', text: `你停在此处，调整呼吸。体力恢复 +15。` });
  return s;
}

export type { DiveNode, DiveMap };
