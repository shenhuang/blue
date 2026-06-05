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
} from '@/types';
import { POWER_MAX, deriveSensorTuning } from './clarity';

const SAVE_VERSION = 4;

/** 家灯塔 id（守灯人 Aldo 所在的港口基地）。createInitialProfile + migrateSave 共用一个来源。 */
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

/** 默认起始装备配置（继承父亲的装备） */
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
    inventoryCapacity: (opts.inventoryCapacity ?? 8) + slotBonus,
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
// 互转，整棵 state（含嵌套 Set）都能安全 round-trip。migrateSave 按 version 升级旧存档；
// SAVE_VERSION 改动时在 migrateSave 的 while 里加迁移步骤。

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
 * 把存档对象迁移到当前 SAVE_VERSION。
 *  - version > 当前：存档比代码新 → 拒绝（返回 null，避免读坏）。
 *  - version < 当前：在 while 的 switch 里逐步迁移（每个 case 把 v 推进一档）。
 */
function migrateSave(obj: unknown): GameState | null {
  if (!obj || typeof obj !== 'object') return null;
  const o = obj as Record<string, unknown>;
  let v = typeof o.version === 'number' ? (o.version as number) : 0;
  if (v > SAVE_VERSION) return null;
  while (v < SAVE_VERSION) {
    switch (v) {
      case 0:
      case 1: {
        // 1→2（基建地图 Phase A · 材料经济）：移除建设值。旧点数直接丢弃，不折算成材料——
        // 内容期还早、存档量极小（决策见 SPEC §6 / §10）。
        const prof = o.profile as Record<string, unknown> | undefined;
        if (prof) delete prof.buildingPoints;
        v = 2;
        break;
      }
      case 2: {
        // 2→3（基建地图 Phase B · 灯塔数据模型）：给旧档种入 home 灯塔（缺 lighthouses 时）。
        // 注意：migrateSave 在 JSON.parse(reviver) 之后跑，此处 Set 已是真 Set，故直接 new Set()。
        const prof = o.profile as Record<string, unknown> | undefined;
        if (prof && !Array.isArray(prof.lighthouses)) {
          prof.lighthouses = [createHomeLighthouse()];
        }
        v = 3;
        break;
      }
      case 3: {
        // 3→4（基建地图 Phase C · dockyard 迁灯塔）：把已购的全局 dockyard 搬进 home 灯塔「船坞」设施
        // （lighthouse.dockyard.lv1）。reveal/reach 不入存档（从 lighthouses 派生），故只需迁这一项。
        const prof = o.profile as Record<string, unknown> | undefined;
        if (prof) {
          const unlocked = prof.unlockedUpgrades;
          const hadDockyard = unlocked instanceof Set && unlocked.has('upgrade.dockyard.lv1');
          if (unlocked instanceof Set) unlocked.delete('upgrade.dockyard.lv1');
          if (hadDockyard && Array.isArray(prof.lighthouses)) {
            const home = (prof.lighthouses as Array<Record<string, unknown>>).find(
              (l) => l && l.id === HOME_LIGHTHOUSE_ID,
            );
            if (home) {
              if (!(home.builtUpgrades instanceof Set)) home.builtUpgrades = new Set<string>();
              (home.builtUpgrades as Set<string>).add('lighthouse.dockyard.lv1');
            }
          }
        }
        v = 4;
        break;
      }
      default:
        v = SAVE_VERSION; // 没有对应迁移步骤的旧版，直接对齐
    }
  }
  o.version = SAVE_VERSION;
  return o as unknown as GameState;
}

/** 反序列化 + 迁移；损坏 / 不兼容 → null */
export function deserializeGameState(raw: string): GameState | null {
  try {
    return migrateSave(JSON.parse(raw, saveReviver));
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

/** 读存档（无 / 损坏 / 版本不兼容 → null，调用方退回 createInitialGameState） */
export function loadGame(): GameState | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    return raw ? deserializeGameState(raw) : null;
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
