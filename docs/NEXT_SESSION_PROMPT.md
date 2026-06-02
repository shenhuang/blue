下个 session 的 prompt — 开建 Phase 0a（微观双传感器 clarity + 不可信声呐）
直接把下面（含本行以下全部）粘进新 session 即可。

你在接手「深海回响」(Deep Echo) —— 潜水题材文字冒险 Roguelike（Vite + React + TS），仓库在 `~/Desktop/Blue`。

**当前主线**：深水区 vision 已 design 完毕、从北极星 pin 到可建系统，`docs/深海回响_深水区_SPEC.md` 是源真。**Phase 0–2 设计全锁，Phase 0 有逐项实装清单（SPEC §11）。本 session 起手 Phase 0a。**

设计要点（务必先读 SPEC 全文）：
- **感知**：双层 clarity（海图灯塔网 / 下潜双传感器）。声呐独立、远、费电、**返回不可信**（生物躲/喂假回波 + 低 san 幻觉）；灯近、地面真相、暴露高，**但低 san 也产幻觉**——无完全可信传感器。
- **纵深**：米、不封顶、蛙跳（一潜一 band、从最深前哨起）。
- **前哨/能源**：水上不衰减 / 水下衰减（激流更快但可水力发电）；能源跑设施定同时在线数；补给设施越深越自建；衰减＝变暗+进度回退+材料丢失。
- **理智=双向门**：守它看清真实世界；主动压低它进「另一个世界」（亦真亦假、永不裁决）。

先 onboarding（按顺序）

1. **读 `docs/深海回响_深水区_SPEC.md` 全文**，重点 §3 架构 / §4 现有代码接点 / **§11 Phase 0 实装清单（0a/0b）** / §8 tunables / §9 守则。
2. 读自动记忆 [[deep-game-vision]]（北极星，已按全部拍板更新）。
3. 读 `docs/STATUS.md` §3 系统 + §6 quirks。**Phase 0 最相关**：#27/#41（`visibility:dark` 盲航＝clarity 地基）、#36（尸体提示门控）、#38（UI 必须和引擎共用索引 + 补 smoke）、#39（存档迁移）、#21（`sanityRange` 低段门控＝「另一个世界」/低 san 假象的机制地基）、#29（smoke SSR 套路）。
4. 跑 `npm run typecheck` + 全部回归确认起点干净（§9）。

基线：内容层五轮 pass + 深水区 SPEC 全部已提交（git log 最新几条；当前内容 81 事件 / 7 敌人 / 75+9 baseline）。SPEC design 阶段零代码改动——**Phase 0a 是深水区第一笔代码。**

## 本 session：Phase 0a（SPEC §11，纯感知、不碰 combat、可独立全绿）

照 §11 的 0a 勾选项顺序做：

1. run 加 `sensors: {light, sonar}` + `power`（电池）状态 + 派生 `signature`。
2. 新 `engine/clarity.ts`：`clarity(run, node)`（预览档 full/sonar/none）+ `sonarReturn(run, node)`（不可信表象，可被 evade/spoof/低 san 改写）。
3. `dive.ts::enterNodeSelection` 预览改读 clarity；ping 耗电+落远端表象、灯耗电、摸黑盲、power 归零强制摸黑。
4. 低 san 注入假回波 / 更低阈值灯也幻觉（接 §3.2/§3.7、复用 `sanityRange` 机制 quirk #21）。
5. SAVE_VERSION bump + migrate（旧档默认 sensors/power）+ `playthrough-save` 加一步。
6. `NodeSelectView` 按 clarity 渲染 + 电量 + 传感器开关；`StatusBar` 加电量；**补 `smoke-chart-ui.tsx` SSR 断言**。
7. 新 `playthrough-sensors.ts` 回归。**全绿 + prod build。**

- **0b（探测/隐身，碰 combat）留下一个 session**（依赖 0a 的 signature）。
- 建之前若对 §11 某步的取舍拿不准（power 每回合具体消耗 / 低 san 阈值 / sonarReturn 表象粒度 / clarity 是否完全取代 visibility），**先用 AskUserQuestion 跟作者敲**——别拍脑袋定平衡数值。

## 备选（若不想碰引擎大改）
低强度内容打磨：深段欺骗 register 其它感官变体（会合拢的出口 / 错误方向回来的气泡 / 假 rest 节点，§3.5/[[deep-game-vision]]）。守深段只 cave/wreck 两 tag（#57）、cosmic/loot-free/叙述永不交底/不触发 d_reveal、**别加敌人、别堆 realistic（#56 已饱和）**。

## Phase 3 留着
mimic 逐拍演出 + 「另一个世界」那边有什么＝**与作者一起一个个敲定的专门 session**（作者定），必须 0–2 建完后做；别预先写死、**别擅自触发 d_reveal**（#42，存档级不可逆）。

## 关键约束（§9 完整版）

* **回归文化（#22/#26）**：每步全绿——`npm run typecheck` + 全部 playthrough（含新 `-sensors`）+ `-scenarios` + `-combat-scenarios` + `-mapgen-scenarios` + `verify-tutorial` + `smoke-chart-ui.tsx` + prod build（`npx vite build --outDir $(mktemp -d) --emptyOutDir`）。`playthrough.ts` ~12% flake（#18）重试。
* **存档（#39）**：Phase 0a 加 run `sensors`/`power` → 必 bump `SAVE_VERSION` + `migrateSave` 加步 + `playthrough-save` 回归。
* **UI smoke（#38/#41）**：NodeSelectView/StatusBar 改了数据路径必补 `smoke-chart-ui.tsx` SSR 断言（承 quirk #38「只测引擎」盲区）。
* **叙述永不交底（#54）**：低 san 假回波/幻觉的文案也不交底——既给平淡解释又留错读。
* **沙箱 git（[[sandbox-git-commit]]）**：`git add src scenarios docs`（别 `-A`，根 `CLAUDE.md` 一直 untracked、别提交）；残留锁 `find .git/objects -name 'tmp_obj_*'` + HEAD.lock `mv` 进 `.git/.sandbox-junk/`；`gc.auto 0`；核对只用 `git --no-optional-locks status/log`。

## 收尾
更新 `docs/STATUS.md`（滚动 + §3 + §6 新 quirk）、`SPEC §11`（勾掉已做项）+ `§10 决策日志`、自动记忆（[[deep-game-vision]] 若动机制 + [[weekend-content-log]] 若动内容 + MEMORY.md 索引）、把本文件改写成再下一个 session 的 prompt，按 [[sandbox-git-commit]] 提交。
