# 深海回响 · 观测站重构 SPEC

> 缘起：2026-07-12 一个「压缩灯塔深度升级」的讨论 session，审计中发现 Ch1 结局（观测站）的落点/地理与叙事意图错位。本 spec 钉下审计实证 + 作者拍的方向，供下个 fresh session 专做重构。**本 session 零代码改动**，全是设计与只读审计。

## 0. 一句话

观测站（找到导师 · Ch1 结局）应锚在**深海沟**、经海沟前哨建造可达、**不需要任何深度升级**；当前它挂在标着「热液区」的圈里，而海图上「海沟区」标签却落在蓝洞群——地理错位要理顺，整条观测站剧情随之重构（含与四 boss 收敛的接法）。

## 1. 现状审计（2026-07-12 · 实证带行号）

- **深度柱 / probe 轨已删**（#294 · `engine/lighthouses.ts:35-36` TODO「深度门经济待重做」）。Ch1 主线推进现走**前哨脊柱**（reef→wreck→midwater→vent），无深度升级。
- 结局 = `ch1.ending_station`（`data/events/ch1.json:159` · 观测站 · 找到导师 · 置 `story.ch1.ending.fulfilled` + `charm_found` + 给破损定心坠）。
- 触发链：`poi.dive.vent.story`（`data/chart_pois.json:60` · `chainTail:true` · owner `lighthouse.ch1_vent_outpost`）→ 事件 `ch1.anchor_vent`（`ch1.json:120` · option 触发 `ending_station`）。
- 留白结局 = `ch1.ending_blank`（录音第 1 段）· 经 `poi.dive.vent.story` 的 revisit 门（`revisitRequiresFlag: story.ch1.charm_found`）。
- **四锚点**：`CH1_ANCHORS=[reef,wreck,midwater,vent]`（`engine/story.ts:39` · typed `Ch1Anchor`）。vent = chainTail（终点 · 其 `anchor.vent` **不是任何前哨的 requiresFlag** · `lighthouses.ts:643/659` 特殊处理 #217）。

## 2. 地理真相与错位（本 session 核心发现）

- 结局所在 zone = `zone.vent_trench`（`data/zones.json:86`）= **「海沟热液场」**：「**海沟**在这里裂开一道热口……日志的最后几页坐标，都指着这道**沟**」。**结局叙事上本就在海沟。** POI blurb 亦「海沟底的热液口」。
- 但海图揭示圈（`data/chart_regions.json`）把这个 zone 的 owner 圈（`lighthouse.ch1_vent_outpost`）标成 **「热液区」(z4)**。
- 而海图上标 **「海沟区」(z5 · 最右最深)** 的那个圈，owner = `lighthouse.ch1_trench_outpost`、其 zone = `zone.blue_caves` = **「蓝洞群」**（`zones.json:42` ·「海岸线往北一段……一串相通的水下洞 · Aldo 说很少有人从另一边出来」）——**横向洞穴迷宫，不是深海沟**。
- **⇒ 错位**：深海沟叙事（海沟热液场）挂在「热液区」标签下；「海沟区」标签空占在蓝洞群上。作者感觉「观测站在热液不在海沟」即源于此。

**可达性 gap**：`story.ch1.trench_found`（`story.ts:97`）**无 setter** · 只作 `outpost.ch1_trench.requiresFlag`（`lighthouse_upgrades.json:316`）⇒ 海沟前哨建不了 ⇒「海沟区(z5)」不可达（pre-existing · playtest P1-8）。

## 3. 目标与已拍决策（作者 · 2026-07-12）

- **D1** 观测站锚在**深海沟**（近 `vent_trench` 那道热口 · 叙事的家）。
- **D2** 可达 = 建**海沟前哨**（料门 · 已定义 · 见 §10），**无深度升级**。
- **D3** Ch1 深度升级 = **0 档**；整套深度升级压缩计划归 **Ch2**（见 §7）。
- **D4** 四锚点「一站一种原创鱼」设定废弃，改**四种 boss**（作者在做 · The Warren 已成 · #2 在做）。观测站与四 boss 的收敛接法见 §6。
- **D5** 整条观测站剧情**重构**（不是小挪）——含地理正名。

## 4. 地理重构方案（§2 错位怎么理顺 · 待作者选）

- **A · 相对最小**：正名不搬。结局所在圈从「热液区」改标「海沟」；蓝洞那圈另名（如「蓝洞区」）。改 `chart_regions.json` label + 若干 zone 展示名（走 QUIRKS #245 六类分诊）。**问题**：blue_caves 仍占「最右最深」位、与「蓝洞是浅岸洞」叙事不符。
- **B**：真把观测站搬进蓝洞群——**否**（与观测站「黑烟 / 热液口」文案冲突 · 不推荐）。
- **C · 地理重排（推荐 · 契合 D5「重构」）**：让深海沟（`vent_trench` 那条脉络）成为**最深区**、蓝洞群退成侧向支线区。要动 `chart_regions` 区序 / 坐标 + owner 灯塔归属 + 前哨脊柱末端。工作量最大但最正确。

> **作者 2026-07-12 拍定 C**（深海沟脉络成最深区 · 退蓝洞群为侧向支线区）。重构 session 据此展开；余下开工前置 = §6 圆满 / 留白 / 录音三拍的叙事骨架（作者未给）。

> **观测站落点（作者补 · 2026-07-12）**：海沟 **~300 m 深**——作者记忆里这是**最早的原设定**，中途漂成了「热液场」（正是 §2 错位的来源）。C 即把它正名回海沟 300 m。对比现 `poi.dive.vent.story` depthRange `[80,120]`·重构后落点应到 300 m 一带（前哨脊柱深度序随之拉开）。

## 5. 机制侧改造（地理定后 · 与叙事解耦 · 可代做）

以「C · 观测站在最深海沟区、经海沟前哨可达」为例：

- **海沟前哨可达**：`outpost.ch1_trench.requiresFlag` 孤儿 `trench_found` → 接 setter（vent 锚点完成置位）或改 `story.ch1.anchor.vent`。删 / 重议 `TRENCH_FOUND_FLAG`。
- **结局落点**：新增 `poi.dive.trench.story`（owner 海沟前哨 · chainTail · `eventId: ch1.anchor_trench` · `beatFlag: story.ch1.anchor.trench` · revisit→ending_blank）；vent POI 去 chainTail / revisit、降为普通锚点。
- **锚点表**：`story.ts` `CH1_ANCHORS` 加 `trench`（typed `Ch1Anchor` · chainTail 从 vent 移到 trench · `lighthouses.ts:643/659` #217 特殊处理跟改）；`ending_station.setProfileFlags` `anchor.vent`→`anchor.trench`。
- **守门**：`scripts/playthrough-story`（quirk #118 · §4「data story.* ⊆ allStoryFlags」）baseline 跟改；`scripts/check-mainline-reachable` 跟改。
- **`poi.dive.*.story` 4 个 id 别改名**（mentor_logbook.marksPois + check-mainline-reachable + items.json 钉 · quirk #244）——新增 trench 那个是「加」不是「改」。

## 6. 与四 boss 的接法（待作者定叙事骨架）

- 四 boss 分布 reef / wreck / midwater / vent（替原四鱼）· 观测站在最深海沟 = **四 boss 之后的收敛终点**（chainTail 天然「其余锚点齐才收敛」）。
- 结局文案里「四种鱼四个群落」的引用（`ending_station.hand_over_the_log` ·「萤纹丛还活着 · 锈甲群换了条船……」/ `ending_blank`「墙上四种鱼图鉴」）= **随 boss 重构改写** · 标 `[待改 · 鱼→boss]`。

## 7. Ch2 deferral（深度升级压缩 · 本 session 定案）

- Ch1 = 0 深度升级。原分区计划（zone1/2 = 0 · 3 = +2 · 4/5 = +1）**整块 Ch2**。
- Ch2 深档走**消耗式专属图纸**料门：图纸 = Ch2 掉落道具 · 作为配方料放进 `cost.materials`（`item.blueprint.*`）· 天然当 interim 锁 · **零引擎改动**（复用 `materialShortfall`/`describeUpgradeCost`/`canBuildAt`）· SAVE 不 bump（纯加道具 + 配方 · quirk #99）。
- UX 暂不标注（作者拍）。**反漂移**：Ch2 落地时做成 check「图纸类在 Ch1 任何区 / 商店 / 掉落不可得」（见 §8）。

## 8. 反漂移机制候选（本 session 发现的门 gap）

- **无门校验 chart POI 的 `requiresFlags` 都有 setter**。`check-mainline-reachable` 只覆盖 outpost 门 + story anchor，不查 chart POI requiresFlags（`cave_chart_page`〔8 洞穴 POI · 未来图册占位 · CHANGELOG #196〕/ `warren_discovered`〔占位〕/ `trench_found`〔孤儿〕全不查 · regress 绿但内容 orphan）。
- **建议**做成门：断言每个 chart POI 的 requiresFlags 都有 setter · 白名单放有意占位（cave_chart_page / warren_discovered）。正是 CLAUDE.md「约定落成机制」。**顺带**当 §7 图纸门的反漂移基座。

## 9. 触点清单（重构要改的文件 · §5 为准）

`chart_regions.json`（地理 / 标签）· `zones.json`（zone 名）· `chart_pois.json`（+trench story POI · vent 去 chainTail）· `ch1.json`（+anchor_trench · demote vent · ending setProfileFlags · [待改] 鱼→boss 文案）· `lighthouse_upgrades.json`（trench outpost requiresFlag）· `story.ts`（CH1_ANCHORS +trench · TRENCH_FOUND 处置）· `lighthouses.ts`（#217 chainTail 处理）· `dive-start.ts`（如需 · 多半数据驱动）· `playthrough-story` / `check-mainline-reachable`（baseline / 门）。

## 10. 材料经济重做（作者 2026-07-12 定向 · 替代旧料表 · 与 #294「重修经济」同摊）

**材料增删/改名**：删 `废合金`(scrap_alloy)、`黄铜配件`(brass_fitting)〔顺带解 #294「brass 现 drop-deadstock 只 Mira 买」〕；新增四种金属结核 `铜质结核`/`铝质结核`/`银质结核`/`金质结核`〔作者原文写「结合」·与「结核」同音·按既有 `铁质结核` ＋ 现实多金属结核采 **结核**·待确认〕。保留 `铁质结核`、`冷光腺`；`蛛蟹甲壳` 退出前哨建造（仍在制氧机设施·去留待确认）。

**金属深度梯**（越深越贵）：铜(浅) → 铁 → 铝 → 银·金(深)。

**前哨建造**（作者 2026-07-12 定：**单步 · 收齐料即建 · 不分阶段**）：

| 前哨 | 铜质结核 | 铁质结核 | 铝质结核 | 银质结核 | 金质结核 | 冷光腺 | 金币 |
|---|---|---|---|---|---|---|---|
| 残骸前哨（z2） | 2 | – | – | – | – | 1 | 占位待调 |
| 中层浮标（z3） | 2 | 2 | – | – | – | 1 | 占位待调 |
| 热液井台（z4） | – | 2 | 2 | – | – | 1 | 占位待调 |
| 海沟前哨（z5） | – | – | 3 | 1 | 1 | 1 | 占位待调 |

一步到位：收齐该行材料 ＋ 金币 → 建成前哨（点亮、揭示该区）。**取消旧「3 阶段建造」及「半亮即可蛙跳」中间态**（作者拍简化 · 实现＝把 `OutpostDef.stages` 多阶段收成单档 build）。金属深度梯 铜→铁→铝→银·金（越深越贵）不变；冷光腺 ×1 四座通用；金额占位待作者调（[[defer-number-tuning]]）。

**区域产出**（金属结核 drop 源 · 按 C 深度序）：珊瑚区(z1) 铜｜残骸区(z2) 铜·铁·少量铝｜中层区(z3) 铜·铁·铝｜热液区(z4) 铁·铝·少量金·银｜海沟区(z5·C 下最深·finale) 产出未定〔海沟前哨的银/金料来自热液区〕。

自洽：残骸(铜) → 中层(铁+铜) → 热液(铝+铁) → 海沟(铝+银+金) 逐级；建海沟前哨需银/金 ＝ 热液区产 ⇒ 玩家在热液区活动够料后才建海沟前哨、抵达观测站。冷光腺 ×1 四座通用（既有 lantern_gland drop 不变）。

**待确认（fresh session 开工前）**：~~① 金币~~ **保留**（作者拍·上表已含·金额占位待调）；~~② 建造分段~~ **单步·收齐即建·取消 3 阶段 + 半亮蛙跳**（作者拍 2026-07-12）；③ 蛛蟹甲壳去留（退出前哨料·制氧机仍用）；④ 海沟区(z5) 自身产不产料。**实现属经济重做（#294 同摊·deep_token 无 sink / lootFactor 删 等一并看）·非本 obs-station 结构改·建议 fresh session 一起做。**
