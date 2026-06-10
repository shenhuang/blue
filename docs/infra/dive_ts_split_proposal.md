# 提案：`engine/dive.ts` 纯搬移式拆分（**已实装 2026-06-10·`264e02f`·#106**）

> 状态：**已实装**（2026-06-10 交互 session #106·commit `264e02f`·§6 实装门全满足：隔离 A 在位 + 定时任务全停＝零并发窗口·27/27 全绿·diff 证明纯搬移）。**实装偏差三处**（皆按 §4「真实调用图核准」修正）：refreshSelection 唯一调用方在 sensors → 随 `dive-sensors` 保持 private（提案表原「随 select·export」）；FEATURE_EXPLORE_TURNS 唯一使用方 exploreFeature → 随 `dive-actions`（原「随 select」）；assertNever 单用户 moveToNode → `dive-move` 私有、**未设 dive-internal.ts**。其余按 §3/§5 原样落地（barrel 保留·4 helper 提 export·函数体逐字节）。持久约定见 QUIRKS #105。
> 性质：纯搬移（pure move）重构——零行为变化、不碰游戏逻辑、不动 `SAVE_VERSION`。
> 关联：并发隔离见 [`concurrency_isolation_proposal.md`](concurrency_isolation_proposal.md)；边界机制见 QUIRKS #95。

## 1. 为什么是它

`src/engine/dive.ts` 当前 **826 行**，import **14 个引擎模块**（events / mapgen / zones / state / upgrades / clarity / outposts / bands / chart / death / combat / sonar / stalker + types）。它是下潜生命周期的 **wiring 中枢**：开潜的三个入口、节点选择、移动（含 transit / 猎手 / 接近遭遇）、传感器（灯 / 声呐）、节点动作（探索 / 休息 / 呼吸 / 扎营）全挤在一个文件里。

它是个**干净的 DAG sink**——没有别的引擎模块反向 import 它（`ui/` 和 `scripts/` 才消费它的导出）。所以它不会造成依赖环，但**只增不减**：每个子系统（声呐 #71–#90、猎手 #84–#90、前哨 #66–#79、band #61–#88）落地都往里加 wiring。三个写手（交互 / 周末 / 夜间）并发时，它是**最容易撞车的单个文件**（每个 content/feature pass 都倾向于碰它）。

拆分目标：把 `dive.ts` 降成**薄顶层编排 + re-export barrel**，按子系统把 wiring 搬进同目录兄弟文件。**纯搬移**——函数体逐字不变，只改「住在哪个文件」+ 把若干此前 module-private 的 helper 提成跨文件 export。

## 2. 当前内容清单（搬移单位）

**导出（公共 API·拆后必须逐一仍可从 `dive.ts` import，否则 `ui/`+`scripts/` 全炸）：**

| 函数 | 行 | 子系统 |
|---|---|---|
| `startDive` | 87 | start |
| `startDiveFromPoi` | 165 | start |
| `startDiveFromOutpost` | 284 | start |
| `enterNodeSelection` | 353 | select |
| `setLight` | 437 | sensors |
| `pingSonar` | 463 | sensors |
| `currentMoveCost` | 522 | move |
| `moveToNode` | 653 | move |
| `exploreFeature` | 736 | actions |
| `restAtNode` | 759 | actions |
| `breatheAtAirPocket` | 777 | actions |
| `campAtNode` | 801 | actions |
| `type { DiveNode, DiveMap }` | 826 | (re-export) |

**内部 helper（拆后部分需提成 export 供兄弟模块用）：**

| helper | 行 | 被谁调用 | 拆后去向 |
|---|---|---|---|
| `assertNever` | 53 | 多处 switch 兜底 | 提到共享小工具（或 `types`） |
| `FEATURE_EXPLORE_TURNS` | 62 | select / actions | 随 select |
| `featureDoneFlag` | 65 | select / actions | 随 select（export） |
| `roomFeatureChoices` | 73 | select | 随 select |
| `appendVisibilityLog` | 222 | start | 随 start |
| `deepestOutpostLaunch` | 250 | start | 随 start |
| `refreshSelection` | 426 | select | 随 select |
| `applyTransit` | 534 | move | 随 move |
| `maybeApproachEncounter` | 585 | move | 随 stalker（export） |
| `stalkerStep` | 610 | move | 随 stalker（export） |

## 3. 提议的目标布局

`dive.ts` 留作 **barrel**：`export { ... } from './dive-*'` + 顶层只放真正跨子系统的极薄编排（若有）。其余按子系统分文件，全在 `src/engine/`（边界检查 #95 不受影响——全是 engine 内部 import）：

```
engine/dive.ts            ← barrel：re-export 全部公共 API（外部 import 路径零改）
engine/dive-start.ts      ← startDive / startDiveFromPoi / startDiveFromOutpost
                            + deepestOutpostLaunch + appendVisibilityLog
engine/dive-select.ts     ← enterNodeSelection / refreshSelection / roomFeatureChoices
                            + FEATURE_EXPLORE_TURNS + featureDoneFlag
engine/dive-sensors.ts    ← setLight / pingSonar + SONAR_DIR_LABEL
engine/dive-move.ts       ← currentMoveCost / applyTransit / moveToNode
engine/dive-stalker.ts    ← stalkerStep / maybeApproachEncounter
engine/dive-actions.ts    ← exploreFeature / restAtNode / breatheAtAirPocket / campAtNode
engine/dive-internal.ts   ← assertNever（或复用既有共享处）+ 跨文件共享的小常量
```

**关键设计：保留 barrel。** 外部（`ui/`、`scripts/playthrough*`）继续 `import { moveToNode } from '@/engine/dive'`，零改动、零 import churn。这让拆分的 blast radius 只限 `engine/dive*.ts` 内部。

## 4. 依赖方向（拆前必须先画准，避免环）

拆后子模块间的单向依赖（基于 §2 调用关系）：

```
dive-start   → dive-select         （开潜末尾进 enterNodeSelection）
dive-move    → dive-stalker        （moveToNode/applyTransit 调 stalkerStep/maybeApproachEncounter）
dive-move    → dive-select         （moveToNode 末尾可能 refreshSelection/enterNodeSelection——需核实）
dive-actions → dive-select         （动作后回选择界面——需核实）
所有子模块   → dive-internal       （assertNever 等）
```

**实装前第一步＝把真实调用图 grep 出来核准**（`enterNodeSelection`/`refreshSelection`/`stalkerStep`/`applyTransit` 各自的 caller/callee），确认 DAG 无环。若出现 `dive-select ↔ dive-move` 双向调用，则二者合并或把共享部分下沉到 `dive-internal`，**不要**为拆而制造环。

## 5. 纯搬移 checklist（实装时逐条勾）

1. 函数体**逐字节复制**，只改所在文件——不顺手「优化」「重命名」。任何逻辑改动都不属于本次。
2. 被跨文件引用的 module-private helper（`featureDoneFlag` / `stalkerStep` / `maybeApproachEncounter` / `assertNever` / 共享常量）提成 `export`；仅单文件内用的保持 private。
3. import 重接：每个新文件按自身实际用到的引擎模块各自 import（别从 barrel 回 import，避免自引用环）。
4. `dive.ts` barrel 用 `export { x } from './dive-start'` 等逐一 re-export，**公共 API 名字/签名一字不改**。
5. `export type { DiveNode, DiveMap }` 仍从 barrel 导出。
6. 不动 `SAVE_VERSION`、不动任何 data/JSON、不动 `ui/`、不动 scenarios。

## 6. 实装门（全满足才动手·缺一即只留本方案）

- [ ] **并发隔离已就位**（见 concurrency 提案）：周末/夜间引擎不再与本次大改共用一条裸 `main`。← **当前未满足，是 defer 的首要原因**（见 §7）。
- [ ] 真实调用图 grep 核准、确认无环（§4）。
- [ ] `npm run regress` 全量 **27 绿不变**（含 typecheck / 全 playthrough / scenarios / mapgen 确定性 baseline / verify-tutorial / check-boundaries / prod build）。
- [ ] `playthrough-sonar`/`-stalker`/`-bands`/`-mapgen-scenarios` 覆盖到搬移过的 wiring（现有覆盖应已够，缺口先补测再拆）。
- [ ] `git diff` 人工核对＝**纯搬移**（行内容只换位置·无逻辑 delta·mapgen 确定性快照逐字节不变）。

## 7. 本 session 的结论：**defer（只留方案，不实装）**

两条理由，均指向「现在不是安全窗口」：

1. **并发风险压过收益。** `dive.ts` 是三写手最易撞车的文件；在周末/夜间引擎可能正跑、且三者共用裸 `main` 的当下做一次大 diff 的结构重构，正好**最大化**它要解决的那种 merge 冲突——与本次治理「降耦合/降 churn」的目标相反。正确顺序是**先做并发隔离（T2.6 提案），再在非并发窗口拆 `dive.ts`**。
2. **它是 maintainability nicety，不是 correctness fix。** 引擎↛ui 的硬不变量已由 `check-boundaries`（#95）锁死；`dive.ts` 的大小是「可读性/抗撞车」问题，可以等一个安全窗口（作者在场、无并发、隔离就位）再做。**任何不确定就别动行为**——这正是本提案存在、而非直接实装的原因。

> 给实装者：把 §5 checklist 当硬门，§4 调用图当第一步，§6 当验收。拆完一笔单独 commit（纯搬移·`git diff` 自证），别和别的改动混提。
