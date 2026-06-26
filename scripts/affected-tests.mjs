#!/usr/bin/env node
// 受影响测试选择器 —— 从「改了哪些文件」沿依赖图算出「哪些 regress 行为测可能被波及」，
// 让迭代/land 只跑相关 playthrough，而不是每次全测。**健全性优先于最小性**：宁可多跑，绝不漏跑。
//
// 为什么不按车道名硬映射（见 docs/infra/parallel-sessions.md 的讨论）：车道是「写边界」，
// 波及面是「依赖闭包」，后者通常更大且随代码演进漂移。这里改走真实依赖：
//   1) 静态 import 图：解析 import/from/dynamic-import/require（@/→src·补扩展名·静态 .json import 也算边界）。
//   2) 动态依赖：扫每个「可达文件」里的路径字面量，抓 fs 读取的 fixture（scenarios/**、
//      playthrough-chart.ts 读的 src/data/chart_pois.json 等）——纯 import 图看不见这些。
//   3) 回退 ALL：任何「解释不了的改动」（不在图里、又不是文档）或全局触发（tsconfig/package/
//      vite/regress 本身）→ 直接返回 ALL，让调用方跑全量。这条保证永不漏测。
//
// 行为测入口（= regress 里 esbuild 相关的那批任务）：scripts/playthrough*.ts + smoke-*.tsx + verify-tutorial.mjs。
// typecheck 与 check-*（纯 node·全局不变量）不在选择范围——它们便宜，调用方一律全跑。
//
// 用法：
//   node scripts/affected-tests.mjs --since main          # 对比 merge-base(main) 的改动
//   node scripts/affected-tests.mjs --changed a.ts,b.json # 显式给改动文件
//   node scripts/affected-tests.mjs --since main --json    # 机读
// 输出：受影响任务名（每行一个）；全量时输出单行 ALL。退出码恒 0（这是查询不是门）。

import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join, relative, posix as pp } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = resolve(__dirname, '..');

const SRC_EXTS = ['.ts', '.tsx', '.mjs', '.js', '.json'];
const RESOLVE_TRY = ['', '.ts', '.tsx', '.mjs', '.js', '.json', '/index.ts', '/index.tsx', '/index.mjs'];
// import/export ... from '...'  +  import('...')  +  require('...')（同 check-boundaries.mjs·多行安全）
const SPEC_RE = /\bfrom\s*['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)|\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
// 任意字符串字面量（抓动态路径用·含 new URL('...', import.meta.url) / resolve(__dirname,'...')）
const STR_RE = /['"]([^'"\n]{2,})['"]/g;

// 全局触发：改了它们＝可能影响所有测试 → ALL
const GLOBAL_TRIGGERS = [
  /^package(-lock)?\.json$/, /^tsconfig.*\.json$/, /^vite\.config\.[tj]s$/,
  /^scripts\/regress\.mjs$/, /^scripts\/affected-tests\.mjs$/,
];
// 惰性文件：改了不影响任何测试 → 忽略（不触发 ALL，也不选任何测）
const INERT = [/^docs\//, /\.md$/, /^\.gitignore$/, /^\.githooks\//, /^README/, /^LICENSE/, /\.txt$/, /^psm\.config\.json$/, /^\.worktrees\//];

function isEntry(relPath) {
  return /^scripts\/playthrough.*\.ts$/.test(relPath) || /^scripts\/smoke-.*\.tsx$/.test(relPath) || relPath === 'scripts/verify-tutorial.mjs';
}
function taskName(relPath) { return relPath.replace(/^scripts\//, '').replace(/\.(ts|tsx|mjs)$/, ''); }

// scenario 基线目录 → 唯一读取它的行为测（精确边）。消除「改 scenarios/** 一律保守回退 ALL」：
// 四个 *-scenarios runner 用 resolve(__dirname,'..','scenarios','combat') 拼目录（无含 / 的路径字面量）→
// 动态腿（resolveLiteralPath 的 slash 守卫）看不见这条边 → scenarios/ 落进 unexplained → ALL（doc 曾宣称
// 「改 scenarios/lighthouse/* → 只选 1 个」实为假）。这里显式声明：子目录优先·根下 flat *.json = 事件基线。
// 每个 runner 只读自己那个目录 → 映射是健全的「精选」而非冒进（漏选风险零·新子目录走下面 null→安全网 ALL）。
const SCENARIO_DIR_TASK = [
  ['scenarios/combat/', 'playthrough-combat-scenarios'],
  ['scenarios/mapgen/', 'playthrough-mapgen-scenarios'],
  ['scenarios/lighthouse/', 'playthrough-lighthouse-scenarios'],
];
export function scenarioTaskFor(c) {
  if (!c.startsWith('scenarios/')) return null;
  for (const [prefix, task] of SCENARIO_DIR_TASK) if (c.startsWith(prefix)) return task;
  if (/^scenarios\/[^/]+\.json$/.test(c)) return 'playthrough-scenarios'; // 根下 flat 事件基线
  return null; // scenarios 下未知形态（非 .json / 未知子目录）→ 交回原逻辑（unexplained→ALL·安全网）
}

function walk(dir, root, out) {
  let ents; try { ents = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    if (e.name === 'node_modules' || e.name === '.git' || e.name === '.worktrees' || e.name === 'dist') continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) walk(full, root, out);
    else if (SRC_EXTS.some((x) => e.name.endsWith(x))) out.push(pp.normalize(relative(root, full).split('\\').join('/')));
  }
  return out;
}

// 把模块说明符解析成仓库内相对路径（解析不到 / 外部包 → null）
function resolveSpec(fromRel, spec, root) {
  if (!spec || /^[a-zA-Z]/.test(spec) && !spec.startsWith('@/')) return null; // 裸包名 react/node:fs 等
  let base;
  if (spec.startsWith('@/')) base = resolve(root, 'src', spec.slice(2));
  else if (spec.startsWith('.')) base = resolve(root, dirname(fromRel), spec);
  else return null;
  for (const suf of RESOLVE_TRY) {
    const cand = base + suf;
    try { if (existsSync(cand) && statSync(cand).isFile()) return pp.normalize(relative(root, cand).split('\\').join('/')); } catch { /* */ }
  }
  return null;
}

// 裸 fixture 文件名（无 `/`）解析锚点：约定上所有数据 fixture 都住 src/data/。
// 引擎/测试常以 `readFileSync('chart_pois.json')` / `readJson('chart_pois.json')`（DATA=src/data）这种
// 裸名读取 fixture——这类字面量不带 `/`，下面 resolveLiteralPath 的 slash 守卫本会放过它，
// 于是「改 src/data/chart_pois.json → 漏选 playthrough-chart/smoke-chart-ui」（#195/#196 中招的缺口）。
// 把裸 `<名>.json` 锚到 src/data/ 再 existsSync 校验：只有真实存在的 fixture 才连边，零误报
// （随手出现的 'tsconfig.json' 不会因 src/data/tsconfig.json 不存在而误连）。这是「健全性优先于
// 最小性」的通用安全网，不是两文件硬编码——任何 src/data/*.json 被裸名读取都覆盖，且与引擎当前用
// 静态 import 还是运行时 fs 读取无关（静态 import 那条边由 import 图覆盖；这条防住改回 fs 读取的回归）。
const BARE_FIXTURE_DIRS = ['src/data'];
const BARE_FIXTURE_RE = /^[\w.-]+\.json$/; // 仅纯文件名·无路径分隔符·.json fixture

// 把字符串字面量当可能的动态路径解析成仓库内路径（文件或目录·解析不到→null）
function resolveLiteralPath(fromRel, lit, root) {
  if (lit.startsWith('http') || lit.includes('${') || lit.includes('*')) return null;
  if (!lit.includes('/')) {
    // 裸文件名：只认 src/data/ 下真实存在的 *.json fixture（见上），其余一律放过。
    if (!BARE_FIXTURE_RE.test(lit)) return null;
    for (const dir of BARE_FIXTURE_DIRS) {
      const cand = resolve(root, dir, lit);
      try { if (existsSync(cand) && statSync(cand).isFile()) return pp.normalize(relative(root, cand).split('\\').join('/')); } catch { /* */ }
    }
    return null;
  }
  for (const base of [resolve(root, dirname(fromRel), lit), resolve(root, lit)]) {
    try { if (existsSync(base)) return pp.normalize(relative(root, base).split('\\').join('/')); } catch { /* */ }
  }
  return null;
}

export function buildGraph(root = DEFAULT_ROOT) {
  const files = [...walk(join(root, 'src'), root, []), ...walk(join(root, 'scripts'), root, [])];
  const fileSet = new Set(files);
  const imports = new Map();   // rel → Set(rel) 静态 import 边
  const text = new Map();
  for (const f of files) {
    let t; try { t = readFileSync(join(root, f), 'utf-8'); } catch { t = ''; }
    text.set(f, t);
    const deps = new Set();
    let m; SPEC_RE.lastIndex = 0;
    while ((m = SPEC_RE.exec(t))) {
      const r = resolveSpec(f, m[1] || m[2] || m[3], root);
      if (r && fileSet.has(r)) deps.add(r);
    }
    imports.set(f, deps);
  }
  // 入口可达集（DFS）
  const entries = files.filter(isEntry);
  const reachOf = new Map(); // entry → Set(reachable files, 含自身)
  for (const e of entries) {
    const seen = new Set([e]); const stack = [e];
    while (stack.length) { for (const d of imports.get(stack.pop()) || []) if (!seen.has(d)) { seen.add(d); stack.push(d); } }
    reachOf.set(e, seen);
  }
  // 动态依赖：扫每个「被某入口可达」的文件里的路径字面量 → repo 路径
  const reachableUnion = new Set(); for (const s of reachOf.values()) for (const f of s) reachableUnion.add(f);
  const dynDepOf = new Map(); // file → Set(repo path：文件或目录前缀)
  for (const f of reachableUnion) {
    const t = text.get(f) || '';
    if (!/readFileSync|readdirSync|existsSync|readSync|new URL\s*\(/.test(t)) continue; // 只扫真正做动态 IO 的文件·避开注释/日志串噪声
    const set = new Set();
    let m; STR_RE.lastIndex = 0;
    while ((m = STR_RE.exec(t))) { const p = resolveLiteralPath(f, m[1], root); if (p) set.add(p); }
    if (set.size) dynDepOf.set(f, set);
  }
  return { root, files, fileSet, entries, reachOf, dynDepOf };
}

// changed: 仓库相对路径数组。返回 { mode:'all'|'subset', tasks:[], reason, unexplained:[] }
export function computeAffected(changed, graphOrRoot) {
  const g = (graphOrRoot && graphOrRoot.entries) ? graphOrRoot : buildGraph(graphOrRoot || DEFAULT_ROOT);
  const norm = (c) => pp.normalize(String(c).split('\\').join('/').replace(/^\.\//, ''));
  const list = [...new Set(changed.map(norm).filter(Boolean))];

  const trig = list.find((c) => GLOBAL_TRIGGERS.some((re) => re.test(c)));
  if (trig) return { mode: 'all', tasks: [], reason: `全局触发：${trig}`, unexplained: [] };

  const affected = new Set();
  const unexplained = [];
  for (const c of list) {
    if (INERT.some((re) => re.test(c))) continue;
    let explained = false;
    // scenario 基线目录 → 对应 runner（精确边·见 scenarioTaskFor·消除「改 scenarios/** 一律 ALL」）
    const scTask = scenarioTaskFor(c);
    if (scTask) { affected.add(scTask); explained = true; }
    // 改的就是某个入口本身
    if (isEntry(c)) { affected.add(taskName(c)); explained = true; }
    for (const e of g.entries) {
      const reach = g.reachOf.get(e);
      // 静态：c 在该入口可达集
      if (reach.has(c)) { affected.add(taskName(e)); explained = true; continue; }
      // 动态：该入口可达的某文件，其路径字面量命中 c（文件相等或目录前缀）
      for (const f of reach) {
        const dd = g.dynDepOf.get(f); if (!dd) continue;
        let hit = false;
        for (const p of dd) { if (c === p || c.startsWith(p.endsWith('/') ? p : p + '/')) { hit = true; break; } }
        if (hit) { affected.add(taskName(e)); explained = true; break; }
      }
    }
    // 落在源码区却没人能解释（css/动态加载/新孤儿…）→ 不敢narrow，记下，最终转 ALL
    if (!explained && (c.startsWith('src/') || c.startsWith('scripts/') || c.startsWith('scenarios/') || c.startsWith('public/'))) unexplained.push(c);
  }
  if (unexplained.length) return { mode: 'all', tasks: [], reason: `有改动无法在依赖图里解释（保守全量）：${unexplained.slice(0, 5).join(', ')}${unexplained.length > 5 ? ' …' : ''}`, unexplained };
  return { mode: 'subset', tasks: [...affected].sort(), reason: list.length ? '按依赖图选出受影响行为测' : '无改动', unexplained: [] };
}

// ── git 改动文件 ──
function changedSince(root, sinceRef) {
  const run = (args) => { try { return execFileSync('git', ['--no-optional-locks', ...args], { cwd: root, encoding: 'utf-8' }).trim(); } catch { return ''; } };
  let base = sinceRef;
  try { base = run(['merge-base', sinceRef, 'HEAD']) || sinceRef; } catch { /* */ }
  const out = new Set();
  for (const range of [['diff', '--name-only', base + '..HEAD'], ['diff', '--name-only'], ['diff', '--name-only', '--cached']])
    for (const l of run(range).split('\n')) if (l.trim()) out.add(l.trim());
  for (const l of run(['ls-files', '--others', '--exclude-standard']).split('\n')) if (l.trim()) out.add(l.trim());
  return [...out];
}

// ── CLI ──
const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const argv = process.argv.slice(2);
  const flag = (n) => { const i = argv.indexOf(n); return i === -1 ? null : (argv[i + 1] ?? ''); };
  const asJson = argv.includes('--json');
  const changedArg = flag('--changed');
  const since = flag('--since') || 'main';
  const root = DEFAULT_ROOT;
  const changed = changedArg ? changedArg.split(',').map((s) => s.trim()).filter(Boolean) : changedSince(root, since);
  const res = computeAffected(changed, buildGraph(root));
  if (asJson) { console.log(JSON.stringify({ ...res, changed }, null, 2)); process.exit(0); }
  if (res.mode === 'all') { console.error(`# ${res.reason}`); console.log('ALL'); process.exit(0); }
  console.error(`# ${res.reason}（改动 ${changed.length} 文件 → ${res.tasks.length} 个行为测）`);
  for (const t of res.tasks) console.log(t);
  process.exit(0);
}
