# 深海回响 · 上浮系统 SPEC（UX 重做：单按钮 · 结果 = f(状态)）

- 状态：**设计锁定 2026-06-27 · 待实现**
- 关联：氮气系统 SPEC §4（减压数学，单点真相） · 猎手 SPEC（`run.stalker` / `stalkerNear`） · 负伤 SPEC（减压病分级）
- 代码触点：`engine/ascent.ts`、`engine/dive-stalker.ts::beginAscentFromDive`、`ui/AscentView.tsx`

## 0. 问题

旧上浮屏并列三个选项（正常 / 强行 / 应急）。`executeAscent` 里三者只差一条轴：**少耗氧 ↔ 必得减压病**。但**上浮即结算、氧气不结转**（下一潜满氧重置），省下的氧气没有下家——于是「氧气换减压病」永远不划算，只在「氧气不够正常上浮（快淹死）」这个失败态才触发。

结论：`normal` 严格支配另两个。平时永远选它；`rushed` / `emergency` 不是「选择」，是「你把氧气管理搞砸了」的两档兜底。三选一是假选择。

## 1. 原则

**永远只有一个「上浮」按钮。它的文案与结果 = f(氧气, 氮气, 深度, 是否被追)。**

把假选择删掉；真正的抉择（潜多深、何时折返、要不要惊动猎手）全部前移。三个 mode 不删——退回引擎当**结算数学**，UI 不再把它们摆成菜单，而是按状态自动选一个、并把代价如实写在按钮上。

## 2. 结果表（free-ascend 区 · `canFreeAscend !== false` 且在可上浮位）

设 `plan = planAscent(run)`，`stops = computeRequiredStops(nitrogen)`，`hunted = !!run.stalker`。

| # | 条件 | mode | 按钮文案 | 结果 |
|---|---|---|---|---|
| A | 未被追 · `oxygen ≥ normalTurns` | `normal` | 正常上浮，无减压病 | 干净（残余氮 ≥ TWO_STOP 仍按旧规则给 I 型） |
| B | 未被追 · `rushedTurns ≤ oxygen < normalTurns` | `rushed` | 上浮（氧气不足 · 跳过减压 · 必得减压病） | `determineBends('rushed')` |
| C | 未被追 · `oxygen < rushedTurns` | `emergency` | 上浮（氧气危急 · 可能死于减压病）+ **确认弹窗** | `determineBends('emergency')` |
| D | 被追 · `stops = 0` | `normal` | 正常上浮（直上甩开） | 干净 ← **决策 ①**：0 停留＝无悬停窗口可被趁 |
| E | 被追 · `stops ≥ 1` · 未贴邻 | `rushed` | 强行上浮（甩开猎手 · 必得减压病） | `determineBends('rushed')` ← **rushed 的归宿** |
| F | 被追 · 贴邻 `stalkerNear` | （拦截，不进上浮屏） | —— | 它先扑上＝接触伏击 ← **决策 ②**：保留 `beginAscentFromDive` 现行 |

> 氧气与被追条件叠加时：先判被追（D/E/F），再在其内按氧气走 C 的危急兜底。即「被追且氧气危急」仍可走 `emergency` + 确认，不被 E 吞掉。

**闭合水域**（`isZoneAscentBlocked` · 蓝洞群离开上浮口）维持现状：先摸回标「↑」的上浮口才能上浮；离开上浮口只剩「凿顶」式 `emergency` 当走投无路的最后一手（氮气 SPEC §4）。单按钮模型只覆盖 free-ascend 区与在上浮口处。

## 3. 锁定决策

**① 被追但氮气干净（`stops = 0`）→ 仍可干净直上（无伤）。**
理由：减压停留才是被猎手利用的「悬停窗口」；0 停留没东西可趁，能干净逃。顺手奖励氮气管理——管好氮的人即便被追也能全身而退。

**② 猎手贴邻（`stalkerNear`）→ 保留「它先扑上＝逼进战斗」**（`beginAscentFromDive` 现行），不让强行上浮白嫖甩掉。
理由：守住「别让它贴到身上」的张力梯度。拉开一跳以上 → 强行上浮逃（带伤·E）；贴到脸上 → 它先咬（F）。

## 4. 机制（单一真相 + regress 契约）

- **引擎新增 `resolveAscent(run): AscentResolution` 单点**，把 §2 整张表的判定收进引擎（`engine ↛ ui` 边界 #95 不破）。返回形如 `{ mode, label, needsConfirm, confirmText?, blocked, blockedReason? }`。判定只读 `plan` / `stops` / `run.stalker` / `isZoneAscentBlocked`，不含随机、纯函数。
- **UI `AscentView` 变纯渲染**：读 `resolveAscent(run)` → 一个按钮 → `executeAscent(state, resolution.mode)`。删掉并列三选项与各自的 disabled 拼装。
- `beginAscentFromDive` 不动（贴邻拦截＝决策 ②）；非贴邻被追路径进上浮屏后由 `resolveAscent` 落到行 E。
- **regress 契约**：新增 ascent-resolution 断言（`scripts/playthrough-ascent.ts` 或并入既有 playthrough），对 §2 每一行构造对应 `run` 状态，断言 `resolveAscent` 选对 `mode` / `blocked`。把「不再有假选择」变成一个会在 `npm run regress` 里失败的检查（CLAUDE.md：约定落成机制，别留散文）。
- 文案措辞、确认阈值、`determineBends` 数值沿用现有，不在本次调（defer-number-tuning）。
- 新增 SPEC 需挂进文档导航以过 `check-doc-links`（落地时补 nav 链接）。

## 5. 弃战上浮（战斗 → 上浮 · duress · 已实装）

战斗里转身向上脱离（`CombatView` 弃战按钮 / 战斗应急上浮 `emergency_ascend` outcome）会进**同一张**上浮屏——但战斗已清掉 `run.stalker`，若按裸状态判，`resolveAscent` 会误当「没被追」给一个干净 `normal`（刚从怪嘴里逃出来却能从容减压·荒谬）。

机制：上浮 phase 带 `duress` 标记（`beginAscent(state, returnTo, { duress:true })`·`combat.ts` 应急上浮 outcome 的 phase 同置）。`resolveAscent(run, { duress })` 把 duress 并入 `denyClean`（与「被追且有氮债」同一闸）⇒ 否决干净 `normal`、落 `rushed`（氧再够也带伤）；氧危急仍落 `emergency`。文案走「弃战」串。弃战按钮**不再自带 confirm**——上浮屏单按钮按状态自决（避免双重确认 + 文案打架）。

附带诚实性：`resolveAscent` 预测 `determineBends`，**IV 型（会死·尤其高氮 `rushed`）→ `needsConfirm` 弹死亡确认**，别让按钮静默送命。

单点收口：`playtest-sim` / `playtest-llm` 两个 harness 原各抄一份 mode 选择，一并改读 `resolveAscent`（删第 2、3 份拷贝·收口单一真相）。

regress：`playthrough-ascent.ts` 的 `duress` / `lethal` 两节锁住（弃战否决干净 + 无 duress 同态对照 + 高氮 rushed 弹确认）。

## 6. 不在本次范围

- 潮汐窗口作为第二压力轴（与猎手并列的「赶在窗口关闭前出水」）：北极星方向，留后续。
- 决策前移到「何时折返」的下潜循环重构（原方向 3）：远期、独立 session。
