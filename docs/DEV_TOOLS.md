# 工具入口速查（DEV_TOOLS）

游戏内 dev 面板 + 独立编辑器页的「怎么打开」。本地链接用 `http://localhost:5173`（先 `npm run dev`）；线上把它换成 `https://shenhuang.github.io/blue` 即可（编辑器的「保存/跑回归」按钮仅本地有效）。

## 游戏内 dev 面板（需 `?dev`）

四个面板互斥，一次开一个；都关着时按快捷键开对应面板，开着时按任意键或 `Esc` 关。手机无 Shift 键 → 用链接直开。

| 面板 | 快捷键 | 链接 |
|---|---|---|
| 事件回归 | `Shift+D` | http://localhost:5173/?dev&panel=event |
| 战斗 | `Shift+C` | http://localhost:5173/?dev&panel=combat |
| 地图调试器 | `Shift+M` | http://localhost:5173/?dev&panel=map |
| 内容分布统计 | `Shift+S` | http://localhost:5173/?dev&panel=stats |

## 独立编辑器页（整页·不需 `?dev`）

| 编辑器 | 链接 | 备注 |
|---|---|---|
| 海图编辑器 | http://localhost:5173/?editor | 「保存进项目」「跑回归」需本地 dev server |
| 剧情编辑器 | http://localhost:5173/?storyeditor | 测剧情库本身·不碰存档 |
