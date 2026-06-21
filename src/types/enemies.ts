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
export type EnemyRole = 'predator' | 'gatekeeper' | 'sanity' | 'swarm' | 'ambusher' | 'boss' | 'miniboss';

/** 粗档威胁。缺省时由 enemyLibrary 从 threat 数值派生（开放问题①·派生 + 可显式覆盖）。 */
export type ThreatTier = 'low' | 'mid' | 'high';

/** boss 阶段（HP 跌破 threshold 时触发） */
export interface BossPhase {
  /** 触发 HP 比例（0–1，例如 0.4 = HP 跌破 40% 时触发） */
  hpThreshold: number;
  /** 推入战斗 log 的过渡叙事文本 */
  transitionText: string;
  /** 替换攻击表（缺省 = 沿用当前阶段） */
  attacksOverride?: EnemyAttack[];
  /** 覆盖 AI 模式 */
  aiPatternOverride?: AiPattern;
  /** 强制切 stance */
  stanceForce?: EnemyStance;
}

/** boss 存在时持续施加的战场压力（每回合 tick） */
export interface EnvironmentalPressure {
  /** 每回合额外氧气消耗（叠加基础 tick） */
  oxygenDrainBonus?: number;
  /** 每回合额外体力流失 */
  staminaTickBonus?: number;
  /** 每回合理智伤害 */
  sanityDamagePerTurn?: number;
}

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

/** 遭遇里"取一只合适的已有敌人"的描述符（敌人库 SPEC §4·由 pickEnemy 解析·route B 加法接入）。 */
export interface EnemyRef {
  band?: string;
  biome?: string;
  role?: EnemyRole;
  threatTier?: ThreatTier;
  excludeIds?: string[];
}

/** 战斗 encounter 的一个 party 成员（def 侧）：写死 `defId`，或用 `enemyRef` 让库取一只合适的（二选一）。 */
export interface EnemyPartyMemberDef {
  defId?: string;
  enemyRef?: EnemyRef;
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
   * 命中率补正（负重战斗·作者 2026-06-20）：加到该敌种的基础命中率上（见 engine/combat.ts::enemyHitChance）。
   * 「每个敌人补正不同·有些更善于在黑暗中偷袭」——暗伏/突袭型给正值（更准）、笨重/被动型给负值或 0。
   * 缺省 0＝按基础命中（仅受负重档位 weightHitMod 影响）。范围建议 −0.15..+0.20·数值=提案可调。
   */
  hitBonus?: number;

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

  /**
   * boss/miniboss 阶段序列（hpThreshold 降序排列，引擎按当前 HP% 找最高已触发阶段）。
   * 例：[{hpThreshold:0.6,...}, {hpThreshold:0.3,...}] → HP 跌破 60% 进阶段 0、跌破 30% 进阶段 1。
   * check-enemy-refs 门验证降序；错序 → regress 失败。
   */
  phases?: BossPhase[];
  /**
   * boss 存在时对战场施加的持续压力（boss 存活即生效，不分阶段）。
   * applyEnvironmentalPressure 每回合 tick 处累计所有存活 boss 的值。
   */
  environmentalPressure?: EnvironmentalPressure;

  /**
   * 尸衣者（corpse-wearer）专属：按当前穿戴「皮囊」决定的 loot 变体表（深水区 SPEC §5 / boss 设计蓝图 2026-06-21「尸衣者新定位」）。
   * key = 皮囊 id（＝被翻动尸体所属敌种 id，如 'enemy.blind_eel'）；value = 该皮囊下的完整 LootTable。
   * 运行时由 EnemyInstance.wornSkin 选中其一（startCombat 写入 → combat.ts::effectiveLoot 消费）；
   * wornSkin 未设或不在表内 → 回落 def.loot（**替换语义·非叠加**·见 effectiveLoot）。
   * 仅尸衣者类敌人声明此字段；check-enemy-refs (c3) 验证其形状 + defaultSkin∈skinLoot（约定落成 regress 门）。
   */
  skinLoot?: Record<string, LootTable>;
  /**
   * 尸衣者缺省皮囊（startCombat 未显式传入 wornSkin 时用·= 它「默认穿着」的尸皮）。
   * 必须是 skinLoot 的一个 key（check-enemy-refs (c3) 守）。
   */
  defaultSkin?: string;
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
  /**
   * 当前阶段覆盖的攻击表（maybeBossPhaseShift 写入·BossPhase.attacksOverride）。
   * enemyAttackPlayer 优先读此字段；undefined = 用 def.attacks。
   */
  phaseAttacksOverride?: EnemyAttack[];
  /**
   * 当前阶段覆盖的 AI 模式（maybeBossPhaseShift 写入·BossPhase.aiPatternOverride）。
   * 未来 AI 分发扩展时读；当前 aggressor/flanker 等均已在 runEnemyTurn 逐字判断·此字段留位。
   */
  phaseAiPattern?: AiPattern;
  /**
   * 尸衣者运行时穿戴的「皮囊」id（startCombat 写入·来自 loot-trigger 的尸体来源·缺省 def.defaultSkin）。
   * finalizeVictory 经 effectiveLoot 用它从 def.skinLoot 选 loot 变体；undefined = 非尸衣者/未指定 → def.loot。
   * 仅带 skinLoot 的敌人会被写此字段 ⇒ 普通敌人 EnemyInstance 形状逐字节不变（守 #99 + 既有 combat baseline）。
   */
  wornSkin?: string;
}

export interface EnemyStatus {
  kind: 'stunned' | 'bleeding' | 'poisoned' | 'frightened' | 'distracted' | 'enthralled';
  remainingTurns: number;
  /**
   * 每回合持续伤害（DoT·武器改装组件 SPEC·作者 2026-06-20）：bleeding（倒刺套件·撕裂）/
   * poisoned（毒囊·中毒）在敌人回合末按此值掉 hp。缺省/0＝纯状态无持续伤（旧 'bleeding' 标记
   * 逐字节不变·不掉血）。注意：负伤系统（run.injuries）是玩家专属，敌人的「中毒/撕裂」走这条状态 DoT。
   */
  dmgPerTurn?: number;
}

/** 战场 EnemyParty */
export interface EnemyParty {
  members: EnemyInstance[];
  joinRules?: {
    triggerOnNoise?: { threshold: number; addFromPool: string[]; max: number };
    triggerOnSanity?: { threshold: number; addFromPool: string[]; max: number };
  };
}
