// 节点图生成器
//
// 两种拓扑（由 ZoneDef.mapShape 选择，与 canFreeAscend 正交）：
//   - 'layered'（默认）：层状 DAG——layerCount 层，每层 2-3 节点，深度从
//     zone.depthRange[0] 单调渐变到 [1]，只连下一层。开阔海域（旧灯塔礁 / 沉船墓园）用它。
//   - 'maze'：洞穴"迷路"图——双向边的连通图，有环（绕回原点）、死路（dead-end）、
//     多个"最深点"（局部深度极大）。入口与"洞另一头的出口"都是 ascent_point。蓝洞群用它。
//
// 不论哪种拓扑：depthOffset（海图 POI 修正）都先平移 depthRange 再生成；corpse pass 仍按
// depth ±10m 匹配 findRecoverableCorpse。analyzeMap() 是纯结构分析器，给 dev 面板 + 回归脚本复用。

import type { DiveMap, DiveNode, NodeFeature, ZoneDef, NodeKind, ZoneTag, DeathRecord } from '@/types';
import { buildEventPool, pickWeighted, tagsForDepth } from './zones';
import { findRecoverableCorpse, isRecoverableCorpse } from './death';

interface GenOpts {
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
}

function randInt(min: number, max: number, rng = Math.random): number {
  return Math.floor(rng() * (max - min + 1)) + min;
}

function pickFrom<T>(arr: T[], rng = Math.random): T {
  return arr[Math.floor(rng() * arr.length)];
}

function clamp(x: number, lo: number, hi: number): number {
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

interface MultiFeatureArgs {
  zone: ZoneDef;
  depth: number;
  profileFlags: Set<string>;
  triggeredFakeIds: string[];
  bandTags?: ZoneTag[];
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
function maybeMultiFeatureRoom(
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
function makeSeededRng(zoneId: string, seedKey: string, depthOffset: number): () => number {
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
 * 解析迷路图剖面曲线指数 k（洞型谱·**零 rng**——绝不移动任何 seed 的生成顺序）：
 *   显式 opts.depthCurve > zone.depthCurveRange 内按 seedKey log-uniform 派生（同一地点同一性格·
 *   域标签 ::curve 与 makeSeededRng 的种子解耦）> 无 seedKey 或未配区间 → 1（旧线性·逐字节复现旧图）。
 * 真实游戏的迷路下潜都带 seedKey（POI.id / band.id·dive-start.ts）⇒ 每个洞口固定一种洞型；
 * 回归脚本不传 seedKey ⇒ 现有 sweep / baseline 全部不受 zone 接线影响（护栏）。
 */
function resolveDepthCurve(opts: GenOpts): number {
  if (opts.depthCurve !== undefined && opts.depthCurve > 0) return opts.depthCurve;
  const range = opts.zone.depthCurveRange;
  if (!range || opts.seedKey == null) return 1;
  const lo = Math.log(Math.max(0.05, Math.min(range[0], range[1])));
  const hi = Math.log(Math.max(0.05, Math.max(range[0], range[1])));
  const u = fnv(`${opts.zone.id}::${opts.seedKey}::curve`) / 0x100000000;
  return Math.exp(lo + (hi - lo) * u);
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
function applySonarDeception(map: DiveMap, chance: number): void {
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
function roomPreview(featureCount: number): string {
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

interface CorpsePassOpts {
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
function placeCorpses(
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

export function generateDiveMap(opts: GenOpts): DiveMap {
  const { zone, depthOffset = 0 } = opts;

  // band（Phase 1）可用 depthRange 覆盖 zone.depthRange；缺省回退 zone 自身（POI / 教学路径不传）。
  // 然后叠加海图 POI 深度偏移：平移，clamp 下限到 0，保证 d1 > d0。
  const range = opts.depthRange ?? zone.depthRange;
  const baseD0 = Math.max(0, range[0] + depthOffset);
  const baseD1 = Math.max(baseD0 + 1, range[1] + depthOffset);

  if (zone.generation === 'linearScripted') {
    // 教学关：单节点指向起始事件
    const startNode: DiveNode = {
      id: 'scripted.start',
      layer: 0,
      depth: baseD0,
      zoneTag: 'tutorial',
      kind: 'event',
      eventId: zone.scriptedStartEventId,
      connectsTo: [],
      preview: '出发。',
    };
    return {
      zoneId: zone.id,
      generatedAt: Date.now(),
      nodes: { [startNode.id]: startNode },
      startNodeId: startNode.id,
    };
  }

  // 洞穴一致性（SPEC §6①·#98）：未显式传 rng 时，若有 seedKey 则用「地点派生」的确定性 rng（同地点同图）；
  // 否则回退 Math.random（旧行为·每潜不同）。把解析后的 rng 注回 opts ⇒ 两个子生成器 destructure 即取到、无需各自再判。
  const rng =
    opts.rng ?? (opts.seedKey != null ? makeSeededRng(zone.id, opts.seedKey, depthOffset) : Math.random);
  const genOpts: GenOpts = { ...opts, rng };

  // 随机图：按 mapShape 分流（缺省 = layered，保持现有 zone 行为不变）
  const map =
    zone.mapShape === 'maze'
      ? generateMazeMap(genOpts, baseD0, baseD1)
      : generateLayeredMap(genOpts, baseD0, baseD1);
  // 不可信声呐失真（声呐与房间 S2）：深 band 给部分内部节点挂 spoofs/evades（确定性·零 rng·gated）。
  // 放在分流之后＝两种拓扑共用一条欺骗 pass；chance=0（缺省）时 no-op、不耗 rng、逐字节复现旧图。
  applySonarDeception(map, opts.sonarDeception ?? 0);
  return map;
}

// ============================================================
// 层状 DAG（开阔海域）—— 行为与重写前完全一致，只是抽成独立函数
// ============================================================

function chooseLayeredNodeKind(
  layer: number,
  totalLayers: number,
  rng: () => number,
  opts: { canFreeAscend: boolean },
): NodeKind {
  // 第一层全部 event；最后一层至少有一个 ascent_point（洞穴 zone 也保留——那是洞另一端的出口）
  if (layer === 0) return 'event';
  if (layer === totalLayers - 1) return 'ascent_point';
  const roll = rng();
  if (opts.canFreeAscend) {
    if (roll < 0.8) return 'event';
    if (roll < 0.9) return 'rest';
    return 'ascent_point';
  }
  // 洞穴 / canFreeAscend=false：中间层不再生成 ascent_point。
  if (roll < 0.9) return 'event';
  return 'rest';
}

function generateLayeredMap(opts: GenOpts, baseD0: number, baseD1: number): DiveMap {
  const { zone, profileFlags, rng = Math.random, deaths = [], corpseChance = 0.6, targetCorpseId, maxRoomFeatures = 1, roomFeatureChanceBonus = 0 } = opts;

  const totalLayers = zone.layerCount;
  const d0 = baseD0;
  const d1 = baseD1;
  const depthStep = (d1 - d0) / Math.max(1, totalLayers - 1);
  const canFreeAscend = zone.canFreeAscend !== false; // 默认 true

  const nodes: Record<string, DiveNode> = {};
  const layerNodes: string[][] = [];
  const triggeredFakeIds: string[] = []; // 用来传给 buildEventPool 防止同 run 重复

  for (let L = 0; L < totalLayers; L++) {
    const depth = Math.round(d0 + depthStep * L);
    const count = randInt(zone.nodesPerLayer[0], zone.nodesPerLayer[1], rng);
    const ids: string[] = [];

    for (let i = 0; i < count; i++) {
      const id = `node.${L}.${i}`;
      const kind = chooseLayeredNodeKind(L, totalLayers, rng, { canFreeAscend });

      let eventId: string | undefined;
      let features: NodeFeature[] | undefined;
      let preview = '';
      let zoneTag: ZoneTag = pickFrom(opts.bandTags ?? tagsForDepth(zone, depth), rng) ?? 'reef';

      if (kind === 'event') {
        const pool = buildEventPool({
          zone,
          depth,
          sanity: 100, // 生成时按 100 算；真实 sanity 在抽取那一刻可能改变可见性，但 MVP 阶段先这样
          profileFlags,
          triggeredEventIds: triggeredFakeIds,
          tagsOverride: opts.bandTags,
        });
        if (pool.length === 0) {
          // 没有匹配事件，退化为 rest
          preview = '一片空旷的水域。';
          ids.push(id);
          nodes[id] = { id, layer: L, depth, zoneTag, kind: 'rest', connectsTo: [], preview };
          continue;
        }
        const chosen = pickWeighted(pool, rng)!;
        eventId = chosen.id;
        preview = chosen.title;
        triggeredFakeIds.push(chosen.id); // 同 run 不再选
        // 多事件房间（S1）：偶尔升级成大房间（maxRoomFeatures>1 才进；缺省零额外 rng＝旧图不变）。
        const feats = maybeMultiFeatureRoom(chosen, {
          zone, depth, profileFlags, triggeredFakeIds, bandTags: opts.bandTags, rng, maxFeatures: maxRoomFeatures, chanceBonus: roomFeatureChanceBonus,
        });
        if (feats) {
          features = feats;
          eventId = undefined; // 大房间不用单 eventId：moveToNode 据 features 路由到房间菜单
          preview = roomPreview(feats.length);
        }
      } else if (kind === 'rest') {
        preview = '一片可以喘息的水域。';
      } else if (kind === 'ascent_point') {
        preview = '一道斜向上的礁脊，可以从这里上浮。';
      }

      nodes[id] = {
        id,
        layer: L,
        depth,
        zoneTag,
        kind,
        eventId,
        features,
        connectsTo: [],
        preview,
      };
      ids.push(id);
    }

    layerNodes.push(ids);
  }

  // —— 连线：每个上一层节点连到下一层 1-2 个节点 ——
  for (let L = 0; L < totalLayers - 1; L++) {
    const cur = layerNodes[L];
    const next = layerNodes[L + 1];
    for (const fromId of cur) {
      const linkCount = Math.min(next.length, randInt(1, 2, rng));
      // 随机挑 linkCount 个
      const shuffled = [...next].sort(() => rng() - 0.5);
      const links = shuffled.slice(0, linkCount);
      nodes[fromId].connectsTo = links;
    }
    // 确保下一层每个节点都至少有一个入边
    const inEdges: Record<string, number> = {};
    for (const nid of next) inEdges[nid] = 0;
    for (const fromId of cur) {
      for (const toId of nodes[fromId].connectsTo) {
        inEdges[toId] = (inEdges[toId] ?? 0) + 1;
      }
    }
    for (const [nid, deg] of Object.entries(inEdges)) {
      if (deg === 0) {
        // 找到任何一个 cur 节点，强制加一条
        const donor = pickFrom(cur, rng);
        if (!nodes[donor].connectsTo.includes(nid)) {
          nodes[donor].connectsTo.push(nid);
        }
      }
    }
  }

  // —— Corpse pass ——
  // 候选 = 中间层（跳过出发层 + 上浮口层）里非 ascent_point 的节点。
  const midCandidates = layerNodes
    .slice(1, -1)
    .flat()
    .filter((id) => nodes[id].kind !== 'ascent_point');
  placeCorpses(nodes, midCandidates, { deaths, zoneId: zone.id, targetCorpseId, corpseChance, rng });

  return {
    zoneId: zone.id,
    generatedAt: Date.now(),
    nodes,
    startNodeId: layerNodes[0][0],
  };
}

// ============================================================
// 迷路图（洞穴）—— 双向连通图：环 + 死路 + 多个最深点
// ============================================================
//
// 生成步骤：
//   1. 随机生成成树（spanning tree）——保证连通 + 自然产生死路（树叶）。父节点从"最近放置的
//      几个"里挑，使树更像蜿蜒的主水道而非星形。
//   2. 选定受保护的叶子：deepCount 个"最深点"（深度强制 = d1，且邻居更浅 → 局部极大）+ 1 个
//      "另一头的出口"（far exit, ascent_point）。受保护叶子不接弦边，保证它们维持 degree 1。
//   3. 加弦边（chord）制造环（绕回原点的回路），只连"距离相近"的非保护节点，不破坏深点/出口。
//   4. 赋深度：按到入口的树距递增（远 = 深）+ 抖动；入口最浅；最深点钉死 d1。
//   5. 赋节点类型：入口 + far exit = ascent_point；其余 event（洞里事件密度高）/ 偶尔 rest。
//   6. corpse pass：在非入口非出口节点按 depth ±10m 植入尸体。
//   7. connectsTo 双向：邻接表两边都写，玩家可回头/重访（重访不重播事件见 dive.ts::moveToNode）。

function generateMazeMap(opts: GenOpts, baseD0: number, baseD1: number): DiveMap {
  const { zone, profileFlags, rng = Math.random, deaths = [], corpseChance = 0.6, targetCorpseId, maxRoomFeatures = 1, roomFeatureChanceBonus = 0 } = opts;
  const d0 = baseD0;
  const d1 = baseD1;
  const canFreeAscend = zone.canFreeAscend !== false;

  // —— 节点数：从 zone 派生，规模与层状图相当（layerCount 6 → 12–16）——
  const minN = Math.max(8, zone.layerCount * 2);
  const maxN = minN + 4;
  const N = randInt(minN, maxN, rng);

  const adj: Set<number>[] = Array.from({ length: N }, () => new Set<number>());
  const link = (a: number, b: number) => {
    adj[a].add(b);
    adj[b].add(a);
  };

  // —— 1. 随机成树：i 接到 [i-window, i-1] 里随机一个已放置节点（偏近 → 蜿蜒主道）——
  for (let i = 1; i < N; i++) {
    const lo = Math.max(0, i - 4);
    const p = randInt(lo, i - 1, rng);
    link(i, p);
  }

  // —— 树距（hop distance from 入口 node 0），同时是 DiveNode.layer 的新语义 ——
  const dist = new Array<number>(N).fill(0);
  {
    const seen = new Array<boolean>(N).fill(false);
    const queue: number[] = [0];
    seen[0] = true;
    while (queue.length) {
      const u = queue.shift()!;
      for (const v of adj[u]) {
        if (!seen[v]) {
          seen[v] = true;
          dist[v] = dist[u] + 1;
          queue.push(v);
        }
      }
    }
  }
  const maxDist = Math.max(1, ...dist);

  // —— 2. 选受保护叶子：最深点 + far exit ——
  const leaves: number[] = [];
  for (let i = 1; i < N; i++) if (adj[i].size === 1) leaves.push(i);
  leaves.sort((a, b) => dist[b] - dist[a]); // 远的优先

  const protectedSet = new Set<number>();
  const deepCount = Math.min(leaves.length, N >= 13 ? 3 : 2);
  const deepPoints = leaves.slice(0, deepCount);
  for (const dp of deepPoints) protectedSet.add(dp);

  // far exit：另一片叶子（不与最深点重叠）；没有富余叶子时退化为最远的非保护节点
  let farExit: number | undefined = leaves.find((l) => !protectedSet.has(l));
  if (farExit === undefined) {
    let best = -1;
    let bestDist = -1;
    for (let i = 1; i < N; i++) {
      if (protectedSet.has(i)) continue;
      if (dist[i] > bestDist) {
        bestDist = dist[i];
        best = i;
      }
    }
    if (best >= 0) farExit = best;
  }
  if (farExit !== undefined) protectedSet.add(farExit);

  // —— 3. 加弦边制造环（不碰受保护叶子）——
  const nonProtected: number[] = [];
  for (let i = 0; i < N; i++) if (!protectedSet.has(i)) nonProtected.push(i);
  const targetChords = randInt(2, 3, rng);
  let chords = 0;
  let attempts = 0;
  while (chords < targetChords && attempts < N * 6 && nonProtected.length >= 2) {
    attempts++;
    const a = pickFrom(nonProtected, rng);
    const b = pickFrom(nonProtected, rng);
    if (a === b || adj[a].has(b)) continue;
    if (Math.abs(dist[a] - dist[b]) > 2) continue; // 只连距离相近的水道，回路才可信
    link(a, b);
    chords++;
  }
  // 兜底：保证至少一个环（万一上面没凑到相近的一对）
  if (chords === 0) {
    outer: for (const a of nonProtected) {
      for (const b of nonProtected) {
        if (a !== b && !adj[a].has(b)) {
          link(a, b);
          chords++;
          break outer;
        }
      }
    }
  }

  // —— 4. 赋深度（剖面曲线 frac^k＝洞型谱）——
  // k=1 走原式（逐字节复现旧图）；k≠1 时 pow 单调 ⇒ 「位置即深度」#92（起点最浅·深度随树距上升）对任意 k>0 保持。
  // jitter 的 rng 消耗每节点恒一次、与 k 无关 ⇒ 曲线只改深度值、不动结构 rng 流。
  const kCurve = resolveDepthCurve(opts);
  const depth = new Array<number>(N).fill(d0);
  const jitterRange = (d1 - d0) * 0.12;
  for (let i = 1; i < N; i++) {
    const frac = dist[i] / maxDist;
    const curved = kCurve === 1 ? frac : Math.pow(frac, kCurve);
    const jitter = (rng() * 2 - 1) * jitterRange;
    depth[i] = Math.round(clamp(d0 + (d1 - d0) * curved + jitter, d0, d1));
  }
  // 最深点钉死 d1，并把其（唯一）邻居压到更浅 → 严格局部极大
  for (const dp of deepPoints) {
    depth[dp] = d1;
    for (const nb of adj[dp]) {
      if (depth[nb] >= depth[dp]) {
        depth[nb] = clamp(depth[dp] - randInt(3, 8, rng), d0, d1 - 1);
      }
    }
  }

  // —— 5. 节点类型 + 事件抽取 ——
  const idOf = (i: number) => `node.${i}`;
  const triggeredFakeIds: string[] = [];
  const nodes: Record<string, DiveNode> = {};

  // 地标节点（气穴 / 扎营点）：从非保护内部节点里挑，给迷路的岔路 / 死路加"值得绕"的理由。
  // 它们不是事件池事件——不受洞穴内容稀薄影响；也不算 ascent_point，不动迷路结构不变量。
  const landmarkEligible: number[] = [];
  for (let i = 1; i < N; i++) if (!protectedSet.has(i)) landmarkEligible.push(i);
  const byDepthDesc = [...landmarkEligible].sort((a, b) => depth[b] - depth[a]);
  let airPocketIdx = -1;
  let campIdx = -1;
  if (byDepthDesc.length > 0 && rng() < 0.7) {
    // 气穴偏深处布点（越深越是救命）
    const deepHalf = byDepthDesc.slice(0, Math.max(1, Math.ceil(byDepthDesc.length / 2)));
    airPocketIdx = pickFrom(deepHalf, rng);
  }
  const campPool = landmarkEligible.filter((i) => i !== airPocketIdx);
  if (campPool.length > 0 && rng() < 0.5) {
    campIdx = pickFrom(campPool, rng);
  }

  for (let i = 0; i < N; i++) {
    const depthI = depth[i];
    const zoneTag: ZoneTag = pickFrom(opts.bandTags ?? tagsForDepth(zone, depthI), rng) ?? 'reef';
    let kind: NodeKind;
    let eventId: string | undefined;
    let features: NodeFeature[] | undefined;
    let preview: string;

    if (i === 0) {
      kind = 'ascent_point';
      preview = '洞口在你身后，水面的光从这里漏进来。回头还能从这儿出去。';
    } else if (i === farExit) {
      kind = 'ascent_point';
      preview = '岩壁裂开一道朝上的缝，有光渗下来——洞另一头的出口。';
    } else if (i === airPocketIdx) {
      kind = 'air_pocket';
      preview = '礁顶一道裂缝，水面在晃——像是个气穴。';
    } else if (i === campIdx) {
      kind = 'camp';
      preview = '洞壁上一处天然的窄台，刚好够卡住浮力坐下。';
    } else {
      // 洞里事件密度高；偶尔是空水道（rest）。没有匹配事件时也退化 rest。
      const wantRest = rng() < (canFreeAscend ? 0.2 : 0.15);
      if (wantRest) {
        kind = 'rest';
        preview = '一处可以稳住呼吸的水兜。';
      } else {
        const pool = buildEventPool({
          zone,
          depth: depthI,
          sanity: 100,
          profileFlags,
          triggeredEventIds: triggeredFakeIds,
          tagsOverride: opts.bandTags,
        });
        if (pool.length === 0) {
          kind = 'rest';
          preview = '一段空荡的水道，只有你的气泡声。';
        } else {
          const chosen = pickWeighted(pool, rng)!;
          kind = 'event';
          eventId = chosen.id;
          preview = chosen.title;
          triggeredFakeIds.push(chosen.id);
          // 多事件房间（S1）：洞里大房间偶尔含多个 feature（maxRoomFeatures>1 才进；缺省零额外 rng＝旧迷路图不变）。
          const feats = maybeMultiFeatureRoom(chosen, {
            zone, depth: depthI, profileFlags, triggeredFakeIds, bandTags: opts.bandTags, rng, maxFeatures: maxRoomFeatures, chanceBonus: roomFeatureChanceBonus,
          });
          if (feats) {
            features = feats;
            eventId = undefined; // 大房间不用单 eventId：moveToNode 据 features 路由到房间菜单
            preview = roomPreview(feats.length);
          }
        }
      }
    }

    nodes[idOf(i)] = {
      id: idOf(i),
      layer: dist[i], // 迷路图里 layer = 到入口的树距（深度层级近似）
      depth: depthI,
      zoneTag,
      kind,
      eventId,
      features,
      connectsTo: [...adj[i]].map(idOf), // 双向边
      preview,
    };
  }

  // —— 6. Corpse pass（迷路版）——
  // 候选 = 非入口（i!==0）、非 ascent_point 的节点。
  // 候选 = 非入口、非 ascent_point、非地标（气穴/扎营）的节点
  const corpseCandidateIds: string[] = [];
  for (let i = 1; i < N; i++) {
    const k = nodes[idOf(i)].kind;
    if (k !== 'ascent_point' && k !== 'air_pocket' && k !== 'camp') corpseCandidateIds.push(idOf(i));
  }
  placeCorpses(nodes, corpseCandidateIds, { deaths, zoneId: zone.id, targetCorpseId, corpseChance, rng });

  return {
    zoneId: zone.id,
    generatedAt: Date.now(),
    nodes,
    startNodeId: idOf(0),
  };
}

/** 获取从某节点可达的下一批节点（连通邻居；迷路图双向，含来路） */
export function getNextChoices(map: DiveMap, fromNodeId: string): DiveNode[] {
  const from = map.nodes[fromNodeId];
  if (!from) return [];
  return from.connectsTo.map((id) => map.nodes[id]).filter(Boolean);
}

// ============================================================
// 结构分析器（纯函数）—— dev 面板可视化 + mapgen 回归断言共用
// ============================================================

export interface MapAnalysis {
  nodeCount: number;
  /** 无向边数（迷路图 connectsTo 对称，按无向对去重计数） */
  edgeCount: number;
  /** 从 startNodeId 沿 connectsTo 可达的节点数 */
  reachableCount: number;
  /** 全部节点是否都从起点可达（迷路图应为 true；层状图因有孤立的同层起点节点天然 false） */
  allReachable: boolean;
  /** connectsTo 是否完全对称（双向） */
  isUndirected: boolean;
  /** 死路 = degree 1 且非 ascent_point 的节点 id（被困需回头的尽头） */
  deadEndIds: string[];
  hasDeadEnd: boolean;
  /** 独立环数 = 边 - 点 + 连通分量；>0 即存在回路 */
  cycleRank: number;
  hasCycle: boolean;
  maxDepth: number;
  /**
   * 平均深度占比：所有节点 (depth−minDepth)/(maxDepth−minDepth) 的均值（0..1·span=0 时取 0）。
   * 剖面形状的回归信号：k>1 廊+坑 → 低（大部分行程浅）；k<1 井+廊 → 高；线性 ≈ 0.5。
   */
  meanDepthFrac: number;
  /** 深度等于全图最大深度的节点 id（"最深点"） */
  deepestNodeIds: string[];
  /** 局部深度极大节点 id（depth ≥ 所有邻居 depth，degree≥1） */
  localMaximaIds: string[];
  ascentPointIds: string[];
  /** 从起点可达的 ascent_point 数 */
  reachableAscentCount: number;
  allAscentReachable: boolean;
  entranceIsAscent: boolean;
  startNodeId: string;
}

/** 分析一张 DiveMap 的结构性质（拓扑无关，层状/迷路都能跑） */
export function analyzeMap(map: DiveMap): MapAnalysis {
  const ids = Object.keys(map.nodes);
  const nodeCount = ids.length;

  // 无向邻接 + 对称性检查
  const undirected = new Map<string, Set<string>>();
  for (const id of ids) undirected.set(id, new Set());
  let isUndirected = true;
  for (const id of ids) {
    for (const to of map.nodes[id].connectsTo) {
      if (!map.nodes[to]) continue;
      undirected.get(id)!.add(to);
      undirected.get(to)!.add(id);
      // 对称性：to 是否也连回 id
      if (!map.nodes[to].connectsTo.includes(id)) isUndirected = false;
    }
  }
  let edgeCount = 0;
  for (const id of ids) edgeCount += undirected.get(id)!.size;
  edgeCount = edgeCount / 2;

  // 从起点沿 connectsTo（有向）可达
  const reachable = new Set<string>();
  {
    const stack = [map.startNodeId];
    while (stack.length) {
      const u = stack.pop()!;
      if (reachable.has(u) || !map.nodes[u]) continue;
      reachable.add(u);
      for (const v of map.nodes[u].connectsTo) if (!reachable.has(v)) stack.push(v);
    }
  }

  // 无向连通分量数（算环秩）
  let components = 0;
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) continue;
    components++;
    const stack = [id];
    while (stack.length) {
      const u = stack.pop()!;
      if (seen.has(u)) continue;
      seen.add(u);
      for (const v of undirected.get(u)!) if (!seen.has(v)) stack.push(v);
    }
  }
  const cycleRank = edgeCount - nodeCount + components;

  // 死路（degree 1 非 ascent_point）
  const deadEndIds: string[] = [];
  for (const id of ids) {
    if (undirected.get(id)!.size === 1 && map.nodes[id].kind !== 'ascent_point') {
      deadEndIds.push(id);
    }
  }

  // 深度极值 + 剖面形状信号
  let maxDepth = -Infinity;
  let minDepth = Infinity;
  for (const id of ids) {
    maxDepth = Math.max(maxDepth, map.nodes[id].depth);
    minDepth = Math.min(minDepth, map.nodes[id].depth);
  }
  const span = maxDepth - minDepth;
  const meanDepthFrac =
    span <= 0 || ids.length === 0
      ? 0
      : ids.reduce((s, id) => s + (map.nodes[id].depth - minDepth), 0) / (ids.length * span);
  const deepestNodeIds = ids.filter((id) => map.nodes[id].depth === maxDepth);
  const localMaximaIds = ids.filter((id) => {
    const nbs = undirected.get(id)!;
    if (nbs.size === 0) return false;
    const d = map.nodes[id].depth;
    for (const nb of nbs) if (map.nodes[nb].depth > d) return false;
    return true;
  });

  // ascent points + 可达性
  const ascentPointIds = ids.filter((id) => map.nodes[id].kind === 'ascent_point');
  const reachableAscent = ascentPointIds.filter((id) => reachable.has(id));

  return {
    nodeCount,
    edgeCount,
    reachableCount: reachable.size,
    allReachable: reachable.size === nodeCount,
    isUndirected,
    deadEndIds,
    hasDeadEnd: deadEndIds.length > 0,
    cycleRank,
    hasCycle: cycleRank > 0,
    maxDepth,
    meanDepthFrac,
    deepestNodeIds,
    localMaximaIds,
    ascentPointIds,
    reachableAscentCount: reachableAscent.length,
    allAscentReachable: reachableAscent.length === ascentPointIds.length,
    entranceIsAscent: map.nodes[map.startNodeId]?.kind === 'ascent_point',
    startNodeId: map.startNodeId,
  };
}
