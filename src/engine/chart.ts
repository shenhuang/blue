// 港口海图引擎 —— 纯查询/生成层（无 UI / fs / console 依赖）
// 设计见 src/types/chart.ts。两个核心约定：
//   1. generateChart(profile) 派生自 profile，不写存档：anchor 持久，roaming 按
//      runsCompleted 做种子 → 每次回港换一批（"潮位变了"），零 SAVE_VERSION 影响。
//   2. 两级门控：requiresFlags = 发现（不满足不出现）；requiresUpgrade = 抵达能力
//      （不满足则海图上灰显可见但不能出海）。

import type { ChartPoi, PoiModifier, PlayerProfile, SeaChart, ChartConditions, PoiRevealState, LunarPhase } from '@/types';
import chartData from '@/data/chart_pois.json';
import { getUpgradeDef } from './upgrades';
import { hasSonarEquipped } from './equipment';
import { caveDepthCurveForPlace, caveShapeBucket } from './mapgen';
import { getZone } from './zones';
import {
  distanceBetween,
  nearestLighthouse,
  getHomeLighthouse,
  getLighthouseUpgradeDef,
  getOutposts,
  outpostStage,
  revealRadius,
  ownerAnchorPos,
  OUTPOST_USABLE_STAGE,
} from './lighthouses';
import { flagGatedRegions } from './regions';
import { buildColumnPois, columnBuiltLevel, depthTierRevealState, storyPoiRevealState, columnHostBuilt, getColumn } from './columns';
import { poisKnownFromItems } from './items';
import { lunarPhase, moonAge, tideLevel, lunarPhaseLabel, daysUntilAnyPhase } from './lunar';

/**
 * 归一化海图距离 → "distance 档"的换算系数（reach，SPEC §4/§9 tunable）。
 * 选 0.3 使现有 4 个锚点从 home 算出的档位与写死值一致（0/1/1/2，不破手感）；
 * roaming 点按几何略有出入（本就是"潮位常变"的机会点）。
 */
export const REACH_NORM_PER_TIER = 0.3;

/** roaming 模板（数据形状：无运行时 id / persistent，generateChart 补齐） */
interface RoamingTemplate {
  templateId: string;
  zoneId: string;
  name: string;
  blurb: string;
  distance: number;
  /** 显式归属（owner 灯塔 id·同 ChartPoi.owner）：有 owner ⇒ mapX/mapY 为相对偏移 + owner-gated 点亮。 */
  owner?: string;
  /** owner-less「绝对坐标」lane 显式 opt-in（同 ChartPoi.absolute·守门用）。 */
  absolute?: boolean;
  /** 有 owner 时为相对 owner 的偏移（generateChart resolve 成绝对）；否则为绝对坐标。 */
  mapX?: number;
  mapY?: number;
  weight?: number;
  requiresFlags?: string[];
  requiresUpgrade?: string;
  requiresLighthouseUpgrade?: string;
  modifier?: PoiModifier;
  /** 月相潮窗（SPEC §2.3）：设了 ⇒ 只在这些相位入 roaming 选取池（generateChart 过滤·随相位浮现/消失）。 */
  lunarWindow?: LunarPhase[];
  lunarOffWindow?: 'hidden' | 'dim';
  intelFlag?: string;
}

/** 一张地图（mapId）的 POI 段。 */
interface ChartPoiMap {
  anchors: ChartPoi[];
  roamingTemplates: RoamingTemplate[];
}
/**
 * chart_pois.json 现按 mapId 分段（ch1/ch2/…·对齐 chart_regions.json）。owner 全局唯一 → 跨图
 * 按 owner flatten 消费（同 regions.ts 套路）：所有段的 POI 并进一个池，点亮判定按 owner 是否在
 * profile.lighthouses 自然分流（别的章节灯塔没建＝其 POI 隐藏）。`_doc` 等字符串字段跳过。
 */
type ChartPoiFile = { [mapId: string]: ChartPoiMap | string };

const FILE = chartData as unknown as ChartPoiFile;

function flattenChartPois(file: ChartPoiFile): { anchors: ChartPoi[]; roamingTemplates: RoamingTemplate[] } {
  const anchors: ChartPoi[] = [];
  const roamingTemplates: RoamingTemplate[] = [];
  for (const key of Object.keys(file)) {
    const seg = file[key];
    if (typeof seg === 'string' || key.startsWith('_')) continue;
    anchors.push(...(seg.anchors ?? []));
    roamingTemplates.push(...(seg.roamingTemplates ?? []));
  }
  return { anchors, roamingTemplates };
}
/** 全地图 flatten 后的 POI 池（generateChart 消费·owner 分流）。 */
const POIS = flattenChartPois(FILE);

/** 每次出海海图上展示的 roaming 机会点数量 */
const ROAMING_COUNT = 2;

/**
 * owner POI 坐标 resolve（owner-anchored 重构）：有 owner ⇒ mapX/mapY 是相对 owner 声明坐标的偏移，
 * 加 ownerAnchorPos(owner) 得绝对坐标（之后 isLit / poiRevealState / effectiveDistance / UI 一律用绝对值）。
 * 用 owner 的**静态声明坐标**（不查 profile.lighthouses）⇒ 即便 owner beacon 还没建，剧情 POI 也能定位渲染。
 * 无 owner（绝对坐标 lane / mimic）⇒ 原样返回（mapX/mapY 已是绝对）；owner 不在声明表 ⇒ 原样不崩（守门拦）。
 */
function resolveOwnerCoords<T extends { owner?: string; mapX?: number; mapY?: number }>(node: T): T {
  if (node.owner === undefined) return node;
  const base = ownerAnchorPos(node.owner);
  if (!base) return node;
  return { ...node, mapX: base.mapX + (node.mapX ?? 0), mapY: base.mapY + (node.mapY ?? 0) };
}

/**
 * 确定性海况种子（声呐与房间 §6.5）：FNV-1a on `salt:runsCompleted`，不碰 roaming 的 LCG（互不串）。
 * 同 runsCompleted → 同海况（可回归）；跨 runsCompleted → 换一批（潮位/天气变）。
 */
function condHash(runsCompleted: number, salt: string): number {
  let h = 2166136261 >>> 0;
  const s = `${salt}:${runsCompleted}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * 海图「时间种子」单一访问点（月相潮汐·SPEC §3）：chart 的海况/遮蔽/roaming 全以它为时钟。
 * ＝ `profile.day`（hydrate 后≡runsCompleted·港口等待推进后两钟分离）；缺 day（旧档 / dev 面板裸 profile）
 * → 回退 runsCompleted（守逐字节不变·不动并发编辑中的 ChartViewDevPanel——它拨 runsCompleted 滑杆即驱动）。
 */
function chartSeed(profile: PlayerProfile): number {
  return profile.day ?? profile.runsCompleted;
}

/**
 * 当前海况（潮汐 + 天气），派生自 day（§6.5「POI 不总全揭、随回合变」；月相潮汐 SPEC §3 种子 runsCompleted→day·
 * tide 月相重派生留 Phase 1）。
 * 纯函数、不入存档；UI 据此显示「活的海图」，浓雾时遮蔽一处机会点（见 generateChart）。
 * 分布：晴 ~55% / 薄雾 ~27% / 浓雾 ~18%（雾少见＝遮蔽是偶发的张力，不是常态）。
 */
export function chartConditions(profile: PlayerProfile): ChartConditions {
  const day = chartSeed(profile);
  // 潮汐改由月相派生（SPEC §3）：tideLevel(day)∈[-1,1]·>0 涨 / ≤0 退（大潮在新月/满月）。天气仍独立随机轴（§1）。
  const tide: ChartConditions['tide'] = tideLevel(day) > 0 ? 'flood' : 'ebb';
  const w = condHash(day, 'weather') % 100;
  const weather: ChartConditions['weather'] = w < 55 ? 'clear' : w < 82 ? 'mist' : 'fog';
  return { tide, weather, phase: lunarPhase(day), moonAge: moonAge(day) };
}

/** requiresFlags 是否全满足 */
function flagsSatisfied(profile: PlayerProfile, requiresFlags?: string[]): boolean {
  if (!requiresFlags) return true;
  return requiresFlags.every((f) => profile.flags.has(f));
}

/**
 * 该 POI 是否被玩家持有的「文献坐标」道具标记（物品即解锁·marksPois ⇒ reveal·作者 2026-06-19）。
 * true ⇒ 你抄到 / 带着这个坐标，知道它在哪：poiRevealState 据此**绕过发现门**（requiresFlags + isPoiLit）；
 * isPoiLit / isPoiExplainedByLighthouse 也视其为「已知 / 有合法来源」——避免文献揭示的点被误判成 mimic
 * 「亮而无主」（守诚实轴·mimic 仍唯一谎点）。仍受能力门 / 天气（知道 ≠ 去得了 → 落 lit/dim）。
 * 承接并推广 #117「story 锚点＝日志已知坐标」：导师日志 / 鲸落手记等任意带 marksPois 的道具皆走此径。
 */
function documentKnowsPoi(profile: PlayerProfile, poi: ChartPoi): boolean {
  return poisKnownFromItems(profile).has(poi.id);
}

/** 月相窗门豁免谓词（SPEC §2.3·同 climateOcclusion）：剧情锚点 / 持久 anchor / mimic 不受月相限制。 */
function lunarExempt(poi: ChartPoi): boolean {
  return !!poi.persistent || !!poi.story || !!poi.mimic;
}

/**
 * POI 是否「已知」（§5 可发现性·把窗外 hidden 降级 dim 的依据）：文献坐标（marksPois·documentKnowsPoi）
 * 或 NPC/情报 flag（poi.intelFlag 已置）。一条规则、多来源（marksPois 之外接 NPC 进度对话）。
 */
function poiKnownByIntel(profile: PlayerProfile, poi: ChartPoi): boolean {
  return (
    documentKnowsPoi(profile, poi) ||
    (poi.intelFlag !== undefined && profile.flags.has(poi.intelFlag))
  );
}

/**
 * 月相窗门态（SPEC §4·仿深度柱分支）。非豁免 POI 带 lunarWindow 且本相位不在窗内：
 *   已知（§5）→ 'dim'（可规划「满月再来」）；未知 → poi.lunarOffWindow ?? 'dim'（秘密点 'hidden'＝连存在都不知道）。
 * 窗内 / 无窗 / 豁免 → null（不拦·继续天气/能力门）。
 */
function lunarWindowState(
  profile: PlayerProfile,
  poi: ChartPoi,
  known: boolean,
): 'dim' | 'hidden' | null {
  if (lunarExempt(poi)) return null;
  const win = poi.lunarWindow;
  if (!win || win.length === 0) return null;
  if (win.includes(lunarPhase(chartSeed(profile)))) return null;
  return known ? 'dim' : (poi.lunarOffWindow ?? 'dim');
}

/** 深水区 Phase 3 mimic 假 POI 的运行时 id + 它引向的兑现事件。 */
export const MIMIC_POI_ID = 'poi.mimic.false_beacon';
export const MIMIC_DIVE_EVENT_ID = 'mimic.false_beacon';

/**
 * 「无灯之光」是否该出现在海图上（深水区 Phase 3，§3.5）。**软门控**：你在深处立稳脚
 * （任一**水下**前哨达半亮 ≥ OUTPOST_USABLE_STAGE）后才被引诱——绝望/盲目地往深里去的人，才看得见那盏不属于谁的光。
 * 不带硬故事 flag（守软门控）；它一直引诱、不因「读穿过一次」消失（保持暧昧、可复诱）。
 */
function shouldLureMimic(profile: PlayerProfile): boolean {
  return getOutposts().some(
    (o) => o.submerged && outpostStage(profile, o.id) >= OUTPOST_USABLE_STAGE,
  );
}

/** 海图上的 mimic 假 POI（§3.5）：恒亮、网外、引向最深处的兑现。坐标摆在远海一角（仅显示；tell 不靠几何）。 */
function makeMimicPoi(): ChartPoi {
  return {
    id: MIMIC_POI_ID,
    zoneId: 'zone.blue_caves',
    name: '无名的光',
    blurb:
      '海图最远的角上，一点光稳稳亮着——暖，匀，像一座灯塔。可你数过自己点亮的每一盏灯，没有一盏在那儿。它不在你的网里，却亮着，等你过去。',
    distance: 4,
    mapX: 0.93,
    mapY: 0.9,
    modifier: { depthOffset: 100, gate: { sense: 'lamp', mode: 'locked' }, current: 'strong' },
    persistent: false,
    mimic: true,
  };
}

/**
 * 给定 POI 是否被"点亮"（海图揭示门）。两条互斥路径：
 *   - 有 owner（owner-anchored·绝大多数 POI）：owner 灯塔在 profile.lighthouses 里即点亮——显式归属、
 *     不走几何（区域揭示 owner→存在性）。owner POI 坐标已由 generateChart resolve 成绝对，但这里不依赖它。
 *   - 无 owner（owner-less·mimic / 绝对坐标特例 / flag-gated 鲸落）：原几何（落某灯塔 revealRadius 内）
 *     + flag-gated 揭示圈路径；无坐标 → 默认点亮（向后兼容）。
 */
function isLit(profile: PlayerProfile, poi: { owner?: string; mapX?: number; mapY?: number }): boolean {
  if (poi.owner !== undefined) return profile.lighthouses.some((l) => l.id === poi.owner);
  const { mapX, mapY } = poi;
  if (mapX === undefined || mapY === undefined) return true;
  for (const lh of profile.lighthouses) {
    // 点亮半径（衰减已删·#125）：灯塔的点亮范围＝固定 revealRadius（不再随 run 收缩）。
    if (distanceBetween(lh.mapX, lh.mapY, mapX, mapY) <= revealRadius(lh)) return true;
  }
  // flag-gated 揭示区（owner-less·鲸落区起）：revealFlag 满足时，它的 center+radius 圈也是一个
  // 揭示源——圈内 POI 随 found flag 正常点亮（无灯塔→无衰减·半径取 region.radius）。
  // isPoiExplainedByLighthouse 已 delegate 本函数 ⇒ 这类 POI 自动「有合法来源」、不误触 mimic
  // 「亮而无主」宏观 tell（守诚实轴·mimic 仍唯一谎点）。这是「按条件揭示隐藏区」通用原语的消费点。
  for (const region of flagGatedRegions()) {
    if (!region.center || !region.revealFlag) continue;
    if (!profile.flags.has(region.revealFlag)) continue;
    if (distanceBetween(region.center.x, region.center.y, mapX, mapY) <= region.radius) return true;
  }
  return false;
}

/** POI 是否被灯塔点亮（reveal，基建地图 Phase C）。mimic「无灯之光」恒亮（这是诱饵，§3.5）。 */
export function isPoiLit(profile: PlayerProfile, poi: ChartPoi): boolean {
  if (poi.mimic) return true; // 无灯之光：海图上点亮，引诱你横渡
  // St1 一章锚点（#117）：日志抄来的坐标＝**已知点**，不走灯塔「发现」轴——教学尾
  // 「四个坐标圈上海图」与海图解锁是同一个动作，你不需要网照到它才知道它在哪。
  if (poi.story) return true;
  // 主线 story beat（主线柱迁移）：日志早揭示的坐标＝已知点（同 story 短路），可见性由 storyTierRevealState
  // 在 poiRevealState 决（host 建成 + 日志 marksPois 文献坐标）；这里恒「已知」⇒ 不被误判 mimic「亮而无主」（守诚实轴）。
  if (poi.columnStory) return true;
  // 文献坐标（物品即解锁·marksPois ⇒ reveal·作者 2026-06-19）：持有标记此点的道具＝已知点，同 story 短路
  // 绕灯塔「发现」轴（导师日志 / 鲸落手记…）。承接 #117 到任意 marksPois 道具。
  if (documentKnowsPoi(profile, poi)) return true;
  return isLit(profile, poi);
}

/**
 * 这个点亮的 POI 能否被你**自家灯塔网**解释（深水区 Phase 3 宏观 tell，§3.5）。
 * mimic「无灯之光」恒 false ＝「它亮着，可你的网里没有这一盏」——你清楚自己的灯塔都在哪，这一盏不是你点的。
 * 普通 POI ＝ 是否落在自家灯塔点亮半径内（你的网照得到它）。UI 据此给「交叉比对」的那条 tell。
 */
export function isPoiExplainedByLighthouse(profile: PlayerProfile, poi: ChartPoi): boolean {
  if (poi.mimic) return false; // 无灯之光：不是你网里的任何一盏
  // St1 一章锚点（#117）：亮的来源是「你自己抄的坐标」——有解释，别让剧情锚点误穿
  // mimic 的「亮而无主」宏观 tell（海图诚实轴）。
  if (poi.story) return true;
  // 主线 story beat（主线柱迁移）：亮的来源是「日志抄来的坐标」——有合法解释，别误穿 mimic「亮而无主」tell。
  if (poi.columnStory) return true;
  // 文献坐标（物品即解锁·#2026-06-19）：亮的来源是「你带着的那张纸」——有合法解释，别让文献揭示的点
  // （如鲸落手记标的生态点）误穿 mimic「亮而无主」tell。
  if (documentKnowsPoi(profile, poi)) return true;
  return isLit(profile, poi);
}

/**
 * 天气对单个机会点的遮蔽（区域揭示三态·§10·C③「多数彻底不显示(无)、少数显示但过不去(暗)」）。
 * 确定性 per-(poi.id, runsCompleted)；roaming 的 id 含 runsCompleted ⇒ 被遮的点随回合「来去」。
 * 锚点 / story / mimic 永不被遮（进度安全 + mimic 是唯一谎点·守诚实轴）。
 */
function climateOcclusion(profile: PlayerProfile, poi: ChartPoi): 'none' | 'dim' | 'hidden' {
  if (poi.persistent || poi.story || poi.mimic) return 'none';
  const { weather } = chartConditions(profile);
  if (weather === 'clear') return 'none';
  const h = condHash(chartSeed(profile), `occlude:${poi.id}`) % 100;
  if (weather === 'mist') return h < 22 ? 'dim' : 'none'; // 薄雾：少数机会点「认得出、去不了」
  return h < 30 ? 'hidden' : h < 50 ? 'dim' : 'none'; // 浓雾：多数彻底盖住(无)、一部分显示但过不去(暗)
}

/**
 * POI 三态揭示（区域揭示主实装块·§10）。发现门 + 揭示圈门 + 能力门 + 天气，派生成 lit/dim/hidden：
 *   hidden ＝ requiresFlags 未满足 / 不在任何揭示圈内（圈外无 POI·修「满图铺」偏差 A①）/ 天气彻底盖住；
 *   dim    ＝ 圈内已发现，但当下去不了：能力门未解（requiresUpgrade / 灯塔设施）或天气遮成「暗」；
 *   lit    ＝ 圈内·已发现·可出海。
 * 诚实轴：mimic 恒 lit（唯一谎点）；anchor 永不被天气藏（climateOcclusion 对 persistent 恒 none）。
 */
export function poiRevealState(profile: PlayerProfile, poi: ChartPoi): PoiRevealState {
  if (poi.mimic) return 'lit'; // 无灯之光：海图上「亮且可去」的诱饵
  // 探深「深度柱」深入潜点（#131）：可见性走**档位制**——该柱已建低频声呐级数 vs 本档 depthTier
  // （≥→lit / ==+1→dim / else hidden·一级露一档）。不走发现/揭示圈/天气（柱潜点摆宿主灯塔圈内、
  // 灯塔在即随柱浮现；它该不该亮只看探深建到第几级）。
  if (poi.columnId !== undefined && poi.depthTier !== undefined) {
    return depthTierRevealState(columnBuiltLevel(profile, poi.columnId), poi.depthTier);
  }
  // 主线 story beat 潜点（主线柱迁移）：带 columnStory + columnId（无 depthTier）⇒ 走 host 建成 + 日志早揭示
  // （storyTierRevealState·**不走**探深档位制、也不走发现/揭示圈/天气）。reveal=日志 marksPois 文献坐标·reach=host 建成。
  if (poi.columnStory && poi.columnId !== undefined) {
    return storyPoiRevealState(profile, poi.columnId);
  }
  // 发现门（位置是否已知）：持有标记此点的文献（物品即解锁·marksPois ⇒ reveal）⇒ 已知·绕发现门；
  // 否则走常规发现（requiresFlags 发现 flag + isPoiLit 灯塔网/揭示圈/story 已知点）。文献短路只绕「发现」，
  // 不绕下面的能力门/天气（知道 ≠ 去得了）——缺设施/装备的已知点照样落 dim（resolveMarkedPois 据此给「去不了」原因）。
  const known = poiKnownByIntel(profile, poi);
  if (!known) {
    if (!flagsSatisfied(profile, poi.requiresFlags)) return 'hidden';
    if (!isPoiLit(profile, poi)) return 'hidden'; // 圈外不出现（reveal-gated·A①·勘测圈已删→非点亮一律 hidden）
  }
  // 月相窗门（SPEC §4）：本相位不在 POI 潮窗内 → 已知 dim（可规划）/ 未知 lunarOffWindow（秘密点 hidden）。
  // 排在天气/能力之前（§8 显示优先级：未知 hidden > 月相未到 > 缺能力 > 天气遮）。
  const lunar = lunarWindowState(profile, poi, known);
  if (lunar) return lunar;
  const occ = climateOcclusion(profile, poi);
  if (occ !== 'none') return occ;
  return poiLockReason(profile, poi) === null ? 'lit' : 'dim';
}

/**
 * POI 是否对玩家"可见"（≠ hidden·向后兼容旧调用）。发现门 + 揭示圈门 + 天气，详见 poiRevealState。
 */
export function isPoiVisible(profile: PlayerProfile, poi: ChartPoi): boolean {
  return poiRevealState(profile, poi) !== 'hidden';
}

/**
 * 是否拥有可用照明装备（感知门 SPEC §4/§10.5·入口谓词）：灯槽装着一件灯——**不看当前电量**（拥有即算·
 * 想下去就带灯，哪怕出海时没充满）。别和潜内实时 `lampOn`（run.sensors.light && power>0）混。
 * 缺 equipment（裸 profile / 坏档）→ 无灯（保守挡）。
 */
export function ownsUsableLamp(profile: PlayerProfile): boolean {
  return profile.equipment?.light != null;
}

/**
 * 声呐能力是否已解锁（感知门 SPEC §4/§10.5·入口谓词）：声呐槽装着一台达基线等级的声呐件（＝run.sensors.sonarUnlocked
 * 的持久来源·engine/equipment.ts::hasSonarEquipped 单一真相）。别用潜内 run.sensors。缺 equipment → 未解锁。
 */
export function sonarUnlocked(profile: PlayerProfile): boolean {
  return profile.equipment ? hasSonarEquipped(profile.equipment) : false;
}

/**
 * 海图入口门（感知门 SPEC §4·一般化「全黑 POI 不带灯不让下潜」）：POI 是整潜门（modifier.gate）且玩家缺那个感官
 * → 挡下潜、给原因；否则 null（可下）。**不对称**（§4）：
 *   - lamp 门 && !ownsUsableLamp → 挡「漆黑 · 需照明才能下潜」（缺装备·下去纯浪费）；
 *   - sonar 门 && !sonarUnlocked → 挡（reason 取 gate.reason ?? 中性）——但**已解锁声呐则不挡**（下去扫就行）；
 * 海图生图前只有 POI 自带 modifier·拿不到还没生成的子节点 ⇒ 入口门必须靠 POI 级 modifier.gate（授权源）。纯函数。
 */
export function poiDiveBlock(profile: PlayerProfile, poi: ChartPoi): { blocked: true; reason: string } | null {
  const g = poi.modifier?.gate;
  if (!g) return null;
  if (g.sense === 'lamp' && !ownsUsableLamp(profile)) {
    return { blocked: true, reason: '漆黑 · 需照明才能下潜' };
  }
  if (g.sense === 'sonar' && !sonarUnlocked(profile)) {
    return { blocked: true, reason: g.reason ?? '需声呐才能下潜' };
  }
  return null;
}

/**
 * POI 不能出海的原因（已假定 visible）。可出海返回 null。
 * 能力门：requiresUpgrade（全局随身升级）+ requiresLighthouseUpgrade（家灯塔设施，如船坞）+ 感知门入口（poiDiveBlock·
 * 缺灯 / 声呐没解锁的整潜门 POI·感知门 SPEC §4）。**入口门收在此单点** ⇒ 自动流进 poiRevealState（lit/dim 判据）与
 * poiBlockReason（UI 一句话）——lamp 门缺灯的 POI 落 dim（可见但去不了·标「漆黑·需照明」）。
 */
export function poiLockReason(profile: PlayerProfile, poi: ChartPoi): string | null {
  if (poi.requiresUpgrade && !profile.unlockedUpgrades.has(poi.requiresUpgrade)) {
    const def = getUpgradeDef(poi.requiresUpgrade);
    return `需要「${def?.name ?? poi.requiresUpgrade}」`;
  }
  if (poi.requiresLighthouseUpgrade) {
    const home = getHomeLighthouse(profile);
    if (!home || !home.builtUpgrades.has(poi.requiresLighthouseUpgrade)) {
      const def = getLighthouseUpgradeDef(poi.requiresLighthouseUpgrade);
      return `需要「${def?.name ?? poi.requiresLighthouseUpgrade}」`;
    }
  }
  // 感知门入口（§4）：缺灯 / 声呐没解锁的整潜门 POI → 挡（reason 直给）。
  const gateBlock = poiDiveBlock(profile, poi);
  if (gateBlock) return gateBlock.reason;
  return null;
}

/**
 * 一次下潜的"距离档"——按**最近的已拥有灯塔**到该 POI 的归一化距离换算。无坐标 / 无灯塔 → 退回写死
 * 的 poi.distance（fallback）。**纯展示/排序**：作者 2026-06-14 删「出海更近」/距离预耗氧后，距离档不再
 * 影响下潜损耗（每潜从第一回合起算）——保留此函数仅供 describePoi/调试，无 reachReduction 折减。
 */
export function effectiveDistance(profile: PlayerProfile, poi: ChartPoi): number {
  if (poi.mapX === undefined || poi.mapY === undefined) return poi.distance;
  const near = nearestLighthouse(profile, poi.mapX, poi.mapY);
  if (!near) return poi.distance;
  return Math.round(near.distance / REACH_NORM_PER_TIER);
}

/** 是否可从该 POI 出海（三态 lit＝圈内·已发现·无能力门·未被天气遮）。 */
export function isPoiDepartable(profile: PlayerProfile, poi: ChartPoi): boolean {
  return poiRevealState(profile, poi) === 'lit';
}

/**
 * dim POI 的「为什么去不了 / 怎样才能去」——给 UI 一句可执行的话（已假定 visible；lit 可去 → null）。
 * 各类 dim 的解法（作者 2026-06-14：暗点必须告诉玩家达成什么条件能去）：
 *   ① 深度柱档（低频声呐没建到这一级·columnId/depthTier）→ 升一级；
 *   ② 能力门（已点亮但缺设施/装备）→ poiLockReason 的「需要『X』」；
 *   ③ 天气遮成暗 → 潮一变又不同（短暂）。
 */
export function poiBlockReason(profile: PlayerProfile, poi: ChartPoi): string | null {
  if (isPoiDepartable(profile, poi)) return null;
  // 主线 story beat 暗点（主线柱迁移·点 4）：dim ＝日志已早揭示（知道坐标）但该区 host 前哨还没建好。
  // 给一句可执行的话——指明「先建哪座前哨」（host 灯塔对应前哨名·单一来源 lighthouse_upgrades.json）。
  if (poi.columnStory && poi.columnId !== undefined && !columnHostBuilt(profile, poi.columnId)) {
    const col = getColumn(poi.columnId);
    const hostName = col
      ? getOutposts().find((o) => o.result.id === col.lighthouseId)?.name
      : undefined;
    return hostName ? `得先建起「${hostName}」。` : '得先把这片海里的前哨建起来。';
  }
  // 低频声呐「深度柱」暗档（#131）：dim 只因「低频声呐还没建到这一级」——给一句可执行的话。
  if (poi.columnId !== undefined && poi.depthTier !== undefined) {
    return '声呐探得到，但还没有路。低频声呐升一级，这里才能落脚。';
  }
  // 月相窗门暗点（SPEC §4·§8·排在能力/天气前）：本相位不在 POI 潮窗内 → 「等到 X 相·还 N 天」。
  if (!lunarExempt(poi) && poi.lunarWindow && poi.lunarWindow.length > 0) {
    const day = chartSeed(profile);
    if (!poi.lunarWindow.includes(lunarPhase(day))) {
      const target = poi.lunarWindow.map(lunarPhaseLabel).join('/');
      return `潮窗未到：要等${target}（还 ${daysUntilAnyPhase(day, poi.lunarWindow)} 天）。`;
    }
  }
  // 已点亮（在可去圈内、已发现）但仍 dim：先报能力门，否则是天气遮（勘测圈已删·非 lit 一律 hidden 不到这里）。
  const lock = poiLockReason(profile, poi);
  if (lock) return lock;
  if (climateOcclusion(profile, poi) === 'dim') {
    return '这一带被雾压着，这一拍过不去。';
  }
  return '去不了';
}

/**
 * roaming 选取键（声呐与房间 §6.5「即时新 POI 浮现」）——**pool-independent 确定性加权键**。
 * 用 Efraimidis–Spirakis 加权水库采样（A-Res）：key = u^(1/weight)，u∈(0,1) 由 (runsCompleted, templateId)
 * 确定性哈希；取 key 最大的 N 个 ＝ 等价于「加权不放回抽样」，但**每个模板的键不依赖池子里还有谁**。
 *
 * 这条「池无关」性质正是「即时新 POI 浮现」的关键（#80 留的尾巴）：玩家在港口中途点亮一座灯塔→
 * 远端机会点进入可见池（池变大），旧算法（顺序加权抽，依赖池子组成）会把已显示的 roaming **整组重洗**；
 * 改成 pool-independent 键后，同 runsCompleted 的已选 roaming **稳定不动**，至多被一个 key 更高的「新点亮」
 * 模板挤掉一个（确定性、最小变化），不会无谓重排。锚点本就不受选取限制，重算即浮现。
 */
function roamingKey(runsCompleted: number, t: RoamingTemplate): number {
  const u = (condHash(runsCompleted, `roam:${t.templateId}`) % 1_000_000) / 1_000_000; // (0,1)
  const w = Math.max(1, t.weight ?? 1);
  return Math.pow(Math.max(1e-9, u), 1 / w); // 越大优先级越高；高 weight → 平均 key 更大（保留加权语义）
}

/**
 * roaming 模板在当前相位是否进选取池（月相·SPEC §4/§5）。无窗 / 窗内 → 入池。
 * **窗外**：仅当「已知」（持有 intelFlag 情报·§5）或 `lunarOffWindow:'dim'`（默认·公开机会点）才留池
 * ——留池者会在 `poiRevealState` 落 `dim`（「等到 X 相」可规划）；窗外且未知的秘密点（`'hidden'`）不入池、
 * 消失且不占 ROAMING_COUNT 选取槽（守「没情报连存在都不知道」+ 不挤掉别的机会点）。
 * 注：roaming 运行时 id 含 day 不稳定 ⇒ marksPois/documentKnowsPoi 配不上它，故 roaming 的「已知」只认 intelFlag。
 */
export function roamingInLunarPool(
  t: { lunarWindow?: LunarPhase[]; lunarOffWindow?: 'hidden' | 'dim'; intelFlag?: string },
  profile: PlayerProfile,
): boolean {
  const win = t.lunarWindow;
  if (!win || win.length === 0) return true;
  if (win.includes(lunarPhase(chartSeed(profile)))) return true;
  const known = t.intelFlag !== undefined && profile.flags.has(t.intelFlag);
  return known || (t.lunarOffWindow ?? 'dim') === 'dim';
}

/**
 * 生成当前海图。纯函数、确定性（种子＝profile.runsCompleted）——roaming 选取 pool-independent
 * （roamingKey），故中途点亮灯塔重算时不重洗已显示的机会点（§6.5「即时新 POI 浮现」，#80 尾巴）。
 * @param opts.profile 玩家档案（门控 + 种子来源）
 */
export function generateChart(opts: { profile: PlayerProfile }): SeaChart {
  const { profile } = opts;
  const seed = chartSeed(profile); // 海图时间种子＝day（SPEC §3·dev 裸 profile 回退 runsCompleted）
  const conditions = chartConditions(profile);

  const pois: ChartPoi[] = [];

  // owner 坐标 resolve（owner-anchored）：owner POI 的 mapX/mapY 是相对 owner 声明坐标的偏移 →
  // 加 ownerAnchorPos 得绝对坐标（此后逻辑一律用绝对值）。无 owner 的（绝对 lane）原样。
  const anchors = POIS.anchors.map(resolveOwnerCoords);

  // anchor：已发现且在揭示圈内的都进，带三态标签（锚点永不被天气藏＝进度安全·见 climateOcclusion）。
  // 中途点亮灯塔→新进范围的锚点这里立刻进（SeaChartView chartSig 已含灯塔有效半径→重算）＝即时浮现。
  for (const a of anchors) {
    const st = poiRevealState(profile, a);
    if (st !== 'hidden') pois.push({ ...a, revealState: st });
  }

  // roaming：从"已发现 + 已点亮（圈内）"模板取 roamingKey 最大的 ROAMING_COUNT 个（pool-independent·见 roamingKey）。
  // 天气遮蔽不再在此整点剔除，而是 per-poi 落进 poiRevealState（dim＝显示但去不了 / hidden＝彻底盖住·§10 C③）。
  // 月相：带 lunarWindow 的 roaming 模板按相位入池（SPEC §4/§5·roamingInLunarPool）——窗内入；窗外仅
  // 「已知（intelFlag 情报）/ lunarOffWindow:'dim'」者留池（poiRevealState 显 dim·可规划），秘密未知点消失不占槽。
  const visibleTemplates = POIS.roamingTemplates
    .map(resolveOwnerCoords)
    .filter((t) => flagsSatisfied(profile, t.requiresFlags) && isLit(profile, t) && roamingInLunarPool(t, profile));
  // 带 lunarWindow 的点＝「有意安排·可规划」的潮窗点（窗内 lit / 窗外已知或公开 dim）——**恒显·不挤随机
  // top-2 机会点槽**（#218 玩测：已知潮窗点随 roamingKey 闪进闪出、规划靠不住·#219 修）；无窗点照旧抢 ROAMING_COUNT 随机槽。
  const isWindowed = (t: RoamingTemplate) => !!t.lunarWindow && t.lunarWindow.length > 0;
  const windowedShown = visibleTemplates.filter(isWindowed);
  const picked = visibleTemplates
    .filter((t) => !isWindowed(t))
    .sort((a, b) => roamingKey(seed, b) - roamingKey(seed, a))
    .slice(0, ROAMING_COUNT);
  for (const t of [...picked, ...windowedShown]) {
    const poi: ChartPoi = {
      id: `poi.roam.${seed}.${t.templateId}`,
      // 稳定模板身份（roaming 专属内容·2026-06-25）：实例 id 含 runsCompleted 每次变、事件 poiId 配不上；
      // 带上 templateId 让 dive-start→buildEventPool 按它匹配 roaming 专属内容（anchor 不设此字段·走 id 精确匹配）。
      templateId: t.templateId,
      zoneId: t.zoneId,
      name: t.name,
      blurb: t.blurb,
      distance: t.distance,
      owner: t.owner,
      mapX: t.mapX,
      mapY: t.mapY,
      modifier: t.modifier,
      persistent: false,
      requiresUpgrade: t.requiresUpgrade,
      requiresLighthouseUpgrade: t.requiresLighthouseUpgrade,
      requiresFlags: t.requiresFlags,
      lunarWindow: t.lunarWindow,
      lunarOffWindow: t.lunarOffWindow,
      intelFlag: t.intelFlag,
    };
    const st = poiRevealState(profile, poi);
    if (st !== 'hidden') pois.push({ ...poi, revealState: st });
  }

  // 探深「深度柱」深入潜点（#131）：每座已建灯塔的柱按探深级数派生 lit/dim 档（hidden 不入）。
  // buildColumnPois 已带 revealState（档位制·见 columns.ts/poiRevealState）；宿主灯塔未建的柱不出潜点。
  for (const p of buildColumnPois(profile)) pois.push(p);

  // 深水区 Phase 3：mimic「无灯之光」假 POI（§3.5）。软门控——你在深处立了脚后才被引诱。
  // 恒 lit（诱饵）：isPoiLit 恒真 · isPoiExplainedByLighthouse 恒假 → UI 给「不在你网里」的宏观 tell。
  if (shouldLureMimic(profile)) pois.push({ ...makeMimicPoi(), revealState: 'lit' });

  return { generatedForRun: seed, pois, conditions };
}

/** 从一张海图里按 id 取 POI */
export function getPoiById(chart: SeaChart, poiId: string): ChartPoi | undefined {
  return chart.pois.find((p) => p.id === poiId);
}

/** 道具携带的一个海图坐标（「文献坐标」功能·作者 2026-06-18）的解析结果。 */
export interface MarkedPoiInfo {
  id: string;
  name: string;
  /** 是否已可下潜（点亮且无能力/天气门挡）→ UI 给可点击的「前往」。 */
  departable: boolean;
  /** 去不了时的一句话原因（poiBlockReason）；可去＝null。 */
  blockReason: string | null;
  /** 是否已在当前海图上生成（未点亮/章节未解锁的点 → false，名字回退为 id）。 */
  onChart: boolean;
  /**
   * 坐标显示串（如「47.3, 78.1」）——从该 POI **解析后的绝对** mapX/mapY 派生（formatChartCoord·单一来源）。
   * 缺坐标（不在海图上 / 该 POI 未声明 mapX/mapY）→ null。导师日志等「页脚坐标」据此陈列。
   */
  displayCoord: string | null;
  /**
   * 已勘——该坐标的主线 beat 已完成（columnStory.beatFlag 置位·去过且拿到关键结果）。
   * UI 在日志坐标列表给删除线「划掉」·但**仍可点重访**（回流 / St2 vent 留白）；非主线坐标恒 false。
   */
  surveyed: boolean;
}

/**
 * 海图归一化坐标（~0–1·owner-anchored resolve 后的绝对值）→ 人类可读坐标串。
 * 「文献坐标」显示的**单一换算来源**（作者 2026-06-18「数字换算你定·但绝对值一改这里要一起改」）：
 * 放大成两位制网格参考，读起来像海图上铅笔写的坐标。改格式 / 精度只动这里。
 */
export function formatChartCoord(mapX: number, mapY: number): string {
  return `${(mapX * 100).toFixed(1)}, ${(mapY * 100).toFixed(1)}`;
}

/**
 * 解析道具 `story.marksPois` 携带的海图坐标（「文献坐标」功能·作者 2026-06-18·旧海图/藏宝图复用）：
 * 对照当前海图给出每个点的名字 + 可达性 + 去不了原因。物品栏「文献」详情据此陈列；可达的点可点击→跳海图选中。
 * 纯读·一次性 generateChart 后查表（坐标点数量级小）。
 */
export function resolveMarkedPois(profile: PlayerProfile, poiIds: string[]): MarkedPoiInfo[] {
  const chart = generateChart({ profile });
  return poiIds.map((id) => {
    const poi = chart.pois.find((p) => p.id === id);
    if (!poi)
      return { id, name: id, departable: false, blockReason: '还不在你的海图上', onChart: false, displayCoord: null, surveyed: false };
    // poi.mapX/mapY 已是 generateChart resolve 后的绝对坐标（owner-anchored·见 resolveOwnerCoords）。
    const displayCoord =
      poi.mapX != null && poi.mapY != null ? formatChartCoord(poi.mapX, poi.mapY) : null;
    // 已勘＝该坐标的主线 beat 已完成（columnStory.beatFlag 置位·去过且拿到关键结果）；UI 给「划掉」删除线·仍可点重访。
    const surveyed = !!poi.columnStory?.beatFlag && profile.flags.has(poi.columnStory.beatFlag);
    return {
      id,
      name: poi.name,
      departable: isPoiDepartable(profile, poi),
      blockReason: poiBlockReason(profile, poi),
      onChart: true,
      displayCoord,
      surveyed,
    };
  });
}

/** 人类可读的修正摘要（UI 标签 / CLI 日志用）。无修正返回空数组。 */
export function describeModifier(mod?: PoiModifier): string[] {
  if (!mod) return [];
  const tags: string[] = [];
  if (mod.depthOffset && mod.depthOffset !== 0) {
    tags.push(mod.depthOffset > 0 ? `更深 +${mod.depthOffset}m` : `更浅 ${mod.depthOffset}m`);
  }
  if (mod.current && mod.current !== 'none') {
    tags.push(mod.current === 'strong' ? '急流' : '缓流');
  }
  if (mod.gate) {
    tags.push(mod.gate.sense === 'lamp' ? '黑暗' : '浑浊');
  }
  return tags;
}

/**
 * 洞型情报标签（#114·喂「灯塔=信息基建」轴）：maze zone 的 POI 给一条**真话**剖面话术——
 * 与 mapgen 同一来源（caveDepthCurveForPlace(zone, poi.id, modifier.depthCurve)）⇒ 图上写的＝潜下去的。
 * 海图是诚实轴（quirk #113 同理），欺骗留给深 band 的声呐侧（S2），不在这撒谎；
 * 未来要做「情报模糊/被误标的洞」＝在**这里**加可选参数分流话术，别另开第二个 k 来源。
 * 非 maze zone（开阔海域）→ null（不出标签）。
 */
export function describeCaveShape(poi: ChartPoi): string | null {
  const zone = getZone(poi.zoneId);
  if (!zone || zone.mapShape !== 'maze') return null;
  const k = caveDepthCurveForPlace(zone, poi.id, poi.modifier?.depthCurve);
  switch (caveShapeBucket(k)) {
    case 'shaft':
      return '洞型·往下掉';
    case 'gallery':
      return '洞型·往里钻';
    default:
      return '洞型·斜着下';
  }
}

/**
 * 玩家已知的月相潮窗点（不暴露秘密·waitPreview 用）：
 * 扫描所有 roamingTemplates（和带 lunarWindow 的 anchors）中：
 *   - 有非空 lunarWindow
 *   - 且 intelFlag 已置于 profile.flags（玩家通过情报"知道"它）
 * 返回 { name, window }。纯函数·无副作用。
 */
export function knownLunarPoints(profile: PlayerProfile): { name: string; window: LunarPhase[] }[] {
  const out: { name: string; window: LunarPhase[] }[] = [];
  // roaming templates
  for (const t of POIS.roamingTemplates) {
    if (!t.lunarWindow || t.lunarWindow.length === 0) continue;
    if (!t.intelFlag || !profile.flags.has(t.intelFlag)) continue;
    out.push({ name: t.name, window: t.lunarWindow });
  }
  // anchors（有 lunarWindow 且 intelFlag 已知）
  for (const a of POIS.anchors) {
    const aa = a as ChartPoi & { intelFlag?: string };
    if (!aa.lunarWindow || aa.lunarWindow.length === 0) continue;
    if (!aa.intelFlag || !profile.flags.has(aa.intelFlag)) continue;
    out.push({ name: aa.name, window: aa.lunarWindow });
  }
  return out;
}

/** CLI / 日志用的一行描述 */
export function describePoi(profile: PlayerProfile, poi: ChartPoi): string {
  const d = effectiveDistance(profile, poi);
  const dist = d > 0 ? ` 距离${d}` : '';
  const mods = describeModifier(poi.modifier);
  const modStr = mods.length > 0 ? ` [${mods.join('/')}]` : '';
  const lock = poiLockReason(profile, poi);
  const lockStr = lock ? ` (锁:${lock})` : '';
  return `${poi.name} → ${poi.zoneId}${dist}${modStr}${lockStr}`;
}
