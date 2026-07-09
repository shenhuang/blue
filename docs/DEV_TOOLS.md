# 工具入口速查（DEV_TOOLS）

所有 dev 面板与编辑器都收进 **`?editor` 工作台**（EditorApp·整页·与游戏 App 解耦·不需 `?dev`）。
**游戏内已无 dev 浮层**——旧 `Shift+D/C/M/S` 快捷键与 `?dev&panel=` 路由已撤（2026-07-09）；
「dev 面板只经工作台」由 check-boundaries 规则五 + check-dev-panels（App/main 不得挂 dev 面板）两门焊死。
本地链接用 `http://localhost:5173`（先 `npm run dev`）；线上换成 `https://shenhuang.github.io/blue`
（编辑器的「保存进项目」「跑回归」按钮仅本地 dev server 有效）。

## `?editor` 工作台（左导航按域分组·URL `?editor=<key>` 深链可分享·手机无 Shift 键靠链接进）

| 工具 | key | 链接 | 备注 |
|---|---|---|---|
| 剧情走查/编辑 | story | `/?editor=story` | 测剧情库本身·不碰存档 |
| 事件回归 | event | `/?editor=event` | |
| 事件统计 | stats | `/?editor=stats` | 内容分布（最薄/最饱和池） |
| 素材/经济 | economy | `/?editor=economy` | 素材×大区热力图 |
| 战斗回归 | combat | `/?editor=combat` | |
| 海图编辑器 | chart | `/?editor` 或 `/?editor=chart` | 「保存进项目」「跑回归」需本地 dev server |
| POI 调试 | chartdev | `/?editor=chartdev` | 海图深度柱 POI 概览 |
| 地图调试器 | map | `/?editor=map` | 下潜图 mapgen（洞穴声呐图 / 开阔节点图）+ 结构读数 |

回退别名：裸 `?editor` → 海图（chart）·旧 `?storyeditor` → 剧情（story）。

## `?dev` 运行时门（仅这两项仍用 `?dev`·非面板）

- `?dev` —— 跳过教学，方便直接测试（见 `src/ui/devMode.ts`）。
- `?dev&scene=<id>` —— UI 预览：游戏一启动落在指定画面、注入合法 state（ephemeral 不落盘·见 `main.tsx` + `src/ui/dev/scenes`）。
