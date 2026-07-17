// 持久洞登记表加载器（多口持久洞 SPEC §2.4·方案 B）。
// 单一来源 data/caves.json → CaveGenParams；生成（mapgen.generatePersistentCaveMap）、绑定（dive-start caveEntry 解析）、
// 守门（check-cave-bindings）共用 getCave，保证「图上写的洞 = 潜下去的洞」同源（同 getZone 模式）。
// 没登记的 zone 保持每潜重生（#98）——getCave(undefined) → undefined。

import cavesData from '@/data/caves.json';
import type { CaveGenParams, CavePortal, PlayerProfile, RunState } from '@/types';

// JSON 把 depthRange 推成 number[]，CaveGenParams 要 [number,number] 元组 → 经 unknown 收口（同 zones.json 套路）。
const CAVES: CaveGenParams[] = (cavesData as unknown as { caves: CaveGenParams[] }).caves;
const BY_ID = new Map<string, CaveGenParams>(CAVES.map((c) => [c.caveId, c]));

/** 取某持久洞的生成参数；未登记 → undefined（非持久洞·走 zone/band 旧路径）。 */
export function getCave(caveId: string | undefined): CaveGenParams | undefined {
  if (caveId == null) return undefined;
  return BY_ID.get(caveId);
}

/** 全部已登记的持久洞（守门脚本 / dev 面板枚举用）。 */
export function allCaves(): CaveGenParams[] {
  return CAVES;
}

// ── 渲染契约（多口持久洞 SPEC §6·给声呐图 + T3b 海图）──────────────────────

/**
 * 当前下潜所属持久洞的「跨 run 已探」节点集（多口持久洞 §6.1）：声呐图/选点 UI 据它**预亮已探片**
 * （同一张图、不同已探片）——叠加在本潜 scanMemory/visited 之上。非洞下潜 / 未进过该洞 → undefined（零影响·旧行为不变）。
 */
export function persistentExploredForRun(profile: PlayerProfile, run: RunState | undefined): Set<string> | undefined {
  if (!run?.diveMapId) return undefined;
  return profile.diveMaps.get(run.diveMapId)?.explored;
}

/**
 * 某持久洞已落定的门户清单（多口持久洞 §6.2·给 T3b 海图「同洞分组 / 口深展示」）。
 * 海图把同 caveEntry.caveId 的多个 POI 标成同一洞；本函数给出该洞图上的入口/出口门户（深度/区域）供展示。
 * 未进过该洞（未生成冻结）→ undefined（海图仍可按 caveId 分组·门户深度待首次进后可见）。
 */
export function cavePortalsForChart(profile: PlayerProfile, caveId: string): CavePortal[] | undefined {
  return profile.diveMaps.get(caveId)?.portals;
}
