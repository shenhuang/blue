// scripts/lib/glob.mjs 单测——车道匹配 + 重叠判定（含旧手搓实现漏判的中段通配回归）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { globToRegExp, matchesAnyLane, globsOverlap, lanesOverlap } from '../lib/glob.mjs';

test('globToRegExp：目录前缀（无通配·不以 / 结尾）= 自身及其下全部', () => {
  const re = globToRegExp('src/engine');
  assert.ok(re.test('src/engine'));
  assert.ok(re.test('src/engine/state.ts'));
  assert.ok(re.test('src/engine/sub/deep.ts'));
  assert.ok(!re.test('src/engineering/x.ts')); // 不能把前缀误当子串
  assert.ok(!re.test('src/ui/x.ts'));
});

test('globToRegExp：* 不跨段、** 跨段、? 单字符', () => {
  assert.ok(globToRegExp('src/*/items.json').test('src/data/items.json'));
  assert.ok(!globToRegExp('src/*/items.json').test('src/a/b/items.json')); // * 不跨段
  assert.ok(globToRegExp('src/**/*.ts').test('src/a/b/c.ts'));
  assert.ok(globToRegExp('a/?.ts').test('a/x.ts'));
  assert.ok(!globToRegExp('a/?.ts').test('a/xx.ts'));
});

test('matchesAnyLane：任一车道命中即真·容忍前导 ./', () => {
  const lanes = ['src/engine/**', 'src/data/items.json'];
  assert.ok(matchesAnyLane('src/engine/state.ts', lanes));
  assert.ok(matchesAnyLane('./src/data/items.json', lanes));
  assert.ok(!matchesAnyLane('src/ui/App.tsx', lanes));
});

test('globsOverlap：子树 vs 其中文件 → 重叠', () => {
  assert.ok(globsOverlap('src/engine/**', 'src/engine/state.ts'));
  assert.ok(globsOverlap('src/engine', 'src/engine/state.ts')); // 目录前缀
});

test('globsOverlap：中段通配漏判回归（旧 lanesOverlap 的 False-Neg）', () => {
  // 这正是旧实现漏掉、会导致两条 session 静默撞车的情形。
  assert.ok(globsOverlap('src/*/items.json', 'src/data/items.json'));
  assert.ok(globsOverlap('src/**/reef.json', 'src/data/events/reef.json'));
});

test('globsOverlap：两个不同具体文件 → 不重叠（精度·不误判同目录不同文件撞）', () => {
  assert.ok(!globsOverlap('src/data/events/reef.json', 'src/data/events/wreck.json'));
  assert.ok(!globsOverlap('src/data/items.json', 'src/data/zones.json'));
});

test('globsOverlap：恰一侧通配命中字面 → 精确（不滥报）', () => {
  assert.ok(globsOverlap('a/*.ts', 'a/x.ts'));
  assert.ok(!globsOverlap('a/*.ts', 'a/x.json')); // 后缀不符 → 不交
});

test('globsOverlap：完全不相干路径 → 不重叠', () => {
  assert.ok(!globsOverlap('src/engine/**', 'src/ui/**'));
  assert.ok(!globsOverlap('docs/**', 'src/**'));
});

test('lanesOverlap：任一对重叠即真', () => {
  assert.ok(lanesOverlap(['src/engine/**'], ['src/ui/**', 'src/engine/state.ts']));
  assert.ok(!lanesOverlap(['src/engine/**'], ['src/ui/**', 'docs/**']));
});
