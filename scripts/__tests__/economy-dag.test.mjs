// F4 稀疏硬门（2026-06-29 #239 由软警告提升）——把「单柱真·跨区门 ≤2」钉成会红的测试。
//   · 合成 dag 验阈值逻辑（数据无关·重构 economy-dag.mjs 不会悄悄改 F4 语义：>上限才红、且落在 .violations 非 .warnings）。
//   · 真实数据金丝雀：当前 trench/midwater 各 2 → 无 F4 violation；谁给某柱加第 3 条跨区门，本测
//     与 check-economy-reachability 同时变红（这正是把约定落成机制·见 CLAUDE.md「能不能变成会红的检查」）。
// 由 run-tooling-tests.mjs 自动发现（check-tooling·纯 node·沙箱也跑）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEconomyDag, auditReachability } from '../lib/economy-dag.mjs';

// 最小合成 dag：一座 region 深度柱（tier2·非 capstone）消费 n 个「源恒在别区」的料。
// 只为打 F4 路径——其余公理（①②/F1/F2/F5）都构造成恒过，断言只看 reach/F4-sparse。
//   · 无 b.depth → F1 跳过；onlyFromCapstone=false → F2b 不触发；区域边 region→__src 无环 → F2a 不触发；
//   · 申报 T2 而源深 120m≈T3·差 1<2 → 无 F5；universe 全在册且各 1 源 → ①② 过。
function fakeDagWithCrossGates(region, n) {
  const mats = Array.from({ length: n }, (_, i) => ({ itemId: `item.x${i}` }));
  return {
    builds: [{ kind: 'column', region, tier: 2, capstone: false, mats, where: `build.${region}.t2`, label: 't2' }],
    universe: new Set(mats.map((m) => m.itemId)),
    miraBuyable: new Set(),
    sourcesByItem: new Map(mats.map((m) => [m.itemId, [{ kind: 'event', depth: 120 }]])),
    onlyFromCapstone: () => false,
    sourceRegions: () => new Set(['__src']), // 恒在别区 → 跨区
    shallowestSourceDepth: () => 0, // ≤ 任何档 → F1 恒过
    tierOf: new Map(mats.map((m) => [m.itemId, 2])),
  };
}

const f4Of = (arr) => arr.filter((x) => x.code === 'reach/F4-sparse');

test('F4：单柱 2 条跨区门 — 不红（≤ 上限）', () => {
  const res = auditReachability(fakeDagWithCrossGates('__t', 2));
  assert.equal(f4Of(res.violations).length, 0);
});

test('F4：单柱 3 条跨区门 — 红（硬 violation·非软 warning）', () => {
  const res = auditReachability(fakeDagWithCrossGates('__t', 3));
  const hits = f4Of(res.violations);
  assert.equal(hits.length, 1, 'F4 应触发一处 violation');
  assert.equal(hits[0].region, '__t');
  // 提升的关键断言：落在 .violations（会让 check 退出 1）·不再落在 .warnings（旧软语义已废）。
  assert.equal(f4Of(res.warnings).length, 0, 'F4 不应再作为软警告出现');
});

test('F4 金丝雀：真实经济数据当前无 F4 violation（trench/midwater 各 ≤2）', () => {
  const res = auditReachability(buildEconomyDag());
  const hits = f4Of(res.violations);
  assert.equal(hits.length, 0, hits.map((h) => h.msg).join(' / '));
});
