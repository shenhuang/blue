// 教学后海图可见性基准——单一真相。
// smoke-chart-ui.tsx（UI 层）从这里导入「教学后随家区揭示的 anchor」，消灭「改 POI owner / 区域门控时
// 只更新一处断言」的双写缺口（quirk #171）。
//
// 白板收口（2026-07-12）：开放水域/tutorial/ch1 内容清空后，只剩迁 home 的蓝洞群一条家区 anchor。
//   原两条导出（POST_LOGBOOK_STORY_BEAT_POI_IDS＝日志揭示的四条主线 beat 坐标；
//   POST_TUTORIAL_GATED_ZONES＝未解锁残骸区 zone.wreck_graveyard）随内容 + 其唯一消费者
//   playthrough-chart.ts 一并删除。
//
// 洞穴内容整删（2026-07-12 续）：唯一剩下的 poi.anchor.blue_caves 随 zone.blue_caves 一并删除
//   （chart_pois.json 现仅剩 poi.anchor.warren，且被 flag.warren_discovered 门住不可见）——
//   home 区当前无任何非剧情 anchor 可揭示，列表回落空数组。
//
// 如何维护：
//   改 chart_pois.json 里某 POI 的 owner → 在这里移动/新增该 POI（id + name）到列表，smoke 自动跟进。

/** 教学后随家区（owner=lighthouse.home）揭示的非剧情 anchor（id + UI 显示名）。当前为空（见上）。 */
export const POST_TUTORIAL_HOME_ANCHORS: ReadonlyArray<{ id: string; name: string }> = [];
