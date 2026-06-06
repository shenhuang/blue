# 深海回响 · 已知 quirk 与约定

> 从 STATUS.md §6 迁出。编号保持不变——其它文档与代码注释引用 "quirk #N"。

## 生效中（active）

3. **`performCheck` 用概率窗口模型**，不是 D&D 风格的 d20+bonus。事件 JSON 里的 `dc` 直接是 stat 比较值，不是 D&D dc。

4. **mapgen 的 event 概率是 80%**（从 70% 调上来过一次），rest 10%，ascent_point 10%。

6. **diveAge 在两个地方递增**：`executeDeath`（给旧死者）+ `executeAscent`（每次成功上浮也老化海底）。不要再加第三处，否则双计数。

7. **NPC 对话的 startDive effect** 现在通过 `startDive(state, zoneId)` 拉起，会自动决定线性还是随机图。

8. **升级派生加成的聚合规则**：`preservationBonus` 取最大值（与 `engine/death.ts::getPreservationBonus` 一致），其它数值类（oxygenMaxBonus 等）取累加。Boolean 类（sweep immune / corpse hint 等）取 OR。改 schema 时记得对齐 `engine/upgrades.ts::getUpgradeBonuses`。

9. **`hasUpgrade` Condition** 在 dialog 和事件里都可用，运行时查 `profile.unlockedUpgrades`，是当前推荐的"按建设进度门控分支"的方式（不要再用 flag 间接绕）。

10. **applyOutcome 现在区分 run/无 run**：dive 期间 `applyFlags` 进 `run.activeFlags`（run 结束随之丢弃），portEvent / 其它无 run 场景进 `profile.flags`（永久）。`goldDelta` 同理走 bankedGold。`deltas` / `loot` 在无 run 时无意义会被忽略。**写 portEvent 数据时不要写 deltas / loot**。

11. **回港 cutscene 是一次性的**：靠 `flag.event_done.<eventId>` 做 oncePerSave。玩家携带多个 story-item 时只会触发查到的第一个；后续 cutscene 要支持队列时再扩 `portEvents.ts`。

12. **回港时 inventory 已合并进 `profile.inventory`**：`engine/port.ts::handleReturnToPort` 把 `run.inventory` 全量 `mergeIntoInventory` 进 `profile.inventory` 再 null run。eternal / 剧情物天然长存；材料留在仓库等玩家走 Mira 柜台卖掉；`med_kit`（sellPrice=0）这类也在仓库留用。**App.tsx 和 playthrough.ts 都走 `handleReturnToPort`，不要再自己写 `state.run = null` 的复刻代码。**

13. **`computeLootValue` 不再是 0**：现在按 Mira 收购价（`miraOfferFor` = floor(sellPrice × 0.8)）求和。但它只填 `RunOutcome.lootValue`，**不会**自动入账到 `bankedGold`——`goldEarned` 仅反映 `run.gold`。要真把战利品变成金子必须经过 `sellItemToMira`。

14. **NPC 数据按 NPC 拆文件**：`src/data/npcs/aldo.json` / `mira.json`，加 NPC 时新增一个文件并在 `engine/dialog.ts::NPC_FILES` 注册一行 import（与 `engine/zones.ts` 的事件 JSON 注册风格一致）。`verify-tutorial.mjs` 已经按目录扫描，加新 NPC 不用动它。

15. **`GamePhase` 多了 `'shop'`**：目前只有 Mira 一家（shopId = `mira.bench`）。`MiraShopView` 自己负责 phase → port 的退出，关店不会自动播 cutscene（cutscene 已经在 `handleReturnToPort` 阶段播完了）。

16. **`ZoneDef.canFreeAscend`** 是新引入的封闭水域开关，默认 true。设 false 时（蓝洞群）：mapgen 中间层不放 ascent_point；AscentView 在非末层节点上把 normal/rushed 锁掉、emergency 仍可用。**emergency 在洞里也没有特别加严重**（不动平衡数值）——它本来就是"必得严重减压病、深处会死"，叙事重描述成"凿穿洞顶"已经够痛。

17. **`cave` zoneTag 的事件是跨 zone 共享的**：`reef.json::cave.*` 和 `blue_caves.json::*`（都 tag cave）都会在两个 zone 的深层池里出现。这是为了让旧灯塔礁的 cave 层也"沾光"到新内容；后续如果要差异化，应该用 `zoneTagsByDepth` 引入更细的 tag（比如 `blue_cave` 专属）。

18. **`scripts/playthrough.ts` 有 ~12% RNG flake**（独立 bug）：tutorial.wreck 的 `stealth_grab` 是 oxygen vs 30 的 check，正常路径下 87% 成功；失败的 12% 会触发战斗，脚本走到末尾的 "应在上浮" 断言时炸掉。和蓝洞群无关，单独修脚本时一并处理（建议：用 seeded RNG 或 monkey-patch Math.random）。

19. **zoneTag 跨 zone 污染陷阱**：buildEventPool 用 zoneTag 集合做交集匹配。如果一个 zone 的 zoneTagsByDepth 同时挂了 "shallow"，那 reef.json 里 zoneTags=["shallow","reef"] 的事件就会被抽到——即使该 zone 没有 "reef" 语义。**蓝洞群入口段最初配 ["cave","shallow"] 就吃了这个亏**（reef.kelp_curtain 跨界变成最高频事件），后改成只 ["cave"] 才干净。新 zone 设计时谨慎：只挂真正语义匹配的 tag，宁缺勿滥。

21. **`bluecaves.silent_chamber` 的 sanityRange [0, 85] 几乎永远触发不到**：起步 sanity=100，蓝洞群里没有事件能在到达深段（45m+）前把 sanity 压到 ≤85。这是有意设计——"这个厅只在已经被压垮的潜水员眼里出现"——但短期内基本是死内容。等以后有"sanity 慢压"机制（深度自然衰减 / D-reveal 期间渐损）才会被解锁。

22. **`runEventScenario` patch 全局 Math.random**：`withSeededRandom(seed, fn)` 在 fn 期间把 `Math.random` 换成 LCG，fn 跑完 finally 块恢复。因此**不要在它运行时并发跑别的引擎代码**（多个 scenario 串行 OK，跨进程并行 OK，同进程异步并发不 OK）。也因此 `result.steps[i].checkResult.roll` 总是 `-1` sentinel——`performCheck` 用掉的那次 random 拿不回来，只能从 narrative 反推 passed。如果以后需要拿到 roll 数值，方案是在 `performCheck` 里增加可选回调，而不是改这套 patch。

23. **dev 面板状态不进 `GameState`**：`src/App.tsx` 用本地 `useState<boolean>` 管 `devPanelOpen`（Shift+D 切换），**没有**新建 `GamePhase = 'devPanel'`。原因：dev 面板不参与玩家流程，进存档的版本号会让"打开过 dev 面板"和"正常存档"产生迁移负担。如果以后还要加更多 dev 工具（战斗面板、地图调试器），统一在 App.tsx 顶层用本地 state 管开关，不污染 GameState 联合类型。

24. **Vite tree-shake `src/ui/dev/`**：App.tsx 顶部用 `const EventDevPanel = import.meta.env.DEV ? lazy(...) : null;` 模式。prod build 时 DEV 替换为字面 `false`，Rollup 把 `false ? lazy(() => import('@/ui/dev/EventDevPanel')) : null` 折成 `null`，对应 dynamic import 是 dead code，整个 `src/ui/dev/`（含 ScenarioSerializer / EventDevPanel / CombatDevPanel / CombatScenarioSerializer / dev-panel.css / combat-panel.css）都不会被打包。验证方式：`npx vite build --outDir /tmp/blue-dist` 后 `grep "EventDevPanel\|CombatDevPanel\|combatScenario\|combat-panel\|runCombatScenario\|dev-panel" /tmp/blue-dist/assets/*` 应空白。如果将来要加新的 dev-only 模块，遵循同样的 `lazy + DEV 守卫 + co-located CSS import` 模式。

25. **战斗 scenario 与事件 scenario 的 localStorage key 隔离（不对称）**：事件面板用 `dev.scenarios.<eventId 下划线>__<variant>`，战斗面板用 `dev.scenarios.combat.<combatId 下划线>__<variant>`——加 `.combat.` 中缀。**战斗侧用 startsWith `dev.scenarios.combat.` 严格匹配，干净**。**事件侧用 startsWith `dev.scenarios.` 会顺带抓到战斗 key**，但 `parseScenarioJson` 要求顶层有 `eventId` 字段（战斗 JSON 是 `combatId`）会抛错，被 listSavedScenarios 的 try/catch 静默吞掉——所以事件面板的"已存 LS"列表里不会出现战斗条目。新加第三类 scenario（mapgen / dialog 等）务必继续 `dev.scenarios.<type>.<id 下划线>__<variant>` 模式，并且让该类 serializer 的 LS_PREFIX 包含完整 `dev.scenarios.<type>.` 段，让兄弟类型的 startsWith 互不污染。附注：事件 / 战斗的 saved-list 显示用的 id（`<eventId>` / `<combatId>`）会把 key 里的下划线全部 `replace(/_/g, '.')` 反推回 dot——所以 `bluecaves.silent_chamber` 会显示成 `bluecaves.silent.chamber`，**仅显示有损，载入的 JSON 内容是 verbatim**。

26. **scenarios 子目录约定（事件 vs 战斗）**：`playthrough-scenarios.ts` 只扫 `scenarios/*.json` **根目录**（`readdirSync(SCENARIO_DIR).filter(f => f.endsWith('.json'))`，不递归），战斗 scenario 在 `scenarios/combat/` 下由 `playthrough-combat-scenarios.ts` 单独扫，互不干扰。**新增第三类 scenario（例如 mapgen / dialog 回归）请遵循同样的"子目录 + 独立 playthrough 脚本"约定**：JSON 放 `scenarios/<type>/`，配一个 `scripts/playthrough-<type>-scenarios.ts`，避免不同 scenario schema 撞在同一份脚本里。

27. **海图（POI 选点）派生自 profile，不入存档**：`engine/chart.ts::generateChart(profile)` 是纯函数——anchor 来自 `chart_pois.json` 固定，roaming 用 `runsCompleted` 做 LCG 种子（与 `withSeededRandom` 同算法但走入参，不 patch 全局）。**所以"每次回港换一批机会点"是 `runsCompleted` 自增的副产物，没有把 SeaChart 写进 GameState**——零 SAVE_VERSION 影响、零迁移。两级门控分工要记牢：`requiresFlags`=**发现**（不满足则 POI 根本不出现），`requiresUpgrade`=**抵达能力**（出现但灰显不可出海）。出海点位的"硬门控"已从 Aldo 对话彻底迁到海图（`openChart` effect → `phase 'chart'`，镜像 `openShop`→`shop`）；`startDive` 仍保留 `depart_east` 教学路径。POI 的三种环境修正现已全部实装，都读 `run.diveModifier`：`depthOffset`（mapgen 平移深度）、`current`（moveToNode 每次移动 `currentMoveCost` 耗体力+氧）、`visibility`（tickTurns `visibilitySanityDrain` 理智压力 + dark 时 NodeSelectView 盲航遮蔽预览）。

28. **`startDiveFromPoi` 是海图唯一出海入口，别再手写 createNewRun+startDive**：`engine/dive.ts::startDiveFromPoi(state, poi)` 已封装"派生升级加成 + distance 预耗氧 + diveModifier 落 run + depthOffset 透传 mapgen + 叙事日志"整套。SeaChartView 和脚本都走它。dialog 的 `startDive` effect（教学 `depart_east`）是另一条更简的路径，不带 POI 修正——两者并存但用途不同，不要合并。

29. **UI 层冒烟测试套路（`smoke-chart-ui.tsx`）**：playthrough 脚本只测引擎，React 组件从不渲染。要给 UI 兜底，用 `react-dom/server` 的 `renderToStaticMarkup(<View .../>)` 在脚本里把组件渲染成 HTML 串再断言关键文案。两个坑：(a) **tsx/esbuild 对独立脚本用 classic JSX transform**（不是 Vite 的 react-jsx 自动运行时），所以脚本顶部必须 `import React from 'react'`，否则 `React is not defined`；(b) **`scripts/` 不在 `tsconfig.json` 的 `include`（只 `["src"]`）**，所以脚本不进 `npm run typecheck`，只靠 `npx tsx` 运行时验证——这也是为什么脚本里 `import React`（在 react-jsx 下本会被 noUnusedLocals 判未使用）不会让 typecheck 报错。新写 UI 冒烟测试照这套路。

30. **迷路 mapgen 由 `mapShape` 选择，与 `canFreeAscend` 正交**：`mapShape`（'layered'|'maze'，缺省 layered）决定**拓扑**；`canFreeAscend`（默认 true）决定**上浮语义**。蓝洞群两者都设（maze + false）但概念独立——理论上可以有"开阔水域的迷路"或"封闭的层状图"。新 zone 想要迷路就设 `mapShape:'maze'`；要封闭水域语义再单独设 `canFreeAscend:false`。`generateDiveMap` 先算 depthOffset 后按 mapShape 分流到 `generateLayeredMap` / `generateMazeMap`。

31. **迷路图入口 = `ascent_point`（可退回洞口），不是堵死**：**设计决策**。入口（洞口）和远端出口都是 `ascent_point`，`isAscentBlocked` 只挡内部节点。迷路的代价由"往返耗氧"自然承担，不靠堵死退路（realistic + 不剥夺退路）。**所以 `playthrough-bluecaves.ts` 旧断言"起点被 block"已翻转**——现在断言入口不 block / 内部 block / 远端出口不 block，Phase 4 的 emergency 前置也改用内部节点。改迷路上浮设计时同步这三处。

32. **迷路双向边 + 节点重访**：`connectsTo` 在迷路里对称（A↔B），`getNextChoices` 返回含来路，玩家能回头。`moveToNode` 用 `run.visitedNodeIds.includes(target.id)` 判重访：重访 event 节点**不重播事件**（退化成安静 rest，防刷 loot / 重复剧情），corpse 同理（且 `recoverFromCorpse` 本就幂等）。`visitedNodeIds` 仍是 **append-only 全路径**（不去重，留完整轨迹给未来"路线图"UI）；但**建设值 / eventsTriggered 改用 `new Set(visitedNodeIds).size`** 去重计数（`death.ts::computeRawBuildingPoints` + `ascent.ts` 两处）——对层状（无重访）是 no-op，对迷路防来回踱步刷分。

33. **迷路结构不变量靠 `analyzeMap` + 种子扫描守**：不变量（全可达 / 双向 / 有环 / 有死路 / ≥2 最深点 / 入口=口 / ≥2 上浮口且全可达）对**每个 seed** 都该成立。`scripts/playthrough-mapgen-scenarios.ts` 跑 blue_caves seeds 1–60 扫描断言。**改 `generateMazeMap` 任何常数（minN/maxN 节点数、弦边数 targetChords、deepCount、受保护叶子逻辑）后必跑此脚本**——4 个 curated baseline 锁了精确 nodeCount/edgeCount/maxDepth（确定性，同款 LCG），动了 rng 消耗顺序会红，需有意更新 baseline。

34. **`DiveNode.layer` 在迷路里语义 = 到入口的树距（BFS hop）**，不再是"第几层"（层状图仍是层号）。dev 面板按 layer 分列布局；`playthrough-corpse.ts` / `playthrough-wreckyard.ts` 仍 log layer（都是层状 zone，语义不变）。迷路的 corpse pass **不用** `layerNodes.slice(1,-1)`（层状专用），改成"非入口、非 `ascent_point` 节点按 depth ±10m 匹配 `findRecoverableCorpse`"。

35. **打捞行会 Lv.2「出海前选目标」= `GenOpts.targetCorpseId` 强制布点**：与随机 corpse pass 互斥——`targetCorpseId` 有效（`isRecoverableCorpse`：同 zone + 未回收 + diveAge<25 + 还有物品）时**保证布点**，放深度最接近 `depthAtDeath` 的可用节点，**绕过 corpseChance 随机 + ±10m 深度窗**，且**不消耗 rng**（所以不影响 mapgen 确定性 baseline）；无效则退回随机。链路：`SeaChartView` POI 卡片（`preDiveCorpseSelect` 加成 + 该 zone 有可回收尸体才显示选择器）→ `startDiveFromPoi(state, poi, { targetCorpseId })` → `startDive` opts → `generateDiveMap`。判据集中在 `death.ts::isRecoverableCorpse`，UI/mapgen 共用，别各写一份。教学 `depart_east` 路径不带（也用不到，那是 east_reef）。

37. **气穴 / 扎营是 NodeKind（结构地标），不是事件**：易踩两点——(a) **气穴必须一次性**，否则迷路双向边能来回蹭气穴刷无限氧；用 `run.activeFlags` 的 `air_used:<nodeId>` 标记，`breatheAtAirPocket` 检查它，RestView 据此禁用按钮。(b) **`campAtNode` 先 `tickTurns(turns)` 再叠加恢复**，所以净值 ≠ 标称增益：被动理智衰减吃掉一点、深处 tick 吸氮会让长档"−5 氮"实际净增氮（测试要拿 `tickTurns` 基线比，别断言 `n0−5`）。两者复用 `'rest'` subPhase（RestView 按 `node.kind` 分渲染，与 ascent_point 同套路），不新增 GamePhase/subPhase。mapgen 在 `generateMazeMap` 类型分配段布点，且 corpse pass 候选排除地标。NodeChoice 新增 `kind` 字段供选点界面渲染地标标签（盲航也显示——它们是导航地标）。事件版（`makeshift_ledge` / `cave.air_pocket`）保留共存，不删。

36. **corpse hint 在 `enterNodeSelection` 里按 Lv.1（`revealCorpseHint`）门控，且连 preview 一起伪装**：易踩——只把 `hasCorpseHint` 标志门控掉、却留着 corpse 节点"一个熟悉的轮廓…"的 `preview`，等于没门控（预览本身就剧透）。所以 `enterNodeSelection` 在无 Lv.1 时**同时**把 `hasCorpseHint` 设 false **和**把该节点 preview 换成中性句。门控只影响"选点界面是否预知"；`moveToNode` 仍按 `kind==='corpse'` 路由（无 Lv.1 = 撞上去才发现，foresight 是 Lv.1 的价值）。Lv.2 选目标隐含 Lv.1（升级按 level 顺序门控），所以选了目标的人必有提示，不冲突。

38. **`getEvent`（events.ts）委托 `getEventById`（zones.ts::EVENT_DB），别再起第二份事件索引**：曾经 events.ts 只装 `tutorial.json` 建私有 `EVENT_INDEX`，而 `EventView` / `PortEventView` 都走 `getEvent` → **浏览器里任何非教学事件（reef/cave/wreck + portEvent cutscene）渲染成"[事件未找到]"**。playthrough/scenario 走 `getEventById`（全库），所以引擎测试一直全绿、UI 却是坏的——典型"只测引擎"盲区。现已统一委托同一份 `EVENT_DB`；`smoke-chart-ui.tsx` Phase H 守卫（渲染 `bluecaves.color_shift` 断言不出现"事件未找到"）。**教训：UI 的数据查询必须和引擎/测试共用同一索引；纯 playthrough 测不到 React 层，新加 UI 数据路径要补 smoke 渲染断言。**（2026-05-29 体检发现并修复）

39. **体检清理 pass（2026-05-29）新增的几处共用约定**：(a) **存档**走 `state.ts` 的 serialize/deserialize/migrate + saveGame/loadGame/clearSave，App 自动存读；**改 GameState 形状要同步 bump `SAVE_VERSION` 并在 `migrateSave` 的 while 里加迁移步骤**；Set 字段靠 `{__set:[…]}` replacer/reviver 自动 round-trip（加新 Set 字段无需改序列化）；回归在 `playthrough-save.ts`。(b) **共享 LCG** 在 `src/engine/rng.ts::makeLcg`，src 侧三处（chart/withSeededRandom/MapDevPanel）已统一；**scripts/* 仍各自内联同款常数**（独立 harness，改算法记得一起对齐）。(c) **`moveToNode` 的 NodeKind switch 有 `assertNever` 兜底**——新增 NodeKind 不处理会编译报错。(d) **mapgen 的 corpse 植入统一走 `placeCorpses(nodes, candidateIds, opts)`**，层状/迷路只管准备候选 id。(e) **`verify-tutorial.mjs` 现按目录扫 events/enemies**（不再漏 wreck/crab）**并加了注册守卫**：data 目录里每个 JSON 必须出现在对应 registrar（zones/combat/dialog）源码里，否则报错——把"加了 JSON 忘 import 静默不生效"变成 CI 失败。(f) 减压氮气阈值集中在 `ascent.ts::N2`，尸体可见年龄是 `death.ts::CORPSE_VISIBLE_AGE`。

40. **`import.meta.glob` 不能用来自动注册数据文件**：它是 Vite 专属转换，`scripts/*` 走 tsx（esbuild，无 Vite）时 `import.meta.glob` 是 `undefined` → 一调就炸，会拖垮整个 playthrough 套件。所以数据文件保持**显式 import**（zones/combat/dialog 各一份列表），靠 quirk #39(e) 的注册守卫兜"忘了登记"。将来若要自动注册，得找 Vite + tsx 都支持的方案（或让 scripts 不直接 import 这些 registrar）。

41. **海图 2D 地图视图**：`SeaChartView` 用绝对定位的标记按钮（`left/top` = `ChartPoi.mapX/mapY × 100%`）摆在一张 `.chart-map` 上，`useState(selectedId)` 选点 → 信息面板。**纯 UI 重写，engine/`generateChart`/门控/`startDiveFromPoi` 全不动**；POI 加了可选 `mapX/mapY`（anchors 写死 JSON、roaming 从模板透传、缺省按 distance 兜底）。两个 SSR 坑（`smoke-chart-ui` 用 `renderToStaticMarkup`，不能点击）：(a) 标记的**名字 + 锁定原因放进 `aria-label`**（且名字 span 始终在 DOM、CSS 控制可见），这样烟雾测试能断言到所有点位名/锁原因，哪怕只有选中点显示标签；(b) 信息面板只渲染**默认选中点**（= 第一个可出海 POI，教学后通常是东礁），所以测"选目标 picker"时要把那具尸体放进**默认选中点的 zone**，否则 SSR 下 picker 不渲染。`.chart-poi-name` 类语义已从"列表卡片标题"改成"标记标签"。

42. **D-reveal 程生姓名故障化是纯 UI（`src/ui/diverName.ts`），且揭示 flag 暂无内容触发**：`renderDiverName(name, deathsCount, revealed)` 按死亡数分档（<5 正常 / <10 笔误 / ≥10 故障）、`revealed` 覆盖成「你」。**`flag.d_reveal` 现在没有任何 lore/事件设置它**——这是故意留的钩子，终局揭示要靠后续内容置位（置位即所有死者名变「你」）。计数用 `profile.deaths.length`，而 `executeDeath` 在进 funeral 前已把新死者并进 deaths，所以**第 1 次死亡 = count 1 = 正常名**。确定性靠 `makeLcg(hash(name)+count)`（不闪）。已接 `FuneralView` + `CorpseView`（含取物日志）；改动死者名展示处时记得一并走 `renderDiverName`，别直接渲染 `record.diverName`。SSR 烟雾测试：故障档断言"不含连续原名"、揭示档断言含「你」。

43. **写 `scenarios/*.json` 的 `expect.statsDelta` 时：`statsDelta` = 选项 `outcome.deltas` ∪（`oxygen -= oxygenTurnCost`），不含每回合基础 −1 氧的节点过渡 tick**。即 `runEventScenario` 的 `summary.statsDelta` 只反映"事件结算本身"改了什么：没写 `oxygenTurnCost` 也没写 `deltas.oxygen` 的选项，`statsDelta` 里**根本没有 oxygen 键**（不是 −1）；写了 `oxygenTurnCost:N` 就是 `oxygen:-N`，再叠加 `deltas.oxygen`。且 `assertScenario` 只逐键比对 `expect.statsDelta` 里**列出的键**（未列的 stat 不校验），所以 nitrogen 这类被动量可以不写。**别凭直觉填，先 `event-runner.ts <id> --choice <opt> --seed <s> --out json` 跑出真实 `statsDelta` 再抄进 baseline**——check 分支要锁 `checkPassed`，就把相关 stat 设到 rate 撞 clamp（满值→0.95 必过 / 设低值→0.05 必败），并确保惩罚后的 stat 不触 0 下限（否则 clamp 会让 delta 对不上，例：cosmic −12 sanity 的失败 baseline 起步设 sanity 20 而非 10）。

44. **深水段（45-60m）cave.*/wreck.* 跨 zone 事件的 loot 语义约定**：深段事件按 tag 跨 zone 共享（quirk #17/#19）——`wreck.*` 进沉船墓园 + 旧灯塔礁 45m+ 深段，`cave.*` 进蓝洞群 + 旧灯塔礁 45m+ 深段（旧灯塔礁 45m+ tag = `[wreck,cave]`，二者都命中）。**所以 `wreck.*` 事件只掉人造打捞物（brass_fitting / canned_food），`cave.*` 只掉天然物（coral_shard）或纯 lore/sanity**——否则会在另一个 zone 里出戏（自然蓝洞里捡黄铜、或天然洞掉船货）。新增深段事件请沿用此分工。深段 lore 用新命名空间 `lore.deep_water.*`（`the_window` / `cold_light`），是跨 zone 的"深处有光"暗线，**与 `flag.d_reveal` 终局揭示无关（刻意没触发该 flag——揭示是不可逆的存档级叙事决定，留给在场的用户定）**。2026-05-30 第二个周末 pass 的 4 事件（silted_hold / halocline / porthole / blue_floor）即按此实现，每个配 ≥1 baseline，60m 事件池由此 1→5。

47. **旧灯塔礁的 `wreck` tag 从 25m 起（不是 45m+），所以全部 `wreck_graveyard.*`（`[wreck]`）事件天然跨 zone 共享到灯塔礁 25m+**：`zones.json::zone.old_lighthouse_reef.zoneTagsByDepth` = 0m `[shallow,reef]` / **25m `[reef,wreck]`** / 45m `[wreck,cave]`。`buildEventPool` 是 tag **交集 `some`**（事件 tag 与当前深度段 tag 有任一交集即入池），所以**任何挂 `[wreck]` 的事件在灯塔礁 25m+ 都会被抽到**——不止 `wreck.*` 跨 zone 料，连墓园原生 `wreck_graveyard.*` 也是。这是**有意**的：灯塔礁描述写了"岩礁下面据说还有些船难的残骸"，礁底本就有沉船，"船舱/引擎室"在礁底不出戏。**推论**：(a) quirk #44 说的"灯塔礁 45m+ = [wreck,cave]"只是最深一段，`wreck` 实际 **25m 起**；(b) 写 `wreck_graveyard.*` 等于同时给灯塔礁 25m+ 供货，所以 **loot 必须人造物**（canned_food/old_fishing_net/brass_* 等，守 quirk #44）、文案别写死"只此墓园才有"的设定；(c) 要让事件**只**在墓园而不漏进礁底，目前没有 zone 专属 tag——得引入 `wreck_graveyard` 专属 tag（类比 quirk #17 对 `blue_cave` 的提议）。**2026-05-31 周日 pass 的 4 个墓园事件即按此实现**（全 `[wreck]`、24-50m、loot 只 canned_food/old_fishing_net）：`the_knocking`/`the_open_door`（cosmic，把墓园原生 cosmic dive 从 1〔engine_room_hum〕补到 3）+ `hull_handprints`/`cold_stores`（uncanny）。叙事母题延续：`the_knocking` 是 `dive_slate`『不要回敲』的正面付现（敲击母题 engine_room_hum / silent_chamber / dive_slate），`the_open_door` 接『深处有光』暗线但**刻意不触发 flag.d_reveal**（留给在场用户，同 quirk #44）。

49. **realistic 探索密度 pass（2026-05-31 周日第四个 pass）＋ stamina-check 为何只锁 success baseline**：本 pass 刻意**轮换离开**前三个 pass 的 cosmic/uncanny/敌人侧重，回到 **realistic 探索质感**，跨 reef/wreck/cave 三 zone 补 **4 个 realistic dive、无新敌人**（守『敌人别太多·优先事件』，且近几 pass 已连加 3 敌人）：`reef.shelf_break`（30-44m·stamina vs12·coral_shard，**填 reef 26-44m realistic 缺口**——此前该段只有 barracuda 战斗触发器 + lobster_hole 到 35m，是 reef 唯一明确 realistic 空档）/ `reef.urchin_barren`（16-30m·无 check·coral_shard+sanity-1）/ `wreck_graveyard.galley`（20-34m·stamina vs13·canned_food/old_fishing_net 人造 loot，守 quirk #44/#47）/ `bluecaves.breakdown_pile`（16-26m·无 check 资源取舍·coral_shard 天然 loot，稀释 quirk #20 的 entrance_light 过曝）。全 realistic、全单 zone tag（quirk #19）、无 lore、**不触发 d_reveal**。事件 59→63、event baseline 43→49。**关键回归坑（承 quirk #43）：低 dc 的 stamina check 无法做 fail baseline**——`successRate=clamp(0.5+(stat-dc)×0.015, .05, .95)`，要 fail 必过的 0.05 clamp 需 `stat ≤ dc-30`，而 stamina dc 12-13、stat 最低 0 → 最低 rate 仅 0.32 左右，撞不到 0.05；**且小 seed（1-7 等）的 LCG 首抽都≈0.236**（NR-LCG 首值随 seed 线性微增，0.000388/seed），任何 rate>0.236 的 check 用小 seed 必过。所以**所有 stamina-check baseline 只锁 success 分支**（满 stamina→1.32→clamp 0.95，seed 1 必过），与既有 reef.flooded_stair/wreck.silted_hold/cave.halocline 一致；fail 分支只在写时用**大 seed**（如 100000，首抽≈0.99）手验 deltas（shelf_break fail={stamina-6,oxygen-2}、galley fail={stamina-8,oxygen-2,sanity-1} 已验），不进 baseline。要给 stamina-check 做 fail baseline 必须改 performCheck 暴露 roll 或换更高 dc——本 pass 没做。事件 baseline 命名/格式同 quirk #43，statsDelta 全部 `event-runner --out json` 实跑抄出，未凭直觉。

91. **声呐图 SVG 的 CSS 特异性陷阱：`.sonar-X circle` 通用规则会压过嵌套 `circle` 的 fill/stroke（#90 撞到·已修）**：`styles.css` 给声呐 blip/接触组都写了 `.sonar-stalker circle { fill:none; stroke:var(--danger) }` 这类**通用后代规则**（特异性 0,1,1）。给某个组内再加一个**带 class 的 `<circle>`**（如大型生物的弥散团 `.sonar-stalker-mass`，特异性 0,1,0）时，通用规则会**赢在 fill/stroke 上**——团被画成空心描边环、而非想要的实心弥散块（只有 `opacity` 这类未被通用规则覆盖的属性生效）。修法：把专用选择器写成 `.sonar-stalker circle.sonar-stalker-mass`（特异性 0,2,1）压回，或给通用规则加 `:not(.sonar-stalker-mass)`。**推论**：以后往任何 `.sonar-blip`/`.sonar-stalker`/`.sonar-threat` 组里加带 class 的 `<circle>`/`<line>` 覆盖样式时，选择器特异性必须 ≥ 既有通用 `.sonar-X circle`，否则视觉被静默吞掉（SSR smoke 只断言 class 串在不在、**不算计算样式**，所以全绿也照样能漏这种纯视觉 bug——这类要靠看渲染或本 quirk 提醒）。

93. **「位置即深度」系统不变量（#92 起·声呐图 / mapgen / 内容生成都按真实深度对齐·剧情一致）**：声呐图（`ui/SonarScanPanel`）/ MapDevPanel 纵轴 `y∝node.depth`（上浅下深·真实米数），单一来源 `ui/mapLayout.ts::deriveMapLayout`（固定 `pxPerMeter` **取 > blip 直径**防相邻整数米纵向重叠·x 按 depth 分箱居中纯避重叠·**无方向语义**）。**三条配套硬约束**：① `engine/sonar.ts::nodeSector` 必须按 `node.depth` 差分（**非 layer**·容差 `SECTOR_DEPTH_EPS`1.5）——否则定向 ping「朝深」楔形指下、却扩 layer-deeper 节点（迷路图里 layer-deeper 可能 depth 更浅、渲染在上方）＝自相矛盾（涟漪 `revealSonarScanDirectional`/`stalkerSector`/`seenStalkerSector`/`pingAimsAtSoundStalker`）；② mapgen 主下行 depth 单调-from-start（层状 `round(d0+step·L)` 逐层非减+同层相等·迷路起点钉 d0=图顶最浅、最深钉 d1、分支/回边允许朝浅）·`playthrough-mapgen-scenarios`「位置即深度」垂直性不变量兜（迷路 60+层状 30 seed）；③ 内容放置按深度——『更深』母题（the_rising/假底/永远有比最深更深/诱饵下行）落更深节点、浅段 fresh-wrongness 落浅节点（band `depthRange` 已天然成立）。**推论**：改 `deriveMapLayout` 的 y 映射 / `nodeSector` 判据 / mapgen depth 赋值前先读 **深水区 SPEC §13**；改 mapgen depth 赋值会破逐字节快照·须重置基线（#92 没改·属 additive）；**绿 ≠ 画对**（同 #91）——碰布局/扇区/深度渲染必补视觉验证（SSR→SVG 坐标核对或 dev server 肉眼·绿套件只断言 class 串、看不出上浅下深/楔形朝向/重叠/边缠绕）。声呐与房间 SPEC §5「布局朝向」已被本不变量取代（该 SPEC §5 留指针 → 深水区 SPEC §13）。

> 已修复或被后续内容填平，留档备查。

1. **沙箱权限**：在 Linux 沙箱里跑 `npm run build` 第二次会失败（删不掉旧 dist/），跑 `npm run dev` 同样问题（删不掉 .vite 缓存）。**用户本地 Mac 没问题**。

2. **第二次 build 前需要清缓存**：`rm -rf node_modules/.vite dist`。

5. **教学暗礁鲨调过两次**：原 50HP/6-10dmg 太硬，现 32HP/4-7dmg + 主动撤退（territorial 类敌人 HP ≤ 30% 时 50% 撤退）。

20. **蓝洞群入口段（12–25m）事件密度偏低**：目前只有 `bluecaves.entrance_light` + `bluecaves.color_shift` 两个事件能命中浅段。`scripts/explore-bluecaves.ts` 30 局测试里 entrance_light 触发了 42 次——玩家几乎每次都见到同一段开场。需要再补 2–3 个 12–25m 段的 cave 事件，**这是内容稀缺，不是 bug**。
