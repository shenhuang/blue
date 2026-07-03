# 洞穴扩充 批次生成 Prompt

> 状态：**Batch 0–4 均已落 main（历史执行记录·作只读参考）**——事件池等对应 roadmap E1–E4 已完工，见 `cave_roadmap.md` 顶部状态（2026-06-27 核对：roadmap 9/10 项落地，仅 T2b 深门未做）。本文件的 prompt 文本已过时（不必按此重跑），仅留存当初的车道划分与执行顺序供参考。
>
> 配套 cave_zones_spec.md（28 区参数）  
> 执行顺序：Batch 0 先跑并 land → Batch 1/2/3/4 并行

---

## Batch 0：基建层（Sonnet 足够）

**PSM 命令（在 main 树跑）：**
```bash
node scripts/psm.mjs start cave-infra \
  --lane "src/data/zones.json,src/types/events.ts,src/engine/zones.ts,src/data/events/tide.json,src/data/events/grotto.json,src/data/events/deep_cave.json,src/data/events/chasm.json"
```

---

**Prompt（粘贴到新 session 起手）：**

```
你在开发「深海回响」（Blue，~/Desktop/Blue）。本 session 是「洞穴扩充 Batch 0」——基建层，只做结构·不写事件内容。

先定位：
  git log -3 && git status

然后读方案：
  docs/spec/cave_zones_spec.md   ← 全部 28 区 JSON 参数在这里

本次任务（严格按顺序）：

① 把 docs/spec/cave_zones_spec.md 里的 28 个 JSON 对象全部追加进
   src/data/zones.json 的 "zones" 数组末尾（在 flooded_gallery 条目之后·别动现有条目）。

② 在 src/types/events.ts 的 ZoneTag union 末尾（flooded 那行之后）加 4 条：
     | 'tide'       // 浅潮洞（8–44m）
     | 'grotto'     // 石窟厅（20–82m）
     | 'deep_cave'  // 深穴（35–124m）
     | 'chasm'      // 深裂隙（90–148m）

③ 在 src/data/events/ 目录创建 4 个 stub 文件（内容只是最小骨架，Batch 1–4 再填）：
   - tide.json:       { "events": [] }
   - grotto.json:     { "events": [] }
   - deep_cave.json:  { "events": [] }
   - chasm.json:      { "events": [] }

④ 在 src/engine/zones.ts 的 import 段末尾（floodedGalleryEvents 之后）加 4 条 import，
   并在 EVENT_DB 填充段末尾加 4 条对应的 for 循环：
   import tideEvents from '@/data/events/tide.json';
   import grottoEvents from '@/data/events/grotto.json';
   import deepCaveEvents from '@/data/events/deep_cave.json';
   import chasmEvents from '@/data/events/chasm.json';
   // for 循环附注释（参考 floodedGallery 那行的注释风格）

⑤ 验证：
   npm run regress:quick
   如果 typecheck 通过即可 commit。

Commit message（PSM 约定）：
  feat(zones): add 28 cave zones + 4 new ZoneTags (tide/grotto/deep_cave/chasm)

完成后：node scripts/psm.mjs land cave-infra
```

---

## Batch 1：tide 事件池（Sonnet）

**前置**：Batch 0 已 land（main 已有 tide.json stub + ZoneTag）

**PSM 命令：**
```bash
node scripts/psm.mjs start cave-tide --lane "src/data/events/tide.json"
```

---

**Prompt：**

```
你在开发「深海回响」（Blue，~/Desktop/Blue）。本 session 是「洞穴扩充 Batch 1」——写 tide 事件池。

先读：
  src/data/events/shaft_crack.json   ← 文风/格式参考
  src/data/events/reef.json          ← 浅水语调参考
  docs/spec/cave_zones_spec.md       ← tide 池设计指引（"### tide 池"一节）

任务：填写 src/data/events/tide.json，写 7 个事件。

每个事件写完整的 DiveEvent 结构（见 shaft_crack.json 格式）。

约束：
- id 前缀：tide.*（例：tide.surge）
- depthRange：8–44 之间选合理区间
- zoneTags：["tide"]
- tone："realistic"（tide 池是浅水，主要 realistic，个别可用 uncanny）
- 每个事件 2–3 个 option；至少一个无代价 option
- 不解释机制（oxygenTurnCost 直接写数字，不在 body/option 里说「这会消耗你的氧气」）
- 主角语调：冷静寡言·身体反应替代情绪词·参考 shaft_crack.json 的句子密度

7 个事件主题（可微调细节，但主题不离这个方向）：
1. tide.surge — 水流把你往里推了半米
2. tide.barnacle_ceiling — 藤壶顶上的高水线
3. tide.trapped_air — 顶部气腔是涨潮前封住的老气
4. tide.tidal_creature — 在出口附近等潮的东西
5. tide.pressure_shift — 感受得到涨潮的水压微变
6. tide.silt_bloom — 退潮沙泥被搅起，能见度到零
7. tide.watermark — 壁上好几道颜色，每道都是历年高潮线

完成后跑：
  npm run regress:quick

Commit message：
  content(events): add tide event pool (7 events)

完成后：node scripts/psm.mjs land cave-tide
```

---

## Batch 2：grotto 事件池（Sonnet）

**前置**：Batch 0 已 land

**PSM 命令：**
```bash
node scripts/psm.mjs start cave-grotto --lane "src/data/events/grotto.json"
```

---

**Prompt：**

```
你在开发「深海回响」（Blue，~/Desktop/Blue）。本 session 是「洞穴扩充 Batch 2」——写 grotto 事件池。

先读：
  src/data/events/chamber_network.json   ← 文风参考（石窟·节奏略慢）
  src/data/events/flooded_gallery.json   ← uncanny 语调参考
  docs/spec/cave_zones_spec.md           ← grotto 池设计指引（"### grotto 池"一节）

任务：填写 src/data/events/grotto.json，写 7 个事件。

约束：
- id 前缀：grotto.*
- depthRange：20–82 之间选合理区间（grotto 区在这个深度带）
- zoneTags：["grotto"]
- tone：realistic 和 uncanny 混用；这个深度已经够远，uncanny 是正常的
- 每个事件 2–3 个 option；至少一个无额外代价 option
- 不解释机制（同 Batch 1 要求）
- 主角语调：克制·细节具体·骨骼形状/声音方向/矿物质感这类具体物体描写

7 个事件主题：
1. grotto.crystal_column — 矿物柱，在水里不应该是这个形状
2. grotto.bone_bed — 洞底积了很多动物骨头
3. grotto.acoustic_node — 声音从错的方向回来
4. grotto.moonpool_light — 洞顶开口，光能送进来，但那不是出口
5. grotto.sulfur_seep — 化学渗出，水的味道和外面不一样
6. grotto.old_anchor — 锚，在这里没有理由出现
7. grotto.dark_corner — 灯照不到的角落，没有确认里面有什么

完成后跑：
  npm run regress:quick

Commit message：
  content(events): add grotto event pool (7 events)

完成后：node scripts/psm.mjs land cave-grotto
```

---

## Batch 3：deep_cave 事件池（Opus）

**前置**：Batch 0 已 land

**PSM 命令：**
```bash
node scripts/psm.mjs start cave-deep --lane "src/data/events/deep_cave.json"
```

---

**Prompt：**

```
你在开发「深海回响」（Blue，~/Desktop/Blue）。本 session 是「洞穴扩充 Batch 3」——写 deep_cave 事件池。

注意：deep_cave 标签同时服务两类区：
① 大型深穴（trench_hall/black_basin/serpentine_deep/collapsed_caldera/mirror_maze，35–124m）
② 中深度窄道（blind_alley 45–80m·murk_gallery 48–84m）——cave 池上限 55m，这两个区超出后用 deep_cave 池兜底。

事件不要假设腔室宽大——「静水层」「回声来错了方向」「深度仪漂了一下」在 45m 的石缝里和在 100m 的大洞里都成立。
核心感受是黑暗+封闭+感知不可信，与空间大小无关。

先读：
  src/data/events/flooded_gallery.json   ← 氛围参考（长廊感·黑暗）
  src/data/events/shaft_crack.json       ← 主角身体反应的写法
  docs/spec/cave_zones_spec.md           ← deep_cave 池设计指引（"### deep_cave 池"一节）

重要语调文件（必读）：
  docs/archive/CHANGELOG.md            ← 搜 "主角语调" 或读最近几条了解风格
  （或参考 memory 摘要：主角冷静寡言·禁止"感到害怕"类直白情绪词·身体反应替代）

任务：填写 src/data/events/deep_cave.json，写 8 个事件。

约束：
- id 前缀：deep_cave.*
- depthRange：35–124 之间选合理区间
- zoneTags：["deep_cave"]
- tone：uncanny 为主·有 1–2 个可以是 cosmic·realistic 控制在 1–2 个
- 每个事件 2–3 个 option
- 不解释机制
- 地质/物理细节要具体：截面的角度、水的温度变化、回声延迟的秒数

8 个事件主题：
1. deep_cave.column_shard — 地质柱被某种力截断，截面整齐
2. deep_cave.still_water — 一层绝对静止的水，没有任何流动
3. deep_cave.wall_marking — 壁上的痕迹，可能是自然的
4. deep_cave.dead_vent — 死热液口，矿物留下，水是温的
5. deep_cave.echo_delay — 回声来得太慢，或从错的方向来
6. deep_cave.gauge_drift — 深度仪读数跳了一下，然后回来了
7. deep_cave.the_quiet — 这个尺度的洞里的安静是特别的
8. deep_cave.passage_use — 有规律使用这条路的迹象，不是人类的

完成后跑：
  npm run regress:quick

Commit message：
  content(events): add deep_cave event pool (8 events)

完成后：node scripts/psm.mjs land cave-deep
```

---

## Batch 4：chasm 事件池（Opus）

**前置**：Batch 0 已 land

**PSM 命令：**
```bash
node scripts/psm.mjs start cave-chasm --lane "src/data/events/chasm.json"
```

---

**Prompt：**

```
你在开发「深海回响」（Blue，~/Desktop/Blue）。本 session 是「洞穴扩充 Batch 4」——写 chasm 事件池（史诗区「深门」·90–148m）。这是本轮最难的一批：深度最大、叙事分量最重、需要最好的写法。

先读（全部必读）：
  src/data/events/flooded_gallery.json   ← 长廊感参考
  src/data/events/vent.json              ← 极深感参考
  docs/spec/cave_zones_spec.md           ← chasm 池设计指引（"### chasm 池"一节）

核心设计轴（来自 deep_game_vision.md 的摘要，必须遵守）：
  「越深越欺骗」——仪器可以是错的，感知可以不可信，但不要写「真相揭露」类结局。
  玩家在这个深度做的每个决定都更难确认是否正确，而游戏不告诉他答案。

语调约定：
  - 主角身体反应替代情绪词：手不稳、呼吸节奏变了、眼皮重——不写"感到恐惧"
  - 禁止英雄主义或「命悬一线」戏剧化
  - 氮醉症状要写成「好像某个决定比平时容易」而非「头晕目眩」
  - 设备在这个深度要处于有趣的模糊状态（是故障还是本来如此？不确认）

任务：填写 src/data/events/chasm.json，写 10 个事件。

约束：
- id 前缀：chasm.*
- depthRange：90–148
- zoneTags：["chasm"]
- tone：uncanny 和 cosmic 为主；realistic 可出现在设备相关事件
- 每个事件 2–3 个 option；选项要体现「在这个深度做决定的重量」
- 不解释机制
- 物理感受细节：压强感、温度层、光的消失方式、水的质感变化

10 个事件主题：
1. chasm.entry_quality — 洞在某个深度开始不一样，你能注意到那条线
2. chasm.nitrogen_edge — 氮醉边缘：某个决定感觉比平时容易
3. chasm.equipment_limit — 压力表/调节器在额定深度最低一格
4. chasm.no_bottom — 往下看，没有底，不只是暗，是没有
5. chasm.orientation_slip — 一秒钟搞不清哪边是上
6. chasm.shape_far — 灯光边缘有一个形状，不动，不够近确认
7. chasm.old_line — 旧绳，另一头在你下面，往更深的地方接
8. chasm.the_weight — 压力在这个深度有重量，感受得到它在胸腔上
9. chasm.return_impulse — 突然非常想上去，不是因为什么，就是要上去
10. chasm.far_wall — 终于看见对面的壁，距离比预期近，形状比预期规整

完成后跑：
  npm run regress:quick

Commit message：
  content(events): add chasm event pool (10 events)

完成后：node scripts/psm.mjs land cave-chasm
```

---

## 执行顺序总结

```
Batch 0 (Sonnet)  →  land cave-infra
        ↓
  ┌─────┴─────────┬──────────┐
Batch 1  Batch 2  Batch 3   Batch 4
(Sonnet) (Sonnet) (Opus)    (Opus)
 tide     grotto  deep_cave  chasm
  ↓         ↓        ↓         ↓
 land      land     land      land
```

Batch 1–4 并行·各自只碰自己的事件文件·无冲突。
