// 既有「便于单测」却一直没接测的纯决策函数——把守每次 commit 的门自己焊上测试（Agent 审计 #6）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decide as decideBranch } from '../check-branch.mjs';
import { decide as decideDocs } from '../check-append-only-docs.mjs';
import { computeAffected } from '../affected-tests.mjs';

// ── check-branch.decide（写手×分支·并发隔离方案 A·quirk #104）──
test('check-branch：nightly 跨分支放行', () => {
  assert.equal(decideBranch('main', 'nightly').ok, true);
  assert.equal(decideBranch('auto/weekend', 'nightly').ok, true);
});
test('check-branch：交互写手在 main 常态放行', () => {
  assert.equal(decideBranch('main', '').ok, true);
  assert.equal(decideBranch('main', 'interactive').ok, true);
});
test('check-branch：weekend 写手在 auto/weekend 放行、在 main 红', () => {
  assert.equal(decideBranch('auto/weekend', 'weekend').ok, true);
  assert.equal(decideBranch('main', 'weekend').ok, false); // hazard2
});
test('check-branch：在 auto/weekend 但未声明 weekend 身份 → 红', () => {
  assert.equal(decideBranch('auto/weekend', 'interactive').ok, false); // hazard1
});

// ── check-append-only-docs.decide（CHANGELOG/QUIRKS 只在 main 改·quirk #130）──
test('check-append-only-docs：main 放行 / 改了 guarded 文档在 feature 红', () => {
  assert.equal(decideDocs('main', ['docs/QUIRKS.md']).ok, true);
  assert.equal(decideDocs('feat/x', []).ok, true);
  assert.equal(decideDocs('feat/x', ['docs/QUIRKS.md']).ok, false);
});

// ── affected-tests.computeAffected（受影响选测·健全回退 ALL）──
// 传入 fake graph（带 .entries）以跳过 IO（computeAffected 见到 .entries 即不重建图）。
const fakeGraph = { entries: [], reachOf: new Map(), dynDepOf: new Map(), files: [], fileSet: new Set() };
test('computeAffected：全局触发 → ALL', () => {
  assert.equal(computeAffected(['package.json'], fakeGraph).mode, 'all');
});
test('computeAffected：惰性文档 → subset 空', () => {
  const r = computeAffected(['docs/x.md'], fakeGraph);
  assert.equal(r.mode, 'subset');
  assert.deepEqual(r.tasks, []);
});
test('computeAffected：源码区无法解释 → 保守 ALL', () => {
  assert.equal(computeAffected(['src/orphan.ts'], fakeGraph).mode, 'all');
});
test('computeAffected：改入口本身 → 选出该行为测', () => {
  const r = computeAffected(['scripts/playthrough-foo.ts'], fakeGraph);
  assert.equal(r.mode, 'subset');
  assert.deepEqual(r.tasks, ['playthrough-foo']);
});
