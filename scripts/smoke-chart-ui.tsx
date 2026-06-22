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
import { devRevealOutpost } from '../src/engine/lighthouses';
import { SeaChartView, OutpostPopup, ChartInfo } from '../src/ui/SeaChartView';
import { PortView } from '../src/ui/PortView';
import { NodeSelectView } from '../src/ui/NodeSelectView';
import {
  SonarScanPanel,
  buildCaveGeometry,
  edgeRoutePts,
  stalkerRoutePoint,
  projectIntoWater,
  caveSdf,
  WALL_LO,
  clampViewCenter,
  bakeCaveRGBA,
} from '../src/ui/SonarScanPanel';
import type { MapLayout } from '../src/ui/mapLayout';
import { EventView } from '../src/ui/EventView';
import { FuneralView } from '../src/ui/CorpseView';
import { UpgradePanel } from '../src/ui/UpgradePanel';
import { MiraShopView } from '../src/ui/MiraShopView';
import { LighthouseBuildPanel } from '../src/ui/LighthouseBuildPanel';
import { LockerView } from '../src/ui/LockerView';
import type { GameState, InventoryItem, NodeChoice, FeatureChoice, DiveMap, ChartPoi } from '../src/types';
import { generateChart, isPoiDepartable, resolveMarkedPois } from '../src/engine/chart';
import { itemMarkedPois } from '../src/engine/items';

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

/** 在家灯塔建上「船坞」设施（Phase C：dockyard 迁灯塔后旧灯塔礁的抵达门）。 */
function withHomeDockyard(s: GameState): GameState {
  return {
    ...s,
    profile: {
      ...s.profile,
      lighthouses: s.profile.lighthouses.map((l) =>
        l.id === 'lighthouse.home'
          ? { ...l, builtUpgrades: new Set([...l.builtUpgrades, 'lighthouse.dockyard.lv1']) }
          : l,
      ),
    },
  };
}

/** 深水区 Phase 2b：构造一个「前哨已点亮」的 state（三阶段 flag + push 一座结果灯塔）。 */
function litOutpostState(opts: {
  outpostId: string;
  resultLh: { id: string; name: string; mapX: number; mapY: number };
  facilities?: string[];
  runsCompleted?: number;
  inventory?: { itemId: string; qty: number }[];
}): GameState {
  const base = createInitialGameState();
  const flags = new Set([
    'flag.tutorial_complete',
    `flag.${opts.outpostId}.s1`,
    `flag.${opts.outpostId}.s2`,
    `flag.${opts.outpostId}.s3`,
  ]);
  const lh = { ...opts.resultLh, level: 1, builtUpgrades: new Set(opts.facilities ?? []) };
  // 衰减/中转寄存已删（#125·step ②③）：outpostState 只剩 { discovered? }（无 maintainedRun/storedRun/stored）。
  return {
    ...base,
    profile: {
      ...base.profile,
      flags,
      runsCompleted: opts.runsCompleted ?? 0,
      inventory: opts.inventory ?? base.profile.inventory,
      lighthouses: [...base.profile.lighthouses, lh],
      outpostState: { [opts.outpostId]: {} },
    },
  };
}
// 深脊柱前哨已删（#131）——补给设施门控（outpostOnly）在**章节前哨**上验：
//   残骸前哨＝深水前哨（outpostOnly 满足·显示充电/制氧）。坐标/名取 result 灯塔（lighthouse_upgrades.json）。
//   （能源容量门控 + 水力发电/currentOnly 已删·2026-06-21。）
const WRECK_OUTPOST_LH = { id: 'lighthouse.ch1_wreck_outpost', name: '残骸前哨', mapX: 0.3, mapY: 0.69 };

// ============================================
// A. SeaChartView · 教学后无升级 → 区域揭示配置化：只点亮家·珊瑚区（旧灯塔礁缺船坞·dim）；
//    剧情锚点恒显；蓝洞群/沉船墓园属未解锁的海沟/残骸区→不揭示；蛙跳入口收编进 home 灯塔 popup。
// ============================================
L('========== A. 教学后 · 无升级 ==========');
const A = stateWith(['flag.tutorial_complete'], []);
const htmlA = renderToStaticMarkup(<SeaChartView state={A} onStateChange={noop} />);
assert(htmlA.includes('海图'), 'A: 应渲染海图标题');
assert(htmlA.includes('旧灯塔礁'), 'A: 家区应含旧灯塔礁 POI');
assert(htmlA.includes('东礁'), 'A: 家区应含东礁 POI');
assert(htmlA.includes('需要「船坞 Lv.1」'), 'A: 旧灯塔礁应显示锁定原因（缺船坞·dim）');
assert(htmlA.includes('出海'), 'A: 家区可去点应有出海按钮');
// 区域揭示门控（区域揭示配置化 SPEC）：蓝洞群在海沟区·教学后未解锁 → 不揭示。
assert(!htmlA.includes('蓝洞群'), 'A: 蓝洞群属海沟区·教学后未解锁 → 不出现（区域门控）');
// 剧情锚点（story·日志已知坐标·#117）恒显，不靠揭示圈。
assert(htmlA.includes('温带商船残骸'), 'A: 剧情锚点温带商船残骸恒显（日志已知坐标）');
// A2. 点 home 灯塔 → 开灯塔设施面板（灯塔/蛙跳重构 step ③·不再 HomeDivePopup 蛙跳列表）；SSR 不点击 → 断言 home 灯塔标记在。
assert(htmlA.includes('灯塔：旧灯塔'), 'A2: 应渲染 home 灯塔标记（点它开灯塔设施面板·深脊柱改走升级派生深入 POI）');
L('  渲染成功：家区 POI + 剧情锚点恒显 + 海沟区门控 + home 灯塔节点 ✓');

// ============================================
// B. SeaChartView · 教学后 + 家灯塔船坞 → 灯塔礁解锁（无锁定串）
// ============================================
L('\n========== B. 教学后 · 有家灯塔船坞 ==========');
const B = withHomeDockyard(stateWith(['flag.tutorial_complete'], []));
const htmlB = renderToStaticMarkup(<SeaChartView state={B} onStateChange={noop} />);
assert(htmlB.includes('旧灯塔礁'), 'B: 应含旧灯塔礁 POI');
// 船坞（lighthouse.dockyard.lv1）是旧灯塔礁的抵达门 → 建成后不应再有锁定原因串
assert(!htmlB.includes('需要「船坞 Lv.1」'), 'B: 建了家灯塔船坞后不应再出现锁定原因');
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
  <PortView state={stateWith(['flag.tutorial_complete'], [])} onStateChange={noop} onOpenService={noop} dialog={null} onDialogChange={noop} />,
);
assert(htmlPortPost.includes('摊开海图'), 'D: 教学后港口应有"摊开海图"按钮');
const htmlPortPre = renderToStaticMarkup(
  <PortView state={stateWith([], [])} onStateChange={noop} onOpenService={noop} dialog={null} onDialogChange={noop} />,
);
assert(!htmlPortPre.includes('摊开海图'), 'D: 教学前港口不应有"摊开海图"按钮');
L('  教学后有入口 / 教学前无入口 ✓');

// ============================================
// E. NodeSelectView · 低能见度（dark）遮蔽前方预览
// ============================================
// 深水区 Phase 0a：预览遮蔽已移进引擎（enterNodeSelection 按 clarity 档烤 preview）；
// NodeSelectView 成纯渲染器——按 choice.clarity 出样式 + 渲染传感器控制/电量。引擎侧门控由 playthrough-sensors 测。
L('\n========== E. NodeSelectView clarity 渲染 + 传感器 + 电量 ==========');
function diveState(opts?: { visibility?: 'murky' | 'dark'; sonarUnlocked?: boolean }): GameState {
  const base = createInitialGameState();
  const r0 = createNewRun({
    zoneId: 'zone.wreck_graveyard',
    bonuses: { sonarUnlocked: opts?.sonarUnlocked },
  });
  const run = {
    ...r0,
    currentDepth: 20,
    currentNodeId: 'n0',
    diveModifier: opts?.visibility ? { visibility: opts.visibility } : undefined,
  };
  return {
    ...base,
    run,
    phase: { kind: 'dive', subPhase: { kind: 'nodeSelect', choices: [] } },
  };
}
// 引擎已按档烤好 preview；UI 渲染器只读 choice.clarity 配样式。
const truthChoice: NodeChoice[] = [
  { nodeId: 'n1', depth: 25, zoneTag: 'wreck', preview: '一段倾斜的船体。', clarity: 'full' },
];
const blindChoice: NodeChoice[] = [
  { nodeId: 'n1', depth: 25, zoneTag: 'wreck', preview: '看不清，一团黑影。', clarity: 'none' },
];
const sonarChoice: NodeChoice[] = [
  { nodeId: 'n1', depth: 25, zoneTag: 'wreck', preview: '回波画出一处空腔，边缘是乱石。', clarity: 'sonar' },
];

const htmlTruth = renderToStaticMarkup(
  <NodeSelectView state={diveState()} choices={truthChoice} onStateChange={noop} />,
);
assert(htmlTruth.includes('一段倾斜的船体'), 'E: full 档渲染地面真相预览');
assert(htmlTruth.includes('电量'), 'E: StatusBar 应有电量');
assert(htmlTruth.includes('开灯') || htmlTruth.includes('熄灯'), 'E: 应有灯开关按钮');
assert(!htmlTruth.includes('声呐：'), 'E: 未解锁声呐不应显示声呐开关');

const htmlBlind = renderToStaticMarkup(
  <NodeSelectView state={diveState({ visibility: 'dark' })} choices={blindChoice} onStateChange={noop} />,
);
assert(htmlBlind.includes('看不清'), 'E: none 档渲染盲航文案');
assert(htmlBlind.includes('clar-none'), 'E: none 档预览应带 clar-none 样式类');

const htmlSonar = renderToStaticMarkup(
  <NodeSelectView state={diveState({ sonarUnlocked: true })} choices={sonarChoice} onStateChange={noop} />,
);
assert(htmlSonar.includes('clar-sonar'), 'E: sonar 档预览应带 clar-sonar 样式类');
assert(htmlSonar.includes('声呐：'), 'E: 已解锁声呐应显示声呐开/关切换');
L('  full 真相 / none 盲 / sonar 表象 + 电量 + 灯开关 + 声呐门控 ✓');

// E2. NodeSelectView · 警觉预警（深水区 Phase 0b：被探测预警，给玩家熄灯反应窗口）
const baseDive = diveState();
const hiAlert: GameState = { ...baseDive, run: { ...baseDive.run!, alert: 80 } };
const htmlAlert = renderToStaticMarkup(
  <NodeSelectView state={hiAlert} choices={truthChoice} onStateChange={noop} />,
);
assert(htmlAlert.includes('alert-warning'), 'E2: 高警觉应渲染预警块');
assert(htmlAlert.includes('逼近'), 'E2: 越线警觉应给紧急预警文案');
const loAlert: GameState = { ...baseDive, run: { ...baseDive.run!, alert: 0 } };
const htmlNoAlert = renderToStaticMarkup(
  <NodeSelectView state={loAlert} choices={truthChoice} onStateChange={noop} />,
);
assert(!htmlNoAlert.includes('alert-warning'), 'E2: 低警觉不应渲染预警');
L('  高警觉预警渲染 / 低警觉无预警 ✓');

// E3. NodeSelectView · 单向下潜预告（层状 zone 给「只能往下」提示，迷路图 zone 不给）
const htmlOneWay = renderToStaticMarkup(
  <NodeSelectView state={diveState()} choices={truthChoice} onStateChange={noop} />,
); // diveState() = zone.wreck_graveyard = 层状（单向下潜）
assert(htmlOneWay.includes('只往下通'), 'E3: 层状（开阔水域）zone 应给「只能往下、回不去」的单向下潜预告');
const md = diveState();
const mazeDive: GameState = { ...md, run: { ...md.run!, zoneId: 'zone.blue_caves' } };
const htmlMaze = renderToStaticMarkup(
  <NodeSelectView state={mazeDive} choices={truthChoice} onStateChange={noop} />,
);
assert(!htmlMaze.includes('只往下通'), 'E3: 迷路图（蓝洞群）zone 能回头 → 不给单向预告（免得误导）');
L('  层状给单向预告 / 迷路图不给 ✓');

// E4. NodeSelectView · 声呐探索图（声呐与房间 SPEC §5/§7 S0）：
//   解锁声呐 → 面板出现；未 ping → 全黑空态；有扫描记忆 → 画出 blip + 深度 + 残图小地图；未解锁 → 无面板
L('\n========== E4. NodeSelectView 声呐探索图 (S0) ==========');
function sonarMap(): DiveMap {
  return {
    zoneId: 'zone.wreck_graveyard',
    generatedAt: 0,
    startNodeId: 'n0',
    nodes: {
      n0: { id: 'n0', layer: 0, depth: 30, zoneTag: 'wreck', kind: 'event', connectsTo: ['n1'], preview: '' },
      n1: { id: 'n1', layer: 1, depth: 38, zoneTag: 'wreck', kind: 'ascent_point', connectsTo: [], preview: '' },
    },
  };
}
function sonarState(opts?: { scanMemory?: Record<string, number>; sonarUnlocked?: boolean }): GameState {
  const base = createInitialGameState();
  const r0 = createNewRun({
    zoneId: 'zone.wreck_graveyard',
    bonuses: { sonarUnlocked: opts?.sonarUnlocked ?? true },
  });
  const run = { ...r0, map: sonarMap(), currentDepth: 30, currentNodeId: 'n0', turn: 0, scanMemory: opts?.scanMemory ?? {} };
  return { ...base, run, phase: { kind: 'dive', subPhase: { kind: 'nodeSelect', choices: [] } } };
}
// 相邻可去节点 choices（声呐渲染重做 §2·声呐图只对这些画可点标记·点击＝move）——从 map 邻接派生（同 enterNodeSelection 语义）。
function choicesFor(m: DiveMap, fromId: string): NodeChoice[] {
  const node = m.nodes[fromId];
  return (node?.connectsTo ?? [])
    .filter((id) => m.nodes[id])
    .map((id) => {
      const n = m.nodes[id];
      return {
        nodeId: id,
        depth: n.depth,
        zoneTag: n.zoneTag,
        preview: '',
        kind: n.kind,
        isAscentPoint: n.kind === 'ascent_point',
        clarity: 'sonar' as const,
      };
    });
}
const sonarAdj = choicesFor(sonarMap(), 'n0'); // [n1]
// 解锁声呐、未扫过（空记忆）→ 面板在、空态（全黑）
const htmlSonarEmpty = renderToStaticMarkup(
  <NodeSelectView state={sonarState({ scanMemory: {} })} choices={sonarAdj} onStateChange={noop} />,
);
assert(htmlSonarEmpty.includes('声呐图'), 'E4: 解锁声呐应渲染声呐图面板');
assert(htmlSonarEmpty.includes('sonar-scan-empty'), 'E4: 未扫过时声呐图为空态（全黑）');
// 有扫描记忆 → canvas 有机洞穴剖面 + 相邻可去节点可点标记(§2) + 你 + 残图小地图
const htmlSonarMapped = renderToStaticMarkup(
  <NodeSelectView state={sonarState({ scanMemory: { n0: 0, n1: 0 } })} choices={sonarAdj} onStateChange={noop} />,
);
assert(htmlSonarMapped.includes('sonar-cave-canvas'), 'E4: 有扫描记忆 → 画有机洞穴 canvas（声呐渲染重做 §2）');
assert(htmlSonarMapped.includes('sonar-blip'), 'E4: 相邻可去节点画可点标记 blip（§2）');
assert(htmlSonarMapped.includes('sonar-node-marker'), 'E4: 相邻节点标记可点（sonar-node-marker·点击＝move）');
assert(htmlSonarMapped.includes('sonar-you'), 'E4: 画出你的呼吸点（§5 观感·青·不要 X）');
assert(htmlSonarMapped.includes('38m'), 'E4: 相邻节点标注深度（n1=38m）');
assert(htmlSonarMapped.includes('sonar-mini'), 'E4: 应渲染残图小地图（方位感）');
// 声呐持续开/关切换（声呐渲染重做 §4）：解锁声呐 → 给开/关切换按钮（预承诺下回合·缺省开）。
assert(htmlSonarEmpty.includes('sonar-toggle'), 'E4: 解锁声呐 → 给开/关持续切换按钮 (sonar-toggle·§4)');
assert(htmlSonarEmpty.includes('声呐：开'), 'E4: 缺省持续开 → 切换按钮显示「声呐：开」');
// 未解锁声呐 → 无声呐图面板（软门控：声呐图随声呐解锁才有，SPEC §8.6）
const htmlNoSonar = renderToStaticMarkup(
  <NodeSelectView state={sonarState({ scanMemory: { n0: 0 }, sonarUnlocked: false })} choices={sonarAdj} onStateChange={noop} />,
);
assert(!htmlNoSonar.includes('声呐图'), 'E4: 未解锁声呐不应渲染声呐图面板');
assert(!htmlNoSonar.includes('sonar-toggle'), 'E4: 未解锁声呐 → 无开/关切换按钮');
L('  解锁→面板/空态 · 有记忆→canvas洞穴+相邻可点标记+你+残图 · 开/关(§4) · 未解锁→无面板 ✓');

// ============================================
// E4c. SonarScanPanel · 开放水域 vs 洞穴（声呐渲染重做 §2/§3）：
//   层状 zone（开阔海域·wreck）没有洞壁可画 → 标 is-open-water（canvas 不画洞壁·只显接触·肉眼验·SSR 只断 class）；
//   迷路 zone（洞穴·blue_caves）→ 非 open-water·canvas 画有机洞穴剖面。两者都渲染 canvas 元素 + 相邻可点标记。
// ============================================
L('\n========== E4c. SonarScanPanel 开放水域 vs 洞穴 (§2/§3) ==========');
// 开放水域（wreck_graveyard·层状）：标 is-open-water·有 canvas + 接触标记
const htmlOpen = renderToStaticMarkup(
  <NodeSelectView state={sonarState({ scanMemory: { n0: 0, n1: 0 } })} choices={sonarAdj} onStateChange={noop} />,
);
assert(htmlOpen.includes('is-open-water'), 'E4c: 开放水域声呐图标 is-open-water');
assert(htmlOpen.includes('sonar-cave-canvas'), 'E4c: 仍渲染 canvas 元素（开放水域 canvas 不画洞壁·肉眼验）');
assert(htmlOpen.includes('sonar-blip'), 'E4c: 开放水域仍显接触(相邻可点标记)与读数');
// 迷路洞穴对照（blue_caves·maze）：非 open-water·canvas 画有机洞穴剖面
const owMazeMap: DiveMap = {
  zoneId: 'zone.blue_caves', generatedAt: 0, startNodeId: 'm0',
  nodes: {
    m0: { id: 'm0', layer: 0, depth: 50, zoneTag: 'cave', kind: 'event', connectsTo: ['m1'], preview: '' },
    m1: { id: 'm1', layer: 1, depth: 56, zoneTag: 'cave', kind: 'event', connectsTo: [], preview: '' },
  },
};
const owMazeRun = {
  ...createNewRun({ zoneId: 'zone.blue_caves', bonuses: { sonarUnlocked: true } }),
  map: owMazeMap, currentDepth: 50, currentNodeId: 'm0', turn: 0, scanMemory: { m0: 0, m1: 0 },
};
const owMazeState: GameState = {
  ...createInitialGameState(), run: owMazeRun,
  phase: { kind: 'dive', subPhase: { kind: 'nodeSelect', choices: [] } },
};
const htmlOwMaze = renderToStaticMarkup(
  <NodeSelectView state={owMazeState} choices={choicesFor(owMazeMap, 'm0')} onStateChange={noop} />,
);
assert(!htmlOwMaze.includes('is-open-water'), 'E4c: 迷路洞穴非 open-water');
assert(htmlOwMaze.includes('sonar-cave-canvas'), 'E4c: 迷路洞穴渲染有机洞穴 canvas');
L('  开放水域 is-open-water(canvas 不画洞壁) / 迷路洞穴画有机洞穴剖面 · 均有 canvas+相邻标记 ✓');

// ============================================
// E5. NodeSelectView · 多事件房间（声呐与房间 SPEC §6/§7 S1）：
//   房间 features → 「凑近看」组；无 features → 不渲染该组（向后兼容）；声呐图把多 feature 房间画成 is-room 大轮廓 + feature blip
// ============================================
L('\n========== E5. NodeSelectView 多事件房间 (S1) ==========');
const roomFeatures: FeatureChoice[] = [
  { featureId: 'f0', eventId: 'ev.a', preview: '半埋的舱门', clarity: 'full' },
  { featureId: 'f1', eventId: 'ev.b', preview: '一段断裂的缆', clarity: 'full' },
];
const htmlRoom = renderToStaticMarkup(
  <NodeSelectView state={diveState()} choices={truthChoice} features={roomFeatures} onStateChange={noop} />,
);
assert(htmlRoom.includes('room-features'), 'E5: 有 features 应渲染「凑近看」组');
assert(htmlRoom.includes('凑近看'), 'E5: 房间 feature 选项标签');
assert(htmlRoom.includes('半埋的舱门') && htmlRoom.includes('一段断裂的缆'), 'E5: 各 feature 预览渲染');
// 无 features → 不渲染「凑近看」组（单事件房间＝旧 UI，向后兼容）
const htmlNoRoom = renderToStaticMarkup(
  <NodeSelectView state={diveState()} choices={truthChoice} onStateChange={noop} />,
);
assert(!htmlNoRoom.includes('room-features'), 'E5: 无 features 不渲染「凑近看」组（向后兼容）');
// 声呐图：相邻的多 feature 房间画成 is-room 大轮廓 + feature blip（§2·房间是可去的相邻节点 → 给可点标记）。
const roomSonarMap: DiveMap = {
  zoneId: 'zone.blue_caves',
  generatedAt: 0,
  startNodeId: 'n0',
  nodes: {
    n0: { id: 'n0', layer: 0, depth: 120, zoneTag: 'cave', kind: 'event', connectsTo: ['n1'], preview: '' },
    n1: {
      id: 'n1', layer: 1, depth: 128, zoneTag: 'cave', kind: 'event',
      features: [
        { id: 'f0', eventId: 'ev.a', preview: 'A' },
        { id: 'f1', eventId: 'ev.b', preview: 'B' },
        { id: 'f2', eventId: 'ev.c', preview: 'C' },
      ],
      connectsTo: [], preview: '',
    },
  },
};
function roomSonarState(): GameState {
  const base = createInitialGameState();
  const r0 = createNewRun({ zoneId: 'zone.blue_caves', bonuses: { sonarUnlocked: true } });
  const run = { ...r0, map: roomSonarMap, currentDepth: 120, currentNodeId: 'n0', turn: 0, scanMemory: { n0: 0, n1: 0 } };
  return { ...base, run, phase: { kind: 'dive', subPhase: { kind: 'nodeSelect', choices: [] } } };
}
const htmlRoomSonar = renderToStaticMarkup(
  <NodeSelectView state={roomSonarState()} choices={choicesFor(roomSonarMap, 'n0')} onStateChange={noop} />,
);
assert(htmlRoomSonar.includes('is-room'), 'E5: 声呐图把相邻的多 feature 房间画成大轮廓 (is-room)');
assert(htmlRoomSonar.includes('sonar-feature-dot'), 'E5: 房间轮廓里画 feature blip');
L('  凑近看组 / 向后兼容无组 / 声呐房间轮廓+feature blip ✓');

// ============================================
// E6. SonarScanPanel · 不可信扫描（声呐与房间 SPEC §5/§7 S2）：
//   spoof→画成假信标(is-spoof + 上浮口↑) / evade→无回波(不画·深度缺) / 低 san→读数乱码(is-garbled)+伪接触(sonar-phantom)；
//   高 san 控制组：低 san 腐蚀（乱码/伪接触）消失，但 spoof/evade 是节点固有、仍欺骗。
// ============================================
L('\n========== E6. SonarScanPanel 不可信扫描 (S2·欺骗落在相邻可去标记上) ==========');
// 欺骗的 spoof/evade 节点都是 n0 的相邻可去节点（§2·欺骗仍走 clarity·画在相邻标记上）。
const decMap: DiveMap = {
  zoneId: 'zone.blue_caves', generatedAt: 0, startNodeId: 'n0',
  nodes: {
    // n6＝相邻的真节点·turn 0 的确定性哈希会 garble（验低 san 读数乱码在相邻标记上·见下）。
    n0: { id: 'n0', layer: 0, depth: 150, zoneTag: 'cave', kind: 'event', connectsTo: ['n1', 'n2', 'n3', 'n6'], preview: '' },
    n1: { id: 'n1', layer: 1, depth: 156, zoneTag: 'cave', kind: 'event', connectsTo: [], preview: '', spoofsSonar: '一道朝上的出口' },
    n2: { id: 'n2', layer: 1, depth: 199, zoneTag: 'cave', kind: 'event', connectsTo: [], preview: '', evadesSonar: true },
    n3: { id: 'n3', layer: 1, depth: 158, zoneTag: 'cave', kind: 'event', connectsTo: ['n4', 'n5'], preview: '' },
    n4: { id: 'n4', layer: 2, depth: 160, zoneTag: 'cave', kind: 'event', connectsTo: [], preview: '' },
    n5: { id: 'n5', layer: 2, depth: 170, zoneTag: 'cave', kind: 'event', connectsTo: [], preview: '' },
    n6: { id: 'n6', layer: 1, depth: 162, zoneTag: 'cave', kind: 'event', connectsTo: [], preview: '' },
  },
};
function deceptionSonarState(sanity: number): GameState {
  const base = createInitialGameState();
  const r0 = createNewRun({ zoneId: 'zone.blue_caves', bonuses: { sonarUnlocked: true } });
  const run = {
    ...r0, map: decMap, stats: { ...r0.stats, sanity }, sonarDeception: 0.32,
    currentDepth: 150, currentNodeId: 'n0', turn: 0, scanMemory: { n0: 0, n1: 0, n2: 0, n3: 0, n4: 0, n5: 0, n6: 0 },
  };
  return { ...base, run, phase: { kind: 'dive', subPhase: { kind: 'nodeSelect', choices: [] } } };
}
const decAdj = choicesFor(decMap, 'n0'); // [n1 spoof, n2 evade, n3, n6(garble)]
// 直接渲染 SonarScanPanel（隔离面板·不含 NodeSelectView 底部 choice 列表）→ 199m 只可能来自声呐图标记本身。
const htmlDecLow = renderToStaticMarkup(<SonarScanPanel state={deceptionSonarState(18)} choices={decAdj} onStateChange={noop} />);
assert(htmlDecLow.includes('is-spoof'), 'E6: spoof 相邻节点画成假信标 (is-spoof)');
assert(htmlDecLow.includes('↑'), 'E6: spoof 假信标画成上浮口符号（图上无真出口·↑ 即假象＝节点版 mimic）');
assert(!htmlDecLow.includes('199m</text>'), 'E6: evade 节点无回波→声呐图不画该标记（其深度标签 199m 在声呐图缺席·用 </text> 锚定·避开 animation-delay 的 1199ms 子串误匹配）');
assert(htmlDecLow.includes('is-garbled'), 'E6: 低 san → 读数乱码 (is-garbled)');
assert(htmlDecLow.includes('sonar-phantom'), 'E6: 低 san → 伪接触幻影 blip (sonar-phantom)');
// 高 san 控制组：低 san 腐蚀消失，spoof/evade 固有仍在（是世界在骗你、不是你脑子崩）
const htmlDecHigh = renderToStaticMarkup(<SonarScanPanel state={deceptionSonarState(100)} choices={decAdj} onStateChange={noop} />);
assert(!htmlDecHigh.includes('is-garbled') && !htmlDecHigh.includes('sonar-phantom'), 'E6: 高 san → 无乱码/伪接触（低 san 腐蚀消失·大致为真）');
assert(htmlDecHigh.includes('is-spoof') && !htmlDecHigh.includes('199m</text>'), 'E6: spoof/evade 是节点固有 → 高 san 仍欺骗（199m 深度标签缺席·</text> 锚定避开 1199ms 误匹配）');
L('  spoof 假信标 / evade 无回波 / 低 san 乱码+伪接触 / 高 san 控制组 ✓');

// ============================================
// E7. SonarScanPanel · 威胁定位（声呐与房间 SPEC §7 S3 廉价版）：
//   alert 高 + 已扫描 → 琥珀威胁接触 blip（越过接近线 is-near 脉动）；alert 低 → 无接触（alert 驱动·非欺骗）。
// ============================================
L('\n========== E7. SonarScanPanel 威胁定位 (S3) ==========');
const threatBase = sonarState({ scanMemory: { n0: 0, n1: 0 } });
const threatHi: GameState = { ...threatBase, run: { ...threatBase.run!, alert: 60 } }; // ≥ 接近线(60) → imminent
const htmlThreatHi = renderToStaticMarkup(
  <NodeSelectView state={threatHi} choices={[]} onStateChange={noop} />,
);
assert(htmlThreatHi.includes('sonar-threat'), 'E7: 高警觉 + 已扫描 → 画威胁接触 blip');
assert(htmlThreatHi.includes('is-near'), 'E7: 越过接近线 → 威胁 blip imminent（is-near 脉动）');
const threatLo: GameState = { ...threatBase, run: { ...threatBase.run!, alert: 0 } };
const htmlThreatLo = renderToStaticMarkup(
  <NodeSelectView state={threatLo} choices={[]} onStateChange={noop} />,
);
assert(!htmlThreatLo.includes('sonar-threat'), 'E7: 低警觉 → 无威胁接触 blip（alert 驱动·非欺骗）');
L('  高警觉→威胁接触(imminent) / 低警觉→无 ✓');

// ============================================
// E8. SonarScanPanel · 猎手精确定位（猎手 SPEC §2.1「声呐＝知道它在哪」·§8.7 只在被扫到时更新）：
//   声呐定位过（seenNodeId）→ 精确深红 blip (sonar-stalker)·并压住同一只猎手的模糊威胁接触(sonar-threat)；
//   没定位过（只感觉到它）→ 无精确 blip·回落到模糊威胁接触（灯只知道「有东西在接近」）。
// ============================================
L('\n========== E8. SonarScanPanel 猎手精确定位 (猎手 Phase 1) ==========');
const stalkerLocated: GameState = {
  ...threatBase,
  run: {
    ...threatBase.run!,
    alert: 60,
    stalker: {
      nodeId: 'n1', sensesBy: 'sound', onLostSignal: 'wait', waitTurns: 0, state: 'hunting',
      encounterId: 'combat.blind_eel_solo', lastSignalNodeId: 'n0', turnsSinceSignal: 0, waitedTurns: 0,
      seenNodeId: 'n1', seenTurn: 0,
    },
  },
};
const htmlStalkerFix = renderToStaticMarkup(
  <NodeSelectView state={stalkerLocated} choices={[]} onStateChange={noop} />,
);
assert(htmlStalkerFix.includes('sonar-stalker'), 'E8: 声呐定位过猎手 → 画精确深红 blip (sonar-stalker)');
assert(!htmlStalkerFix.includes('sonar-threat'), 'E8: 已精确定位 → 不再画模糊威胁接触(sonar-threat·同一只猎手不重复标记)');
const stalkerUnlocated: GameState = {
  ...threatBase,
  run: {
    ...threatBase.run!,
    alert: 60,
    stalker: {
      nodeId: 'n1', sensesBy: 'sound', onLostSignal: 'wait', waitTurns: 0, state: 'hunting',
      encounterId: 'combat.blind_eel_solo', lastSignalNodeId: 'n0', turnsSinceSignal: 0, waitedTurns: 0,
    },
  },
};
const htmlStalkerVague = renderToStaticMarkup(
  <NodeSelectView state={stalkerUnlocated} choices={[]} onStateChange={noop} />,
);
assert(!htmlStalkerVague.includes('sonar-stalker'), 'E8: 没定位过 → 无精确 blip');
assert(htmlStalkerVague.includes('sonar-threat'), 'E8: 没定位过 → 回落模糊威胁接触（灯只知道有东西在接近）');
// 大型生物（声呐与房间 §5 later 接触带大小）：large 猎手 → 一大团（is-large + 弥散质量 sonar-stalker-mass）；普通猎手是小 blip（无 mass）。
const stalkerLargeFix: GameState = {
  ...stalkerLocated,
  run: { ...stalkerLocated.run!, stalker: { ...stalkerLocated.run!.stalker!, large: true } },
};
const htmlStalkerLarge = renderToStaticMarkup(
  <NodeSelectView state={stalkerLargeFix} choices={[]} onStateChange={noop} />,
);
assert(htmlStalkerLarge.includes('is-large') && htmlStalkerLarge.includes('sonar-stalker-mass'), 'E8: 大型生物猎手 → 一大团 (is-large + sonar-stalker-mass)');
assert(!htmlStalkerFix.includes('sonar-stalker-mass'), 'E8: 普通猎手 → 无弥散质量（小 blip）');
// 停下·迎战（猎手 SPEC §5·mid-edge 追击重做）：有猎手 → 给迎战按钮（你「感觉」得到它在）；无猎手 → 不给。
assert(htmlStalkerFix.includes('stalker-engage'), 'E8: 有猎手 → 给「停下·迎战」按钮 (stalker-engage)');
const htmlNoStalker = renderToStaticMarkup(<NodeSelectView state={diveState()} choices={truthChoice} onStateChange={noop} />);
assert(!htmlNoStalker.includes('stalker-engage'), 'E8: 无猎手 → 不给迎战按钮（不误导）');
L('  声呐定位→精确 blip+压住模糊接触 / 未定位→回落模糊接触 / 大型生物→一大团 / 有猎手→迎战按钮 ✓');

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
// 有 Lv.2 + 蓝洞群有可回收尸体 → none 步骤仍渲染「出海」（门没锁）；target 步骤渲染选目标 UI + 死者名。
// #140: 锁定目标移入 departStep='target'（就地分步）——不再在 SeaChartView SSR 初始输出出现，直接测 ChartInfo。
const F2 = stateWithDeath(['upgrade.salvage_guild.lv1', 'upgrade.salvage_guild.lv2']);
const htmlF2none = renderToStaticMarkup(<SeaChartView state={F2} onStateChange={noop} />);
assert(htmlF2none.includes('出海'), 'F: Lv.2 + 尸体·none 步骤→出海按钮可见（门开）');
assert(!htmlF2none.includes('锁定目标'), 'F: 锁定目标仅在 target 步骤展示·none 初始不出现');
// 直接测 ChartInfo target 步骤——选目标 UI + 死者名
const f2Chart = generateChart({ profile: F2.profile }).pois;
const f2Poi = (f2Chart.find((p) => isPoiDepartable(F2.profile, p) && p.zoneId === 'zone.east_reef')
  ?? f2Chart.find((p) => isPoiDepartable(F2.profile, p)))!;
const noopF = () => {};
const htmlF2target = renderToStaticMarkup(
  <ChartInfo
    poi={f2Poi}
    state={F2}
    canSelectTarget={true}
    target=""
    setTarget={noopF}
    departStep="target"
    setDepartStep={noopF as (s: 'none' | 'pack' | 'target') => void}
    carry={{}}
    carryables={[]}
    carryPicks={[]}
    carryWeight={15}
    weightUsed={0}
    stepCarry={noopF as (id: string, d: number, m: number) => void}
    onDepart={noopF as (poi: ChartPoi, t?: string) => void}
  />,
);
assert(htmlF2target.includes('锁定目标') || htmlF2target.includes('选定目标'), 'F: target 步骤→选目标 UI 可见');
assert(htmlF2target.includes('Marek'), 'F: target 步骤→目标下拉列出死者名');
// 无 Lv.2 → canSelectTarget=false → target 步骤下不显示尸体选择器（不会走到 target step）
const F0 = stateWithDeath([]);
const htmlF0none = renderToStaticMarkup(<SeaChartView state={F0} onStateChange={noop} />);
assert(!htmlF0none.includes('锁定目标') && !htmlF0none.includes('选定目标'), 'F: 无 Lv.2 → none 步骤不出现选目标 UI');
L('  Lv.2 none→出海按钮(门开) · target步骤→选目标+死者名 · 无Lv.2→不出现 ✓');

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

// ============================================
// J. UpgradePanel · 材料 ＋ 金币双账单（缺口高亮 / 可买 / 材料不足 / 金币不足）
// ============================================
L('\n========== J. UpgradePanel 材料账单 ==========');
function upgradeState(inv: InventoryItem[], gold: number): GameState {
  const base = createInitialGameState();
  return { ...base, profile: { ...base.profile, inventory: inv, bankedGold: gold } };
}
// 用仍为全局的打捞行会 lv1（coral×5, brass×3 ＋ 30 金）做账单三态（dockyard 已迁灯塔设施）
// J1. 材料 + 金币都够 → 出现"修缮"按钮 + 账单列出材料名与金币
const J1 = upgradeState([{ itemId: 'item.coral_shard', qty: 5 }, { itemId: 'item.brass_fitting', qty: 3 }], 50);
const htmlJ1 = renderToStaticMarkup(<UpgradePanel state={J1} onStateChange={noop} onClose={noop} />);
assert(htmlJ1.includes('珊瑚碎片') && htmlJ1.includes('5/5'), 'J1: 账单列材料名 + 已有/需求（珊瑚碎片 5/5·UpgradeCostView）');
assert(htmlJ1.includes('50/30'), 'J1: 账单金币显已有/需求（50/30·salvage_guild.lv1 = 30 金）');
assert(htmlJ1.includes('cost-confirm">改装'), 'J1: 账单满足应出现可点（非 disabled）"改装"按钮（UpgradeCostView·面板渲染全部线·其它行不足正常）');
// J4–J6 / J8（旧 dive_kit「潜水装备」/ sonar_rig 升级线 / evasion_rig「规避装备」渲染断言）已随段2
//   「三传感器线退役」删除：声呐改 Otto 打造的**装备件**（EquipmentDoll·smoke-equipment-ui 守渲染）、
//   灯/电池/规避效果回退基线（可日后做成灯/服档位件加回）。UpgradePanel 现只剩打捞行会 + 气瓶库两线。
// J7. 声呐与房间 §6/§8.3 续：房间 feature 出现率升级（salvage_guild lv4·新 roomFeatureChanceBonus 效果标签·仍为全局升级线）
assert(htmlJ1.includes('打捞行会 Lv.4'), 'J7: 渲染 salvage_guild lv4（房间出现率轴）');
assert(htmlJ1.includes('大房间出现率'), 'J7: 渲染 roomFeatureChanceBonus 效果（统一前后对比·大房间出现率 +N%）');
// J2. 空仓 + 满金 → 按钮"材料不足" + 缺口已有/需求"0/5"
const J2 = upgradeState([], 9999);
const htmlJ2 = renderToStaticMarkup(<UpgradePanel state={J2} onStateChange={noop} onClose={noop} />);
assert(htmlJ2.includes('材料不足'), 'J2: 无材料应显示"材料不足"');
assert(htmlJ2.includes('0/5'), 'J2: 缺口显已有/需求（珊瑚 0/5·不足标红）');
// J3. 材料够、金币不够 → 按钮"金币不足" + 金币格"5/30"
const J3 = upgradeState([{ itemId: 'item.coral_shard', qty: 5 }, { itemId: 'item.brass_fitting', qty: 3 }], 5);
const htmlJ3 = renderToStaticMarkup(<UpgradePanel state={J3} onStateChange={noop} onClose={noop} />);
assert(htmlJ3.includes('金币不足') && htmlJ3.includes('5/30'), 'J3: 材料够金币差 → 按钮「金币不足」+ 金币格 5/30（salvage lv1 = 30 金）');
L('  可买/材料不足/金币不足 三态 + 账单缺口高亮 ✓');

// ============================================
// K. MiraShopView · 交易系统（2026-06-10 作者续拍「上=她的货点击买·下=我的柜点击卖」）：
//    买侧 T1/T2 货格（售罄/钱不够 short 态·T3/T4 不在清单）+ 卖侧储物柜格（可卖标收价点击卖·她不收惰性陈列）
// ============================================
L('\n========== K. MiraShopView 交易系统 ==========');
function shopState(inv: InventoryItem[], gold: number, shopStock?: Record<string, number>): GameState {
  const base = createInitialGameState();
  return { ...base, phase: { kind: 'shop', shopId: 'mira.bench' }, profile: { ...base.profile, inventory: inv, bankedGold: gold, shopStock: shopStock ?? {} } };
}
// K1. 有金 → 买侧货架（格子陈列）列出 T1/T2 材料货格，不含 T3/T4；卖侧柜格标收价可点
const K1 = shopState([{ itemId: 'item.shark_tooth', qty: 2 }], 1000);
const htmlK1 = renderToStaticMarkup(<MiraShopView state={K1} onStateChange={noop} />);
assert(htmlK1.includes('她的货（点击买）'), 'K1: 应有买侧标题');
assert(htmlK1.includes('珊瑚碎片'), 'K1: 买侧应列 T1 珊瑚碎片');
assert(htmlK1.includes('点击买 1'), 'K1: 买得起的货格 title 应是「点击买 1」');
assert(htmlK1.includes('item-cell'), 'K1: 货架应是格子陈列（ItemCell）');
assert(!htmlK1.includes('冷光腺'), 'K1: T4 冷光腺不应出现在买侧');
// K1b. 消耗品货架（猎手 SPEC §4 data 面·#108·#117 med_kit 上架）：decoy 两种 + 急救包应上买侧（同一套限量/加价机制）
assert(htmlK1.includes('声诱标') && htmlK1.includes('光诱棒'), 'K1b: 买侧应列出声诱标/光诱棒（消耗品货架）');
assert(htmlK1.includes('急救包'), 'K1b: 买侧应列出急救包（#117 上架·负伤 SPEC §8）');
// K1c. 卖侧储物柜（点击卖）：可卖品格上标收价 + title 点击卖；银行金币可见；全卖按钮在
assert(htmlK1.includes('你的储物柜（点击卖）'), 'K1c: 应有卖侧标题');
assert(htmlK1.includes('鲨鱼牙') && htmlK1.includes('点击卖 1'), 'K1c: 可卖品（鲨鱼牙）格可点卖');
assert(/卖 \d+ 金/.test(htmlK1), 'K1c: 可卖品格上标收价（卖 N 金）');
assert(htmlK1.includes('全卖给她'), 'K1c: 全卖按钮保留');
assert(htmlK1.includes('gold-figure'), 'K1c: 买侧应显示银行金币（gold-figure）');
// K1d. 她不收的（剧情物等）也陈列但惰性带原因（原样例 med_kit 已上架可卖·#117 换剧情物）
const K1d = shopState([{ itemId: 'item.waterlogged_logbook', qty: 1 }], 1000);
const htmlK1d = renderToStaticMarkup(<MiraShopView state={K1d} onStateChange={noop} />);
assert(htmlK1d.includes('她不收'), 'K1d: 不可卖品陈列并标「她不收」');
// K2. 没钱 → 货格红显差额钩子（short 样式·点击时给「还差 X 金」红字——SSR 静态层验 variant）
const K2 = shopState([], 0);
const htmlK2 = renderToStaticMarkup(<MiraShopView state={K2} onStateChange={noop} />);
assert(htmlK2.includes('item-cell short'), 'K2: 金币不足时货格应带 short 红显样式');
// K3. 备货耗尽 → "售罄"
const K3 = shopState([], 1000, { 'item.coral_shard': 0 });
const htmlK3 = renderToStaticMarkup(<MiraShopView state={K3} onStateChange={noop} />);
assert(htmlK3.includes('售罄'), 'K3: 备货 0 时应显示"售罄"');
L('  回购货架格子陈列 + 储物柜一览 + 买/钱不够(short)/售罄 三态 ✓');

// ============================================
// L. SeaChartView · 渲染灯塔节点 + 点亮范围 + 建造入口
// ============================================
L('\n========== L. SeaChartView 灯塔节点 + 点亮范围 ==========');
const htmlL = renderToStaticMarkup(
  <SeaChartView state={stateWith(['flag.tutorial_complete'], [])} onStateChange={noop} />,
);
assert(htmlL.includes('chart-lighthouse'), 'L: 应渲染灯塔节点');
assert(htmlL.includes('灯塔：旧灯塔'), 'L: 灯塔节点 aria-label 应含家灯塔名');
assert(htmlL.includes('chart-light-radius'), 'L: 应渲染点亮范围圈');
assert(!htmlL.includes('设施升级'), 'L: 底部全局设施按钮已删 → 改点灯塔/前哨节点开设施面板（灯塔/蛙跳重构 step ③）');
// §6.5 宏观灯塔扫描：测绘扫描揭示动画 + POI 逐个浮现 + 活的海况（潮汐/天气）
assert(htmlL.includes('chart-survey-sweep'), 'L: 灯塔应播测绘扫描揭示动画（§6.5 sweep）');
assert(htmlL.includes('chart-poi-arrive'), 'L: POI 随扫描逐个浮现（§6.5 arrive）');
assert(htmlL.includes('chart-conditions') && /涨潮|退潮/.test(htmlL), 'L: 应渲染海况（潮汐·活的海图）');
L('  灯塔节点 + 点亮范围 + 建造入口 + 测绘扫描/POI 浮现/海况 ✓');

// ============================================
// M. LighthouseBuildPanel · 家灯塔船坞轨 + 可建造（信标轨已删·作者 2026-06-14）
// ============================================
L('\n========== M. LighthouseBuildPanel 建造面板 ==========');
// 家灯塔有船坞账单材料（coral×6, net×3）+ 金 → 船坞可建
const M1 = upgradeState([{ itemId: 'item.coral_shard', qty: 6 }, { itemId: 'item.old_fishing_net', qty: 3 }], 50);
const htmlM1 = renderToStaticMarkup(
  <LighthouseBuildPanel state={M1} onStateChange={noop} onClose={noop} />,
);
assert(htmlM1.includes('设施升级'), 'M: 应渲染设施升级标题（灯塔设施→设施升级·作者 06-14）');
assert(htmlM1.includes('旧灯塔'), 'M: 应列出家灯塔');
assert(htmlM1.includes('船坞'), 'M: home 应显示船坞轨（homeOnly）');
assert(htmlM1.includes('cost-confirm">建造'), 'M: 材料金币够 → 船坞应有可点"建造"按钮（UpgradeCostView）');
// M2/M3：前哨补给设施轨的 outpostOnly 门控（能源容量 + 水力/currentOnly 已删·2026-06-21）
const homeOnlyPanel = renderToStaticMarkup(
  <LighthouseBuildPanel state={createInitialGameState()} onStateChange={noop} onClose={noop} />,
);
assert(!homeOnlyPanel.includes('充电站'), 'M2: 家灯塔不显示前哨补给设施（充电站 outpostOnly）');
assert(!homeOnlyPanel.includes('水力发电'), 'M2: 水力发电设施已删·任何灯塔都不显示');
// 深水章节前哨（残骸前哨）：outpostOnly 满足 → 显示充电/制氧。
const staticOutpostPanel = renderToStaticMarkup(
  <LighthouseBuildPanel
    state={litOutpostState({ outpostId: 'outpost.ch1_wreck', resultLh: WRECK_OUTPOST_LH })}
    onStateChange={noop}
    onClose={noop}
  />,
);
assert(staticOutpostPanel.includes('充电站'), 'M3: 深水前哨显示充电站（outpostOnly）');
assert(staticOutpostPanel.includes('制氧站'), 'M3: 深水前哨显示制氧站');
assert(!staticOutpostPanel.includes('水力发电'), 'M3: 水力发电设施已删·前哨不显示');
L('  家灯塔船坞轨 + 前哨补给设施轨 outpostOnly 门控（家×/深水前哨○）✓');

// ============================================
// N. 章节前哨标记（海图） + OutpostPopup 前哨详情面板（区域揭示配置化 SPEC）
//    深脊柱前哨已整体删除（#131·改数据驱动深度柱·深入 POI 派生）；章节前哨建造面板收编进点击 popup，
//    故 SSR 不点击 → 面板内容直接渲染 OutpostPopup 验（同 E6 直渲 SonarScanPanel 的隔离思路）。
// ============================================
L('\n========== N. 章节前哨标记（发现门控）+ 前哨详情面板 ==========');
// N1：发现门控（作者 2026-06-14）——教学后章节前哨**未发现**→ 图上不留暗节点（不再恒显）。
const htmlN1 = renderToStaticMarkup(
  <SeaChartView state={stateWith(['flag.tutorial_complete'], [])} onStateChange={noop} />,
);
assert(!htmlN1.includes('残骸前哨') && !htmlN1.includes('中层浮标'), 'N1: 未发现的章节前哨不在图上（发现门控·无暗节点）');
assert(!htmlN1.includes('热液井台') && !htmlN1.includes('海沟前哨'), 'N1: 其余章节前哨未发现→不在图（发现门控·下潜中找到才现身；已配 chart_regions 小圈）');
// devReveal（或剧情发现门 discoveredFlag）后 → 该章节前哨暗标记现身「暗·待解锁」。
const n1Revealed = devRevealOutpost(stateWith(['flag.tutorial_complete'], []), 'outpost.ch1_wreck');
const htmlN1b = renderToStaticMarkup(<SeaChartView state={n1Revealed} onStateChange={noop} />);
assert(htmlN1b.includes('残骸前哨'), 'N1: devReveal/剧情发现后 → 章节前哨暗标记现身');
assert(htmlN1b.includes('待解锁'), 'N1: 现身的未解锁章节前哨标为「暗·待解锁」');
// N2：章节前哨点亮 + 建补给设施 → OutpostPopup 正常渲染。
// 能源容量门控已删（2026-06-21）：popup 不再显示能源/掉线；衰减更早删（#125）：无衰减级/荒废 UI。
const N2 = litOutpostState({
  outpostId: 'outpost.ch1_wreck',
  resultLh: WRECK_OUTPOST_LH,
  facilities: ['lighthouse.recharge.lv1', 'lighthouse.oxygen_supply.lv1'],
});
const htmlN2 = renderToStaticMarkup(
  <OutpostPopup outpostId="outpost.ch1_wreck" state={N2} onStateChange={noop} onDive={noop} onClose={noop} />,
);
assert(htmlN2.includes('残骸前哨'), 'N2: 点亮前哨 popup 显示前哨名');
assert(!htmlN2.includes('能源') && !htmlN2.includes('部分设施停转'), 'N2: 能源层已删 → popup 不再显示能源/掉线');
assert(!htmlN2.includes('衰减') && !htmlN2.includes('荒废'), 'N2: 衰减已删 → 无衰减级/荒废 UI');
L('  章节前哨标记（暗·待解锁·未发现不在图）+ 前哨 popup（能源层已删·无能源/掉线/衰减 UI）✓');

// ============================================
// O. SeaChartView · mimic「无灯之光」引诱 + 宏观 tell（深水区 Phase 3）
// ============================================
L('\n========== O. SeaChartView mimic 引诱 ==========');
// 任一**水下**前哨达半亮（≥ OUTPOST_USABLE_STAGE=2）→ 触发引诱（shouldLureMimic·chart.ts）。章节前哨皆 submerged。
const deepFlags = ['flag.outpost.ch1_wreck.s1', 'flag.outpost.ch1_wreck.s2']; // 残骸前哨半亮 → 触发引诱
// O1：有深处立足 → 海图远海一角多出「无名的光」标记
const htmlO1 = renderToStaticMarkup(
  <SeaChartView state={stateWith(['flag.tutorial_complete', ...deepFlags], [])} onStateChange={noop} />,
);
assert(htmlO1.includes('无名的光'), 'O1: 深处立足 → 海图注入 mimic POI「无名的光」标记');
// O2：没有半亮水下前哨 → 不引诱
const htmlO2 = renderToStaticMarkup(
  <SeaChartView state={stateWith(['flag.tutorial_complete'], [])} onStateChange={noop} />,
);
assert(!htmlO2.includes('无名的光'), 'O2: 无半亮水下前哨 → 海图无 mimic 引诱（软门控）');
// O3：mimic 为唯一可出海点（无 tutorial 发现 flag → 普通锚点不可见）→ 默认选中 → 渲染宏观 tell
const htmlO3 = renderToStaticMarkup(
  <SeaChartView state={stateWith(deepFlags, [])} onStateChange={noop} />,
);
assert(htmlO3.includes('不是你点的光'), 'O3: 选中 mimic → 渲染宏观 tell（交叉比对：不是你点的光）');
L('  无灯之光 注入 / 软门控 / 选中显宏观 tell ✓');

// ============================================
// P. 行前装包 + 投放诱饵（猎手 SPEC §4·#108；#140 就地分步向导·2026-06-18）：
//   P1 SeaChartView（departStep='none'·默认）：出海按钮可见；行前装包不在初始渲染中（SSR 无交互）。
//   P1pack ChartInfo（departStep='pack'）：行前装包面板可见·背包格·储物柜格（声诱标 ×2）。
//   P1none ChartInfo（departStep='none'）：出海按钮可见；行前装包不渲染。
//   P2 NodeSelectView：huntEnabled + 背包有 decoy → 「投放」按钮；水里有有效诱饵 → 状态行；
//      非 huntEnabled（浅水旧路径）→ 不渲染按钮（诱饵只对有位置的猎手起效）。
// ============================================
L('\n========== P. 行前装包 + 投放诱饵 (§4) ==========');
const P1state = { ...stateWith(['flag.tutorial_complete'], []) };
P1state.profile = { ...P1state.profile, inventory: [{ itemId: 'item.decoy_sound', qty: 2 }] };
// P1 初始渲染（none step）：出海按钮可见·行前装包尚未展开
const htmlP1none = renderToStaticMarkup(<SeaChartView state={P1state} onStateChange={noop} />);
assert(htmlP1none.includes('出海'), 'P1 none: departStep=none → 出海按钮可见');
assert(!htmlP1none.includes('行前装包'), 'P1 none: departStep=none → 行前装包尚未展开（就地分步·需点出海）');
// P1pack：直接渲染 ChartInfo pack 步骤——仓库有 decoy → 装包面板（背包格 + 储物柜格）
const p1Poi = stateWith(['flag.tutorial_complete'], []);
const firstPoi = generateChart({ profile: p1Poi.profile }).pois.find((p) => isPoiDepartable(p1Poi.profile, p))!;
const noop2 = () => {};
const htmlP1pack = renderToStaticMarkup(
  <ChartInfo
    poi={firstPoi}
    state={P1state}
    canSelectTarget={false}
    target=""
    setTarget={noop2}
    departStep="pack"
    setDepartStep={noop2 as (s: 'none' | 'pack' | 'target') => void}
    carry={{}}
    carryables={[{ itemId: 'item.decoy_sound', qty: 2 }]}
    carryPicks={[]}
    carryWeight={15}
    weightUsed={0}
    stepCarry={noop2 as (id: string, d: number, m: number) => void}
    onDepart={noop2 as (poi: ChartPoi, t?: string) => void}
  />,
);
assert(htmlP1pack.includes('行前装包'), 'P1pack: departStep=pack → 行前装包标题可见');
assert(htmlP1pack.includes('声诱标') && htmlP1pack.includes('×2'), 'P1pack: 储物柜格列出消耗品名 + 数量角标');
assert(htmlP1pack.includes('0.0 / 15.0 kg'), 'P1pack: 背包承载上限可见（重量制·0.0 / 15.0 kg）');
assert(htmlP1pack.includes('点击放进背包'), 'P1pack: 储物柜格可点（title 提示放进背包）');
// P1 空仓库 none：无消耗品 → none 步骤只显出海按钮（始终如此）
const htmlP1empty = renderToStaticMarkup(
  <SeaChartView state={stateWith(['flag.tutorial_complete'], [])} onStateChange={noop} />,
);
assert(htmlP1empty.includes('出海') && !htmlP1empty.includes('行前装包'), 'P1 none 空仓库: 出海按钮·无装包');

// P2：dive 中（huntEnabled）背包有 decoy → 投放按钮；放出的诱饵还有效 → 状态行
const pBase = sonarState({ scanMemory: {} });
const P2: GameState = {
  ...pBase,
  run: { ...pBase.run!, huntEnabled: true, inventory: [{ itemId: 'item.decoy_light', qty: 1 }] },
};
const htmlP2 = renderToStaticMarkup(<NodeSelectView state={P2} choices={[]} onStateChange={noop} />);
assert(htmlP2.includes('decoy-deploy') && htmlP2.includes('投放光诱棒'), 'P2: huntEnabled+有 decoy → 投放按钮');
const P2live: GameState = {
  ...pBase,
  run: { ...pBase.run!, huntEnabled: true, decoy: { nodeId: 'n0', kind: 'sound', expiresTurn: 6 } },
};
const htmlP2live = renderToStaticMarkup(<NodeSelectView state={P2live} choices={[]} onStateChange={noop} />);
assert(htmlP2live.includes('decoy-live') && htmlP2live.includes('还在响'), 'P2: 水里有有效诱饵 → 状态行（还在响）');
const P2off: GameState = {
  ...pBase,
  run: { ...pBase.run!, huntEnabled: false, inventory: [{ itemId: 'item.decoy_light', qty: 1 }] },
};
const htmlP2off = renderToStaticMarkup(<NodeSelectView state={P2off} choices={[]} onStateChange={noop} />);
assert(!htmlP2off.includes('decoy-deploy'), 'P2: 非 huntEnabled（浅水旧路径）→ 不渲染投放按钮');
L('  装包面板有/无 · 投放按钮（huntEnabled 门控）· 诱饵状态行 ✓');

// ============================================================
// Q. 声呐图 06-10 三修（作者实测反馈·#1/#5 的 SSR/纯函数面）：
//   Q1 你脚下那间永远可见——洞穴（maze）+ 空扫描记忆 ≠ 空态（渲染侧并入当前节点·不写 scanMemory）；
//   Q2 两段点击 SSR 默认干净——选中高亮/回正按钮是纯客户端交互态，SSR 初始输出不该有；
//   Q3 半揭示残段（buildCaveGeometry 纯函数直测）——单端揭示给残段、无揭示给空、残段总长 < 双端整隧道。
//   （#3 扫描波重放与 #2 缩放/平移是 canvas/交互行为，绿≠画对——线上 ?dev 肉眼·quirk #91/#93。）
// ============================================================
L('\n========== Q. 声呐图 06-10 三修（#1 脚下可见+残段 / #5 SSR 默认干净） ==========');
// Q1: 洞穴 + 空记忆 → 非空态：canvas 在、你的呼吸点在（站着的房间看得见）
const qRun = {
  ...createNewRun({ zoneId: 'zone.blue_caves', bonuses: { sonarUnlocked: true } }),
  map: owMazeMap, currentDepth: 50, currentNodeId: 'm0', turn: 0, scanMemory: {},
};
const qState: GameState = {
  ...createInitialGameState(), run: qRun,
  phase: { kind: 'dive', subPhase: { kind: 'nodeSelect', choices: [] } },
};
const htmlQ = renderToStaticMarkup(
  <NodeSelectView state={qState} choices={choicesFor(owMazeMap, 'm0')} onStateChange={noop} />,
);
assert(!htmlQ.includes('sonar-scan-empty'), 'Q1: 洞穴图空记忆不再是空态（你脚下那间可见·#1）');
assert(htmlQ.includes('sonar-cave-canvas') && htmlQ.includes('sonar-you'), 'Q1: canvas + 你的呼吸点照常渲染');
// 开阔水域空记忆仍是空态（脚下房间是洞穴的事·开阔水域没洞壁可看）
const htmlQOpen = renderToStaticMarkup(
  <NodeSelectView state={sonarState({ scanMemory: {} })} choices={sonarAdj} onStateChange={noop} />,
);
assert(htmlQOpen.includes('sonar-scan-empty'), 'Q1: 开阔水域空记忆仍空态（不受 #1 影响）');
// Q2: SSR 默认无选中/无回正（纯客户端交互态·见 SonarScanPanel/NodeSelectView 两段点击）
assert(!htmlQ.includes('is-pending') && !htmlQ.includes('sonar-pending-ring'), 'Q2: SSR 初始无选中高亮');
assert(!htmlQ.includes('sonar-recenter') && !htmlQ.includes('sonar-pending-hint'), 'Q2: SSR 初始无回正按钮/选中提示');
// Q3: 残段纯函数基线（确定性 hash·跨运行稳定）
const qLayout: MapLayout = {
  pos: { a: { x: 0, y: 0 }, b: { x: 80, y: 60 } },
  edges: [{ a: 'a', b: 'b' }],
  width: 100, height: 100,
};
const qFull = buildCaveGeometry(qLayout, ['a', 'b'], { a: 0, b: 0 });
const qStub = buildCaveGeometry(qLayout, ['a'], { a: 0 });
const qNone = buildCaveGeometry(qLayout, [], {});
// 06-13 重设计（作者）：单端揭示 → **敞口通道**伸向未扫端（不再短残段封口·洞穴固定·不完整揭示）。
const reachFromA = (g: { tuns: Array<{ ax: number; ay: number; bx: number; by: number }> }) =>
  g.tuns.reduce((m, t) => Math.max(m, Math.hypot(t.bx, t.by), Math.hypot(t.ax, t.ay)), 0); // 距 a(0,0) 最远
assert(qNone.tuns.length === 0 && qNone.rooms.length === 0, 'Q3: 无揭示 → 不画任何几何（防剧透不破）');
assert(qStub.rooms.length >= 1 && qStub.tuns.length >= 1, 'Q3: 单端揭示 → 有房间 + 通向未知端的敞口通道');
assert(reachFromA(qStub) > 0.8 * Math.hypot(80, 60), 'Q3: 敞口通道伸到未扫端附近（不再短残段·作者 06-13：不完整洞穴而非闭合墙）');
assert(qStub.tuns[0].r > qStub.tuns[qStub.tuns.length - 1].r, 'Q3: 通道向未知端逐渐收窄（敞口没入黑暗）');
L('  洞穴空记忆非空态(开阔仍空态) · SSR 无交互态残留 · 敞口通道伸向未扫端并收窄 ✓');
// Q4: 取景钳制（作者 06-13「向上拖拽把洞穴拖出框」）——任意离谱平移后 viewBox 都夹在内容 ±margin 内。
// vbY = clampViewCenter(center, vh, height) − vh/2；断言上拖（center→−∞）后 vbY ≥ −margin（洞顶永不被拖出框顶）。
{
  const MARGIN = 40, vh = 300, height = 477;
  const cyUp = clampViewCenter(24 + -999999, vh, height, MARGIN); // here.y=24（洞顶）·疯狂上拖
  const vbYUp = cyUp - vh / 2;
  assert(vbYUp >= -MARGIN - 1e-6, `Q4: 上拖到底 vbY(${vbYUp.toFixed(1)}) ≥ −margin(−${MARGIN})＝洞穴甩不出框顶`);
  const cyDown = clampViewCenter(24 + 999999, vh, height, MARGIN); // 疯狂下拖
  const vbYDown = cyDown - vh / 2;
  assert(vbYDown + vh <= height + MARGIN + 1e-6, `Q4: 下拖到底 viewBox 底(${(vbYDown + vh).toFixed(1)}) ≤ 内容底+margin＝甩不出框底`);
  // 短内容（取景窗 > 内容+2margin）→ 居中锁定
  const cyShort = clampViewCenter(24 + -999999, 300, 120, MARGIN);
  assert(Math.abs(cyShort - 60) < 1e-6, 'Q4: 内容比取景窗小 → 居中(extent/2)·锁平移');
  L('  取景钳制：上/下拖到底都夹在内容±margin、短内容居中锁定（向上拖不出框）✓');
}
// Q5: bakeCaveRGBA 烤出「整张全亮的洞」底图（几何圆战争迷雾三态改在合成层做·作者 06-13 重设计）：
//     水道像素有色不透明 / 洞外岩石透明。黑/暗/亮三态＝rAF 合成层 clip 到「扫描中心圆」（非纯函数·肉眼 dev 验）。
{
  const fogLayout: MapLayout = { pos: { a: { x: 30, y: 30 }, b: { x: 120, y: 120 } }, edges: [{ a: 'a', b: 'b' }], width: 160, height: 160 };
  const rect = { x: 0, y: 0, w: 160, h: 160 };
  const W = 160, H = 160;
  const px = (buf: Uint8ClampedArray, x: number, y: number) => { const i = (Math.round(y) * W + Math.round(x)) * 4; return { r: buf[i], a: buf[i + 3] }; };
  const cave = buildCaveGeometry(fogLayout, ['a', 'b'], { a: 0, b: 0 });
  const buf = bakeCaveRGBA(cave, rect, W, H);
  assert(px(buf, 30, 30).a > 0, 'Q5: 烤图水道像素不透明（全亮底图·三态遮罩移到合成层几何圆）');
  assert(px(buf, 158, 2).a === 0, 'Q5: 洞外岩石透明（露面板暗底＝岩）');
  L('  bakeCaveRGBA 全亮底图：水道不透明 / 洞外透明（三态几何圆遮罩在合成层·肉眼 dev 验）✓');
}

// ============================================================
// R. 猎手 blip 路由落点（06-11 作者「红点出墙」修复·纯函数直测）
//    守则：①edgeRoutePts 方向无关（a→b 反转 == b→a·同一条曲线）②端点=房心
//    ③blip 落点在渲染同源路由折线上（点到折线距离≈0＝永远在画出来的水道里）
//    ④远端未扫 → 截进残段口内（弧长 ≤ STUB 预算）⑤双端未扫 → null（回退直线）
// ============================================================
L('\n========== R. 猎手 blip 路由落点（红点不出墙） ==========');
const rAB = edgeRoutePts(qLayout, 'a', 'b')!;
const rBA = edgeRoutePts(qLayout, 'b', 'a')!;
assert(!!rAB && !!rBA && rAB.length === rBA.length, 'R1: 两个方向都取得到路由');
const rRev = [...rBA].reverse();
assert(
  rAB.every((p, i) => Math.abs(p.x - rRev[i].x) < 1e-9 && Math.abs(p.y - rRev[i].y) < 1e-9),
  'R1: 方向无关——a→b 与 b→a 反转是同一条曲线（blip 与隧道不会各画各的）',
);
assert(
  Math.hypot(rAB[0].x - 0, rAB[0].y - 0) < 1e-9 && Math.hypot(rAB[rAB.length - 1].x - 80, rAB[rAB.length - 1].y - 60) < 1e-9,
  'R2: 路由端点 = 房心',
);
const distToPolyline = (p: { x: number; y: number }, pts: Array<{ x: number; y: number }>) => {
  let best = Infinity;
  for (let i = 0; i + 1 < pts.length; i++) {
    const ax = pts[i].x, ay = pts[i].y, bx = pts[i + 1].x, by = pts[i + 1].y;
    const vx = bx - ax, vy = by - ay;
    const L2 = vx * vx + vy * vy || 1;
    const t = Math.max(0, Math.min(1, ((p.x - ax) * vx + (p.y - ay) * vy) / L2));
    best = Math.min(best, Math.hypot(p.x - (ax + vx * t), p.y - (ay + vy * t)));
  }
  return best;
};
const arcOf = (p: { x: number; y: number }, pts: Array<{ x: number; y: number }>) => {
  // p 在折线上的弧长（沿段累计·p 由 stalkerRoutePoint 给出必在某段上）
  let acc = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    const segLen = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
    const dOnSeg = Math.hypot(p.x - pts[i].x, p.y - pts[i].y);
    if (distToPolyline(p, [pts[i], pts[i + 1]]) < 1e-6 && dOnSeg <= segLen + 1e-6) return acc + dOnSeg;
    acc += segLen;
  }
  return acc;
};
const rTotal = rAB.reduce((s, p, i) => (i === 0 ? 0 : s + Math.hypot(p.x - rAB[i - 1].x, p.y - rAB[i - 1].y)), 0);
// ③ 双端都扫过：t=0/1 → 端点；t=0.5 → 在路由折线上（不出墙）
const rBoth = { a: 0, b: 0 };
const rp0 = stalkerRoutePoint(qLayout, 'a', 'b', 0, rBoth)!;
const rp1 = stalkerRoutePoint(qLayout, 'a', 'b', 1, rBoth)!;
const rpMid = stalkerRoutePoint(qLayout, 'a', 'b', 0.5, rBoth)!;
assert(Math.hypot(rp0.x - 0, rp0.y - 0) < 1e-6 && Math.hypot(rp1.x - 80, rp1.y - 60) < 1e-6, 'R3: t=0/1 落在两端房心');
assert(distToPolyline(rpMid, rAB) < 1e-6, 'R3: t=0.5 落在路由折线上（不再用房心直线＝不出墙）');
// ④ 只扫过 from 端：t=0.9 被截进残段口内（弧长 ≤ STUB_FRAC×0.92×总长 + ε）
const rpStub = stalkerRoutePoint(qLayout, 'a', 'b', 0.9, { a: 0 })!;
assert(distToPolyline(rpStub, rAB) < 1e-6, 'R4: 截断后仍在路由上');
assert(arcOf(rpStub, rAB) <= rTotal * 0.38 * 0.92 + 1e-6, 'R4: 远端未扫 → 弧长截进残段预算（不画进黑岩）');
// 只扫过 to 端：t=0.1 被推到靠 to 的残段内
const rpStubB = stalkerRoutePoint(qLayout, 'a', 'b', 0.1, { b: 0 })!;
assert(arcOf(rpStubB, rAB) >= rTotal * (1 - 0.38 * 0.92) - 1e-6, 'R4b: 只认得对面端 → 推进对面残段口内');
// ⑤ 双端都没扫 → null（调用方回退旧直线）
assert(stalkerRoutePoint(qLayout, 'a', 'b', 0.5, {}) === null, 'R5: 双端未扫 → null 回退');
// ⑥ 猎手 fix 锚点渲染侧并入（06-11 二修「红点仍刷在墙外」）：
//    纯函数侧——锚点以 -1 哨兵并入 memory 后，buildCaveGeometry 必画出它那间房（红点有水可站）；
//    组件侧——猎手定位在 scanMemory 完全没有的节点 → blip 与洞穴 canvas 仍同时在（几何随 fix 锚点出现）。
const qMerge = buildCaveGeometry(qLayout, ['b', 'a'], { b: 0, a: -1 });
assert(
  qMerge.rooms.some((r) => Math.hypot(r.x - 0, r.y - 0) <= r.r + 1),
  'R6: fix 锚点并入后画出它那间房（blip 永远站在水里）',
);
const rStalkerUnscanned: GameState = {
  ...createInitialGameState(),
  run: {
    ...owMazeRun,
    scanMemory: { m0: 0 }, // m1 从没扫进测绘——但猎手上次被扫到在 m1
    alert: 60,
    stalker: {
      nodeId: 'm1', sensesBy: 'sound', onLostSignal: 'wait', waitTurns: 0, state: 'hunting',
      encounterId: 'combat.blind_eel_solo', lastSignalNodeId: 'm0', turnsSinceSignal: 0, waitedTurns: 0,
      seenNodeId: 'm1', seenTurn: 0,
    },
  },
  phase: { kind: 'dive', subPhase: { kind: 'nodeSelect', choices: [] } },
};
const htmlR6 = renderToStaticMarkup(
  <NodeSelectView state={rStalkerUnscanned} choices={choicesFor(owMazeMap, 'm0')} onStateChange={noop} />,
);
assert(
  htmlR6.includes('sonar-stalker') && htmlR6.includes('sonar-cave-canvas'),
  'R6: 未扫节点上的猎手 → 红 blip 与洞穴 canvas 同在（锚点房间渲染侧并入）',
);
// ⑦ 出墙最后一道闸 projectIntoWater（06-11 三修）：岩里的点投影后必在水里（caveSdf ≤ WALL_LO−1.2）；
//    本来就在水里的点原样返回（零扰动）。
const rMid = { x: (0 + 80) / 2 + 28, y: (0 + 60) / 2 - 28 }; // 路由中段法向偏出 ~40px——大概率在岩里
const rProj = projectIntoWater(rMid, qFull);
assert(caveSdf(rProj.x, rProj.y, qFull.tuns, qFull.rooms) <= WALL_LO - 1.2 + 1e-6, 'R7: 投影后必落在水里（SDF 当裁判）');
const rInWater = projectIntoWater({ x: 0, y: 0 }, qFull); // 房心=水
assert(rInWater.x === 0 && rInWater.y === 0, 'R7: 已在水里的点零扰动');
L('  方向无关 · 端点=房心 · blip 永在路由上 · 残段双向截断 · 无知态回退 · fix 锚点并入有水可站 · SDF 投影闸 ✓');

// ============================================
// S. 章节哨站：OutpostPopup 锁态(暗·待解锁)/点亮(已点亮·无蛙跳·灯塔/蛙跳重构 step ③+作者 06-14)。
//    章节蛙跳已删——章节 band 改走数据驱动深度柱派生的深入 POI（#131）。SSR 直渲 popup 验（OutpostPopup 已 export）。
// ============================================
L('\n========== S. 章节哨站 popup ==========');
// 锁态：wreck 锚点未到 → OutpostPopup 显示「暗 · 待解锁」+ 解锁提示。
const sLockState = stateWith(['flag.tutorial_complete'], []);
const htmlSLock = renderToStaticMarkup(
  <OutpostPopup outpostId="outpost.ch1_wreck" state={sLockState} onStateChange={noop} onDive={noop} onClose={noop} />,
);
assert(htmlSLock.includes('隐约可见 · 还没路'), 'S: 锚点未到的章节前哨 popup 显示锁态「隐约可见 · 还没路」');
assert(htmlSLock.includes('走到附近'), 'S: 锁态给解锁提示');
// 点亮态：wreck 锚点 + 残骸前哨三阶 → OutpostPopup 显「已点亮」·不再出「从此处下潜」（章节蛙跳已删→深入 POI）。
const sLitChap = litOutpostState({ outpostId: 'outpost.ch1_wreck', resultLh: WRECK_OUTPOST_LH });
const sLitChapWithAnchor: GameState = {
  ...sLitChap,
  profile: { ...sLitChap.profile, flags: new Set([...sLitChap.profile.flags, 'story.ch1.anchor.wreck']) },
};
const htmlSLit = renderToStaticMarkup(
  <OutpostPopup outpostId="outpost.ch1_wreck" state={sLitChapWithAnchor} onStateChange={noop} onDive={noop} onClose={noop} />,
);
assert(!htmlSLit.includes('从此处下潜'), 'S: 章节前哨蛙跳已删（改深入 POI·作者 06-14）→ popup 不再出「从此处下潜」');
assert(htmlSLit.includes('灯亮着'), 'S: 点亮态状态显示「灯亮着」');
L('  章节前哨 popup 锁态(暗·待解锁)/点亮(已点亮·无蛙跳·改深入 POI) ✓');

// ============================================
// T. LockerView · 剧情/其它/装备归类 + 文献正文 + 文献坐标（#140 续·作者 2026-06-18）
//   剧情（tab id 'journal'·label「剧情」）＝图鉴 + 见闻 + 剧情道具（category='story' 且非海图信物：航海日志/指南针）。
//   其它＝杂项 + **海图信物 旧海图**（story+opensChart→点开看详情：描述 + 摊开海图·坐标已迁导师日志#142）；装备件归装备 tab。
//   文献正文：道具 unlocksLoreEntry 已读 → 详情显 lore 正文（航海日志）。
//   文献坐标：道具 story.marksPois → 详情陈列坐标（可达的可点→onOpenChartAt 跳海图选中·旧海图标记一章四锚点）。
//   initialTab / initialDetail 钩子直渲 tab/详情（SSR 无法点击切换）。
// ============================================
L('\n========== T. LockerView 剧情/其它/文献正文+坐标 (#140 续) ==========');
const TLock = { ...stateWith(['flag.tutorial_complete'], []) };
TLock.profile = {
  ...TLock.profile,
  loreEntries: new Set(['lore.ch1.captains_page', 'lore.ch1.mentor_logbook']), // 已读船长日志 + 导师日志 → 文献正文可显
  inventory: [
    { itemId: 'item.captain_log', qty: 1 },  // 文献（→剧情·点开显 lore 正文）
    { itemId: 'item.mentor_logbook', qty: 1 }, // 文献·marksPois 四锚点（→剧情·点开显正文+坐标·#142）
    { itemId: 'item.rusty_compass', qty: 1 }, // 信物（→剧情）
    { itemId: 'item.old_chart', qty: 1 },     // 海图信物·opensChart（→其它·点开看描述/摊图·marksPois 已迁导师日志·#142）
    { itemId: 'item.dive_knife.standard', qty: 1 }, // 装备备件（→装备 tab）
  ],
};
// 剧情 tab：文献 + 指南针；旧海图不在
const htmlTStory = renderToStaticMarkup(
  <LockerView state={TLock} onStateChange={noop} onClose={noop} initialTab="journal" />,
);
assert(
  htmlTStory.includes('航海日志') && htmlTStory.includes('导师的半本日志') && htmlTStory.includes('锈蚀的指南针'),
  'T: 文献（航海日志/导师日志）+信物在「剧情」tab',
);
assert(!htmlTStory.includes('旧海图'), 'T: 海图信物「旧海图」不在「剧情」（归其它）');
// 其它 tab：旧海图在场（点开看详情）；文献/指南针/装备备件不在
const htmlTOther = renderToStaticMarkup(
  <LockerView state={TLock} onStateChange={noop} onClose={noop} initialTab="other" />,
);
assert(htmlTOther.includes('旧海图'), 'T: 海图信物「旧海图」在「其它」tab');
assert(
  !htmlTOther.includes('航海日志') && !htmlTOther.includes('锈蚀的指南针') && !htmlTOther.includes('潜水刀'),
  'T: 剧情道具/装备备件不在「其它」',
);
// 装备 tab：嵌入纸娃娃（作者 2026-06-20·B）——武器·主槽显穿戴的潜水刀（换装在此·升级/打造见 Otto）
const htmlTGear = renderToStaticMarkup(
  <LockerView state={TLock} onStateChange={noop} onClose={noop} initialTab="gear" />,
);
assert(htmlTGear.includes('潜水刀') && htmlTGear.includes('武器·主'), 'T: 装备 tab 嵌入纸娃娃·武器·主槽显潜水刀（装备归装备 tab）');
// 旧海图回退（#142）：详情只剩描述 + 摊开海图（坐标已迁导师日志·不再陈列坐标）
const htmlTChartDetail = renderToStaticMarkup(
  <LockerView
    state={TLock}
    onStateChange={noop}
    onClose={noop}
    onOpenChart={noop}
    onOpenChartAt={noop}
    initialDetail={{ kind: 'storyitem', itemId: 'item.old_chart' }}
  />,
);
assert(!htmlTChartDetail.includes('个坐标'), 'T: 旧海图详情不再陈列坐标（marksPois 已迁导师日志·#142）');
assert(htmlTChartDetail.includes('摊开海图'), 'T: 旧海图详情有「摊开海图」（opensChart + onOpenChart）');
// 导师日志详情（#142）：正文（lore 已读）+ 坐标列表 lead-in「最后是 N 个坐标」+ 可达坐标整行可点（直接跳·marksPois 已迁此）
const htmlTLogbook = renderToStaticMarkup(
  <LockerView
    state={TLock}
    onStateChange={noop}
    onClose={noop}
    onOpenChart={noop}
    onOpenChartAt={noop}
    initialDetail={{ kind: 'storyitem', itemId: 'item.mentor_logbook' }}
  />,
);
assert(htmlTLogbook.includes('前半本是导师的字'), 'T: 导师日志详情显示日志正文（lore.ch1.mentor_logbook 已读）');
assert(htmlTLogbook.includes('个坐标'), 'T: 导师日志详情有坐标列表 lead-in「最后是 N 个坐标」');
assert(htmlTLogbook.includes('locker-coord-row clickable'), 'T: 导师日志可达坐标整行可点（直接跳海图·无独立按钮·#142）');
assert(!htmlTLogbook.includes('摊开海图'), 'T: 导师日志非海图信物·详情无「摊开海图」');
// 海图未解锁（不传 onOpenChart）：详情不出「摊开整张海图」（不绕教学门）
const htmlTChartLocked = renderToStaticMarkup(
  <LockerView
    state={TLock}
    onStateChange={noop}
    onClose={noop}
    initialDetail={{ kind: 'storyitem', itemId: 'item.old_chart' }}
  />,
);
assert(!htmlTChartLocked.includes('摊开海图'), 'T: 海图未解锁→旧海图详情无「摊开海图」（不绕教学门）');
// 文献正文：航海日志详情→船长日志 lore 正文
const htmlTLogDetail = renderToStaticMarkup(
  <LockerView
    state={TLock}
    onStateChange={noop}
    onClose={noop}
    initialDetail={{ kind: 'storyitem', itemId: 'item.captain_log' }}
  />,
);
assert(htmlTLogDetail.includes('第七次见到它'), 'T: 航海日志详情显示船长日志正文（lore.ch1.captains_page 已登记）');
// 引擎（#142）：坐标已从旧海图迁到导师日志·resolveMarkedPois 解析 + displayCoord 派生
assert(itemMarkedPois('item.old_chart').length === 0, 'T: 旧海图 marksPois 已清空（迁导师日志）');
assert(itemMarkedPois('item.mentor_logbook').length === 4, 'T: 导师日志 marksPois = 4 锚点');
const markedLog = resolveMarkedPois(TLock.profile, itemMarkedPois('item.mentor_logbook'));
assert(markedLog.length === 4, 'T: resolveMarkedPois 解析 4 条坐标');
assert(
  markedLog.every((m) => m.displayCoord !== null && /^\d+\.\d+, \d+\.\d+$/.test(m.displayCoord)),
  'T: 每条坐标有 displayCoord（XX.X, Y.Y·从绝对 mapX/mapY 派生·单一来源 formatChartCoord）',
);
L('  剧情/其它/装备归类 · 文献正文可读 · 导师日志坐标(displayCoord)+旧海图回退摊图 · resolveMarkedPois ✓');

console.log(log.join('\n'));
console.log('\n✓ 海图 UI 冒烟测试通过');
