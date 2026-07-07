# 深海回响 · 当前实装状态

> 当前实装状态见下方各节（§1 一句话状态最权威）。完整会话历史 → [docs/archive/CHANGELOG.md](archive/CHANGELOG.md)；已知 quirk 与约定 → [docs/QUIRKS.md](QUIRKS.md)。**活数字（事件 / 敌人 / 脚本 / scenario 计数）以 `npm run handoff` 的 git 真值为准·本档不再硬抄**（防 STATUS 随内容 churn 漂移）。近期 session（新→旧）：
> **2026-07-07 Puffer 自爆 + 女王吼叫/信息素/产卵/卵实体（Cowork 交互·Opus·#270·接 #269 The Warren·全 additive 不 bump SAVE·沙箱 regress 94/94·新 quirk #232·SPEC §14·未提交待 nightly）**：接 #269 做 §13④ deferred 的 Puffer 自爆 + 作者中途加女王一整套。**Puffer**：`EnemyDef.selfDestruct` + `pufferArmed`（仅 adult 态武装）+ `detonateSelfDestruct`（不 guard hp≤0＝近战打死也炸）+ `maybePufferMeleeDetonate`（抽出 combat.ts melee 触发·守 file-budget 1170）；三触发＝近战当场引爆·溅玩家 / 远程击破豁免不溅 / 到点其敌方回合自爆（先于无攻击表 passive 守栏 #231）；`enemy.warren_puffer`（larva→茧→adult 活炸弹）+ 3 baseline（判据 `sanity` delta）。**女王**（仍无攻击表·`runEnemyTurn` 起手·`maybeWarrenPheromone` **先于** `maybeWarrenReinforce`＝留凿破卵窗）：`warrenPheromones` 吼叫按条件优先级择一（②引爆 armed Puffer / ③催孵茧卵 / ①larva 掷 cocoonBoostChance ↑结茧率）+ `warrenReinforce` 低单位产卵（cap=baseCap+`warrenHunt.roomsCleared`×capPerRelocate·每次 relocate 递增·派生不入档 #99）+ `enemy.warren_egg`（passive cocoon·不打掉就孵化成敌人）+ `metamorphosis.breakDestroys`（打掉即毁不复活）+ 2 baseline。**门修**：`check-enemy-refs` 加传递闭包覆盖动态产出 defId（quirk #232）·`combat.ts` 抽函数守 file-budget。数值/文案全占位（roarChance 1 每回合过强待作者调）。**仍 deferred**：蜂巢 mapgen 覆写+密度派生+封口墙独立 party（架构敏感·有未建依赖多口持久洞 + encounter→node 绑定缺失·**留专门 session**）/撤退月相存档窗（`warrenHunt.lastVisitDay` 接 lunar.ts `moonPhasesElapsed`）/数值 tuning（Mac live）。full regress **94/94 全绿**（5 warren baseline·build 留 nightly）。树：main·未提交〔6 code + 5 scenario + SPEC §14 + 三件套〕·push 留 nightly·ahead 累积待推（#249–#270）·定时任务全停。
> **2026-07-06 The Warren（蜂群 boss）Phase 1 core spine 实装：map-level hybrid 追猎 + `warren.json` + 3 baseline（Cowork 交互·Opus·#269·新 quirk #231·沙箱 regress 94/94·未提交待 nightly）**：按 impl prompt 起手即纠翻其前提——茧化机制 + 女王整套 kit（`metamorphosis`/`corpseEating`/`droneReplenish`/`shieldedBy`/`maternalBehavior`/`phases`/`environmentalPressure`）**早随 `mycelial_fish`/`cocooned_resident` ship·非待实装/非共建**（SPEC §9.8 / impl §4 stale 已纠）→ Phase 1 收敛到空间层。**架构（作者拍板 map-level hybrid）**：每间巢室＝dive 节点·女王每间满血·非死角打进暴露阈值→巢撤走（房间清空·声呐找下一间）·唯 the Hatchery 禁撤＝可致死＝取胜→崩解；进度住 `RunState.warrenHunt`。**落地（全 additive·不 bump SAVE·守 boundaries）**：新字段 `EnemyDef.swarmRelocate` / `CombatState.warrenRoom`+`pendingSwarmRelocate` / `RunState.warrenHunt` + 引擎 `maybeSwarmQueenRelocate`（暴露阈值·**先于**胜负判定＝`finalizeSwarmRelocate` 房间清空无战利品）/ `maybeSwarmCollapse`（仅死角·女王死→残余崩解）/ `runEnemyTurn` 无攻击表 passive 守栏（女王 `attacks:[]`·全库通用·quirk #231）+ `warren.json`（女王/Spawn/Warden→Berserker/Guard + 5 遭遇）+ 3 baseline（room1/room2 relocate·hatchery_solo kill+collapse·实跑抄）。Deferred：Puffer 自爆(E4)/封口墙独立 party/蜂巢 mapgen+密度派生/月相存档窗/数值 tuning（全记 SPEC §13）。full regress **94/94 全绿**（build 留 nightly）·新 quirk #231。树：main·单提交〔6 code + warren.json + 3 scenario + SPEC + impl prompt + 三件套〕·push 留 nightly·ahead（#249–#269）·定时任务全停。
> **2026-07-06 古文明 SPEC §2 续补＝算力轴的政治经济学（Cowork 交互·Opus·#268·#266 SPEC 续补·纯设计文档零代码·不 bump SAVE）**：作者就中心化 vs 去中心化算力轴展开讨论→补进 §2（母题块后新节·纯加法·既有表/三层读法/母题零改）。**初衷→结局对偶**：去中心化 初衷=人人平等→结局=垄断（规模/网络效应聚顶·比特币/tyranny of structurelessness）·中心化 起手=像垄断→结局=共同富裕（算力像空气）。**三点收口·守「不选边」**：〔精度〕垄断→富裕只在寡头竞争/可问责池成立·真变量=可竞争性（两极端都塌·寡头中段才稳）；〔第三道反转·扣北极星〕共同富裕本身=笼子（认知外包→依赖深渊算力池→「过高等不能上浮」·实例化 §5a·「礼物就是毒」·与母题正交）；〔价格→0 合流〕寡头压价→边际成本趋零→「市场买」与「按需拿」不可区分＝资本路共产路同一终点。**接 §6**（分配失败者→劣质基底硬跨→半成品·经济来路）+ **载体纪律**（资本/共产/共同富裕只作人类标签·头足类不直接用）。守既锁 canon：尸衣者多成因/揭示锁三章不变。**收尾附带修既存 flake**：`playthrough-sensors.ts` 缺 `Math.random` 种子（#261 加幻觉 combat 时漏·违 #129）→ §14a 并发偶失（收尾实测 92/93↔93/93·pre-existing·与 doc 无关）→ 照 playthrough.ts 补种子（makeLcg·seed 20260622）。验证：doc 静态门 42/42 + full regress **93/93 全绿 ×3 连跑**（--only sensors 10/10·build 留 nightly）·无新 quirk。树：main·单提交〔SPEC + playthrough-sensors + 三件套〕·push 留 nightly·ahead（#249–#268）·定时任务全停。
## 1. 一句话状态

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

- `state.ts` — GameState 构造 + 不可变操作 + inventory 工具 + **存档层**（`SAVE_VERSION = 13`；版本不符 / 损坏一律弃旧档从头开始——`migrateSave` 迁移链已删·quirk #99/#173；纯加字段不必 bump·`createNewRun` 种默认 + 反序列化 `?? 兜底`）。
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
