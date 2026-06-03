下个 session 的 prompt — 开建 Phase 0b（探测 / 隐身，碰 combat，消费 0a 的 signature）
直接把下面（含本行以下全部）粘进新 session 即可。

你在接手「深海回响」(Deep Echo) —— 潜水题材文字冒险 Roguelike（Vite + React + TS），仓库在 `~/Desktop/Blue`。

**当前主线**：深水区 vision 正在分阶段实装，`docs/深海回响_深水区_SPEC.md` 是源真。**Phase 0a（微观双传感器 clarity + 不可信声呐 + 电池 + 低 san 腐蚀）已实装并全绿提交**（STATUS quirk #58 / SPEC §11 0a 已勾 / §10 决策日志 2026-06-03）。**本 session 起手 Phase 0b（探测/隐身），消费 0a 派生的 `signature(run)`。**

Phase 0a 已就位的地基（0b 直接用）：
- `engine/clarity.ts`：`signature(run)`（灯亮高 +6 / 声呐 ping 中 +3 / 摸黑低，base 1）已派生好——**0b 就是把它接进遭遇/combat**。还有 `clarity(run)` 预览档 / `sonarReturn` 不可信表象 / `lampPowerDrain`，tunables 集中文件顶（§8）。
- run 状态 `sensors{light,sonar,sonarUnlocked}` + `power`/`powerMax`；`dive.ts::setLight`/`pingSonar`/`moveToNode`（移动后 ping 消散）。
- 声呐后期解锁（`upgrade.sonar.lv1` 深料账单）；早期仅有灯、黑水天然受限。

先 onboarding（按顺序）

1. **读 `docs/深海回响_深水区_SPEC.md`**，重点 §3.3 探测/被探测模型 / **§11 0b 清单** / §4 接点（`combat.ts` + 遭遇触发）/ §8 tunables / §9 守则。
2. 读自动记忆 [[deep-game-vision]]（北极星 + Phase 0a 已建状态）。
3. 读 `docs/STATUS.md` **quirk #58（Phase 0a 全貌，0b 的直接前置）** + 战斗系统：§3「战斗回归框架」+ quirk #45（加敌人五件套）/#46/#48（敌人原型）/#5（territorial 撤退）。看 `engine/combat.ts` + 遭遇是怎么触发的（目前事件里 `draw_knife`→`startCombat`；有没有"节点级随机遭遇"还需确认）。
4. 跑全绿确认起点干净（§9，含新 `playthrough-sensors`）。

## 本 session：Phase 0b（SPEC §11 0b，碰 combat，依赖 0a 的 signature）

照 §11 0b 勾选项：
1. `signature(run)` 接进遭遇/combat：高 signature → 捕食者接近/伏击/提高遭遇概率；摸黑（低 signature）→ 可滑过（可生存、代价是瞎）。
2. （可选）节点级「警觉」度：主动感知（灯/ping）抬、静默降；高警觉→接近/ambush。
3. `combat.ts` / 遭遇触发 / `moveToNode` 读 signature。
4. 回归：新 stealth 场景（点灯/ping 抬警觉→接近；摸黑→滑过）；`playthrough-combat` / `combat-scenarios` 视情况加。**全绿 + prod build。**
5. 平衡：signature 权重、警觉阈值、ambush 触发（§8 tunables）。**注意 §7.5：浅水不该引入探测压力——signature 的后果应按深度/band 缩放，别污染现有浅水/教学手感**（0a 已让浅水 signature 无害，0b 要保持）。

- 建之前若对取舍拿不准（signature→遭遇的具体映射 / 警觉是否做成节点状态 / ambush 触发线 / 浅水是否完全豁免探测），**先用 AskUserQuestion 跟作者敲**——别拍脑袋定平衡数值。

## 备选（若不想碰 combat 大改）
- **0a 升级轨续做**：灯/声呐 效果·耗能 + 电量（powerMax）做 `upgrades.json`/灯塔设施轨（SPEC §11「升级」项，声呐解锁轨已做、效果档位待做）。
- **低强度内容打磨**：深段欺骗 register 其它感官变体（会合拢的出口 / 错误方向回来的气泡 / 假 rest 节点，§3.5/[[deep-game-vision]]）。守深段只 cave/wreck 两 tag（#57）、cosmic/loot-free/叙述永不交底/不触发 d_reveal、**别加敌人、别堆 realistic（#56 已饱和）**。

## Phase 1 / 2 / 3 留着
- **Phase 1 深度轴**（banded、蛙跳下潜）、**Phase 2 跨 run 供给前哨 + 能源**：见 SPEC §5 / §3.6。
- **Phase 3 mimic capstone + 「另一个世界」**＝与作者一起一个个敲定的专门 session，必须 0–2 建完后做；别预先写死、**别擅自触发 `flag.d_reveal`**（#42，存档级不可逆）。`node.spoofsSonar`/`evadesSonar` 字段已留好（0a 加的钩子），Phase 3 填。

## 关键约束（§9 完整版）
* **回归文化（#22/#26）**：每步全绿——`npm run typecheck` + 全部 playthrough（**含 `-sensors`**）+ `-scenarios` + `-combat-scenarios` + `-mapgen-scenarios` + `verify-tutorial` + `smoke-chart-ui.tsx` + prod build（`npx vite build --outDir $(mktemp -d) --emptyOutDir`）。`playthrough.ts` ~12% flake（#18）重试。
* **存档**：**未发布暂不做迁移**（作者 2026-06-03）——0b 动 run/profile 形状也无需 bump `SAVE_VERSION`(现 4) / 加 `migrateSave` 步；新字段靠 `createNewRun` 种默认 + 反序列化处 `?? 默认` 兜底即可；`playthrough-save` 仍校验序列化 round-trip。发布前再按 #39 统一补迁移（流程留备用）。
* **UI smoke（#38/#41）**：改了 UI 数据路径必补 `smoke-chart-ui.tsx` SSR 断言。
* **加敌人五件套（#45）**：若 0b 真要加遭遇敌人——但**各 zone 已 2 敌、守『敌人别太多』**，mimic/corpse-wearer 是 Phase 3 apex 例外，0b 别加常规第三只。
* **叙述永不交底（#54）**：低 san 假回波/幻觉文案不交底。
* **沙箱 git（[[sandbox-git-commit]]）**：`git add src scenarios docs scripts`（别 `-A`，根 `CLAUDE.md` 一直 untracked、别提交）；残留锁 `find .git/objects -name 'tmp_obj_*'` + HEAD.lock `mv` 进 `.git/.sandbox-junk/`；`gc.auto 0`；核对只用 `git --no-optional-locks status/log`。

## 收尾
更新 `docs/STATUS.md`（滚动 + §3 + §6 新 quirk）、`SPEC §11`（勾掉 0b 已做项）+ `§10 决策日志`、自动记忆（[[deep-game-vision]] 若动机制 + [[weekend-content-log]] 若动内容 + MEMORY.md 索引）、把本文件改写成再下一个 session 的 prompt，按 [[sandbox-git-commit]] 提交。
