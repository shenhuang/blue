// 氮气系统回归门（饱和模型）·见 docs/spec/深海回响_氮气系统_SPEC.md §6
//   1. ceiling 随深单调、浅水封顶（< SAFE）、水面 = 0、最深仍 <100
//   2. stepNitrogen 深处吸氮(趋 ceiling) / 水面排氮(趋 0) / clamp / 逐回合 == 一次性（守 stalker 一致性）
//
// 跑法： npx tsx scripts/playthrough-nitrogen.ts

import { N2, nitrogenCeiling, stepNitrogen } from '../src/engine/nitrogen';
import { makeHarness, type PtAssert } from './lib/pt';

const pt = makeHarness('氮气系统回归门');
const { L, near } = pt;
const assert: PtAssert = pt.assert;

// ── 1. 饱和上限 ceiling ──
L('========== 1. ceiling 曲线 ==========');
assert(near(nitrogenCeiling(0), 0), '水面 ceiling = 0');
assert(nitrogenCeiling(30) < nitrogenCeiling(60), 'ceiling 随深单调增（浅段）');
assert(nitrogenCeiling(60) < nitrogenCeiling(140), 'ceiling 随深单调增（深段）');
assert(nitrogenCeiling(45) < N2.SAFE, '浅水(45m) ceiling < SAFE → 久留也不强制减压');
assert(nitrogenCeiling(290) < 100, '最深 ceiling 仍 <100（深处可靠升浅排氮·活资源）');
L(`  ceiling 45/60/140/290 = ${[45, 60, 140, 290].map((d) => nitrogenCeiling(d).toFixed(1)).join(' / ')}`);

// ── 2. stepNitrogen 吸/排 + clamp + 组合 ──
L('========== 2. stepNitrogen ==========');
assert(stepNitrogen(0, 60, 10) > 0, '深处从 0 → 吸氮上涨');
assert(stepNitrogen(0, 60, 10) <= nitrogenCeiling(60) + 1e-9, '吸氮不越过 ceiling');
assert(stepNitrogen(80, 0, 10) < 80, '水面 → 排氮下降');
assert(near(stepNitrogen(50, 42, 0), 50), 'turns=0 → 不变');
assert(stepNitrogen(0, 45, 1000) < N2.SAFE, '浅水(45m)久留(1000t)仍 < SAFE → 浅水自封顶');
// 组合不变量：逐回合 step ×6 == 一次性 step(6)（定深·守 dive-stalker「逐字节同数」）
let perTurn = 30;
for (let i = 0; i < 6; i++) perTurn = stepNitrogen(perTurn, 42, 1);
const oneShot = stepNitrogen(30, 42, 6);
assert(near(perTurn, oneShot, 1e-9), '逐回合 tick ×6 == 一次性 tick(6)（定深·守 stalker 一致性）');
L(`  逐回合=${perTurn.toFixed(6)} 一次性=${oneShot.toFixed(6)} ✓`);

pt.done();
