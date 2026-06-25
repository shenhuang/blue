# 深海回响 · 多口持久洞 SPEC（方案 B · roadmap T2）

> 状态：**实装子-spec 草案 v1（2026-06-25 · cave-bmap session）**——待作者确认数据模型/存档形状后开码。
> 真相源上游 = `cave_zones_spec.md`「设计章 v2」§5（多口洞 B）+ §1（出入口数）。本文件把那一节落成**可实装的数据模型 + 生成算法 + 存档形状 + 增量计划**。
> 关联 quirk：#92/#93「位置即深度」· #98「同地点同 seed」· #114/#115「洞型谱/平廊」· #99「未发布不写迁移」· #104「并发隔离」· #130/#psm「车道」。
> **史诗复合洞（深门 the_deep_gate）= roadmap T2b**，循环再生「会呼吸的洞」是另一套生成路径，**不在本棒**（见 §10）。本棒只做**普通持久多口图 + 绑定/可扩展模型**。

---

## §0 目标与非目标

### 目标
把一个洞从「每潜重生的临时图」升级成「一个**持久存在的真实空间**」：
1. **一洞一图入存档**：洞的地图**写进存档**（`SAVE_VERSION` bump），不再每潜重生。
2. **多口（mouth）**：海面上**多个 POI 入口**落到**同一张图的不同入口节点**；另有**只能上浮的出口**（非 POI）。
3. **续存**：同一个洞再进（哪怕换一个口进）——料/尸/已探**接着上次**，不重置。
4. **可扩展（硬要求·§5 上游）**：地图与「POI→入口节点绑定」**解耦、数据驱动**——加大洞=追加数据；别处加口=加一条 binding，**不重生、不改码**。

### 为什么要「存图」（而不是只靠 #98 确定性重生）
现状 #98 已给「同 POI → 同一张图（确定性重生）」+ 采集耗尽 overlay，但它**做不到多口共享同一空间**：每个 POI 各自 seedKey、各生成**互不相干**的一张图。B 的核心差异＝**一个洞 = 一个被多个口共享的空间**，且这空间是**可变的底座**——未来「水流 / 坍塌 / 潮汐淹没 / 光路连通改变」（§5 上游）会**在运行时改写这张图**，确定性重生托不住运行时突变，故必须**把图实体化进存档**。

### 非目标（明确划走）
- **深门循环再生洞（T2b）**：月相开合 / 模板库拼接 / 口部固定+深处重置——**不在本棒**。本棒的「持久」＝**全图持久**；深门的「持久」是**口部固定段持久·深处随周期重置**（语义不同·见 §10）。
- **跨 beacon 海图多口接线（T3b）**：本棒**定字段 + 渲染契约**，实际把副口 POI 铺到 chart_pois.json 归 T3b（不在本车道）。
- **温度门控（T4）**：本棒不接温度；只在数据模型上**留出口**（入口可被「封口」＝不可达·见 §2.4 `entranceBlocked`），具体由 T4 消费。
- **数值调参**：口数/深度/门户数等占位，统一留作者最后调（`defer-number-tuning.md`）。

---

## §1 术语

| 词 | 定义 |
|---|---|
| **洞 cave** | 一个持久空间，由稳定 `caveId` 标识。一张持久 `DiveMap` + 一份持久态。 |
| **口 mouth** | 洞与海面的连通处。两种：**入口 entrance** / **出口 exit**。 |
| **入口 entrance** | 带海图 POI、可下潜起手、也能上浮的口。落到图上一个**入口节点**（`ascent_point` + `portalKind:'entrance'`）。数量按尺寸（§3.2）。 |
| **出口 exit** | **非 POI**、**只能上浮不能起手下潜**的口（穿流泄流口/上升烟囱/单向塌口·上游 §1 fiction）。每洞 **≥1**。图上一个**出口节点**（`ascent_point` + `portalKind:'exit'`）。 |
| **核心 core** | 洞的最深处、**离所有入口树距最远**。深度钉全图最大。 |
| **门户节点 portal** | 入口/出口节点的统称（图上可上浮的「口位」）。生成时按数据预留一池（§3.4），绑定 POI 的成入口、标 ascent-only 的成出口、未绑定的＝**潜在口位**（留给「别处加口」）。 |
| **绑定 binding** | 「POI → 入口节点」的一条数据映射（`ChartPoi.caveEntry`）。加口＝加一条 binding。 |
| **持久态 caveState** | 一个洞的存档态：冻结的地图 + 已探节点集（+ 复用 harvest/deaths 记账）。 |

---

## §2 数据模型

### §2.1 持久地图容器（存档形状 · SAVE_VERSION 9→10）

新增 **profile 级**容器（持久＝跨 run·必须在 `PlayerProfile`）：

```ts
// types/state.ts · PlayerProfile 新增字段
/**
 * 持久洞地图（多口持久洞 SPEC·方案 B）：caveId → 该洞的冻结地图 + 持久探索态。
 * 首次进洞生成并冻结于此；再进（含换口进）从这里加载＝同一空间续上次。
 * 容器必填：createInitialProfile 种 new Map()，旧档缺它由 hydrateGameState 单点补（同 harvestedResources·#107）。
 * 序列化由 saveReplacer/saveReviver 的 __map 分支处理（value 内含 DiveMap 纯对象 + Set → 自底向上 revive·见 state.ts）。
 */
caveMaps: Map<string, PersistentCave>;
```

```ts
// types/dive.ts · 新增（地图域类型放 dive.ts·与 DiveMap 同文件）
/** 一个持久洞的存档记录（多口持久洞 SPEC §2）。 */
export interface PersistentCave {
  /** 稳定洞 id（= 生成 seed·= harvest 记账 key）。 */
  caveId: string;
  /** 冻结的地图（首次进生成→冻结；运行时突变机制〔未来〕在此就地改写）。 */
  map: DiveMap;
  /** 曾被探明过的节点 id（跨 run 持久·驱动声呐图「已探片」预亮 + 海图认知）。 */
  explored: Set<string>;
  /** 生成时落定的入口/出口门户清单（portalNodeId → 门类）。绑定/渲染/守门读它，不必扫全图。 */
  portals: CavePortal[];
}

/** 一个门户口位（入口或出口·§1）。 */
export interface CavePortal {
  /** 对应 DiveMap.nodes 里的节点 id。 */
  nodeId: string;
  /** 'entrance' 可下潜起手 + 上浮；'exit' 仅上浮（非 POI）。 */
  kind: 'entrance' | 'exit';
  /** 该口位的绝对深度（= 节点 depth·冗余存便于按深度选口/区域偏置）。 */
  depth: number;
  /** 口位区域标签（rim/flank/deep·区域偏置绑定用·§2.4 regionBias）。生成时按 depth 分桶派生。 */
  region: CaveRegion;
}

export type CaveRegion = 'rim' | 'flank' | 'deep';
```

**SAVE_VERSION 9→10**：`profile.caveMaps`（Map）新增＝形状变 → 按 #99 **不写迁移、bump 弃旧档从头开始**。在 `state.ts` 版本注释链续一条 `9→10`。

**序列化**：`saveReplacer/saveReviver` 已有 `__map`/`__set` 双分支（自底向上 revive），`Map<caveId, PersistentCave>` 里嵌的 `explored: Set` 与 `map: DiveMap`（纯对象）**天然 round-trip·零新序列化代码**（同 `harvestedResources: Map<poiId, Set>` 先例）。`DiveMap` 内无 Set/Map（`nodes` 是 `Record`，`connectsTo` 是数组），JSON 原生。✅

**hydrate**：`hydrateGameState` 单点补 `caveMaps: state.profile.caveMaps ?? new Map()`（同 `harvestedResources`）。

### §2.2 入口/出口 的节点标注（DiveNode 扩展）

入口/出口节点仍是 `kind:'ascent_point'`（沿用上浮语义·不碰 `canFreeAscend`/`isAscentBlocked`），**加一个纯标注字段**区分门类 + 回指口身份：

```ts
// types/dive.ts · DiveNode 新增（全可选·additive·真条件字段）
/**
 * 多口持久洞（SPEC §2.2）：该 ascent_point 是洞的哪类口。
 *  - 'entrance'：带 POI 的入口（可下潜起手 + 上浮）。
 *  - 'exit'：只能上浮的出口（非 POI·穿流泄流口/烟囱/塌口）。
 * 缺省（undefined）＝普通 ascent_point（单口洞的「洞另一头出口」/ 开阔海域末层上浮口）＝旧语义逐字节不变。
 */
portalKind?: 'entrance' | 'exit';
```

> **为什么不新增 NodeKind**：入口/出口在**移动/上浮/可达性/声呐**上的行为与现有 `ascent_point` **完全一致**（解耦原则）；门类只在「能否作为下潜起手点」（dive-start）与「海图绑定/渲染」上有别。故用**薄标注**而非新 kind，避免触动所有 `kind==='ascent_point'` 的既有判据（mapgen corpse 候选过滤 / analyzeMap / clarity 地标豁免 / dive 上浮）。

### §2.3 POI → 入口节点 绑定（解耦核心 · ChartPoi 扩展）

加口=加数据，落在 **POI 侧**（chart_pois.json 由 T3b 写·本棒只定类型 + 消费逻辑）：

```ts
// types/chart.ts · ChartPoi 新增（可选·与现有 zoneId/bandId/columnId 路径并列）
/**
 * 多口持久洞入口绑定（SPEC §2.3）：设了 ⇒ 本 POI 是某持久洞的一个**入口**。
 * 下潜走持久洞路径（load-or-generate caveMaps[caveId]·起手节点 = 解析出的入口节点），
 * 而非 zone/band 的每潜重生路径。**解耦/数据驱动**：别处再开一个口 = 加一条带 caveEntry 的 POI，不重生、不改码。
 */
caveEntry?: {
  /** 目标洞稳定 id（= 持久图 seed·= caveMaps key）。多口共享同一 caveId ⇒ 落同一张图。 */
  caveId: string;
  /**
   * 显式绑定到地图的某入口门户节点 id（最稳·作者钉死「这个口落这个节点」）。
   * 缺省 → 由 regionBias 在该洞 entrance 门户里**确定性**派生（FNV(caveId::poiId)·零 rng·同口永远同节点）。
   */
  entryNodeId?: string;
  /** 区域偏置（缺省 entryNodeId 时用·按口的地理把它落到 rim/flank/deep 的入口门户）。 */
  regionBias?: CaveRegion;
  /** 该入口的声明深度（reef 口浅/vent 口深）：影响默认 regionBias + 生成时门户分配。缺省 → 取绑定节点 depth。 */
  mouthDepth?: number;
  /**
   * 入口被「封口」不可起手（上游 §5b/§6·温度过热过冷/只能当出口/得从别洞穿过去）：
   * true ⇒ 海图标已知但 dim、不能从此下潜（仍可作为洞内上浮的出口）。T4 温度门控的接入点。
   */
  entranceBlocked?: boolean;
};
```

**绑定解析（dive-start 读·确定性·零 rng）**：
1. 有 `entryNodeId` → 直接用（守门：该 id 必须是 caveMaps[caveId] 里 `portalKind:'entrance'` 的节点）。
2. 否则按 `regionBias`（缺省由 `mouthDepth` 分桶）在该洞 `portals` 中筛 `kind:'entrance' ∧ region==bias` 的候选，`FNV(caveId::poiId) % 候选数` 选一个（同 POI 永远同入口）。
3. 候选空（区域没有入口门户）→ 回落任意 entrance 门户（健全回退·不白屏），并记一条 `check-cave-bindings` 可断言的告警。

> **可扩展性如何成立（§5 硬要求逐条对应）**：
> - **加大洞** = 改该洞生成参数（节点数/门户数·数据）→ schemaVersion bump → 旧 caveMaps[caveId] 作废重铸（§4.4）。**不改生成代码**（参数全数据驱动·§3.4）。
> - **别处任意 beacon 加一个口** = 在 chart_pois.json 加一条 `caveEntry.caveId=X` 的 POI，绑到 X 的某个 **entrance 门户**（显式 entryNodeId 或 regionBias 派生）。门户在生成时已预留一池（§3.4）→ **不重生 X 的图、不改码**。✅
> - **口数/形状不写死进生成逻辑**：生成只读「该洞要几个门户、什么深度分布」这些**数据**（§3.4 `CaveGenParams`）；具体哪个 POI 绑哪个门户是 POI 侧的事，生成器不知道也不关心。

### §2.4 洞参数（数据驱动 · 生成输入）

一个洞要生成成什么样，全由一组**数据**决定（**独立 `src/data/caves.json`**·作者拍 2026-06-25「以可拓展/可维护优先」——洞是新一层概念、与 zone 解耦，独立文件让 T3b/编辑器单独读写，不把「洞」糊进「zone」语义）：

> **caves.json = 持久洞登记表**：一个 zone 通过在此登记一条 `CaveGenParams` **变成持久洞**（走 §3/§4 路径）；没登记的 zone 保持现行每潜重生路径（#98）。**加一个新持久洞 = 加一条 caves.json 条目**（＝可拓展模型本身）。
> **caveId 命名 = 独立命名空间 `cave.<短名>`**（作者拍·如 `cave.mirror_maze`）——**不**与 zoneId 1:1 绑定，故跨 beacon 洞（借某 zone 内容、却是自己的空间）能有独立身份；多 zone 关系也好表达。

`src/engine/caves.ts`（新·小加载器）`getCave(caveId): CaveGenParams`（读 caves.json·同 getZone 模式）供生成/绑定/守门共用单一来源。

```ts
export interface CaveGenParams {
  caveId: string;
  /** 复用哪个 zone 的内容池/标签/敌人（事件抽取仍走 buildEventPool(zone)）。 */
  zoneId: string;
  /** 绝对深度窗口 [浅, 深]（核心钉 d1·入口散在更浅处·§3.3）。 */
  depthRange: [number, number];
  /** 图规模（节点数派生·≈ 2×sizeScale·沿用 layerCount 的 maze 语义·#175）。 */
  sizeScale: number;
  /** 要预留的**入口门户**数（≥ 预期挂口数·留余量给「以后加口」·§3.4）。 */
  entrancePortals: number;
  /** 要预留的**出口门户**数（≥1·§1）。 */
  exitPortals: number;
  /** 深度密度剖面曲线 k 区间（沿用 #114 depthCurveRange·决定哪段深度节点多＝洞胖瘦·§3.3 模型 B）。 */
  depthCurveRange?: [number, number];
}
```

> 这组参数＝生成器的**全部**输入。「加大洞」改 `sizeScale`/`depthRange`；「这个洞将来要挂很多口」调大 `entrancePortals`。**没有任何口数/形状写死在 mapgen 代码里**——全是这张表。

---

## §3 生成：`generatePersistentCaveMap`

### §3.1 与 `generateMazeMap` 的关系（扩展 · 门控 · 向后兼容）
持久多口图是 maze 拓扑的**超集**，新增一个**专用生成入口** `generatePersistentCaveMap(params, rng)`（mapgen.ts·我独占）。它**复用** `generateMazeMap` 的成树/弦边/死路骨架（§3.4 step 1–3），但替换 **step 2（门户选择）** 与 **step 4（深度赋值）**，并新增 **入口/出口/核心标注**。

**向后兼容硬约束**：
- 既有 `generateDiveMap`/`generateMazeMap` 的所有调用路径（POI/band/教学/scenario）**一行不改、逐字节复现旧图**——持久路径是**另一条**入口，只在 dive 声明了 `caveEntry` 时才走（§4）。
- 单口洞（chart 里只挂 1 个 entrance POI 的 cave）也走持久路径，但 `entrancePortals:1` ⇒ 退化成「1 入口 + 1 出口」＝几乎就是今天的单口 maze（多了「入存档」与「出口标注」）。

### §3.2 入口/出口数 × 尺寸（上游 §1 表 · 占位）

| 档 | sizeScale（≈节点/2） | 入口门户 entrancePortals | 出口门户 exitPortals |
|---|---|---|---|
| 小 | 3–4 | **1**（+0–1 余量） | ≥1 |
| 中 | 7–9 | **1–2**（+1 余量） | ≥1 |
| 大 | 12–14 | **2–3**（+1–2 余量） | ≥1–2 |
| 史诗（深门·T2b） | 70 | 6 | 多 |

> **余量**＝多预留几个 entrance 门户（暂不绑 POI），让「以后别处加口」是纯 binding（§2.3）。数值占位·作者最后调。

### §3.3 深度 = 节点自有坐标（剖面场 · 模型 B · **关键不变量**）

**为什么需要专门的深度模型**（动机）：游戏硬不变量「位置即深度」#92——每节点都有真实米数深度，驱动声呐图纵轴（y∝depth·#93）、内容投放（越深母题落越深节点）、耗氧/减压/氮醉压力。多口洞里**同一个物理节点只有一个真实深度**，不管你从哪个口进。故必须有一个**与入口无关**的深度来源。

**弃案 —— 「离核心树距」**：树距（hop 数）同时累积「往深」和「往横」两种移动 → **横向铺很远的廊道末端会被算成更深**（横向远 ≠ 更深）。深度与横向延展本是**正交两轴**（#175/#176 平廊已确立：layerCount 横、depthRange 深、orientation 选威胁轴）。hop-distance 当深度＝把两轴搅在一起。

**模型 B —— 深度是节点自有坐标，不从拓扑反推**（贴合声呐图：声呐图/选点布局本就是一张**深度剖面**·#93 纵轴 y∝depth + #100 有机洞穴 canvas 剖面）：
1. **采深度坐标**：生成时直接给每节点采一个深度值填满 [d0,d1]。**核心钉 `d1`**（唯一最深）；每个**入口门户钉它的 `mouthDepth`**；**出口门户**按其 region 取深度；其余内部节点按**剖面曲线**（下条）在 [d0,d1] 采样。
2. **剖面曲线（#114 k 的剖面场新语义）**：k 调**深度密度剖面**（哪段深度上节点多＝洞的胖瘦）——k>1：浅层节点多、贴近核心才骤深＝「广中藏深」；k<1：早早探深、深处横向铺开。`caveDepthCurveForPlace` 公共入口复用（海图情报同源·#115）。
3. **连通性沿用现有 maze 骨架**（成树+弦边+死路·§3.4·**已测·迷路感不变·加法不撕**），但**边倾向连深度相邻的节点**（相邻节点深度平滑·廊道不跳深）。核心成簇置深处、入口在浅缘——天然「核心离所有入口最远」（上游 §1）。
4. `depth[i] = 采样坐标 + jitter`——**与 hop 数 / 横向距离完全无关**：横廊再长也是同深度那一串点。

**渲染对齐（最贴合声呐图）**：`mapLayout::deriveMapLayout`（#93）纵轴 y∝depth **直接画出这个深度场**——入口在各自深度的边缘、核心在底、横廊是一条等深横带，读起来就是真实洞剖面。横轴仍「无方向语义」（守迷路/迷向欺骗轴·#71/#92），深度是诚实轴（#113）可精确。

**与既有不变量逐条核对**：
- **#93 渲染（`y∝node.depth`·无方向语义）**：每节点仍有绝对 depth → `deriveMapLayout` 一行不改。✅
- **#92「位置即深度」**：单口 maze 的「离 node0 单调」是其单入口**特例**；持久洞改成**每节点深度是固定坐标、核心唯一最深、朝核心方向深度单调非减**（横向/分支同深或朝浅·同 #114 放行）。是该不变量在多入口下的推广，非破坏。
- **playthrough-mapgen-scenarios 垂直性**：现有 60+ maze seed「从 startNode 单调」断言是**单口路径**·原样保留（护栏）；持久路径**新增** `persistent-cave` 块 + 新不变量：①每节点 depth∈[d0,d1]；②core 唯一全局最深；③每 entrance 门户 depth≈其 mouthDepth（容差）；④相邻节点深度差有界（剖面平滑·廊道不跳深）。
- **横向不污染深度（焊死本节修正）**：新增断言「把某洞横向拉长（多节点·同深度带）→ 核心深度 / 各入口深度 / 深度分布**不变**」——防回退成 hop-distance（作者 2026-06-25 指出的缺陷）。
- **#114 k / 平廊正交**：k 现为深度密度剖面；横向长度由 sizeScale + 窄 depthRange span 表达（平廊=窄 span+多节点·#115）——深度与横向两参数永不互串。

### §3.4 门户池与可扩展性（机制）
生成步骤（在 `generateMazeMap` 骨架上）：
1. **成树 + 弦边 + 死路**：复用现行 step 1/3（蜿蜒主道 + 环 + 树叶＝天然口位候选）。
2. **选门户池**：树叶 + 低度数节点按树距/深度分散，选出 `entrancePortals` 个**入口门户** + `exitPortals` 个**出口门户** + 1 个**核心**（互不重叠·受保护不接弦破坏度数）。门户按 depth 分桶打 `region: rim/flank/deep`。
3. **赋深度**：§3.3 模型 B（节点自有深度坐标·剖面场）——核心钉 d1、入口钉 mouthDepth、其余按 k 剖面在 [d0,d1] 采样、边倾向连深度相邻节点（**不用 hop 距离**）。
4. **标注**：核心置全图最深（唯一最深）；入口/出口门户 `kind:'ascent_point' + portalKind`；其余节点走现行事件/地标/rest 抽取（buildEventPool(zone)·内容仍是 zone 的）。
5. **corpse/harvest overlay**：**不冻进图**——同现行 `applyHarvestDepletion`/`placeCorpses` 在**加载时**作 post-pass（§4.3），保持「尸体定位 #36」「采尽记账」单一来源不变。

> 门户/核心/深度全部由 `CaveGenParams`（数据）驱动，**生成代码不含任何具体洞的口数/形状字面量**＝§5 可扩展硬要求落成机制。守门见 §7。

---

## §4 生命周期：首次进 vs 再进

### §4.1 下潜入口分流（dive-start.ts）
`startDiveFromPoi` 在现有 `bandId` / `zoneId` 分支前，**先判 `caveEntry`**：

```
if (poi.caveEntry) → startDiveIntoCave(state, poi)         // 新：持久洞路径
elif (poi.bandId)  → diveIntoBand(...)                      // 现有
else               → zone + modifier.depthOffset 普通下潜    // 现有
```

`startDiveIntoCave(state, poi)`：
1. `caveId = poi.caveEntry.caveId`。
2. **load-or-generate**：`cave = profile.caveMaps.get(caveId)`；缺 → `generatePersistentCaveMap(params, makeSeededRng(caveId))` 冻结进 `caveMaps`（首次进 = 生成 + 写存档）。
3. **解析入口节点**（§2.3）→ `startNodeId`。
4. `run = createNewRun({ zoneId: params.zoneId, caveId, ... })`，`run.map = cave.map`，`currentNodeId = startNodeId`，`currentDepth = node.depth`。
5. **应用 overlay**（§4.3）。
6. 起手节点若是 entrance（ascent_point）→ 进 `enterNodeSelection`（同现行非 event 起手）。

> **`run.map` 引用的是 `caveMaps[caveId].map` 的同一对象还是拷贝？** → **加载时深拷贝进 run**（`structuredClone`/JSON round-trip），run 内的「本潜临时态」（visited/scanMemory）不污染存档里的洞；**持久变化**（已探累加、未来的运行时突变）在**回港/出洞结算**时显式写回 `caveMaps`（§4.4）。这样存档里的洞＝稳定真相，run.map＝本潜工作副本。

### §4.2 run 侧最小改动
`RunState` 加一个可选 `caveId?: string`（真条件字段·非洞下潜缺席）。它让结算时知道「这一潜属于哪个洞」，把 explored/harvest 写回正确的 caveId。`createNewRun` 增 `caveId` 形参（同现有 `poiId`）。

### §4.3 加载 overlay（探/采/尸 续上次 · 确定性 · 复用现有 pass）
加载持久图后，按**现有三条 post-pass**叠加（全确定性·零 rng·缺省 no-op）：
- **采（料）**：`applyHarvestDepletion(map, harvestedItemIds, harvestedNodeIds)`——**key 改 caveId**（持久洞的资源空间是「洞」不是「单个口」）：`harvestedItemIds = profile.harvestedResources.get(caveId)`。save 级采尽的资源点在**任何口进**都已采空 ✅。run 级 `harvestedNodes` 仍 by run。
- **尸**：`placeCorpses(...)` 照常（读 `profile.deaths`·#36 定位不变）。已回收（`recovered`）的不再布。
- **已探**：`cave.explored` 里的节点在声呐图/选点 UI **预标「已知」**（§6）。本潜新探的节点出洞时并进 `explored`。

> 三者**都不改 `caveMaps` 里冻结的 map 结构**（map 是稳定真相）；它们是**加载时叠加的视图**。这与现行「确定性重生 + overlay」模型一致——区别只是底图来自存档而非重生。

### §4.4 写回（出洞结算）
- **写回**（生还回港·`handleReturnToPort`·port.ts）：把本潜 `visitedNodeIds` 并进 `caveMaps[caveId].explored`；`harvestedSaveItems` 并进 `harvestedResources[caveId]`（**by caveId**·与现行 by poiId 同套逻辑·只换 key 来源）。死亡**不写**已探/采尽（与现行「生还才落袋」一致）。
- **改洞设计 = 全局 bump 弃档**（作者拍 2026-06-25「不考虑存档兼容」·#99）：开发期改了某洞的 `CaveGenParams`、想让玩家档里那条按旧参数冻结的 `caveMaps[caveId]` 作废 → **直接 bump `SAVE_VERSION` 洗整档**（同既有约定）。**不做单洞版本机制 / 不写迁移**——`PersistentCave` 无 schemaVersion 字段，省码、最可维护。加洞/加口（§2.3/§2.4）不属此列（那是纯加数据·零重生）。

---

## §5 重生 vs 持久 语义（本棒 = 全图持久）

| | **普通持久洞（本棒 T2）** | **深门循环再生洞（T2b·非本棒）** |
|---|---|---|
| 持久粒度 | **全图持久**·再进续上次 | **口部固定段持久·深处随周期重置** |
| 生成次数 | 首次进 1 次·之后加载 | 口部 1 次·深处每月相周期重拼 |
| 口 | 静态多口（POI 绑定） | 动态口（月相开合·随周期出现/消失） |
| 生成路径 | `generatePersistentCaveMap` | 另一套（模板库 + 拼接算法·T2b） |

> 两套**共享** `PersistentCave` 容器与门户/绑定模型（深门的口也是 portal·也走 caveEntry），但**深处生成**是两条独立代码路径。本棒把容器/绑定/可扩展模型立住＝给 T2b 铺好地基（roadmap：T2b 依赖 T2）。

---

## §6 渲染契约（结构先立 · 像素细节后续）

> 本棒**只立契约 + 结构层**（mapLayout/SonarScanPanel 在我车道）；海图侧（chart_pois.json·分组连线）归 T3b。**绿≠画对**（#91/#93）——像素对齐留 dev-server 肉眼，本棒不追。

### §6.1 声呐图 / 选点 UI：同一张图的不同已探片
- 底图 = `run.map`（持久图副本）。
- **已探片**：`cave.explored ∪ run.visitedNodeIds` 的节点渲染为「已知」（实线/常亮）；未探的仍按声呐迷雾（`scanMemory` 余像）/盲航。`deriveMapLayout` 几何**不变**（纯按 depth/dist），只是**已知集**多了一个持久来源。
- **多入口**：你这一潜从哪个口进＝`run.map.startNodeId`；其余入口/出口门户也是 `ascent_point`，渲染同现行上浮口（图上能看到「这洞还有别的通海口」）。

### §6.2 海图：N 个口标成同一个洞（契约给 T3b）
- 同 `caveEntry.caveId` 的多个 POI ⇒ 海图 UI **按 caveId 分组**：同色 / 细连线 / 命名 `<洞名> · <口名>`（如「镜廊 · 北缘口」「镜廊 · 深缘口」），别让玩家当成无关的独立洞口。
- **穿越发现（上游 §5b）**：走到一张图的**出口/对侧入口门户**并上浮 → `setFlag` 揭示对侧口 POI（跨 beacon）。本棒**留接口**（门户带稳定 nodeId·出洞知道从哪个门户出）；实际 setFlag/揭示归 T3b + 内容侧。
- 本棒交付物：`caveEntry` 字段 + 一个**纯函数** `cavePortalsForChart(caveId)`（给 T3b 列同洞的口）+ 文档化分组契约。

---

## §7 可扩展性硬要求 → 机制（守门 · 不靠散文）

按 CLAUDE.md「每加一条约定先问：能不能变成 `npm run regress` 里会失败的检查」，把 §2.3/§5 的解耦落成**脚本门**（新 `scripts/check-cave-bindings.mjs`·并入 regress）：
1. **每条 `caveEntry` 必解析到真实入口门户**：`caveId` 存在；`entryNodeId`（若有）∈ 该洞 `portalKind:'entrance'` 节点；否则 `regionBias` 能选出候选——**悬空绑定 = regress 红**（同 check-dive-refs 焊悬空 band 引用）。
2. **每洞 ≥1 出口门户**（`exitPortals≥1`·从不死胡同·上游 §1）。
3. **核心唯一且最深**（analyzeMap 扩展断言：`deepestNodeIds.length==1 ∧ ==coreNodeId`）。
4. **生成器无字面量口数**：`generatePersistentCaveMap` 只读 `CaveGenParams`——审查 + 测试用两组不同参数生成、断言口数随参数变（防有人把 6 写死）。
5. **加口零重生**：测试「给一个洞已存在 caveMaps 记录，新增一条 caveEntry POI 绑到现成 entrance 门户」→ 断言 `caveMaps[caveId].map` 对象**未变**（同一引用/同 generatedAt）。

---

## §8 与既有 quirk 的关系（总表）

| quirk | 现状 | 本棒怎么处理 |
|---|---|---|
| **#98 同地点同 seed** | seedKey = POI.id·每 POI 一张确定性图 | **推广**到 cave 级：seedKey = caveId·多口共享一张图。单口洞 caveId 可默认取 POI.id ⇒ 与今天一致。 |
| **#92 位置即深度** | depth = 离单一入口树距 | **推广**：depth = 离核心树距（核心锚定·入口无关）；朝核心单调、分支朝浅（同 #114 放行）。单口路径断言原样留。 |
| **#93 渲染（y∝depth·无方向）** | `deriveMapLayout` 入口无关 | **零改动**——本就按绝对 depth·多口不破。已探集多一个持久来源。 |
| **#114/#115 洞型谱 k / 平廊** | k 作用在「离入口 frac」 | 持久洞 k = **深度密度剖面**（哪段深度节点多·洞胖瘦·§3.3 模型 B）；`caveDepthCurveForPlace` 复用。深度/横向正交（#175/#176）·平廊=窄 span+多节点。 |
| **#99 未发布不迁移** | 形状变 bump 弃档 | SAVE_VERSION 9→10 弃旧档；改某个洞的设计＝再 bump 弃整档（**不做单洞迁移/版本机制**·作者拍「不考虑存档兼容」·§4.4）。 |
| **#36 尸体定位 / harvest 记账** | per-dive overlay·by poiId | overlay 照旧；harvest key 换 **caveId**（资源空间是洞）。 |
| **#175 maze 规模认 layerCount** | N≈2×layerCount | `sizeScale` 同义（不读 nodesPerLayer）。 |

---

## §9 实装增量计划（每步过 regress · 结构/存档形状先立）

> 车道现状（cave-bmap）= `mapgen.ts, types/dive.ts, engine/state.ts, engine/dive.ts, SonarScanPanel.tsx, mapLayout.ts`。
> **需并入车道**：`src/types/state.ts`（PlayerProfile.caveMaps + RunState.caveId）、`src/types/chart.ts`（ChartPoi.caveEntry）、`src/data/caves.json`（新·持久洞登记表）、`src/engine/caves.ts`（新·getCave 加载器）、`src/engine/dive-start.ts`（已在 dive.ts barrel？否则补）、`src/engine/port.ts`（写回）、`scripts/check-cave-bindings.mjs`（新）、`scenarios/persistent_cave_*`（新 baseline）。cave-temp（types/temperature.ts）/ cave-chart（**data/chart_pois.json·chart_regions.json**·≠ caves.json）**与这些不相交**·并入安全（psm 重划车道）。

**增量 A — 存档形状（先立·typecheck + save playthrough 绿）**
- 加类型：`PersistentCave`/`CavePortal`/`CaveRegion`（dive.ts）、`PlayerProfile.caveMaps`/`RunState.caveId`（state.ts）、`ChartPoi.caveEntry`（chart.ts）、`DiveNode.portalKind`（dive.ts）。
- `SAVE_VERSION 9→10` + 版本注释；`createInitialProfile` 种 `caveMaps:new Map()`；`hydrateGameState` 补；`createNewRun` 收 `caveId`。
- 序列化无新代码（__map 复用）；加一条 `playthrough-save` 断言 caveMaps round-trip。
- **commit**: `feat(cave): 持久洞存档形状 — caveMaps 容器 + SAVE_VERSION 10`

**增量 B — 多入口生成（mapgen·新 baseline）**
- `generatePersistentCaveMap(params, rng)`：门户池 + 离核心深度 + 入口/出口/核心标注；扩展 `analyzeMap`（入口/出口/核心计数 + 核心唯一最深）。
- 单口旧路径 byte-identical（既有 mapgen scenarios 全绿）；新增 `scenarios/persistent_cave_*` baseline + playthrough-mapgen-scenarios「持久洞」块（§3.3 新不变量）。
- **commit**: `feat(cave): generatePersistentCaveMap 多入口拓扑 + 离核心深度模型`

**增量 C — 绑定 + load-or-generate + 续存**
- `caveEntry` 解析（§2.3）；`startDiveIntoCave`（dive-start）load-or-generate + overlay；`handleReturnToPort` 写回 explored/harvest（by caveId）。
- `scripts/check-cave-bindings.mjs`（§7）入 regress；加一条 playthrough 验「换口进续上次（已探/采尽保留）」。
- **commit**: `feat(cave): POI→入口绑定 + 持久续存（探/采/尸 by caveId）`

**增量 D — 渲染契约（结构层）**
- mapLayout/SonarScanPanel 已探集加持久来源（§6.1）；`cavePortalsForChart` 纯函数 + 分组契约文档（§6.2·给 T3b）。
- **commit**: `feat(cave): 声呐图已探片预亮 + 海图同洞分组契约`

**收尾**：每增量 `npm run regress`（affected 选测·Mac 实跑）；QUIRKS 新增一条（main 合并时写·别在 feature 树碰 append-only 文档）；`psm land cave-bmap`（绿门停下等作者确认）。

---

## §10 非目标 / 后续

- **T2b 深门循环再生洞**：依赖本棒的容器/绑定模型；月相时钟 + 模板库拼接 + 口部固定段 = 另一套生成路径（§5）。本棒只在 zones.json 留占位、不接 POI。
- **T3b 跨 beacon 多口海图**：消费本棒的 `caveEntry` + `cavePortalsForChart` + 穿越发现接口；把副口/深门 6 口铺进 chart_pois.json。
- **T4 温度门控**：消费本棒的 `caveEntry.entranceBlocked`（封口＝不可达入口）。若 cave-temp 并发，约定好 `entranceBlocked` 由谁写（建议：温度侧表派生·不进 caveEntry 静态数据）。
- **运行时地图突变**（水流/坍塌/潮汐淹没/光路改变）：本棒把图实体化进存档＝给这些机制铺底座；具体机制远期各自专项。

---

## §11 决策记录

> **总纲（作者拍 2026-06-25）**：以**未来可拓展性 + 可维护性**优先；**不考虑存档兼容**（#99·改坏就 bump 洗档）。下列取舍据此定。

1. **存图 vs 仅确定性重生**：选**存图**（§0 理由：可变底座 + 上游 §5 明确要求「一张图入存档」）。代价＝存档变大（一洞 ~10–60 节点·可接受）+ SAVE_VERSION bump。
2. **持久态放哪**：选 `profile.caveMaps`（profile 级·跨 run）。harvest 复用 `harvestedResources`（换 caveId key）·explored 放 `PersistentCave`。**备选**：全塞进 `PersistentCave`（harvest 也搬进来）——更内聚但要改 applyHarvestDepletion 取数源·**暂不**（复用现有管道更省 churn·见 [[correctness-over-minimal]] 别撕已测机制）。
3. **入口/出口用新 NodeKind 还是标注**：选**薄标注 `portalKind`**（§2.2 理由：行为与 ascent_point 全同·避免触动所有既有 kind 判据）。
4. **深度模型**（作者 2026-06-25 拍）：选**节点自有深度坐标（剖面场·模型 B）**——深度是采样坐标、不从 hop 派生（避免横向距离被算成深度·作者指出 hop-distance 缺陷）；核心钉 d1、入口钉 mouthDepth、k=深度密度剖面；连通性沿用现 maze 骨架（加法·不撕已测）。**最贴合声呐图**（声呐图本就是深度剖面）。**弃案**：离核心树距（hop 串横向与深度）。
5. **run.map = 副本 vs 引用 caveMaps**：选**加载时深拷贝进 run·结算写回**（§4.1·存档里的洞＝稳定真相·本潜临时态不污染）。
6. **洞数据放哪**（作者 2026-06-25 拍）：**独立 `src/data/caves.json`**（持久洞登记表）+ `engine/caves.ts` 加载器——不扩 zones.json（洞与 zone 解耦·可维护优先）。
7. **改洞设计的存档处理**（作者 2026-06-25 拍）：**全局 bump SAVE_VERSION 洗档**，不做单洞 schemaVersion / 迁移（§4.4·不考虑存档兼容·#99）。
8. **caveId 命名**（作者 2026-06-25 拍）：**独立命名空间 `cave.<短名>`**，不与 zoneId 1:1 绑定（跨 beacon 洞有独立身份·可拓展优先）。
9. **仍占位（留最后调·`defer-number-tuning`）**：口数/深度/门户数（§3.2）。

