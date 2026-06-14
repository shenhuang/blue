// 深度 band / 深入下潜回归（深水区 Phase 1 + 探深「深度柱」#131：可扩展纵向深度轴）。
// #131 后下潜统一走 startDiveFromPoi(poi.bandId → diveIntoBand)——老「前哨蛙跳」startDiveFromOutpost 已删。
// 深度 band 现有两个来源（bands.ts 合并）：depth_bands.json 手写预留 band（abyssal/hadal/subhadal/nameless）
// + depth_columns.json 各柱每级派生的深度档 band（columnBands·band.<短名>.t<tier>）。
// 覆盖：
//   1. band 表加载 + order 升序 + getBand 索引（含柱派生 band 并表）
//   2. 存在 >60m 的深 band（去掉 60m 准硬上限）、深 band = 黑水（软门控核心）
//   3. mapgen depthRange 覆盖：band 绝对窗口生成、深度落窗口内、比 zone 自身更深
//   4. startDiveFromPoi(bandId) 落 run：zoneId/diveModifier/bandAlertFactor/sonarDeception/huntEnabled + 满氧 turn 0
//   5. 软门控：深黑 band + 无声呐 → clarity none（瞎）；买了声呐 → run 解锁（装备＝钥匙）
//   6. Phase 0 升级轨直通深入下潜：powerMax 加成进 run（装备成长直接进深潜）
//   7. alertDepthFactor 去掉写死 60：深 band(>60m) 饱和=1、不报错、浅水仍免压
//   8. band.tags 专属事件池：trench 柱 band 抽 twilight/midnight 事件、不泄漏到普通 cave 池
//   9. band 级探测压力倍率（深水区 C）：alertFactor 让 trench.t2 > trench.t1；只乘增益不动消退
//  10. 深渊 band（深水区 B·预留）：>108m 递归更深 + abyssal 专属事件池『永远有比最深更深的』、不泄漏、越深越凶续到最深
//  11-13. 超渊/渊外/无名渊预留 band（hadal/subhadal/nameless）同理续到最深
//  14. 柱派生 band 注册表（#131）：columnBands() 数量 + 最深柱档 band.trench.t6 在表、深度窗口正确
//
// 跑法： npx tsx scripts/playthrough-bands.ts

import { createInitialGameState } from '../src/engine/state';
import { getBands, getBand, bandDiveModifier } from '../src/engine/bands';
import { columnBands } from '../src/engine/columns';
import { startDiveFromPoi } from '../src/engine/dive';
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
import type { GameState, ChartPoi, DepthBand } from '../src/types';

const log: string[] = [];
const L = (s: string) => log.push(s);
function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    console.error(log.join('\n'));
    throw new Error('断言失败：' + msg);
  }
}
const depthsOf = (s: GameState) => Object.values(s.run!.map!.nodes).map((n) => n.depth);

// 深入下潜测试夹具（#131）：把一个 band 包成「深度柱深入潜点」inline ChartPoi，走 startDiveFromPoi 的
// bandId 分支（= diveIntoBand）——等价于旧 startDiveFromOutpost(bandId) 的 run 落地路径。
// columnId/depthTier 可选（不设＝纯 bandId 路径·不并宿主灯塔补给设施·与本回归无关）。
function divePoiForBand(band: DepthBand): ChartPoi {
  return {
    id: 'poi.test',
    zoneId: band.zoneId,
    name: band.name,
    blurb: '',
    distance: 1,
    bandId: band.id,
    persistent: true,
  };
}

// ============================================================
// 1. band 表加载 + order 升序 + getBand 索引（含柱派生 band 并表）
// ============================================================
L('========== 1. band 表加载 ==========');
const bands = getBands();
assert(bands.length >= 3, '1: 至少 3 个 band');
// 非递减＝实际排序保证（#131：两个来源合并——多根柱可共享同一顶深 order，如 home.t1 / wreck.t2 都=30；
// 旧「严格递增」只在单条线性梯子下成立，合并注册表下退化为按深度非递减。仍守「越深越后」的全局排序。）
for (let i = 1; i < bands.length; i++) {
  assert(bands[i].order >= bands[i - 1].order, '1: getBands 按 order 非递减升序（越深越后·合并注册表）');
}
assert(getBand(bands[0].id) === bands[0], '1: getBand 命中索引');
assert(getBand('band.does_not_exist') === undefined, '1: 未知 band → undefined');
L(`  ${bands.length} 个 band：${bands.map((b) => `${b.name}[${b.depthRange[0]}-${b.depthRange[1]}]`).join(' → ')} ✓`);

// ============================================================
// 2. 存在 >60m 的深 band（突破旧 60m 准硬上限）+ 深 band = 黑水
// ============================================================
L('\n========== 2. 深 band 突破 60m + 黑水 ==========');
const deep = bands.find((b) => b.depthRange[0] >= 60 && b.visibility === 'dark');
assert(deep, '2: 存在 ≥60m 的深黑 band（去掉 60m 准硬上限、证明不封顶）');
assert(deep!.visibility === 'dark', '2: 深 band = 黑水（软门控：灯打不透 → 被迫用更耗电的声呐）');
assert(bandDiveModifier(deep!).visibility === 'dark', '2: bandDiveModifier 透出 visibility');
L(`  深黑 band「${deep!.name}」${deep!.depthRange[0]}–${deep!.depthRange[1]}m · ${deep!.visibility} ✓`);

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
// 4. startDiveFromPoi(bandId) 落 run（#131：旧 startDiveFromOutpost 同源 run 落地，改走深度柱深入潜点）
// ============================================================
L('\n========== 4. startDiveFromPoi(bandId) 落 run ==========');
const base = createInitialGameState();
// 取一个携带全套 band 旋钮的柱档（trench.t4：dark·alertFactor 1.5·sonarDeception 0.15·hunts true）做端到端落地。
const t4 = getBand('band.trench.t4')!;
const s = startDiveFromPoi(base, divePoiForBand(t4));
assert(s.run, '4: 出潜后有 run');
assert(s.phase.kind === 'dive', '4: 进入 dive phase');
assert(s.run!.zoneId === t4.zoneId, '4: run.zoneId = band.zoneId');
assert(s.run!.diveModifier?.visibility === t4.visibility, '4: run.diveModifier.visibility = band.visibility');
assert(s.run!.bandAlertFactor === (t4.alertFactor ?? 1), `4: run.bandAlertFactor = band.alertFactor（实 ${s.run!.bandAlertFactor}）`);
assert(s.run!.sonarDeception === (t4.sonarDeception ?? 0), `4: run.sonarDeception = band.sonarDeception（实 ${s.run!.sonarDeception}）`);
assert(s.run!.huntEnabled === (t4.hunts ?? false), '4: run.huntEnabled = band.hunts');
const rd = depthsOf(s);
assert(Math.min(...rd) >= t4.depthRange[0] && Math.max(...rd) <= t4.depthRange[1], '4: run.map 深度落在 band 窗口');
assert(s.run!.stats.oxygen === s.run!.oxygenMax, '4: 满氧起手（距离预耗氧已删·作者 2026-06-14）');
assert(s.run!.turn === 0, `4: 从第一回合起算 → turn 0（实 ${s.run!.turn}）`);
L('  zoneId / 黑水 modifier / bandAlertFactor / sonarDeception / huntEnabled / 深度窗口 / 满氧 turn0 ✓');

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
const s2 = startDiveFromPoi(withSonar, divePoiForBand(t4));
assert(s2.run!.sensors.sonarUnlocked === true, '5: 买了声呐 → 深入下潜的 run 解锁（getRunBonuses 直通，软门控的钥匙）');
L('  无声呐瞎着下 / 买声呐解锁 ✓');

// ============================================================
// 6. Phase 0 升级轨直通深入下潜（装备成长进深潜）
// ============================================================
L('\n========== 6. 升级轨直通深入下潜 ==========');
const withBattery: GameState = {
  ...base,
  profile: { ...base.profile, unlockedUpgrades: new Set(['upgrade.dive_kit.lv1']) },
};
const s3 = startDiveFromPoi(withBattery, divePoiForBand(t4));
assert(s3.run!.powerMax === POWER_MAX + 20, `6: 深入下潜带 Phase 0 升级轨（电池 ${POWER_MAX}+20）`);
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
// 8. band.tags 覆盖：trench 柱 band 用专属事件池（twilight/midnight），与借来的 zone 内容隔离
//    （#131：repoint 到 col.trench 派生 band·tags 旋钮逐字承接旧 trench_mouth/throat·见 data/events/trench.json）
// ============================================================
L('\n========== 8. band.tags 专属事件池 ==========');
const tMouth = getBand('band.trench.t1')!; // 竖井·口（60–68）：tags ['cave','twilight']
const tDeep = getBand('band.trench.t4')!; // 竖井·下喉（84–92）：tags ['cave','midnight']
assert(tMouth.tags?.includes('twilight'), '8: trench.t1 带专属 tags（含 twilight）');
assert(tDeep.tags?.includes('midnight'), '8: trench.t4 带专属 tags（含 midnight）');
// 浅柱档（家灯塔礁壁）不带 band 专属 tags → 缺省回退 zoneTagsByDepth、行为不变
const homeTop = getBand('band.home.t1')!;
assert(!homeTop.tags, '8: home.t1 不带 tags（缺省回退 zoneTagsByDepth、行为不变）');

const mouthZone = getZone(tMouth.zoneId)!;
// (a) 带 band.tags 生成 → 事件节点抽到 trench 专属事件（plumbing 端到端：bands → dive → mapgen → buildEventPool）
let trenchSeen = 0;
let eventNodes = 0;
for (let seed = 1; seed <= 16; seed++) {
  const m = generateDiveMap({
    zone: mouthZone,
    profileFlags: new Set(),
    rng: makeLcg(seed),
    depthRange: tMouth.depthRange,
    bandTags: tMouth.tags,
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
  `8a: band.tags 让 trench 深入下潜抽出专属 trench 事件（实际 ${trenchSeen}/${eventNodes} 事件节点）`,
);

// (b) 不传 bandTags（缺省）→ 回退 tagsForDepth（cave）：trench.* 只挂 twilight/midnight，不泄漏到普通蓝洞池。
//     同时证明：没有 band.tags 时这片深度本是空水道（trench 借蓝洞内容＝占位的旧状态）。
let trenchLeak = 0;
for (let seed = 1; seed <= 16; seed++) {
  const m = generateDiveMap({
    zone: mouthZone,
    profileFlags: new Set(),
    rng: makeLcg(seed),
    depthRange: tMouth.depthRange,
  });
  for (const n of Object.values(m.nodes)) if (n.eventId?.startsWith('trench.')) trenchLeak++;
}
assert(
  trenchLeak === 0,
  `8b: 不传 bandTags → trench 专属事件不泄漏到普通（cave）池（实际泄漏 ${trenchLeak}）`,
);
L(`  trench.t1 带 tags → ${trenchSeen} trench 事件 / 不带 tags → ${trenchLeak} 泄漏 ✓`);

// ============================================================
// 9. band 级探测压力倍率（深水区 C）：深度因子在 60m 饱和后，更深 band 靠 alertFactor 继续「越深越凶」
//    （#131：repoint 到 col.trench 派生 band——trench.t2 > trench.t1）；只乘暴露增益、不动消退＝逃生阀门买不断
// ============================================================
L('\n========== 9. band 探测压力倍率（越深越凶）==========');
// (a) 数据：trench 柱档倍率随深度升、浅柱档（家灯塔上槽）缺省（深度因子未饱和的过渡段、不额外加压）
const tT1 = getBand('band.trench.t1')!; // alertFactor 1.2
const tT2 = getBand('band.trench.t2')!; // alertFactor 1.3
assert((tT1.alertFactor ?? 1) > 1, '9: trench.t1 有 >1 探测压力倍率');
assert((tT2.alertFactor ?? 1) > (tT1.alertFactor ?? 1), '9: trench.t2 比 trench.t1 更凶（越深越凶）');
assert(homeTop.alertFactor === undefined, '9: home.t1 缺省倍率（=1，30-45m 深度因子未饱和、不额外加压）');

// (b) startDiveFromPoi(bandId) 落 run.bandAlertFactor = band.alertFactor（端到端）
const sT1 = startDiveFromPoi(base, divePoiForBand(tT1));
const sT2 = startDiveFromPoi(base, divePoiForBand(tT2));
assert(sT1.run!.bandAlertFactor === tT1.alertFactor, '9: 深入下潜 trench.t1 落 run.bandAlertFactor');
assert(sT2.run!.bandAlertFactor === tT2.alertFactor, '9: 深入下潜 trench.t2 落 run.bandAlertFactor');

// (c) alertDelta 真随倍率放大：同样点灯、同样满档深度（100m，深度因子饱和=1），t2 涨得比 t1 快、都比无倍率快。
const lit = (factor?: number) => ({ ...sT1.run!, currentDepth: 100, alert: 0, bandAlertFactor: factor ?? 1 }); // 必填化（#107）：canonical 默认 1
const dNone = alertDelta(lit(undefined), 1); // 无倍率（缺省柱档 / 浅段饱和）= 旧行为
const dT1 = alertDelta(lit(tT1.alertFactor), 1);
const dT2 = alertDelta(lit(tT2.alertFactor), 1);
assert(
  dT2 > dT1 && dT1 > dNone,
  `9: alertDelta 随 band 倍率放大（none ${dNone} < t1 ${dT1} < t2 ${dT2}）`,
);

// (d) 倍率只乘增益、不动消退：摸黑（关灯关声呐）净消退与倍率无关＝逃生阀门倍率买不断（守无脚本死 §9）。
const dark = (factor?: number) => ({
  ...sT1.run!,
  currentDepth: 100,
  alert: 50,
  bandAlertFactor: factor ?? 1, // 必填化（#107）：canonical 默认 1
  sensors: { ...sT1.run!.sensors, light: false, sonar: 'off' as const },
});
const decayNone = alertDelta(dark(undefined), 1);
const decayT2 = alertDelta(dark(tT2.alertFactor), 1);
assert(
  decayNone < 0 && decayNone === decayT2,
  `9: 摸黑净消退不被倍率放大（逃生阀门：none ${decayNone} === t2 ${decayT2}）`,
);
L(`  数据升序 / 落 run / alertDelta 放大(${dNone}→${dT1.toFixed(1)}→${dT2.toFixed(1)}) / 消退买不断(${decayT2}) ✓`);

// ============================================================
// 10. 深渊 band（深水区 B·预留）：>108m 递归更深 + abyssal 专属事件池『永远有比最深更深的』
//     越深越凶续到深渊（alertFactor > 竖井柱最深档）；abyssal 事件不泄漏到 trench/cave 池、trench 也不漏进深渊
// ============================================================
L('\n========== 10. 深渊 band + abyssal 内容 ==========');
const trenchBottom = getBand('band.trench.t6')!; // 竖井·见底（100–108·alertFactor 1.8）＝柱最深档
const abyss = getBand('band.abyssal');
assert(abyss, '10: 存在 band.abyssal');
assert(abyss!.depthRange[0] >= 108, `10: 深渊 >108m（递归更深、不硬编码地板，实际起 ${abyss!.depthRange[0]}m）`);
assert(abyss!.order > trenchBottom.order, '10: 深渊 order 在竖井柱最深档之后（最深一级·衔接 t6 order=100 → abyssal 108）');
assert(abyss!.visibility === 'dark', '10: 深渊 = 黑水');
assert(abyss!.tags?.includes('abyssal'), '10: 深渊带 abyssal 专属 tag（既有闲置 ZoneTag、零类型改动）');
// 越深越凶续到深渊：alertFactor 续 §9 的升序（深渊 > 竖井柱最深档）
assert(
  (abyss!.alertFactor ?? 1) > (trenchBottom.alertFactor ?? 1),
  '10: 深渊探测压力倍率 > 竖井柱最深档（越深越凶续到最深一层）',
);
// 端到端：startDiveFromPoi(band.abyssal) 落 run（满氧 turn0 + diveModifier + bandAlertFactor）
const sAby = startDiveFromPoi(base, divePoiForBand(abyss!));
assert(sAby.run!.zoneId === abyss!.zoneId, '10: 深渊深入下潜 run.zoneId = band.zoneId');
assert(sAby.run!.diveModifier?.visibility === 'dark', '10: 深渊深入下潜 run 黑水 modifier');
assert(sAby.run!.bandAlertFactor === abyss!.alertFactor, '10: 深渊深入下潜落 run.bandAlertFactor');
assert(sAby.run!.turn === 0 && sAby.run!.stats.oxygen === sAby.run!.oxygenMax, '10: 深渊深入下潜满氧 turn0');

// (a) band.tags 让深渊深入下潜抽出 abyssal 专属事件（端到端 bands→dive→mapgen→buildEventPool）；trench 不漏进来
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
assert(abyssEventNodes > 0 && abyssSeen > 0, `10a: 深渊深入下潜抽出专属 abyssal 事件（实际 ${abyssSeen}/${abyssEventNodes}）`);
assert(trenchInAbyss === 0, `10a: 竖井(trench)事件不漏进深渊（深度+tag 双隔离，实际 ${trenchInAbyss}）`);

// (b) abyssal 事件不泄漏：不传 bandTags（普通 cave 池）→ 0；trench band（twilight/midnight）→ 0
let abyssLeakCave = 0, abyssLeakTrench = 0;
for (let seed = 1; seed <= 16; seed++) {
  const mc = generateDiveMap({ zone: abyssZone, profileFlags: new Set(), rng: makeLcg(seed), depthRange: abyss!.depthRange });
  for (const n of Object.values(mc.nodes)) if (n.eventId?.startsWith('abyssal.')) abyssLeakCave++;
  const mt = generateDiveMap({ zone: mouthZone, profileFlags: new Set(), rng: makeLcg(seed), depthRange: tMouth.depthRange, bandTags: tMouth.tags });
  for (const n of Object.values(mt.nodes)) if (n.eventId?.startsWith('abyssal.')) abyssLeakTrench++;
}
assert(abyssLeakCave === 0 && abyssLeakTrench === 0, `10b: abyssal 事件不泄漏到 cave/trench 池（cave ${abyssLeakCave} / trench ${abyssLeakTrench}）`);
L(`  深渊 >108m·dark·倍率 ${abyss!.alertFactor} / 抽出 ${abyssSeen} abyssal 事件 / 泄漏 ${abyssLeakCave}+${abyssLeakTrench} ✓`);

// ============================================================
// 11. 超渊 band（深水区 B·预留）：>140m 再递归更深 + hadal 专属事件池『连更深/上下都不是连续的线』
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

// (a) band.tags 让超渊深入下潜抽出 hadal 专属事件；abyssal 不漏进来
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
assert(hadalEventNodes > 0 && hadalSeen > 0, `11a: 超渊深入下潜抽出专属 hadal 事件（实际 ${hadalSeen}/${hadalEventNodes}）`);
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

// ============================================================
// 12. 渊外 band（深水区内容·方向 C·预留）：>180m 再递归更深 + subhadal 专属事件池『过了最后一个有名字的深度，它不再骗你·只给你下去的理由』
//     越深越凶续到渊外（alertFactor > 超渊）；subhadal 事件不泄漏到 hadal/cave 池、hadal 也不漏进渊外
// ============================================================
L('\n========== 12. 渊外 band + subhadal 内容 ==========');
const subhadal = getBand('band.subhadal');
assert(subhadal, '12: 存在 band.subhadal');
assert(
  subhadal!.depthRange[0] >= 180,
  `12: 渊外 >180m（架构不硬编码地板、可续写更深，实际起 ${subhadal!.depthRange[0]}m）`,
);
assert(subhadal!.order > hadal!.order, '12: 渊外 order 在超渊之后（最深一级）');
assert(subhadal!.visibility === 'dark', '12: 渊外 = 黑水');
assert(subhadal!.tags?.includes('subhadal'), '12: 渊外带 subhadal 专属 tag（新增 ZoneTag、无穷尽-switch 破坏）');
assert(
  (subhadal!.alertFactor ?? 1) > (hadal!.alertFactor ?? 1),
  '12: 渊外探测压力倍率 > 超渊（越深越凶续到最深一层）',
);

// (a) band.tags 让渊外深入下潜抽出 subhadal 专属事件；hadal 不漏进来
const subZone = getZone(subhadal!.zoneId)!;
let subSeen = 0,
  subEventNodes = 0,
  hadalInSub = 0;
for (let seed = 1; seed <= 16; seed++) {
  const m = generateDiveMap({
    zone: subZone,
    profileFlags: new Set(),
    rng: makeLcg(seed),
    depthRange: subhadal!.depthRange,
    bandTags: subhadal!.tags,
  });
  for (const n of Object.values(m.nodes)) {
    if (!n.eventId) continue;
    subEventNodes++;
    if (n.eventId.startsWith('subhadal.')) subSeen++;
    if (n.eventId.startsWith('hadal.')) hadalInSub++;
  }
}
assert(subEventNodes > 0 && subSeen > 0, `12a: 渊外深入下潜抽出专属 subhadal 事件（实际 ${subSeen}/${subEventNodes}）`);
assert(hadalInSub === 0, `12a: 超渊(hadal)事件不漏进渊外（深度+tag 双隔离，实际 ${hadalInSub}）`);

// (b) subhadal 事件不泄漏：普通 cave 池 → 0；超渊 band（hadal tag）→ 0
let subLeakCave = 0,
  subLeakHadal = 0;
for (let seed = 1; seed <= 16; seed++) {
  const mc = generateDiveMap({ zone: subZone, profileFlags: new Set(), rng: makeLcg(seed), depthRange: subhadal!.depthRange });
  for (const n of Object.values(mc.nodes)) if (n.eventId?.startsWith('subhadal.')) subLeakCave++;
  const mh = generateDiveMap({ zone: hadalZone, profileFlags: new Set(), rng: makeLcg(seed), depthRange: hadal!.depthRange, bandTags: hadal!.tags });
  for (const n of Object.values(mh.nodes)) if (n.eventId?.startsWith('subhadal.')) subLeakHadal++;
}
assert(subLeakCave === 0 && subLeakHadal === 0, `12b: subhadal 事件不泄漏到 cave/hadal 池（cave ${subLeakCave} / hadal ${subLeakHadal}）`);
L(`  渊外 >180m·dark·倍率 ${subhadal!.alertFactor} / 抽出 ${subSeen} subhadal 事件 / 泄漏 ${subLeakCave}+${subLeakHadal} ✓`);

// ============================================================
// 13. 无名渊 band（深水区内容·最深一层·预留）：>230m 再递归更深 + nameless 专属事件池『过了诱饵，连你和它的界限也没了——往下的那个已经是你』
//     越深越凶续到无名渊（alertFactor > 渊外）；nameless 事件不泄漏到 subhadal/cave 池、subhadal 也不漏进无名渊
// ============================================================
L('\n========== 13. 无名渊 band + nameless 内容 ==========');
const nameless = getBand('band.nameless');
assert(nameless, '13: 存在 band.nameless');
assert(
  nameless!.depthRange[0] >= 230,
  `13: 无名渊 >230m（架构不硬编码地板、可续写更深，实际起 ${nameless!.depthRange[0]}m）`,
);
assert(nameless!.order > subhadal!.order, '13: 无名渊 order 在渊外之后（最深一级）');
assert(nameless!.visibility === 'dark', '13: 无名渊 = 黑水');
assert(nameless!.tags?.includes('nameless'), '13: 无名渊带 nameless 专属 tag（新增 ZoneTag、无穷尽-switch 破坏）');
assert(
  (nameless!.alertFactor ?? 1) > (subhadal!.alertFactor ?? 1),
  '13: 无名渊探测压力倍率 > 渊外（越深越凶续到最深一层）',
);

// (a) band.tags 让无名渊深入下潜抽出 nameless 专属事件；subhadal 不漏进来
const namelessZone = getZone(nameless!.zoneId)!;
let nmSeen = 0,
  nmEventNodes = 0,
  subInNm = 0;
for (let seed = 1; seed <= 16; seed++) {
  const m = generateDiveMap({
    zone: namelessZone,
    profileFlags: new Set(),
    rng: makeLcg(seed),
    depthRange: nameless!.depthRange,
    bandTags: nameless!.tags,
  });
  for (const n of Object.values(m.nodes)) {
    if (!n.eventId) continue;
    nmEventNodes++;
    if (n.eventId.startsWith('nameless.')) nmSeen++;
    if (n.eventId.startsWith('subhadal.')) subInNm++;
  }
}
assert(nmEventNodes > 0 && nmSeen > 0, `13a: 无名渊深入下潜抽出专属 nameless 事件（实际 ${nmSeen}/${nmEventNodes}）`);
assert(subInNm === 0, `13a: 渊外(subhadal)事件不漏进无名渊（深度+tag 双隔离，实际 ${subInNm}）`);

// (b) nameless 事件不泄漏：普通 cave 池 → 0；渊外 band（subhadal tag）→ 0
let nmLeakCave = 0,
  nmLeakSub = 0;
for (let seed = 1; seed <= 16; seed++) {
  const mc = generateDiveMap({ zone: namelessZone, profileFlags: new Set(), rng: makeLcg(seed), depthRange: nameless!.depthRange });
  for (const n of Object.values(mc.nodes)) if (n.eventId?.startsWith('nameless.')) nmLeakCave++;
  const ms = generateDiveMap({ zone: subZone, profileFlags: new Set(), rng: makeLcg(seed), depthRange: subhadal!.depthRange, bandTags: subhadal!.tags });
  for (const n of Object.values(ms.nodes)) if (n.eventId?.startsWith('nameless.')) nmLeakSub++;
}
assert(nmLeakCave === 0 && nmLeakSub === 0, `13b: nameless 事件不泄漏到 cave/subhadal 池（cave ${nmLeakCave} / subhadal ${nmLeakSub}）`);
L(`  无名渊 >230m·dark·倍率 ${nameless!.alertFactor} / 抽出 ${nmSeen} nameless 事件 / 泄漏 ${nmLeakCave}+${nmLeakSub} ✓`);

// ============================================================
// 14. 柱派生 band 注册表（#131）：columnBands() 把 depth_columns.json 各柱每级派生成 band 并进 bands.ts。
//     home(2)+wreck(3)+midwater(4)+vent(4)+trench(6) = 19 档；最深柱档 band.trench.t6 在表、深度窗口正确。
// ============================================================
L('\n========== 14. 柱派生 band 注册表（#131）==========');
const colBands = columnBands();
assert(colBands.length === 19, `14: columnBands() = 19（home2+wreck3+midwater4+vent4+trench6），实际 ${colBands.length}`);
// 每个柱派生 band 都进了合并注册表（getBand 命中·按 id + 关键旋钮等价；不查对象 identity——
// bands.ts 在加载时调一次 columnBands() 建索引，这里再调一次是各自的新对象、结构等价即证明并表正确）。
for (const cb of colBands) {
  const reg = getBand(cb.id);
  assert(reg, `14: 柱派生 band ${cb.id} 并进 bands.ts 注册表（getBand 命中）`);
  assert(
    reg!.zoneId === cb.zoneId &&
      reg!.depthRange[0] === cb.depthRange[0] &&
      reg!.depthRange[1] === cb.depthRange[1] &&
      reg!.order === cb.order &&
      reg!.visibility === cb.visibility &&
      (reg!.alertFactor ?? 1) === (cb.alertFactor ?? 1),
    `14: 注册表里的 ${cb.id} 与 columnBands() 派生一致（zone/窗口/order/visibility/alertFactor）`,
  );
}
const t6 = getBand('band.trench.t6');
assert(t6, '14: 最深柱档 band.trench.t6 在注册表');
assert(
  t6!.depthRange[0] === 100 && t6!.depthRange[1] === 108,
  `14: band.trench.t6 深度窗口 [100,108]（竖井·见底），实际 [${t6!.depthRange}]`,
);
// 柱 band 的 order＝顶深（与预留 band 深度顺序衔接：t6 order=100 → abyssal 108）
assert(t6!.order === t6!.depthRange[0], `14: 柱 band order=顶深（${t6!.order}=${t6!.depthRange[0]}）`);
L(`  columnBands()=${colBands.length} 档全并表 / band.trench.t6 [${t6!.depthRange}] order ${t6!.order} ✓`);

console.log(log.join('\n'));
console.log('\n✓ 深度 band / 深入下潜回归通过');
