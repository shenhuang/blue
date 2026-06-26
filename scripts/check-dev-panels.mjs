#!/usr/bin/env node
// dev 工作台「不再漂移」静态门（#206·2026-06-26·把三处 dev 面板 vs 引擎漂移焊成会红的检查）。
//
// 背景：dev 可视化面板（src/ui/dev/*）若手抄清单 / 绕过引擎单一源，近期重构后会静默展示错乱——
//       近期审计实锤三处（事件 zone 过滤手抄漏 17 个 tag〔已改数据派生·typecheck 守〕、海图漏深度柱 POI、
//       战场压力把已死敌人算进去、tone 第三档无样式）。typecheck 抓字段级重命名，但抓不到「运行期字符串/
//       语义/绕过派生」这层。本门补三条**纯静态**断言（沙箱也跑·与 check-* 同类·廉价护栏）：
//   ① ChartViewDevPanel 必须引用 buildColumnPois —— 守「海图调试器展示深度柱 POI」
//      （之前只读 chart_pois.json·漏掉 generateChart 注入的柱 POI）。
//   ② CombatDevPanel 战场压力按 enemiesAlive 聚合（非 enemiesFinal）——
//      守与引擎 applyEnvironmentalPressure「只累计 hp>0 的 boss」一致、别虚报。
//   ③ dev-panel.css 为 Tone 每个值（src/types/events.ts 单一源）都备 .dev-step-tone-<t> ——
//      守事件步骤三档（realistic/uncanny/cosmic）视觉不丢。
//
// 深层行为另由 smoke-chart-editor（柱 POI 实际渲染/接入）与 smoke-combat-panel（面板渲染）守（tsx·Mac/nightly）；
// 本门是沙箱可跑的那一半。改了被守的写法 → 同步更新这里的正则（单一源在注释里点名）。
//
// 在 scripts/regress.mjs 注册为 check-dev-panels（纯 node·沙箱也跑）。

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const errors = [];
const fail = (m) => errors.push(m);

// ① 海图调试器接入深度柱 POI -------------------------------------------------------------------
const chartDev = read('src/ui/dev/ChartViewDevPanel.tsx');
if (!/\bbuildColumnPois\s*\(/.test(chartDev)) {
  fail(
    'ChartViewDevPanel.tsx 未调用 buildColumnPois() —— 深度柱 POI 会从海图调试器漏掉（回退「只读 chart_pois.json」漂移·#206）。\n' +
      '      修：rows 构建里追加 `for (const poi of buildColumnPois(profile)) { ...push column row... }`。',
  );
}

// ② 战斗面板战场压力按存活敌人聚合 -------------------------------------------------------------
const combatDev = read('src/ui/dev/CombatDevPanel.tsx');
const ENV_FINAL = /enemiesFinal\s*\.\s*map\(\s*\(?\s*e\s*\)?\s*=>\s*e\.defId\s*\)/;
const ENV_ALIVE = /enemiesAlive\s*\.\s*map\(\s*\(?\s*e\s*\)?\s*=>\s*e\.defId\s*\)/;
if (ENV_FINAL.test(combatDev)) {
  fail(
    'CombatDevPanel.tsx 用 enemiesFinal（含已死敌人）聚合战场压力 —— 与引擎 applyEnvironmentalPressure「只算 hp>0」不一致、会虚报（#206）。\n' +
      '      修：distinctDefIds 改用 result.summary.enemiesAlive.map((e) => e.defId)。',
  );
}
if (!ENV_ALIVE.test(combatDev)) {
  fail(
    'CombatDevPanel.tsx 未见 enemiesAlive.map((e) => e.defId) 聚合 —— 战场压力应按存活敌人（#206）。\n' +
      '      若你重构了该处口径，请同步更新本门正则（注释里点名了单一源）。',
  );
}

// ③ dev-panel.css 覆盖 Tone 全部档位 -----------------------------------------------------------
const eventsTypes = read('src/types/events.ts');
const toneMatch = eventsTypes.match(/export type Tone\s*=\s*([^;]+);/);
if (!toneMatch) {
  fail('未能在 src/types/events.ts 解析 `export type Tone = ...`（单一源变了？更新本门）。');
} else {
  const tones = [...toneMatch[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  const css = read('src/ui/dev/dev-panel.css');
  for (const t of tones) {
    if (!css.includes(`.dev-step-tone-${t}`)) {
      fail(
        `dev-panel.css 缺 .dev-step-tone-${t} —— 事件步骤块 tone「${t}」无专属样式、与其它档视觉无区分（#206）。\n` +
          `      修：在 dev-panel.css 加 .dev-step-tone-${t} { border-color: ...; }。`,
      );
    }
  }
}

// ---- 汇报 ----
if (errors.length) {
  console.error(`✗ check-dev-panels: dev 工作台漂移门发现 ${errors.length} 处：\n`);
  for (const e of errors) console.error('  • ' + e + '\n');
  process.exit(1);
}
console.log(
  '✓ check-dev-panels: 三条 dev 面板↔引擎漂移门通过（柱 POI 接入 / 战场压力存活聚合 / tone 档位样式齐）',
);
