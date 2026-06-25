#!/usr/bin/env node
// 「故事重访变体」强制开场机制门（types/chart.ts ChartPoi.storyOpenEvents·dive-start.ts·quirk #174）——
// 把「重访剧情节拍必现」的约定变成会在 `npm run regress` 里失败的检查（仿 check-farm-pois / check-event-poi）。
// 纯读 JSON·无 TS 依赖。任一不过 → exit 1。
//
// 背景：storyOpenEvents 让一个 POI 入潜按顺序强制开场第一个「门控通过且未见过」的故事事件
// （dive-start.ts·按事件自身 prereq/forbidden/oncePerSave 选变体）。这些事件**必须 weight 0**——
// 否则同时落进 buildEventPool 随机池，会被内容库（reef.*/wreck_graveyard.*）淹没＝命中率个位数%
// ＝玩家回来看不到重访内容（captain_revisit 原 weight 10 即此 bug）。引用 typo 则静默 no-op＝软锁。
//
// 四条门（仅针对带 storyOpenEvents 的 POI）：
//   (a) 只能挂 persistent anchor（roaming 运行时 POI 逐字段构造·不透传此字段·会被静默丢弃）。
//   (b) 引用可解析——每个 id 都在 src/data/events/*.json 注册（防 typo 静默成「永不触发」＝软锁）。
//   (c) 被引用事件 weight === 0（只经强制开场·不进随机池·防再被淹没）。
//   (d) 与 openEventId / openEventPool 互斥（单一强制开场源·dive-start 让 storyOpenEvents 与 openEventPool 互不进入）。

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const DATA = join(ROOT, 'src', 'data');
const EVENTS_DIR = join(DATA, 'events');

const errors = [];
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

// —— chart_pois：anchors（可挂）vs roamingTemplates（不可挂·会丢字段）——
const chartPois = readJson(join(DATA, 'chart_pois.json'));
const segs = Object.values(chartPois).filter(
  (seg) => seg && typeof seg === 'object' && !Array.isArray(seg),
);
const anchors = segs.flatMap((seg) => seg.anchors ?? []);
const roamingTemplates = segs.flatMap((seg) => seg.roamingTemplates ?? []);

// —— 全部事件 id → weight ——
const eventById = new Map();
for (const f of readdirSync(EVENTS_DIR).filter((n) => n.endsWith('.json'))) {
  let data;
  try {
    data = readJson(join(EVENTS_DIR, f));
  } catch (e) {
    errors.push(`[json] events/${f} 解析失败：${e.message}`);
    continue;
  }
  for (const e of data.events ?? []) {
    if (typeof e.id === 'string') eventById.set(e.id, { file: `events/${f}`, weight: e.weight });
  }
}

// —— (a) 挂 roaming = 错 ——
for (const t of roamingTemplates) {
  if (t.storyOpenEvents !== undefined) {
    errors.push(
      `[anchor-only] roamingTemplate ${t.templateId ?? '(无 id)'} 带 storyOpenEvents——只能挂在 persistent anchor 上` +
        `（roaming 运行时 POI 逐字段构造·不透传此字段·会被静默丢弃）`,
    );
  }
}

let poiCount = 0;
for (const p of anchors) {
  if (p.storyOpenEvents === undefined) continue;
  poiCount++;
  const pid = p.id ?? '(无 id)';

  if (!Array.isArray(p.storyOpenEvents) || p.storyOpenEvents.length === 0) {
    errors.push(`[shape] POI ${pid} 的 storyOpenEvents 必须是非空数组`);
    continue;
  }
  if (p.persistent !== true) {
    errors.push(`[anchor-only] POI ${pid} 带 storyOpenEvents 但非 persistent anchor`);
  }
  // (d) 与其它强制开场源互斥
  if (p.openEventId !== undefined) errors.push(`[exclusive] POI ${pid} 同时设 storyOpenEvents 与 openEventId（单一强制开场源）`);
  if (p.openEventPool !== undefined) errors.push(`[exclusive] POI ${pid} 同时设 storyOpenEvents 与 openEventPool（单一强制开场源）`);

  for (const id of p.storyOpenEvents) {
    const ev = eventById.get(id);
    // (b) 引用可解析
    if (!ev) {
      errors.push(`[ref] POI ${pid} 的 storyOpenEvents 引用了不存在的事件 "${id}"（typo＝永不触发＝软锁）`);
      continue;
    }
    // (c) weight 0
    if (ev.weight !== 0) {
      errors.push(`[weight] POI ${pid} 的故事开场事件 "${id}" weight=${ev.weight}（必须 0·否则同时落随机池被淹没·见 ${ev.file}）`);
    }
  }
}

if (errors.length) {
  console.error(`✗ check-story-open-events：${errors.length} 个问题`);
  for (const e of errors) console.error('  - ' + e);
  process.exit(1);
}
console.log(`✓ check-story-open-events：${poiCount} 个带 storyOpenEvents 的 POI 全部合规`);
