// 灯塔基地（基建地图 Phase B · 数据模型 + 引擎脚手架）回归：
//   1. home 灯塔在 createInitialProfile 种入；Lighthouse round-trip（builtUpgrades Set 还原）
//   2. canBuildAt 双资源门控：alreadyBuilt / needsPrev / needsLighthouseLevel / 材料不够 / 金币不够 / ok
//   3. buildAtLighthouse 扣材料 ＋ 扣金币 + 只写入目标灯塔的 builtUpgrades（不污染别座）
//   4. getLighthouseBonuses 聚合（船坞 extraConsumableSlot；reveal/reach 扩圈加成已删·作者 2026-06-14）
//   5. nearestLighthouse 最近灯塔 + 距离（多灯塔）
//
// 灯塔此刻 inert（游戏流程还没调用这些）；本脚本单测引擎工具，为 Phase C reveal/reach 打底。
// 信标(beacon)轨已删（作者 2026-06-14）：reveal 半径恒为区域配置·升级不再扩圈。
// 主建造 fixture＝船坞（dockyard·homeOnly·单级）；需要两级链的门控子用例借派生探深轨（probe.trench·引擎不查放置·#131）。
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
} from '../src/engine/lighthouses';
import { regionRadius } from '../src/engine/regions';
import type { GameState, InventoryItem, Lighthouse } from '../src/types';
import { makeHarness, type PtAssert } from './lib/pt';

const pt = makeHarness('灯塔基地（Phase B 数据模型 + 引擎脚手架）回归');
const { L } = pt;
const assert: PtAssert = pt.assert;

const HOME = 'lighthouse.home';
// 主建造 fixture：船坞（lhtrack.dockyard·homeOnly·单级·requiresLighthouseLevel 1）。
const DOCK = 'lighthouse.dockyard.lv1'; // scrap_alloy×3 + old_fishing_net×3 + 20g → effect extraConsumableSlot 1（coral→scrap·经济 2026-06-28）
// 两级链门控（needsPrev / 续级 lv2）借**派生探深轨**（lhtrack.probe.trench·#131 由 depth_columns.json 派生·lv1…lv6）——
// 引擎 canBuildAt/buildAtLighthouse 不查 onlyLighthouse 放置（那是 UI 侧过滤·见 LighthouseBuildPanel），
// 故在 home 上跑它只为验「同轨须先建低一级 + 续级」的纯逻辑（与原 beacon / probe_hadal 链等价）。
const PROBE1 = 'lighthouse.probe.trench.lv1'; // 派生·brass×2 + 60g（effects 空＝纯门控·无 setsFlag）
const PROBE2 = 'lighthouse.probe.trench.lv2'; // 派生·brass×3 + 90g, requiresLighthouseLevel 1

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
// round-trip：先在 home 建一个 upgrade（船坞），确认 Set 成员被序列化还原
let s1 = stateWith([{ itemId: 'item.scrap_alloy', qty: 3 }, { itemId: 'item.old_fishing_net', qty: 3 }], 100);
s1 = buildAtLighthouse(s1, HOME, DOCK);
const round = deserializeGameState(serializeGameState(s1));
assert(round, 'deserialize 不应为 null');
const rHome = round!.profile.lighthouses.find((l) => l.id === HOME)!;
assert(rHome.builtUpgrades instanceof Set, 'round-trip 后 builtUpgrades 应还原成 Set（不是 {}）');
assert(rHome.builtUpgrades.has(DOCK), 'round-trip 后 builtUpgrades 成员应保留');
L('  Lighthouse + builtUpgrades Set round-trip ✓');

// ============================================
// 2. canBuildAt 双资源门控
// ============================================
L('\n========== 2. canBuildAt 门控 ==========');
// (a) 空仓 + 满金 → 材料不足（缺口完整·船坞 scrap×3 + old_fishing_net×3）
s = stateWith([], 9999);
const aNoMat = canBuildAt(s.profile, homeOf(s), DOCK);
assert(!aNoMat.ok && aNoMat.reason === 'notEnoughMaterials', '只有金币没材料 → notEnoughMaterials');
assert(
  aNoMat.reason === 'notEnoughMaterials' &&
    aNoMat.shortfall.find((m) => m.itemId === 'item.scrap_alloy')?.qty === 3 &&
    aNoMat.shortfall.find((m) => m.itemId === 'item.old_fishing_net')?.qty === 3,
  'shortfall 应列完整缺口（scrap×3, old_fishing_net×3）',
);
// (b) 材料够、金币不够 → notEnoughGold（船坞需 20·给 5 → 差 15）
s = stateWith([{ itemId: 'item.scrap_alloy', qty: 3 }, { itemId: 'item.old_fishing_net', qty: 3 }], 5);
const aNoGold = canBuildAt(s.profile, homeOf(s), DOCK);
assert(!aNoGold.ok && aNoGold.reason === 'notEnoughGold' && aNoGold.goldShort === 15, '材料够金币 5<20 → notEnoughGold 差 15');
// (c) 跳级（没 lv1 先建 lv2）→ needsPrev（即便材料金币都够·借探深两级轨）
s = stateWith([{ itemId: 'item.brass_fitting', qty: 9 }, { itemId: 'item.eel_skin', qty: 9 }], 9999);
const aPrev = canBuildAt(s.profile, homeOf(s), PROBE2);
assert(!aPrev.ok && aPrev.reason === 'needsPrev', 'lv2 在没建 lv1 前应被前置阻挡');
// (d) 灯塔 level 不够 → needsLighthouseLevel（构造 level 0 的灯塔试船坞，requiresLighthouseLevel 1）
const lowLh: Lighthouse = { ...createHomeLighthouse(), level: 0 };
const aLvl = canBuildAt(stateWith([{ itemId: 'item.scrap_alloy', qty: 9 }, { itemId: 'item.old_fishing_net', qty: 9 }], 9999).profile, lowLh, DOCK);
assert(!aLvl.ok && aLvl.reason === 'needsLighthouseLevel', '灯塔 level 0 < 要求 1 → needsLighthouseLevel');
// (e) 不存在
const aUnk = canBuildAt(s.profile, homeOf(s), 'lighthouse.nope');
assert(!aUnk.ok && aUnk.reason === 'unknown', '未注册升级 → unknown');
// (f) 材料金币都够 → ok
s = stateWith([{ itemId: 'item.scrap_alloy', qty: 3 }, { itemId: 'item.old_fishing_net', qty: 3 }], 100);
assert(canBuildAt(s.profile, homeOf(s), DOCK).ok, '材料+金币都够 → ok');
L('  alreadyBuilt/needsPrev/needsLighthouseLevel/材料/金币/unknown/ok 七态 ✓');

// ============================================
// 3. buildAtLighthouse 扣材料+金币 + 只写目标灯塔
// ============================================
L('\n========== 3. buildAtLighthouse ==========');
// 给 home 一个前哨邻居，确认建 home（船坞）不污染前哨。多塞一种料（brass）确认只扣账单内的料。
let s3 = stateWith(
  [
    { itemId: 'item.scrap_alloy', qty: 3 },
    { itemId: 'item.old_fishing_net', qty: 3 },
    { itemId: 'item.brass_fitting', qty: 2 },
  ],
  300,
);
const outpost: Lighthouse = { id: 'lighthouse.outpost', name: '前哨', mapX: 0.7, mapY: 0.5, level: 2, builtUpgrades: new Set() };
s3 = { ...s3, profile: { ...s3.profile, lighthouses: [...s3.profile.lighthouses, outpost] } };
const goldB = s3.profile.bankedGold;
s3 = buildAtLighthouse(s3, HOME, DOCK);
const h = s3.profile.lighthouses.find((l) => l.id === HOME)!;
const o = s3.profile.lighthouses.find((l) => l.id === 'lighthouse.outpost')!;
L(`  建 home dockyard.lv1：scrap ${countInInventory(s3.profile.inventory, 'item.scrap_alloy')}（应 0）, net ${countInInventory(s3.profile.inventory, 'item.old_fishing_net')}（应 0）, 金 ${goldB}→${s3.profile.bankedGold}（应 -20）`);
assert(countInInventory(s3.profile.inventory, 'item.scrap_alloy') === 0, 'scrap 应扣 3→剩 0');
assert(countInInventory(s3.profile.inventory, 'item.old_fishing_net') === 0, 'net 应扣 3→剩 0');
assert(countInInventory(s3.profile.inventory, 'item.brass_fitting') === 2, '账单外的 brass 不应被动（仍剩 2）');
assert(s3.profile.bankedGold === goldB - 20, '应扣 20 金');
assert(h.builtUpgrades.has(DOCK), 'home 应建上 dockyard.lv1');
assert(o.builtUpgrades.size === 0, '前哨 builtUpgrades 不应被污染（只写目标灯塔）');
const dockTrack = getLighthouseTracks().find((t) => t.id === 'lhtrack.dockyard')!;
assert(getBuiltLevelInTrack(h, dockTrack) === 1, 'home 船坞轨进度应为 1');
// 不可建时 no-op
const noOp = buildAtLighthouse(stateWith([], 0), HOME, DOCK);
assert(noOp.profile.lighthouses.find((l) => l.id === HOME)!.builtUpgrades.size === 0, '账单不满足时 build 应 no-op');
// alreadyBuilt（船坞单级·已建即满）
assert(!canBuildAt(s3.profile, h, DOCK).ok && (canBuildAt(s3.profile, h, DOCK) as any).reason === 'alreadyBuilt', '已建应返回 alreadyBuilt');

// 续级 lv2（船坞单级没有 lv2·借探深两级轨验「建 lv1 后 lv2 可建 + 扣料」）：
// 引擎不查放置门，故在 home 上建探深只为走 lv1→lv2 的级链逻辑（与原 beacon lv1/lv2 等价）。
let sChain = stateWith(
  [
    { itemId: 'item.brass_fitting', qty: 5 },
    { itemId: 'item.eel_skin', qty: 2 },
  ],
  200,
);
sChain = buildAtLighthouse(sChain, HOME, PROBE1);
const hc1 = sChain.profile.lighthouses.find((l) => l.id === HOME)!;
assert(hc1.builtUpgrades.has(PROBE1), '探深 lv1 应建上');
assert(canBuildAt(sChain.profile, hc1, PROBE2).ok, '建 lv1 后 lv2 应可建（home level 1 满足 requiresLighthouseLevel 1）');
sChain = buildAtLighthouse(sChain, HOME, PROBE2);
const hc2 = sChain.profile.lighthouses.find((l) => l.id === HOME)!;
// 派生 trench 探深 lv1 扣 brass×2、lv2 扣 brass×3 → 共 brass 5（剩 0）；eel 是账单外料（探深不吃·应不动·仍剩 2）。
assert(
  hc2.builtUpgrades.has(PROBE2) &&
    countInInventory(sChain.profile.inventory, 'item.brass_fitting') === 0 &&
    countInInventory(sChain.profile.inventory, 'item.eel_skin') === 2,
  'lv2 应建上、brass 扣净清空（lv1+lv2 共 brass 5）、账单外 eel 不动（仍 2）',
);
assert(getBuiltLevelInTrack(hc2, getLighthouseTracks().find((t) => t.id === 'lhtrack.probe.trench')!) === 2, '派生探深轨进度应为 2');
L('  扣材料+金币正确 / 账单外料不动 / 只写目标灯塔 / 续级 / no-op / alreadyBuilt ✓');

// ============================================
// 4. getLighthouseBonuses 聚合
// ============================================
L('\n========== 4. getLighthouseBonuses ==========');
// reveal/reach 扩圈加成（lightRadiusBonus / reachReduction）已删（作者 2026-06-14·信标轨删）；
// 现存可聚合的设施加成＝船坞的 extraConsumableSlot。h＝已建 dockyard.lv1 的 home。
const bonuses = getLighthouseBonuses(h);
L(`  home bonuses = ${JSON.stringify(bonuses)}（dockyard.lv1: extraConsumableSlot 1）`);
assert(bonuses.extraConsumableSlot === 1, 'dockyard.lv1 → extraConsumableSlot 1');
const empty = getLighthouseBonuses(createHomeLighthouse());
assert(empty.extraConsumableSlot === 0, '空灯塔 extraConsumableSlot 0');
L('  聚合 extraConsumableSlot + 空灯塔零（reveal/reach 扩圈加成已删·作者 2026-06-14）✓');

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
// 空 home（level 1，无升级）→ 半径 = 区域配置。
const homeBare = createHomeLighthouse();
assert(Math.abs(revealRadius(homeBare) - regionRadius(homeBare.id)) < 1e-9, `空 home 半径应=区域配置(${regionRadius(homeBare.id)})`);
// 作者 2026-06-14：reveal 半径固定为区域配置·升级**不再**扩大它（信标轨 lightRadiusBonus 已删）。
// hc2＝建了探深 lv1+lv2 的 home（有升级）；半径仍恒为 home 区域配置（与空 home 一致）。
assert(Math.abs(revealRadius(hc2) - regionRadius(homeBare.id)) < 1e-9, `带升级的 home → 半径仍=区域配置(${regionRadius(homeBare.id)})·升级不扩，实际 ${revealRadius(hc2)}`);
// 提一级灯塔 level 也不该扩半径（半径只认区域配置·与 level 解耦）。
const homeLvUp: Lighthouse = { ...createHomeLighthouse(), level: 3 };
assert(Math.abs(revealRadius(homeLvUp) - regionRadius(homeBare.id)) < 1e-9, `level 3 的 home → 半径仍=区域配置·level 不扩，实际 ${revealRadius(homeLvUp)}`);
L(`  半径：空 home ${revealRadius(homeBare)} / +探深升级 ${revealRadius(hc2).toFixed(2)} / level3 ${revealRadius(homeLvUp).toFixed(2)}（恒定·升级/level 均不扩扫描）✓`);
// 船坞设施 → getLighthouseBonuses.extraConsumableSlot 1；getRunBonuses 把它并进随身加成
let sDock = stateWith([{ itemId: 'item.scrap_alloy', qty: 3 }, { itemId: 'item.old_fishing_net', qty: 3 }], 50);
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
  // 空账户（无材料无金币）也能直建——跳过材料/金币/前置/灯塔等级。
  // 借派生探深两级轨直跳 lv2（前置也不查）＝验「dev 跳过 needsPrev」（信标轨已删·改用派生 probe.trench·#131）。
  let sDev = stateWith([], 0);
  sDev = devBuildAtLighthouse(sDev, HOME, PROBE2); // 直跳 lv2=前置也不查
  const homeDev = sDev.profile.lighthouses.find((l) => l.id === HOME)!;
  assert(homeDev.builtUpgrades.has(PROBE2), '7: dev 建造应落 builtUpgrades（跳过前置）');
  assert(sDev.profile.bankedGold === 0, '7: dev 建造不动金币');
  assert(sDev.profile.inventory.length === 0, '7: dev 建造不动材料');
  // 已建 no-op + 未知 no-op（引用相等＝零写入）
  assert(devBuildAtLighthouse(sDev, HOME, PROBE2) === sDev, '7: 已建应 no-op');
  assert(devBuildAtLighthouse(sDev, HOME, 'lighthouse.nope.lv9') === sDev, '7: 未知 upgrade 应 no-op');
  assert(devBuildAtLighthouse(sDev, 'lighthouse.nope', PROBE1) === sDev, '7: 未知灯塔应 no-op');
  // 产物与真建造同形：派生加成照常生效（reveal 半径恒为区域配置·升级不扩）
  assert(Math.abs(revealRadius(homeDev) - regionRadius(homeDev.id)) < 1e-9, '7: dev 建升级·reveal 半径固定不扩（作者 2026-06-14·升级不扩扫描）');
  L('  空账户直建（跳前置）/不扣账/已建·未知 no-op/派生同真建 ✓');
}

pt.done();
