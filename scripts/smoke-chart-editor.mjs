// 海图 POI 调试器（ChartViewDevPanel·?editor=chartdev）SSR 冒烟 + engine parity 守门。
//   ① ChartViewDevPanel SSR 渲染不抛错：标题 + 表格骨架 + 控制面板 + 真实 POI 行 + 深度柱 column 过滤项。
//   ② parity：poiRevealState / effectiveDistance / describeModifier 对初始档案（家灯塔）
//      的结果自洽（东礁·亮·reach=0；modifier 标签非空时正确生成）；
//      ③ buildColumnPois 接入校验（#206 漂移修复：柱 POI 之前只在 generateChart 注入、被本面板漏掉）——
//      把「engine POI 派生逻辑 == 调试面板期望」升成会红的门。
//
// CSS：ChartViewDevPanel import './dev-panel.css' → tsx/node 不认 .css →
//      先 register css-stub-loader.mjs（同 smoke-economy-panel / smoke-combat-panel 套路）。
//
// 跑法：npx tsx scripts/smoke-chart-editor.mjs
//   （沙箱：ESBUILD_BINARY_PATH=/tmp/esbuild-linux/.../esbuild node_modules/.bin/tsx scripts/smoke-chart-editor.mjs）
import { register } from 'node:module';
register('./css-stub-loader.mjs', import.meta.url);

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { poiRevealState, effectiveDistance, describeModifier } from '../src/engine/chart.ts';
import { createInitialProfile } from '../src/engine/state.ts';
import { buildColumnPois, columnProbeUpgradeId, getColumnForLighthouse } from '../src/engine/columns.ts';

function assert(cond, msg) {
  if (!cond) {
    console.error('✗ ' + msg);
    process.exit(1);
  }
}

// ── ① SSR 渲染 ───────────────────────────────────────────────────────────────────────────────
const { ChartViewDevPanel } = await import('../src/ui/dev/ChartViewDevPanel');

const html = renderToStaticMarkup(React.createElement(ChartViewDevPanel));

assert(html.includes('POI 调试器'), '面板应渲染标题「POI 调试器」');
assert(html.includes('?editor=chartdev'), '副标题应含深链 ?editor=chartdev');
assert(html.includes('dev-chart-table'), '应渲染 POI 表格（class=dev-chart-table）');
assert(html.includes('runsCompleted'), '左栏应渲染 runsCompleted 控件');
assert(html.includes('揭示态'), '表头应含「揭示态」列');
assert(html.includes('mapX'), '表头应含 mapX 列');
assert(html.includes('Reach'), '表头应含 Reach 列');
assert(html.includes('修正'), '表头应含「修正」列');
// 真实 POI 行（东礁在初始档案下可见）
assert(html.includes('东礁'), '应渲染真实 POI 行（东礁）');
// 类型徽章
assert(html.includes('dev-chart-badge-anchor'), '应渲染锚点类型徽章');
// 深度柱 column 过滤项（柱 POI kind 已接入面板·#206 漂移修复）
assert(html.includes('深度柱 column'), '过滤下拉应含「深度柱 column」选项（柱 POI kind 接入）');

// ── ② parity：engine POI 派生自洽 ───────────────────────────────────────────────────────────

// flag.tutorial_complete 必须满足（所有 ch1 锚点的发现门）——加进 profile 后家灯塔 owner POI → lit。
const profile = createInitialProfile(); // 家灯塔·runsCompleted=0
profile.flags.add('flag.tutorial_complete');

// 东礁锚点（owner=lighthouse.home·home 在 lighthouses·requiresFlags 已满足 → lit）
const reef = {
  id: 'poi.anchor.east_reef',
  zoneId: 'zone.east_reef',
  name: '东礁·资格区',
  blurb: '',
  distance: 0,
  owner: 'lighthouse.home',
  mapX: 0.07,
  mapY: 0,
  persistent: true,
  requiresFlags: ['flag.tutorial_complete'],
};
const reefState = poiRevealState(profile, reef);
assert(reefState === 'lit', `东礁 revealState 应为 lit（tutorial_complete·home 已建）·got: ${reefState}`);

// effectiveDistance：按几何（家灯塔在 mapX=0.06, mapY=0.5·礁 mapX=0.07, mapY=0）
// hypot(0.01, 0.5)≈0.5 ÷ REACH_NORM_PER_TIER(0.3) → round(1.67)=2
const reefReach = effectiveDistance(profile, reef);
assert(typeof reefReach === 'number' && reefReach >= 0, `effectiveDistance 应为非负整数·got: ${reefReach}`);
assert(reefReach === 2, `东礁 effectiveDistance·hypot(0.01,0.5)/0.3≈2·got: ${reefReach}`);

// modifier describeModifier：深度偏移 + 急流 + 黑暗（lamp 门·感知门 SPEC）
const mod = { depthOffset: 30, current: 'strong', gate: { sense: 'lamp', mode: 'locked' } };
const tags = describeModifier(mod);
assert(tags.includes('更深 +30m'), `describeModifier 应含「更深 +30m」·got: ${tags}`);
assert(tags.includes('急流'), `describeModifier 应含「急流」·got: ${tags}`);
assert(tags.includes('黑暗'), `describeModifier 应含「黑暗」·got: ${tags}`);

// 无 modifier → 空数组
const noTags = describeModifier(undefined);
assert(noTags.length === 0, 'describeModifier(undefined) 应返回空数组');

// 前哨归属点（未建前哨灯塔 → owner 不在 lighthouses → hidden）
const trenchPoi = {
  id: 'poi.anchor.trench_test',
  zoneId: 'zone.trench',
  name: '测试深沟点',
  blurb: '',
  distance: 3,
  owner: 'lighthouse.ch1_trench_outpost',
  mapX: 0.9,
  mapY: 0.8,
  persistent: true,
  requiresFlags: ['flag.tutorial_complete'],
};
const trenchState = poiRevealState(profile, trenchPoi);
assert(trenchState === 'hidden', `前哨未建时 POI 应为 hidden·got: ${trenchState}`);

// ── ③ 深度柱 POI 接入（#206 漂移修复·柱 POI 之前漏出面板）─────────────────────────────────────
// 家礁柱建满 → buildColumnPois 应产出带 columnId 的柱 POI（ChartViewDevPanel 的 rows 现接它·见面板内 buildColumnPois 循环）。
const colProfile = createInitialProfile();
colProfile.flags.add('flag.tutorial_complete');
const homeCol = getColumnForLighthouse('lighthouse.home');
assert(homeCol, '家灯塔应有深度柱（col.home·depth_columns.json）');
const homeLh = colProfile.lighthouses.find((l) => l.id === 'lighthouse.home');
assert(homeLh, '初始档案应含家灯塔');
for (let t = 1; t <= homeCol.tiers.length; t++) {
  homeLh.builtUpgrades.add(columnProbeUpgradeId(homeCol.id, t));
}
const colPois = buildColumnPois(colProfile);
assert(colPois.length > 0, `家礁柱建满后 buildColumnPois 应产出柱 POI·got ${colPois.length}`);
assert(
  colPois.some((p) => p.columnId === homeCol.id),
  '柱 POI 应含家礁柱 columnId（面板靠 buildColumnPois 展示这些点·别再退回只读 chart_pois.json）',
);

console.log(
  '✓ smoke-chart-editor: SSR + engine parity 通过（标题/表格/控件/真实行/深度柱过滤项 + revealState/effectiveDistance/describeModifier + buildColumnPois 接入自洽）',
);
