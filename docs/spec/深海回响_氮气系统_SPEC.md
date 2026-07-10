# 深海回响 · 氮气系统 SPEC（重做）

> 状态：**实施计划草案**（2026-06-14 交互 session 拍板，待作者过审后落地）。
> **⚠ « #284 理智系统移除 »**：`run.stats.sanity` 已删，氮气不再扣理智、只喂减压债（§4）。累积模型（§2）、上浮 gating（§4）、战斗氮气 ×1.5（`combatNitrogenGain`）不受影响。SAVE_VERSION 13→14。
> 关系：本档 **supersedes 主 SPEC §3/§5 与 §390/§401–402 的氮气数值**（旧 `depth/30` 线性式 + 硬阶梯氮醉）。
> 主 SPEC 的氮气「角色定位」（氮气=债务）不变。« TODO(作者)：氮醉宇宙观是否改挂别的表现（纯文案 / 体力 / 其它）或整体下架 »

---

## 0. 本次已拍板的决定（不再回炉）

1. **累积模型**：单房间饱和模型（Haldane-lite），非线性累加。
2. **压力曲线**：游戏调校（沿用氧耗的 `1+d/50` 族），不用真实物理 `1+d/10`——保证氮气在 0–290m 全程是可管理的活资源。
3. 氮醉 → 理智：**整条决定作废**（#284 理智系统移除·见 §3）。
4. **上浮 gating**：`isAscentBlocked` 统管**所有**上浮模式（含紧急）；删掉「凿穿洞顶」虚构；战斗里保留 `flee` 作脱离手段。
5. **教学 0 是症状不是 bug**：浅水≈0 是真实的，按饱和模型自然成立；「教会玩家氮气」这一拍**挪到主线中期**（约 45–60m）。
6. **软锁哲学**：资源不足而死 = 合理（不需兜底救），唯一要防的是「无可走边的真·卡死」——已由迷宫双向连通性排除（见 §4）。

---

## 1. 现状审计（为什么重做）

- **累积**：`engine/events.ts::tickTurns`（~L299）`nitrogenGain = turns * (depth/30)`。
  - 浅水/教学 `currentDepth≈0` → 增长 0（你看到的症状）。
  - 线性且无饱和上限 → 10m 待够 ~300 回合也能涨满 100（物理上不该）。
- **氮气当前的全部消费方**：只有「上浮」一个系统，且半空心：
  - 减压停留 `computeRequiredStops`（40/60/80→0/1/2/3）：**真生效**。
  - 减压病 `determineBends`（氮气绝对值 × 上浮方式 × 深度，**确定性无 RNG**）：IV 型当场死**实装**；II/III 型只写 `debuff.bends_ii/iii` flag，**全代码无读取方**（持久后果未接）；`pendingDecompression.bendsRisk` state 字段初始化后无人读写（空壳）。
- 氮醉 → 理智：**审计项作废**（#284 理智轴删除后缺口消解·氮醉不再接线理智）。
- **战斗紧急上浮**：`ui/CombatView.tsx`（~L101）按钮**无条件渲染**，任何战斗任何位置可用；洞里经 `AscentView` 重皮成「凿穿洞顶」仍放行。

---

## 2. 累积模型（饱和单房间）

```text
环境压代理   P(d)        = 1 + d/50
深度饱和上限 ceiling(d)  = 100 · (1 − e^(−d/D0))          // D0 = 100
单步演化     N'          = ceiling + (N − ceiling) · 2^(−Δt/τ)   // τ = 15（回合）
```

一条式子同管吸氮/排氮：`N < ceiling`（在更深处）→ 涨；`N > ceiling`（升浅/水面 ceiling 低）→ 自然排。水面 `ceiling(0)=0` → 排向 0。

**提案常量**（首版·playtest 旋钮）：`D0=100`、`τ=15`。

**ceiling（久留渐近值）与触发深度**：

| 深度 | ceiling | 含义 |
|---|---|---|
| 12m | 11 | 教学浅水：再久也到不了 SAFE，≈0 债 |
| 30m | 26 | |
| 45m | 36 | 接近 SAFE |
| 51m | 40 | **SAFE 线**：此深以浅永不强制减压 |
| 60m | 45 | |
| 92m | 60 | **ONE_STOP 线** |
| 108m | 66 | |
| 161m | 80 | **TWO_STOP 线** |
| 230m | 90 | |
| 290m | 95 | 最深也不硬顶 100 → 仍可靠升浅排一点（活资源） |

**N 从 0 起、在该深停留 T 回合后**（τ=15）：60m → T10:17 / T20:27 / T40:38；108m → T20:40 / T40:56。即**深度定目标、停留定逼近程度**。

**减压阈值**：复用现 `N2={SAFE:40,ONE_STOP:60,TWO_STOP:80}`，但**搬进** `engine/nitrogen.ts` 与曲线同住（曲线一调、deco 分布跟着，单点改）。注：新曲线下 deco 分布已天然按深度分层（见上表），上浮的 bends 数值可能要顺手重调一遍。

**单写者原则（机制·防解耦腐烂）**：氮气的演化只由 `engine/nitrogen.ts` 纯函数计算；潜水期**唯一调用点是 `tickTurns`**（升浮 surfacing 与 item 效果是另两个合法写者）。→ 顺手删 `dive-actions.ts::campAtNode` 里手动的 `n2Drop`（休息在原深不该平白排氮；改由 `tickTurns` 按 ceiling 正确处理）。参照负伤 `engine/injuries.ts` 单写者先例（quirk #116）。

---

## 3. 氮醉 → 理智（已删除）

> « #284 理智系统移除 »：本节原「氮醉→理智」连续模型已整体删除——氮气只喂减压债（§4）。历史见 git / CHANGELOG #284。

## 4. 上浮 gating（紧急上浮真实化）

**规则统一**：`isAscentBlocked(run)`（`zone.canFreeAscend===false` 且不在 `ascent_point`）→ **normal/rushed/emergency 一律不可**。封闭水域离开上浮口：要么摸回上浮口、要么氧尽而死（合理资源死）。

- `ui/CombatView.tsx`：紧急上浮按钮加 `!isAscentBlocked(state.run)` 门（开阔水/上浮口才出）。
- `ui/AscentView.tsx`：emergency 跟随 `isAscentBlocked`（blocked → 不渲染 emergency）；blocked 分支文案从「只能凿穿洞顶」改为「这里上不去 · 回上浮口」+ 返回。删除「凿穿洞顶」整套重皮（**减代码**）。
- 战斗脱离仍靠 `flee`：被逼到角落 ≠ 强制打不过的死，能脱离后交回资源规则。已查 7 个敌人 def `victoryConditions` 全含 `flee`。

**软锁不会发生（已论证）**：迷宫是双向连通图（`analyzeMap` 回归守、`allAscentReachable`）；「死路」是 degree-1、可原路退出的尽头，非真卡死。唯一结局是「退不及 → 氧尽而死」= 作者认可的资源死。

**开阔水 emergency 保留的意义**：它正是新氮气系统的死亡出口——「待太久 → 氮气逼近高 ceiling → 拉响应急跳减压 → 必吃 bends/死」。

---

## 5. 动哪些文件

| 文件 | 改动 |
|---|---|
| `engine/nitrogen.ts` **（新）** | 模型单点：`ambientP(d)`、`ceiling(d)`、`stepNitrogen(N,d,Δt)`、`N2` 阈值。纯函数、便于回归。 |
| `engine/events.ts` | `tickTurns`：氮气改调 `stepNitrogen`。 |
| `engine/ascent.ts` | `N2` 阈值迁出到 nitrogen.ts（改 import）；review 上浮排氮/bends 数值与新曲线一致性（deco/bends 逻辑结构不动）。 |
| `engine/dive-actions.ts` | `campAtNode` 删手动 `n2Drop`（交回 tickTurns）。 |
| `ui/CombatView.tsx` | 紧急上浮按钮 `!isAscentBlocked` 门。 |
| `ui/AscentView.tsx` | emergency 跟随 isAscentBlocked；删凿穿洞顶重皮 + 改 blocked 文案。 |
| `docs/spec/深海回响_SPEC.md` | 在 §3/§390/§401 处加一行指向本档（标注数值已 superseded）。 |

**存档**：Stats 形状不变（`nitrogen` 字段已存在）、不加新 state → **无需 bump `SAVE_VERSION`**（quirk #99）。
**边界**：nitrogen.ts 属 engine，被 engine 内部 import；UI 仍只从 engine 取 `isAscentBlocked` → 不破 engine↛ui（quirk #95）。

---

## 6. Regress 门清单（机制化，别留散文）

1. **饱和模型纯函数**：`stepNitrogen` 单测——深处趋近 ceiling、水面趋 0、浅水 ceiling 封顶（45m 久留 < SAFE）。
2. 氮醉门：**作废**（#284·`narcosisDrain` 已删）。
3. **上浮 gating**：封闭水域离上浮口时 `isAscentBlocked` 为真且**三种上浮模式 UI 均不可达**；战斗 emergency 按钮在 blocked 时不渲染。
4. **逃生阀门**：洞区战斗永远给得出 `flee`/脱离（把「别赢或死」变成会失败的检查；防未来加不可逃洞敌）。
5. **撤退可达性**：任一可达潜点都能退回某个 `ascent_point`（多半已被 `allAscentReachable` 覆盖，补断言守住）。
6. **基线重刷**：顶掉旧氮气数值的 scenario 基线（`bluecaves_sulfur_cloud__sink_through` 等）按新模型重生（quirk #43 实跑抄）。
7.（建议）**check-boundaries 新规则**：收口 `stats.nitrogen` 的计算面到 nitrogen.ts（编号落地时分配，参照 #116 injuries 单写者）。

---

## 7. 分期落地（迭代跑子集 regress，ship 前才全绿）

- **P1 引擎核心**：新建 `engine/nitrogen.ts` + 接 `tickTurns` 累积 + 删 camp 手动排氮。门：#1、#6。
- **P2 氮醉**：整期作废（#284 理智轴删除）。
- **P3 上浮 gating**：isAscentBlocked 统管 + CombatView/AscentView 改 + 删凿穿洞顶。门：#3、#4、#5。
- **P4 内容（可单独 session）**：主线中期（约 45–60m）安排「氮气演示」一拍——让玩家停留看氮气可见上涨 + 首尝一次减压停留。属叙事内容，不阻塞 P1–P3。

---

## 8. 待作者确认的旋钮

- `D0=100`、`τ=15`：首版数值，是否同意作为 playtest 起点。
- 上浮 `N2` 阈值（40/60/80）与 bends 数值：随新曲线是否要顺手重调一遍。
- 理智双压力旋钮：作废（#284·无理智轴）。
