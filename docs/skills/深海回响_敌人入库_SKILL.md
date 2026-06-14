---
name: deep-echo-enemy-author
description: 深海回响（~/Desktop/Blue）敌人入库——把一段自然语言敌人描述（模式 A）或自动找到的最薄缺口（模式 B）落成一只完整、合规、绿测的敌人加进敌人库。用户说「加一只敌人」「描述→实装敌人」「给某区补个敌人」或类似含义即用。
---

> **草稿（2026-06-14）**：这是「敌人入库」两条工作流的配方草案（设计见 `docs/spec/深海回响_敌人库_SPEC.md` §5）。要正式启用：① 模式 A 由作者经 Settings → Capabilities 安装为 skill；② 模式 B 由作者在 Cowork 立一个 schedule、把"模式 B"段作为任务 prompt。两模式共享同一套落地步骤，差别只在"敌人设定从哪来"。

深海回响敌人库的「入库」配方。**核心铁律：绿门＝唯一的"完成"判据**——`check-enemy-refs` 四门（registry 不过期 / 引用完整 / 无孤儿 / 有 baseline）+ 全量 regress 全绿，才算落地。

## 起手（两模式都做）
- 定位：`npm run handoff`（只读·git log/status + 当前分支）。
- recon：`npx tsx scripts/combat-runner.ts --list-enemies [--band <id>] [--biome <id>] [--role <r>]` 看现有库与近邻量级（避免撞 id / 锚定数值）。
- 读几个现有敌人 JSON（`src/data/enemies/*.json`）+ `docs/QUIRKS.md` 文风/红线，对齐语气与数值手感。

## 模式 A · 描述 → 实装（交互·有用户描述）
1. **解析描述 → schema 字段**：tier（realistic/uncanny/cosmic）、hp/armor/evasion/speed、threat、hostility、initialStance、aiPattern、attacks[]（含 damageType/damage/可选 sanityDamage/injuryOnHit）、weakness/immunity、loot、victoryConditions，以及库元数据 `bands`/`biomes`/`role`/`codex`。
2. **锚定数值**：用上面的 recon 找同 `band`×`biome` 近邻，贴着它们的量级给数——**别凭空编**。
3. **生成骨架**：`npx tsx scripts/combat-runner.ts --new-enemy <slug> --band <id> --biome <id> --role <r> > src/data/enemies/<slug>.json`。
4. **填掉所有 TODO**：名字/codex/attacks/数值；文风克制·冷·短句；守剧透红线（quirk #117·失联真相/断片说/灵界/造物主等一字不进文本）。
5. **注册**：`npm run gen:enemies`（把新 JSON 写进 registry.generated.ts·零引擎改动）。
6. **加 ≥1 combat baseline**（实跑抄·quirk #43）：`npx tsx scripts/combat-runner.ts combat.<slug>_solo --action <id> [--target 0] --seed 1 --out json > scenarios/combat/<slug>_solo__normal_kill.json`，再给该 JSON 补 `expect` 字段（断言 outcome/HP 等）。
7. **绿门**：`npm run regress`（迭代可 `--only typecheck,check-enemy-refs,verify-tutorial,combat`）。**绿才算完成**；红就修到绿或回退这只。
8. 收尾：`docs/archive/CHANGELOG.md` 追一条（敌人数 +1、灵感来源）；`docs/STATUS.md` §3 计数。

## 模式 B · 定时无人值守生成（schedule·无描述）
步骤同模式 A，但**设定来源＝自动找缺口**，且加无人值守护栏：
- **找缺口**：`--list-enemies` 按 band×biome×role 数实数；**起手只补"某 band/biome 完全无敌人"的硬缺口**（SPEC §8⑥·避免乱铺），别在已饱和处加。
- **无人值守铁律**（对标周末内容引擎 + quirk #104）：只在 `auto/weekend` 分支提交·**绝不 push、绝不碰 main**；单档 **≤1–2 只**；数值必锚邻居；**红就回退那只**，宁可空跑也不留半成品/红测试/可疑改动；全程别询问别等待。
- 收尾：同 A 的 CHANGELOG/STATUS + 沙箱提交套路（`git config gc.auto 0`·逐个显式 `git add`·提交后 mv `.git/*.lock` 进 `.git/.sandbox-junk/`·`git --no-optional-locks status` 核对）。

## 红线（两模式都守）
- **绿门是唯一完成判据**：`check-enemy-refs` 四门 + regress 全绿。registry 漏 regen / enemyRef 匹配不到 / 无 bands·biomes / 无 baseline 都会红。
- **新敌人＝纯数据·不碰引擎**。只有引入**新机制原语**（新 DamageType/VictoryPath/AiPattern 行为等）才动引擎，且要"加一次全库可用"（SPEC §3 边界表），禁止给单只敌人写专属硬编码分支。
- **剧透纪律 quirk #117** + 文风克制冷短句（动笔前读几个现有敌人/事件对齐）。
- 可复用优先：若某事件需要"一只合适的敌人"而非特定某只，用 encounter 的 `enemyRef:{band,biome,role}`（pickEnemy 运行期取一只·SPEC §4），而不是写死又造一只新的。
