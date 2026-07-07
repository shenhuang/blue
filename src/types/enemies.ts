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

/**
 * 链鳗（分节实体·boss 设计蓝图 2026-06-21）：某节在「按序」遭遇中**成为最前存活节**时施加的 enrage 覆盖。
 * 复用 BossPhase 的 stance/attacks/ai 覆写写法，但触发是 **party-state**（前置节全死、本节成为最前存活节），
 * 而非 HP 阈值——因此不经 maybeBossPhaseShift（HP 路径·#149/#159），由 combat.ts::maybeChainEelEnrage 单独施加。
 * 仅 attackInOrder 遭遇 + 带本字段的节生效；普通敌人不声明此字段 ⇒ EnemyDef 形状零存档影响（#99）。
 */
export interface SegmentEnrage {
  /** 推入战斗 log 的过渡叙事文本（[待过稿]·#117）。 */
  transitionText: string;
  /** 替换攻击表（缺省 = 沿用 def.attacks·写入 EnemyInstance.phaseAttacksOverride·复用 BossPhase 写法）。 */
  attacksOverride?: EnemyAttack[];
  /** 覆盖 AI 模式（写入 EnemyInstance.phaseAiPattern）。 */
  aiPatternOverride?: AiPattern;
  /** 强制切 stance（缺省 'enraged'）。 */
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
  /**
   * 运行时注入的攻击表覆盖（不写进静态 JSON·startCombat 写入 EnemyInstance.phaseAttacksOverride）。
   * 水鬼占据玩家尸体时用：基础攻击 + 玩家武器变体合并后传入（horror-sapien.ts::buildInhabitedCorpseEncounter）。
   * 普通 JSON 遭遇不设此字段·不影响任何既有 combat baseline。
   */
  attacksOverride?: EnemyAttack[];
  /**
   * 运行时指定的皮囊 id（优先于 StartCombatOptions.wornSkin 和 def.defaultSkin）。
   * 水鬼：'player' = 穿了潜水员尸体（effectiveLoot 找不到此 key → 回落 def.loot，动物皮囊行为不变）。
   */
  wornSkin?: string;
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
  /**
   * 头像美术资源路径（战斗 UI 敌人卡片用·作者 2026-07-01）。缺省 = 未画 → EnemyPortrait 组件
   * 自动退回占位头像（按 id 稳定取色 + 名字首字，见 ui/EnemyPortrait.tsx）。以后补真实立绘
   * 只需在对应敌人 JSON 加这一个字段，组件侧零改动——别为占位图手写 15 张图片资源。
   */
  portraitUrl?: string;

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
   * 水鬼（horror-sapien）专属：按当前穿戴「皮囊」决定的 loot 变体表（深水区 SPEC §5 / boss 设计蓝图 2026-06-21「水鬼新定位」）。
   * key = 皮囊 id（＝被翻动尸体所属敌种 id，如 'enemy.blind_eel'）；value = 该皮囊下的完整 LootTable。
   * 运行时由 EnemyInstance.wornSkin 选中其一（startCombat 写入 → combat.ts::effectiveLoot 消费）；
   * wornSkin 未设或不在表内 → 回落 def.loot（**替换语义·非叠加**·见 effectiveLoot）。
   * 仅水鬼类敌人声明此字段；check-enemy-refs (c3) 验证其形状 + defaultSkin∈skinLoot（约定落成 regress 门）。
   */
  skinLoot?: Record<string, LootTable>;
  /**
   * 水鬼缺省皮囊（startCombat 未显式传入 wornSkin 时用·= 它「默认穿着」的尸皮）。
   * 必须是 skinLoot 的一个 key（check-enemy-refs (c3) 守）。
   */
  defaultSkin?: string;

  /**
   * 链鳗（分节实体）头节专属：本节在 attackInOrder 遭遇里成为**最前存活节**时的 enrage 覆盖
   * （boss 设计蓝图 2026-06-21「链鳗（分节实体）」·越杀越短、头节 enraged）。
   * 触发＝party-state（前置节全死）·由 combat.ts::maybeChainEelEnrage 施加（**不经** maybeBossPhaseShift 的 HP 路径）。
   * 仅链鳗头节声明；check-enemy-refs (c4) 验证标了 attackInOrder 的 encounter 末节（头节）带本字段。
   */
  headEnrage?: SegmentEnrage;

  /**
   * 裂球（split-proliferation）：每 intervalTurns 回合检查，若玩家对该敌造成的伤害 < minDamageToDeny
   * → 裂变：分裂产生 spawnCount 只 spawnDefId 新敌人（初始 HP = spawnHpRatio × spawnDefId.hp），
   * 总 party 不超过 maxPartySize。仅声明本字段的敌人才进 maybeEnemySplit 分支；普通敌人逐字节不变。
   */
  splitBehavior?: {
    intervalTurns: number;
    spawnDefId: string;
    spawnCount: number;
    spawnHpRatio: number;
    maxPartySize: number;
    minDamageToDeny: number;
  };

  /**
   * 清道夫（corpse-eating）：party 内任意敌人死亡时，清道夫恢复 hpGainPerCorpse 点 HP（不超过自身 def.hp），
   * 并将 absorbsAttacksFrom 列出的 defId 的攻击追加到自身 absorbedAttacks（战斗内即生效）。
   */
  corpseEating?: {
    hpGainPerCorpse: number;
    absorbsAttacksFrom?: string[];
  };

  /**
   * 菌群鱼女王：shieldedBy 列出的 defId 中任意一只存活时，本敌人无法被玩家选为攻击目标。
   * （checkActionAvailability 守·照 chain-eel isSegmentReachable 套路）
   */
  shieldedBy?: string[];

  /**
   * 菌群鱼女王工蜂补充：女王每次行动前，若场上 spawnDefId 类敌人数量 < minCount 则自动补至 minCount。
   * maybeReplenishDrones 在 runEnemyTurn 开头调用；仅带此字段的敌人才进该分支。
   */
  droneReplenish?: {
    spawnDefId: string;
    minCount: number;
    maxPartySize: number;
  };

  /**
   * 口孵深鱼（maternal mouthbrooder）：母鱼护巢仔行为系。
   * - 玩家攻击命中护巢仔（shieldedBy 列出的 defId）时，interceptChance 概率把伤害转移到母鱼
   *   （maybeInterceptJuvenile·以 armorWhileProtected 替代 def.armor 计算截击减伤）。
   * - 母鱼 HP < 50% 时，于己方回合开头消耗一只存活护巢仔回血（maybeConsumeJuvenile·per-turn 自然节流）。
   * - 护巢仔全灭后母鱼 enrage（phaseAttacksOverride = enragedAttacks·applyMaternalEnrageIfAlone）。
   * interceptChance ≥ 1 → rollChance 不消耗 RNG ⇒ 零额外 RNG 成本·既有 combat baseline 逐字节不变（守 #99）。
   * 仅声明本字段的敌人进对应分支；普通敌人逐字节不变。
   */
  maternalBehavior?: {
    /** 截击路径母鱼的有效甲值（代替 def.armor；护巢仔全灭后直接攻母鱼仍走 def.armor） */
    armorWhileProtected: number;
    /** 护巢仔受攻击时截击概率（≥1 = 必截且零 RNG·defer-number-tuning·数值占位） */
    interceptChance: number;
    /** 消耗护巢仔的回血量（母鱼 HP < 50% + 有存活护巢仔时触发·per-turn 一次·数值占位） */
    consumeJuvenileHpGain: number;
    /** 护巢仔全灭后的狂暴攻击替换（写入 phaseAttacksOverride·复用 BossPhase 同款字段） */
    enragedAttacks: EnemyAttack[];
  };

  /**
   * 茧化居民（metamorphosis·new-engine）：
   * - 幼体（metamorphosisStage='larva'）passive——不发起攻击。
   * - 玩家氧气降至 ≤ cocoonTriggerOxygen → 茧化（armor 替换为 cocoonArmor·计时 cocoonMaxTurns 回合）。
   * - 茧化期被击穿（hp→0）→ 奖励 cocoonBreakBonus 掉落，随即以成体复活（hp=adultHp·攻击=adultAttacksOverride）。
   * - 茧化计时归零 → 羽化成体（hp=adultHp·攻击=adultAttacksOverride·恢复正常 armor）。
   * 阶段跟踪在 EnemyInstance.metamorphosisStage / cocoonTurnsLeft / phaseArmorOverride。
   */
  metamorphosis?: {
    cocoonTriggerOxygen: number;
    cocoonArmor: number;
    cocoonMaxTurns: number;
    adultHp: number;
    adultAttacksOverride: EnemyAttack[];
    cocoonBreakBonus?: LootEntry[];
    /**
     * 茧被击破（hp≤0）时的收束：缺省/false＝**成体复活**（既有行为·Puffer/Warden 破茧羽化更凶）；
     * true＝**销毁**（不复活·卵/易碎茧用·「不打掉就孵化、打掉即毁」·SPEC §9.5 eggs·2026-07-07）。
     */
    breakDestroys?: boolean;
  };

  /**
   * Puffer 自爆（The Warren·蜂群 boss SPEC §9.9）：胀成活炸弹的单位——被**近战**攻击、或到点（其
   * 敌人回合）自爆，对玩家造成 AoE 伤害；**远程击破不触发溅伤**（拉距 / 换鱼叉·气动枪＝解法·刀斧近战会吃爆）。
   * 战斗无位置（party 制）⇒ AoE 落点＝玩家（SPEC 只述「对玩家」）。
   * **武装门**：带 metamorphosis 的 def 仅 **adult** 态武装——larva/cocoon 期击破安全（＝「趁茧别让它孵」·§5）；
   * 无 metamorphosis 的 def 恒武装（从头就是炸弹的地雷类）。判定见 combat-mechanics.ts::pufferArmed。
   * **仅带本字段的敌人进自爆分支** ⇒ 普通敌人 EnemyInstance/combat 流逐字节不变（守既有 baseline·#99）。
   * 数值 / 文案占位·defer（§10·待作者调）。
   */
  selfDestruct?: {
    /** 自爆对玩家的体力伤（占位·defer-number-tuning）。 */
    staminaDamage: [number, number];
    /** 可选：自爆附带理智伤（占位·缺省＝无理智伤）。 */
    sanityDamage?: [number, number];
    /** 近战击破 / 到点自爆时推入 log 的叙事（克制冷短句·守剧透红线 quirk #117·不点古文明关联·§2）。 */
    detonateText: string;
    /** 远程「隔水拆除」击破时推入 log 的叙事（可选·缺省＝静默死亡）。 */
    defusedText?: string;
  };

  /**
   * The Warren 女王（the Gravid Queen·蜂群 boss SPEC §4/§9.1）：被巢一节节「撤」向更深处 + 死后崩解。
   * **仅女王 def 带此字段**；她本身无攻击（威胁来自巢·§5·别给她塞 attacks）。
   * relocate 是否真的触发由 CombatState.warrenRoom?.isHatchery 门控——死角（the Hatchery）禁撤 ⇒
   * 女王在此退无可退、可被打死＝取胜（§4）；非死角房间 HP 比例 ≤ exposureThreshold 时巢把她拽走、
   * 本场以「房间清空·女王逃脱」收束（combat.ts::maybeSwarmQueenRelocate → finalizeSwarmRelocate），
   * 下一间她满血重来（回满血＝「被喂 Spawn/卵」的表现层·§4）。数值 defer（§10·待作者调）。
   */
  swarmRelocate?: {
    /** 暴露窗阈值：女王 HP 比例 ≤ 此值（且非死角）时巢把她撤向下一间（0..1·待作者调）。 */
    exposureThreshold: number;
    /** 被巢拽向更深处的叙事（maybeSwarmQueenRelocate 推入 log）。 */
    relocateText: string;
    /** 女王 HP→0（只会在死角）后的崩解叙事（maybeSwarmCollapse 推入 log·§9.6）。 */
    collapseText: string;
  };

  /**
   * The Warren 女王·吼叫 / 信息素（蜂群 boss SPEC §5·2026-07-07 作者加）：女王每敌方回合开头可吼叫释放**一种**
   * 信息素（maybeWarrenPheromone·敌方回合起手·女王仍无攻击表·威胁来自巢）。三效果按**条件优先级**择一：
   *   ② detonatePuffers：场上有 armed Puffer → 令其**立即引爆**（复用 detonateSelfDestruct）。
   *   ③ forceHatch：场上有茧/卵 → 令其 cocoonTurnsLeft→0 **立即孵化**（下个 maybeMetamorphosis 羽化）。
   *   ① cocoonBoostChance：给符合条件（larva·带 metamorphosis）的单位一个**立即结茧**概率（↑结茧率）。
   * roarChance 为吼叫触发概率（占位·1=每回合·rollChance≥1 零 RNG·作者调低节流）。**仅女王 def 带此字段** ⇒ 普通敌人逐字节不变。
   * 数值 / 文案占位·defer（§10·守剧透红线 quirk #117·不点古文明·§2）。
   */
  warrenPheromones?: {
    /** 每敌方回合吼叫释放信息素的概率（占位·1=必吼·rollChance≥1 零 RNG）。 */
    roarChance: number;
    /** 信息素①：给 larva·带 metamorphosis 的单位立即结茧的概率（缺省/0＝不启用①）。 */
    cocoonBoostChance?: number;
    /** 信息素②：令所有 armed Puffer 立即引爆（缺省/false＝不启用②）。 */
    detonatePuffers?: boolean;
    /** 信息素③：令所有茧/卵 cocoonTurnsLeft→0 立即孵化（缺省/false＝不启用③）。 */
    forceHatch?: boolean;
    /** 吼叫叙事（推入 log·占位·克制冷短句）。 */
    roarText: string;
  };

  /**
   * The Warren 女王·产卵 / 召唤（蜂群 boss SPEC §5/§9.5·2026-07-07 作者加）：敌方回合开头，若场上**活的非女王
   * 单位** ≤ lowUnitThreshold → 女王立即产下若干**卵**（eggDefId·passive 计时实体·不打掉就孵化成敌人·复用
   * metamorphosis·maybeWarrenReinforce）。产卵数 = baseCap + warrenHunt.roomsCleared × capPerRelocate（**每次被
   * 击退／relocate 上限递增**·roomsCleared 派生·不入存档·§9.5 quirk #99），受 maxPartySize 场上硬上限约束。
   * **仅女王 def 带此字段** ⇒ 普通敌人逐字节不变。数值占位·defer（§10）。
   */
  warrenReinforce?: {
    /** 场上活的非女王单位 ≤ 此数 → 触发产卵（占位）。 */
    lowUnitThreshold: number;
    /** 基础一次产卵数（占位）。 */
    baseCap: number;
    /** 每次被击退（warrenHunt.roomsCleared）额外 +n 产卵上限（占位·escalation）。 */
    capPerRelocate: number;
    /** 产的卵 defId（卵＝passive 计时实体·hatches to 敌人·复用 metamorphosis）。 */
    eggDefId: string;
    /** 场上总单位硬上限（防爆场·同 droneReplenish.maxPartySize）。 */
    maxPartySize: number;
    /** 产卵叙事（推入 log·占位）。 */
    layText: string;
  };
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
   * 水鬼运行时穿戴的「皮囊」id（startCombat 写入·来自 loot-trigger 的尸体来源·缺省 def.defaultSkin）。
   * finalizeVictory 经 effectiveLoot 用它从 def.skinLoot 选 loot 变体；undefined = 非水鬼/未指定 → def.loot。
   * 仅带 skinLoot 的敌人会被写此字段 ⇒ 普通敌人 EnemyInstance 形状逐字节不变（守 #99 + 既有 combat baseline）。
   */
  wornSkin?: string;

  // ——— 裂球（splitBehavior）运行时追踪 ———
  /** 本次检查周期内玩家对此敌造成的累计伤害（maybeEnemySplit 读写）。 */
  splitDamageAccum?: number;
  /** 上次分裂检查时的回合号（0-indexed·未检查 = undefined）。 */
  splitLastCheckTurn?: number;

  // ——— 清道夫（corpseEating）运行时追踪 ———
  /** 从已死亡敌人处吸收的额外攻击（enemyAttackPlayer 合并到攻击池末尾）。 */
  absorbedAttacks?: EnemyAttack[];

  // ——— 茧化居民（metamorphosis）运行时阶段 ———
  /** 当前发育阶段（larva / cocoon / adult）。未声明 metamorphosis 的敌人不写此字段。 */
  metamorphosisStage?: 'larva' | 'cocoon' | 'adult';
  /** 茧化阶段剩余回合数（归零时羽化成体）。 */
  cocoonTurnsLeft?: number;
  /**
   * 阶段临时装甲覆盖（茧化期间替换 def.armor；成体羽化后清除）。
   * enemyAttackPlayer 用此值代替 def.armor 计算物理减伤（仅 physical）。
   */
  phaseArmorOverride?: number;
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
