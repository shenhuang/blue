#!/usr/bin/env tsx
// 素材经济审计（只读·非回归门）—— 薄壳：解析与聚合全在 engine/materialStats.ts（单一真相），
// 本脚本只负责「取数 + 排版」。把「每种素材：哪些敌人/事件掉 × 哪些配方要多少」拉成一张表，
// 一眼看出**单一来源垄断**、**集中重需求**、**有产零销的死料**、**有需求无来源的死货**。
//
// 不是 regress 门（这些是设计信号·不是 bug）：改内容后跑 `npm run audit:materials` 体检经济结构。
// 同一份聚合也被 src/ui/dev/EconomyDevPanel（?editor=economy）与 smoke-economy-panel（parity 门）消费，
// 三处共用 computeMaterialStats()——别再在脚本里复刻解析（旧 material-audit.mjs 的 readdir/walk 已搬进 engine）。
//
// 用法：
//   npm run audit:materials            人类可读分组表
//   npm run audit:materials -- --json   结构化 JSON（喂下游：xlsx 导出等）
//   （直接跑：tsx scripts/material-audit.ts [--json]）

import {
  computeMaterialStats,
  type MaterialStat,
  type MaterialStatus,
} from '../src/engine/materialStats';

const asJson = process.argv.includes('--json');

// status 枚举 → 旧 CLI 文案（emoji 是 CLI 表现层·engine 只给结构化枚举·--json 口径逐字节不变）。
const STATUS_LABEL: Record<MaterialStatus, string> = {
  deadstock: '⚫死货(有需求无来源)',
  bottleneck: '🔴垄断瓶颈',
  single: '🟠单源',
  singleIdle: '·单源(纯卖/无需求)',
  heavy: '⚠️重需求(多源尚可)',
  ok: '✓',
};

const { materials } = computeMaterialStats();

if (asJson) {
  // 旧 --json 行形（id,name,tier,sell,srcN,totDem,status,sources,demands）——下游 xlsx 等照此消费。
  const rows = materials.map((m: MaterialStat) => ({
    id: m.id,
    name: m.name,
    tier: m.tier,
    sell: m.sellPrice,
    srcN: m.srcCount,
    totDem: m.totalDemand,
    status: STATUS_LABEL[m.status],
    sources: m.sources,
    demands: m.demands,
  }));
  console.log(JSON.stringify(rows, null, 2));
  process.exit(0);
}

// 人类可读（排版与旧 material-audit.mjs 逐字节一致）。
const pad = (s: string | number, n: number) => String(s).padEnd(n);
console.log('素材经济审计  （来源数 / 总需求 / 状态）\n' + '─'.repeat(64));
console.log(pad('素材', 14) + pad('T', 5) + pad('源', 4) + pad('需求', 6) + '状态');
for (const r of materials) {
  console.log(pad(r.name, 14) + pad(r.tier, 5) + pad(r.srcCount, 4) + pad(r.totalDemand, 6) + STATUS_LABEL[r.status]);
}
console.log('─'.repeat(64));
const fmt = (pred: (m: MaterialStat) => boolean) =>
  materials.filter(pred).map((r) => `${r.name}(${r.totalDemand})`).join(', ') || '无';
console.log('🔴 垄断瓶颈(单源·需求≥8):', fmt((r) => r.bottleneck));
console.log('⚫ 死货(有需求无来源):', fmt((r) => r.deadstock));
console.log(
  '💤 有产零销(有来源·零需求·非剧情):',
  materials.filter((r) => r.idle).map((r) => r.name).join(', ') || '无',
);
