// The Warren 追猎态（run 级）——女王在哪间卵室 / 密度热度场 / 撤退目标 / 存卵 / 到达路由决策
//
// 三卵室重设计（作者 2026-07-08）：女王没理由待在没有卵的房间 ⇒ 三间卵室都是 hatchery。她**随机**起于其一，
// 被打进暴露窗就**随机**撤到剩下两间之一，撤进第三间＝背水一战（无处可退·可杀·见 isWarrenLastStand）。
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
//
// 存卵（SPEC §8·作者「很重要」）：每间卵室存一个卵数（warrenHunt.eggs）。你**提前凿卵** ⇒ 她撤过去时卵更少 ⇒
// 直接削她的身体库存（§15.1）、缩短终局回血耗尽赛。她撤离旧那间时那间存卵清零（随她一并耗尽）。因撤退**随机**，
// 预清剩余两间中的一间是 50% 赌注、两间都清要拿氧气换——这层张力是「随机」自己长出来的，别削。
//
// 到达路由决策（SPEC §5/§8/§9·纯函数·buildWarrenArrival 据此组装遭遇）：她那间墙未破＝封口墙 / 墙已破＝女王阶段 /
// 非她那间且有卵＝空卵室 / 已清空＝安静水域（重访不重播）。

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

/**
 * 女王一共有三间卵室（作者 2026-07-08 三卵室重设计）：随机起于其一，被打退随机换一间，**撤进第三间＝背水一战**。
 * 故「无处可退」＝已撤过 2 次 ＝ `roomsCleared >= 2`。三卵室数量若变，只改这一个常量。
 * 单一真相住 warren-hunt（combat-warren.ts::isWarrenLastStand 的口径同源·被 warrenArrivalEncounterId 复用·免 import 环）。
 */
export const WARREN_LAST_STAND_ROOMS = 2;

/** 每间卵室初始存卵数（占位·待作者调·defer-number-tuning）。ensureQueenPlaced 落位时给三间各种一份。 */
export const WARREN_EGGS_PER_CHAMBER = 3;

/** The Warren 到达遭遇 id 单一真相（mapgen 空卵室默认 + warrenArrivalEncounterId 路由 + buildWarrenArrival 组装共用）。 */
export const WARREN_ENC = {
  wallSpawn: 'combat.warren_wall_spawn',
  wallGuards: 'combat.warren_wall_guards',
  room1: 'combat.warren_room1',
  room2: 'combat.warren_room2',
  hatchery: 'combat.warren_hatchery',
  brood: 'combat.warren_brood_chamber',
} as const;

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
 * 女王起始落位：三间卵室里**随机**一间，并给三间各种一份初始存卵。已落位 ⇒ 原样返回（幂等·月相窗内续追猎不重掷）。
 * 非 warren 图（无 boss 节点）⇒ 原样返回 ⇒ 普通下潜逐字节不变（pickOne 对空数组不消耗 rng）。
 * 月相窗过期时 `dive-start.ts::resolveWarrenHuntCarry` 会把整个 warrenHunt 丢掉 ⇒ 下次进洞在此重掷 + 存卵复原＝作者要的「完全重置」。
 */
export function ensureQueenPlaced(run: RunState, rng: () => number = Math.random): RunState {
  if (!run.map) return run;
  if (run.warrenHunt?.queenNodeId) return run;
  const chambers = warrenChambers(run.map);
  const start = pickOne(chambers, rng);
  if (!start) return run;
  const prev = run.warrenHunt ?? { roomsCleared: 0 };
  const eggs: Record<string, number> = {};
  for (const c of chambers) eggs[c] = WARREN_EGGS_PER_CHAMBER;
  return { ...run, warrenHunt: { ...prev, queenNodeId: start, usedChambers: [start], wallDown: false, eggs } };
}

/**
 * 女王被撤走 → 在**剩下未用过的**卵室里随机挑一间（她每间只用一次：起始 + 两次撤退＝三间用尽＝背水一战）。
 * 同时 `roomsCleared+1`、记入 `usedChambers`、**重置 `wallDown`**（新一道封口墙堵在她新那间门口·SPEC §5），
 * 并把**旧那间的存卵清零**（她撤离时那间的卵随之耗尽 ⇒ 重访＝安静水域·§8）。
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
  const eggs = { ...(prev.eggs ?? {}), ...(prev.queenNodeId ? { [prev.queenNodeId]: 0 } : {}) };
  return { ...next, queenNodeId: target, usedChambers: [...used, target], wallDown: false, eggs };
}

/**
 * 背水一战判据（**状态不是地点**·蜂群 boss SPEC §4）：她已把三间卵室用尽、正在最后一间。
 * 唯一真相——`startCombat` 据此写 `CombatState.warrenLastStand`，三处门控（禁撤 / 崩解取胜 / 储备零恢复）只读那个标记。
 * 无追猎档（普通遭遇 / 从未打过 Warren）⇒ roomsCleared 视作 0 ⇒ false ⇒ 一切逐字节不变。
 * （从 combat-warren.ts 移来·warren-hunt 是追猎态单一真相·warrenArrivalEncounterId 复用 WARREN_LAST_STAND_ROOMS 免 import 环。）
 */
export function isWarrenLastStand(run: RunState): boolean {
  return (run.warrenHunt?.roomsCleared ?? 0) >= WARREN_LAST_STAND_ROOMS;
}

/**
 * 到达某节点该打哪场（纯函数·蜂群 boss SPEC §5/§8/§9·作者 2026-07-08 三卵室追猎）：
 *   - 非 warren 图 / 非卵室节点（kind!=='boss'）⇒ null（dive-move 落安静水域·逐字节不变）；
 *   - **她那间**且墙未破 ⇒ 封口墙（roomsCleared=0 Spawn 墙·>=1 Guards 墙）；墙已破 ⇒ 女王阶段（room1/room2/hatchery 按 roomsCleared）；
 *   - **非她那间**且该间还有卵 ⇒ 空卵室（提前凿卵）；已清空（eggs=0）⇒ null（重访不重播·安静水域）。
 * 「找到封口＝找到她」：唯一带墙的卵室就是她真进的那间（搜寻信号＝密度热度 + 封口墙·quirk #239）。
 * 数值/背水一战阈值复用本模块 WARREN_LAST_STAND_ROOMS（单一真相·免 combat-warren import 环）。
 */
export function warrenArrivalEncounterId(run: RunState, nodeId: string): string | null {
  const wh = run.warrenHunt;
  if (!run.map || !wh) return null;
  const chambers = warrenChambers(run.map);
  if (!chambers.includes(nodeId)) return null;
  const rc = wh.roomsCleared ?? 0;
  if (nodeId === wh.queenNodeId) {
    if (!wh.wallDown) return rc >= 1 ? WARREN_ENC.wallGuards : WARREN_ENC.wallSpawn;
    return rc >= WARREN_LAST_STAND_ROOMS ? WARREN_ENC.hatchery : rc >= 1 ? WARREN_ENC.room2 : WARREN_ENC.room1;
  }
  return (wh.eggs?.[nodeId] ?? 0) > 0 ? WARREN_ENC.brood : null;
}

/** 该到达遭遇 id 是否封口墙（buildWarrenArrival 据此标 warrenWall + 不注卵）。 */
export function isWarrenWallEncounter(id: string): boolean {
  return id === WARREN_ENC.wallSpawn || id === WARREN_ENC.wallGuards;
}
