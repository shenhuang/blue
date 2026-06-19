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

### 3.1 相对路径指针（关键·`setup-weekend-worktree.mjs` 已自动）

Cowork 每个 session 在沙箱把 Blue 挂到**不同**绝对路径（`/sessions/<session-id>/mnt/Blue`），而 `git worktree add` 默认把**绝对**路径写进 `.worktrees/weekend/.git` 和 `.git/worktrees/weekend/gitdir` → 换个 session / 沙箱就解析不到、worktree 里跑 git 直接 `fatal: not a git repository`。`setup-weekend-worktree.mjs` 已自动把这两个指针改成**相对**路径（`gitdir: ../../.git/worktrees/weekend` 与 `../../../.worktrees/weekend/.git`）→ Mac + 任意 Cowork 沙箱都解析得通。**红线**：旧 git（含沙箱 git 2.34；相对反向 gitdir 是 git 2.48 才支持）会把相对指针误判成「指向不存在位置」→ `git worktree prune` 会**误删**这棵 worktree。所以 **绝不在沙箱 / 旧 git 里 `git worktree prune`**（周末/夜间流程 `gc.auto 0`·不自动 prune·安全；作者 Mac 现代 git 一切正常）。手工修复某棵 worktree 的绝对指针＝把上述两文件写成相对即可。

## 4. 自动化 3 任务接入（**作者改 prompt·每步确认·提案 §6**）

3 个任务的 prompt 在 app 内部目录 `~/Claude/Scheduled/<id>/SKILL.md`（Cowork 的 Edit 工具够不到·`update_scheduled_task` 只能整段替换）。改法＝在每个 prompt **最前面粘贴**下面对应的「覆盖块」（盖掉旧的 `git checkout auto/weekend` / `branch -f` 逻辑·其余正文一字不动·worktree 缺失时正文旧逻辑自动兜底）。3 个都停着·改完逐个 enable 前各自 dry-run 一次。

**通用原理**：weekend 内容由 worktree（永久钉 auto/weekend）承载、主树恒在 main → 不再 `checkout auto/weekend`（它被 worktree 占用·checkout 会失败）、不再翻 HEAD。提交套路（`gc.auto 0` / 显式单文件 `git add` / `mv` 收容锁 / 不 push）不变；沙箱 build 仍按 `blue-regress-sandbox` 记忆装 Linux esbuild/rollup 到 /tmp、`ESBUILD_BINARY_PATH`/`NODE_PATH` 指 worktree node_modules（typecheck / 纯 node check 直接能跑）。

### 4a. `deep-echo-weekend-content` 与 `deep-echo-weekend-poi`（粘在 prompt 最前）

> 【方案 B 工作树·最优先·覆盖下方旧 `git checkout` 分支步骤·quirk #138】本任务在周末专属 worktree 里跑、与交互 session 的 main 树物理隔离（各自独立 HEAD/index）——消除「被并发翻分支落错 main」（2026-06-19 那次）和「撞 `.git/index.lock`」。做法：起手 `cd <你的 Blue 挂载路径>/.worktrees/weekend`（永久钉 `auto/weekend`·自带 `.blue-writer=weekend`·分支门放行），确认 `git --no-optional-locks rev-parse --abbrev-ref HEAD` ＝ `auto/weekend`，**直接在此干活 + commit，跳过下方所有 `git checkout auto/weekend`**（无需切分支·无 HEAD 翻动）。**绝不在沙箱 `git worktree prune`**（旧 git 会误删·§3.1）。worktree 缺失才回落正文旧逻辑，或回主树根 `npm run weekend:worktree` 重建（作者 Mac 本机·沙箱会硬停）。

### 4b. `nightly-blue-verify-publish`（粘在 STEPS / step 2 之前）

> 【方案 B 工作树·覆盖 step 2 的 checkout + ref-move 合并法·quirk #138】若 `.worktrees/weekend` 存在（weekend 内容由它承载·主树恒在 main），step 2「WEEKEND MERGE」改为：**(a)** 不再 `git checkout auto/weekend`（它被 worktree 占用·checkout 必失败）；要在分支上验证就 `cd <Blue>/.worktrees/weekend`（设 `BLUE_WRITER=nightly` 跳过分支门）跑 step 3 的 gate。**(b)** 需把 main 的新 commit 带进分支时，在 worktree 里 `git rebase main`（冲突→`git rebase --abort` + 报告「needs manual merge」+ 不动 main）。**(c)** GREEN 合并**取代** `git branch -f main auto/weekend && git checkout main`（main 在主树被 checkout·`branch -f` 会被拒）——回主树（恒在 main）确认 `git merge-base --is-ancestor main auto/weekend` 为真后跑 `git merge --ff-only auto/weekend`（只加文件·沙箱安全·非 force·把 worktree 攒的 weekend 内容快进进 main）。其余（`.deploy-token` token push / 不 force / never ship from auto/weekend / 只在真有改动才发布 / 刷 tracking ref 防幻影 ahead）全不变。**绝不在沙箱 `git worktree prune`**（§3.1）。

> 改这 3 个 prompt 是无人值守 + 上生产那一环。`check-branch`（#138）已是护栏：万一某条改漏导致落错分支，门会红、夜间 verify 也会拦——但仍请逐条改、改完各自 dry-run 再开启用。

## 5. 回滚

`git worktree remove .worktrees/weekend`（Mac 本机）+ 把 3 任务 prompt 改回 → 回到方案 A（纯共享树分支隔离）。分支 `auto/weekend` 与内容都在 object store·无数据风险。`check-branch` 门可独立保留（与 A/B 都兼容）。

## 6. 与 quirk #130 的 feat-worktree 区别

#130 的并行 feat worktree＝**临时·兄弟目录** `../Blue-<t>`（作者本机开发两个 feature·绿了 merge 回 main 即 `worktree remove`）。本文的周末 worktree＝**常驻·mount 内** `.worktrees/weekend`（无人值守自动化长期钉 auto/weekend·sandbox 要可见）。两者都用 `git worktree`，但生命周期、位置、可见性诉求不同——别混用。
