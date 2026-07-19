// 海图 UI 渲染冒烟测试 —— 覆盖 playthrough 脚本测不到的 React 层。
// 用 react-dom/server 把 SeaChartView / PortView 在关键 state 下渲染成静态标记，
// 断言：组件不抛错 + 关键串在/不在标记里（POI 名、锁定原因、出海按钮、海图入口、空态）。
//
// 跑法： npx tsx scripts/smoke-chart-ui.tsx

// @jsxRuntime automatic —— 独立脚本不在主 tsconfig include 内，tsx/esbuild 默认落 classic transform；
// 用 pragma 切回 automatic，与 typecheck（react-jsx·tsconfig.scripts.json）一致，无需 import React。
import { renderToStaticMarkup } from 'react-dom/server';
import { createInitialGameState, createNewRun } from '../src/engine/state';
import { devRevealOutpost } from '../src/engine/lighthouses';
import { SeaChartView, OutpostPopup, ChartInfo } from '../src/ui/SeaChartView';
import { PortView } from '../src/ui/PortView';
import { NodeSelectView } from '../src/ui/NodeSelectView';
import {
  buildCaveGeometry,
  edgeRoutePts,
  stalkerRoutePoint,
  projectIntoWater,
  caveSdf,
  bakeCaveRGBA,
} from '../src/ui/SonarScanPanel';
import { WALL_LO, clampViewCenter } from '../src/engine/sonarGeometry';
import type { MapLayout } from '../src/ui/mapLayout';
import { EventView } from '../src/ui/EventView';
import { FuneralView } from '../src/ui/CorpseView';
import { UpgradePanel } from '../src/ui/UpgradePanel';
import { MiraShopView } from '../src/ui/MiraShopView';
import { LighthouseBuildPanel } from '../src/ui/LighthouseBuildPanel';
import { LockerView } from '../src/ui/LockerView';
import type { GameState, InventoryItem, NodeChoice, FeatureChoice, DiveMap, ChartPoi } from '../src/types';
import { generateChart, isPoiDepartable } from '../src/engine/chart';
import { itemMarkedPois } from '../src/engine/items';
import { POST_TUTORIAL_HOME_ANCHORS } from './test-fixtures/chart-baseline';

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

// （withLogbook 助手 + MENTOR_LOGBOOK_ITEM_ID 已随白板收口删除：item.mentor_logbook / 四主线 beat 坐标内容已删。）

// （withHomeDockyard 助手已随 Section B 删除：旧灯塔礁 zone / 家灯塔船坞抵达门内容已删。）

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
//   陆坡前哨＝深水前哨（outpostOnly 满足·显示充电/制氧）。坐标/名取 result 灯塔（lighthouse_upgrades.json）。
//   （能源容量门控 + 水力发电/currentOnly 已删·2026-06-21。）
const SLOPE_OUTPOST_LH = { id: 'lighthouse.ch1_slope_outpost', name: '陆坡前哨', mapX: 0.3, mapY: 0.69 };

// ============================================
// A. SeaChartView · 教学后无升级 → 区域揭示配置化：家区曾有迁 home 的蓝洞群 anchor（§7·cave-chart）；
//    home 灯塔标记恒显（点它开灯塔设施面板）。
// ============================================
L('========== A. 教学后 · 无升级（洞穴内容整删·家区已无非剧情 anchor）==========');
// 白板收口（2026-07-12）+ 洞穴内容整删（同日续）：27 条真实洞穴 zone（含蓝洞群）+ zone.the_deep_gate 已删，
// chart_pois.json 现仅剩 poi.anchor.warren（被 flag.warren_discovered 门住，本状态未置该 flag ⇒ 不出现）——
// 家区教学后无任何可去点、无出海按钮，此为已知/接受状态（见 QUIRKS），非待修 bug。剩余断言只验：海图标题 +
// 出海按钮不出现（零可去点）+ home 灯塔标记恒显。
const A = stateWith(['flag.tutorial_complete'], []);
const htmlA = renderToStaticMarkup(<SeaChartView state={A} onStateChange={noop} />);
assert(htmlA.includes('海图'), 'A: 应渲染海图标题');
assert(!htmlA.includes('出海'), 'A: 洞穴内容整删后家区零可去点 ⇒ 不应有出海按钮（已知/接受状态）');
// home anchor 可见性（chart-baseline 单一真相·#171）：POST_TUTORIAL_HOME_ANCHORS 现为空数组
// （唯一存活 anchor poi.anchor.warren 门在 flag.warren_discovered 后面，本状态未置该 flag）。
assert(POST_TUTORIAL_HOME_ANCHORS.length === 0, 'A: 洞穴内容整删后家区非剧情 anchor 列表应为空');
// A2. 洞穴内容整删后 chart.pois.length===0 ⇒ SeaChartView 整张地图（含灯塔标记）被 chart-empty 空态提示
//     取代（SeaChartView.tsx:485 起的既有分支——本就为「教学前」空图设计，这里是「教学后仍空」边缘态触发同一分支）。
//     这不是渲染 bug：灯塔标记与地图本体一起让位给「海图上还没有你能去的点」提示，符合零可去点的已知状态。
assert(htmlA.includes('chart-empty'), 'A2: 零可去点 ⇒ 应落 chart-empty 空态分支（非灯塔标记·SeaChartView.tsx:485）');
assert(htmlA.includes('海图上还没有你能去的点'), 'A2: 教学后仍空 ⇒ 提示「先完成资格潜水」文案');
assert(!htmlA.includes('灯塔：旧灯塔'), 'A2: 空态分支不渲染灯塔标记（与 chart.pois.length===0 分支互斥·已知行为）');
L('  渲染成功：海图标题 + 零可去点(已知)⇒ chart-empty 空态（灯塔标记随之不渲染，非 bug）✓');

// （Section B「教学后 + 家灯塔船坞 → 灯塔礁解锁」已删 —— 白板收口：旧灯塔礁 zone 已删。）

// ============================================
// C. SeaChartView · 教学前 → 空态
// ============================================
L('\n========== C. 教学前 · 空态 ==========');
const C = stateWith([], []);
const htmlC = renderToStaticMarkup(<SeaChartView state={C} onStateChange={noop} />);
assert(htmlC.includes('找 Aldo'), 'C: 教学前空态应提示去找 Aldo（首潜唯一入口·playtest 报告②·改后空态文案）');
assert(!htmlC.includes('蓝洞群'), 'C: 教学前不应出现任何 POI（蓝洞群＝教学后才随家区揭示的家 anchor）');
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
function diveState(opts?: { visibility?: 'dark'; sonarUnlocked?: boolean }): GameState {
  const base = createInitialGameState();
  const r0 = createNewRun({
    zoneId: 'zone.vertical_test',
    bonuses: { sonarUnlocked: opts?.sonarUnlocked },
  });
  const run = {
    ...r0,
    currentDepth: 20,
    currentNodeId: 'n0',
    diveModifier: opts?.visibility ? { gate: { sense: 'lamp' as const, mode: 'locked' as const } } : undefined,
  };
  return {
    ...base,
    run,
    phase: { kind: 'dive', subPhase: { kind: 'nodeSelect', choices: [] } },
  };
}
// 引擎已按档烤好 preview；UI 渲染器只读 choice.clarity 配样式。
const truthChoice: NodeChoice[] = [
  { nodeId: 'n1', depth: 25, zoneTag: 'slope', preview: '一段倾斜的礁壁。', clarity: 'full' },
];
const blindChoice: NodeChoice[] = [
  { nodeId: 'n1', depth: 25, zoneTag: 'slope', preview: '看不清，一团黑影。', clarity: 'none' },
];
const sonarChoice: NodeChoice[] = [
  { nodeId: 'n1', depth: 25, zoneTag: 'slope', preview: '回波画出一处空腔，边缘是乱石。', clarity: 'sonar' },
];

const htmlTruth = renderToStaticMarkup(
  <NodeSelectView state={diveState()} choices={truthChoice} onStateChange={noop} />,
);
assert(htmlTruth.includes('一段倾斜的礁壁'), 'E: full 档渲染地面真相预览');
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

// E1b. NodeSelectView · 灯门锁住渲染（感知重做 SPEC §2.1·车道 3）：黑处无灯的节点＝可见但锁住——
//   照画、带 .locked 样式类 + disabled + 「需要灯」标；点击拦截由 handlePick 兜底（列表是唯一 move 路径·渲染层是拦截单点）。
const lockedChoice: NodeChoice[] = [
  { nodeId: 'n1', depth: 25, zoneTag: 'slope', preview: '太暗，看不清——需要灯', clarity: 'none', locked: true },
];
const htmlLocked = renderToStaticMarkup(
  <NodeSelectView state={diveState({ visibility: 'dark' })} choices={lockedChoice} onStateChange={noop} />,
);
assert(htmlLocked.includes('event-option locked') || / class="[^"]*\blocked\b[^"]*"/.test(htmlLocked), 'E1b: locked 节点应带 .locked 样式类');
assert(htmlLocked.includes('需要灯'), 'E1b: locked 节点应渲染「需要灯」标');
assert(htmlLocked.includes('disabled'), 'E1b: locked 节点按钮应 disabled（不可选）');
// 非 locked（普通盲航 none 档）不应带 .locked / 「需要灯」——确保锁只落在 locked 节点上（对照组）。
assert(!htmlBlind.includes('需要灯') && !/ class="[^"]*\blocked\b[^"]*"/.test(htmlBlind), 'E1b: 非 locked 盲航节点不带锁标（对照组）');
L('  灯门锁住：可见但 disabled + 需要灯标 / 非 locked 对照无锁 ✓');

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

// E3. NodeSelectView · 单向下潜预告——白板收口：层状（开阔水域）zone 全删，现存 zone 均为迷路/洞穴（可回头）。
//   原「层状 zone 给『只往下通』」正向断言随其 zone（wreck_graveyard 等）删除；只留迷路图 zone 不给预告的负向分支。
const md = diveState();
const mazeDive: GameState = { ...md, run: { ...md.run!, zoneId: 'zone.vertical_test' } };
const htmlMaze = renderToStaticMarkup(
  <NodeSelectView state={mazeDive} choices={truthChoice} onStateChange={noop} />,
);
assert(!htmlMaze.includes('只往下通'), 'E3: 迷路图（蓝洞群）zone 能回头 → 不给单向预告（免得误导）');
L('  迷路图不给单向预告（层状 zone 已删·正向分支随之移除）✓');

// E4. NodeSelectView · 声呐探索图（声呐与房间 SPEC §5/§7 S0）：
//   解锁声呐 → 面板出现；未 ping → 全黑空态；有扫描记忆 → 画出 blip + 深度 + 残图小地图；未解锁 → 无面板
L('\n========== E4. NodeSelectView 声呐探索图 (S0) ==========');
function sonarMap(): DiveMap {
  return {
    zoneId: 'zone.vertical_test',
    generatedAt: 0,
    startNodeId: 'n0',
    nodes: {
      n0: { id: 'n0', layer: 0, depth: 30, zoneTag: 'slope', kind: 'event', connectsTo: ['n1'], preview: '' },
      n1: { id: 'n1', layer: 1, depth: 38, zoneTag: 'slope', kind: 'ascent_point', connectsTo: [], preview: '' },
    },
  };
}
function sonarState(opts?: { scanned?: boolean; sonarUnlocked?: boolean }): GameState {
  const base = createInitialGameState();
  const r0 = createNewRun({
    zoneId: 'zone.vertical_test',
    bonuses: { sonarUnlocked: opts?.sonarUnlocked ?? true },
  });
  // 声呐无升级化（2026-07-19）：迷雾态收敛成 lastScanTurn 标量——scanned＝本潜 ping 过（全图具名·灰/亮）；
  // 缺省＝没 ping 过（全黑·「? m」）。旧逐节点 scanMemory/scanOrigins 表已删。
  const run = {
    ...r0, map: sonarMap(), currentDepth: 30, currentNodeId: 'n0', turn: 0,
    ...(opts?.scanned ? { lastScanTurn: 0 } : {}),
  };
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
// 解锁声呐、未扫过（空记忆）→ 面板在（三层解耦后无空态早退：全黑迷雾 + 位置点标记照常·Q1 专测）。
const htmlSonarEmpty = renderToStaticMarkup(
  <NodeSelectView state={sonarState()} choices={sonarAdj} onStateChange={noop} />,
);
assert(htmlSonarEmpty.includes('声呐图'), 'E4: 解锁声呐应渲染声呐图面板');
// 本潜 ping 过（lastScanTurn 有记）→ canvas 有机洞穴剖面 + 相邻可去节点可点标记(§2) + 你 + 残图小地图
const htmlSonarMapped = renderToStaticMarkup(
  <NodeSelectView state={sonarState({ scanned: true })} choices={sonarAdj} onStateChange={noop} />,
);
assert(htmlSonarMapped.includes('sonar-cave-canvas'), 'E4: 已扫过 → 画有机洞穴 canvas（声呐渲染重做 §2）');
assert(htmlSonarMapped.includes('sonar-blip'), 'E4: 相邻可去节点画可点标记 blip（§2）');
assert(htmlSonarMapped.includes('sonar-node-marker'), 'E4: 相邻节点标记可点（sonar-node-marker·点击＝move）');
assert(htmlSonarMapped.includes('sonar-you'), 'E4: 画出你的呼吸点（§5 观感·青·不要 X）');
assert(htmlSonarMapped.includes('38m'), 'E4: 相邻节点标注深度（n1=38m）');
assert(!htmlSonarMapped.includes('sonar-mini'), 'E4: 残图小地图已删（#316·已扫全图点位泄拓扑）');
assert(!htmlSonarMapped.includes('sonar-node-far'), 'E4: 非相邻定位标记已删（#316·只画能抵达的 + 敌）');
// 声呐一记 ping 按钮（感知重做 SPEC §2.2「ping 才扫、不 ping 不扫」）：解锁声呐 → 给「扫一记」ping 按钮（单动作·付电+暴露）。
assert(htmlSonarEmpty.includes('sonar-ping'), 'E4: 解锁声呐 → 给「扫一记」ping 按钮 (sonar-ping·§2.2)');
assert(htmlSonarEmpty.includes('扫一记'), 'E4: ping 按钮显示「扫一记」（一记诚实 ping）');
// 未解锁声呐 → 无声呐图面板（软门控：声呐图随声呐解锁才有，SPEC §8.6）
const htmlNoSonar = renderToStaticMarkup(
  <NodeSelectView state={sonarState({ scanned: true, sonarUnlocked: false })} choices={sonarAdj} onStateChange={noop} />,
);
assert(!htmlNoSonar.includes('声呐图'), 'E4: 未解锁声呐不应渲染声呐图面板');
assert(!htmlNoSonar.includes('sonar-ping'), 'E4: 未解锁声呐 → 无 ping 按钮');
L('  解锁→面板/空态 · 有记忆→canvas洞穴+相邻可点标记+你+残图 · 一记 ping 按钮(§2.2) · 未解锁→无面板 ✓');

// ============================================
// E4c. SonarScanPanel · 洞穴声呐图（声呐渲染重做 §2/§3）：
//   白板收口——开放水域（层状）zone 全删（is-open-water 正向分支随其 zone 移除·is-open-water = !zoneAllowsBacktrack·
//   现存 zone 均可回头→恒 false）。只留迷路洞穴（blue_caves·maze）分支：非 open-water·canvas 画有机洞穴剖面 + 相邻可点标记。
// ============================================
L('\n========== E4c. SonarScanPanel 洞穴声呐图 (§2/§3) ==========');
// 迷路洞穴（blue_caves·maze）：非 open-water·canvas 画有机洞穴剖面
const owMazeMap: DiveMap = {
  zoneId: 'zone.vertical_test', generatedAt: 0, startNodeId: 'm0',
  nodes: {
    m0: { id: 'm0', layer: 0, depth: 50, zoneTag: 'cave', kind: 'event', connectsTo: ['m1'], preview: '' },
    m1: { id: 'm1', layer: 1, depth: 56, zoneTag: 'cave', kind: 'event', connectsTo: [], preview: '' },
  },
};
const owMazeRun = {
  ...createNewRun({ zoneId: 'zone.vertical_test', bonuses: { sonarUnlocked: true } }),
  map: owMazeMap, currentDepth: 50, currentNodeId: 'm0', turn: 0,
  lastScanTurn: 0, // 本潜 ping 过（全图揭示·声呐无升级化）
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
L('  迷路洞穴画有机洞穴剖面 · 有 canvas+相邻标记（开放水域层状 zone 已删·is-open-water 正向分支移除）✓');

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
  zoneId: 'zone.vertical_test',
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
  const r0 = createNewRun({ zoneId: 'zone.vertical_test', bonuses: { sonarUnlocked: true } });
  const run = { ...r0, map: roomSonarMap, currentDepth: 120, currentNodeId: 'n0', turn: 0, lastScanTurn: 0 };
  return { ...base, run, phase: { kind: 'dive', subPhase: { kind: 'nodeSelect', choices: [] } } };
}
const htmlRoomSonar = renderToStaticMarkup(
  <NodeSelectView state={roomSonarState()} choices={choicesFor(roomSonarMap, 'n0')} onStateChange={noop} />,
);
assert(htmlRoomSonar.includes('is-room'), 'E5: 声呐图把相邻的多 feature 房间画成大轮廓 (is-room)');
assert(htmlRoomSonar.includes('sonar-feature-dot'), 'E5: 房间轮廓里画 feature blip');
L('  凑近看组 / 向后兼容无组 / 声呐房间轮廓+feature blip ✓');

// ============================================
// E6. SonarScanPanel · 不可信扫描（spoof 假信标 / evade 无回波 / 低 san 乱码+伪接触）：
//   **感知重做已删**——声呐诚实、欺骗移交低理智轴（SPEC §2.2/§2.3/§3）；整节连同 decMap/deceptionSonarState 移除。
// ============================================

// ============================================
// E7. SonarScanPanel · 威胁定位（S3 廉价版琥珀）：**整节随 #316 删除**——琥珀接触是 alert 驱动、方位按 turn
//   漂移＝不扫描也每回合动，与「信息只在扫描时更新」相悖（作者拍板删掉）。断言反转并入 E8（无 sonar-threat）。
// ============================================

// ============================================
// E8. SonarScanPanel · 猎手精确定位（猎手 SPEC §2.1「声呐＝知道它在哪」·§8.7 只在被扫到时更新）：
//   声呐定位过（seenNodeId）→ 精确深红 blip (sonar-stalker)；没定位过 → 什么都不画
//   （琥珀模糊接触已删 #316——没 ping 到就没有信息）。
// ============================================
L('\n========== E8. SonarScanPanel 猎手精确定位 (猎手 Phase 1) ==========');
const threatBase = sonarState({ scanned: true });
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
assert(!htmlStalkerFix.includes('sonar-threat'), 'E8: 琥珀威胁接触已删（#316·任何状态都不画）');
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
assert(!htmlStalkerVague.includes('sonar-threat'), 'E8: 没定位过也没有琥珀回落（#316·没 ping 到就没有信息）');
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
L('  声呐定位→精确 blip / 未定位→无信息(琥珀已删) / 大型生物→一大团 / 有猎手→迎战按钮 ✓');

// ============================================
// W. SonarScanPanel · 女王常显（The Warren·#316 作者拍板「扫过后实时常显」）：
//   本潜 ping 过 + warrenHunt.queenNodeId → 画女王大红标记（实时真实位置·唯一实时敌显·boss 特权）；
//   没扫过 → 不画（图还全黑·信息仍要先 ping 一次换）。
// ============================================
L('\n========== W. SonarScanPanel 女王常显 (#316) ==========');
const queenScanned: GameState = {
  ...threatBase, // scanned:true 基座
  run: { ...threatBase.run!, warrenHunt: { roomsCleared: 0, queenNodeId: 'n1' } },
};
const htmlQueen = renderToStaticMarkup(
  <NodeSelectView state={queenScanned} choices={[]} onStateChange={noop} />,
);
assert(htmlQueen.includes('sonar-queen'), 'W: 已扫 + 女王在图 → 画女王标记 (sonar-queen)');
const queenUnscanned: GameState = {
  ...sonarState(), // 没 ping 过
  run: { ...sonarState().run!, warrenHunt: { roomsCleared: 0, queenNodeId: 'n1' } },
};
const htmlQueenDark = renderToStaticMarkup(
  <NodeSelectView state={queenUnscanned} choices={[]} onStateChange={noop} />,
);
assert(!htmlQueenDark.includes('sonar-queen'), 'W: 没扫过 → 不画女王（图还全黑·先 ping 一次换信息）');
// 实时常显（非快照）：她撤退（queenNodeId 变）→ 标记位置跟着走（同一 scanned run·只换 queenNodeId ⇒ 输出不同）。
const queenMoved: GameState = {
  ...threatBase,
  run: { ...threatBase.run!, warrenHunt: { roomsCleared: 1, queenNodeId: 'n0' } },
};
const htmlQueenMoved = renderToStaticMarkup(
  <NodeSelectView state={queenMoved} choices={[]} onStateChange={noop} />,
);
assert(htmlQueenMoved.includes('sonar-queen') && htmlQueenMoved !== htmlQueen, 'W: 她撤退 → 标记跟着走（实时·非扫描快照）');
L('  已扫→女王常显 / 没扫→不画 / 撤退→标记实时跟随 ✓');

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
    depthAtDeath: 140,
    // 放在"默认选中"的 zone（zone.warren·当前唯一真实可出海 POI poi.anchor.warren 所在 zone——
    // 洞穴内容整删后 chart_pois.json 仅剩这一条，f2Poi 只会解析到它，listRecoverableCorpses 按 poi.zoneId
    // 精确匹配 death.zoneId，两者必须同 zone 才能在「选目标」下拉里配对上）
    zoneId: 'zone.warren',
    zoneTag: 'cave',
    cause: '氧气耗尽',
    inventorySnapshot: [{ itemId: 'item.eel_skin', qty: 1 }],
    goldAtDeath: 0,
    recovered: false,
    diedOnDay: 0,
    timestamp: 0,
  };
  return {
    ...base,
    profile: {
      ...base.profile,
      // 洞穴内容整删（2026-07-12）：chart_pois.json 现仅剩 poi.anchor.warren（flag.warren_discovered 门住）。
      // 测试专用：这里置该 flag 只为让本节有一个真实可出海 POI 可测「选目标」UI 流程，不代表真实玩法已解锁 Warren。
      flags: new Set(['flag.tutorial_complete', 'flag.warren_discovered']),
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
const f2Poi = (f2Chart.find((p) => isPoiDepartable(F2.profile, p) && p.zoneId === 'zone.vertical_test')
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
// 洞穴内容整删（2026-07-12）：blue_caves.geode_vein 随 zone.blue_caves 一并删除；EVENT_DB 现只剩
// events/qa_fixture.json 的 qa.fixture_event（非叙事 QA 夹具，专为保住本回归守卫）。
const htmlEv = renderToStaticMarkup(
  <EventView state={evState} eventId="qa.fixture_event" onStateChange={noop} />,
);
assert(!htmlEv.includes('事件未找到'), 'H: 非教学事件应能解析（不应出现"事件未找到"）');
assert(htmlEv.includes('测试用事件'), 'H: 应渲染 qa.fixture_event 的标题');
L('  非教学事件（QA 夹具）正常渲染 ✓');

// ============================================
// I. FuneralView · D-reveal 程生姓名故障化（按 deaths.length / 揭示 flag）
// ============================================
L('\n========== I. FuneralView D-reveal ==========');
function deathRec(id: string) {
  return {
    id, runId: 'r', diverName: 'Marek', depthAtDeath: 40,
    zoneId: 'zone.vertical_test', zoneTag: 'cave', cause: '氧气耗尽',
    inventorySnapshot: [], goldAtDeath: 0, recovered: false, diedOnDay: 0, timestamp: 0,
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
// 用仍为全局的打捞行会 lv1（scrap×3, brass×3 ＋ 30 金·coral→scrap 经济 2026-06-28）做账单三态（dockyard 已迁灯塔设施）
// J1. 材料 + 金币都够 → 出现"修缮"按钮 + 账单列出材料名与金币
const J1 = upgradeState([{ itemId: 'item.scrap_alloy', qty: 3 }, { itemId: 'item.brass_fitting', qty: 3 }], 50);
const htmlJ1 = renderToStaticMarkup(<UpgradePanel state={J1} onStateChange={noop} onClose={noop} />);
assert(htmlJ1.includes('废合金') && htmlJ1.includes('3/3'), 'J1: 账单列材料名 + 已有/需求（废合金 3/3·UpgradeCostView）');
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
assert(htmlJ2.includes('0/3'), 'J2: 缺口显已有/需求（废合金 0/3·不足标红·coral→scrap 经济 2026-06-28）');
// J3. 材料够、金币不够 → 按钮"金币不足" + 金币格"5/30"
const J3 = upgradeState([{ itemId: 'item.scrap_alloy', qty: 3 }, { itemId: 'item.brass_fitting', qty: 3 }], 5);
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
// 洞穴内容整删（2026-07-12）：chart_pois.json 现仅剩 poi.anchor.warren（flag.warren_discovered 门住）。
// 测试专用置该 flag，让 chart.pois.length>0 走渲染分支（而非 chart-empty 空态）——不代表真实玩法已解锁 Warren。
const htmlL = renderToStaticMarkup(
  <SeaChartView state={stateWith(['flag.tutorial_complete', 'flag.warren_discovered'], [])} onStateChange={noop} />,
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
// 家灯塔有船坞账单材料（scrap×3, net×3·coral→scrap 经济 2026-06-28）+ 金 → 船坞可建
const M1 = upgradeState([{ itemId: 'item.scrap_alloy', qty: 3 }, { itemId: 'item.old_fishing_net', qty: 3 }], 50);
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
// 深水章节前哨（陆坡前哨）：outpostOnly 满足 → 显示充电/制氧。
const staticOutpostPanel = renderToStaticMarkup(
  <LighthouseBuildPanel
    state={litOutpostState({ outpostId: 'outpost.ch1_slope', resultLh: SLOPE_OUTPOST_LH })}
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
assert(!htmlN1.includes('陆坡前哨') && !htmlN1.includes('中层浮标'), 'N1: 未发现的章节前哨不在图上（发现门控·无暗节点）');
assert(!htmlN1.includes('热液井台') && !htmlN1.includes('海沟前哨'), 'N1: 其余章节前哨未发现→不在图（发现门控·下潜中找到才现身；已配 chart_regions 小圈）');
// devReveal（或剧情发现门 discoveredFlag）后 → 该章节前哨暗标记现身「暗·待解锁」。
// 洞穴内容整删（2026-07-12）：额外置 flag.warren_discovered 让 chart.pois.length>0（走渲染分支而非
// chart-empty 空态）——前哨暗标记与 POI 圈渲染同分支，测试专用、不代表真实玩法已解锁 Warren。
const n1Revealed = devRevealOutpost(stateWith(['flag.tutorial_complete', 'flag.warren_discovered'], []), 'outpost.ch1_slope');
const htmlN1b = renderToStaticMarkup(<SeaChartView state={n1Revealed} onStateChange={noop} />);
assert(htmlN1b.includes('陆坡前哨'), 'N1: devReveal/剧情发现后 → 章节前哨暗标记现身');
assert(htmlN1b.includes('待解锁'), 'N1: 现身的未解锁章节前哨标为「暗·待解锁」');
// N2：章节前哨点亮 + 建补给设施 → OutpostPopup 正常渲染。
// 能源容量门控已删（2026-06-21）：popup 不再显示能源/掉线；衰减更早删（#125）：无衰减级/荒废 UI。
const N2 = litOutpostState({
  outpostId: 'outpost.ch1_slope',
  resultLh: SLOPE_OUTPOST_LH,
  facilities: ['lighthouse.recharge.lv1', 'lighthouse.oxygen_supply.lv1'],
});
const htmlN2 = renderToStaticMarkup(
  <OutpostPopup outpostId="outpost.ch1_slope" state={N2} onStateChange={noop} />,
);
assert(htmlN2.includes('陆坡前哨'), 'N2: 点亮前哨 popup 显示前哨名');
assert(!htmlN2.includes('能源') && !htmlN2.includes('部分设施停转'), 'N2: 能源层已删 → popup 不再显示能源/掉线');
assert(!htmlN2.includes('衰减') && !htmlN2.includes('荒废'), 'N2: 衰减已删 → 无衰减级/荒废 UI');
L('  章节前哨标记（暗·待解锁·未发现不在图）+ 前哨 popup（能源层已删·无能源/掉线/衰减 UI）✓');

// （Section O「SeaChartView mimic 无灯之光引诱 + 宏观 tell」随 mimic vertical 于 2026-07-12 删除·整段移除。）

// ============================================
// P. 行前装包 + 投放诱饵（猎手 SPEC §4·#108；#140 就地分步向导·2026-06-18）：
//   P1 SeaChartView（departStep='none'·默认）：出海按钮可见；行前装包不在初始渲染中（SSR 无交互）。
//   P1pack ChartInfo（departStep='pack'）：行前装包面板可见·背包格·储物柜格（声诱标 ×2）。
//   P1none ChartInfo（departStep='none'）：出海按钮可见；行前装包不渲染。
//   P2 NodeSelectView：huntEnabled + 背包有 decoy → 「投放」按钮；水里有有效诱饵 → 状态行；
//      非 huntEnabled（浅水旧路径）→ 不渲染按钮（诱饵只对有位置的猎手起效）。
// ============================================
L('\n========== P. 行前装包 + 投放诱饵 (§4) ==========');
// 洞穴内容整删（2026-07-12）：本节需要一个真实可出海 POI 才能测「出海」按钮 + 行前装包流程；
// chart_pois.json 现仅剩 poi.anchor.warren（flag.warren_discovered 门住）——测试专用置该 flag，
// 不代表真实玩法已解锁 Warren。
const P1state = { ...stateWith(['flag.tutorial_complete', 'flag.warren_discovered'], []) };
P1state.profile = { ...P1state.profile, inventory: [{ itemId: 'item.decoy_sound', qty: 2 }] };
// P1 初始渲染（none step）：出海按钮可见·行前装包尚未展开
const htmlP1none = renderToStaticMarkup(<SeaChartView state={P1state} onStateChange={noop} />);
assert(htmlP1none.includes('出海'), 'P1 none: departStep=none → 出海按钮可见');
assert(!htmlP1none.includes('行前装包'), 'P1 none: departStep=none → 行前装包尚未展开（就地分步·需点出海）');
// P1pack：直接渲染 ChartInfo pack 步骤——仓库有 decoy → 装包面板（背包格 + 储物柜格）
const p1Poi = stateWith(['flag.tutorial_complete', 'flag.warren_discovered'], []);
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
  <SeaChartView state={stateWith(['flag.tutorial_complete', 'flag.warren_discovered'], [])} onStateChange={noop} />,
);
assert(htmlP1empty.includes('出海') && !htmlP1empty.includes('行前装包'), 'P1 none 空仓库: 出海按钮·无装包');

// P2：dive 中（huntEnabled）背包有 decoy → 投放按钮；放出的诱饵还有效 → 状态行
const pBase = sonarState();
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
// Q. 声呐图 SSR/纯函数面（06-10 三修 → 2026-07-18 三层解耦重写）：
//   Q1 无空态早退——没 ping 过＝全黑迷雾 + 位置点标记总可见（「不 ping 脚下不亮」·标记层压迷雾之上）；
//   Q2 两段点击 SSR 默认干净——选中高亮/回正按钮是纯客户端交互态，SSR 初始输出不该有；
//   Q3 背景层几何——buildCaveGeometry(layout) 整图恒完整·不吃揭示·确定性（#100）。
//   （#3 扫描波重放与 #2 缩放/平移是 canvas/交互行为，绿≠画对——线上 ?dev 肉眼·quirk #91/#93。）
// ============================================================
L('\n========== Q. 声呐图（三层解耦：无空态 / SSR 干净 / 背景层恒完整） ==========');
// Q1: 洞穴 + 没 ping 过（lastScanTurn 空）→ 无空态：canvas（全黑迷雾）+ 你 + 副标「扫一记」提示 + 未知位置点「? m」总可见。
const qRun = {
  ...createNewRun({ zoneId: 'zone.vertical_test', bonuses: { sonarUnlocked: true } }),
  map: owMazeMap, currentDepth: 50, currentNodeId: 'm0', turn: 0,
};
const qState: GameState = {
  ...createInitialGameState(), run: qRun,
  phase: { kind: 'dive', subPhase: { kind: 'nodeSelect', choices: [] } },
};
const htmlQ = renderToStaticMarkup(
  <NodeSelectView state={qState} choices={choicesFor(owMazeMap, 'm0')} onStateChange={noop} />,
);
assert(!htmlQ.includes('sonar-scan-empty'), 'Q1: 没 ping 过也不出空态面板（迷雾自己就是全黑·空态早退已删）');
assert(htmlQ.includes('sonar-cave-canvas') && htmlQ.includes('sonar-you'), 'Q1: canvas + 你的呼吸点照常渲染');
assert(htmlQ.includes('一片黑'), 'Q1: 没 ping 过 → 副标给「扫一记」提示');
assert(htmlQ.includes('? m'), 'Q1: 未知位置点「? m」总可见（位置公开·性质保密·三层解耦）');
// Q2: SSR 默认无选中/无回正（纯客户端交互态·见 SonarScanPanel/NodeSelectView 两段点击）
assert(!htmlQ.includes('is-pending') && !htmlQ.includes('sonar-pending-ring'), 'Q2: SSR 初始无选中高亮');
assert(!htmlQ.includes('sonar-recenter') && !htmlQ.includes('sonar-pending-hint'), 'Q2: SSR 初始无回正按钮·选中提示句已整句删（#319·别复活）');
// Q3: 背景层几何（三层解耦）：整图恒完整·不吃揭示——旧「残段/敞口通道」已删（防剧透改由迷雾层不透明黑扛）。
const qLayout: MapLayout = {
  pos: { a: { x: 0, y: 0 }, b: { x: 80, y: 60 } },
  edges: [{ a: 'a', b: 'b', chord: false }],
  width: 100, height: 100, r: 8,
};
const qFull = buildCaveGeometry(qLayout);
const reachFromA = (g: { tuns: Array<{ ax: number; ay: number; bx: number; by: number }> }) =>
  g.tuns.reduce((m, t) => Math.max(m, Math.hypot(t.bx, t.by), Math.hypot(t.ax, t.ay)), 0); // 距 a(0,0) 最远
assert(qFull.rooms.length >= 2, 'Q3: 每节点至少一间主房间（背景层整图恒完整·不看揭示）');
assert(reachFromA(qFull) >= Math.hypot(80, 60) - 1e-6, 'Q3: 隧道沿路由伸到两端房心（整条边恒画·无收窄封口）');
assert(JSON.stringify(buildCaveGeometry(qLayout)) === JSON.stringify(qFull), 'Q3: 确定性——同布局同几何（守 #100）');
L('  无空态(全黑迷雾+标记总可见) · SSR 无交互态残留 · 背景层恒完整/确定性 ✓');
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
  const fogLayout: MapLayout = { pos: { a: { x: 30, y: 30 }, b: { x: 120, y: 120 } }, edges: [{ a: 'a', b: 'b', chord: false }], width: 160, height: 160, r: 8 };
  const rect = { x: 0, y: 0, w: 160, h: 160 };
  const W = 160, H = 160;
  const px = (buf: Uint8ClampedArray, x: number, y: number) => { const i = (Math.round(y) * W + Math.round(x)) * 4; return { r: buf[i], a: buf[i + 3] }; };
  const cave = buildCaveGeometry(fogLayout);
  const buf = bakeCaveRGBA(cave, rect, W, H);
  assert(px(buf, 30, 30).a > 0, 'Q5: 烤图水道像素不透明（全亮底图·三态遮罩移到合成层几何圆）');
  assert(px(buf, 158, 2).a === 0, 'Q5: 洞外岩石透明（露面板暗底＝岩）');
  L('  bakeCaveRGBA 全亮底图：水道不透明 / 洞外透明（三态几何圆遮罩在合成层·肉眼 dev 验）✓');
}

// ============================================================
// R. 猎手 blip 路由落点（06-11 作者「红点出墙」修复·纯函数直测·2026-07-18 三层解耦改版）
//    守则：①edgeRoutePts 方向无关（a→b 反转 == b→a·同一条曲线）②端点=房心
//    ③blip 落点在渲染同源路由折线上（点到折线距离≈0＝永远在画出来的水道里）
//    ④不按揭示截断（背景恒完整·标记压迷雾之上·弧长按 prog 直取）⑤没这条边 → null（回退直线）
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
// ③ t=0/1 → 端点；t=0.5 → 在路由折线上（不出墙）
const rp0 = stalkerRoutePoint(qLayout, 'a', 'b', 0)!;
const rp1 = stalkerRoutePoint(qLayout, 'a', 'b', 1)!;
const rpMid = stalkerRoutePoint(qLayout, 'a', 'b', 0.5)!;
assert(Math.hypot(rp0.x - 0, rp0.y - 0) < 1e-6 && Math.hypot(rp1.x - 80, rp1.y - 60) < 1e-6, 'R3: t=0/1 落在两端房心');
assert(distToPolyline(rpMid, rAB) < 1e-6, 'R3: t=0.5 落在路由折线上（不再用房心直线＝不出墙）');
// ④ 三层解耦后不按揭示截断（位置诚实·标记层压迷雾之上·黑区标记合法）：t=0.9 → 弧长直取 0.9×总长。
const rp09 = stalkerRoutePoint(qLayout, 'a', 'b', 0.9)!;
assert(distToPolyline(rp09, rAB) < 1e-6, 'R4: 落点仍在渲染同源路由上');
assert(Math.abs(arcOf(rp09, rAB) - rTotal * 0.9) < 1e-6, 'R4: 弧长按 prog 直取（旧「截进残段」已随解耦删除）');
// ⑤ 没这条边 → null（调用方回退直线）
assert(stalkerRoutePoint(qLayout, 'a', 'zzz', 0.5) === null, 'R5: 没这条边 → null 回退');
// ⑥ 红点永远有水可站（三层解耦）：背景几何恒含每个节点的房间——旧「fix 锚点渲染侧并入」不再需要；
//    组件侧——猎手定位在从没扫过的节点 → blip 与洞穴 canvas 仍同时在（标记层压迷雾之上）。
assert(
  qFull.rooms.some((r) => Math.hypot(r.x - 0, r.y - 0) <= r.r + 1),
  'R6: 整图几何恒含锚点那间房（blip 永远站在水里）',
);
const rStalkerUnscanned: GameState = {
  ...createInitialGameState(),
  run: {
    ...owMazeRun, // 本潜 ping 过（lastScanTurn 0·全图揭示）——猎手快照在 m1（快照会过期·红点=旧影）
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
L('  方向无关 · 端点=房心 · blip 永在路由上 · 弧长直取不截断 · 无边回退 · 锚点房恒在 · SDF 投影闸 ✓');

// ============================================
// S. 章节哨站：OutpostPopup 锁态(暗·待解锁)/点亮(已点亮·无蛙跳·灯塔/蛙跳重构 step ③+作者 06-14)。
//    章节蛙跳已删——章节 band 改走数据驱动深度柱派生的深入 POI（#131）。SSR 直渲 popup 验（OutpostPopup 已 export）。
// ============================================
L('\n========== S. 章节哨站 popup ==========');
// 锁态：slope 锚点未到 → OutpostPopup 显示「暗 · 待解锁」+ 解锁提示。
const sLockState = stateWith(['flag.tutorial_complete'], []);
const htmlSLock = renderToStaticMarkup(
  <OutpostPopup outpostId="outpost.ch1_slope" state={sLockState} onStateChange={noop} />,
);
assert(htmlSLock.includes('隐约可见 · 还没路'), 'S: 锚点未到的章节前哨 popup 显示锁态「隐约可见 · 还没路」');
assert(htmlSLock.includes('走到附近'), 'S: 锁态给解锁提示');
// 点亮态：slope 锚点 + 陆坡前哨三阶 → OutpostPopup 显「已点亮」·不再出「从此处下潜」（章节蛙跳已删→深入 POI）。
const sLitChap = litOutpostState({ outpostId: 'outpost.ch1_slope', resultLh: SLOPE_OUTPOST_LH });
// 主线柱迁移：陆坡前哨「可建门」翻成上一 beat（reef）flag（story.ch1.anchor.reef）——不再是本区 anchor.slope。
const sLitChapWithAnchor: GameState = {
  ...sLitChap,
  profile: { ...sLitChap.profile, flags: new Set([...sLitChap.profile.flags, 'story.ch1.anchor.reef']) },
};
const htmlSLit = renderToStaticMarkup(
  <OutpostPopup outpostId="outpost.ch1_slope" state={sLitChapWithAnchor} onStateChange={noop} />,
);
assert(!htmlSLit.includes('从此处下潜'), 'S: 章节前哨蛙跳已删（改深入 POI·作者 06-14）→ popup 不再出「从此处下潜」');
assert(htmlSLit.includes('灯亮着'), 'S: 点亮态状态显示「灯亮着」');
L('  章节前哨 popup 锁态(暗·待解锁)/点亮(已点亮·无蛙跳·改深入 POI) ✓');

// ============================================
// T. LockerView · 剧情/其它/装备归类 + 海图信物详情（#140 续·作者 2026-06-18）
//   白板收口（2026-07-12）：文献道具（航海日志 item.captain_log / 导师日志 item.mentor_logbook）及其 lore
//   （lore.ch1.captains_page / lore.ch1.mentor_logbook）+ 四文献坐标内容已删——本节改只验**存活道具**的归类与详情：
//   剧情（tab id 'journal'·label「剧情」）＝剧情信物（category='story' 且非海图信物：锈蚀的指南针）；
//   其它＝**海图信物 旧海图**（story+opensChart→点开看详情：描述 + 摊开海图·marksPois 空·无坐标陈列）；
//   装备件（潜水刀）归装备 tab。initialTab / initialDetail 钩子直渲 tab/详情（SSR 无法点击切换）。
// ============================================
L('\n========== T. LockerView 剧情/其它/装备归类 + 海图信物详情 (#140 续) ==========');
const TLock = { ...stateWith(['flag.tutorial_complete'], []) };
TLock.profile = {
  ...TLock.profile,
  // loreEntries 不再置位：两条 ch1 lore（船长日志/导师日志）内容已删。
  inventory: [
    { itemId: 'item.rusty_compass', qty: 1 },       // 剧情信物（→剧情）
    { itemId: 'item.old_chart', qty: 1 },           // 海图信物·opensChart（→其它·点开看描述/摊图·marksPois 空）
    { itemId: 'item.dive_knife.standard', qty: 1 }, // 装备备件（→装备 tab）
  ],
};
// 剧情 tab：剧情信物 指南针在场；海图信物 旧海图不在（归其它）
const htmlTStory = renderToStaticMarkup(
  <LockerView state={TLock} onStateChange={noop} onClose={noop} initialTab="journal" />,
);
assert(htmlTStory.includes('锈蚀的指南针'), 'T: 剧情信物「锈蚀的指南针」在「剧情」tab');
assert(!htmlTStory.includes('旧海图'), 'T: 海图信物「旧海图」不在「剧情」（归其它）');
// 其它 tab：旧海图在场（点开看详情）；剧情信物/装备备件不在
const htmlTOther = renderToStaticMarkup(
  <LockerView state={TLock} onStateChange={noop} onClose={noop} initialTab="other" />,
);
assert(htmlTOther.includes('旧海图'), 'T: 海图信物「旧海图」在「其它」tab');
assert(
  !htmlTOther.includes('锈蚀的指南针') && !htmlTOther.includes('潜水刀'),
  'T: 剧情信物/装备备件不在「其它」',
);
// 装备 tab：嵌入纸娃娃（作者 2026-06-20·B）——武器·主槽显穿戴的潜水刀（换装在此·升级/打造见 Otto）
const htmlTGear = renderToStaticMarkup(
  <LockerView state={TLock} onStateChange={noop} onClose={noop} initialTab="gear" />,
);
assert(htmlTGear.includes('潜水刀') && htmlTGear.includes('武器·主'), 'T: 装备 tab 嵌入纸娃娃·武器·主槽显潜水刀（装备归装备 tab）');
// 旧海图详情（#142·marksPois 空）：详情只剩描述 + 摊开海图（无坐标陈列）
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
assert(!htmlTChartDetail.includes('个坐标'), 'T: 旧海图详情不陈列坐标（marksPois 空·old_chart 只 opensChart）');
assert(htmlTChartDetail.includes('摊开海图'), 'T: 旧海图详情有「摊开海图」（opensChart + onOpenChart）');
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
// 引擎：旧海图 marksPois 空（坐标内容随白板收口删除·old_chart 只 opensChart）。
assert(itemMarkedPois('item.old_chart').length === 0, 'T: 旧海图 marksPois 空（坐标内容已删·old_chart 只 opensChart）');
L('  剧情/其它/装备归类 · 旧海图详情摊图(无坐标) · 未解锁不绕门 ✓');

console.log(log.join('\n'));
console.log('\n✓ 海图 UI 冒烟测试通过');
