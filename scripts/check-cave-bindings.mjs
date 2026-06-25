// 持久多口洞 绑定门（多口持久洞 SPEC §7·纯 node·把「绑定/可扩展」约定做成会红的 regress 门）。
// 静态可查的部分（JSON 层）：
//   ① caves.json 每个洞参数 sane：caveId 唯一 + cave.* 命名 + depthRange[lo<hi] + sizeScale≥1 + entrancePortals≥1 + exitPortals≥1（从不死胡同·§1）。
//   ② chart_pois.json 每条 caveEntry：caveId 必命中 caves.json（悬空绑定=红·同 check-dive-refs 焊悬空 band）；regionBias∈{rim,flank,deep}；mouthDepth 落 depthRange 内（warn）。
// 注：entryNodeId→真实入口门户 的校验依赖生成（节点是跑出来的）→ 留给 scripts/playthrough-cave.ts（tsx·能跑生成器）；
//     resolveCaveEntryNode 运行时也对非法 entryNodeId 回退 startNodeId 防白屏。
// 跑法： node scripts/check-cave-bindings.mjs

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const DATA = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'data');
const readJson = (p) => JSON.parse(readFileSync(join(DATA, p), 'utf8'));

const errors = [];
const warns = [];
const err = (m) => errors.push(m);
const warn = (m) => warns.push(m);

// ── ① caves.json 洞参数 ──
const caves = readJson('caves.json').caves ?? [];
const caveIds = new Set();
for (const c of caves) {
  if (!c.caveId) { err(`cave 缺 caveId：${JSON.stringify(c)}`); continue; }
  if (caveIds.has(c.caveId)) err(`caveId 重复：${c.caveId}`);
  caveIds.add(c.caveId);
  if (!/^cave\./.test(c.caveId)) warn(`caveId 不在 cave.* 命名空间：${c.caveId}`);
  if (!c.zoneId) err(`${c.caveId}：缺 zoneId`);
  if (!Array.isArray(c.depthRange) || c.depthRange.length !== 2 || !(c.depthRange[0] < c.depthRange[1]))
    err(`${c.caveId}：depthRange 应为 [lo<hi]，实=${JSON.stringify(c.depthRange)}`);
  if (!(c.sizeScale >= 1)) err(`${c.caveId}：sizeScale 应 ≥1，实=${c.sizeScale}`);
  if (!(c.entrancePortals >= 1)) err(`${c.caveId}：entrancePortals 应 ≥1，实=${c.entrancePortals}`);
  if (!(c.exitPortals >= 1)) err(`${c.caveId}：exitPortals 应 ≥1（从不死胡同·§1），实=${c.exitPortals}`);
}

// ── ② chart_pois.json 的 caveEntry 绑定 ──
const chart = readJson('chart_pois.json');
const REGIONS = new Set(['rim', 'flank', 'deep']);
const pois = [];
for (const [k, seg] of Object.entries(chart)) {
  if (typeof seg !== 'object' || seg == null) continue; // 跳过 _doc 等
  for (const p of seg.anchors ?? []) pois.push(p);
  for (const p of seg.roamingTemplates ?? []) pois.push(p);
}
let caveEntryCount = 0;
for (const p of pois) {
  const ce = p.caveEntry;
  if (!ce) continue;
  caveEntryCount++;
  if (!ce.caveId || !caveIds.has(ce.caveId)) err(`POI ${p.id}：caveEntry.caveId 悬空（${ce.caveId} 不在 caves.json）`);
  if (ce.regionBias && !REGIONS.has(ce.regionBias)) err(`POI ${p.id}：regionBias 非法（${ce.regionBias}）`);
  if (ce.mouthDepth != null && ce.caveId && caveIds.has(ce.caveId)) {
    const cave = caves.find((c) => c.caveId === ce.caveId);
    if (cave && (ce.mouthDepth < cave.depthRange[0] || ce.mouthDepth > cave.depthRange[1]))
      warn(`POI ${p.id}：mouthDepth ${ce.mouthDepth} 在洞 depthRange [${cave.depthRange}] 之外`);
  }
}

// ── 输出 ──
for (const w of warns) console.warn('⚠ ' + w);
if (errors.length) {
  for (const e of errors) console.error('✗ ' + e);
  console.error(`\n✗ 持久洞绑定门失败（${errors.length} 错）`);
  process.exit(1);
}
console.log(`✓ 持久洞绑定门通过（${caves.length} 洞·${caveEntryCount} 条 caveEntry 绑定·${warns.length} 警告）`);
