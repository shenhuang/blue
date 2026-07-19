// eventStats —— 事件内容「分布统计」纯聚合层（叶子·无 UI·无副作用）
//
// 目的：把「内容平衡」从靠人眼/散文，变成一处可复用的派生数据——
//   - materialStats（经济「素材」面板数据层）与 smoke-event-stats 门直接吃它；
//   - 将来若要把「分布太偏就报警」升成 regress 机制（见 docs/QUIRKS 散文→机制约定），
//     CLI / 检查脚本直接 import 本文件，不必在 UI 里复刻聚合逻辑。
//   （原第一消费者 StatsDevPanel〔?editor=stats 统计 tab〕已删·2026-07-19——聚合层不动。）
//
// 数据来源：engine/eventScenario.ts::listAllEvents()（EVENT_DB 单一真相）。
// 边界：engine ↛ ui（check-boundaries 规则一）——本文件只 import 同层 engine，零 React/DOM。
//
// 计数口径（重要·UI 也照此标注）：
//   - total      = 去重后的事件总数（每个事件算一次）。
//   - byTone     = 按 tone 分组的事件数（每事件恰好一个 tone·合计 == total）。
//   - matrix/byZone = 每个事件按**入潜深度**(depthRange[0]) 归入唯一一个深度桶；多 tag 事件在它的
//                  每个 zoneTag 对应行各记一次（它确实同属多个 zone 池）。于是「行合计 == 该 tag 的事件数」，
//                  格子相加不会因 depthRange 跨度而虚高（防「1 个跨段事件被显示成 4」的误读）。
//                  唯一仍 >= total 的是跨多 tag 的事件——那是真实的多池归属，有意保留。

import { listAllEvents } from './eventScenario';

/** 深度桶（每 BUCKET_M 米一格·显示粒度·非游戏 band 定义）。 */
export interface DepthBucket {
  lo: number;
  hi: number;
  /** 形如 "30–60m" */
  label: string;
}

/** 一条「建议补的池」：某 zone 在其活跃深度跨度内、某深度桶薄(thin)或空(gap)。 */
export interface PoolSuggestion {
  zone: string;
  bucketLabel: string;
  count: number;
  kind: 'gap' | 'thin';
}

export interface EventStats {
  /** 去重事件总数。 */
  total: number;
  /** 出现过的全部 zoneTag（升序）。 */
  zones: string[];
  /** 深度桶（按深度升序）。 */
  buckets: DepthBucket[];
  /** tone → 事件数，按数量降序。 */
  byTone: Array<{ tone: string; count: number }>;
  /** zoneTag → 出现次数，按数量升序（最薄在前·便于补内容）。 */
  byZone: Array<{ zone: string; count: number }>;
  /** 深度桶 → 出现次数，按深度升序。 */
  byBucket: Array<{ label: string; count: number }>;
  /** matrix[zoneIndex][bucketIndex] = 该 zone 在该深度桶的事件出现次数。 */
  matrix: number[][];
  /** 每行（zone）合计。 */
  zoneTotals: number[];
  /** 每列（深度桶）合计。 */
  bucketTotals: number[];
  /** tone 全集（canonical 顺序 realistic→uncanny→cosmic→其它·供堆叠图固定配色/顺序）。 */
  tones: string[];
  /** toneByZone[toneIndex][zoneIndex] = 该 tone 在该 zoneTag 的出现次数（多 tag 各记一次）。 */
  toneByZone: number[][];
  /** toneByBucket[toneIndex][bucketIndex] = 该 tone 在该深度桶的事件数（每事件一次·入潜深度）。 */
  toneByBucket: number[][];
  /** 建议补的池（空洞优先·再薄池·均在各 zone 活跃深度跨度内）。 */
  suggestions: PoolSuggestion[];
}

/** 深度桶粒度（米）。纯显示粒度——改这里只影响直方图分辨率，不动游戏逻辑。 */
const BUCKET_M = 30;
/** 出现次数 <= 此值视作「薄池」（设计上内容池太薄·重复 2–3 次就认脸）。 */
const THIN_AT = 1;

function buildBuckets(maxHi: number): DepthBucket[] {
  const n = Math.max(1, Math.ceil(maxHi / BUCKET_M));
  const out: DepthBucket[] = [];
  for (let i = 0; i < n; i++) {
    const lo = i * BUCKET_M;
    const hi = (i + 1) * BUCKET_M;
    out.push({ lo, hi, label: `${lo}–${hi}m` });
  }
  return out;
}

/**
 * 计算事件内容的分布统计。纯函数：每次读 listAllEvents() 现算，无缓存（事件 DB 在 module load 即定，
 * 调用便宜；要缓存交给调用方）。
 */
export function computeEventStats(): EventStats {
  const events = listAllEvents();
  const total = events.length;

  // —— 深度桶（按最深事件铺满）
  const maxHi = events.reduce((m, e) => Math.max(m, e.depthRange[1]), 0);
  const buckets = buildBuckets(maxHi);

  // —— zone 全集，按「代表深度」(均值入潜深度) 升序 ≈ 解锁/推进顺序。
  // 数据驱动（不硬编码顺序表·加内容自适应）；均值比 min 稳（不被单个浅 outlier 拽前）。
  const zoneSet = new Set<string>();
  const zoneDepth = new Map<string, { sum: number; n: number }>();
  for (const e of events)
    for (const z of e.zoneTags ?? []) {
      zoneSet.add(z);
      const d = zoneDepth.get(z) ?? { sum: 0, n: 0 };
      d.sum += e.depthRange[0];
      d.n += 1;
      zoneDepth.set(z, d);
    }
  const zoneMeanDepth = (z: string) => {
    const d = zoneDepth.get(z);
    return d && d.n ? d.sum / d.n : 0;
  };
  const zones = [...zoneSet].sort((a, b) => zoneMeanDepth(a) - zoneMeanDepth(b) || a.localeCompare(b));
  const zoneIndex = new Map(zones.map((z, i) => [z, i] as const));

  // —— tone 分组
  const toneCount = new Map<string, number>();
  for (const e of events) toneCount.set(e.tone, (toneCount.get(e.tone) ?? 0) + 1);
  const byTone = [...toneCount.entries()]
    .map(([tone, count]) => ({ tone, count }))
    .sort((a, b) => b.count - a.count || a.tone.localeCompare(b.tone));

  // —— 矩阵 zone × 深度桶：每事件按入潜深度 depthRange[0] 归唯一一桶，多 tag 各行各记一次（见顶注口径）
  const bucketOf = (d: number) =>
    Math.min(buckets.length - 1, Math.max(0, Math.floor(d / BUCKET_M)));
  const matrix: number[][] = zones.map(() => buckets.map(() => 0));
  for (const e of events) {
    const tags = e.zoneTags ?? [];
    if (tags.length === 0) continue; // 无 tag 的事件不进 zone 矩阵（仍计入 total / byTone）
    const bi = bucketOf(e.depthRange[0]);
    for (const z of tags) matrix[zoneIndex.get(z)!][bi] += 1;
  }

  const zoneTotals = matrix.map((row) => row.reduce((s, c) => s + c, 0));
  const bucketTotals = buckets.map((_, bi) => matrix.reduce((s, row) => s + row[bi], 0));

  const byZone = zones
    .map((zone, i) => ({ zone, count: zoneTotals[i] }))
    .sort((a, b) => a.count - b.count || a.zone.localeCompare(b.zone));
  const byBucket = buckets.map((b, bi) => ({ label: b.label, count: bucketTotals[bi] }));

  // —— tone 交叉表：tone × zone（出现次数·多 tag 各记一次）与 tone × 深度（每事件一次·入潜深度）
  const TONE_RANK: Record<string, number> = { realistic: 0, uncanny: 1, cosmic: 2 };
  const tones = [...toneCount.keys()].sort(
    (a, b) => (TONE_RANK[a] ?? 9) - (TONE_RANK[b] ?? 9) || a.localeCompare(b),
  );
  const toneIndex = new Map(tones.map((t, i) => [t, i] as const));
  const toneByZone = tones.map(() => zones.map(() => 0));
  const toneByBucket = tones.map(() => buckets.map(() => 0));
  for (const e of events) {
    const ti = toneIndex.get(e.tone)!;
    toneByBucket[ti][bucketOf(e.depthRange[0])] += 1;
    for (const z of e.zoneTags ?? []) toneByZone[ti][zoneIndex.get(z)!] += 1;
  }

  // —— 建议补的池：每个 zone 在其「活跃深度跨度」内、空洞(gap) 或 薄(thin) 的桶
  const suggestions: PoolSuggestion[] = [];
  for (let zi = 0; zi < zones.length; zi++) {
    const zone = zones[zi];
    const zoneEvents = events.filter((e) => (e.zoneTags ?? []).includes(zone));
    if (zoneEvents.length === 0) continue;
    // 活跃跨度＝该 zone 入潜深度的最浅~最深桶（与矩阵口径一致）——只在此区间内报缺口，
    // 避免把结构性不存在的深度误报为「该补」。
    const loB = bucketOf(zoneEvents.reduce((m, e) => Math.min(m, e.depthRange[0]), Infinity));
    const hiB = bucketOf(zoneEvents.reduce((m, e) => Math.max(m, e.depthRange[0]), 0));
    for (let bi = loB; bi <= hiB; bi++) {
      const count = matrix[zi][bi];
      const label = buckets[bi].label;
      if (count === 0) suggestions.push({ zone, bucketLabel: label, count, kind: 'gap' });
      else if (count <= THIN_AT) suggestions.push({ zone, bucketLabel: label, count, kind: 'thin' });
    }
  }
  // 空洞优先（kind: gap 先于 thin），再按出现次数升序，再按深度
  suggestions.sort(
    (a, b) =>
      (a.kind === b.kind ? 0 : a.kind === 'gap' ? -1 : 1) ||
      a.count - b.count ||
      a.bucketLabel.localeCompare(b.bucketLabel),
  );

  return {
    total,
    zones,
    buckets,
    byTone,
    byZone,
    byBucket,
    matrix,
    zoneTotals,
    bucketTotals,
    tones,
    toneByZone,
    toneByBucket,
    suggestions,
  };
}
