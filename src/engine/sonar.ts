// 声呐探索扫描（下潜内）—— 一记 ping = 规划纵深揭示（感知重做 SPEC §2.2「更远的声呐 = 预判未来的选项」）。
//
// 一记 ping 以**你当前所在的节点**为原点、无向 BFS 到 sonarScanRange 跳，把量程内的所有节点都揭示进 run.scanMemory
// 供规划（更远的射程 = 看更多跳之外的岔路/死路/蹲着的东西）。本文件只管两件**纯逻辑**：
//   1) revealSonarScan（无向 BFS·跳数 sonarScanRange）＝一记 ping 揭示/听到哪些节点：dive-sensors.scanReveal 把这批
//      节点 stamp 进 scanMemory（视觉 lookahead·SonarScanPanel 据此画几跳之外的节点 + 圆），同一批也是猎手听觉量程
//      （stalker.scanStalker 据此判能否「听到」猎手）——**视觉 lookahead 与猎手听觉同一轴**（射程升级两者一起变·SPEC §2.2）。
//   2) run.scanMemory ＝「会过时的扫描记忆」：nodeId → 上一次被 ping 揭示到的回合。渲染按几何圆（以各扫描节点为心·
//      半径 SONAR_REVEAL_R）画三态：没扫过=黑 / 本回合揭示圆=亮（随扩散圆点亮）/ 以前揭示的圆=暗（常驻·不回黑）。
//
// 声呐诚实（感知重做 SPEC §2.2·spoof/evade/假回波整套已删）；房间大小派生（hash01/roomScale01）渲染与 gameplay 同源。
// 扫描态全走 run 级、不入存档语义、不 bump SAVE_VERSION（纯对象 JSON round-trip）。

import type { DiveMap, RunState } from '@/types';

// ============================================================
// 可调参数（tunables）
// ============================================================

/**
 * 一记 ping 的规划纵深**基线**跳数（无向 BFS 半径·感知重做 SPEC §2.2）。起步小＝只看得到/听得到身边一跳。
 * **范围是声呐的主升级轴**（经 sonarScanRangeBonus → deriveSensorTuning → run.sensorTuning.sonarScanRange）：
 * 升级 → 一记 ping 揭示更多跳之外的节点供规划（视觉 lookahead）+ 同量程内听到猎手（scanStalker）——**同一轴**。
 */
export const SONAR_SCAN_RANGE = 1;

/** 一记 ping 规划纵深跳数的**上限**（升级升满也到此为止）——再升也扫不穿整洞（守北极星）。 */
export const SONAR_SCAN_RANGE_MAX = 4;

/**
 * 本次下潜的有效声呐规划纵深跳数：读 run.sensorTuning（升级派生·deriveSensorTuning 已夹紧到 [基线, 上限]；
 * 未升级＝基线常量·sensorTuning 必有〔createNewRun 种 / hydrate 补〕）。视觉 lookahead 揭示与猎手听觉共用此值。
 */
export function sonarScanRange(run: RunState): number {
  return run.sensorTuning.sonarScanRange;
}

// ============================================================
// 真图揭示（一记 ping 的规划纵深·视觉 lookahead + 猎手听觉同轴·无向 BFS）
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
 * 一记 ping 从 originId 无向 BFS 到 range 跳为止能揭示/听到的节点 id（含 origin 自己）。
 * 视觉 lookahead（scanReveal 把这批 stamp 进 scanMemory·SonarScanPanel 据此画几跳之外的节点）+
 * 猎手听觉量程（scanStalker：能不能听到那只猎手）**共用同一批**。确定性、纯函数（读真图·声呐诚实·无 evade/spoof）。
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

// ============================================================
// 渲染用纯几何/噪声 helper（SDF 渲染同源·单一来源）
// —— 与 hash01/roomScale01 同脉络（「渲染兼职库出 ui」·渲染模块反向 import·输出逐字相同）。
// 消费方：ui/SonarScanPanel（有机洞穴 caveSdf/bakeCaveRGBA）、ui/openWaterRender（开阔水域 openWaterSdf/bake）。
// 迁此单一来源＝洞穴与开阔水域共用同一份噪声/距离函数·别在两处各抄一份（会漂）。
// ============================================================

/** 确定性 hash → [0,1)（值噪声用·不碰 RNG）。 */
export function hash2(x: number, y: number): number {
  let h = (Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return (h % 1000) / 1000;
}
/** 平滑值噪声（双线性 + smoothstep）。 */
export function vnoise(x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi);
  const b = hash2(xi + 1, yi);
  const c = hash2(xi, yi + 1);
  const d = hash2(xi + 1, yi + 1);
  return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
}
/** 分形叠加（不规则岩壁的有机感）。 */
export function fbm(x: number, y: number): number {
  return 0.6 * vnoise(x, y) + 0.3 * vnoise(x * 2.1 + 11, y * 2.1 + 7) + 0.1 * vnoise(x * 4.3 + 3, y * 4.7 + 19);
}
/** 点到线段距离。 */
export function distSeg(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}
