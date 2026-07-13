# 深海回响 · 当前实装状态

> 当前实装状态见下方各节（§1 一句话状态最权威）。完整会话历史 → [docs/archive/CHANGELOG.md](archive/CHANGELOG.md)；已知 quirk 与约定 → [docs/QUIRKS.md](QUIRKS.md)。**活数字（事件 / 敌人 / 脚本 / scenario 计数）以 `npm run handoff` 的 git 真值为准·本档不再硬抄**（防 STATUS 随内容 churn 漂移）。近期 session（新→旧）：
> **2026-07-13 #303 regionId 大区门 lane 收尾——`ChartRegionId` 收口 + `ZoneDef.regionId` + 调试器按大区分组 + `check-zone-region` 数据门（Cowork 交互·Opus·code-only commit `4dbcd04` + docs·`regress:quick` 2/2 绿〔全量 83/83 见 #302 同树〕·push 留 Mac/nightly）**：#300 白板时按作者「不碰」排除、晾在共享工作树的 regionId lane 单独理成干净 commit（与开阔水域 Phase 1+2 零文件重叠）。`types/dive.ts` 加 `ChartRegionId`（5 大区字面量·单一来源）+ `ZoneDef.regionId?`（纯 UI 分组标注）·`types/chart.ts` 收窄 `ChartRegionDef.id`·`MapDevPanel.tsx` 左栏按 regionId 分 5 大区 + 「未分区」兜底桶·新 `check-zone-region.mjs` 数据门（已填 regionId ∈ `chart_regions.json` 集合·`regress.mjs` 注册）。**白板态无 zone 填 regionId ⇒ 门 trivial 绿·debugger 全落「未分区」桶**（接口就位·数据待填·非 bug）。树：main·`4dbcd04`·ahead 37·开阔水域 Phase 1+2 仍未提交待 Mac。
> **2026-07-13 #302 开阔水域声呐渲染+mapgen 架构定案(SPEC)+Phase 1 抽 `shadeSonarSdf`·洞穴 byte-identical（Cowork 交互·Opus 设计+look-dev+subagent·未提交待 Mac 全量 regress+commit·新 quirk #252·新 SPEC `深海回响_开阔水域`）**：延续 #300 白板待办#1「开放水域内容」的渲染+mapgen 底座。逐轮 look-dev 拍定：开阔水域 SDF＝**边缘型海床 floor**(到 contour 有符号距离·单值不悬空·`caveSdf` 兄弟)**∪结构层**(珊瑚递归分枝/岩不规则球+拱·`d=max(floor,struct)`)·喂**同一** `shadeSonarSdf`(防飘根)·图底反洞穴(水为背景·只海床下/侧壁后黑·深色版岩透明暗芯+青边·细珊瑚枝=实心青线)·三档 `zoneTag` 选形态+事件池·换皮拓扑(层状DAG)·`beginAscent` 捕食者·连洞穴 portal(future)。**Phase 1 落工作树·未提交**：`shadeSonarSdf` 抽进 `engine/sonarGeometry.ts`·`bakeCaveRGBA` 改调·沙箱验洞穴 **0 字节差**+typecheck 绿·改 2 文件(删无用 WALL_HI import)。**开阔水域几何旋钮独立·调形状不动洞穴**(quirk #252)。**Phase 2 同日续·实装**：`openWaterSdf`/`bakeOpenWaterRGBA`/`buildOpenWaterGeometry`（边缘 floor∪结构层·独立几何旋钮）+ 3 档 `zoneTag`(沙/珊瑚/岩) + 3 dev QA zone + 3 scene(`?dev&scene=openwater_*`·`revealAllAtDeepest` 框海床) 填 `SonarScanPanel::isOpenWater` 空占位·形态照 SPEC §5(沙纯波/珊瑚软扇密丛/岩圆钝丘+抛物圆顶拱)。check-file-budget 拆出新 `ui/openWaterRender.ts`(仍 ui 层) + `distSeg/fbm/hash2/vnoise` 迁 `engine/sonar` 单一来源·洞穴 **byte-identical**(sha 不变)·**`npm run regress` 沙箱 83/83 全绿**(prod build 留 Mac)。Phase 3(`mapShape:'openwater'` 拓扑+contour 节点派生+zoneTag)/4(QA zone+截图 baseline)+数值手感留下 session/进引擎调。
> **2026-07-12 #300 开阔海域 + tutorial/ch1 主线 + 全部洞穴内容 ＝ 彻底白板（Cowork 交互·两条并发 session 合并·Opus 收尾·`npm run regress` 沙箱 83/83·prod build 留 Mac/nightly·未提交待作者/nightly）**：作者拍板把已写叙事/探索内容清成白板。删 4 条开阔海域 zone（`east_reef`/`old_lighthouse_reef`/`open_midwater`/`wreck_graveyard`）+ 27 条洞穴 zone + `the_deep_gate` + 6 个主线/生态事件文件 + 全部 story 潜点/开阔 anchor/roaming + 5 个 story 道具 + 48 条 lore；`zones.json` 仅剩 `zone.warren` + 3 条 maze QA 夹具（horizontal/vertical/serpentine_test），`EVENT_DB` 指向新 `qa_fixture.json`。**留**：引擎 + 17 敌人 + `story.ts` flag 词汇（作者重写主线的休眠脚手架）。**当前全部下潜内容零可达点**——`poi.anchor.warren` 卡在从未置位的 `flag.warren_discovered`（QUIRKS #250·**有意状态·别当 bug 单独修**）。收口机制：`createInitialProfile` 种 `flag.tutorial_complete`（补偿已删教学 producer·单点可逆）·`SAVE_VERSION` 15→16·`economy-dag` reveal 检查 no-op·10 份被删内容 SPEC `mv` 进 `_to_delete/`。主线与开放水域由作者未来重写。**并行 regionId 大区门 lane 按作者「不碰」排除在本次提交外**。记录＝CHANGELOG #300（洞穴清空）+ 同日续（开阔海域+主线）·QUIRKS #250/#251。
> **2026-07-12 #299 剧情编辑器 StoryEditor 整体删除（Cowork 交互·Sonnet·代码+文档·新 quirk #249·commit 待收尾）**：作者要求删掉只读走查（Phase 2 一直没等到 Phase 3 节点编辑）。删 `src/ui/StoryEditor.tsx` + 专属冒烟测试；清 `EditorApp.tsx` tab/nav/路由/`?storyeditor` 旧书签、`check-boundaries` 规则五白名单、`regress.mjs`、DEV_TOOLS.md、dev工作台 SPEC。**引擎侧不动**（`eventSatisfy`/`eventGraph`/`eventScenario`/`poiEvents` 仍被 playthrough/其它 smoke 独立消费）。**⚠ 本次是范围受限的部分收尾**：工作树里混着另一路未提交的大改（`zones.json`/`chart_pois.json`/`src/data/events/*.json` 等约 50 文件·像是观测站/Ch1 重构或内容清空的在飞工作），按沙箱共享工作树约定（quirk #245 同类先例）**只 `git add` 本次 StoryEditor 相关的精确文件**，其余一概未碰、留给它自己的 session 收尾——故本次全量 `npm run regress` 未达「全绿」（78/83·5 个失败全部指向那批他线改动，如 `check-gate-skeleton`/`playthrough-mapgen-scenarios` 报 `zone.wreck_graveyard` 不在 `zones.json`），但 StoryEditor 改动自身的子集（typecheck/check-boundaries/check-doc-links/check-quirk-refs/check-status-fresh/check-dev-panels/check-append-only-docs/smoke-map-editor/smoke-poi-events）全绿。

## 1. 一句话状态

完整 meta-loop 跑通：**港口对话 → 海图选点 → 教学线性下潜 / 节点图随机下潜 → 事件 → 战斗 → 上浮 → 减压 → 死亡 → 葬礼 → 尸体回收 → 衰减 → 回港变卖/回购 → 材料 ＋ 金币 修缮升级**。元进度是「材料经济」（基建地图 Phase A·升级走材料＋金币双资源账单·无建设值点数）。**多灯塔基地数据模型 + reveal/reach 已接入海图**（基建地图 Phase B/C）。

**⚠ 内容层现处「随机内容层已拆、待重做」态（2026-07-12 #294·quirk #244）**：随机事件池 + 深度柱/band + mimic + treasure/Sela/whalefall 竖切整套删除。当前活内容＝**教学线性下潜（tutorial）+ ch1 主线脊柱**——4 主线 beat 从深度柱 re-home 成 `chart_pois` 静态 anchor（`poi.dive.*.story`·mentor_logbook.marksPois 揭示·入潜强制开场 → 圆满/留白结局）+ 稀疏 poiId 内容（blue_caves 2 + wreck_graveyard 2 lore 读 + 4 story beat poiId）。持久洞（迷路图·`mapShape='maze'`）**可进但内容空**（入口机制留·洞内随机池删·待重做 POI-scoped 内容）。开阔海域仍层状 DAG，但随机事件池空 ⇒ 多为 rest 节点。**纵向深度门经济删**（原深度柱 probe 逐级解锁 + 材料 sink 已删·深度门待经济重做）。出海走**港口海图 POI 选点**（anchor 持久 + roaming 刷新·两级门控〔发现 flag / 抵达 upgrade〕·深度偏移/洋流/能见度修正）。月相潮汐影响海况与海图情报（§见 月相潮汐 SPEC）。

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
