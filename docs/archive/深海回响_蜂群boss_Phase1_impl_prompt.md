# 深海回响 · The Warren（蜂群 boss）· Phase 1 实装起手 prompt

> 用法：开一个实装 session（或按 §5 的 PSM 两条车道并行），把本文件当起手交接。**先读 SPEC**：`docs/spec/深海回响_蜂群boss_SPEC.md`（单一真相）。本 prompt 只给范围/顺序/车道/验收，不重述设计。
> 生成于 2026-07-06（设计层已封版·仅数值 defer）。
>
> **【实装纠错 2026-07-06 · #269】§4「共建茧化机制」前提作废**——茧化 `maybeMetamorphosis`/`maybeCocoonCountdown` + `EnemyDef.metamorphosis`、连女王整套 kit（`corpseEating`/`droneReplenish`/`maternalBehavior`/`shieldedBy`/`phases`/`environmentalPressure`）**早已 ship**（随 `cocooned_resident`/`mycelial_fish`）·非待实装、非共建。Phase 1 core spine 已按 **map-level hybrid** 实装（沙箱 regress 94/94）——**实装状态 + 架构决定 + deferred 全见 SPEC §13**。本 prompt 保留作历史起手记录，别再照 §4 当「待共建」。

---

## 0. 起手（轻起手 · 省上下文）

- 定位用 `npm run handoff`（git log + status + 最新 nightly REPORT 头 + STATUS 顶）——别手抄「做了什么」。
- **别在起手跑全量 regress**（昨晚 nightly 已验证全绿·起点几乎必绿）；要便宜体检就 `npm run regress:quick`（typecheck）。
- 只读 **the Warren SPEC + 本 prompt**；SPEC 按方向懒加载，别全读 `docs/spec/`。
- 相关记忆（按需读）：`boss-enemy-design`（茧化机制·本 boss 与它共建）、`lunar-tide-system`（撤退存档窗）、`scenario_framework`（baseline）、`infra_mechanisms`（check-boundaries）、`cowork-parallel-agents` / parallel-sessions（PSM）、`blue_regress_sandbox`（沙箱跑 regress）。

---

## 1. 目标

**Phase 1 = 引擎骨架 + 内容数据**，把 SPEC §3–§9 的机制骨架落地、数值全占位。一句话验收：**「进近 → 破封口墙 → evacuation 回满血逃走 → 逐间 morph 升级 → the Hatchery 死角背水一战 → 耗干女王回血、杀死女王（＝取胜）→ 崩解」这条闭环能在一场战斗里跑起来（占位数值），并配 baseline scenario 回归。**

---

## 2. 不变量（验收试金石 · 任何实现都不能破）

1. **女王：动不了、不攻击、无自我**——`EnemyDef` 无攻击表；她只「产卵 + 吞食回血」；移动是被 Wardens/Spawn 拖动的表现层（§2b / §5 / §9.3）。
2. **取胜＝杀死女王**（§4）。前两间杀不掉她**因为她逃 + 回满血**（不是「有总源在补」）；唯有最深的 the Hatchery 死角她退无可退，你耗过她那点有限回血（Spawn→卵）才杀得掉。**the Hatchery 只是地方、不是可摧毁目标。**
3. **无脚本死**：`flee`（氧≥3）/ 拉开 graph 距离，出口始终在（§7 · `combat-exit-semantics` 记忆）。
4. **boss ＝规则变化，不是数值膨胀**：逐间升级靠 morph / 规则皱褶，**不是 +HP/+ATK**（§5）。

---

## 3. 复用（已 ship · 别重造）

- `BossPhase` / `EnemyDef.phases` / `environmentalPressure` / `EnemyInstance.phaseAttacksOverride`（`src/types/enemies.ts`）。
- `maybeBossPhaseShift` / `applyEnvironmentalPressure`（`src/engine/combat-mechanics.ts` · combat 主循环已挂）。
- 链鳗 `maybeChainEelEnrage`「party-state 触发行为替换」模式——**崩解终态**直接套（反用：女王死 → 残余 Spawn 无首失序）。
- mapgen：`LayoutStyle` / `mapShape`（`map-layout-styles` 记忆）+ 多口持久洞（`深海回响_多口持久洞_SPEC`）。

---

## 4. 共建依赖（重要 · 别当已存在）

- **结茧 morph 依赖 boss 蓝图的「茧化」计时机制**（`boss-enemy-design` 记忆 · **仍待实装**）。本 boss 与它**共建**：Phase 1 先把通用的「茧化状态 + 计时 + 到点羽化 / 趁茧期击破有奖励」落地，Spawn→Puffer、Warden→Guard/Berserker 是它的首批消费者。
- **撤退月相存档窗**接月相潮汐（`lunar-tide-system` 记忆 · `advanceDays` / 总天数 · MVP 已实装）：按**总天数**（非月相跳变）bank / reset。

---

## 5. PSM 两车道并行（车道不重叠 · 见 parallel-sessions / `cowork-parallel-agents`）

开线示例：
- `node scripts/psm.mjs start warren-engine --lane 'src/engine/**','src/types/**'`
- `node scripts/psm.mjs start warren-content --lane '<敌人库 JSON 目录>','scenarios/**'`（敌人 JSON 路径见 `docs/skills/深海回响_敌人入库_SKILL.md`）

### 车道 E｜引擎骨架 — 模型 **Opus · high effort**

（新钩子横跨 combat / mapgen / 存档派生，架构敏感。守 `check-boundaries` 六规则 · `infra_mechanisms` 记忆。）

- **E1 `maybeSwarmQueenRelocate`（evacuation）**：暴露窗 / `hpThreshold` 命中 → 女王移下一巢室 + 吞 Spawn 回满血 + 巢回补；**第三间（the Hatchery）禁 relocate**（背水一战）。女王无移动 / 攻击 AI（§9.1）。
- **E2 the Hatchery ＝终局死角节点（非可摧毁目标）**：`maybeSwarmQueenRelocate` 在此**禁用** → 女王退无可退、可被打死；前两间她 relocate + 回满逃走故杀不掉。取胜＝**女王 HP 归零**（§9.2）。
- **E3 结茧 morph 通用机制（共建茧化）**：茧化状态 + 计时 + 羽化 / 击破奖励；Spawn→Puffer、Warden→Guard·Berserker（§9.8）。
- **E4 Puffer 自爆 + 远程豁免**：近战攻击 / 到点自爆（AoE）；远程击破**不对玩家触发**自爆伤害（§9.9 · 接武器远/近）。
- **E5 封口墙＝逃跑门**：evacuation 在通道生成一道「墙」party（1st Spawn / 2nd Guards），**杀穿才解锁**追进下一巢室（§9.10）。
- **E6 Spawn 密度按近女王距离派生** + Warden 近核限定（§9.5 · 派生不入档 · quirk #99）。
- **E7 崩解终态**：套 `maybeChainEelEnrage`（女王死 → 残余 Spawn 无首失序 / 自相残杀 → 数回合自灭）（§9.6）。
- **E8 撤退 / 月相存档窗**：Warren 状态（女王当前巢室等）按总天数 bank；≤1 月相回来续、>1 月相 reset 回起点（§9.11 · 接 lunar-tide）。
- **E9 蜂巢 mapgen 覆写**：外层进近区 + 三内层巢室 + 最深 the Hatchery；**女王恒在深处**（§8）。

### 车道 C｜内容数据 — 模型 **Sonnet · medium effort**

（照 §5 手册 + §2c 外形 + `深海回响_敌人入库_SKILL.md` 填。数值占位 `待作者调`。守 `check-terminology`。）

- **C1 六个 `EnemyDef`**：女王（无攻击 · 产卵 + 吞食回血 · `phases` 用 evacuation 触发 · `environmentalPressure` 耗氧）、Spawn（低攻 · 易死 · 封口）、Warden（碾咬 · 拦截 · 护核）、Puffer / Guard / Berserker（morph 形态 · 外形喂图鉴见 §2c）。
- **C2 the Warren mapgen 覆写数据**：外层进近 + 三巢室 + the Hatchery 节点（配合 E9）。
- **C3 baseline 回归 scenario**（`scenario_framework` 记忆 · 加内容必配 baseline）：跑通整条闭环（§1）。

**接口约定**：E 定 schema / 字段名（morph 状态、the Hatchery 子目标、封口墙 party 标记…），C 按 E 的字段填数据。两车道**合并回 main 后必跑完整 regress**（affected 选测 + 隔离 agent 看不到跨切断裂 · `cowork-parallel-agents` 记忆）。append-only 文档（CHANGELOG / QUIRKS）只在 main 整合时写、别在 feature 树碰。

---

## 6. 数值：全占位 defer（§10 · `defer-number-tuning`）

所有 HP / 密度曲线 / 结茧计时与 morph 率 / 孵化速率 / 耗氧 / 暴露窗阈值 / 卵数 / 存档窗天数——用**能跑通的占位默认**、标 `待作者调`。**别在 Phase 1 调手感**。the Hatchery 终局手感留作者在场逐拍（巨型 boss 档）。

---

## 7. 验收（ship 前门）

- 全量 `npm run regress` 绿（含新 baseline scenario）；沙箱跑注意 `blue_regress_sandbox`（Linux esbuild/rollup 到 /tmp）。
- **闭环可跑**：单场 进近 → 1st 破 Spawn 墙 + evacuation + 回满血 → 巢室② 自带 Puffer / Spawn 结茧率↑ / Warden 始结茧 → 2nd 破 Guards 墙 → the Hatchery 死角（自带 Guards + Berserkers·禁 evacuation）→ 耗干女王回血（Spawn→自食其卵）、**杀死女王＝取胜** → 崩解（其余单位混乱自噬、慢性死亡）。
- **撤退窗**：撤出 → ≤1 月相回来女王位不变；>1 月相整场 reset。
- §2 四条试金石不变量全保持。
- 合并后在 main 跑完整 regress 再 land（PSM `psm land`）。

---

## 8. 不在 Phase 1（别做）

- 第二打法：**已作废**（§6）——单打法交付，别留后手、别建能力缝道具。
- 数值 / 手感调参：defer（§6 本文）。
- 道具高清大图 / ART：打磨期（`ui-tidy-preference` 记忆）。
