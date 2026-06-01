// 海图 UI 渲染冒烟测试 —— 覆盖 playthrough 脚本测不到的 React 层。
// 用 react-dom/server 把 SeaChartView / PortView 在关键 state 下渲染成静态标记，
// 断言：组件不抛错 + 关键串在/不在标记里（POI 名、锁定原因、出海按钮、海图入口、空态）。
//
// 跑法： npx tsx scripts/smoke-chart-ui.tsx

// tsx/esbuild 对独立脚本用 classic JSX transform（React.createElement），需 React 在作用域。
// （Vite app 侧用 react-jsx 自动运行时，不需要此 import；仅本脚本需要。）
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createInitialGameState, createNewRun } from '../src/engine/state';
import { SeaChartView } from '../src/ui/SeaChartView';
import { PortView } from '../src/ui/PortView';
import { NodeSelectView } from '../src/ui/NodeSelectView';
import { EventView } from '../src/ui/EventView';
import { FuneralView } from '../src/ui/CorpseView';
import type { GameState, NodeChoice } from '../src/types';

const log: string[] = [];
const L = (s: string) => log.push(s);
function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    console.error(log.join('\n'));
    console.error('\n✗ ' + msg);
    process.exit(1);
  }
}
const noop = () => {};

function stateWith(flags: string[], upgrades: string[], runsCompleted = 0): GameState {
  const base = createInitialGameState();
  return {
    ...base,
    profile: {
      ...base.profile,
      flags: new Set(flags),
      unlockedUpgrades: new Set(upgrades),
      runsCompleted,
    },
  };
}

// ============================================
// A. SeaChartView · 教学后无升级 → 灯塔礁锁、蓝洞/沉船可出海
// ============================================
L('========== A. 教学后 · 无升级 ==========');
const A = stateWith(['flag.tutorial_complete'], []);
const htmlA = renderToStaticMarkup(<SeaChartView state={A} onStateChange={noop} />);
assert(htmlA.includes('海图'), 'A: 应渲染海图标题');
assert(htmlA.includes('旧灯塔礁'), 'A: 应含旧灯塔礁 POI');
assert(htmlA.includes('蓝洞群'), 'A: 应含蓝洞群 POI');
assert(htmlA.includes('沉船墓园'), 'A: 应含沉船墓园 POI');
assert(htmlA.includes('需要「船坞 Lv.1」'), 'A: 旧灯塔礁应显示锁定原因（disabled 按钮）');
assert(htmlA.includes('出海'), 'A: 蓝洞/沉船应有可点的出海按钮');
L('  渲染成功，灯塔礁锁定 + 蓝洞/沉船可出海 ✓');

// ============================================
// B. SeaChartView · 教学后 + dockyard.lv1 → 灯塔礁解锁（无锁定串）
// ============================================
L('\n========== B. 教学后 · 有船坞 Lv.1 ==========');
const B = stateWith(['flag.tutorial_complete'], ['upgrade.dockyard.lv1']);
const htmlB = renderToStaticMarkup(<SeaChartView state={B} onStateChange={noop} />);
assert(htmlB.includes('旧灯塔礁'), 'B: 应含旧灯塔礁 POI');
// dockyard.lv1 是 chart_pois 里唯一的能力门 → 拥有后全图不应再有锁定原因串
assert(!htmlB.includes('需要「船坞 Lv.1」'), 'B: 买了船坞后不应再出现锁定原因');
L('  渲染成功，灯塔礁解锁、无残留锁定串 ✓');

// ============================================
// C. SeaChartView · 教学前 → 空态
// ============================================
L('\n========== C. 教学前 · 空态 ==========');
const C = stateWith([], []);
const htmlC = renderToStaticMarkup(<SeaChartView state={C} onStateChange={noop} />);
assert(htmlC.includes('海图上还没有你能去的点'), 'C: 应显示空态提示');
assert(!htmlC.includes('旧灯塔礁'), 'C: 教学前不应出现任何 POI');
L('  渲染成功，空态提示正确 ✓');

// ============================================
// D. PortView · 海图入口按钮的教学门控
// ============================================
L('\n========== D. PortView 海图入口门控 ==========');
const htmlPortPost = renderToStaticMarkup(
  <PortView state={stateWith(['flag.tutorial_complete'], [])} onStateChange={noop} />,
);
assert(htmlPortPost.includes('摊开海图'), 'D: 教学后港口应有"摊开海图"按钮');
const htmlPortPre = renderToStaticMarkup(
  <PortView state={stateWith([], [])} onStateChange={noop} />,
);
assert(!htmlPortPre.includes('摊开海图'), 'D: 教学前港口不应有"摊开海图"按钮');
L('  教学后有入口 / 教学前无入口 ✓');

// ============================================
// E. NodeSelectView · 低能见度（dark）遮蔽前方预览
// ============================================
L('\n========== E. NodeSelectView 盲航（dark） ==========');
function diveState(visibility?: 'murky' | 'dark'): GameState {
  const base = createInitialGameState();
  const run = {
    ...createNewRun({ zoneId: 'zone.wreck_graveyard' }),
    currentDepth: 20,
    currentNodeId: 'n0',
    diveModifier: visibility ? { visibility } : undefined,
  };
  return {
    ...base,
    run,
    phase: { kind: 'dive', subPhase: { kind: 'nodeSelect', choices: [] } },
  };
}
const navChoices: NodeChoice[] = [
  { nodeId: 'n1', depth: 25, zoneTag: 'wreck', preview: '一段倾斜的船体。' },
];
const htmlDark = renderToStaticMarkup(
  <NodeSelectView state={diveState('dark')} choices={navChoices} onStateChange={noop} />,
);
assert(htmlDark.includes('看不清'), 'E: dark 时节点预览应被遮蔽');
assert(!htmlDark.includes('一段倾斜的船体'), 'E: dark 时原预览文字应隐藏');
const htmlClear = renderToStaticMarkup(
  <NodeSelectView state={diveState()} choices={navChoices} onStateChange={noop} />,
);
assert(htmlClear.includes('一段倾斜的船体'), 'E: 正常能见度预览应可见');
assert(!htmlClear.includes('看不清'), 'E: 正常能见度不应出现遮蔽文案');
L('  dark 遮蔽预览 / clear 预览可见 ✓');

// ============================================
// F. SeaChartView · 打捞行会 Lv.2 出海前选目标尸体
// ============================================
L('\n========== F. SeaChartView 选目标（Lv.2） ==========');
function stateWithDeath(upgrades: string[]): GameState {
  const base = createInitialGameState();
  const death = {
    id: 'death-smoke-0',
    runId: 'run-x',
    diverName: 'Marek',
    depthAtDeath: 40,
    // 放在"默认选中"的 zone（东礁 = 第一个可出海点），这样 SSR（无法点击）下信息面板就能渲染选目标 UI
    zoneId: 'zone.east_reef',
    zoneTag: 'reef',
    cause: '氧气耗尽',
    inventorySnapshot: [{ itemId: 'item.eel_skin', qty: 1 }],
    goldAtDeath: 0,
    recovered: false,
    diveAge: 1,
    timestamp: 0,
  };
  return {
    ...base,
    profile: {
      ...base.profile,
      flags: new Set(['flag.tutorial_complete']),
      unlockedUpgrades: new Set(upgrades),
      deaths: [death],
    },
  };
}
// 有 Lv.2 + 蓝洞群有可回收尸体 → 出现选目标 UI + 列出死者
const F2 = stateWithDeath(['upgrade.salvage_guild.lv1', 'upgrade.salvage_guild.lv2']);
const htmlF2 = renderToStaticMarkup(<SeaChartView state={F2} onStateChange={noop} />);
assert(htmlF2.includes('锁定目标'), 'F: Lv.2 + 有可回收尸体应出现选目标 UI');
assert(htmlF2.includes('Marek'), 'F: 目标下拉应列出死者名');
// 无 Lv.2 → 不出现选目标 UI
const F0 = stateWithDeath([]);
const htmlF0 = renderToStaticMarkup(<SeaChartView state={F0} onStateChange={noop} />);
assert(!htmlF0.includes('锁定目标'), 'F: 没有 Lv.2 不应出现选目标 UI');
L('  Lv.2 出现选目标(列死者) / 无 Lv.2 不出现 ✓');

// ============================================
// G. NodeSelectView · 地标（气穴 / 扎营点）标签
// ============================================
L('\n========== G. NodeSelectView 地标标签 ==========');
const lmChoices: NodeChoice[] = [
  { nodeId: 'a', depth: 40, zoneTag: 'cave', preview: '礁顶的气穴。', kind: 'air_pocket' },
  { nodeId: 'c', depth: 42, zoneTag: 'cave', preview: '能坐的窄台。', kind: 'camp' },
];
const htmlLm = renderToStaticMarkup(
  <NodeSelectView state={diveState()} choices={lmChoices} onStateChange={noop} />,
);
assert(htmlLm.includes('气穴'), 'G: 气穴地标标签应渲染');
assert(htmlLm.includes('扎营点'), 'G: 扎营点地标标签应渲染');
L('  气穴 / 扎营点 标签渲染 ✓');

// ============================================
// H. EventView 能解析非教学事件（getEvent 委托 EVENT_DB 的回归守卫）
//    旧 bug：getEvent 只装 tutorial.json，EventView 渲染蓝洞/沉船事件 → "[事件未找到]"
// ============================================
L('\n========== H. EventView 解析非教学事件 ==========');
const evState = diveState(); // 带 run
const htmlEv = renderToStaticMarkup(
  <EventView state={evState} eventId="bluecaves.color_shift" onStateChange={noop} />,
);
assert(!htmlEv.includes('事件未找到'), 'H: 非教学事件应能解析（不应出现"事件未找到"）');
assert(htmlEv.includes('水开始变蓝'), 'H: 应渲染 bluecaves.color_shift 的标题');
L('  非教学事件（蓝洞）正常渲染 ✓');

// ============================================
// I. FuneralView · D-reveal 程生姓名故障化（按 deaths.length / 揭示 flag）
// ============================================
L('\n========== I. FuneralView D-reveal ==========');
function deathRec(id: string) {
  return {
    id, runId: 'r', diverName: 'Marek', depthAtDeath: 40,
    zoneId: 'zone.blue_caves', zoneTag: 'cave', cause: '氧气耗尽',
    inventorySnapshot: [], goldAtDeath: 0, recovered: false, diveAge: 0, timestamp: 0,
  };
}
function funeralState(deathCount: number, revealed: boolean): GameState {
  const base = createInitialGameState();
  return {
    ...base,
    profile: {
      ...base.profile,
      deaths: Array.from({ length: deathCount }, (_, i) => deathRec('d' + i)) as any,
      flags: new Set(revealed ? ['flag.d_reveal'] : []),
    },
  };
}
const rec = deathRec('d0') as any;
const fNormal = renderToStaticMarkup(<FuneralView state={funeralState(1, false)} record={rec} onReturn={noop} />);
assert(fNormal.includes('Marek 没能回来'), 'I: 1 次死亡名应正常');
const fGlitch = renderToStaticMarkup(<FuneralView state={funeralState(12, false)} record={rec} onReturn={noop} />);
assert(!fGlitch.includes('Marek'), 'I: 12 次死亡名应故障（不含连续原名）');
const fReveal = renderToStaticMarkup(<FuneralView state={funeralState(3, true)} record={rec} onReturn={noop} />);
assert(fReveal.includes('你 没能回来'), 'I: 揭示 flag 后名应变「你」');
L('  funeral 名 正常 / 故障 / 揭示「你」✓');

console.log(log.join('\n'));
console.log('\n✓ 海图 UI 冒烟测试通过');
