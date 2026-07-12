# 深海回响 · 地图渲染补全 SPEC（形状多样性回收）

> 状态：**v2（2026-06-27）· P1+P2+POI 已落地（沙箱全绿·待 Mac build/nightly）**——布局风格框架 + 横向渲染 + 宽洞 POI 增量已实装（见 quirk #196）；P3 部分（serpentine/radial/spiral 布局已可视化·镜廊真·对称欺骗 + 蜂巢真·网状拓扑仍待）。下方诊断/分层现状保留作参考。
> **已落地**：`LayoutStyle`（vertical/horizontal/serpentine/radial/spiral）· `deriveMapLayout` 策略分派（vertical byte-identical·其余 `normalize` 保证不裁切）· mapgen 盖章 `DiveMap.layoutStyle` + `nodeCountMultiplier`（非竖向 ×3 POI）· MapDevPanel 风格下拉 + `CAVE_GEOM_MARGIN` 接入 · 8 zone 配 layoutStyle。
> 真相源上游：渲染管线＝`src/ui/mapLayout.ts`（单一来源）；形状数据＝`src/data/zones.json`；朝向/深度赋值＝`src/engine/mapgen.ts`。
> 关联 quirk：#92「位置即深度·垂直化」· #98「同地点同 seed」· #100「洞穴一致性」· #114/#115「洞型谱/平廊」· #176「orientation 横向」· #95「engine ↛ ui 边界」· #99「未发布不写迁移」。
> 关联 SPEC：`cave_zones_spec.md`（设计章·形状清单）· `深海回响_多口持久洞_SPEC.md`（T2/T2b）· `cave_roadmap.md`（排期）。

---

## 0. 问题陈述（为什么「只剩竖的了」）

Demo 期作者被展示过**多种地图视觉风格**；早期那版洞穴图（节点图 / 分叉那套）在 **#92「垂直化」+ 声呐渲染重做**时被统一成「有机洞穴竖剖面」。`mapLayout.ts` 注释仍留着「大改前那张洞穴图」的指代。

收敛的结果：**形状多样性现在几乎只活在数据参数里（`depthRange` / `depthCurveRange` / `layerCount` / `orientation`），而渲染层只有一种空间模式——「深度＝竖轴」。** 所有 ~28 个迷宫 zone 都过同一个生成器（`generateMazeMap`）+ 同一个渲染器（`deriveMapLayout`），所以视觉上一律拍平成竖向。

这不是设计意图丢失，而是**渲染器是单一瓶颈**：它只把一条轴（深度）映射到空间，其余「形状语义」（横向延展、盘绕、对称、多口几何）没有对应的画法。

本 SPEC 的目标：把「形状」从纯数值参数，逐步还原成**可视的、数据驱动的布局策略**，且**不破坏现有竖向路径**（加法扩展，别撕已测机制）。

---

## 1. 分层现状（数据 / 引擎 / 渲染 三层 status）

按「风格轴」而非单个 zone 列（34 个 zone 是这些轴的参数组合，全表见 §1.2）：

| 风格轴 | 数据已有 | 引擎已有 | 渲染已有 | 缺口 |
|---|---|---|---|---|
| **层状开阔水域**（layered DAG·礁/沉船/中层/鲸落） | ✓ 5 zone | ✓ `generateLayeredMap` | ◐ 回退节点图/黑底·**无洞穴皮** | 开阔水域专属背景（声呐重做 §2 留的坑） |
| **竖向迷宫 + 洞型谱**（k 曲线：井+廊/匀速/廊+坑） | ✓ ~27 zone | ✓ `generateMazeMap` + `resolveDepthCurve`(#114) | ✓ **唯一完整工作的一支** | 仅 dev 概览左右裁切（§3 Gap A） |
| **横向廊**（orientation=horizontal·威胁轴＝回程） | ✓ 1 zone（`horizontal_test`） | ✓ #176 深度锁带 | ✗ **塌成竖向散点** | `deriveMapLayout` 无 orientation 分支（§3 Gap B） |
| **蛇行 / 盘绕**（serpentine·难辨来路） | ✓ `serpentine_deep` | ◐ 连通性在·无「盘绕」布局语义 | ✗ 与普通竖迷宫同画 | 路径跟随式布局策略（§3 Gap C） |
| **镜廊 / 对称欺骗**（mirror·假对称水道） | ✓ `mirror_maze` | ✗ 无对称生成 | ✗ 纯 fiction 文案 | 对称几何 + 欺骗渲染（§3 Gap C·与「越深越欺骗」轴合流） |
| **蜂巢 / 网状**（honeycomb·塌陷火口/蜂房洞） | ✓ 2 zone | ✗ 无网状生成 | ✗ 纯 fiction 文案 | 网状拓扑 + 布局（§3 Gap C） |
| **多口持久洞**（一洞多入口·跨 beacon·状态留存） | ✓ 数据模型（SAVE 9→10） | ✓ **T2 已落 main**（`d4bde53`） | ◐ 声呐渲染当前 run·持久是 state 非 render | 多口几何在图上的空间关系仍靠兄弟摊开 |
| **深门「会呼吸的洞」**（月相开合·模板拼接·口固定深处重置） | ◐ 占位 zone（lc 70） | ✗ **T2b 未做·最后期** | ✗ | 整套循环再生路径（**本 SPEC 不含·只留指针**） |

图例：✓ 已有 · ◐ 部分 · ✗ 缺。

### 1.1 一句话总结
**「竖向迷宫 + 洞型谱」是唯一渲染闭环的一支**；横向引擎做了但没画法；蛇行/镜廊/蜂巢只到 fiction + 数据；深门整套未做。作者 demo 记忆里的多样性，现在＝「一个竖向渲染器 + 一堆数值参数」。

### 1.2 zone × 形状参数全表（34 zone·实测自 zones.json）
- **layered（5）**：东礁 / 旧灯塔礁 / 远洋中层 / 塌架墓园 / 鲸落。
- **maze·vertical（28）**：蓝洞群·海沟热液场·竖穴裂缝·蜂房洞·漫水回廊·礁穴·潮缝·藻洞·锚坑·石缝·浪涌穴·舱格·淤积凹室·暗礁巷·沉井·月池穴·骨道·沙瀑洞·蓝喉·热水窟·沉拱厅·熔管岔道·浑水廊·黑水盆·蛇行深处·塌陷火口·镜廊·深门。
- **maze·horizontal（1）**：横向测试廊（唯一 `orientation:'horizontal'`）。
- 区别全在 `depthRange`（多深/几带）、`depthCurveRange`（k＝落差在行程哪段）、`layerCount`（多长）——**没有一项改变铺点几何**。

---

## 2. 渲染管线现状（改这里＝改全部）

**单一来源：`src/ui/mapLayout.ts::deriveMapLayout(map, opts)`**，确定性纯函数（只依赖 map 结构 + `node.depth` + id 排序·不碰 RNG）：

- **纵轴 y ∝ `node.depth`**（真实米数·上浅下深·#92）·固定 `pxPerMeter`。
- **横轴 x ＝同一 `node.layer`（到入口树距）组内按 id 居中排开**——**注意：layer 只用于「分组兄弟」，其编号不映射到任何空间坐标**。这就是为什么「进来多远」这条轴在图上不可见。
- 竖向迷宫能看是因为 depth 随 layer 单调增（巧合地让 y 表达了进度）；横向洞 depth 锁带 → y 不动、x 只剩兄弟宽 → 塌成又矮又窄的散点。

**消费者（全部依赖上面的坐标·改布局要一起验）：**
- `ui/dev/MapDevPanel.tsx`——全图概览（烤整张洞穴 RGBA·见 Gap A）。
- `ui/SonarScanPanel.tsx`——游戏内取景窗（220×300·相机夹在「扫过区域包围盒」内）+ `buildCaveGeometry`/`bakeCaveRGBA`（有机洞穴 SDF·#100 单一来源）+ 猎手 blip 路由 `edgeRoutePts`/`stalkerRoutePoint`（#116·红点必须落在画出来的水道里）。
- 全仓搜 `orientation`：**渲染端一处都没读**（只有 `mapgen.ts` 用它分流深度）。⇒ 渲染器实际只有「深度＝竖轴」一种空间。

**边界（#95·engine ↛ ui）**：深度/拓扑赋值留在 `engine/mapgen`；铺点几何在 `ui/mapLayout`。补全要守这条——布局策略放 ui、形状声明（数据）放 zones.json、深度语义放 engine。

---

## 3. 三条 gap + 补全方案（分阶段·加法不撕）

### Gap A — MapDevPanel 全图左右被裁切（dev-only·cosmetic）
**根因**：烤洞穴的取景框宽度＝`caveLayout.width`＝节点中心包围盒 + `padX=30`，但有机洞穴几何会鼓出这个框（房间半径 `ROOM_BASE+ROOM_VAR=33` + 散瓣 + 域扭曲 `WARP_AMP=14` + 噪声）。最外侧列节点离边缘只 30px → 房间探到负坐标 → canvas 裁掉两侧洞壁。游戏内取景窗是移动相机、看不到全图边缘，故只在 dev 概览暴露。
**修法（机制化）**：从 `SonarScanPanel` 导出一个 `CAVE_LATERAL_MARGIN` 常量（按几何旋钮派生：`ROOM_BASE+ROOM_VAR+WARP_AMP+噪声 ≈ 50`·**单一来源**·免与旋钮漂移）；`MapDevPanel` 烤图 rect 四周加这圈 margin、canvas/overlay 尺寸同步放大。
**风险**：极低（仅 dev 面板·不碰游戏渲染/存档）。**model/effort：Sonnet / Low。**

### Gap B — 横向洞没有横向画法（orientation 塌成竖向）
**根因**：`deriveMapLayout` 无 orientation 分支。
**修法（机制化·守竖向逐字节不变）**：给 `deriveMapLayout` 加 `orientation` 入参（从 `zone.orientation` 传入·缺省 `'vertical'` 走原式·**默认路径逐字节复现旧图**）。`'horizontal'` 分支：**主轴 ＝ layer（树距）映射到 X**（进来多远＝横向距离），**深度退成 Y 上的小幅抖动 + 同 layer 兄弟纵向错开**。取景窗 `clampViewToBox`、`MapDevPanel` 概览、猎手 blip 路由都读同一 `MapLayout.pos` → 自动跟随，无需各改。
**配套**：`SonarScanPanel` 取景窗目前是纵高窗（`VIEW_W<VIEW_H`）——横向洞要么转成横宽窗（按 orientation 选 `VIEW_W/VIEW_H`），要么靠既有 `frameAspect` 全框显示自适应（已实装·优先复用）。
**回归**：新增 `scenarios/mapgen/` 横向 baseline；断言横向图 `width > height`（与竖向相反）且 `analyzeMap` 不变量仍全绿。
**风险**：中（碰共享 `mapLayout` + 取景窗）。**model/effort：Opus / Medium。**

### Gap C — 无「按 archetype 的布局策略」（蛇行/镜廊/蜂巢全同画）
**根因**：只有一种铺点函数；形状语义（盘绕/对称/网状）没有几何表达。
**修法（机制化·策略表）**：引入 `LayoutStyle`（数据驱动·zone 声明 `layoutStyle?: 'vertical'|'horizontal'|'serpentine'|'ring'|'spiral'|...`），`deriveMapLayout` 按 style 分派到一组**确定性纯函数**（每个 style 一个·签名同 `(map, opts) => MapLayout`·守 #98/#100 同地同图）。先落最高性价比的两三种（serpentine 路径跟随、ring/spiral），镜廊/蜂巢的「对称/网状」需 mapgen 侧也出对应拓扑（引擎 + 渲染双补·排在后）。
**注意**：镜廊的「假对称」本质是**欺骗轴**（合「越深越欺骗」北极星）——它不只是布局，是「图上看到的≠实际连通」，应与 `clarity`（声呐欺骗单一来源·#107/#10）合流设计，别做成纯几何。
**风险**：较高（新增策略表 + 部分要碰 mapgen 拓扑）。**model/effort：Opus / High（按 style 切片·见 §5 并行）。**

### 非目标（划走）
- **深门「会呼吸的洞」（T2b）**：月相开合 / 模板库拼接 / 口固定深处重置——整套循环再生路径，**不在本 SPEC**（见 `多口持久洞_SPEC.md §10` + `cave_roadmap.md`）。
- **存档/持久化变更**：本 SPEC 只动渲染（ui）+ 可选的 orientation/style 数据声明；不碰 `SAVE_VERSION`（纯加可选字段·`?? 默认`兜底·#99）。

---

## 4. 机制化约定（别让这些约定随 session 丢·CLAUDE.md）

1. **布局只有一个来源**：所有「在哪画」走 `deriveMapLayout`；消费者（MapDevPanel/SonarScanPanel/blip）不得自铺点（#116 红线）。
2. **横向 margin 单一来源**：`CAVE_LATERAL_MARGIN` 从 `SonarScanPanel` 导出·烤图侧引用·别各写各的。
3. **每种 LayoutStyle ＝确定性纯函数**：同 seed/同地点同图（#98/#100）·可单测·零 RNG。
4. **竖向是缺省、必须逐字节稳定**：新分支只在显式 `orientation/layoutStyle ≠ vertical` 时生效；所有不传的脚本/回归路径不受影响（仿 #114「无 seedKey → k=1 复现旧图」）。
5. **engine ↛ ui 不破**（#95）：深度/拓扑在 engine、几何在 ui、形状声明在数据。
6. **回归门**：`scenarios/mapgen/` 每新增 orientation/style 配一条 baseline；形状回归信号沿用 `analyzeMap`（横向→`width>height`；竖向 `meanDepthFrac` 不变）。能落成 `npm run regress` 里会失败的检查的，就别只写进文档。

---

## 5. 排期 + model/effort + 并行计划

| 阶段 | 内容 | 依赖 | model / effort | 并行性 |
|---|---|---|---|---|
| **P1** | Gap A（dev 裁切 margin·单一来源常量） | 无 | **Sonnet / Low** | 独立·随时可做 |
| **P2** | Gap B（orientation 渲染分支 + 横向 baseline） | 无（与 P1 不冲突·都碰 mapLayout 则串行整合） | **Opus / Medium** | 与 P1 文件相邻·建议先 P1 后 P2 或同人做 |
| **P3a** | LayoutStyle 策略表骨架 + serpentine/ring | P2（共用 orientation 分派点） | **Opus / High** | — |
| **P3b** | 镜廊对称欺骗（mapgen 拓扑 + clarity 合流） | P3a + clarity | **Opus / High** | 与 P3a 串（同碰 mapgen/clarity） |
| **P3c** | 蜂巢/网状拓扑 + 布局 | P3a | **Opus / High** | 可与 P3b 并行（不同 style 切片·不同 zone baseline） |

**并行说明**：P1 与 P3c 文件基本不相交（dev 面板 vs mapgen 网状 + 新 style 函数），可用 `psm` 开两条车道并行（车道：`src/ui/dev/**`+`SonarScanPanel` margin 导出 vs `engine/mapgen.ts`+新 layout style 函数）。**P2/P3a 都改 `mapLayout.ts` 核心分派点 → 必须串行**（先 P2 落 orientation 分支，P3a 在其上扩 style 表）。append-only 文档（CHANGELOG/QUIRKS）只在 main 整合时写（#130）。

**建议起手**：P1（立竿见影·修掉作者当前看到的裁切）→ P2（把横向真正画出来·验证「形状=布局策略」这条路走得通）→ 再评估 P3 各 style 的优先级（蛇行/镜廊哪个先，作者拍）。

---

## 6. 验收信号
- **竖向不回归**：现有 `scenarios/mapgen/` + `playthrough-*` baseline 全绿（逐字节）。
- **横向真横**：`horizontal_test` 渲染 `width > height`，取景窗横向铺开，blip 仍落水道内。
- **dev 不裁切**：MapDevPanel 全图最外侧洞壁完整（目视 + 可加「几何包围盒 ⊆ 画布 rect」断言）。
- **每新 style**：配 baseline + `analyzeMap` 不变量全绿 + 线上 `?editor=map` 目视（绿≠画对·#91/#93）。

---

## 7. 参考锚点
- 渲染：`src/ui/mapLayout.ts` · `src/ui/SonarScanPanel.tsx` · `src/ui/dev/MapDevPanel.tsx`
- 生成：`src/engine/mapgen.ts`（`generateMazeMap` 步 4 深度赋值·`resolveDepthCurve`·`isHorizontal`）· `src/types/dive.ts`（`mapShape`/`orientation`/`depthCurveRange`）
- 数据：`src/data/zones.json`（34 zone·§1.2）
- 设计/排期：`cave_zones_spec.md` §5（形状清单）· `深海回响_多口持久洞_SPEC.md`（T2/T2b）· `cave_roadmap.md`
- quirk：#92 · #98 · #100 · #114 · #115 · #176 · #95 · #99 · #116（`docs/QUIRKS.md`）
