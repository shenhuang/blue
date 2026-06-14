# 深海回响 · 探深「深度柱」SPEC（#130 / quirk #131）

> 北极星「灯塔＝信息基建」的**垂直**实装。取代旧「一条深脊柱·一级一个 `flag.probe.*` 解锁点·前哨蛙跳」模型。
> 设计 2026-06-14 作者拍板（锁）；本 SPEC 在实装时正式化（CHANGELOG #130）。数值为占位起手值·作者按手感调。

## 1. 一句话

每座灯塔自带一根**向下的深度柱**：建到第 K 级探深（probe Lv.K）→ 深度档 1…K 可下潜（lit）、第 K+1 档以**暗点**现身（dim·看得到去不了）、更深 hidden。一级露一档。是勘测站「水平暗圈」的**垂直版**（往下看得更深）。

## 2. 锁定参数（作者拍）

- **每柱级数**：家礁 `col.home` 2 / 残骸 `col.wreck` 3 / 中层 `col.midwater` 4 / 热液 `col.vent` 4 / 海沟 `col.trench` 6。
- **宿主灯塔**：home / 四章节前哨点亮后的灯塔（`lighthouse.ch1_{wreck,midwater,vent,trench}_outpost`）。
- **可拓展＝硬要求**：每柱配置走数据（`src/data/depth_columns.json`），**新灯塔（鲸落营地〔类灯塔〕/ 后续章节新大地图）只加一条 `DepthColumn` 配置即有自己的柱**，不碰引擎。
- **最深留后续 Phase**：各柱只下到「能见底」的中段（海沟 6 级止于 ~108m）。`abyssal/hadal/subhadal/nameless`「另一个世界」是**专门 Phase**（`d_reveal` 别擅自动·见 `深海回响_深水区_SPEC.md` / deep_game_vision）——`depth_bands.json` 保留这四条 band 作脚手架·**暂无柱档抵达**。

## 3. 数据模型（单一来源）

`src/data/depth_columns.json` → `types/columns.ts`：

```
DepthColumn { id:"col.<短名>"; lighthouseId; zoneId; name; blurb?; tiers: DepthColumnTier[] }
DepthColumnTier { tier(1-based连续); depthRange:[min,max]; label; cost:UpgradeCost;
                  visibility?; current?; tags?; alertFactor?; maxRoomFeatures?; sonarDeception?; hunts?; blurb?; danger? }
```

tier 旋钮语义 == `DepthBand`（`types/bands.ts`）。

## 4. 派生（engine/columns.ts·纯叶子·只 import 类型 + json + story 的 TUTORIAL flag）

一条 column 派生出三样**别处现成机制直接吃**的东西：

1. **band**：`columnBands()` 每 tier → 一个 `DepthBand`（id `band.<短名>.t<tier>`·绝对 depthRange 覆盖 zone·`order=顶深`）。`engine/bands.ts` 加载时合并进 `getBand/getBands` 注册表 → 下潜路径零改。
2. **probe 升级轨**：`columnProbeTracks()` 每柱 → 一条 `LighthouseTrack`（id `lhtrack.probe.<短名>`·`onlyLighthouse=宿主`·各级 `LighthouseUpgradeDef` id `lighthouse.probe.<短名>.lv<tier>`·`cost=该 tier 账单`·`effects:[]`＝纯门控·无 `setsFlag`）。`engine/lighthouses.ts` 加载时合并进 `TRACKS/INDEX` → `canBuildAt`（同轨顺序门控 needsPrev）/`buildAtLighthouse`/`getBuiltLevelInTrack`/`LighthouseBuildPanel`（按 onlyLighthouse 过滤显示）零改。
3. **海图深入 POI**：`buildColumnPois(profile)` 每「可见」档 → 一个 `ChartPoi`（id `poi.dive.<短名>.t<tier>`·带 `bandId`+`columnId`+`depthTier`·摆宿主灯塔附近·已带 `revealState`）。`engine/chart.ts::generateChart` 注入。

**可见性（核心规则）**：`depthTierRevealState(builtLevel, tier)`：`tier≤built→lit / ==built+1→dim / else hidden`。`builtLevel = columnBuiltLevel(profile, colId)`＝宿主灯塔 builtUpgrades 里本柱 probe 升级的最高 tier。
- `poiRevealState` / `poiBlockReason` 对带 `columnId`+`depthTier` 的 POI 走档位分支（不走发现/揭示圈/天气）；dim 的 blockReason＝「再推一级探深」。
- **教学门**：`buildColumnPois` 在 `flag.tutorial_complete` 未置时返回 `[]`（与所有 anchor 同门·守「教学前海图为空」）。
- **宿主门**：宿主灯塔未在 `profile.lighthouses`（章节前哨未点亮）→ 该柱不出潜点（柱挂灯塔上·灯塔在才有柱）。

## 5. 下潜 + 能源保留

`startDiveFromPoi(state, poi)`：POI 带 `bandId` → 私有 `diveIntoBand`（band 绝对 depthRange 覆盖 zone·落 `bandAlertFactor/sonarDeception/huntEnabled/diveModifier`）。每潜 `run.turn=0` 满氧起手（#128 删距离预耗氧）。
**能源保留接线**：column POI（`columnId` 设）额外并入**宿主灯塔在线补给设施**（`effectiveOutpostBonuses` 的 `rechargeBonus→powerMaxBonus` / `oxygenSupply→oxygenMaxBonus`）——老蛙跳删了·这层补给改由柱潜点承接（守 #128「能源保留」）。

## 6. 门 / 回归

- **`scripts/check-dive-refs.mjs`（重写·regress 门）**：柱配置不变量——lighthouseId 合法 / 一柱一灯塔 / 柱 id 唯一 / tier 连续单调（depthRange 越深档越深）/ 账单在场 / zoneId 合法 / 派生 band·probe id 不撞既有 / 残留手写 `ChartPoi.bandId` 可解析 / **事件 `advanceOutpostId` 必指向在册前哨**（防回流：旧深脊柱建造事件指向已删前哨）。
- **`scripts/playthrough-columns.ts`（新）**：配置自洽 / 派生 band(19 档) / `depthTierRevealState` / **端到端「建到 K → 1…K lit / K+1 dim / 更深 hidden」** / 派生 probe 轨顺序门控 / 教学门+宿主门 / 从 lit 档下潜落 run / 宿主在线制氧 +10。
- 改基线：`playthrough-bands`（柱 band + startDiveFromPoi 落地·保留 abyssal+ 预留 band 段）/`playthrough-outpost`（删蛙跳/深脊柱·章节前哨建造+能源+解锁门+发现门+promote 带柱）/`playthrough-lighthouse`（probe 链借派生 `probe.trench`）/`playthrough-chart`（§9 档位制）/`playthrough-sonar`（band id 重指）/`playthrough-mimic`（submerged 前哨重指）/`playthrough-save`+`playthrough-sonar`（SAVE 4→5）/`smoke-chart-ui`（章节前哨重指）。
- **SAVE_VERSION 4→5**（门控模型变·`flag.probe.*` 与旧 probe 升级 id 作废·未发布不迁移·quirk #99）。

## 7. 删除（老蛙跳 / 深脊柱废弃）

引擎 `startDiveFromOutpost`/`deepestOutpostLaunch`；`isChapterBand`/`chapterOutpostForBand`；`OutpostDef.bandId`；深脊柱 4 前哨（`outpost.reef_deep/trench_deep/abyssal_deep/hadal_deep` + 其灯塔）+ 4 建造事件；旧 5 条 probe 轨 + `flag.probe.*`；深脊柱浅段 band（reef_deep/trench_mouth/trench_throat）+ 4 章节 band（ch1_*）+ 11 个 `poi.deep.*`；chart_regions 4 深脊柱区。章节前哨建造改走海图 `OutpostPopup`「建造」按钮（直接 `advanceOutpost`·非下潜事件）。

## 8. 待作者补（占位 → 手感）

- 每柱每级**实际深度**（米 / band 范围）+ 各级**材料金账单** + **早期 on-ramp 节奏**（现 `depth_columns.json` 全是起手值·从旧 band 深度/探深料价推导）。
- 深入 POI 的**海图坐标手感**（现按 tier 在宿主灯塔附近扇开·占位）。
- 勘测站 `dimRevealBonus` 暗点圈半径手感（水平向·与垂直深度柱同一「信息基建」轴·一并调）。

## 9. 后续 Phase（不在本批）

- 鲸落营地〔类灯塔〕+ 后续章节新大地图：各加一条 `depth_columns.json` 即有柱。
- 「另一个世界」（abyssal/hadal/subhadal/nameless 下行入口·`d_reveal`）：专门 session·别擅自动（见 deep_game_vision / 深水区 SPEC）。海沟柱 6 级故意止于 ~108m、不一路通到底。

## 10. 下一迭代·已锁（作者 2026-06-14 讨论拍板·**待实现**·supersedes §2/§8 起手占位值）

#130 落地的是机制 + 占位数值。作者讨论后定案下面这套深度/级数/收尾，**下个 session 实现**（改 `depth_columns.json` + 删预留 band + 接电梯 capstone + 对齐周末 schedule·结构不动）。

**级数 + 每级深度（数字＝该级**底深**·band 范围＝上一级底→本级底·步长递增＝难度信号）：**

| 柱 | 级数 | 每级底深(m) | 定位 |
|---|---|---|---|
| 家礁 home | 2 | 40 / 60 | 熟悉游戏 + 一点洞穴探险 |
| 残骸 wreck | 3 | 50 / 75 / 100 | 难度略增 |
| 中层 midwater | 6 | 60 / 90 / 120 / 150 / 180 / 210 | **主探索区·内容最重**（步长 30） |
| 热液 vent | 4 | 75 / 125 / 175 / 225 | 比中层陡增（步长 50）·高风险·更强材料 |
| 海沟 trench | 4 | 90 / 180 / 270 / 〔第4级=电梯〕 | 深度骤降（步长 90）·近一章结尾 |

**海沟第 4 级 = 科考站电梯 capstone（不是普通刷怪 band）：**
- **材料 gate（非剧情 gate）**：第 4 级升级 cost 含一个「特殊升级模块」item——该模块由额外剧情/内容获得，但建造门是「手头有没有这个模块」的**材料检查**（canBuildAt 走料），不是直接 story flag 门。
- 建第 4 级**只解锁「海沟科考站电梯入口」这一个下潜点**。
- 探深名义最大 360m（**信息范围**）；**电梯入口实际深度 ~310m（300 多一点）**——信息范围 vs 实际可达点分离（守「灯塔=信息基建」：探得到 360、能去的只有电梯那一点）。
- 电梯入口 → 科考站（一章收束剧情·占位 + 接口即可）。**科考站做成 flag-gated region（复用 #124 owner-less 区原语）**：后面章节回来往下接（继续向下探索·Phase 3 在此长出）。

**删除预留 band**：`abyssal/hadal/subhadal/nameless`（作者：旧测试内容·不再需要·直接删·**不必**挪到 360m 以下）。连带要改：`playthrough-bands` §10-13 + `playthrough-sonar` §11（测这些 band·重指或删）；`events/*` 里 `[abyssal]/[hadal]/[subhadal]/[nameless]` tag 的周末事件会变 dormant（无 band 抵达）——下个 session 拍：删事件 or 留着待 Phase 3 re-home。

**周末 schedule/SKILL 对齐新结构**：midwater 6 级＝主探索区·内容最重·优先喂；按新 column zone/depth 喂（reef/wreck_graveyard/open_midwater/vent_trench/blue_caves 的新深度窗口）；别再喂已删的 abyssal/hadal band。当前定时任务全停（06-10 作者刻意）·恢复时按此对齐。
