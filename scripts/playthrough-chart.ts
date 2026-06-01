// 港口海图（POI 选点）回归脚本
//   1. 发现门控：教学前海图为空；教学后 anchor 出现
//   2. 抵达门控：旧灯塔礁 anchor 可见但需 dockyard.lv1 才可出海
//   3. roaming 刷新：同 runsCompleted → 同组合（确定性）；跨 runsCompleted → 会变
//   4. depthOffset 真改深度：generateDiveMap(+offset) 整图平移；startDiveFromPoi 起始深度更深
//   5. distance 预耗氧 + diveModifier 落到 run
//
// 跑法： npx tsx scripts/playthrough-chart.ts

import { createInitialGameState, createNewRun, HOME_LIGHTHOUSE_ID } from '../src/engine/state';
import {
  generateChart,
  poiLockReason,
  isPoiVisible,
  isPoiLit,
  isPoiDepartable,
  effectiveDistance,
  describePoi,
} from '../src/engine/chart';
import { generateDiveMap } from '../src/engine/mapgen';
import { startDiveFromPoi, currentMoveCost } from '../src/engine/dive';
import { tickTurns, visibilitySanityDrain } from '../src/engine/events';
import { getZone } from '../src/engine/zones';
import type { GameState, PlayerProfile, ChartPoi, RunState } from '../src/types';

const log: string[] = [];
const L = (s: string) => log.push(s);
function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    console.error(log.join('\n'));
    console.error('\n✗ ' + msg);
    process.exit(1);
  }
}

/** 与 chart.ts 同算法的 LCG（确定性测试用） */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function profileWith(
  flags: string[] = [],
  upgrades: string[] = [],
  runsCompleted = 0,
): PlayerProfile {
  return {
    ...createInitialGameState().profile,
    flags: new Set(flags),
    unlockedUpgrades: new Set(upgrades),
    runsCompleted,
  };
}

/** 在家灯塔建上「船坞」设施（Phase C：dockyard 迁灯塔后旧灯塔礁的抵达门）。 */
function withHomeDockyard(profile: PlayerProfile): PlayerProfile {
  return {
    ...profile,
    lighthouses: profile.lighthouses.map((l) =>
      l.id === HOME_LIGHTHOUSE_ID
        ? { ...l, builtUpgrades: new Set([...l.builtUpgrades, 'lighthouse.dockyard.lv1']) }
        : l,
    ),
  };
}

// ============================================
// 1. 发现门控
// ============================================
L('========== 1. 发现门控（requiresFlags） ==========');
const preChart = generateChart({ profile: profileWith([]) });
assert(preChart.pois.length === 0, '教学前海图应为空（全部 anchor/template 需 flag.tutorial_complete）');
L('  教学前：海图为空 ✓');

const postNoUp = profileWith(['flag.tutorial_complete']);
const c1 = generateChart({ profile: postNoUp, rng: lcg(1) });
for (const z of ['zone.east_reef', 'zone.blue_caves', 'zone.wreck_graveyard', 'zone.old_lighthouse_reef']) {
  assert(c1.pois.some((p) => p.zoneId === z && p.persistent), `教学后应含 anchor: ${z}`);
}
L(`  教学后 anchor：${c1.pois.filter((p) => p.persistent).map((p) => p.name).join(' / ')} ✓`);

// ============================================
// 2. 抵达门控（家灯塔船坞 requiresLighthouseUpgrade）
// ============================================
L('\n========== 2. 抵达门控（家灯塔船坞） ==========');
const lh1 = c1.pois.find((p) => p.zoneId === 'zone.old_lighthouse_reef' && p.persistent)!;
assert(isPoiVisible(postNoUp, lh1), '旧灯塔礁 anchor 教学后应可见（home 点亮）');
assert(poiLockReason(postNoUp, lh1) !== null, '无家灯塔船坞时旧灯塔礁应被锁');
assert(!isPoiDepartable(postNoUp, lh1), '无船坞时旧灯塔礁不可出海');
L(`  旧灯塔礁：可见但锁（${poiLockReason(postNoUp, lh1)}）✓`);

const bc = c1.pois.find((p) => p.zoneId === 'zone.blue_caves' && p.persistent)!;
assert(isPoiDepartable(postNoUp, bc), '蓝洞群无升级门，应可出海');
L('  蓝洞群：无升级门，可出海 ✓');

const postUp = withHomeDockyard(profileWith(['flag.tutorial_complete']));
const c2 = generateChart({ profile: postUp, rng: lcg(1) });
const lh2 = c2.pois.find((p) => p.zoneId === 'zone.old_lighthouse_reef' && p.persistent)!;
assert(poiLockReason(postUp, lh2) === null, '建了家灯塔船坞后旧灯塔礁应可出海');
L('  建家灯塔船坞后旧灯塔礁：解锁 ✓');

// ============================================
// 2b. 灯塔 reveal（点亮）+ reach（最近灯塔算距离）
// ============================================
L('\n========== 2b. 灯塔 reveal + reach ==========');
// (a) 无灯塔 → 没有任何点被点亮 → 海图空（reveal 门）
const noLh: PlayerProfile = { ...profileWith(['flag.tutorial_complete']), lighthouses: [] };
assert(generateChart({ profile: noLh }).pois.length === 0, '无灯塔时海图应为空（reveal 门）');
L('  无灯塔 → 海图全灭 ✓');

// (b) home 点亮近端、不点亮远端（北缘 ≈0.80）
const homeOnly = profileWith(['flag.tutorial_complete']);
const nearPoi: ChartPoi = { id: 't.near', zoneId: 'zone.wreck_graveyard', name: '', blurb: '', distance: 1, mapX: 0.72, mapY: 0.55, persistent: false };
const farPoi: ChartPoi = { id: 't.far', zoneId: 'zone.wreck_graveyard', name: '', blurb: '', distance: 2, mapX: 0.85, mapY: 0.64, persistent: false };
assert(isPoiLit(homeOnly, nearPoi), 'home 应点亮近端 (0.72,0.55)');
assert(!isPoiLit(homeOnly, farPoi), 'home 不应点亮远端 (0.85,0.64)，留给前哨');
L('  home 点亮近端 / 远端要前哨 ✓');

// (c) 修复前哨灯塔后：远端被点亮 + reach 变近
const withOutpost: PlayerProfile = {
  ...homeOnly,
  lighthouses: [
    ...homeOnly.lighthouses,
    { id: 'lighthouse.outpost_north', name: '北缘前哨灯塔', mapX: 0.8, mapY: 0.6, level: 1, builtUpgrades: new Set() },
  ],
};
assert(isPoiLit(withOutpost, farPoi), '建前哨灯塔后远端应被点亮');
const reachHome = effectiveDistance(homeOnly, farPoi);
const reachOutpost = effectiveDistance(withOutpost, farPoi);
assert(reachOutpost < reachHome, `前哨更近：reach 应下降 ${reachHome}→${reachOutpost}`);
L(`  前哨点亮远端 + reach ${reachHome}→${reachOutpost} ✓`);

// (d) 4 个锚点从 home 算的 reach 与写死 distance 一致（不破手感）
const anchorReach: [string, number, number, number][] = [
  ['zone.east_reef', 0.18, 0.5, 0],
  ['zone.blue_caves', 0.46, 0.3, 1],
  ['zone.old_lighthouse_reef', 0.44, 0.72, 1],
  ['zone.wreck_graveyard', 0.72, 0.55, 2],
];
for (const [zone, x, y, want] of anchorReach) {
  const p: ChartPoi = { id: 'a', zoneId: zone, name: '', blurb: '', distance: want, mapX: x, mapY: y, persistent: true };
  const got = effectiveDistance(homeOnly, p);
  assert(got === want, `${zone} 从 home 的 reach 应=${want}（手感不破），实际 ${got}`);
}
L('  4 锚点 home reach = 写死 distance（0/1/1/2，手感不破）✓');

// ============================================
// 3. roaming 刷新（runsCompleted 种子）
// ============================================
L('\n========== 3. roaming 刷新 ==========');
const rA = generateChart({ profile: profileWith(['flag.tutorial_complete'], [], 3) });
const rB = generateChart({ profile: profileWith(['flag.tutorial_complete'], [], 3) });
const roamA = rA.pois.filter((p) => !p.persistent).map((p) => p.name).join('|');
const roamB = rB.pois.filter((p) => !p.persistent).map((p) => p.name).join('|');
assert(roamA === roamB, `同 runsCompleted 的 roaming 应一致：${roamA} vs ${roamB}`);
assert(rA.pois.filter((p) => !p.persistent).length === 2, 'roaming 数应为 2');
L(`  runsCompleted=3 → roaming: ${roamA}（确定性 ✓）`);

const variants = new Set<string>();
for (let r = 0; r < 8; r++) {
  const c = generateChart({ profile: profileWith(['flag.tutorial_complete'], [], r) });
  variants.add(c.pois.filter((p) => !p.persistent).map((p) => p.name).join('|'));
}
assert(variants.size >= 2, `roaming 应随 runsCompleted 刷新（8 次回港应≥2 种组合，实际 ${variants.size}）`);
L(`  跨 runsCompleted(0..7)：${variants.size} 种 roaming 组合 ✓`);

// ============================================
// 4. depthOffset 真改深度
// ============================================
L('\n========== 4. depthOffset 真改深度 ==========');
const flags = new Set(['flag.tutorial_complete']);
const wreckZone = getZone('zone.wreck_graveyard')!;
const baseMap = generateDiveMap({ zone: wreckZone, profileFlags: flags, rng: lcg(5) });
const offMap = generateDiveMap({ zone: wreckZone, profileFlags: flags, rng: lcg(5), depthOffset: 8 });
const depthsOf = (m: typeof baseMap) => Object.values(m.nodes).map((n) => n.depth);
const baseMax = Math.max(...depthsOf(baseMap));
const offMax = Math.max(...depthsOf(offMap));
const baseMin = Math.min(...depthsOf(baseMap));
const offMin = Math.min(...depthsOf(offMap));
assert(offMax === baseMax + 8, `depthOffset+8 应使最深点 +8：${baseMax} → ${offMax}`);
assert(offMin === baseMin + 8, `depthOffset+8 应使起始深度 +8：${baseMin} → ${offMin}`);
L(`  最深 ${baseMax}m → ${offMax}m，起始 ${baseMin}m → ${offMin}m ✓`);

// ============================================
// 5. startDiveFromPoi：distance 预耗氧 + diveModifier 落 run + 深点更深
// ============================================
L('\n========== 5. startDiveFromPoi 集成 ==========');
const deepPoi: ChartPoi = {
  id: 'test.deep',
  zoneId: 'zone.wreck_graveyard',
  name: '测试深点',
  blurb: '',
  distance: 2,
  persistent: false,
  modifier: { depthOffset: 12, current: 'strong' },
  requiresFlags: ['flag.tutorial_complete'],
};
let st: GameState = { ...createInitialGameState(), profile: postUp };
const baseOxygen = createNewRun({ zoneId: deepPoi.zoneId }).stats.oxygen; // 60
st = startDiveFromPoi(st, deepPoi);
assert(st.phase.kind === 'dive', 'startDiveFromPoi 应进入 dive phase');
assert(
  st.run!.stats.oxygen === baseOxygen - deepPoi.distance * 2,
  `距离 ${deepPoi.distance} 应预耗氧 ${deepPoi.distance * 2}：${baseOxygen} → ${st.run!.stats.oxygen}`,
);
assert(st.run!.turn === deepPoi.distance, `turn 应=distance(${deepPoi.distance})，实际 ${st.run!.turn}`);
assert(st.run!.diveModifier?.depthOffset === 12, 'diveModifier 应落到 run');
const zoneBaseD0 = wreckZone.depthRange[0];
assert(
  st.run!.currentDepth >= zoneBaseD0 + 12,
  `depthOffset 12 应使起始深度≥${zoneBaseD0 + 12}，实际 ${st.run!.currentDepth}`,
);
L(`  ${describePoi(postUp, deepPoi)}`);
L(`  起始：深度 ${st.run!.currentDepth}m / 氧 ${st.run!.stats.oxygen} / turn ${st.run!.turn} / 修正已落 run ✓`);

// ============================================
// 6. current / visibility 实际效果
// ============================================
L('\n========== 6. current / visibility 实际效果 ==========');

// visibility：在浅水（depth 0，无深度衰减）下，理智只受能见度影响 → 干净断言
const darkRun: RunState = {
  ...createNewRun({ zoneId: 'zone.east_reef' }),
  currentDepth: 0,
  diveModifier: { visibility: 'dark' },
};
const darkTicked = tickTurns(darkRun, 10);
assert(
  Math.abs(darkTicked.stats.sanity - (100 - 0.35 * 10)) < 1e-6,
  `dark 10 回合应扣 3.5 理智，实际扣 ${(100 - darkTicked.stats.sanity).toFixed(3)}`,
);
const murkyTicked = tickTurns({ ...darkRun, diveModifier: { visibility: 'murky' } }, 10);
assert(
  Math.abs(murkyTicked.stats.sanity - (100 - 0.15 * 10)) < 1e-6,
  `murky 10 回合应扣 1.5 理智，实际扣 ${(100 - murkyTicked.stats.sanity).toFixed(3)}`,
);
const clearTicked = tickTurns({ ...darkRun, diveModifier: undefined }, 10);
assert(clearTicked.stats.sanity === 100, '无修正 + 浅水不应扣理智');
assert(
  visibilitySanityDrain('dark', 4) === 1.4 &&
    visibilitySanityDrain('murky', 4) === 0.6 &&
    visibilitySanityDrain('clear', 4) === 0 &&
    visibilitySanityDrain(undefined, 4) === 0,
  'visibilitySanityDrain 档位不对',
);
L('  visibility：dark −0.35/turn、murky −0.15/turn、clear/无 0 ✓');

// current：每次节点移动的额外消耗（纯函数档位）
assert(
  currentMoveCost('strong').stamina === 8 && currentMoveCost('strong').oxygen === 2,
  'strong current 应 体力−8 / 氧−2',
);
assert(
  currentMoveCost('mild').stamina === 3 && currentMoveCost('mild').oxygen === 1,
  'mild current 应 体力−3 / 氧−1',
);
assert(
  currentMoveCost('none').stamina === 0 && currentMoveCost(undefined).oxygen === 0,
  'none / 无 current 应零消耗',
);
L('  current：strong −8体力/−2氧、mild −3/−1、none/无 0（每次移动）✓');

console.log(log.join('\n'));
console.log('\n✓ 海图 playthrough 完成');
