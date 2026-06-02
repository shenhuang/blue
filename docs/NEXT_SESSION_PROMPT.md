下个 session 的 prompt — 内容 pass（墓园浅段 tone 密度 / 终局 lore 收口 / 各段 realistic）
直接把下面（含本行以下全部）粘进新 session 即可。

你在接手「深海回响」(Deep Echo) —— 潜水题材文字冒险 Roguelike（Vite + React + TS），仓库在 `~/Desktop/Blue`。

**重要里程碑**：基建+地图 revamp 的三根支柱（材料经济 / 多灯塔基地 / 海图）**已全部闭环**（Phase A/B/C 均已实装并提交）。之后又做了一轮 **2026-06-02 内容 pass**：reef 浅段 fresh-wrongness 事件（含项目首个浅段 cosmic）+ reef 第二只敌人「石斑鱼」（territorial 重装）+ 深段 realistic 密度。**所以现在 3 个 zone 各有 2 只敌人，敌人分布已均衡——下一步继续内容，但重心转向事件 / lore，别再加敌人。**（**Phase D / 灯塔防御战仍被作者推后**——也许等做 invasion 机制时再说，也许根本不做；见末尾"已搁置"。别主动开。）

先 onboarding（按顺序）

1. 读 `docs/STATUS.md`：开头的滚动进度（最近四条是 Phase A/B/C + 06-02 内容 pass）+ §3（系统/文件）+ §6 quirks。**本次最相关的 quirk**：#53（06-02 内容 pass：reef 浅段 fresh-wrongness 母题 / 石斑鱼 territorial 生态位 / 深段 realistic / 敌人 2-per-zone，**最权威**）、#19（事件只挂单 zone tag 隔离 + `[shallow,reef]` 为何天然只在灯塔礁）、#44（loot 按 zone：wreck.* 掉人造物 / cave.*·reef.* 掉天然物）、#47（wreck tag 25m+ 跨 zone）、#49 + #43（低 dc 的 stamina check 只能锁 success baseline；sanity check 可双分支锁，fail 起步 sanity 设 ≤dc-30 撞 0.05 clamp）、#45（加敌人五件套，万一真要加）、#20/#17（深度池 + 跨 zone 共享）。自动记忆里的 [Weekend Content Log]、[Base+Map Revamp]、[Scenario Framework]、[Sandbox Git Commit]。
2. 读 `docs/深海回响_基建地图_SPEC.md`（revamp 设计源，三支柱已全部打勾；§9 tunable 汇总灯塔半径/reach 系数/账单数值）。主世界观/循环看 `docs/深海回响_SPEC.md` 前 6 节，战斗机制看 `docs/深海回响_战斗系统_SPEC.md` §2–§7（注意：敌人 roster 不在 SPEC，全在 STATUS——加敌人/物品的记录都进 STATUS）。
3. 跑 `npm run typecheck` + 全部回归确认起点干净（见下方"回归文化"）。

基线：本 pass（reef 浅段 fresh-wrongness + 石斑鱼 + 深段 realistic）已提交（git log 最新一条）。当前内容：**70 事件 / 7 敌人 / 8 combat / 22 item / 57 event baseline / 9 combat baseline**；3 random zone（旧灯塔礁 reef / 蓝洞群 cave / 沉船墓园 wreck，各 2 敌人）+ 教学线性东礁。

---

## 内容 pass — 下一批缺口（优先级 高→低）

**守"敌人别太多、优先事件"——各 zone 已 2 敌人，本轮不加敌人。** 优先级：

1. **沉船墓园浅段（18-25m）uncanny/cosmic 事件**（最该补，与上一轮 reef 浅段对称）：墓园 cosmic/uncanny 几乎全在 30m+（knocking 30-48 / open_door 40-50 / handprints 24-40 / drifting_light 34-50），**浅段 18-25m 几乎全 realistic**（cabin_entrance / collapsed_passage / galley）。补 2–3 个只挂 `[wreck]` 的浅 uncanny/cosmic 事件，**loot 必须人造物**（canned_food / old_fishing_net / brass_*，守 quirk #44/#47——`[wreck]` 25m+ 会跨到灯塔礁），可延续墓园敲击/手印/门/写字板母题，或像本轮 reef 那样开一条全新浅水母题（参照 `reef.sun_net`/`silversides`/`warm_seam` 的"晒亮的安全被证伪"思路，但换成沉船语汇）。**刻意不触发 `flag.d_reveal`**（除非走下面第 3 条）。
2. **各段 realistic 探索密度**：跑 `node scripts/verify-tutorial.mjs` 看"旧灯塔礁事件池"报告里哪段薄（这是唯一自动出的池子信号；蓝洞/墓园得自己用 `event-runner --list --zone-tag` 数）。补 realistic 质感事件，单 zone tag（quirk #19）、loot 守 quirk #44、无 lore/无 d_reveal。
3. **（作者向，可选）终局 lore 收口 / `flag.d_reveal` 触发器**：`d_reveal` 至今**没有任何东西置位它**（quirk #42：置位即所有死者名渲染成「你」，是存档级不可逆的终局揭示）。本轮新铺的 `lore.reef_shallows.*`（the_gap/the_still_square/the_warm_crack）＋既有"深处有光/下面"暗线（`lore.deep_water.*` / the_door / drifting_light / lantern_glow）已经织得够厚——**可以考虑给 d_reveal 接一个克制的终局触发**（比如集齐某几条 lore 后的一次性事件）。但这是**作者要拍板的方向**：要不要做、在哪触发、揭示后体验如何，先问，别自作主张置位。或者接之前 mock 过没建的**状态效果系统**（run 级 `StatusEffect` + StatusBar 图标行，bends II/III 当首个真实消费者，STATUS §8）——这是系统活不是内容活。

每加一个事件：①只挂单 zone tag（quirk #19）②loot 守 quirk #44/#47 ③至少加 1 个 baseline scenario 进 `scenarios/`（quirk #26/#43——**statsDelta 必须 `event-runner --out json` 实跑抄出，别凭直觉**）。万一真要加敌人（不建议）：走 quirk #45 五件套 + `engine/combat.ts` 三处注册。

---

## 已搁置：Phase D — 灯塔防御战（invasion/defense）

**作者 2026-06-01 明确：灯塔防御战推后——也许等做 invasion 机制时再做，也许根本不做。别主动开这个。** 地基留着不碍事：`Lighthouse.integrity?` / `region?` 字段 inert 预留、SPEC §3.1/§4 留了 `threat` + stub 事件类型的位。本 session 专心内容 / lore。

---

## 关键约束 / 易踩坑（沿用）

* **回归文化（quirk #22/#26）**：收尾全绿——`npm run typecheck` + 全部 playthrough（`playthrough` / `-combat` / `-corpse` / `-decay` / `-upgrades` / `-economy` / `-bluecaves` / `-wreckyard` / `-chart` / `-lighthouse` / `-lighthouse-scenarios` / `-save`）+ `-scenarios` + `-combat-scenarios` + `-mapgen-scenarios` + `verify-tutorial` + `smoke-chart-ui.tsx`（注意是 `.tsx` 不是 `.ts`）。`playthrough.ts` 有 ~12% RNG flake（quirk #18），挂了重试一两次。
* **事件 loot/tone 隔离（quirk #19/#44/#47）**：`[shallow,reef]`→只灯塔礁 0-25m；`[reef]`→灯塔礁 0-44m；`[wreck]`→墓园 + 灯塔礁 25m+（掉人造物！）；`[cave]`→蓝洞 + 灯塔礁 45m+（掉天然物）。加事件前先想清楚 tag 会漏进哪些 zone、loot 会不会出戏。
* **stamina vs sanity check baseline（quirk #43/#49）**：低 dc stamina check 只能锁 success（满 stamina→0.95 必过；fail 撞不到 0.05 clamp，且小 seed 首抽≈0.236）。sanity check 可双分支（fail 起步 sanity 设到 ≤dc-30 撞 0.05，且别让惩罚后触 0 下限）。
* **灯塔/海图（quirk #52）**：加远海新 POI 时它要么落某座灯塔 reveal 半径内、要么配一个能点亮它的可修复前哨，否则玩家永远看不到。`generateChart` 纯函数派生不入存档（quirk #27）。
* **UI smoke（quirk #29/#41）**：SeaChartView / 任何 UI 数据路径改动补 `smoke-chart-ui.tsx` SSR 断言。纯加事件/敌人 JSON 不碰 UI，一般不用动 smoke。
* **沙箱 git 提交**：见记忆 [Sandbox Git Commit]——mount 能 create/rename、只不能 unlink。残留锁 `mv` 进 `.git/.sandbox-junk/`（别 `rm`）、`git config gc.auto 0`、`git add -A && git commit`、核对只用 `git --no-optional-locks status` / `git log`（别用裸 status）；收尾保证 `.git/{index,HEAD}.lock` 不在。注意 `CLAUDE.md`（Cowork 项目配置，4 行）一直 untracked 且不该进游戏仓库提交——`git add` 时排除它。`npm run build` 在沙箱会因 dist 旧产物 unlink 失败——验构建用 `npx vite build --outDir /tmp/xxx --emptyOutDir`。

## 收尾

更新 `docs/STATUS.md`（滚动进度 + §3 文件 + §6 新 quirk）、自动记忆（[Weekend Content Log] 进度 + MEMORY.md 索引），把本文件 `docs/NEXT_SESSION_PROMPT.md` 改写成再下一个 session 的 prompt，并按 [Sandbox Git Commit] 提交。SPEC 一般不用动（内容 pass 无设计变更；敌人/物品记录进 STATUS 不进 SPEC）。
