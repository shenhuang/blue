下个 session 的 prompt — 内容收尾（realistic 密度 / 深水伏笔）或 深水区 vision 正式开建
直接把下面（含本行以下全部）粘进新 session 即可。

你在接手「深海回响」(Deep Echo) —— 潜水题材文字冒险 Roguelike（Vite + React + TS），仓库在 `~/Desktop/Blue`。

**重要里程碑**：基建+地图 revamp 三支柱（材料经济 / 多灯塔基地 / 海图）**已全部闭环**（Phase A/B/C 提交）。之后两轮 **2026-06-02 内容 pass**：① reef 浅段 fresh-wrongness + reef 第二只敌人石斑鱼 + 深段 realistic（quirk #53）；② 沉船墓园浅段 fresh-wrongness（quirk #54，**首次把内容当作 deep-game vision 的「伏笔层」来写**）。**现状：3 个 zone 各 2 敌人、各自 realistic/uncanny/cosmic + 浅/中/深 tone 基本齐——内容补缺的「明显缺口」阶段基本收尾。** 下一步要么是低强度内容收尾，要么是开始建那个更大的东西（见下）。

先 onboarding（按顺序）

1. 读 `docs/STATUS.md`：开头滚动进度（最近两条是 06-02 两次内容 pass）+ §3（系统/文件）+ §6 quirks。**最相关 quirk**：#54（墓园浅段 + **深水写法铁律「叙述永不交底」**，最新）、#53（reef 浅段 fresh-wrongness + 石斑鱼 territorial 生态位）、#19/#44/#47（tag 隔离 + loot 按 zone）、#43/#49（baseline statsDelta 实跑、sanity 双分支 / stamina 仅 success）。
2. **读自动记忆 [Deep Game Vision]（deep_game_vision.md）——这是灯塔/深水区的「最终预期」北极星，作者 2026-06-02 口述定调。** 越深越欺骗的信任梯度（浅=真 / 中=看不见 / 深=看错）+ 灯塔=信息基建（clarity 涌现≈光−深度）+ 供给点靠跨 run 复杂事件解锁 + 伪装成灯塔的安康鱼 mimic（海图上「无灯之光」的假 POI，接 d_reveal）+ 穿尸体引诱 + **生存铁律：可生存但要够强+读出 tell、代价巨大、无脚本死**。reef/墓园浅段的 fresh-wrongness 事件已是它的伏笔。其它记忆：[Weekend Content Log]、[Base+Map Revamp]、[Scenario Framework]、[Sandbox Git Commit]。
3. 跑 `npm run typecheck` + 全部回归确认起点干净（见「回归文化」）。

基线：两次内容 pass 已提交（git log 最新两条）。当前内容：**73 事件 / 7 敌人 / 8 combat / 22 item / 62 event baseline / 9 combat baseline**；3 random zone（旧灯塔礁 reef / 蓝洞群 cave / 沉船墓园 wreck，各 2 敌）+ 教学东礁。

---

## 两条路，按作者意愿挑

### A. 低强度内容收尾（默认安全，无人值守 pass 也能做）
明显的 tone 缺口已补完，剩下的是密度和伏笔：
1. **各段 realistic 探索密度**：`node scripts/verify-tutorial.mjs` 的「旧灯塔礁事件池」报告是薄段信号；蓝洞/墓园用 `event-runner --list --zone-tag` 自己数。补 realistic 质感事件，单 zone tag（#19）、loot 守 #44/#47。
2. **继续铺深水伏笔**（承 quirk #54）：把「不信任自己的眼睛 / 深处的拉力 / 无灯之光 / 穿尸体的东西」母题，往 reef/cave/wreck 的**中段**（25-44m）再铺几个 uncanny/cosmic——都遵守**「叙述永不交底」铁律**（既给平淡解释又留错的读法，两种叠着，不触发 d_reveal）。
**这条路务必守：不加敌人（各 zone 已 2 只）、优先事件。**

### B. 深水区 vision 正式开建（更大、要作者在场拍机制）
[Deep Game Vision] 是方向，机制留白。真要开建，按依赖顺序（每步一个 session）：
1. **opacity 层**（地基）：把节点预览的「清晰度」做成 `f(深度, 自家灯塔光照)`——浅处能预读前方、越深越盲，灯塔网把可见度买回来。已有地基：`visibility: dark` 让 NodeSelectView 盲航遮预览（quirk #27/#41）+ 尸体提示按打捞 Lv.1 门控（quirk #36）。需把它从「单 POI 的 dark」泛化成「深度驱动 + 灯塔光照偏移」的统一 clarity。
2. **跨 run 供给解锁**：把 `lighthouse.ruin_north`（一次性付账单修复）扩成**多阶段、跨 run 持久**的前哨（需新增持久化 per-ruin 进度字段 + 事件链）。
3. **mimic + 欺骗 register + d_reveal**（capstone / 最深层）：伪装成灯塔的安康鱼＝海图上一个「没有自家灯塔能解释的点亮 POI」；穿尸体的引诱；接 `flag.d_reveal`。**必须在 1、2 就位后做，否则假光没有「真」可以撒谎。** 这是唯一允许打破「敌人别太多」的 apex 例外，多半住新的最深 zone。
**开建前先和作者确认机制细节**（clarity 是涌现还是资源、zone 是长出来还是新开、mimic 第一次遭遇怎么演——作者已定调「可生存有代价、无脚本死」）。

---

## 关键约束 / 易踩坑（沿用）

* **回归文化（#22/#26）**：收尾全绿——`npm run typecheck` + 全部 playthrough（`playthrough` / `-combat` / `-corpse` / `-decay` / `-upgrades` / `-economy` / `-bluecaves` / `-wreckyard` / `-chart` / `-lighthouse` / `-lighthouse-scenarios` / `-save`）+ `-scenarios` + `-combat-scenarios` + `-mapgen-scenarios` + `verify-tutorial` + `smoke-chart-ui.tsx`（是 `.tsx`）。`playthrough.ts` ~12% RNG flake（#18），挂了重试。
* **深水写法铁律（#54）**：深水 / cosmic / 伏笔事件叙述**永不交底**——既给平淡解释又留错的读法，两种叠着，不确认也不否认。`reef.sun_net`『你告诉自己是云』/ `wreck_graveyard.the_other`『像你的光弹回来的影』是范例。
* **tag/loot 隔离（#19/#44/#47）**：`[shallow,reef]`→只灯塔礁 0-25m；`[reef]`→灯塔礁 0-44m；`[wreck]`→墓园+灯塔礁 25m+（掉人造物）；`[cave]`→蓝洞+灯塔礁 45m+（掉天然物）。
* **baseline（#43/#49）**：statsDelta 必 `event-runner --out json` 实跑抄；sanity check 可双分支（fail 起步 sanity≤dc-30 撞 0.05 clamp、别触 0 底）；低 dc stamina check 只锁 success。
* **沙箱 git 提交**：见 [Sandbox Git Commit]——mount 能 create/rename、不能 unlink。**用 `git add src scenarios docs`（别 `-A`，根目录 `CLAUDE.md` 是 Cowork 配置、一直 untracked、别提交）**；残留锁 `mv` 进 `.git/.sandbox-junk/`（别 `rm`）；`git config gc.auto 0`；核对只用 `git --no-optional-locks status/log`；收尾保证 `.git/{index,HEAD}.lock` 不在。验构建用 `npx vite build --outDir /tmp/xxx --emptyOutDir`。
* **UI smoke（#29/#41）**：纯加事件 JSON 不碰 UI，一般不用动 smoke；改 SeaChartView/任何 UI 数据路径才补 `smoke-chart-ui.tsx`。

## 收尾

更新 `docs/STATUS.md`（滚动进度 + §3 + §6 新 quirk）、自动记忆（[Weekend Content Log] 进度 + MEMORY.md 索引；若动了 vision 同步 [Deep Game Vision]）、把本文件改写成再下一个 session 的 prompt，并按 [Sandbox Git Commit] 提交。
