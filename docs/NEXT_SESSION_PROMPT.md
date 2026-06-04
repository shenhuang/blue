下个 session 的 prompt — Phase 0 全闭 + Phase 1 深度轴（plumbing + 节点级 clarity + band 级 alert 倍率）+ trench/abyssal 深段内容 + **Phase 2a 跨 run 分阶段前哨 + 真蛙跳出潜点** 均已落地。下一步：Phase 2b（能源经济/衰减/前哨 UI/多前哨链）/ 继续铺更深 band 内容 / 或 Phase 3 mimic capstone（必须 Phase 2 完成、作者在场）。
直接把下面（含本行以下全部）粘进新 session 即可。

你在接手「深海回响」(Deep Echo) —— 潜水题材文字冒险 Roguelike（Vite + React + TS），仓库在 `~/Desktop/Blue`。

**当前主线**：深水区 vision 分阶段实装，`docs/深海回响_深水区_SPEC.md` 是源真。**Phase 0 全闭**（0a 感知 #58 / 0b 探测 #59 / 升级轨 #60）+ **Phase 1 深度轴**（band 阶梯+蛙跳 plumbing #61 / 节点级 clarity #62 / band 级 alert 倍率 #64）+ **深段内容**（trench「回波对不上」#63 / abyssal「永远有比最深更深的」#65）+ **Phase 2a 前哨脊柱**（跨 run 分阶段前哨 + 真蛙跳出潜点 #66）均已落地。上一个「全做」session 一口气做了 C（#64 alert 倍率）+ B（#65 abyssal）+ A（#66 Phase 2a）。SPEC §11（Phase 0）+ §12（Phase 1）完结、§5 Phase 2 标注 2a 已实装/2b 待做、§10 决策日志记到「全做」session。

Phase 0+1+2a 已就位的地基（后续直接用）：
- `engine/clarity.ts`：感知（`clarity(run)` 天花板三态 / `clarityForNode(run,node)` 节点级深度降档 / `sonarReturn` / `lampPreview` / `signature`）+ 探测（`alertDelta` / `alertDepthFactor` / `predatorApproaches`，**alertDelta 现乘 `run.bandAlertFactor` band 倍率 #64**）+ 升级派生（`deriveSensorTuning` / `sonarPingCost`）+ tunables/地板上限（文件顶）。
- **深度 band**：`data/depth_bands.json` 4 band（reef_deep 45-60 / trench_mouth 60-82 / trench_throat 82-108 / **abyssal 108-140**）+ `engine/bands.ts`。`DepthBand` 字段：`visibility`/`current`/`tags?`（band 专属事件池，复用闲置 ZoneTag twilight/midnight/abyssal）/**`alertFactor?`（探测压力倍率 #64，缺省 1·mouth 1.3·throat 1.6·abyssal 2.0，只乘 alertDelta 增益不动消退）**。续更深 band（>140m）：depth_bands.json 加一级即可（架构不硬编码地板）。
- **深段内容**：`data/events/trench.json`（6 事件「回波对不上」twilight/midnight）+ `data/events/abyssal.json`（5 事件「永远有比最深更深的」abyssal：no_floor/the_rising〔apex 伏笔〕/deeper_light〔mimic 伏笔·勾连 lore.deep_water.cold_light〕/the_permission/still_falling）。全 loot-free/无敌人/不触发 d_reveal/永不交底。新 `lore.trench.*`/`lore.abyssal.*`。
- **Phase 2a 前哨脊柱（#66，本次新）**：`OutpostDef`（types/lighthouse.ts；`data/lighthouse_upgrades.json::outposts[]`）=`{id,name,bandId,stages[3],result}`，每 stage 一份双资源账单。`engine/lighthouses.ts`：`advanceOutpost(state,id)`（按当前阶段校验账单·扣料·置阶段 flag·**建满 push 一座 Lighthouse 复用 Phase C reveal/reach**）/ `outpostStage(profile,id)`〔读 `outpostStageFlag`=`flag.<id>.s1..3`〕/ `isOutpostLit` / `OUTPOST_MAX_STAGE`(3) / `OUTPOST_USABLE_STAGE`(2)。**进度＝profile.flags、零存档形状改动、SAVE_VERSION 仍 4**（作者选未发布不迁移）。outcome 新 `advanceOutpostId`（types/events.ts）→ applyOutcome 调（与 `restoreRuinId` 平行）。`dive.ts::startDiveFromOutpost` 从 `deepestOutpostLaunch`（最深半亮前哨）蛙跳（预耗氧按目标顶−前哨底）。建造事件 `lighthouse.outpost_reef_deep`（visibleIf flag 门控·一阶/潜·forbiddenFlags 点亮后门掉）。**现有 1 座前哨 `outpost.reef_deep`**（reef_deep→服务 trench/abyssal 蛙跳）。
- run 状态 `sensors{light,sonar,sonarUnlocked}` + `power`/`powerMax` + `alert` + `sensorTuning` + `bandAlertFactor?`。升级桥：`UpgradeEffect → getUpgradeBonuses → getRunBonuses → createNewRun → deriveSensorTuning`。
- 升级线 4 条；`ZoneDef.ambushEncounters`（三深水 zone）；`node.evadesSonar?`/`spoofsSonar?` 钩子（Phase 3 mimic 待填）。

先 onboarding（按顺序）
1. **读 `docs/深海回响_深水区_SPEC.md`**，重点 §3.6（前哨/能源，Phase 2b 待做部分）/ §5 Phase 2（2a 已勾·2b 清单）/ §3.5（mimic capstone）/ §3.7（另一个世界）/ §8 tunables / §9 守则。
2. 读自动记忆 [[deep-game-vision]]（北极星 + Phase 0/1/2a 已建状态）+ [[weekend-content-log]]（内容覆盖：现 93 事件/7 敌人，trench+abyssal 已有专属内容）。
3. 读 `docs/STATUS.md` **quirk #58–#66（深水区全貌）**——尤其 **#66（Phase 2a 前哨脊柱）/ #64（band alert 倍率）/ #65（abyssal）**；Phase 2b 复用：#52（Phase C reveal/reach + restoreLighthouse）、#51（Lighthouse 模型）、#50（材料经济双资源）、#48（尸体 aging 衰减——水下前哨衰减可复用）。
4. 跑全绿确认起点干净（§9，含 `playthrough-outpost`/`-bands`/`-sensors`/`-stealth`）。

## 本 session：从下面选一（作者定方向）

**A · Phase 2b 能源经济 + 水下衰减 + 前哨 UI + 多前哨链** —— 接 Phase 2a 脊柱（#66）。SPEC §3.6 / §5 Phase 2b 清单：① **能源**（base 层资源，跑设施、决定同时在线数；充电/充氧/中转设施沿 `lighthouse_upgrades` 轨）；② **水下前哨衰减**（水流区更快、可水力发电；复用尸体 `aging`/decay #48）+ 衰减后果（变暗/进度回退/寄存材料丢失，§3.6）；③ **SeaChartView 前哨建造 + 蛙跳出潜点 UI surfacing**（2a 建造走 dive 事件、收益自动透明，缺直观入口；碰 UI 必补 `smoke-chart-ui`）；④ **多前哨链**（trench→abyssal 出潜点，按 #66 模板加 OutpostDef + 建造事件）。**若动 profile 持久形状（能源/衰减计时），问作者是否破例迁移（现策略 flag-only/不迁移、SAVE_VERSION 4）。开建前 AskUserQuestion pin 能源模型/衰减数值/先做哪几项。**

**B · 继续铺更深 band / 深段内容（低-中强度，#63/#65 已开好路）** —— band.tags + 深段欺骗母题机制已成熟：① abyssal 现 5 事件，可加密（更多深渊欺骗变体）；② **开更深 band（>140m）**——depth_bands.json 加一级 + 新 tag（`ZoneTag` 闲置值已用完 twilight/midnight/abyssal，需在 types/events.ts 加一个新 ZoneTag、然后零穷尽-switch 风险）+ 续写事件，递归更深。守深段欺骗母题、永不交底（#54）、不触发 d_reveal（#42）、别加敌人（守 2/zone，mimic/corpse-wearer 是 Phase 3 apex 例外）、loot-free。

**C · Phase 3 mimic capstone（必须作者在场、逐拍敲定）** —— SPEC §3.5/§5 Phase 3。海图假 POI（无灯之光）→ 横渡 → 入潜遭遇；tell↔sanity 双耦合；corpse-wearer 姊妹 apex；接 `flag.d_reveal`。**唯一允许的第三只敌人例外。** 伏笔已三层成型（浅/中/深 + trench/abyssal「回波对不上」「更深处的假灯」#63/#65）待回收。`spoofsSonar`/`evadesSonar` 钩子已就位待填。**别擅自触发 `flag.d_reveal`（#42）；演出逐拍与作者一个个敲定（作者 2026-06-02）。** 理想在 Phase 2 更完整后做。

## 关键约束（§9 完整版）
- **回归文化（#22/#26）**：每步全绿——`npm run typecheck`（`npx tsc --noEmit`）+ 全部 playthrough（含 `-outpost`/`-bands`/`-sensors`/`-stealth`）+ `-scenarios` + `-combat-scenarios` + `-mapgen-scenarios` + `-lighthouse-scenarios` + `verify-tutorial`（.mjs）+ `smoke-chart-ui.tsx` + prod build（`npx vite build --outDir $(mktemp -d) --emptyOutDir`）。`playthrough.ts` ~12% flake（#18）重试。**bash 上限 45s/call，分批跑。**
- **加前哨（#66 模板）**：① `data/lighthouse_upgrades.json::outposts[]` 加 OutpostDef（bandId/3 stage 账单/result 灯塔）；② 建造事件挂对应 band 的 zone tag、`visibleIf` flag 门控三阶 + `forbiddenFlags:[s3]`、outcome `advanceOutpostId`；③ 进度走 flag（`outpostStageFlag`）不动存档；④ `playthrough-outpost.ts` 加节。
- **加 band 内容（#63/#65 模板）**：① 新事件文件 import 进 `engine/zones.ts` EVENT_DB（verify-tutorial 注册守卫会拦漏）；② band 专属 tag 复用 `ZoneTag` 闲置值（已用完→加新 ZoneTag）；③ 事件只挂该 band tag（#19 单 tag）；④ scenarios statsDelta 用 `event-runner --out json` 实跑抄（#43，oxygen=-oxygenTurnCost、fail 用 `stats.sanity:22`+seed 1 撞 0.05 clamp、success 满 san seed 1 撞 0.95）。
- **存档**：未发布暂不迁移（作者 2026-06-03/06-04）——动 run/profile 形状无需 bump `SAVE_VERSION`(现 4)；新字段靠 `createNewRun`/`createInitialProfile` 种默认 + 反序列化 `?? 默认` 兜底；前哨进度走 flag（更不碰形状）。`playthrough-save` 校验 round-trip。**Phase 2b 若动 profile 持久形状（能源/衰减），问作者是否破例迁移。**
- **UI smoke（#38/#41）**：改了 UI 数据路径必补 `smoke-chart-ui.tsx` SSR 断言。护栏：`UpgradePanel::renderEffect` 是穷尽 switch——加 `UpgradeEffect` kind 必补 UI 标签（typecheck 会拦）。
- **节点级 clarity 护栏（#62）**：动 `clarityForNode`/reach 时——① 浅水（≤`CLARITY_FULL_DEPTH`25）必豁免；② reach 上限 < 最深陡降；③ 尸体定位别被深度降档误伤（已豁免）。
- **敌人别太多**：各 zone 已 2 敌，mimic/corpse-wearer 是 Phase 3 apex 例外；别加常规第三只。
- **叙述永不交底（#54） / 别擅自触发 d_reveal（#42）。**
- **软门控守则（作者 2026-06-03）**：深度别用硬 flag 锁——靠装备（声呐/电池/升级）+ 强敌做门。band 不加 `unlockedBy`。前哨蛙跳是「省预耗氧」的软优势、不是硬解锁（深 band 没前哨也下得去、只是贵）。
- **沙箱 git（[[sandbox-git-commit]]）**：`git add src scenarios docs scripts`（别 `-A`，根 `CLAUDE.md` 一直 untracked、别提交）；残留锁 `find .git/objects -name 'tmp_obj_*'` + HEAD.lock `mv` 进 `.git/.sandbox-junk/`；`gc.auto 0`；核对只用 `git --no-optional-locks status/log`。上个 session 提交 `7e9b6e6`（C+B）→ Phase 2a（A）。

## 收尾
更新 `docs/STATUS.md`（滚动 + §6 新 quirk）、`SPEC`（§10 决策日志 / 勾 §5/§12）、自动记忆（[[deep-game-vision]] 若动机制 + [[weekend-content-log]] 若动内容 + MEMORY.md 索引）、把本文件改写成再下一个 session 的 prompt，按 [[sandbox-git-commit]] 提交。
