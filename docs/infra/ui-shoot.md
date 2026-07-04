# UI 截图 harness（真机保真·手机 + PC）

一条命令把**真实游戏 UI** 一次性截成手机 + PC 图，不必玩到那个画面。给 dev / Claude 快速看 UI、以后接视觉基线用。

## 一句话原理

`?dev&scene=<id>` 把游戏一启动就落在任意画面——注入的 state 由**真实引擎构造器**造（`src/ui/dev/scenes/registry.ts`），交**真实 App** 渲染。所以截出来的和玩家看到的**逐像素相同**；唯一「假」的是 state 是直接构造、非玩过去（且只是稳定帧·不含入场动画）。注入走 `App` 的 `initialState`/`ephemeral` 两个可选 prop（预览绝不落盘·不覆盖真实存档），装配在 `main.tsx`（`?dev&scene=` 分支·懒 chunk·不进游戏主包·`game↛dev` 边界不破）。

## 跑

### Mac（最简单）

```bash
npm i -D playwright pixelmatch pngjs && npx playwright install chromium   # 一次性
npm run dev                                              # 开发服务器（localhost:5173）
npm run shoot                                            # 另开终端：默认 port_midgame·手机+PC
npm run shoot -- --all --view mobile                     # 全部场景·只手机
```

图落 `screenshots/<scene>__<viewport>.png`（gitignore）。

### 沙箱（Claude·自包含·不依赖本机 Chrome）

```bash
npm run shoot:sandbox -- --scenes port_midgame
```

`shoot-sandbox.mjs` 补齐 Linux 侧再调 `shoot.mjs`，全自动、幂等。首次会下 chromium（~110MB·`curl -C -` 续传·若被沙箱 45s 上限打断就重跑同一命令续上）。

## 手机为什么必须 Playwright（而非窗口缩放）

桌面 Chrome 的布局视口钉在**屏幕宽度**，`resize_window` 缩窗触发不了 `@media (max-width:480px)`（实测恒 `phoneCSS=false`）。Playwright 的 `isMobile:true` 设备上下文才把 device-width 设成 390 → 真手机断点点亮（`phoneCSS=true`）。这也是驱动层不用「MCP 缩窗截图」的原因。

## 加一个场景

往 `src/ui/dev/scenes/registry.ts` 的 `SCENES` push 一条 `SceneDef`（`build()` 用真实构造器·别写 phase 字面量·见文件头）。`--all` 自动带上（单一真相 `window.__BLUE_SCENES__`）。harness 本体（`main.tsx`/`ScenePreview`/`App`/脚本）不用动。

## 沙箱配方（版本全自派生·shoot-sandbox.mjs 已封装）

作者 `node_modules` 是 macOS 原生（`@esbuild`/`@rolldown` 均 darwin）→ vite 起不来；沙箱也没 chromium。补 Linux 侧、版本从已装 `node_modules` / `browsers.json` 读（不写死）：Linux `esbuild@<installed>`（`ESBUILD_BINARY_PATH`）＋ `@rolldown/binding-linux-<arch>-<libc>@<installed>`（`NODE_PATH` 注入·不碰作者树）＋ `chromium-headless-shell`（rev 自派生·`SHOOT_CHROMIUM`）＋ ldd 补缺库（`apt-get download`·非 root·`LD_LIBRARY_PATH`）。全落 `/tmp`。

## 视觉回归 diff（scripts/shoot-diff.mjs）

检出 UI 改动改了哪些画面（pixelmatch 热图 + 变更报告）。**基线按环境本地生成、不入库**——
跨平台字体渲染微差，沙箱 headless-shell 与 Mac chromium 的基线互不通用。bless→改→check 闭环：

```bash
# 沙箱（一条命令截图 + diff）：
npm run shoot:sandbox -- --all --bless    # 改动前：认可当前为基线
# … 改 UI 代码 …
npm run shoot:sandbox -- --all --check    # 改动后：报哪些画面变了（exit 1 + screenshots/diff/ 热图）

# Mac（dev server 已起）：
npm run shoot -- --all && node scripts/shoot-diff.mjs --bless   # 立基线
npm run shoot -- --all && node scripts/shoot-diff.mjs           # check
```

底部 build footer（时间戳/hash 每次变）按比例掩掉免假阳性。旋钮：`--mask-frac 0.05` /
`--threshold 0.1` / `--max-diff 80`。确定性靠 fixture 内 `withSeededRandom` 定死（mapgen / 悼名等），
实测同环境重截 0 px。是否把 `--check` 并进 `npm run regress`（chromium 进 nightly·成本高）另议·暂未接。
