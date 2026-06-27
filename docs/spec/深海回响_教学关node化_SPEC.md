# 教学关 node 化 SPEC（#221+·作者拍：tutorial 也走 node-graph + 限制行为）

## 目标 / 北极星
教学首潜（zone.east_reef 第一次）与重访**共用同一张节点图**，让「重去资格区＝认得出来的同一个地方」。
tutorial 仍是**强制、不可错过**的引导——靠「锁上浮 + 单向线性」限制玩家行为，而不是靠 event-chain 把图藏掉。
副收益：教学真正教会节点导航（旧版纯 event-chain·玩家第一次见下潜 UI 是真·首潜）。

## 共用布局（east_reef·layerCount 3·nodesPerLayer [1,1]）
3 个节点·深度 12 / 21 / 30·线性下行（layered 默认·`zoneAllowsBacktrack=false`）。
| node | depth | tutorial 首潜 | 重访 |
|---|---|---|---|
| node.0.0 | 12 | `prologue → descent`（节点内 triggerEventId 链） | reef.flooded_stair |
| node.1.0 | 21 | `grouper → wreck`（节点内链·鲨鱼战在此） | rest |
| node.2.0 | 30 | `deeper → captain_quarters`（节点内链） | 旧沉船（captain_revisit/_empty·pinnedEventId） |
**节点间转移**＝事件结算后**不带 triggerEventId** → 落 node-selection（强制单向：只一个前进节点·无上浮）→ 走到下个节点触发其首事件。
**退出**＝靠 forceAscend 事件（deeper.ascend_now / captain_quarters.grab_log / look_closer）·**不靠上浮口按钮**（被锁）。node.2.0 是末层 ascent_point·但被 scriptedNodeEvents 覆盖成 deeper 事件·事件先结算→不会摸到上浮钮。

## 机制 1：run 级锁上浮 `ascentLocked`
- `RunState.ascentLocked?: boolean`（types/state.ts·真条件字段·不种不补·不 bump SAVE）。
- `dive-start.ts startDive` 在「首潜 node 化」分支置 `run.ascentLocked = true`；重访/普通潜不置（east_reef 重访仍 free-ascend）。
- `ascent.ts isAscentBlocked(run)`：**首行** `if (run.ascentLocked) return true;`（先于 zone.canFreeAscend 判·整潜恒挡）。
- **三处上浮入口都要 gate**（isAscentBlocked 单独不够·两个按钮绕过它）：
  1. `NodeSelectView.tsx` 常驻「↑此处上浮」按钮 → `{!isAscentBlocked(run) && …}`（**最关键**·不挡玩家就从这儿溜出教学）。
  2. `RestView.tsx` ascent_point「↑从此上浮」→ 同样 gate（教学靠 forceAscend 事件退出·不需要这钮）。
  3. `AscentView.tsx` 已读 isAscentBlocked（normal/rushed 自禁·emergency 在 returnTo 时藏）；文案「头上是岩顶」是洞穴味·加通用/教学分支。
  - `CombatView.tsx` 已 gate emergency-ascent（鲨鱼战不给免费上浮逃·flee 仍可·§B 不变）。

## 机制 2：scripted 多节点布局 `scriptedNodeEvents`
- 新 `GenOpts.scriptedNodeEvents?: Array<{layer:number; eventId:string}>` + zone 字段 `east_reef.scriptedNodeEvents`。
- `mapgen.generateLayeredMap`：在 pinnedEventId 块之后，按 layer 索引把每个 ev 覆盖到 `layerNodes[layer][0]`（kind:'event'·eventId·features:undefined·preview:title）——复用 pinnedEventId 同款覆盖。
- **首潜限定**：仅 `!event_seen:tutorial.prologue` 时喂（与 scriptedStart 同门·mapgen 既有判定）。重访不喂 → 仍是裸 layered + pinnedEventId（captain_revisit）→ §2d 不破。
- 首潜走 **layered 3-node** 路径（不是旧单节点 scriptedStart 图）：mapgen 见 `scriptedNodeEvents` 且首潜 → 走 layered + 放 beats（绕过单节点早退）。`scriptedStartEventId='tutorial.prologue'` 保留（verify-tutorial/story §4 仍查它·= scriptedNodeEvents[0]）。

## tutorial.json 改动
- `descent` 删去 `triggerEventId:tutorial.grouper`（→ 变节点移动到 node.1.0）。
- `wreck`（stealth_grab 成功路径）删去 `triggerEventId:tutorial.deeper`（→ 节点移动到 node.2.0）。
- 保留节点内链：`prologue→descent`、`grouper→wreck`、`deeper→captain_quarters`（triggerEventId 不动）。
- 保留全部叙事/flag/loot/endDive：prologue 写 `story.ch1.hook`+`event_seen`+发 mentor_logbook；deeper.ascend_now 写 `flag.tutorial_ascended`+forceAscend；captain_quarters 发 captain_log+forceAscend。端口 ending 逻辑（portEvents）不动。
- §B 鲨鱼 flee 后：落回 node.1.0 的 node-selection → 走到 node.2.0 → deeper.ascend_now → forceAscend → ending_safe（验证 flee return-phase 是 node-select·非死局）。

## 测试改动
- `playthrough-tutorial-e2e §A/§B/§C`：从 `diveUntilExit`（event-chain 驱动）换成 §D 已有的 `diveDeepToSurface`（node 导航驱动·处理节点间 nodeSelect 强制单向）；picks 不变；断言 forceAscend/combat/flag/ending 不变。
- 新增守门：教学潜全程 `run.ascentLocked===true`；每个节点 nodeSelect 只有 1 个前进选择（强制线性）；isAscentBlocked 恒真。
- `§0`：从「单节点 scriptedStart」改断言「3-node·node.0.0=prologue·node.1.0=grouper·node.2.0=deeper」。
- `verify-tutorial.mjs`（L242-276 chain-walker 跟 triggerEventId）：改成 node-aware——按 scriptedNodeEvents 逐节点跟**节点内**链·验最末节点链到 forceAscend + hook 已写。
- `playthrough-story §4`：保留 prologue→descent intra-node trigger + 每选项写 hook（不破）。§2d 重访守门（nodeCount≤4 / midAscent 0 / wreckIsDeepest）必须仍绿（scriptedNodeEvents 首潜限定的保险）。修 §2b stale `zone.tutorial_reef`→`zone.east_reef`。
- `check-story-open-events.mjs`：scriptedNodeEvents 是独立新字段（不动 storyOpenEvents 的 anchor-only/互斥规则）；考虑加平行校验防拼错静默 no-op。

## 风险（subagent 复核·实装时逐条验）
1. **共用布局**：scriptedNodeEvents 必须首潜限定·否则污染重访 + 破 §2d。
2. layerCount 锁 3（§2d nodeCount≤4）·靠 forceAscend 事件退出·不加第 4 层。
3. 两个绕过 isAscentBlocked 的上浮钮（NodeSelectView 常驻 / RestView ascent_point）必须各自 gate。
4. verify-tutorial chain-walker 会因删 inter-node trigger 而断·须 node-aware 重写。
5. stale `zone.tutorial_reef`（playthrough-story:192）·proactively 修。
6. ending 逻辑留在 port（portEvents）·别搬进潜水。
7. §B 鲨鱼 flee return-phase 必须是 node-select。

## 验收
全量 regress 绿（所有 playthrough + 静态门 + typecheck）；subagent review diff；dev server 起着时 live 跑教学 + 重访确认同一布局。
