# 深海回响 · 深水区 / 欺骗系统 SPEC

> **状态：v0.1 草案（2026-06-02，作者口述定调 + 四点拍板）。** 这是「最终预期」北极星（自动记忆 [[deep-game-vision]]）落成可建系统的第一版设计文档。方向已锁、若干子机制留作者复核（见 §7）。建法承袭基建+地图 revamp 的「SPEC → 分阶段实装 → 每阶段全绿自审」节奏（见 `docs/深海回响_基建地图_SPEC.md`）。
>
> **伏笔层已就位**：浅/中/深三级『越深越欺骗』事件已全部埋好（STATUS quirk #53–#57）——mimic 假信标 `bluecaves.the_glow`(中)→`cave.false_beacon`(深)，corpse-wearer `wreck_graveyard.{the_other,no_bubbles,the_wearer}`(浅/中/深)，lore.deep_water.{cold_light,the_window,the_false_beacon}。capstone（§5 Phase 3）登场时回收这些母题与 tell。

---

## 1. 北极星回顾（不变的基调）

- **越深越「欺骗」的信任梯度**：浅＝所见为真 / 中＝看不见（opacity）/ 深＝看错（deception）。
- **「是世界坏了，还是你疯了？——通常两者皆是」**：`sanity`（你轴）+ 环境/生物真实欺骗（世界轴）让玩家**无法干净归因**，游戏**拒绝裁决**（无廉价收口，d_reveal 也保持暧昧）。
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
- **衰减后果（提案，待细化）**：荒废 → 设施掉线 / 前哨「变暗」（clarity 半径缩、补给减），**re-ferry 材料可复原、不永久丢**（合「可生存有代价」）；不主动维护就慢慢退。

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

### Phase 1 — 可扩展纵向深度轴（banded、近乎无界）
深度 band 数据化（`zones.json` / 新 band 表），去掉 60m 准硬上限；支持逐级解锁的更深 band。沿用 `depthOffset` + `zoneTagsByDepth`。**先只把"能配置更深 band"打通**，内容/zone 后续填。
**蛙跳下潜结构（作者 2026-06-02 定）**：不一口气长潜穿多层——一次下潜＝从**最深前哨**出发、只覆盖**一个 band**（D→D+段），浮回前哨补给；死在深处＝尸体留该 band、可回收。复用 `depthOffset`（从更深起潜）+ Phase C reach/reveal（按最近灯塔算 distance、点亮范围内才可见）+ 尸体回收。新出潜口 `startDiveFromOutpost`（镜像 `startDiveFromPoi`）。

### Phase 2 — 跨 run 供给前哨 + 能源经济（深度门 + clarity 网络下延 + base 层）
把 `lighthouse.ruin_north`（一次性）扩成**多阶段、跨 run 持久**前哨：持久化 **per-ruin 进度字段**（这一潜找到部件、下一潜运一个、半亮扛过死亡）。每前哨建成＝**解锁下一 band + 宏观 clarity 向下延一格 + 一个 base（蛙跳出潜点）**。**完整经济见 §3.6**：水上前哨不衰减 / 水下前哨衰减（水流区更快、但可水力发电）/ 能源跑设施、决定同时在线数 / 补给设施越深越要自建。复用 `Lighthouse` + `lighthouse_upgrades` 设施轨 + 材料经济 + 尸体 `aging` 衰减 + 海图 reach/reveal。SAVE_VERSION bump + 迁移（quirk #39）。

### Phase 3 — mimic capstone（最深层）
海图假 POI（无灯之光，§3.5）→ 横渡 → 入潜遭遇；tell↔sanity 双耦合（模糊 + 难度，§2.4）；corpse-wearer 姊妹 apex；接 `flag.d_reveal`。**唯一允许的第三只敌人例外**，住终端 zone/海沟。回收浅/中/深伏笔。**必须 Phase 0–2 就位后做。** 开建前再与作者确认遭遇演出细节。

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
7. **衰减后果细节**：水下前哨荒废到底「变暗（设施掉线、可 re-ferry 复原）」还是会更狠？提案见 §3.6（变暗、不永久丢）。
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
