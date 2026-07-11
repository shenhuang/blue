// eventStats 聚合恒等式 smoke —— 守 src/engine/eventStats.ts（内容平衡「分布统计」聚合 + 建议算法）。
// 镜像先例：materialStats ↔ smoke-economy-panel（引擎聚合层用真数据跑一遍·断言派生恒等式会红）。
//
// 口径（见 eventStats.ts 顶注）：
//   - total = 去重事件总数；byTone 每事件恰好一桶 → 各桶之和 == total；
//   - matrix/byZone 每事件按入潜深度 depthRange[0] 归唯一深度桶、多 zoneTag 各行各记一次 →
//     行合计 == zoneTotals、列合计 == bucketTotals；
//   - toneByZone 与矩阵同口径（每 zone 列的 tone 合计 == zoneTotals）；toneByBucket 每事件一次 → 全表合计 == total；
//   - suggestions 只引用真实存在的 zone/深度桶，kind 与矩阵格子一致（gap ⟺ 0·thin ⇒ >0），gap 排 thin 前。
//
// 跑法：npx tsx scripts/smoke-event-stats.mjs

import { computeEventStats } from '../src/engine/eventStats.ts';
import { listAllEvents } from '../src/engine/eventScenario.ts';

function assert(cond, msg) {
  if (!cond) {
    console.error('✗ ' + msg);
    process.exit(1);
  }
}

const stats = computeEventStats();
const events = listAllEvents();

// ── ① 真数据非空 + total 口径（去重事件总数 == listAllEvents 同源） ──────────────────────────
assert(stats.total > 0, `total 应 > 0（EVENT_DB 真数据非空），实=${stats.total}`);
assert(stats.total === events.length, `total(${stats.total}) 应 == listAllEvents().length(${events.length})（同一事件源）`);
assert(stats.zones.length > 0 && stats.buckets.length > 0, 'zones / buckets 应非空');

// ── ② byTone 守恒：每事件恰好一个 tone → 各桶之和 == total；tones 全集与 byTone 同集合 ─────────
const toneSum = stats.byTone.reduce((s, t) => s + t.count, 0);
assert(toneSum === stats.total, `byTone 各桶之和(${toneSum}) 应 == total(${stats.total})`);
assert(stats.byTone.every((t) => t.count > 0), 'byTone 不应含 0 计数桶（只收录出现过的 tone）');
{
  const a = [...stats.tones].sort().join(',');
  const b = stats.byTone.map((t) => t.tone).sort().join(',');
  assert(a === b, `tones 全集(${a}) 应与 byTone 的 tone 集合(${b}) 一致`);
}

// ── ③ 矩阵守恒：行合计 == zoneTotals、列合计 == bucketTotals；byZone/byBucket 与之对得上 ────────
assert(stats.matrix.length === stats.zones.length, `matrix 行数(${stats.matrix.length}) 应 == zones 数(${stats.zones.length})`);
assert(stats.matrix.every((row) => row.length === stats.buckets.length), 'matrix 每行长度应 == buckets 数');
stats.zones.forEach((zone, zi) => {
  const rowSum = stats.matrix[zi].reduce((s, c) => s + c, 0);
  assert(rowSum === stats.zoneTotals[zi], `zone「${zone}」行合计(${rowSum}) 应 == zoneTotals[${zi}](${stats.zoneTotals[zi]})`);
});
stats.buckets.forEach((b, bi) => {
  const colSum = stats.matrix.reduce((s, row) => s + row[bi], 0);
  assert(colSum === stats.bucketTotals[bi], `深度桶「${b.label}」列合计(${colSum}) 应 == bucketTotals[${bi}](${stats.bucketTotals[bi]})`);
});
{
  // byZone 是 {zone → zoneTotals} 的重排序视图（升序·最薄在前）——键值都不许漂
  assert(stats.byZone.length === stats.zones.length, 'byZone 条目数应 == zones 数');
  const totalByZone = new Map(stats.zones.map((z, i) => [z, stats.zoneTotals[i]]));
  for (const { zone, count } of stats.byZone) {
    assert(totalByZone.has(zone), `byZone 引用的 zone「${zone}」应在 zones 全集里`);
    assert(totalByZone.get(zone) === count, `byZone「${zone}」count(${count}) 应 == zoneTotals(${totalByZone.get(zone)})`);
  }
  for (let i = 1; i < stats.byZone.length; i++) {
    assert(stats.byZone[i - 1].count <= stats.byZone[i].count, 'byZone 应按 count 升序（最薄在前）');
  }
  assert(
    stats.byBucket.length === stats.buckets.length &&
      stats.byBucket.every((b, bi) => b.label === stats.buckets[bi].label && b.count === stats.bucketTotals[bi]),
    'byBucket 应与 buckets 顺序对齐、count == bucketTotals',
  );
}

// ── ④ tone 交叉表守恒：toneByZone 列合计 == zoneTotals；toneByBucket 每桶 == 独立重算（每事件一次） ──
stats.zones.forEach((zone, zi) => {
  const sum = stats.tones.reduce((s, _, ti) => s + stats.toneByZone[ti][zi], 0);
  assert(sum === stats.zoneTotals[zi], `toneByZone zone「${zone}」列合计(${sum}) 应 == zoneTotals(${stats.zoneTotals[zi]})`);
});
{
  // 独立重算（不抄 eventStats 内部私有 BUCKET_M——从 buckets[0] 派生桶宽 + 末桶收编）
  const bucketW = stats.buckets[0].hi - stats.buckets[0].lo;
  const bucketOf = (d) => Math.min(stats.buckets.length - 1, Math.max(0, Math.floor(d / bucketW)));
  const expect = stats.buckets.map(() => 0);
  for (const e of events) expect[bucketOf(e.depthRange[0])] += 1;
  let grand = 0;
  stats.buckets.forEach((b, bi) => {
    const sum = stats.tones.reduce((s, _, ti) => s + stats.toneByBucket[ti][bi], 0);
    grand += sum;
    assert(sum === expect[bi], `toneByBucket 桶「${b.label}」合计(${sum}) 应 == 按入潜深度独立重算(${expect[bi]})`);
  });
  assert(grand === stats.total, `toneByBucket 全表合计(${grand}) 应 == total(${stats.total})（每事件恰好一次）`);
}

// ── ⑤ suggestions 引用完整性 + 与矩阵格一致 + gap 优先排序 ─────────────────────────────────────
{
  const zoneIndex = new Map(stats.zones.map((z, i) => [z, i]));
  const bucketIndex = new Map(stats.buckets.map((b, i) => [b.label, i]));
  let seenThin = false;
  for (const s of stats.suggestions) {
    assert(zoneIndex.has(s.zone), `建议引用的 zone「${s.zone}」应真实存在`);
    assert(bucketIndex.has(s.bucketLabel), `建议引用的深度桶「${s.bucketLabel}」应真实存在`);
    const cell = stats.matrix[zoneIndex.get(s.zone)][bucketIndex.get(s.bucketLabel)];
    assert(cell === s.count, `建议「${s.zone}×${s.bucketLabel}」count(${s.count}) 应 == 矩阵格子(${cell})`);
    if (s.kind === 'gap') {
      assert(s.count === 0, `gap 建议「${s.zone}×${s.bucketLabel}」应 count==0，实=${s.count}`);
      assert(!seenThin, 'suggestions 应 gap 全排在 thin 前（空洞优先）');
    } else {
      assert(s.kind === 'thin' && s.count > 0, `thin 建议「${s.zone}×${s.bucketLabel}」应 count>0，实=${s.count}`);
      seenThin = true;
    }
  }
}

// ── ⑥ 分布阈值门（#248 尾）：守内容偏斜——某桶/区退化到阈值外即红。阈值＝占位（当前实测 <X>·+margin）·待作者 number pass（defer-number-tuning）。
// 目的：不是「今天必须绿」（今天本来就绿·有余量），是「未来某个 zone/深度桶被churn 清空、或某个 zone 吃掉大半内容」时报警。
// 不用「格子占自身行(zone)比例」做阈值——shallow 这类单桶 zone 结构性就是 100%，那个指标起点就顶格、没有余量可言。
{
  const zoneEmpties = stats.zoneTotals.filter((c) => c === 0).length;
  assert(zoneEmpties === 0, `不应有 zone 完全空（0 事件），实空=${zoneEmpties}（当前实测 0·无余量·任何 zone 归零即红）`);

  const bucketEmpties = stats.bucketTotals.filter((c) => c === 0).length;
  assert(
    bucketEmpties <= 3,
    `空深度桶数(${bucketEmpties}) 应 <= 3（当前实测 1·210–240m 因桶边界天然稀·margin +2 桶）`,
  );

  const maxZoneShare = Math.max(...stats.zoneTotals.map((c) => c / stats.total));
  assert(
    maxZoneShare <= 0.42,
    `最大单 zone 占比(${(maxZoneShare * 100).toFixed(1)}%) 应 <= 42%（2026-07-12 随机内容层删除后重基线·当前实测 33.3%·tutorial〔固定教学 8 事件·总量缩到 24 后占比自然抬高〕·margin +9pp·占位待 number pass）`,
  );

  const gapCount = stats.suggestions.filter((s) => s.kind === 'gap').length;
  assert(
    gapCount <= 8,
    `gap 建议数(${gapCount}) 应 <= 8（当前实测 3·margin +5·gap＝某 zone 活跃深度跨度内出现 0 事件的桶）`,
  );
}

console.log(
  `✓ smoke-event-stats: 聚合恒等式通过（total=${stats.total}·tone 守恒·矩阵行/列合计·tone 交叉表·建议 ${stats.suggestions.length} 条引用+格子一致）+ 分布阈值门通过`,
);
