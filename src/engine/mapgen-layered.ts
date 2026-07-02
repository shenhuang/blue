// 层状 DAG 生成器（开阔海域：旧灯塔礁 / 沉船墓园）——generateLayeredMap
// layerCount 层、每层 2-3 节点、深度单调渐变、只连下一层；含钉放剧情节拍（quirk #174）
// 与教学关 node 化（#221+）两条覆盖 pass。公共工具见 mapgen-shared；对外经 mapgen.ts 门面。

import type { DiveMap, DiveNode, NodeFeature, NodeKind, ZoneTag } from '@/types';
import { buildEventPool, getEventById, pickWeighted, tagsForDepth } from './zones';
import {
  type GenOpts,
  randInt,
  pickFrom,
  maybeMultiFeatureRoom,
  roomPreview,
  placeCorpses,
} from './mapgen-shared';

// ============================================================
// 层状 DAG（开阔海域）—— 行为与重写前完全一致，只是抽成独立函数
// ============================================================

// 同层并列的 rest / ascent_point 节点曾共用同一句 preview → 同深同描述、玩家无从区分（playtest 报告④/⑤
// 「两个一模一样的可以喘息的水域」）。按同层兄弟序号 i 取不同句：纯派生·不耗 rng·不改 node kind ⇒ 不动
// analyzeMap 结构基线（preview 不入任何回归基线·已核对 scenarios/ + playthrough-*）。ascent_point 文案同时
// 说清「歇脚 + 可从这里折返上浮」，破「[上升点] 却更深又 resolve 成 rest」的误读（dive-move 把 ascent_point
// 路由到 rest 子阶段·RestView 在该处给上浮钮）。
const REST_PREVIEWS = [
  '一片可以喘息的水域。',
  '水流在这里慢下来，可以停一停。',
  '一道背流的石壁后，水几乎是静的。',
];
const ASCENT_PREVIEWS = [
  '一道斜向上的礁脊——可以歇脚，也能从这里折返上浮。',
  '最深处，水开始回暖；一道缓坡通向上方，能从这儿折返。',
  '岩壁裂开一道朝上的缝，光从那头漏下来——可由此上浮。',
];

function chooseLayeredNodeKind(
  layer: number,
  totalLayers: number,
  rng: () => number,
  opts: { canFreeAscend: boolean },
): NodeKind {
  // 第一层全部 event；最后一层至少有一个 ascent_point（洞穴 zone 也保留——那是洞另一端的出口）
  if (layer === 0) return 'event';
  if (layer === totalLayers - 1) return 'ascent_point';
  const roll = rng();
  if (opts.canFreeAscend) {
    // free-ascend 区随时可「此处上浮」（RestView「↑此处上浮」）→ 中间层再生成一个要先游过去的 ascent_point
    // 节点纯属冗余 + 误导：玩家把它当「出口」提前撤，还会把更深的剧情点（如东礁重访的沉船）挡在身后
    // （#220 续·作者「在能上浮的地方还能去一个上浮口似乎很没必要」）。中层只放 event/rest；末层仍 ascent_point（line 544）。
    return roll < 0.8 ? 'event' : 'rest';
  }
  // 洞穴 / canFreeAscend=false：中间层不再生成 ascent_point。
  if (roll < 0.9) return 'event';
  return 'rest';
}

export function generateLayeredMap(opts: GenOpts, baseD0: number, baseD1: number): DiveMap {
  const { zone, profileFlags, rng = Math.random, deaths = [], corpseChance = 0.6, targetCorpseId, maxRoomFeatures = 1, roomFeatureChanceBonus = 0 } = opts;

  const totalLayers = opts.layerCount ?? zone.layerCount;
  const d0 = baseD0;
  const d1 = baseD1;
  const depthStep = (d1 - d0) / Math.max(1, totalLayers - 1);
  const canFreeAscend = zone.canFreeAscend !== false; // 默认 true

  const nodes: Record<string, DiveNode> = {};
  const layerNodes: string[][] = [];
  const triggeredFakeIds: string[] = []; // 用来传给 buildEventPool 防止同 run 重复

  for (let L = 0; L < totalLayers; L++) {
    const depth = Math.round(d0 + depthStep * L);
    const count = randInt(zone.nodesPerLayer[0], zone.nodesPerLayer[1], rng);
    const ids: string[] = [];

    for (let i = 0; i < count; i++) {
      const id = `node.${L}.${i}`;
      const kind = chooseLayeredNodeKind(L, totalLayers, rng, { canFreeAscend });

      let eventId: string | undefined;
      let features: NodeFeature[] | undefined;
      let preview = '';
      let zoneTag: ZoneTag = pickFrom(opts.bandTags ?? tagsForDepth(zone, depth), rng) ?? 'reef';

      if (kind === 'event') {
        const pool = buildEventPool({
          zone,
          depth,
          sanity: 100, // 生成时按 100 算；真实 sanity 在抽取那一刻可能改变可见性，但 MVP 阶段先这样
          profileFlags,
          triggeredEventIds: triggeredFakeIds,
          tagsOverride: opts.bandTags,
          poiId: opts.poiId,
          poiTemplateId: opts.poiTemplateId,
        });
        if (pool.length === 0) {
          // 没有匹配事件，退化为 rest
          preview = '一片空旷的水域。';
          ids.push(id);
          nodes[id] = { id, layer: L, depth, zoneTag, kind: 'rest', connectsTo: [], preview };
          continue;
        }
        const chosen = pickWeighted(pool, rng)!;
        eventId = chosen.id;
        preview = chosen.title;
        triggeredFakeIds.push(chosen.id); // 同 run 不再选
        // 多事件房间（S1）：偶尔升级成大房间（maxRoomFeatures>1 才进；缺省零额外 rng＝旧图不变）。
        const feats = maybeMultiFeatureRoom(chosen, {
          zone, depth, profileFlags, triggeredFakeIds, bandTags: opts.bandTags, poiId: opts.poiId, poiTemplateId: opts.poiTemplateId, rng, maxFeatures: maxRoomFeatures, chanceBonus: roomFeatureChanceBonus,
        });
        if (feats) {
          features = feats;
          eventId = undefined; // 大房间不用单 eventId：moveToNode 据 features 路由到房间菜单
          preview = roomPreview(feats.length);
        }
      } else if (kind === 'rest') {
        // 同层多个 rest 取不同句（i=0 仍是原句·常见单 rest 逐字不变）——破「无从区分」。
        preview = REST_PREVIEWS[i % REST_PREVIEWS.length];
      } else if (kind === 'ascent_point') {
        // 末层并列的 ascent_point 同理差异化 + 文案点明「歇脚＋折返上浮」（破误读·见上方常量注释）。
        preview = ASCENT_PREVIEWS[i % ASCENT_PREVIEWS.length];
      }

      nodes[id] = {
        id,
        layer: L,
        depth,
        zoneTag,
        kind,
        eventId,
        features,
        connectsTo: [],
        preview,
      };
      ids.push(id);
    }

    layerNodes.push(ids);
  }

  // —— 连线：每个上一层节点连到下一层 1-2 个节点 ——
  for (let L = 0; L < totalLayers - 1; L++) {
    const cur = layerNodes[L];
    const next = layerNodes[L + 1];
    for (const fromId of cur) {
      const linkCount = Math.min(next.length, randInt(1, 2, rng));
      // 随机挑 linkCount 个
      const shuffled = [...next].sort(() => rng() - 0.5);
      const links = shuffled.slice(0, linkCount);
      nodes[fromId].connectsTo = links;
    }
    // 确保下一层每个节点都至少有一个入边
    const inEdges: Record<string, number> = {};
    for (const nid of next) inEdges[nid] = 0;
    for (const fromId of cur) {
      for (const toId of nodes[fromId].connectsTo) {
        inEdges[toId] = (inEdges[toId] ?? 0) + 1;
      }
    }
    for (const [nid, deg] of Object.entries(inEdges)) {
      if (deg === 0) {
        // 找到任何一个 cur 节点，强制加一条
        const donor = pickFrom(cur, rng);
        if (!nodes[donor].connectsTo.includes(nid)) {
          nodes[donor].connectsTo.push(nid);
        }
      }
    }
  }

  // —— Corpse pass ——
  // 候选 = 中间层（跳过出发层 + 上浮口层）里非 ascent_point 的节点。
  const midCandidates = layerNodes
    .slice(1, -1)
    .flat()
    .filter((id) => nodes[id].kind !== 'ascent_point');
  placeCorpses(nodes, midCandidates, { deaths, zoneId: zone.id, targetCorpseId, corpseChance, rng });

  // 钉放剧情节拍（quirk #174）：weight 0 的故事事件不进随机池，只由此显式放到其 depthRange 的**途中**节点——
  // 选范围内最深的「非末层」（末层＝必为上浮口·见 chooseLayeredNodeKind），强制其首节点为该事件（在 corpse pass
  // 之后落＝故事节拍优先于尸体）。下潜到该深度才撞见；没下到就上浮＝不进该节点＝事件 oncePerSave 不写 event_seen
  // ＝下次再钉·不可错过地等着（dive-start 每潜重算合规变体）。
  if (opts.pinnedEventId) {
    const ev = getEventById(opts.pinnedEventId);
    if (ev) {
      let targetLayer = -1;
      let lastResort = -1;
      for (let L = 0; L < totalLayers; L++) {
        const depth = Math.round(d0 + depthStep * L);
        if (depth < ev.depthRange[0] || depth > ev.depthRange[1]) continue;
        if (L === totalLayers - 1) lastResort = L; // 末层＝上浮口·仅作兜底
        else targetLayer = L; // 持续更新 → 落在范围内最深的非末层
      }
      if (targetLayer < 0) targetLayer = lastResort;
      if (targetLayer >= 0) {
        const nid = layerNodes[targetLayer][0];
        nodes[nid] = { ...nodes[nid], kind: 'event', eventId: opts.pinnedEventId, features: undefined, preview: ev.title };
      }
    }
  }

  // 教学关 node 化（#221+·SPEC 深海回响_教学关node化）：把脚本 beats 按**显式 layer 索引**钉到各层首节点（复用 pinnedEventId
  // 同款覆盖·在它之后落＝脚本布局优先）。仅教学首潜喂（generateDiveMap 门控·重访不喂）。末层（ascent_point）也可被覆盖成
  // 事件——教学靠 forceAscend 事件退出·不摸上浮口钮（见 SPEC·ascentLocked）。节点 id/深度/连边不动 ⇒ 与重访共用同一布局。
  for (const { layer, eventId, preview } of opts.scriptedNodeEvents ?? []) {
    const ev = getEventById(eventId);
    const row = layerNodes[layer];
    if (!ev || !row?.length) continue;
    const nid = row[0];
    // 节点预览＝**地点**（preview 显式给·缺省回退 ev.title）：剧情事件 title 有时是「事件名」而非地点，
    // 当节点名读着别扭、且与别的「地点型」节点（"可以喘息的水域"/"旧沉船"）不对称。scriptedNodeEvents 配地点 preview 修对称（#222 续）。
    nodes[nid] = { ...nodes[nid], kind: 'event', eventId, features: undefined, preview: preview ?? ev.title };
  }

  return {
    zoneId: zone.id,
    generatedAt: Date.now(),
    nodes,
    startNodeId: layerNodes[0][0],
  };
}
