# 深海回响 · 声呐图渲染重做 + 猎手追击 SPEC

> **状态：v1 草案（2026-06-07，作者逐拍 demo 敲定，预期工作 #98 起）。** 把下潜内声呐图从「示意 node graph（圆点 + 连线）」重做成**有机洞穴垂直剖面 + 雷达式扫描**，并把猎手追击从「节点快照」升成「可处在通道中段 + 扫描门控显示」。本 SPEC 是作者经多版交互 demo 拍板后的源真——**实装前先读本文件**。建法承袭项目「SPEC → 分阶段实装 → 每阶段全绿自审」。
>
> 前置：#92「位置即深度」（深水区 SPEC §13·y∝真实深度）仍成立、是本重做的地基；本重做**替换** `SonarScanPanel` 的示意渲染（声呐与房间 SPEC §5 留的「有机洞穴 SDF/噪声 polish」缺口·见该 SPEC §11 / quirk #71「S0 渲染先用 schematic·有机留后续」）。

## 1. 北极星 / 为什么

声呐图要读起来像**一张真实水下洞穴的侧剖面**（参考：洞潜剖面图 + 潜艇声呐镜），而不是抽象节点图：
- 玩家通过声呐**大致想象洞穴的形状**（不规则岩壁 + 蜿蜒水道），并据此判断往哪走、猎手在哪。
- 声呐是**会过时的记忆**（#71/§5）+ **暴露双刃**（开声呐＝被听见）——重做只换「怎么画 / 怎么揭示」，不改这些已立的机制。

## 2. 地图渲染（有机洞穴垂直剖面）

**单一来源仍是 `ui/mapLayout.ts::deriveMapLayout`**（给坐标）+ 新的 canvas 渲染（SonarScanPanel 改 canvas，不再 SVG schematic）。MapDevPanel 可继续用 schematic 或共用，按需。

- **画法＝洞穴剖面**：深色**岩石**背景里凿出**蓝色水道**（可走的洞）；岩壁＝水/岩交界，用**距离场（SDF：每条 `connectsTo` 边＝capsule 隧道 + 每个节点＝blob 洞室）+ 多层值噪声**扰成**不规则发光回波轮廓**。demo 用 SVG 置换滤镜近似过、canvas 逐像素 SDF 更细腻（本 SPEC 实装用 canvas·半分辨率提速）。
- **纵轴＝真实深度**（#92·上浅下深），但**压短纵向间距**（`pxPerMeter` 取小·作者要节点更近）；**横向自由**（没有横轴语义·可任意拉伸铺开避免重叠 + 让量程覆盖更多节点）。即 deriveMapLayout 要：y∝depth（小比例）、x＝自由分散（按 layer 分组或 tidy spread·见 #92 byLayer 思路）。
- **起手全黑**·只看得见自己（呼吸点）+ 一圈很淡的量程环；**随声呐一块块点亮**（见 §3 雷达扫描）·扫到的**保留**（不逐帧淡）直到下次扫描刷新（§4 声呐规则）。
- **节点显隐（作者要求·防剧透 + 自由感）**：只对**可立即前往的相邻节点**（＝当前 NodeSelectView 的「移动到下个节点」choice）画可点标记；其余节点**不画标记**（洞的几何形状可显·但不标点）。点击相邻节点标记＝触发那条移动 choice（声呐图与 choice 列表同步·见 §7）。
- **非洞穴场景（层状·沉船/礁等）**：未来各有专属背景图（沉船＝船的轮廓等）·**现在先全黑只显节点**（占位·留后续慢慢调）。

## 3. 雷达式扫描揭示

- **一记 ping ＝从你当前位置扩散的环**：明显的**亮色前缘** + 身后**逐渐淡化的拖尾**（雷达余辉·径向渐变环带）。扩散可**慢一点**（~1.2s）。
- **墙与点随波前到达才出现**（progressive·「声呐范围接触到才点亮」）——不是一次性全亮。猎手红点同理只在**波前扫到它**时刷新（§5）。
- 揭示**累积**：移动后再扫·新区域随波前补上·旧区域保留（你在拼一张越来越全的图）。

## 4. 声呐窗口规则（开/关 · 何时扫）

声呐是**持续的开/关状态**，跨回合保留（缺省开）。
- **开**：本回合处于「暴露/发射」态——**无论是否打开面板都算开**（暴露/警觉照付）；打开面板＝**当场做一次扫描**（scan-on-open·懒执行·不预先算好）·随波前刷新成新图。
- **关**：不自动扫；打开面板只看**保留的旧图**（不重扫·猎手红点是上次的·会过时）。
- **本回合可反悔**：即使设了关·本回合仍可主动扫一次——但**扫了就算本回合开**（付暴露）；之后再设关只影响**下一回合**不自动扫。
- 即玩家的控制点＝**决定下一回合是否关声呐**（预先承诺）；本回合开/关是上回合定的。
- 旧图**保留到下次扫描**才被刷新（不逐回合淡出·与 #71「余像渐隐」的早期设定相比·作者本轮改定为「保留到下次 ping」）。

## 5. 猎手追击（mid-edge + 扫描门控 + 迎战）

升级现有猎手系统（#84/#89/#90·`engine/stalker.ts`）：

- **位置可处于通道中段**：`Stalker` 位置从 `nodeId` 升成 `{from, to, prog 0–1}`（或保留 nodeId 表示「在节点」+ 可选 to/prog）。每回合前进 `HSPEED` **一条边的分数**（不强制贴节点）。渲染对 from→to 线性插值。
- **速度旋钮 `HSPEED`＝「通常追得上」的平衡阀**：~1.0 同速（贴住）·<1 玩家能拉开一点（可甩·少数设计内）·>1 死咬。配合**回合经济**（玩家不可能每回合都纯逃——ping/休息/处理房间/管氧都是原地回合·猎手趁机贴近）+ **氧/视野代价**（关灯潜行看不见、氧照扣），实现「大部分情况最终追上·少数靠移动/道具甩掉」。
- **三态**：`hunting`（信号开·实时追你真实位置）/ `searching`（你关信号→它去你**上次被探到的位置**·到了找不到则徘徊）/ `lost`（搜索 `GIVEUP` 回合无果→放弃·despawn）。
- **扫描门控的红点（关键·别犯 demo 的错）**：红点只在**声呐波前扫到猎手当前位置**那刻**快照**它的位置·然后**冻结**直到下次扫描再快照（跳变到新位置·不连续滑动）。两次扫描之间红点是**旧的**（stale·标灰/「?」）。关信号则一直冻结（猎手实际在动·你看到的是旧标记）。
- **接触判定**：走进猎手所在节点 = 接触；同回合你 A→B、它 B→A **对穿同一条边** = 接触（不能穿过它）；猎手位置贴到你（距离 < 阈值）= 接触。**关着声呐被摸到跟前＝无预警接触**（潜行的风险）。
- **停下迎战**：有猎手时给「停下·迎战」动作——在你的条件下开打（选择迎战给先手优势·对比被追着逃时被逮＝伏击吃亏）。
- **逃脱（设计内）**：关信号摸黑挪窝→它丢失→搜索→跟丢；decoy 道具（猎手 SPEC §4·转 seek_last 去诱饵）；大型猎手钻不进你能过的窄缝（§5）；上浮离开本潜。
- **标记观感**：玩家点 + 猎手点都是**半透明、呼吸闪烁、圆心 + 外圈**的点（青＝你·红＝猎手·**不要 X**）；猎手 lost 时标灰。

## 6. 实装顺序（建议·每步独立全绿·可分提）

引擎优先（sandbox 可回归验证）→ 渲染最后（需 dev-server 肉眼·绿≠画对·quirk #91/#93）：

1. ✅ **洞穴一致性**（纯引擎·最安全先做·`59ee10d`）：`dive.ts::startDive` 给 `generateDiveMap` 传**位置派生的确定种子**（现在不传 rng→mapgen 默认 `Math.random`→每潜不同）。种子＝`hash(zoneId + seedKey + depthOffset)`·`seedKey` 由 `startDiveFromPoi`(poi.id) / `startDiveFromOutpost`(outpost/band id) 传入·教学/缺省回退稳定串。→ **同一地点再潜＝同一张图**。代价：每地点变体单一（作者接受·要一致世界感）。**注意**：mapgen-scenarios 用各自显式 seed·不受影响；但 dive 类 playthrough 的地图会变·跑全量确认结构断言仍过（多为通用不变量·应没事）。不 bump SAVE_VERSION（map 不入存档）。
2. ✅ **猎手 mid-edge + 追击规则**（引擎·`stalker.ts`·`playthrough-stalker` 验·`5eedc11`）：位置模型 nodeId→{from,to,prog}·HSPEED(0.8)·三态·对穿/贴近接触·迎战先手动作。守猎手 SPEC §9（确定性·不耗 RNG·守地板·additive 不 bump）。`run.huntEnabled` 缺省 off 仍逐字节守 playthrough-stealth。〔决策：HSPEED<1＝可甩·贴近阈值 CONTACT_DIST 0.5·1−HSPEED≤CONTACT_DIST 一跳之差必贴上·迎战复用 combat ambushing 先手。〕
3. ✅ **声呐窗口开/关规则**（state + dive.ts + UI·`ccef8b0`）：on/off 持续状态（sonarOn/sonarNext·缺省开）·scan-on-open（到站自动扫·autoScanOnArrival）·暴露按状态（持续开则透传期计 signature）·下回合预承诺（setSonarNext）+ 本回合反悔（pingSonar）。接 `run.sensors` + `scanMemory`。**仅 sonarUnlocked 才落新字段＝未解锁逐字节不变。**〔决策：sonarActive 仍 keyed on sonar==='ping'·持续开靠 applyTransit 把 sonar 落 'ping' 跨站持续＝最小改动保住 locked/stealth。〕
4. ✅ **canvas 洞穴渲染**（UI·`SonarScanPanel` SVG schematic→canvas·`3ce44e3`）：有机洞穴剖面（SDF capsule 隧道+blob 洞室+值噪声·半分辨率·导出 `caveSdf`）+ 雷达扫描（rAF ~1.2s·亮前缘+淡化拖尾+波前门控）+ 节点显隐（只相邻可去 choices 画可点标记·点击=move）+ mid-edge 红点（blip 插值·呼吸点+外圈·不要 X）+ 旧图保留（去渐隐）+ 非洞穴黑+占位。`deriveMapLayout` 传小 pxPerMeter(13)+byLayer x 铺开。CSS 走 head 注入（避脏 styles.css + 不污染 SSR 断言）。**canvas 画对仍需 dev-server 肉眼**（SSR smoke 只断 class 串·绿≠画对·quirk #91/#93·或 ?dev→Shift+M / 实际下潜）——**待作者视觉验收 + 调参**（HSPEED·pxPerMeter·噪声 amp·配色）。〔2026-06-09 更新：作者 headless 看图验收后，洞穴渲染从「节点圆 blob + 边直胶囊（读作 node-link 图）」定稿成**真实侧剖有机洞穴**——域扭曲 `caveWarp` + `smin` 平滑并集（房间熔大洞=多 POI 同室）+ 弯折路由隧道 + 房间散瓣/死路壁龛（`buildCaveGeometry`）+ POI 偏心语义落点（`poiOffset`）+ `voidTrack(−warp)` 标记跟随扭曲洞·节点图退隐藏骨架·port `82b4368`·见 §9 末 + CHANGELOG #104 + QUIRKS #102；canvas 画对仍待作者线上 ?dev 肉眼。〕

## 7. 与现有代码的接点（别另起炉灶）

- 坐标：`ui/mapLayout.ts::deriveMapLayout`（y∝depth·#92；本重做调小 pxPerMeter + x 自由分散·SonarScanPanel canvas 与 MapDevPanel 共用）。
- 渲染：`ui/SonarScanPanel.tsx`（SVG schematic → canvas 有机洞穴 + 雷达扫描 + 节点显隐）。纯渲染·读 `run.scanMemory`/clarity/stalker·不加判定分支（声呐与房间 §7/§10）。
- 声呐逻辑：`engine/sonar.ts`（`revealSonarScan`/`sonarScanRange`/`scanMemory`/`pingSonar`）+ `engine/clarity.ts`（欺骗/威胁单一来源）。声呐开/关状态 + scan-on-open 接 `run.sensors` + `dive.ts`。
- 猎手：`engine/stalker.ts`（位置模型 + advance + 三态 + 接触）·接线 `dive.ts::moveToNode`·渲染 `SonarScanPanel`/`NodeSelectView`。`nodeSector` 已按 depth（#92）。
- 节点点击＝move choice：`NodeSelectView` 的「移动到下个节点」choices ↔ SonarScanPanel 相邻节点标记（点击触发同一 choice）。
- mapgen 种子：`engine/dive.ts::startDive` → `generateDiveMap({rng})`（mapgen 已收 `GenOpts.rng`·现 dive 没传）。

## 8. 守则承袭

- 回归文化（#22/#26·现 27 任务）：每步收尾 `npm run regress` 全绿 + 碰 UI 数据路径补 `smoke-chart-ui` SSR 断言。但**绿 ≠ 画对**（quirk #91/#93）——渲染步额外 dev-server 肉眼。
- `engine ↛ ui` 边界（quirk #95·`check-boundaries`）：stalker/sonar/clarity 不 import ui；坐标/类型给 UI 放 types/ 或 engine 导出。
- 位置即深度（#92·深水区 SPEC §13）：y∝depth 不变（只调比例）；nodeSector 按 depth。
- 猎手（#84/#89/#90）：纯逻辑住 stalker.ts·确定性·不耗 RNG·守地板（最深/最凶仍找得到你）·additive 不 bump SAVE_VERSION。
- 存档：未发布不迁移——新字段 createNewRun/反序列化 `?? 默认` 兜底·不 bump（现 4）。mapgen 种子改不入存档。
- 软门控 / 敌人别太多（猎手是已有系统·非新常规敌） / 叙述永不交底 / 别擅自触发 d_reveal。

## 9. 决策日志

- 2026-06-07（作者逐拍 demo 敲定·本 SPEC 成文）：经多版交互 demo（声呐揭示 → 猎手逼近 → 有机洞穴剖面 → 雷达扫描 → mid-edge 猎手 → 扫描门控红点 → 节点显隐）拍板全部观感与规则。两个 demo 期发现并修的要点已并入正文：① 红点须**扫描门控快照**（非连续滑动·别在波前扫到前就动）；② 只显示**可去的相邻节点**（防剧透 + 自由感）。视觉细节（偶发黑屏等）作者判「问题不大·未来调」。**下一步＝按 §6 顺序实装（引擎优先）。**
- 2026-06-07（实装 session·②③④ 全落地·接 #98 `59ee10d` 洞穴一致性之上）：按 §6 顺序实装并分提——② `5eedc11`（猎手 mid-edge + 追击）、③ `ccef8b0`（声呐开/关窗口）、④ `3ce44e3`（canvas 洞穴渲染）。每步独立全绿（`npm run regress` 27/27）。关键实现决策见 §6 各项 〔…〕 注。**SPEC 引擎/逻辑面（②③ + ④ 结构）完成**；**剩余＝④ 的 canvas 视觉验收/调参（需作者 dev-server 肉眼·SSR 测不到画对·quirk #91/#93）**——若观感不对，旋钮集中：`stalker.ts::STALKER_HSPEED`/`STALKER_CONTACT_DIST`、`SonarScanPanel` 的 `SONAR_PX_PER_M`/`CHANNEL_R`/`NODE_R`/噪声 amp(7)/配色/`SWEEP_MS`。次要可深化（非阻塞）：S2 欺骗目前只落在相邻可去标记上（非相邻节点的洞几何不再单独标欺骗）·开放水域专属背景仍占位·focus 扇区仍 SVG 楔形（未移进 canvas）。
- 2026-06-09（交互 session·④ 有机洞穴 port·`82b4368`·接 #100 ④ 之上）：headless 离屏渲染（真 `generateDiveMap`+`deriveMapLayout`+**真导出 `caveSdf`**·PPM→PNG）给作者看图迭代验收（v1 melted → v2 room/tunnel contrast → v3 + 更随机 + POI 偏心语义落点）。作者反馈原 ④「读作 node-link 图」→ 定稿**真实侧剖洞穴**（随机房间形状·蜿蜒隧道〔可直〕·节点只是洞里 POI·可多 POI 同室·可贴边·能关联剧情）。据此重做 `SonarScanPanel` 洞穴 SDF：**域扭曲 `caveWarp`** + **`smin` 平滑并集**（相邻房间熔成一间大洞=多 POI 同室）+ **弯折路由隧道 + 房间散瓣 + 偶发死路壁龛**（`buildCaveGeometry`·确定性按 node/edge id 派生·守 #100）+ **POI 偏心语义落点 `poiOffset`**（ascent/air 偏顶·rest/camp 偏底·event 贴壁）+ **`voidTrack(−warp)` 标记跟随扭曲洞**（不浮岩里·关键坑）。节点图退为**隐藏骨架**（连通/深度/gameplay 不变·纯渲染·不 bump SAVE_VERSION·engine↛ui 不破·SSR smoke E4-E8 结构不变）。`caveSdf/buildCaveGeometry/poiOffset/voidTrack/caveWarp` 纯导出·已用真导出离屏比对验收的 v3 still（MAD 0.7/255 一致＝port 忠实）。`npm run regress` **27/27** 全绿（含 prod build）。新 quirk #102。**剩：canvas 画对（sweep 动画/点击/对齐）待作者线上 `?dev` 肉眼**——绿≠画对·SSR 测不到。调参旋钮集中在 `SonarScanPanel` 顶部（`CH_BASE`/`CH_VAR`/`ROOM_BASE`/`ROOM_VAR`/`WARP_AMP`/`WARP_FREQ`/`SMIN_K`/`CTRL_OFF`/`WALL_LO`/`WALL_HI`）。
