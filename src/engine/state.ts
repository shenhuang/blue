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
} from '@/types';

const SAVE_VERSION = 1;

export function createInitialProfile(): PlayerProfile {
  return {
    name: '潜水员',
    buildingPoints: 0,
    bankedGold: 0,
    unlockedUpgrades: new Set(),
    flags: new Set(),
    loreEntries: new Set(),
    deaths: [],
    runsCompleted: 0,
  };
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
}): RunState {
  return {
    runId: `run-${Date.now()}`,
    zoneId: opts.zoneId,
    map: null,
    stats: createInitialStats(),
    staminaMax: 100,
    oxygenMax: 60,
    equipment: createStarterLoadout(),
    inventory: [],
    inventoryCapacity: opts.inventoryCapacity ?? 8,
    gold: 0,
    currentDepth: 0,
    currentNodeId: null,
    visitedNodeIds: [],
    turn: 0,
    pendingDecompression: { requiredStops: 0, bendsRisk: 0 },
    activeFlags: new Set(),
    triggeredEventIds: [],
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
