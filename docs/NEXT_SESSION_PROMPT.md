下个 session 的 prompt — Phase 0（感知 0a + 探测 0b）已完成，下一步 Phase 1 深度轴 / 或 Phase 0 升级轨 / 或内容打磨
直接把下面（含本行以下全部）粘进新 session 即可。

你在接手「深海回响」(Deep Echo) —— 潜水题材文字冒险 Roguelike（Vite + React + TS），仓库在 `~/Desktop/Blue`。

**当前主线**：深水区 vision 分阶段实装，`docs/深海回响_深水区_SPEC.md` 是源真。**Phase 0 已全部完成并提交**：0a（微观双传感器 clarity + 不可信声呐 + 电池 + 低 san 腐蚀，STATUS quirk #58）+ 0b（探测/隐身：警觉积累→接近/伏击，quirk #59）。SPEC §11 0a/0b 均已勾、§10 决策日志记了拍板。

Phase 0 已就位的地基（后续直接用）：
- `engine/clarity.ts`：感知（`clarity(run)` 三态 / `sonarReturn` / `lampPreview` / `signature`）+ 探测（`alertDelta` / `alertDepthFactor` / `predatorApproaches`）+ 全部 tunables（文件顶）。
- run 状态 `sensors{light,sonar,sonarUnlocked}` + `power`/`powerMax` + `alert`；`dive.ts` 的 `setLight`/`pingSonar`/`moveToNode`（含接近遭遇触发 `maybeApproachEncounter`）。
- `ZoneDef.ambushEncounters`（三深水 zone 配了潜伏敌池）；声呐解锁轨 `upgrade.sonar.lv1`（深料）。
- `node.evadesSonar?`/`spoofsSonar?` 钩子已留（默认 unset，Phase 3 mimic 填）。

先 onboarding（按顺序）
1. **读 `docs/深海回响_深水区_SPEC.md`**，重点 §3.4（可扩展深度轴）/ §5（Phase 1/2/3）/ §6 数据草案 / §3.6（前哨/能源，Phase 2）/ §8 tunables / §9 守则。
2. 读自动记忆 [[deep-game-vision]]（北极星 + Phase 0 已建状态）。
3. 读 `docs/STATUS.md` **quirk #58/#59（Phase 0 全貌）** + Phase 1 最相关：#30（`mapShape`/`depthOffset` 分流）、#49（depthOffset 平移每层深度）、`zoneTagsByDepth`（zones.json 按深度分 tag 段）、quirk #52（Phase C reach/reveal——蛙跳复用）、#34（迷路 corpse pass）。
4. 跑全绿确认起点干净（§9，含新 `playthrough-sensors` + `playthrough-stealth`）。

## 本 session：从下面三选一（Phase 0 已完成，作者定方向）

**A（推荐）· Phase 1 深度轴（banded、不封顶、蛙跳）** —— 「很大的图」的脊柱。SPEC §5 Phase 1：深度 band 数据化（zones.json / 新 band 表，§6 草案 `data/depth_bands.json`），去掉 60m 准硬上限，支持逐级解锁的更深 band；沿用 `depthOffset` + `zoneTagsByDepth`。**注意：Phase 1 没有 §11 那样的逐项清单（不像 Phase 0）——开建前先用 AskUserQuestion 跟作者 pin Phase 1 范围**（band 表结构 / 解锁门怎么定 / 蛙跳下潜 `startDiveFromOutpost` 是否本期做〔它依赖 Phase 2 的前哨存在，可能要和 Phase 2 一起或先做"可配置更深 band"打通、内容后填〕/ 深 band 里 clarity·alert 的成本曲线如何随深度加重）。**别拍脑袋定 band 边界/解锁门数值。**

**B · Phase 0 升级轨（小、已规格化）** —— SPEC §11「升级」项：声呐二元解锁已做，**灯/声呐 效果·分辨·抗欺骗 + 电池容量（powerMax）** 做成 `upgrades.json`/灯塔设施升级轨（材料经济双资源），`getUpgradeBonuses` 聚合进 run sensors 派生。让 0a/0b 造的传感器随材料经济成长。不碰 combat、改动可控。

**C · 内容打磨（低强度、零引擎风险）** —— 深段欺骗其它感官变体（会合拢的出口 / 错方向回来的气泡 / 假 rest 节点，§3.5/[[deep-game-vision]]）。守深段只 cave/wreck 两 tag（#57）、cosmic/loot-free/叙述永不交底/不触发 d_reveal、**别加敌人、别堆 realistic（#56 已饱和）**。

## Phase 2 / 3 留着
- **Phase 2 跨 run 供给前哨 + 能源**（SPEC §3.6/§5）：把 `lighthouse.ruin_north` 一次性修复扩成多阶段跨 run 持久前哨 + 蛙跳出潜点 + 能源经济。
- **Phase 3 mimic capstone + 「另一个世界」**＝与作者一起一个个敲定的专门 session，必须 0–2 完成后做；**别擅自触发 `flag.d_reveal`**（#42）。`spoofsSonar`/`evadesSonar` 钩子已就位待填。

## 关键约束（§9 完整版）
* **回归文化（#22/#26）**：每步全绿——`npm run typecheck` + 全部 playthrough（**含 `-sensors` + `-stealth`**）+ `-scenarios` + `-combat-scenarios` + `-mapgen-scenarios` + `verify-tutorial` + `smoke-chart-ui.tsx` + prod build（`npx vite build --outDir $(mktemp -d) --emptyOutDir`）。`playthrough.ts` ~12% flake（#18）重试。
* **存档**：**未发布暂不做迁移**（作者 2026-06-03）——动 run/profile 形状也无需 bump `SAVE_VERSION`(现 4)；新字段靠 `createNewRun` 种默认 + 反序列化 `?? 默认` 兜底；`playthrough-save` 校验序列化 round-trip。发布前再按 #39 统一补。
* **UI smoke（#38/#41）**：改了 UI 数据路径必补 `smoke-chart-ui.tsx` SSR 断言。
* **敌人别太多**：各 zone 已 2 敌，mimic/corpse-wearer 是 Phase 3 apex 例外；别加常规第三只。
* **叙述永不交底（#54）** / **别擅自触发 d_reveal（#42）**。
* **沙箱 git（[[sandbox-git-commit]]）**：`git add src scenarios docs scripts`（别 `-A`，根 `CLAUDE.md` 一直 untracked、别提交）；残留锁 `find .git/objects -name 'tmp_obj_*'` + HEAD.lock `mv` 进 `.git/.sandbox-junk/`；`gc.auto 0`；核对只用 `git --no-optional-locks status/log`。

## 收尾
更新 `docs/STATUS.md`（滚动 + §3 + §6 新 quirk）、`SPEC §11`（若续 Phase 0）/ 或新增 Phase 1 清单 + `§10 决策日志`、自动记忆（[[deep-game-vision]] 若动机制 + [[weekend-content-log]] 若动内容 + MEMORY.md 索引）、把本文件改写成再下一个 session 的 prompt，按 [[sandbox-git-commit]] 提交。
