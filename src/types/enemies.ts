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

// —— 敌人库元数据类型（敌人库 SPEC 支柱一·docs/spec/深海回响_敌人库_SPEC.md §2） ——

/** 战斗生态位（与 aiPattern 正交：aiPattern=战斗 AI 行为；role=内容侧"这段需要什么样的威胁"）。草案词表·可增。 */
export type EnemyRole = 'predator' | 'gatekeeper' | 'sanity' | 'swarm' | 'ambusher';

/** 粗档威胁。缺省时由 enemyLibrary 从 threat 数值派生（开放问题①·派生 + 可显式覆盖）。 */
export type ThreatTier = 'low' | 'mid' | 'high';

/** 背景/图鉴文本（喂未来图鉴 + 辅助判断场景契合·非机器过滤项·能过滤的信息一律走 bands/biomes/role）。 */
export interface CodexEntry {
  /** 栖息地。 */
  habitat?: string;
  /** 行为 / 习性。 */
  behavior?: string;
  /** 外观。 */
  appearance?: string;
  /** 初见提示（可选）。 */
  firstSeenHint?: string;
}

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

  // —— 库元数据（敌人库 SPEC 支柱一·全可选·不入存档·驱动 pickEnemy 选取与未来图鉴）——
  /**
   * "在哪出现"轴：深度 band id（band.*）与 random-zone id（zone.*）混排。
   * pickEnemy 按 scene.band 过滤；无 bands＝孤儿敌人（永选不中）·check-enemy-refs 会拦。
   */
  bands?: string[];
  /**
   * 环境/栖息地轴（与 bands 正交·开放词表新值即用）：
   * reef_tropical / cave_anchialine / wreck_field / polar_under_ice / mangrove / hydrothermal_vent …
   * 同样 50m，热带礁的鱼与极地冰下的鱼是两套池子——"红树林热带鱼不进极地"靠这条。
   */
  biomes?: string[];
  /** 战斗生态位（内容侧选取用）。 */
  role?: EnemyRole;
  /** 粗档威胁（缺省由 threat 派生）。 */
  threatTier?: ThreatTier;
  /** 背景/图鉴文本（非机器过滤项）。 */
  codex?: CodexEntry;

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
