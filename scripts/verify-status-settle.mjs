#!/usr/bin/env node
// settleStatusesAtTurnStart 单测（战斗状态系统 SPEC §2.3·off-by-one 正确性关键）——
// 纯函数单测，不经 combat.ts / CombatState，隔离验证「先结算（DoT 求和落 HP + stun 判定）后减 1」
// 这条唯一会咬人的顺序：N 回合的效果必须正好跳过该角色自己的 N 次行动/N 次 DoT 后消失，不多不少。
//
// 跑法： tsx scripts/verify-status-settle.mjs（engine 用了 @/types 别名 + TS 类型 ⇒ 走 tsx，非 plain node；
// 同 check-gate-skeleton.mjs/check-gate-legibility.mjs 的先例）。

import assert from 'node:assert/strict';
import { settleStatusesAtTurnStart } from '../src/engine/status.ts';

let failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (e) {
    failed++;
    console.error(`✗ ${name}`);
    console.error('  ' + (e instanceof Error ? e.message : String(e)));
  }
}

// —— off-by-one：1/2/3 回合的 stunned 各验一遍（先结算后减 1·SPEC §2.3）——

test('1 回合晕：恰好挡 1 次行动后消失', () => {
  let r = settleStatusesAtTurnStart(100, [{ kind: 'stunned', remainingTurns: 1 }]);
  assert.equal(r.stunned, true, '第 1 次自己回合应仍算眩晕（挡这一下）');
  assert.deepEqual(r.statuses, [], '减 1 后归零 ⇒ 移除');
  r = settleStatusesAtTurnStart(r.hp, r.statuses);
  assert.equal(r.stunned, false, '状态已消失·第 2 次自己回合不再晕');
});

test('2 回合晕：挡 2 次行动，第 3 次不挡', () => {
  let r = settleStatusesAtTurnStart(100, [{ kind: 'stunned', remainingTurns: 2 }]);
  assert.equal(r.stunned, true, '第 1 次');
  assert.deepEqual(r.statuses, [{ kind: 'stunned', remainingTurns: 1 }], '减 1 后仍 >0·保留');
  r = settleStatusesAtTurnStart(r.hp, r.statuses);
  assert.equal(r.stunned, true, '第 2 次');
  assert.deepEqual(r.statuses, [], '减到 0 ⇒ 移除');
  r = settleStatusesAtTurnStart(r.hp, r.statuses);
  assert.equal(r.stunned, false, '第 3 次不再晕');
});

test('3 回合晕：挡 3 次行动，第 4 次不挡', () => {
  let r = settleStatusesAtTurnStart(100, [{ kind: 'stunned', remainingTurns: 3 }]);
  assert.equal(r.stunned, true, '第 1 次');
  r = settleStatusesAtTurnStart(r.hp, r.statuses);
  assert.equal(r.stunned, true, '第 2 次');
  assert.deepEqual(r.statuses, [{ kind: 'stunned', remainingTurns: 1 }]);
  r = settleStatusesAtTurnStart(r.hp, r.statuses);
  assert.equal(r.stunned, true, '第 3 次');
  assert.deepEqual(r.statuses, []);
  r = settleStatusesAtTurnStart(r.hp, r.statuses);
  assert.equal(r.stunned, false, '第 4 次不再晕');
});

// —— 二值状态：多实例取并集（最长者），不需特判（SPEC §2.4）——

test('晕并集＝最长者：5 回合 + 3 回合叠加，等效晕 5 回合', () => {
  let statuses = [
    { kind: 'stunned', remainingTurns: 5 },
    { kind: 'stunned', remainingTurns: 3 },
  ];
  let hp = 100;
  for (let i = 1; i <= 5; i++) {
    const r = settleStatusesAtTurnStart(hp, statuses);
    assert.equal(r.stunned, true, `第 ${i} 次自己回合仍应算晕（两条实例覆盖前 5 回合）`);
    hp = r.hp;
    statuses = r.statuses;
  }
  assert.deepEqual(statuses, [], '两条都应已耗尽移除');
  const r6 = settleStatusesAtTurnStart(hp, statuses);
  assert.equal(r6.stunned, false, '第 6 次不再晕');
});

// —— DoT：多实例求和落 HP，独立于 stun 判定（SPEC §2.3/§2.4）——

test('DoT 多实例求和·一次落 HP', () => {
  const r = settleStatusesAtTurnStart(20, [
    { kind: 'bleeding', remainingTurns: 2, dmgPerTurn: 3 },
    { kind: 'poisoned', remainingTurns: 1, dmgPerTurn: 5 },
  ]);
  assert.equal(r.hp, 12, '20 - (3+5) = 12');
  assert.equal(r.stunned, false, '无 stunned 实例');
  assert.deepEqual(r.statuses, [{ kind: 'bleeding', remainingTurns: 1, dmgPerTurn: 3 }], 'poisoned 减到 0 移除·bleeding 保留');
});

test('DoT 致死地板 0（不转负）', () => {
  const r = settleStatusesAtTurnStart(5, [{ kind: 'poisoned', remainingTurns: 3, dmgPerTurn: 10 }]);
  assert.equal(r.hp, 0, 'max(0, 5-10) = 0，不是 -5');
});

test('dmgPerTurn 缺省视为 0（二值状态不掉血）', () => {
  const r = settleStatusesAtTurnStart(50, [{ kind: 'stunned', remainingTurns: 2 }]);
  assert.equal(r.hp, 50, 'stunned 无 dmgPerTurn ⇒ 不掉血');
});

test('DoT + stunned 混合：求和落 HP 与 stun 并集互不干扰', () => {
  const r = settleStatusesAtTurnStart(30, [
    { kind: 'stunned', remainingTurns: 1 },
    { kind: 'bleeding', remainingTurns: 1, dmgPerTurn: 4 },
  ]);
  assert.equal(r.hp, 26);
  assert.equal(r.stunned, true);
  assert.deepEqual(r.statuses, [], '两条都 1 回合·同批减到 0 移除');
});

test('空状态列表：no-op', () => {
  const r = settleStatusesAtTurnStart(40, []);
  assert.equal(r.hp, 40);
  assert.equal(r.stunned, false);
  assert.deepEqual(r.statuses, []);
});

console.log('');
if (failed) {
  console.error(`✘ ${failed} 个失败`);
  process.exit(1);
}
console.log('✓ 全部通过');
