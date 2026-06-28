#!/usr/bin/env node
// LLM 试玩 harness 的 resolveOption 三参门（CLAUDE.md「约定落成机制」）。
//
// 背景：engine/events.ts::resolveOption(state, opt, event?) 的 event 形参留了 `?`（少数合成选项的回归脚本
// 便利）。但凡解析「真·游戏内事件」都必须传——漏传则 oncePerSave 的 event_seen 不写 profile.flags，
// 该事件会跨 run 静默重播。campaign.ts / harness-internal.ts 曾三处漏传 → 每次复潜重播整段教学 + 复制
// mentor_logbook（CAMPAIGN-2026-06-27 playtest 报告③·根因）。真实游戏走 eventScenario 一律传 event。
// 本门把「tools/playtest-llm 内 resolveOption 必传父事件（3 参）」焊成会红的检查。
//
// 启发式（够用·harness 调用都是单行无内层括号）：逐行匹配 resolveOption(...)，按顶层逗号数参；<3 即红。
// 多行调用 / 内层括号会漏判（false-negative·不误杀）——harness 现状无此形态。
// 跑法：node scripts/check-harness-resolveoption.mjs
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join, relative } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DIR = resolve(ROOT, 'tools/playtest-llm');

const files = existsSync(DIR)
  ? readdirSync(DIR).filter((f) => f.endsWith('.ts')).map((f) => join(DIR, f))
  : [];

const violations = [];
for (const full of files) {
  const lines = readFileSync(full, 'utf-8').split('\n');
  lines.forEach((line, i) => {
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('import')) return;
    const m = line.match(/resolveOption\(([^)]*)\)/);
    if (!m) return;
    const args = m[1].split(',').map((s) => s.trim()).filter(Boolean);
    if (args.length < 3) {
      violations.push(
        `${relative(ROOT, full)}:${i + 1}\n      resolveOption 只有 ${args.length} 参 → 漏传父事件` +
          `（oncePerSave 的 event_seen 不会写·该事件跨 run 重播）`,
      );
    }
  });
}

if (violations.length) {
  console.error('✘ harness resolveOption 三参门：tools/playtest-llm 内有调用漏传父事件\n');
  for (const v of violations) console.error(`  ${v}`);
  console.error(
    '\n修：resolveOption(state, opt, ev) 第三参传上方 getEventById 得到的事件' +
      '（见 engine/events.ts::resolveOption 注释 + QUIRKS）。',
  );
  process.exit(1);
}

console.log(
  `✓ harness resolveOption 三参门：扫 ${files.length} 个 tools/playtest-llm 文件·所有 resolveOption 均传父事件`,
);
process.exit(0);
