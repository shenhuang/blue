// 灯塔基地引擎（每灯塔设施升级）—— 与全局随身装备升级 engine/upgrades.ts **平行、互不污染**。
// 基建地图 SPEC §3（Phase B：数据模型 + 引擎脚手架）。
//
// 两套升级轨的分工（SPEC §3.3）：
//   - 随身潜水装备（tank/suit/light/tool，全局）→ profile.unlockedUpgrades + getUpgradeBonuses（upgrades.ts）
//   - 灯塔设施（点亮半径/reach/后续服务防御，每灯塔）→ lighthouse.builtUpgrades + getLighthouseBonuses（本文件）
// 账单复用 Phase A 的材料＋金币双资源（materialShortfall / describeUpgradeCost 直接借用，不重复实现）。
//
// Phase B 灯塔 inert：下面这些函数已就位 + 有回归，但游戏流程还没调用它们；
// 设施效果（LighthouseBonuses）由 Phase C 的 chart.ts（reveal）/ dive.ts（reach distance）消费。

import type {
  GameState,
  Lighthouse,
  LighthouseBonuses,
  LighthouseRuinDef,
  LighthouseTrack,
  LighthouseUpgradeDef,
  LighthouseUpgradesFile,
  MaterialCost,
  OutpostDef,
  OutpostStageDef,
  PlayerProfile,
  SonarDir,
} from '@/types';
import lighthouseData from '@/data/lighthouse_upgrades.json';
import { appendLog, removeFromInventory, HOME_LIGHTHOUSE_ID } from './state';
import { materialShortfall, describeUpgradeCost, getUpgradeBonuses } from './upgrades';

const file = lighthouseData as unknown as LighthouseUpgradesFile;
const TRACKS: LighthouseTrack[] = file.tracks;
const INDEX = new Map<string, { track: LighthouseTrack; def: LighthouseUpgradeDef }>();
for (const track of TRACKS) {
  for (const def of track.upgrades) INDEX.set(def.id, { track, def });
}

/** 可修复的废弃灯塔（Phase C 修复循环）。 */
const RUINS: LighthouseRuinDef[] = file.ruins ?? [];
const RUIN_INDEX = new Map<string, LighthouseRuinDef>();
for (const r of RUINS) RUIN_INDEX.set(r.id, r);

/** 可分阶段建造的深水前哨（深水区 Phase 2a 跨 run 前哨脊柱）。 */
const OUTPOSTS: OutpostDef[] = file.outposts ?? [];
const OUTPOST_INDEX = new Map<string, OutpostDef>();
for (const o of OUTPOSTS) OUTPOST_INDEX.set(o.id, o);

// —— 点亮半径 / reach 换算的 tunable 常数（SPEC §3.4 / §4 / §9）——
// 半径用海图归一化坐标（0–1）。home（level 1，无 beacon）= BASE，刚好覆盖现有 4 个锚点
// （最远沉船墓园 ≈ 0.662）+ 近端机会点，但不覆盖两个远端 roaming（≈0.79/0.80）——
// 那两个留给「修复前哨灯塔」点亮，使修复循环立刻有意义（决策：作者选 uniform radius）。
export const BASE_LIGHT_RADIUS = 0.72;
export const LIGHT_RADIUS_PER_LEVEL = 0.12;
export const LIGHT_RADIUS_PER_BONUS = 0.12;

/** 一座灯塔的点亮半径（归一化海图距离）。= base(level) + lightRadiusBonus 换算。 */
export function revealRadius(lighthouse: Lighthouse): number {
  const base = BASE_LIGHT_RADIUS + (lighthouse.level - 1) * LIGHT_RADIUS_PER_LEVEL;
  const bonus = getLighthouseBonuses(lighthouse).lightRadiusBonus * LIGHT_RADIUS_PER_BONUS;
  return base + bonus;
}

/** 全部灯塔设施升级轨（按 JSON 顺序）。 */
export function getLighthouseTracks(): LighthouseTrack[] {
  return TRACKS;
}

export function getLighthouseUpgradeDef(id: string): LighthouseUpgradeDef | undefined {
  return INDEX.get(id)?.def;
}

/** 按 id 取某座灯塔（找不到 undefined）。 */
export function getLighthouse(profile: PlayerProfile, lighthouseId: string): Lighthouse | undefined {
  return profile.lighthouses.find((l) => l.id === lighthouseId);
}

/** 某座灯塔在某轨内已建的最高 level（没建过返回 0）。 */
export function getBuiltLevelInTrack(lighthouse: Lighthouse, track: LighthouseTrack): number {
  let lv = 0;
  for (const u of track.upgrades) {
    if (lighthouse.builtUpgrades.has(u.id)) lv = Math.max(lv, u.level);
  }
  return lv;
}

/** 一条灯塔设施升级当前是否可建。reason 解释不可建的原因（与全局 upgrades 的 PurchaseAvailability 平行）。 */
export type LighthouseBuildAvailability =
  | { ok: true }
  | { ok: false; reason: 'unknown' | 'alreadyBuilt' | 'needsPrev' | 'needsLighthouseLevel' }
  | { ok: false; reason: 'notEnoughMaterials'; shortfall: MaterialCost[] }
  | { ok: false; reason: 'notEnoughGold'; goldShort: number };

export function canBuildAt(
  profile: PlayerProfile,
  lighthouse: Lighthouse,
  upgradeId: string,
): LighthouseBuildAvailability {
  const entry = INDEX.get(upgradeId);
  if (!entry) return { ok: false, reason: 'unknown' };
  const { track, def } = entry;

  if (lighthouse.builtUpgrades.has(def.id)) return { ok: false, reason: 'alreadyBuilt' };

  // 同轨必须先建低一级
  const have = getBuiltLevelInTrack(lighthouse, track);
  if (def.level > have + 1) return { ok: false, reason: 'needsPrev' };

  // 灯塔 level 门槛（缺省 1）
  if (lighthouse.level < (def.requiresLighthouseLevel ?? 1)) {
    return { ok: false, reason: 'needsLighthouseLevel' };
  }

  // 双资源账单：材料先于金币（同全局升级，材料是核心门控）
  const shortfall = materialShortfall(profile, def.cost);
  if (shortfall.length > 0) return { ok: false, reason: 'notEnoughMaterials', shortfall };
  if (profile.bankedGold < def.cost.gold) {
    return { ok: false, reason: 'notEnoughGold', goldShort: def.cost.gold - profile.bankedGold };
  }
  return { ok: true };
}

/** 在某灯塔建一条设施升级：扣材料 ＋ 扣金币 + 写入该灯塔 builtUpgrades（不可建时 no-op）。 */
export function buildAtLighthouse(
  state: GameState,
  lighthouseId: string,
  upgradeId: string,
): GameState {
  const entry = INDEX.get(upgradeId);
  if (!entry) {
    console.warn(`Lighthouse upgrade ${upgradeId} not found`);
    return state;
  }
  const { def } = entry;
  const idx = state.profile.lighthouses.findIndex((l) => l.id === lighthouseId);
  if (idx < 0) {
    console.warn(`Lighthouse ${lighthouseId} not found`);
    return state;
  }
  const lighthouse = state.profile.lighthouses[idx];
  const avail = canBuildAt(state.profile, lighthouse, upgradeId);
  if (!avail.ok) {
    console.warn(`Cannot build ${upgradeId} at ${lighthouseId}: ${avail.reason}`);
    return state;
  }

  // 扣材料
  let inventory = state.profile.inventory;
  for (const m of def.cost.materials) {
    inventory = removeFromInventory(inventory, m.itemId, m.qty);
  }

  // 写入该灯塔的 builtUpgrades（不可变更新：只换这一座）
  const builtUpgrades = new Set(lighthouse.builtUpgrades);
  builtUpgrades.add(def.id);
  const lighthouses = state.profile.lighthouses.map((l, i) =>
    i === idx ? { ...l, builtUpgrades } : l,
  );

  let next: GameState = {
    ...state,
    profile: {
      ...state.profile,
      inventory,
      bankedGold: state.profile.bankedGold - def.cost.gold,
      lighthouses,
    },
  };
  next = appendLog(next, {
    tone: 'system',
    text: `灯塔修缮（${lighthouse.name}）：${def.name}（${describeUpgradeCost(def.cost)}）。`,
  });
  return next;
}

/** 聚合某座灯塔已建设施的派生加成（Phase C 读取消费 reveal/reach）。 */
export function getLighthouseBonuses(lighthouse: Lighthouse): LighthouseBonuses {
  const bonuses: LighthouseBonuses = {
    lightRadiusBonus: 0,
    reachReduction: 0,
    extraConsumableSlot: 0,
    energyGen: 0,
    energyDraw: 0,
    rechargeBonus: 0,
    oxygenSupply: 0,
    storageCapacity: 0,
  };
  for (const id of lighthouse.builtUpgrades) {
    const def = getLighthouseUpgradeDef(id);
    if (!def) continue;
    for (const e of def.effects) {
      switch (e.kind) {
        case 'lightRadiusBonus':
          bonuses.lightRadiusBonus += e.value;
          break;
        case 'reachReduction':
          bonuses.reachReduction += e.value;
          break;
        case 'extraConsumableSlot':
          bonuses.extraConsumableSlot += e.value;
          break;
        case 'energyGen':
          bonuses.energyGen += e.value;
          break;
        case 'energyDraw':
          bonuses.energyDraw += e.value;
          break;
        case 'rechargeBonus':
          bonuses.rechargeBonus += e.value;
          break;
        case 'oxygenSupply':
          bonuses.oxygenSupply += e.value;
          break;
        case 'storageCapacity':
          bonuses.storageCapacity += e.value;
          break;
      }
    }
  }
  return bonuses;
}

/** 家灯塔（守灯人 Aldo 所在的港口基地）。找不到 → undefined（理论上 createInitialProfile 总会种入）。 */
export function getHomeLighthouse(profile: PlayerProfile): Lighthouse | undefined {
  return profile.lighthouses.find((l) => l.id === HOME_LIGHTHOUSE_ID);
}

/** createNewRun 需要的随身加成（出海前结算）。 */
export interface RunStartBonuses {
  oxygenMaxBonus: number;
  staminaMaxBonus: number;
  extraConsumableSlot: number;
  /** 声呐能力是否已解锁（深水区 Phase 0a：来自全局升级 upgrade.sonar.lv1）。 */
  sonarUnlocked: boolean;
  // 深水区 Phase 0 升级轨（全局升级派生，前哨灯塔暂不贡献）：createNewRun 据此种 powerMax / sensorTuning。
  powerMaxBonus: number;
  sonarPingCostReduction: number;
  lampEfficiency: number;
  sonarRobustness: number;
  lampRobustness: number;
  signatureReduction: number;
  // 深水区 Phase 1 续·节点级 clarity 范围/分辨：灯/声呐 reach 加成。
  lampRangeBonus: number;
  sonarRangeBonus: number;
  // 声呐与房间 §8.1：声呐扫描跳数加成（主升级轴）。
  sonarScanRangeBonus: number;
  // 声呐与房间 §5：定向 ping 各扇区 reach 各自升级（逐向独立）。
  sonarDirReach: Record<SonarDir, number>;
  // 声呐与房间 §6/§8.3 续：大房间出现率加成。
  roomFeatureChanceBonus: number;
  // 猎手 SPEC §3 升级规避：玩家侧规避（吸声 T1 / 迷彩 T2）。
  soundAbsorbBonus: number;
  camoBonus: number;
}

/**
 * 合并"全局随身升级"+"家灯塔设施"的随身加成，供出海（startDive / startDiveFromPoi）注入 run。
 * 唯一的桥：dockyard 迁成家灯塔「船坞」设施后，其 extraConsumableSlot 不再走 getUpgradeBonuses，
 * 在此并回——只取**家灯塔**（你的出海基地），前哨灯塔不贡献随身槽。
 */
export function getRunBonuses(profile: PlayerProfile): RunStartBonuses {
  const g = getUpgradeBonuses(profile);
  const home = getHomeLighthouse(profile);
  const homeSlot = home ? getLighthouseBonuses(home).extraConsumableSlot : 0;
  return {
    oxygenMaxBonus: g.oxygenMaxBonus,
    staminaMaxBonus: g.staminaMaxBonus,
    extraConsumableSlot: g.extraConsumableSlot + homeSlot,
    sonarUnlocked: g.sonarUnlocked,
    powerMaxBonus: g.powerMaxBonus,
    sonarPingCostReduction: g.sonarPingCostReduction,
    lampEfficiency: g.lampEfficiency,
    sonarRobustness: g.sonarRobustness,
    lampRobustness: g.lampRobustness,
    signatureReduction: g.signatureReduction,
    lampRangeBonus: g.lampRangeBonus,
    sonarRangeBonus: g.sonarRangeBonus,
    sonarScanRangeBonus: g.sonarScanRangeBonus,
    sonarDirReach: g.sonarDirReach,
    roomFeatureChanceBonus: g.roomFeatureChanceBonus,
    soundAbsorbBonus: g.soundAbsorbBonus,
    camoBonus: g.camoBonus,
  };
}

/** 海图归一化坐标上的欧氏距离。 */
export function distanceBetween(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by);
}

/**
 * 离给定坐标最近的已拥有灯塔 + 距离（无灯塔 → null）。
 * Phase C 用它把"出海 distance"从写死数字过渡到"按最近灯塔算"（SPEC §3.4 reach / §4）。
 */
export function nearestLighthouse(
  profile: PlayerProfile,
  mapX: number,
  mapY: number,
): { lighthouse: Lighthouse; distance: number } | null {
  let best: { lighthouse: Lighthouse; distance: number } | null = null;
  for (const lh of profile.lighthouses) {
    const distance = distanceBetween(lh.mapX, lh.mapY, mapX, mapY);
    if (!best || distance < best.distance) best = { lighthouse: lh, distance };
  }
  return best;
}

// ============================================================
// 修复废弃灯塔（Phase C 修复循环）—— 把"下潜"接到"基建"
// ============================================================

export function getLighthouseRuins(): LighthouseRuinDef[] {
  return RUINS;
}

export function getRuinDef(id: string): LighthouseRuinDef | undefined {
  return RUIN_INDEX.get(id);
}

/** 一座废弃灯塔已被修复后写到 profile.flags 的标记，用于把 lighthouse_ruin 事件门控掉（不再重复出现）。 */
export function ruinRestoredFlag(ruinId: string): string {
  return `flag.lighthouse_restored.${ruinId}`;
}

/** 修复一座废弃灯塔的可行性（账单按 profile 银行材料＋金币结算；与全局升级平行）。 */
export type RestoreAvailability =
  | { ok: true }
  | { ok: false; reason: 'unknown' | 'alreadyRestored' }
  | { ok: false; reason: 'notEnoughMaterials'; shortfall: MaterialCost[] }
  | { ok: false; reason: 'notEnoughGold'; goldShort: number };

export function canRestoreRuin(profile: PlayerProfile, ruinId: string): RestoreAvailability {
  const ruin = RUIN_INDEX.get(ruinId);
  if (!ruin) return { ok: false, reason: 'unknown' };
  // 已修过（目标灯塔已在档）→ 不能再修
  if (profile.lighthouses.some((l) => l.id === ruin.result.id)) {
    return { ok: false, reason: 'alreadyRestored' };
  }
  // 双资源账单：材料先于金币（同全局升级）
  const shortfall = materialShortfall(profile, ruin.cost);
  if (shortfall.length > 0) return { ok: false, reason: 'notEnoughMaterials', shortfall };
  if (profile.bankedGold < ruin.cost.gold) {
    return { ok: false, reason: 'notEnoughGold', goldShort: ruin.cost.gold - profile.bankedGold };
  }
  return { ok: true };
}

/**
 * 修复一座废弃灯塔：权威校验账单（profile 银行材料＋金币）；
 *   - 成功 → 扣料＋扣金 + push 新灯塔到 profile.lighthouses + 置 ruinRestoredFlag + 叙事。
 *   - 不够 / 已修 → 不改 profile，仅叙事说明（applyOutcome 在下潜里调用，故只读不破 run）。
 * 幂等：重复对同一 ruin 调用，第二次因 alreadyRestored 落 no-op。
 */
export function restoreLighthouse(state: GameState, ruinId: string): GameState {
  const ruin = RUIN_INDEX.get(ruinId);
  if (!ruin) {
    console.warn(`Lighthouse ruin ${ruinId} not found`);
    return state;
  }
  const avail = canRestoreRuin(state.profile, ruinId);
  if (!avail.ok) {
    const why =
      avail.reason === 'alreadyRestored'
        ? '这座灯塔已经在远处亮着了。'
        : `材料或金币不够，没能重燃这座灯塔（需要：${describeUpgradeCost(ruin.cost)}）。`;
    return appendLog(state, { tone: 'system', text: why });
  }

  // 扣材料（profile 银行）
  let inventory = state.profile.inventory;
  for (const m of ruin.cost.materials) {
    inventory = removeFromInventory(inventory, m.itemId, m.qty);
  }

  const newLighthouse: Lighthouse = { ...ruin.result, builtUpgrades: new Set() };
  const flags = new Set(state.profile.flags);
  flags.add(ruinRestoredFlag(ruinId));

  let next: GameState = {
    ...state,
    profile: {
      ...state.profile,
      inventory,
      bankedGold: state.profile.bankedGold - ruin.cost.gold,
      lighthouses: [...state.profile.lighthouses, newLighthouse],
      flags,
    },
  };
  next = appendLog(next, {
    tone: 'system',
    text: `你重燃了「${newLighthouse.name}」。它的光扫过这一带——海图上多出一片亮的水域，从这里出海也更近了。（${describeUpgradeCost(ruin.cost)}）`,
  });
  return next;
}

// ============================================================
// 深水前哨：跨 run 分阶段建造（深水区 Phase 2a 脊柱）
// ============================================================
// 复用灯塔网（点亮即 push 一座 Lighthouse、沿用 Phase C reveal/reach），但建造是**多阶段、跨 run 持久**：
// 进度＝profile.flags 的阶段标记（outpostStageFlag），半亮扛过死亡、**不动存档形状**（作者 2026-06-04 未发布不迁移）。
// 半亮（≥ OUTPOST_USABLE_STAGE）即可作蛙跳出潜点（dive.ts::startDiveFromOutpost 读 outpostStage 缩短下一更深 band 的预耗氧）。

/** 前哨建造的总阶段数（点亮）。OutpostDef.stages 长度应等于此。 */
export const OUTPOST_MAX_STAGE = 3;
/** 前哨可作蛙跳出潜点的最低阶段（半亮即起跳＝中间阶段已给部分收益）。 */
export const OUTPOST_USABLE_STAGE = 2;

export function getOutposts(): OutpostDef[] {
  return OUTPOSTS;
}
export function getOutpostDef(id: string): OutpostDef | undefined {
  return OUTPOST_INDEX.get(id);
}

/** 前哨某阶段的持久进度标记（profile.flags）。stage ∈ 1..OUTPOST_MAX_STAGE。 */
export function outpostStageFlag(outpostId: string, stage: number): string {
  return `flag.${outpostId}.s${stage}`;
}

/** 前哨当前已建到的阶段（0 = 没动过；读 profile.flags 的阶段标记、取最高）。 */
export function outpostStage(profile: PlayerProfile, outpostId: string): number {
  for (let s = OUTPOST_MAX_STAGE; s >= 1; s--) {
    if (profile.flags.has(outpostStageFlag(outpostId, s))) return s;
  }
  return 0;
}

/** 前哨是否已点亮（建满）。 */
export function isOutpostLit(profile: PlayerProfile, outpostId: string): boolean {
  return outpostStage(profile, outpostId) >= OUTPOST_MAX_STAGE;
}

/**
 * 推进一座前哨的建造一阶（深水区 Phase 2a，applyOutcome 的 advanceOutpostId 调）。
 * 权威校验**当前阶段**账单（profile 银行材料＋金币）：
 *   - 够 → 扣料＋扣金 + 置阶段 flag（持久进度）；建满（点亮）→ push 一座灯塔到 profile.lighthouses（reveal/reach）。
 *   - 不够 / 已点亮 → 不改 profile，仅叙事（applyOutcome 在下潜里调，只读不破 run）。
 * 幂等安全：建满后再调落「已点亮」no-op；不够料保持当前阶段、可下次带够再来（半亮扛过死亡）。
 */
export function advanceOutpost(state: GameState, outpostId: string): GameState {
  const def = OUTPOST_INDEX.get(outpostId);
  if (!def) {
    console.warn(`Outpost ${outpostId} not found`);
    return state;
  }
  const cur = outpostStage(state.profile, outpostId);
  if (cur >= def.stages.length) {
    return appendLog(state, { tone: 'system', text: `「${def.name}」已经点亮了。` });
  }
  const stageDef = def.stages[cur]; // 下一阶段（cur 是 0-based 已建数 = 下一阶段索引）
  const shortfall = materialShortfall(state.profile, stageDef.cost);
  if (shortfall.length > 0 || state.profile.bankedGold < stageDef.cost.gold) {
    return appendLog(state, {
      tone: 'system',
      text: `材料或金币不够，这一阶段还推不动（需要：${describeUpgradeCost(stageDef.cost)}）。`,
    });
  }

  // 扣材料（profile 银行）
  let inventory = state.profile.inventory;
  for (const m of stageDef.cost.materials) {
    inventory = removeFromInventory(inventory, m.itemId, m.qty);
  }
  const newStage = cur + 1;
  const flags = new Set(state.profile.flags);
  flags.add(outpostStageFlag(outpostId, newStage));

  // 深水区 Phase 2b：建造一阶＝刚 ferry 过料 → 重置结构衰减计时（maintainedRun = 当前 run）。
  // 水上前哨（!submerged）outpostDecayLevel 恒 0、写它也无害（保持一致、零分支）。
  // 深水区 Phase 2b 续：**保留既有 stored/storedRun**（建造不动寄存——寄存损耗走独立 storedRun 计时、由存/取/维护打理）；
  // 既有 outpostState 缺 stored 的前哨仍写出 { maintainedRun } 单字段＝行为逐字节不变（守回归）。
  const outpostState = {
    ...(state.profile.outpostState ?? {}),
    [outpostId]: {
      ...(state.profile.outpostState?.[outpostId] ?? {}),
      maintainedRun: state.profile.runsCompleted,
    },
  };

  // 点亮 → promote：push 一座灯塔（复用 Phase C reveal/reach；幂等防重复 push）。
  let lighthouses = state.profile.lighthouses;
  const lit = newStage >= def.stages.length;
  if (lit && !lighthouses.some((l) => l.id === def.result.id)) {
    lighthouses = [...lighthouses, { ...def.result, builtUpgrades: new Set<string>() }];
  }

  let next: GameState = {
    ...state,
    profile: {
      ...state.profile,
      inventory,
      bankedGold: state.profile.bankedGold - stageDef.cost.gold,
      lighthouses,
      flags,
      outpostState,
    },
  };
  next = appendLog(next, {
    tone: 'system',
    text: lit
      ? `你给「${def.name}」通上了电。灯亮起来，扫过这一带的深水——海图上多出一片亮的水域，往后从这儿蛙跳下潜也近得多。（${describeUpgradeCost(stageDef.cost)}）`
      : stageDef.narrative ?? `「${def.name}」的修建往前推了一阶。（${describeUpgradeCost(stageDef.cost)}）`,
  });
  return next;
}

/** 前哨下一阶段的建造定义（已点亮 → undefined）。UI 显示账单 / label 用。 */
export function nextOutpostStage(
  profile: PlayerProfile,
  outpostId: string,
): OutpostStageDef | undefined {
  const def = OUTPOST_INDEX.get(outpostId);
  if (!def) return undefined;
  const cur = outpostStage(profile, outpostId);
  return cur < def.stages.length ? def.stages[cur] : undefined;
}

/** 前哨下一阶段是否建得起（材料＋金币够、未点亮）。UI disable 建造按钮用，校验逻辑与 advanceOutpost 一致。 */
export function canAdvanceOutpost(profile: PlayerProfile, outpostId: string): boolean {
  const stageDef = nextOutpostStage(profile, outpostId);
  if (!stageDef) return false; // 已点亮 / 未知
  if (materialShortfall(profile, stageDef.cost).length > 0) return false;
  return profile.bankedGold >= stageDef.cost.gold;
}
