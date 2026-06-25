// Zone 注册表 + 事件池加载
// 所有事件 JSON 在此被合并成一个全局 EVENT_DB；mapgen 从中按 tag/depth 抽取

import type { DiveEvent, Outcome, ZoneDef, ZoneTag } from '@/types';
import tutorialEvents from '@/data/events/tutorial.json';
import reefEvents from '@/data/events/reef.json';
import blueCavesEvents from '@/data/events/blue_caves.json';
import wreckGraveyardEvents from '@/data/events/wreck_graveyard.json';
import lighthouseEvents from '@/data/events/lighthouse.json';
import trenchEvents from '@/data/events/trench.json';
import mimicEvents from '@/data/events/mimic.json';
import ch1Events from '@/data/events/ch1.json';
import midwaterEvents from '@/data/events/midwater.json';
import ventEvents from '@/data/events/vent.json';
import wreckFieldPatrolEvents from '@/data/events/wreck_field_patrol.json';
import whalefallEvents from '@/data/events/whalefall.json';
import corpseWearerForeshadowEvents from '@/data/events/corpse_wearer_foreshadow.json';
import shaftCrackEvents from '@/data/events/shaft_crack.json';
import chamberNetworkEvents from '@/data/events/chamber_network.json';
import floodedGalleryEvents from '@/data/events/flooded_gallery.json';
import tideEvents from '@/data/events/tide.json';
import grottoEvents from '@/data/events/grotto.json';
import deepCaveEvents from '@/data/events/deep_cave.json';
import chasmEvents from '@/data/events/chasm.json';
import zonesData from '@/data/zones.json';

export const ZONES: Map<string, ZoneDef> = new Map();
for (const z of (zonesData as { zones: ZoneDef[] }).zones) {
  ZONES.set(z.id, z);
}

export const EVENT_DB: Map<string, DiveEvent> = new Map();
for (const e of (tutorialEvents.events as DiveEvent[])) EVENT_DB.set(e.id, e);
for (const e of (reefEvents.events as DiveEvent[])) EVENT_DB.set(e.id, e);
for (const e of (blueCavesEvents.events as DiveEvent[])) EVENT_DB.set(e.id, e);
for (const e of (wreckGraveyardEvents.events as DiveEvent[])) EVENT_DB.set(e.id, e);
for (const e of (lighthouseEvents.events as DiveEvent[])) EVENT_DB.set(e.id, e);
for (const e of (trenchEvents.events as DiveEvent[])) EVENT_DB.set(e.id, e);
for (const e of (mimicEvents.events as DiveEvent[])) EVENT_DB.set(e.id, e);
for (const e of (ch1Events.events as DiveEvent[])) EVENT_DB.set(e.id, e);
for (const e of (midwaterEvents.events as DiveEvent[])) EVENT_DB.set(e.id, e);
for (const e of (ventEvents.events as DiveEvent[])) EVENT_DB.set(e.id, e);
for (const e of (wreckFieldPatrolEvents.events as DiveEvent[])) EVENT_DB.set(e.id, e); // 敌人库 enemyRef 线上用例（SPEC §4）
for (const e of (whalefallEvents.events as DiveEvent[])) EVENT_DB.set(e.id, e); // 鲸落支线（#137·目击链 / 找寻 / 三相生态）
for (const e of (corpseWearerForeshadowEvents.events as DiveEvent[])) EVENT_DB.set(e.id, e); // 尸衣者 Ch1 浅水伏笔（flag.has_died_before 门控·不触发战斗）
for (const e of (shaftCrackEvents.events as DiveEvent[])) EVENT_DB.set(e.id, e); // 竖穴裂缝（洞型谱·crack tag·k<0.8 井+廊）
for (const e of (chamberNetworkEvents.events as DiveEvent[])) EVENT_DB.set(e.id, e); // 蜂房洞（洞型谱·chamber tag·连通蜂房）
for (const e of (floodedGalleryEvents.events as DiveEvent[])) EVENT_DB.set(e.id, e); // 漫水回廊（洞型谱·flooded tag·k>1.45 长平廊+深坑）
for (const e of (tideEvents.events as DiveEvent[])) EVENT_DB.set(e.id, e); // 浅潮洞（洞穴扩充·tide tag·潮汐主导·8–44m）
for (const e of (grottoEvents.events as DiveEvent[])) EVENT_DB.set(e.id, e); // 石窟厅（洞穴扩充·grotto tag·矿物柱+骨床+声学·20–82m）
for (const e of (deepCaveEvents.events as DiveEvent[])) EVENT_DB.set(e.id, e); // 深穴（洞穴扩充·deep_cave tag·黑暗+静水+地质·35–124m）
for (const e of (chasmEvents.events as DiveEvent[])) EVENT_DB.set(e.id, e); // 深裂隙（洞穴扩充·chasm tag·氮醉边界+设备极限·90–148m）

export function getZone(id: string): ZoneDef | undefined {
  return ZONES.get(id);
}

/**
 * 这个 zone 的下潜图能否「回头」（节点级 backtrack）。
 * 迷路图（mapShape='maze'，如蓝洞群 + 借它的 trench 柱 band）双向连通＝能原路返回；
 * 层状图（开阔水域 reef/wreck，缺省）connectsTo 只向下＝一旦往深处走，走过的节点不再是选项（单向下潜·设计如此）。
 * UI 据此在层状 zone 给「只能往下、回不去」的预告，避免玩家在过了上浮口后才被「回不了头」打个措手不及。
 */
export function zoneAllowsBacktrack(zoneId: string): boolean {
  return getZone(zoneId)?.mapShape === 'maze';
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

/** 给定 zone + depth + sanity + flags，从 EVENT_DB 中筛出可抽取池 */
export function buildEventPool(opts: {
  zone: ZoneDef;
  depth: number;
  sanity: number;
  profileFlags: Set<string>;
  triggeredEventIds: string[];
  excludeIds?: Set<string>;
  /** band 专属 tag 池（深水区内容期）：覆盖 zoneTagsByDepth，让 trench 用 twilight/midnight 专属事件。缺省→回退按深度算。 */
  tagsOverride?: ZoneTag[];
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
}): DiveEvent[] {
  const tags = new Set(opts.tagsOverride ?? tagsForDepth(opts.zone, opts.depth));
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
