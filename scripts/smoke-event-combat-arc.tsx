// 战斗续接图诊断 + 守门：事件选项 triggerCombatId → 战斗 encounter 的 victoryEventId（战斗胜利后回流的
// 事件）这条「续接」是否进了 eventArc / eventRoots 的剧情图。没进 ⇒ 弧树断在战斗处、victoryEventId 被误判成弧头。
// 跑： ESBUILD_BINARY_PATH=/tmp/package/bin/esbuild npx tsx scripts/smoke-event-combat-arc.tsx
import { EVENT_DB, getEventById } from '../src/engine/zones';
import { getEncounter } from '../src/engine/combat';
import { eventArc, eventRoots } from '../src/engine/eventGraph';

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    console.error('✗ ' + msg);
    process.exit(1);
  }
}

type Hit = { from: string; via: string; combatId: string; victoryEventId?: string };

// 一个事件所有「会触发战斗」的出口（onEnter / option.outcome / 检定成败）。
function combatOutcomes(evId: string): { via: string; combatId: string }[] {
  const ev = getEventById(evId);
  if (!ev) return [];
  const out: { via: string; combatId: string }[] = [];
  const take = (via: string, o?: { triggerCombatId?: string }) => {
    if (o?.triggerCombatId) out.push({ via, combatId: o.triggerCombatId });
  };
  take('(onEnter)', ev.onEnter);
  for (const opt of ev.options) {
    take(opt.id, opt.outcome);
    if (opt.check) {
      take(`${opt.id}·成功`, opt.check.onSuccess);
      take(`${opt.id}·失败`, opt.check.onFailure);
    }
  }
  return out;
}

const hits: Hit[] = [];
for (const ev of EVENT_DB.values()) {
  for (const c of combatOutcomes(ev.id)) {
    const enc = getEncounter(c.combatId);
    hits.push({ from: ev.id, via: c.via, combatId: c.combatId, victoryEventId: enc?.victoryEventId });
  }
}

const withVic = hits.filter((h) => h.victoryEventId && getEventById(h.victoryEventId!));
console.log(`\n触发战斗的事件出口：${hits.length} 处；其中战斗带 victoryEventId（胜利后接剧情）：${withVic.length} 处`);
for (const h of withVic) {
  console.log(`  ${h.from} —[${h.via}]→ ${h.combatId} →胜利→ ${h.victoryEventId} (${getEventById(h.victoryEventId!)?.title ?? '?'})`);
}

// ① 这些 victoryEventId 是否仍被误判成「弧头」？（修好后应为 0）
const roots = new Set(eventRoots());
const falseRoots = [...new Set(withVic.map((h) => h.victoryEventId!))].filter((id) => roots.has(id));
console.log(`\n战斗胜利事件被误判成「弧头」的：${falseRoots.length} 个${falseRoots.length ? ' → ' + falseRoots.join('、') : ''}`);

// ② eventArc 是否跟过战斗、把 victoryEventId 纳入弧？逐条查
const broken = withVic.filter((h) => {
  const arc = eventArc(h.from);
  return !arc?.nodes.some((n) => n.id === h.victoryEventId);
});
console.log(`eventArc 仍断在战斗处（弧里没有 victoryEventId）的：${broken.length} 处${broken.length ? ' → ' + broken.map((b) => `${b.from}→${b.victoryEventId}`).join('、') : ''}`);

assert(withVic.length > 0, '应至少有一处「战斗带 victoryEventId」可测（数据缺失？）');
assert(falseRoots.length === 0, `${falseRoots.length} 个战斗胜利事件被误判成弧头（应 0）——eventGraph 没建 triggerCombatId→victoryEventId 续接边`);
assert(broken.length === 0, `${broken.length} 处 eventArc 断在战斗处（victoryEventId 未纳入弧）——同上`);
console.log('\n✓ smoke-event-combat-arc: 战斗胜利续接已进剧情图（弧树跟过战斗 · victoryEventId 不再是假弧头）');
