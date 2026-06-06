// 猎手（声呐图上的捕食者）—— 猎手 SPEC Phase 1 spine（docs/深海回响_猎手_SPEC.md）。
//
// 把一直抽象的「警觉」(run.alert·深水区 #59) 做成一个**有位置、会逼近、按你用哪种感官显示不同保真度**的猎手：
//   灯（光） → 你只知道「有东西在接近」（NodeSelectView 既有 alert-warning·模糊）。
//   声呐（ping）→ 你知道它**在哪个节点 + 多远**（SonarScanPanel 精确 blip·**只在被扫到时更新**·可 evadesSonar 躲）。
//   摸黑       → 既不知存在也不知位置（但你也最不容易被它锁定）。
// **同一只猎手**——不是两套敌人，是同一个实体的两种读数（双传感器 clarity 从「读地形」推进到「读威胁」）。
//
// 本文件＝猎手的**纯逻辑**（spawn / advance / scan / 位置查询），确定性、不耗 RNG；
// 渲染表象住 ui/SonarScanPanel（纯渲染），引擎接线住 dive.ts（仅 run.huntEnabled 时 engage·缺省走旧瞬时伏击）。
// run 级·派生·不入 profile·不 bump SAVE_VERSION（Stalker 纯对象·JSON 自动 round-trip·`?? undefined` 兜底）。

import type { RunState, DiveMap, Stalker, SenseModality, StalkerLostBehavior } from '@/types';
import { buildUndirectedAdjacency, revealSonarScan, sonarScanRange } from './sonar';
import { ALERT_WARN } from './clarity';

// ============================================================
// 可调参数（tunables，SPEC §8）
// ============================================================

/** 猎手现身时距你的跳数（声呐量程外·不是当场伏击·给你读出来 + 反应的窗口）。 */
export const STALKER_SPAWN_HOPS = 3;
/** 信号切断后跟丢所需回合（摸黑/拉开够久 → 它脱离·despawn＝逃生阀门兑现）。 */
export const STALKER_LOSE_TURNS = 3;
/** ≥ 此 alert ＝它「有你的信号」（在追·刷新 lastSignal）；低于＝信号切断（你摸黑让它消退）→ 按性格搜。沿用预警线。 */
export const STALKER_SIGNAL_ALERT = ALERT_WARN;
/** ≥ 此深度的声/双感猎手会躲声呐扫描（evadesSonar·越深越难缠 §2.6；abyssal 108m 起）。 */
export const STALKER_EVADE_DEPTH = 108;

/** 确定性哈希（FNV-1a），不消耗 RNG（保 mapgen/场景确定性）。 */
function hashStr(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// ============================================================
// 图上的逼近（节点绑定·复用声呐的无向邻接）
// ============================================================

/** BFS 距离场：origin 到每个可达节点的跳数（无向·与声呐量程同款邻接）。确定性。 */
function bfsDist(map: DiveMap, originId: string): Record<string, number> {
  const adj = buildUndirectedAdjacency(map);
  const dist: Record<string, number> = { [originId]: 0 };
  let frontier = [originId];
  let d = 0;
  while (frontier.length) {
    const next: string[] = [];
    for (const id of frontier)
      for (const nb of adj[id] ?? []) {
        if (dist[nb] === undefined) {
          dist[nb] = d + 1;
          next.push(nb);
        }
      }
    frontier = next;
    d++;
  }
  return dist;
}

/** from→to 的下一跳（BFS 最短路·无向·邻居按 id 排序＝确定性）。无路 / 已在 to → null。 */
export function nextHopToward(map: DiveMap, fromId: string, toId: string): string | null {
  if (fromId === toId) return null;
  if (!map.nodes[fromId] || !map.nodes[toId]) return null;
  const adj = buildUndirectedAdjacency(map);
  const parent: Record<string, string> = { [fromId]: fromId };
  let frontier = [fromId];
  while (frontier.length) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const nb of (adj[id] ?? []).slice().sort()) {
        if (parent[nb] === undefined) {
          parent[nb] = id;
          if (nb === toId) {
            let cur = nb; // 回溯到 from 的第一跳
            while (parent[cur] !== fromId) cur = parent[cur];
            return cur;
          }
          next.push(nb);
        }
      }
    }
    frontier = next;
  }
  return null;
}

/**
 * 现身点（距 origin 约 hops 跳·声呐量程外·给反应窗口）：取距离==hops 的节点；
 * 没有正好那么远的（小图）→ 取最远可达。确定性（按 id 排序）。无其它节点 → null。
 */
export function spawnNodeFor(map: DiveMap, originId: string, hops: number): string | null {
  const dist = bfsDist(map, originId);
  const reachable = Object.keys(dist).filter((id) => id !== originId);
  if (reachable.length === 0) return null;
  const atHops = reachable.filter((id) => dist[id] === hops).sort();
  if (atHops.length) return atHops[0];
  const maxD = Math.max(...reachable.map((id) => dist[id]));
  return reachable.filter((id) => dist[id] === maxD).sort()[0];
}

// ============================================================
// 出现 / 逼近 / 接触（SPEC §2.4）+ 声呐感知（§2.1/§8.7）
// ============================================================

/**
 * 建一只猎手（猎手 SPEC §2.4「出现」）——在距你 STALKER_SPAWN_HOPS 跳处现身（不是当场伏击）。
 * 由 dive.ts 在「越线（predatorApproaches）+ 当前无猎手」时调。pool 空（无伏击池）/ 无可达节点 → null。确定性（不耗 RNG）。
 */
export function maybeSpawnStalker(run: RunState, pool: string[]): Stalker | null {
  if (!run.map || !run.currentNodeId || pool.length === 0) return null;
  const node = spawnNodeFor(run.map, run.currentNodeId, STALKER_SPAWN_HOPS);
  if (!node) return null;
  const idx = run.visitedNodeIds.length; // 同 maybeApproachEncounter 的确定性索引（不耗 Math.random）
  const encounterId = pool[idx % pool.length];
  const depth = run.currentDepth ?? 0;
  // 越深越偏声/双感 + 越会躲（§2.2/§2.6）；浅段（< evade 线）偏光感。Phase 1 简单派生·完整模态分类留 Phase 2。
  const sensesBy: SenseModality = depth >= STALKER_EVADE_DEPTH ? 'both' : idx % 2 === 0 ? 'sound' : 'light';
  const onLostSignal: StalkerLostBehavior = idx % 2 === 0 ? 'seek_last' : 'hold';
  return {
    nodeId: node,
    sensesBy,
    onLostSignal,
    state: 'hunting',
    encounterId,
    lastSignalNodeId: run.currentNodeId,
    turnsSinceSignal: 0,
  };
}

/**
 * 推进猎手一回合（猎手 SPEC §2.3-2.4）。返回新猎手（**null ＝跟丢 despawn**）+ 是否**接触**到你（接触＝触发伏击）。
 *   - 有你的信号（alert ≥ STALKER_SIGNAL_ALERT）→ hunting：朝你当前节点逼近一跳·刷新 lastSignal。
 *   - 信号切断（你摸黑让 alert 消退）→ searching：hold 原地等 / seek_last 往上次信号点搜；turnsSinceSignal++。
 *   - 切断够久（≥ STALKER_LOSE_TURNS）→ lost（跟丢·despawn＝「摸黑是逃生阀门」北极星）。
 * 接触＝逼近后落在你所在节点（含「已在你节点 + 仍有信号」的情形）。
 */
export function advanceStalker(
  run: RunState,
  stalker: Stalker,
): { stalker: Stalker | null; contact: boolean } {
  if (!run.map || !run.currentNodeId) return { stalker, contact: false };
  const here = run.currentNodeId;
  const hasSignal = (run.alert ?? 0) >= STALKER_SIGNAL_ALERT;
  const s: Stalker = { ...stalker };
  if (hasSignal) {
    s.state = 'hunting';
    s.turnsSinceSignal = 0;
    s.lastSignalNodeId = here;
    const hop = nextHopToward(run.map, s.nodeId, here);
    if (hop) s.nodeId = hop;
  } else {
    s.turnsSinceSignal += 1;
    if (s.turnsSinceSignal >= STALKER_LOSE_TURNS) return { stalker: null, contact: false }; // 跟丢
    s.state = 'searching';
    if (s.onLostSignal === 'seek_last') {
      const hop = nextHopToward(run.map, s.nodeId, s.lastSignalNodeId);
      if (hop) s.nodeId = hop;
    } // hold：原地不动
  }
  return { stalker: s, contact: s.nodeId === here };
}

/**
 * 这只猎手是否躲过这一记 ping（§2.1 evadesSonar·§2.6 越深越会躲）：纯光感不躲声呐；
 * 深处（≥ STALKER_EVADE_DEPTH）的声/双感约半数 ping 躲过（确定性·随 turn＝两记 ping 间可能时显时隐）。
 */
export function stalkerEvadesScan(run: RunState, stalker: Stalker): boolean {
  if (stalker.sensesBy === 'light') return false;
  if ((run.currentDepth ?? 0) < STALKER_EVADE_DEPTH) return false;
  return hashStr(`evade:${stalker.nodeId}:${run.turn}`) % 2 === 0;
}

/**
 * 一记 ping 扫描猎手（§2.1「声呐＝位置」·§8.7「位置只在被扫到时更新」）：量程内 + 未躲过 → 刷新 seenNodeId/seenTurn；
 * 量程外 / 被躲过 → 原样（你看到的还是旧位置，或一直没定位＝「只感觉到它」）。pingSonar 调。
 */
export function scanStalker(run: RunState, stalker: Stalker): Stalker {
  if (!run.map || !run.currentNodeId) return stalker;
  const inRange = revealSonarScan(run.map, run.currentNodeId, sonarScanRange(run)).includes(stalker.nodeId);
  if (!inRange || stalkerEvadesScan(run, stalker)) return stalker;
  return { ...stalker, seenNodeId: stalker.nodeId, seenTurn: run.turn };
}

/**
 * 声呐图上猎手的（会过时的）位置（§2.1/§8.7·SonarScanPanel 纯渲染读这里）：上次被声呐扫到的节点 + 余像年龄；
 * 从没扫到（seenNodeId undefined）/ 节点已不在图 → null（你只「感觉」到它在、没定位）。
 */
export function stalkerSonarBlip(run: RunState): { nodeId: string; stale: number } | null {
  const s = run.stalker;
  if (!s || s.seenNodeId === undefined || !run.map?.nodes[s.seenNodeId]) return null;
  return { nodeId: s.seenNodeId, stale: (run.turn ?? 0) - (s.seenTurn ?? run.turn ?? 0) };
}
