// scripts/check-openwater-wall.mjs 单测（NIT2·#330 对抗复审加固）——`findInvalidOpenWaterWalls` 纯逻辑校验。
//
// 为什么补这份（regress 里已有 check-openwater-wall 任务跑真 zones.json，为什么还不够）：
// 集成任务只能证明「当前 zones.json 里没有坏配置」——如果某条判断式写反（比如把 `!==` 打成 `===`、
// 或漏了某个分支），只要现在没人凑巧写出那种坏配置，集成测试仍然全绿，判断式失去牙齿的事实
// 不会在 regress 里冒泡。纯函数单测把每一种坏组合单独钉死：**故意**喂一份坏 zonesJson，断言真的会被抓到
// （同 playthrough-openwater-wall.ts 里「负控」的精神——两边都测：合法放行 + 每种非法都拦）。
//
// 覆盖（对齐 check-openwater-wall.mjs 头注的不变量表）：合法组合放行；side 缺失/不合法值；
// side='left' 缺 otherSide / otherSide 不合法值；side='both' 却填了 otherSide（禁填）；
// material 不合法值；未知字段。
//
// 由 run-tooling-tests.mjs 自动发现（check-tooling·纯 node·沙箱也跑）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findInvalidOpenWaterWalls } from '../check-openwater-wall.mjs';

test('合法组合（both / left+taper / right+midwater+material / 无 openWaterWall）全部放行', () => {
  const zonesJson = {
    zones: [
      { id: 'z1', openWaterWall: { side: 'both' } },
      { id: 'z2', openWaterWall: { side: 'left', otherSide: 'taper' } },
      { id: 'z3', openWaterWall: { side: 'right', otherSide: 'midwater', material: 'rock' } },
      { id: 'z4' }, // 无 openWaterWall 字段 ⇒ 跳过（缺省＝无墙·合法）
    ],
  };
  assert.deepEqual(findInvalidOpenWaterWalls(zonesJson), []);
});

test('side 必填但缺失 ⇒ 违规', () => {
  const zonesJson = { zones: [{ id: 'bad', openWaterWall: {} }] };
  const violations = findInvalidOpenWaterWalls(zonesJson);
  assert.ok(violations.length >= 1, 'side 缺失应至少产生一条违规，实际 0 条');
  assert.equal(violations[0].id, 'bad');
});

test("side='diag'（不在 {left,right,both} 内）⇒ 违规", () => {
  const zonesJson = { zones: [{ id: 'bad', openWaterWall: { side: 'diag' } }] };
  const violations = findInvalidOpenWaterWalls(zonesJson);
  assert.ok(violations.length >= 1, 'side 不合法值应至少产生一条违规，实际 0 条');
  assert.equal(violations[0].id, 'bad');
});

test("side='left' 但 otherSide 缺失 ⇒ 违规", () => {
  const zonesJson = { zones: [{ id: 'bad', openWaterWall: { side: 'left' } }] };
  const violations = findInvalidOpenWaterWalls(zonesJson);
  assert.ok(violations.length >= 1, 'side=left 缺 otherSide 应至少产生一条违规，实际 0 条');
  assert.equal(violations[0].id, 'bad');
});

test("side='left' + otherSide='sideways'（不在 {taper,midwater} 内）⇒ 违规", () => {
  const zonesJson = { zones: [{ id: 'bad', openWaterWall: { side: 'left', otherSide: 'sideways' } }] };
  const violations = findInvalidOpenWaterWalls(zonesJson);
  assert.ok(violations.length >= 1, 'otherSide 不合法值应至少产生一条违规，实际 0 条');
  assert.equal(violations[0].id, 'bad');
});

test("side='both' 却填了 otherSide（both 时必须不填）⇒ 违规", () => {
  const zonesJson = { zones: [{ id: 'bad', openWaterWall: { side: 'both', otherSide: 'taper' } }] };
  const violations = findInvalidOpenWaterWalls(zonesJson);
  assert.ok(violations.length >= 1, "side='both' 时填了 otherSide 应至少产生一条违规，实际 0 条");
  assert.equal(violations[0].id, 'bad');
});

test("material='steel'（当前仅支持 'rock'）⇒ 违规", () => {
  const zonesJson = { zones: [{ id: 'bad', openWaterWall: { side: 'both', material: 'steel' } }] };
  const violations = findInvalidOpenWaterWalls(zonesJson);
  assert.ok(violations.length >= 1, 'material 不合法值应至少产生一条违规，实际 0 条');
  assert.equal(violations[0].id, 'bad');
});

test('未知字段（拼写错的 key）⇒ 违规', () => {
  const zonesJson = { zones: [{ id: 'bad', openWaterWall: { side: 'both', foo: 1 } }] };
  const violations = findInvalidOpenWaterWalls(zonesJson);
  assert.ok(violations.length >= 1, '未知字段应至少产生一条违规，实际 0 条');
  assert.equal(violations[0].id, 'bad');
});
