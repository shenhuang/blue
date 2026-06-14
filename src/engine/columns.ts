// 探深「深度柱」引擎（#131）—— 纯查询/派生层（无 UI / fs / console），是 src/data/depth_columns.json
// 的消费点。设计见 src/types/columns.ts。一根柱 = 单一数据来源，本文件把它派生成三样别处现成机制能吃的东西：
//   ① columnBands()        → 每 tier 一个 DepthBand（bands.ts 合并进注册表·getBand/dive 路径零改消费）；
//   ② columnProbeTracks()  → 每柱一条 LighthouseTrack（lighthouses.ts 合并进 TRACKS·onlyLighthouse=宿主·
//                            canBuildAt/buildAtLighthouse/设施面板零改消费·各级 cost=该 tier 账单·effects 空＝纯门控）；
//   ③ buildColumnPois()    → 海图深入 POI（chart.ts generateChart 注入·revealState 由 columnBuiltLevel vs tier 派生）。
//
// **依赖方向（守 check-boundaries·无环）**：columns.ts 只 import 类型 + depth_columns.json，是叶子；
//   bands.ts / lighthouses.ts / chart.ts / dive-start.ts 单向 import 本文件。columnBuiltLevel 直接读
//   profile.lighthouses（不 import lighthouses.ts·避免与其反向依赖成环）。

import type {
  DepthColumn,
  DepthColumnsFile,
  DepthColumnTier,
  DepthBand,
  LighthouseTrack,
  LighthouseUpgradeDef,
  PlayerProfile,
  ChartPoi,
  PoiRevealState,
} from '@/types';
import columnsData from '@/data/depth_columns.json';
import { TUTORIAL_COMPLETE_FLAG } from './story';

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
    tags: t.tags,
    maxRoomFeatures: t.maxRoomFeatures,
    sonarDeception: t.sonarDeception,
    hunts: t.hunts,
  };
}

/** 全部柱的派生 band（bands.ts 合并进注册表）。 */
export function columnBands(): DepthBand[] {
  return COLUMNS.flatMap((c) => c.tiers.map((t) => tierBand(c, t)));
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
      ? `把这座灯塔的深度柱探到第 ${t.tier} 级——名义可达 ~360m，但能去的只有「${t.label}」这一个下潜点（~${t.depthRange[1]}m）；建成即在海图上揭示它通向的区域。`
      : `把这座灯塔的深度柱探到第 ${t.tier} 级——海图上「${t.label}」深入潜点转为可下潜（${t.depthRange[0]}–${t.depthRange[1]}m）；再下一档以暗点现身。`,
    requiresLighthouseLevel: 1,
    // capstone（科考站电梯）建成置 flag → 揭示 flag-gated 区（#124）；普通档无 setsFlag（纯门控·可见性靠档位派生）。
    ...(t.setsFlag ? { setsFlag: t.setsFlag } : {}),
  }));
  return {
    id: columnProbeTrackId(c.id),
    name: '低频声呐',
    description: `给「${c.name}」装一套低频声呐——每升一级，海图上多探出一档更深的深入潜点（建到第 K 级 → 1…K 档可下潜、第 K+1 档以暗点现身、更深尚不可见）。`,
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
    mapX: clamp(hostX + dx),
    mapY: clamp(hostY + dy),
    bandId: columnTierBandId(c.id, t.tier),
    columnId: c.id,
    depthTier: t.tier,
    persistent: true,
  };
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
  for (const c of COLUMNS) {
    const host = profile.lighthouses.find((l) => l.id === c.lighthouseId);
    if (!host) continue;
    const built = columnBuiltLevel(profile, c.id);
    for (const t of c.tiers) {
      const st = depthTierRevealState(built, t.tier);
      if (st === 'hidden') continue;
      out.push({ ...tierPoi(c, t, host.mapX, host.mapY), revealState: st });
    }
  }
  return out;
}
