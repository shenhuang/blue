// 塌架墓园（wreck 风格 zone）验证脚本（2026-07-12 随机内容层拆除后 reduce·见正文注）：
//   1. zone.wreck_graveyard 注册存在，canFreeAscend=true（与蓝洞群的封闭水域对照）
//   2. mapgen 生成 6 层节点图 + POI 专属事件门控（surviving 内容＝poiId 钉在 poi.dive.wreck.story 的
//      wreck_graveyard.temperate_revisit·随机盲池已空）
//   3. 沉船蛛蟹敌人 + solo / pair 两个 encounter 都已注册
//   5. 蛛蟹 solo/pair 战斗能跑通，掉落 crab_chitin
//   7. portEvent 链：waterlogged_logbook → wreck_graveyard.logbook_read，lore.wreck_graveyard.last_page 入账
//   8. crab_chitin 走 Mira 收购入账 bankedGold
//
// 拆除说明（2026-07-12 随机内容层删除）：原「随机盲池组成」（Phase 2 native + reef.json 复用 wreck.*）、
//   engine_room_hum 触发双战（Phase 4）、lost_diver 拾 logbook（Phase 7 头）、roam.wreck_north_collapse 相位隔离
//   （Phase 10）所依赖的事件均已删——wreck_graveyard.json 现仅 3 事件（pocket_watch_log/logbook_read 港口事件 +
//   temperate_revisit poiId 门控）；本脚本 reduce 到「仍成立」的：zone/mapgen + poiId 门控 + 蛛蟹战斗 + 港口事件 + Mira。
//
// 跑法： npx tsx scripts/playthrough-wreckyard.ts

import { createInitialGameState, createNewRun } from '../src/engine/state';
import { generateDiveMap } from '../src/engine/mapgen';
import { buildEventPool, getZone, getEventById } from '../src/engine/zones';
import { isAscentBlocked, executeAscent } from '../src/engine/ascent';
import { getEnemyDef, getEncounter } from '../src/engine/combat';
import { resolveOption } from '../src/engine/events';
import {
  miraOfferFor,
  sellItemToMira,
  handleReturnToPort,
} from '../src/engine/port';
import { eventDoneFlag, pickFromInventory } from '../src/engine/portEvents';
import { runCombatScenario } from '../src/engine/combatScenario';
import { generateChart, poiLockReason } from '../src/engine/chart';
import aldoData from '../src/data/npcs/aldo.json';
import type { GameState } from '../src/types';
import { makeHarness, type PtAssert } from './lib/pt';

const pt = makeHarness('塌架墓园 playthrough');
const { L } = pt;
const assert: PtAssert = pt.assert;

function makeRng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

// ============================================
// Phase 1: zone 数据 + mapgen 行为
// ============================================
L('========== 塌架墓园 zone + mapgen ==========');
const zone = getZone('zone.wreck_graveyard');
assert(zone, 'zone.wreck_graveyard 必须存在');
assert(zone!.canFreeAscend !== false, 'canFreeAscend 应默认 true（开阔水域）');
assert(zone!.depthRange[0] === 18 && zone!.depthRange[1] === 50, 'depthRange 应是 [18,50]');
assert(zone!.layerCount === 6, 'layerCount 应是 6');
L(`  zone: ${zone!.name}, depth ${zone!.depthRange.join('-')}m, ${zone!.layerCount} layers, canFreeAscend=${zone!.canFreeAscend ?? true}`);

let totalMaps = 0;
let middleAscentPointMapCount = 0;
let lastLayerAscentMaps = 0;
for (let seed = 1; seed <= 10; seed++) {
  const map = generateDiveMap({
    zone: zone!,
    profileFlags: new Set(['flag.tutorial_complete']),
    deaths: [],
    rng: makeRng(seed),
  });
  totalMaps++;
  let hasMiddleAscent = false;
  let hasLastAscent = false;
  for (const node of Object.values(map.nodes)) {
    if (node.kind === 'ascent_point') {
      if (node.layer === zone!.layerCount - 1) hasLastAscent = true;
      else hasMiddleAscent = true;
    }
  }
  if (hasMiddleAscent) middleAscentPointMapCount++;
  if (hasLastAscent) lastLayerAscentMaps++;
}
L(`  ${totalMaps} 张 map：中间层 ascent_point 出现于 ${middleAscentPointMapCount} 张；末层 ascent_point ${lastLayerAscentMaps} 张`);
// #220：free-ascend 区中间层**不再**生成 ascent_point 节点——你随时可「此处上浮」，再放一个要先游过去的
// 上浮口节点纯属冗余 + 误导（还会把更深的剧情点埋在身后·见 east_reef 重访沉船）。故现在与蓝洞群一样：
// 中间层 0 个 ascent_point；二者区别只在「能否随处上浮」（free-ascend vs isAscentBlocked），不在节点种类。
// 这条断言＝chooseLayeredNodeKind「free-ascend 中层不放 ascent_point」的回归门。
assert(
  middleAscentPointMapCount === 0,
  `free-ascend 区中间层不应再有 ascent_point 节点（#220·冗余+误导已删）——实际 ${middleAscentPointMapCount}/${totalMaps} 张有`,
);
// 末层 ascent_point（图尽头出口）仍保留——10 张全有。
assert(
  lastLayerAscentMaps === totalMaps,
  `末层 ascent_point（图尽头出口）应每张都在——实际 ${lastLayerAscentMaps}/${totalMaps}`,
);

// ============================================
// Phase 2: POI 专属事件门控（随机盲池已空·surviving 内容 = temperate_revisit 钉在 poi.dive.wreck.story）
// ============================================
// 随机内容层删除后（2026-07-12）：wreck_graveyard 随机盲池为空（pocket_watch_log/logbook_read 是港口事件·weight 0·
// 不进下潜池）；唯一的下潜内容是 wreck_graveyard.temperate_revisit（poiId=poi.dive.wreck.story·主线 beat 潜点专属）。
// 本 Phase 守「poiId 门控」：传对应 poiId ⇒ 进池；非 POI 下潜（无 poiId）⇒ 盲池空、专属事件不漏。
L('\n========== 塌架墓园 POI 专属事件门控（随机盲池已空）==========');
const flags = new Set(['flag.tutorial_complete']);
const WRECK_STORY_POI = 'poi.dive.wreck.story';
const TEMPERATE_EV = 'wreck_graveyard.temperate_revisit';
assert(getEventById(TEMPERATE_EV)?.poiId === WRECK_STORY_POI, `${TEMPERATE_EV} 应 poiId 钉在 ${WRECK_STORY_POI}`);
for (const depth of [20, 30, 40, 50]) {
  const blindPool = buildEventPool({ zone: zone!, depth, profileFlags: flags, triggeredEventIds: [] });
  assert(
    !blindPool.some((e) => e.id === TEMPERATE_EV),
    `${depth}m 非 POI 下潜（无 poiId）⇒ POI 专属 ${TEMPERATE_EV} 不漏进盲池`,
  );
}
// 传对应 poiId ⇒ temperate_revisit 进池（在其 depthRange 内的深度）。
const poiPool = buildEventPool({ zone: zone!, depth: 40, profileFlags: flags, triggeredEventIds: [], poiId: WRECK_STORY_POI });
assert(poiPool.some((e) => e.id === TEMPERATE_EV), `下潜 ${WRECK_STORY_POI} ⇒ 专属事件 ${TEMPERATE_EV} 进池`);
L(`  POI 门控：下潜 ${WRECK_STORY_POI} ⇒ ${TEMPERATE_EV} 进池 / 非 POI 盲池不漏 ✓`);

// ============================================
// Phase 3: 蛛蟹敌人 + encounter 注册
// ============================================
L('\n========== 沉船蛛蟹注册 ==========');
const crabDef = getEnemyDef('enemy.wreck_spider_crab');
assert(crabDef, '沉船蛛蟹 EnemyDef 必须注册');
assert(crabDef!.hp === 22, `HP 应为 22，实际 ${crabDef!.hp}`);
assert(crabDef!.defense === 2, `defense 应为 2`);
assert(crabDef!.hostility === 'territorial', `hostility 应为 territorial（确保走主动撤退路径）`);
assert(crabDef!.victoryConditions.includes('flee'), 'victoryConditions 应含 flee');
L(`  ${crabDef!.name}: HP=${crabDef!.hp}/defense=${crabDef!.defense}/threat=${crabDef!.threat}`);
L(`  attacks: ${crabDef!.attacks.map(a => `${a.name}[${a.damage.join('-')}]w=${a.weight}`).join(', ')}`);
const soloEnc = getEncounter('combat.wreck_spider_crab_solo');
const pairEnc = getEncounter('combat.wreck_spider_crabs_pair');
assert(soloEnc, 'solo encounter 必须注册');
assert(pairEnc, 'pair encounter 必须注册');
assert(pairEnc!.party.members.length === 2, 'pair encounter 应有 2 个 member');
L(`  encounters: ${soloEnc!.id}(${soloEnc!.party.members.length}), ${pairEnc!.id}(${pairEnc!.party.members.length})`);

// （Phase 4「engine_room_hum → 双蛛蟹战斗」随该事件删除·2026-07-12 移除·pair 战斗仍由 Phase 6 直接跑 encounter 覆盖。）

// ============================================
// Phase 5: solo 战斗 playthrough（端到端：从 startCombat 一路打到 victory）
// ============================================
L('\n========== solo 蛛蟹战斗 → loot ==========');
const cbResult = runCombatScenario({
  combatId: 'combat.wreck_spider_crab_solo',
  seed: 1,
  actions: [
    { actionId: 'action.knife_slash', targetIndex: 0 },
    { actionId: 'action.knife_slash', targetIndex: 0 },
    { actionId: 'action.knife_slash', targetIndex: 0 },
  ],
});
assert(cbResult.errors.length === 0, `solo 战斗不应报错：${cbResult.errors.join('|')}`);
assert(cbResult.summary.outcome === 'victory', `solo 应胜利`);
assert(cbResult.summary.turnsElapsed <= 5, `solo 应在 5 回合内收尾，实际 ${cbResult.summary.turnsElapsed}`);
const gotChitin = cbResult.summary.lootGained.find((l) => l.itemId === 'item.crab_chitin');
assert(gotChitin && gotChitin.qty >= 1, 'solo 应掉落至少 1 个 crab_chitin');
assert(cbResult.summary.finalHp >= 60, `solo 应剩 ≥ 60 stamina（教学鲨鱼对照组剩 75–84）`);
L(`  outcome=${cbResult.summary.outcome} turns=${cbResult.summary.turnsElapsed} HP残=${cbResult.summary.finalHp} loot=${gotChitin!.qty}×chitin`);

// ============================================
// Phase 6: pair 战斗（首个多体 encounter，验证 targetIndex）
// ============================================
L('\n========== pair 蛛蟹战斗 → loot ==========');
const pairResult = runCombatScenario({
  combatId: 'combat.wreck_spider_crabs_pair',
  seed: 3,
  actions: [
    { actionId: 'action.knife_slash', targetIndex: 0 },
    { actionId: 'action.knife_slash', targetIndex: 0 },
    { actionId: 'action.knife_slash', targetIndex: 0 },
    { actionId: 'action.knife_slash', targetIndex: 0 },
    { actionId: 'action.knife_slash', targetIndex: 1 },
    { actionId: 'action.knife_slash', targetIndex: 1 },
    { actionId: 'action.knife_slash', targetIndex: 1 },
  ],
});
assert(pairResult.errors.length === 0, `pair 战斗不应报错`);
assert(pairResult.summary.outcome === 'victory', `pair 应胜利`);
const pairChitin = pairResult.summary.lootGained.find((l) => l.itemId === 'item.crab_chitin');
assert(pairChitin && pairChitin.qty === 2, `pair 应掉落 2 个 chitin，实际 ${pairChitin?.qty}`);
assert(pairResult.summary.enemiesAlive.length === 0, 'pair 应全部清场');
L(`  outcome=${pairResult.summary.outcome} turns=${pairResult.summary.turnsElapsed} HP残=${pairResult.summary.finalHp} loot=${pairChitin!.qty}×chitin`);

// ============================================
// Phase 7: 端到端 —— portEvent 链（waterlogged_logbook → 回港 → logbook_read）
// ============================================
// 随机内容层删除后 lost_diver（曾用来拾 waterlogged_logbook）已删：直接把 waterlogged_logbook（logbook_read 港口
// 事件触发物）+ crab_chitin（战斗后带回·此处简化不实跑战斗）塞进 run.inventory，走上浮→回港→portEvent 链。
L('\n========== 端到端：上浮 → 回港 → portEvent（logbook_read）==========');
let state: GameState = createInitialGameState();
state = {
  ...state,
  profile: { ...state.profile, flags: new Set(['flag.tutorial_complete']) },
  run: {
    ...createNewRun({ zoneId: 'zone.wreck_graveyard' }),
    currentDepth: 30,
    visitedNodeIds: ['n0', 'n1'],
    inventory: [
      { itemId: 'item.waterlogged_logbook', qty: 1 },
      { itemId: 'item.crab_chitin', qty: 1 },
    ],
  },
};
const haveLog = state.run!.inventory.find((i) => i.itemId === 'item.waterlogged_logbook');
assert(haveLog && haveLog.qty === 1, 'run.inventory 应含 1 × waterlogged_logbook（logbook_read 触发物）');

// 上浮（开阔水域 → 任意位置可 normal）
assert(!isAscentBlocked(state.run!), '开阔水域应可自由上浮');
const ascR = executeAscent(state, 'normal');
state = ascR.state;
L(`  上浮：phase=${state.phase.kind}, bends=${ascR.bendsType}`);
assert(state.phase.kind === 'resolution', '上浮后应到 resolution');
const outcome = (state.phase as { kind: 'resolution'; outcome: { lootValue: number } }).outcome;
const expectedLoot = miraOfferFor('item.crab_chitin');
// waterlogged_logbook 是 story（sellPrice 0），不计入 lootValue；crab_chitin × 1 = 8 × 0.8 = 6
assert(outcome.lootValue === expectedLoot, `lootValue ${outcome.lootValue} 应 = ${expectedLoot}（只算 crab_chitin）`);
L(`  outcome.lootValue=${outcome.lootValue}（仅 crab_chitin，logbook 是 story 物不计）`);

// 回港 → 应触发 logbook 的 portEvent
const ret = handleReturnToPort(state);
state = ret.state;
const trigger = ret.cutsceneEventId;
assert(trigger === 'wreck_graveyard.logbook_read', `portEvent 应为 logbook_read，实际 ${trigger}`);
L(`  回港触发 cutscene: ${trigger}`);

// 跑 cutscene 的唯一 option
const cutsceneEv = getEventById(trigger!)!;
{
  const result = resolveOption(state, cutsceneEv.options[0]);
  state = result.state;
}
// 模拟 PortEventView.finalize
state = {
  ...state,
  profile: {
    ...state.profile,
    flags: new Set([...state.profile.flags, eventDoneFlag(trigger!)]),
  },
  run: null,
  phase: { kind: 'port' },
};
assert(state.profile.loreEntries.has('lore.wreck_graveyard.last_page'), 'cutscene 应解锁 lore.wreck_graveyard.last_page');
L(`  lore.wreck_graveyard.last_page ✓`);

// 二次触发应被吃掉
const fakeState: GameState = {
  ...state,
  run: {
    ...createNewRun({ zoneId: 'zone.wreck_graveyard' }),
    inventory: [{ itemId: 'item.waterlogged_logbook', qty: 1 }],
  },
};
const trigger2 = pickFromInventory(fakeState.run!.inventory, fakeState.profile.flags);
assert(trigger2 === null, `event_done flag 应防重播，但 pickFromInventory 返回 ${trigger2}`);
L(`  防重播 ✓`);

// brass_pocket_watch 的 portEvent 链路：单独再来一遍（短路径）
L('\n========== 端到端：brass_pocket_watch → portEvent ==========');
const watchState: GameState = {
  ...state,
  run: {
    ...createNewRun({ zoneId: 'zone.wreck_graveyard' }),
    inventory: [{ itemId: 'item.brass_pocket_watch', qty: 1 }],
  },
};
const watchTrigger = pickFromInventory(watchState.run!.inventory, watchState.profile.flags);
assert(watchTrigger === 'wreck_graveyard.pocket_watch_log', `brass_pocket_watch 应触发 pocket_watch_log，实际 ${watchTrigger}`);
L(`  pocket_watch_log ✓`);
const watchCutscene = getEventById(watchTrigger!)!;
let watchEndState: GameState | null = null;
{
  // resolveOption 需要 run，已有 run 状态（watchState）
  const result = resolveOption(watchState, watchCutscene.options[0]);
  watchEndState = result.state;
}
// 注：cutscene 中 loreEntry 通过 applyOutcome 路由——cutscene 跑在 dive phase 时仍走 profile.loreEntries
assert(watchEndState!.profile.loreEntries.has('lore.wreck_graveyard.h_m'), '应解锁 lore.wreck_graveyard.h_m');
L(`  lore.wreck_graveyard.h_m ✓`);

// ============================================
// Phase 8: Mira 收购 crab_chitin
// ============================================
L('\n========== Mira 收购 ==========');
const before = state.profile.bankedGold;
const merged = state.profile.inventory.find((i) => i.itemId === 'item.crab_chitin');
assert(merged && merged.qty === 1, '回港后 crab_chitin 应在 profile.inventory');
state = sellItemToMira(state, 'item.crab_chitin', 1);
const gained = state.profile.bankedGold - before;
const offerPerUnit = miraOfferFor('item.crab_chitin');
assert(gained === offerPerUnit, `卖 1 个 chitin 应入账 ${offerPerUnit}，实际 +${gained}`);
L(`  卖 1 × crab_chitin → 银行 ${before} → ${state.profile.bankedGold}（单价 ${offerPerUnit}）`);

// ============================================
// Phase 9: 海图出海点位（塌架墓园）—— 海图取代了旧 Aldo zone 下拉
// ============================================
L('\n========== 海图出海点位（塌架墓园）==========');
// Aldo briefing 现在只给「摊开海图」(open_chart)，不再逐个列 zone。
type AldoChoice = { id: string; effects?: Array<{ kind: string }> };
type AldoDialogs = Record<string, { choices: AldoChoice[] }>;
const dialogs = (aldoData as { dialogs: AldoDialogs }).dialogs;
const openChartChoice = dialogs['aldo.briefing'].choices.find((c) => c.id === 'open_chart');
assert(
  openChartChoice?.effects?.some((e) => e.kind === 'openChart'),
  'aldo.briefing 应有 open_chart → openChart effect',
);

// 教学前：海图不应出现塌架墓园（requiresFlags 未满足 = 未发现）
const preChart = generateChart({ profile: createInitialGameState().profile });
assert(
  !preChart.pois.some((p) => p.zoneId === 'zone.wreck_graveyard'),
  '教学前海图不应出现塌架墓园（发现门控）',
);

// 教学后 + 残骸前哨已建（owner=lighthouse.ch1_wreck_outpost 揭示残骸区）：塌架墓园 anchor 出现且可出海
// （开阔水域·无升级门·与蓝洞群一致）。注：主线柱迁移退役了 ch1_temperate_wreck story 锚点（曾以「恒显」
// 顺带让 wreck_graveyard 区在教学后即现）；塌架墓园本身 owner=残骸前哨——建好残骸前哨该区才揭示（区域揭示正轨）。
const postProfile = {
  ...createInitialGameState().profile,
  flags: new Set(['flag.tutorial_complete']),
  lighthouses: [
    ...createInitialGameState().profile.lighthouses,
    { id: 'lighthouse.ch1_wreck_outpost', name: '残骸前哨', mapX: 0.288, mapY: 0.781, level: 1, builtUpgrades: new Set<string>() },
  ],
};
const postChart = generateChart({ profile: postProfile });
const wreckPoi = postChart.pois.find(
  (p) => p.zoneId === 'zone.wreck_graveyard' && p.persistent && !p.story,
);
assert(wreckPoi, '建残骸前哨后海图应有塌架墓园 anchor POI（残骸区揭示）');
assert(
  !poiLockReason(postProfile, wreckPoi!),
  '塌架墓园 anchor 不应有升级门（与蓝洞群一致）',
);
L(`  海图：建残骸前哨后出现「${wreckPoi!.name}」→ zone.wreck_graveyard，无升级门 ✓`);
L(`  发现门控 = flag.tutorial_complete + 残骸区揭示（残骸前哨 owner）`);

// （Phase 10「roaming 专属内容相位隔离」随 roaming 事件 wreck_graveyard.collapse_drift 删除·2026-07-12 移除；
//  poiId 门控机制仍由上方 Phase 2 用 surviving 的 temperate_revisit 覆盖。）

// ============================================
// 收尾
// ============================================

console.log(pt.log.join('\n'));
console.log('\n✓ 塌架墓园 playthrough 完成');
console.log(`最终：银行 ${state.profile.bankedGold} 金 / lore ${state.profile.loreEntries.size} 条`);
