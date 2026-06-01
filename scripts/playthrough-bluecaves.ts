// 蓝洞群（cave 风格）验证脚本：
//   1. mapgen 在 canFreeAscend=false 的 zone 里不生成中间层 ascent_point
//   2. isAscentBlocked 在中间节点返回 true，在末层 ascent_point 返回 false
//   3. AscentView 的逻辑：normal/rushed 被锁，emergency 仍可用
//   4. 事件池非空，至少 1 个事件能引发 combat.blind_eel_solo
//   5. 盲鳗战斗能跑通，掉落 eel_skin，Mira 能收
//   6. 从洞末层 ascent_point 正常上浮，resolution 出来
//
// 跑法： npx tsx scripts/playthrough-bluecaves.ts

import { createInitialGameState, createNewRun } from '../src/engine/state';
import { generateDiveMap, analyzeMap } from '../src/engine/mapgen';
import { buildEventPool, getZone } from '../src/engine/zones';
import { isAscentBlocked, executeAscent, planAscent } from '../src/engine/ascent';
import { getEnemyDef, getEncounter } from '../src/engine/combat';
import { miraOfferFor, sellItemToMira, handleReturnToPort } from '../src/engine/port';
import { breatheAtAirPocket, campAtNode } from '../src/engine/dive';
import { tickTurns } from '../src/engine/events';
import type { GameState, DiveMap } from '../src/types';

const log: string[] = [];
const L = (s: string) => log.push(s);
function assert(cond: unknown, msg: string) {
  if (!cond) {
    console.error(log.join('\n'));
    throw new Error('断言失败：' + msg);
  }
}

// 简单的 seeded RNG，让 mapgen 可复现
function makeRng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

// ============================================
// Phase 1: zone 数据 + 迷路 mapgen 结构不变量
//   （蓝洞群已从层状 DAG 改成洞穴迷路图，mapShape='maze'。结构性回归归
//    scripts/playthrough-mapgen-scenarios.ts 专项管；这里只做 zone 级冒烟。）
// ============================================
L('========== 蓝洞群 zone + 迷路 mapgen ==========');
const zone = getZone('zone.blue_caves');
assert(zone, 'zone.blue_caves 必须存在');
assert(zone!.canFreeAscend === false, 'canFreeAscend 必须显式 false');
assert(zone!.mapShape === 'maze', 'mapShape 必须是 maze（洞穴迷路图）');
L(`  zone: ${zone!.name}, depth ${zone!.depthRange.join('-')}m, mapShape=${zone!.mapShape}, canFreeAscend=${zone!.canFreeAscend}`);

// 生成多张迷路图，断言每张都满足迷路不变量：
//   全节点从起点可达 / 双向边 / 有环(绕回) / 有死路 / ≥2 最深点 / 入口即上浮口 / ≥2 上浮口且全可达
let totalMaps = 0;
let allOk = 0;
for (let seed = 1; seed <= 20; seed++) {
  const map = generateDiveMap({
    zone: zone!,
    profileFlags: new Set(['flag.tutorial_complete']),
    deaths: [],
    rng: makeRng(seed),
  });
  totalMaps++;
  const a = analyzeMap(map);
  const ok =
    a.allReachable && a.isUndirected && a.hasCycle && a.hasDeadEnd &&
    a.deepestNodeIds.length >= 2 && a.entranceIsAscent &&
    a.ascentPointIds.length >= 2 && a.allAscentReachable;
  if (ok) allOk++;
  else
    L(
      `    seed ${seed} 违反不变量: reach=${a.allReachable} undir=${a.isUndirected} ` +
        `cyc=${a.hasCycle} dead=${a.hasDeadEnd} deepest=${a.deepestNodeIds.length} ` +
        `entAsc=${a.entranceIsAscent} asc=${a.ascentPointIds.length}`,
    );
}
L(`  ${totalMaps} 张迷路图：${allOk} 张满足全部不变量`);
assert(allOk === totalMaps, '每张迷路图都应满足迷路结构不变量（详见 playthrough-mapgen-scenarios.ts）');

// ============================================
// Phase 2: isAscentBlocked（迷路版）
//   入口=洞口(ascent_point) → 不 block（回头能从洞口出去）
//   内部非 ascent 节点 → block（头上是岩，只能 emergency）
//   远端出口=ascent_point → 不 block（洞另一头的开口）
// ============================================
L('\n========== isAscentBlocked 行为（迷路版） ==========');
let state: GameState = createInitialGameState();
state = {
  ...state,
  profile: {
    ...state.profile,
    flags: new Set(['flag.tutorial_complete']),
  },
  run: createNewRun({ zoneId: 'zone.blue_caves' }),
};
const sampleMap = generateDiveMap({
  zone: zone!,
  profileFlags: state.profile.flags,
  deaths: [],
  rng: makeRng(42),
});
const startNode = sampleMap.nodes[sampleMap.startNodeId];
L(`  入口节点 kind=${startNode.kind} depth=${startNode.depth}m`);
assert(startNode.kind === 'ascent_point', '迷路图入口应是 ascent_point（洞口）');
state = {
  ...state,
  run: {
    ...state.run!,
    map: sampleMap,
    currentNodeId: sampleMap.startNodeId,
    currentDepth: startNode.depth,
  },
};
assert(!isAscentBlocked(state.run!), '入口(洞口)不应被 block——回头能从这儿上去');

// 内部非 ascent 节点 → block
const interiorNode = Object.values(sampleMap.nodes).find(
  (n) => n.id !== sampleMap.startNodeId && n.kind !== 'ascent_point',
);
assert(interiorNode, '迷路图应存在内部非 ascent 节点');
state = {
  ...state,
  run: { ...state.run!, currentNodeId: interiorNode!.id, currentDepth: interiorNode!.depth },
};
L(`  内部节点 kind=${interiorNode!.kind} depth=${interiorNode!.depth}m`);
assert(isAscentBlocked(state.run!), '洞内非上浮口节点应被 block（只剩 emergency）');

// 远端出口（非入口的 ascent_point）→ 不 block
const farExit = Object.values(sampleMap.nodes).find(
  (n) => n.kind === 'ascent_point' && n.id !== sampleMap.startNodeId,
);
assert(farExit, '迷路图应存在"另一头的出口"(far exit ascent_point)');
state = {
  ...state,
  run: { ...state.run!, currentNodeId: farExit!.id, currentDepth: farExit!.depth },
};
L(`  远端出口 depth=${farExit!.depth}m kind=${farExit!.kind}`);
assert(!isAscentBlocked(state.run!), '另一头的出口应放行 normal/rushed');

// 控制组：开阔海域 zone 应永远不 block
state = {
  ...state,
  run: {
    ...createNewRun({ zoneId: 'zone.old_lighthouse_reef' }),
    map: sampleMap,
    currentNodeId: sampleMap.startNodeId,
  },
};
assert(!isAscentBlocked(state.run!), '旧灯塔礁（canFreeAscend 默认 true）不应被 block');

// ============================================
// Phase 3: 事件池有内容 + combat hook 在
// ============================================
L('\n========== 蓝洞群事件池 ==========');
for (const depth of [15, 25, 38, 50]) {
  const pool = buildEventPool({
    zone: zone!,
    depth,
    sanity: 100,
    profileFlags: state.profile.flags,
    triggeredEventIds: [],
  });
  L(`  ${depth}m 事件池：${pool.length} 个`);
  assert(pool.length >= 1, `深度 ${depth}m 在蓝洞群应至少 1 个事件`);
}
const combat = getEncounter('combat.blind_eel_solo');
assert(combat, '盲鳗 encounter 必须注册');
const eelDef = getEnemyDef('enemy.blind_eel');
assert(eelDef, '盲鳗 EnemyDef 必须注册');
const hasSanityAttack = eelDef!.attacks.some(
  (a) => a.sanityDamage && a.sanityDamage[1] > 0,
);
assert(hasSanityAttack, '盲鳗应至少有一个攻击带 sanityDamage');
L(`  combat.blind_eel_solo 已注册，盲鳗有 ${eelDef!.attacks.length} 个攻击`);
L(`    sanityDamage 攻击：${eelDef!.attacks.filter((a) => a.sanityDamage).map((a) => a.name).join(', ')}`);

// ============================================
// Phase 4: emergency 上浮在洞里仍可走通（剧情上"凿穿洞顶"）
// ============================================
L('\n========== 洞里只剩 emergency ==========');
state = createInitialGameState();
state = {
  ...state,
  profile: { ...state.profile, flags: new Set(['flag.tutorial_complete']) },
  run: {
    ...createNewRun({ zoneId: 'zone.blue_caves' }),
    map: sampleMap,
    currentNodeId: interiorNode!.id, // 内部非 ascent 节点（入口现在是 ascent_point，不会 block）
    currentDepth: 30,
    stats: { stamina: 80, oxygen: 30, sanity: 70, nitrogen: 25 },
  },
};
assert(isAscentBlocked(state.run!), '前置：必须仍在 block 区');
const plan = planAscent(state.run!);
L(`  planAscent: stops=${plan.stops} normal=${plan.normalTurns} rushed=${plan.rushedTurns}`);

// emergency 应能跑（不抛错，能到 resolution / gameOver）
const emR = executeAscent(state, 'emergency');
state = emR.state;
L(`  emergency 上浮 → phase=${state.phase.kind}, bends=${emR.bendsType}`);
assert(
  state.phase.kind === 'resolution' || state.phase.kind === 'funeral',
  'emergency 应到 resolution 或 funeral，不应停留 dive',
);

// ============================================
// Phase 5: 完整的"洞内带战利品出来 → Mira 收购"流程
// ============================================
L('\n========== 战利品流程 ==========');
state = createInitialGameState();
state = {
  ...state,
  profile: { ...state.profile, flags: new Set(['flag.tutorial_complete']) },
  run: {
    ...createNewRun({ zoneId: 'zone.blue_caves' }),
    inventory: [
      { itemId: 'item.eel_skin', qty: 1 },
      { itemId: 'item.coral_shard', qty: 2 },
    ],
    currentDepth: 50,
    visitedNodeIds: ['n0', 'n1', 'n2'],
  },
};
const ascR = executeAscent(state, 'rushed');
state = ascR.state;
assert(state.phase.kind === 'resolution', 'rushed 应到 resolution');
const out = (state.phase as { kind: 'resolution'; outcome: any }).outcome;
const expectedLoot = miraOfferFor('item.eel_skin') + miraOfferFor('item.coral_shard') * 2;
L(`  outcome.lootValue = ${out.lootValue}（期望 ${expectedLoot}）`);
assert(out.lootValue === expectedLoot, 'lootValue 计算应等于各物品 Mira 收购价之和');
assert(miraOfferFor('item.eel_skin') > 0, '盲鳗皮 sellPrice 应让 Mira 收');

// 回港 → 卖给 Mira
const ret = handleReturnToPort(state);
state = ret.state;
assert(
  state.profile.inventory.find((i) => i.itemId === 'item.eel_skin')?.qty === 1,
  '盲鳗皮应合并到 profile.inventory',
);
const before = state.profile.bankedGold;
state = sellItemToMira(state, 'item.eel_skin', 1);
state = sellItemToMira(state, 'item.coral_shard', 2);
L(`  卖给 Mira：银行 ${before} → ${state.profile.bankedGold}`);
assert(
  state.profile.bankedGold - before === expectedLoot,
  '收益对不上：' + (state.profile.bankedGold - before) + ' vs ' + expectedLoot,
);

// ============================================
// Phase 6: 气穴 / 扎营点 节点效果
// ============================================
L('\n========== 气穴 / 扎营点 ==========');
function miniMap(): DiveMap {
  return {
    zoneId: 'zone.blue_caves',
    generatedAt: 0,
    startNodeId: 'air',
    nodes: {
      air: { id: 'air', layer: 1, depth: 40, zoneTag: 'cave', kind: 'air_pocket', connectsTo: ['camp'], preview: '气穴' },
      camp: { id: 'camp', layer: 2, depth: 42, zoneTag: 'cave', kind: 'camp', connectsTo: ['air'], preview: '扎营' },
    },
  };
}

// 气穴：氧气 +6 / 理智 +4，第二次失效（用过即枯）
let cs: GameState = createInitialGameState();
cs = {
  ...cs,
  profile: { ...cs.profile, flags: new Set(['flag.tutorial_complete']) },
  run: {
    ...createNewRun({ zoneId: 'zone.blue_caves' }),
    map: miniMap(),
    currentNodeId: 'air',
    currentDepth: 40,
    stats: { stamina: 50, oxygen: 30, sanity: 60, nitrogen: 20 },
  },
};
const o0 = cs.run!.stats.oxygen;
const sa0 = cs.run!.stats.sanity;
cs = breatheAtAirPocket(cs);
L(`  换气：氧气 ${o0}→${cs.run!.stats.oxygen}（期望 +6）, 理智 ${sa0}→${cs.run!.stats.sanity}（期望 +4）`);
assert(cs.run!.stats.oxygen === o0 + 6, '气穴应 +6 氧气');
assert(cs.run!.stats.sanity === sa0 + 4, '气穴应 +4 理智');
const oAfter = cs.run!.stats.oxygen;
cs = breatheAtAirPocket(cs); // 第二次：应枯竭
L(`  再次换气：氧气 ${cs.run!.stats.oxygen}（期望不变 ${oAfter}）`);
assert(cs.run!.stats.oxygen === oAfter, '气穴用过后应枯竭，不再 +氧气（防来回蹭气穴刷无限氧）');

// 满氧时不溢出
let csCap: GameState = {
  ...cs,
  run: { ...cs.run!, activeFlags: new Set<string>(), stats: { ...cs.run!.stats, oxygen: cs.run!.oxygenMax } },
};
csCap = breatheAtAirPocket(csCap);
assert(csCap.run!.stats.oxygen === csCap.run!.oxygenMax, '气穴不应让氧气超过上限');

// 扎营 = 先 tick N 回合（耗氧/被动理智压力等）再叠加恢复。断言"叠加在 tick 之后"，
// 用 tickTurns 算同一基线对比，避免把被动理智衰减误判成 bug。
// 短档：3 回合 体力 +15 理智 +5
let cc: GameState = createInitialGameState();
cc = {
  ...cc,
  run: {
    ...createNewRun({ zoneId: 'zone.blue_caves' }),
    map: miniMap(),
    currentNodeId: 'camp',
    currentDepth: 42,
    stats: { stamina: 40, oxygen: 40, sanity: 50, nitrogen: 30 },
  },
};
const runBeforeShort = cc.run!;
const baseShort = tickTurns(runBeforeShort, 3);
const ox0 = runBeforeShort.stats.oxygen;
cc = campAtNode(cc, 'short');
L(`  短扎营：体力 →${cc.run!.stats.stamina}, 理智 →${cc.run!.stats.sanity.toFixed(1)}, 氧气 →${cc.run!.stats.oxygen.toFixed(1)}`);
assert(cc.run!.stats.stamina === Math.min(runBeforeShort.staminaMax, baseShort.stats.stamina + 15), '短扎营体力 +15（叠加在 tick 后）');
assert(cc.run!.stats.sanity === Math.min(100, baseShort.stats.sanity + 5), '短扎营理智 +5（叠加在 tick 后）');
assert(cc.run!.stats.oxygen === baseShort.stats.oxygen && baseShort.stats.oxygen < ox0, '扎营消耗氧气（tick 回合 = 自带代价）');

// 长档：体力 +30 理智 +10 氮气 −5
let cl: GameState = createInitialGameState();
cl = {
  ...cl,
  run: {
    ...createNewRun({ zoneId: 'zone.blue_caves' }),
    map: miniMap(),
    currentNodeId: 'camp',
    currentDepth: 42,
    stats: { stamina: 40, oxygen: 50, sanity: 50, nitrogen: 30 },
  },
};
const runBeforeLong = cl.run!;
const baseLong = tickTurns(runBeforeLong, 6);
cl = campAtNode(cl, 'long');
L(`  长扎营：氮气 →${cl.run!.stats.nitrogen.toFixed(1)}, 理智 →${cl.run!.stats.sanity.toFixed(1)}, 体力 →${cl.run!.stats.stamina}`);
assert(cl.run!.stats.nitrogen === Math.max(0, baseLong.stats.nitrogen - 5), '长扎营氮气 −5（叠加在 tick 后）');
assert(cl.run!.stats.sanity === Math.min(100, baseLong.stats.sanity + 10), '长扎营理智 +10（叠加在 tick 后）');
assert(cl.run!.stats.stamina === Math.min(runBeforeLong.staminaMax, baseLong.stats.stamina + 30), '长扎营体力 +30（叠加在 tick 后）');
L('  气穴/扎营节点效果 ✓');

console.log(log.join('\n'));
console.log('\n✓ 蓝洞群 playthrough 完成');
console.log(`最终：银行 ${state.profile.bankedGold} 金 / 仓库 ${state.profile.inventory.length} 项`);
