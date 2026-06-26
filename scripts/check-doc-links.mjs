#!/usr/bin/env node
// 文档死链门（机制化「STATUS/README 死链随 session churn 漂移」·2026-06-27 文档治理）。
//
// 背景：README.md / docs/STATUS.md 是**导航型「当前状态」文档**——里面的 markdown 链接
//   [text](path) 指向仓内文件/目录。文件改名/删除/迁目录后这些链接会悄悄烂掉
//   （本次审计实例：README 链 `docs/legacy/`〔已不存在〕、STATUS §7 把 SPEC 写在 docs/ 根
//   而真身在 docs/spec/）。此前靠人读散文发现＝随 churn 丢失。这道门把它焊成 regress
//   检查（CLAUDE.md 顶部原则「想长期守住的约定落成会红的门」·与 check-status-fresh 同族）。
//
// 只查「导航型」文档（SCANNED）里的**相对本地 markdown 链接**·零误报优先：
//   - 跳过 http(s):// · mailto: · tel: · 纯锚点 (#...)。
//   - 链接目标按「该文档所在目录」解析；去掉 #anchor / ?query 再查存在（文件或目录均可）。
//   - 命中不存在的目标 → 打印 file:line + 链接 → 退 1。
//
// **刻意不扫** CHANGELOG / QUIRKS / docs/archive/** / docs/spec/**：它们是 append-only 历史
//   / 时点设计记录，合法地引用「当时存在、现已删/改名」的文件（如 CHANGELOG 提已删提案）——
//   对它们查死链会与 append-only 历史约定打架且高误报。要扩范围就往 SCANNED 里加一行。
//
// 与既有门同族（纯 node·导出纯决策函数便于单测）。在 scripts/regress.mjs 注册为 check-doc-links 任务。
//   跑法： node scripts/check-doc-links.mjs

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// 导航型「当前状态」文档（相对 ROOT）。历史/设计文档刻意不在此列（见档头）。
const SCANNED = ['README.md', 'docs/STATUS.md'];

// markdown 链接 [text](target)；target 取到第一个空白或 ) 前（容忍 `(path "title")`）。
const LINK_RE = /\[[^\]]*\]\(([^)\s]+)/g;

// 把链接目标解析成绝对路径；外链/锚点/空 → null（跳过）。导出便于单测。
export function targetToAbs(root, docRelPath, target) {
  if (/^(https?:|mailto:|tel:|#)/i.test(target)) return null;
  const clean = target.replace(/[#?].*$/, ''); // 去掉 #anchor / ?query
  if (!clean) return null;
  const docDir = dirname(resolve(root, docRelPath));
  return resolve(docDir, clean);
}

/**
 * 纯决策（无 IO·便于单测）。
 * @param {{path:string,text:string}[]} files            已读入的导航文档
 * @param {(absPath:string)=>boolean} exists             目标是否存在（文件/目录都算）
 * @param {(docRelPath:string,target:string)=>?string} resolveTarget  解析成绝对路径（null=跳过）
 * @returns {{file:string,line:number,target:string}[]}  死链清单
 */
export function findDeadLinks(files, exists, resolveTarget) {
  const dead = [];
  for (const f of files) {
    const lines = f.text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      let m;
      LINK_RE.lastIndex = 0;
      while ((m = LINK_RE.exec(lines[i]))) {
        const abs = resolveTarget(f.path, m[1]);
        if (abs === null) continue; // 外链/锚点/跳过
        if (!exists(abs)) dead.push({ file: f.path, line: i + 1, target: m[1] });
      }
    }
  }
  return dead;
}

// ── CLI ──（被 import 时不执行）
const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const files = SCANNED.filter((p) => existsSync(resolve(ROOT, p))).map((p) => ({
    path: p,
    text: readFileSync(resolve(ROOT, p), 'utf-8'),
  }));
  const dead = findDeadLinks(
    files,
    (abs) => existsSync(abs),
    (docRel, target) => targetToAbs(ROOT, docRel, target),
  );
  if (dead.length) {
    console.error('✘ 文档死链门：导航型文档里的本地链接指向不存在的目标\n');
    for (const d of dead) console.error(`  ${d.file}:${d.line}  → ${d.target}`);
    console.error(
      `\n共 ${dead.length} 处。改名/删文件/迁目录后同步修这些链接；` +
        `\n只扫 ${SCANNED.join(' / ')}（CHANGELOG/QUIRKS/archive/spec 是历史·刻意不扫·见档头）。`,
    );
    process.exit(1);
  }
  console.log(
    `✓ 文档死链门：${files.length} 个导航文档的本地 markdown 链接全部可达（${SCANNED.join(' / ')}）。`,
  );
  process.exit(0);
}
