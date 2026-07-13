# 深海回响 · 开阔水域（声呐渲染 + mapgen）SPEC

> 来源：2026-07-12/13 Cowork 交互 session（Opus）设计 + look-dev 验证。**本 SPEC 定架构与机制，不定具体像素手感**（形状数值一律留到进引擎后对着真渲染器调·见 §9）。
> 关系：这是根 `NEXT_SESSION_PROMPT.md` 待办 **#1「重写主线 + 开放水域内容」** 的 *渲染+mapgen 机制* 底座——作者定地理/章节（WHAT），本 SPEC 定开阔水域怎么生成怎么渲染（HOW）。白板后当前**零开阔 zone**（4 个已删）、`isOpenWater` 声呐分支是空占位（留白待填·SonarScanPanel §9 头注）。

---

## 0. 北极星

开阔水域是与洞穴并列的一类地图：**大部分没有墙**，一般最底下有海床（少数情况侧面也有），海床带声呐图、分几种风格（沙 / 珊瑚 / 岩矿），未来可链接某个洞穴。**必须继承现有声呐的观感**——不是第二套渲染（否则风格漂移）。

一句话架构：**开阔水域 SDF ＝ 边缘型海床 floor（到海床 contour 的有符号距离）∪ 结构层（珊瑚/岩石等坐在海床上的离散 2D 结构），两者 union，喂进与洞穴共享的同一段上色 `shadeSonarSdf`。**

---

## 1. 三条方向结论（本 session 作者拍板）

1. **移动模型＝渲染换皮为主**：复用现有层状 DAG 拓扑（`mapgen-layered.ts`·注释已叫「开阔海域」·单向下潜 + 自由上浮）。引擎拓扑几乎不动，新工作集中在渲染层。节点图保持**无坐标**（只有 depth 一个空间轴·X 渲染时派生）。
2. **海床风格＝视觉 + 内容池**：风格挂在节点 `zoneTag` 上，一物两用——既选声呐形态（contour + 结构层），又偏置**事件/材质池**（岩矿→含 `mine`-gated 矿物掉落 / 珊瑚→organic 采集 / 沙→埋藏·钻沙）。复用现有 `zoneTag→事件池` 缝 + `MaterialRole`，**不新增地形材质系统**。MVP 一图单 tag；因绑在 `zoneTag`，将来一图混多块 patch 免费。
3. **捕食者＝偶尔 1 只·必须应战·上浮更易**：开阔水域没掩体→不能像洞穴躲窄缝→遇敌即「打或直接上浮」。复用 `combat-exit-semantics`：开阔水走 `beginAscent`（上浮口·零成本任意回合）当唯一退路，`huntEnabled` 偶尔打开即可，**不加新猎手系统**。洞穴＝attrition 躲藏 / 开阔＝暴露强战 + 随时撤，是一组对称。

---

## 2. 渲染架构（核心·look-dev 已验证）

### 2.1 边缘型 floor（不是洞穴的并集基元）
- 洞穴用「并集填充」（`caveSdf`＝隧道胶囊 + 房间 blob 的 smin 并集·适合被岩石包住的水道）。**开阔水域用「边缘」**：海床是一条**单值 contour**（heightfield/polyline），SDF＝到该 contour 的**有符号垂直/最近距离**，contour 之上为水（负）、之下为岩（正）。
- `openWaterSdf` 是 `caveSdf` 的**兄弟**，不是它的补丁。单值 heightfield → 结构上不可能出现「悬空」碎片（早期用胶囊填开阔水域会留碎片·就是抽象用错了）。
- **图底关系（与洞穴相反）**：水是**背景**，铺满取景窗上方；黑（透明岩）只在**海床下方**和**稀有的侧壁之后**。开阔水域绝大多数只有底面 floor、**没有侧墙**（侧墙是稀有变体·对应「有些可能也是侧面」）。
- 侧壁/连洞穴口＝把 floor contour 在某侧抬起成墙（见 §6）。

### 2.2 结构层（珊瑚/岩石＝坐在海床上的离散结构）
- 海床上的离散物体是**真 2D 结构**（可外伸/成簇·heightfield 表达不了），作为 union 叠加到 floor 上：
  - `structureField(p)`＝正值在任一结构内部、~0 在边界、负值在外。基元：胶囊 `r - distToSeg`、圆盘 `r - dist`、不规则多边形石球 `Rinterp(θ) - dist`。多结构 `np.maximum` 求并。
  - **合成：`d = max(floorWaterSdf, structureField)`**（floorWaterSdf＝负在水/正在岩）→ 一个像素是岩当且仅当「在海床下」或「在任一结构内」，否则是水。
- 三档风格的结构：
  - **沙**：无结构（只有 floor）。
  - **珊瑚**：低矮、致密、连成一片的礁——许多**小簇绒毛状软珊瑚扇/花束**（无光杆·从基部即散开）+ 圆钝小瘤 + 小圆顶 + 气泡簇。**不是树**。
  - **岩矿**：中等、圆滑的大礁石（几枚大圆盘并成圆钝丘·非嶙峋非尖刺）+ 块间留缝 + 偶带拱洞（双腿 + 顶横梁的倒 U·内缝＝拱）。
- 结构连在 floor 上→不悬空。

### 2.3 共享上色 `shadeSonarSdf`（防飘的机制根·唯一对老代码的动作）
- 把 `bakeCaveRGBA` 里那段 **SDF→RGBA 三档上色**抽成共享函数 `shadeSonarSdf(d, deepK, tex) -> rgba`，`caveSdf`（并集）与 `openWaterSdf`（边缘+结构）**都调它**。风格从**唯一一段码**继承·画不出第二种风格。**提取、不复制**（复制＝又一套实现＝会漂）。抽取后洞穴渲染必须 byte-identical（regress + 截图 baseline 守）。
- 现行确切三档（自 `src/ui/SonarScanPanel.tsx::bakeCaveRGBA`·常量在 `src/engine/sonarGeometry.ts`）：
  - `WALL_LO = -2`，`WALL_HI = 2.2`；`deepK = clamp((wy-rect.y)/rect.h, 0, 1)`；`tex = fbm 值噪声 [0,1]`。
  - 水（`d < WALL_LO`）：`R=14+16·tex`，`G=120-50·deepK+40·tex`，`B=140-30·deepK+30·tex`，`A=235`。
  - 岩壁发光带（`WALL_LO ≤ d < WALL_HI`）：`R=110+40·tex`，`G=230`，`B=215`，`A=255`。
  - 岩石（`d ≥ WALL_HI`）：`A=0` 透明（露出面板暗底 `#0a1018`）。
- **结构层深色版（作者定）**：结构就是岩→透明深芯 + 青边；**细结构**（珊瑚细枝·半宽 < `WALL_HI`）整根落在发光带→呈实心青线。粗结构（圆顶/石球）＝暗芯 + 青边。→ 珊瑚＝「亮丛 + 暗块」并存（贴软/硬珊瑚共存），岩石＝暗芯圆钝块 + 青边。（曾试过把结构整体填浅色·作者否掉·回深色。）

### 2.4 域扭曲/噪声（开阔水域用**独立几何旋钮**·作者 2026-07-13 定）
- **开阔水域的所有形状参数一律独立**，不借洞穴共享的几何常量（`WARP_AMP`/`WARP_FREQ`/`SMIN_K`/`caveWarp`——那些是 `caveSdf` 在用的）。给开阔水域自己一套 warp/noise/contour/结构旋钮（放 `engine/openWaterGeometry.ts` 或独立常量块）。→ **调开阔水域形状绝不牵动洞穴**；唯一共享的是配色 `shadeSonarSdf`（§2.3），不碰它洞穴就固定。
- edge floor 上少加或不加 SDF 层噪声（避免平顶长边缘零星青点/悬空错觉）；contour 微起伏用**开阔水域自己的**单值函数（sin/fbm）→ 仍单值·不碎。

---

## 3. 拓扑（engine·几乎不动）

- 复用 `generateDiveMap`（`mapgen.ts` 按 `zone.mapShape` 分派）→ 层状 DAG（`mapgen-layered.ts`）。可加一个 `mapShape:'openwater'` 薄壳（多半 delegate 给 layered），或直接复用 layered·实装时定。
- 节点图保持**无坐标**（`DiveNode` 只 `depth`）。渲染时 `deriveMapLayout` 派生 2D（Y=真实深度·`mapLayout.ts`）。
- **海床 contour 由节点确定性派生**：按「每 X 列最深可达节点」下沿 + 由 `map.zoneId`/节点 id 种子化的风格化起伏（沙 sin / 珊瑚+结构 / 岩+结构）。**派生不入存档·由 id 确定性算 → 声呐诚实、可复现**（守感知重做不变量）。开阔水域＝海床之上一大片水域可漫游。

---

## 4. zoneTag 分档

- 节点 `zoneTag ∈ {sand, coral, rock}`（或既有 tag 词汇里挑）→ 同时决定：① contour 形态；② 结构层类型；③ 事件/材质池。单一真相。
- 岩矿档事件池含 `capability:'mine'`-gated 矿物掉落（复用现有采矿·`items.json` 岩凿 grants `mine`），**不做地形采矿**。
- MVP：一 zone 单 tag（整片沙/珊瑚/岩）。把海床建成「带 tag 的分段」→ 将来一图混多块 patch 只是「不同段不同 tag」·不改结构。

---

## 5. 形态目标（来自真实参考·数值留后调）

（仅定「像什么」·具体波长/密度/尺寸/拱形进引擎调·§9）

- **沙**（参考：沙波纹底）：平滑自然的正弦沙波（圆滑起伏·低幅 ~10–14px 世界·非锯齿），可叠一条更细谐波 + 极缓长起伏。**无海草**。
- **珊瑚**（参考：软硬珊瑚混生礁）：**低矮致密连片**的礁·中等高度（礁脊 ~35–70px）·小簇绒毛软珊瑚（短基 + ±55° 宽扇 5–8 细枝·枝端小绒球·宽≥高）+ 圆钝小瘤 + 小圆顶 + 气泡簇·密排略叠。**别做高瘦光杆的「树」**。
- **岩矿**（参考：火山圆钝礁岩 + 拱洞）：中等、圆滑的大礁石（几枚大圆盘并成圆钝丘·少量周边小瘤·非craggy）·块间留水缝·一块带**圆顶拱洞**（双腿 + 厚横梁）。别夸张别太高。

> look-dev 复现脚本（本 session·纯 Python/numpy·**用真调色板逐值 + 新边缘 SDF**验证过风格不漂）：`edge_run.py`（floor）→ `edge2_run.py`（结构层 union）→ `edge3_run.py`（深色版 + 多形态）→ `edge4_run.py`（自然/中等收敛版·当前最佳形态参考）。这些是**离线示意**·实装是 TS 进引擎；但形态/参数可照抄起步。关键结构层参数（edge4）：软珊瑚扇＝短基3.5–5 + 5–8 枝(±55°,r2.0)各分1次(r1.3)+枝端2–3圆盘(r~2)；岩丘＝height·0.78 主盘 + 侧盘并成圆钝；拱＝双腿胶囊 + 顶横梁 + 内角小圆角。

---

## 6. 连洞穴 / 侧壁（future·别现在建·别堵死）

- 侧壁＝floor contour 某侧 smoothstep 抬起成墙（其后为黑岩）。
- 连洞穴＝复用现有 **portal + `traversalFlag`**（`DiveNode.portalKind`·`CaveGenParams`·`caves.json`）：开阔图放一个够深、能当 entrance portal 的节点；上浮/穿越置 flag 揭示对口 chart POI。现在只**别堵死**（拓扑允许一个深节点带 portal）。

---

## 7. 防飘 / 验收（落成机制·不是靠打包票）

1. **同一段上色**：`caveSdf` 与 `openWaterSdf` 都调 `shadeSonarSdf`（提取后洞穴 byte-identical）。这是防飘的根。
2. **截图回归**：加一张开阔水域 sonar baseline 进 `screenshots/baseline` → 任何漂移变成 `screenshots/diff` 门失败项。抽 `shadeSonarSdf` 后先确认洞穴 baseline 不变（守 quirk #100 洞穴一致性）。
3. **mapgen 场景 baseline**：新开阔水域生成器配一条 `scenarios/mapgen/*.json` + `playthrough-mapgen-scenarios`（`analyzeMap` 结构不变量）。
4. **边界/预算**：新生成器进 `engine/mapgen-openwater.ts`（自成文件·守 900 行 `check-file-budget`）；纯几何/上色可放 `sonarGeometry.ts`（engine）或随现有「SDF 本体在 ui」的既有例外放 ui（`check-boundaries` engine↛ui·`caveSdf/bakeCaveRGBA` 现就在 ui·见 `sonarGeometry.ts` 头注·实装时定放哪·倾向：纯 `openWaterSdf`+`shadeSonarSdf` 放 engine 更干净、由 ui 调）。

---

## 8. 实装计划 + 并行 + 模型/effort

- **Phase 1 ✅ DONE（2026-07-13·未提交·未 push）**：`shadeSonarSdf(out,i,d,deepK,tex)`（就地写·无分配）抽进 `engine/sonarGeometry.ts`，`bakeCaveRGBA` 改调它。**沙箱验 byte-identical**（合成洞穴 before/after sha256 相同·0 字节差）+ `regress:quick` typecheck 绿。改 2 文件：`sonarGeometry.ts`（加函数）+ `SonarScanPanel.tsx`（调用 + import·顺手删已无用的 `WALL_HI` import〔`noUnusedLocals`〕）。**待 Mac 全量 regress（截图 diff + prod build）+ commit。**
- **Phase 2（渲染）**：`openWaterSdf`（边缘 floor + 结构层 union）+ 一个 open-water bake 路径喂进 `SonarScanPanel` 的 `isOpenWater` 空占位分支（现 `cave={tuns:[],rooms:[]}`·SonarScanPanel §9）。→ *Opus / high* + 截图 harness 迭代（[[blue-cowork-ui-shoot]]）。
- **Phase 3（拓扑）**：`mapShape:'openwater'` 生成器 + 海床 contour 由节点派生 + `zoneTag` 三档。→ *Opus / medium*。
- **Phase 4（内容/验收）**：一个 QA 开阔 zone（配合作者 #1 地理骨架）+ baselines（mapgen 场景 + 截图）+ regress 全绿。→ *Sonnet 或 Opus / medium*。
- **并行**：Phase 1 必须先落（共享上色契约）。之后 **Phase 2（渲染）与 Phase 3（拓扑）可分两条 psm 车道并行**（共享「map→海床 contour」契约·先把契约定死）。用 `node scripts/psm.mjs start openwater-render --lane 'src/ui/**,src/engine/sonar*'` / `openwater-topo --lane 'src/engine/mapgen*,src/data/**'` 之类不重叠车道。
- **代码 vs work**：全是 code（进引擎实装）；数值手感调是 work（对着真渲染器·§9）。

---

## 9. 数值 / 手感（一律 defer·作者准则 [[defer-number-tuning]]）

所有形状参数——沙波幅度/波长、珊瑚礁密度/高度/枝数、岩石尺寸/圆度/拱形、侧壁频率、结构青边阈值——**进引擎后一次性对着真渲染器调**。别在离线 mockup 上无限追照片：剪影单色风格能到的自然度就到 §5 那档，更细的必须 in-engine。

---

## 10. 当前仓接口 / 协同

- `isOpenWater = !zoneAllowsBacktrack(zoneId)`（`SonarScanPanel.tsx:~613`）；空占位 bake 分支 `~686`（`cave={tuns:[],rooms:[]}`）＝Phase 2 要填的缝。
- `caveSdf`（`~225`）/ `bakeCaveRGBA`（`~455`）均 export·纯·无 DOM（headless 可跑·本 session 靠这个验证过）。
- 层状 DAG＝`mapgen-layered.ts`（已「开阔海域」）；`generateDiveMap` 按 `mapShape` 分派（`mapgen.ts:~91`）。
- 白板后**零开阔 zone**（4 个已删）·`depth_columns` 系统已移出主线（在 worktree）·所以本 SPEC 建**机制**，世界投放等作者 #1 地理骨架落定再接。
- **协同**：勿碰 `NEXT_SESSION_PROMPT.md` 里未提交的 regionId lane（`dive.ts`/`chart.ts`/`MapDevPanel.tsx`·作者留其自收尾）；本 SPEC 实装主要触 `SonarScanPanel.tsx` + 新 `engine/` 文件·与 regionId lane 基本不冲突·各自单 commit。
- 沙箱约束：commit/push + 含 prod build 的全量 regress 留 Mac/nightly（[[blue_regress_sandbox]] / [[sandbox_git_commit]]）。
