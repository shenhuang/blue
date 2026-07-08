// 蜂群 boss 图生成器（The Warren·SPEC 深海回响_蜂群boss_SPEC §8）——generateWarrenMap
//
// **三角拓扑**（作者 2026-07-08 草图拍板·取代早先的线性脊柱）：
//   女王没理由待在没有卵的房间 ⇒ **三间卵室（chamber）都是 hatchery**。她初始随机在其中一间，
//   被打到暴露阈值就撤到剩下两间的**随机**一间，撤进第三间＝背水一战（无处可退·可杀）。
//   「死角」因此是**状态不是地点**（isLastStand = roomsCleared>=2），不再是某个最深节点。
//
//   三间卵室两两经一个**中间房（mid）**相连 ⇒ 两两恰好 2 跳、完全等距。等距正是「三选一」干净的来源：
//   她逃走那刻你站在她原来那间里，剩下两间对你也都是 2 跳 ⇒ 「离玩家/离当前最远」双双退化 ⇒ 随机是
//   唯一有信息量的撤退规则（作者 2026-07-08）。**别把三条边做成不等长**，那会毁掉这个性质。
//
//   每个中间房各挂一个**气穴**（一次性·用过即枯）＝一场三段追猎最多三口气，且每口都要往她领地里绕。
//   入口在外围（≥3 跳外·§8 女王绝不靠近洞口），进近区无敌人；外围挂死路/资源袋/环。
//
// 深度**不是压力轴**（作者拍：不用太在意深度）——压力交给「越近女王水越稠」，与 Spawn 密度共用同一个
// 热度场 f(到 queenNodeId 的跳数)（另批·派生·不入存档）。深度仍按到入口的跳数递增，守「位置即深度」(#92/#93)。
//
// 本文件只搭**空间**：卵室（kind='boss'·runtime 据此选女王起点）、中间房、气穴、入口、外围。
// 她在哪间（queenNodeId）、封口墙、密度、存卵数全是 **run 态**（warrenHunt），不烘进地图。
// 公共工具见 mapgen-shared；分流入口见 mapgen.ts（zone.mapShape==='warren'）。

import type { DiveMap, DiveNode, NodeKind, ZoneTag } from '@/types';
import { type GenOpts, randInt, clamp } from './mapgen-shared';

/** 三间卵室（都是 hatchery·女王随机起点·kind='boss' 是 runtime 的识别标记） */
export const WARREN_CHAMBERS = ['w.chamber.a', 'w.chamber.b', 'w.chamber.c'] as const;
/** 三个中间房：每个连接一对卵室，并各挂一个气穴 */
const MIDS: Array<{ id: string; air: string; between: [string, string] }> = [
  { id: 'w.mid.ab', air: 'w.air.ab', between: ['w.chamber.a', 'w.chamber.b'] },
  { id: 'w.mid.bc', air: 'w.air.bc', between: ['w.chamber.b', 'w.chamber.c'] },
  { id: 'w.mid.ca', air: 'w.air.ca', between: ['w.chamber.c', 'w.chamber.a'] },
];
/** 进近区从 hub 接进三角的两个入点（给玩家一进洞就有的二选一；三间卵室因此距 hub 均 2 跳） */
const HUB_ENTRIES = ['w.mid.ab', 'w.mid.ca'];

/** 空卵室默认遭遇（卵 + 少量巢役守卫·难度按 roomsCleared 递增）；她在的那间由 runtime 按阶段覆写。 */
const BROOD_ENCOUNTER = 'combat.warren_brood_chamber';

export function generateWarrenMap(opts: GenOpts, baseD0: number, baseD1: number): DiveMap {
  const { zone, rng = Math.random } = opts;
  const d0 = baseD0;
  const d1 = baseD1;
  const tag: ZoneTag = opts.bandTags?.[0] ?? 'cave';

  const adj: Record<string, Set<string>> = {};
  const ensure = (id: string) => (adj[id] ??= new Set<string>());
  const link = (a: string, b: string) => {
    ensure(a).add(b);
    ensure(b).add(a);
  };

  type Spec = { kind: NodeKind; preview: string; enc?: string };
  const spec: Record<string, Spec> = {};

  // —— 1. 核心：入口 + 进近链 + 三角（卵室 / 中间房 / 气穴）——
  spec['w.entrance'] = { kind: 'ascent_point', preview: '洞口在你身后，水面的光从这里漏进来。回头还能从这儿出去。' };
  spec['w.app1'] = { kind: 'rest', preview: '一段被世代啃凿磨光的隧道，壁上尽是空卵室——暂时还没有活物。' };
  spec['w.app2'] = { kind: 'rest', preview: '隧道在这里岔开。更深处传来某种持续的、湿的搏动。' };
  link('w.entrance', 'w.app1');
  link('w.app1', 'w.app2');

  for (const c of WARREN_CHAMBERS) {
    spec[c] = { kind: 'boss', enc: BROOD_ENCOUNTER, preview: '一间温热的卵室，四壁嵌满卵。' };
  }
  for (const m of MIDS) {
    spec[m.id] = { kind: 'rest', preview: '连着两间卵室的甬道，地上拖出一道宽而湿的痕。' };
    spec[m.air] = { kind: 'air_pocket', preview: '穹顶一道裂缝，水面在晃——像个气穴。' };
    link(m.id, m.air);
    link(m.id, m.between[0]);
    link(m.id, m.between[1]);
  }
  for (const e of HUB_ENTRIES) link('w.app2', e);

  // —— 2. 外围：死路 / 资源袋 / 至多一个扎营点（巢内不扎营·耗氧的巢里扎营是荒谬选项）——
  let seq = 0;
  const leafOff = (host: string, n: number, allowCamp: boolean) => {
    for (let i = 0; i < n; i++) {
      const id = `w.b${seq++}`;
      const camp = allowCamp && rng() < 0.4;
      spec[id] = camp
        ? { kind: 'camp', preview: '洞壁上一处天然窄台，刚好卡住浮力歇口气。' }
        : { kind: 'rest', preview: '一条岔开的窄水道，尽头堆着被啃剩的碎壳。' };
      link(host, id);
      allowCamp = false;
    }
  };
  leafOff('w.app1', randInt(0, 2, rng), true);
  leafOff('w.app2', randInt(0, 2, rng), false);
  // 卵室外挂的死路（草图里绿点周围那些叶子）——**不连回任何核心节点**，免得改动三角距离。
  for (const c of WARREN_CHAMBERS) if (rng() < 0.6) leafOff(c, 1, false);

  // —— 3. 深度：按到入口的跳数递增（位置即深度 #92/#93）；三间卵室钉死 d1（都在最深处·等价）——
  const hops: Record<string, number> = { 'w.entrance': 0 };
  const q = ['w.entrance'];
  while (q.length) {
    const u = q.shift()!;
    for (const v of adj[u] ?? []) if (hops[v] === undefined) ((hops[v] = hops[u] + 1), q.push(v));
  }
  const maxHop = Math.max(1, ...Object.values(hops));

  const nodes: Record<string, DiveNode> = {};
  for (const id of Object.keys(spec)) {
    const s = spec[id];
    const isChamber = (WARREN_CHAMBERS as readonly string[]).includes(id);
    const frac = (hops[id] ?? 0) / maxHop;
    const depth = isChamber ? d1 : Math.round(clamp(d0 + (d1 - d0) * frac + randInt(-3, 3, rng), d0, d1));
    nodes[id] = {
      id,
      layer: hops[id] ?? 0,
      depth,
      zoneTag: tag,
      kind: s.kind,
      combatEncounterId: s.enc,
      connectsTo: [...(adj[id] ?? [])],
      preview: s.preview,
      ...(id === 'w.entrance' ? { portalKind: 'entrance' as const } : {}),
    };
  }

  return { zoneId: zone.id, generatedAt: Date.now(), nodes, startNodeId: 'w.entrance' };
}
