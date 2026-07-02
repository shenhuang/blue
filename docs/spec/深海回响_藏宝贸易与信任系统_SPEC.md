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
>
> **2026-07-02 · #245（Cowork 交互·Opus）· Phase 3 结构定案 → 见 §12「Sela / Vera 藏宝寻宝定案」**：作者在场逐条拍板，把 §5/§6/§11 的开放点全落定——特殊商人由「泛探险家」收成**四人打捞队幸存者 Sela**（改名 + 改女性 + 连内部 id 改·silas→sela），动机＝**收藏家/找回同伴遗物**（藏品对玩家废料、对她仅存证据）＝天然寻宝任务引擎；深潮币＝队里自铸的**分赃筹码**；Sela **渐深遭遇**一路当商人到「无法返回之地」，过线后由失联同伴 **Vera** 接手（不说话·死＝有智慧尸衣者 or 生物改造过度·永不证实·延后建）。三路 Explore 已核实全部触点 against 当前源码。**§12 以下小节以本节为准（覆盖 §5/§6 旧提案）·数值仍全 defer。**

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

## 12. Sela / Vera 藏宝寻宝定案（2026-07-02 · #245 · Cowork 交互 · Opus）

> 本节把 §5（藏宝图）、§6（特殊商人）、§11（开放点）里所有「待作者拍」的**结构**逐条落定（作者在场拍板），并给出**贴当前代码的实装法**（三路 Explore 核实 against 源码·API/字段/id 均引真名）。**冲突处以本节为准**（§5/§6 旧提案作历史保留）。数值仍全 `defer-number-tuning`。
>
> **📎 角色 canon 已抽到独立档：`深海回响_打捞队_SPEC.md`**（黑背鸥小队 Sela/Corin/Nerea/Vera + 母组织赤喉海盗团 + 军舰鸟徽/红喉鹈币 lore + tech/bio 轴 + 与科考队的主题对照）。**人物 canon 以那档为准（活文档）**；下面 §12.1/12.2/12.6/12.7 保留作 2026-07 拍板 provenance，如与打捞队 SPEC 出入以后者为准。本 §12 其余小节（§12.3 寻宝循环机制 / §12.4 渐深遭遇 / §12.5 收藏品 class / §12.8 rename / §12.9 门 / §12.10 slices / §12.11–12.12 开放点+实装状态）是本系统的机制/实装、留在此。

### 12.1 四人打捞队 canon（叙事底盘）

- **"深潮"打捞队**〔队名 draft·你改〕：一支**商业**水下寻宝队，下海捞宝换钱——和主线**科考队七人**（`docs/spec/深海回响_科考队_SPEC.md`）**互不相干**，蓝领 vs 机构、为钱 vs 做研究，别让玩家混起来（若日后要接，只做"擦肩"淡呼应、别入队·见 §12.6 备注）。
- 原本四人。深海一个个把他们收走：**2 死 + 1 失联（Vera）**，只剩 **Sela** 一个还能浮回港。
- **深潮币（`item.deep_token`）＝队里自铸的分赃筹码**：四个人按份记账用的私钱。如今队没了，Sela「只认深潮币」不是规矩，是**除了这个她算不清别的账了**（呼应她的人设轴）。玩家手里的 token 也顺势有来历——从他们留下的东西里翻出来的。
- **世界观规则（叙事·非代码）**：能下到最深的人，要么押"科技"（外挂装备）、要么押"生物"（改造自身）。**彻底押一条路本身就是那条不可逆的线**——这解释了为什么 Sela 还回得来、另外三个过了线。⚠️ **代码里现无科技/生物玩家流派系统**（Explore C 核实）·目前 tech/bio 纯属**叙事层背景**、零代码；真做成玩家可选流派＝独立大工程（§12.7）。

### 12.2 卡司定案

| 角色 | 名/性别 | 押边 | 机制角色 | 收藏品（对玩家废料·draft） |
|---|---|---|---|---|
| **Sela** | Sela·女·**礁**（希伯来"岩/礁"） | **没真正押边**（故还回得来） | 港侧商人·渐深遭遇·三条同伴线发布者 | — |
| 科技派死者 | **Corin**〔draft·男〕 | 科技（押装备） | 遗物＝**数据日志/旧海图**→"好图"来源①ㅤ | 损坏的深度表 / 烧毁的数据模块 |
| 生物派死者 | **Nerea**〔draft·女〕 | 生物（押改造） | 遗物＝**改造手记/变异标本**→引向深料点/生态点②ㅤ | 蜕下的改造皮膜 / 一管自调血清 |
| **Vera** | Vera·**真**（拉丁"真"）·性别刻意模糊 | 押得最狠·过线·单程下行 | 最深区接手商人·延后建（§12.6） | — |

- **Sela 动机**：不再为宝藏，为**找回同伴留下的东西**——收藏家，藏品对玩家是废料、对她是仅存的、还记得那三个人的证据（"对玩家无价值、对她有价值"落成机制＝§12.5）。三档信任沿用 `[10,30,60]`；**三条同伴线按档解锁**（档1 Corin 线 / 档2 Nerea 线 / 档3 通向 Vera 的失联线）。
- **台词现成可回收**：现有 `sela.json`（改名后）三段 banter/deeper/confession 不用重写就变狠——「我不找人。人会变、会走、会说谎」成反话（人全没了才这么说），「一开始有名字，后来只剩下『还没找到的那件』」指的就是同伴。改名+改性别+软化"别问她从哪儿来"（她其实有明确来处）即可。
- **Corin/Nerea 对称**：一个把命押在装备上（深处装备失效就没了·"深海不原谅机械"），一个把命押在改造自己上（死于改造反噬或被吞）。**Nerea 的"生物改造过度"正是 Vera 两个解释之一**——生物派的终点埋在这条线里，读完为 Vera 的模糊埋伏笔。

### 12.3 动机即任务引擎——寻宝循环（用 flag 造·**无 quest 系统**）

Explore C 核实：**仓内无 quest/journal/objective 系统·一切 flag 驱动**。故寻宝任务全用现成三件拼（零新系统）：`story flags` + `Condition DSL` + `item.story.setsFlag/marksPois` + 对话/事件 effect。单条线的闭环：

1. **藏宝图 item**：`story.marksPois: [poiId]` + `story.setsFlag: ["quest.corin.map"]`。持图 → `poisKnownFromItems(profile)` → `chart.ts::documentKnowsPoi` 判真 → 该 POI 海图点亮（**绕发现门·但不绕能力/天气/月相门**·Explore B 核实）。全走 `acquireIntoProfile`（`state.ts`·三入袋路径单点·含 devGrant）自动置 flag。
2. **藏宝 POI＝固定手写 anchor（不是随机 roaming）**〔**推荐·correct-over-minimal**〕：`marksPois` **钉不住 roaming 运行时 id**（`poi.roam.<seed>.<templateId>`·含 day·Explore B 核实 `chart.ts`），且 roaming+lunar+天气三坑（quirk #204）。用 **anchor**（`chart_pois.json` 的 `anchors[]`·手写稳定 id）由 marksPois 稳定揭示＝最省最稳。**随机选址留 §5(a) 的"每图 seed-固定位"做 Phase 3b 增强**（`condHash(runsCompleted,salt)` 已是现成确定性源·Explore B），别一上来就随机。
3. **到点事件**：该 POI 的 open 事件 `loot` 给**收藏品 item**（category `'other'`·§12.5）+ `outcome.setProfileFlags: ["quest.corin.found"]`。
4. **回港交 Sela**：`sela.json` 对话 choice `visibleIf: { kind:'hasItem', itemId:'item.keepsake.corin_gauge' }` → effects `giveItem`（奖励：更好的藏宝图 / token / 深料）+ `gainTrust {npcId:'npc.sela', amount}`（**信任来源③**·§3.5）+ `setFlag quest.corin.returned`。
5. **门控推进**：下一 beat / 下一条线 `visibleIf: { kind:'all', of:[ {kind:'hasFlag',flag:'quest.corin.returned'}, {kind:'npcTrustTier',npcId:'npc.sela',minTier:2} ] }`。（`npcTrustTier` 已在 3 switch 就位·加线纯数据。）
6. **藏宝图来源分层**（§3.5③ + §5）：Mira 便宜卖**通用图**（低门）/ Sela 高信任交底 **crew 的好图**（Corin 生前测绘坐标·高门·产出更深更好）。低高两档天然对上作者原提问「藏宝图来源」。

> ⚠️ **需新增的 effect（Slice 1b·现无·Explore 核实 `types/npcs.ts::DialogEffect` 当前只有 setFlag/removeFlag/giveItem/takeGold/giveGold/startDive/openChart/openShop/openUpgradeTree）**：上交环要两个新对话 effect kind——`gainTrust {npcId, amount}`（§3.5 早已列为待加·唯一写口经 `trust.ts::gainTrust`·别直写 `profile.trust`）+ `takeItem {itemId, qty}`（消耗上交的收藏品）。加 effect kind＝改 `types/npcs.ts` 联合 + `engine/dialog.ts` 的 apply switch 两处；`gainTrust` 走单写者、`takeItem` 走现成 `removeFromInventory`。别假设它们已存在。

### 12.4 渐深遭遇（recurring merchant·作者拍"非常好·就是我的想法"）

- **复用 roaming**：每解锁更深一根**深度柱**（`columns.ts`·家/残骸/中层/热液/海沟）就在更深 zone 加一组 `roam.sela_meet_*`，**永远比上次更深一点**（玩家亲眼看着她只会更深、停不下）。
- **门控**：`requiresFlags` = 见过她浅层的 chain flag（`flag.sela.met_<tier>`）+ intel（`intel.mira.sela`）+ 沿用三月相窗 `new/waxing/full`（`waning` 故意不露＝不常驻）。港口在场门 `isSpecialMerchantInPort`（met flag + 相位窗）沿用。
- **硬门**：`check-lunar-reach` 只许 **roaming** 带 `lunarWindow`（Explore B·已强制）——加深层交头点保持 roaming、别做成 anchor。
- **每次更深遇见＝一条同伴线的里程碑**（叙事推进 + 她更深一层的"下不来"流露）。
- ⚠️ **加深层 roaming 点前先读 quirk #204**：`intelFlag` **不是**可见性门（必须把情报 flag 也进 `requiresFlags`）；给情报后窗外是 `dim` 不是 hidden；天气遮蔽对 windowed 点同样生效（测试挑晴天：本仓 day 0/10/17/21）。

### 12.5 收藏品 item class（"对玩家废料、对 Sela 有价值"落成机制）

- **约束**（把"对玩家无价值"从散文钉成检查）：Sela 收藏品 item 必须 `category:'other'`、**无** `equipment`/`consumable`/`weaponMod`/`grantsCapability`、`tier` 未定义、`sellPrice` 极低或 0。约定 id 前缀 `item.keepsake.*`（或 data 标 `collectible:true`）。
- **新回归门 `check-collectibles`**〔提案〕：凡 `item.keepsake.*` 违反上述"无用"约束即 regress 红。这样"收藏品对玩家没用"不靠自觉、靠门守。
- 收藏品经 `item.story.setsFlag` 顺带记 `quest.<crew>.found`（`acquireIntoProfile` 单点自动置·§12.3.3 也可只用事件 flag·二选一别双写）。

### 12.6 Vera（**延后建**·设计定案·别进第一期）

- **人设**：处处和 Sela 反着来——Sela 还数东西、还攒 token、还一直在找他们、还每次都游得回来；Vera 把这些全放下了，过了线、账不再有意义、不再算、不想（或无法）被找回、静在最底、接受了。Sela 是"快没了"，Vera 是"已经过去了"。
- **诡异不可辨（核心·作者拍）**：你终于在最深处见到失联的同伴，但游戏**永不确认那到底还是不是本人**——**(a) 死了、被有一定智慧的尸衣者穿上；(b) 生物改造过度、活着但变得和尸衣者一样**，没人能证实。**Vera 不说话**（锁死模糊·也省整棵对话树·靠摆货/手势交易）；玩家一直在她身上找"是她"的证据（按断片说脸永不可见），game 一次都不给。
- **主题（作者深化）**：从人类视角这是"越深越欺骗"；从深海/自然视角或许"越深越真实"——两个视角都留、**game 永不裁决**（别明说成教条·否则滑进说教）。它顺带软化 Sela 的结局：人这边看是被骗着毁掉（悲剧），深海那边看是被剥回真身（诡异归乡），玩家两种都能读。
- **唯一特例**：能开店、有智慧的尸衣者比"顶级捕食者"高一档 → 定成**全局唯一的特例**（更古老/唯一一个），**别让普通尸衣者沾这智慧**（守住怪物平时的威胁·接 `boss_enemy_design` 尸衣者定位）。
- **不可逆价**：过线后**深潮币失效**（分赃筹码只在"还回得来"的世界算数），Vera 的"价"是**拿不回来的东西**（一次性代价·呼应单程下行）——需要一个"不可逆价"机制（**延后设计**·数值/形态待作者）。
- **依赖**：住"无法返回之地"（最深区·地图落位作者"以后再说"）→ **第一期不建·design-only**。
- **玩家流派 hook（远期）**：若玩家和 Vera 押了同一条路，Vera 更像"你这条路的终点"，镜子最利——但这**依赖不存在的玩家科技/生物流派系统**（§12.7），远期、别绑进 Sela 交付。
- **科考队接口（备注）**：作者曾问"失联那个接成导师/科考队第八人"——**已否**（会破坏 Sela 的一二章零剧透 + 把边缘 NPC 焊进承重主线 canon + 破坏科考队 7 人对称）。留"擦肩"淡呼应可，硬接不做（详见本 session 讨论）。

### 12.7 tech/bio 诚实边界（防空中楼阁）

- **代码里不存在科技/生物玩家流派系统**（Explore C 核实·仅有独立装备升级树 + capability 标）。
- 本设计里 tech/bio 目前**纯叙事层**（四人队背景·两个死者一科技一生物·Vera 押边成谜）——**零代码**。
- 真做成玩家可选流派＝独立大工程：`profile.techBioPath?: 'tech'|'bio'` 字段（additive·不 bump SAVE·quirk #99）+ 新 Condition kind `hasPath`（补 3 switch·quirk #203）+ 大量内容门控 + 两条装备/改造线。**别混进 Sela/Vera 交付·单列 initiative·Opus·high**。

### 12.8 rename silas→sela（连内部 id·作者拍"都改·干净点")

- 游戏未发布·无存档兼容负担（quirk #99）→ **连 id 一起改**（`flag.silas.met`→`flag.sela.met` 等不 bump SAVE·无真实旧档）。
- 全量迁移矩阵见 §9 + Explore A 报告（11 个源文件 + 3 个 `_debug_silas*.ts`）：`npc.silas`→`npc.sela`·`shop.silas`→`shop.sela`·`flag.silas.met`·`flag.mira.tip_silas_seen`·`intel.mira.silas`·`roam.silas_meet_*`·`sela.meet_*`·`sela.root/banter/deeper/confession`·`mira.tip_silas`·`silas.json`→`sela.json`·`SPECIAL_MERCHANT_*` 常量值。
- **一次性/回归门**：rename 后全仓 `grep -i silas` 无残留（除 CHANGELOG 历史）。改名同时改性别代词（他→她）+ retheme 短描述。文案过 `check-protagonist-voice` + `check-terminology`。

### 12.9 regress-gate 约定汇总（守约定用机制不用散文）

1. **`check-collectibles`（新·§12.5）**：`item.keepsake.*` 必须"对玩家无用"（category 'other'·无能力/装备/消费/武改·低价）。
2. **`check-npc-trust` §8 红线（已在）**：信任奖励不锁主线——确保 `quest.<crew>.*` / 收藏品 flag 不进主线 gate。
3. **rename 完整门（§12.8）**：无残留 `silas`。
4. **`check-lunar-reach`（已在·§12.4）**：Sela 深层交头点只 roaming 带 `lunarWindow`。
5. **三经济门（#201）+ `emit-economy-graph --write`**：改 token/宝藏产出等经济数据后重生 `economy-dag.mmd`；收支环（§7）token 花费 ≤ 宝藏金币收入。
6. **Vera 唯一门（延后·随 Vera 建）**：深区特例尸衣者商人全局单一。
7. **`check-boundaries` 规则七（已在）**：`profile.trust` 只 `trust.ts`/`state.ts` 碰。
8. **`npcRegistry.ts` 单一登记（已在·#244）**：加 NPC 只在这一处登记（`dialog.ts`/`trust.ts` 都读它）。

### 12.10 分期 build slices（model/effort · 并行）

| Slice | 内容 | 现在可搭？ | 绿门 | model·effort |
|---|---|---|---|---|
| **1a rename+retheme** | silas→sela 连 id + 改女性 + retheme 人设（四人队幸存者·未押边·token＝分赃筹码）+ 现有 3 交头点/货架/Mira intel 全改名 | ✅ | typecheck + playthrough-trust + rename grep 门 | **Opus·medium**（rename 正确性宽 + voice 文案） |
| **1b 首条同伴线** | Corin 线端到端：1 张藏宝图 item（Sela 高信任/Mira）→ 1 个固定藏宝 anchor（marksPois 揭示）→ 收藏品('other')+flag → 回港交 Sela → gainTrust+奖励+flag。跑通循环 | ✅ | playthrough-trust 扩 + check-collectibles(新) | **Opus·medium** |
| **2 二线+渐深+来源分层** | Nerea 线（埋 Vera 伏笔）+ 渐深遭遇（Sela 深一柱再遇）+ 藏宝图 Mira便宜/Sela好图分层 | ✅ | 同上 + check-lunar-reach | **Opus·medium** |
| **3 Vera（延后）** | Vera 接手 + 不可逆价机制 + 第三条（失联）线总回收 | ❌ 待最深区地图落位 | + Vera 唯一门 | **Opus·high**（需地图 + 新机制·在场定形态） |
| **X 玩家流派（远期·独立）** | 科技/生物玩家可选流派系统（§12.7）·非本系统必需 | — | 新 Condition 门 | **Opus·high**·单列 |

- **并行**：1a（rename·碰 sela.json/port.ts/events/chart_pois 广但浅）建议**单独一趟先落**，避免和 1b 内容改同文件打架；1b/2 内部串行（共享 sela.json/port.ts/items）。psm 车道：rename 一趟、内容一趟。
- **机制先行**（CLAUDE.md）：先写会红的 `check-collectibles` → 再用数据转绿。

### 12.11 仍留作者拍（本节新增开放点）

- 〔名〕两个死者 **Corin / Nerea** 是 draft·你改；队名"深潮打捞队"draft。
- 〔物〕四件收藏品具体物件（各人一件·上表 draft）。
- 〔Vera〕"不可逆价"具体形态（拿不回来的**什么**）+ 最深区地图落位（你说以后再说）。
- 〔UI〕Sela 是否要独立信任面板（§3.8·上个交接 todo #3）——本批只商店头显数字。
- 〔数值·defer〕全部阈值/token 价/藏宝图产出/月相补货/收支配平（§11·`defer-number-tuning`）。

### 12.12 实装状态（2026-07-02 · #246 · Cowork 交互 · Opus · Slice 1a+1b 落地）

**命名定案**（作者在场拍·覆盖 §12.1/§12.2 的 draft 队名）：特殊商人 **Sela**（女·连内部 id silas→sela 全改）的小队＝**黑背鸥小队 / The Kelp Gulls**（探索/侦察向·「不善掠夺」＝侦察不是打手），曾隶属母组织 **赤喉海盗团 / The Crimson-Throats**（红喉军舰鸟海盗·理念不合退出）；队伍**探到了大深渊的秘密**（backstory 钩·**一二章不交底**·同 Vera 一起延后·守剧透纪律）。货币 `item.deep_token` 显示名 深潮币→**红喉鹈币**（id 不变·赤喉海盗团发行的分赃筹码·压着军舰鸟徽）。徽章＝**军舰鸟**（frigatebird·「能上天却碰不到海」的鸟·被下海的队伍拿来当徽＝反讽 + 挽歌）。Corin（科技派死者）/Nerea（生物派死者）draft 名沿用（作者「先这样」）。赤喉(团名)≠红喉(币/鸟)刻意留双词。

**已落**（sandbox `npm run regress` **81/81 全绿**·含 tsx 行为测·build 留 Mac/nightly·**未提交**）：
- **1a rename+retheme**：silas→sela 连 id/文件/常量 `SPECIAL_MERCHANT_*`/UI/import（新文件 `src/data/npcs/sela.json`·旧 `silas.json` 因 mount 不能 unlink 已 `mv` 进 `.git/.sandbox-junk`→**Mac 收尾需 `git rm src/data/npcs/silas.json` + `git add sela.json`**）；Sela 改女性（他→她）+ 四人队幸存者/收藏家人设（root/banter/deeper/confession retheme·加 `sela.corin_offer`/`sela.corin_return` 两节点）；红喉鹈币 retheme（token 描述 + Mira tip + SpecialMerchantShopView）；PortView role 寻宝人→拾遗人。
- **1b infra**：新 DialogEffect kind `gainTrust {npcId,amount}`（经 `engine/trust.ts::gainTrust` 单写口·规则七·注释避开 `profile.trust` 字面量 tripwire·quirk #203②）+ `takeItem {itemId,qty}`（经 `state.ts::removeFromInventory`）·改 `types/npcs.ts` + `engine/dialog.ts`。
- **1b Corin 线端到端**：`item.treasure_map.corin_survey`（story.marksPois→`poi.anchor.corin_cache` + setsFlag `story.ch1.corin_map`·Sela deeper @npcTrustTier≥1 giveItem）→ 固定 anchor `poi.anchor.corin_cache`（openEventId `corin.cache` + openEventFlag `story.ch1.corin_found`·**无 lunarWindow**·mirror whalefall.search 开场机制）→ 开箱事件 `corin.cache` loot 半枚红喉鹈币+token+置 corin_found →回港交还 Sela（takeItem 收藏品 + gainTrust + giveItem token 报酬 + setFlag `story.ch1.corin_returned`）。三 flag 登记进 `story.ts::allStoryFlags`（支线·不进主线 gate·§8）。收藏品 `item.keepsake.corin_coin`（半枚红喉鹈币·category 'other'·卖不出价）。
- **1b 门**：新 `scripts/check-collectibles.mjs`（`item.keepsake.*` 必 category 'other'·无 equipment/consumable/weaponMod/grantsCapability/effects/tier·sellPrice≤2）入 regress；`playthrough-trust.ts` §5 扩测 Corin 环（地图揭示 lit + 两新 effect 运行时）；经济 DAG 因新事件 loot 重排·已 `emit-economy-graph --write` 再生 `economy-dag.mmd`。

**§12.11 消化**：队名/币/徽定（本节）；Corin/Nerea 名 draft 保留；**仍待作者**：四件收藏品具体物件（Corin 现用「半枚红喉鹈币」·Nerea 待）、Vera 不可逆价 + 最深区落位、Sela 独立信任面板（§3.8·现只商店头显数字）、全数值（defer）。**下一步＝Slice 2**（Nerea 线埋 Vera 伏笔 + 渐深遭遇「Sela 深一柱再遇」+ 藏宝图 Mira便宜/Sela好图分层·§12.10·Opus·medium）。

---

## 13. 一句话

一个作者想要的**贸易/关系/寻宝系统**（三目标：NPC 关系纵深 / 玩法循环 / 长线重玩）·材料缓解 + 金币 sink 是顺带。核心＝**信任做成通用 per-NPC 机制**（数值单源 + 派生档 + 复用 Condition 门控 + 数据驱动 + 单写者 + 回归门），特殊商人只是第一个消费者·任何 NPC 日后零引擎代码接入·**阵营（极地火山区）留 additive 缝**（§3.9）。结构红线：关系门别挡主线必需。
