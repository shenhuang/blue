#!/usr/bin/env node
// 理智系统拆干净门（理智系统移除·2026-07-10）。
//
// 背景：连续理智值 run.stats.sanity（0–100）+ 战斗心智攻击（sanityDamage/DamageType|EnemyRole 'sanity'）
// + 事件理智检定（check.stat 'sanity' / sanityRange）+ 低理智幻觉（EventOption.hallucination / HALLUCINATION_*）
// + 氮醉扣理智（narcosisSanityDrain）整套删除——「头脑不正常」改为二态节点门（地点缝 seam·无定心坠过 seam→
// executeDeath）。本门把「拆干净」焊成会红的检查：src/ 里任一 sanity / hallucination 符号残留即红，防它随
// session churn 悄悄爬回来（CLAUDE.md「想守住的解耦落成机制、别靠散文」）。
//
// 扫描面＝src/**/*.{ts,tsx,json,css}（live 引擎/UI/类型/数据/样式）。豁免：docs/（spec 会引用旧符号解释拆除·
// meta 合法）、node_modules / dist / .worktrees / .git / *.d.ts、本文件自身（BANNED 配置必然含这些串）。
// 注：只禁 latin 机制符号 sanity / hallucination；叙事中文「理智 / 幻觉」不禁（角色仍可口头提·同
// check-no-nitrogen-narcosis 的「禁机制符号、叙事仍可口头」口径）。
//
// 在 scripts/regress.mjs 注册为 check-no-sanity（纯 node·与 check-terminology / check-no-sonar-deception 同类）。
// 跑法： node scripts/check-no-sanity.mjs

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join, relative } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const SELF = relative(ROOT, fileURLToPath(import.meta.url));

// 被拆符号（小写·大小写不敏感匹配·单一来源）。任一在 src 出现即红。
// 'sanity' 覆盖 sanityDamage / sanityRange / sanityHp / sanityResist / sanityTakenMult /
//   HALLUCINATION_VISIBLE_SANITY / narcosisSanityDrain / finalSanity 等一切派生；
// 'hallucinat' 覆盖 hallucination / hallucinationApproaches / maybeHallucinationEncounter 等。
const BANNED = ['sanity', 'hallucinat'];

const SCAN_ROOT = resolve(ROOT, 'src');
const EXT = /\.(ts|tsx|json|css)$/;
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
    const low = lines[i].toLowerCase();
    for (const bad of BANNED) {
      if (low.includes(bad)) {
        violations.push(
          `${rel}:${i + 1}\n      含已拆理智系统符号「${bad}」（理智系统移除·「头脑不正常」改地点缝 seam 二态门·见 types/dive.ts DiveNode.seam）`,
        );
      }
    }
  }
}

if (violations.length) {
  console.error('✘ 理智系统拆干净门：src 里出现已拆的 sanity / hallucination 符号\n');
  for (const v of violations) console.error(`  ${v}`);
  console.error(
    `\n共 ${violations.length} 处。理智值 + 战斗心智攻击 + 事件理智检定 + 低理智幻觉 已整套删除` +
      `（发疯＝地点缝 seam 二态门·无定心坠〔steady_mind〕过 seam→executeDeath）。` +
      `\n单一来源＝scripts/check-no-sanity.mjs BANNED。docs/ 不在扫描面（spec meta 引用合法·叙事中文「理智 / 幻觉」不禁）。`,
  );
  process.exit(1);
}

console.log(`✓ 理智系统拆干净门：扫 ${scanned} 个 src 文件·零残留（sanity / hallucination）`);
process.exit(0);
