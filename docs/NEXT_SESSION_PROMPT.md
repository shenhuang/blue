# 下个 session 的 prompt — 基建+地图 revamp · Phase B（灯塔数据模型）

> 直接把下面（含本行以下全部）粘进新 session 即可。

---

你在接手「深海回响」(Deep Echo) —— 潜水题材文字冒险 Roguelike（Vite + React + TS），仓库在 `~/Desktop/Blue`。

## 先 onboarding（按顺序）
1. 读 `docs/深海回响_基建地图_SPEC.md`（**本次工作的设计源**，全文）。重点 §3（Pillar 2 灯塔基地——**你做这块的数据模型部分**）、§4（空间地图钩子，inert 字段预留）、§5（改动汇总）、§6（存档迁移）、§7（回归）、§8（阶段——**你做 Phase B**）、§9（tunable）、§10（决策记录）。
2. 读 `docs/STATUS.md` §3（系统/文件）+ §6（quirks，最权威，**尤其新加的 #50 材料经济 + #39 存档迁移流程 + #27/#28 海图派生**）；自动记忆里的 **[Base+Map Revamp]**、**[Scenario Framework]**、**[Sandbox Git Commit]** 三条。
3. 跑 `npm run typecheck` + `npx tsx scripts/playthrough.ts` + `npx tsx scripts/playthrough-save.ts` 确认起点干净、看一次完整 trace。

基线：**Phase A（材料经济）已提交**（git log 最新一条 `基建地图 Phase A：材料经济…`；再上一条设计锁定 `582318d`、MVP 后全部工作 `ff2cc77`）。每步按项目要求兼顾**可扩展/可维护**，并保证下个 session 能接上。

## 本 session 目标：实装 Phase B —— 灯塔数据模型（仅此阶段）
把"单一岸边港口"在**数据层**扩成**多座灯塔基地**：定 `Lighthouse` 类型、`profile.lighthouses`、把现有港口重构成"家＝第一座灯塔"、建 `engine/lighthouses.ts`（每灯塔升级轨 + 加成 + 最近灯塔距离工具）。**这是纯数据模型 + 引擎脚手架——灯塔此刻还不"做"任何可见的事**（点亮海域=揭示+拉近、修复废弃灯塔，都是 **Phase C**，本阶段别碰）。Phase B 自洽可发：灯塔字段进存档、home 灯塔种入、引擎工具就位，但海图/出海行为不变。

具体（全部细节见 SPEC §3 / §5 / §8）：
1. **`Lighthouse` 类型**（`types/state.ts`）：
   ```ts
   interface Lighthouse {
     id: string; name: string;
     mapX: number; mapY: number;     // 海图坐标（0–1 归一化，复用 POI 那套）
     level: number;                  // 决定点亮半径 + 揭示哪些 POI（Phase C 用）
     builtUpgrades: Set<string>;     // 该灯塔自己的升级轨（与全局装备升级区分）
     integrity?: number;             // 留作 Phase D invasion/defense，现在 inert（不读不写）
     region?: string;                // 锚定海域 id，inert
   }
   ```
   `PlayerProfile` 加 `lighthouses: Lighthouse[]`。
2. **home 灯塔种入**：`createInitialProfile` 给 `lighthouses: [{ id:'lighthouse.home', name:'旧灯塔', mapX:.., mapY:.., level:1, builtUpgrades:new Set() }]`（坐标取岸边/港口那个点，跟 `chart_pois.json` 的港口锚点对齐）。Aldo/Mira 仍挂 home 灯塔（港口 hub 不变）。
3. **存档迁移 `SAVE_VERSION 2→3`**（Phase A 已到 2）：`migrateSave` 的 `while` 加 `case 2`：给旧档补种 home 灯塔（`lighthouses` 缺失则注入上面那条）。`builtUpgrades` 是 Set → **复用现有 `{__set:[…]}` replacer/reviver 自动 round-trip，加 Set 字段无需改序列化**（quirk #39）。回归在 `playthrough-save.ts` 加 v2→v3 断言（旧档→有 home 灯塔）。
4. **`engine/lighthouses.ts`（新）**：与全局 `engine/upgrades.ts` **平行、互不污染**——管每灯塔升级轨。提供：
   - `canBuildAt(lighthouse, upgradeId)` / `buildAtLighthouse(state, lighthouseId, upgradeId)`（账单复用 Phase A 的 `UpgradeCost` 材料＋金币双资源模型）。
   - `getLighthouseBonuses(lighthouse)`（聚合该灯塔 `builtUpgrades` 的加成；模式照 `getUpgradeBonuses`）。
   - `nearestLighthouse(profile, mapX, mapY)` + 距离工具（**只建工具，Phase C 才把它接进 `chart.ts` 算 distance**）。
   - 灯塔设施升级的数据源（新 `data/lighthouse_upgrades.json` 或内联）。**v1 可以先放最小/占位**——真正的"点亮半径"等设施升级是 Phase C 跟 reveal 一起做；本阶段重点是机制就位 + 类型钉死。
5. **`dockyard` 归属决策（SPEC §3.3，tunable）**：建议 **Phase B 先保持 `dockyard` 全局不动**（它现在通过 `hasUpgrade` Condition 门控旧灯塔礁 POI + `getUpgradeBonuses`；迁成灯塔设施会牵动海图门控 + 加成聚合，是更大改动）。把"dockyard→home 灯塔升级"留作 Phase C 跟 reveal 一起评估，或单独一个小 pass。**动手前如拿不准就用 AskUserQuestion 跟作者确认。**
6. **回归**（按 quirk #26 子目录约定）：新增 `scenarios/lighthouse/` + `scripts/playthrough-lighthouse-scenarios.ts`（或先一个 `scripts/playthrough-lighthouse.ts`），覆盖：Lighthouse 类型 round-trip、home 种入、`canBuildAt`/`buildAtLighthouse` 双资源账单、`getLighthouseBonuses` 聚合、`nearestLighthouse` 距离。`playthrough-save.ts` 加 v2→v3。

## 关键约束 / 易踩坑
- **存档**：改 GameState 形状**必须** bump SAVE_VERSION（→3）+ 在 migrateSave 加 `case 2`（quirk #39）；`builtUpgrades`/任何新 Set 字段靠现有 replacer/reviver 自动 round-trip，**不用改序列化**。
- **作用域**：Phase B **只动数据模型 + 引擎脚手架**。**别碰**海图 reveal（POI 可见性按灯塔）/ nearest-lighthouse 实际算 distance / `lighthouse_ruin` 修复事件 / SeaChartView 渲染灯塔——那些全是 **Phase C**。灯塔此刻 inert。
- **平行别污染**：`engine/lighthouses.ts` 与 `engine/upgrades.ts` 是两套轨（随身装备＝全局；灯塔设施＝每灯塔），别让它们互相读对方的 Set。复用 Phase A 的 `UpgradeCost`/`canPurchase` 风格但各自独立。
- **回归文化**（quirk #22/#26）：收尾**全绿**——typecheck + 全部 playthrough（13 个）+ scenarios + combat + mapgen + lighthouse + verify-tutorial + `smoke-chart-ui`。`playthrough.ts` 有 ~12% RNG flake（quirk #18，教学路径，与你无关），挂了重试一两次确认。
- **注册守卫**：`verify-tutorial.mjs` 按目录扫 data，加新 JSON（如 `lighthouse_upgrades.json`）忘登记会报错——若新建数据文件，确认它被某个 registrar import 或更新守卫。
- **沙箱 git 提交**：**别在 sandbox 直接 `git commit`**（mount 删不掉 `.git` 锁）——见记忆 **[Sandbox Git Commit]**：要么全程 Mac 端做 git，要么 `cp .git/index /tmp` + `GIT_INDEX_FILE` 绕过 + 事后 Mac 端 `rm -f .git/{index,HEAD}.lock .git/objects/maintenance.lock && git reset`。

## 验收
- `npm run typecheck` 干净；SPEC §7 相关回归脚本绿（至少 save 迁移 + 新 lighthouse 脚本）。
- 旧存档（v2，无 lighthouses）迁移成功：有 home 灯塔、version=3、其它字段保留。
- 新游戏 `createInitialProfile` 自带 home 灯塔；`engine/lighthouses.ts` 的 build/bonuses/nearest 工具单测通过。
- **行为不变**：海图/出海/升级照常（灯塔还没接 reveal/reach）。

## 收尾
更新 `docs/STATUS.md`（§5 进度 + §3 文件/§6 新 quirk）、`docs/深海回响_基建地图_SPEC.md`（Phase B 打勾）、自动记忆（[Base+Map Revamp] 进度 + MEMORY.md 索引），并把本文件 `docs/NEXT_SESSION_PROMPT.md` 改写成 **Phase C（海图集成 + 修复循环）** 的 prompt，让下个 session 接上。
