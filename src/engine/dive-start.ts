// 开潜入口（#106 拆分自 dive.ts）：港口 zone（startDive）/ 海图 POI（startDiveFromPoi），及出海叙事。
// 旧「前哨蛙跳」startDiveFromOutpost + deepestOutpostLaunch 已删（#131 探深深度柱重构·老蛙跳废弃）——
// 深入下潜统一走 startDiveFromPoi：深度柱深入 POI 带 bandId 走 band 绝对 depthRange 路径（diveIntoBand），
// 宿主灯塔补给设施（充电/充氧）在此并入随身加成。

import type {
  GameState,
  RunState,
  ChartPoi,
  Visibility,
  PlayerProfile,
  ZoneTag,
  InventoryItem,
  DepthBand,
  DiveMap,
  PersistentCave,
} from '@/types';
import { generateDiveMap, generatePersistentCaveMap, applyCaveOverlays, cavePortalsOf, caveSeededRng, caveHash } from './mapgen';
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
import { getRunBonuses, getLighthouseBonuses } from './lighthouses';
import type { RunStartBonuses } from './lighthouses';
import { getColumn } from './columns';
import { autoScanOnArrival } from './dive-sensors';
import { getBand, bandDiveModifier } from './bands';
import { MIMIC_DIVE_EVENT_ID } from './chart';
import { ch1Story, CH1_ANCHORS, type Ch1Anchor } from './story';
import { enterNodeSelection } from './dive-select';

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
    sonarDeception?: number;
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
      sonarDeception: opts?.sonarDeception,
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
  };

  const startNode = map.nodes[map.startNodeId];

  // 落地＝到站（作者拍板·所有下潜一致）：按 profile 记的声呐开关偏好种 sonarOn/sonarNext（跨 run 持久）；
  // 声呐开着 + 已解锁 → 立刻扫一记起始节点（一落地就看见掉进的那片洞）。与「到站自动扫」逐字一致：
  // 落发射态(sonar='ping')、耗一记电、从第 0 回合起就暴露；电不够则哑火转 off（autoScanOnArrival 自带）。
  const sonarPref = state.profile.sonarOn ?? true;
  let run: RunState = { ...run0, sensors: { ...run0.sensors, sonarOn: sonarPref, sonarNext: sonarPref } };
  if (run.sensors.sonarUnlocked && sonarPref) {
    run = { ...run, sensors: { ...run.sensors, sonar: 'ping' } };
    run = autoScanOnArrival({ ...state, run }).run!;
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

  // 深入潜点（灯塔/蛙跳重构 step ②·#125）：POI 带 bandId ⇒ 走 band 绝对 depthRange 路径（与旧前哨蛙跳
  // 同源 diveIntoBand），预耗氧从 POI 起潜深度（band 顶）纯推·launchDepth=0·不查 deepestOutpostLaunch
  // 的前哨态。mimic / story 锚点不带 bandId、仍走下方 zone 路径；坏数据（bandId 悬空）→ 落回 zone
  // 路径防白屏（check-dive-refs step ④ 把悬空引用焊成 regress 红）。
  if (poi.bandId) {
    const band = getBand(poi.bandId);
    if (band) {
      // 随身加成 = 全局升级 + 家灯塔船坞（getRunBonuses）。深度柱深入潜点（#131·columnId 设）额外并入
      // **宿主灯塔的补给设施**（充电/充氧）——你是从那座前哨下去的，它的补给设施管用（老蛙跳删了·
      // 这层补给改由柱潜点承接·守「能源保留」#128。能源容量门控已删·2026-06-21：设施建成即全额生效）。
      let bonuses = getRunBonuses(state.profile);
      if (poi.columnId) {
        const col = getColumn(poi.columnId);
        const host = col ? state.profile.lighthouses.find((l) => l.id === col.lighthouseId) : undefined;
        if (host) {
          const ob = getLighthouseBonuses(host);
          bonuses = {
            ...bonuses,
            powerMaxBonus: bonuses.powerMaxBonus + ob.rechargeBonus,
            oxygenMaxBonus: bonuses.oxygenMaxBonus + ob.oxygenSupply,
          };
        }
      }
      return diveIntoBand(state, band, {
        bonuses,
        carryItems: opts?.carryItems,
        seedKey: poi.id,
        poiId: poi.id,
        // roaming 专属内容（2026-06-25）：band 路径同样透传稳定模板身份（roaming 才有·anchor/柱缺省 undefined）。
        poiTemplateId: poi.templateId,
      });
    }
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
  run = { ...run, diveModifier: poi.modifier };

  let s: GameState = { ...state, profile: carry.profile, run };
  s = startDive(s, poi.zoneId, {
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

  const m = poi.modifier;
  if (m?.current && m.current !== 'none') {
    s = appendLog(s, {
      tone: 'realistic',
      text: m.current === 'strong' ? '一股急流斜斜地推着你，得用力才稳得住。' : '水里有股缓慢的洋流。',
    });
  }
  s = appendVisibilityLog(s, m?.visibility, run.sensors.sonarUnlocked);

  // 深水区 Phase 3：横渡到「无灯之光」→ 入潜兑现（§3.5）。强制把这次下潜的开场设成 mimic 兑现事件
  // （run/map 已就位，事件自身以 forceAscend 收尾＝一次性 capstone 遭遇，不靠节点池抽取、不可错过）。
  if (poi.mimic) {
    s = appendLog(s, {
      tone: 'uncanny',
      text: '你贴近那盏光。它不躲，不灭——越近越不像一座灯塔。',
    });
    s = { ...s, phase: { kind: 'dive', subPhase: { kind: 'event', eventId: MIMIC_DIVE_EVENT_ID } } };
  }

  // St1 一章锚点（剧情 SPEC §4.1·#117·沿上方 mimic「强制开场」模板）：锚点 flag 未置位
  // （vent=结局分歧·额外要求其余三锚点齐）→ 开场设成锚点节拍事件；否则普通下潜＝回流
  // 重访自然成立（任意顺序·作者拍 2026-06-12）。置位归事件 setProfileFlags（quirk #118·
  // 这里只读 ch1Story 派生，不写任何 flag）。
  if (poi.story && (CH1_ANCHORS as readonly string[]).includes(poi.story.anchor)) {
    const anchor = poi.story.anchor as Ch1Anchor;
    const st = ch1Story(s.profile);
    const anchorDone = st.anchorsDone.includes(anchor);
    const ventReady =
      anchor !== 'vent' ||
      CH1_ANCHORS.filter((a) => a !== 'vent').every((a) => st.anchorsDone.includes(a));
    if (!anchorDone && ventReady) {
      s = appendLog(s, { tone: 'system', text: '日志上的坐标，就在这片水下面。' });
      s = {
        ...s,
        phase: { kind: 'dive', subPhase: { kind: 'event', eventId: poi.story.eventId } },
      };
    } else if (anchorDone && poi.story.revisitEventId) {
      // 留白结局重访（St2·剧情 SPEC §4.1·镜像上方锚点强制块）：锚点**已完成**（圆满已达）+ 持有
      // revisitRequiresFlag（破损饰品 charm_found·⟺ fulfilled-first·保证圆满在前、第一次绝不跳过留白）+
      // 未置 revisitDoneFlag（ending.blank 未达）⇒ 入潜强制留白结局事件。破损饰品「稳住幻象一拍」的真·
      // 抵消能力 + 二章宝石材料修复留二章（机制按需长出·剧情 SPEC §4.4）；这里同上只读 flag 派生、不写。
      const reqOk = !poi.story.revisitRequiresFlag || s.profile.flags.has(poi.story.revisitRequiresFlag);
      const notDone = !poi.story.revisitDoneFlag || !s.profile.flags.has(poi.story.revisitDoneFlag);
      if (reqOk && notDone) {
        s = {
          ...s,
          phase: { kind: 'dive', subPhase: { kind: 'event', eventId: poi.story.revisitEventId } },
        };
      }
    }
  }

  // 通用脚本剧情潜点的「强制开场」（#137 鲸落找寻潜点·镜像上方 mimic/story 锚点模板，但不占 4 锚点名额）：
  // POI 带 openEventId ⇒ 入潜强制此事件作为开场，直到 openEventFlag 置位（一次性·置位归事件 setProfileFlags·
  // 这里只读 flag 不写）。owner-less / 非锚点剧情潜点用它（找寻＝openEventFlag: whalefall_found·找到即不再强制）。
  if (poi.openEventId && (!poi.openEventFlag || !s.profile.flags.has(poi.openEventFlag))) {
    s = {
      ...s,
      phase: { kind: 'dive', subPhase: { kind: 'event', eventId: poi.openEventId } },
    };
  }

  // 「故事重访变体」强制开场（types/chart.ts ChartPoi.storyOpenEvents·quirk #174）：POI 带 storyOpenEvents ⇒
  // 按**顺序**选第一个「门控通过且未见过」的事件强制开场（变体随进度切换·如教学后重返东礁老沉船＝
  // captain_revisit〔没见怪相·可下去〕→ captain_revisit_empty〔见过了·空了〕→ 都走过则普通下潜）。
  // 门控读各事件**自身**的 prereqFlags/forbiddenFlags/oncePerSave(event_seen)/prereqEventIds（单一真相·POI 不重复写）。
  // 纯读 profile·不写 flag（置位归事件 setProfileFlags·同上方强制开场）。与 openEventId 互斥（剧情开场优先）。
  if (!poi.openEventId && poi.storyOpenEvents && poi.storyOpenEvents.length > 0) {
    const flags = s.profile.flags;
    const pick = poi.storyOpenEvents.find((id) => {
      const ev = getEventById(id);
      if (!ev) return false;
      if (ev.oncePerSave && flags.has(`event_seen:${id}`)) return false;
      if (ev.prereqFlags && !ev.prereqFlags.every((f) => flags.has(f))) return false;
      if (ev.forbiddenFlags && ev.forbiddenFlags.some((f) => flags.has(f))) return false;
      if (ev.prereqEventIds && !ev.prereqEventIds.every((e) => flags.has(`event_seen:${e}`))) return false;
      return true;
    });
    if (pick) {
      s = { ...s, phase: { kind: 'dive', subPhase: { kind: 'event', eventId: pick } } };
    }
  }

  // 「材料刷点」范式（P1-2·types/chart.ts ChartPoi.openEventPool）：POI 带 openEventPool ⇒ 入潜从池里
  // **轮替**取一个开场事件——rotation by runsCompleted（每潜递进 ⇒ 反复来刷时每次不同 beat·"能刷但别
  // 反复同一段剧情"），确定性 ⇒ 可被 playthrough-farm-poi 钉死。纯读 profile·不写 flag（同上方强制开场）。
  // 与 openEventId 互斥（check-farm-pois 守门）；这里加 `!poi.openEventId` 兜底＝剧情强制开场优先于刷点轮替。
  if (!poi.openEventId && !poi.storyOpenEvents && poi.openEventPool && poi.openEventPool.length > 0) {
    const pool = poi.openEventPool;
    const idx = ((state.profile.runsCompleted % pool.length) + pool.length) % pool.length;
    s = {
      ...s,
      phase: { kind: 'dive', subPhase: { kind: 'event', eventId: pool[idx] } },
    };
  }
  return s;
}

/**
 * 出潜时按能见度追加叙事（startDiveFromPoi / startDiveFromOutpost 共用，避免文案漂移）。
 * 黑水里灯打不透 → 提示声呐门控（深水区 Phase 0a：有声呐能扫远但回波不可信 / 没声呐只能摸黑）。
 */
function appendVisibilityLog(
  s: GameState,
  visibility: Visibility | undefined,
  sonarUnlocked: boolean,
): GameState {
  if (!visibility || visibility === 'clear') return s;
  s = appendLog(s, {
    tone: 'realistic',
    text:
      visibility === 'dark'
        ? '光几乎照不进来，探照灯只够看清面前一臂。'
        : '悬浮物把光散成一团白，看不远。',
  });
  if (visibility === 'dark') {
    s = appendLog(s, {
      tone: 'uncanny',
      text: sonarUnlocked
        ? '（灯吃不透这片黑。也许声呐还能从前方探回点轮廓——只是回波信不信得过，另说。）'
        : '（灯吃不透这片黑。你没有能用的声呐，只能贴着石壁一点点摸过去。）',
    });
  }
  return s;
}

/**
 * band 下潜核心（#131 后唯一调用方＝startDiveFromPoi 的 bandId/深度柱分支）：给定一个 band + 预算
 * （bonuses / carryItems / seedKey），用 band 的**绝对 depthRange** 覆盖 zone、落 band 的探测压力 /
 * 声呐失真 / 猎手 run 字段、透传 band.tags / maxRoomFeatures 进 mapgen，并发出下潜叙事。
 * 每潜从第一回合起算损耗（#128 删距离预耗氧·run.turn=0 满氧起手）——无 launchDepth/出潜点概念了。
 */
function diveIntoBand(
  state: GameState,
  band: DepthBand,
  opts: {
    bonuses: RunStartBonuses;
    carryItems?: InventoryItem[];
    seedKey: string;
    /** POI 固定资源耗尽（2026-06-25）：本次深入潜点的 POI id（=seedKey）→ 落 run.poiId 供耗尽记账。 */
    poiId?: string;
    /** roaming 专属内容（2026-06-25）：稳定模板身份（roaming 才有）→ buildEventPool 匹配；anchor/柱缺省 undefined＝零影响。 */
    poiTemplateId?: string;
  },
): GameState {
  let run = createNewRun({ zoneId: band.zoneId, bonuses: opts.bonuses, equipment: state.profile.equipment, poiId: opts.poiId });

  // 出发前选带（#108·与 startDiveFromPoi 同一套）：勾选的消耗品仓库 → run 背包。
  const carry = applyCarryItems(state.profile, run, opts.carryItems ?? []);
  run = carry.run;

  // 作者 2026-06-14：删掉距离预耗氧——从第一回合起算损耗（无 turn 偏移 / 路上耗气；与 startDiveFromPoi 同口径）。
  const m = bandDiveModifier(band);
  run = {
    ...run,
    diveModifier: m,
    // 深水区 C：band 探测压力倍率落 run（band 数据缺省 → 1＝无加压·run 字段必填 #107）。
    // 越深 band 越凶，在深度因子饱和（ALERT_DEPTH_FULL）之上继续加压；摸黑/浅水消退不受倍率影响（逃生阀门不被买断）。
    bandAlertFactor: band.alertFactor ?? 1,
    // 声呐与房间 S2：band 不可信声呐失真强度落 run（band 数据缺省 → 0＝声呐相对老实）。
    sonarDeception: band.sonarDeception ?? 0,
    // 猎手 SPEC Phase 1：本 band 是否启用「有位置的逼近猎手」（band 数据缺省 → false → moveToNode 走旧 alert→伏击瞬时路径）。
    huntEnabled: band.hunts ?? false,
  };

  let s: GameState = { ...state, profile: carry.profile, run };
  // band 用绝对 depthRange 覆盖 zone.depthRange（透传 mapgen GenOpts.depthRange）。
  // band.tags（如有）覆盖 zoneTagsByDepth＝专属事件池（twilight/midnight），与借来的 zone 内容隔离。
  // band.maxRoomFeatures（如有）开多事件「大房间」（声呐与房间 S1）——深段内容（C）铺在这些大房间里。
  s = startDive(s, band.zoneId, {
    depthRange: band.depthRange,
    bandTags: band.tags,
    maxRoomFeatures: band.maxRoomFeatures,
    // band.sonarDeception（如有）让 mapgen 给部分内部节点挂 spoofs/evades（节点版 mimic / 无回波，S2）。
    sonarDeception: band.sonarDeception,
    // 洞穴一致性（SPEC §6①·#98）：调用方给定身份串（蛙跳＝bandId / 深入 POI＝poi.id）⇒ 同地点同图。
    seedKey: opts.seedKey,
    // roaming 专属内容（2026-06-25）：透传稳定模板身份（roaming 才有·anchor/柱缺省 undefined＝零影响）。
    poiTemplateId: opts.poiTemplateId,
  });

  s = appendLog(s, {
    tone: 'system',
    text: `下潜至「${band.name}」（${band.depthRange[0]}–${band.depthRange[1]}m）。`,
  });
  s = appendVisibilityLog(s, m.visibility, run.sensors.sonarUnlocked);
  if (band.danger) {
    s = appendLog(s, { tone: 'uncanny', text: band.danger });
  }
  return s;
}
