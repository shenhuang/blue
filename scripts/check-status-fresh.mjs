#!/usr/bin/env node
// STATUS.md 新鲜度门（机制化 CLAUDE.md「STATUS 只留当前状态 + ~2 session·别膨胀」+ handoff 依赖·2026-06-26）。
//
// 背景：CLAUDE.md 的文档维护约定（STATUS 精简 / 顶部 blockquote 滚动）此前纯散文——随 session churn 漂移：
//   · STATUS 已 ~503 行（"lean" 意图下偏胖·更早 session 该滚进 CHANGELOG）；
//   · `npm run handoff` 直接打印 STATUS 顶部 blockquote 当「当前状态」——blockquote 若烂掉/无日期，
//     handoff 再生的定位就空了（正是 handoff 想消灭的那层漂移）；
//   · STATUS 正文若点名某个**已删/改名**的 playthrough-/check- 脚本（带扩展名的明确文件引用）＝陈旧地图，误导新 session。
// 这道门把这几条从散文焊成 regress 检查（CLAUDE.md 顶部原则）。**只查结构性、不查易碎的散文计数**——
// 「N 个 playthrough」这类计数留 `npm run handoff` 的 git 真值，不在这里硬 gate（否则一改内容就误红）。
//
// 失败条件（命中任一 → 红）：
//   1) 顶部 blockquote 缺失（handoff 取不到当前状态）。
//   2) 顶部 blockquote 无 YYYY-MM-DD 日期（防退化成无日期 banner）。
//   3) STATUS.md 行数 > LINE_CAP（强制把更早 session 滚进 CHANGELOG·CAP 可调）。
//   4) STATUS 正文里**带扩展名**点名的 playthrough-/check- 脚本在 scripts/ 不存在（陈旧引用）。
//      —— 只认带 .ts/.tsx/.mjs 的明确文件引用（如 `playthrough-chart.ts`）·裸散文名（"check-list" 之类）一律放过·零误报。
//
// 与既有门同族（纯 node·导出纯决策函数便于单测）。在 scripts/regress.mjs 注册为 check-status-fresh 任务。
//   跑法： node scripts/check-status-fresh.mjs

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const STATUS = 'docs/STATUS.md';
const LINE_CAP = 600; // 当前 ~503·留 ~1–2 session 余量后强制滚动归档（数值可调·作者最后统一调）
const SCRIPT_EXTS = ['.ts', '.tsx', '.mjs'];

// 顶部第一段连续 '>' 引用块（与 handoff.mjs::topBlockquote 同义·故意复刻：handoff 正是读它）。
export function topBlockquote(text) {
  const out = [];
  let started = false;
  for (const l of text.split('\n')) {
    if (l.startsWith('>')) { out.push(l); started = true; }
    else if (started) break;
  }
  return out.join('\n');
}

/**
 * 纯决策（无 IO·便于单测）。
 * @param {string} text       STATUS.md 文本
 * @param {(name:string)=>boolean} scriptExists  脚本名（无扩展）是否存在于 scripts/
 * @param {{lineCap?:number}} [opts]
 * @returns {{fails:string[], lineCount:number, refs:string[]}}
 */
export function decideStatusFresh(text, scriptExists, { lineCap = LINE_CAP } = {}) {
  const fails = [];
  const bq = topBlockquote(text);
  if (!bq.trim()) {
    fails.push('顶部 blockquote 缺失——handoff 取不到「当前状态」（在 STATUS 顶部用 > 引用块写最近 session）。');
  } else if (!/20\d{2}-\d{2}-\d{2}/.test(bq)) {
    fails.push('顶部 blockquote 无 YYYY-MM-DD 日期——别让它退化成无日期 banner。');
  }
  const lineCount = text.split('\n').length;
  if (lineCount > lineCap) {
    fails.push(`STATUS.md ${lineCount} 行 > 上限 ${lineCap}——把更早 session 滚进 docs/archive/CHANGELOG.md（CLAUDE.md 文档维护约定）。`);
  }
  // 带扩展名的明确脚本文件引用（裸散文名放过·零误报）。
  const refs = [
    ...new Set((text.match(/\b(?:playthrough|check)-[a-z0-9-]+\.(?:ts|tsx|mjs)\b/g) || []).map((s) => s.replace(/\.(?:ts|tsx|mjs)$/, ''))),
  ].sort();
  for (const r of refs) {
    if (!scriptExists(r)) fails.push(`STATUS 点名脚本「${r}」在 scripts/ 不存在（陈旧引用·改名/删了就同步 STATUS）。`);
  }
  return { fails, lineCount, refs };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const text = readFileSync(resolve(ROOT, STATUS), 'utf-8');
  const scriptExists = (name) => SCRIPT_EXTS.some((e) => existsSync(resolve(ROOT, 'scripts', name + e)));
  const { fails, lineCount, refs } = decideStatusFresh(text, scriptExists);
  if (fails.length) {
    console.error('✘ STATUS.md 新鲜度门：\n');
    for (const f of fails) console.error('  · ' + f);
    console.error('\n  （只查结构性新鲜度·散文计数留 npm run handoff 的 git 真值。）');
    process.exit(1);
  }
  console.log(`✓ STATUS.md 新鲜度门：顶部 blockquote 在且带日期·${lineCount}/${LINE_CAP} 行·点名 ${refs.length} 个脚本全部存在。`);
  process.exit(0);
}
