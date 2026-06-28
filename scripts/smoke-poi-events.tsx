// POI 事件集守门：剧情编辑器「POI 走查」依赖的 listPoiEventSets 必须自洽——
//   ① 每个 POI 的 open(openEventId+openEventPool) / story(storyOpenEvents) 引用都解析到真实事件；
//   ② 每个带 poiId 的事件都能归到某 POI 的 scoped（poiId 拼错 = 永不进池 = 软锁·从 POI 侧反向兜 check-event-poi）。
//   ③ 真·POI 下潜派生（Q2）：每个 POI 都能定位下潜路由（zoneId/bandId/caveEntry 解析到真 zone·悬空＝红）；
//   ④ 随机池自洽：randomIds ⊆ EVENT_DB、与钩子（open/story/scoped）不重叠、有效深度区间 d0<d1。
// 跑： ESBUILD_BINARY_PATH=/tmp/package/bin/esbuild npx tsx scripts/smoke-poi-events.tsx
import { listPoiEventSets, poiEventIds, derivePoiRouting, derivePoiDivePool } from '../src/engine/poiEvents';
import { getEventById, EVENT_DB } from '../src/engine/zones';

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    console.error('✗ ' + msg);
    process.exit(1);
  }
}

const sets = listPoiEventSets();
assert(sets.length > 0, '应至少有一个 POI（chart_pois.json 空？）');

// ① open/story 引用完整
let dangling = 0;
for (const s of sets) {
  for (const id of [...s.open, ...s.story]) {
    if (!getEventById(id)) {
      console.error(`  POI ${s.kind}:${s.key} 引用不存在事件 ${id}`);
      dangling++;
    }
  }
}
assert(dangling === 0, `${dangling} 处 POI open/story 引用断链（见上）`);

// ② poiId 专属事件均可归位
const scopedSeen = new Set<string>();
for (const s of sets) for (const id of s.scoped) scopedSeen.add(id);
let orphan = 0;
for (const ev of EVENT_DB.values()) {
  if (ev.poiId && !scopedSeen.has(ev.id)) {
    console.error(`  事件 ${ev.id} 的 poiId="${ev.poiId}" 配不到任何 POI`);
    orphan++;
  }
}
assert(orphan === 0, `${orphan} 个 poiId 事件配不到 POI（拼错？）`);

// ③ 真·POI 下潜路由：每个 POI 都能定位（zoneId 必有·bandId/caveEntry 解析到真 zone）。
let unrouted = 0;
for (const s of sets) {
  const r = derivePoiRouting(s.key);
  if (!r) {
    console.error(`  POI ${s.kind}:${s.key} 定位不到下潜路由（zoneId/bandId/caveEntry 悬空？）`);
    unrouted++;
  } else if (!(r.depthRange[0] < r.depthRange[1])) {
    console.error(`  POI ${s.kind}:${s.key} 有效深度区间非法 ${r.depthRange[0]}–${r.depthRange[1]}`);
    unrouted++;
  }
}
assert(unrouted === 0, `${unrouted} 个 POI 路由/深度区间异常（见上）`);

// ④ 随机池自洽：randomIds 全是真事件、与钩子不重叠。
let badPool = 0;
let poolTotal = 0;
let withPool = 0;
for (const s of sets) {
  const hooks = new Set(poiEventIds(s));
  const { randomIds } = derivePoiDivePool(s.key);
  if (randomIds.length > 0) withPool++;
  poolTotal += randomIds.length;
  for (const id of randomIds) {
    if (!getEventById(id)) {
      console.error(`  POI ${s.key} 随机池含不存在事件 ${id}`);
      badPool++;
    }
    if (hooks.has(id)) {
      console.error(`  POI ${s.key} 随机池与钩子重复 ${id}（应已减去）`);
      badPool++;
    }
  }
}
assert(badPool === 0, `${badPool} 处随机池异常（断链 / 与钩子重叠·见上）`);

const anchors = sets.filter((s) => s.kind === 'anchor').length;
const roaming = sets.filter((s) => s.kind === 'roaming').length;
const withContent = sets.filter((s) => poiEventIds(s).length > 0).length;
console.log(`POI 总数 ${sets.length}（anchor ${anchors} / roaming 机会点 ${roaming}）· 带钩子的 ${withContent} · 带随机池的 ${withPool}（随机池事件次数合计 ${poolTotal}）`);
console.log('✓ smoke-poi-events: 钩子引用完整 + poiId 归位 + 真·下潜路由全部可定位 + 随机池自洽');
