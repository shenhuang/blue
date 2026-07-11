// POI → 事件集 的只读派生（剧情编辑器「POI 走查」用·纯叶子·只读 chart_pois.json + EVENT_DB·不引 UI）。
//
// 回答「下潜进这个 POI（anchor / roaming 机会点）会触发哪些事件」——与引擎 startDiveFromPoi / buildEventPool
// 同源的三类（见 dive-start.ts 注释 §强制开场 / 故事重访变体 + events.ts DiveEvent.poiId）：
//   - open  ：强制开场 openEventId（入潜开场事件）
//   - story ：故事重访变体 storyOpenEvents（按门控钉到途中节点·quirk #174）
//   - scoped：poiId 专属事件——事件 poiId === anchor.id 或 === roaming.templateId（只此 POI 进池）
//
// 「真·POI 下潜」（Q2·2026-06-27）：上面三类只是**静态钩子**；真正下潜进一个 POI 还会从 zone/band 随机池
// 按深度抽事件。derivePoiRouting / derivePoiDivePool 镜像 startDiveFromPoi 的路由（cave / band / zone 三路径
// + depthOffset 平移 + band.tags 覆盖 + 洋流/能见度修正），用 buildEventPool（ignoreProfileGates 全量目录形态）
// 跨有效深度区间派生**实际随机池**——只读、不真启动下潜、不在 UI 重写匹配逻辑（单一真相＝buildEventPool）。
//
// roaming 机会点按 templateId 钉内容（与 chart.ts / buildEventPool 一致）。引用完整性交 scripts/smoke-poi-events.tsx 守。

import { EVENT_DB, getZone, tagsForDepth, buildEventPool } from './zones';
import { getBand, bandDiveModifier } from './bands';
import { getCave } from './caves';
import { getColumns, columnDivePoiId, columnTierBandId, columnStoryDivePoiId, columnStoryBandId } from './columns';
import chartData from '../data/chart_pois.json';
import type { ZoneDef, ZoneTag, CurrentStrength, NodeGate, PoiModifier } from '@/types';

export type PoiKind = 'anchor' | 'roaming';

export interface PoiEventSet {
  /** 稳定身份：anchor=id；roaming=templateId（= poiId 专属事件的匹配键）。 */
  key: string;
  kind: PoiKind;
  name: string;
  zoneId?: string;
  /** 入潜开场（openEventId）。 */
  open: string[];
  /** 故事重访变体（storyOpenEvents）。 */
  story: string[];
  /** poiId 专属事件（EVENT_DB 里 poiId === key）。 */
  scoped: string[];
}

interface RawPoi {
  id?: string;
  templateId?: string;
  name?: string;
  zoneId?: string;
  openEventId?: string;
  storyOpenEvents?: string[];
  // 路由字段（真·POI 下潜派生·镜像 ChartPoi 同名字段·与 startDiveFromPoi 三路径对应）：
  bandId?: string;
  caveEntry?: { caveId?: string };
  modifier?: PoiModifier;
}

/**
 * 深度柱**派生** POI（engine/columns.ts·非 chart_pois 手写）摊成 RawPoi——刷怪档 poi.dive.<短名>.t<tier>（noPoi 除外）
 * + 主线 beat poi.dive.<短名>.story（主线柱迁移）。它们在运行时由 buildColumnPois 注入海图、是稳定 id 的 anchor，
 * 故 POI 走查 / poiId 专属事件归位（如 reef.coral_grove_cutting 钉主线 beat 潜点）都应能定位到它们。
 * 这里只为「身份 + zone/band 路由」摊它们（不含 chart 揭示态）；带 bandId ⇒ derivePoiRouting 走 band 路径（与下潜一致）。
 */
function columnRawPois(): RawPoi[] {
  const out: RawPoi[] = [];
  for (const c of getColumns()) {
    for (const t of c.tiers) {
      if (t.noPoi) continue;
      out.push({ id: columnDivePoiId(c.id, t.tier), name: t.label, zoneId: c.zoneId, bandId: columnTierBandId(c.id, t.tier) });
    }
    if (c.storyTier) {
      out.push({ id: columnStoryDivePoiId(c.id), name: c.storyTier.label, zoneId: c.zoneId, bandId: columnStoryBandId(c.id) });
    }
  }
  return out;
}

/** 摊平 chart_pois.json 全部分段的 anchors + roamingTemplates（镜像 chart.ts flattenChartPois·但含隐藏/全量）+ 柱派生 POI。 */
function flattenRaw(): { anchors: RawPoi[]; roaming: RawPoi[] } {
  const anchors: RawPoi[] = [];
  const roaming: RawPoi[] = [];
  const file = chartData as Record<string, unknown>;
  for (const k of Object.keys(file)) {
    const seg = file[k];
    if (typeof seg === 'string' || k.startsWith('_')) continue;
    const s = seg as { anchors?: RawPoi[]; roamingTemplates?: RawPoi[] };
    anchors.push(...(s.anchors ?? []));
    roaming.push(...(s.roamingTemplates ?? []));
  }
  // 柱派生 POI 并入 anchor lane（稳定 id·与 chart 注入一致·poiId 专属事件按 id 归位）。
  anchors.push(...columnRawPois());
  return { anchors, roaming };
}

/** poiId → 专属事件 id[]（一次扫库建索引·避免每个 POI 重扫）。 */
function scopedIndex(): Map<string, string[]> {
  const idx = new Map<string, string[]>();
  for (const ev of EVENT_DB.values()) {
    if (!ev.poiId) continue;
    const arr = idx.get(ev.poiId);
    if (arr) arr.push(ev.id);
    else idx.set(ev.poiId, [ev.id]);
  }
  for (const arr of idx.values()) arr.sort((a, b) => a.localeCompare(b));
  return idx;
}

const openOf = (p: RawPoi): string[] => (p.openEventId ? [p.openEventId] : []);

let _scopedIdx: Map<string, string[]> | null = null;
/** scopedIndex 的缓存（listPoiEventSets + derivePoiDivePool 共用·避免每次重扫 EVENT_DB）。 */
function scopedIndexCached(): Map<string, string[]> {
  if (!_scopedIdx) _scopedIdx = scopedIndex();
  return _scopedIdx;
}

let _rawByKey: Map<string, { raw: RawPoi; kind: PoiKind }> | null = null;
/** key（anchor=id / roaming=templateId·与 listPoiEventSets 同 key）→ 原始 POI + 类别。路由派生反查用·memoized。 */
function rawByKey(): Map<string, { raw: RawPoi; kind: PoiKind }> {
  if (_rawByKey) return _rawByKey;
  const { anchors, roaming } = flattenRaw();
  const m = new Map<string, { raw: RawPoi; kind: PoiKind }>();
  for (const a of anchors) if (a.id && !m.has(a.id)) m.set(a.id, { raw: a, kind: 'anchor' });
  for (const t of roaming) if (t.templateId && !m.has(t.templateId)) m.set(t.templateId, { raw: t, kind: 'roaming' });
  _rawByKey = m;
  return m;
}

/** 全库 POI（anchor + roaming 机会点）各自的事件集。顺序：anchor 先（按 key），roaming 随后（按 key）。 */
export function listPoiEventSets(): PoiEventSet[] {
  const { anchors, roaming } = flattenRaw();
  const scoped = scopedIndexCached();
  const out: PoiEventSet[] = [];
  for (const a of anchors) {
    if (!a.id) continue;
    out.push({
      key: a.id,
      kind: 'anchor',
      name: a.name ?? a.id,
      zoneId: a.zoneId,
      open: openOf(a),
      story: a.storyOpenEvents ?? [],
      scoped: scoped.get(a.id) ?? [],
    });
  }
  for (const t of roaming) {
    if (!t.templateId) continue;
    out.push({
      key: t.templateId,
      kind: 'roaming',
      name: t.name ?? t.templateId,
      zoneId: t.zoneId,
      open: openOf(t),
      story: t.storyOpenEvents ?? [],
      scoped: scoped.get(t.templateId) ?? [],
    });
  }
  out.sort((a, b) => (a.kind === b.kind ? a.key.localeCompare(b.key) : a.kind === 'anchor' ? -1 : 1));
  return out;
}

/** 一个 POI 事件集涉及的所有事件 id（去重·保序 open→story→scoped）。 */
export function poiEventIds(s: PoiEventSet): string[] {
  return [...new Set([...s.open, ...s.story, ...s.scoped])];
}

// ── 真·POI 下潜派生（Q2·2026-06-27）─────────────────────────────────────────
// 镜像 startDiveFromPoi 的只读路由 + buildEventPool 全量目录派生；不真启动下潜。

export type PoiDiveVia = 'zone' | 'band' | 'cave';

export interface PoiDiveRouting {
  /** 走哪条下潜路径（dive-start 先判 caveEntry，再 bandId，否则 zone）。 */
  via: PoiDiveVia;
  zoneId: string;
  zoneName?: string;
  /** 有效深度区间：按 mapgen 公式 d0=max(0,r0+off)/d1=max(d0+1,r1+off)（band·cave 用绝对窗口·off=0）。 */
  depthRange: [number, number];
  /** 本次下潜活跃的 zoneTag 集合（band→band.tags 覆盖；否则 zone.zoneTagsByDepth 跨深度并集）。 */
  tags: ZoneTag[];
  bandId?: string;
  caveId?: string;
  /** POI 固有洋流（band→bandDiveModifier）。 */
  current?: CurrentStrength;
  /** POI 固有整潜门（感知门 SPEC·band→bandDiveModifier·取代旧 visibility）。 */
  gate?: NodeGate;
  /** zone 路径的深度偏移（≠0 才带）。 */
  depthOffset?: number;
  /** zone 路径：大潮（月相）可把洋流升档（运行期按 day 派生·此处只标注可能性·band/cave 不吃月相）。 */
  lunarMayUpgradeCurrent?: boolean;
}

export interface PoiDivePool {
  routing: PoiDiveRouting | null;
  /** 实际随机池事件 id[]（buildEventPool 全量目录派生·去重·已减去 open/story/scoped 钩子·按 id 排序）。 */
  randomIds: string[];
}

const NO_FLAGS = new Set<string>(); // ignoreProfileGates=true 时不被读·仅满足 buildEventPool 形参。

/** mapgen 的有效深度窗口公式（dive-start→mapgen：range[0/1]+offset·夹到 ≥0 且 d1>d0）。 */
function effectiveSpan(range: [number, number], offset: number): [number, number] {
  const d0 = Math.max(0, range[0] + offset);
  const d1 = Math.max(d0 + 1, range[1] + offset);
  return [d0, d1];
}

/** zone.zoneTagsByDepth 在 [lo,hi] 跨深度的活跃 tag 并集（按 tagsForDepth 在区段边界采样·与 buildEventPool 同源）。 */
function activeTagsAcross(zone: ZoneDef, lo: number, hi: number): ZoneTag[] {
  const samples = new Set<number>([lo, hi]);
  for (const seg of zone.zoneTagsByDepth) if (seg.minDepth > lo && seg.minDepth <= hi) samples.add(seg.minDepth);
  const tags = new Set<ZoneTag>();
  for (const d of samples) for (const t of tagsForDepth(zone, d)) tags.add(t);
  return [...tags];
}

/** 解析一个 POI 的下潜路由（镜像 startDiveFromPoi：cave→band→zone 优先级）。无法定位 zone → null。 */
function resolveRouting(raw: RawPoi): PoiDiveRouting | null {
  // cave 路径（dive-start 先判 caveEntry·与 bandId/zone 互斥）。
  if (raw.caveEntry?.caveId) {
    const cave = getCave(raw.caveEntry.caveId);
    if (cave) {
      const zone = getZone(cave.zoneId);
      const span = effectiveSpan(cave.depthRange, 0);
      return {
        via: 'cave', zoneId: cave.zoneId, zoneName: zone?.name, caveId: cave.caveId,
        depthRange: span, tags: zone ? activeTagsAcross(zone, span[0], span[1]) : [],
      };
    }
  }
  // band 路径（深度柱深入潜点·band 绝对 depthRange 覆盖 zone·band.tags 覆盖 zoneTagsByDepth）。
  if (raw.bandId) {
    const band = getBand(raw.bandId);
    if (band) {
      const zone = getZone(band.zoneId);
      const span = effectiveSpan(band.depthRange, 0);
      const m = bandDiveModifier(band);
      return {
        via: 'band', zoneId: band.zoneId, zoneName: zone?.name, bandId: raw.bandId,
        depthRange: span,
        tags: band.tags ?? (zone ? activeTagsAcross(zone, span[0], span[1]) : []),
        current: m.current, gate: m.gate,
      };
    }
  }
  // zone 路径（anchor / roaming / story / mimic·modifier.depthOffset 平移整图深度）。
  const zone = raw.zoneId ? getZone(raw.zoneId) : undefined;
  if (!zone) return null;
  const off = raw.modifier?.depthOffset ?? 0;
  const span = effectiveSpan(raw.modifier?.depthRange ?? zone.depthRange, off);
  return {
    via: 'zone', zoneId: zone.id, zoneName: zone.name,
    depthRange: span, tags: activeTagsAcross(zone, span[0], span[1]),
    current: raw.modifier?.current, gate: raw.modifier?.gate,
    depthOffset: off || undefined, lunarMayUpgradeCurrent: true,
  };
}

const _routingCache = new Map<string, PoiDiveRouting | null>();
const _poolCache = new Map<string, PoiDivePool>();

/** 一个 POI 的下潜路由（cheap·无 DB 扫描·memoized）。供编辑器过滤「可走查」+ 路由修正头。无此 key / 无法定位 zone → null。 */
export function derivePoiRouting(key: string): PoiDiveRouting | null {
  if (_routingCache.has(key)) return _routingCache.get(key)!;
  const entry = rawByKey().get(key);
  const r = entry ? resolveRouting(entry.raw) : null;
  _routingCache.set(key, r);
  return r;
}

/**
 * 一个 POI「真·下潜」的实际随机池（expensive·跨深度扫 EVENT_DB·memoized·懒算）。
 * 复用 buildEventPool（ignoreProfileGates 全量目录形态）逐深度并集——单一真相＝buildEventPool 的路由门控
 * （depth/zoneTag/poiId），不在此重写匹配。已减去 open/story/scoped 钩子（它们各自在编辑器归位·不重复列）。
 */
export function derivePoiDivePool(key: string): PoiDivePool {
  const cached = _poolCache.get(key);
  if (cached) return cached;
  const entry = rawByKey().get(key);
  const routing = derivePoiRouting(key);
  const zone = routing ? getZone(routing.zoneId) : undefined;
  if (!entry || !routing || !zone) {
    const empty: PoiDivePool = { routing, randomIds: [] };
    _poolCache.set(key, empty);
    return empty;
  }
  const raw = entry.raw;
  // band 路径用 band.tags 覆盖 zoneTagsByDepth；roaming 专属事件按稳定 templateId 匹配（实例 poiId 运行期才有）。
  const tagsOverride = routing.via === 'band' ? getBand(raw.bandId!)?.tags : undefined;
  const poiId = entry.kind === 'anchor' ? raw.id : undefined;
  const poiTemplateId = raw.templateId;
  const [lo, hi] = routing.depthRange;
  const ids = new Set<string>();
  for (let d = lo; d <= hi; d++) {
    for (const ev of buildEventPool({
      zone, depth: d, profileFlags: NO_FLAGS,
      triggeredEventIds: [], tagsOverride, poiId, poiTemplateId, ignoreProfileGates: true,
    })) {
      ids.add(ev.id);
    }
  }
  // 钩子（开场/变体/专属）已在编辑器各自列出 → 从随机池减去·避免重复。
  const hooks = new Set<string>([
    ...openOf(raw),
    ...(raw.storyOpenEvents ?? []),
    ...(scopedIndexCached().get(key) ?? []),
  ]);
  const randomIds = [...ids].filter((id) => !hooks.has(id)).sort((a, b) => a.localeCompare(b));
  const result: PoiDivePool = { routing, randomIds };
  _poolCache.set(key, result);
  return result;
}

/**
 * 「下潜进此 POI 可能触发的全部事件」id 并集 = 随机池 ∪ 开场(open) ∪ 故事变体(story) ∪ poiId 专属钩子(scoped)。
 * derivePoiDivePool 为「编辑器不重复列钩子」把 open/story/scoped 从随机池减掉了；本函数把它们并回——
 * 单一真相仍是 buildEventPool 路由 + openOf/storyOpenEvents/scopedIndex 各源，不在此重写匹配。
 * 用途：港口海图潜点信息「可能收获」材料派生（engine/poiMaterials.ts）——need 全部 loot 源。
 * anchor 用 id、roaming 用 templateId 当 key。
 */
export function poiAllEventIds(key: string): string[] {
  const pool = derivePoiDivePool(key);
  const raw = rawByKey().get(key)?.raw;
  const ids = new Set<string>(pool.randomIds);
  if (raw) {
    for (const id of openOf(raw)) ids.add(id);
    for (const id of raw.storyOpenEvents ?? []) ids.add(id);
  }
  for (const id of scopedIndexCached().get(key) ?? []) ids.add(id);
  return [...ids].sort((a, b) => a.localeCompare(b));
}
