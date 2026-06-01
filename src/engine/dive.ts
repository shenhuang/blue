// Dive 引擎：节点移动、回合 tick、上浮判定
// 与 events.ts 解耦：events 负责事件内的 outcome 应用；dive 负责事件间的"地图层"逻辑

import type { GameState, RunState, DiveNode, DiveMap, ChartPoi, CurrentStrength } from '@/types';
import { tickTurns } from './events';
import { generateDiveMap, getNextChoices } from './mapgen';
import { getZone } from './zones';
import { appendLog, createNewRun } from './state';
import { getUpgradeBonuses } from './upgrades';
import { getRunBonuses } from './lighthouses';
import { effectiveDistance } from './chart';
import { executeDeath } from './death';

/** 编译期穷尽性检查：将来新增 NodeKind 却忘了在 moveToNode 里处理时，这里会直接报类型错误。 */
function assertNever(x: never): never {
  throw new Error('Unhandled NodeKind: ' + JSON.stringify(x));
}

/**
 * 在港口选定 zone，开始一次下潜。
 * @param opts.depthOffset 海图 POI 深度偏移（米），透传给 mapgen 平移整图深度。
 * @param opts.targetCorpseId 打捞行会 Lv.2 出海前选定的目标尸体 id，透传给 mapgen 保证布点。
 */
export function startDive(
  state: GameState,
  zoneId: string,
  opts?: { depthOffset?: number; targetCorpseId?: string },
): GameState {
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
    depthOffset: opts?.depthOffset,
    targetCorpseId: opts?.targetCorpseId,
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

/**
 * 从海图 POI 出海。封装出海前的全部准备：
 *   - createNewRun（带港口升级派生加成，与 dialog 的 startDive effect 一致）
 *   - 距离：每档 2 回合的"路上预耗氧" + 记到 run.turn（"远 = 多耗氧 / 多 turn"接口的首个实装）
 *   - diveModifier 落到 run（current / visibility 供未来 hook 读取）
 *   - depthOffset 透传 mapgen
 *   - 距离 / 洋流 / 能见度的叙事日志
 * 供 SeaChartView 调用。
 */
export function startDiveFromPoi(
  state: GameState,
  poi: ChartPoi,
  opts?: { targetCorpseId?: string },
): GameState {
  // 随身加成 = 全局升级 ＋ 家灯塔「船坞」设施（dockyard 迁灯塔后由 getRunBonuses 并回，见 lighthouses.ts）
  const bonuses = getRunBonuses(state.profile);
  let run = createNewRun({
    zoneId: poi.zoneId,
    bonuses: {
      oxygenMaxBonus: bonuses.oxygenMaxBonus,
      staminaMaxBonus: bonuses.staminaMaxBonus,
      extraConsumableSlot: bonuses.extraConsumableSlot,
    },
  });

  // reach：距离按最近的已拥有灯塔算（出海预耗氧 + turn）；写死 distance 仍作 fallback（SPEC §3.4/§4）
  const dist = effectiveDistance(state.profile, poi);
  const transitOxygen = dist * 2;
  run = {
    ...run,
    diveModifier: poi.modifier,
    turn: dist,
    stats: { ...run.stats, oxygen: Math.max(1, run.stats.oxygen - transitOxygen) },
  };

  let s: GameState = { ...state, run };
  s = startDive(s, poi.zoneId, {
    depthOffset: poi.modifier?.depthOffset,
    targetCorpseId: opts?.targetCorpseId,
  });

  if (dist > 0) {
    s = appendLog(s, {
      tone: 'system',
      text: `航行至「${poi.name}」。路上耗气约 ${transitOxygen} 回合。`,
    });
  }
  const m = poi.modifier;
  if (m?.current && m.current !== 'none') {
    s = appendLog(s, {
      tone: 'realistic',
      text: m.current === 'strong' ? '一股急流斜斜地推着你，得用力才稳得住。' : '水里有股缓慢的洋流。',
    });
  }
  if (m?.visibility && m.visibility !== 'clear') {
    s = appendLog(s, {
      tone: 'realistic',
      text:
        m.visibility === 'dark'
          ? '光几乎照不进来，探照灯只够看清面前一臂。'
          : '悬浮物把光散成一团白，看不远。',
    });
  }
  return s;
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

  const visitedSet = new Set(run.visitedNodeIds);
  // 打捞行会 Lv.1（revealCorpseHint）才在选点界面"预知"尸体；否则尸体节点伪装成普通水道，
  // 玩家只能撞上去才发现（moveToNode 仍按 kind==='corpse' 路由到 CorpseView，与提示无关）。
  const revealCorpseHint = getUpgradeBonuses(state.profile).revealCorpseHint;

  return {
    ...state,
    phase: {
      kind: 'dive',
      subPhase: {
        kind: 'nodeSelect',
        choices: nextChoices.map((n) => {
          const isCorpse = n.kind === 'corpse';
          return {
            nodeId: n.id,
            depth: n.depth,
            zoneTag: n.zoneTag,
            // 无 Lv.1 时不剧透 corpse 的"熟悉的轮廓"预览，换成中性水道描述
            preview: isCorpse && !revealCorpseHint ? '前方的水暗下去，看不清里面有什么。' : n.preview,
            isAscentPoint: n.kind === 'ascent_point',
            kind: n.kind,
            hasCorpseHint: isCorpse && revealCorpseHint,
            visited: visitedSet.has(n.id),
          };
        }),
      },
    },
  };
}

/**
 * 洋流（海图 POI 修正）对每次节点移动的额外消耗：逆流费力（体力）+ 呼吸更重（氧气）。
 * 纯函数，便于回归断言。none / 未设 → 0。
 */
export function currentMoveCost(
  current: CurrentStrength | undefined,
): { stamina: number; oxygen: number } {
  if (current === 'strong') return { stamina: 8, oxygen: 2 };
  if (current === 'mild') return { stamina: 3, oxygen: 1 };
  return { stamina: 0, oxygen: 0 };
}

/**
 * 过渡到目标节点：tick 过渡回合（1 + 深度差/5）+ 洋流额外消耗 + 叙事日志，并切换 depth/node。
 * 纯过渡，不做死亡判定（moveToNode 紧接着查氧气/理智死亡）。
 */
function applyTransit(state: GameState, target: DiveNode): GameState {
  const run = state.run!;
  const transitionTurns = 1 + Math.floor(Math.abs(target.depth - run.currentDepth) / 5);

  let ticked = tickTurns(run, transitionTurns);
  ticked = {
    ...ticked,
    currentDepth: target.depth,
    currentNodeId: target.id,
    visitedNodeIds: [...ticked.visitedNodeIds, target.id],
  };

  // 洋流（海图 POI 修正）：每次移动额外耗体力 + 氧气（在死亡判定前应用，使洋流耗氧也能致死）
  const curCost = currentMoveCost(run.diveModifier?.current);
  const hasCurrentCost = curCost.stamina > 0 || curCost.oxygen > 0;
  if (hasCurrentCost) {
    ticked = {
      ...ticked,
      stats: {
        ...ticked.stats,
        stamina: Math.max(0, ticked.stats.stamina - curCost.stamina),
        oxygen: Math.max(0, ticked.stats.oxygen - curCost.oxygen),
      },
    };
  }

  let s: GameState = { ...state, run: ticked };
  s = appendLog(s, {
    tone: 'system',
    text: `你向下游了 ${transitionTurns} 回合，到达 ${target.depth}m。`,
  });
  if (hasCurrentCost) {
    s = appendLog(s, {
      tone: 'realistic',
      text:
        run.diveModifier?.current === 'strong'
          ? '逆着急流游，关节和肺都在抗议。'
          : '洋流推着你，多费了点力气。',
    });
  }
  return s;
}

/** 玩家点选了一个节点 → 进入该节点。过渡耗回合，再按节点 kind 决定下一步 */
export function moveToNode(state: GameState, nodeId: string): GameState {
  const run = state.run;
  if (!run || !run.map) return state;
  const target = run.map.nodes[nodeId];
  if (!target) return state;

  // 迷路图：重访已到过的节点时事件不重播（用 append-only 的 visitedNodeIds 判定，首次到达尚不在表里）
  const isRevisit = run.visitedNodeIds.includes(target.id);

  // 过渡（tick + 洋流消耗 + 叙事）
  let s = applyTransit(state, target);
  const ticked = s.run!;

  // 检查氧气/理智死亡（洋流耗氧也算）
  if (ticked.stats.oxygen <= 0) {
    return executeDeath(s, '氧气耗尽，溺亡');
  }
  if (ticked.stats.sanity <= 0) {
    return executeDeath(s, '理智崩溃，疯狂上浮');
  }

  // 根据节点 kind 决定下一步
  switch (target.kind) {
    case 'event':
      // 重访：事件已结算过，不重播——退化成一段安静水域（仍可休息/继续/回头）。
      if (isRevisit) {
        s = appendLog(s, { tone: 'realistic', text: '你回到这片水域，只剩自己搅起的沉积慢慢落下。' });
        return { ...s, phase: { kind: 'dive', subPhase: { kind: 'rest' } } };
      }
      if (target.eventId) {
        return { ...s, phase: { kind: 'dive', subPhase: { kind: 'event', eventId: target.eventId } } };
      }
      // 没事件 ID 的 event 节点，退化为休息
      return { ...s, phase: { kind: 'dive', subPhase: { kind: 'rest' } } };

    case 'rest':
    case 'ascent_point':
    case 'air_pocket':
    case 'camp':
      // 休息 / 地标节点都复用 rest subPhase；RestView 按 node.kind 分渲染（普通休息 / 上浮 / 换气 / 扎营）
      return { ...s, phase: { kind: 'dive', subPhase: { kind: 'rest' } } };

    case 'corpse':
      // 重访已被回收的尸体没意义；未回收则仍可回收（recoverFromCorpse 幂等）
      if (target.corpseRecordId && !isRevisit) {
        return { ...s, phase: { kind: 'dive', subPhase: { kind: 'corpse', deathRecordId: target.corpseRecordId } } };
      }
      return { ...s, phase: { kind: 'dive', subPhase: { kind: 'rest' } } };

    case 'shop':
    case 'boss':
      return { ...s, phase: { kind: 'dive', subPhase: { kind: 'rest' } } };

    default:
      return assertNever(target.kind);
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

/**
 * 气穴换气：恢复氧气 + 一点理智，不耗回合（一瞬间的事）。
 * 一次性——用过把节点记进 `run.activeFlags`（`air_used:<nodeId>`），重访不再生效，
 * 避免迷路图里来回蹭气穴刷无限氧气。
 */
export function breatheAtAirPocket(state: GameState): GameState {
  let s = state;
  const run = s.run;
  if (!run || !run.currentNodeId) return s;
  const usedFlag = `air_used:${run.currentNodeId}`;
  if (run.activeFlags.has(usedFlag)) {
    return appendLog(s, { tone: 'realistic', text: '气穴已经被你吸空了，水面不再晃。' });
  }
  const oxygen = Math.min(run.oxygenMax, run.stats.oxygen + 6);
  const sanity = Math.min(100, run.stats.sanity + 4);
  const activeFlags = new Set(run.activeFlags);
  activeFlags.add(usedFlag);
  s = { ...s, run: { ...run, stats: { ...run.stats, oxygen, sanity }, activeFlags } };
  s = appendLog(s, {
    tone: 'realistic',
    text: '你的头露出水面。空气有股陈年的金属味，但能用。你深吸了几口。（氧气 +6 / 理智 +4）',
  });
  return s;
}

/**
 * 扎营点休整：短 / 长两档，消耗回合换体力 + 理智（长档还排掉一点氮）。
 * 可重复——但 tick 的耗氧是自带代价（与普通 rest 同理，洞里氧气是硬上限）。
 */
export function campAtNode(state: GameState, mode: 'short' | 'long'): GameState {
  let s = state;
  if (!s.run) return s;
  const turns = mode === 'long' ? 6 : 3;
  const staGain = mode === 'long' ? 30 : 15;
  const sanGain = mode === 'long' ? 10 : 5;
  const n2Drop = mode === 'long' ? 5 : 0;
  const run = tickTurns(s.run, turns);
  const stats = {
    ...run.stats,
    stamina: Math.min(run.staminaMax, run.stats.stamina + staGain),
    sanity: Math.min(100, run.stats.sanity + sanGain),
    nitrogen: Math.max(0, run.stats.nitrogen - n2Drop),
  };
  s = { ...s, run: { ...run, stats } };
  s = appendLog(s, {
    tone: 'realistic',
    text:
      mode === 'long'
        ? `你关掉灯，认真扎了一会儿。重新打开灯时状态好多了。（${turns} 回合 · 体力 +${staGain} · 理智 +${sanGain} · 氮气 −${n2Drop}）`
        : `你卡住自己，听着呼吸。${turns} 回合后再起身，膝盖松了些。（体力 +${staGain} · 理智 +${sanGain}）`,
  });
  return s;
}

export type { DiveNode, DiveMap };
