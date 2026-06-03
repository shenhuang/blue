# 深海回响 · 当前实装状态

> 截至 2026-05-29，本 session 做了**洞穴"迷路" mapgen 重写** + **打捞行会 Lv.1/Lv.2**（Lv.1 选点预知尸体、Lv.2 出海前选目标尸体）+ **气穴/扎营节点化**（air_pocket/camp NodeKind）。
> （上一波：港口海图 POI 选点；再上一波：沉船墓园。）
> 收尾做了一次**全项目体检 + 清理 pass**：修了一个真 bug（`getEvent` 只装教学事件 → UI 渲染非教学事件"未找到"，quirk #38），并落地存档序列化层 / 共享 LCG / 注册守卫 / 若干去重（quirk #39–#40）。
> 最后把**海图升级成 2D 地图视图**（标记点 + 选中看信息，quirk #41）+ **D-reveal 程生姓名故障化**（quirk #42）。
>
> **2026-05-30 周末内容 pass（两次）**：上午补旧灯塔礁灯塔线 5 reef 事件 + brass_fitting；下午补**深水段 45-60m 共 4 事件**（`wreck.silted_hold`/`cave.halocline`/`wreck.porthole`/`cave.blue_floor`，realistic×2 + uncanny + cosmic）+ 5 baseline + `lore.deep_water.*`，把旧灯塔礁 60m 事件池从 1 填到 5（详见 quirk #44）。事件 38→42。
> **2026-05-30 第三个周末 pass**：给 **reef（旧灯塔礁）补首个原生战斗**——梭鱼（玻璃大炮：hp16/evasion4/dmg[5,9]/predatory 不退）+ `combat.reef_barracuda_solo` + `item.barracuda_jaw` + 触发事件 `reef.barracuda`（只挂 `[reef]`，隔离 26-44m）；另补蓝洞群 **12-25m 浅段 2 事件**（`bluecaves.squeeze` realistic check + `bluecaves.other_bubbles` uncanny lore，quirk #20）。事件 42→45，敌人 3→4，事件 baseline 21→24，战斗 baseline 5→6（详见 quirk #45）。
> **2026-05-31 周日内容 pass（第一次）**：补**沉船墓园 4 个 dive 事件**（cosmic 原生 dive 从 1〔engine_room_hum〕补到 3 + uncanny 加厚）——`cold_stores`（uncanny·26-42m·stamina check·canned_food/old_fishing_net 人造 loot）/ `hull_handprints`（uncanny·24-40m·oncePerSave·sanity check·lore.handprints，玻璃里侧的手印）/ `the_knocking`（cosmic·30-48m·oncePerRun·sanity check + 回敲违禁分支·lore.the_knocking，是 dive_slate『不要回敲』的正面付现）/ `the_open_door`（cosmic·40-50m·oncePerRun·sanity check·门槛/吸力意象·lore.the_door）。全挂 `[wreck]`、loot 只人造物（quirk #44/#47）。事件 48→52，事件 baseline 29→34（含 the_knocking 听/回敲双 baseline）。详见 quirk #47。
> **2026-05-31 周日内容 pass（敌人）**：给**沉船墓园补第二只敌人＝沉灯水母**（`enemy.drowned_lantern`，**项目首只 cosmic-tier 敌人 + 首只 sanity-主导敌人**：hp24/armor1/evasion1/predatory，主攻「脉光」纯 sanity——『理智消耗战』，slow/tanky 反盲鳗·反章鱼）+ 触发事件 `wreck_graveyard.drifting_light`（cosmic·34-50m·拔刀/关灯避战 sanity check/退开）+ `item.lantern_gland`→Mira + combat/event baseline。另补 `reef.lighthouse_lens`（uncanny·30-44m·灯室的镜·填 reef 26-44m 中段 uncanny 缺口）+ `bluecaves.the_narrowing`（cosmic·14-25m·回头的路·填蓝洞 12-25m 浅段 cosmic 缺口）。事件 56→59，敌人 5→6，事件 baseline 39→43，战斗 baseline 7→8。**三个长线缺口（墓园敌人 / reef 中段 uncanny / 蓝洞浅段 cosmic）本 pass 全部补上**。详见 quirk #48。
> **2026-05-31 周日内容 pass（第四次 · realistic 探索密度）**：轮换离开近几 pass 的 cosmic/uncanny/敌人侧重，回到 **realistic 探索质感**，跨 reef/wreck/cave 三 zone 补 **4 个 realistic dive 事件、无新敌人**（守『敌人别太多·优先事件』）——`reef.shelf_break`（realistic·30-44m·礁壁断口·stamina vs12·coral_shard，**填 reef 26-44m realistic 缺口**：此前该段只有 barracuda 战斗触发 + lobster_hole 尾）/ `reef.urchin_barren`（realistic·16-30m·海胆滩·无 check·coral_shard+sanity-1，补 reef 浅中段 realistic 密度）/ `wreck_graveyard.galley`（realistic·20-34m·伙房·stamina vs13·canned_food/old_fishing_net 人造 loot·守 quirk #44/#47）/ `bluecaves.breakdown_pile`（realistic·16-26m·塌石堆·无 check 资源取舍·稀释 entrance_light 过曝 quirk #20）。全 realistic、全只挂单 zone tag（quirk #19）、无 lore/无 d_reveal。事件 59→63，事件 baseline 43→49（2 个 stamina-success + 4 个 no-check 路径）。详见 quirk #49。
> **2026-06-01 基建地图 revamp · Phase A（材料经济）实装**：把"建设值（每潜按 depth/node 计分）买升级"**整体换成"材料 ＋ 金币 买升级"**。`UpgradeDef.cost: number → UpgradeCost{ materials: MaterialCost[]; gold }`（5 个升级账单见 `data/upgrades.json`）；每个 material 加 `tier 1–4`（深度分档，门控高阶升级要更深的料）；`canPurchase`/`purchaseUpgrade` 改双资源（材料缺口 + 金币）；**`buildingPoints` 整体移除**（types/engine/UI/存档迁移 v1→v2 全删，`computeRawBuildingPoints`/`computeBuildingPoints` 删除）；**Mira 加回购侧**（T1/T2 可买，买价=卖价×2，`shopStock` 限量+回港补满；T3/T4 只卖不买）。SAVE_VERSION 1→2。回归全绿（`playthrough-upgrades`/`-economy`/`-save` 改写 + `smoke-chart-ui` 加 UpgradePanel/MiraShopView 两节）。详见 quirk #50 + `docs/深海回响_基建地图_SPEC.md`（Phase A 已打勾）。提交 `4612c0c`。
> **2026-06-01 基建地图 revamp · Phase B（灯塔数据模型）实装**：把"单一岸边港口"在**数据层**扩成**多座灯塔基地**。新 `Lighthouse` 类型（`types/lighthouse.ts`：id/name/mapX/mapY/level/`builtUpgrades:Set` + inert `integrity?`/`region?` 留 Phase D）+ `profile.lighthouses: Lighthouse[]`；现有港口重构成 **home 灯塔**（`lighthouse.home`，`createHomeLighthouse()` 单一来源，createInitialProfile 种入 + 迁移补种）；SAVE_VERSION **2→3**（`case 2` 给旧档种 home）。新 `engine/lighthouses.ts`（与全局 `upgrades.ts` 平行、互不污染）：`canBuildAt`/`buildAtLighthouse`（每灯塔升级轨，账单复用 Phase A 双资源）/`getLighthouseBonuses`（聚合 lightRadiusBonus/reachReduction）/`nearestLighthouse`（最近灯塔距离工具）+ `data/lighthouse_upgrades.json`（信标轨占位）。**灯塔此刻 inert**——reveal（点亮揭示）/ reach（最近灯塔算 distance）是 **Phase C**，本阶段没接进 chart/dive/UI，游戏行为不变。`dockyard` 仍全局（归属决策留 Phase C）。回归全绿（新 `playthrough-lighthouse.ts` + `-save` v2→v3 + verify-tutorial 加账单材料校验）。详见 quirk #51 + SPEC（Phase B 已打勾）。
> **2026-06-01 基建地图 revamp · Phase C（海图集成 + 修复循环）实装**：把 Phase B 的 inert 灯塔接进游戏，**revamp 三支柱（材料/灯塔/海图）闭环**。① **reveal**（`chart.ts`）：POI 落在某座已拥有灯塔的点亮半径内才可见——`isPoiLit`/`revealRadius`（home L1 半径 `BASE_LIGHT_RADIUS=0.72` 覆盖现有 4 锚点 + 近端 roaming，两个远端 roaming 落半径外、留给前哨）折进 `isPoiVisible` + generateChart roaming 过滤；② **reach**（`effectiveDistance`）：出海 distance 按最近的已拥有灯塔的归一化距离换算（`REACH_NORM_PER_TIER=0.3`，使 4 锚点从 home 算的档位＝写死 0/1/1/2 不破手感）减 reachReduction，无坐标/无灯塔退回写死 distance；`dive.ts::startDiveFromPoi` 消费；③ **修复废弃灯塔**：`data/events/lighthouse.json` 的 `lighthouse.ruin_north`（repair 选项 outcome 带新字段 `restoreRuinId` → `applyOutcome` 调 `engine/lighthouses.ts::restoreLighthouse` 权威校验 profile 银行账单 → push 新灯塔 + 置 `flag.lighthouse_restored.<id>` 把事件门控掉）；`data/lighthouse_upgrades.json` 加 `ruins[]`；④ **dockyard 迁灯塔**：`dockyard` 从全局升级迁成 home 灯塔「船坞」设施（`lighthouse.dockyard.lv1`，新 `lhtrack.dockyard` homeOnly 轨），其 `extraConsumableSlot` 经新 `getRunBonuses`（全局升级 ＋ 家灯塔船坞）桥回 run 加成；旧灯塔礁等远海 POI 的抵达门从 `requiresUpgrade` 改成新 `requiresLighthouseUpgrade`（读 home.builtUpgrades）；SAVE_VERSION **3→4**（`case 3`：已购 dockyard 搬进 home.builtUpgrades）；⑤ **UI**：`SeaChartView` 渲染灯塔节点 + 点亮范围圈，新 `LighthouseBuildPanel`（海图上建设施，"灯塔设施"按钮唤出）。回归全绿（新 `playthrough-lighthouse-scenarios.ts` + `scenarios/lighthouse/` + 改 `playthrough-chart`/`-lighthouse`/`-upgrades`/`-economy`/`-save`/`smoke-chart-ui`/`verify-tutorial`）。详见 quirk #52 + SPEC（Phase C 已打勾）。
> **2026-06-02 内容 pass（reef 浅段 fresh-wrongness + reef 第二只敌人「石斑鱼」+ 深段 realistic 密度）**：revamp 三支柱闭环后回到内容，一次补齐 [Weekend Content Log] 记的三个长线缺口。① **reef 浅段 uncanny/cosmic（作者选「全新浅水错位」母题，刻意不续灯塔『下面的光』线）**：`reef.silversides`（uncanny·10-24m·一墙银鱼把你扣在球心、围的却是一片空沙·sanity vs46+lore.reef_shallows.the_gap）/ `reef.sun_net`（**cosmic·14-25m·oncePerRun·沙上一格钉死不动的太阳光网·项目首个浅段 cosmic**·sanity vs50+lore.the_still_square）/ `reef.warm_seam`（uncanny·12-24m·一道从礁底缝里上来的血温暖水·no-check+lore.the_warm_crack）——全 `[shallow,reef]`（zones.json 里只灯塔礁 0-25m 吃 shallow，east_reef=tutorial、蓝洞=cave，故天然隔离），loot coral/loot-free（quirk #44/#19），新 lore 命名空间 `lore.reef_shallows.*`，三者都轻触『下面』暗线但**刻意不触发 d_reveal**。灯塔礁 12m 事件池 4→6（终于有浅段 cosmic）。② **reef 第二只敌人＝石斑鱼**（`enemy.reef_grouper`，territorial『礁檐守卫』原型：hp30/armor2/**evasion1 最低几乎必中**/threat4 不追/observer，gulp[6,10] 全场最高单击+buffet[3,6]）——与梭鱼(glass cannon 速杀)/章鱼(cave aggressor bruiser)/盲鳗(fast flanker)/沉灯水母(cosmic caster)全互补：**低闪避·厚甲·最重单击的重装墙，但 opt-in**（触发事件 `reef.coral_overhang` 给 sneak 避战取 loot / leave 无代价退两个非战斗出口，与梭鱼 predatory『总要付代价』相反）。4-turn 消耗战，掉新 T2 天然物 `item.grouper_maw`（石斑鱼鳔，organic→Mira）。③ **深段 realistic 密度**：`cave.sump_pool`（46-60m·`[cave]`·回水潭潜越·coral）/ `wreck.chain_locker`（44-60m·`[wreck]`·锚链舱打捞·brass/canned，quirk #44/#47）——填 60m 事件池（5→7），同时加厚蓝洞群/沉船墓园深段。事件 64→70、敌人 6→7、combat 7→8、item 21→22、event baseline 49→57、combat baseline 8→9，全回归绿。**敌人分布现各 zone 2 只（守『敌人别太多』，下个 content session 不建议再加敌人）**。详见 quirk #53。
> **2026-06-02 内容 pass（续二 · 墓园浅段 fresh-wrongness，首次作 deep-game vision 的「伏笔层」）**：接 reef 浅段那次的对称缺口——沉船墓园浅段 18-25m 此前**无 cosmic**、uncanny 仅 dive_slate/handprints 擦边（22-24m 起）。补 3 个 `[wreck]` 浅事件，全是墓园版「不信任自己的眼睛」，且**刻意是深水欺骗（见自动记忆 deep-game-vision）的浅水伏笔、叙述永不交底**：`the_other`（uncanny·18-25m·两船间一个跟你同步、隔着固定距离的潜水员·sanity vs48+lore——**伏笔 corpse-wearer**）/ `all_facing`（**cosmic·18-25m·oncePerRun·从上方看整片沉船的船首全转向塌口/深水·sanity vs50+lore·墓园首个浅段 cosmic·伏笔『深处的拉力』**）/ `full_nets`（uncanny·18-25m·拖网船的网被底下某物往深处拽得绷紧·stamina vs13 割上半截→old_fishing_net+canned 人造 loot / follow_down→lore·**伏笔深处的『渔夫』**）。全 `[wreck]`（quirk #47 跨灯塔礁 25m+，故 loot 仅人造物守 #44）、loot 仅 full_nets、新 `lore.wreck_graveyard.{the_other,all_facing,full_nets}`、**不触发 d_reveal**、**无新敌人（守 2/zone）**。事件 70→73，event baseline 57→62。详见 quirk #54。
> **2026-06-02 内容 pass（续三 · 深水伏笔 mid 层 25-44m，承 quirk #54「叙述永不交底」铁律 + 自动记忆 [[deep-game-vision]] 北极星）**：接 reef/墓园浅段 fresh-wrongness（#53/#54）的对称缺口，把『越深越欺骗』伏笔从浅段推进到三个 zone 的中段，**一 zone 一事件、一事件一母题、各填真缺口、无新敌人（守 2/zone）**：`reef.no_bottom`（cosmic·32-44m·oncePerRun·`[reef]`·断口外空蓝把你『往下要』＝『深处的拉力』，reef 首个非灯塔线 cosmic-mid，与 realistic `shelf_break` 同地标〈断口〉配成『诚实危险＋错读』）/ `bluecaves.the_glow`（uncanny·30-44m·`[cave]`·黑里一点无法溯源、你一拐它就移到别处的光＝『无灯之光』，伪装成灯塔的 mimic 假信标预告，加厚蓝洞『有人在下面』暗线）/ `wreck_graveyard.no_bubbles`（uncanny·26-42m·`[wreck]`·背对你干活却不冒一个泡的潜水员＝corpse-wearer 伏笔，并埋可读 tell〈不呼吸〉，承浅段 `the_other`）。全 loot-free、单 zone tag（#19）、**不触发 d_reveal**、无 combat。新 `lore.reef_deep.*`（首用）+ 复用 `lore.bluecaves.*`/`lore.wreck_graveyard.*`。事件 73→76，event baseline 62→68。详见 quirk #55。
> **2026-06-02 内容 pass（续四 · realistic 探索密度收尾，作者选「内容收尾·realistic 密度」）**：浅/中两层「越深越欺骗」伏笔成型后（#53/#54/#55），轮换回 realistic 探索质感（同 #49 逻辑），把各 zone 最薄的 **realistic** 段补厚——**一 zone 一事件、各填该 zone 真缺口、无新敌人（守 2/zone）、无 lore/cosmic/不触发 d_reveal、无新 item**。recon 用 `event-runner --list --zone-tag` 按 tone 数各 zone realistic 覆盖（lighthouse-reef 池报告浅/深段已被 #53 填平、不再是信号）：`wreck_graveyard.deck_cargo`（realistic·18-26m·`[wreck]`·后甲板捆死的整船货+垮货网·cut_lashings stamina vs13→canned_food/old_fishing_net 人造 loot / pick_spillage→brass_fitting·**填墓园浅段 realistic 缺口**——#54 把 18-25m 堆成 uncanny/cosmic 后补无错位打捞质感平衡 tone）/ `bluecaves.lobster_crack`（realistic·26-44m·`[cave]`·侧壁横缝里够礁虾·reach_in stamina vs13→coral_shard+lobster·**填蓝洞中段 realistic 缺口**——此前中段 realistic 仅 3 导航地标、无觅食 beat·天然 loot 守 #44）/ `reef.sand_channel`（realistic·34-44m·`[reef]`·礁脊间平行沙沟+来回涌·work_groove stamina vs12→coral_shard+lobster·**填 reef-only 深中段 realistic 缺口**——此前仅 shelf_break 触 44m，与之同地标家族〈断口/沙沟〉机制不同〈横涌 vs 垂壁〉）。全单 zone tag（#19）、loot 按 zone（#44/#47：wreck 人造·cave/reef 天然）、stamina-check 只锁 success baseline（#49）。事件 76→79，event baseline 68→71，敌人 7/combat 8/item 22 不变。详见 quirk #56。
> **2026-06-02 内容 pass（续五 · 深水伏笔深段 45-60m，承 quirk #54/#55「叙述永不交底」+ [[deep-game-vision]] 北极星，续「ok next」自动续做）**：浅（#53/#54）→ 中（#55）「越深越欺骗」伏笔成型、realistic 密度收尾（#56）后，把两条 apex 母题推进到**最深层（45-60m）、做成最强的 mimic/corpse-wearer 预告，但仍不触发 d_reveal**。**关键约束：reef zone 45m+ 段 tag=`[wreck,cave]`（#47），`[reef]` 事件在 45m+ 不出现 → 深段只有 cave/wreck 两 tag 可用**（reef『拉力』母题已在中段 no_bottom 封顶）。一 tag 一母题、全 cosmic·oncePerRun·loot-free·无新敌人（守 2/zone）：`cave.false_beacon`（46-60m·`[cave]`·超出自家灯塔光照边界却有一点暖得正是岸上灯塔该有颜色的光稳稳悬着『像有人替你点着』＝**伪装成灯塔的安康鱼 mimic 假信标的直接深段预告**·承中段 the_glow〈无灯之光〉、接 deep_water『下面的光』暗线 cold_light/the_window·新 lore.deep_water.the_false_beacon·account_for_it sanity vs55 双分支 + swim_for_it『缺氧也照游过去』代价）/ `wreck_graveyard.the_wearer`（44-56m·`[wreck]`·旧式铜盔潜水服、无灯无泡却知道你在哪、招手引你＝**穿尸体引诱的 corpse-wearer 直接深段预告**·承浅段 the_other / 中段 no_bubbles、埋可读 tell〈无灯/无泡/老古董装备/招手机械重复〉、go_to_him 反用本作对死者的温柔·新 lore.wreck_graveyard.the_wearer·read_him sanity vs55 双分支·无 combat）。全单 zone tag（#19）、不触发 d_reveal、叙述永不交底。事件 79→81，event baseline 71→75（两事件各 success+fail），敌人 7/combat 8/item 22 不变。**浅/中/深三层伏笔全部成型。** 详见 quirk #57。
> **2026-06-02 深水区 vision design（续「lets pin it down」，纯设计、零代码/零回归改动）**：内容层饱和后转入 [[deep-game-vision]] 正式开建的 design 阶段。作者四点拍板——① clarity＝双层 + 双传感器（宏观海图灯塔网 + 微观下潜**近距灯/远距声呐 ping**，**关灯关声呐＝致盲但降 signature 让捕食者更难发现你**＝主动感知双刃）；② 递归纵深大地图（既有 zone 更深 band → 终端 zone → 超深海沟 → 深渊，**永远有比最深更深的**）；③ mimic 首次＝海图假 POI（无灯之光）引诱 → 入潜兑现（both）；④ tell↔sanity＝模糊 + 检定更难（both）。出 **`docs/深海回响_深水区_SPEC.md`（v0.1）**：§3 架构（双层 clarity / 双传感器 / 探测双刃 / 可扩展深度轴 / mimic capstone）+ §4 现有代码接点 + §5 四 phase（0 双传感器 clarity+探测 → 1 深度轴 → 2 跨 run 供给前哨 → 3 mimic+d_reveal）+ §6 数据类型草案 + §7 待作者复核子决策 + §8 tunables + §9 守则。**下一步 Phase 0，开建前作者过 SPEC §7。** 自动记忆 [[deep-game-vision]] 已按拍板更新（clarity 从单纯涌现细化成双传感器+探测双刃）。
> **2026-06-03 深水区 Phase 0a 实装（微观双传感器 clarity + 不可信声呐 + 电池 + 低 san 腐蚀，深水区第一笔代码）**：把 `visibility:dark` 盲航泛化成统一 micro-clarity 三态——**灯（近·真相·暴露高·清水近免费）/ 声呐 ping（远·不可信回波·耗电·后期解锁）/ 摸黑（盲·最隐蔽）**。新 `engine/clarity.ts`（`clarity(run)` 预览档 + `sonarReturn` 不可信表象 + `lampPreview` 真相/幻觉 + `signature` + `lampPowerDrain`，tunables 集中文件顶）。run 加 `sensors{light,sonar,sonarUnlocked}` + `power`/`powerMax`；`enterNodeSelection` 按档把 preview 烤成 真相/声呐表象/盲（引擎侧门控、便于回归）；`dive.ts` 加 `setLight`/`pingSonar`（移动后 ping 消散、power 归零强制摸黑）；`tickTurns` 灯耗电（清水因子 0、黑水/微浊才耗）。低 san 腐蚀：声呐<60 注入假回波、灯<25 也幻觉（确定性哈希、叙述永不交底 #54）。**声呐后期解锁**（作者定）：`upgrade.sonar.lv1`（深料 lantern_gland+eel_skin+beak）→ `unlockSonar` → run.sensors.sonarUnlocked，早期＝仅有灯·黑水天然受限。**未发布暂不做存档迁移**（作者 2026-06-03）：不 bump SAVE_VERSION、run 新字段靠 createNewRun 种默认 + 反序列化兜底。UI：NodeSelectView 成纯渲染器（按 choice.clarity）+ 灯/声呐控制 + 电量 pill。新 `playthrough-sensors.ts`（10 节）+ smoke E 改写。**全绿 + prod build。0b（探测/隐身、消费 signature）留下一 session。** 详见 quirk #58 + SPEC §11（0a 已勾）。提交见 [[sandbox-git-commit]]。
> 给"未来的自己"和"下一个接手 session 的 Claude"看。

---

## 1. 一句话状态

完整 meta-loop 跑通：**港口对话 → 海图选点 → 教学线性下潜 / 节点图随机下潜 → 事件 → 战斗 → 上浮 → 减压 → 死亡 → 葬礼 → 尸体回收 → 衰减 → 回港变卖/回购 → 材料 ＋ 金币 修缮升级**。元进度已从"建设值"换成"材料经济"（2026-06-01 基建地图 Phase A，见 §5 + quirk #50）。**多灯塔基地数据模型已就位**（Phase B，`profile.lighthouses` + home 灯塔 + `engine/lighthouses.ts`，但灯塔 inert——reveal/reach 留 Phase C；quirk #51）。
内容层 3 个 random zone（旧灯塔礁 / 蓝洞群 / 沉船墓园）。**洞穴 zone（蓝洞群）的下潜图已从层状 DAG 重写为洞穴"迷路图"**：双向边的连通图，有绕回的环 / 死路 / 多个最深点 / 入口+远端两个上浮口，由 `ZoneDef.mapShape='maze'` 选择；开阔海域（旧灯塔礁 / 沉船墓园）仍走层状 DAG。详见 §5 +「mapgen 回归」+ quirk #30–#34。出海点位已升级为 **港口海图（POI 选点）**：anchor 持久 + roaming 按 runsCompleted 刷新，两级门控（发现 flag / 抵达 upgrade），POI 带深度偏移·洋流·能见度修正（三种全部实装：深度→耗氧/减压、洋流→移动耗体力+氧、能见度→理智压力+黑暗盲航）。详见 §5 + quirk #27/#28。
TypeScript 类型干净，**11 个端到端 playthrough 脚本**全部通过（新增 `playthrough-chart.ts`），加上 **事件回归框架**（`scripts/event-runner.ts` + `scripts/playthrough-scenarios.ts`，目前 68 个 baseline scenario）+ **战斗回归框架**（`scripts/combat-runner.ts` + `scripts/playthrough-combat-scenarios.ts`，目前 9 个 baseline scenario）+ **事件 + 战斗双 dev 面板**（DEV 模式 Shift+D / Shift+C 互斥切换，详见 §3）。

---

## 2. 技术栈与运行

```bash
cd ~/Desktop/Blue
npm install
npm run dev        # 启 Vite dev server
npm run typecheck  # tsc --noEmit
npm run build      # 生产构建到 dist/
```

八个 playthrough 验证脚本（用 tsx 直接调引擎）：

```bash
npx tsx scripts/playthrough.ts            # 教学关 + 港口修缮 + 随机图 + 上浮（潜行路径）
npx tsx scripts/playthrough-combat.ts     # 教学关 + 战斗路径
npx tsx scripts/playthrough-corpse.ts     # 死亡 + 回港 + 尸体回收
npx tsx scripts/playthrough-decay.ts      # 衰减阈值 + 升级保鲜 + 海流冲走
npx tsx scripts/playthrough-upgrades.ts   # 升级购买 / 前置依赖 / hasUpgrade 门控 / startDive 加成
npx tsx scripts/playthrough-economy.ts    # 仓库合并 / Mira 收购单价 / 拒收剧情物 / outcome.lootValue
npx tsx scripts/playthrough-bluecaves.ts  # 蓝洞群 mapgen 行为 / canFreeAscend gate / 盲鳗 sanity 攻击 / eel_skin → Mira
npx tsx scripts/playthrough-wreckyard.ts  # 沉船墓园 mapgen / wreck 事件池 / 蛛蟹 solo+pair / lost_diver+watch portEvent 链 / crab_chitin → Mira
npx tsx scripts/playthrough-sensors.ts    # 微观双传感器 / clarity 回归（深水区 Phase 0a）：灯真相 / 黑水盲 / 声呐表象+spoof / power 摸黑 / 低 san 腐蚀 / signature
npx tsx scripts/playthrough-scenarios.ts  # 事件回归：跑 scenarios/*.json 根目录的全部 baseline scenario
npx tsx scripts/playthrough-combat-scenarios.ts  # 战斗回归：跑 scenarios/combat/*.json 的全部 baseline scenario
npx tsx scripts/playthrough-mapgen-scenarios.ts  # mapgen 回归：跑 scenarios/mapgen/*.json + 迷路不变量种子扫描 + 确定性
npx tsx scripts/playthrough-save.ts       # 存档序列化回归：Set round-trip + 版本迁移 + 损坏/未来版本退回
node scripts/verify-tutorial.mjs          # 数据图引用完整性 + 数据文件注册守卫（纯 JS，按目录扫描）
```

事件回归框架的两个 CLI 脚本（详见 §3 末尾的"事件回归框架"小节）：

```bash
npx tsx scripts/event-runner.ts <eventId> [--seed n] [--choice id]...   # 快速跑某事件
npx tsx scripts/event-runner.ts --from scenarios/foo.json               # 跑 JSON 场景
npx tsx scripts/event-runner.ts --list [--zone-tag cave]                # 列所有事件
npx tsx scripts/event-runner.ts --show <eventId>                        # 看事件结构
```

战斗回归框架的 CLI（详见 §3 末尾的"战斗回归框架（Phase 3）"小节）：

```bash
npx tsx scripts/combat-runner.ts <combatId> --action <id> --target <i> ...   # 多回合 quick mode
npx tsx scripts/combat-runner.ts --from scenarios/combat/foo.json            # 跑 JSON 场景
npx tsx scripts/combat-runner.ts --list                                      # 列所有 encounter
npx tsx scripts/combat-runner.ts --list-enemies / --list-actions
npx tsx scripts/combat-runner.ts --show <combatId> / --show-enemy <id> / --show-action <id>
```

每次改完代码或数据建议跑一遍这些脚本（八个 playthrough + scenarios + combat-scenarios + mapgen-scenarios + verify-tutorial）。`playthrough.ts` 有 ~12% RNG flake（quirk #18，与本次改动无关），挂了重试一两次确认。

---

## 3. 已实装的系统

### 状态机（GamePhase）

```
port → dive → combat → dive → ascent → resolution → port
                ↑                ↓
              corpse           funeral → port  ← 死亡分支
```

| Phase | 子状态 | 文件 |
|---|---|---|
| port | NPC 对话 + 海域选择 + 修缮升级 | `PortView.tsx` + `UpgradePanel.tsx` |
| portEvent | 港口侧 cutscene（捡回剧情物时自动触发） | `PortEventView.tsx` |
| dive.event | 事件选项页 | `EventView.tsx` |
| dive.nodeSelect | 节点图选择 2–3 路 | `NodeSelectView.tsx` |
| dive.rest | 休息节点 / 上浮口 | `RestView.tsx` |
| dive.corpse | 尸体回收 | `CorpseView.tsx` |
| combat | 战斗 | `CombatView.tsx` |
| ascent | 三种上浮模式 | `AscentView.tsx` |
| resolution | 上岸结算 | `ResolutionView.tsx` |
| funeral | 死亡结算 | `CorpseView.tsx :: FuneralView` |
| gameOver | 真正的 catastrophic 结局（目前没路径走到这） | `ResolutionView.tsx` |

### 引擎模块（`src/engine/`）

- `state.ts` — GameState 构造 + 不可变操作 + inventory 工具（`mergeIntoInventory` / `removeFromInventory` / **`countInInventory`**——升级账单 & Mira 回购共用）；`createNewRun` 接受 `bonuses` 注入派生加成；**`createHomeLighthouse()` + `HOME_LIGHTHOUSE_ID`**（家灯塔工厂，createInitialProfile + migrateSave 共用一个来源）；**存档层**：`serializeGameState` / `deserializeGameState` / `migrateSave`（按 `SAVE_VERSION` 迁移，**现 `SAVE_VERSION = 4`**：v1→v2 删 `buildingPoints`〔#50〕、v2→v3 种 home 灯塔〔#51〕、v3→v4 dockyard 迁灯塔〔#52〕。**深水区 Phase 0a 的 run.sensors/power 未发布故不迁、不 bump SAVE_VERSION**，靠 createNewRun 种默认 + 反序列化处 `?? 默认` 兜底〔#58〕）/ `saveGame` / `loadGame` / `clearSave`（localStorage，feature-detect；Set ↔ `{__set:[…]}` 的 replacer/reviver 让嵌套 Set 安全 round-trip——`lighthouse.builtUpgrades` 这类**嵌套在数组里的 Set 也自动 round-trip**；`shopStock` 是普通 Record，JSON 原生处理）。App.tsx 启动 `loadGame() ?? createInitialGameState()` + state 变化自动存 + gameOver `clearSave`
- `rng.ts` — 共享 `makeLcg(seed)`（Numerical Recipes LCG），chart.ts / eventScenario `withSeededRandom` / MapDevPanel 共用一份常数（quirk #22）
- `events.ts` — 事件解析、Outcome 应用、`performCheck` 概率检定、`tickTurns` 标准回合结算（含海图能见度理智压力 `visibilitySanityDrain` + **深水区 Phase 0a：灯耗电 `lampPowerDrain`**）；`evalCondition` 支持 `hasUpgrade`
- `dialog.ts` — NPC 对话树执行；从 `src/data/npcs/*.json` 多文件加载；`startDive` effect 自动从 profile 派生升级 bonuses 注入 run；`openShop` effect 切到 phase.shop；`openChart` effect 切到 phase.chart（出海点位现在走海图，不再由对话逐个列 zone）
- `chart.ts` — **港口海图（POI 选点）引擎**：`generateChart(profile)` 纯函数（anchor 持久 + roaming 按 `runsCompleted` 种子刷新，派生自 profile 不入存档）；`isPoiVisible` / `poiLockReason` / `isPoiDepartable` 两级门控（requiresFlags=发现、requiresUpgrade=抵达能力）；`describePoi` / `describeModifier`。LCG 与 `withSeededRandom` 同算法但走入参（quirk #22）
- `clarity.ts` — **微观 clarity（下潜内双传感器感知，深水区 Phase 0a）**，与 chart.ts 宏观 clarity 平行：`clarity(run)` 预览档（灯 full / 声呐 sonar / 摸黑 none）+ `sonarReturn(run,node)` 不可信表象（可被 evade/spoof/低 san 改写、≠ 真）+ `lampPreview(run,node)`（真相 / 极低 san 幻觉）+ `signature(run)`（被探测度，0b 消费）+ `lampPowerDrain`（灯耗电，清水因子 0）+ `lampEffective`/`sonarActive`。纯函数 + 防御读取 + 确定性哈希（不消耗 RNG）。tunables 集中文件顶（电池/ping 耗电/低 san 阈值/signature 权重，§8）。详见 quirk #58
- `zones.ts` — Zone 注册 + 事件池抽取（按 depth/tag/sanity/flag 过滤）
- `mapgen.ts` — 节点图生成，**按 `ZoneDef.mapShape` 分流两套生成器**：`generateLayeredMap`（层状 DAG，行为与重写前逐字节一致）+ `generateMazeMap`（洞穴迷路图：spanning tree + 弦边 → 双向连通图，有环/死路/多最深点，入口+远端两个 `ascent_point`）。`canFreeAscend` 仍单独控制上浮语义（与 mapShape 正交）。`GenOpts.depthOffset` 对两套都生效（先平移 depthRange，clamp depth≥0）。corpse pass 两套各一份（层状按中间层、迷路按非入口非出口节点），都支持 `GenOpts.targetCorpseId` 强制布点（打捞行会 Lv.2，绕过随机 + 深度窗）。新增纯函数 `analyzeMap(map)`——结构分析器（可达/双向/环秩/死路/最深点/局部极大/上浮口可达），dev 面板 + mapgen 回归共用
- `dive.ts` — startDive（接 `opts.depthOffset` 透传 mapgen）/ `startDiveFromPoi`（海图出海：createNewRun + distance 预耗氧 + diveModifier 落 run + depthOffset + 叙事）/ enterNodeSelection（**深水区 Phase 0a：按 `clarity(run)` 把每个 choice 的 preview 烤成 真相/声呐表象/盲 + 标 `clarity` 档**；给每个 choice 标 `visited`）/ **`setLight`/`pingSonar`**（切灯 / 发声呐 ping 耗电、需解锁、移动后消散；都经 `refreshSelection` 重算选点）/ moveToNode（含海图洋流移动消耗 `currentMoveCost`；移动后 ping 归 off；**迷路图重访已到过的节点时事件不重播**——退化成安静水域）/ restAtNode / **breatheAtAirPocket**（气穴换气 +氧+理智，一次性，写 run.activeFlags air_used:*）/ **campAtNode**（短/长扎营，tickTurns 后叠加恢复）。迷路图双向边 → getNextChoices 含来路，玩家可回头
- `ascent.ts` — 上浮方案 + 减压病 I/II/III/IV 型判定；`computeLootValue` 用 `miraOfferFor` 估战利品潜在价值；`isAscentBlocked(run)` 检测封闭水域（`zone.canFreeAscend=false` 且不在 ascent_point 节点上），AscentView 用它锁 normal/rushed，emergency 仍可用作"凿穿洞顶"
- `combat.ts` — 战斗状态机、行动消费、敌人 AI、姿态、撤退逻辑
- `death.ts` — executeDeath / DeathRecord 生成 / ageAndDecayDeaths / findRecoverableCorpse / recoverFromCorpse / 衰减阈值；`isRecoverableCorpse` + `listRecoverableCorpses(deaths, zoneId)`（海图选目标 + mapgen 强制布点共用判据）
- `upgrades.ts` — 升级注册表 / `canPurchase` / `purchaseUpgrade` / `getUpgradeBonuses` 派生加成聚合。**`cost` 现为双资源 `UpgradeCost{ materials: MaterialCost[]; gold }`（基建地图 Phase A）**：`canPurchase` 先逐条材料 `countInInventory >= qty`（不足 → `notEnoughMaterials` 带 `shortfall` 缺口清单），再查 `bankedGold >= gold`（不足 → `notEnoughGold` 带 `goldShort`）——材料先于金币，所以"只有钱没有料"落 notEnoughMaterials（金币买不了升级）；`purchaseUpgrade` 逐条 `removeFromInventory` + `bankedGold -= gold`。helper `materialShortfall` / `describeUpgradeCost`（log+UI 共用账单格式）。`getUpgradeBonuses` 不变
- `lighthouses.ts` — **灯塔基地引擎（每灯塔设施升级，基建地图 Phase B）**，与全局 `upgrades.ts` 平行、互不污染：`getLighthouseTracks`/`getLighthouse`/`getBuiltLevelInTrack` + `canBuildAt`（alreadyBuilt/needsPrev/needsLighthouseLevel/notEnoughMaterials/notEnoughGold，账单复用 `upgrades.ts::materialShortfall`+`describeUpgradeCost`）+ `buildAtLighthouse`（扣材料+金币，**只写目标灯塔的 builtUpgrades 不污染别座**）+ `getLighthouseBonuses`（聚合 lightRadiusBonus/reachReduction）+ `nearestLighthouse`/`distanceBetween`（最近灯塔距离工具）。**Phase B 灯塔 inert——这些函数有回归但游戏流程还没调用；reveal/reach 由 Phase C 的 chart.ts/dive.ts 消费**。详见 quirk #51
- `items.ts` — `getItemDef` 集中索引；death/combat/CorpseView 三处旧 `new Map(ITEM_INDEX)` 已切到这里
- `portEvents.ts` — 回港 cutscene 调度：扫 inventory 找 `item.story.triggersEventId`，配合 `flag.event_done.<id>` 防重播
- `port.ts` — `handleReturnToPort`（合并 run.inventory → profile.inventory + 触发 cutscene + **回港清空 `shopStock` = 补满 Mira 备货**）+ Mira **收购侧**（`miraOfferFor` / `listMiraSellables` / `sellItemToMira` / `isSellableToMira`，MIRA_BUY_RATIO = 0.8，所有材料可卖）+ Mira **出售侧/回购**（基建地图 Phase A）：`isBuyableFromMira`（仅 T1/T2 材料）/ `miraBuyPriceFor`（=卖价×`MIRA_BUY_MARKUP` 2，恒>卖价）/ `maxShopStockFor`（`SHOP_STOCK_BY_TIER` T1=8·T2=4）/ `getShopStock`（profile.shopStock 缺项=懒默认满货）/ `listMiraBuyables` / `buyFromMira`（买 min(qty, 余货, 金币能买的)；T3/T4 / 买不起 / 售罄 → no-op）。详见 quirk #50
- `eventScenario.ts` — **事件回归框架**核心 API（`runEventScenario` / `listAllEvents` / `describeEvent` / `withSeededRandom`）。给定 eventId + 自定义起始 state，能走完该事件及其 triggerEventId 链，输出 JSON 或文本，绕开 mapgen 随机抽取。详见本节末尾"事件回归框架"。

### 数据（`src/data/`）

- `items.json` — **22 件物品**，全部标注 `decay` 档位（新增：brass_pocket_watch / waterlogged_logbook / crab_chitin / brass_fitting / barracuda_jaw / cave_octopus_beak / lantern_gland / grouper_maw）。**12 件 material 全部标 `tier 1–4`（基建地图 §2.2 深度分档）**：T1 coral_shard/shark_tooth/lobster/canned_food/old_fishing_net · T2 brass_fitting/barracuda_jaw/crab_chitin/grouper_maw · T3 cave_octopus_beak/eel_skin · T4 lantern_gland。tier 驱动升级账单稀有度门控 + Mira 回购门控（仅 T1/T2 可买回）。`lantern_gland`（冷光腺，material，sellPrice 16，uncommon，durable——离水过夜不灭不腐的 uncanny 触感）是沉灯水母掉落的天然身体部位，走 Mira（异物收购）。`brass_fitting`（黄铜配件，material，sellPrice 14，durable）是旧灯塔礁打捞向材料，走 Mira 收购；`cave_octopus_beak`（章鱼角喙，material，sellPrice 13，durable）是蓝洞章鱼掉落的天然物，走 Mira；`grouper_maw`（石斑鱼鳔，material，sellPrice 15，T2，**organic**——与 lobster/eel_skin 同档，得趁鲜卖）是礁底石斑鱼掉落的天然物，走 Mira
- `actions.json` — 8 个战斗行动
- `npcs/aldo.json` — Aldo 对话树。教学前 `depart_east`（资格潜水）；教学后出海统一走 `open_chart`（→ openChart effect → 海图）。**旧的逐 zone depart 选项 + 蓝洞/沉船 warning 节点已删**，warning 文案搬进 `chart_pois.json` 的 POI blurb
- `npcs/mira.json` — Mira + banter；`open_shop` 选项触发 `openShop` 切到 shop phase
- `chart_pois.json` — **海图 POI 数据**：`anchors`（每 zone 一个持久点）+ `roamingTemplates`（机会点模板，generateChart 按 runsCompleted 抽取）。字段：zoneId / distance / requiresFlags / requiresUpgrade / modifier（depthOffset 已实装；current·visibility 暂叙事+接口）
- `enemies/reef_shark.json` — 暗礁鲨（HP 32 / armor 0 / 主动撤退）+ 教学战斗 encounter
- `enemies/blind_eel.json` — 盲鳗（HP 18 / 三种攻击：扑咬 / 缠绕含 sanityDamage / 低频共振纯 sanity）+ `combat.blind_eel_solo`
- `enemies/wreck_spider_crab.json` — **沉船蛛蟹**（HP 22 / armor 2 / evasion 3 / threat 5 / territorial / aggressor / 两种攻击：钳夹 w=3 / 甲壳冲撞 w=1）+ `combat.wreck_spider_crab_solo` + `combat.wreck_spider_crabs_pair`（**项目首个多体战斗 encounter**）
- `enemies/reef_barracuda.json` — **梭鱼**（HP 16 / armor 0 / evasion 4 / threat 7 / predatory 不撤退 / 两种攻击：突进撕咬 [5,9] w3 + 掉头掠咬 [3,6] w2）+ `combat.reef_barracuda_solo` —— **reef zone 首个原生战斗 encounter**；玻璃大炮（全场最低 HP + 最高单击），掉 `barracuda_jaw`（material，sellPrice 12，→ Mira）
- `enemies/cave_octopus.json` — **洞穴章鱼**（HP 26 / armor 1 / evasion 3 / threat 6 / territorial 低血撤退 / aggressor / 三种攻击：缠臂 [3,5] w3 + 角喙 [5,8] w1 + 喷墨 0 物理含 sanityDamage [2,4] w1）+ `combat.cave_octopus_solo` —— **蓝洞群深段（40-55m）首个原生战斗 encounter（盲鳗之外）+ 蓝洞首个 realistic-tone 战斗**；physical 攻坚型「深处闸门」（仅次教学暗礁鲨的最厚 HP），3-4 turn 消耗战，掉 `cave_octopus_beak`（material，sellPrice 13，天然物→ Mira，符合 quirk #44）。详见 quirk #46
- `enemies/drowned_lantern.json` — **沉灯水母**（HP 24 / armor 1 / evasion 1 / speed 4 / threat 6 / **tier cosmic** / hostility predatory 不撤退 / aiPattern caster / 两攻击：脉光〔纯 sanity [4,7] w3 主攻〕+ 曳丝〔physical [2,4] + sanity [1,2] w2〕）+ `combat.drowned_lantern_solo` —— **沉船墓园第二只敌人（蛛蟹之外，补齐墓园最长线的敌人缺口）+ 项目首只 cosmic-tier 敌人 + 首只 sanity-主导敌人**。设计＝**「理智消耗战」**：slow/tanky（evasion 1 易命中、armor 1 + hp 24 ≈ knife_slash 3 刀杀），但每回合主攻是纯 sanity 脉光——拖得越久脑子越空。与盲鳗（hp18 evasion4 物理主导·sanity 点缀的快速 flanker）/ 章鱼（hp26 纯物理 bruiser）正好互补：**它是「会烧理智的闸门」**。掉 `lantern_gland`（天然身体部位→ Mira，符合 quirk #44 同蟹甲/梭鱼颌/章鱼喙）。触发事件 `wreck_graveyard.drifting_light` 只挂 `[wreck]` tag（按 quirk #47 跨 zone 共享到灯塔礁 25m+，但「漂着的冷光」在礁底沉船间不出戏，且呼应 reef.lantern_glow『下面的光』）。详见 quirk #48
- `enemies/reef_grouper.json` — **石斑鱼**（HP 30 / armor 2 / **evasion 1（全场最低，hit 0.91 几乎必中）** / speed 6 / threat 4（低，不追）/ tier realistic / hostility territorial（hp≤30% 撤退）/ aiPattern observer / 两攻击：吞口〔gulp physical [6,10] **全场最高单击** w2〕+ 侧撞〔buffet physical [3,6] w3〕）+ `combat.reef_grouper_solo` —— **reef zone 第二只原生战斗 encounter（梭鱼之外）+ territorial『礁檐守卫』原型**。设计＝**低闪避·必中·厚甲·最重单击但 opt-in 的重装墙**：与梭鱼（hp16 glass cannon 速杀 predatory）正相反，threat 低不追、触发事件给 sneak/leave 两个非战斗出口（territorial 玩法签名）；4-turn 消耗战（对照章鱼 cave aggressor bruiser 3-4 turn）。掉 `grouper_maw`（石斑鱼鳔，material T2 organic，天然物→ Mira，符合 quirk #44）。触发事件 `reef.coral_overhang` 只挂 `[reef]`。详见 quirk #53
- `events/tutorial.json` — 6 个教学事件
- `events/reef.json` — 30 个浅海/中海/深海事件（含 reef.barracuda / reef.coral_overhang 战斗触发）（reef / wreck / cave）；`cave.*` 事件会同时在蓝洞群深层池里出现，`wreck.*` 事件会同时在沉船墓园里出现（详见 quirk #17 / #19）。**旧灯塔礁专属 `reef.*` 事件（2026-05-30 周末内容 pass 补的灯塔线）**：`flooded_stair`（灌满水的旋梯 realistic·stamina check·brass_fitting loot）/ `keepers_footlocker`（看守人的箱子 realistic·oncePerRun·lore.old_lighthouse.keeper）/ `bleached_garden`（白化珊瑚 uncanny·loot+sanity 无 check）/ `fog_bell`（雾钟 uncanny·oncePerRun·stamina check + lore.old_lighthouse.bell）/ `lantern_glow`（下面的光 cosmic·oncePerRun·sanity check + lore.old_lighthouse.the_light）——给旧灯塔礁补齐 realistic/uncanny/cosmic 全档，10–42m 全覆盖，全部只挂 `reef`/`shallow,reef` tag（quirk #19）。**深水段 cave.*/wreck.*（2026-05-30 第二个周末 pass）**：`wreck.silted_hold`（realistic·45-60m·stamina·brass_fitting/canned_food）/ `cave.halocline`（realistic·48-60m·盐线下潜·stamina）/ `wreck.porthole`（uncanny·50-60m·oncePerRun·sanity·brass_fitting·lore.deep_water.the_window）/ `cave.blue_floor`（cosmic·52-60m·oncePerRun·sanity·lore.deep_water.cold_light）——填 45-60m 深段（旧灯塔礁 60m 事件池 1→5），跨 zone 共享到蓝洞群（cave.*）/ 沉船墓园（wreck.*）；**wreck.* 掉人造物 · cave.* 掉天然物，避免另一个 zone 出戏（quirk #44）**。**reef 26-44m 中段 uncanny（2026-05-31 周日敌人 pass）**：`reef.lighthouse_lens`（uncanny·30-44m·灯室的镜·`sanity vs 48`·pry_brass 掉 brass_fitting / sight_along 看那道恒定指向礁坡下方的折射亮线·lore.old_lighthouse.the_lens）——填 reef 26-44m 中段 uncanny 缺口（此前最深 reef-only uncanny 是 fog_bell 到 38m），只挂 `[reef]` tag 隔离在灯塔礁（quirk #19，loot 故可用灯塔黄铜不犯 quirk #44），延续灯塔『下面的光』母题但保持 uncanny（物理镜的反常），刻意不触发 d_reveal。**reef realistic 探索密度（2026-05-31 周日第四个 pass）**：`reef.shelf_break`（realistic·30-44m·礁壁的断口·开阔水域的断崖边·`descend_wall` stamina vs12 下探够珊瑚→coral_shard+lobster chance / `skirt_edge` 沿边安全·**填 reef 26-44m realistic 缺口**，此前该段只有 barracuda 战斗触发器 + lobster_hole 到 35m）+ `reef.urchin_barren`（realistic·16-30m·海胆滩·`pick_through` 无 check 在碎礁翻找 coral_shard+sanity-1 / `move_on`·补 reef 浅中段 realistic 密度，生态死寂的克制不安——海胆随影子转刺是真行为，不出 realistic）——均只挂 `[reef]` 隔离在灯塔礁，coral_shard 天然 loot。**reef 浅段 fresh shallow-wrongness（2026-06-02 内容 pass，作者选「全新浅水错位」非灯塔线）**：`reef.silversides`（uncanny·10-24m·一墙银鱼·sanity vs46+lore.reef_shallows.the_gap·coral loot）/ `reef.sun_net`（**cosmic·14-25m·oncePerRun·沙上钉死不动的太阳光网·项目首个浅段 cosmic**·sanity vs50+lore.the_still_square·loot-free）/ `reef.warm_seam`（uncanny·12-24m·礁底缝上来的血温暖水·no-check+lore.the_warm_crack·coral chance）——全 `[shallow,reef]`（只灯塔礁 0-25m 吃 shallow，故隔离），新 `lore.reef_shallows.*` 命名空间，三条不同感官（动物/光/温度）都轻触『下面』但刻意不触发 d_reveal。**reef 第二战斗触发器 `reef.coral_overhang`**（realistic·20-38m·`[reef]`·拔刀逼出石斑鱼→`combat.reef_grouper_solo` / sneak_larder stamina vs13 避战取洞底 coral+lobster / leave_ledge 无代价退——territorial opt-in 三选）。**深段 realistic（cross-zone，2026-06-02）**：`cave.sump_pool`（realistic·46-60m·`[cave]`·回水潭·coral）+ `wreck.chain_locker`（realistic·44-60m·`[wreck]`·锚链舱·brass/canned）——填 60m 段（5→7），守 quirk #44/#47。详见 quirk #53。**深水伏笔 mid（续三，2026-06-02）**：`reef.no_bottom`（cosmic·32-44m·oncePerRun·`[reef]`·断口外空蓝的『深处拉力』·sanity vs50→lore.reef_deep.no_bottom·loot-free·**reef 首个非灯塔线 cosmic-mid**、与 realistic shelf_break 同地标〈断口〉配对，详见 quirk #55）。**realistic 密度收尾（续四，2026-06-02）**：`reef.sand_channel`（realistic·34-44m·`[reef]`·礁脊间平行沙沟+来回涌·`work_groove` stamina vs12 顶涌摸沟底→coral_shard+lobster chance / `near_ledge` 沟口礁檐摸一把 / `cross_over` 沟脊上方横过·**填 reef-only 深中段 realistic 缺口**〈此前仅 shelf_break 触 44m，lobster_hole→35/urchin_barren→30〉，与 shelf_break 同『断口/沙沟』地标家族但机制不同〈横涌 vs 垂壁〉，详见 quirk #56）。**深水伏笔深段（续五，2026-06-02）**：`cave.false_beacon`（cosmic·46-60m·oncePerRun·`[cave]`·loot-free·跟 cave.blue_floor 同深段 cave cosmic 簇·超出自家灯塔光照边界却有一点暖得正是灯塔颜色的光稳稳悬着＝**mimic 假信标直接深段预告**·承中段 the_glow、接 deep_water cold_light/the_window『下面的光』暗线·新 `lore.deep_water.the_false_beacon`·account_for_it sanity vs55 双分支 + swim_for_it『缺氧照游』代价，详见 quirk #57）
- `events/blue_caves.json` — 23 个蓝洞事件（入口/中段/深处；2026-05-30 补 12-25m 浅段：窄口 realistic check + 另一串气泡 uncanny lore）；含分岔水道（迷路 sanity 检定）、可扎营的礁台、钟乳石厅、蓝色水帘、沉默的厅、盲鳗 lair。**深段战斗+cosmic（2026-05-30 第四个周末 pass）**：`octopus_den`（贝壳堆 realistic·40-55m·拔刀 / 压灯慢退 stamina check / 绕开 三选 → `combat.cave_octopus_solo`，章鱼遭遇触发器，参照 reef.barracuda）+ `late_shadow`（慢半拍的影子 cosmic·45-55m·sanity check + lore.bluecaves.late_shadow）——给蓝洞深段补首个 realistic 战斗钩子 + 一个 cosmic 厅事件，都只挂 `cave` tag（跨 zone 共享到旧灯塔礁 cave 层，与盲鳗同模式）。**中段 uncanny/cosmic（2026-05-31 周日第二个 pass，填 30-45m 空白）**：`sounding_line`（测深绳 uncanny·28-40m·stamina vs13 收绳·lore.the_line·从黑里收一根没人收回的测深绳，断口是从下面割的）/ `blind_school`（白色的鱼 uncanny·30-42m·oncePerRun·无 check sanity·lore.blind_school·无眼洞鱼挤成球用侧线"看"你）/ `falling_up`（往上落的雪 cosmic·32-45m·sanity vs50·lore.wrong_down·碎屑往上落，洞里"下"的方向不在下面）/ `thick_water`（变稠的水 cosmic·36-46m·无 check sanity·lore.thick_water·越往深水越稠到不肯再当水）——补蓝洞 30-45m 中段（此前几乎全 realistic，cosmic 只在 45m 以下 late_shadow/silent_chamber），+2 uncanny +2 cosmic，蓝洞 cosmic 2→4。全 loot-free（守 quirk #44：falling_up/thick_water 触 45-46m 会经 `[cave]` tag 漏进旧灯塔礁 cave 层，无人造物不出戏），只挂 `[cave]` tag（quirk #19），lore 全在 `lore.bluecaves.*`，延续"先来者 + 深处"母题但**刻意不触发 flag.d_reveal**。**12-25m 浅段 cosmic（2026-05-31 周日敌人 pass，填浅段 cosmic 空白）**：`the_narrowing`（cosmic·14-25m·oncePerRun·回头的路·洞口那片蓝的出口在你不盯着时会缩小·stare_at_it 无 check / mark_the_rim sanity vs50 / dont_look·lore.bluecaves.the_way_out）——把『方向/感知错乱』母题（falling_up/thick_water 都在 32m+ 深段）下放到还看得见真出口的浅段，反而更不安；此前最浅 cosmic 是 32m falling_up。只挂 `[cave]`（深度 14-25 与灯塔 cave-tag 45m+ 不重叠 → 实际仅蓝洞），loot-free，不触发 d_reveal。**12-25m 浅段 realistic 密度（2026-05-31 周日第四个 pass，针对 quirk #20 entrance_light 过曝）**：`bluecaves.breakdown_pile`（realistic·16-26m·塌石堆·顶板塌方堆死半条水道·`climb_over` 翻石堆 stamina-6 / `thread_gap` 钻渗冷水缝 氧-2+coral_shard chance / `back_to_mouth`·无 check 纯资源取舍，参照 reef.current_drag）——蓝洞浅段此前 realistic 只 entrance_light/tide_mark/squeeze，加一个 caving 障碍稀释 entrance 过曝；coral_shard 天然 loot 守 quirk #44（16-26m `[cave]` 不漏进灯塔 45m+）。**深水伏笔 mid（续三，2026-06-02）**：`bluecaves.the_glow`（uncanny·30-44m·`[cave]`·黑里一点无法溯源、一拐就移到别处亮起的光＝『无灯之光』mimic 假信标伏笔·go_toward→lore.bluecaves.the_glow / douse_lamp sanity vs48 给『会发光的虫子』平淡解释·loot-free·加厚『有人在下面』暗线，详见 quirk #55）。**realistic 密度收尾（续四，2026-06-02）**：`bluecaves.lobster_crack`（realistic·26-44m·`[cave]`·侧壁横缝里够礁虾·`reach_in` stamina vs13→coral_shard+lobster chance / `snap_coral` 只掰珊瑚 / `leave_crack`·**填蓝洞中段 realistic 缺口**〈此前中段 realistic 仅 forked_passage/makeshift_ledge/stalactite_hall 三导航地标、无觅食 beat〉，天然 loot 守 quirk #44，详见 quirk #56）
- `events/wreck_graveyard.json` — **21 个沉船墓园事件**：12 个 dive（船舱入口 / 塌过道 stamina check / 缠脚海草 stamina × oxygen × 刀三选 / 失踪潜水员遗体 lore+物 / 罗盘室怀表 sanity check / 引擎室共鸣 sanity 二次施压 + 刀敲触发蛛蟹双战 / **写字板 `dive_slate` uncanny·22-40m·oncePerRun·lore.wreck_graveyard.the_slate**——2026-05-30 第四个周末 pass 补的墓园叙事，「敲船壳的节奏」呼应 engine_room_hum / silent_chamber 敲击母题，刻意不触发 d_reveal）+ 2 个 portEvent cutscene（`pocket_watch_log` + `logbook_read`）。**2026-05-31 周日 pass 补 4 个 dive（cosmic 1→3 + uncanny 加厚）**：`cold_stores`（uncanny·26-42m·stamina vs13·canned_food/old_fishing_net 人造 loot·"码得太齐的罐头"）/ `hull_handprints`（uncanny·24-40m·oncePerSave·sanity vs48·lore.handprints·玻璃里侧、从内侧按上的手印，区别于 lost_diver 的尸体）/ `the_knocking`（cosmic·30-48m·oncePerRun+oncePerSave·sanity vs55 听 / 回敲违禁分支·lore.the_knocking·是 dive_slate『不要回敲』的付现，延续敲击母题）/ `the_open_door`（cosmic·40-50m·oncePerRun·sanity vs55·门里是开阔黑水+远处冷光+一呼一吸的水流·lore.the_door·接『深处有光』暗线但不触发 d_reveal）——全挂 `[wreck]`、loot 只人造物（quirk #44/#47）。**2026-05-31 周日敌人 pass 补 1 个 dive（沉灯水母触发器）**：`drifting_light`（cosmic·34-50m·oncePerRun·漂着的光·draw_knife→`combat.drowned_lantern_solo` / hold_still 关灯避战 `sanity vs 50` / back_away·lore.drowned_lantern）——墓园第二个原生战斗钩子（参照 octopus_den / engine_room_hum / reef.barracuda），冷光意象呼应 reef.lantern_glow / lore.deep_water.cold_light『下面的光』暗线但不解释、不触发 d_reveal。**realistic 内舱密度（2026-05-31 周日第四个 pass）**：`wreck_graveyard.galley`（realistic·20-34m·伙房·搪瓷杯/铸铁炉/泡胀顶死的存粮柜·`force_locker` stamina vs13 撬柜→canned_food+old_fishing_net chance / `sift_stove` 无 check 炉膛淤泥摸 canned_food chance / `back_out`）——给墓园补一个生活舱内饰质感（区别于 cabin_entrance 井口 / collapsed_passage 结构挤缝 / tangling_kelp 海草），人造 loot 守 quirk #44/#47（跨 zone 共享到灯塔礁 25m+ 不出戏）。**浅段 fresh-wrongness（2026-06-02 续二，deep-game vision 伏笔层，全 `[wreck]`·18-25m·叙述永不交底·不触发 d_reveal）**：`the_other`（uncanny·跟你同步的潜水员·sanity vs48·lore.wreck_graveyard.the_other·loot-free·伏笔 corpse-wearer）/ `all_facing`（**cosmic·oncePerRun·沉船船首全朝塌口深水·sanity vs50·lore.all_facing·墓园首个浅段 cosmic·伏笔深处拉力**·loot-free）/ `full_nets`（uncanny·拖网船的网被底下某物往深处拽·`cut_upper` stamina vs13→old_fishing_net+canned 人造 loot / `follow_down`→lore.full_nets·伏笔深处『渔夫』）——填墓园 18-25m 浅段 uncanny/cosmic 缺口（此前该段全 realistic + dive_slate/handprints 擦边），详见 quirk #54。**深水伏笔 mid（续三，2026-06-02）**：`wreck_graveyard.no_bubbles`（uncanny·26-42m·`[wreck]`·背对你干活却不冒一个泡的潜水员＝corpse-wearer 伏笔+可读 tell〈不呼吸〉·watch sanity vs48 / rap_tank→lore.wreck_graveyard.no_bubbles·**无 combat**·loot-free·承浅段 the_other，详见 quirk #55）。**realistic 密度收尾（续四，2026-06-02）**：`wreck_graveyard.deck_cargo`（realistic·18-26m·`[wreck]`·后甲板捆死的整船货+垮货网·`cut_lashings` stamina vs13 撬木箱→canned_food/old_fishing_net / `pick_spillage` 散货里捡→brass_fitting / `leave_cargo`·**填墓园浅段 realistic 缺口**〈#54 把 18-25m 堆成 uncanny/cosmic 后补无错位打捞质感平衡 tone〉，人造 loot 守 quirk #44/#47，详见 quirk #56）。**深水伏笔深段（续五，2026-06-02）**：`wreck_graveyard.the_wearer`（cosmic·44-56m·oncePerRun·`[wreck]`·loot-free·旧式铜盔潜水服无灯无泡却知道你在哪、招手引你＝**corpse-wearer 穿尸体引诱直接深段预告**·承浅段 the_other / 中段 no_bubbles·埋可读 tell〈无灯/无泡/老装备/机械招手〉·go_to_him 反用本作对死者的温柔·新 `lore.wreck_graveyard.the_wearer`·read_him sanity vs55 双分支·**无 combat** 守 2/zone，详见 quirk #57）
- `zones.json` — 东礁（教学线性）+ 旧灯塔礁（随机图）+ **蓝洞群**（随机图，`canFreeAscend: false`）+ **沉船墓园**（随机图，开阔水域，6 层 18–50m，zoneTags=["wreck"]，`canFreeAscend: true`）
- `lighthouse_upgrades.json` — **灯塔设施升级（基建地图 Phase B）**：`tracks[].upgrades[]`，结构镜像 upgrades.json 的 lines（含双资源 `cost`），建成写进 `lighthouse.builtUpgrades`。当前只一条占位轨「信标光源」（lhtrack.beacon lv1/lv2，给 lightRadiusBonus/reachReduction）——真正的设施升级随 Phase C reveal 一起填。`engine/lighthouses.ts` 单文件 import（非目录，不触发 verify-tutorial 的目录注册守卫；但 verify-tutorial §4b 校验其账单材料 id）
- `upgrades.json` — 船坞 / 气瓶库 / **打捞行会**（3 级，含保鲜系数）。**5 个升级 `cost` 现为双资源 `{ materials:[{itemId,qty}], gold }`（基建地图 Phase A，起始账单见 SPEC §2.3）**：dockyard.lv1=coral×6+net×3+20金 / tankhouse.lv1=shark×4+lobster×4+25金 / salvage.lv1=coral×5+brass×3+30金 / salvage.lv2=brass×4+chitin×3+beak×2+70金 / salvage.lv3=beak×4+eel×3+gland×1+150金（等级越高 tier 越深+金币越多，强制下深）

### 事件回归框架（Phase 1）

**目的**：随着 EVENT_DB 越来越大，没法靠跑 random playthrough 去逼游戏触发某个特定事件来测试它的某个分支。这套框架让你直接以 (eventId × 自定义起始 state × seed × 选择序列) 调用引擎，绕开 mapgen 抽取。

**两层结构**：

- `src/engine/eventScenario.ts` —— **纯引擎层 API**。不依赖 UI / Node fs / console，可被 Phase 2 的网页 dev 面板复用。导出 `runEventScenario(input)` / `listAllEvents(filter)` / `describeEvent(id)` / `withSeededRandom(seed, fn)`。
- `scripts/event-runner.ts` —— **CLI 包装**，handwritten argv 解析（无外部 dep）。

**核心机制**：

- **RNG seed**：`withSeededRandom(seed, fn)` 在 fn 期间临时 patch 全局 `Math.random` 为 LCG（Numerical Recipes 参数），fn 跑完恢复。因为 `Math.random()` 散布在 events / combat / mapgen / death 多处，patch 全局比改每个调用点干净。**注意**：runEventScenario 跑的时候不要在同进程并发跑别的引擎代码（quirk #22）。
- **战斗边界**：碰到 `triggerCombatId` 不自动打，记录到 `summary.combatTriggered` 后停步。战斗的回归归 `playthrough-combat.ts` / 战斗专项脚本管。
- **chain 模式**：`'follow'`（默认）跟着 `outcome.triggerEventId` 走多步链路；`'isolated'` 跑一步即停。
- **可见性**：`visibleIf` 严格生效，同时把不可见的选项也列出来并标明被哪个 Condition 挡住（调 visibleIf 时这是核心需求）。

**CLI 用法**：

```bash
# 1. 快速模式
npx tsx scripts/event-runner.ts bluecaves.silent_chamber \
    --sanity 70 --depth 50 --seed 42 --choice stay_a_moment

# 多个 --choice 表示走链
npx tsx scripts/event-runner.ts tutorial.descent \
    --choice continue --choice sneak --choice stealth_grab

# 2. 从 JSON 文件读 scenario（推荐：进 git 持久化）
npx tsx scripts/event-runner.ts --from scenarios/bluecaves_silent_chamber__low_sanity_success.json

# 3. 从 stdin 读 JSON
echo '{"eventId":"bluecaves.silent_chamber","stats":{"sanity":70},"choices":["stay_a_moment"]}' \
    | npx tsx scripts/event-runner.ts --in -

# 4. 辅助命令
npx tsx scripts/event-runner.ts --list                   # 列所有事件
npx tsx scripts/event-runner.ts --list --zone-tag cave   # 按 tag 过滤
npx tsx scripts/event-runner.ts --show bluecaves.silent_chamber  # 看结构

# 输出格式：默认文字，--out json 给程序用
npx tsx scripts/event-runner.ts <id> --out json
```

**场景库 `scenarios/*.json`**：

- 命名规则：`<event_id_点改下划线>__<variant>.json`，例如 `bluecaves_silent_chamber__low_sanity_success.json`
- 一个文件就是一份 `ScenarioInput`（外加可选的 `_comment` 和 `expect` 字段）。`expect` 给 `scripts/playthrough-scenarios.ts` 做断言：`steps` 步数、`finalPhase`、`loreAdded` 子集、`flagsAdded` 子集、`statsDelta` 严格相等、`checkPassed` 布尔、`combatTriggered` 字符串/null。
- 目前 68 个 baseline scenario（2026-06-02 三内容 pass #53/#54/#55 共 +19→68，详见各 quirk；以下为更早的 +6 记录）（**2026-05-31 第四个 pass（realistic 探索密度）+6**：`reef_shelf_break__descend_success`〔reef 中段 stamina check 通过 + coral_shard〕 + `reef_shelf_break__skirt_edge`〔no-check 安全资源路径〕 + `reef_urchin_barren__pick_through`〔no-check loot+sanity〕 + `wreck_graveyard_galley__force_locker_success`〔wreck stamina check 通过 + 人造 loot〕 + `wreck_graveyard_galley__sift_stove`〔no-check loot〕 + `bluecaves_breakdown_pile__climb_over`〔no-check 资源取舍 stamina-6/oxygen-1〕——全 realistic，stamina-check 只锁 success 分支（满 stamina→0.95 clamp，seed 1 确定性过；低 dc 的 stamina fail 无法 clamp 到 0.05，故不做 fail baseline，同既有 reef.flooded_stair / wreck.silted_hold 套路，详见 quirk #43/#49）；**2026-05-31 敌人 pass +4**：`wreck_graveyard_drifting_light__draw_knife_combat`〔战斗边界→沉灯水母〕 + `wreck_graveyard_drifting_light__hold_still_success`〔cosmic 避战 sanity check〕 + `reef_lighthouse_lens__sight_along_success`〔reef uncanny sanity check + lore〕 + `bluecaves_the_narrowing__stare_at_it`〔蓝洞浅段 cosmic 无 check + lore〕；以下为既有：蓝洞群 5 个 + 蓝洞中段 uncanny/cosmic 5 个〔sounding_line haul_up_success〔stamina check 通过〕 + blind_school swim_into〔无 check uncanny〕 + falling_up follow_up_success/follow_up_fail〔cosmic sanity check 双分支〕 + thick_water push_deeper〔无 check cosmic〕〕 + 蓝洞深段战斗/cosmic 4 个〔octopus_den draw_knife 战斗边界 + octopus_den wait_success stamina check + late_shadow watch_success/watch_fail cosmic 双分支〕 + 教学结尾 1 个 + 沉船墓园 4 个 + 墓园 dive_slate 1 个 + 旧灯塔礁 6 个 + 深水段 5 个 + 墓园周日 pass 5 个（cold_stores force_hatch / hull_handprints look_closer / the_knocking listen + knock_back 双 baseline / the_open_door look_in），覆盖：基础 loot / sanity check 通过 / sanity check 失败 / stamina check 通过 / cosmic sanity check 成功+失败两分支 / 多属性同时变化 / 无 check 的 loot+sanity / portEvent-style 事件 / 战斗触发边界 / 剧情物拾取链 + lore）。旧灯塔礁 6 个：`reef_flooded_stair__pry_grate_success` / `reef_keepers_footlocker__open` / `reef_bleached_garden__break_piece` / `reef_fog_bell__listen` / `reef_lantern_glow__descend_success` / `reef_lantern_glow__descend_fail`。深水段 5 个：`wreck_silted_hold__pry_hoops_success`（stamina check 通过）/ `cave_halocline__feel_wall_success`（stamina check 通过）/ `wreck_porthole__look_through_success`（uncanny sanity check 通过 + lore）/ `cave_blue_floor__dig_success`（cosmic sanity check 通过 + lore）/ `cave_blue_floor__dig_fail`（cosmic 失败 -12 sanity + oxygen -5）。
- **添新事件时建议至少加 1 个 baseline scenario 进 scenarios/**，覆盖典型路径——保证以后修改不破坏既有 outcome 行为。

**回归运行**：

```bash
npx tsx scripts/playthrough-scenarios.ts
# ✓ playthrough 完成
# 全部场景通过（6/6）
```

**Phase 2 已实装（2026-05-27，本 session）**：网页内 dev 面板，挂在 `src/ui/dev/`。

入口：开发模式下按 **Shift+D** 切换全屏覆盖层（Esc 关闭）。仅 `import.meta.env.DEV`
才挂载（App.tsx 用 `lazy()` + DEV 守卫；`npm run build` 后 dist JS/CSS 里搜不到
任何 `EventDevPanel` / `runEventScenario` / `dev-panel` 字串——Vite 把 false 分支的
dynamic import 当 dead code 消除了，整个 `src/ui/dev/` 不进 prod 包）。

三栏布局：

- **左**：事件下拉/title 过滤 + zoneTag 过滤；点击切到该事件，下方显示 `describeEvent`
  的 optionSummary（每个选项的 check / outcome / triggerEventId 一目了然）
- **中**：状态编辑表单
  - stats：勾选覆写 + 滑动条 + 数字输入（不勾的字段沿用 staminaMax/oxygenMax 满状态）
  - depth / zoneId（zoneId 留空则按事件 zoneTags 推断）
  - equipment：5 槽分别可勾覆写（空 itemId = null）
  - inventory：可加减行
  - profileFlags / runFlags / unlockedUpgrades / loreEntries（逗号分隔）
  - bankedGold / seed / chain (follow|isolated) / maxSteps
  - choices：根据当前预览的 `step.visibleOptions` 动态渲染每步下拉
- **右**：`runEventScenario` 实时输出。每步显示 title / tone / body / visible options
  (含 check stat/dc/估算 rate) / hidden options (含 blockedBy 原因) / chosen / narrative
  / deltas / next；末尾一张 summary 表

**导入导出**：

- 导出 JSON：复制 `ScenarioInput` 到剪贴板，附带文件名建议 `<event_id 下划线>__<variant>.json`
  （形状与 `scenarios/*.json` 一致，可直接 paste 进 `event-runner.ts --from`）
- 导入 JSON：textarea 粘贴 `ScenarioInput`，应用后表单同步更新
- 存到 localStorage：key 命名 `dev.scenarios.<event_id 下划线>__<variant>`，列表里可一键载入/删除

**实现层**：

- `src/ui/dev/EventDevPanel.tsx` —— 主面板组件（三栏 + 工具栏 + Choices/Preview 子组件）
- `src/ui/dev/ScenarioSerializer.ts` —— form ↔ ScenarioInput 互转、JSON 序列化、localStorage CRUD（纯数据层，无 React 依赖，便于未来挪到战斗 dev 面板复用）
- `src/ui/dev/dev-panel.css` —— `.dev-*` 前缀样式；由 EventDevPanel.tsx 静态 import，prod build 时随面板一起被 tree-shake 出包
- `src/App.tsx` —— 顶层 `useState` 管 `devPanelOpen`，**不进 GameState**（quirk #23）

**不在面板里做的事**（一开始就刻意排除）：

- 不实装 "在浏览器里跑全部 scenarios"——那是 `scripts/playthrough-scenarios.ts` 的工作
- 不自动写文件——浏览器不直接 fs，导出走剪贴板/textarea，用户 Cmd+S 自己存到 `scenarios/`
- 不引新 npm dependency
- 不复刻引擎逻辑——所有计算走 `runEventScenario`，面板只是 form ↔ result 的 UI 包装

### 战斗回归框架（Phase 3）

**目的**：随着战斗参数（HP / 伤害区间 / AI 撤退阈值 / 玩家行动消耗）越来越多，没法靠 `scripts/playthrough-combat.ts` 一个完整流程脚本来 iterate 平衡。这套框架让你直接以 (combatId × 自定义 player state × seed × actions[]) 调用引擎，与事件回归同源套路。

**两层结构 + dev 面板**：

- `src/engine/combatScenario.ts` —— **纯引擎层 API**。不依赖 UI / Node fs / console，可被 dev 面板复用。导出 `runCombatScenario(input)` / `listAllCombats()` / `listAllEnemies()` / `listAllActions()` / `describeEnemy(id)` / `describeAction(id)`，并 re-export `withSeededRandom`。
- `scripts/combat-runner.ts` —— **CLI 包装**，handwritten argv 解析（与 `event-runner.ts` 同套路，无外部 dep）。支持 quick mode（多回合 `--action`/`--target`）/ `--from` / `--in -` / `--list` / `--list-enemies` / `--list-actions` / `--show` / `--show-enemy` / `--show-action` / `--out json`。
- `src/ui/dev/CombatDevPanel.tsx` + `src/ui/dev/CombatScenarioSerializer.ts` + `src/ui/dev/combat-panel.css` —— **网页内 dev 面板**。Shift+C 切换；与事件面板互斥（详见下文 App.tsx 改造）。

**核心机制**：

- **RNG seed**：复用 `eventScenario.ts::withSeededRandom`——同一套 quirk #22 规矩。
- **战斗边界**：碰到 victory / defeat / flee / emergency_ascend / 回合数上限 / 行动用完 → 停步。**不实装** "战斗中触发事件 / 战斗结束回到事件链"——战斗只跑战斗。
- **input.actions[i]**：`{ actionId, targetIndex? }`。`targetIndex` 是 enemies 数组下标（不是 instanceId），让 dev 面板 / JSON / CLI 都能拿数字下标对齐。
- **ad-hoc encounter**：除了 `combatId` 引用注册过的 `combatEncounters`，也可以传 `enemyDefIds: string[]` 自由组合敌人。dev 面板左栏顶部有"注册 combat / ad-hoc 构造"互斥选项。
- **不动 combat.ts 内部逻辑**：reducer / AI / 撤退阈值都不碰，只在 `combat.ts` 上加两个纯 getter（`listAllEnemyDefs` / `listAllEncounters`）供 scenarios 层 introspect。

**CLI 用法**：

```bash
# 1. quick mode（多回合 actions 顺序对齐）
npx tsx scripts/combat-runner.ts combat.tutorial_shark \
    --action action.ambush --target 0 \
    --action action.knife_stab --target 0 \
    --action action.knife_slash --target 0 \
    --seed 42

# 2. ad-hoc
npx tsx scripts/combat-runner.ts \
    --enemy enemy.reef_shark.tutorial --enemy enemy.blind_eel \
    --action action.knife_slash --target 0 \
    --action action.knife_slash --target 1 \
    --seed 1

# 3. 从 JSON 文件读
npx tsx scripts/combat-runner.ts --from scenarios/combat/reef_shark__normal_kill.json

# 4. 辅助命令
npx tsx scripts/combat-runner.ts --list
npx tsx scripts/combat-runner.ts --show-enemy enemy.blind_eel
npx tsx scripts/combat-runner.ts --show-action action.knife_stab
```

**场景库 `scenarios/combat/*.json`**：

- 命名规则：`<combatId 点改下划线>__<variant>.json`，例如 `reef_shark__normal_kill.json` / `blind_eel__sanity_attack_path.json`。
- 一个文件 = 一份 `CombatScenarioInput` + 可选 `_comment` + 可选 `expect`。`expect` 给 `playthrough-combat-scenarios.ts` 做断言：`outcome` / `turnsElapsed` / `survived` / `finalPhase` / `enemiesAlive` / `lootGained` / `statsDelta`，加上 `sanityDeltaAtMost` / `hpDeltaAtMost` / `oxygenDeltaAtMost` 这种"至少损失这么多"软断言。
- 目前 8 个 baseline scenario（reef_shark normal_kill + blind_eel sanity_attack_path + 沉船蛛蟹 solo normal_kill + 沉船蛛蟹 solo flee_retreat（territorial 撤退路径）+ 沉船蛛蟹 pair knife_stab_kill（**项目首个多体战斗**）+ reef_barracuda_solo normal_kill + cave_octopus_solo normal_kill（蓝洞深段 physical 攻坚 bruiser，seed 1 = 3 turns / stamina -28，knife_slash×4）+ **drowned_lantern_solo normal_kill**（墓园 cosmic 「理智消耗战」，seed 1 = 3 turns / stamina -20 / oxygen -3 / **sanity -10**，knife_slash×4——首个 sanity Δ 非零的战斗 baseline））。**添新敌人 / 新 encounter / 改平衡数值时建议至少加 1 个 baseline 进 scenarios/combat/**，保证以后改动不破坏既有行为。

**回归运行**：

```bash
npx tsx scripts/playthrough-combat-scenarios.ts
# ✓ playthrough 完成
# 全部场景通过（2/2）
```

**战斗 dev 面板（Shift+C）**：

三栏布局：

- **左**：模式切换（注册 combat / ad-hoc）+ encounter 列表 + enemy 列表（点击查看 `describeEnemy` 详情：HP/armor/攻击表/撤退阈值/AI/loot）。
- **中**：状态编辑（stats 滑动条 + 勾选覆写、5 槽 equipment、inventory、unlockedUpgrades、zoneId、depth）+ seed / maxTurns + actions[] 动态行（每行 actionId 下拉 + targetIndex 下拉，targetIndex 选项从 result.turns 反推当回合活敌人）。
- **右**：`runCombatScenario` 实时输出。每回合：player log（actor 着色）+ 4 stats 数值与 Δ + 全部 enemies 的 HP bar（含 stance + statuses）+ outcome 着色。末尾一张 summary 表（outcome / survived / turnsElapsed / final stats / stats Δ / loot / enemies alive / final phase），与事件面板的 summary 风格一致。

**导入导出 / localStorage**：

- 导出 JSON：复制 `CombatScenarioInput` 到剪贴板，文件名建议 `<combatId 点改下划线>__<variant>.json`（直接 paste 进 `combat-runner.ts --from`）。
- 导入 JSON：textarea 粘贴 `CombatScenarioInput`，应用后表单同步。
- 存到 localStorage：key 命名 `dev.scenarios.combat.<combatId 下划线>__<variant>`，**加 `.combat.` 中缀避免与事件 scenario 撞 key**（详见 quirk #25）。

**实现层**：

- `src/engine/combatScenario.ts` —— 纯引擎层 API，re-export `withSeededRandom`
- `src/engine/combat.ts` —— 仅新增 `listAllEnemyDefs()` / `listAllEncounters()` 两个 read-only getter
- `src/ui/dev/CombatDevPanel.tsx` —— 主面板组件
- `src/ui/dev/CombatScenarioSerializer.ts` —— form ↔ CombatScenarioInput / JSON / localStorage（不抽公共底座；等第三个 dev 面板再考虑）
- `src/ui/dev/combat-panel.css` —— `.dev-combat-*` 战斗专属样式；通过 `@import './dev-panel.css'` 复用事件面板的 .dev-* 基础变量与控件
- `src/App.tsx` —— 顶层 `devPanel` state 从 `boolean` 改成 `'event' | 'combat' | null` 联合；Shift+D 切事件、Shift+C 切战斗，两个面板互斥（任一打开时按任一快捷键都关闭）

**不在面板里做的事**（一开始就刻意排除）：

- 不实装 "战斗中触发事件 / 事件链跨入战斗回到事件"
- 不抽 `ScenarioSerializer` / `CombatScenarioSerializer` 公共底座——等第三个 dev 面板出现再考虑
- 不重做 `playthrough-combat.ts`（保留作为完整流程的端到端测试，`combatScenario.ts` 只是单战斗）
- 不引新 npm dependency
- 不复刻战斗逻辑——所有计算走 `runCombatScenario`，面板只是 form ↔ result 的 UI 包装

### mapgen 回归 + 地图调试器 dev 面板（本 session 新增）

**目的**：迷路图是随机拓扑，没法靠肉眼跑 playthrough 确认"每张图都连通/有环/有死路/多最深点"。这套延续事件/战斗的回归文化，但 scenario 更轻（只有 `zoneId × seed × depthOffset`）。

- `src/engine/mapgen.ts::analyzeMap(map)` —— **纯结构分析器**（拓扑无关，层状/迷路都能跑）：`allReachable` / `isUndirected` / `cycleRank`(环秩=边-点+分量) / `deadEndIds` / `deepestNodeIds` / `localMaximaIds` / `ascentPointIds` + 可达性 / `entranceIsAscent`。dev 面板与回归脚本共用，不复刻。
- `scenarios/mapgen/*.json` —— 4 个 baseline（蓝洞群 seed1/seed7、暗河口 depthOffset 6、沉船墓园层状对照）。schema = `{ zoneId, seed, depthOffset?, expect }`；`expect` 支持精确锁（nodeCount/edgeCount/maxDepth/entranceDepth）+ 布尔不变量 + `min*` 阈值（minDeepestPoints 等）。命名遵循 `<zone 下划线>__<variant>.json`。
- `scripts/playthrough-mapgen-scenarios.ts` —— 跑 `scenarios/mapgen/` 子目录（quirk #26 约定）：逐 scenario 断言 + 确定性（同 seed 两次生成指纹一致）+ **迷路不变量种子扫描**（blue_caves seeds 1–60，每个 seed 都断言迷路不变量——这是真正值钱的鲁棒性检查，curated 只覆盖几个点）。
- `src/ui/dev/MapDevPanel.tsx` + `map-panel.css` —— **网页内地图调试器**，DEV 模式 **Shift+M** 切换（与事件/战斗面板互斥；`DevPanelKind` 加 `'map'`）。左栏 zone/seed/depthOffset 控制 + `analyzeMap` 结构读数（迷路不变量着色）；右栏节点图 SVG（按 layer=树距分列、按 kind 配色、标最深点/死路/回边）。同样走 `lazy + DEV 守卫 + co-located css`，prod build tree-shake（已验证 dist 里搜不到 `MapDevPanel`/`map-panel`）。

### 关键数值（占位平衡，未细调）

- 起始：体力 100、氧气 60 回合、理智 100、氮气 0
- 检定公式：`successRate = clamp(0.5 + (stat - dc) × 0.015, 5%, 95%)`
- 减压：氮气 < 40 安全 / < 60 一停 / < 80 二停 / ≥ 80 三停
- 战斗中氮气累积 × 1.5（per spec，未实装）；理智衰减 × 1.2（per spec，未实装）
- 节点过渡 turn 数：`1 + Math.floor(depthDelta / 5)`
- 衰减阈值（diveAge）：organic 2 / consumable 5 / material 12 / durable 25 / eternal ∞
- 升级保鲜加成：lv1 +2 / lv2 +5 / lv3 +10
- 海流冲走：6% per item per run（lv3 免疫）

---

## 4. 本次 session 的关键设计决策

| 决策 | 取值 |
|---|---|
| 地图结构 | 随机节点 + 深度推进 |
| 时间粒度 | 回合制，事件可加额外消耗 |
| 死亡模型 | 硬核 Roguelike + 尸体回收 + 建设值永久积累 |
| 恐惧节奏 | 理智值驱动 + 深度加速衰减 |
| 上浮 | 随时可上浮 + 应急上浮必得严重减压病 |
| 装备 | 5 固定槽位 + 装备 + 词缀（MVP 仅等级）|
| 港口升级 | 多分支升级树（船坞 / 气瓶库 / 打捞行会 / 教堂） |
| 战斗经济 | 双资源直读（体力 + 氧气回合） |
| 位置维度 | 无（武器性格代替） |
| 多敌 | 1–4 个，独立 aggro / 姿态 / AI |
| 伤害类型 | 双轨（物理 + 理智），克苏鲁敌人未实装 |
| 重生叙事 | **D 设定**：早期表现为不同潜水员；中期开始故障；终局揭示一直是同一人 |
| 教学关名 | 「初次潜水」（不是「资格潜水」） |

---

## 5. 还没接的功能（推荐处理顺序）

### 高优先级（meta-loop 最后一公里）

- [x] **基建地图 revamp · Phase A（材料经济）** —— 2026-06-01 实装。把"建设值买升级"整体换成"**材料 ＋ 金币** 买升级"：`UpgradeCost{ materials, gold }`、material `tier 1–4`、`canPurchase`/`purchaseUpgrade` 双资源、`buildingPoints` 整体移除、SAVE_VERSION 1→2、Mira 回购侧（T1/T2 可买/`shopStock` 限量+回港补满）、UpgradePanel 账单缺口高亮 + MiraShopView 回购区。反刷机制从抽象分数改由"稀有材料只在深处掉"承担。设计源 `docs/深海回响_基建地图_SPEC.md`（§2/§5/§6/§8，Phase A 已打勾）。回归全绿（`playthrough-upgrades`/`-economy`/`-save` + `smoke-chart-ui` J/K）。详见 quirk #50。提交 `4612c0c`。
- [x] **基建地图 revamp · Phase B（灯塔数据模型）** —— 2026-06-01 实装。多灯塔基地的**数据层 + 引擎脚手架**：`Lighthouse` 类型（`types/lighthouse.ts`）+ `profile.lighthouses` + home 灯塔种入/迁移（SAVE_VERSION 2→3）+ `engine/lighthouses.ts`（每灯塔升级轨 canBuildAt/buildAtLighthouse + getLighthouseBonuses + nearestLighthouse，与全局 upgrades.ts 平行）+ `data/lighthouse_upgrades.json`（信标占位轨）。**灯塔 inert——没接进 chart/dive/UI，游戏行为不变**；reveal（点亮揭示）/ reach（最近灯塔算 distance）是 Phase C。`dockyard` 仍全局（归属决策留 Phase C）。回归全绿（新 `playthrough-lighthouse.ts` + `-save` v2→v3 + verify-tutorial §4b 账单材料校验）。详见 quirk #51。**下一步：Phase C（海图集成 + 修复循环）——见 `docs/NEXT_SESSION_PROMPT.md`。**
- [x] **港口升级 UI** —— `src/ui/UpgradePanel.tsx` + `engine/upgrades.ts`。Port 界面有"修缮港口"入口。
      船坞 lv1 通过新的 `hasUpgrade` Condition 严格门控旧灯塔礁；气瓶库 lv1 在 `startDive` 链路真正 +10 oxygenMax。
      验证脚本：`scripts/playthrough-upgrades.ts`。
- [x] **教学结尾日志的港口触发** —— 新增 `GamePhase = portEvent`。玩家点 ResolutionView "回到港口" 时，
      `engine/portEvents.ts::pickReturnTrigger` 扫 inventory 找 `item.story.triggersEventId`，
      命中即先 null run、再进 portEvent；`PortEventView` 用同一套 DiveEvent schema 渲染，结束写
      `flag.event_done.<id>` 防重播。`engine/events.ts::applyOutcome` 现在在无 run 时把 applyFlags / goldDelta
      路由到 `profile.flags` / `profile.bankedGold`。验证路径在 `scripts/playthrough.ts`。
- [x] **战利品变卖（Mira 柜台）** —— `engine/port.ts` 实装 Mira 收购：`MIRA_BUY_RATIO = 0.8`，
      `sellItemToMira` / `listMiraSellables` / `miraOfferFor` / `isSellableToMira`。eternal / story / sellPrice=0 物品不收，
      留在 `profile.inventory`。`engine/ascent.ts::computeLootValue` 接入 `sellPrice × ratio`，但只是显示值；
      `RunOutcome.goldEarned` 现在只反映 `run.gold`（事件给的），`RunOutcome.lootValue` 是潜在变卖价值，
      实际入账要走 `ui/MiraShopView`。`engine/dialog.ts::openShop` effect 切 phase 到 `'shop'`，
      App.tsx 顶层挂 `MiraShopView`。验证脚本：`scripts/playthrough-economy.ts`。

### 中优先级（味道）

> **设计哲学锚点**：深海回响是 roguelike，每次出海都该不同。引擎层面已经做到了（mapgen 抽事件 / DeathRecord 驱动尸体 / 衰减 / 海流冲走），瓶颈是**内容池太薄**——最初 14 事件 / 1 敌人 / 1 random zone，重复 2–3 次就认脸。下面这组中优先级里，"扩内容"权重比"加新系统"高。
>
> **内容进度（周末内容引擎在持续补，每次 pass 换 zone/深度/tone 侧重）**：截至 **2026-05-31**：63 事件 / 6 敌人 / 3 random zone（旧灯塔礁 + 蓝洞群 + 沉船墓园）。各 zone tone 覆盖：蓝洞群 realistic/uncanny/cosmic 齐（**2026-05-30 第四个 pass 补蓝洞深段首个 realistic 战斗＝洞穴章鱼 + 一个 cosmic 影子厅；2026-05-31 周日第二个 pass 补 30-45m 中段 +2 uncanny +2 cosmic**，cosmic 2→4）· 沉船墓园齐 · **旧灯塔礁（reef）2026-05-30 补齐 realistic/uncanny/cosmic（灯塔线 5 事件）+ 深水段 45-60m 4 事件（cave/wreck 跨 zone，60m 池 1→5）**。**敌人 6 只**：reef 梭鱼（玻璃大炮）/ 蓝洞章鱼（深处闸门 physical 攻坚，territorial 撤退）= 2026-05-30 两个 pass 各补一只 / **墓园沉灯水母（cosmic「理智消耗战」，2026-05-31 周日敌人 pass，墓园第二只 + 项目首只 cosmic-tier + 首只 sanity-主导）**；外加暗礁鲨(教学)/盲鳗(蓝洞 uncanny)/蛛蟹(墓园)。**三个长线薄弱处本 pass（2026-05-31 敌人 pass）全部补上**：~~墓园敌人只蛛蟹一只（最长线缺口）~~→ 已补沉灯水母（墓园 2 敌）· ~~reef 26–44m 中段缺 uncanny~~→ 已补 `reef.lighthouse_lens` · ~~蓝洞 12–25m 浅段 cosmic 空（最浅 cosmic 在 32m）~~→ 已补 `bluecaves.the_narrowing`（14-25m）。**当前仍薄的（下一批候选）**：reef 仍只 1 只原生敌人（梭鱼）——可补第二只（reef 中深段 realistic/uncanny tone，与梭鱼玻璃大炮互补，是 §5 点名最久的缺口）· **reef 26-44m realistic 本 pass 已补 `shelf_break`**，但 reef 浅段（10-25m）uncanny/cosmic 仍空（只 bleached_garden 16m 起 uncanny）· 墓园/蓝洞 cosmic 已厚，叙事重心可转向 reef 深段或蓝洞更多敌人 · `flag.d_reveal` 终局揭示钩子**仍刻意保留不触发**（quirk #42/#44/#48/#49，留给在场用户定，不是内容缺口）。【2026-05-31 周日第四个 pass（realistic 探索密度）：事件 59→63、event baseline 43→49、无新敌人；reef 26-44m realistic 缺口（shelf_break）+ reef 浅中段（urchin_barren）/wreck 内舱（galley）/蓝洞浅段（breakdown_pile）realistic 密度各补一个】【2026-05-31 周日敌人 pass：墓园敌人 1→2、事件 56→59、敌人 5→6、event baseline 39→43、combat baseline 7→8，三长线缺口全补】

- [x] **扩 zone 内容池（第一波：蓝洞群）** —— 新 random zone `zone.blue_caves`（12–55m，6 层），8 个事件 +
      新敌人盲鳗。引入了**封闭水域**机制：`ZoneDef.canFreeAscend: false` + mapgen 不再在中间层生成 ascent_point
      + AscentView 用 `isAscentBlocked` 锁住 normal/rushed，emergency 重描述为"凿穿洞顶"。
      验证脚本：`scripts/playthrough-bluecaves.ts`。
- [x] **扩 zone 内容池（第二波：沉船墓园）** —— 新 random zone `zone.wreck_graveyard`（18–50m，6 层，开阔水域），
      6 个原生 dive 事件 + 2 个 portEvent cutscene + 沉船蛛蟹（**项目首个多体战斗 encounter**：solo + pair）。
      与蓝洞群形成对照：开阔水域 `canFreeAscend: true`，中间层会出现 ascent_point。reef.json::wreck.* 跨 zone
      共享到此（与 cave.* 给蓝洞群是同模式）。验证脚本：`scripts/playthrough-wreckyard.ts`。
- [x] **港口"海图"选点 UI** —— 已实装。Aldo briefing 的逐 zone 下拉换成港口外的 POI 海图。
      - **数据/引擎**：`src/data/chart_pois.json`（anchors 每 zone 一个持久点 + roamingTemplates 机会点）+ `src/engine/chart.ts`（`generateChart` 纯函数：anchor 持久、roaming 按 `runsCompleted` 种子刷新，**派生自 profile 不入存档 → 零 SAVE_VERSION 影响**）。
      - **两级门控**：`requiresFlags`=发现（不满足不出现）、`requiresUpgrade`=抵达能力（不满足则海图灰显可见但不能出海）。旧灯塔礁 = tutorial_complete + dockyard.lv1。
      - **修正（modifier）·三种全部实装**：`depthOffset`（`mapgen` 平移整图深度 → 经 tickTurns/planAscent 自然更耗氧·更长减压）；`distance`（出海预耗氧 + turn，"远 = 多耗氧 / 路上多 turn"）；`current`（每次节点移动额外耗体力+氧，strong −8/−2、mild −3/−1，`engine/dive.ts::currentMoveCost` + moveToNode，洋流耗氧也能致死）；`visibility`（理智压力 dark −0.35/turn、murky −0.15/turn，`engine/events.ts::visibilitySanityDrain` + tickTurns，且 **dark 时 NodeSelectView 遮蔽前方预览=盲航**）。修正统一暂存 `run.diveModifier`。
      - **入口/UI**：`openChart` DialogEffect + `phase 'chart'`（镜像 `openShop`→`shop`）；`src/ui/SeaChartView.tsx` 顶层视图（App.tsx 挂载）；PortView 加"摊开海图（出海）"按钮（教学后可见）；`src/engine/dive.ts::startDiveFromPoi` 封装出海。
      - **2D 地图视图（2026-05-29 升级）**：SeaChartView 从列表改成 2D 海图——港口在左、左→右≈离岸越远/越深，POI 是可点标记（实心=锚点 / 虚线=机会点 / 灰=未解锁），选中后信息面板（桌面右侧 / 手机下方）显示该点 名/标签/blurb/出海 + Lv.2 选目标。POI 带归一化 `mapX/mapY`（anchors 写死在 chart_pois.json，roaming 从模板透传；缺省按 distance 兜底）。**纯展示层重写，engine/门控/startDiveFromPoi 不变**。详见 quirk #41。
      - **回归**：`scripts/playthrough-chart.ts`（引擎层：门控 / roaming 刷新确定性 / depthOffset 真改深度 / distance 预耗氧）+ `scripts/smoke-chart-ui.tsx`（**React 层**：SeaChartView/PortView 服务端渲染断言——POI 渲染 / 锁定原因 / 空态 / 海图入口门控，补上 playthrough 测不到的 UI 层）。`playthrough.ts` RUN2、`playthrough-upgrades.ts` §6、`playthrough-wreckyard.ts` Phase9、`verify-tutorial.mjs` 已迁到海图机制。
      - **未做（留给后续）**：海图 dev 面板；地图美术（当前是极简平涂水面 + 深度带，无海岸线绘制）；洋流"冲走物品/位移尸体"这类与 inventory/corpse 交互的进阶效果（当前 `current` 只影响移动消耗）；能见度对技能检定/战斗命中的影响（当前只影响理智 + 节点预览可见性）。
- [x] **更多敌人 + 理智伤害实装** —— 盲鳗（`enemy.blind_eel`）三种攻击中两种带 `sanityDamage`：缠绕（物理 + sanity 双轨）+ 低频共振（纯 sanity）。`EnemyAttack.sanityDamage` 字段正式走通。
- [x] **真"迷路" mapgen** —— 已实装。`ZoneDef.mapShape: 'layered' | 'maze'`（与 `canFreeAscend` 正交）分流两套生成器：开阔海域走原层状 DAG（行为不变），洞穴 zone（蓝洞群，`mapShape:'maze'`）走 `generateMazeMap`。
      - **拓扑**：随机 spanning tree（连通 + 自然死路）+ 弦边（环/绕回），**双向 `connectsTo`**（玩家可回头/绕回，getNextChoices 含来路）。受保护叶子做 2–3 个"最深点"（深度钉 d1、邻居更浅 → 严格局部极大）+ 1 个"洞另一头的出口"。
      - **上浮语义**：入口（洞口）+ 远端出口都是 `ascent_point`（`isAscentBlocked` 在二者放行，内部节点仍只能 emergency）——**设计决策：入口可退回出去**（realistic + 不剥夺退路，迷路的代价由"往返耗氧"自然承担，而非堵死）。`depthOffset` 对迷路同样生效。
      - **重访**：`moveToNode` 检测 `visitedNodeIds`，重访已结算的事件节点不重播（退化成安静水域）；NodeSelectView 标"已来过"（盲航也显示，你记得来路）；建设值/eventsTriggered 改用去重计数，防来回踱步刷分。
      - **验收**：`analyzeMap` + `scripts/playthrough-mapgen-scenarios.ts`（4 baseline + 60-seed 不变量扫描 + 确定性）+ 重写后的 `playthrough-bluecaves.ts`（迷路版 isAscentBlocked）。可视化迭代用 Shift+M 地图调试器。详见 §3「mapgen 回归 + 地图调试器」+ quirk #30–#34。
      - **未做（留给后续）**：迷路里 `air_pocket`/`camp` 等新 NodeKind 布点（见下条）；尸体提示在迷路里的密度调优；玩家"画过的路线图"持久 UI（visitedNodeIds 是 append-only 全路径，已具备数据）。
- [x] **气穴 / 扎营节点化** —— 已实装。新增 NodeKind `air_pocket` / `camp`，`generateMazeMap` 在非保护内部节点上布点（气穴 ~0.7、偏深处；扎营 ~0.5）。玩家在选点界面就能看到地标（NodeSelectView 渲染 `○ 气穴` / `⌂ 扎营点`，盲航也显示——是导航地标）。
      - **气穴**：`breatheAtAirPocket` 氧气 +6 / 理智 +4，**不耗回合**，但**一次性**——用过把 `air_used:<nodeId>` 写进 `run.activeFlags`，重访失效（防迷路里来回蹭气穴刷无限氧）。
      - **扎营**：`campAtNode(state,'short'|'long')` 短 3 回合/+15 体力/+5 理智，长 6 回合/+30 体力/+10 理智/−5 氮。先 `tickTurns` 再叠加恢复——所以**长档在深处仍净增氮气**（tick 吸氮 > −5），不是减压捷径，代价是流逝的氧气（与普通 rest 同理）。
      - 两者复用 `dive` 的 `'rest'` subPhase，RestView 按 `node.kind` 分渲染；NodeChoice 加了 `kind` 字段。corpse pass 排除地标（不在气穴/扎营上压尸体）。事件版（`makeshift_ledge`/`cave.air_pocket`）保留共存（随机撞见的版本）。
      - **验证**：`playthrough-bluecaves.ts` Phase 6（换气增益+枯竭+上限、扎营对 tickTurns 基线断言）+ `playthrough-mapgen-scenarios.ts` 种子扫描里地标出现率（气穴 39/60、扎营 30/60）+ `smoke-chart-ui.tsx` G（地标标签渲染）。详见 quirk #37。
- [x] **D-reveal 文本故障化** —— 已实装。纯 UI 助手 `src/ui/diverName.ts::renderDiverName(rawName, deathsCount, revealed)`：1–4 次正常、5–9 笔误（相邻字符交换）、10+ 故障文字（叠组合附加符），`revealed`（`profile.flags.has('flag.d_reveal')`）置位后一律显示「你」。确定性（按 name+count 用共享 makeLcg 播种，渲染不闪）。已接进 `FuneralView`（标题）+ `CorpseView`（尸体名 + 取物日志），都读 `profile.deaths.length` + 揭示 flag。**`flag.d_reveal` 目前没有任何内容设置它——留给后续 lore 事件的钩子**（终局揭示）。验证：`playthrough-corpse.ts` 阶段 6（四档 + 确定性单测）+ `smoke-chart-ui.tsx` I（FuneralView SSR 渲染：正常/故障/揭示）。详见 quirk #42。
- [x] **打捞行会 Lv.1 的 corpse hint UI 显示** —— 已实装。`dive.ts::enterNodeSelection` 现按 `getUpgradeBonuses(profile).revealCorpseHint`（Lv.1 加成）门控：有 Lv.1 时尸体节点在选点界面带提示（`hasCorpseHint` → 红框 + "这一带似乎有熟悉的东西…" + 保留"熟悉的轮廓"预览）；**没有 Lv.1 时尸体节点伪装成普通水道**（hasCorpseHint=false + 中性预览，不剧透），但 `moveToNode` 仍按 `kind==='corpse'` 路由——撞上去照样进 CorpseView。验证：`playthrough-corpse.ts` 阶段 5。详见 quirk #36。
- [x] **打捞行会 Lv.2 的出海前选目标** —— 已实装。海图 POI 卡片（`SeaChartView`）在拥有 `preDiveCorpseSelect`（Lv.2 派生加成，已有）且该 POI 所在 zone 有可回收尸体时，显示"锁定目标"下拉；选中后 `startDiveFromPoi(state, poi, { targetCorpseId })` → `startDive` → `generateDiveMap` 的 `GenOpts.targetCorpseId`，在 corpse pass 里**保证布点**（绕过 corpseChance 随机 + ±10m 深度窗，放深度最接近 `depthAtDeath` 的可用节点；层状/迷路两套都支持）。可回收判据集中在 `death.ts::isRecoverableCorpse` / `listRecoverableCorpses`（zone 匹配 + 未回收 + diveAge<25 + 还有物品），UI 与 mapgen 共用。无效 id 自动退回随机。验证：`playthrough-corpse.ts` 阶段 4（层状 10/10 + 迷路布点）+ `smoke-chart-ui.tsx` F（picker 渲染门控）。详见 quirk #35。

### 低优先级（扩展）

- [ ] **尸体衰减时的 UI 提示** —— 玩家回港时如果有尸体衰减/被冲走，给个 toast 提示，制造紧迫感。
- [ ] **亡者之径事件** —— 同 zone ≥ 5 具尸体时强制生成 `cave.choir` 节点。
- [ ] **失能（Incapacitated）状态** —— 体力 0 不直接死，给"最后挣扎"窗口。
- [ ] **战斗中氮气 ×1.5 / 理智 ×1.2** —— per 战斗 SPEC §10，未实装。
- [ ] **背包负重影响上浮速度** —— per 主 SPEC §8.2，未实装。

---

## 6. 已知的 quirk 和注意事项

1. **沙箱权限**：在 Linux 沙箱里跑 `npm run build` 第二次会失败（删不掉旧 dist/），跑 `npm run dev` 同样问题（删不掉 .vite 缓存）。**用户本地 Mac 没问题**。
2. **第二次 build 前需要清缓存**：`rm -rf node_modules/.vite dist`。
3. **`performCheck` 用概率窗口模型**，不是 D&D 风格的 d20+bonus。事件 JSON 里的 `dc` 直接是 stat 比较值，不是 D&D dc。
4. **mapgen 的 event 概率是 80%**（从 70% 调上来过一次），rest 10%，ascent_point 10%。
5. **教学暗礁鲨调过两次**：原 50HP/6-10dmg 太硬，现 32HP/4-7dmg + 主动撤退（territorial 类敌人 HP ≤ 30% 时 50% 撤退）。
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
20. **蓝洞群入口段（12–25m）事件密度偏低**：目前只有 `bluecaves.entrance_light` + `bluecaves.color_shift` 两个事件能命中浅段。`scripts/explore-bluecaves.ts` 30 局测试里 entrance_light 触发了 42 次——玩家几乎每次都见到同一段开场。需要再补 2–3 个 12–25m 段的 cave 事件，**这是内容稀缺，不是 bug**。
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

45. **reef zone 首个原生战斗 encounter＝梭鱼（玻璃大炮原型）**：`enemy.reef_barracuda` hp 16（全场最低）/ armor 0 / evasion 4（最高，命中 0.95−4×0.04＝0.79）/ damage [5,9]（单击最高）/ hostility **predatory**（不触发 territorial 低血撤退，打到死）。knife_slash(8-14) **2 刀即杀**（hp 太薄）；但首回合梭鱼多半会先咬一口（dart [5,9]），所以"大炮"是真威胁，只是速杀下只来得及咬一两口。baseline `reef_barracuda_solo__normal_kill`（knife_slash×3、seed 1）= **2 turns / stamina −19（含一次 7 点突咬）/ oxygen −2** / 掉 barracuda_jaw；**stamina Δ 随 seed 在 −17~−19 浮动（咬不咬、咬多少由 RNG 定），故 baseline 只锁单一 seed**。触发事件 `reef.barracuda` 只挂 `[reef]` tag → 隔离在旧灯塔礁 26-44m（不跨 zone）。**加敌人五件套**：enemies/*.json（含 `combatEncounters` + 敌人自带 `loot.guaranteed`）→ combat.ts 三处注册（import + ENEMY_DEFS + COMBAT_ENCOUNTERS）→ 新 loot item 进 items.json → 触发事件挂对应 zone tag → ≥1 combat baseline + ≥1 event baseline。**敌人 schema 坑**：用 `hp`（非 maxHp）、encounters 放 `combatEncounters`（非 encounters）、loot 在敌人 def 的 `loot.guaranteed`（非 encounter）。

46. **蓝洞群深段敌人＝洞穴章鱼（physical 攻坚「深处闸门」原型 / 反梭鱼）**：`enemy.cave_octopus` hp 26（仅次教学暗礁鲨 32，全场非教学最厚）/ armor 1 / evasion 3 / threat 6 / hostility **territorial**（hp≤30%≈7 时 50% 撤退，能被 scare/flee 收）/ aiPattern aggressor / 三攻击（缠臂 [3,5] w3 + 角喙 [5,8] w1 + 喷墨 0 物理 + sanityDamage [2,4] w1）。与梭鱼（hp16 glass cannon 速杀）正好相反：**厚血 + 甲 → 拖成 3-4 turn 消耗战**，每回合都在烧氧/体力，在深段（40-55m）氧本就紧，是真正的"打还是绕"决策。knife_slash(8-14) 减 1 甲 = 7-13 有效，约 3 刀杀。baseline `cave_octopus_solo__normal_kill`（knife_slash×4、seed 1）= **3 turns / stamina −28 / oxygen −3 / 无喷墨命中故 sanity 0** / 掉 cave_octopus_beak；**stamina −20~−30、sanity 0~−3 随 seed 浮动（咬几下/喷不喷墨由 RNG 定），故只锁 seed 1**（同梭鱼套路）。触发事件 `bluecaves.octopus_den` 挂 `[cave]` tag → 跨 zone 共享到旧灯塔礁 cave 层（与盲鳗同模式，不同于梭鱼的 `[reef]` 隔离）；三选 = 拔刀(hasEquipment tool)/压灯慢退(stamina vs 13 避战)/绕开，参照 reef.barracuda + blind_eel_lair。**意义**：蓝洞战斗 1→2（盲鳗 uncanny sanity flanker + 章鱼 realistic physical bruiser），且是**蓝洞首个 realistic-tone 战斗**。掉天然物（章鱼喙）守 quirk #44。加敌人仍走 quirk #45 五件套。

47. **旧灯塔礁的 `wreck` tag 从 25m 起（不是 45m+），所以全部 `wreck_graveyard.*`（`[wreck]`）事件天然跨 zone 共享到灯塔礁 25m+**：`zones.json::zone.old_lighthouse_reef.zoneTagsByDepth` = 0m `[shallow,reef]` / **25m `[reef,wreck]`** / 45m `[wreck,cave]`。`buildEventPool` 是 tag **交集 `some`**（事件 tag 与当前深度段 tag 有任一交集即入池），所以**任何挂 `[wreck]` 的事件在灯塔礁 25m+ 都会被抽到**——不止 `wreck.*` 跨 zone 料，连墓园原生 `wreck_graveyard.*` 也是。这是**有意**的：灯塔礁描述写了"岩礁下面据说还有些船难的残骸"，礁底本就有沉船，"船舱/引擎室"在礁底不出戏。**推论**：(a) quirk #44 说的"灯塔礁 45m+ = [wreck,cave]"只是最深一段，`wreck` 实际 **25m 起**；(b) 写 `wreck_graveyard.*` 等于同时给灯塔礁 25m+ 供货，所以 **loot 必须人造物**（canned_food/old_fishing_net/brass_* 等，守 quirk #44）、文案别写死"只此墓园才有"的设定；(c) 要让事件**只**在墓园而不漏进礁底，目前没有 zone 专属 tag——得引入 `wreck_graveyard` 专属 tag（类比 quirk #17 对 `blue_cave` 的提议）。**2026-05-31 周日 pass 的 4 个墓园事件即按此实现**（全 `[wreck]`、24-50m、loot 只 canned_food/old_fishing_net）：`the_knocking`/`the_open_door`（cosmic，把墓园原生 cosmic dive 从 1〔engine_room_hum〕补到 3）+ `hull_handprints`/`cold_stores`（uncanny）。叙事母题延续：`the_knocking` 是 `dive_slate`『不要回敲』的正面付现（敲击母题 engine_room_hum / silent_chamber / dive_slate），`the_open_door` 接『深处有光』暗线但**刻意不触发 flag.d_reveal**（留给在场用户，同 quirk #44）。

48. **沉船墓园第二只敌人＝沉灯水母（cosmic-tier「理智消耗战」原型 / 反盲鳗·反章鱼）+ 2026-05-31 周日敌人 pass 三长线缺口全补**：`enemy.drowned_lantern` hp 24 / armor 1 / evasion 1（命中 0.91，易打中）/ speed 4 / threat 6 / **tier cosmic（项目首只）** / hostility **predatory**（不触发 territorial 低血撤退，打到死）/ aiPattern caster（**注意：`aiPattern` 是纯 metadata，引擎不 branch——`combat.ts` 的 runEnemyTurn/enemyAttackPlayer 只按 attack `weight` 随机选招，只有 dev 面板显示它**，所以随便填合法枚举值都行）/ 两攻击（脉光 damageType `sanity`·damage `[0,0]`·sanityDamage `[4,7]` w3 主攻〔纯 sanity 母攻，照 `blind_eel.eel.hum` 套路：damageType sanity + damage [0,0] + sanityDamage〕+ 曳丝 physical `[2,4]` + sanity `[1,2]` w2）。设计＝**「理智消耗战」**，与梭鱼(hp16 glass cannon 速杀)/章鱼(hp26 纯物理 bruiser)/盲鳗(hp18 evasion4 物理主导·sanity 点缀的快速 flanker)全互补：**slow/tanky + 主攻烧 sanity → 拖得越久脑子越空**，是墓园『打还是躲』里"打"的理智代价。knife_slash(8-14)−armor1=7-13，~3 刀杀；baseline `drowned_lantern_solo__normal_kill`（knife_slash×4、seed 1）= **3 turns / stamina -20 / oxygen -3 / sanity -10**（**项目首个 sanity Δ 非零的战斗 baseline**）；**sanity -8~-14 / stamina -20~-29 随 seed 浮动（脉不脉、扫不扫、个别 seed 4 turns 由 RNG），故只锁 seed 1**（同 quirk #45/#46）。掉 `lantern_gland`（天然身体部位→ Mira，符合 quirk #44）。触发事件 `wreck_graveyard.drifting_light` 挂 `[wreck]`（按 quirk #47 跨 zone 共享到灯塔礁 25m+，但「漂着的冷光」在礁底沉船间不出戏，呼应 reef.lantern_glow / lore.deep_water.cold_light『下面的光』暗线——**只呼应不解释、不触发 d_reveal**，否则像 the_knocking 一旦被『解谜』就泄了气）。加敌人仍走 quirk #45 五件套（enemies/*.json → combat.ts 三处注册 import+ENEMY_DEFS+COMBAT_ENCOUNTERS → loot item 进 items.json → 触发事件挂 zone tag → ≥1 combat + ≥1 event baseline；verify-tutorial 的注册守卫会拦未 import 的 enemy 文件）。**同 pass 另两个事件**（补 §5 点名的另两长线缺口，均 ≥1 baseline）：`reef.lighthouse_lens`（uncanny·30-44m·`[reef]` 隔离·sanity vs 48·loot brass_fitting / sight_along → lore.old_lighthouse.the_lens·填 reef 26-44m 中段 uncanny，此前最深 reef-only uncanny 是 fog_bell 到 38m）+ `bluecaves.the_narrowing`（cosmic·14-25m·`[cave]`·oncePerRun·loot-free·lore.bluecaves.the_way_out·填蓝洞 12-25m 浅段 cosmic，此前最浅 cosmic 是 32m falling_up——把『感知/方向错乱』母题下放到还看得见真出口的浅段，反而更不安）。

49. **realistic 探索密度 pass（2026-05-31 周日第四个 pass）＋ stamina-check 为何只锁 success baseline**：本 pass 刻意**轮换离开**前三个 pass 的 cosmic/uncanny/敌人侧重，回到 **realistic 探索质感**，跨 reef/wreck/cave 三 zone 补 **4 个 realistic dive、无新敌人**（守『敌人别太多·优先事件』，且近几 pass 已连加 3 敌人）：`reef.shelf_break`（30-44m·stamina vs12·coral_shard，**填 reef 26-44m realistic 缺口**——此前该段只有 barracuda 战斗触发器 + lobster_hole 到 35m，是 reef 唯一明确 realistic 空档）/ `reef.urchin_barren`（16-30m·无 check·coral_shard+sanity-1）/ `wreck_graveyard.galley`（20-34m·stamina vs13·canned_food/old_fishing_net 人造 loot，守 quirk #44/#47）/ `bluecaves.breakdown_pile`（16-26m·无 check 资源取舍·coral_shard 天然 loot，稀释 quirk #20 的 entrance_light 过曝）。全 realistic、全单 zone tag（quirk #19）、无 lore、**不触发 d_reveal**。事件 59→63、event baseline 43→49。**关键回归坑（承 quirk #43）：低 dc 的 stamina check 无法做 fail baseline**——`successRate=clamp(0.5+(stat-dc)×0.015, .05, .95)`，要 fail 必过的 0.05 clamp 需 `stat ≤ dc-30`，而 stamina dc 12-13、stat 最低 0 → 最低 rate 仅 0.32 左右，撞不到 0.05；**且小 seed（1-7 等）的 LCG 首抽都≈0.236**（NR-LCG 首值随 seed 线性微增，0.000388/seed），任何 rate>0.236 的 check 用小 seed 必过。所以**所有 stamina-check baseline 只锁 success 分支**（满 stamina→1.32→clamp 0.95，seed 1 必过），与既有 reef.flooded_stair/wreck.silted_hold/cave.halocline 一致；fail 分支只在写时用**大 seed**（如 100000，首抽≈0.99）手验 deltas（shelf_break fail={stamina-6,oxygen-2}、galley fail={stamina-8,oxygen-2,sanity-1} 已验），不进 baseline。要给 stamina-check 做 fail baseline 必须改 performCheck 暴露 roll 或换更高 dc——本 pass 没做。事件 baseline 命名/格式同 quirk #43，statsDelta 全部 `event-runner --out json` 实跑抄出，未凭直觉。

50. **材料经济（基建地图 Phase A，2026-06-01）—— 升级双资源账单 / `buildingPoints` 整体移除 / Mira 回购 + shopStock / 存档 v1→v2**：
   - **升级 `cost` 从 `number`（建设值）变 `UpgradeCost{ materials: MaterialCost[]; gold }`（`types/upgrades.ts`）**。`canPurchase` 顺序是**材料先于金币**：逐条 `countInInventory(profile.inventory, itemId) >= qty`，缺 → `{reason:'notEnoughMaterials', shortfall}`（shortfall 列每种还差几个，供 UI 高亮"还差 X×N"）；材料齐了才查 `bankedGold >= gold`，缺 → `{reason:'notEnoughGold', goldShort}`。**推论：满金空仓买升级落 notEnoughMaterials（不是 ok / 不是 notEnoughGold）——"金币买不了升级"靠这个顺序保证**。`purchaseUpgrade` 逐条 `removeFromInventory` + `bankedGold -= gold`，不可购买时 no-op（不偷扣）。改账单数值就改 `data/upgrades.json`，引擎零改动；`describeUpgradeCost` 是 log+UI 共用的账单格式化（别在 UI 再写一份）。
   - **material `tier 1–4`（`items.json` 每个 material 标）= 深度分档**（T1 浅~T4 cosmic，见 §3 items.json）。tier 是"难度标签"：驱动①升级账单稀有度（高阶升级点深料，强制下深）②Mira 回购门控（仅 T1/T2 可买回）。**加新 material 记得标 tier，否则 `tierOf` 返回 undefined → 不可回购、且不会被任何按 tier 的逻辑算进**。
   - **`buildingPoints` 整体移除**：types（PlayerProfile + RunOutcome.buildingPointsEarned）/ engine（`death.ts::computeRawBuildingPoints` + `ascent.ts::computeBuildingPoints` 删除，executeDeath/executeAscent 不再发点）/ 全部 UI（PortView/SeaChartView/ResolutionView/CorpseView/UpgradePanel）/ 脚本。**死亡/上浮不再发任何元进度点数——进度＝带回的材料本身**。
   - **存档 `SAVE_VERSION 1→2`**（quirk #39 流程）：`migrateSave` 的 `while` 加 `case 0/1`（fall-through）删 `prof.buildingPoints`，`v=2`。旧点数**直接丢弃不折算**（SPEC §6/§10 决策）。灯塔字段留 Phase B 再迁。回归在 `playthrough-save.ts` step 6（注入 v1 档→断言迁移后无 buildingPoints + version 2）。
   - **Mira 回购（出售侧，`port.ts`）**：T1/T2 材料可买回，**买价 = 卖价(`miraOfferFor`)× `MIRA_BUY_MARKUP`(2)，恒 > 卖价**；T3/T4 `miraBuyPriceFor` 返回 0（只卖不买，保住"深度=进度"门控）。**`shopStock` 软限量**：`SHOP_STOCK_BY_TIER`（T1=8/T2=4）是每次回港的备货上限，存在 `profile.shopStock?: Record<itemId,number>`（**可选 + 普通对象**——旧档缺它无妨，`getShopStock` 缺项懒默认成满货，JSON 原生 round-trip 无需特殊迁移）；`buyFromMira` 买 `min(qty, 余货, 金币能买的)` 后递减 stock，`handleReturnToPort` 把 `shopStock={}` 清空＝补满。**这些都是 tunable（SPEC §9）：markup / 各档上限 / T3-T4 是否开放回购，集中在 `port.ts` 顶部三个常量**。
   - **UI**：UpgradePanel 用 `CostLine` 渲染"材料×需求量（不足→红 + 已有数）＋ N 金（不足→红）"，按钮三态（修缮/材料不足/金币不足（还差 N））；面板**渲染全部升级线**——某行可买不代表别行也可买（smoke 别断言"满足时整面板无不足态"）。MiraShopView 加回购区 `listMiraBuyables(profile)`（遍历物品库非背包，缺料也能补），按钮三态（买 1/钱不够/售罄）。
   - **作用域**：本 Phase **只动经济**，没碰灯塔数据模型 / 海图 reveal / nearest-lighthouse distance（那是 Phase B/C，见 `docs/NEXT_SESSION_PROMPT.md`）。**新增 UI smoke**：`smoke-chart-ui.tsx` J（UpgradePanel 三态+缺口）+ K（MiraShopView 回购 T1/T2 不含 T3/T4 + 买/钱不够/售罄）——承 quirk #38 教训，UI 数据路径要补 SSR 渲染断言。

51. **灯塔基地数据模型（基建地图 Phase B，2026-06-01）—— 多灯塔数据层 + 引擎脚手架，灯塔此刻 inert**：
   - **`Lighthouse` 类型在 `types/lighthouse.ts`**（不是 state.ts——所有灯塔类型集中一处：实体 + LighthouseUpgradeDef/Effect/Bonuses/Track/File）；`PlayerProfile.lighthouses: Lighthouse[]` 在 state.ts 引入它。`types/index.ts` 已 `export * from './lighthouse'`。
   - **home 灯塔单一来源 `state.ts::createHomeLighthouse()`**（id `lighthouse.home`，`HOME_LIGHTHOUSE_ID`）：createInitialProfile 种入 + migrateSave `case 2` 补种，**别在两处各写一份字面量**（改坐标/名字只改工厂）。坐标 mapX 0.06/mapY 0.5（海图最左港口位，POI 在 0.18+）。**name 暂沿用 SPEC 锁定的「旧灯塔」**——与出海 zone「旧灯塔礁」同源 lore 但不同地点，潜在歧义；name 是 content/tunable，Phase C 灯塔上海图可见时再由作者定（已记 NEXT_SESSION）。
   - **存档 SAVE_VERSION 2→3**（接 Phase A 的 1→2）：`migrateSave` `case 2` 给缺 `lighthouses` 的旧档种 home。**关键：migrateSave 在 `JSON.parse(reviver)` 之后跑，所以此处 Set 已是真 Set——种 home 时直接 `new Set()`（不是 `{__set:[]}`）**；同理 `lighthouse.builtUpgrades` 这种**嵌套在数组对象里的 Set 也走现有 replacer/reviver 自动 round-trip**（已验，`playthrough-save.ts`）。
   - **`engine/lighthouses.ts` 与 `engine/upgrades.ts` 平行、互不污染**：随身装备升级＝全局（`profile.unlockedUpgrades` + `getUpgradeBonuses`）；灯塔设施＝每灯塔（`lighthouse.builtUpgrades` + `getLighthouseBonuses`）。账单**复用** Phase A 的 `materialShortfall`/`describeUpgradeCost`（别再写一份）。`buildAtLighthouse` 不可变更新时**只 map 替换目标那一座灯塔**（`i===idx ? {...l, builtUpgrades:newSet} : l`），别整盘替换污染别座（回归专门断言前哨不被污染）。`canBuildAt` 比全局多一个 `needsLighthouseLevel`（灯塔 level 门槛）。
   - **灯塔 inert**：本 Phase **没有**把灯塔接进 chart.ts（reveal POI 可见性）/ dive.ts（nearest-lighthouse 算 distance）/ 任何 UI（建造界面）。`engine/lighthouses.ts` 的函数有 `playthrough-lighthouse.ts` 单测但游戏流程不调用。**Phase C 才消费 `getLighthouseBonuses`（lightRadiusBonus→揭示半径、reachReduction→出海拉近）+ 把 `nearestLighthouse` 接进 distance + `lighthouse_ruin` 修复事件 + SeaChartView 渲染灯塔 + 建造 UI**。
   - **`dockyard` 归属**：SPEC §3.3 建议 dockyard→home 灯塔升级，但 Phase B **没动**（dockyard 仍全局，仍用 `hasUpgrade` 门控旧灯塔礁 POI + 进 getUpgradeBonuses；迁灯塔会牵动海图门控+加成聚合，是更大改动）。留 Phase C 评估。
   - **`lighthouse_upgrades.json` 是单文件**（非目录）→ 不触发 verify-tutorial 的目录注册守卫（quirk #39e 只扫 events/enemies/npcs 子目录）；但 verify-tutorial **§4b 新增账单材料校验**（全局 upgrades + 灯塔 upgrades 的 `cost.materials.itemId` 都必须是真 item，catch 拼错）。加新灯塔设施轨改这个 JSON 即可，引擎零改动。

52. **海图集成 + 修复循环（基建地图 Phase C，2026-06-01）—— 灯塔从 inert 到"做事"，revamp 三支柱闭环**：
   - **reveal（`chart.ts`）**：新 `isPoiLit(profile, poi)`/内部 `isLit(profile, x?, y?)`——POI 落在**任一**已拥有灯塔的 `revealRadius(lh)` 内才点亮（遍历所有灯塔，不只看最近）。`revealRadius = BASE_LIGHT_RADIUS(0.72) + (level-1)*PER_LEVEL(0.12) + lightRadiusBonus*PER_BONUS(0.12)`（常数在 `lighthouses.ts` 顶部，tunable SPEC §9）。`isPoiVisible = flagsSatisfied && isPoiLit`；generateChart 的 roaming 过滤也加 `isLit`。**home L1 半径 0.72 故意只覆盖现有 4 锚点（最远沉船墓园 ≈0.662）+ 近端 3 roaming，两个远端 roaming（蓝洞暗河口 0.791 / 塌口北缘 0.802）落半径外** → 修复前哨灯塔才点亮（决策：作者选 uniform radius、非祖父化豁免；SPEC §10.8）。**无坐标的 POI 默认点亮**（不因缺坐标隐藏）。
   - **reach（`effectiveDistance(profile, poi)`，`chart.ts`）**：distance 档 = `round(nearestLighthouse 距离 / REACH_NORM_PER_TIER(0.3)) - reachReduction`，clamp ≥0；**无坐标 / 无灯塔退回写死 `poi.distance`（fallback）**。0.3 是**刻意校准**：使 4 锚点从 home(0.06,0.5) 算出的档位＝写死 0/1/1/2（不破手感，`playthrough-chart` §2b(d) 锁死）；roaming 按几何略偏（本就"潮位常变"）。`dive.ts::startDiveFromPoi` 用它替代写死 `poi.distance`（预耗氧 + turn）。
   - **修复废弃灯塔**：下潜里能**持久写 profile** 的 outcome 之前只有 `loreEntry`——新增 `restoreRuinId` 同类（`applyOutcome` 在 loreEntry 之后处理）。事件 `lighthouse.ruin_north`（`data/events/lighthouse.json`，注册进 `zones.ts`）repair 选项 `outcome:{restoreRuinId}` → `restoreLighthouse(state, id)` **权威校验**（`canRestoreRuin` 按 **profile 银行**材料＋金币，**不是 run.inventory**——下潜带不进银行料、run.inventory 起步空）：成功扣 profile 料＋金 + push `ruin.result` 灯塔（builtUpgrades 空 Set）+ 置 `flag.lighthouse_restored.<ruinId>`（事件 `forbiddenFlags` 据此不再出）；不够/已修则只叙事不改档（幂等）。账单/结果灯塔在 `lighthouse_upgrades.json::ruins[]`，verify-tutorial §4c 校验 cost＋result，walkOutcome 校验 restoreRuinId 引用真 ruin。
   - **dockyard 迁灯塔**：dockyard 从 `upgrades.json` 全局线删，迁成 `lighthouse_upgrades.json` 的 `lhtrack.dockyard`（**新 `LighthouseTrack.homeOnly:true`**——建造 UI 对前哨隐藏此轨）。它唯一真效果是 `extraConsumableSlot`（旧 `unlockZone` 是死的——`bonuses.unlockedZones` 没被任何 chart/dive 消费，只被旧测试断言，已删该断言）。**桥**：新 `LighthouseEffect.extraConsumableSlot` + `LighthouseBonuses.extraConsumableSlot`，`getRunBonuses(profile)` = 全局 `getUpgradeBonuses` ＋ **家灯塔**（仅 home）的 `extraConsumableSlot`；`dialog.ts::startDive` 和 `dive.ts::startDiveFromPoi` 两个出海口都改用它。3 个远海 POI 的抵达门从 `requiresUpgrade`（查 unlockedUpgrades）改成新 `ChartPoi.requiresLighthouseUpgrade`（`poiLockReason` 查 **home** 的 builtUpgrades）；**锁定串保持「需要「船坞 Lv.1」」**（facility name 沿用，smoke A/B 串不变）。**SAVE_VERSION 3→4**（`case 3`：已购 `upgrade.dockyard.lv1` 从 unlockedUpgrades 删 + `lighthouse.dockyard.lv1` 加进 home.builtUpgrades；没买过的档不塞）。
   - **UI**：`SeaChartView` 在 chart-map 里渲染每座灯塔的 `.chart-lighthouse`（aria-label「灯塔：<名>」）+ `.chart-light-radius`（归一化半径圈，pointer-events:none 不挡 POI 点击、置 POI 之下）；底部「灯塔设施」按钮 toggle 新 `LighthouseBuildPanel`（镜像 UpgradePanel，用 `getLighthouseTracks`/`canBuildAt`/`buildAtLighthouse`，按 `track.homeOnly` 对非 home 隐藏船坞轨）。**半径圈 % 宽高、容器非正方时是椭圆**——v1 接受，纯视觉（tunable）。
   - **回归**：新 `playthrough-lighthouse-scenarios.ts`（引擎直调 resolveOption 跑修复成功/失败/幂等 + reveal/reach 前后 + 存档 round-trip——**因 runEventScenario 的 inventory 落 run 不落 profile、且不暴露 final lighthouses，成功路径只能引擎直调**）+ `scenarios/lighthouse/`（leave / 身无分文 restore 两条 harness 路径）。改 `playthrough-chart`（§2 门控 + 新 §2b reveal/reach）/`-lighthouse`（新 §6 半径+船坞桥）/`-upgrades`（全局线 3→2，dockyard 全迁）/`-economy`（"金币买不了升级"改用 tankhouse）/`-save`（v3→v4 + 没买不塞）/`smoke-chart-ui`（B 用 home 船坞、J 用 salvage 账单、新 L/M）/`verify-tutorial`（requiresLighthouseUpgrade + ruin 校验）。

53. **内容 pass（2026-06-02）—— reef 浅段 fresh-wrongness 母题 / reef 第二敌人「石斑鱼」(territorial 重装) / 深段 realistic 密度 / 敌人分布达 2-per-zone**：revamp 三支柱闭环后，本 session 回到 [Weekend Content Log] 记的三个长线内容缺口，一次补齐。
   - **priority 1 · reef 浅段 fresh shallow-wrongness（作者明确选「全新浅水错位」，刻意不续灯塔『下面的光』线）**：旧灯塔礁浅段（10-25m）此前几乎全 realistic、**无浅段 cosmic**。补 3 个 `[shallow,reef]` 事件，主题是**晒亮/安全的浅水被悄悄证伪**（三条不同感官通道）：`reef.silversides`（uncanny·动物行为·银鱼群让出的球把你扣在心、围的却是一片空沙）/ `reef.sun_net`（**cosmic·光/物理·沙上一格太阳光网钉死不动，失败分支『真正的底蒙了层薄东西』·项目首个浅段 cosmic**）/ `reef.warm_seam`（uncanny·温度·一道从礁底缝上来的血温暖水，『像谁在底下慢慢呼吸』）。新 lore 命名空间 `lore.reef_shallows.*`（the_gap/the_still_square/the_warm_crack），三者都轻触『下面』暗线但**刻意不触发 d_reveal**（同 quirk #44/#48 的克制——揭示是存档级不可逆决定，留给在场用户）。**为什么 `[shallow,reef]` 安全**：zones.json 里只有 `old_lighthouse_reef` 的 0m 段挂 `shallow`，`east_reef`=`[tutorial]`、蓝洞=`[cave]`、墓园=`[wreck]`，故 `[shallow,reef]` 事件天然只在灯塔礁 0-25m 出现（quirk #19 反例的正面确认），coral_shard 天然 loot 不出戏；sun_net cosmic loot-free。灯塔礁 12m 事件池 4→6。
   - **priority 2 · reef 第二只敌人＝石斑鱼（`enemy.reef_grouper`，territorial『礁檐守卫』原型）**：hp30（全场非教学最厚）/ armor2（最高）/ **evasion1（最低——hit 0.91 几乎必中）** / speed6 / threat4（低）/ hostility territorial（hp≤30% 撤退，可被 scare/flee 收）/ aiPattern observer（纯 metadata，quirk #48）/ 2 纯 physical 攻击（gulp 吞口 [6,10] **全场最高单击** w2 + buffet 侧撞 [3,6] w3）。**生态位与现有 5 敌全异**：梭鱼=fragile-fast-burst predatory、章鱼=cave aggressor 厚血 bruiser(+ink sanity)、盲鳗=fast sanity flanker、沉灯水母=cosmic sanity caster、教学鲨=脚本。石斑＝**「低闪避·必中·厚甲·最重单击·但 opt-in」的重装墙**——threat 低不追，触发事件 `reef.coral_overhang`（realistic·20-38m·`[reef]`）给 `sneak_larder`（stamina vs13 避战取洞底 loot）/ `leave_ledge`（无代价退）两个**非战斗出口**，与梭鱼 predatory『拔不拔刀都付代价』正相反——这是 territorial 的玩法签名。combat baseline `reef_grouper_solo__normal_kill`（knife×5、seed 1）= 4 turns / stamina-32 / oxygen-4 / 掉 grouper_maw（seed 1：grouper 只 buffet×2 无 gulp、turn3 territorial 撤退、turn4 补刀；stamina 随 seed 浮动故只锁 seed 1，同 quirk #45/#46/#48）。新 loot `item.grouper_maw`（石斑鱼鳔，**material T2 organic**·sellPrice15·天然身体部位→ Mira，符合 quirk #44；organic 与 lobster/eel_skin 同档=得趁鲜卖）。加敌人走 quirk #45 五件套（enemy json→combat.ts 三处 import+ENEMY_DEFS+COMBAT_ENCOUNTERS→item→触发事件→combat+event baseline，verify-tutorial 注册守卫拦未 import）。
   - **priority 3 · 深段 realistic 密度**：verify-tutorial『旧灯塔礁事件池』报告是薄段信号——补浅段后最薄是 60m 段（5）。补 `cave.sump_pool`（realistic·46-60m·`[cave]`·回水潭潜越·coral 天然）+ `wreck.chain_locker`（realistic·44-60m·`[wreck]`·锚链舱打捞·brass/canned 人造，quirk #44/#47），**depthRange 都摸到 60** 故填 60m 段（5→7），同时跨 zone 加厚蓝洞群（cave 46-55）/ 沉船墓园（wreck 44-50）深段。低 dc stamina-check 只锁 success baseline（quirk #49）。
   - **敌人分布现 2-per-zone**（reef 梭鱼+石斑 / cave 盲鳗+章鱼 / wreck 蛛蟹+沉灯水母）——**『敌人别太多』已到位，下一个 content session 不建议再加敌人**，优先事件 / 终局 lore 触发（`flag.d_reveal` 仍无触发器，quirk #42——或可由 `lore.reef_shallows.*`／『下面』暗线收口）。
   - 计数：事件 64→70、敌人 6→7、combat 7→8、item 21→22、event baseline 49→57、combat baseline 8→9。全回归绿（含 -economy/-upgrades，新 T2 grouper_maw 进 Mira 回购池但没破账单/回购断言）。

54. **内容 pass（2026-06-02 续二）—— 墓园浅段 fresh-wrongness 3 事件 / 内容首次作 deep-game vision 的「伏笔层」 / 「叙述永不交底」定为深水写法铁律 / 无新敌人**：接 reef 浅段（quirk #53）的对称缺口，补沉船墓园浅段 18-25m（此前无 cosmic、uncanny 仅 dive_slate/handprints 擦边 22-24m 起）。3 个 `[wreck]` 事件。
   - **与之前内容 pass 的关键不同：这次每个事件都刻意是「深水越深越欺骗 + apex mimic/corpse-wearer」北极星（见自动记忆 deep-game-vision）的浅水伏笔**——`the_other`（两船间跟你同步、隔固定距离的潜水员 → 伏笔 corpse-wearer「穿尸体引诱」）/ `all_facing`（从上方看沉船船首/舱口/尸体全转向塌口深水 → 伏笔『深处的拉力』，**墓园首个浅段 cosmic**）/ `full_nets`（拖网船的网被底下某物往深处拽得绷紧、还在被拉 → 伏笔深处的『渔夫/安康鱼』）。把浅段「晒亮处的不安」做成深水欺骗的预告，与 reef 浅段（sun_net/silversides/warm_seam，quirk #53）对称。
   - **写法铁律（源自 deep-game vision 的「是世界坏了还是你疯了——通常两者皆是」）：深水/伏笔事件的叙述永不交底**——既给一个平淡解释（倒影 / 几十年的洋流 / 还没烂的网），又留一个错的读法，两种始终叠着，不确认也不否认。范例：the_other『像你的光弹回来的影』、all_facing『告诉自己是洋流……信了一半』、full_nets `follow_down`『底下还在拉，慢慢的匀匀的』。reef.sun_net『你告诉自己是云』是同写法的先例。**以后写深水/cosmic 内容沿用此铁律。**
   - **loot（quirk #44/#47）**：仅 `full_nets` 掉人造物（old_fishing_net + canned，`[wreck]` 跨灯塔礁 25m+ 不出戏）；the_other / all_facing loot-free（纯不安）。全不触发 d_reveal。**无新敌人**（各 zone 已 2 敌，守『敌人别太多』）。
   - 新 `lore.wreck_graveyard.{the_other,all_facing,full_nets}`。事件 70→73，event baseline 57→62（the_other signal_success / all_facing fix_bearing success+fail〔cosmic sanity 双分支，fail 起步 sanity 20→8〕/ full_nets cut_upper_success〔stamina 仅 success，quirk #49〕+ follow_down〔no-check+lore〕）。statsDelta 全 `event-runner --out json` 实跑抄出（quirk #43）。全回归绿（typecheck / playthrough / -wreckyard / -combat / -corpse / -bluecaves / scenarios 62 / combat 9 / mapgen / -save / verify-tutorial / smoke-chart-ui）。

55. **内容 pass（2026-06-02 续三）—— 深水伏笔 mid 层（25-44m）3 事件 / 一 zone 一母题 / 「叙述永不交底」铁律续用 / 无新敌人**：承 quirk #53（reef 浅段）/ #54（墓园浅段）的 fresh-wrongness，把自动记忆 deep-game-vision 的『越深越欺骗』信任梯度从**浅段伏笔**推进到三个 zone 的**中段（25-44m）**。设计原则：**一 zone 一事件、一事件一条 vision 母题、各填该 zone 的真缺口、不加敌人（各 zone 已 2 只，守『敌人别太多·优先事件』）**。recon 用 `event-runner --list` 按 zone-tag 数中段 tone 覆盖：reef 26-44m 唯一 cosmic 是灯塔线 lantern_glow（→补非灯塔 cosmic）；cave/wreck 中段 uncanny 已密、但 cave 无『假光』、wreck 无『corpse-wearer 中段付现』（→各补一条）。
    - **reef · 『深处的拉力』**：`reef.no_bottom`（cosmic·32-44m·oncePerRun·`[reef]`）——游出断口悬在开阔水里，脚下空蓝没有底，深度表自己往下走『是它在把你往下要』。**reef 首个非灯塔线 cosmic-mid**，与 realistic `reef.shelf_break`（同是『礁壁断口』地标）配成『诚实危险＋错读』姊妹事件。`look_down` sanity vs50：成功给平淡解释（下降流／潜水服深处压扁丢浮力『道理都对。你还是没敢把那片蓝多看第二眼』）+ `lore.reef_deep.no_bottom`（**新命名空间**，parallel `lore.reef_shallows.*`）；失败＝错读吞人（空蓝像『慢慢张开又合上的口子』、不记得自己沉下来过）。loot-free。把浅段 wreck.all_facing（船首朝深水）的『拉力』母题带到 reef。
    - **cave · 『无灯之光』（mimic 假信标伏笔）**：`bluecaves.the_glow`（uncanny·30-44m·`[cave]`）——黑水道尽头一点你盼着出口该有的颜色的光，朝它游它不变大、一拐石壁就移到别处亮起『在等你换个方向』。直接预告 deep-game vision 里**伪装成灯塔的安康鱼 mimic**（海图上『无灯之光』的假 POI），借蓝洞黑暗做画布，加厚蓝洞『有人在下面/先来者』暗线（other_bubbles/left_behind_gear/sounding_line）。`go_toward`（no-check）→`lore.bluecaves.the_glow`；`douse_lamp` sanity vs48 成功＝关灯看真样子给平淡解释（『会发光的虫子，你对自己说』）。loot-free。
    - **wreck · corpse-wearer 伏笔 + 可读 tell**：`wreck_graveyard.no_bubbles`（uncanny·26-42m·`[wreck]`，按 #47 也跨灯塔礁 25m+，loot-free 不犯 #44）——两船间一个背对你伏在舷窗上『干活』的潜水员，头顶却没有一个气泡。把浅段 `the_other`（同步的潜水员）往深里推一格＝deep-game vision 的**『穿尸体的东西』corpse-wearer**，并刻意埋一个**可读 tell（不冒泡＝不呼吸）**——呼应 vision『够强+读出 tell 才能活』、为日后 mimic 机制留 tell 的雏形。`watch` sanity vs48 成功给两个平淡解释（空潜水服挂断缆随涌浪摆／闭路呼吸器不冒泡『挑了你更想信的那个』）；`rap_tank`（no-check 敲气瓶）→`lore.wreck_graveyard.no_bubbles`。**无 combat**（伏笔不是敌人，守 2/zone）。
    - **写法**：全部死守 quirk #54 铁律——既给平淡解释又留错的读法、两种叠着、不确认不否认、**全不触发 d_reveal**（揭示留给 vision 正式开建/在场作者）。全单 zone tag（#19）。baseline statsDelta 全 `event-runner --out json` 实跑抄（#43）；cosmic check 做双分支（no_bottom fail 起步 sanity20→8 不触 0 底）、uncanny sanity check 只锁 success + 配一个 no-check lore baseline（确定性）。
    - 计数：事件 73→76，event baseline 62→68（+6：no_bottom look_down success+fail / the_glow go_toward+douse_lamp_success / no_bubbles rap_tank+watch_success），敌人 7（不变）、combat 8（不变）、item 22（不变，全 loot-free 无新材料）。全回归绿（typecheck / 全部 playthrough / scenarios 68 / combat 9 / mapgen 4+60 / verify-tutorial / smoke-chart-ui）+ prod build 通过。**三 zone 中段深水伏笔层成型；下一步＝继续 realistic 密度收尾，或 deep-game-vision 正式开建（opacity→供给→mimic，需作者在场，见 NEXT_SESSION_PROMPT.md）。**

56. **内容 pass（2026-06-02 续四）—— realistic 探索密度收尾 / 一 zone 一事件填各 zone 真缺口 / 无新敌人 / 作者选「内容收尾·realistic 密度」**：浅段（#53/#54）+ 中段（#55）「越深越欺骗」伏笔层成型、「明显 tone 缺口」收尾后，本 pass 轮换回 realistic 探索质感（同 #49 的轮换逻辑），把三个 zone 各自最薄的 **realistic** 段补厚。
    - **recon 方法（承 onboarding）**：verify-tutorial 的「旧灯塔礁事件池」报告（现 12m=6 / 25m=21 / 38m=21 / 50m=20 / 60m=7）已被 #53 把浅/深段填平、不再是薄段信号；改用 `event-runner --list --zone-tag {reef,cave,wreck}` **按 tone 逐 zone 数 realistic 覆盖**找真缺口。三个真缺口：① 墓园浅段 18-25m realistic 仅 2（cabin_entrance/current_drag），且 #54 刚把该段堆成 uncanny/cosmic → tone 失衡；② 蓝洞中段 25-44m realistic 仅 3、全是导航地标（forked_passage/makeshift_ledge/stalactite_hall）、无觅食/资源 beat；③ reef-only 深中段 36-44m realistic 仅 shelf_break 触到 44m（lobster_hole→35 / urchin_barren→30）。
    - **三事件（一 zone 一个，各填上述缺口）**：`wreck_graveyard.deck_cargo`（18-26m·`[wreck]`·后甲板捆死的整船货+垮货网·`cut_lashings` stamina vs13 撬木箱→canned_food/old_fishing_net / `pick_spillage` 散货里捡→brass_fitting / `leave_cargo`·**人造 loot** 守 #44/#47）/ `bluecaves.lobster_crack`（26-44m·`[cave]`·侧壁横缝里够礁虾·`reach_in` stamina vs13→coral_shard+lobster chance / `snap_coral` 只掰珊瑚 / `leave_crack`·**天然 loot** 守 #44·给蓝洞中段补首个觅食 beat）/ `reef.sand_channel`（34-44m·`[reef]`·礁脊间平行沙沟+来回涌·`work_groove` stamina vs12 顶涌摸沟底→coral_shard+lobster chance / `near_ledge` 沟口礁檐摸一把 / `cross_over` 沟脊上方横过·**天然 loot**·与 shelf_break 同『断口/沙沟』地标家族但机制不同：横向涌 vs 垂直壁）。
    - **守则**：全 realistic（无 lore / 无 cosmic / 无 oncePerRun / **不触发 d_reveal**）、全单 zone tag（#19）、loot 按 zone（#44/#47：`[wreck]`→人造跨灯塔礁 25m+ 不出戏 / `[cave]`+`[reef]`→天然）、**无新敌人**（各 zone 已 2 只，守『敌人别太多·优先事件』）、**无新 item**（全用现有 T1/T2 材料 coral_shard/lobster/canned_food/old_fishing_net/brass_fitting，故 item 仍 22）。stamina-check 只锁 success baseline（#49：满 stamina→0.95 clamp、seed 1 必过；fail 分支 deltas 写时手验未进 baseline）；statsDelta 全 `event-runner --out json` 实跑抄（#43，三者 success 均 `{oxygen:-2}`）。事件无 oncePerRun/oncePerSave，故每个都有可重复触发的常规探索价值。
    - 计数：事件 76→79，event baseline 68→71（+3：三个 success 分支 cut_lashings/reach_in/work_groove，命名/format 同 #43/#49，文件在 `scenarios/` 根）。敌人 7 / combat 8 / item 22 不变。全回归绿（typecheck / 全部 playthrough / scenarios 71 / combat 9 / mapgen 4+60 / verify-tutorial / smoke-chart-ui）+ prod build 通过。**realistic 密度此轮收尾（三 zone 各段 realistic/uncanny/cosmic + 浅/中/深 tone 已齐）；下一步＝深水伏笔深段（45-60m）续铺〈承 #54/#55，可加直指 mimic/corpse-wearer 的更强伏笔但仍不触发 d_reveal〉，或 deep-game-vision 正式开建（opacity→供给→mimic，需作者在场，见 NEXT_SESSION_PROMPT.md）。**

57. **内容 pass（2026-06-02 续五）—— 深水伏笔深段 45-60m / 两条 apex 母题（mimic 假信标 + corpse-wearer）推进到最深层、最强预告但仍不触发 d_reveal / 无新敌人 / 续「ok next」自动续做**：承 #53/#54（浅段）+ #55（中段）的『越深越欺骗』伏笔层 + #56 realistic 密度收尾，把两条直指 [[deep-game-vision]] apex 威胁的母题铺到深段（45-60m），封顶浅/中/深三级弧线。
    - **深段 recon（与 #56 同法）**：`event-runner --list --zone-tag {cave,wreck}` 数 44-60m tone。**关键约束：reef zone 45m+ 段 tag=`[wreck,cave]`（quirk #47），`[reef]` 事件在 45m+ 不出现——所以深段只有 cave / wreck 两个 tag 可用**（reef『拉力』母题已在中段 no_bottom 封顶、无法下探）。两个真缺口：① cave 深段无『假光』（the_glow 封顶 44m）；② wreck 深段无『corpse-wearer』（no_bubbles 封顶 42m）——正好是 mimic / corpse-wearer 各自的深段空位。
    - **两事件（一 tag 一母题，全 cosmic·oncePerRun·loot-free·sanity vs55 双分支）**：`cave.false_beacon`（46-60m·`[cave]`·**写在 reef.json**，紧邻 cave.blue_floor 这个既有深段 cave cosmic）——超出自家灯塔光照边界、却有一点暖得正是岸上灯塔该有颜色的光稳稳悬着『像有人替你点着』＝**伪装成灯塔的安康鱼 mimic 假信标的直接深段预告**（海图『无灯之光』假 POI 的 in-dive 雏形），承中段 the_glow、接 deep_water『下面的光』暗线（cold_light/the_window）·新 `lore.deep_water.the_false_beacon`；三选 account_for_it（sanity vs55，成功给平淡 debunk〈自己的头灯散在盐雾/缺氧把冷蓝看成暖色〉+ lore；失败＝光把人往深里领）/ swim_for_it（no-check，付『缺氧绝望照样游过去』代价 sanity-7+往深处领）/ put_it_behind。`wreck_graveyard.the_wearer`（44-56m·`[wreck]`·**写在 wreck_graveyard.json**，承 the_other→no_bubbles 弧）——旧式铜盔潜水服、无灯无泡却知道你在哪、招手引你过去＝**穿尸体引诱的 corpse-wearer 直接深段预告**，埋可读 tell〈无灯/无泡/几十年没人穿的老装备/招手机械重复〉呼应 vision『够强+读出 tell 才能活』·新 `lore.wreck_graveyard.the_wearer`；三选 read_him（sanity vs55，成功＝数出 tell 退开 + lore；失败＝读不出、被引诱滑近）/ go_to_him（no-check，**反用本作对死者的温柔**『你没法把一个人丢在这么深的地方』·代价 sanity-8）/ keep_hull_between（埋 tell：它招手对着你刚才站过的位置、不是现在的你）。**无 combat**（伏笔非敌人，守 2/zone）。
    - **守则**：全 cosmic（深段 deception 层）、oncePerRun、loot-free、单 zone tag（#19）、**不触发 d_reveal**（揭示留 vision 正式开建/在场作者，#42/#44 沿用）、叙述永不交底（#54：两事件成功路都给平淡解释 +『你挑不出哪个更真』）。baseline 双分支：success 默认 sanity 100→rate 0.95 必过 + 断言 `loreAdded`；fail 设 `stats.sanity 22`（≤dc-30=25→clamp 0.05 必败、起步 22 减 12/13 落 10/9 不触 0 底，对照 reef.no_bottom 的 sanity20）。statsDelta 全 `event-runner --out json` 实跑抄（#43）：false_beacon success `{oxygen-2,sanity-5}` / fail `{oxygen-5,sanity-13}`；the_wearer success `{oxygen-2,sanity-5}` / fail `{oxygen-4,sanity-12}`。
    - 计数：事件 79→81，event baseline 71→75（+4：两事件各 account_for_it/read_him 的 success+fail）。敌人 7 / combat 8 / item 22 不变。全回归绿（typecheck / 全部 playthrough / scenarios 75 / combat 9 / mapgen 4+60 / verify-tutorial / smoke-chart-ui）+ prod build 通过。**浅/中/深三层『越深越欺骗』伏笔层全部成型（mimic 假信标 the_glow→false_beacon、corpse-wearer the_other→no_bubbles→the_wearer 各有浅中深级预告）；下一步＝低强度可再补深段不同感官变体，或 [[deep-game-vision]] 正式开建（opacity→跨 run 供给→mimic+d_reveal，需作者在场，见 NEXT_SESSION_PROMPT.md B 路）。**

58. **深水区 Phase 0a：微观双传感器 clarity + 不可信声呐 + 电池 + 低 san 腐蚀（2026-06-03，深水区第一笔代码）**——把 `visibility:dark` 盲航泛化成统一 micro-clarity。SPEC `docs/深海回响_深水区_SPEC.md` §11 0a（已勾）是源真；§10 决策日志记拍板与偏差。
    - **模型（三态权衡，非谁压谁）**：灯（近·地面真相·暴露 signature 最高·清水近免费/黑水耗电）/ 声呐 ping（远·**不可信返回**·耗电大·**后期才解锁**）/ 摸黑（盲·最隐蔽·省电）。"没有完全可信的传感器"：san 越低声呐先失真、san 足够低连灯也幻觉（灯最稳、最后崩）。
    - **新 `engine/clarity.ts`（单一来源 + tunables 集中文件顶）**：`clarity(run)`→`'full'|'sonar'|'none'`（`lampEffective` = 灯开+有电+水非 dark；`sonarActive` = 解锁+ping+有电）；`sonarReturn(run,node)` 不可信表象（① `node.evadesSonar` 没回波 / ② `node.spoofsSonar` 喂假回波〔mimic 钩子，默认 unset〕/ ③ san<60 注入假回波 / 否则粗糙 plausible 表象，**全 ≠ 真 preview**）；`lampPreview(run,node)`（真相；san<25 幻觉）；`signature(run)`（灯>声呐>摸黑，0b 消费）；`lampPowerDrain`（清水因子 0→浅水近免费 / murky 0.5 / dark 1）。**确定性哈希挑文案（不消耗 Math.random）**——不扰动 `withSeededRandom` 场景回归、playthrough-sensors 可稳定断言。
    - **run 状态**：`sensors:{ light; sonar:'off'|'ping'; sonarUnlocked }` + `power`/`powerMax`（电池，类比 oxygen）。`createNewRun` 种默认（灯开/声呐 off/能力派生/电满）；两个出海口（dialog.ts startDive + dive.ts startDiveFromPoi）经 `getRunBonuses().sonarUnlocked` 传入。
    - **引擎门控**：`enterNodeSelection` 一次算 `tier=clarity(run)`，按档把每个 choice 的 preview 烤成 真相/`sonarReturn`/盲 + 标 `choice.clarity`（**门控移到引擎侧、UI 成纯渲染器**——承 quirk #38「别只测引擎」的教训，逻辑可被 playthrough 测）。**地标（上浮口/气穴/扎营）盲航仍显示真相**（结构性，沿用 #37）。尸体提示只在 full+Lv.1（#36）。`tickTurns` 灯耗电。`dive.ts::setLight`/`pingSonar`（`refreshSelection` 重算选点；移动后 ping 归 off=脉冲瞬时；power 归 0→强制 none）。
    - **声呐后期解锁（作者 2026-06-02 加的关键约束）**：`upgrade.sonar.lv1`（新 `line.sonar_rig`，深料账单 lantern_gland T4 + eel_skin/cave_octopus_beak T3 + 120 金）→ `unlockSonar` effect（types/upgrades.ts + getUpgradeBonuses OR 聚合）→ `sonarUnlocked`。**早期＝仅有灯，黑水天然探索受限（"先经历黑暗中无声呐"），分级解锁；即使有灯仍有受限处。** dark POI 出海日志按 sonarUnlocked 给不同提示。
    - **存档（不做迁移，作者 2026-06-03：未发布）**：**不 bump SAVE_VERSION（留 4）、不加 migrateSave 步**；run 新字段靠 createNewRun 种默认 + 反序列化读取处 `?? 默认` 兜底（clarity.ts 全防御性读）。`playthrough-save` 仍校验 sensors/power 的**序列化 round-trip**（序列化≠迁移，仍需保证存读不丢字段）。发布前再按 #39 流程统一补迁移。
    - **UI**：`NodeSelectView` 按 `choice.clarity` 渲染（`.clar-sonar` 暖色斜体不可信 / `.clar-none` 更暗）+ 灯开关 / 声呐 ping 按钮（门控 sonarUnlocked + 电量足）；`StatusBar` 加电量 pill（tint-amber）。`smoke-chart-ui` E 改写为 clarity 渲染 + 电量 + 传感器 + 声呐门控断言。
    - **三处偏差**（作者在场敲定，SPEC §10/§11）：① `clarity(run)` 不带 node（node 级细分留 Phase 1）；② `DiveModifier.visibility` **并入而非删**（作 clarity 输入：dark→none、murky 不挡灯但耗电+理智压力照旧）；③ 声呐解锁轨在 0a 做（效果/耗能/电量档位留 Phase 2）。低 san 阈值 60/25 是 §8 tunable。
    - **回归**：新 `playthrough-sensors.ts`（10 节）。改 `playthrough-upgrades`（线 2→3 加声呐组件）、`playthrough-save`（加 sensors/power **序列化 round-trip** 断言；不做迁移）、`smoke-chart-ui`（E）。全绿（typecheck / 12 playthrough / scenarios 75 / combat 9 / mapgen 4+60 / verify-tutorial / smoke）+ prod build + dev tree-shake 干净。
    - **下一步 = 0b（探测/隐身，碰 combat，消费 `signature(run)`）**：高 signature→捕食者接近/伏击/提高遭遇；摸黑滑过。见 SPEC §11 0b + NEXT_SESSION_PROMPT.md。**别预先触发 d_reveal（#42）；别加第三只常规敌人（mimic/corpse-wearer 是 Phase 3 apex 例外）。**

---

## 7. 仓库结构

```
Blue/
├── docs/
│   ├── 深海回响_SPEC.md              主设计文档
│   ├── 深海回响_战斗系统_SPEC.md     战斗系统专题
│   ├── 深海回响_教学关剧本.md        第一次下潜剧本
│   ├── STATUS.md                     ← 本文件
│   └── legacy/                        早期草案
├── src/
│   ├── App.tsx, main.tsx, styles.css
│   ├── types/    (state/events/enemies/items/npcs/dive/combat/chart/upgrades/index)
│   ├── engine/   (state[含存档层]/events/dialog/chart/clarity[微观双传感器]/zones/mapgen/dive/ascent/combat/death/items/port/portEvents/upgrades/lighthouses/eventScenario/combatScenario/rng)
│   ├── ui/       (PortView/PortEventView/SeaChartView[2D 地图+灯塔节点/点亮圈]/MiraShopView/UpgradePanel/LighthouseBuildPanel/EventView/NodeSelectView/RestView/CombatView/AscentView/CorpseView/ResolutionView/StatusBar/diverName[D-reveal 渲染])
│   │   └── dev/  (EventDevPanel + CombatDevPanel + MapDevPanel + ScenarioSerializer + CombatScenarioSerializer + dev-panel.css + combat-panel.css + map-panel.css — 仅 DEV 模式加载，Shift+D / Shift+C / Shift+M 互斥切面板)
│   └── data/     (items/actions/zones/upgrades/lighthouse_upgrades[含 ruins]/chart_pois + npcs/<id>.json + events/{tutorial,reef,blue_caves,wreck_graveyard,lighthouse}.json + enemies/{reef_shark,blind_eel,wreck_spider_crab,reef_barracuda,cave_octopus,drowned_lantern,reef_grouper}.json)
├── scripts/
│   ├── verify-tutorial.mjs               数据图引用完整性
│   ├── playthrough.ts                    教学+随机图+上浮
│   ├── playthrough-combat.ts             战斗（完整流程端到端）
│   ├── playthrough-corpse.ts             死亡+回收
│   ├── playthrough-decay.ts              衰减+海流
│   ├── playthrough-upgrades.ts           升级树 + 派生加成
│   ├── playthrough-economy.ts            仓库 + Mira 变卖
│   ├── playthrough-bluecaves.ts          蓝洞群 + canFreeAscend + 盲鳗
│   ├── playthrough-wreckyard.ts          沉船墓园 + 蛛蟹 solo+pair + lost_diver/watch portEvent 链 + crab_chitin → Mira
│   ├── playthrough-sensors.ts            微观双传感器 / clarity（深水区 Phase 0a）：灯真相 / 黑水盲 / 声呐表象+spoof / power 摸黑 / 低 san 腐蚀 / signature
│   ├── playthrough-chart.ts              海图引擎回归：门控 / reveal+reach / roaming 刷新 / depthOffset / distance
│   ├── playthrough-lighthouse.ts         灯塔引擎回归：canBuildAt/build/bonuses/nearest + revealRadius/船坞桥
│   ├── playthrough-lighthouse-scenarios.ts  灯塔修复循环：修复账单 + reveal/reach 前后 + round-trip + scenarios/lighthouse/*.json
│   ├── smoke-chart-ui.tsx                海图 UI 渲染冒烟：SeaChartView/PortView/LighthouseBuildPanel 服务端渲染断言（React 层）
│   ├── playthrough-scenarios.ts          事件回归：跑 scenarios/*.json
│   ├── playthrough-combat-scenarios.ts   战斗回归：跑 scenarios/combat/*.json
│   ├── playthrough-mapgen-scenarios.ts   mapgen 回归：跑 scenarios/mapgen/*.json + 迷路不变量 60-seed 扫描 + 确定性
│   ├── playthrough-save.ts               存档序列化回归：Set round-trip + 版本迁移 + 损坏/未来版本
│   ├── explore-bluecaves.ts              蓝洞群手动多局探索（非 assert，迷路版已修上浮逻辑）
│   ├── event-runner.ts                   事件回归 CLI（--list / --show / --from / --in / quick mode）
│   └── combat-runner.ts                  战斗回归 CLI（--list / --list-enemies / --list-actions / --show / --from / quick mode）
├── scenarios/                            事件回归场景库（JSON，每份一个 ScenarioInput + expect 断言）
│   ├── combat/                           战斗回归场景库（JSON，每份一个 CombatScenarioInput + expect 断言）
│   ├── mapgen/                           mapgen 回归场景库（JSON，{ zoneId, seed, depthOffset?, expect }）
│   └── lighthouse/                       灯塔修复循环场景库（JSON，lighthouse_ruin 的 leave/restore 路径）
├── package.json, tsconfig.json, vite.config.ts, index.html, README.md
```

---

## 8. 下次接手时的快速 onboarding

1. 读 `docs/深海回响_SPEC.md` 主 SPEC（前 6 节即可对齐世界观和核心循环）
2. 读 `docs/深海回响_战斗系统_SPEC.md` §2–§7（战斗基本机制）
3. 读本文件第 3、5、6 节
4. 跑 `npx tsx scripts/playthrough.ts` 看一次完整 trace，几秒搞定
5. `npm run dev` 在自己机器上点一遍 UI

中优先级已全部做完（迷路 mapgen / 海图 2D / 气穴·扎营 / 打捞行会 Lv.1·Lv.2 / D-reveal）。然后可以接 §5 低优先级（尸体衰减 toast / 亡者之径 / 失能状态 / 战斗氮气·理智系数 / 负重影响上浮），或之前 mock 过但没建的**状态效果系统**（run 级 StatusEffect + StatusBar 图标行，bends II/III 当首个真实消费者），或扩内容（蓝洞 12–25m 浅段缺口 quirk #20 / 更多敌人），或给 `flag.d_reveal` 接一个终局 lore 触发。
