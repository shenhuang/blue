// 探深「深度柱」回归（#131·级数/深度 §10 定案）—— depth_columns.json 单一来源 → 派生 band / 派生 probe 轨 /
// 海图深入 POI，及核心档位可见性（建到第 K 级 → 1…K lit / K+1 dim / 更深 hidden·一级露一档）+ 从 lit 档下潜落 run +
// 宿主前哨在线补给设施并入柱下潜（能源保留接线）+ 海沟 t4 科考站电梯 capstone（module gate + setsFlag 揭示科考站区）。
// 约定见 src/types/columns.ts。
//
// 跑法： npx tsx scripts/playthrough-columns.ts

import { createInitialGameState } from '../src/engine/state';
import { getBand } from '../src/engine/bands';
import { startDiveFromPoi } from '../src/engine/dive';
import { canBuildAt, buildAtLighthouse } from '../src/engine/lighthouses';
import { STATION_FOUND_FLAG } from '../src/engine/story';
import {
  getColumns,
  getColumn,
  getColumnForLighthouse,
  columnBands,
  columnProbeTracks,
  columnBuiltLevel,
  depthTierRevealState,
  columnTierBandId,
  columnProbeUpgradeId,
  columnDivePoiId,
} from '../src/engine/columns';
import { generateChart, poiBlockReason, isPoiDepartable } from '../src/engine/chart';
import { effectiveOutpostBonuses } from '../src/engine/outposts';
import type { GameState } from '../src/types';

const log: string[] = [];
const L = (s: string) => log.push(s);
function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    console.error(log.join('\n'));
    throw new Error('断言失败：' + msg);
  }
}

const TUT = 'flag.tutorial_complete';
// §10 定案级数：家2 / 残骸3 / 中层6（主探索区·内容最重）/ 热液4 / 海沟4（3 普通 + 1 电梯 capstone）。
const EXPECTED = { 'col.home': 2, 'col.wreck': 3, 'col.midwater': 6, 'col.vent': 4, 'col.trench': 4 } as const;

/** 教学已过 + 指定柱的宿主灯塔在册 + 已建探深到 builtLevel（直接构造 builtUpgrades，测可见性/账面）。 */
function colState(colId: string, builtLevel: number, extraUpgrades: string[] = []): GameState {
  const s = createInitialGameState();
  const col = getColumn(colId)!;
  const built = new Set<string>(extraUpgrades);
  for (let t = 1; t <= builtLevel; t++) built.add(columnProbeUpgradeId(colId, t));
  let lighthouses = s.profile.lighthouses;
  if (lighthouses.some((l) => l.id === col.lighthouseId)) {
    lighthouses = lighthouses.map((l) => (l.id === col.lighthouseId ? { ...l, builtUpgrades: built } : l));
  } else {
    lighthouses = [
      ...lighthouses,
      { id: col.lighthouseId, name: col.name, mapX: 0.7, mapY: 0.5, level: 1, builtUpgrades: built },
    ];
  }
  return { ...s, profile: { ...s.profile, flags: new Set([TUT]), lighthouses } };
}

/** 某柱各档在海图上的揭示态（不在图＝hidden）。 */
function tierStates(s: GameState, colId: string): Record<number, 'lit' | 'dim' | 'hidden'> {
  const chart = generateChart({ profile: s.profile });
  const out: Record<number, 'lit' | 'dim' | 'hidden'> = {};
  for (const t of getColumn(colId)!.tiers) {
    const poi = chart.pois.find((p) => p.id === columnDivePoiId(colId, t.tier));
    out[t.tier] = poi ? (poi.revealState as 'lit' | 'dim') : 'hidden';
  }
  return out;
}

// ============================================================
// 1. 配置自洽：5 根柱·级数 2/3/6/4/4·宿主灯塔
// ============================================================
L('========== 1. 深度柱配置 ==========');
const cols = getColumns();
assert(cols.length === 5, `1: 应有 5 根柱（实得 ${cols.length}）`);
for (const [id, n] of Object.entries(EXPECTED)) {
  const c = getColumn(id);
  assert(c, `1: 柱 ${id} 在册`);
  assert(c!.tiers.length === n, `1: ${id} 应 ${n} 档（实得 ${c!.tiers.length}）`);
}
assert(getColumnForLighthouse('lighthouse.ch1_trench_outpost')?.id === 'col.trench', '1: 反查 灯塔→柱');
assert(getColumnForLighthouse('lighthouse.home')?.id === 'col.home', '1: home 灯塔→home 柱');
L('  5 根柱（家2/残骸3/中层6/热液4/海沟4）+ 宿主反查 ✓');

// ============================================================
// 2. 派生 band：每档一个·并进 getBand 注册表·绝对 depthRange
// ============================================================
L('\n========== 2. 派生 band ==========');
const cb = columnBands();
assert(cb.length === 19, `2: 派生 band 共 19（2+3+6+4+4·实得 ${cb.length}）`);
for (const c of cols) {
  for (const t of c.tiers) {
    const bid = columnTierBandId(c.id, t.tier);
    const band = getBand(bid);
    assert(band, `2: getBand 解析派生 band ${bid}`);
    assert(band!.zoneId === c.zoneId, `2: ${bid} zone = ${c.zoneId}`);
    assert(
      band!.depthRange[0] === t.depthRange[0] && band!.depthRange[1] === t.depthRange[1],
      `2: ${bid} depthRange 透传`,
    );
    assert(band!.order === t.depthRange[0], `2: ${bid} order = 顶深（全局按深度排序）`);
  }
}
const tCap = getBand(columnTierBandId('col.trench', 4))!;
assert(tCap.depthRange[0] === 270 && tCap.depthRange[1] === 310, '2: 海沟 t4 电梯 capstone band = [270,310]（实际可达·名义 360）');
const mwDeep = getBand(columnTierBandId('col.midwater', 6))!;
assert(mwDeep.depthRange[0] === 180 && mwDeep.depthRange[1] === 210, '2: 中层 t6（主探索区最深）= [180,210]');
// 预留 band 已删（SPEC §10·旧测试内容）：depth_bands.json 现为空表、所有 band 来自柱派生。
assert(!getBand('band.abyssal') && !getBand('band.nameless'), '2: abyssal/nameless 预留 band 已删（SPEC §10·不再在册）');
L('  19 派生 band 全可解析 + 顶深 order + 海沟 t4 capstone [270,310] + 预留 band 已删 ✓');

// ============================================================
// 3. depthTierRevealState 纯函数（核心规则）
// ============================================================
L('\n========== 3. 档位可见性规则 ==========');
assert(depthTierRevealState(0, 1) === 'dim', '3: 建 0 级 → 第 1 档 dim');
assert(depthTierRevealState(0, 2) === 'hidden', '3: 建 0 级 → 第 2 档 hidden');
assert(depthTierRevealState(3, 2) === 'lit', '3: 建 3 级 → 第 2 档 lit');
assert(depthTierRevealState(3, 3) === 'lit', '3: 建 3 级 → 第 3 档 lit');
assert(depthTierRevealState(3, 4) === 'dim', '3: 建 3 级 → 第 4 档 dim');
assert(depthTierRevealState(3, 5) === 'hidden', '3: 建 3 级 → 第 5 档 hidden');
L('  ≥→lit / ==+1→dim / else hidden ✓');

// ============================================================
// 4. 端到端可见性（海图）：建到 K → 1…K lit / K+1 dim / 更深 hidden（一级露一档）
//    用中层柱（6 档·主探索区）做端到端——它级数最多、最能展开档位制。
// ============================================================
L('\n========== 4. 海图档位揭示（建到 K 级·中层 6 档）==========');
// 建 0 级：t1 dim、其余 hidden。
{
  const st = tierStates(colState('col.midwater', 0), 'col.midwater');
  assert(st[1] === 'dim' && st[2] === 'hidden' && st[6] === 'hidden', '4: 建 0 级 → t1 dim·t2+ hidden');
}
// 建 2 级：t1/t2 lit、t3 dim、t4+ hidden。
{
  const st = tierStates(colState('col.midwater', 2), 'col.midwater');
  assert(st[1] === 'lit' && st[2] === 'lit', '4: 建 2 级 → t1/t2 lit');
  assert(st[3] === 'dim', '4: 建 2 级 → t3 dim（K+1 暗点）');
  assert(st[4] === 'hidden' && st[5] === 'hidden' && st[6] === 'hidden', '4: 建 2 级 → t4+ hidden');
}
// 建满 6 级：全 lit、无 dim（无更深档可暗）。
{
  const st = tierStates(colState('col.midwater', 6), 'col.midwater');
  assert([1, 2, 3, 4, 5, 6].every((t) => st[t] === 'lit'), '4: 建满 → 6 档全 lit');
}
// columnBuiltLevel 读宿主 builtUpgrades 取最高档。
assert(columnBuiltLevel(colState('col.midwater', 4).profile, 'col.midwater') === 4, '4: columnBuiltLevel = 4');
// 暗档给出可执行的「再推一级」block reason。
{
  const s = colState('col.midwater', 2);
  const poi = generateChart({ profile: s.profile }).pois.find((p) => p.id === columnDivePoiId('col.midwater', 3))!;
  assert(poi && poi.revealState === 'dim', '4: t3 暗点在图');
  assert(!isPoiDepartable(s.profile, poi), '4: 暗档不可出海');
  assert((poiBlockReason(s.profile, poi) ?? '').includes('低频声呐'), '4: 暗档 block reason 指向「再升一级低频声呐」');
}
L('  建 0/2/6 级各档 lit/dim/hidden 正确 + columnBuiltLevel + 暗档 blockReason ✓');

// ============================================================
// 5. 派生 probe 升级轨：onlyLighthouse=宿主·cost=该 tier·同轨顺序门控
// ============================================================
L('\n========== 5. 派生 probe 升级轨 ==========');
const tracks = columnProbeTracks();
assert(tracks.length === 5, `5: 5 条派生 probe 轨（实得 ${tracks.length}）`);
const trenchTrack = tracks.find((t) => t.id === 'lhtrack.probe.trench')!;
assert(trenchTrack && trenchTrack.onlyLighthouse === 'lighthouse.ch1_trench_outpost', '5: 海沟轨 onlyLighthouse=宿主');
assert(trenchTrack.upgrades.length === 4, '5: 海沟轨 4 级（3 普通 + 1 电梯）');
assert(
  tracks.find((t) => t.id === 'lhtrack.probe.midwater')!.upgrades.length === 6,
  '5: 中层轨 6 级（主探索区）',
);
const trenchCol = getColumn('col.trench')!;
assert(
  trenchTrack.upgrades[0].cost.gold === trenchCol.tiers[0].cost.gold && trenchTrack.upgrades[0].effects.length === 0,
  '5: 派生升级 cost=该 tier·effects 空（纯门控）',
);
// 同轨顺序门控：未建 lv1 → lv2 needsPrev；建 lv1 后 lv2 可建。
{
  const s0 = colState('col.trench', 0);
  const host0 = s0.profile.lighthouses.find((l) => l.id === 'lighthouse.ch1_trench_outpost')!;
  const lv2 = canBuildAt(s0.profile, host0, columnProbeUpgradeId('col.trench', 2));
  assert(!lv2.ok && (lv2 as { reason: string }).reason === 'needsPrev', '5: 未建 lv1 → lv2 needsPrev');
  const s1 = colState('col.trench', 1);
  // canBuildAt 在 needsPrev 之后还查材料/金币 → 给足料钱，隔离「续级可建」这条。
  const s1m = { ...s1, profile: { ...s1.profile, inventory: [{ itemId: 'item.brass_fitting', qty: 10 }, { itemId: 'item.eel_skin', qty: 10 }], bankedGold: 500 } };
  const host1 = s1m.profile.lighthouses.find((l) => l.id === 'lighthouse.ch1_trench_outpost')!;
  assert(canBuildAt(s1m.profile, host1, columnProbeUpgradeId('col.trench', 2)).ok, '5: 建 lv1（料钱足）后 lv2 可建');
}
L('  5 轨 + onlyLighthouse + trench4/midwater6 + cost/effects + 同轨顺序门控（needsPrev）✓');

// ============================================================
// 6. 教学门 + 宿主门：教学前空·宿主未建则该柱不出潜点
// ============================================================
L('\n========== 6. 教学门 + 宿主门 ==========');
// 教学前（无 TUT flag）：home 灯塔虽在册，柱潜点也不出（与所有 anchor 同门）。
{
  const fresh = createInitialGameState(); // 无 tutorial_complete
  const chart = generateChart({ profile: fresh.profile });
  assert(chart.pois.length === 0, '6: 教学前海图为空（柱潜点压在教学门后）');
}
// 教学后但宿主前哨未建：该柱无潜点（home 柱会出·因 home 恒在）。
{
  const s = { ...createInitialGameState(), profile: { ...createInitialGameState().profile, flags: new Set([TUT]) } };
  const ids = generateChart({ profile: s.profile }).pois.map((p) => p.id);
  assert(!ids.includes(columnDivePoiId('col.trench', 1)), '6: 海沟前哨未建 → 海沟柱无潜点');
  assert(ids.includes(columnDivePoiId('col.home', 1)), '6: home 恒在 → home 柱 t1 出（dim）');
}
L('  教学前空 / 宿主未建则该柱无潜点 / home 柱恒在 ✓');

// ============================================================
// 7. 从 lit 档下潜：startDiveFromPoi 走 band 路径落 run
//    用中层柱（有完整 POI 的柱·trench t1-t3 设 noPoi 无海图点）。
// ============================================================
L('\n========== 7. 柱潜点下潜落 run ==========');
{
  const s = colState('col.midwater', 3);
  const poi = generateChart({ profile: s.profile }).pois.find((p) => p.id === columnDivePoiId('col.midwater', 2))!;
  assert(poi && poi.revealState === 'lit' && poi.bandId === columnTierBandId('col.midwater', 2), '7: midwater t2 lit 潜点带 bandId');
  const band = getBand(columnTierBandId('col.midwater', 2))!;
  const after = startDiveFromPoi(s, poi);
  assert(after.run, '7: 下潜后有 run');
  assert(after.run!.zoneId === band.zoneId, '7: run.zoneId = band.zone');
  assert(after.run!.turn === 0, '7: 每潜从第 0 回合起算（满氧·#128）');
  assert(after.run!.bandAlertFactor === (band.alertFactor ?? 1), '7: run.bandAlertFactor 落 band');
  assert(after.run!.sonarDeception === (band.sonarDeception ?? 0), '7: run.sonarDeception 落 band');
  assert(after.run!.huntEnabled === (band.hunts ?? false), '7: run.huntEnabled 落 band');
  assert(after.run!.diveModifier?.visibility === band.visibility, '7: run.diveModifier.visibility 落 band');
}
L('  从 lit 档 startDiveFromPoi → run 落 zone/turn0/alert/sonarDeception/hunt/visibility ✓');

// ============================================================
// 8. 宿主前哨在线补给设施并入柱下潜（能源保留接线·老蛙跳删后承接）
//    用中层柱（trench t1-t3 设 noPoi·无海图 POI 可下潜）；effectiveOutpostBonuses 逻辑与柱种无关。
// ============================================================
L('\n========== 8. 宿主前哨补给设施 ==========');
{
  // 静水前哨容量=OUTPOST_BASE_ENERGY(1)；单建制氧（draw 1）→ 在线 → oxygenSupply 10。
  const host = colState('col.midwater', 1, ['lighthouse.oxygen_supply.lv1']).profile.lighthouses.find(
    (l) => l.id === 'lighthouse.ch1_midwater_outpost',
  )!;
  assert(effectiveOutpostBonuses(host).oxygenSupply === 10, '8: 制氧设施在线 → oxygenSupply 10');
  const sNo = colState('col.midwater', 1);
  const sOx = colState('col.midwater', 1, ['lighthouse.oxygen_supply.lv1']);
  const poiNo = generateChart({ profile: sNo.profile }).pois.find((p) => p.id === columnDivePoiId('col.midwater', 1))!;
  const poiOx = generateChart({ profile: sOx.profile }).pois.find((p) => p.id === columnDivePoiId('col.midwater', 1))!;
  const oxNo = startDiveFromPoi(sNo, poiNo).run!.oxygenMax;
  const oxOx = startDiveFromPoi(sOx, poiOx).run!.oxygenMax;
  assert(oxOx - oxNo === 10, `8: 宿主在线制氧 → 柱下潜氧上限 +10（实得 +${oxOx - oxNo}）`);
}
L('  宿主前哨在线制氧 → 柱下潜随身氧上限 +10（能源保留接线）✓');

// ============================================================
// 9. 海沟 t4 科考站电梯 capstone（#131 §10）：module gate + setsFlag 揭示科考站区 + 只解锁电梯入口一个潜点
// ============================================================
L('\n========== 9. 海沟科考站电梯 capstone ==========');
{
  const trenchCol2 = getColumn('col.trench')!;
  const cap = trenchCol2.tiers[3];
  assert(cap.capstone === true, '9: 海沟 t4 标记 capstone');
  assert(cap.depthRange[0] === 270 && cap.depthRange[1] === 310, '9: t4 电梯入口 [270,310]（实际可达·名义 360）');
  assert(cap.setsFlag === STATION_FOUND_FLAG, '9: t4 setsFlag = 科考站揭示 flag');
  assert(cap.cost.materials.some((m) => m.itemId === 'item.station_module'), '9: t4 cost 含科考站升级模块（material gate·非 story flag 门）');
  // 派生 probe lv4 升级把 setsFlag 透传进去（columnTrack）。
  const trenchTrackUp4 = columnProbeTracks().find((t) => t.id === 'lhtrack.probe.trench')!.upgrades[3];
  assert(trenchTrackUp4.setsFlag === STATION_FOUND_FLAG, '9: 派生 probe lv4 透传 setsFlag');

  // module gate：建到 lv3、给足其余料钱但无模块 → lv4 缺材料不可建。
  const s3 = colState('col.trench', 3);
  const noModule = {
    ...s3,
    profile: {
      ...s3.profile,
      inventory: [
        { itemId: 'item.cave_octopus_beak', qty: 5 },
        { itemId: 'item.lantern_gland', qty: 5 },
      ],
      bankedGold: 1000,
    },
  };
  const host3 = noModule.profile.lighthouses.find((l) => l.id === 'lighthouse.ch1_trench_outpost')!;
  const lv4NoMod = canBuildAt(noModule.profile, host3, columnProbeUpgradeId('col.trench', 4));
  assert(!lv4NoMod.ok && (lv4NoMod as { reason: string }).reason === 'notEnoughMaterials', '9: 无模块 → lv4 缺材料不可建（module gate）');

  // 给模块 → 可建 → buildAtLighthouse 端到端置科考站 flag + 电梯入口潜点 lit。
  const withModule = {
    ...noModule,
    profile: {
      ...noModule.profile,
      inventory: [{ itemId: 'item.station_module', qty: 1 }, ...noModule.profile.inventory],
    },
  };
  const host3b = withModule.profile.lighthouses.find((l) => l.id === 'lighthouse.ch1_trench_outpost')!;
  assert(canBuildAt(withModule.profile, host3b, columnProbeUpgradeId('col.trench', 4)).ok, '9: 有模块 → lv4 可建');
  const built = buildAtLighthouse(withModule, 'lighthouse.ch1_trench_outpost', columnProbeUpgradeId('col.trench', 4));
  assert(built.profile.flags.has(STATION_FOUND_FLAG), '9: 建电梯 → 置科考站揭示 flag（capstone setsFlag 端到端）');
  const poiCap = generateChart({ profile: built.profile }).pois.find((p) => p.id === columnDivePoiId('col.trench', 4));
  assert(poiCap && poiCap.revealState === 'lit', '9: 建电梯 → 海图电梯入口潜点 lit（唯一新解锁的下潜点）');
}
L('  capstone 标记/深度/setsFlag/module gate/建成端到端置 flag + 电梯入口 lit ✓');

console.log(log.join('\n'));
console.log('\n✓ 探深「深度柱」（#131·§10 定案）回归通过');
