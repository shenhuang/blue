# 深海回响 · 当前实装状态

> 当前实装状态见下方各节（§1 一句话状态最权威）。完整会话历史 → [docs/archive/CHANGELOG.md](archive/CHANGELOG.md)；已知 quirk 与约定 → [docs/QUIRKS.md](QUIRKS.md)。**活数字（事件 / 敌人 / 脚本 / scenario 计数）以 `npm run handoff` 的 git 真值为准·本档不再硬抄**（防 STATUS 随内容 churn 漂移）。近期 session（新→旧）：
> **2026-07-04 感知系统重做：北极星换轴——灯/声呐/深度不再欺骗、欺骗只剩单一「低理智」轴（→选项+怪物）·车道 2–6 全实装（Cowork·Opus/high 拆引擎 + Sonnet/medium 内容·#259·SPEC `docs/spec/深海回响_感知重做_SPEC.md`）**：旧「越深越欺骗」机制成本高、实测不好玩（声呐从不进决定·欺骗只是可忽略预览文字）→ 换新北极星「三件感知各司其职且诚实·欺骗收敛成一根低 san 轴·san 回满即消」。**车道 2（拆引擎 ~−480 行）**：删整套声呐欺骗（`sonarReturn`/`spoofsSonar`/`evadesSonar`/`nodeSonarView`/`sonarPhantoms`/`applySonarDeception`/`sonarDeception`/`effectiveFalseEchoSanity` + `lampPreview` 低 san 分支）·`clarityForNode` 三档塌成**二态灯门** `clarity.ts::lampGateLocked`（**反转**：黑=灯的用武之地·门判据「灯开+有电」·旧 `lampEffective` 已删·quirk #220）·`NodeChoice.locked` 新增·新门 `check-no-sonar-deception` 入 regress（#219）。**车道 3a**：`NodeSelectView` 把 `locked` 渲染成可见但 disabled +「需要灯」+ `.lock-tag`（黑=整潜级·#221）。**车道 4**：删声呐双回合状态机→单发「扫一记」ping·`sonarScanRange` 驱动 BFS 视觉前瞻（与猎手听觉统一·#222）·杀空转升级·Lv.3 重指 `sonarScanRangeBonus`。**车道 5-1**：低 san 幻觉怪（§7① 形态 a）`maybeHallucinationEncounter`·软化结算·**幻觉战封死全部死亡窗=无脚本死**（#223）。**车道 5-2**：`revealAttribution`「靠 X」揭示提示·零逐项写（#224）。**车道 6**：`trench.json`/`midwater.json`/`lore.json` 声呐骗人内容改写成「诚实回波 + 你自己低 san 硬读」·冻结 corpse-wearer 伏笔；**更正：`abyssal`/`hadal`/`subhadal.json` 不存在**（早被深度柱取代·别再追·#225）。B（mimic/apex）冻结。四份旧 SPEC 加 tombstone 指本 SPEC（深水区欺骗侧/声呐与房间 S2/声呐渲染 §4/剧情 §3.7 双轴→单轴）·诚实侧全保留。**验证**：full regress **92/92 全绿**（含 check-no-sonar-deception 新门）。**待作者过 4 点**（氧气幻觉中是否致命/`mimic.json _doc` 改一行/黑=整潜级/`the_leftover_echo` 冻结是否该改·SPEC §7/§10）·数值占位待统一调。**树**：main·车道 2–6 + 三件套未提交（待作者 Mac 复核 + vite build + commit）·定时任务全停。
> **2026-07-04 Théo 研究课题重定分析（Cowork 交互·Opus·#258·无代码/非 canon）**：作者问「Théo 深海压力测算论文太平庸，改成深海力场和生命起源？」。**未动 canon**（作者「先不急着改」），产出讨论稿 `docs/spec/深海回响_Théo研究课题_分析讨论稿.md`。核心：反对直接替换——「深海压力」是承重墙、三点咬死〔论文(压力)↔氮醉死法(误读压力)↔引出「人类极限≈300m→催生科技/生物两派」〕；「生命起源」＝生物派领地+非物理海洋学（仅可作动机层引文）；「深海力场」含义未定（物理场 vs 后期灵界线·后者撞一章不交底纪律）列开放问题；纠事实：破格教授是 Voss 非 Théo(24 博士生)。候选＝A/B/C 三版课题均保压力内核 + 主线(B 深度极限理论边界)+卫星(A/C)回应「博士不止一篇论文」。附深海物理专业背景（300m 三道生理墙/氮醉为何是死法科学原型/热液喷口生命起源假说）。§7 四个开放问题待作者拍。无新 quirk。**验证**：沙箱静态门 `--only check` 40/40 绿（含 terminology/doc-links/status-fresh/append-only/boundaries/typecheck）·tsx 行为测本 session 零代码改动不受影响留 Mac/nightly。**树**：main·仅新增 1 讨论稿+三件套·只 add 自己文件未碰作者 treasure/trade WIP·ahead 待推。
> **2026-07-04 UI 截图 harness：`?dev&scene=<id>` 注入真实 state 一键开任意画面 + Playwright 手机/PC 保真截图 + 沙箱自产图 + 视觉基线 diff（Cowork 交互·Opus·#257）**：作者要「让 Claude 随时开真实 UI 截图、手机 PC 都有、不必玩到那画面」协助测 UI。注入只造 state、画面由真实 `App` 渲染＝逐像素保真（`App` 加 `initialState`/`ephemeral` 两 prop·预览不落盘不覆盖存档；`main.tsx` 的 `?dev&scene=` 懒 chunk 装配·不进游戏主包）。`src/ui/dev/scenes/registry.ts` 10 场景全用真实引擎入口造 state（`toChart`/`buildScenarioState`/`buildCombatEntryState`/`executeDeath` 等·非 phase 字面量·含随机的 `withSeededRandom` 定死）。驱动 `scripts/shoot{,-serve,-sandbox,-diff}.mjs`：手机保真靠 Playwright `isMobile` 触发真 `≤480` 断点（窗口 resize 做不到）；沙箱自产图（Linux esbuild/rolldown + headless-shell·版本全自派生）；视觉基线 diff（pixelmatch·`--bless`/`--check`·基线按环境本地不入库·字体渲染跨平台微差）。10 场景全渲染忠实·同环境重截 0px·反向改文案报变更；typecheck+边界绿·沙箱全量 `npm run regress` **90/90 全绿**（Linux 工具链·非 SUBSET·含 build）·不 bump SAVE·新 quirk #218。**树**：main·harness 文件+三件套单次提交·未碰作者并行 WIP（treasure/trade 内容）·ahead 待推。## 1. 一句话状态

完整 meta-loop 跑通：**港口对话 → 海图选点 → 教学线性下潜 / 节点图随机下潜 → 事件 → 战斗 → 上浮 → 减压 → 死亡 → 葬礼 → 尸体回收 → 衰减 → 回港变卖/回购 → 材料 ＋ 金币 修缮升级**。元进度是「材料经济」（基建地图 Phase A·升级走材料＋金币双资源账单·无建设值点数）。**多灯塔基地数据模型 + reveal/reach 已接入海图**（基建地图 Phase B/C）。

内容层多个 random zone（旧灯塔礁 reef · 蓝洞群 cave/maze · 沉船墓园 wreck · 中层/热液/海沟/鲸落 等深度柱 zone）。洞穴 zone 走**迷路图**（双向连通图·环/死路/多最深点·`ZoneDef.mapShape='maze'`），开阔海域走层状 DAG。纵向深度由**数据驱动「深度柱」**（`depth_columns.json` → `engine/columns.ts` 派生 band/probe/POI；新灯塔只加一条 column·见 `docs/spec/深海回响_探深深度柱_SPEC.md` + quirk #130/#131）。出海走**港口海图 POI 选点**（anchor 持久 + roaming 刷新·两级门控〔发现 flag / 抵达 upgrade〕·深度偏移/洋流/能见度修正）。月相潮汐影响海况与海图情报（§见 月相潮汐 SPEC）。

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

- `state.ts` — GameState 构造 + 不可变操作 + inventory 工具 + **存档层**（`SAVE_VERSION = 12`；版本不符 / 损坏一律弃旧档从头开始——`migrateSave` 迁移链已删·quirk #99/#173；纯加字段不必 bump·`createNewRun` 种默认 + 反序列化 `?? 兜底`）。
- `chart.ts` / `columns.ts` / `bands.ts` / `regions.ts` — 海图 POI + 数据驱动深度柱派生（band/probe/POI）+ 区域揭示配置化。
- `clarity.ts` / `sonar.ts` — 双传感器感知（灯近距真相 / 声呐远距不可信表象·可被 spoof / 低 san 幻觉）+ 探测暴露（深水区 Phase 0a/0b）。
- `dive-*.ts` — startDive / 海图出海 / 前哨蛙跳 / 节点选择与移动 / 传感器 / 猎手接近 / 气穴换气 / 扎营。
- `mapgen.ts` — 层状 DAG + 迷路图双生成器（`analyzeMap` 结构分析器·dev 面板与回归共用）。
- `combat.ts` / `enemyLibrary.ts` — 战斗状态机 + 敌人库（目录自动加载·`pickEnemy`/`matchEnemies`·`enemyRef` 解析）。
- `ascent.ts` / `nitrogen.ts` / `injuries.ts` / `modifiers.ts` — 上浮减压 + 氮气债单写口（quirk #128）+ 负伤双单点（写 `injuries.ts` / 读 `modifiers.ts`·quirk #116·均 check-boundaries 强制）。
- `upgrades.ts` / `lighthouses.ts` / `port.ts` / `outposts.ts` — 双资源升级（材料+金币）+ 每灯塔设施升级 + Mira 收购/回购 + 前哨。
- `lunar.ts` / `temperature.ts` — 月相潮汐（水面）+ 温度系统。
- `story.ts` / `lore.ts` / `events.ts` / `dialog.ts` — 剧情 flag / lore 账本 / 事件解析与 Outcome / NPC 对话树。
- `eventScenario.ts` / `combatScenario.ts` / `eventGraph.ts` / `eventStats.ts` — 回归框架纯引擎 API（CLI + dev 面板共用）。
- `transitions.ts` / `rng.ts` / `items.ts` / `death.ts` / `equipment.ts` / `materialStats.ts` — 具名 phase 转移（UI 禁 phase 字面量·check-boundaries 规则二）/ 共享 LCG / 物品索引 / 死亡与衰减 / 装备 / 材料统计。

### 数据（`src/data/`）

- 配表：`items.json` / `actions.json` / `zones.json` / `upgrades.json` + `lighthouse_upgrades.json` / `chart_pois.json` + `chart_regions.json` / `depth_columns.json`（深度柱单一源·派生深度分层）+ `depth_bands.json`（派生）/ `injuries.json` / `cave_temperature.json` / `lore.json` / `npcs/<id>.json`。
- 事件 `events/*.json`（tutorial / reef / blue_caves / wreck_graveyard / ch1 + 中层·热液·海沟·鲸落·洞穴等深度柱内容 + mimic / corpse_wearer 伏笔）。
- 敌人 `enemies/*.json` — **目录自动加载**：改 JSON 后 `npm run gen:enemies` 重生 `registry.generated.ts`（`check-enemy-refs` 四门守 registry 不过期 / 引用完整 / 无孤儿 / 有 baseline）。
- **逐事件 / 逐敌人的内容清单已移出本档**（旧版每条一段·是 STATUS 膨胀主因）——以数据文件本身 + `npm run handoff` 为权威。

### dev 工作台与回归框架

- DEV 面板（`?editor` 工作台 + 游戏内 `Shift+D/C/M` 互斥）：事件 / 战斗 / 地图 / 经济 / 装备 / 声呐 等，`game ↛ dev` 由 check-boundaries 规则五强制（dev 不进 prod 包、不揭整张图）。
- 回归框架：`scenarios/{,combat/,mapgen/,lighthouse/}` 场景库 + 对应 playthrough runner；加内容必配 baseline scenario（自动记忆 scenario_framework）。

### 关键数值（占位平衡·未细调·见准则 defer-number-tuning）

- 起始：体力 100、氧气 60 回合、理智 100、氮气 0
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
| 恐惧节奏 | 理智值驱动 + 深度加速衰减 |
| 上浮 | 随时可上浮 + 应急上浮必得严重减压病 |
| 装备 | 5 固定槽位 + 装备 + 词缀（MVP 仅等级）|
| 战斗经济 | 双资源直读（体力 + 氧气回合）·无位置维度（武器性格代替） |
| 伤害类型 | 双轨（物理 + 理智） |
| 重生叙事 | **D 设定**：早期不同潜水员 → 中期故障 → 终局揭示一直是同一人（`flag.d_reveal` 冻结·归 St7 capstone） |
| 深度纵轴 | 数据驱动深度柱（越深越欺骗·灯塔=信息基建·见 deep_game_vision / 探深深度柱 SPEC） |

---

## 5. 还没接的功能（开放项）

> 已 ship 的功能进度史在 [docs/archive/CHANGELOG.md](archive/CHANGELOG.md)（按编号·别回堆进本档）；方向性北极星 / SPEC 在 `docs/spec/`（按本 session 方向懒加载·别开局全读）。下面只留**未建**的开放项：

- [ ] **尸体衰减时的 UI 提示** —— 回港若有尸体衰减/被冲走给 toast，制造紧迫感。
- [ ] **亡者之径事件** —— 同 zone ≥ 5 具尸体时强制生成 `cave.choir` 节点。
- [ ] **失能（Incapacitated）状态** —— 体力 0 不直接死，给「最后挣扎」窗口。
- [ ] **战斗中氮气 ×1.5 / 理智 ×1.2** —— per 战斗 SPEC §10，未实装。
- [ ] **背包负重影响上浮速度** —— per 主 SPEC §8.2，未实装。
- 数值/手感统一留最后一次性调（准则 defer-number-tuning）·机制/内容侧不受限。

---

## 6. 已知 quirk 和约定

迁出至 [docs/QUIRKS.md](QUIRKS.md)（编号只增不重排·别处引用「quirk #N」）。基建机制（边界门 / handoff / 并发隔离 / 深度柱 / 负伤单点 等）见 QUIRKS + CLAUDE.md 顶部约定。

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
