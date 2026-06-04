你在接手「深海回响」(Deep Echo) —— 潜水题材文字冒险 Roguelike（Vite + React + TS），仓库在 `~/Desktop/Blue`。

**当前主线**：深水区 vision 分阶段实装，`docs/深海回响_深水区_SPEC.md` 是源真。截至上个「全做 2」session（A+B+C 一口气做完），深水区四个 Phase 的**核心全部落地**：**Phase 0** 全闭（0a 感知 #58 / 0b 探测 #59 / 升级轨 #60）+ **Phase 1** 深度轴（band 阶梯+蛙跳 #61 / 节点级 clarity #62 / band 级 alert 倍率 #64）+ **Phase 2**（2a 跨 run 分阶段前哨+真蛙跳 #66 / **2b 能源经济+水下衰减+海图前哨 UI+多前哨链 #67**）+ **Phase 3 mimic capstone 核心**（海图假 POI 引诱→入潜兑现→读穿 tell→d_reveal #69）+ **深段内容**（trench #63 / abyssal #65 / **超渊 hadal >140m #68**）。SPEC §11/§12 完结、§5 四 Phase 全标 ✅、§10 决策日志记到本 session。

已就位的地基（后续直接用、别另起炉灶）：
- `engine/clarity.ts`：感知（`clarity(run)` 天花板三态 / `clarityForNode(run,node)` 节点级深度降档 / `sonarReturn` / `lampPreview` / `signature`）+ 探测（`alertDelta`〔乘 `run.bandAlertFactor`〕/ `predatorApproaches`）+ 升级派生（`deriveSensorTuning`）+ tunables/地板上限（文件顶）。
- **深度 band**：`data/depth_bands.json` **5 band**（reef_deep 45-60 / trench_mouth 60-82 / trench_throat 82-108 / abyssal 108-140 / **hadal 140-180**）+ `engine/bands.ts`。`DepthBand` 字段：`visibility`/`current`/`tags?`（band 专属事件池，ZoneTag twilight/midnight/abyssal/**hadal** 已全部用上）/`alertFactor?`（探测压力倍率，缺省 1·mouth 1.3·throat 1.6·abyssal 2.0·**hadal 2.5**）。续更深 band（>180m）：depth_bands.json 加一级 + **types/events.ts 加新 ZoneTag**（闲置值已用尽）。
- **深段内容**：`data/events/{trench,abyssal,hadal}.json`（6+5+4 事件，母题「回波对不上」→「永远有比最深更深的」→「连更深/上下都不再是连续的线」）。全 loot-free/无敌人/不触发 d_reveal/永不交底。`lore.{trench,abyssal,hadal}.*`。
- **Phase 2 前哨脊柱 + 能源经济**：`OutpostDef`（types/lighthouse.ts；`data/lighthouse_upgrades.json::outposts[]`，`{id,name,bandId,submerged?,current?,stages[3],result}`）。`engine/lighthouses.ts`：`advanceOutpost`（建满 push Lighthouse 复用 reveal/reach）/`outpostStage`/`canAdvanceOutpost`/`nextOutpostStage`/`OUTPOST_MAX_STAGE`(3)/`OUTPOST_USABLE_STAGE`(2)，**进度＝profile.flags `outpostStageFlag`、零存档形状改动、SAVE_VERSION 仍 4**。**新 `engine/outposts.ts`（Phase 2b 能源/衰减，单向依赖 lighthouses）**：`outpostEnergy`（容量＝base 1 + 水力〔仅 current 前哨〕− 衰减；按 draw 累加判在线，超容量设施掉线）/ `outpostDecayLevel`（新 additive `profile.outpostState{maintainedRun}`，水流 ×2·封顶 4，**不 bump SAVE_VERSION**）/ `effectiveOutpostStage`（衰减回退·< USABLE 蛙跳失效）/ `effectiveOutpostBonuses`（在线补给桥进蛙跳 run：充电→powerMax/充氧→oxygenMax）/ `maintainOutpost`（re-ferry 重置）。3 设施轨 hydro/recharge/oxygen（outpostOnly/currentOnly 门控）。**现有 2 座前哨：`outpost.reef_deep`（静水·服务 trench/abyssal/hadal）+ `outpost.trench_deep`（水流·服务 abyssal/hadal）。**
- **Phase 3 mimic capstone（#69，作者在场逐拍）**：`ChartPoi.mimic?` 假 POI（`chart.ts` 注入·`isPoiLit` 恒真诱饵/`isPoiExplainedByLighthouse` 恒假宏观 tell·软门控 `shouldLureMimic`＝任一水下前哨半亮）→ `startDiveFromPoi(mimic)` 强制开场兑现事件（`MIMIC_DIVE_EVENT_ID`）→ `data/events/mimic.json`：`false_beacon`（读穿 tell 理智 vs 62·低 san 更难＝tell↔sanity 耦合；读穿活下来 → 新 outcome **`setProfileFlags`[flag.d_reveal,flag.mimic.false_beacon.survived]** + lore + forceAscend；读错/盲信/拒看→不交底·无脚本死）+ `the_wearer_apex`（corpse-wearer 姊妹·深渊 organic·不置 d_reveal）。**两只 apex 做成 EVENT 非战斗敌人**（deception 不靠 slugfest·守敌人别太多）。`Outcome.setProfileFlags` 持久写 profile（≠ applyFlags 的 run 局部）→ diverName 翻死者名为「你」（#42 钩子接上、保持暧昧）。
- run 状态 `sensors{light,sonar,sonarUnlocked}` + `power`/`powerMax` + `alert` + `sensorTuning` + `bandAlertFactor?`；profile 加 `outpostState?`（additive）。升级桥：`UpgradeEffect → getUpgradeBonuses → getRunBonuses → createNewRun → deriveSensorTuning`。`node.evadesSonar?`/`spoofsSonar?` 钩子**仍未填**（Phase 3 做成事件、没用节点版；留给「节点版 mimic」）。

先 onboarding（按顺序）
1. **读 `docs/深海回响_深水区_SPEC.md`**，重点 §3.5（mimic capstone·已实装核心 + 仍留部分）/ §3.6（前哨能源·2b 已做/仍可续）/ §3.7（**另一个世界·明确留作者逐拍·未展开**）/ §5 四 Phase（全 ✅ + 各自「仍留」）/ §8 tunables / §9 守则。
2. 读自动记忆 [[deep-game-vision]]（北极星 + Phase 0/1/2/3 全建状态）+ [[weekend-content-log]]（内容覆盖：现 **100 事件/7 敌人**，trench/abyssal/hadal/mimic 已有专属内容）+ [[basebuild-map-revamp]]（前哨/能源）+ [[sandbox-git-commit]]（提交法）。
3. 读 `docs/STATUS.md` 顶部滚动条目 **#67（Phase 2b）/ #68（hadal）/ #69（mimic capstone）**，及复用项 #66/#52/#50/#48/#42。
4. 跑全绿确认起点干净（§9，含 `playthrough-mimic`/`-outpost`/`-bands`/`-sensors`/`-stealth`）。

## 本 session：从下面选一（作者定方向）

**A · Phase 3「另一个世界」(§3.7) + mimic capstone 续（需作者在场逐拍）** —— 这是 SPEC 明确「与作者一个个敲定·不在草案写死」的一块，capstone 核心已就位（#69）但「另一个世界」只留了钩子（用现有 sanityRange 低段做 tell 失真、没做可探索内容）。要做：低 san 才出现的节点/路径/事件/回报（`sanityRange` 低段门控的泛化，救活 quirk #21 的死内容如 `bluecaves.silent_chamber`）；可能把 `flag.mimic.false_beacon.survived` 解锁钩子接更深通路；节点版 mimic（填 `spoofsSonar`/`evadesSonar` 进活节点）。**别擅自定演出/触发新 d_reveal 语义（#42）——逐拍敲定。**

**B · 继续铺更深 band / 深段内容（低-中强度，#63/#65/#68 已开好路）** —— ① hadal 现 4 事件、abyssal 5、可加密更多欺骗变体；② 开 >180m 新 band（depth_bands.json 加一级 + types/events.ts 加新 ZoneTag〔闲置已用尽〕+ 续写事件，递归更深）。守深段欺骗母题、永不交底（#54）、不触发 d_reveal（#42）、别加敌人（2/zone，mimic/corpse-wearer 是 Phase 3 apex 例外）、loot-free。

**C · Phase 2b 续 / 打磨** —— SPEC §5 Phase 2b「仍可续」：① **真·reveal dimming**（衰减接 chart.ts 半径缩——本期衰减只在蛙跳出潜层兑现、没碰 reveal；需 reveal 回归一起改）；② **中转/寄存材料设施 + 寄存材料丢失后果**（§3.6，本期用 re-ferry 账单承担「材料代价」、未做仓储丢失）；③ 给 hadal 加专属出潜前哨（按 #66/#67 模板，OutpostDef + 建造事件 + 能源设施）；④ 平衡 pass（前哨账单/衰减速率/能源容量 tunables 都在 `engine/outposts.ts` 顶 + `lighthouse_upgrades.json`）。

## 关键约束（§9 完整版）
- **回归文化（#22/#26）**：每步全绿——`npx tsc --noEmit` + 全部 playthrough（含 `-mimic`/`-outpost`/`-bands`/`-sensors`/`-stealth`）+ `-scenarios`(110) + `-combat-scenarios` + `-mapgen-scenarios` + `-lighthouse-scenarios` + `node scripts/verify-tutorial.mjs`(100 事件) + `smoke-chart-ui.tsx` + prod build（`npx vite build --outDir $(mktemp -d) --emptyOutDir`）。`playthrough.ts` ~12% flake（#18）重试。**bash 上限 45s/call，分批跑。**
- **加 band 内容（#63/#65/#68 模板）**：① 新事件文件 import 进 `engine/zones.ts` EVENT_DB（verify-tutorial 注册守卫会拦漏）；② band 专属 tag——`ZoneTag` 闲置值已用尽（twilight/midnight/abyssal/hadal），要在 types/events.ts 加新 ZoneTag（无穷尽-switch 风险，typecheck 会过）；③ 事件只挂该 band tag（#19）；④ scenarios statsDelta 用 `event-runner --out json` 实跑抄（#43：oxygen=-oxygenTurnCost、fail 用 `--sanity 22`+seed 1 撞 0.05 clamp、success 满 san seed 1 撞 0.95；forceAscend 事件 finalPhase=`ascent`）。
- **加前哨（#66/#67 模板）**：① `lighthouse_upgrades.json::outposts[]` 加 OutpostDef（`bandId`/`submerged?`/`current?`/3 stage 账单/result 灯塔）；② 建造事件挂对应 band tag、`visibleIf` flag 门控三阶 + `forbiddenFlags:[s3]`、outcome `advanceOutpostId`；③ 进度走 flag（`outpostStageFlag`）；④ 能源设施轨在 `lighthouse_upgrades.json::tracks`（outpostOnly/currentOnly 门控）；⑤ `playthrough-outpost.ts` 加节、碰海图 UI 补 `smoke-chart-ui`。
- **mimic / capstone（#69）**：`flag.d_reveal` 只由 `mimic.false_beacon` 读穿成功触发（**保持暧昧·别在别处廉价触发**，#42）；apex 是事件不是战斗敌人（守敌人别太多）；新持久 profile flag 用 `Outcome.setProfileFlags`（≠ applyFlags 的 run 局部）。
- **存档**：未发布暂不迁移（作者 2026-06-03/06-04）——动 run/profile 形状无需 bump `SAVE_VERSION`(现 4)；新字段靠 `createNewRun`/`createInitialProfile` 种默认 + 反序列化 `?? 默认` 兜底（`profile.outpostState` 即此法、`shopStock` 先例 #50）。`playthrough-save` 校验 round-trip。
- **UI smoke（#38/#41）**：改 UI 数据路径必补 `smoke-chart-ui.tsx` SSR 断言（信息面板只渲染默认选中 POI＝第一个可出海点）。
- **节点级 clarity 护栏（#62）**：动 `clarityForNode`/reach——① 浅水（≤`CLARITY_FULL_DEPTH`25）必豁免；② reach 上限 < 最深陡降；③ 尸体定位别被深度降档误伤（已豁免）。
- **软门控守则（作者 2026-06-03）**：深度别用硬 flag 锁——靠装备 + 强敌做门。band 不加 `unlockedBy`。前哨蛙跳是「省预耗氧」软优势、不是硬解锁。mimic 引诱也软门控（深处立足才被诱）。
- **敌人别太多 / 叙述永不交底（#54） / 别擅自触发 d_reveal（#42）。**
- **沙箱 git（[[sandbox-git-commit]]）**：`git add src scenarios docs scripts`（别 `-A`，根 `CLAUDE.md` 一直 untracked、别提交）；残留锁 `find .git/objects -name 'tmp_obj_*'` + HEAD.lock `mv` 进 `.git/.sandbox-junk/`；`gc.auto 0`；核对只用 `git --no-optional-locks status/log`。上个 session 提交 `3a04d3e`（Phase 2b #67 + hadal #68）→ mimic capstone（#69）。

## 收尾
更新 `docs/STATUS.md`（顶部滚动条目 + 若用 §6 编号补新 quirk）、`SPEC`（§10 决策日志 / 勾 §5）、自动记忆（[[deep-game-vision]] 若动机制 + [[weekend-content-log]] 若动内容 + [[sandbox-git-commit]] 记 commit + MEMORY.md 索引），把 `docs/NEXT_SESSION_PROMPT.md` 改写成再下一个 session 的 prompt（**整份文件就是 prompt 正文、开头不要加任何说明性前言/「粘进新 session」之类的话——要能直接全选复制粘贴就用**），按 [[sandbox-git-commit]] 提交。
