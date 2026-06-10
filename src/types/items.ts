// 物品 schema —— 装备、消耗品、材料、剧情物品

export type ItemCategory =
  | 'equipment'
  | 'consumable'
  | 'material'
  | 'story'
  | 'currency';

export type EquipmentSlot = 'tank' | 'suit' | 'light' | 'tool' | 'charm';

export type ItemRarity = 'common' | 'uncommon' | 'rare' | 'legendary';

/** 物品在海底的衰减档位 —— 决定多少次 run 后会消失 */
export type DecayTier =
  | 'organic'    // 食物/活体：海里很快烂掉
  | 'consumable' // 药剂/弹药：水泡了之后失效
  | 'material'   // 材料：金属/骨/晶体；缓慢腐蚀
  | 'durable'    // 装备级硬物：极慢；指南针、潜水刀
  | 'eternal';   // 剧情物 / 永不消失：航海日志、家族遗物

/**
 * 材料深度分档（基建地图 SPEC §2.2）——只有 category==='material' 的物品才标。
 * 决定升级账单的稀有度门控（高阶升级要更深的料）+ Mira 回购门控（仅 T1/T2 可买回）。
 * T1 浅 0–25m / T2 中 25–44m / T3 深 40–55m / T4 50m+·cosmic。
 */
export type MaterialTier = 1 | 2 | 3 | 4;

/**
 * Decoy 类型（猎手 SPEC §4）：投放后骗哪种感官——声诱（骗声感）/ 光诱（骗光感）。
 * 双感猎手「光声任一都锁定」（§2.2）→ 任一种都上钩（难甩〔§3 取 min〕但易诱＝同一语义的两面）。
 * 定义放本文件（item 维度）避免 types/state ↔ types/items 循环（state.ts 已 import 本文件）。
 */
export type DecoyKind = 'sound' | 'light';

/** 物品定义 */
export interface ItemDef {
  id: string;
  name: string;
  category: ItemCategory;
  rarity: ItemRarity;
  description: string;
  /** 占用背包格子数（默认 1） */
  slotsRequired?: number;
  /** 负重（影响上浮速度与氧气消耗） */
  weight?: number;
  /** 出售价格（金币） */
  sellPrice?: number;
  /** 海底衰减档位（未填默认 material） */
  decay?: DecayTier;
  /** 材料深度分档（仅 material 物品有；引擎按它做升级稀有度门控 + Mira 回购门控） */
  tier?: MaterialTier;

  /**
   * decoy 道具才有（猎手 SPEC §4）：投放后骗哪种感官。dive-stalker.ts::deployDecoy /
   * combat 的 use_decoy 行动按它接线；缺省＝不是 decoy。
   */
  decoy?: { kind: DecoyKind };

  /** 装备物品才有 */
  equipment?: EquipmentMeta;

  /** 消耗品才有 */
  consumable?: ConsumableMeta;

  /** 剧情物品的 hook */
  story?: {
    triggersEventId?: string;
    unlocksLoreEntry?: string;
  };
}

export interface EquipmentMeta {
  slot: EquipmentSlot;
  baseLevel: number;
  /** 装备基础属性效果 */
  effects: EquipmentEffect[];
}

export type EquipmentEffect =
  | { kind: 'staminaMaxBonus'; value: number }
  | { kind: 'oxygenMaxBonus'; value: number }
  | { kind: 'physicalArmor'; value: number }
  | { kind: 'sanityResist'; value: number }
  | { kind: 'lightRadius'; value: number }
  | { kind: 'unlocksAction'; actionId: string };

export interface ConsumableMeta {
  /** 在哪些场景可用 */
  usableIn: ('port' | 'dive' | 'combat')[];
  /** 使用效果（直接套用 Outcome 子集） */
  effectOnUse: {
    deltas?: Partial<Record<'stamina' | 'oxygen' | 'sanity' | 'nitrogen', number>>;
    text?: string;
  };
}
