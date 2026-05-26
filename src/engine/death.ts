// 死亡 meta-loop
// 输入：GameState + 死因 → 输出：保留 profile 的新 GameState，phase = funeral
// 主 SPEC §7.1 / §7.2

import type { GameState, DeathRecord, InventoryItem, ItemDef, DecayTier } from '@/types';
import itemsData from '@/data/items.json';
import { appendLog } from './state';

// —— 物品索引 ——
const ITEM_INDEX = new Map<string, ItemDef>(
  (itemsData as { items: ItemDef[] }).items.map((i) => [i.id, i]),
);
function getItemDef(id: string): ItemDef | undefined {
  return ITEM_INDEX.get(id);
}
function getDecayTier(id: string): DecayTier {
  return getItemDef(id)?.decay ?? 'material';
}

// —— 衰减阈值（无升级时） ——
// diveAge 达到/超过此值，对应档位的物品消失
const BASE_DECAY_THRESHOLDS: Record<DecayTier, number> = {
  organic: 2,
  consumable: 5,
  material: 12,
  durable: 25,
  eternal: Number.POSITIVE_INFINITY,
};

// —— 打捞行会升级对保鲜的加成 ——
// upgrade id → 给所有衰减阈值额外续命 N 次 run
const PRESERVATION_BONUS: Record<string, number> = {
  'upgrade.salvage_guild.lv1': 2,
  'upgrade.salvage_guild.lv2': 5,
  'upgrade.salvage_guild.lv3': 10,
};

// 海流冲走概率（每 run 每件非永恒物品）
const BASE_SWEEP_CHANCE = 0.06;
// Lv.3 完全免疫海流
const SWEEP_IMMUNITY_UPGRADE = 'upgrade.salvage_guild.lv3';

/** 计算当前的保鲜加成（来自港口升级） */
export function getPreservationBonus(unlockedUpgrades: Set<string>): number {
  let bonus = 0;
  for (const [id, b] of Object.entries(PRESERVATION_BONUS)) {
    if (unlockedUpgrades.has(id)) bonus = Math.max(bonus, b);
  }
  return bonus;
}

/** 物品是否还在尸体上（diveAge < 阈值） */
function itemSurvives(itemId: string, diveAge: number, preservationBonus: number): boolean {
  const tier = getDecayTier(itemId);
  const threshold = BASE_DECAY_THRESHOLDS[tier] + preservationBonus;
  return diveAge < threshold;
}

// 程生姓名池 —— 早期用真名营造"不同的人"
// D-reveal 触发后会被替换成玩家自己的名字（暂未实装替换逻辑）
const NAME_POOL = [
  'Marek',
  'Aleksei',
  'Tomás',
  'Petros',
  'Eitan',
  'Aksel',
  'Lior',
  'Yannis',
  'Konstantin',
  'Stelios',
  'Nadya',
  'Iva',
  'Sigrid',
  'Ásta',
  'Dmitri',
  'Vasily',
];

function pickName(seed: number): string {
  return NAME_POOL[seed % NAME_POOL.length];
}

/**
 * 死亡时调用。
 * 1) 把当前 run 快照成 DeathRecord 入 profile.deaths
 * 2) 把已有的 deaths.diveAge 全部 +1
 * 3) 按探索程度结算 buildingPoints
 * 4) run 置空，phase 切到 funeral
 */
export function executeDeath(state: GameState, cause: string): GameState {
  if (!state.run) return state;
  const run = state.run;

  const record: DeathRecord = {
    id: `death-${state.profile.deaths.length}-${run.runId}`,
    runId: run.runId,
    diverName: pickName(state.profile.deaths.length + run.runId.length),
    depthAtDeath: run.currentDepth,
    zoneId: run.zoneId,
    // zoneTag 取当前节点的 tag；找不到就用 'reef'
    zoneTag: run.map?.nodes[run.currentNodeId ?? '']?.zoneTag ?? 'reef',
    cause,
    inventorySnapshot: [...run.inventory.map((i) => ({ ...i }))],
    goldAtDeath: run.gold,
    recovered: false,
    diveAge: 0,
    timestamp: Date.now(),
  };

  // 现有死者：diveAge +1 并应用衰减
  const agedDeaths = ageAndDecayDeaths(
    state.profile.deaths,
    getPreservationBonus(state.profile.unlockedUpgrades),
    state.profile.unlockedUpgrades.has(SWEEP_IMMUNITY_UPGRADE),
  );

  // 建设值结算（跟 ascent 同公式但乘 0.6，死亡比活着回来少一些）
  const buildingPoints = Math.max(2, Math.floor(computeRawBuildingPoints(run) * 0.6));

  let s: GameState = {
    ...state,
    run: null,
    profile: {
      ...state.profile,
      deaths: [...agedDeaths, record],
      buildingPoints: state.profile.buildingPoints + buildingPoints,
      runsCompleted: state.profile.runsCompleted + 1,
    },
    phase: { kind: 'funeral', record },
  };

  s = appendLog(s, { tone: 'cosmic', text: `[${record.diverName}] 死于 ${record.depthAtDeath}m：${cause}` });
  return s;
}

function computeRawBuildingPoints(run: NonNullable<GameState['run']>): number {
  const depthCoef = Math.floor(run.currentDepth / 5);
  const nodeCoef = run.visitedNodeIds.length;
  return depthCoef + nodeCoef;
}

/** 找一具可被"本次 run 在此 zone"回收的尸体（用于 mapgen） */
export function findRecoverableCorpse(
  deaths: DeathRecord[],
  zoneId: string,
  targetDepth: number,
  alreadyPlaced: Set<string>,
): DeathRecord | undefined {
  // 同 zone，深度 ±10m，未被全部回收，diveAge 在可见区间，且本图未已经放过
  const candidates = deaths.filter(
    (d) =>
      d.zoneId === zoneId &&
      !d.recovered &&
      d.diveAge < 25 &&
      Math.abs(d.depthAtDeath - targetDepth) <= 10 &&
      !alreadyPlaced.has(d.id),
  );
  if (candidates.length === 0) return undefined;
  // 优先最老的（紧迫感）
  return candidates.sort((a, b) => b.diveAge - a.diveAge)[0];
}

/**
 * 给所有 DeathRecord 老化一年，并应用衰减规则：
 *  - 阈值衰减：物品按档位 + 升级加成判定生存
 *  - 海流冲走：每件非永恒物品有 BASE_SWEEP_CHANCE 概率被冲走（除非有免疫）
 *  - 全部消失的 record 标为 recovered（即"被海流完全冲散，下次不再生成"）
 */
export function ageAndDecayDeaths(
  deaths: DeathRecord[],
  preservationBonus: number,
  sweepImmune: boolean,
): DeathRecord[] {
  return deaths.map((d) => {
    if (d.recovered) return d;
    const newAge = d.diveAge + 1;

    // 1) 阈值衰减
    let snapshot = d.inventorySnapshot.filter((it) =>
      itemSurvives(it.itemId, newAge, preservationBonus),
    );

    // 2) 海流冲走
    if (!sweepImmune) {
      snapshot = snapshot.filter((it) => {
        if (getDecayTier(it.itemId) === 'eternal') return true;
        return Math.random() >= BASE_SWEEP_CHANCE;
      });
    }

    return {
      ...d,
      diveAge: newAge,
      inventorySnapshot: snapshot,
      recovered: snapshot.length === 0 ? true : d.recovered,
    };
  });
}

/** UI 用：当前尸体上还能看到的物品（即 snapshot，因为衰减发生在 age 时已经移除了）*/
export function decayFilter(snapshot: InventoryItem[], _diveAge: number): InventoryItem[] {
  return snapshot;
}

/** 玩家从尸体上拿走部分物品：修改 DeathRecord 的 snapshot，必要时标记 recovered */
export function recoverFromCorpse(
  state: GameState,
  recordId: string,
  itemIds: string[],
): GameState {
  if (!state.run) return state;
  const deaths = state.profile.deaths;
  const idx = deaths.findIndex((d) => d.id === recordId);
  if (idx < 0) return state;
  const record = deaths[idx];

  // 把被选物品移给玩家
  let inv = [...state.run.inventory];
  let remaining = [...record.inventorySnapshot];
  for (const itemId of itemIds) {
    const i = remaining.findIndex((it) => it.itemId === itemId);
    if (i < 0) continue;
    const it = remaining[i];
    // 全部转移
    const existing = inv.find((x) => x.itemId === itemId);
    if (existing) {
      inv = inv.map((x) => (x.itemId === itemId ? { ...x, qty: x.qty + it.qty } : x));
    } else {
      inv = [...inv, { ...it }];
    }
    remaining.splice(i, 1);
  }

  const newRecord: DeathRecord = {
    ...record,
    inventorySnapshot: remaining,
    recovered: remaining.length === 0,
  };
  const newDeaths = [...deaths];
  newDeaths[idx] = newRecord;

  return {
    ...state,
    run: { ...state.run, inventory: inv },
    profile: { ...state.profile, deaths: newDeaths },
  };
}
