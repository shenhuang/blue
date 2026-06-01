# 下个 session 的 prompt — 真"迷路"洞穴 mapgen 重写

> 直接把下面这段（含本行以下全部）粘进新 session 即可。

---

你在接手「深海回响」(Deep Echo) —— 一个潜水题材的文字冒险 Roguelike（Vite + React + TS）。

**先 onboarding**：按 `docs/STATUS.md` §8 走一遍——读 §3（系统/文件）、§5（路线图）、§6（quirks，最权威），再跑 `npx tsx scripts/playthrough.ts` 看一次完整 trace。注意自动记忆里的 **[Scenario Framework]** 和 **[Sea Chart]** 两条。每次改动按项目要求兼顾**可扩展性与可维护性**，并保证下个 session 能接上。

## 上个 session 刚做完（别重做）
港口海图（POI 选点）系统 + 三种 POI 修正全部实装（`depthOffset` / `distance` / `current` / `visibility`）。详见 STATUS §5「港口海图选点 UI」+ quirk #27/#28。

## 这个 session 的目标
重写**洞穴风格**的节点图生成，做出真正的"迷路"感：**绕一圈回到原点、死路（dead-end）、多个"最深点"**。

当前 `src/engine/mapgen.ts::generateDiveMap` 是**层状 DAG**（每层 2–3 节点、深度单调递增、只连下一层），洞潜的迷路目前只在事件文本 + `bluecaves.forked_passage` 的 sanity 惩罚里"模拟"。见 STATUS §5「真'迷路' mapgen」。

## 关键约束（别破坏现有的）
1. **开阔水域（`canFreeAscend` ≠ false）继续走层状 DAG**——旧灯塔礁 / 沉船墓园等现有 zone 行为不能变。迷路生成只用于洞穴 zone（`canFreeAscend:false`，目前是蓝洞群）。建议按开关分流两套生成器，或给 `ZoneDef` 加 `mapShape: 'layered' | 'maze'` 字段显式选择。
2. 保持 `canFreeAscend:false` 语义：洞里只能在 `ascent_point` 或 emergency 上浮（`ascent.ts::isAscentBlocked`）。迷路图里 `ascent_point`（洞另一头的出口）放哪、保证可达，要想清楚。
3. 海图深度偏移注入（`generateDiveMap` 的 `opts.depthOffset`）对新生成器也要生效。

## 集成点 / 容易踩的坑（动手前先看）
- `mapgen.ts::getNextChoices` 只返回 `connectsTo`；迷路需要**回边/双向边**，且玩家**会重访**节点——`run.visitedNodeIds` 现在只 append 不去重、preview 没有"已来过"标记，考虑加。
- `dive.ts::enterNodeSelection`：**没有下一节点 = 自动上浮**。迷路里"死路"和"绕回"会让这个判定失真，要重新设计"何时算走到头 / 死路怎么回头"。
- `dive.ts::moveToNode`：过渡回合按 `abs(depthΔ)/5` 算，所以**往回游也会耗资源**（迷路自带代价，好事）；`current` 移动消耗（`currentMoveCost`）和 `visibility` 盲航遮蔽预览（NodeSelectView 读 `run.diveModifier.visibility==='dark'`）都已接在这条链路上，新图要兼容。
- `mapgen.ts` 的 **corpse pass** 假设层状（`layerNodes.slice(1,-1)`）——迷路图要换一套尸体植入策略。
- `DiveNode.layer` 字段在迷路里语义变弱，想清楚保留/改语义/弃用。

## 验收（项目回归文化，见 quirk #22/#26）
- `npm run typecheck` 干净。
- **全部** playthrough + `scripts/smoke-chart-ui.tsx` + `scripts/verify-tutorial.mjs` 仍绿（`playthrough.ts` 有既有 ~12% RNG flake，见 quirk #18，挂了重试确认，不是你引入的）。
- 按 quirk #26 的"子目录 + 独立 playthrough"约定加迷路回归：`scenarios/mapgen/` + `scripts/playthrough-mapgen-scenarios.ts`，**种子化生成**后断言结构性质：全节点从起点**可达**、存在**环/回边**、存在**死路**、**多个最深点**、`ascent_point` 可达、连通性不漏。
- 建议照 memory §未来 + quirk #23/#24 的 dev 面板套路加一个**地图调试器 dev 面板**（如 Shift+M，`lazy` + `import.meta.env.DEV` 守卫 + co-located css，本地 useState 不进 GameState），可视化迭代迷路布局，别靠反复编译跑 playthrough。
- 沙箱里 `npm run build` 第二次会因删不掉旧 `dist/` 报 EPERM（quirk #1）；验证 prod build 用 `npx vite build --outDir /tmp/blue-dist --emptyOutDir`。

## 收尾
更新 `docs/STATUS.md`（§5 打勾 + §3/§6 + 新 quirk）和自动记忆（新增/更新 memory + `MEMORY.md` 索引行），让再下一个 session 能接上。
