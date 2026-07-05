// 月相 Phase 2 · 潜水环境合成回归（SPEC §8「有效 = POI 派生 ⊕ 月相(phase)」）
//   1. 确定性：同 day 得相同结果（无随机）
//   2. 加法性：月相只升档·从不降档·不丢 POI 其他字段
//   3. 大潮新增洋流：POI 无洋流 + 大潮 → mild
//   4. 小潮不变：POI 无洋流 + 小潮 → undefined current（零贡献）
//   5. 大潮不降档：POI strong + 大潮 → strong（不变）
//   6. 大潮不降档 mild：POI mild + 大潮 → mild（不变）
//   7. 非 current 字段：大潮下 visibility / depthOffset 等原样穿透
//
// 跑法： npx tsx scripts/playthrough-lunar-dive.ts

import { lunarDiveModifier } from '../src/engine/dive';
import { tideLevel, lunarPhase, moonAge, LUNAR_CYCLE_DAYS } from '../src/engine/lunar';
import type { PoiModifier } from '../src/types';

const log: string[] = [];
const L = (s: string) => log.push(s);
let passed = 0;
let failed = 0;

function assert(cond: unknown, msg: string): void {
  if (!cond) {
    log.push('  ✗ FAIL: ' + msg);
    failed++;
  } else {
    log.push('  ✓ ' + msg);
    passed++;
  }
}

// ── 1. 大潮 / 小潮日历（找合法 day）──────────────────────────────────────
// SPRING_TIDE_THRESHOLD = 0.7（dive-start.ts 内部常量·与此处一致）
const SPRING_THRESHOLD = 0.7;

/** 找第一个 tideLevel ≥ threshold 的 day（新/满月附近·0..27） */
function findSpringDay(): number {
  for (let d = 0; d < LUNAR_CYCLE_DAYS; d++) {
    if (tideLevel(d) >= SPRING_THRESHOLD) return d;
  }
  throw new Error('No spring tide found in one cycle — check SPRING_TIDE_THRESHOLD');
}

/** 找第一个 tideLevel < threshold 的 day（上/下弦附近·0..27） */
function findNeapDay(): number {
  for (let d = 0; d < LUNAR_CYCLE_DAYS; d++) {
    if (tideLevel(d) < SPRING_THRESHOLD) return d;
  }
  throw new Error('No neap tide found in one cycle');
}

const springDay = findSpringDay();
const neapDay = findNeapDay();

L('========== 月相 Phase 2 · 潜水环境合成回归 ==========');
L(`春潮 day=${springDay} tideLevel=${tideLevel(springDay).toFixed(3)} phase=${lunarPhase(springDay)} age=${moonAge(springDay)}`);
L(`小潮 day=${neapDay}  tideLevel=${tideLevel(neapDay).toFixed(3)} phase=${lunarPhase(neapDay)}  age=${moonAge(neapDay)}`);

// ── 2. 基础特性验证 ───────────────────────────────────────────────────────
L('\n--- A. 大潮特性 ---');
assert(tideLevel(springDay) >= SPRING_THRESHOLD, `springDay=${springDay} 应触发大潮阈值`);
assert(tideLevel(neapDay) < SPRING_THRESHOLD, `neapDay=${neapDay} 不应触发大潮阈值`);

// ── 3. 确定性：同 day 两次结果相同 ──────────────────────────────────────
L('\n--- B. 确定性（同 day → 相同结果） ---');
{
  const poi: PoiModifier = {};
  const r1 = lunarDiveModifier(poi, springDay);
  const r2 = lunarDiveModifier(poi, springDay);
  assert(
    JSON.stringify(r1) === JSON.stringify(r2),
    `lunarDiveModifier 结果对同 day=${springDay} 应确定性（r1=${JSON.stringify(r1)} r2=${JSON.stringify(r2)})`,
  );
}

// ── 4. 大潮 + POI 无洋流 → 新增 mild ──────────────────────────────────
L('\n--- C. 大潮新增洋流（POI 无洋流 → mild） ---');
{
  const noCurrentPoi: PoiModifier | undefined = undefined;
  const r = lunarDiveModifier(noCurrentPoi, springDay);
  assert(r !== undefined, '大潮 + undefined POI → 结果不应为 undefined');
  assert(r?.current !== undefined && r?.current !== 'none', '大潮 + 无洋流 POI → current 应为 mild（非空）');
  assert(r?.current === 'mild', `大潮新增洋流应为 mild（当前: ${r?.current}）`);
}
{
  const emptyPoi: PoiModifier = {};
  const r = lunarDiveModifier(emptyPoi, springDay);
  assert(r?.current === 'mild', `大潮 + 空 POI → current 应为 mild（当前: ${r?.current}）`);
}

// ── 5. 小潮 + POI 无洋流 → 零贡献（不引入洋流） ──────────────────────
L('\n--- D. 小潮零贡献（POI 无洋流 → 不引入洋流） ---');
{
  const r = lunarDiveModifier(undefined, neapDay);
  assert(
    r === undefined || !r?.current || r.current === 'none',
    `小潮 + 无洋流 POI → 不应引入洋流（当前: ${JSON.stringify(r)}）`,
  );
}
{
  const emptyPoi: PoiModifier = {};
  const r = lunarDiveModifier(emptyPoi, neapDay);
  assert(
    !r?.current || r.current === 'none',
    `小潮 + 空 POI → 不应引入洋流（当前: ${JSON.stringify(r)}）`,
  );
}

// ── 6. 大潮不降档 strong ─────────────────────────────────────────────────
L('\n--- E. 大潮不降档 strong ---');
{
  const strongPoi: PoiModifier = { current: 'strong' };
  const r = lunarDiveModifier(strongPoi, springDay);
  assert(r?.current === 'strong', `大潮 + POI strong → 仍应为 strong（当前: ${r?.current}）`);
}

// ── 7. 大潮不降档 mild ──────────────────────────────────────────────────
L('\n--- F. 大潮不降档 mild ---');
{
  const mildPoi: PoiModifier = { current: 'mild' };
  const r = lunarDiveModifier(mildPoi, springDay);
  assert(r?.current === 'mild', `大潮 + POI mild → 仍应为 mild（当前: ${r?.current}）`);
}

// ── 8. 非 current 字段穿透（additive：其他字段不被大潮吞） ───────────────
L('\n--- G. 非 current 字段大潮穿透（additive·不丢 POI 字段） ---');
{
  const richPoi: PoiModifier = { visibility: 'dark', depthOffset: 15 };
  const r = lunarDiveModifier(richPoi, springDay);
  assert(r?.visibility === 'dark', `大潮下 visibility 应原样穿透（当前: ${r?.visibility}）`);
  assert(r?.depthOffset === 15, `大潮下 depthOffset 应原样穿透（当前: ${r?.depthOffset}）`);
  assert(r?.current === 'mild', '大潮下同时新增 mild 洋流');
}

// ── 9. 跨周期确定性（day + CYCLE 与 day 结果相同） ───────────────────────
L('\n--- H. 跨周期确定性（day 与 day+28 结果相同） ---');
{
  const poi: PoiModifier = { visibility: 'dark' };
  const r1 = lunarDiveModifier(poi, springDay);
  const r2 = lunarDiveModifier(poi, springDay + LUNAR_CYCLE_DAYS);
  assert(
    JSON.stringify(r1) === JSON.stringify(r2),
    `lunarDiveModifier 跨周期应同值（day=${springDay} vs ${springDay + LUNAR_CYCLE_DAYS}）`,
  );
}

// ── 10. 加法性约束：合成结果的 current ≥ POI current（只升不降） ─────────
L('\n--- I. 加法性约束（合成 current ≥ POI current） ---');
{
  const cases: Array<{ poiCurrent: PoiModifier['current']; day: number }> = [
    { poiCurrent: undefined, day: springDay },
    { poiCurrent: 'none', day: springDay },
    { poiCurrent: 'mild', day: springDay },
    { poiCurrent: 'strong', day: springDay },
    { poiCurrent: undefined, day: neapDay },
    { poiCurrent: 'strong', day: neapDay },
  ];
  const order: Record<string, number> = { none: 0, mild: 1, strong: 2 };
  const rank = (c: string | undefined) => (c ? (order[c] ?? 0) : -1);
  for (const { poiCurrent, day } of cases) {
    const poi: PoiModifier = poiCurrent ? { current: poiCurrent } : {};
    const r = lunarDiveModifier(poi, day);
    const rc = r?.current;
    assert(
      rank(rc) >= rank(poiCurrent),
      `合成 current 不得低于 POI current（POI=${poiCurrent ?? 'none'} day=${day} → got=${rc ?? 'none'}）`,
    );
  }
}

// ── 结果输出 ─────────────────────────────────────────────────────────────
console.log(log.join('\n'));
console.log(`\n${passed + failed} 项断言：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);
console.log('\n✓ playthrough-lunar-dive 全绿');
