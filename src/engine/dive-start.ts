// 开潜三入口（#106 拆分自 dive.ts·纯搬移）：港口 zone（startDive）/ 海图 POI（startDiveFromPoi）/
// 前哨蛙跳（startDiveFromOutpost），及出海叙事与蛙跳出潜点派生。函数体与拆分前逐字相同。

import type {
  GameState,
  RunState,
  ChartPoi,
  Visibility,
  PlayerProfile,
  ZoneTag,
  Lighthouse,
  InventoryItem,
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
import { getItemDef } from './items';
import {
  getRunBonuses,
  getHomeLighthouse,
  getLighthouse,
  getOutposts,
  OUTPOST_USABLE_STAGE,
} from './lighthouses';
import { effectiveOutpostStage, effectiveOutpostBonuses } from './outposts';
import { getBand, bandDiveModifier } from './bands';
import { effectiveDistance, MIMIC_DIVE_EVENT_ID } from './chart';
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

  const run: RunState = {
    ...state.run,
    zoneId,
    map,
    currentNodeId: map.startNodeId,
    currentDepth: map.nodes[map.startNodeId].depth,
    visitedNodeIds: [map.startNodeId],
  };

  const startNode = map.nodes[map.startNodeId];

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
  let slotsUsed = runInv.reduce((a, i) => a + (getItemDef(i.itemId)?.slotsRequired ?? 1) * i.qty, 0);
  let moved = false;
  for (const p of picks) {
    const def = getItemDef(p.itemId);
    if (!def || def.category !== 'consumable') continue;
    const per = def.slotsRequired ?? 1;
    let q = Math.min(p.qty, countInInventory(profileInv, p.itemId));
    while (q > 0 && slotsUsed + per * q > run.inventoryCapacity) q--;
    if (q <= 0) continue;
    slotsUsed += per * q;
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
  // 随身加成 = 全局升级 ＋ 家灯塔「船坞」设施（dockyard 迁灯塔后由 getRunBonuses 并回，见 lighthouses.ts）
  // RunStartBonuses 字段全是 createNewRun bonuses 的超集，直接整个传（含深水区 Phase 0 升级轨，避免逐字段抄漏）。
  const bonuses = getRunBonuses(state.profile);
  let run = createNewRun({ zoneId: poi.zoneId, bonuses });

  // 出发前选带（#108·作者拍板「不全带·死了就没」）：勾选的消耗品仓库 → run 背包。
  const carry = applyCarryItems(state.profile, run, opts?.carryItems ?? []);
  run = carry.run;

  // reach：距离按最近的已拥有灯塔算（出海预耗氧 + turn）；写死 distance 仍作 fallback（SPEC §3.4/§4）
  const dist = effectiveDistance(state.profile, poi);
  const transitOxygen = dist * 2;
  run = {
    ...run,
    diveModifier: poi.modifier,
    turn: dist,
    stats: { ...run.stats, oxygen: Math.max(1, run.stats.oxygen - transitOxygen) },
  };

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

  if (dist > 0) {
    s = appendLog(s, {
      tone: 'system',
      text: `航行至「${poi.name}」。路上耗气约 ${transitOxygen} 回合。`,
    });
  }
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
 * 比目标 band（targetOrder）更浅、且已半亮（≥ OUTPOST_USABLE_STAGE）的最深前哨蛙跳出潜点（深水区 Phase 2a）。
 * 进度读 profile.flags（outpostStage）、出潜深度＝前哨所在 band 底。没有合格前哨 → null（退回 home stand-in）。
 */
function deepestOutpostLaunch(
  profile: PlayerProfile,
  targetOrder: number,
): { name: string; launchDepth: number; lighthouse?: Lighthouse } | null {
  let best: { name: string; launchDepth: number; order: number; lighthouse?: Lighthouse } | null =
    null;
  for (const def of getOutposts()) {
    // 深水区 Phase 2b：用衰减后的**有效**阶段——荒废到半亮回退（< USABLE）的前哨会丢失蛙跳资格。
    if (effectiveOutpostStage(profile, def.id) < OUTPOST_USABLE_STAGE) continue;
    const ob = getBand(def.bandId);
    if (!ob || ob.order >= targetOrder) continue; // 前哨必须比目标更浅（不能从同层/更深起跳）
    if (!best || ob.order > best.order) {
      best = {
        name: def.name,
        launchDepth: ob.depthRange[1],
        order: ob.order,
        // 点亮的前哨才有 Lighthouse 对象（半亮未 push）→ 充电/充氧补给设施只有点亮前哨提供（深水区 Phase 2b）。
        lighthouse: getLighthouse(profile, def.result.id),
      };
    }
  }
  return best
    ? { name: best.name, launchDepth: best.launchDepth, lighthouse: best.lighthouse }
    : null;
}

/**
 * 从前哨「蛙跳」下潜到一个深度 band（深水区 Phase 1 plumbing + Phase 2a 真前哨出潜点）。镜像 startDiveFromPoi，但：
 *   - 出潜点＝前哨（**本期最小版用 home 灯塔当 stand-in**；真·最深前哨是 Phase 2）；
 *   - 目标＝一个 band：用 band 的**绝对 depthRange 覆盖** zone.depthRange（band 决定下到多深、zone 决定那里有什么）；
 *   - **软门控**：不查解锁 flag——能不能活由装备（声呐解锁 + 电池/升级，吃深料，见 quirk #60）+ 后续强敌决定。
 *     深 band 的 visibility=dark → 灯打不透 → 被迫用更耗电的声呐（间接电量压力，不加深度耗电税；作者 2026-06-03）。
 *   - 随身加成走 getRunBonuses（含 Phase 0 升级轨的 sensorTuning/powerMax）——装备越强越下得去。
 */
export function startDiveFromOutpost(
  state: GameState,
  bandId: string,
  opts?: { carryItems?: InventoryItem[] },
): GameState {
  const band = getBand(bandId);
  if (!band) {
    console.warn(`Band ${bandId} not found`);
    return state;
  }
  // 蛙跳出潜点（深水区 Phase 2a）：从**已半亮（≥ OUTPOST_USABLE_STAGE）、且比目标 band 更浅**的最深前哨起跳，
  // 起跳深度＝该前哨所在 band 底（省掉从水面到那里的下潜）。没有这样的前哨 → 退回 home 灯塔 stand-in（从水面起跳＝Phase 1 旧行为）。
  const launch = deepestOutpostLaunch(state.profile, band.order);
  const outpost = launch ? undefined : getHomeLighthouse(state.profile);
  const launchName = launch?.name ?? outpost?.name ?? '前哨';
  const launchDepth = launch?.launchDepth ?? 0;

  // 随身加成 = 全局升级 + 家灯塔船坞（getRunBonuses）+ 蛙跳出潜前哨的**在线**补给设施（深水区 Phase 2b）：
  // 充电（电池总量）/ 充氧（氧气上限）只有在能源够、且前哨没荒废到设施掉线时才计入（effectiveOutpostBonuses）。
  let bonuses = getRunBonuses(state.profile);
  if (launch?.lighthouse) {
    const ob = effectiveOutpostBonuses(state.profile, launch.lighthouse);
    bonuses = {
      ...bonuses,
      powerMaxBonus: bonuses.powerMaxBonus + ob.rechargeBonus,
      oxygenMaxBonus: bonuses.oxygenMaxBonus + ob.oxygenSupply,
    };
  }
  let run = createNewRun({ zoneId: band.zoneId, bonuses });

  // 出发前选带（#108·与 startDiveFromPoi 同一套）：勾选的消耗品仓库 → run 背包。
  const carry = applyCarryItems(state.profile, run, opts?.carryItems ?? []);
  run = carry.run;

  // 蛙跳「航行预耗氧」：按**从出潜点到 band 顶端**的深度差粗估（前哨越深起跳越省），每 20m 约一档。
  const dist = Math.max(1, Math.round((band.depthRange[0] - launchDepth) / 20));
  const transitOxygen = dist * 2;
  const m = bandDiveModifier(band);
  run = {
    ...run,
    diveModifier: m,
    // 深水区 C：band 探测压力倍率落 run（band 数据缺省 → 1＝无加压·在此落点消化，run 字段必填 #107）。
    // 越深 band 越凶，在深度因子饱和（ALERT_DEPTH_FULL）之上继续加压；摸黑/浅水消退不受倍率影响（逃生阀门不被买断）。
    bandAlertFactor: band.alertFactor ?? 1,
    // 声呐与房间 S2：band 不可信声呐失真强度落 run（band 数据缺省 → 0＝声呐相对老实·同上在落点消化）。
    // 深 band 越骗（throat/abyssal/hadal）、subhadal 回落（『把戏都停了』）；只抬低 san 失真阈值、不动其它。
    sonarDeception: band.sonarDeception ?? 0,
    // 猎手 SPEC Phase 1：本 band 是否启用「有位置的逼近猎手」（band 数据缺省 → false → moveToNode 走旧 alert→伏击瞬时路径）。
    huntEnabled: band.hunts ?? false,
    turn: dist,
    stats: { ...run.stats, oxygen: Math.max(1, run.stats.oxygen - transitOxygen) },
  };

  let s: GameState = { ...state, profile: carry.profile, run };
  // band 用绝对 depthRange 覆盖 zone.depthRange（透传 mapgen GenOpts.depthRange）。
  // band.tags（如有）覆盖 zoneTagsByDepth＝trench 专属事件池（twilight/midnight），与借来的 zone 内容隔离。
  // band.maxRoomFeatures（如有）开多事件「大房间」（声呐与房间 S1）——深段内容（C）铺在这些大房间里。
  s = startDive(s, band.zoneId, {
    depthRange: band.depthRange,
    bandTags: band.tags,
    maxRoomFeatures: band.maxRoomFeatures,
    // band.sonarDeception（如有）让 mapgen 给部分内部节点挂 spoofs/evades（节点版 mimic / 无回波，S2）。
    sonarDeception: band.sonarDeception,
    // 洞穴一致性（SPEC §6①·#98）：band 身份＝种子 ⇒ 同一 band 再蛙跳＝同一张洞穴图。
    seedKey: bandId,
  });

  s = appendLog(s, {
    tone: 'system',
    text: `自${launchName}蛙跳下潜至「${band.name}」（${band.depthRange[0]}–${band.depthRange[1]}m）。路上耗气约 ${transitOxygen} 回合。`,
  });
  s = appendVisibilityLog(s, m.visibility, run.sensors.sonarUnlocked);
  if (band.danger) {
    s = appendLog(s, { tone: 'uncanny', text: band.danger });
  }
  return s;
}
