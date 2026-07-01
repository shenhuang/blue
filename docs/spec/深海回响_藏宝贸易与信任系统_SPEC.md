# 深海回响 · 藏宝 / 贸易 / 通用 NPC 信任系统 SPEC（v0 草案）

> 2026-07-01 · #243/#244（Cowork 交互·Opus）· **Phase 1（通用信任机制）+ Phase 2（特殊商人 Silas MVP）已落·Phase 3（藏宝图+来源）/Phase 4（Aldo/Mira/Otto retrofit）未实装**。
> 触点/复用点已由两路 Explore 核实 against 当前代码（见 §9）。**数值全 `defer-number-tuning`·本档只钉机制与结构。**
> Phase 2 落地记录（#244）：特殊商人 npc.silas（探险家镜像·3 档信任 [10,30,60]）+ 深潮币 `item.deep_token`
> （**category 'currency'**·非 §4 原提案的 'other'——codebase 已有专用 'currency' 分类且 UI 配色现成，Silas
> 这单是它第一个真实消费者，比套用 'other' 更贴）+ Silas 货架（`engine/port.ts::SPECIAL_MERCHANT_STOCK`·
> token+minTrustTier 双门控·卖 6 个 T3/T4 深料，呼应 §7「深料经 token 可达」）+ 交头点（3 个 midwater
> roamingTemplates，非 anchors——**check-lunar-reach 只许 roaming 带 lunarWindow**，§6.2 原提案没预见这条硬门，
> 现改用 roaming+`intelFlag` 入 `requiresFlags`〔`intel.mira.silas`〕做「情报是入场券」）+ Mira 新对话分支
> 给情报（`mira.tip_silas`）+ 港口在场门（`engine/port.ts::isSpecialMerchantInPort`＝met flag + 相位窗，
> UI 侧新增·非 SPEC 原文）。**未做**：月相补货曲线（§4·仍走回港补满）、Silas 涨信任的②③④⑦⑧来源
> （只做①交易额）、藏宝图本体（Phase 3）。回归：`scripts/playthrough-trust.ts`（新）覆盖交头点揭示三态 /
> 港口在场门 / 交易门控 / 信任跨档。见 CHANGELOG #244。
> 状态：Phase 2 MVP 待作者验收细节（人设文案/货架选品/数值）；Phase 3+ 待作者拍架构。标 〔提案〕 的是我按项目模式给的默认、可红线改。
> 未提交（沙箱无凭证·commit 待 Mac/nightly）·集成时再从 STATUS/索引挂导航链。

---

## 1. 目的（系统目标为主）

**这是作者想要的一个系统本身、不是材料问题的补丁**（作者 2026-07-01 澄清）。三目标并列：

1. **NPC 关系纵深**：信誉＝玩家表达（对谁好、解锁了什么）+ NPC 有记忆。**未来极地火山区会有阵营**（§3.9 前向兼容）·当前 per-NPC 信誉**独立不冲突**。
2. **贸易/寻宝玩法循环**：藏宝图 → 神秘商人 → 稀有货·循环本身要好玩。
3. **长线牵引/重玩性**：攒信誉去够更好的东西。

**顺带收益（非主目的）**：给一条非战斗获取 lane 缓解材料 grind（playtest P1-1/P0-1·beak/eel/lantern 瓶颈）+ 抽过剩金币。链路：

```
藏宝图(便宜·力气换) ─┐
                      ├─→ token ─→ 特殊商人 ─→ 稀有材料 / 独有好货
Mira 高价(金币换·限量)┘            （信任度门控更高货 + 藏宝图）
```

- **token＝中间币**：让金币能换深料，却**不破** Mira「只卖 T1/T2」红线（经济设计有意保留·#238/#239 经济门体系）。
- **token 又贵又限量**＝真·金币 sink（细水长流抽，不一次倒空）。
- **信任度**＝通用机制（§3·任何 NPC 可接），特殊商人是第一个消费者。

**北极星贴合**：地图＝信息（接「灯塔＝信息基建」）；可把藏宝图可靠性接欺骗轴（越深越可能假图/mimic 宝藏）。

---

## 2. 系统总览（四件套）

| 子系统 | 一句话 | 复用 | 新增 |
|---|---|---|---|
| **通用 NPC 信任**（§3·**本档核心**） | per-NPC 数值·派生档·门控货/对话 | Condition DSL · 单源派生 · 单写者模式 | `engine/trust.ts` · `profile.trust` 字段 · `npcTrustTier` Condition · `check-npc-trust` 门 |
| **token**（§4） | 中间货币·金币 sink | 商店货架 · 回港补满 · 月相 | token item · 月相补货曲线 |
| **藏宝图**（§5） | 道具标记随机点·产宝藏/料 | `marksPois`⇒reveal（`chart.ts:564`「藏宝图复用」） · 事件 loot | 随机点选址 · 寻宝事件池 |
| **特殊商人**（§6） | 探险家镜像·token+信任门控 | NPC/对话/商店系统 | 出现机制（交头点·月相门） · 人设 lore |

---

## 3. 通用 NPC 信任系统（架构 · CENTERPIECE）

> 设计准则（作者 2026-07-01）：**信任是一个系统、任何 NPC 都能加**。下面全部落成可复用机制、零 per-NPC 引擎代码。

### 3.1 状态模型 —— 数值单源（不 bump SAVE）

```ts
// src/types/state.ts · PlayerProfile 尾部加：
trust?: Record<string, number>;   // NPC id → 信任原始数值（缺省 {}·读点 ?? 0）
```

- **为什么数值不是 flag**：信任从交易额/任务**累加**（§3.5），本质是量；flag 存不下「离下一档还差多少」。存数值、**派生**档（§3.2）＝两全（顺滑累加 + 离散门控）。
- **存档纪律**（quirk #99·Agent 核实属实）：纯加字段 → **不 bump `SAVE_VERSION`（保持 12）**。`createInitialProfile()`（`engine/state.ts:69`）种 `trust: {}`；`hydrateGameState()`（`:445`）补 `trust: state.profile.trust ?? {}`。`Record` 原生 JSON 序列化、不碰 `__set` reviver。
- 单源：`profile.trust[npcId]` 是该 NPC 信任的**唯一**事实，别处不存副本。

### 3.2 派生 —— `trustTier`（镜像 `ch1Story`/`columns.ts`）

```ts
// src/engine/trust.ts（新）· 纯函数·无副作用·镜像 story.ts::ch1Story 派生套路
export function trustValue(p: PlayerProfile, npcId: string): number { return p.trust?.[npcId] ?? 0; }
export function trustTier(p: PlayerProfile, npcId: string): number {
  // 阈值 per-NPC 数据驱动（§3.6）·此处取该 NPC 配置的 thresholds 做 bucket
}
```

- 档阈值**数据驱动**（per-NPC·§3.6），不硬编码——加 NPC 只加数据。
- 派生纯函数：永不改 profile（同 `ch1Story`/`columnTierBandId` 约定）。

### 3.3 单写者 —— `engine/trust.ts`（镜像 `injuries.ts`）

```ts
export function gainTrust(p, npcId, amount): TrustChange   // 唯一 +
export function loseTrust(p, npcId, amount): TrustChange   // 唯一 −（支持掉信任·见 §3.5.8）
// TrustChange { profile, delta, result:'gained'|'lost'|'unchanged', text? } —— 同 injuries.InjuryChange 返文案
```

- **所有信任变更只经这两个函数**（同 `injuries.ts` 三写入唯一性·quirk #116/#119）。
- **机制化**：`check-boundaries` 加一条规则（仿规则四 `run.injuries`）——`profile.trust` 只许出现于 `trust.ts`（读写）/ `state.ts`（种子+水合）。绕过即 regress 红（防散点直写丢单源）。

### 3.4 门控 —— `npcTrustTier` Condition 原语（复用现成 DSL）

现有 Condition DSL（`types/events.ts:160`·`evalCondition` `events.ts:63`）已驱动**对话 `visibleIf`**（`PortView` DialogPanel 过滤）。加一个 kind 即同时让**对话 + 商店**按信任门控：

```ts
// types/events.ts · Condition 联合加：
| { kind: 'npcTrustTier'; npcId: string; minTier: number }
// engine/events.ts::evalCondition 加分支（查派生·不查 flag·保持数值单源）：
case 'npcTrustTier': return trustTier(profile, c.npcId) >= c.minTier;
```

- 对话 beat：`visibleIf: { kind:'npcTrustTier', npcId, minTier }` —— 高信任解锁深对话（接现有 NPC 进度系统·Aldo 那套）。
- 商店货品：货架条目带 `minTrustTier`（数据驱动·见 §6.3）；`isBuyableFromMira`/特殊商人货架按 `trustTier >= minTrustTier` 过滤。
- 一个原语两处用＝口径统一、零重复 flag 名硬编码。

### 3.5 信任来源（都汇进 `gainTrust`）

每个来源在各自调用点调 `gainTrust`；内容侧加一个 **事件/对话 effect `gainTrust {npcId, amount}`**（镜像 `setFlag`）让数据驱动：

1. 〔作者①〕**交易额**：`port.ts::buyFromMira`/特殊商人买卖点按花费比例 `gainTrust`。
2. 〔作者②〕**临时需求物**：商人轮换「我正缺 X」清单·上交 → `gainTrust`（复用 Mira 收购/上交模式）。
3. 〔作者③〕**藏宝图任务取回物**：特殊藏宝图任务回收指定物 → `gainTrust`。
4. 〔我补〕**给他看稀罕/情报**：图鉴条目/新发现 POI/lore → `gainTrust`（贴「识货探险家」人设·接 St3 图鉴/信息轴）。
5. 〔我补〕**卖他觊觎的稀有战利品**：带权重·比普通交易额涨更多。
6. 〔我补〕**长期惠顾滴漏**：多周期持续光顾·小幅被动（长线玩家自然攒）。
7. 〔我补〕**剧情 beat 喂信任**：某些 story 事件 `gainTrust`（接现有进度系统）。
8. 〔我补·结构〕**允许掉信任**：卖假货/任务失败/抢他/选对家 → `loseTrust`。**数据模型首发就支持有符号 delta**（别只单调增·可扩展性）。
9. 〔远期·阵营〕**多 NPC 派系/阵营**：见 §3.9——极地火山区已定要阵营·当前 per-NPC 独立不冲突·架构留 additive 缝、现在不做。

### 3.6 通用性 —— 任何 NPC 接入（零引擎代码）

加一个用信任的 NPC ＝ 纯数据：

1. 该 NPC 数据加 `trust: { thresholds: number[], tierLabels?: string[] }`〔提案·住 `npcs/<id>.json`〕。
2. 其对话 beat / 货架条目按需打 `npcTrustTier` / `minTrustTier` 标。
3. 其信任来源在内容里挂 `gainTrust` effect（或在已有引擎点按 npcId 调）。

> 现状：三个 NPC（Aldo/Mira/Otto）**各自 ad-hoc·无共享抽象**（Agent 核实）。本信任系统＝**第一个跨 NPC 的共享层**；先服务特殊商人，Aldo/Mira/Otto 日后可平滑接（retrofit 见 §10 Phase 4）。

### 3.7 回归门 + 边界（把约定钉成会红的检查）

- **`check-npc-trust`（新）**：① 所有 `npcTrustTier` Condition / `minTrustTier` 标 / `gainTrust` effect 引用的 `npcId` ∈ 现有 NPC 集；② per-NPC `thresholds` 单调递增；③ `minTier` ≤ 该 NPC 最高档。（类比 `check-upgrade-refs`/`check-enemy-refs`。）
- **`check-boundaries` 新规则**：`profile.trust` 只许 `trust.ts`/`state.ts`（§3.3）。
- **结构红线门**（§8）：经济瓶颈料不得锁在 `minTrustTier > 0`。
- **engine↛ui**（规则一·quirk #95）：`trust.ts` 在 engine·UI 只读派生。

### 3.8 UI

信任面板（PanelShell #111·`engine↛ui` 只读 `trustValue`/`trustTier`/下一档阈值/解锁预览）；港口 NPC 卡片显示信任度。商店里信任不足的货品：红字「未达 X 信任」（同现有金币不足提示）。

### 3.9 阵营前向兼容（未来 · 极地火山区 · 作者 2026-07-01）

**当前**：per-NPC 信任独立、互不冲突。**未来**：极地火山区引入阵营——阵营内 NPC 可能共享声望、敌对阵营间可能零和。**要求：阵营是 additive 扩展、不是重写。** 架构已留缝，现在别做、也别做挡它的事：

- NPC 数据留 `faction?` 字段位（现在可不填）。
- **`gainTrust` 是唯一 choke point**（§3.3）——将来「对 X 阵营 NPC 涨信任顺带调阵营声望、扣敌对阵营」全在这一处 hook（再次印证单写者价值·散点直写就没这扩展点）。
- 门控届时加 `factionRep` Condition 原语（同 `npcTrustTier` 加法套路·§3.4）；`profile.factionRep` 与 `profile.trust` 并存（同 additive 存档纪律·§3.1）。
- 别把「信任独立」写死成不可逆假设；`loseTrust` 已支持有符号 delta（§3.5.8），零和天然接得上。

---

## 4. token（货币 · 金币 sink）

- **形态**：一个 item〔`ItemCategory 'other'`·沿 capability_mechanism 先例〕，非材料、不进材料账单。
- **两个来源**：① Mira 货架高价卖（限量·见下补货曲线）；② 藏宝图点产出。
- **去处**：特殊商人货架 `cost.tokens`（§6.3）。高价＝金币 sink。
- **月相补货曲线**〔作者拍·数值 defer〕：每个月相**少量**增加库存，**四个月相（一个完整周期）后大量**增加 → 给「攒到周期末大采购」节奏，接月相系统「等到下一相位」。
  - 复用：Mira 限量「回港补满」（`port.ts::handleReturnToPort` 清 `shopStock`）已是限量底座；token 库存改成**按月相推进补**而非每次回港补满〔需接月相 advanceDays·见 lunar-tide 系统〕。

---

## 5. 藏宝图（道具 · 随机 · 引路）

- **形态**：item，带 `story.marksPois`〔`chart.ts:564` 注释原话「旧海图/**藏宝图复用**」——反应链现成：持图 ⇒ `documentKnowsPoi` ⇒ 该 POI 海图点亮、绕灯塔发现轴〕。
- **来源**：NPC 给（对话 effect `giveItem`·flag/信任门控）/ Mira 便宜卖 / 特殊商人高信任解锁更好的图。
- **随机点＝变化**〔作者拍〕：随机选址解决「寻宝变机械重复」，且途中引玩家碰别的资源（补给手段→探索驱动）。
  - **坑（Agent 核实·`chart.ts:439`）**：roaming POI 运行时 id 含 day 不稳定·`marksPois` 钉不住它。两条出路选一：(a) **每张图 seed 固定的随机位**（marksPois 钉得住·〔提案·首选〕）；(b) 随机点走 `intelFlag` 揭示而非 marksPois。
- **产出**：事件 `loot` 给 token / 稀有材料 / 可卖宝藏（纯货币物）。

---

## 6. 特殊商人（探险家镜像）

### 6.1 人设（接 canon·零成本上叙事轴）

- **玩家的镜像**：你探深渊、被科考队羁绊牵着；他探宝藏材料、只认东西不认人。咬住核「深海还你你带下去的东西」——你的执念是找导师（人），他的执念是宝藏（物）。
- **警示镜**：一个为东西而非人下来的探险家，深海把他磨成了什么样；信任越高越露出他比表面更「下不来」的一面（与玩家执念同构）。从 vendor 升成主题角色。
- **剧透纪律**（story_canon §·硬约束）：碰他与失联/单程下行的关联，**一二章零泄漏**——可让你隐隐觉得「下来的人不太回得去」，但**不点破**（三章的牌）。文案过 `check-protagonist-voice` + `check-terminology`。

### 6.2 出现机制（交头点）

- 在特定**交头点**（海图 POI）出现；按**月相窗**现身〔接月相系统·既给出现条件现成机制，又强化「神秘·不常驻·算时机碰头」〕。
- 〔作者待拍〕交头点摆在哪几层（建议跨浅/中/深各一·浅层先碰、深层高货）。

### 6.3 货架（token + 信任双门控）

- 复用商店货架表模式（`port.ts` `SHOP_STOCK_*`）：新增**特殊商人货架**，每条目带 `cost.tokens` + `minTrustTier`。
- 卖**稀有好货**〔作者拍〕：稀有装备/改装/一次性强力件/高级藏宝图；晚点把部分其它货迁来（数据搬迁·零机制改）。
- 信任解锁更高货 + 更好的藏宝图（trade→信任→更高货+图→更多宝藏→更多 trade·环开放·图把人引向全世界不自闭）。

---

## 7. 收支环（经济自洽 · 结构先立·数值 defer）

闭环：**藏宝图注金币（可卖宝藏）→ token 抽金币 → 换深料/好货**。结构必须自洽：

- token sink 只在金币真盈余时咬人 → **藏宝图金币收入 ≳ token 花费**（over time），否则环漏。数值最后调，但结构别留漏。
- 接 `check-economy-reachability`（#238/#239 DAG 门）：token + 特殊商人是**新获取源**，门要认「深料经 token 可达」，否则它以为这些料只能打怪拿。

---

## 8. 结构红线（关系门别挡主线必需 · 机制化）

系统是自身目的（§1）→ 商人可偏**奢侈/独有货**，材料缓解交给藏宝图直给或另一条刷点 POI（非战斗 lane 不必压在信任后）。红线从「材料优先」放宽成通用原则：

- **关系/信任门不得挡通关必经进度**（主线 beat / St 结局链 / St*-gated 必需物）。奢侈料、独有装备、高级藏宝图随便锁。
- **若**商人确实卖了经济瓶颈料（beak/eel/lantern），那些**必须 `trustTier 0` 可得**；但商人不卖它们也完全可以。
- 机制化：`check-npc-trust` 断言——`minTrustTier > 0` 货架条目不得含「通关必需」标的（主线必需 / 经济 bottleneck role）。违反即红。

---

## 9. 复用点 / 触点总表（Agent 核实）

| 关注点 | 文件:位置 | 动作 |
|---|---|---|
| Profile 状态 | `src/types/state.ts` PlayerProfile | 加 `trust?: Record<string,number>` |
| 种子/水合/版本 | `src/engine/state.ts:69`/`:445`/`:35` | createInitialProfile 种 `{}` · hydrate 补 `?? {}` · **SAVE_VERSION 保持 12** |
| 派生模式参照 | `src/engine/story.ts`(ch1Story) · `columns.ts` | 镜像写 `trustTier` |
| 单写者参照 | `src/engine/injuries.ts` + `check-boundaries` 规则四 | 镜像 `trust.ts` + 新边界规则 |
| Condition DSL | `src/types/events.ts:160` · `src/engine/events.ts:63`(evalCondition) | 加 `npcTrustTier` kind + 分支 |
| 对话门控 | 对话 `visibleIf`(Condition) · `PortView.tsx` DialogPanel 过滤 | 打 `npcTrustTier` 标 |
| NPC 数据 | `src/data/npcs/{aldo,mira,otto}.json` · `types/npcs.ts` · `engine/dialog.ts`(DIALOG_INDEX) | 加 per-NPC `trust.thresholds`；商人新建 |
| 对话 effect | DialogEffect(`setFlag`/`giveItem`…) | 加 `gainTrust`/`loseTrust` effect kind |
| 商店 | `src/engine/port.ts`(`SHOP_STOCK_*`/`isBuyableFromMira`/`buyFromMira`/`handleReturnToPort`/`MIRA_BUY_MARKUP`) | token 货架 + `minTrustTier` 过滤 + 月相补货 |
| 藏宝图揭示 | `src/engine/chart.ts:564`(marksPois 解析·「藏宝图复用」) · `:439`(roaming 不稳定坑) | 图 item 加 marksPois；随机点选 seed-固定 或 intelFlag |
| 商店 UI | `src/ui/MiraShopView.tsx` · `PortView.tsx` | 信任过滤 + 红字提示；商人 UI |
| 信任面板 | PanelShell #111 · engine↛ui(规则一) | 新面板·只读派生 |
| 月相 | lunar-tide 系统(advanceDays/月相窗·见仓内 lunar SPEC) | token 补货 + 商人出现接月相 |

---

## 10. 实装车道 + model/effort + 并行

| Phase | 内容 | 绿门要求 | model·effort | 无人值守 |
|---|---|---|---|---|
| **1 核心** | `profile.trust` + `trust.ts`(数值/派生/单写者) + `npcTrustTier` Condition + `check-npc-trust` + 边界规则。**零内容·零行为变化**（无 NPC 用）·先绿着 land | typecheck + check-npc-trust + check-boundaries | **Opus·high**（单源/存档/门·判断密集） | 机制层可，但需在场拍架构 |
| **2 商人 MVP** | 特殊商人 NPC + token item + 货架(token+信任门) + 交易涨信任 + 信任面板 | playthrough + smoke 商店 | Opus·medium | 否（人设/数值） |
| **3 藏宝图 + 来源** | 藏宝图 item(marksPois) + 随机点 + 寻宝事件池 + 临时需求/任务回收涨信任 | check-farm-pois 式 + economy-reachability | Opus·medium | 否（内容/口味） |
| **4 retrofit + 深化** | Aldo/Mira/Otto 接信任 + 掉信任 + 派系（可选） | 各自 baseline | Opus·medium | 否 |

- **并行（psm 车道·文件几乎不重叠）**：Phase 1（engine/trust + types + scripts）与现有叙事/战斗轴不撞 → 可独立起。Phase 2/3 内部串行（共享 npcs/port/items）。
- **机制先行**（CLAUDE.md）：先写 `check-npc-trust`（会红）→ 再用数据转绿。

---

## 11. 留作者拍（开放点 + 数值占位）

- 〔结构〕信任档数 + 各档解锁什么（货/对话/图）。
- 〔结构〕交头点摆哪几层（§6.2）。
- 〔结构〕随机点选址：seed-固定 还是 intelFlag（§5）。
- 〔数值·defer〕token 价/库存/月相补货曲线、各信任源 +量、各货 minTrustTier、藏宝图价、宝藏产出量、收支环配平（§7）。全 `defer-number-tuning`。

---

## 12. 一句话

一个作者想要的**贸易/关系/寻宝系统**（三目标：NPC 关系纵深 / 玩法循环 / 长线重玩）·材料缓解 + 金币 sink 是顺带。核心＝**信任做成通用 per-NPC 机制**（数值单源 + 派生档 + 复用 Condition 门控 + 数据驱动 + 单写者 + 回归门），特殊商人只是第一个消费者·任何 NPC 日后零引擎代码接入·**阵营（极地火山区）留 additive 缝**（§3.9）。结构红线：关系门别挡主线必需。
