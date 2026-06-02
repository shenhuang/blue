下个 session 的 prompt — 内容收尾（realistic 密度 / 深水伏笔续铺）或 深水区 vision 正式开建
直接把下面（含本行以下全部）粘进新 session 即可。

你在接手「深海回响」(Deep Echo) —— 潜水题材文字冒险 Roguelike（Vite + React + TS），仓库在 `~/Desktop/Blue`。

**重要里程碑**：基建+地图 revamp 三支柱（材料经济 / 多灯塔基地 / 海图）**已全部闭环**（Phase A/B/C 提交）。之后三轮 **2026-06-02 内容 pass**：① reef 浅段 fresh-wrongness + reef 第二只敌人石斑鱼 + 深段 realistic（quirk #53）；② 沉船墓园浅段 fresh-wrongness（quirk #54，**首次把内容当作 deep-game vision 的「伏笔层」来写**，定『叙述永不交底』写法铁律）；③ **深水伏笔 mid 层 25-44m**（quirk #55，**作者选「深水伏笔（中段）」**）：一 zone 一事件一母题——`reef.no_bottom`〈断口外空蓝的拉力·reef 首个非灯塔 cosmic-mid〉/ `bluecaves.the_glow`〈无灯之光·mimic 假信标伏笔〉/ `wreck_graveyard.no_bubbles`〈不呼吸的潜水员·corpse-wearer 伏笔+可读 tell〉。**现状：3 个 zone 各 2 敌人、各自 realistic/uncanny/cosmic + 浅/中/深 tone 齐，且浅→中两层「越深越欺骗」伏笔已成型——「明显缺口」阶段收尾。** 下一步要么是低强度内容收尾（realistic 密度 / 中段伏笔再铺 / 深段伏笔），要么是开始建那个更大的东西（见下）。

先 onboarding（按顺序）

1. 读 `docs/STATUS.md`：开头滚动进度（最近三条是 06-02 三次内容 pass）+ §3（系统/文件）+ §6 quirks。**最相关 quirk**：#55（深水伏笔 mid 层 + 一 zone 一母题的做法，最新）、#54（墓园浅段 + **深水写法铁律「叙述永不交底」**）、#53（reef 浅段 fresh-wrongness + 石斑鱼 territorial 生态位）、#19/#44/#47（tag 隔离 + loot 按 zone）、#43/#49（baseline statsDelta 实跑、sanity 双分支 / stamina 仅 success）。
2. **读自动记忆 [Deep Game Vision]（deep_game_vision.md）——这是灯塔/深水区的「最终预期」北极星，作者 2026-06-02 口述定调。** 越深越欺骗的信任梯度（浅=真 / 中=看不见 opacity / 深=看错 deception）+ 灯塔=信息基建（clarity 涌现≈光−深度）+ 供给点靠跨 run 复杂事件解锁 + 伪装成灯塔的安康鱼 mimic（海图上「无灯之光」的假 POI，接 d_reveal）+ 穿尸体引诱 + **生存铁律：可生存但要够强+读出 tell、代价巨大、无脚本死**。**reef/墓园浅段 + 三 zone 中段的 fresh-wrongness/伏笔事件已是它的伏笔层**（浅=已埋、中=已起首轮 #55，深段仍可续）。其它记忆：[Weekend Content Log]、[Base+Map Revamp]、[Scenario Framework]、[Sandbox Git Commit]。
3. 跑 `npm run typecheck` + 全部回归确认起点干净（见「回归文化」）。

基线：三次内容 pass 已提交（git log 最新几条）。当前内容：**76 事件 / 7 敌人 / 8 combat / 22 item / 68 event baseline / 9 combat baseline**；3 random zone（旧灯塔礁 reef / 蓝洞群 cave / 沉船墓园 wreck，各 2 敌）+ 教学东礁。

---

## 两条路，按作者意愿挑

### A. 低强度内容收尾（默认安全，无人值守 pass 也能做）
明显的 tone 缺口已补完，剩下的是密度和把伏笔层铺厚/铺深：
1. **各段 realistic 探索密度**：`node scripts/verify-tutorial.mjs` 的「旧灯塔礁事件池」报告是薄段信号；蓝洞/墓园用 `event-runner --list --zone-tag` 自己数。补 realistic 质感事件，单 zone tag（#19）、loot 守 #44/#47。
2. **深水伏笔续铺**（承 quirk #54/#55）：「不信任自己的眼睛 / 深处的拉力 / 无灯之光 / 穿尸体的东西」母题，中段（25-44m）已各起一个〔no_bottom/the_glow/no_bubbles〕——可在中段再铺几个不同感官的变体，或把母题推进到**深段（45-60m）**（深段现以 deep_water 冷光 + 各 zone cosmic 为主，可加几个直指 mimic/corpse-wearer 的更强伏笔，但仍**不触发 d_reveal**）。都遵守**「叙述永不交底」铁律**（既给平淡解释又留错的读法，两种叠着）。范例见 reef.no_bottom / bluecaves.the_glow / wreck_graveyard.no_bubbles。
**这条路务必守：不加敌人（各 zone 已 2 只）、优先事件 / lore。**

### B. 深水区 vision 正式开建（更大、要作者在场拍机制）
[Deep Game Vision] 是方向，机制留白。真要开建，按依赖顺序（每步一个 session）：
1. **opacity 层**（地基）：把节点预览的「清晰度」做成 `f(深度, 自家灯塔光照)`——浅处能预读前方、越深越盲，灯塔网把可见度买回来。已有地基：`visibility: dark` 让 NodeSelectView 盲航遮预览（quirk #27/#41）+ 尸体提示按打捞 Lv.1 门控（quirk #36）。需把它从「单 POI 的 dark」泛化成「深度驱动 + 灯塔光照偏移」的统一 clarity。
2. **跨 run 供给解锁**：把 `lighthouse.ruin_north`（一次性付账单修复）扩成**多阶段、跨 run 持久**的前哨（需新增持久化 per-ruin 进度字段 + 事件链）。
3. **mimic + 欺骗 register + d_reveal**（capstone / 最深层）：伪装成灯塔的安康鱼＝海图上一个「没有自家灯塔能解释的点亮 POI」；穿尸体的引诱；接 `flag.d_reveal`。**必须在 1、2 就位后做，否则假光没有「真」可以撒谎。** **伏笔已就位**：浅段 wreck.the_other / reef.sun_net 等 + 中段 bluecaves.the_glow〈无灯之光〉/ wreck_graveyard.no_bubbles〈不呼吸＝可读 tell〉/ reef.no_bottom〈深处拉力〉——mimic/corpse-wearer 真正登场时可回收这些母题与 tell。这是唯一允许打破「敌人别太多」的 apex 例外，多半住新的最深 zone。
**开建前先和作者确认机制细节**（clarity 是涌现还是资源、zone 是长出来还是新开、mimic 第一次遭遇怎么演、tell 怎么和 sanity 腐蚀耦合——作者已定调「可生存有代价、无脚本死，低理智会腐蚀读 tell 的能力」）。

---

## 关键约束 / 易踩坑（沿用）

* **回归文化（#22/#26）**：收尾全绿——`npm run typecheck` + 全部 playthrough（`playthrough` / `-combat` / `-corpse` / `-decay` / `-upgrades` / `-economy` / `-bluecaves` / `-wreckyard` / `-chart` / `-lighthouse` / `-lighthouse-scenarios` / `-save`）+ `-scenarios` + `-combat-scenarios` + `-mapgen-scenarios` + `verify-tutorial` + `smoke-chart-ui.tsx`（是 `.tsx`）。`playthrough.ts` ~12% RNG flake（#18），挂了重试。
* **深水写法铁律（#54/#55）**：深水 / cosmic / 伏笔事件叙述**永不交底**——既给平淡解释又留错的读法，两种叠着，不确认也不否认。范例：`reef.sun_net`『你告诉自己是云』/ `reef.no_bottom`『是下降流……道理都对。你还是没敢把那片蓝多看第二眼』/ `wreck_graveyard.no_bubbles`『空潜水服／闭路呼吸器……挑了你更想信的那个』/ `bluecaves.the_glow`『是会发光的虫子，你对自己说』。
* **一 zone 一母题（#55 的做法，新料对齐用）**：补伏笔时先用 `event-runner --list` 按 zone-tag 数中段 tone 覆盖、找各 zone 的真缺口，每个母题落在最适合它的 zone（reef=拉力/断口 · cave=无灯之光/黑暗 · wreck=corpse-wearer/尸体），别一股脑堆同一个 zone。
* **tag/loot 隔离（#19/#44/#47）**：`[shallow,reef]`→只灯塔礁 0-25m；`[reef]`→灯塔礁 0-44m；`[wreck]`→墓园+灯塔礁 25m+（掉人造物）；`[cave]`→蓝洞+灯塔礁 45m+（掉天然物）。伏笔事件通常 loot-free 最干净。
* **baseline（#43/#49）**：statsDelta 必 `event-runner --out json` 实跑抄；sanity check 可双分支（fail 起步 sanity≤dc-30 撞 0.05 clamp、别触 0 底，如 no_bottom fail 起步 20→8）；低 dc stamina check 只锁 success；uncanny 事件至少配一个 no-check lore baseline（确定性）。
* **沙箱 git 提交**：见 [Sandbox Git Commit]——mount 能 create/rename、不能 unlink。**用 `git add src scenarios docs`（别 `-A`，根目录 `CLAUDE.md` 是 Cowork 配置、一直 untracked、别提交）**；残留锁 `mv` 进 `.git/.sandbox-junk/`（别 `rm`）；`git config gc.auto 0`；核对只用 `git --no-optional-locks status/log`；收尾保证 `.git/{index,HEAD}.lock` 不在。验构建用 `npx vite build --outDir <写得动的随机目录> --emptyOutDir`（/tmp 可能有旧 root 文件致 Permission denied）。
* **UI smoke（#29/#41）**：纯加事件 JSON 不碰 UI，一般不用动 smoke；改 SeaChartView/任何 UI 数据路径才补 `smoke-chart-ui.tsx`。

## 收尾

更新 `docs/STATUS.md`（滚动进度 + §3 + §6 新 quirk）、自动记忆（[Weekend Content Log] 进度 + MEMORY.md 索引；若动了 vision 同步 [Deep Game Vision]）、把本文件改写成再下一个 session 的 prompt，并按 [Sandbox Git Commit] 提交。
