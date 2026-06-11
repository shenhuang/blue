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
  chartConditions,
  poiLockReason,
  isPoiVisible,
  isPoiLit,
  isPoiDepartable,
  effectiveDistance,
  describePoi,
  describeCaveShape,
} from '../src/engine/chart';
import { generateDiveMap, analyzeMap, caveShapeBucket } from '../src/engine/mapgen';
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

/** 确定性 LCG（generateDiveMap 的 rng 注入用；chart.ts 的 roaming 现走 pool-independent 键、不再用 LCG） */
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
// roaming 现为 pool-independent 确定性选取（runsCompleted 种子），不再需要注入 rng（§6.5 即时新 POI 浮现）
const c1 = generateChart({ profile: postNoUp });
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
const c2 = generateChart({ profile: postUp });
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
  ['zone.blue_caves', 0.44, 0.28, 1], // 横岩廊（平廊侧口·#114 续）
  ['zone.old_lighthouse_reef', 0.44, 0.72, 1],
  ['zone.wreck_graveyard', 0.72, 0.55, 2],
];
for (const [zone, x, y, want] of anchorReach) {
  const p: ChartPoi = { id: 'a', zoneId: zone, name: '', blurb: '', distance: want, mapX: x, mapY: y, persistent: true };
  const got = effectiveDistance(homeOnly, p);
  assert(got === want, `${zone} 从 home 的 reach 应=${want}（手感不破），实际 ${got}`);
}
L('  5 锚点 home reach = 写死 distance（0/1/1/1/2，手感不破）✓');

// ============================================
// 3. roaming 刷新（runsCompleted 种子）
// ============================================
L('\n========== 3. roaming 刷新 ==========');
const rA = generateChart({ profile: profileWith(['flag.tutorial_complete'], [], 3) });
const rB = generateChart({ profile: profileWith(['flag.tutorial_complete'], [], 3) });
const roamA = rA.pois.filter((p) => !p.persistent).map((p) => p.name).join('|');
const roamB = rB.pois.filter((p) => !p.persistent).map((p) => p.name).join('|');
assert(roamA === roamB, `同 runsCompleted 的 roaming 应一致：${roamA} vs ${roamB}`);
// 机会点数随海况：晴/雾 2、浓雾遮一处 → 1（§6.5）。从 chartConditions 派生期望值＝seed 无关、robust。
const cond3 = chartConditions(profileWith(['flag.tutorial_complete'], [], 3));
const expectRoam3 = cond3.weather === 'fog' ? 1 : 2;
assert(
  rA.pois.filter((p) => !p.persistent).length === expectRoam3,
  `roaming 数应为 ${expectRoam3}（runsCompleted=3 天气=${cond3.weather}）`,
);
L(`  runsCompleted=3 → roaming: ${roamA}（确定性 ✓·天气 ${cond3.weather}）`);

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
// 5b. 平廊 POI（#114 续）：modifier=GenOpts 薄投影——窄 span + 长图 + 剖面 k 直通 mapgen
// ============================================
L('\n========== 5b. 平廊 POI（横岩廊·窄 span/长图/剖面 k 直通）==========');
const chartG = generateChart({ profile: postUp });
const galleryPoi = chartG.pois.find((p) => p.id === 'poi.anchor.flat_gallery');
assert(galleryPoi, '横岩廊 anchor 应在海图上（flag 满足 + home 灯塔点亮覆盖 (0.44,0.28)）');
let gs: GameState = { ...createInitialGameState(), profile: postUp };
gs = startDiveFromPoi(gs, galleryPoi);
assert(gs.phase.kind === 'dive', '平廊 POI 应进入 dive phase');
const gmap = gs.run!.map!;
const gDepths = Object.values(gmap.nodes).map((n) => n.depth);
const ga = analyzeMap(gmap);
assert(ga.nodeCount >= 20, `平廊 layerCount 10 应拉长图（N≥20），实际 ${ga.nodeCount}`);
assert(
  Math.min(...gDepths) === 16 && Math.max(...gDepths) === 30,
  `平廊深度窗口应=[16,30]（窄 span＝横向洞），实际 [${Math.min(...gDepths)},${Math.max(...gDepths)}]`,
);
assert(
  ga.meanDepthFrac <= 0.55,
  `平廊剖面 k=2.4 应整体贴浅（meanDepthFrac≤0.55），实际 ${ga.meanDepthFrac.toFixed(3)}`,
);
// seedKey=poi.id ⇒ 同一地点再潜同一张图（#98 一致性在平廊 POI 上同样成立）
const gs2 = startDiveFromPoi({ ...createInitialGameState(), profile: postUp }, galleryPoi);
const depthFp = (m: NonNullable<RunState['map']>) =>
  JSON.stringify(Object.keys(m.nodes).sort().map((id) => [id, m.nodes[id].depth, m.nodes[id].kind]));
assert(depthFp(gs2.run!.map!) === depthFp(gmap), '平廊同 POI 再潜应同图（seedKey 一致性不破）');
L(`  N=${ga.nodeCount}（≥20 长图）· 窗口 [16,30] · mdf=${ga.meanDepthFrac.toFixed(2)} · 同点同图 ✓·「进来太远」回程预算轴成立`);

// ============================================
// 5c. 洞型情报（#114·海图=诚实轴）：图上写的＝潜下去的（与 mapgen 同一 k 来源）
// ============================================
L('\n========== 5c. 洞型情报标签（真话·同源）==========');
assert(
  describeCaveShape(galleryPoi) === '洞型·往里钻',
  `横岩廊（钉死 k=2.4）应标「往里钻」，实际 ${describeCaveShape(galleryPoi)}`,
);
const bcPoi = chartG.pois.find((p) => p.id === 'poi.anchor.blue_caves');
assert(bcPoi, '蓝洞群 anchor 应在海图上');
assert(
  describeCaveShape(bcPoi) === '洞型·斜着下',
  `蓝洞群（派生 k≈0.87）应标「斜着下」，实际 ${describeCaveShape(bcPoi)}`,
);
const wreckPoi = chartG.pois.find((p) => p.id === 'poi.anchor.wreck_graveyard');
assert(wreckPoi && describeCaveShape(wreckPoi) === null, '开阔海域（layered）不应出洞型标签');
// 分桶门槛（内部连续 k、外部三句人话）
assert(
  caveShapeBucket(0.5) === 'shaft' && caveShapeBucket(1) === 'linear' && caveShapeBucket(2.4) === 'gallery',
  'caveShapeBucket 三档门槛漂了',
);
L('  横岩廊→往里钻（钉 2.4）· 蓝洞群→斜着下（派生 0.87）· 墓园→无标签 · 三档门槛 ✓');

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

// ============================================
// 7. 海况（§6.5 宏观灯塔扫描）：潮汐/天气派生 + 浓雾遮蔽一处机会点（锚点不受影响）
// ============================================
L('\n========== 7. 海况 + 天气遮蔽（§6.5）==========');
// (a) 确定性：同 runsCompleted → 同海况
const condA = chartConditions(profileWith([], [], 5));
const condB = chartConditions(profileWith([], [], 5));
assert(condA.tide === condB.tide && condA.weather === condB.weather, '7: 同 runsCompleted → 同海况（确定性）');
// (b) 随回合变：跨多 run 出现多种天气 + 涨/退潮都出现；记下第一个浓雾 run 与第一个非浓雾 run
const weathers = new Set<string>();
const tides = new Set<string>();
let fogRun = -1;
let calmRun = -1;
for (let r = 0; r < 40; r++) {
  const c = chartConditions(profileWith([], [], r));
  weathers.add(c.weather);
  tides.add(c.tide);
  if (c.weather === 'fog' && fogRun < 0) fogRun = r;
  if (c.weather !== 'fog' && calmRun < 0) calmRun = r;
}
assert(weathers.size >= 2 && tides.size === 2, `7: 海况随回合变（天气 ${weathers.size} 种 / 潮汐 ${tides.size} 态）`);
assert(fogRun >= 0 && calmRun >= 0, '7: 40 run 内浓雾与非浓雾都出现');
// (c) 浓雾遮一处 roaming（晴/雾 2 → 浓雾 1）；锚点 4 个不受影响；conditions 落返回结构
const fogChart = generateChart({ profile: profileWith(['flag.tutorial_complete'], [], fogRun) });
const calmChart = generateChart({ profile: profileWith(['flag.tutorial_complete'], [], calmRun) });
const fogRoam = fogChart.pois.filter((p) => !p.persistent && !p.mimic).length;
const calmRoam = calmChart.pois.filter((p) => !p.persistent && !p.mimic).length;
assert(calmRoam === 2 && fogRoam === 1, `7: 浓雾遮一处机会点（非雾 ${calmRoam} → 浓雾 ${fogRoam}）`);
assert(
  fogChart.pois.filter((p) => p.persistent).length === 5 &&
    calmChart.pois.filter((p) => p.persistent).length === 5,
  '7: 锚点不受天气遮蔽（5 个都在·守进度安全）',
);
assert(fogChart.conditions.weather === 'fog' && calmChart.conditions.weather !== 'fog', '7: SeaChart.conditions 落返回结构');
L(`  海况确定性 + 随回合变 + 浓雾遮一处（run ${fogRun} 雾→${fogRoam} / run ${calmRun} ${calmChart.conditions.weather}→${calmRoam}）+ 锚点不受影响 ✓`);

// ============================================
// 8. 即时新 POI 浮现（§6.5·#80 尾巴）：中途点亮灯塔→新机会点即时进图 + roaming 选取 pool-independent
// ============================================
// 核心修复在 SeaChartView 的 chart memo（加灯塔签名→建灯当场重算，否则等下个 run）；引擎侧守两条不变量：
//   (a) 远端 roaming 坐标 home 不点亮、加前哨即点亮（同 runsCompleted）＝新 POI 进可见池不必等下个 run；
//   (b) roaming 选取确定性 + 模板键 id（pool-independent·见 chart.ts roamingKey）＝同 profile 重算稳定、
//       中途点亮灯塔不把已显示的机会点整组重洗（旧顺序加权抽依赖池子组成、会重排）。
L('\n========== 8. 即时新 POI 浮现（§6.5·#80 尾巴）==========');
// 找一个非浓雾的 runsCompleted（2 个 roaming·避免遮蔽干扰断言）
let clearRun = 0;
while (chartConditions(profileWith([], [], clearRun)).weather === 'fog') clearRun++;
const homeR = profileWith(['flag.tutorial_complete'], [], clearRun);
// 远端 roaming 模板「塌口北缘」坐标(0.85,0.64)：home 不点亮、前哨点亮（同 §2b 的远端门）
const farRoam: ChartPoi = { id: 't.farroam', zoneId: 'zone.wreck_graveyard', name: '', blurb: '', distance: 2, mapX: 0.85, mapY: 0.64, persistent: false };
assert(!isPoiLit(homeR, farRoam), '8a: home-only 不点亮远端 roaming 坐标（前哨前）');
const homeOutpost: PlayerProfile = {
  ...homeR,
  lighthouses: [
    ...homeR.lighthouses,
    { id: 'lighthouse.outpost_far', name: '远端前哨', mapX: 0.8, mapY: 0.6, level: 1, builtUpgrades: new Set() },
  ],
};
// (a) 加前哨（同 runsCompleted）→ 远端坐标被点亮＝新机会点即时进可见池，不必等下个 run
assert(isPoiLit(homeOutpost, farRoam), '8a: 加前哨后远端 roaming 坐标被点亮＝新 POI 即时进图（同 run）');
// (b) roaming id 为模板键（poi.roam.<run>.<templateId>）+ 同 profile 重算确定一致
const roamIds = (p: PlayerProfile) =>
  generateChart({ profile: p }).pois.filter((x) => !x.persistent && !x.mimic).map((x) => x.id);
const ids1 = roamIds(homeOutpost);
const ids2 = roamIds(homeOutpost);
assert(ids1.join('|') === ids2.join('|'), '8b: 同 profile 重算 roaming 一致（确定性·pool-independent）');
assert(
  ids1.every((id) => /^poi\.roam\.\d+\.[a-z_.]+$/.test(id)),
  `8b: roaming id 应为模板键 poi.roam.<run>.<templateId>（稳定·不重洗），实际 ${ids1.join(',')}`,
);
L(`  远端 roaming 即时点亮(run ${clearRun}) + roaming 模板键 id 确定性(${ids1.length} 个) ✓`);

console.log(log.join('\n'));
console.log('\n✓ 海图 playthrough 完成');
