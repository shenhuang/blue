// 探深「深度柱」引擎（#131）—— 纯查询/派生层（无 UI / fs / console），是 src/data/depth_columns.json
// 的消费点。设计见 src/types/columns.ts。一根柱 = 单一数据来源，本文件把它派生成三样别处现成机制能吃的东西：
//   ① columnBands()        → 每 tier 一个 DepthBand（bands.ts 合并进注册表·getBand/dive 路径零改消费）；
//   ② columnProbeTracks()  → 每柱一条 LighthouseTrack（lighthouses.ts 合并进 TRACKS·onlyLighthouse=宿主·
//                            canBuildAt/buildAtLighthouse/设施面板零改消费·各级 cost=该 tier 账单·effects 空＝纯门控）；
//   ③ buildColumnPois()    → 海图深入 POI（chart.ts generateChart 注入·revealState 由 columnBuiltLevel vs tier 派生）。
//
// **依赖方向（守 check-boundaries·无环）**：columns.ts 只 import 类型 + depth_columns.json + 两个**纯叶子**引擎
//   模块（story.ts 取 TUTORIAL_COMPLETE_FLAG 常量、items.ts 取 poisKnownFromItems——两者皆只 import 类型/JSON·
//   绝不反向 import columns.ts·无环）；bands.ts / lighthouses.ts / chart.ts / dive-start.ts 单向 import 本文件。
//   columnBuiltLevel 直接读 profile.lighthouses（不 import lighthouses.ts·避免与其反向依赖成环）。
//   **主线 beat reveal 的单一来源＝「日志文献坐标」**（poisKnownFromItems·marksPois ⇒ reveal·#117 续）：
//   storyTier 不再带裸 revealFlag——「知道这条坐标」唯一真相＝玩家手里有没有写着它的那张纸（导师日志）。

import type {
  DepthColumn,
  DepthColumnsFile,
  DepthColumnTier,
  ColumnStoryTier,
  DepthBand,
  LighthouseTrack,
  LighthouseUpgradeDef,
  PlayerProfile,
  ChartPoi,
  PoiRevealState,
} from '@/types';
import columnsData from '@/data/depth_columns.json';
import { TUTORIAL_COMPLETE_FLAG } from './story';
import { poisKnownFromItems } from './items';

// 家灯塔 id（本地常量·避免 import state.ts 成依赖环——columns.ts 是叶子·只读 profile.lighthouses）。
// 与 state.ts::HOME_LIGHTHOUSE_ID / data 字面量一致（check-dive-refs lighthouseIds 含它）。
const HOME_LIGHTHOUSE_ID = 'lighthouse.home';

const file = columnsData as unknown as DepthColumnsFile;
const COLUMNS: DepthColumn[] = file.columns ?? [];
const COLUMN_INDEX = new Map<string, DepthColumn>(COLUMNS.map((c) => [c.id, c]));
const COLUMN_BY_LIGHTHOUSE = new Map<string, DepthColumn>(COLUMNS.map((c) => [c.lighthouseId, c]));

export function getColumns(): DepthColumn[] {
  return COLUMNS;
}

export function getColumn(id: string): DepthColumn | undefined {
  return COLUMN_INDEX.get(id);
}

/** 某座灯塔的深度柱（无 → undefined）。一柱一灯塔（check-dive-refs 守 lighthouseId 唯一）。 */
export function getColumnForLighthouse(lighthouseId: string): DepthColumn | undefined {
  return COLUMN_BY_LIGHTHOUSE.get(lighthouseId);
}

/** 柱短名（`col.trench` → `trench`）——派生 band / probe 升级 / 深入 POI 的 id 前缀。 */
export function columnShort(columnId: string): string {
  return columnId.replace(/^col\./, '');
}

/** 派生 band id：`band.<短名>.t<tier>`（与 depth_bands.json 既有 id 不撞·check-dive-refs 守）。 */
export function columnTierBandId(columnId: string, tier: number): string {
  return `band.${columnShort(columnId)}.t${tier}`;
}

/** 派生 probe 升级 id：`lighthouse.probe.<短名>.lv<tier>`（落 lighthouse.builtUpgrades）。 */
export function columnProbeUpgradeId(columnId: string, tier: number): string {
  return `lighthouse.probe.${columnShort(columnId)}.lv${tier}`;
}

/** 派生 probe 升级轨 id：`lhtrack.probe.<短名>`。 */
export function columnProbeTrackId(columnId: string): string {
  return `lhtrack.probe.${columnShort(columnId)}`;
}

/** 海图深入 POI id：`poi.dive.<短名>.t<tier>`。 */
export function columnDivePoiId(columnId: string, tier: number): string {
  return `poi.dive.${columnShort(columnId)}.t${tier}`;
}

/** 主线 story beat 的派生 band id：`band.<短名>.story`（不与刷怪档 band.<短名>.t<n> 撞·主线柱迁移）。 */
export function columnStoryBandId(columnId: string): string {
  return `band.${columnShort(columnId)}.story`;
}

/** 主线 story beat 的海图潜点 id：`poi.dive.<短名>.story`（不与刷怪档 poi.dive.<短名>.t<n> 撞）。 */
export function columnStoryDivePoiId(columnId: string): string {
  return `poi.dive.${columnShort(columnId)}.story`;
}

/** 一个 tier → 一个 DepthBand（绝对 depthRange 覆盖 zone·order 取顶深以便全局按深度排序）。 */
function tierBand(c: DepthColumn, t: DepthColumnTier): DepthBand {
  return {
    id: columnTierBandId(c.id, t.tier),
    name: t.label,
    zoneId: c.zoneId,
    depthRange: t.depthRange,
    order: t.depthRange[0],
    visibility: t.visibility,
    current: t.current,
    blurb: t.blurb ?? c.blurb ?? `${c.name}·第 ${t.tier} 级（${t.depthRange[0]}–${t.depthRange[1]}m）。`,
    danger: t.danger,
    alertFactor: t.alertFactor,
    lootFactor: t.lootFactor,
    tags: t.tags,
    maxRoomFeatures: t.maxRoomFeatures,
    sonarDeception: t.sonarDeception,
    hunts: t.hunts,
  };
}

/** 主线 story beat → 一个 DepthBand（主线柱迁移·与刷怪 band 同形·落 beat 原深度·不带 hunts/sonarDeception 等刷怪旋钮）。 */
function storyTierBand(c: DepthColumn, s: ColumnStoryTier): DepthBand {
  return {
    id: columnStoryBandId(c.id),
    name: s.label,
    zoneId: c.zoneId,
    depthRange: s.depthRange,
    order: s.depthRange[0],
    visibility: s.visibility,
    current: s.current,
    blurb: s.blurb ?? c.blurb ?? `${c.name}·${s.label}（${s.depthRange[0]}–${s.depthRange[1]}m）。`,
    danger: s.danger,
  };
}

/** 全部柱的派生 band（bands.ts 合并进注册表）——刷怪档 + 主线 story beat（如有·主线柱迁移）。 */
export function columnBands(): DepthBand[] {
  return COLUMNS.flatMap((c) => [
    ...c.tiers.map((t) => tierBand(c, t)),
    ...(c.storyTier ? [storyTierBand(c, c.storyTier)] : []),
  ]);
}

/** 一根柱的派生 probe 升级轨（lighthouses.ts 合并进 TRACKS）。 */
function columnTrack(c: DepthColumn): LighthouseTrack {
  const upgrades: LighthouseUpgradeDef[] = c.tiers.map((t) => ({
    id: columnProbeUpgradeId(c.id, t.tier),
    level: t.tier,
    name: `低频声呐 Lv.${t.tier}·${t.label}`,
    cost: t.cost,
    // 低频声呐是**纯门控**：没有被动加成（可见性靠 columnBuiltLevel vs tier 派生·不靠 effects）。
    effects: [],
    description: t.capstone
      ? (t.capstoneNote ??
          `探针到 ~${t.depthRange[1]}m。唯一找到的落脚处是「${t.label}」入口——再往下什么样，只有亲自去才知道。`)
      : `「${t.label}」（${t.depthRange[0]}–${t.depthRange[1]}m）的航路已经打通。声呐还能探到再往下一截——但那里暂时还落不了脚。`,
    requiresLighthouseLevel: 1,
    // capstone（科考站电梯）建成置 flag → 揭示 flag-gated 区（#124）；普通档无 setsFlag（纯门控·可见性靠档位派生）。
    ...(t.setsFlag ? { setsFlag: t.setsFlag } : {}),
    // capstone 产出关键道具（热液核心→海沟电梯跨柱硬依赖·types/columns.ts::grantsItem）：透传给 buildAtLighthouse。
    ...(t.grantsItem ? { grantsItem: t.grantsItem } : {}),
  }));
  return {
    id: columnProbeTrackId(c.id),
    name: '低频声呐',
    description: `低频脉冲打得深，回波慢但远。每升一级，往下多开一段路。`,
    onlyLighthouse: c.lighthouseId,
    upgrades,
  };
}

/** 全部柱的派生 probe 升级轨。 */
export function columnProbeTracks(): LighthouseTrack[] {
  return COLUMNS.map(columnTrack);
}

/**
 * 某柱已建到的低频声呐级数（0 = 没建过）。读宿主灯塔 builtUpgrades 里本柱派生 probe 升级、取最高 tier。
 * （probe 升级 canBuildAt 强制同轨连建，故最高 tier ＝ 连续建到的级数。）
 */
export function columnBuiltLevel(profile: PlayerProfile, columnId: string): number {
  const c = COLUMN_INDEX.get(columnId);
  if (!c) return 0;
  const lh = profile.lighthouses.find((l) => l.id === c.lighthouseId);
  if (!lh) return 0;
  let lv = 0;
  for (const t of c.tiers) {
    if (lh.builtUpgrades.has(columnProbeUpgradeId(columnId, t.tier))) lv = Math.max(lv, t.tier);
  }
  return lv;
}

/**
 * 档位可见性（核心规则·#131）：建到第 builtLevel 级时，第 tier 档的揭示态——
 *   tier ≤ builtLevel      → lit（可下潜）
 *   tier == builtLevel + 1 → dim（暗点·看得到去不了·「再升一级低频声呐」）
 *   else                   → hidden（更深·尚不可见）
 */
export function depthTierRevealState(builtLevel: number, tier: number): PoiRevealState {
  if (tier <= builtLevel) return 'lit';
  if (tier === builtLevel + 1) return 'dim';
  return 'hidden';
}

/**
 * 主线 story beat 的揭示态（主线柱迁移·点 4·**不走** depthTierRevealState 探深档位制——主线 beat 是链式
 * build-gate，与刷怪探深无关）：
 *   日志未标记此坐标（!hasReveal）     → hidden（不知道这条坐标·导师日志没带到）
 *   日志已标记 且 host 未建（dim）       → dim  （日志早揭示·看得到去不了·blockReason「需先建〈host〉」）
 *   host 已建                          → lit  （建好该区前哨·下得去）
 * **reveal 单一来源＝文献坐标**（hasReveal 由调用方从 poisKnownFromItems(profile) 派生·导师日志 marksPois ⇒
 * 知道这条坐标·#117 续）；**reach 单一来源＝host 灯塔建成**（build-gate·marksPois 不绕 reach·dim 点出不了海）。
 * reef host=lighthouse.home 恒在（开局即「host 已建」）⇒ 持日志即 lit＝免费入口（教学完即可下）。
 * 纯函数（hostBuilt/hasReveal 由调用方从 profile 派生）。
 */
export function storyTierRevealState(hasReveal: boolean, hostBuilt: boolean): PoiRevealState {
  if (!hasReveal) return 'hidden';
  return hostBuilt ? 'lit' : 'dim';
}

/**
 * 一个 tier → 一个海图深入 POI（摆宿主灯塔揭示圈内·按 tier 往深处扇开·占位坐标作者调手感）。
 * 坐标钳到 [0.03,0.97] 防出界；bandId/columnId/depthTier 让 startDiveFromPoi 走 band 路径 +
 * poiRevealState/poiBlockReason 走档位分支。
 */
function tierPoi(c: DepthColumn, t: DepthColumnTier, hostX: number, hostY: number): ChartPoi {
  const clamp = (v: number) => Math.max(0.03, Math.min(0.97, v));
  const dx = 0.018 + ((t.tier - 1) % 2) * 0.02;
  const dy = 0.028 + (t.tier - 1) * 0.022;
  return {
    id: columnDivePoiId(c.id, t.tier),
    zoneId: c.zoneId,
    name: t.label,
    blurb: t.blurb ?? c.blurb ?? `${c.name}·第 ${t.tier} 级（${t.depthRange[0]}–${t.depthRange[1]}m）。`,
    distance: t.tier,
    // 显式坐标（t.mapX/Y）覆盖自动扇形布点——capstone（电梯）摆到独立位置·脱离本柱密集簇（#131 续·作者反馈）。
    mapX: clamp(t.mapX ?? hostX + dx),
    mapY: clamp(t.mapY ?? hostY + dy),
    bandId: columnTierBandId(c.id, t.tier),
    columnId: c.id,
    depthTier: t.tier,
    persistent: true,
  };
}

/** 是否「host 灯塔已建」（在 profile.lighthouses 里）——主线 story beat 的 reach 门（链式 build-gate）。 */
export function columnHostBuilt(profile: PlayerProfile, columnId: string): boolean {
  const c = COLUMN_INDEX.get(columnId);
  if (!c) return false;
  return profile.lighthouses.some((l) => l.id === c.lighthouseId);
}

/**
 * 主线 story beat → 海图潜点（主线柱迁移）。带 columnStory（dive-start 入潜强制开场）+ bandId（走 story band 绝对
 * depthRange 下潜路径）+ columnId（startDiveFromPoi 并入宿主灯塔补给设施·与刷怪档同源）。**不带 depthTier**
 * ⇒ 不触发 poiRevealState 的探深档位制分支（columnId+depthTier 才触发）；reveal 改由 storyPoiRevealState
 * （columnStory 分支·host 建成 + 日志 marksPois 文献坐标早揭示）算·见 chart.ts。坐标缺省摆 host 旁（host
 * 未建时退家灯塔旁·让早揭示 dim 点有处可摆）。
 */
function storyTierPoi(c: DepthColumn, s: ColumnStoryTier, hostX: number, hostY: number): ChartPoi {
  const clamp = (v: number) => Math.max(0.03, Math.min(0.97, v));
  return {
    id: columnStoryDivePoiId(c.id),
    zoneId: c.zoneId,
    name: s.label,
    blurb: s.blurb ?? c.blurb ?? `${c.name}·${s.label}（${s.depthRange[0]}–${s.depthRange[1]}m）。`,
    distance: 1,
    mapX: clamp(s.mapX ?? hostX + 0.018),
    mapY: clamp(s.mapY ?? hostY - 0.03),
    bandId: columnStoryBandId(c.id),
    columnId: c.id,
    persistent: true,
    columnStory: {
      eventId: s.eventId,
      beatFlag: s.beatFlag,
      ...(s.chainTail ? { chainTail: true } : {}),
      ...(s.revisitEventId ? { revisitEventId: s.revisitEventId } : {}),
      ...(s.revisitRequiresFlag ? { revisitRequiresFlag: s.revisitRequiresFlag } : {}),
      ...(s.revisitDoneFlag ? { revisitDoneFlag: s.revisitDoneFlag } : {}),
    },
  };
}

/**
 * 主线 story 潜点的揭示态（chart.ts poiRevealState 的 columnStory 分支调）：从 profile 派生 hasReveal（**日志文献坐标**
 * 标记了本柱 story 潜点·poisKnownFromItems）+ hostBuilt（host 灯塔在册）→ storyTierRevealState。
 * reveal 单一来源＝marksPois（导师日志带这四条坐标·#117 续·与「物品即解锁」同径·不再裸 revealFlag）；
 * reach 单一来源＝host 建成（build-gate·见 columnHostBuilt）。派生 story 潜点 id＝columnStoryDivePoiId(columnId)。
 */
export function storyPoiRevealState(profile: PlayerProfile, columnId: string): PoiRevealState {
  const c = COLUMN_INDEX.get(columnId);
  if (!c || !c.storyTier) return 'hidden';
  const hasReveal = poisKnownFromItems(profile).has(columnStoryDivePoiId(columnId));
  return storyTierRevealState(hasReveal, columnHostBuilt(profile, columnId));
}

/**
 * 全部「可见」（lit/dim·非 hidden）的深度柱深入 POI（chart.ts generateChart 注入）。
 * 宿主灯塔未建（不在 profile.lighthouses）→ 该柱潜点不现（柱挂在灯塔上·灯塔在才有柱）。
 * 每个返回的 POI 已带 revealState。
 */
export function buildColumnPois(profile: PlayerProfile): ChartPoi[] {
  const out: ChartPoi[] = [];
  // 教学前海图为空（与所有 anchor/roaming 同门·flag.tutorial_complete）——家灯塔从开局就在，
  // 但教学没过不该有任何潜点；故柱潜点也统一压在教学门后（守 playthrough-chart「教学前海图应为空」）。
  if (!profile.flags.has(TUTORIAL_COMPLETE_FLAG)) return out;
  const homeLh = profile.lighthouses.find((l) => l.id === HOME_LIGHTHOUSE_ID);
  for (const c of COLUMNS) {
    const host = profile.lighthouses.find((l) => l.id === c.lighthouseId);
    // 主线 story beat（主线柱迁移）：**先于 host 门**处理——日志早揭示要求 host 未建时仍 emit（dim）。
    // host 在则摆 host 旁、不在则退家灯塔旁（让早揭示 dim 点有处可摆）。hidden（日志没标记此坐标·没带日志）才略过。
    if (c.storyTier) {
      const stState = storyPoiRevealState(profile, c.id);
      if (stState !== 'hidden') {
        const anchor = host ?? homeLh;
        out.push({
          ...storyTierPoi(c, c.storyTier, anchor?.mapX ?? 0.06, anchor?.mapY ?? 0.5),
          revealState: stState,
        });
      }
    }
    // 刷怪档：宿主灯塔未建（不在 profile.lighthouses）→ 该柱刷怪潜点不现（柱挂在灯塔上·灯塔在才有柱）。
    if (!host) continue;
    const built = columnBuiltLevel(profile, c.id);
    for (const t of c.tiers) {
      const st = depthTierRevealState(built, t.tier);
      if (st === 'hidden') continue;
      if (t.noPoi) continue; // 竖井等单入口柱的中间档：band/probe 轨正常派生，不出海图 POI
      out.push({ ...tierPoi(c, t, host.mapX, host.mapY), revealState: st });
    }
  }
  return out;
}
