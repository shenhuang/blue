下个 session 的 prompt — 低强度内容收尾（伏笔层已满，剩深段感官变体/打磨）或 深水区 vision 正式开建（B 路现已是主线）
直接把下面（含本行以下全部）粘进新 session 即可。

你在接手「深海回响」(Deep Echo) —— 潜水题材文字冒险 Roguelike（Vite + React + TS），仓库在 `~/Desktop/Blue`。

**重要里程碑**：基建+地图 revamp 三支柱（材料经济 / 多灯塔基地 / 海图）**已全部闭环**（Phase A/B/C 提交）。之后**五轮 2026-06-02 内容 pass**把内容层做厚到一个自然的收束点：① reef 浅段 fresh-wrongness + 第二只敌人石斑鱼 + 深段 realistic（#53）；② 墓园浅段 fresh-wrongness，**首次把内容当 deep-game vision 伏笔层写**、定『叙述永不交底』铁律（#54）；③ 深水伏笔 **中段 25-44m**（#55）；④ **realistic 探索密度收尾**（#56，作者选「内容收尾·realistic 密度」）；⑤ 深水伏笔 **深段 45-60m**（#57，续「ok next」自动续做）。**现状：3 个 zone 各 2 敌人，各自 realistic/uncanny/cosmic + 浅/中/深 tone 全齐；realistic 密度收尾；且两条 apex 母题的『越深越欺骗』伏笔层浅/中/深三级全部成型——mimic 假信标 `the_glow`(中)→`cave.false_beacon`(深)、corpse-wearer `the_other`(浅)→`no_bubbles`(中)→`the_wearer`(深)。** 内容层到了一个高度饱和的收束点：**低强度只剩零星打磨（深段不同感官变体），真正的「下一件大事」是 B 路 deep-game vision 正式开建。**

先 onboarding（按顺序）

1. 读 `docs/STATUS.md`：开头滚动进度（最近五条是 06-02 五次内容 pass）+ §3（系统/文件）+ §6 quirks。**最相关 quirk**：#57（深水伏笔深段 + **深段只 cave/wreck 两 tag 可用的约束**，最新）、#55（中段伏笔 + 一 zone 一母题）、#54（墓园浅段 + **写法铁律「叙述永不交底」**）、#53（reef 浅段 + 石斑鱼 territorial）、#56（realistic 密度收尾 + recon 方法）、#19/#44/#47（tag 隔离 + loot 按 zone）、#43/#49（baseline statsDelta 实跑、sanity 双分支 / stamina 仅 success）。
2. **读自动记忆 [Deep Game Vision]（deep_game_vision.md）——灯塔/深水区的「最终预期」北极星，作者 2026-06-02 口述定调。** 越深越欺骗的信任梯度（浅=真 / 中=看不见 opacity / 深=看错 deception）+ 灯塔=信息基建（clarity 涌现≈光−深度）+ 供给点靠跨 run 复杂事件解锁 + 伪装成灯塔的安康鱼 mimic（海图「无灯之光」假 POI，接 d_reveal）+ 穿尸体引诱 + **生存铁律：可生存但要够强+读出 tell、代价巨大、无脚本死**。**伏笔层现已浅/中/深三级全部埋好**（见该记忆里已更新的 #57 标注）——B 路真开建时，mimic + corpse-wearer 的 capstone 有现成母题/tell 可回收。其它记忆：[Weekend Content Log]、[Base+Map Revamp]、[Scenario Framework]、[Sandbox Git Commit]。
3. 跑 `npm run typecheck` + 全部回归确认起点干净（见「回归文化」）。

基线：五次内容 pass 已提交（git log 最新几条）。当前内容：**81 事件 / 7 敌人 / 8 combat / 22 item / 75 event baseline / 9 combat baseline**；3 random zone（旧灯塔礁 reef / 蓝洞群 cave / 沉船墓园 wreck，各 2 敌）+ 教学东礁。

---

## 两条路，按作者意愿挑（内容层已饱和，天平开始偏向 B）

### A. 低强度内容打磨（仍可无人值守，但回报递减）
明显 tone 缺口、realistic 密度、浅/中/深三级伏笔**都已收尾**。剩下的低强度内容不多，做前务必先 recon 确认是真缺口（`event-runner --list --zone-tag {reef,cave,wreck}` 按 tone+depth 数）：
1. **深段不同感官变体**：深段 apex 母题（false_beacon 视觉假光 / the_wearer 拟人）已落，可补 vision「欺骗 register」里的其它感官——`会合拢的出口` / `从错误方向回来的自己的气泡` / `假的 rest/气穴节点`（deep_game_vision 列的 register）。仍 cosmic·loot-free·叙述永不交底·不触发 d_reveal·**深段只 cave/wreck 两 tag**（#57）。
2. **别再加敌人**（各 zone 已 2 只）、**别再堆 realistic**（#56 已饱和）、**别擅自触发 d_reveal**（#42，存档级不可逆，留给在场作者/B 路 capstone）。

### B. 深水区 vision 正式开建（现已是主线，要作者在场拍机制）
[Deep Game Vision] 是方向，机制留白。**伏笔层已全部就位，groundwork 不再是阻塞**。按依赖顺序（每步一个 session）：
1. **opacity 层**（地基）：把节点预览「清晰度」做成 `f(深度, 自家灯塔光照)`——浅处能预读、越深越盲、灯塔网买回可见度。已有地基：`visibility: dark` 让 NodeSelectView 盲航遮预览（#27/#41）+ 尸体提示按打捞 Lv.1 门控（#36）。需从「单 POI 的 dark」泛化成「深度驱动 + 灯塔光照偏移」的统一 clarity。
2. **跨 run 供给解锁**：把 `lighthouse.ruin_north`（一次性付账单修复）扩成**多阶段、跨 run 持久**的前哨（新增持久化 per-ruin 进度字段 + 事件链）。
3. **mimic + 欺骗 register + d_reveal**（capstone）：伪装成灯塔的安康鱼＝海图上「没有自家灯塔能解释的点亮 POI」；穿尸体引诱；接 `flag.d_reveal`。**必须在 1、2 就位后做。** 可回收的伏笔已齐：mimic＝`bluecaves.the_glow`(中)/`cave.false_beacon`(深)/`lore.deep_water.{cold_light,the_window,the_false_beacon}`；corpse-wearer＝`wreck_graveyard.{the_other,no_bubbles,the_wearer}`（浅/中/深，tell 逐级加重）。这是唯一允许打破「敌人别太多」的 apex 例外，多半住新的最深 zone。
**开建前先和作者确认机制细节**（clarity 是涌现还是资源、zone 是长出来还是新开、mimic 第一次遭遇怎么演、tell 怎么和 sanity 腐蚀耦合——作者已定调「可生存有代价、无脚本死，低理智会腐蚀读 tell 的能力」）。

---

## 关键约束 / 易踩坑（沿用）

* **回归文化（#22/#26）**：收尾全绿——`npm run typecheck` + 全部 playthrough（`playthrough` / `-combat` / `-corpse` / `-decay` / `-upgrades` / `-economy` / `-bluecaves` / `-wreckyard` / `-chart` / `-lighthouse` / `-lighthouse-scenarios` / `-save`）+ `-scenarios` + `-combat-scenarios` + `-mapgen-scenarios` + `verify-tutorial` + `smoke-chart-ui.tsx`（是 `.tsx`）。`playthrough.ts` ~12% RNG flake（#18），挂了重试。
* **深段 tag 约束（#57，写深段内容必读）**：reef zone 45m+ 段 tag=`[wreck,cave]`（#47），**`[reef]` 事件在 45m+ 根本不出现**——深段（45-60m）只有 cave / wreck 两个 tag 可用，reef-only 母题（如『拉力』）下不到深段。深段 `cave.*` 掉天然物 / `wreck.*` 掉人造物或 loot-free（#44/#47）。`cave.*` 跨 zone 深段事件写在 reef.json（紧邻 cave.blue_floor 簇），`wreck_graveyard.*` 写在 wreck_graveyard.json。
* **深水写法铁律（#54/#55/#57 沿用）**：深水 / cosmic / 伏笔事件叙述**永不交底**——既给平淡解释又留错的读法，两种叠着，不确认也不否认。范例：`cave.false_beacon`『是你自己的头灯散在盐雾上……道理都对』/ `wreck_graveyard.the_wearer`『一具挂断缆的旧尸被深流摆着……你挑不出哪个更真』/ `reef.no_bottom`『是下降流……你还是没敢多看第二眼』。（realistic 事件相反：grounded、无错读，只有劳作/腐朽/资源取舍。）
* **一 zone/tag 一母题 + recon 方法（#55/#56/#57）**：补内容前先 `event-runner --list --zone-tag {reef,cave,wreck}` 按 tone+depth 数覆盖找真缺口（lighthouse-reef 池报告已被 #53 填平、不再是薄段信号）。每个母题落在最适合的 zone/tag，别堆同一处。
* **tag/loot 隔离（#19/#44/#47）**：`[shallow,reef]`→只灯塔礁 0-25m；`[reef]`→灯塔礁 0-44m（45m+ 不出现）；`[wreck]`→墓园+灯塔礁 25m+（人造物）；`[cave]`→蓝洞+灯塔礁 45m+（天然物）。伏笔/cosmic 事件 loot-free 最干净。
* **baseline（#43/#49）**：statsDelta 必 `event-runner --out json` 实跑抄；sanity check 双分支（success 默认 sanity 100→0.95 必过 + 断言 `loreAdded`；fail 设 `stats.sanity ≤dc-30` 撞 0.05 clamp、起步别低到减完触 0 底，如 vs55→起步 22 落 9/10）；低 dc stamina check 只锁 success。baseline JSON 放 `scenarios/` 根，命名 `<eventid 下划线>__<variant>.json`。
* **沙箱 git 提交**：见 [Sandbox Git Commit]——mount 能 create/rename、不能 unlink。**用 `git add src scenarios docs`（别 `-A`，根目录 `CLAUDE.md` 是 Cowork 配置、一直 untracked、别提交）**；残留锁（`tmp_obj_*` + `HEAD.lock`）`find .git/objects -name 'tmp_obj_*'` + HEAD.lock 一把 `mv` 进 `.git/.sandbox-junk/`（别 `rm`）；`git config gc.auto 0`；核对只用 `git --no-optional-locks status/log`；收尾保证 `.git/{index,HEAD}.lock` 不在。验构建用 `npx vite build --outDir $(mktemp -d) --emptyOutDir`。
* **UI smoke（#29/#41）**：纯加事件 JSON 不碰 UI，一般不用动 smoke；改 SeaChartView/任何 UI 数据路径才补 `smoke-chart-ui.tsx`。**B 路 opacity 层会碰 NodeSelectView/SeaChartView 的数据路径，务必补 smoke 渲染断言。**

## 收尾

更新 `docs/STATUS.md`（滚动进度 + §3 + §6 新 quirk）、自动记忆（[Weekend Content Log] 进度 + MEMORY.md 索引；**B 路动了 vision 必同步 [Deep Game Vision]**）、把本文件改写成再下一个 session 的 prompt，并按 [Sandbox Git Commit] 提交。
