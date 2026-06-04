下个 session 的 prompt — Phase 0 全闭 + Phase 1 深度轴（plumbing + 节点级 clarity）+ trench 专属内容「回波对不上」均已落地，下一步 Phase 2 前哨 / 继续铺 trench·更深 band 内容 / 或 band 级 alert 曲线（Phase 1 续仅剩这一小块）
直接把下面（含本行以下全部）粘进新 session 即可。

你在接手「深海回响」(Deep Echo) —— 潜水题材文字冒险 Roguelike（Vite + React + TS），仓库在 `~/Desktop/Blue`。

**当前主线**：深水区 vision 分阶段实装，`docs/深海回响_深水区_SPEC.md` 是源真。**Phase 0 全闭**（0a 感知 #58 / 0b 探测 #59 / 升级轨 #60）+ **Phase 1 深度轴 plumbing**（band 阶梯 + 蛙跳下潜 #61）+ **Phase 1 续·节点级 clarity**（深度分档 + 范围/分辨升级 #62）+ **trench 专属内容**（band.tags + `trench.json` 6 事件「回波对不上」#63）均已落地。SPEC §11（Phase 0）+ §12（Phase 1，含范围/分辨 + trench 内容已勾）均完结、§10 决策日志记了六次拍板。

Phase 0+1 + trench 内容 已就位的地基（后续直接用）：
- `engine/clarity.ts`：感知（`clarity(run)` 天花板三态 / `clarityForNode(run,node)` 节点级深度降档 / `sonarReturn` / `lampPreview` / `signature`）+ 探测（`alertDelta` / `alertDepthFactor` / `predatorApproaches`）+ 升级派生（`deriveSensorTuning` / `sonarPingCost`，run.sensorTuning，含 lamp/sonarDepthReach）+ tunables/地板上限（文件顶，含 `ALERT_DEPTH_FULL` / `CLARITY_FULL_DEPTH` / `LAMP_DEPTH_REACH` / `SONAR_DEPTH_REACH` + 各 MAX）。
- **节点级 clarity（#62）**：`enterNodeSelection` per-choice 烤 `clarityForNode`——浅水 ≤25m 豁免＝所见为真；深水里灯只照得到近处（dd≤6m full）、灯够不到的陡降没声呐就黑、声呐补中段（dd≤14m）、太深连声呐都没回波；横/上行不降档。reach 升级〔dive_kit.lv4 灯 / sonar.lv3 声呐〕有上限 < 最深陡降。Lv.1 尸体豁免深度降档（守 #36）。`NodeChoice.clarity` + UI `clar-<档>` 早 per-choice、UI 零改。
- **深度 band（Phase 1）**：`data/depth_bands.json`（全局阶梯，band 引用 zone 内容、绝对 depthRange 覆盖 zone）+ `engine/bands.ts`（`getBands`/`getBand`/`bandDiveModifier`）+ `mapgen GenOpts.depthRange` 覆盖 + `dive.ts::startDiveFromOutpost`（蛙跳，home 灯塔 stand-in，走 getRunBonuses）+ SeaChartView 蛙跳列表。3 band：reef_deep 45-60 / trench_mouth 60-82 / trench_throat 82-108。
- **band 级 tag 池（#63，新）**：`DepthBand.tags?: ZoneTag[]` 覆盖 zoneTagsByDepth → 给 band 专属事件池。经 `startDiveFromOutpost(band.tags) → startDive(opts.bandTags) → mapgen GenOpts.bandTags → ①节点 zoneTag 抽取 `opts.bandTags ?? tagsForDepth` ②buildEventPool(tagsOverride)`。trench_mouth=`[cave,twilight]`/trench_throat=`[cave,midnight]`（附加 cave 保回退）。**`ZoneTag` 里 `twilight`/`midnight`/`abyssal` 是既有但闲置值——续更深 band 直接用 `abyssal`（>108m）、零类型改动。**
- **trench 内容（#63）**：`data/events/trench.json` 6 事件「回波对不上」（声呐返回≠点灯真相）——`the_return`(假底)/`second_diver`(假人·corpse-wearer 声呐侧)/`the_sounding`(距离不对)/`the_wall`(假墙)/`the_answer`(被应答)/`no_echo`(没有回波)。全 loot-free/无敌人/不触发 d_reveal/永不交底，新 `lore.trench.*`。
- run 状态 `sensors{light,sonar,sonarUnlocked}` + `power`/`powerMax` + `alert` + `sensorTuning`。升级桥：`UpgradeEffect → getUpgradeBonuses → getRunBonuses → createNewRun → deriveSensorTuning`（`RunStartBonuses` 是 createNewRun bonuses 超集，dive/dialog 直接整个传；加旋钮就照这条桥抄一遍）。
- 升级线 4 条（打捞行会/气瓶库/sonar_rig〔解锁+ping省电+抗欺骗+reach lv3〕/dive_kit〔电池/灯效率+隐蔽/灯抗欺骗+灯 reach lv4〕）；`ZoneDef.ambushEncounters`（三深水 zone）；`node.evadesSonar?`/`spoofsSonar?` 钩子（Phase 3 mimic 待填）。

先 onboarding（按顺序）
1. **读 `docs/深海回响_深水区_SPEC.md`**，重点 §3.6（前哨/能源，Phase 2）/ §5（Phase 2/3）/ §3.5（mimic capstone）/ §12（Phase 1 已做含节点级 clarity + trench 内容 + Deferred 清单）/ §8 tunables / §9 守则。
2. 读自动记忆 [[deep-game-vision]]（北极星 + Phase 0/1 + trench 内容已建状态）+ [[weekend-content-log]]（内容覆盖：现 87 事件/7 敌人，trench band 已有专属内容）。
3. 读 `docs/STATUS.md` **quirk #58/#59/#60/#61/#62/#63（Phase 0+1+trench 全貌）** + Phase 2 相关：#52（Phase C reach/reveal/`restoreLighthouse` 修复事件——前哨复用）、#51（`engine/lighthouses.ts` 灯塔模型）、#50（材料经济双资源）；深度轴：#30/#49（depthOffset）、#47（zoneTagsByDepth）。
4. 跑全绿确认起点干净（§9，含 `playthrough-sensors`/`-stealth`/`-bands`〔现 §8 band.tags 断言〕）。

## 本 session：从下面三选一（作者定方向）

**A · Phase 2 跨 run 供给前哨 + 能源经济（深度脊柱的"真"地基）** —— SPEC §3.6/§5 Phase 2。把 `lighthouse.ruin_north`（一次性修复，quirk #52）扩成**多阶段、跨 run 持久前哨**（这一潜找部件、下一潜运一个、半亮扛过死亡）；每前哨建成＝解锁下一 band + 宏观 clarity 下延 + 一个**蛙跳出潜点**（把 `startDiveFromOutpost` 的 home stand-in 换成真·最深前哨）。含能源经济（base 层、跑设施、水上不衰减/水下衰减·水流区更快但可水力发电）。**改动大、碰存档（要 bump SAVE_VERSION + 迁移，或仍按"未发布不迁移"——问作者）。开建前 AskUserQuestion pin 前哨阶段数/能源模型/衰减后果数值。**

**B · 继续铺 trench / 更深 band 内容（低-中强度，#63 已开好路）** —— band.tags 机制（#63）已就位，加内容很轻：① trench band 现各 3 事件（twilight/midnight），可再加密（更多「回波对不上」感官变体，或别的深段欺骗母题）；② **开 abyssal band（>108m）**——depth_bands.json 加一级 + `tags:["abyssal"]`（既有闲置 ZoneTag）+ trench.json 续写 abyssal 事件，递归更深（"永远有比最深更深的"）。守深段欺骗母题（§3.5/[[deep-game-vision]]）、叙述永不交底（#54）、不触发 d_reveal（#42）、别加敌人（守 2/zone，mimic/corpse-wearer 是 Phase 3 apex 例外）、loot-free。节点级 clarity（#62）就位——深 band 陡降变黑、借此设计"看不清才往下走"张力。

**C · Phase 1 续收尾（引擎打磨，最小）** —— 节点级 clarity（#62）+ band 级 tag 池（#63）都已做完，仅剩 **band 级 alert 倍率 / 越深越狠不饱和的成本曲线**（现 `ALERT_DEPTH_FULL` 60 饱和——更深 band 探测压力不再加重）：给 `DepthBand` 加可选 alert 倍率字段、`alertDepthFactor` 读 band 让 trench 比 reef_deep 更凶。不碰存档、改动可控。**注：这是 Phase 1 续唯一剩项，比 A/B 小很多。**

## Phase 3 留着
- **Phase 3 mimic capstone + 「另一个世界」**＝与作者一起一个个敲定的专门 session，必须 Phase 2 完成后做；**别擅自触发 `flag.d_reveal`**（#42）。`spoofsSonar`/`evadesSonar` 钩子已就位待填；深段伏笔（浅/中/深三层 + **trench band「回波对不上」#63**）已成型待回收。

## 关键约束（§9 完整版）
* **回归文化（#22/#26）**：每步全绿——`npm run typecheck` + 全部 playthrough（**含 `-sensors`/`-stealth`/`-bands`**）+ `-scenarios` + `-combat-scenarios` + `-mapgen-scenarios` + `-lighthouse-scenarios` + `verify-tutorial` + `smoke-chart-ui.tsx` + prod build（`npx vite build --outDir $(mktemp -d) --emptyOutDir`）。`playthrough.ts` ~12% flake（#18）重试。
* **加 band 专属内容（#63 模板）**：① 新事件文件 import 进 `engine/zones.ts` EVENT_DB（verify-tutorial 注册守卫会拦漏）；② band 专属 tag 复用 `ZoneTag` 既有闲置值（twilight/midnight/abyssal）＝零类型改动；③ 事件只挂该 band tag（#19 单 tag）；④ scenarios statsDelta 用 `event-runner --out json` 实跑抄（#43，oxygen=-oxygenTurnCost、fail 用 `stats.sanity:22`+seed 1 撞 0.05 clamp、success 满 san seed 1 撞 0.95）。
* **存档**：**未发布暂不做迁移**（作者 2026-06-03）——动 run/profile 形状也无需 bump `SAVE_VERSION`(现 4)；新字段靠 `createNewRun` 种默认 + 反序列化 `?? 默认` 兜底；`playthrough-save` 校验 round-trip。**Phase 2 若动 profile.lighthouses 持久形状，问作者是否破例迁移。**
* **UI smoke（#38/#41）**：改了 UI 数据路径必补 `smoke-chart-ui.tsx` SSR 断言。**护栏：`UpgradePanel::renderEffect` 是穷尽 switch——加 `UpgradeEffect` kind 必补 UI 标签（typecheck 会拦）。**
* **节点级 clarity 护栏（#62）**：动 `clarityForNode`/reach 时——① 浅水（≤`CLARITY_FULL_DEPTH`）必须豁免；② reach 上限必须 < 最深陡降；③ 既有按 run 级 clarity 门控的功能（如尸体定位）别被节点级降档误伤（尸体已豁免）。
* **敌人别太多**：各 zone 已 2 敌，mimic/corpse-wearer 是 Phase 3 apex 例外；别加常规第三只。
* **叙述永不交底（#54）** / **别擅自触发 d_reveal（#42）**。
* **软门控守则（作者 2026-06-03，Phase 1）**：深度别用硬 flag 锁——靠装备（声呐/电池/升级，吃深料）+ 强敌做门。band 不加 `unlockedBy`。
* **沙箱 git（[[sandbox-git-commit]]）**：`git add src scenarios docs scripts`（别 `-A`，根 `CLAUDE.md` 一直 untracked、别提交）；残留锁 `find .git/objects -name 'tmp_obj_*'` + HEAD.lock `mv` 进 `.git/.sandbox-junk/`；`gc.auto 0`；核对只用 `git --no-optional-locks status/log`。

## 收尾
更新 `docs/STATUS.md`（滚动 + §3 模块 + §6 新 quirk）、`SPEC`（续清单 / §10 决策日志 / 勾 §5/§12）、自动记忆（[[deep-game-vision]] 若动机制 + [[weekend-content-log]] 若动内容 + MEMORY.md 索引）、把本文件改写成再下一个 session 的 prompt，按 [[sandbox-git-commit]] 提交。
