# 深海回响 · 猩红暴君 boss / Scarlet Tyrant（吃活同伴夺词条 · 五波剧情杀 · 猎手逃离）SPEC

> **状态：v0 设计定稿 · 未实装。** 来源：2026-07-16 设计拍板 + 2026-07-17 Cowork 起草·Opus。Ch1 **第二个 boss**（承 [[scarlet-tyrant-boss]] 记忆 + HANDOFF 头号待办）。核心一句话——**一群「吃同类夺其优势」的头足猎手，逐波逼近，直到最大的那一只当着你的面吞掉自己的同伴、把它们的所有词条集于一身**。承接：敌人词条系统试点（#298·`affixes.json`/`combat-affixes.ts`）、The Warren 蜂群 boss 的「主动献祭回血 + phase 触发钩子」范式（`combat-warren.ts`）、猎手 SPEC（跨节点追猎 · `stalker.ts`）、战斗改版 #290（`resolveDamage` 对称 / 删闪避回归词条 / `hpMaxBonus` boss baseline）、开阔水域 SPEC（rock 海床 · `seedKey` 确定性重生 · `atSeabed`）。**数值 / 手感一律 defer**（`defer-number-tuning`）。**生物定位：`scarlet_kinslayer` 与 `scarlet_tyrant` 均头足类、非古文明、非人类**——叙述体守 `check-no-human-assertion` + `protagonist-voice`；「猩红暴君 / Scarlet Tyrant」＝**称号非人名**，可保中文（`no-transliteration-names` 只禁音译人名）。

---

## 0. 北极星 / 为什么

- **让玩家亲手体会「优势会被更大的捕食者夺走」**：这场战斗的母题是**兼并**——弱者被吃、其优势被吃它的那一只继承，层层向上收敛，直到顶端的那一只集所有优势于一身。玩家不是读到这条食物链，是**在自己一击落空、猎物被更大的怪抢吞的那一刻打出来**。
- **boss ＝规则变化，不是数值膨胀**（承 boss 蓝图北极星）：暴君的强不来自一张膨胀数值表，而来自**它吞掉的那几只弑亲者各自带的词条**（狂暴 / 灵巧 / 硬壳 / 自愈 / 剧毒）——它的能力是**你眼睁睁看着它从场上「拿走」的**。你越是放任小怪半血苟活，喂给它的就越多。
- **核心张力＝清场时机 + 目标取舍**：打小怪没秒掉 → 它被同类吃掉、对方更强；转头打暴君 → 剩下的弑亲者一起集火你。玩家每回合都在**「先清哪一只 / 要不要碰暴君 / 现在逃还是再拼一轮」**里做取舍（§6）。
- **主线 boss·可生存·无脚本死**（承 `combat-exit-semantics` / 开阔水域 `beginAscent`）：暴君阶段是一场**猎手追逃**——逃生阀门始终在（上浮 / 拉开距离 / 摸黑切信号），但**逃了主线不解锁、下次从头**（§8）。

---

## 1. 敌人 & 落点

### 1.1 两只敌人

| code id | 名 | 角色 | 现状 |
|---|---|---|---|
| `enemy.scarlet_kinslayer` | 猩红弑亲者 / Scarlet Kinslayer | 杂兵（现 `role:predator`） | **已存在**（#298·`src/data/enemies/scarlet_kinslayer.json`）·**未接进游戏·未提交** |
| `enemy.scarlet_tyrant` | 猩红暴君 / Scarlet Tyrant | boss（`role:boss`） | **新建** |

- **`scarlet_kinslayer`（已核对 JSON）**：`bands:["band.midwater.t4"]` · `biomes:["midwater"]` · `role:"predator"` · `tier:"uncanny"` · `hp:30` · `defense:1`（#290 `armor→defense` 后·非 `armor`）· `randomAffixes:{count:1}`（开战从全 5 词条随机抽 1）· 两条攻击 `kinslayer.rake`/`kinslayer.beak_bite`（腕足 + 喙·**头足解剖**）· 遭遇 `combat.scarlet_kinslayer_solo`（`affixesOverride:["berserk"]` 供 baseline 钉死）。**它的 codex `behavior` 已经写好了本 boss 的母题**：「也会猎食同类里最弱的：蜕壳的、负伤的、落单的。每吞下一只，便获得被吞噬者的生存优势。」——设计层只是把这句 flavor **机制化**（§2）。
- **`scarlet_tyrant`（新建）**：同族更大的个体·`role:"boss"`（`EnemyRole` 已含 `'boss'`·见蜂群 SPEC §9 引擎映射，impl 时复核 `types/enemies.ts`）· 自身 `hp` 撑 baseline（占位·defer）· 无攻击膨胀，威胁来自**吞并的词条**（§2/§3）· **不自带初始词条**（§3·全靠吃）。

### 1.2 落点：rock 类型开阔水域下部

- **区域**：rock（岩礁）zoneTag 的开阔水域**下部**（`zoneTag:'rock'`＝有海床档·`engine/seabed.ts::isFlooredOpenWaterTag`·开阔水域 SPEC §4a）。海床之上一片可漫游的水域，逐波深入（§4）。
- **`scarlet_kinslayer` 需改 band**：现挂 `band.midwater.t4`——**要从这条中层随机带里移除**，改落到本 boss 的落点（否则它会作为普通杂兵散在 midwater 随机池，与「boss 专属逐波追猎」冲突）。

### 1.3 ⚠ 落点机制更正（2026-07-17·已核实·务必按此实装）

**开阔水域遭遇不是固定的。** 开阔水域图**程序生成、无固定坐标**（`seedKey` 派生形状 + `zoneTag`/深度随机事件池）；`{kind:'atSeabed'}` Condition **只筛不钉**——它把「贴底专属」内容（珊瑚采集 / 矿床 / **巢穴 miniboss 前哨**…）限制在真正到海床的节点，但**不保证在哪个节点、更不保证必然出现**（开阔水域 SPEC §4a）。boss 要的是**确定性、必触发**的遭遇——这**不能**走随机池，而走**两条已有的固定通路**：

1. **`seedKey = poi.id` 确定性重生**（`startDiveFromPoi` 已传 `seedKey: poi.id`·开阔水域 SPEC §6①·quirk #98）：同一 anchor 每次下潜 ＝**同一张图**——落点、拓扑、逐波节点都可复现。
2. **POI story-pin 强制开场**（`dive-start.ts::applyStoryOpen`·「主线柱迁移」范式·2026-07-12）：在 rock openwater zone 上建一个 **chart anchor**，带 `story` 块——`beatFlag` 未置位时下潜**强制**其 `story.eventId` 作开场（打赢置 flag → 回流重访走普通下潜）。先例＝`poi.anchor.warren`（`src/data/chart_pois.json`·占位 anchor：`zoneId`/`requiresFlags`/`modifier.depthRange`/`owner` 一应俱全）。`startDiveFromPoi` 的分区路径**可指 openwater zone**（`createNewRun({zoneId: poi.zoneId})` → `startDive(poi.zoneId, …)`·zone 是哪种由 `getZone` 决定，不限洞穴）。

> **不新造「openwater 固定遭遇」系统。** boss 落点＝**「story anchor + 确定性种子」既有两件套**的组合，落在一个 rock openwater zone 上。
>
> **另注（不依赖项）**：有一条独立 lane 在把 openwater **持久化泛化**（把开阔水域当成「没有墙的洞穴」持久层）。**本 boss 不依赖它**——用上面两条既有通路即可自足；**若该持久层先落地，本 boss 的逐波图态自动继承**（届时 §4 的「波次不持久化重置」可改挂持久层，但那是后续优化，非本 SPEC 前置）。

---

## 2. 吃活同伴夺词条（新建机制 · 借范式）

**这是本 boss 的核心新机制。** 一只弑亲者 / 暴君在**自己的回合**吞掉身边一只**濒死的活同伴**，回血并**夺走它的词条**。

- **弑亲者**：自己回合吃身边**生命 ≤20%** 的活同伴 → **回被吃者的剩余血** + **夺其词条**（全体弑亲者都会·登场前几波它们**互吃**＝暴君登场前的「喂食预演」，让玩家先在小怪身上看懂这条规则）。
- **暴君**：胃口更大，吃**生命 ≤50%** 的活同伴（同样回剩余血 + 夺词条）。
- **触发时机**：吃食发生在**吃食者自己的敌方回合**（不是玩家击杀时的被动，也不是靠尸体）——放任一只小怪半血苟活到它的同伴回合，就可能被同伴吞掉。

### 2.1 范式来源（已核对代码）

| 借用范式 | 位置 | 借什么 / 差在哪 |
|---|---|---|
| `warrenFeed` / `warrenTryFeed` | `combat-warren.ts` | 借「**主动献祭一只活单位回血**」的形状：按优先级 `pickByPriority` 选一只可献祭单位、置其 `hp:0`、给吃食者回血。**差异**：`warrenFeed` 回**固定** `hpGainPerSacrifice`；本 boss 回**被吃者剩余血**（新变体·§11 风险①）。且 `warrenTryFeed` 挑「活·非女王·非茧（卵例外）」，本 boss 挑「活·非自己·**HP ≤ 阈值**的同类」。 |
| `corpseEating.absorbsAttacksFrom` / `maybeCorpseEat` | `combat-mechanics.ts`（quirk #156） | 借「**吸收被吃者能力**」的形状：`maybeCorpseEat` 在单位死亡时把死者 `defId` 的攻击并进吃食者 `EnemyInstance.absorbedAttacks`。**差异**：`corpseEating` 吸的是**攻击**、且发生在**尸体（死亡）**上；本 boss 吸的是**词条**、发生在**吃活同伴**上（§11 风险②）。 |

### 2.2 落点（impl 建议·占位字段名）

- 新钩子（形如 `maybeScarletFeed(state, eaterInstanceId)`）挂在**吃食者的敌方回合起手**，与蜂群 `maybeWarrenQueenAct` 同族（`runEnemyTurn` 里择一动作）。为守 `check-file-budget`，建议新文件 `combat-scarlet.ts`（参照 `combat-warren.ts` 从 `combat-mechanics.ts` 外移的拆法）。
- 新 `EnemyDef` 字段（占位·数值 defer）：形如 `scarletFeed{ hpThresholdRatio, healByVictimHp: true, stealAffixes: true, feedText }`——`hpThresholdRatio` 弑亲者 0.2 / 暴君 0.5（占位）；`healByVictimHp` 标「回被吃者剩余血」；`stealAffixes` 标「夺词条」。**不带该字段的敌人零成本 no-op**（守蜂群 SPEC §9「非对应 def 零成本」约定）。
- 被吃者置 `hp:0` 走**非战斗击杀**（不给玩家战利品·参照蜂群 feed 被吞进 `fledInstanceIds` 不掉料·quirk #248 区域 / #244）。

---

## 3. 词条系统（复用 #298 · 跨怪无放回 + 去重）

### 3.1 复用 #298 五词条（已核对 `affixes.json`）

单一真相 `src/data/affixes.json`——**恰好 5 个**，逐一核对：

| id | 名 | 效果单一源（`engine/affixes.ts` + `combat.ts` 5 接线点） |
|---|---|---|
| `berserk` | 狂暴 | 每回合额外攻击（`applyBerserkExtraAttacks`·`BERSERK_EXTRA_ATTACKS`） |
| `nimble` | 灵巧 | 闪避（`resolveDodge`·`NIMBLE_DODGE_CHANCE`）——**去重硬约束的主因，见 §3.3** |
| `hardshell` | 硬壳 | 防御力乘数（`HARDSHELL_DEFENSE_MULT`·`combat.ts` 内联 `applyAttack`） |
| `regen` | 自愈 | 己方回合开头回血（`applyRegenAtTurnStart`·`REGEN_HP_FRACTION`） |
| `venom` | 剧毒 | 命中挂毒（`applyVenomOnHit`·`VENOM_STATUS`） |

- **词条效果对任何持有者对称**（已核对 `combat-affixes.ts`「对称设计」注 + `resolveDodge` 单点）：这些钩子全部读**持有者实例的 `EnemyInstance.affixes` 数组**，不区分玩家 / 敌。⇒ **暴君夺到词条后无需新接效果**——只要把词条并进暴君实例的 `affixes`，既有钩子自动生效（这是「词条加持」几乎零成本的关键）。

### 3.2 一波内跨怪无放回（新建·遭遇层）

- **现状**：`rollAffixes(pool, count)`（`engine/affixes.ts`·Fisher-Yates shuffle-and-take）只保证**单怪内**抽 `count` 个不重复；每只敌人的 `randomAffixes:{count:1}` 是**各自独立**掷的，**跨怪会撞**（两只弑亲者可能都抽到狂暴）。
- **要求**：一波里的 N 只弑亲者（N=1/3/4/5）应各带**互不相同**的词条——这样玩家看得清「每只一个不同的优势」，暴君吃掉它们时也**收进 N 个不同词条**（读起来是「集大成」而非重复浪费）。
- **落点（新·遭遇层小机制）**：波次遭遇**程序化构造**（参照 `combat-warren.ts::buildWarrenArrival`），用一个**波级分发器**——对整波调**一次** `rollAffixes(AFFIX_IDS, N)` 取 N 个不同词条，逐一注入每个成员实例的 `affixes`——**绕开** `randomAffixes` 的逐怪独立掷（那会撞）。因 pool=5 且 N≤5，`rollAffixes` 天然给得出 N 个不同 id。
- **与 baseline**：`CombatScenarioInput` **无法内联 pin 词条**（quirk #248）——确定性测试要么依赖 seeded `rollAffixes` 的确定性来断言分发结果，要么把 `affixesOverride` 钉在**专供 baseline 的 encounter member** 上（该 encounter 从此永久钉死·别在别处引用·quirk #248）。

### 3.3 夺到重复 → 去重（硬约束）

- **为什么必须去重**：`nimble`（灵巧＝闪避）若在同一持有者身上**叠加**，闪避概率累加 → 逼近/超过 100% ＝**必闪避、打不动的卡死**。这是硬 bug 面，不是手感问题。
- **静态门已在**：`check-boundaries` **规则九**（已核对 `scripts/check-boundaries.mjs`）禁止**声明的**词条数组（`affixes` / `randomAffixes.pool` / `affixesOverride`）内出现重复 id。
- **运行时须镜像同一不变量（新要求）**：规则九只管**静态声明**；本 boss 的**运行时夺取**（把被吃者词条并进吃食者 `affixes`）必须在 merge 时**去重**——已持有则丢弃，保证 `EnemyInstance.affixes` 永远是**集合语义**（§11 风险④）。

### 3.4 暴君词条：5 封顶·不自带·全靠吃

- **不自带初始词条**（已拍·§11 待决②）：暴君登场时 `affixes` 为空。
- **5 词条封顶**：`AFFIX_IDS.length === 5`——集合语义 + 去重 ⇒ 天然封顶 5（吃满 5 个不同词条即到顶）。
- **进度**：第五波暴君登场**瞬吃 3 只 ＝ 3 个词条**（§5）；之后每再吃一只 **+1**（去重后·同波 5 只互不相同 ⇒ 全吃光即满 5）。

---

## 4. 波次编排（dive 声呐图逐波 · 非同场刷新）

**一次下潜、沿 openwater 图逐波深入。** 到达落点位置**主动攻击**触发第一场，每杀完一波在图上再深入撞下一波：

| 波 | 场上 | 说明 |
|---|---|---|
| 1 | **1 只**弑亲者 | 到位置主动攻击触发（story-pin 开场后进入·§1.3）。 |
| 2 | **3 只** | 深入一节。它们互吃预演开始（§2）。 |
| 3 | **4 只** | 密度升。 |
| 4 | **5 只** | 压迫最大的一波常规战。 |
| 5 | **5 只 → 暴君剧情杀** | 观察回合 + 剧情杀（§5）。 |

- **逐波＝分场，不是同场刷新**：每波一场独立战斗，波次间在**声呐图上深入**（节点移动）撞下一波——不是一场战斗里无限刷援。这天然接开阔水域逐节点推进 + 声呐诚实侦察。
- **数量 1→3→4→5 锁定**（已拍）。第五波 5 只、暴君吃 3 剩 2（§5·§11 待决①）。

---

## 5. 第五波：观察回合 + 剧情杀（演出定死）

**这是整场的戏剧支点。** 第五波不直接开打，先给一个**「观察回合」**：

1. **观察回合**：5 只弑亲者在场，**玩家先看到压迫**（5 只暗红影子·斑纹杂乱·逼近的阵形）——先感受「这波我大概扛不住」。
2. **触发器＝玩家选中一只发起攻击的那一刻**：玩家**第一次对任一弑亲者出手**＝触发。
3. **暴君登场·瞬吃 3·夺 3 词条**：那一刻暴君**破场而出**，当场**吞掉 3 只**弑亲者、集**3 个词条**于一身（剩**暴君 + 2 只**弑亲者继续打）。
4. **玩家那一击落空 / 被卷走**：**刀未落、猎物已被更大的怪抢吞**——你瞄准的那只被暴君先一步吞了，你的攻击打空 / 被水流卷开。这一拍把「兼并」母题顶到脸上。

### 5.1 实装（走暴君 phase 触发钩子）

- **拦截第五波首次攻击 → phase 脚本**：第五波战斗里，玩家**首次 `attack` 结算前**被拦截成一段 phase 脚本（登场 + 瞬吃 3 + 夺 3 + 让玩家那一击空掉）。
- **范式＝蜂群 `maybeWarrenQueenAct` 同类分支**（已核对 `combat-warren.ts`）：一个「女王 / 暴君择一动作」的敌方 phase 钩子，在特定条件命中时替换常规流程。这里对应「暴君 phase：首攻触发 → 登场吞并」的一次性分支。也可复用蜂群 `BossPhase`（`hpThreshold`/`transitionText`·蜂群 SPEC §9）承载登场演出。
- **暴君 baseline 撑住**：boss 战 baseline 要求玩家能扛过长战——**用 `bonuses.hpMaxBonus` 抬玩家 HP 上限**（`combatScenario.ts::ScenarioInput.bonuses.hpMaxBonus`·#290 boss baseline 范式）。⚠ **`hpMaxBonus` 是玩家侧 / scenario 侧加成**（`run.hpMax = HP_MAX + bonus`），**不是 `EnemyDef` 字段**；暴君**自身**的耐久＝它的 `hp` 字段 + 夺来的词条（§11 风险③）。
- **暴君回合行为**：登场后每回合 ①吃 ≤50% 的弑亲者回血 + 夺词条（§2）②以夺来词条加持的常规攻击打你。

---

## 6. 战术张力（核心闭环）

暴君登场后每回合的取舍就是本 boss 的可玩性：

- **打小怪没秒掉 → 它被同类 / 暴君吃掉**：你把一只弑亲者打到半血却没收尾 → 它的同伴或暴君在自己回合把它吞了 → **对方回血 + 变强**、你白费一轮。**逼你要么一口气清、要么别碰**。
- **打暴君 → 剩余弑亲者同时集火你**：转头集火暴君，场上其它弑亲者就腾出手来一起揍你——**分身乏术**。
- **⇒ 清场时机 + 目标取舍博弈**：先清小怪（断暴君的食源 + 减集火）还是抢打暴君（趁它没吃满）？现在拼还是逃出去下次再来（§7/§8）？每回合都在这几条里权衡。

---

## 7. 逃离 / hunter（复用 `stalker.ts` · 完整活跃）

**暴君阶段 ＝ 猎手模式。** 打不过可以逃，但暴君会**在图上追**——范式＝ The Warren 的跨节点追猎。

- **上浮逃**：尊重开阔水域 `beginAscent`（开阔水 / 上浮口·零成本任意回合上浮·`combat-exit-semantics`）——你可以脱战上浮，退回图上。
- **图上追猎**（已核对 `stalker.ts`）：脱战后暴君转成**有位置的逼近猎手**——`run.huntEnabled` 开启 → `dive-move.ts::moveToNode` 走 `stalkerStep`；暴君以 `STALKER_HSPEED`（0.8·占位）沿图逼近，玩家**声呐读得到它逼近**（三感官保真度·诚实侦察）。
- **脱离方式**：摸黑切信号 / 拉开 graph 距离 / **上浮出区**——甩掉它才脱离。
- **脱离 vs 被追上判定（已拍·§11 待决③·已核对 `advanceStalker` 返回值）**：
  - **甩掉**：暴君够不到你、`turnsSinceSignal > STALKER_SEEK_MAX_TURNS`（seek 硬上限）或守口烧完 `patience` → `advanceStalker` 令 `stalker:null`（`gaveUp`）＝**脱离**。脱离 ＝ 逃出去了 ＝ 主线不解锁、下次从头（§8）。
  - **被追上**：`advanceStalker` 返回 `contact:true`（贴节点 / 对穿）→ **继续暴君战**，且暴君**带着已夺的词条**（战斗态不因脱战一轮而清空词条）。
- **配置**：暴君 stalker 走执着变体（较大 `patience`·避战要多耗几回合氧 / 电·猎手 SPEC §6 资源博弈）。感官 `sensesBy` 决定跟丢行为（`'both'` → `seek_last`）。
- **⚠ 不碰追猎主体的两个惰性化点**：`stalkerScentLocked` / `scentSpawnReady`（`stalker.ts`）已被 #290 惰性化（依赖已删的流血 DoT·现 `_`-前缀 no-op）——**别去修它们**，追猎主体（逼近 / 接触 / seek / patience）与它们正交、照常工作。

---

## 8. 主线门 & story flag 占位

- **主线 boss·能逃·不硬锁**（不破无脚本死）：暴君阶段全程有逃生阀门（§7）。
- **逃了不解锁**：逃脱（§7 甩掉）**不 set story flag**·主线不推进·下次回来**从头**——**波次不持久化**（1→3→4→5→暴君全重置·图态随 `seedKey` 确定性重生但战斗进度不 bank）。**打赢**（杀死暴君）才 `setFlag` → 主线解锁。
- **story flag 占位**：主线现处 #300 白板（`story.ts` 休眠脚手架·`ChapterId = 'ch1' | 'ch2'`·pre-#300 story 多已 stale·见 [[blue-300-whiteboard]]）——**先留一个 story flag 占位**（形如 `flag.story.scarlet_tyrant_slain`·打赢置位·逃跑不置），供日后主线接线。同时留 §1.3 anchor 的 `story.beatFlag`（未打 → 每次下潜强制开场；打赢置 beatFlag → 回流重访普通下潜）。**占位名 defer**·待主线 SPEC 落地时对齐命名。

---

## 9. 实装拆分（lane 计划）

**并行编排＝ `cowork-parallel-agents` 无重叠车道 + 对抗复审 + 合并后必跑完整 regress**（隔离 agent 看不到跨切断裂）。

| # | 车道 | 车道文件（无重叠） | 建议 | 说明 |
|---|---|---|---|---|
| ① | **核心机制**（耦合紧） | `combat-mechanics.ts` / 新 `combat-scarlet.ts` / `combat-affixes.ts` 扩展 / `combat.ts` 接线点 / `types/enemies.ts` | **Opus · high** | 吃活同伴夺词条（§2）+ 一波内跨怪无放回分发器（§3.2）+ 运行时去重（§3.3）+ 波次编排 + 暴君 phase 脚本（§5·`combat-warren.ts` 范式 / 新 encounter）。 |
| ② | **hunter 接线** | 暴君 stalker 配置 + `run.huntEnabled` 开启点 | **Sonnet · medium** | §7。**⚠ 见 §11 风险⑤：`huntEnabled` 当前无生产接通路径**（band 路径已删·只有测试 harness 置 true）——本车道要为暴君 anchor / 暴君阶段**显式接通** `huntEnabled`。 |
| ③ | **落点接线** | `chart_pois.json`（新 anchor + `story` 块）+ rock openwater `zone` 定义 + `scarlet_kinslayer.json`（改 band） | **Sonnet · medium** | §1.2/§1.3。新 chart anchor（仿 `poi.anchor.warren`）指 rock openwater zone·带 `story` 块；弑亲者从 `band.midwater.t4` 移除、re-home 到落点。 |
| ④ | **文案 canon** | 暴君 codex + 遭遇 / 登场 / 剧情杀文案 | **Opus / Sonnet** | 过 `protagonist-voice`（主角＝玩家投影·只写身体和环境）/ `no-transliteration-names`（「猩红暴君 / Scarlet Tyrant」＝称号·可中文）/ `check-no-human-assertion`（头足类·非人类·别断言人类身份）。文案 [待过稿]。 |
| ⑤ | **baseline + regress** | `scenarios/combat/scarlet_*` + `bless:combat` | 承 ① | 词条分发确定性测（§3.2）+ 吃同伴确定性测（§2·被吃者置 0 + 吃食者回血 + 夺词条）+ 五波剧情杀端到端。**动战斗数值 / RNG 必 `bless:combat`**（`combat_hp_revamp` 记忆）。 |

- **append-only 文档（CHANGELOG / QUIRKS）只在 main 整合时写、别在 feature 车道碰**（免冲突·`cowork-parallel-agents`）。
- ① 是脊柱、其余接线其上；②③④ 车道文件不与 ① 重叠、可并行；⑤ 承 ① 收尾。

---

## 10. 复用指针（已核对代码真值）

| 要复用的 | 位置 | 用途 |
|---|---|---|
| 5 词条元数据 | `src/data/affixes.json`（berserk/nimble/hardshell/regen/venom） | §3.1 单一真相 |
| `rollAffixes(pool, count)` | `src/engine/affixes.ts`（单怪内无放回·Fisher-Yates） | §3.2 波级分发器基元 |
| `resolveDodge` / `applyBerserkExtraAttacks` / `applyRegenAtTurnStart` / `applyVenomOnHit` / 内联 hardshell | `combat-affixes.ts` + `combat.ts` 5 接线点 | §3.1 词条效果对持有者对称·暴君夺词条零成本生效 |
| `warrenFeed` / `warrenTryFeed`（`pickByPriority`·置 hp:0·回血） | `combat-warren.ts` | §2.1 主动献祭回血范式（回血口径改「被吃者剩余血」） |
| `maybeCorpseEat` / `corpseEating.absorbsAttacksFrom` | `combat-mechanics.ts`（quirk #156） | §2.1 吸收被吃者能力范式（吸「攻击」→ 改吸「词条」·吃活非尸体） |
| `maybeWarrenQueenAct`（择一动作·`runEnemyTurn` 起手） | `combat-warren.ts` | §5.1 暴君 phase 触发钩子范式 |
| `BossPhase`（`hpThreshold`/`transitionText`） / `EnemyDef.phases` / `role:'boss'` | `types/enemies.ts` / `combat.ts`（蜂群 SPEC §9） | §1.1/§5.1 boss 载体 |
| `bonuses.hpMaxBonus`（`run.hpMax = HP_MAX + bonus`） | `combatScenario.ts` / `state.ts::createNewRun` | §5.1 boss baseline 玩家生存力（**玩家侧·非 EnemyDef**） |
| `resolveDamage`（玩家↔敌↔敌对称·`max(0,攻−防)`·删闪避） | `combat.ts`（#290·`combat_hp_revamp`） | 战斗底座·暴君 / 弑亲者伤害走它 |
| `run.huntEnabled` / `advanceStalker`（`{stalker,contact,guarding?,gaveUp?}`）/ `STALKER_HSPEED` / `STALKER_SEEK_MAX_TURNS` / `patience` | `stalker.ts` + `dive-move.ts` + `dive-stalker.ts` | §7 追逃·脱离 vs 接触判定 |
| `startDiveFromPoi` / `applyStoryOpen`（`poi.story.{beatFlag,eventId}`）/ `seedKey:poi.id` | `dive-start.ts` | §1.3 story-pin 强制开场 + 确定性重生 |
| `poi.anchor.warren`（chart anchor 结构先例） | `src/data/chart_pois.json` | §1.3 新 anchor 模板 |
| `seabedNodeIds` / `{kind:'atSeabed'}` / `isFlooredOpenWaterTag`（rock 有海床档） | `engine/seabed.ts` + 开阔水域 SPEC §4a | §1.2 落点档位（只筛不钉·故走 story-pin） |
| `check-boundaries` 规则九（静态词条去重） | `scripts/check-boundaries.mjs` | §3.3 静态门·运行时去重须镜像 |

---

## 11. Open / defer + 数值 defer + 待核实 / 风险

### 11.1 已拍待决（写进本 SPEC 当已定·不再列成问题）

1. **第五波 ＝ 5 只**·暴君吃 3 剩 2（§5·§4）。
2. **暴君不自带初始词条**·全靠吃（§3.4）。
3. **逃脱判定用 stalker `contact` / `seek_max` 分**：甩掉（`gaveUp`/`STALKER_SEEK_MAX_TURNS`）＝脱离、主线不解锁、下次从头；被追上（`contact:true`）＝继续暴君战（带已夺词条）（§7/§8）。

### 11.2 数值 / 手感一律 defer（`defer-number-tuning`）

弑亲者 / 暴君 HP、吃食阈值（弑亲者 0.2 / 暴君 0.5 占位）、回血口径、词条效果各常量（已在 `affixes.ts` 占位）、波次节点间距、stalker `HSPEED` / `patience` / `SEEK_MAX` 暴君档、`hpMaxBonus` baseline 值、逐波密度——**统一留作者最后一次性调**。SPEC 与实装只搭机制骨架 + 占位默认，标 `待作者调`。

### 11.3 待核实 / 风险（锁定设计与代码现状的出入 · 供复审）

> 以下均**按锁定设计照写**（未擅改），此处列出与代码现状的出入供 impl / 复审注意。

1. **`warrenFeed` 回固定量、本 boss 回「被吃者剩余血」**：`warrenTryFeed` 用 `hpGainPerSacrifice`（固定）；本 boss 锁定「回被吃者剩余血」＝**新变体**，不能直接套 `warrenFeed` 的回血算式，需新写（借形状不借数值口径）。
2. **`corpseEating` 吸「攻击」且在「尸体」上；本 boss 夺「词条」且在「吃活同伴」上**：`maybeCorpseEat` 的 `absorbsAttacksFrom` 是死亡触发 + 吸攻击数组；本 boss 是**活单位 ≤阈值**触发 + 吸**词条**。二者是**同一「吞并」母题的两种实现**，代码层是**新钩子**（`combat-scarlet.ts`），不是改 `corpseEating`。
3. **`hpMaxBonus` 是玩家 / scenario 侧、不是 `EnemyDef` 字段**：任务简述「暴君 hpMaxBonus 撑 baseline」——已核实 `hpMaxBonus` ＝ `createNewRun` 的 `bonuses.hpMaxBonus`（`run.hpMax = HP_MAX + bonus`·`state.ts`/`combatScenario.ts`），用于**给玩家**在 boss baseline 里够生存力。暴君**自身**耐久＝它的 `hp` 字段 + 夺来词条。§5.1/§10 已按此写。**不存在「暴君 EnemyDef.hpMaxBonus」这个字段**——别去 `EnemyDef` 上找。
4. **规则九是静态门、运行时去重是新要求**：`check-boundaries` 规则九只扫**静态声明的**词条数组（`affixes`/`randomAffixes.pool`/`affixesOverride`）不重复；本 boss 的**运行时夺取 merge** 必须自己做集合去重（§3.3）——规则九**挡不住**运行时叠 `nimble`。这是**新增运行时不变量**，impl 必须显式实现，并建议配确定性 baseline（吃两只同词条 → 只留一个）。
5. **`run.huntEnabled` 当前无生产接通路径**：已核实 `huntEnabled` 定义于 `RunState`（`types/state.ts`）、`createNewRun` 默认 `false`、load 时保真——但**只有测试 harness**（`playthrough-stalker.ts` / `smoke-chart-ui.tsx`）把它置 `true`；曾经接通它的**深 band 路径已删**（`dive-start.ts` 头注「深度柱/band 路径已删」）。⇒ **暴君 hunter 车道（lane ②）必须为暴君 anchor / 暴君阶段显式接通 `huntEnabled`**，不能假设某条生产下潜路径会自动开它。
6. **`role:'boss'` 存在性**：`EnemyRole` 含 `'boss'` 系据蜂群 SPEC §9 的引擎映射记述——impl 时到 `types/enemies.ts` 复核一眼（低风险·蜂群女王已在用）。
7. **`scarlet_kinslayer` 未接进游戏、未提交**：现只作 #298 词条试点存在（`combat.scarlet_kinslayer_solo` 独占遭遇 + 一条 affix baseline），`bands:["band.midwater.t4"]`。「接进游戏」＝移 band + 建 anchor + 接波次编排，是本 boss 工作量的一部分（lane ①③）。
