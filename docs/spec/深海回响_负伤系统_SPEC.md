# 深海回响 · 负伤系统设计文档

> 配套战斗 SPEC（`深海回响_战斗系统_SPEC.md`）的子文档。负伤 = **run 级身体债**：战斗里挣的，下潜里还的，回港才清账。
> 定调（作者拍·2026-06-12）：**死亡螺旋是意图**——潜水本来就该一步错步步错；耗氧增加都是特定伤害的副作用。伤有轻重：轻时效果小甚至无效（免费警告），重时极易导向死亡、或「瘫痪后等死」的绝望。
> 两条设计底线：① **身体面板默认诚实**（2026-06-12 修订：欺骗轴留给海——但第二章「精神错乱」可以干扰你对自身伤势的感知，见 §6.3/§9；骗你的从来不是 UI，是你的脑子，引擎与 baseline 永远持有真值）—— « 2026-07-10 理智系统移除 »：理智保险丝作废，**面板现无例外全诚实**（欺骗轴 TODO 见顶部 banner）；② **绝望来自看清算式不成立，而不是来自没有输入**——重伤收缩行动集为一组烂选项，绝不清空。
> 状态：开放问题 §12 二批已过（2026-06-12 晚·#117：12.2/3/4/5/6 已拍·**12.1 作者推翻两档封顶＝档位制重设计立项**，见 §3 修订注）。数值全部是起手值，以 baseline 调。
> 实装进度（2026-06-12·#116/#117）：**Wave 1 机制脊柱 + Wave 2 的 scent 第三通道（§6.1）+ medkit 治伤/上架（§8）已实装**——见 §11 勾选；数值（injuryOnHit 0.35/0.4、scent 半线/×1.5、§6 表）为起手值待 baseline 调。
> 文案口径（作者拍 2026-06-12·#117·quirk #120）：**全部系统/剧情文案改「事后挑错制」**——直接落库不前置过稿，作者实机读到不对再改；重大调性件（章节结局级）session 仍主动贴出。[待过稿] 标记自此只表「作者尚未读过」，不再挡实装。
> **⚠ « 2026-07-10 理智系统移除 »**：`run.stats.sanity` 已删。受影响：**`InjuryTierEffects.sanityTakenMult` + `DerivedModifiers.sanityTakenMult` 删除；伤种"惊惧"（`cause: sanity`）随 `DamageType 'sanity'` 一并作废；§6.3/§9 的「理智保险丝 / 错乱失真伤势感知」设计轴失去触发（低理智 tells 已不存在）→ 降为历史设想（面板现无例外全诚实）；精神类药（压 sanityTakenMult）失去载体。** 身体负伤主脊柱（bleed/rib/numb/burn·staminaCostMult/o2CostMult/staminaTickPerTurn/paralyzed 等）**不受影响**；装备 `sanityResist` 亦删（见物品栏 SPEC）。SAVE_VERSION 13→14（Stats 重塑·quirk #99 不迁移）。« TODO(作者)：错乱失真伤势感知这条"脑子骗你"欺骗轴是否改挂别的触发（毒/深度/特定 hazard）或整体下架 »

---

## 1. 设计目标

1. **螺旋是涌现的，不是脚本的**：负伤不直接杀人，只收窄余量（乘数），让环境来杀——同一处肋裂在 30m 是擦伤、在 150m 是死刑，陡度由深度自然放大，无需额外代码。
2. **警告先行**：轻伤近乎无数值效果，但永远可见。真正的决策点是「带着轻伤继续还是回头」——负伤是氧气之外的第二口压力钟。
3. **近战有真实风险**：近战行动可能挨伤，远程武器（鱼枪/弹药·后续）的 niche 是风险规避而非数值碾压。
4. **不引入距离段位**（战斗 SPEC §1 承诺不破）：`range` 只是行动的负伤风险标签，无站位、无距离数值、无目标段位。
5. **信息默认全透明**：伤势档位、生效效果、治疗路径三件套全程可见。螺旋越狠，面板越诚实，死亡才是「我早该上浮」而不是「这什么玩意儿」。« 2026-07-10 理智系统移除 »：理智保险丝作废→**面板现无例外全诚实**。

---

## 2. 作用域：为什么不并进 playerStatuses

现有 `combat.playerStatuses`（evading/ambushing/panicked）是**战斗作用域**——随战斗销毁。负伤的定义恰恰是「出了战斗还跟着你」——**run 作用域**。它在代码里的同类是 `DecompressionDebt`（`bendsRisk 0–4`·run 级身体债），不是 evading。

分工规则（两系统合作，不合并）：

- **当场/回合级效果 → playerStatuses**（现状不动）。例：麻痹·轻 = 战斗内跳 1 回合，走现有 status。
- **持续身体债 → `run.injuries`**（新增）。哪怕轻档零数值效果，也记录在案——它是升档计数器 + 可见警告。
- **统一读取点 → `computeModifiers`**（§5）：装备 × 负伤 × 战斗状态折成一个对象，combat 与 dive 都只从它读。这是 CLAUDE.md「落成机制」——否则消耗修正散成一地 if。

---

## 3. 数据模型

```ts
// types/injuries.ts（新）
export type InjuryTier = 1 | 2; // 1=轻 2=重（不做三档，升档即翻脸）

export interface InjuryDef {
  id: string;                    // 'injury.bleed' 等
  name: string;                  // 流血/肋裂/麻痹/灼伤
  /** 默认派生来源（敌攻击未显式指定 injuryId 时按 damageType 查本表） */
  cause: DamageType;
  /** [轻档效果, 重档效果]；字段缺省=无该项效果 */
  tierEffects: [InjuryTierEffects, InjuryTierEffects];
  heal: {
    medkit: 'cure' | 'downgrade' | 'none'; // 急救包当场：治愈/降一档/无效
    // 回港一律全愈（隐含，不写字段）
  };
  narrative: { onGain: string; onWorsen: string; onHeal?: string };
}

export interface InjuryTierEffects {
  staminaCostMult?: number;    // 行动体力消耗 ×
  o2CostMult?: number;         // 氧耗 ×（战斗 costOxygenTurns 与下潜移动同口径）
  staminaMaxDelta?: number;    // 体力上限 ±
  staminaTickPerTurn?: number; // 每战斗回合体力流失（流血）
  scentTrail?: boolean;        // 血腥味：scent 第三感官通道（§6）
  paralyzed?: boolean;         // 瘫痪态（§7）
}
```

```ts
// types/state.ts 追加（纯加字段·quirk #99 不 bump SAVE_VERSION）
run.injuries: { defId: string; tier: InjuryTier }[];   // 同时最多 3 处（可读性上限）
```

**档位状态机**：无 → 轻 → 重。同伤种再中招升一档；已是重档再中招**不再升级、无额外惩罚**（现状=Wave 1 实装形态）。不同伤种各自独立计档。超过 3 处上限时新伤顶替最轻的一处？——**不**：超限时新伤直接对「已有最轻伤种」升档（伤上加伤），列表永不超 3 行。

> **修订方向（作者拍 2026-06-12·#117·§12.1 答案＝推翻两档封顶）**：「应该符合现实逻辑——有些伤会引发瘫痪，有些引发别的恶劣状态，分情况；而且伤不该只有轻重两个等级。」⇒ 档位制升级为**每伤种自有升级路径**：档数逐伤种定（≥2）、顶档再中招按伤种**分情况转移**到别的恶劣状态（如流血→失血性虚脱、肋裂→气胸级行动限制、灼伤→感染链……具体表逐伤种设计）。schema 含义：`InjuryTier 1|2` → 每 `InjuryDef` 自带档位数组 + `escalatesTo` 类转移字段。**重设计立项、留专门 session**（牵动 #116 全部 baseline 与 modifiers 折算面·别在内容批次里顺手做）；Wave 2 其余项（药物/瘫痪/retaliation）设计时按本方向留接口、别再往两档假设上堆。

数据文件 `src/data/injuries.json`，与 items/actions 同风格。

---

## 4. 来源：怎么受的伤

### 4.1 敌人攻击

```ts
// types/enemies.ts EnemyAttack 追加
injuryOnHit?: { chance: number; injuryId?: string };
// injuryId 缺省 → 按 attack.damageType 查 injuries.json 的 cause 默认派生
// （肋裂这类"physical 但属挤压"由攻击显式 injuryId 覆盖，不加新 DamageType）
```

默认派生表（`cause` 字段）：physical→流血 · electricity→麻痹 · fire→灼伤。

### 4.2 近战暴露（远程武器的 niche 从这来）

```ts
// types/combat.ts CombatAction 追加
range?: 'melee' | 'ranged';   // 缺省 'melee'（现有刀/拳全近战，逐字节兼容）

// types/enemies.ts EnemyDef 追加
meleeRetaliation?: { chance: number; injuryId?: string };
// 玩家对该敌使用 range==='melee' 的攻击行动时掷骰；拳脚类行动可在数值上比刀更易触发
//（机制：retaliation 掷骰发生在玩家攻击结算内，与敌人回合的 injuryOnHit 互不重复）
```

「可能被反咬」的拳脚文案终于成真。鱼枪（Wave 3）`range:'ranged'` 免疫 retaliation——弹药稀缺换的就是这个。

### 4.3 非战斗来源（Wave 2 预留）

事件 Outcome 追加 op `addInjury: { injuryId, tier? }`——坠落/挤压/被暗流砸上岩壁等事件直接给伤。与 `setProfileFlags` 同级的 outcome 操作，事件侧纯数据。

---

## 5. 效果：computeModifiers 单点

```ts
// engine/modifiers.ts（新）—— 全游戏唯一折算点
export interface DerivedModifiers {
  staminaCostMult: number;   // 默认 1
  o2CostMult: number;        // 默认 1
  staminaMaxDelta: number;   // 默认 0（与装备 staminaMaxBonus 同点折算）
  staminaTickPerTurn: number;// 默认 0
  scentTrail: boolean;
  paralyzed: boolean;
}
export function computeModifiers(run: RunState, combat?: CombatState): DerivedModifiers;
```

**消费点清单**（实装时逐一接线，全部走本函数、禁止散读 `run.injuries`）：

| 消费点 | 文件 | 接什么 |
|---|---|---|
| 行动消耗结算 | `engine/combat.ts` | `costStamina × staminaCostMult`、`costOxygenTurns × o2CostMult`（向上取整） |
| 回合开始 tick | `engine/combat.ts` | `staminaTickPerTurn` 扣体力 + 日志 |
| 下潜移动/海流 | `engine/dive-move.ts` | 体力/氧消耗各乘对应 mult |
| 体力上限派生 | `engine/state.ts` | `staminaMaxDelta` 与装备加成同点折算 |
| 猎手/遭遇 | `engine/stalker.ts` 等 | `scentTrail` × `enemy.scent` 旁路判定（§6.1）+ 区域聚怪门控（§6.2·后置） |
| 行动集过滤 | `engine/combat.ts` / dive 行动层 | `paralyzed`（§7） |

与装备的关系：`EquipmentEffect` 枚举不动；modifiers 是折算层不是存储层。战斗 SPEC §2.2 的喘息线（体力 <30% 重行动附加氧耗）若实装，30% 按**修正后上限**算。

**机制化**（CLAUDE.md：约定要能在 regress 里失败）：① 每伤种配 combat scenario baseline（受伤→升档→修正生效的数值断言）；② 候选 lint：`engine/` 内 `run.injuries` 只允许 `modifiers.ts` 与治疗/添加两个入口触碰（check-boundaries 加一条，同 quirk #95 风格）。

---

## 6. 伤种表（5 起步·数值=起手值）

| 伤种 | cause | 轻（警告档） | 重（翻脸档） | medkit |
|---|---|---|---|---|
| 流血 `injury.bleed` | physical | 叙事 only（伤口按得住·不漏味） | 每回合体力 −2 + **scentTrail**（§6.1） | cure（止血是急救包的本职） |
| 肋裂 `injury.rib` | physical（攻击显式 injuryId） | 无效果 | **o2CostMult ×1.4**（呼吸变贵=run 变短） | none（回港才好） |
| 麻痹 `injury.numb` | electricity | 当场 1 回合跳过（走 playerStatus，不留债） | **paralyzed**（§7） | downgrade |
| 灼伤 `injury.burn` | fire | 当场小 tick（status，3 回合 −1） | **staminaMaxDelta −15** | downgrade |

### 6.1 流血 × 嗅觉：第三感官（作者拍·2026-06-12 修订）

血腥味是**第三感官通道（scent）**，与 light/sound 并列——但作为**逐敌能力**存在，不是全体敌人买单：

```ts
// types/enemies.ts EnemyDef（及 StalkerProfile）追加
scent?: boolean;   // 嗅觉系敌人（鲨/梭鱼类天然候选 true·管水母类 false）
```

> **名单已拍（作者 2026-06-12·#117·§12.2 答案）**：鲨 + 梭鱼 + **盲鳗**（食腐嗅觉系·蓝洞/热液场 ambush 敌＝流血·重在洞穴有真价格），**幼体一律随亲代**（梭鱼幼体/盲鳗幼体 scent:true·感官同亲代的既定口径）。蛛蟹/章鱼/沉灯水母不进。数值（现身线砍半/patience ×1.5）仍 baseline 调。

- **对 scent 敌人，流血·重期间光声纪律全部失效**：T2 迷彩、关灯、闭声呐照常只管 light/sound 通道；scent 通道直接判「已锁定」——searching 态自动重新咬上、unaware 直接 alerted。**骗局在你自己身上，常规欺骗工具自然失灵**（欺骗轴的玩家侧镜像）。
- **仅有的两个解法（北极星不破）**：decoy 照常 `guaranteed` 全效（设计法则而非拟真——烧消耗品=代价已付，猎手 SPEC §4「decoy 永远是出路」）；medkit 止血（bleed: cure）= 根治。光声手段省不下这支 medkit，这就是流血·重的真实价格。
- `maybeSpawnStalker`：场上有 scent 敌种的区域，流血·重时刷出概率 ×2、`patience` +50%（闻着血，等得起）。
- 跨 SPEC 注记：猎手 SPEC §2.2 的 `sensesBy: 'light'|'sound'` 对抗矩阵**不重写**——scent 是旁路（bypass）：实装为 `stalker.ts`/遭遇判定里 `modifiers.scentTrail && enemy.scent` 的短路分支；落地时在猎手 SPEC 补一行「第三通道」注记即可，机制层（#109 批）不重开。

### 6.2 区域嗅觉聚怪 + 水蛭（方向已拍·实装后置）

- **特定区域**标 `scentAttraction`（鲨水/礁区候选）：流血·重期间野外遭遇与战斗增援持续加权，**甚至源源不断——直到彻底止血**（吃现成增援池机制 + `scentTrail` 门控）。止血是唯一停闸：medkit 或回头。
- **水蛭（后期热带场景·第二章「恶心人」语境·§6.3）**：附着型 hazard，特别善于触发——**不拔=持续吸血**（每回合体力流失，不进伤种表）；**拔掉=流血伤**（进 scent 通道）。稳定流失 vs 暴露血味的两难。敌种还是事件形态、触发率，后续批次定——先记方向。

### 6.3 章节分层（作者拍·2026-06-12·与剧情 SPEC 章节制对齐）

伤害/负伤机制不是一次全开，按章节换主轴。**第二章深度不如第一章，难度的延续不靠更深的水，靠更难缠的机制**：

| 章节 | 主轴 | 负伤侧表现 |
|---|---|---|
| 第一章 | **基本下潜机制**·越深对手越大越强·机制雨露均沾 | 全伤种以轻量形态登场（流血/肋裂为主，electricity/fire 点缀）；难度由敌人体格/数值携带，负伤系统在这章是教学与警告 |
| 第二章 | **恶心的环境和精神损伤**（核心底色=恶心人）：精神错乱·不良状态·更强更久的毒·水蛭 | physical 威胁缩水，状态机制接棒：毒（新 DamageType `toxin`·长 tick·medkit 难解）、〔« 2026-07-10 理智系统移除 »：惊惧/理智失真伤势感知作废·徽章诚实契约不再被烧穿·此拍需另找二章"恶心"主轴〕、水蛭附着（§6.2）。**敌人/环境同一底色**：陷阱、瘴气、毒气、剧毒生物、水蛭式「拔也不是不拔也不是」的两难生物、寄生、产卵、疾病——现有鱼类只是范例，补内容批次再加符合背景的鱼类（喂周末引擎）。**真结局引入大深渊的情报** |
| 外传（二章后） | **冷热·环境耐受** | 伤来自环境而非敌人：`heat`/`cold` 伤种、zone hazard / 事件 `addInjury`（§4.3 正是入口）、耐受装备（防寒服等装备线=钥匙）——与番外「温度系统」大机制同口径（剧情 canon 五批⑪），难度从「打不过」变「待不住」 |
| 第三章 | **收集进入大深渊的条件**（门槛/转折章·**不是环境伤章**） | 伤害侧无新主轴，复用此前全部机制；条件收集可带流派味道（见下「大深渊双流派」） |
| 第四章 | **大深渊·无回头路** | 在无回头路处开启；倒置生存规则/层级单程归此；双流派落点 |

- 机制含义：§6 伤种表是第一章池。毒/水蛭属第二章、冻伤/灼热属**外传**内容批次，schema 不变（InjuryDef 通吃），只是 `cause` 枚举 additive 扩展（`toxin`/`heat`/`cold` 等·加枚举不 bump·quirk #99）。三/四章伤害侧无新主轴。（修订注：章节口径同日多次修订，**以上表为最终态**；剧情 SPEC §11 重写时回校。）
- « 2026-07-10 理智系统移除 »：整条边界作废（低理智 tells 不存在·徽章无失真态）。« TODO(作者)：欺骗轴若保留，换非理智触发 »
- 章节口径以剧情 SPEC 为准（其 §11 章节制重写后回校本表；本表只管伤害侧分工）。
- **大深渊双流派（方向记录·作者拍 2026-06-12 两批·远期，不在本 SPEC 展开）**：①**同化成海洋生物**（基因层面与深海本土生物融合）②**接纳古文明科技**（用科技在深海更好地生存）。共同算盘：**越接纳越强，但越回不去**——力量用归属支付。**镜像内核：古代文明当年就分裂成同样的两派**——玩家在探索中读到两派各自的遗产，并在自己身上**重复当年的选择**（流派不是发明出来的 build，是考古出来的旧路）。章节结构（作者拍定）：**二章真结局引入大深渊情报 → 外传（冷热耐受）→ 三章收集进入条件 → 四章在无回头路处开启**（倒置生存规则/层级单程归四章·与「失联=单程下行」同构）——剧情 SPEC §11 重写时落正。伤害侧含义一句话：负伤是「借的债，回港能还」，流派改造是「债转股」——负债变资产、但 profile 级永久（回港也不愈）。机制承载候选：同一 modifiers 折算层（压制层先例），存储升格 run→profile。后置待拍：两派遗产保持**道德对称**（别让任何一派读成「错误答案」，否则选择塌缩成最优解）；中途换边/兼修的代价；同化流派与「伤口长成了别的东西」的押韵；科技流派与灯塔线交点。三章「另一个世界」§3.7 口径不擅动。

---

## 7. 瘫痪态（重伤极值·绝望的形状）

瘫痪 ≠ 失能（战斗 SPEC §2.2 失能=体力 0 的战斗内状态）：瘫痪是负伤档位，**跨战斗/下潜两场景，体力满格照样瘫**。

行动集**收缩为烂选项，不清空**：

- **战斗内可用**：防御 / 使用物品（medkit·decoy）/ 应急上浮（`pendingEmergencyAscent` 现成·bendsRisk 直拉 IV）/「放手」。禁用：攻击、伏击、逃跑（游不动）。
- **下潜内可用**：移动只剩「爬行」（体力/氧消耗在 mult 之上再 ×2）/ 应急上浮 / 「放手」（`let_go` 在 abyssal 事件已有先例，复用其叙事口径）。
- 绝望感的来源是**算式**：玩家看着爬行氧耗算回程，发现回不去——而不是按钮变灰。
- **断片说衔接（quirk #117 红线）**：体力/氧归零照常切黑、港口醒来零解释。瘫痪与 let_go 的全部文案**不得泄漏死亡真相**（一二章零解释），文案一律 [待过稿]。

---

## 8. 治疗经济

- **轻伤=免费警告**：无（或近无）数值效果，但占一格徽章 + 是升档计数器。决策点前移到「继续还是回头」。
- **medkit 当场**：按 `heal.medkit` 字段——止血是本职（bleed: cure），骨头治不了（rib: none），麻痹/灼伤缓一档（downgrade）。
- **回港全愈**：一律清空（潜水病另走 `DecompressionDebt`，两套债互不吞并）。
- `item.med_kit` 已上架（#117·作者拍 2026-06-12）：sellPrice 25 → 买价 40 金·备货 2/次回港（同 decoy 一套 offer×markup·价/量后续可调）；治伤语义=**全部能治的一起处理**（一次使用对每处伤按各自 `heal.medkit` 生效·徽章承诺逐条兑现·`engine/injuries.ts::applyMedkitHeal` 唯一入口）。

**药物：租借机能，不治伤（作者拍·2026-06-12）**——与 medkit 的分工一句话：**medkit 治伤，药物买时间**。伤势底账照旧走，药只压制表现：

```ts
// ConsumableMeta 追加
drug?: {
  suppresses: (keyof InjuryTierEffects)[]; // 压制哪些效果字段（staminaCostMult/paralyzed…）
  durationTurns: number;                   // 战斗/下潜同一时间粒度
  crash?: { deltas: Partial<Record<Stat, number>>; text: string }; // 药退账单
};
// run.activeDrugs: { itemId, remainingTurns }[] —— computeModifiers 折算时套压制层
```

起手三件（数据先行·名字文案 [待过稿]）：

- **止痛剂**：压 `staminaCostMult`/行动限制类效果 N 回合。隐含代价：**压痛=压警告**——药效内同伤升档不提示（药物失真与理智保险丝同一「可归因」原则：你自己选的麻）。
- « 2026-07-10 理智系统移除 »：压 sanityTakenMult / 恢复面板可信皆失去载体·本药作废（余止痛剂/肾上腺素两件仍成立）。
- **肾上腺素**：即时回体力 + 药效内无视 `staminaMaxDelta`/`paralyzed`——**瘫痪自救窗口**（烂选项集再添一个烂选项：拿 crash 换几回合能动）。不修复任何伤势，药退必 crash（体力跌穿/短暂 panicked 候选）。

---

## 9. UI 约定（徽章诚实）

- `StatusBar.tsx` 伤势徽章：**档位 + 生效中的效果 + 治疗路径**三件套全可见（详情浮层）。轻伤显示「暂无影响·再受同类伤会加重」——警告就要说人话。
- 战斗里被禁用的行动显示原因（`combat.ts` 行动可用性已有 reason 先例，瘫痪复用）。
- 默认不做任何隐藏修正：欺骗轴留给海。文案 tone 写实（「右侧第三四肋按下去会陷」级别，不写数字化的「-40% 效率」——数字在浮层，正文是身体）。
- « 2026-07-10 理智系统移除 »：理智保险丝作废·徽章无例外全诚实。

---

## 10. 存档与回归

- `run.injuries` 纯加字段：`hydrateGameState` 单点补默认 `[]`（quirk #106——scenario fixture 必填化注意：**显式 `undefined` 会盖种子**，fixture 要么写全要么不写该 key），不 bump `SAVE_VERSION`（quirk #99）。
- **加内容必配 baseline**：每伤种 1 条 combat scenario（受伤→升档→修正数值断言），瘫痪 1 条（行动集断言），scent 1 条（嗅觉旁路：迷彩/关灯失效、decoy 仍 guaranteed 的断言）。命名沿 `scenarios/` 现有 `<zone>_<encounter>__<操作>.json` 风格。
- 迭代跑 `npm run regress -- --only typecheck,combat`；ship 前全量绿（28+ 任务照 CLAUDE.md 门）。

---

## 11. 实装切片

**Wave 1（机制脊柱·一个 session 可完成）** ✅ 已实装（2026-06-12·#116）
- [x] `types/injuries.ts` + `src/data/injuries.json`（先 bleed/rib 两伤种）
- [x] `run.injuries` + hydrate 默认 + 升档/上限逻辑（`engine/injuries.ts`：add/worsen/heal 三入口 + fixture `seedInjuries`）
- [x] `engine/modifiers.ts` + 消费点接线（combat 行动消耗〔availability 同口径〕/回合 tick + dive-move〔tickTurns opts + 洋流〕+ 体力上限 `effectiveStaminaMax`）
- [x] `EnemyAttack.injuryOnHit` 接入敌攻结算（鲨咬 0.35→bleed 派生、石斑侧撞 0.4→rib 显式；**仅带字段的攻击掷骰**＝既有 seed 基线不被搅）
- [x] `StatusBar` 最小徽章 + 详情浮层（点开式·`describeInjury` 三件套·文案 [待过稿]）
- [x] baseline：scenarios/combat 5 新 + 2 旧补 injuriesFinal（proc/升档/重档 tick/氧耗 ×1.4/一场走完轻→重）+ §5 机制化②候选 lint＝check-boundaries 规则四（run.injuries 触碰面收口）+ regress 29/29 全绿

**Wave 2（翻脸档全量）**
- [ ] 瘫痪态（行动集过滤·爬行·let_go 接线·文案 [待过稿]）
- [ ] `range` 标签 + `meleeRetaliation`（拳>刀的触发差）
- [x] scent 第三通道（`enemy.scent` 旁路判定 + spawn ×2〔阈值制翻译＝现身线砍半 `STALKER_SCENT_SPAWN_ALERT_MULT`〕+ patience +50%〔读点折算·止血回常〕·§6.1）——✅ 已实装（#116·名单已拍 #117：鲨/梭鱼/盲鳗+幼体随亲代〔§12.2〕；战斗侧 unaware→alerted 已接、现役敌种皆 alerted 起步＝暂潜伏；playthrough-stalker §20 含「摸黑/吸声失效但 decoy 仍 guaranteed」断言）
- [ ] 药物压制层（`ConsumableMeta.drug` + `run.activeDrugs` + modifiers 折算·止痛剂/肾上腺素两件起手·crash 接 panicked·§8）
- [ ] dread/numb/burn 三伤种 + 事件 `addInjury` op
- [x] medkit 接 `heal` 字段 + 上架——✅ 已实装（#117·sellPrice 25/买 40/备货 2·「全部能治的一起处理」·applyMedkitHeal 收口在 injuries.ts·combat baseline medkit_cure_bleed）

**Wave 3（远程武器兑现）**
- [ ] 鱼枪 + 弹药物品（`requiresItemId + consumesItem`·#108 现成管道；多弹种=多 action 条目，2–3 种内不加抽象）
- [ ] 噪声/装填的 tradeoff 数值（枪响 noise → 增援池已有机制）
- [ ] 区域 `scentAttraction` 聚怪（源源不断直到止血）+ 热带水蛭 hazard（§6.2）

**章节批次（随剧情进度走，不占 Wave 编号·§6.3）**
- [ ] 第二章（恶心人批）：`toxin` 伤种（长 tick·medkit 难解）+ 水蛭 hazard + 敌人/环境 palette（陷阱/瘴气/毒气/剧毒生物/寄生/产卵/疾病·配套鱼类内容批喂周末引擎）
- [ ] 外传：冷热/环境耐受（`heat`/`cold`·zone hazard + 事件 `addInjury` 入口·耐受装备线＝钥匙·番外温度系统同口径）

---

## 12. 开放问题（2026-06-12 晚二批·#117：1–6 已拍，答案就地记录）

1. ~~重档再中招~~ **已拍（推翻两档封顶）**：「应符合现实逻辑——有些伤引发瘫痪、有些引发别的恶劣状态，分情况；伤不该只有轻重两级」⇒ 档位制重设计立项（每伤种自有档数+顶档转移路径·详见 §3 修订注·留专门 session）。
2. ~~scent 名单~~ **已拍**：鲨 + 梭鱼 + 盲鳗，幼体随亲代（梭鱼幼体/盲鳗幼体 scent:true）；蛛蟹/章鱼/沉灯水母不进（§6.1 注记·数据已落 #117）。数值（现身线砍半/×1.5）仍 baseline 调。
2b. 轻档流血是否漏味？当前拍：**不漏**（伤口按得住·免费警告设计不破），「彻底止血」=重档被 medkit/回港清除；§6.2 聚怪区域是否连轻档也闻得到，留 baseline 试。
3. 惊惧×panicked（作废）—— « 2026-07-10 理智系统移除 »：惊惧整伤种作废·本问题无载体。
4. ~~瘫痪+哨站~~ **已拍：算获救**——爬到已点亮前哨=据点收容（绞盘/缆车叙事成立），瘫痪的绝望算式里留一个非 let_go 的远途出口（爬行 ×2 油钱照付）；Wave 2 瘫痪实装时接线。
5. ~~文案过稿流程~~ **已拍：全部系统/剧情文案改「事后挑错制」**（quirk #120）——不再前置过稿；重大调性件 session 仍主动贴出。
6. 错乱失真配比（作废）—— « 2026-07-10 理智系统移除 »：错乱失真轴失去理智触发·作废（欺骗轴 TODO 见顶部 banner）。
7. `toxin`/`heat`/`cold` 作为新 DamageType 的敌方 immunity 矩阵影响（additive；二章敌人/三章 zone 设计时一起过）。
8. 止痛剂「压痛=压警告」做不做全压（升档完全无提示 vs 留一句含糊叙事）？肾上腺素 crash 的具体形态与数值。
9. 精神类药恢复面板可信（作废）—— « 2026-07-10 理智系统移除 »：无失真面板可恢复·本问题作废。
10. 寄生/疾病类伤需要**按时间升档**（现状态机只按「再中招」升档）：InjuryDef 预留 `progression?: { afterTurns: number }` 自动恶化字段——schema 留门，Wave 1 不做；产卵类（潜伏后孵化=延时事件/敌人）超出负伤范畴，走 flag+定时事件，二章批次再定。
