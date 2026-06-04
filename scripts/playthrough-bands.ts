// 深度 band / 蛙跳下潜回归（深水区 Phase 1：可扩展纵向深度轴）。
// 覆盖：
//   1. band 表加载 + order 升序 + getBand 索引
//   2. 存在 >60m 的深 band（去掉 60m 准硬上限）、深 band = 黑水（软门控核心）
//   3. mapgen depthRange 覆盖：band 绝对窗口生成、深度落窗口内、比 zone 自身更深
//   4. startDiveFromOutpost 落 run：zoneId/diveModifier/深度窗口/蛙跳预耗氧
//   5. 软门控：深黑 band + 无声呐 → clarity none（瞎）；买了声呐 → run 解锁（装备＝钥匙）
//   6. Phase 0 升级轨直通蛙跳：powerMax 加成进 run（装备成长直接进深潜）
//   7. alertDepthFactor 去掉写死 60：深 band(>60m) 饱和=1、不报错、浅水仍免压
//   8. band.tags 专属事件池：trench band 抽 twilight/midnight 事件、不泄漏到普通 cave 池
//   9. band 级探测压力倍率（深水区 C）：alertFactor 让 trench_throat > trench_mouth > reef_deep；只乘增益不动消退
//  10. 深渊 band（深水区 B）：>108m 递归更深 + abyssal 专属事件池『永远有比最深更深的』、不泄漏、越深越凶续到最深
//
// 跑法： npx tsx scripts/playthrough-bands.ts

import { createInitialGameState } from '../src/engine/state';
import { getBands, getBand, bandDiveModifier } from '../src/engine/bands';
import { startDiveFromOutpost } from '../src/engine/dive';
import { generateDiveMap } from '../src/engine/mapgen';
import { getZone } from '../src/engine/zones';
import { makeLcg } from '../src/engine/rng';
import {
  clarity,
  lampEffective,
  alertDepthFactor,
  alertDelta,
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

// ============================================================
// 8. band.tags 覆盖：trench band 用专属事件池（twilight/midnight），与借来的 zone 内容隔离
//    （深水区内容期 · 母题『回波对不上』，见 data/events/trench.json）
// ============================================================
L('\n========== 8. band.tags 专属事件池 ==========');
const mouth = getBand('band.trench_mouth')!;
const throat = getBand('band.trench_throat')!;
assert(mouth.tags?.includes('twilight'), '8: trench_mouth 带专属 tags（含 twilight）');
assert(throat.tags?.includes('midnight'), '8: trench_throat 带专属 tags（含 midnight）');
const reefDeepBand = getBand('band.reef_deep')!;
assert(!reefDeepBand.tags, '8: reef_deep 不带 tags（缺省回退 zoneTagsByDepth、行为不变）');

const mouthZone = getZone(mouth.zoneId)!;
// (a) 带 band.tags 生成 → 事件节点抽到 trench 专属事件（plumbing 端到端：bands → dive → mapgen → buildEventPool）
let trenchSeen = 0;
let eventNodes = 0;
for (let seed = 1; seed <= 16; seed++) {
  const m = generateDiveMap({
    zone: mouthZone,
    profileFlags: new Set(),
    rng: makeLcg(seed),
    depthRange: mouth.depthRange,
    bandTags: mouth.tags,
  });
  for (const n of Object.values(m.nodes)) {
    if (n.eventId) {
      eventNodes++;
      if (n.eventId.startsWith('trench.')) trenchSeen++;
    }
  }
}
assert(
  eventNodes > 0 && trenchSeen > 0,
  `8a: band.tags 让 trench 蛙跳下潜抽出专属 trench 事件（实际 ${trenchSeen}/${eventNodes} 事件节点）`,
);

// (b) 不传 bandTags（缺省）→ 回退 tagsForDepth（cave）：trench.* 只挂 twilight/midnight，不泄漏到普通蓝洞池。
//     同时证明：没有 band.tags 时这片深度本是空水道（trench 借蓝洞内容＝占位的旧状态）。
let trenchLeak = 0;
for (let seed = 1; seed <= 16; seed++) {
  const m = generateDiveMap({
    zone: mouthZone,
    profileFlags: new Set(),
    rng: makeLcg(seed),
    depthRange: mouth.depthRange,
  });
  for (const n of Object.values(m.nodes)) if (n.eventId?.startsWith('trench.')) trenchLeak++;
}
assert(
  trenchLeak === 0,
  `8b: 不传 bandTags → trench 专属事件不泄漏到普通（cave）池（实际泄漏 ${trenchLeak}）`,
);
L(`  trench_mouth 带 tags → ${trenchSeen} trench 事件 / 不带 tags → ${trenchLeak} 泄漏 ✓`);

// ============================================================
// 9. band 级探测压力倍率（深水区 C）：深度因子在 60m 饱和后，更深 band 靠 alertFactor 继续「越深越凶」
//    （trench_throat > trench_mouth > reef_deep）；只乘暴露增益、不动消退＝逃生阀门买不断
// ============================================================
L('\n========== 9. band 探测压力倍率（越深越凶）==========');
// (a) 数据：trench 倍率随深度升、reef_deep 缺省（深度因子未饱和的过渡段、不额外加压）
assert((mouth.alertFactor ?? 1) > 1, '9: trench_mouth 有 >1 探测压力倍率');
assert((throat.alertFactor ?? 1) > (mouth.alertFactor ?? 1), '9: trench_throat 比 trench_mouth 更凶');
assert(reefDeepBand.alertFactor === undefined, '9: reef_deep 缺省倍率（=1，45-60m 深度因子未饱和、不额外加压）');

// (b) startDiveFromOutpost 落 run.bandAlertFactor = band.alertFactor（端到端）
const sMouth = startDiveFromOutpost(base, mouth.id);
const sThroat = startDiveFromOutpost(base, throat.id);
assert(sMouth.run!.bandAlertFactor === mouth.alertFactor, '9: 蛙跳 trench_mouth 落 run.bandAlertFactor');
assert(sThroat.run!.bandAlertFactor === throat.alertFactor, '9: 蛙跳 trench_throat 落 run.bandAlertFactor');

// (c) alertDelta 真随倍率放大：同样点灯、同样满档深度（100m，深度因子饱和=1），throat 涨得比 mouth 快、都比无倍率快。
const lit = (factor?: number) => ({ ...sMouth.run!, currentDepth: 100, alert: 0, bandAlertFactor: factor });
const dNone = alertDelta(lit(undefined), 1); // 缺省（POI 下潜 / reef_deep 饱和段）= 旧行为
const dMouth = alertDelta(lit(mouth.alertFactor), 1);
const dThroat = alertDelta(lit(throat.alertFactor), 1);
assert(
  dThroat > dMouth && dMouth > dNone,
  `9: alertDelta 随 band 倍率放大（none ${dNone} < mouth ${dMouth} < throat ${dThroat}）`,
);

// (d) 倍率只乘增益、不动消退：摸黑（关灯关声呐）净消退与倍率无关＝逃生阀门倍率买不断（守无脚本死 §9）。
const dark = (factor?: number) => ({
  ...sMouth.run!,
  currentDepth: 100,
  alert: 50,
  bandAlertFactor: factor,
  sensors: { ...sMouth.run!.sensors, light: false, sonar: 'off' as const },
});
const decayNone = alertDelta(dark(undefined), 1);
const decayThroat = alertDelta(dark(throat.alertFactor), 1);
assert(
  decayNone < 0 && decayNone === decayThroat,
  `9: 摸黑净消退不被倍率放大（逃生阀门：none ${decayNone} === throat ${decayThroat}）`,
);
L(`  数据升序 / 落 run / alertDelta 放大(${dNone}→${dMouth.toFixed(1)}→${dThroat.toFixed(1)}) / 消退买不断(${decayThroat}) ✓`);

// ============================================================
// 10. 深渊 band（深水区 B）：>108m 递归更深 + abyssal 专属事件池『永远有比最深更深的』
//     越深越凶续到深渊（alertFactor > 竖井·喉）；abyssal 事件不泄漏到 trench/cave 池、trench 也不漏进深渊
// ============================================================
L('\n========== 10. 深渊 band + abyssal 内容 ==========');
const abyss = getBand('band.abyssal');
assert(abyss, '10: 存在 band.abyssal');
assert(abyss!.depthRange[0] >= 108, `10: 深渊 >108m（递归更深、不硬编码地板，实际起 ${abyss!.depthRange[0]}m）`);
assert(abyss!.order > throat.order, '10: 深渊 order 在竖井·喉之后（最深一级）');
assert(abyss!.visibility === 'dark', '10: 深渊 = 黑水');
assert(abyss!.tags?.includes('abyssal'), '10: 深渊带 abyssal 专属 tag（既有闲置 ZoneTag、零类型改动）');
// 越深越凶续到深渊：alertFactor 续 §9 的升序（深渊 > 竖井·喉 > 竖井·口）
assert(
  (abyss!.alertFactor ?? 1) > (throat.alertFactor ?? 1),
  '10: 深渊探测压力倍率 > 竖井·喉（越深越凶续到最深一层）',
);

// (a) band.tags 让深渊蛙跳抽出 abyssal 专属事件（端到端 bands→dive→mapgen→buildEventPool）；trench 不漏进来
const abyssZone = getZone(abyss!.zoneId)!;
let abyssSeen = 0, abyssEventNodes = 0, trenchInAbyss = 0;
for (let seed = 1; seed <= 16; seed++) {
  const m = generateDiveMap({
    zone: abyssZone, profileFlags: new Set(), rng: makeLcg(seed),
    depthRange: abyss!.depthRange, bandTags: abyss!.tags,
  });
  for (const n of Object.values(m.nodes)) {
    if (!n.eventId) continue;
    abyssEventNodes++;
    if (n.eventId.startsWith('abyssal.')) abyssSeen++;
    if (n.eventId.startsWith('trench.')) trenchInAbyss++;
  }
}
assert(abyssEventNodes > 0 && abyssSeen > 0, `10a: 深渊蛙跳抽出专属 abyssal 事件（实际 ${abyssSeen}/${abyssEventNodes}）`);
assert(trenchInAbyss === 0, `10a: 竖井(trench)事件不漏进深渊（深度+tag 双隔离，实际 ${trenchInAbyss}）`);

// (b) abyssal 事件不泄漏：不传 bandTags（普通 cave 池）→ 0；trench band（twilight/midnight）→ 0
let abyssLeakCave = 0, abyssLeakTrench = 0;
for (let seed = 1; seed <= 16; seed++) {
  const mc = generateDiveMap({ zone: abyssZone, profileFlags: new Set(), rng: makeLcg(seed), depthRange: abyss!.depthRange });
  for (const n of Object.values(mc.nodes)) if (n.eventId?.startsWith('abyssal.')) abyssLeakCave++;
  const mt = generateDiveMap({ zone: mouthZone, profileFlags: new Set(), rng: makeLcg(seed), depthRange: mouth.depthRange, bandTags: mouth.tags });
  for (const n of Object.values(mt.nodes)) if (n.eventId?.startsWith('abyssal.')) abyssLeakTrench++;
}
assert(abyssLeakCave === 0 && abyssLeakTrench === 0, `10b: abyssal 事件不泄漏到 cave/trench 池（cave ${abyssLeakCave} / trench ${abyssLeakTrench}）`);
L(`  深渊 >108m·dark·倍率 ${abyss!.alertFactor} / 抽出 ${abyssSeen} abyssal 事件 / 泄漏 ${abyssLeakCave}+${abyssLeakTrench} ✓`);

// ============================================================
// 11. 超渊 band（深水区 B）：>140m 再递归更深 + hadal 专属事件池『连更深/上下都不是连续的线』
//     越深越凶续到超渊（alertFactor > 深渊）；hadal 事件不泄漏到 abyssal/cave 池、abyssal 也不漏进超渊
// ============================================================
L('\n========== 11. 超渊 band + hadal 内容 ==========');
const hadal = getBand('band.hadal');
assert(hadal, '11: 存在 band.hadal');
assert(hadal!.depthRange[0] >= 140, `11: 超渊 >140m（架构不硬编码地板、可续写更深，实际起 ${hadal!.depthRange[0]}m）`);
assert(hadal!.order > abyss!.order, '11: 超渊 order 在深渊之后（最深一级）');
assert(hadal!.visibility === 'dark', '11: 超渊 = 黑水');
assert(hadal!.tags?.includes('hadal'), '11: 超渊带 hadal 专属 tag（新增 ZoneTag、无穷尽-switch 破坏）');
assert(
  (hadal!.alertFactor ?? 1) > (abyss!.alertFactor ?? 1),
  '11: 超渊探测压力倍率 > 深渊（越深越凶续到最深一层）',
);

// (a) band.tags 让超渊蛙跳抽出 hadal 专属事件；abyssal 不漏进来
const hadalZone = getZone(hadal!.zoneId)!;
let hadalSeen = 0, hadalEventNodes = 0, abyssInHadal = 0;
for (let seed = 1; seed <= 16; seed++) {
  const m = generateDiveMap({
    zone: hadalZone, profileFlags: new Set(), rng: makeLcg(seed),
    depthRange: hadal!.depthRange, bandTags: hadal!.tags,
  });
  for (const n of Object.values(m.nodes)) {
    if (!n.eventId) continue;
    hadalEventNodes++;
    if (n.eventId.startsWith('hadal.')) hadalSeen++;
    if (n.eventId.startsWith('abyssal.')) abyssInHadal++;
  }
}
assert(hadalEventNodes > 0 && hadalSeen > 0, `11a: 超渊蛙跳抽出专属 hadal 事件（实际 ${hadalSeen}/${hadalEventNodes}）`);
assert(abyssInHadal === 0, `11a: 深渊(abyssal)事件不漏进超渊（深度+tag 双隔离，实际 ${abyssInHadal}）`);

// (b) hadal 事件不泄漏：普通 cave 池 → 0；深渊 band（abyssal tag）→ 0
let hadalLeakCave = 0, hadalLeakAbyss = 0;
for (let seed = 1; seed <= 16; seed++) {
  const mc = generateDiveMap({ zone: hadalZone, profileFlags: new Set(), rng: makeLcg(seed), depthRange: hadal!.depthRange });
  for (const n of Object.values(mc.nodes)) if (n.eventId?.startsWith('hadal.')) hadalLeakCave++;
  const ma = generateDiveMap({ zone: abyssZone, profileFlags: new Set(), rng: makeLcg(seed), depthRange: abyss!.depthRange, bandTags: abyss!.tags });
  for (const n of Object.values(ma.nodes)) if (n.eventId?.startsWith('hadal.')) hadalLeakAbyss++;
}
assert(hadalLeakCave === 0 && hadalLeakAbyss === 0, `11b: hadal 事件不泄漏到 cave/abyssal 池（cave ${hadalLeakCave} / abyssal ${hadalLeakAbyss}）`);
L(`  超渊 >140m·dark·倍率 ${hadal!.alertFactor} / 抽出 ${hadalSeen} hadal 事件 / 泄漏 ${hadalLeakCave}+${hadalLeakAbyss} ✓`);

console.log(log.join('\n'));
console.log('\n✓ 深度 band / 蛙跳下潜回归通过');
