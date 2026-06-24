#!/usr/bin/env node
// POI 专属事件门（POI 固定资源耗尽 SPEC·2026-06-25）。
//
// DiveEvent.poiId 设了 ⇒ 该事件只在下潜对应 POI 时进 buildEventPool（engine/zones.ts）。
// 拼错 poiId（指向不存在的 POI）＝静默失效：事件永不进任何池、也无报错 ⇒ 内容白写。
// 本 lint 把它焊成 regress 门：扫所有事件的 poiId，确认命中 chart_pois.json 里某个真实 POI id，否则红。
//
// 注（先只做 anchor）：roaming 实例是运行时构造的 id（poi.<template>.<seed>），事件 poiId 当前只用于
// anchor 匹配（运行时 poiId === anchor id）；本检查只要求 poiId 存在于 chart_pois.json 的 authored id
// 集合（anchors + roamingTemplates 的 id），不做 roaming 实例匹配。
//
// 在 scripts/regress.mjs 注册为 check-event-poi 任务（纯 node·与 check-event-dc 同类）。
//
// 跑法： node scripts/check-event-poi.mjs

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const EVENTS_DIR = resolve(ROOT, 'src/data/events');
const POIS_FILE = resolve(ROOT, 'src/data/chart_pois.json');

/** 递归收集 JSON 里所有 key==='id' 的字符串值（POI 对象 = anchors + roamingTemplates 的 id）。 */
function collectIds(node, out) {
  if (Array.isArray(node)) {
    for (const x of node) collectIds(x, out);
  } else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (k === 'id' && typeof v === 'string') out.add(v);
      else collectIds(v, out);
    }
  }
}

const validPoiIds = new Set();
collectIds(JSON.parse(readFileSync(POIS_FILE, 'utf-8')), validPoiIds);

const violations = [];
let scanned = 0;
let withPoi = 0;

for (const name of readdirSync(EVENTS_DIR).filter((n) => n.endsWith('.json')).sort()) {
  const file = join('src/data/events', name);
  const parsed = JSON.parse(readFileSync(resolve(ROOT, file), 'utf-8'));
  const events = Array.isArray(parsed) ? parsed : (parsed.events ?? []);
  for (const ev of events) {
    scanned++;
    if (ev.poiId === undefined) continue;
    withPoi++;
    const where = `${file} → ${ev.id}`;
    if (typeof ev.poiId !== 'string' || ev.poiId.length === 0) {
      violations.push(`${where}\n      poiId 必须是非空字符串（得到 ${JSON.stringify(ev.poiId)}）`);
    } else if (!validPoiIds.has(ev.poiId)) {
      violations.push(`${where}\n      poiId「${ev.poiId}」在 chart_pois.json 里不存在——拼错＝事件永不进池（软锁）`);
    }
  }
}

if (violations.length) {
  console.error('✘ POI 专属事件门被破坏\n');
  for (const v of violations) console.error(`  ${v}`);
  console.error(
    `\n共 ${violations.length} 处。事件 poiId 必须命中 chart_pois.json 的某个 POI id` +
      `（anchors / roamingTemplates）；否则 buildEventPool 永远筛不到它＝内容白写。`,
  );
  process.exit(1);
}

console.log(
  `✓ POI 专属事件门：扫 ${scanned} 事件，其中 ${withPoi} 个带 poiId，` +
    `全部命中 chart_pois.json（${validPoiIds.size} 个 authored POI id）。`,
);
process.exit(0);
