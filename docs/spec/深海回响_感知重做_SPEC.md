# 深海回响 · 感知系统重做 SPEC（灯 / 声呐 / 欺骗 · 新北极星）

> 状态：**拟定 + 实装 2026-07-04**（作者本 session 定向 +「全部做完」授权）· **车道 2–6 已实装 · full regress 92/92 绿 · 未提交**（待作者 Mac 复核 + 跑 vite build + 提交）· 车道 7（本文档指针 / CHANGELOG #259 / QUIRKS #219–#225 / STATUS）**REPO-DOCS 侧已落**（记忆文件由作者/另一手更新）。B（mimic / apex）冻结未做。
> 本 SPEC **替代**旧「越深越欺骗」感知愿景（见 §8 supersedes）。旧愿景机制成本高、实测不好玩，且声呐从不进决定、欺骗只是可忽略的预览文字。
> 数值 / 阈值 / 手感一律留最后统一调（见 memory `defer-number-tuning`）·本 SPEC 只定**机制与边界**。

## 1. 北极星 / 为什么改

旧模型三宗罪：

1. **灯**的收益用「full / 声呐 / 盲」三档**预览文字真伪**表达——微妙、玩家无感；且清水开灯免费 → 实战一直开着，开关决策既少又轻。
2. **声呐**从不改变「选哪个节点」（相邻节点永远照选、可盲选过去）→ 探图好玩，但对决策几乎零分量。
3. **欺骗**（声呐不可信 + 深度驱动 + 低 san 幻觉）摊在可忽略的预览文字里 → 成本高、恐怖不落地。

新北极星：**三件感知各司其职、诚实；欺骗收敛成单一「低理智」轴，只改选项 + 怪物。**

- **灯 = 诚实近场硬门**：没灯，探不了黑处。
- **声呐 = 诚实远场侦察**：把前方地图揭出来给你规划；射程 = 看多远。永不撒谎、不碰选点。
- **欺骗 = 只剩低 san**：理智够低 → 只改**选项**和**怪物**；san 回满即消。

「是世界坏了还是你疯了」旧作两根轴（世界欺骗 + 你的理智）**合并成一根**：只剩「你疯了」（低 san），世界诚实。更简单、更 legible、归因清楚。

## 2. 三根支柱 · 机制

### 2.1 灯 = 诚实近场硬门

- 黑处（节点 `visibility:'dark'`，及依赖光照的选项）**没有效灯 → 可见但锁住**：图上 / 选项里照画，但点不了，标「太暗，看不清——需要灯」。开灯 → 解锁可探 / 可选。
- 收益从「预览真伪三档」变成「**能不能探黑处**」（legible 硬收益）。
- **代价保留**：开灯 = signature↑（自曝，喂 alert / 遭遇）+ 耗电。此梁不动——「读真相必自曝」的深水张力，唯一还留在灯上。
- 需新增：① **「可见但锁住」渲染路径**（区别于 `visibleIf` 的**隐藏**）；② **灯门判定**。**✅ 实装（车道 2/3a）**：`clarity.ts::lampGateLocked` = `waterIsDark(diveModifier.visibility==='dark') && !lampOn(灯开+有电)`（**注意反转**：黑处正是灯的用武之地·不是旧 `lampEffective` 排除 dark）；`dive-select.ts` 给黑处无灯的非豁免节点置 `NodeChoice.locked`（地标 / Lv.1 尸体豁免）；`NodeSelectView` 渲染 disabled +「需要灯」+ `handlePick` 拦截。**「黑」是整潜级**（visibility 在 diveModifier·非单节点粒度 = 黑区必须带灯才能探）。

### 2.1b 揭示型门（hidden-reveal · 作者 2026-07-04 加）

与「可见但锁住」互补的第二种门——**带了道具才『显示』某选项 + 旁边标「靠 X 解锁」**：

- 机制早有：`visibleIf:{hasCapability/hasEquipment/hasItem/hasUpgrade}` 把选项藏到你有那东西为止（memory `capability_mechanism`）。新加的只是**归因提示**。
- **✅ 实装（车道 5-2）**：`events.ts::revealAttribution(state,opt)` 纯函数——可见选项若因某「持有」条件现身，取那件**实际持有物 / 能力的显示名** → `EventView` 渲染 `.reveal-tag`「靠 潜水刀」。走 capability→持有物真名 = **任何未来道具自动带提示、零逐项写**。
- **内容作者约定**（注释·不强制）：灯揭近场交互选项·声呐揭结构 / 导航选项·其余道具按性质。节点选项现无 `visibleIf` 门（由 mapgen+灯门派生）→ 暂不适用，将来加物品门节点可复用同函数。

### 2.2 声呐 = 诚实远场侦察

- **ping 才扫，不 ping 不扫**：删掉「本回合开 / 关 + 预约下回合」双态状态机。扫 = 付电 + 自曝。
- **SonarScanPanel 探图保留、且成为声呐的全部意义**：ping → 雷达式揭示前方有机洞穴 + 相邻 / 更远节点 + 猎手红点（现有渲染整套留用）。
- **射程 = 规划纵深**：`sonarScanRange`（现成、可升）决定你能预判**几跳之外**——短射程只看脚下岔路，升级后能看到「左支两跳下有气穴、右支尽头死路、再往下那节点上蹲着东西」。声呐 range 升级轴由此第一次有意义。
- **不碰节点选择**：相邻节点永远可选；声呐只让你**从图上多看几跳来计划**，不 gate、不改、不注入 per-choice 信号。
- **永不撒谎**：声呐回波恒为真（欺骗全部移交低 san 轴）。

### 2.3 欺骗 = 只剩低理智 → 选项 + 怪物

- **单轴**：唯一欺骗源是 `sanity` 低。深度 / 声呐 / 灯**不再**独立撒谎。san 回满 → 欺骗消失（清楚是「你」，不是世界）。
- **改选项**（基本现成）：低 san 门控 `visibleIf`（sanity 阈值条件·`bluecaves.silent_chamber` 那类「只在低 san 才现身」已是此路子）。可现身**假**选项 / 藏**真**选项 / 改写选项文案。
- **改怪物**（需新钩子·形态待作者拍·见 §7①）：低 san 下遭遇被改写。候选形态——(a) 注入只在低 san 出现的**幻觉遭遇**（看破 / 打赢即消，可无实体伤害或软伤）；(b) 改写**现有怪物表象**（同一只，低 san 看着不同 / 更凶）；(c) 幻觉怪与真怪**难分**（承旧「读 tell」母题，但 tell 失真只因你疯）。
- **不做**：声呐假回波、假预览、`spoofsSonar` 节点、深 band `sonarDeception`——全撤（§3）。

## 3. 拆除清单（blast radius）

已核符号真实存在：**106 处 / 19 文件·epicenter `engine/clarity.ts`（32）**。引擎 / 类型 / UI 删或塌：

- `sonarReturn`（不可信回波预览）
- `nodeSonarView` / `spoofsSonar` / `evadesSonar`（节点级声呐欺骗表象 + `DiveNode` 字段）
- `sonarPhantoms`（低 san 声呐伪接触）
- `applySonarDeception`（mapgen 欺骗 pass）
- `DepthBand.sonarDeception` / `run.sonarDeception` / `effectiveFalseEchoSanity` 及假回波阈值
- `clarityForNode` 三档 → **塌成灯门判定**（灯到 = 真，黑处锁）
- `lampPreview` 的**低 san 幻觉改写**分支 → 灯下恒真（幻觉移交 §2.3）

拆时守则：**逐字节别误伤保留项（§4）**；**先加 §6 机制门再拆**，扫到残留符号即红。

## 4. 保留 / 冻结（不碰）

- **灯 = 自曝**（signature / alert / power / 相关升级）**保留**。
- **SonarScanPanel 探图渲染整套**保留（有机洞穴 SDF / 雷达扫 / 猎手红点 / 射程揭示）。
- **B · apex 一律冻结**（作者：「这些有别的计划，晚点做」）：`ChartPoi.mimic` / `shouldLureMimic` / `mimic.json` / 尸衣者事件——靠海图 + 事件检定、**不依赖**被拆的声呐欺骗引擎；原样留着。拆 §3 时核 `mimic.json` 未引用被拆符号（别误伤）。
- **mimic / 尸衣者伏笔事件**（无灯之光 / 穿尸引诱 / 假信标那批）**冻结不改写**，随 B 一起以后做——别把要保留内容的铺垫先拆了。

## 5. 内容改写（A = iii · 逐条过 trench / abyssal / hadal / subhadal）

分类规则：

- **纯「声呐 / 回声骗你」拍子** → 改写进低 san（选项 / 怪物）新框，或降为**诚实氛围**（去掉机械谎言、留描写）。
- **mimic / apex 伏笔拍子** → §4 冻结、跳过。

**✅ 已实装（2026-07-04·车道 6）。关键更正**：`abyssal.json` / `hadal.json` / `subhadal.json` **不存在**——那些旧深度带早已删除、由数据驱动「深度柱」（memory `probe_depth_columns`）取代；本 SPEC 早稿据 stale memory 列的 beat id（no_floor / the_soft_floor / deeper_light…）从未落地。**实际活着的声呐欺骗内容只在**：

- `trench.json`「回波对不上」母题：8 个 beat（the_return / the_wall / the_answer / the_moving_floor / the_remembered / the_opening / the_sounding / no_walls）→ **改写进低 san 框**（诚实早回波 + 你自己硬读成形）或软化诚实氛围；`_doc` 母题头改写。
- `midwater.json` 的 `false_bottom` 一个 beat → 软化（鱼鳔返声非撒谎）。
- `lore.json` 6 条 trench lore body → 同步改写。
- **冻结（未动·随 B）**：`trench.second_diver`（+ `lore.trench.the_company`）/ `the_leftover_echo`〔borderline·保守冻结·**待作者定**是否属 sonar-phantom 该改〕/ `the_shelf`——corpse-wearer / 尸衣者伏笔。
- 守则守住：loot-free / 无脚本死（留关声呐·摸黑出口）/ 叙述永不交底（「是水，还是你」永不判）/ 主角 voice（memory `protagonist-voice`）/ 名字不音译 / 尸衣者术语门。scenario baseline 快照 id+deltas 非文本 → 无需改。

## 6. 机制化守则（regress 门 · 别让约定随 churn 丢）

- **check-no-sonar-deception**：src 扫到 `spoofsSonar` / `evadesSonar` / `sonarReturn` / `sonarDeception` / `sonarPhantoms` / `applySonarDeception` / `effectiveFalseEchoSanity` 任一残留 → 红（拆干净的守门）。
- **声呐诚实不变量**：声呐渲染 / 选点不读欺骗字段；node preview 不再有 sonar 档（灯门二态）。
- **低 san 欺骗单轴测试**：san 满 → 无假选项 / 无幻觉怪（控制组）；san 低 → 出现且确定性可复现。
- **灯门**：dark 节点无灯 = 锁住不可选、开灯解锁的 playthrough 断言。

## 7. 悬而未决 / 留作者拍

1. ✅ **「改怪物」钩子形态 = (a)**（2026-07-04 作者「全部做完」授权·我拍 a）：低 san 注入幻觉遭遇·看破 / 打赢即消。已实装（车道 5-1）：`clarity.ts::hallucinationApproaches`（san ≤ `HALLUCINATION_SANITY`(50) 且够深·高 san 控制组恒假）→ `dive-stalker.ts::maybeHallucinationEncounter`（复用 zone ambush 怪·标 `CombatState.hallucination`·moveToNode 里排在真伏击之后）→ `combat.ts` 软化结算（敌攻 0 体力伤·无 loot·暧昧收场「只有空水」）。**✅ 已决（作者 2026-07-05·#261）**：氧气**改为幻觉中仍当场致命**（`combat.ts` 氧气 ≤0 判死移出 `!inHallucination`·体力/san 仍软化不判）——全封＝「进幻觉无敌」泄张力；氧气自曝＝「你自己耗光的、不是鬼杀的」当场成立。无脚本死不破：应急上浮（step6·排在死亡判定 step8 前·无条件零成本零 roll）任何回合可离场。**并加 san 分层**（作者拍）：致命层 `HALLUCINATION_SANITY`(50→**20**·gate 幻觉战 + 氧气致命) / 可见层 `HALLUCINATION_VISIBLE_SANITY`(**50**·gate 改选项类幻觉·本身不致命)——「50 看得到、20 才致命」渐进恐怖曲线，20 高门槛天然是氧气致命的护栏；原散在 6 处的字面量 50 收口进可见层常量（events/eventSatisfy/eventScenario/StoryEditor·单一真相·quirk #227）。守门：`playthrough-sensors` 13（分层注入）/14b（富氧敌攻打不死）/14d（氧尽仍淹死）。数值仍占位·defer。
2. 低 san 各阈值、灯门覆盖哪些节点 / 选项密度：**数值留最后统一调**。
3. 被降为「诚实氛围」的深水事件，值得保留还是精简：改写时逐条看。
4. **B（mimic / apex）的「别的计划」**：不在本 SPEC；本 SPEC 只保证不拆其地基。

## 8. Supersedes（旧文档指针 · 实装时标过时）

- `深海回响_深水区_SPEC.md`：**声呐不可信 + 深度驱动欺骗 + 双传感器 clarity 的欺骗侧**（clarity 双层欺骗侧 / §3.2 感知双刃「返回不可信」/ Phase 2–3 声呐欺骗）→ 本 SPEC 取代欺骗侧；**诚实感知侧（灯 / 声呐 / 电 / signature / 射程 / 探图）保留**。
- `深海回响_声呐与房间_SPEC.md`：**S2 不可信扫描**整节 → 撤（S0 / S1 房间与探图渲染保留）。
- `深海回响_声呐渲染重做_SPEC.md`：**§4 声呐开 / 关窗口双态** → 改为「ping 才扫」单动作；渲染（§2 / §3 / §5）保留。
- `深海回响_剧情_SPEC.md`：**§3.7「另一个世界」/ 两根轴（世界欺骗 + 理智）** → 收敛为单轴（只理智）；story canon 其余不动。
- memory：`deep_game_vision` / `sonar_render_redo` 的欺骗段 / `story_canon` 欺骗段 → 重写标新北极星（车道 7）。

## 9. 实装车道 + 模型 / 精力档（SPEC 批准后开工）

| # | 车道 | 文件域（大致不重叠 · 可并行） | 模型 / 精力 |
|---|---|---|---|
| 1 | 本 SPEC（已起草 · 待过） | docs/spec | — |
| 2 | 引擎拆除 + clarity 塌 + 机制门 | clarity.ts / mapgen*.ts / stalker.ts / dive-select.ts / types | **Opus / high** |
| 3 | 灯门（可见但锁住 + Condition） | dive-select.ts（选点）/ NodeSelectView / EventView / types/events | **Opus / high**（与 2 邻界 · 串或细分） |
| 4 | 声呐 ping-单动作 + 射程 lookahead | dive-sensors.ts / SonarScanPanel / sonar.ts | Opus / medium |
| 5 | 低 san：改选项（接现成）+ 改怪物（新钩子） | events.ts / clarity.ts(san 钩子) / combat 接口 | **Sonnet / medium**（钩子形态定后） |
| 6 | 内容改写 trench / abyssal / hadal / subhadal | data/events/*.json + lore | **Sonnet / medium** |
| 7 | 文档 / 记忆重写 + CHANGELOG / QUIRKS | docs + memory | Sonnet / low–medium |

并行：**2 / 4 / 5 文件域基本不重叠可并行**；3 紧邻 2（同碰选点文件）建议串或细切车道；6 依赖 1 / 5 定框；7 收尾在 main 整合（append-only 文档只在 main 写）。单 agent 用无重叠车道跑 subagent 时 **合并后必跑完整 regress**（隔离 agent 看不到跨切断裂 · 见 memory `cowork-parallel-agents`）。

## 10. 决策日志

- **2026-07-04**：作者定向——(b) 声呐不撒谎、做诚实侦察；北极星可改，欺骗只剩低 san → 选项 / 怪物。A = iii 改写深水欺骗事件；B（mimic / apex）冻结晚做。灯 = 硬门、ping 才扫、灯自曝保留（前序拍板）。
- **2026-07-04（续·「全部做完」执行）**：车道 2–6 一口气实装、每条独立复核 + full regress 92/92 绿——车道 2 拆声呐欺骗引擎（−~480 行）+ clarity 塌灯门 + `check-no-sonar-deception` 门；车道 3a 可见但锁住渲染；车道 4 声呐 ping 单动作（删双态）+ 射程 = lookahead（`sonarScanRange` 揭示 BFS N 跳）+ 杀空升级（task8）；车道 5-1 低 san 幻觉怪（§7① = a）；车道 5-2 揭示提示 `revealAttribution`；车道 6 trench / midwater / lore 内容改写（abyssal / hadal / subhadal 早已不存在·更正见 §5）。**待作者过 4 点**：氧气在幻觉中是否致命（§7①）· `mimic.json` `_doc` 被车道 2 改一行· 黑 = 整潜级粒度· `the_leftover_echo` 冻结是否该改。 **→ 全部已决，见下条。**
- **2026-07-05（4 待决点全拍板 + ① 实装·#261·Cowork 交互·Opus）**：作者逐条过——**① 氧气幻觉致命**＝改（+ san 分层致命 20 / 可见 50·见 §7①）·实装 `combat.ts`（氧气门移出 `!inHallucination`）+ `clarity.ts` 两常量 + 6 处收口 + `playthrough-sensors` 14d 守门；**② `mimic.json _doc`**＝接受（纯注释·去 `spoofsSonar`/`evadesSonar` 前向引用·逻辑字节不变·grep 无残留符号）；**③ 黑＝整潜级**＝作者 override → 要 **per-node 黑 + 能见度砍黑/不黑两档（murky 取消）+ mapgen 合理分布 + 剧情自洽**，方向 **b**（黑点只在该黑的区 opt-in + 复访确定性 + 参与区文本抽查）·**本 session 不实装·留专门 session**（blast radius 已调研在案·执行 Opus/high 单车道·机制层 types/clarity/mapgen/dive-select 先落、内容层 murky 迁移 + 黑点分布 + 剧情自洽按区推进·剩余细节 dive-start log 改法、`check-no-murky` 门、各区黑点密度待敲）；**④ `the_leftover_echo`**＝**保留·性质先不钉死**（连「corpse-wearer 伏笔」都不明说·合「永不交底」）。full regress **92/92 全绿**（沙箱 Linux esbuild·仅 prod build 缺 rollup 留 nightly）。
