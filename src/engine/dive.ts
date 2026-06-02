// Dive 引擎：节点移动、回合 tick、上浮判定
// 与 events.ts 解耦：events 负责事件内的 outcome 应用；dive 负责事件间的"地图层"逻辑

import type {
  GameState,
  RunState,
  DiveNode,
  DiveMap,
  ChartPoi,
  CurrentStrength,
  NodeChoice,
  ClarityTier,
} from '@/types';
import { tickTurns } from './events';
import { generateDiveMap, getNextChoices } from './mapgen';
import { getZone } from './zones';
import { appendLog, createNewRun } from './state';
import { getUpgradeBonuses } from './upgrades';
import { getRunBonuses } from './lighthouses';
import { effectiveDistance } from './chart';
import { executeDeath } from './death';
import {
  clarity,
  sonarReturn,
  lampPreview,
  BLIND_PREVIEW,
  BLIND_VISITED_PREVIEW,
  SONAR_PING_COST,
} from './clarity';

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
      sonarUnlocked: bonuses.sonarUnlocked,
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
    // 黑水里灯打不透 → 教学声呐 / 声呐门控（深水区 Phase 0a）
    if (m.visibility === 'dark') {
      s = appendLog(s, {
        tone: 'uncanny',
        text: run.sensors.sonarUnlocked
          ? '（灯吃不透这片黑。也许声呐还能从前方探回点轮廓——只是回波信不信得过，另说。）'
          : '（灯吃不透这片黑。你没有能用的声呐，只能贴着石壁一点点摸过去。）',
      });
    }
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
  // 微观 clarity（深水区 Phase 0a）：灯 full（真相）/ 声呐 sonar（不可信表象）/ 摸黑 none（盲）。
  // 引擎侧把对应预览文案烤进 choice（便于 playthrough-sensors 断言，承 quirk #38「别只测引擎」）。
  const tier = clarity(run);
  const NEUTRAL_CORPSE = '前方的水暗下去，看不清里面有什么。';

  const choices: NodeChoice[] = nextChoices.map((n) => {
    const isCorpse = n.kind === 'corpse';
    // 地标（上浮口 / 气穴 / 扎营点）结构性可感——盲航也认得，始终给真相文案、不被声呐/盲改写。
    const isLandmark = n.kind === 'ascent_point' || n.kind === 'air_pocket' || n.kind === 'camp';
    const visited = visitedSet.has(n.id);

    let preview: string;
    let choiceTier: ClarityTier;
    if (isLandmark) {
      preview = n.preview;
      choiceTier = 'full';
    } else if (tier === 'full') {
      // 灯下真相（san 极低时 lampPreview 把它改写成幻觉）；尸体无 Lv.1 仍伪装成中性水道。
      preview = isCorpse && !revealCorpseHint ? NEUTRAL_CORPSE : lampPreview(run, n);
      choiceTier = 'full';
    } else if (tier === 'sonar') {
      preview = sonarReturn(run, n); // 不可信表象（≠ 真内容，可被躲/骗/低 san 假回波改写）
      choiceTier = 'sonar';
    } else {
      preview = visited ? BLIND_VISITED_PREVIEW : BLIND_PREVIEW;
      choiceTier = 'none';
    }

    return {
      nodeId: n.id,
      depth: n.depth,
      zoneTag: n.zoneTag,
      preview,
      isAscentPoint: n.kind === 'ascent_point',
      kind: n.kind,
      // 尸体提示只在灯下（full）+ 有 Lv.1 才给——声呐/盲都读不出"熟悉的轮廓"。
      hasCorpseHint: isCorpse && revealCorpseHint && tier === 'full',
      visited,
      clarity: choiceTier,
    };
  });

  return {
    ...state,
    phase: { kind: 'dive', subPhase: { kind: 'nodeSelect', choices } },
  };
}

/** 选点期若在 nodeSelect，重算预览（切灯 / ping 后刷新；其它 phase 原样返回）。 */
function refreshSelection(state: GameState): GameState {
  if (state.phase.kind === 'dive' && state.phase.subPhase.kind === 'nodeSelect') {
    return enterNodeSelection(state);
  }
  return state;
}

/**
 * 切换探照灯（深水区 Phase 0a）。开＝灯有效时近距真相 + 解锁信息，但抬高 signature（被探测，0b 接战斗）；
 * 关＝省电、最隐蔽，但盲。主动感知是双向的——看清世界＝把自己暴露给世界。
 */
export function setLight(state: GameState, on: boolean): GameState {
  const run = state.run;
  if (!run) return state;
  if ((run.sensors?.light ?? true) === on) return state;
  let s: GameState = { ...state, run: { ...run, sensors: { ...run.sensors, light: on } } };
  s = appendLog(s, {
    tone: 'realistic',
    text: on
      ? '你打开探照灯，一柱光劈进水里。'
      : '你关掉灯。黑暗合拢上来——但你也不再是黑水里那么扎眼的一团亮。',
  });
  return refreshSelection(s);
}

/**
 * 发一记声呐 ping（深水区 Phase 0a）：耗一大口电，本次选点改读"不可信的声呐返回"（≠ 真内容）。
 * 需已解锁声呐能力（后期深料升级）；电量不足则只叙事不消费。移动后 ping 自动消散（脉冲是瞬时的）。
 */
export function pingSonar(state: GameState): GameState {
  const run = state.run;
  if (!run) return state;
  if (!(run.sensors?.sonarUnlocked ?? false)) {
    return appendLog(state, { tone: 'system', text: '你还没有能用的声呐。' });
  }
  if ((run.power ?? 0) < SONAR_PING_COST) {
    return appendLog(state, { tone: 'realistic', text: '电量不够再发一记声呐了。' });
  }
  const power = Math.max(0, (run.power ?? 0) - SONAR_PING_COST);
  let s: GameState = {
    ...state,
    run: { ...run, power, sensors: { ...run.sensors, sonar: 'ping' } },
  };
  s = appendLog(s, {
    tone: 'uncanny',
    text: '你发出一记脉冲。回波荡了回来——只是你说不准能不能信它。',
  });
  return refreshSelection(s);
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
    // 声呐脉冲是瞬时的：移动后归 off，下个路口要重新 ping（深水区 Phase 0a）。
    sensors: { ...ticked.sensors, sonar: 'off' },
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
