#!/usr/bin/env node
// 术语单一来源 lint（CLAUDE.md「约定落成机制」·收口 #224 科考队 SPEC 术语统一）。
//
// 背景：#224 把剧情侧旧词「穿尸者」统一到与代码/敌人库一致的「尸衣者」
// （敌人库 corpse_wearer 的 name + 多文件 + boss memory 全用「尸衣者」；「穿尸者」是剧情侧偏离）。
// 但统一只改了 docs/spec 散文 → 会随 session churn 再分叉（「散文随 churn 丢」的活样本）。
// 本门把**禁词**焊成会红的检查：任何 live 内容（src + scenarios）出现「穿尸」即红，逼回单一术语。
//
// 扫描面＝live 游戏代码 + 内容（叙事术语只该出现在这些地方）：
//   src/**/*.{ts,tsx,json}（含 data 事件/lore/npcs、engine、ui、types）
//   scenarios/**/*.json（含 _comment 开发注释·#224 残留 2 处即在此）
// 豁免：docs/（archive=历史快照不改写；spec §218 等会引用旧词解释改名·meta 引用合法）、
//       node_modules / dist / .worktrees / .git / *.d.ts。
//
// 例外放行：ALLOW 白名单（'<relpath>::<禁词>'·破例逐条登记·别改 BANNED）。
//
// 在 scripts/regress.mjs 注册为 check-terminology（纯 node·与 check-protagonist-voice 同类）。
// 跑法： node scripts/check-terminology.mjs

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join, relative } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// 禁词 → 正词（单一来源）。「穿尸」是子串·一并罩住「穿尸者 / 穿尸体」等所有变体。
const BANNED = [
  { bad: '穿尸', good: '尸衣者', note: '与代码/敌人库 corpse_wearer 对齐的单一术语（#224）' },
];

// 例外放行（暂空·破例逐条登记·别动 BANNED）。
const ALLOW = new Set([]);

const SCAN_ROOTS = ['src', 'scenarios'];
const EXT = /\.(ts|tsx|json)$/;
const SKIP_DIR = new Set(['node_modules', 'dist', '.worktrees', '.git']);

const files = [];
function walk(dir) {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    if (SKIP_DIR.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full);
    else if (EXT.test(name) && !name.endsWith('.d.ts')) files.push(full);
  }
}
for (const r of SCAN_ROOTS) walk(resolve(ROOT, r));
files.sort();

const violations = [];
let scanned = 0;
for (const full of files) {
  scanned++;
  const rel = relative(ROOT, full);
  const text = readFileSync(full, 'utf-8');
  for (const { bad, good, note } of BANNED) {
    if (text.includes(bad) && !ALLOW.has(`${rel}::${bad}`)) {
      const lineNo = text.split('\n').findIndex((l) => l.includes(bad)) + 1;
      violations.push(`${rel}:${lineNo}\n      含禁词「${bad}」→ 应作「${good}」（${note}）`);
    }
  }
}

if (violations.length) {
  console.error('✘ 术语单一来源：live 内容（src/scenarios）出现禁词\n');
  for (const v of violations) console.error(`  ${v}`);
  console.error(
    `\n共 ${violations.length} 处。单一来源＝scripts/check-terminology.mjs BANNED + 剧情/科考队 SPEC；` +
      `\n破例登记 ALLOW（别改 BANNED）。docs/ 不在扫描面（archive 历史 / spec meta 引用合法）。`,
  );
  process.exit(1);
}

console.log(`✓ 术语单一来源：扫 ${scanned} 个 src/scenarios 文件·零禁词（穿尸→尸衣者·#224）`);
process.exit(0);
