// 敌人 schema —— 与战斗系统 SPEC §4 对齐

import type { EventOption } from './events';

export type EnemyTier = 'realistic' | 'uncanny' | 'cosmic';

export type Hostility =
  | 'aggressive' // 默认 attacking
  | 'territorial' // 接近后 alerted，越界 attacking
  | 'predatory' // 从 unaware 突袭 attacking
  | 'passive' // 受攻击才进 attacking
  | 'curious' // 始终 alerted
  | 'reverent'; // 克苏鲁仪式型

export type EnemyStance =
  | 'unaware'
  | 'alerted'
  | 'attacking'
  | 'enraged'
  | 'fleeing';

export type AiPattern =
  | 'aggressor'
  | 'flanker'
  | 'caster'
  | 'observer'
  | 'crowd';

export type DamageType = 'physical' | 'sanity' | 'electricity' | 'fire';
export type Weakness =
  | 'light'
  | 'sound'
  | 'salt'
  | 'cold'
  | 'iron'
  | 'fresh-water'
  | 'name';

export type VictoryPath = 'kill' | 'flee' | 'tame' | 'scare' | 'commune';

/** 敌人定义（数据模板） */
export interface EnemyDef {
  id: string;
  name: string;
  tier: EnemyTier;

  // —— 基础属性 ——
  hp: number;
  sanityHp?: number; // 仅克苏鲁敌人
  armor: number;
  evasion: number;
  speed: number;

  // —— 行为 ——
  threat: number;
  hostility: Hostility;
  initialStance: EnemyStance;
  aiPattern: AiPattern;

  // —— 攻击 ——
  attacks: EnemyAttack[];

  // —— 伤害与抗性 ——
  physicalDamage: [number, number];
  sanityDamage?: [number, number];
  weakness?: Weakness[];
  immunity?: DamageType[];

  // —— 结算 ——
  loot: LootTable;
  victoryConditions: VictoryPath[];
  loreEntry?: string;

  /** 遭遇事件中可显示的额外选项（潜行/挑衅/谈判/...） */
  encounterOptions?: EventOption[];
}

export interface EnemyAttack {
  id: string;
  name: string;
  damageType: DamageType;
  damage: [number, number];
  sanityDamage?: [number, number];
  description: string; // 战斗叙事文本
  weight?: number; // AI 选用此攻击的权重
}

export interface LootTable {
  guaranteed?: LootEntry[];
  rolls: LootEntry[];
  rollCount: number;
  /** 不同胜利路径的奖励系数：1 = 满奖励，0 = 无奖励 */
  victoryModifier?: Partial<Record<VictoryPath, number>>;
}

export interface LootEntry {
  itemId: string;
  qty: [number, number];
  weight: number;
}

/** 敌人在战斗中的运行时状态 */
export interface EnemyInstance {
  instanceId: string;
  defId: string;
  hp: number;
  sanityHp?: number;
  stance: EnemyStance;
  aggro: number; // 对玩家的仇恨度
  statuses: EnemyStatus[];
}

export interface EnemyStatus {
  kind: 'stunned' | 'bleeding' | 'frightened' | 'distracted' | 'enthralled';
  remainingTurns: number;
}

/** 战场 EnemyParty */
export interface EnemyParty {
  members: EnemyInstance[];
  joinRules?: {
    triggerOnNoise?: { threshold: number; addFromPool: string[]; max: number };
    triggerOnSanity?: { threshold: number; addFromPool: string[]; max: number };
  };
}
