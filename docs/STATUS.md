# 深海回响 · 当前实装状态

> 当前实装状态见下方各节（§1 一句话状态最权威）。完整会话历史 → [docs/archive/CHANGELOG.md](archive/CHANGELOG.md)；已知 quirk 与约定 → [docs/QUIRKS.md](QUIRKS.md)。**活数字（事件 / 敌人 / 脚本 / scenario 计数）以 `npm run handoff` 的 git 真值为准·本档不再硬抄**（防 STATUS 随内容 churn 漂移）。近期 session（新→旧）：
> **2026-07-08 The Warren 三卵室重设计：三角 mapgen + 死角状态化 + 密度热度（Cowork 交互·Opus·#275·同日续·全 additive·不 bump SAVE·full regress 96/96·新 quirk #238/#239·未提交待 nightly）**：做 §8/§9 三条 deferred，起手核实推翻 SPEC 两处前提（多口持久洞**根本没建**〔仍是草案 v1〕；遭遇绑 zone 不绑 node ⇒ encounter→node 绑定缺失），作者拍板**解耦**新建轻量蜂巢 mapShape。作者两次推翻我的线性脊柱方案（①气穴均匀骰堆洞口，违背 maze「整图≤1 且偏深」约定 + 拆了 §7 氧气主压力轴；②线性撤退让 §13②「回图用声呐找下一间」成空操作）→ **三卵室三角**：三间都是 hatchery，她随机起于其一、被打退随机换一间、第三间背水一战 ⇒ **死角是状态不是地点**。搜寻＝密度热度 + 封口墙（声呐听得见「大团活物」但无分辨率 ⇒ 射程升满不消解三选一）；撤退**随机**（三角两两等距 + 她逃走时你正站她那间 ⇒「最远」双双退化·quirk #239）；耗氧**不**耦合热度（作者否决·氧气来自气瓶·且已重复计数）。**正确性重接**（quirk #238）：静态 `warrenRoom.isHatchery` 在三卵室下全局为真会塌掉 §4，改读 `warrenLastStand`（`roomsCleared>=2`·`startCombat` 派生），三处门控（禁撤/崩解取胜/储备零恢复#234）语义不变；fixture 用新 `StartCombatOptions.warrenLastStand` 构造背水一战而**不拨 roomsCleared**（拨了会抬高产卵上限逼全体 re-bless）⇒ **47/47 combat baseline 零重录通过**＝行为等价硬证据。新文件 `mapgen-warren.ts`（三角生成器）/ `graph.ts::hopField`（通用无向 BFS 跳数场·传播 dist·热度只是其纯函数）/ `warren-hunt.ts`（密度查表〔**表长即作用半径**⇒「入口无敌人」是定理〕·`warrenChambers` 从地图读 `kind==='boss'`·`ensureQueenPlaced`/`advanceQueenRelocation`）；新 `DiveNode.combatEncounterId`；`ZoneDef.mapShape` 加 `'warren'`；`finalizeSwarmRelocate` 外移进 `combat-warren.ts`（守 file-budget·combat.ts 1173→1149）。新门 `playthrough-warren-mapgen`（200 seed 洞型不变量 + hopField 对朴素 BFS + 追猎态 + 密度·等距被改就红）。**遗留**：`dive-move` 到达路由消费 `combatEncounterId`（墙/空卵室/女王阶段三选一）、封口墙 party 内容 + 打穿置 `wallDown`、每间卵室存卵数（提前凿卵削她未来库存）、`ensureQueenPlaced` 接 dive-start、密度接遭遇构造、占位 zone+POI、**SPEC canon 改写**（§4/§8/§9「最深唯一死角」作废·§7「越近核心水越稠」失载体）。树：main·未提交待 nightly。
> **2026-07-08 boss 名册收窄到四分支 capstone + 噙卵深鱼非寄生纠错（Cowork 交互·Opus·#274·纯数据/canon·零行为·不 bump SAVE·full regress 95/95·新 quirk #236/#237）**：作者定 **ch1 只 4 个 boss**，各对应科考队两派衍生的四大意识形态分支——生物派·**社群主义**（原「蜂巢派」正式改名·＝The Warren·**唯一已建成**）/ 生物派·**进化主义** / 科技派·**中心主义** / 科技派·**分布主义**（未建·「4 个」是当前计划非硬上限）。**作者明确不要硬机制**（否决 boss manifest + regress 门）→ 约定落 QUIRKS·别再提那个门。代码＝纯 bestiary 标签零行为：`mycelial_queen` boss→miniboss、`chain_eel_head` predator→miniboss（体节仍 predator·其 codex 明说「单独一节不构成威胁」）⇒ **全仓 `role:'boss'` 仅剩 `enemy.warren_queen`**。查实 **`EnemyRole` 无机制挂靠**：boss 行为全由 `phases`/`environmentalPressure`/`warren*`/`headEnrage`/`maternalBehavior` 独立字段驱动·engine 无一处读 `def.role`；role 唯二消费点＝`BestiaryView::ROLE_LABEL` ＋ 无调用者的 `pickEnemy(opts.role)`；`dive-move` 的 `case 'boss'` 是**地图节点 kind** 非敌人 role；`check-enemy-refs`(c2) 对无 phases 者直接 `continue` ⇒ 降级零风险 → quirk #236。**canon 纠错**：一度把噙卵深鱼读成「髓织虫鱼版/Gravid Queen 前传」并据此提议改 §16——查证推翻：`噙卵深鱼` 在 `docs/` **零命中**，§16.1 讲的是**泛指**「产卵期母鱼」；该敌 `_comment` 自述「**口孵护巢·mouthbrooder**」+ `maternalBehavior`（含**自己亲生的**幼鱼当盾）+ 零寄生 lore（#272 早写明「女王本就无 maternalBehavior·那是 mycelial_fish 的」）⇒ **§16 无需改·改了反破坏 The Warren #271/#273 起源**·作者原选「改 §16」经查证**撤回** → quirk #237。遗留：`mycelial_*` id 误名（暗示菌丝/寄生）＝可选 rename（作者暂缓·Sonnet 中 effort）；链鳗作者「之后 session 重做·先不碰」。full regress **95/95 全绿**（沙箱 esbuild-full·prod build 缺 rollup-linux-arm64 自动跳过·#147·nightly 处理）。⚠ 树内有**非本 session** 未提交 WIP（`mapgen.ts`/`dive.ts`/`mapgen-warren.ts`/`_warren_preview.ts`·疑蜂巢 mapgen 在飞）·本次显式只 add 自己的文件。树：main·本地 commit 待 nightly（#249–#274）·定时任务全停。
> **2026-07-07 髓织虫全生物学 + 祭祀文明设定落档（Cowork 交互·Opus·#273·同日续·纯 canon 零代码·不 bump SAVE·full regress 95/95·新 quirk #235）**：作者补设定（**只做 canon·Ch2 gameplay 不写**）。**新档 `docs/spec/深海回响_祭祀文明_SPEC.md`**（前/后祭祀文明史·髓织虫邪教膜拜古文明 §2 蜂群分支·仪式献祭女人/<100% 接纳/三分入选落选出逃·成功即诅咒·美化版→真相双本·护栏·Ch2 待写 note·code-id scheme）。**§16 重写**（蜂群boss）：全生活史+真社会性（女王首感染/工蜂后代/雄性播种·信息素统领多虫无中枢=无智·母鱼→Gravid Queen 前传·宿主死活无法定义）·who's-who 改 **A 鱼原生 / B 人祸派生**（弃旧 A 专寄生人/B 专寄生鱼互不感染）·B 生物设定（吃人/假呼救诱人/省能拟尸解释尸体不腐/被吃剩仍动/海绵脑）·护栏重写·code-id `horror_sapien_*`。**古文明 SPEC** §2/§6 交叉引用（蜂群分支被神化·水鬼 B 新来路·虫非古文明造）；**剧情 SPEC** §3.7「美化版→真相」命名机制 + §4.2 深层指针（既有 beats 不改）。memory 纠 stale（旧 A/B→新模型·仓外）。遗留＝Ch2 gameplay（禁岛动线/尸体不腐遭遇/破坏-深区活尸围攻/结局层叠·B 女王 mini-boss?·horror_sapien_* id 实装·弱肉强食版·生物派/Nerea 接缝·Opus/high·需作者在场）。树：main·本地 commit 待 nightly（#249–#273）·定时任务全停。

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
- 事件 `events/*.json`（tutorial / reef / blue_caves / wreck_graveyard / ch1 + 中层·热液·海沟·鲸落·洞穴等深度柱内容 + mimic / horror_sapien 伏笔）。
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
