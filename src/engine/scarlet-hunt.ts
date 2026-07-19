// 猩红暴君（Scarlet Tyrant）追猎态编排——run 级·纯函数（仿 warren-hunt.ts 的拆法：追猎推进/判定与战斗
// 机制解耦；核心机制〔吃活同伴夺词条/波级词条分发/第五波剧情杀〕住 combat-scarlet.ts——本文件**不 import
// 它、也不 import 猎手 wiring 层 dive-stalker.ts**，只落 run 级判定 + 猎手对象构造，推进交给 engine/stalker.ts
// 的通用猎手主体（dive-move.ts 里跟 huntEnabled 分支共用同一个 stalkerStep）。
//
// SPEC docs/spec/深海回响_猩红暴君boss_SPEC.md（2026-07-17）：
//   §4  波次编排（1→3→4→5→暴君剧情杀）——落点/数据车道把序列精简成 4 场遭遇：wave1/2/3 常规波 +
//       wave5 兼作第五波剧情杀（观察回合 + 暴君登场瞬吃 3，见 combat-scarlet.ts），wave4 未落地。
//   §7  逃离 / hunter（复用 stalker.ts 追猎主体）——暴君阶段配执着变体：sensesBy:'both' → onLostSignal
//       恒 'seek_last'，大 patience（守口/搜寻更执着·数值占位·defer-number-tuning）。
//   §8  主线门——逃了不 bank 进度、下次从头：scarletWave 挂 RunState（非 PlayerProfile），run 结束（上浮
//       回港/死亡）随之整个丢弃，天然「不持久化」，不必另写重置逻辑。
//   §11.3⑤ 本编排**不读/不依赖 huntEnabled**——dive-move.ts 里开一条独立分支、gate 在 isScarletGrounds，
//       与 huntEnabled 三岔平级、互不干扰、互不改变对方行为。（huntEnabled 产者 #318 起＝zone.hunts〔图属性〕；
//       猩红地盘刻意不标 hunts——专属编排在，别再叠通用猎手。）
//
// 落点现状（2026-07-17「路线 P」·见 data/chart_pois.json::poi.anchor.scarlet_tyrant 注）：anchor 目前纯占位、
// 不带 story 块——SPEC §1.3 原设想的 story-pin 强制开场随 #300 主线重建 defer。scarletSeabedIntroDue（到海床
// 节点触发 SCARLET_INTRO_EVENT_ID）是当前唯一开场入口；发现门 flag.scarlet_tyrant_discovered 的置位源另由
// dev 发现车道接（本文件不碰）。

import type { RunState, GameState, Stalker } from '@/types';
import { spawnNodeFor, STALKER_SPAWN_HOPS, STALKER_WAIT_TURNS, STALKER_PATIENCE } from './stalker';
import { seabedNodeIds } from './seabed';

/** 猩红暴君落点 zone（跨车道钉死字符串·猩红暴君boss SPEC §1.2）：rock 类型开阔水域下部。 */
export const SCARLET_GROUNDS_ZONE_ID = 'zone.scarlet_tyrant_grounds';

/** 开场事件 id（跨车道钉死字符串）：wave0（scarletWave 未种/0）到海床节点触发，outcome 引第一波战斗。 */
export const SCARLET_INTRO_EVENT_ID = 'story.scarlet_tyrant_encounter';

/**
 * 波次遭遇 id 序列（跨车道钉死字符串·猩红暴君boss SPEC §4）：`run.scarletWave` 的索引表——
 * 0→wave1（1 只）/1→wave2（3 只）/2→wave3（4 只）/3→wave5（5 只→暴君剧情杀）。wave4 未落地（数据车道精简）。
 * 越界（scarletWave>=length）＝全部波次已通关，scarletCurrentEncounterId 返 null。
 */
export const SCARLET_WAVE_SEQUENCE: readonly string[] = [
  'combat.scarlet_wave1',
  'combat.scarlet_wave2',
  'combat.scarlet_wave3',
  'combat.scarlet_wave5',
];

/** 是否身处猩红暴君落点 zone（dive-move.ts 据此在 huntEnabled 三岔之前开独立分支）。 */
export function isScarletGrounds(run: RunState): boolean {
  return run.zoneId === SCARLET_GROUNDS_ZONE_ID;
}

/** 当前该打哪一波（`SCARLET_WAVE_SEQUENCE[scarletWave ?? 0]`）；全部波次已通关 → null。 */
export function scarletCurrentEncounterId(run: RunState): string | null {
  return SCARLET_WAVE_SEQUENCE[run.scarletWave ?? 0] ?? null;
}

/**
 * 开场事件是否该在这一站触发（wave0 专属·§1.3 现状下的唯一开场入口）：还没打过第一波
 * （scarletWave 未种/0）+ 还没有追猎者 + 这一站是「贴底节点」（engine/seabed.ts::seabedNodeIds，
 * rock 档开阔水域的分支终点）。无地图（教学/未生成）→ false。
 */
export function scarletSeabedIntroDue(run: RunState, nodeId: string): boolean {
  if (!run.map) return false;
  return (run.scarletWave ?? 0) === 0 && !run.stalker && seabedNodeIds(run.map).has(nodeId);
}

/**
 * 建一只猩红追猎者（上一波胜利后、这一波还没现身时调）：在距你 STALKER_SPAWN_HOPS 跳处现身
 * （同猎手 SPEC §2.4「不是当场伏击」的现身惯例，直接借 stalker.ts::spawnNodeFor）。encounterId 取
 * scarletCurrentEncounterId（全部波次已通关 → null，调用方据此不生成）。执着变体（§7）：双感 +
 * 丢信号后「先去上次信号点、再等」+ 加倍 patience（占位·defer-number-tuning）——**不设 scent**
 * （避免触碰 stalkerScentLocked/scentSpawnReady 的 #290 惰性化点，猩红暴君boss SPEC §7 末尾明确交代）。
 * 无地图/无当前节点/图上找不到现身点 → null。
 */
export function spawnScarletPursuer(run: RunState): Stalker | null {
  const encounterId = scarletCurrentEncounterId(run);
  if (encounterId === null) return null;
  if (!run.map || !run.currentNodeId) return null;
  const node = spawnNodeFor(run.map, run.currentNodeId, STALKER_SPAWN_HOPS);
  if (!node) return null;
  return {
    nodeId: node,
    sensesBy: 'both',
    onLostSignal: 'seek_last',
    waitTurns: STALKER_WAIT_TURNS,
    state: 'hunting',
    encounterId,
    lastSignalNodeId: run.currentNodeId,
    turnsSinceSignal: 0,
    waitedTurns: 0,
    patience: STALKER_PATIENCE * 2,
  };
}

/**
 * 猩红波次胜利回写（finalizeVictory 收束时、`applyWarrenVictory` 旁调一次）：本场 combat 的 encounterId
 * 命中「当前该打的那一波」→ `scarletWave` 前进一格（下次 spawnScarletPursuer/scarletCurrentEncounterId
 * 读到下一波）。encounterId 不命中（非 scarlet 战斗，或 scarlet 波次已错位）→ 原样返回——防双计，
 * 也让非 scarlet 战斗零成本早退（逐字节不变）。纯字符串比较 + 加一，零 RNG，不影响任何 baseline 的
 * randRange 调用序列。
 */
export function applyScarletVictory(state: GameState): GameState {
  if (state.phase.kind !== 'combat' || !state.run) return state;
  const combat = state.phase.combat;
  const idx = state.run.scarletWave ?? 0;
  if (combat.encounterId !== SCARLET_WAVE_SEQUENCE[idx]) return state;
  return { ...state, run: { ...state.run, scarletWave: idx + 1 } };
}
