// 物品 schema —— 装备、消耗品、材料、剧情物品

export type ItemCategory =
  | 'equipment'
  | 'consumable'
  | 'material'
  | 'story'
  | 'currency';

// 装备槽（9 槽纸娃娃·作者 2026-06-19）。历史 key 名沿用以最小化改动面：
//   tool   ＝ 武器·主（近战·潜水刀·事件 hasEquipment{slot:'tool'} 的「用刀」选项都认它）
//   ranged ＝ 武器·副（双持武器占主+副两格·单手只占主）
//   charm/charm2/charm3 ＝ 饰品 1/2/3（升级「饰品槽」依次解锁第 2、3 槽·最多同时戴 3）
//   sonar  ＝ 声呐（独立槽·新增）
// 中文 UI 标签（潜水衣/气瓶/潜水灯/声呐/武器主/武器副/饰品）在 ui 层映射，不进引擎键名。
// 备注：tankhouse(气瓶库=beacon 基础氧气) 与 salvage_guild(打捞行会=Mira) 不是装备、不进纸娃娃。
export type EquipmentSlot =
  | 'tank'
  | 'suit'
  | 'light'
  | 'sonar'
  | 'tool'
  | 'ranged'
  | 'charm'
  | 'charm2'
  | 'charm3';

/**
 * 全部装备槽的**单一来源**（9 槽·作者 2026-06-19）。需要「遍历所有槽」的地方（dev 面板 /
 * 两个 serializer …）一律 import 此处，别再手写 `['tank','suit','light','tool','charm']`——
 * 那种散落数组会随加槽漂移（CLAUDE.md「想守住的约定落成机制、别落散文」）。住在本类型旁＝
 * 改 union 一眼看到要同步的数组，且本文件零依赖（serializer 引它不破「纯数据层无引擎依赖」）。
 * 下面的穷尽性断言把约定焊成 typecheck 门：往 EquipmentSlot 加了新成员却忘补进数组，
 * `_slotsExhaustive` 立刻编译失败（Exclude 不为 never）；写错槽名则被 `satisfies` 挡下。
 */
export const EQUIPMENT_SLOTS = [
  'tank', 'suit', 'light', 'sonar', 'tool', 'ranged', 'charm', 'charm2', 'charm3',
] as const satisfies readonly EquipmentSlot[];

type _SlotsExhaustive = Exclude<EquipmentSlot, (typeof EQUIPMENT_SLOTS)[number]> extends never ? true : never;
const _slotsExhaustive: _SlotsExhaustive = true;
void _slotsExhaustive;

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
    /**
     * 在港口物品栏点击此道具＝摊开海图（与「摊开海图」按钮同效·受同一 tutorial_complete 门控）。
     * 用于「旧海图」（item.old_chart·从沉船带回的旧海图＝解锁海图的信物·归「其它」tab·作者 2026-06-18）。
     * 数据驱动·无硬编码 id。
     */
    opensChart?: boolean;
    /**
     * 该道具标记的海图坐标（POI id 列表·「文献坐标」功能·作者 2026-06-18）：物品详情陈列这些点，
     * 已可下潜的点可点击→跳海图并选中它。旧海图标记一章四锚点；后续藏宝图/带坐标的日志复用同一字段。
     * 数据驱动·引擎 resolveMarkedPois 对照当前海图给出名字/可达性，UI 据此渲染。
     * **物品即解锁**（作者 2026-06-19）：持有标记某点的道具＝已知该坐标，引擎 poiRevealState 据此揭示它
     * （绕发现门 requiresFlags + 灯塔/揭示圈·仍受能力/天气门）——单一真相＝你手里有没有写着坐标的那张纸。
     * 见 engine/items.ts::poisKnownFromItems + engine/chart.ts::documentKnowsPoi。marksPois 的 id 必须命中
     * authored anchor（playthrough-chart 守成 regress 门·拼错＝静默不揭示＝软锁）。
     */
    marksPois?: string[];
    /**
     * 获得此道具（进 profile.inventory）时一并置位的 story flag（物品即里程碑·作者 2026-06-19）：
     * 「持有那张纸＝你做过那件事」。在 engine/state.ts::acquireIntoProfile 单点兑现 ⇒ 不论从哪条路拿到
     * （回港 loot 并入 / Mira 回购 / devGrantItem 作弊发物）都解锁。sticky·幂等（扣道具不撤 flag）。
     * 用于「带坐标的文献顺带解锁其区域基建」：如鲸落手记 setsFlag `story.ch1.whalefall_found` ⇒
     * 同时揭示坐标（documentKnowsPoi·marksPois）+ 开鲸落区圈/营地可建/找寻点握手（flag 侧）。
     * flag 必须 ⊆ allStoryFlags()（playthrough-story §5b 扫全 src/data·已自动守门·quirk #118）。
     */
    setsFlag?: string[];
  };
}

export interface EquipmentMeta {
  slot: EquipmentSlot;
  baseLevel: number;
  /** 装备基础属性效果（Lv.1 基线） */
  effects: EquipmentEffect[];
  /**
   * 逐件升级步（Otto 改装·作者 2026-06-19·物品栏与装备 SPEC §4）。
   * steps[k] = 从 Lv.(k+1) → Lv.(k+2) 的账单 + 该级**增量** statDeltas（叠加在 effects 之上）。
   * 当前等级实力 = effects + Σ(steps[0..level-2].statDeltas)，由 engine/equipment.ts::getEquipmentStats 单点算。
   * 缺省/空 = 不可升级（恒 Lv.1）。maxLevel = baseLevel + upgradeSteps.length。
   */
  upgradeSteps?: UpgradeStep[];
  /**
   * Otto 打造账单（段2·作者 2026-06-19）：该件**从空槽打造出来**（null→Lv.baseLevel）要吃的料 + 金。
   * 有此字段＝该件可由 Otto 用材料打造进空槽（声呐＝收集材料后花钱打造）；缺省＝不可打造（起手件 / Mira 购买件）。
   * 与 upgradeSteps 互补：craftCost 管「从无到有」、upgradeSteps 管「逐级变强」。账单形状同 UpgradeStep（便于端口数值）。
   */
  craftCost?: { materials: { itemId: string; qty: number }[]; gold: number };
}

/**
 * 一步逐件升级（账单 + 该级增量效果）。materials/gold 复用升级账单格式
 * （与 upgrades.json 的 cost 同形，便于段2 端口数值）。
 */
export interface UpgradeStep {
  materials: { itemId: string; qty: number }[];
  gold: number;
  /** 升到该级时**叠加**的属性增量（与 EquipmentMeta.effects 同 kind·getEquipmentStats 累加）。 */
  statDeltas: EquipmentEffect[];
}

export type EquipmentEffect =
  | { kind: 'staminaMaxBonus'; value: number }
  | { kind: 'oxygenMaxBonus'; value: number }
  | { kind: 'physicalArmor'; value: number }
  | { kind: 'sanityResist'; value: number }
  | { kind: 'lightRadius'; value: number }
  | { kind: 'unlocksAction'; actionId: string }
  // 声呐件专属（段2·作者 2026-06-19）：声呐从「升级线」迁成「Otto 打造的装备件」。
  // 数值 kind 名沿用 UpgradeEffect 同名字段＝逐级数值 1:1 端口（对账逐项相等·见 deriveSensorTuning）。
  // unlockSonar＝Lv.1 base（装上即解锁声呐能力·声明用·getEquipmentStats 不读 base·解锁由「声呐槽是否有件」派生）。
  | { kind: 'unlockSonar'; value: boolean }
  | { kind: 'sonarPingCostReduction'; value: number }
  | { kind: 'sonarRobustness'; value: number }
  | { kind: 'sonarRangeBonus'; value: number }
  | { kind: 'sonarScanRangeBonus'; value: number }
  // 灯/电池/规避「档位件」base 效果（A·作者 2026-06-20·退役的灯/电池/规避升级做回固定属性件·别重建 upgrades.json 三线）。
  // 这些 kind 喂 deriveSensorTuning 的同名旋钮：lighthouses.ts::getRunBonuses 改读 eq.*（替段2 的字面 0）。
  // 固定属性件数值全在 base effects（不升级·getEquipmentStats 读 base）；与声呐件（数值在 upgradeSteps）互补。
  | { kind: 'lampEfficiency'; value: number }
  | { kind: 'lampRobustness'; value: number }
  | { kind: 'lampRangeBonus'; value: number }
  | { kind: 'signatureReduction'; value: number }
  | { kind: 'soundAbsorbBonus'; value: number }
  | { kind: 'camoBonus'; value: number }
  | { kind: 'powerMaxBonus'; value: number }
  // 武器件伤害（C·作者 2026-06-20）：combat 玩家攻击 dmg += Σ weaponDamage（roll 后·armor 前·见 engine/combat.ts）。
  | { kind: 'weaponDamage'; value: number };

export interface ConsumableMeta {
  /** 在哪些场景可用 */
  usableIn: ('port' | 'dive' | 'combat')[];
  /** 使用效果（直接套用 Outcome 子集） */
  effectOnUse: {
    deltas?: Partial<Record<'stamina' | 'oxygen' | 'sanity' | 'nitrogen', number>>;
    text?: string;
  };
  /**
   * 急救包语义（负伤 SPEC §8·data-driven 同 decoy.kind 套路·非硬编码 id）：使用时对身上
   * **每处**伤按其 `InjuryDef.heal.medkit` 字段生效（cure 移除/downgrade 降档/none 不动——
   * 「全部能治的一起处理」·作者拍 2026-06-12）。治疗只走 injuries.ts::healInjury 唯一入口。
   */
  medkit?: boolean;
}
