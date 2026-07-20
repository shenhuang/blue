// 层状生成器（开阔海域：猩红礁滩 / 开阔测试水域）——generateLayeredMap
// 真 2D 坐标版（地图2D坐标 SPEC·Phase 2·2026-07-20）：弃「逐层均深 + 只连下一层 + 洗牌连边」，改走与迷路
// **同一条撒点脊柱**（mapgen-scatter.ts·Poisson-disk 撒点 → Gabriel∪MST 邻近图 → 结构编排）——开阔水域 SPEC §3
// 「节点图保持无坐标」自此 supersede（本批落地）。开阔「宽感」靠域宽系数（OPENWATER_WIDTH_SCALE·占位）。
// `layer` 字段新语义 = BFS 树距（与迷路统一·文件头注）。含钉放剧情节拍（quirk #174）与教学关 node 化（#221+·dormant）两覆盖 pass。
// 公共工具见 mapgen-shared；对外经 mapgen.ts 门面。

import type { DiveMap, DiveNode, NodeFeature, NodeKind, ZoneTag } from '@/types';
import { buildEventPool, getEventById, pickWeighted, tagsForDepth } from './zones';
import {
  type GenOpts,
  randInt,
  pickFrom,
  clamp,
  maybeMultiFeatureRoom,
  roomPreview,
  placeCorpses,
} from './mapgen-shared';
import { buildScatterGraph } from './mapgen-scatter';

// ============================================================
// 层状（开阔海域）—— 真 2D 撒点连图（行为语义对齐旧版·坐标化）
// ============================================================

/** 开阔水域域宽系数（撒点域比竖向迷路更宽＝开阔「摊得开」的横向感·占位待调·[[defer-number-tuning]]）。 */
const OPENWATER_WIDTH_SCALE = 1.8;

// 同深/并列的 rest / ascent_point 节点曾共用同一句 preview → 同描述、玩家无从区分（playtest 报告④/⑤）。
// 按出现序取不同句：纯派生·不入任何回归基线（preview 不入 mapgen 场景快照·已核对 scenarios/ + playthrough-*）。
// ascent_point 文案同时说清「歇脚 + 可从这里折返上浮」，破误读（dive-move 把 ascent_point 路由到 rest 子阶段·RestView 给上浮钮）。
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

/**
 * 中间节点类型 roll（旧 chooseLayeredNodeKind 的「中间层」分支·逐字保留概率·canFreeAscend 分支不动）：
 * free-ascend 区随时可「此处上浮」→ 中间不再生成冗余 ascent_point（#220·作者「能上浮的地方还放上浮口没必要」），
 * 只 event/rest；洞穴/封闭（canFreeAscend=false）中间层同样不放 ascent。start 与「最深上浮口」在外面显式定，不走这里。
 */
function middleNodeKind(rng: () => number, canFreeAscend: boolean): 'event' | 'rest' {
  const roll = rng();
  if (canFreeAscend) return roll < 0.8 ? 'event' : 'rest';
  return roll < 0.9 ? 'event' : 'rest';
}

export function generateLayeredMap(opts: GenOpts, baseD0: number, baseD1: number): DiveMap {
  const { zone, profileFlags, rng = Math.random, deaths = [], corpseChance = 0.6, targetCorpseId, maxRoomFeatures = 1, roomFeatureChanceBonus = 0 } = opts;

  const totalLayers = opts.layerCount ?? zone.layerCount;
  const d0 = baseD0;
  const d1 = baseD1;
  const canFreeAscend = zone.canFreeAscend !== false; // 默认 true

  // —— 节点数：沿用「每层 randInt(nodesPerLayer) 累加」＝内容预算不变（totalLayers 次 rng 抽·同旧总量分布）——
  let N = 0;
  for (let L = 0; L < totalLayers; L++) N += randInt(zone.nodesPerLayer[0], zone.nodesPerLayer[1], rng);
  // 下限 12（复审 fuzz 实证 N<10 撒点脊柱不安全：N=3 必翻车〔无环 + farExit undefined〕·N=8/9 边界）——低 layerCount
  // 开阔覆盖可把总量压到低值故须防御（现役开阔 zone layerCount 4 ⇒ 自然 N∈[8,12]·此地板兜住 <12 的那半）。
  N = Math.max(12, N);

  // —— 撒点脊柱：开阔水域＝竖向域（下潜轴）拉宽·curveK=1（开阔无洞型谱·线性下行·同旧逐层均深方向）——
  const { pts, adj, dist, entrance, deepPoints, farExit } = buildScatterGraph({
    rng, n: N, d0, d1, curveK: 1, domain: 'vertical', widthScale: OPENWATER_WIDTH_SCALE,
  });
  void farExit; // 开阔水域不另标 far exit（最深 1–2 点即上浮口·见下）——脊柱产出照收、不用
  const nodeCount = pts.length; // 实际节点数（撒点自适应间距下可能略少于目标 N）——以下全用它。

  const depth = pts.map((p) => Math.round(clamp(p.y, d0, d1)));
  const idOf = (i: number) => `node.${i}`;

  // 最深的 1–2 个节点＝ascent_point（旧「末层=上浮口」的坐标版）。deepPoints 已按 y 最深钉 d1·取前二。
  const ascentSet = new Set<number>(deepPoints.slice(0, Math.min(2, deepPoints.length)));

  const triggeredFakeIds: string[] = []; // 传给 buildEventPool 防同 run 重复
  const nodes: Record<string, DiveNode> = {};
  let restSeq = 0;
  let ascentSeq = 0;

  for (let i = 0; i < nodeCount; i++) {
    const depthI = depth[i];
    const isEntrance = i === entrance;
    const isAscent = ascentSet.has(i);
    // 节点类型：start（entrance）＝event（旧 layer0 规则·兜底 rest）；最深 1–2＝ascent_point；其余走中间 roll。
    const baseKind: NodeKind = isEntrance ? 'event' : isAscent ? 'ascent_point' : middleNodeKind(rng, canFreeAscend);

    const zoneTag: ZoneTag = pickFrom(opts.bandTags ?? tagsForDepth(zone, depthI), rng) ?? 'reef';
    let kind: NodeKind = baseKind;
    let eventId: string | undefined;
    let features: NodeFeature[] | undefined;
    let preview = '';

    if (baseKind === 'event') {
      const pool = buildEventPool({
        zone,
        depth: depthI,
        profileFlags,
        triggeredEventIds: triggeredFakeIds,
        poiId: opts.poiId,
        poiTemplateId: opts.poiTemplateId,
      });
      if (pool.length === 0) {
        // 没有匹配事件，退化为 rest（旧行为·固定文案）
        kind = 'rest';
        preview = '一片空旷的水域。';
      } else {
        const chosen = pickWeighted(pool, rng)!;
        eventId = chosen.id;
        preview = chosen.title;
        triggeredFakeIds.push(chosen.id); // 同 run 不再选
        // 多事件房间（S1）：偶尔升级成大房间（maxRoomFeatures>1 才进；缺省零额外 rng＝旧图不变）。
        const feats = maybeMultiFeatureRoom(chosen, {
          zone, depth: depthI, profileFlags, triggeredFakeIds, bandTags: opts.bandTags, poiId: opts.poiId, poiTemplateId: opts.poiTemplateId, rng, maxFeatures: maxRoomFeatures, chanceBonus: roomFeatureChanceBonus,
        });
        if (feats) {
          features = feats;
          eventId = undefined; // 大房间不用单 eventId：moveToNode 据 features 路由到房间菜单
          preview = roomPreview(feats.length);
        }
      }
    } else if (baseKind === 'rest') {
      // 并列 rest 取不同句（破「无从区分」·按出现序轮换）。
      preview = REST_PREVIEWS[restSeq++ % REST_PREVIEWS.length];
    } else if (baseKind === 'ascent_point') {
      // 最深上浮口差异化 + 文案点明「歇脚＋折返上浮」（破误读·见常量注释）。
      preview = ASCENT_PREVIEWS[ascentSeq++ % ASCENT_PREVIEWS.length];
    }

    nodes[idOf(i)] = {
      id: idOf(i),
      layer: dist[i], // 新语义＝到 entrance 的 BFS 树距（与迷路统一）
      depth: depthI,
      x: pts[i].x, // 真 2D 横坐标（米·渲染 px = x·pxPerMeter·SPEC §1）
      zoneTag,
      kind,
      eventId,
      features,
      connectsTo: [...adj[i]].map(idOf), // 双向边（开阔水域可回游）
      preview,
    };
  }

  // —— Corpse pass ——
  // 候选 = 非 start、非 ascent_point 的节点。
  const corpseCandidates: string[] = [];
  for (let i = 0; i < nodeCount; i++) {
    if (i === entrance) continue;
    if (nodes[idOf(i)].kind === 'ascent_point') continue;
    corpseCandidates.push(idOf(i));
  }
  placeCorpses(nodes, corpseCandidates, { deaths, zoneId: zone.id, targetCorpseId, corpseChance, rng });

  // 钉放剧情节拍（quirk #174·**dormant**·现无 layered 剧情下潜喂它）：weight 0 的故事事件不进随机池，只由此显式放到其
  // depthRange 内**最深的非 ascent_point 节点**（无则兜底最深 ascent）。下潜到该深度才撞见；没下到就上浮＝不进该节点。
  if (opts.pinnedEventId) {
    const ev = getEventById(opts.pinnedEventId);
    if (ev) {
      let target = -1;
      let targetDepth = -Infinity;
      let fallback = -1;
      let fallbackDepth = -Infinity;
      for (let i = 0; i < nodeCount; i++) {
        const dep = depth[i];
        if (dep < ev.depthRange[0] || dep > ev.depthRange[1]) continue;
        if (nodes[idOf(i)].kind === 'ascent_point') {
          if (dep > fallbackDepth) ((fallbackDepth = dep), (fallback = i)); // 兜底：范围内最深 ascent
        } else if (dep > targetDepth) {
          ((targetDepth = dep), (target = i)); // 范围内最深的非 ascent
        }
      }
      const nid = target >= 0 ? idOf(target) : fallback >= 0 ? idOf(fallback) : undefined;
      if (nid) nodes[nid] = { ...nodes[nid], kind: 'event', eventId: opts.pinnedEventId, features: undefined, preview: ev.title };
    }
  }

  // 教学关 node 化（#221+·**dormant**·现无 layered+scriptedNodeEvents 的 linearScripted zone）：把脚本 beats 钉到
  // **dist==layer 的节点组第一个（id 序）**（layer 索引在坐标化后重解释为 BFS 树距组·旧「层首节点」的等价）。
  for (const { layer, eventId, preview } of opts.scriptedNodeEvents ?? []) {
    const ev = getEventById(eventId);
    if (!ev) continue;
    let nid: string | undefined;
    for (let i = 0; i < nodeCount; i++) {
      if (dist[i] !== layer) continue;
      const cand = idOf(i);
      if (nid === undefined || cand < nid) nid = cand; // 组内 id 序第一个
    }
    if (!nid) continue;
    // 节点预览＝地点（preview 显式给·缺省回退 ev.title·#222 续）。
    nodes[nid] = { ...nodes[nid], kind: 'event', eventId, features: undefined, preview: preview ?? ev.title };
  }

  return {
    zoneId: zone.id,
    generatedAt: Date.now(),
    nodes,
    startNodeId: idOf(entrance),
  };
}
