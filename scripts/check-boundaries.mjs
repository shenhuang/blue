#!/usr/bin/env node
// 架构边界检查：engine ↛ ui —— 引擎层不得依赖 UI 层 / React。
//
// 把「引擎别 import ui」这条此前靠散文（CLAUDE.md / 评审记忆）维持的解耦约定
// 做成会在 `npm run regress` 里失败的门：扫 src/engine/**/*.ts(x)，命中下列任一
// 即打印 file:line 并退出 1：
//   - 从 React 导入：'react' / 'react-dom' / 'react/...' / 'react-dom/...'
//   - 从 UI 层导入：路径含 ui/ 段（'../ui/x' / '@/ui' / '@/ui/x' / 'ui/x'）
//
// 现状 0 违例 → 直接绿，把「引擎是纯逻辑层、UI 单向依赖引擎」这条不变量锁死。
// 以后谁让 engine 反向依赖 ui，这个门会红——不再靠下一个 agent 读懂散文来遵守。
//
// 在 scripts/regress.mjs 注册为 check-boundaries 任务（与 verify-tutorial 同类·纯 node）。
//
// 跑法： node scripts/check-boundaries.mjs

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join, relative } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const ENGINE_DIR = resolve(ROOT, 'src/engine');

// 递归收集 .ts/.tsx（engine 目前是扁平目录，但按 **/*.ts 防未来加子目录）
function collectTs(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...collectTs(full));
    else if (name.endsWith('.ts') || name.endsWith('.tsx')) out.push(full);
  }
  return out;
}

// 抽出模块说明符：import/export ... from '...'（含多行 import·锚在 from）
// + 动态 import('...') + require('...')。扫全文（非逐行）以兼容多行 import。
const SPEC_RE =
  /\bfrom\s*['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)|\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

// 违规判定（精确·避免把 'build'〔含 ui 子串〕、'@/ui-utils' 等误判）
const REACT_RE = /^react(-dom)?(\/|$)/; // react · react-dom · react/jsx-runtime · react-dom/server
const UI_RE = /(^|\/)ui(\/|$)/;          // ../ui/x · @/ui · @/ui/x · ui/x（ui 必须是完整路径段）

function lineOf(text, index) {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i++) if (text[i] === '\n') line++;
  return line;
}

const files = collectTs(ENGINE_DIR).sort();
const violations = [];

for (const file of files) {
  const text = readFileSync(file, 'utf-8');
  let m;
  SPEC_RE.lastIndex = 0;
  while ((m = SPEC_RE.exec(text))) {
    const spec = m[1] || m[2] || m[3];
    if (!spec) continue;
    let why = null;
    if (REACT_RE.test(spec)) why = 'React';
    else if (UI_RE.test(spec)) why = 'UI 层';
    if (why) {
      violations.push({ file: relative(ROOT, file), line: lineOf(text, m.index), spec, why });
    }
  }
}

if (violations.length) {
  console.error('✘ engine ↛ ui 边界违例：引擎层（src/engine）不得依赖 UI / React\n');
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}  从 ${v.why} 导入 '${v.spec}'`);
  }
  console.error(
    `\n共 ${violations.length} 处。引擎是纯逻辑层，依赖只能单向：ui → engine。` +
      `\n把表现层依赖（React / src/ui/*）留在 ui/ 内；引擎只暴露纯数据与函数。`,
  );
  process.exit(1);
}

console.log(`✓ engine ↛ ui 边界干净：扫描 src/engine 下 ${files.length} 个文件，0 违例`);
process.exit(0);
