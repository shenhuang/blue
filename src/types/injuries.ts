// 负伤系统类型 —— 与负伤系统 SPEC §3 对齐
//
// 负伤 = **run 级身体债**：战斗里挣的，下潜里还的，回港才清账（run 销毁即全愈，无需清理代码）。
// 与战斗作用域的 combat.playerStatuses（evading/ambushing/panicked）分工不合并（SPEC §2）；
// 代码里的同类是 DecompressionDebt，不是 evading。
// 效果一律经 engine/modifiers.ts::computeModifiers 单点折算——引擎内禁止散读 run.injuries
// （check-boundaries 规则四强制·quirk #95 风格）。

import type { DamageType } from './enemies';

/** 伤势档位：1=轻（≈免费警告·升档计数器） 2=重（翻脸档）。不做三档，升档即翻脸（SPEC §3）。 */
export type InjuryTier = 1 | 2;

/**
 * 单个档位的数值效果。字段缺省＝无该项效果（轻档常为空对象＝纯警告）。
 * 乘数类（×1=无效果）跨伤种相乘；加数类（0=无效果）相加；布尔类取或。
 */
export interface InjuryTierEffects {
  /** 行动体力消耗 ×（战斗行动 costStamina / 洋流移动体力） */
  staminaCostMult?: number;
  /** 氧耗 ×（战斗 costOxygenTurns 与下潜移动 tick 同口径·向上取整） */
  o2CostMult?: number;
  /** 体力上限 ±（与装备加成同点折算·见 modifiers.ts::effectiveStaminaMax） */
  staminaMaxDelta?: number;
  /** 每战斗回合体力增减（流血·重 = −2；负数＝流失） */
  staminaTickPerTurn?: number;
  /** 血腥味：scent 第三感官通道（SPEC §6.1·Wave 2 由 stalker/遭遇侧消费） */
  scentTrail?: boolean;
  /** 瘫痪态（SPEC §7·Wave 2 行动集过滤消费） */
  paralyzed?: boolean;
}

/** 伤种定义（数据模板·src/data/injuries.json） */
export interface InjuryDef {
  id: string; // 'injury.bleed' 等
  name: string; // 流血/肋裂/惊惧/麻痹/灼伤
  /**
   * 默认派生来源：敌攻击未显式指定 injuryId 时按 damageType 查本表（SPEC §4.1）。
   * 同 cause 多伤种时取 JSON 文件顺序第一条（肋裂这类「physical 但属挤压」由攻击显式 injuryId 覆盖，
   * 不加新 DamageType——所以 injuries.json 里 bleed 必须排在 rib 前）。
   */
  cause: DamageType;
  /** [轻档效果, 重档效果]；tier N 读下标 N-1 */
  tierEffects: [InjuryTierEffects, InjuryTierEffects];
  heal: {
    /** 急救包当场：治愈 / 降一档 / 无效（回港一律全愈，隐含不写字段） */
    medkit: 'cure' | 'downgrade' | 'none';
  };
  /** 叙事文案（全部 [待过稿]·quirk #117 流程） */
  narrative: { onGain: string; onWorsen: string; onHeal?: string };
}

/** run.injuries 的一行：身上的一处伤（同时最多 3 处·可读性上限·SPEC §3） */
export interface ActiveInjury {
  defId: string;
  tier: InjuryTier;
}

/**
 * 折算后的派生修正（SPEC §5）——engine/modifiers.ts::computeModifiers 的输出形状。
 * 派生不入存档；消费点只看这个对象，不自己读 run.injuries。
 * 无伤恒等元：乘数 1 / 加数 0 / 布尔 false ＝全部消费点行为逐字节不变。
 */
export interface DerivedModifiers {
  staminaCostMult: number;
  o2CostMult: number;
  staminaMaxDelta: number;
  staminaTickPerTurn: number;
  scentTrail: boolean;
  paralyzed: boolean;
}
