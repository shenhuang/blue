# 下个 session 的 prompt — 基建+地图 revamp · Phase A（材料经济）

> 直接把下面（含本行以下全部）粘进新 session 即可。

---

你在接手「深海回响」(Deep Echo) —— 潜水题材文字冒险 Roguelike（Vite + React + TS），仓库在 `~/Desktop/Blue`。

## 先 onboarding（按顺序）
1. 读 `docs/深海回响_基建地图_SPEC.md`（**本次工作的设计源**，全文）。重点 §2（材料经济）、§5（改动汇总）、§6（存档迁移）、§7（回归）、§8（阶段——**你做 Phase A**）、§9（tunable）、§10（决策记录）。
2. 读 `docs/STATUS.md` §3（系统/文件）+ §6（quirks，最权威）；自动记忆里的 **[Base+Map Revamp]**、**[Scenario Framework]**、**[Sandbox Git Commit]** 三条。
3. 跑 `npm run typecheck` + `npx tsx scripts/playthrough.ts` 确认起点干净、看一次完整 trace。

基线 commit `ff2cc77`。每步按项目要求兼顾**可扩展/可维护**，并保证下个 session 能接上。

## 本 session 目标：实装 Phase A —— 材料经济（仅此阶段）
把"建设值（每潜按 depth/node 计分）买升级"换成"**材料 + 金币** 买升级"。**灯塔/海图留 Phase B/C，本阶段别碰。** Phase A 自洽可发：灯塔还没来，升级照常买，只是改用材料+金币。

具体（全部细节见 SPEC §2 / §5 / §8）：
1. **成本模型**：`UpgradeDef.cost: number` → `UpgradeCost { materials: MaterialCost[]; gold: number }`（`types/upgrades.ts`，新增 `MaterialCost`/`UpgradeCost`）。`data/upgrades.json` 5 个升级 cost 改成 `{ materials:[…], gold:N }`（起始值见 SPEC §2.3 表，可调）。
2. **材料分档**：给 `data/items.json` 每个 material 加 `tier: 1|2|3|4`（分档见 SPEC §2.2：T1 浅 ~ T4 cosmic）。
3. **`engine/upgrades.ts`**：`canPurchase` = ①逐条材料 `countInInventory(profile.inventory, itemId) >= qty` ＋ ②`profile.bankedGold >= cost.gold`；lock 原因 `notEnoughMaterials`（带缺口清单供 UI）/ `notEnoughGold`。`purchaseUpgrade` = 逐条 `removeFromInventory` ＋ `bankedGold -= cost.gold`。`getUpgradeBonuses` 不变。
4. **移除建设值**：删 `engine/death.ts::computeRawBuildingPoints` 及其调用（executeDeath/executeAscent 不再给点数）；`PlayerProfile.buildingPoints` 字段移除；`createInitialProfile` 删 `buildingPoints: 0`。
5. **存档迁移**：`SAVE_VERSION` 1→2（`state.ts:14`）；在 `migrateSave` 的 `while (v < SAVE_VERSION)`（`state.ts:207`）加 `case 1`：删 buildingPoints，`v = 2`。（Phase A 只处理删点数；灯塔字段 Phase B 再迁。）
6. **Mira 出售侧**（`engine/port.ts`）：加回购——T1/T2 可买，**买价 = 卖价 × markup（默认 ~2×）**；T3/T4 不可买；每种售卖物品带 `shopStock` 上限、每次回港补满（soft per-run 限量）。收购侧不变（所有材料仍可卖）。新增 `buyFromMira` + 店铺库存模型。
7. **UI**：`MiraShopView` 加购买；`UpgradePanel` 成本显示"材料 ×N ＋ Ng"+ 缺口高亮。
8. **回归**：更新 `playthrough-upgrades.ts`（材料+金币双账单：材料不够/金币不够都买不了、够了扣对）、`playthrough-economy.ts`（回购买价>卖价、`shopStock` 限量、T3/T4 不可买、金币买不了升级）、`playthrough-save.ts`（v1→v2 删 buildingPoints）。

## 关键约束 / 易踩坑
- **存档**：改 GameState 形状**必须** bump SAVE_VERSION + 在 migrateSave 加步骤（quirk #39）；Set 字段靠现有 replacer/reviver 自动 round-trip。
- **回归文化**（quirk #22/#26）：收尾**全绿**——typecheck + 全部 playthrough + scenarios + combat + mapgen + verify-tutorial。`playthrough.ts` 有 ~12% RNG flake（quirk #18），挂了重试一两次确认不是你引入的。
- **注册守卫**：`verify-tutorial.mjs` 按目录扫 data，加 JSON 忘登记会报错。
- **沙箱 git 提交**：**别在 sandbox 直接 `git commit`**（mount 删不掉 `.git` 锁、每次写都留死锁）——见记忆 **[Sandbox Git Commit]**：要么全程 Mac 端做 git，要么 `cp .git/index /tmp` + `GIT_INDEX_FILE` 绕过 + 事后 Mac 端 `rm -f .git/{index,HEAD}.lock .git/objects/maintenance.lock && git reset`。
- **作用域**：Phase A 只动经济。**别碰**灯塔数据模型 / 海图 reveal / nearest-lighthouse distance（Phase B/C）。

## 验收
- `npm run typecheck` 干净；SPEC §7 全部回归脚本绿。
- 旧存档迁移成功（无 buildingPoints、能正常买升级）。
- 升级在"材料不够 / 金币不够"时都买不了；满足时正确扣材料 + 扣金币；加成照旧生效。

## 收尾
更新 `docs/STATUS.md`（§5 进度 + §3/§6 + 新 quirk）、`docs/深海回响_基建地图_SPEC.md`（Phase A 打勾）、自动记忆（[Base+Map Revamp] 进度 + MEMORY.md 索引），并把本文件 `docs/NEXT_SESSION_PROMPT.md` 改写成 **Phase B（灯塔数据模型）** 的 prompt，让下个 session 接上。
