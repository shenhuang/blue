#!/usr/bin/env node
// 声呐欺骗拆干净门（感知重做 SPEC §6·docs/spec/深海回响_感知重做_SPEC.md）。
//
// 背景：感知重做把「声呐不可信 / 深度驱动欺骗 / 低 san 声呐幻觉」整套删除——声呐＝诚实远场侦察、
// 永不撒谎；欺骗全部移交低理智轴（§2.2/§2.3/§3）。本门把「拆干净」焊成会红的检查：src/ 里任何一个被拆
// 符号残留即红，防它随 session churn 悄悄爬回来（CLAUDE.md「约定落成机制、别靠散文」）。
//
// 扫描面＝src/**/*.{ts,tsx,json}（live 引擎/UI/类型/数据）。豁免：docs/（spec 会引用旧符号解释拆除·meta 合法）、
// node_modules / dist / .worktrees / .git / *.d.ts、本文件自身（BANNED 配置必然含这些串）。
//
// 在 scripts/regress.mjs 注册为 check-no-sonar-deception（纯 node·与 check-terminology / check-boundaries 同类）。
// 跑法： node scripts/check-no-sonar-deception.mjs

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join, relative } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const SELF = relative(ROOT, fileURLToPath(import.meta.url));

// 被拆符号（SPEC §6 清单·单一来源）。任一在 src 出现即红。
const BANNED = [
  'spoofsSonar',
  'evadesSonar',
  'sonarReturn',
  'sonarDeception',
  'sonarPhantoms',
  'applySonarDeception',
  'effectiveFalseEchoSanity',
  'nodeSonarView',
];

const SCAN_ROOT = resolve(ROOT, 'src');
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
walk(SCAN_ROOT);
files.sort((a, b) => a.localeCompare(b));

const violations = [];
let scanned = 0;
for (const full of files) {
  const rel = relative(ROOT, full);
  if (rel === SELF) continue; // 自扫豁免（本文件 BANNED 配置必然含禁词）
  scanned++;
  const lines = readFileSync(full, 'utf-8').split('\n');
  for (let i = 0; i < lines.length; i++) {
    for (const bad of BANNED) {
      if (lines[i].includes(bad)) {
        violations.push(`${rel}:${i + 1}\n      含已拆声呐欺骗符号「${bad}」（感知重做 SPEC §3/§6·声呐诚实·欺骗移交低理智轴）`);
      }
    }
  }
}

if (violations.length) {
  console.error('✘ 声呐欺骗拆干净门：src 里出现已拆的声呐欺骗符号\n');
  for (const v of violations) console.error(`  ${v}`);
  console.error(
    `\n共 ${violations.length} 处。这些符号已随感知重做删除（声呐＝诚实远场侦察·欺骗只剩低理智轴·` +
      `\nSPEC §2.2/§2.3/§3）。单一来源＝scripts/check-no-sonar-deception.mjs BANNED。docs/ 不在扫描面（spec meta 引用合法）。`,
  );
  process.exit(1);
}

console.log(`✓ 声呐欺骗拆干净门：扫 ${scanned} 个 src 文件·零残留（${BANNED.join(' / ')}）`);
process.exit(0);
