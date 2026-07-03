# 深海回响 · 猎手（声呐图上的捕食者）SPEC

> **状态：v0.2 机制层完工（最新一次改动 2026-06-12·补第三通道 scent 旁路 #116，机制层未再变动；完工本体 2026-06-10 #109·Phase 1 spine #84 → §3 #89 → §4 #108 → §5/§6/§2.2/Q3 #109 全 ✅）。** 把一直抽象的「警觉」(`run.alert`，深水区 Phase 0b #59) 做成一个**有位置、会逼近、按你用哪种感官而显示不同保真度**的猎手。承接声呐与房间 SPEC §7 S3（威胁定位）/ §8.7（定位 stalker·此前留作者拍板）+ 深水区 SPEC §3.1（双层 clarity）/ §3.2（不可信声呐）。余下＝内容铺量（per-encounter 档案标签）、手感调参（§8）、§2.1 感知例外（cunning+低 san·接 Phase 3）——见 §7/§10。

---

## 1. 北极星 / 为什么

- **把感知本身做成代价与赌注**：你对这只猎手的认知，取决于你愿意付多少**暴露**去感知它。灯便宜但粗（只知「有东西在接近」）、声呐贵而细却可被它骗/躲（知「它在哪、多远」但读数会过时、会被 evade）、摸黑最隐蔽却最盲（既不知存在也不知位置）。这是深水区双传感器 clarity（§3.1）从「读地形」推进到「读威胁」。
- **推进「是世界坏了还是你疯了·拒绝裁决」**：声呐图上那个逼近的 blip 可能是真威胁、也可能是低 san 的伪接触（声呐与房间 S2 #78 已把两轴分开：威胁＝alert/真危险·琥珀 vs 伪接触＝san/你脑子·cyan）。猎手让这块屏上之物**真的危险**起来。
- **可生存铁律**：可生存但要够强 + 读出 tell·代价巨大·**无脚本死**（深水区北极星 / §9）。摸黑/拉距/上浮/避难/decoy 永远是出路。

---

## 2. 核心模型

### 2.1 一个猎手·两种保真度（感知按感官分 · 作者 Q1）
> 「用灯只能知道有东西在接近，声呐可以知道它在什么位置还有多远，但这两个显示的都是同一类猎手。」

- **灯（光）**：只知道「有东西在接近」——存在 + 大致逼近度（远/中/近），**读不出精确位置/距离**。＝现有 `clarity.ts::threatContact` 的模糊琥珀接触（S3 廉价版 #80），方位按 turn 漂移、定不住。
- **声呐（ping）**：知道它**在哪个节点 + 多远**——精确定位 blip。但**只在被扫到的那一记 ping 更新**（声呐与房间 §8.7「位置只在被扫到时更新」：两记 ping 之间它在动，你看到的是旧位置）；且可被它**躲过**（`evadesSonar` → 无回波，那一记 ping 没听到它，它仍在逼近）。
- **摸黑（关灯关声呐）**：你瞎着——既不知存在也不知位置（但你也最不容易被它「光/声」锁定，§2.3）。
- **同一只猎手**：不是两套敌人，是同一个实体的两种读数。这正是双传感器 clarity 的延伸——灯/声呐/摸黑三态权衡照搬到「读威胁」。

### 2.2 感官模态（敌人怎么找你 · 作者 Q2）
> 「有许多种类的敌人，有通过光判断位置的，有通过声音，也有都感知。」

- 敌人按**它用什么感官锁定你**分三类（`Stalker.sensesBy`）：
  - **光感（light）**：你点灯 → 它积累对你的锁定；关灯 ＝ 切断它的信号源。
  - **声感（sound）**：你 ping / 发声 → 它锁定；停 ping / 摸黑 ＝ 切断。
  - **双感（both）**：光声任一都锁定；要同时切断才甩得干净。
- **越深越偏声感/双感 + 越会躲**（`evadesSonar`，随深 band 概率升）——兑现「越深越难缠」(Q3)。
- Phase 2 落到数据（per-encounter `sensesBy`）；Phase 1 给一个 band 派生默认（§7）。
- **第三通道 scent（旁路·已实装 #116）**：本矩阵不重写——玩家**流血·重**（负伤 SPEC §6.1·`modifiers.scentTrail`）时，嗅觉系敌种（`EnemyDef.scent`/`StalkerProfile.scent`·鲨/梭鱼起手）走 `stalker.ts` 短路分支恒「有你的信号」（关灯/闭声呐/T1 吸声/T2 迷彩失效·守口 patience ×1.5·现身线砍半）；decoy 照常 guaranteed（§4 北极星）、medkit 止血＝根治。详见负伤 SPEC §6.1。

### 2.3 切断信号后的行为（作者 Q2）
> 「在切断信号源后，有些会停在原地几回合，有些会移到上次有信号的地方；后期会有能主动探测玩家的，需要升级装备。」

切断它锁定的信号源后＝**两种位置性格**（`Stalker.onLostSignal`）× **一个等待时长** `waitTurns`（作者 2026-06-06 厘清：「掉头就走」就是「等一阵再走」等 0 回合；上次信号点的「徘徊」也就是同一个「等」）：
- **wait**：原地等 `waitTurns` 回合再走。`waitTurns=0` ＝**掉头就走**（丢信号当场脱离）；`>0` ＝**过一段时间再走**（原地不动等几回合）。
- **seek_last**：先去「上次有信号的地方」(`lastSignalNodeId`)，**抵达后再等** `waitTurns` 回合徘徊找你、再走（你已离开那点 → 它扑空走人＝甩掉；够不到 → `STALKER_SEEK_MAX_TURNS` 放弃）。
- **active（后期 §3）**：主动探测——不靠你暴露、自己搜，需要升级装备才规避。
- 等够 / 找不到 → 它**脱离**（`lost`，下沉离开、despawn）。这是「摸黑＝逃生阀门」(北极星)的兑现；但「不一定立刻消失」(`waitTurns` 大的会守一阵) ＝你得读出它的性格、确认它真走了再点灯。

### 2.4 出现 · 逼近 · 接触（统一现有 alert→伏击 · 作者 Q1）
- **出现（spawn）**：你的暴露（signature #58 / 警觉 #59）越过猎线 → 一只猎手在你声呐量程外的某节点现身——**不是当场伏击**，给你读出来 + 反应的窗口。
- **逼近（pursue）**：每回合沿图朝你当前节点移动一跳（**节点绑定**·诚实·复用 `ui/mapLayout::deriveMapLayout` 的真拓扑）。
- **接触（contact）**：追到你所在节点 → 触发该 zone 的现有伏击遭遇（**复用 `ambushEncounters`** #59·**不加新常规敌**·守「敌人别太多」）。
- **统一**：这是把 Phase 0b 抽象的 `predatorApproaches → maybeApproachEncounter` 当场伏击，升成「先现身→逼近→接触」的有位置版（深 band 门控；浅/非 band 仍走旧瞬时路径，§7 向后兼容）。

### 2.5 逃脱阀门（可生存 · 无脚本死 · 作者 Q2 + 北极星）
- 切断它的信号源（按模态：关灯 / 停 ping / 俱关）→ 触发 §2.3 行为 → 跟丢。
- 拉开 graph 距离 / 抵达 `ascent_point` 上浮 → 脱离。
- **（后期 §5）大型生物**：钻进狭小空间躲掉 / 暂避。
- **（后期 §4）decoy 道具**引开；**（后期 §6）执着的猎手**等待更久 → 你不打就耗更多资源。
- decoy 道具**战斗中也能用于逃跑**（接现有 combat flee，作者 Q2）。

### 2.6 范围与压力曲线（作者 Q3）
> 「浅水和浅洞穴也有小概率出现，敌人小且弱；越往深处越难缠。」

- 全深度小概率出现：浅水 / 浅洞 ＝ 小且弱·越深越难缠（更会躲、更执着、双感）。
- 复用现有捕食者池（`ambushEncounters`）；深 band 更凶（沿 #64 band 倍率思路）。
- **Phase 1 范围＝深 band（trench+）**（`DepthBand.hunts`·复用现有捕食者）；浅水小概率弱变体留 Phase 2（需浅水捕食者内容 + 不破 §7.5 浅水免压的既有回归）。

---

## 3. 升级规避（后期 · 作者 Q2「后期需要升级装备」）
主动探测（active）的猎手要靠装备规避，沿现有传感器升级桥（#60/#80：`UpgradeEffect → getUpgradeBonuses → getRunBonuses → createNewRun → deriveSensorTuning`）：
- **T1 吸声（sound-absorb）**：压低你对**声感**猎手的声呐特征 → 它的 ping 锁定失效（你 evade 它，对称于它 evade 你）。
- **T2 主动迷彩（active camo）**：规避**光感 / 主动探测**猎手。
- **守地板**（北极星·无完全隐形）：规避有上限·最深/最凶仍能找到你（同 `SIGNATURE_MIN_ACTIVE` / 抗欺骗地板的铁律）。

## 4. Decoy 道具（后期 · 作者 Q2）✅ #108
- 不同 decoy 类型的道具：投放 → 把猎手引向别处（按它的感官：声诱 / 光诱）。
- **战斗中也能用 decoy 脱战逃跑**（接现有 combat 的 flee 路径）。
- 工程：新 item 类型 + 下潜内投放动作 + combat 内使用钩子。
- **实装注记（2026-06-10·#108）**：双感「任一锁定」（§2.2）⇒ 任一种诱饵都上钩（难甩〔§3 取 min〕但易诱·同一语义两面）；感官不合 → 不上钩、道具照烧（§2.1 的赌注延续到道具）；decoy 分支优先于真信号（烧消耗品＝代价本身故全效·区别 §3 守地板）；战斗内必成（北极星「decoy 永远是出路」）；获取面＝Mira 消耗品货架 + **出发前选带**（作者：「不然全带着下去死了就全没了」——风险自担·死亡进尸体快照可回收）。常量 `DECOY_TURNS` 等住 `engine/stalker.ts` 顶（§8）。

## 5. 大型生物 + 狭小空间避难（后期 · 作者 Q2）✅ #109
- 特别大的猎手：钻进狭小节点（窄缝 / 小室）它进不来 → 逃走或暂避。
- 接 mapgen 节点尺寸（声呐与房间 §5「房间/隧道粗细」）+ 节点「容得下多大」属性（`Stalker.size` vs node capacity）。
- **实装注记（2026-06-10·#109）**：「容得下多大」与声呐图渲染的房间大小**同一来源**——`engine/sonar.ts::roomScale01(id)`
  （hash01 从 SonarScanPanel 逐字迁居·面板反向 import·渲染零变化），`nodeIsNarrow` ＝标度 < `NARROW_ROOM_SCALE`(0.28·约最小
  28% 房间)。**玩家看图即可读出哪是窄缝**（洞穴一致性 #100 延伸·不另设暗值）。大型（`large`·深度派生或 per-encounter `size`
  标签）：寻路绕开窄节点（blocked BFS）、现身点占位过滤（容不下不落点·全图全窄 → 退化小型）、你在窄缝里＝贴邻也不接触、
  它走到「口外」（`largeGoalFor`＝它够得着的非窄节点里离你最近者）守着 → 接 §6 patience。小型/常规猎手全部路径逐字节不变。

## 6. 执着的等待者（后期 · 作者 Q2）✅ #109
- 有些猎手避难后等得更久（守在出口）→ 你不想打就得耗更多资源（氧/电/理智）等它走或另寻出路。
- `Stalker.patience` 属性 + 守口逻辑。
- **实装注记（2026-06-10·#109）**：patience 只管「**有信号围守**」——大型被你的窄缝挡在口外且咬着你的信号时
  `guardedTurns` 累计，> `patience`（缺省 `STALKER_PATIENCE`=4·per-encounter 标签可大，章鱼=10）→ 放弃离开（`gaveUp`
  叙事与「跟丢」区分）；丢信号仍走既有 §2.3 wait/seek 计时（零新状态机）。你在里面每回合照常烧氧/电＝资源博弈天然成立；
  出路：等它走 / 走另一个口 / 出去迎战（standAndFight）。脱困或重追 → 计数清零（下次围守重新数）。

---

## 7. 分阶段（每阶段独立全绿、可逐拍）

- **Phase 1（本 session · spine）** ✅：
  - §2.1 **感知分层**（灯＝接近〔复用 threatContact〕 / 声呐＝位置·同一猎手）。
  - §2.4 **出现 / 逼近 / 接触**（统一·复用 `ambushEncounters`·接触触发现有伏击遭遇）。
  - §2.3 **丢信号性格**（`wait`〔含 `waitTurns=0`＝掉头就走〕/ `seek_last` 去上次信号点徘徊找你再走）+ §2.5 **摸黑/拉距/上浮脱离**（脱离 despawn）。
  - §2.6 **范围＝深 band 门控**（`DepthBand.hunts` → `run.huntEnabled`·复用现有捕食者·越深越会 evade）。
  - 位置**只在被 ping 扫到时更新**（§8.7·`stalker.seenNodeId`/`seenTurn`）·`evadesSonar` 躲扫描（深 band 概率）。
  - **additive + gated 铁律**：`DepthBand.hunts` 缺省 off → `run.huntEnabled` undefined → 既有 `alert→maybeApproachEncounter` 瞬时伏击逐字节不变（守 `playthrough-stealth` §4-§6）。`run.stalker?`/`huntEnabled?` run 级·不入 profile·**不 bump SAVE_VERSION**（同 scanMemory/sonarDeception）。
- **Phase 2+（2026-06-10 #109 全部收束 ✅——本 SPEC 机制层完工·余下＝内容/调参/Phase 3 接口）**：
  - **§2.2 per-encounter `sensesBy` + active 探测** ✅（#109·`CombatEncounterDef.stalker` 档案标签〔「给现有敌打标签、不是加敌」〕：
    盲鳗=sound+active / 章鱼=both+patience10 / 梭鱼=light / 石斑=sound+慢速·未打标签遭遇＝深度派生逐字节不变；
    **active 主动探测**＝searching 态每 `STALKER_ACTIVE_PROBE_PERIOD`(3) 回合自己发一记·量程 `STALKER_ACTIVE_PROBE_HOPS`(3) 跳内
    且未被 **T2 主动迷彩**甩掉（`playerEvadesProbe`·§3「主动探测靠 T2」·守地板同款封顶+深折）→ 重新咬上（`reacquired` tell 叙事）——
    摸黑对它不再万灵、拉距仍是出路）。
  - **§3 升级规避（T1 吸声 / T2 主动迷彩）** ✅（#89·2026-06-06·`playerEvadesStalker` 对称 evadesScan·守地板·沿 #80/#87 升级桥·data `line.evasion_rig`）。
  - **§4 decoy 道具（含战斗内逃跑）** ✅（#108·2026-06-10·声诱标/光诱棒 `ItemDef.decoy.kind`·`deployDecoy` 投放 + `advanceStalker` decoy 分支〔优先于真信号·感官匹配·双感任一上钩·确定性〕·战斗 `FleeEffect.guaranteed` 必成脱战·Mira 消耗品货架 + **出发前选带**〔作者拍板「不全带·死了就没」·`applyCarryItems`〕·quirk #107）。
  - **§5 大型生物狭小空间避难 · §6 执着等待者** ✅（#109·见各节实装注记）。
  - **Q3 浅水小概率弱变体** ✅（#109·`ZoneDef.weakHunts` 数据 opt-in〔旧灯塔礁+蓝洞群〕+ 浅水线下（< ALERT_MIN_DEPTH）按
    `run.runId+节点` 确定性哈希 1/`WEAK_HUNT_DENOM`(10) 现身；**信号＝直读灯/声呐开关**（`weakStalkerHasSignal`——浅水 alert
    不积累〔§7.5 铁律不动〕·关灯/停声呐＝当场切断＝浅水版阀门教学）；硬性「小且弱」：慢速 `STALKER_WEAK_HSPEED`(0.55)·wait
    性格·永不 large/active；复用 zone 现有浅水池＝「小且弱」由内容兜底；`weakStalkerStep` 走旁路、没 opt-in/没现身 → 旧瞬时
    伏击路径逐字节不变）。
  - **stalker 多样性（patience / size / 速率 hspeed）** ✅（#109·全为 `Stalker` 可选字段 + per-encounter 档案·缺省＝旧常量）。

---

## 8. 可调参数（tunables）
出现猎线（沿 `ALERT_WARN`/`ALERT_THRESHOLD`）、逼近速率（跳/回合）、**等待时长 `waitTurns`（`STALKER_WAIT_TURNS`·0＝掉头就走）**、`seek_last` 总搜索上限（`STALKER_SEEK_MAX_TURNS`）、被扫到才更新（§8.7）、evade 概率（随深 band）、各 band `hunts` 开关、`sensesBy` 默认、行为分布（`wait`/`seek_last`）、生成距玩家跳数。住 `engine/stalker.ts` 顶。
**#109 新增**：守口预算 `STALKER_PATIENCE`(4·§6)、active 探测周期/量程 `STALKER_ACTIVE_PROBE_PERIOD`(3)/`STALKER_ACTIVE_PROBE_HOPS`(3·§2.2)、弱变体速率 `STALKER_WEAK_HSPEED`(0.55)与出现率分母 `WEAK_HUNT_DENOM`(10·Q3)；窄缝线 `NARROW_ROOM_SCALE`(0.28·§5·住 `engine/sonar.ts`·与渲染同源)；per-encounter 档案住各 `enemies/*.json` 的 `combatEncounters[].stalker`、Q3 开关住 `zones.json` 的 `weakHunts`。

## 9. 守则承袭（建时一直守）
- **回归文化（#22/#26）**：每阶段全绿（`npm run regress`）+ prod build；碰 UI 数据路径补 `smoke-chart-ui`。
- **可生存无脚本死 / 摸黑是阀门 / 深水北极星**（§2.5）。
- **敌人别太多**：复用 `ambushEncounters`；apex 是事件不是常规敌；新 `sensesBy` 是给现有敌**打标签**、不是加敌。
- **不擅自触发 d_reveal（#42）/ 叙述永不交底（#54）**。
- **软门控（作者 2026-06-03）**：深度靠装备/强敌·band 不加硬 flag·`hunts` 是内容门不是锁。
- **存档**：未发布不迁移——`run.stalker?`/`run.huntEnabled?` 派生·`?? 默认` 兜底·**不 bump SAVE_VERSION**（同 `scanMemory`/`sonarDeception`/`bandAlertFactor`）。

## 10. 决策日志
- **2026-06-06（发起 + 三问拍板，作者方向 A「声呐与房间收尾」之 §8.7 stalker）**：声呐与房间 §8.7 此前留作者拍板的「定位 stalker」正式开题。三问定调——① **一猎手两保真度**：灯＝知道有东西接近、声呐＝知道位置+距离、同一只猎手（§2.1）；② **感官模态**(光/声/双) + **切信号行为**(停原地 / 移到上次信号点 / 后期主动探测·升级 T1 吸声 T2 主动迷彩) + **大型生物狭小空间避难** + **执着等待者耗资源** + **decoy 道具引开**(战斗中也能逃)（§2.2-2.6 / §3-6）；③ **全深度小概率·浅弱深难**（§2.6）。据此成文 v0.1，§7 分阶段：Phase 1 spine（感知分层 + 统一出现/逼近/接触 + 基础两行为 + 深 band 门控·additive/gated）本 session 实装，其余 deferred（已捕捉）。**实装详情见 STATUS.md 顶部滚动条目（quirk #84）。**
- **2026-06-06（续·作者校正两点）**：① **感知不靠点灯（校正 §2.1）**：作者厘清「不点灯也能感受到接近」是**正确**的——关了灯也感觉得到，故玩家摸黑后能凭「感觉是否消退」判断猎手何时离开、何时安心再点灯；**例外：狡猾猎手 + 低 san**（此时「没感觉＝安全」不可信）＝Phase 2 留做（曾误把它做成「关灯就感觉不到」，已撤回·感知保持 alert/stalker 驱动·与灯无关）。② **切信号行为收成「两机制 × 一等待时长」（§2.3）**：作者「1 就是 2 等 0 回合」「linger 也是 wait」→ `onLostSignal` 从 `hold`/`seek_last` 改成 **`wait`**（原地等 `waitTurns` 回合·0＝掉头就走/N＝过一段时间再走）+ **`seek_last`**（先走到上次信号点·抵达后再等 `waitTurns` 徘徊找你·够不到则 `STALKER_SEEK_MAX_TURNS` 放弃）；新 `Stalker.waitTurns`/`waitedTurns`（run 级·不 bump SAVE_VERSION）。深/双感（狡猾）→ seek_last·浅段 → wait（半数 0 半数等一阵）。`playthrough-stalker` §3 覆盖三种观感（掉头就走/等一阵/去上次信号点徘徊）。全绿 26/26。
- **2026-06-10（Phase 2 续·§4 decoy 实装·#108·作者拍主方向）**：声诱标/光诱棒落地（`ItemDef.decoy.kind` data-driven）。机制定调——①**双感任一上钩**（§2.2「任一锁定」推论·与 §3 双感取 min 成对）；②**decoy 分支优先于真信号**且不掷骰（消耗品全效·代价＝道具本身·区别升级守地板）；③ lastSignal 刷成诱饵点 ⇒ 失效后猎手按既有 §2.3 性格在诱饵点收尾（零新状态机）；④接触判定仍对玩家做（扑诱饵路过你照样撞上·站诱饵上不走＝冲你来）；⑤战斗内 `FleeEffect.guaranteed` 必成脱战（北极星）。获取面：Mira 消耗品货架（×2/回港·同套加价限量）+ **出发前选带**（作者拍板「不全带，不然死了就全没了」→ `applyCarryItems` 只认 consumable·死亡尸体快照/生还归库走既有闭环）。`run.decoy` 真条件字段（quirk #106 口径）·不 bump SAVE_VERSION。回归 `playthrough-stalker` §10 + `-save` + `-economy` Phase 6 + smoke K1b/P·28/28。quirk #107（消耗品入 run 唯一入口 + flee 子串）。
- **2026-06-10（Phase 2 收束·§5/§6/§2.2/Q3 一次做完·#109·作者拍板「把之前讨论的猎手全部做完，然后和 decoy 一起完整验收」）**：四件套同 session 落地，机制定调——①**窄缝与渲染同源（§5）**：「容得下多大」直接读声呐图房间大小的同一哈希（`roomScale01` 迁居 engine/sonar·面板反向 import·渲染零变化）＝玩家看图可读、不另设暗值；大型寻路 blocked-BFS 绕窄、现身点**占位过滤**（距离按全图算——它从图外来，不需要「从你这非窄可达」；全图全窄 → 退化小型，别把它卡死）；②**patience 只管有信号围守（§6）**：丢信号仍走既有 wait/seek 计时＝零新状态机；守口的资源压力靠回合本身烧氧/电、不加新税；③**active 探测专吃 T2（§2.2/§3）**：它不循你的光声、是自己来找——吸声帮不上，`playerEvadesProbe` 独立哈希前缀；周期+量程双留逃口（可生存铁律）；④**Q3 弱变体直读传感器开关**：浅水 alert 不积累（§7.5 铁律不动）→ `weakStalkerHasSignal` 读 `sensors.light`/ping＝关灯当场切断＝阀门机制的浅水教学版；`weakHunts` 数据 opt-in + 确定性哈希概率（同 run 同节点恒同果＝可回归）；旧瞬时伏击路径在没 opt-in/没现身时逐字节不变。per-encounter 档案落 `CombatEncounterDef.stalker`（盲鳗 sound+active / 章鱼 both+patience10 / 梭鱼 light / 石斑 sound+0.6）。全部 run 级可选字段·不 bump SAVE_VERSION。回归 `playthrough-stalker` §11-§14（+§1-§10 零翻修＝additive 兑现）·28/28 全绿。**本 SPEC 机制层至此完工**；余下＝内容铺量（更多档案标签/浅水池）、手感调参（§8）、Phase 3 接口（cunning+低 san「没感觉≠安全」例外仍 deferred·§10 2026-06-06 续条目）。同 session 顺手：decoy 投放按钮门控放宽到「深 band 或场上有猎手」（弱变体场也能用·NodeSelectView）。
- **2026-06-06（Phase 2 起步·§3 升级规避实装，作者方向 E 选「§3 Evasion upgrades T1/T2」·#89）**：Phase 1 spine（#84）之后首个 Phase 2 beat。玩家侧规避做成**猎手 `stalkerEvadesScan` 的镜像**——`engine/stalker.ts::playerEvadesStalker(run,stalker)`：按猎手 `sensesBy` 取对应旋钮（声→T1 `soundAbsorbBonus`/光→T2 `camoBonus`/**双感取 min**＝两者都有才甩得动·兑现 §2.2「双感要同时切断」），封顶 `STALKER_PLAYER_EVADE_MAX`(0.6)、深 band（≥`STALKER_EVADE_DEPTH`108m）`×STALKER_PLAYER_EVADE_DEEP_MULT`(0.5)＝守地板（§3「无完全隐形·最深仍找得到你」·对称 `SIGNATURE_MIN_ACTIVE`），确定性 FNV（前缀异于 evadesScan＝两侧规避不相关）。接线＝`advanceStalker` 把「alert 越线」条件改成「越线**且**未被规避」——被规避那一回合当作信号切断转 `searching`（你甩得动它）。两旋钮沿 #80/#87 传感器升级桥（7 触点·夹 `STEALTH_BONUS_MAX`0.6）·data `line.evasion_rig`（吸声涂层/主动迷彩·深料**软门控**·免硬 flag）+ UpgradePanel 标签。**缺省 0 → 恒 false → advanceStalker 逐字节不变**（additive/gated 守 playthrough-stealth）·不 bump SAVE_VERSION。回归 `playthrough-stalker` §8 + `-upgrades` §10 + `-save` + smoke J8·全绿 26/26·提交 `574ae4a`。**Phase 2 仍 deferred**：§4 decoy（含战斗内逃跑）/§5 大型生物狭小避难/§6 执着等待/§2.1 感知例外（cunning+低 san「没感觉≠安全」）/§2.2 per-encounter sensesBy + active 探测/Q3 浅水弱变体。
