// 战斗系统类型 —— 与战斗系统 SPEC §2–§7 对齐

import type { Stat } from './state';
import type { EquipmentSlot } from './items';
import type { EnemyInstance, EnemyParty, EnemyPartyMemberDef, DamageType } from './enemies';

/** 玩家行动定义（数据驱动） */
export interface CombatAction {
  id: string;
  name: string;
  description: string;

  /** 资源消耗 */
  costStamina: number;
  /** 额外氧气回合消耗（不含战斗基础 tick） */
  costOxygenTurns: number;

  /** 解锁条件 */
  requiresEquipment?: EquipmentSlot;
  requiresItemId?: string;
  /** 是否消耗物品 1 件（消耗品） */
  consumesItem?: boolean;
  /** 解锁该行动的等级（用于潜水刀的"刺击"等高阶动作） */
  minEquipmentLevel?: number;

  /**
   * 兜底攻击（拳脚扭打）：仅在「手里没有任何可用武器攻击」（无解锁武器 + 无弹药）时才上可见清单；
   * 有刀/斧/带弹远程时**隐藏**——避免被武器严格压制（伤更低·体/氧更贵·噪声更高）的死按钮常驻菜单。
   * 缺省 false ＝ 照常显示。判据单点见 combat.ts::hasUsableWeaponAttack（只看持有·不看体/氧）。
   * 仅影响**可见菜单**：checkActionAvailability/applyPlayerAction 不读此字段 ⇒ 直接 invoke 仍照常生效。
   */
  fallbackOnly?: boolean;

  /** 目标 */
  targeting: 'single' | 'self' | 'all_enemies';

  /** 效果（联合类型；引擎按 kind 派发） */
  effect: ActionEffect;
}

export type ActionEffect =
  | AttackEffect
  | DefendEffect
  | RecoverEffect
  | FleeEffect
  | CrowdControlEffect
  | UseItemEffect;

export interface AttackEffect {
  kind: 'attack';
  damage: [number, number]; // 物理伤害区间
  damageType: DamageType;
  /** 命中后给敌人附加状态 */
  applyStatusOnHit?: { kind: 'stunned' | 'bleeding' | 'frightened' | 'distracted'; turns: number };
  /** 攻击声响等级（影响增援触发） */
  noise?: number;
}

export interface DefendEffect {
  kind: 'defend';
  /** 减伤百分比（0–1） */
  damageReduction: number;
  /** 持续回合数 */
  turns: number;
}

export interface RecoverEffect {
  kind: 'recover';
  deltas: Partial<Record<Stat, number>>;
  /** 是否受攻击会打断（被打断时按 disruptPenalty 扣属性） */
  disruptable?: boolean;
  disruptPenalty?: Partial<Record<Stat, number>>;
}

export interface FleeEffect {
  kind: 'flee';
  /** 基础脱战成功概率（0–1） */
  baseChance: number;
  /** 失败时被敌人攻击的次数 */
  failExposure: number;
  /**
   * 必定成功（猎手 SPEC §4「decoy 战斗内脱战」·北极星「decoy 永远是出路」）：跳过掷骰直接脱战。
   * 烧一枚消耗品＝代价本身，故可全效（区别 §3 升级规避的守地板）。缺省 false＝旧 flee 掷骰不变。
   */
  guaranteed?: boolean;
}

export interface CrowdControlEffect {
  kind: 'crowd_control';
  /** 对所有敌人威胁度的修改 */
  threatDelta?: number;
  /** 对所有敌人附加的状态 */
  applyStatusToAll?: { kind: 'stunned' | 'frightened' | 'distracted'; turns: number };
  /** 高于此威胁度的敌人会逃跑 */
  scareThreatThreshold?: number;
}

export interface UseItemEffect {
  kind: 'use_item';
  /** 引用 items.json 的 consumable.effectOnUse */
}

/** 玩家在战斗中的临时状态 */
export interface PlayerStatus {
  kind: 'evading' | 'ambushing' | 'panicked';
  /** 剩余回合数；evading/ambushing 通常 1 */
  remaining: number;
  /** 效果参数（如减伤系数） */
  param?: number;
}

/** 一次战斗的运行时状态 */
export interface CombatState {
  combatId: string;
  encounterId: string;

  /** 当前战场上的敌人 */
  enemies: EnemyInstance[];
  /** 待加入战斗的潜在敌人池（噪声/理智阈值触发增援） */
  reinforcementPool: EnemyParty['joinRules'];

  /** 玩家状态 */
  playerStatuses: PlayerStatus[];

  /** 战斗已进行回合 */
  turn: number;

  /** 战斗叙事日志（这次战斗内的所有事件） */
  log: CombatLogEntry[];

  /** 战斗结束后跳转的事件 id（来自 encounter.victoryEventId） */
  victoryEventId?: string;
  /** 战斗结束后回到的节点 id（脱战后回 nodeSelect） */
  resumeNodeId: string | null;

  /**
   * 本次 flee 行动脱战成功的标记（typed flag）：
   * applyFlee 成功（掷骰过 / guaranteed）时写入，applyPlayerAction 第 5 步读取后走 finalizeFlee。
   * 日志文案由此降级回纯叙事（不再靠「脱战成功」子串判定·quirk #107 现代化）。
   */
  pendingFleeSuccess?: boolean;

  /**
   * 战斗内动态生成敌人（裂球分裂 / 女王补工蜂）的单调序号：spawn 时读 `?? 0` 起步、用完回写。
   * 取代 Date.now()+i——同毫秒多批次 spawn 必撞 instanceId（applyAttack 按 id map 更新会一击打多只
   * + React key 冲突）。缺省 0＝无 spawn 战斗形状不变（#99 守则·不 bump SAVE_VERSION）。
   */
  spawnSeq?: number;

  /**
   * 已「自行离场」的敌人 instanceId（runEnemyTurn fleeing 分支置 hp=0 离场时记录）。
   * finalizeVictory 据此跳过其战利品——#244 裁决「逃跑/吓退不给材料」：只有真被打死的敌人掉料；
   * 被玩家在其转身逃跑时砍死（hp 因攻击归零）仍算击杀、照常掉料。缺省＝无人逃走（普通战斗形状不变）。
   */
  fledInstanceIds?: string[];

  /**
   * 水鬼占据玩家尸体战斗专属：胜/逃后路由回此 DeathRecord 的 corpse subPhase，让玩家仍可打捞物品。
   * 未设（普通战斗）→ finalizeVictory/finalizeFlee 走原有路由（victoryEventId / rest）。
   */
  sourceCorpseId?: string;

  /**
   * boss 阶段索引（instanceId → 当前已触发的最高阶段索引）。
   * 缺省/不在 map 里 = -1（尚未进入任何阶段）。
   * 仅有 phases 的敌人才会有条目，普通敌人不写——零存档影响（#99 守则）。
   */
  bossPhaseIndices?: Record<string, number>;

  /**
   * 链鳗（分节实体）：本场是否「按序攻击」分节链（startCombat 从 enc.attackInOrder 写入）。
   * true ⇒ target 解析锁定最前存活节 + checkActionAvailability 拒打后节 + enemyAttackPlayer 按存活节数派生威胁。
   * 缺省/false ⇒ 无序多成员 party 逐字节不变。CombatState 不入存档（战斗态不序列化）⇒ 零存档影响。
   */
  attackInOrder?: boolean;

  /**
   * 低理智幻觉遭遇（感知重做 SPEC §2.3/§7① 形态 a·「改怪物」的怪物半边）：本场战斗是你**疯出来的**，
   * 不是世界里真有东西——北极星「是你疯了、不是世界骗你」。startCombat 从 enc.hallucination 或
   * StartCombatOptions.hallucination（注入钩子复用 zone 怪时用后者·不改共享 def）写入 CombatState。
   * 效果（全部 gate 在 combat.ts::这场是幻觉时）：敌攻**不扣真实体力·不留伤**（幻爪打不穿你）——
   * 代价软化到理智/氧气/慌（sanityDamage 照扣＝「你自己的脑子」·氧气照 tick）；胜/看破后**无战利品**、
   * 收场文案暧昧（「你眨眼，那里只有空水」＝它从没在那儿）。**永不能靠它把你打死**（0 体力伤＝无脚本死·
   * 北极星）；理智耗尽仍是既有「疯狂上浮」（非怪物击杀）。缺省/false ⇒ 真遭遇逐字节不变。
   */
  hallucination?: boolean;

  /**
   * The Warren 背水一战标记（蜂群 boss SPEC §4·作者 2026-07-08 三卵室重设计）。
   * **死角是状态、不是地点**：三间卵室都是 hatchery，女王随机起于其一、被打退随机换一间，撤进第三间
   * ＝无处可退。故本标记由 startCombat 从**追猎进度**派生（`warrenHunt.roomsCleared >= WARREN_LAST_STAND_ROOMS`），
   * 不再是某个「最深房间」的静态属性（旧 `warrenRoom.isHatchery` 已废——它在三卵室下会全局为真、
   * 令女王从第一间起就不撤、储备到处只出不进，§4「前两间打不死她」当场塌掉）。
   * true ⇒ 女王 relocate 禁用（`maybeSwarmQueenRelocate`）+ 崩解取胜可落地（`maybeSwarmCollapse`）
   *        + 繁殖储备零恢复（`warrenRecoverReserve`·§15.1 净耗尽硬护栏·quirk #234）。
   * scenario/adhoc 可用 `StartCombatOptions.warrenLastStand` 直接构造（不动 roomsCleared ⇒ 产卵上限不变）。
   * 缺省 ⇒ 不写 ⇒ 逐字节不变。CombatState 不入存档（战斗态不序列化）⇒ 零存档影响。
   */
  warrenLastStand?: boolean;

  /**
   * The Warren 女王在暴露窗被巢「撤走」的标记（typed flag·sibling of pendingFleeSuccess）：
   * maybeSwarmQueenRelocate 命中阈值时置，applyPlayerAction 据此走 finalizeSwarmRelocate（房间清空·女王逃脱）。
   * 缺省 ⇒ 无 ⇒ 普通战斗逐字节不变。
   */
  pendingSwarmRelocate?: boolean;
}

export interface CombatLogEntry {
  turn: number;
  actor: 'player' | 'enemy' | 'system';
  text: string;
}

/** 战斗 encounter 数据（来自 enemies/*.json 的 combatEncounters） */
export interface CombatEncounterDef {
  id: string;
  party: { members: EnemyPartyMemberDef[] };
  /** 进入战斗的过场文本 */
  introText?: string;
  /** 胜利后跳转的事件 id */
  victoryEventId?: string;
  reinforcementPool?: EnemyParty['joinRules'];
  /**
   * 高等级遭遇前序叙事（boss 设计蓝图 2026-06-21）：true + introText 有值时，enterCombat 先切到
   * pre_combat 子阶段让玩家读文案确认后再进战斗。缺省/false → 直接进战（逐字节不变）。
   * 仅 EventView 触发的 combat 走这条；猎手伏击走 startCombat 直接路径（不停顿）。
   */
  showIntro?: boolean;
  /**
   * 链鳗（分节实体·boss 设计蓝图 2026-06-21）：标记本遭遇为「按序攻击」分节链——
   * party.members 即节序（**头在末端**·index 0 = 最前节·须先死），玩家每次只能命中**最前存活节**，
   * 前节死后才解锁下一节（combat.ts target 解析 + checkActionAvailability 双层门）。
   * 缺省/false ⇒ 普通无序多成员 party（wreck_field_patrol / spider_crabs_pair）逐字节不变——
   * 新约束**仅**对显式标 true 的遭遇生效。check-enemy-refs (c4) 验证标了的遭遇节序合法（≥2 节 + 末节带 headEnrage）。
   */
  attackInOrder?: boolean;
  /**
   * 猎手档案（猎手 SPEC §2.2 per-encounter「给现有敌打标签、不是加敌」）：该遭遇被选为猎手
   * （zone ambushEncounters → maybeSpawnStalker）时的个体差异。缺省/缺字段 → 沿用深度派生默认（逐字节不变）。
   */
  stalker?: StalkerProfile;

  /**
   * 低理智幻觉遭遇（感知重做 SPEC §2.3/§7① 形态 a·「改怪物」的怪物半边·与 EventOption.hallucination 对称）：
   * 标 true → 这场遭遇是玩家**低 san 疯出来的**（不是真敌）。startCombat 据此把 CombatState.hallucination 置 true，
   * 由 combat.ts 软化结算：敌攻 0 体力伤·不留负伤 + 胜利无战利品 + 暧昧收场文案。**永不能靠它把你打死**（北极星）。
   * 数据侧可显式声明幻觉专属遭遇；低 san 注入钩子（dive-stalker.ts::maybeHallucinationEncounter）复用 zone 现有
   * ambushEncounters 时改走 StartCombatOptions.hallucination（不改共享 def）。缺省/false ⇒ 真遭遇逐字节不变。
   */
  hallucination?: boolean;

  // The Warren 房间标记 `warrenRoom.isHatchery` **已删**（作者 2026-07-08 三卵室重设计）：死角是**状态不是地点**，
  // 由 startCombat 从 `run.warrenHunt.roomsCleared` 派生进 `CombatState.warrenLastStand`。遭遇 def 不再承载它。
  // scenario/adhoc 要构造背水一战 → `StartCombatOptions.warrenLastStand`（见 combat.ts）。
}

/**
 * per-encounter 猎手档案（猎手 SPEC §2.2/§5/§6/§7 多样性）。全部可选——只写差异、其余按深度派生。
 * 数据住各 enemies/*.json 的 combatEncounters；engine/stalker.ts::maybeSpawnStalker 合并。
 */
export interface StalkerProfile {
  /** 它靠什么感官锁定你（§2.2）：light / sound / both。缺省 → 深度派生（深=both·浅=sound/light 交替）。 */
  sensesBy?: 'light' | 'sound' | 'both';
  /** 主动探测（§2.2/§2.3 后期型）：searching 态会自己发探测重新咬上（T2 迷彩可规避·§3）。 */
  active?: boolean;
  /** 执着度（§6）：守窄缝口外的回合预算。执着等待者给大值（缺省 STALKER_PATIENCE）。 */
  patience?: number;
  /** 个体速率（§7 速率分布·边分数/回合）。缺省 STALKER_HSPEED。 */
  hspeed?: number;
  /** 体型覆盖（§5）：'large' 钉死大型（钻不进窄缝）/ 'small' 钉死小型（无视深度派生）。缺省 → 按深度。 */
  size?: 'small' | 'large';
  /**
   * 嗅觉覆盖（负伤 SPEC §6.1 scent 第三通道）：钉死这只猎手嗅不嗅得到血。
   * 缺省 → 按遭遇成员的 EnemyDef.scent 派生（任一成员嗅觉系即 true）。
   */
  scent?: boolean;
}
