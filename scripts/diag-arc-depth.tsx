// 诊断（手动）：剧情弧「层数/深度」分布——量化「为什么很多剧情只有一层」。
// 一层＝该事件没有任何出边（点完即回节点选择·remainOnEvent）；多层＝有 triggerEventId / 战斗胜利续接。
// 跑： ESBUILD_BINARY_PATH=/tmp/package/bin/esbuild npx tsx scripts/diag-arc-depth.tsx
import { EVENT_DB, getEventById } from '../src/engine/zones';
import { eventArc, outgoingEdges, eventRoots } from '../src/engine/eventGraph';

const all = [...EVENT_DB.keys()];

// 纯叶子：0 条有效出边（点完即离场）
let leaf = 0;
for (const id of all) {
  const ev = getEventById(id)!;
  if (outgoingEdges(ev).filter((e) => !e.missing).length === 0) leaf++;
}

// 以每个事件为根重建弧，统计节点数分布
const buckets: Record<string, number> = { '1': 0, '2': 0, '3-5': 0, '6+': 0 };
const multi: { id: string; n: number }[] = [];
for (const id of all) {
  const n = eventArc(id)?.nodes.length ?? 1;
  if (n === 1) buckets['1']++;
  else if (n === 2) buckets['2']++;
  else if (n <= 5) buckets['3-5']++;
  else buckets['6+']++;
  if (n >= 2) multi.push({ id, n });
}
multi.sort((a, b) => b.n - a.n);

const pct = (x: number) => `${((100 * x) / all.length).toFixed(0)}%`;
console.log(`\n全库事件：${all.length}`);
console.log(`纯叶子（0 出边·点完即回节点选择）：${leaf}（${pct(leaf)}）`);
console.log(`弧头（剧情线起点·无人 triggerEventId/战斗续接 指向）：${eventRoots().length}`);
console.log(`\n以各事件为根的弧大小：`);
console.log(`  1 节点（只有一层）：${buckets['1']}（${pct(buckets['1'])}）`);
console.log(`  2 节点：${buckets['2']}（${pct(buckets['2'])}）`);
console.log(`  3–5 节点：${buckets['3-5']}（${pct(buckets['3-5'])}）`);
console.log(`  6+ 节点：${buckets['6+']}（${pct(buckets['6+'])}）`);
console.log(`\n最长的几条链（真正多层的剧情）：`);
for (const m of multi.slice(0, 12)) console.log(`  ${m.id} · ${m.n} 节点 (${getEventById(m.id)?.title ?? '?'})`);
