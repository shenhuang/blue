#!/usr/bin/env node
// 深入潜点（灯塔/蛙跳重构 step ②③④·#125）的机制门——把「探深设施 ↔ 深入 POI」的约定变成
// 会在 `npm run regress` 里失败的检查（仿 check-enemy-refs）。纯读 JSON·无 TS 依赖。任一不过 → exit 1。
//
// 四条门：
//   (a) bandId 完整   —— 每个带 bandId 的 ChartPoi 引用的 band 都在 depth_bands.json 注册（悬空即红）。
//   (b) 探深→POI 完整 —— 每个深入 POI（带 bandId）的 flag.probe.* requiresFlags 都有产出它的设施 setsFlag。
//   (c) 无孤儿探深    —— 每个设施 setsFlag（flag.probe.*）都被某个深入 POI 的 requiresFlags 消费（否则建了白建）。
//   (d) onlyLighthouse 完整 —— 每条 onlyLighthouse 设施轨指向的灯塔 id 真实存在（home / 前哨 / 废墟 result.id）。

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const DATA = join(ROOT, 'src', 'data');

const HOME_LIGHTHOUSE_ID = 'lighthouse.home';
const PROBE_PREFIX = 'flag.probe.';

const errors = [];
const readJson = (p) => JSON.parse(readFileSync(join(DATA, p), 'utf8'));

const chartPois = readJson('chart_pois.json');
const bandsFile = readJson('depth_bands.json');
const lhFile = readJson('lighthouse_upgrades.json');

// —— band id 集 ——
const bandIds = new Set((bandsFile.bands ?? []).map((b) => b.id));

// —— 全部 POI（anchors + roamingTemplates）——
const allPois = [...(chartPois.anchors ?? []), ...(chartPois.roamingTemplates ?? [])];
const deepPois = allPois.filter((p) => typeof p.bandId === 'string');

// —— 设施 setsFlag（探深产出）+ onlyLighthouse 引用 ——
const setsFlags = []; // {flag, upgradeId}
const onlyLighthouseRefs = []; // {id, trackId}
for (const track of lhFile.tracks ?? []) {
  if (typeof track.onlyLighthouse === 'string') {
    onlyLighthouseRefs.push({ id: track.onlyLighthouse, trackId: track.id });
  }
  for (const u of track.upgrades ?? []) {
    if (typeof u.setsFlag === 'string') setsFlags.push({ flag: u.setsFlag, upgradeId: u.id });
  }
}

// —— 合法灯塔 id：home + 前哨 result.id + 废墟 result.id ——
const lighthouseIds = new Set([HOME_LIGHTHOUSE_ID]);
for (const o of lhFile.outposts ?? []) if (o.result?.id) lighthouseIds.add(o.result.id);
for (const r of lhFile.ruins ?? []) if (r.result?.id) lighthouseIds.add(r.result.id);

// —— (a) bandId 完整 ——
for (const p of deepPois) {
  if (!bandIds.has(p.bandId)) {
    errors.push(`[band] 深入 POI ${p.id ?? p.templateId}：bandId ${p.bandId} 不在 depth_bands.json`);
  }
}

// —— (b) 探深→POI 完整：深入 POI 的 flag.probe.* 门必有产出 setsFlag ——
const producedFlags = new Set(setsFlags.map((s) => s.flag));
for (const p of deepPois) {
  for (const f of p.requiresFlags ?? []) {
    if (f.startsWith(PROBE_PREFIX) && !producedFlags.has(f)) {
      errors.push(`[gate] 深入 POI ${p.id ?? p.templateId}：requiresFlags ${f} 无产出它的设施 setsFlag（POI 永不浮现）`);
    }
  }
}

// —— (c) 无孤儿探深：每个 setsFlag 都被某深入 POI 消费 ——
const consumedFlags = new Set();
for (const p of allPois) for (const f of p.requiresFlags ?? []) consumedFlags.add(f);
for (const { flag, upgradeId } of setsFlags) {
  if (!consumedFlags.has(flag)) {
    errors.push(`[orphan] 设施 ${upgradeId} 的 setsFlag ${flag} 无任何 POI requiresFlags 消费（建了白建）`);
  }
}

// —— (d) onlyLighthouse 完整 ——
for (const { id, trackId } of onlyLighthouseRefs) {
  if (!lighthouseIds.has(id)) {
    errors.push(`[onlyLighthouse] 设施轨 ${trackId}：onlyLighthouse ${id} 不是合法灯塔 id（home / 前哨 / 废墟 result.id）`);
  }
}

// —— 汇报 ——
if (errors.length) {
  console.error(`✗ check-dive-refs：${errors.length} 处问题`);
  for (const e of errors) console.error('  - ' + e);
  process.exit(1);
}
console.log(
  `✓ check-dive-refs：${deepPois.length} 深入 POI / ${setsFlags.length} 探深设施 · bandId 完整 · 探深↔POI 配对 · 无孤儿 · onlyLighthouse 合法`,
);
