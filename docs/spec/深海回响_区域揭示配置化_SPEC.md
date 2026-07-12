# 区域揭示 · 配置化实装 SPEC（Ch.1 + 跨章复用）

> 状态：**核心已实装**（最新一次改动 2026-06-14·随「探深→低频声呐」改名顺带更新措辞，设计未变；落地本体 2026-06-13 作者拍板·§10 记满续拍）。
> 这是「重写 SeaChartView 表现层」的权威契约。作者要求：**最大质量 / 可维护 / 可扩展**，
> 且**可配置、可被 Ch.2 与外传的另一张大地图及其子区复用**。

## 1. 根因（要修的）
- `BASE_LIGHT_RADIUS = 0.72`（归一化世界里直径 1.44 > 全图）⇒ 每座灯塔的揭示圈盖满全图；
  深脊柱前哨又聚在右下（x 0.5–0.74）⇒ 多个巨圈重叠成一团糊。这就是作者看到的「很多大圈重叠」。
- demo 目标（作者口径）：**几个离得较远的彩色大圈区域**，家＝海岸线半圆。

## 2. 设计原则（最小血量·保留既有 reveal 架构）
- **不重写 reveal 模型**：`isLit / poiRevealState / climateOcclusion / mimic 恒lit / story 恒显`
  全部保留（都已测·blast radius 才可控）。〔isSurveyDim〔勘测站〕、前哨衰减 dimming 后均已删除〕
- 改为：**每个区域 = 一座 owner 灯塔的揭示圈，其半径/颜色/形状由数据配置**（集中单一来源）。
- `revealRadius(lighthouse)` 改为**读区域配置的 radius**（替代巨型 BASE）；`effectiveRevealRadius` 衰减逻辑不变。
- **「教学后只点亮家区」自然涌现**：家圈半径只够近岸 ⇒ 远处 POI 不落在任何 active 圈 ⇒ `hidden`，
  直到对应章节前哨建成（揭示该区）。无需新增 per-POI flag 门控。
- 诚实轴不破：**圈内＝可见可去**（视觉圈＝逻辑 reveal·不解耦）。

## 3. Ch.1 五区配置（颜色＝作者 2026-06-13 拍板）
| 区 id | label | owner 灯塔 id | palette | shape | radius | 解锁 |
|---|---|---|---|---|---|---|
| reef | 家·珊瑚区 | lighthouse.home | cyan | coast | 0.34 | 教学完成 |
| trench | 海沟区 | lighthouse.ch1_trench_outpost | navy | circle | 0.18 | **新前哨**（requiresFlag·剧情节拍待填·dev 解锁） |
| wreck | 残骸区 | lighthouse.ch1_wreck_outpost | green | circle | 0.18 | anchor `wreck` |
| midwater | 中层区 | lighthouse.ch1_midwater_outpost | blue | circle | 0.15 | anchor `midwater` |
| vent | 热液区 | lighthouse.ch1_vent_outpost | amber | circle | 0.15 | anchor `vent` |

- ruins / 未配置 owner → 默认 `{ palette: 'ruin', shape: 'circle', radius: 0.18 }`。
- palette token（CSS 变量/类·data-driven）：cyan `#5DCAA5` / green `#97C459` / blue `#85B7EB` /
  amber `#EF9F27` / navy `#3F62B3` / ruin `#D6B266`。
- `coast` 形状＝圆裁掉左半（clip x≤owner.x）＝从海岸鼓进水里的半圆。

## 4. 坐标重排（分离·landscape 友好：x 展开、y 收窄）
owner/region 中心：home(0.06,0.50) · trench(0.32,0.24) · wreck(0.60,0.62) · midwater(0.78,0.30) · vent(0.90,0.78)。
POI 归区 + 新归一化坐标（mapX,mapY）：
- **reef**：东礁(0.13,0.52)·旧灯塔礁(0.20,0.66·需船坞)·漆号珊瑚丛◆(0.11,0.37)·退潮浅滩(0.18,0.46)·灯塔礁深槽[roam](0.22,0.70)
- **trench**：蓝洞群(0.30,0.22)·横岩廊(0.26,0.13)·蓝洞暗河口[roam](0.42,0.27)
- **wreck**：塌架墓园(0.58,0.56)·温带商船残骸◆(0.64,0.70)·塌口北缘[roam](0.70,0.62)·墓园雾区[roam](0.52,0.66)
- **midwater**：远洋中层◆(0.80,0.30)
- **vent**：海沟热液场◆(0.90,0.78)

◆＝剧情锚点（story·恒显菱形·#117·不靠圈揭示）。

## 5. 新增 海沟 outpost + band（task #8）
- `outpost.ch1_trench`：镜像 `outpost.ch1_wreck`（3 stage 账单·result `lighthouse.ch1_trench_outpost`@trench 中心·`bandId: band.ch1_trench`·submerged）。
- **解锁不占用 4 个 canon anchor**（守 story.ts CH1_ANCHORS / quirk #117/#118）：
  `OutpostDef` 加 `requiresFlag?: string`（占位 flag·作者之后接剧情节拍）；
  `outpostUnlocked / isChapterOutpost / devUnlockChapterRegion / isChapterBand` 支持 `requiresFlag` 分支。
- `band.ch1_trench`：镜像 `band.ch1_wreck`（zone.blue_caves·depthRange 60–82·order 14·chapter band）。
- **深渊/超渊（abyssal/hadal）deep-spine 前哨**：移出 Ch.1 图渲染（引擎数据保留给后续章节·只是 Ch.1 地图配置不含）。

## 6. 渲染重写（SeaChartView·保留 popup/装包/三态/sweep/legend）
- 揭示圈：从区域配置取 `palette/shape/radius`；高质量＝柔和径向渐变填充 + 清晰彩色描边（替代粗糙白圈）。
- 家＝`coast` 半圆（clip 左半）。守 quirk #112（.chart-world 正方层·圆是圆）。
- `ChartViewport`：`useLayoutEffect` 改 SSR 安全（`useIsomorphicLayoutEffect`：client 用 layout、server 用 effect）⇒ 消除 smoke 警告。
- 渲染组件做成「读地图配置（region 列表）」⇒ Ch.2/外传只换配置数据即可复用。

## 7. 测试重定基线（坐标/半径变·handoff 红线：挪坐标必跑 playthrough-chart §2）
- **smoke-chart-ui §A**：教学后可见＝家区 POI（东礁/旧灯塔礁/珊瑚丛◆）+ story 菱形（温带残骸/远洋中层/热液场）；
  **蓝洞群/塌架墓园改为「未揭示」**（删掉「应含」断言或改为断言 hidden）。**§A2** 改 popup 模型（断言点击 home 灯塔标记→蛙跳；或断言 home marker 存在）。
- **playthrough-outpost §11**：reveal 半径数值随新配置重定；probe/farPoi 坐标随 owner 新半径调。
- **playthrough-lighthouse-scenarios**：ruin 揭示远点的 farPoi 坐标随 ruin 默认半径(0.18)重定。
- **playthrough-upgrades 194-197**：旧灯塔礁在家区内(lit)、缺船坞 dim/不可去——校验仍成立。
- **playthrough-chart / playthrough-mimic**：跑绿（mimic 恒 lit 不受影响）。

## 8. 文件清单
- `types/lighthouse.ts`：`OutpostDef.requiresFlag?`。
- `types/chart.ts`（或新 `types/chartMap.ts`）：`ChartRegionDef { id,label,owner,palette,shape,radius }` + 地图配置类型。
- `data/chart_regions.json`（**新**·ch1 区域配置·单一来源）。
- `data/lighthouse_upgrades.json`：+`outpost.ch1_trench`；章节前哨 result 坐标重排到区中心。
- `data/depth_bands.json`：+`band.ch1_trench`。
- `data/chart_pois.json`：anchors/roaming 坐标重排（§4）。
- `engine/lighthouses.ts`：`revealRadius` 读区域配置；`outpostUnlocked/devUnlockChapterRegion/isChapterOutpost/isChapterBand` 支持 `requiresFlag`；导出 `getRegionConfig(lighthouseId)`。
- `engine/state.ts`：home 灯塔（region 标记·若需）。
- `ui/SeaChartView.tsx`：渲染重写（读区域配置）。
- `ui/ChartViewport.tsx`：SSR 安全。
- `styles.css`：区域配色 data-driven（`.reveal-<palette>`）+ 家半圆·替换粗糙白圈。
- `scripts/*`：重定基线（§7）。

## 10. 作者续拍（2026-06-13/14）

> **状态（2026-06-14·v4 已落地·全绿 29/29）**：6 区横向布局已写进配置（家大/残骸中/中层大/热液中/海沟小且最右最深/鲸落最小贴中层）；海沟已移最右；**鲸落区 region(violet) + `outpost.ch1_whalefall`(requiresFlag `story.ch1.whalefall_found`) + `band.ch1_whalefall` 已落地·dev 可解锁渲染**。坐标=lighthouse_upgrades result + state.ts home + chart_pois，半径=chart_regions，作者可在 `npm run dev` 改数微调。**剩余＝鲸落机制**（见下·下个专注 session）。

- **海沟区移到最右**：✅ 已做（owner 0.93,0.5·蓝洞/竖井 POI 随之到右深处·测试坐标已同步）。
- **鲸落区（非主线·新区·机制待做·作者 2026-06-14 细化）**：
  - **目击**：巨型生物在**中层区**活动·下潜有概率目击；**每次目击 progress 剧情·满 3 次**触发下一步。**残骸区**也有低概率目击但**独立剧情·不计入 progress**（故凑 3 次实质要中层区先解锁）。
  - **找寻**：满 3 次后，**鲸落/中层附近出现一个额外『探索潜点』**（chart_pois·gated by 目击计数 flag）；下潜它＝一段**探索 + 剧情**，结尾**找到鲸落区**（置 `story.ch1.whalefall_found`）。
  - **鲸落区本身**：**没有真正的哨站/前哨**——只是**一个区域（揭示圈）+ 若干潜点**。reveal **由 flag 门控**（found·非 owner 灯塔）⇒ 引擎要扩 **flag-gated region**（`ChartRegionDef` 加 `revealFlag` + `center`·渲染加 owner-less 区路径）。**移除**先前误建的 `outpost.ch1_whalefall` + `band.ch1_whalefall`，改 flag-gated region。鲸落含多潜点 / 多子区支撑不同生态 / 独特奖励 + 图鉴。
  - 牵动：story.ts（目击计数 + found·单一来源）· events（中层/残骸目击事件 + 找寻事件）· 目击 RNG 钩（中层 band 事件池）· chart_pois（探索潜点 + 鲸落潜点）· engine 区域系统（flag-gated region）· 图鉴 · 测试重定基线。**大特性·建议新 session 专注做**。
  - 〔旧记录·已被上面取代〕比蓝鲸更大的巨型生物在**中层区**活动·有概率目击；**中层区每次目击 progress 剧情·满 3 次**→中层区附近解锁**鲸落区**（故须中层哨站先解锁）。**残骸区**也有低概率目击但**独立剧情·不计入 progress**。鲸落区比现实蓝鲸鲸落更大·**多子区支撑不同生态**·提供**独特奖励 + 图鉴**。
  - 实装：reveal 复用区域配置（新 region·owner=鲸落 outpost·unlock=「3 次中层目击」flag·dev 解锁）——**验证配置系统可扩展性**；新增：目击 RNG 事件 + 计数器（story flag 派生·单一来源 story.ts）+ 图鉴系统 + 鲸落多子区（band/zone）。
  - 待对齐细节：目击概率/鲸落区坐标（右侧近中层）/子区数量与生态/奖励与图鉴条目——build 时出更新 mockup + AskUserQuestion。

## 9. 红线
诚实轴（圈内=可去·暗/隐=天气真话·mimic 唯一谎点·anchor 进度不被天气藏）· quirk #112（圆是圆）·
quirk #117/#118（story flag 单一来源在 story.ts·**不加第 5 个 canon anchor**·海沟走 `requiresFlag`）·
engine↛ui（check-boundaries）。每个里程碑跑 `npm run regress --only ...` 子集绿；ship 前全绿。
