# 方案 B 落地：周末引擎独立 worktree（物理隔离）

> 状态：**搭建机制已就位（2026-06-19·交互 session）**——`.gitignore` 收 `/.worktrees/`、`scripts/setup-weekend-worktree.mjs`（`npm run weekend:worktree`）、写手↔分支门 `check-branch`（quirk #138）已落。**待作者执行**：① Mac 本机跑一次搭建；② 改 3 个自动化任务接入 worktree（§4·提案 §6 要作者逐步确认·**未自动改**）。
> 关联：并发隔离总提案 [`concurrency_isolation_proposal.md`](concurrency_isolation_proposal.md)（§3 方案 B）；分支门 quirk #138；沙箱 node_modules 见自动记忆 `blue-regress-sandbox`；feat 并行 worktree（≠ 本文）见 quirk #130。

## 1. 为什么要 B（A 挡不住的那两类）

方案 A 是「分支隔离 + **单棵共享工作树**」。分支只隔离已提交历史，不隔离活的 HEAD / index / 工作区文件：

- **共享 HEAD 被翻**：全仓一个 HEAD，被并发 `checkout` 翻动 → 提交落错分支（2026-06-19 周末 POI 落进 main，靠 ref 手术救回）。
- **共享 index / 工作区互踩**：两写手改同一批磁盘文件，未提交改动互相覆盖（本 session 实测：干活时 `src/engine/chart.ts`/`items.ts` 被并发写手改了 42 行）。
- **build 抢 `dist`**。

`check-branch`（#138）把「落错分支」做成会红的门——但那是 **backstop**（事后拦提交），挡不住 index 互踩。**真正消除这三类的是物理隔离**：让周末引擎在一棵独立工作树里跑。

## 2. 结构

```
~/Desktop/Blue/                 ← 交互 session·永远在 main·不再被周末 checkout 翻
├── .git/                       ← 共享 object store（worktree 共用·无重复）
├── node_modules/               ← macOS-native（main 树装）
├── src/ … scripts/ …
└── .worktrees/weekend/         ← 周末引擎·永久钉 auto/weekend（gitignored·mount 内·sandbox 可见）
    ├── .blue-writer = weekend  ← 每棵树各一份·check-branch 据此放行（天然不串味）
    └── node_modules → ../../node_modules  （symlink 复用·同主机）
```

两棵树各有**独立 HEAD / index / 工作区文件**：周末引擎在 `.worktrees/weekend` 提交，main 树的 HEAD 纹丝不动 → HEAD 翻不了、文件不互踩。`.blue-writer` 是 per-tree 未跟踪文件，两树各一份 → 方案 A 标记的 lingering 串味问题在 B 下天然消失。

## 3. 一次性搭建（Mac 本机·幂等）

```bash
cd ~/Desktop/Blue          # 必须 main 树本机·不能沙箱（worktree 记绝对路径）
npm run weekend:worktree    # 建分支(若无)+挂 worktree+symlink node_modules+写 weekend 标记
```

脚本检测到沙箱路径会硬停（防把 /sessions 路径写进 `.git/worktrees/`）。node_modules 默认 symlink 复用 main 树；要彻底独立就 `(cd .worktrees/weekend && npm install)`。

`npm run handoff` 的 1c 块会列出这棵 worktree（quirk #130 既有机制·自报并行线）。

## 4. 自动化 3 任务接入（**作者逐步改·每步确认·提案 §6**）

通用改法：把「在共享 main 树上 `git checkout auto/weekend` 再提交」换成「在 `.worktrees/weekend`（已永久钉 auto/weekend）里 `cd` 进去跑+提交」——**不再 checkout 主树、不再翻 HEAD**。该树已带 `.blue-writer=weekend`，`check-branch` 自动放行；提交套路（`gc.auto 0` / 显式 `git add` 单文件 / `mv` 收容锁）全不变。

| 任务 | 现状 | 改成 |
|---|---|---|
| `deep-echo-weekend-content`（周六日） | 在共享树写内容·全绿门·不 commit | `cd .worktrees/weekend` 里写+全绿门+（可选）commit；不碰 main 树 |
| `deep-echo-weekend-poi`（周一·06-19 当事者） | 共享树 `checkout auto/weekend` 再 commit | `cd .worktrees/weekend` 直接 commit（已在 auto/weekend·无 checkout=无 HEAD 翻） |
| `nightly-blue-verify-publish`（每日 ~1am） | verify 后 `git branch -f main auto/weekend` 再 push | verify 在 `.worktrees/weekend`（设 `BLUE_WRITER=nightly` 跳过分支门）；合并仍从 main 树 `git branch -f main auto/weekend`（移 ref 不动树·quirk #104b）再 push（**不变**） |

沙箱里这些任务仍按 `blue-regress-sandbox` 记忆装 Linux esbuild/rollup 到 /tmp、用 `ESBUILD_BINARY_PATH`/`NODE_PATH` 指 worktree 的 node_modules 跑 build；typecheck/纯 node check 直接能跑。

> 改这 3 个 prompt 是无人值守 + 上生产那一环。`check-branch`（#138）已是护栏：万一某条改漏导致落错分支，门会红、夜间 verify 也会拦——但仍请逐条改、改完各自 dry-run 再开启用。

## 5. 回滚

`git worktree remove .worktrees/weekend`（Mac 本机）+ 把 3 任务 prompt 改回 → 回到方案 A（纯共享树分支隔离）。分支 `auto/weekend` 与内容都在 object store·无数据风险。`check-branch` 门可独立保留（与 A/B 都兼容）。

## 6. 与 quirk #130 的 feat-worktree 区别

#130 的并行 feat worktree＝**临时·兄弟目录** `../Blue-<t>`（作者本机开发两个 feature·绿了 merge 回 main 即 `worktree remove`）。本文的周末 worktree＝**常驻·mount 内** `.worktrees/weekend`（无人值守自动化长期钉 auto/weekend·sandbox 要可见）。两者都用 `git worktree`，但生命周期、位置、可见性诉求不同——别混用。
