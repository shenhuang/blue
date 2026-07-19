# 深海回响 · dev 工作台 SPEC

> 状态：**已实装（2026-06-21·#163）**——4 浮层+2 编辑器合并进单一 `?editor` 工作台（`src/ui/EditorApp.tsx`）+ game↛dev 边界门落地（quirk #152）。本档描述的目标架构已落地，作实装参考。
>
> **⚠ 2026-07-12：剧情编辑器 StoryEditor 已整体删除**（Phase 2 只读走查工具·Phase 3 节点编辑一直未接·维护面收窄）。本档保留原「6 工具 → 3 域」的历史叙述作沿革参考，但下方表格/架构图/路由表已同步改为现状（5 工具）；引擎侧 `eventSatisfy`/`eventGraph`/`eventScenario` 不受影响（仍被 playthrough 等消费）。见 QUIRKS.md 新条目。
>
> **⚠ 2026-07-19：事件回归 EventDevPanel、内容分布统计 StatsDevPanel、POI 调试 ChartViewDevPanel（`?editor=chartdev`）三 tab 连组件删除**；「试玩/启动器」改名「**潜点/潜点测试**」（URL key 仍 `playtest`·深链不断）。CLI 事件回归门（event-runner/playthrough）与 `engine/eventStats` 聚合层**不受影响**（前者是 ship 门主体·后者仍被 materialStats/smoke-event-stats 消费）。现存 5 工具：潜点测试·素材·战斗回归·海图·地图调试。
>
> **⚠ 2026-07-19（同日晚·作者拍）：地图调试器 MapDevPanel（`?editor=map`）整体删除**——潜点面板三栏化后其声呐全图预览（共享 `SonarMapView.tsx`·同 seed＝实跑图）已覆盖主用途；mapgen 不变量仍由 CLI 门（`playthrough-mapgen-scenarios`/`analyzeMap`）守着（analyzeMap 可视化读数栏不随迁·要看读数跑 CLI）。同批：**潜点大目录删除**，潜点测试并入「地图」组改名「**潜点**」（URL key 仍 `playtest`·`?editor=map` 旧深链回退 chart）。现存 4 工具：素材·战斗回归·海图·潜点。下方 §3–§5 表格/架构图/路由表中的 map 行、§9 标题「潜点测试」按本条读。
>
> 把散落的 dev 工具收进**一个独立 sibling 根 `?editor`**（带左导航的工作台），与游戏 App 彻底解耦。
> 起于 2026-06-21 session（作者拍：全合并·工作台为唯一入口·先方案再开工）。

## 1. 动机

dev 工具现在**两套机制并存、且互相重叠**：

- **游戏内浮层**（挂在 `App.tsx` 上、`position:fixed` 盖屏、Shift 切换、`?dev&panel=` 深链）：
  事件回归 / 战斗 / 地图调试器 / 内容分布统计。
- **独立 sibling 根**（`main.tsx` 按 query 分发、与游戏解耦）：海图编辑器 `?editor`、剧情编辑器 `?storyeditor`（**2026-07-12 已删**）。

重叠：海图编辑器与地图调试器都叫「地图」但是**两张不同的图**（大地图 POI vs 下潜关卡 mapgen）。
散在两处 = 入口割裂、`App.tsx` 背着不属于游戏的 dev 逻辑、地图调试器揭图破坏迷雾的门控只能靠运行时守。

## 2. 合并前清单（沿革·2026-06-21 时点·其中 事件回归/内容分布统计 已于 2026-07-19 删除）

| 工具 | 现入口 | 引擎来源 | 性质 |
|---|---|---|---|
| 事件回归 EventDevPanel | Shift+D · `?dev&panel=event` | eventScenario | scenario runner |
| 内容分布统计 StatsDevPanel | Shift+S · `?dev&panel=stats` | eventStats | BI 仪表盘 |
| 战斗 CombatDevPanel | Shift+C · `?dev&panel=combat` | combatScenario | scenario runner |
| 海图编辑器 MapEditor | `?editor` | chart_*.json + vite 存回中间件 | 大地图 POI/beacon 编辑 |
| 地图调试器 MapDevPanel | Shift+M · `?dev&panel=map` | mapgen(generateDiveMap/analyzeMap) | 下潜关卡拓扑可视化 |

关键事实：4 个浮层**都不读活的游戏**（各自 `createInitialGameState` / `generateDiveMap` 造合成态）→ 抽出后能彻底移出游戏主包。4 个浮层根全是 `.dev-panel`（一个 CSS 类）。

## 3. 目标架构

单一 dev 工作台根，左导航按 3 域分组，content 区懒加载挂当前工具：

```
?editor —— dev 工作台（EditorApp·与游戏 App 平级的 sibling 根·main.tsx 分发·2026-07-19 现状）
├─ 潜点
│   └─ 潜点测试    PlaytestPanel    key=playtest（原「试玩/启动器」·2026-07-19 改名）
├─ 经济
│   └─ 素材        EconomyDevPanel  key=economy
├─ 战斗
│   └─ 回归        CombatDevPanel   key=combat
└─ 地图
    ├─ 海图        MapEditor        key=chart
    └─ 关卡 mapgen MapDevPanel      key=map
```

（原「事件[回归 key=event·统计 key=stats]」组与「地图/POI 调试 key=chartdev」已删·2026-07-19。）

- **EditorShell**：`position:fixed; inset:0; display:flex`。左 nav rail（定宽·分组列表·当前项高亮）+ content 区（`position:relative; flex:1; overflow:hidden; min-width:0`）。
- **EditorApp**：持 `tab` state（初值由 URL 解析）、`lazy()` 各工具、把当前工具渲进 content 区；切 tab 时同步 `history.replaceState` 改 `?editor=<key>`（深链可分享·手机无 Shift 键靠 URL 进，沿用旧 `?dev&panel=` 的理由）。

## 4. 路由表（main.tsx）

| URL | 落点 | 备注 |
|---|---|---|
| `?editor=<key>` | 工作台 · 对应 tab | key ∈ {playtest,economy,combat,chart,map}·未知回退 chart（含已删 event/stats/chartdev 旧深链） |
| `?editor`（裸） | 工作台 · `chart` | **保住旧海图书签**（旧 `?editor`＝海图） |
| 其它 | 游戏 App | 不变 |

工作台仍在 dev 门后：沿用 `DEV_TOOLS`（`?dev` 或本就是 dev-only 路由）。

## 5. 布局/CSS 策略（嵌入 3 类根）

- **4 dev 面板**（`.dev-panel` = `fixed; inset:0; z-index:9999`）：加 scoped 覆盖
  `.editor-content .dev-panel { position:absolute; inset:0; z-index:1; }` → 填 content 区而非盖屏。零改面板。
  面板 `onClose`：本阶段传 no-op（「关闭(Esc)」按钮暂悬空·见 §7 延后把 onClose 改可选以隐藏）。
- **MapEditor**：根 inline `height:'100vh'` → `position:'absolute'; inset:0` → 填 content 区。
  该改动是**根容器一行**改动·内部不动·smoke 渲染不受影响（只验不崩）。

## 6. 迁移顺序（每步保持 typecheck 绿·别留半截）

1. **✅ 已做**：建 EditorShell/EditorApp/editor-shell.css；main.tsx 路由；6 工具全挂进工作台；改 Story/Map 两根；typecheck 绿。
2. **✅ 已做**：dev 面板 `onClose` 改可选（缺省＝不绑 Esc、不显关闭·对齐 PanelShell quirk #112）；撤 `App.tsx` 4 浮层挂载 + `DevPanelKind`/`devPanel` state + Shift 监听 + `initialDevPanel` + lazy/Suspense import。`?dev&panel=` 退役（改用 `?editor=`）。
3. **✅ 已做**：加 `check-boundaries` 规则五 **game↛dev**（`App.tsx` + src/ui 下非 dev 文件不得 import `ui/dev/*` / `MapEditor` / `EditorApp` / `EditorShell`）→ 升成会在 `npm run regress` 红的机制。typecheck + check-boundaries 静态门绿（游戏侧 34 文件 0 违例）。
4. **待 ship（未提交）**：Mac 上全量 `npm run regress` 绿（沙箱无 esbuild·行为 playthrough 在 Mac 补跑）→ 规则五拿 quirk 号 + CHANGELOG/QUIRKS/STATUS 收尾 → commit/push。**注意树里有作者在飞的战斗/boss 改动·别混提**。
5. **✅ 已做（2026-07-12）**：剧情编辑器 StoryEditor 整体删除（组件本体 + `EditorApp` tab 接线 + `?storyeditor` 旧书签兼容 + 冒烟测试 + `check-boundaries` 规则五白名单 + 本档与 DEV_TOOLS.md 引用）。

## 7. 回退兼容 & 延后

- 旧 `?editor`（海图）书签：**继续可用**（§4 映射）；旧 `?storyeditor`（剧情）书签随 StoryEditor 一并删除、不再回退（现直接落 chart，同裸 `?editor`）。
- `?dev&panel=…`：第 2 步后退役；如需保留，可在 main.tsx 把它 301 到 `?editor=<key>`（可选）。
- **延后（不在本支）**：dev 面板 onClose 可选化属第 2 步；各工具数值/手感调按 [[defer-number-tuning]] 统一留到最后；工作台内「新建 beacon」等编辑增强是 MapEditor 自己的后续，不在本壳范围。

## 8. 边界 & 不变量

- 引擎脑子全在 `engine/*`（纯·可 regress）；工作台只渲染/编辑，**不复刻引擎逻辑**（沿用 quirk #23/#24）。
- 工作台在 `src/ui`，受 check-boundaries 规则二约束（不手搓 phase 字面量·读 `phase.kind` 不受限）。
- 新增 game↛dev 规则（第 3 步）后，游戏主包不再含任何 dev 工具代码。

## 9. 潜点测试 PlaytestPanel（原「试玩启动器」·2026-07-19 改名·`?editor=playtest`·2026-07-18 新增）

让 dev 不必玩到某处、也不必凑齐装备/补给，就能试玩任意海域的内容。配置项：自选**基础装备**（每槽从 `allItems()` 里 `category==='equipment'` 的候选选一件·**不含升级档**·作者 2026-07-18「先 2」）+ 三开关 + 任意 zone → 一键经**真实 App** 跑整趟下潜（每次启动新生成地图）。

- **开关（#318 后剩两个）**：**无限补给** `unlimitedSupplies`（消耗品使用不扣数 · 装载/拾取不计负重·默认开）；**god mode** `godMode`（氧气/HP/减压病 IV/极端温度入口全不致死不拦·默认关）。二档「god mode 可切换」＝作者拍板（既能纯逛测内容、又能测真实难度）。**旧「启用猎手」开关已删（#318）**：猎手＝图的属性（`zone.hunts`→`run.huntEnabled`·startDive 唯一产者·quirk #264）——有猎手的图恒有猎手、无开关；zone 下拉带「·猎手」后缀标识，测猎手选 `zone.hunt_test`。
- **海域＝zone**：#300 白板后 `chart_pois` 只剩两个未解锁锚点、`generateChart` 返回空 ⇒ 真正可下潜内容＝`zones.json` 的 zone（`generation==='random'`·含两个 boss 的 grounds）。故「选任意 POI」在此落成「选任意 zone」（同 MapDevPanel 枚举）；将来 chart 恢复真实可达 POI 再加一栏。
- **保真 & 不落档**：state 全走真实引擎入口（`createInitialGameState`/`createNewRun`/`getRunBonuses` 派生装备加成/`startDive`/`enterNodeSelection`·别手搓 phase 字面量·同 registry.ts 约定）；`App` 懒加载（dev→game·规则五允许·同 ScenePreview）、`ephemeral` 跳过 `saveGame` ⇒ **绝不覆盖玩家存档**（复用 #257 截图 harness 的注入机制）。
- **无限/god 机制层**：`RunState.devFlags?: { unlimitedSupplies?; godMode? }`（真条件字段·quirk #106·缺省 undefined 逐字节等价·不 bump SAVE·**仅 ephemeral 注入**）。engine 7 处单点 guard（每处缺省短路＝旧行为）：消耗品扣数（`combat.ts` step1b）/ 装载截重（`dive-start.ts::applyCarryItems`）/ 拾取超重（`events.ts::applyOutcome`）/ 氧气+氮气 tick（`events.ts::tickTurns`）/ HP·氧气 clamp≥1（`combat.ts::applyStatsDelta`）/ 极端温度入口（`dive-start.ts::startDive`）/ 减压病 IV 死亡（`ascent.ts`）。
- **门**：`scripts/smoke-playtest-launcher.tsx`（SSR 配置面板渲染 + devFlags guard 缺省等价/开启生效断言）入 regress。
- **#317（2026-07-19·作者两拍）**：① **默认装备自带声呐**（`DEFAULT_PICKS.sonar='item.sonar.handheld'`·不再照抄 starter 的空槽——声呐已是地图本体〔#315/#316〕，没它图全黑测不了内容；测「无声呐盲潜」手动改回（空）即可·smoke 焊 DEFAULT_PICKS 断言）；② **上浮后结束试玩**：run 收束回港那一刻（`phase→'port'`·上浮结算「回港」/葬礼后）`App` 的新可选 prop `onPlaytestEnd` 回调 → 回启动器配置面板（选项 state 在面板 ⇒ 一键再启动），**不进港口 UI**（试玩 profile 合成·港口无意义）。正常游戏/scene 预览不传该 prop＝零影响。
