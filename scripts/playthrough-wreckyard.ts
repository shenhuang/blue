// 沉船墓园（wreck 风格 · 第 3 个 random zone）验证脚本：
//   1. zone.wreck_graveyard 注册存在，canFreeAscend=true（与蓝洞群的封闭水域对照）
//   2. mapgen 生成 6 层节点图，中间层可以出现 ascent_point（开阔水域）
//   3. 事件池在 wreck 层有内容（含原生 wreck_graveyard.* + reef.json 里 wreck zoneTag 的复用事件）
//   4. 沉船蛛蟹敌人 + solo / pair 两个 encounter 都已注册
//   5. wreck_graveyard.engine_room_hum 的 investigate_with_knife 能触发 combat.wreck_spider_crabs_pair
//   6. 蛛蟹战斗能跑通，掉落 crab_chitin
//   7. 完整流程：take_logbook → ascend → handleReturnToPort → portEvent 链
//      （waterlogged_logbook → wreck_graveyard.logbook_read），lore.wreck_graveyard.last_page 入账
//   8. crab_chitin 走 Mira 收购入账 bankedGold
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
import { runEventScenario } from '../src/engine/eventScenario';
import { runCombatScenario } from '../src/engine/combatScenario';
import { generateChart, poiLockReason } from '../src/engine/chart';
import aldoData from '../src/data/npcs/aldo.json';
import type { GameState } from '../src/types';
import { makeHarness, type PtAssert } from './lib/pt';

const pt = makeHarness('沉船墓园 playthrough');
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
L('========== 沉船墓园 zone + mapgen ==========');
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
// Phase 2: 事件池：wreck 层在每个深度段都有内容
// ============================================
L('\n========== 沉船墓园事件池 ==========');
const flags = new Set(['flag.tutorial_complete']);
for (const depth of [20, 30, 40, 50]) {
  const pool = buildEventPool({
    zone: zone!,
    depth,
    profileFlags: flags,
    triggeredEventIds: [],
  });
  L(`  ${depth}m 事件池：${pool.length} 个（含 ${pool.filter(e => e.id.startsWith('wreck_graveyard.')).length} 原生 + ${pool.filter(e => !e.id.startsWith('wreck_graveyard.')).length} 复用）`);
  assert(pool.length >= 1, `深度 ${depth}m 应至少 1 个事件可抽`);
  // 至少深度 30m 段能抽到原生 wreck_graveyard.* 事件
  if (depth === 30) {
    const native = pool.filter((e) => e.id.startsWith('wreck_graveyard.'));
    assert(native.length >= 1, `30m 段应有 ≥ 1 原生 wreck_graveyard.* 事件`);
  }
}
// reef.json::wreck.* 应跨 zone 共享给沉船墓园
const pool30 = buildEventPool({
  zone: zone!, depth: 30, profileFlags: flags, triggeredEventIds: [],
});
const reefShared = pool30.filter((e) => e.id === 'wreck.fishing_boat' || e.id === 'wreck.compass');
assert(reefShared.length >= 1, 'reef.json::wreck.* 应至少有一个能在沉船墓园抽到（跨 zone 复用）');
L(`  reef.json 复用到沉船墓园的 wreck.* 事件：${reefShared.map(e => e.id).join(', ')}`);

// ============================================
// Phase 3: 蛛蟹敌人 + encounter 注册
// ============================================
L('\n========== 沉船蛛蟹注册 ==========');
const crabDef = getEnemyDef('enemy.wreck_spider_crab');
assert(crabDef, '沉船蛛蟹 EnemyDef 必须注册');
assert(crabDef!.hp === 22, `HP 应为 22，实际 ${crabDef!.hp}`);
assert(crabDef!.armor === 2, `armor 应为 2`);
assert(crabDef!.hostility === 'territorial', `hostility 应为 territorial（确保走主动撤退路径）`);
assert(crabDef!.victoryConditions.includes('flee'), 'victoryConditions 应含 flee');
L(`  ${crabDef!.name}: HP=${crabDef!.hp}/armor=${crabDef!.armor}/evasion=${crabDef!.evasion}/threat=${crabDef!.threat}`);
L(`  attacks: ${crabDef!.attacks.map(a => `${a.name}[${a.damage.join('-')}]w=${a.weight}`).join(', ')}`);
const soloEnc = getEncounter('combat.wreck_spider_crab_solo');
const pairEnc = getEncounter('combat.wreck_spider_crabs_pair');
assert(soloEnc, 'solo encounter 必须注册');
assert(pairEnc, 'pair encounter 必须注册');
assert(pairEnc!.party.members.length === 2, 'pair encounter 应有 2 个 member');
L(`  encounters: ${soloEnc!.id}(${soloEnc!.party.members.length}), ${pairEnc!.id}(${pairEnc!.party.members.length})`);

// ============================================
// Phase 4: engine_room_hum 触发蛛蟹双战
// ============================================
L('\n========== 引擎室共鸣 → 双蛛蟹战斗 ==========');
const erResult = runEventScenario({
  eventId: 'wreck_graveyard.engine_room_hum',
  depth: 40,
  seed: 7,
  choices: ['investigate_with_knife'],
});
assert(erResult.errors.length === 0, `engine_room_hum 事件不应报错：${erResult.errors.join('|')}`);
assert(
  erResult.summary.combatTriggered === 'combat.wreck_spider_crabs_pair',
  `应触发 pair 战斗，实际 ${erResult.summary.combatTriggered}`,
);
L(`  triggerCombatId = ${erResult.summary.combatTriggered}`);

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
// Phase 7: 端到端 —— 把 portEvent 链完整跑一遍（lost_diver → logbook → 回港 → cutscene）
// ============================================
L('\n========== 端到端：lost_diver → 上浮 → 回港 → portEvent ==========');
let state: GameState = createInitialGameState();
state = {
  ...state,
  profile: { ...state.profile, flags: new Set(['flag.tutorial_complete']) },
  run: {
    ...createNewRun({ zoneId: 'zone.wreck_graveyard' }),
    currentDepth: 30,
    visitedNodeIds: ['n0', 'n1'],
  },
};

// 跑 lost_diver 的 take_logbook
const logEvent = getEventById('wreck_graveyard.lost_diver')!;
const takeLog = logEvent.options.find((o) => o.id === 'take_logbook')!;
{
  const result = resolveOption(state, takeLog);
  state = result.state;
  L(`  lost_diver:take_logbook → ${result.narrative[0].slice(0, 30)}…`);
}
const haveLog = state.run!.inventory.find((i) => i.itemId === 'item.waterlogged_logbook');
assert(haveLog && haveLog.qty === 1, '应拾取 1 × waterlogged_logbook');
assert(state.profile.loreEntries.has('lore.wreck_graveyard.lost_diver'), '应解锁 lore.wreck_graveyard.lost_diver');

// 顺便往 inventory 塞 1 个蛛蟹甲壳，模拟战斗后带回（不实际跑战斗简化）
state = {
  ...state,
  run: {
    ...state.run!,
    inventory: [...state.run!.inventory, { itemId: 'item.crab_chitin', qty: 1 }],
  },
};

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
// Phase 9: 海图出海点位（沉船墓园）—— 海图取代了旧 Aldo zone 下拉
// ============================================
L('\n========== 海图出海点位（沉船墓园）==========');
// Aldo briefing 现在只给「摊开海图」(open_chart)，不再逐个列 zone。
type AldoChoice = { id: string; effects?: Array<{ kind: string }> };
type AldoDialogs = Record<string, { choices: AldoChoice[] }>;
const dialogs = (aldoData as { dialogs: AldoDialogs }).dialogs;
const openChartChoice = dialogs['aldo.briefing'].choices.find((c) => c.id === 'open_chart');
assert(
  openChartChoice?.effects?.some((e) => e.kind === 'openChart'),
  'aldo.briefing 应有 open_chart → openChart effect',
);

// 教学前：海图不应出现沉船墓园（requiresFlags 未满足 = 未发现）
const preChart = generateChart({ profile: createInitialGameState().profile });
assert(
  !preChart.pois.some((p) => p.zoneId === 'zone.wreck_graveyard'),
  '教学前海图不应出现沉船墓园（发现门控）',
);

// 教学后 + 残骸前哨已建（owner=lighthouse.ch1_wreck_outpost 揭示残骸区）：沉船墓园 anchor 出现且可出海
// （开阔水域·无升级门·与蓝洞群一致）。注：主线柱迁移退役了 ch1_temperate_wreck story 锚点（曾以「恒显」
// 顺带让 wreck_graveyard 区在教学后即现）；沉船墓园本身 owner=残骸前哨——建好残骸前哨该区才揭示（区域揭示正轨）。
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
  (p) => p.zoneId === 'zone.wreck_graveyard' && p.persistent && p.columnId === undefined,
);
assert(wreckPoi, '建残骸前哨后海图应有沉船墓园 anchor POI（残骸区揭示）');
assert(
  !poiLockReason(postProfile, wreckPoi!),
  '沉船墓园 anchor 不应有升级门（与蓝洞群一致）',
);
L(`  海图：建残骸前哨后出现「${wreckPoi!.name}」→ zone.wreck_graveyard，无升级门 ✓`);
L(`  发现门控 = flag.tutorial_complete + 残骸区揭示（残骸前哨 owner）`);

// ============================================
// Phase 10: roaming 专属内容相位隔离（roaming POI 内容·2026-06-25）
// ============================================
// 镜像 playthrough-whalefall §6 的 anchor 相位隔离，但守 roaming 的「按 templateId 匹配」这条新机制：
// roaming 实例 id（poi.roam.<runs>.<tpl>）每次出现都变 → 静态事件 poiId 配不上；故事件 poiId 钉**模板身份**
// （roam.wreck_north_collapse），dive-start 透传 poiTemplateId 给 buildEventPool 匹配。这里直接喂 buildEventPool 证：
//   ① 传稳定 poiTemplateId ⇒ roaming 专属事件进池；
//   ② 只传**实例 id 当 poiId**（模拟 run.poiId·每次变）而不给 poiTemplateId ⇒ 配不上、不进池（＝机制缺口的本体）；
//   ③ 非 POI 下潜（都不传）⇒ roaming 专属事件不漏进普通池（钉相生效·anchor 池零影响的同款保证）。
L('\n========== roaming 专属内容相位隔离（templateId 匹配）==========');
const ROAM_TPL = 'roam.wreck_north_collapse';
const ROAM_EV = 'wreck_graveyard.collapse_drift';
const ROAM_INSTANCE = 'poi.roam.7.roam.wreck_north_collapse'; // 实例 id 形状（含 runsCompleted·每次变）
const roamEv = getEventById(ROAM_EV);
assert(roamEv && roamEv.poiId === ROAM_TPL, `${ROAM_EV} 存在且 poiId 钉模板身份 ${ROAM_TPL}`);
// 该事件 depthRange=[24,60]；取 40 居中（塌口 depthOffset +8 后的典型节点深度）。
const roamDepth = 40;
const poolIdsAt = (poiId?: string, poiTemplateId?: string) =>
  new Set(
    buildEventPool({
      zone: zone!,
      depth: roamDepth,
      profileFlags: flags,
      triggeredEventIds: [],
      poiId,
      poiTemplateId,
    }).map((e) => e.id),
  );
// ① 稳定 templateId 透传 ⇒ 进池
assert(
  poolIdsAt(ROAM_INSTANCE, ROAM_TPL).has(ROAM_EV),
  `① 传 poiTemplateId=${ROAM_TPL} ⇒ roaming 专属事件 ${ROAM_EV} 进池`,
);
// ② 只有变动的实例 id 当 poiId、不给 templateId ⇒ 配不上（这正是机制缺口：实例 id 每次变）
assert(
  !poolIdsAt(ROAM_INSTANCE, undefined).has(ROAM_EV),
  `② 只传变动实例 id 当 poiId（无 poiTemplateId）⇒ ${ROAM_EV} 配不上、不进池`,
);
// ③ 非 POI 下潜（poiId / poiTemplateId 都缺省）⇒ roaming 专属事件不漏进普通池
assert(
  !poolIdsAt(undefined, undefined).has(ROAM_EV),
  `③ 非 POI 下潜 ⇒ roaming 专属事件 ${ROAM_EV} 不漏进普通池（钉相生效）`,
);
// ④ anchor 池零影响：给 anchor 的精确 poiId（无 template）仍按老路匹配 anchor 专属事件、不串入 roaming 事件
assert(
  !poolIdsAt('poi.anchor.wreck_graveyard', undefined).has(ROAM_EV),
  `④ 下潜 anchor（poiId 精确匹配·无 template）⇒ 不串入 roaming 事件 ${ROAM_EV}`,
);
L(`  roaming 相位隔离：templateId 命中进池 / 实例 id 配不上 / 非 POI 不漏 / anchor 不串 ✓`);

// ============================================
// 收尾
// ============================================

console.log(pt.log.join('\n'));
console.log('\n✓ 沉船墓园 playthrough 完成');
console.log(`最终：银行 ${state.profile.bankedGold} 金 / lore ${state.profile.loreEntries.size} 条`);
