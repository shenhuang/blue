#!/usr/bin/env node
// POI 固定资源「save 级别名」门（QUIRKS #163·2026-06-25 那条约定落成机制）。
//
// 背景（quirk #163·engine/mapgen.ts::applyHarvestDepletion + engine/port.ts + engine/zones.ts::eventLootItemIds）：
//   固定资源的**永久**耗尽粒度＝按 `(poiId, itemId)`，不是按节点。回港时 port.ts 把本 run 采到的
//   `harvestPersist:'save'` 件并进 `profile.harvestedResources[harvestKey]`（harvestKey = run.caveId ?? run.poiId）；
//   下次进同一 POI，mapgen 的 applyHarvestDepletion 把**所有「事件产出该 itemId」的节点**一并抹平
//   （eventYieldsExhausted 只看 itemId、不分是哪个事件）。
//   ⇒ **同一个 POI（同一 run.poiId 容器）里若有两条 save 级脉产同一个 itemId，采空其一 → 下次进图两条一起消失**
//   （引擎理解成「这个 POI 的此资源采尽了」）。要两条各自独立耗尽的永久脉，必须给它们**不同的 item id**。
//   run 级（run.harvestedNodes 按 nodeId）天然逐点独立·无此约束——所以本门只管 save 级。
//
// 「同一 POI 容器」里哪些事件会共享 run.poiId、在同一次下潜的图里共存（=本门要分组的单位）：
//   一个 POI（anchor 的 `id` / roaming 的 `templateId`）下潜时，run.poiId 落该 id；其图里的事件来自两条 lane——
//   ① 事件级 `poiId`（buildEventPool 按 poiId / poiTemplateId 精确匹配·engine/zones.ts·anchor 走 id、roaming 走 templateId）；
//   ② 该 POI 的「强制开场」字段引用的事件（dive-start.ts）：`story.eventId` / `story.revisitEventId` /
//      `revisitEventId` / `openEventId` / `storyOpenEvents[]`——这些事件也在该 POI 的 run.poiId 下跑。
//   两条 lane 命中的事件都记到这个 POI 容器；容器内任两条产同一个 save 物品 = 别名塌缩 = 红。
//
// 注意（有意 narrow·避免 spurious 红）：
//   - 没有 `poiId`、也不被任何 POI 强制开场引用的 zone/band 池事件（如 deep_cave.json 的结壳事件）**不进任何容器**——
//     它们下潜时 run.poiId 为空或是别的 POI，与某 anchor 的 save 脉永不共享 (poiId,itemId) 键，故即便产同名 save 物品也**不是**碰撞
//     （现状 item.gallery_crust 即此情形：flat_gallery 一条 poiId-bound 脉 + 两条无 poiId 的 deep_cave 脉·跨 zone/tag/depth·安全）。
//   - loot 收集与引擎同源 eventLootItemIds：只数事件**直产**（onEnter + 各 option outcome / check 成败分支），
//     不递归 triggerEventId（mapgen 的判定也以直产为准）。
//
// 派生「给某 POI 加第二条永久脉」＝换一个新的 save itemId（或拆到别的 POI/容器），绿即合规。
//
// 在 scripts/regress.mjs 注册为 check-poi-resources 任务（纯 node·与 check-event-poi / check-farm-pois 同类·沙箱也跑）。
//
// 跑法： node scripts/check-poi-resources.mjs

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

// ───────────────────────── 纯函数核心（可单测·data in / violations out·无 IO）─────────────────────────

/**
 * 一个事件**直接**产出的 loot itemId 集合（与 engine/zones.ts::eventLootItemIds 同口径：
 * onEnter + 各 option 的 outcome / check.onSuccess / check.onFailure·不递归 triggerEventId）。
 * @param {any} ev 事件对象
 * @returns {Set<string>}
 */
export function eventLootItemIds(ev) {
  const out = new Set();
  const collect = (o) => {
    if (!o || !Array.isArray(o.loot)) return;
    for (const roll of o.loot) if (roll && typeof roll.itemId === 'string') out.add(roll.itemId);
  };
  collect(ev?.onEnter);
  for (const opt of ev?.options ?? []) {
    collect(opt?.outcome);
    if (opt?.check) {
      collect(opt.check.onSuccess);
      collect(opt.check.onFailure);
    }
  }
  return out;
}

/**
 * 收集一个 POI（anchor/roamingTemplate）对象上「强制开场」字段引用的事件 id（dive-start.ts 那几条 lane）。
 * @param {any} poi
 * @returns {string[]}
 */
export function forcedOpenEventRefs(poi) {
  const refs = [];
  if (poi?.story && typeof poi.story.eventId === 'string') refs.push(poi.story.eventId);
  if (poi?.story && typeof poi.story.revisitEventId === 'string') refs.push(poi.story.revisitEventId);
  if (typeof poi?.revisitEventId === 'string') refs.push(poi.revisitEventId);
  if (typeof poi?.openEventId === 'string') refs.push(poi.openEventId);
  if (Array.isArray(poi?.storyOpenEvents)) for (const r of poi.storyOpenEvents) if (typeof r === 'string') refs.push(r);
  return refs;
}

/**
 * 纯检查：每个 POI 容器内，断言没有两条**不同的事件**产出同一个 save 级 itemId（quirk #163 的别名塌缩）。
 *
 * @param {{ items?: any[] }|any[]} itemsJson  items.json 内容（{items:[...]} 或裸数组）
 * @param {Array<{file:string, events:any[]}>} eventFiles  各事件文件（file 名 + 解析出的 events 数组）
 * @param {Record<string, any>} chartPoisJson  chart_pois.json 内容（顶层段·每段含 anchors/roamingTemplates）
 * @returns {{
 *   violations: Array<{poiId:string, itemId:string, eventIds:string[]}>,
 *   poiContainerCount:number, saveEventCount:number, saveItemIds:string[]
 * }}
 */
export function findSavePoiResourceCollisions(itemsJson, eventFiles, chartPoisJson) {
  // 1) save 级物品集
  const itemArr = Array.isArray(itemsJson) ? itemsJson : (itemsJson?.items ?? []);
  const saveItemIds = new Set(
    itemArr.filter((it) => it && it.harvestPersist === 'save' && typeof it.id === 'string').map((it) => it.id),
  );

  // 2) 索引所有事件 + 它直产的 save 物品（带来源文件·汇报用）
  /** @type {Map<string, {file:string, save:string[]}>} */
  const eventById = new Map();
  for (const { file, events } of eventFiles) {
    for (const ev of events ?? []) {
      if (typeof ev?.id !== 'string') continue;
      const save = [...eventLootItemIds(ev)].filter((x) => saveItemIds.has(x));
      eventById.set(ev.id, { file, save });
    }
  }

  // 3) 建 POI 容器：anchor 用 id、roaming 用 templateId。每个容器收两条 lane 命中的事件 id。
  const segs = Object.values(chartPoisJson ?? {}).filter(
    (seg) => seg && typeof seg === 'object' && !Array.isArray(seg),
  );
  const anchors = segs.flatMap((seg) => seg.anchors ?? []);
  const roamingTemplates = segs.flatMap((seg) => seg.roamingTemplates ?? []);

  /** poiId(容器键) -> Set<eventId>（去重·同事件多 lane 命中只算一次） */
  const containerEvents = new Map();
  const ensure = (key) => {
    if (!containerEvents.has(key)) containerEvents.set(key, new Set());
    return containerEvents.get(key);
  };

  // lane ②：POI 强制开场引用
  for (const p of [...anchors, ...roamingTemplates]) {
    const key = p?.id ?? p?.templateId;
    if (typeof key !== 'string') continue;
    const bucket = ensure(key);
    for (const ref of forcedOpenEventRefs(p)) bucket.add(ref);
  }

  // lane ①：事件级 poiId（anchor 走 id、roaming 走 templateId·两套合法键都在 containerEvents 的 key 集合里·
  // 但事件 poiId 也可能指向尚无强制开场字段的纯 anchor → 直接按事件 poiId 建/取容器）。
  for (const { events } of eventFiles) {
    for (const ev of events ?? []) {
      if (typeof ev?.poiId !== 'string') continue;
      ensure(ev.poiId).add(ev.id);
    }
  }

  // 4) 每个容器内：itemId -> 产出它的（不同）事件 id 列表；>1 即碰撞
  const violations = [];
  let saveEventCount = 0;
  for (const [poiId, eventIds] of containerEvents) {
    /** itemId -> Set<eventId> */
    const byItem = new Map();
    for (const eid of eventIds) {
      const rec = eventById.get(eid);
      if (!rec || rec.save.length === 0) continue;
      saveEventCount++;
      for (const itemId of rec.save) {
        if (!byItem.has(itemId)) byItem.set(itemId, new Set());
        byItem.get(itemId).add(eid);
      }
    }
    for (const [itemId, eids] of byItem) {
      if (eids.size > 1) {
        violations.push({ poiId, itemId, eventIds: [...eids].sort() });
      }
    }
  }
  violations.sort((a, b) => a.poiId.localeCompare(b.poiId) || a.itemId.localeCompare(b.itemId));

  return {
    violations,
    poiContainerCount: containerEvents.size,
    saveEventCount,
    saveItemIds: [...saveItemIds].sort(),
  };
}

// ───────────────────────────────── IO / CLI ─────────────────────────────────

// 仅作为脚本直接运行时才跑 IO（被 import 当库时不触发·便于单测）。
if (import.meta.url === `file://${process.argv[1]}`) {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const ROOT = resolve(__dirname, '..');
  const DATA = resolve(ROOT, 'src/data');
  const EVENTS_DIR = resolve(DATA, 'events');

  const readJson = (p) => JSON.parse(readFileSync(p, 'utf-8'));

  const itemsJson = readJson(join(DATA, 'items.json'));
  const chartPoisJson = readJson(join(DATA, 'chart_pois.json'));
  const eventFiles = readdirSync(EVENTS_DIR)
    .filter((n) => n.endsWith('.json'))
    .sort()
    .map((name) => {
      const parsed = readJson(join(EVENTS_DIR, name));
      const events = Array.isArray(parsed) ? parsed : (parsed.events ?? []);
      return { file: `src/data/events/${name}`, events };
    });

  const { violations, poiContainerCount, saveEventCount, saveItemIds } = findSavePoiResourceCollisions(
    itemsJson,
    eventFiles,
    chartPoisJson,
  );

  if (violations.length) {
    console.error('✘ POI 固定资源 save 级别名门被破坏（quirk #163）\n');
    for (const v of violations) {
      console.error(
        `  POI「${v.poiId}」里有 ${v.eventIds.length} 条事件都产同一个 save 物品「${v.itemId}」：\n` +
          `      ${v.eventIds.join(' , ')}\n` +
          `      ⇒ 采空其一·下次进图它们会一并消失（引擎按 (poiId,itemId) 记账·别名塌缩）。`,
      );
    }
    console.error(
      `\n共 ${violations.length} 处。同一 POI 内每条独立的 save 级永久脉必须有**不同的 itemId**` +
        `（或拆到不同 POI/容器）；run 级资源无此约束。`,
    );
    process.exit(1);
  }

  console.log(
    `✓ POI 固定资源 save 级别名门（quirk #163）：${saveItemIds.length} 个 save 物品 · ` +
      `扫 ${poiContainerCount} 个 POI 容器 / ${saveEventCount} 条容器内 save 脉 · ` +
      `无任一 POI 内两条脉共享同一 itemId（别名塌缩）。`,
  );
  process.exit(0);
}
