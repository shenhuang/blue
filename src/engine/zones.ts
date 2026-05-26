// Zone 注册表 + 事件池加载
// 所有事件 JSON 在此被合并成一个全局 EVENT_DB；mapgen 从中按 tag/depth 抽取

import type { DiveEvent, ZoneDef, ZoneTag } from '@/types';
import tutorialEvents from '@/data/events/tutorial.json';
import reefEvents from '@/data/events/reef.json';
import zonesData from '@/data/zones.json';

export const ZONES: Map<string, ZoneDef> = new Map();
for (const z of (zonesData as { zones: ZoneDef[] }).zones) {
  ZONES.set(z.id, z);
}

export const EVENT_DB: Map<string, DiveEvent> = new Map();
for (const e of (tutorialEvents.events as DiveEvent[])) EVENT_DB.set(e.id, e);
for (const e of (reefEvents.events as DiveEvent[])) EVENT_DB.set(e.id, e);

export function getZone(id: string): ZoneDef | undefined {
  return ZONES.get(id);
}

export function getEventById(id: string): DiveEvent | undefined {
  return EVENT_DB.get(id);
}

/** 在 zone 当前层选哪些 zoneTag 抽取事件 */
export function tagsForDepth(zone: ZoneDef, depth: number): ZoneTag[] {
  let active: ZoneTag[] = [];
  for (const segment of zone.zoneTagsByDepth) {
    if (depth >= segment.minDepth) active = segment.tags;
  }
  return active;
}

/** 给定 zone + depth + sanity + flags，从 EVENT_DB 中筛出可抽取池 */
export function buildEventPool(opts: {
  zone: ZoneDef;
  depth: number;
  sanity: number;
  profileFlags: Set<string>;
  triggeredEventIds: string[];
  excludeIds?: Set<string>;
}): DiveEvent[] {
  const tags = new Set(tagsForDepth(opts.zone, opts.depth));
  const triggered = new Set(opts.triggeredEventIds);
  const exclude = opts.excludeIds ?? new Set();
  const pool: DiveEvent[] = [];

  for (const ev of EVENT_DB.values()) {
    if (ev.weight <= 0) continue;
    if (exclude.has(ev.id)) continue;

    // 深度匹配
    if (opts.depth < ev.depthRange[0] || opts.depth > ev.depthRange[1]) continue;

    // zoneTag 匹配（至少一个交集；如果事件没设 zoneTags，跳过）
    if (!ev.zoneTags || ev.zoneTags.length === 0) continue;
    if (!ev.zoneTags.some((t) => tags.has(t))) continue;

    // sanity 匹配
    if (ev.sanityRange) {
      if (opts.sanity < ev.sanityRange[0] || opts.sanity > ev.sanityRange[1]) continue;
    }

    // 前置 flag
    if (ev.prereqFlags && !ev.prereqFlags.every((f) => opts.profileFlags.has(f))) continue;
    if (ev.forbiddenFlags && ev.forbiddenFlags.some((f) => opts.profileFlags.has(f))) continue;

    // oncePerRun / oncePerSave
    if (ev.oncePerRun && triggered.has(ev.id)) continue;
    if (ev.oncePerSave && opts.profileFlags.has(`event_seen:${ev.id}`)) continue;

    pool.push(ev);
  }

  return pool;
}

/** 加权随机抽取（确定性版本使用传入的 rng） */
export function pickWeighted<T extends { weight: number }>(
  items: T[],
  rng: () => number = Math.random
): T | null {
  if (items.length === 0) return null;
  const total = items.reduce((a, b) => a + b.weight, 0);
  if (total <= 0) return null;
  let r = rng() * total;
  for (const item of items) {
    r -= item.weight;
    if (r <= 0) return item;
  }
  return items[items.length - 1];
}
