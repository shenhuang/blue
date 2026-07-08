// The Warren 追猎态（run 级）——女王在哪间卵室 / 密度热度场 / 撤退目标
//
// 三卵室重设计（作者 2026-07-08）：女王没理由待在没有卵的房间 ⇒ 三间卵室都是 hatchery。她**随机**起于其一，
// 被打进暴露窗就**随机**撤到剩下两间之一，撤进第三间＝背水一战（无处可退·可杀·见 combat-warren.ts::isWarrenLastStand）。
//
// 「离玩家最远 / 离当前最远」在三角拓扑上**双双退化**——三间两两 2 跳等距，且她逃走那刻你正站在她原来那间里，
// 剩下两间对你也都是 2 跳。故**随机是唯一有信息量的撤退规则**（作者 2026-07-08 反问推出）。别改成「最远」。
//
// 卵室识别**从地图读**（`kind==='boss'`）而不是硬编码 id：洞穴形状以后要改（作者明确担心这点），
// 本模块不该跟着改。mapgen-warren.ts 只负责把三间标成 boss。
//
// 密度热度（SPEC §8/§9.5）：`spawnDensity(node) = f(到 queenNodeId 的跳数)`，她被撤后**重算**，派生·不入存档（#99）。
// 它同时是**搜寻信号**——声呐只听得见「一大团活物」而分不清（作者拍板），唯一诚实可读的是你撞上多少阻力。
// 「入口无敌人」因此不必硬写：入口离任一卵室 4 跳，表长 4 ⇒ f(4)=0，是**定理不是巧合**（洞形改了也成立）。
// 耗氧**不吃这个场**（作者 2026-07-08 否决：氧气来自气瓶·且靠近她已经通过「更多遭遇＝更多回合」间接惩罚了·别重复计数）。

import type { DiveMap, RunState } from '@/types';
import { hopField } from './graph';

/**
 * 密度查表：`WARREN_DENSITY_BY_HOPS[阶段][跳数] → Spawn 权重`。**表长即热度作用半径**——
 * 跳数 ≥ 表长恒为 0，外围无敌人是结构保证，不靠 epsilon 截断（闭式 `c/n^d` 永不为 0，故用表·作者 2026-07-08）。
 * 行 = `roomsCleared`（0/1/2）⇒ 「第二次会更难打」直接表达成分行递增（作者）。
 * **数值全占位·待作者最后一次性调**（defer-number-tuning）。要指数曲线就把 `c/n^d` 取整填进来——表是载体、曲线是填法。
 */
export const WARREN_DENSITY_BY_HOPS: readonly (readonly number[])[] = [
  [3, 2, 1, 0], // roomsCleared=0
  [4, 3, 1, 0], // roomsCleared=1
  [5, 3, 2, 0], // roomsCleared=2（背水一战）
];

/** 三间卵室（从地图读·`kind==='boss'`·排序保证确定性）。非 warren 图 ⇒ 空数组 ⇒ 一切调用点自然 no-op。 */
export function warrenChambers(map: DiveMap): string[] {
  return Object.values(map.nodes)
    .filter((n) => n.kind === 'boss')
    .map((n) => n.id)
    .sort();
}

/**
 * 该节点的 Spawn 密度权重（派生·不入存档）。女王未落位 / 非 warren 图 / 够远 ⇒ 0。
 * 复用通用 `hopField`（一趟 BFS·O(V+E)），`maxHops` 按表长截断＝只遍历真正会有敌人的那一圈。
 */
export function warrenSpawnDensity(map: DiveMap, run: RunState, nodeId: string): number {
  const queen = run.warrenHunt?.queenNodeId;
  if (!queen || !map.nodes[queen]) return 0;
  const row = WARREN_DENSITY_BY_HOPS[Math.min(run.warrenHunt?.roomsCleared ?? 0, WARREN_DENSITY_BY_HOPS.length - 1)];
  const d = hopField(map, [queen], row.length)[nodeId];
  return d === undefined ? 0 : (row[d] ?? 0);
}

/** 随机取一个（确定性由调用方的 seeded rng 保证——scenario 用 withSeededRandom 包住）。 */
function pickOne<T>(arr: readonly T[], rng: () => number): T | undefined {
  return arr.length ? arr[Math.floor(rng() * arr.length) % arr.length] : undefined;
}

/**
 * 女王起始落位：三间卵室里**随机**一间。已落位 ⇒ 原样返回（幂等·月相窗内续追猎不重掷）。
 * 非 warren 图（无 boss 节点）⇒ 原样返回 ⇒ 普通下潜逐字节不变。
 * 月相窗过期时 `dive-start.ts::resolveWarrenHuntCarry` 会把整个 warrenHunt 丢掉 ⇒ 下次进洞在此重掷＝作者要的「完全重置」。
 */
export function ensureQueenPlaced(run: RunState, rng: () => number = Math.random): RunState {
  if (!run.map) return run;
  if (run.warrenHunt?.queenNodeId) return run;
  const chambers = warrenChambers(run.map);
  const start = pickOne(chambers, rng);
  if (!start) return run;
  const prev = run.warrenHunt ?? { roomsCleared: 0 };
  return { ...run, warrenHunt: { ...prev, queenNodeId: start, usedChambers: [start], wallDown: false } };
}

/**
 * 女王被撤走 → 在**剩下未用过的**卵室里随机挑一间（她每间只用一次：起始 + 两次撤退＝三间用尽＝背水一战）。
 * 同时 `roomsCleared+1`、记入 `usedChambers`、**重置 `wallDown`**（新一道封口墙堵在她新那间门口·SPEC §5）。
 * 候选为空（理论上不该发生——背水一战时禁撤已在 `maybeSwarmQueenRelocate` 拦下）⇒ 只 +1 不动位置（防御性·不崩）。
 */
export function advanceQueenRelocation(run: RunState, rng: () => number = Math.random): RunState['warrenHunt'] {
  const prev = run.warrenHunt ?? { roomsCleared: 0 };
  const next = { ...prev, roomsCleared: prev.roomsCleared + 1 };
  if (!run.map) return next;
  const used = new Set(prev.usedChambers ?? (prev.queenNodeId ? [prev.queenNodeId] : []));
  const candidates = warrenChambers(run.map).filter((c) => !used.has(c));
  const target = pickOne(candidates, rng);
  if (!target) return next;
  return { ...next, queenNodeId: target, usedChambers: [...used, target], wallDown: false };
}
