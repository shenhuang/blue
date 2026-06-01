下个 session 的 prompt — 内容 pass（reef 浅段 uncanny/cosmic + reef 第二只敌人）
直接把下面（含本行以下全部）粘进新 session 即可。

你在接手「深海回响」(Deep Echo) —— 潜水题材文字冒险 Roguelike（Vite + React + TS），仓库在 `~/Desktop/Blue`。

**重要里程碑**：基建+地图 revamp 的三根支柱（材料经济 / 多灯塔基地 / 海图）**已全部闭环**——Phase A（材料经济）+ Phase B（灯塔数据模型）+ Phase C（海图集成 + 修复循环）均已实装并提交。所以这个 session **回到内容缺口**。（**Phase D / 灯塔防御战已被作者明确推后**——也许等做 invasion 机制时再说，也许根本不做；见末尾"已搁置"。别主动开。）

先 onboarding（按顺序）

1. 读 `docs/STATUS.md`：开头的滚动进度（最近三条是 Phase A/B/C）+ §3（系统/文件）+ §6 quirks。**本次最相关的 quirk**：#52（Phase C 海图集成/修复/dockyard 迁灯塔，最权威）、#19（事件只挂单 zone tag 隔离）、#44（loot 按 zone：wreck.* 掉人造物 / cave.*·reef.* 掉天然物，避免跨 zone 共享出戏）、#47（wreck tag 25m+ 跨 zone）、#49 + #43（低 dc 的 stamina check 只能锁 success baseline：满 stamina→0.95 clamp 必过，fail 无法 clamp 到 0.05，所以别做 fail baseline）、#17/#20（深度池 + 蓝洞浅段过曝）。自动记忆里的 [Weekend Content Log]、[Base+Map Revamp]、[Scenario Framework]、[Sandbox Git Commit]。
2. 读 `docs/深海回响_基建地图_SPEC.md`（revamp 设计源，三支柱已全部打勾；§9 tunable 汇总了灯塔半径/reach 系数/账单数值，调平衡看这里）。
3. 跑 `npm run typecheck` + 全部回归确认起点干净（见下方"回归文化"）。

基线：Phase A（`4612c0c`）+ Phase B + Phase C 已提交（git log 最新几条）。当前内容：63 dive 事件 / 6 敌人 / 3 random zone（旧灯塔礁 reef / 蓝洞群 cave / 沉船墓园 wreck）+ 教学线性东礁。

---

## 内容 pass — 补已知缺口（下一步）

revamp 把系统做厚了，但内容侧还有 [Weekend Content Log] 记的几个长线缺口。**守"敌人别太多、优先事件"**。优先级（高→低）：

1. **reef 浅段 10-25m uncanny/cosmic 事件**（最该补）：旧灯塔礁 reef-only 事件目前浅段几乎全 realistic，**无浅段 cosmic**（最浅 cosmic 是别 zone 的）。补 2–3 个只挂 `[reef]`（或 `[shallow,reef]`）tag 的 uncanny/cosmic 浅事件，loot 用 coral_shard/灯塔黄铜（守 quirk #44/#19），延续旧灯塔『下面的光』母题但克制（刻意不触发 `flag.d_reveal`，留给在场用户 + 作者向）。
2. **reef 第二只敌人**：reef 目前只有梭鱼（玻璃大炮 hp16/evasion4）。补一只**互补型**（如高 HP/armor 的礁底伏击者，或 territorial 慢速），触发事件参照 `reef.barracuda`/`octopus_den` 模式，掉 reef 天然 material（coral 系或新增），只挂 `[reef]`。**先想清楚生态位别和梭鱼/章鱼/盲鳗/沉灯水母重复**（见 quirk #45/#46/#48 的敌人设计笔记）。
3. **各段 realistic 探索密度**：哪段事件池薄（verify-tutorial §6c 的"深度 Xm 事件池过小"warning 是信号），补 realistic 质感事件。

每加一个事件/敌人：①只挂单 zone tag（quirk #19）②loot 守 quirk #44 ③至少加 1 个 baseline scenario 进 `scenarios/`（quirk #26）④敌人记得在 `engine/combat.ts` 注册（事件文件按目录自动扫，verify-tutorial 守卫）。

---

## 已搁置：Phase D — 灯塔防御战（invasion/defense）

**作者 2026-06-01 明确：灯塔防御战推后——也许等做 invasion 机制时再做，也许根本不做。别主动开这个。** 地基留着不碍事：`Lighthouse.integrity?` / `region?` 字段 inert 预留、SPEC §3.1/§4 留了 `threat` + stub 事件类型的位——真要做时还在，不用现在动也不用现在删。本 session 专心内容 pass。

---

## 关键约束 / 易踩坑（沿用）

* **回归文化（quirk #22/#26）**：收尾全绿——`npm run typecheck` + 全部 playthrough（`playthrough` / `-combat` / `-corpse` / `-decay` / `-upgrades` / `-economy` / `-bluecaves` / `-wreckyard` / `-chart` / `-lighthouse` / `-lighthouse-scenarios` / `-save`）+ `-scenarios` + `-combat-scenarios` + `-mapgen-scenarios` + `verify-tutorial` + `smoke-chart-ui.tsx`（注意是 `.tsx` 不是 `.ts`）。`playthrough.ts` 有 ~12% RNG flake（quirk #18），挂了重试一两次。
* **灯塔/海图（quirk #52）**：reveal 半径 + reach 系数 + 修复账单都是 tunable（`lighthouses.ts` 顶部常数 + `lighthouse_upgrades.json::ruins` + SPEC §9）。加远海新 POI 时它要么落某座灯塔半径内、要么配一个能点亮它的（可修复）前哨，否则玩家永远看不到。dockyard 已是 home 灯塔设施（`requiresLighthouseUpgrade` 门控），别再当全局升级。
* **海图派生不入存档（quirk #27）**：`generateChart` 纯函数，reveal 读 `profile.lighthouses`（持久）没问题，别把点亮状态写进 GameState。
* **UI smoke（quirk #29/#41）**：SeaChartView / 任何 UI 数据路径改动补 `smoke-chart-ui.tsx` SSR 断言。
* **沙箱 git 提交**：见记忆 [Sandbox Git Commit]——mount 能 create/rename、只不能 unlink。残留锁 `mv` 进 `.git/.sandbox-junk/`（别 `rm`）、`git config gc.auto 0`、`git add -A && git commit`、核对只用 `git --no-optional-locks status` / `git log`（别用裸 status）；收尾保证 `.git/{index,HEAD}.lock` 不在。`npm run build` 在沙箱会因 dist 旧产物 unlink 失败——验构建用 `npx vite build --outDir /tmp/xxx --emptyOutDir`。

## 收尾

更新 `docs/STATUS.md`（滚动进度 + §3 文件 + §6 新 quirk）、相关 SPEC、自动记忆（[Weekend Content Log] 进度 + MEMORY.md 索引），把本文件 `docs/NEXT_SESSION_PROMPT.md` 改写成再下一个 session 的 prompt，并按 [Sandbox Git Commit] 提交。
