# 洞穴系统 实装 Roadmap（顺序 / 并行 / prompt / 模型）

> 真相源 = `cave_zones_spec.md` 的「设计章 v2」。本文件只排**怎么执行**。
> 各 prompt 粘贴到新 session 起手即可；PSM 命令在 main 树跑。

---

## 依赖图

```
立刻可并行（互不碰文件·各自一条 PSM 车道）:

  T1  数据侧 cut+lc ........ zones.json + spec
  E1  tide 事件池 .......... events/tide.json
  E2  grotto 事件池 ........ events/grotto.json
  E3  deep_cave 事件池 ..... events/deep_cave.json
  E4  chasm 事件池 ......... events/chasm.json
  T2  B 持久多口图 ......... engine（独占 mapgen/dive/state/sonar·**长杆**·先确认 orientation 不在飞）

依赖（等前置 land 后开）:

  T3a chart 基础接线 ....... ← T1
  T3b 跨 beacon 多口 ....... ← T2 + T3a（不含深门）
  T4  温度系统 ............. ← T1（zones 热/冷标注撞 T1）· 与 T2 协调 dive/state 类型
                              ↳ 想让 T4 并行：把温度做成独立侧表（cave_temperature.json 按 zoneId·
                                类型放温度自有文件），就不碰 zones.json/dive.ts → 可与 T1/T2 并行
  T2b 深门 循环再生洞 ...... ← T2 · ⏳最后期（初期完全不做）
```

**审查结论**：T1 ∥ E1 ∥ E2 ∥ E3 ∥ E4 ∥ T2 六条车道**文件完全不相交·真并行**（已核：events 不碰 zones.ts·删区不孤儿化 tag）。T2 是**长杆**（独占 mapgen/dive/state·会挡住 T4 和后续引擎活·尽早起、尽快收）。T4 默认**后于 T1 + 协调 T2**；要并行就解耦成独立侧表。T3a←T1·T3b←T2+T3a·T2b←T2(最后期)。

**并行说明**：T1 + E1–E4 五条文件完全不相交，可同时开五个 session。T2/T4 是引擎 epic，与数据/事件并行没问题，但**两者都可能碰 `state.ts`/`dive.ts` → 互相协调**；且 **T2 独占 `mapgen.ts`**，必须和 cave-mapgen（orientation）线**串行**（orientation 先 land 或并入 T2）。T3 是接线收口，等 T1（基础）/T2（多口）就绪。

## 模型 + 车道 速查

| 任务 | 模型 | 依赖 | PSM 车道（关键文件） |
|---|---|---|---|
| **T1** 数据 cut+lc | Sonnet | — | `zones.json` · `cave_zones_spec.md` |
| **E1** tide 池 | Sonnet | — | `events/tide.json` |
| **E2** grotto 池 | Sonnet | — | `events/grotto.json` |
| **E3** deep_cave 池 | **Opus** | — | `events/deep_cave.json` |
| **E4** chasm 池 | **Opus** | — | `events/chasm.json` |
| **T2** B 持久多口图 | **Opus** | —（独占 mapgen） | `engine/mapgen.ts` · `types/dive.ts` · `engine/state.ts` · `ui/SonarScanPanel.ts` |
| **T2b** 深门循环再生洞 | **Opus** | T2 · ⏳最后期 | 新 `engine/<深门循环洞模块>`（初期不做） |
| **T4** 温度系统 | **Opus** | T1 + 协调 T2（或解耦侧表则并行） | 新 `engine/temperature.ts` · 温度侧表/类型（避开 zones.json/dive.ts 即可并行） |
| **T3a** chart 基础接线 | Sonnet | T1 | `data/chart_pois.json` · `chart_regions.json` |
| **T3b** 跨 beacon 多口 | **Opus** | T2+T3a（深门口需 T2b） | `data/chart_pois.json` |

模型逻辑：纯数据/配置/浅水文案 → Sonnet；深水叙事（deep_cave/chasm·氮醉/欺骗轴）+ 引擎架构（B/温度）+ 跨 beacon 图推理 → Opus。

---

## T1 · 数据侧 cut + lc（Sonnet）

```bash
node scripts/psm.mjs start cave-data --lane "src/data/zones.json,docs/spec/cave_zones_spec.md"
```

```
你在开发「深海回响」（Blue，~/Desktop/Blue）。本 session：洞穴重规划「数据侧」——删 5 区 + 调 lc，纯数据零引擎改。

先读：docs/spec/cave_zones_spec.md 的「设计章 v2」§1（尺寸 lc）+ §2（删除清单）。

任务：
① zones.json 删 5 个 zone 对象：zone.coral_grotto · zone.sunken_chimney · zone.sea_arch_cave · zone.echo_cavern · zone.trench_hall。
② 按 §1 上调 layerCount：所有「中型」zone（原 lc 5–7）→ 7–9；「大型」（原 9–11）→ 12–14；史诗 zone.the_deep_gate → lc 70 且 depthRange 改 [70,148]。逐 zone 在新区间取合理值（数值占位·见 defer-number-tuning）。
③ 同步 cave_zones_spec.md 下方「全区 JSON」对应块（删 5 块·改 lc/depthRange）+「事件池分配」表区数（cave/crack/tide/grotto 各 −1·deep_cave −1）。
④ grep 确认 5 个 zone id 无 zones.json 外引用（应为 0）。

验证：npm run regress:quick（typecheck 绿）。别碰事件/引擎文件。

commit: refactor(zones): cave 重规划数据侧 — 删 5 区(→23) + 中/大/史诗 lc 上调
```
`node scripts/psm.mjs land cave-data`

---

## E1–E4 · 四个事件池（tide/grotto = Sonnet·deep_cave/chasm = Opus）

**4 个池仍是空 stub（0 事件）**，照 `cave_batch_prompts.md` 的 Batch 1/2/3/4 原 prompt 执行（事件设计未变·各 7/7/8/10 事件）。四条车道互不相交，可同时开：

```bash
node scripts/psm.mjs start cave-tide   --lane "src/data/events/tide.json"       # E1 Sonnet
node scripts/psm.mjs start cave-grotto --lane "src/data/events/grotto.json"     # E2 Sonnet
node scripts/psm.mjs start cave-deep   --lane "src/data/events/deep_cave.json"  # E3 Opus
node scripts/psm.mjs start cave-chasm  --lane "src/data/events/chasm.json"      # E4 Opus
```

prompt 直接用 cave_batch_prompts.md 对应 Batch 段；验证 `npm run regress:quick`，land 各自车道。

---

## T2 · B 持久大图 多口洞架构（Opus · 架构 epic）

```bash
node scripts/psm.mjs start cave-bmap --lane "src/engine/mapgen.ts,src/types/dive.ts,src/engine/state.ts,src/engine/dive.ts,src/ui/SonarScanPanel.tsx,src/ui/mapLayout.ts"
```

```
你在开发「深海回响」（Blue，~/Desktop/Blue）。本 session：洞穴「多口持久大图」架构（方案 B）——这是有分量的架构件，先写子-spec 再实装。

先读：docs/spec/cave_zones_spec.md「设计章 v2」§5（多口洞 B）+ §1（出入口数）；docs/QUIRKS.md 搜「地图不入存档」「位置即深度」#92/#93/#114；src/engine/mapgen.ts（generateMazeMap）。

⚠️ 独占 mapgen.ts：先确认 cave-mapgen（orientation）线已 land 或不在飞，否则协调，别并发改 mapgen。

第一步——写实装子-spec（docs/spec/深海回响_多口持久洞_SPEC.md），定清楚：
- 持久地图数据模型（一张图入存档·SAVE_VERSION bump·序列化形状）
- 入口 vs 出口（见 spec §1）：**入口节点**=带 POI（可下潜起手·按尺寸 1/1–2/2–3/6 个）；**出口节点**=ascent-only 非 POI（每洞 ≥1·穿流泄流口/烟囱/塌口·能出不能进）。核心离所有入口最远的放置规则。
- 跨 beacon POI → 入口节点映射（POI 带 entryNodeId/区域偏置）
- **可扩展性（硬要求·spec §5）**：地图与「POI→入口节点」绑定**解耦、数据驱动、可增量扩**——未来加大洞=追加段/节点（数据）；别处（任意 beacon）加口=加一条 binding 绑到入口节点，**不重生、不改码**。口数/形状一律当数据，别写死进生成逻辑。
- **史诗复合洞拆给 T2b**（依赖本棒）；本棒先把普通持久多口图 + 上述绑定/可扩展模型跑通。
- 重生 vs 持久：同洞再进续上次状态（料/尸/已探）
- 声呐图/海图渲染如何画「同一张图的不同已探片」+ 海图上 N 个口标成同一洞（连线/同色/命名）
- 与 #98 同地点同 seed、#92 位置即深度 的关系

第二步——按子-spec 增量实装，每步过 regress；持久化、多入口、跨 beacon 映射可分 PR。**先把结构和存档形状立住（typecheck + save playthrough 绿），渲染细节可后续。**

commit 按增量分；land cave-bmap。
```

---

## T2b · 深门 循环再生洞「会呼吸的洞」（Opus · 依赖 T2 · ⏳ 最后期 · 初期不做）

> **不在初期范围**——`the_deep_gate` 初期只在 zones.json 留占位、**不接 POI、不做内容**。本棒排到所有其它洞穴任务都收口之后。先写子-spec，规模/数值后调。

```bash
node scripts/psm.mjs start cave-deepgate --lane "src/engine/<深门循环洞模块>,docs/spec/深海回响_深门循环洞_SPEC.md"
```

```
你在开发「深海回响」（Blue，~/Desktop/Blue）。本 session：深门（the_deep_gate）= 循环再生洞「会呼吸的洞」。后期专项·先写子-spec 再码。

前置：其它洞穴任务收口·cave-bmap（T2）已 land。先读 cave_zones_spec.md §5「深门 = 循环再生洞」那条（设计核心）。

它不是静态大迷宫，是一套循环系统，子-spec 要定清：
- 月相/周期时钟：最多 6 口·每回合开放口数变化·随周期推移（周期长度 / 与游戏回合换算）
- 由深到浅渐次开放的口序
- 全闭 → 再生：模板库（多种洞型段/腔室）+ 拼接算法 → 每周期重拼新内部
- 口部固定（手编锚定段）+ 深处随机 的混合地图：哪段固定、从哪阶段转随机
- 「持久」语义：口部固定段稳定·深处随周期重置（≠ 普通洞全图持久）
- 口开合状态机 + 与 chart POI 的关系（口=动态 POI·随周期出现/消失）

实装分步：先时钟+口开合 → 再生算法+模板库 → 口部固定段内容。规模/数值后调。
land cave-deepgate。
```

---

## T4 · 温度系统（Opus · 新机制）

```bash
node scripts/psm.mjs start cave-temp --lane "src/engine/temperature.ts,src/types/state.ts,src/engine/dive.ts,src/data/zones.json"
```

```
你在开发「深海回响」（Blue，~/Desktop/Blue）。本 session：温度系统（热/冷双极门控）。

先读：cave_zones_spec.md「设计章 v2」§6；参考氮气系统 docs/spec/深海回响_氮气系统_SPEC.md + engine/ascent.ts（N2）的「资源+阈值」写法。

设计（先写子-spec docs/spec/深海回响_温度系统_SPEC.md 再码）：
- 一条温度暴露资源 + 潜服保温（抵消）+ 超阈值后果（探全门控：full / partial / 入口不可达）
- 热极=热液近场（thermal_pocket/lava_branch/collapsed_caldera）；冷极=深水冷团（black_basin/the_deep_gate 核心/可选 drowned_well）
- 外传是主舞台；ch1 先做「每洞 热/冷/中性 + 可达档」标注 + 基础门控，别一次做满
- 与 T2 协调 state.ts/dive.ts（若并发，先约定字段）

实装后 regress:quick + 相关 playthrough 绿。land cave-temp。
```

---

## T3a · chart-POI 基础接线（Sonnet · 依赖 T1）

```bash
node scripts/psm.mjs start cave-chart --lane "src/data/chart_pois.json,src/data/chart_regions.json"
```

```
你在开发「深海回响」（Blue，~/Desktop/Blue）。本 session：把 27 个洞接上海图（单口·基础版），并清空 trench。

前置：cave-data（T1）已 land。先读 cave_zones_spec.md「设计章 v2」§3（beacon×尺寸分布·每洞挂哪个 beacon）+ §7（trench 清空 + blue_caves 迁移）；参考 chart_pois.json 现有 poi.anchor.blue_caves / poi.anchor.flat_gallery 的写法。

任务：
① 按 §3 给每个洞加 1 个 POI（单口先）：zoneRef + owner=对应 beacon + **发现源（§5b：直接 / 情报 marksPois / 剧情门控 discoveredFlag=story.*）** + depthOffset/current/visibility 占位。多数小/浅洞=直接可见；中深/特殊洞=情报（导师日志页）或剧情门控。剧情门控若现有 story flag 不够用，先用占位 flag + 留 TODO（story hook 置 flag 归内容侧）。
② 迁移：blue_caves 现有 3 个 trench POI（anchor + flat_gallery 横岩廊 + roaming）→ owner 改 lighthouse.home。
③ 确认 trench（lighthouse.ch1_trench_outpost）名下 0 个洞 POI。
④ midwater 的洞写成「海山/孤峰」语境（描述）。
⑤ 深门（the_deep_gate）**初期跳过**——不接 POI、不做内容（zones.json 留占位即可）。它是后期 T2b「循环再生洞」专项·初期当它不存在。

验证：npm run regress:quick + npx tsx scripts/playthrough-chart.ts（regionConfigErrors 空 + reach 档位·#115 reach 边界很紧·挪 anchor 必跑）。

commit: feat(chart): 27 洞接 beacon（单口）+ trench 清空 + blue_caves 迁 home
```
`node scripts/psm.mjs land cave-chart`

---

## T3b · 跨 beacon 多口 POI（Opus · 依赖 T2 + T3a）

```bash
node scripts/psm.mjs start cave-multimouth --lane "src/data/chart_pois.json"
```

```
你在开发「深海回响」（Blue，~/Desktop/Blue）。本 session：给洞加跨 beacon 多口 + 发现门。

前置：cave-bmap（T2·多入口持久图）+ cave-chart（T3a·单口接线）都已 land。先读 cave_zones_spec.md「设计章 v2」§5（多口/跨 beacon/深门 3-beacon 脊柱）+ T2 的多口持久洞 SPEC。

任务：
① 按 §1 口数给 ⇄ 洞补副口 POI（中 1–2·大 2–3）：漫水回廊/镜廊/蛇行/蓝洞群 等。
② the_deep_gate 深门：6 口铺到 wreck 深缘 + midwater 核心 + vent 火山侧（depthRange 已 70–148），刻意不碰 trench。每口映射到 B 图的不同入口节点。
③ 跨 POI 发现门：走到一张图的远端出口 → setFlag → 揭示对侧口（对侧 owner 可为别的 beacon）；该 beacon 扫描范围也能独立揭示。
④ 海图 UI：同一洞的多口要可辨（连线/同色/命名），别让玩家当成独立洞口。

验证：regress + playthrough-chart。land cave-multimouth。
```

---

## 推荐起手顺序

1. **现在**：T1 + E1 + E2 + E3 + E4 五条并行（Sonnet×3 + Opus×2）+ T2（Opus·先写子-spec·**长杆·尽早起**）。
2. **T1 land 后**：T3a（Sonnet）+ T4（温度·Opus·需 T1 的 zones 标注；与 T2 协调 dive/state·或解耦成侧表提前并行）。
3. **T2 land 后**：T3b（普通跨 beacon 多口·Opus·**不含深门**）。
4. **最后期**：T2b 深门循环再生洞（初期完全不做）。
5. 全部收口后，洞穴系统（数据/事件/多口持久图/温度/海图/最后深门）成闭环。
