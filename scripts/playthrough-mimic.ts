// 深水区 Phase 3 mimic capstone 回归（chart 引诱 → 入潜兑现 → d_reveal）。
// 覆盖（作者 2026-06-04 在场逐拍：d_reveal 活下来即触发·保持暧昧 / 回报 lore+d_reveal+unlock·无 loot / 另一个世界先留钩子）：
//   1. 软门控：没有半亮水下前哨 → 海图无「无灯之光」；有 → 注入 mimic POI
//   2. mimic POI：isPoiLit 恒真（诱饵）/ isPoiExplainedByLighthouse 恒假（宏观 tell：不在你网里）
//   3. 横渡：startDiveFromPoi(mimic) 强制把开场设成兑现事件 mimic.false_beacon
//   4. d_reveal 机制：setProfileFlags 持久写 profile.flags（≠ applyFlags 的 run 局部）+ 存档 round-trip
//   5. 事件数据铁律：读穿成功 → d_reveal + survived flag + forceAscend；读错/盲信/拒看 → 不置 d_reveal（保持暧昧）；全 loot-free / 无战斗
//   6. horror-sapien 姊妹 apex（the_wearer_apex）：读穿给 lore、不置 d_reveal（d_reveal 只由 mimic 触发）
//
// 跑法： npx tsx scripts/playthrough-mimic.ts

import {
  createInitialGameState,
  serializeGameState,
  deserializeGameState,
} from '../src/engine/state';
import {
  generateChart,
  isPoiLit,
  isPoiExplainedByLighthouse,
  MIMIC_POI_ID,
  MIMIC_DIVE_EVENT_ID,
} from '../src/engine/chart';
import { startDiveFromPoi } from '../src/engine/dive';
import { applyOutcome } from '../src/engine/events';
import { getEventById } from '../src/engine/zones';
import { outpostStageFlag, OUTPOST_USABLE_STAGE } from '../src/engine/lighthouses';
import type { GameState, EventOption, Outcome } from '../src/types';
import { makeHarness, type PtAssert } from './lib/pt';

const pt = makeHarness('深水区 Phase 3 mimic capstone（chart 引诱 → 入潜兑现 → d_reveal）回归');
const { L } = pt;
const assert: PtAssert = pt.assert;

const D_REVEAL = 'flag.d_reveal';
const SURVIVED = 'flag.mimic.false_beacon.survived';

/** 让任一水下前哨达半亮（USABLE）＝ shouldLureMimic 门控的最小满足（不用真建造、只置阶段 flag）。 */
function deepFootholdState(): GameState {
  const base = createInitialGameState();
  const flags = new Set<string>();
  for (let s = 1; s <= OUTPOST_USABLE_STAGE; s++) flags.add(outpostStageFlag('outpost.ch1_wreck', s));
  return { ...base, profile: { ...base.profile, flags } };
}

// ============================================================
// 1. 软门控：深处立稳脚才被「无灯之光」引诱
// ============================================================
L('========== 1. mimic 引诱软门控 ==========');
const fresh = createInitialGameState();
const chartFresh = generateChart({ profile: fresh.profile });
assert(!chartFresh.pois.some((p) => p.id === MIMIC_POI_ID), '1: 没有半亮水下前哨 → 海图无「无灯之光」');

const deep = deepFootholdState();
const chartDeep = generateChart({ profile: deep.profile });
const mimicPoi = chartDeep.pois.find((p) => p.id === MIMIC_POI_ID);
assert(mimicPoi, '1: 任一水下前哨半亮 → 海图注入「无灯之光」mimic POI');
assert(mimicPoi!.mimic === true, '1: 它带 mimic 标记');
L('  无前哨 → 无引诱 / 半亮前哨 → 「无名的光」出现 ✓');

// ============================================================
// 2. mimic POI：恒亮（诱饵）但不在你网里（宏观 tell）
// ============================================================
L('\n========== 2. 恒亮 + 网外 tell ==========');
assert(isPoiLit(deep.profile, mimicPoi!), '2: isPoiLit(mimic) 恒真（诱饵·海图上点亮）');
assert(!isPoiExplainedByLighthouse(deep.profile, mimicPoi!), '2: isPoiExplainedByLighthouse(mimic) 恒假（不是你网里的灯＝tell）');
L('  isPoiLit ✓ / isPoiExplainedByLighthouse ✗（宏观 tell）✓');

// ============================================================
// 3. 横渡：强制开场兑现事件
// ============================================================
L('\n========== 3. 横渡 → 强制兑现事件 ==========');
const crossed = startDiveFromPoi(deep, mimicPoi!);
assert(crossed.run, '3: 横渡后有 run');
assert(
  crossed.phase.kind === 'dive' &&
    crossed.phase.subPhase?.kind === 'event' &&
    crossed.phase.subPhase.eventId === MIMIC_DIVE_EVENT_ID,
  '3: 横渡到 mimic POI → 开场被强制设成兑现事件 mimic.false_beacon',
);
L(`  startDiveFromPoi(mimic) → 开场事件 ${MIMIC_DIVE_EVENT_ID} ✓`);

// ============================================================
// 4. d_reveal 机制：setProfileFlags 持久写 profile（≠ run 局部）+ round-trip
// ============================================================
L('\n========== 4. setProfileFlags 持久 + round-trip ==========');
const beforeFlags = new Set(crossed.profile.flags);
assert(!beforeFlags.has(D_REVEAL), '4: 横渡时还没置 d_reveal');
const afterReveal = applyOutcome(crossed, { setProfileFlags: [D_REVEAL, SURVIVED] }).state;
assert(afterReveal.profile.flags.has(D_REVEAL), '4: setProfileFlags 持久写进 profile.flags（d_reveal）');
assert(afterReveal.profile.flags.has(SURVIVED), '4: survived 解锁钩子也置上');
const round = deserializeGameState(serializeGameState(afterReveal));
assert(round && round.profile.flags.has(D_REVEAL), '4: d_reveal round-trip 持久（存档保留）');
// 对比：applyFlags 在 dive 中只进 run.activeFlags、不进 profile（保持区分）
const runLocal = applyOutcome(crossed, { applyFlags: ['flag.run_local_probe'] }).state;
assert(!runLocal.profile.flags.has('flag.run_local_probe'), '4: applyFlags（dive 中）不写 profile（仍是 run 局部）');
L('  setProfileFlags 持久写 profile + round-trip / applyFlags 仍 run 局部 ✓');

// ============================================================
// 5. 事件数据铁律（false_beacon）：读穿成功才 d_reveal，其余保持暧昧；全 loot-free / 无战斗
// ============================================================
L('\n========== 5. false_beacon 数据铁律 ==========');
const fb = getEventById('mimic.false_beacon')!;
assert(fb, '5: mimic.false_beacon 已注册');
assert(fb.weight === 0, '5: weight 0（不入节点池、只由横渡强制开场、不可错过）');
const optMap = new Map(fb.options.map((o: EventOption) => [o.id, o]));
const readTell = optMap.get('read_the_tell')!;
const success = readTell.check!.onSuccess;
const failure = readTell.check!.onFailure;
assert((success.setProfileFlags ?? []).includes(D_REVEAL), '5: 读穿成功 → setProfileFlags 含 d_reveal');
assert((success.setProfileFlags ?? []).includes(SURVIVED), '5: 读穿成功 → 含 survived 解锁钩子');
assert(success.endDive === 'forceAscend', '5: 读穿成功 → forceAscend（活着离开）');
assert(success.loreEntry === 'lore.deep_water.the_false_beacon', '5: 读穿成功 → 回收 false_beacon 伏笔 lore');
assert(!(failure.setProfileFlags ?? []).length, '5: 读错 → 不置任何 profile flag（保持暧昧、不廉价交底）');
assert(failure.endDive === 'forceAscend', '5: 读错 → 仍活着离开（无脚本死）');
for (const o of fb.options) {
  const outs: Outcome[] = o.check ? [o.check.onSuccess, o.check.onFailure] : o.outcome ? [o.outcome] : [];
  for (const out of outs) {
    assert(!out.loot || out.loot.length === 0, `5: false_beacon「${o.id}」loot-free`);
    assert(!out.triggerCombatId, `5: false_beacon「${o.id}」不触发战斗（apex 是事件不是战斗敌人）`);
  }
}
// 盲信 / 拒看 都不置 d_reveal（只有"读穿"才换来终局揭示）
for (const id of ['swim_for_it', 'douse_and_back']) {
  const out = optMap.get(id)!.outcome!;
  assert(!(out.setProfileFlags ?? []).length, `5:「${id}」不置 d_reveal（不读＝不揭）`);
  assert(out.endDive === 'forceAscend', `5:「${id}」活着离开`);
}
L('  读穿→d_reveal+survived+forceAscend / 读错·盲信·拒看→不交底 / 全 loot-free 无战斗 ✓');

// ============================================================
// 6. horror-sapien 姊妹 apex：读穿给 lore、不置 d_reveal
// ============================================================
L('\n========== 6. horror-sapien 姊妹 apex ==========');
const wearer = getEventById('mimic.the_wearer_apex')!;
assert(wearer, '6: mimic.the_wearer_apex 已注册');
assert((wearer.zoneTags ?? []).includes('abyssal'), '6: 挂 abyssal tag（深渊 organic 遭遇）');
const wRead = wearer.options.find((o: EventOption) => o.id === 'read_him')!;
assert(wRead.check!.onSuccess.loreEntry === 'lore.wreck_graveyard.the_wearer', '6: 读穿 → 回收 the_wearer 伏笔 lore');
for (const o of wearer.options) {
  const outs: Outcome[] = o.check ? [o.check.onSuccess, o.check.onFailure] : o.outcome ? [o.outcome] : [];
  for (const out of outs) {
    assert(!(out.setProfileFlags ?? []).length, `6:「${o.id}」不置 d_reveal（d_reveal 只由 mimic 触发，作者定）`);
    assert(!out.loot || out.loot.length === 0, `6:「${o.id}」loot-free`);
    assert(!out.triggerCombatId, `6:「${o.id}」不触发战斗`);
  }
}
L('  the_wearer 读穿→lore、不置 d_reveal、loot-free 无战斗 ✓');

pt.done();
