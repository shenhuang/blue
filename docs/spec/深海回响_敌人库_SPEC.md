# 深海回响 · 敌人库（Enemy Library）设计文档

> 配套战斗 SPEC（`深海回响_战斗系统_SPEC.md`）的子文档。
> **状态：基础已实装（2026-06-14 交互 session·「按顺序实装」）· 余项待续。** 已落地：支柱三 目录自动加载（gen-enemy-registry → registry.generated）+ 支柱一 元数据回填 9 只 + §4 `pickEnemy`/`matchEnemies` + §6 `check-enemy-refs` 四门入 regress（**31/31 全绿**）+ combat-runner 过滤。待续：入库契约脚手架（§7.4 `--new-enemy`）、支柱二 def/encounter 解耦（`enemyRef`·§8③ route A/B 待拍·需 caller）、§5 两条工作流的 SKILL。详见 CHANGELOG #121。原始设计 2026-06-13。
> 一句话：把"敌人"从**散在文件里、靠人肉眼挑**的状态，升级成**可查询、可复用、目录自动加载、可被一个独立 session 安全地"产"与"用"**的库。
> 关键认知：**原始的"库"已经存在**（`src/data/enemies/*.json` + `combat-runner --list-enemies`）。本设计的价值不在"建个文件夹"，而在补齐它缺的：**可查询 / 解耦 / 自动加载 / 可自动化入库**。
> **三条贯穿全文的原则**：① **数据驱动默认**——同机制、不同数值的敌人＝纯配置文件，**零引擎改动**；只有引入**新机制原语**时才碰引擎（§3 划清这条线）。② **可维护 / 可扩展优先**——元数据全做成可选、可增、不入存档的开放词表，今天 9 只够用，明天 90 只不重构。③ **可被独立 session 安全产出**（作者 2026-06-13 新增目标·见 §5）——一个无记忆的会话（交互一次性 或 定时无人值守）必须能**零口口相传**地把一只敌人完整、合规、绿测地加进库。这要求"怎么写一只敌人"本身是**机制**（模板 + 检查 + 绿门），不是散文。

---

## 0. 背景与现状（事实核对·2026-06-13 实读代码）

- **敌人存储**：`src/data/enemies/*.json`，现 7 文件 / 9 个 `EnemyDef`（盲鳗、洞穴章鱼、沉灯水母、梭鱼、石斑鱼、暗礁鲨(教学)、沉船蛛蟹 + 盲鳗幼体/梭鱼幼体）。
- **机制其实已经基本数据驱动**：`EnemyDef`（`src/types/enemies.ts`）的属性、`attacks[]`、`weakness`/`immunity`、`hostility`、`loot`、`victoryConditions` 全是数据字段。一只"换皮鲨鱼"本该是纯 JSON。
- **唯一逼你改引擎的是注册表**：`src/engine/combat.ts`（约 47–65 行）一个个 `import sharkData / eelData / …` 再循环灌进 registry——**就因为这个手动 import，连纯数据敌人都得动引擎**。这是 bug，支柱三专治。`combatScenario.ts` 同病。
- **无任何深度/区域/环境元数据**：grep 全部 enemy JSON，零 `band`/`zone`/`biome`/`role` 等。`aiPattern` 是枚举但引擎当前并未 switch 它（占位）。`loreEntry?: string` 存在但**全工程无人消费**（悬空·无图鉴系统）。
- **事件与敌人松耦合**：事件 JSON 不按 `enemyId` 引用敌人；战斗由 enemy 文件里的 `combatEncounters` 承载，再 `victoryEventId` 链回事件。`combatScenario.ts`（约 237 行）已有 **ad-hoc encounter** 能力——支柱二的现成地基。
- **`EnemyParty.joinRules.addFromPool: string[]`**：引擎已有"按 id 从池拉增援"的概念；band/biome 级池是其延伸。
- **生成现状**：周末内容引擎（`deep-echo-weekend-content`）每档可加 ≤2 只新敌人、内联写、靠 `--list-enemies` 肉眼去重。"合适"是 vibe 不是查询；"怎么写对"靠 SKILL 散文 + 人脑。

---

## 1. 要解决的四个缺口

1. **不可查询**：没有元数据，"取一只适合 abyssal 段、热带、威胁 ~6、捕食型的敌人"无法程序化表达。
2. **def / encounter 耦合**：遭遇捆在敌人文件里（≈1:1），一只敌人难以跨多事件/场景复用。
3. **硬编码注册表逼纯数据敌人改引擎**：违反"数据驱动默认"。
4. **没有"入库契约"**：当前"怎么写一只合格敌人"分散在 SKILL 散文 + 现有 JSON 里，新 session 要靠考古。要支持 §5 的两条自动化工作流，这必须收敛成**模板 + 检查 + 绿门**。

---

## 2. 设计：三支柱

### 支柱一 · 敌人元数据（让"合适"成为可过滤的查询）
给 `EnemyDef` 增**可选**字段（全部不入存档·见 §8），回填现有 9 只。两类——**结构化标签**（机器可过滤·驱动选取）与**背景文本**（人可读·喂图鉴）：

**结构化标签（驱动 `pickEnemy`）**
- `bands?: string[]` —— 适配的深度 band / random-zone id。深度轴。
- `biomes?: string[]` —— **环境/栖息地轴**（"红树林热带鱼不该出现在极地"）。开放词表：`reef_tropical` / `polar_under_ice` / `mangrove` / `hydrothermal_vent` / `cave_anchialine` …。与 `bands` 正交：同样 50m，热带礁的鱼和极地冰下的鱼是两套池子。
- `role?: EnemyRole` —— 战斗生态位：草案 `'predator'|'gatekeeper'|'sanity'|'swarm'|'ambusher'`（与 `aiPattern` 正交）。
- `threatTier?` —— 粗档威胁 `'low'|'mid'|'high'`，可由现有 `threat` 派生（§8）。

**背景文本（喂图鉴 + 辅助判断契合度）**
- 把悬空的 `loreEntry` 补成结构化背景（如 `codex?: { habitatDesc; behaviorDesc; appearance; firstSeenHint? }`）。一物两用：① 未来图鉴直接渲染；② 写新场景时判断"这只放进来违不违和"。**分工**：能机器过滤的（冷暖/深浅/区域）一律做成上面的**标签**，背景文本只承载氛围——别把"是否极地"埋进散文（选取程序读不到·违反原则①）。

> 三轴：**深度（bands）× 环境（biomes）× 生态位（role/threatTier）** 共同定义"合适"。

### 支柱二 · def / encounter 解耦（让敌人可复用）
让事件/内容**引用**一只敌人、动态合成遭遇。两条路线（§8 二选一）：
- **路线 A（推荐·一次到位）**：保留 `enemies[]`，把 `combatEncounters[]` 迁出到事件侧 / `combat_encounters/` 目录；事件用 `enemyRef:{enemyId}` 或 `enemyRef:{band,biome,role}`（"给我抽一只合适的"），经 `combatScenario.ts` ad-hoc 合成拉起。
- **路线 B（双轨兼容·改动最小）**：只新增 `enemyRef` 通道，老 encounter 照旧。

### 支柱三 · 目录自动加载（加敌人零引擎改动＝落实"数据驱动默认"）
用 `import.meta.glob('../data/enemies/*.json', { eager: true })` 或生成的 `enemies/index.ts`，取代 `combat.ts` 47–65 + `combatScenario.ts` 的手动 import。新增纯数据敌人＝丢 JSON、零引擎改动。对齐 quirk #14（NPC 目录扫描）。**注：这条是 §5 自动化的硬前置**——无人值守 session 绝不该改引擎来注册敌人。

---

## 3. 数据 vs 引擎的边界（"是不是每只敌人都要改引擎"——不是）

规则：**用现有机制原语拼 = 纯数据；引入引擎尚不认识的新原语 = 才改引擎。**

| 想做的敌人 | 归类 | 动引擎？ |
|---|---|---|
| 换数值（hp/伤害/护甲/闪避/威胁/掉落） | 纯数据 | **否**（支柱三后：丢 JSON） |
| 换攻击组合/权重/命中负伤（复用现有 `damageType`/`injuryId`） | 纯数据 | **否** |
| 复用已有 `weakness`/`immunity`/`hostility`/`victoryConditions` | 纯数据 | **否** |
| 标 `bands`/`biomes`/`role`、写 `codex` | 纯数据 | **否** |
| 弱变体（幼体）走亲代 JSON 内嵌 | 纯数据 | **否**（现状已如此） |
| 新增一种 `DamageType` / `Weakness` / `EnemyStatus.kind` / `VictoryPath` | 新原语 | **是** |
| 让 `aiPattern` 真正分化战斗行为（现为占位枚举） | 新原语 | **是**（一次投资·全库受益） |
| 某攻击效果现有字段表达不了（如"夺取玩家一件装备"） | 新原语 | **是** |

准绳：**新原语"加一次、全库可用"**，禁止给单只敌人写专属硬编码分支（技术债·评审该挡）。

---

## 4. "取合适敌人"的 API（最小签名）

纯函数，住 `src/engine/enemyLibrary.ts`：

```ts
pickEnemy(
  scene: { band?: string; biome?: string },
  opts?: { role?: EnemyRole; threatTier?: ThreatTier; excludeIds?: string[]; rng?: Rng }
): EnemyDef | undefined
```
过滤 `bands ∩ band` **且** `biomes ∩ biome`（缺省＝不约束·向后兼容），再按 role/threatTier 收窄，`excludeIds` 排除已用，`rng` 用 `makeLcg` 可种子化。用法：**数据期**（event JSON 写 `enemyRef`）或 **运行期**（mapgen/触发时现挑）。

---

## 5. 两条"敌人入库"自动化工作流（作者 2026-06-13 目标）

目标：让**一个独立、无记忆的 session** 能把敌人安全地加进库。两条流共享同一套地基，差别只在"敌人设定从哪来"。

### 工作流 A · 描述 → 实装（交互一次性）
作者用自然语言描述一只敌人（如"蓝洞深处、嗅觉型伏击者、中威胁、低频共振掉理智"），一个新 session 接手代码库，产出完整合规的敌人入库。映射步骤：
1. NL 描述 → 解析成 schema 字段（tier/hp/attacks〔含 sanityDamage〕/hostility/aiPattern/`bands`/`biomes`/`role`/`threatTier`/weakness/loot/victoryConditions/`codex`）。
2. **数值锚定**：不是凭空编——`pickEnemy`/`--list-enemies` 找同 band×biome 的近邻，贴着它们的量级给数。
3. **`combat-runner` 实跑出 baseline**（quirk #43「实跑抄」），不手写期望值。
4. **绿门**：跑 §6 的 checks + 相关 regress 子集，全绿才算完成。

### 工作流 B · 定时无人值守生成（作者将另立 schedule）
形态对标 `deep-echo-weekend-content`，但**敌人专向**。无设定输入——自己找**最薄的 band×biome×role 缺口**（gap 分析）补，其余同 A。无人值守 guardrails（比事件更严，因敌人涉数值平衡）：
- **只写数据文件，绝不碰引擎**（靠支柱三保证）；**只落 `auto/weekend` 分支、绝不 push/不碰 main**（quirk #104）。
- **单档 ≤1–2 只**；数值必锚邻居；**红就回退那只**，宁可空跑不留半成品（无人值守红线同内容引擎）。
- 收尾照旧：CHANGELOG/STATUS 计数 + `--list-enemies` 自查 + 沙箱提交套路。

### 两条流对设计提的硬要求（＝为什么"库先落地"）
| 要求 | 由谁满足 | 为什么是前置 |
|---|---|---|
| 加敌人零引擎改动 | 支柱三（目录自动加载） | 无人值守不能改 `combat.ts`，否则易碎/破 build |
| "合规"可机器判定 | §6 checks（引用完整 + 无孤儿 + 有 baseline + 有 codex） | 绿门＝唯一可信的"完成"信号；无检查＝不敢自动化 |
| "怎么写一只敌人"零口口相传 | **入库契约**：模板 JSON / JSON-Schema + `combat-runner --new-enemy` 脚手架 | 新 session 填空，不考古 |
| 数值不靠瞎编 | `pickEnemy` 近邻查询 + `combat-runner` 实跑 baseline | 平衡可锚、期望值真实 |

> **结论：A/B 都是库落地后的薄层。** 先实装支柱一/二/三 + §6 checks + 入库契约，A 就是"喂描述跑契约"，B 就是"加 gap 分析 + 无人值守壳"。两条流各自的 SKILL 提示词在库落地后再撰（B 的 schedule 由作者设立）。

---

## 6. 内容引擎改"先取后造"（消费侧·同步 schedule）

把 `deep-echo-weekend-content` 从默认新建敌人改成**先取后造**：
> 需要敌人时先 `combat-runner --list-enemies --band <band> --biome <biome>`；**有合适的就 `enemyRef` 复用**（认脸的是事件文本不是敌人本体）。**只有该深度×环境没有合适生态位的敌人时才新建**，照旧守满字段 + baseline + quirk #119 + 填 `biomes`/`codex`。配套 `combat-runner.ts` 加 `--band`/`--biome`/`--role` 过滤。

---

## 7. 实装清单（落地 session 照此·机制化是重点）

1. **类型 + 回填**：`types/enemies.ts` 加 `bands?`/`biomes?`/`role?`/`threatTier?`/`codex?`；回填现有 9 只。
2. **目录自动加载**（支柱三）：改 `combat.ts` + `combatScenario.ts` import 块为 glob/index。**§5 自动化的硬前置·优先做。**
3. **解耦**（支柱二）：选路线 A/B，落 `enemyRef` 解析 + `pickEnemy`（§4）。
4. **入库契约**（支撑 §5）：① 一份模板 / JSON-Schema（必填字段 + 取值约束·可被 check 校验）；② `combat-runner --new-enemy <id>` 脚手架，吐骨架 JSON + baseline 桩 + `--band/--biome/--role` 过滤。
5. **把约定变成会在 `npm run regress` 里失败的检查**（CLAUDE.md 铁律·也是 §5 绿门的依据）：
   - **(a) 引用完整性**：每个 `combatEncounter`/`enemyRef` 引用的 `enemyId` 必须已注册——新建 `scripts/check-enemy-refs.mjs` 挂进 `regress.mjs`。
   - **(b) 无孤儿**：每只敌人必带 ≥1 `bands` **且** ≥1 `biomes`（否则 `pickEnemy` 永选不中）。
   - **(c) 有 baseline**：扫 `scenarios/` 覆盖每个 enemyId（≥1 combat baseline）。
   - **(d) schema 合规**：必填字段齐 + 取值在词表内（喂工作流 B 的自动校验）。
6. **待编号 quirk（落地那个 session 再正式取号·勿提前占用）**：记「敌人库三支柱 + 入库契约 + 两条自动化工作流；目录自动加载取代手动 import；`check-enemy-refs` 守引用完整/无孤儿/有 baseline/schema 合规；数据 vs 引擎边界见 SPEC §3」。
7. **文档/SKILL 同步**：STATUS §3/§5 计数；本 SPEC 状态翻「已实装」；§6 改内容引擎 SKILL；撰写 §5 两条流的 SKILL（B 的 schedule 作者设立）。

---

## 8. 右尺寸 / 非目标（别过度工程·但别牺牲扩展性）

- **元数据 + 背景全是可选、additive、不入存档**（敌人是模板·quirk #99；纯加可选字段不 bump `SAVE_VERSION`）——为二章红树林 / 番外极地冰下 / 大深渊等未建区域**提前留好轴**，该做满。
- **不上重系统**：不要敌人编辑器 GUI、不要复杂权重 DSL、不要运行时动态难度曲线。元数据 + 纯函数 + 几条 check + 一个脚手架，是"机制"不是"框架"。
- **图鉴本体留后**：只备好 `codex` 数据，不实装图鉴 UI。
- **工作流 B 的质量门 = 自动化的安全带**：能自动化的前提是 §6 checks 够硬；checks 弱就别开 schedule。
- **不碰 mimic / corpse-wearer / d_reveal**（Phase 3 capstone）——不进通用库选池。
- 不动战斗机制本身——本设计只管"敌人怎么被组织、标注、取用、产出"。

---

## 9. 开放问题（留作者 / 落地 session 拍）

1. `threatTier` 从 `threat` 派生还是显式？（倾向派生 + 可覆盖）
2. 元数据放各 enemy JSON 内，还是单独 manifest？（倾向就近放 JSON）
3. 解耦走路线 A（一次到位）还是 B（双轨兼容）？
4. `biomes`/`role` 词表起始集合多大？（建议起手小、按内容增长·开放词表新值即用）
5. `codex` 拆几个字段，还是先一段富文本、图鉴落地时再结构化？
6. 工作流 B 的 gap 分析口径：按 band×biome×role 三维空缺补，还是先只补"某 band 完全无敌人"的硬缺口？（建议起手只补硬缺口，避免无人值守乱铺）
