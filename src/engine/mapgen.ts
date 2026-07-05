// 节点图生成器（门面）
//
// 两种拓扑（由 ZoneDef.mapShape 选择，与 canFreeAscend 正交）：
//   - 'layered'（默认）：层状 DAG——layerCount 层，每层 2-3 节点，深度从
//     zone.depthRange[0] 单调渐变到 [1]，只连下一层。开阔海域（旧灯塔礁 / 沉船墓园）用它。
//     → mapgen-layered.ts
//   - 'maze'：洞穴"迷路"图——双向边的连通图，有环（绕回原点）、死路（dead-end）、
//     多个"最深点"（局部深度极大）。入口与"洞另一头的出口"都是 ascent_point。蓝洞群用它。
//     → mapgen-maze.ts
// 另有持久多口洞专用入口 generatePersistentCaveMap（→ mapgen-cave.ts·仅 caveEntry 下潜走）。
//
// 不论哪种拓扑：depthOffset（海图 POI 修正）都先平移 depthRange 再生成；corpse pass 仍按
// depth ±10m 匹配 findRecoverableCorpse。analyzeMap()（→ mapgen-analyze.ts）是纯结构分析器，
// 给 dev 面板 + 回归脚本复用。公共工具/pass 在 mapgen-shared.ts。
// 本文件只留分流入口 generateDiveMap + re-export（外部 import 面与拆分前一致·静态边不破）。

import type { DiveMap, DiveNode } from '@/types';
import { type GenOpts, makeSeededRng, applyHarvestDepletion, resolveLayoutStyle, sprinkleDarkNodes } from './mapgen-shared';
import { generateLayeredMap } from './mapgen-layered';
import { generateMazeMap } from './mapgen-maze';

export {
  caveSeededRng,
  caveHash,
  caveDepthCurveForPlace,
  caveShapeBucket,
  resolveLayoutStyle,
} from './mapgen-shared';
export type { CaveShapeBucket } from './mapgen-shared';
export {
  caveRegionForDepth,
  cavePortalsOf,
  generatePersistentCaveMap,
  applyCaveOverlays,
  analyzeCave,
} from './mapgen-cave';
export type { CaveAnalysis } from './mapgen-cave';
export { getNextChoices, analyzeMap } from './mapgen-analyze';
export type { MapAnalysis } from './mapgen-analyze';

export function generateDiveMap(opts: GenOpts): DiveMap {
  const { zone, depthOffset = 0 } = opts;

  // band（Phase 1）可用 depthRange 覆盖 zone.depthRange；缺省回退 zone 自身（POI / 教学路径不传）。
  // 然后叠加海图 POI 深度偏移：平移，clamp 下限到 0，保证 d1 > d0。
  const range = opts.depthRange ?? zone.depthRange;
  const baseD0 = Math.max(0, range[0] + depthOffset);
  const baseD1 = Math.max(baseD0 + 1, range[1] + depthOffset);

  // 教学首潜判定（linearScripted zone·其 scriptedStart 未见过）——决定走教学图还是普通 layered（重访）。
  const tutorialFirstDive =
    zone.generation === 'linearScripted' &&
    zone.scriptedStartEventId != null &&
    !opts.profileFlags.has(`event_seen:${zone.scriptedStartEventId}`);

  // 教学首潜 + **未配** node 化 ⇒ 旧单节点教学图（事件链驱动·其它 linearScripted zone 若有）。
  // 配了 scriptedNodeEvents（#221+ 教学关 node 化）⇒ fall through 到下方 layered + 把 beats 钉到节点（首潜限定·重访不钉）。
  if (tutorialFirstDive && !zone.scriptedNodeEvents) {
    const startNode: DiveNode = {
      id: 'scripted.start',
      layer: 0,
      depth: baseD0,
      zoneTag: 'tutorial',
      kind: 'event',
      eventId: zone.scriptedStartEventId,
      connectsTo: [],
      preview: '出发。',
    };
    return {
      zoneId: zone.id,
      generatedAt: Date.now(),
      nodes: { [startNode.id]: startNode },
      startNodeId: startNode.id,
    };
  }
  // 教学已完成（重访）→ 当普通 layered zone 处理（zoneTagsByDepth 已换成 shallow/reef/wreck）。

  // 洞穴一致性（SPEC §6①·#98）：未显式传 rng 时，若有 seedKey 则用「地点派生」的确定性 rng（同地点同图）；
  // 否则回退 Math.random（旧行为·每潜不同）。把解析后的 rng 注回 opts ⇒ 两个子生成器 destructure 即取到、无需各自再判。
  const rng =
    opts.rng ?? (opts.seedKey != null ? makeSeededRng(zone.id, opts.seedKey, depthOffset) : Math.random);
  const genOpts: GenOpts = {
    ...opts,
    rng,
    // 教学关 node 化（#221+）：教学首潜把 beats 钉到节点；重访（!tutorialFirstDive）不带 ⇒ 裸 layered + pinnedEventId（captain_revisit·§2d 不破）。
    scriptedNodeEvents: tutorialFirstDive ? zone.scriptedNodeEvents : undefined,
  };

  // 随机图：按 mapShape 分流（缺省 = layered，保持现有 zone 行为不变）
  const map =
    zone.mapShape === 'maze'
      ? generateMazeMap(genOpts, baseD0, baseD1)
      : generateLayeredMap(genOpts, baseD0, baseD1);
  // 渲染自描述盖章（纯渲染·不入存档·不影响拓扑/rng）：让 deriveMapLayout 与所有消费者无需拿 zone 即知形状。
  // 层状开阔水域天然走 vertical（resolveLayoutStyle 兜底）；只有声明了 layoutStyle/orientation 的 zone 变形。
  map.layoutStyle = resolveLayoutStyle(zone);
  map.orientation = zone.orientation;
  // 不可信声呐失真 pass（曾给深 band 内部节点挂 spoof/evade 表象）：**感知重做已删**（声呐诚实·SPEC §2.2/§3）。
  // 固定资源耗尽（POI 固定资源耗尽·2026-06-25）：把已采尽的资源点抹平成空节点（确定性·零 rng·gated·post-pass）。
  // 两集都空（缺省）→ no-op、逐字节复现旧图（不破现有 mapgen 场景快照）。
  applyHarvestDepletion(map, opts.harvestedItemIds, opts.harvestedNodeIds);
  // 隐藏黑点撒布（感知重做 per-node 黑·#262·确定性·零 rng·非 eligible zone→no-op·byte-identical）。
  sprinkleDarkNodes(map, zone, opts.seedKey);
  return map;
}
