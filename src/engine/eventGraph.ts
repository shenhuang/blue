// 剧情编辑器支撑（只读 EVENT_DB + 战斗 encounter·不引 UI）—— 事件链/分支图重建。
//
// 一段「剧情」= 从某个 root 事件出发、顺着 triggerEventId 能走到的事件子图。
// 节点 = DiveEvent；有向边 = 一个选项（或检定成/败分支、或 onEnter）指向的下一个事件。
// 供剧情编辑器：① 右侧「链」视图 ② 树/分支图面板 ③ 左库按「弧头」分组。
//
// 边的来源（穷举一个事件能流向的下一个事件）：
//   - ev.onEnter.triggerEventId                      branch='onEnter'
//   - option.outcome.triggerEventId                  branch='option'
//   - option.check.onSuccess.triggerEventId          branch='success'
//   - option.check.onFailure.triggerEventId          branch='failure'
//   - {onEnter|option|成败}.triggerCombatId → 该 encounter.victoryEventId   branch='combatVictory'
//     （战斗胜利后回流的事件·combat.ts::finalizeVictory；无 victoryEventId=战斗后回普通下潜·不连边）
// triggerEventId 指向不存在的事件 → edge.missing=true（check-dive-refs 已在 regress 守引用完整性）。

import type { DiveEvent, Tone, ZoneTag } from '@/types';
import { EVENT_DB, getEventById } from './zones';
import { getEncounter } from './combat';

export type ArcBranch = 'onEnter' | 'option' | 'success' | 'failure' | 'combatVictory';

export interface ArcEdge {
  from: string;
  to: string;
  /** 触发它的选项 id（onEnter 边为 '(onEnter)'）。 */
  optionId: string;
  /** 选项 label（onEnter 边为 '进入即触发'），便于树上显示分支名。 */
  label: string;
  branch: ArcBranch;
  /** to 在库中找不到（断链）。 */
  missing: boolean;
  /** combatVictory 边专属：经哪场战斗续接（option→triggerCombatId→该 encounter.victoryEventId）。 */
  combatId?: string;
}

export interface ArcNode {
  id: string;
  title: string;
  tone: Tone;
  depthRange: [number, number];
  zoneTags: ZoneTag[];
  optionCount: number;
  /** weight<=0：只能强制触发（多为链中节点 / 教程）。 */
  forceOnly: boolean;
  /** 距 root 的最短跳数（root=0），用于树/分层布局。 */
  depthLevel: number;
}

export interface EventArc {
  rootId: string;
  nodes: ArcNode[];
  edges: ArcEdge[];
  /** 库中指向 root 的边（谁能触发这段剧情的头）——反向溯源。 */
  inbound: ArcEdge[];
  /** 检测到的环（节点 id 列表，每个环一条）。 */
  cycles: string[][];
  /** 本弧内指向不存在事件的 triggerEventId。 */
  missingTargets: string[];
}

type Resolver = (id: string) => DiveEvent | undefined;

function makeResolver(events?: Map<string, DiveEvent>): Resolver {
  return (id) => events?.get(id) ?? getEventById(id);
}

function allEvents(events?: Map<string, DiveEvent>): DiveEvent[] {
  return events ? [...events.values()] : [...EVENT_DB.values()];
}

/**
 * 一个事件能流向的所有下一个事件：
 *   - triggerEventId（onEnter / outcome / check 成败）直接续接；
 *   - triggerCombatId 经战斗续接——连到该 encounter 的 victoryEventId（战斗胜利后回流的事件·
 *     combat.ts::finalizeVictory 单一来源）。无 victoryEventId（战斗后回普通下潜·无剧情续接）⇒ 不连边。
 */
export function outgoingEdges(ev: DiveEvent, resolve: Resolver = makeResolver()): ArcEdge[] {
  const edges: ArcEdge[] = [];
  const push = (to: string | undefined, optionId: string, label: string, branch: ArcBranch) => {
    if (!to) return;
    edges.push({ from: ev.id, to, optionId, label, branch, missing: !resolve(to) });
  };
  // 战斗续接：triggerCombatId → 该战斗 encounter 的 victoryEventId（与引擎胜利路由同址·别在事件侧重写跳转）。
  const pushCombat = (combatId: string | undefined, optionId: string, label: string) => {
    if (!combatId) return;
    const to = getEncounter(combatId)?.victoryEventId;
    if (!to) return;
    edges.push({ from: ev.id, to, optionId, label: `${label} · 战斗胜利`, branch: 'combatVictory', missing: !resolve(to), combatId });
  };

  push(ev.onEnter?.triggerEventId, '(onEnter)', '进入即触发', 'onEnter');
  pushCombat(ev.onEnter?.triggerCombatId, '(onEnter)', '进入即战斗');
  for (const opt of ev.options) {
    push(opt.outcome?.triggerEventId, opt.id, opt.label, 'option');
    pushCombat(opt.outcome?.triggerCombatId, opt.id, opt.label);
    if (opt.check) {
      push(opt.check.onSuccess.triggerEventId, opt.id, `${opt.label} · 成功`, 'success');
      pushCombat(opt.check.onSuccess.triggerCombatId, opt.id, `${opt.label} · 成功`);
      push(opt.check.onFailure.triggerEventId, opt.id, `${opt.label} · 失败`, 'failure');
      pushCombat(opt.check.onFailure.triggerCombatId, opt.id, `${opt.label} · 失败`);
    }
  }
  return edges;
}

function toNode(ev: DiveEvent, depthLevel: number): ArcNode {
  return {
    id: ev.id,
    title: ev.title,
    tone: ev.tone,
    depthRange: ev.depthRange,
    zoneTags: ev.zoneTags ?? [],
    optionCount: ev.options.length,
    forceOnly: ev.weight <= 0,
    depthLevel,
  };
}

/** 从 root 顺着 triggerEventId 重建一段剧情的图。events 覆盖优先（测内存里未保存的编辑）。 */
export function eventArc(rootId: string, events?: Map<string, DiveEvent>): EventArc | null {
  const resolve = makeResolver(events);
  const root = resolve(rootId);
  if (!root) return null;

  const nodes = new Map<string, ArcNode>();
  const edges: ArcEdge[] = [];
  const missingTargets = new Set<string>();
  const cycles: string[][] = [];

  // BFS 建节点 + 边（分层 depthLevel）
  const level = new Map<string, number>([[rootId, 0]]);
  const queue: string[] = [rootId];
  nodes.set(rootId, toNode(root, 0));
  while (queue.length > 0) {
    const id = queue.shift()!;
    const ev = resolve(id);
    if (!ev) continue;
    const d = level.get(id) ?? 0;
    for (const e of outgoingEdges(ev, resolve)) {
      edges.push(e);
      if (e.missing) {
        missingTargets.add(e.to);
        continue;
      }
      if (!nodes.has(e.to)) {
        const nextEv = resolve(e.to)!;
        level.set(e.to, d + 1);
        nodes.set(e.to, toNode(nextEv, d + 1));
        queue.push(e.to);
      }
    }
  }

  // 环检测：在「弧内可达」子图上做 DFS，记录回到祖先的边
  const onStack = new Set<string>();
  const done = new Set<string>();
  const stack: string[] = [];
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    if (e.missing) continue;
    let arr = adj.get(e.from);
    if (!arr) {
      arr = [];
      adj.set(e.from, arr);
    }
    arr.push(e.to);
  }
  const dfs = (id: string): void => {
    onStack.add(id);
    stack.push(id);
    for (const to of adj.get(id) ?? []) {
      if (onStack.has(to)) {
        const i = stack.indexOf(to);
        if (i >= 0) cycles.push(stack.slice(i).concat(to));
      } else if (!done.has(to)) {
        dfs(to);
      }
    }
    onStack.delete(id);
    stack.pop();
    done.add(id);
  };
  dfs(rootId);

  // 反向溯源：库中谁指向 root
  const inbound: ArcEdge[] = [];
  for (const ev of allEvents(events)) {
    if (ev.id === rootId) continue;
    for (const e of outgoingEdges(ev, resolve)) {
      if (e.to === rootId) inbound.push(e);
    }
  }

  return {
    rootId,
    nodes: [...nodes.values()].sort((a, b) => a.depthLevel - b.depthLevel || a.id.localeCompare(b.id)),
    edges,
    inbound,
    cycles,
    missingTargets: [...missingTargets],
  };
}

/** 「弧头」：库中没有任何事件触发它的事件（剧情线的起点）。左库分组用。 */
export function eventRoots(events?: Map<string, DiveEvent>): string[] {
  const resolve = makeResolver(events);
  const all = allEvents(events);
  const triggered = new Set<string>();
  for (const ev of all) {
    for (const e of outgoingEdges(ev, resolve)) {
      if (!e.missing) triggered.add(e.to);
    }
  }
  return all
    .map((e) => e.id)
    .filter((id) => !triggered.has(id))
    .sort((a, b) => a.localeCompare(b));
}
