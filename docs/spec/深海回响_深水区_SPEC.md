# 深海回响 · 深水区 / 欺骗系统 SPEC

> **状态：v0.1 草案（2026-06-02，作者口述定调 + 四点拍板）。** 这是「最终预期」北极星（自动记忆 [[deep-game-vision]]）落成可建系统的第一版设计文档。方向已锁、若干子机制留作者复核（见 §7）。建法承袭基建+地图 revamp 的「SPEC → 分阶段实装 → 每阶段全绿自审」节奏（见 `docs/深海回响_基建地图_SPEC.md`）。
>
> **伏笔层已就位**：浅/中/深三级『越深越欺骗』事件已全部埋好（STATUS quirk #53–#57）——mimic 假信标 `bluecaves.the_glow`(中)→`cave.false_beacon`(深)，corpse-wearer `wreck_graveyard.{the_other,no_bubbles,the_wearer}`(浅/中/深)，lore.deep_water.{cold_light,the_window,the_false_beacon}。capstone（§5 Phase 3）登场时回收这些母题与 tell。

---

## 1. 北极星回顾（不变的基调）

- **越深越「欺骗」的信任梯度**：浅＝所见为真 / 中＝看不见（opacity）/ 深＝看错（deception）。
- **「是世界坏了，还是你疯了？——通常两者皆是」**：`sanity`（你轴）+ 环境/生物真实欺骗（世界轴）让玩家**无法干净归因**，游戏**拒绝裁决**（无廉价收口，d_reveal 也保持暧昧）。
- **理智是一扇双向门，不只是血条（作者 2026-06-02）**：高 san＝可靠地感知**真实世界**；低 san＝真实世界感知崩坏，**但解锁并能探索「另一个世界」——亦真亦假，游戏永不裁决其真幻**。理智因此不只是要守的资源，也是**可主动压低去「过到那一边」的钥匙**（详 §3.7）。
- **生存铁律（无脚本死）**：每个深处威胁**可生存**，但只在你**够强 + 及时读出 tell** 时，代价巨大。死亡只来自准备不足或读错，**绝不脚本杀**。
- **灯塔 = 信息 + 抵达基建**（不只是 access）：待在自己拥有、点亮的网里你能读懂水；漂出网的边缘就变瞎。
- **敌人别太多**：各 zone 2 敌封顶；mimic / corpse-wearer 是 apex 例外，住最深层。

---

## 2. 四点已拍板（2026-06-02，AskUserQuestion）

1. **clarity 模型 = 双传感器 + 探测双刃**（不是单纯「灯塔光−深度」涌现）：
   > 近距靠**照明设备（灯）**，远距靠**声呐设备（sonar）**。关闭灯/声呐会**致盲**，但也会让**捕食者更难探测到你**。
   —— 主动感知是**双向的**：照亮/ping 让你看见世界，也把你暴露给世界。**细化（2026-06-02 续，见 §3.2）：声呐独立于灯塔网；灯＝近距地面真相、声呐＝远距但返回不可信（可被生物躲/骗、低 san 幻觉）；耗电声呐多灯少、暴露灯高声呐较低；灯/声呐 效果·耗能·电量都可升级。**
2. **最深层 = 分层 + 递归纵深**：
   > 既有 zone 的**更深 band**，一个**终端 zone**，之后还有**超深海沟（trench）和深渊（abyss）**；地图刻意做得**非常非常大**，而且**永远有比最深更深的**。
   —— 深度轴是核心进度脊柱、近乎无界，每解锁一层都揭出更深一层。
3. **mimic 首次登场 = 海图引诱 → 入潜兑现（both）**：假 POI 在海图上诱你横渡，抵达触发入潜遭遇。
4. **tell ↔ sanity 耦合 = 模糊 + 提高难度（both）**：低 sanity 既让 tell **失真模糊**，又让读 tell 的**检定更难**。

---

## 3. 系统架构（四点的综合）

### 3.1 两层 clarity：宏观（海图）+ 微观（下潜）

| 层 | 管什么 | 驱动 | 现有地基 |
|---|---|---|---|
| **宏观 / 海图** | 哪些 POI 看得见、够得着、能在图上分辨 | **灯塔/前哨网络**（信息基建）= 长程声呐/信标网 | `chart.ts` `isPoiLit`/`revealRadius`/`effectiveDistance`（Phase C，quirk #52） |
| **微观 / 下潜** | 节点图里你能预读/分辨多远的邻近节点、危险、尸体提示、mimic tell | **潜水员自带装备**（灯近 / 声呐远）+ 关闭=致盲但隐身 | `visibility: dark` 盲航遮预览（quirk #27/#41）+ 尸体提示按打捞 Lv.1 门控（quirk #36） |

宏观由你**跨 run 建的灯塔/前哨网**决定（§5 Phase 2 把它向深处延伸）；微观由你**这一潜带的灯/声呐**决定。深水恐怖发生在微观层。

### 3.2 微观双传感器（下潜内）—— 一张权衡表，不是谁压谁

**声呐独立于灯塔网**（作者 2026-06-02 定：灯塔网只管宏观海图、不下到水里；§7.1 已定）。下潜中你靠**自带的灯 + 声呐**两件装备感知，各有完全不同的代价/收益：

| 传感器 | 范围 | 你看到的 | 耗电 | 暴露(signature) |
|---|---|---|---|---|
| **灯** | 近（当前 + 相邻节点） | **地面真相**——细节高，能读 tell（那盏「灯」不在任何东西上、那个潜水员不冒泡） | 少 | **高**——亮着＝黑暗里持续的靶子 |
| **声呐 ping** | 远（前方几跳拓扑） | **不可信的返回**（见下） | 多 | 较低——一次声学脉冲，不是一直举着灯 |
| **摸黑（go dark）** | 无 | 无预览、盲航（沿用 `visibility: dark`） | 0 | 最低 |

- **声呐 = 不可信传感器（核心欺骗面）**：你看到的是声呐的**返回**，不是真东西，返回与实际有**差**；而这个差可来自三个你**分辨不了**的源头——① 生物**躲开**声呐（没回波）/ ② 生物**喂假回波**（把自己显示成地形/信标/空水——**mimic 就是这类**）/ ③ **低 sanity 幻觉**（扫出根本不存在的回波）。**这把「是世界坏了，还是你疯了——通常两者皆是」做成了屏幕上一块东西**：同一个可疑回波，游戏**拒绝告诉你**是真、是骗、还是你疯。
- **要确认真相只能靠近用灯看**（近距＝地面真相，**前提是 san 还够**）——但点灯凑近又是最高暴露。**读真相永远要自曝，张力是结构性的、不靠脚本。**
- **没有完全可信的传感器（作者 2026-06-02 续）**：san 够时灯＝真相；san 越低**声呐先失真、且更狠**，**san 足够低时连灯也产生幻觉**（灯最稳、最后崩，但也会崩）。低 san 深潜＝看到的一切都可能假，无论灯还是声呐——这是放任理智崩掉的代价（呼应 §3.5 tell↔sanity both；钩子已在 quirk #21 `sanityRange` 门控事件）。
- **用途分工**：较安全地扫远 → 声呐（费电、可能骗你）；确认/读 tell → 点灯凑近（便宜，但等于站在那东西边举火把）。摸黑＝省电 + 最低暴露，代价是瞎。
- **升级（接现有材料经济）**：灯、声呐各自的**效果（范围/分辨/抗欺骗）+ 耗能**，加上**电量（电池总量）**，都做成**升级轨**（`upgrades.json` 双资源或灯塔设施轨）——深水「练装备」脊柱，与 §5 Phase 2「建灯塔网下探」脊柱并行。

### 3.3 探测 / 被探测模型（被动 → 主动的代价）

- 每个深水捕食者（含 mimic）有**探测感官**。你的**主动感知抬高自身 signature**——**灯＝持续视觉暴露、signature 最高**；**声呐 ping＝一次声学脉冲、signature 较低**（所以扫远比一直举灯安全些，代价是费电 + 返回不可信）；摸黑＝signature 最低但全瞎。
- signature 高 → 被探测 → 捕食者**靠近 / 伏击 / 进入战斗**；signature 低（go dark）→ 你能**贴着滑过去**，代价是瞎。
- **与 sanity 耦合（§3.5）**：低 sanity 时你既看不清那点信息、检定又更难——黑暗 + 低理智里你**信不过自己感知到的任何东西**。
- **mimic 专属张力**：它的引诱（假信标）在你**最瞎、最绝望**时最诱人。声呐能 ping 出「那里有个大东西」（一条 tell），但 ping 就暴露你自己；读细 tell 要点灯靠近（更暴露）。**读 tell 必须自曝**——张力是结构性的，不是脚本。

### 3.4 可扩展纵向深度轴（很大的图、递归纵深）

- 现状深度被当成 0–60m 的准硬上限。新模型：深度是**数据驱动、分 band、近乎无界**的纵向轴，每 band 由供给链（§5 Phase 2）**逐级解锁**：
  - **0–60m 已点亮的世界**：现有 reef / cave / wreck，传感器便宜甚至免费（浅水不剥夺所见为真）。
  - **欺骗 band（过渡黑暗层）**：既有 zone 向下延伸或一层过渡暗区；传感器开始**吃紧**、探测双刃**生效**。
  - **终端 zone（海沟口）**：新 zone，mimic + corpse-wearer 居所。
  - **超深海沟 → 深渊 → 更深**：**递归**——每次解锁揭出更深一层。**架构不得硬编码地板**（band 表可续写；mapgen `depthOffset` 已是地基，quirk #30）。
- 「很大的图」靠**沿深度建自己的灯/声呐网**保持可达：你 run 复 run 把信息网向下修，每个前哨＝一个深度门 + 一个 clarity 网络锚点（§5 Phase 2）。

### 3.5 mimic capstone（最深层、§5 Phase 3 兑现）

- **海图引诱**：海图上一个**没有任何自家灯塔能解释的点亮 POI**（无灯之光）。远距声呐/海图**分辨不出**它和真信标（lure）；交叉比对自家灯塔网才看出「我的网点不亮那儿」（一条宏观 tell）。绝望/盲目的玩家照样横渡过去。
- **入潜兑现**：抵达后假信标解析成 mimic。tell（点灯/ping/盯看）**高 sanity 可读、低 sanity 失真**（§2.4 both）。**读出 tell + 够强 = 活**（付代价、走开）；读错/太弱 = 被吃（但原则上仍可逃，代价惨重——无脚本死）。
- **corpse-wearer**：同深层的姊妹 apex，回收 `the_other→no_bubbles→the_wearer` 伏笔与 tell（不呼吸/旧装/招手对着你站过的位置）。
- **d_reveal**：「那光到底是什么」的终局揭示，门控在抵达/幸存 mimic 之后；翻所有死者名为「你」（沿用 quirk #42 钩子）。**保持暧昧**（拒绝裁决）。

### 3.6 前哨网络 + 能源经济（base 层，Phase 2 兑现；作者 2026-06-02 续 pin）

- **前哨＝深水灯塔**（复用 `Lighthouse` 模型）：蛙跳出潜点 + 海图 clarity 锚 + base。两类：
  - **水上 / 前期前哨**：**只增不减、不衰减**（现有 home 灯塔 / `ruin_north` 即此类）。
  - **水下 / 中后期前哨**：**会衰减**（复用尸体 `aging`/decay 那套）——**水流（current）区衰减更快**（维护压力），但水流区能建**水力发电**。
- **能源（base 层资源，≠ 潜水员每潜电池 `power`）**：决定一个前哨/网络**同时能开几个灯塔设施**。两层关系——**能源跑设施 + 给你充电池/充氧；电池是下潜里烧的**。能源由发电设施供（水力等）。
- **选址权衡**：静水＝省维护但能源少；激流＝费维护但可水力发电、能源足 → 更多设施同时在线。
- **设施（沿用 `lighthouse_upgrades` 轨）**：信标/clarity、**充电（给电池）**、**充氧**、**材料中转/寄存**、**水力发电**……材料建、能源跑。**补给设施越深越要自己建**（前期/水上自带，深处得自造）。
- **衰减后果（作者 2026-06-02 定）**：荒废 → 设施掉线 / 前哨「变暗」（clarity 半径缩、补给减）+ **修建进度回退（阶段倒退）** + **寄存材料丢失**（水流区更快）。**非永久全损**——可重新 ferry 材料补回（合「可生存有代价」），但荒废有真实地盘代价，维护成 base 层持续压力。

### 3.7 另一个世界（低 san 的另一面，亦真亦假；多在 Phase 3+ 兑现）

- 低 san 不止是惩罚（声呐失真、灯也幻觉、tell 难读）——它**同时解锁另一层可探索内容**：只在低 san 才「出现」的节点 / POI / 事件 / 路径（机制＝`sanityRange` 低段门控，quirk #21 的泛化）。
- **亦真亦假**：那个世界是真的、还是被压垮的脑子看出来的，**游戏拒绝裁决**（同 §1）。mimic / corpse-wearer / d_reveal 多半住这一侧。
- **取舍（理智的双向经济）**：高 san 在真实世界看得清、活得稳；**主动压低 san 才进得去另一个世界**（代价＝再信不过自己的感知）。理智从「单向要守的血条」变成**双向的钥匙**。
- **顺带救活死内容**：低-san 门控内容此前几乎触发不到（quirk #21：`silent_chamber`「只在被压垮的潜水员眼里出现」，但没机制把 san 压下去）——给低 san 一个去处后，这些内容活了。
- **那边长什么样、怎么演、有什么回报**＝Phase 3+ capstone，**与作者一起一个个敲定**（作者 2026-06-02），不在本草案写死。

---

## 4. 与现有代码的接点（别另起炉灶）

- `engine/chart.ts`：宏观 clarity 已有 `isPoiLit`/`revealRadius`/`isPoiVisible`/`effectiveDistance`（quirk #52）。**Phase 2/3 在此扩**：把「点亮」从布尔扩成可被假 POI 伪造（mimic）；把灯塔网延伸到深 band。
- `visibility: dark`（`diveModifier`）+ `NodeSelectView` 盲航遮预览（quirk #27/#41）：**Phase 0 把它从「单 POI 的 dark」泛化成 `clarity = f(装备灯/声呐状态, 节点距离, 深度)` 的统一预览门控**。
- `engine/dive.ts`（`enterNodeSelection`/`moveToNode`）+ 尸体提示按打捞 Lv.1 门控（quirk #36）：预览/提示门控的统一入口；Phase 0 在此读传感器状态。
- `engine/combat.ts` + 遭遇触发：**Phase 0 探测模型**——signature → 遭遇概率/伏击/接近。可能新增「noticed/警觉」度。
- `engine/mapgen.ts` `depthOffset`（quirk #30/#49）+ `zones.json` `zoneTagsByDepth`：**Phase 1 深度轴**的地基（band 表数据化、可续写）。
- `data/events/lighthouse.json` `lighthouse.ruin_north` + `restoreRuinId`/`restoreLighthouse`（quirk #52）：**Phase 2** 把一次性账单修复扩成**多阶段、跨 run 持久**前哨（新增 per-ruin 进度持久字段）。
- `ui/diverName.ts` `flag.d_reveal`（quirk #42，至今无触发器）：**Phase 3** capstone 触发它。
- `StatusBar` / run 级状态：传感器开关（灯/声呐 on/off/ping）+ signature 可视化的落点（沿用「dev 面板不进 GameState、UI 状态 App.tsx 本地」之外的**玩家状态**得进 run）。

---

## 5. 分阶段实施（依赖顺序，每步一个 session、每步全绿）

> 总原则：**先地基后欺骗**——没有 clarity/探测的张力，假光没有「真」可撒谎；没有深度轴，欺骗层没地方住；没有供给网，很大的图不可达。

### Phase 0 — 微观双传感器 clarity + 探测双刃（强化版「opacity」地基）
把 `visibility:dark` 泛化成统一 micro-clarity：灯（近）/ 声呐（远 ping）/ 静默（盲但隐）三态；预览/尸体提示/tell 可读性按 `clarity(装备, 节点距离, 深度)` 门控。新增**探测模型**：signature（灯/声呐抬高）→ 捕食者接近/伏击；go dark 降 signature 换隐匿。
- **可拆 0a（clarity 三态 + 预览门控，纯感知）/ 0b（探测/隐身，碰 combat 遭遇）** ——0b 更重、独立性强。
- 触碰：`dive.ts`/`NodeSelectView`/新 run 状态 `sensors`/`combat.ts` 遭遇。**补 smoke 渲染断言**（碰 UI 数据路径，quirk #29/#41）。

### Phase 1 — 可扩展纵向深度轴（banded、近乎无界）✅ 已实装 plumbing（2026-06-03，quirk #61，见 §12 清单）
深度 band 数据化（**实装＝新全局 `data/depth_bands.json`**，作者选「全局阶梯」而非扩 zones.json），去掉 60m 准硬上限；支持逐级解锁的更深 band。沿用 `depthOffset` + `zoneTagsByDepth`。**先只把"能配置更深 band"打通**，内容/zone 后续填。
**两处与原计划的偏差（作者 2026-06-03 拍板，见 §10）**：① **解锁＝软门控、非硬 flag**——band 不带 `unlockedBy`，可达性由装备（声呐解锁 + 电池/升级，吃深料，quirk #60）+ 后续强敌战斗力检测决定；② **成本＝间接（不加深度耗电税）**——深 band 更暗（visibility）→ 灯打不透 → 被迫用更耗电的声呐 + 每路口重 ping → 电量压力涌现（复用现有 visibility→forced-sonar→power 回路），不在 lightDrainFactor 加深度项。
**蛙跳下潜结构（作者 2026-06-02 定）**：不一口气长潜穿多层——一次下潜＝从**最深前哨**出发、只覆盖**一个 band**（D→D+段），浮回前哨补给；死在深处＝尸体留该 band、可回收。复用 `depthOffset`（从更深起潜）+ Phase C reach/reveal（按最近灯塔算 distance、点亮范围内才可见）+ 尸体回收。新出潜口 `startDiveFromOutpost`（镜像 `startDiveFromPoi`）。

### Phase 2 — 跨 run 供给前哨 + 能源经济（深度门 + clarity 网络下延 + base 层）
把 `lighthouse.ruin_north`（一次性）扩成**多阶段、跨 run 持久**前哨：持久化 **per-ruin 进度字段**（这一潜找到部件、下一潜运一个、半亮扛过死亡）。每前哨建成＝**解锁下一 band + 宏观 clarity 向下延一格 + 一个 base（蛙跳出潜点）**。**完整经济见 §3.6**：水上前哨不衰减 / 水下前哨衰减（水流区更快、但可水力发电）/ 能源跑设施、决定同时在线数 / 补给设施越深越要自建。复用 `Lighthouse` + `lighthouse_upgrades` 设施轨 + 材料经济 + 尸体 `aging` 衰减 + 海图 reach/reveal。

> **✅ Phase 2a 已实装（2026-06-04，quirk #66）——脊柱：多阶段持久前哨 + 真蛙跳出潜点。** 作者三 pin（AskUserQuestion）：脊柱优先〔能源/衰减留 2b〕/ 3 阶段〔半亮给部分收益〕/ **未发布不迁移**（进度＝profile.flags 阶段标记 `outpostStageFlag`，**零存档形状改动、SAVE_VERSION 仍 4**——上面草案的「per-ruin 进度字段 + SAVE_VERSION bump」被这条作者决策替换成 flag-only）。`OutpostDef`（`lighthouse_upgrades.json::outposts[]`，3 stage·T1→T2→T3 深料分层）+ `advanceOutpost`（按阶段校验账单·扣料·置 flag·建满 push 一座 Lighthouse 复用 Phase C reveal/reach）+ outcome `advanceOutpostId`；`startDiveFromOutpost` 从最深半亮前哨蛙跳（预耗氧按目标顶−前哨底）；建造事件 `lighthouse.outpost_reef_deep`（visibleIf flag 门控·一阶/潜）。
>
> **✅ Phase 2b 已实装（2026-06-04，quirk #67）——能源经济 + 水下衰减 + 海图前哨 UI + 多前哨链。** ① 能源＝派生（`engine/outposts.ts::outpostEnergy`：base + 水力〔仅 current 前哨〕− 衰减 → 在线设施数；4 新 `LighthouseEffect`〔energyGen/energyDraw/rechargeBonus/oxygenSupply〕+ 3 新设施轨 hydro/recharge/oxygen，静水跑 1 个补给·水流 + 水力跑更多＝§3.6 选址权衡）；② 衰减＝新 additive `profile.outpostState{maintainedRun}`（**不 bump SAVE_VERSION**·作者纠正「不迁移≠不持久化」）→ `outpostDecayLevel`（水流 ×2·封顶 4）→ 容量缩（补给掉线＝变暗）+ `effectiveOutpostStage` 回退（< USABLE → 蛙跳失效）+ `maintainOutpost` re-ferry 重置；**只在蛙跳出潜层兑现、不碰 chart.ts reveal**（真 reveal dimming 留后续）；③ `SeaChartView::OutpostPanel`（建造/维护/能源/衰减/半亮 + advanceOutpost/maintainOutpost 直通）+ `LighthouseBuildPanel` outpostOnly/currentOnly 轨门控 + smoke N/M2-M4；④ 多前哨链 `outpost.trench_deep`（band.trench_throat·submerged+current）服务 abyssal/hadal 蛙跳 + 建造事件 `lighthouse.outpost_trench_deep`。`playthrough-outpost` §6-10。
> **✅ Phase 2b 续·真 reveal dimming 已实装（2026-06-05，quirk #76）——补上「衰减不碰 reveal」的缺口、闭合衰减↔海图回路。** 前哨灯塔的海图点亮半径随衰减线性收缩：`engine/outposts.ts::effectiveRevealRadius` ＝ `revealRadius × (1 − decay/OUTPOST_DECAY_MAX × OUTPOST_REVEAL_DECAY_SHRINK[0.5])`（满衰减缩到半径一半·**永不归零**＝结构还在；home/废墟/水上灯塔无衰减＝原样）。`chart.ts::isLit` 与 `SeaChartView` 光圈都改用它＝久不维护的前哨在海图上「变暗」、它点亮的远海机会点重新隐没（须 re-ferry 维护补回）。**decay-0 逐字节不变＝既有 reveal 回归全绿**。`playthrough-outpost`§11（零衰减=原始/满衰减缩半/单调/home 不受影响/远点 `isPoiVisible` 重新隐没）。
> **✅ Phase 2b 续·材料中转/寄存 + 寄存丢失 + 深渊前哨 已实装（2026-06-05，quirk #79）——补上 §3.6「材料中转/寄存」+「寄存材料丢失」、Phase 2b 衰减三齿（变暗/阶段回退/寄存丢失）全闭环。** ① 中转站＝`lhtrack.depot`(outpostOnly·新 `LighthouseEffect.storageCapacity`·**不耗能源**＝被动库房) → 前哨可寄存材料；维护从寄存就近取料则**免 ferry 金费**（料前置到深处的回报·home 没钱也维护得起）。② 丢失＝`engine/outposts.ts::effectiveStored`（raw − `depotDecayLevel`×`DEPOT_LOSS_PER_LEVEL` 锈蚀·**独立 `storedRun` 计时**与结构 `maintainedRun` 解耦·激流更快·非永久全损可重存补回）·derive-only·提交只在玩家动作（存/取/维护）·烤入不复活。`outpostState` 条目扩 `{ maintainedRun, stored?, storedRun? }`(additive·JSON-native·**不 bump SAVE_VERSION**)。**守单向依赖**：寄存逻辑全在 outposts.ts·`advanceOutpost`(lighthouses.ts) 只保留字段·无寄存活动前哨写 `{maintainedRun}` 既有行为逐字节不变。③ 深渊前哨 `outpost.abyssal_deep`(`band.abyssal`·静水·3 阶深料 110/180/290·#66/#73 模板·引擎零改) 补脊柱 home→reef_deep→trench_deep→**abyssal_deep**→hadal_deep（hadal 蛙跳 7→1 回合）+ 建造事件 `lighthouse.outpost_abyssal_deep`(`zoneTags:[abyssal]`)。UI＝`OutpostPanel` 寄存区 + smoke M5/N3/N4。`playthrough-outpost`§12（寄存）/§13（abyssal）+ `playthrough-save` round-trip。平衡＝`outposts.ts` 顶加基准复核块（账单单调阶梯·钉新值·复核既有未改）。
> **🚧 Phase 2b 仍可续（后续）**：寄存丢失的更狠后果（现锈蚀封顶 4 单位、未做寄存设施被毁/进度联动）/ reef 第二前哨（侧向覆盖、非更深）/ 维护账单随前哨深度分级（现 flat 1 brass+20 金）/ 平衡实测 pass。

### Phase 3 — mimic capstone（最深层）✅ 核心已实装（2026-06-04，quirk #69，作者在场逐拍）
海图假 POI（无灯之光，§3.5）→ 横渡 → 入潜遭遇；tell↔sanity 双耦合（模糊 + 难度，§2.4）；corpse-wearer 姊妹 apex；接 `flag.d_reveal`。回收浅/中/深 + trench/abyssal 伏笔。
> **✅ 已实装（quirk #69）**：`ChartPoi.mimic?` 假 POI（`chart.ts` 注入·`isPoiLit` 恒真/`isPoiExplainedByLighthouse` 恒假·软门控 `shouldLureMimic` 任一水下前哨半亮）→ `startDiveFromPoi(mimic)` 强制开场兑现事件 → `data/events/mimic.json`（`false_beacon`：读穿 tell〔理智 vs 62·低 san 更难〕→ 新 outcome `setProfileFlags`[flag.d_reveal] 活下来即触发·保持暧昧；读错/盲信/拒看→不交底·无脚本死 / `the_wearer_apex`：corpse-wearer 姊妹·深渊 organic·不置 d_reveal）。**两只 apex 做成 EVENT 而非战斗敌人**（deception 不靠 slugfest、守『敌人别太多』；`spoofsSonar`/`evadesSonar` 节点钩子留未来节点版）。**唯一允许的第三只敌人例外**＝这两只事件 apex。回报＝lore + d_reveal + `flag.mimic.*.survived` 解锁钩子（无 loot，作者定）。
> **🚧 Phase 3 仍留（专门 session 逐拍）**：**「另一个世界」（§3.7）的可探索内容**（低 san 才出现的节点/路径/回报）——作者 2026-06-04 选「先留钩子不展开」，仅用现有 sanityRange 低段做 tell 失真；正式兑现仍「与作者一起一个个敲定」。节点版 mimic（spoofsSonar/evadesSonar 填进活节点 + 可能的战斗形态）/ survived 钩子接更深解锁。

---

## 6. 数据 / 类型改动草案（按阶段，待细化）

- **Phase 0**：run 新增 `sensors: { light: bool; sonar: 'off'|'ping'|'active'; }` + 派生 `signature: number`；`clarity(node)` 纯函数（engine/clarity.ts 新建，与 chart 宏观平行）；`DiveModifier.visibility` 退役/并入 clarity。`combat`/遭遇读 signature。**run 新增 `power: number`（电池储备，类比 oxygen，前哨/回港充满）；`sonarCost >> lightCost`、耗尽=被迫摸黑（致盲不直接死）。声呐返回经 `sonarReturn(node)`（可被生物 `evadesSonar`/`spoofsSonar` 改写、低 sanity 注入假回波）≠ 真节点内容；近距 `light` 给真相。灯/声呐 效果·耗能 + 电量做成升级轨（接 `upgrades.json` 双资源 / 灯塔设施）。**
- **Phase 1**：band 表（`data/depth_bands.json`？）`{ id, depthRange, unlockedBy(ruinId/flag), tags }`；mapgen/zones 按 band 取数。
- **Phase 2**：`Lighthouse`/前哨加 `progress` 多阶段字段 + `submerged`/`current` 标记 + `decay`（水下前哨，水流区更快）+ `energy`（base 能源，跑设施、定同时在线数）；`restoreLighthouse` → `advanceOutpost`（多步）；设施（recharge/oxygen/material-cache/hydro）走 `lighthouse_upgrades` 轨 + 能源占用；`startDiveFromOutpost`（蛙跳，复用 depthOffset）。SAVE_VERSION 4→5。
- **Phase 3**：`ChartPoi` 加 `mimic?: true`（假 POI，不被任何灯塔解释却 lit）；mimic 敌人 def（apex）；tell 可读性读 sanity；d_reveal 触发 outcome。

---

## 7. 待作者复核的子决策（带提案）

1. ~~灯塔 ↔ 声呐网是否同一套？~~ **已定（2026-06-02）：独立。** 声呐是潜水员**自带装备**，灯塔网只管宏观海图、不下到水里。声呐的代价（耗电 + 诱敌）与不可信（返回≠真、可被躲/骗、低 san 幻觉）由装备本身承担，不靠网络耦合。见 §3.2。
2. **声呐风格：主动 ping（瞬时、响、signature 尖峰）还是持续？** 提案：**潜水员自带声呐＝主动 ping**（题材经典、与探测双刃天生一对）；灯塔/前哨给**被动环境宏观 clarity**。
3. **被探测的后果：节点图里的追逐/aggro，还是只调遭遇概率？** 提案：每节点一个**「警觉」度**，主动感知抬、静默降；高警觉＝捕食者接近/伏击，低＝忽略你（可生存：摸黑能滑过，代价是瞎）。
4. ~~深度单位：米 vs tier？~~ **已定（2026-06-02）：米（0→∞）**，band 数据化、不封顶；供给门解锁更深米段。
5. **双传感器/探测是全局铺还是只深水？** 提案：**只在深黑处吃重**——浅水灯常亮/近乎免费、不引入探测压力；声呐 + 探测双刃在 clarity 稀缺的深 band 才成为主轴（避免回填污染浅水手感）。
6. ~~「deeper than the deepest」每层小目标~~ **已定（2026-06-02）**：每 band 一个「建/点亮一座前哨」的跨 run 目标＝蛙跳下一步（§3.6 / §5 Phase 2）。

**新增待定（2026-06-02 续）**：
7. ~~衰减后果细节~~ **已定（2026-06-02）**：变暗 / 设施掉线 + **修建进度回退 + 寄存材料丢失**（水流区更快）；非永久全损、可重 ferry 补回。§3.6。
8. **能源 vs 电池**：确认是**两层**（base 能源跑设施/供充电 + 潜水员每潜电池 `power`）——提案如此，§3.6。

---

## 8. 可调参数（tunables，集中放各引擎文件顶部，沿用 SPEC §9 风格）

- 灯近距范围 / 声呐 ping 跳数与冷却 / 各传感器 signature 权重（灯高、声呐较低）/ 静默 signature 下限。
- **电（Phase 0）**：电池总量 / 声呐 ping 单次耗电 / 灯每回合耗电（声呐 >> 灯）/ 灯·声呐·电量三条升级轨的档位与账单 / 声呐被躲·被骗·低 san 幻觉的触发与强度 / **灯幻觉的 san 阈值（比声呐低很多）**。
- **前哨 / 能源（Phase 2）**：水下前哨衰减速率（水流区倍率）/ 水力发电产能 / 各设施能源占用 / 能源总量→可同时在线设施数 / 充电·充氧·中转设施的建造账单与深度门 / 半亮（部分阶段）收益曲线。
- 各 band 深度区间 / 解锁门 / 传感器在该 band 的成本曲线。
- 探测：警觉抬升/衰减速率、触发接近/伏击的阈值。
- sanity→tell：模糊起始 sanity、检定难度随 sanity 的斜率。
- 前哨：阶段数、每阶段账单（沿用材料经济双资源）、跨 run 半亮衰减（若有）。

---

## 9. 守则承袭（建时一直守）

- **回归文化（#22/#26）**：每阶段收尾全绿（typecheck + 全部 playthrough + scenarios + combat-scenarios + mapgen-scenarios + verify-tutorial + smoke-chart-ui）+ prod build；碰 UI 数据路径补 smoke。
- **叙述永不交底（#54/#55/#57）**：深水/cosmic/mimic 文案既给平淡解释又留错读，不裁决。
- **无脚本死 / 可生存有代价**：每个深处威胁都给「够强+读 tell 就能活、代价惨重」的出口。
- **敌人别太多**：除 mimic/corpse-wearer apex 例外，不加第三只常规敌人。
- **存档迁移（#39）**：动 GameState/profile 形状必 bump SAVE_VERSION + 迁移 + `playthrough-save` 回归。
- **沙箱 git（[[sandbox-git-commit]]）**：`git add src scenarios docs`、`mv` 锁进 `.sandbox-junk`、read-only 核对。

---

## 10. 决策日志

- 2026-06-02：作者口述北极星（[[deep-game-vision]]）。
- 2026-06-02：四点拍板（§2）——clarity 双传感器+探测双刃 / 递归纵深大地图 / mimic chart-lure→in-dive / tell↔sanity both。本 SPEC v0.1 据此成文。
- 2026-06-02（续，「pin it down」对话）：定 §7.1 **声呐独立**（不接灯塔网）；**声呐返回不可信**（生物躲/骗 + 低 san 幻觉）＝核心欺骗面、把「是世界坏了还是你疯了」做成屏上一物；灯近距地面真相、声呐远距不可信；**耗电**（声呐 >> 灯）+ **暴露**（灯高、声呐较低）双轴权衡；灯/声呐 效果·耗能·电量**可升级**（接材料经济）。已并入 §2/§3.2/§3.3/§6/§8。**Phase 0 设计基本 pin 实。**
- 2026-06-02（续，「继续 pin」Phase 1-2）：定 **蛙跳下潜**（一潜一 band、从最深前哨起、复用 depthOffset + reach/reveal + 尸体回收）；**前哨经济**——水上前哨只增不减、水下前哨衰减（水流区更快、但可水力发电）；**能源**（base 层、≠ 潜水员电池）决定同时在线设施数；补给（充电/充氧/中转）是设施、越深越要自建；**灯也会在 san 足够低时幻觉**（无完全可信传感器、灯最后崩）。并入 §3.2/§3.6（新）/§5 P1-P2/§6/§7（#4#6 resolved、新增 #7#8）/§8。**Phase 1-2 设计 pin 实；剩衰减后果细节（§7#7）+ Phase 3 mimic 逐拍演出。**
- 2026-06-02（续，收束）：定 **理智＝双向门**——低 san 解锁可探索的「另一个世界」（亦真亦假、拒绝裁决；§1 + §3.7 新增），把低-san 门控从死内容（quirk #21）变成正向去处；衰减后果加重为 **变暗 + 修建进度回退 + 寄存材料丢失**（§3.6 / §7#7 resolved）。**Phase 3（mimic 演出 + 另一个世界）＝与作者一起一个个敲定的专门 session，不在草案写死；Phase 0 仍是下一个 build 起手。**
- 2026-06-03（**Phase 0a 开建** · 深水区第一笔代码）：实装微观双传感器 clarity + 不可信声呐 + 电池 + 低 san 腐蚀（详见 STATUS quirk #58）。建前作者过 §7/§11 取舍，四点拍板（AskUserQuestion）：① clarity↔visibility＝**并入·保留字段**（dark→灯打不透→`none`，`murky` 不挡灯）；② 浅水手感＝**默认灯亮·浅水近免费**（电/声呐张力只在 dark/深 band）；③+④ 作者中途**复盘声呐**：先想"仅做灯"，旋即意识到**黑暗里仅有灯无法继续探索→声呐是必需的**，回到本 SPEC 双传感器模型，并**新增关键约束：声呐能力后期才解锁（深料升级），玩家先经历"黑暗中无声呐"、黑水天然探索受限，分级解锁（即使有灯仍有受限处）**。据此偏差三点并入 §11 0a（声呐解锁轨 / `clarity(run)` 不带 node / visibility 并入非删）。低 san 阈值＝声呐<60、灯<25（§8 tunable）。**另：作者定未发布暂不做存档迁移**——run.sensors/power 不 bump SAVE_VERSION（留 4）、不加 migrate 步，靠 createNewRun 种默认 + 反序列化兜底；发布前再统一补（#39 流程留备用）。**0b（探测/隐身、碰 combat、消费 signature）留下一 session。**
- 2026-06-03（**Phase 0b 开建** · 同日续）：实装探测/隐身（详见 STATUS quirk #59）。作者拍板探测＝「**警觉积累 → 接近/伏击**」（§3.3 最完整形态）。发现今天战斗 100% 事件选项触发、零自动遭遇 → 这是**新增自动遭遇路径**。实装：`run.alert`（run 级，点灯/ping 深水抬、摸黑/浅水降，tickTurns 累加）+ `clarity.ts::alertDelta`/`predatorApproaches` + `dive.ts::moveToNode` 越线触发 `startCombat`（复用 zone `ambushEncounters` 现有 solo 敌）+ `ZoneDef.ambushEncounters`（三深水 zone 配、浅/教学不配＝§7.5 兜底）+ NodeSelectView 预警 + `playthrough-stealth`。守则：地标不伏击（留出路）、预警有窗口、摸黑能甩、可生存无脚本死。**Phase 0（0a 感知 + 0b 探测）至此完成；下一步 Phase 1 深度轴（banded 蛙跳）或 Phase 0 升级轨（灯/声呐效果·电量）。**
- 2026-06-03（**Phase 0 升级轨**，§11 最后一项收尾 → Phase 0 全闭）：作者选方向 B（升级轨），**四旋钮全选**（powerMax / 能耗效率 / 抗欺骗 / 隐蔽），轨道结构「你觉得怎么做最合适」→ 我定**复用 `line.sonar_rig` 续 lv2 + 新 `line.dive_kit` 两条线、深度分层账单**。关键设计取舍：① **范围/分辨不做**——0a 把 clarity 定为 run 级二元（full/sonar/none），节点级 clarity 是 Phase 1，故"范围/分辨"现在没机械钩子，本期只做四个能接的旋钮；② 新增 `run.sensorTuning`（出海前由 `deriveSensorTuning` 一次性烤、下潜内不变，同 powerMax 快照模式），clarity.ts 纯函数读它 + 缺省回退基线常量＝**未升级/旧档/部分 run 逐字节复现 0a/0b**；③ 地板/上限守北极星——抗欺骗有地板（声呐≥30、灯≥10 仍崩＝**无完全可信传感器**）、隐蔽有上限 + 点灯 signature 永 > 摸黑（**读真相必自曝**结构张力不被升级买断）；④ DRY：`RunStartBonuses` 现是 `createNewRun` bonuses 的超集，dive.ts/dialog.ts 直接整个传、不再逐字段抄。未发布不 bump SAVE_VERSION（`run.sensorTuning` 普通对象 JSON 自动 round-trip + `?? 常量` 兜底）。回归：`playthrough-sensors` 加 §11、`-upgrades` 加 §8、`-save` 升级值 round-trip、`smoke-chart-ui` J4 渲染新线，全绿 + prod build。详见 STATUS quirk #60。**Phase 0 完整闭环（感知 + 探测 + 成长）；下一步 Phase 1 深度轴（开建前 AskUserQuestion pin band 表/解锁门/蛙跳/成本曲线）或内容打磨。**
- 2026-06-03（**Phase 1 plumbing 开建** · 可扩展深度轴）：开建前 AskUserQuestion pin 四点。作者拍板：① band 结构＝**新全局 `data/depth_bands.json`**（跨 zone 共享深度阶梯，匹配 §6 草案 + 递归无界愿景；band 引用 zone 提供内容、用绝对 depthRange 覆盖 zone.depthRange）；② 解锁＝**软门控**——「准备做成软控，首先材料装备限制探索，然后后面会有一些强力敌人做战斗力检测」→ band **不带硬解锁 flag**，可达性由装备（声呐解锁 + 电池/升级，吃深料，#60）+ 后续强敌决定。**Phase 0 升级轨即是这道门**：深 band 黑水里没声呐就瞎、没电池撑不久；③ 蛙跳 `startDiveFromOutpost`＝**做最小版**（home 灯塔当 stand-in outpost，真·最深前哨留 Phase 2）；④ 成本曲线＝**不加深度耗电税**——「不会增加耗电，但是更深的地方需要用更耗电的声呐，以及更频繁的使用探测设备，变相增加耗电」→ 深 band 更暗（visibility）→ 灯打不透 → 被迫声呐 + 重 ping → 电量压力**间接**涌现（复用现有 visibility→forced-sonar→power 回路，不动 lightDrainFactor）。实装＝`types/bands.ts` + `data/depth_bands.json`（reef_deep murky + trench_mouth/throat dark·>60m·借蓝洞内容占位）+ `engine/bands.ts` + `mapgen GenOpts.depthRange` 覆盖（band 绝对窗口、缺省回退 zone）+ `dive.ts::startDiveFromOutpost`（镜像 startDiveFromPoi、走 getRunBonuses＝升级直通）+ `clarity.ts` 写死 60→`ALERT_DEPTH_FULL`（深 band 饱和不报错）+ SeaChartView 蛙跳列表（软门控不锁全列）。回归新 `playthrough-bands.ts`（7 节）+ smoke A2，全绿 + prod build。详见 STATUS quirk #61 + §12 清单。**内容（trench 专属 zone/事件/tag、范围/分辨节点级 clarity）+ 真前哨蛙跳（Phase 2）留后续。下一步＝Phase 2 跨 run 前哨/能源、或深段内容、或 Phase 1 续（band 级 tag 池/成本档细化）。**
- 2026-06-04（**Phase 1 续·节点级 clarity** · 引擎打磨，作者选 C「Phase 1 续」→ 子方向「节点级 clarity·深度分档」）：把 0a 的 run 级二元 clarity 升成节点级（"范围/分辨"，#60 明确 defer 到此那块）。开建前实测真实地图深度差定 reach（层状区子节点同 depthStep〔浅 reef 12-13m / 深 band 4m / wreck 6-7m〕、maze 区选内异质 dd 1→35m）——据此定**按 depth-delta 降档 + 绝对深度（≤25m）门控豁免浅水**，避免浅 reef 大步长误降。`clarity(run)` 留天花板、新 `clarityForNode(run,node)` 降档（灯近 full / 声呐补中段 / 太深黑 / 横上行不降）。范围/分辨做升级轨（`SensorTuning` + lampDepthReach/sonarDepthReach + 2 UpgradeEffect 沿用 #58/#60 桥 + dive_kit.lv4/sonar.lv3，reach 上限 < 最深陡降＝守"最深处也买不穿"）。护栏：Lv.1 尸体豁免深度降档（地图知识，守 #36）。UI 零改（per-choice 渲染早在 0a 就位）、未发布不迁移。回归 `-sensors`§12/`-upgrades`§8/`-save`/smoke J5，全绿 + prod build。详见 STATUS quirk #62 + §12（范围/分辨已勾）。**Phase 1 续仅余 band 级 alert 曲线（小）；下一步＝Phase 2 跨 run 前哨/能源、或深段内容。**
- 2026-06-04（**trench 专属内容** · 深段内容 pass，作者选「深段/trench 内容」→ 母题「回波对不上」）：给 Phase 1 占位的 trench band（60-108m，借蓝洞、池空）专属内容。**工程＝band 级 tag 池**（`DepthBand.tags?` 覆盖 zoneTagsByDepth，复用既有闲置 ZoneTag `twilight`/`midnight`＝零类型改动；经 startDiveFromOutpost→startDive→mapgen→buildEventPool 一条线）落 §12 Deferred。**内容＝`data/events/trench.json` 6 事件「回波对不上」**（声呐返回≠点灯真相，付现 #58 不可信声呐 + #62 节点级 clarity 陡降变黑）：假底/假人/距离不对/假墙/被应答/没有回波，系统覆盖 ping 骗你的全部方式。守 §9——loot-free / 无敌人（2/zone，mimic·corpse-wearer 是 Phase 3 apex 例外）/ 不触发 d_reveal（#42）/ 叙述永不交底（#54）/ 每事件留「关声呐·摸黑」诚实但盲的出口。新 `lore.trench.*`。回归 12 scenarios + `playthrough-bands`§8，全绿 + prod build。详见 STATUS quirk #63 + §12。**下一步＝Phase 2 跨 run 前哨/能源、或继续铺 trench/更深 band（abyssal 留 >108m）、或 Phase 1 续 band 级 alert 曲线。**
- 2026-06-04（**「全做」session** · 作者一句「全做」拍板 A+B+C 三方向全做）：① **C·band 级 alert 倍率（Phase 1 续收尾，§12 Deferred「成本曲线」勾）**——`DepthBand.alertFactor?`（缺省 1）→ `run.bandAlertFactor` → `alertDelta` 只乘暴露增益不动 DECAY（逃生阀门买不断、守无脚本死）；reef_deep 1 / trench_mouth 1.3 / trench_throat 1.6 / 深渊 2.0；深度因子在 `ALERT_DEPTH_FULL`(60) 仍饱和、band 倍率在其上续「越深越凶」。`playthrough-bands`§9。详见 STATUS quirk #64。② **B·深渊 band + abyssal 内容（续 #63 band.tags 机制开更深一层）**——`band.abyssal`(108-140m·dark·alertFactor 2.0·`tags:[cave,abyssal]`〔既有闲置 ZoneTag〕·递归更深不硬编码地板) + `data/events/abyssal.json` 5 事件「永远有比最深更深的」（没有底/从下面上来的东西〔apex 伏笔〕/更深处的假灯〔mimic 伏笔·勾连 lore.deep_water.cold_light〕/不该活着却活着/身体停了沉没停〔reef.no_bottom 拉力最深兑现〕），全 loot-free/无敌人/不触发 d_reveal/永不交底、每事件留逃生出口，新 `lore.abyssal.*`；11 scenarios + `playthrough-bands`§10。事件 87→92、baseline 87→98。详见 STATUS quirk #65。③ **A·Phase 2a 跨 run 分阶段前哨 + 真蛙跳出潜点**（开建前 AskUserQuestion 三 pin：作者选**脊柱优先 Phase 2a**〔能源/衰减留 2b〕/ **3 阶段**〔勘察→运件→通电、半亮给部分收益〕/ **未发布不迁移**）——进度＝profile.flags 阶段标记（零存档形状改动、SAVE_VERSION 仍 4），新 `OutpostDef`（lighthouse_upgrades.json `outposts[]`，3 stage·T1→T2→T3 深料分层 gate 点亮）+ `advanceOutpost`（按阶段校验账单·扣料·置 flag·**建满 push 一座 Lighthouse 复用 Phase C reveal/reach**）+ outcome 新 `advanceOutpostId`；`startDiveFromOutpost` 从最深半亮前哨蛙跳（预耗氧按「目标顶−前哨底」、trench_mouth home 3→前哨 1 回合）；3 阶段建造事件 `lighthouse.outpost_reef_deep`（visibleIf flag 门控·一阶/潜）。新 `playthrough-outpost.ts`、事件 92→93。详见 STATUS quirk #66。**Phase 2b 留：能源经济 + 水下衰减 + 设施轨 + 前哨/蛙跳 UI surfacing + 多前哨链（trench→abyssal）。** C/B/2a 未发布均不 bump SAVE_VERSION（派生/flag、不动形状）。
- 2026-06-04（**「全做 2」session** · 作者再次「全做」拍 A+B+C；A=Phase 2b / B=超渊 band / C=mimic capstone 逐拍）：**作者纠正一处框架错误**——「未发布不迁移」≠「不持久化」：新增 additive 字段照 `shopStock`(#50) 套路（createInitialProfile 种默认 + 反序列化 `?? 默认` + JSON round-trip）即可跨 run 持久存住、**SAVE_VERSION 仍 4**，只有改既有数据含义才需 migrate。据此 ① **A·Phase 2b**（quirk #67）落地能源经济（派生）+ 水下衰减（新 `profile.outpostState{maintainedRun}` additive、不 bump）+ 后果（变暗/补给掉线/半亮回退/蛙跳失效，**只在蛙跳出潜层兑现、不碰 chart.ts reveal**）+ 维护 re-ferry + 海图 `OutpostPanel` UI + 多前哨链 `outpost.trench_deep`（trench→abyssal/hadal）。② **B·超渊 band**（quirk #68）`band.hadal` >140m + 新 ZoneTag `hadal` + 4 事件「连更深/上下都不再是连续的线」（含 the_soft_floor apex 伏笔），递归再深一层。③ **C·mimic capstone**＝作者选「现在就逐拍做整套演出」。
- 2026-06-04（**Phase 3 mimic capstone 逐拍**，作者在场 AskUserQuestion 三 pin）：① **d_reveal**＝活下来即触发·保持暧昧（读穿 tell + 够强活着离开 → `flag.d_reveal`，叙述永不交底）；② **回报**＝lore + d_reveal + `flag.mimic.*.survived` 解锁钩子，**无独特 loot**（守深层 loot-free）；③ **「另一个世界」(§3.7)**＝先留钩子不展开（仅用 sanityRange 低段做 tell 失真，可探索内容留专门 session）。**实装关键决策（我定、合北极星）：两只 apex（mimic / corpse-wearer）做成 EVENT 而非战斗敌人**——deception 的恐怖在「读 tell / 自曝」不在 slugfest，且 EVENT 形态守『敌人别太多』、复用深层事件 idiom（loot-free / 检定 / 可生存失败）；`spoofsSonar`/`evadesSonar` 节点钩子留给未来「节点版 mimic」。交付＝`ChartPoi.mimic?` + `chart.ts`（注入/isPoiLit/isPoiExplainedByLighthouse/shouldLureMimic）+ `startDiveFromPoi` 强制开场 + `data/events/mimic.json`（false_beacon weight0 forceAscend / the_wearer_apex abyssal organic）+ 新 `Outcome.setProfileFlags`（持久写 profile，d_reveal 钩子）+ SeaChartView 宏观 tell。回归 `playthrough-mimic`(6 节)+5 scenarios+smoke O。详见 STATUS quirk #69。
- 2026-06-05（**「A→C→D 全做」session** · 作者选方向「A 然后 C 然后 D」全做；A=声呐探索 S0〔属 `docs/深海回响_声呐与房间_SPEC.md` §11，不在本 SPEC〕、C=渊外 band、D=超渊前哨）：本 SPEC 侧记 C/D 两笔。① **C·渊外 band（>180m）+ subhadal 专属内容（续 #63/#65/#68 递归更深、开最深一层）**——`band.subhadal`(180-230m·dark·`alertFactor 3.0`·`tags:[cave,subhadal]`·**新 ZoneTag `subhadal`**〔twilight/midnight/abyssal/hadal 已用尽〕·借蓝洞 mapgen·不硬编码地板) + `data/events/subhadal.json` 4 事件「过了最后一个有名字的深度，它不再骗你——只给你下去的理由」（the_offer 诱饵 / further_down『就一点』递归 / the_low_light 像家的假光〔mimic 最深伏笔〕/ no_answer 连谎都不给的安静〔S0/S2 声呐欺骗收束〕），全 loot-free/无敌人/不触发 d_reveal/永不交底、每事件留关灯关声呐的逃生出口，新 `lore.subhadal.*`；9 scenarios + `playthrough-bands`§12（130 抽出/0 泄漏·hadal/cave 双隔离）。事件 100→104、scenarios 110→119。详见 STATUS quirk #72。② **D·Phase 2b 续·超渊前哨 hadal_deep（#66/#67 模板·脊柱再延一段）**——`outpost.hadal_deep`(`band.hadal`·submerged **静水**·3 阶段深料账单升序更贵·result『超渊前哨』) + 建造事件 `lighthouse.outpost_hadal_deep`(`zoneTags:[hadal]` 专属·三阶 flag 门控·`forbiddenFlags:[s3]`)，**引擎全通用零改**（advanceOutpost/deepestOutpostLaunch/outposts 能源衰减）；脊柱 home→reef_deep→trench_deep→hadal_deep，hadal_deep 半亮把 C 开的渊外蛙跳预耗氧从 home **9→1 回合**，软门控（料即门）、不服务更浅 band。`playthrough-outpost`§11 + smoke N1。事件 104→105。详见 STATUS quirk #73。C/D 未发布均不 bump SAVE_VERSION（band/事件/flag 派生、不动形状）。**Phase 2b 仍可续：真 reveal dimming（衰减接 chart.ts 半径缩·需 reveal 回归一起改）/ 寄存材料设施 + 丢失 / 平衡 pass。Phase 3「另一个世界」§3.7 仍留作者逐拍。闲置 ZoneTag 至此（subhadal）用尽——再开 >230m band 须在 types/events.ts 加新 ZoneTag。**
- 2026-06-05（**「A+C+D 全做·打磨到高完成度」session** · 作者选 A+C+D 全做、强调「打磨到高完成度」；A=声呐与房间 S1 多事件房间〔属 `docs/深海回响_声呐与房间_SPEC.md` §11 quirk #74〕、C=深段多 feature 房间内容、D=Phase 2b 真 reveal dimming）：本 SPEC 侧记 C/D。① **C·深段多 feature 房间内容（喂 A·S1 大房间·补料让深 band 大房间有多事件可抽）**——abyssal/hadal/subhadal 各 +2 事件（5→7 / 4→6 / 4→6），守各 band 欺骗母题、全 loot-free/无敌人/不触发 d_reveal/永不交底/单 band tag/每事件留关灯关声呐的盲退出口、3 选项（给入·理智 check·盲退）：abyssal `the_company`〈同行的下沉影子〉/`lower_still`〈虚空上的假底檐·『永远有比最深更深的』〉· hadal `the_fold`〈直线绕回原点更深·空间折叠〉/`the_return_path`〈自己的记号正确地把你往深领〉· subhadal `the_current`〈舒服的下降暖流〉/`the_quiet_yes`〈它不必骗你·你自己同意·『诱饵』收束最深一拍〉；新 `lore.{abyssal,hadal,subhadal}.*`；12 scenarios（`event-runner --out json` 实跑抄 #43·success+fail 各档）。内容事件 105→111、scenarios 119→131；敌人仍 7。② **D·Phase 2b 真 reveal dimming（§3.6·补 #67 明确 deferred 的「衰减不碰 reveal」缺口）**——`effectiveRevealRadius` 随衰减缩半径（见 §5 Phase 2b 记录）＝荒废前哨海图变暗、远海机会点重新隐没、闭合衰减↔海图回路；decay-0 逐字节不变。`playthrough-outpost`§11 + chart/lighthouse/smoke 全绿。详见 STATUS quirk #75/#76。C/D 未发布均不 bump SAVE_VERSION（事件/派生、不动形状）。**下一步＝声呐与房间 S2（不可信扫描·填 `spoofsSonar`/`evadesSonar`·与节点版 mimic 合流）/ S3 / §6.5、Phase 3「另一个世界」§3.7（作者逐拍）、Phase 2b 续（寄存丢失/平衡）。**
- 2026-06-05（**声呐与房间 S2·不可信扫描**，作者方向 A「然后确保这次完成它」；详记在 `docs/深海回响_声呐与房间_SPEC.md` §11，本 SPEC 侧记其对北极星的兑现）：本 SPEC §3.2「不可信声呐（生物躲/骗·低 san 幻觉）」+ §3.5「mimic 的节点版（`spoofsSonar`/`evadesSonar` 节点钩子）」此前只有字段、未填行为——S2 落地：`clarity.ts::nodeSonarView`（spoof→声呐图画成假信标〔**节点版 mimic「无灯之光」**·与 §3.5 海图 mimic #69 合流·**不触发 d_reveal**只由 mimic 兑现事件触发 #42〕/ evade→无回波 / 低 san→读数乱码）+ `sonarPhantoms`（低 san 伪接触·与真无异）+ `effectiveFalseEchoSanity`（新 `DepthBand.sonarDeception` 抬高失真阈值·**非单调**：trench_throat→hadal 越深越骗、subhadal 回落＝兑现「越深越欺骗」的信任梯度〔§3.1〕在渊外反转成『诱饵』）。节点版 mimic 落点＝mapgen `applySonarDeception`（确定性 FNV·零 rng·gated·地标/起点/尸体豁免）。**至此 §3.2 三态感知里「声呐＝不可信回波」从概念变成图上看得见的谎言**；守 §9（回归全绿/软门控/d_reveal 只由 mimic 触发/叙述永不交底/敌人别太多——apex 仍是 EVENT 非战斗敌人）。详见 STATUS quirk #78。**节点版 mimic 与 #69 海图 mimic 的更深耦合（spoofsSonar 节点引向兑现事件）/ S3 威胁定位 / §6.5 宏观灯塔扫描 仍留后续。**
- 2026-06-05（**「彻底完成 D」session** · 作者定向方向 D、要求三项全做「回归文化有 schedule 在跑·这次把 D 彻底完成」；无 AskUserQuestion 逐拍——SPEC §3.6 +「维护成持续压力」北极星已把寄存设施钉得够实，按 SPEC-faithful 默认落地·清晰记录供复核）：兑现 §3.6 此前只字未落的「材料中转/寄存」+「寄存材料丢失」，Phase 2b 衰减三齿（变暗 #67/阶段回退 #66/**寄存丢失** #79）全闭环。① **材料中转/寄存设施**＝深水前哨建 `lhtrack.depot`(outpostOnly·新 `LighthouseEffect.storageCapacity`·**不耗能源**＝被动库房恒在线·避免「能源不够→取不到存料」双罚) 后寄存材料；**维护就近付料则免 ferry 金费**（前哨上有料·不必雇船运下来＝把料前置到深处的回报·更是 home 金/料紧时仍维护得起的逃生阀门）＝§3.6「维护成 base 层持续压力」的正向回报面。② **寄存丢失**＝`effectiveStored`（raw − `depotDecayLevel`×`DEPOT_LOSS_PER_LEVEL` 锈蚀·**独立 `storedRun` 计时**与结构 `maintainedRun` 解耦：建造一阶只重置结构、存/取/维护才打理寄存·激流前哨锈得更快·满 4 级最多 4 单位·**非永久全损**可重存补回守 §3.6）·**derive-only**（同 `effectiveRevealRadius` 风格·提交只在玩家动作·烤入损耗不复活）。存档＝`outpostState` 条目扩 `{ maintainedRun, stored?, storedRun? }`(additive·JSON-native 无 Set·**不 bump SAVE_VERSION**)。**架构守单向依赖**（outposts.ts→lighthouses.ts 不可循环）：寄存逻辑全在 outposts.ts·`advanceOutpost` 只保留字段·无寄存活动前哨写 `{maintainedRun}` 既有 -outpost/-save 回归逐字节不变。③ **深渊前哨 `abyssal_deep`**(`band.abyssal`·静水·3 阶深料 110/180/290·#66/#73 模板·引擎零改) 补脊柱 home→reef_deep→trench_deep→**abyssal_deep**→hadal_deep（hadal 蛙跳 home 7→1 回合·也缩短 subhadal·不服务更浅 band）+ 建造事件 `lighthouse.outpost_abyssal_deep`(`zoneTags:[abyssal]`)。④ **平衡 pass**＝`outposts.ts` 顶加基准复核块（建造账单单调阶梯 reef Σ280<trench Σ480<abyssal Σ580<hadal Σ660·钉新值·复核既有衰减/能源/reveal-dimming/S2 失真/mapgen 均自洽**未改**——无实测不擅动作者已调值）。回归 `playthrough-outpost`§0/§12/§13 + `playthrough-save` round-trip + smoke M5/N1/N3/N4·全绿 25/25。详见 STATUS quirk #79。**Phase 2b 仍可续：寄存丢失更狠后果 / reef 第二前哨 / 维护账单随深度分级 / 平衡实测。Phase 3「另一个世界」§3.7 仍留作者逐拍。**
- 2026-06-06（**声呐图垂直化＝真实深度·「位置即深度」系统不变量** · 作者已定定向任务·#92·见新 §13）：声呐图 / MapDevPanel 纵轴此前无深度含义（`deriveMapLayout` 把 depth 横排 x∝layer、y 只是同层 id 堆叠序）→ 改成 **y∝node.depth（上浅下深·真实米数·固定 px/米）**，x 改同深度分散（按 depth 分箱居中·纯避重叠·无方向语义），SonarScanPanel viewBox 转 portrait + `focusWedgePath` 重映（deeper↓/back↑/lateral←→·SVG y 朝下）。**关键耦合**：`engine/sonar.ts::nodeSector` 从 layer 差分改 **depth 差分**（新 `SECTOR_DEPTH_EPS` 容差），否则「朝深」楔形指下、定向 ping 却扩 layer-deeper（迷路图里可能 depth 更浅、渲染在上方）＝自相矛盾——`revealSonarScanDirectional`/`stalkerSector`/`seenStalkerSector`/`pingAimsAtSoundStalker` 全随之按真实深度。**做成系统不变量**（§13）：审计确认 mapgen 主下行 depth 早已单调-from-start（层状 `round(d0+step·L)`·迷路树距+jitter 起点钉 d0、最深钉 d1），P3 只加 `playthrough-mapgen-scenarios` 垂直性不变量兜（迷路 60+层状 30 seed·**不改生成·不破快照**）；以后放事件/房间/猎手 spawn 都按深度（『更深』母题落更深节点·浅段 fresh-wrongness 落浅节点）。视觉验证＝SSR→SVG 坐标核对（绿≠画对·quirk #91 教训）：上浅下深 monotonic / 楔形朝下 / min 间距≥blip 直径无重叠 / 回边 chord 可读。未发布不 bump SAVE_VERSION（布局纯渲染派生·EPS 是常量）。提交 feat `1829d14`。详见 §13 + STATUS quirk #93。**声呐图渲染层至此与下潜剧情一致；下一步＝内容（按深度母题继续铺）或 Phase 3「另一个世界」§3.7（作者逐拍）。**
- 2026-06-12（**章节哨站批定调** · 作者线上验收反馈四拍·#118·实装留下个 session 主任务）：① **哨站上大地图**——前哨（蛙跳入口）改为从**海图**选择：点海图上的哨站 → 从那里选目标 band 蛙跳（替代/收编现行港口侧入口；前哨本就是 push 进 lighthouses 的图上实体，缺的是「点它出蛙跳菜单」的交互层）。② **章节三哨站**＝同一 outpost 体系加三个新 `OutpostDef`（阶段建设/荒废衰减/能源设施照旧），坐标落一章锚点②温带沉船/③远洋中层/④海沟热液场三区（**区域①由灯塔解锁**＝home 灯塔已覆盖漆号珊瑚丛·不加哨站）；**解锁门=剧情+建设串联**：完成对应锚点节拍 → 哨站在海图从「暗」转「可建」→ 材料+金币建设（现有账单机制）→ 点亮；dev 下可免费解锁（devBuildAtLighthouse/devAdvanceOutpost 同 #110 口径）。③ **首扫仪式**：哨站点亮后第一次扫描＝一次性 reveal 演出——显示周围**所有**点（特殊需要隐藏的除外·mimic 类不因仪式失去其 tell 轴），随后**因气候等原因暂不可用的点转暗**。④ **暗点语义（作者拍·关键）**：暗=已知但暂不可去，且**暗后仍会随气候消失/重现**（现有浓雾遮蔽/runsCompleted 潮汐那套扩大到三态：亮=可去·暗=已知不可去·无=未知或被气候暂时收走）——海图可见性从两态升三态，「首扫全显」是仪式不是永久承诺；诚实轴不破：暗与隐没都是天气的真话，不是谎言（mimic 仍是唯一说谎的点）。实装牵动：chart.ts 可见性派生三态化 + SeaChartView 渲染/锁原因提示 + OutpostPanel 蛙跳入口迁移 + 首扫动画（沿 #80 survey-sweep 先例）+ 三 OutpostDef 数据 + 剧情门接 ch1 锚点 flag（quirk #118 派生读 ch1Story）——**成块 feature·下个 session 主任务·仪式感演出作者在场逐拍**。
- 2026-06-12（**电池/灯装备化经济定向** · 作者同晚四件反馈之三·#118·实装排期待定。**含对 0a 旧记录的澄清（作者补拍同晚）**：「浅水接近免费」是当年沟通误记——真实口径是 ① **耗电不随深度增加**〔=06-03 ④「无深度耗电税」不变〕② **有自然光的水域根本不需要开灯**＝浅水「免费」的真相是灯关着，不是灯白点；0a 拍板按此读，不存在被推翻的部分）：作者终态愿景——**灯与电池都是装备、要购买**；**电池买了才显示电量条**；前期电池**只能勉强支撑灯的使用**＝暗处开灯就要算电量预算；后期**材料制作**更高电量电池/更省电的灯；**深处灯照不够用、被迫上声呐——声呐耗电远大于灯**（灯耗电低但真实·声呐=大头；visibility→被迫声呐→电量压力的既有回路不变，电池成为声呐的第二道门）。机制面：有自然光水域=不开灯无惩罚（深度/visibility 派生环境光）；lightDrainFactor 从近零改为「低但真实」；电池装备化（`EquipmentLoadout` 已有 light 槽·电池=新槽位或随 tank 族建模待定）；power/powerMax 从升级派生改为装备携带；电量条显示门控在「持有电池」；经济接线走装备购买+材料制作线。与三章科技路「电力槽」（剧情 SPEC 九批·电力槽=生长现有 power 轨）同向——电量从隐形资源升为贯穿全程的主资源轴。**牵动 power/clarity 数值与回归基线＝成块 feature·需作者在场调手感·别在内容批顺手做。**
- 2026-06-12（**电池系统终态四点** · 作者同晚再补·#118·上一条「装备化定向」的具体化）：① **声呐和灯都是装备、各带自己的电池槽**——槽里放电池、各自独立耗电；**角色没有「电量」属性**（run.power/powerMax 退场，电只存在于「哪块电池里还剩多少」）。② **电池本身是道具**（与 medkit 同类·占背包/仓库格）：可装入装备槽；**用完不消失**——回港可充电，特殊场景事件里也可充（事件 op 候选）。③ **制作高级电池的材料之一=低级电池**（升级链吃旧件·消耗品制作线与材料门控并轨）。④ **后期更多装备（尤其科技线）也吃电池**；并有**剧情电量门**：「放入电量高于 X 的电池才能启动某设备/建筑」。实装注记（下次开工别重新发现）：电池=带电量状态的道具，与现行 `{itemId, qty}` 堆叠库存冲突——候选 (a) 充电档=不同 itemId（满/空两态道具·耗尽即换 id·堆叠模型不动·回港充电=空→满）·(b) 库存升格实例制（大动）；倾向 (a)，电量连续值需求出现时再议。**与九批「电力槽=生长现有 power 轨」的措辞需回校**（终态=槽分布在装备上、无全局 power——三章「电力槽」语义届时按本条重述，方向不冲突：都是「电=可携带可制作的资源实体」）。回港充电免费与否/充电速率/初代电池容量=数值批一起拍。
- 2026-06-13（**章节哨站批·机制核落地 + 区域揭示视觉定调（demo 过目）+ 声呐 reach 调参** · 交互 session·#118 续）：① **机制核已实装**（CHANGELOG #118·commit `20607fd`）：三章节 band（band.ch1_wreck/midwater/vent）+ 三 OutpostDef（落锚点②③④区）+ `OutpostDef.requiresAnchor` 双义（解锁门 + 章节网解耦·quirk #122）+ 显式起跳蛙跳（launchOutpostId·deepestOutpostLaunch 跳过章节前哨）+ OutpostPanel 锁态/蛙跳按钮。**蛙跳模型 = 各自跳回本锅点区（新 band）**（作者 AskUserQuestion 拍·替代「并入深脊柱/另成解耦网」）。② **区域揭示视觉定调（作者过 demo 拍「就是这样」·实装风格会更精致非 demo 那么简陋）**：四个「类老灯塔」的揭示圈——**家灯塔=海岸线半圆**（同现状·从左海岸线鼓进水里）、**章节三哨站=离岸整圆**（半径比老灯塔略小但圆形仍覆盖多点）；解锁点亮→揭示圈内的点可见；**为看到新区，海图边界随之外扩**（demo 用 fit-zoom 演示·实装可同理或扩 viewBox）；前期用不同颜色的圈，**后期做手绘背景图**（揭示圈届时只留描边）。③ **暗点语义再确认**：被遮蔽的点**多数彻底不显示（无）、少数显示但过不去（暗）**——和现状差不多（现有 locked/climate 那套）。④ **新增需求两条**：**(A) 升级哨站→搜到更多「已知不可去」(暗) 点**（哨站设施升级轨加一档「勘测/扫描」类设施·抬高该站的暗点揭示数·骑 tri-state reveal 系统·属主实装块）；**(B) dev 一键解锁本区**（像 demo 的按钮·不走剧情/材料直接开前哨+对应潜点）——**(B) 本 session 已实装**：`engine/lighthouses.ts::devUnlockChapterRegion`（置 tutorial_complete + 锚点 flag + devAdvanceOutpost 连推点亮·真路径零触碰）+ OutpostPanel ?dev「解锁本区（dev）」按钮·playthrough-outpost §14g。⑤ **海沟可读性·声呐 reach 调参（作者复议「85-118m 灯照不到不合理」后拍）**：诊断＝海沟是竖井（depthCurve shaft·首跳就 14m·超灯6/声呐14 reach），且 midwater 匀步层灯本就读得到＝问题在竖井落差非绝对深度；**保留「深处灯照不透」**，改**抬声呐 reach `SONAR_DEPTH_REACH` 14→22（MAX 26→30）**＝声呐成深水的眼，竖井上半段开声呐可读、最深陡降（>22m）仍需凑近摸黑（守北极星）。playthrough-sensors §12 加 deep(dd26)/abyss(dd35) 重写。**对应剧情口径（作者补）**：前期浅洞探险不需声呐就能靠灯看到「事件」，后期有声呐才看到「洞穴完整形状」——与本调参一致。**遗留＝区域揭示主实装块（下个 session·作者可在场调风格/手感）**：chart.ts 可见性派生三态化（亮/暗/无·扩 climate 遮蔽到三态）+ SeaChartView 揭示圈（家半圆/哨站整圆）+ 海图边界外扩 + 首扫仪式（#80 sweep）+ 需求(A) 升级搜更多暗点（设施轨）+ **收编旧「深潜·蛙跳（试验）」band 列表与独立面板**（点海图哨站圈→选 band 蛙跳·替代旧港口侧入口）。
- 2026-06-13（**区域揭示主实装块·完整规格（作者对照真机 vs demo 给详细愿景·#119 续·下个 session 主任务·这是实装权威依据）**）：作者列出真机与 demo 的两处偏差 + 七条哨站愿景，全部记此为实装合同——
  **A. 偏差订正（demo→真机要改的）**：① **点位只在扫描圈内存在**——揭示圈（灯塔/哨站）外不出现任何 POI（现 chart 把 anchor/roaming 满图铺＝偏差根源：现 `generateChart` push 所有 visible 点·story/anchor 恒可见）。改＝可见性**完全由揭示圈门控**（圈内才进结果）。② **世界变大**——核心是**边界（可探索世界范围）随解锁外扩**，看更远靠**缩放/拖拽（pan/zoom）**。作者补「autozoom 也不错」＝**demo 的 fit-zoom 自动缩放也可接受**：二者非互斥，实装可「解锁时自动 fit 到新边界 + 之后允许手动 pan/zoom 探索」结合。复用声呐图 pan/zoom 先例（SonarScanPanel #112/#113·拖过阈值才捕获指针防吞点击）。
  **B. 蛙跳收编**：旧「深潜·蛙跳（试验）」band 列表**删除**——哨站本身即入口：**点海图哨站→选目标→从更深处起潜**（startDiveFromOutpost launchOutpostId 已就位·只缺这层 UI）。「下面那些条目」（OutpostPanel 列表行）也去掉（见 C1）。
  **C. 哨站七条愿景**：
   1. **无下方列表条目**——OutpostPanel 的 `<ul>` 行式建造/维护/能源面板撤掉；交互移到点击地图上的哨站（见 C5）。
   2. **揭示 + 扫描流程**：特定剧情达成→地图显示**还未解锁哨站的位置**（暗标记/locked marker）；**完全解锁后走一次「大扫描」**。**不是每次回港都扫**——只在 ① 气候变化 ② 升级 ③ 点位更新 时各扫一次。**关键：新增和消失的点都在扫描线抵达该点时才发生状态变化**（sweep 动画门控 add/remove·非瞬时·续 #80 survey-sweep + 声呐渲染「波到才亮」#100-#102 同理）。
   3. **哨站/灯塔扫描比声呐慢很多**（扫描线速度·SWEEP_MS 调大；声呐图扫描是另一回事·这是宏观海图扫描）。
   4. **dev 下拉菜单**直接解锁**还未被发现的**哨站（区别于已实装的「解锁本区」按钮·这是「让未发现的哨站现身」的 dev 入口·候选 select + devUnlockChapterRegion/新 devRevealOutpost）。
   5. **点击地图哨站→显示其升级选项**（取代 C1 的列表面板）；dev 下免费（devBuildAtLighthouse/devAdvanceOutpost/devUnlockChapterRegion 同口径）。
   6. **每个哨站扫描圈颜色不同**（同 demo·家蓝/残骸青/中层琥珀/热液珊瑚·风格可保持游戏现状不照搬 demo 简陋）。
   7. **地图显示宽度与下方界面对齐**（CSS·chart-map 宽度=面板宽·现 aspect-ratio:1/1 max-width:460px 见 quirk #113·要对齐改这条）。
  **实装牵动（建议顺序）**：(1) chart.ts 可见性派生：reveal-gated（圈内才出）+ 三态（亮/暗/无）+ climate 扩三态；(2) 新 pannable/zoomable 固定 viewport 海图组件（世界坐标·边界随解锁外扩·复用声呐 pan/zoom）；(3) 大扫描 sweep 动画 + **sweep-line 门控 add/remove**（触发=气候/升级/点位更新·持久态记「已扫到的世界范围」候选 outpostState/scanMemory 类）；(4) 点击哨站→升级 popup（替代 OutpostPanel 列表）；(5) dev 下拉解锁未发现哨站；(6) 删旧蛙跳 band 列表+OutpostPanel 行·点哨站→选目标蛙跳；(7) 圈分色 + 宽度对齐。诚实轴/北极星不破（暗/隐没=天气真话·mimic 唯一谎点·anchor 进度安全）。**作者在场调风格/手感最佳**。

---

## 11. Phase 0 实装清单（0a 感知 / 0b 探测）

> 给开建 Phase 0 的 session。**0b 依赖 0a 的 `signature`**；每个勾选项收尾跑全绿（§9）。先 0a（纯感知、不碰 combat、可独立全绿），再 0b。

### 0a — 微观 clarity + 不可信声呐（纯感知，不碰 combat）✅ 已实装（2026-06-03，提交见 STATUS quirk #58）

**实装期三处与原清单的偏差（作者在场敲定，见 §10 决策日志 2026-06-03）：**
1. **声呐后期解锁**（作者新增）：声呐能力门控在深料升级 `upgrade.sonar.lv1`（T4 冷光腺 + T3 料 + 金）。早期＝仅有灯，黑水区天然探索受限——玩家先经历"黑暗中无声呐"，再分级解锁。`run.sensors.sonarUnlocked` 派生自 `getUpgradeBonuses().sonarUnlocked`。
2. **`clarity(run)` 而非 `clarity(run, node)`**：0a 的预览档只读 run 级传感器状态（灯/声呐/电/dark）；node 级细分（按深度/band 提成本曲线）留 Phase 1。
3. **`DiveModifier.visibility` 并入而非删除**：作为 clarity 的**输入**保留（`dark` → 灯打不透 → `none`；`murky` 不挡灯但耗电 + 理智压力照旧）。`visibilitySanityDrain` 不动。

**数据 / 类型**
- [x] run 加 `sensors: { light; sonar; sonarUnlocked }` + `power`/`powerMax`（电池）；派生 `signature(run)`（`engine/clarity.ts`）。
- [x] 新 `engine/clarity.ts`：`clarity(run)` → 预览档（`full`/`sonar`/`none`）；`sonarReturn(run, node)` → 不可信表象（可被 evade/spoof/低 san 改写、≠ 真内容）；`lampPreview(run, node)`（真相 / 极低 san 幻觉）。tunables 集中文件顶（§8）。
- [x] 节点可选字段 `evadesSonar?` / `spoofsSonar?`（先加字段 + 默认不改写，留 Phase 3 填；`sonarReturn` 已读它们）。
- [x] `DiveModifier.visibility` 并入 clarity（旧 `dark`＝`none` 档，沿用 quirk #27/#41 盲航 + #36 尸体提示门控）。

**引擎**
- [x] `dive.ts::enterNodeSelection`：按 `clarity(run)` 把每个选项 preview 烤成 真相 / `sonarReturn` 表象 / 盲（地标盲航仍显示）；choice 带 `clarity` 档供 UI。
- [x] 传感器开关 + ping：`setLight` / `pingSonar`（耗 `SONAR_PING_COST` 电 + sonar='ping' + 刷新选点；需已解锁；移动后 ping 归 off）；`power` 归 0 → `clarity` 强制 `none`。
- [x] 低 san 注入（§3.2/§3.7）：san < `SONAR_FALSE_ECHO_SANITY`(60) → `sonarReturn` 注入假回波；san < `LAMP_HALLUCINATION_SANITY`(25) → 连灯也产假预览。确定性哈希（不消耗 RNG），叙述永不交底（#54）。
- [x] `tickTurns` 消费 power（灯耗电，清水因子 0 → 浅水近免费；黑水/微浊才耗；类比 oxygen）。

**存档** — [x] **未发布暂不做迁移**（作者 2026-06-03）：不 bump SAVE_VERSION（留 4）、不加 `migrateSave` 步；run 新字段靠 `createNewRun` 种默认 + 反序列化处 `?? 默认` 兜底。`playthrough-save` 仍校验 sensors/power 序列化 round-trip。发布前再按 quirk #39 补迁移。

**UI** — [x] `NodeSelectView` 成纯渲染器：按 `choice.clarity` 渲染预览 + 灯开关 / 声呐 ping 按钮（门控解锁 + 电量）；`StatusBar` 加电量 pill。[x] `smoke-chart-ui.tsx` E 改写为 clarity 渲染 + 电量 + 传感器断言（quirk #38）。

**回归** — [x] 新 `playthrough-sensors.ts`（10 节）：灯=真相 / 黑水无声呐=盲 / ping 可被 spoof 改写 + 耗电 / 未解锁 ping 无效 / power 归零摸黑 / 低 san 假回波 / 更低 san 灯幻觉 / tickTurns 分级耗电 / 移动 ping 消散 / signature 排序。全绿 + prod build。

### 0b — 探测 / 隐身（碰 combat，依赖 0a 的 signature）✅ 已实装（2026-06-03，提交见 STATUS quirk #59）

**作者拍板（AskUserQuestion）**：探测做成「**警觉积累 → 接近/伏击**」（§3.3 最完整形态，非轻量 roll、非只调现有战斗）。**关键发现**：今天战斗 100% 由事件选项触发（零自动遭遇），故这是**新增的自动遭遇路径**。

- [x] `signature(run)` 经 `alertDelta` 接进 run 级**警觉** `run.alert`：点灯/ping 在深水逐回合抬、摸黑/浅水消退（`tickTurns` 累加、clamp 0–100）。
- [x] **警觉积累**（实装为 **run 级**而非 node 级——警觉是"捕食者对你的注意"、随你移动，比 per-node 更贴）：`alertDelta = (signature 超基线 × 深度因子 × GAIN) − DECAY`；深度因子浅水 0（§7.5）、25m 起爬升、60m 满。
- [x] `moveToNode` 读警觉：`predatorApproaches(run)`（alert ≥ THRESHOLD 60 + 够深）+ 进的是非地标节点（事件/尸体）+ 该 zone 有 `ambushEncounters` → `startCombat` 触发接近遭遇（复用 zone 现有 solo 敌），触发后 alert 落回缓冲。地标（上浮口/气穴/扎营）不被伏击＝总留「摸黑奔向出口」的出路。**可生存无脚本死**：UI 预警有窗口（ALERT_WARN 35）+ 摸黑能甩 + 遭遇本身可打可逃。
- [x] `zones.json` 加 `ZoneDef.ambushEncounters`：reef/cave/wreck 三深水 zone 各配 2 个现有 solo encounter；教学/浅水 zone 不配（§7.5 数据兜底）。
- [x] UI：`NodeSelectView` 高警觉预警（WARN 黄 / THRESHOLD 红，提示熄灯）；`smoke-chart-ui` E2 断言。
- [x] 回归：新 `playthrough-stealth.ts`（6 节：抬升/消退/浅水免压/越线触发/摸黑滑过/无池不触发）。`playthrough-combat`+`combat-scenarios` 不变（既有事件触发战斗未动）。
- [x] 平衡（§8 tunable）：ALERT_GAIN 1.5 / DECAY 3 / THRESHOLD 60 / WARN 35 / MIN_DEPTH 25 / AFTER_TRIGGER 0 / signature 权重沿用 0a。60m 满因子约 10 回合到阈值、声呐 ping 远慢于举灯。

### 升级（0a 尾或挪 Phase 2）
- [x] **声呐解锁轨**（0a 已做）：`upgrade.sonar.lv1`（`line.sonar_rig`，深料账单：lantern_gland T4 + eel_skin/cave_octopus_beak T3 + 金）→ `unlockSonar` effect → `getUpgradeBonuses().sonarUnlocked` → `getRunBonuses` → `createNewRun` 种 `run.sensors.sonarUnlocked`。这套桥（effect → bonuses → getRunBonuses → createNewRun 种 run）就是 #60 升级轨续用的模板。
- [x] 灯/声呐 **效果·耗能 + 电量** 档位做升级轨（**2026-06-03 实装，详见 §10 决策日志 + STATUS quirk #60**）：作者四旋钮全选——**powerMax（电池容量）/ 能耗效率（灯每回合耗电 + 声呐 ping 耗电）/ 抗欺骗（灯·声呐 各自的低-san 失真阈值）/ 隐蔽（signature 减免）**。组织＝**复用 `line.sonar_rig` 续 `upgrade.sonar.lv2`（ping 省电 + 声呐抗欺骗）+ 新 `line.dive_kit`「潜水装备」线（lv1 电池 / lv2 聚光灯具〔灯效率 + 隐蔽〕/ lv3 抗扰灯罩〔灯抗欺骗 + 电池〕）**，账单深度分层（浅料起步、高阶 T3/T4 深料）。链路：6 新 `UpgradeEffect` → `getUpgradeBonuses`（sum）→ `getRunBonuses`（透传）→ `createNewRun` 烤成 **`run.sensorTuning`**（新类型）+ `run.powerMax`；`clarity.ts` 纯函数读 run-effective 值、缺省回退文件顶基线常量（故旧档/部分 run/未升级＝0a/0b 基线，逐字节一致）。地板/上限集中 `deriveSensorTuning`，守两条铁律——**无完全可信传感器**（抗欺骗有地板、永不归零）+ **读真相必自曝**（隐蔽有上限、点灯/ping signature 永 > 摸黑）。**范围/分辨** 仍留 **Phase 1**（需节点级 clarity，0a 已声明 deferred）。未发布故不 bump SAVE_VERSION（`run.sensorTuning` 是普通对象、JSON 自动 round-trip + 读取兜底）。

**全程守 §9**：每勾全绿、SAVE_VERSION 迁移、UI 补 smoke、tunables 集中（§8）、叙述永不交底（低 san 假回波/幻觉文案也不交底）。

---

## 12. Phase 1 实装清单（plumbing 已实装，2026-06-03，quirk #61）

> Phase 1 原本没有 §11 那样的清单——开建前用 AskUserQuestion 跟作者 pin 了四点（见 §10 决策日志 2026-06-03 第二条）。本节记已实装的 plumbing 与明确 deferred 的部分。

**数据 / 类型** ✅
- [x] `types/bands.ts`：`DepthBand { id, name, zoneId, depthRange[绝对], order, visibility?, current?, blurb, danger? }` + `BandsFile`。**无 `unlockedBy`**（软门控，作者定）。
- [x] `data/depth_bands.json`：全局深度阶梯（order 升序＝越深越后、可续写、不硬编码地板）。3 band：`reef_deep`（灯塔礁 45-60m murky）/ `trench_mouth`（蓝洞 60-82m **dark·破 60m**）/ `trench_throat`（蓝洞 82-108m **dark·递归更深**）。trench 暂借蓝洞群内容＝占位。
- [x] `engine/bands.ts`：`getBands`（order 升序）/ `getBand(id)` / `bandDiveModifier(band)`（visibility/current → PoiModifier，不走 depthOffset）。

**引擎** ✅
- [x] `mapgen GenOpts.depthRange`：band 用**绝对 depthRange 覆盖** zone.depthRange（缺省回退 zone，POI/教学不受影响）。depthOffset 仍叠加。
- [x] `dive.ts::startDiveFromOutpost(state, bandId)`：镜像 `startDiveFromPoi`——home 灯塔当 stand-in outpost、band 绝对窗口透传 mapgen、`bandDiveModifier` 落 run.diveModifier、蛙跳预耗氧、**走 `getRunBonuses`（Phase 0 升级轨 sensorTuning/powerMax 直通＝软门控的钥匙）**。出潜叙事抽 `appendVisibilityLog`（与 startDiveFromPoi 共用、避免漂移）。
- [x] `clarity.ts`：写死的 `60`（alertDepthFactor 满档深度）抽成 `ALERT_DEPTH_FULL` 常量；深 band（>60m）饱和=1、不报错（Math.min 兜底）。

**软门控（作者：材料装备限制探索 + 后续强敌战力检测）** ✅ plumbing
- [x] band 不锁——深 band = 黑水（dark）→ `lampEffective` false → 没声呐（声呐是深料升级 #58）就 `clarity none`（瞎）；电池/抗欺骗/隐蔽（#60）都吃深料 → 装备成长＝下潜深度的事实门槛。
- [ ] 「强力敌人做战斗力检测」＝深 band 接 apex（Phase 3 mimic/corpse-wearer）/ 复用 zone ambushEncounters（0b）；本期没加敌人（守 2/zone）。

**UI** ✅ 最小版
- [x] `SeaChartView` 蛙跳列表（home 灯塔在则列出全部 band、软门控不锁、`danger` 进 title）；`smoke-chart-ui` A2 断言渲染。

**回归** ✅ — [x] 新 `playthrough-bands.ts`（7 节：band 表/破 60m/depthRange 覆盖/startDiveFromOutpost/软门控瞎着下/升级直通/alert 饱和）。全绿 + prod build。未发布不 bump SAVE_VERSION（band 派生、不入存档）。

### 节点级 clarity：深度分档 + 范围/分辨升级（✅ 2026-06-04，quirk #62）

> §12 plumbing 把 60m 上限打通；本续把 0a 的 run 级二元 clarity 做到节点级（"范围/分辨"，#60 明确 defer 到此的那块）。无新存档形状、UI 零改（per-choice 渲染早在 0a 就位）。

- [x] `engine/clarity.ts::clarityForNode(run, node)`：在 `clarity(run)` 天花板之上按节点**深度差** `node.depth − currentDepth`（只算往下的陡降）降档——浅水 `≤ CLARITY_FULL_DEPTH`(25，§7.5 浅水线) 豁免＝所见为真；深水灯档 dd≤`LAMP_DEPTH_REACH`(6) full / 超灯且 sonarActive 且 dd≤`SONAR_DEPTH_REACH`(14) sonar / 再深 none；声呐档 dd≤sonarReach sonar 否则 none；横上行不降档。`clarity(run)` 保留作天花板（UI header）。
- [x] **范围/分辨升级轨（填 #60 缺口）**：`SensorTuning` 加 `lampDepthReach`/`sonarDepthReach`；2 新 `UpgradeEffect`（`lampRangeBonus`/`sonarRangeBonus`）沿用 #58/#60 桥；`data/upgrades.json` 加 `dive_kit.lv4`（灯 reach +4）+ `sonar.lv3`（声呐 reach +8）。`deriveSensorTuning` 夹上限 `LAMP_DEPTH_REACH_MAX`(14)/`SONAR_DEPTH_REACH_MAX`(26)——**均 < 最深陡降＝灯/声呐升满也照/扫不穿最深、最深处必须自己摸黑或委身声呐**（守"永远有比最深更深的"/"读真相要付代价"）。`UpgradePanel::renderEffect` 补 2 标签（quirk #38 护栏）。
- [x] **护栏**：`enterNodeSelection` per-choice 烤 `clarityForNode`；**Lv.1 标记的尸体 + 灯有效 → 豁免深度降档**（尸体定位是地图知识、不被深度藏住，守 quirk #36，避免节点级 clarity 误伤既有功能）。
- [x] **回归**：`playthrough-sensors` §12（9 节）+ `-upgrades`§8（dk lv4/sonar lv3 reach 聚合直通）+ `-save`（reach round-trip）+ `smoke` J5。全绿 + prod build。未发布不 bump SAVE_VERSION（sensorTuning 普通对象 round-trip + 兜底）。

### trench 专属内容：band.tags + 「回波对不上」事件（✅ 2026-06-04，quirk #63，作者选「深段/trench 内容」→「回波对不上」母题）

> §12 plumbing 把 60m 上限打通后，trench band（60-108m）一直**借蓝洞内容＝占位、事件池空**（深 cave 事件 ≤60m）。本次给它专属内容，落 §12 Deferred 的「band 级 tag 池」+「trench 内容」。**45-60m 深段欺骗封顶（false_beacon / the_wearer，#57）之下、整套伏笔最深的一层。**

- [x] **band 级 tag 池（最小可扩展 plumbing）**：`DepthBand.tags?: ZoneTag[]`（types/bands.ts）覆盖 zoneTagsByDepth。**复用 `ZoneTag` 里早已存在但闲置的 `twilight`/`midnight`/`abyssal`** → 零类型改动、无穷尽 switch 风险。链路：`startDiveFromOutpost(band.tags)` → `startDive(opts.bandTags)` → `mapgen GenOpts.bandTags` → ①节点 zoneTag 抽取 `opts.bandTags ?? tagsForDepth` ②`buildEventPool(tagsOverride)`（图与池同 tag）。depth_bands.json：trench_mouth=`[cave,twilight]` / trench_throat=`[cave,midnight]`（附加 cave 保回退池、避免空水道；abyssal 留 >108m 续）。
- [x] **`data/events/trench.json`（6 事件，母题「回波对不上」＝声呐返回≠点灯真相）**：付现 Phase 0 不可信声呐（#58）+ 节点级 clarity 陡降变黑（#62）。系统覆盖 ping 骗你的全部方式——假底 `the_return`(cosmic·oncePerRun) / 假人 `second_diver`(uncanny·corpse-wearer 声呐侧回声) / 距离不对 `the_sounding`(uncanny) / 假墙 `the_wall`(cosmic·oncePerRun·付现 throat blurb) / 被应答 `the_answer`(cosmic·oncePerRun·轻触 §3.7) / 没有回波 `no_echo`(uncanny)。全 loot-free / 无敌人（守 2/zone）/ 不触发 d_reveal（#42）/ 叙述永不交底（§9 / #54）；每事件留「关声呐·摸黑」诚实但盲的出口（感知双刃 §3.2-3.3）。新 `lore.trench.*`。
- [x] **回归**：12 `scenarios/trench_*.json`（#43 实跑抄 delta）+ `playthrough-bands.ts` §8（band.tags 端到端 + 不泄漏）。事件 81→87、敌人/combat/item 不变。全绿 + prod build。未发布不 bump SAVE_VERSION（band.tags 派生、不入存档）。

**Deferred（明确留后续）**
- [x] **band 级 tag 池 + trench 专属事件**（band `tags` 覆盖 zoneTagsByDepth）：**已实装（2026-06-04，quirk #63，见 §12「trench 专属内容」小节）**——`DepthBand.tags?` 用既有闲置 ZoneTag `twilight`(口)/`midnight`(喉)、`data/events/trench.json` 6 事件「回波对不上」。专属 trench/abyss **zone**（非 tag）仍可后续再拆；事件池可再加密。**续更深 band：已开 `band.abyssal`（108-140m，#65，`tags:[cave,abyssal]`）、`band.hadal`（140-180m，#68，新 ZoneTag `hadal`）、`band.subhadal`（180-230m，2026-06-05 quirk #72，新 ZoneTag `subhadal`·`data/events/subhadal.json` 4 事件「深处的诱饵」——闲置 ZoneTag 至此用尽）；>230m 仍可续写（不硬编码地板，但须在 types/events.ts 加新 ZoneTag）。**
- [x] ~~**范围/分辨**：节点级 clarity~~ → **已实装（2026-06-04，quirk #62，见上）。**
- [x] **真前哨蛙跳**：**已实装（2026-06-04 Phase 2a quirk #66）**——`startDiveFromOutpost` 从 `deepestOutpostLaunch`（半亮 ≥USABLE 且更浅的最深前哨）起跳、预耗氧按「目标顶−前哨底」；Phase 2b（#67）接能源/衰减、D（#73，2026-06-05）把脊柱延到 `band.hadal`（超渊前哨 hadal_deep 服务渊外 subhadal 蛙跳、9→1 回合）。
- [x] **成本曲线细化**：band 级 alert 倍率 → **已实装（2026-06-04，quirk #64）**：`DepthBand.alertFactor?`（缺省 1）→ `run.bandAlertFactor` → `alertDelta` 只乘暴露增益（reef_deep 1/mouth 1.3/throat 1.6/深渊 2.0），在 `ALERT_DEPTH_FULL`(60) 深度因子饱和之上续「越深越凶」。注：深度因子本身仍在 60m 饱和（band 倍率承担更深的加压），「不饱和斜坡」仍可后续替换 band 倍率（若想要连续而非阶梯）。

---

## 13. 地图垂直性＝深度（位置即深度·剧情一致 + 内容生成约定）

> 2026-06-06（#92）确立的**系统不变量**。声呐图（下潜内）/ MapDevPanel（调试器）纵轴＝真实深度，且 mapgen 与未来内容生成都按"位置即深度"对齐——往下潜＝往下看，符合潜水剧情。**改 / 加任何涉及地图布局、声呐扇区、深度放置的内容前先读本节。**

**渲染（单一来源 `ui/mapLayout.ts::deriveMapLayout`，SonarScanPanel + MapDevPanel 共用）**
- `y ∝ node.depth`：上＝浅（小 depth → 小 y）/ 下＝深，真实米数，**固定每米像素比例**（`pxPerMeter`，取 > 最大 blip 直径 → 相邻整数米节点纵向不重叠）。声呐取景窗只显玩家附近一小片＝固定可视深度跨度（深图更长无妨）；MapDevPanel viewBox=整张图＝自然尺寸纵向可滚。
- `x` = 同深度并列分散（按 depth 分箱·箱内按 id 居中排开·`colW` > 直径避重叠）·**无方向语义**（深浅只由 y 表达）。
- 边可上可下（朝浅＝朝上＝truthful·迷路回边天然朝上）；`chord`（跨层回边近似·`layer` 差 ≠1）由 consumer 差异化/淡化。
- `SonarScanPanel`：viewBox portrait（窄×高）；聚焦楔形 `focusWedgePath` deeper↓〔+π/2〕/ back↑〔−π/2〕/ lateral←→〔0 & π〕（SVG y 朝下）；量程环/楔形/接触半径用 `min(VIEW_W,VIEW_H)`。

**扇区（`engine/sonar.ts::nodeSector`，定向 ping / 猎手扇区）**
- 按 `node.depth` 差分（**非 layer**）：deeper＝更深米（Δ > `SECTOR_DEPTH_EPS`）/ back＝更浅（Δ < −EPS）/ lateral＝|Δ| ≤ EPS。**必须与 y∝depth 一致**——否则「朝深」楔形指下、ping 却扩 layer-deeper（迷路图里那节点可能 depth 更浅、渲染在上方）＝自相矛盾。涟漪：`revealSonarScanDirectional`/`stalkerSector`/`seenStalkerSector`/`pingAimsAtSoundStalker` 全经 `nodeSector`（引擎不 import ui/mapLayout）。

**生成（`engine/mapgen.ts`）——主下行 depth 单调-from-start**
- 层状（开阔水域 reef/wreck）：`depth = round(d0 + step·L)`＝逐层严格非减·同层相等·起点 d0 最浅。
- 迷路（蓝洞群 + 借它的深 band）：树距 + jitter·起点钉死 d0（全局最浅＝图顶）·最深点钉 d1；**分支/回边允许朝浅**（truthful·不查逐节点单调）。
- 兜底＝`playthrough-mapgen-scenarios`「位置即深度」垂直性不变量（迷路 60 + 层状 30 seed：起点=图顶最浅·迷路深度随树距上升·最深点在下行·层状逐层严格非减+同层相等）。**改 depth 赋值会破 mapgen 逐字节快照·须重置基线**（#92 没改生成·属 additive；区别 #90 全 additive）。

**内容放置约定（以后内容 / mapgen session 都遵守＝作者要的「系统」）**
- 『更深』母题（the_rising / 假底 / 永远有比最深更深 / 诱饵下行）落**更深**节点；浅段 fresh-wrongness 落**更浅**节点（band `depthRange` 已天然成立）。
- 猎手 spawn / 房间 feature / 事件抽取按深度——深度只藏「下面」（横/上行不降 clarity·#62）。
- 守则同 §9：**绿 ≠ 画对**（quirk #91/#93）——碰布局/扇区/深度渲染补视觉验证（SSR→SVG 坐标核对或 dev server 肉眼）。
