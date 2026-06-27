// POI 事件集守门：剧情编辑器「POI 走查」依赖的 listPoiEventSets 必须自洽——
//   ① 每个 POI 的 open(openEventId+openEventPool) / story(storyOpenEvents) 引用都解析到真实事件；
//   ② 每个带 poiId 的事件都能归到某 POI 的 scoped（poiId 拼错 = 永不进池 = 软锁·从 POI 侧反向兜 check-event-poi）。
// 跑： ESBUILD_BINARY_PATH=/tmp/package/bin/esbuild npx tsx scripts/smoke-poi-events.tsx
import { listPoiEventSets, poiEventIds } from '../src/engine/poiEvents';
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

const anchors = sets.filter((s) => s.kind === 'anchor').length;
const roaming = sets.filter((s) => s.kind === 'roaming').length;
const withContent = sets.filter((s) => poiEventIds(s).length > 0).length;
console.log(`POI 总数 ${sets.length}（anchor ${anchors} / roaming 机会点 ${roaming}）· 带事件集的 ${withContent}`);
console.log('✓ smoke-poi-events: POI open/story 引用完整 + poiId 专属事件均可归位');
