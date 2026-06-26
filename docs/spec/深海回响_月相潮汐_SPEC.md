# 深海回响 · 月相潮汐时间系统 SPEC

> 状态：**设计已定·待实装**（2026-06-26 作者逐条拍板·见 §1）。
> 北极星：把"时间"从**潜水次数**解耦成**天（day）**，让环境随**月相（盈亏）**周期变化——潜点随潮窗开合、机会点随相位浮现/消失，并由**情报系统**把"摸黑等"变成"有据规划"。
> 约束（沿用《区域揭示配置化 SPEC》§2）：**不重写 reveal 模型**（`isLit / poiRevealState / climateOcclusion / mimic 恒lit / story 恒显` 全保留·都已测·blast radius 可控）；只**加法扩展**、复用已测机制；**诚实轴不破**（可见＝可去·mimic 是唯一谎点）。
> 设计准则：约定落成**机制**（regress 门 / 纯函数 / 单一派生源），别留散文（CLAUDE.md「能不能变成 `npm run regress` 里会失败的检查」）。

---

## 0. 背景：大半已有雏形（要复用、别另起）

海图里**已经有**一套确定性"海况"机制，本系统是对它的**重接线 + 结构化**，不是新子系统：

- `condHash(seed, salt)`（chart.ts:104）：FNV-1a 确定性种子，当前种子＝`runsCompleted`。
- `chartConditions(profile) → { tide, weather }`（chart.ts:119）：`tide` 随机二元 `ebb/flood`（:121）、`weather` 晴/雾。
- `climateOcclusion`（chart.ts:236）：天气让机会点随回合"来去"（确定性 per `(poi.id, runsCompleted)`，:240）。
- `poiRevealState → 'lit' | 'dim' | 'hidden'`（chart.ts:252）：发现门 + 能力门 + 天气的三态总闸。
- roaming 机会点 pool-independent 浮现（`roamingKey` :347；`generateChart` :358）。
- `documentKnowsPoi` / `marksPois`（chart.ts:140）：持有标记某点的道具＝"已知"，绕发现门——**可发现性系统的现成地基**（§5）。

**三处缺口正是本系统要补的：** ① 时间种子是 `runsCompleted`（潜水次数），**不能在港口推进**；② `tide` 是**随机**二元且**当前仅 UI 显示**（SeaChartView.tsx:99 / ChartViewDevPanel.tsx:280·无门控消费）——改成月相派生安全；③ 机会点来去由**天气随机**驱动，不是结构化、可预期的**月相周期**。

> 结论：本系统 ＝ 世界时间种子换 `day` ＋ 月相**结构化**潮汐 ＋ 给三态揭示加一道**月相窗口**门 ＋ 港口"等待" ＋ **情报可发现性**。绝大多数落在 `chart.ts` 内重接线，加一个 `engine/lunar.ts` 兄弟文件放纯函数。

---

## 1. 设计决策（作者 2026-06-26 拍板）

- **软绑的"天"**：`day` 独立计数器，潜一次 +1（起步＝`runsCompleted`），保留为独立字段——为"港口等潮不潜水也推进天数"留口（已选：港口可等待）。
- **尸体腐烂挂"天"不挂"次"**：等潮的那几天尸体也在烂 → `diedOnDay` 锚点派生 `age = day − diedOnDay`。
- **月相 4 相、`LUNAR_CYCLE_DAYS = 28`、等分**（每相 7 天）；非每天一相，相位是"窗口"。
- **三层影响面可叠加**，首发只做"POI 可达/隐藏 ＋ 机会点 ＋ 情报"；全局潜水条件、经济/掉落押后（独立车道）。
- **等待＝相位跳转**（直接跳到下一相位边界·多日），不是逐天；机制上 `day += n`，但须满足 **jump ≡ step×N**（§6/§7）。
- **等待代价**：常驻＝尸体按天烂 ＋ 机会点相位限定会过期；另留 `waitCost(days)` 钩子默认 0、可调。
- **天气与月相＝独立两轴**：可预期的月相 + 随机的天气，互不耦合，仅在 `poiRevealState` 定显示优先级（§4）。
- **可发现性＝情报系统**：「知道」把窗外从 `hidden` 降级成 `dim`＋提示（§5）；多来源（道具/NPC/灯塔/痕迹/尸体/声呐/潮汐历）。
- **月相 gate 只关风味/探索·分章作用域**：Ch.1 主线在任何天气/月相都出现；Ch.2 起（祭祀主题）主线**可**受月相影响，但永不软锁（§7）。

---

## 2. 数据模型（state schema）

### 2.1 `PlayerProfile.day`（新增·additive）
- `day: number` 加在 `PlayerProfile`（types/state.ts:30·紧邻 `runsCompleted` :37）。语义＝世界经过的天数。
- 旧档 hydrate 缺省 `day = runsCompleted`（单点补·`hydrateGameState` state.ts:441·同 quirk #107 族）→ **行为逐字节不变**（迁移前 `day ≡ runsCompleted`）。
- `createInitialProfile`（state.ts:67）种 `day: 0`（紧邻 `runsCompleted: 0` :75）。
- 递增点：生还上浮（ascent.ts:180 旁）、死亡（death.ts:127 旁）各 `day += 1`；港口等待 `day += n`（§6）。
- **教学/资格潜不推进 day**（教学＝第 0 天·作者倾向）：若教学走 createNewRun/特殊路径不碰 `runsCompleted`，则同样不碰 `day`；如教学确有 +run，则在该路径显式跳过 day 递增。

### 2.2 `DeathRecord`：`diveAge → diedOnDay`（reshape·bump SAVE 11→12）
- 加 `diedOnDay: number`（死亡当天＝当时 `profile.day`）。
- `age = day − diedOnDay` **纯派生**取代存储的 `diveAge`（death.ts:189 的 `+1` 去掉）。
- **受影响读点（blast radius）**：`itemSurvives` 阈值（death.ts:49·单位"次"→"天"·阈值重标 §11）、`isRecoverableCorpse` 可见区间 `CORPSE_VISIBLE_AGE`（death.ts:145）、"优先最老"排序（death.ts:154/:173）、UI `CorpseView.tsx:91`「X 次出海」→「X 天」。
- **sweep 改成路径无关的确定性判定**（关键·§7 jump≡step）：当前是每潜一次 `Math.random() < BASE_SWEEP_CHANCE`（death.ts:200）——改成「某件物品是否已在 `age` 天内被冲走」＝ `deterministicSwept(deathId, itemId, age)` 的**单调谓词**（确定性哈希阈值随 age 单调置真）。于是无论"逐天走"还是"一跳到第 N 天"，到 `day` 的尸体状态完全一致，且去掉不可测随机。
- 形状变 → SAVE 11→12（state.ts:33·按 quirk #99 不写迁移、bump 弃旧档）。`day` 字段本可不 bump，与本项合并一次。

### 2.3 `ChartPoi` 月相窗口（新增·additive·缺省全相可达）
- `lunarWindow?: LunarPhase[]`：缺省/`undefined` ＝ 不受月相限制（向后兼容·现有 POI 零改动）。
- `lunarOffWindow?: 'hidden' | 'dim'`：窗外表现——`hidden`＝彻底消失（秘密/惊喜）；`dim`＝可见不可去（"满月再来"·可规划）。缺省 `dim`（守诚实轴）。**逐点拍·跟内容走**：写每个潜点时标，多数 `dim`、少数秘密标 `hidden`。
- **豁免**：`story`（剧情锚点◆）/ `persistent` / `mimic` 默认**不受月相窗门**（复用 `climateOcclusion` 豁免谓词 chart.ts:237）。Ch.2 起若要给剧情点设窗（祭祀），用显式 opt-in 字段（如 `lunarRitual`）而非去掉豁免——保持"默认不锁主线"（§7）。
- roaming 机会点模板（`RoamingTemplate`）同样可带 `lunarWindow`：只在某相位入池。

---

## 3. 派生层（纯函数·不入存档·对齐「派生不入存档」约定）

落在**新 `engine/lunar.ts`**（兄弟文件·参 `dive.ts` barrel + 6 兄弟 #105；`chart.ts` 已 400+ 行别再堆），`chart.ts` 只 `import` 消费：

- `LUNAR_CYCLE_DAYS = 28`（朔望周期·作者拍板；realism 取真实量级）。
- `moonAge(day) = ((day % 28) + 28) % 28` → `0..27`（连续相位，给 `tideLevel`/潮幅用）。
- `type LunarPhase = 'new' | 'waxing' | 'full' | 'waning'`。
- `lunarPhase(day): LunarPhase` ＝ **等分 7 天/相**（如 0–6 新、7–13 上弦、14–20 满、21–27 下弦·相位居中映射实装时定）。
- `tideLevel(day): number ∈ [-1, 1]` ＝ 月相派生潮位（28 天正弦）：**大潮**（spring·振幅大）在新月/满月、**小潮**（neap）在上/下弦——天文正确，为 Phase 2"低潮露通道/高潮开水路"提供连续量。

**重接 `chart.ts`（种子换 `day`）：**
- `chartConditions`：`tide` 改由 `tideLevel(day)` 派生（`>0 → 'flood' / <0 → 'ebb'`·**保持现有 `'ebb'|'flood'` 字段形状** ⇒ SeaChartView/DevPanel 显示零改动）；additive 增 `phase`/`moonAge`（UI 显示月相）。
- `condHash` 的 `runsCompleted` 入参全改读 `profile.day`（`chartConditions` :120、`climateOcclusion` :240、`roamingKey` :348、`generateChart` :360/:381/:385/:414）。
- **明确例外**：`dive-start.ts:478` 开场事件轮替是"潜水节奏"非"世界时间"，**保留 `runsCompleted`**（两个时钟刻意分离·写注释钉死）。
- 因 `day ≡ runsCompleted`（未用等待前）⇒ 重接后**回归逐字节不变**（Phase 0 绿门据此）。

---

## 4. 第 1 层：海图门控 ＋ 机会点（MVP·闭环）

- **月相窗口门**：在 `poiRevealState`（chart.ts:252）**加一道分支**（不重写·仿深度柱分支 :257）：非豁免 POI 且 `poi.lunarWindow` 存在且 `lunarPhase(day) ∉ window` →
  - 若该点"已知"（§5 `documentKnowsPoi` 或情报 flag）→ `dim`（带窗口提示）；
  - 否则 → `poi.lunarOffWindow ?? 'dim'`（未知秘密点＝`hidden`）。
- **天气与月相独立两轴 · 显示优先级**：一个点可能同时未知/月相未到/缺能力/被雾遮。`poiRevealState` 取最根本者，原因展示优先级：**未知(hidden) > 月相未到 > 缺能力 > 天气遮**（`poiBlockReason` chart.ts:322 据此给一句可执行话）。
- **机会点**：roaming 已随种子来去；种子换 `day` 后**等待即推进机会点**。带 `lunarWindow` 的模板在 `generateChart` 选取处按当前相位过滤入池 ⇒ 天然实现"机会点随相位浮现/消失" ＋ "等待＝放弃当前相位机会点"的机会成本。

---

## 5. 可发现性（情报系统）

让玩家在"摸黑等"之前**知道**"这儿某相位有东西、值得等"。统一机制 + 多来源。

### 5.1 统一机制：「知道」＝把窗外 `hidden` 降级成 `dim`＋提示
骑现成 `documentKnowsPoi`/`marksPois`（chart.ts:140）：
- 不知道 ＋ 窗外 → `hidden`（连存在都不知道）
- 知道（任何来源）＋ 窗外 → `dim`「下弦可达 · 还有 N 天」
- 窗内 → `lit`

情报只置「已知 ＋ 可选附带潮窗」，三态自己派生。一条规则、单一真相。

### 5.2 来源（MVP 复用现成 → 后续按 roadmap）
**MVP（全复用现成系统）：**
- **物品/日志情报**：`marksPois` 已有（鲸落手记那套），情报道具加"附带潮窗"字段，捡到即知道＋知窗。
- **NPC 情报**：接现有 NPC 进度对话（visibleIf flag·setsFlag·见 npc-progression-dialog），对话节点标记 POI ＋ 揭窗（守灯人 Aldo 讲潮汐最自然）。
- **灯塔/海图测绘**：灯塔设施或低频声呐"读潮"，其揭示圈内点自动知窗（接深度柱/声呐）。

**Roadmap（更有意思·后加）：**
- **临窗"痕迹"**：窗口前一相，hidden 点在图上留一丝迹象（暗涌/气泡/水色异常）＝"将现"态——会观察的玩家发现世界在预告（零道具 diegetic 发现）。
- **前人尸体/日志**：打捞到的死者留话"我来错了潮，洞封着"——情报从死亡/尸体系统长出来，契合"失联者留下的东西"canon（story_canon）。
- **声呐异常回波**：在水下 hidden 点附近 ping 得"不该在的回波"——只暗示存在、不给窗，接声呐不可信轴，让后期声呐变探秘工具。
- **潮汐历（可解锁工具）**：Otto/Mira 处打造"潮汐表"后，海图相位带标出所有已知点的窗——月亮升级成规划仪表（信息基建"毕业"）。

---

## 6. 港口等待动作

- 港口加 `advanceDays(state, n)` / **"等到下一相位"**（无需新 `GamePhase`·停在 `{ kind: 'port' }`·跑一段过场 log）：
  - 入口主形式＝**等到下一相位边界**（`n` 派生·想去更远相位多点几次）；如某些窗隔得远点太烦，后续可加"等到指定相位"快捷（先不做）。
  - 实现：`day += n` → 按 §2.2 路径无关地重算尸体状态 → 机会点/月相随 `day` 自动变（纯派生·下次 `generateChart` 即新）。
- **代价**：常驻①尸体存货按天烂；常驻②机会点相位限定·过期不候；可选 `waitCost(days)` 默认 0。
- **预览**：按下前显示得失三连——开什么、关什么（满月限定点消失）、代价（海底遗存再流失 N 天）。让等待是**看得见账**的决定。

---

## 7. 无软锁保障（机制·进 regress 门·分章作用域）

- **关键洞察**：因为等待随时可用，月相门**本身永远锁不死**（最坏等到对的相位）。真正风险只剩 ① 不知道要等（§5 情报解决）；② **循环相位依赖**（祭祀要物 A，A 又卡在冲突相位）。
- **结构性内生**：月相窗门豁免 `story`/`persistent`/`mimic`（§2.3）⇒ 剧情锚点◆默认永不被月相锁。
- **Ch.1（简单门）`scripts/check-lunar-reach.mjs`**（仿 `check-*.mjs`·进 `npm run regress`）：断言 Ch.1 关键路径（锚点 + 章节区门）**无月相窗**——主线任何相位都在。
- **Ch.2+（升级门·做祭祀时再实装）**：允许显式 `lunarRitual` 给剧情点设窗，但断言**关键路径无相位死锁**（存在某种等待顺序能凑齐所有前置·跨相位可达性检查）。
- **schema 校验**：`lunarWindow` 只能引用合法 `LunarPhase`（并入 `check-data-schema.mjs`）。
- **确定性回归**：
  - `playthrough-chart.ts` 扩断言"`day=N → phase=X` · POI 集 Y · `tide=Z`"。
  - `playthrough-decay.ts` 改按 `day` 验衰减；**新增 `jump ≡ step` 断言**（跳到第 N 天 == 逐天走 N 次·验 §2.2 路径无关）。

---

## 8. UI 呈现（信息分到三处现成的面·无新列表）

海图是 `.sea-chart`：`header`（海况一行 + 银行金币）+ 地图 pin + 右侧/手机下方**单选详情面板**。月相信息按面分布：

- **顶部海况条**（`conditionLine` SeaChartView.tsx:99/:315 + `port-meta` :316）＝**全局量**：`第 N 天`（搁银行金币旁 meta）、月相盘（印刷历"实心=受光"小圆盘·深浅模式皆成立·不用 emoji）、大潮/小潮、天气、4 相周期带 +「下弦还有 N 天」；**"等到下一相位"按钮**挂这条。
- **地图 pin 自身**＝**每点的月相态**（复用三态）：窗内＝正常亮 pin、`dim`＝灰 pin + 月相徽标 +"下弦可达·还 N 天"、`hidden`＝不画。徽标＝该点绑定的相位小盘。
- **右侧单选详情面板**（点中某 pin·SeaChartView.tsx:2/:504）＝**那一个点的可达条件**：`poiBlockReason` 那行显示月相原因 + 盘，出海按钮锁住。本就是一次一个、不是列表。
- **图例**（`chart-legend` :532）加一条"月相徽标＝该点潮窗"。
- **机制注记**：`chartSig`（SeaChartView.tsx:119）现仅含 `runsCompleted`，重接后**必须把 `day` 加进签名**，否则等待推进后海图不重算（易忘的坑）。
- **欺骗轴**：月相只出现在水面（海图/港口），**潜水 HUD 维持极简、不放月亮**（水下信息才是会骗人的层）。

---

## 9. 文件落点与改动半径

| 改动 | 文件 | 备注 |
|---|---|---|
| `day` 字段 ＋ 缺省 | types/state.ts:30 · engine/state.ts（hydrate :441 / `createInitialProfile` :67/:75） | additive |
| `day += 1` | engine/ascent.ts:180 · engine/death.ts:127（教学路径跳过） | 与 `runsCompleted` 同处 |
| 等待动作 | engine/port.ts（新 `advanceDays`）· UI 港口/海图按钮 | 无新 phase |
| 月相纯函数 | **新 engine/lunar.ts** | `moonAge`/`lunarPhase`/`tideLevel`/`LUNAR_CYCLE_DAYS=28` |
| 种子重接 | engine/chart.ts:104/119/240/348/360 等 | `runsCompleted → day`（dive-start.ts:478 保留） |
| 月相窗门 ＋ 情报降级 | engine/chart.ts:252（`poiRevealState`）+ :322（`poiBlockReason`）+ :140（`documentKnowsPoi`） | 不重写 |
| POI/模板字段 | types（`ChartPoi`/`RoamingTemplate`）+ 数据（regions/roaming/情报道具/NPC 对话） | additive |
| 衰减→天（路径无关） | engine/death.ts:49/145/154/189/200/206 + types/state.ts:116 + ui/CorpseView.tsx:91 | reshape·SAVE 11→12 |
| UI | ui/SeaChartView.tsx（海况条/pin 徽标/详情面板/图例/`chartSig` 含 day） | 无新列表 |
| 无软锁门 ＋ schema | **新 scripts/check-lunar-reach.mjs** + check-data-schema.mjs | 进 regress |
| 回归扩展 | scripts/playthrough-chart.ts · playthrough-decay.ts（含 jump≡step） | 改后须全绿 |

---

## 10. 分层与排期（含并行）

- **Phase 0 · 地基**（1 条线·**Sonnet·中 effort**）：`day` 字段 + 缺省 + 递增点 + 衰减改 day（路径无关 sweep·含 SAVE 11→12）+ `engine/lunar.ts`（CYCLE=28·先不接门）+ 种子重接（逐字节不变）。绿门：`playthrough-chart/decay` 调整后全绿 + `jump≡step`。
- **Phase 1 · MVP 闭环**（1 条线·接 Phase 0·**Sonnet·中 effort**）：月相窗门进 `poiRevealState` + 情报降级（marksPois + NPC 两源）+ 机会点 `lunarWindow` 过滤 + 港口等待（相位跳转）+ `check-lunar-reach`（Ch.1 版）+ UI 三面 + 图例。
- **Phase 2 · 全局潜水条件**（押后·独立车道）：`tideLevel` 接洋流/能见度/敌人活跃——与现有 `diveModifier`（dive-move.ts）**组合不覆盖**：`有效 = POI 派生 ⊕ 月相(phase)`。含灯塔"读潮"情报源 + 潮汐历工具。
- **Phase 3 · 经济/掉落浮动**（押后·独立车道）：某相位资源更丰 / Mira 价波动（port.ts `MIRA_BUY_RATIO` :73 + 掉落表）——与经济平衡 backlog 联动。
- **Ch.2 祭祀月相**（远期·随剧情）：`lunarRitual` opt-in + 升级版无软锁门。
- **并行**：Phase 2、3 文件基本不重叠（dive/events vs port/掉落）⇒ 收完 Phase 1 后开两条 psm 车道：
  - `node scripts/psm.mjs start lunar-dive --lane 'src/engine/events.ts,src/engine/dive-*.ts'`
  - `node scripts/psm.mjs start lunar-econ --lane 'src/engine/port.ts,src/engine/items.ts'`

---

## 11. 数值（定值 + 占位·defer-number-tuning）

- `LUNAR_CYCLE_DAYS = 28`、**4 相等分**（7 天/相）——**已定**。
- 占位待调：尸体衰减阈值重标（次→天·注意单次等待最多跨 ~21 天到指定相位·阈值宜 ≥ 一两个周期免一次长等清空存货）、`tideLevel` 振幅与大小潮比（Phase 2 才用）、`waitCost`（默认 0）、机会点各相位刷新权重。

---

## 12. 开放问题（剩余·非阻塞）

- 逐点 `hidden`/`dim`：跟内容走，写潜点时标（默认 `dim`）。
- 月相是否驱动家灯塔可见范围/声呐（信息基建北极星·deep_game_vision）——可作 Phase 2 子项。
- Ch.2 祭祀的具体月相机制（仪式相位、apex/mimic 相位活跃度）——做 Ch.2 再设计。
- "等到指定相位"快捷是否需要（先只做"等到下一相位"）。

---

## 参考

- 现有海况/三态/情报：`src/engine/chart.ts`（`condHash`/`chartConditions`/`climateOcclusion`/`poiRevealState`/`roamingKey`/`generateChart`/`documentKnowsPoi`）。
- 揭示模型契约：《区域揭示配置化 SPEC》§2（不重写 reveal）、§10（三态）。
- 上浮/减压与回港：`src/engine/ascent.ts`、`src/engine/port.ts`；《深海回响 SPEC》§4/§7。
- 存档约定：quirk #99（未发布·不迁移·reshape 即 bump）；hydrate 单点补缺省 #107。
- 解耦/机制：barrel + 兄弟文件 #105；约定落成机制（check-* / 纯函数 / 单一源）。
- 关联系统：NPC 进度对话（npc-progression-dialog）、剧情 canon（story_canon）、深水/灯塔北极星（deep_game_vision）、深度柱（probe_depth_columns）。
- 并行编排：CLAUDE.md「并行 session 编排（psm）」+ `docs/infra/parallel-sessions.md`。
