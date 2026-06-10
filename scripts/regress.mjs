#!/usr/bin/env node
// 全绿回归 runner —— 一条命令跑完整套回归门，进程隔离 + 并行。
//
// 取代「每步手动分批跑 21 个 playthrough」的旧约定（见 docs/NEXT_SESSION_PROMPT.md §9）。
// 把回归文化（quirk #22/#26）做成单命令：
//   tsc 类型检查 + 全部 scripts/playthrough*.ts + verify-tutorial.mjs
//   + smoke-chart-ui.tsx + 生产 vite build（落临时目录）。
//
// 设计要点：
//   - 每个 playthrough 各起一个 tsx 子进程 → 全局 Math.random patch（#22）互不污染，可放心并行。
//   - playthrough.ts ~12% flake（#18）自动重试。
//   - 默认串行约 30–60s 的活儿，并行后墙钟通常 < 15s。
//
// 用法：
//   node scripts/regress.mjs                 跑全绿
//   node scripts/regress.mjs --only sonar    只跑名字含 'sonar' 的任务（迭代用）
//   node scripts/regress.mjs --only typecheck,sonar,mimic
//   node scripts/regress.mjs --skip build    跳过名字含 'build' 的任务
//   node scripts/regress.mjs --list          只列任务不跑
//   node scripts/regress.mjs --concurrency 4 限制并发（默认 = min(CPU, 8)）
//
// 退出码：全过=0，任一失败=1。

import { spawn } from 'node:child_process';
import { readdirSync, mkdtempSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { tmpdir, cpus } from 'node:os';
import { dirname, join, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const BIN = join(ROOT, 'node_modules', '.bin');
const tsx = join(BIN, 'tsx');
const tsc = join(BIN, 'tsc');
const vite = join(BIN, 'vite');

// ---- argv ----
const argv = process.argv.slice(2);
function flag(name) {
  const i = argv.indexOf(name);
  if (i === -1) return null;
  return argv[i + 1] ?? '';
}
const onlyArg = flag('--only');
const skipArg = flag('--skip');
const listOnly = argv.includes('--list');
const concurrency = Math.max(
  1,
  parseInt(flag('--concurrency') || process.env.REGRESS_CONCURRENCY || '', 10) ||
    Math.min(cpus().length || 4, 8),
);
const onlyTerms = onlyArg ? onlyArg.split(',').map((s) => s.trim()).filter(Boolean) : null;
const skipTerms = skipArg ? skipArg.split(',').map((s) => s.trim()).filter(Boolean) : null;

// ---- task list ----
// name 用于 --only / --skip 过滤；cmd[0] 是可执行文件，cwd 固定 ROOT。
const buildOut = mkdtempSync(join(tmpdir(), 'blue-regress-build-'));

/** @type {{name:string, cmd:string[], retries?:number}[]} */
const tasks = [];

// 类型检查（最慢的单项之一，先排）
tasks.push({ name: 'typecheck', cmd: [tsc, '--noEmit'] });

// 生产构建（落全新临时目录，避免 mount 删不掉旧 assets 的 EACCES）
tasks.push({ name: 'build', cmd: [vite, 'build', '--outDir', buildOut, '--logLevel', 'warn'] });

// 端到端教学验证（纯 node，不走 tsx）
tasks.push({ name: 'verify-tutorial', cmd: ['node', join('scripts', 'verify-tutorial.mjs')] });

// 架构边界：engine ↛ ui + src/ui 禁 phase 字面量（纯 node，把解耦约定做成会红的门，见 scripts/check-boundaries.mjs）
tasks.push({ name: 'check-boundaries', cmd: ['node', join('scripts', 'check-boundaries.mjs')] });

// 事件选项 check 标注一致性（纯 node·label「（理智 vs N）」双写必须 == check.{stat,dc}，见 scripts/check-event-dc.mjs）
tasks.push({ name: 'check-event-dc', cmd: ['node', join('scripts', 'check-event-dc.mjs')] });

// 海图 UI SSR smoke
tasks.push({ name: 'smoke-chart-ui', cmd: [tsx, join('scripts', 'smoke-chart-ui.tsx')] });

// 全部 playthrough*.ts —— 各自独立进程，可并行（#22 安全）
const playthroughs = readdirSync(join(ROOT, 'scripts'))
  .filter((f) => /^playthrough.*\.ts$/.test(f))
  .sort();
for (const f of playthroughs) {
  const name = basename(f, '.ts'); // e.g. playthrough-sonar
  // playthrough.ts ~12% flake（#18）→ 多给两次重试
  const retries = f === 'playthrough.ts' ? 2 : 0;
  tasks.push({ name, cmd: [tsx, join('scripts', f)], retries });
}

// ---- 过滤 ----
let selected = tasks;
if (onlyTerms) selected = selected.filter((t) => onlyTerms.some((q) => t.name.includes(q)));
if (skipTerms) selected = selected.filter((t) => !skipTerms.some((q) => t.name.includes(q)));

if (selected.length === 0) {
  console.error('没有匹配的任务。可用任务：\n  ' + tasks.map((t) => t.name).join('\n  '));
  process.exit(2);
}

if (listOnly) {
  console.log(`将运行 ${selected.length} 个任务（并发 ${concurrency}）：`);
  for (const t of selected) console.log('  ' + t.name + (t.retries ? `  (重试 ${t.retries})` : ''));
  process.exit(0);
}

// ---- runner ----
function runOnce(task) {
  return new Promise((res) => {
    const [exe, ...args] = task.cmd;
    const child = spawn(exe, args, { cwd: ROOT, env: process.env });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('error', (err) => res({ code: 1, out: out + '\n' + String(err) }));
    child.on('close', (code) => res({ code: code ?? 1, out }));
  });
}

async function runTask(task) {
  const started = Date.now();
  let attempt = 0;
  let result;
  const maxAttempts = 1 + (task.retries || 0);
  do {
    attempt++;
    result = await runOnce(task);
    if (result.code === 0) break;
  } while (attempt < maxAttempts);
  const ms = Date.now() - started;
  const ok = result.code === 0;
  const flaked = ok && attempt > 1;
  const tag = ok ? (flaked ? `✓ (重试 ${attempt - 1}×后过)` : '✓') : '✗';
  console.log(`${tag}  ${task.name}  ${(ms / 1000).toFixed(1)}s`);
  return { name: task.name, ok, ms, attempt, out: result.out };
}

// vite 在沙箱里删不掉自己的 config 临时文件（mount 不能 unlink·quirk #1），每跑一次
// build 就在仓库根漏一个 vite.config.js.timestamp-*.mjs（曾积到 38 个）。收尾把它们
// mv 进 .git/.sandbox-junk/（rename 沙箱允许；Mac 上 vite 自己删得掉、这里通常扫不到）。
// best-effort：清扫失败绝不影响回归退出码。
function sweepViteTimestampJunk() {
  try {
    if (!existsSync(join(ROOT, '.git'))) return;
    const junkDir = join(ROOT, '.git', '.sandbox-junk');
    if (!existsSync(junkDir)) mkdirSync(junkDir);
    for (const f of readdirSync(ROOT)) {
      if (/^vite\.config\.js\.timestamp-.*\.mjs$/.test(f)) {
        try {
          renameSync(join(ROOT, f), join(junkDir, f));
        } catch {
          /* ignore */
        }
      }
    }
  } catch {
    /* ignore */
  }
}

async function main() {
  const wall = Date.now();
  console.log(
    `\n深海回响 全绿回归 · ${selected.length} 任务 · 并发 ${concurrency}\n` +
      '─'.repeat(48),
  );

  const queue = [...selected];
  const results = [];
  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length) {
      const task = queue.shift();
      results.push(await runTask(task));
    }
  });
  await Promise.all(workers);

  const failed = results.filter((r) => !r.ok);
  const flaked = results.filter((r) => r.ok && r.attempt > 1);
  console.log('─'.repeat(48));
  console.log(
    `${failed.length === 0 ? '全绿 ✓' : `失败 ${failed.length} ✗`}` +
      ` · ${results.length - failed.length}/${results.length} 通过` +
      (flaked.length ? ` · ${flaked.length} 个重试后过` : '') +
      ` · 墙钟 ${((Date.now() - wall) / 1000).toFixed(1)}s`,
  );

  sweepViteTimestampJunk();

  if (failed.length) {
    for (const f of failed) {
      console.log('\n' + '='.repeat(48));
      console.log(`✗ ${f.name} 失败输出：`);
      console.log('='.repeat(48));
      console.log(f.out.trim().slice(-4000)); // 末尾 4k，断言失败一般在末尾
    }
    process.exit(1);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
