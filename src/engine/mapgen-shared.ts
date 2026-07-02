// mapgen 公共层：GenOpts + 各生成器共用的工具与 pass
//
// 内容：小工具（randInt/pickFrom/clamp）、多事件房间（rollExtraFeatures/maybeMultiFeatureRoom）、
// 确定性种子与洞型谱（fnv/makeSeededRng/caveSeededRng/caveHash/resolveDepthCurve/caveDepthCurveForPlace/
// caveShapeBucket）、声呐失真 pass（applySonarDeception）、尸体 pass（placeCorpses 一族）、
// 布局风格（resolveLayoutStyle/nodeCountMultiplier）、固定资源耗尽 pass（applyHarvestDepletion 一族）。
// 生成器本体在 mapgen-layered / mapgen-maze / mapgen-cave；对外门面在 mapgen.ts（re-export·import 面不破）。

import type { DiveMap, DiveNode, NodeFeature, ZoneDef, ZoneTag, DeathRecord, LayoutStyle } from '@/types';
import { buildEventPool, eventLootItemIds, pickWeighted } from './zones';
import { findRecoverableCorpse, isRecoverableCorpse } from './death';

export interface GenOpts {
  zone: ZoneDef;
  profileFlags: Set<string>;
  /** profile.deaths 列表，用于尸体生成 */
  deaths?: DeathRecord[];
  /** 尸体出现概率（0–1）。后续按打捞行会升级提高 */
  corpseChance?: number;
  rng?: () => number;
  /**
   * 洞穴一致性（声呐渲染重做 SPEC §6①·#98）：**地点身份串**（POI.id / band.id）。
   * 未显式传 `rng` 时，由 `hash(zone.id::seedKey::depthOffset)` 派生确定性 rng ⇒ **同一地点再潜＝同一张图**
   *（代价：每地点变体单一·作者要一致世界感）。缺省（既无 rng 也无 seedKey）→ 回退 Math.random（每潜不同·旧行为）。
   * mapgen-scenarios 各自显式传 `rng` 故**不受影响**（`opts.rng` 优先）。地图不入存档 ⇒ 此改**不 bump SAVE_VERSION**。
   */
  seedKey?: string;
  /**
   * 迷路图剖面曲线指数 k（洞型谱·显式覆盖）：depth = d0 + span·frac^k。
   * k<1 井+廊（先掉后平）/ k=1 匀速下行（旧行为）/ k>1 廊+坑（先平、尽头突然掉深）。
   * 未传 → resolveDepthCurve 按 zone.depthCurveRange + seedKey 派生（见 ZoneDef.depthCurveRange）；
   * 两边都没有 → k=1＝逐字节复现旧图。仅 maze 拓扑读它；layered 不受影响。
   */
  depthCurve?: number;
  /**
   * 来自海图 POI 的深度偏移（米）。平移整张图每层深度（+ 更深）。
   * 经 tickTurns / planAscent 自然换算成更高耗氧 / 更长减压。clamp 到 depth ≥ 0。
   */
  depthOffset?: number;
  /**
   * 深度 band（深水区 Phase 1）：覆盖 zone.depthRange 的绝对深度窗口 [d0, d1]。
   * band 引用 zone 提供内容、用自己的窗口决定下到多深；缺省（POI / 教学路径不传）→ 回退 zone.depthRange。
   * depthOffset 仍叠加在其上（band 出潜默认 0）。
   */
  depthRange?: [number, number];
  /**
   * 覆盖 zone.layerCount 的图规模旋钮（POI/band 可传）：layered=层数；maze=节点数派生基数（N≈2×layerCount）。
   * 「平廊」类出潜点靠它把图拉长——窄 span + 长图 ⇒ 威胁从「太深」换轴成「进来太远」（回程预算）。
   * 缺省 → zone.layerCount＝旧规模（零 rng 顺序变化）。
   */
  layerCount?: number;
  /**
   * 深度 band 的专属事件 tag 池（深水区内容期）：覆盖 zone.zoneTagsByDepth，让 band（trench）用自己的
   * twilight/midnight 专属事件池、与借来的 zone 内容隔离。缺省（POI / 教学 / 普通 zone 不传）→ 回退 tagsForDepth。
   * 同时作用于「节点 zoneTag 抽取」与「buildEventPool 事件筛选」两处，保证图与池一致。
   */
  bandTags?: ZoneTag[];
  /**
   * 多事件房间上限（声呐与房间 SPEC §6/§7 S1）：一个事件房间最多含几个 feature。
   * 缺省 / ≤1（POI / 教学 / 浅水 zone 不传）→ 永远单事件房间 ＝ **不消耗任何额外 rng、逐字节复现旧图**
   *（向后兼容、不破现有 mapgen 场景快照）。>1（深 band 出潜传 band.maxRoomFeatures）→ 事件房间按
   * rollExtraFeatures 偶尔升级成 2–3 feature 的「大房间」（大房间稀有）。深段内容（C）即铺在这些大房间里。
   */
  maxRoomFeatures?: number;
  /**
   * 大房间出现率加成（声呐与房间 SPEC §6/§8.3 续·升级派生 run.sensorTuning.roomFeatureChanceBonus）：0..ROOM_FEATURE_CHANCE_MAX。
   * 抬高 rollExtraFeatures 升级成多事件房间的概率（不突破 maxRoomFeatures 天花板）。缺省 0（POI/教学/未升级）→ 概率门槛不变
   * ＝**rng() 仍只取一次、阈值不变＝逐字节复现旧图**（不破现有 mapgen 场景快照）。
   */
  roomFeatureChanceBonus?: number;
  /**
   * 不可信声呐失真强度（声呐与房间 SPEC §5/§7 S2）：0..1。仅 >0（深 band 出潜传 band.sonarDeception）时，
   * 给部分**内部**节点钉 spoofsSonar（声呐图假装成朝上的出口/信标＝节点版 mimic）/evadesSonar（无回波）。
   * **确定性 FNV 哈希、零 rng**——绝不移动任何 seed 的生成顺序（旧图/深 band 快照 rng 流不变，只多挂派生字段）。
   * 缺省 / ≤0（POI / 教学 / 浅水 zone 不传）→ 不进欺骗 pass ＝逐字节复现旧图（向后兼容）。
   */
  sonarDeception?: number;
  /**
   * 打捞行会 Lv.2「出海前选目标」：指定一具 DeathRecord.id 作为本次必定出现的尸体。
   * 若该尸体在本 zone 且仍可回收（isRecoverableCorpse），则**保证**布点（绕过 corpseChance 随机），
   * 放在深度最接近其 depthAtDeath 的可用节点上。无效 / 未设则退回原有随机 corpse pass。
   */
  targetCorpseId?: string;
  /**
   * 当前下潜的 POI 身份串（POI 固定资源耗尽·2026-06-25）：透传给 buildEventPool 做 POI 专属事件门控
   * （有 poiId 的事件只在此池出现）。缺省（非 POI 下潜）→ 带 poiId 的事件一律不进池。
   */
  poiId?: string;
  /**
   * 当前下潜的 POI **稳定模板身份**（roaming 专属内容·2026-06-25）：roaming 实例 poiId（`poi.roam.<runs>.<tpl>`）
   * 每次出现都变、配不上静态事件 poiId；故另透传稳定的 templateId 给 buildEventPool 做匹配。
   * 缺省（anchor / 深度柱 / 教学下潜）→ undefined ⇒ 零影响（事件 poiId 仍只命中 poiId 精确匹配）。
   */
  poiTemplateId?: string;
  /**
   * 该 POI **永久**采尽的物品 id 集（save 级·来自 profile.harvestedResources[poiId]）：mapgen 生成后把
   * 产出这些物品的资源点抹平成空节点（玩家在地图上看不到已采完的点）。缺省/空 → 不抹平（向后兼容·零改动）。
   */
  harvestedItemIds?: Set<string>;
  /**
   * 该 POI 本 run 已采的 nodeId 集（run 级·来自 run.harvestedNodes[poiId]）：mapgen 把这些节点抹平成空节点。
   * 固定地图（seedKey=poi.id·同图同 nodeId）下「同一 run 内重生成」才用得上；新 run 起手为空 → 零改动。
   */
  harvestedNodeIds?: Set<string>;
  /**
   * 钉放剧情节拍（quirk #174）：一个 `weight:0` 的故事事件 id，**保证放置**在其 `depthRange` 的途中节点
   * （不进随机池·只此一途出现·防被内容库淹没）。由 dive-start 从 `poi.storyOpenEvents` 选出合规变体后透传。
   * 缺省 undefined → 不放置（所有非剧情下潜零影响·byte-identical）。仅 layered 图实现（reef/wreck·东礁重访）。
   */
  pinnedEventId?: string;
  /**
   * 教学关 node 化（#221+·SPEC docs/spec/深海回响_教学关node化_SPEC.md）：把指定事件按**显式 layer 索引**钉到该层首节点。
   * 与单数 pinnedEventId 正交（那个按 depthRange 选最深非末层放一枚；这个按 layer 放多枚）。仅 layered 路径实现。
   * 只在「教学首潜 + zone.scriptedNodeEvents」时由 generateDiveMap 喂；重访不喂 ⇒ 裸图 + pinnedEventId（captain_revisit）。
   * 缺省 undefined ⇒ 零影响（byte-identical·所有非教学下潜不受影响）。
   */
  scriptedNodeEvents?: Array<{ layer: number; eventId: string; preview?: string }>;
}

export function randInt(min: number, max: number, rng = Math.random): number {
  return Math.floor(rng() * (max - min + 1)) + min;
}

export function pickFrom<T>(arr: T[], rng = Math.random): T {
  return arr[Math.floor(rng() * arr.length)];
}

export function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

// ============================================================
// 多事件房间（声呐与房间 SPEC §6/§7 S1）—— 把一个事件房间偶尔升级成含 2–3 个 feature 的「大房间」
// ============================================================

/**
 * 掷出一个事件房间的**额外** feature 数（0..maxFeatures-1）。多数房间是单 feature（返回 0＝旧形状），
 * 约三成两 feature，三 feature「大房间」稀有（SPEC §6「大房间稀有」）。
 * **只有 maxFeatures>1 时才调用**——调用方先判，故缺省路径零额外 rng（逐字节复现旧图、不破场景快照）。
 */
function rollExtraFeatures(maxFeatures: number, rng: () => number, chanceBonus = 0): number {
  const r = rng();
  // 升级（chanceBonus·声呐与房间 §6/§8.3 续）把「单 feature」的门槛往下压＝大房间更常出现；2/3 feature 概率随之涨。
  // chanceBonus=0（缺省）→ 0.62/0.88＝旧阈值＝逐字节不变；单 feature 门槛留 0.30 地板（大房间再升也不至于必出）。
  const singleCut = Math.max(0.3, 0.62 - chanceBonus);
  const doubleCut = Math.max(singleCut, 0.88 - chanceBonus * 0.5);
  if (r < singleCut) return 0; // 单 feature（旧形状）
  if (r < doubleCut) return Math.min(1, maxFeatures - 1); // 两 feature
  return Math.min(2, maxFeatures - 1); // 大房间（最多三 feature）
}

export interface MultiFeatureArgs {
  zone: ZoneDef;
  depth: number;
  profileFlags: Set<string>;
  triggeredFakeIds: string[];
  bandTags?: ZoneTag[];
  poiId?: string;
  /** roaming 专属内容（2026-06-25）：稳定模板身份·随 poiId 一起透传给 buildEventPool。 */
  poiTemplateId?: string;
  rng: () => number;
  maxFeatures: number;
  chanceBonus?: number;
}

/**
 * 给一个已抽到首事件（first）的房间，可能再抽出几个 feature 凑成多事件房间。
 * 返回 ≥2 的 NodeFeature[] 即「大房间」（调用方据此置 node.features、清 eventId、改 preview）；
 * 返回 undefined → 保持单事件房间（旧形状）。额外事件从同一池子抽、靠 triggeredFakeIds 去重（同 run 不重复）、
 * 抽干就少给——房内各 feature 同 zoneTag（#19 单 tag 不破）、loot 隔离在事件数据侧（#44/#47）。
 */
export function maybeMultiFeatureRoom(
  first: { id: string; title: string },
  args: MultiFeatureArgs,
): NodeFeature[] | undefined {
  if (args.maxFeatures <= 1) return undefined;
  const extra = rollExtraFeatures(args.maxFeatures, args.rng, args.chanceBonus);
  if (extra <= 0) return undefined;
  const feats: NodeFeature[] = [{ id: 'f0', eventId: first.id, preview: first.title }];
  // 同房不放重复 feature：用 excludeIds 硬排除本房已用事件（≠ triggeredFakeIds 的 oncePerRun 软去重）。
  const used = new Set<string>([first.id]);
  for (let k = 0; k < extra; k++) {
    const pool = buildEventPool({
      zone: args.zone,
      depth: args.depth,
      sanity: 100,
      profileFlags: args.profileFlags,
      triggeredEventIds: args.triggeredFakeIds,
      excludeIds: used,
      tagsOverride: args.bandTags,
      poiId: args.poiId,
      poiTemplateId: args.poiTemplateId,
    });
    if (pool.length === 0) break; // 池子抽干（或同房可用事件用尽）→ 少给几个 feature
    const chosen = pickWeighted(pool, args.rng)!;
    feats.push({ id: `f${feats.length}`, eventId: chosen.id, preview: chosen.title });
    used.add(chosen.id);
    args.triggeredFakeIds.push(chosen.id);
  }
  return feats.length > 1 ? feats : undefined;
}

// ============================================================
// 不可信声呐失真（声呐与房间 SPEC §5/§7 S2）—— 给深 band 部分节点钉 spoofs/evades
// ============================================================

/** FNV-1a（与 clarity.ts 同款）——确定性挑节点 / 伪装，**不耗 mapgen 的 seeded rng**（绝不移动任何 seed 的生成）。 */
function fnv(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * mulberry32 确定性 PRNG（洞穴一致性·SPEC §6①·#98）：由「地点派生种子」生成稳定 rng。
 * 仅在 generateDiveMap 收到 seedKey、且**未**收显式 rng 时启用 ⇒ 同一地点再潜同一张图。质量足够 mapgen 取点用。
 * 与 mapgen 的 seeded rng 流是同一接口（() => [0,1)），故子生成器无需改动、destructure 即用。
 */
export function makeSeededRng(zoneId: string, seedKey: string, depthOffset: number): () => number {
  let a = fnv(`${zoneId}::${seedKey}::${depthOffset}`) >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 持久洞确定性 rng（多口持久洞·方案 B·#98 家族）：同 seed 同图。
 * 首次进生成（dive-start::startDiveIntoCave）与加载 overlay 各取一条独立流（seed 加后缀区分）。
 */
export function caveSeededRng(seed: string): () => number {
  return makeSeededRng(seed, 'cave', 0);
}

/** 确定性挑选哈希（持久洞入口节点绑定派生用·FNV·零 rng）。 */
export function caveHash(s: string): number {
  return fnv(s);
}

/**
 * 解析迷路图剖面曲线指数 k（洞型谱·**零 rng**——绝不移动任何 seed 的生成顺序）：
 *   显式 opts.depthCurve > zone.depthCurveRange 内按 seedKey log-uniform 派生（同一地点同一性格·
 *   域标签 ::curve 与 makeSeededRng 的种子解耦）> 无 seedKey 或未配区间 → 1（旧线性·逐字节复现旧图）。
 * 真实游戏的迷路下潜都带 seedKey（POI.id / band.id·dive-start.ts）⇒ 每个洞口固定一种洞型；
 * 回归脚本不传 seedKey ⇒ 现有 sweep / baseline 全部不受 zone 接线影响（护栏）。
 */
export function resolveDepthCurve(opts: GenOpts): number {
  return caveDepthCurveForPlace(opts.zone, opts.seedKey, opts.depthCurve);
}

/**
 * 某个「地点」（POI/band）的剖面曲线 k——**公共入口**：mapgen 生成与海图情报展示共用，
 * 保证「图上写的洞型」与「潜下去的洞型」永远同源（海图=诚实轴·quirk #113 同理）。
 * pinned（POI modifier.depthCurve）> zone.depthCurveRange 内按 seedKey log-uniform 派生 > 1。
 */
export function caveDepthCurveForPlace(zone: ZoneDef, seedKey: string | undefined, pinned?: number): number {
  if (pinned !== undefined && pinned > 0) return pinned;
  const range = zone.depthCurveRange;
  if (!range || seedKey == null) return 1;
  const lo = Math.log(Math.max(0.05, Math.min(range[0], range[1])));
  const hi = Math.log(Math.max(0.05, Math.max(range[0], range[1])));
  const u = fnv(`${zone.id}::${seedKey}::curve`) / 0x100000000;
  return Math.exp(lo + (hi - lo) * u);
}

/** 洞型分桶（情报话术用·内部连续外部说人话）：k<0.8 井+廊 / 0.8–1.45 匀速 / >1.45 廊+坑。 */
export type CaveShapeBucket = 'shaft' | 'linear' | 'gallery';
export function caveShapeBucket(k: number): CaveShapeBucket {
  if (k < 0.8) return 'shaft';
  if (k <= 1.45) return 'linear';
  return 'gallery';
}

/** spoof 在 NodeSelectView 声呐预览里「像……」的伪装文案（节点版 mimic「无灯之光」＝假上浮口/家的光/空水）。 */
const SPOOF_DISGUISES = [
  '一道朝上的出口',
  '海面漏下来的光',
  '一盏像家的光',
  '一片什么都没有的空水',
];

/**
 * 不可信声呐失真（S2）：给深 band 部分**内部**节点钉 spoofsSonar（声呐图画成假信标＝节点版 mimic，与 #69 海图
 * mimic 合流·**不触发 d_reveal**）/ evadesSonar（无回波）。**确定性 FNV 哈希·零 rng**——故绝不移动任何 seed 的
 * 生成顺序（旧图 / 深 band 快照的 rng 流逐字节不变，只多挂两个纯派生字段）。仅 chance>0 才进＝缺省零改动。
 * 豁免：起点 + 地标（出口/气穴/扎营，dive.ts isLandmark 永给真相、不参与欺骗）+ 尸体（守 #36 尸体定位）+
 *      已带 spoofs/evades 的节点（mimic 钩子等，不覆盖）。
 */
export function applySonarDeception(map: DiveMap, chance: number): void {
  if (chance <= 0) return; // 门控：缺省零改动（守旧图/快照、不耗 rng）
  for (const node of Object.values(map.nodes)) {
    if (node.id === map.startNodeId) continue;
    if (
      node.kind === 'ascent_point' ||
      node.kind === 'air_pocket' ||
      node.kind === 'camp' ||
      node.kind === 'corpse'
    ) {
      continue;
    }
    if (node.evadesSonar || node.spoofsSonar) continue; // 别覆盖既有钩子
    const h = fnv(`sonar-deceive:${node.id}:${node.depth}`);
    if ((h % 1000) / 1000 >= chance) continue;
    if ((h >>> 10) % 2 === 0) {
      node.evadesSonar = true; // 无回波（捕食者躲过 ping）
    } else {
      node.spoofsSonar = SPOOF_DISGUISES[(h >>> 11) % SPOOF_DISGUISES.length]; // 假信标（节点版 mimic）
    }
  }
}

/** 多事件房间从远处（相邻节点）看到的预览——只暗示「开阔、有好几处」，不剧透各 feature（灯下/声呐/盲都先过这层）。 */
export function roomPreview(featureCount: number): string {
  return featureCount >= 3
    ? '前方的水域开阔下来，黑里隐约有好几处轮廓，值得一个个凑近看。'
    : '前方的水域开阔了些，约略有两处地方值得凑近看看。';
}

/** 在候选节点里挑深度最接近 targetDepth 的一个（强制布尸用） */
function closestDepthNodeId(
  nodes: Record<string, DiveNode>,
  ids: string[],
  targetDepth: number,
): string | undefined {
  let best: string | undefined;
  let bestDiff = Infinity;
  for (const id of ids) {
    const diff = Math.abs(nodes[id].depth - targetDepth);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = id;
    }
  }
  return best;
}

/** 把一个节点替换成 corpse 节点（保留 id / layer / depth / zoneTag / connectsTo） */
function corpsifyNode(node: DiveNode, corpseRecordId: string): DiveNode {
  return {
    ...node,
    kind: 'corpse',
    eventId: undefined,
    corpseRecordId,
    preview: '一个熟悉的轮廓，挂在水里，随暗流慢慢转着。',
    hasCorpseHint: true,
  };
}

/**
 * 解析"出海前选定的目标尸体"（打捞行会 Lv.2）。仅当 targetCorpseId 指向一具本 zone 仍可回收的
 * 尸体时返回它，否则 undefined（退回随机 corpse pass）。
 */
function resolveTargetCorpse(
  targetCorpseId: string | undefined,
  deaths: DeathRecord[],
  zoneId: string,
): DeathRecord | undefined {
  if (!targetCorpseId) return undefined;
  return deaths.find((d) => d.id === targetCorpseId && isRecoverableCorpse(d, zoneId));
}

export interface CorpsePassOpts {
  deaths: DeathRecord[];
  zoneId: string;
  targetCorpseId?: string;
  corpseChance: number;
  rng: () => number;
}

/**
 * 给一张图植入尸体节点（层状 / 迷路共用）。candidateIds = 允许放尸体的节点 id（已排除入口/上浮口/地标）。
 *  - 有 targetCorpseId 且该尸体可回收 → 保证布点（最接近其死亡深度的候选；不消耗 rng）。
 *  - 否则按 corpseChance 随机：打乱候选 id，放第一个 depth ±10m 匹配到尸体的节点。
 * 原地改 nodes。
 */
export function placeCorpses(
  nodes: Record<string, DiveNode>,
  candidateIds: string[],
  opts: CorpsePassOpts,
): void {
  if (candidateIds.length === 0) return;
  const { deaths, zoneId, targetCorpseId, corpseChance, rng } = opts;

  const forced = resolveTargetCorpse(targetCorpseId, deaths, zoneId);
  if (forced) {
    const nodeId = closestDepthNodeId(nodes, candidateIds, forced.depthAtDeath)!;
    nodes[nodeId] = corpsifyNode(nodes[nodeId], forced.id);
    return;
  }

  if (deaths.length === 0 || rng() >= corpseChance) return;
  const placed = new Set<string>();
  const shuffled = [...candidateIds].sort(() => rng() - 0.5);
  for (const nodeId of shuffled) {
    const corpse = findRecoverableCorpse(deaths, zoneId, nodes[nodeId].depth, placed);
    if (corpse) {
      nodes[nodeId] = corpsifyNode(nodes[nodeId], corpse.id);
      placed.add(corpse.id);
      break;
    }
  }
}

/**
 * 解析一张图的渲染布局风格（**单一来源**·渲染铺点与 POI 数都读它·见 types `LayoutStyle`）：
 * 显式 `zone.layoutStyle` 优先；否则 `orientation==='horizontal'` → 'horizontal'；再否则 'vertical'。
 * 纯函数·零 rng（绝不移动任何 seed 的生成顺序）。
 */
export function resolveLayoutStyle(zone: ZoneDef): LayoutStyle {
  return zone.layoutStyle ?? (zone.orientation === 'horizontal' ? 'horizontal' : 'vertical');
}

/**
 * 节点数（POI）随布局「宽度」缩放（作者 2026-06-27：**宽的洞穴 POI 普遍比竖着的多**）：
 * 竖向 ×2（＝历史公式·**逐字节复现旧图**）；非竖向（横/蛇行/环/螺旋＝横向铺得开的洞）×3。
 * 只读 style ⇒ 竖向 zone 的 N 公式与 rng 消耗一字不差（不破 mapgen 场景快照）。
 */
export function nodeCountMultiplier(style: LayoutStyle): number {
  return style === 'vertical' ? 2 : 3;
}

// ============================================================
// 固定资源耗尽（POI 固定资源耗尽 SPEC·2026-06-25）—— 把已采尽的资源点抹平成空节点
// ============================================================

/** 一个事件节点是否产出**已永久采尽**的物品（save 级·任一 loot 命中即算）。 */
function eventYieldsExhausted(eventId: string, exhausted: Set<string>): boolean {
  for (const id of eventLootItemIds(eventId)) {
    if (exhausted.has(id)) return true;
  }
  return false;
}

/**
 * 把一个资源点节点**原地**抹平成「采空」的空节点（rest）。保留 id/layer/depth/zoneTag/connectsTo
 * ＝守拓扑/可达性不变量（只清掉事件与 feature）；地标/出口/尸体本就不进这条 pass。
 */
function depleteNode(node: DiveNode): void {
  node.kind = 'rest';
  node.eventId = undefined;
  node.features = undefined;
  node.preview = '一处已经被采空的地方，只剩翻动过的痕迹。';
}

/**
 * 已采尽资源点抹平 pass（确定性·零 rng·缺省 no-op）：
 *  - run 级：node.id ∈ harvestedNodeIds（本 run 已采·下次重进刷新）→ 整点抹平。
 *  - save 级：单事件节点其事件产出已永久采尽物品 → 整点抹平；多 feature 房间剔除产出采尽物品的 feature，
 *    全剔则抹平、剔到只剩一个则退化回单事件房间（与 mapgen 单 feature 同形）。
 * 仅事件节点参与（含多 feature 大房间·kind 仍为 'event'）；地标/出口/尸体/休息点一律不动。原地改 map.nodes。
 */
export function applyHarvestDepletion(
  map: DiveMap,
  harvestedItemIds?: Set<string>,
  harvestedNodeIds?: Set<string>,
): void {
  const hasItems = harvestedItemIds !== undefined && harvestedItemIds.size > 0;
  const hasNodes = harvestedNodeIds !== undefined && harvestedNodeIds.size > 0;
  if (!hasItems && !hasNodes) return;
  for (const node of Object.values(map.nodes)) {
    if (node.kind !== 'event') continue;
    // run 级：整点本 run 已采 → 抹平
    if (hasNodes && harvestedNodeIds!.has(node.id)) {
      depleteNode(node);
      continue;
    }
    if (!hasItems) continue;
    // save 级·单事件节点
    if (node.eventId) {
      if (eventYieldsExhausted(node.eventId, harvestedItemIds!)) depleteNode(node);
      continue;
    }
    // save 级·多 feature 房间：逐 feature 剔除
    if (node.features && node.features.length > 0) {
      const kept = node.features.filter((f) => !eventYieldsExhausted(f.eventId, harvestedItemIds!));
      if (kept.length === node.features.length) continue; // 无 feature 采尽 → 不动
      if (kept.length === 0) {
        depleteNode(node);
      } else if (kept.length === 1) {
        // 退化回单事件房间（与 mapgen 生成单 feature 同形：走 eventId、自动触发）
        node.eventId = kept[0].eventId;
        node.preview = kept[0].preview;
        node.features = undefined;
      } else {
        node.features = kept;
        node.preview = roomPreview(kept.length);
      }
    }
  }
}
