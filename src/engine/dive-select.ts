// 节点选择与预览档位（#106 拆分自 dive.ts）：enterNodeSelection 把出口/房内 feature 烤成
// 带 clarity 档预览的 choices。featureDoneFlag（连探标记）由 dive-actions 共用。
//
// 感知门（感知门 SPEC·灯/声呐 × 隐藏/锁住）：门判定统一走 effectiveGate/gateUnlocked（live-combine·非 stamp）——
// per-node `node.gate` 优先，缺省则落 run 级整潜门 `run.diveModifier.gate`（地标 / Lv.1 尸体豁免）。把旧两条散着的路
// （lampGateLocked 整潜级一刀切 + `hasLamp||!n.dark` per-node 隐藏过滤）收成一处 per-node（SPEC §2.3），
// 且过滤查 visited（来路恒显示可选·SPEC §2.4·顺带收掉旧过滤没查 visited 的潜伏 bug）。

import type { GameState, RunState, NodeChoice, FeatureChoice, DiveNode, NodeGate } from '@/types';
import { getNextChoices } from './mapgen';
import { getUpgradeBonuses } from './upgrades';
import {
  lampOn,
  lampPreview,
  LOCKED_DARK_PREVIEW,
  LOCKED_SONAR_PREVIEW,
} from './clarity';

/** run.activeFlags 里「某房某 feature 已探」的 key（run 级、不入存档形状）。 */
export function featureDoneFlag(nodeId: string, featureId: string): string {
  return `feat:${nodeId}:${featureId}`;
}

/** 门锁住的中性兜底预览（gate.reason 优先·感知门 SPEC §2.3）。 */
const LOCKED_FALLBACK: Record<NodeGate['sense'], string> = {
  lamp: LOCKED_DARK_PREVIEW, // '太暗，看不清——需要灯'
  sonar: LOCKED_SONAR_PREVIEW, // '得扫一记声呐才认得清'
};

/**
 * 门豁免（感知门 SPEC §2.3/§5）：地标（上浮口/气穴/扎营）+ Lv.1 已标记尸体——结构性可感 / 地图知识·不被整潜门锁。
 * ＝旧 dive-select `exemptGate` 同款豁免（isLandmark || corpseMarked）。**只豁免整潜门**——per-node gate 本就不撒到地标
 * （sprinkleGates 候选只 event/rest），故有 per-node gate 的节点不会命中豁免（effectiveGate 已优先取 node.gate）。
 */
export function isGateExempt(node: DiveNode, run: RunState, revealCorpseHint: boolean): boolean {
  const isLandmark = node.kind === 'ascent_point' || node.kind === 'air_pocket' || node.kind === 'camp';
  const corpseMarked = node.kind === 'corpse' && revealCorpseHint && lampOn(run);
  return isLandmark || corpseMarked;
}

/**
 * 这个节点**实际生效**的门（感知门 SPEC·live-combine·架构决定）：per-node `node.gate` 优先；缺省则落 run 级整潜门
 * `run.diveModifier.gate`（除非该节点被豁免＝地标/Lv.1 尸体）。**不 stamp**——mapgen 输出 byte-identical、旧 live 语义保真。
 */
export function effectiveGate(node: DiveNode, run: RunState, revealCorpseHint: boolean): NodeGate | undefined {
  return node.gate ?? (isGateExempt(node, run, revealCorpseHint) ? undefined : run.diveModifier?.gate);
}

/**
 * 该节点的门是否已解锁（感知门 SPEC §2.2·按 sense 分流·单一真相）：
 *   无门 → true；lamp 门 → 灯亮且有电（lampOn·持续态）；sonar 门 → 本潜已扫过（scanMemory 有记·一记 ping 粘住）。
 */
export function gateUnlocked(node: DiveNode, run: RunState, revealCorpseHint: boolean): boolean {
  const g = effectiveGate(node, run, revealCorpseHint);
  if (!g) return true;
  return g.sense === 'lamp' ? lampOn(run) : run.scanMemory[node.id] !== undefined;
}

/**
 * 派生门标注（感知门 SPEC §3·**纯函数**·engine 算·守 engine↛ui quirk #95）。从当前节点的子集算：
 * 只 **hidden** 子驱动标注（locked 子自己在选项上就标着「需要灯/声呐」·不必汇总）。
 *   - 无 free（普通子·全被门挡）→「这里完全探不动 · 需要<实际缺的 sense>」
 *   - free + hiddenL →「暗处还有去处 · 需要灯」
 *   - free + hiddenS →「还有声呐才找得到的岔口 · 需要声呐」
 *   - 同时 hiddenL & hiddenS → 两句都列（§10.3）
 *   - 仅 locked 无 hidden → null（选项自显）
 * 文案占位·作者后调。
 */
export interface GateNotice {
  /** 一或两句标注（占位文案）。 */
  lines: string[];
}
export function deriveGateNotice(node: DiveNode, run: RunState, revealCorpseHint: boolean): GateNotice | null {
  const children = (node.connectsTo ?? [])
    .map((id) => run.map?.nodes[id])
    .filter((n): n is DiveNode => !!n);
  let hasFree = false;
  let hiddenL = false;
  let hiddenS = false;
  for (const c of children) {
    const g = effectiveGate(c, run, revealCorpseHint);
    if (!g) {
      hasFree = true;
    } else if (g.mode === 'hidden') {
      if (g.sense === 'lamp') hiddenL = true;
      else hiddenS = true;
    }
    // locked 子不驱动标注（选项自显）。
  }

  if (!hasFree) {
    // 全被门挡（不管隐藏还是锁住）：列实际缺的 sense。
    const senses = new Set<NodeGate['sense']>();
    for (const c of children) {
      const g = effectiveGate(c, run, revealCorpseHint);
      if (g && !gateUnlocked(c, run, revealCorpseHint)) senses.add(g.sense);
    }
    const need = [...senses].map((s) => (s === 'lamp' ? '灯' : '声呐')).join(' / ');
    return { lines: [`这里完全探不动 · 需要${need || '灯'}`] };
  }

  const lines: string[] = [];
  if (hiddenL) lines.push('暗处还有去处 · 需要灯');
  if (hiddenS) lines.push('还有声呐才找得到的岔口 · 需要声呐');
  return lines.length > 0 ? { lines } : null;
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
 * 该 sense 现在「能不能主动揭示」（感知门 SPEC §5.1 canReveal）：
 *   lamp → 身上有灯可开（拥有照明件·不看当前电量·入口谓词口径）；sonar → 已解锁 + 这一站还没扫过。
 */
function senseCanReveal(run: RunState, sense: NodeGate['sense']): boolean {
  if (sense === 'lamp') {
    // 身上有灯可开（灯槽有件）——不看当前电量（想看＝开灯，哪怕只剩一格）。run.sensors.light 是当前开关态·不是「有没有灯」。
    return run.equipment.light !== null;
  }
  // 声呐：已解锁且这一站还没 ping（ping 过即已揭示·不能再靠它现出新东西）。
  return run.sensors.sonarUnlocked && run.sensors.sonar !== 'ping';
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

  const visitedSet = new Set(run.visitedNodeIds);
  // 打捞行会 Lv.1（revealCorpseHint）才在选点界面"预知"尸体；否则尸体节点伪装成普通水道，
  // 玩家只能撞上去才发现（moveToNode 仍按 kind==='corpse' 路由到 CorpseView，与提示无关）。
  const revealCorpseHint = getUpgradeBonuses(state.profile).revealCorpseHint;

  // 感知门（感知门 SPEC §2.3·统一过滤 + 表现）：门判定全走 effectiveGate/gateUnlocked（per-node gate 优先·缺省落整潜门）。
  //   - visited（来路）恒显示可选（§2.4·迷路图能原路退回·顺带收掉旧 `hasLamp||!n.dark` 没查 visited 的潜伏 bug）；
  //   - hidden 未解锁的非来路子 → 过滤掉（不显示）；locked / 已解锁 → 留下；
  //   - 地标 / Lv.1 尸体经 effectiveGate 豁免整潜门（恒诚实真相·结构可感 / 地图知识）。
  const NEUTRAL_CORPSE = '前方的水暗下去，看不清里面有什么。';
  const choices: NodeChoice[] = nextChoices
    .filter((n) => visitedSet.has(n.id) || gateUnlocked(n, run, revealCorpseHint) || effectiveGate(n, run, revealCorpseHint)?.mode !== 'hidden')
    .map((n) => {
      const isCorpse = n.kind === 'corpse';
      const isLandmark = n.kind === 'ascent_point' || n.kind === 'air_pocket' || n.kind === 'camp';
      const visited = visitedSet.has(n.id);
      const g = effectiveGate(n, run, revealCorpseHint);
      // locked：有门 + 未解锁 + 非来路（来路恒可选·到此 locked 必是 mode==='locked'——hidden 未解锁已被过滤掉）。
      const locked = !!g && !gateUnlocked(n, run, revealCorpseHint) && !visited;
      // Lv.1 标记的尸体——尸体定位是地图知识、灯门不锁它（守 quirk #36/#58）。
      const corpseMarked = isCorpse && revealCorpseHint && lampOn(run);

      let preview: string;
      if (locked) {
        // locked 预览：真实成因优先（gate.reason·内容供），否则 sense 的中性兜底。
        preview = g!.reason ?? LOCKED_FALLBACK[g!.sense];
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
        // 尸体提示只在未锁 + 有 Lv.1 才给（锁住时读不出"熟悉的轮廓"）。
        hasCorpseHint: isCorpse && corpseMarked && !locked,
        visited,
        // 门二态：未锁＝'full'（灯下诚实真相·非锁不需灯也 full）/ 锁＝'none'（盲）。
        clarity: locked ? 'none' : 'full',
        ...(locked ? { locked: true, ...(g ? { gateSense: g.sense } : {}) } : {}),
      };
    });

  // 空屏处理（感知门 SPEC §5·取代旧 repair）：判定看**过滤后**可见数（非过滤前 raw children）+ 有没有还能揭示的门。
  //   visible 非空 或 有 feature → 正常显示选点屏。
  //   visible 空 且 无 feature：
  //     canReveal（有 hidden 子 且 对应 sense 现在可操作）→ 显示（否则空的）选点屏 + §3 标注 + 保留 开灯/扫声呐/主动上浮（给玩家先动一下的机会）；
  //     否则 → 走已有「死路自动上浮」（仅层状叶子会 0-出口·迷路图恒有来路·§2.4）。
  if (choices.length === 0 && features.length === 0) {
    const hiddenChildren = nextChoices.filter(
      (n) => !visitedSet.has(n.id) && effectiveGate(n, run, revealCorpseHint)?.mode === 'hidden',
    );
    const canReveal = hiddenChildren.some((n) => {
      const g = effectiveGate(n, run, revealCorpseHint)!;
      return senseCanReveal(run, g.sense);
    });
    if (!canReveal) {
      // 没有可揭示的门 → 走到图的尽头，自动进入上浮（原「死路自动上浮」）。
      return { ...state, phase: { kind: 'ascent', targetDepth: 0 } };
    }
    // canReveal：落空的选点屏（choices 空但保留头部开灯/扫声呐/主动上浮 + §3 标注「完全探不动」），别急着自动上浮。
  }

  return {
    ...state,
    phase: {
      kind: 'dive',
      subPhase: { kind: 'nodeSelect', choices, features: features.length ? features : undefined },
    },
  };
}
