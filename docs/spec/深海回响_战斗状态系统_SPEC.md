# 深海回响 · 战斗状态系统设计文档

> **状态（2026-07-12）**：设计**锁定稿·未实装**。本文是 `深海回响_战斗系统_SPEC.md` 的子文档，接续 **#290 战斗改版**（HP=生命持久落伤 / 体力=行动预算 / 伤害 `resolveDamage(攻−防·下限0)` / 删闪避+负伤整套 / 敌保留 `stunned`+DoT `bleeding`/`poisoned`）。
> **一句话**：把「战斗状态（眩晕/中毒/撕裂…）」从敌人专属提升为**玩家↔敌↔敌对称的一套系统**——同一份数据形状、同一个结算函数，谁都能挂、谁都能中。**敌 vs 敌**是已确认的未来特性，本设计从第一天就让它「几乎免费」（留缝、不建）。
> **关键前提（已核对现状代码）**：并**不存在** `Combatant` 类型；`resolveDamage(rawAttack, defense)` 是**纯数值函数**（`max(0, 攻−防)`），玩家/敌/敌任意两方套同一函数即对称。敌人**已**带 `EnemyInstance.statuses: EnemyStatus[]`（形状恰是本设计要的）——本系统是对既有机制的**泛化+统一**，不是另起炉灶（守 [[correctness-over-minimal]]：加法扩展、别撕已测机制）。

---

## 0. 范围

**做**：一套数据驱动的战斗状态系统——独立实例、堆叠、确定命中、布尔免疫、自己回合开始结算；玩家与敌人共用。v1 目录先把现有 `stunned/bleeding/poisoned` 泛化到玩家。

**不做（本期·留缝见 §5）**：敌 vs 敌的目标/敌意模型、状态来源归属（source）、净化/驱散、状态图标 UI、易伤/属性克制。数值手感一律 defer（[[defer-number-tuning]]）。

---

## 1. 为什么现在 & 设计目标

1. **对称是免费的正确**：`resolveDamage` 已是数值对称；状态也抽成对称系统，是同一条路走到底，且让未来「敌 vs 敌」只剩「让敌人 AI 选另一个敌人当目标」+ 触发内容，状态这层数学一行不改。
2. **最简表示 = 机制**：不建 stack 计数器、不建去重、不建 source。「堆叠」不是要造的功能，而是「一列各自独立计时的实例，在回合开始一起结算」的自然产物。落成机制、别靠散文（守 CLAUDE.md「约定落成机制」）。
3. **玩家专属轴不被污染**：氮气/减压病/发疯 seam/体力**不是** status，不进这套（§4）。

---

## 2. 核心模型（锁定决策）

### 2.1 数据形状 —— 单一源的独立实例列表

现有 `EnemyStatus`（`src/types/enemies.ts`）**提升为共享类型 `StatusInstance`**（建议落新 `src/types/status.ts` 单一源，`enemies.ts` 与 `combat.ts` 均 import·避免二者互相 import 造成的类型环）：

```ts
export type StatusKind = 'stunned' | 'bleeding' | 'poisoned'; // v1 目录

export interface StatusInstance {
  kind: StatusKind;
  remainingTurns: number;   // 该角色「自己的回合」计数
  dmgPerTurn?: number;      // DoT 每回合伤（潜力值/potency）；二值状态（stunned）不用，缺省 0
}
```

- **敌人**：`EnemyInstance.statuses: StatusInstance[]`（改名即用·现状已在）。
- **玩家**：`CombatState.playerStatuses: StatusInstance[]`（新增）。**战斗态·不序列化**——`CombatState` 从不入存档（现状多处注明），故**零存档影响、不 bump `SAVE_VERSION`**（守 quirk #99）。状态是**战斗内作用域**：战斗结束即随 `CombatState` 消失（毒不出战·v1 简单默认；要「战后仍流血」是后续单独决策·别顺手做）。

### 2.2 施加：确定命中 + 只堆叠

- **确定命中**：带 status 的攻击**必上**，除非目标免疫（§2.5）。**无掷骰** ⇒ application 这块**不引入战斗 RNG**（免掉一处 `bless:combat` 负担）。
- **只堆叠**：每次 apply ＝**push 一条新独立实例**。不去重、不按 kind 合并、不按 source 合并。
  - ⚠ **改现状**：现在 `applyStatusOnHit` / DoT 施加处会 `statuses.filter(st => st.kind !== kind)` **先删同类再加**（＝刷新/替换语义）。本设计要**去掉这个 filter**，改纯 append（`crowd_control` 的 `applyStatusToAll` 现在已是纯 append·作为对照）。
- **潜力值**：`dmgPerTurn` 由施加方（`AttackEffect.applyStatusOnHit` / `EnemyAttack.applyStatusOnHit`）带入该实例。

### 2.3 结算：自己回合开始 · 先结算后减 1

单一纯函数，玩家与每个敌人在**各自回合开始**跑同一个（现状敌人 DoT 在**回合末**结算——本设计统一到**回合开始**）：

```
settleStatusesAtTurnStart(hp, statuses):
  1. DoT  = Σ (st.dmgPerTurn ?? 0)          // 所有实例求和
     hp  -= DoT                             // 落 HP·一次死亡判定
  2. stunned = statuses.some(kind==='stunned')   // 决定这回合能否行动（读·此刻）
  3. statuses = statuses
        .map(remainingTurns - 1)
        .filter(remainingTurns > 0)         // 减 1、清零移除
  return { hp, statuses, stunned }
```

**顺序是唯一会咬人的 off-by-one，必须写死**：DoT 与 stun 判定都在**减 1 之前**读。这样「N 回合的效果」正好作用在该角色自己的 **N** 个回合上（1 回合的晕 = 恰好跳过 1 次行动后消失）。

- **玩家**：在 `applyPlayerAction` 顶部结算 `playerStatuses`；若 `stunned` ⇒ 本回合玩家行动被消耗为「挣扎·无效」（UI 呈现后续·§5）。
- **敌人**：在 `runEnemyTurn` 每个敌人回合**开头**结算其 `statuses`（取代现回合末 DoT tick）；`stunned` 敌人**不行动**（现状已按 `statuses.some(kind==='stunned')` 过滤行动者·语义一致，只挪时点）。

### 2.4 二值状态 vs DoT

- **二值（stunned）**：`≥1` 条活跃即生效。5 回合晕 + 3 回合晕 ⇒ 等效被晕 5 回合（并集 = 最长者）。这是「独立实例 + 一起结算」的自然结果，不需特判。
- **DoT（bleeding / poisoned）**：所有实例 `dmgPerTurn` **求和**，**绕防御**（**不**过 `resolveDamage`·现状 DoT 即直读 `dmgPerTurn`·本设计保持），**直落 HP·可致死**。手快的敌人把毒叠爆 = **预期**。

> 对比护栏：毒叠爆是**你还能动**的 DPS 竞速（可逃/上浮/反杀）；**晕叠爆会夺走操作权**（stun-lock）。确定命中 + 布尔免疫 + 无限叠 ⇒ 一个高频施晕的敌人 = 对非免疫目标的永久锁。**这不是机制 bug 而是内容护栏**：晕类攻击靠内容侧「少而短」（低频、短时）约束（调值期处理·[[defer-number-tuning]]）。若日后发现必须让晕能 miss，再给 status 一个 proc 几率——代价是把 RNG 收回来、需 `bless:combat`。

### 2.5 抗性：布尔免疫

- 每个战斗方按 `StatusKind` 声明免疫清单：新增 `EnemyDef.statusImmunity?: StatusKind[]`（数据·enemies/*.json）；玩家 v1 缺省无免疫（装备/道具赋免疫＝后续缝）。
  - ⚠ 与既有 `EnemyDef.immunity?: DamageType[]`（**伤害类型**免疫·如物理/电）**正交·别混**——一个管「这种伤打不动它」，一个管「这种状态挂不上它」。命名取 `statusImmunity` 与既有 `immunity` 并列。
- 施加时：`if (!target 免疫 kind) push`。免疫 ⇒ 该 status 对它**完全无效**（不是减时长、不是减潜力）。
- **不做数值抗性、不做易伤**。「湿身怪吃电 +50%」这类是**属性伤害/克制**范畴，属另一系统（§5），别塞进状态抗性。

### 2.6 对称性落点

- 直接伤：玩家↔敌↔敌均 `resolveDamage(攻, 防)`（现状·无 `Combatant` 类型·纯数值即对称）。
- 状态：`StatusInstance` 单一源 + `settleStatusesAtTurnStart` 单一结算函数，玩家/敌人**共用**。
- ⚠ **新增施加通道**：`EnemyAttack` 目前**没有** `applyStatusOnHit`（因为玩家原本无 status）。需新增 `EnemyAttack.applyStatusOnHit?: { kind: StatusKind; turns: number; dmgPerTurn?: number }`，镜像 `AttackEffect.applyStatusOnHit`——这是「敌人能给玩家上状态」的入口。

---

## 3. 与现状代码的差异（落地清单）

| # | 改动 | 位置（符号·非行号） | 性质 |
|---|---|---|---|
| 1 | `EnemyStatus` → 共享 `StatusInstance`（+ `StatusKind`），移入单一源 | `types/enemies.ts` → 新 `types/status.ts`；`EnemyInstance.statuses` 引用改名 | 类型重构·typecheck 兜 |
| 2 | 玩家状态数组 | `CombatState.playerStatuses`（`types/combat.ts`）·不序列化 | 加字段·零存档 |
| 3 | 敌→玩家施状态入口 | 新增 `EnemyAttack.applyStatusOnHit?` + `enemyAttackPlayer` 施加逻辑 | 加通道 |
| 4 | 施加改「刷新」为「堆叠」 | 去掉 `applyStatusOnHit`/DoT 施加处的 `filter(kind !== ...)`，纯 append | **行为变**·需 bless |
| 5 | 结算统一到回合开始 | 抽 `settleStatusesAtTurnStart`；`runEnemyTurn` 回合末 DoT → 回合开头；`applyPlayerAction` 顶部结算玩家状态 | **行为变（时点）**·需 bless |
| 6 | 布尔免疫 | 新增 `EnemyDef.statusImmunity?: StatusKind[]`（与既有 `immunity: DamageType[]` 正交）；施加处门控 | 加数据+门 |
| 7 | 战利品恒归玩家 | 见 §4（v1 多为既有行为·确认 DoT 击杀照常掉料） | 校验为主 |

> **凡改动 4/5 触碰伤害或回合数 ⇒ 提交前必 `npm run bless:combat` 重出战斗 baseline**（内容侧 scenario 也要重 bless）。application 无 RNG ⇒ 不新增随机性负担。

---

## 4. 边界与既定原则

- **玩家专属轴不进本系统**：氮气 / 减压病 / 发疯 seam（[[remove-sanity-system]] 的二态地点缝门）/ 体力预算——它们**不是** status，别顺手建成 status 污染对称性。本系统只管「战斗内、可挂在任意战斗方、会结算/到期」的东西。
- **战利品恒归玩家**：一场遭遇里**谁补刀都算玩家的**（DoT 毒死、未来敌 vs 敌互殴致死……）。v1 无敌 vs 敌 ⇒ 所有击杀本就玩家所致；落地只需**确认 `finalizeVictory` 对「DoT 在敌人自己回合致死」的敌人照常掉料**（现状 `hp→0` 即真死·非 fled·应已成立）。完整规则等敌 vs 敌特性再补。

---

## 5. 留缝（未来·别现在建）

这些是**已知未来方向**，本设计只保证「不挡路」，**不实装**：

- **敌 vs 敌**（已确认未来特性）：需 `team`/`faction` 字段 + 敌人选敌 AI + 触发玩法（引诱/激怒/信息素）。属**目标/敌意子系统**（战斗循环+AI），**不属状态层**——二者只在「一次攻击命中谁」相交，那点在 targeting 里。状态层已 source/target 无关 ⇒ 敌 vs 敌落地时状态数学零改。
- **source 归属**：v1 **不存** `StatusInstance.source`。理由：战利品恒归玩家、状态实例自足（续存＝没人在死亡时回收它施加的状态·天然成立），v1 **无任何消费者**读 source——按 #291/#292「无消费者不留惰性字段」的纪律，等「敌 vs 敌 / 互黑归属 / 战斗日志署名」真需要时再加（[[forbidden_island]] 互黑=真相通道）。
- **净化/驱散**：v1 无（无道具/技能移除状态）。是**决策**不是遗漏。
- **状态 UI**：玩家/敌人身上的状态图标、层数、剩余回合——后续（复用 #257 截图 harness 验收）。
- **易伤 / 属性克制**：数值抗性、元素克制（吃电+50%）属**属性伤害系统**，与本状态系统正交，另议。

---

## 6. 机制纪律

- **bless 门**：改动触碰战斗伤害/回合数 ⇒ `npm run bless:combat`；boss baseline 靠 `hpMaxBonus`（[[combat_hp_revamp]]）。
- **术语门**：状态中文名固定 眩晕 / 撕裂(bleeding) / 中毒(poisoned)，过 `check-terminology`。
- **无惰性字段**：不加没有消费者的字段（source 见 §5·evasion/hitBonus 前车之鉴 #291/#292）。
- **单一源**：`StatusKind`/`StatusInstance` 一处定义；结算一个函数；施加去重逻辑不复制粘贴。共享/专属边界靠**类型**（`StatusKind` 联合）兜，别靠散文。

---

## 7. 实施次序 + 模型/effort 建议

依赖清楚、机械，可跟本 SPEC 顺序落（每步 typecheck，末尾一次 `bless:combat`）：

1. 类型单一源：`StatusInstance`/`StatusKind`（`types/status.ts`）+ 改名引用。
2. `settleStatusesAtTurnStart` 纯函数 + 单测（off-by-one：1/2/3 回合各验一遍）。
3. 敌人接线：`runEnemyTurn` 回合末 DoT → 回合开头结算；施加去 `filter`（堆叠）。
4. 玩家接线：`CombatState.playerStatuses` + `applyPlayerAction` 顶部结算 + `EnemyAttack.applyStatusOnHit` 通道 + `enemyAttackPlayer` 施加。
5. 布尔免疫：`EnemyDef.statusImmunity`（与既有 `immunity: DamageType[]` 正交）+ 门控。
6. `bless:combat` 重出 baseline + scenario 重 bless；`npm run regress` 全绿门。

**建议**：SPEC 到实装是**仓内代码活**（非 Cowork 文档活）。用 **Sonnet · 中等 effort** 跟着本 SPEC 落最合适（依赖清晰、少歧义）；步骤 2 的 off-by-one 单测是正确性关键，值得 **Opus** 或人工复审一眼。**并行**：步骤 1→2 串行（后者依赖前者），3/4/5 在 2 之后可**并行三条独立车道**（敌人接线 / 玩家接线 / 免疫数据互不重叠·psm 三 worktree），末尾 main 整合再 bless（[[cowork-parallel-agents]]：合并后必跑完整 regress + `bless:combat`）。

---

## 8. 未决 / 占位（数值 defer）

- 各 `StatusKind` 的默认 `turns` / `dmgPerTurn` 占位待作者调（[[defer-number-tuning]]）。
- 晕类攻击的「少而短」内容护栏具体数值（§2.4）——调值期定。
- v1 目录是否除 stunned/bleeding/poisoned 外再加（slowed/weakened…）——先不加，有内容需求再扩 `StatusKind`。

---

## 附：决策记录（一句一条·便于 grep / 交接）

- 只做堆叠·无刷新模式。每次 apply = push 独立实例。
- 结算 = 自己回合开始·先结算（DoT 求和落 HP + stun 判定）后减 1。
- 命中确定（除非免疫）·无掷骰·application 无 RNG。
- 抗性 = 布尔免疫（完全无效）·不做数值抗性/易伤（易伤归属性伤害系统）。
- DoT 绕防御·直落 HP·可致死·多实例求和。
- 二值（stun）= 有任一活跃即生效·多实例取并集（最长者）。
- v1 不存 source·续存天然成立·等敌 vs 敌/互黑再加。
- 战利品恒归玩家（谁补刀都算）。
- 状态战斗内作用域·`CombatState.playerStatuses` 不序列化·不 bump SAVE。
- 玩家专属轴（氮/减压/发疯 seam/体力）不进本系统。
- 敌 vs 敌 = 已确认未来特性·状态层已留缝（source/target 无关）·本期不建 targeting/team。
