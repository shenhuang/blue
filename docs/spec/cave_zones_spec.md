# 洞穴扩充 SPEC：27 洞 · 4 beacon · 多口持久洞

> 状态：**设计章 v2 定稿（最新一次改动 2026-06-26·补语调单一来源指针，设计本身未变；定稿本体 2026-06-23·交互 session〔Cowork〕）**——覆盖原 28 区方案（→27 洞）。
> Batch 0（28 区 stub）已 land 进 zones.json；本章重定方案。**下方「全区 JSON」「事件池设计指引」是 Batch-0 原始参数·实装时按本设计章更新**（删 5 区·改 lc/depthRange·加 beacon/温度/多口标注）。事件池 Batch 1–4 见 cave_batch_prompts.md。

---

## 设计章 v2（2026-06-23 定稿 · 唯一真相源）

### 0. 总览
**27 个洞** = Batch-0 的 28 区删 5（→23）＋ 已有 `blue_caves` ＋ 一章首发三洞（`shaft_crack`/`chamber_network`/`flooded_gallery`）。
四档尺寸 ×（home / wreck / midwater / vent）四 beacon。**`trench` 永远 0 洞**（与 #174 col.trench 解耦同向）；`midwater` 靠**海山/孤峰**承载洞（开阔无底蓝水本身没岩壁）。

### 1. 尺寸 × lc × 入口/出口

**两种口**：**入口** = 海图 POI（可下潜起手）+ 能上浮；**出口** = 只能上浮、**非 POI**（不能从这儿起手下潜）。**每个洞 ≥1 出口 → 从不是死胡同**。下面「口数」按尺寸给的是**入口（POI）数**；出口另算。

| 档 | lc（旧→新） | 入口(POI) | 出口(仅出) | 节点 N≈2·lc |
|---|---|---|---|---|
| 小 | 3–4（不变） | **1** | ≥1 | 8–12 |
| 中 | 5–7 → **7–15** | **1–2** | ≥1 | 14–30 |
| 大 | 9–11 → **16–30** | **2–3** | ≥1–2 | 32–60 |
| 史诗 | 15 → **100+（独立设计）** | **6** | 多 | 200+（核心离所有入口最远） |

> 中/大档**刻意拉大 lc 跨度**（中 7–15·大 16–30），同档内规模差异大＝惊喜维度（T1 在区间内**分散取值·别都取中值**）。史诗不再套「5×大号」公式，改**独立设计**（见 §5 复合洞）。

**出口为什么「仅出」（fiction = 穿流洞）**：洞是水流穿过的系统——你从**能逆流而入的口（入口）**下去，从**水流冲出的口（出口/泄流口）**出来；出口顺流、逆入不能，故能出不能进、不是下潜起点。三变体：①单向泄流口（潮汐/暗流冲出）②上升烟囱（只能由洞内浮出·外面发丝细缝找不到/插不进有计划下潜）③单向塌口（顺坡挤出·逆向进不来）。**推论**：跨 beacon「reef 进 / wreck 出」＝顺着穿流（一口入、一口出）。

入口/出口都走 **B（持久大图·见 §5）**：入口=带 POI 的入口节点，出口=不带 POI 的 ascent 节点。

### 2. 删除（Batch-0 28 → 23·按 深度/tag/洞型 冗余度挑）
- `coral_grotto` 珊瑚洞（小·cave·与 reef_pocket/kelp_hollow 重叠）
- `sunken_chimney` 沉烟囱（小·crack·三竖井中间档）
- `sea_arch_cave` 海拱穴（小·tide·与 tidal_seam 重叠）
- `echo_cavern` 回声穴（中·grotto·与 ossuary_passage 几乎同参）
- `trench_hall` 沟堂（大·deep_cave·与 collapsed_caldera 同型·留更深的后者）

### 3. beacon × 尺寸 分布（27 洞 · trench 0 · midwater 0 开阔水但有海山洞）

| beacon | 主题 | 小 | 中 | 大 | 史诗 | 小计 |
|---|---|---|---|---|---|---|
| **home** reef·浅 | 礁/潮/海岸 | 5 | 3 | 0 | 0 | **8** |
| **wreck** 沉船 | 船骸/淤积/骨 | 3 | 2 | 0 | 0 | **5** |
| **midwater** 海山群 | 孤峰·迷失·欺骗·主探索 hub | 2 | 3 | 3 | 1 | **9** |
| **vent** 火山热液 | 火山口/熔管/热液 | 1 | 2 | 2 | 0 | **5** |
| 合计 | | 11 | 10 | 5 | 1 | **27** |

**`home`（8·中性温度）** — 小：reef_pocket 礁穴 · kelp_hollow 藻洞 · tidal_seam 潮缝 · tidal_bore_cave 浪涌穴 · limestone_slot 石缝 ｜ 中：submerged_arch 沉拱厅 ⇄wreck · moonpool_cavern 月池穴 · **blue_caves 蓝洞群** ⇄wreck（迁自 trench·横岩廊=已有第二口）

**`wreck`（5·中性）** — 小：wreck_hold 舱格 · anchor_hollow 锚坑 · silt_alcove 淤积凹室 ｜ 中：sandfall_cave 沙瀑洞（自 home·落沙呼应沉船沙位变动）· ossuary_passage 骨道（自 midwater·骨配沉船）

**`midwater`（9·海山孤峰·主探索 hub）** — 小：blind_alley 暗礁巷 · **shaft_crack 竖穴裂缝** ｜ 中：blue_throat 蓝喉 · **chamber_network 蜂房洞** · murk_gallery 浑水廊 ｜ 大：mirror_maze 镜廊 ⇄ · serpentine_deep 蛇行深处 ⇄ · **flooded_gallery 漫水回廊** ⇄（横向最长·口最多）｜ 史诗：**the_deep_gate 深门**（3-beacon 脊柱·冷·核心不可达）

**`vent`（5·火山）** — 小：drowned_well 沉井（冷·option）｜ 中：thermal_pocket 热水窟（热）· lava_branch 熔管岔道（热）｜ 大：collapsed_caldera 塌陷火口（热）· black_basin 黑水盆（冷）

### 4. 区域主题 + fiction
- **home/reef**：礁穴·潮汐·海岸（浅·**大量中小**）。
- **wreck/沉船**：船骸·淤积·遗骸。
- **midwater/海山群**：开阔无底蓝水里**拔起的孤立岩峰**，内部被蚀空成洞——给「远洋中层」加地质纹理（不是空蓝一片）。**迷失/欺骗系全聚此**（镜廊·蛇行·浑水·骨道…），合「越深越欺骗」轴；史诗深门的核心也在这。是**主探索 hub**（与现有「midwater 主探索优先」一致）。
- **vent/火山**：火山口·熔管·热液（热极）+ 深冷盆（冷极）。
- **出口型按地区**（§1 穿流三变体的默认归属·事件 session 照此默认、不必各编）：home/潮汐洞 → ①单向泄流口（潮汐冲出最自然）；midwater 海山 → ②上升烟囱（孤峰里垂直缝最贴）；vent/深洞 → ③单向塌口（火山/坍塌地质）。

### 5. 多口洞架构（B：持久大图）+ 跨 beacon
- **一个洞 = 一个持久空间**：地图入存档（`SAVE_VERSION` bump），海面**多口（POI）**，每口落图上**不同入口节点**，洞内状态（料/尸体/已探）**连续留存**。
- 口数按尺寸（§1）。**跨 beacon** = 不同口属不同 beacon；横向长 / 跨深度带的洞天然多口跨 beacon。
- **旗舰 = `the_deep_gate` 深门 = 循环再生洞（the breathing cave）· 3-beacon 脊柱 · 后期专项 · 初期不做内容**：口铺 **wreck 深缘 / midwater 核心 / vent 火山侧**，**不碰 trench**（trench=0 的设定声明）。**关键：不是「lc 多高的静态大迷宫」，而是一套会呼吸的循环系统**：
  - **月相式开合**：最多 **6 个出入口**·**每回合开放口数变化**·随「月相」周期推移。
  - **由深到浅渐次开放**：一个周期内口从深处先开、逐渐向浅处放（deep→shallow）。
  - **全闭 → 再生**：所有口闭合后洞内**重新生成**——从一大套**模板库 + 拼接算法**里重拼出新组合（**每周期一张新内部**）。
  - **口部固定 + 深处随机**：近洞口一段是**固定/手编**（锚定·每次进都认得），从**某阶段往里转随机生成**（越深越不可信·合「越深越欺骗」轴）。
  - **「持久」语义在此特殊**：口部固定段稳定·**深处随周期重置**（≠ §5 普通洞的全图持久）。需「月相/周期时钟」+ 模板库 + 拼接算法 + 口开合状态机。
  - **排期：最后期**。**初期不接 POI、不做任何史诗内容**——`the_deep_gate` 在 zones.json 留占位、**不进 chart 接线**。归 roadmap **T2b**（依赖 T2 的可扩展绑定模型；与普通持久洞是两套生成路径）。
- 其它 ⇄（2-beacon）：漫水回廊（横向最长）· 镜廊（跨三带）· 蛇行深处 · 蓝洞群（已有横岩廊第二口）等。
- **可扩展（硬要求·未来想加大/别处加口）**：B 把「持久地图」与「POI→入口节点绑定」**解耦、数据驱动**——以后让深门**更大** = 追加形状段/节点（数据）；**别处（任意 beacon）再开一个口** = 加一条 POI binding 绑到入口节点，**不重生、不改码**。口数/形状一律当数据、别写死进生成逻辑。游戏未发布（#99 版本不符洗档）⇒ 加大/加口零兼容负担。
- **代价**：地图持久化牵动存档/重生/声呐渲染（现 quirk「地图不入存档」要破）——是有分量的架构 epic·单独排期。换来「真实空间」底座（未来水流/坍塌/潮汐淹没/光路连通改变等机制可长在上面）。

### 5b. 发现/揭示分层（不是所有洞口都直接可见）
每个入口 POI 标一个**发现源**（全走现有机制·`discoveredFlag`/`revealFlag`/`marksPois`·**零新引擎**·同鲸落 revealFlag + #167 物品揭示）：
- **直接（reveal 半径）**：进 beacon 扫描范围即见。多数小/浅洞。
- **情报揭示（marksPois·#167）**：捡到海图/见闻物/**导师日志页** → 标出 POI。导师半本日志＝「全球潜点坐标串 + 海底奇观草图」（剧情 canon）⇒ **日志页揭示洞口是最贴的现有剧情绑定**。
- **剧情门控（`discoveredFlag=story.*`）**：完成某剧情分支/beat 才出现·绑现有线（导师日志后半 / ch1 锚点 / NPC 进度 Aldo·Mira·Otto / St2·St7）。**深门必走此档**（lore「没记录在任何海图上」）。
- **穿越发现（§5）**：走到一张图的对侧口 → setFlag 揭示对侧 POI（跨 beacon）。

**找到之后大多即成潜口**（入口 POI 可下潜）。**少数例外**（找到 ≠ 一定能从这儿下潜）：被温度过热/过冷**封口**（§6）/ 只能当**出口**（§1 穿流·非 POI）/ 得**从别的洞穿过去**才到。剧情门控的洞可能要配个小 story hook（event/lore 置 flag）——属内容侧·机制已就位。

### 6. 温度门控（热/冷双极 · deferred 系统）
- **系统**：像氮气的资源（温度/保温 + 潜服保温 + 探全门控）。**外传主推**·ch1 可只做**门控标注先不实装满**（不阻塞洞穴本身）。
- **热极（热液过热）**：`thermal_pocket` / `lava_branch` / `collapsed_caldera` —— 多数**探不全**，个别**入口不可达**（过热）。
- **冷极（温跃层下深水冷团/卤水·ch1 已埋引子）**：`black_basin`（设定原文「水非常非常凉」）/ `the_deep_gate`（核心冷+远双锁）/（可选 `drowned_well` 深井冷降流）。
- 其余**中性·全可探**。

### 7. trench 清空 + blue_caves 迁移
- 现有 `blue_caves` 的 **3 个 trench POI**（`poi.anchor.blue_caves` + `poi.anchor.flat_gallery` 横岩廊 + 1 roaming）→ 迁到 **home**（reef 洞）。新洞**永不挂 trench**。

### 8. 实装路线图（按序·解耦）
1. **数据侧**（纯数据·可立即）：`zones.json` 删 5 区 + 中/大/史诗 lc 上调（中 7–9 / 大 12–14 / 史诗 70·depthRange 70–148）+ 同步本 spec JSON。
2. **多口洞 B 架构**（大·单独 epic）：地图持久化 + 多入口节点 + 跨 beacon POI 映射。
3. **chart-POI 接入**：27 洞挂 beacon（§3）+ 跨 beacon 发现门 + blue_caves 迁 home + trench 清空。
4. **温度系统**：与外传同步，或先做 ch1 门控标注（§6）。
5. **事件池 Batch 1–4**（tide/grotto/deep_cave/chasm）照 cave_batch_prompts.md。**区数已更新**：cave 3 · crack 3 · tide 3 · grotto 3 · deep_cave 6（事件数不变·按 tag 共享）。

---

## 设计原则

**尺寸与深度正交**：洞穴大小由地质结构决定，不由深度决定。
- 浅水（8–40m）可以有大型腔室（石拱厅 15–48m · 沙瀑洞 18–50m · 月池穴 20–56m · 镜廊 28–70m）
- 深水（45–90m）也有小的窄缝（石缝 35–65m · 沉烟囱 40–72m · 暗礁巷 45–80m · 沉井 55–90m）
- 大型 `蛇行深处` 在中等深度（35–82m），不一定在最深处

这样设计避免玩家建立"越深越大"的预期，洞穴尺寸成为独立的惊喜维度。

---

## 分批策略

| 批次 | 内容 | 模型 | 前置 |
|------|------|------|------|
| **Batch 0** | zones.json 加 28 区 + ZoneTag + zones.ts 4 条 import + 4 个空 JSON stub | Sonnet | — |
| **Batch 1** | 填 `src/data/events/tide.json`（7 事件） | Sonnet | Batch 0 landing |
| **Batch 2** | 填 `src/data/events/grotto.json`（7 事件） | Sonnet | Batch 0 landing |
| **Batch 3** | 填 `src/data/events/deep_cave.json`（8 事件） | Opus | Batch 0 landing |
| **Batch 4** | 填 `src/data/events/chasm.json`（10 事件） | Opus | Batch 0 landing |

Batch 1–4 在 Batch 0 land 后可**并行**（各自只碰一个文件，无冲突）。

---

## 新 ZoneTag（加入 src/types/events.ts）

```typescript
| 'tide'      // 浅潮洞（8–44m）：潮汐主导、涨退压力、藤壶顶、气腔
| 'grotto'    // 石窟厅（38–82m）：矿物柱、骨床、声学异常、静态美与不安
| 'deep_cave' // 深穴（66–124m）：黑暗+静水+地质+设备边缘
| 'chasm'     // 深裂隙（90–148m）：氮醉边界+设备极限+"这里不像水"
```

加在 `flooded` 那行之后（同一行尾加注释方便溯源）。

---

## 事件池分配

| tag | 区数 | 新事件 | 对应区 |
|-----|------|--------|--------|
| cave | 3 | 0 | reef_pocket, kelp_hollow, wreck_hold（10–42m·blue_caves 池上限 55m 覆盖充分） |
| crack | 3 | 0 | anchor_hollow, limestone_slot, drowned_well |
| tide | 3 | **7** | tidal_seam, tidal_bore_cave, silt_alcove |
| chamber | 3 | 0 | sandfall_cave, blue_throat, lava_branch |
| vent | 1 | 0 | thermal_pocket（热液渗入·复用现有 vent 池） |
| grotto | 3 | **7** | moonpool_cavern, ossuary_passage, submerged_arch |
| deep_cave | 6 | **8** | black_basin, serpentine_deep, collapsed_caldera, mirror_maze + blind_alley + murk_gallery（deep_cave 池覆盖 35–124m·深度足够） |
| chasm | 1 | **10** | the_deep_gate |

---

## 全区 JSON（28 条，按序插入 zones.json 的 zones 数组末尾，位于 flooded_gallery 之后）

### 小洞穴（lc 3–4）

```json
{
  "id": "zone.reef_pocket",
  "name": "礁穴",
  "description": "礁盘下面蚀出来的一道穴，从外面看不出深浅，进去才知道里面有多宽。",
  "depthRange": [12, 28],
  "layerCount": 3,
  "nodesPerLayer": [1, 2],
  "zoneTagsByDepth": [{ "minDepth": 0, "tags": ["cave"] }],
  "requiresFlags": ["flag.tutorial_complete"],
  "generation": "random",
  "mapShape": "maze",
  "depthCurveRange": [0.15, 0.45],
  "canFreeAscend": false,
  "ambushEncounters": ["combat.reef_barracuda_solo"],
  "weakHunts": true,
  "weakHuntEncounters": ["combat.reef_barracuda_juv_solo"]
}
```

```json
{
  "id": "zone.tidal_seam",
  "name": "潮缝",
  "description": "退潮后会露出顶部的横向裂缝，涨潮时水从里面往外压。在里面能感到潮位每几分钟动一下。",
  "depthRange": [8, 25],
  "layerCount": 3,
  "nodesPerLayer": [1, 2],
  "zoneTagsByDepth": [{ "minDepth": 0, "tags": ["tide"] }],
  "requiresFlags": ["flag.tutorial_complete"],
  "generation": "random",
  "mapShape": "maze",
  "depthCurveRange": [1.6, 2.5],
  "canFreeAscend": false,
  "ambushEncounters": ["combat.reef_barracuda_solo"],
  "weakHunts": true,
  "weakHuntEncounters": ["combat.reef_barracuda_juv_solo"]
}
```

```json
{
  "id": "zone.kelp_hollow",
  "name": "藻洞",
  "description": "海藻把洞口堵得只剩一个人能过的缝，里面比外面安静很多，光把藻叶拨开才看得见。",
  "depthRange": [10, 28],
  "layerCount": 3,
  "nodesPerLayer": [1, 2],
  "zoneTagsByDepth": [{ "minDepth": 0, "tags": ["cave"] }],
  "requiresFlags": ["flag.tutorial_complete"],
  "generation": "random",
  "mapShape": "maze",
  "depthCurveRange": [0.9, 1.2],
  "canFreeAscend": false,
  "ambushEncounters": ["combat.reef_barracuda_solo"]
}
```

```json
{
  "id": "zone.anchor_hollow",
  "name": "锚坑",
  "description": "船锚磨出来的沟壑，礁石塌了一段后变成能进人的空间，壁上还留着铁锚刮过的痕迹。",
  "depthRange": [18, 38],
  "layerCount": 4,
  "nodesPerLayer": [1, 2],
  "zoneTagsByDepth": [{ "minDepth": 0, "tags": ["crack"] }],
  "requiresFlags": ["flag.tutorial_complete"],
  "generation": "random",
  "mapShape": "maze",
  "depthCurveRange": [2.0, 3.0],
  "canFreeAscend": false,
  "ambushEncounters": ["combat.blind_eel_solo"],
  "weakHunts": true,
  "weakHuntEncounters": ["combat.blind_eel_juv_solo"]
}
```

```json
{
  "id": "zone.limestone_slot",
  "name": "石缝",
  "description": "石灰岩被水溶出来的竖向窄缝，有些地方要侧身才能过，壁面光滑得像是被磨过。",
  "depthRange": [35, 65],
  "layerCount": 4,
  "nodesPerLayer": [1, 2],
  "zoneTagsByDepth": [{ "minDepth": 0, "tags": ["crack"] }],
  "requiresFlags": ["flag.tutorial_complete"],
  "generation": "random",
  "mapShape": "maze",
  "depthCurveRange": [0.15, 0.5],
  "canFreeAscend": false,
  "ambushEncounters": ["combat.blind_eel_solo"]
}
```


```json
{
  "id": "zone.tidal_bore_cave",
  "name": "浪涌穴",
  "description": "涌浪把礁石里的泥沙冲成了一条水道，海况差时水流能把人推进去，推得比自己想去的还深。",
  "depthRange": [8, 28],
  "layerCount": 3,
  "nodesPerLayer": [1, 2],
  "zoneTagsByDepth": [{ "minDepth": 0, "tags": ["tide"] }],
  "requiresFlags": ["flag.tutorial_complete"],
  "generation": "random",
  "mapShape": "maze",
  "depthCurveRange": [0.1, 0.4],
  "canFreeAscend": false,
  "ambushEncounters": ["combat.reef_barracuda_solo"],
  "weakHunts": true,
  "weakHuntEncounters": ["combat.reef_barracuda_juv_solo"]
}
```


```json
{
  "id": "zone.wreck_hold",
  "name": "舱格",
  "description": "沉船货舱的隔板大多锈穿了，内部连通成一片可以穿行的空间，边角都是生锈的铁和陈年的淤泥。",
  "depthRange": [20, 42],
  "layerCount": 4,
  "nodesPerLayer": [1, 2],
  "zoneTagsByDepth": [{ "minDepth": 0, "tags": ["cave"] }],
  "requiresFlags": ["flag.tutorial_complete"],
  "generation": "random",
  "mapShape": "maze",
  "depthCurveRange": [1.8, 2.8],
  "canFreeAscend": false,
  "ambushEncounters": ["combat.reef_grouper_solo", "combat.reef_barracuda_solo"],
  "weakHunts": true,
  "weakHuntEncounters": ["combat.reef_barracuda_juv_solo"]
}
```

```json
{
  "id": "zone.silt_alcove",
  "name": "淤积凹室",
  "description": "淤泥堆出来的凹室，沉积物深到踩下去没过膝盖。能见度很差，什么都是灰的。",
  "depthRange": [22, 44],
  "layerCount": 4,
  "nodesPerLayer": [1, 2],
  "zoneTagsByDepth": [{ "minDepth": 0, "tags": ["tide"] }],
  "requiresFlags": ["flag.tutorial_complete"],
  "generation": "random",
  "mapShape": "maze",
  "depthCurveRange": [0.9, 1.4],
  "canFreeAscend": false,
  "ambushEncounters": []
}
```

```json
{
  "id": "zone.blind_alley",
  "name": "暗礁巷",
  "description": "两面都是礁壁、中间刚好够一个人游的水道，顶部封死——不能直接往上走，只能往里或往外。",
  "depthRange": [45, 80],
  "layerCount": 3,
  "nodesPerLayer": [1, 2],
  "zoneTagsByDepth": [{ "minDepth": 0, "tags": ["deep_cave"] }],
  "requiresFlags": ["flag.tutorial_complete"],
  "generation": "random",
  "mapShape": "maze",
  "depthCurveRange": [0.8, 1.3],
  "canFreeAscend": false,
  "ambushEncounters": ["combat.reef_barracuda_solo"]
}
```


```json
{
  "id": "zone.drowned_well",
  "name": "沉井",
  "description": "以前是陆地上的水井，海平面涨上来淹掉了。井壁很窄，往下看是黑色，没有底。",
  "depthRange": [55, 90],
  "layerCount": 4,
  "nodesPerLayer": [1, 2],
  "zoneTagsByDepth": [{ "minDepth": 0, "tags": ["crack"] }],
  "requiresFlags": ["flag.tutorial_complete"],
  "generation": "random",
  "mapShape": "maze",
  "depthCurveRange": [0.1, 0.4],
  "canFreeAscend": false,
  "ambushEncounters": ["combat.blind_eel_solo"]
}
```

### 中型洞穴（lc 7–9）

```json
{
  "id": "zone.moonpool_cavern",
  "name": "月池穴",
  "description": "洞顶有一个圆形的开口，满月时光能从那里送进来。水面以下是另一条路，不通那个开口。",
  "depthRange": [20, 56],
  "layerCount": 8,
  "nodesPerLayer": [2, 3],
  "zoneTagsByDepth": [{ "minDepth": 0, "tags": ["grotto"] }],
  "requiresFlags": ["flag.tutorial_complete"],
  "generation": "random",
  "mapShape": "maze",
  "depthCurveRange": [2.0, 3.0],
  "canFreeAscend": false,
  "ambushEncounters": ["combat.cave_octopus_solo", "combat.blind_eel_solo"],
  "weakHunts": true,
  "weakHuntEncounters": ["combat.blind_eel_juv_solo"]
}
```

```json
{
  "id": "zone.ossuary_passage",
  "name": "骨道",
  "description": "水道两侧的礁壁里嵌着动物骨骼——鱼骨、鸟骨，还有一些说不上来是什么形状的。",
  "depthRange": [42, 78],
  "layerCount": 7,
  "nodesPerLayer": [2, 3],
  "zoneTagsByDepth": [{ "minDepth": 0, "tags": ["grotto"] }],
  "requiresFlags": ["flag.tutorial_complete"],
  "generation": "random",
  "mapShape": "maze",
  "depthCurveRange": [0.9, 1.3],
  "canFreeAscend": false,
  "ambushEncounters": ["combat.blind_eel_solo"]
}
```

```json
{
  "id": "zone.sandfall_cave",
  "name": "沙瀑洞",
  "description": "白沙从洞顶的裂缝里慢慢往下沉，像把一场雪封进水里。深处看不见沙从哪里来。",
  "depthRange": [18, 50],
  "layerCount": 8,
  "nodesPerLayer": [2, 3],
  "zoneTagsByDepth": [{ "minDepth": 0, "tags": ["chamber"] }],
  "requiresFlags": ["flag.tutorial_complete"],
  "generation": "random",
  "mapShape": "maze",
  "depthCurveRange": [0.25, 0.6],
  "canFreeAscend": false,
  "ambushEncounters": ["combat.blind_eel_solo", "combat.cave_octopus_solo"],
  "weakHunts": true,
  "weakHuntEncounters": ["combat.blind_eel_juv_solo"]
}
```


```json
{
  "id": "zone.blue_throat",
  "name": "蓝喉",
  "description": "洞口是蓝色的——光在水里折射让里面比外面蓝一个等级。进去以后蓝色不见了。",
  "depthRange": [32, 72],
  "layerCount": 9,
  "nodesPerLayer": [2, 3],
  "zoneTagsByDepth": [{ "minDepth": 0, "tags": ["chamber"] }],
  "requiresFlags": ["flag.tutorial_complete"],
  "generation": "random",
  "mapShape": "maze",
  "depthCurveRange": [0.15, 0.5],
  "canFreeAscend": false,
  "ambushEncounters": ["combat.blind_eel_solo", "combat.cave_octopus_solo"],
  "weakHunts": true,
  "weakHuntEncounters": ["combat.blind_eel_juv_solo"]
}
```

```json
{
  "id": "zone.thermal_pocket",
  "name": "热水窟",
  "description": "热液从岩壁的裂缝里渗出来，水是温的，矿物的味道隔着调节器还是尝得到。",
  "depthRange": [52, 86],
  "layerCount": 7,
  "nodesPerLayer": [2, 3],
  "zoneTagsByDepth": [{ "minDepth": 0, "tags": ["vent"] }],
  "requiresFlags": ["flag.tutorial_complete"],
  "generation": "random",
  "mapShape": "maze",
  "depthCurveRange": [2.2, 3.2],
  "canFreeAscend": false,
  "ambushEncounters": ["combat.blind_eel_solo"]
}
```

```json
{
  "id": "zone.submerged_arch",
  "name": "沉拱厅",
  "description": "坍塌的石拱还保持着弧形，在水里没有倒。穿过拱门是另一段水道，拱顶上面是实心的。",
  "depthRange": [15, 48],
  "layerCount": 8,
  "nodesPerLayer": [2, 3],
  "zoneTagsByDepth": [{ "minDepth": 0, "tags": ["grotto"] }],
  "requiresFlags": ["flag.tutorial_complete"],
  "generation": "random",
  "mapShape": "maze",
  "depthCurveRange": [0.9, 1.4],
  "canFreeAscend": false,
  "ambushEncounters": ["combat.cave_octopus_solo"]
}
```

```json
{
  "id": "zone.lava_branch",
  "name": "熔管岔道",
  "description": "火山熔岩管道被海水灌进来，分岔处的形状像是被什么东西从里面撑开的。",
  "depthRange": [55, 90],
  "layerCount": 9,
  "nodesPerLayer": [2, 3],
  "zoneTagsByDepth": [{ "minDepth": 0, "tags": ["chamber"] }],
  "requiresFlags": ["flag.tutorial_complete"],
  "generation": "random",
  "mapShape": "maze",
  "depthCurveRange": [0.2, 0.55],
  "canFreeAscend": false,
  "ambushEncounters": ["combat.blind_eel_solo"]
}
```

```json
{
  "id": "zone.murk_gallery",
  "name": "浑水廊",
  "description": "能见度只有一两米。水不是浑的，是暗的——光在这里消耗得比别处快，越往里越不够用。",
  "depthRange": [48, 84],
  "layerCount": 7,
  "nodesPerLayer": [2, 3],
  "zoneTagsByDepth": [{ "minDepth": 0, "tags": ["deep_cave"] }],
  "requiresFlags": ["flag.tutorial_complete"],
  "generation": "random",
  "mapShape": "maze",
  "depthCurveRange": [1.8, 2.8],
  "canFreeAscend": false,
  "ambushEncounters": ["combat.blind_eel_solo", "combat.cave_octopus_solo"]
}
```

### 大型洞穴（lc 12–14）


```json
{
  "id": "zone.black_basin",
  "name": "黑水盆",
  "description": "盆地形的深穴，水从四周往里聚，没有出水口。水只是在这里停着，非常非常凉。",
  "depthRange": [76, 120],
  "layerCount": 12,
  "nodesPerLayer": [2, 3],
  "zoneTagsByDepth": [{ "minDepth": 0, "tags": ["deep_cave"] }],
  "requiresFlags": ["flag.tutorial_complete"],
  "generation": "random",
  "mapShape": "maze",
  "depthCurveRange": [0.15, 0.45],
  "canFreeAscend": false,
  "ambushEncounters": ["combat.blind_eel_solo"]
}
```

```json
{
  "id": "zone.serpentine_deep",
  "name": "蛇行深处",
  "description": "水道一直在转，很难辨认来路。向导手册里把这种地形叫做「蛇形」，旁边标了红色。",
  "depthRange": [35, 82],
  "layerCount": 13,
  "nodesPerLayer": [2, 3],
  "zoneTagsByDepth": [{ "minDepth": 0, "tags": ["deep_cave"] }],
  "requiresFlags": ["flag.tutorial_complete"],
  "generation": "random",
  "mapShape": "maze",
  "depthCurveRange": [0.9, 1.5],
  "canFreeAscend": false,
  "ambushEncounters": ["combat.blind_eel_solo", "combat.cave_octopus_solo"]
}
```

```json
{
  "id": "zone.collapsed_caldera",
  "name": "塌陷火口",
  "description": "火山口坍塌后灌了海水，熔岩凝固时留下的蜂巢或者蛛网形状还在，静静地在水里。",
  "depthRange": [80, 124],
  "layerCount": 14,
  "nodesPerLayer": [2, 3],
  "zoneTagsByDepth": [{ "minDepth": 0, "tags": ["deep_cave"] }],
  "requiresFlags": ["flag.tutorial_complete"],
  "generation": "random",
  "mapShape": "maze",
  "depthCurveRange": [2.0, 3.5],
  "canFreeAscend": false,
  "ambushEncounters": ["combat.blind_eel_solo"]
}
```

```json
{
  "id": "zone.mirror_maze",
  "name": "镜廊",
  "description": "石壁是浅色的，反光效果让人以为某条水道还有另一条对称的。有人在这里走失了。",
  "depthRange": [28, 70],
  "layerCount": 13,
  "nodesPerLayer": [2, 3],
  "zoneTagsByDepth": [{ "minDepth": 0, "tags": ["deep_cave"] }],
  "requiresFlags": ["flag.tutorial_complete"],
  "generation": "random",
  "mapShape": "maze",
  "depthCurveRange": [1.8, 3.2],
  "canFreeAscend": false,
  "ambushEncounters": ["combat.cave_octopus_solo"]
}
```

### 史诗洞穴（lc 70·独立设计）

```json
{
  "id": "zone.the_deep_gate",
  "name": "深门",
  "description": "没有记录在任何海图上。水在这个深度开始变得不像水——更重，更暗，更难穿过。进去过的人没有一个描述过里面的样子。",
  "depthRange": [70, 148],
  "layerCount": 70,
  "nodesPerLayer": [2, 3],
  "zoneTagsByDepth": [{ "minDepth": 0, "tags": ["chasm"] }],
  "requiresFlags": ["flag.tutorial_complete"],
  "generation": "random",
  "mapShape": "maze",
  "depthCurveRange": [0.5, 2.5],
  "canFreeAscend": false,
  "ambushEncounters": ["combat.blind_eel_solo"]
}
```

---

## 事件池设计指引

### 全局语调约束（所有 4 个池）

> 语调**单一来源**＝`docs/spec/深海回响_剧情_SPEC.md §2` + `scripts/check-protagonist-voice.mjs`（regress 门·quirk #184）；本节为洞穴池写作引用，禁词以那条为准。

- **主角冷静寡言**：身体反应（手抖、耳鸣、呼吸节奏）替代直白情绪描写，禁"感到害怕"/"心跳加速"等词
- **零机制解释**：不说"这会减少你的氧气"——只说动作，后果由 UI 传达
- **死亡不做戏剧化处理**：第一章里死亡是意外，不是命运；不用"命悬一线"类词
- **一句话不能代替一个细节**：每个事件应有1个值得被记住的具体细节（藤壶高水线痕迹 / 骨骼形状 / 声音方向错了）

### tide 池（7 事件，8–44m，Sonnet）
浅水·潮汐主导·涨退节律·物理真实  
事件 id 前缀：`tide.*`  
参考：shaft_crack.json 的写法（短句·具体物体·realistic tone 为主）

建议事件主题（供参考，执行 session 可改细节）：
1. `tide.surge` — 水流把你往里推了半米，比你想去的还深
2. `tide.barnacle_ceiling` — 藤壶顶上的高水线，这洞满潮时全在水下
3. `tide.trapped_air` — 顶部凹处有一个气腔，是涨潮前就封住的老气
4. `tide.tidal_creature` — 等潮的东西，在出口附近很有耐心地等着
5. `tide.pressure_shift` — 水压在几秒里微变，感受得到涨潮
6. `tide.silt_bloom` — 退潮留下的沙泥像烟一样被脚搅起来，能见度到零
7. `tide.watermark` — 壁上好几道颜色，每道都是历年高潮线

### grotto 池（7 事件，38–82m，Sonnet）
石窟腔室·矿物形成·声学·骨骼·深度初始神秘感  
事件 id 前缀：`grotto.*`  
参考：chamber_network.json（节奏略慢·uncanny 可以出现）

建议事件主题：
1. `grotto.crystal_column` — 矿物柱，在水里不应该是这个形状
2. `grotto.bone_bed` — 洞底积了很多动物骨头
3. `grotto.acoustic_node` — 声音从错的方向回来
4. `grotto.moonpool_light` — 洞顶开口，光能送进来，但不是出口
5. `grotto.sulfur_seep` — 化学渗出，水的化学成分和外面不一样
6. `grotto.old_anchor` — 锚，在这里没有理由出现
7. `grotto.dark_corner` — 灯照不到的角落，没有确认里面有什么

### deep_cave 池（8 事件，66–124m，Opus）
深穴黑暗·静水·地质异常·设备边缘·压力感受  
事件 id 前缀：`deep_cave.*`  
Tone 应有 uncanny 比例；主角开始注意到自己身体的信号，不解释，只描述

建议事件主题：
1. `deep_cave.column_shard` — 地质柱被什么截断的，截面很整齐
2. `deep_cave.still_water` — 一层绝对静止的水，没有任何流动
3. `deep_cave.wall_marking` — 壁上的痕迹，可能是自然的，可能不是
4. `deep_cave.dead_vent` — 死热液口，矿物留下，水是温的，已经不出烟了
5. `deep_cave.echo_delay` — 回声来得太慢，或者从错的方向来
6. `deep_cave.gauge_drift` — 深度仪读数跳了一下，然后回来了
7. `deep_cave.the_quiet` — 这个深度的安静是特别的一种安静
8. `deep_cave.passage_use` — 有规律使用这条路的迹象，不是人类的迹象

### chasm 池（10 事件，90–148m，Opus）
极深·氮醉边界·设备极限·感知扭曲·「水不像水了」·强叙事分量  
事件 id 前缀：`chasm.*`  
Tone 以 uncanny → cosmic 渐进；参考 deep_game_vision.md「越深越欺骗」轴  
**注意**：不对抗欺骗轴——仪器可以是错的，感知可以是不可信的，不要「真相揭露」类结局

建议事件主题：
1. `chasm.entry_quality` — 洞在某个深度开始不一样，你能注意到那条线
2. `chasm.nitrogen_edge` — 氮醉边缘：某个决定感觉比平时容易
3. `chasm.equipment_limit` — 压力表/调节器在额定深度最低一格
4. `chasm.no_bottom` — 往下看，没有底，不只是暗，是没有
5. `chasm.orientation_slip` — 一秒钟搞不清哪边是上，然后搞清楚了
6. `chasm.shape_far` — 灯光边缘有一个形状，不动，不够近确认是什么
7. `chasm.old_line` — 旧绳，从更深的地方接上来，另一头在你下面
8. `chasm.the_weight` — 压力在这个深度有重量，能感受到它在胸腔上
9. `chasm.return_impulse` — 突然非常想上去，不是因为什么，就是要上去
10. `chasm.far_wall` — 终于看见对面的壁，距离比预期的近，形状比预期的规整

---

## 后续（不在本批次）

- Chart POI 接入：全 28 区最终接海图 POI，留给独立 session
- zone.horizontal_test 接 chart POI（开发验收用）
- St2 空白结局 + 录音第 1 段（叙事线）
- 数值调整留最后一次性调（defer-number-tuning.md）
