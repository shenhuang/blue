// 深度 band / 蛙跳下潜回归（深水区 Phase 1：可扩展纵向深度轴）。
// 覆盖：
//   1. band 表加载 + order 升序 + getBand 索引
//   2. 存在 >60m 的深 band（去掉 60m 准硬上限）、深 band = 黑水（软门控核心）
//   3. mapgen depthRange 覆盖：band 绝对窗口生成、深度落窗口内、比 zone 自身更深
//   4. startDiveFromOutpost 落 run：zoneId/diveModifier/深度窗口/蛙跳预耗氧
//   5. 软门控：深黑 band + 无声呐 → clarity none（瞎）；买了声呐 → run 解锁（装备＝钥匙）
//   6. Phase 0 升级轨直通蛙跳：powerMax 加成进 run（装备成长直接进深潜）
//   7. alertDepthFactor 去掉写死 60：深 band(>60m) 饱和=1、不报错、浅水仍免压
//
// 跑法： npx tsx scripts/playthrough-bands.ts

import { createInitialGameState } from '../src/engine/state';
import { getBands, getBand, bandDiveModifier } from '../src/engine/bands';
import { startDiveFromOutpost } from '../src/engine/dive';
import { generateDiveMap } from '../src/engine/mapgen';
import { getZone } from '../src/engine/zones';
import {
  clarity,
  lampEffective,
  alertDepthFactor,
  ALERT_DEPTH_FULL,
  POWER_MAX,
} from '../src/engine/clarity';
import type { GameState } from '../src/types';

const log: string[] = [];
const L = (s: string) => log.push(s);
function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    console.error(log.join('\n'));
    throw new Error('断言失败：' + msg);
  }
}
const depthsOf = (s: GameState) => Object.values(s.run!.map!.nodes).map((n) => n.depth);

// ============================================================
// 1. band 表加载 + order 升序 + getBand 索引
// ============================================================
L('========== 1. band 表加载 ==========');
const bands = getBands();
assert(bands.length >= 3, '1: 至少 3 个 band');
for (let i = 1; i < bands.length; i++) {
  assert(bands[i].order > bands[i - 1].order, '1: getBands 按 order 升序（越深越后）');
}
assert(getBand(bands[0].id) === bands[0], '1: getBand 命中索引');
assert(getBand('band.does_not_exist') === undefined, '1: 未知 band → undefined');
L(`  ${bands.length} 个 band：${bands.map((b) => `${b.name}[${b.depthRange[0]}-${b.depthRange[1]}]`).join(' → ')} ✓`);

// ============================================================
// 2. 存在 >60m 的深 band（突破旧 60m 准硬上限）+ 深 band = 黑水
// ============================================================
L('\n========== 2. 深 band 突破 60m + 黑水 ==========');
const deep = bands.find((b) => b.depthRange[0] >= 60);
assert(deep, '2: 存在 ≥60m 的深 band（去掉 60m 准硬上限、证明不封顶）');
assert(deep!.visibility === 'dark', '2: 深 band = 黑水（软门控：灯打不透 → 被迫用更耗电的声呐）');
assert(bandDiveModifier(deep!).visibility === 'dark', '2: bandDiveModifier 透出 visibility');
L(`  最深 band「${deep!.name}」${deep!.depthRange[0]}–${deep!.depthRange[1]}m · ${deep!.visibility} ✓`);

// ============================================================
// 3. mapgen depthRange 覆盖：band 绝对窗口生成
// ============================================================
L('\n========== 3. mapgen depthRange 覆盖 ==========');
const zone = getZone(deep!.zoneId)!;
const map = generateDiveMap({ zone, profileFlags: new Set(), depthRange: deep!.depthRange });
const md = Object.values(map.nodes).map((n) => n.depth);
const lo = Math.min(...md), hi = Math.max(...md);
assert(lo >= deep!.depthRange[0] && hi <= deep!.depthRange[1], `3: 深度落在 band 窗口 [${deep!.depthRange}]，实际 [${lo},${hi}]`);
assert(hi > zone.depthRange[1], `3: band 窗口比 zone 自身 depthRange[1]=${zone.depthRange[1]} 更深（覆盖生效、非平移）`);
// 不传 depthRange → 回退 zone 自身（POI/教学路径不受影响）
const mapBase = generateDiveMap({ zone, profileFlags: new Set() });
const hiBase = Math.max(...Object.values(mapBase.nodes).map((n) => n.depth));
assert(hiBase <= zone.depthRange[1], '3: 不传 depthRange → 回退 zone.depthRange（向后兼容）');
L(`  band 窗口生成 [${lo},${hi}]（zone 自身上限 ${zone.depthRange[1]}）✓`);

// ============================================================
// 4. startDiveFromOutpost 落 run
// ============================================================
L('\n========== 4. startDiveFromOutpost ==========');
const base = createInitialGameState();
const s = startDiveFromOutpost(base, deep!.id);
assert(s.run, '4: 出潜后有 run');
assert(s.run!.zoneId === deep!.zoneId, '4: run.zoneId = band.zoneId');
assert(s.run!.diveModifier?.visibility === 'dark', '4: run.diveModifier.visibility = band.visibility');
const rd = depthsOf(s);
assert(Math.min(...rd) >= deep!.depthRange[0] && Math.max(...rd) <= deep!.depthRange[1], '4: run.map 深度落在 band 窗口');
assert(s.run!.stats.oxygen < s.run!.oxygenMax, '4: 蛙跳预耗氧（航行耗气）');
L('  zoneId / 黑水 modifier / 深度窗口 / 预耗氧 ✓');

// ============================================================
// 5. 软门控：深黑 band + 无声呐 → 瞎；买了声呐 → run 解锁
// ============================================================
L('\n========== 5. 软门控（装备＝钥匙）==========');
assert(s.run!.sensors.sonarUnlocked === false, '5: 新存档没声呐');
assert(lampEffective(s.run!) === false, '5: 黑水灯打不透（lampEffective false）');
assert(clarity(s.run!) === 'none', '5: 黑水 + 无声呐 → clarity none（装备不够就瞎着下）');
const withSonar: GameState = {
  ...base,
  profile: { ...base.profile, unlockedUpgrades: new Set([...base.profile.unlockedUpgrades, 'upgrade.sonar.lv1']) },
};
const s2 = startDiveFromOutpost(withSonar, deep!.id);
assert(s2.run!.sensors.sonarUnlocked === true, '5: 买了声呐 → 蛙跳的 run 解锁（getRunBonuses 直通，软门控的钥匙）');
L('  无声呐瞎着下 / 买声呐解锁 ✓');

// ============================================================
// 6. Phase 0 升级轨直通蛙跳（装备成长进深潜）
// ============================================================
L('\n========== 6. 升级轨直通蛙跳 ==========');
const withBattery: GameState = {
  ...base,
  profile: { ...base.profile, unlockedUpgrades: new Set(['upgrade.dive_kit.lv1']) },
};
const s3 = startDiveFromOutpost(withBattery, deep!.id);
assert(s3.run!.powerMax === POWER_MAX + 20, `6: 蛙跳出潜带 Phase 0 升级轨（电池 ${POWER_MAX}+20）`);
L('  电池升级直接进深潜 run ✓');

// ============================================================
// 7. alertDepthFactor 去掉写死 60：深 band 饱和、不报错
// ============================================================
L('\n========== 7. alertDepthFactor 不封顶坏掉 ==========');
const r = s.run!;
assert(alertDepthFactor({ ...r, currentDepth: ALERT_DEPTH_FULL }) === 1, '7: 满档深度（ALERT_DEPTH_FULL）因子=1');
assert(alertDepthFactor({ ...r, currentDepth: 100 }) === 1, '7: 深 band(>60m) 饱和=1（去掉写死 60、不溢出/报错）');
assert(alertDepthFactor({ ...r, currentDepth: 20 }) === 0, '7: 浅水仍免探测压力（§7.5）');
L('  深 band 警觉因子饱和、浅水免压 ✓');

console.log(log.join('\n'));
console.log('\n✓ 深度 band / 蛙跳下潜回归通过');
