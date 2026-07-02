#!/usr/bin/env node
// quirk 引用门（机制化「活文件引用不存在的 quirk 编号」·2026-07-02 文档修复批·QUIRKS #208）。
//
// 背景：QUIRKS.md 编号只增不重排，但 4e9749f 建档时裁撤过一段号（#45/#46/#48/#50–#90/#92/#94
//   从未进过本档·原文在建档前的 STATUS.md §6）。此前代码注释 / STATUS / SPEC 里写着
//   「quirk #54」「quirk #50」这类死引用——读者翻 QUIRKS.md 找不到条目、也没人发现。
//   这道门把「引用的编号必须真的存在（或明确属于墓碑裁撤号段）」焊成 regress 检查
//   （CLAUDE.md 顶部原则「想长期守住的约定落成会红的门」·与 check-doc-links 同族）。
//
// 规则：扫 src/、scripts/、docs/（**排除 docs/archive/**——append-only 历史合法引用旧号）、
//   CLAUDE.md 里的 /quirk #(\d+)/i，编号必须 ∈
//     ① QUIRKS.md 行首 `N.` 定义集（含「已修复」附录条目）
//   ∪ ② QUIRKS.md 墓碑条目（#208）「裁撤号段：…」点名的号段（历史指针·合法）。
//   不在并集 → 打印 file:line + 编号 → 退 1。
//
// 另跳过 docs/NEXT_SESSION_PROMPT.md：本地 session 交接文件·已 gitignore·每 session 重写
//   （CLAUDE.md 文档维护约定）——不是仓库内容，别让它把门在单机上弄红。
//
// 与既有门同族（纯 node·导出纯决策函数便于单测）。在 scripts/regress.mjs 注册为 check-quirk-refs 任务。
//   跑法： node scripts/check-quirk-refs.mjs

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join, relative } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const QUIRKS_REL = 'docs/QUIRKS.md';
// 扫描根（相对 ROOT）。docs/archive/ 与 NEXT_SESSION_PROMPT 见档头说明。
const SCAN_ROOTS = ['src', 'scripts', 'docs', 'CLAUDE.md'];
const SKIP_REL = new Set(['docs/archive', 'docs/NEXT_SESSION_PROMPT.md']);
// 只读文本文件（防扫进二进制/图片）。
const TEXT_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|md|json|css|html|mmd|txt)$/i;

const REF_RE = /quirk #(\d+)/gi;

// ── 解析 QUIRKS.md ──

// 定义集：行首 `N. ` 的条目号（active + 「已修复」附录都算——都是真实存在的条目）。
export function parseDefined(quirksText) {
  const set = new Set();
  for (const m of quirksText.matchAll(/^(\d+)\.\s/gm)) set.add(Number(m[1]));
  return set;
}

// 裁撤号段：墓碑条目（#208）里「裁撤号段：#a、#b–#c、…」列表（机器可读源真·改措辞别动格式）。
// 解析不到 → 返回空集（门会把历史指针也标红，失败信息提示去核对墓碑条目格式）。
export function parseRetired(quirksText) {
  const set = new Set();
  const seg = quirksText.match(/裁撤号段[：:]([#\d、，,\s–—-]+)/);
  if (!seg) return set;
  for (const m of seg[1].matchAll(/#(\d+)(?:\s*[–—-]\s*#?(\d+))?/g)) {
    const lo = Number(m[1]);
    const hi = m[2] ? Number(m[2]) : lo;
    for (let n = lo; n <= hi; n++) set.add(n);
  }
  return set;
}

/**
 * 纯决策（无 IO·便于单测）：找出引用了「既不在定义集也不在裁撤号段」编号的位置。
 * @param {{path:string,text:string}[]} files  已读入的待扫文件
 * @param {Set<number>} valid                  定义集 ∪ 裁撤号段
 * @returns {{file:string,line:number,num:number}[]}
 */
export function findDeadRefs(files, valid) {
  const dead = [];
  for (const f of files) {
    const lines = f.text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      for (const m of lines[i].matchAll(REF_RE)) {
        const num = Number(m[1]);
        if (!valid.has(num)) dead.push({ file: f.path, line: i + 1, num });
      }
    }
  }
  return dead;
}

// 收集待扫文件（相对路径）——递归目录、按 SKIP_REL / TEXT_EXT 过滤。
function collectFiles(root) {
  const out = [];
  const walk = (abs) => {
    const rel = relative(root, abs).split('\\').join('/');
    if (SKIP_REL.has(rel)) return;
    const st = statSync(abs);
    if (st.isDirectory()) {
      for (const name of readdirSync(abs)) walk(join(abs, name));
    } else if (TEXT_EXT.test(abs)) {
      out.push(rel);
    }
  };
  for (const r of SCAN_ROOTS) {
    const abs = resolve(root, r);
    if (existsSync(abs)) walk(abs);
  }
  return out;
}

// ── CLI ──（被 import 时不执行）
const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const quirksText = readFileSync(resolve(ROOT, QUIRKS_REL), 'utf-8');
  const defined = parseDefined(quirksText);
  const retired = parseRetired(quirksText);
  if (!defined.size) {
    console.error(`✘ quirk 引用门：解析不到 ${QUIRKS_REL} 的任何行首 \`N.\` 条目——文件格式变了？`);
    process.exit(1);
  }
  if (!retired.size) {
    console.error(
      `⚠ quirk 引用门：解析不到墓碑「裁撤号段：…」列表（QUIRKS #208）——历史指针会被误标红，先核对该条格式。`,
    );
  }
  const valid = new Set([...defined, ...retired]);
  const files = collectFiles(ROOT).map((p) => ({ path: p, text: readFileSync(resolve(ROOT, p), 'utf-8') }));
  const dead = findDeadRefs(files, valid);
  if (dead.length) {
    console.error('✘ quirk 引用门：以下 "quirk #N" 引用的编号既不在 QUIRKS.md 定义集、也不在墓碑裁撤号段\n');
    for (const d of dead) console.error(`  ${d.file}:${d.line}  → quirk #${d.num}`);
    console.error(
      `\n共 ${dead.length} 处。要么改成真实存在的条目号，要么直接陈述该约束（别引编号）；` +
        `\n裁撤号段与考据方式见 QUIRKS.md 墓碑条目（#208）。docs/archive/ 不在扫描范围（历史留档）。`,
    );
    process.exit(1);
  }
  console.log(
    `✓ quirk 引用门：${files.length} 个文件的 "quirk #N" 引用全部有效` +
      `（定义 ${defined.size} 条 ∪ 裁撤 ${retired.size} 号·扫 ${SCAN_ROOTS.join(' / ')}·archive 除外）。`,
  );
  process.exit(0);
}
