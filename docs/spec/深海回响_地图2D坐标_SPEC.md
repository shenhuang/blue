# 深海回响 · 地图真 2D 坐标 SPEC（Phase 2·mapgen 地基）

> **状态（2026-07-20）：已拍板（四处全取建议案：①参数化条带域 ②Gabriel∪MST ③米制椭圆·沿现密度 ④maze+layered 同批）·实装中。** Phase 1（渲染层重心排序）已另行落地（`mapLayout.ts::orderByBarycenter`·QUIRKS #196 文末注）——本 SPEC 落地后它退为**无坐标图的兜底路径**（不白做）。
> 背景讨论：2026-07-20「连通⇔画得近」两阶段拍板（HANDOFF 待办 1）。

## 0. 病根与目标

**病根＝拓扑与坐标解耦、因果链倒置**：mapgen 连边按放置序号窗口（`mapgen-maze.ts` 步 1·`[i-4,i-1]`）不看位置；渲染层 `deriveMapLayout` 事后把无坐标的图铺进槽位。结果：画得近的节点常没连边、有边的邻居画在老远。#315/#316 一记 ping 全图揭示后玩家全程看图导航，错位被放大。Phase 1 重心排序把「有边画远」消掉 83%（60 seed 实测 0.17→0.03 条/图），但「近而无边」卡在同层 34px 槽距的几何极限（4.15→3.92 对/图）——根治须倒转因果：**先有位置、后有边**。

**目标不变量（落地后由门守）**：

1. **位置即深度成为构造保证**：`depth ≡ y`（深水区 SPEC §13 从渲染约定升级）。不再有「赋深度」步——撒点的 y 就是深度。
2. **近而无边 ⇒ 中间必隔节点或墙**：连边用 Gabriel 图性质（§3②）——任意两点若以其连线为直径的圆内无第三点，则必有边。被结构修剪（死路/最深点）拆掉的近边，节点间距同步推开到分离阈值 ⇒ 声呐上有墙＝诚实。
3. **非相邻不假熔**：warren 诚实门（非相邻房间距 ≥ 两房半径+余量·隧道不穿房）从 warren 专属泛化为所有带坐标图的通用门。

## 1. 数据形状

- `DiveNode` 加 **`x?: number`（米·与 depth 同单位）**；y 不另存＝`depth` 本身。渲染 px = `x·pxPerMeter`（等比·纵横同尺）。
- 存档：`run.map` 入档 ⇒ **SAVE_VERSION 18→19 直接 bump 废旧档**（#99·不写迁移）。`x` 为 optional：无 `x` 的图（教学单节点/warren/旧路径）走 Phase 1 派生兜底。
- `deriveMapLayout`：开头查「全部节点带 `x`」→ 直接用存量坐标（平移进画布 + 镜像手性照旧）；否则走现行派生。**接口/返回形状零变** ⇒ SonarScanPanel / SonarMapView / openWaterRender 全体零改自动跟随。

## 2. 生成管线（maze 为主叙述·layered 同构）

① **撒点**：在「撒点域」（§3①）内确定性撒点（用现有 `opts.rng` 流·守 #98 同地同图）。N 沿用现值（`layerCount × nodeCountMultiplier`·内容预算不变）。入口钉域顶（全局唯一最浅）。**实装修正（2026-07-20·两轮·mapgen-scatter.ts 头注留档）**：(a) 纯 Bridson 在本规模（~13 点跨 ~43m）会围种子聚团留中缝→MST 跨缝长边，改**分层撒点**（stratified·每深度带保有点·骨架边天然短）；(b) 洞型谱 k **在最终空间进采样**（层位 `fracU^k` 映射到真实 y·minDist/连边/结构全在最终坐标上）——第一版曾做「末端 depth 重映射」（k=1 空间完成再弯 y），对抗复审 fuzz 实证其在 k≥1.5 大面积破「入口唯一最浅/不假熔」（k=2.6 时 300/300 seed），已回炉改为最终空间采样：诚实不变量构造性成立于**玩家看到的坐标**；rng 流随 k 不同（无任何测试要求跨 k 同流），「缺省=显式 k1 逐字节」仍成立（同为 k=1 同路径）；#114 三档 meanDepthFrac 0.656/0.507/0.357（档差 ~0.15）·per-seed 单调 0/30 违例。守门＝coords2d 门 D 段（k 三档+seedKey 派生跑全量①–⑤断言）。(c) 域宽由**容量公式**推出（`n·cell 面积/(packing·可用高)`·第一版恒常数宽曾致 Poisson 欠交付成常态+横向域名不副实）——现 7 zone 交付率 100%、horizontal 域长宽比 1.26>1（真横条）。`resolveDepthCurve` 链原样保留。

② **连边＝邻近图**：Gabriel 图（圆内无第三点则连）∪ 短边偏好 MST（保底连通）。edge 预算超出时按长度修剪、保 MST 边。

③ **结构编排**（对照 mapgen-maze 步 2–3 的结构不变量·全部保留）：
   - **最深点 2–3 个**：取 y 最深的候选修剪成 degree-1 叶、y 钉 d1、邻居推浅（推的是坐标＝声呐如实变深）；
   - **far exit**：另一叶钉 ascent_point；
   - **环**：Gabriel 天然带环；环秩 <1 时补一条相近短弦；
   - **死路 ≥2**：Gabriel 度普遍偏高 ⇒ 靠修剪外围点入度产生。
   - 类型/事件/地标/corpse pass（步 5–7）照旧不动。
   - **实装修正**：SPEC 原「分离修复 pass」**未做也不需要**——分层撒点 minDist + 「只删边不动点」构造性保住分离（钉深/推浅后由坐标诚实门 660 图实证仍成立）；真跑修复反而拉长边。

④ **layered（开阔水域/scarlet）**：撒点域＝宽条带（`OPENWATER_WIDTH_SCALE`）、连边同 ②，弃「层内均深 + 只连下一层」——`layer` 字段保留＝BFS 树距（与 maze 语义统一）。**实装注**：节点 id `node.L.i`→`node.i`；图从有向 DAG 变**无向连通**（可回头）＝开阔水域「漫游」定位的有意统一，非副作用；start=entrance（kind 沿旧 layer0 规则）、最深 1–2 节点=ascent_point（旧「末层上浮口」坐标版）；`pinnedEventId`(#174)/`scriptedNodeEvents`(#221) 语义保留改写（dormant）。**开阔水域 SPEC §3「节点图保持无坐标」自此 supersede**（该 SPEC 已加注）；海床 contour「每 X 列最深节点」改吃真 x ⇒ 更准，`seabedNodeIds`（纯拓扑+tag·#307）不受影响。

**warren 本次不动**（专用 ROLE 锚位布局+诚实门已是 2D 设计·动它风险/收益比差）；教学 linearScripted 不动（单节点/脚本钉层）。

## 3. 拍板点（2026-07-20 已拍·四处全取建议案；实装数值偏离见下）

> **实装后数值注**：`NONADJ_MIN_FACTOR` 实装取 **1.0**（非建议案的 warren 同款 2.0）——`depth` 整数量化（渲染 y 到 1m 格）下「同 x·深度差 1」的合法非相邻对度量恰=1.0，2.0 必被擦穿；1.0=撒点最小间距同阶，仍严格优于旧图（旧图存在 dy=0 非相邻对）。要更强分离＝加大撒点间距（图变大）——留作者末期统调（[[defer-number-tuning]]）。其余常量（域宽/边预算/EDGE_MAX 16.0 等）全部占位·单源 `mapgen-scatter.ts`。

① **撒点域（轮廓来源·LayoutStyle 职责交接）**——建议案：**域＝按 style 参数化的条带形状**（vertical=竖条 / horizontal=横条〔深度锁带〕/ serpentine=折返带），mapgen 按 zone 的 layoutStyle 选域形状；**渲染层不再管形状**（style 的形状职责整体前移到 mapgen），洞壁仍由节点位置派生（caveSdf 围节点·SonarScanPanel 零改）。备选：显式轮廓 SDF 先行（mapgen 产轮廓→撒点→渲染直接用轮廓）——更重、动渲染管线，建议留给「钦定图/冻结 DiveMap」（quirk #266）时代再做。

② **连边规则**——建议案：**Gabriel ∪ MST**（唯一给出目标不变量 2 数学性质的选项）。备选：RNG 相对邻域图（更稀·无该性质）/ k 近邻+MST（最简单·无几何保证）。

③ **撒点密度/间距**——建议案：Poisson 最小间距用**米制椭圆度量**（横 ≈1.7m=colW/pxPerMeter·纵 ≈1m·沿用现视觉密度）；非相邻分离阈值取 warren 门同款比例。**全部数值占位待作者末期统调**（[[defer-number-tuning]]）。

④ **范围**——建议案：**maze+layered 同批**（一次 SAVE bump + 一次全量 rebless·开阔水域 SPEC 同批落 supersede 注）。备选：只 maze 先行（开阔水域拓扑照旧·churn 两次）。

## 4. 影响面 / 门 / rebless

- **rng 流整体位移** ⇒ mapgen 指纹类基线**全部重烤**（`playthrough-mapgen-scenarios` 4 baseline + 洞型谱锚点 + seed 扫描按新常量重录）；**结构不变量断言（连通/双向/环/死路/局部极大/起点最浅/垂直性）一条不删、原样过**。
- 新增门：**坐标诚实扫描**（120 seed×maze+layered：非相邻间距 ≥ 阈值 / 边长 ≤ 上限 / 近而无边必隔点或已推开）——warren 门的泛化版。
- 必过既有门：analyzeMap 回归 / check-lunar-reach / dive-stalker（猎手寻路·纯图算法不吃坐标）/ warren 门（不动也跑·防共享代码波及）/ scenario baseline / typecheck / build。
- 实装可按 [[cowork-parallel-agents]] 车道并行（mapgen-maze / mapgen-layered / mapLayout+类型 / 门脚本 四车道文件不重叠·合并后全量 regress）。

## 5. 非目标

- 钦定图/冻结整张 DiveMap（quirk #266·将来另拍）；warren/教学改造；手感数值终调（defer）；显式轮廓渲染管线（§3① 备选）。
