// Dive 引擎：节点移动、回合 tick、上浮判定
// 与 events.ts 解耦：events 负责事件内的 outcome 应用；dive 负责事件间的"地图层"逻辑
//
// #106 纯搬移拆分（docs/infra/dive_ts_split_proposal.md §3「保留 barrel」）：本文件降为 barrel——
// 公共 API 名字/签名/行为零变化，wiring 按子系统住进同目录兄弟文件；外部（ui/ scripts/ dialog.ts）
// 继续 import '@/engine/dive' 或 './dive'，路径零改。子系统索引：
//   dive-start    开潜三入口（港口 zone / 海图 POI / 前哨蛙跳）+ 出海叙事
//   dive-select   节点选择与预览档位（enterNodeSelection / featureDoneFlag）
//   dive-sensors  灯 / 声呐（setLight / pingSonar / setSonarNext / scan-on-open / refreshSelection）
//   dive-move     过渡与移动（currentMoveCost / applyTransit / moveToNode）
//   dive-stalker  猎手与伏击 wiring（stalkerStep / maybeApproachEncounter / standAndFight / deployDecoy）
//   dive-actions  节点动作（exploreFeature / restAtNode / breatheAtAirPocket / campAtNode）
// 子模块依赖单向（start→select；sensors→select；move→sensors/stalker/select；actions→select），
// 别从本 barrel 回 import（自引用环）。

export { startDive, startDiveFromPoi, carryWeightLimitFor } from './dive-start';
export { enterNodeSelection } from './dive-select';
export { setLight, pingSonar, setSonarNext } from './dive-sensors';
export { currentMoveCost, moveToNode } from './dive-move';
export { standAndFight, deployDecoy, beginAscentFromDive } from './dive-stalker';
export { exploreFeature, restAtNode, breatheAtAirPocket, campAtNode } from './dive-actions';
export type { DiveNode, DiveMap } from '@/types';
