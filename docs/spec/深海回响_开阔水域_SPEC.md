# 深海回响 · 开阔水域（声呐渲染 + mapgen）SPEC

> 来源：2026-07-12/13 Cowork 交互 session（Opus）设计 + look-dev 验证。**本 SPEC 定架构与机制，不定具体像素手感**（形状数值一律留到进引擎后对着真渲染器调·见 §9）。
> 关系：这是根 `HANDOFF.md` 待办 **#1「重写主线 + 开放水域内容」** 的 *渲染+mapgen 机制* 底座——作者定地理/章节（WHAT），本 SPEC 定开阔水域怎么生成怎么渲染（HOW）。白板后当前**零开阔 zone**（4 个已删）、`isOpenWater` 声呐分支是空占位（留白待填·SonarScanPanel §9 头注）。

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
- ~~节点图保持**无坐标**（`DiveNode` 只 `depth`）。渲染时 `deriveMapLayout` 派生 2D（Y=真实深度·`mapLayout.ts`）。~~ **⚠ SUPERSEDED（2026-07-20·地图2D坐标 SPEC）**：mapgen 撒点产真坐标（`DiveNode.x`·米·y≡depth），layered 同批改撒点+Gabriel∪MST（无向·可回头=漫游语义统一·节点 id `node.i`）；`deriveMapLayout` 有 x 直用、无 x 才派生。下两行「海床 contour 由节点派生」不变——真 x 让「每 X 列最深节点」更准。
- **海床 contour 由节点确定性派生**（锚点节点＝`seabedNodeIds`·✅ #307·见 §4a）：按「每 X 列最深可达节点」下沿 + 由 `map.zoneId`/节点 id 种子化的风格化起伏（沙 sin / 珊瑚+结构 / 岩+结构）。**派生不入存档·由 id 确定性算 → 声呐诚实、可复现**（守感知重做不变量）。开阔水域＝海床之上一大片水域可漫游。

---

## 4. zoneTag 分档 · 贴底节点

> **2026-07-23 两轴化**：开阔水域自本次起从「单轴 zoneTag」拆成**底面轴（zoneTag·本节）× 侧壁轴（§6·新）**两条正交轴。本节 zoneTag 只管**底面**（contour / 结构 / 内容池）；峡谷墙由 §6 `openWaterWall` 正交配置管·**不是**新 zoneTag。二者自由组合（岩壁+沙底 / 无底断崖…·§6.4）。

- 节点 `zoneTag ∈ {sand, coral, rock, atoll}`（**有海床档**·`engine/seabed.ts::isFlooredOpenWaterTag`；`atoll`＝礁石+珊瑚混合档·2026-07-14 因 `reef` 与既有深度带 tag 撞名改用·见 quirk #254）→ 同时决定：① contour 形态；② 结构层类型；③ 事件/材质池。单一真相。
- 岩矿档事件池含 `capability:'mine'`-gated 矿物掉落（复用现有采矿·`items.json` 岩凿 grants `mine`），**不做地形采矿**。
- MVP：一 zone 单 tag（整片沙/珊瑚/岩）。把海床建成「带 tag 的分段」→ 将来一图混多块 patch 只是「不同段不同 tag」·不改结构。

### 4a. 贴底节点机制（`engine/seabed.ts`·✅ 已实装 #307·2026-07-15）

「哪些节点真正到了海床」落成**单一真相** `engine/seabed.ts`——渲染层（锚海床形状）与事件层（贴底专属内容门）**共用同一纯函数**，永不各算一套（守感知诚实/可复现·quirk #255）：

- **`seabedNodeIds(map)`** ＝ **分支终点**（`terminalNodeIds`＝没有更深邻居的节点·下潜到此须掉头/上浮·涵盖真死路 + 全图最深层）**∧** 其 `zoneTag` 是**有海床档**（`isFlooredOpenWaterTag`）。纯拓扑+tag·派生不入存档·确定性。原 `terminalNodeIds` 从 `ui/openWaterRender.ts` **下沉到 engine**，好让 events（engine）能 import 而不破 `engine↛ui`（check-boundaries 规则一）。
- **`midwater`（远洋中层·无底蓝水·锚点③）不在有海床档集** ⇒ 其终点节点不算贴底、渲染层不铺 floor。整图若无贴底节点（`seabedNodeIds().size===0`）＝**纯中层 floorless**（`OwGeom.floored=false`·bake 整窗填水哨兵·别喂空锚点否则退化成一条平海床·quirk #255）。**floorless 复用已有 `midwater` tag**（不新造 floorless tag·免撞 quirk #254「加 tag 前查重名」）。
- **`{kind:'atSeabed'}` Condition**（`types/events.ts` + `events.ts::evalCondition` + `eventScenario.ts::describeCondition` 三处穷举补齐）门控**贴底专属**内容——珊瑚采集 / 矿床 / 海底爬行生物 / 尸体 lore / 巢穴 miniboss 前哨等只在真正到海床的节点出现，**不在悬空中层**。改「哪些档有海床」只动 `FLOORED_OPENWATER_TAGS` 一处（须与渲染层 `openWaterStyleOf` 的档对齐）。
- **验收**：`scripts/playthrough-seabed.ts`（5 组断言·seabedNodeIds/atSeabed/floorless-空集）。渲染层「floorless 画对没画对」(canvas·平海床 vs 全水) regress 盖不住，靠 quirk #255 + 代码注释 + 作者 `?dev&scene=openwater_*` 肉眼验。
- ⏳ **贴底/中层事件 JSON 内容池未写**（当前空池·由 mapgen 兜底·合理）：机制通、投放待作者监督（草案见根 `HANDOFF.md` 待办 #1）。写时过主角 POV / 人名 canon + `check-no-human-assertion` 门·数值 defer。

---

## 5. 形态目标（来自真实参考·数值留后调）

（仅定「像什么」·具体波长/密度/尺寸/拱形进引擎调·§9）

- **沙**（参考：沙波纹底 + 作者波浪形参考图）：平滑自然的**圆滑**波浪（圆滑起伏·低幅 ~10–14px 世界·非锯齿·非尖角），可叠一条更细谐波 + 域扭曲打散间距规则感。**无海草**。（2026-07-13 二轮曾改成「折叠 sin 尖脊」，2026-07-14 三轮核对作者波浪参考图后**撤销**——那版理解错了、见 §5.2；圆滑正弦本来就是对的，只是要叠域扭曲/幅度调制打散「太规则」的观感，不是把曲线本身弄尖）
- **珊瑚**（参考：软硬珊瑚混生礁）：**低矮致密连片**的礁·中等高度（礁脊 ~35–70px）·小簇绒毛软珊瑚（短基 + ±55° 宽扇 5–8 细枝·枝端小绒球·宽≥高）+ 圆钝小瘤 + 小圆顶 + 气泡簇·密排略叠。**别做高瘦光杆的「树」**。
- **岩矿**（参考：火山圆钝礁岩）：中等、圆滑的大礁石（几枚大圆盘并成圆钝丘·少量周边小瘤·非craggy）·块间留水缝。别夸张别太高。~~（原「一块带圆顶拱洞」已删，见 §5.1）~~
- **侧壁 / 峡谷墙**（参考：峡谷 / 海沟横截面·2026-07-23 加）：近垂直岩壁向上（浅）收拢成 V/U 横截面·墙面圆钝微起伏（非尖脊·同 §5.3 防长尖角）·墙后实岩。单侧墙另一侧＝收口缓坡 / 敞向无底蓝水两态（§6.0）。数值 defer §9。

> look-dev 复现脚本（本 session·纯 Python/numpy·**用真调色板逐值 + 新边缘 SDF**验证过风格不漂）：`edge_run.py`（floor）→ `edge2_run.py`（结构层 union）→ `edge3_run.py`（深色版 + 多形态）→ `edge4_run.py`（自然/中等收敛版·当前最佳形态参考）。这些是**离线示意**·实装是 TS 进引擎；但形态/参数可照抄起步。关键结构层参数（edge4）：软珊瑚扇＝短基3.5–5 + 5–8 枝(±55°,r2.0)各分1次(r1.3)+枝端2–3圆盘(r~2)；岩丘＝height·0.78 主盘 + 侧盘并成圆钝；~~拱＝双腿胶囊 + 顶横梁 + 内角小圆角（已删，见 §5.1）~~。

### 5.1 二轮修订（2026-07-13·in-engine 实机截图反馈·非离线 mockup）

Phase 2 落地后拿真实 dev 面板截图给作者看，三处改了 §5 原定形态（`openWaterRender.ts`/`sonarGeometry.ts` 已按此实装）：

1. ~~**沙纹不是正弦**：真实沙纹截面是尖脊窄谷，改「折叠 sin」出尖峰。~~ **已被 §5.2 撤销**——作者给的「波浪形」参考图全是圆滑浑圆的起伏，没有一张是尖角/锯齿；这版理解错了「尖头朝上」的意思（作者原意只是「凸起朝上」，不是「削尖」）。域扭曲（fbm warp wx）本身是对的，保留。
2. **rock 去掉「圆顶拱洞」变体**：双腿+抛物顶的悬空倒 U 视觉上像漂浮的拱门，不像礁石。统一走圆钝礁丘（大圆盘+侧盘）。
3. **海床/结构必须铺满实际渲染范围、不受节点 x 包围盒限制**：结构（rock/coral）撒点改成按取景矩形现算（`structsInRange`），不再由 `buildOpenWaterGeometry` 一次性按节点包围盒预建列表——否则相机/dev 面板画布比节点 x 分布宽时两侧空着没地形。
4. **海床低频形状贴合「分支终点」节点**（不是全部节点——分层图里同一层节点常落在相近 x，若给路过的每个中间节点都强插值会在列间距炸出尖峰，实测过、回退了）：`buildOpenWaterGeometry` 现在收一个可选 `map: DiveMap` 参数，挑出「没有更深邻居」的终点节点（`terminalNodeIds`），用反距离加权（IDW）插值出海床低频形状——分支终点自身 x 处海床贴着它走，不再飘空；没有终点变化的普通层状图退化成一条贴着全图最深层的平面（等价原「单一 baseY」设计）。

以上四点已改 `owFloorY`/`emitRock`/`buildOpenWaterGeometry`/`bakeOpenWaterRGBA`（`openWaterRender.ts`）+ `OW_RIPPLE_*`/`OW_STRUCT_MAX_DROP` 旋钮（`sonarGeometry.ts`）；两个调用方（`SonarScanPanel.tsx`/`MapDevPanel.tsx`）改传 `map`。数值仍是起步值·手感照常 defer（§9）。

### 5.2 三轮定稿（2026-07-14·核对作者波浪参考图）

§5.1 第①点「折叠 sin 出尖脊」被作者当面否掉：给的参考图（12 格波浪 icon + 分层波浪背景 + 鱼鳞状波浪纹样）全部是**光滑浑圆**的起伏，没有一张有尖角。教训：「尖头朝上」是在描述「凸起的朝向」（波峰在上·波谷在下，标准波浪的样子），不是要求把曲线削尖——两者读岔了。

修正：`rippleDetail` 撤回折叠幂变换，改回**两层圆滑正弦**（主波长 70 + 副波长 26·错开相位不重合波峰）；域扭曲（fbm warp wx）与幅度调制（fbm ampMod∈[0.75,1.25]）保留——它们打散的是「间距/高矮太规则」，不影响曲线本身圆滑与否，与「圆滑波浪」不冲突。`OW_RIPPLE_SHARPNESS` 旋钮已删（不再需要）。`OW_ROCK_MOUND_*` 圆钝礁丘不受影响。**⚠ 双正弦叠加那步很快被 §5.3 推翻**——别照抄这段的做法。

### 5.3 四/五轮定稿（2026-07-14·同日又两轮·数值验证收敛）

截图给作者看，§5.2 的「双正弦叠加」被当场质疑「是不是模仿不来」。用数值查了一遍（采样 `owFloorY`、数斜率变号次数）才找到真根因：

- **双正弦叠加会干涉**：主波长 70、副波长 26 相加，斜率变号次数从纯正弦基线的 6 次跳到 13 次，间距远小于半波长——数学上每一点仍然光滑（正弦无穷可导），但两个非谐波频率叠加会在波峰内部拱出局部小拐点，肉眼读成「长了尖角」。**先撤回双正弦，改回单一正弦**验证 flips 精确回到基线 6 次。
- **domain warp（fbm 扭相位）在这个定义域内几乎不起作用**：`vnoise` 网格间距被 `OW_RIPPLE_WARP_FREQ` 换算后跟采样窗口同量级，warp 幅度调多大局部波长都只在 ~10% 内抖，起不到「疏密不均」的效果——量过，白改。
- 作者追加反馈「波峰太高了、我给的是扁平且波长不规则的」→ 两处改：**振幅调矮**（`OW_FLOOR_AMP` 11→6，相对波长更扁）；**波长不规则改用保证不折叠的相位调制**——瞬时角速率 `rate(t)=k·(1+m·sin(t·s))`（`m=OW_RIPPLE_WARP_DEPTH<1`、`s=OW_RIPPLE_WARP_FREQ`）恒正，相位 `u(wx)=∫rate` 严格单调递增，数学上保证永不折叠；实测局部波长在 `WAVELEN/(1±m)` 间真实伸缩、flips 仍卡在基线附近、相邻波峰间距从 ~29 到 ~70 世界单位不等，肉眼可见疏密不均。

教训沉淀成机制：**判断"是否会长出意外尖角"别只靠肉眼来回猜，采样 `owFloorY` 数斜率变号次数（数值应等于纯正弦基线；间距应 ≥ 基线半波长的合理比例）——这比反复截图人工看快得多、也更准**（详见 [[open-water-sonar-mapgen]] memory 或本 session 记录，脚本思路：等间距采样 → 逐点算差分符号 → 数变号次数与最小间距）。

---

## 6. 侧壁 / 峡谷 + 连洞穴

> **2026-07-23 Cowork 交互（Opus·med）拍板**：侧壁从旧 §6 一行 stub 提成正式开阔水档。三设计点已定（§6.0）。**本节定架构 / 机制 / 数据模型，形状数值一律 defer §9。** 旧 stub「侧壁＝floor contour 某侧 smoothstep 抬起成墙」仍是渲染核心（§6.2），只是补全成完整档。

### 6.0 三条拍板结论（2026-07-23）

1. **两轴正交建模**（Q1）：开阔水域从「单轴 zoneTag」拆成**两条正交轴**——**底面轴**（`zoneTag ∈ {sand,coral,rock,atoll} | midwater`·管 contour / 结构 / 内容池·**不变**）× **侧壁轴**（新·管峡谷墙）。侧壁**不是**第 5 个 zoneTag，是独立配置——可自由组合「岩壁+沙底」「岩壁+珊瑚底」「岩壁+无底(断崖)」。墙面材质本身也是一条轴（MVP 固定 `rock`·§6.3），留 additive 缝将来可换。**这是可扩性的载重决定**：不把「有墙」塞进底面 tag，避免将来每加一种「X 底峡谷」都要炸 tag 枚举（守根 CLAUDE.md「解耦落成机制」+ [[correctness-over-minimal]]）。
2. **单侧墙的另一侧两态都要**（Q2）：`side ∈ {left,right}` 时另一侧有两个可选态——**收口**（floor 上收成缓坡封边）/ **敞向 midwater**（无墙无底·陆架断崖式）。由 per-zone 参数 `otherSide ∈ {taper,midwater}` 选。`side='both'` 时无此参数。
3. **墙起伏各自独立旋钮**（Q3）：墙 warp/amp/freq 自成一套 `OW_WALL_*` 常量，与海床 contour 的 `OW_FLOOR_*` **互不牵动**（延续 §2.4「开阔水域独立几何旋钮·调墙绝不动底、调底绝不动墙」）。

### 6.1 数据模型（正交 · 不入存档 · 确定性派生）

- zone 定义（`zones.json`）加**可选** wall 描述子，与 `zoneTag` 正交：

  ```jsonc
  openWaterWall?: {
    side: 'left' | 'right' | 'both';
    otherSide?: 'taper' | 'midwater';  // 仅 side∈{left,right} 有意义/必填
    material?: 'rock';                  // MVP 仅 'rock'·留轴
  }
  ```

- **无此字段＝无墙**（现状·纯 floor/floorless·零行为变化·守向后兼容·不 bump SAVE）。
- 墙几何**派生不入存档**（同 seabed·由 zone id + 节点 x 布局确定性算·守感知诚实 / 可复现·quirk #255 / #99）。存档形状不变 ⇒ 加此可选字段**不 bump `SAVE_VERSION`**。

### 6.2 渲染：墙＝floor contour 某侧抬起（单值 · 不悬空）

- 侧壁 SDF＝在配置侧把「岩 / 水分界」从水平 floor contour 抬成**近垂直的墙内面**：墙内面是深度 `wy` 的**单值函数** `wallInnerX(wy)`（每个深度对应一个内壁 x），墙后（更靠边）恒为岩。合成：`d = max(floorSdf, wallSdf_left, wallSdf_right)`——一像素是岩 iff「在海床下」或「在任一结构内」或「在任一墙之后」，否则水。**单值内面 → 结构上不可能悬空**（同 §2.1 floor 的论证；别用胶囊填墙·会留碎片）。
- 墙内面微起伏用 `OW_WALL_*` 自己的**单值**函数（相位调制·瞬时角速率恒正·严格单调不折叠·同 §5.3 教训·防肉眼「长尖角」）。
- **V/U 张开（上宽下窄）**：峡谷横截面向上（浅）**张开**——`wallInnerX` 随高度**离图心退**（底 wy=deepestY 最窄、贴防埋点 clampX；上宽）。**必须与防埋点 clamp 同向**：clamp 把内面钉在「节点外包络 ± margin」的岩侧，taper 只能在那一侧展开才不被 `min`/`max` 吃掉 ⇒ 张开（上宽）是唯一同时满足「不埋点」+「墙面非竖直平板」的形态。写成「上收（向图心）」会与 clamp 反向、taper/ripple 整段失活成竖直墙（#330 对抗复审逮到的坑·代码 `wallInnerX` 头注同款警告）。张多快＝`OW_WALL_TAPER` 旋钮·defer §9。
- **图底关系**（承 §2.1）：水是背景，黑（透明岩）在海床下方**和墙之后**。侧壁把「稀有侧墙」从 §2.1 的稀有变体升成一等档；`WALL_LO/WALL_HI` 上色带（§2.3）复用不变——墙面就是岩面的青边。

### 6.3 墙面材质（MVP 固定 rock · 留轴）

- 墙就是岩面 → 复用 `shadeSonarSdf` 三档上色（暗芯 + 青边·同 rock 结构），**无需新上色**（守 §2.3 防飘：唯一一段上色码）。MVP 墙面**不撒结构**（干净岩壁）；`material` 轴留缝——将来可扩「珊瑚墙」（墙面贴 coral 结构簇）等·**留缝不建**（守 [[correctness-over-minimal]] 加法扩展）。

### 6.4 与 seabed / floorless 的交互（两轴自然组合）

- **有底峡谷**＝floored `zoneTag`（sand/coral/rock/atoll）+ `openWaterWall`：墙 + 底 contour 都在·`seabedNodeIds` 照常（floored tag 判定不变·§4a）。
- **无底峡谷 / 断崖**＝`midwater` + `openWaterWall`：有墙无底·`seabedNodeIds` 空（floorless·§4a）·bake 墙 + 整窗水哨兵（无 floor）。→ **侧壁轴与「有底 / 无底」轴天然正交**·正是两轴化换来的：不用为「无底但有墙」造新 tag（守 quirk #254「加 tag 前查重名」）。
- `{kind:'atSeabed'}` 门不受墙影响（只读 floored tag·§4a）。单侧 `otherSide:'taper'` 的收口缓坡属**底面** contour 的一部分（floored），`otherSide:'midwater'` 的敞口侧则无底——同一张图可一侧贴底一侧临渊。

### 6.5 防埋点（构造保证 · 可 regress · 承 #326/#327 教训）

- **节点不得埋进墙内面之后的岩体**（墙版的 #326：seabed 曾把 106–135 个节点埋进岩·靠几何下包络修·quirk #270）。墙内面 `wallInnerX` 必须**清出该 zone 所有节点 x**：左墙取节点 x 分布**最小侧外包络**、右墙取**最大侧外包络**，再外扩 margin·恒清节点（复用 #327 下包络思路·只是换轴到水平）。
- 构造保证（派生时裁）+ 一条 playthrough 断言（`playthrough-openwater-wall`·N zone × M seed·扫「有无节点落在墙后 / 墙把图劈断」·期望 0·守 #327「拓扑重写靠形状门兜底、别靠存在性断言」教训）。

### 6.6 配置校验门（约定落成机制 · regress 红）

- `openWaterWall` schema 校验进现有 zone 配置校验（`regionConfigErrors` 或新 `check-openwater-wall`·实装时定）：`side ∈ {left,right,both}`；`otherSide` **仅当** `side ∈ {left,right}` 允许**且必填**（`both` 带 `otherSide`＝报错）；`material` 仅 `'rock'`（MVP）。非法配置＝regress 失败项（不是运行时才炸·守根 CLAUDE.md「约定落成会在 regress 失败的检查」）。

### 6.7 连洞穴（承旧 §6 · 不变 · 别堵死）

- 连洞穴＝复用现有 **portal + `traversalFlag`**（`DiveNode.portalKind`·`CaveGenParams`·`caves.json`）：开阔图放一个够深、能当 entrance portal 的节点；上浮 / 穿越置 flag 揭示对口 chart POI。侧壁 + portal 天然搭（峡谷尽头接洞口）。现在只**别堵死**（拓扑允许一个深节点带 portal）。

---

## 7. 防飘 / 验收（落成机制·不是靠打包票）

1. **同一段上色**：`caveSdf` 与 `openWaterSdf` 都调 `shadeSonarSdf`（提取后洞穴 byte-identical）。这是防飘的根。
2. **截图回归**：加一张开阔水域 sonar baseline 进 `screenshots/baseline` → 任何漂移变成 `screenshots/diff` 门失败项。抽 `shadeSonarSdf` 后先确认洞穴 baseline 不变（守 quirk #100 洞穴一致性）。
3. **mapgen 场景 baseline**：新开阔水域生成器配一条 `scenarios/mapgen/*.json` + `playthrough-mapgen-scenarios`（`analyzeMap` 结构不变量）。
4. **边界/预算**：新生成器进 `engine/mapgen-openwater.ts`（自成文件·守 900 行 `check-file-budget`）；纯几何/上色可放 `sonarGeometry.ts`（engine）或随现有「SDF 本体在 ui」的既有例外放 ui（`check-boundaries` engine↛ui·`caveSdf/bakeCaveRGBA` 现就在 ui·见 `sonarGeometry.ts` 头注·实装时定放哪·倾向：纯 `openWaterSdf`+`shadeSonarSdf` 放 engine 更干净、由 ui 调）。

---

## 8. 实装计划 + 并行 + 模型/effort

- **Phase 1 ✅ DONE（2026-07-13·已提交 `b469431`/#302）**：`shadeSonarSdf(out,i,d,deepK,tex)`（就地写·无分配）抽进 `engine/sonarGeometry.ts`，`bakeCaveRGBA` 改调它。**沙箱验 byte-identical**（合成洞穴 before/after sha256 相同·0 字节差）+ `regress:quick` typecheck 绿。改 2 文件：`sonarGeometry.ts`（加函数）+ `SonarScanPanel.tsx`（调用 + import·顺手删已无用的 `WALL_HI` import〔`noUnusedLocals`〕）。**已随 #302 Mac 全量 regress 绿后提交进 main。**
- **Phase 2（渲染）**：`openWaterSdf`（边缘 floor + 结构层 union）+ 一个 open-water bake 路径喂进 `SonarScanPanel` 的 `isOpenWater` 空占位分支（现 `cave={tuns:[],rooms:[]}`·SonarScanPanel §9）。→ *Opus / high* + 截图 harness 迭代（[[blue-cowork-ui-shoot]]）。
- **Phase 3（拓扑）**：`mapShape:'openwater'` 生成器 + 海床 contour 由节点派生 + `zoneTag` 三档。→ *Opus / medium*。
- **Phase 4（内容/验收）**：一个 QA 开阔 zone（配合作者 #1 地理骨架）+ baselines（mapgen 场景 + 截图）+ regress 全绿。→ *Sonnet 或 Opus / medium*。
- **并行**：Phase 1 必须先落（共享上色契约）。之后 **Phase 2（渲染）与 Phase 3（拓扑）可分两条 psm 车道并行**（共享「map→海床 contour」契约·先把契约定死）。用 `node scripts/psm.mjs start openwater-render --lane 'src/ui/**,src/engine/sonar*'` / `openwater-topo --lane 'src/engine/mapgen*,src/data/**'` 之类不重叠车道。
- **代码 vs work**：全是 code（进引擎实装）；数值手感调是 work（对着真渲染器·§9）。

### 8a. 已落地进度（回填·git 真值·2026-07-15）

SPEC 原按 Phase 1–4 排；实际落地按 commit：

- **#302**（`b469431`）：Phase 1 `shadeSonarSdf` 抽取（洞穴 byte-identical）+ Phase 2 `openWaterSdf`（边缘 floor + 结构层 union）+ 3 QA zone/scene。**已提交 main**。
- **#304**（`cf26b2f`）：地图调试器开阔水域也显声呐 + 连边覆盖层（dev-only·quirk #253）。
- **#305**（`7bd58be`）：look-dev 七轮迭代收敛——沙纹圆滑波浪 + 相位调制、结构铺满取景窗、终点贴海床、新增 `atoll` 礁石+珊瑚混合档；教训沉淀 quirk #254（数 flip 判尖角 / 相位调制瞬时速率恒正 / 加 tag 前查重名）。
- **#307**（`7e8a4e2`）：贴底节点机制 `seabedNodeIds` 单一真相 + `atSeabed` 事件门 + floorless 复用 `midwater`（详 §4a·quirk #255）。
- ⏳ **未落**：拓扑未加独立 `mapShape:'openwater'` 生成器（当前复用 `mapgen-layered.ts`·§3 允许的薄壳未做）；贴底/中层**内容池 JSON** 空（作者监督写·§4a）；世界投放等作者主线地理骨架落定（§10）。

### 8b. 侧壁 / 峡谷实装计划（2026-07-23 拍板后 · 未落）

- **前置**：base 开阔水域渲染 / 拓扑已落（#302/#305/#307）·`openWaterSdf`+`bakeOpenWaterRGBA` 在 `ui/openWaterRender.ts`·`OW_*` 旋钮在 `engine/sonarGeometry.ts`·`seabedNodeIds` 在 `engine/seabed.ts`。侧壁是**加法扩展**·不撕已测机制（守 [[correctness-over-minimal]]）。
- **契约先钉**（开车道前在 main 定死）：`openWaterWall` 数据模型（§6.1）+ `wallInnerX(wy, cfg, nodesXEnvelope, seed)` 派生签名（§6.2）+ 防埋点外包络（§6.5）——三者是 render 与 config 校验的**共享契约**·先定死再分岔（否则两车道各写一套墙判据＝会飘）。
- **Phase W1（数据 + 校验门 · engine/scripts）**：`zones.json` schema + 类型 + §6.6 校验门。→ *Sonnet / med*（纯 schema/门·低风险）。**可独立先落**（不依赖渲染·先把非法配置挡住）。
- **Phase W2（渲染 · ui）**：`openWaterSdf` union 墙 SDF（`max(floorSdf, wallSdf_L, wallSdf_R)`）+ `OW_WALL_*` 旋钮（`sonarGeometry.ts`）+ 单侧 `taper`/`midwater` 两态 + 上收 V/U。→ *Opus / high* + 截图 harness 逐轮 look-dev（[[blue-cowork-ui-shoot]]）。**手感调 defer §9。**
- **Phase W3（防埋点门 + baseline · engine/scenarios）**：`playthrough-openwater-wall` 外包络断言（§6.5）+ 场景 baseline（峡谷有底 / 无底 / 单侧×收口 / 单侧×敞口 四景）。→ *Sonnet / med*。
- **并行**：W1（config/门·`src/data/**`+`scripts/check-*`）与 W2（渲染·`src/ui/**`+`src/engine/sonar*`）**文件不重叠 ⇒ 两条 psm 车道并行**（`node scripts/psm.mjs start ow-wall-cfg --lane 'src/data/**,scripts/check-*,src/types/**'` / `... start ow-wall-render --lane 'src/ui/**,src/engine/sonar*'`）。W3 待 W2 渲染定型后落（要真墙几何验埋点）。契约（§6.1/6.2/6.5）先在 main 钉死再开车道·append-only 文档只在 main 整合时写（quirk #130）。
- **代码 vs work**：全是 code（进引擎实装）；墙形状 / 收口速率 / 起伏手感 / 撒墙密度是 **work**（对着真渲染器·§9·defer）。
- **SAVE**：墙派生不入存档 + `openWaterWall` 是 `zones.json` 可选字段 → **不 bump `SAVE_VERSION`**（§6.1·承 quirk #99）。
- **验收门总账**（守 §7 防飘）：① `shadeSonarSdf` 不动 ⇒ 洞穴 byte-identical 不变（quirk #100）；② W3 防埋点 playthrough 红→绿；③ 四景截图 baseline；④ §6.6 config 校验门。full regress + prod build 留 Mac/nightly（[[blue_regress_sandbox]]）。

---

## 9. 数值 / 手感（一律 defer·作者准则 [[defer-number-tuning]]）

所有形状参数——沙波幅度/波长、珊瑚礁密度/高度/枝数、岩石尺寸/圆度/拱形、侧壁频率、结构青边阈值——**进引擎后一次性对着真渲染器调**。别在离线 mockup 上无限追照片：剪影单色风格能到的自然度就到 §5 那档，更细的必须 in-engine。

---

## 10. 当前仓接口 / 协同

- `isOpenWater = !zoneAllowsBacktrack(zoneId)`（`SonarScanPanel.tsx:~613`）；空占位 bake 分支 `~686`（`cave={tuns:[],rooms:[]}`）＝Phase 2 要填的缝。
- `caveSdf`（`~225`）/ `bakeCaveRGBA`（`~455`）均 export·纯·无 DOM（headless 可跑·本 session 靠这个验证过）。
- 层状 DAG＝`mapgen-layered.ts`（已「开阔海域」）；`generateDiveMap` 按 `mapShape` 分派（`mapgen.ts:~91`）。
- 白板后**零开阔 zone**（4 个已删）·`depth_columns` 系统已移出主线（在 worktree）·所以本 SPEC 建**机制**，世界投放等作者 #1 地理骨架落定再接。
- **协同**：勿碰 `HANDOFF.md` 里未提交的 regionId lane（`dive.ts`/`chart.ts`/`MapDevPanel.tsx`·作者留其自收尾）；本 SPEC 实装主要触 `SonarScanPanel.tsx` + 新 `engine/` 文件·与 regionId lane 基本不冲突·各自单 commit。
- 沙箱约束：commit/push + 含 prod build 的全量 regress 留 Mac/nightly（[[blue_regress_sandbox]] / [[sandbox_git_commit]]）。
