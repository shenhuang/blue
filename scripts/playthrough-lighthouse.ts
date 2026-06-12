// 灯塔基地（基建地图 Phase B · 数据模型 + 引擎脚手架）回归：
//   1. home 灯塔在 createInitialProfile 种入；Lighthouse round-trip（builtUpgrades Set 还原）
//   2. canBuildAt 双资源门控：alreadyBuilt / needsPrev / needsLighthouseLevel / 材料不够 / 金币不够 / ok
//   3. buildAtLighthouse 扣材料 ＋ 扣金币 + 只写入目标灯塔的 builtUpgrades（不污染别座）
//   4. getLighthouseBonuses 聚合（lightRadiusBonus / reachReduction）
//   5. nearestLighthouse 最近灯塔 + 距离（多灯塔）
//
// 灯塔此刻 inert（游戏流程还没调用这些）；本脚本单测引擎工具，为 Phase C reveal/reach 打底。
// 跑法： npx tsx scripts/playthrough-lighthouse.ts

import {
  createInitialGameState,
  createHomeLighthouse,
  serializeGameState,
  deserializeGameState,
  countInInventory,
} from '../src/engine/state';
import {
  canBuildAt,
  buildAtLighthouse,
  devBuildAtLighthouse,
  getLighthouseBonuses,
  getBuiltLevelInTrack,
  getLighthouseTracks,
  nearestLighthouse,
  revealRadius,
  getRunBonuses,
  BASE_LIGHT_RADIUS,
  LIGHT_RADIUS_PER_BONUS,
} from '../src/engine/lighthouses';
import type { GameState, InventoryItem, Lighthouse } from '../src/types';

const log: string[] = [];
const L = (s: string) => log.push(s);
function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    console.error(log.join('\n'));
    throw new Error('断言失败：' + msg);
  }
}

const HOME = 'lighthouse.home';
const BEACON1 = 'lighthouse.beacon.lv1'; // coral×4 + brass×2 + 30g
const BEACON2 = 'lighthouse.beacon.lv2'; // brass×4 + crab×2 + 60g, requiresLighthouseLevel 1

function stateWith(inv: InventoryItem[], gold: number): GameState {
  const base = createInitialGameState();
  return { ...base, profile: { ...base.profile, inventory: inv.map((i) => ({ ...i })), bankedGold: gold } };
}
const homeOf = (s: GameState) => s.profile.lighthouses.find((l) => l.id === HOME)!;

// ============================================
// 1. home 种入 + round-trip
// ============================================
L('========== 1. home 灯塔种入 + round-trip ==========');
let s = createInitialGameState();
const home = homeOf(s);
assert(home, 'createInitialProfile 应种入 home 灯塔');
assert(home.id === HOME && home.level === 1, 'home id/level 应为 lighthouse.home / 1');
assert(home.builtUpgrades instanceof Set && home.builtUpgrades.size === 0, 'home builtUpgrades 应是空 Set');
assert(s.profile.lighthouses.length === 1, '初始应只有 1 座灯塔（home）');
L(`  home: ${home.name} @ (${home.mapX},${home.mapY}) lv${home.level}`);
// round-trip：先在 home 建一个 upgrade，确认 Set 成员被序列化还原
let s1 = stateWith([{ itemId: 'item.coral_shard', qty: 4 }, { itemId: 'item.brass_fitting', qty: 2 }], 100);
s1 = buildAtLighthouse(s1, HOME, BEACON1);
const round = deserializeGameState(serializeGameState(s1));
assert(round, 'deserialize 不应为 null');
const rHome = round!.profile.lighthouses.find((l) => l.id === HOME)!;
assert(rHome.builtUpgrades instanceof Set, 'round-trip 后 builtUpgrades 应还原成 Set（不是 {}）');
assert(rHome.builtUpgrades.has(BEACON1), 'round-trip 后 builtUpgrades 成员应保留');
L('  Lighthouse + builtUpgrades Set round-trip ✓');

// ============================================
// 2. canBuildAt 双资源门控
// ============================================
L('\n========== 2. canBuildAt 门控 ==========');
// (a) 空仓 + 满金 → 材料不足（缺口完整）
s = stateWith([], 9999);
const aNoMat = canBuildAt(s.profile, homeOf(s), BEACON1);
assert(!aNoMat.ok && aNoMat.reason === 'notEnoughMaterials', '只有金币没材料 → notEnoughMaterials');
assert(
  aNoMat.reason === 'notEnoughMaterials' &&
    aNoMat.shortfall.find((m) => m.itemId === 'item.coral_shard')?.qty === 4 &&
    aNoMat.shortfall.find((m) => m.itemId === 'item.brass_fitting')?.qty === 2,
  'shortfall 应列完整缺口（coral×4, brass×2）',
);
// (b) 材料够、金币不够 → notEnoughGold
s = stateWith([{ itemId: 'item.coral_shard', qty: 4 }, { itemId: 'item.brass_fitting', qty: 2 }], 5);
const aNoGold = canBuildAt(s.profile, homeOf(s), BEACON1);
assert(!aNoGold.ok && aNoGold.reason === 'notEnoughGold' && aNoGold.goldShort === 25, '材料够金币 5<30 → notEnoughGold 差 25');
// (c) 跳级（没 lv1 先建 lv2）→ needsPrev（即便材料金币都够）
s = stateWith([{ itemId: 'item.brass_fitting', qty: 9 }, { itemId: 'item.crab_chitin', qty: 9 }], 9999);
const aPrev = canBuildAt(s.profile, homeOf(s), BEACON2);
assert(!aPrev.ok && aPrev.reason === 'needsPrev', 'lv2 在没建 lv1 前应被前置阻挡');
// (d) 灯塔 level 不够 → needsLighthouseLevel（构造 level 0 的灯塔试 lv1，requiresLighthouseLevel 缺省 1）
const lowLh: Lighthouse = { ...createHomeLighthouse(), level: 0 };
const aLvl = canBuildAt(stateWith([{ itemId: 'item.coral_shard', qty: 9 }, { itemId: 'item.brass_fitting', qty: 9 }], 9999).profile, lowLh, BEACON1);
assert(!aLvl.ok && aLvl.reason === 'needsLighthouseLevel', '灯塔 level 0 < 要求 1 → needsLighthouseLevel');
// (e) 不存在
const aUnk = canBuildAt(s.profile, homeOf(s), 'lighthouse.nope');
assert(!aUnk.ok && aUnk.reason === 'unknown', '未注册升级 → unknown');
// (f) 材料金币都够 → ok
s = stateWith([{ itemId: 'item.coral_shard', qty: 4 }, { itemId: 'item.brass_fitting', qty: 2 }], 100);
assert(canBuildAt(s.profile, homeOf(s), BEACON1).ok, '材料+金币都够 → ok');
L('  alreadyBuilt/needsPrev/needsLighthouseLevel/材料/金币/unknown/ok 七态 ✓');

// ============================================
// 3. buildAtLighthouse 扣材料+金币 + 只写目标灯塔
// ============================================
L('\n========== 3. buildAtLighthouse ==========');
// 给 home 一个前哨邻居，确认建 home 不污染前哨
let s3 = stateWith(
  [
    { itemId: 'item.coral_shard', qty: 6 },
    { itemId: 'item.brass_fitting', qty: 6 },
    { itemId: 'item.crab_chitin', qty: 2 },
  ],
  300,
);
const outpost: Lighthouse = { id: 'lighthouse.outpost', name: '前哨', mapX: 0.7, mapY: 0.5, level: 2, builtUpgrades: new Set() };
s3 = { ...s3, profile: { ...s3.profile, lighthouses: [...s3.profile.lighthouses, outpost] } };
const goldB = s3.profile.bankedGold;
s3 = buildAtLighthouse(s3, HOME, BEACON1);
const h = s3.profile.lighthouses.find((l) => l.id === HOME)!;
const o = s3.profile.lighthouses.find((l) => l.id === 'lighthouse.outpost')!;
L(`  建 home beacon.lv1：coral ${countInInventory(s3.profile.inventory, 'item.coral_shard')}（应 2）, brass ${countInInventory(s3.profile.inventory, 'item.brass_fitting')}（应 4）, 金 ${goldB}→${s3.profile.bankedGold}（应 -30）`);
assert(countInInventory(s3.profile.inventory, 'item.coral_shard') === 2, 'coral 应扣 4→剩 2');
assert(countInInventory(s3.profile.inventory, 'item.brass_fitting') === 4, 'brass 应扣 2→剩 4');
assert(s3.profile.bankedGold === goldB - 30, '应扣 30 金');
assert(h.builtUpgrades.has(BEACON1), 'home 应建上 beacon.lv1');
assert(o.builtUpgrades.size === 0, '前哨 builtUpgrades 不应被污染（只写目标灯塔）');
const beaconTrack = getLighthouseTracks().find((t) => t.id === 'lhtrack.beacon')!;
assert(getBuiltLevelInTrack(h, beaconTrack) === 1, 'home 信标轨进度应为 1');
// 不可建时 no-op
const noOp = buildAtLighthouse(stateWith([], 0), HOME, BEACON1);
assert(noOp.profile.lighthouses.find((l) => l.id === HOME)!.builtUpgrades.size === 0, '账单不满足时 build 应 no-op');

// 续建 lv2（home level 1 满足 requiresLighthouseLevel 1）
assert(canBuildAt(s3.profile, h, BEACON2).ok, '建 lv1 后 lv2 应可建');
s3 = buildAtLighthouse(s3, HOME, BEACON2);
const h2 = s3.profile.lighthouses.find((l) => l.id === HOME)!;
assert(h2.builtUpgrades.has(BEACON2) && countInInventory(s3.profile.inventory, 'item.crab_chitin') === 0, 'lv2 应建上、crab 扣 2 清空');
// alreadyBuilt
assert(!canBuildAt(s3.profile, h2, BEACON1).ok && (canBuildAt(s3.profile, h2, BEACON1) as any).reason === 'alreadyBuilt', '已建应返回 alreadyBuilt');
L('  扣材料+金币正确 / 只写目标灯塔 / 续级 / no-op / alreadyBuilt ✓');

// ============================================
// 4. getLighthouseBonuses 聚合
// ============================================
L('\n========== 4. getLighthouseBonuses ==========');
const bonuses = getLighthouseBonuses(h2);
L(`  home bonuses = ${JSON.stringify(bonuses)}（lv1+lv2: radius 2 / reach 1）`);
assert(bonuses.lightRadiusBonus === 2, 'lv1+lv2 → lightRadiusBonus 2');
assert(bonuses.reachReduction === 1, 'lv2 → reachReduction 1');
const empty = getLighthouseBonuses(createHomeLighthouse());
assert(empty.lightRadiusBonus === 0 && empty.reachReduction === 0, '空灯塔 bonuses 应全 0');
L('  聚合 lightRadiusBonus/reachReduction + 空灯塔零 ✓');

// ============================================
// 5. nearestLighthouse
// ============================================
L('\n========== 5. nearestLighthouse ==========');
// home(0.06,0.5) + outpost(0.7,0.5)
const near1 = nearestLighthouse(s3.profile, 0.1, 0.5);
assert(near1 && near1.lighthouse.id === HOME, '靠近岸边(0.1)应最近 home');
const near2 = nearestLighthouse(s3.profile, 0.65, 0.5);
assert(near2 && near2.lighthouse.id === 'lighthouse.outpost', '靠近远海(0.65)应最近前哨');
L(`  (0.1,0.5)→${near1!.lighthouse.id} d=${near1!.distance.toFixed(2)} / (0.65,0.5)→${near2!.lighthouse.id} d=${near2!.distance.toFixed(2)}`);
// 无灯塔 → null
const empties = { ...createInitialGameState().profile, lighthouses: [] };
assert(nearestLighthouse(empties, 0.5, 0.5) === null, '无灯塔应返回 null');
L('  最近灯塔（多座按距离）+ 空 → null ✓');

// ============================================
// 6. revealRadius + 船坞设施桥接 extraConsumableSlot（Phase C 接入）
// ============================================
L('\n========== 6. revealRadius + 船坞桥接 ==========');
// 空 home（level 1，无 beacon）→ 半径 = BASE
const homeBare = createHomeLighthouse();
assert(Math.abs(revealRadius(homeBare) - BASE_LIGHT_RADIUS) < 1e-9, `空 home 半径应=BASE(${BASE_LIGHT_RADIUS})`);
// h2 建了 beacon lv1+lv2（lightRadiusBonus 2）→ 半径 = BASE + 2*PER_BONUS
const expR = BASE_LIGHT_RADIUS + 2 * LIGHT_RADIUS_PER_BONUS;
assert(Math.abs(revealRadius(h2) - expR) < 1e-9, `beacon lv1+lv2 → 半径应=${expR}，实际 ${revealRadius(h2)}`);
L(`  半径：空 home ${revealRadius(homeBare)} / +beacon2 ${revealRadius(h2).toFixed(2)} ✓`);
// 船坞设施 → getLighthouseBonuses.extraConsumableSlot 1；getRunBonuses 把它并进随身加成
const DOCK = 'lighthouse.dockyard.lv1';
let sDock = stateWith([{ itemId: 'item.coral_shard', qty: 6 }, { itemId: 'item.old_fishing_net', qty: 3 }], 50);
sDock = buildAtLighthouse(sDock, HOME, DOCK);
const homeDock = sDock.profile.lighthouses.find((l) => l.id === HOME)!;
assert(getLighthouseBonuses(homeDock).extraConsumableSlot === 1, '船坞 → getLighthouseBonuses.extraConsumableSlot 1');
assert(getRunBonuses(sDock.profile).extraConsumableSlot === 1, '船坞 → getRunBonuses 并回 +1 槽');
assert(getRunBonuses(createInitialGameState().profile).extraConsumableSlot === 0, '没船坞 → 0 槽');
L('  船坞设施 → +1 消耗品槽（getLighthouseBonuses + getRunBonuses 桥）✓');

// ============================================
// 7. devBuildAtLighthouse（#118·quirk #110 家族：引擎无门·0 成本·真经济零触碰）
// ============================================
L('\n========== 7. dev 测试建造（0 成本·#110 口径）==========');
{
  // 空账户（无材料无金币）也能直建——跳过材料/金币/前置/灯塔等级
  let sDev = stateWith([], 0);
  sDev = devBuildAtLighthouse(sDev, HOME, 'lighthouse.beacon.lv2'); // 直跳 lv2=前置也不查
  const homeDev = sDev.profile.lighthouses.find((l) => l.id === HOME)!;
  assert(homeDev.builtUpgrades.has('lighthouse.beacon.lv2'), '7: dev 建造应落 builtUpgrades（跳过前置）');
  assert(sDev.profile.bankedGold === 0, '7: dev 建造不动金币');
  assert(sDev.profile.inventory.length === 0, '7: dev 建造不动材料');
  // 已建 no-op + 未知 no-op（引用相等＝零写入）
  assert(devBuildAtLighthouse(sDev, HOME, 'lighthouse.beacon.lv2') === sDev, '7: 已建应 no-op');
  assert(devBuildAtLighthouse(sDev, HOME, 'lighthouse.nope.lv9') === sDev, '7: 未知 upgrade 应 no-op');
  assert(devBuildAtLighthouse(sDev, 'lighthouse.nope', 'lighthouse.beacon.lv1') === sDev, '7: 未知灯塔应 no-op');
  // 产物与真建造同形：派生加成照常生效
  assert(revealRadius(homeDev) > BASE_LIGHT_RADIUS, '7: dev 建的 beacon 照常进 revealRadius 派生');
  L('  空账户直建（跳前置）/不扣账/已建·未知 no-op/派生同真建 ✓');
}

console.log(log.join('\n'));
console.log('\n✓ 灯塔基地（Phase B 数据模型 + 引擎脚手架）回归通过');
