// 港口海图（POI 选点）回归脚本
//   1. 发现门控：教学前海图为空；教学后 anchor 出现
//   2. 抵达门控：旧灯塔礁 anchor 可见但需 dockyard.lv1 才可出海
//   3. roaming 刷新：同 runsCompleted → 同组合（确定性）；跨 runsCompleted → 会变
//   4. depthOffset 真改深度：generateDiveMap(+offset) 整图平移；startDiveFromPoi 起始深度更深
//   5. diveModifier 落到 run（距离预耗氧已删·作者 2026-06-14）
//
// 跑法： npx tsx scripts/playthrough-chart.ts

import { readFileSync } from 'node:fs';
import { POST_TUTORIAL_HOME_ANCHORS, POST_LOGBOOK_STORY_BEAT_POI_IDS, POST_TUTORIAL_GATED_ZONES } from './test-fixtures/chart-baseline';
import { createInitialGameState, createNewRun, HOME_LIGHTHOUSE_ID } from '../src/engine/state';
import {
  generateChart,
  chartConditions,
  poiLockReason,
  poiBlockReason,
  poiRevealState,
  isPoiVisible,
  isPoiLit,
  isPoiDepartable,
  effectiveDistance,
  describePoi,
  describeCaveShape,
  roamingInLunarPool,
} from '../src/engine/chart';
import { regionForOwner, regionConfigErrors, regionRadius } from '../src/engine/regions';
import { ownerAnchorPos } from '../src/engine/lighthouses';
import { generateDiveMap, analyzeMap, caveShapeBucket } from '../src/engine/mapgen';
import { startDiveFromPoi, currentMoveCost } from '../src/engine/dive';
import { getZone } from '../src/engine/zones';
import { lunarPhase, moonAge, tideLevel } from '../src/engine/lunar';
import { advanceDays, daysToNextLunarBoundary } from '../src/engine/port';
import type { GameState, PlayerProfile, ChartPoi, RunState, Lighthouse, LunarPhase } from '../src/types';
import { makeHarness, type PtAssert } from './lib/pt';

const pt = makeHarness('海图');
const { L } = pt;
const assert: PtAssert = pt.assert;

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
    // 月相 Phase 0a：海图时间种子＝profile.day（chartSeed·SPEC §3）。等待前 day 与 runsCompleted 同步推进
    // （游戏里 ascent/death 各 +1 两者）——测试构造档也须同步，否则种子恒为初始 day(=0)、roaming 不刷新。
    day: runsCompleted,
  };
}

// 导师日志道具 id（reveal 单一来源·内容自洽回归·#117 续）：marksPois 带四主线 beat 派生 story 潜点坐标。
// 「持日志」＝把它放进 profile.inventory（取代旧「置 coords_known flag」·reveal 机制已改回文献坐标）。
const MENTOR_LOGBOOK_ITEM_ID = 'item.mentor_logbook';
/** 把导师日志塞进 profile.inventory（让 poisKnownFromItems 揭示四主线 beat 坐标）。 */
function withLogbook(profile: PlayerProfile): PlayerProfile {
  return { ...profile, inventory: [...profile.inventory, { itemId: MENTOR_LOGBOOK_ITEM_ID, qty: 1 }] };
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

/**
 * 全区揭示档（区域揭示配置化 SPEC·测试用）：把 home + 四章节前哨 result 灯塔都塞进 lighthouses，
 * 让残骸/中层/热液/海沟区都点亮——等价于剧情全推进 / dev 全解锁，使各区 anchor/roaming 全揭示。
 * 用于测 roaming 多样性 / 区域内 anchor 的下潜机制（不被「教学后只家区」门控挡住）。
 */
function fullyRevealedProfile(runsCompleted = 0): PlayerProfile {
  // 各区靠下面 owner 前哨灯塔揭示（鲸落区 flag-gated vertical 已于 2026-07-12 删除）。
  const base = profileWith(['flag.tutorial_complete'], [], runsCompleted);
  // v4 横向布局坐标（与 data/lighthouse_upgrades.json result + chart_regions owner 一致）。
  const outpostLighthouses: Lighthouse[] = [
    { id: 'lighthouse.ch1_wreck_outpost', name: '残骸前哨', mapX: 0.3, mapY: 0.69, level: 1, builtUpgrades: new Set() },
    { id: 'lighthouse.ch1_midwater_outpost', name: '中层浮标', mapX: 0.5, mapY: 0.52, level: 1, builtUpgrades: new Set() },
    { id: 'lighthouse.ch1_vent_outpost', name: '热液井台', mapX: 0.75, mapY: 0.61, level: 1, builtUpgrades: new Set() },
    { id: 'lighthouse.ch1_trench_outpost', name: '海沟前哨', mapX: 0.93, mapY: 0.5, level: 1, builtUpgrades: new Set() },
  ];
  // 衰减/中转寄存已删（#125·step ②③）：reveal 半径恒定·不再依赖 outpostState（maintainedRun 计时已删）。
  return { ...base, lighthouses: [...base.lighthouses, ...outpostLighthouses] };
}

// ============================================
// 0. 区域配置不变量（regions.ts 加载分类·焊成 regress 门）
//   （原鲸落 flag-gated 揭示区 + mimic 谎点测试随鲸落/mimic vertical 于 2026-07-12 删除。）
// ============================================
L('========== 0. 区域配置不变量 ==========');
{
  // 不变量：每区恰好 owner 或 revealFlag 其一·flag-gated 必带 center（regions.ts 加载分类）。
  assert(regionConfigErrors().length === 0, `区域配置不变量违例：${regionConfigErrors().join('; ')}`);
  L('  区域配置不变量 ✓');
}

// ============================================
// 0b. owner 归属守门 + 坐标 round-trip（owner-anchored 重构·机制门·CLAUDE.md「约定落成机制」）
//   - authored POI 必须有 owner，除非显式 absolute:true（绝对坐标 lane 须手工 opt-in）——挡自动内容生成漏入；
//   - owner 必须是真实 region owner（regionForOwner 命中）——挡 owner 拼写漂移；
//   - resolve 后绝对坐标 == 设计值——挡相对偏移写反符号（坐标值无别处断言覆盖）。
// ============================================
L('\n========== 0b. owner 归属守门 + owner POI 落在 owner radius 内 ==========');
{
  type RawPoi = { id?: string; templateId?: string; owner?: string; absolute?: boolean; mapX?: number; mapY?: number };
  const raw = JSON.parse(
    readFileSync(new URL('../src/data/chart_pois.json', import.meta.url), 'utf-8'),
  ) as Record<string, { anchors?: RawPoi[]; roamingTemplates?: RawPoi[] } | string>;
  // chart_pois 现按 mapId 分段（对齐 chart_regions）——flatten 所有段（跳过 _doc 等字符串）。
  const rawAnchors: RawPoi[] = [];
  const rawRoaming: RawPoi[] = [];
  for (const k of Object.keys(raw)) {
    const seg = raw[k];
    if (typeof seg !== 'object' || seg === null) continue;
    rawAnchors.push(...(seg.anchors ?? []));
    rawRoaming.push(...(seg.roamingTemplates ?? []));
  }
  const authored = [
    ...rawAnchors.map((a) => ({ id: a.id ?? '?', owner: a.owner, absolute: a.absolute, mapX: a.mapX, mapY: a.mapY })),
    ...rawRoaming.map((t) => ({ id: t.templateId ?? '?', owner: t.owner, absolute: t.absolute, mapX: t.mapX, mapY: t.mapY })),
  ];
  for (const p of authored) {
    // (a) owner 必填（除非 absolute:true）——挡自动内容生成漏进绝对坐标 lane。
    assert(
      typeof p.owner === 'string' || p.absolute === true,
      `0b: authored POI「${p.id}」必须有 owner，或显式 absolute:true（绝对坐标 lane opt-in·防自动生成漏入）`,
    );
    if (typeof p.owner !== 'string') continue;
    // (b) owner 须真实 region owner（挡拼写漂移）。
    assert(
      regionForOwner(p.owner) !== undefined,
      `0b: POI「${p.id}」owner=${p.owner} 不是已配置的 region owner（chart_regions.json）`,
    );
    // (c) owner POI 落在 owner radius 内＝该 beacon 的「地盘」：#135 后 radius 不门控点亮、改门控「范围」——
    //     owned POI（及将来 schedule 生成的 POI）须落在 owner 圈内。**拖拽编辑器不失效**（不写死坐标·
    //     只要不拖出圈就绿）；越界＝红（拖回或调大半径）。偏移幅度 = resolve 后距 owner 的距离。
    const offMag = Math.hypot(p.mapX ?? 0, p.mapY ?? 0);
    const r = regionRadius(p.owner);
    assert(
      offMag <= r + 1e-9,
      `0b: POI「${p.id}」距 owner ${offMag.toFixed(3)} > owner radius ${r}（owned POI 须落在 owner 圈内·拖回或调大半径）`,
    );
  }
  L(`  ${authored.length} 个 authored POI：owner 合法 + 落在各自 owner radius 内 ✓`);

  // (c2) 文献坐标守门（物品即解锁·marksPois ⇒ reveal·作者 2026-06-19·CLAUDE.md「约定落成机制」）：
  //   每个 item.story.marksPois 必须命中一个**有效海图点 id**——拼错＝文献静默不揭示＝软锁，焊成 regress 红。
  //   有效 id ＝ ① authored anchor id（chart_pois.json）∪ ② 派生主线柱 story 潜点 id（POST_LOGBOOK_STORY_BEAT_POI_IDS·
  //   = poi.dive.<短名>.story·主线 beat 迁柱后由 buildColumnPois 注入·2026-06-28 内容自洽回归：导师日志恢复带这四条坐标·#117 续）。
  //   导师日志（4 柱 story 潜点）/ 鲸落手记（3 生态点 authored）都过此门。引擎 reveal 路径见 engine/chart.ts::documentKnowsPoi。
  const itemsRaw = JSON.parse(
    readFileSync(new URL('../src/data/items.json', import.meta.url), 'utf-8'),
  ) as { items: Array<{ id: string; story?: { marksPois?: string[] } }> };
  const validMarkIds = new Set<string>([
    ...rawAnchors.map((a) => a.id).filter((x): x is string => typeof x === 'string'),
    ...POST_LOGBOOK_STORY_BEAT_POI_IDS, // 派生主线柱 story 潜点（单一来源·chart-baseline fixture）
  ]);
  let markedRefs = 0;
  for (const it of itemsRaw.items) {
    for (const poiId of it.story?.marksPois ?? []) {
      markedRefs++;
      assert(
        validMarkIds.has(poiId),
        `0b: 道具「${it.id}」marksPois 引用了无效海图点「${poiId}」（须命中 authored anchor 或派生柱 story 潜点 poi.dive.<短名>.story·拼错＝静默不揭示＝软锁）`,
      );
    }
  }
  L(`  文献坐标 marksPois（${markedRefs} 个引用）⊆ authored anchor ids ∪ 派生柱 story 潜点（物品即解锁守门）✓`);

  // (d) resolve 管线正确性（不写死坐标·拖动不失效）：generateChart resolve 出的 owner POI 绝对坐标
  //     必须 == owner 声明坐标(ownerAnchorPos) + 原始偏移（挡 resolveOwnerCoords/ownerAnchorPos 接错·
  //     如误用活灯塔坐标 / 反号 / flatten 丢段）。取边缘点横岩廊（owner=trench·偏移最大轴）做 spot。
  const full = generateChart({ profile: fullyRevealedProfile() });
  const spot = rawAnchors.find((a) => a.id === 'poi.anchor.flat_gallery')!;
  const spotPoi = full.pois.find((p) => p.id === 'poi.anchor.flat_gallery');
  const base = ownerAnchorPos(spot.owner!);
  assert(spotPoi && base, '0b: spot 锚点(横岩廊) + 其 owner 声明坐标应都在');
  assert(
    Math.abs((spotPoi!.mapX ?? NaN) - (base!.mapX + (spot.mapX ?? 0))) < 1e-9 &&
      Math.abs((spotPoi!.mapY ?? NaN) - (base!.mapY + (spot.mapY ?? 0))) < 1e-9,
    `0b: resolve 管线应 == owner 声明坐标 + 偏移（spot=横岩廊·实际 ${spotPoi!.mapX},${spotPoi!.mapY}）`,
  );
  L('  resolve 管线正确性（owner 声明坐标 + 偏移·spot=横岩廊）✓');
}

// ============================================
// 0c. POI 不落陆（陆海分界守门·机制门·CLAUDE.md「约定落成机制」·2026-06-28）
//   不变量：任何潜点（绝对坐标）必须在**家港口以东**（mapX > 港口 mapX）。家港口＝海图最左的人造点 / on-shore
//           基地（state.ts：POI 在港口之东），故「> 港口 mapX」≡「在水里、不在岸上」。
//   （原 (A) depth_columns 显式绝对坐标一路随深度柱系统删除·2026-07-12；现只查 generateChart resolve 后
//    玩家**实际所见**的每个点〔chart_pois 相对偏移 resolve + 4 条主线 beat 静态 anchor〕。）
// ============================================
L('\n========== 0c. POI 不落陆（mapX > 家港口·陆海分界）==========');
{
  const coastEdge = ownerAnchorPos(HOME_LIGHTHOUSE_ID)!.mapX; // 家港口＝on-shore 基地＝陆海分界（海图最左人造点）
  // generateChart resolve 后玩家实际所见的每个点（chart_pois 相对偏移已 resolve 成绝对 + 4 条主线 beat）。
  const seen = generateChart({ profile: withLogbook(fullyRevealedProfile()) }).pois;
  for (const p of seen) {
    if (typeof p.mapX !== 'number') continue;
    assert(
      p.mapX > coastEdge,
      `0c: 海图点「${p.id}」resolve 后 mapX=${p.mapX.toFixed(3)} ≤ 家港口 ${coastEdge}（玩家会看到它落在岸上）`,
    );
  }
  L(`  ${seen.length} 个 resolve 后海图点：均在家港口以东（不落陆）✓`);
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
// 区域揭示配置化 SPEC：教学后只点亮「家·珊瑚区」（home 灯塔覆盖近岸）。
// east_reef / old_lighthouse_reef 在家区内可见；残骸/海沟区的非剧情 anchor 在对应章节前哨建成前为 hidden。
for (const z of ['zone.east_reef', 'zone.old_lighthouse_reef']) {
  assert(c1.pois.some((p) => p.zoneId === z && p.persistent), `教学后家区应含 anchor: ${z}`);
}
// 主线柱迁移：四条主线 beat 改由柱 storyTier 派生（poi.dive.<短名>.story）+ 日志早揭示门（导师日志 marksPois 文献坐标）——
// **未拿日志**（裸 tutorial_complete·inventory 无导师日志）时四条全 hidden（旧 ch1_* chart_pois 锚点已退役·不再恒显）。
for (const id of POST_LOGBOOK_STORY_BEAT_POI_IDS) {
  assert(!c1.pois.some((p) => p.id === id), `教学后未拿日志 → 主线 beat 坐标 hidden（早揭示门未开）: ${id}`);
}
// home anchor（owner=lighthouse.home）：教学后随家区揭示（chart-baseline 单一真相·#171）
for (const { id } of POST_TUTORIAL_HOME_ANCHORS) {
  assert(c1.pois.some((p) => p.id === id), `教学后 home anchor 应随家区揭示: ${id}`);
}
for (const z of POST_TUTORIAL_GATED_ZONES) {
  assert(
    !c1.pois.some((p) => p.zoneId === z && p.persistent && !p.story),
    `教学后 ${z} 区未解锁 → 其非剧情 anchor 应不揭示`,
  );
}
L(`  教学后家区 anchor + 主线 beat 坐标早揭示门（未拿日志 hidden）；残骸区门控 ✓`);

// 日志揭示（2026-07-12 深度柱删除后·reveal 单一来源＝导师日志 marksPois）：持导师日志（inventory 有
// item.mentor_logbook·其 marksPois 带四坐标）后，四条主线 beat 坐标全部揭示为 lit——深度门经济（原 host-built
// 逐环 dim/lit）已删·reveal 不再看 host 灯塔·只看是否持日志（documentKnowsPoi）。beat 潜点带 `story` 字段（dive-start
// applyStoryOpen 据此强制开场）。
{
  const withLog = withLogbook(profileWith(['flag.tutorial_complete']));
  const cLog = generateChart({ profile: withLog });
  const beatPoi = (id: string) => cLog.pois.find((p) => p.id === id);
  const reef = beatPoi('poi.dive.home.story');
  assert(reef && reef.revealState === 'lit', '主线①reef → 持日志即 lit');
  assert(reef!.story?.eventId === 'ch1.anchor_reef', '主线①reef 潜点带 story（dive-start 强制开场 ch1.anchor_reef）');
  for (const id of ['poi.dive.wreck.story', 'poi.dive.midwater.story', 'poi.dive.vent.story']) {
    const p = beatPoi(id);
    assert(p && p.revealState === 'lit', `主线 beat ${id} → 持日志揭示为 lit（host 灯塔不再门 reveal·深度门经济已删）`);
    assert(p!.story?.beatFlag?.startsWith('story.ch1.anchor.'), `主线 beat ${id} 应带 story.beatFlag（story.ch1.anchor.*）`);
  }
  L('  持日志揭示：四条主线 beat 坐标全 lit（reveal 单一来源＝日志 marksPois·host 不门 reveal）✓');
}

// ============================================
// 2. 抵达门控（家灯塔船坞 requiresLighthouseUpgrade）
// ============================================
L('\n========== 2. 抵达门控（家灯塔船坞） ==========');
const lh1 = c1.pois.find((p) => p.zoneId === 'zone.old_lighthouse_reef' && p.persistent)!;
assert(isPoiVisible(postNoUp, lh1), '旧灯塔礁 anchor 教学后应可见（home 点亮）');
assert(poiLockReason(postNoUp, lh1) !== null, '无家灯塔船坞时旧灯塔礁应被锁');
assert(!isPoiDepartable(postNoUp, lh1), '无船坞时旧灯塔礁不可出海');
L(`  旧灯塔礁：可见但锁（${poiLockReason(postNoUp, lh1)}）✓`);

// 区域揭示门控：教学后蓝洞群在海沟区（未解锁）不可出海；东礁在家区·无门→可出海。
const er = c1.pois.find((p) => p.zoneId === 'zone.east_reef' && p.persistent)!;
assert(isPoiDepartable(postNoUp, er), '东礁（家区·无升级门）应可出海');
L('  东礁：家区无门，可出海 ✓');

const postUp = withHomeDockyard(profileWith(['flag.tutorial_complete']));
const c2 = generateChart({ profile: postUp });
const lh2 = c2.pois.find((p) => p.zoneId === 'zone.old_lighthouse_reef' && p.persistent)!;
assert(poiLockReason(postUp, lh2) === null, '建了家灯塔船坞后旧灯塔礁应可出海');
L('  建家灯塔船坞后旧灯塔礁：解锁 ✓');

// ============================================
// 2b. 灯塔 reveal（点亮）+ reach（最近灯塔算距离）
// ============================================
L('\n========== 2b. 灯塔 reveal + reach ==========');
// (a) 无灯塔 + 持日志 → 灯塔 reveal 全灭，海图只剩日志抄来的四条主线 beat 坐标（story anchor 恒显·不被 owner 门控·
//     日志坐标=已知点·灯全灭了抄在纸上的坐标不会消失）。story 锚点恒可达 → 全 lit（深度门经济已删·owner 不门 reveal/reach）。
const noLh: PlayerProfile = { ...withLogbook(profileWith(['flag.tutorial_complete'])), lighthouses: [] };
const noLhPois = generateChart({ profile: noLh }).pois;
assert(
  noLhPois.length === 4 && noLhPois.every((p) => p.story !== undefined),
  `无灯塔+持日志时海图应只剩 4 个主线 beat 坐标（story POI），实际 ${noLhPois.length}`,
);
assert(noLhPois.every((p) => p.revealState === 'lit'), '无灯塔时四条主线坐标全 lit（story 锚点恒可达·不被 owner 门控）');
L('  无灯塔+持日志 → 只剩 4 个日志坐标·全 lit（纸上坐标不灭·story 恒可达）✓');

// (b) home 点亮近端、不点亮远端（北缘 ≈0.80）
const homeOnly = profileWith(['flag.tutorial_complete']);
const nearPoi: ChartPoi = { id: 't.near', zoneId: 'zone.wreck_graveyard', name: '', blurb: '', distance: 1, mapX: 0.3, mapY: 0.5, persistent: false };
const farPoi: ChartPoi = { id: 't.far', zoneId: 'zone.wreck_graveyard', name: '', blurb: '', distance: 2, mapX: 0.85, mapY: 0.64, persistent: false };
assert(isPoiLit(homeOnly, nearPoi), 'home 应点亮近端 (0.3,0.5)（家区半径 0.34 内）');
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

// (d) 锚点从 home 算的 reach 与写死 distance 一致（不破手感）
const anchorReach: [string, number, number, number][] = [
  ['zone.east_reef', 0.18, 0.5, 0],
  ['zone.blue_caves', 0.24, 0.4, 1],  // 蓝洞群（§7 迁 home·offset(0.18,-0.10)+home(0.06,0.5)）
  ['zone.blue_caves', 0.27, 0.43, 1], // 横岩廊（§7 迁 home·offset(0.21,-0.07)+home(0.06,0.5)）
  ['zone.old_lighthouse_reef', 0.44, 0.72, 1],
  ['zone.wreck_graveyard', 0.72, 0.55, 2],
  // St1 一章锚点四点（#117·剧情 SPEC §4.1）
  ['zone.old_lighthouse_reef', 0.17, 0.44, 0], // 漆号珊瑚丛
  ['zone.wreck_graveyard', 0.62, 0.64, 2], // 温带商船残骸
  ['zone.open_midwater', 0.78, 0.38, 2], // 远洋中层
  ['zone.vent_trench', 0.9, 0.78, 3], // 海沟热液场
];
for (const [zone, x, y, want] of anchorReach) {
  const p: ChartPoi = { id: 'a', zoneId: zone, name: '', blurb: '', distance: want, mapX: x, mapY: y, persistent: true };
  const got = effectiveDistance(homeOnly, p);
  assert(got === want, `${zone} 从 home 的 reach 应=${want}（手感不破），实际 ${got}`);
}
L('  9 锚点 home reach = 写死 distance（0/1/1/1/2 + 0/2/2/3，手感不破）✓');

// ============================================
// 3. roaming 刷新（runsCompleted 种子）
// ============================================
L('\n========== 3. roaming 刷新 ==========');
const rA = generateChart({ profile: fullyRevealedProfile(3) });
const rB = generateChart({ profile: fullyRevealedProfile(3) });
const roamA = rA.pois.filter((p) => !p.persistent).map((p) => p.name).join('|');
const roamB = rB.pois.filter((p) => !p.persistent).map((p) => p.name).join('|');
assert(roamA === roamB, `同 runsCompleted 的 roaming 应一致：${roamA} vs ${roamB}`);
// 机会点数随海况：晴/雾 2、浓雾遮一处 → 1（§6.5）。从 chartConditions 派生期望值＝seed 无关、robust。
const cond3 = chartConditions(fullyRevealedProfile(3));
// 排除潮窗点（lunarWindow·#219 起恒显·非随机机会点·不占 ROAMING_COUNT 槽）；本断言只数随机机会点。
const roam3 = rA.pois.filter((p) => !p.persistent && !(p.lunarWindow && p.lunarWindow.length > 0));
// 机会点 ≤ ROAMING_COUNT(2)；非浓雾＝两个全显；浓雾按 per-poi 概率遮掉一部分（§6.5·不强求恰好遮 1 个）。
assert(roam3.length <= 2, `roaming 数应 ≤2（实际 ${roam3.length}·天气 ${cond3.weather}）`);
if (cond3.weather !== 'fog') {
  assert(roam3.length === 2, `非浓雾应满 2 个机会点（实际 ${roam3.length}·天气 ${cond3.weather}）`);
}
L(`  runsCompleted=3 → roaming: ${roamA}（确定性 ✓·天气 ${cond3.weather}）`);

const variants = new Set<string>();
for (let r = 0; r < 8; r++) {
  const c = generateChart({ profile: fullyRevealedProfile(r) });
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
// 5. startDiveFromPoi：diveModifier 落 run + 深点更深（距离预耗氧已删·作者 2026-06-14）
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
// 作者 2026-06-14：删掉「出海更近」/距离预耗氧——每个潜点都从第一回合起算（满氧起手 / turn 0）。
assert(st.run!.stats.oxygen === baseOxygen, `起手满氧（不再预耗氧）：${baseOxygen} → ${st.run!.stats.oxygen}`);
assert(st.run!.turn === 0, `turn 应=0（从第一回合起算），实际 ${st.run!.turn}`);
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
// 区域揭示门控：横岩廊/蓝洞群已迁 owner=lighthouse.home（§7·cave-chart）——家区教学后即揭示。用全区揭示档验其他 POI。
const revealedProfile = withHomeDockyard(fullyRevealedProfile());
const chartG = generateChart({ profile: revealedProfile });
const galleryPoi = chartG.pois.find((p) => p.id === 'poi.anchor.flat_gallery');
assert(galleryPoi, '横岩廊 anchor 应在海图上（home 区·教学后即揭示）');
let gs: GameState = { ...createInitialGameState(), profile: revealedProfile };
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
// 6. current 实际效果
// ============================================
L('\n========== 6. current 实际效果 ==========');

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
// 全区揭示档（12 锚点全在范围内·含鲸落 found 后的 3 个生态点·#137）→ 才能验「天气不遮锚点」（区域门控≠天气遮蔽，两轴分开）。
const fogChart = generateChart({ profile: fullyRevealedProfile(fogRun) });
const calmChart = generateChart({ profile: fullyRevealedProfile(calmRun) });
// 排除潮窗点（lunarWindow·#219 起恒显·非随机机会点）；本断言只数随机机会点。
const fogRoam = fogChart.pois.filter((p) => !p.persistent && !(p.lunarWindow && p.lunarWindow.length > 0)).length;
const calmRoam = calmChart.pois.filter((p) => !p.persistent && !(p.lunarWindow && p.lunarWindow.length > 0)).length;
// 非浓雾＝两个机会点全显；浓雾按 per-poi 概率遮一部分（≤2·不强求恰好遮 1·见 §3 robust 同理）。
assert(calmRoam === 2, `7: 非浓雾应满 2 个机会点（实际 ${calmRoam}）`);
assert(fogRoam <= 2, `7: 浓雾机会点 ≤2（实际 ${fogRoam}）`);
// zone 锚点计数（fullyRevealed·无导师日志 → 四条 story 潜点未揭示·不计入）。
const anchorCount = (c: { pois: { persistent: boolean }[] }) => c.pois.filter((p) => p.persistent).length;
// 16 = 旧 19（含鲸落 3 生态点）− 3 鲸落生态点（鲸落 vertical 于 2026-07-12 删除）。story 潜点因无日志未揭示·亦不计。
assert(
  anchorCount(fogChart) === 16 && anchorCount(calmChart) === 16,
  `7: 锚点不受天气遮蔽（期望 16·实际 fog ${anchorCount(fogChart)}/calm ${anchorCount(calmChart)}·鲸落 vertical 已删）`,
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
  generateChart({ profile: p }).pois.filter((x) => !x.persistent).map((x) => x.id);
const ids1 = roamIds(homeOutpost);
const ids2 = roamIds(homeOutpost);
assert(ids1.join('|') === ids2.join('|'), '8b: 同 profile 重算 roaming 一致（确定性·pool-independent）');
assert(
  ids1.every((id) => /^poi\.roam\.\d+\.[a-z_.]+$/.test(id)),
  `8b: roaming id 应为模板键 poi.roam.<run>.<templateId>（稳定·不重洗），实际 ${ids1.join(',')}`,
);
L(`  远端 roaming 即时点亮(run ${clearRun}) + roaming 模板键 id 确定性(${ids1.length} 个) ✓`);

// （§9 探深「深度柱」→ 深入潜点〔档位制/bandId 路径〕随深度柱系统删除·2026-07-12 移除。）

// ============================================
// 10. poiBlockReason（暗点「怎样才能去」一句话·作者 2026-06-14）：可去→null；能力门→「需要『X』」。
//     合约见 chart.ts::poiBlockReason（深度柱档「升一级」/ 能力门「需要」/ 天气「潮一变又不同」）。
// ============================================
L('\n========== 10. poiBlockReason（暗点一句话）==========');
// (a) 能力门暗点（capability-dim）：近家 owner-less 几何点（home 圈内·reveal 通过 → 已发现），叠
//     requiresLighthouseUpgrade 未建船坞 → 落在「可去圈内、已发现、但缺设施」一类 → revealState=dim、
//     poiBlockReason 含「需要」。（原用 story POI 恒亮的写法已失效：story reveal 现须 documentKnowsPoi/marksPois·
//     未被任何文献标记的 story 点是 hidden·不再恒亮·2026-07-12。）
const capDimPoi: ChartPoi = {
  id: 'probe.cap_dim',
  zoneId: 'zone.old_lighthouse_reef',
  name: '需船坞的近家点',
  blurb: '',
  distance: 1,
  mapX: 0.18,
  mapY: 0.5, // 近家·home 圈内点亮（reveal 通过）→ 只差设施 → 能验「能力门」而非「圈外」
  persistent: true,
  requiresLighthouseUpgrade: 'lighthouse.dockyard.lv1',
};
const noDock = profileWith(['flag.tutorial_complete']); // 教学已过·未建船坞
assert(poiRevealState(noDock, capDimPoi) === 'dim', '10a: 能力门未解（未建船坞）的近家点应为 dim（reveal 通过·只差设施）');
const capReason = poiBlockReason(noDock, capDimPoi);
assert(capReason !== null && capReason.includes('需要'), `10a: 能力门暗点 poiBlockReason 应含「需要」，实际 ${capReason}`);
assert(capReason === poiLockReason(noDock, capDimPoi), '10a: 能力门暗点 blockReason 应与 poiLockReason 同源（一句话一致）');
L(`  能力门暗点：dim + 「${capReason}」✓`);

// (b) 可去点（departable）：近家几何点 + 无任何能力门 → revealState=lit → poiBlockReason 返回 null。
const litPoi: ChartPoi = {
  id: 'probe.lit',
  zoneId: 'zone.old_lighthouse_reef',
  name: '无门近家点',
  blurb: '',
  distance: 1,
  mapX: 0.18,
  mapY: 0.5, // 近家·home 圈内·无 requiresUpgrade/requiresLighthouseUpgrade → 可去
  persistent: true,
};
assert(poiRevealState(noDock, litPoi) === 'lit', '10b: 无能力门的近家点应为 lit（可去）');
assert(poiBlockReason(noDock, litPoi) === null, '10b: 可去点 poiBlockReason 应返回 null（没什么挡着）');
L('  可去点：lit + blockReason=null ✓');

// ============================================
// 11. 月相潮汐（SPEC §3/§4/§6）：海况派生自 day · 港口等待推进 day（不计 run）· 月相窗门 + 情报降级。
// ============================================
L('\n========== 11. 月相潮汐（day 派生海况 / 港口等待 / 月相窗门）==========');
// 11a：chartConditions 的 phase/moonAge/tide 由 day 派生、与 lunar.ts 一致（取代旧 condHash tide）。
for (const N of [0, 5, 7, 14, 21, 28, 35]) {
  const c = chartConditions({ ...fullyRevealedProfile(0), day: N });
  assert(c.phase === lunarPhase(N), `11a: day=${N} → phase=${lunarPhase(N)}，实 ${c.phase}`);
  assert(c.moonAge === moonAge(N), `11a: day=${N} → moonAge=${moonAge(N)}，实 ${c.moonAge}`);
  const expTide = tideLevel(N) > 0 ? 'flood' : 'ebb';
  assert(c.tide === expTide, `11a: day=${N} → tide=${expTide}（tideLevel 符号派生），实 ${c.tide}`);
}
L('  海况(phase/moonAge/tide)由 day 派生·与 lunar.ts 一致 ✓');

// 11b：港口等待 advanceDays「等到下一相位」——推进 day、不计 run、相位推进；出海中/n≤0 不动。
{
  const base = createInitialGameState();
  const portState: GameState = {
    ...base,
    run: null,
    profile: { ...base.profile, flags: new Set(['flag.tutorial_complete']), day: 3, runsCompleted: 3 },
  };
  const waitN = daysToNextLunarBoundary(portState.profile); // day3=新月段·还 4 天到上弦
  const waited = advanceDays(portState, waitN);
  assert(waited.profile.day === 3 + waitN, `11b: 等待推进 day=${3 + waitN}，实 ${waited.profile.day}`);
  assert(waited.profile.runsCompleted === 3, '11b: 等待不计一次 run（runsCompleted 不变·day 与 run 解耦）');
  assert(
    waitN > 0 && lunarPhase(waited.profile.day) !== lunarPhase(3),
    `11b: 「等到下一相位」跨过相位边界（${lunarPhase(3)}→${lunarPhase(waited.profile.day)}）`,
  );
  assert(advanceDays(portState, 0).profile.day === 3, '11b: n≤0 不推进');
  const inRun: GameState = { ...portState, run: createNewRun({ zoneId: 'zone.old_lighthouse_reef' }) };
  assert(advanceDays(inRun, 5).profile.day === 3, '11b: 出海中（有 run）不可等待·day 不变');
  L(`  等到下一相位：day 3→${waited.profile.day}（${lunarPhase(3)}→${lunarPhase(waited.profile.day)}）·runsCompleted 不变·出海中守卫 ✓`);
}

// 11c：月相窗门 + 情报降级（§4/§5）。非豁免点带 lunarWindow：已知（intelFlag）窗外→dim+「潮窗未到」；窗内→月相不拦；story 豁免。
{
  const lunarPoi: ChartPoi = {
    id: 'probe.lunar', zoneId: 'zone.wreck_graveyard', name: '潮窗点', blurb: '', distance: 2,
    mapX: 0.85, mapY: 0.64, persistent: false, lunarWindow: ['full'], intelFlag: 'intel.lunar_test',
  };
  const offProf = { ...profileWith(['flag.tutorial_complete', 'intel.lunar_test']), day: 0 }; // 新月·窗外
  assert(poiRevealState(offProf, lunarPoi) === 'dim', '11c: 已知(intelFlag) + 窗外 → dim（可规划·不 hidden）');
  const lr = poiBlockReason(offProf, lunarPoi);
  assert(lr !== null && lr.includes('潮窗未到') && lr.includes('满月'), `11c: 窗外暗点提示含「潮窗未到/满月」，实 ${lr}`);
  const onProf = { ...profileWith(['flag.tutorial_complete', 'intel.lunar_test']), day: 14 }; // 满月·窗内
  const lrOn = poiBlockReason(onProf, lunarPoi);
  assert(lrOn === null || !lrOn.includes('潮窗未到'), `11c: 窗内 → 月相不再拦（blockReason 无「潮窗未到」），实 ${lrOn}`);
  // 豁免：同样的窗挂在 story 锚点上 → 月相不拦（守「默认不锁主线」§2.3/§7）。
  const storyPoi: ChartPoi = { ...lunarPoi, id: 'probe.lunar_story', story: { eventId: 'test.x', beatFlag: 'story.ch1.anchor.wreck' } };
  const lrStory = poiBlockReason(offProf, storyPoi);
  assert(lrStory === null || !lrStory.includes('潮窗未到'), '11c: story 豁免——月相窗不拦剧情锚点');
  L('  月相窗门：已知窗外 dim+「潮窗未到·满月」/ 窗内放行 / story 豁免 ✓');
}

// ============================================
// 12. 月相 roaming 选取池 + 情报降级（SPEC §4/§5·roamingInLunarPool + 东礁退潮浅滩内容）：
//     窗内入 / 窗外秘密未知消失 / 窗外已知(intel)留→dim / 窗外 dim 默认留。Aldo 情报 flag = intel.aldo.lunar_tides。
// ============================================
L('\n========== 12. 月相 roaming 选取池（窗门 + 情报降级）==========');
{
  const TIDE_FLAG = 'intel.aldo.lunar_tides';
  const at = (day: number, extra: string[] = []): PlayerProfile => ({
    ...fullyRevealedProfile(0),
    day,
    flags: new Set(['flag.tutorial_complete', ...extra]),
  });
  const secret = { lunarWindow: ['new'] as LunarPhase[], lunarOffWindow: 'hidden' as const, intelFlag: TIDE_FLAG };
  const openPt = { lunarWindow: ['new'] as LunarPhase[] }; // lunarOffWindow 缺省 = dim
  // 纯函数（无选取干扰）：
  assert(roamingInLunarPool({}, at(14)) === true, '12: 无窗模板恒入池');
  assert(roamingInLunarPool(secret, at(0)) === true, '12: 窗内（day0=new）入池');
  assert(roamingInLunarPool(secret, at(14)) === false, '12: 窗外（day14=full）+秘密+未知 → 不入池（消失·不占槽）');
  assert(roamingInLunarPool(secret, at(14, [TIDE_FLAG])) === true, '12: 窗外+已知(intel) → 留池（poiRevealState 落 dim）');
  assert(roamingInLunarPool(openPt, at(14)) === true, '12: 窗外+lunarOffWindow 默认 dim → 留池');
  L('  纯函数：无窗恒入 / 窗内入 / 窗外秘密未知消失 / 窗外已知或 dim 留池 ✓');
  // 端到端（东礁退潮浅滩·lunarWindow=[new]·hidden·intelFlag=潮汐情报）：
  const fullNoIntel = generateChart({ profile: at(14) }); // 满月·无情报 → 秘密窗外·必消失（与选取无关）
  assert(
    !fullNoIntel.pois.some((p) => p.templateId === 'roam.east_ebb_shallows'),
    '12: 满月（无 Aldo 情报）→ 东礁退潮浅滩消失（秘密窗外·绝对不入池）',
  );
  const newMoon = generateChart({ profile: at(0) }); // 新月 → 窗内·若入选应 lit
  const ebbNew = newMoon.pois.find((p) => p.templateId === 'roam.east_ebb_shallows');
  if (ebbNew) assert(ebbNew.revealState === 'lit', `12: 新月东礁退潮浅滩入选应 lit，实 ${ebbNew.revealState}`);
  const fullIntel = generateChart({ profile: at(14, [TIDE_FLAG]) }); // 满月+情报 → 留池·若入选应 dim
  const ebbDim = fullIntel.pois.find((p) => p.templateId === 'roam.east_ebb_shallows');
  if (ebbDim) assert(ebbDim.revealState === 'dim', `12: 满月+情报东礁退潮浅滩入选应 dim，实 ${ebbDim.revealState}`);
  L('  东礁退潮浅滩：满月无情报→消失 / 新月→lit / 满月+Aldo情报→dim（可规划「等到新月」）✓');
}

pt.done();
