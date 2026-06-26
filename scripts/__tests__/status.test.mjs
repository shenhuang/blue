// scripts/check-status-fresh.mjs::decideStatusFresh 单测——结构性新鲜度判定。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideStatusFresh } from '../check-status-fresh.mjs';

const allExist = () => true;

test('blockquote 在 + 带日期 + 短 + 引用存在 → 绿', () => {
  const r = decideStatusFresh('# T\n> 2026-06-26 干了活\n\nbody `playthrough-foo.ts`', allExist);
  assert.deepEqual(r.fails, []);
});

test('blockquote 缺失 → 红', () => {
  const r = decideStatusFresh('# T\n\nno quote here\n', allExist);
  assert.ok(r.fails.some((f) => f.includes('blockquote 缺失')));
});

test('blockquote 无日期 → 红', () => {
  const r = decideStatusFresh('# T\n> 最近 session：做了些事\n\nbody', allExist);
  assert.ok(r.fails.some((f) => f.includes('无 YYYY-MM-DD')));
});

test('行数超上限 → 红', () => {
  const big = '# T\n> 2026-06-26 x\n' + 'a\n'.repeat(50);
  const r = decideStatusFresh(big, allExist, { lineCap: 10 });
  assert.ok(r.fails.some((f) => f.includes('> 上限')));
});

test('点名带扩展名的脚本不存在 → 红；裸散文名放过', () => {
  const r = decideStatusFresh('# T\n> 2026-06-26 x\n\nsee `playthrough-gone.ts` and check-list prose', () => false);
  assert.ok(r.fails.some((f) => f.includes('playthrough-gone')));
  assert.ok(!r.fails.some((f) => f.includes('check-list'))); // 裸散文名（无扩展）不查
});
