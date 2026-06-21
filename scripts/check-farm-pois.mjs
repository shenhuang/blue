#!/usr/bin/env node
// 「材料刷点」范式机制门（P1-2·types/chart.ts ChartPoi.openEventPool）——把「刷点 POI 必须可刷且
// 别反复同一段剧情」的约定变成会在 `npm run regress` 里失败的检查（仿 check-dive-refs / check-enemy-refs）。
// 纯读 JSON·无 TS 依赖。任一不过 → exit 1。
//
// 背景：openEventPool 让一个 POI 成为「专门刷点」——入潜从池里轮替取一个开场事件（dive-start.ts·
// rotation by runsCompleted）。作者要求「能刷，但别反复同一段剧情」⇒ 池至少 3 个不同 beat。
// 这些不变量不焊死，回流就会悄悄退化（池缩到 1 段 / 引用 typo 静默 no-op / 挂错 roaming 被丢字段）。
//
// 五条门（仅针对带 openEventPool 的 POI）：
//   (a) 挂在 anchor 上    —— openEventPool 只能在 persistent anchor 上；roaming 运行时 POI 逐字段构造、
//                            不透传 openEventPool（chart.ts generateChart）⇒ 挂 roaming 会被静默丢弃。
//   (b) ≥3 个不同 beat   —— FARM_MIN_BEATS=3（"别反复同一段"的下限）+ 池内无重复 id。
//   (c) 引用可解析        —— 池里每个 eventId 都在 src/data/events/*.json 注册（防 typo 静默成「永不触发」）。
//   (d) 与 openEventId 互斥 —— 单一强制开场源（同时设两者＝语义打架·dive-start 已让 openEventId 优先）。
//   (e) beat 专属          —— 池内 beat 事件 zoneTags 必须空（否则漏进普通下潜池＝刷点剧情在别处乱跳）。
//
// 派生「每区再加一个刷点」＝新增带 openEventPool 的 anchor + 一组 zoneTags 空的专属 beat 事件，绿即合规。

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const DATA = join(ROOT, 'src', 'data');
const EVENTS_DIR = join(DATA, 'events');

const FARM_MIN_BEATS = 3;

const errors = [];
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

// —— 收 chart_pois：分清 anchors（可挂）vs roamingTemplates（不可挂·会丢字段）——
const chartPois = readJson(join(DATA, 'chart_pois.json'));
const segs = Object.values(chartPois).filter(
  (seg) => seg && typeof seg === 'object' && !Array.isArray(seg),
);
const anchors = segs.flatMap((seg) => seg.anchors ?? []);
const roamingTemplates = segs.flatMap((seg) => seg.roamingTemplates ?? []);

// —— 收全部事件 id + zoneTags（直接扫 JSON·与运行时 EVENT_DB 同源）——
/** @type {Map<string, {file:string, zoneTags:string[]}>} */
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
    if (typeof e.id === 'string') {
      eventById.set(e.id, { file: `events/${f}`, zoneTags: Array.isArray(e.zoneTags) ? e.zoneTags : [] });
    }
  }
}

let farmCount = 0;
let beatCount = 0;

// —— (a) 挂 roaming = 错（字段会被 generateChart 静默丢）——
for (const t of roamingTemplates) {
  if (t.openEventPool !== undefined) {
    errors.push(
      `[anchor-only] roamingTemplate ${t.templateId ?? '(无 id)'} 带 openEventPool——只能挂在 anchor 上` +
        `（roaming 运行时 POI 逐字段构造·不透传此字段·会被静默丢弃）`,
    );
  }
}

// —— (b)-(e) 针对每个带 openEventPool 的 anchor ——
for (const p of anchors) {
  if (p.openEventPool === undefined) continue;
  farmCount++;
  const pid = p.id ?? '(无 id)';

  // (a') 形状
  if (!Array.isArray(p.openEventPool)) {
    errors.push(`[shape] 刷点 ${pid}：openEventPool 必须是字符串数组`);
    continue;
  }
  const pool = p.openEventPool;

  // (b) ≥3 + 无重复
  if (pool.length < FARM_MIN_BEATS) {
    errors.push(
      `[min-beats] 刷点 ${pid}：openEventPool 只有 ${pool.length} 个 beat（需 ≥${FARM_MIN_BEATS}·"别反复同一段剧情"）`,
    );
  }
  const seen = new Set();
  for (const id of pool) {
    if (typeof id !== 'string') {
      errors.push(`[shape] 刷点 ${pid}：openEventPool 含非字符串项`);
      continue;
    }
    if (seen.has(id)) errors.push(`[dup] 刷点 ${pid}：openEventPool 重复 beat ${id}（轮替会卡在同一段）`);
    seen.add(id);
    beatCount++;

    // (c) 引用可解析
    const ev = eventById.get(id);
    if (!ev) {
      errors.push(`[ref] 刷点 ${pid}：openEventPool 的 ${id} 不在 src/data/events/*.json（typo? ⇒ 入潜永远触发不到）`);
      continue;
    }
    // (e) beat 专属（zoneTags 空·不漏进普通下潜池）
    if (ev.zoneTags.length > 0) {
      errors.push(
        `[exclusive] 刷点 ${pid}：beat ${id}（${ev.file}）带 zoneTags ${JSON.stringify(ev.zoneTags)}` +
          `——刷点 beat 必须 zoneTags 空（否则漏进普通下潜池·刷点剧情会在别处乱跳）`,
      );
    }
  }

  // (d) 与 openEventId 互斥
  if (p.openEventId !== undefined) {
    errors.push(`[exclusive-open] 刷点 ${pid}：同时设了 openEventId 与 openEventPool（单一强制开场源·二选一）`);
  }
}

// —— 汇报 ——
if (errors.length) {
  console.error(`✗ check-farm-pois：${errors.length} 处问题`);
  for (const e of errors) console.error('  - ' + e);
  process.exit(1);
}
console.log(
  `✓ check-farm-pois：${farmCount} 个材料刷点 / ${beatCount} 个 beat · 挂 anchor · ≥${FARM_MIN_BEATS} 不同 beat · 引用可解析 · beat 专属 · 与 openEventId 互斥`,
);
