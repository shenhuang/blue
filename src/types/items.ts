// 物品 schema —— 装备、消耗品、材料、剧情物品

export type ItemCategory =
  | 'equipment'
  | 'consumable'
  | 'material'
  | 'story'
  | 'weaponMod'  // 武器改装组件（装入有 modSlot 的武器·见 engine/equipment.ts::installMod·命中时 combat 读 inst.mod 应用效果）
  | 'other'     // 杂项：非消耗/材料/装备/剧情的可点击道具（如清单·海图信物等）
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
 * 材料功能角色（材料主题一致性·2026-06-28·E/F 组·见 docs/playtest-findings.md）——仅 category==='material' 标。
 * 把「这块料是拿来做什么的」做成单一来源，供 check-build-material-theming 守门（结构档须 structural·禁纯生物料当结构）：
 *   - 'structural'：矿物/金属/硬壳——承重、塔基、锚位、井台（黄铜/铁结核/硫化矿/废合金/蛛蟹甲壳…）。
 *   - 'optic'     ：发光/透光件——灯室点亮、感知（冷光腺·离水不灭的灯芯）。
 *   - 'organic'   ：动物部件/食物/绳网/可卖货——非结构（鳗皮/章鱼喙/鲨牙/珊瑚〔货币〕…）。
 *   - 'special'   ：跨区/剧情特殊件（科考站模块）。
 * 设计准则：结构档吃 structural、点亮档吃 optic；生物料退出结构（回流装备/声呐/食物）。缺省＝未分类（视作非结构）。
 */
export type MaterialRole = 'structural' | 'optic' | 'organic' | 'special';

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
  /** @deprecated 背包承载已由「格数」改「重量」（2026-06-21·见 weightForItem）。曾用于旧格制占格（默认 1）。 */
  slotsRequired?: number;
  /**
   * 弹匣容量（一匣装几发·作者 2026-06-20）：仅可叠道具（弹药）设。背包承载改重量制后（2026-06-21·按 qty 线性·
   * weightForItem），它**不再决定占格/承载**，只剩**显示用途**：行前装包/物品栏把弹药按「弹匣」分格成组渲染
   * （一匣 ≤stackSize 发·最后一匣可能不满）＝更可读。例：AP-12 气动弹 stackSize 8、PR-40 鱼叉弹 stackSize 30。
   */
  stackSize?: number;
  /** 负重（用于背包承载 weightForItem 与装备负重档位 weightTier；与上浮/氧气无关·作者 2026-07-10 拍板解耦） */
  weight?: number;
  /** 出售价格（金币） */
  sellPrice?: number;
  /** 海底衰减档位（未填默认 material） */
  decay?: DecayTier;
  /** 材料深度分档（仅 material 物品有；引擎按它做升级稀有度门控 + Mira 回购门控） */
  tier?: MaterialTier;

  /** 材料功能角色（仅 material·材料主题一致性 E/F 组·check-build-material-theming 守门）。缺省＝未分类（视作非结构）。 */
  role?: MaterialRole;

  /**
   * 固定资源耗尽追踪的持久层级（POI 固定资源耗尽 SPEC·2026-06-25）。该 loot 物品被采集后，
   * 其所在「资源点」的耗尽记到哪一层：
   *  - 'save'：永久耗尽——采完就没（profile.harvestedResources·跨 run·该 POI 此资源永不再生）。
   *  - 'run'（缺省）：run 级耗尽——本次下潜内采过即空、下次重进（新 run）刷新（run.harvestedNodes）。
   * applyOutcome 在 loot 落包时读它记账（engine/items.ts::harvestPersistOf 单点·缺省 'run'）；
   * mapgen 据耗尽信息把已采资源点抹平成空节点（玩家在地图上看不到已采完的点）。
   * 仅对「固定地图 POI 下潜」（run.poiId 有值·seedKey=poi.id 同图）生效；非 POI 下潜（教学/scenario）不记账。
   */
  harvestPersist?: 'save' | 'run';

  /**
   * 该道具是否为「开阔海域有限矿藏」（开阔水域持久化 SPEC §4.2/§4.3·声明式意图标记）：
   * 标 true ⇒ 必须 harvestPersist === 'save'，否则 regress 红（scripts/check-openwater-harvest.mjs 守门）。
   * 缺省 undefined/false ＝ 不受此约束（可再生道具 / 非贴底采集道具都不必标）。
   * 焊的坑：engine/items.ts::harvestPersistOf 缺省 'run'（可再生·下次重进刷新），但「矿藏」类内容
   * 作者心智默认「采完没有」——两者相反。忘手写 'save' 不会报错，只会让矿藏静默变成采不完的刷子。
   * 本字段把「这是一块有限矿藏」的意图显式声明出来，让门替作者把关，而非指望每次都记得手写档位。
   * 当前（openwater 矿藏内容尚未落地）仓内可能没有任何道具标此字段——门对空集直接放行，是为未来焊坑。
   */
  deposit?: boolean;

  /**
   * 该道具赋予的能力标签（通用·不限 category）。与 events.ts hasCapability 条件配套使用：
   * hasCapability 同时扫装备槽（run.equipment）和当前潜水背包（run.inventory），任意来源匹配即满足。
   *
   * 设计意图：
   *   - 「工具家族」：多把刀都声明 'cut'，事件统一问 hasCapability('cut')，无需枚举每种刀。
   *   - 「背包工具」：相机/样本管等非装备道具也可声明能力（如 'photograph'），带下去就能用。
   *   - 新能力加字面量即可，事件侧零改动；反过来也成立：新事件只需声明所需能力，不关心谁提供。
   *
   * 注意：这里是顶层字段（ItemDef 级），不是 EquipmentEffect——非装备道具同样可以声明能力。
   */
  grantsCapability?: string[];

  /**
   * decoy 道具才有（猎手 SPEC §4）：投放后骗哪种感官。dive-stalker.ts::deployDecoy /
   * combat 的 use_decoy 行动按它接线；缺省＝不是 decoy。
   */
  decoy?: { kind: DecoyKind };

  /** 装备物品才有 */
  equipment?: EquipmentMeta;

  /** 消耗品才有 */
  consumable?: ConsumableMeta;

  /** 武器改装组件才有（category==='weaponMod'）：命中时的效果参数·数值全在此处供作者调（见 engine/combat.ts 应用）。 */
  weaponMod?: WeaponModMeta;

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
     * 该道具展示另一件装备的「打造账单」（材料清单道具专用·作者 2026-06-20）：
     * 值为目标装备 item id（如 `'item.sonar.handheld'`）。
     * LockerView 点开此道具时渲染 UpgradeCostView(showOnly) 展示打造所需材料 + 持有量。
     * 适用于 category='other' 的「清单类道具」——引擎不做任何处理，纯 UI 展示。
     */
    showsCraftCostOf?: string;
    /**
     * 获得此道具（进 profile.inventory）时一并置位的 story flag（物品即里程碑·作者 2026-06-19）：
     * 「持有那张纸＝你做过那件事」。在 engine/state.ts::acquireIntoProfile 单点兑现 ⇒ 不论从哪条路拿到
     * （回港 loot 并入 / Mira 回购 / devGrantItem 作弊发物）都解锁。sticky·幂等（扣道具不撤 flag）。
     * 例：手提探照灯 setsFlag `flag.owns_light`（持灯＝会用灯）。「带坐标的文献顺带解锁其区域基建」
     * 一类（setsFlag + marksPois 组合·揭示坐标同时开区域基建）原实例随藏宝/鲸落线移除、待重做。
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
  /**
   * 该武器是否接受改装组件（武器改装槽·作者 2026-06-20）：true ＝ 可由 Otto/港口把一件
   * category==='weaponMod' 的组件装进 EquipmentInstance.mod（见 engine/equipment.ts::installMod）。
   * 命中时 combat 读 inst.mod 按 id 分支应用效果（毒囊/倒刺/静音套/放电芯）。缺省＝不可改装。
   * 当前仅近战（tool 槽）支持全部组件；ranged/未来武器的专属组件后续再设计（SPEC 范围外）。
   */
  modSlot?: boolean;
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
  // 潜服保温（温度系统接线·2026-06-25）：累进 EquipmentStats.insulation，喂 engine/equipment.ts::loadoutInsulation
  // → 温度纯函数（intensity − insulation = 净暴露·见 engine/temperature.ts）。本棒单标量·不分热/冷保温（未来可拆）。
  // 当前无装备声明此 kind（保温全走 BASELINE_INSULATION 兜底）——给未来热/冷保温服的机制挂点（数值待作者调）。
  | { kind: 'insulation'; value: number }
  | { kind: 'lightRadius'; value: number }
  | { kind: 'unlocksAction'; actionId: string }
  // 声呐件专属（段2·作者 2026-06-19）：声呐从「升级线」迁成「Otto 打造的装备件」。
  // 数值 kind 名沿用 UpgradeEffect 同名字段＝逐级数值 1:1 端口（对账逐项相等·见 deriveSensorTuning）。
  // unlockSonar＝Lv.1 base（装上即解锁声呐能力·声明用·getEquipmentStats 不读 base·解锁由「声呐槽是否有件」派生）。
  | { kind: 'unlockSonar'; value: boolean }
  | { kind: 'sonarPingCostReduction'; value: number }
  // 声呐主升级轴（感知重做 SPEC §2.2「更远的声呐 = 预判未来的选项」）：一记 ping 的规划纵深跳数加成。
  // （旧 sonarRobustness〔抗假回波〕/ sonarRangeBonus〔深度降档 reach〕已随感知重做删——声呐诚实、深度不降档。）
  | { kind: 'sonarScanRangeBonus'; value: number }
  // 灯/电池/规避「档位件」base 效果（A·作者 2026-06-20·退役的灯/电池/规避升级做回固定属性件·别重建 upgrades.json 三线）。
  // 这些 kind 喂 deriveSensorTuning 的同名旋钮：lighthouses.ts::getRunBonuses 改读 eq.*（替段2 的字面 0）。
  // 固定属性件数值全在 base effects（不升级·getEquipmentStats 读 base）；与声呐件（数值在 upgradeSteps）互补。
  // （旧 lampRobustness〔抗幻觉〕/ lampRangeBonus〔灯深度 reach〕已随感知重做删——灯到即真、深度不降档。）
  | { kind: 'lampEfficiency'; value: number }
  | { kind: 'signatureReduction'; value: number }
  | { kind: 'soundAbsorbBonus'; value: number }
  | { kind: 'camoBonus'; value: number }
  | { kind: 'powerMaxBonus'; value: number }
  // 武器件伤害（C·作者 2026-06-20）：combat 玩家攻击 dmg += Σ weaponDamage（roll 后·armor 前·见 engine/combat.ts）。
  | { kind: 'weaponDamage'; value: number };

/**
 * 武器改装组件的命中效果（武器改装槽 SPEC·作者 2026-06-20）。装在有 modSlot 的武器上，玩家命中后
 * engine/combat.ts 按 `effect` 分支应用。数值全在 data（items.json）＝作者可直接调（不碰引擎逻辑）。
 *   - poison：概率给敌人挂「中毒」DoT（每回合 dmgPerTurn·持续 turns）。
 *   - barb  ：概率给敌人挂「撕裂(流血)」DoT（更重·dmgPerTurn 更高）。
 *   - silent：近战攻击不触发 signature 上升（战斗内＝该击 noise 归零·不惊动其它敌人）。无数值。
 *   - shock ：命中时若电量够则扣 powerCost、该击附加 bonusDamage（电量不足＝不触发·无副作用）。
 * 注意：敌人的中毒/撕裂走 StatusInstance DoT（敌人没有玩家那套 run.injuries·那是玩家专属·check-boundaries 规则四）。
 */
export interface WeaponModMeta {
  effect: 'poison' | 'barb' | 'silent' | 'shock';
  /** 命中触发概率 0–1（poison/barb/shock·缺省 1＝必触发）。 */
  chance?: number;
  /** 敌人 DoT 每回合伤害（poison/barb）。 */
  dmgPerTurn?: number;
  /** 敌人 DoT 持续回合（poison/barb）。 */
  turns?: number;
  /** 该击附加的即时伤害（shock）。 */
  bonusDamage?: number;
  /** 触发消耗的电量（shock）。 */
  powerCost?: number;
}

export interface ConsumableMeta {
  /** 在哪些场景可用 */
  usableIn: ('port' | 'dive' | 'combat')[];
  /** 使用效果（直接套用 Outcome 子集） */
  effectOnUse: {
    deltas?: Partial<Record<'hp' | 'stamina' | 'oxygen' | 'nitrogen', number>>;
    text?: string;
  };
  // 负伤系统整套下线（战斗系统改版 2026-07-10）：原 medkit 治伤旗标已删——急救包现只经 effectOnUse.deltas 回 HP。
}
