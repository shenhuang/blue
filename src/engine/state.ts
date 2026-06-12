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
  SonarDir,
} from '@/types';
import { POWER_MAX, deriveSensorTuning } from './clarity';

const SAVE_VERSION = 4;

/** 家灯塔 id（守灯人 Aldo 所在的港口基地）。createInitialProfile 用。 */
export const HOME_LIGHTHOUSE_ID = 'lighthouse.home';

/**
 * 构造家灯塔——现有岸边港口（鸢尾湾，Aldo 是守灯人）的灯塔化身。
 * 坐标取海图最左的港口位（POI 在 mapX 0.18+，港口在更左）。
 * name 暂沿用 SPEC 锁定的「旧灯塔」；与出海点「旧灯塔礁」zone 同源 lore 但是不同地点——
 * 名字是 content/tunable，Phase C 灯塔上海图可见时再由作者定夺（潜在歧义已记在 NEXT_SESSION/STATUS）。
 */
export function createHomeLighthouse(): Lighthouse {
  return {
    id: HOME_LIGHTHOUSE_ID,
    name: '旧灯塔',
    mapX: 0.06,
    mapY: 0.5,
    level: 1,
    builtUpgrades: new Set(),
  };
}

export function createInitialProfile(): PlayerProfile {
  return {
    name: '潜水员',
    bankedGold: 0,
    unlockedUpgrades: new Set(),
    flags: new Set(),
    loreEntries: new Set(),
    deaths: [],
    runsCompleted: 0,
    inventory: [],
    shopStock: {},
    lighthouses: [createHomeLighthouse()],
    outpostState: {},
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
  };
}

/**
 * run 背包基础格数（升级 extraConsumableSlot 在此之上加）。抽成常量＝单一来源：
 * createNewRun 与行前装包 UI（carryCapacityFor·dive-start.ts）共用，别在 UI 里手抄 8。
 */
export const RUN_INVENTORY_CAPACITY = 8;

/** 默认起始装备配置（导师留下的装备·canon 见剧情 SPEC §2） */
export function createStarterLoadout(): EquipmentLoadout {
  return {
    tank: { itemId: 'item.tank.bluefin_mk1', slot: 'tank', level: 1 },
    suit: { itemId: 'item.suit.thermal_basic', slot: 'suit', level: 1 },
    light: { itemId: 'item.light.hand_torch', slot: 'light', level: 1 },
    tool: { itemId: 'item.dive_knife.standard', slot: 'tool', level: 1 },
    charm: null,
  };
}

export function createInitialStats(): Stats {
  return {
    stamina: 100,
    oxygen: 60, // 蓝鳍 Mk.I 基础值
    sanity: 100,
    nitrogen: 0,
  };
}

export function createNewRun(opts: {
  zoneId: string;
  inventoryCapacity?: number;
  /**
   * 从港口升级派生的全局加成（可选；脚本/测试可省略）。
   * 字段全可选，故可直接把 getRunBonuses() 的结果整个传进来（结构兼容、避免逐字段抄漏，见 dive.ts/dialog.ts）。
   */
  bonuses?: {
    oxygenMaxBonus?: number;
    staminaMaxBonus?: number;
    extraConsumableSlot?: number;
    /** 声呐能力是否已解锁（深水区 Phase 0a；省略 = 未解锁 = 早期仅有灯）。 */
    sonarUnlocked?: boolean;
    // 深水区 Phase 0 升级轨（省略 = 未升级 = 基线，行为与 0a/0b 一致）。
    powerMaxBonus?: number;
    sonarPingCostReduction?: number;
    lampEfficiency?: number;
    sonarRobustness?: number;
    lampRobustness?: number;
    signatureReduction?: number;
    lampRangeBonus?: number;
    sonarRangeBonus?: number;
    sonarScanRangeBonus?: number;
    sonarDirReach?: Record<SonarDir, number>;
    roomFeatureChanceBonus?: number;
    soundAbsorbBonus?: number;
    camoBonus?: number;
  };
}): RunState {
  const oxygenBonus = opts.bonuses?.oxygenMaxBonus ?? 0;
  const staminaBonus = opts.bonuses?.staminaMaxBonus ?? 0;
  const slotBonus = opts.bonuses?.extraConsumableSlot ?? 0;
  const sonarUnlocked = opts.bonuses?.sonarUnlocked ?? false;
  // 深水区 Phase 0 升级轨：电池总量 = 基线 + 加成；其余传感器旋钮烤成 sensorTuning（地板/上限在 deriveSensorTuning）。
  const powerMax = POWER_MAX + (opts.bonuses?.powerMaxBonus ?? 0);
  const sensorTuning = deriveSensorTuning({
    sonarPingCostReduction: opts.bonuses?.sonarPingCostReduction,
    lampEfficiency: opts.bonuses?.lampEfficiency,
    sonarRobustness: opts.bonuses?.sonarRobustness,
    lampRobustness: opts.bonuses?.lampRobustness,
    signatureReduction: opts.bonuses?.signatureReduction,
    lampRangeBonus: opts.bonuses?.lampRangeBonus,
    sonarRangeBonus: opts.bonuses?.sonarRangeBonus,
    sonarScanRangeBonus: opts.bonuses?.sonarScanRangeBonus,
    sonarDirReach: opts.bonuses?.sonarDirReach,
    roomFeatureChanceBonus: opts.bonuses?.roomFeatureChanceBonus,
    soundAbsorbBonus: opts.bonuses?.soundAbsorbBonus,
    camoBonus: opts.bonuses?.camoBonus,
  });

  const staminaMax = 100 + staminaBonus;
  const oxygenMax = 60 + oxygenBonus;
  const stats = createInitialStats();
  stats.stamina = staminaMax;
  stats.oxygen = oxygenMax;

  return {
    runId: `run-${Date.now()}`,
    zoneId: opts.zoneId,
    map: null,
    stats,
    staminaMax,
    oxygenMax,
    equipment: createStarterLoadout(),
    inventory: [],
    inventoryCapacity: (opts.inventoryCapacity ?? RUN_INVENTORY_CAPACITY) + slotBonus,
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
    // 声呐与房间 S0：声呐图记忆起手为空（全黑，只随 ping 一块块点亮）。
    scanMemory: {},
    // band 派生三旋钮的「无 band」默认（POI 下潜 / 浅水基线）；startDiveFromOutpost 按 band 覆写。
    // 必填化（CHANGELOG #107）：默认值即旧读点 `?? 1 / ?? 0 / 缺省假` 的语义，行为不变。
    bandAlertFactor: 1,
    sonarDeception: 0,
    huntEnabled: false,
    // 负伤（负伤 SPEC §3）：run 级身体债，出海无伤起步；回港随 run 销毁＝全愈。
    injuries: [],
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
export function clampStats(stats: Stats, max: { stamina: number; oxygen: number }): Stats {
  return {
    stamina: Math.max(0, Math.min(stats.stamina, max.stamina)),
    oxygen: Math.max(0, Math.min(stats.oxygen, max.oxygen)),
    sanity: Math.max(0, Math.min(stats.sanity, 100)),
    nitrogen: Math.max(0, Math.min(stats.nitrogen, 100)),
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
// 引擎/UI 读点直读（不再散落 `?? 默认`）。真条件字段（diveModifier / stalker / sensors.sonarOn…）
// 不在此列——缺席有语义（功能关 / 未触发），保持可选。

const SAVE_KEY = 'deepecho.save';

function saveReplacer(_key: string, value: unknown): unknown {
  return value instanceof Set ? { __set: Array.from(value) } : value;
}

function saveReviver(_key: string, value: unknown): unknown {
  if (
    value &&
    typeof value === 'object' &&
    Array.isArray((value as { __set?: unknown[] }).__set)
  ) {
    return new Set((value as { __set: unknown[] }).__set);
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
 * 真条件字段（diveModifier / stalker / sensors.sonarOn / sonarNext / sonarDir）不补——缺席即语义。
 * 不是迁移链：无版本分支、无形状改写；改坏形状仍走 bump 弃档。
 */
export function hydrateGameState(state: GameState): GameState {
  const profile: PlayerProfile = {
    ...state.profile,
    shopStock: state.profile.shopStock ?? {},
    outpostState: state.profile.outpostState ?? {},
  };
  if (!state.run) return { ...state, profile };
  const run = state.run;
  const powerMax = run.powerMax ?? POWER_MAX;
  return {
    ...state,
    profile,
    run: {
      ...run,
      sensors: run.sensors ?? { light: true, sonar: 'off', sonarUnlocked: false },
      power: run.power ?? powerMax,
      powerMax,
      alert: run.alert ?? 0,
      sensorTuning: run.sensorTuning ?? deriveSensorTuning({}),
      scanMemory: run.scanMemory ?? {},
      bandAlertFactor: run.bandAlertFactor ?? 1,
      sonarDeception: run.sonarDeception ?? 0,
      huntEnabled: run.huntEnabled ?? false,
      injuries: run.injuries ?? [],
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
