// 教学后海图可见性基准——单一真相。
// playthrough-chart.ts（engine 层）和 smoke-chart-ui.tsx（UI 层）都从这里导入，
// 消灭「改 POI owner / 区域门控时只更新一处断言」的双写缺口（quirk #171）。
//
// 如何维护：
//   改 chart_pois.json 里某 POI 的 owner →
//     1. 在这里移动/新增该 POI（id + name）到正确列表
//     2. 两个测试文件自动跟进，无需再手动 grep 两处

/** 教学后随家区（owner=lighthouse.home）揭示的非剧情 anchor（id + UI 显示名）。
 *  改 owner → lighthouse.home 时加入；迁走时移到 GATED_ZONES 对应区。 */
export const POST_TUTORIAL_HOME_ANCHORS: ReadonlyArray<{ id: string; name: string }> = [
  { id: 'poi.anchor.blue_caves', name: '蓝洞群' }, // §7 cave-chart: owner → lighthouse.home
];

/**
 * 教学后「日志揭示」的四条主线 beat 坐标（re-home 2026-07-12：深度柱系统删除后落成 chart_pois.json 静态
 * story 锚点·id=poi.dive.<短名>.story），只在 **持有导师日志（item.mentor_logbook·其 story.marksPois 带这四条
 * 坐标）**后才现（reveal 单一来源＝文献坐标·#117 续）。深度门经济（原 host-built 逐环 dim/lit）已删——持日志后
 * 四条全 lit（host 灯塔不再门 reveal/reach）；教学后**未拿日志**（裸 tutorial_complete·inventory 无导师日志）时
 * 四条全 hidden——故 playthrough-chart §1（只 flag.tutorial_complete）不断言它们恒显。
 */
export const POST_LOGBOOK_STORY_BEAT_POI_IDS: readonly string[] = [
  'poi.dive.home.story',
  'poi.dive.wreck.story',
  'poi.dive.midwater.story',
  'poi.dive.vent.story',
];

/** 教学后未解锁区：非剧情 anchor 应不揭示（对应章节前哨建成前）。 */
export const POST_TUTORIAL_GATED_ZONES: readonly string[] = [
  'zone.wreck_graveyard',
];
