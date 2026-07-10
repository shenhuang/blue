// 负伤系统 —— run.injuries 的**唯一写入口**（负伤 SPEC §3/§4/§8）
//
// 档位状态机：无 → 轻(1) → 重(2)。同伤种再中招升一档；已是重档再中招不再升级、无额外惩罚
// （SPEC §3·开放问题 §12.1 维持现状）。不同伤种各自独立计档。
// 上限 MAX_INJURIES=3（可读性上限）：超限时新伤不顶替，而是对「已有最轻伤种」升档
// （伤上加伤·列表永不超 3 行）；「最轻」＝tier 最低，并列取列表先来者（确定性·便于 baseline）。
//
// 机制边界（check-boundaries 规则四强制·quirk #95 风格）：
//   - 写 run.injuries：仅本文件（addInjury / worsenInjury / healInjury + scenario fixture 的 seedInjuries）。
//   - 读 run.injuries 折算数值：仅 engine/modifiers.ts::computeModifiers（引擎消费点全走它，禁散读）。
//   - UI 渲染徽章直读不限（规则只扫 src/engine）。
// 回港全愈无需代码：injuries 住 run，回港/死亡 run 置 null 即清账（SPEC §8「回港一律全愈」）。

import type { RunState, DamageType, InjuryDef, ActiveInjury, InjuryTierEffects } from '@/types';
import injuryData from '@/data/injuries.json';

// ——— 数据索引 ———

const INJURY_DEFS: Map<string, InjuryDef> = new Map();
for (const d of (injuryData as unknown as { injuries: InjuryDef[] }).injuries) INJURY_DEFS.set(d.id, d);

/** 同时最多几处伤（SPEC §3 可读性上限） */
export const MAX_INJURIES = 3;

export function getInjuryDef(id: string): InjuryDef | undefined {
  return INJURY_DEFS.get(id);
}

export function listInjuryDefs(): InjuryDef[] {
  return [...INJURY_DEFS.values()];
}

/**
 * cause 默认派生（SPEC §4.1）：敌攻未显式 injuryId 时按 damageType 查表。
 * 同 cause 多伤种取 JSON 文件顺序第一条（physical→流血；肋裂由攻击显式 injuryId 指定）。
 */
export function injuryIdForDamageType(t: DamageType): string | undefined {
  for (const d of INJURY_DEFS.values()) {
    if (d.cause === t) return d.id;
  }
  return undefined;
}

// ——— 三入口 ———

/** 一次 add/worsen/heal 的结果（带叙事文案供调用方推日志；不在此处写日志＝引擎纯函数） */
export interface InjuryChange {
  run: RunState;
  /**
   * gained=新负伤（轻档） / worsened=升档（含超限时对最轻伤种的「伤上加伤」）
   * / saturated=已是重档无事发生 / unknown=injuryId 未注册（防御性 no-op）
   */
  result: 'gained' | 'worsened' | 'saturated' | 'unknown';
  /** 实际落在哪个伤种上（超限顶替升档时可能 ≠ 请求的 injuryId） */
  defId: string;
  /** 叙事文案（onGain/onWorsen/onHeal·[待过稿] 草稿）；saturated/unknown 无 */
  text?: string;
}

/**
 * 受伤入口：新伤种记轻档；已有同伤种升档；满 3 处时对已有最轻伤种升档。
 * 纯函数——调用方拿 change.run 落库、change.text 推日志。
 */
export function addInjury(run: RunState, injuryId: string): InjuryChange {
  const def = INJURY_DEFS.get(injuryId);
  if (!def) return { run, result: 'unknown', defId: injuryId };

  if (run.injuries.some((i) => i.defId === injuryId)) {
    return worsenInjury(run, injuryId);
  }

  if (run.injuries.length >= MAX_INJURIES) {
    // 超限：不顶替不丢列表行——对已有最轻伤种升档（SPEC §3）。全员重档 → 无事发生。
    const lightest = [...run.injuries].sort((a, b) => a.tier - b.tier)[0];
    if (!lightest || lightest.tier >= 2) return { run, result: 'saturated', defId: injuryId };
    return worsenInjury(run, lightest.defId);
  }

  const gained: ActiveInjury = { defId: injuryId, tier: 1 };
  return {
    run: { ...run, injuries: [...run.injuries, gained] },
    result: 'gained',
    defId: injuryId,
    text: def.narrative.onGain,
  };
}

/** 升档入口：轻 → 重；不存在则视作新伤；已是重档 → saturated 无额外惩罚（SPEC §3）。 */
export function worsenInjury(run: RunState, injuryId: string): InjuryChange {
  const def = INJURY_DEFS.get(injuryId);
  if (!def) return { run, result: 'unknown', defId: injuryId };
  const existing = run.injuries.find((i) => i.defId === injuryId);
  if (!existing) {
    // 防御性：直接 worsen 不存在的伤 → 走新伤路径（addInjury 只在 existing 时回调本函数，不会无限递归）
    return addInjury(run, injuryId);
  }
  if (existing.tier >= 2) return { run, result: 'saturated', defId: injuryId };
  return {
    run: {
      ...run,
      injuries: run.injuries.map((i) => (i.defId === injuryId ? { ...i, tier: 2 as const } : i)),
    },
    result: 'worsened',
    defId: injuryId,
    text: def.narrative.onWorsen,
  };
}

/**
 * 治疗入口（medkit 接线在 Wave 2·SPEC §8——本入口先就位＝治疗路径单点）。
 * mode 按 InjuryDef.heal.medkit 语义：cure=移除；downgrade=重→轻（轻档 downgrade 也移除——
 * 「缓一档」对只剩警告的轻伤即痊愈）；调用方自己查 def.heal.medkit 决定 mode（'none' 就别调）。
 */
export function healInjury(
  run: RunState,
  injuryId: string,
  mode: 'cure' | 'downgrade',
): { run: RunState; healed: boolean; text?: string } {
  const def = INJURY_DEFS.get(injuryId);
  const existing = run.injuries.find((i) => i.defId === injuryId);
  if (!def || !existing) return { run, healed: false };
  if (mode === 'downgrade' && existing.tier === 2) {
    return {
      run: {
        ...run,
        injuries: run.injuries.map((i) => (i.defId === injuryId ? { ...i, tier: 1 as const } : i)),
      },
      healed: true,
      text: def.narrative.onHeal,
    };
  }
  return {
    run: { ...run, injuries: run.injuries.filter((i) => i.defId !== injuryId) },
    healed: true,
    text: def.narrative.onHeal,
  };
}

/**
 * 急救包整包结算（SPEC §8「medkit 治伤」·consumable.medkit 旗标的引擎面·#117）：对身上
 * **每处**伤按各自 `heal.medkit` 字段生效——「全部能治的一起处理」（作者拍 2026-06-12·
 * 徽章「急救包可治」的承诺对每条都兑现）。cure 移除 / downgrade 降档 / none 不动。
 * 住本文件＝伤势列表的遍历与治疗不出唯一写者（规则四触碰面）；逐条 onHeal 文案
 * 返还调用方推日志（与三入口同口径·引擎纯函数不写日志）。
 */
export function applyMedkitHeal(run: RunState): { run: RunState; texts: string[] } {
  const texts: string[] = [];
  let cur = run;
  for (const inj of [...cur.injuries]) {
    const def = INJURY_DEFS.get(inj.defId);
    const mode = def?.heal.medkit;
    if (!def || !mode || mode === 'none') continue;
    const healed = healInjury(cur, inj.defId, mode);
    if (!healed.healed) continue;
    cur = healed.run;
    if (healed.text) texts.push(healed.text);
  }
  return { run: cur, texts };
}

/**
 * 测试 fixture 单点（combatScenario/eventScenario 起始伤势铺设用）——绕过升档状态机直落档位。
 * 游戏逻辑别用这个；游戏内受伤只走 addInjury/worsenInjury。
 */
export function seedInjuries(run: RunState, injuries: ActiveInjury[]): RunState {
  return { ...run, injuries: injuries.slice(0, MAX_INJURIES).map((i) => ({ ...i })) };
}

// ——— 描述（UI 徽章三件套的数据源·纯函数无 UI 依赖） ———

/** 徽章三件套（SPEC §9）：档位 + 生效中的效果 + 治疗路径。文案 [待过稿] 草稿。 */
export interface InjuryBadge {
  defId: string;
  name: string;
  tier: 1 | 2;
  tierLabel: '轻' | '重';
  /** 生效效果的人话行；轻档空效果 → 固定警告句（SPEC §9） */
  effectLines: string[];
  /** 治疗路径一句话 */
  healLine: string;
}

function describeEffects(eff: InjuryTierEffects): string[] {
  const lines: string[] = [];
  if (eff.staminaCostMult !== undefined && eff.staminaCostMult !== 1) {
    lines.push(`行动更费力（体力消耗 ×${eff.staminaCostMult}）`);
  }
  if (eff.o2CostMult !== undefined && eff.o2CostMult !== 1) {
    lines.push(`呼吸变贵（氧耗 ×${eff.o2CostMult}）`);
  }
  if (eff.staminaMaxDelta) {
    lines.push(`使不上全力（体力上限 ${eff.staminaMaxDelta > 0 ? '+' : ''}${eff.staminaMaxDelta}）`);
  }
  if (eff.staminaTickPerTurn) {
    lines.push(`力气随血走（战斗中每回合体力 ${eff.staminaTickPerTurn}）`);
  }
  if (eff.scentTrail) {
    lines.push('血腥味在水里散开——闻得见的东西不看灯也不听声');
  }
  if (eff.paralyzed) {
    lines.push('身体不听使唤');
  }
  return lines;
}

export function describeInjury(inj: ActiveInjury): InjuryBadge | null {
  const def = INJURY_DEFS.get(inj.defId);
  if (!def) return null;
  const eff = def.tierEffects[inj.tier - 1] ?? {};
  const effectLines = describeEffects(eff);
  if (effectLines.length === 0) {
    effectLines.push('暂无影响——再受同类伤会加重');
  }
  const healLine =
    def.heal.medkit === 'cure'
      ? '急救包可当场治愈；回港全愈'
      : def.heal.medkit === 'downgrade'
        ? '急救包可缓一档；回港全愈'
        : '急救包治不了——回港才能好';
  return {
    defId: def.id,
    name: def.name,
    tier: inj.tier,
    tierLabel: inj.tier === 1 ? '轻' : '重',
    effectLines,
    healLine,
  };
}
