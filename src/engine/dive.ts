// Dive 引擎：节点移动、回合 tick、上浮判定
// 与 events.ts 解耦：events 负责事件内的 outcome 应用；dive 负责事件间的"地图层"逻辑

import type {
  GameState,
  RunState,
  DiveNode,
  DiveMap,
  ChartPoi,
  CurrentStrength,
  Visibility,
  NodeChoice,
  FeatureChoice,
  PlayerProfile,
  ZoneTag,
  Lighthouse,
} from '@/types';
import { tickTurns } from './events';
import { generateDiveMap, getNextChoices } from './mapgen';
import { getZone } from './zones';
import { appendLog, createNewRun } from './state';
import { getUpgradeBonuses } from './upgrades';
import {
  getRunBonuses,
  getHomeLighthouse,
  getLighthouse,
  getOutposts,
  OUTPOST_USABLE_STAGE,
} from './lighthouses';
import { effectiveOutpostStage, effectiveOutpostBonuses } from './outposts';
import { getBand, bandDiveModifier } from './bands';
import { effectiveDistance, MIMIC_DIVE_EVENT_ID } from './chart';
import { executeDeath } from './death';
import { startCombat } from './combat';
import {
  clarityForNode,
  lampEffective,
  sonarReturn,
  lampPreview,
  BLIND_PREVIEW,
  BLIND_VISITED_PREVIEW,
  sonarPingCost,
  predatorApproaches,
  ALERT_AFTER_TRIGGER,
  ALERT_MAX,
  sonarPingAlertDelta,
} from './clarity';
import { revealSonarScan, sonarScanRange } from './sonar';

/** 编译期穷尽性检查：将来新增 NodeKind 却忘了在 moveToNode 里处理时，这里会直接报类型错误。 */
function assertNever(x: never): never {
  throw new Error('Unhandled NodeKind: ' + JSON.stringify(x));
}

/**
 * 多事件房间里「凑近探一处 feature」的回合开销（声呐与房间 SPEC §6/§8「连探付氧」）。
 * 不含洋流移动费（你没离开房间）——只是房内挪近、细看的时间。小值＝连探不致命，但每探都耗氧，
 * 形成「再翻一处还是趁早走」的张力（press-your-luck）。
 */
const FEATURE_EXPLORE_TURNS = 1;

/** run.activeFlags 里「某房某 feature 已探」的 key（run 级、不入存档形状）。 */
function featureDoneFlag(nodeId: string, featureId: string): string {
  return `feat:${nodeId}:${featureId}`;
}

/**
 * 当前房间内**未探**的 feature（多事件房间 S1）→ FeatureChoice[]。
 * 你就在房间里、灯照得到＝近处真相（full 档，S1 只读真相；S2 才在此填欺骗）。单事件房间 / 普通节点 → []。
 */
function roomFeatureChoices(run: RunState): FeatureChoice[] {
  if (!run.map || !run.currentNodeId) return [];
  const node = run.map.nodes[run.currentNodeId];
  if (!node?.features) return [];
  return node.features
    .filter((f) => !run.activeFlags.has(featureDoneFlag(node.id, f.id)))
    .map((f) => ({ featureId: f.id, eventId: f.eventId, preview: f.preview, clarity: 'full' as const }));
}

/**
 * 在港口选定 zone，开始一次下潜。
 * @param opts.depthOffset 海图 POI 深度偏移（米），透传给 mapgen 平移整图深度。
 * @param opts.targetCorpseId 打捞行会 Lv.2 出海前选定的目标尸体 id，透传给 mapgen 保证布点。
 */
export function startDive(
  state: GameState,
  zoneId: string,
  opts?: {
    depthOffset?: number;
    depthRange?: [number, number];
    bandTags?: ZoneTag[];
    maxRoomFeatures?: number;
    sonarDeception?: number;
    targetCorpseId?: string;
  },
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
    depthRange: opts?.depthRange,
    bandTags: opts?.bandTags,
    maxRoomFeatures: opts?.maxRoomFeatures,
    sonarDeception: opts?.sonarDeception,
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
  // RunStartBonuses 字段全是 createNewRun bonuses 的超集，直接整个传（含深水区 Phase 0 升级轨，避免逐字段抄漏）。
  const bonuses = getRunBonuses(state.profile);
  let run = createNewRun({ zoneId: poi.zoneId, bonuses });

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
  s = appendVisibilityLog(s, m?.visibility, run.sensors.sonarUnlocked);

  // 深水区 Phase 3：横渡到「无灯之光」→ 入潜兑现（§3.5）。强制把这次下潜的开场设成 mimic 兑现事件
  // （run/map 已就位，事件自身以 forceAscend 收尾＝一次性 capstone 遭遇，不靠节点池抽取、不可错过）。
  if (poi.mimic) {
    s = appendLog(s, {
      tone: 'uncanny',
      text: '你贴近那盏光。它不躲，不灭——越近越不像一座灯塔。',
    });
    s = { ...s, phase: { kind: 'dive', subPhase: { kind: 'event', eventId: MIMIC_DIVE_EVENT_ID } } };
  }
  return s;
}

/**
 * 出潜时按能见度追加叙事（startDiveFromPoi / startDiveFromOutpost 共用，避免文案漂移）。
 * 黑水里灯打不透 → 提示声呐门控（深水区 Phase 0a：有声呐能扫远但回波不可信 / 没声呐只能摸黑）。
 */
function appendVisibilityLog(
  s: GameState,
  visibility: Visibility | undefined,
  sonarUnlocked: boolean,
): GameState {
  if (!visibility || visibility === 'clear') return s;
  s = appendLog(s, {
    tone: 'realistic',
    text:
      visibility === 'dark'
        ? '光几乎照不进来，探照灯只够看清面前一臂。'
        : '悬浮物把光散成一团白，看不远。',
  });
  if (visibility === 'dark') {
    s = appendLog(s, {
      tone: 'uncanny',
      text: sonarUnlocked
        ? '（灯吃不透这片黑。也许声呐还能从前方探回点轮廓——只是回波信不信得过，另说。）'
        : '（灯吃不透这片黑。你没有能用的声呐，只能贴着石壁一点点摸过去。）',
    });
  }
  return s;
}

/**
 * 比目标 band（targetOrder）更浅、且已半亮（≥ OUTPOST_USABLE_STAGE）的最深前哨蛙跳出潜点（深水区 Phase 2a）。
 * 进度读 profile.flags（outpostStage）、出潜深度＝前哨所在 band 底。没有合格前哨 → null（退回 home stand-in）。
 */
function deepestOutpostLaunch(
  profile: PlayerProfile,
  targetOrder: number,
): { name: string; launchDepth: number; lighthouse?: Lighthouse } | null {
  let best: { name: string; launchDepth: number; order: number; lighthouse?: Lighthouse } | null =
    null;
  for (const def of getOutposts()) {
    // 深水区 Phase 2b：用衰减后的**有效**阶段——荒废到半亮回退（< USABLE）的前哨会丢失蛙跳资格。
    if (effectiveOutpostStage(profile, def.id) < OUTPOST_USABLE_STAGE) continue;
    const ob = getBand(def.bandId);
    if (!ob || ob.order >= targetOrder) continue; // 前哨必须比目标更浅（不能从同层/更深起跳）
    if (!best || ob.order > best.order) {
      best = {
        name: def.name,
        launchDepth: ob.depthRange[1],
        order: ob.order,
        // 点亮的前哨才有 Lighthouse 对象（半亮未 push）→ 充电/充氧补给设施只有点亮前哨提供（深水区 Phase 2b）。
        lighthouse: getLighthouse(profile, def.result.id),
      };
    }
  }
  return best
    ? { name: best.name, launchDepth: best.launchDepth, lighthouse: best.lighthouse }
    : null;
}

/**
 * 从前哨「蛙跳」下潜到一个深度 band（深水区 Phase 1 plumbing + Phase 2a 真前哨出潜点）。镜像 startDiveFromPoi，但：
 *   - 出潜点＝前哨（**本期最小版用 home 灯塔当 stand-in**；真·最深前哨是 Phase 2）；
 *   - 目标＝一个 band：用 band 的**绝对 depthRange 覆盖** zone.depthRange（band 决定下到多深、zone 决定那里有什么）；
 *   - **软门控**：不查解锁 flag——能不能活由装备（声呐解锁 + 电池/升级，吃深料，见 quirk #60）+ 后续强敌决定。
 *     深 band 的 visibility=dark → 灯打不透 → 被迫用更耗电的声呐（间接电量压力，不加深度耗电税；作者 2026-06-03）。
 *   - 随身加成走 getRunBonuses（含 Phase 0 升级轨的 sensorTuning/powerMax）——装备越强越下得去。
 */
export function startDiveFromOutpost(state: GameState, bandId: string): GameState {
  const band = getBand(bandId);
  if (!band) {
    console.warn(`Band ${bandId} not found`);
    return state;
  }
  // 蛙跳出潜点（深水区 Phase 2a）：从**已半亮（≥ OUTPOST_USABLE_STAGE）、且比目标 band 更浅**的最深前哨起跳，
  // 起跳深度＝该前哨所在 band 底（省掉从水面到那里的下潜）。没有这样的前哨 → 退回 home 灯塔 stand-in（从水面起跳＝Phase 1 旧行为）。
  const launch = deepestOutpostLaunch(state.profile, band.order);
  const outpost = launch ? undefined : getHomeLighthouse(state.profile);
  const launchName = launch?.name ?? outpost?.name ?? '前哨';
  const launchDepth = launch?.launchDepth ?? 0;

  // 随身加成 = 全局升级 + 家灯塔船坞（getRunBonuses）+ 蛙跳出潜前哨的**在线**补给设施（深水区 Phase 2b）：
  // 充电（电池总量）/ 充氧（氧气上限）只有在能源够、且前哨没荒废到设施掉线时才计入（effectiveOutpostBonuses）。
  let bonuses = getRunBonuses(state.profile);
  if (launch?.lighthouse) {
    const ob = effectiveOutpostBonuses(state.profile, launch.lighthouse);
    bonuses = {
      ...bonuses,
      powerMaxBonus: bonuses.powerMaxBonus + ob.rechargeBonus,
      oxygenMaxBonus: bonuses.oxygenMaxBonus + ob.oxygenSupply,
    };
  }
  let run = createNewRun({ zoneId: band.zoneId, bonuses });

  // 蛙跳「航行预耗氧」：按**从出潜点到 band 顶端**的深度差粗估（前哨越深起跳越省），每 20m 约一档。
  const dist = Math.max(1, Math.round((band.depthRange[0] - launchDepth) / 20));
  const transitOxygen = dist * 2;
  const m = bandDiveModifier(band);
  run = {
    ...run,
    diveModifier: m,
    // 深水区 C：band 探测压力倍率落 run（缺省 undefined → alertDelta 视作 1）。越深 band 越凶，
    // 在深度因子饱和（ALERT_DEPTH_FULL）之上继续加压；摸黑/浅水消退不受倍率影响（逃生阀门不被买断）。
    bandAlertFactor: band.alertFactor,
    // 声呐与房间 S2：band 不可信声呐失真强度落 run（缺省 undefined → effectiveFalseEchoSanity 视作 0＝声呐相对老实）。
    // 深 band 越骗（throat/abyssal/hadal）、subhadal 回落（『把戏都停了』）；只抬低 san 失真阈值、不动其它。
    sonarDeception: band.sonarDeception,
    turn: dist,
    stats: { ...run.stats, oxygen: Math.max(1, run.stats.oxygen - transitOxygen) },
  };

  let s: GameState = { ...state, run };
  // band 用绝对 depthRange 覆盖 zone.depthRange（透传 mapgen GenOpts.depthRange）。
  // band.tags（如有）覆盖 zoneTagsByDepth＝trench 专属事件池（twilight/midnight），与借来的 zone 内容隔离。
  // band.maxRoomFeatures（如有）开多事件「大房间」（声呐与房间 S1）——深段内容（C）铺在这些大房间里。
  s = startDive(s, band.zoneId, {
    depthRange: band.depthRange,
    bandTags: band.tags,
    maxRoomFeatures: band.maxRoomFeatures,
    // band.sonarDeception（如有）让 mapgen 给部分内部节点挂 spoofs/evades（节点版 mimic / 无回波，S2）。
    sonarDeception: band.sonarDeception,
  });

  s = appendLog(s, {
    tone: 'system',
    text: `自${launchName}蛙跳下潜至「${band.name}」（${band.depthRange[0]}–${band.depthRange[1]}m）。路上耗气约 ${transitOxygen} 回合。`,
  });
  s = appendVisibilityLog(s, m.visibility, run.sensors.sonarUnlocked);
  if (band.danger) {
    s = appendLog(s, { tone: 'uncanny', text: band.danger });
  }
  return s;
}

/** 事件结束后，进入"选择下一节点"阶段 */
export function enterNodeSelection(state: GameState): GameState {
  const run = state.run;
  if (!run || !run.map || !run.currentNodeId) return state;

  const nextChoices = getNextChoices(run.map, run.currentNodeId);
  // 当前房间内未探的 feature（多事件房间 S1）：与去往别处的出口并列摆出（一房可连探付氧、选出口走人）。
  const features = roomFeatureChoices(run);

  // 没有下一节点、且房内也没剩可探的 → 走到图的尽头，自动进入上浮。
  // （多 feature 房间还有没探完的不自动上浮——先让玩家选探还是走。）
  if (nextChoices.length === 0 && features.length === 0) {
    return {
      ...state,
      phase: { kind: 'ascent', targetDepth: 0 },
    };
  }

  const visitedSet = new Set(run.visitedNodeIds);
  // 打捞行会 Lv.1（revealCorpseHint）才在选点界面"预知"尸体；否则尸体节点伪装成普通水道，
  // 玩家只能撞上去才发现（moveToNode 仍按 kind==='corpse' 路由到 CorpseView，与提示无关）。
  const revealCorpseHint = getUpgradeBonuses(state.profile).revealCorpseHint;
  // 微观 clarity（深水区 Phase 0a + Phase 1 续节点级降档）：灯 full（真相）/ 声呐 sonar（不可信表象）/ 摸黑 none（盲）。
  // run 级 clarity(run) 是天花板；clarityForNode 在它之上按"节点比你深多少"降档（陡降的深坑灯打不透→声呐→黑）。
  // 引擎侧把对应预览文案烤进 choice（便于 playthrough-sensors 断言，承 quirk #38「别只测引擎」）。
  const NEUTRAL_CORPSE = '前方的水暗下去，看不清里面有什么。';

  const choices: NodeChoice[] = nextChoices.map((n) => {
    const isCorpse = n.kind === 'corpse';
    // 地标（上浮口 / 气穴 / 扎营点）结构性可感——盲航也认得，始终给真相文案、不被声呐/盲/深度改写。
    const isLandmark = n.kind === 'ascent_point' || n.kind === 'air_pocket' || n.kind === 'camp';
    const visited = visitedSet.has(n.id);
    // 节点级档：浅水/近处 full、陡降按 reach 降档（深水区 Phase 1 续）。两类不参与深度降档：
    //   ① 地标（上浮口/气穴/扎营）结构性可感；
    //   ② 打捞行会 Lv.1 标记的尸体——尸体定位是地图知识、不被深度藏住，灯有效就认得出那具熟悉的轮廓（守 quirk #36/#58）。
    const corpseMarked = isCorpse && revealCorpseHint && lampEffective(run);
    const nodeTier = isLandmark || corpseMarked ? 'full' : clarityForNode(run, n);

    let preview: string;
    if (isLandmark) {
      preview = n.preview;
    } else if (nodeTier === 'full') {
      // 灯下真相（san 极低时 lampPreview 把它改写成幻觉）；尸体无 Lv.1 仍伪装成中性水道。
      preview = isCorpse && !revealCorpseHint ? NEUTRAL_CORPSE : lampPreview(run, n);
    } else if (nodeTier === 'sonar') {
      preview = sonarReturn(run, n); // 不可信表象（≠ 真内容，可被躲/骗/低 san 假回波改写）
    } else {
      preview = visited ? BLIND_VISITED_PREVIEW : BLIND_PREVIEW;
    }

    return {
      nodeId: n.id,
      depth: n.depth,
      zoneTag: n.zoneTag,
      preview,
      isAscentPoint: n.kind === 'ascent_point',
      kind: n.kind,
      // 尸体提示只在灯下（该节点读到 full）+ 有 Lv.1 才给——声呐/盲/太深都读不出"熟悉的轮廓"。
      hasCorpseHint: isCorpse && revealCorpseHint && nodeTier === 'full',
      visited,
      clarity: nodeTier,
    };
  });

  return {
    ...state,
    phase: {
      kind: 'dive',
      subPhase: { kind: 'nodeSelect', choices, features: features.length ? features : undefined },
    },
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
  // 1 scan / 停留（声呐与房间 SPEC §8「1 scan/turn」）：这一站已 ping 过（未移动）→ 不重复耗电/暴露。
  // 移动后 applyTransit 把 sonar 归 off（脉冲瞬时），下个路口才能再 ping。
  if ((run.sensors?.sonar ?? 'off') === 'ping') {
    return appendLog(state, { tone: 'system', text: '脉冲还在水里荡，等它散了再扫一记。' });
  }
  const pingCost = sonarPingCost(run); // 升级派生（缺省 SONAR_PING_COST）
  if ((run.power ?? 0) < pingCost) {
    return appendLog(state, { tone: 'realistic', text: '电量不够再发一记声呐了。' });
  }
  const power = Math.max(0, (run.power ?? 0) - pingCost);
  // 声呐图（S0）：从你当前位置揭示有限程内的真实节点为草图，stamp 当前 turn（余像随回合渐隐、重复 ping 不更亮）。
  const scanMemory: Record<string, number> = { ...(run.scanMemory ?? {}) };
  if (run.map && run.currentNodeId) {
    for (const id of revealSonarScan(run.map, run.currentNodeId, sonarScanRange(run))) {
      scanMemory[id] = run.turn;
    }
  }
  // ping 当场抬警觉（暴露双刃，SPEC §5）：浅水免压、深 band 更狠（sonarPingAlertDelta），clamp 上限。
  const alert = Math.min(ALERT_MAX, (run.alert ?? 0) + sonarPingAlertDelta(run));
  let s: GameState = {
    ...state,
    run: { ...run, power, alert, scanMemory, sensors: { ...run.sensors, sonar: 'ping' } },
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

/**
 * 深水区 Phase 0b：警觉越线 → 潜伏的捕食者接近、触发遭遇。
 * 仅当该 zone 配了 `ambushEncounters` + 警觉够 + 够深（§7.5）+ 进入的是非地标节点（事件/尸体）时触发——
 * 地标（上浮口/气穴/扎营）是落脚点，不在此被伏击，总留「摸黑奔向出口」的出路。
 * 选遭遇用确定性索引（不消耗 Math.random，保 mapgen/场景确定性）。返回 combat 态 GameState，否则 null。
 */
function maybeApproachEncounter(state: GameState, target: DiveNode): GameState | null {
  const run = state.run;
  if (!run) return null;
  if (!predatorApproaches(run)) return null;
  if (target.kind !== 'event' && target.kind !== 'corpse') return null;
  const pool = getZone(run.zoneId)?.ambushEncounters;
  if (!pool || pool.length === 0) return null;
  const combatId = pool[run.visitedNodeIds.length % pool.length];
  // 触发后警觉落回缓冲值，避免连环伏击
  let s: GameState = { ...state, run: { ...run, alert: ALERT_AFTER_TRIGGER } };
  s = appendLog(s, {
    tone: 'uncanny',
    text: '你举着的光招来了东西——它从黑里径直朝你来，没有半点犹豫。',
  });
  return startCombat(s, combatId);
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

  // 深水区 Phase 0b：高警觉 + 该 zone 有潜伏捕食者 → 接近并触发遭遇（先于节点 kind 分发；摸黑可避免）。
  const approached = maybeApproachEncounter(s, target);
  if (approached) return approached;

  // 根据节点 kind 决定下一步
  switch (target.kind) {
    case 'event':
      // 多事件「大房间」(S1)：到房间不自动触发——摆出房内未探 feature ＋ 出口，玩家自己选探哪个 / 走哪条。
      // 重访也走这条：enterNodeSelection 据 activeFlags 过滤掉已探的 feature（探完只剩出口＝安静房间）。
      if (target.features && target.features.length > 0) {
        return enterNodeSelection(s);
      }
      // 重访：（单事件房间）事件已结算过，不重播——退化成一段安静水域（仍可休息/继续/回头）。
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

/**
 * 探索当前房间里的一个 feature（多事件房间 S1）。在房内凑近细看：
 *   - 付 FEATURE_EXPLORE_TURNS 回合的氧（不含洋流移动费——你没离开房间）；
 *   - 标记已探（run.activeFlags，回到 enterNodeSelection 时该 feature 不再列出）；
 *   - 触发其事件。
 * 与「移动到新节点」解耦：不切 currentNodeId、不触发接近遭遇（探测只在跨节点 moveToNode 触发——
 * 但连探累积的 alert 会在你**下一次移动**时兑现，故「在大房间里翻太久」自有代价）。
 */
export function exploreFeature(state: GameState, featureId: string): GameState {
  const run = state.run;
  if (!run || !run.map || !run.currentNodeId) return state;
  const node = run.map.nodes[run.currentNodeId];
  const feat = node?.features?.find((f) => f.id === featureId);
  if (!feat) return state;
  const doneFlag = featureDoneFlag(node.id, feat.id);
  if (run.activeFlags.has(doneFlag)) return state; // 已探过（守卫，避免重复触发同一 feature）

  // 连探付氧：房内挪近这处、细看（耗回合 + 灯/声呐随 tick 耗电、深水抬 alert）。标记已探。
  const ticked = tickTurns(run, FEATURE_EXPLORE_TURNS);
  const activeFlags = new Set(ticked.activeFlags);
  activeFlags.add(doneFlag);
  let s: GameState = { ...state, run: { ...ticked, activeFlags } };

  // 氧气/理智死亡判定（与 moveToNode 同口径——连探也会把氧/理智耗到见底）
  if (s.run!.stats.oxygen <= 0) return executeDeath(s, '氧气耗尽，溺亡');
  if (s.run!.stats.sanity <= 0) return executeDeath(s, '理智崩溃，疯狂上浮');

  return { ...s, phase: { kind: 'dive', subPhase: { kind: 'event', eventId: feat.eventId } } };
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
