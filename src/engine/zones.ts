// Zone 注册表 + 事件池加载
// 所有事件 JSON 在此被合并成一个全局 EVENT_DB；mapgen 从中按 tag/depth 抽取

import type { DiveEvent, Outcome, ZoneDef, ZoneTag } from '@/types';
import qaFixtureEvents from '@/data/events/qa_fixture.json';
import zonesData from '@/data/zones.json';

// 白板（2026-07-12·开放水域 + tutorial/ch1 主线整删，续·洞穴内容整删）：tutorial/ch1 主线事件 + reef/
// midwater/vent/rocky_slope 开阔海域事件 + 27 条真实洞穴 zone（含最后存活的 blue_caves 2 条
// poiId 内容）+ zone.the_deep_gate 全部删除；zones.json 仅剩 zone.warren + 3 条 maze 朝向 QA 夹具
// （horizontal_test/vertical_test/serpentine_test）。开放水域与主线内容由作者未来重写（见 docs/QUIRKS +
// docs/HANDOFF）。引擎（mapgen/事件池/EVENT_DB 装载）不变——机制留、只是暂无叙事数据可抽；
// 洞穴/持久洞入口机制留、内容空。EVENT_DB 现只装 events/qa_fixture.json 一条非叙事 QA 夹具事件
// （见该文件头注）——纯为不让 EventView/事件统计/揭示归因等既有 regress 覆盖随内容一起归零。

export const ZONES: Map<string, ZoneDef> = new Map();
for (const z of (zonesData as { zones: ZoneDef[] }).zones) {
  ZONES.set(z.id, z);
}

export const EVENT_DB: Map<string, DiveEvent> = new Map();
for (const e of (qaFixtureEvents.events as DiveEvent[])) EVENT_DB.set(e.id, e);

export function getZone(id: string): ZoneDef | undefined {
  return ZONES.get(id);
}

/**
 * 这个 zone 的下潜图能否「回头」（节点级 backtrack）。
 * 迷路图（mapShape='maze'，如蓝洞群 + 借它的 trench 柱 band）双向连通＝能原路返回；
 * 层状图（开阔水域 reef/slope，缺省）connectsTo 只向下＝一旦往深处走，走过的节点不再是选项（单向下潜·设计如此）。
 * UI 据此在层状 zone 给「只能往下、回不去」的预告，避免玩家在过了上浮口后才被「回不了头」打个措手不及。
 */
export function zoneAllowsBacktrack(zoneId: string): boolean {
  // maze（迷路图·双向连通）与 warren（蜂群巢·三卵室三角·有环）都能节点级回头；
  // 层状开阔水域（缺省·connectsTo 只向下）＝单向下潜。warren 是 2026-07-08 新增的 mapShape，
  // 此前漏纳这里 ⇒ 巢窟被当开阔水域（无声呐图 + NodeSelectView 误标单向）·本次补正。
  const shape = getZone(zoneId)?.mapShape;
  return shape === 'maze' || shape === 'warren';
}

export function getEventById(id: string): DiveEvent | undefined {
  return EVENT_DB.get(id);
}

/**
 * 收集一个事件**直接**产出的全部 loot 物品 id（onEnter + 各选项 outcome / check 成败分支）。
 * 固定资源耗尽（2026-06-25）：mapgen 据此判断某资源点是否产出已永久采尽的物品（save 级）。
 * 链式 triggerEventId 不递归（以「直产」为准·避免环 + 越界判定）；事件不存在 → 空集。纯函数。
 */
export function eventLootItemIds(eventId: string): Set<string> {
  const out = new Set<string>();
  const ev = EVENT_DB.get(eventId);
  if (!ev) return out;
  const collect = (o?: Outcome): void => {
    if (!o?.loot) return;
    for (const roll of o.loot) out.add(roll.itemId);
  };
  collect(ev.onEnter);
  for (const opt of ev.options) {
    collect(opt.outcome);
    if (opt.check) {
      collect(opt.check.onSuccess);
      collect(opt.check.onFailure);
    }
  }
  return out;
}

/** 在 zone 当前层选哪些 zoneTag 抽取事件 */
export function tagsForDepth(zone: ZoneDef, depth: number): ZoneTag[] {
  let active: ZoneTag[] = [];
  for (const segment of zone.zoneTagsByDepth) {
    if (depth >= segment.minDepth) active = segment.tags;
  }
  return active;
}

/** 给定 zone + depth + flags，从 EVENT_DB 中筛出可抽取池 */
export function buildEventPool(opts: {
  zone: ZoneDef;
  depth: number;
  profileFlags: Set<string>;
  triggeredEventIds: string[];
  excludeIds?: Set<string>;
  /**
   * 当前下潜的 POI 身份串（POI 固定资源耗尽·2026-06-25）：有 poiId 的事件只在此值匹配时进池；
   * 没设 poiId 的事件不受影响（存量事件零影响）。缺省（非 POI 下潜）→ 所有带 poiId 的事件一律不进池。
   */
  poiId?: string;
  /**
   * 当前下潜的 POI **稳定模板身份**（roaming 专属内容·2026-06-25）：roaming 实例 id（`poi.roam.<runs>.<tpl>`·
   * ＝传入的 poiId）每次出现都变，无法被静态写的事件 poiId 匹配；故 dive-start 另透传稳定的 templateId。
   * 事件 poiId 命中 poiId **或** poiTemplateId 即进池（roaming 内容按 templateId 钉·anchor 仍走 poiId 精确匹配）。
   * 缺省（anchor / 教学下潜）→ undefined ⇒ 不放宽（与旧行为逐字一致）。
   */
  poiTemplateId?: string;
  /**
   * 编辑器全量目录派生（剧情编辑器「真·POI 下潜」走查·2026-06-27·poiEvents.derivePoiDivePool）：
   * true ⇒ 跳过**运行态**门控（prereqFlags / forbiddenFlags / oncePerRun / oncePerSave），
   * 只留**路由**门控（weight>0 / excludeIds / poiId / depth / zoneTags）。让编辑器列出「按深度/zoneTag/poiId
   * 能路由到此 POI 的全部事件」（各事件门控由 UI 另行标注·不在此过滤）。缺省 false ⇒ 与游戏内逐字一致（零影响）。
   */
  ignoreProfileGates?: boolean;
}): DiveEvent[] {
  const tags = new Set(tagsForDepth(opts.zone, opts.depth));
  const triggered = new Set(opts.triggeredEventIds);
  const exclude = opts.excludeIds ?? new Set();
  const pool: DiveEvent[] = [];

  for (const ev of EVENT_DB.values()) {
    if (ev.weight <= 0) continue;
    if (exclude.has(ev.id)) continue;

    // POI 专属事件（POI 固定资源耗尽·2026-06-25 / roaming 内容·2026-06-25）：有 poiId 的事件只在下潜该 POI
    // 时进池——anchor 走 poiId 精确匹配；roaming 走稳定的 poiTemplateId（实例 poiId 每次变·配不上静态事件 poiId）。
    // 任一命中即放行；两者皆不命中则跳过。没设 poiId 的事件落到下面照旧按 zoneTags/depth/flags 过滤（存量零影响）。
    if (ev.poiId && ev.poiId !== opts.poiId && ev.poiId !== opts.poiTemplateId) continue;

    // 深度匹配
    if (opts.depth < ev.depthRange[0] || opts.depth > ev.depthRange[1]) continue;

    // zoneTag 匹配（至少一个交集；如果事件没设 zoneTags，跳过）
    if (!ev.zoneTags || ev.zoneTags.length === 0) continue;
    if (!ev.zoneTags.some((t) => tags.has(t))) continue;

    // 运行态门控（flag / once）：编辑器全量目录派生（ignoreProfileGates）跳过这一段——只看
    // 路由能否到达此 POI，门控留给 UI 标注。游戏内缺省 false ⇒ 逐字一致。
    if (!opts.ignoreProfileGates) {
      // 前置 flag
      if (ev.prereqFlags && !ev.prereqFlags.every((f) => opts.profileFlags.has(f))) continue;
      if (ev.forbiddenFlags && ev.forbiddenFlags.some((f) => opts.profileFlags.has(f))) continue;

      // oncePerRun / oncePerSave
      if (ev.oncePerRun && triggered.has(ev.id)) continue;
      if (ev.oncePerSave && opts.profileFlags.has(`event_seen:${ev.id}`)) continue;
    }

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
