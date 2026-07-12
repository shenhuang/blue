// 敌人 schema —— 与战斗系统 SPEC §4 对齐

import type { EventOption } from './events';
import type { StatusInstance, StatusKind } from './status';

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

export type DamageType = 'physical' | 'electricity' | 'fire';
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
export type EnemyRole = 'predator' | 'gatekeeper' | 'swarm' | 'ambusher' | 'boss' | 'miniboss';

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
  /**
   * 运行时指定茧化阶段（The Warren 到达路由注入卵＝'cocoon'·蜂群 boss SPEC §9.5/§15·buildWarrenArrival）。
   * 仅带 metamorphosis 的 def 生效；缺省 startCombat 置 'larva'（既有遭遇逐字节不变）。
   */
  metamorphosisStage?: 'larva' | 'cocoon' | 'adult';
  /**
   * 运行时/encounter 级词条覆写（敌人词条系统试点单词条随机化修正·2026-07-12）：encounter 或 scenario
   * 显式钉死这只成员开战时带的词条集，绕开 def.randomAffixes 的随机抽取，用于确定性测试（baseline 复现）。
   * 优先级最高——见 combat.ts::startCombat：`m.affixesOverride ?? (randomAffixes 抽取 or def.affixes)`。
   * 普通 JSON 遭遇不设此字段·不影响任何既有 combat baseline（镜像 attacksOverride/wornSkin 的覆盖写法）。
   */
  affixesOverride?: string[];
}

/** 敌人定义（数据模板） */
export interface EnemyDef {
  id: string;
  name: string;
  tier: EnemyTier;

  // —— 基础属性（攻击力=各 EnemyAttack.damage / 防御力=defense / 生命=hp·战斗系统改版 2026-07-10）——
  hp: number;
  defense: number; // 防御力（原 armor 改名 2026-07-10）：resolveDamage 物理减伤基值。阶段/母鱼截击的临时覆盖仍叫 phaseArmorOverride / armorWhileProtected（派生自此）。
  speed: number;

  /**
   * 词条（affix·敌人词条系统试点 2026-07-12）：id 数组，∈ src/data/affixes.json（check-boundaries
   * 规则九守·非法/重复 id 直接拦）。效果单一源 engine/affixes.ts + engine/combat.ts 的接线点
   * （berserk 二次攻击 / nimble 经 resolveDodge / hardshell 防御力乘数 / regen 回合开头回血 /
   * venom 命中挂毒）。加法可选字段，缺省＝无词条 ⇒ 既有敌人逐字节不变（守 #99）。
   */
  affixes?: string[];

  /**
   * 随机词条（敌人词条系统试点单词条随机化修正·2026-07-12）：开战时从 `pool`（缺省 = 全部已注册词条 id）
   * 不放回随机抽 `count` 个（engine/affixes.ts::rollAffixes），写入该敌人实例的 `EnemyInstance.affixes`——
   * 与上面固定 `affixes[]` 二选一（`randomAffixes` 存在时优先·见 combat.ts::startCombat 的解析顺序）。
   * 未来按 tier 提高 count 是这里的天然落点（tier 越高词条越多）：先占位 count 写死，以后从 tier 派生。
   * 缺省（两个字段都不设）⇒ 无词条 ⇒ 既有敌人逐字节不变（守 #99）。占位·defer-number-tuning。
   */
  randomAffixes?: { count: number; pool?: string[] };

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

  // —— 抗性 ——（原 physicalDamage 顶层字段已删 2026-07-10：从未被引擎读取·伤害只来自各 EnemyAttack.damage）
  weakness?: Weakness[];
  immunity?: DamageType[];
  /**
   * 战斗状态布尔免疫（战斗状态系统 SPEC §2.5）：声明的 StatusKind 对它完全无效（不是减时长/减潜力，
   * 是压根不挂）。与上面 `immunity`（伤害类型免疫）正交——一个管「这种伤打不动它」，一个管
   * 「这种状态挂不上它」，命名并列区分。缺省/未声明 ⇒ 无免疫，任何 status 都能挂上（既有敌人逐字节不变）。
   */
  statusImmunity?: StatusKind[];

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
    /** 自爆对玩家的伤害（战斗系统改版 2026-07-10：原 staminaDamage·现落 HP·占位·defer-number-tuning）。 */
    damage: [number, number];
    /** 近战击破 / 到点自爆时推入 log 的叙事（克制冷短句·守剧透红线 quirk #117·不点古文明关联·§2）。 */
    detonateText: string;
    /** 远程「隔水拆除」击破时推入 log 的叙事（可选·缺省＝静默死亡）。 */
    defusedText?: string;
  };

  /**
   * The Warren 女王（the Gravid Queen·蜂群 boss SPEC §4/§9.1）：被巢一节节「撤」向**另一间卵室** + 死后崩解。
   * **仅女王 def 带此字段**；她本身无攻击（威胁来自巢·§5·别给她塞 attacks）。
   * relocate 是否真的触发由 CombatState.warrenLastStand 门控（**状态不是地点**·三卵室重设计 2026-07-08）——
   * 已撤过两次 ⇒ 她在第三间卵室背水一战、禁撤、可被打死＝取胜（§4）；否则 HP 比例 ≤ exposureThreshold 时
   * 巢把她拽走、本场以「房间清空·女王逃脱」收束（combat.ts::maybeSwarmQueenRelocate → finalizeSwarmRelocate），
   * 她在剩下两间中**随机**一间满血重来（回满血＝「被喂 Spawn/卵」的表现层·§4）。数值 defer（§10·待作者调）。
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
   * The Warren 女王·吼叫（蜂群 boss SPEC §5/§15·2026-07-07·#271 身体库存主线）：女王的**听得见的号令**一族——
   * detonate（引爆 armed Puffer）/ hatch（催孵茧卵）/ cocoon-boost（↑结茧率）。§15 起：这三支是六分支优先级树
   * （maybeWarrenQueenAct·§15.3）的**填充档**（都不满足 feed/screen/lay 时·按 detonate>hatch>cocoon-boost 序取一个
   * 有对象的执行）。**roarChance 已退役**——不再每回合无脑掷骰吼，改由优先级树按需触发（§15.6）。
   * detonatePuffers/forceHatch＝启用开关（缺省关）；cocoonBoostChance＝①每 larva 立即结茧概率。**仅女王 def 带此字段** ⇒
   * 普通敌人逐字节不变。数值 / 文案占位·defer（§10·守剧透红线 quirk #117·不点古文明·§2）。
   */
  warrenPheromones?: {
    /** cocoon-boost：给 larva·带 metamorphosis 的单位立即结茧的概率（缺省/0＝不启用）。 */
    cocoonBoostChance?: number;
    /** detonate：令所有 armed Puffer 立即引爆（缺省/false＝不启用）。 */
    detonatePuffers?: boolean;
    /** hatch：令所有茧/卵 cocoonTurnsLeft→0 立即孵化（缺省/false＝不启用）。 */
    forceHatch?: boolean;
    /** 吼叫叙事（推入 log·占位·克制冷短句·detonate/hatch/cocoon-boost 三支共用）。 */
    roarText: string;
  };

  /**
   * The Warren 女王·产卵（lay·蜂群 boss SPEC §5/§9.5/§15·2026-07-07·#271）：§15 六分支优先级树的**唯一补池支**
   * （maybeWarrenQueenAct 的 lay 分支·§15.2/§15.3）。作战单位少（活的非女王非茧单位 ≤ lowUnitThreshold）时女王产下
   * 若干**卵**（eggDefId·passive 计时实体·不打掉就孵化成敌人·复用 metamorphosis）。基础产卵数 = baseCap +
   * warrenHunt.roomsCleared × capPerRelocate（每次被击退递增·roomsCleared 派生·不入存档·quirk #99），受 maxPartySize
   * 场上硬上限约束。
   *
   * **繁殖储备节流（fecundity reserve·#271 作者拍·退役 droneReplenish·防死角补池跑步机·§15.1）**：女王有一个内置
   * 储备值（EnemyInstance.layReserve·缺省 reserveMax）——**每次产卵消耗 reserveCostPerLay·每女王回合缓慢恢复
   * reserveRecoveryPerTurn**。储备低时：①产卵**间隔拉长**（minLayInterval + (1-储备比)×lowReserveIntervalBonus）；
   * ②每次**产卵量按储备比缩减**（ceil(基础量×储备比)·见底＝0＝产不出）。**非死角**：储备照常恢复→节流会自纠到
   * **非零平衡**（低储备拉长间隔→间隔里多攒恢复），即「持续补池但压住速率」＝§15.1「前两间净不减」。**死角
   * the Hatchery**：`warrenRecoverReserve` 直接 no-op（**不恢复**）→储备只降不升→reserveMax/reserveCostPerLay 批后见底
   * 归零→补池熄火→池子只出不进＝§15.1 跑步机护栏的**结构保证**（**节流自纠平衡故单靠数值不保证净耗尽·死角硬止
   * 恢复才保证**·见 combat-warren.ts::warrenRecoverReserve）。**方向可调**：低储备→更慢更少是占位默认（作者若要
   * 「攒够爆发式大产」翻公式即可·defer-number-tuning）。**仅女王 def 带此字段** ⇒ 普通敌人逐字节不变。
   */
  warrenReinforce?: {
    /** 场上活的非女王非茧单位 ≤ 此数 → lay 分支触发（占位）。 */
    lowUnitThreshold: number;
    /** 基础一次产卵数（满储备时·占位）。 */
    baseCap: number;
    /** 每次被击退（warrenHunt.roomsCleared）额外 +n 产卵上限（占位·escalation）。 */
    capPerRelocate: number;
    /** 产的卵 defId（卵＝passive 计时实体·hatches to 敌人·复用 metamorphosis）。 */
    eggDefId: string;
    /** 场上总单位硬上限（防爆场）。 */
    maxPartySize: number;
    /** 产卵叙事（推入 log·占位）。 */
    layText: string;
    /** 繁殖储备上限（layReserve 初值·占位）。 */
    reserveMax: number;
    /** 每次产卵消耗的储备（占位·须 > recovery 才净耗尽）。 */
    reserveCostPerLay: number;
    /** 每女王回合缓慢恢复的储备（占位·<< cost ＝持续作战里净降）。 */
    reserveRecoveryPerTurn: number;
    /** 满储备时的产卵间隔基线回合数（占位）。 */
    minLayInterval: number;
    /** 储备见底时额外拉长的产卵间隔（占位·低储备→更长间隔）。 */
    lowReserveIntervalBonus: number;
  };

  /**
   * The Warren 女王·feed（献祭回血·蜂群 boss SPEC §4/§15.2·2026-07-07·#271）：§15 六分支优先级树的分支 1。**替换
   * §13 的 corpseEating 被动回血**——你清怪不再顺手喂她，只她**主动**献祭一只活单位（巢送进嘴·她不动）才回血。
   * 触发＝女王 HP 比例 ≤ triggerHpRatio（血低·§15.3①）且池子里有可献祭单位。按 sacrificePriority（defId 顺序·缺省
   * spawn→warden→egg·实例化 §4「吃 Spawn·Spawn 光了吃卵」）取第一个有活实例的种类吞一只——被吞单位 hp→0 并记入
   * fledInstanceIds（**不掉料**·#244 同款）。**茧不算献祭燃料·但 egg 例外**（§4 终局吃己卵·fork 2 impl 决议：茧不能拽
   * 出来当盾/献祭·唯 eggDefId 卵是女王的口粮）。**仅女王 def 带此字段** ⇒ 普通敌人逐字节不变。数值/文案占位·defer。
   */
  warrenFeed?: {
    /** 女王 HP 比例 ≤ 此值 → feed 进入候选（血低·§15.3①·占位）。 */
    triggerHpRatio: number;
    /** 每次献祭的回血量（不超 def.hp·占位）。 */
    hpGainPerSacrifice: number;
    /** 献祭优先顺序（defId·从上取第一个有活实例的种类·缺省时取任意活的非女王非茧单位）。 */
    sacrificePriority?: string[];
    /** 献祭回血叙事（推入 log·占位·克制冷短句·守剧透红线 #117·不点古文明）。 */
    feedText: string;
  };

  /**
   * The Warren 女王·screen（动态肉盾·蜂群 boss SPEC §5/§15.2·2026-07-07·#271）：§15 六分支优先级树的分支 2。**替换
   * §13 的静态 shieldedBy**——不再「有 warden/guard 活着就挡」，改为女王**主动**从池子拉 shieldCount 只活单位站到身前当
   * 肉盾（EnemyInstance.screeningFor＝女王 instanceId·checkActionAvailability 门读：有活 screener ⇒ 女王不可选中·杀穿
   * 才够得着她）。触发＝**近期对女王伤害**（EnemyInstance.recentDamageLog·滚动 recentDamageWindow 回合累计）≥
   * recentDamageThreshold（你突脸了·§15.3②）且当前无活 screener 且池子有可拉单位。**茧不算肉盾**（fork 2·茧不能站岗）。
   * **跑步机护栏**：池子空了就拉不出盾（screen 熄火）→ 暴露窗常开 → 可杀（§15.2·须与 swarmRelocate.exposureThreshold
   * 一起调）。开战时 warrenInitScreen 先起一层初始盾（否则第 1 回合女王裸露）。**仅女王 def 带此字段** ⇒ 普通敌人逐字节不变。
   */
  warrenScreen?: {
    /** 一次拉起的肉盾数 N（从池子取活的非女王非茧单位·占位）。 */
    shieldCount: number;
    /** 触发 screen 所需的近期对女王累计伤害阈值（滚动窗口内·占位）。 */
    recentDamageThreshold: number;
    /** 近期伤害滚动窗口回合数（占位）。 */
    recentDamageWindow: number;
    /** 拉起肉盾的叙事（推入 log·占位·克制冷短句）。 */
    screenText: string;
  };
}

export interface EnemyAttack {
  id: string;
  name: string;
  damageType: DamageType;
  damage: [number, number];
  description: string; // 战斗叙事文本
  weight?: number; // AI 选用此攻击的权重
  // 负伤系统整套下线（战斗系统改版 2026-07-10）：原 injuryOnHit（命中给玩家负伤）已删——伤害统一落 HP。
  /**
   * 命中后给玩家附加状态（战斗状态系统 SPEC §2.6）：镜像 AttackEffect.applyStatusOnHit——
   * 这是「敌人能给玩家上状态」的入口。确定命中（除非未来玩家有免疫）·纯堆叠·无 filter 去重。
   */
  applyStatusOnHit?: { kind: StatusKind; turns: number; dmgPerTurn?: number };
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
  stance: EnemyStance;
  aggro: number; // 对玩家的仇恨度
  statuses: StatusInstance[];
  /**
   * 词条运行时副本（startCombat 从 def.affixes 拷贝写入；未来「夺取」机制会 mutate 本字段——
   * def.affixes 是模板、这份才是这只具体敌人当下真正带的）。仅带 def.affixes 的敌人写此字段
   * ⇒ 普通敌人 EnemyInstance 形状逐字节不变（守 #99）。
   */
  affixes?: string[];
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

  // ——— The Warren 女王·身体库存主线（§15·#271·全不入档·CombatState 不序列化）———
  /**
   * 本单位正在为哪只女王当肉盾（screen·§15.2）：值＝女王 instanceId（warrenRaiseScreen 标·warrenInitScreen 开战起盾）。
   * checkActionAvailability 门读：目标女王有活 screener（screeningFor==该女王）时不可选中——杀穿肉盾才够得着她。
   * 仅被拉去当盾的单位写此字段 ⇒ 普通敌人逐字节不变。
   */
  screeningFor?: string;
  /**
   * 女王近期挨打的滚动记录（{turn,dmg}·screen 触发条件·§15.4「唯一真·新增战斗态」）：applyAttack 命中带
   * warrenScreen 的女王时追加、按 recentDamageWindow 修剪。screen 分支读窗口内累计伤害 ≥ recentDamageThreshold。
   * 仅女王（warrenScreen）写此字段 ⇒ 普通敌人逐字节不变。
   */
  recentDamageLog?: { turn: number; dmg: number }[];
  /**
   * 女王繁殖储备当前值（lay 节流·§15.1·缺省＝warrenReinforce.reserveMax）：warrenLayEggs 每次产卵消耗、每女王回合
   * 缓慢恢复。低→产卵间隔拉长 + 每次产卵量缩减（死角净耗尽跑步机护栏）。仅女王（warrenReinforce）写此字段。
   */
  layReserve?: number;
  /** 女王上次产卵的回合号（配 minLayInterval 节流·warrenLayEggs 写）。 */
  lastLayTurn?: number;
}

// EnemyStatus 已提升为共享 StatusInstance（战斗状态系统 SPEC §2.1·types/status.ts 单一源）——
// 玩家/敌人共用同一形状，DoT dmgPerTurn 现在改在**回合开头**（settleStatusesAtTurnStart）结算，
// 不再是「敌人回合末」专属。

/** 战场 EnemyParty */
export interface EnemyParty {
  members: EnemyInstance[];
  joinRules?: {
    triggerOnNoise?: { threshold: number; addFromPool: string[]; max: number };
  };
}
