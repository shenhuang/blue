# 深海回响 · 当前实装状态

> 当前实装状态见下方各节（§1 一句话状态最权威）。完整会话历史 → [docs/archive/CHANGELOG.md](archive/CHANGELOG.md)；已知 quirk 与约定 → [docs/QUIRKS.md](QUIRKS.md)。近期 session（新→旧）：
> **2026-06-10 深夜 品味评审三候选机制化落地（交互 session·#107）**：作者拍板「不需人工审核的一直做、收尾优先」→ #106 的 ①②③ 全部落成会红的门，regress **27→28 任务**。**②phase 转移收口**：新 `engine/transitions.ts` 六具名纯转移（toPort/beginAscent/toShop/toChart/toDiveEvent/toGameOver）替换 ui/ 12 处手搓 `phase:{...}` 字面量 + `check-boundaries` 规则二「src/ui 禁 phase 字面量构造」（负路径实测红）；**③存档 hydrate 收口**：`?? 默认` 兜底收口到 `state.ts::hydrateGameState` deserialize 单点（run 五字段 + profile 两容器**类型转必填**·createNewRun 种 canonical 默认·band 缺省在 startDiveFromOutpost 落点消化·真条件字段不补·~45 处防御读改直读·playthrough-save 新 §6 hydrate 门·非迁移链 #99 精神不变）；**①check-DC lint（保守版）**：新 `check-event-dc` 入 regress——label「（理智 vs N）」标注必须 == `check.{stat,dc}`（157 标注全符·篡改实测红·根治版 check 徽章留作者在场）。修四处 fixture 显式-undefined 盖种子坑（quirk #106）。`npm run regress` **28/28** 全绿（11.6s）。**遗留：④ 有机洞穴作者线上 `?dev` 验收（最高优先·检查单已交）**。详见 CHANGELOG #107 + QUIRKS #106。
> **2026-06-10 晚 品味评审 + 收尾打包（交互 session·#106）**：作者拍板四收尾全落地——**①积压全推**：92e8b0a/b8d592d（真 ahead·ls-remote 核实）+ 树面 chore `217367b`（**/CLAUDE.md 进 .gitignore**＝散文 "always-ignored" 落成机制·**收编安静夜报告 REPORT-2026-06-07**）推上 origin `9ef539e..217367b` + post-push fetch（#103 照做·[ahead] 真归零）；**②dive.ts 纯搬移拆分实装**（`264e02f`·提案 §3–§6 实装门全满足·930 行→barrel + dive-start/-select/-sensors/-move/-stalker/-actions·公共 API/路径零改·diff 证明仅 4 处 helper 提 export·调用图无环）；**③NEXT_SESSION_PROMPT 按 quirk #96 瘦身**（砍与 CLAUDE.md/QUIRKS 复读的段·只留方向）。品味评审三个机制化候选留作者拍板：check-DC 双写 lint / ui phase 字面量门 / 存档 hydrate 收口（详见 CHANGELOG #106）。`npm run regress` **27/27** 全绿（5.5s）。新 quirk #105（dive barrel 约定）。**遗留：④ 有机洞穴作者今晚线上 `?dev` 验收（最高优先·检查单已交）**。详见 CHANGELOG #106 + QUIRKS #105。
> **2026-06-10 效率体检 + 自动化管线修缮（交互 session·#105）**：全项目 review（结构/docs/工作流/管线/skill/定时任务）后把三处管线 drift 修成机制——**夜间 SKILL** 验证段改 `npm run regress` 单命令门（按退出码判红·不再 ✗ 子串误报·补上此前夜间从不跑的 verify-tutorial/check-boundaries/smoke 三关·REPORT 路径修正 `docs/archive/nightly/`）+ push 确认后 fetch 刷新 tracking ref（**根治幻影 [ahead N]**·显式 URL push 不更新 origin/main 引用·quirk #103）；**周末引擎 SKILL** 对齐现行文档约定（onboarding 改 handoff+QUIRKS.md·收尾改进度追加 CHANGELOG、不再往 STATUS 头部堆条目＝本文件膨胀根因·去写死 26/26）；**`regress.mjs`** 收尾自动清扫 vite.config 临时文件（quirk #1 沙箱漏文件·已积 38 个全清）+ 移除一次性 explore-bluecaves 脚本 + STATUS 顶 blockquote 9→3 条。**并发隔离方案 A 实装（作者批准·quirk #104）**：`auto/weekend` 分支已建·周末引擎只 commit 该分支（停在分支不切回）·夜间 verify 绿后 `branch -f main` 移 ref 完成 ff 合并（沙箱 checkout 只能加不能删·故移 ref 不动树）·`handoff.mjs` 显示分支与待合并数·dive.ts 拆分前置就此满足（只待安全窗口）。定时任务 4 个全 disabled（作者确认刻意）；HEAD `9ef539e` 已推已部署（Actions 双绿·GitHub API 核实）。`npm run regress` **27/27** 全绿（10.7s）。**遗留：④ 有机洞穴仍待作者线上 `?dev` 肉眼验收（最高优先）**。详见 CHANGELOG #105 + QUIRKS #103。

## 1. 一句话状态

完整 meta-loop 跑通：**港口对话 → 海图选点 → 教学线性下潜 / 节点图随机下潜 → 事件 → 战斗 → 上浮 → 减压 → 死亡 → 葬礼 → 尸体回收 → 衰减 → 回港变卖/回购 → 材料 ＋ 金币 修缮升级**。元进度已从"建设值"换成"材料经济"（2026-06-01 基建地图 Phase A，见 §5 + quirk #50）。**多灯塔基地数据模型已就位**（Phase B，`profile.lighthouses` + home 灯塔 + `engine/lighthouses.ts`，但灯塔 inert——reveal/reach 留 Phase C；quirk #51）。
内容层 3 个 random zone（旧灯塔礁 / 蓝洞群 / 沉船墓园）。**洞穴 zone（蓝洞群）的下潜图已从层状 DAG 重写为洞穴"迷路图"**：双向边的连通图，有绕回的环 / 死路 / 多个最深点 / 入口+远端两个上浮口，由 `ZoneDef.mapShape='maze'` 选择；开阔海域（旧灯塔礁 / 沉船墓园）仍走层状 DAG。详见 §5 +「mapgen 回归」+ quirk #30–#34。出海点位已升级为 **港口海图（POI 选点）**：anchor 持久 + roaming 按 runsCompleted 刷新，两级门控（发现 flag / 抵达 upgrade），POI 带深度偏移·洋流·能见度修正（三种全部实装：深度→耗氧/减压、洋流→移动耗体力+氧、能见度→理智压力+黑暗盲航）。详见 §5 + quirk #27/#28。
TypeScript 类型干净，**11 个端到端 playthrough 脚本**全部通过（新增 `playthrough-chart.ts`），加上 **事件回归框架**（`scripts/event-runner.ts` + `scripts/playthrough-scenarios.ts`，目前 307 个 baseline scenario）+ **战斗回归框架**（`scripts/combat-runner.ts` + `scripts/playthrough-combat-scenarios.ts`，目前 9 个 baseline scenario）+ **事件 + 战斗双 dev 面板**（DEV 模式 Shift+D / Shift+C 互斥切换，详见 §3）。

---

## 2. 技术栈与运行

```bash
cd ~/Desktop/Blue
npm install
npm run dev        # 启 Vite dev server
npm run typecheck  # tsc --noEmit
npm run build      # 生产构建到 dist/
```

八个 playthrough 验证脚本（用 tsx 直接调引擎）：

```bash
npx tsx scripts/playthrough.ts            # 教学关 + 港口修缮 + 随机图 + 上浮（潜行路径）
npx tsx scripts/playthrough-combat.ts     # 教学关 + 战斗路径
npx tsx scripts/playthrough-corpse.ts     # 死亡 + 回港 + 尸体回收
npx tsx scripts/playthrough-decay.ts      # 衰减阈值 + 升级保鲜 + 海流冲走
npx tsx scripts/playthrough-upgrades.ts   # 升级购买 / 前置依赖 / hasUpgrade 门控 / startDive 加成
npx tsx scripts/playthrough-economy.ts    # 仓库合并 / Mira 收购单价 / 拒收剧情物 / outcome.lootValue
npx tsx scripts/playthrough-bluecaves.ts  # 蓝洞群 mapgen 行为 / canFreeAscend gate / 盲鳗 sanity 攻击 / eel_skin → Mira
npx tsx scripts/playthrough-wreckyard.ts  # 沉船墓园 mapgen / wreck 事件池 / 蛛蟹 solo+pair / lost_diver+watch portEvent 链 / crab_chitin → Mira
npx tsx scripts/playthrough-sensors.ts    # 微观双传感器 / clarity 回归（深水区 Phase 0a）：灯真相 / 黑水盲 / 声呐表象+spoof / power 摸黑 / 低 san 腐蚀 / signature
npx tsx scripts/playthrough-stealth.ts    # 探测/隐身/警觉回归（深水区 Phase 0b）：抬升 / 摸黑消退 / 浅水免压 / 越线触发遭遇 / 摸黑滑过 / 无池不触发
npx tsx scripts/playthrough-bands.ts      # 深度 band / 蛙跳下潜回归（深水区 Phase 1）：band 表 / 破 60m / depthRange 覆盖 / startDiveFromOutpost / 软门控 / 升级直通 / alert 饱和
npx tsx scripts/playthrough-scenarios.ts  # 事件回归：跑 scenarios/*.json 根目录的全部 baseline scenario
npx tsx scripts/playthrough-combat-scenarios.ts  # 战斗回归：跑 scenarios/combat/*.json 的全部 baseline scenario
npx tsx scripts/playthrough-mapgen-scenarios.ts  # mapgen 回归：跑 scenarios/mapgen/*.json + 迷路不变量种子扫描 + 确定性
npx tsx scripts/playthrough-save.ts       # 存档序列化回归：Set round-trip + 版本迁移 + 损坏/未来版本退回
node scripts/verify-tutorial.mjs          # 数据图引用完整性 + 数据文件注册守卫（纯 JS，按目录扫描）
```

事件回归框架的两个 CLI 脚本（详见 §3 末尾的"事件回归框架"小节）：

```bash
npx tsx scripts/event-runner.ts <eventId> [--seed n] [--choice id]...   # 快速跑某事件
npx tsx scripts/event-runner.ts --from scenarios/foo.json               # 跑 JSON 场景
npx tsx scripts/event-runner.ts --list [--zone-tag cave]                # 列所有事件
npx tsx scripts/event-runner.ts --show <eventId>                        # 看事件结构
```

战斗回归框架的 CLI（详见 §3 末尾的"战斗回归框架（Phase 3）"小节）：

```bash
npx tsx scripts/combat-runner.ts <combatId> --action <id> --target <i> ...   # 多回合 quick mode
npx tsx scripts/combat-runner.ts --from scenarios/combat/foo.json            # 跑 JSON 场景
npx tsx scripts/combat-runner.ts --list                                      # 列所有 encounter
npx tsx scripts/combat-runner.ts --list-enemies / --list-actions
npx tsx scripts/combat-runner.ts --show <combatId> / --show-enemy <id> / --show-action <id>
```

每次改完代码或数据建议跑一遍这些脚本（八个 playthrough + scenarios + combat-scenarios + mapgen-scenarios + verify-tutorial）。`playthrough.ts` 有 ~12% RNG flake（quirk #18，与本次改动无关），挂了重试一两次确认。

---

## 3. 已实装的系统

### 状态机（GamePhase）

```
port → dive → combat → dive → ascent → resolution → port
                ↑                ↓
              corpse           funeral → port  ← 死亡分支
```

| Phase | 子状态 | 文件 |
|---|---|---|
| port | NPC 对话 + 海域选择 + 修缮升级 | `PortView.tsx` + `UpgradePanel.tsx` |
| portEvent | 港口侧 cutscene（捡回剧情物时自动触发） | `PortEventView.tsx` |
| dive.event | 事件选项页 | `EventView.tsx` |
| dive.nodeSelect | 节点图选择 2–3 路 | `NodeSelectView.tsx` |
| dive.rest | 休息节点 / 上浮口 | `RestView.tsx` |
| dive.corpse | 尸体回收 | `CorpseView.tsx` |
| combat | 战斗 | `CombatView.tsx` |
| ascent | 三种上浮模式 | `AscentView.tsx` |
| resolution | 上岸结算 | `ResolutionView.tsx` |
| funeral | 死亡结算 | `CorpseView.tsx :: FuneralView` |
| gameOver | 真正的 catastrophic 结局（目前没路径走到这） | `ResolutionView.tsx` |

### 引擎模块（`src/engine/`）

- `state.ts` — GameState 构造 + 不可变操作 + inventory 工具（`mergeIntoInventory` / `removeFromInventory` / **`countInInventory`**——升级账单 & Mira 回购共用）；`createNewRun` 接受 `bonuses` 注入派生加成；**`createHomeLighthouse()` + `HOME_LIGHTHOUSE_ID`**（家灯塔工厂，createInitialProfile + migrateSave 共用一个来源）；**存档层**：`serializeGameState` / `deserializeGameState` / `migrateSave`（按 `SAVE_VERSION` 迁移，**现 `SAVE_VERSION = 4`**：v1→v2 删 `buildingPoints`〔#50〕、v2→v3 种 home 灯塔〔#51〕、v3→v4 dockyard 迁灯塔〔#52〕。**深水区 Phase 0a 的 run.sensors/power 未发布故不迁、不 bump SAVE_VERSION**，靠 createNewRun 种默认 + 反序列化处 `?? 默认` 兜底〔#58〕）/ `saveGame` / `loadGame` / `clearSave`（localStorage，feature-detect；Set ↔ `{__set:[…]}` 的 replacer/reviver 让嵌套 Set 安全 round-trip——`lighthouse.builtUpgrades` 这类**嵌套在数组里的 Set 也自动 round-trip**；`shopStock` 是普通 Record，JSON 原生处理）。App.tsx 启动 `loadGame() ?? createInitialGameState()` + state 变化自动存 + gameOver `clearSave`
- `rng.ts` — 共享 `makeLcg(seed)`（Numerical Recipes LCG），chart.ts / eventScenario `withSeededRandom` / MapDevPanel 共用一份常数（quirk #22）
- `events.ts` — 事件解析、Outcome 应用、`performCheck` 概率检定、`tickTurns` 标准回合结算（含海图能见度理智压力 `visibilitySanityDrain` + **深水区 Phase 0a：灯耗电 `lampPowerDrain`** + **Phase 0b：警觉积累 `alertDelta`**）；`evalCondition` 支持 `hasUpgrade`
- `dialog.ts` — NPC 对话树执行；从 `src/data/npcs/*.json` 多文件加载；`startDive` effect 自动从 profile 派生升级 bonuses 注入 run；`openShop` effect 切到 phase.shop；`openChart` effect 切到 phase.chart（出海点位现在走海图，不再由对话逐个列 zone）
- `chart.ts` — **港口海图（POI 选点）引擎**：`generateChart(profile)` 纯函数（anchor 持久 + roaming 按 `runsCompleted` 种子刷新，派生自 profile 不入存档）；`isPoiVisible` / `poiLockReason` / `isPoiDepartable` 两级门控（requiresFlags=发现、requiresUpgrade=抵达能力）；`describePoi` / `describeModifier`。LCG 与 `withSeededRandom` 同算法但走入参（quirk #22）
- `clarity.ts` — **微观 clarity（下潜内双传感器感知，深水区 Phase 0a）**，与 chart.ts 宏观 clarity 平行：`clarity(run)` 预览档（灯 full / 声呐 sonar / 摸黑 none）+ `sonarReturn(run,node)` 不可信表象（可被 evade/spoof/低 san 改写、≠ 真）+ `lampPreview(run,node)`（真相 / 极低 san 幻觉）+ `signature(run)`（被探测度，0b 消费）+ `lampPowerDrain`（灯耗电，清水因子 0）+ `lampEffective`/`sonarActive`。**（Phase 0b 探测）`alertDelta(run,turns)`（警觉每回合净变化 = signature 超基线 × 深度因子 × GAIN − DECAY）/ `alertDepthFactor`（浅水 0，§7.5）/ `predatorApproaches(run)`（alert≥THRESHOLD + 够深）+ 警觉 tunables。** 纯函数 + 防御读取 + 确定性哈希（不消耗 RNG）。tunables 集中文件顶（电池/ping 耗电/低 san 阈值/signature 权重 / 警觉 GAIN·DECAY·THRESHOLD·WARN·MIN_DEPTH，§8）。**（Phase 0 升级轨 #60）`deriveSensorTuning(bonus)` 把港口升级烤成 `run.sensorTuning`（pingCost/lampDrainMult/两个 san 阈值/signatureReduction，应用地板上限）+ `sonarPingCost(run)` 读 run-effective ping 耗电；上述读取点（sonarReturn/lampPreview/lampPowerDrain/signature）全改成 `run.sensorTuning?.X ?? 基线常量`——升级派生、缺省回退基线。地板/上限常量（SONAR_FALSE_ECHO_SANITY_MIN30/LAMP_HALLUCINATION_SANITY_MIN10/SIGNATURE_REDUCTION_MAX3/SIGNATURE_MIN_ACTIVE2/…）守「无完全可信传感器 + 读真相必自曝」。** **（Phase 1 续·节点级 clarity #62）`clarityForNode(run,node)`——在 `clarity(run)` 天花板之上按节点深度差降档（浅水 ≤CLARITY_FULL_DEPTH25 豁免＝所见为真；深水 dd≤LAMP_DEPTH_REACH6 灯 full、≤SONAR_DEPTH_REACH14 声呐补、再深黑；横/上行不降档）；`deriveSensorTuning` 续烤 lampDepthReach/sonarDepthReach（lampRangeBonus/sonarRangeBonus 升级派生、reach 有上限 MAX14/26＜最深陡降）。`enterNodeSelection` per-choice 烤档（UI 早 per-choice、零改）；Lv.1 尸体豁免深度降档（地图知识，守 #36）。** 详见 quirk #58/#59/#60/#62
- `zones.ts` — Zone 注册 + 事件池抽取（按 depth/tag/sanity/flag 过滤）
- `mapgen.ts` — 节点图生成，**按 `ZoneDef.mapShape` 分流两套生成器**：`generateLayeredMap`（层状 DAG，行为与重写前逐字节一致）+ `generateMazeMap`（洞穴迷路图：spanning tree + 弦边 → 双向连通图，有环/死路/多最深点，入口+远端两个 `ascent_point`）。`canFreeAscend` 仍单独控制上浮语义（与 mapShape 正交）。`GenOpts.depthOffset` 对两套都生效（先平移 depthRange，clamp depth≥0）。corpse pass 两套各一份（层状按中间层、迷路按非入口非出口节点），都支持 `GenOpts.targetCorpseId` 强制布点（打捞行会 Lv.2，绕过随机 + 深度窗）。新增纯函数 `analyzeMap(map)`——结构分析器（可达/双向/环秩/死路/最深点/局部极大/上浮口可达），dev 面板 + mapgen 回归共用。**（深水区 Phase 1）`GenOpts.depthRange` 覆盖 zone.depthRange（band 绝对深度窗口、缺省回退 zone；depthOffset 仍叠加）——「60m 准硬上限」纯是数据，mapgen 早无硬 clamp**
- `bands.ts` — **深度 band 注册表（深水区 Phase 1：可扩展纵向深度轴）**，解析 `data/depth_bands.json` 成 order 升序阶梯：`getBands`（越深越后、可续写、不硬编码地板）/ `getBand(id)` / `bandDiveModifier(band)`（visibility/current → PoiModifier）。band 引用 zone 提供内容、用绝对 depthRange 覆盖 zone（band 决定下到多深、zone 决定那里有什么）。**软门控：band 不带硬解锁——可达性由装备（声呐/电池/升级 #58/#60，吃深料）+ 后续强敌决定**。详见 quirk #61
- `dive.ts`（**#106 起＝barrel**·wiring 住同目录 `dive-start/-select/-sensors/-move/-stalker/-actions`·公共 API/路径零改·依赖单向见 QUIRKS #105） — startDive（接 `opts.depthOffset`/`opts.depthRange` 透传 mapgen）/ `startDiveFromPoi`（海图出海：createNewRun + distance 预耗氧 + diveModifier 落 run + depthOffset + 叙事）/ **`startDiveFromOutpost`（深水区 Phase 1 蛙跳：home 灯塔 stand-in 前哨 + band 绝对 depthRange 覆盖 + bandDiveModifier 落 run + getRunBonuses 升级直通；出潜能见度叙事抽 `appendVisibilityLog` 与 startDiveFromPoi 共用）**/ enterNodeSelection（**深水区 Phase 0a：按 `clarity(run)` 把每个 choice 的 preview 烤成 真相/声呐表象/盲 + 标 `clarity` 档**；给每个 choice 标 `visited`）/ **`setLight`/`pingSonar`**（切灯 / 发声呐 ping 耗电、需解锁、移动后消散；都经 `refreshSelection` 重算选点）/ moveToNode（含海图洋流移动消耗 `currentMoveCost`；移动后 ping 归 off；**深水区 Phase 0b：进节点若高警觉 + 该 zone 有 `ambushEncounters` + 非地标节点 → `maybeApproachEncounter` 触发接近遭遇〔startCombat 复用 zone 现有 solo 敌、alert 落回缓冲〕**；**迷路图重访已到过的节点时事件不重播**——退化成安静水域）/ restAtNode / **breatheAtAirPocket**（气穴换气 +氧+理智，一次性，写 run.activeFlags air_used:*）/ **campAtNode**（短/长扎营，tickTurns 后叠加恢复）。迷路图双向边 → getNextChoices 含来路，玩家可回头
- `ascent.ts` — 上浮方案 + 减压病 I/II/III/IV 型判定；`computeLootValue` 用 `miraOfferFor` 估战利品潜在价值；`isAscentBlocked(run)` 检测封闭水域（`zone.canFreeAscend=false` 且不在 ascent_point 节点上），AscentView 用它锁 normal/rushed，emergency 仍可用作"凿穿洞顶"
- `combat.ts` — 战斗状态机、行动消费、敌人 AI、姿态、撤退逻辑
- `death.ts` — executeDeath / DeathRecord 生成 / ageAndDecayDeaths / findRecoverableCorpse / recoverFromCorpse / 衰减阈值；`isRecoverableCorpse` + `listRecoverableCorpses(deaths, zoneId)`（海图选目标 + mapgen 强制布点共用判据）
- `upgrades.ts` — 升级注册表 / `canPurchase` / `purchaseUpgrade` / `getUpgradeBonuses` 派生加成聚合。**`cost` 现为双资源 `UpgradeCost{ materials: MaterialCost[]; gold }`（基建地图 Phase A）**：`canPurchase` 先逐条材料 `countInInventory >= qty`（不足 → `notEnoughMaterials` 带 `shortfall` 缺口清单），再查 `bankedGold >= gold`（不足 → `notEnoughGold` 带 `goldShort`）——材料先于金币，所以"只有钱没有料"落 notEnoughMaterials（金币买不了升级）；`purchaseUpgrade` 逐条 `removeFromInventory` + `bankedGold -= gold`。helper `materialShortfall` / `describeUpgradeCost`（log+UI 共用账单格式）。`getUpgradeBonuses` 不变
- `lighthouses.ts` — **灯塔基地引擎（每灯塔设施升级，基建地图 Phase B）**，与全局 `upgrades.ts` 平行、互不污染：`getLighthouseTracks`/`getLighthouse`/`getBuiltLevelInTrack` + `canBuildAt`（alreadyBuilt/needsPrev/needsLighthouseLevel/notEnoughMaterials/notEnoughGold，账单复用 `upgrades.ts::materialShortfall`+`describeUpgradeCost`）+ `buildAtLighthouse`（扣材料+金币，**只写目标灯塔的 builtUpgrades 不污染别座**）+ `getLighthouseBonuses`（聚合 lightRadiusBonus/reachReduction）+ `nearestLighthouse`/`distanceBetween`（最近灯塔距离工具）。**Phase B 灯塔 inert——这些函数有回归但游戏流程还没调用；reveal/reach 由 Phase C 的 chart.ts/dive.ts 消费**。详见 quirk #51
- `items.ts` — `getItemDef` 集中索引；death/combat/CorpseView 三处旧 `new Map(ITEM_INDEX)` 已切到这里
- `portEvents.ts` — 回港 cutscene 调度：扫 inventory 找 `item.story.triggersEventId`，配合 `flag.event_done.<id>` 防重播
- `port.ts` — `handleReturnToPort`（合并 run.inventory → profile.inventory + 触发 cutscene + **回港清空 `shopStock` = 补满 Mira 备货**）+ Mira **收购侧**（`miraOfferFor` / `listMiraSellables` / `sellItemToMira` / `isSellableToMira`，MIRA_BUY_RATIO = 0.8，所有材料可卖）+ Mira **出售侧/回购**（基建地图 Phase A）：`isBuyableFromMira`（仅 T1/T2 材料）/ `miraBuyPriceFor`（=卖价×`MIRA_BUY_MARKUP` 2，恒>卖价）/ `maxShopStockFor`（`SHOP_STOCK_BY_TIER` T1=8·T2=4）/ `getShopStock`（profile.shopStock 缺项=懒默认满货）/ `listMiraBuyables` / `buyFromMira`（买 min(qty, 余货, 金币能买的)；T3/T4 / 买不起 / 售罄 → no-op）。详见 quirk #50
- `eventScenario.ts` — **事件回归框架**核心 API（`runEventScenario` / `listAllEvents` / `describeEvent` / `withSeededRandom`）。给定 eventId + 自定义起始 state，能走完该事件及其 triggerEventId 链，输出 JSON 或文本，绕开 mapgen 随机抽取。详见本节末尾"事件回归框架"。

### 数据（`src/data/`）

- `items.json` — **22 件物品**，全部标注 `decay` 档位（新增：brass_pocket_watch / waterlogged_logbook / crab_chitin / brass_fitting / barracuda_jaw / cave_octopus_beak / lantern_gland / grouper_maw）。**12 件 material 全部标 `tier 1–4`（基建地图 §2.2 深度分档）**：T1 coral_shard/shark_tooth/lobster/canned_food/old_fishing_net · T2 brass_fitting/barracuda_jaw/crab_chitin/grouper_maw · T3 cave_octopus_beak/eel_skin · T4 lantern_gland。tier 驱动升级账单稀有度门控 + Mira 回购门控（仅 T1/T2 可买回）。`lantern_gland`（冷光腺，material，sellPrice 16，uncommon，durable——离水过夜不灭不腐的 uncanny 触感）是沉灯水母掉落的天然身体部位，走 Mira（异物收购）。`brass_fitting`（黄铜配件，material，sellPrice 14，durable）是旧灯塔礁打捞向材料，走 Mira 收购；`cave_octopus_beak`（章鱼角喙，material，sellPrice 13，durable）是蓝洞章鱼掉落的天然物，走 Mira；`grouper_maw`（石斑鱼鳔，material，sellPrice 15，T2，**organic**——与 lobster/eel_skin 同档，得趁鲜卖）是礁底石斑鱼掉落的天然物，走 Mira
- `actions.json` — 8 个战斗行动
- `npcs/aldo.json` — Aldo 对话树。教学前 `depart_east`（资格潜水）；教学后出海统一走 `open_chart`（→ openChart effect → 海图）。**旧的逐 zone depart 选项 + 蓝洞/沉船 warning 节点已删**，warning 文案搬进 `chart_pois.json` 的 POI blurb
- `npcs/mira.json` — Mira + banter；`open_shop` 选项触发 `openShop` 切到 shop phase
- `chart_pois.json` — **海图 POI 数据**：`anchors`（每 zone 一个持久点）+ `roamingTemplates`（机会点模板，generateChart 按 runsCompleted 抽取）。字段：zoneId / distance / requiresFlags / requiresUpgrade / modifier（depthOffset 已实装；current·visibility 暂叙事+接口）
- `enemies/reef_shark.json` — 暗礁鲨（HP 32 / armor 0 / 主动撤退）+ 教学战斗 encounter
- `enemies/blind_eel.json` — 盲鳗（HP 18 / 三种攻击：扑咬 / 缠绕含 sanityDamage / 低频共振纯 sanity）+ `combat.blind_eel_solo`
- `enemies/wreck_spider_crab.json` — **沉船蛛蟹**（HP 22 / armor 2 / evasion 3 / threat 5 / territorial / aggressor / 两种攻击：钳夹 w=3 / 甲壳冲撞 w=1）+ `combat.wreck_spider_crab_solo` + `combat.wreck_spider_crabs_pair`（**项目首个多体战斗 encounter**）
- `enemies/reef_barracuda.json` — **梭鱼**（HP 16 / armor 0 / evasion 4 / threat 7 / predatory 不撤退 / 两种攻击：突进撕咬 [5,9] w3 + 掉头掠咬 [3,6] w2）+ `combat.reef_barracuda_solo` —— **reef zone 首个原生战斗 encounter**；玻璃大炮（全场最低 HP + 最高单击），掉 `barracuda_jaw`（material，sellPrice 12，→ Mira）
- `enemies/cave_octopus.json` — **洞穴章鱼**（HP 26 / armor 1 / evasion 3 / threat 6 / territorial 低血撤退 / aggressor / 三种攻击：缠臂 [3,5] w3 + 角喙 [5,8] w1 + 喷墨 0 物理含 sanityDamage [2,4] w1）+ `combat.cave_octopus_solo` —— **蓝洞群深段（40-55m）首个原生战斗 encounter（盲鳗之外）+ 蓝洞首个 realistic-tone 战斗**；physical 攻坚型「深处闸门」（仅次教学暗礁鲨的最厚 HP），3-4 turn 消耗战，掉 `cave_octopus_beak`（material，sellPrice 13，天然物→ Mira，符合 quirk #44）。详见 quirk #46
- `enemies/drowned_lantern.json` — **沉灯水母**（HP 24 / armor 1 / evasion 1 / speed 4 / threat 6 / **tier cosmic** / hostility predatory 不撤退 / aiPattern caster / 两攻击：脉光〔纯 sanity [4,7] w3 主攻〕+ 曳丝〔physical [2,4] + sanity [1,2] w2〕）+ `combat.drowned_lantern_solo` —— **沉船墓园第二只敌人（蛛蟹之外，补齐墓园最长线的敌人缺口）+ 项目首只 cosmic-tier 敌人 + 首只 sanity-主导敌人**。设计＝**「理智消耗战」**：slow/tanky（evasion 1 易命中、armor 1 + hp 24 ≈ knife_slash 3 刀杀），但每回合主攻是纯 sanity 脉光——拖得越久脑子越空。与盲鳗（hp18 evasion4 物理主导·sanity 点缀的快速 flanker）/ 章鱼（hp26 纯物理 bruiser）正好互补：**它是「会烧理智的闸门」**。掉 `lantern_gland`（天然身体部位→ Mira，符合 quirk #44 同蟹甲/梭鱼颌/章鱼喙）。触发事件 `wreck_graveyard.drifting_light` 只挂 `[wreck]` tag（按 quirk #47 跨 zone 共享到灯塔礁 25m+，但「漂着的冷光」在礁底沉船间不出戏，且呼应 reef.lantern_glow『下面的光』）。详见 quirk #48
- `enemies/reef_grouper.json` — **石斑鱼**（HP 30 / armor 2 / **evasion 1（全场最低，hit 0.91 几乎必中）** / speed 6 / threat 4（低，不追）/ tier realistic / hostility territorial（hp≤30% 撤退）/ aiPattern observer / 两攻击：吞口〔gulp physical [6,10] **全场最高单击** w2〕+ 侧撞〔buffet physical [3,6] w3〕）+ `combat.reef_grouper_solo` —— **reef zone 第二只原生战斗 encounter（梭鱼之外）+ territorial『礁檐守卫』原型**。设计＝**低闪避·必中·厚甲·最重单击但 opt-in 的重装墙**：与梭鱼（hp16 glass cannon 速杀 predatory）正相反，threat 低不追、触发事件给 sneak/leave 两个非战斗出口（territorial 玩法签名）；4-turn 消耗战（对照章鱼 cave aggressor bruiser 3-4 turn）。掉 `grouper_maw`（石斑鱼鳔，material T2 organic，天然物→ Mira，符合 quirk #44）。触发事件 `reef.coral_overhang` 只挂 `[reef]`。详见 quirk #53
- `events/tutorial.json` — 6 个教学事件
- `events/reef.json` — 30 个浅海/中海/深海事件（含 reef.barracuda / reef.coral_overhang 战斗触发）（reef / wreck / cave）；`cave.*` 事件会同时在蓝洞群深层池里出现，`wreck.*` 事件会同时在沉船墓园里出现（详见 quirk #17 / #19）。**旧灯塔礁专属 `reef.*` 事件（2026-05-30 周末内容 pass 补的灯塔线）**：`flooded_stair`（灌满水的旋梯 realistic·stamina check·brass_fitting loot）/ `keepers_footlocker`（看守人的箱子 realistic·oncePerRun·lore.old_lighthouse.keeper）/ `bleached_garden`（白化珊瑚 uncanny·loot+sanity 无 check）/ `fog_bell`（雾钟 uncanny·oncePerRun·stamina check + lore.old_lighthouse.bell）/ `lantern_glow`（下面的光 cosmic·oncePerRun·sanity check + lore.old_lighthouse.the_light）——给旧灯塔礁补齐 realistic/uncanny/cosmic 全档，10–42m 全覆盖，全部只挂 `reef`/`shallow,reef` tag（quirk #19）。**深水段 cave.*/wreck.*（2026-05-30 第二个周末 pass）**：`wreck.silted_hold`（realistic·45-60m·stamina·brass_fitting/canned_food）/ `cave.halocline`（realistic·48-60m·盐线下潜·stamina）/ `wreck.porthole`（uncanny·50-60m·oncePerRun·sanity·brass_fitting·lore.deep_water.the_window）/ `cave.blue_floor`（cosmic·52-60m·oncePerRun·sanity·lore.deep_water.cold_light）——填 45-60m 深段（旧灯塔礁 60m 事件池 1→5），跨 zone 共享到蓝洞群（cave.*）/ 沉船墓园（wreck.*）；**wreck.* 掉人造物 · cave.* 掉天然物，避免另一个 zone 出戏（quirk #44）**。**reef 26-44m 中段 uncanny（2026-05-31 周日敌人 pass）**：`reef.lighthouse_lens`（uncanny·30-44m·灯室的镜·`sanity vs 48`·pry_brass 掉 brass_fitting / sight_along 看那道恒定指向礁坡下方的折射亮线·lore.old_lighthouse.the_lens）——填 reef 26-44m 中段 uncanny 缺口（此前最深 reef-only uncanny 是 fog_bell 到 38m），只挂 `[reef]` tag 隔离在灯塔礁（quirk #19，loot 故可用灯塔黄铜不犯 quirk #44），延续灯塔『下面的光』母题但保持 uncanny（物理镜的反常），刻意不触发 d_reveal。**reef realistic 探索密度（2026-05-31 周日第四个 pass）**：`reef.shelf_break`（realistic·30-44m·礁壁的断口·开阔水域的断崖边·`descend_wall` stamina vs12 下探够珊瑚→coral_shard+lobster chance / `skirt_edge` 沿边安全·**填 reef 26-44m realistic 缺口**，此前该段只有 barracuda 战斗触发器 + lobster_hole 到 35m）+ `reef.urchin_barren`（realistic·16-30m·海胆滩·`pick_through` 无 check 在碎礁翻找 coral_shard+sanity-1 / `move_on`·补 reef 浅中段 realistic 密度，生态死寂的克制不安——海胆随影子转刺是真行为，不出 realistic）——均只挂 `[reef]` 隔离在灯塔礁，coral_shard 天然 loot。**reef 浅段 fresh shallow-wrongness（2026-06-02 内容 pass，作者选「全新浅水错位」非灯塔线）**：`reef.silversides`（uncanny·10-24m·一墙银鱼·sanity vs46+lore.reef_shallows.the_gap·coral loot）/ `reef.sun_net`（**cosmic·14-25m·oncePerRun·沙上钉死不动的太阳光网·项目首个浅段 cosmic**·sanity vs50+lore.the_still_square·loot-free）/ `reef.warm_seam`（uncanny·12-24m·礁底缝上来的血温暖水·no-check+lore.the_warm_crack·coral chance）——全 `[shallow,reef]`（只灯塔礁 0-25m 吃 shallow，故隔离），新 `lore.reef_shallows.*` 命名空间，三条不同感官（动物/光/温度）都轻触『下面』但刻意不触发 d_reveal。**reef 第二战斗触发器 `reef.coral_overhang`**（realistic·20-38m·`[reef]`·拔刀逼出石斑鱼→`combat.reef_grouper_solo` / sneak_larder stamina vs13 避战取洞底 coral+lobster / leave_ledge 无代价退——territorial opt-in 三选）。**深段 realistic（cross-zone，2026-06-02）**：`cave.sump_pool`（realistic·46-60m·`[cave]`·回水潭·coral）+ `wreck.chain_locker`（realistic·44-60m·`[wreck]`·锚链舱·brass/canned）——填 60m 段（5→7），守 quirk #44/#47。详见 quirk #53。**深水伏笔 mid（续三，2026-06-02）**：`reef.no_bottom`（cosmic·32-44m·oncePerRun·`[reef]`·断口外空蓝的『深处拉力』·sanity vs50→lore.reef_deep.no_bottom·loot-free·**reef 首个非灯塔线 cosmic-mid**、与 realistic shelf_break 同地标〈断口〉配对，详见 quirk #55）。**realistic 密度收尾（续四，2026-06-02）**：`reef.sand_channel`（realistic·34-44m·`[reef]`·礁脊间平行沙沟+来回涌·`work_groove` stamina vs12 顶涌摸沟底→coral_shard+lobster chance / `near_ledge` 沟口礁檐摸一把 / `cross_over` 沟脊上方横过·**填 reef-only 深中段 realistic 缺口**〈此前仅 shelf_break 触 44m，lobster_hole→35/urchin_barren→30〉，与 shelf_break 同『断口/沙沟』地标家族但机制不同〈横涌 vs 垂壁〉，详见 quirk #56）。**深水伏笔深段（续五，2026-06-02）**：`cave.false_beacon`（cosmic·46-60m·oncePerRun·`[cave]`·loot-free·跟 cave.blue_floor 同深段 cave cosmic 簇·超出自家灯塔光照边界却有一点暖得正是灯塔颜色的光稳稳悬着＝**mimic 假信标直接深段预告**·承中段 the_glow、接 deep_water cold_light/the_window『下面的光』暗线·新 `lore.deep_water.the_false_beacon`·account_for_it sanity vs55 双分支 + swim_for_it『缺氧照游』代价，详见 quirk #57）
- `events/blue_caves.json` — 37 个蓝洞事件（入口/中段/深处；2026-05-30 补 12-25m 浅段：窄口 realistic check + 另一串气泡 uncanny lore）；含分岔水道（迷路 sanity 检定）、可扎营的礁台、钟乳石厅、蓝色水帘、沉默的厅、盲鳗 lair。**深段战斗+cosmic（2026-05-30 第四个周末 pass）**：`octopus_den`（贝壳堆 realistic·40-55m·拔刀 / 压灯慢退 stamina check / 绕开 三选 → `combat.cave_octopus_solo`，章鱼遭遇触发器，参照 reef.barracuda）+ `late_shadow`（慢半拍的影子 cosmic·45-55m·sanity check + lore.bluecaves.late_shadow）——给蓝洞深段补首个 realistic 战斗钩子 + 一个 cosmic 厅事件，都只挂 `cave` tag（跨 zone 共享到旧灯塔礁 cave 层，与盲鳗同模式）。**中段 uncanny/cosmic（2026-05-31 周日第二个 pass，填 30-45m 空白）**：`sounding_line`（测深绳 uncanny·28-40m·stamina vs13 收绳·lore.the_line·从黑里收一根没人收回的测深绳，断口是从下面割的）/ `blind_school`（白色的鱼 uncanny·30-42m·oncePerRun·无 check sanity·lore.blind_school·无眼洞鱼挤成球用侧线"看"你）/ `falling_up`（往上落的雪 cosmic·32-45m·sanity vs50·lore.wrong_down·碎屑往上落，洞里"下"的方向不在下面）/ `thick_water`（变稠的水 cosmic·36-46m·无 check sanity·lore.thick_water·越往深水越稠到不肯再当水）——补蓝洞 30-45m 中段（此前几乎全 realistic，cosmic 只在 45m 以下 late_shadow/silent_chamber），+2 uncanny +2 cosmic，蓝洞 cosmic 2→4。全 loot-free（守 quirk #44：falling_up/thick_water 触 45-46m 会经 `[cave]` tag 漏进旧灯塔礁 cave 层，无人造物不出戏），只挂 `[cave]` tag（quirk #19），lore 全在 `lore.bluecaves.*`，延续"先来者 + 深处"母题但**刻意不触发 flag.d_reveal**。**12-25m 浅段 cosmic（2026-05-31 周日敌人 pass，填浅段 cosmic 空白）**：`the_narrowing`（cosmic·14-25m·oncePerRun·回头的路·洞口那片蓝的出口在你不盯着时会缩小·stare_at_it 无 check / mark_the_rim sanity vs50 / dont_look·lore.bluecaves.the_way_out）——把『方向/感知错乱』母题（falling_up/thick_water 都在 32m+ 深段）下放到还看得见真出口的浅段，反而更不安；此前最浅 cosmic 是 32m falling_up。只挂 `[cave]`（深度 14-25 与灯塔 cave-tag 45m+ 不重叠 → 实际仅蓝洞），loot-free，不触发 d_reveal。**12-25m 浅段 realistic 密度（2026-05-31 周日第四个 pass，针对 quirk #20 entrance_light 过曝）**：`bluecaves.breakdown_pile`（realistic·16-26m·塌石堆·顶板塌方堆死半条水道·`climb_over` 翻石堆 stamina-6 / `thread_gap` 钻渗冷水缝 氧-2+coral_shard chance / `back_to_mouth`·无 check 纯资源取舍，参照 reef.current_drag）——蓝洞浅段此前 realistic 只 entrance_light/tide_mark/squeeze，加一个 caving 障碍稀释 entrance 过曝；coral_shard 天然 loot 守 quirk #44（16-26m `[cave]` 不漏进灯塔 45m+）。**深水伏笔 mid（续三，2026-06-02）**：`bluecaves.the_glow`（uncanny·30-44m·`[cave]`·黑里一点无法溯源、一拐就移到别处亮起的光＝『无灯之光』mimic 假信标伏笔·go_toward→lore.bluecaves.the_glow / douse_lamp sanity vs48 给『会发光的虫子』平淡解释·loot-free·加厚『有人在下面』暗线，详见 quirk #55）。**realistic 密度收尾（续四，2026-06-02）**：`bluecaves.lobster_crack`（realistic·26-44m·`[cave]`·侧壁横缝里够礁虾·`reach_in` stamina vs13→coral_shard+lobster chance / `snap_coral` 只掰珊瑚 / `leave_crack`·**填蓝洞中段 realistic 缺口**〈此前中段 realistic 仅 forked_passage/makeshift_ledge/stalactite_hall 三导航地标、无觅食 beat〉，天然 loot 守 quirk #44，详见 quirk #56）。**12-25m 浅段 `[cave]` 变体密度（2026-06-07 #101 周末 pass·+10 事件 4R/4U/2C·蓝洞事件 27→37·零 registrar）**：R `root_tangle`〈洞口垂下的树根·钻越 stamina·龙虾 forage〉/`percolation`〈气泡拱落顶泥的能见度 hazard〉/`shell_drift`〈空壳堆觅食 coral〉/`surge_passage`〈洞口涌浪借力 stamina〉；U（伏笔·永不交底）`the_feelers`〈盲触觉甲壳类靠嗅觉朝你探须·remipede〉/`the_mirror`〈盐线 halocline 假水面/假出口〉/`the_draft`〈进不去人的小洞往外呼凉气『像底下有口气』·承 someone_below〉/`fresh_silt`〈细灰上朝里去的新鲜鳍沟/掌印·先来者〉；C 伏笔 `deeper_blue`〈竖井暖蓝诱你下去·深处诱饵最浅一拍·oncePerRun〉/`the_same_passage`〈直走却被绕回原地·空间欺骗最浅一拍·oncePerRun〉——填蓝洞最薄『每潜必经』浅池（稀释 quirk #20 entrance_light 过曝），全 `[cave]`（#19·12-25m 与灯塔 cave-tag 45m+ 不重叠故仅蓝洞）·loot 天然守 #44·U/C loot-free 不触发 d_reveal #42·永不交底 #54·灵感 WebSearch 四口新井（cenote 树根 / 盲毒 remipede / relict 钟乳石＝淹掉的干洞 / halocline 假水面），详见 CHANGELOG #101
- `events/wreck_graveyard.json` — **34 个沉船墓园事件**：12 个 dive（船舱入口 / 塌过道 stamina check / 缠脚海草 stamina × oxygen × 刀三选 / 失踪潜水员遗体 lore+物 / 罗盘室怀表 sanity check / 引擎室共鸣 sanity 二次施压 + 刀敲触发蛛蟹双战 / **写字板 `dive_slate` uncanny·22-40m·oncePerRun·lore.wreck_graveyard.the_slate**——2026-05-30 第四个周末 pass 补的墓园叙事，「敲船壳的节奏」呼应 engine_room_hum / silent_chamber 敲击母题，刻意不触发 d_reveal）+ 2 个 portEvent cutscene（`pocket_watch_log` + `logbook_read`）。**2026-05-31 周日 pass 补 4 个 dive（cosmic 1→3 + uncanny 加厚）**：`cold_stores`（uncanny·26-42m·stamina vs13·canned_food/old_fishing_net 人造 loot·"码得太齐的罐头"）/ `hull_handprints`（uncanny·24-40m·oncePerSave·sanity vs48·lore.handprints·玻璃里侧、从内侧按上的手印，区别于 lost_diver 的尸体）/ `the_knocking`（cosmic·30-48m·oncePerRun+oncePerSave·sanity vs55 听 / 回敲违禁分支·lore.the_knocking·是 dive_slate『不要回敲』的付现，延续敲击母题）/ `the_open_door`（cosmic·40-50m·oncePerRun·sanity vs55·门里是开阔黑水+远处冷光+一呼一吸的水流·lore.the_door·接『深处有光』暗线但不触发 d_reveal）——全挂 `[wreck]`、loot 只人造物（quirk #44/#47）。**2026-05-31 周日敌人 pass 补 1 个 dive（沉灯水母触发器）**：`drifting_light`（cosmic·34-50m·oncePerRun·漂着的光·draw_knife→`combat.drowned_lantern_solo` / hold_still 关灯避战 `sanity vs 50` / back_away·lore.drowned_lantern）——墓园第二个原生战斗钩子（参照 octopus_den / engine_room_hum / reef.barracuda），冷光意象呼应 reef.lantern_glow / lore.deep_water.cold_light『下面的光』暗线但不解释、不触发 d_reveal。**realistic 内舱密度（2026-05-31 周日第四个 pass）**：`wreck_graveyard.galley`（realistic·20-34m·伙房·搪瓷杯/铸铁炉/泡胀顶死的存粮柜·`force_locker` stamina vs13 撬柜→canned_food+old_fishing_net chance / `sift_stove` 无 check 炉膛淤泥摸 canned_food chance / `back_out`）——给墓园补一个生活舱内饰质感（区别于 cabin_entrance 井口 / collapsed_passage 结构挤缝 / tangling_kelp 海草），人造 loot 守 quirk #44/#47（跨 zone 共享到灯塔礁 25m+ 不出戏）。**浅段 fresh-wrongness（2026-06-02 续二，deep-game vision 伏笔层，全 `[wreck]`·18-25m·叙述永不交底·不触发 d_reveal）**：`the_other`（uncanny·跟你同步的潜水员·sanity vs48·lore.wreck_graveyard.the_other·loot-free·伏笔 corpse-wearer）/ `all_facing`（**cosmic·oncePerRun·沉船船首全朝塌口深水·sanity vs50·lore.all_facing·墓园首个浅段 cosmic·伏笔深处拉力**·loot-free）/ `full_nets`（uncanny·拖网船的网被底下某物往深处拽·`cut_upper` stamina vs13→old_fishing_net+canned 人造 loot / `follow_down`→lore.full_nets·伏笔深处『渔夫』）——填墓园 18-25m 浅段 uncanny/cosmic 缺口（此前该段全 realistic + dive_slate/handprints 擦边），详见 quirk #54。**深水伏笔 mid（续三，2026-06-02）**：`wreck_graveyard.no_bubbles`（uncanny·26-42m·`[wreck]`·背对你干活却不冒一个泡的潜水员＝corpse-wearer 伏笔+可读 tell〈不呼吸〉·watch sanity vs48 / rap_tank→lore.wreck_graveyard.no_bubbles·**无 combat**·loot-free·承浅段 the_other，详见 quirk #55）。**realistic 密度收尾（续四，2026-06-02）**：`wreck_graveyard.deck_cargo`（realistic·18-26m·`[wreck]`·后甲板捆死的整船货+垮货网·`cut_lashings` stamina vs13 撬木箱→canned_food/old_fishing_net / `pick_spillage` 散货里捡→brass_fitting / `leave_cargo`·**填墓园浅段 realistic 缺口**〈#54 把 18-25m 堆成 uncanny/cosmic 后补无错位打捞质感平衡 tone〉，人造 loot 守 quirk #44/#47，详见 quirk #56）。**深水伏笔深段（续五，2026-06-02）**：`wreck_graveyard.the_wearer`（cosmic·44-56m·oncePerRun·`[wreck]`·loot-free·旧式铜盔潜水服无灯无泡却知道你在哪、招手引你＝**corpse-wearer 穿尸体引诱直接深段预告**·承浅段 the_other / 中段 no_bubbles·埋可读 tell〈无灯/无泡/老装备/机械招手〉·go_to_him 反用本作对死者的温柔·新 `lore.wreck_graveyard.the_wearer`·read_him sanity vs55 双分支·**无 combat** 守 2/zone，详见 quirk #57）。**浅段 `[wreck]` 变体密度（2026-06-07 #99 周末 pass·18-30m·+10 事件 5R/4U/1C·墓园池 24→34·零 registrar）**：`ship_bell`〈船钟·认尸船的老规矩〉/`the_lodger`〈康吉鳗占窝 wreck-as-habitat〉/`coal_bunker`〈煤舱·铲子摆着〉/`the_reef_now`〈沉船成礁·depthRange [18,24] 隔离不漏进灯塔礁故用天然 coral/lobster·守 #47〉/`amphora_hold`〈钢船底下的古陶罐·深时 grounded〉（realistic）+ `the_quarters`〈太齐整住舱·oncePerRun〉/`the_gear_lump`〈数不停的齿轮·撬走=废铜 grounded／拨动=uncanny 拆两路〉/`the_fish_that_wait`〈鱼学会等潜水员〉/`the_same_minute`〈全船钟停在同一分钟·水停钟+时间冻结〉（uncanny·新鲜错位 ≠corpse-wearer/敲击线）+ `swept`〈有东西在打理沉船『会回来』·环境无人影·subtle 深水欺骗最浅伏笔〉（cosmic·oncePerRun·不触发 d_reveal）——填墓园最薄『每潜必经』浅池，全 `[wreck]`（#19）·loot 守 #44/#47·uncanny/cosmic 永不交底 #54·灵感 WebSearch 船钟/康吉鳗/煤舱/Antikythera/古陶罐/同一分钟/沉船成礁/等人的鱼/太齐整住舱/扫过的甲板，详见 quirk #99 / CHANGELOG #99）
- `zones.json` — 东礁（教学线性）+ 旧灯塔礁（随机图）+ **蓝洞群**（随机图，`canFreeAscend: false`）+ **沉船墓园**（随机图，开阔水域，6 层 18–50m，zoneTags=["wreck"]，`canFreeAscend: true`）
- `lighthouse_upgrades.json` — **灯塔设施升级（基建地图 Phase B）**：`tracks[].upgrades[]`，结构镜像 upgrades.json 的 lines（含双资源 `cost`），建成写进 `lighthouse.builtUpgrades`。当前只一条占位轨「信标光源」（lhtrack.beacon lv1/lv2，给 lightRadiusBonus/reachReduction）——真正的设施升级随 Phase C reveal 一起填。`engine/lighthouses.ts` 单文件 import（非目录，不触发 verify-tutorial 的目录注册守卫；但 verify-tutorial §4b 校验其账单材料 id）
- `upgrades.json` — 船坞 / 气瓶库 / **打捞行会**（3 级，含保鲜系数）。**5 个升级 `cost` 现为双资源 `{ materials:[{itemId,qty}], gold }`（基建地图 Phase A，起始账单见 SPEC §2.3）**：dockyard.lv1=coral×6+net×3+20金 / tankhouse.lv1=shark×4+lobster×4+25金 / salvage.lv1=coral×5+brass×3+30金 / salvage.lv2=brass×4+chitin×3+beak×2+70金 / salvage.lv3=beak×4+eel×3+gland×1+150金（等级越高 tier 越深+金币越多，强制下深）

### 事件回归框架（Phase 1）

**目的**：随着 EVENT_DB 越来越大，没法靠跑 random playthrough 去逼游戏触发某个特定事件来测试它的某个分支。这套框架让你直接以 (eventId × 自定义起始 state × seed × 选择序列) 调用引擎，绕开 mapgen 抽取。

**两层结构**：

- `src/engine/eventScenario.ts` —— **纯引擎层 API**。不依赖 UI / Node fs / console，可被 Phase 2 的网页 dev 面板复用。导出 `runEventScenario(input)` / `listAllEvents(filter)` / `describeEvent(id)` / `withSeededRandom(seed, fn)`。
- `scripts/event-runner.ts` —— **CLI 包装**，handwritten argv 解析（无外部 dep）。

**核心机制**：

- **RNG seed**：`withSeededRandom(seed, fn)` 在 fn 期间临时 patch 全局 `Math.random` 为 LCG（Numerical Recipes 参数），fn 跑完恢复。因为 `Math.random()` 散布在 events / combat / mapgen / death 多处，patch 全局比改每个调用点干净。**注意**：runEventScenario 跑的时候不要在同进程并发跑别的引擎代码（quirk #22）。
- **战斗边界**：碰到 `triggerCombatId` 不自动打，记录到 `summary.combatTriggered` 后停步。战斗的回归归 `playthrough-combat.ts` / 战斗专项脚本管。
- **chain 模式**：`'follow'`（默认）跟着 `outcome.triggerEventId` 走多步链路；`'isolated'` 跑一步即停。
- **可见性**：`visibleIf` 严格生效，同时把不可见的选项也列出来并标明被哪个 Condition 挡住（调 visibleIf 时这是核心需求）。

**CLI 用法**：

```bash
# 1. 快速模式
npx tsx scripts/event-runner.ts bluecaves.silent_chamber \
    --sanity 70 --depth 50 --seed 42 --choice stay_a_moment

# 多个 --choice 表示走链
npx tsx scripts/event-runner.ts tutorial.descent \
    --choice continue --choice sneak --choice stealth_grab

# 2. 从 JSON 文件读 scenario（推荐：进 git 持久化）
npx tsx scripts/event-runner.ts --from scenarios/bluecaves_silent_chamber__low_sanity_success.json

# 3. 从 stdin 读 JSON
echo '{"eventId":"bluecaves.silent_chamber","stats":{"sanity":70},"choices":["stay_a_moment"]}' \
    | npx tsx scripts/event-runner.ts --in -

# 4. 辅助命令
npx tsx scripts/event-runner.ts --list                   # 列所有事件
npx tsx scripts/event-runner.ts --list --zone-tag cave   # 按 tag 过滤
npx tsx scripts/event-runner.ts --show bluecaves.silent_chamber  # 看结构

# 输出格式：默认文字，--out json 给程序用
npx tsx scripts/event-runner.ts <id> --out json
```

**场景库 `scenarios/*.json`**：

- 命名规则：`<event_id_点改下划线>__<variant>.json`，例如 `bluecaves_silent_chamber__low_sanity_success.json`
- 一个文件就是一份 `ScenarioInput`（外加可选的 `_comment` 和 `expect` 字段）。`expect` 给 `scripts/playthrough-scenarios.ts` 做断言：`steps` 步数、`finalPhase`、`loreAdded` 子集、`flagsAdded` 子集、`statsDelta` 严格相等、`checkPassed` 布尔、`combatTriggered` 字符串/null。
- 目前 276 个 baseline scenario（2026-06-02 三内容 pass #53/#54/#55 共 +19→68，详见各 quirk；以下为更早的 +6 记录）（**2026-05-31 第四个 pass（realistic 探索密度）+6**：`reef_shelf_break__descend_success`〔reef 中段 stamina check 通过 + coral_shard〕 + `reef_shelf_break__skirt_edge`〔no-check 安全资源路径〕 + `reef_urchin_barren__pick_through`〔no-check loot+sanity〕 + `wreck_graveyard_galley__force_locker_success`〔wreck stamina check 通过 + 人造 loot〕 + `wreck_graveyard_galley__sift_stove`〔no-check loot〕 + `bluecaves_breakdown_pile__climb_over`〔no-check 资源取舍 stamina-6/oxygen-1〕——全 realistic，stamina-check 只锁 success 分支（满 stamina→0.95 clamp，seed 1 确定性过；低 dc 的 stamina fail 无法 clamp 到 0.05，故不做 fail baseline，同既有 reef.flooded_stair / wreck.silted_hold 套路，详见 quirk #43/#49）；**2026-05-31 敌人 pass +4**：`wreck_graveyard_drifting_light__draw_knife_combat`〔战斗边界→沉灯水母〕 + `wreck_graveyard_drifting_light__hold_still_success`〔cosmic 避战 sanity check〕 + `reef_lighthouse_lens__sight_along_success`〔reef uncanny sanity check + lore〕 + `bluecaves_the_narrowing__stare_at_it`〔蓝洞浅段 cosmic 无 check + lore〕；以下为既有：蓝洞群 5 个 + 蓝洞中段 uncanny/cosmic 5 个〔sounding_line haul_up_success〔stamina check 通过〕 + blind_school swim_into〔无 check uncanny〕 + falling_up follow_up_success/follow_up_fail〔cosmic sanity check 双分支〕 + thick_water push_deeper〔无 check cosmic〕〕 + 蓝洞深段战斗/cosmic 4 个〔octopus_den draw_knife 战斗边界 + octopus_den wait_success stamina check + late_shadow watch_success/watch_fail cosmic 双分支〕 + 教学结尾 1 个 + 沉船墓园 4 个 + 墓园 dive_slate 1 个 + 旧灯塔礁 6 个 + 深水段 5 个 + 墓园周日 pass 5 个（cold_stores force_hatch / hull_handprints look_closer / the_knocking listen + knock_back 双 baseline / the_open_door look_in），覆盖：基础 loot / sanity check 通过 / sanity check 失败 / stamina check 通过 / cosmic sanity check 成功+失败两分支 / 多属性同时变化 / 无 check 的 loot+sanity / portEvent-style 事件 / 战斗触发边界 / 剧情物拾取链 + lore）。旧灯塔礁 6 个：`reef_flooded_stair__pry_grate_success` / `reef_keepers_footlocker__open` / `reef_bleached_garden__break_piece` / `reef_fog_bell__listen` / `reef_lantern_glow__descend_success` / `reef_lantern_glow__descend_fail`。深水段 5 个：`wreck_silted_hold__pry_hoops_success`（stamina check 通过）/ `cave_halocline__feel_wall_success`（stamina check 通过）/ `wreck_porthole__look_through_success`（uncanny sanity check 通过 + lore）/ `cave_blue_floor__dig_success`（cosmic sanity check 通过 + lore）/ `cave_blue_floor__dig_fail`（cosmic 失败 -12 sanity + oxygen -5）。
- **添新事件时建议至少加 1 个 baseline scenario 进 scenarios/**，覆盖典型路径——保证以后修改不破坏既有 outcome 行为。

**回归运行**：

```bash
npx tsx scripts/playthrough-scenarios.ts
# ✓ playthrough 完成
# 全部场景通过（6/6）
```

**Phase 2 已实装（2026-05-27，本 session）**：网页内 dev 面板，挂在 `src/ui/dev/`。

入口：开发模式下按 **Shift+D** 切换全屏覆盖层（Esc 关闭）。仅 `import.meta.env.DEV`
才挂载（App.tsx 用 `lazy()` + DEV 守卫；`npm run build` 后 dist JS/CSS 里搜不到
任何 `EventDevPanel` / `runEventScenario` / `dev-panel` 字串——Vite 把 false 分支的
dynamic import 当 dead code 消除了，整个 `src/ui/dev/` 不进 prod 包）。

三栏布局：

- **左**：事件下拉/title 过滤 + zoneTag 过滤；点击切到该事件，下方显示 `describeEvent`
  的 optionSummary（每个选项的 check / outcome / triggerEventId 一目了然）
- **中**：状态编辑表单
  - stats：勾选覆写 + 滑动条 + 数字输入（不勾的字段沿用 staminaMax/oxygenMax 满状态）
  - depth / zoneId（zoneId 留空则按事件 zoneTags 推断）
  - equipment：5 槽分别可勾覆写（空 itemId = null）
  - inventory：可加减行
  - profileFlags / runFlags / unlockedUpgrades / loreEntries（逗号分隔）
  - bankedGold / seed / chain (follow|isolated) / maxSteps
  - choices：根据当前预览的 `step.visibleOptions` 动态渲染每步下拉
- **右**：`runEventScenario` 实时输出。每步显示 title / tone / body / visible options
  (含 check stat/dc/估算 rate) / hidden options (含 blockedBy 原因) / chosen / narrative
  / deltas / next；末尾一张 summary 表

**导入导出**：

- 导出 JSON：复制 `ScenarioInput` 到剪贴板，附带文件名建议 `<event_id 下划线>__<variant>.json`
  （形状与 `scenarios/*.json` 一致，可直接 paste 进 `event-runner.ts --from`）
- 导入 JSON：textarea 粘贴 `ScenarioInput`，应用后表单同步更新
- 存到 localStorage：key 命名 `dev.scenarios.<event_id 下划线>__<variant>`，列表里可一键载入/删除

**实现层**：

- `src/ui/dev/EventDevPanel.tsx` —— 主面板组件（三栏 + 工具栏 + Choices/Preview 子组件）
- `src/ui/dev/ScenarioSerializer.ts` —— form ↔ ScenarioInput 互转、JSON 序列化、localStorage CRUD（纯数据层，无 React 依赖，便于未来挪到战斗 dev 面板复用）
- `src/ui/dev/dev-panel.css` —— `.dev-*` 前缀样式；由 EventDevPanel.tsx 静态 import，prod build 时随面板一起被 tree-shake 出包
- `src/App.tsx` —— 顶层 `useState` 管 `devPanelOpen`，**不进 GameState**（quirk #23）

**不在面板里做的事**（一开始就刻意排除）：

- 不实装 "在浏览器里跑全部 scenarios"——那是 `scripts/playthrough-scenarios.ts` 的工作
- 不自动写文件——浏览器不直接 fs，导出走剪贴板/textarea，用户 Cmd+S 自己存到 `scenarios/`
- 不引新 npm dependency
- 不复刻引擎逻辑——所有计算走 `runEventScenario`，面板只是 form ↔ result 的 UI 包装

### 战斗回归框架（Phase 3）

**目的**：随着战斗参数（HP / 伤害区间 / AI 撤退阈值 / 玩家行动消耗）越来越多，没法靠 `scripts/playthrough-combat.ts` 一个完整流程脚本来 iterate 平衡。这套框架让你直接以 (combatId × 自定义 player state × seed × actions[]) 调用引擎，与事件回归同源套路。

**两层结构 + dev 面板**：

- `src/engine/combatScenario.ts` —— **纯引擎层 API**。不依赖 UI / Node fs / console，可被 dev 面板复用。导出 `runCombatScenario(input)` / `listAllCombats()` / `listAllEnemies()` / `listAllActions()` / `describeEnemy(id)` / `describeAction(id)`，并 re-export `withSeededRandom`。
- `scripts/combat-runner.ts` —— **CLI 包装**，handwritten argv 解析（与 `event-runner.ts` 同套路，无外部 dep）。支持 quick mode（多回合 `--action`/`--target`）/ `--from` / `--in -` / `--list` / `--list-enemies` / `--list-actions` / `--show` / `--show-enemy` / `--show-action` / `--out json`。
- `src/ui/dev/CombatDevPanel.tsx` + `src/ui/dev/CombatScenarioSerializer.ts` + `src/ui/dev/combat-panel.css` —— **网页内 dev 面板**。Shift+C 切换；与事件面板互斥（详见下文 App.tsx 改造）。

**核心机制**：

- **RNG seed**：复用 `eventScenario.ts::withSeededRandom`——同一套 quirk #22 规矩。
- **战斗边界**：碰到 victory / defeat / flee / emergency_ascend / 回合数上限 / 行动用完 → 停步。**不实装** "战斗中触发事件 / 战斗结束回到事件链"——战斗只跑战斗。
- **input.actions[i]**：`{ actionId, targetIndex? }`。`targetIndex` 是 enemies 数组下标（不是 instanceId），让 dev 面板 / JSON / CLI 都能拿数字下标对齐。
- **ad-hoc encounter**：除了 `combatId` 引用注册过的 `combatEncounters`，也可以传 `enemyDefIds: string[]` 自由组合敌人。dev 面板左栏顶部有"注册 combat / ad-hoc 构造"互斥选项。
- **不动 combat.ts 内部逻辑**：reducer / AI / 撤退阈值都不碰，只在 `combat.ts` 上加两个纯 getter（`listAllEnemyDefs` / `listAllEncounters`）供 scenarios 层 introspect。

**CLI 用法**：

```bash
# 1. quick mode（多回合 actions 顺序对齐）
npx tsx scripts/combat-runner.ts combat.tutorial_shark \
    --action action.ambush --target 0 \
    --action action.knife_stab --target 0 \
    --action action.knife_slash --target 0 \
    --seed 42

# 2. ad-hoc
npx tsx scripts/combat-runner.ts \
    --enemy enemy.reef_shark.tutorial --enemy enemy.blind_eel \
    --action action.knife_slash --target 0 \
    --action action.knife_slash --target 1 \
    --seed 1

# 3. 从 JSON 文件读
npx tsx scripts/combat-runner.ts --from scenarios/combat/reef_shark__normal_kill.json

# 4. 辅助命令
npx tsx scripts/combat-runner.ts --list
npx tsx scripts/combat-runner.ts --show-enemy enemy.blind_eel
npx tsx scripts/combat-runner.ts --show-action action.knife_stab
```

**场景库 `scenarios/combat/*.json`**：

- 命名规则：`<combatId 点改下划线>__<variant>.json`，例如 `reef_shark__normal_kill.json` / `blind_eel__sanity_attack_path.json`。
- 一个文件 = 一份 `CombatScenarioInput` + 可选 `_comment` + 可选 `expect`。`expect` 给 `playthrough-combat-scenarios.ts` 做断言：`outcome` / `turnsElapsed` / `survived` / `finalPhase` / `enemiesAlive` / `lootGained` / `statsDelta`，加上 `sanityDeltaAtMost` / `hpDeltaAtMost` / `oxygenDeltaAtMost` 这种"至少损失这么多"软断言。
- 目前 8 个 baseline scenario（reef_shark normal_kill + blind_eel sanity_attack_path + 沉船蛛蟹 solo normal_kill + 沉船蛛蟹 solo flee_retreat（territorial 撤退路径）+ 沉船蛛蟹 pair knife_stab_kill（**项目首个多体战斗**）+ reef_barracuda_solo normal_kill + cave_octopus_solo normal_kill（蓝洞深段 physical 攻坚 bruiser，seed 1 = 3 turns / stamina -28，knife_slash×4）+ **drowned_lantern_solo normal_kill**（墓园 cosmic 「理智消耗战」，seed 1 = 3 turns / stamina -20 / oxygen -3 / **sanity -10**，knife_slash×4——首个 sanity Δ 非零的战斗 baseline））。**添新敌人 / 新 encounter / 改平衡数值时建议至少加 1 个 baseline 进 scenarios/combat/**，保证以后改动不破坏既有行为。

**回归运行**：

```bash
npx tsx scripts/playthrough-combat-scenarios.ts
# ✓ playthrough 完成
# 全部场景通过（2/2）
```

**战斗 dev 面板（Shift+C）**：

三栏布局：

- **左**：模式切换（注册 combat / ad-hoc）+ encounter 列表 + enemy 列表（点击查看 `describeEnemy` 详情：HP/armor/攻击表/撤退阈值/AI/loot）。
- **中**：状态编辑（stats 滑动条 + 勾选覆写、5 槽 equipment、inventory、unlockedUpgrades、zoneId、depth）+ seed / maxTurns + actions[] 动态行（每行 actionId 下拉 + targetIndex 下拉，targetIndex 选项从 result.turns 反推当回合活敌人）。
- **右**：`runCombatScenario` 实时输出。每回合：player log（actor 着色）+ 4 stats 数值与 Δ + 全部 enemies 的 HP bar（含 stance + statuses）+ outcome 着色。末尾一张 summary 表（outcome / survived / turnsElapsed / final stats / stats Δ / loot / enemies alive / final phase），与事件面板的 summary 风格一致。

**导入导出 / localStorage**：

- 导出 JSON：复制 `CombatScenarioInput` 到剪贴板，文件名建议 `<combatId 点改下划线>__<variant>.json`（直接 paste 进 `combat-runner.ts --from`）。
- 导入 JSON：textarea 粘贴 `CombatScenarioInput`，应用后表单同步。
- 存到 localStorage：key 命名 `dev.scenarios.combat.<combatId 下划线>__<variant>`，**加 `.combat.` 中缀避免与事件 scenario 撞 key**（详见 quirk #25）。

**实现层**：

- `src/engine/combatScenario.ts` —— 纯引擎层 API，re-export `withSeededRandom`
- `src/engine/combat.ts` —— 仅新增 `listAllEnemyDefs()` / `listAllEncounters()` 两个 read-only getter
- `src/ui/dev/CombatDevPanel.tsx` —— 主面板组件
- `src/ui/dev/CombatScenarioSerializer.ts` —— form ↔ CombatScenarioInput / JSON / localStorage（不抽公共底座；等第三个 dev 面板再考虑）
- `src/ui/dev/combat-panel.css` —— `.dev-combat-*` 战斗专属样式；通过 `@import './dev-panel.css'` 复用事件面板的 .dev-* 基础变量与控件
- `src/App.tsx` —— 顶层 `devPanel` state 从 `boolean` 改成 `'event' | 'combat' | null` 联合；Shift+D 切事件、Shift+C 切战斗，两个面板互斥（任一打开时按任一快捷键都关闭）

**不在面板里做的事**（一开始就刻意排除）：

- 不实装 "战斗中触发事件 / 事件链跨入战斗回到事件"
- 不抽 `ScenarioSerializer` / `CombatScenarioSerializer` 公共底座——等第三个 dev 面板出现再考虑
- 不重做 `playthrough-combat.ts`（保留作为完整流程的端到端测试，`combatScenario.ts` 只是单战斗）
- 不引新 npm dependency
- 不复刻战斗逻辑——所有计算走 `runCombatScenario`，面板只是 form ↔ result 的 UI 包装

### mapgen 回归 + 地图调试器 dev 面板（本 session 新增）

**目的**：迷路图是随机拓扑，没法靠肉眼跑 playthrough 确认"每张图都连通/有环/有死路/多最深点"。这套延续事件/战斗的回归文化，但 scenario 更轻（只有 `zoneId × seed × depthOffset`）。

- `src/engine/mapgen.ts::analyzeMap(map)` —— **纯结构分析器**（拓扑无关，层状/迷路都能跑）：`allReachable` / `isUndirected` / `cycleRank`(环秩=边-点+分量) / `deadEndIds` / `deepestNodeIds` / `localMaximaIds` / `ascentPointIds` + 可达性 / `entranceIsAscent`。dev 面板与回归脚本共用，不复刻。
- `scenarios/mapgen/*.json` —— 4 个 baseline（蓝洞群 seed1/seed7、暗河口 depthOffset 6、沉船墓园层状对照）。schema = `{ zoneId, seed, depthOffset?, expect }`；`expect` 支持精确锁（nodeCount/edgeCount/maxDepth/entranceDepth）+ 布尔不变量 + `min*` 阈值（minDeepestPoints 等）。命名遵循 `<zone 下划线>__<variant>.json`。
- `scripts/playthrough-mapgen-scenarios.ts` —— 跑 `scenarios/mapgen/` 子目录（quirk #26 约定）：逐 scenario 断言 + 确定性（同 seed 两次生成指纹一致）+ **迷路不变量种子扫描**（blue_caves seeds 1–60，每个 seed 都断言迷路不变量——这是真正值钱的鲁棒性检查，curated 只覆盖几个点）。
- `src/ui/dev/MapDevPanel.tsx` + `map-panel.css` —— **网页内地图调试器**，DEV 模式 **Shift+M** 切换（与事件/战斗面板互斥；`DevPanelKind` 加 `'map'`）。左栏 zone/seed/depthOffset 控制 + `analyzeMap` 结构读数（迷路不变量着色）；右栏节点图 SVG（按 layer=树距分列、按 kind 配色、标最深点/死路/回边）。同样走 `lazy + DEV 守卫 + co-located css`，prod build tree-shake（已验证 dist 里搜不到 `MapDevPanel`/`map-panel`）。

### 关键数值（占位平衡，未细调）

- 起始：体力 100、氧气 60 回合、理智 100、氮气 0
- 检定公式：`successRate = clamp(0.5 + (stat - dc) × 0.015, 5%, 95%)`
- 减压：氮气 < 40 安全 / < 60 一停 / < 80 二停 / ≥ 80 三停
- 战斗中氮气累积 × 1.5（per spec，未实装）；理智衰减 × 1.2（per spec，未实装）
- 节点过渡 turn 数：`1 + Math.floor(depthDelta / 5)`
- 衰减阈值（diveAge）：organic 2 / consumable 5 / material 12 / durable 25 / eternal ∞
- 升级保鲜加成：lv1 +2 / lv2 +5 / lv3 +10
- 海流冲走：6% per item per run（lv3 免疫）

---

## 4. 本次 session 的关键设计决策

| 决策 | 取值 |
|---|---|
| 地图结构 | 随机节点 + 深度推进 |
| 时间粒度 | 回合制，事件可加额外消耗 |
| 死亡模型 | 硬核 Roguelike + 尸体回收 + 建设值永久积累 |
| 恐惧节奏 | 理智值驱动 + 深度加速衰减 |
| 上浮 | 随时可上浮 + 应急上浮必得严重减压病 |
| 装备 | 5 固定槽位 + 装备 + 词缀（MVP 仅等级）|
| 港口升级 | 多分支升级树（船坞 / 气瓶库 / 打捞行会 / 教堂） |
| 战斗经济 | 双资源直读（体力 + 氧气回合） |
| 位置维度 | 无（武器性格代替） |
| 多敌 | 1–4 个，独立 aggro / 姿态 / AI |
| 伤害类型 | 双轨（物理 + 理智），克苏鲁敌人未实装 |
| 重生叙事 | **D 设定**：早期表现为不同潜水员；中期开始故障；终局揭示一直是同一人 |
| 教学关名 | 「初次潜水」（不是「资格潜水」） |

---

## 5. 还没接的功能（推荐处理顺序）

### 高优先级（meta-loop 最后一公里）

- [x] **基建地图 revamp · Phase A（材料经济）** —— 2026-06-01 实装。把"建设值买升级"整体换成"**材料 ＋ 金币** 买升级"：`UpgradeCost{ materials, gold }`、material `tier 1–4`、`canPurchase`/`purchaseUpgrade` 双资源、`buildingPoints` 整体移除、SAVE_VERSION 1→2、Mira 回购侧（T1/T2 可买/`shopStock` 限量+回港补满）、UpgradePanel 账单缺口高亮 + MiraShopView 回购区。反刷机制从抽象分数改由"稀有材料只在深处掉"承担。设计源 `docs/spec/深海回响_基建地图_SPEC.md`（§2/§5/§6/§8，Phase A 已打勾）。回归全绿（`playthrough-upgrades`/`-economy`/`-save` + `smoke-chart-ui` J/K）。详见 quirk #50。提交 `4612c0c`。
- [x] **基建地图 revamp · Phase B（灯塔数据模型）** —— 2026-06-01 实装。多灯塔基地的**数据层 + 引擎脚手架**：`Lighthouse` 类型（`types/lighthouse.ts`）+ `profile.lighthouses` + home 灯塔种入/迁移（SAVE_VERSION 2→3）+ `engine/lighthouses.ts`（每灯塔升级轨 canBuildAt/buildAtLighthouse + getLighthouseBonuses + nearestLighthouse，与全局 upgrades.ts 平行）+ `data/lighthouse_upgrades.json`（信标占位轨）。**灯塔 inert——没接进 chart/dive/UI，游戏行为不变**；reveal（点亮揭示）/ reach（最近灯塔算 distance）是 Phase C。`dockyard` 仍全局（归属决策留 Phase C）。回归全绿（新 `playthrough-lighthouse.ts` + `-save` v2→v3 + verify-tutorial §4b 账单材料校验）。详见 quirk #51。**下一步：Phase C（海图集成 + 修复循环）——见 `docs/NEXT_SESSION_PROMPT.md`。**
- [x] **港口升级 UI** —— `src/ui/UpgradePanel.tsx` + `engine/upgrades.ts`。Port 界面有"修缮港口"入口。
      船坞 lv1 通过新的 `hasUpgrade` Condition 严格门控旧灯塔礁；气瓶库 lv1 在 `startDive` 链路真正 +10 oxygenMax。
      验证脚本：`scripts/playthrough-upgrades.ts`。
- [x] **教学结尾日志的港口触发** —— 新增 `GamePhase = portEvent`。玩家点 ResolutionView "回到港口" 时，
      `engine/portEvents.ts::pickReturnTrigger` 扫 inventory 找 `item.story.triggersEventId`，
      命中即先 null run、再进 portEvent；`PortEventView` 用同一套 DiveEvent schema 渲染，结束写
      `flag.event_done.<id>` 防重播。`engine/events.ts::applyOutcome` 现在在无 run 时把 applyFlags / goldDelta
      路由到 `profile.flags` / `profile.bankedGold`。验证路径在 `scripts/playthrough.ts`。
- [x] **战利品变卖（Mira 柜台）** —— `engine/port.ts` 实装 Mira 收购：`MIRA_BUY_RATIO = 0.8`，
      `sellItemToMira` / `listMiraSellables` / `miraOfferFor` / `isSellableToMira`。eternal / story / sellPrice=0 物品不收，
      留在 `profile.inventory`。`engine/ascent.ts::computeLootValue` 接入 `sellPrice × ratio`，但只是显示值；
      `RunOutcome.goldEarned` 现在只反映 `run.gold`（事件给的），`RunOutcome.lootValue` 是潜在变卖价值，
      实际入账要走 `ui/MiraShopView`。`engine/dialog.ts::openShop` effect 切 phase 到 `'shop'`，
      App.tsx 顶层挂 `MiraShopView`。验证脚本：`scripts/playthrough-economy.ts`。

### 中优先级（味道）

> **设计哲学锚点**：深海回响是 roguelike，每次出海都该不同。引擎层面已经做到了（mapgen 抽事件 / DeathRecord 驱动尸体 / 衰减 / 海流冲走），瓶颈是**内容池太薄**——最初 14 事件 / 1 敌人 / 1 random zone，重复 2–3 次就认脸。下面这组中优先级里，"扩内容"权重比"加新系统"高。
>
> **内容进度（周末内容引擎在持续补，每次 pass 换 zone/深度/tone 侧重）**：**当前（2026-06-07·#103）：207 事件〔`event-runner --list`〕/ 7 敌人 / 3 random zone（旧灯塔礁 reef · 蓝洞群 cave/maze · 沉船墓园 wreck）+ 7 深度 band（trench 60m → nameless 230-290m·#103 把 abyssal 108-140m 从 11→20 做成最稠密 band『前所未见之物』）· event baseline 307 / combat 9 / item 22。滚动内容进度与「下批薄弱处」以自动记忆 [[weekend-content-log]] 为权威（本 §5 仅留快照 + 历史 tone 覆盖参考）。** 〔以下为 2026-05-31 历史快照〕63 事件 / 6 敌人 / 3 random zone（旧灯塔礁 + 蓝洞群 + 沉船墓园）。各 zone tone 覆盖：蓝洞群 realistic/uncanny/cosmic 齐（**2026-05-30 第四个 pass 补蓝洞深段首个 realistic 战斗＝洞穴章鱼 + 一个 cosmic 影子厅；2026-05-31 周日第二个 pass 补 30-45m 中段 +2 uncanny +2 cosmic**，cosmic 2→4）· 沉船墓园齐 · **旧灯塔礁（reef）2026-05-30 补齐 realistic/uncanny/cosmic（灯塔线 5 事件）+ 深水段 45-60m 4 事件（cave/wreck 跨 zone，60m 池 1→5）**。**敌人 6 只**：reef 梭鱼（玻璃大炮）/ 蓝洞章鱼（深处闸门 physical 攻坚，territorial 撤退）= 2026-05-30 两个 pass 各补一只 / **墓园沉灯水母（cosmic「理智消耗战」，2026-05-31 周日敌人 pass，墓园第二只 + 项目首只 cosmic-tier + 首只 sanity-主导）**；外加暗礁鲨(教学)/盲鳗(蓝洞 uncanny)/蛛蟹(墓园)。**三个长线薄弱处本 pass（2026-05-31 敌人 pass）全部补上**：~~墓园敌人只蛛蟹一只（最长线缺口）~~→ 已补沉灯水母（墓园 2 敌）· ~~reef 26–44m 中段缺 uncanny~~→ 已补 `reef.lighthouse_lens` · ~~蓝洞 12–25m 浅段 cosmic 空（最浅 cosmic 在 32m）~~→ 已补 `bluecaves.the_narrowing`（14-25m）。**当前仍薄的（下一批候选）**：reef 仍只 1 只原生敌人（梭鱼）——可补第二只（reef 中深段 realistic/uncanny tone，与梭鱼玻璃大炮互补，是 §5 点名最久的缺口）· **reef 26-44m realistic 本 pass 已补 `shelf_break`**，但 reef 浅段（10-25m）uncanny/cosmic 仍空（只 bleached_garden 16m 起 uncanny）· 墓园/蓝洞 cosmic 已厚，叙事重心可转向 reef 深段或蓝洞更多敌人 · `flag.d_reveal` 终局揭示钩子**仍刻意保留不触发**（quirk #42/#44/#48/#49，留给在场用户定，不是内容缺口）。【2026-05-31 周日第四个 pass（realistic 探索密度）：事件 59→63、event baseline 43→49、无新敌人；reef 26-44m realistic 缺口（shelf_break）+ reef 浅中段（urchin_barren）/wreck 内舱（galley）/蓝洞浅段（breakdown_pile）realistic 密度各补一个】【2026-05-31 周日敌人 pass：墓园敌人 1→2、事件 56→59、敌人 5→6、event baseline 39→43、combat baseline 7→8，三长线缺口全补】

- [x] **扩 zone 内容池（第一波：蓝洞群）** —— 新 random zone `zone.blue_caves`（12–55m，6 层），8 个事件 +
      新敌人盲鳗。引入了**封闭水域**机制：`ZoneDef.canFreeAscend: false` + mapgen 不再在中间层生成 ascent_point
      + AscentView 用 `isAscentBlocked` 锁住 normal/rushed，emergency 重描述为"凿穿洞顶"。
      验证脚本：`scripts/playthrough-bluecaves.ts`。
- [x] **扩 zone 内容池（第二波：沉船墓园）** —— 新 random zone `zone.wreck_graveyard`（18–50m，6 层，开阔水域），
      6 个原生 dive 事件 + 2 个 portEvent cutscene + 沉船蛛蟹（**项目首个多体战斗 encounter**：solo + pair）。
      与蓝洞群形成对照：开阔水域 `canFreeAscend: true`，中间层会出现 ascent_point。reef.json::wreck.* 跨 zone
      共享到此（与 cave.* 给蓝洞群是同模式）。验证脚本：`scripts/playthrough-wreckyard.ts`。
- [x] **港口"海图"选点 UI** —— 已实装。Aldo briefing 的逐 zone 下拉换成港口外的 POI 海图。
      - **数据/引擎**：`src/data/chart_pois.json`（anchors 每 zone 一个持久点 + roamingTemplates 机会点）+ `src/engine/chart.ts`（`generateChart` 纯函数：anchor 持久、roaming 按 `runsCompleted` 种子刷新，**派生自 profile 不入存档 → 零 SAVE_VERSION 影响**）。
      - **两级门控**：`requiresFlags`=发现（不满足不出现）、`requiresUpgrade`=抵达能力（不满足则海图灰显可见但不能出海）。旧灯塔礁 = tutorial_complete + dockyard.lv1。
      - **修正（modifier）·三种全部实装**：`depthOffset`（`mapgen` 平移整图深度 → 经 tickTurns/planAscent 自然更耗氧·更长减压）；`distance`（出海预耗氧 + turn，"远 = 多耗氧 / 路上多 turn"）；`current`（每次节点移动额外耗体力+氧，strong −8/−2、mild −3/−1，`engine/dive.ts::currentMoveCost` + moveToNode，洋流耗氧也能致死）；`visibility`（理智压力 dark −0.35/turn、murky −0.15/turn，`engine/events.ts::visibilitySanityDrain` + tickTurns，且 **dark 时 NodeSelectView 遮蔽前方预览=盲航**）。修正统一暂存 `run.diveModifier`。
      - **入口/UI**：`openChart` DialogEffect + `phase 'chart'`（镜像 `openShop`→`shop`）；`src/ui/SeaChartView.tsx` 顶层视图（App.tsx 挂载）；PortView 加"摊开海图（出海）"按钮（教学后可见）；`src/engine/dive.ts::startDiveFromPoi` 封装出海。
      - **2D 地图视图（2026-05-29 升级）**：SeaChartView 从列表改成 2D 海图——港口在左、左→右≈离岸越远/越深，POI 是可点标记（实心=锚点 / 虚线=机会点 / 灰=未解锁），选中后信息面板（桌面右侧 / 手机下方）显示该点 名/标签/blurb/出海 + Lv.2 选目标。POI 带归一化 `mapX/mapY`（anchors 写死在 chart_pois.json，roaming 从模板透传；缺省按 distance 兜底）。**纯展示层重写，engine/门控/startDiveFromPoi 不变**。详见 quirk #41。
      - **回归**：`scripts/playthrough-chart.ts`（引擎层：门控 / roaming 刷新确定性 / depthOffset 真改深度 / distance 预耗氧）+ `scripts/smoke-chart-ui.tsx`（**React 层**：SeaChartView/PortView 服务端渲染断言——POI 渲染 / 锁定原因 / 空态 / 海图入口门控，补上 playthrough 测不到的 UI 层）。`playthrough.ts` RUN2、`playthrough-upgrades.ts` §6、`playthrough-wreckyard.ts` Phase9、`verify-tutorial.mjs` 已迁到海图机制。
      - **未做（留给后续）**：海图 dev 面板；地图美术（当前是极简平涂水面 + 深度带，无海岸线绘制）；洋流"冲走物品/位移尸体"这类与 inventory/corpse 交互的进阶效果（当前 `current` 只影响移动消耗）；能见度对技能检定/战斗命中的影响（当前只影响理智 + 节点预览可见性）。
- [x] **更多敌人 + 理智伤害实装** —— 盲鳗（`enemy.blind_eel`）三种攻击中两种带 `sanityDamage`：缠绕（物理 + sanity 双轨）+ 低频共振（纯 sanity）。`EnemyAttack.sanityDamage` 字段正式走通。
- [x] **真"迷路" mapgen** —— 已实装。`ZoneDef.mapShape: 'layered' | 'maze'`（与 `canFreeAscend` 正交）分流两套生成器：开阔海域走原层状 DAG（行为不变），洞穴 zone（蓝洞群，`mapShape:'maze'`）走 `generateMazeMap`。
      - **拓扑**：随机 spanning tree（连通 + 自然死路）+ 弦边（环/绕回），**双向 `connectsTo`**（玩家可回头/绕回，getNextChoices 含来路）。受保护叶子做 2–3 个"最深点"（深度钉 d1、邻居更浅 → 严格局部极大）+ 1 个"洞另一头的出口"。
      - **上浮语义**：入口（洞口）+ 远端出口都是 `ascent_point`（`isAscentBlocked` 在二者放行，内部节点仍只能 emergency）——**设计决策：入口可退回出去**（realistic + 不剥夺退路，迷路的代价由"往返耗氧"自然承担，而非堵死）。`depthOffset` 对迷路同样生效。
      - **重访**：`moveToNode` 检测 `visitedNodeIds`，重访已结算的事件节点不重播（退化成安静水域）；NodeSelectView 标"已来过"（盲航也显示，你记得来路）；建设值/eventsTriggered 改用去重计数，防来回踱步刷分。
      - **验收**：`analyzeMap` + `scripts/playthrough-mapgen-scenarios.ts`（4 baseline + 60-seed 不变量扫描 + 确定性）+ 重写后的 `playthrough-bluecaves.ts`（迷路版 isAscentBlocked）。可视化迭代用 Shift+M 地图调试器。详见 §3「mapgen 回归 + 地图调试器」+ quirk #30–#34。
      - **未做（留给后续）**：迷路里 `air_pocket`/`camp` 等新 NodeKind 布点（见下条）；尸体提示在迷路里的密度调优；玩家"画过的路线图"持久 UI（visitedNodeIds 是 append-only 全路径，已具备数据）。
- [x] **气穴 / 扎营节点化** —— 已实装。新增 NodeKind `air_pocket` / `camp`，`generateMazeMap` 在非保护内部节点上布点（气穴 ~0.7、偏深处；扎营 ~0.5）。玩家在选点界面就能看到地标（NodeSelectView 渲染 `○ 气穴` / `⌂ 扎营点`，盲航也显示——是导航地标）。
      - **气穴**：`breatheAtAirPocket` 氧气 +6 / 理智 +4，**不耗回合**，但**一次性**——用过把 `air_used:<nodeId>` 写进 `run.activeFlags`，重访失效（防迷路里来回蹭气穴刷无限氧）。
      - **扎营**：`campAtNode(state,'short'|'long')` 短 3 回合/+15 体力/+5 理智，长 6 回合/+30 体力/+10 理智/−5 氮。先 `tickTurns` 再叠加恢复——所以**长档在深处仍净增氮气**（tick 吸氮 > −5），不是减压捷径，代价是流逝的氧气（与普通 rest 同理）。
      - 两者复用 `dive` 的 `'rest'` subPhase，RestView 按 `node.kind` 分渲染；NodeChoice 加了 `kind` 字段。corpse pass 排除地标（不在气穴/扎营上压尸体）。事件版（`makeshift_ledge`/`cave.air_pocket`）保留共存（随机撞见的版本）。
      - **验证**：`playthrough-bluecaves.ts` Phase 6（换气增益+枯竭+上限、扎营对 tickTurns 基线断言）+ `playthrough-mapgen-scenarios.ts` 种子扫描里地标出现率（气穴 39/60、扎营 30/60）+ `smoke-chart-ui.tsx` G（地标标签渲染）。详见 quirk #37。
- [x] **D-reveal 文本故障化** —— 已实装。纯 UI 助手 `src/ui/diverName.ts::renderDiverName(rawName, deathsCount, revealed)`：1–4 次正常、5–9 笔误（相邻字符交换）、10+ 故障文字（叠组合附加符），`revealed`（`profile.flags.has('flag.d_reveal')`）置位后一律显示「你」。确定性（按 name+count 用共享 makeLcg 播种，渲染不闪）。已接进 `FuneralView`（标题）+ `CorpseView`（尸体名 + 取物日志），都读 `profile.deaths.length` + 揭示 flag。**`flag.d_reveal` 目前没有任何内容设置它——留给后续 lore 事件的钩子**（终局揭示）。验证：`playthrough-corpse.ts` 阶段 6（四档 + 确定性单测）+ `smoke-chart-ui.tsx` I（FuneralView SSR 渲染：正常/故障/揭示）。详见 quirk #42。
- [x] **打捞行会 Lv.1 的 corpse hint UI 显示** —— 已实装。`dive.ts::enterNodeSelection` 现按 `getUpgradeBonuses(profile).revealCorpseHint`（Lv.1 加成）门控：有 Lv.1 时尸体节点在选点界面带提示（`hasCorpseHint` → 红框 + "这一带似乎有熟悉的东西…" + 保留"熟悉的轮廓"预览）；**没有 Lv.1 时尸体节点伪装成普通水道**（hasCorpseHint=false + 中性预览，不剧透），但 `moveToNode` 仍按 `kind==='corpse'` 路由——撞上去照样进 CorpseView。验证：`playthrough-corpse.ts` 阶段 5。详见 quirk #36。
- [x] **打捞行会 Lv.2 的出海前选目标** —— 已实装。海图 POI 卡片（`SeaChartView`）在拥有 `preDiveCorpseSelect`（Lv.2 派生加成，已有）且该 POI 所在 zone 有可回收尸体时，显示"锁定目标"下拉；选中后 `startDiveFromPoi(state, poi, { targetCorpseId })` → `startDive` → `generateDiveMap` 的 `GenOpts.targetCorpseId`，在 corpse pass 里**保证布点**（绕过 corpseChance 随机 + ±10m 深度窗，放深度最接近 `depthAtDeath` 的可用节点；层状/迷路两套都支持）。可回收判据集中在 `death.ts::isRecoverableCorpse` / `listRecoverableCorpses`（zone 匹配 + 未回收 + diveAge<25 + 还有物品），UI 与 mapgen 共用。无效 id 自动退回随机。验证：`playthrough-corpse.ts` 阶段 4（层状 10/10 + 迷路布点）+ `smoke-chart-ui.tsx` F（picker 渲染门控）。详见 quirk #35。

### 低优先级（扩展）

- [ ] **尸体衰减时的 UI 提示** —— 玩家回港时如果有尸体衰减/被冲走，给个 toast 提示，制造紧迫感。
- [ ] **亡者之径事件** —— 同 zone ≥ 5 具尸体时强制生成 `cave.choir` 节点。
- [ ] **失能（Incapacitated）状态** —— 体力 0 不直接死，给"最后挣扎"窗口。
- [ ] **战斗中氮气 ×1.5 / 理智 ×1.2** —— per 战斗 SPEC §10，未实装。
- [ ] **背包负重影响上浮速度** —— per 主 SPEC §8.2，未实装。

---

## 6. 已知的 quirk 和注意事项

已知 quirk 与约定已迁出至 [docs/QUIRKS.md](QUIRKS.md)（**生效中** + **已解决** 两节，编号保持不变）。

## 7. 仓库结构

```
Blue/
├── docs/
│   ├── 深海回响_SPEC.md              主设计文档
│   ├── 深海回响_战斗系统_SPEC.md     战斗系统专题
│   ├── 深海回响_教学关剧本.md        第一次下潜剧本
│   ├── STATUS.md                     ← 本文件
│   └── legacy/                        早期草案
├── src/
│   ├── App.tsx, main.tsx, styles.css
│   ├── types/    (state/events/enemies/items/npcs/dive/combat/chart/upgrades/index)
│   ├── engine/   (state[含存档层]/events/dialog/chart/clarity[微观双传感器]/zones/mapgen/dive/ascent/combat/death/items/port/portEvents/upgrades/lighthouses/eventScenario/combatScenario/rng)
│   ├── ui/       (PortView/PortEventView/SeaChartView[2D 地图+灯塔节点/点亮圈]/MiraShopView/UpgradePanel/LighthouseBuildPanel/EventView/NodeSelectView/RestView/CombatView/AscentView/CorpseView/ResolutionView/StatusBar/diverName[D-reveal 渲染])
│   │   └── dev/  (EventDevPanel + CombatDevPanel + MapDevPanel + ScenarioSerializer + CombatScenarioSerializer + dev-panel.css + combat-panel.css + map-panel.css — 仅 DEV 模式加载，Shift+D / Shift+C / Shift+M 互斥切面板)
│   └── data/     (items/actions/zones/upgrades/lighthouse_upgrades[含 ruins]/chart_pois + depth_bands[7 band·最深 band.nameless >230m] + npcs/<id>.json + events/{tutorial,reef,blue_caves,wreck_graveyard,lighthouse,trench,abyssal,hadal,subhadal,nameless,mimic}.json + enemies/{reef_shark,blind_eel,wreck_spider_crab,reef_barracuda,cave_octopus,drowned_lantern,reef_grouper}.json)
├── scripts/
│   ├── verify-tutorial.mjs               数据图引用完整性
│   ├── playthrough.ts                    教学+随机图+上浮
│   ├── playthrough-combat.ts             战斗（完整流程端到端）
│   ├── playthrough-corpse.ts             死亡+回收
│   ├── playthrough-decay.ts              衰减+海流
│   ├── playthrough-upgrades.ts           升级树 + 派生加成
│   ├── playthrough-economy.ts            仓库 + Mira 变卖
│   ├── playthrough-bluecaves.ts          蓝洞群 + canFreeAscend + 盲鳗
│   ├── playthrough-wreckyard.ts          沉船墓园 + 蛛蟹 solo+pair + lost_diver/watch portEvent 链 + crab_chitin → Mira
│   ├── playthrough-sensors.ts            微观双传感器 / clarity（深水区 Phase 0a）：灯真相 / 黑水盲 / 声呐表象+spoof / power 摸黑 / 低 san 腐蚀 / signature
│   ├── playthrough-stealth.ts            探测/隐身/警觉（深水区 Phase 0b）：抬升 / 摸黑消退 / 浅水免压 / 越线触发遭遇 / 摸黑滑过 / 无池不触发
│   ├── playthrough-bands.ts              深度 band / 蛙跳下潜（深水区 Phase 1）：band 表 / 破 60m / depthRange 覆盖 / startDiveFromOutpost / 软门控 / 升级直通 / alert 饱和
│   ├── playthrough-chart.ts              海图引擎回归：门控 / reveal+reach / roaming 刷新 / depthOffset / distance
│   ├── playthrough-lighthouse.ts         灯塔引擎回归：canBuildAt/build/bonuses/nearest + revealRadius/船坞桥
│   ├── playthrough-lighthouse-scenarios.ts  灯塔修复循环：修复账单 + reveal/reach 前后 + round-trip + scenarios/lighthouse/*.json
│   ├── smoke-chart-ui.tsx                海图 UI 渲染冒烟：SeaChartView/PortView/LighthouseBuildPanel 服务端渲染断言（React 层）
│   ├── playthrough-scenarios.ts          事件回归：跑 scenarios/*.json
│   ├── playthrough-combat-scenarios.ts   战斗回归：跑 scenarios/combat/*.json
│   ├── playthrough-mapgen-scenarios.ts   mapgen 回归：跑 scenarios/mapgen/*.json + 迷路不变量 60-seed 扫描 + 确定性
│   ├── playthrough-save.ts               存档序列化回归：Set round-trip + 版本迁移 + 损坏/未来版本
│   ├── explore-bluecaves.ts              蓝洞群手动多局探索（非 assert，迷路版已修上浮逻辑）
│   ├── event-runner.ts                   事件回归 CLI（--list / --show / --from / --in / quick mode）
│   └── combat-runner.ts                  战斗回归 CLI（--list / --list-enemies / --list-actions / --show / --from / quick mode）
├── scenarios/                            事件回归场景库（JSON，每份一个 ScenarioInput + expect 断言）
│   ├── combat/                           战斗回归场景库（JSON，每份一个 CombatScenarioInput + expect 断言）
│   ├── mapgen/                           mapgen 回归场景库（JSON，{ zoneId, seed, depthOffset?, expect }）
│   └── lighthouse/                       灯塔修复循环场景库（JSON，lighthouse_ruin 的 leave/restore 路径）
├── package.json, tsconfig.json, vite.config.ts, index.html, README.md
```

---

## 8. 下次接手时的快速 onboarding

1. 读 `docs/spec/深海回响_SPEC.md` 主 SPEC（前 6 节即可对齐世界观和核心循环）
2. 读 `docs/spec/深海回响_战斗系统_SPEC.md` §2–§7（战斗基本机制）
3. 读本文件第 3、5、6 节
4. 跑 `npx tsx scripts/playthrough.ts` 看一次完整 trace，几秒搞定
5. `npm run dev` 在自己机器上点一遍 UI

中优先级已全部做完（迷路 mapgen / 海图 2D / 气穴·扎营 / 打捞行会 Lv.1·Lv.2 / D-reveal）。然后可以接 §5 低优先级（尸体衰减 toast / 亡者之径 / 失能状态 / 战斗氮气·理智系数 / 负重影响上浮），或之前 mock 过但没建的**状态效果系统**（run 级 StatusEffect + StatusBar 图标行，bends II/III 当首个真实消费者），或扩内容（蓝洞 12–25m 浅段缺口 quirk #20 / 更多敌人），或给 `flag.d_reveal` 接一个终局 lore 触发。
