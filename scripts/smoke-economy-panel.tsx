// 素材经济工作台 SSR 冒烟 + parity 守门（镜像 smoke-equipment-ui / smoke-story-editor）。
//   ① EconomyDevPanel SSR 渲染不抛错 + 三 tab（来源/消耗/状态）骨架 + 素材×大区热力图 + 真实素材行。
//   ② parity：computeMaterialStats() 复现 CLI 口径（srcCount/totalDemand/status 不变）+ 新矩阵自洽
//      （消耗矩阵行和＝总消耗·来源/消耗/净值一致·挖矿可检测）——把「engine 聚合 == CLI 审计」升成会红的门。
//
// CSS：EconomyDevPanel 含 `import './dev-panel.css'`，tsx/node 不认 .css → 先 register 把 .css 重定向到
// 空模块的 resolve 钩子（scripts/css-stub-loader.mjs），再**动态** import 面板（静态会先于 register 求值炸）。
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

const { EconomyDevPanel } = await import('../src/ui/dev/EconomyDevPanel');

// ── ① SSR 渲染（默认 来源 tab·onClose 缺省·工作台里关闭由左导航取代） ─────────────────────────
const html = renderToStaticMarkup(<EconomyDevPanel />);
assert(html.includes('素材经济'), '面板应渲染标题「素材经济」');
assert(html.includes('?editor=economy'), '副标题应含深链 ?editor=economy');
for (const kpi of ['素材总数', '瓶颈', '死货', '死料']) assert(html.includes(kpi), `应渲染 KPI「${kpi}」`);
for (const t of ['来源', '消耗', '状态']) assert(html.includes(t), `应渲染 tab「${t}」`);
assert(html.includes('素材 × 大区'), '应渲染热力图标题「素材 × 大区」');
assert(html.includes('总指数'), '默认来源 tab 末列应为「总指数」');
assert(html.includes('黄铜配件'), '热力图应含真实素材行（黄铜配件）');

// ── ② parity：engine 聚合复现 CLI 口径 + 新矩阵自洽 ────────────────────────────────────────────
const s = computeMaterialStats();
const by = new Map(s.materials.map((m) => [m.id, m]));

const beak = by.get('item.cave_octopus_beak');
assert(beak && beak.srcCount === 1 && beak.bottleneck, '章鱼角喙 srcCount===1 且 bottleneck');
const lantern = by.get('item.lantern_gland');
assert(lantern && lantern.srcCount === 1 && lantern.bottleneck, '冷光腺 srcCount===1 且 bottleneck');
const brass = by.get('item.brass_fitting');
// srcCount 随内容增减（#175 加 shaft_crack/flooded_gallery 两处旧装具掉落 → 21→23；weekend merge 加 wreck_graveyard 一处 → 24；叙事审查移除 reef.keepers_footlocker brass → wreck_graveyard 同批 +2 源净抵消仍 24；Batch2 grotto.old_anchor（同事件去重=1源）→ 25）；totalDemand 42→39（删水力发电设施·brass×3·2026-06-21）。
assert(brass && brass.srcCount === 25 && brass.totalDemand === 39, '黄铜配件 srcCount===25 且 totalDemand===39');
const station = by.get('item.station_module');
assert(station && !station.deadstock && station.srcCount === 1, '科考站升级模块非 deadstock 且单源（capstone 算源）');
const idle = new Set(s.materials.filter((m) => m.idle).map((m) => m.name));
for (const n of ['锰结核', '铁锰结壳', '热液硫化矿']) assert(idle.has(n), `idle 应含「${n}」`);

// 新矩阵自洽：消耗矩阵行和 === 总消耗（消耗按设施所在区归位·无遗漏）
s.materials.forEach((m, mi) => {
  const rowSum = s.demandMatrix[mi].reduce((a, b) => a + b, 0);
  assert(rowSum === m.totalDemand, `${m.name} demandMatrix 行和 ${rowSum} === 总消耗 ${m.totalDemand}`);
});
// 净值 === 来源指数 − 消耗
s.materials.forEach((_m, mi) =>
  s.regions.forEach((_r, ri) =>
    assert(
      Math.abs(s.netMatrix[mi][ri] - (s.sourceIndex[mi][ri] - s.demandMatrix[mi][ri])) < 0.011,
      'netMatrix === sourceIndex − demandMatrix',
    ),
  ),
);
// 大区列含「港口」（装备消耗）·来源方式含「挖矿」（mine 能力门可检测）
assert(s.regions.includes('港口'), '大区列应含「港口」（装备消耗归位）');
const methods = new Set(s.materials.flatMap((m) => m.sources.map((x) => x.method)));
for (const mm of ['敌人', '事件', '深度柱', '挖矿']) assert(methods.has(mm), `来源方式应含「${mm}」`);
// 概率合法
for (const m of s.materials) for (const x of m.sources) assert(x.chance >= 0 && x.chance <= 1, `${m.name} 概率 ∈[0,1]`);

console.log(
  `✓ smoke-economy-panel: SSR(3 tab) + parity 通过（${s.total} 素材 · ${s.regions.length} 大区 · 瓶颈 ${s.bottleneckCount} · 死货 ${s.deadstockCount} · 死料 ${s.idleCount}）`,
);
