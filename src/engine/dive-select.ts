// 节点选择与预览档位（#106 拆分自 dive.ts·纯搬移）：enterNodeSelection 把出口/房内 feature 烤成
// 带 clarity 档预览的 choices。featureDoneFlag（连探标记）由 dive-actions 共用。函数体与拆分前逐字相同。

import type { GameState, RunState, NodeChoice, FeatureChoice } from '@/types';
import { getNextChoices } from './mapgen';
import { getUpgradeBonuses } from './upgrades';
import {
  lampOn,
  lampGateLocked,
  lampPreview,
  LOCKED_DARK_PREVIEW,
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
  // 灯门二态（感知重做 CLARITY COLLAPSE·SPEC §2.1）：darkness 是唯一的门、深度不再降档。
  //   - 地标（上浮口/气穴/扎营）+ Lv.1 尸体：恒诚实真相（结构性可感 / 地图知识·不被灯门锁）。
  //   - 否则黑处（waterIsDark）无有效灯 → locked：可见但锁住、标「太暗，看不清——需要灯」。
  //   - 否则 → 诚实真相（lampPreview／node.preview；尸体无 Lv.1 仍伪装成中性水道 NEUTRAL_CORPSE）。
  // 引擎侧把 locked 标志 + 预览文案烤进 choice（便于 playthrough 断言·渲染层拦截是车道 3）。
  const NEUTRAL_CORPSE = '前方的水暗下去，看不清里面有什么。';
  const gateLocked = lampGateLocked(run); // 这一潜（黑水无灯）→ 非豁免选项一律锁

  // 隐藏黑点（感知重做 per-node·#262）：无有效灯时 `n.dark` 的选项**不显示**（从 choices 过滤掉·带灯才现）——
  // 伏笔式黑点，区别于 band 级整潜黑（gateLocked·可见但锁住）。撒点 repair 保证父节点总留 ≥1 非黑出口＝摸黑不会无路。
  const hasLamp = lampOn(run);
  const choices: NodeChoice[] = nextChoices
    .filter((n) => hasLamp || !n.dark)
    .map((n) => {
    const isCorpse = n.kind === 'corpse';
    // 地标（上浮口 / 气穴 / 扎营点）结构性可感——盲航也认得，始终给真相文案、不被灯门锁。
    const isLandmark = n.kind === 'ascent_point' || n.kind === 'air_pocket' || n.kind === 'camp';
    const visited = visitedSet.has(n.id);
    // Lv.1 标记的尸体——尸体定位是地图知识、灯门不锁它（守 quirk #36/#58），灯有效就认得出那具熟悉的轮廓。
    const corpseMarked = isCorpse && revealCorpseHint && lampOn(run);
    // 豁免灯门 → 恒诚实真相；否则受这一潜的灯门（黑处无灯）锁。
    const exemptGate = isLandmark || corpseMarked;
    const locked = gateLocked && !exemptGate;

    let preview: string;
    if (locked) {
      preview = LOCKED_DARK_PREVIEW; // 黑处无有效灯：可见但锁住
    } else if (isLandmark) {
      preview = n.preview;
    } else {
      // 诚实近场真相（灯到即真·感知重做后无低 san 改写）；尸体无 Lv.1 仍伪装成中性水道。
      preview = isCorpse && !revealCorpseHint ? NEUTRAL_CORPSE : lampPreview(run, n);
    }

    return {
      nodeId: n.id,
      depth: n.depth,
      zoneTag: n.zoneTag,
      preview,
      isAscentPoint: n.kind === 'ascent_point',
      kind: n.kind,
      // 尸体提示只在未锁 + 有 Lv.1 才给（黑处无灯锁住时读不出"熟悉的轮廓"）。
      hasCorpseHint: isCorpse && revealCorpseHint && !locked,
      visited,
      // 灯门二态：未锁＝'full'（灯下诚实真相·非黑水不需灯也 full）/ 锁＝'none'（黑处无灯·盲）。
      clarity: locked ? 'none' : 'full',
      ...(locked ? { locked: true } : {}),
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
