你在接手「深海回响」(Deep Echo) —— 潜水题材文字冒险 Roguelike（Vite + React + TS），仓库在 `~/Desktop/Blue`。

**当前主线**：深水区 vision 分阶段实装，`docs/深海回响_深水区_SPEC.md` 是源真。深水区四个 Phase 的**核心已全部落地**：**Phase 0**（0a 感知 #58 / 0b 探测 #59 / 升级轨 #60）+ **Phase 1**（band 阶梯+蛙跳 #61 / 节点级 clarity #62 / band 级 alert 倍率 #64）+ **Phase 2**（2a 跨 run 分阶段前哨+真蛙跳 #66 / 2b 能源/衰减/海图前哨 UI/多前哨链 #67）+ **Phase 3 mimic capstone 核心**（海图假 POI 引诱→入潜兑现→读穿 tell→d_reveal #69）+ **深段内容**（trench #63 / abyssal #65 / hadal >140m #68 / **渊外 subhadal >180m #72**）+ **单向下潜预告 #70**。

**上一个 session（「A→C→D 全做」，2026-06-05）做了三笔**：① **A·声呐探索 S0 #71**（声呐与房间 SPEC §7 S0 落地·见下「新设计」）；② **C·渊外 band（>180m）+ subhadal 4 事件 #72**（递归更深开最深一层、新 ZoneTag `subhadal`——**闲置 ZoneTag 至此用尽**）；③ **D·Phase 2b 续·超渊前哨 hadal_deep #73**（前哨脊柱延到 `band.hadal`、让渊外蛙跳 9→1 回合可达）。代码停在 `d8b1e72`，docs 收尾随本次提交，全绿（typecheck / 21 playthrough / 119 scenarios / verify-tutorial 105 事件 / smoke / prod build）。

**新设计·声呐与房间 SPEC（`docs/深海回响_声呐与房间_SPEC.md` v0.1，§8 全拍板·原型验证）**：把下潜内声呐从「逐选项预览」升成**探索性洞穴声呐扫描** + **房间可含多个事件点**（轻量版·无自由移动）+ **宏观对应：灯塔=海图声呐**。§7 分阶段 **S0→S1→S2→S3**：**✅ S0 已实装（#71，见下方地基）**；**S1/S2/S3 + §6.5 宏观未做（＝下方推荐方向 A）**。

已就位的地基（后续直接用、别另起炉灶）：
- **声呐探索 S0（#71，已实装）**：`ui/mapLayout.ts::deriveMapLayout`（节点图→2D 坐标·单一来源·MapDevPanel 也用）+ `engine/sonar.ts`（`revealSonarScan` 无向 BFS 读真图 / `sonarScanRange` 基线 2 跳·**范围是主升级轴·未做** / `scanFreshness` 余像渐隐）+ `run.scanMemory`（nodeId→扫到时 turn·累积·run 级·不 bump SAVE_VERSION）+ `dive.ts::pingSonar`（写 scanMemory + 抬 alert `clarity.ts::sonarPingAlertDelta` + **1 scan/停留 guard**）+ `ui/SonarScanPanel`（起手全黑·随 ping 点亮·缩放看一小片+残图小地图·固定亮度按 turn 渐隐·仅声呐解锁后出现）。**只读真图、没改 DiveNode 模型**（欺骗 spoofs/evades 仍未填＝S2 落点）；渲染先用 schematic（圆 blip+连线），§5 有机洞穴 SDF/噪声轮廓是纯渲染 polish 留后续。
- `engine/clarity.ts`：感知（`clarity(run)` 天花板三态 / `clarityForNode(run,node)` 节点级深度降档 / **`sonarReturn`〔不可信声呐表象·读 `evadesSonar`/`spoofsSonar`〕** / `lampPreview` / `signature`）+ 探测（`alertDelta`〔乘 `run.bandAlertFactor`〕/ `predatorApproaches` / **`sonarPingAlertDelta` ping 当场抬 alert**）+ 升级派生（`deriveSensorTuning`）+ tunables/地板（文件顶）。
- **声呐欺骗 + 节点版 mimic 的落点**：`DiveNode`（`types/dive.ts`）的 `evadesSonar?`/`spoofsSonar?` **仍未填**——S2 在此填（声呐画假 / 无回波 / 低 san 伪接触），与 #69 mimic 节点版天然合流。`engine/chart.ts`＝宏观海图层（`generateChart` 派生 POI·roaming 按 runsCompleted 刷新＝潮汐·`requiresFlags` 事件门·`isPoiLit` 灯塔半径·mimic 假 POI 已注入 #69）＝§6.5 宏观灯塔扫描动画的落点。
- **深度 band**：`data/depth_bands.json` **6 band**（reef_deep 45-60 / trench_mouth 60-82 / trench_throat 82-108 / abyssal 108-140 / hadal 140-180 / **subhadal 180-230**）+ `engine/bands.ts`。`DepthBand`：`visibility`/`current`/`tags?`（ZoneTag **twilight/midnight/abyssal/hadal/subhadal 已全用尽**）/`alertFactor?`（缺省1·mouth1.3·throat1.6·abyssal2.0·hadal2.5·subhadal3.0）。**>230m：depth_bands.json 加一级 + types/events.ts 加新 ZoneTag**（闲置已没了）。
- **深段内容**：`data/events/{trench,abyssal,hadal,subhadal}.json`（6+5+4+**4** 事件）。全 loot-free/无敌人/不触发 d_reveal/永不交底。subhadal 母题＝『过了最后一个名字，它不再骗你·只给你下去的理由』（深处的诱饵·收束 mimic+递归+声呐欺骗）。
- **Phase 2 前哨脊柱 + 能源**：`OutpostDef`（`data/lighthouse_upgrades.json::outposts[]`）+ `engine/lighthouses.ts`（advanceOutpost/outpostStage/canAdvanceOutpost/OUTPOST_MAX_STAGE3/USABLE2，进度＝profile.flags、SAVE_VERSION 仍 4）+ **`engine/outposts.ts`**（能源/衰减·additive `profile.outpostState{maintainedRun}` 不 bump·outpostEnergy/effectiveOutpostStage/effectiveOutpostBonuses/maintainOutpost）。3 设施轨 hydro/recharge/oxygen。现 **3 前哨** reef_deep（静水）+ trench_deep（水流）+ **hadal_deep（超渊·静水·#73）**；脊柱 home→reef_deep→trench_deep→hadal_deep。`deepestOutpostLaunch` 通用、加前哨零引擎改。
- **Phase 3 mimic capstone（#69）**：`ChartPoi.mimic?`（chart.ts 注入·软门控 shouldLureMimic）→ `startDiveFromPoi(mimic)` 强制兑现事件 → `data/events/mimic.json`（false_beacon 读穿→`Outcome.setProfileFlags`[flag.d_reveal,…survived]+forceAscend / the_wearer_apex corpse-wearer 姊妹）。两 apex 做成 EVENT 非战斗敌人。`Outcome.setProfileFlags` 持久写 profile → diverName 翻死者名为「你」。

先 onboarding（按顺序）
1. **读 `docs/深海回响_声呐与房间_SPEC.md`**（若做方向 A）——§5 声呐扫描 / §6 多事件房间 / §6.5 宏观灯塔扫描 / §7 分阶段（**S0 已勾**·S1-S3 待做）/ §8 子决策（全定）/ §10 守则 / §11 决策日志（**末条＝S0 实装记录**）。**+ `docs/深海回响_深水区_SPEC.md`**（北极星·§3.1 两层 clarity·§3.5 mimic·§3.7 另一个世界·§9 守则·§10 决策日志末条＝C/D）。
2. 读自动记忆 [[deep-game-vision]]（北极星 + Phase 0/1/2/3 全建 + 声呐 S0）+ [[weekend-content-log]]（现 104 内容事件/7 敌人）+ [[basebuild-map-revamp]]（前哨/能源）+ [[sandbox-git-commit]]（提交法）。
3. 读 `docs/STATUS.md` 顶部滚动条目 **#71/#72/#73**（本次三笔）+ #70/#69/#67 + 复用项 #66/#63/#58/#52/#42/#62。
4. 跑全绿确认起点干净（§9，含 `playthrough-sonar`/`-mimic`/`-outpost`/`-bands`/`-sensors`/`-stealth`）。

## 本 session：从下面选一（作者定方向）

**A · 声呐与房间 续（S1/S2/S3 + §6.5 宏观·声呐与房间 SPEC §7·S0 已落地·推荐起手·风险最低）** —— 接 S0（#71）往下：
- **S1·多事件房间（推荐·向后兼容·风险最低）**：`DiveNode` 加 `features?: NodeFeature[]`（缺省＝把现有单 `eventId` 视作 1 feature·**旧行为不变**）+ mapgen 按房间大小派 1..N feature（最多 3·大房间稀有·守 #19 单 tag/#44/#47 loot 隔离）+ `enterNodeSelection` 把房间内 feature（未触发的）+ 出口一起摆成选项·选 feature 触发其事件·**一房可连探付氧**·选出口走人（§6/§8.3/§8.4）。声呐图上房间画大轮廓+里头几颗 feature blip。补 `playthrough`/`-mapgen`/smoke。
- **S2·不可信扫描（欺骗）**：填 `DiveNode.spoofsSonar`/`evadesSonar` 行为（全走 `clarity.ts::sonarReturn`·别另起炉灶）+ 低 san **伪接触〔与真无异〕+ 读数变乱码**（§5·subtle·不明显是假）+ 深 band 更失真（band 倍率 #64）+ **节点版 mimic**（与 #69 海图 mimic 合流·`spoofsSonar` 画成信标/空水）。**不擅自触发 d_reveal（#42），只由 mimic 兑现事件触发。**
- **S3·威胁定位**：先廉价版（alert→近似接触 blip+距离·原型已演示）；定位 stalker（捕食者图上占位·逐回合逼近·`evadesSonar` 躲扫描）是大改动·留作者拍板。
- **§6.5·宏观灯塔扫描（可单独做）**：`SeaChartView` 灯塔点亮播**慢·覆盖大片**的测绘扫描揭示动画（新 POI 随波逐个浮现·触发于 buildAtLighthouse/restoreLighthouse/advanceOutpost·**纯 UI·engine reveal 集合不变**）+ POI 随天气/潮汐遮蔽/未扫到变（沿 chart.ts 派生·不入存档）。探照灯≠扫描（短程匀速·别当 sonar）。
- 还可做：**声呐范围升级轴**（S0 留的主升级轴·接 `deriveSensorTuning`/#60 桥·sonar reach 那套）。守 §10：回归全绿、软门控、d_reveal 只由 mimic 触发、叙述永不交底、敌人别太多。

**B · Phase 3「另一个世界」(§3.7)（需作者在场逐拍）** —— capstone 核心已就位（#69）但「另一个世界」只留钩子。要做：低 san 才出现的节点/路径/事件/回报（`sanityRange` 低段门控泛化·救活 quirk #21 死内容如 `bluecaves.silent_chamber`）；`flag.mimic.false_beacon.survived` 接更深通路；节点版 mimic（填 `spoofsSonar`/`evadesSonar`·与方向 A·S2 天然合流）。**别擅自定演出/触发新 d_reveal 语义（#42）——逐拍敲定。**

**C · 继续铺更深 band / 深段内容（低-中强度，#63/#65/#68/#72 已开好路）** —— ① trench/abyssal/hadal/subhadal 各 4-6 事件，可加密更多欺骗变体；② 开 **>230m 新 band**（depth_bands.json 加一级 + **types/events.ts 加新 ZoneTag〔闲置已全用尽 twilight/midnight/abyssal/hadal/subhadal〕** + 续写事件）。守深段欺骗母题、永不交底、不触发 d_reveal、别加敌人、loot-free。subhadal 已是『深处的诱饵』收束层——更深需想清母题别重复。

**D · Phase 2b 续 / 打磨** —— SPEC 深水区 §5 Phase 2b「仍可续」：① **真·reveal dimming**（衰减接 chart.ts 半径缩·需 reveal 回归一起改·**目前衰减只在蛙跳出潜层兑现、不碰 reveal**）；② 寄存材料设施 + 丢失后果；③ ~~hadal 专属出潜前哨~~（**已做 #73 超渊前哨**·可再加 abyssal 前哨或 reef 第二前哨）；④ 平衡 pass（tunables 在 `engine/outposts.ts` 顶 + `lighthouse_upgrades.json` + `engine/sonar.ts`/`clarity.ts` 顶）。

## 关键约束（深水区 SPEC §9 完整版）
- **回归文化（#22/#26）**：每步全绿——`npx tsc --noEmit` + 全部 playthrough（含 `-sonar`/`-mimic`/`-outpost`/`-bands`/`-sensors`/`-stealth`）+ `-scenarios`(**119**) + `-combat-scenarios` + `-mapgen-scenarios` + `-lighthouse-scenarios` + `node scripts/verify-tutorial.mjs`(**105 事件**) + `smoke-chart-ui.tsx` + prod build（`npx vite build --outDir $(mktemp -d) --emptyOutDir`）。`playthrough.ts` ~12% flake（#18）重试。**bash 上限 45s/call，分批跑（可派 subagent 跑全绿、保主上下文干净）。**
- **声呐/SPEC 实装（方向 A）**：节点没坐标→用 `ui/mapLayout.ts::deriveMapLayout`（已抽好·别再造）；声呐欺骗全走 `clarity.ts::sonarReturn` + `evadesSonar`/`spoofsSonar`（别另起炉灶）；ping 耗电走 `power`/`sonarPingCost`、抬 `alert`（`sonarPingAlertDelta`，已有）；可信度沿 §3.2 + band 倍率 #64；**碰 `NodeSelectView`/`SeaChartView`/`SonarScanPanel` 数据路径必补 `smoke-chart-ui` SSR 断言（已有 E4 声呐图/N1 前哨）**。run 级态（scanMemory/features/扫描态）不入存档、不 bump SAVE_VERSION。S1 加 `DiveNode.features?` 向后兼容（单 feature＝旧行为）。
- **加 band 内容（#63/#65/#68/#72 模板）**：① 新事件文件 import 进 `engine/zones.ts` EVENT_DB（verify-tutorial 注册守卫拦漏）；② band 专属 tag——**ZoneTag 闲置已全用尽**，要在 types/events.ts 加新 ZoneTag；③ 事件只挂该 band tag（#19）；④ scenarios statsDelta 用 `event-runner --out json` 实跑抄（#43：oxygen=-oxygenTurnCost、fail `--sanity 22`+seed1 撞 0.05、success 满 san seed1 撞 0.95；fail 场景顶层 `"stats":{"sanity":22}`+`checkPassed:false`；forceAscend 事件 finalPhase=`ascent`）。
- **加前哨（#66/#67/#73 模板）**：① `lighthouse_upgrades.json::outposts[]` 加 OutpostDef（bandId/submerged?/current?/3 stage 深料账单升序/result）；② 建造事件 `lighthouse.json` 挂对应 band 专属 tag、`visibleIf` flag 门控三阶 + `forbiddenFlags:[s3]`、3 选项 + leave、outcome `advanceOutpostId`；③ 进度走 flag、引擎零改（advanceOutpost/deepestOutpostLaunch 通用）；④ 能源轨在 `lighthouse_upgrades.json::tracks`（outpostOnly/currentOnly 门控）；⑤ `playthrough-outpost.ts` 加节、碰海图 UI 补 `smoke-chart-ui` N1。
- **mimic / capstone（#69）**：`flag.d_reveal` 只由 `mimic.false_beacon` 读穿成功触发（保持暧昧·别廉价触发，#42）；apex 是事件不是战斗敌人；新持久 profile flag 用 `Outcome.setProfileFlags`。
- **存档**：未发布暂不迁移——动 run/profile 形状无需 bump `SAVE_VERSION`(现 4)；新字段靠 `createNewRun`/`createInitialProfile` 种默认 + 反序列化 `?? 默认` 兜底（`scanMemory`/`outpostState`/`shopStock` 先例）。`playthrough-save` 校验 round-trip。
- **UI smoke（#38/#41）**：改 UI 数据路径必补 `smoke-chart-ui.tsx` SSR 断言（信息面板只渲染默认选中 POI＝第一个可出海点）。
- **节点级 clarity 护栏（#62）**：动 `clarityForNode`/reach——① 浅水（≤`CLARITY_FULL_DEPTH`25）必豁免；② reach 上限 < 最深陡降；③ 尸体定位别被深度降档误伤。
- **软门控守则（作者 2026-06-03）**：深度别用硬 flag 锁——靠装备 + 强敌做门。band 不加 `unlockedBy`。声呐/前哨蛙跳/mimic 引诱都软门控。
- **拓扑（#70）**：开阔水域（reef/wreck/层状）单向下潜不可回头、迷路图（蓝洞群+借它的 trench/abyssal/hadal/subhadal）双向可回头；`zoneAllowsBacktrack(zoneId)=mapShape==='maze'`。
- **敌人别太多 / 叙述永不交底（#54） / 别擅自触发 d_reveal（#42）。**
- **沙箱 git（[[sandbox-git-commit]]）**：`git add src scenarios docs scripts`（别 `-A`，根 `CLAUDE.md` 一直 untracked、`.deploy-token.example` 有处 pre-existing untracked 改动·均别提交）；残留锁 `find .git/objects -name 'tmp_obj_*'` + HEAD.lock `mv` 进 `.git/.sandbox-junk/`；`gc.auto 0`；核对只用 `git --no-optional-locks status/log`。提交链：`70f25ef`（mimic #69）→ `34af0cb`（单向预告 #70）→ 声呐与房间 SPEC docs-only（…`1553a7c`→`be2a642`）→ **`f57b17e`（声呐 S0 #71）→ `c4df28b`（渊外 band #72）→ `d8b1e72`（超渊前哨 #73）→ 本次 docs 收尾**。

## 收尾
更新 `docs/STATUS.md`（顶部滚动条目 + 若用 §6 编号补新 quirk）、相关 `SPEC`（深水区 §10 / 声呐与房间 §11 决策日志），自动记忆（[[deep-game-vision]] 若动机制 + [[weekend-content-log]] 若动内容 + [[sandbox-git-commit]] 记 commit + MEMORY.md 索引），把 `docs/NEXT_SESSION_PROMPT.md` 改写成再下一个 session 的 prompt（**整份文件就是 prompt 正文、开头不要加任何说明性前言/「粘进新 session」之类的话——要能直接全选复制粘贴就用**），按 [[sandbox-git-commit]] 提交。
