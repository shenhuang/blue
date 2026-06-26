// scripts/lib/env.mjs 单测——沙箱路径判定。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isSandbox } from '../lib/env.mjs';

test('isSandbox：/sessions/ 前缀 → 真', () => {
  assert.ok(isSandbox('/sessions/foo/mnt/Blue'));
});

test('isSandbox：含 /mnt/ → 真', () => {
  assert.ok(isSandbox('/some/where/mnt/Blue'));
});

test('isSandbox：Mac 本机路径 → 假', () => {
  assert.ok(!isSandbox('/Users/x/Desktop/Blue'));
  assert.ok(!isSandbox('/home/x/Blue'));
});
