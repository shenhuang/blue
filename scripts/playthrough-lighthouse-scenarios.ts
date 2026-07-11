// 灯塔修复循环回归（基建地图 Phase C）—— 覆盖：
//   1. scenarios/lighthouse/*.json：lighthouse_ruin 事件的"先走" / "身无分文重燃"两条 harness 路径
//   2. 修复废弃灯塔账单（profile 银行材料＋金币）：成功 push 灯塔 / 扣料扣金 / 置 flag
//   3. 不够 / 已修：失败不改 profile（幂等）
//   4. 灯塔上线后 reveal（点亮远端 POI）+ reach（最近灯塔算 distance 变近）
//   5. 新灯塔存档 round-trip
//
// 修复走事件 outcome.restoreRuinId（applyOutcome → restoreLighthouse 权威校验），账单读 profile 银行，
// 故无法只靠 runEventScenario（它的 inventory 落 run、不落 profile）跑成功路径——成功路径用引擎直调。
//
// 跑法： npx tsx scripts/playthrough-lighthouse-scenarios.ts

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, basename } from 'node:path';
import {
  createInitialGameState,
  createNewRun,
  serializeGameState,
  deserializeGameState,
  countInInventory,
} from '../src/engine/state';
import { getEvent, resolveOption } from '../src/engine/events';
import { canRestoreRuin, getRuinDef, ruinRestoredFlag } from '../src/engine/lighthouses';
import { isPoiLit, effectiveDistance } from '../src/engine/chart';
import { runEventScenario, type ScenarioInput } from '../src/engine/eventScenario';
import type { GameState, ChartPoi, InventoryItem } from '../src/types';
import { makeHarness, type PtAssert } from './lib/pt';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCN_DIR = resolve(__dirname, '../scenarios/lighthouse');

const pt = makeHarness('灯塔修复循环（Phase C）回归');
const { L } = pt;
const assert: PtAssert = pt.assert;

const RUIN_ID = 'ruin.north_beacon';
const OUTPOST_ID = 'lighthouse.outpost_north';
const ruin = getRuinDef(RUIN_ID)!;

// ============================================
// 1. scenarios/lighthouse/*.json（harness 可跑的路径：先走 / 身无分文重燃）
// ============================================
L('========== 1. scenarios/lighthouse/*.json ==========');
type Expect = {
  steps?: number;
  finalPhase?: string;
  flagsAdded?: string[];
  combatTriggered?: string | null;
};
const files = readdirSync(SCN_DIR).filter((f) => f.endsWith('.json'));
// 废弃灯塔修复（Phase C·restoreLighthouse/ruins[]）的**入口事件** lighthouse.ruin_north 是 random-pool 事件，
// 随随机内容层拆除删除（2026-07-12）——机制 + ruins[] 数据留，但入口 dormant·无场景可跑。内容重做后此门自动恢复（TODO）。
if (files.length === 0) {
  console.log('⊘ scenarios/lighthouse 空：ruin 入口事件已随随机内容层删·废弃灯塔修复机制 dormant（内容待重做 TODO）。');
  process.exit(0);
}
for (const f of files) {
  const raw = JSON.parse(readFileSync(resolve(SCN_DIR, f), 'utf-8')) as ScenarioInput & {
    expect?: Expect;
  };
  const res = runEventScenario(raw);
  assert(res.errors.length === 0, `${f}: 不应有错误（${res.errors.join('; ')}）`);
  const ex = raw.expect;
  if (ex) {
    if (ex.steps !== undefined) assert(res.steps.length === ex.steps, `${f}: steps 应=${ex.steps}，实际 ${res.steps.length}`);
    if (ex.finalPhase !== undefined) assert(res.summary.finalPhase === ex.finalPhase, `${f}: finalPhase 应=${ex.finalPhase}，实际 ${res.summary.finalPhase}`);
    if (ex.combatTriggered !== undefined) assert((res.summary.combatTriggered ?? null) === ex.combatTriggered, `${f}: combatTriggered 不符`);
    if (ex.flagsAdded) for (const fl of ex.flagsAdded) assert(res.summary.profileFlagsAdded.includes(fl) || res.summary.runFlagsAdded.includes(fl), `${f}: 应含 flag ${fl}`);
  }
  // 两条 harness 路径都不应修出灯塔（先走=没选修；身无分文=校验失败）→ 不置 restore flag
  assert(!res.summary.profileFlagsAdded.includes(ruinRestoredFlag(RUIN_ID)), `${f}: 不应置 restore flag`);
  L(`  ${basename(f)}: steps=${res.steps.length} finalPhase=${res.summary.finalPhase} ✓`);
}

// ============================================
// 2. 修复成功（引擎直调：profile 银行材料＋金币）
// ============================================
L('\n========== 2. 修复废弃灯塔（账单 + push 灯塔） ==========');
function ruinState(profileInv: InventoryItem[], gold: number): GameState {
  const base = createInitialGameState();
  return {
    ...base,
    profile: {
      ...base.profile,
      flags: new Set(['flag.tutorial_complete']),
      inventory: profileInv.map((i) => ({ ...i })),
      bankedGold: gold,
    },
    run: { ...createNewRun({ zoneId: 'zone.wreck_graveyard' }), currentDepth: 40, currentNodeId: 'n0' },
    phase: { kind: 'dive', subPhase: { kind: 'event', eventId: 'lighthouse.ruin_north' } },
  };
}
// 账单 = brass×4, crab_chitin×2, iron_concretion×1 ＋ 80 金（来自 data/lighthouse_upgrades.json::ruins·材料主题 2026-06-28 beak→iron）
const fullInv: InventoryItem[] = [
  { itemId: 'item.brass_fitting', qty: 5 },
  { itemId: 'item.crab_chitin', qty: 2 },
  { itemId: 'item.iron_concretion', qty: 1 },
];
const ruinEvent = getEvent('lighthouse.ruin_north')!;
const restoreOpt = ruinEvent.options.find((o) => o.id === 'restore')!;

const before = ruinState(fullInv, 100);
assert(canRestoreRuin(before.profile, RUIN_ID).ok, '材料金币够 → canRestoreRuin ok');
const afterRes = resolveOption(before, restoreOpt);
const after = afterRes.state;
const outpost = after.profile.lighthouses.find((l) => l.id === OUTPOST_ID);
assert(outpost, '修复后 profile.lighthouses 应多出北缘前哨灯塔');
assert(outpost!.builtUpgrades instanceof Set && outpost!.builtUpgrades.size === 0, '新灯塔 builtUpgrades 应是空 Set');
assert(outpost!.mapX === ruin.result.mapX && outpost!.level === ruin.result.level, '新灯塔坐标/等级取自 ruin.result');
assert(countInInventory(after.profile.inventory, 'item.brass_fitting') === 1, 'brass 应扣 4（5→1）');
assert(countInInventory(after.profile.inventory, 'item.crab_chitin') === 0, 'crab 应扣 2 清空');
assert(countInInventory(after.profile.inventory, 'item.iron_concretion') === 0, 'iron_concretion 应扣 1 清空');
assert(after.profile.bankedGold === 100 - 80, '应扣 80 金');
assert(after.profile.flags.has(ruinRestoredFlag(RUIN_ID)), '应置 flag.lighthouse_restored.ruin.north_beacon（门控事件不再重复）');
L(`  修复成功：+${OUTPOST_ID} @ (${outpost!.mapX},${outpost!.mapY}) / 扣料扣金 / 置 flag ✓`);

// ============================================
// 3. 不够 / 已修：失败不改 profile（幂等）
// ============================================
L('\n========== 3. 不够 / 已修（幂等） ==========');
const broke = ruinState([], 0);
const brokeAfter = resolveOption(broke, restoreOpt).state;
assert(!brokeAfter.profile.lighthouses.some((l) => l.id === OUTPOST_ID), '身无分文 → 不应 push 灯塔');
assert(!brokeAfter.profile.flags.has(ruinRestoredFlag(RUIN_ID)), '失败不应置 restore flag');
assert(brokeAfter.profile.lighthouses.length === before.profile.lighthouses.length, '失败时灯塔数不变');
L('  身无分文 → 不修、不改 profile ✓');
// 已修：在 after 上再修一次 → alreadyRestored，不重复 push
const reAvail = canRestoreRuin(after.profile, RUIN_ID);
assert(!reAvail.ok && reAvail.reason === 'alreadyRestored', '已修过 → canRestoreRuin alreadyRestored');
const reAfter = resolveOption(after, restoreOpt).state;
assert(reAfter.profile.lighthouses.filter((l) => l.id === OUTPOST_ID).length === 1, '已修后再修不应产生第二座');
L('  已修 → alreadyRestored，不重复 push ✓');

// ============================================
// 4. reveal + reach：灯塔上线后远端被点亮 + 出海更近
// ============================================
L('\n========== 4. 上线后 reveal + reach 变化 ==========');
// 北缘远端 POI（≈0.80，home 点不到，前哨能点到）
const farPoi: ChartPoi = { id: 't.far', zoneId: 'zone.wreck_graveyard', name: '', blurb: '', distance: 2, mapX: 0.85, mapY: 0.64, persistent: false };
assert(!isPoiLit(before.profile, farPoi), '修复前：远端 POI 不被 home 点亮');
assert(isPoiLit(after.profile, farPoi), '修复后：远端 POI 被前哨点亮');
const reachBefore = effectiveDistance(before.profile, farPoi);
const reachAfter = effectiveDistance(after.profile, farPoi);
assert(reachAfter < reachBefore, `修复后 reach 更近：${reachBefore}→${reachAfter}`);
L(`  reveal：暗→亮 / reach：${reachBefore}→${reachAfter} ✓`);

// ============================================
// 5. 新灯塔存档 round-trip
// ============================================
L('\n========== 5. 新灯塔 round-trip ==========');
const round = deserializeGameState(serializeGameState(after));
assert(round, 'deserialize 不应为 null');
const rOutpost = round!.profile.lighthouses.find((l) => l.id === OUTPOST_ID);
assert(rOutpost && rOutpost.builtUpgrades instanceof Set, 'round-trip 后前哨灯塔应在 + builtUpgrades 还原成 Set');
assert(round!.profile.flags.has(ruinRestoredFlag(RUIN_ID)), 'round-trip 后 restore flag 应保留');
L('  存档 round-trip：前哨灯塔 + restore flag 保留 ✓');

pt.done();
