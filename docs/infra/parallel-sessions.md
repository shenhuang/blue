# 并行 session 编排（方案 C·psm）

`scripts/psm.mjs` 把「多个 Cowork session 同时在 Blue 上干活」从「手动 `git worktree` + 人脑记谁碰了啥」
收成几条命令。它**站在方案 A / 方案 B 之上**，不取代它们：

- **方案 A（quirk #104）**：写手↔分支门（`.blue-writer` / `check-branch.mjs`）。psm 给每棵 session worktree 写
  `.blue-writer=interactive`，天然在门里放行。
- **方案 B（quirk #130 / #138）**：`git worktree` 物理隔离 + 相对指针。psm 把「add worktree → 改相对指针 →
  symlink node_modules → 登记」这串手动步骤做成 `psm start` 一条命令。
- **方案 C（本文）**：在上面加三样方案 A/B 没有的东西——**活的 session 台账、车道边界门、串行合并 + 绿门检查点**。

> 一句话心法：并行的瓶颈不是「冲突」，是**串行占比**（你协调的时间 + 必须串行的合并）。psm 的设计目标是把
> 你每条 session 的手动开销压到「起个名 + 划条车道」，其余自动；冲突则按「能拦的最早时机」分层拦住。

## 三层冲突，三种拦法

| 冲突 | 时机 | 拦法 |
|---|---|---|
| 工作区互踩（同一 checkout 并发写同一批文件） | 起手 | 每条 session 一棵独立 worktree（`psm start`·物理隔离） |
| 文本 / 越界（改到车道外、踩别人车道） | 提交那一刻 | `pre-commit` 车道门——**警告并停下**等你确认 |
| 语义冲突（各自合得干净、合一起逻辑炸） | 合并前 | `psm land`：rebase 最新 main + 跑 `regress` 绿门 |

文本冲突靠「事前划不重叠车道」基本消灭；语义冲突没有静态检查能提前逮，只能靠 land 串行 + 每次重测兜。

## 生命周期

```
psm start <name> --lane <glob,...>     # 开一条线：独立 worktree + 申报车道
  → 在该 worktree 里开一个 Cowork session 干活（只动车道内文件）
psm land <name>                         # 收工：rebase 最新 main + 绿门；绿了【停下等你确认】
psm land <name> --yes   /  psm merge <name>   # 你确认后：ff 合进 main（在 main 树跑）
psm gc                                  # Mac 本机：清掉已合并 worktree
```

`land` 默认**只到绿门检查点就停**（退出码 3），不自动合——这是你选的「警告然后停下等我回复」。确认无误再
`land --yes` 或 `psm merge`。

## 命令

- `psm install` —— 一次性：wire `core.hooksPath=.githooks`、补 `.gitignore`、建台账。装完把
  `scripts/psm.mjs` / `.githooks/` / `psm.config.json` 提交到 main（新 worktree 从 main checkout 才带得上车道门）。
- `psm start <name> --lane <glob[,glob...]>` —— 开线。`--lane` 是这条 session 允许动的文件（glob，逗号分隔，
  支持 `**` `*` `?`，纯目录名当前缀）。起手会自检车道是否和在飞 session 重叠，重叠则停下（`--force` 强开）。
- `psm status` —— 所有在飞 session：车道、与 main 的落差、merge 锁、待清理列表。
- `psm check <glob[,glob...]>` —— 起手前自检：这条车道和谁重叠？
- `psm land [name] [--yes]` —— rebase 最新 main → 跑绿门 → 绿了停下等确认（`--yes` 直接合）。red/冲突→停下不合。
  不带 name 时从当前 worktree 推断。**沙箱里跳过 rebase**（mount 不能 unlink·见下「沙箱约束」）：先 `doctor`
  清残锁 → 跑绿门 → 停下让 **Mac** `land --yes` 收尾——**绝不在沙箱 rebase / 合并**。
- `psm merge <name>` —— = `land --yes` 的合并那一步。**必须在 main 树、当前在 main 上跑**（advance main 会动 main 树文件）。沙箱拒绝（见下）。
- `psm abort <name>` —— 放弃一条线（沙箱删不掉 worktree，留到 `gc`）。
- `psm gc` —— **Mac 本机**清掉已合并/已弃的 worktree + 分支（沙箱拒绝·不能 unlink）。
- `psm doctor` —— 清崩溃 / 中断留下的 git 残锁（`*.lock`）+ 中断 rebase 态（`rebase-merge`）。沙箱不能 unlink →
  **只 mv 进 `.sandbox-junk`（可恢复）不删**；只碰 git 自己的锁、不碰 refs / objects / 工作树 / 台账串行锁。
  卡死时（"another git process could not detach HEAD" / "cannot lock ref"）跑它自愈；`land` 起手也会自动先跑一遍。

## 沙箱约束（都已实测·别绕）

- **不能 unlink（quirk #1）**：Cowork 沙箱 mount 只能 创建/改/rename，删不掉文件或目录。所以 `land`/`merge`
  **不在沙箱删 worktree**——合完 worktree 留在原地（gitignored·无害），清理交给 Mac 本机 `psm gc`。
- **相对指针（quirk #138）**：git 2.34 无 `--relative-paths`，`psm start` 在 `worktree add` 后手写两个相对指针，
  才能 Mac + 任意 Cowork 沙箱通用（每个 session 把 Blue 挂在不同绝对路径）。代价：git 2.34 的
  `git worktree remove` / `git worktree prune` **不认相对指针**——所以**别手动 `git worktree remove`/`prune`**
  （prune 还会误删 weekend worktree），一律走 `psm gc`（它手动删工作树 + admin 目录，不碰 prune）。
- **绿门子集**：沙箱无 native esbuild，跑不动 vite build / tsx playthrough。`land` 在沙箱默认跑
  `npm run regress -- --only typecheck,check`（typecheck + 全部 check-*·esbuild-free·实测 ~3s 全绿），并提示
  完整 playthrough/build 的语义绿留给 Mac/nightly 全量 `npm run regress`——与 CLAUDE.md「全量 regress 是 ship
  前的门、不是起手仪式」一致。要改跑什么编辑 `psm.config.json` 的 `gate`。
- **沙箱绝不 rebase / merge（护栏·2026-06-21 加）**：`git rebase` 要删状态目录、`git merge --ff-only` 要替换/删
  工作树文件——撞 unlink 就崩，且残锁（`HEAD.lock`/`index.lock`/`rebase-merge`）留在**共享** `.git` 里把后续所有
  git 卡死、连 **Mac** 的 land 一起毒死（ch1-st2 那次反复卡死=此根因·级联）。所以 `land`/`doMerge` 一检测到沙箱
  （`isSandbox()`）就**不 rebase / 不合并**：跑绿门 + 起手 `doctor` 自愈 → 停下让 Mac 收尾。沙箱要把分支「弄进
  main」只两条正路：① 提交到 feature 分支 → **Mac / nightly** `land --yes`（首选）；② 真要沙箱自助，得走
  unlink-free plumbing（`read-tree` 临时 index → `commit-tree` → CAS `update-ref`），psm **暂不自动做**（风险高·留作后续）。

## affected 选测（别每次全测·`gate.affected`·默认开）

`land` 不再无脑跑全量行为测，而是**从「改了哪些文件」沿依赖图算出「哪些 playthrough 可能被波及」，只精确跑那些**（`scripts/affected-tests.mjs`）。心法见本文档顶部的讨论：**车道是写边界，波及面是依赖闭包**，按依赖图选才健全，按车道名硬映射会漏。

- **静态 import 图**：解析 import/from/dynamic-import/require（`@/`→`src`·补扩展名·静态 `.json` import 也算边界）。
- **动态依赖**：扫每个「入口可达文件」里的路径字面量，抓 `fs` 读的 fixture——`scenarios/**`（combat/lighthouse/mapgen 场景测）、`playthrough-chart.ts` 读的 `src/data/chart_pois.json` 等。纯 import 图看不见这些，漏了就是漏测。
- **健全回退（宁可多跑不漏跑）**：任何「依赖图里解释不了的改动」（CSS、动态加载、新孤儿）或**全局触发**（`tsconfig`/`package.json`/`vite.config`/`regress.mjs` 本身）→ 直接 **ALL**，回退全量。
- `typecheck` + 全部 `check-*`（纯 node·全局不变量）**永远跑**，不参与选择；affected 只挑贵的 tsx 行为测。

效果（实测真实 Blue 图）：改 `scenarios/lighthouse/*.json` → 只选 `playthrough-lighthouse-scenarios`（1 个）；改核心模块 `engine/equipment.ts` → 28 个（它扇入大·该测就得多测——这正是健全：外围改动窄、核心改动宽，不给假绿）。

环境：

- **Mac**（有 native esbuild）：`land` 实跑 `npm run regress -- --only typecheck,check --only-exact <受影响行为测>`，快且覆盖到位。
- **沙箱**（无 esbuild·跑不了 tsx）：只跑静态门，并**精确报告**「这些受影响行为测请在 Mac 补跑：`npm run regress -- --only-exact <list>`」——比旧的「playthrough 全留 nightly」精确得多。要在沙箱也跑行为测，接上 `ESBUILD_BINARY_PATH`（见自动记忆 `blue-regress-sandbox`），`land` 会自动改跑受影响行为测。

逃生阀：`psm land <name> --full` 强制全量；或 `psm.config.json` 里 `gate.affected:false` 关掉。`--only-exact` 是给 `regress.mjs` 加的精确选测开关（与 `--only` 子串取并集·避免 `playthrough` 子串把 30 个全带上）。`node scripts/affected-tests.mjs --since main` 可单独看选测结果。

## 共享状态在哪

台账和锁放跨 worktree 共享的 `.git/psm/`（= `git rev-parse --git-common-dir` 下），天然跨 session 共享、永不提交、
不用 gitignore。仓库主树根 = `dirname(git-common-dir)`，所以 pre-commit 钩子在 worktree 里跑也能算回主树、查到自己是哪条 session。

```
.git/psm/ledger.json   # { sessions: { <name>: {branch, worktree, lanes, baseSha, state} }, mergeLock }
```

`state`: `active`（在干）→ `ready`（过了绿门待合）→ `landed`（已 ff 进 main·待 gc）；`aborted`（弃）。

## 串行合并怎么保正确

`merge` 前两道闸：(1) **staleness**——你 rebase 之后 main 不能又动过（动过＝别的 session 抢先合了 → 让你重
`land` 对齐最新 main 再合）；(2) **merge 锁**（台账字段·30min 超时自动释放）。真正的安全网是 staleness：
两条各自绿的分支先后合，第二条一定 rebase 到含第一条的新 main 上重测，所以语义冲突在合并点被逮住，而不是事后。
合并用 `--ff-only`（线性·无 merge commit·只增改不删 → 不触发 main 树 unlink）。

## 和 append-only 文档的关系

CHANGELOG / QUIRKS 只在 **main 整合时**写（quirk #130 / `check-append-only-docs`）。psm **不碰**这些文档——
feature 树里别动它们，合并后在 main 上追加，天然免冲突。

## 配置（`psm.config.json`）

```json
{
  "mainBranch": "main",
  "branchPrefix": "feat/",
  "worktreeRoot": ".worktrees",
  "gate": { "full": "npm run regress", "sandbox": "npm run regress -- --only typecheck,check", "affected": true },
  "reuseNodeModules": true,
  "lockStaleMinutes": 30
}
```
