// 港口海图引擎 —— 纯查询/生成层（无 UI / fs / console 依赖）
// 设计见 src/types/chart.ts。两个核心约定：
//   1. generateChart(profile) 派生自 profile，不写存档：anchor 持久，roaming 按
//      runsCompleted 做种子 → 每次回港换一批（"潮位变了"），零 SAVE_VERSION 影响。
//   2. 两级门控：requiresFlags = 发现（不满足不出现）；requiresUpgrade = 抵达能力
//      （不满足则海图上灰显可见但不能出海）。

import type { ChartPoi, PoiModifier, PlayerProfile, SeaChart, ChartConditions, PoiRevealState } from '@/types';
import chartData from '@/data/chart_pois.json';
import { getUpgradeDef } from './upgrades';
import { caveDepthCurveForPlace, caveShapeBucket } from './mapgen';
import { getZone } from './zones';
import {
  distanceBetween,
  nearestLighthouse,
  getLighthouseBonuses,
  getHomeLighthouse,
  getLighthouseUpgradeDef,
  getOutposts,
  outpostStage,
  OUTPOST_USABLE_STAGE,
  LIGHT_RADIUS_PER_BONUS,
} from './lighthouses';
import { effectiveRevealRadius } from './outposts';
import { flagGatedRegions } from './regions';

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
  mapX?: number;
  mapY?: number;
  weight?: number;
  requiresFlags?: string[];
  requiresUpgrade?: string;
  requiresLighthouseUpgrade?: string;
  modifier?: PoiModifier;
}

interface ChartPoiFile {
  anchors: ChartPoi[];
  roamingTemplates: RoamingTemplate[];
}

const FILE = chartData as unknown as ChartPoiFile;

/** 每次出海海图上展示的 roaming 机会点数量 */
const ROAMING_COUNT = 2;

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
 * 当前海况（潮汐 + 天气），派生自 runsCompleted（§6.5「POI 不总全揭、随回合变」）。
 * 纯函数、不入存档；UI 据此显示「活的海图」，浓雾时遮蔽一处机会点（见 generateChart）。
 * 分布：晴 ~55% / 薄雾 ~27% / 浓雾 ~18%（雾少见＝遮蔽是偶发的张力，不是常态）。
 */
export function chartConditions(profile: PlayerProfile): ChartConditions {
  const run = profile.runsCompleted;
  const tide: ChartConditions['tide'] = condHash(run, 'tide') % 2 === 0 ? 'ebb' : 'flood';
  const w = condHash(run, 'weather') % 100;
  const weather: ChartConditions['weather'] = w < 55 ? 'clear' : w < 82 ? 'mist' : 'fog';
  return { tide, weather };
}

/** requiresFlags 是否全满足 */
function flagsSatisfied(profile: PlayerProfile, requiresFlags?: string[]): boolean {
  if (!requiresFlags) return true;
  return requiresFlags.every((f) => profile.flags.has(f));
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
    modifier: { depthOffset: 100, visibility: 'dark', current: 'strong' },
    persistent: false,
    mimic: true,
  };
}

/**
 * 给定坐标是否被某座已拥有灯塔点亮（落在其 revealRadius 内）。
 * 无坐标 → 默认点亮（不因缺坐标而隐藏，向后兼容）。
 */
function isLit(profile: PlayerProfile, mapX?: number, mapY?: number): boolean {
  if (mapX === undefined || mapY === undefined) return true;
  for (const lh of profile.lighthouses) {
    // 有效半径＝随前哨衰减收缩（深水区 Phase 2b 真 reveal dimming）；home/废墟/水上灯塔无衰减＝原样。
    if (distanceBetween(lh.mapX, lh.mapY, mapX, mapY) <= effectiveRevealRadius(profile, lh)) return true;
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

/**
 * 勘测暗圈（Req A）：点在某座灯塔的勘测圈（revealRadius + dimRevealBonus × LIGHT_RADIUS_PER_BONUS）内，
 * 但在该灯塔点亮半径（revealRadius）之外 → 可见为 dim（勘测站设施效果）。
 * 无坐标 → false（不凭空给暗点）。仅 anchor/roaming POI 适用；mimic / story 不走这条路径。
 */
function isSurveyDim(profile: PlayerProfile, mapX?: number, mapY?: number): boolean {
  if (mapX === undefined || mapY === undefined) return false;
  for (const lh of profile.lighthouses) {
    const bonus = getLighthouseBonuses(lh).dimRevealBonus;
    if (bonus <= 0) continue;
    const lit = effectiveRevealRadius(profile, lh);
    const survey = lit + bonus * LIGHT_RADIUS_PER_BONUS;
    const d = distanceBetween(lh.mapX, lh.mapY, mapX, mapY);
    if (d > lit && d <= survey) return true;
  }
  return false;
}

/** POI 是否被灯塔点亮（reveal，基建地图 Phase C）。mimic「无灯之光」恒亮（这是诱饵，§3.5）。 */
export function isPoiLit(profile: PlayerProfile, poi: ChartPoi): boolean {
  if (poi.mimic) return true; // 无灯之光：海图上点亮，引诱你横渡
  // St1 一章锚点（#117）：日志抄来的坐标＝**已知点**，不走灯塔「发现」轴——教学尾
  // 「四个坐标圈上海图」与海图解锁是同一个动作，你不需要网照到它才知道它在哪。
  if (poi.story) return true;
  return isLit(profile, poi.mapX, poi.mapY);
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
  return isLit(profile, poi.mapX, poi.mapY);
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
  const h = condHash(profile.runsCompleted, `occlude:${poi.id}`) % 100;
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
  if (!flagsSatisfied(profile, poi.requiresFlags)) return 'hidden';
  if (!isPoiLit(profile, poi)) {
    // 勘测暗圈（Req A）：在勘测圈内（revealRadius 外）→ dim（可见不可去）。
    // story/mimic 不到这里；anchor 不被天气遮 → 勘测暗点也安全。
    if (isSurveyDim(profile, poi.mapX, poi.mapY)) return 'dim';
    return 'hidden'; // 圈外不出现（reveal-gated·A①）
  }
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
 * POI 不能出海的原因（已假定 visible）。可出海返回 null。
 * 能力门两类：requiresUpgrade（全局随身升级）+ requiresLighthouseUpgrade（家灯塔设施，如船坞）。
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
  return null;
}

/**
 * 一次下潜的"距离档"——按**最近的已拥有灯塔**到该 POI 的归一化距离换算（reach，SPEC §3.4/§4）。
 * 再减最近灯塔的 reachReduction，clamp ≥ 0。无坐标 / 无灯塔 → 退回写死的 poi.distance（fallback）。
 */
export function effectiveDistance(profile: PlayerProfile, poi: ChartPoi): number {
  if (poi.mapX === undefined || poi.mapY === undefined) return poi.distance;
  const near = nearestLighthouse(profile, poi.mapX, poi.mapY);
  if (!near) return poi.distance;
  const tier = Math.round(near.distance / REACH_NORM_PER_TIER);
  return Math.max(0, tier - getLighthouseBonuses(near.lighthouse).reachReduction);
}

/** 是否可从该 POI 出海（三态 lit＝圈内·已发现·无能力门·未被天气遮）。 */
export function isPoiDepartable(profile: PlayerProfile, poi: ChartPoi): boolean {
  return poiRevealState(profile, poi) === 'lit';
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
 * 生成当前海图。纯函数、确定性（种子＝profile.runsCompleted）——roaming 选取 pool-independent
 * （roamingKey），故中途点亮灯塔重算时不重洗已显示的机会点（§6.5「即时新 POI 浮现」，#80 尾巴）。
 * @param opts.profile 玩家档案（门控 + 种子来源）
 */
export function generateChart(opts: { profile: PlayerProfile }): SeaChart {
  const { profile } = opts;
  const conditions = chartConditions(profile);

  const pois: ChartPoi[] = [];

  // anchor：已发现且在揭示圈内的都进，带三态标签（锚点永不被天气藏＝进度安全·见 climateOcclusion）。
  // 中途点亮灯塔→新进范围的锚点这里立刻进（SeaChartView chartSig 已含灯塔有效半径→重算）＝即时浮现。
  for (const a of FILE.anchors) {
    const st = poiRevealState(profile, a);
    if (st !== 'hidden') pois.push({ ...a, revealState: st });
  }

  // roaming：从"已发现 + 已点亮（圈内）"模板取 roamingKey 最大的 ROAMING_COUNT 个（pool-independent·见 roamingKey）。
  // 天气遮蔽不再在此整点剔除，而是 per-poi 落进 poiRevealState（dim＝显示但去不了 / hidden＝彻底盖住·§10 C③）。
  const visibleTemplates = FILE.roamingTemplates.filter(
    (t) => flagsSatisfied(profile, t.requiresFlags) && isLit(profile, t.mapX, t.mapY),
  );
  const picked = [...visibleTemplates]
    .sort((a, b) => roamingKey(profile.runsCompleted, b) - roamingKey(profile.runsCompleted, a))
    .slice(0, ROAMING_COUNT);
  for (const t of picked) {
    const poi: ChartPoi = {
      id: `poi.roam.${profile.runsCompleted}.${t.templateId}`,
      zoneId: t.zoneId,
      name: t.name,
      blurb: t.blurb,
      distance: t.distance,
      mapX: t.mapX,
      mapY: t.mapY,
      modifier: t.modifier,
      persistent: false,
      requiresUpgrade: t.requiresUpgrade,
      requiresLighthouseUpgrade: t.requiresLighthouseUpgrade,
      requiresFlags: t.requiresFlags,
    };
    const st = poiRevealState(profile, poi);
    if (st !== 'hidden') pois.push({ ...poi, revealState: st });
  }

  // 深水区 Phase 3：mimic「无灯之光」假 POI（§3.5）。软门控——你在深处立了脚后才被引诱。
  // 恒 lit（诱饵）：isPoiLit 恒真 · isPoiExplainedByLighthouse 恒假 → UI 给「不在你网里」的宏观 tell。
  if (shouldLureMimic(profile)) pois.push({ ...makeMimicPoi(), revealState: 'lit' });

  return { generatedForRun: profile.runsCompleted, pois, conditions };
}

/** 从一张海图里按 id 取 POI */
export function getPoiById(chart: SeaChart, poiId: string): ChartPoi | undefined {
  return chart.pois.find((p) => p.id === poiId);
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
  if (mod.visibility && mod.visibility !== 'clear') {
    tags.push(mod.visibility === 'dark' ? '黑暗' : '浑浊');
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
