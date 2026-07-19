# 深海回响 · 感知门 SPEC（灯 / 声呐 × 隐藏 / 锁住 · 统一门模型）

> 状态：**拟定 2026-07-05**（作者本 session 定向 · Cowork 交互 · Opus）· **未实装 · 未提交 · 下 session 单车道实现**（本 session 只写 SPEC · 零代码）。
> 本 SPEC **扩展并部分改写** `感知重做_SPEC` §2.1（灯门从「整潜级」下放到 per-node）+ §2.2（声呐从「只侦察」加上「门」职能）。**推广 #262** 的 per-node 隐藏黑点（`DiveNode.dark`）：把「per-node 隐藏黑 + 整潜灯门 + 新声呐门」收成一个 `NodeGate{sense,mode}`。#262 的 `dark` 布尔**被本模型取代**（dormant · 未激活 · runtime 生成不入存档 → 干净替换）。
> 数值 / 密度 / 阈值 / 文案一律留最后统一调（memory `defer-number-tuning`）· 本 SPEC 只定**机制、数据形状、边界**。
> **⚠ 2026-07-19 声呐无升级化（CHANGELOG #315）**：声呐门解锁语义由「`scanMemory` 一记 ping 全潜粘住」改为**活条件** `run.sensors.sonar==='ping'`（同灯 lampOn 的持续态·移动后脉冲散了门回锁·`dive-select.ts::gateUnlocked`·作者拍板「和灯一样」）。本档下文的 `scanMemory` 引用均为历史（字段已删）。「关键不对称」段作废——灯与声呐现同为活条件、只是一个持续（开着灯）一个按站（这一站 ping 过）。

## 1. 北极星 / 为什么

`感知重做_SPEC` 立了「灯 = 诚实硬门 / 声呐 = 诚实侦察 / 欺骗 = 低 san 单轴」。落地时灯门只做到**整潜级**（`diveModifier.visibility==='dark'` → 全潜非豁免选项一律锁），声呐只做**侦察揭示**（`scanMemory`，不进「选不选得了」的决定）。本 SPEC 补两块，都在北极星之内、都**诚实**（灯 / 声呐真能解锁**真实**内容，不是骗）：

1. **门下放到 per-node**：不再「整潜要么全黑要么全清」，而是**单个潜点**各自挂门——多数是「看得见、没灯不能选」，少数是「没灯根本不显示」的伏笔岔口。
2. **声呐也成门**：有些潜点（举例：浑浊 / 泥沙 / 塌方后只余回声 · 真实成因视剧情环境而定 · §2.1）**灯没用**，得扫一记声呐才看得见 / 选得动。给了声呐**真实机械回报**（不只规划侦察）——正贴「声呐 = 诚实侦察」。

两者形状一样 → 收成一个门。**欺骗仍只在低 san**（本 SPEC 不碰）。

## 2. 统一门模型（2×2）

一个门 = **哪种感官解锁**（`sense`）× **不满足时怎么表现**（`mode`）：

| sense \ mode | `locked`（看得见、不能选 · 多数） | `hidden`（不显示 · 伏笔岔口） |
|---|---|---|
| `lamp` | 灰着标「太暗，看不清——需要灯」，开灯 → 可选 | 没灯不显示，开灯 → 出现 |
| `sonar` | 灰着标（`gate.reason` 成因 · 兜底「得扫一记声呐才认得清」），扫 → 显示完整选项 | 没扫不显示，扫一记 → 出现（隐藏岔口） |

四格分别 = 作者点 4 的：灯 2 / 灯 1 / 声呐 A / 声呐 B。

### 2.1 数据形状（`types/dive.ts`）

```ts
export type GateSense = 'lamp' | 'sonar';
export type GateMode  = 'hidden' | 'locked';
export interface NodeGate {
  sense: GateSense;
  mode: GateMode;
  reason?: string; // 作者供的「为什么这里非这感官不可」成因文案（按剧情 / 环境而定）· 缺省用 sense 的中性兜底
}

// DiveNode:
gate?: NodeGate;   // 取代 #262 的 dark?:boolean。缺省 = 普通节点（有没有灯都看得见、都能选）。
```

- **成因是内容、不是机制**：**浑浊 / 泥沙只是声呐门的一种举例**——具体「为什么没声呐过不去」视剧情 / 环境而定（塌方只余回声可测 / 水流搅浑 / 岩体后无视线 / 距离太远…）。机制**不假设成因**：锁住的成因文案由 `gate.reason` 按内容供，缺省落中性兜底（§2.3）。灯门成因近乎唯一（没光 = 黑），声呐门成因多样 → `gate.reason` 主要给声呐用、灯也可用。

- **迁移**：删 `DiveNode.dark`（#262 · dormant · runtime 生成不入存档 → 干净删）。凡引用 `n.dark` 处改读 `n.gate`（`dive-select` 过滤 / 撒点）。
- **整潜门也归一**：把 `diveModifier.visibility:'clear'|'dark'` 推广成 `diveModifier.gate?: NodeGate`（整潜门 · 在 mapgen 给所有非豁免节点盖同一个 gate）。`visibility:'dark'` → `gate:{sense:'lamp',mode:'locked'}`；新增「整潜浑浊」→ `gate:{sense:'sonar',mode:'locked'}`；`'clear'` → 无 gate。**整潜门只用 `locked`**（可见但锁 · 沿用 #221 预告语义）；`hidden` 只由 per-node 撒点产生。

### 2.2 解锁判定（按 sense 分流 · 单一真相）

```ts
// clarity.ts（或新 gate.ts）
export function gateUnlocked(run: RunState, node: DiveNode): boolean {
  const g = node.gate;
  if (!g) return true;
  return g.sense === 'lamp'
    ? lampOn(run)                            // 灯 = 持续装备态 · 实时（run.sensors.light && power>0）
    : run.scanMemory[node.id] !== undefined; // 声呐 = 一记 ping 粘住（BFS 射程内 stamp 过 → 已揭示）
}
```

**关键不对称**（已核代码）：灯是**持续态**（`lampOn(run)` 全局实时 · `clarity.ts:110`），声呐是**瞬时动作**（`pingSonar` 把射程内节点 stamp 进 `run.scanMemory` · 本潜粘住 · `dive-sensors.ts:54`）。所以「解不解锁」按 sense 走两条，但下面「隐藏还是锁住」是同一套。声呐门天然接现有 lookahead：到节点扫一记、门内隐藏岔口就现身。

### 2.3 选点表现（`dive-select.ts` · 一条通用过滤取代散在两处的旧逻辑）

```ts
const choices = nextChoices
  // 已访问（来路）恒显示可选——迷路图能原路退回（§2.4）；否则按门：hidden 未解锁→拿掉，locked/已解锁→留下
  .filter((n) => visitedSet.has(n.id) || gateUnlocked(run, n) || n.gate?.mode !== 'hidden')
  .map((n) => {
    const locked = !!n.gate && !gateUnlocked(run, n) && !visitedSet.has(n.id); // 来路不再上锁；到这儿 locked 必是 mode==='locked'
    // 地标 / Lv.1 尸体仍豁免（结构可感 · 见 §5）
    ...
    preview = locked ? (n.gate!.reason ?? LOCKED_FALLBACK[n.gate!.sense]) : honestPreview;
    clarity = locked ? 'none' : 'full';
    // NodeChoice 携 { locked:true, gateSense } 供渲染出对应禁用态
  });
```

- 取代现在的 `gateLocked = lampGateLocked(run)`（整潜级一刀切 · `dive-select.ts:65`）+ `hasLamp || !n.dark`（散着的隐藏过滤 · `:71`）。**收成一处**：每个节点看自己的 `gate` + `gateUnlocked`。
- `LOCKED_FALLBACK = { lamp:'太暗，看不清——需要灯', sonar:'得扫一记声呐才认得清' }`（**中性兜底** · 现有 `LOCKED_DARK_PREVIEW` 归到 `lamp` 档）。真实成因优先取 `n.gate.reason`（内容供 · §2.1）——不假设「浑浊」。
- 渲染层（车道 3）按 `gateSense` 出对应禁用态 + 提示；`handlePick` 拦截 locked。

### 2.4 两种拓扑 · 门只挡「未访问」节点

地图有两种拓扑（`mapgen.ts:3–10`），门语义一致、兜底不同：

- **层状图 `layered`（默认）**：单向下行 DAG，不能掉头；走到无下一节点的叶子 → 自动上浮（`enterNodeSelection` 的 0-出口分支 · §5.1）。
- **迷路图 `maze`（蓝洞群 / 迷路 · `zones.json` 10+ 区）**：双向连通图，有环 / 死路 / 多最深点；`getNextChoices` 含来路、`moveToNode:98` 支持重访。**死路 = 原路退回**（不是自动上浮）。

**约束（本次新加 · 关键）：门只作用于「未访问」节点；已访问（来路）恒显示、可原路返回。** 否则迷路区会 soft-block——例：带灯照亮并走过一个 `lamp/hidden` 节点，灯电耗尽后（`lampOn` 转 false）那个来路节点会从选项里消失、无法退回。判定顺序：`visited → 恒显示可选`（早于门判定 · 见 §2.3 过滤）。现有 #262 过滤 `hasLamp || !n.dark` **未查 visited**，是潜伏 bug，本次重构一并收掉。撒点侧另有兜底：门只挂 event/rest、地标永不挂（§5），骨架与来路都通。

## 3. 派生标注（从子节点算 · POI 不自带「全黑」flag）

作者定：**POI 本身不分全黑与否**；下潜 / 海图的标注一律**从（当前节点的）子节点派生**。只有 `hidden` 驱动标注（`locked` 自己在选项上就标着「需要灯 / 声呐」、不需要再汇总）。

设某节点子集里：`free` = 无门可选的普通子；`hiddenL` / `hiddenS` = 灯 / 声呐隐藏子。

| 情形 | 标注 |
|---|---|
| 无 `free`（全被门挡 · 不管隐藏还是锁住） | 「**这里完全探不动 · 需要灯 / 声呐**」（列出实际缺的 sense） |
| 有 `free` 且有 `hiddenL` | 「**暗处还有去处 · 需要灯**」 |
| 有 `free` 且有 `hiddenS` | 「**还有声呐才找得到的岔口 · 需要声呐**」（汇总句保持中性 · 不带具体成因） |
| 仅 `locked`、无 hidden | **不标**（选项自显） |

- 灯 + 声呐隐藏子**同时**存在 → 两句都列（开放决定 §10.3）。
- 名称都是占位 · 作者可改（点 2 授权）。
- **纯函数**（engine 算 · ui 只渲染 · 守 engine↛ui 边界 quirk #95）：`deriveGateNotice(node, run): GateNotice | null`。

## 4. 海图入口门（点 3 · 一般化）

「全黑 POI 不带灯不让下潜（下去没意义）」→ 推广：**若某 POI 是整潜门（`diveModifier.gate`）、且玩家缺那个感官 → 海图挡下潜、标原因**。

```ts
// chart.ts::poiDiveBlock(profile/sensors, poi): { blocked, reason } | null
const g = poi.diveModifier?.gate;
if (g?.sense === 'lamp'  && !ownsUsableLamp(profile)) → 挡 · 「漆黑 · 需照明才能下潜」
if (g?.sense === 'sonar' && !sonarUnlocked(profile))  → 挡 · 「需声呐才能下潜」（成因取 `diveModifier.gate.reason` · 兜底中性）
else → 不挡
```

- **不对称**：灯缺 = 装备没带 → 挡（下去纯浪费）。声呐「整潜浑浊」但你**已解锁声呐** → **不挡**（下去扫就行）；只有连声呐都没解锁才挡。
- 海图生图前只有 POI 自带 modifier、拿不到还没生成的子节点 → **入口门必须靠 POI 级 `diveModifier.gate`**（这就是「POI flag 保留当授权源」的原因）。标注层仍派生 · 授权层留 flag，两者不冲突。
- `ownsUsableLamp` / `sonarUnlocked` 谓词实装时定（装备 / 升级侧 · 别和 in-dive `lampOn` 混）。开放决定 §10.5。

## 5. repair = 不要（推荐 · 作者点 6 纠出）

**决定：删掉 `sprinkleDarkNodes` 的 repair（「每个父节点 ≥1 非黑出口」），不做任何地图级兜底。** 理由：

- **卡死结构上不可能**：选点 / 休整界面永远有主动上浮（`beginAscentFromDive` · `dive-stalker.ts:162`「逃生阀门…永远是出路」）；猎手贴邻拦一下 → 战斗，战斗应急上浮**无条件零成本任何回合**（`combat.ts:462/476`）；另有「走到死路的自动上浮」（`transitions.ts:23`）。→ 作者点 6 的 **B（回头都不行）没有出现路径**。repair 本来只防卡死，而卡死不存在。
- **A（前面没得走 → 上浮）是可接受的最坏情况**（门在起作用 · 带走已到手的）。
- repair 实际只遮一个**表现层**尴尬：`enterNodeSelection` 的「无出口」判定用的是**过滤前** raw children（`dive-select.ts:48`）——子全 `hidden` 时会漏成**空屏**而非自动上浮。**正确修法**（取代 repair）见 §5.1。

### 5.1 空屏 → 走已有死路上浮 / 带标注留手

`enterNodeSelection` 的空判定改看**过滤后**结果 +「有没有还能揭示的门」：

```
visible   = 过滤后可显示的子（普通 + locked + 已解锁）
canReveal = 有 hidden 子 且 对应 sense 现在可操作（灯：身上有灯可开；声呐：已解锁且这站还没扫）
if visible 为空 且 无 feature:
    canReveal → 显示（否则空的）选点屏 + §3 标注「完全探不动」+ 保留 开灯 / 扫声呐 / 主动上浮
               （给玩家先动一下的机会 · 别急着自动上浮）
    否则       → 现有「死路自动上浮」（transitions.ts · 不给取消 · **仅层状叶子**会 0-出口；迷路图恒有来路、走不到这支 · §2.4）
```

保证：**永不空白懵屏、永不卡死、永远有出路**——比 repair 改地图干净（合点 5「重构不缝补」）。

- 地标（上浮口 / 气穴 / 扎营 / 尸体 / shop / boss）**永不挂门**（现有 `darkSprinkleCandidate` 只标 event/rest · 撒点沿用）——骨架永远通。整潜门盖 gate 时**同样豁免地标**。

## 6. 撒点推广（`mapgen-shared.ts`）

- `sprinkleDarkNodes` → `sprinkleGates`：按 zone 门规格 + 深度密度、FNV 确定性给候选（event/rest）节点标 `gate`。**零 rng · 缺省 no-op · byte-identical**（无 eligible zone → 不标 · 同 #262）。
- `darkDensityForNode` → `gateDensityForNode(zone, depth, sense)`：每 sense 一组深度档密度（占位 · defer）。
- zone eligibility 从 `zone.darkEligible?:boolean` 推广成**数据驱动门规格**（提案 · 实装定形）：

  ```ts
  zone.gates?: { lamp?: GateDensity; sonar?: GateDensity }  // 每 sense：深度档密度 + hidden/locked 配比
  ```

  仍**默认全关**（dormant · 激活留内容 session · 并行 by zone）。
- **repair 段删掉**（§5）。

## 7. 约定落成机制（regress · CLAUDE.md「约定落成机制」）

- `check-no-murky`（#262 意图）**保留**——本模型不得复活 murky（`Visibility` 已删中间档）。
- `check-no-sonar-deception`（#219）**保留且相容**——声呐**门 = 揭示真实节点**，不是假回波 / 欺骗；本 SPEC 明写「门 ≠ 欺骗」，别回引 `spoofsSonar`/`nodeSonarView`。
- **新 `check-gate-legibility`**（playthrough 断言）：任何生成图里不存在「`visible` 空 + 无 feature + `!canReveal` + 且没进上浮」的状态（＝没有空白懵屏 / 死锁）。
- **新 `check-gate-skeleton`**：地标 kind（ascent_point / air_pocket / camp / corpse / shop / boss）**永不带 gate**（撒点 + 整潜门 seed 都豁免）——静态扫 + 撒点 post 断言。
- 术语门（`check-terminology`）加新固定文案键（「需要灯」「需要声呐」等 · 防漂移）。
- 边界：标注 / 门判定全在 engine（纯函数）· ui 只渲染（守 engine↛ui · quirk #95）。

## 8. 存档 / 迁移

- `run.diveModifier` 形状变（`visibility` → `gate`）＝ run 存档形状变。按 quirk #99（游戏未发布 · 不迁移）：**bump `SAVE_VERSION`**（或依赖「版本不符即删旧档从头开始」）· 不写迁移代码。
- `run.scanMemory` 已是 run 级派生、不 bump（`state.ts:227`）——声呐门复用它、无新存档字段。
- 数据迁移：`depth_columns.json`（8 处 visibility）+ `chart_pois.json`（7 处）→ 新 `gate` 形状（`dark`→`{lamp,locked}`；将来标浑浊的→`{sonar,locked}`）。#262 已把 murky 迁走 · 本次只改 `visibility`→`gate` 的载体。

## 9. 实装排期（下 session）

- **核心 · 单车道 · 不能并行**（同一 `NodeGate` 模型压在 `types/dive.ts` · `clarity`(gate)`.ts` · `dive-select.ts` · `mapgen-shared.ts` · `chart.ts` · 渲染 · regress——拆车道必撞同批文件）。Opus / high：
  1. 数据形状 + 迁移（§2.1 / §8）；
  2. `gateUnlocked` + 通用过滤 / 表现（§2.2 / §2.3）；
  3. 派生标注（§3）；
  4. 海图入口门（§4）；
  5. 删 repair + 空屏处理（§5）；
  6. 撒点推广（§6 · 仍 dormant）；
  7. regress 门（§7）；
  8. 三件套（CHANGELOG / QUIRKS / STATUS）。
- **内容 · 可并行**（核心落地后 · by zone / region · worktree / psm）：给各 zone / POI 挂门（哪种 sense / mode、成因文案 `gate.reason`、密度），重生受影响 baseline，数值统一调（defer）。
- **激活**＝给参与 zone 开 `zone.gates`（承接原「待办 1」）——路径变（无灯 / 无声呐玩家少几个选项）→ 逐个核对受影响 playthrough 的灯 / 声呐态。

## 10. 给作者复审的开放决定

1. **repair = 不要**（§5 · 推荐）vs 保留严格（≥1 非黑子）vs 改良（≥1 可见子）。← 已按点 6 定推荐「不要」，此处标出供否决。
2. 标注文案（§3 / §4 · 占位）——按点 2 我起的短名，随你改。
3. 一个节点同时有灯 + 声呐隐藏子时：两句都列 vs 合并一句（§3 · 提案两句）。
4. 整潜浑浊在 `diveModifier` 的载体：`gate:{sonar,locked}`（提案）——是否也允许整潜 `hidden`？（提案：整潜只 `locked` · hidden 仅 per-node）。
5. `ownsUsableLamp` / `sonarUnlocked` 入口谓词口径（§4 · 装备 / 升级侧）。
6. `zone.gates` 门规格形状（§6 · 提案 per-sense 密度 + hidden/locked 配比）——实装定形。
