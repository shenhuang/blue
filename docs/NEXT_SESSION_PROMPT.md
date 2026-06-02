下个 session 的 prompt — 深水区 vision 开建（已出 SPEC v0.1，Phase 0＝双传感器 clarity + 探测双刃）或 低强度内容打磨
直接把下面（含本行以下全部）粘进新 session 即可。

你在接手「深海回响」(Deep Echo) —— 潜水题材文字冒险 Roguelike（Vite + React + TS），仓库在 `~/Desktop/Blue`。

**重要里程碑**：基建+地图 revamp 三支柱（材料/灯塔/海图）**已闭环**；内容层经五轮 2026-06-02 pass 做到饱和收束（#53–#57，浅/中/深三级『越深越欺骗』伏笔 + realistic 密度全齐）；**深水区 vision 已正式开建 design 阶段——作者 2026-06-02 四点拍板，出 `docs/深海回响_深水区_SPEC.md`（v0.1）。** 这是当前主线。

**SPEC v0.1 的四点拍板（务必先读 SPEC 全文 + 自动记忆 [[deep-game-vision]]）**：
1. **clarity = 双层 + 双传感器**：宏观（海图）灯塔/前哨信息网 + 微观（下潜）潜水员自带装备——**近距靠灯、远距靠声呐 ping，关灯/关声呐＝致盲但降 signature、让捕食者更难发现你**（主动感知双刃＝新核心张力）。
2. **递归纵深大地图**：既有 zone 更深 band → 终端 zone → 超深海沟 → 深渊，**永远有比最深更深的**，图刻意很大；靠跨 run 建灯/声呐网向下延保持可达。
3. **mimic 首次＝海图假 POI（无灯之光）引诱 → 入潜兑现（both）**。
4. **tell ↔ sanity＝模糊 + 检定更难（both）**。

先 onboarding（按顺序）

1. **读 `docs/深海回响_深水区_SPEC.md`（v0.1，全文）**——本主线的设计源真。§3 架构 / §4 与现有代码接点 / §5 分阶段 / §6 数据类型草案 / §7 **待作者复核的子决策（带提案）** / §9 守则。
2. **读自动记忆 [[deep-game-vision]]**（已按四点拍板更新）——北极星基调；SPEC 是它的落地。
3. 读 `docs/STATUS.md`：滚动进度（最近五条 06-02 内容 pass）+ §3 系统 + §6 quirks。**最相关 quirk**：#52（Phase C 灯塔 reveal/reach＝宏观 clarity 地基）、#27/#41（`visibility:dark` 盲航＝微观 clarity 地基）、#36（尸体提示按打捞 Lv.1 门控）、#30/#49（mapgen depthOffset＝深度轴地基）、#39（存档迁移）、#42（d_reveal 钩子）、#57/#55/#54（伏笔层 + 写法铁律）。
4. 跑 `npm run typecheck` + 全部回归确认起点干净（见 SPEC §9 / 「回归文化」）。

基线：五次内容 pass 已提交（git log）。当前内容：**81 事件 / 7 敌人 / 8 combat / 22 item / 75 event baseline / 9 combat baseline**；3 random zone + 教学东礁。SPEC 是 docs 提交（86c6f59 之后那条）。

---

## 主线：深水区 vision 分阶段开建（SPEC §5，依赖顺序，每步一 session、每步全绿）

**先确认 SPEC §7 的子决策**（灯塔↔声呐是否同网 / 声呐主动 ping vs 持续 / 被探测后果 / 深度单位 / 是否只深水吃重 / 递归纵深的每层小目标）——这些会改 Phase 0/1 怎么建。作者若已在上一轮答了，照答的来；没答先问（用 AskUserQuestion）。

- **Phase 0（下一步）— 微观双传感器 clarity + 探测双刃**：把 `visibility:dark` 泛化成 `clarity(灯/声呐/静默, 节点距离, 深度)` 统一预览/tell 门控；新增 signature → 捕食者探测/接近模型。**可拆 0a（clarity 三态+预览，纯感知）/ 0b（探测/隐身，碰 combat 遭遇）**。触 `dive.ts`/`NodeSelectView`/新 run `sensors` 状态/`combat.ts`——**碰 UI 数据路径必补 smoke（#29/#41）**。
- Phase 1 — 可扩展纵向深度轴（band 数据化、去 60m 上限）。
- Phase 2 — 跨 run 供给前哨＝深度门 + clarity 网络下延（多阶段持久 per-ruin 进度，扩 `lighthouse.ruin_north`；SAVE_VERSION bump）。
- Phase 3 — mimic capstone（海图假 POI→入潜、tell↔sanity both、corpse-wearer、d_reveal）+ **「另一个世界」**（低 san 解锁、亦真亦假，SPEC §3.7——理智＝双向门，低 san 是进那一侧的钥匙）。**必须 0–2 就位后做；演出＝与作者一起一个个敲定的专门 session，不预先写死。**

## 备选：低强度内容打磨（无人值守也能做，但回报递减）
内容层已饱和（浅/中/深伏笔 + realistic 密度全齐）。只剩零星：深段欺骗 register 的**其它感官变体**（会合拢的出口 / 错误方向回来的气泡 / 假 rest 节点，SPEC §3.5/[[deep-game-vision]] 列）。守：深段只 cave/wreck 两 tag（#57）、cosmic/loot-free/叙述永不交底/不触发 d_reveal、**别加敌人**、**别堆 realistic**（#56 已饱和）、**别擅自触发 d_reveal**（#42，留 capstone）。

---

## 关键约束 / 易踩坑（沿用，SPEC §9 有完整版）

* **回归文化（#22/#26）**：每阶段收尾全绿——`npm run typecheck` + 全部 playthrough（`playthrough`/`-combat`/`-corpse`/`-decay`/`-upgrades`/`-economy`/`-bluecaves`/`-wreckyard`/`-chart`/`-lighthouse`/`-lighthouse-scenarios`/`-save`）+ `-scenarios` + `-combat-scenarios` + `-mapgen-scenarios` + `verify-tutorial` + `smoke-chart-ui.tsx` + prod build（`npx vite build --outDir $(mktemp -d) --emptyOutDir`）。`playthrough.ts` ~12% flake（#18）挂了重试。
* **存档迁移（#39）**：动 GameState/profile 形状（Phase 0 加 run `sensors`、Phase 2 加 per-ruin 进度）必 bump `SAVE_VERSION` + `migrateSave` 加步 + `playthrough-save` 回归。
* **UI smoke（#29/#41）**：Phase 0/3 碰 NodeSelectView/SeaChartView 数据路径，必补 `smoke-chart-ui.tsx` SSR 渲染断言（承 quirk #38「只测引擎」盲区教训）。
* **深水写法铁律（#54/#55/#57）**：mimic/cosmic 文案叙述**永不交底**；**无脚本死**（可生存+读 tell 有代价）。
* **沙箱 git（[[sandbox-git-commit]]）**：`git add src scenarios docs`（别 `-A`，根 `CLAUDE.md` 一直 untracked、别提交）；残留锁 `find .git/objects -name 'tmp_obj_*'` + HEAD.lock `mv` 进 `.git/.sandbox-junk/`（别 `rm`）；`gc.auto 0`；核对只用 `git --no-optional-locks status/log`。

## 收尾

更新 `docs/STATUS.md`（滚动 + §3 + §6 新 quirk）、`docs/深海回响_深水区_SPEC.md`（勾掉已实装 Phase、补决策日志）、自动记忆（[[deep-game-vision]] + [[weekend-content-log]] 若动内容 + MEMORY.md 索引）、把本文件改写成再下一个 session 的 prompt，按 [[sandbox-git-commit]] 提交。
