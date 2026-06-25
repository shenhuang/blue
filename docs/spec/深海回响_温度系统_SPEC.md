# 深海回响 · 温度系统 SPEC（热/冷双极门控）

> 状态：**机制层草案**（2026-06-25 · psm 车道 `cave-temp`）。本棒只做**解耦侧表 + 纯函数 + 标注**——不接 dive/state（见 §7 接线 = T2 follow-up）。
> 上游设计：`docs/spec/cave_zones_spec.md` 设计章 v2 §6（热/冷双极 · deferred 系统）。
> 写法范本：`docs/spec/深海回响_氮气系统_SPEC.md`（资源 + 阈值 + 纯函数单点）+ `engine/ascent.ts`（N2 阈值同住、确定性无 RNG）。

---

## 0. 本棒边界（解耦侧表·与 T2 cave-bmap 并行不撞车）

- **温度数据/类型/纯函数全放自有文件**，**不碰** `dive.ts` / `state.ts` / `zones.json` / `mapgen.ts`。
- 三件套：
  - `src/data/cave_temperature.json` —— 按 `zoneId` 的温度侧表（**不进 `zones.json`**）。
  - `src/types/temperature.ts` —— 类型。
  - `src/engine/temperature.ts` —— 纯函数（输入 stress/intensity/insulation/depth，输出门控/后果，**不直接改 state**）。
- **门控接入 dive（消费这套纯函数 + 给 `Stats` 加 `thermalStress` 资源字段 + 上浮/移动时调 step）属 T2 land 之后的 follow-up**，本棒不动那些文件（§7）。
- 侧表引用的 `thermal_pocket` 等 zoneId **当前 `zones.json` 里还没有**（随 cave-bmap/Batch 0 落地）。侧表是**领先标注数据**——`getCaveTemperature` 未命中走中性默认（§4），所以提前标注零风险；zoneId ⊆ zones.json 的校验门留到 T2 接线时加。

---

## 1. 角色定位（与氮气正交的第二条环境债）

- **氮气** = 越深越重的**全局**债（深度驱动·随处累积·上浮还债）。
- **温度** = **局部·按洞**的双极债（只在热极/冷极洞累积·潜服保温抵消·离开即恢复）。
- 两者共享「资源 + 阈值 + 潜服抵消 + 超阈后果」的形状，但温度是**地点门控**（决定某些洞**能不能进 / 能不能探全**），氮气是**时间/深度门控**（决定能待多久、上浮多痛）。
- **外传是主舞台**（热液/冷盆专项）：温度真正发力在外传的 vent 火山区与深水冷团。**ch1 只做标注 + 基础门控纯函数**，不阻塞洞穴本身（§6 deferred）。

---

## 2. 资源模型（热应力 thermal stress · 单极标量 · 0–100）

热极与冷极**共用一根 0–100 应力轴**（`thermalStress`）：0 = 体温无虞，100 = 暴露致命。极性只影响**叙事 + 未来分热/冷两种保温装备**，不影响应力数学（保持模型最小·别一次做满）。

```text
净暴露 deficit(intensity, insulation) = intensity − insulation      // 潜服保温直接抵消洞的强度
应力上限 ceiling                       = clamp(deficit, 0, 100)       // 抵消够 → 上限 0 → 不积累
单步演化 stress'  = ceiling + (stress − ceiling) · 2^(−Δt/τ)         // 指数逼近·同管累积与恢复
```

- 与氮气 `stepNitrogen` **同构**：一条式子同管「热极/冷极洞里累积」（stress<ceiling→涨）与「离开/保温足够后恢复」（ceiling=0→趋 0）。
- **逐回合 step == 一次性 step(turns)**（指数可组合）—— 守 dive-stalker「逐字节同数」口径（与氮气同款回归不变量·见氮气 SPEC §2 注）。
- `intensity`（洞的极端度·0–100）由侧表给（数据驱动）；`insulation`（潜服保温·0–100）由调用方从装备算（本棒**不**耦合 equipment 类型·只收一个标量·分热/冷保温留未来）。

**提案常量（首版·playtest 旋钮·数值待作者统一调〔见 memory defer-number-tuning〕）：**

| 旋钮 | 值 | 含义 |
|---|---|---|
| `HALF_TIME` τ | 12 | 每 τ 回合向 ceiling 靠拢一半（比氮气 15 略快·局部暴露见效更快） |
| `BASELINE_INSULATION` | 30 | 基线潜服保温（无升级）。侧表 `reach` 标注 = 在此保温下的预期档（§3 一致性门） |

---

## 3. 门控（探全 access · 由 deficit 派生三档）

一个 `deficit` + 两个阈值 → §6 设计的三档「可达档」全派生出来，**零额外 per-zone 数据**：

```text
GATE = { FULL_EXPLORE_AT: 0, ENTRY_BLOCK_OVER: 40 }

canExploreFully = deficit ≤ FULL_EXPLORE_AT   // 保温 ≥ 强度 → 全可探
canEnter        = deficit ≤ ENTRY_BLOCK_OVER  // 差太多 → 连入口都过不去

reach 派生：
  deficit ≤ 0            → 'full'           （全可探）
  0 < deficit ≤ 40       → 'partial'        （能进·核心/深处探不全）
  deficit > 40           → 'entry_blocked'  （入口不可达）
```

- 侧表里**也存一份作者标注的 `reach`**（设计意图·人读）。**机制门**：`expectedReach(intensity) == 侧表 reach`（在 `BASELINE_INSULATION` 下派生）—— 数据↔标注一致性做成会红的单测（数值/标注漂移即红·别靠散文守）。
- 玩家升级保温 → `deficit` 下降 → 原本 `partial` 的洞变 `full`、`entry_blocked` 变 `partial`：**保温装备就是温度洞的钥匙**（外传进度曲线）。

---

## 4. 侧表与中性默认（懒默认·同 shopStock 语义）

- `cave_temperature.json` **只列非中性洞**（热极/冷极）。**未命中 = 中性·全可探**（`{polarity:'neutral', intensity:0, reach:'full'}`）—— 与 `getShopStock` 缺条目即满货的懒默认同思路（侧表只增非默认项·别给 27 洞各写一条中性）。
- `getCaveTemperature(zoneId)` 单点返回（命中查表·未命中给中性默认）。

**侧表内容（ch1 标注·热极/冷极·intensity 为占位待调）：**

| zoneId | polarity | intensity | reach（派生·BASELINE=30） | 来源 §6 |
|---|---|---|---|---|
| `thermal_pocket` | hot | 55 | partial（探不全） | 热极·热水窟 |
| `lava_branch` | hot | 60 | partial（探不全） | 热极·熔管岔道 |
| `collapsed_caldera` | hot | 80 | **entry_blocked**（入口不可达·过热） | 热极·塌陷火口（个别入口不可达） |
| `black_basin` | cold | 50 | partial（探不全） | 冷极·黑水盆（设定「水非常非常凉」） |
| `the_deep_gate` | cold | 60 | partial | 冷极·深门核心冷（**核心不可达另由远双锁/剧情门·非温度独管**） |
| `drowned_well` | cold | 45 | partial（option） | 冷极·沉井深降流（设计 §3 标 option） |

> 热极 thermal_pocket/lava_branch = 探不全、collapsed_caldera = 入口不可达 → 兑现 §6「多数探不全·个别入口不可达」。
> the_deep_gate 的「核心不可达」是 §3 远双锁 + 剧情门负责，温度侧只给「核心冷·partial」，**不与那套门耦合**。

---

## 5. 超阈后果（thermalDrain · 连续 · 体力）

超过 `WARN` 阈值后按应力连续扣**体力**（热极=过热脱力 / 冷极=失温麻木·叙事分极性·数学同款）。仿氮醉 `narcosisSanityDrain`（连续·确定性·低应力≈0）：

```text
TEMP = { WARN: 40, HARM: 60, CRITICAL: 85 }   // 0–100 应力轴

thermalStaminaDrain(stress, turns):
  over = (stress − WARN) / (100 − WARN)        // 归一化超阈量
  if over ≤ 0: 0
  K · over^2 · turns                            // K=0.5 首版·平方 → 低超阈轻、高应力咬
```

- 低应力几乎不扣（平方）·`CRITICAL` 以上是「再不走会出事」的强警告区（UI 门控/强制撤退留 T2 接线时定·本棒只给数值）。
- **纯函数只输出数字**（扣多少体力 / 是否过阈）·**不碰 state**——调用方（未来 `tickTurns`）决定怎么落。

---

## 6. 单点 / 单写者（机制·防解耦腐烂）

- 温度的**全部数学**只在 `engine/temperature.ts`（`thermalCeiling` / `stepThermalStress` / `thermalAccess` / `thermalStaminaDrain` / `getCaveTemperature` + `TEMP`/`TEMP_MODEL` 常量）。别在别处手算温度增减（参照氮气单写者 + 负伤 #116）。
- 阈值/旋钮与曲线**同住**（一调全跟·单点）——同 N2 迁进 nitrogen.ts 的先例。

---

## 7. 接线（= T2 cave-bmap land 之后的 follow-up · 本棒不动）

接入需要动的文件（**本棒不碰**·留 follow-up）：

| 文件 | 接线改动（follow-up） |
|---|---|
| `src/types/state.ts` | `Stats` 加 `thermalStress: number`（0–100）。形状变 → **bump `SAVE_VERSION`**（quirk #99·未发布·洗档无负担）。 |
| `src/engine/events.ts` `tickTurns` | 按当前 zone 的 `intensity` + 潜服保温调 `stepThermalStress` 累积；过阈调 `thermalStaminaDrain` 扣体力。 |
| `src/engine/dive.ts` / 入潜流程 | 进洞前查 `thermalAccess`：`entry_blocked` → 不让下潜（同 §6 封口）；`partial` → 可下潜但深处核心门控。 |
| 装备/潜服 | 把保温做成一个 `insulation` 标量（或分热/冷两值）喂给上面纯函数。 |
| regress 门 | ① 侧表 zoneId ⊆ zones.json；② `Stats.thermalStress` round-trip；③ 接线后把 `playthrough-temperature.ts` 扩到带 state 的端到端。 |

**接线前**：`engine/temperature.ts` 是无副作用纯函数岛，无人消费也不破坏任何现有行为（typecheck 绿即安全 land）。

---

## 8. Regress 门清单（本棒机制化）

`scripts/playthrough-temperature.ts`（被 `regress.mjs` 自动发现·并行安全）：

1. **ceiling/抵消**：`thermalCeiling` 随 intensity 单调增、随 insulation 单调减、clamp 0–100；保温 ≥ 强度 → 0。
2. **step**：热极洞从 0 累积（趋 ceiling·不越界）；离开（intensity=0）/ 保温足够 → 恢复趋 0；`turns=0` 不变；**逐回合 ×N == 一次性(N)**（守 stalker 一致性）。
3. **门控**：`thermalAccess` 三档边界（deficit 0 / 40）钉死；保温提升 → 档位单调放宽。
4. **后果**：`thermalStaminaDrain` 对 stress 单调、`WARN` 以下 = 0、锚点值钉死。
5. **数据↔标注一致性门**：`cave_temperature.json` 每条的作者 `reach` == `expectedReach(intensity)`（BASELINE 下派生）—— 数值/标注漂移即红。
6. **侧表合法性**：polarity ∈ {hot,cold}（中性不入表）、intensity ∈ [0,100]、zoneId 无重复。

---

## 9. 待作者确认的旋钮（数值统一最后调·memory defer-number-tuning）

- `HALF_TIME=12`、`BASELINE_INSULATION=30`、`GATE={0,40}`、`TEMP={40,60,85}`、`thermalDrain K=0.5`：首版占位。
- 侧表 6 条 `intensity`（55/60/80/50/60/45）：占位·决定各洞落在哪档。
- 极性是否最终分「热保温 / 冷保温」两种装备词条（本棒留单标量·未来可拆）。
