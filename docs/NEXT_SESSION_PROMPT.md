你在接手「深海回响」(Deep Echo) —— 潜水题材文字冒险 Roguelike（Vite + React + TS），仓库在 `~/Desktop/Blue`。

**当前主线**：深水区 vision 分阶段实装，`docs/深海回响_深水区_SPEC.md` 是源真。深水区四个 Phase 的**核心已全部落地**：**Phase 0**（0a 感知 #58 / 0b 探测 #59 / 升级轨 #60）+ **Phase 1**（band 阶梯+蛙跳 #61 / 节点级 clarity #62 / band 级 alert 倍率 #64）+ **Phase 2**（2a 跨 run 分阶段前哨+真蛙跳 #66 / 2b 能源/衰减/海图前哨 UI/多前哨链 #67）+ **Phase 3 mimic capstone 核心**（海图假 POI 引诱→入潜兑现→读穿 tell→d_reveal #69）+ **深段内容**（trench #63 / abyssal #65 / hadal >140m #68）。其后一笔 UX 修：**单向下潜预告 #70**（开阔水域层状图不可回头、过了上浮口会措手不及 → `engine/zones.ts::zoneAllowsBacktrack` + `NodeSelectView` 持久提示「水路只往下、走过的回不去」+ smoke E3；迷路图不提示）。代码停在提交 `34af0cb`，全绿。

**新设计（已 fully 拍板、原型验证、未写代码）**：`docs/深海回响_声呐与房间_SPEC.md`（v0.1）——把**下潜内的声呐**从「逐选项预览」升成**探索性的洞穴声呐扫描**（一记 ping 读真实节点图、画出近似洞形）+ **房间可含多个事件点**（轻量版·房间把多 feature 摆成选项、无自由移动）+ **宏观对应：灯塔=海图声呐**（点亮播大测绘扫描揭示动画 + POI 不总全揭·随天气/潮汐/事件/回合变）。§8 八项子决策全定、§7 分阶段 S0→S3、§10 决策日志记到第 N 轮原型。**这是目前最成熟、可直接起手的待建功能（见下方方向 A）。**

已就位的地基（后续直接用、别另起炉灶）：
- `engine/clarity.ts`：感知（`clarity(run)` 天花板三态 / `clarityForNode(run,node)` 节点级深度降档 / **`sonarReturn`〔不可信声呐表象·读 `evadesSonar`/`spoofsSonar`〕** / `lampPreview` / `signature`）+ 探测（`alertDelta`〔乘 `run.bandAlertFactor`〕/ `predatorApproaches`）+ 升级派生（`deriveSensorTuning`）+ tunables/地板（文件顶）。
- **声呐功能要用的钩子**：`DiveNode`（`types/dive.ts`）有 `layer/depth/zoneTag/kind/connectsTo/eventId(单个)/preview/`**`evadesSonar?`/`spoofsSonar?`**（**仍未填——正是声呐欺骗 + 节点版 mimic 的落点**）；**节点没存 2D 坐标** → 声呐渲染要先抽一套布局推导（`ui/dev/MapDevPanel` 已在做类似的，可抽公共函数）。`engine/chart.ts`＝宏观海图层（`generateChart` 派生 POI·roaming 按 runsCompleted 刷新＝潮汐·`requiresFlags` 事件门·`isPoiLit` 灯塔半径·mimic 假 POI 已注入 #69）。
- **深度 band**：`data/depth_bands.json` 5 band（reef_deep 45-60 / trench_mouth 60-82 / trench_throat 82-108 / abyssal 108-140 / hadal 140-180）+ `engine/bands.ts`。`DepthBand`：`visibility`/`current`/`tags?`（ZoneTag twilight/midnight/abyssal/hadal 已用尽）/`alertFactor?`（缺省1·mouth1.3·throat1.6·abyssal2.0·hadal2.5）。>180m：depth_bands.json 加一级 + types/events.ts 加新 ZoneTag。
- **深段内容**：`data/events/{trench,abyssal,hadal}.json`（6+5+4 事件）。全 loot-free/无敌人/不触发 d_reveal/永不交底。
- **Phase 2 前哨脊柱 + 能源**：`OutpostDef`（`data/lighthouse_upgrades.json::outposts[]`）+ `engine/lighthouses.ts`（advanceOutpost/outpostStage/canAdvanceOutpost/OUTPOST_MAX_STAGE3/USABLE2，进度＝profile.flags、SAVE_VERSION 仍 4）+ **`engine/outposts.ts`**（能源/衰减·additive `profile.outpostState{maintainedRun}` 不 bump·outpostEnergy/effectiveOutpostStage/effectiveOutpostBonuses/maintainOutpost）。3 设施轨 hydro/recharge/oxygen。现 2 前哨 reef_deep（静水）+ trench_deep（水流）。
- **Phase 3 mimic capstone（#69）**：`ChartPoi.mimic?`（chart.ts 注入·软门控 shouldLureMimic）→ `startDiveFromPoi(mimic)` 强制兑现事件 → `data/events/mimic.json`（false_beacon 读穿→`Outcome.setProfileFlags`[flag.d_reveal,…survived]+forceAscend / the_wearer_apex corpse-wearer 姊妹）。两 apex 做成 EVENT 非战斗敌人。`Outcome.setProfileFlags` 持久写 profile → diverName 翻死者名为「你」。

先 onboarding（按顺序）
1. **读 `docs/深海回响_声呐与房间_SPEC.md`**（若做方向 A）——§5 声呐扫描 / §6 多事件房间 / §6.5 宏观灯塔扫描 / §7 分阶段 S0-S3 / §8 子决策（全定）/ §10 守则 / §11 决策日志。**+ `docs/深海回响_深水区_SPEC.md`**（北极星·§3.1 两层 clarity·§3.5 mimic·§3.7 另一个世界·§9 守则）。
2. 读自动记忆 [[deep-game-vision]]（北极星 + Phase 0/1/2/3 全建）+ [[weekend-content-log]]（现 100 事件/7 敌人）+ [[basebuild-map-revamp]]（前哨/能源）+ [[sandbox-git-commit]]（提交法）。
3. 读 `docs/STATUS.md` 顶部滚动条目 **#67/#68/#69/#70** + 复用项 #66/#52/#50/#48/#42/#62。
4. 跑全绿确认起点干净（§9，含 `playthrough-mimic`/`-outpost`/`-bands`/`-sensors`/`-stealth`）。

## 本 session：从下面选一（作者定方向）

**A · 声呐探索 + 多事件房间 S0（新·`docs/深海回响_声呐与房间_SPEC.md` 全拍板·原型验证·推荐起手·风险最低）** —— 按 SPEC §7 分阶段：**S0＝声呐读真图（只读、不改节点模型）**：抽公共布局推导 + `NodeSelectView` 加声呐图面板，一记 ping（**回合制·每回合 1 scan**）从**你当前位置**揭示**有限程**内的节点为草图（接触式描线 + 渐隐余像·**覆盖遮罩固定亮度〔重复 ping 不越来越亮〕**），**耗电 + 抬 alert**；**起步范围很小**（早期只照身边一小圈、范围是主要升级轴、永不照全洞/扫不穿最深）；地图默认**缩放**只看一小片 + 残图小地图给方位感。然后 S1（多事件房间·`DiveNode.features?`·房间摆多 feature 选项·一房可连探付氧）/ S2（不可信：填 `spoofsSonar`/`evadesSonar` + 低 san **伪接触〔与真无异〕+ 读数变乱码**·配会藏的深处敌人＝玩家真分不清真假·**不明显是假**）/ S3（威胁：先廉价接触 blip、后定位 stalker）。**定向 ping**（朝一方向探更远·可避开敌人方向不照亮它）做升级。守 §10：回归全绿、软门控、d_reveal 只由 mimic 触发、叙述永不交底、敌人别太多。**宏观（§6.5）：灯塔点亮播大测绘扫描揭示动画（慢·覆盖大片·探照灯短程匀速≠sonar）+ POI 随天气/潮汐/事件/回合变（沿 chart.ts 派生、不入存档）**，可单独做。

**B · Phase 3「另一个世界」(§3.7)（需作者在场逐拍）** —— capstone 核心已就位（#69）但「另一个世界」只留钩子。要做：低 san 才出现的节点/路径/事件/回报（`sanityRange` 低段门控泛化·救活 quirk #21 死内容如 `bluecaves.silent_chamber`）；`flag.mimic.false_beacon.survived` 接更深通路；节点版 mimic（填 `spoofsSonar`/`evadesSonar`·与方向 A·S2 天然合流）。**别擅自定演出/触发新 d_reveal 语义（#42）——逐拍敲定。**

**C · 继续铺更深 band / 深段内容（低-中强度，#63/#65/#68 已开好路）** —— ① hadal 4 / abyssal 5 可加密更多欺骗变体；② 开 >180m 新 band（depth_bands.json 加一级 + types/events.ts 加新 ZoneTag〔闲置已用尽〕+ 续写事件）。守深段欺骗母题、永不交底、不触发 d_reveal、别加敌人、loot-free。

**D · Phase 2b 续 / 打磨** —— SPEC 深水区 §5 Phase 2b「仍可续」：① **真·reveal dimming**（衰减接 chart.ts 半径缩·需 reveal 回归一起改）；② 寄存材料设施 + 丢失后果；③ hadal 专属出潜前哨（#66/#67 模板）；④ 平衡 pass（tunables 在 `engine/outposts.ts` 顶 + `lighthouse_upgrades.json`）。

## 关键约束（深水区 SPEC §9 完整版）
- **回归文化（#22/#26）**：每步全绿——`npx tsc --noEmit` + 全部 playthrough（含 `-mimic`/`-outpost`/`-bands`/`-sensors`/`-stealth`）+ `-scenarios`(110) + `-combat-scenarios` + `-mapgen-scenarios` + `-lighthouse-scenarios` + `node scripts/verify-tutorial.mjs`(100 事件) + `smoke-chart-ui.tsx` + prod build（`npx vite build --outDir $(mktemp -d) --emptyOutDir`）。`playthrough.ts` ~12% flake（#18）重试。**bash 上限 45s/call，分批跑。**
- **加 band 内容（#63/#65/#68 模板）**：① 新事件文件 import 进 `engine/zones.ts` EVENT_DB（verify-tutorial 注册守卫拦漏）；② band 专属 tag——ZoneTag 闲置已用尽（twilight/midnight/abyssal/hadal），要在 types/events.ts 加新 ZoneTag；③ 事件只挂该 band tag（#19）；④ scenarios statsDelta 用 `event-runner --out json` 实跑抄（#43：oxygen=-oxygenTurnCost、fail `--sanity 22`+seed1 撞 0.05、success 满 san seed1 撞 0.95；forceAscend 事件 finalPhase=`ascent`）。
- **加前哨（#66/#67 模板）**：① `lighthouse_upgrades.json::outposts[]` 加 OutpostDef（bandId/submerged?/current?/3 stage 账单/result）；② 建造事件挂对应 band tag、`visibleIf` flag 门控三阶 + `forbiddenFlags:[s3]`、outcome `advanceOutpostId`；③ 进度走 flag；④ 能源轨在 `lighthouse_upgrades.json::tracks`（outpostOnly/currentOnly 门控）；⑤ `playthrough-outpost.ts` 加节、碰海图 UI 补 `smoke-chart-ui`。
- **声呐/SPEC 实装（方向 A）**：节点没坐标→先抽布局推导；声呐欺骗全走 `clarity.ts::sonarReturn` + `evadesSonar`/`spoofsSonar`（别另起炉灶）；ping 耗电走 `power`/`sonarPingCost`、抬 `alert`；可信度沿 §3.2 + band 倍率 #64；**碰 `NodeSelectView`/`SeaChartView` 数据路径必补 `smoke-chart-ui` SSR 断言**。run 级态不入存档、不 bump SAVE_VERSION。
- **mimic / capstone（#69）**：`flag.d_reveal` 只由 `mimic.false_beacon` 读穿成功触发（保持暧昧·别廉价触发，#42）；apex 是事件不是战斗敌人；新持久 profile flag 用 `Outcome.setProfileFlags`。
- **存档**：未发布暂不迁移——动 run/profile 形状无需 bump `SAVE_VERSION`(现 4)；新字段靠 `createNewRun`/`createInitialProfile` 种默认 + 反序列化 `?? 默认` 兜底（`profile.outpostState`/`shopStock` 先例）。`playthrough-save` 校验 round-trip。
- **UI smoke（#38/#41）**：改 UI 数据路径必补 `smoke-chart-ui.tsx` SSR 断言（信息面板只渲染默认选中 POI＝第一个可出海点）。
- **节点级 clarity 护栏（#62）**：动 `clarityForNode`/reach——① 浅水（≤`CLARITY_FULL_DEPTH`25）必豁免；② reach 上限 < 最深陡降；③ 尸体定位别被深度降档误伤。
- **软门控守则（作者 2026-06-03）**：深度别用硬 flag 锁——靠装备 + 强敌做门。band 不加 `unlockedBy`。声呐/前哨蛙跳/mimic 引诱都软门控。
- **拓扑（#70）**：开阔水域（reef/wreck/层状）单向下潜不可回头、迷路图（蓝洞群+借它的 trench/abyssal/hadal）双向可回头；`zoneAllowsBacktrack(zoneId)=mapShape==='maze'`。
- **敌人别太多 / 叙述永不交底（#54） / 别擅自触发 d_reveal（#42）。**
- **沙箱 git（[[sandbox-git-commit]]）**：`git add src scenarios docs scripts`（别 `-A`，根 `CLAUDE.md` 一直 untracked、别提交）；残留锁 `find .git/objects -name 'tmp_obj_*'` + HEAD.lock `mv` 进 `.git/.sandbox-junk/`；`gc.auto 0`；核对只用 `git --no-optional-locks status/log`。提交链：`70f25ef`（mimic #69）→ `34af0cb`（单向预告 #70）→ 声呐与房间 SPEC 一串 docs-only（至 `1553a7c`）。

## 收尾
更新 `docs/STATUS.md`（顶部滚动条目 + 若用 §6 编号补新 quirk）、相关 `SPEC`（深水区 §10 / 声呐与房间 §11 决策日志），自动记忆（[[deep-game-vision]] 若动机制 + [[weekend-content-log]] 若动内容 + [[sandbox-git-commit]] 记 commit + MEMORY.md 索引），把 `docs/NEXT_SESSION_PROMPT.md` 改写成再下一个 session 的 prompt（**整份文件就是 prompt 正文、开头不要加任何说明性前言/「粘进新 session」之类的话——要能直接全选复制粘贴就用**），按 [[sandbox-git-commit]] 提交。
