#!/usr/bin/env node
// 术语单一来源 lint（CLAUDE.md「约定落成机制」·收口 #224 科考队 SPEC 术语统一）。
//
// 背景：#224 把剧情侧旧词「穿尸者」统一到与代码/敌人库一致的「尸衣者」
// （敌人库 corpse_wearer 的 name + 多文件 + boss memory 全用「尸衣者」；「穿尸者」是剧情侧偏离）。
// 但统一只改了 docs/spec 散文 → 会随 session churn 再分叉（「散文随 churn 丢」的活样本）。
// 本门把**禁词**焊成会红的检查：任何 live 内容（src + scenarios）出现「穿尸」即红，逼回单一术语。
//
// #246 加第二条禁词：silas→Sela 连内部 id 全改名后的残留检查（藏宝贸易 SPEC §12.8 的
// 「rename 后全仓 `grep -i silas` 无残留（除 CHANGELOG 历史）」验收门机制化·§12.9 门 3）。
// 扫描面＝src + scripts（一次性 grep 会随 churn 失效——调试脚本 `_debug_silas*.ts` 这类残留
// 正是复发路径）；大小写不敏感（Silas/silas/SILAS 全罩住）。
//
// 扫描面＝live 游戏代码 + 内容 + 工具脚本（按条目 roots 各自声明）：
//   src/**/*.{ts,tsx,json}（含 data 事件/lore/npcs、engine、ui、types）
//   scenarios/**/*.json（含 _comment 开发注释·#224 残留 2 处即在此）
//   scripts/**/*.{ts,mjs}（工具/调试脚本·silas 条目专用）
// 豁免：docs/（archive=历史快照不改写；spec §218 等会引用旧词解释改名·meta 引用合法）、
//       node_modules / dist / .worktrees / .git / *.d.ts、本文件自身（BANNED/ALLOW 配置必然含禁词）。
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
const SELF = relative(ROOT, fileURLToPath(import.meta.url));

// 禁词 → 正词（单一来源）。每条自带扫描面 roots；ci=true 大小写不敏感。
// 「穿尸」是子串·一并罩住「穿尸者 / 穿尸体」等所有变体。
const BANNED = [
  { bad: '穿尸', good: '尸衣者', roots: ['src', 'scenarios'], note: '与代码/敌人库 corpse_wearer 对齐的单一术语（#224）' },
  { bad: 'silas', good: 'Sela（id: sela）', roots: ['src', 'scripts'], ci: true, note: '#246 改名连 id 全改·藏宝贸易 SPEC §12.8 验收门「无残留 silas」' },
];

// 例外放行（破例逐条登记·别动 BANNED）。
const ALLOW = new Set([
  // check-weekend-base.mjs 档头/报错文案拿「#246 silas→Sela」当 rename 类改动的事件例子——
  // 引用改名事件本身的 meta 引用（同 docs/spec 解释改名的豁免逻辑），非残留。
  'scripts/check-weekend-base.mjs::silas',
]);

const EXT = /\.(ts|tsx|json|mjs)$/;
const SKIP_DIR = new Set(['node_modules', 'dist', '.worktrees', '.git']);

const files = [];
function walk(dir, root) {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    if (SKIP_DIR.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, root);
    else if (EXT.test(name) && !name.endsWith('.d.ts')) files.push({ full, root });
  }
}
const SCAN_ROOTS = [...new Set(BANNED.flatMap((b) => b.roots))];
for (const r of SCAN_ROOTS) walk(resolve(ROOT, r), r);
files.sort((a, b) => a.full.localeCompare(b.full));

const violations = [];
let scanned = 0;
for (const { full, root } of files) {
  const rel = relative(ROOT, full);
  if (rel === SELF) continue; // 自扫豁免：本文件的 BANNED/ALLOW 配置必然含禁词
  scanned++;
  const text = readFileSync(full, 'utf-8');
  for (const { bad, good, note, roots, ci } of BANNED) {
    if (!roots.includes(root)) continue;
    const hay = ci ? text.toLowerCase() : text;
    const needle = ci ? bad.toLowerCase() : bad;
    if (hay.includes(needle) && !ALLOW.has(`${rel}::${bad}`)) {
      const lineNo = hay.split('\n').findIndex((l) => l.includes(needle)) + 1;
      violations.push(`${rel}:${lineNo}\n      含禁词「${bad}」${ci ? '（大小写不敏感）' : ''}→ 应作「${good}」（${note}）`);
    }
  }
}

if (violations.length) {
  console.error('✘ 术语单一来源：live 内容（src/scenarios/scripts）出现禁词\n');
  for (const v of violations) console.error(`  ${v}`);
  console.error(
    `\n共 ${violations.length} 处。单一来源＝scripts/check-terminology.mjs BANNED + 剧情/科考队/藏宝贸易 SPEC；` +
      `\n破例登记 ALLOW（别改 BANNED）。docs/ 不在扫描面（archive 历史 / spec meta 引用合法）。`,
  );
  process.exit(1);
}

console.log(`✓ 术语单一来源：扫 ${scanned} 个 src/scenarios/scripts 文件·零禁词（穿尸→尸衣者 #224·silas→Sela #246）`);
process.exit(0);
