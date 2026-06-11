#!/usr/bin/env node
// 架构边界检查（三条规则，命中任一即打印 file:line 并退出 1）：
//
// 规则一：engine ↛ ui —— 引擎层不得依赖 UI 层 / React。
//   扫 src/engine/**/*.ts(x) 的模块说明符：
//   - 从 React 导入：'react' / 'react-dom' / 'react/...' / 'react-dom/...'
//   - 从 UI 层导入：路径含 ui/ 段（'../ui/x' / '@/ui' / '@/ui/x' / 'ui/x'）
//
// 规则二：src/ui 禁 phase 字面量 —— phase 构造权收归 engine（CHANGELOG #107·品味评审候选②）。
//   扫 src/ui/**/*.ts(x) + src/App.tsx，命中 `phase: {` / `subPhase: {`（对象字面量
//   构造）即违例。UI 切 phase 一律走 engine/transitions.ts 的具名转移（toPort /
//   beginAscent / toShop / toChart / toDiveEvent / toGameOver …）或别的引擎 reducer。
//   读 phase（state.phase.kind 等）不受限——只禁构造。
//
// 规则三：styles.css 滚动容器白名单 —— 内容滚动统一走 PanelShell（quirk #112）。
//   `overflow(-y): auto|scroll` 只许出现在 .panel-shell-body / .changelog-body；
//   内容型视图要内部滚动＝用 ui/PanelShell 包，别自己开滚动容器。
//
// 把此前靠散文（CLAUDE.md / 评审记忆）维持的解耦约定做成会在 `npm run regress`
// 里失败的门。现状 0 违例 → 直接绿；以后谁越界，这个门会红——不再靠下一个
// agent 读懂散文来遵守。
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

// ── 规则一：engine ↛ ui ──────────────────────────────────────
const engineFiles = collectTs(ENGINE_DIR).sort();
const importViolations = [];

for (const file of engineFiles) {
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
      importViolations.push({ file: relative(ROOT, file), line: lineOf(text, m.index), spec, why });
    }
  }
}

// ── 规则二：src/ui 禁 phase 字面量（构造收归 engine/transitions）──
// 只匹配对象字面量属性构造 `phase: {` / `subPhase: {`；读取（state.phase.kind）
// 与类型注解（phase: GamePhase）都不含 `: {`，不会误判。
const PHASE_LITERAL_RE = /\b(?:phase|subPhase)\s*:\s*\{/g;
const UI_DIR = resolve(ROOT, 'src/ui');
const uiFiles = [...collectTs(UI_DIR), resolve(ROOT, 'src/App.tsx')].sort();
const phaseViolations = [];

for (const file of uiFiles) {
  const text = readFileSync(file, 'utf-8');
  let m;
  PHASE_LITERAL_RE.lastIndex = 0;
  while ((m = PHASE_LITERAL_RE.exec(text))) {
    phaseViolations.push({ file: relative(ROOT, file), line: lineOf(text, m.index) });
  }
}

// ── 规则三：滚动容器白名单 —— 内容滚动统一走 PanelShell（quirk #112）──
// src/styles.css 里 `overflow(-y): auto|scroll` 只允许出现在白名单类上：
//   .panel-shell-body（内容型界面统一壳的滚动体·ui/PanelShell.tsx）
//   .changelog-body （更新日志弹窗·壳之前的既有先例）
// 其余选择器一律违例——内容型视图要内部滚动＝用 PanelShell 包（头部状态固定/内容滚/
// 底部出口三段），别自己开滚动容器；散开自写迟早回到「金币和返回被滚走」。
// 范围只限 src/styles.css（玩家界面）；src/ui/dev/*.css 是 dev 工具自留地，不管。
// 解析假设：styles.css 是扁平 CSS——声明上方最近的 `selector {` 行即其归属；
// @media 块内仍有选择器行，不会把声明算到 @media 头上。注释行（行内含 `*`）跳过。
const SCROLL_WHITELIST = ['.panel-shell-body', '.changelog-body'];
const SCROLL_DECL_RE = /\boverflow(?:-y)?\s*:\s*(?:auto|scroll)\b/;
const cssPath = resolve(ROOT, 'src/styles.css');
const scrollViolations = [];
{
  const lines = readFileSync(cssPath, 'utf-8').split('\n');
  let selector = '(顶层)';
  for (let i = 0; i < lines.length; i++) {
    const open = lines[i].match(/^\s*([^{}]+?)\s*\{\s*$/);
    if (open && !open[1].trim().startsWith('@')) selector = open[1].trim();
    if (
      SCROLL_DECL_RE.test(lines[i]) &&
      !lines[i].includes('*') &&
      !SCROLL_WHITELIST.some((w) => selector.includes(w))
    ) {
      scrollViolations.push({ line: i + 1, selector });
    }
  }
}

let failed = false;

if (importViolations.length) {
  failed = true;
  console.error('✘ engine ↛ ui 边界违例：引擎层（src/engine）不得依赖 UI / React\n');
  for (const v of importViolations) {
    console.error(`  ${v.file}:${v.line}  从 ${v.why} 导入 '${v.spec}'`);
  }
  console.error(
    `\n共 ${importViolations.length} 处。引擎是纯逻辑层，依赖只能单向：ui → engine。` +
      `\n把表现层依赖（React / src/ui/*）留在 ui/ 内；引擎只暴露纯数据与函数。\n`,
  );
}

if (phaseViolations.length) {
  failed = true;
  console.error('✘ src/ui 手搓 phase 字面量违例：phase 构造权在 engine\n');
  for (const v of phaseViolations) {
    console.error(`  ${v.file}:${v.line}  对象字面量构造 phase/subPhase`);
  }
  console.error(
    `\n共 ${phaseViolations.length} 处。UI 切 phase 走 engine/transitions.ts 的具名转移` +
      `\n（toPort / beginAscent / toShop / toChart / toDiveEvent / toGameOver …）；` +
      `\n缺哪个语义就在那里加一个，别在 UI 拼 phase 形状。`,
  );
}

if (scrollViolations.length) {
  failed = true;
  console.error('✘ styles.css 滚动容器白名单违例：内容滚动统一走 PanelShell（quirk #112）\n');
  for (const v of scrollViolations) {
    console.error(`  src/styles.css:${v.line}  「${v.selector}」声明了 overflow(-y): auto|scroll`);
  }
  console.error(
    `\n共 ${scrollViolations.length} 处。内容型视图要内部滚动＝用 ui/PanelShell 包` +
      `\n（头部状态固定 / 内容滚 / 底部出口通栏），别自己开滚动容器；` +
      `\n确属新的正当滚动体，再把类名加进 check-boundaries.mjs 的 SCROLL_WHITELIST。\n`,
  );
}

if (failed) process.exit(1);

console.log(
  `✓ 边界干净：engine ↛ ui（src/engine ${engineFiles.length} 文件·0 违例）` +
    `；src/ui 无 phase 字面量（src/ui+App ${uiFiles.length} 文件·0 违例）` +
    `；styles.css 滚动容器全在白名单（${SCROLL_WHITELIST.join(' / ')}）`,
);
process.exit(0);
