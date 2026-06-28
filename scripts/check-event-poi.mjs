#!/usr/bin/env node
// POI 专属事件门（POI 固定资源耗尽 SPEC·2026-06-25）。
//
// DiveEvent.poiId 设了 ⇒ 该事件只在下潜对应 POI 时进 buildEventPool（engine/zones.ts）。
// 拼错 poiId（指向不存在的 POI）＝静默失效：事件永不进任何池、也无报错 ⇒ 内容白写。
// 本 lint 把它焊成 regress 门：扫所有事件的 poiId，确认命中 chart_pois.json 里某个真实 POI id，否则红。
//
// 匹配两条 lane（roaming 专属内容·2026-06-25 起）：
//   ① anchor：运行时 poiId === anchor 的 `id`（写死·稳定）——事件 poiId 命中 anchor id。
//   ② roaming：运行时实例 id 形如 `poi.roam.<runsCompleted>.<templateId>` 每次出现都变，故 roaming 专属事件
//      的 poiId 钉**模板身份** `templateId`（buildEventPool 透传 opts.poiTemplateId 匹配·见 engine/zones.ts）。
// 因此本 lint 把合法 poiId 集合 = chart_pois.json 里所有 `id`（anchors）**与** `templateId`（roamingTemplates）
// 的并集；事件 poiId 命中其一即合法，否则红（拼错任一＝事件永不进池＝内容白写·静默软锁，仍被挡）。
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
const COLUMNS_FILE = resolve(ROOT, 'src/data/depth_columns.json');

/**
 * 递归收集 JSON 里所有合法 POI 身份串：
 *   - key==='id'（anchor 的运行时稳定 id），与
 *   - key==='templateId'（roaming 模板身份·roaming 专属事件按它钉·见脚本头注）。
 * 两类都收进 out（事件 poiId 命中其一即合法）。注意 key 命中后仍递归其值无害（字符串不再下钻）。
 */
function collectIds(node, out) {
  if (Array.isArray(node)) {
    for (const x of node) collectIds(x, out);
  } else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if ((k === 'id' || k === 'templateId') && typeof v === 'string') out.add(v);
      else collectIds(v, out);
    }
  }
}

const validPoiIds = new Set();
collectIds(JSON.parse(readFileSync(POIS_FILE, 'utf-8')), validPoiIds);

// ③ 深度柱**派生** POI（engine/columns.ts·非 chart_pois 手写·主线柱迁移 + #131）：刷怪档 poi.dive.<短名>.t<tier>
//    与主线 beat poi.dive.<短名>.story。这些是 buildColumnPois 在运行时注入海图的稳定 id——POI 专属事件
//    （如 reef.coral_grove_cutting 钉主线 beat 潜点）合法地以它们为 poiId（buildEventPool 走 run.poiId 精确匹配）。
{
  const short = (id) => String(id).replace(/^col\./, '');
  const columnsFile = JSON.parse(readFileSync(COLUMNS_FILE, 'utf-8'));
  for (const c of columnsFile.columns ?? []) {
    for (const t of c.tiers ?? []) validPoiIds.add(`poi.dive.${short(c.id)}.t${t.tier}`);
    if (c.storyTier) validPoiIds.add(`poi.dive.${short(c.id)}.story`);
  }
}

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
    `全部命中 chart_pois.json（${validPoiIds.size} 个 authored 身份串＝anchor id + roaming templateId）。`,
);
process.exit(0);
