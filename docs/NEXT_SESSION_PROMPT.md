你在接手「深海回响」(Deep Echo) —— 潜水题材文字冒险 Roguelike（Vite + React + TS），仓库在 `~/Desktop/Blue`。

**当前主线**：深水区 vision 分阶段实装，`docs/spec/深海回响_深水区_SPEC.md` + `docs/spec/深海回响_声呐与房间_SPEC.md` + `docs/spec/深海回响_猎手_SPEC.md` 是源真。深水区四个 Phase 的**核心已全部落地**：**Phase 0**（0a 感知 #58 / 0b 探测 #59 / 升级轨 #60）+ **Phase 1**（band 阶梯+蛙跳 #61 / 节点级 clarity #62 / band 级 alert 倍率 #64）+ **Phase 2**（2a 前哨+真蛙跳 #66 / 2b 能源/衰减/海图前哨 UI/多前哨链 #67 / 真 reveal dimming #76 / 2b 续 材料中转·寄存+寄存丢失+深渊前哨 #79）+ **Phase 3 mimic capstone 核心**（海图假 POI 引诱→入潜兑现→读穿 tell→d_reveal #69）+ **深段内容**（trench #63 / abyssal #65 / hadal #68 / subhadal #72 / 深段多 feature #75 / 周末 trench ping-欺骗 #77 / abyssal·hadal·subhadal 加密 #81 / 40-60m「灯的边缘」#82 / 浅中段≤44m 质感 #85 / **无名渊 >230m 最深一层 nameless #88**）+ **声呐与房间（SPEC 核心+收尾全完成）**（S0 #71 / S1 多事件房间 #74 / S2 不可信扫描 #78 / S3 威胁定位廉价版 #80 / §6.5 宏观 #80 / 声呐范围升级轴 #80 / 即时新 POI #83 / 定向 ping #86 / 房间 feature 数升级 #87）+ **猎手（声呐图上的捕食者）Phase 1 spine #84 + Phase 2 §3 升级规避 #89**。

**上一个 session**（方向 E「猎手 Phase 2+」→ 选 §3·2026-06-06）做一件 + 起手提交周末攒下的内容：

1. **§3 升级规避 T1 吸声 / T2 主动迷彩（#89·猎手 SPEC §3·#86「别朝声感猎手 ping」的天然延续）**：玩家侧规避做成猎手 `stalkerEvadesScan` 的**镜像**——`engine/stalker.ts::playerEvadesStalker(run,stalker)` 按猎手 `sensesBy` 取对应旋钮（声→T1 `soundAbsorbBonus`/光→T2 `camoBonus`/**双感取 min**＝吸声+迷彩两者都有才甩得动·兑现 §2.2「双感要同时切断」），封顶 `STALKER_PLAYER_EVADE_MAX`0.6 + 深 band（≥`STALKER_EVADE_DEPTH`108m）`×STALKER_PLAYER_EVADE_DEEP_MULT`0.5＝**守地板**（§3「无完全隐形·最深/最凶仍找得到你」·对称 `SIGNATURE_MIN_ACTIVE`），确定性 FNV·不耗 RNG。接线＝`advanceStalker` 把「alert 越线」改成「越线**且**未被规避」——被规避那一回合当作信号切断转 `searching`（你真甩得动它·镜像它躲你那一记 ping）。
2. 两旋钮沿 #80/#87 传感器升级桥（7 触点全补·编译期护栏·夹 `STEALTH_BONUS_MAX`0.6）·data 新 `line.evasion_rig`（吸声涂层 lv1 / 主动迷彩 lv2·深料**软门控**）+ `UpgradePanel` 标签。**缺省 0 → 恒 false → advanceStalker 逐字节不变**（additive/gated 守 playthrough-stealth·不 bump SAVE_VERSION）。
3. 起手提交周末无人值守 **#88**（无名渊 band >230m·nameless 9 事件 + 22 scenarios·此前 uncommitted）。全绿 **26/26** + prod build。提交 `c249644`（#88）/ `574ae4a`（#89）+ docs 收尾。

**猎手 SPEC**（`docs/spec/深海回响_猎手_SPEC.md` v0.1，作者 2026-06-06 三问定调）：把抽象「警觉」(#59) 做成有位置、会逼近、按感官显示不同保真度的猎手。§7 分阶段：**✅ Phase 1 spine（#84）** + **✅ Phase 2 §3 升级规避（#89）**。**Phase 2+ 仍 deferred（已 SPEC 捕捉·均需作者逐拍）**：§4 decoy 道具〔战斗中也能逃〕·§5 大型生物狭小空间避难·§6 执着等待者耗资源·§2.1 感知例外〔cunning 猎手 + 低 san「没感觉≠安全」不可信〕·§2.2 per-encounter `sensesBy` 落数据 + active 探测·Q3 浅水小概率弱变体。

**声呐与房间 SPEC**（v0.1）：S0+S1+S2+S3 廉价版 + §6.5 宏观 + 范围升级轴 + 即时新 POI + 定向 ping + 房间 feature 数升级**全部落地——核心+收尾完成**。仅余可选打磨（均小）：定向 ping『各方向 reach 各自升级』细分 / 聚焦扇区可视化 / §5 later（接触带大小·开放水域扫描）。

**已就位的地基**（后续直接用、别另起炉灶）：

* **玩家规避 §3（#89·别另起炉灶）**：`engine/stalker.ts::playerEvadesStalker(run,stalker)`（**对称 `stalkerEvadesScan`**·感官匹配·双感取 min·封顶 `STALKER_PLAYER_EVADE_MAX`·深 band `×STALKER_PLAYER_EVADE_DEEP_MULT`·确定性 `pevade:` 前缀 FNV）·接线在 `advanceStalker`（越线**且**未被规避才 hunting）。旋钮 `soundAbsorbBonus`/`camoBonus` 全链＝`UpgradeEffect`(types/upgrades)→`getUpgradeBonuses`(engine/upgrades)→`UpgradeBonuses`(types/upgrades)→`RunStartBonuses`+`getRunBonuses`(engine/lighthouses)→`createNewRun`(engine/state)→`deriveSensorTuning`(engine/clarity·夹 `STEALTH_BONUS_MAX`)→`SensorTuning`(types/state)。data `line.evasion_rig`(upgrades.json) + `UpgradePanel` 标签。回归 `playthrough-stalker` §8 + `-upgrades` §10 + smoke J8。**decoy(§4) / 感知例外(§2.1) 直接沿这套桥 + stalker.ts 纯逻辑扩，别另起炉灶。**
* **猎手 Phase 1（#84·别另起炉灶）**：`run.stalker?`（`types/state.ts::Stalker`：nodeId 真实位置 / sensesBy 光声双 / onLostSignal wait·seek_last / waitTurns·waitedTurns / state / encounterId / lastSignalNodeId / turnsSinceSignal / seenNodeId·seenTurn 声呐定位·会过时）+ `run.huntEnabled?`（`DepthBand.hunts`→`startDiveFromOutpost` 透传·缺省 undefined → 旧瞬时伏击）。纯逻辑全在 `engine/stalker.ts`（`maybeSpawnStalker` / `advanceStalker` 沿图逼近·切信号搜·脱离 / `scanStalker` 被 ping 扫到才更新 / `stalkerEvadesScan` 深 band ≥108m 躲扫描 / `playerEvadesStalker` #89 / `stalkerSonarBlip`）。**猎手沿图逼近用真拓扑邻接（`buildUndirectedAdjacency`·`nextHopToward` BFS 最短路）＝不穿墙、不瞬移**（作者 2026-06-06 确认「洞里猎手不穿墙·most shouldn't」——若后续要特例穿墙/抄近路的大型 apex，须在该 stalker 显式开 flag·别默认）。接线 `dive.ts::moveToNode` 据 `run.huntEnabled` 分流（→`stalkerStep`·接触触发 `ambushEncounters`；否则旧 `maybeApproachEncounter`·**逐字节守 playthrough-stealth §4-§6**）。渲染 `SonarScanPanel` 深红 `✕` blip + `NodeSelectView` searching 提示。门控 `data/depth_bands.json` trench+ 五个深 band `hunts:true`（nameless 也 true）。回归 `playthrough-stalker` + smoke E8。
* **传感器升级桥（#80/#87/#89 模板）**：所有旋钮经 `UpgradeEffect → getUpgradeBonuses → UpgradeBonuses → getRunBonuses → createNewRun → deriveSensorTuning`（编译期全补·漏一处 typecheck 报错＝护栏）；缺省回退基线＝零行为变化。新增 UpgradeEffect 必补 `UpgradePanel` 标签 + `smoke-chart-ui` J 段。现 **5 升级线**（salvage_guild / tankhouse / sonar_rig / dive_kit / evasion_rig）·`playthrough-upgrades` §1 断言 5 条。
* **定向 ping（#86）**：`engine/sonar.ts::revealSonarScanDirectional` + `nodeSector`（layer 差分扇区·引擎不 import ui/mapLayout）+ `clarity.ts::sonarPingAlertDelta(run,dir?)`（omni 缺省逐字节）+ `pingAimsAtSoundStalker`（声/双感+扇区→暴露尖峰·与 sensesBy 耦合）。`SonarDir`=`'deeper'|'lateral'|'back'`。
* **声呐探索 S0-S3**（#71/#74/#78/#80）：`ui/mapLayout.ts::deriveMapLayout`（节点图→2D·猎手/声呐共用·引擎不依赖）+ `engine/sonar.ts`（`revealSonarScan` BFS / `sonarScanRange` 读 sensorTuning·基线 2 上限 4 / `buildUndirectedAdjacency` 猎手复用）+ `run.scanMemory` + `pingSonar` + `SonarScanPanel`。欺骗/威胁单一来源全在 `engine/clarity.ts`（`nodeSonarView`/`sonarPhantoms`/`effectiveFalseEchoSanity` S2 / `threatContact` S3）·面板纯渲染。
* **多事件房间 S1**（#74）：`DiveNode.features?`（缺省走旧 `eventId`·逐字节不变）+ `DepthBand.maxRoomFeatures`（trench/throat=2·abyssal/hadal/subhadal/nameless=3）+ `enterNodeSelection`/`exploreFeature` + mapgen `maybeMultiFeatureRoom`（仅 `maxRoomFeatures>1` 才进·读 `roomFeatureChanceBonus` 抬大房间率·#87）。
* **深度 band**：`data/depth_bands.json` **7 band**（reef_deep 45-60 / trench_mouth 60-82 / trench_throat 82-108 / abyssal 108-140 / hadal 140-180 / subhadal 180-230 / **nameless 230-290·#88**）+ `engine/bands.ts`。`DepthBand`：`visibility`/`current`/`tags?`（ZoneTag twilight/midnight/abyssal/hadal/subhadal/**nameless** 已全用尽）/`alertFactor?`/`maxRoomFeatures?`/`sonarDeception?`（非单调 0.2/0.28/0.32→0.06→nameless 0.04）/`hunts?`。**>290m 想再深：须 depth_bands.json 加一级 + `types/events.ts` 加全新 ZoneTag（闲置已没了）+ 想清比 nameless『界限没了』更外的母题（很难·nameless 是叙事地板·别硬续）。**
* **深段内容**：`data/events/{trench,abyssal,hadal,subhadal}.json`（约 10/11/10/10）+ `nameless.json`（9·#88·最深）+ `reef.json`（40-60m #82 + 浅中段 #85）+ `blue_caves.json`/`wreck_graveyard.json`（浅中段 #85）。全 loot-free/无敌人/不触发 d_reveal/永不交底、留盲退出口、3 选项。母题：trench『回波对不上』/ abyssal『永远有比最深更深的』/ hadal『上下不是连续的线』/ subhadal『深处的诱饵』/ nameless『你和它界限没了』/ 浅中段『所见为真但有一处不对』。
* **Phase 2 前哨脊柱 + 能源 + 寄存 + reveal dimming**（#66/#67/#76/#79）：`OutpostDef`（`lighthouse_upgrades.json::outposts[]`）+ `engine/lighthouses.ts` + `engine/outposts.ts`（能源/衰减/寄存·`effectiveRevealRadius`·`effectiveStored` 锈蚀）。现 4 前哨 reef_deep/trench_deep/abyssal_deep/hadal_deep。
* **Phase 3 mimic capstone**（#69）：`ChartPoi.mimic?`（chart.ts 注入·软门控 `shouldLureMimic`）→ `startDiveFromPoi(mimic)` 强制兑现 → `data/events/mimic.json`。两 apex 是事件非战斗敌人。

**先 onboarding**（按顺序）

1. 读 `docs/spec/深海回响_猎手_SPEC.md`（若续方向 E 猎手 Phase 2+）——§2 核心模型（§2.1 感知例外留做 / §2.2 感官模态）/ §3-6 后期（§3 升级规避✅·§4 decoy·§5 大型生物·§6 执着等待）/ §7 分阶段（Phase 1✅ + Phase 2 §3✅·其余 deferred）/ §9 守则 / §10 决策日志（末条＝#89）。+ `docs/spec/深海回响_声呐与房间_SPEC.md`（核心+收尾完成）+ `docs/spec/深海回响_深水区_SPEC.md`（北极星·§3.1 两层 clarity·§3.2 不可信声呐·§3.7 另一个世界·§9 守则）。
2. 读自动记忆 [[deep-game-vision]]（北极星 + 全 Phase + 声呐 S0-S3 + 猎手 Phase 1/§3 规避）+ [[weekend-content-log]]（现 ~158 内容事件/7 敌人/7 band）+ [[basebuild-map-revamp]]（前哨/能源/寄存）+ [[sandbox-git-commit]]（提交法）。
3. 读 `docs/STATUS.md` 顶部滚动条目 #89（§3 规避）+ #88（无名渊）+ `docs/archive/CHANGELOG.md` 末尾 #89/#88/#87/#86/#85/#84/#83 + 复用项 #80/#69/#67/#66/#64/#63/#58/#52/#62/#43/#19。**已知 quirk/约定在 `docs/QUIRKS.md`（编号只增不重排·别处引用 quirk #N）。**
4. 跑 `npm run regress` 确认起点干净（一条命令全绿 **26/26**·~7-8s）。**起手先 `git --no-optional-locks log --oneline -3` 核对真实 HEAD**（夜间/周末引擎可能在 session 间又提了 commit 或留 uncommitted 内容·见 [[sandbox-git-commit]] 末条教训）。

**本 session：从下面选一（作者定方向）**

> **猎手 §3 升级规避已完成（#89）。** E 续（其余 Phase 2 beat）与 B 多需作者在场逐拍；C/D 可自走。

**E · 猎手 Phase 2+ 其余**（需作者逐拍·`docs/spec/深海回响_猎手_SPEC.md` §4-6/§2.1-2.2）——§3 规避刚把「玩家躲猎手」做实、与 sensesBy 耦合。天然续接：
* **§4 decoy 道具**（§3 的对偶·最顺手起手）：新 item 类型 + 下潜内投放引开猎手（按感官声诱/光诱·让它转 `seek_last` 去诱饵点）+ **combat 内用于逃跑**（接现有 flee）。沿 items/upgrades 桥 + `engine/stalker.ts` 纯逻辑扩。
* **§2.1 感知例外**（作者 #84 续校正·留做）：感知「有东西在接近」不靠点灯（关灯也感觉得到·摸黑后凭感觉是否消退判断猎手何时离开·别做成「关灯就感觉不到」）；但**狡猾猎手 + 低 san** 时「没感觉≠安全」要变得不可信（cunning 关灯也甩不掉感觉 / 低 san 关灯有伪感觉）——现感知纯 alert/stalker 驱动·两例外未实装（与 S2 低 san 伪接触同源）。
* **§5 大型生物 + 狭小空间避难** / **§6 执着等待者耗资源** / **§2.2 per-encounter `sensesBy` 落数据 + active 探测** / **Q3 浅水小概率弱变体**（需浅水捕食者内容·不破 §7.5 浅水免压回归）。
* 守则：复用 ambushEncounters 不加新常规敌（apex 例外）、可生存无脚本死、摸黑是阀门、不触发 d_reveal、additive/gated 守 playthrough-stealth、碰猎手必补 `playthrough-stalker` + smoke E8。

**B · Phase 3「另一个世界」(深水区 §3.7)**（需作者在场逐拍）——capstone 核心已就位（#69）但「另一个世界」只留钩子：低 san 才出现的节点/路径/事件/回报（`sanityRange` 低段门控泛化·救活 quirk #21 死内容）；`flag.mimic.false_beacon.survived` 接更深通路；节点版 mimic（S2 `spoofsSonar` 假信标）引向兑现事件＝把海图 mimic 的「引诱→兑现」搬进下潜内。别擅自定演出/触发新 d_reveal（#42）。

**C · 继续铺深段内容**（低-中·可自走·#63/#65/#68/#72/#75/#81/#85/#88 已开好路）——trench/abyssal/hadal/subhadal/nameless 继续加密欺骗变体（现约 10/11/10/10/9）。**注意：开 >290m 比 nameless 更深的 band 不推荐**（ZoneTag 用尽 + nameless『界限没了』是叙事地板·硬续易重复/破调）；C 现实意义＝深段变体加密，不是再开新 band。守深段守则、永不交底、不触发 d_reveal、别加敌人、loot-free。

**D · 打磨 / Phase 2b 续 / A 残余**（已收窄·低强度·可自走）——Phase 2b 三齿已闭环（#79）；仍可续：寄存丢失更狠后果 / reef 第二前哨（侧向）/ 维护账单随深度分级 / 平衡实测 pass（tunables 在 `engine/outposts.ts`/`clarity.ts`/`sonar.ts`/`stalker.ts` 顶〔含 #89 的 `STALKER_PLAYER_EVADE_MAX`/`STALKER_PLAYER_EVADE_DEEP_MULT`/`STEALTH_BONUS_MAX`〕 + `lighthouse_upgrades.json`/`upgrades.json`）。**A 残余打磨**（声呐与房间 SPEC 仅剩这些·均小）：定向 ping『各方向 reach 各自升级』细分 / 声呐图聚焦扇区可视化（`SonarScanPanel` 用 `sonarDir` 画扇区弧）/ §5 later（接触带大小·开放水域扫描）。

**关键约束**（深水区 SPEC §9 + 猎手 SPEC §9）

* **回归文化（#22/#26）**：一条命令跑全绿＝`npm run regress`（进程隔离并行·typecheck + 全部 playthrough〔含 `-stalker`〕+ scenarios + verify-tutorial + smoke + prod build·**26/26**·~7-8s）。新 `playthrough*.ts` 自动被 regress 发现注册。迭代只跑子集 `npm run regress -- --only typecheck,<子系统>`。commit 前跑一次全绿。
* **猎手（#84/#89 模板·别另起炉灶）**：纯逻辑全在 `engine/stalker.ts`（确定性·不耗 RNG·玩家规避 `playerEvadesStalker` 对称 `stalkerEvadesScan`）·渲染住 `SonarScanPanel`/`NodeSelectView`（纯渲染·别加判定分支）·接线住 `dive.ts`。`run.huntEnabled` 缺省 off → 旧 `alert→maybeApproachEncounter` 瞬时伏击（**逐字节守 playthrough-stealth §4-§6**）；门控走 `DepthBand.hunts`。接触**复用 `ambushEncounters`**·不加新常规敌（apex 是事件例外）。猎手沿真拓扑邻接逼近·**不穿墙**（特例穿墙须显式 flag）。碰它必补 `playthrough-stalker` + smoke E8。
* **传感器升级桥（#80/#87/#89 模板）**：所有旋钮经 `UpgradeEffect → getUpgradeBonuses → UpgradeBonuses → getRunBonuses → createNewRun → deriveSensorTuning`（编译期全补·漏一处 typecheck 报错＝护栏）；缺省回退基线＝零行为变化。新增 UpgradeEffect 必补 `UpgradePanel` 标签 + `smoke-chart-ui` J 段 + `playthrough-upgrades`（新增升级线记得改 §1 的线数断言）。
* **威胁/欺骗/猎手表象（S2 #78 / S3 #80 / 猎手 #84 模板）**：声呐图上的不可信/威胁/猎手表象走 `clarity.ts`〔欺骗/威胁〕/`stalker.ts`〔猎手位置/玩家规避〕单一来源·面板纯渲染。碰 `NodeSelectView`/`SeaChartView`/`SonarScanPanel` 数据路径必补 `smoke-chart-ui` SSR 断言（E4 声呐图/E4b 定向 ping/E5 房间/E6 不可信/E7 威胁/E8 猎手/J 升级标签/L 灯塔+海况/N 前哨/O mimic）。
* **存档**：未发布暂不迁移——动 run/profile 形状无需 bump `SAVE_VERSION`(现 4)；新字段靠 `createNewRun`/`createInitialProfile` 种默认 + 反序列化 `?? 默认` 兜底（`scanMemory`/`sonarDeception`/`huntEnabled`/`stalker`/`sonarDir`/`outpostState`/`soundAbsorbBonus`/`camoBonus` 先例·纯对象 JSON 自动 round-trip）。
* **软门控（作者 2026-06-03）**：深度别用硬 flag 锁——靠装备 + 强敌做门。band 不加 `unlockedBy`；声呐/前哨蛙跳/mimic 引诱/猎手 `hunts`/定向 ping/规避升级都软门控。
* **拓扑（#70）**：开阔水域单向下潜不可回头、迷路图双向可回头；`zoneAllowsBacktrack(zoneId)=mapShape==='maze'`。
* **敌人别太多 / 叙述永不交底（#54） / 别擅自触发 d_reveal（#42）**。
* **沙箱 git（[[sandbox-git-commit]]）**：`git add src scenarios docs scripts`（别 `-A`，根 `CLAUDE.md` 一直 untracked、`.deploy-token.example` 有处 pre-existing untracked 改动·均别提交）；**连提多次必须每次 commit 后就 `mv` 收容 HEAD.lock**（否则下次 commit 堵住）；残留锁 `find .git/objects -name 'tmp_obj_*'` + HEAD.lock `mv` 进 `.git/.sandbox-junk/`；`gc.auto 0`；核对只用 `git --no-optional-locks status/log`。**若周末/夜间引擎并发留了 uncommitted 内容（如 #88）→ 起手先单独提交它（`git add` 列具体目录/文件·别把它与你的改动混进一个 commit·别带 docs/STATUS 若被它改过）。**

**收尾**
按新文档约定更新：**进度（编号锚点）追加到 `docs/archive/CHANGELOG.md`**（别堆 STATUS 头部）·持久 gotcha/约定写 `docs/QUIRKS.md`（编号只增不重排）·`docs/STATUS.md` 只留当前状态 + 最近 ~2 个 session 头部 blockquote。相关 `SPEC`（猎手 §10 / 声呐与房间 §11 / 深水区 §10 若动机制）。自动记忆（[[deep-game-vision]] 若动机制 + [[weekend-content-log]] 若动内容 + [[basebuild-map-revamp]] 若动前哨 + [[sandbox-git-commit]] 记 commit + MEMORY.md 索引——**注意 MEMORY.md 已超大小上限·索引行别再加长·必要时跑 consolidate-memory 精简**）。把 `docs/NEXT_SESSION_PROMPT.md` 改写成再下一个 session 的 prompt（整份文件就是 prompt 正文、开头不要加任何说明性前言——要能直接全选复制粘贴就用），按 [[sandbox-git-commit]] 提交。
