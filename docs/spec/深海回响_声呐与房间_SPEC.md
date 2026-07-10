# 深海回响 · 声呐探索 + 多事件房间 SPEC

> **状态：✅ 已彻底完成 / 关闭（2026-06-06·#90·见 §7 末「closeout」）。** 声呐从「逐选项预览」升成**探索性的洞穴声呐扫描**（一记 ping 读真实节点图、画出近似洞穴形状），节点从「一格一事」升成**房间可含多个事件点**——两半均已落地。**后续布局朝向/扇区基准已被 #92 取代**（见 §5 指针 + 深水区 SPEC §13「地图垂直性＝深度」），本档余下内容作只读参考。
>
> **⚠ 不可信扫描（S2）已被感知重做取代（tombstone·2026-07-04·#259）**：§1 把声呐当「核心欺骗面」（`evadesSonar`/`spoofsSonar`/低 san 幻觉声呐）、S2 段「不可信扫描」——**已撤除**，声呐现在**永远诚实**（欺骗全部移交低 san 轴·见 `深海回响_感知重做_SPEC.md` §2.2/§2.3）。**S0/S1 房间与洞穴扫描渲染（探图/SDF/深度/到上浮口距离）保留**·只是声呐图不再撒谎。
> **⚠ « 2026-07-10 理智系统移除 »**：连"低 san 轴"本身也已随 `run.stats.sanity` 删除——本档一切「低 san 幻觉声呐 / 伪接触 / 乱码读数 / `run.stats.sanity` 抗欺骗档」全部作废（历史留档）；声呐诚实性不受影响（本就已改诚实）。« TODO(作者)：感知重做的"低 san 幻觉轴"失去理智载体后如何重挂，见感知重做 SPEC »

---

## 1. 北极星 / 为什么

- ~~**声呐＝核心欺骗面（深水区 SPEC §3.2）**~~ « tombstone·#259/#284（见顶 banner）»：原「声呐返回不可信 · 生物躲 `evadesSonar` · 假回波 `spoofsSonar` · 低 san 幻觉声呐」整条作废——声呐现**永远诚实**（现状＝灯/声呐/电三件诚实感知）。「是世界坏了还是你疯了」的欺骗载体母题失去理智轴，如何重挂见 `深海回响_感知重做_SPEC.md`；原「洞里方位感」诉求（诚实侧）仍由 §5 扫描渲染兑现。
- **回收三个旧诉求**：①「玩家该知道自己在洞里的大致位置」（扫描 + 深度 + 到上浮口的距离＝靠 ping 挣来的方位感）；②「越深越欺骗」（深处扫描更不可信）；③ mimic capstone（#69）的海图假信标在**下潜层**也有了对应物——声呐图上一条不存在的通道 / 一处假房间。
- **节点≠流程图**：真实洞穴是**大小不一的房间 + 粗细不一的隧道**，大房间里可能有不止一处可探的东西。多事件房间让下潜从「点一格事件」变成「进一个洞室、看见里头几处读数、挑着去」，更像探洞、更少像走流程图。

---

## 2. 已验证（交互原型，2026-06-05）

原型（两版 widget）已证实工程可行，不是空想：
- **节点图 → 有机洞穴**：节点＝洞室、边＝隧道，喂进一个**距离场（SDF）**＋**多层值噪声**扰动边界 → 拓扑精确照搬 mapgen，但轮廓读起来是凹凸不平的真岩壁。大房间＝几个不同半径的 blob 叠出的不规则洞室；隧道＝粗细不同的 capsule；窄缝＝极细 capsule。**房间大小/形状的多样性在渲染侧零成本**。
- **接触式点亮**：bright 返回是**贴着波前的一条窄带**——墙只在扩散环**扫到它**的那一刻发亮，身后留一道**渐隐余像**（作者要保留余像）。
- **多事件房间（视觉）**：大画廊里两颗 teal 菱形＝同一房间、不同位置的两处事件。
- **威胁接触**：扫到敌人 → amber 接触 blip + 近似距离（诚实侧·今由 §7 S3 / 猎手兑现）。~~低 san 撒谎（假通道 / 假读数 / 闪烁假接触 / 真敌人「无回波」）~~ « #259/#284 作废·见顶 banner »。

**所以本 SPEC 不是论证可行性，而是「怎么把它接进真实游戏」的实装计划。**

---

## 3. 两半合一（一个功能、两顶帽子）

### 3.1 声呐扫描（sonar scan）
一记 ping 读**真实的 `DiveMap` 图**（当前节点附近若干跳），渲染出**近似**的洞穴形状草图（接触式描线 + 渐隐余像）。**有代价、不可信**：耗电（`run.power`）+ 抬警觉（`run.alert`，ping 暴露你、招捕食者）+ 越深越失真。摸黑＝省电省暴露但你瞎着、对洞一无所知。

### 3.2 多事件房间（轻量版）
一个节点可以是一座**房间**，房间内含 **1..N 个 feature（事件点）**，摆在不同子位置。小房间 1 个（＝今天的行为）；大房间几个。进房间 → 把这些 feature 作为**房间内选项**摆出来（连同通往别房间的**出口**）→ 玩家挑一个去靠近＝触发那个事件；可再去靠近别的（氧气代价）；从某个出口离开。**没有自由 2D 移动**——仍是选项制，只是「一个房间能装下几拍」。

---

## 4. 与现有代码的接点（别另起炉灶）

- **`types/dive.ts::DiveNode`**：现有 `layer/depth/zoneTag/kind/connectsTo/eventId(单个)/preview/evadesSonar?/spoofsSonar?`。**节点没存 2D 坐标** → 扫描渲染需要一套**布局推导**（按 layer/depth + 图结构铺点，`ui/dev/MapDevPanel` 已经在做类似的事，可抽公共布局函数）。多事件＝给 DiveNode 加 `features?`（§6）。
- ~~**`engine/clarity.ts::sonarReturn` + `evadesSonar`/`spoofsSonar` 声呐不可信落点**~~ « tombstone·#259/#284（见顶 banner）»：声呐欺骗接点（`sonarReturn` 注入 / `spoofsSonar` 假象 / `evadesSonar` 无回波 / 低 san 假回波）整条作废——声呐现永远诚实（本节另有 « #284 » 注记 `run.stats.sanity` 抗欺骗档删除）。
- **`run.power` / `sonarPingCost`（升级派生）**：每记 ping 的电耗。**`run.alert` / `alertDelta`**：ping 抬警觉（暴露双刃，深水区 Phase 0b）。
- « #284 理智系统移除 »：原 `run.stats.sanity` 抗欺骗档接点已删（`run.sensorTuning` 仍在·只是不再有 san 输入）。
- **`engine/mapgen.ts`**：生成房间大小 + 给大房间布多 feature；布局坐标可在此一并产出（省掉运行时推导）。
- **`ui/NodeSelectView.tsx`**：声呐图面板（ping 后显示）+ 房间内 feature 选项 + 出口。碰 UI 必补 `smoke-chart-ui`（#38）。
- **`mapShape`（maze/layered）+ `canFreeAscend`**：扫描在两种拓扑都成立；maze（洞穴）最受益（迷路 + 找上浮口）。

---

## 5. 声呐扫描设计（一记 ping 怎么读洞）

- **读什么（限程 · 可升级 · 默认看不全）**：以 ping 原点为中心、**有限物理半径**内揭示节点 + 边（**绝不是无限程**——原型那种「一记扫穿全洞」是要去掉的）。**起步范围很小（比原型 demo 的 default 还小得多——demo 的值只是为了在屏上读得清，作者 2026-06-05）**：早期一记 ping 只照亮你**身边一小圈**、几乎看不出眼前几步之外；**范围是声呐最主要的升级轴之一**，随升级**逐级扩展**（接 #62 reach 那套），但**双上限：< 最深 + < 全洞**（永远扫不穿最深、也照不全整洞）。早期又黑又窄又慌＝软门控（声呐本身也是后期才解锁 #58）。**揭示多少事件点＝随洞的事件稀疏度走**（作者已定）：范围固定，稀疏的洞同一记 ping 扫出的读数更少（更空、更慌）。
- **缩放视角 + 残图小地图**：下潜图**默认放大**只显示玩家附近一小片（几乎看不到全貌）；角落一张「已扫到的部分」小地图给**方位感**（你在更大洞里的大概位置 + 已 mapped 的那一小块）——回收「知道自己在洞里大致位置」诉求，但细节始终局部、靠 ping 一点点拼。
- **怎么画**：接触式描线（波前扫到才亮）+ **渐隐余像**（作者要保留：扫过的形状留一道会淡的草图，不是永久地图）。**实现：用「覆盖遮罩」**——扫到的地方记成「已揭示」、按**固定亮度**画墙，**重复 ping 同一处不会越来越亮**（原型早期「每过一次更亮」是错的、已改）；遮罩随时间淡＝记忆过时（接下一条）。
- **地图是记忆、会过时（作者 2026-06-05）**：余像是你**上一记 ping** 的记忆、不是实时真相——**会改变房间的事件**（塌方/开口/水位）只在**下一记 ping** 才反映；**敌人位置只在被扫到的瞬间更新**（两记 ping 之间它在动、你看到的是旧 blip）。所以你常按着**过时的图**行动，要刷新就得再 ping（再耗电、再暴露）——staleness 本身就是张力（原型已演示冻结的接触 blip）。
- **代价（双刃，深水区 §3.2-3.3）**：每 ping 耗 `sonarPingCost` 电 + 抬 `alert`（点亮水里＝招捕食者）。所以「要不要 ping」是真两难：ping 才看得见洞与威胁，但费电、暴露、还可能骗你。摸黑＝瞎着摸，但最省最隐。
- ~~**不可信（核心）**~~ « tombstone·#259/#284（见顶 banner）»：原「高/低 san 可信度 · 假通道/假房间/假读数 `sonarReturn` · `spoofsSonar` 伪装 · `evadesSonar` 无回波 · 深 band 更狠」整条作废——声呐图现永远诚实。§5 其余为诚实扫描渲染（限程/缩放/余像/洞形/回合/定向），保留。
- **形状要像真·水下洞（渲染层，2026-06-05 据真实洞穴形态校准）**：别画成「圆房间 + 直棍」。被淹的（phreatic）洞穴是**圆/椭圆截面的管道**（截面对了——用 capsule SDF），但平面形态是**蜿蜒、忽宽忽窄、回环互通（anastomotic）/ 沿裂隙的折线网（network maze）**，房间＝裂隙交汇处的**不规则扩大**（fracture-controlled rooms），不是圆。实现＝把每条 `connectsTo` 边渲染成**带中途偏移的弯折折线 + 沿途变宽变窄的 capsule SDF**，房间＝交汇处几个不同半径 blob 的簇；外加值噪声扰墙 + 半分辨率 SDF 提速。**纯渲染/生成层、节点图模型不变**（节点＝交汇/房、边＝passage，只是画得像真洞）。参考：Palmer 洞穴形态分类（branchwork / network / anastomotic / spongework）、Sistema Sac Actun（最长水下洞·linear phreatic conduits·anastomotic·fracture-controlled rooms·椭圆 passage）。
- **起手全黑、靠扫描点亮（作者 2026-06-05）**：进洞**默认全黑**——只看得见自己 + 一圈很淡的量程环；地图**只随声呐 ping（远）/ 点灯凑近（近）一块块点亮**，扫过的还会渐隐（上面「余像」）。＝把现有 `visibility:dark` + clarity `none`（盲航）做成「黑里靠主动感知一块块拼图」，不是开局就给地图。
- **回合制 · 每回合 1 次扫描（作者 2026-06-05）**：游戏**回合制、非实时**——扩散环只是表现动画，一记 ping ＝**一个回合动作**（耗电 + 抬警觉 + 占掉该回合的扫描）。**1 scan / turn** 足够；要刷新地图 / 敌人位置就得下一个回合再 ping（接 §5「地图是会过时的记忆」）。
- ~~**低 san 可视化（伪接触 + 乱码读数）**~~ « tombstone·#259/#284（见顶 banner）»：低 san 幻觉声呐（与真无异的伪接触 / 仪表字乱码 / 配合 `evadesSonar` 会藏的敌人）随理智系统删除整条作废——现无低 san 轴、声呐诚实。
- **扫描从「你所在的位置」发出（不是任点遥扫，作者 2026-06-05 厘清）**：声呐是从**当前节点**全向 ping、有限程；你**扫不到没去过的地方**——要扫别处就**移动过去再 ping**（回合制，每步换个位置扫，地图一段段拼）。原型里「点任意处开扫」只是 sandbox 方便看；游戏里 ping 原点＝你。**定向 ping（作者 2026-06-05 采纳）**：把声呐**朝一个方向聚焦**——那方向探更远（别处更短）＝「选扫哪边」的可控感；并有**战术隐蔽用途**：**别朝有敌人的方向 ping**＝不照亮它、少招它注意（暴露/警觉**按方向计**，不再全向一律）。仍从你当前位置发出。可做成升级（解锁定向 + 各方向 reach）。 **✅ 已实装（#86，2026-06-06·作者拍板「方向扇区」）**：三向扇区（朝深处/侧向/来路·按 `node.layer` 差分·与布局 x∝layer 一致）·`sonar.ts::revealSonarScanDirectional`（聚焦探更远·别处更短·近场仍全向·波束只沿聚焦扇区扩＝连贯·封顶 `SONAR_DIR_RANGE_MAX`）·暴露按方向计（`clarity.ts::sonarPingAlertDelta(run,dir)`·窄波束更安静×0.55·正对**声/双感**猎手扇区尖峰×1.7＝照亮它·`pingAimsAtSoundStalker` 真实位置算暴露·`seenStalkerSector` 会过时位置给 UI 警示）·`pingSonar(state,dir?)`·UI 三向按钮（朝猎手向 `aims-threat ⚠`）+ omni 标「全向」+ 聚焦标注。**定向本身免费**（解锁声呐即有·一层纯战术 breadth↔depth+隐蔽取舍·非 power-up）。omni（dir 缺省）逐字节不变。`playthrough-sonar` §13 + smoke E4b。**✅ 「各方向 reach 各自升级」已实装（#90·2026-06-06）**：新 `sonarDirReachBonus`（带 `dir` 判别）沿同款传感器升级桥落 `SensorTuning.sonarDirReach: Record<SonarDir,number>`（逐向夹 `[0, SONAR_DIR_REACH_MAX]`），`revealSonarScanDirectional` 新增第 5 参 `dirReach`＝聚焦那一向的专精焦距（`min(SONAR_DIR_RANGE_MAX+reach, base+FOCUS+reach)`·别向/近场不延长＝守北极星）；data `sonar_rig` lv6/7/8 三向各 +1（定向免费仍成立·reach 才是 power-up）。缺省全 0 → 定向行为逐字节不变。`playthrough-sonar` §13(i/j) + `-upgrades` §11 + `-save` round-trip + smoke J9。
- **✅（原 later·#90 已实装）接触有大小 + 开放水域也能扫**：① **接触带大小**——大型生物（比玩家还大，如 abyssal `the_rising` / apex）读成**一大团**而非小点：`Stalker.large?`（spawn 时 `depth ≥ STALKER_LARGE_DEPTH`108m 派生·缺省小 blip）→ `stalkerSonarBlip` 透传 → `SonarScanPanel` 画弥散质量 `sonar-stalker-mass` + 更大中心（CSS 特异性陷阱见 quirk #91）。② **开放水域也能扫**——声呐**不限洞穴**：层状 zone（开阔海域·`!zoneAllowsBacktrack`）声呐图**不画洞壁通道边**（`sonar-edge`）、只显接触与读数（标 `is-open-water`）；迷路 zone（洞穴）仍画通道。纯渲染（引擎早已不门控 zone）。smoke E4c/E8 + `playthrough-stalker` §2b。
- **🔄 布局朝向 + 扇区基准已被 #92 取代（2026-06-06·见深水区 SPEC §13「地图垂直性＝深度」·本 SPEC 已关闭·此处仅留指针）**：上文「按 `node.layer` 差分·与布局 x∝layer 一致」「lateral 上下两瓣」均已过时——声呐图纵轴改 `y∝node.depth`（上浅下深·真实米数），`engine/sonar.ts::nodeSector` 改按 **`node.depth`** 差分（deeper↓ / back↑ / lateral←→·容差 `SECTOR_DEPTH_EPS`），`SonarScanPanel` viewBox 转 portrait、`focusWedgePath` 与量程/接触半径随之重映。详见深水区 SPEC §13 + QUIRKS #93。

---

## 6. 多事件房间设计（轻量版，无自由移动）

- **数据**：`DiveNode` 加 `features?: NodeFeature[]`（缺省＝把现有单 `eventId` 视作 1 个 feature，**向后兼容、旧行为不变**）。`NodeFeature = { id; kind: 'event'|'corpse'|'rest'|...; eventId?; corpseRecordId?; preview; subPos?: {x,y} }`（subPos 仅供声呐渲染摆位）。房间「大小」＝ feature 数（小 1 / 中 2 / 大 3，上限待定 §8）。
- **mapgen**：按房间大小给节点派 1..N 个 feature，从对应 zone/band 事件池抽（守 #19 单 tag、#44/#47 loot 隔离、loot-free 深段）；大房间更稀有、可放在「画廊 / 大厅」型节点。
- **dive 引擎**：进房间 → `enterNodeSelection` 把**房间内 feature**（未触发的）+ **出口（connectsTo）**一起摆成选项。选 feature → 触发其事件（复用 resolveOption）；触发后该 feature 标记 done、仍可选别的（**每多探一处加氧气/回合代价**＝「贪多要付氧」的张力）；选出口 → moveToNode 去别房间。**单 feature 房间＝今天的流程，零感知差异。**
- **UI**：`NodeSelectView` 分区——「这间洞室里的读数」（features）vs「通往别处」（exits）。声呐图上房间画成大轮廓、里头几颗 feature blip（原型已演示）。

---

## 6.5 宏观对应（海图层）：灯塔 = 海图声呐（2026-06-05 playtest 后追加）

深水区 SPEC §3.1 已把 clarity 分两层（宏观海图 / 微观下潜）。本 SPEC 的 §5 声呐是**微观层**；**灯塔就是宏观层的同一个「扫描揭示」母题**——一座灯塔＝海图尺度的声呐：点亮即朝海面打一记大扫描、把新探到的兴趣点（POI）揭出来；**限程**（reveal radius）、**不全揭**（受天气/潮汐/事件/还没扫到影响）、**随时间变**。一冷一暖：水下是冷色声呐摸黑、海面是暖色 beacon 扫描。

**现有地基（`engine/chart.ts`，别另起炉灶）**：`generateChart` 已派生 POI——anchors（持久）+ roaming（按 `runsCompleted` 刷新＝**潮汐换一批**）；两级门控 `requiresFlags`（**事件解锁**）+ reveal `isPoiLit`（落**灯塔半径**内才可见，基建地图 Phase C #52）。所以「潮汐变 / 事件解锁 / 灯塔范围」三因素**已部分在**；mimic 假 POI（#69）也已在此注入。

**两个 playtest 愿望（作者 2026-06-05）：**
1. **灯塔点亮 → 大测绘扫描揭示动画（回报演出）**：`SeaChartView` 播一记从灯塔慢慢铺开的测绘扫描，**新进入该灯塔范围的 POI 随波到达逐个浮现**（reveal flourish + 名字淡入）。playtest 里资源难攒、点亮那一刻要有**满足感**——这是「终于点亮一座灯」的演出。触发点＝`buildAtLighthouse` / `restoreLighthouse` / `advanceOutpost` 点亮时。**纯 UI 演出**：engine 的 reveal 集合不变，只是把「突然多出来的可见 POI」演成被扫描揭示。**作者 2026-06-05 厘清两点**：① **旋转探照灯 ≠ 扫描**——探照灯就是灯塔本身（**短程、匀速旋转、别加速、别当 sonar**）；测绘扫描是另一回事；② **扫描要很慢**——它在覆盖一大片海面，POI 慢慢逐个浮现，**别做成微观声呐那种快速 ping 环**（暖、缓、不可信留给水下）。原型 v2 已按此修。
2. **POI 不总是全揭、随回合变**：在已有的潮汐刷新 / 事件 flag / 灯塔半径之外，加 **天气/潮汐遮蔽**（在范围内却被一时的潮/雾盖住、暂不可见，过些回合又现）+ **「尚未扫到」**（范围内但这一拍还没轮到）+ 强调**随回合/run 变**。＝海图是**活的、会变的**，不是一次点亮就定死。实现：天气/潮汐做成**派生态**（按 `runsCompleted`/turn 种子，同 roaming 套路、不入存档），reveal 集合照旧由 灯塔半径 + flag + 新的天气/潮汐 mask 共同决定。

**与微观声呐的分工**：共享「扫描揭示 / 限程 / 不全」母题；但**宏观偏「天气/潮汐的不全」、相对可信**，**欺骗（不可信、低 san 撒谎）留给微观 + mimic 假 POI**——海面相对老实，水下才骗你。

> ✅ **两愿望已实装（2026-06-06，STATUS quirk #80）**：① **测绘扫描揭示动画**——`SeaChartView` 灯塔 `.chart-survey-sweep`（慢暖 sweep·3.2s·**key 绑 `builtUpgrades.size`** → 建造/点亮时重挂＝重播＝点亮回报演出·≠ 旋转探照灯·engine reveal 集合不变）+ POI `.chart-poi-arrive` 错峰淡入（按序号 delay＝随波逐个浮现/「尚未扫到」·新 run 的新机会点重挂重播·锚点不重播）。② **POI 不总全揭、随回合变**——新 `chart.ts::chartConditions(profile)`→`SeaChart.conditions{tide,weather}`（确定性 FNV on runsCompleted·**不入存档**·SeaChartView 表头显示「活的海图」）；**浓雾遮蔽一处 roaming 机会点**（确定性挑·随 runsCompleted 变=下次回港又现·**锚点/mimic 永不遮**＝守进度安全 + 海面相对可信）。**✅ 即时新 POI 浮现已实装（2026-06-06·#83）**：`SeaChartView` chart memo 依赖加**灯塔覆盖签名**（坐标 + 设施 + `effectiveRevealRadius` + flags）→ 建灯/点亮前哨当场重算、新进范围 POI 立刻浮现（reveal 动画已就位·复用）；`chart.ts` roaming 选取改 **pool-independent 确定性键**（Efraimidis–Spirakis·模板键 id）＝重算不重洗已显示机会点（守「同 runsCompleted 的 roaming pick 必须稳定」）。〔交付：`chartConditions`+`ChartConditions`+`SeaChart.conditions`·`playthrough-chart` §7·smoke L。〕

---

## 7. 分阶段（每阶段独立全绿、可逐拍）

- **S0 · 扫描读真图（只读、不改模型）** ✅ **已实装（2026-06-05，提交 `f57b17e`，STATUS quirk #71）**：抽公共**布局推导** + `NodeSelectView` 加声呐图面板：ping 揭示附近节点为草图（接触描线 + 余像），耗电 + 抬 alert。**不动 DiveNode 模型**（仍单事件）。先把「ping 读真图 + 渲染 + 代价」在游戏里跑通。补 smoke。〔交付：`ui/mapLayout.ts` + `engine/sonar.ts` + `run.scanMemory` + `pingSonar` 抬 alert/1-scan guard + `ui/SonarScanPanel` + `playthrough-sonar`(9 节)+smoke E4，见 §11 决策日志〕
- **S1 · 多事件房间** ✅ **已实装（2026-06-05，STATUS quirk #74）**：`DiveNode.features?: NodeFeature[]` + mapgen `maybeMultiFeatureRoom`（`maxRoomFeatures>1` 才派·`DepthBand.maxRoomFeatures` 门控·大房间稀有·同房去重）+ `enterNodeSelection` 把房内未探 feature ＋ 出口并列摆出（`FeatureChoice`/`subPhase.features`）+ `exploreFeature`（连探付氧·标记 `run.activeFlags`）+ `SonarScanPanel` 房间大轮廓(is-room)＋feature blip。**向后兼容（单 feature＝走旧 `eventId` 路径＝旧图逐字节不变）·不 bump SAVE_VERSION**。`playthrough-sonar` §10 / `-mapgen-scenarios` 不变量 / smoke E5 全绿。见 §11 决策日志。
- **S2 · 不可信扫描（欺骗）** — ~~✅ 已实装 (#78)~~ « tombstone·2026-07-04 #259 → 2026-07-10 #284（见顶 banner）»：`nodeSonarView`（spoof/evade/garbled）+ `sonarPhantoms`（低 san 伪接触）+ `effectiveFalseEchoSanity`（深 band `sonarDeception` 失真）+ mapgen `applySonarDeception` 整套——先被感知重做取代（#259 声呐改诚实）、再随 `run.stats.sanity` 删除（#284）作废。S0/S1/S3 诚实侧保留；原实装史留 §11 决策日志（历史留档）。
- **S3 · 威胁定位** ✅ **廉价版已实装（2026-06-06，STATUS quirk #80）**：`clarity.ts::threatContact(run)`（单一来源·面板纯渲染）把抽象的 `run.alert` 做成声呐图上一处**近似接触**——alert<预警线→null，越线→`{angle 按 turn 漂移·定不住,proximity 随 alert 涨,range 远/中/近,imminent ≥接近线,garbled 低 san 读不出}`，**不锚到节点**（确定性·不耗 RNG）。`SonarScanPanel` 画琥珀 `.sonar-threat` blip（`.is-near` 偏红脉动）。**与低 san 伪接触分两轴**：威胁＝alert 驱动（真危险·琥珀）/ 伪接触＝san 驱动（你脑子·cyan）。〔交付：`threatContact`+`ThreatContact`+`THREAT_CONTACT_ALERT`·`playthrough-sonar` §12·smoke E7。〕**定位 stalker（捕食者在图上占位·逐回合逼近·可 `evadesSonar` 躲扫描·位置只在被扫到时更新）是更大改动、§8.7 留作者拍板（本次只做廉价 blip）。**

> 每阶段守深水区 §9 回归文化（typecheck + 全 playthrough + scenarios + verify-tutorial + smoke + prod build）。S0 可独立交付价值、风险最低，建议起手。
> **进度（2026-06-06）：S0（#71）+ S1（#74）+ S2（#78）+ S3 廉价版（#80）已落地；§6.5 宏观（揭示动画 + 海况遮蔽）已落地（#80）；声呐范围升级轴（§8.1 主升级轴）已接（#80）。§6.5 即时新 POI 浮现已落地（#83）；S3 定位 stalker（§8.7）已升级为「猎手」子系统、Phase 1 spine 已落地（#84·见 `docs/深海回响_猎手_SPEC.md`）。定向 ping（§5·#86·暴露按方向计）+ 房间 feature 数升级（§6/§8.3 续·#87·收尾 #74 尾巴）已落地。**
> ## ✅ 本 SPEC 已彻底完成 / 关闭（#90·2026-06-06·方向「释放·closeout」）
> 最后三项 residual 全部清零：① **聚焦扇区可视化**（`SonarScanPanel` 画聚焦扇区楔形 `sonar-focus-wedge`·deeper 右/back 左/lateral 上下两瓣·略超量程环＝那一向探更远·smoke E4b）② **各方向 reach 各自升级**（§5·`sonarDirReachBonus` 沿传感器桥·`sonar_rig` lv6/7/8 三向各 +1·见 §5）③ **§5 later 接触带大小 + 开放水域扫描**（见 §5）。**声呐与房间 SPEC 核心 + 收尾 + residual 全部落地，无未决项——本 SPEC 关闭，作为只读参考。** 唯一相关后续在**别处**：猎手 Phase 2+（decoy / 大型生物狭小避难 / 执着等待 / 感知例外 / 浅水弱变体）住 `docs/深海回响_猎手_SPEC.md` §7，与本 SPEC 无关。

---

## 8. 子决策（作者 2026-06-05 全部拍板）

1. **扫描范围＝限程 · 可升级 · 看洞稀疏度**：默认范围小（**绝非无限程**），随声呐升级逐级扩展、双上限（< 最深、< 全洞）。一记 ping 揭示的事件点数随该洞**事件稀疏度**走——稀疏洞读数更少（更空、更慌）。见 §5。
2. **余像保留、但地图是会过时的记忆**：扫过的草图缓慢淡出、新 ping 刷新；**会改房间的事件只在下一记 ping 反映、敌人位置只在被扫到的瞬间更新**（两 ping 间你按旧图行动＝张力）。见 §5。
3. **房间最大 feature 数 = 3**（小1 / 中2 / 大3，大房间稀有）。
4. **一房可连探多 feature、每多探付氧气**（「贪多要付氧」——这正是大房间的意义）；选了出口就走。
5. **可信度曲线沿 §3.2 + #64 band 倍率**（深 band 更失真、地板永不完全可信）。
6. **声呐图随声呐解锁才有、且可升级扩展**：声呐未解锁＝没有这张图（早期黑水靠摸，软门控 #58）；解锁后默认**限程 + 缩放**、范围与覆盖靠升级**扩展**（"expandable once unlocked"）。
7. **威胁＝先廉价接触 blip、后做定位 stalker**：stalker＝捕食者在图上占位、逐回合逼近、**位置只在被扫到时更新**、可 `evadesSonar` 躲扫描；「合适时再做」（作者）。
8. **不动存档**：游戏未发布——`features` / 扫描态 / 敌人位置全走 run 级、不入 profile、不 bump SAVE_VERSION。

---

## 9. 可调参数（tunables）

声呐：ping 范围（跳/半径）、范围升级档、余像淡出速率、接触带宽、每 ping 耗电（沿 `sonarPingCost`）、每 ping alert 增量、可信度的 san 阈值与 band 加权。房间：各尺寸的出现率、最大 feature 数、连探的每处氧气代价。威胁：alert→接触距离映射、stalker（若做）的逼近速率。

---

## 10. 守则承袭（建时一直守）

- **回归文化（#22/#26）**：每阶段全绿 + prod build；碰 UI 数据路径补 `smoke-chart-ui`（#38/#41）。
- **软门控（作者 2026-06-03）**：声呐能力仍是后期解锁（深料升级）、深 band 没声呐天然受限；扫描不加硬 flag 锁。
- **叙述永不交底（#54）/ 不擅自触发 d_reveal（#42）**：假通道/假读数既给平淡解释又留错读、不裁决；d_reveal 只由 mimic 兑现触发。
- **敌人别太多**：威胁定位复用现有敌 + apex 例外；别借机加常规敌。
- **存档**：未发布不迁移——`features`/扫描态走 run 级、不入 profile、不 bump SAVE_VERSION（同既有策略）。
- **沙箱 git（[[sandbox-git-commit]]）**：`git add src scenarios docs scripts`、`mv` 锁进 `.sandbox-junk`、read-only 核对。

---

## 11. 决策日志

- 2026-06-05：作者发起（声呐扫描洞形 + 房间多事件 + 威胁距离）。两版交互原型验证「节点图→有机洞穴 / 接触描线 / 房间多 feature / 低 san 撒谎」工程可行。作者拍板：**接触式点亮**（墙只在波前扫到时亮）、**保留渐隐余像**、**不做房间内自由 2D 移动**（轻量版＝房间把多事件摆成选项）。据此成文 v0.1，列 §8 待复核。
- 2026-06-05（续，原型第三版 + §8 全拍板）：作者指出原型「范围近乎无限」要改 → 定 **限程 + 可升级 + 默认缩放视角**（玩家几乎看不到全洞）+ 揭示量随**事件稀疏度**。**§8 八项全定**（见 §8）：余像保留但**地图是会过时的记忆**（会改房间的事件 / 敌人位置只在下一记 ping 才更新）、房间最多 3 feature、一房可连探付氧、可信度沿 §3.2+#64、声呐图随声呐解锁才有且可升级扩展、威胁先 blip 后 stalker、不动存档。原型第三版演示限程 + 缩放 + 残图小地图 + 冻结接触 blip。**§8 由「待复核」转「已定」，可进 S0 实装。**
- 2026-06-05（续二，原型第四/五版）：① 据真实水下洞形态校准渲染（anastomotic 蜿蜒回环 + 变宽变窄 passage + 裂隙交汇不规则房，见 §5；纯渲染、模型不变）。② 作者四点并入 §5：**起手全黑、只随扫描点亮**（之前自动扫描挡住了这点）/ **回合制·每回合 1 scan**（动画仅表现）/ **低 san ＝墙体闪烁变形 + 大型 instance 忽隐忽现**（优于抖动）/ later：**接触带大小**（大生物＝一大团）+ **开放水域也能扫**（无墙只显接触）。原型第五版演示全黑起手 + 手动 ping + 回合计数 + 低 san 墙闪/blink + 大团忽隐忽现。
- 2026-06-05（续三，原型第六版）：作者厘清「flicker」＝**洞形瞬间变成另一个形状 / 短暂浮现吓人的东西**（离散突发、非 strobe）——原型改成 morph（已扫洞壁错位成另一副形状、撑一瞬再弹回）+ apparition（黑里浮起人形约半秒即灭）。并厘清 **扫描从你当前位置发出**（任点遥扫只是 demo 方便；游戏里 ping 原点＝你，扫别处靠移动过去再 ping；可选 later 定向 ping）。并入 §5。
- 2026-06-05（续五，playtest 反馈 + 宏观对应）：作者 playtest——资源难攒、暂没能升/解锁灯塔（**作者判 OK：本就不该易、内容也还少，不改难度**）。两愿望并入新 §6.5（宏观＝海图层）：① **灯塔点亮播大扫描揭示动画**（暖色 beacon sweep、新 POI 随波逐个浮现＝点亮的回报演出，触发于 buildAtLighthouse/restoreLighthouse/advanceOutpost，纯 UI、engine reveal 集合不变）；② **POI 不总全揭、随回合变**（天气/潮汐遮蔽 + 尚未扫到 + 随 run/turn 变；沿用 chart.ts 派生、不入存档）。**灯塔＝海图尺度的声呐**——与 §5 微观声呐同母题，但宏观偏「天气潮汐的不全·相对可信」，欺骗留微观 + mimic。原型（chart-scan）已演示 sweep 揭示 + 出范围/潮汐/事件三态 + advance tide 变化。
- 2026-06-05（续四，原型第七版）：作者三点——① **定向 ping 采纳** + 新增**战术隐蔽用途**（别朝敌人方向 ping＝不照亮、少招它，暴露按方向计）；② 修「每 ping 一次更亮」的怪 bug → **覆盖遮罩 + 固定亮度**（重复 ping 不累积变亮，遮罩随时间淡＝记忆过时）；③ **低 san 改回 subtle**——弃「洞壁 morph / 人形 apparition」（不够好 + 一眼假），改 **伪接触（与真无异）+ 读数变乱码**，配合 `evadesSonar`（会藏的敌人）＝玩家真分不清真假、**不是明显的假**（北极星「拒绝裁决」）。并入 §5。
- **2026-06-05（S0 实装 · 作者方向「A→C→D 全做」第一笔 · 提交 `f57b17e` · STATUS quirk #71）**：§7 S0 落地，**只读真图、不改 DiveNode 模型**（欺骗 spoofs/evades 留 S2）。交付与§8 子决策的对应——① **布局推导抽公共**：`ui/mapLayout.ts::deriveMapLayout`（节点图→2D 坐标·`MapDevPanel` 改用、观感不变）。② **声呐读真图**：`engine/sonar.ts::revealSonarScan`（从当前节点**无向 BFS** 揭示有限程内真实节点，§5「ping 原点＝你」）+ `sonarScanRange`（基线 **2 跳**·§8.1 范围是主升级轴·升级轨留后续；双上限 <最深 <全洞）+ `scanFreshness`（§8.2 余像按 turn 渐隐）。③ **会过时的记忆**：`run.scanMemory`(nodeId→扫到时 turn·累积·run 级·`?? {}` 兜底·**不 bump SAVE_VERSION**，§8.8)；移动后旧 stamp 留存、再 ping 只刷新扫到的（staleness）。④ **代价**：`pingSonar` 写 scanMemory + **当场抬 alert**（`clarity.ts::sonarPingAlertDelta`：浅水免压×`alertDepthFactor`·深 band ×`bandAlertFactor`·clamp）+ **1 scan/停留 guard**（§8「1 scan/turn」：已 ping 未移动→no-op，移动后 sonar 归 off 才能再扫）。⑤ **渲染**（`ui/SonarScanPanel`，§5）：起手全黑、随 ping 一块块点亮、**缩放只看身边一小片** + **残图小地图**给方位感、固定亮度按 turn 渐隐余像（重复 ping 不更亮）、地标(↑出口/气穴/扎营)标形；**仅声呐解锁后出现**（§8.6 软门控 #58）。**S0 渲染先用 schematic（圆 blip + 连线）；§5 的「有机洞穴 SDF/噪声」轮廓是纯渲染层 polish、留后续。** 回归：`playthrough-sonar`(9 节·BFS 限程/scanMemory/alert spike/staleness/fade/round-trip) + smoke E4，全绿 + prod build。**下一步＝S1 多事件房间（`DiveNode.features?`）/ S2 不可信（填 `spoofsSonar`/`evadesSonar` + 低 san 伪接触/乱码·与节点版 mimic 合流）/ S3 威胁定位 / §6.5 宏观灯塔扫描揭示动画（可单独做）。**
- **2026-06-05（S1 实装 · 作者方向「A+C+D 全做·打磨到高完成度」第一笔 · STATUS quirk #74）**：§7 S1 落地，把「一节点一事件」升成「房间可含多事件点」，**轻量版＝房间把多 feature 摆成选项·无房间内自由 2D 移动**（§8.4 拍板）。子决策对应——③ **房间最多 3 feature**（§8.3）：`rollExtraFeatures` 偶尔把事件房间升级成 2–3 feature（**大房间稀有**·~62% 单/~26% 双/~12% 三）。④ **连探付氧**（§8.4）：`exploreFeature` 每探付 `FEATURE_EXPLORE_TURNS`(=1) 回合的氧（不含洋流移动费·你没离开房间）+ 标记已探（`run.activeFlags` 的 `feat:<nid>:<fid>`），选出口走人。⑧ **不动存档**（§8.8）：`features` 进 `DiveNode`（run 级 map·不入 profile）、探索进度走 `activeFlags`、**不 bump SAVE_VERSION**。**向后兼容铁律**：`DiveNode.features` 缺省＝走旧 `eventId` 单事件路径（`moveToNode` 到达即自动触发＝旧行为）；mapgen `maybeMultiFeatureRoom` **仅 `maxRoomFeatures>1` 才进＝缺省零额外 rng＝旧 mapgen 快照逐字节不破**（深 band 经 `DepthBand.maxRoomFeatures` 门控：trench/throat=2·abyssal/hadal/subhadal=3·reef_deep 等=1）。多 feature 房间到达**不自动触发**——`moveToNode` 路由到 `enterNodeSelection`，把房内未探 feature（`FeatureChoice`·full 档真相·S1 不改 sonarReturn）＋出口并列摆出，事件结算后回房间菜单（`activeFlags` 过滤已探）、探完只剩出口；同房 feature 用 `excludeIds` 硬去重（守 #19 单 tag/#44/#47 loot 隔离·跨房非 oncePerRun 可重复＝既有行为）。`SonarScanPanel` 把多 feature 房间画成 is-room 大轮廓＋feature blip（**仍只读真图**·各 feature 真假留 S2 在 `clarity.sonarReturn` 侧改写）。回归：`playthrough-sonar` §10（房间菜单/连探付氧/已探过滤/进房路由/向后兼容/探完清空）+ `playthrough-mapgen-scenarios` 多事件房间不变量扫（60 seed·192 大房间·全 2–3·同房不重复·确定性）+ smoke E5，全绿 + prod build。**下一步＝S2（填 `spoofsSonar`/`evadesSonar`·与节点版 mimic 合流）/ S3 威胁定位 / §6.5 宏观灯塔扫描。**
- **2026-06-05（S2 实装 · 不可信扫描 · 方向 A「然后确保这次完成它」· STATUS quirk #78）**：§7 S2 落地，把 S0 的「只读真图」声呐扫描升成**会撒谎**的扫描。子决策对应——⑤ **可信度沿 §3.2 + #64 band 倍率**（§8.5）：新 `DepthBand.sonarDeception?`（落 `run.sonarDeception`，沿 #64 `bandAlertFactor` 同款 plumb：depth_bands.json→startDiveFromOutpost→startDive→mapgen）抬高 `clarity.ts::effectiveFalseEchoSanity`（base + dec×SCALE·封顶 88 留一线可信·**非单调**：trench_throat 0.2→abyssal 0.28→hadal 0.32 越深越骗、subhadal **回落 0.06**＝兑现 band lore『那些骗你的把戏都停了』，越深越欺骗的梯度在渊外反转成诱饵；reef_deep/trench_mouth 不设＝浅段相对老实）。**三种不可信改写（§5「要 subtle·不一眼看穿」），全在 `clarity.ts` 一处、面板不加分支（§10）**：① `spoofsSonar`→`nodeSonarView.displayKind` 画成「朝上的出口/信标」＝**节点版 mimic「无灯之光」**（与 #69 海图 mimic 合流·**不触发 d_reveal**·只由 mimic 兑现事件触发 #42）；② `evadesSonar`→`noEcho`＝无回波（声呐图不画、留一处空缺＝捕食者躲过 ping）；③ 低 san→`garbled`（深度等仪表字损坏成不可读·按 `run.turn` 变）+ `sonarPhantoms`（伪接触·与真接触一模一样的幻影 blip·锚真实接触随其余像渐隐·下一记 ping 换一批）。**节点版 mimic 落点**＝mapgen 新 `applySonarDeception`（**确定性 FNV 哈希·零 rng**＝绝不移动任何 seed 的生成顺序·旧图/深 band 快照逐字节不变〔印证：60-seed 大房间数仍 192〕·仅 `sonarDeception>0` 才进＝缺省零改动·地标/起点/尸体豁免守 #36·放在 layered/maze 分流之后两拓扑共用）给部分内部节点钉 spoofs/evades。**缺省（浅水/POI/旧档·`run.sonarDeception` undefined）→ effectiveFalseEchoSanity 恰好回退升级基线＝零行为变化**（守 `playthrough-sensors` 既有 spoof/evade/低 san `sonarReturn` 文本断言）。⑧ **不动存档**：`run.sonarDeception` 派生·JSON round-trip+`?? 0` 兜底·**不 bump SAVE_VERSION**。回归：`playthrough-sonar` §11（spoof/evade 表象·失真阈值封顶/回落·低 san 伪接触/乱码·mapgen 欺骗 pass 门控/豁免/确定性）+ `playthrough-mapgen-scenarios` 不可信声呐失真不变量扫（60 seed·185 欺骗节点·只挂内部节点·门控缺省零·确定性·不破迷路不变量）+ smoke E6（spoof 假信标 is-spoof+↑/evade 无回波/低 san 乱码+伪接触/高 san 控制组）。全绿（25/25）+ prod build。**下一步＝S2 续：节点版 mimic 与 #69 海图 mimic 更深耦合（spoofsSonar 引向兑现事件）/ S3 威胁定位（alert→接触 blip→stalker）/ §6.5 宏观灯塔扫描揭示动画 / 声呐范围升级轴（§8.1 主升级轴·接 #60 桥）。**
- **2026-06-06（S3 廉价版 + §6.5 宏观 + 声呐范围升级轴 · 方向 A「彻底完成 A」· STATUS quirk #80）**：A 三件全做。① **声呐范围升级轴（§8.1 主升级轴·S0 留的钩子接上）**：`sonar.ts::sonarScanRange(run)` 从读基线常量改成读 `run.sensorTuning?.sonarScanRange ?? SONAR_SCAN_RANGE`，新 `sonarScanRangeBonus` 沿既有传感器升级桥（`UpgradeEffect→getUpgradeBonuses→getRunBonuses→createNewRun→deriveSensorTuning`），新 `SONAR_SCAN_RANGE_MAX=4` 在 deriveSensorTuning 夹紧＝**双上限（< 全洞 + < 最深·守北极星「再升也扫不穿/照不到最深」）**；data `line.sonar_rig` 续 lv4/lv5（各 +1 跳·深料账单·金阶梯单调）。缺省（旧档/部分 run/未升级）回退基线＝**S0 行为逐字节不变·SAVE_VERSION 仍 4**（SensorTuning 加字段·只 deriveSensorTuning 构造·`?? 基线` 兜底）。② **S3 威胁定位（廉价版·§7 S3 上半）**：见 §7。单一来源 `clarity.ts::threatContact`、面板纯渲染、与低 san 伪接触分两轴；**定位 stalker 仍 §8.7 留作者拍板**。③ **§6.5 宏观（揭示动画 + 海况遮蔽）**：见 §6.5。`chartConditions` 派生海况（不入存档）+ 浓雾遮一处 roaming（锚点/mimic 不遮）+ `.chart-survey-sweep`/`.chart-poi-arrive` 纯 UI 演出（engine reveal 集合不变）；**即时新 POI 浮现留后续**（避免 build 时重洗 roaming 选取）。回归：`playthrough-sonar` §2 扩 + §12·`playthrough-chart` §3 改派生 + §7·`playthrough-upgrades` §8 扩买 lv4/lv5·`playthrough-save` bonuses·smoke E7/J6/L。全绿（25/25·8s）+ prod build。**仍留：S3 定位 stalker（§8.7）/ §6.5 即时新 POI 浮现 / 定向 ping（§5·暴露按方向计）/ 房间 feature 数升级。**
- **2026-06-06（即时新 POI 浮现 #83 + 猎手 SPEC / Stalker Phase 1 #84 · 方向 A「声呐与房间收尾」· 作者选「即时新 POI 浮现 + S3 定位 stalker」）**：A 剩余尾巴挑两件落地。① **§6.5 即时新 POI 浮现**（补 §6.5 末「未做」缺口）：`SeaChartView` 的 chart memo 依赖从只 `runsCompleted` 加上**灯塔覆盖签名**（lighthouses 坐标 + 设施 + `effectiveRevealRadius` + flags）→ 中途建灯/点亮前哨**当场重算**、新进范围 POI 立刻浮现（复用既有 `.chart-survey-sweep`/`.chart-poi-arrive`，无 engine reveal 集合改动）；`chart.ts` roaming 选取改 **pool-independent 确定性键**（Efraimidis–Spirakis A-Res `key = u^(1/weight)`·u 由 (runsCompleted, templateId) 哈希·保留加权语义）+ roaming 模板键 id＝同 runsCompleted 重算不重洗已显示机会点（至多被更高优先的新点亮挤掉一个）。删 `generateChart` 的 `rng` 入参。`playthrough-chart` §8。② **§8.7 定位 stalker → 升级成「猎手」子系统**：作者三问把它从「图上一个 blip」扩成完整愿景（灯＝接近 / 声呐＝位置·同一猎手 / 感官模态 光·声·双 / 切信号行为 停·移到上次信号点 / 后期升级规避·decoy·大型生物狭小避难·执着等待 / 全深度浅弱深难）→ 另立 `docs/深海回响_猎手_SPEC.md`，本 SPEC §8.7 的 stalker 交由它接管。本 session 落地**猎手 Phase 1 spine**（详见猎手 SPEC §7/§10）：声呐侧的「精确定位 blip（§2.1）+ **被扫到才更新**（§8.7）+ `evadesSonar` 躲扫描」即此处 S3 stalker 的兑现（`SonarScanPanel` 深红 `✕` blip·压住模糊威胁接触）。`playthrough-stalker` + smoke E8。全绿 26/26 + prod build。**仍留：§5 定向 ping（暴露按方向计）/ 房间 feature 数升级 / 猎手 Phase 2+（升级规避·decoy·大型生物·执着等待·浅水弱变体·见猎手 SPEC §7）。**
- **2026-06-06（定向 ping #86 + 房间 feature 数升级 #87 · 方向 A「确保真的完成」）**：A 剩余两件尾巴全部落地，**声呐与房间 SPEC 核心 + 收尾完成**。① **定向 ping（§5）**——作者拍板「方向扇区」（三向：朝深处/侧向/来路·按 `node.layer` 差分·与布局 x∝layer 一致＝声呐图右＝深、左＝来路、同列＝侧向）。`sonar.ts::revealSonarScanDirectional`：近场全向 `max(1,base−1)` 跳、聚焦扇区波束沿该扇区继续扩到 `min(SONAR_DIR_RANGE_MAX, base+1)` 跳（超近场**只经聚焦扇区节点扩**＝波束连贯·无孤立远 blip），「那方向探更远、别处更短」；封顶 `SONAR_DIR_RANGE_MAX=SONAR_SCAN_RANGE_MAX+1` ＝守北极星「再聚焦也扫不穿整洞/照不到最深」（单一窄扇区只多探一跳）。**暴露按方向计**（`clarity.ts::sonarPingAlertDelta(run,dir)`）：窄波束整体更安静（×`SONAR_PING_DIR_MULT`0.55），但正对**听得见声音的猎手**（声/双感）所在扇区则尖峰（×`SONAR_PING_TOWARD_MULT`1.7＝净>全向＝你照亮它了·「别朝声感猎手方向 ping」）——`pingAimsAtSoundStalker` 用猎手**真实**位置算后果·UI 警示 `seenStalkerSector` 用**会过时**的声呐看到位置（你按旧图瞄·它可能已移开＝「图会过时」张力）。扇区分类 `nodeSector` 住 sonar.ts（**引擎不碰 ui/mapLayout**·clarity→sonar 无环既有）。`pingSonar(state,dir?)` 透传 + 记 `sensors.sonarDir`（移动随 sonar 清·不 bump SAVE_VERSION）；NodeSelectView 三向按钮（朝猎手向 `aims-threat ⚠`）+ omni 标「全向」；SonarScanPanel 聚焦文字标注。**定向免费**（解锁声呐即有·纯战术 breadth↔depth+隐蔽取舍·非 power-up；`scanStalker` 定位仍按基线量程＝近场总听得到它·不动 stalker 测试）。**omni（dir 缺省）逐字节不变**＝守 sensors/sonar 既有回归。`playthrough-sonar` §13（扇区分类/omni 回退/更远·更短/暴露三态·光感豁免/pingSonar 集成/移动清聚焦）+ smoke E4b。② **房间 feature 数升级（§6/§8.3 续·收尾 #74 尾巴）**——新 `roomFeatureChanceBonus` 沿 #80 同款传感器升级桥（`UpgradeEffect→getUpgradeBonuses→UpgradeBonuses→getRunBonuses→createNewRun→deriveSensorTuning`·编译期 7 处全补＝漏一处 typecheck 报错护栏）·`deriveSensorTuning` 夹 `ROOM_FEATURE_CHANCE_MAX=0.3`；`startDive` 读 `run.sensorTuning.roomFeatureChanceBonus` 透传 mapgen `GenOpts`→`rollExtraFeatures` 把『单 feature』门槛往下压＝深处大房间更常出现。**band `maxRoomFeatures` 仍是房间尺寸天花板**（升级只让大房间更常见、不突破深 band 上限）；缺省 0（POI/教学/未升级）→ `rollExtraFeatures` 阈值/rng 消耗不变＝mapgen 逐字节复现旧图（向后兼容护栏）。data `salvage_guild` 续 lv4「深潜打捞队」（`eel_skin`×4+`lantern_gland`×2+220 金·深料账单·effect 0.18）。`playthrough-upgrades` §9（桥+缺省0+夹上限+前置门控）+ `-mapgen-scenarios` 出现率不变量（bonus0 逐字节·bonus0.3 抬率·确定性）+ `-save` round-trip + smoke J7。全绿 26/26 + prod build·提交 `6bfdc76`（定向 ping）+ `953622a`（房间升级）。
- **2026-06-06（#90 · 方向「释放·closeout」· 作者「做完能释放掉文件/流程的就先做、直到全部完成」→ 选『全部 3 项』关闭本 SPEC）**：把本 SPEC 仅剩的三项 residual 全部清零、**SPEC 彻底完成关闭**。① **聚焦扇区可视化（§5）**——此前定向 ping 只有文字标注「聚焦·朝深处」；现 `SonarScanPanel` 据 `run.sensors.sonarDir` 画一道半透明聚焦扇区楔形（`sonar-focus-wedge`·`focusWedgePath` 纯几何·deeper 朝右/back 朝左/lateral 上下两瓣·与布局 x∝layer 一致·半径略超量程环＝直观「那一向探更远」·暖色 warn 与冷色真图一眼可分）。纯渲染·smoke E4b。② **各方向 reach 各自升级（§5）**——新 `UpgradeEffect{kind:'sonarDirReachBonus',dir,value}`（带 `dir` 判别·首个非标量旋钮·聚合进 `Record<SonarDir,number>`）沿同款传感器桥（`UpgradeEffect→getUpgradeBonuses→UpgradeBonuses→getRunBonuses→createNewRun→deriveSensorTuning`·逐向夹 `[0, SONAR_DIR_REACH_MAX]`2）→ `SensorTuning.sonarDirReach`；`revealSonarScanDirectional` 加第 5 参 `dirReach`（焦距 `min(SONAR_DIR_RANGE_MAX+reach, base+FOCUS+reach)`·近场/别向不延长＝守北极星「再聚焦也扫不穿整洞」）·`sonarDirReach(run,dir)` 读·`pingSonar` 透传；data `sonar_rig` lv6/7/8 三向各 +1（**定向免费仍成立·reach 才是 power-up**）。**缺省全 0 → 定向揭示逐字节不变·不 bump SAVE_VERSION**（record 纯对象 JSON round-trip）。`playthrough-sonar` §13(i 更远·别向不变·缺省逐字节 / j 桥·全向 0·夹上限）+ `-upgrades` §11 + `-save` round-trip + smoke J9。③ **§5 later 接触带大小 + 开放水域扫描**——`Stalker.large?`（spawn `depth≥STALKER_LARGE_DEPTH`108m·缺省小 blip）→ `stalkerSonarBlip` 透传 → 画弥散质量一大团；开放水域（`!zoneAllowsBacktrack`）声呐图不画洞壁通道边、只显接触读数（`is-open-water`）。`playthrough-stalker` §2b + smoke E4c/E8。**回归坑（quirk #91）**：`.sonar-stalker circle`（0,1,1·fill:none+描边）会压过 `.sonar-stalker-mass`（0,1,0）→ 弥散团被画成空心环；用 `.sonar-stalker circle.sonar-stalker-mass`（0,2,1）压回。全绿 26/26 + prod build。**至此声呐与房间 SPEC 关闭——仅 §7 顶『关闭』块所列的猎手 Phase 2+ 在别处（猎手 SPEC §7）。**
