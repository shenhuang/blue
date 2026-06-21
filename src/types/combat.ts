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
  | UseItemEffect
  | AmbushEffect;

export interface AttackEffect {
  kind: 'attack';
  damage: [number, number]; // 物理伤害区间
  damageType: DamageType;
  /** 命中后给敌人附加状态 */
  applyStatusOnHit?: { kind: 'stunned' | 'bleeding' | 'frightened' | 'distracted'; turns: number };
  /** 暴击的命中倍率（被屏息伏击触发） */
  ambushMultiplier?: number;
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

export interface AmbushEffect {
  kind: 'ambush';
  /** 下回合攻击的暴击倍率 */
  nextAttackMultiplier: number;
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

  /** 玩家在战斗中选择"应急上浮"时的标记 */
  pendingEmergencyAscent?: boolean;

  /**
   * 尸衣者占据玩家尸体战斗专属：胜/逃后路由回此 DeathRecord 的 corpse subPhase，让玩家仍可打捞物品。
   * 未设（普通战斗）→ finalizeVictory/finalizeFlee 走原有路由（victoryEventId / rest）。
   */
  sourceCorpseId?: string;

  /**
   * boss 阶段索引（instanceId → 当前已触发的最高阶段索引）。
   * 缺省/不在 map 里 = -1（尚未进入任何阶段）。
   * 仅有 phases 的敌人才会有条目，普通敌人不写——零存档影响（#99 守则）。
   */
  bossPhaseIndices?: Record<string, number>;
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
   * 猎手档案（猎手 SPEC §2.2 per-encounter「给现有敌打标签、不是加敌」）：该遭遇被选为猎手
   * （zone ambushEncounters → maybeSpawnStalker）时的个体差异。缺省/缺字段 → 沿用深度派生默认（逐字节不变）。
   */
  stalker?: StalkerProfile;
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
