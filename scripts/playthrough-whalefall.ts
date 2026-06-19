// 鲸落支线回归（#137·非主线·区域揭示 SPEC §10）—— 把 ②③④⑤ 的接线焊成 regress 门。
//
// 与 playthrough-story §6 分工：§6 守 ch1WhaleStory 的**派生**（flag→state 纯函数·step①）；
// 本脚本守**事件 / POI / 营地 / zone 的接线**（step ②③④⑤）：
//   §1 中层目击链：3 事件存在 + buildEventPool 链式门控（一次只一档可抽）+ 每选项置计数 flag + 第3档另置 search_ready
//   §2 残骸独立目击：[wreck] 事件置 wreck flag·不计入中层计数·一次性
//   §3 找寻潜点：search_ready 前隐 / 后显（owner=中层浮标）+ openEventId 强制开场 + search→found 链置 whalefall_found
//   §4 鲸落生态点：found 前隐 / 后亮——由 flag-gated 区点亮（**无营地灯塔也亮**·证明 reveal ⊥ 营地）
//   §5 精简营地：requiresFlag+discoveredFlag=found·3 阶·**无深度柱**（getColumnForLighthouse=∅）·**非区 owner**（regionForOwner=∅·建营地不加圈）·补给轨 outpostOnly
//   §6 zone.whalefall + 3 生态事件（[whalefall] 池）
//
// 跑法： npx tsx scripts/playthrough-whalefall.ts （regress.mjs 按 playthrough*.ts 自动注册）

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { createInitialGameState } from '../src/engine/state';
import {
  whaleSightingFlag,
  WHALE_SEARCH_READY_FLAG,
  WHALE_SIGHTING_WRECK_FLAG,
  WHALEFALL_FOUND_FLAG,
  TUTORIAL_COMPLETE_FLAG,
} from '../src/engine/story';
import { buildEventPool, getZone, getEventById } from '../src/engine/zones';
import { resolveOption, isOptionVisible } from '../src/engine/events';
import { isPoiLit, generateChart } from '../src/engine/chart';
import { startDiveFromPoi } from '../src/engine/dive';
import { devGrantItem } from '../src/engine/port';
import { getColumnForLighthouse } from '../src/engine/columns';
import { regionForOwner } from '../src/engine/regions';
import { isChapterOutpost } from '../src/engine/lighthouses';
import type { GameState, PlayerProfile, ChartPoi, Lighthouse, DiveEvent } from '../src/types';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const log: string[] = [];
const L = (s: string) => log.push(s);
function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    console.log(log.join('\n'));
    throw new Error(`[playthrough-whalefall] ${msg}`);
  }
}

// —— 数据加载（chart_pois mapId-keyed·flatten ch1 段；lighthouse_upgrades outposts）——
const chartPoisRaw = JSON.parse(
  readFileSync(resolve(ROOT, 'src/data/chart_pois.json'), 'utf-8'),
) as { ch1: { anchors: ChartPoi[]; roamingTemplates: unknown[] } };
const anchors = chartPoisRaw.ch1.anchors;
const poiById = (id: string): ChartPoi => {
  const p = anchors.find((a) => a.id === id);
  if (!p) throw new Error(`POI 未找到: ${id}`);
  return p;
};

const lhUpgradesRaw = JSON.parse(
  readFileSync(resolve(ROOT, 'src/data/lighthouse_upgrades.json'), 'utf-8'),
) as { outposts: Array<Record<string, unknown>>; tracks?: Array<Record<string, unknown>> };

function profileWith(flags: string[], lighthouses: Lighthouse[] = []): PlayerProfile {
  const p = createInitialGameState().profile;
  return { ...p, flags: new Set(flags), lighthouses: [...p.lighthouses, ...lighthouses] };
}

const MIDWATER_LH: Lighthouse = {
  id: 'lighthouse.ch1_midwater_outpost',
  name: '中层浮标',
  mapX: 0.566,
  mapY: 0.513,
  level: 1,
  builtUpgrades: new Set(),
};

const poolIds = (zoneId: string, depth: number, flags: string[], triggered: string[] = []): Set<string> =>
  new Set(
    buildEventPool({
      zone: getZone(zoneId)!,
      depth,
      sanity: 80,
      profileFlags: new Set(flags),
      triggeredEventIds: triggered,
    }).map((e) => e.id),
  );

// ═══════════════════════════════════════════════════════════════
// §1 中层目击链：事件存在 + 链式门控 + 计数置位
// ═══════════════════════════════════════════════════════════════
L('§1 中层目击链（buildEventPool 链式门控 + 计数置位）');
{
  const ids = ['whalefall.sighting_1', 'whalefall.sighting_2', 'whalefall.sighting_3'];
  const evs = ids.map((id) => getEventById(id));
  assert(evs.every((e): e is DiveEvent => !!e), '§1 三个目击事件应都存在');
  for (const e of evs as DiveEvent[]) {
    assert(e.zoneTags?.includes('midwater'), `§1 ${e.id} 应是 [midwater] 池`);
    assert(e.oncePerRun === true, `§1 ${e.id} 应 oncePerRun（单潜不重复目击）`);
  }

  // 链式门控：中层 depth 70（三档 depthRange 都含）。一次只一档可抽。
  const Z = 'zone.open_midwater';
  const empty = poolIds(Z, 70, [TUTORIAL_COMPLETE_FLAG]);
  assert(empty.has('whalefall.sighting_1'), '§1 空档：sighting_1 在池');
  assert(!empty.has('whalefall.sighting_2') && !empty.has('whalefall.sighting_3'), '§1 空档：sighting_2/3 不在池（prereq 未满）');

  const after1 = poolIds(Z, 70, [TUTORIAL_COMPLETE_FLAG, whaleSightingFlag(1)]);
  assert(!after1.has('whalefall.sighting_1'), '§1 置 sighting.1 后：sighting_1 出池（forbidden）');
  assert(after1.has('whalefall.sighting_2') && !after1.has('whalefall.sighting_3'), '§1 置 sighting.1 后：仅 sighting_2 在池');

  const after2 = poolIds(Z, 70, [TUTORIAL_COMPLETE_FLAG, whaleSightingFlag(1), whaleSightingFlag(2)]);
  assert(after2.has('whalefall.sighting_3') && !after2.has('whalefall.sighting_2'), '§1 置 sighting.1+2 后：仅 sighting_3 在池');

  const after3 = poolIds(Z, 70, [TUTORIAL_COMPLETE_FLAG, whaleSightingFlag(1), whaleSightingFlag(2), whaleSightingFlag(3)]);
  assert(!['whalefall.sighting_1', 'whalefall.sighting_2', 'whalefall.sighting_3'].some((id) => after3.has(id)), '§1 三档齐后：目击链全出池');

  // 计数置位：每档每个选项都置该档计数 flag（目击=progress·不挑选项）；第 3 档另置 search_ready。
  const counterOf: Record<string, string[]> = {
    'whalefall.sighting_1': [whaleSightingFlag(1)],
    'whalefall.sighting_2': [whaleSightingFlag(2)],
    'whalefall.sighting_3': [whaleSightingFlag(3), WHALE_SEARCH_READY_FLAG],
  };
  for (const e of evs as DiveEvent[]) {
    const want = counterOf[e.id];
    for (const opt of e.options) {
      const branches = opt.check ? [opt.check.onSuccess, opt.check.onFailure] : [opt.outcome!];
      for (const b of branches) {
        const set = new Set(b.setProfileFlags ?? []);
        assert(want.every((f) => set.has(f)), `§1 ${e.id} 选项 ${opt.id} 应 setProfileFlags ${want.join('+')}（目击即 progress·不挑选项）`);
      }
    }
  }
  L('  3 事件 · 链式一次一档 · 每选项置计数 · 第3档另置 search_ready ✓');
}

// ═══════════════════════════════════════════════════════════════
// §2 残骸独立目击（不计入中层计数）
// ═══════════════════════════════════════════════════════════════
L('§2 残骸独立目击（[wreck]·不计数·一次性）');
{
  const ev = getEventById('whalefall.sighting_wreck');
  assert(ev && ev.zoneTags?.includes('wreck'), '§2 残骸目击事件存在且为 [wreck] 池');
  for (const opt of ev!.options) {
    const branches = opt.check ? [opt.check.onSuccess, opt.check.onFailure] : [opt.outcome!];
    for (const b of branches) {
      assert((b.setProfileFlags ?? []).includes(WHALE_SIGHTING_WRECK_FLAG), `§2 选项 ${opt.id} 应置 wreck flag`);
      assert(!(b.setProfileFlags ?? []).some((f) => f.startsWith('story.ch1.whale_sighting.') && f !== WHALE_SIGHTING_WRECK_FLAG), `§2 选项 ${opt.id} 不应置任何中层计数位（独立·不计数）`);
    }
  }
  // 门控：wreck depth 45（[34,50]）。置 wreck flag 后出池（一次性）。
  const Z = 'zone.wreck_graveyard';
  assert(poolIds(Z, 45, [TUTORIAL_COMPLETE_FLAG]).has('whalefall.sighting_wreck'), '§2 残骸目击在 [wreck] 池');
  assert(!poolIds(Z, 45, [TUTORIAL_COMPLETE_FLAG, WHALE_SIGHTING_WRECK_FLAG]).has('whalefall.sighting_wreck'), '§2 置 wreck flag 后出池');
  L('  [wreck] 池 · 置 wreck flag 不碰中层计数 · 一次性 ✓');
}

// ═══════════════════════════════════════════════════════════════
// §3 找寻潜点：可见性门 + openEventId 强制开场 + search→found 链
// ═══════════════════════════════════════════════════════════════
L('§3 找寻潜点（search_ready 门 + 强制开场 + found 置位）');
{
  const search = poiById('poi.anchor.whale_search');
  assert(search.owner === 'lighthouse.ch1_midwater_outpost', '§3 找寻潜点 owner=中层浮标（靠中层圈点亮·found 前可见）');
  assert(search.openEventId === 'whalefall.search' && search.openEventFlag === WHALEFALL_FOUND_FLAG, '§3 找寻潜点带 openEventId=whalefall.search / openEventFlag=found');
  assert((search.requiresFlags ?? []).includes(WHALE_SEARCH_READY_FLAG), '§3 找寻潜点 requiresFlags 含 search_ready');

  // 可见性 = requiresFlags(search_ready) 发现门 + owner 灯塔在档（owner-anchored 点亮）·两者都要（generateChart 综合两轴）。
  const searchVisible = (p: PlayerProfile) =>
    generateChart({ profile: p }).pois.some((x) => x.id === 'poi.anchor.whale_search');
  assert(!searchVisible(profileWith([TUTORIAL_COMPLETE_FLAG], [MIDWATER_LH])), '§3 search_ready 未置 → 找寻潜点不在海图（发现门未开）');
  assert(!searchVisible(profileWith([TUTORIAL_COMPLETE_FLAG, WHALE_SEARCH_READY_FLAG])), '§3 search_ready 置但中层浮标未建 → 不在海图（owner-anchored 需 owner 在档）');
  assert(searchVisible(profileWith([TUTORIAL_COMPLETE_FLAG, WHALE_SEARCH_READY_FLAG], [MIDWATER_LH])), '§3 search_ready 置 + 中层浮标在档 → 找寻潜点在海图');

  // openEventId 强制开场：search_ready 置、found 未置 → 入潜强制 whalefall.search。
  const base = createInitialGameState();
  const state: GameState = { ...base, profile: profileWith([TUTORIAL_COMPLETE_FLAG, WHALE_SEARCH_READY_FLAG], [MIDWATER_LH]) };
  const dived = startDiveFromPoi(state, search);
  assert(dived.phase.kind === 'dive' && dived.phase.subPhase.kind === 'event' && dived.phase.subPhase.eventId === 'whalefall.search', '§3 入潜找寻潜点 → 强制开场 whalefall.search');

  // search → found 链：search 的「下沉」选项 triggerEventId=found；found 的「记坐标」选项置 whalefall_found + forceAscend。
  const searchEv = getEventById('whalefall.search')!;
  const descend = searchEv.options.find((o) => o.outcome?.triggerEventId === 'whalefall.found');
  assert(descend, '§3 search 应有选项 triggerEventId=whalefall.found');

  // 声呐选项门控（强制开场事件·没声呐的人不该看到「先打声呐」）：visibleIf hasUpgrade upgrade.sonar.lv1
  // （= sonarUnlocked 的真来源·unlockSonar effect）·不满足→隐藏（hiddenIfFails 缺省=隐藏·同 hasEquipment 装备门先例）。
  const sonarOpt = searchEv.options.find((o) => o.id === 'sonar_ahead')!;
  const vi = sonarOpt.visibleIf;
  assert(vi && vi.kind === 'hasUpgrade' && vi.upgradeId === 'upgrade.sonar.lv1', '§3 sonar_ahead 应 visibleIf hasUpgrade upgrade.sonar.lv1');
  const noSonar: GameState = { ...createInitialGameState(), profile: profileWith([]) };
  const withSonar: GameState = {
    ...createInitialGameState(),
    profile: { ...profileWith([]), unlockedUpgrades: new Set(['upgrade.sonar.lv1']) },
  };
  assert(!isOptionVisible(noSonar, sonarOpt), '§3 无声呐 → sonar_ahead 隐藏（不给没声呐的人「先打声呐」）');
  assert(isOptionVisible(withSonar, sonarOpt), '§3 有声呐 → sonar_ahead 可见');
  // 下沉/先不下去两条路 found 前都不需声呐（found 对无声呐玩家仍可达）。
  assert(searchEv.options.some((o) => o.id === 'descend_toward_it') && searchEv.options.some((o) => o.id === 'turn_back_search'), '§3 search 留有不依赖声呐的到达/退出路径');
  const foundEv = getEventById('whalefall.found')!;
  let foundSet = false;
  for (const opt of foundEv.options) {
    const o = opt.outcome!;
    if ((o.setProfileFlags ?? []).includes(WHALEFALL_FOUND_FLAG)) {
      foundSet = true;
      assert(o.endDive === 'forceAscend', `§3 found 置位选项 ${opt.id} 应 forceAscend（一次性收束）`);
      // 实跑结算一遍，确认 setProfileFlags 真写进 profile.flags
      const res = resolveOption({ ...state, run: dived.run }, opt);
      assert(res.state.profile.flags.has(WHALEFALL_FOUND_FLAG), `§3 resolve found 选项 ${opt.id} → profile 置 whalefall_found`);
      assert(res.next.kind === 'forceAscend', `§3 found 选项 ${opt.id} next=forceAscend`);
    }
  }
  assert(foundSet, '§3 found 事件应有选项置 whalefall_found');
  // 物品即解锁（作者 2026-06-19）：found 两选项都发 item.whalefall_log（鲸落手记·loot→forceAscend 回港并入 profile）。
  for (const opt of foundEv.options) {
    const lootIds = (opt.outcome?.loot ?? []).map((l) => l.itemId);
    assert(
      lootIds.includes('item.whalefall_log'),
      `§3 found 选项 ${opt.id} 应发 item.whalefall_log（鲸落手记·物品即解锁）`,
    );
  }
  L('  search_ready 门 · 强制开场 · search→found 置 whalefall_found + forceAscend + 发鲸落手记 ✓');
}

// ═══════════════════════════════════════════════════════════════
// §4 鲸落生态点：found 门 + 由 flag-gated 区点亮（无营地也亮）
// ═══════════════════════════════════════════════════════════════
L('§4 鲸落生态点（found 门 · flag-gated 区点亮 · reveal ⊥ 营地）');
{
  const ecoIds = ['poi.anchor.whalefall_scavengers', 'poi.anchor.whalefall_enrichment', 'poi.anchor.whalefall_bones'];
  const ecos = ecoIds.map(poiById);
  for (const p of ecos) {
    assert(p.absolute === true, `§4 ${p.id} 应 absolute（owner-less·靠 flag-gated 区点亮）`);
    assert(p.zoneId === 'zone.whalefall', `§4 ${p.id} zoneId=zone.whalefall`);
    assert((p.requiresFlags ?? []).includes(WHALEFALL_FOUND_FLAG), `§4 ${p.id} requiresFlags 含 found`);
    // found 前：不亮（圈未揭示）。
    assert(!isPoiLit(profileWith([TUTORIAL_COMPLETE_FLAG]), p), `§4 ${p.id} found 前不亮`);
    // found 后、且 profile **无任何营地灯塔** → 仍亮（证明由 flag-gated 区点亮·不是营地几何点亮）。
    assert(isPoiLit(profileWith([TUTORIAL_COMPLETE_FLAG, WHALEFALL_FOUND_FLAG]), p), `§4 ${p.id} found 后亮（无营地灯塔·由 flag-gated 区点亮）`);
  }
  // 物品即解锁（作者 2026-06-19·engine/chart.ts::documentKnowsPoi）：持有 item.whalefall_log ⇒ 即便没有
  // found flag 也揭示这 3 个生态点（reveal 来源＝你手里那页坐标·绕发现门）。证明文献是独立的揭示源。
  const holdingLog: PlayerProfile = {
    ...profileWith([TUTORIAL_COMPLETE_FLAG]),
    inventory: [{ itemId: 'item.whalefall_log', qty: 1 }],
  };
  const litByLog = new Set(generateChart({ profile: holdingLog }).pois.map((p) => p.id));
  const noLog = new Set(generateChart({ profile: profileWith([TUTORIAL_COMPLETE_FLAG]) }).pois.map((p) => p.id));
  for (const p of ecos) {
    assert(!noLog.has(p.id), `§4 ${p.id} 无手记无 found → 不在海图（发现门未开）`);
    assert(litByLog.has(p.id), `§4 ${p.id} 持有鲸落手记 → 在海图（物品即解锁·绕 found 发现门）`);
  }
  L('  3 生态点 absolute · found 门 · 无营地也亮（reveal ⊥ 营地）· 持鲸落手记即揭示（物品即解锁）✓');
}

// ═══════════════════════════════════════════════════════════════
// §5 精简营地：found 门 + 无深度柱 + 非区 owner + 补给轨可用
// ═══════════════════════════════════════════════════════════════
L('§5 精简营地（无柱 · 非区 owner · 补给轨 outpostOnly）');
{
  const camp = lhUpgradesRaw.outposts.find((o) => o.id === 'outpost.ch1_whalefall') as Record<string, unknown> | undefined;
  assert(camp, '§5 outpost.ch1_whalefall 应存在');
  assert(camp!.requiresFlag === WHALEFALL_FOUND_FLAG && camp!.discoveredFlag === WHALEFALL_FOUND_FLAG, '§5 营地 requiresFlag + discoveredFlag = whalefall_found');
  assert(Array.isArray(camp!.stages) && (camp!.stages as unknown[]).length === 3, '§5 营地 3 阶（playthrough-outpost §0 要求所有前哨 = OUTPOST_MAX_STAGE）');
  assert(isChapterOutpost(camp as never), '§5 营地 isChapterOutpost（requiresFlag → 章节前哨）');
  const result = camp!.result as { id: string; region?: string };
  assert(result.id === 'lighthouse.ch1_whalefall_outpost', '§5 营地 result.id = lighthouse.ch1_whalefall_outpost');

  // 无深度柱（精简·无探深轨·KEY 不变量）。
  assert(getColumnForLighthouse('lighthouse.ch1_whalefall_outpost') === undefined, '§5 营地灯塔无深度柱（depth_columns 无 col.whalefall·无探深轨）');
  // 非 chart_regions owner（鲸落区仍 flag-gated owner-less·建营地不加第二个圈·reveal ⊥ 营地·#127 纪律）。
  assert(regionForOwner('lighthouse.ch1_whalefall_outpost') === undefined, '§5 营地灯塔非区 owner（鲸落区 flag-gated·建营地不加圈）');

  // 在线补给轨（recharge/oxygen·outpostOnly）：营地是非家/非废墟的前哨灯塔 → 这些轨可用。
  const tracks = (lhUpgradesRaw.tracks ?? []) as Array<{ id: string; outpostOnly?: boolean }>;
  const recharge = tracks.find((t) => t.id === 'lhtrack.recharge');
  const oxy = tracks.find((t) => t.id === 'lhtrack.oxygen_supply');
  assert(recharge?.outpostOnly === true && oxy?.outpostOnly === true, '§5 补给轨 recharge/oxygen_supply 为 outpostOnly（前哨灯塔通用·营地承接补给）');
  L('  found 门 · 3 阶 · 无柱 · 非区 owner · 补给轨 outpostOnly ✓');
}

// ═══════════════════════════════════════════════════════════════
// §6 zone.whalefall + 三相生态事件
// ═══════════════════════════════════════════════════════════════
L('§6 zone.whalefall + 三相生态事件（[whalefall] 池）');
{
  const z = getZone('zone.whalefall');
  assert(z, '§6 zone.whalefall 应注册');
  assert(z!.zoneTagsByDepth.some((s) => s.tags.includes('whalefall' as never)), '§6 zone.whalefall 标 [whalefall] 池');
  const ecoEv = ['whalefall.mobile_scavengers', 'whalefall.enrichment', 'whalefall.chemosynthetic'];
  for (const id of ecoEv) {
    const e = getEventById(id);
    assert(e && e.zoneTags?.includes('whalefall'), `§6 生态事件 ${id} 存在且为 [whalefall] 池`);
  }
  const pool = poolIds('zone.whalefall', 90, [TUTORIAL_COMPLETE_FLAG]);
  assert(ecoEv.every((id) => pool.has(id)), '§6 三相生态事件均在 zone.whalefall depth 90 池');
  L('  zone.whalefall · 3 生态事件入 [whalefall] 池 ✓');
}

// ═══════════════════════════════════════════════════════════════
// §7 物品即里程碑：获得鲸落手记 → setsFlag 解锁鲸落区（作弊 / 任何入袋路径都生效）
// ═══════════════════════════════════════════════════════════════
L('§7 物品即里程碑（item.whalefall_log setsFlag → whalefall_found）');
{
  const base = createInitialGameState();
  assert(!base.profile.flags.has(WHALEFALL_FOUND_FLAG), '§7 前置：初始无 found flag');
  // devGrantItem＝作弊货架发物·走 acquireIntoProfile 统一入口 → 兑现 story.setsFlag。
  const granted = devGrantItem(base, 'item.whalefall_log');
  assert(
    granted.profile.inventory.some((i) => i.itemId === 'item.whalefall_log'),
    '§7 鲸落手记进背包',
  );
  assert(
    granted.profile.flags.has(WHALEFALL_FOUND_FLAG),
    '§7 获得鲸落手记 → setsFlag 置 whalefall_found（解锁鲸落区/营地·等价走完 found·物品即里程碑）',
  );
  L('  作弊发鲸落手记 → 置 whalefall_found（圈/营地随之解锁·§4 §5 据此）✓');
}

console.log(log.join('\n'));
console.log('\n✓ playthrough-whalefall 完成：§1 目击链 / §2 残骸独立 / §3 找寻+found / §4 生态点+物品即解锁 / §5 精简营地 / §6 zone+生态 / §7 setsFlag 里程碑 全部通过');
