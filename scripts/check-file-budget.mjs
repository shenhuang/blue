#!/usr/bin/env node
// 文件行数 ratchet 门（src 大文件只许变小、不许悄悄长回去·2026-07-02）。
//
// 背景：combat.ts / mapgen.ts 曾各自长到 1500–1700 行才动手拆（#248 车道 2b）。「文件别太肥」
// 这类约定写散文必丢，按 CLAUDE.md 落成机制：src/**/*.{ts,tsx} 默认预算 900 行；超默认的文件
// 必须在 scripts/file-budget-baseline.json 有显式条目（现值+10% 向上取整入册），且实际行数 ≤ 条目值。
// ratchet（棘轮）只紧不松：
//   - 条目值不许高于「当前实际行数 ×1.1 向上取整」——文件瘦身后条目自动变「松」→ 门红，
//     跑 --update 机械下调（与 check-lore-refs 的 --update-baseline 同族体验）；缩到默认预算内则条目删除。
//   - --update **绝不调高**既有条目：超预算的文件跑 --update 依旧红——要么拆（按子系统/组件抽私有模块，
//     参照 combat-mechanics / mapgen-* 的拆法），要么确有理由手改 baseline 条目并在 PR 说明。
//   - 新超标文件优先拆；--update 会为无条目的新超标文件入册（初始化用·慎用·别拿它洗白刚写肥的文件）。
//
// 风格同 check-boundaries / check-lore-refs（纯 node·无 TS 依赖）；纯决策函数导出便于单测。
//
// 跑法： node scripts/check-file-budget.mjs
//        node scripts/check-file-budget.mjs --update   # 收缩/初始化基线（不调高既有条目）

import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join, relative } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const SRC_DIR = resolve(ROOT, 'src');
const BASELINE_FILE = resolve(__dirname, 'file-budget-baseline.json');

/** 默认预算（行）：超过它的文件必须在 baseline 有显式条目。 */
export const DEFAULT_BUDGET = 900;
/** ratchet 松紧系数：条目值 ≤ ceil(实际行数 × RATCHET_SLACK)。 */
const RATCHET_SLACK = 1.1;

/** wc -l 语义的行数（数换行符；末尾无换行的最后一行也算一行）。 */
function countLines(text) {
  if (text.length === 0) return 0;
  const n = text.split('\n').length;
  return text.endsWith('\n') ? n - 1 : n;
}

/** 递归收集 src 下 .ts/.tsx（相对 ROOT 的 posix 路径 → 行数）。 */
function collectFileLines() {
  const out = new Map();
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith('.ts') || e.name.endsWith('.tsx')) {
        out.set(relative(ROOT, full).split('\\').join('/'), countLines(readFileSync(full, 'utf-8')));
      }
    }
  };
  walk(SRC_DIR);
  return out;
}

/** 某行数对应的条目值上限（ratchet：现值+10% 向上取整）。 */
export function maxEntryFor(lines) {
  return Math.ceil(lines * RATCHET_SLACK);
}

/**
 * 纯决策（无 IO·便于单测）。
 * @param {Map<string, number>} fileLines  相对路径 → 行数
 * @param {Record<string, number>} budgets baseline 条目（相对路径 → 预算行数）
 * @returns {{overBudget:Array<{file:string,lines:number,budget:number}>,
 *            looseEntries:Array<{file:string,lines:number,entry:number,maxAllowed:number}>,
 *            staleEntries:string[]}}
 *   overBudget＝实际行数超预算（默认或条目·红）；looseEntries＝条目比「实际+10%」还松（红·跑 --update 收）；
 *   staleEntries＝条目指向已不存在的文件（红·跑 --update 清）。
 */
export function decideFileBudget(fileLines, budgets) {
  const overBudget = [];
  const looseEntries = [];
  const staleEntries = [];
  for (const [file, lines] of fileLines) {
    const budget = budgets[file] ?? DEFAULT_BUDGET;
    if (lines > budget) overBudget.push({ file, lines, budget });
  }
  for (const [file, entry] of Object.entries(budgets)) {
    const lines = fileLines.get(file);
    if (lines === undefined) {
      staleEntries.push(file);
      continue;
    }
    if (entry > maxEntryFor(lines)) {
      looseEntries.push({ file, lines, entry, maxAllowed: maxEntryFor(lines) });
    }
  }
  overBudget.sort((a, b) => b.lines - b.budget - (a.lines - a.budget));
  looseEntries.sort((a, b) => a.file.localeCompare(b.file));
  staleEntries.sort();
  return { overBudget, looseEntries, staleEntries };
}

/**
 * --update 的基线重算（只紧不松）：超默认预算的文件入册 min(既有条目, 现值+10%)；
 * 缩回默认内 / 已删除的文件条目移除。**绝不调高**既有条目——超预算文件更新后依旧红（拆或手改+PR 说明）。
 */
export function shrinkBudgets(fileLines, budgets) {
  const next = {};
  for (const [file, lines] of [...fileLines].sort(([a], [b]) => a.localeCompare(b))) {
    if (lines <= DEFAULT_BUDGET) continue;
    const cap = maxEntryFor(lines);
    next[file] = budgets[file] !== undefined ? Math.min(budgets[file], cap) : cap;
  }
  return next;
}

// ── CLI ──（被 import 时不执行）
const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const fileLines = collectFileLines();
  const prior = existsSync(BASELINE_FILE)
    ? JSON.parse(readFileSync(BASELINE_FILE, 'utf-8')).budgets ?? {}
    : {};

  if (process.argv.includes('--update')) {
    const budgets = shrinkBudgets(fileLines, prior);
    writeFileSync(
      BASELINE_FILE,
      JSON.stringify(
        {
          _doc:
            `check-file-budget 的 ratchet 基线：src/**/*.{ts,tsx} 默认预算 ${DEFAULT_BUDGET} 行，` +
            '超默认的文件在此显式入册（条目值 ≤ 实际行数+10% 向上取整·只紧不松）。' +
            '文件瘦身后跑 node scripts/check-file-budget.mjs --update 自动下调/移除条目；' +
            '要调高条目只能手改并在 PR 说明理由——首选还是拆文件（参照 combat-mechanics / mapgen-* 的拆法）。',
          budgets,
        },
        null,
        2,
      ) + '\n',
    );
    console.log(
      `✓ 已写基线 ${relative(ROOT, BASELINE_FILE)}（${Object.keys(budgets).length} 个超默认预算文件入册·未调高任何既有条目）`,
    );
    // 更新完随手复查：超预算文件不会被 --update 洗绿，红就地暴露。
  }

  if (!existsSync(BASELINE_FILE)) {
    console.error(
      `✘ check-file-budget：缺基线 ${relative(ROOT, BASELINE_FILE)}——先跑 node scripts/check-file-budget.mjs --update`,
    );
    process.exit(1);
  }
  const budgets = JSON.parse(readFileSync(BASELINE_FILE, 'utf-8')).budgets ?? {};
  const r = decideFileBudget(fileLines, budgets);

  let failed = false;
  if (r.overBudget.length) {
    failed = true;
    console.error(`✘ 文件行数超预算（默认 ${DEFAULT_BUDGET} 行·超默认需 baseline 显式条目）\n`);
    for (const v of r.overBudget) {
      console.error(`  ${v.file}  ${v.lines} 行 > 预算 ${v.budget}（超 ${v.lines - v.budget} 行）`);
    }
    console.error(
      `\n共 ${r.overBudget.length} 个。别继续往肥文件里堆：按子系统/组件拆出私有模块` +
        `\n（参照 src/engine/combat-mechanics.ts、src/engine/mapgen-*.ts 的拆法·门面 re-export 保 import 面）；` +
        `\n确有理由才手改 scripts/file-budget-baseline.json 条目并在 PR 说明——--update 不会替你调高。\n`,
    );
  }
  if (r.looseEntries.length) {
    failed = true;
    console.error('✘ baseline 条目比「实际行数+10%」松（ratchet 只紧不松·文件瘦身后条目要跟着收）\n');
    for (const v of r.looseEntries) {
      console.error(`  ${v.file}  条目 ${v.entry} > 上限 ${v.maxAllowed}（实际 ${v.lines} 行）`);
    }
    console.error(`\n共 ${r.looseEntries.length} 条。跑 node scripts/check-file-budget.mjs --update 机械收缩。\n`);
  }
  if (r.staleEntries.length) {
    failed = true;
    console.error('✘ baseline 条目指向已不存在的文件\n');
    for (const f of r.staleEntries) console.error(`  ${f}`);
    console.error(`\n共 ${r.staleEntries.length} 条。跑 node scripts/check-file-budget.mjs --update 清理。\n`);
  }

  if (failed) process.exit(1);
  console.log(
    `✓ 文件行数 ratchet 门：src ${fileLines.size} 个 ts/tsx 文件·默认预算 ${DEFAULT_BUDGET} 行·` +
      `入册 ${Object.keys(budgets).length} 个（全部 ≤ 条目值且条目不松）`,
  );
  process.exit(0);
}
