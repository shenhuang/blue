// 素材经济工作台 SSR 冒烟 + parity 守门（镜像 smoke-equipment-ui / smoke-story-editor）。
//   ① EconomyDevPanel SSR 渲染不抛错 + 关键骨架在（标题/KPI/清单/热力图/状态信号/真实素材行）。
//   ② parity：computeMaterialStats() 必须复现 CLI（npm run audit:materials）的口径——
//      把「engine 聚合 == CLI 审计」从人眼盯 xlsx 升成会红的门（材料经济解析单一真相·别静默漂）。
//
// CSS 处理：EconomyDevPanel 含 `import './dev-panel.css'`（与 StatsDevPanel 同·让其 lazy chunk 自带样式），
// 而 tsx/node 不认 .css。故先 register 一个把 .css 重定向到空模块的 resolve 钩子（scripts/css-stub-loader.mjs），
// 再**动态** import 面板（静态 import 会先于 register 求值→.css 炸）。computeMaterialStats 无 css·可静态 import。
//
// 跑法：npx tsx scripts/smoke-economy-panel.tsx
//   （沙箱：ESBUILD_BINARY_PATH=/tmp/esbuild-linux/.../esbuild node_modules/.bin/tsx scripts/smoke-economy-panel.tsx·#147）
import { register } from 'node:module';
register('./css-stub-loader.mjs', import.meta.url);

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { computeMaterialStats } from '../src/engine/materialStats';

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    console.error('✗ ' + msg);
    process.exit(1);
  }
}

// EconomyDevPanel 含 .css import → 必须在 register() 之后动态加载。
const { EconomyDevPanel } = await import('../src/ui/dev/EconomyDevPanel');

// ── ① SSR 渲染（onClose 缺省·工作台里关闭由左导航取代·对齐 PanelShell quirk #112） ──────────
const html = renderToStaticMarkup(<EconomyDevPanel />);
assert(html.includes('素材经济'), '面板应渲染标题「素材经济」');
assert(html.includes('?editor=economy'), '副标题应含深链 ?editor=economy');
for (const kpi of ['素材总数', '瓶颈', '死货', '死料']) {
  assert(html.includes(kpi), `应渲染 KPI「${kpi}」`);
}
assert(html.includes('素材清单'), '应渲染「素材清单」卡片');
assert(html.includes('素材 × Zone'), '应渲染「素材 × Zone」热力图卡片');
// 真实素材行 + 状态信号（证明渲染走通 engine 数据·非空壳）
assert(html.includes('黄铜配件'), '清单应含真实素材行（黄铜配件）');
assert(html.includes('章鱼角喙'), '清单应含瓶颈素材行（章鱼角喙）');
assert(html.includes('瓶颈'), '应渲染「瓶颈」状态信号（章鱼角喙/冷光腺单源重需求）');
assert(html.includes('死料'), '应渲染「死料」状态信号（有产零销·非剧情）');

// ── ② parity：engine 聚合复现 CLI 口径（任务给定基线·见 scripts/material-audit.ts） ──────────
const s = computeMaterialStats();
const by = new Map(s.materials.map((m) => [m.id, m]));

const beak = by.get('item.cave_octopus_beak');
assert(beak && beak.srcCount === 1 && beak.bottleneck, '章鱼角喙 srcCount===1 且 bottleneck（单源垄断·需求≥8）');

const lantern = by.get('item.lantern_gland');
assert(lantern && lantern.srcCount === 1 && lantern.bottleneck, '冷光腺 srcCount===1 且 bottleneck');

const brass = by.get('item.brass_fitting');
assert(brass && brass.srcCount === 21 && brass.totalDemand === 42, '黄铜配件 srcCount===21 且 totalDemand===42（多源重需求基线）');

const station = by.get('item.station_module');
assert(
  station && !station.deadstock && station.srcCount === 1,
  '科考站升级模块非 deadstock 且单源（capstone grantsItem 算来源·别漏算成死货）',
);

// idle（有产零销·category material）必含这几味隐性矿料
const idleNames = new Set(s.materials.filter((m) => m.idle).map((m) => m.name));
for (const n of ['锰结核', '铁锰结壳', '热液硫化矿']) {
  assert(idleNames.has(n), `idle 应含「${n}」（有来源·零需求·material）`);
}

// flag ⇒ status 自洽（防将来重构两处漂移）
for (const m of s.materials) {
  if (m.deadstock) assert(m.status === 'deadstock', `${m.name} deadstock flag 应与 status 一致`);
  else if (m.bottleneck) assert(m.status === 'bottleneck', `${m.name} bottleneck flag 应与 status 一致`);
  assert(m.srcCount >= 0 && m.totalDemand >= 0, `${m.name} 计数非负`);
}

console.log(
  `✓ smoke-economy-panel: SSR 渲染 + parity 通过（${s.total} 素材 · 瓶颈 ${s.bottleneckCount} · 死货 ${s.deadstockCount} · 死料 ${s.idleCount}）`,
);
