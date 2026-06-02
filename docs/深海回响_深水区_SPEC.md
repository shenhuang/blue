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
   —— 主动感知是**双向的**：照亮/ping 让你看见世界，也把你暴露给世界。
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

### 3.2 微观双传感器（下潜内）

- **灯（近距）**：照亮**当前 + 直接相邻节点**——你看清下一步的 1–2 个选项（预览）。范围小、细节高（能读 tell：看清那盏「灯」不在任何东西上、那个潜水员不冒泡）。
- **声呐（远距，主动 ping）**：一次 ping 揭示**更远的图结构**（前方几跳的节点拓扑/大致危险），但**粗**——声呐只给「那里有个大东西 / 有个亮点」，**分辨不出真假信标**（这正是 mimic 的可乘之机：远看是个信标回波，得靠近用灯才读得出 tell）。
- **关闭（go dark / 静默）**：无预览、盲航（沿用 `visibility: dark`）——但你的**signature（信号特征）**降到最低，捕食者/mimic 更难发现你。**风险/回报的核心轴**：点亮以导航（暴露） vs 摸黑以隐匿（致盲）。

### 3.3 探测 / 被探测模型（被动 → 主动的代价）

- 每个深水捕食者（含 mimic）有**探测感官**。你的**主动感知抬高自身 signature**（灯＝视觉特征、声呐 ping＝声学尖峰）。
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

### Phase 2 — 跨 run 供给前哨 = 深度门 + clarity 网络下延
把 `lighthouse.ruin_north`（一次性）扩成**多阶段、跨 run 持久**前哨：新增持久化 **per-ruin 进度字段**（这一潜找到部件、下一潜运一个、半亮扛过死亡）。每前哨建成＝**解锁下一 band + 把宏观灯/声呐 clarity 向下延一格**。这是「很大的图」可达的引擎。SAVE_VERSION bump + 迁移（quirk #39）。

### Phase 3 — mimic capstone（最深层）
海图假 POI（无灯之光，§3.5）→ 横渡 → 入潜遭遇；tell↔sanity 双耦合（模糊 + 难度，§2.4）；corpse-wearer 姊妹 apex；接 `flag.d_reveal`。**唯一允许的第三只敌人例外**，住终端 zone/海沟。回收浅/中/深伏笔。**必须 Phase 0–2 就位后做。** 开建前再与作者确认遭遇演出细节。

---

## 6. 数据 / 类型改动草案（按阶段，待细化）

- **Phase 0**：run 新增 `sensors: { light: bool; sonar: 'off'|'ping'|'active'; }` + 派生 `signature: number`；`clarity(node)` 纯函数（engine/clarity.ts 新建，与 chart 宏观平行）；`DiveModifier.visibility` 退役/并入 clarity。`combat`/遭遇读 signature。
- **Phase 1**：band 表（`data/depth_bands.json`？）`{ id, depthRange, unlockedBy(ruinId/flag), tags }`；mapgen/zones 按 band 取数。
- **Phase 2**：`Lighthouse`/前哨加 `progress` 多阶段字段（跨 run）；`restoreLighthouse` → `advanceOutpost`（多步）；SAVE_VERSION 4→5。
- **Phase 3**：`ChartPoi` 加 `mimic?: true`（假 POI，不被任何灯塔解释却 lit）；mimic 敌人 def（apex）；tell 可读性读 sanity；d_reveal 触发 outcome。

---

## 7. 待作者复核的子决策（带提案）

1. **灯塔 ↔ 声呐网是否同一套？** 提案：**是**——灯塔/前哨即长程**信标+声呐网络**，建得越深、宏观 clarity 越往下延（统一 Phase C 灯塔与新声呐，供给链=网络下延）。
2. **声呐风格：主动 ping（瞬时、响、signature 尖峰）还是持续？** 提案：**潜水员自带声呐＝主动 ping**（题材经典、与探测双刃天生一对）；灯塔/前哨给**被动环境宏观 clarity**。
3. **被探测的后果：节点图里的追逐/aggro，还是只调遭遇概率？** 提案：每节点一个**「警觉」度**，主动感知抬、静默降；高警觉＝捕食者接近/伏击，低＝忽略你（可生存：摸黑能滑过，代价是瞎）。
4. **深度单位：保留米（0→∞）还是分级 tier？** 提案：**保留米**但 band 数据化、不封顶；供给门解锁更深米段。
5. **双传感器/探测是全局铺还是只深水？** 提案：**只在深黑处吃重**——浅水灯常亮/近乎免费、不引入探测压力；声呐 + 探测双刃在 clarity 稀缺的深 band 才成为主轴（避免回填污染浅水手感）。
6. **「deeper than the deepest」的进度感**：递归无界听着爽，但需要一个**每层小目标**（建一座灯）防止无限纵深变成无意义刷深。提案：每 band 一个「点亮它」的跨 run 前哨目标（Phase 2 本就如此）。

---

## 8. 可调参数（tunables，集中放各引擎文件顶部，沿用 SPEC §9 风格）

- 灯近距范围 / 声呐 ping 跳数与冷却 / 各传感器 signature 权重 / 静默 signature 下限。
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
- 2026-06-02：四点拍板（§2）——clarity 双传感器+探测双刃 / 递归纵深大地图 / mimic chart-lure→in-dive / tell↔sanity both。本 SPEC v0.1 据此成文。**下一步＝Phase 0（双传感器 clarity + 探测双刃）开建前，作者过一遍 §7 子决策。**
