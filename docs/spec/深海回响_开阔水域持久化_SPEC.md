# 深海回响 · 开阔水域持久化 SPEC（把「持久洞」泛化成 dive-target 无关的持久注册表）

> 来源：2026-07-17 Cowork 交互 session · Opus 设计。**本 SPEC 定架构 + 分叉收口，数值/命名细节留实装期**（`[[defer-number-tuning]]`）。
> 关系：把 `深海回响_多口持久洞_SPEC.md`（持久注册表 + 门户/绑定模型）与 `深海回响_开阔水域_SPEC.md`（声呐渲染 + mapgen + 贴底节点）两条线**在持久化层收口**——开阔水域＝没有墙的洞穴，故不做第二套下潜系统，而是把现有「持久洞」机制**泛化**成对「洞穴 + 开阔持久海域」通用的一条 load-or-generate 路径。
> **本 SPEC 只碰持久化 / 下潜编排，不碰渲染**（`openWaterSdf`/`shadeSonarSdf`/海床 contour 全归开阔水域渲染 SPEC·§7）。
> 关联 quirk：#98「同地点同 seed（确定性重生）」· #99「未发布不写迁移·版本不符即弃档」· #104「并发隔离」· #130/#psm「车道」。

---

## §0 北极星

**开阔水域＝没有墙的洞穴。** 它与洞穴在持久化 / 下潜编排上是**同一类东西**：一张可以被冻结进存档、被多个海图 POI 共享、跨 run 续存已探与采尽的地图。唯一区别在渲染层（洞穴＝隧道并集 `caveSdf` / 开阔＝边缘型海床 `openWaterSdf`）和拓扑形态（洞穴＝迷路多口 / 开阔＝层状 DAG），**那两处不在本 SPEC 内**。

因此本 SPEC 的核心动作**不是**给开阔水域造一套新的持久系统，而是把 `深海回响_多口持久洞_SPEC.md` 已经实装的持久机制**泛化成 dive-target 无关**：注册表、分叉收口、冻结 / overlay / 写回、门户抽象，洞穴与开阔海域**共用同一条轨**。

### 为什么开阔水域也要「冻结存图」（而不是只靠 #98 确定性重生）

现状：开阔水域下潜走 `generateDiveMap`（层状·`mapgen-layered.ts`）**每潜重生**，靠 #98 `seedKey=poi.id` 保证「同 POI → 同一张确定性图」+ 采尽 overlay。单入口、无运行时突变的 MVP 开阔海域，其实**确定性重生 + 一份持久 explored 就够**。但泛化成「冻结进注册表」有三条硬理由，与多口洞 §0 同源：

1. **多入口共享同一空间**（future·§5）：多个 POI 通向同一片海域时，各 POI 各自 `seedKey` 会生成**互不相干**的图；确定性重生托不住「一片海、多个口」。
2. **运行时地图突变**（future）：水流 / 塌陷 / 潮汐淹没改写地图时，确定性重生会把改动**冲掉**；实体化进存档才托得住。
3. **架构统一**（本期主因）：开阔与洞穴走**同一条持久轨**，就不用维护两套持久模型——这正是「别做成第二套下潜系统」的落地。

> 结论：即便 MVP 单入口开阔海域技术上能靠 #98 + 持久 explored 凑合，**仍按「冻结存图」实装**，与洞穴同轨。这是架构决定，不是性能决定。

### 泛化到底新增了什么（别夸大工作量）

因为 zone 下潜的 `'save'` 采集**本来就按 `poiId` 持久**（`profile.harvestedResources`·重生的图会被 `applyHarvestDepletion` 抹平采尽点），泛化真正**新增的**只有三样：

- **已探雾持久**（`explored` 跨 run·驱动声呐图「已探片预亮」）——这是现状确定性重生**做不到**的。
- **冻结存图**（替代每潜确定性重生·给多入口 / 运行时突变铺底座）。
- **多入口**（§5·本期 defer）。

采尽 / 尸体 overlay、seedKey 确定性、渲染——**全是现成机制**，泛化只是把它们的记账 key 从 `poiId` 扩成「洞 / 海域 id」，并让注册表对两类 target 通用。

---

## §1 注册表泛化

### §1.1 现状（洞穴专用）

```ts
// types/state.ts · PlayerProfile（现有·多口持久洞 SPEC §2.1）
caveMaps: Map<string, PersistentCave>;   // caveId → 冻结图 + 持久探索态

// types/dive.ts · 现有
interface PersistentCave { caveId: string; map: DiveMap; explored: Set<string>; portals: CavePortal[]; }
interface CavePortal { nodeId: string; kind: 'entrance' | 'exit'; depth: number; region: CaveRegion; }
```

- 加载器 `engine/caves.ts::getCave/allCaves/persistentExploredForRun/cavePortalsForChart`。
- run 侧 `RunState.caveId?`（写回时按它把 explored/harvest 落回正确的 `caveMaps[caveId]`）。
- 序列化：`saveReplacer/saveReviver` 的 `__map` 分支通用（value 内含 `DiveMap` 纯对象 + `explored:Set` 自底向上 revive·**零新序列化代码**）。

### §1.2 泛化目标

把「只登记洞穴」的注册表泛化成对「洞穴 + 开阔持久海域」**通用的持久图注册表**。语义上，注册表 key 是一个**稳定 dive-target id**（洞穴 `cave.<短名>` / 开阔海域 `sea.<短名>`·独立命名空间·kind-agnostic string），value 是该 target 的冻结图 + 持久态，**与 target 是洞还是海无关**。

### §1.3 命名建议（推荐 + 理由·实装期可再定）

**推荐：把注册表泛化更名为 `profile.diveMaps: Map<string, PersistentDiveMap>`**，记录类型 `PersistentCave → PersistentDiveMap`，其 `caveId` 字段 → `id`（target-neutral）；run 侧 `RunState.caveId → RunState.diveMapId`。

理由：

1. **单一真相不能骗人**：字段一旦同时装洞穴和开阔海域，还叫 `caveMaps` 就是一条**误导性的名字**——正是 CLAUDE.md 警告的「散文随 session churn 丢失」那类腐烂（misleading name = 持久的谎）。中性名字才是不会误导下个 session 的单一真相。
2. **TS 让重命名安全**：这是纯机械 rename，编译器会焊出所有引用点（不是「推倒重来」·符合 `[[correctness-over-minimal]]`「最正确 ≠ 重写、但语义正确 > 最小 diff」）。
3. **消费者自动泛化**：`persistentExploredForRun(profile, run)` 现读 `profile.caveMaps.get(run.caveId)?.explored`——更名后自动对开阔海域生效（声呐图「已探片预亮」白拿·§7）。

**动作范围**（一条机械 rename 车道·§8 Lane A）：`caveMaps`→`diveMaps`、`PersistentCave`→`PersistentDiveMap`、record `caveId`→`id`、`RunState.caveId`→`diveMapId`、`hydrateGameState` / `createInitialProfile` / `createNewRun` 对应改。

**保持不动**（分层·加法扩展）：

- **每类 target 各留自己的生成器输入**——洞穴保留 `CaveGenParams` / `data/caves.json` / `generatePersistentCaveMap`（不动·渲染与拓扑是洞穴专属）；开阔海域**复用现有 `generateDiveMap`**（层状·§2.3），MVP 不新增数据文件 / 生成器。注册表中性、生成器分家＝干净分层。
- **id 命名空间**：洞穴 `cave.<短名>`（现有）、开阔 `sea.<短名>`（新增约定）——注册表 key 只是字符串，kind-agnostic。
- **`CavePortal`/`CaveRegion`**：本期开阔海域单入口（§5），portals 空数组即可（`cavePortalsOf` 扫 `portalKind` 节点·层状开阔图不标 `portalKind` ⇒ 天然 `[]`）；不必为开阔改门户类型。多入口落地时再定是否把 `CavePortal` 也更名。

> **可再定的备选（churn-averse）**：若实装期作者偏好最小 diff，可**保留 `caveMaps` 名不变、只扩语义 + 扩文档注释**（`__map` 序列化本就通用·纯加登记条目不必改类型）。语义正确性 > 标识符，两条路都能通；本 SPEC 推荐更名，但这是实装期细节，非架构约束。

---

## §2 分叉收口（`getPersistentTarget` 统一解析器）

### §2.1 现状分叉

`startDiveFromPoi`（`engine/dive-start.ts`）现在在 `poi.caveEntry` / `getCave` 处分叉：

```ts
// 现有（dive-start.ts ~417）
if (poi.caveEntry && getCave(poi.caveEntry.caveId)) {
  return startDiveIntoCave(state, poi);          // 持久洞路径：load-or-generate caveMaps[caveId]
}
// ...否则走普通 zone 路径（createNewRun + seedKey=poi.id 每潜确定性重生 + harvest by poiId）
```

普通 zone 路径已经透传 `seedKey: poi.id`、`harvestedItemIds = profile.harvestedResources.get(poiId)`、`harvestedNodeIds = run.harvestedNodes.get(poiId)`（`startDive` 内解析·#98 + 采尽 overlay）——这条就是 QA 夹具 / 教学关 / 非持久 POI 的「确定性重生」兜底。

### §2.2 统一解析器（提案）

引入一个 dive-target 无关的解析器 `getPersistentTarget(poi)`（提案名·放 `engine/dive-start.ts` 或新 `engine/persistent-dive.ts`），把**洞穴入口 + 开阔持久海域**都解析成同一条 load-or-generate 路径：

```ts
// 提案·discriminated union：告诉 load-or-generate 该用哪个生成器 + 入口解析
type PersistentTarget =
  | { kind: 'cave'; id: string; entry: NonNullable<ChartPoi['caveEntry']> }
  | { kind: 'openwater'; id: string; entry: NonNullable<ChartPoi['seaEntry']> };

/**
 * 把 POI 解析成持久 dive-target（提案·统一收口）：
 *  - poi.caveEntry 且 getCave(id) 已登记 → { kind:'cave' }
 *  - poi.seaEntry  且 getSea(id) 已登记  → { kind:'openwater' }（提案·§2.4）
 *  - 未登记 / 无绑定 → undefined（走普通 zone 路径·确定性重生兜底）
 * 「未登记即兜底」＝把现有 getCave(undefined)→undefined→旧路径 的模式推广到两类 target。
 */
function getPersistentTarget(poi: ChartPoi): PersistentTarget | undefined;
```

`startDiveFromPoi` 收口成一条判断：

```ts
const target = getPersistentTarget(poi);
if (target) return startDiveIntoPersistent(state, poi, target);   // 统一路径（洞 + 海共用）
// ...否则普通 zone 路径（确定性重生·seedKey=poi.id·harvest by poiId·一行不改）
```

### §2.3 `startDiveIntoPersistent`（提案·统一 load-or-generate）

把现有 `startDiveIntoCave` 的骨架泛化成 target 无关的 `startDiveIntoPersistent(state, poi, target)`——它是**今天 `startDiveIntoCave` 的直接推广**，五步与现有逐条对应，只在「用哪个生成器 / 怎么解析入口」两处按 `target.kind` 分派：

```
1. load-or-generate：cave = profile.diveMaps.get(target.id)
   缺 → 按 kind 生成并冻结：
     cave       → generatePersistentCaveMap({zone, rng:caveSeededRng(id)}, params)   // 现有·不动
     openwater  → generateDiveMap({zone, seedKey:id, profileFlags, deaths, ...})     // 复用现有层状生成器
   冻结记录 { id, map, explored:new Set(), portals: cavePortalsOf(map) }              // openwater→portals 天然 []
   写进 diveMaps（首次进 = 生成 + 写存档）。

2. 解析起手节点：
     cave       → resolveCaveEntryNode(cave, entry, poi.id)   // 现有·多口门户/区域/深度确定性挑
     openwater  → cave.map.startNodeId                        // MVP 单入口（多入口 defer·§5）

3. 本潜工作副本：workMap = cloneDiveMap(cave.map); workMap.startNodeId = 起手节点
   applyCaveOverlays(workMap, { deaths, zoneId, harvestedItemIds: profile.harvestedResources.get(id), rng:… })
     // 现有 overlay 已通用（尸体 + 采尽抹平·加载时叠加·不冻进图）——openwater 无需改

4. run = createNewRun({ zoneId, diveMapId:id, poiId:poi.id, bonuses, equipment })
   run.diveModifier = poi.modifier

5. startDive(s, zoneId, { prebuiltMap: workMap })   // 现有统一收尾（跳过每潜重生·overlay 已叠）
```

要点：

- **`applyCaveOverlays` 已经是 target 无关的**（`mapgen-cave.ts`）：候选＝非门户 / 非地标节点，叠尸体（读 `profile.deaths`）+ `applyHarvestDepletion`（save 级采尽抹平）。开阔海域直接复用，不改一行；实装期可顺手更名 `applyPersistentOverlays`（可选·§9）。
- **zone 来源**：洞穴用 `getCave(id).zoneId`；开阔海域用 `poi.zoneId`（或 §2.4 海域 params 的 zoneId）。
- **thermal 入潜门不变**：所有下潜路径（含 `prebuiltMap`）统一过 `startDive` 内的 `thermalAccess` 唯一闸；开阔海域中性 intensity 0 ⇒ 恒 full ⇒ 放行（逐字节不变）。
- **未登记兜底**：`getPersistentTarget` 对未登记 id 返回 `undefined` → 落回普通 zone 路径。这把现有 `getCave(undefined) → undefined → 旧路径` 的健全回退推广到两类 target，保住 QA 夹具 / 教学关 `linearScripted` 的确定性重生（它们不进注册表·check-cave-bindings 类守门焊死悬空绑定为红·但运行时仍兜底防白屏）。

### §2.4 开阔持久海域的登记 + POI 绑定（提案）

对称于洞穴的 `caves.json` + `getCave` + `poi.caveEntry`，开阔持久海域需要：

- **登记（提案）**：一条「哪些开阔海域是持久的」的数据 + 加载器。**推荐 MVP 复用现有 `generateDiveMap`，故不必新增生成器**；是否新增 `data/seas.json` + `getSea(id)` 取决于开阔海域是否需要超出 zone 本身的作者参数（尺寸 / 多 tag patch / 门户预留数）。MVP 若「一片海＝一个 zone + 单入口」，甚至可先用一张**极薄的登记表**（`sea.<id> → { zoneId }`）或直接复用 zone 注册 + 一个 `poi.seaEntry` 标记位。**此为实装期细节**（§9）。
- **POI 绑定（提案）**：新增 `ChartPoi.seaEntry?: { seaId: string; /* entryNodeId?/mouthDepth?（多入口 defer·§5） */ }`，与现有 `poi.caveEntry` 并列、由 `getPersistentTarget` 一并解析。

> **为什么加 `seaEntry` 而不是复用 / 更名 `caveEntry`**：洞穴入口有更丰富的语义（多门户 region/depth 绑定 + `entranceBlocked` 温度门），开阔海域 MVP 只需单入口。两个 binding 形状 + 一个统一解析器 ≠「第二套系统」——持久轨（注册表 / 冻结 / overlay / 写回 / load-or-generate）是**同一条**；只是绑定形状按 kind 有别（加法·符合 `[[correctness-over-minimal]]`）。**未来可选**把两者收成单一 `poi.persistentEntry`（§9 open）。

---

## §3 冻结范围

泛化后，一个持久 dive-target（洞 / 海）的状态严格三分——与多口洞 SPEC §4.3/§4.4 逐条同构：

| 层 | 内容 | 存储 | 生命周期 |
|---|---|---|---|
| **冻结**（跨 run·稳定真相） | 地图拓扑（nodes/edges/depth）+ **已探雾 `explored`** + 门户 `portals` | `profile.diveMaps[id]` | 首次进生成→冻结；再进加载续上次（含未来运行时突变就地改写这张图） |
| **加载时 overlay**（不冻进图·每潜按 live 状态重叠） | `'save'` 采尽抹平（`profile.harvestedResources[id]`）+ 尸体（`profile.deaths`） | 派生·叠在**本潜图副本**上 | 每潜 `applyCaveOverlays` 重算（确定性·冻结图保持干净） |
| **每潜刷新**（run 级·出洞即弃） | `'run'` 采尽（`run.harvestedNodes`）+ `scanMemory` + `stalker` + `visitedNodeIds` | `RunState`（不入 profile） | run 结束丢弃（`'run'` 档「下次重进刷新」） |

**写回（生还回港·`handleReturnToPort`·`engine/port.ts`）**：本潜 `visitedNodeIds` 并进 `diveMaps[id].explored`；`harvestedSaveItems` 并进 `harvestedResources[id]`（by target id）。**死亡不写回**（与现行「生还才落袋」`acquireIntoProfile` 语义一致）。

要点：**冻结的只有拓扑 + 已探 + 门户**；采尽与尸体**永远是加载时叠加的视图**（`mapgen-cave.ts::applyCaveOverlays` 现状即如此·不冻进图）。这与现行洞穴模型逐条一致——泛化只是把 overlay 的 harvest key 从 `poiId` 换成 target id。

---

## §4 可再生资源（现成机制·零新增 + 一个默认坑 + 候选守门）

### §4.1 「除非可再生、否则采完没有」＝直接落在现有 `'run' | 'save'` 采集档

作者要的语义**不需要任何新机制**——它就是现有的采集耗尽档（单一来源 `engine/items.ts::harvestPersistOf`）：

```ts
// engine/items.ts（现有·唯一来源·别在别处手抄 ?? 'run'）
// 'save'＝采完永久没（profile.harvestedResources）；'run'＝本 run 采空、下次重进刷新。
export function harvestPersistOf(itemId: string): 'save' | 'run' {
  return getItemDef(itemId)?.harvestPersist ?? 'run';
}
```

映射：

- **不可再生**（矿床 / 化石 / 埋藏物·「采完没有」）＝ `harvestPersist: 'save'` → 采到并生还后合并进 `profile.harvestedResources[id]`，任何口进都已采空（`applyHarvestDepletion` 抹平）。
- **可再生**（下次刷新）＝ `harvestPersist: 'run'`（默认）→ 本 run 采空、下次重进这片海又长回来。

开阔海域的贴底采集点（珊瑚 organic / 岩矿 `mine`-gated 矿物 / 沙下埋藏，见开阔水域 SPEC §4/§4a `{kind:'atSeabed'}` 门）**直接用这套**——无新增。

### §4.2 ⚠ 必须点明的默认值坑

**代码默认是 `'run'`（可再生），而作者对开阔海域采集点的心智默认是「采完没有」——两者相反。**

后果：写 openwater 采集内容时，**大多数矿床 / 化石 / 埋藏物 loot 若不显式标 `'save'`，会静默变成采不完**（默认 `?? 'run'` 每潜刷新）。这不会报错、不会有任何提示，只会让「稀有矿床」悄悄变成无限刷——是最容易漏、最难在测试里发现的一类内容 bug。

**内容约定**：openwater 贴底采集产出**默认显式写 `harvestPersist: 'save'`**，只有确实要可再生的（如快速再生的软珊瑚 / 藻类）才留 `'run'`。

### §4.3 候选机制：openwater 采集缺 `'save'` 就报警（regress 门）

按 CLAUDE.md「每加一条约定先问：能不能变成 `npm run regress` 里会失败的检查」，把 §4.2 的内容约定落成一个**候选守门**（`scripts/check-openwater-harvest.mjs`·并入 regress）：

> **候选规则**：凡被判定为「开阔海域有限矿藏」的 loot 物品，其 `harvestPersist` 必须是 `'save'`，否则 regress 红（除非显式白名单为可再生）。

落地需要先解决「怎么枚举『开阔海域有限矿藏』」——三个候选口径，**倾向后者**：

1. 扫贴底 / openwater tag（`sand`/`coral`/`rock`/`atoll`）事件池的 loot——耦合事件池结构，脆。
2. 扫带 `mine` capability-gate 或某 `MaterialRole` 的物品——只覆盖矿物，漏化石 / 埋藏物。
3. **（推荐）声明式意图 + 门反转默认**：给「有限矿藏」物品加一个数据标记（如 `ItemDef.deposit: true`，或复用材质角色），守门断言 `deposit ⇒ harvestPersist==='save'`（除非白名单）。这是「约定落成机制」的标准形——作者一旦声明「这是矿藏」，门就替他焊死「必须不可再生」，把易漏的默认坑翻转成显式意图。

**候选 · 非本期硬需求**（列为 §9 defer 项）：机制通即可，是否上门由作者定；口径 3 最省、最不误伤，但需加一个 `deposit`-类标记（小·纯 code·Sonnet/low）。

---

## §5 多入口（保留抽象·本期 defer）

开阔水域**设计上保留多入口**（一片持久海域可被多个海图 POI 通达，像洞穴换口进），但**本期 defer 不实装**——MVP 每片海域单入口。

**保留、别堵死的抽象**：

- 注册记录仍带 `portals: CavePortal[]`（开阔 MVP 为 `[]`）——多入口落地时填。
- `getPersistentTarget` / `startDiveIntoPersistent` 的 target-neutral 形状已经能容纳多入口：加多入口＝给 `seaEntry` 补 `entryNodeId?/mouthDepth?/regionBias?`（对称 `caveEntry`）+ 让 openwater 分支的「解析起手节点」从 `map.startNodeId` 换成 `resolveCaveEntryNode` 的开阔类比——**不重写轨**。
- 开阔水域 SPEC §6 已说「连洞穴 / 侧壁＝复用现有 portal + `traversalFlag`·现在只别堵死」——本 SPEC 与之一致：拓扑允许一个够深的节点带 portal，海图侧跨 beacon 接线归 future。

**本期只保证**：单入口 openwater 走通持久轨（冻结 / 已探续存 / save 采尽永久）；多入口的门户解析 / 海图同洞分组 = future（对齐多口洞 SPEC T3b）。

---

## §6 存档（#99·bump 弃档·零迁移）

泛化动了 `caveMaps` 的 schema（推荐更名 `caveMaps → diveMaps` + record `caveId → id` + `RunState.caveId → diveMapId`·§1.3）——形状变。按 quirk #99（未发布不写迁移·版本不符即弃档）：

- **直接 bump `SAVE_VERSION`**（`engine/state.ts`·当前值 **16**·bump 至 **17**·实装时以仓内真值为准、别手抄），在版本注释链续一条 `16→17（开阔水域持久化·caveMaps→diveMaps 泛化）`。
- **旧档下次启动即被 `clearSave` 清掉、从头开始**（`deserializeGameState` 版本不符 → null → `loadGame` 清档）。
- **零迁移代码**：`PersistentDiveMap` 无 schemaVersion、不写单洞 / 单海域迁移链（游戏未发布·`[[remove-sanity-system]]`/#99 同款约定）。
- **序列化零新代码**：`__map` 分支通用，`Map<id, PersistentDiveMap>`（内嵌 `explored:Set` + `map:DiveMap` 纯对象）天然 round-trip——更名不碰序列化。
- **hydrate**：`hydrateGameState` 单点补 `diveMaps: state.profile.diveMaps ?? new Map()`（对称现有 `caveMaps`/`harvestedResources`）。

> **注**：若实装期选了 §1.3 的 churn-averse 备选（保留 `caveMaps` 名·纯加登记条目·record 形状不变），则属于 #99(a)「纯加字段不必 bump」——可不 bump。但本 SPEC 推荐更名，故按「会 bump」规划。

---

## §7 渲染不动

**本 SPEC 只碰持久化 / 下潜编排，渲染层一行不改。** 开阔水域声呐仍是 `caveSdf` 的兄弟 `openWaterSdf`（边缘型海床 vs 并集隧道）+ 共享上色 `shadeSonarSdf` + 海床 contour 由节点派生 + 贴底节点 `seabedNodeIds`/`{kind:'atSeabed'}`——**全归 `深海回响_开阔水域_SPEC.md`**（§2/§3/§4a·已实装 #302/#305/#307）。

泛化与渲染的唯一交点是**只赚不赔**：注册表更名后，声呐图「已探片预亮」的现有消费者 `persistentExploredForRun(profile, run)`（读 `diveMaps.get(run.diveMapId)?.explored`）**自动对开阔海域生效**——开阔海域白拿「跨 run 已探片预亮」，无需任何渲染改动。这是**消费注册表**，不是改渲染。

---

## §8 实装拆分（建议车道）

> 每步过 regress（affected 选测·Mac 实跑）；append-only 文档（CHANGELOG/QUIRKS）只在 main 整合时写、别在 feature 树碰。沙箱 commit/push + 含 prod build 的全量 regress 留 Mac/nightly（`[[blue_regress_sandbox]]`/`[[sandbox_git_commit]]`）。

- **Lane A — 注册表泛化 + 存档 bump（先落·串行·是契约）**
  机械 rename：`caveMaps→diveMaps`、`PersistentCave→PersistentDiveMap`、record `caveId→id`、`RunState.caveId→diveMapId`；`SAVE_VERSION 16→17`；`hydrateGameState`/`createInitialProfile`/`createNewRun` 对应改；`check-cave-bindings` 引用改。**验收**：typecheck + `playthrough-save`（round-trip）+ `playthrough-cave`（洞穴路径 byte-identical·守泛化不撕已测）。
  → 模型：**Sonnet / medium**（纯机械 rename·TS 焊全站）；若 rename 面比预期广则 **Opus / medium**。
  触及：`types/state.ts`、`types/dive.ts`、`engine/caves.ts`、`engine/dive-start.ts`、`engine/port.ts`、`engine/mapgen-cave.ts`、`scripts/check-cave-bindings.mjs`。

- **Lane B — 分叉收口 `getPersistentTarget` + `startDiveIntoPersistent`（依赖 A）**
  把 `startDiveFromPoi` 的 `caveEntry` 分叉重构成统一解析器；`startDiveIntoCave` 收进 `startDiveIntoPersistent` 的 `kind:'cave'` 分支；加 `kind:'openwater'` 分支（复用 `generateDiveMap` 冻结 + 单入口）；加 `poi.seaEntry` 类型 + 开阔登记（§2.4·薄）。**验收**：洞穴路径回归全绿 + 新增「开阔海域首次进冻结 / 再进续已探 / save 采尽永久」playthrough。
  → 模型：**Opus / medium**（编排收口·需对齐 dive-start 既有透传）。

- **Lane C — 开阔持久海域内容 + 单入口 MVP（依赖 B + 作者地理骨架）**
  登记一片 QA 开阔持久海域（配合作者主线地理·开阔水域 SPEC §10「世界投放等 #1 地理骨架」）；接贴底采集内容（§4·`atSeabed` 门·矿藏默认 `'save'`）；验已探跨潜续存 + save 采尽跨口永久。
  → 模型：**Sonnet 或 Opus / medium**（内容 + 验收·数值 defer）。

- **候选 · Lane D — openwater 采集 `'save'` 守门（§4.3·可选·独立）**
  `deposit ⇒ harvestPersist==='save'` 门 + `ItemDef.deposit` 标记。可与 C 并行（不同车道·`scripts/**` + `types/items.ts` vs 内容 JSON）。
  → 模型：**Sonnet / low**（小·纯 code）。

**并行**：Lane A 必须先落（更名契约·串行·别与他人抢 `types/state.ts`）。A 绿后 B 独占 dive-start，D 可与 B/C 并行（车道不重叠·`node scripts/psm.mjs start openwater-persist-gate --lane 'scripts/**,src/types/items.ts'`）。C 等作者地理骨架。**代码 vs work**：A/B/D 全是 code；C 的内容投放 + 数值是 work（数值 defer·§9）。

---

## §9 open / defer + 待核实 / 风险

### 数值 / 内容 defer（`[[defer-number-tuning]]`）

- 开阔持久海域的尺寸 / tag 分布 / 门户预留数、贴底矿藏产出与稀有度、可再生 vs 不可再生的具体划分——**进引擎后一次性对着真内容调**。
- 世界投放（哪片海是持久的、绑哪个 beacon）等作者主线地理骨架落定（同开阔水域 SPEC §10）。

### open（实装期再定的细节）

1. **注册表命名**：`diveMaps`（推荐·§1.3）vs 保留 `caveMaps` 扩语义（churn-averse 备选）。
2. **开阔生成器 / 数据**：MVP 复用 `generateDiveMap`（推荐·不新增）vs 新增 `data/seas.json` + `getSea` + `mapShape:'openwater'` 薄壳（若开阔海域需超出 zone 的作者参数·对齐开阔水域 SPEC §3 允许的薄壳）。
3. **POI 绑定形状**：加 `poi.seaEntry`（推荐·加法）vs 未来收成单一 `poi.persistentEntry`（洞 / 海共用一个 binding 字段·更统一但要迁 `caveEntry`）。
4. **overlay 更名**：`applyCaveOverlays → applyPersistentOverlays`（可选·纯改名·它本就 target 无关）。
5. **§4.3 守门**：是否上门 + 用哪个「有限矿藏」枚举口径（推荐声明式 `deposit` 标记）。

### defer（明确划走·非本 SPEC）

- **多入口开阔海域**（§5）+ 跨 beacon 海图同洞分组（对齐多口洞 SPEC T3b）。
- **运行时地图突变**（水流 / 塌陷 / 潮汐淹没·§0 理由 2·远期各自专项）。
- **渲染**（§7·全归开阔水域 SPEC）。

### 待核实 / 风险（我发现的代码现状 vs 锁定设计的出入·供作者 / 复审定夺·不擅自改设计）

1. **提案名 vs 现有名**——以下全是**提案 / 尚不存在**，实装期以仓内为准：`getPersistentTarget`、`startDiveIntoPersistent`、`diveMaps`、`PersistentDiveMap`、`RunState.diveMapId`、`poi.seaEntry`、`getSea`、`data/seas.json`、`ItemDef.deposit`。**现有 / 已实装**（我已 grep 核对存在）：`profile.caveMaps: Map<string, PersistentCave>`、`PersistentCave{caveId,map,explored,portals}`、`CavePortal`/`CaveRegion`、`RunState.caveId`、`poi.caveEntry`、`getCave`/`allCaves`/`persistentExploredForRun`/`cavePortalsForChart`（`engine/caves.ts`）、`startDiveIntoCave`/`resolveCaveEntryNode`/`cloneDiveMap`（`engine/dive-start.ts`）、`generatePersistentCaveMap`/`applyCaveOverlays`/`cavePortalsOf`/`caveSeededRng`/`caveHash`（`mapgen` barrel）、`applyHarvestDepletion`（`mapgen-shared.ts`）、`harvestPersistOf`（`items.ts`）、`harvestedResources`（profile）/`harvestedNodes`/`harvestedSaveItems`（run）。

2. **注册表字段确是「洞穴专用命名」，rename 面比「一个字段」宽**：不止 `caveMaps`，还牵 `PersistentCave.caveId`、`CavePortal`/`CaveRegion`、`RunState.caveId`、`data/caves.json`、`CaveGenParams`、`check-cave-bindings`、`engine/caves.ts`。锁定设计说「泛化 `caveMaps`」——本 SPEC 按此写，但把**推荐更名的完整范围**摊在 §1.3 + Lane A，供作者确认是否接受这一机械 rename churn（TS 焊全站·风险低但面广）。**非设计冲突·是范围提示。**

3. **quirk 编号消歧（house 约定 vs QUIRKS.md 真值）**：本 SPEC 与两份兄弟 SPEC 一致，用「**#98**」指「同地点同 seed / 确定性重生」、用「**#99**」指「未发布不写迁移」。核对 `docs/QUIRKS.md`：**#99 确是**「未发布不做存档迁移·版本不符即弃」（真值相符）；但「洞穴一致性 seedKey」在 QUIRKS.md 里其实是**编号 100**（标题写「#98 build-step ①」——那个 `#98` 是**声呐渲染重做的 session/CHANGELOG 号**，非 QUIRKS 条目号）。即：`#98` 在仓内是 session 号、对应 QUIRKS 条目 #100。本 SPEC 沿用兄弟 SPEC 的 house 写法（`#98`=seedKey），但在此标注歧义，免复审困惑。

4. **开阔水域持久化在持久化侧是 greenfield**：grep 确认现无 `persistentSea`/`seaMaps`/`diveMaps` 任何持久注册（现有 `openWater*`/`seabed`/`sonar*` 命中全是**渲染层**）；且「白板后零开阔 zone（4 个已删）」——故本 SPEC 建**机制**，与开阔水域渲染 SPEC 同为「机制先立、世界投放等作者 #1 地理骨架」。**非冲突·是现状确认。**

5. **`generateDiveMap` 复用是否够**：MVP 开阔持久＝首次进用 `generateDiveMap` 生成一次、冻结、之后加载。这依赖「`generateDiveMap` 的输出可被原样冻结 + `applyCaveOverlays` 叠得上」——`applyCaveOverlays` 候选过滤（跳 `ascent_point`/`air_pocket`/`camp`/`corpse` + `portalKind`）对层状开阔图成立（层状图末层留 `ascent_point` 出口·被跳过·不误布尸），**但建议实装 Lane B 时用一条 openwater playthrough 实证**（层状图 overlay 无回归）。**低风险·标一条验收即可。**
