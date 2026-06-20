// 开潜入口（#106 拆分自 dive.ts）：港口 zone（startDive）/ 海图 POI（startDiveFromPoi），及出海叙事。
// 旧「前哨蛙跳」startDiveFromOutpost + deepestOutpostLaunch 已删（#131 探深深度柱重构·老蛙跳废弃）——
// 深入下潜统一走 startDiveFromPoi：深度柱深入 POI 带 bandId 走 band 绝对 depthRange 路径（diveIntoBand），
// 宿主灯塔在线补给设施（充电/充氧）在此并入随身加成。

import type {
  GameState,
  RunState,
  ChartPoi,
  Visibility,
  PlayerProfile,
  ZoneTag,
  InventoryItem,
  DepthBand,
} from '@/types';
import { generateDiveMap } from './mapgen';
import { getZone } from './zones';
import {
  appendLog,
  createNewRun,
  countInInventory,
  removeFromInventory,
  addToInventory,
  RUN_INVENTORY_CAPACITY,
} from './state';
import { getItemDef, slotsForItem } from './items';
import { isOverloaded } from './equipment';
import { getRunBonuses } from './lighthouses';
import type { RunStartBonuses } from './lighthouses';
import { effectiveOutpostBonuses } from './outposts';
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

  const map = generateDiveMap({
    zone,
    profileFlags: state.profile.flags,
    deaths: state.profile.deaths,
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

/**
 * 出发前选带（作者拍板 2026-06-10·#108）：把仓库里勾选的消耗品装进 run 背包随身带下水。
 * 风险自担＝机制核心：死了随身物进尸体快照（现有 DeathRecord 回收闭环）、生还由 handleReturnToPort
 * 自动并回仓库——本函数只搬，不新增任何闭环。规则：
 *   - 只认 category === 'consumable'（材料/剧情物不随身——它们走仓库/账单面）；
 *   - qty 夹到仓库现有量；占格按 slotsRequired（默认 1）累计、超 run.inventoryCapacity 的部分截断（先选先得）；
 *   - 全空 / 没选 → profile/run 原样返回（向后兼容：所有既有调用不传 picks ＝ 行为逐字节不变）。
 * 纯函数（不碰 GameState 其它部分）；UI 面在 SeaChartView 的「行前装包」。
 */
/**
 * 出发前的背包容量（行前装包 UI 用·作者 2026-06-10「背包格子有上限、出发前可见」）：
 * 与 createNewRun 同一来源（RUN_INVENTORY_CAPACITY + extraConsumableSlot），保证 UI 画的格数
 * ＝ 实际 run.inventoryCapacity（applyCarryItems 的截断线）。纯函数。
 */
export function carryCapacityFor(profile: PlayerProfile): number {
  return RUN_INVENTORY_CAPACITY + (getRunBonuses(profile).extraConsumableSlot ?? 0);
}

export function applyCarryItems(
  profile: PlayerProfile,
  run: RunState,
  picks: InventoryItem[],
): { profile: PlayerProfile; run: RunState } {
  if (picks.length === 0) return { profile, run };
  let profileInv = profile.inventory;
  let runInv = run.inventory;
  // 占格 stack-aware（弹药一匣占一格·加发可能不增格·单一来源 items.ts::slotsForItem）：
  // 用「加上 q 后该物品新占格 − 原占格」算边际成本，对非弹药＝slotsRequired×q（逐字节不变）。
  const usedSlots = () => runInv.reduce((a, i) => a + slotsForItem(i.itemId, i.qty), 0);
  let moved = false;
  for (const p of picks) {
    const def = getItemDef(p.itemId);
    if (!def || def.category !== 'consumable') continue;
    let q = Math.min(p.qty, countInInventory(profileInv, p.itemId));
    const existing = countInInventory(runInv, p.itemId);
    const baseSlots = usedSlots() - slotsForItem(p.itemId, existing);
    while (q > 0 && baseSlots + slotsForItem(p.itemId, existing + q) > run.inventoryCapacity) q--;
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

  // 深入潜点（灯塔/蛙跳重构 step ②·#125）：POI 带 bandId ⇒ 走 band 绝对 depthRange 路径（与旧前哨蛙跳
  // 同源 diveIntoBand），预耗氧从 POI 起潜深度（band 顶）纯推·launchDepth=0·不查 deepestOutpostLaunch
  // 的前哨态。mimic / story 锚点不带 bandId、仍走下方 zone 路径；坏数据（bandId 悬空）→ 落回 zone
  // 路径防白屏（check-dive-refs step ④ 把悬空引用焊成 regress 红）。
  if (poi.bandId) {
    const band = getBand(poi.bandId);
    if (band) {
      // 随身加成 = 全局升级 + 家灯塔船坞（getRunBonuses）。深度柱深入潜点（#131·columnId 设）额外并入
      // **宿主灯塔的在线补给设施**（充电/充氧·effectiveOutpostBonuses）——你是从那座前哨下去的，
      // 它的能源设施仍然管用（老蛙跳删了·这层补给改由柱潜点承接·守「能源保留」#128）。
      let bonuses = getRunBonuses(state.profile);
      if (poi.columnId) {
        const col = getColumn(poi.columnId);
        const host = col ? state.profile.lighthouses.find((l) => l.id === col.lighthouseId) : undefined;
        if (host) {
          const ob = effectiveOutpostBonuses(host);
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
      });
    }
  }

  // 随身加成 = 全局升级 ＋ 家灯塔「船坞」设施（dockyard 迁灯塔后由 getRunBonuses 并回，见 lighthouses.ts）
  // RunStartBonuses 字段全是 createNewRun bonuses 的超集，直接整个传（含深水区 Phase 0 升级轨，避免逐字段抄漏）。
  const bonuses = getRunBonuses(state.profile);
  let run = createNewRun({ zoneId: poi.zoneId, bonuses, equipment: state.profile.equipment });

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
  },
): GameState {
  let run = createNewRun({ zoneId: band.zoneId, bonuses: opts.bonuses, equipment: state.profile.equipment });

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
