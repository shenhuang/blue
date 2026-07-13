#!/usr/bin/env node
// 大区归属门（地图调试工具分大区分组的配套机制·2026-07-12）。
//
// 背景：`MapDevPanel.tsx` 左侧现在按 `ZoneDef.regionId` 分组（取代旧 mapShape 洞穴/开阔水域 tab——
// 全部 zone 早已是 maze/warren，那两个 tab 已名存实亡）。regionId 的合法取值单一来源是
// `data/chart_regions.json`（5 个 owner-anchored 大区：reef/wreck/midwater/vent/trench），
// 类型层再收口一次（types/dive.ts::ChartRegionId）。zones.json 是手填的裸字符串，容易手滑打错
// （比如敲成 'midwarter' 或抄错大区名）——错字不会让 TS 报错（JSON 字面量），只会让调试工具悄悄把
// 该 zone 分进一个不存在的桶（既不在 5 个大区 tab 也不在"未分区"兜底），需要一道纯数据校验焊死。
//
// 不变量：zones.json 里每条 `regionId`（若填了）必须 ∈ chart_regions.json 声明的大区 id 集合。
// 不填 regionId 是合法状态（深渊无锚点 zone / 开发测试 zone 故意留白，落调试工具"未分区"桶）——
// 本门只抓"填了但拼错/引用了不存在的大区"这一种坏数据，不强制每个 zone 都必须分区。
//
// 跑法：node scripts/check-zone-region.mjs  或在 npm run regress 里作 check-zone-region 任务。
// 退出码：全过=0，任一 zone 的 regionId 不在合法集合内=1。纯 node·无依赖·进程隔离友好。

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

/**
 * 纯逻辑：从 chart_regions.json 内容里收集全部声明过的大区 id（跨 mapId 段合并，忽略 `_doc` 等说明字段）。
 * @param {any} chartRegionsJson chart_regions.json 内容
 * @returns {Set<string>}
 */
export function validRegionIds(chartRegionsJson) {
  const ids = new Set();
  for (const [key, entry] of Object.entries(chartRegionsJson ?? {})) {
    if (key.startsWith('_') || typeof entry !== 'object' || entry === null) continue;
    for (const r of entry.regions ?? []) {
      if (typeof r?.id === 'string') ids.add(r.id);
    }
  }
  return ids;
}

/**
 * 纯逻辑：找出 zones.json 里 regionId 已填但不在合法集合内的条目。data in / violations out，无 IO，便于单测。
 * @param {any} zonesJson zones.json 内容（顶层 { zones: [...] }）
 * @param {Set<string>} validIds validRegionIds() 的产出
 * @returns {Array<{zoneId: string, regionId: string}>}
 */
export function findInvalidZoneRegions(zonesJson, validIds) {
  const violations = [];
  for (const z of zonesJson?.zones ?? []) {
    if (z.regionId === undefined) continue; // 不填＝合法（未分区/开发测试）
    if (!validIds.has(z.regionId)) {
      violations.push({ zoneId: z.id, regionId: z.regionId });
    }
  }
  return violations;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const readJson = (p) => JSON.parse(readFileSync(p, 'utf-8'));
  const zonesJson = readJson(resolve(ROOT, 'src/data/zones.json'));
  const chartRegionsJson = readJson(resolve(ROOT, 'src/data/chart_regions.json'));

  const validIds = validRegionIds(chartRegionsJson);
  const violations = findInvalidZoneRegions(zonesJson, validIds);

  if (violations.length) {
    console.error(`✘ 大区归属门：${violations.length} 个 zone 的 regionId 不在合法集合内：\n`);
    for (const v of violations) {
      console.error(`  ${v.zoneId}  regionId="${v.regionId}"（合法值：${[...validIds].join(' / ')}）`);
    }
    console.error(
      '\n改法：把 regionId 改成上面列出的合法大区 id 之一；如果这个 zone 本就不该归任何大区' +
        '（深渊无锚点 / 开发测试用），删掉 regionId 字段即可——调试工具会自动落"未分区"桶。',
    );
    process.exit(1);
  }

  console.log(`✓ 大区归属门：zones.json 里已填的 regionId 均落在 chart_regions.json 声明的 ${validIds.size} 个大区内。`);
  process.exit(0);
}
