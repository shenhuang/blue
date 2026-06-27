// 节点选择与预览档位（#106 拆分自 dive.ts·纯搬移）：enterNodeSelection 把出口/房内 feature 烤成
// 带 clarity 档预览的 choices。featureDoneFlag（连探标记）由 dive-actions 共用。函数体与拆分前逐字相同。

import type { GameState, RunState, NodeChoice, FeatureChoice } from '@/types';
import { getNextChoices } from './mapgen';
import { getUpgradeBonuses } from './upgrades';
import {
  clarityForNode,
  lampEffective,
  sonarReturn,
  lampPreview,
  BLIND_PREVIEW,
  BLIND_VISITED_PREVIEW,
} from './clarity';

/** run.activeFlags 里「某房某 feature 已探」的 key（run 级、不入存档形状）。 */
export function featureDoneFlag(nodeId: string, featureId: string): string {
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

/** 事件结束后，进入"选择下一节点"阶段 */
export function enterNodeSelection(state: GameState): GameState {
  const run = state.run;
  if (!run) return state;
  // 无图 / 无当前节点（剧情编辑器合成态·createNewRun 不进图）：没有节点图可回，事件结束就退化到 rest
  // 子阶段＝离开事件流（别停在原事件被 oxygenTurnCost 反复空耗氧）。游戏内所有调用点都带图·不命中此分支。
  if (!run.map || !run.currentNodeId) {
    return { ...state, phase: { kind: 'dive', subPhase: { kind: 'rest' } } };
  }

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
