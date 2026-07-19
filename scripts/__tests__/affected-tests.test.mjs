// affected-tests 入口谓词（isEntry·经 computeAffected 间接测）——行为测入口 = playthrough*.ts +
// smoke-*.{tsx,mjs} + verify-tutorial.mjs。史因：smoke-chart-editor.mjs（已随 POI 调试面板删除·
// 2026-07-19）曾因谓词只认 .tsx 被漏成「unexplained→ALL」——改它本该精确选出它自己，却触发全量。
// 这里用现存的 smoke-event-stats.mjs 把 .mjs 入口钉住（谓词按文件名派生任务名·不查文件存在性）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeAffected } from '../affected-tests.mjs';

// fake graph（带 .entries → computeAffected 跳过 IO 重建·同 pure-fns.test.mjs 套路）。
const fakeGraph = { entries: [], reachOf: new Map(), dynDepOf: new Map(), files: [], fileSet: new Set() };

test('入口谓词：smoke-*.tsx 是行为测入口', () => {
  const r = computeAffected(['scripts/smoke-chart-ui.tsx'], fakeGraph);
  assert.equal(r.mode, 'subset');
  assert.deepEqual(r.tasks, ['smoke-chart-ui']);
});

test('入口谓词：smoke-*.mjs 也是行为测入口（smoke-event-stats 这类 .mjs smoke）', () => {
  const r = computeAffected(['scripts/smoke-event-stats.mjs'], fakeGraph);
  assert.equal(r.mode, 'subset');
  assert.deepEqual(r.tasks, ['smoke-event-stats']);
});

test('入口谓词：verify-tutorial.mjs 特判仍在', () => {
  const r = computeAffected(['scripts/verify-tutorial.mjs'], fakeGraph);
  assert.equal(r.mode, 'subset');
  assert.deepEqual(r.tasks, ['verify-tutorial']);
});

test('入口谓词：非 smoke 前缀的 scripts/*.mjs 不是入口（落 unexplained→ALL·安全网）', () => {
  assert.equal(computeAffected(['scripts/gen-enemy-registry.mjs'], fakeGraph).mode, 'all');
});
