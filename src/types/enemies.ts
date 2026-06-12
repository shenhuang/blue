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

  /**
   * 嗅觉系敌种（负伤 SPEC §6.1 scent 第三感官·鲨/梭鱼类天然候选 true·管水母类 false/缺省）。
   * 玩家流血·重（modifiers.scentTrail）时对它光声纪律全部失效：迷彩/关灯/闭声呐照常只管 light/sound，
   * scent 通道直接判「已锁定」（stalker.ts 旁路·sensesBy 矩阵不重写）；战斗里 unaware 直接 alerted。
   * 仅有的两个解法：decoy 照常 guaranteed 全效（北极星）；medkit 止血。具体名单 [待作者拍·SPEC §12.2]。
   */
  scent?: boolean;

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
  /**
   * 命中后给玩家负伤（负伤 SPEC §4.1）。injuryId 缺省 → 按 attack.damageType 查 injuries.json
   * 的 cause 默认派生（physical→流血）；「physical 但属挤压」的肋裂由攻击显式 injuryId 覆盖，
   * 不加新 DamageType。**仅带本字段的攻击才掷骰**——不带的攻击零额外 RNG 消耗（守既有 seed 基线）。
   */
  injuryOnHit?: { chance: number; injuryId?: string };
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
