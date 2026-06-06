你在接手「深海回响」(Deep Echo) —— 潜水题材文字冒险 Roguelike（Vite + React + TS），仓库在 `~/Desktop/Blue`。

**当前主线**：深水区 vision 分阶段实装，`docs/深海回响_深水区_SPEC.md` + `docs/深海回响_声呐与房间_SPEC.md` + `docs/深海回响_猎手_SPEC.md` 是源真。深水区四个 Phase 的**核心已全部落地**：**Phase 0**（0a 感知 #58 / 0b 探测 #59 / 升级轨 #60）+ **Phase 1**（band 阶梯+蛙跳 #61 / 节点级 clarity #62 / band 级 alert 倍率 #64）+ **Phase 2**（2a 前哨+真蛙跳 #66 / 2b 能源/衰减/海图前哨 UI/多前哨链 #67 / 真 reveal dimming #76 / 2b 续 材料中转·寄存+寄存丢失+深渊前哨 #79）+ **Phase 3 mimic capstone 核心**（海图假 POI 引诱→入潜兑现→读穿 tell→d_reveal #69）+ **深段内容**（trench #63 / abyssal #65 / hadal #68 / subhadal #72 / 深段多 feature #75 / 周末 trench ping-欺骗 #77 / abyssal·hadal·subhadal 加密 #81 / 40-60m「灯的边缘」#82）+ **声呐与房间**（S0 扫描 #71 / S1 多事件房间 #74 / S2 不可信扫描 #78 / S3 威胁定位廉价版 #80 / §6.5 宏观灯塔扫描+海况 #80 / 声呐范围升级轴 #80 / **即时新 POI 浮现 #83**）+ **猎手（声呐图上的捕食者）Phase 1 spine #84**。

**上一个 session**（方向 A「声呐与房间收尾」，2026-06-06）做两件 + 收编上上个周末无人值守攒下的内容：

1. **即时新 POI 浮现（#83·补 #80 留的尾巴）**：建灯 / 点亮前哨后新进范围的 POI **当场浮现**（不必等下个 run）。`SeaChartView` 的 chart memo 依赖从只 `runsCompleted` 加上**灯塔覆盖签名**（lighthouses 坐标 + 设施 + `effectiveRevealRadius` + flags）→ 中途建灯/升级当场重算（复用既有 `.chart-survey-sweep`/`.chart-poi-arrive`·engine reveal 集合不变）。`chart.ts` roaming 选取从「顺序加权抽」（依赖池子组成·池变大会整组重洗）改成 **pool-independent 确定性键**（Efraimidis–Spirakis A-Res：`key = u^(1/weight)`·u 由 (runsCompleted, templateId) FNV 哈希·保留加权语义）+ roaming 模板键 id `poi.roam.<run>.<templateId>`＝同 runsCompleted 重算稳定、不重洗已显示机会点（至多被更高优先的新点亮挤掉一个）。删 `generateChart` 的 `rng` 入参。`playthrough-chart` §8。
2. **猎手 SPEC + Stalker Phase 1 spine（#84·作者三问拍板）**：声呐与房间 §8.7 此前留作者拍板的「定位 stalker」开题；作者三问把它从「图上一个 blip」扩成完整愿景 → 另立 `docs/深海回响_猎手_SPEC.md` v0.1，§8.7 stalker 交它接管。Phase 1 spine 实装（见下「已就位地基」）。
3. 收编周末无人值守内容 **#81/#82**（abyssal/hadal/subhadal 加密 + 40-60m「灯的边缘」reef.json·此前 uncommitted）一并提交。全绿 **26/26**（playthrough-stalker 自注册 +1）+ prod build。

**声呐与房间 SPEC**（`docs/深海回响_声呐与房间_SPEC.md` v0.1）：S0+S1+S2+S3 廉价版 + §6.5 宏观（揭示动画+海况遮蔽）+ 声呐范围升级轴 + **即时新 POI 浮现（#83）** 已全落地。**§8.7 定位 stalker 已升级为「猎手」子系统、交 `docs/深海回响_猎手_SPEC.md` 接管**。声呐与房间 SPEC 仅剩作者拍板/新机制：**定向 ping（§5·暴露按方向计）/ 房间 feature 数升级**＝下方方向 A 的尾巴。

**猎手 SPEC**（`docs/深海回响_猎手_SPEC.md` v0.1，作者 2026-06-06 三问定调）：把抽象「警觉」(#59) 做成有位置、会逼近、按感官显示不同保真度的猎手。§7 分阶段：**✅ Phase 1 spine（#84）**＝感知分层（灯=接近 / 声呐=位置·**同一猎手**）+ 出现/逼近/接触（统一·复用 ambushEncounters）+ 丢信号性格（wait〔waitTurns=0 掉头就走 / N 等一阵再走〕/ seek_last 去上次信号点徘徊再走·#84 续校正）+ 摸黑/拉距/上浮脱离 + 深 band 门控（DepthBand.hunts·additive/gated）。**Phase 2+ deferred（已 SPEC 捕捉）**：升级规避 T1 吸声/T2 主动迷彩（§3）·decoy 道具〔战斗中也能逃〕（§4）·大型生物狭小空间避难（§5）·执着等待者耗资源（§6）·浅水小概率弱变体（Q3·§7）·完整感官模态分类落数据（per-encounter sensesBy·§2.2）·active 探测行为。

**已就位的地基**（后续直接用、别另起炉灶）：

* **猎手 Phase 1（#84·别另起炉灶）**：`run.stalker?`（`types/state.ts::Stalker`：nodeId 真实位置 / sensesBy 光声双 / onLostSignal hold·seek_last / state hunting·searching·lost / encounterId / lastSignalNodeId / turnsSinceSignal / seenNodeId·seenTurn 声呐定位·会过时）+ `run.huntEnabled?`（`DepthBand.hunts`→`startDiveFromOutpost` 透传·缺省 undefined → 旧瞬时伏击路径）。**run 级·派生·纯对象·JSON 自动 round-trip·不 bump SAVE_VERSION**。纯逻辑全在 `engine/stalker.ts`（`maybeSpawnStalker` 量程外现身 / `advanceStalker` 沿图逼近〔无向 BFS·复用 sonar 邻接〕·切信号→按性格搜→脱离〔`onLostSignal` 两机制 `wait`〔原地等 `waitTurns` 回合·0＝掉头就走/N＝等一阵〕/`seek_last`〔先到上次信号点·抵达再等 `waitTurns` 徘徊·够不到则 `STALKER_SEEK_MAX_TURNS` 放弃〕·新字段 `waitTurns`/`waitedTurns`〕 / `scanStalker` **被 ping 扫到才更新位置** §8.7 / `stalkerEvadesScan` 深 band〔≥108m〕声/双感躲扫描 / `stalkerSonarBlip` 渲染读这里）。接线在 `dive.ts`：`moveToNode` 据 `run.huntEnabled` 分流（→`stalkerStep`：现身/逼近·接触触发现有 `ambushEncounters` 伏击；否则旧 `maybeApproachEncounter` 瞬时·**逐字节守 playthrough-stealth §4-§6**）+ `pingSonar` 调 `scanStalker` 定位。渲染：`SonarScanPanel` 精确深红 `✕` blip（`.sonar-stalker`·会过时渐隐·压住模糊威胁接触 `.sonar-threat`）+ `NodeSelectView` 既有 alert-warning（灯=「有东西在接近」）+ 新 searching 提示。门控：`data/depth_bands.json` trench_mouth 及更深五个深 band 设 `hunts: true`（reef_deep 不设）。回归 `playthrough-stalker` + smoke E8。
* **即时新 POI / roaming pool-independent（#83·别另起炉灶）**：`engine/chart.ts::roamingKey`（Efraimidis–Spirakis 加权键·`condHash` 复用）+ `generateChart`（无 `rng` 入参·roaming 取 top-N by key·模板键 id）；`ui/SeaChartView.tsx` `chartSig`（灯塔覆盖签名·memo 依赖）。锚点本就不受选取限制、重算即浮现；roaming 重算稳定。
* **声呐探索 S0-S3**（#71/#74/#78/#80）：`ui/mapLayout.ts::deriveMapLayout`（节点图→2D 坐标·猎手/声呐共用）+ `engine/sonar.ts`（`revealSonarScan` 无向 BFS / `sonarScanRange` 读 sensorTuning·基线 2 上限 4 / `buildUndirectedAdjacency` 猎手也复用 / `scanFreshness`）+ `run.scanMemory` + `dive.ts::pingSonar`（写 scanMemory + 抬 alert + 1 scan/停留 guard + 定位猎手）+ `ui/SonarScanPanel`。欺骗/威胁单一来源全在 `engine/clarity.ts`（`nodeSonarView`/`sonarPhantoms`/`effectiveFalseEchoSanity` S2 / `threatContact` S3 廉价版）、面板纯渲染。
* **多事件房间 S1**（#74）：`DiveNode.features?`（缺省走旧 `eventId` 单事件·逐字节不变）+ `DepthBand.maxRoomFeatures`（trench/throat=2·abyssal/hadal/subhadal=3）+ `enterNodeSelection`/`exploreFeature`（付氧·`run.activeFlags` 的 `feat:<nid>:<fid>`）+ mapgen `maybeMultiFeatureRoom`（仅 `maxRoomFeatures>1` 才进=缺省零额外 rng）。
* **深度 band**：`data/depth_bands.json` 6 band（reef_deep 45-60 / trench_mouth 60-82 / trench_throat 82-108 / abyssal 108-140 / hadal 140-180 / subhadal 180-230）+ `engine/bands.ts`。`DepthBand`：`visibility`/`current`/`tags?`（ZoneTag twilight/midnight/abyssal/hadal/subhadal 已全用尽）/`alertFactor?`/`maxRoomFeatures?`/`sonarDeception?`（非单调 0.2/0.28/0.32→0.06）/**`hunts?`（#84·trench+ 开）**。>230m：depth_bands.json 加一级 + `types/events.ts` 加新 ZoneTag（闲置已没了）。
* **深段内容**：`data/events/{trench,abyssal,hadal,subhadal}.json`（约 10/11/10/10·#81 后）+ `reef.json` 40-60m「灯的边缘」（#82）。全 loot-free/无敌人/不触发 d_reveal/永不交底、留盲退出口、3 选项。母题：trench『回波对不上』/ abyssal『永远有比最深更深的』/ hadal『上下不是连续的线』/ subhadal『深处的诱饵』。
* **Phase 2 前哨脊柱 + 能源 + 寄存 + reveal dimming**（#66/#67/#76/#79）：`OutpostDef`（`lighthouse_upgrades.json::outposts[]`）+ `engine/lighthouses.ts` + `engine/outposts.ts`（能源/衰减/寄存·`effectiveRevealRadius`·`effectiveStored` 锈蚀）。现 4 前哨 reef_deep/trench_deep/abyssal_deep/hadal_deep。寄存逻辑全在 outposts.ts（守单向依赖 outposts.ts→lighthouses.ts）。
* **Phase 3 mimic capstone**（#69）：`ChartPoi.mimic?`（chart.ts 注入·软门控 `shouldLureMimic`）→ `startDiveFromPoi(mimic)` 强制兑现 → `data/events/mimic.json`。两 apex 是事件非战斗敌人。

**先 onboarding**（按顺序）

1. 读 `docs/深海回响_猎手_SPEC.md`（若做方向 A 尾巴 / 猎手 Phase 2+）——§2 核心模型 / §3-6 后期（升级规避·decoy·大型生物·执着等待）/ §7 分阶段（Phase 1 已勾·Phase 2+ deferred）/ §9 守则 / §10 决策日志。+ `docs/深海回响_声呐与房间_SPEC.md`（§5 声呐扫描含定向 ping·§6 多事件房间·§8 子决策·§11 决策日志末条＝#83/#84）+ `docs/深海回响_深水区_SPEC.md`（北极星·§3.1 两层 clarity·§3.2 不可信声呐·§3.7 另一个世界·§9 守则）。
2. 读自动记忆 [[deep-game-vision]]（北极星 + 全 Phase + 声呐 S0-S3 + 猎手 Phase 1）+ [[weekend-content-log]]（现 ~127 内容事件/7 敌人）+ [[basebuild-map-revamp]]（前哨/能源/寄存）+ [[sandbox-git-commit]]（提交法）。
3. 读 `docs/STATUS.md` 顶部滚动条目 #84（猎手 Phase 1）+ #83（即时 POI）+ #82/#81（周末内容）+ #80/#79/#78/#76/#74/#69/#67/#66 + 复用项 #64/#63/#58/#52/#62/#43/#19。
4. 跑 `npm run regress` 确认起点干净（§9·一条命令全绿 **26/26**·~7-8s）。

**本 session：从下面选一（作者定方向）**

**A · 声呐与房间收尾 残余**（小·风险中低·声呐与房间 SPEC §5）——核心 + 即时 POI 已落地（#80/#83），仅剩：
* **定向 ping（§5·新机制·中风险）**：把声呐朝一方向聚焦——那方向探更远（别处更短）+ 战术隐蔽（别朝敌人方向 ping＝少招它·暴露按方向计·不再全向一律）。接 `sonarScanRange` + `sonarPingAlertDelta`；与猎手的 sensesBy/evade 天然耦合（别朝声感猎手方向 ping）。
* **房间 feature 数升级（#74 尾巴·低风险）**：升级提高 `maxRoomFeatures` 或大房间出现率（接 `deriveSensorTuning`/mapgen `rollExtraFeatures`·沿 #80 传感器升级桥）。

**E · 猎手 Phase 2+**（需作者逐拍·风险中高·`docs/深海回响_猎手_SPEC.md` §3-6）——Phase 1 spine 已落地，下面都是新机制、作者口述已捕捉但要逐拍敲：
* **升级规避 T1 吸声 / T2 主动迷彩（§3）**：沿传感器升级桥（#60/#80）给玩家「躲过声感/光感猎手」的能力（对称于猎手 evade 你）·守地板（无完全隐形）。
* **decoy 道具（§4）**：新 item 类型 + 下潜内投放引开猎手（按感官声诱/光诱）+ combat 内用于逃跑（接现有 flee）。
* **大型生物 + 狭小空间避难（§5）** / **执着等待者耗资源（§6）** / **浅水小概率弱变体（Q3·需浅水捕食者内容·不破 §7.5 浅水免压回归）** / **完整感官模态分类落数据（per-encounter sensesBy）+ active 探测行为**。
* **感知例外（作者 #84 续校正·§2.1 留做）**：感知「有东西在接近」不靠点灯（关灯也感觉得到·这样摸黑后凭感觉是否消退判断猎手何时离开·正确·别再做成「关灯就感觉不到」）；但**狡猾猎手 + 低 san** 时「没感觉≠安全」要变得不可信（cunning 关灯也甩不掉感觉 / 低 san 关灯有伪感觉）——目前感知仍纯 alert/stalker 驱动·这两个例外未实装。
* 守则：复用 ambushEncounters 不加新常规敌（apex 例外）、可生存无脚本死、摸黑是阀门、不触发 d_reveal、additive/gated 守 playthrough-stealth。

**B · Phase 3「另一个世界」(深水区 §3.7)**（需作者在场逐拍）——capstone 核心已就位（#69）但「另一个世界」只留钩子：低 san 才出现的节点/路径/事件/回报（`sanityRange` 低段门控泛化·救活 quirk #21 死内容）；`flag.mimic.false_beacon.survived` 接更深通路；节点版 mimic（S2 `spoofsSonar` 假信标）引向兑现事件＝把海图 mimic 的「引诱→兑现」搬进下潜内。别擅自定演出/触发新 d_reveal（#42）。

**C · 继续铺更深 band / 深段内容**（低-中·#63/#65/#68/#72/#75/#77/#81/#82 已开好路）——① trench/abyssal/hadal/subhadal 继续加密欺骗变体（现约 10/11/10/10）；② 开 >230m 新 band（depth_bands.json 加一级 + types/events.ts 加新 ZoneTag〔闲置已全用尽〕 + 续写事件 + 设 `sonarDeception`/`hunts`·想清比 subhadal 更外的母题别重复）。守深段守则、永不交底、不触发 d_reveal、别加敌人、loot-free。

**D · Phase 2b 续 / 打磨**（已收窄·低强度）——三齿已闭环（#79）；仍可续：寄存丢失更狠后果 / reef 第二前哨（侧向）/ 维护账单随深度分级 / 平衡实测 pass（tunables 在 `engine/outposts.ts`/`clarity.ts`/`sonar.ts`/`stalker.ts` 顶 + `lighthouse_upgrades.json`）。

**关键约束**（深水区 SPEC §9 + 猎手 SPEC §9 完整版）

* **回归文化（#22/#26）**：一条命令跑全绿＝`npm run regress`（进程隔离并行·typecheck + 全部 playthrough〔含新 `-stalker`〕+ scenarios + verify-tutorial + smoke + prod build·**26/26**·~7-8s）。新 `playthrough*.ts` 自动被 regress 发现注册（无需改 regress.mjs）。迭代只跑子集 `npm run regress -- --only typecheck,<子系统>`。commit 前跑一次全绿。
* **猎手（#84 模板·别另起炉灶）**：纯逻辑全在 `engine/stalker.ts`（确定性·不耗 RNG）·渲染住 `SonarScanPanel`/`NodeSelectView`（纯渲染·别加判定分支）·接线住 `dive.ts`。`run.huntEnabled` 缺省 off → 旧 `alert→maybeApproachEncounter` 瞬时伏击（**逐字节守 playthrough-stealth §4-§6**）；门控走 `DepthBand.hunts`（同 #64/#78 band plumb）。接触**复用 `ambushEncounters`**·不加新常规敌（守「敌人别太多」·apex 是事件例外）。run 级·纯对象·不 bump SAVE_VERSION。碰它必补 `playthrough-stalker` + smoke E8。
* **即时 POI / roaming（#83 模板）**：roaming 选取必须 **pool-independent**（`roamingKey` 确定性键·别回退顺序加权抽）+ 模板键 id·守「同 runsCompleted 重算稳定·中途点亮灯塔不重洗」；动 reveal/前哨时记得 chart memo 的 `chartSig` 覆盖。
* **声呐范围/传感器升级（#80/#60 模板）**：所有旋钮经 `UpgradeEffect → getUpgradeBonuses → UpgradeBonuses → getRunBonuses → createNewRun → deriveSensorTuning`（7 处全补·漏一处 typecheck 报错＝护栏）；缺省回退基线＝零行为变化。新增 UpgradeEffect 必补 `UpgradePanel` 标签 + `smoke-chart-ui` J 段。
* **威胁/欺骗/猎手表象（S2 #78 / S3 #80 / 猎手 #84 模板）**：声呐图上的不可信/威胁/猎手表象走 `clarity.ts`〔欺骗/威胁〕/`stalker.ts`〔猎手位置〕单一来源·面板纯渲染。碰 `NodeSelectView`/`SeaChartView`/`SonarScanPanel` 数据路径必补 `smoke-chart-ui` SSR 断言（E4 声呐图/E5 房间/E6 不可信/E7 威胁/E8 猎手/L 灯塔+海况/N 前哨/O mimic）。
* **§6.5 海况/海图（#80 模板）**：海况派生·不入存档；遮蔽只动 roaming·锚点/mimic 永不遮；reveal 动画纯 UI·engine reveal 集合不变。
* **寄存/前哨/加 band 内容/加前哨**（#79/#63/#66 模板）：寄存逻辑全在 `engine/outposts.ts`·守单向依赖；新事件 import 进 `engine/zones.ts` EVENT_DB；事件只挂该 band tag（#19）；scenarios statsDelta 用 `event-runner --out json` 实跑抄（#43）；前哨进度走 flag、引擎零改。
* **存档**：未发布暂不迁移——动 run/profile 形状无需 bump `SAVE_VERSION`(现 4)；新字段靠 `createNewRun`/`createInitialProfile` 种默认 + 反序列化 `?? 默认` 兜底（`scanMemory`/`sonarDeception`/`huntEnabled`/`stalker`/`outpostState` 先例·纯对象 JSON 自动 round-trip）。
* **软门控（作者 2026-06-03）**：深度别用硬 flag 锁——靠装备 + 强敌做门。band 不加 `unlockedBy`；声呐/前哨蛙跳/mimic 引诱/猎手 `hunts` 都软门控。
* **拓扑（#70）**：开阔水域单向下潜不可回头、迷路图双向可回头；`zoneAllowsBacktrack(zoneId)=mapShape==='maze'`。
* **敌人别太多 / 叙述永不交底（#54） / 别擅自触发 d_reveal（#42）**。
* **沙箱 git（[[sandbox-git-commit]]）**：`git add src scenarios docs scripts`（别 `-A`，根 `CLAUDE.md` 一直 untracked、`.deploy-token.example` 有处 pre-existing untracked 改动·均别提交）；残留锁 `find .git/objects -name 'tmp_obj_*'` + HEAD.lock `mv` 进 `.git/.sandbox-junk/`；`gc.auto 0`；核对只用 `git --no-optional-locks status/log`。

**收尾**
更新 `docs/STATUS.md`（顶部滚动条目 + §6 编号锚点）、相关 `SPEC`（猎手 §10 / 声呐与房间 §11 决策日志 / 深水区 §10 若动机制），自动记忆（[[deep-game-vision]] 若动机制 + [[weekend-content-log]] 若动内容 + [[basebuild-map-revamp]] 若动前哨 + [[sandbox-git-commit]] 记 commit + MEMORY.md 索引），把 `docs/NEXT_SESSION_PROMPT.md` 改写成再下一个 session 的 prompt（整份文件就是 prompt 正文、开头不要加任何说明性前言——要能直接全选复制粘贴就用），按 [[sandbox-git-commit]] 提交。
