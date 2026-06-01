# 深海回响 · 基建 + 地图 revamp SPEC

> 状态：**设计已锁**。2026-06-01 与作者敲定五项决策后落稿，供实装与后续 session 接手。
> 基线 commit：`ff2cc77`（MVP 之后全部工作）。
> **实装进度**：✅ **Phase A（材料经济）+ Phase B（灯塔数据模型）已实装（2026-06-01）**——见 §8 + STATUS quirk #50/#51。Phase C（海图集成 + 修复循环）/ D 未开工。
> 设计原则同项目要求：可扩展、可维护，每阶段都能独立过回归。

---

## 0. 一句话目标

把"靠 **建设值**（每潜按 depth/node 计分）买升级"换成"靠 **从深潜带回的不同材料**（每种攒够 1–10 个）建设基地"；并把单一岸边港口扩成**多座灯塔基地**——每座灯塔点亮（揭示 + 拉近）它周围的海域。深度门控不再靠抽象分数，而是靠**"稀有材料只在深处掉"**这一事实，天然堵死浅水刷级。

---

## 1. 核心循环（三根支柱合成一条线）

```
下潜 → 带回按深度分档的材料 → 花材料 修复/升级灯塔 + 升级潜水装备
      → 每座灯塔点亮它周围的海域（揭示 POI + 出海更近）
      → 更深的海域掉更稀的材料 → 修复下一座灯塔 …
```

所有三个 pillar 共用这一条循环：材料经济（Pillar 1）是燃料，灯塔（Pillar 2）是花材料的去处 + 解锁更深海域的钥匙，空间地图（Pillar 3）让"灯塔放哪"有意义。

---

## 2. Pillar 1 — 材料经济（替换建设值）

### 2.1 决策
- **没有抽象"材料货币"**：不是一个 `materials: number` 池，而是 **具体材料物品 + 数量需求**。每个升级要求"攒够 N 个某材料"（N≈1–10），可要求多种。
- **建设值（`profile.buildingPoints`）整体移除**，连同 `computeRawBuildingPoints`（depth/5 + 去重节点数）。反刷机制改由"材料分档"承担。

### 2.2 材料分档（tier，按掉落深度）
给每个 material 物品加 `tier: 1 | 2 | 3 | 4` 字段（写在 `items.json` 的 def 上，新材料自带 tier，无需中心表）。当前材料初分：

| tier | 深度带 | 材料（现有） | 来源 |
|---|---|---|---|
| **T1** | 0–25m 浅 | coral_shard / shark_tooth / lobster / canned_food / old_fishing_net | 浅礁事件、暗礁鲨(教学) |
| **T2** | 25–44m 中 | brass_fitting / barracuda_jaw / crab_chitin | 灯塔礁中段、梭鱼、蛛蟹 |
| **T3** | 40–55m 深 | cave_octopus_beak / eel_skin | 洞穴章鱼、盲鳗 |
| **T4** | 50m+ / cosmic | lantern_gland（+ 未来深水掉落） | 沉灯水母 |

> tier 只是"难度/深度标签"，引擎按它做门控与 UI 展示；具体数值后续平衡。

### 2.3 升级成本模型（材料 + 金币 双资源）
`UpgradeDef.cost: number` → 双资源账单：

```ts
interface MaterialCost { itemId: string; qty: number; }            // qty ∈ [1,10] 量级
interface UpgradeCost { materials: MaterialCost[]; gold: number; }  // 材料 + 金币都要
```

**金币必要但不充分**：每个升级 / 灯塔都有金币价（玩家花金币的主要去处之一），但金币**不能替代材料**——仍要实打实的（深）材料。所以"下深拿料"门控不破，金币只是额外财富门槛（缺钱就卖富余材料换，见 §2.5，不死锁）。

升级**等级越高 → tier 越高 + 金币越多**，强制下深：

- Lv1 = 纯 T1 材料 + 少量金币
- Lv2 = T1 + T2 + 中等金币
- Lv3 = T2 + T3 + 较多金币
- 终局 = T4 + 大量金币

**现有 5 个升级的起始账单**（示意值，待平衡）：

| 升级 | 旧 cost(点) | 新账单（材料 × 数量 ＋ 金币） |
|---|---|---|
| dockyard.lv1 | 10 | coral_shard×6, old_fishing_net×3 ＋ 20g |
| tankhouse.lv1 | 12 | shark_tooth×4, lobster×4 ＋ 25g |
| salvage_guild.lv1 | 15 | coral_shard×5, brass_fitting×3 ＋ 30g |
| salvage_guild.lv2 | 30 | brass_fitting×4, crab_chitin×3, cave_octopus_beak×2 ＋ 70g |
| salvage_guild.lv3 | 50 | cave_octopus_beak×4, eel_skin×3, lantern_gland×1 ＋ 150g |

### 2.4 引擎改动
- `engine/upgrades.ts`：
  - `canPurchase`：旧"`buildingPoints < cost`"→ ①逐条 `MaterialCost` 查 `profile.inventory`（`countInInventory(...) >= qty`）＋ ②`profile.bankedGold >= cost.gold`。锁定原因 `notEnoughMaterials`（附缺口清单供 UI 显示"还差 brass_fitting ×2"）/ `notEnoughGold`。
  - `purchaseUpgrade`：旧"`buildingPoints -= cost`"→ 逐条 `removeFromInventory` ＋ `bankedGold -= cost.gold`（helper 已存在，quirk 见 STATUS §3 state.ts）。
  - `getUpgradeBonuses` 不变（仍按 unlockedUpgrades 聚合）。
- `engine/death.ts`：删 `computeRawBuildingPoints` 及其调用；`executeDeath`/`executeAscent` 不再给点数。`PlayerProfile.buildingPoints` 字段移除（见 §6 迁移）。
- `engine/state.ts::createInitialProfile`：删 `buildingPoints: 0`。

### 2.5 材料 ↔ 金币 经济（all-sellable + 回购 + 限量）
- **金币 = 消耗品/服务**（补气、医疗包、修缮）；**材料 = 永久基建**（灯塔 + 装备升级）。但材料也是合法收入来源（见下）。
- **所有材料都可卖给 Mira**（income）。沿用 `MIRA_BUY_RATIO = 0.8`，卖价 = `floor(sellPrice × 0.8)`。
- **低阶材料（T1/T2）可从 Mira 回购**，**买价 > 卖价**（markup，默认 ~2×）。**高阶材料（T3/T4）只卖不买**——只能靠下深拿到，保住"深度 = 进度"门控。
- **升级 / 灯塔账单 = 材料 ＋ 金币（双资源，§2.3）**：金币是**必要但不充分**——每个升级都有金币价（gold 的主要去处之一），但金币**不能替代材料**，仍要实打实的（深）材料，所以"高阶升级强制下深"门控不破；缺钱就卖富余材料换（不死锁）。此外金币还能买 T1/T2 材料 + 消耗品/服务。
- **店铺限量（shop stock）**：Mira 出售的每种物品带 `shopStock` 上限，购买递减、每次回港补满（soft per-run 限量），防止用金币无限刷低阶材料喂升级。
  - 【确认点】"任何在店里出售的东西都有 max count" 按**出售侧限量**（商人备货上限）实现。若还想要**卖出侧**限量（玩家一次最多卖 N / 商人最多收 N），也能加，说一声。
- **不引入独立 stockpile**：all-sellable 已解决"建完后库存成负担"（富余直接卖）。材料就是普通 `profile.inventory` 物品；回港并入后**不参与衰减**（衰减只作用未回收尸体上的物品）。
- **未来钩子：秘密商人**——卖稀有材料 / 或只收特定材料作"货币"（以物易物，不收金币）。预留设计位，本次不实装（见 §9）。

---

## 3. Pillar 2 — 灯塔基地（多基地）

### 3.1 数据模型（持久，进存档）
新增 `profile.lighthouses: Lighthouse[]`：

```ts
interface Lighthouse {
  id: string;
  name: string;
  mapX: number; mapY: number;     // 海图坐标（0–1 归一化，复用 POI 那套）
  level: number;                  // 决定点亮半径 + 揭示哪些 POI + 可建哪些灯塔升级
  builtUpgrades: Set<string>;     // 该灯塔自己的升级轨（与全局装备升级区分）
  // —— 留作未来 invasion/defense，现在 inert（不读不写逻辑）——
  integrity?: number;             // 完整度/血量
  region?: string;                // 锚定的海域 region id
}
```

- **家＝第一座灯塔**：现有岸边港口重构为 `lighthouse.home`（呼应"旧灯塔"lore），存档迁移时种入（§6）。
- Aldo / Mira 仍挂在 home 灯塔（港口 hub 不变）；其它灯塔是前哨。

### 3.2 获取方式：修复废弃灯塔（restore）
- 下潜中可遇到**废弃灯塔点**（一个特殊 dive 节点 / 事件，`lighthouse_ruin`）。抵达后给出"修复"选项：付一份**材料 + 金币**账单（T2/T3 量级，复用 §2.3 双资源模型）。
- 修复成功 → 往 `profile.lighthouses` push 一座新灯塔（坐标取自该点位）→ 它上线进海图、点亮其海域。
- 这把"下潜"与"基建"接成一条目的链：潜得越深越能找到/够材料修复越远的灯塔，越远的灯塔又开更深的海域。

### 3.3 升级轨：全局装备 vs 每灯塔
- **潜水装备（随身）= 全局**：tank / suit / light / tool（氧、容量等）仍走现有 `profile.unlockedUpgrades` + `getUpgradeBonuses`。即 `tankhouse` 这类留全局。
- **灯塔设施 = 每灯塔**：点亮半径、（后续）服务、（更后）防御，写在该灯塔的 `builtUpgrades`。新增 `engine/lighthouses.ts` 管这套（`canBuildAt(lh, upgradeId)` / `buildAtLighthouse` / `getLighthouseBonuses(lh)`），与全局 upgrades.ts 平行、互不污染。
- `dockyard` / `salvage_guild` 归属待定：建议 `dockyard`（解锁海域/槽位）迁成 home 灯塔的灯塔升级；`salvage_guild`（保鲜/尸体）仍全局（它是随身能力）。**【tunable】**

### 3.4 v1 灯塔效果："点亮周围海域" = 揭示 + 拉近
- **揭示（reveal）**：POI 只有落在某座**已拥有灯塔**的点亮半径内才可见/可出海；半径随灯塔 `level` 扩大。home 灯塔默认点亮现有 4 个近岸 POI，所以**当前行为不变**。
- **拉近（reach）**：一次下潜的 `distance`（出海预耗氧 + turn）按**最近的已拥有灯塔**算，而非永远从岸边。→ 前哨灯塔同时"解锁 + 降低"它那片的出海成本，**放哪有意义**。
- 尸体回收提示 / 自由上浮 / 减压加速 等"服务型"效果**留作后续灯塔升级**，v1 不做。

---

## 4. Pillar 3 — 空间地图钩子（仅定机制，大图留后）

目标：现在把数据模型钉死，等以后地图变大、灯塔变多时无需再迁移。

- POI 与灯塔都带 `mapX/mapY`（POI 已有）+ 可选 `region`（海域分区 id）。
- **`distance` 从"作者写死的数字"过渡到"按最近灯塔算"**：v1 保留 `chart_pois.json` 里写死的 distance 作 fallback（不破坏现有 4 个 POI 的手感），引擎优先用"到最近灯塔的 mapX/mapY 距离"换算；地图扩张后再彻底切到计算值。
- **invasion / defense 钩子（inert）**：`Lighthouse.integrity` + region 级 `threat` 字段 + 一个 stub 事件类型 `lighthouse_event` 全部预留但不接逻辑、不进任何分支。等真要做防御战时填，不必再 bump 存档。

---

## 5. 类型 / 数据改动汇总

| 文件 | 改动 |
|---|---|
| `types/state.ts` | `PlayerProfile`：删 `buildingPoints`；加 `lighthouses: Lighthouse[]`。新增 `Lighthouse` 类型。 |
| `types/upgrades.ts` | `UpgradeDef.cost: number` → `UpgradeCost{ materials: MaterialCost[]; gold: number }`；新增 `MaterialCost`/`UpgradeCost`。 |
| `types/chart.ts` | `ChartPoi` 加可选 `region`；（distance 语义说明更新，字段不变）。 |
| `types/items`（events.ts/相关） | material 物品 def 加 `tier: 1–4`。 |
| `data/items.json` | 给每个 material 标 `tier`。 |
| `data/upgrades.json` | 每个升级 `cost` 改成 `{ materials:[…], gold:N }`。 |
| `data/chart_pois.json` | 现有 POI 不动（distance 作 fallback）；后续加 region。 |
| `engine/upgrades.ts` | canPurchase / purchaseUpgrade 改"材料 ＋ 金币"双账单；lock 原因 notEnoughMaterials / notEnoughGold。 |
| `engine/lighthouses.ts`（新） | 灯塔注册/修复/每灯塔升级/灯塔加成/最近灯塔距离/点亮判定。 |
| `engine/chart.ts` | generateChart 读 `profile.lighthouses` 做 reveal + nearest-lighthouse distance。 |
| `engine/death.ts` | 删 computeRawBuildingPoints 及调用。 |
| `engine/state.ts` | createInitialProfile 调整；SAVE_VERSION 1→2 + 迁移步骤。 |
| `engine/port.ts` | Mira 加**出售侧**：回购 T1/T2（买价=卖价×markup）+ `shopStock` 限量/回港补货；收购侧所有材料都收（income）。新增 `buyFromMira` + 店铺库存模型。 |
| `ui/SeaChartView.tsx` | 渲染灯塔节点 + 点亮范围；POI 可见性读灯塔。 |
| `ui/UpgradePanel.tsx` | 成本从"X 点"改成"材料 ×N（缺口高亮）"。 |
| 新 UI | 灯塔升级/修复界面（可复用 UpgradePanel 模式）。 |

---

## 6. 存档迁移（SAVE_VERSION 1 → 2）

`engine/state.ts::migrateSave` 的 `while (v < SAVE_VERSION)` 已有 scaffold（state.ts:207 注释模板）。步骤：

1. `SAVE_VERSION = 2`。
2. `while` 里加 `case 1`：
   - 删 `buildingPoints`（直接丢；旧点数不折算——内容期还早，存档量极小）。
   - 种入 home 灯塔：`lighthouses = [{ id:'lighthouse.home', name:'旧灯塔', mapX:.., mapY:.., level:1, builtUpgrades:new Set() }]`，坐标取岸边。
   - `unlockedUpgrades` 里属于"灯塔设施"的（若 dockyard 迁为灯塔升级）搬进 home 灯塔的 `builtUpgrades`；其余留全局。
   - `v = 2`。
3. `builtUpgrades` 是 Set → 复用现有 `{__set:[…]}` replacer/reviver 自动 round-trip（加 Set 字段无需改序列化，见 STATUS quirk #39）。

---

## 7. 回归计划（项目回归文化，quirk #22/#26）

- `playthrough-upgrades.ts`：改"材料 ＋ 金币"双账单——断言"材料不够 / 金币不够 都买不了；够了扣对材料 ＋ 扣金币；加成生效"。
- `playthrough-economy.ts`：所有材料可卖；T1/T2 可回购(买价>卖价)、T3/T4 不可买；`shopStock` 限量 + 回港补货；金币买不了升级。
- `playthrough-chart.ts`：加灯塔 reveal（无灯塔→POI 不可见）+ nearest-lighthouse distance 断言。
- `smoke-chart-ui.tsx`：海图渲染灯塔节点 + 点亮范围 + 升级面板材料缺口文案。
- `playthrough-save.ts`：v1→v2 迁移断言（旧档→home 灯塔 + 无 buildingPoints）。
- **新 scenario 组**（按 quirk #26 子目录 + 独立脚本）：`scenarios/lighthouse/` + `scripts/playthrough-lighthouse-scenarios.ts`——覆盖修复废弃灯塔账单、灯塔上线后 reveal/reach 变化。
- 收尾全绿：typecheck + 全部 playthrough + scenarios + combat + mapgen + lighthouse + verify-tutorial。

---

## 8. 实装阶段（每阶段独立可过回归）

- ✅ **Phase A — 材料经济**（**已实装 2026-06-01**）：cost 模型 `UpgradeCost{ materials: MaterialCost[]; gold }`、items `tier 1–4`、canPurchase/purchaseUpgrade 双资源（材料缺口 + 金币）、删 buildingPoints（types/engine/UI/脚本全删）、SAVE_VERSION→2（v1→v2 删点数）、UpgradePanel 账单缺口高亮、**Mira 回购(T1/T2 买价=卖价×2)+`shopStock`(T1=8/T2=4) 限量出售侧 + 回港补满**、改 `playthrough-upgrades.ts`/`-economy.ts`/`-save.ts` + `smoke-chart-ui.tsx` J/K。**自洽可发**（灯塔还没来，升级照常买，只是改用材料+金币）。落地细节 + 易踩坑见 STATUS quirk #50。
- ✅ **Phase B — 灯塔数据模型**（**已实装 2026-06-01**）：`Lighthouse` 类型（`types/lighthouse.ts`）、`profile.lighthouses`、home 灯塔种入（`createHomeLighthouse`）+ 迁移补全（SAVE_VERSION 2→3 `case 2`）、`engine/lighthouses.ts`（每灯塔升级轨 canBuildAt/buildAtLighthouse + getLighthouseBonuses + nearestLighthouse 距离工具，与全局 upgrades.ts 平行）+ `data/lighthouse_upgrades.json`（信标占位轨）。**灯塔 inert**（没接 chart/dive/UI，reveal/reach 留 Phase C）；`dockyard` 暂仍全局（归属决策留 Phase C）。回归：`playthrough-lighthouse.ts` + `-save` v2→v3。落地细节见 STATUS quirk #51。
- **Phase C — 海图集成 + 修复循环**：chart.ts reveal + nearest-lighthouse distance、`lighthouse_ruin` 下潜点/事件 + 修复账单、SeaChartView 渲染灯塔、新 `scenarios/lighthouse/` + 脚本、`playthrough-chart.ts`/`smoke-chart-ui.tsx` 更新。
- **Phase D（未来，仅占位）**：invasion/defense——本次只确保 §3.1/§4 的 `integrity`/`threat`/`lighthouse_event` 字段预留，不写逻辑。

---

## 9. Tunable / 未来钩子（一处汇总，方便后续调）

- 材料 ＋ 金币账单具体数值（§2.3 示意值，含各升级金币价）。
- 经济数值（§2.5）：Mira 回购 markup 倍率（默认 ~2×）、各档 `shopStock` 上限、补货节奏（默认每次回港补满）；T3/T4 是否也开放回购（默认否=只卖不买）。
- 卖出侧是否也限量（玩家/商人单次成交上限，§2.5 确认点）。
- 秘密商人（§2.5）：卖稀有材料 / 以特定材料易物，未来实装。
- `dockyard`/`salvage_guild` 归全局还是迁灯塔（§3.3，当前建议 dockyard→灯塔、salvage_guild 全局）。
- 灯塔点亮半径随 level 的扩张曲线（§3.4）。
- distance 何时从 fallback 切到纯计算值（§4，地图扩张时）。
- 旧 buildingPoints 是否折算成材料补偿（§6，当前 = 直接丢）。
- 灯塔服务型效果（尸体提示/自由上浮/减压）何时作为灯塔升级加入（§3.4）。
- invasion/defense 全套（Phase D）。

---

## 10. 决策记录（2026-06-01 锁定）

1. **材料模型**：无抽象货币；具体材料物品 + 数量需求（每种攒 1–10），高级升级要更深/更稀材料。
2. **多灯塔获取**：修复下潜中发现的废弃灯塔。
3. **升级归属**：随身潜水装备全局；灯塔设施每灯塔。
4. **v1 灯塔效果**：揭示 + 出海拉近（服务型留后续灯塔升级）。
5. **建设值**：整体移除。
6. **材料经济**（2026-06-01 续敲）：所有材料可卖（收入源）；T1/T2 可回购（买价>卖价），T3/T4 只卖不买；金币另可买 T1/T2 材料 + 消耗品；店铺出售侧限量（每回港补满）；秘密商人（卖稀材 / 以物易物）留作未来；不引入 stockpile，材料即普通 inventory 物品。
7. **升级双资源**（2026-06-01 续敲）：每个升级 / 灯塔账单 = 材料 **＋ 金币**；金币必要但不能替代材料（高阶仍强制下深，缺钱卖富余材料换、不死锁），给金币一个核心去处。
