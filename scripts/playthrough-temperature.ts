// 温度系统回归门（热/冷双极门控）·见 docs/spec/深海回响_温度系统_SPEC.md §8
//   1. thermalCeiling/抵消：随 intensity 增、随 insulation 减、clamp、保温足够 → 0
//   2. stepThermalStress：累积(趋 ceiling) / 恢复(趋 0) / clamp / turns=0 不变 / 逐回合 == 一次性（守 stalker 一致性）
//   3. thermalAccess：三档边界（deficit 0 / 40）+ 保温提升单调放宽
//   4. thermalStaminaDrain：随 stress 单调、WARN 以下 = 0、锚点
//   5. 数据↔标注一致性：侧表每条 reach == expectedReach(intensity)
//   6. 侧表合法性：polarity ∈ {hot,cold}、intensity ∈ [0,100]、zoneId 无重复
//
// 跑法： npx tsx scripts/playthrough-temperature.ts

import {
  TEMP,
  TEMP_BASELINE_INSULATION,
  getCaveTemperature,
  caveTemperatureEntries,
  thermalDeficit,
  thermalCeiling,
  stepThermalStress,
  thermalAccess,
  expectedReach,
  thermalStaminaDrain,
} from '../src/engine/temperature';

const log: string[] = [];
const L = (s: string) => log.push(s);
function assert(cond: unknown, msg: string) {
  if (!cond) {
    console.error(log.join('\n'));
    throw new Error('断言失败：' + msg);
  }
}
const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) <= eps;

// ── 1. ceiling / 保温抵消 ──
L('========== 1. thermalCeiling / 抵消 ==========');
assert(thermalCeiling(60, 0) > thermalCeiling(40, 0), 'ceiling 随 intensity 单调增');
assert(thermalCeiling(60, 40) < thermalCeiling(60, 10), 'ceiling 随保温单调减');
assert(near(thermalCeiling(30, 30), 0), '保温 == 强度 → ceiling 0');
assert(near(thermalCeiling(20, 50), 0), '保温 > 强度 → clamp 至 0（不积累）');
assert(near(thermalCeiling(200, 0), 100), 'ceiling clamp 上限 100');
assert(near(thermalDeficit(55, 30), 25), 'deficit = intensity − insulation');
L(`  ceiling(55,30)=${thermalCeiling(55, 30)} deficit=25 ✓`);

// ── 2. stepThermalStress 累积 / 恢复 / 组合 ──
L('========== 2. stepThermalStress ==========');
assert(stepThermalStress(0, 55, 30, 10) > 0, '热极洞从 0 → 累积上涨');
assert(stepThermalStress(0, 55, 30, 1000) <= thermalCeiling(55, 30) + 1e-9, '累积不越过 ceiling');
assert(stepThermalStress(40, 0, 0, 10) < 40, '离开（intensity=0）→ 恢复下降');
assert(stepThermalStress(40, 20, 50, 10) < 40, '保温足够（ceiling=0）→ 恢复下降');
assert(near(stepThermalStress(33, 60, 30, 0), 33), 'turns=0 → 不变');
// 组合不变量：逐回合 step ×6 == 一次性 step(6)（守 dive-stalker「逐字节同数」·同氮气）
let perTurn = 10;
for (let i = 0; i < 6; i++) perTurn = stepThermalStress(perTurn, 60, 30, 1);
const oneShot = stepThermalStress(10, 60, 30, 6);
assert(near(perTurn, oneShot, 1e-9), '逐回合 ×6 == 一次性(6)（守 stalker 一致性）');
L(`  逐回合=${perTurn.toFixed(6)} 一次性=${oneShot.toFixed(6)} ✓`);

// ── 3. thermalAccess 三档 + 单调放宽 ──
L('========== 3. thermalAccess ==========');
assert(thermalAccess(30, 30).reach === 'full', 'deficit 0 → full');
assert(thermalAccess(30, 31).reach === 'full', 'deficit <0（保温富余）→ full');
assert(thermalAccess(31, 30).reach === 'partial', 'deficit 1（>0）→ partial');
assert(thermalAccess(70, 30).reach === 'partial', 'deficit 40（边界·含）→ partial');
assert(thermalAccess(71, 30).reach === 'entry_blocked', 'deficit 41（>40）→ entry_blocked');
assert(thermalAccess(80, 30).canEnter === false, '过热 → 入口不可达');
// 保温提升 → 档位单调放宽（entry_blocked → partial → full）
assert(thermalAccess(80, 0).reach === 'entry_blocked', 'caldera 无保温 = entry_blocked');
assert(thermalAccess(80, 50).reach === 'partial', 'caldera 中等保温 = partial');
assert(thermalAccess(80, 80).reach === 'full', 'caldera 满保温 = full（保温=钥匙）');
L('  门控三档边界 0/40 + 保温单调放宽 ✓');

// ── 4. thermalStaminaDrain 超阈后果 ──
L('========== 4. thermalStaminaDrain ==========');
assert(near(thermalStaminaDrain(TEMP.WARN, 5), 0), 'WARN 处 = 0');
assert(near(thermalStaminaDrain(20, 5), 0), 'WARN 以下 = 0');
assert(thermalStaminaDrain(80, 5) > thermalStaminaDrain(60, 5), '应力越高扣越多（单调）');
assert(thermalStaminaDrain(50, 5) < thermalStaminaDrain(50, 10), 'turns 越多扣越多');
assert(near(thermalStaminaDrain(50, 0), 0), 'turns=0 → 0');
L(`  drain(80,5t)=${thermalStaminaDrain(80, 5).toFixed(2)} 体力`);

// ── 5. 数据↔标注一致性门 ──
L('========== 5. 侧表 reach == expectedReach(intensity) ==========');
for (const e of caveTemperatureEntries()) {
  const exp = expectedReach(e.intensity);
  assert(
    e.reach === exp,
    `${e.zoneId}: 侧表 reach='${e.reach}' ≠ 派生='${exp}'（intensity=${e.intensity}·BASELINE=${TEMP_BASELINE_INSULATION}）`,
  );
}
L(`  ${caveTemperatureEntries().length} 条侧表 reach 全与派生一致 ✓`);

// ── 6. 侧表合法性 ──
L('========== 6. 侧表合法性 ==========');
const seen = new Set<string>();
for (const e of caveTemperatureEntries()) {
  assert(e.polarity === 'hot' || e.polarity === 'cold', `${e.zoneId}: polarity 必须 hot/cold（中性不入表）`);
  assert(e.intensity >= 0 && e.intensity <= 100, `${e.zoneId}: intensity 须 ∈ [0,100]`);
  assert(!seen.has(e.zoneId), `${e.zoneId}: zoneId 重复`);
  seen.add(e.zoneId);
}
// 中性默认（未命中）
const neutral = getCaveTemperature('__not_in_table__');
assert(neutral.polarity === 'neutral' && neutral.intensity === 0 && neutral.reach === 'full', '未命中 → 中性全可探默认');
L(`  ${seen.size} 条合法 + 未命中走中性默认 ✓`);

console.log(log.join('\n'));
console.log('\n温度系统回归门 ✓ 全通过');
