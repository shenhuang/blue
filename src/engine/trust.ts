// 通用 NPC 信任系统 —— profile.trust 的**唯一写入口** + 派生（藏宝贸易与信任系统 SPEC §3）。
//
// 单源：per-NPC 信任 = profile.trust[npcId] 一个数（交易额/任务等累加·§3.1）。「档」由数派生
//   （trustTier·§3.2·镜像 story.ts::ch1Story），不另存档。写只经 gainTrust/loseTrust（§3.3·镜像
//   injuries.ts 三入口）——check-boundaries 规则七强制：engine 内 `profile.trust` 只许 trust.ts（读写派生）
//   + state.ts（种子/水合）触碰，别处散读散写。门控走 events.ts::evalCondition 的 `npcTrustTier` 原语（§3.4·
//   同一原语同时门控对话 visibleIf 与商店 minTrustTier）。
//
// Phase 1（本批·机制层就位）：零 NPC 使用、零行为变化——数据里还没有 npc.trust.thresholds、也没有
//   npcTrustTier 引用 ⇒ 全绿且无副作用。NPC 接入 = 纯数据（npcs/<id>.json 加 npc.trust.thresholds
//   + 对话/货架打 npcTrustTier 标 + 内容挂 gainTrust），零本文件改动（SPEC §3.6）。
//
// 阵营前向兼容（SPEC §3.9·极地火山区）：gainTrust/loseTrust 是唯一 choke point，将来「涨某阵营顺带
//   扣敌对阵营」在此 hook；loseTrust 已支持掉信任（有符号）⇒ 零和天然接得上。别把「信任独立」写死。

import type { PlayerProfile } from '@/types';
import aldoData from '@/data/npcs/aldo.json';
import miraData from '@/data/npcs/mira.json';
import ottoData from '@/data/npcs/otto.json';

/**
 * 信任档默认阈值梯（NPC 未在数据里给 thresholds 时的兜底）。thresholds[i] = 到第 i+1 档所需信任值。
 * 档数 = 满足的阈值个数（0=陌生·len=满信任）。**数值占位·defer-number-tuning**（SPEC §11）。
 */
export const DEFAULT_TRUST_THRESHOLDS: readonly number[] = [25, 75, 150, 300];

/** 信任上/下限（有符号·§3.5.8 允许掉信任；下限为零和阵营预留·§3.9）。数值占位·defer。 */
export const TRUST_MIN = -100;
export const TRUST_MAX = 400;

// per-NPC 档阈值（数据驱动·npc.trust.thresholds·SPEC §3.6）。Phase 1 无 NPC 声明 ⇒ 空表 ⇒ 全用默认梯。
type NpcTrustShape = { npc?: { id?: string; trust?: { thresholds?: number[] } } };
const NPC_TRUST_THRESHOLDS: Record<string, readonly number[]> = {};
for (const f of [aldoData, miraData, ottoData] as unknown as NpcTrustShape[]) {
  const id = f.npc?.id;
  const th = f.npc?.trust?.thresholds;
  if (id && Array.isArray(th) && th.length > 0) NPC_TRUST_THRESHOLDS[id] = th;
}

/** 某 NPC 当前信任原始数值（单源读点·未 hydrate 的裸 profile 也安全兜 0）。 */
export function trustValue(profile: PlayerProfile, npcId: string): number {
  return profile.trust?.[npcId] ?? 0;
}

/**
 * 由信任数值派生「档」（纯函数·无副作用·镜像 ch1Story 派生）：档 = 满足的阈值个数（0=陌生）。
 * 阈值 per-NPC 数据驱动（npc.trust.thresholds），缺则默认梯。
 */
export function trustTier(profile: PlayerProfile, npcId: string): number {
  const thresholds = NPC_TRUST_THRESHOLDS[npcId] ?? DEFAULT_TRUST_THRESHOLDS;
  const v = trustValue(profile, npcId);
  let tier = 0;
  for (const t of thresholds) if (v >= t) tier++;
  return tier;
}

/** 一次信任变更的结果（带净变化供调用方推日志；镜像 injuries.InjuryChange）。 */
export interface TrustChange {
  profile: PlayerProfile;
  /** gained=涨 / lost=掉 / unchanged=clamp 到边界或 delta 0 无净变化。 */
  result: 'gained' | 'lost' | 'unchanged';
  npcId: string;
  /** 实际净变化（clamp 后·可能 ≠ 请求量）。 */
  delta: number;
}

/** 唯一写实现：把 delta 应用到 profile.trust[npcId]、clamp 到 [MIN,MAX]。gainTrust/loseTrust 的共同底。 */
function applyTrustDelta(profile: PlayerProfile, npcId: string, delta: number): TrustChange {
  const cur = trustValue(profile, npcId);
  const next = Math.max(TRUST_MIN, Math.min(TRUST_MAX, cur + delta));
  const net = next - cur;
  if (net === 0) return { profile, result: 'unchanged', npcId, delta: 0 };
  return {
    profile: { ...profile, trust: { ...profile.trust, [npcId]: next } },
    result: net > 0 ? 'gained' : 'lost',
    npcId,
    delta: net,
  };
}

/** 唯一写入口①：涨信任（amount≥0·负数被夹到 0）。纯函数——调用方拿 change.profile 落库。 */
export function gainTrust(profile: PlayerProfile, npcId: string, amount: number): TrustChange {
  return applyTrustDelta(profile, npcId, Math.max(0, amount));
}

/** 唯一写入口②：掉信任（amount≥0·内部转负·§3.5.8·卖假货/任务失败/选对家等触发）。 */
export function loseTrust(profile: PlayerProfile, npcId: string, amount: number): TrustChange {
  return applyTrustDelta(profile, npcId, -Math.max(0, amount));
}
