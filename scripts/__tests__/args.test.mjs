// scripts/lib/args.mjs 单测——argv 解析（对象式 + 单值式·含负数值/末尾 flag 边界）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFlags, getFlag } from '../lib/args.mjs';

test('parseFlags：--k v / --k(末尾)=true / 位置参数进 _', () => {
  const f = parseFlags(['start', 'foo', '--lane', 'src/**', '--force']);
  assert.deepEqual(f._, ['start', 'foo']);
  assert.equal(f.lane, 'src/**');
  assert.equal(f.force, true);
});

test('parseFlags：--k 后接另一 --x → k=true（不吞下个 flag）', () => {
  const f = parseFlags(['--yes', '--name', 'x']);
  assert.equal(f.yes, true);
  assert.equal(f.name, 'x');
});

test('parseFlags：负数值安全（值以 - 开头但非 --）', () => {
  const f = parseFlags(['--concurrency', '-1']);
  assert.equal(f.concurrency, '-1');
});

test('parseFlags：空 argv → 仅空 _', () => {
  assert.deepEqual(parseFlags([]), { _: [] });
});

test('getFlag：存在取值 / 不存在 null / 末尾无值 ""', () => {
  assert.equal(getFlag(['--only', 'sonar'], '--only'), 'sonar');
  assert.equal(getFlag(['--list'], '--only'), null);
  assert.equal(getFlag(['--only'], '--only'), '');
});
