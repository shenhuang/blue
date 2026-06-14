// 探深「深度柱」回归（#131）—— depth_columns.json 单一来源 → 派生 band / 派生 probe 轨 / 海图深入 POI，
// 及核心档位可见性（建到第 K 级 → 1…K lit / K+1 dim / 更深 hidden·一级露一档）+ 从 lit 档下潜落 run +
// 宿主前哨在线补给设施并入柱下潜（能源保留接线）。约定见 src/types/columns.ts。
//
// 跑法： npx tsx scripts/playthrough-columns.ts

import { createInitialGameState } from '../src/engine/state';
import { getBand } from '../src/engine/bands';
import { startDiveFromPoi } from '../src/engine/dive';
import { canBuildAt } from '../src/engine/lighthouses';
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
const EXPECTED = { 'col.home': 2, 'col.wreck': 3, 'col.midwater': 4, 'col.vent': 4, 'col.trench': 6 } as const;

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
// 1. 配置自洽：5 根柱·级数 2/3/4/4/6·宿主灯塔
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
L('  5 根柱（家2/残骸3/中层4/热液4/海沟6）+ 宿主反查 ✓');

// ============================================================
// 2. 派生 band：每档一个·并进 getBand 注册表·绝对 depthRange
// ============================================================
L('\n========== 2. 派生 band ==========');
const cb = columnBands();
assert(cb.length === 19, `2: 派生 band 共 19（2+3+4+4+6·实得 ${cb.length}）`);
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
const t6 = getBand(columnTierBandId('col.trench', 6))!;
assert(t6.depthRange[0] === 100 && t6.depthRange[1] === 108, '2: 海沟 t6 = [100,108]（止于中段·abyssal+ 留 Phase）');
// 预留「另一个世界」band 仍在册、不被柱档覆盖。
assert(getBand('band.abyssal') && getBand('band.nameless'), '2: abyssal/nameless 预留 band 仍在册（Phase 3）');
L('  19 派生 band 全可解析 + 顶深 order + 海沟止于 108m + 预留深渊 band 仍在 ✓');

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
// ============================================================
L('\n========== 4. 海图档位揭示（建到 K 级）==========');
// 海沟柱 6 档。建 0 级：t1 dim、其余 hidden。
{
  const st = tierStates(colState('col.trench', 0), 'col.trench');
  assert(st[1] === 'dim' && st[2] === 'hidden' && st[6] === 'hidden', '4: 建 0 级 → t1 dim·t2+ hidden');
}
// 建 2 级：t1/t2 lit、t3 dim、t4+ hidden。
{
  const st = tierStates(colState('col.trench', 2), 'col.trench');
  assert(st[1] === 'lit' && st[2] === 'lit', '4: 建 2 级 → t1/t2 lit');
  assert(st[3] === 'dim', '4: 建 2 级 → t3 dim（K+1 暗点）');
  assert(st[4] === 'hidden' && st[5] === 'hidden' && st[6] === 'hidden', '4: 建 2 级 → t4+ hidden');
}
// 建满 6 级：全 lit、无 dim（无更深档可暗）。
{
  const st = tierStates(colState('col.trench', 6), 'col.trench');
  assert([1, 2, 3, 4, 5, 6].every((t) => st[t] === 'lit'), '4: 建满 → 6 档全 lit');
}
// columnBuiltLevel 读宿主 builtUpgrades 取最高档。
assert(columnBuiltLevel(colState('col.trench', 4).profile, 'col.trench') === 4, '4: columnBuiltLevel = 4');
// 暗档给出可执行的「再推一级」block reason。
{
  const s = colState('col.trench', 2);
  const poi = generateChart({ profile: s.profile }).pois.find((p) => p.id === columnDivePoiId('col.trench', 3))!;
  assert(poi && poi.revealState === 'dim', '4: t3 暗点在图');
  assert(!isPoiDepartable(s.profile, poi), '4: 暗档不可出海');
  assert((poiBlockReason(s.profile, poi) ?? '').includes('探深'), '4: 暗档 block reason 指向「再推一级探深」');
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
assert(trenchTrack.upgrades.length === 6, '5: 海沟轨 6 级');
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
  const s1m = { ...s1, profile: { ...s1.profile, inventory: [{ itemId: 'item.brass_fitting', qty: 10 }], bankedGold: 500 } };
  const host1 = s1m.profile.lighthouses.find((l) => l.id === 'lighthouse.ch1_trench_outpost')!;
  assert(canBuildAt(s1m.profile, host1, columnProbeUpgradeId('col.trench', 2)).ok, '5: 建 lv1（料钱足）后 lv2 可建');
}
L('  5 轨 + onlyLighthouse + cost/effects + 同轨顺序门控（needsPrev）✓');

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
// ============================================================
L('\n========== 7. 柱潜点下潜落 run ==========');
{
  const s = colState('col.trench', 3);
  const poi = generateChart({ profile: s.profile }).pois.find((p) => p.id === columnDivePoiId('col.trench', 2))!;
  assert(poi && poi.revealState === 'lit' && poi.bandId === columnTierBandId('col.trench', 2), '7: t2 lit 潜点带 bandId');
  const band = getBand(columnTierBandId('col.trench', 2))!;
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
// ============================================================
L('\n========== 8. 宿主前哨补给设施 ==========');
{
  // 静水前哨容量=OUTPOST_BASE_ENERGY(1)；单建制氧（draw 1）→ 在线 → oxygenSupply 10。
  const host = colState('col.trench', 1, ['lighthouse.oxygen_supply.lv1']).profile.lighthouses.find(
    (l) => l.id === 'lighthouse.ch1_trench_outpost',
  )!;
  assert(effectiveOutpostBonuses(host).oxygenSupply === 10, '8: 制氧设施在线 → oxygenSupply 10');
  const sNo = colState('col.trench', 1);
  const sOx = colState('col.trench', 1, ['lighthouse.oxygen_supply.lv1']);
  const poiNo = generateChart({ profile: sNo.profile }).pois.find((p) => p.id === columnDivePoiId('col.trench', 1))!;
  const poiOx = generateChart({ profile: sOx.profile }).pois.find((p) => p.id === columnDivePoiId('col.trench', 1))!;
  const oxNo = startDiveFromPoi(sNo, poiNo).run!.oxygenMax;
  const oxOx = startDiveFromPoi(sOx, poiOx).run!.oxygenMax;
  assert(oxOx - oxNo === 10, `8: 宿主在线制氧 → 柱下潜氧上限 +10（实得 +${oxOx - oxNo}）`);
}
L('  宿主前哨在线制氧 → 柱下潜随身氧上限 +10（能源保留接线）✓');

console.log(log.join('\n'));
console.log('\n✓ 探深「深度柱」（#131）回归通过');
