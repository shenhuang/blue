// 剧情编辑器引擎回归（剧情库测试工具 · Phase 1）—— 把「永远满足任何条件」焊成会 fail 的门。
//
// §1 satisfyEvent 保证：遍历 EVENT_DB 每个事件，satisfyEvent(id) → runEventScenario(input) 后
//    首步不应再有「非有意」隐藏选项，且全库不应出现互斥冲突（impossible gate）。
//    现状（仅 hasEquipment{tool}+少量 prereq/forbiddenFlags 在用）下几乎平凡通过；
//    但一旦有人在编辑器里给选项加门控条件，这条门会立刻抓住「加了条件却没法被满足」的回潮。
// §2 eventArc 图重建 + 全库 triggerEventId 引用完整（与 check-dive-refs 同向双保险）。
//
// 跑法： npx tsx scripts/playthrough-satisfy.ts （regress.mjs 按 playthrough*.ts 自动注册）

import { EVENT_DB } from '../src/engine/zones';
import { satisfyEvent } from '../src/engine/eventSatisfy';
import { runEventScenario, buildScenarioState } from '../src/engine/eventScenario';
import { eventArc, eventRoots, outgoingEdges } from '../src/engine/eventGraph';
import { enterNodeSelection } from '../src/engine/dive';
import { makeHarness, type PtAssert } from './lib/pt';

const pt = makeHarness('playthrough-satisfy：§1 一键满足保证 / §2 图重建+引用完整 / §3 无图态离场 全部');
const { L } = pt;
const assert: PtAssert = pt.assert;

// ═══════════════════════════════════════════════════════════════
// §1 satisfyEvent：满足后首步无「非有意」隐藏 + 全库无互斥冲突
// ═══════════════════════════════════════════════════════════════
L('§1 satisfyEvent 一键满足保证（遍历全库）');

{
  let n = 0;
  let optionsRevealed = 0;
  for (const ev of EVENT_DB.values()) {
    n++;
    const r = satisfyEvent(ev.id);

    // (a) 全库不应有 impossible gate（同一 flag 既要又禁 / stat floor>cap / depthFloor>max …）
    assert(
      r.conflicts.length === 0,
      `${ev.id} satisfyEvent 报互斥冲突：${r.conflicts.map((c) => `[${c.scope}]${c.detail}`).join('; ')}`,
    );

    // (b) 用满足后的覆写跑 runner，扫首步
    const res = runEventScenario(r.input);
    assert(res.errors.length === 0, `${ev.id} runner 报错：${res.errors.join(' / ')}`);
    assert(res.steps.length >= 1, `${ev.id} 应至少扫描出首步`);

    // (c) 首步的隐藏选项必须都是「有意隐藏」（satisfyEvent 有意保留的隐藏选项）
    const step0 = res.steps[0];
    const intended = new Set(r.intentionallyHidden);
    for (const h of step0.hiddenOptions) {
      assert(
        intended.has(h.id),
        `${ev.id} 选项「${h.id}」一键满足后仍隐藏（被「${h.blockedBy}」挡）——satisfyEvent 未覆盖该条件`,
      );
    }
    optionsRevealed += step0.visibleOptions.length;
  }
  L(`  全库 ${n} 事件：满足后首步可见选项共 ${optionsRevealed} 个·无残留隐藏·无互斥冲突 ✓`);
}

// ═══════════════════════════════════════════════════════════════
// §2 eventArc 图重建 + 全库 triggerEventId 引用完整
// ═══════════════════════════════════════════════════════════════
L('§2 eventArc 图重建 + 引用完整');

{
  // (a) 全库每条 outgoing 边都应解析（断链 = 指向不存在事件）
  let missing = 0;
  for (const ev of EVENT_DB.values()) {
    for (const e of outgoingEdges(ev)) {
      if (e.missing) {
        missing++;
        L(`  断链 ${ev.id} --[${e.optionId}]--> ${e.to}`);
      }
    }
  }
  assert(missing === 0, `全库 triggerEventId 应都解析，发现 ${missing} 处断链（见上）`);

  // (b) 已知弧头：tutorial.prologue → … → tutorial.descent（§story §4 接线）
  const arc = eventArc('tutorial.prologue');
  assert(arc, 'tutorial.prologue 应能重建弧');
  assert(arc!.nodes.length >= 2, 'prologue 弧应不止 root 一个节点');
  assert(
    arc!.nodes.some((nd) => nd.id === 'tutorial.descent'),
    'prologue 弧应含 tutorial.descent（每个选项都接 descent）',
  );
  assert(arc!.missingTargets.length === 0, 'prologue 弧内不应有断链');

  // (c) 弧头识别：scriptedStart 的 prologue 不被任何事件触发 → 应在 eventRoots()
  assert(
    eventRoots().includes('tutorial.prologue'),
    'tutorial.prologue 应被识别为弧头（无人触发它）',
  );
  L(`  全库引用完整·prologue 弧 ${arc!.nodes.length} 节点 ${arc!.edges.length} 边·弧头识别 ✓`);
}

// ═══════════════════════════════════════════════════════════════
// §3 无图态（剧情编辑器合成态）事件结束应离场到 rest，而非停在原事件空耗氧
// （守 EventView remainOnEvent → enterNodeSelection 无图退化·别回退成「停在原地」）
// ═══════════════════════════════════════════════════════════════
L('§3 无图态 remainOnEvent 离场 rest');
{
  const someId = [...EVENT_DB.keys()][0];
  const s = buildScenarioState(satisfyEvent(someId).input);
  assert(s, '应能合成 scenario state');
  assert(!s!.run?.map, '前提：剧情编辑器合成态无 map');
  const after = enterNodeSelection(s!);
  assert(
    after.phase.kind === 'dive' && after.phase.subPhase.kind === 'rest',
    '无图态 enterNodeSelection 应退化 dive/rest（事件结束离场·不停原地空耗氧）',
  );
  L('  无图态离场到 rest ✓');
}

pt.done();
