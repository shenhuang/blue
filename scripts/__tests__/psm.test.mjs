// psm land/merge/gc 的关键判定抽成的纯函数（scripts/psm.mjs 导出·git/fs 副作用留调用侧）。
// 喂假 ledger/假输入——不碰真 git；psm.mjs 的 CLI dispatch 有 isMain 门·import 不会触发。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshLock, classifyPendingFf, isMergedIntoMain, driftFromMain, shouldGcSession } from '../psm.mjs';

// ── freshLock（merge 串行锁·过期判定）──
test('freshLock：无锁 → null', () => {
  assert.equal(freshLock(null, Date.now(), 30), null);
});
test('freshLock：新锁 → 原样返回（锁冲突可判）', () => {
  const lk = { holder: 'a', ts: new Date().toISOString() };
  assert.equal(freshLock(lk, Date.now(), 30), lk);
});
test('freshLock：过期锁视同无锁、阈值内仍持有', () => {
  const now = Date.now();
  const stale = { holder: 'a', ts: new Date(now - 31 * 60000).toISOString() };
  assert.equal(freshLock(stale, now, 30), null);
  const held = { holder: 'a', ts: new Date(now - 29 * 60000).toISOString() };
  assert.equal(freshLock(held, now, 30), held);
});

// ── classifyPendingFf（ff 崩溃原子性·pendingFf 三态）──
test('classifyPendingFf：无标记 → null', () => {
  assert.equal(classifyPendingFf(null, 'abc'), null);
});
test('classifyPendingFf：标记在 + main 未动 → stale（安全·清即可）', () => {
  const pf = { name: 'x', rollbackSha: 'abc', ts: 't' };
  assert.deepEqual(classifyPendingFf(pf, 'abc'), { stale: true, pf });
  // main sha 读不出 → 同样按 stale 处理（别指着空值回滚）
  assert.deepEqual(classifyPendingFf(pf, null), { stale: true, pf });
});
test('classifyPendingFf：标记在 + main 已前进 → 未确认的 land', () => {
  const pf = { name: 'x', rollbackSha: 'abc', ts: 't' };
  assert.deepEqual(classifyPendingFf(pf, 'def'), { stale: false, pf, main: 'def' });
});

// ── isMergedIntoMain / driftFromMain（status 的 stale-landed / 落差检测）──
test('isMergedIntoMain：is-ancestor + 有真实提交 → 已并入', () => {
  assert.equal(isMergedIntoMain(true, 3), true);
  assert.equal(isMergedIntoMain(true, '3'), true); // rev-list --count 的字符串输出也认
});
test('isMergedIntoMain：零提交新线 tip 天然是 main 祖先 → 不算已并入', () => {
  assert.equal(isMergedIntoMain(true, 0), false);
  assert.equal(isMergedIntoMain(true, '0'), false);
  assert.equal(isMergedIntoMain(false, 3), false);
});
test('driftFromMain：sha 缺失或 count 抛错 → "?"，正常 → 计数', () => {
  assert.equal(driftFromMain(null, 'm', () => '2'), '?');
  assert.equal(driftFromMain('b', null, () => '2'), '?');
  assert.equal(driftFromMain('b', 'm', () => { throw new Error('boom'); }), '?');
  assert.equal(driftFromMain('b', 'm', (a, b2) => `${a}..${b2}`), 'b..m');
});

// ── shouldGcSession（gc 收割判定）──
const base = { isAncestor: false, workCount: 0, dirty: false, branch: 'feat/x', currentBranch: 'main' };
test('shouldGcSession：landed/aborted → 直接收（旧行为不变）', () => {
  assert.equal(shouldGcSession({ ...base, state: 'landed' }).reap, true);
  assert.equal(shouldGcSession({ ...base, state: 'aborted' }).reap, true);
});
test('shouldGcSession：active 已并入 main（有提交+祖先+净树）→ 视同 landed 收走', () => {
  assert.deepEqual(shouldGcSession({ ...base, state: 'active', isAncestor: true, workCount: 2 }), { reap: true, reason: 'merged' });
  assert.equal(shouldGcSession({ ...base, state: 'ready', isAncestor: true, workCount: 2 }).reap, true);
});
test('shouldGcSession：active 未并入（还有活在飞）→ 不收', () => {
  assert.equal(shouldGcSession({ ...base, state: 'active', isAncestor: false, workCount: 2 }).reap, false);
  // 刚开线零提交（tip=旧 main·天然祖先）也不收——收走会误伤在飞 session
  assert.equal(shouldGcSession({ ...base, state: 'active', isAncestor: true, workCount: 0 }).reap, false);
});
test('shouldGcSession：已并入但脏树 → 跳过（宁留勿删）', () => {
  assert.deepEqual(shouldGcSession({ ...base, state: 'active', isAncestor: true, workCount: 2, dirty: true }), { reap: false, reason: 'dirty' });
});
test('shouldGcSession：auto/weekend / 当前分支 → 永不自动收', () => {
  assert.equal(shouldGcSession({ ...base, state: 'active', isAncestor: true, workCount: 2, branch: 'auto/weekend' }).reap, false);
  assert.equal(shouldGcSession({ ...base, state: 'active', isAncestor: true, workCount: 2, currentBranch: 'feat/x' }).reap, false);
});
