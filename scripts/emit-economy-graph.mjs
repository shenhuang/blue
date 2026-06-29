#!/usr/bin/env node
// 经济 DAG 可视化 emit（2026-06-29·E/F v2 副产物）——把单一真相 buildEconomyDag() 画成一张 Mermaid，
// 违反 F1/F2 硬门的节点染红、F4/F5 软警告染琥珀。零 UI·版本可控·PR diff 直接看「图变了哪」。
// 提交在 docs/economy-dag.mmd（GitHub 原生渲染 Mermaid）。
//
// 用法：
//   node scripts/emit-economy-graph.mjs            # 打到 stdout（预览）
//   node scripts/emit-economy-graph.mjs --write    # 写/更新 docs/economy-dag.mmd
//   node scripts/emit-economy-graph.mjs --check     # 校验提交版是否最新（漂移门·进 regress）——不一致/缺失=退出 1
//
// 漂移门理由：图与数据同源再生·committed 版若跟数据脱节就该红（机制·非散文）。改经济数据后 `--write` 再提交。
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildEconomyDag, auditRoles, auditReachability, toMermaid } from './lib/economy-dag.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', 'docs', 'economy-dag.mmd');

const dag = buildEconomyDag();
const roles = auditRoles(dag);
const reach = auditReachability(dag);

const badItems = new Set();
const badBuilds = new Set();
const badRegions = new Set(); // F4 稀疏硬门（#239）：区域级违规·无 itemId/where·单列染红
for (const v of [...roles.violations, ...reach.violations]) {
  if (v.itemId) badItems.add(v.itemId);
  if (v.where) badBuilds.add(v.where);
  if (v.code === 'reach/F4-sparse' && v.region) badRegions.add(v.region);
}
const warnItems = new Set();
const warnRegions = new Set();
for (const w of reach.warnings) {
  if (w.itemId) warnItems.add(w.itemId);
  for (const id of w.items ?? []) warnItems.add(id);
  if (w.region) warnRegions.add(w.region);
}

const mmd = toMermaid(dag, { badItems, badBuilds, warnItems, warnRegions, badRegions });

const argv = process.argv.slice(2);
if (argv.includes('--check')) {
  let committed = null;
  try {
    committed = readFileSync(OUT, 'utf8');
  } catch {
    console.error('✗ check-economy-graph：docs/economy-dag.mmd 缺失 — 跑 `node scripts/emit-economy-graph.mjs --write` 生成并提交。');
    process.exit(1);
  }
  if (committed !== mmd) {
    console.error('✗ check-economy-graph：docs/economy-dag.mmd 与经济数据脱节（漂移）— 跑 `node scripts/emit-economy-graph.mjs --write` 再生并提交。');
    process.exit(1);
  }
  console.log('✓ check-economy-graph：docs/economy-dag.mmd 与数据同步');
  process.exit(0);
}

if (argv.includes('--write')) {
  writeFileSync(OUT, mmd);
  const flags = badItems.size + badBuilds.size + badRegions.size;
  console.log(`✓ 写出 docs/economy-dag.mmd（${dag.builds.length} 建造 · ${flags ? flags + ' 硬违规染红 · ' : ''}${warnItems.size} 软警告染琥珀）`);
  process.exit(0);
}

process.stdout.write(mmd);
