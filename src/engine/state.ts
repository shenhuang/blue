// 游戏状态构造与基础操作
// 所有 reducer 风格函数都接受 GameState 并返回新 state（不可变）

import type {
  GameState,
  PlayerProfile,
  RunState,
  Stats,
  EquipmentLoadout,
  InventoryItem,
  LogEntry,
  Lighthouse,
  PickupBox,
} from '@/types';
import { POWER_MAX, deriveSensorTuning } from './clarity';
import { itemSetsFlags, weightForItem } from './items';
import lighthouseData from '@/data/lighthouse_upgrades.json';

// 5（#131 探深深度柱重构）：门控模型从「flag.probe.* 解锁」改档位制、旧 probe 升级 id 改 lighthouse.probe.<柱>.lv<级>、
// 深脊柱 band/前哨删——旧档残留 flag.probe.* / 旧 probe builtUpgrades / 删除前哨的阶段 flag 都已无意义。
// 未发布不写迁移（quirk #99）：版本不符 → 启动即弃旧档、从头开始。
// 5→6（#131 §10 收尾·2026-06-14）：深度柱级数/深度改定案（midwater↔trench 级数 4/6→6/4·vent 深度变·
// 海沟 t4 电梯 capstone）⇒ 派生 probe 升级 id 空间变形（midwater lv5/6 新增·trench lv5/6 作废）
// ⇒ #130 期本地档已不兼容、下次启动自动弃、从头开始。
// 7→8（前哨能源层移除·2026-06-21）：删 energyGen/energyDraw 效果 + 水力发电设施 + OutpostDef.current——
// 旧档残留 lighthouse.hydro.lv1 已无 def（getLighthouseUpgradeDef→undefined·静默跳过）；按 quirk #99 bump 弃旧档、从头开始。
// 8→9（POI 固定资源耗尽·2026-06-25）：profile.harvestedResources / run.harvestedNodes（Map<poiId,Set>）+ run.poiId 新增——
// 形状变（profile/run 多 Map 容器·序列化加 __map 分支）；按 quirk #99 不写迁移、bump 弃旧档从头开始。
// 9→10（多口持久洞·方案 B·2026-06-25）：profile.caveMaps（Map<caveId, PersistentCave{map,explored:Set,portals}>）+ run.caveId 新增——
// 形状变（profile 多一个嵌 DiveMap+Set 的 Map 容器·序列化复用 __map/__set 分支·零新代码）；按 quirk #99 不写迁移、bump 弃旧档从头开始。
// 10→11（温度系统接线·2026-06-25）：Stats 加 thermalStress（0–100·热/冷双极环境债·见 engine/temperature.ts）——
// 形状变（run.stats 多一字段）；按 quirk #99 不写迁移、bump 弃旧档从头开始（createNewRun 种默认 0）。
// 11→12（月相潮汐 Phase 0b·2026-06-26）：DeathRecord.diveAge → diedOnDay（尸体腐烂挂「天」不挂「次」·
// age = profile.day − diedOnDay 纯派生·SPEC §2.2）；形状变（reshape，非纯加字段）→ 按 quirk #99 不写迁移、bump 弃旧档。
// 12→13（感知门·2026-07-05）：diveModifier.visibility:'clear'|'dark' → diveModifier.gate?:NodeGate（灯/声呐×隐藏/锁住）——
// run.diveModifier 形状变（'dark'→{sense:'lamp',mode:'locked'}）→ 按 quirk #99 不写迁移、bump 弃旧档从头开始。
// 13→14（理智系统移除·2026-07-10）：删连续「理智」stat（run.stats 少一字段·原 0–100）+ 全套理智机制（战斗/事件/幻觉/氮醉）——
// run.stats 形状变（少一字段）→ 按 quirk #99 不写迁移、bump 弃旧档从头开始（「疯掉」改由地点缝 seam 二元门·见 types/dive.ts）。
// 14→15（战斗系统改版·2026-07-10）：Stats 加 hp（生命值·伤害落点·归零死）+ RunState 加 hpMax；负伤系统整套下线（run.injuries 删）——
// run/stats 形状变（加 hp/hpMax·减 injuries）→ 按 quirk #99 不写迁移、bump 弃旧档从头开始。体力不再致死（改行动预算）、伤害改打 HP。
// 16→17（开阔水域持久化·2026-07-17）：持久图注册表泛化更名 profile.caveMaps→diveMaps（Map<id, PersistentDiveMap>）、记录字段 caveId→id、
// run.caveId→run.diveMapId——洞穴与开阔持久海域共用一张 kind-agnostic 注册表。形状变（字段更名·非纯加）→ 按 quirk #99 不写迁移、bump 弃旧档从头开始。
// 17→18（声呐无升级化·2026-07-19）：删声呐升级轴（items.json 声呐件 upgradeSteps 整段 + sensorTuning.pingCost/sonarScanRange）
// + run.scanMemory/scanOrigins 收敛成 run.lastScanTurn?（一记 ping 全图揭示·三态全图迷雾）——
// 装备/run 形状变（旧档可能持有 Lv>1 声呐件·升级步已不存在）→ 按 quirk #99 不写迁移、bump 弃旧档从头开始。
const SAVE_VERSION = 18;

/**
 * 生命值上限基线（战斗系统改版 2026-07-10）。createNewRun 种进 run.hpMax、stats.hp 起手＝hpMax。
 * 占位数值·defer-number-tuning（作者统一调手感）。未来潜服/升级可在此之上加成（同 staminaMax/oxygenMax 模式）。
 */
export const HP_MAX = 100;

/** 家灯塔 id（守灯人 Aldo 所在的港口基地）。createInitialProfile 用。 */
export const HOME_LIGHTHOUSE_ID = 'lighthouse.home';

/**
 * 家灯塔定义（海图坐标 + 名/级）单一来源＝lighthouse_upgrades.json 顶层 `home`——与前哨/废墟同文件
 * ＝**所有 beacon 全是数据**（编辑器统一读写）。改港口位置只动那一处 JSON。
 */
const HOME_DEF = (lighthouseData as { home: { id: string; name: string; mapX: number; mapY: number; level: number } }).home;

/**
 * 家灯塔的海图「声明坐标」（静态·单一来源＝上面的 `home`）：createHomeLighthouse 与 chart owner 坐标
 * resolve（engine/lighthouses.ts::ownerAnchorPos）共用——前哨声明坐标在同文件 result，家在 `home`。
 */
export const HOME_LIGHTHOUSE_POS: { mapX: number; mapY: number } = { mapX: HOME_DEF.mapX, mapY: HOME_DEF.mapY };

/**
 * 构造家灯塔——现有岸边港口（鸢尾湾，Aldo 是守灯人）的灯塔化身。
 * 坐标取海图最左的港口位（POI 在 mapX 0.18+，港口在更左）。
 * name 暂沿用 SPEC 锁定的「旧灯塔」；与出海点「旧灯塔礁」zone 同源 lore 但是不同地点——
 * 名字是 content/tunable，Phase C 灯塔上海图可见时再由作者定夺（潜在歧义已记在 NEXT_SESSION/STATUS）。
 */
export function createHomeLighthouse(): Lighthouse {
  return {
    id: HOME_LIGHTHOUSE_ID,
    name: HOME_DEF.name,
    mapX: HOME_DEF.mapX,
    mapY: HOME_DEF.mapY,
    level: HOME_DEF.level,
    builtUpgrades: new Set(),
  };
}

export function createInitialProfile(): PlayerProfile {
  return {
    name: '潜水员',
    bankedGold: 0,
    unlockedUpgrades: new Set(),
    // 白板（2026-07-12·tutorial+ch1 主线整删）：教学关已删 ⇒ 没有内容会置 flag.tutorial_complete。
    // 全部洞穴 anchor/zone 的 requiresFlags 都挂它（海图解锁门·= chapterUnlocked('ch1')），故默认种下
    // ⇒ 新局起手海图即开、洞穴可选可潜。作者重写教学后由教学关置位、去掉这颗种子即可（单点·可逆）。
    flags: new Set(['flag.tutorial_complete']),
    loreEntries: new Set(),
    deaths: [],
    runsCompleted: 0,
    day: 0, // 月相潮汐时间（SPEC §2.1）：起步第 0 天

    inventory: [],
    shopStock: {},
    lighthouses: [createHomeLighthouse()],
    outpostState: {},
    equipment: createStarterLoadout(),
    // 固定资源永久耗尽追踪（POI 固定资源耗尽·2026-06-25）：起手空 Map（无 POI 被采尽）。
    harvestedResources: new Map(),
    // 持久 dive-target 地图注册表（开阔水域持久化·泛化自多口持久洞）：起手空 Map（还没进过任何图·首次进各自生成冻结）。
    diveMaps: new Map(),
    // 通用 NPC 信任系统（藏宝贸易与信任系统 SPEC §3·2026-06-30）：起手空表（对谁都陌生·档由 trust.ts 派生）。
    trust: {},
    // 对话选项"新/已聊"分档（对话选项面板收窄·2026-07-03）：起手空 Set（什么都没聊过）。
    seenChoices: new Set(),
  };
}

/** 合并若干 InventoryItem 到一个 inventory（同 id 累加）；纯函数 */
export function mergeIntoInventory(
  inventory: InventoryItem[],
  add: InventoryItem[]
): InventoryItem[] {
  let result = inventory;
  for (const item of add) {
    if (item.qty <= 0) continue;
    result = addToInventory(result, item.itemId, item.qty);
  }
  return result;
}

/**
 * 把若干物品并入 profile.inventory 的**统一入口**（物品入袋单点·作者 2026-06-19）。除合并库存外，
 * 还兑现被获得物品的 `story.setsFlag`——把它携带的 story flag 并入 profile.flags（sticky·幂等）。
 * 语义＝「持有那张纸＝你做过那件事」：不论从哪条路拿到带 setsFlag 的道具（回港 loot 并入 / Mira 回购 /
 * devGrantItem 作弊发物·见 engine/port.ts 三处调用）解锁逻辑都生效（如手提探照灯 → flag.owns_light）。
 * 纯函数·只「加」语义（扣减走 removeFromInventory·flag sticky 不撤）。
 */
export function acquireIntoProfile(
  profile: PlayerProfile,
  add: InventoryItem[],
): PlayerProfile {
  const inventory = mergeIntoInventory(profile.inventory, add);
  let flags: Set<string> | null = null; // copy-on-write：无新 flag 时复用原 Set（不白拷）
  for (const item of add) {
    if (item.qty <= 0) continue;
    for (const f of itemSetsFlags(item.itemId)) {
      if (profile.flags.has(f)) continue;
      if (!flags) flags = new Set(profile.flags);
      flags.add(f);
    }
  }
  return { ...profile, inventory, flags: flags ?? profile.flags };
}

/**
 * 不可变地往 `Map<string, Set<string>>` 的某 key 的 Set 里加一个值（返回新 Map·新 Set·原对象一律不动）。
 * 固定资源耗尽追踪（profile.harvestedResources / run.harvestedNodes）的**单一写入器**——别在别处手写
 * `new Map(...).set(...)`，免得 copy-on-write 漏拷出别名 bug。幂等：value 已在则原样返回（不白拷）。
 */
export function addToPoiSetMap(
  map: Map<string, Set<string>>,
  key: string,
  value: string,
): Map<string, Set<string>> {
  const existing = map.get(key);
  if (existing?.has(value)) return map;
  const next = new Map(map);
  next.set(key, new Set(existing ?? []).add(value));
  return next;
}

/** 数某个物品在 inventory 里的数量（没有则 0）；纯函数。升级账单 / Mira 回购都用它。 */
export function countInInventory(inventory: InventoryItem[], itemId: string): number {
  return inventory.find((i) => i.itemId === itemId)?.qty ?? 0;
}

/** 从 inventory 扣减一个物品；qty 不足时全部扣完；纯函数 */
export function removeFromInventory(
  inventory: InventoryItem[],
  itemId: string,
  qty: number
): InventoryItem[] {
  const out: InventoryItem[] = [];
  for (const item of inventory) {
    if (item.itemId !== itemId) {
      out.push(item);
      continue;
    }
    const remaining = item.qty - qty;
    if (remaining > 0) out.push({ ...item, qty: remaining });
  }
  return out;
}

export function createInitialGameState(): GameState {
  return {
    version: SAVE_VERSION,
    profile: createInitialProfile(),
    run: null,
    phase: { kind: 'port' },
    log: [],
    pendingPickups: [],
  };
}

/**
 * run 背包基础承载上限（kg·资源/矿物的天然节制·作者 2026-06-21 由「格数」改「重量」）。抽成常量＝单一来源：
 * createNewRun 与行前装包 UI（carryWeightLimitFor·dive-start.ts）共用，别在 UI 里手抄 15。
 * 未来可由港口升级在此之上加成（同 powerMax/oxygenMax 模式）。**这是背包承载——与 equipment.ts 的
 * 穿戴件总负重(totalLoadoutWeight/isOverloaded)是两套独立机制，别混。**
 */
export const RUN_CARRY_WEIGHT = 15;

/**
 * 背包内全部物品的合计重量（kg·按 qty 线性·矿物/弹药/消耗品同口径）。装载截断、拾取超载判定的单一来源。
 * 单件重量缺省走 weightForItem 的 `?? 0.5` 兜底。纯函数。
 */
export function totalRunInventoryWeight(inv: InventoryItem[]): number {
  return inv.reduce((sum, i) => sum + weightForItem(i.itemId, i.qty), 0);
}

/** 默认起始装备配置（导师留下的装备·canon 见剧情 SPEC §2） */
export function createStarterLoadout(): EquipmentLoadout {
  return {
    tank: { itemId: 'item.tank.bluefin_mk1', slot: 'tank', level: 1 },
    suit: { itemId: 'item.suit.thermal_basic', slot: 'suit', level: 1 },
    light: { itemId: 'item.light.hand_torch', slot: 'light', level: 1 },
    tool: { itemId: 'item.dive_knife.standard', slot: 'tool', level: 1 }, // 武器·主（近战·潜水刀）
    ranged: null, // 武器·副（暂空·未来鱼枪/发射器）
    sonar: null, // 声呐（起手没有·canon 后续解锁/获取·段2 接线）
    charm: null, // 饰品 1
    charm2: null, // 饰品 2（升级「饰品槽」解锁）
    charm3: null, // 饰品 3（升级「饰品槽」解锁）
  };
}

export function createInitialStats(): Stats {
  return {
    hp: HP_MAX, // 生命值起手满（战斗系统改版 2026-07-10·createNewRun 按 hpMax 覆写）
    stamina: 100,
    oxygen: 60, // 蓝鳍 Mk.I 基础值
    nitrogen: 0,
    thermalStress: 0, // 温度系统：起手无热应力（仅热/冷极洞累积·见 engine/temperature.ts）
  };
}

export function createNewRun(opts: {
  zoneId: string;
  /**
   * 本次下潜的 POI 身份串（POI 固定资源耗尽·2026-06-25）：固定地图 POI 下潜传 poi.id（=seedKey），
   * 固定资源耗尽记账按它做 key。非 POI 下潜（教学/港口 zone/scenario）省略 ⇒ run.poiId undefined ⇒ 不记账。
   */
  poiId?: string;
  /**
   * 本次下潜所属持久 dive-target id（开阔水域持久化·泛化自多口持久洞 §4.2）：持久路径（caveEntry 等）下潜传该图 id。
   * 出洞结算据它把 explored/harvest 写回 diveMaps[diveMapId]。非持久下潜（缺省）→ run.diveMapId undefined。
   */
  diveMapId?: string;
  /** 背包承载上限覆写（kg·缺省＝RUN_CARRY_WEIGHT·脚本/测试可调）。 */
  carryWeightLimit?: number;
  /** 来自 profile.equipment 的持久装备配置（Otto P3·缺省＝导师起始件）。 */
  equipment?: EquipmentLoadout;
  /** dev 潜点测试开关（原试玩启动器·?editor=playtest·真条件字段·仅 ephemeral 注入·不落档·不 bump SAVE·见 RunState.devFlags）。 */
  devFlags?: RunState['devFlags'];
  /**
   * 从港口升级派生的全局加成（可选；脚本/测试可省略）。
   * 字段全可选，故可直接把 getRunBonuses() 的结果整个传进来（结构兼容、避免逐字段抄漏，见 dive.ts/dialog.ts）。
   */
  bonuses?: {
    oxygenMaxBonus?: number;
    staminaMaxBonus?: number;
    /** 生命上限加成（战斗系统改版 2026-07-10）：run.hpMax = HP_MAX + 此值。未来潜服/升级 + boss 战 baseline 生存力都走它（同 staminaMaxBonus 模式）。 */
    hpMaxBonus?: number;
    /** 声呐能力是否已解锁（深水区 Phase 0a；省略 = 未解锁 = 早期仅有灯）。声呐无升级化后这是声呐唯一的加成位。 */
    sonarUnlocked?: boolean;
    // 深水区 Phase 0 升级轨（省略 = 未升级 = 基线，行为与 0a/0b 一致）。
    powerMaxBonus?: number;
    lampEfficiency?: number;
    signatureReduction?: number;
    roomFeatureChanceBonus?: number;
    soundAbsorbBonus?: number;
    camoBonus?: number;
  };
}): RunState {
  const oxygenBonus = opts.bonuses?.oxygenMaxBonus ?? 0;
  const staminaBonus = opts.bonuses?.staminaMaxBonus ?? 0;
  const sonarUnlocked = opts.bonuses?.sonarUnlocked ?? false;
  // 深水区 Phase 0 升级轨：电池总量 = 基线 + 加成；其余传感器旋钮烤成 sensorTuning（地板/上限在 deriveSensorTuning）。
  const powerMax = POWER_MAX + (opts.bonuses?.powerMaxBonus ?? 0);
  const sensorTuning = deriveSensorTuning({
    lampEfficiency: opts.bonuses?.lampEfficiency,
    signatureReduction: opts.bonuses?.signatureReduction,
    roomFeatureChanceBonus: opts.bonuses?.roomFeatureChanceBonus,
    soundAbsorbBonus: opts.bonuses?.soundAbsorbBonus,
    camoBonus: opts.bonuses?.camoBonus,
  });

  const staminaMax = 100 + staminaBonus;
  const oxygenMax = 60 + oxygenBonus;
  // 生命值上限（战斗系统改版 2026-07-10）：基线 HP_MAX + 加成（潜服/升级 + boss 战 baseline 生存力·同 stamina/oxygen 模式）。
  const hpMax = HP_MAX + (opts.bonuses?.hpMaxBonus ?? 0);
  const stats = createInitialStats();
  stats.stamina = staminaMax;
  stats.oxygen = oxygenMax;
  stats.hp = hpMax;

  return {
    runId: `run-${Date.now()}`,
    zoneId: opts.zoneId,
    // POI 固定资源耗尽（2026-06-25）：固定地图 POI 下潜带 poi.id；非 POI（缺省）→ undefined ⇒ harvest 记账 no-op。
    poiId: opts.poiId,
    // 持久 dive-target 所属（开阔水域持久化·泛化自多口持久洞）：caveEntry 等持久路径下潜带该图 id；非持久下潜（缺省）→ undefined。
    diveMapId: opts.diveMapId,
    map: null,
    stats,
    staminaMax,
    oxygenMax,
    hpMax,
    equipment: opts.equipment ?? createStarterLoadout(),
    inventory: [],
    // 背包承载上限（kg·#资源重量制 2026-06-21）。base = RUN_CARRY_WEIGHT；未来升级可在此加成（同 powerMax 模式）。
    // 未来「背包升级」可在此加成（改 carryWeightLimitFor·同 powerMax 模式）；旧 dockyard「+1格」效果已删 2026-07-10。
    carryWeightLimit: opts.carryWeightLimit ?? RUN_CARRY_WEIGHT,
    gold: 0,
    currentDepth: 0,
    currentNodeId: null,
    visitedNodeIds: [],
    turn: 0,
    pendingDecompression: { requiredStops: 0, bendsRisk: 0 },
    activeFlags: new Set(),
    triggeredEventIds: [],
    // 深水区 Phase 0a：灯默认开（清水里＝今天的"所见为真"），声呐 off + 能力按升级派生，电池满。
    sensors: { light: true, sonar: 'off', sonarUnlocked },
    power: powerMax,
    powerMax,
    sensorTuning,
    // 深水区 Phase 0b：警觉从 0 起（点灯/ping 在深水抬、摸黑降）。
    alert: 0,
    // 声呐迷雾起手全黑（lastScanTurn 真条件字段·不种——undefined＝本潜从未 ping 过·声呐无升级化 2026-07-19）。
    // band 派生旋钮的「无 band」默认（POI 下潜 / 浅水基线）；startDiveFromOutpost 按 band 覆写。
    // 必填化（CHANGELOG #107）：默认值即旧读点 `?? 1 / 缺省假` 的语义，行为不变。
    bandAlertFactor: 1,
    huntEnabled: false,
    // POI 固定资源 run 级耗尽（2026-06-25）：起手空 Map（本 run 还没采过任何点）。
    harvestedNodes: new Map(),
    // dev 潜点测试开关（真条件字段·缺省 undefined＝正常游戏·仅 ephemeral 注入·同 poiId/diveMapId 透传法）。
    devFlags: opts.devFlags,
  };
}

/** 把一个 LogEntry 追加到 state（返回新 state） */
export function appendLog(state: GameState, entry: Omit<LogEntry, 'id' | 'turn'>): GameState {
  const id = `log-${state.log.length}-${Date.now()}`;
  const turn = state.run?.turn ?? 0;
  return {
    ...state,
    log: [...state.log, { id, turn, ...entry }],
  };
}

/**
 * 获得物品提示入队（单点·见 GameState.pendingPickups）。一次「捡到东西」的动作调一次，传本次动作获得的
 * 全部物品（批量一格·不每件一弹）。空数组直接返回原 state（不入空格）。同 itemId 在本格内合并数量。
 * 队列封顶（保末 8 格·阻塞弹窗逐格出队、正常不堆积；防极端异常无限涨）。**别接「回港入库结算」**
 * （acquireIntoProfile 是把 run 背包整批搬进仓库·非新获得·会刷屏）**与「商店购买」**（Mira 已有 flash）。
 */
const PICKUP_QUEUE_CAP = 8;
export function enqueuePickup(
  state: GameState,
  items: InventoryItem[],
  source?: string,
): GameState {
  const merged: InventoryItem[] = [];
  for (const it of items) {
    if (it.qty <= 0) continue;
    const existing = merged.find((m) => m.itemId === it.itemId);
    if (existing) existing.qty += it.qty;
    else merged.push({ itemId: it.itemId, qty: it.qty });
  }
  if (merged.length === 0) return state;
  const box: PickupBox = { id: `pickup-${state.pendingPickups.length}-${Date.now()}`, items: merged, source };
  const next = [...state.pendingPickups, box];
  return { ...state, pendingPickups: next.slice(-PICKUP_QUEUE_CAP) };
}

/** 出队最前一格提示（玩家点「继续」后·UI 调）。 */
export function dismissPickup(state: GameState): GameState {
  if (state.pendingPickups.length === 0) return state;
  return { ...state, pendingPickups: state.pendingPickups.slice(1) };
}

/** 给当前 run 的 inventory 加物品 */
export function addToInventory(
  inventory: InventoryItem[],
  itemId: string,
  qty: number
): InventoryItem[] {
  const existing = inventory.find((i) => i.itemId === itemId);
  if (existing) {
    return inventory.map((i) =>
      i.itemId === itemId ? { ...i, qty: i.qty + qty } : i
    );
  }
  return [...inventory, { itemId, qty }];
}

/** clamp stats 到合理范围 */
export function clampStats(stats: Stats, max: { stamina: number; oxygen: number; hp: number }): Stats {
  return {
    hp: Math.max(0, Math.min(stats.hp, max.hp)),
    stamina: Math.max(0, Math.min(stats.stamina, max.stamina)),
    oxygen: Math.max(0, Math.min(stats.oxygen, max.oxygen)),
    nitrogen: Math.max(0, Math.min(stats.nitrogen, 100)),
    thermalStress: Math.max(0, Math.min(stats.thermalStress, 100)),
  };
}

// ============================================================
// 存档序列化 / 迁移 / 持久化
// ============================================================
//
// GameState 里有多个 Set（profile.flags / unlockedUpgrades / loreEntries、run.activeFlags），
// 朴素 JSON.stringify 会把它们序列化成 `{}`。下面用 replacer/reviver 把 Set ↔ {__set:[...]}
// 互转，整棵 state（含嵌套 Set）都能安全 round-trip。**未发布期不做存档迁移**（quirk #99）：
// 版本 ≠ 当前 SAVE_VERSION（或损坏）一律视为不兼容、丢弃；改坏 run/profile 形状想废旧档就 bump SAVE_VERSION。
//
// **纯加字段的缺省补齐收口在 hydrateGameState 单点**（CHANGELOG #107·品味评审候选③）：
// 同版本旧档缺新字段（纯加字段不 bump 的代价）→ 反序列化后一次补齐 canonical 默认，
// 引擎/UI 读点直读（不再散落 `?? 默认`）。真条件字段（diveModifier / stalker / decoy / sensors.litThisTurn…）
// 不在此列——缺席有语义（功能关 / 未触发），保持可选。

const SAVE_KEY = 'deepecho.save';

// Set ↔ {__set:[...]} 与 Map ↔ {__map:[[k,v],...]}：stringify 先 replace 再递归 ⇒ Map value 里的嵌套
// Set 仍被本 replacer 处理（如 harvestedResources: Map<poiId, Set<itemId>>）；parse 自底向上 ⇒ revive 到
// __map 时其条目里的 __set 已先 revive 成 Set。两层容器都安全 round-trip。
function saveReplacer(_key: string, value: unknown): unknown {
  if (value instanceof Set) return { __set: Array.from(value) };
  if (value instanceof Map) return { __map: Array.from(value.entries()) };
  return value;
}

function saveReviver(_key: string, value: unknown): unknown {
  if (value && typeof value === 'object') {
    const v = value as { __set?: unknown[]; __map?: [unknown, unknown][] };
    if (Array.isArray(v.__set)) return new Set(v.__set);
    if (Array.isArray(v.__map)) return new Map(v.__map);
  }
  return value;
}

export function serializeGameState(state: GameState): string {
  return JSON.stringify(state, saveReplacer);
}

/**
 * 同版本旧档的缺省补齐——**单点 hydrate**（CHANGELOG #107）。
 * 纯加字段不 bump SAVE_VERSION（quirk #99），代价是同版本旧档可能缺新字段；此前靠全引擎读点
 * `?? 默认` 兜底（dive 拆分前一文件 27 处 `?.`），现收口到这里一次补齐，读点直读、类型必填。
 * 默认值与 createNewRun / createInitialProfile 的种子一致（canonical 默认＝未升级/无 band 基线）。
 * 真条件字段（diveModifier / stalker / decoy）不补——缺席即语义。
 * 不是迁移链：无版本分支、无形状改写；改坏形状仍走 bump 弃档。
 */
export function hydrateGameState(state: GameState): GameState {
  const profile: PlayerProfile = {
    ...state.profile,
    // 月相时间（SPEC §2.1）：旧档缺 day → 单点补 day=runsCompleted（迁移前两钟相等·逐字节不变·#107）。
    day: state.profile.day ?? state.profile.runsCompleted,
    shopStock: state.profile.shopStock ?? {},
    outpostState: state.profile.outpostState ?? {},
    // 固定资源永久耗尽容器（POI 固定资源耗尽·2026-06-25）：旧档/缺失单点补空 Map（#107 同 shopStock）。
    harvestedResources: state.profile.harvestedResources ?? new Map(),
    // 持久 dive-target 地图注册表容器（开阔水域持久化·泛化自多口持久洞）：缺失单点补空 Map（同 harvestedResources·#107）。
    diveMaps: state.profile.diveMaps ?? new Map(),
    // NPC 信任容器（藏宝贸易与信任系统 SPEC §3·2026-06-30）：缺失单点补空表（同 shopStock·#107·additive 不 bump SAVE·#99）。
    trust: state.profile.trust ?? {},
    // 对话选项已聊记录（对话选项面板收窄·2026-07-03）：缺失单点补空 Set（同 trust·additive 不 bump SAVE·#99）。
    seenChoices: state.profile.seenChoices ?? new Set(),
    // 装备：缺则种起始件；已有则与起始件合并补齐「新增槽」（如 ranged·作者 2026-06-18 拆武器槽）——
    // 已穿戴槽以存档为准、缺的新槽取起始默认（null）·additive·不 bump SAVE_VERSION（#99）·旧档不作废。
    equipment: state.profile.equipment
      ? { ...createStarterLoadout(), ...state.profile.equipment }
      : createStarterLoadout(),
  };
  // 获得提示队列 transient·不从存档恢复（reload 不重弹·见 GameState.pendingPickups）：两条返回路径都强制清空。
  if (!state.run) return { ...state, profile, pendingPickups: [] };
  const run = state.run;
  const powerMax = run.powerMax ?? POWER_MAX;
  return {
    ...state,
    profile,
    pendingPickups: [],
    run: {
      ...run,
      // 旧档（格制·inventoryCapacity）→ 缺 carryWeightLimit 单点补 RUN_CARRY_WEIGHT（#资源重量制·不 bump SAVE_VERSION·quirk #99）。
      carryWeightLimit: run.carryWeightLimit ?? RUN_CARRY_WEIGHT,
      sensors: run.sensors ?? { light: true, sonar: 'off', sonarUnlocked: false },
      power: run.power ?? powerMax,
      powerMax,
      alert: run.alert ?? 0,
      sensorTuning: run.sensorTuning ?? deriveSensorTuning({}),
      // lastScanTurn 真条件字段（absent＝没扫过）·不补（同 ascentLocked/litThisTurn 族）。
      bandAlertFactor: run.bandAlertFactor ?? 1,
      huntEnabled: run.huntEnabled ?? false,
      // 固定资源 run 级耗尽容器（POI 固定资源耗尽·2026-06-25）：缺失单点补空 Map（poiId/harvestedSaveItems
      // 是真条件字段·缺席有语义·不补）。
      harvestedNodes: run.harvestedNodes ?? new Map(),
    },
  };
}

/**
 * 反序列化存档。**未发布期策略（作者 2026-06 · quirk #99）：不做存档迁移、不为兼容旧档增加任何复杂度。**
 * 版本 ≠ 当前 SAVE_VERSION（更高 / 更低 / 缺失）或 JSON 损坏一律视为不兼容 → 返回 null，
 * 调用方 clearSave 后从头开始。
 *  - 纯加字段：不必 bump（版本仍相等 · 缺失字段由 hydrateGameState 在此单点补默认）。
 *  - 改坏 run/profile 形状、想废旧档：直接 bump SAVE_VERSION，旧档下次启动自动被清——别写迁移代码。
 */
export function deserializeGameState(raw: string): GameState | null {
  try {
    const obj = JSON.parse(raw, saveReviver) as { version?: unknown } | null;
    if (!obj || typeof obj !== 'object') return null;
    if (obj.version !== SAVE_VERSION) return null; // 不兼容：不迁移、直接弃
    return hydrateGameState(obj as unknown as GameState);
  } catch {
    return null;
  }
}

/** 自动存档（localStorage；非浏览器环境 / 隐私模式 / 配额满时静默跳过，不崩游戏） */
export function saveGame(state: GameState): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(SAVE_KEY, serializeGameState(state));
  } catch {
    /* 配额满 / 隐私模式：放弃这次存档 */
  }
}

/**
 * 读存档；无 → null。**存档存在但损坏 / 版本不兼容 → 启动即删除旧档**（未发布不迁移 · quirk #99），
 * 再返回 null，调用方退回 createInitialGameState（从头开始）。
 */
export function loadGame(): GameState | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const state = deserializeGameState(raw);
    if (!state) clearSave(); // 不兼容 / 损坏：新版本启动即清掉旧档
    return state;
  } catch {
    return null;
  }
}

/** 清存档（gameOver / 真正重开时调用） */
export function clearSave(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {
    /* ignore */
  }
}
