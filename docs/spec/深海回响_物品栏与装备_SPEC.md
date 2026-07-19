# 深海回响 · 物品栏与装备 SPEC

> 状态：槽模型定案 · 段1（地基+UI）已实装（2026-06-19·#144·详见下行「实装状态」）· 段2（stat 迁移·三传感器线→穿戴件）已实装（~2026-06-19/20·见下行「实装状态」段2 段·2026-07-10 Cowork 核实纠 stale）。
> **⚠ 2026-07-19 声呐无升级化（CHANGELOG #315）**：`item.sonar.handheld` 的 `upgradeSteps`（sonarPingCostReduction / sonarScanRangeBonus 两轴·Lv2–5）**整段删除**——声呐件 Lv.1 到顶、打造＝解锁全部功能（一记 ping 全图揭示·耗电常量）。下文段2 关于声呐升级步/数值对账的描述为历史；灯/服档位件与其它装备的 `upgradeSteps` 机制不受影响。
> **实装状态（2026-06-19·#144·以本注 + CHANGELOG #144 为准·下方 §4/§9 草案设计已被这些拍板覆盖）**：§9 五问 + 槽模型**定案**＝**9 槽**〔潜水衣 / 气瓶 / 潜水灯 / 声呐 / 武器·主 / 武器·副 / 饰品×3〕——**去掉护甲**；**气瓶库＝beacon 基础氧气、打捞行会＝Mira·两者非装备**（§4.3 旧映射作废）；饰品 3 槽渐解锁；声呐独立槽。B→C 合并走**分段 A**：实力单一来源＝穿戴件·`engine/equipment.ts::getEquipmentStats` 单点。**段1（地基+UI）已实装**：纸娃娃 `ui/EquipmentDoll.tsx`＝Otto 改装（`PortServiceMode 'upgrade'`）；物品栏「装备」tab 平铺所有装备（已装备 `ItemCell variant 'equipped'` 加框）；`UpgradeStep`+`upgradeSteps`+逐件升级账单；气瓶试点；无 SAVE bump。**段2 已实装（~2026-06-19/20·2026-07-10 核实纠 stale）**：§4.4 的 stat 迁移已落地——声呐/潜水灯/规避三线（喂传感器+猎手管线）搬进 sonar/light/suit 件 `upgradeSteps`、`getRunBonuses` 改读 `getEquipmentStats`、退役 `upgrades.json` 这三线、**SAVE 6→7**、数值对账（**quirk #140 双计陷阱**：移来源必同时删旧来源）。**落地实证（2026-07-10 核实 git 真值）**：items.json 三件带 stat（`item.sonar.handheld` upgradeSteps 有 sonarPingCostReduction/sonarScanRangeBonus·`item.light.eco_lamp` 有 lampEfficiency/powerMaxBonus·`item.suit.sound_absorb`/`item.suit.camo` 有 soundAbsorbBonus/camoBonus/signatureReduction）；`lighthouses.ts::getRunBonuses` 读 `getEquipmentStats`+`hasSonarEquipped` 为传感器**唯一来源**；`upgrades.json` 仅剩 salvage_guild+tankhouse；combat 读 `eq.physicalArmor`（#140/#142 双计已收·氧/体 base 跳过防地板双计）。**SAVE 未单独 bump 亦无迁移＝正确**：按 #99 未发布不写迁移·旧 `upgrade.sonar.*` id 无 def 静默跳过（同 `hydro.lv1` 先例）·SAVE 已于 13（感知门 2026-07-05）bump、覆盖段2 之前所有旧档。上文「**SAVE 6→7**」＝原计划占位、从未成立；原设想的「写 hydrate 迁移折算老档」与 #99 冲突·**刻意不做**。charm 槽仍恒=1（`unlockedAccessorySlots`·D 项二章待作者）。
> 关联：QUIRKS #94/#95（engine↛ui + 禁 phase 字面量边界）、#96（handoff 再生定位）、#99（存档不迁移·弃旧档）、#104（并发隔离）、#131（深度柱）、#137（lore 见闻志）；`portFocus.ts` 单决策点；`upgrades.json` 升级线；潜水 HUD：`DiveHeader` / `SonarScanPanel` / 港口 `has-panel` 全屏覆盖样式；剧情 SPEC §2（导师起始装备 canon）。
> 一句话：把港口右栏「改装装备」那个位置升级成一个统一的 **储物柜 / 物品栏**——左 tab、右内容。它是一个 **展示外壳**，按 tab 委托给各自子系统，**不是**把所有东西塞进一个数组。

---

## 0. 背景与动机

- **割裂一（日志）**：玩家拿到的日志，一半是真物品（`category:"story"`，如航海日志），一半是硬编码进 tutorial 事件的纯 flag（导师半本日志）。未来导师日志会有许多碎片、航海日志也会不止一本——再按特例写下去会随 session churn 散掉。
- **割裂二（装备实力）**：「你的装备有多强」目前分散在三套系统（见 §1），其中真正穿戴在身上的那套（System C）几乎是摆设。玩家点「改装装备」升级的，其实是抽象能力线，不是身上的某件东西。
- **目标**：从玩家视角给一个统一的「打开储物柜」入口——即便后端是多个 store。在 **不破坏解耦** 的前提下统一 UX；把约定落成机制（边界 / 回归 / 存档），不靠散文。

---

## 1. 现状盘点（新 session 起手只读这一节即可定位）

三套「花材料升级」+ 双层物品存储 + 几个已存在的内容子系统。

### 1.1 物品存储是双层的
- `run.inventory`（潜水中的临时背包，`RunState.inventory`）→ 回港时合并进 `profile.inventory`（港口仓库，`PlayerProfile.inventory`，`decay:"eternal"` 的天然永久）。
- `InventoryItem = { itemId, qty }`。
- `ItemCategory = equipment | consumable | material | story | currency`（`types/items.ts`）。
- `ItemRarity = common | uncommon | rare | legendary`——**每件物品都已带 rarity**。

### 1.2 System A · 灯塔升级
- `lighthouse_upgrades.json` + `engine/lighthouses.ts` + `LighthouseBuildPanel.tsx`（从海图 `SeaChartView` 选中灯塔进入）。
- 是地图 / 揭示的基建（基建地图 Phase C）。
- **注意**：`getRunBonuses(profile)`（`lighthouses.ts`）已经把「家灯塔船坞等设施」+「全局升级线」**合并**成随身加成——A 与 B 在派生层已部分桥接。

### 1.3 System B · 改装装备（能力线）
- `upgrades.json`（5 条线：声呐组件 / 潜水装备〔灯·电池〕/ 规避装备 / 气瓶库 / 打捞行会）+ `engine/upgrades.ts::getUpgradeBonuses` + `UpgradePanel.tsx`。
- 港口「改装装备（材料＋金币）」按钮打开；`UpgradePanel` 用 `lineFilter` 把「个人潜水装备」放这里，**打捞行会已移交 Mira 作为服务**（作者 06-13）。
- **关键**：这些是抽象「能力线」（如「声呐能力 Lv.3」），**不挂在某一件穿戴物上**。

### 1.4 System C · 穿戴装备
- `EquipmentLoadout`（5 槽：tank / suit / light / tool / charm）+ `EquipmentInstance = { itemId, slot, level, affixes? }`；`createStarterLoadout()` 种「导师留下的」起始装备。
- **现状是摆设**：`level` 没有升级流程（恒 = 1）、charm 槽空着；氧 / 体上限在 `createInitialStats()`（氧 60「蓝鳍 Mk.I 基础值」）+ `createNewRun()`（`oxygenMax = 60 + bonus`，bonus 来自 `getRunBonuses`）里 **硬编码 + 派生**，**不读** `item.equipment.effects`；只有 `combat.ts` 读了 `equipment.suit` 做护甲。
- 结论：**「装备实力」目前主要在 A / B，不在 C。** 这是合并迁移面最大的一点（见 §4）。

### 1.5 内容子系统（已存在）
- **见闻志 / lore**：`engine/lore.ts` + `data/lore.json` + `LoreView.tsx`；`profile.loreEntries`（Set·持久）记已解锁，`LoreEntryDef` 已带 `group` 字段做聚类（#137）。事件 `outcome.loreEntry` 写一个 id 进 Set。
- **图鉴**：`BestiaryView.tsx`（数据源＝敌人库 `enemyLibrary`，按遭遇解锁）。
- **海图**：`SeaChartView.tsx`。

### 1.6 港口右栏单决策点
- `portFocus.ts`：`PortServiceMode = gear | salvage | bestiary | lore`，加引擎 phase 的 `chart | shop`。
- 对话 / cutscene 进行时一律收起（互斥机制·`playthrough-port-focus.ts` 回归钉死）。新增右栏界面只要并进这里就自动受同一道门管。

---

## 2. 核心架构决定：物品栏 = 展示外壳

- 物品栏是 **一个新的 `PortServiceMode`（`'locker'`，占掉现在 `'gear'` 的入口位置）**，并进 `portFocus.ts` 单决策点 → 自动继承「对话时收起」互斥。
- 左 tab → 右内容；**每个 tab 委托给各自 store 的视图，绝不强行合并进一个 `InventoryItem[]`**。后者会把互不相关的子系统耦死、砸了可扩展性，也违反 engine↛ui 边界。
- 玩家看到的是「一个储物柜」，工程上是「一层薄展示壳 + N 个各自独立的 store」。

### 2.1 tab → store 映射表（关键）

| tab | 数据源 | 现状 | 备注 |
|---|---|---|---|
| 消耗品 | `profile.inventory` ∩ `category=consumable` | 有 | |
| 材料 | `profile.inventory` ∩ `category=material` | 有 | 可按 `MaterialTier` 再分组（已存在） |
| 日志 | lore 子系统 ∩ `kind=journal` | 加区分符（§3） | |
| 图鉴 | 敌人库 / `BestiaryView` | 有 · 从港口主入口移入此处 | |
| 海图 | 海图子系统 / `SeaChartView` | 有 · **双入口**（locker tab + 港口快捷） | |
| 装备 | `EquipmentLoadout` + 穿戴件 | 重做（§4） | 纸娃娃 |
| 任务 | 任务注册表 | **不存在 · 暂缓**（§5） | |
| 其它 | `profile.inventory` ∩ 其余 | 兜底 · 目标是里面永远没东西 | |

- 金币（`currency`）**不开 tab**，留在 HUD。
- 物品类 tab（消耗品 / 材料 / 其它）的网格**列数 / 行数随屏宽自适应**（响应式 · 与潜水战利品共用同一网格组件 · 见 §6.3）。

---

## 3. 日志统一（消灭「导师半本日志＝特例」）

- **模型**：一本日志 = 可选的收集物 `item` + 一条 / 多条 `lore` 条目（真正可读的内容）。两者拆开——物品是「token / 触发器」，内容是「可读档案」。
- **碎片化天然落在 lore `group`**：一个 group ＝ 一本可成长的日志；收到第 k 块就解锁第 k 条，日志 tab 显示进度 k/N。
- **导师半本日志**：从硬编码 tutorial flag 改成「导师日志」group 里 **开局预解锁** 的若干条（「半本」＝预置进度）。不再是特例，和别的日志同一条数据通路。
- **航海日志**：自己的 group，可多本 / 多页。
- **区分符**：给 `LoreEntryDef` 加 `kind: 'journal' | 'lore'`（或复用 `group` 前缀约定），让「日志」tab 与「见闻志」tab 从 **同一个 store** 按 `kind` 过滤。这 **不是新存储**，只是新视图。
- `item.story.unlocksLoreEntry` 钩子保留＝item→内容的连线。物品本身仍按 `category=story` 存进 `profile.inventory`。

---

## 4. 装备 tab：纸娃娃 + 逐件升级（合并 System B → C）

### 4.1 决定（本 SPEC 选定 · 作者可推翻）
把 System B 里 **可穿戴** 的能力线，并进 System C 的逐件升级。
- **理由**：玩家视角统一——你点身上的「灯」升级，就是原来的「潜水装备（灯）」线；消灭「两个升级入口、语义重复」。这也正是作者要的「玩家看来是一样的」。
- **代价**：重构 `upgrades.json` 结构 + bump `SAVE_VERSION` + 改回归基线。属一次性、可回归的重构，不是日常 churn。

### 4.2 纸娃娃 UI
- 5 槽对应身体部位，显示当前穿戴件 + 等级；点击槽 → 升级该件。
- 升级走 **材料＋金币账单**（复用 `UpgradeCost` 与 `UpgradePanel` 的账单 / 缺口高亮 UI；提取为共享组件）。

### 4.3 槽 ↔ 旧线映射（草案 · 待作者校 · 见开放问题 5）

| 槽 | 旧能力线 / 来源 | 备注 |
|---|---|---|
| tank | 气瓶库（`oxygenMax` / spare tank） | |
| light | 潜水装备（灯 · 电池 · `powerMax` / `lampRobustness` / `lampRange`） | |
| tool | 声呐组件（`unlockSonar` / ping / robustness / range / scan） | 开放问题：声呐归 tool 还是 light |
| suit | 规避装备（`soundAbsorb` / `camo`）+ combat 护甲（已读 suit） | |
| charm | **待定** | 开放问题 2：旧线 / 新机制 / 暂空 |

- **打捞行会**：不可穿戴，**不进纸娃娃**，保留为 Mira 服务（`salvage`，现状即如此）。

### 4.4 stat 派生迁移（最大的一块）
- 把 `oxygenMax` / `sensorTuning` 等从「`getRunBonuses`（能力线）」**逐步**迁成「读穿戴件等级」。
- **坑**：`getRunBonuses` 还桥接了家灯塔船坞（System A）——迁移时只把「能力线」那部分搬走，**别把灯塔来源也一起吃掉**（System A 不动）。
- effects 应用要 **单点**（仿 #116 负伤双单点约定），别散在 `createNewRun` / `dive-start` / `dialog` / `combat` 各处手抄。

### 4.5 范围
- **换装（swap）**：作者定为 **未来**——本期只做单件逐件升级。数据上 `EquipmentInstance` 已支持，UI + 「拥有装备池」后续。
- **词缀（affixes）**：远期（M5+），类型已留位，本期不做。

---

## 5. 其余 tab 与边角

- **图鉴**：从港口主入口撤下，移入 locker（自身 tab·数据源仍是敌人库）。开放问题 3：独立 tab vs 日志子类。
- **海图**：双入口——locker 一个 tab，港口主界面保留快捷入口，两处都拉同一个 `SeaChartView`（高频，值得双入口）。
- **任务**：当前 **无任务系统**。两选一（开放问题 4）：(a) 本期先不放该 tab；(b) 照 `lore.ts` 的样子搭一个最小数据驱动任务注册表（`quests.json` + `quests.ts` + `profile.questState`）再上 tab。**建议 (a)**，避免空壳假 tab。
- **稀有度边框**：`ItemRarity` 已在每件物品上 → 数据驱动配色（common/uncommon/rare/legendary）。低成本，纳入本期。
- **跨世界海图**：远期 Phase 3「另一个世界」（作者已留专门 session·别碰 `d_reveal`）——仅留数据钩子，本期不实现。

---

## 6. 潜水侧临时背包 / 战利品 + 移动端 HUD

> 作者 2026-06-17 追加：潜水时要能看战利品；移动端 HUD 改成「图标 → 全屏覆盖 · 互斥」+ 强制竖屏。与港口物品栏共用「响应式物品网格」+ `ItemCell`，但它在 dive 侧、读 `run.inventory`（临时背包），与港口 `profile.inventory` 分属两层（§1.1）。

### 6.1 现状（`DiveHeader.tsx`）
- 潜水内常驻头部 `DiveHeader`（跨 event / nodeSelect / rest / corpse 子阶段重挂载·模块级布尔记开合）。
- 移动端：单一「状态 / 声呐」**合并抽屉**，展开是 **in-flow**（钉顶 + 把下方内容往下推），**不是覆盖**；声呐图内部还有第二层收起。
- **潜水中没有看战利品的 UI**（`run.inventory` 有数据、无视图）。
- 港口侧已实现「窄屏开面板 ＝ 全屏盖主界面」（`.port-layout.has-panel .port-pane-left{display:none}`）——潜水侧照搬这套，不重新发明。
- 目前**无竖屏锁**。

### 6.2 目标 HUD（移动端）
- **状态条常显**（作者拍板）：氧 / 体 / 深度等一条薄栏，潜水时**永远可见**——不收进图标（潜水安全感优先）。
- **声呐、战利品 ＝ 两个图标，点开各自全屏覆盖、互斥**：开一个自动收起另一个。
  - 机制：把 `DiveHeader` 现有的两个模块级布尔（`sonarMapCollapsed` / `diveHeaderMobileOpen`）收成单一「当前展开面板」状态 `openPanel: 'none' | 'sonar' | 'loot'` → 天然互斥 · 跨子阶段沿用 · 纯 UI 态不入存档。
  - 全屏覆盖复用港口 `has-panel` 思路（盖住潜水主内容 · 顶部保留常显状态条 + 关闭按钮）。
- **战利品面板**：只读 `run.inventory`（**先只「看」**，不做丢弃 / 整理——作者：「目前只要能看到战利品就行」）。响应式网格（§6.3）· 移动端约 **3 行** · **满了翻页**。复用 `ItemCell`。
- 桌面（≥1200）：维持现有左栏常显逻辑，图标 / 抽屉隐藏（CSS 已有门）。

### 6.3 响应式物品网格（港口物品栏 + 潜水战利品共用）
- 每个物品 tab / 战利品面板都是网格，**列数 / 行数随屏宽自适应**（作者拍板：「根据屏幕大小选择」）。
- 移动端战利品目标 ~3 行；溢出翻页。港口 locker 各 item tab 同理。
- 抽成**一个共享网格组件**（建议 `ItemGrid`：吃一组 `InventoryItem` + 列宽下限 → CSS grid `auto-fill` / `minmax` + 翻页）；港口 locker 与潜水战利品都用它——单一来源，别两处各写一套。

### 6.4 强制竖屏（技术现实，别承诺真锁）
- 浏览器 `screen.orientation.lock('portrait')` **不可靠**：iOS Safari 不支持，多数移动浏览器要全屏 / 已安装 PWA 才允许。
- **可落地方案**：`@media (orientation: landscape)` 检测横屏 → 盖一层「请竖屏游玩」提示遮罩（挡住横屏布局）。真锁留待 PWA 化（远期 · 与跨世界同档）。
- 遮罩是纯 CSS / 根组件态 · 不入存档 · 不碰 engine。

### 6.5 边界
- 全在 UI 层：`openPanel` 状态、网格、竖屏遮罩都是 UI 态，**不构造 phase、不写存档**（守 engine↛ui + #95）。
- 战利品**只读** `run.inventory`，不调引擎写操作（看 ≠ 改）。

---

## 7. 边界 / 机制 / 存档（守 CLAUDE.md「约定落成机制」）

- **边界**：engine↛ui（规则一）、`src/ui` 禁 phase 字面量（规则二）。locker 是 UI 态，**不构造 phase**；真正的 phase 切换仍走 `engine/transitions.ts` 具名转移。
- **单决策点**：locker 并进 `portFocus.ts`（新 mode `'locker'`）→ 自动受对话互斥门管；扩 `playthrough-port-focus.ts` 回归覆盖新 mode。
- **派生不入档**：日志 / 图鉴 tab 的「已解锁」过滤走 `profile.loreEntries` / 敌人遭遇——纯派生，**不新增存档字段**（除非 §5 选 (b) 任务系统）。
- **装备合并的存档**：改了升级形状 → 按存档约定（#99）**bump `SAVE_VERSION` 直接弃旧档、不写迁移代码**。逐件升级账单走纯函数（建议 `engine/equipmentUpgrade.ts`），effects 应用单点。
- **回归门**：新增 / 迁移每一步都要能在 `npm run regress` 失败时被抓到（typecheck + 子系统 scenario）；ship 前才跑一次全绿（迭代用 `--only`）。

---

## 8. 分期落地（小步可回归 · 别一把梭）

- **P1 · 外壳**：新建 `locker` mode + 左 tab / 右内容骨架；消耗品 / 材料 / 其它三 tab（纯读 `profile.inventory`）+ 响应式 `ItemGrid`（§6.3）+ 稀有度边框。低风险、先验证 UX。物品格子复用现有 `src/ui/ItemCell.tsx`；新写一个 `scripts/playthrough-locker.ts` 即自动并入 `npm run regress`（`regress.mjs` 按 `playthrough*.ts` 模式自动发现）。
- **P2 · 内容迁移**：图鉴移入；海图 tab（复用 `SeaChartView`）双入口；日志统一（§3 · lore `kind` + 导师日志预解锁）。
- **P3 · 装备纸娃娃**：5 槽展示 + 逐件升级账单 + System B→C 合并 + stat 派生迁移 + `SAVE_VERSION` bump。最大一块，**单独 session**。
- **PD · 潜水侧 HUD（可与 P1 并行 · 相对独立）**：状态条常显 + 声呐 / 战利品全屏互斥（`openPanel` 单态）+ 战利品只读网格（`ItemGrid` · 移动 ~3 行 · 翻页）+ 竖屏遮罩（§6）。新写 `scripts/playthrough-dive-hud.ts` 自动入 regress。
- **P4（未来）**：换装 / 拥有装备池、任务系统、词缀、跨世界海图、PWA 竖屏真锁。

---

## 9. 开放问题（定稿前请作者拍板）

1. **System B → C 合并 vs 并存**——本 SPEC 暂选「合并」（§4），确认？
2. **charm 槽**对应什么（旧线 / 新机制 / 暂空）？
3. **日志 tab** 只读 lore 内容，还是同时显「物品」本体（`category=story`）？**图鉴** 是独立 tab 还是日志子类？
4. **任务 tab**：本期先不放（建议）vs 现在就搭最小任务系统？
5. **槽 ↔ 旧线映射**（§4.3）是否认可，尤其声呐归 `tool` 还是 `light`？
