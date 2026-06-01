# 下个 session 的 prompt — 基建+地图 revamp · Phase C（海图集成 + 修复循环）

> 直接把下面（含本行以下全部）粘进新 session 即可。

---

你在接手「深海回响」(Deep Echo) —— 潜水题材文字冒险 Roguelike（Vite + React + TS），仓库在 `~/Desktop/Blue`。

## 先 onboarding（按顺序）
1. 读 `docs/深海回响_基建地图_SPEC.md`（**本次工作的设计源**，全文）。重点 §3（Pillar 2 灯塔基地——**你做 reveal/reach/修复**）、§4（空间地图钩子：distance 从 fallback 切到按最近灯塔算）、§5（改动汇总）、§7（回归）、§8（阶段——**你做 Phase C**）、§9（tunable）、§10（决策记录）。
2. 读 `docs/STATUS.md` §3（系统/文件）+ §6（quirks，最权威，**尤其 #51 灯塔数据模型 + #50 材料经济 + #27/#28 海图派生 + #41 SeaChartView 2D + #29 UI smoke 套路**）；自动记忆里的 **[Base+Map Revamp]**、**[Sea Chart]**、**[Scenario Framework]**、**[Sandbox Git Commit]**。
3. 跑 `npm run typecheck` + `npx tsx scripts/playthrough.ts` + `npx tsx scripts/playthrough-lighthouse.ts` + `npx tsx scripts/playthrough-chart.ts` 确认起点干净。

基线：**Phase A（材料经济，`4612c0c`）+ Phase B（灯塔数据模型）已提交**（git log 最新两条）。Phase B 已就位：`Lighthouse` 类型、`profile.lighthouses`、home 灯塔、`engine/lighthouses.ts`（canBuildAt/buildAtLighthouse/getLighthouseBonuses/nearestLighthouse，**已测但游戏流程还没调用——灯塔 inert**）、`data/lighthouse_upgrades.json`（信标占位轨）。每步兼顾**可扩展/可维护**。

## 本 session 目标：实装 Phase C —— 让灯塔真正"做事"（海图集成 + 修复循环）
把 Phase B 的 inert 灯塔接进游戏：**点亮（reveal）+ 拉近（reach）+ 修复废弃灯塔 + 海图渲染 + 建造 UI**。这是 revamp 的收尾大头。

具体（全部细节见 SPEC §3.2 / §3.4 / §4 / §5 / §8）：
1. **reveal（点亮揭示）—— `engine/chart.ts`**：POI 只有落在某座**已拥有灯塔的点亮半径内**才可见/可出海（在现有两级门控 `requiresFlags`/`requiresUpgrade` 之上叠一层）。半径 = `base(lighthouse.level)` + `getLighthouseBonuses(lh).lightRadiusBonus`。**关键约束（别破坏当前手感）：home 灯塔默认要点亮现有 4 个 POI**（east_reef/old_lighthouse_reef/blue_caves/wreck_graveyard）→ 当前行为不变。两条路线二选一（**这是设计决策，动手前想清楚或问作者**）：(a) home base 半径给得够大覆盖全部 4 个；(b) 现有 4 个 POI 走 `requiresFlags` 既有发现门控"祖父化"豁免、reveal 半径只管 Phase C+ 的新点位。**建议 (a) 更统一**（distance 也好算），但注意 home(0.06,0.5) 到 wreck(0.72,0.55) ≈ 0.66，base 半径得够大。
2. **reach（出海拉近）—— `engine/dive.ts` + `chart.ts`**：一次下潜的 `distance`（出海预耗氧 + turn）改成**按最近的已拥有灯塔算**（`nearestLighthouse(profile, poi.mapX, poi.mapY)` 已就位）而非永远从岸边，再减 `getLighthouseBonuses(nearestLh).reachReduction`。**v1 保留 `chart_pois.json` 写死的 distance 作 fallback**（SPEC §4：地图小、别破坏现有 4 POI 手感）——引擎优先用"到最近灯塔的归一化距离换算"，换算系数是 tunable。`startDiveFromPoi`（quirk #28）是唯一出海入口，在它里面接。
3. **修复废弃灯塔 —— `lighthouse_ruin` 下潜点/事件**：下潜中可遇 `lighthouse_ruin`（特殊 dive 节点 / 事件）。抵达给"修复"选项：付一份材料+金币账单（T2/T3 量级，复用 `UpgradeCost`）。修复成功 → 往 `profile.lighthouses` push 一座新灯塔（坐标取该点位）→ 它上线进海图、点亮其周围。把"下潜"与"基建"接成目的链。**新灯塔加进存档已是现成的**（Phase B 的 lighthouses 数组 + Set round-trip），不用再 bump SAVE_VERSION。
4. **SeaChartView 渲染灯塔 + 建造 UI**：海图上画灯塔节点 + 点亮范围（圈）；POI 可见性读灯塔。新增灯塔设施建造界面（可复用 `UpgradePanel` 的模式 + `engine/lighthouses.ts` 的 canBuildAt/buildAtLighthouse + `data/lighthouse_upgrades.json`）——现在玩家终于能建信标了。
5. **`dockyard` 归属决策（SPEC §3.3，悬了两个 Phase）**：现在到了该定的时候。选项：(a) 保持 dockyard 全局（现状，最省事）；(b) 迁成 home 灯塔的设施升级（要把 chart 门控从 `hasUpgrade(profile.unlockedUpgrades)` 改成读 home.builtUpgrades + 迁移已购 dockyard 进 home.builtUpgrades，SAVE_VERSION 3→4）。**这是真·设计分叉，用 AskUserQuestion 跟作者确认再动。**
6. **回归**（按 quirk #26 子目录约定）：新增 `scenarios/lighthouse/` + `scripts/playthrough-lighthouse-scenarios.ts`（覆盖修复废弃灯塔账单、灯塔上线后 reveal/reach 变化）。更新 `playthrough-chart.ts`（加灯塔 reveal：无灯塔→POI 不可见 / nearest-lighthouse distance 断言）、`smoke-chart-ui.tsx`（海图渲染灯塔节点 + 点亮范围 + 建造面板）、`playthrough-lighthouse.ts`（扩 reveal/reach/修复）。

## 关键约束 / 易踩坑
- **别破坏当前手感**：home 默认点亮现有 4 POI（见 §目标 1）；distance 保留写死 fallback（§目标 2）。改完务必跑 `playthrough-chart.ts` + `smoke-chart-ui.tsx` 确认 4 个 POI 仍可见可出海。
- **存档**：新灯塔/新 builtUpgrade 进 `profile.lighthouses`，**Set + 数组已自动 round-trip（quirk #51），加灯塔不用 bump SAVE_VERSION**；只有"dockyard 迁灯塔"那条路（决策 5b）才需要 3→4 + 迁移。
- **复用 Phase A/B**：账单走 `UpgradeCost` + `engine/upgrades.ts::materialShortfall`/`describeUpgradeCost`；灯塔建造走 `engine/lighthouses.ts` 现成 API；别重写。
- **海图派生不入存档（quirk #27）**：`generateChart(profile)` 是纯函数；reveal 读 `profile.lighthouses`（持久）没问题，但别把"点亮状态"写进 GameState——它从 lighthouses 派生。
- **UI smoke 套路（quirk #29/#41）**：SeaChartView 改动要补 `smoke-chart-ui.tsx` SSR 断言（标记名/锁定原因放 `aria-label`；信息面板只渲染默认选中点）。
- **注册守卫（quirk #39e）**：加 `lighthouse_ruin` 事件 JSON 记得在 `engine/zones.ts` 注册；verify-tutorial 按目录扫 events 会拦漏登记。
- **回归文化**（quirk #22/#26）：收尾**全绿**——typecheck + 全部 playthrough（含 lighthouse + 新 lighthouse-scenarios）+ scenarios + combat + mapgen + verify-tutorial + smoke。`playthrough.ts` 有 ~12% RNG flake（quirk #18），挂了重试。
- **沙箱 git 提交**：见记忆 **[Sandbox Git Commit]**——mount **能 create/rename、只不能 unlink**，所以 commit 走得通：残留锁 `mv` 进 `.git/.sandbox-junk/`（别 `rm`）、`git config gc.auto 0`、`git add -A && git commit`、核对只用 `git --no-optional-locks status` / `git log`（别用裸 status，会留 index.lock）；收尾保证 `.git/{index,HEAD}.lock` 不在，用户 Mac 端开箱干净。

## 验收
- `npm run typecheck` 干净；SPEC §7 全部回归绿（新 lighthouse-scenarios + chart reveal + smoke 渲染灯塔）。
- **当前 4 个 POI 仍可见可出海**（home 默认点亮）；distance 仍合理（fallback 没破）。
- 修复一座废弃灯塔后：它进 `profile.lighthouses`、上海图、点亮其周围新 POI、reach 从它算更近；存档 round-trip 后仍在。
- 玩家能在海图建灯塔信标，建后 `getLighthouseBonuses` 生效到 reveal/reach。

## 收尾
更新 `docs/STATUS.md`（§5 进度 + §3 文件/§6 新 quirk）、`docs/深海回响_基建地图_SPEC.md`（Phase C 打勾）、自动记忆（[Base+Map Revamp] 进度 + [Sea Chart] + MEMORY.md 索引），并把本文件 `docs/NEXT_SESSION_PROMPT.md` 改写成 **Phase D（invasion/defense，或回到内容 pass：reef 浅段 uncanny/cosmic）** 的 prompt。revamp 三支柱（材料/灯塔/海图）到 Phase C 即闭环——之后可回 [[weekend-content-log]] 的内容缺口。
