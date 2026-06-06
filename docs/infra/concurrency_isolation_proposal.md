# 提案：三写手并发隔离（周末 / 夜间 / 交互 → 分支 / worktree）

> 状态：**仅设计·本 session（基建治理 #94）不实装**。触及两个定时任务 SKILL（周末内容引擎 + 夜间 verify/publish）+ 提交流程 → **必须作者确认后才动手**。本 session 只产出本 `docs/` 提案。
> 关联：沙箱提交约束见自动记忆 `[[sandbox-git-commit]]`；GitHub Pages 发布见 `[[github-pages-deploy]]`；`dive.ts` 拆分把本提案列为前置（见 [`dive_ts_split_proposal.md`](dive_ts_split_proposal.md)）。

## 1. 现状与问题

三个写手都直接 commit 到**同一条裸 `main`**，协调全靠 `[[sandbox-git-commit]]` 里的散文约定：

- **交互 session**（人在场，本类 session）。
- **周末内容引擎**（无人值守·周六日 6–18 点每 2h 一跑·改 `src/data/events/*.json` + `scenarios/` + `STATUS.md`）。
- **夜间 verify/publish**（约 19:30·verify 全绿后把本地积压 commit fast-forward push 到 `origin/main`）。

并发摩擦（均有实据，记在 `[[sandbox-git-commit]]`）：

- **「夜间漂移」**：交互 session 起手 `git log` 看到的 HEAD，常已被夜间/周末任务又推进一两个 commit → 交接 prompt 手抄的 HEAD 失真（本次 #94 已用 `npm run handoff`〔quirk #96〕把「定位」机制化，缓解但未根治写冲突）。
- **未提交内容撞 stage**：周末引擎在交互 session 中途留下 uncommitted 的 event JSON / scenarios / `STATUS.md` 改动 → 交互 session 必须 `git --no-optional-locks status` 看清、**逐个文件 `git add`**（不能 `git add src`/`git add docs`/`-A`，否则把引擎的半成品卷进自己的 commit）。这是反复出现的认知负担（#84/#85/#88 都踩过）。
- **`STATUS.md` 是争用热点**：周末引擎和交互 session 都写它顶部 → 谁先谁后要小心（#84 曾「STATUS 故意没动·留给周末引擎」）。

**根因**：隔离靠人读散文维持，不是机制。本提案把它做成 git 层的物理隔离。

## 2. 与沙箱「不能 unlink」约束的共存（关键可行性）

Linux 沙箱对挂载的 `.git/` **能 create / 能 rename（含覆盖）、只不能 unlink**（`[[sandbox-git-commit]]` 已探针证实）。推论：

- **分支操作走得通**：`git branch` / `git checkout <branch>` / `git merge --ff-only` 都靠 write-then-rename 落 ref，不依赖 unlink。切分支重写工作树文件＝覆盖式 rename，沙箱可做（和 commit 同理）。
- **worktree 也走得通但更脏**：`git worktree add` 会建 `.git/worktrees/<id>/`（含 `HEAD`/`index`/锁文件），删 worktree 要 unlink 那些文件 → 沙箱删不掉，得沿用 `mv 进 .git/.sandbox-junk/` 的收容套路；`git worktree prune` 也可能留锁。**worktree 的 lock 清理负担 > 纯分支方案**。
- 任何方案都仍受「commit 后 `mv` 收容 `HEAD.lock` + `tmp_obj_*`、只用 `--no-optional-locks` 核对」约束——隔离不改这套，只改「写到哪条 ref」。

## 3. 方案

### 方案 A（推荐·先做这步）：周末引擎独立分支 + 夜间合并

- **周末内容引擎** commit 到专用分支 `auto/weekend`（无人值守内容只落这条·不碰 `main`）。
- **夜间任务** verify 全绿后：`git merge --ff-only auto/weekend`（或 no-ff merge）进 `main` → 再 push `origin/main`。verify 红则不合并、留分支待查。
- **交互 session** 仍在 `main`：起手 `npm run handoff`（#96）定位；自己的 commit 落 `main`。
- **收益**：交互 session 的工作树不再混入周末引擎的 uncommitted 半成品（引擎在自己分支上自管），`git add src/docs` 重新变安全，`STATUS.md` 争用消除（周末引擎写自己分支的 STATUS、夜间合并时统一）。

**为什么先做 A 而非 worktree**：A 只动「commit 到哪条分支」+「夜间多一步 merge」，零额外 lock 清理负担（§2）；风险面小、可快速回滚（删分支即回到今天的单 main 行为）。

### 方案 B（后续增强·可选）：周末引擎独立 worktree

- 给周末引擎一个独立 worktree（如 `~/Desktop/Blue-weekend` 挂 `auto/weekend`），**物理隔离工作树** → 交互 session 与引擎连「同一份工作目录文件」都不共享，彻底消除工作树级争用。
- 代价：worktree 的 `.git/worktrees/<id>/` 锁文件得纳入 `mv 收容` 套路（§2）；初次搭建 + 文档化成本。建议 A 跑顺后再评估是否需要 B。

## 4. 迁移步骤（方案 A·待作者确认后执行）

1. `git branch auto/weekend`（从当前 `main`）。
2. **改周末内容引擎 SKILL**：把它的提交目标从 `main` 改成 `auto/weekend`（commit 前 `git checkout auto/weekend`；沙箱 checkout 可行·§2）；其余提交套路（`gc.auto 0` / 显式 `git add` / `mv` 收容锁）不变。
3. **改夜间 verify/publish SKILL**：verify 步骤后加「`git checkout main && git merge --ff-only auto/weekend`」；push 逻辑不变（仍 `.deploy-token` 显式 URL fast-forward·见 `[[github-pages-deploy]]`）。冲突或非 ff → 报告里标红、人工介入，**不 force**。
4. 文档化：`[[sandbox-git-commit]]` 加一条「周末引擎在 `auto/weekend`、夜间合并」；`CLAUDE.md` 起手约定提一句「交互 session 在 `main`、`npm run handoff` 看是否有待合并的 `auto/weekend`」。

## 5. 回滚

- 删 `auto/weekend` + 把两个 SKILL 改回提交 `main` → 完全回到今天的单分支行为。无数据风险（分支只是 ref·内容已在 object store）。

## 6. 风险

- **触及两个定时任务 SKILL**＝无人值守 + 上生产那一环，改错会让周末内容不落地或夜间发布断链 → **必须作者逐步确认**，本 session 不碰。
- 夜间 `--ff-only` 失败的情形（交互 session 在 `main` 上提了与 `auto/weekend` 分叉的 commit）需要明确的人工合并策略（rebase `auto/weekend` 到 `main` 再 ff·或 no-ff merge）——在改 SKILL 时一并定义。
- worktree（方案 B）的 lock 清理若没文档化，会给作者留一堆删不掉的 `.git/worktrees/**` turd——所以 B 先缓、A 优先。

## 7. 本 session 结论

**只产出本提案。** 不改 SKILL、不改提交流程、不建分支/worktree。下一步：作者过本提案 → 若采纳方案 A，按 §4 分步改两个 SKILL（每步确认）。
