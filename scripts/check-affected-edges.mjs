#!/usr/bin/env node
// 受影响测试选择器·关键 fixture 覆盖门（把 #195/#196 焊成会红的检查）。
//
// scripts/affected-tests.mjs 从「改了哪些文件」沿依赖图算「跑哪些行为测」（psm 绿门用它选测·gate.affected）。
// 历史 bug #195/#196：改 src/data/chart_pois.json 这类**数据 fixture** 却没选出 chart 行为测
// （playthrough-chart / smoke-chart-ui）⇒ chart 改动上车时相关测试根本没跑＝静默放行。
// 当下这条边靠 engine/chart.ts、engine/regions.ts 的**静态 import**（`import x from '@/data/...json'`）
// 兜着——但一旦有人把加载改成运行时 `readFileSync('chart_pois.json')`（仓库 fixture 的惯用裸名读法）
// 或拆 barrel 把 import 挪走，这条边就可能再次悄悄断（affected-tests 的动态腿对裸名 fixture 现已加固，
// 但「加固有没有真生效」本身需要一道断言钉住）。
//
// 本门直接调 computeAffected 断言：改某关键 fixture ⇒ 选出的行为测必须含约定的那几个，否则红。
// mode==='all'（保守全量·所有测都跑）视作通过（chart 测照样跑·健全性没破）——本门只抓「narrow 成
// 不含 chart 测的子集」这一真正的 #195/#196 失败形态。
//
// 加新关键 fixture↔行为测绑定：往下面 PINS 加一条即可（单一源·别散写）。
// 在 scripts/regress.mjs 注册为 check-affected-edges 任务（纯 node·与其它 check-* 同类·常在层不需 esbuild）。
//
// 跑法： node scripts/check-affected-edges.mjs

import { computeAffected, buildGraph } from './affected-tests.mjs';

// 关键 fixture → 改它必须选出的行为测（健全性下限·只增不减）。
const PINS = [
  { fixture: 'src/data/chart_pois.json', mustSelect: ['playthrough-chart', 'smoke-chart-ui'] },
  { fixture: 'src/data/chart_regions.json', mustSelect: ['playthrough-chart', 'smoke-chart-ui'] },
  // scenario 基线目录 → 对应 *-scenarios runner（钉死 affected-tests.scenarioTaskFor·别再退化成「改 scenarios/** → ALL」）。
  // 选择按目录前缀（与文件是否存在无关）·用代表路径即可。
  { fixture: 'scenarios/combat/cave_octopus_solo__normal_kill.json', mustSelect: ['playthrough-combat-scenarios'] },
  { fixture: 'scenarios/mapgen/sample.json', mustSelect: ['playthrough-mapgen-scenarios'] },
  { fixture: 'scenarios/lighthouse/sample.json', mustSelect: ['playthrough-lighthouse-scenarios'] },
  { fixture: 'scenarios/reef_blue_hour__watch_success.json', mustSelect: ['playthrough-scenarios'] },
];

const graph = buildGraph();
const violations = [];

for (const pin of PINS) {
  const res = computeAffected([pin.fixture], graph);
  // mode 'all' ⇒ 全量跑·含目标测·安全（只是退化·非本门要抓的形态）。
  if (res.mode === 'all') continue;
  for (const t of pin.mustSelect) {
    if (!res.tasks.includes(t)) {
      violations.push(
        `改 ${pin.fixture} 未选出 ${t}（实选 ${res.tasks.length} 个：${res.tasks.join(', ') || '无'}）`,
      );
    }
  }
}

if (violations.length) {
  console.error('✘ 受影响选择器·关键 fixture 覆盖门被破坏（#195/#196 回归形态）\n');
  for (const v of violations) console.error(`  ${v}`);
  console.error(
    '\n  ⇒ 改了 chart 数据 fixture 却没选出 chart 行为测＝改动会静默放行。' +
      '\n    多半是加载方式变了（静态 import 挪走 / 改成运行时读取）让 affected-tests 的依赖腿跟丢。' +
      '\n    修 scripts/affected-tests.mjs 让它重新连上这条边，或在该处补对应依赖。',
  );
  process.exit(1);
}

console.log(`✓ 受影响选择器覆盖门：${PINS.length} 条关键 fixture↔行为测绑定齐全（#195/#196 已钉）`);
process.exit(0);
