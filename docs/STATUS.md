# 深海回响 · 当前实装状态

> 当前实装状态见下方各节（§1 一句话状态最权威）。完整会话历史 → [docs/archive/CHANGELOG.md](archive/CHANGELOG.md)；已知 quirk 与约定 → [docs/QUIRKS.md](QUIRKS.md)。**活数字（事件 / 敌人 / 脚本 / scenario 计数）以 `npm run handoff` 的 git 真值为准·本档不再硬抄**（防 STATUS 随内容 churn 漂移）。近期 session（新→旧）：
> **2026-07-19 #319 声呐图两处手感修 + 猎手 per-图确认（同日续·Cowork·Fable·沙箱全量 90/90 绿·无新 quirk·commit 待定·push 留 Mac/nightly）**：① ping 后标记不再跳位——相邻标记落点恒用 poiOffset 同一锚（旧「未知=房心·扫到瞬跳偏心位」删·known 只切「? m」→字形/深度文案·kind 无泄漏〔相邻地标在选项列表本就诚实〕）；② 删「已在声呐图上选中一处…」pending 提示句（联动高亮自己会说话·smoke Q2 改别复活口径）；③ 猎手 per-图＝#318 模型本身（zone.hunts 逐图 + ambushEncounters 逐图池 + per-encounter stalker 标签）·内容期作者逐图调·零代码。树：main·commit 待定·push 留 Mac/nightly。
> **2026-07-19 #318 猎手改「图的属性」——zone.hunts 重接 run.huntEnabled 产者 + 删试玩启动器开关 + 新 zone.hunt_test（同日续·Cowork·Fable·沙箱全量 90/90 绿·新 quirk #264·commit 待定·push 留 Mac/nightly）**：作者问「猎手为什么还能选择不开启」→ 勘察：旧产者 DepthBand.hunts 随 band 删（#294）已死·全仓唯一开关＝启动器勾＝真游戏猎手从来不开。定向「有猎手的图默认都会有猎手·不能开关」→ `ZoneDef.hunts` → startDive（单一汇流点）落 run.huntEnabled（唯一产者）；新 `zone.hunt_test`（唯一标 hunts 的 QA 图·baseline zone 刻意不标防翻 playthrough-stealth·boss 地盘不标各有专属编排）；启动器删开关 + 下拉「·猎手」后缀。smoke +2 断言。内容期逐图拍 hunts 留作者。树：main·commit 待定·push 留 Mac/nightly。
> **2026-07-19 #317 试玩启动器两拍——默认装备自带声呐 + 上浮后结束试玩（同日续·Cowork·Fable·沙箱全量 90/90 绿·无新 quirk·commit 待定·push 留 Mac/nightly）**：作者试玩反馈两条。① PlaytestPanel `STARTER_PICKS`→`DEFAULT_PICKS`（声呐槽默认 item.sonar.handheld·声呐已是地图本体没它全黑·其余槽仍镜像 starter·smoke 焊断言）+ 重置按钮改「默认装备（含声呐）」。② App 新可选 prop `onPlaytestEnd`（phase→'port' 即回调）·PlaytestPanel 传入 ⇒ 上浮结算「回港」/葬礼后**结束试玩回配置面板**（选项保留一键再启动）而非进港口 UI；正常游戏不传零影响。dev工作台 SPEC §9 补段。树：main·commit 待定·push 留 Mac/nightly。
> **2026-07-19 #316 声呐图标记层收窄「只画能抵达的 + 敌」+ 删琥珀威胁/残图小地图 + 女王常显（同日续·Cowork·Fable·沙箱全量 90/90 绿·新 quirk #263·commit 待定·push 留 Mac/nightly）**：作者定向「不显示所有节点·只显示能抵达的和敌」+「追猎位置应扫描才更新」。定因：红点本就 ping 才刷新（seen* 唯一写点=scanStalker）；会动的是琥珀 threatContact（alert 驱动·方位按 turn 漂移）——整删（engine+样式+E7/§12 测试）；farMarkers 全图 ? m 点与残图小地图同删（泄拓扑）。新增女王标记：warrenHunt.queenNodeId 扫过后**实时常显**（.sonar-queen·relocate 跟随·唯一实时敌显·boss 特权·蜂群 SPEC 顶 banner 记知情后果：三选一搜寻信息学被消解+回退口径）。smoke 新 §W 三拍。SPEC 改注 3 份。file-budget 机械收缩（SonarScanPanel 1192→1037）。树：main·commit 待定·push 留 Mac/nightly。
> **2026-07-19 #315 声呐重构二连——收编 07-18「三层解耦」+ 声呐无升级化（无射程·一记 ping 全图揭示·全图三态迷雾）（Cowork·Fable + 2 subagent·沙箱全量 90/90 绿〔build 环境跳〕·SAVE 17→18·新 quirk #262·合成一笔 commit·push 留 Mac/nightly）**：作者定向「无升级 / 范围无限 / 扫一次全亮·移动全灰」+ 四分叉拍板（合一笔 / 猎手全图必闻 / 声呐门=活条件同灯 / 代价留固定电量+自曝）。引擎拔整条射程/升级链（items.json 声呐件删 upgradeSteps·SensorTuning 删 pingCost/sonarScanRange·revealSonarScan BFS/sonarRevealRadius 删）；scanMemory+scanOrigins 两表收敛成 `run.lastScanTurn?` 单标量（真条件字段）·亮=sensors.sonar==='ping'·applyTransit 移动归 off=变灰；SonarScanPanel 迷雾塌缩全图三态（黑=不合成 bake 防剧透铁律沿用·扩散波荡到布局最远角·underFog 保 ping 前底态）；SAVE 17→18（quirk #99 弃旧档）。回归重写 6 脚本·对抗复审无必修·SPEC 改注 7 份。留作者：肉眼验手感（quirk #91/#93）·FOG_DIM/SWEEP_MS defer·manganese_nodule 孤儿化去留（唯一 sink=已删声呐 Lv4 账单）。树：main·合成一笔 commit·push 留 Mac/nightly。

## 1. 一句话状态

完整 meta-loop 跑通：**港口对话 → 海图选点 → 教学线性下潜 / 节点图随机下潜 → 事件 → 战斗 → 上浮 → 减压 → 死亡 → 葬礼 → 尸体回收 → 衰减 → 回港变卖/回购 → 材料 ＋ 金币 修缮升级**。元进度是「材料经济」（基建地图 Phase A·升级走材料＋金币双资源账单·无建设值点数）。**多灯塔基地数据模型 + reveal/reach 已接入海图**（基建地图 Phase B/C）。

**⚠ 内容层现处「随机内容层已拆、待重做」态（2026-07-12 #294·quirk #244）**：随机事件池 + 深度柱/band + mimic + treasure/Sela/whalefall 竖切整套删除。当前活内容＝**教学线性下潜（tutorial）+ ch1 主线脊柱**——4 主线 beat 从深度柱 re-home 成 `chart_pois` 静态 anchor（`poi.dive.*.story`·mentor_logbook.marksPois 揭示·入潜强制开场 → 圆满/留白结局）+ 稀疏 poiId 内容（blue_caves 2 + rocky_slope 2 lore 读 + 4 story beat poiId）。持久洞（迷路图·`mapShape='maze'`）**可进但内容空**（入口机制留·洞内随机池删·待重做 POI-scoped 内容）。开阔海域仍层状 DAG，但随机事件池空 ⇒ 多为 rest 节点。**纵向深度门经济删**（原深度柱 probe 逐级解锁 + 材料 sink 已删·深度门待经济重做）。出海走**港口海图 POI 选点**（anchor 持久 + roaming 刷新·两级门控〔发现 flag / 抵达 upgrade〕·深度偏移/洋流/能见度修正）。月相潮汐影响海况与海图情报（§见 月相潮汐 SPEC）。

类型干净，全套回归门（`npm run regress`）绿。**滚动内容计数 / 最薄档以 `npm run handoff` + `src/data/events|enemies/` 目录为权威。**

---

## 2. 技术栈与运行

```bash
cd ~/Desktop/Blue
npm install
npm run dev        # 启 Vite dev server
npm run typecheck  # tsc --noEmit
npm run build      # 生产构建到 dist/
npm run regress    # 全绿门：typecheck + 全部 playthrough + 数据/边界/文档校验门 + 生产构建
npm run handoff    # 从 git 再生定位（log + status + 最新 nightly REPORT 头 + 本 blockquote + CHANGELOG 尾）
```

迭代跑子集：`node scripts/regress.mjs --only <子串>`（如 `--only typecheck,sonar`）；`--list` 列全部任务；`--skip build` 跳过构建。回归脚本全部种子化（无 flake·quirk #129）。事件 / 战斗 / mapgen 各有专项 runner（`scripts/event-runner.ts` / `combat-runner.ts` + `scenarios/**` 场景库 + dev 面板）——详见 §3。

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
| dive.rest | 休息节点 / 上浮口 / 气穴 / 扎营 | `RestView.tsx` |
| dive.corpse | 尸体回收 | `CorpseView.tsx` |
| combat | 战斗 | `CombatView.tsx` |
| ascent | 三种上浮模式 | `AscentView.tsx` |
| resolution | 上岸结算 | `ResolutionView.tsx` |
| funeral | 死亡结算 | `CorpseView.tsx :: FuneralView` |

### 引擎模块（`src/engine/`·纯逻辑层·`engine ↛ ui` 由 check-boundaries 强制）

barrel + 兄弟文件拆分的子系统（`dive.ts` = barrel·住 `dive-start/-select/-sensors/-move/-stalker/-actions`·公共 API/路径零改·quirk #105）。主要单点：

- `state.ts` — GameState 构造 + 不可变操作 + inventory 工具 + **存档层**（`SAVE_VERSION = 15`；版本不符 / 损坏一律弃旧档从头开始——`migrateSave` 迁移链已删·quirk #99/#173；纯加字段不必 bump·`createNewRun` 种默认 + 反序列化 `?? 兜底`）。
- `chart.ts` / `regions.ts` — 海图 POI 生成/揭示（`poiRevealState`·主线 beat re-home 成静态 anchor·marksPois 揭示）+ 区域揭示配置化。（`columns.ts`/`bands.ts`/深度柱派生已删·#294。）
- `clarity.ts` / `sonar.ts` — 双传感器感知（灯＝诚实近场硬门 / 声呐＝诚实远场侦察）+ 探测暴露（深水区 Phase 0a/0b）。
- `dive-*.ts` — startDive / 海图出海 / 前哨蛙跳 / 节点选择与移动 / 传感器 / 猎手接近 / 气穴换气 / 扎营。
- `mapgen.ts` — 层状 DAG + 迷路图双生成器（`analyzeMap` 结构分析器·dev 面板与回归共用）。
- `combat.ts` / `enemyLibrary.ts` — 战斗状态机 + 敌人库（目录自动加载·`pickEnemy`/`matchEnemies`·`enemyRef` 解析）。
- `ascent.ts` / `nitrogen.ts` — 上浮减压 + 氮气债单写口（quirk #128）。（负伤系统 `injuries.ts`/`modifiers.ts` 整套下线·#290·命中/负伤/闪避改数值化 HP。）
- `upgrades.ts` / `lighthouses.ts` / `port.ts` / `outposts.ts` — 双资源升级（材料+金币）+ 每灯塔设施升级 + Mira 收购/回购 + 前哨。
- `lunar.ts` / `temperature.ts` — 月相潮汐（水面）+ 温度系统。
- `story.ts` / `lore.ts` / `events.ts` / `dialog.ts` — 剧情 flag / lore 账本 / 事件解析与 Outcome / NPC 对话树。
- `eventScenario.ts` / `combatScenario.ts` / `eventGraph.ts` / `eventStats.ts` — 回归框架纯引擎 API（CLI + dev 面板共用）。
- `transitions.ts` / `rng.ts` / `items.ts` / `death.ts` / `equipment.ts` / `materialStats.ts` — 具名 phase 转移（UI 禁 phase 字面量·check-boundaries 规则二）/ 共享 LCG / 物品索引 / 死亡与衰减 / 装备 / 材料统计。

### 数据（`src/data/`）

- 配表：`items.json` / `actions.json` / `zones.json` / `upgrades.json` + `lighthouse_upgrades.json` / `chart_pois.json` + `chart_regions.json` / `caves.json` / `cave_temperature.json` / `lore.json` / `npcs/<id>.json`。（`depth_columns.json`/`depth_bands.json` 已删·#294。）
- 事件 `events/*.json`——**随机内容层拆除后剩 7 文件 24 事件**（#294）：`tutorial`（教学线）/ `ch1`（主线 beat + 结局）/ `reef` / `blue_caves` / `midwater` / `vent` / `wreck_graveyard`（各留 1–3 条 poiId/lore 内容）。随机池 + 深度带 + 鲸落 + mimic 等 12 文件已删·内容待重做。
- 敌人 `enemies/*.json` — **目录自动加载**：改 JSON 后 `npm run gen:enemies` 重生 `registry.generated.ts`（`check-enemy-refs` 四门守 registry 不过期 / 引用完整 / 无孤儿 / 有 baseline）。
- **逐事件 / 逐敌人的内容清单已移出本档**（旧版每条一段·是 STATUS 膨胀主因）——以数据文件本身 + `npm run handoff` 为权威。

### dev 工作台与回归框架

- DEV 面板（**全部收进 `?editor` 工作台**·游戏内 dev 浮层已撤〔旧 `Shift+D/C/M` / `?dev&panel=`·2026-07-09〕）：事件 / 战斗 / 地图 / 经济 / 装备 / 声呐 等，`game ↛ dev` 由 check-boundaries 规则五 + check-dev-panels（App/main 不得挂 dev 面板）强制（dev 不进 prod 包、不揭整张图）。
- 回归框架：`scenarios/{,combat/,mapgen/,lighthouse/}` 场景库 + 对应 playthrough runner；加内容必配 baseline scenario（自动记忆 scenario_framework）。

### 关键数值（占位平衡·未细调·见准则 defer-number-tuning）

- 起始：体力 100、氧气 60 回合、氮气 0
- 检定公式：`successRate = clamp(0.5 + (stat - dc) × 0.015, 5%, 95%)`
- 减压：氮气 < 40 安全 / < 60 一停 / < 80 二停 / ≥ 80 三停
- 节点过渡 turn 数：`1 + Math.floor(depthDelta / 5)`
- 衰减阈值（diveAge）：organic 2 / consumable 5 / material 12 / durable 25 / eternal ∞
- 升级保鲜加成：lv1 +2 / lv2 +5 / lv3 +10；海流冲走：6% per item per run（lv3 免疫）

---

## 4. 关键设计决策

| 决策 | 取值 |
|---|---|
| 地图结构 | 随机节点 + 深度推进（开阔 = 层状 DAG / 洞穴 = 迷路图） |
| 时间粒度 | 回合制，事件可加额外消耗 |
| 死亡模型 | 硬核 Roguelike + 尸体回收 + 材料经济永久积累 |
| 恐惧节奏 | 环境压迫 + 二态「地点缝」死亡门（seam·DORMANT·作者后置放点） |
| 上浮 | 随时可上浮 + 应急上浮必得严重减压病 |
| 装备 | 5 固定槽位 + 装备 + 词缀（MVP 仅等级）|
| 战斗经济 | 双资源直读（体力 + 氧气回合）·无位置维度（武器性格代替） |
| 伤害类型 | 物理单轨 |
| 重生叙事 | **D 设定**：早期不同潜水员 → 中期故障 → 终局揭示一直是同一人（`flag.d_reveal` 冻结·归 St7 capstone） |
| 深度纵轴 | ⚠ 数据驱动深度柱**已删**（#294·随机内容层拆除）——深度门 + probe 解锁经济待随内容/经济重做（原方向：越深越欺骗·灯塔=信息基建·见 deep_game_vision） |

---

## 5. 还没接的功能（开放项）

> 已 ship 的功能进度史在 [docs/archive/CHANGELOG.md](archive/CHANGELOG.md)（按编号·别回堆进本档）；方向性北极星 / SPEC 在 `docs/spec/`（按本 session 方向懒加载·别开局全读）。下面只留**未建**的开放项：

- [ ] **战斗中氮气 ×1.5** —— per 战斗 SPEC §10，未实装。
- 数值/手感统一留最后一次性调（准则 defer-number-tuning）·机制/内容侧不受限。

---

## 6. 已知 quirk 和约定

迁出至 [docs/QUIRKS.md](QUIRKS.md)（编号只增不重排·别处引用「quirk #N」）。基建机制（边界门 / handoff / 并发隔离 / 深度柱 等）见 QUIRKS + CLAUDE.md 顶部约定。

## 7. 仓库结构

```
Blue/
├── CLAUDE.md                         项目约定（顶部约定 + 文档维护 / 起手 / 并发隔离）
├── README.md
├── docs/
│   ├── STATUS.md                     ← 本文件（当前状态·只留当前 + 最近 ~2 session）
│   ├── QUIRKS.md                     append-only quirk / 约定（编号只增）
│   ├── DEV_TOOLS.md                  dev 面板/编辑器说明
│   ├── spec/                         设计 SPEC（按方向懒加载）
│   ├── infra/                        基建提案 / 并发隔离 / 并行 session
│   ├── skills/                       项目内 SKILL 草案
│   └── archive/                      CHANGELOG.md（进度史）+ nightly/（夜间 REPORT·只留最近几份）
├── src/
│   ├── App.tsx, main.tsx, styles.css
│   ├── types/                        TypeScript 类型
│   ├── engine/                       纯逻辑层（§3·engine ↛ ui 强制）
│   ├── ui/                           React 视图（每 phase 一个）+ ui/dev/（仅 DEV·tree-shake）
│   └── data/                         JSON 配表（§3·events/ enemies/ npcs/ + 深度柱等）
├── scripts/                          regress / handoff / 各 playthrough / check-* 门 / runner / psm
└── scenarios/                        回归场景库（事件 / combat/ / mapgen/ / lighthouse/）
```

## 8. 下次接手（轻起手·省上下文）

按 CLAUDE.md「起手约定」：**定位用 `npm run handoff` 从 git 再生**（别手抄「做了什么」）；起手只「定位」（`git log -3` + `git status` + 瞥最新 `docs/archive/nightly/REPORT-*` 确认基线绿），**全量 `npm run regress` 留到 ship 前**，便宜体检用 `npm run regress:quick`（只 typecheck）。SPEC 按本 session 方向懒加载 `docs/spec/` 对应那条（别全读·会撑爆上下文）。写主角 POV 先过叙事定调（剧情 SPEC §2 voice）。
