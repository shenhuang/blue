// The Warren 三角洞型 + 追猎态回归（蜂群 boss SPEC §4/§8·作者 2026-07-08 三卵室重设计）
//
// 把「三角拓扑」的硬不变量做成**会在 regress 里红的门**（CLAUDE.md：能机制化的别留散文）。
// 最关键的一条：**三间卵室两两等距（各 2 跳）**。它不是装饰——正因为等距，且她逃走那刻你正站在她原来
// 那间里（剩下两间对你也都是 2 跳），「离玩家最远 / 离当前最远」双双退化，**随机撤退才是唯一有信息量的规则**
// （quirk #239）。谁把三条边改成不等长，这个门就会红，提醒他先回去读那条 quirk。
//
// 覆盖：
//   A. 洞型不变量（跨 200 seed）：三卵室 kind='boss'·两两 2 跳·离入口 ≥3 跳·三气穴各挂一个中间房且 degree-1·
//      全图从入口连通·卵室不贴洞口·卵室钉在最深。
//   B. hopField：与朴素 BFS 同解 + 源点为 0 + 不可达不出现。
//   C. 追猎态：ensureQueenPlaced 落在卵室里且幂等；advanceQueenRelocation 永不重复用过的卵室、
//      两次撤退后 isWarrenLastStand=true；非 warren 图上不动位置且**不消耗 rng**（守既有 baseline）。
//   D. 密度热度：女王处最厚、离她越远越薄、表长之外恒 0（「入口无敌人」是定理不是巧合）。
//
// 跑法： npx tsx scripts/playthrough-warren-mapgen.ts

import type { DiveMap, RunState } from '../src/types';
import { generateDiveMap } from '../src/engine/mapgen';
import { hopField } from '../src/engine/graph';
import {
  warrenChambers,
  warrenSpawnDensity,
  ensureQueenPlaced,
  advanceQueenRelocation,
  WARREN_DENSITY_BY_HOPS,
} from '../src/engine/warren-hunt';
import { isWarrenLastStand, warrenArrivalEncounterId, WARREN_ENC } from '../src/engine/warren-hunt';
import { makeHarness, type PtAssert } from './lib/pt';
import { deriveMapLayout } from '../src/ui/mapLayout';
import { ROOM_BASE, ROOM_VAR, CH_BASE, CH_VAR, SMIN_K, WARP_AMP, SONAR_PX_PER_M, SONAR_COL_W } from '../src/engine/sonarGeometry';
import { roomScale01 } from '../src/engine/sonar';

const pt = makeHarness('The Warren 三角洞型 + 追猎态（蜂群 boss SPEC §4/§8）');
const { L } = pt;
const assert: PtAssert = pt.assert;

const D0 = 120;
const D1 = 240;
const zone = {
  id: 'zone.warren',
  mapShape: 'warren',
  depthRange: [D0, D1],
  canFreeAscend: false,
  layerCount: 8,
} as unknown as Parameters<typeof generateDiveMap>[0]['zone'];

const genMap = (seedKey: string): DiveMap =>
  generateDiveMap({ zone, profileFlags: new Set<string>(), seedKey });

/** 朴素 BFS（对照实现·验 hopField） */
function naiveHops(map: DiveMap, from: string): Record<string, number> {
  const adj: Record<string, Set<string>> = {};
  for (const id of Object.keys(map.nodes)) adj[id] = new Set();
  for (const [id, n] of Object.entries(map.nodes)) {
    for (const v of n.connectsTo) {
      adj[id].add(v);
      adj[v]?.add(id);
    }
  }
  const d: Record<string, number> = { [from]: 0 };
  const q = [from];
  while (q.length) {
    const u = q.shift()!;
    for (const v of adj[u]) if (d[v] === undefined) ((d[v] = d[u] + 1), q.push(v));
  }
  return d;
}

// ── A. 洞型不变量（跨 seed） ─────────────────────────────────────────────
L('\n========== A. 三角洞型不变量（200 seed） ==========');
{
  for (let i = 0; i < 200; i++) {
    const map = genMap(`s${i}`);
    const tag = `seed s${i}`;
    const chambers = warrenChambers(map);
    assert(chambers.length === 3, `${tag}：卵室应恰好 3 间（当前 ${chambers.length}）`);

    const [a, b, c] = chambers;
    const dA = naiveHops(map, a);
    const dB = naiveHops(map, b);
    assert(dA[b] === 2 && dB[c] === 2 && dA[c] === 2, `${tag}：三间卵室须两两 2 跳等距（当前 ${dA[b]}/${dB[c]}/${dA[c]}）——等距是「随机撤退」成立的前提·见 quirk #239`);

    const hE = naiveHops(map, map.startNodeId);
    for (const ch of chambers) {
      assert((hE[ch] ?? -1) >= 3, `${tag}：${ch} 离洞口仅 ${hE[ch]} 跳（女王绝不靠近洞口·SPEC §8）`);
      assert(map.nodes[ch].depth === D1, `${tag}：${ch} 应钉在最深 ${D1}`);
    }
    assert(
      !map.nodes[map.startNodeId].connectsTo.some((n) => chambers.includes(n)),
      `${tag}：卵室不该贴着洞口`,
    );

    const airs = Object.values(map.nodes).filter((n) => n.kind === 'air_pocket');
    assert(airs.length === 3, `${tag}：气穴应恰好 3 个（每个中间房各一·当前 ${airs.length}）`);
    const hosts = new Set<string>();
    for (const air of airs) {
      assert(air.connectsTo.length === 1, `${tag}：${air.id} 应是 degree-1 死路（当前 ${air.connectsTo.length}）`);
      hosts.add(air.connectsTo[0]);
    }
    assert(hosts.size === 3, `${tag}：三个气穴应各挂在不同的中间房上`);

    for (const id of Object.keys(map.nodes)) assert(hE[id] !== undefined, `${tag}：${id} 与洞口不连通`);
  }
  L('  ✓ 200 seed：三卵室等距 2 跳 · 离洞口 ≥3 跳 · 三气穴各挂一中间房(degree-1) · 全图连通 · 卵室最深不贴洞口');
}

// ── B. hopField 与朴素 BFS 同解 ─────────────────────────────────────────
L('\n========== B. hopField（通用无向 BFS 跳数场） ==========');
{
  const map = genMap('alpha');
  const src = warrenChambers(map)[0];
  const mine = hopField(map, [src]);
  const naive = naiveHops(map, src);
  assert(mine[src] === 0, '源点跳数应为 0');
  for (const id of Object.keys(naive)) assert(mine[id] === naive[id], `hopField 与朴素 BFS 应同解（${id}: ${mine[id]} vs ${naive[id]}）`);
  assert(Object.keys(mine).length === Object.keys(naive).length, 'hopField 不该多算/漏算节点');

  const capped = hopField(map, [src], 1);
  assert(Object.values(capped).every((d) => d <= 1), 'maxHops=1 时不应出现 >1 跳的节点');
  const multi = hopField(map, warrenChambers(map));
  assert(warrenChambers(map).every((c) => multi[c] === 0), '多源 BFS：每个源点自身应为 0');
  L('  ✓ hopField 与朴素 BFS 同解 · maxHops 截断生效 · 多源各自为 0');
}

// ── C. 追猎态：落位 / 撤退 / 背水一战 ───────────────────────────────────
L('\n========== C. 追猎态（落位·随机撤退·背水一战） ==========');
{
  const map = genMap('bravo');
  const chambers = warrenChambers(map);
  const baseRun = { map, warrenHunt: undefined } as unknown as RunState;

  const placed = ensureQueenPlaced(baseRun, () => 0.42);
  const q0 = placed.warrenHunt!.queenNodeId!;
  assert(chambers.includes(q0), '女王起始必须落在某间卵室里');
  assert(ensureQueenPlaced(placed, () => 0.99).warrenHunt!.queenNodeId === q0, 'ensureQueenPlaced 应幂等（月相窗内续追猎不重掷）');

  // 两次撤退：永不重复、每次换一间、第三间＝背水一战
  let run = placed;
  const seen = [q0];
  for (let step = 1; step <= 2; step++) {
    run = { ...run, warrenHunt: advanceQueenRelocation(run, () => 0.5) } as RunState;
    const q = run.warrenHunt!.queenNodeId!;
    assert(chambers.includes(q), `第 ${step} 次撤退后仍应在卵室里`);
    assert(!seen.includes(q), `第 ${step} 次撤退不得回到用过的卵室（她每间只用一次）`);
    assert(run.warrenHunt!.roomsCleared === step, `roomsCleared 应为 ${step}`);
    assert(run.warrenHunt!.wallDown === false, '每次撤退都要重置 wallDown＝新一道封口墙堵在她新那间门口');
    seen.push(q);
  }
  assert(seen.length === 3 && new Set(seen).size === 3, '三间卵室应被各用一次');
  assert(isWarrenLastStand(run), '撤退两次后应进入背水一战（禁撤·可杀）');
  assert(!isWarrenLastStand(placed), '起始那间不该是背水一战');

  // 非 warren 图：不动位置、**不消耗 rng**（守既有 combat baseline 的 rng 流）
  const plainMap = { nodes: { 'node.0': { id: 'node.0', kind: 'rest', connectsTo: [] } }, startNodeId: 'node.0' } as unknown as DiveMap;
  let rngCalls = 0;
  const countingRng = () => (rngCalls++, 0.5);
  const plainRun = { map: plainMap, warrenHunt: { roomsCleared: 0 } } as unknown as RunState;
  const afterPlain = advanceQueenRelocation(plainRun, countingRng);
  assert(afterPlain!.roomsCleared === 1, '非 warren 图仍应 roomsCleared+1');
  assert(afterPlain!.queenNodeId === undefined, '非 warren 图不应凭空落位女王');
  assert(rngCalls === 0, '非 warren 图不得消耗 rng（否则既有 combat baseline 的 rng 流会漂）');
  L('  ✓ 落位在卵室且幂等 · 撤退永不重复 · 两次后背水一战 · 非 warren 图不动位置且零 rng 消耗');
}

// ── D. 密度热度场 ───────────────────────────────────────────────────────
L('\n========== D. 密度热度 f(到女王跳数) ==========');
{
  const map = genMap('charlie');
  const run = ensureQueenPlaced({ map } as unknown as RunState, () => 0.1);
  const queen = run.warrenHunt!.queenNodeId!;
  const d = hopField(map, [queen]);
  const row = WARREN_DENSITY_BY_HOPS[0];

  assert(warrenSpawnDensity(map, run, queen) === row[0], '女王所在节点密度应最厚（f(0)）');
  const entrance = map.startNodeId;
  assert((d[entrance] ?? 0) >= row.length, `洞口应落在表长(${row.length})之外——「入口无敌人」是定理不是巧合`);
  assert(warrenSpawnDensity(map, run, entrance) === 0, '洞口密度必须恰好为 0（表长即作用半径·不靠 epsilon）');

  for (const id of Object.keys(map.nodes)) {
    const hops = d[id];
    const expect = hops === undefined || hops >= row.length ? 0 : row[hops];
    assert(warrenSpawnDensity(map, run, id) === expect, `${id}：密度应为 f(${hops}) = ${expect}`);
  }
  // 单调不增（越近越厚）
  for (let h = 1; h < row.length; h++) assert(row[h] <= row[h - 1], `密度表应单调不增（f(${h}) > f(${h - 1})）`);

  const noQueen = { map } as unknown as RunState;
  assert(warrenSpawnDensity(map, noQueen, queen) === 0, '女王未落位 ⇒ 密度恒 0（普通下潜零回归）');
  L('  ✓ 女王处最厚 · 逐跳单调不增 · 表长之外恒 0 · 女王未落位则全图 0');
}

// ── E. 到达路由决策（warrenArrivalEncounterId·纯函数·SPEC §5/§8/§9·作者 2026-07-08 三卵室追猎） ──
L('\n========== E. 到达路由决策（封口墙 / 女王阶段 · 空卵室↔安静水域 · rc 递进） ==========');
{
  const map = genMap('echo');
  const chambers = warrenChambers(map);
  const [qA, qB, qC] = chambers;
  const entrance = map.startNodeId;
  const eggs0: Record<string, number> = Object.fromEntries(chambers.map((c) => [c, 3]));

  // 起始：女王在 qA · 墙未破 · rc0 · 三间有卵
  const run0 = { map, warrenHunt: { roomsCleared: 0, queenNodeId: qA, usedChambers: [qA], wallDown: false, eggs: eggs0 } } as unknown as RunState;
  assert(warrenArrivalEncounterId(run0, qA) === WARREN_ENC.wallSpawn, '她那间·墙未破·rc0 → Spawn 封口墙（找到封口＝找到她）');
  assert(warrenArrivalEncounterId(run0, qB) === WARREN_ENC.brood, '非她那间·有卵 → 空卵室');
  assert(warrenArrivalEncounterId(run0, qC) === WARREN_ENC.brood, '非她那间·有卵 → 空卵室');
  assert(warrenArrivalEncounterId(run0, entrance) === null, '非卵室节点（入口）→ null（安静水域·逐字节不变）');

  // 墙已破 → 女王阶段 room1
  const run0b = { ...run0, warrenHunt: { ...run0.warrenHunt!, wallDown: true } } as unknown as RunState;
  assert(warrenArrivalEncounterId(run0b, qA) === WARREN_ENC.room1, '她那间·墙已破·rc0 → 女王阶段 room1');

  // 预清 qB 的卵 → qB 变安静水域（重访不重播）；qC 仍有卵（预清是 50% 赌注·quirk #239）
  const run0c = { ...run0, warrenHunt: { ...run0.warrenHunt!, eggs: { ...eggs0, [qB]: 0 } } } as unknown as RunState;
  assert(warrenArrivalEncounterId(run0c, qB) === null, '非她那间·卵已清空 → null（重访不重播·finalizeVictory 清零）');
  assert(warrenArrivalEncounterId(run0c, qC) === WARREN_ENC.brood, '另一间仍有卵 → 空卵室（预清一间是 50% 赌注·两间都清要拿氧气换）');

  // rc1：第二道墙＝Guards 墙；墙破→room2；她撤离的旧那间(卵已清)→null
  const run1 = { map, warrenHunt: { roomsCleared: 1, queenNodeId: qB, usedChambers: [qA, qB], wallDown: false, eggs: { ...eggs0, [qA]: 0 } } } as unknown as RunState;
  assert(warrenArrivalEncounterId(run1, qB) === WARREN_ENC.wallGuards, '她那间·墙未破·rc1 → Guards 封口墙（第二次更难打）');
  assert(warrenArrivalEncounterId({ ...run1, warrenHunt: { ...run1.warrenHunt!, wallDown: true } } as unknown as RunState, qB) === WARREN_ENC.room2, '她那间·墙已破·rc1 → 女王阶段 room2');
  assert(warrenArrivalEncounterId(run1, qA) === null, '她撤离的旧那间（卵已清）→ null（安静水域）');

  // rc2 背水一战：墙破→hatchery
  const run2 = { map, warrenHunt: { roomsCleared: 2, queenNodeId: qC, usedChambers: [qA, qB, qC], wallDown: true, eggs: { ...eggs0, [qA]: 0, [qB]: 0 } } } as unknown as RunState;
  assert(warrenArrivalEncounterId(run2, qC) === WARREN_ENC.hatchery, '她那间·墙已破·rc2（背水一战·无处可退）→ hatchery');

  // 无追猎档 / 非 warren 图 → null（普通下潜零回归）
  assert(warrenArrivalEncounterId({ map } as unknown as RunState, qA) === null, '无 warrenHunt → null');
  const plainMap = { nodes: { 'node.0': { id: 'node.0', kind: 'rest', connectsTo: [] } }, startNodeId: 'node.0' } as unknown as DiveMap;
  assert(warrenArrivalEncounterId({ map: plainMap, warrenHunt: { roomsCleared: 0, queenNodeId: 'node.0' } } as unknown as RunState, 'node.0') === null, '非 warren 图（无 boss 卵室节点）→ null');
  L('  ✓ 墙↔女王阶段路由 · 空卵室↔安静水域(存卵) · rc 递进 wall_spawn→wall_guards→hatchery · 无档/非warren图 → null');
}

// ============================================================
// F. 声呐洞穴「诚实」不变量（横版 warren layout·刻意破 #92·QUIRKS #240）：
//    「没有可见墙的地方」＝真的连通（有边）。非相邻房间不得熔并、隧道不得穿过非相邻房间——
//    保证作者要求的「无墙 ⟹ 玩家真能从一间移到另一间」。侧死路数量随 seed 变（0–7 叶），跨 seed 守门。
//    判据：声呐口径 layout 下，非相邻两房中心距 ≥ 两房半径+熔并余量；每条隧道离非端点房间 ≥ 该房半径+隧道半宽+余量。
// ============================================================
L('\n========== F. 声呐洞穴诚实（非相邻不熔·隧道不穿房·守「无墙⟹可移动」） ==========');
{
  const rr = (id: string) => (id.startsWith('w.chamber.') ? (ROOM_BASE + ROOM_VAR) * 1.7 : ROOM_BASE + ROOM_VAR * roomScale01(id));
  const MERGE = 2 * WARP_AMP + SMIN_K + 4;
  const TUNR = CH_BASE + CH_VAR;
  const segD = (px: number, py: number, ax: number, ay: number, bx: number, by: number) => {
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
    let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  };
  let roomV = 0, tunV = 0;
  const N = 120;
  for (let i = 0; i < N; i++) {
    const map = genMap('honest' + i);
    const ids = Object.keys(map.nodes);
    const layout = deriveMapLayout(map, { pxPerMeter: SONAR_PX_PER_M, colW: SONAR_COL_W, layoutStyle: 'warren' });
    const adj: Record<string, Set<string>> = {};
    for (const id of ids) adj[id] = new Set(map.nodes[id].connectsTo);
    const linked = (a: string, b: string) => adj[a].has(b) || adj[b].has(a);
    for (let a = 0; a < ids.length; a++)
      for (let b = a + 1; b < ids.length; b++) {
        if (linked(ids[a], ids[b])) continue;
        const pa = layout.pos[ids[a]], pb = layout.pos[ids[b]];
        if (Math.hypot(pa.x - pb.x, pa.y - pb.y) < rr(ids[a]) + rr(ids[b]) + MERGE) roomV++;
      }
    for (const e of layout.edges)
      for (const c of ids) {
        if (c === e.a || c === e.b || linked(c, e.a) || linked(c, e.b)) continue;
        const pc = layout.pos[c], pa = layout.pos[e.a], pb = layout.pos[e.b];
        if (segD(pc.x, pc.y, pa.x, pa.y, pb.x, pb.y) < rr(c) + TUNR + MERGE) tunV++;
      }
  }
  assert(roomV === 0, `F: ${N} seed·非相邻房间零假熔（无墙却不连通的假通路）——实测 ${roomV}`);
  assert(tunV === 0, `F: ${N} seed·隧道不穿非相邻房间——实测 ${tunV}`);
  L(`  \u2713 ${N} seed：房间不假熔(${roomV}) · 隧道不穿房(${tunV}) ＝ 无墙处必有边·声呐诚实`);
}

pt.done();
