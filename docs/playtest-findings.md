# 深海回响 · 平衡 / 内容 backlog（试玩发现）

> 来源：2026-06-21 自动试玩（真引擎 + 「理性玩家」机器人 ~2200 潜）。这是**待办清单**，不是已生效约定——做完的条目迁去 CHANGELOG / 相应 SPEC，生效约定迁去 QUIRKS。
> 复跑工具：`tools/playtest-sim/`（`bash tools/playtest-sim/run.sh`·见本文末）。
> 机器人非真人——结论偏机制层（数值/可达性/经济），主观手感（叙事节奏、谜题难度）未覆盖。
> ⚠️ 本文基于约 HEAD 1eb8517 的状态采集；之后 main 已推进（#171/#172 St2 留白结局 + `mouthbrooder` 新敌 + depth_columns 改动）→ 部分数字可能需重跑刷新（`bash tools/playtest-sim/run.sh`）。

## 状态图例
🔴 P0 影响通关 · 🟡 P1 体验/平衡 · 🟢 P2 打磨 ｜ 状态：待定 / 已拍方向 / 进行中 / 已做

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

- 🟢 **P2-4　`item.spare_tank` 未定义**：`upgrades.json` 气瓶库 Lv1 `unlockShopItem: item.spare_tank`，但 items.json 里没有这个物品 → 建完第一个氧升级，「解锁备用气瓶购买」是死的。补一个 spare_tank 消耗品定义即可（正好接 P2-2 潜中回氧件）。

扫描澄清（非 bug）：① lore 条目**内联定义在各 event 文件里**——「~90 条悬空 lore」是误报；② 47 条「未接好选项」全是对话/区域 schema——事件文件里真·未接好选项 = 0；③ DC：体力 12–50、理智 14–80、氧 30——满状态都 ≥35% 可过。

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
- 决策器＝「理性谨慎玩家」：捞料、预估回程氧、躲必死/战斗、氧≤reserve+margin 或 sanity≤12 上浮；`fightForLoot` 切接战。改判定改 `player.ts`。
