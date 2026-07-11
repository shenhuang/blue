// 开潜入口（#106 拆分自 dive.ts）：港口 zone（startDive）/ 海图 POI（startDiveFromPoi），及出海叙事。
// 下潜路径：caveEntry 持久洞 → 普通 zone（+modifier.depthOffset/depthRange）。深度柱/band 路径已删
// （2026-07-12 随机内容层拆除·深度门经济待重做·见 TODO）——主线 beat 走 chart_pois 静态 anchor 的 story 块
// （applyStoryOpen 入潜强制开场）。

import type {
  GameState,
  RunState,
  ChartPoi,
  NodeGate,
  PlayerProfile,
  ZoneTag,
  InventoryItem,
  DiveMap,
  PersistentCave,
} from '@/types';
import { generateDiveMap, generatePersistentCaveMap, applyCaveOverlays, cavePortalsOf, caveSeededRng, caveHash } from './mapgen';
import { ensureQueenPlaced } from './warren-hunt';
import { getZone, getEventById } from './zones';
import { getCave } from './caves';
import {
  appendLog,
  createNewRun,
  countInInventory,
  removeFromInventory,
  addToInventory,
  totalRunInventoryWeight,
  RUN_CARRY_WEIGHT,
} from './state';
import { getItemDef, weightForItem } from './items';
import { isOverloaded, loadoutInsulation } from './equipment';
import { getCaveTemperature, thermalAccess } from './temperature';
import { getRunBonuses } from './lighthouses';
import { enterNodeSelection } from './dive-select';
import { tideLevel, moonPhasesElapsed } from './lunar';
import type { PoiModifier, CurrentStrength } from '@/types';

/**
 * 月相对洋流强度的升档映射（月相强度 Phase 2 · SPEC §8「有效 = POI 派生 ⊕ 月相(phase)」）。
 * 纯加法：只升档不降档（strong 不变·mild 不变·none/未设 → mild）。
 * 阈值 SPRING_TIDE_THRESHOLD·占位·defer-number-tuning。
 */
const SPRING_TIDE_THRESHOLD = 0.7; // 占位·defer-number-tuning：大潮触发线（tideLevel ∈[-1,1]·新/满月接近 1）

/**
 * 撤退/月相存档窗（蜂群 boss SPEC §9.11）：`profile.warrenHunt.lastVisitDay` 到本次开潜 `profile.day`
 * 跨过的相位边界数（`moonPhasesElapsed`）**超过**此值 ⇒ 蜂巢重新聚拢、追猎进度清零重来；
 * `≤` 此值 ⇒ 原样续上（见 startDive 内 run0 的 warrenHunt 重播种）。精确阈值留 §10 数值 tuning，
 * 单点常量集中改（别散落魔数）。
 */
const WARREN_SAVE_WINDOW_PHASES = 1; // 占位·defer-number-tuning：≤1 个相位边界内回来算「窗内」

/** 洋流升档：only goes up, never down. */
function upgradeCurrent(existing: CurrentStrength | undefined): CurrentStrength {
  if (existing === 'strong') return 'strong';
  if (existing === 'mild') return 'mild';
  return 'mild'; // 占位·defer-number-tuning：大潮新增洋流档位（目前上限 mild；可调为 strong）
}

/**
 * Phase 2 · 月相潮汐 → 潜水环境修正（SPEC §8）。
 * 纯函数·无副作用·确定性（给定 day 结果唯一）。
 * 合成规则：大潮（`tideLevel(day) ≥ SPRING_TIDE_THRESHOLD`）时升档洋流；其余字段直传 POI 原值。
 * **只升不降**（additive·不覆盖·如 POI 已设 strong，结果仍 strong）。
 * 小潮 / 非大潮阶段：原样返回——月相对洋流无额外贡献（静水）。
 */
export function lunarDiveModifier(poi: PoiModifier | undefined, day: number): PoiModifier | undefined {
  const tide = tideLevel(day);
  if (tide < SPRING_TIDE_THRESHOLD) return poi; // 小潮 / 非大潮 → 零贡献
  // 大潮：升档洋流（加法·不碰其他字段）
  return { ...poi, current: upgradeCurrent(poi?.current) };
}

/**
 * 撤退/月相存档窗（蜂群 boss SPEC §9.11）：本次开潜要不要把 `profile.warrenHunt`（离港时结转的追猎进度）
 * 接回 `run.warrenHunt`。纯函数·确定性：无结转档 → undefined（新追猎从零建，同旧行为）；有结转档 →
 * 按 `moonPhasesElapsed(lastVisitDay, currentDay)` 是否 `≤ WARREN_SAVE_WINDOW_PHASES` 二选一——
 * 窗内原样续上（roomsCleared/queenNodeId 照抄，只是形状换回 RunState 那份、不带 lastVisitDay）——**她还在你上次
 * 把她逼进的那间卵室，不必重新搜寻**（作者 2026-07-08）。
 * 窗外＝蜂巢重新聚拢 → 返回 undefined（追猎从零建，同「没有结转档」）：`queenNodeId` 一并丢弃 ⇒ 下次进洞
 * **重掷她的起始卵室、重新搜寻**（＝作者要的「完全重置」）。
 */
function resolveWarrenHuntCarry(
  carry: PlayerProfile['warrenHunt'],
  currentDay: number,
): RunState['warrenHunt'] {
  if (!carry) return undefined;
  const elapsed = moonPhasesElapsed(carry.lastVisitDay, currentDay);
  if (elapsed > WARREN_SAVE_WINDOW_PHASES) return undefined; // 窗外：蜂巢重新聚拢，追猎重来
  return {
    roomsCleared: carry.roomsCleared,
    queenNodeId: carry.queenNodeId,
    usedChambers: carry.usedChambers,
    wallDown: carry.wallDown,
  };
}

/**
 * 在港口选定 zone，开始一次下潜。
 * @param opts.depthOffset 海图 POI 深度偏移（米），透传给 mapgen 平移整图深度。
 * @param opts.targetCorpseId 打捞行会 Lv.2 出海前选定的目标尸体 id，透传给 mapgen 保证布点。
 */
export function startDive(
  state: GameState,
  zoneId: string,
  opts?: {
    depthOffset?: number;
    depthRange?: [number, number];
    /** 图规模覆盖（POI/band·平廊拉长图·#114 续）：直通 GenOpts.layerCount。 */
    layerCount?: number;
    /** 剖面曲线 k 钉死（POI 作者拍板洞型时用·缺省走 zone.depthCurveRange 按 seedKey 派生·#114）。 */
    depthCurve?: number;
    bandTags?: ZoneTag[];
    maxRoomFeatures?: number;
    targetCorpseId?: string;
    /** 洞穴一致性（声呐渲染重做 SPEC §6①·#98）：地点身份串（POI.id / band.id）→ 同地点同图。缺省回退随机。 */
    seedKey?: string;
    /**
     * roaming 专属内容（roaming POI 内容·2026-06-25）：稳定模板身份（poi.templateId）。透传给 mapgen→buildEventPool
     * 做 roaming 专属事件匹配（实例 run.poiId 每次变·配不上静态事件 poiId·故另走稳定 templateId）。
     * anchor / 深度柱 / mimic / 教学下潜缺省 undefined ⇒ 零影响（带 poiId 的事件仍只命中 run.poiId 精确匹配）。
     */
    poiTemplateId?: string;
    /**
     * 持久洞预建地图（多口持久洞 SPEC §4.1）：caveEntry 路径下潜时由 startDiveIntoCave 传入「已加载 + overlay」
     * 的图副本（startNodeId 已设为绑定入口节点）。给了 ⇒ startDive 跳过 generateDiveMap、直接用它（不再读 poiId 的
     * harvest——cave overlay 已在副本上叠加）。缺省（zone/band 路径）→ 走 generateDiveMap 每潜重生（旧行为不变）。
     */
    prebuiltMap?: DiveMap;
    /** 钉放剧情节拍（quirk #174）：weight0 故事事件 id·透传 mapgen 放到其 depthRange 途中节点。由 startDiveFromPoi 从 poi.storyOpenEvents 选合规变体填。 */
    pinnedEventId?: string;
  },
): GameState {
  const zone = getZone(zoneId);
  if (!zone) {
    console.warn(`Zone ${zoneId} not found`);
    return state;
  }
  if (!state.run) {
    console.warn('Cannot startDive without a RunState');
    return state;
  }

  // 温度入潜门控（温度系统接线·SPEC §3/§7）：进洞口前查 thermalAccess——净暴露(intensity − insulation)派生三档。
  // entry_blocked（过热/过冷封口·deficit>40）→ 不让下潜（保温=钥匙·升级保温才进得去）；full/partial 放行
  // （partial「探不全」由逐回合 thermalStress 累积 + 过阈扣体力的软门承接·见 events.ts::tickTurns）。
  // 全部下潜路径（zone/POI/band/持久洞 prebuiltMap）统一过此唯一闸（startDive 是单一汇流点）；中性洞 intensity 0 ⇒ 恒 full ⇒ 放行（逐字节不变）。
  const thermalReach = thermalAccess(
    getCaveTemperature(zoneId).intensity,
    loadoutInsulation(state.run.equipment),
  ).reach;
  if (thermalReach === 'entry_blocked') {
    return appendLog(state, {
      tone: 'system',
      text: `${zone.name}的温度太过极端——现有潜服扛不住，连洞口都靠不近。升级保温再来。`,
    });
  }

  // 固定资源耗尽（POI 固定资源耗尽·2026-06-25）：POI 下潜（run.poiId 有值·createNewRun 落）解析两层「已采尽」信息
  // 透传 mapgen——save 级（profile.harvestedResources）+ run 级（run.harvestedNodes·新 run 起手空）。
  // poiId 还驱动 buildEventPool 的 POI 专属事件门控。非 POI 下潜 → 全 undefined ⇒ mapgen 零改动 + 带 poiId 事件不进池。
  const poiId = state.run.poiId;
  const harvestedItemIds = poiId ? state.profile.harvestedResources.get(poiId) : undefined;
  const harvestedNodeIds = poiId ? state.run.harvestedNodes.get(poiId) : undefined;

  // 持久洞（§4.1）：预建图直接用、跳过每潜重生（cave overlay 已在副本上叠加·不再读 poiId harvest）。
  const map =
    opts?.prebuiltMap ??
    generateDiveMap({
      zone,
      profileFlags: state.profile.flags,
      deaths: state.profile.deaths,
      poiId,
      // 钉放剧情节拍（quirk #174）：由 startDiveFromPoi 从 poi.storyOpenEvents 选出的合规变体透传而来（缺省 undefined＝不钉放）。
      pinnedEventId: opts?.pinnedEventId,
      // roaming 专属内容（2026-06-25）：稳定模板身份直透 buildEventPool（缺省 undefined＝anchor/教学零影响）。
      poiTemplateId: opts?.poiTemplateId,
      harvestedItemIds,
      harvestedNodeIds,
      depthOffset: opts?.depthOffset,
      depthRange: opts?.depthRange,
      layerCount: opts?.layerCount,
      depthCurve: opts?.depthCurve,
      bandTags: opts?.bandTags,
      maxRoomFeatures: opts?.maxRoomFeatures,
      // 大房间出现率加成（声呐与房间 §6/§8.3 续·升级派生）：只在 maxRoomFeatures>1 的深 band 生效；缺省 0＝旧图不变。
      roomFeatureChanceBonus: state.run.sensorTuning.roomFeatureChanceBonus,
      targetCorpseId: opts?.targetCorpseId,
      // 洞穴一致性（SPEC §6①·#98）：透传地点身份串 → mapgen 据此派生确定性 rng（同地点同图）。
      seedKey: opts?.seedKey,
    });

  const run0: RunState = {
    ...state.run,
    zoneId,
    map,
    currentNodeId: map.startNodeId,
    currentDepth: map.nodes[map.startNodeId].depth,
    visitedNodeIds: [map.startNodeId],
    // 新一潜＝新一张图的全新探索：重置随上一潜带过来的「逐潜瞬时态」——声呐迷雾（scanMemory·扫描中心记忆）
    // 与猎手（stalker）。不重置会泄漏：确定性地图（同 band/POI ⇒ 同 node id·#98）下，上一潜扫过的中心会在
    // 这一潜点亮你这次没扫过的地方（作者报「一条不该亮的线」）。两者皆 run 级派生·不入存档，重置即新图新雾。
    scanMemory: {},
    stalker: undefined,
    // 撤退/月相存档窗（蜂群 boss SPEC §9.11）：把离港结转的 Warren 追猎档接回 run（窗内续上·窗外蜂巢
    // 重新聚拢清零）。没有结转档（从未打过 Warren / 已清）→ undefined，同旧行为逐字节不变。
    warrenHunt: resolveWarrenHuntCarry(state.profile.warrenHunt, state.profile.day ?? state.profile.runsCompleted),
  };

  const startNode = map.nodes[map.startNodeId];

  // 落地不自动扫（感知重做 SPEC §2.2「ping 才扫、不 ping 不扫」）：起始节点声呐 off（scanMemory 空·全黑）——
  // 想看掉进的那片洞＝落地后主动 ping 一记（付电 + 暴露）。旧「按 profile 偏好种 sonarOn/sonarNext + 落地自动扫」已删。
  let run: RunState = run0;

  // The Warren 女王落位（蜂群 boss SPEC §8/§9·三卵室追猎·作者 2026-07-08）：warren 图（有 boss 卵室节点）进洞时若
  // 追猎档没有 queenNodeId 就随机落位她 + 给三间各种初始存卵（幂等·月相窗内续追猎不重掷）。非 warren 图 no-op 且
  // 不消耗 rng（pickOne 对空数组直接返回）⇒ 既有下潜逐字节不变。
  run = ensureQueenPlaced(run);

  // 教学首潜锁上浮（教学关 node 化·#221+·SPEC 深海回响_教学关node化）：linearScripted zone 且其 scriptedStart 未见过＝首潜
  // ⇒ run.ascentLocked（isAscentBlocked 恒挡 + UI 藏自愿上浮钮 ⇒ 玩家只能沿单向图前进、靠 forceAscend 事件退出）。
  // 重访（同 zone·scriptedStart 已见 → mapgen 落普通 layered）不锁——east_reef 重访仍 free-ascend。门控与 mapgen tutorialFirstDive 同源。
  if (
    zone.generation === 'linearScripted' &&
    zone.scriptedStartEventId != null &&
    !state.profile.flags.has(`event_seen:${zone.scriptedStartEventId}`)
  ) {
    run = { ...run, ascentLocked: true };
  }

  // 教学关 / 脚本下潜：直接进入起始事件
  if (zone.generation === 'linearScripted' && startNode.eventId) {
    return {
      ...state,
      run,
      phase: { kind: 'dive', subPhase: { kind: 'event', eventId: startNode.eventId } },
    };
  }

  // 随机下潜：起始节点也是事件类型，直接进入；否则进入节点选择
  if (startNode.kind === 'event' && startNode.eventId) {
    return {
      ...state,
      run,
      phase: { kind: 'dive', subPhase: { kind: 'event', eventId: startNode.eventId } },
    };
  }

  // 否则直接显示下一节点选择
  return enterNodeSelection({ ...state, run });
}

// ── 持久多口洞下潜（多口持久洞 SPEC §4·方案 B）─────────────────────────────

/** DiveMap 深拷贝（纯数据·JSON 安全）：本潜工作副本——别改 caveMaps 里的冻结原图（§4.1）。 */
function cloneDiveMap(map: DiveMap): DiveMap {
  return JSON.parse(JSON.stringify(map)) as DiveMap;
}

/**
 * 解析 caveEntry → 入口节点 id（多口持久洞 SPEC §2.3·确定性·零 rng）：
 *   显式 entryNodeId（须命中 entrance 门户）> regionBias 筛 > mouthDepth 取最近 > 全 entrance 里 FNV(caveId::poiId) 挑。
 * 候选空（无 entrance 门户·坏数据）→ 回退 map.startNodeId 防白屏（check-cave-bindings 守门会先把这种焊成红）。
 */
function resolveCaveEntryNode(
  cave: PersistentCave,
  entry: NonNullable<ChartPoi['caveEntry']>,
  poiId: string,
): string {
  const entrances = cave.portals.filter((p) => p.kind === 'entrance');
  if (entrances.length === 0) return cave.map.startNodeId;
  if (entry.entryNodeId && entrances.some((p) => p.nodeId === entry.entryNodeId)) return entry.entryNodeId;
  let pool = entrances;
  if (entry.regionBias) {
    const biased = entrances.filter((p) => p.region === entry.regionBias);
    if (biased.length) pool = biased;
  } else if (entry.mouthDepth != null) {
    const md = entry.mouthDepth;
    pool = [entrances.reduce((best, p) => (Math.abs(p.depth - md) < Math.abs(best.depth - md) ? p : best))];
  }
  return pool[caveHash(`${entry.caveId}::${poiId}`) % pool.length].nodeId;
}

/**
 * 从 caveEntry POI 进持久洞（§4.1）：load-or-generate caveMaps[caveId] → 解析入口节点 → 本潜工作副本 + 加载 overlay
 * （尸体 + save 级采尽·by caveId）→ createNewRun(caveId) → startDive(prebuiltMap) 走统一收尾。
 * 首次进生成并冻结进 profile.caveMaps（写存档·#98 家族确定性）；再进（含换口进）加载续上次（料/尸/已探）。
 */
function startDiveIntoCave(state: GameState, poi: ChartPoi): GameState {
  const entry = poi.caveEntry!;
  const params = getCave(entry.caveId)!; // 调用方已判存在
  const zone = getZone(params.zoneId);
  if (!zone) {
    console.warn(`Cave ${entry.caveId} 的 zone ${params.zoneId} 不存在`);
    return state;
  }

  let profile = state.profile;
  let cave = profile.caveMaps.get(entry.caveId);
  if (!cave) {
    const genMap = generatePersistentCaveMap(
      { zone, profileFlags: profile.flags, rng: caveSeededRng(entry.caveId) },
      params,
    );
    cave = { caveId: entry.caveId, map: genMap, explored: new Set<string>(), portals: cavePortalsOf(genMap) };
    const caveMaps = new Map(profile.caveMaps);
    caveMaps.set(entry.caveId, cave);
    profile = { ...profile, caveMaps };
  }

  const startNodeId = resolveCaveEntryNode(cave, entry, poi.id);
  const workMap = cloneDiveMap(cave.map);
  workMap.startNodeId = startNodeId;
  applyCaveOverlays(workMap, {
    deaths: profile.deaths,
    zoneId: params.zoneId,
    rng: caveSeededRng(`${entry.caveId}::overlay`),
    harvestedItemIds: profile.harvestedResources.get(entry.caveId),
  });

  let run = createNewRun({ zoneId: params.zoneId, bonuses: getRunBonuses(profile), equipment: profile.equipment, poiId: poi.id, caveId: entry.caveId });
  run = { ...run, diveModifier: poi.modifier };
  const s: GameState = { ...state, profile, run };
  return startDive(s, params.zoneId, { prebuiltMap: workMap });
}

/**
 * 出发前选带（作者拍板 2026-06-10·#108·重量制重构 2026-06-21）：把仓库里勾选的消耗品装进 run 背包随身带下水。
 * 风险自担＝机制核心：死了随身物进尸体快照（现有 DeathRecord 回收闭环）、生还由 handleReturnToPort
 * 自动并回仓库——本函数只搬，不新增任何闭环。规则：
 *   - 只认 category === 'consumable'（材料/剧情物不随身——它们走仓库/账单面）；
 *   - qty 夹到仓库现有量；按**重量**累计、超 run.carryWeightLimit 的部分截断（先选先得·逐件试装）；
 *   - 全空 / 没选 → profile/run 原样返回（向后兼容：所有既有调用不传 picks ＝ 行为逐字节不变）。
 * 纯函数（不碰 GameState 其它部分）；UI 面在 SeaChartView 的「行前装包」。
 */
/**
 * 出发前的背包承载上限（kg·行前装包 UI 用·重量制 2026-06-21）：与 createNewRun 同一来源（RUN_CARRY_WEIGHT），
 * 保证 UI 画的承载条＝实际 run.carryWeightLimit（applyCarryItems 的截断线）。保留 profile 形参给未来
 * 「按 profile 升级加成承载」留口（当前与 profile 无关·恒 RUN_CARRY_WEIGHT）。纯函数。
 */
export function carryWeightLimitFor(_profile: PlayerProfile): number {
  return RUN_CARRY_WEIGHT;
}

export function applyCarryItems(
  profile: PlayerProfile,
  run: RunState,
  picks: InventoryItem[],
): { profile: PlayerProfile; run: RunState } {
  if (picks.length === 0) return { profile, run };
  let profileInv = profile.inventory;
  let runInv = run.inventory;
  let moved = false;
  for (const p of picks) {
    const def = getItemDef(p.itemId);
    if (!def || def.category !== 'consumable') continue;
    let q = Math.min(p.qty, countInInventory(profileInv, p.itemId));
    // 逐件削减 q 直到「现有背包重量 + 这 q 件的重量」不超承载（先选先得·截断超重部分）。
    while (q > 0 && totalRunInventoryWeight(runInv) + weightForItem(p.itemId, q) > run.carryWeightLimit) q--;
    if (q <= 0) continue;
    profileInv = removeFromInventory(profileInv, p.itemId, q);
    runInv = addToInventory(runInv, p.itemId, q);
    moved = true;
  }
  if (!moved) return { profile, run };
  return { profile: { ...profile, inventory: profileInv }, run: { ...run, inventory: runInv } };
}

/**
 * 主线 beat 的入潜强制开场（「主线柱迁移」→ 深度柱删除后 re-home 成 chart_pois 静态 anchor·2026-07-12）。
 * POI 带 story（= chart_pois.json 静态 anchor 的 story 块）⇒ 入潜强制其 eventId 作开场，
 * 直到 beatFlag 置位（节拍事件 setProfileFlags 一次性置·这里只读 flag 不写·quirk #118）；已置＝回流重访＝普通下潜。
 * 触发只看 beatFlag——「能不能下到这一档」已由 reveal 门（poiRevealState：日志 marksPois 文献坐标 → lit·
 * 没抄坐标则 hidden）在海图层挡住（startDiveFromPoi 只对 departable=lit 被调用），故这里无需再查 reach。
 * beatFlag 已置 + 带 revisit* ⇒ 留白结局重访（St2·剧情 SPEC §4.1）。缺 story ⇒ 原样返回（非主线 POI·零影响）。
 */
function applyStoryOpen(s: GameState, poi: ChartPoi): GameState {
  if (!poi.story) return s;
  if (!s.profile.flags.has(poi.story.beatFlag)) {
    return { ...s, phase: { kind: 'dive', subPhase: { kind: 'event', eventId: poi.story.eventId } } };
  }
  // 留白结局重访（beat 已完成·beatFlag 已置）：持 revisitRequiresFlag（charm_found·⟺ fulfilled-first·保证圆满在前、
  // 第一次绝不跳过）+ 未置 revisitDoneFlag（ending.blank 未达）⇒ 强制留白结局事件。只读 flag 派生、不写。
  if (poi.story.revisitEventId) {
    const reqOk = !poi.story.revisitRequiresFlag || s.profile.flags.has(poi.story.revisitRequiresFlag);
    const notDone = !poi.story.revisitDoneFlag || !s.profile.flags.has(poi.story.revisitDoneFlag);
    if (reqOk && notDone) {
      return { ...s, phase: { kind: 'dive', subPhase: { kind: 'event', eventId: poi.story.revisitEventId } } };
    }
  }
  return s;
}

/**
 * 从海图 POI 出海。封装出海前的全部准备：
 *   - createNewRun（带港口升级派生加成，与 dialog 的 startDive effect 一致）
 *   - 距离：每档 2 回合的"路上预耗氧" + 记到 run.turn（"远 = 多耗氧 / 多 turn"接口的首个实装）
 *   - diveModifier 落到 run（current / visibility 供未来 hook 读取）
 *   - depthOffset 透传 mapgen
 *   - 距离 / 洋流 / 能见度的叙事日志
 * 供 SeaChartView 调用。
 */
export function startDiveFromPoi(
  state: GameState,
  poi: ChartPoi,
  opts?: { targetCorpseId?: string; carryItems?: InventoryItem[] },
): GameState {
  // 负重过载门（武器系统·作者 2026-06-20）：穿戴件总重越界 → 拦出发（逃生阀门＝卸装即走）。
  // 单点判据 isOverloaded（与战斗全行动封锁同源）；UI 出发按钮也据此禁用（防御性双保险）。起手装＝轻·不受影响。
  if (state.profile.equipment && isOverloaded(state.profile.equipment)) {
    return appendLog(state, { tone: 'system', text: '负重过载——你几乎浮不起来。卸下些装备再出发。' });
  }

  // 持久多口洞（多口持久洞 SPEC §4.1·方案 B）：POI 带 caveEntry ⇒ 走持久洞路径（load-or-generate caveMaps[caveId]·
  // 起手 = 绑定入口节点），先于 bandId/zone 判（互斥）。caveId 未登记 → 落回下方旧路径防白屏（check-cave-bindings 守门）。
  if (poi.caveEntry && getCave(poi.caveEntry.caveId)) {
    return startDiveIntoCave(state, poi);
  }

  // 随身加成 = 全局升级 ＋ 家灯塔「船坞」设施（dockyard 迁灯塔后由 getRunBonuses 并回，见 lighthouses.ts）
  // RunStartBonuses 字段全是 createNewRun bonuses 的超集，直接整个传（含深水区 Phase 0 升级轨，避免逐字段抄漏）。
  const bonuses = getRunBonuses(state.profile);
  // POI 固定资源耗尽（2026-06-25）：落 run.poiId=poi.id（=seedKey）⇒ startDive 解析已采尽信息 + 记账按它 key。
  let run = createNewRun({ zoneId: poi.zoneId, bonuses, equipment: state.profile.equipment, poiId: poi.id });

  // 出发前选带（#108·作者拍板「不全带·死了就没」）：勾选的消耗品仓库 → run 背包。
  const carry = applyCarryItems(state.profile, run, opts?.carryItems ?? []);
  run = carry.run;

  // 作者 2026-06-14：删掉「出海更近」/距离预耗氧机制——每个潜点都从第一回合起算损耗（不再有 turn 偏移 / 路上耗气）。
  // Phase 2 · 月相：大潮叠加洋流（SPEC §8·有效 = POI 派生 ⊕ 月相(phase)·只升不降）。
  run = { ...run, diveModifier: lunarDiveModifier(poi.modifier, state.profile.day ?? state.profile.runsCompleted) };

  // 「故事重访变体」按深度途中触发（quirk #174）：从 poi.storyOpenEvents 里按各事件**自身**门控
  // （prereq/forbidden/oncePerSave event_seen/prereqEventIds）选第一个合规变体，透传 startDive→mapgen
  // 钉放到其 depthRange 的途中节点（weight 0·不进随机池·只此一途）。都走过 / 无此字段 → undefined → 普通下潜。
  // 单一真相：变体切换读事件自身 flag·POI 不重复写逻辑。东礁重访 captain_revisit→captain_revisit_empty。
  const pinnedStoryEventId = (poi.storyOpenEvents ?? []).find((id) => {
    const ev = getEventById(id);
    if (!ev) return false;
    const f = state.profile.flags;
    if (ev.oncePerSave && f.has(`event_seen:${id}`)) return false;
    if (ev.prereqFlags && !ev.prereqFlags.every((x) => f.has(x))) return false;
    if (ev.forbiddenFlags && ev.forbiddenFlags.some((x) => f.has(x))) return false;
    if (ev.prereqEventIds && !ev.prereqEventIds.every((e) => f.has(`event_seen:${e}`))) return false;
    if (ev.forbiddenEventIds && ev.forbiddenEventIds.some((e) => f.has(`event_seen:${e}`))) return false;
    return true;
  });

  let s: GameState = { ...state, profile: carry.profile, run };
  s = startDive(s, poi.zoneId, {
    pinnedEventId: pinnedStoryEventId,
    depthOffset: poi.modifier?.depthOffset,
    // 平廊/洞型 POI（#114 续）：modifier 是 GenOpts 的薄投影——窄 depthRange + 大 layerCount ＝
    // 横向洞（威胁换轴成「进来太远」的回程预算）；depthCurve 钉死剖面（缺省仍按 POI id 哈希派生性格）。
    depthRange: poi.modifier?.depthRange,
    layerCount: poi.modifier?.layerCount,
    depthCurve: poi.modifier?.depthCurve,
    targetCorpseId: opts?.targetCorpseId,
    // 洞穴一致性（SPEC §6①·#98）：POI 身份＝种子 ⇒ 同一海图点再潜＝同一张洞穴图。
    seedKey: poi.id,
    // roaming 专属内容（2026-06-25）：稳定模板身份（roaming 才有·anchor 缺省 undefined）→ buildEventPool 按它匹配。
    poiTemplateId: poi.templateId,
  });

  // Phase 2 · 月相叙事：用 run.diveModifier（= POI ⊕ 月相·已合成）做叙事判定，
  // 额外在大潮新增洋流时给出月相专属日志（区别于 POI 固有洋流日志）。
  const m = run.diveModifier; // 合成后修正（含月相升档·Phase 2 SPEC §8）
  const poiCurrent = poi.modifier?.current;
  const lunarAddedCurrent = m?.current && (!poiCurrent || poiCurrent === 'none') && m.current !== 'none';
  if (m?.current && m.current !== 'none') {
    s = appendLog(s, {
      tone: 'realistic',
      text: lunarAddedCurrent
        ? '大潮——水里多了几分莫名的涌动。' // 月相专属（POI 原本无洋流·大潮新增）
        : m.current === 'strong'
          ? '一股急流斜斜地推着你，得用力才稳得住。'
          : '水里有股缓慢的洋流。',
    });
  }
  s = appendVisibilityLog(s, m?.gate, run.sensors.sonarUnlocked);

  // 主线 beat 的「强制开场」（「主线柱迁移」→ re-home 成 chart_pois 静态 anchor·2026-07-12）：
  // POI 带 story 块 ⇒ beatFlag 未置位强制其 eventId 开场（已置＝回流重访/留白结局·单一来源 applyStoryOpen）。
  s = applyStoryOpen(s, poi);

  // 注：「故事重访变体」storyOpenEvents 不在此强制开场——改由上方 pinnedStoryEventId 透传 mapgen，
  // 钉放到事件 depthRange 的**途中**节点（下潜到该深度才撞见·quirk #174）。

  return s;
}

/**
 * 出潜时按整潜门追加叙事（感知门 SPEC·startDiveFromPoi / diveIntoBand 共用，避免文案漂移）。
 * lamp 门（黑水灯打不透）→ 提示声呐门控（有声呐能扫远 / 没声呐只能摸黑）；sonar 门（浑浊·灯没用）→ 提示扫声呐。
 * 无 gate（清水）→ 不加日志（early-return）。
 */
function appendVisibilityLog(
  s: GameState,
  gate: NodeGate | undefined,
  sonarUnlocked: boolean,
): GameState {
  if (!gate) return s;
  if (gate.sense === 'lamp') {
    s = appendLog(s, {
      tone: 'realistic',
      text: '光几乎照不进来，探照灯只够看清面前一臂。',
    });
    s = appendLog(s, {
      // 感知重做（#259/#262）：灯=诚实硬门（有灯看得清近场·没灯全黑），声呐=诚实侦察（不再「回波信不信得过」）。
      tone: 'uncanny',
      text: sonarUnlocked
        ? '（这片黑里没有灯就寸步难行。声呐能从前方探回轮廓——回波是诚实的，帮你先看清下一步。）'
        : '（这片黑里没有灯就寸步难行。你也没有能用的声呐，只能贴着石壁一点点摸过去。）',
    });
  } else {
    // sonar 门（浑浊 / 塌方只余回声 / 水搅浑…灯没用·得扫声呐·诚实揭示非欺骗）。
    s = appendLog(s, {
      tone: 'realistic',
      text: '水浑得灯照不透——光只在眼前散成一团。',
    });
    s = appendLog(s, {
      tone: 'uncanny',
      text: sonarUnlocked
        ? '（这里灯没用，得靠声呐——一记脉冲打出去，回波替你把前方的路认清。）'
        : '（这里灯没用，你也没有能用的声呐，只能贴着摸，看不清前面是什么。）',
    });
  }
  return s;
}

