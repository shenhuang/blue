// 死亡 meta-loop
// 输入：GameState + 死因 → 输出：保留 profile 的新 GameState，phase = funeral
// 主 SPEC §7.1 / §7.2

import type { GameState, DeathRecord, DecayTier } from '@/types';
import { appendLog } from './state';
import { getItemDef } from './items';
import { hashString } from './rng';

function getDecayTier(id: string): DecayTier {
  return getItemDef(id)?.decay ?? 'material';
}

// —— 衰减阈值（无升级时·单位＝天·SPEC §2.2「腐烂挂天不挂次」） ——
// age（天）达到/超过此值，对应档位的物品消失。数值仍是占位、待作者统一调（defer-number-tuning·SPEC §11）。
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

// 海流冲走的「每天」基率（喂给确定性累积谓词 deterministicSwept·非每潜随机·占位待调·SPEC §11）
const BASE_SWEEP_CHANCE = 0.06;
// Lv.3 完全免疫海流
const SWEEP_IMMUNITY_UPGRADE = 'upgrade.salvage_guild.lv3';

// 尸体在海底"还能被找到"的最大 age（天·超过则视作彻底散失·收口进 recovered·见 ageAndDecayDeaths）
const CORPSE_VISIBLE_AGE = 25;

/** 计算当前的保鲜加成（来自港口升级） */
export function getPreservationBonus(unlockedUpgrades: Set<string>): number {
  let bonus = 0;
  for (const [id, b] of Object.entries(PRESERVATION_BONUS)) {
    if (unlockedUpgrades.has(id)) bonus = Math.max(bonus, b);
  }
  return bonus;
}

/** 物品是否还在尸体上（age 天 < 阈值） */
function itemSurvives(itemId: string, age: number, preservationBonus: number): boolean {
  const tier = getDecayTier(itemId);
  const threshold = BASE_DECAY_THRESHOLDS[tier] + preservationBonus;
  return age < threshold;
}

/**
 * 海流是否已在 age 天内冲走某件物品：确定性、随 age 单调置真的谓词（取代旧的「每潜 Math.random」）。
 * u = hashString(`deathId|itemId`)/2³² ∈ [0,1)；累积冲走概率 = 1 − (1−p)^age（与旧每潜 p 模型同期望）。
 * 单调 ⇒ 一旦冲走永不复现 ⇒「跳到第 N 天」≡「逐天走 N 次」（SPEC §7 jump≡step·路径无关·去不可测随机）。
 * 注：同 (deathId,itemId) 的多件同物共命运（按 SPEC §2.2 键，不区分 entry）。
 */
function deterministicSwept(deathId: string, itemId: string, age: number): boolean {
  if (age <= 0) return false;
  const u = hashString(`${deathId}|${itemId}`) / 0x100000000;
  return u < 1 - Math.pow(1 - BASE_SWEEP_CHANCE, age);
}

/** 尸体年龄（天）＝ 纯派生 day − diedOnDay。给 UI/读点用（取代旧存储 diveAge）。 */
export function corpseAge(record: DeathRecord, day: number): number {
  return day - record.diedOnDay;
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
 * 「疯狂上浮」死因常量（旧连续「理智」轴的收束死因·现由地点缝 seam 门复用·quirk #99 无迁移）：
 * 进入未持 bypassCapability 能力的 seam 节点即以此死因 executeDeath（见 dive-move.ts::moveToNode）。
 * 单一来源——别再在别处内联该字面量。
 */
export const MADNESS_ASCENT_CAUSE = '理智崩溃，疯狂上浮';

/**
 * 死亡时调用。
 * 1) 把当前 run 快照成 DeathRecord 入 profile.deaths（diedOnDay = 当天·age 纯派生）
 * 2) 把已有 deaths 老化到当天（按 diedOnDay 派生 age·SPEC §2.2）
 * 3) run 置空，phase 切到 funeral
 *
 * 注：元进度已从"建设值"换成"材料经济"（基建地图 SPEC Phase A）——死亡不再发放任何点数，
 * 玩家的进度来自带回港口的材料本身。
 */
export function executeDeath(state: GameState, cause: string): GameState {
  if (!state.run) return state;
  const run = state.run;
  // 月相时间：死亡也算过了一天（SPEC §2.1）。新尸体 diedOnDay = 当天 ⇒ 此刻 age=0。
  const newDay = (state.profile.day ?? state.profile.runsCompleted) + 1;

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
    diedOnDay: newDay,
    timestamp: Date.now(),
  };

  // 现有死者：老化到当天 + 衰减（按 diedOnDay 派生 age）
  const agedDeaths = ageAndDecayDeaths(
    state.profile.deaths,
    newDay,
    getPreservationBonus(state.profile.unlockedUpgrades),
    state.profile.unlockedUpgrades.has(SWEEP_IMMUNITY_UPGRADE),
  );

  // 死亡伏笔 flag：第一次死后浅水区启用「悬念痕迹」事件池（foreshadow.wearer.*）。
  // Set 幂等·多次死亡写入无害·不 bump SAVE_VERSION（纯加 flag·#99）。
  const newFlags = new Set(state.profile.flags);
  newFlags.add('flag.has_died_before');

  let s: GameState = {
    ...state,
    run: null,
    profile: {
      ...state.profile,
      deaths: [...agedDeaths, record],
      runsCompleted: state.profile.runsCompleted + 1,
      day: newDay,
      flags: newFlags,
    },
    phase: { kind: 'funeral', record },
  };

  s = appendLog(s, { tone: 'cosmic', text: `[${record.diverName}] 死于 ${record.depthAtDeath}m：${cause}` });
  return s;
}

/**
 * 一具尸体此刻是否"值得回收"：同 zone、未被全部回收/未散失、且身上还有东西。
 * 给海图的出海前选目标（打捞行会 Lv.2）+ mapgen 强制布点共用同一判据。
 * 年龄门（age ≥ CORPSE_VISIBLE_AGE 散失）已在 ageAndDecayDeaths 收口进 recovered ⇒ 此处不读 day（SPEC §2.2·零 mapgen 改动半径）。
 */
export function isRecoverableCorpse(d: DeathRecord, zoneId: string): boolean {
  return d.zoneId === zoneId && !d.recovered && d.inventorySnapshot.length > 0;
}

/** 列出某 zone 当前所有可回收尸体（最老的在前，制造紧迫感）。海图选目标用。 */
export function listRecoverableCorpses(deaths: DeathRecord[], zoneId: string): DeathRecord[] {
  // 最老的在前（紧迫感）＝ diedOnDay 最小在前（age 最大·相对序无需当天 day）。
  return deaths
    .filter((d) => isRecoverableCorpse(d, zoneId))
    .sort((a, b) => a.diedOnDay - b.diedOnDay);
}

/** 找一具可被"本次 run 在此 zone"回收的尸体（用于 mapgen） */
export function findRecoverableCorpse(
  deaths: DeathRecord[],
  zoneId: string,
  targetDepth: number,
  alreadyPlaced: Set<string>,
): DeathRecord | undefined {
  // 复用 isRecoverableCorpse（同 zone / 未回收 / 未散失 / 还有物品），再加深度窗 + 本图去重
  const candidates = deaths.filter(
    (d) =>
      isRecoverableCorpse(d, zoneId) &&
      Math.abs(d.depthAtDeath - targetDepth) <= 10 &&
      !alreadyPlaced.has(d.id),
  );
  if (candidates.length === 0) return undefined;
  // 优先最老的（紧迫感）＝ diedOnDay 最小
  return candidates.sort((a, b) => a.diedOnDay - b.diedOnDay)[0];
}

/**
 * 把所有 DeathRecord 老化「到当天 day」并应用衰减规则（按 age = day − diedOnDay 纯派生）：
 *  - 阈值衰减：物品按档位 + 升级加成判定生存（itemSurvives·按天）
 *  - 海流冲走：非永恒物品由确定性单调谓词 deterministicSwept 判定（取代旧每潜 Math.random）
 *  - 物品全失 **或** age ≥ CORPSE_VISIBLE_AGE 散失 → recovered=true（不再可回收）
 * 阈值/冲走都随 age 单调 ⇒ 死亡/上浮逐天调用 与 港口等待一次跳 N 天 结果逐字节相同（SPEC §7 jump≡step）。
 */
export function ageAndDecayDeaths(
  deaths: DeathRecord[],
  day: number,
  preservationBonus: number,
  sweepImmune: boolean,
): DeathRecord[] {
  return deaths.map((d) => {
    // 玩家取空 / 衰减清空的尸体维持空（不复活物品）。**年龄散失（age≥CORPSE_VISIBLE_AGE）不在此早退**——
    // 留给下方按当天 age 重算 snapshot，保证内容路径无关 ⇒ jump≡step 对任意 N 成立（含跨可见年龄边界）。
    if (d.recovered && d.inventorySnapshot.length === 0) return d;
    const age = day - d.diedOnDay;

    // 1) 阈值衰减（按天）
    let snapshot = d.inventorySnapshot.filter((it) =>
      itemSurvives(it.itemId, age, preservationBonus),
    );

    // 2) 海流冲走（确定性·路径无关）
    if (!sweepImmune) {
      snapshot = snapshot.filter(
        (it) =>
          getDecayTier(it.itemId) === 'eternal' || !deterministicSwept(d.id, it.itemId, age),
      );
    }

    // 物品全失 / 超过可见年龄散失 → 不再可回收（年龄门收口于此·isRecoverableCorpse 不读 day）
    const lost = snapshot.length === 0 || age >= CORPSE_VISIBLE_AGE;

    return {
      ...d,
      inventorySnapshot: snapshot,
      recovered: lost ? true : d.recovered,
    };
  });
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
