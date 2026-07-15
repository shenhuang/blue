// 开阔水域「贴底节点」判定（单一真相·派生不入存档·守感知诚实/可复现·开阔水域 SPEC §3/§4）。
//
// engine 层：渲染层 openWaterRender（ui·锚海床）与事件层 events（engine·atSeabed Condition）
// 共用同一个源——若留在 ui 层，engine 的 events 就没法 import（check-boundaries 规则一 engine↛ui）。
// 故下沉到 engine：ui 可 import engine，反之被守。原 terminalNodeIds 从 ui/openWaterRender 迁来（同逻辑）。

import type { DiveMap, ZoneTag } from '@/types';

/**
 * 「有海床」的开阔水域渲染档 tag（对应 openWaterStyleOf 的实心底面：沙/珊瑚/岩/珊瑚礁混合）。
 * midwater（远洋中层·开阔无底蓝水·锚点③）**不在此集**＝无海床 ⇒ 其终点节点不算贴底、渲染层不铺 floor。
 * 单一真相：改「哪些档有海床」只动这一处（openWaterStyleOf 的档与此对齐）。
 */
const FLOORED_OPENWATER_TAGS: ReadonlySet<ZoneTag> = new Set<ZoneTag>(['sand', 'coral', 'rock', 'atoll']);

export function isFlooredOpenWaterTag(tag: ZoneTag): boolean {
  return FLOORED_OPENWATER_TAGS.has(tag);
}

/**
 * 分支终点＝没有更深邻居的节点（下潜到此必须掉头/上浮·涵盖真死路 + 全图最深层）。
 * 分层图 connectsTo 对称（双向含来路），用「深度」而非「度」判终点——不用另跑 analyzeMap。纯拓扑·确定性。
 */
export function terminalNodeIds(map: DiveMap): Set<string> {
  const terminals = new Set<string>();
  for (const id of Object.keys(map.nodes)) {
    const n = map.nodes[id];
    const hasDeeper = n.connectsTo.some((nid) => (map.nodes[nid]?.depth ?? -Infinity) > n.depth);
    if (!hasDeeper) terminals.add(id);
  }
  return terminals;
}

/**
 * 贴底节点＝分支终点 ∧ 其 zoneTag 是有海床档（isFlooredOpenWaterTag）。
 * midwater（无底蓝水）终点不算贴底 ⇒ 整图无贴底节点＝纯中层（floorless）。
 * 渲染层（锚海床形状）与事件层（atSeabed 门控珊瑚/矿床/海底爬行生物等贴底专属内容）共用此源——
 * 保证「海床贴着哪些节点」与「哪些节点算贴底」永远一致。确定性·纯函数（派生不入存档）。
 */
export function seabedNodeIds(map: DiveMap): Set<string> {
  const seabed = new Set<string>();
  for (const id of terminalNodeIds(map)) {
    const tag = map.nodes[id]?.zoneTag;
    if (tag && isFlooredOpenWaterTag(tag)) seabed.add(id);
  }
  return seabed;
}
