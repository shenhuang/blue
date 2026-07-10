# 深海回响 · 平衡 / 内容 backlog（试玩发现）

> 来源：2026-06-21 自动试玩（真引擎 + 「理性玩家」机器人 ~2200 潜）。这是**待办清单**，不是已生效约定——做完的条目迁去 CHANGELOG / 相应 SPEC，生效约定迁去 QUIRKS。
> 复跑工具：`tools/playtest-sim/`（`bash tools/playtest-sim/run.sh`·见本文末）。
> 机器人非真人——结论偏机制层（数值/可达性/经济），主观手感（叙事节奏、谜题难度）未覆盖。
> ⚠️ 本文基于约 HEAD 1eb8517 的状态采集；之后 main 已推进（#171/#172 St2 留白结局 + `mouthbrooder` 新敌 + depth_columns 改动）→ 部分数字可能需重跑刷新（`bash tools/playtest-sim/run.sh`）。

## 状态图例
🔴 P0 影响通关 · 🟡 P1 体验/平衡 · 🟢 P2 打磨 ｜ 状态：待定 / 已拍方向 / 进行中 / 已做

---

## 2026-06-27　经济「不 grind 化」方案（方向：两者都要·砍价＋主线供料）

> 触发：2026-06-27 LLM 战役报告（`tools/playtest-llm/reports/CAMPAIGN-2026-06-27T14-27-32.txt`）＋作者确认「资源跟不上建造、不想要 grind」。
> 方向拍板＝**两者都要**：建造可选且便宜 ＋ 主线路径保底供料。
> 数值（掉率/价格/base 氧）仍按 `defer-number-tuning` 约定留最后统一调——**本节只列机制**。
> 与下方 2026-06-21 的 P1-1/P1-3/P1-5/P1-8 是同一组症状的「方向收口」，旧条目作执行细节参考。

**✅ 实装进度（2026-06-28）**：D-1/S（coral/scrap 拆双职 + 深度加权 lootFactor）+ 经济可达性/主线可达性/harness-resolveoption 三门已在 #233/#234 落 main。**E + F 本 session 落地**：① 材料加 `role`（structural/optic/organic/special·`items.ts` + `items.json` 27 标）；② 五柱 9 档 + 哨站/轨道/废墟成本 bio→矿物（eel/beak 退出结构·点亮档留 lantern）；③ 跨区门：中层 t4/t6←`vent_sulfide`(热液)、热液 t4←`iron_concretion`(残骸)、海沟 t3←`wreck_bronze`、capstone `station_module` 链不变；④ 新门 `check-build-material-theming`（Rule A 结构件用对料 + Rule B 早期不压深矿）已挂 `regress.mjs`。沙箱验证：`tsc --noEmit` + 全部 `check-*` 绿；3 处 playthrough 种子（vent/trench capstone + 哨站补给设施）已同步改新料。Mac 首跑 `npm run regress` 暴露 2 处随经济漂移的 tsx 夹具（沙箱跑不了 esbuild）·已按 `walkDemand` 真实计算值修：`smoke-economy-panel`（beak bottleneck→single·demand 16→6 仍 upgrades.json 装备线·brass 39→41·idle 去锰结核/热液硫化矿）+ `playthrough-lighthouse-scenarios`（ruin 修复种子 beak→iron）。**待 Mac 复跑确认 75/75 → closeout 提交**（CHANGELOG/QUIRKS 收录新门 + role 约定）。数值仍 defer。

### 报告纠偏（两条头条结论站不住·别照着改）
- **brass_fitting 不缺来源**：`reef.json` / `wreck_graveyard.json` 各有几十处掉点（＋`grotto`/`flooded_gallery`/`shaft_crack`）。那局没掉＝掉点大多挂在战斗/检定/「撬黄铜」选项之后，而锚点剧情潜绕开了它们。→ **不要「加 brass 来源」**，要让主路径碰得到现有来源（见 S 组）。
- **event_seen 已持久化**：`oncePerSave` 选项写进 `profile.flags`（`events.ts:348`·跨 run 持久）。报告「存档 0 个 event_seen」八成是 LLM harness（`tools/playtest-llm`）快照没透传 `profile.flags`，或某教学选项没带 `event` 参数走 `resolveOption`。→ 列为 **I-1 待核实**，可能只是 harness 的锅、非正式存档 bug。

### 根因（结构性·非数值）
1. 经济与 ch1 通关**完全解耦**：`mentor_logbook` 点亮四锚点即可便宜通关（这局 6 金/0 升级一路到 85m 结局），主路径从不经过产料 → 整套升级/前哨/声呐树在一章里「无动机」、建造像没回报的杂活。←「跟不上/像 grind」的**根因**。
2. `coral_shard` **一物两职**：货币（卖 10）＋早期主力建材（船坞/各前哨第一阶/深度柱第一档）·「建」与「变现」天然对冲。
3. **深区纯 sink**：midwater/whalefall 0 敌 0 料·却正是柱/前哨的花费区（越深越亏·见 P1-3/P1-5）。
4. 锚点/剧情潜**本身不发料**：主路径按当前设计就是干的。

### S 组｜主线供料（边走边给够·免专门刷）
- **S-1　深区各档产本档素材**（midwater/whalefall/vent band）：给这些 band 的 tag 事件池补「保底采集」事件（镜像 reef/wreck 既有材料事件·`band.tags` 即专属池·见 `dive-start.ts` diveIntoBand）。data-only。合 P1-3/P1-5。
- **S-2　四锚点潜保底一笔材料**：锚点强制开场事件（`dive-start.ts:481` 派发 `poi.story.eventId`）尾部挂固定材料 grant·让走主线＝自然攒到第一批建材。data（事件 outcome）＋可选薄引擎。
- **S-3　剧情里程碑给材料包**：复用 item-as-unlock（`items.json` 的 `story.setsFlag`/`marksPois` 那套）·锚点完成/`charm_found` 等里程碑发一小包对应建材·让建造树「沿途付得起」。

### D 组｜建造接回主线（让建造有动机）＋ coral 分流
- **D-1　coral 货币↔建材分流**：把各建造**第一阶**的 `coral_shard` 改指向近乎无售价的散料（已有 `oyster_shell`(5)/`collapse_fitting`(7)/`whalefall_polychaete`(4)/`flint_nodule`(6)）·coral 退回纯货币。data-only·不动数值大小、只换 itemId。（与 E-2 角色重指派合并考虑·同改 `items.json`/账单。）
- **D-2　主线＝灯塔门控的「带 story 的深度柱阶梯」（重新耦合·复用现机制·作者 2026-06-27 定 A 案）**：放弃旧「维持解耦」设想——根因①的对治＝**有意重新耦合**。主线 beat 做成**带 `story` 字段的深度柱 tier**（住 `depth_columns.json`·一根柱＝该区由浅到深的主线阶梯·**一区可多 beat**），零造新门、复用现成四件套：
  - **隶属灯塔＋灯塔在才现**：`buildColumnPois`（host 未建→潜点不现·`columns.ts`）。
  - **升级灯塔解锁下一更深 beat**：`depthTierRevealState`（tier≤已建级=lit｜+1=dim｜更深 hidden）＝「升前一区哨站→开更深主线 POI」。
  - **跨区门**：复用现成 item/flag 跨柱依赖（先例：热液柱 capstone 产 `station_module`→海沟柱 tier4 cost 要它）。
  - **reveal/reach 分离**：日志 `marksPois` 早揭示坐标；能不能下＝灯塔 tier 门。
  - **改动①（唯一代码触点）**：`isPoiLit` 现对 `poi.story` 短路成「揭示即可下」（`chart.ts:257`）→ 揭示保留、但 `depthTierRevealState` 的 reach 门**也作用到带 columnId/depthTier 的 story POI**。
  - **改动②（解死锁·必须）**：前哨「可建门」`outpostUnlocked`（`lighthouses.ts:511` 现要「潜过本区锚点」）→ 改为「**上一步**进度 flag」（wreck←reef、midwater←wreck、vent←midwater）；reef owner=home＝天然免费起点。否则「建才能潜／潜才能建」互锁。
  - **改动③（结局判定推广）**：从硬编码「4 锚点 flag 齐」（`ch1.json` ending_station）→ 读主线链「最后一个 beat 已过」。
  - **后果**：主线现多层吃**建造＋升级** → S 组 / 可达性门**必须覆盖升级（probe tier）成本**·否则越深越 grind。与 E 组同改 `depth_columns.json`/`items.json` → 并入车道 B。

### M 组｜把约定落成 regress 门（CLAUDE.md：能变成 `npm run regress` 失败的检查就那样做）
- **★ check-economy-reachability**：把「资源跟得上」钉成静态检查·红＝供需断裂·纯结构不查数值 → 兼容 `defer-number-tuning`。
  - **✅ v1 已实装（2026-06-27·`scripts/check-economy-reachability.mjs`·已接 regress·当前绿·100 成本/13 材料）**：全部建造/升级/配方 cost 材料（items upgradeSteps/craftCost · upgrades.json · lighthouse_upgrades outposts/ruins/tracks · depth_columns 各 tier）必 ① 在 items.json 在册 ② ≥1 获取源（事件/敌人掉落 · 柱 grantsItem · Mira 可买 T1-2）。源收集宽·零误报优先·负向自测过（注入死材料→红→字节还原）。
  - **v2 待做**：升 DAG——按**区域/灯塔解锁序**校验「X 区/档要的料须在该步或更早可得」+ 六公理（单调/无结/有路…）·待 E 组重指派 ＋「材料→tier→各柱档」映射表。
- **check-no-sink-only-region**：任何承载建造成本 sink（outpost/column）的区域必须 ≥1 材料/loot 源（专抓 midwater/whalefall 纯 sink）。
- **★ check-mainline-reachable**：沿 `depth_columns.json` 柱/tier ＋ 灯塔解锁序走主线链——每个主线 beat 的 reach 门（host 灯塔建成／probe tier 已升／跨区 item·flag）都能被**前面步骤**满足·**无环、无死结、起点→结局可达**（替代旧「起手装可达」的 ending-reach-check：D-2 后主线改为建造链可达）。
- check-currency-material-split（弱·可选）：第一阶建材 ≠ 顶档货币物（编码 D-1）。

### I 组｜待核实
- **I-1　教学重播 ＋ mentor_logbook 复制**：核实是 harness（`tools/playtest-llm` 快照漏透 `profile.flags`）还是正式存档 bug。若正式版复现 → 它把 roam 刷料循环整个顶掉（报告 ③）·优先级升 P0。查点：`dive-start.ts:422` pinnedStoryEvent 选择 × portSnapshot 持久化 × `resolveOption` 是否带 `event` 参数。
- C 类旁记（非经济·暂记）：屏息潜逃零代价脱战（战斗可白嫖跳过）；「氮气是债」到 85m 无可见惩罚（机制没咬人）。

### E 组｜材料主题一致性（升级账单「讲得通」）
> 触发：作者 2026-06-27 指出哨站升级大量吃**生物材料**、解释不通。核实属实（账单见 `lighthouse_upgrades.json`）。
- **症状**：生物料在干结构/机电的活——`eel_skin`×2「在岩架上**凿出**锚位」（皮凿不动岩）、`cave_octopus_beak`「**通电**点亮」（喙与电无关·其设定是硬切削/雕件料）、`crab_chitin` 在残骸当承重浮筒、在中层又当「点亮」（同料异职＝账单临时凑）。**唯一讲得通的反而最妙**：`lantern_gland`（设定「离水过夜不灭、不腐」）做「点亮」＝天然不灭灯芯，**保留并强化**。
- **根因**：材料无「功能角色」概念，账单按「该区/该档手头有啥」填、非按「该部件用啥做」。且矿物/金属 roster（`quartz`/`iron_concretion`/`manganese`/`vent_sulfide`/`wreck_bronze`…）这些天然结构料**整张哨站账单一处没用**——料用反了。
- **E-1　材料加 `role` 标签**（structural｜salvage｜optic/bio-light｜organic）·单一真相落 itemDef（`items.json`）。
- **✅ 已拍：A（工程感）**。B（有机灯塔·就地取材的诡异手作）**留第二章**，ch1 不做。
- **E-2　按「功能＋采集门」重指派账单（早/中期分层·作者 2026-06-27）**：
  - **早期（ch1·L1 建造）＝打捞为主、几乎不压「需开采」的矿**：`brass_fitting`（旧灯塔拆的金属·非开采）/`coral_shard`/`crab_chitin`/`collapse_fitting`/`oyster_shell` ＋ 少量 T1/T2 矿（`iron_concretion`/`quartz_crystal`/`manganese_nodule`）。
  - **矿物＝中期产物**：开采需岩凿（`rock_drill`·`grantsCapability 'mine'`·见 capability_mechanism）。深档 **T3/T4 矿（`vent_sulfide`/`wreck_bronze`/`bluecave_geode`/`abyssal_crust`·Mira 不卖）** 才压到中后期账单。
  - **点亮＝全程 `lantern_gland`**（不灭灯芯·保留强化）。
- **E-2b　Mira 卖矿＝早期「买矿」逃生阀（现成机制·零新增）**：`isBuyableFromMira`（`port.ts`）现已让 **T1/T2 材料**上架（买价＝卖价×`MIRA_BUY_MARKUP`=2·按 `SHOP_STOCK_BY_TIER` 限量、回港补满）→ 早期建造要的少量矿**没岩凿也能花金币买**，岩凿只是「自采更省」的中期自给。要让某 T3 矿提前可买＝调 `SHOP_STOCK_BY_TIER`（数值·SPEC §9·defer）。
- **E-3　重写阶段 label/narrative** 把每笔卖圆（`lantern_gland` 那条 description 已示范笔力）。
- **★ check-build-material-theming（regress 门）**：① 建造阶段 role 必须与材料 role 相容（structural 阶不得纯靠 bio）；② **早期门**：L1/ch1-早期建造**不得要求需开采的 T3+ 矿**（只许 T1/T2 ＋ salvage ＋ bio-light）——把「前期不压矿物」钉成检查。
- **可达性联动**：M 组 `check-economy-reachability` 把「`isBuyableFromMira` 可买」算作合法来源；账单含 T3/T4 矿 ⟹ 须 mining-in-region 可达（深/中期）。
- **协同/调度**：给矿物 roster 真 sink（→ 挖矿/岩凿有意义）、生物料回流光/装备、与 S/D-1 **同改 `lighthouse_upgrades.json`/`items.json`** → **并入车道 B**（非独立并行）；其 check 并入车道 A。早期账单若只用 T1/T2＋salvage＋lantern → **Mira 侧零引擎改动**（纯账单 itemId 选择）。

### F 组｜进度门与资源分布（解锁↔资源 DAG·作者 2026-06-27）
> 设计意图：把深度柱做成「去别处变强再回来」的进度网——X 柱的更深档要 Y 区才产的材料（例：中层低档解锁 → 去热液拿更高级料 → 才解得开中层更深档）。现存种子＝热液柱 capstone 产 `station_module` → 海沟 capstone 必需（depth_columns.json 唯一跨柱硬依赖）。
> 「合理」＝下面六条公理同时成立·且**全部静态可判** → 并入 `check-economy-reachability`（把柱按 (tier,depth) 排成 DAG·违反即 CI 红，分布不靠手感盯）：
- **F1 单调**：到深度 D 的档，成本材料 tier ≤ 该档 tier；深档绝不要求「比自己更深才产」的料（防「要先深才能变深」的循环/grind）。
- **F2 无结（最关键）**：跨区门指向的前置料，须来自**当前解锁下已可达**的区+档（如中层 t4 要热液料 → 取自热液 t1–2 这种浅档·非热液 capstone）。
- **F3 有路**：每笔料有 in-reach 来源 **或** Mira 可买兜底（`isBuyableFromMira`·T1/T2）；T3/T4 矿不可买 → 须对应区 mining-in-reach。
- **F4 稀疏**：跨区门每柱 1–2 处（中/深档）·不织稠密网（否则又变 grind/迷惑）。template＝station_module。
- **F5 tier≈源深**：材料 tier 对齐产出深度（quartz/coral=T1 浅·iron/manganese/brass=T2·vent_sulfide/bronze/geode=T3·abyssal=T4）；capstone 才放「稀有·单源·跨区」特殊料。
- **F6 bio=光**（同 E 组）：结构档吃矿/打捞·只有「点亮/感知」档吃发光生物料（lantern）；eel/beak 退出结构、回流装备/声呐。
> **现状缺口（depth_columns.json 实读·5 根柱）**：① 五根柱**零矿物**·深档几乎全 bio（midwater t4–6 全 eel/lantern/beak·vent/trench 同）＝E 组「用反料」在柱里同样存在；② **midwater 纯 sink**（无原生矿·`manganese_nodule`「深处泥地凿起·靠上面不多见」lore 正好可作其原生深矿）；③ 跨柱 interleave 仅 1 处（vent→trench）·作者要的网未织。
- **落点（待起草「材料→tier→各柱档」映射表）**：F5 给矿物定 tier 表 → F1/F6 重写各柱档成本（结构矿＋点亮 lantern）→ F2/F4 织 1–2 处跨区门（如中层 t4 需 vent_sulfide·热液 t3 需 wreck 的 iron/manganese）→ `check-economy-reachability` 升 DAG 守 F1–F3。并入车道 B；数值 defer。

### 实装顺序 / 并行 / 模型建议（待你点「动手」再开）
- **顺序＝机制先行**：先写 ★check-economy-reachability（会红）→ 再用 S/D 组数据把它转绿（TDD 式·符合 CLAUDE.md 机制优先）。
- **并行车道（psm·互不重叠·见 `docs/infra/parallel-sessions.md`）**：
  - 车道 A｜regress 检查（`scripts/check-economy-reachability.mjs` ＋接 regress）——纯新文件·零冲突·**可独立并行**。
  - 车道 B｜经济数据（`lighthouse_upgrades`/`depth_columns`/`items`/`upgrades` ＋各区 event loot）——S-1/S-2/D-1 集中在 data·**内部串行**（共享 `items.json`/events）。
  - 车道 C｜I-1 bug 核实（engine `dive-start`/`events` ＋ harness）——独立·**可并行**。
  - A、C 与 B 三线可并行；A 先红、B 后绿需轻同步（B 合并后 A 自然转绿）。沙箱 worktree isolation 不可用 → 若派 subagent 走共享主树＋严格无重叠车道＋Opus 整合·**合并后必跑完整 regress**。
  - 模型/精力：车道 A/B＝**Opus·中**（结构＋数据·需全局一致）；车道 C＝**Opus·高**（跨 run/harness 状态推理·易错）；最后统一数值调＝**Opus·高**（手感·一次性）。

---

## 🔴 P0-1　避战打法软锁战役（待你定边界）
- **现象**：所有动物素材（eel_skin/beak/lantern_gland/crab/shark_tooth…）只从战斗掉落；事件 loot 一次都不给（扫了全部 12 个 event JSON）。Mira 只回购 T1/T2（`port.ts:7`），T3/T4（eel/beak/lantern）只卖不买。→ 全程用「潜行/绕过」选项的玩家拿不到 T3/T4，建不了 沉船 T3 / 中层 T4+ / 热液 T2+ / 海沟 T3+ / 打捞行会 Lv3+ / 任何要 lantern 的前哨阶段 → 主线推不动。
- **方向（已拍）**：接受「战斗=进度」，但要**有获取途径多样性**，不强制反复同一剧情。即靠 P1-1（遭遇量/剧情）+ 适度提爆率解决，而非给非战斗路。
- **状态**：已拍方向 → 落到 P1-1 / P1-2 执行。

## 🟡 P1-1　刷子曲线偏重：瓶颈是「遭遇稀」不是「每杀少」（核心）
- **现象**：每杀掉落健康（guaranteed ×1，逃跑只 0.3 倍）。但一张图只有 **~0.53 个能触发战斗的事件节点/潜**（reef：12.9 节点 / 8.9 事件节点 / 0.53 战斗节点）；伏击要攒够警觉+够深才出，浅区基本不补。单素材掉率/潜很低（reef：crab 0.13 / lantern 0.06 / eel 0.03 / beak 0.03）。
- **折算**：第一章脊柱需 eel×12 + beak×8 + lantern×7 + 1930 金（深区零产出·全靠浅区卖盈余）。最优刷点估算 eel~70 / beak~35 / lantern~30 潜（**但见 P1-4：vent stalker farm 可把 eel 拉到 ~1/潜≈12 潜**）。
- **方向（已拍）**：① 增加相关**剧情**+ 在特定地点**加遭遇量**（专门刷点：鲨群/蟹田/鳗洞），关键是**避免反复同一个剧情**（遭遇要多样）。② 适度**提高爆率**也可接受。
- **候选实现**：新增「战斗密集」POI（按区 1-2 个·多事件池轮替）；或上调深 reef「残骸/洞」带 combat-capable 节点比例；或让深度柱各档也产一点本档素材（顺手缓解 P1-3）。
- **状态**：已拍方向，待实现（P1-2 鲨鱼刷点立模板）。

## 🟡 P1-2　shark_tooth 只在教学掉一次（疑似遗漏·已认同修）
- **现象**：`combat.tutorial_shark` 只在 `tutorial.json` 接线，常规 reef **无任何**鲨鱼触发入口（reef 只触发 barracuda/grouper）。→ shark_tooth 正常流程只掉一次，而 tankhouse（第一个氧升级）要 ×4。不是硬锁（T1 可向 Mira 买），但反直觉。
- **方向（已拍）**：给常规 reef 加鲨鱼遭遇 / 做一个鲨鱼较多的专门刷点（与 P1-1 刷点合并）。
- **状态**：已拍方向·实现中（chart 已现 `礁口·鲨多的那道缺` POI）。

## 🟡 P1-3　深区零产出 + 越深越亏（反直觉经济）
- **现象**：中层/热液/鲸落**无敌人定义、几乎无 loot**；每潜深区纯花钱花料只换故事。经济严格「浅刷→深花」，储备在脊柱上只减不增。
- **候选方案**：让深度柱各档产一点本档素材（同时缓解 P1-1）；或给深区放置少量高价捞取点。
- **状态**：待定（与 P1-1/P1-4 一起考虑）。

## 🟡 P1-4　深区 stalker 是「借来的浅区敌人」+ eel 产出错位（连 P0-2 roster）
- **现象**：深区无原生敌人，stalker 借浅区怪——`open_midwater` stalker = **reef 梭鱼**，`vent_trench` stalker = **盲鳗**（掉 eel_skin）。后果：① 100m 开阔海/热液出现礁梭鱼/洞盲鳗·出戏；② vent 反成**最优 eel farm**（~1.0-1.4/潜·存活 70-87%）远超 eel 老家蓝洞群（~0.17）·产出与意图错位；③ stalker 每潜约 1.3-1.8 次（`ALERT_AFTER_TRIGGER=0` 后约 40 警觉回合重攒），反复打同一只·单调（正是你不想要的）。
- **方向**：补**区域原生敌人**（走 [[boss_enemy_design]]·main 已开始：mouthbrooder #172）→ stalker 区域化多样化·校正 eel 最优刷点。
- **状态**：进行中（roster 扩展已起步）。

## 🟢 P2-1　开阔区氧气严重过剩，第一个氧升级无感（已认同调）
- **现象**：reef/wreck/中层 base 结束时**还剩 50–95% 氧**（走完地图不是氧不够；O2=60 时 reef 转身余 ~38、中层余 ~32）。tankhouse(+10) 浅水边际价值≈0。
- **方向（已拍）**：base 氧调低 / 每回合消耗调高（base 砍约 40% 早期仍可通关）；深档本就吃紧 → 把「探更深」门控在氧升级后。配合 P2-2。
- **状态**：已拍方向，待实现（数值统一留最后·见 [[defer-number-tuning]]）。

## 🟢 P2-2　氧/灯塔升级深度不够 → brainstorm
扩展「靠升级探更深」纵深（择优/组合）：
- **双气瓶 / 大瓶**：更重·~2× 氧；用 weight 耦合代价（洋流体力消耗↑ / 过渡回合 +1·现有 currents 已扣体力＝天然接口）。做成 tank Mk.II/III 档位件（延续 upgradeSteps）。
- **制氧站/充电站升级链**：现 `oxygen_supply` 前哨 +10 单级 → 开 Lv1/2/3（+10/+20/+30）。
- **减压舱（新设施）**：降上浮停留/加快 off-gas（动 `ascent.ts` N2 模型）→「更深但能安全回」当可买能力。
- **节氧件**：防寒服/rebreather 降 `depthFactor` 氧耗。
- **门控原则**：base 氧压低（P2-1）→ 上面每项从「无感」变「探更深的钥匙」。
- **状态**：brainstorm，待筛+排期。

## 🟢 P2-3 / 待定　敌人种类太少（roster 单薄）
- **现象**：采集时全仓仅 ~7 物种（鲨/梭鱼/石斑/蟹/溺灯/盲鳗/章鱼），深区靠借（P1-4）。`beak`（洞穴章鱼角喙）出现在深 reef **合理**（旧灯塔礁按深 reef→残骸→洞分层·开阔安全）·根因是物种太少。
- **意见**：roster 该扩（尤其中层/热液/海沟**原生**种）。⚠️ 项目当前定时任务全停 + 敌人强依赖作者口味 → 建议「有引导的内容 session」（套周末内容引擎 baseline 流程）而非纯自动 schedule。main 已起步（mouthbrooder #172）。
- **状态**：进行中·走 [[boss_enemy_design]]。

## ✅ 已核实 / 已澄清（非问题）
- **crab/eel/beak 出现在 reef = 有意设计**：旧灯塔礁 `zoneTagsByDepth` 0–25 礁 / 25–45 礁+残骸 / 45–60 残骸+洞·开阔可自由上浮·100% 存活。深 reef 是 eel/beak/lantern 的**安全同源刷点**。
- **vent T2「单潜 600 次战斗」= 试玩机器人的锅**（flee/重接战 ping-pong），**非引擎 bug**。修正后 ~1.3-1.8 战斗/潜，stalker 约 40 回合一轮，正常。

## ❓ 待你定的设计问题
- **逃跑该不该给材料？** 现状 flee/scare 给 0.3 倍（鲨 0.5）。利：鼓励脱离、降挫败。弊：① 主题怪（逃了怎么采到的）；② 削弱「战斗=进度」（可 flee-farm）；③ 配合 stalker 重armed 可刷。**建议**：动物素材 flee/scare 掉率降到 0（逃跑只保命）或极低；鲨 0.5 尤其偏高。你拍。

---

## 每区图谱（2026-06-21 全区扫描·avoider vs fighter·n=30/style）

| 区(深度) | O2 | 存活 avoid/fight | 卖料 g/潜 (fight) | 战斗/潜 | 关键素材掉率/潜 (fight) | 角色 |
|---|---|---|---|---|---|---|
| reef 10-60(礁→残骸→洞) | 70 | 100% / 100% | 34 | 0.30 | crab .07 lantern .10 eel .03 grouper .07 | T1+brass·安全·战斗少 |
| wreck 18-50 | 70 | 100% / 97% | 35 | 0.47 | **crab .27 lantern .23** | **最佳安全 T2/T4 farm** |
| bluecaves 12-55(封闭) | 90 | 70% / 73% | 18 | 0.70 | eel .20 **beak .10** | **beak 唯一像样源·~30% 送死** |
| midwater 55-85 | 90 | 100% / 100% | **0** | **0.00** | **(无)** | **经济惰性·无战斗无 loot** |
| vent 85-118(封闭) | 100 | **60% / 87%** | 26 | 1.60 | **eel 1.33** | **最佳 eel farm·打比躲更活** |
| whalefall 80-110 | 90 | 100% / 100% | **0** | **0.00** | **(无)** | **经济惰性·纯故事** |

### 本轮新发现
- 🟡 **P1-5　中层 & 鲸落经济惰性**：两整区 fighter 也 0 战斗 / 0 loot / 0 材料。中层「感知柱」零产出可理解，但它同时又是深柱花费区 → 顶到底纯 sink；鲸落同样无产出。建议至少给一点捞取/遭遇（与 P1-3 合并）。
- 🟡 **P1-6　beak 是真正的瓶颈素材**：cave_octopus_beak 只有 蓝洞群 0.10/潜（~30% 送死）或深 reef 0.03/潜。脊柱需 ×8 → 最坏 ~80 趟最致命的区。比 eel 更卡。专门刷点/提爆率优先照顾 beak。
- 🟡 **P1-7　「躲 stalker」反而更致命（封闭区平衡反转）**：vent 里 avoid 存活 60% < fight 87%——躲着跑在封闭区被 stalker 反复咬到 O2 耗尽，迎战反而清场存活更高。算「奖励迎战」可保留，但它把 P0-1（避战不成立）钉死在后期；若想给避战留活路，需封闭区的非战斗脱离手段。
- 🟢 **vent 是最优 eel farm（1.33/潜）远超蓝洞群（0.20）**：同 P1-4 产出错位。蓝洞群作为 eel 源被 vent 压制，只剩 beak 价值——可考虑重分配（eel 多给蓝洞群 / vent 给原生热液素材）。

---

## Meta 进度链端到端（2026-06-21·引擎驱动 + 门控静态核）

跑了整条「教学→四锚点→四前哨→各深柱→station」的可达性 + 经济，分三层：

- ✅ **叙事结局：可达且便宜（无需材料脊柱）**。教学完即靠 `item.mentor_logbook` 把四锚点全部点亮（reef/wreck/midwater/vent 海图上 `lit`·连船坞都不要）。流程＝潜四锚点（reef/wreck/midwater 任意序 → vent 第四·dive-start 门控其余三齐才触发 vent 锚点事件）→ `ch1.ending_station` 置 `story.ch1.ending.fulfilled`。**所以一章叙事能通**，主线不卡在刷子上。
  - 软门：vent 锚点在 85-118m 封闭区·O2=60 起手很危（atlas：vent 存活 60-87%）→ 实际想先弄点氧升级再去，但不需要整条脊柱。
- 🟡 **材料/深度脊柱：可达但重，是「可选深潜」非通关必需**。前哨从**海图 UI** 建（`advanceOutpost`·`requiresAnchor` 门·非入潜事件）→ 点亮区域 → 深柱 POI 出现 → `buildAtLighthouse` 逐档建低频声呐 → 潜深柱。可达脊柱总账（船坞+wreck/midwater/vent 前哨+home/wreck/midwater/vent 柱）＝ **2420 金 + eel×16 + crab×12 + lantern×6 + beak×4 + brass×17 + coral×18**·≈百潜级（P1-1）。**和「通关」解耦后刷子焦虑可降级**（除非想让深柱成为通关必需）。
- 🔴 **P1-8　海沟 station 终局当前不可达（`story.ch1.trench_found` 无人置位）**。全 data+engine 扫一遍：**没有任何内容设置 `story.ch1.trench_found`**（story.ts 只在 flag 注册表声明它）→ 海沟前哨建不了（`requiresFlag` 永假）→ 海沟柱不生成 → 海沟柱 T4「科考站电梯」（消耗 vent 柱 T4 产的 `station_module`·置 `story.ch1.station_found`）永不可达。
  - 判断：**几乎肯定是 St1/St2 进行中的有意留白**（Story Canon「先做好一章」；缺 discoveredFlag = 有意留白）。叙事结局走 vent 锚点 `ending.fulfilled`，深海 station 是机制向深终局、其「发现」节拍还没写。
  - 记下来：**若 station_found 打算当一章（或深线）胜利条件，需补置 `trench_found` 的触发**（锚点/事件/物品即解锁皆可）；否则 vent 柱 T4 产的 `station_module` 是死货（无其他消耗者）。

---

## 数据完整性扫描（2026-06-21·静态过全部 data JSON）

整体**很干净**——没有悬空的 item/combat/event 引用、事件选项无「没接好」的、技能检定 DC 无不可能项。唯一真问题：

- ✅ **P2-4　`item.spare_tank` 未定义 — 已解决（#242·R 删死约定）**：起底＝双重失效——`upgrades.json` 气瓶库 Lv1 effect `unlockShopItem: item.spare_tank` 既引用未定义物品，且 `unlockShopItem` 机制**全仓无消费方**（itemId 只 `add` 进 `bonuses.unlockedShopItems` Set·Mira 货架走 `port.ts::SHOP_STOCK_*` 显式表·不读它）＝死通路。**作者拍 R**（删死约定·非 W 接线做实）：删该 effect + 描述去「解锁备用气瓶购买」+ 连同死的 `unlockShopItem` 通路一并删（types/engine/ui）；**不**补 spare_tank——「潜中回氧件」＝P2-2，有平衡分量，留作者将来 design 的新道具，不是 spare_tank。新 `scripts/check-upgrade-refs.mjs` 门把「升级引用悬空」整类钉成 regress 红（补 `check-data-schema` 不跨文件核引用的缺口）。

扫描澄清（非 bug）：① lore 条目**内联定义在各 event 文件里**——「~90 条悬空 lore」是误报；② 47 条「未接好选项」全是对话/区域 schema——事件文件里真·未接好选项 = 0；③ DC：体力 12–50、~~理智 14–80~~〔理智 DC 已随理智移除失效·« 2026-07-10 »〕、氧 30——满状态都 ≥35% 可过。

> 关联：roster 单薄（P0-2/P1-4/P2-3）对接 [[boss_enemy_design]]（boss/复杂敌人 + 六种生物系统 + 实装排期）——按区补原生敌人走那条线。

## 本轮 sim 未覆盖（坦白盲区）
- **战斗/武器平衡纵深**：只用起手刀，斧/枪/盾及负伤死亡螺旋未测。
- **主观内容**：叙事节奏、谜题难度、文案——机器人测不到，得真人。

---

## 复跑 sim（已落仓·随时可跑）
- 工具在 `tools/playtest-sim/`（见该目录 README）。**改完平衡后跑一次看漂移**：
  - `bash tools/playtest-sim/run.sh`（每区图谱 + meta 可达性·快）；`--deep` 加全分档 sweep。
  - 报告落 `tools/playtest-sim/reports/`（已 gitignore·保留历史·前后对比）。
- 也挂了 schedule `blue-playtest-sim`（每月 1 号兜底自动跑 + 任务列表里随时手动「Run now」）。
- 沙箱 esbuild 由 run.sh 自适应处理（对齐 tsx 版本·见 [[blue_regress_sandbox]]）；Mac 本机直接 `npx tsx` 即可。
- 决策器＝「理性谨慎玩家」：捞料、预估回程氧、躲必死/战斗、氧≤reserve+margin ~~或 sanity≤12~~〔理智已删·« 2026-07-10 »：该上浮触发失效·sim `player.ts` 需去掉 sanity 判据〕上浮；`fightForLoot` 切接战。改判定改 `player.ts`。
