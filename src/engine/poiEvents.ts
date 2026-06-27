// POI → 事件集 的只读派生（剧情编辑器「POI 走查」用·纯叶子·只读 chart_pois.json + EVENT_DB·不引 UI）。
//
// 回答「下潜进这个 POI（anchor / roaming 机会点）会触发哪些事件」——与引擎 startDiveFromPoi / buildEventPool
// 同源的三类（见 dive-start.ts 注释 §强制开场 / 刷点轮替 / 故事重访变体 + events.ts DiveEvent.poiId）：
//   - open  ：强制开场 openEventId + 刷点轮替池 openEventPool（入潜开场事件）
//   - story ：故事重访变体 storyOpenEvents（按门控钉到途中节点·quirk #174）
//   - scoped：poiId 专属事件——事件 poiId === anchor.id 或 === roaming.templateId（只此 POI 进池）
//
// roaming 机会点按 templateId 钉内容（与 chart.ts / buildEventPool 一致）。引用完整性交 scripts/smoke-poi-events.tsx 守。

import { EVENT_DB } from './zones';
import chartData from '../data/chart_pois.json';

export type PoiKind = 'anchor' | 'roaming';

export interface PoiEventSet {
  /** 稳定身份：anchor=id；roaming=templateId（= poiId 专属事件的匹配键）。 */
  key: string;
  kind: PoiKind;
  name: string;
  zoneId?: string;
  /** 入潜开场（openEventId 先，openEventPool 轮替池随后）。 */
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
  openEventPool?: string[];
  storyOpenEvents?: string[];
}

/** 摊平 chart_pois.json 全部分段的 anchors + roamingTemplates（镜像 chart.ts flattenChartPois·但含隐藏/全量）。 */
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

const openOf = (p: RawPoi): string[] => [...(p.openEventId ? [p.openEventId] : []), ...(p.openEventPool ?? [])];

/** 全库 POI（anchor + roaming 机会点）各自的事件集。顺序：anchor 先（按 key），roaming 随后（按 key）。 */
export function listPoiEventSets(): PoiEventSet[] {
  const { anchors, roaming } = flattenRaw();
  const scoped = scopedIndex();
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
