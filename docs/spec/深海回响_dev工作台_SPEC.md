# 深海回响 · dev 工作台 SPEC

> 状态：**已实装（2026-06-21·#163）**——4 浮层+2 编辑器合并进单一 `?editor` 工作台（`src/ui/EditorApp.tsx`）+ game↛dev 边界门落地（quirk #152）。本档描述的目标架构已落地，作实装参考。
>
> 把散落的 dev 工具收进**一个独立 sibling 根 `?editor`**（带左导航的工作台），与游戏 App 彻底解耦。
> 起于 2026-06-21 session（作者拍：全合并·工作台为唯一入口·先方案再开工）。

## 1. 动机

dev 工具现在**两套机制并存、且互相重叠**：

- **游戏内浮层**（挂在 `App.tsx` 上、`position:fixed` 盖屏、Shift 切换、`?dev&panel=` 深链）：
  事件回归 / 战斗 / 地图调试器 / 内容分布统计。
- **独立 sibling 根**（`main.tsx` 按 query 分发、与游戏解耦）：海图编辑器 `?editor`、剧情编辑器 `?storyeditor`。

重叠：剧情编辑器**已内嵌**「内容分布统计」；剧情编辑器 ≈ 事件回归（同事件/剧情域）；海图编辑器与地图调试器都叫「地图」但是**两张不同的图**（大地图 POI vs 下潜关卡 mapgen）。
散在两处 = 入口割裂、`App.tsx` 背着不属于游戏的 dev 逻辑、地图调试器揭图破坏迷雾的门控只能靠运行时守。

## 2. 现状清单（6 工具 → 3 域）

| 工具 | 现入口 | 引擎来源 | 性质 |
|---|---|---|---|
| 剧情编辑器 StoryEditor | `?storyeditor` | eventSatisfy/eventGraph/eventScenario + 真 EventView | 走查/编辑剧情库 |
| 事件回归 EventDevPanel | Shift+D · `?dev&panel=event` | eventScenario | scenario runner |
| 内容分布统计 StatsDevPanel | Shift+S · `?dev&panel=stats` · StoryEditor 内嵌 | eventStats | BI 仪表盘 |
| 战斗 CombatDevPanel | Shift+C · `?dev&panel=combat` | combatScenario | scenario runner |
| 海图编辑器 MapEditor | `?editor` | chart_*.json + vite 存回中间件 | 大地图 POI/beacon 编辑 |
| 地图调试器 MapDevPanel | Shift+M · `?dev&panel=map` | mapgen(generateDiveMap/analyzeMap) | 下潜关卡拓扑可视化 |

关键事实：4 个浮层**都不读活的游戏**（各自 `createInitialGameState` / `generateDiveMap` 造合成态）→ 抽出后能彻底移出游戏主包。4 个浮层根全是 `.dev-panel`（一个 CSS 类）。

## 3. 目标架构

单一 dev 工作台根，左导航按 3 域分组，content 区懒加载挂当前工具：

```
?editor —— dev 工作台（EditorApp·与游戏 App 平级的 sibling 根·main.tsx 分发）
├─ 事件/剧情
│   ├─ 走查/编辑   StoryEditor      key=story
│   ├─ 回归        EventDevPanel    key=event
│   └─ 统计        StatsDevPanel    key=stats
├─ 战斗
│   └─ 回归        CombatDevPanel   key=combat
└─ 地图
    ├─ 海图        MapEditor        key=chart
    └─ 关卡 mapgen MapDevPanel      key=map
```

- **EditorShell**：`position:fixed; inset:0; display:flex`。左 nav rail（定宽·分组列表·当前项高亮）+ content 区（`position:relative; flex:1; overflow:hidden; min-width:0`）。
- **EditorApp**：持 `tab` state（初值由 URL 解析）、`lazy()` 各工具、把当前工具渲进 content 区；切 tab 时同步 `history.replaceState` 改 `?editor=<key>`（深链可分享·手机无 Shift 键靠 URL 进，沿用旧 `?dev&panel=` 的理由）。

## 4. 路由表（main.tsx）

| URL | 落点 | 备注 |
|---|---|---|
| `?storyeditor` | 工作台 · `story` | 回退兼容（旧书签） |
| `?editor=<key>` | 工作台 · 对应 tab | key ∈ {story,event,stats,combat,chart,map}·未知回退 chart |
| `?editor`（裸） | 工作台 · `chart` | **保住旧海图书签**（旧 `?editor`＝海图） |
| 其它 | 游戏 App | 不变 |

工作台仍在 dev 门后：沿用 `DEV_TOOLS`（`?dev` 或本就是 dev-only 路由）。

## 5. 布局/CSS 策略（嵌入 3 类根）

- **4 dev 面板**（`.dev-panel` = `fixed; inset:0; z-index:9999`）：加 scoped 覆盖
  `.editor-content .dev-panel { position:absolute; inset:0; z-index:1; }` → 填 content 区而非盖屏。零改面板。
  面板 `onClose`：本阶段传 no-op（「关闭(Esc)」按钮暂悬空·见 §7 延后把 onClose 改可选以隐藏）。
- **StoryEditor**：根 inline `S.app.position:'fixed'` → `'absolute'`（inset:0 已在）→ 填 content 区。
- **MapEditor**：根 inline `height:'100vh'` → `position:'absolute'; inset:0` → 填 content 区。
  两处都是**根容器一行**改动·内部不动·smoke 渲染不受影响（只验不崩）。

## 6. 迁移顺序（每步保持 typecheck 绿·别留半截）

1. **✅ 已做**：建 EditorShell/EditorApp/editor-shell.css；main.tsx 路由；6 工具全挂进工作台；改 Story/Map 两根；typecheck 绿。
2. **✅ 已做**：dev 面板 `onClose` 改可选（缺省＝不绑 Esc、不显关闭·对齐 PanelShell quirk #112）；撤 `App.tsx` 4 浮层挂载 + `DevPanelKind`/`devPanel` state + Shift 监听 + `initialDevPanel` + lazy/Suspense import。`?dev&panel=` 退役（改用 `?editor=`）。
3. **✅ 已做**：加 `check-boundaries` 规则五 **game↛dev**（`App.tsx` + src/ui 下非 dev 文件不得 import `ui/dev/*` / `MapEditor` / `StoryEditor` / `EditorApp` / `EditorShell`）→ 升成会在 `npm run regress` 红的机制。typecheck + check-boundaries 静态门绿（游戏侧 34 文件 0 违例）。
4. **待 ship（未提交）**：Mac 上全量 `npm run regress` 绿（沙箱无 esbuild·行为 playthrough 在 Mac 补跑）→ 规则五拿 quirk 号 + CHANGELOG/QUIRKS/STATUS 收尾 → commit/push。**注意树里有作者在飞的战斗/boss 改动·别混提**。

## 7. 回退兼容 & 延后

- 旧 `?editor`（海图）、`?storyeditor`（剧情）书签：**继续可用**（§4 映射）。
- `?dev&panel=…`：第 2 步后退役；如需保留，可在 main.tsx 把它 301 到 `?editor=<key>`（可选）。
- **延后（不在本支）**：dev 面板 onClose 可选化属第 2 步；各工具数值/手感调按 [[defer-number-tuning]] 统一留到最后；工作台内「新建 beacon/编后续章节」等编辑增强是 MapEditor/StoryEditor 各自的后续，不在本壳范围。

## 8. 边界 & 不变量

- 引擎脑子全在 `engine/*`（纯·可 regress）；工作台只渲染/编辑，**不复刻引擎逻辑**（沿用 quirk #23/#24）。
- 工作台在 `src/ui`，受 check-boundaries 规则二约束（不手搓 phase 字面量·读 `phase.kind` 不受限）。
- 新增 game↛dev 规则（第 3 步）后，游戏主包不再含任何 dev 工具代码。
