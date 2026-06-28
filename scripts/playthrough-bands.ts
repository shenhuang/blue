// 深度 band / 深入下潜回归（深水区 Phase 1 + 探深「深度柱」#131·§10 定案）。
// #131 后下潜统一走 startDiveFromPoi(poi.bandId → diveIntoBand)——老「前哨蛙跳」startDiveFromOutpost 已删。
// #131 §10 收尾后**所有深度 band 均由 depth_columns.json 各柱每级派生**（columnBands·band.<短名>.t<tier>·并进 bands.ts）；
// depth_bands.json 现为空表——原 abyssal/hadal/subhadal/nameless 预留 band 已删（SPEC §10·旧测试内容·『另一个世界』留 Phase 3）。
// 覆盖：
//   1. band 表加载 + order 升序 + getBand 索引（柱派生 band 并表）
//   2. 存在 >60m 的深 band（去掉 60m 准硬上限）、深 band = 黑水（软门控核心）
//   3. mapgen depthRange 覆盖：band 绝对窗口生成、深度落窗口内、比 zone 自身更深
//   4. startDiveFromPoi(bandId) 落 run：zoneId/diveModifier/bandAlertFactor/sonarDeception/huntEnabled + 满氧 turn 0
//   5. 软门控：深黑 band + 无声呐 → clarity none（瞎）；买了声呐 → run 解锁（装备＝钥匙）
//   6. Phase 0 升级轨直通深入下潜：powerMax 加成进 run（装备成长直接进深潜）
//   7. alertDepthFactor 去掉写死 60：深 band(>60m) 饱和=1、不报错、浅水仍免压
//   8. band.tags 专属事件池：trench 柱 band 抽 twilight/midnight 事件、不泄漏到普通 cave 池
//   9. band 级探测压力倍率：alertFactor 让 trench.t2 > trench.t1；只乘增益不动消退
//  14. 柱派生 band 注册表（#131·§10）：columnBands() 数量(19) + 海沟 t4 电梯 capstone band 在表、深度窗口正确
//
// 跑法： npx tsx scripts/playthrough-bands.ts

import { createInitialGameState, createStarterLoadout } from '../src/engine/state';
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
  SONAR_PING_COST,
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
// 1. band 表加载 + order 升序 + getBand 索引(含柱派生 band 并表)
// ============================================================
L('========== 1. band 表加载 ==========');
const bands = getBands();
assert(bands.length >= 3, '1: 至少 3 个 band');
// 非递减＝实际排序保证（#131：band 全来自柱派生·多根柱可共享同一顶深 order，如 home.t1 / midwater.t1 都=30；
// 退化为按深度非递减。仍守「越深越后」的全局排序。）
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
// 找一个深度超出宿主 zone 上限的 band 来验证 depthRange 覆盖（trench.t2+ 均超出 vent_trench[85,118]）。
const deepOverride = bands.find((b) => {
  const z = getZone(b.zoneId);
  return z != null && b.depthRange[1] > z.depthRange[1];
});
assert(deepOverride, '3: 存在 band.depthRange[1] 超出宿主 zone.depthRange[1] 的深柱档（depthRange 覆盖有意义）');
const zone = getZone(deepOverride!.zoneId)!;
const map = generateDiveMap({ zone, profileFlags: new Set(), depthRange: deepOverride!.depthRange });
const md = Object.values(map.nodes).map((n) => n.depth);
const lo = Math.min(...md), hi = Math.max(...md);
assert(lo >= deepOverride!.depthRange[0] && hi <= deepOverride!.depthRange[1], `3: 深度落在 band 窗口 [${deepOverride!.depthRange}]，实际 [${lo},${hi}]`);
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
// 取一个携带全套 band 旋钮的深柱档做端到端落地：trench.t3（竖井·深段 180–270·dark·alertFactor 1.4·
// sonarDeception 0.15·hunts true）。（trench.t4 已改科考站电梯 capstone·非「全旋钮」普通 band。）
const deepBand = getBand('band.trench.t3')!;
const s = startDiveFromPoi(base, divePoiForBand(deepBand));
assert(s.run, '4: 出潜后有 run');
assert(s.phase.kind === 'dive', '4: 进入 dive phase');
assert(s.run!.zoneId === deepBand.zoneId, '4: run.zoneId = band.zoneId');
assert(s.run!.diveModifier?.visibility === deepBand.visibility, '4: run.diveModifier.visibility = band.visibility');
assert(s.run!.bandAlertFactor === (deepBand.alertFactor ?? 1), `4: run.bandAlertFactor = band.alertFactor（实 ${s.run!.bandAlertFactor}）`);
assert(s.run!.sonarDeception === (deepBand.sonarDeception ?? 0), `4: run.sonarDeception = band.sonarDeception（实 ${s.run!.sonarDeception}）`);
assert(s.run!.huntEnabled === (deepBand.hunts ?? false), '4: run.huntEnabled = band.hunts');
const rd = depthsOf(s);
assert(Math.min(...rd) >= deepBand.depthRange[0] && Math.max(...rd) <= deepBand.depthRange[1], '4: run.map 深度落在 band 窗口');
assert(s.run!.stats.oxygen === s.run!.oxygenMax, '4: 满氧起手（距离预耗氧已删·作者 2026-06-14）');
assert(s.run!.turn === 0, `4: 从第一回合起算 → turn 0（实 ${s.run!.turn}）`);
L('  zoneId / 黑水 modifier / bandAlertFactor / sonarDeception / huntEnabled / 深度窗口 / 满氧 turn0 ✓');

// ============================================================
// 5. 软门控：深黑 band + 无声呐 → 瞎；装上声呐件 → run 解锁
// ============================================================
L('\n========== 5. 软门控（装备＝钥匙）==========');
assert(s.run!.sensors.sonarUnlocked === false, '5: 新存档没声呐');
assert(lampEffective(s.run!) === false, '5: 黑水灯打不透（lampEffective false）');
assert(clarity(s.run!) === 'none', '5: 黑水 + 无声呐 → clarity none（装备不够就瞎着下）');
// 段2：声呐＝Otto 打造的装备件——装上 item.sonar.handheld（hasSonarEquipped）即解锁，不再走 upgrade.sonar.lv1。
const withSonar: GameState = {
  ...base,
  profile: {
    ...base.profile,
    equipment: { ...(base.profile.equipment ?? createStarterLoadout()), sonar: { itemId: 'item.sonar.handheld', slot: 'sonar', level: 1 } },
  },
};
const s2 = startDiveFromPoi(withSonar, divePoiForBand(deepBand));
assert(s2.run!.sensors.sonarUnlocked === true, '5: 装上声呐件 → 深入下潜的 run 解锁（getRunBonuses 直通·hasSonarEquipped·软门控的钥匙）');
L('  无声呐瞎着下 / 装声呐件解锁 ✓');

// ============================================================
// 6. 装备成长直通深入下潜（升级增量进 run·dive_kit 电池线已退役→改用声呐件示范）
// ============================================================
L('\n========== 6. 装备成长直通深入下潜 ==========');
const withSonarLv2: GameState = {
  ...base,
  profile: {
    ...base.profile,
    equipment: { ...(base.profile.equipment ?? createStarterLoadout()), sonar: { itemId: 'item.sonar.handheld', slot: 'sonar', level: 2 } },
  },
};
const s3 = startDiveFromPoi(withSonarLv2, divePoiForBand(deepBand));
assert(s3.run!.sensorTuning.pingCost === SONAR_PING_COST - 2, `6: 声呐件 Lv.2（ping 省2）升级增量直通深入下潜 run（${SONAR_PING_COST}-2）`);
L('  声呐件升级增量直接进深潜 run ✓');

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
//    （#131：trench 柱 band·tags 旋钮承接旧 trench_mouth/throat·见 data/events/trench.json）
// ============================================================
L('\n========== 8. band.tags 专属事件池 ==========');
const tMouth = getBand('band.trench.t1')!; // 竖井·口（60–90）：tags ['cave','twilight']
const tDeep = getBand('band.trench.t2')!; // 竖井·喉（90–180）：tags ['cave','midnight']
assert(tMouth.tags?.includes('twilight'), '8: trench.t1 带专属 tags（含 twilight）');
assert(tDeep.tags?.includes('midnight'), '8: trench.t2 带专属 tags（含 midnight）');
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
//    （#131：trench.t2 > trench.t1）；只乘暴露增益、不动消退＝逃生阀门买不断
// ============================================================
L('\n========== 9. band 探测压力倍率（越深越凶）==========');
// (a) 数据：trench 柱档倍率随深度升、浅柱档（家灯塔上槽）缺省（深度因子未饱和的过渡段、不额外加压）
const tT1 = getBand('band.trench.t1')!; // alertFactor 1.2
const tT2 = getBand('band.trench.t2')!; // alertFactor 1.3
assert((tT1.alertFactor ?? 1) > 1, '9: trench.t1 有 >1 探测压力倍率');
assert((tT2.alertFactor ?? 1) > (tT1.alertFactor ?? 1), '9: trench.t2 比 trench.t1 更凶（越深越凶）');
assert(homeTop.alertFactor === undefined, '9: home.t1 缺省倍率（=1，30-40m 深度因子未饱和、不额外加压）');

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
// 14. 柱派生 band 注册表（#131·§10 + 主线柱迁移）：columnBands() 把 depth_columns.json 各柱派生成 band 并进 bands.ts。
//     刷怪档 home(2)+wreck(3)+midwater(6)+vent(4)+trench(4) = 19 + 主线 story beat band（home/wreck/midwater/vent
//     各一·band.<短名>.story）4 = 共 23；海沟 t4 电梯 capstone band 在表、深度窗口正确。
// ============================================================
L('\n========== 14. 柱派生 band 注册表（#131·§10 + 主线柱迁移）==========');
const colBands = columnBands();
assert(colBands.length === 23, `14: columnBands() = 23（刷怪 19 + 主线 story 4），实际 ${colBands.length}`);
// 每个柱派生 band 都进了合并注册表（getBand 命中·按 id + 关键旋钮等价；不查对象 identity——
// bands.ts 加载时调一次 columnBands() 建索引，这里再调一次是各自的新对象、结构等价即证明并表正确）。
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
const capBand = getBand('band.trench.t4');
assert(capBand, '14: 海沟 t4 电梯 capstone band 在注册表');
assert(
  capBand!.depthRange[0] === 270 && capBand!.depthRange[1] === 310,
  `14: band.trench.t4 深度窗口 [270,310]（科考站电梯入口·实际可达），实际 [${capBand!.depthRange}]`,
);
// 柱 band 的 order＝顶深
assert(capBand!.order === capBand!.depthRange[0], `14: 柱 band order=顶深（${capBand!.order}=${capBand!.depthRange[0]}）`);
L(`  columnBands()=${colBands.length} 档全并表 / band.trench.t4 [${capBand!.depthRange}] order ${capBand!.order} ✓`);

console.log(log.join('\n'));
console.log('\n✓ 深度 band / 深入下潜回归通过');
