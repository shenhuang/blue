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

/** 教学后剧情锚点恒显（story=true·已知坐标·不走揭示圈·#117）。 */
export const POST_TUTORIAL_STORY_ANCHOR_IDS: readonly string[] = [
  'poi.anchor.ch1_coral_grove',
  'poi.anchor.ch1_temperate_wreck',
  'poi.anchor.ch1_open_midwater',
  'poi.anchor.ch1_vent_field',
];

/** 教学后未解锁区：非剧情 anchor 应不揭示（对应章节前哨建成前）。 */
export const POST_TUTORIAL_GATED_ZONES: readonly string[] = [
  'zone.wreck_graveyard',
];
