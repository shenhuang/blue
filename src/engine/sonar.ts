// 声呐探索扫描（下潜内）—— 几何圆揭示模型（作者 2026-06-13 重设计）。
//
// 一次扫描以**你当前所在的节点**为圆心、在声呐图上揭示一块半径 SONAR_REVEAL_R 的圆形区域（渲染层 ui/SonarScanPanel
// 几何遮罩）。本文件只管两件**纯逻辑**：
//   1) run.scanMemory ＝「扫描中心记忆」：nodeId → 上一次在该节点发出扫描的回合（dive-sensors.scanReveal 只盖**当前节点**）。
//      渲染按这些中心 + 半径画圆：没扫过=黑 / 本回合中心圆=亮（随扩散圆点亮）/ 以前的中心圆=暗（常驻·不回黑）。
//   2) revealSonarScan（无向 BFS·跳数 sonarScanRange）＝**猎手听觉量程**：声呐能不能「听到」猎手（stalker.scanStalker 用）。
//      ⚠ 这是 gameplay 探测，按图跳数算，与上面的几何圆揭示（视觉·按世界距离）有意分开——量程升级只影响听猎手、不改圆。
//
// 不可信表象（spoof/evade/低 san 假回波）住 engine/clarity.ts；房间大小派生（hash01/roomScale01）渲染与 gameplay 同源。
// 扫描态全走 run 级、不入存档语义、不 bump SAVE_VERSION（纯对象 JSON round-trip）。

import type { DiveMap, RunState } from '@/types';

// ============================================================
// 可调参数（tunables）
// ============================================================

/**
 * 猎手听觉量程的**基线**跳数（无向 BFS 半径）。起步小＝只「听」得到身边一跳。
 * **范围是声呐量程的升级轴**（接 #60 桥·经 sonarScanRangeBonus → deriveSensorTuning → run.sensorTuning.sonarScanRange）。
 * ⚠ 只管「能否听到猎手」（scanStalker）——视觉揭示圆是几何的（SonarScanPanel.SONAR_REVEAL_R）、与此无关。
 */
export const SONAR_SCAN_RANGE = 1;

/** 猎手听觉量程跳数的**上限**（升级升满也到此为止）——再升也听不穿整洞（守北极星）。 */
export const SONAR_SCAN_RANGE_MAX = 4;

/**
 * 本次下潜的有效声呐量程跳数：读 run.sensorTuning（升级派生·deriveSensorTuning 已夹紧到 [基线, 上限]；
 * 未升级＝基线常量·sensorTuning 必有〔createNewRun 种 / hydrate 补〕）。
 */
export function sonarScanRange(run: RunState): number {
  return run.sensorTuning.sonarScanRange;
}

// ============================================================
// 真图揭示（猎手听觉量程·无向 BFS）
// ============================================================

/**
 * 无向邻接表：声呐从你这点全向扩散，故按**无向**邻居算（层状图里也照得到你来时的上游、同层旁支）。
 * 与 ui/mapLayout 的无向去重一致（同一张图的两种视角：邻接给「听到谁」、布局给「画在哪」）。
 */
export function buildUndirectedAdjacency(map: DiveMap): Record<string, string[]> {
  const adj: Record<string, Set<string>> = {};
  const add = (a: string, b: string) => {
    (adj[a] ??= new Set<string>()).add(b);
  };
  for (const n of Object.values(map.nodes)) {
    for (const to of n.connectsTo) {
      if (!map.nodes[to]) continue;
      add(n.id, to);
      add(to, n.id);
    }
  }
  const out: Record<string, string[]> = {};
  for (const k of Object.keys(adj)) out[k] = [...adj[k]];
  return out;
}

// ============================================================
// 节点「房间大小」（声呐与房间 §5「房间/隧道粗细」·猎手 SPEC §5「容得下多大」）
// 与 ui/SonarScanPanel 有机洞穴渲染的房间半径**同一来源**（同 hash 同前缀）——
// 玩家在声呐图上看到的房间大小就是游戏性上的「容得下多大」：最小的那挡＝窄缝，大型猎手钻不进。
// 纯派生（按 node id 哈希）·不入存档·不改 mapgen 输出（快照零变化）。
// ============================================================

/** 确定性字符串 hash → [0,1)。**与 SonarScanPanel.hash01 逐字相同**（单一来源迁居于此·面板反向 import）。 */
export function hash01(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return (h % 100000) / 100000;
}

/**
 * 节点房间大小标度 [0,1)（0=最窄）。渲染半径＝ROOM_BASE + ROOM_VAR × 此值（SonarScanPanel.roomRadius）；
 * 游戏性「容得下多大」读同一标度（nodeIsNarrow）＝看图可读、不另设暗值（洞穴一致性 #100 延伸）。
 */
export function roomScale01(nodeId: string): number {
  return hash01('r' + nodeId);
}

/** 窄缝判定线：房间标度 < 此值＝「窄」（约最小的 28% 房间）。猎手 SPEC §5 tunable。 */
export const NARROW_ROOM_SCALE = 0.28;

/** 该节点是不是大型生物钻不进的「窄缝/小室」（猎手 SPEC §5）。与声呐图上画出的最小房间一致。 */
export function nodeIsNarrow(nodeId: string): boolean {
  return roomScale01(nodeId) < NARROW_ROOM_SCALE;
}

/**
 * 一记 ping 从 originId 无向 BFS 到 range 跳为止能「听到」的节点 id（含 origin 自己）。
 * 猎手听觉量程用（scanStalker）：能不能听到那只猎手。确定性、纯函数（读真图·不读 evade/spoof）。
 */
export function revealSonarScan(map: DiveMap, originId: string, range: number): string[] {
  if (!map.nodes[originId]) return [];
  const adj = buildUndirectedAdjacency(map);
  const seen = new Set<string>([originId]);
  let frontier: string[] = [originId];
  for (let hop = 0; hop < range; hop++) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const nb of adj[id] ?? []) {
        if (!seen.has(nb)) {
          seen.add(nb);
          next.push(nb);
        }
      }
    }
    frontier = next;
    if (frontier.length === 0) break;
  }
  return [...seen];
}
