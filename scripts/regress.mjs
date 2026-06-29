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
//   - 全部 playthrough 均已种子化（含 playthrough.ts·见其顶 PLAYTHROUGH_SEED·quirk #129）→ 确定性·无 flake·无需重试。
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
import { getFlag } from './lib/args.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const BIN = join(ROOT, 'node_modules', '.bin');
const tsx = join(BIN, 'tsx');
const tsc = join(BIN, 'tsc');
const vite = join(BIN, 'vite');

// ---- argv ----
const argv = process.argv.slice(2);
// 解析收口 lib/args.mjs（getFlag 与旧 flag() 逐字等价·与 psm/affected 同源）。
const flag = (name) => getFlag(argv, name);
const onlyArg = flag('--only');
const skipArg = flag('--skip');
const listOnly = argv.includes('--list');
const concurrency = Math.max(
  1,
  parseInt(flag('--concurrency') || process.env.REGRESS_CONCURRENCY || '', 10) ||
    Math.min(cpus().length || 4, 8),
);
const onlyTerms = onlyArg ? onlyArg.split(',').map((s) => s.trim()).filter(Boolean) : null;
// --only-exact a,b,c：按任务名「精确」选（与 --only 子串匹配取并集）。供 affected 选测用——避免
// 'playthrough' 这种子串把全部 playthrough* 都带上。additive·不给即与旧行为一致。
const onlyExactArg = flag('--only-exact');
const onlyExact = onlyExactArg ? new Set(onlyExactArg.split(',').map((s) => s.trim()).filter(Boolean)) : null;
const skipTerms = skipArg ? skipArg.split(',').map((s) => s.trim()).filter(Boolean) : null;

// ---- task list ----
// name 用于 --only / --skip 过滤；cmd[0] 是可执行文件，cwd 固定 ROOT。
const buildOut = mkdtempSync(join(tmpdir(), 'blue-regress-build-'));

/** @type {{name:string, cmd:string[], retries?:number}[]} */
const tasks = [];

// 类型检查（最慢的单项之一，先排）
tasks.push({ name: 'typecheck', cmd: [tsc, '--noEmit'] });

// 生产构建（落全新临时目录，避免 mount 删不掉旧 assets 的 EACCES）
// 沙箱（Linux）缺 @rollup/rollup-linux-arm64-gnu（node_modules 是 macOS 装的）→ 自动跳过（quirk #147）。
// nightly 单独用 NODE_PATH=/tmp/rollup-linux-fix 跑 build，不走本门。
const ROLLUP_LINUX_NATIVE = join(ROOT, 'node_modules', '@rollup', 'rollup-linux-arm64-gnu');
const canBuild = process.platform !== 'linux' || existsSync(ROLLUP_LINUX_NATIVE);
if (canBuild) {
  tasks.push({ name: 'build', cmd: [vite, 'build', '--outDir', buildOut, '--logLevel', 'warn'] });
} else {
  console.log('⚠  build 自动跳过（沙箱缺 rollup-linux-arm64-gnu·#147·nightly 单独处理）');
}

// tsx 任务（smoke-*/playthrough*）靠 esbuild 转译 TS 起子进程。沙箱（Linux）的 node_modules 是 macOS
// 装的 → esbuild 平台失配，这批会齐刷刷红（纯环境噪声·与改动无关），逼出「全红＝沙箱限制、忽略」的人工论证。
// 除非 ESBUILD_BINARY_PATH 指向 Linux esbuild（[[blue_regress_sandbox]] 的 /tmp fix·nightly 用），否则下面
// 自动把它们剔出本次运行、留给 Mac/nightly 全绿——判定与 psm gatePlan 的 runnable 同源（quirk #165）、与上面
// canBuild 同范式（quirk #147）。typecheck（tsc）+ check-*（node）+ verify-tutorial（node）不靠 esbuild·照跑。
const canRunTsx = process.platform !== 'linux' || !!process.env.ESBUILD_BINARY_PATH;

// 端到端教学验证（纯 node，不走 tsx）
tasks.push({ name: 'verify-tutorial', cmd: ['node', join('scripts', 'verify-tutorial.mjs')] });

// 写手↔分支一致性（纯 node·把并发隔离方案 A「谁在哪条分支提交」做成会红的门，见 scripts/check-branch.mjs·quirk #104）
tasks.push({ name: 'check-branch', cmd: ['node', join('scripts', 'check-branch.mjs')] });

// 架构边界：engine ↛ ui + src/ui 禁 phase 字面量（纯 node，把解耦约定做成会红的门，见 scripts/check-boundaries.mjs）
tasks.push({ name: 'check-boundaries', cmd: ['node', join('scripts', 'check-boundaries.mjs')] });

// 事件选项 check 标注一致性（纯 node·label「（理智 vs N）」双写必须 == check.{stat,dc}，见 scripts/check-event-dc.mjs）
tasks.push({ name: 'check-event-dc', cmd: ['node', join('scripts', 'check-event-dc.mjs')] });

// POI 专属事件门（纯 node·DiveEvent.poiId 必须命中 chart_pois.json 真实 POI·拼错=软锁，见 scripts/check-event-poi.mjs）
tasks.push({ name: 'check-event-poi', cmd: ['node', join('scripts', 'check-event-poi.mjs')] });

// 主角语调门（纯 node·禁直白情绪/生理戏剧化命名·扫事件正文+日志页·把 [[protagonist-voice]] 散文落成会红的门·漂移修 quirk #184·见 scripts/check-protagonist-voice.mjs）
tasks.push({ name: 'check-protagonist-voice', cmd: ['node', join('scripts', 'check-protagonist-voice.mjs')] });

// 术语单一来源门（纯 node·禁 live 内容〔src+scenarios〕出现「穿尸」·逼回与代码/敌人库对齐的「尸衣者」·收口 #224·见 scripts/check-terminology.mjs）
tasks.push({ name: 'check-terminology', cmd: ['node', join('scripts', 'check-terminology.mjs')] });

// 文案草稿泄漏门（纯 node·src/data/events 玩家可见字段禁 [待过稿]·playtest 报告⑤ 根治·见 scripts/check-draft-leak.mjs）
tasks.push({ name: 'check-draft-leak', cmd: ['node', join('scripts', 'check-draft-leak.mjs')] });

// harness resolveOption 三参门（纯 node·tools/playtest-llm 内 resolveOption 必传父事件·堵教学复播根因·playtest 报告③·见 scripts/check-harness-resolveoption.mjs）
tasks.push({ name: 'check-harness-resolveoption', cmd: ['node', join('scripts', 'check-harness-resolveoption.mjs')] });

// 敌人库四条门（纯 node·registry 不过期 + 引用完整 + 无孤儿 + 有 baseline，见 scripts/check-enemy-refs.mjs）
tasks.push({ name: 'check-enemy-refs', cmd: ['node', join('scripts', 'check-enemy-refs.mjs')] });

// 深入潜点四条门（纯 node·bandId 完整 + 探深↔POI 配对 + 无孤儿 + onlyLighthouse 合法，见 scripts/check-dive-refs.mjs）
tasks.push({ name: 'check-dive-refs', cmd: ['node', join('scripts', 'check-dive-refs.mjs')] });

// 经济可达性门 v2（纯 node·消费 scripts/lib/economy-dag.mjs 单一真相·① 在册 ② 有源 + F1 单调 + F2 无结〔区域环/capstone 依赖〕 + F4 稀疏〔跨区门≤2·硬门·#239〕·F5 软警告·2026-06-29 E/F DAG·见 scripts/check-economy-reachability.mjs）
tasks.push({ name: 'check-economy-reachability', cmd: ['node', join('scripts', 'check-economy-reachability.mjs')] });

// 经济角色门（纯 node·消费 economy-dag·#197 角色分离〔scrap=纯建材0/coral=纯货币/早期不用 coral〕 + #198 reveal〔mentor_logbook 走 marksPois 非裸 flag〕·2026-06-29·见 scripts/check-economy-roles.mjs）
tasks.push({ name: 'check-economy-roles', cmd: ['node', join('scripts', 'check-economy-roles.mjs')] });

// 材料主题一致性门（纯 node·结构件用矿物/打捞·禁生物料当承重 + 早期不压深矿·把 E/F 组「升级账单讲得通」钉成会红的检查·2026-06-28·见 scripts/check-build-material-theming.mjs）
tasks.push({ name: 'check-build-material-theming', cmd: ['node', join('scripts', 'check-build-material-theming.mjs')] });

// 经济 DAG 图漂移门（纯 node·docs/economy-dag.mmd 须与数据同源·脱节即红→`emit-economy-graph.mjs --write` 再生·2026-06-29·见 scripts/emit-economy-graph.mjs）
tasks.push({ name: 'check-economy-graph', cmd: ['node', join('scripts', 'emit-economy-graph.mjs'), '--check'] });

// 道具图标漂移门（纯 node·ui/itemIcons.tsx 专属图标 key 必须是真道具 + 潜点 chip 四个 role 颜色齐·2026-06-28·见 scripts/check-material-icons.mjs）
tasks.push({ name: 'check-material-icons', cmd: ['node', join('scripts', 'check-material-icons.mjs')] });

// 升级账单跨引用门（纯 node·upgrades.json 引用的 itemId 必须是真道具·补 check-data-schema 不跨文件核引用的缺口·2026-06-29·#242·见 scripts/check-upgrade-refs.mjs）
tasks.push({ name: 'check-upgrade-refs', cmd: ['node', join('scripts', 'check-upgrade-refs.mjs')] });

// 主线可达性门（纯 node·前哨解锁链无环/无死结 + columnStory 主线 beat host/引用/跨柱 item 门可达·把「起点→章尾可达」钉成会红的检查·2026-06-27 D-2 M 组·见 scripts/check-mainline-reachable.mjs）
tasks.push({ name: 'check-mainline-reachable', cmd: ['node', join('scripts', 'check-mainline-reachable.mjs')] });

// 材料刷点五条门（纯 node·openEventPool 挂 anchor + ≥3 不同 beat + 引用可解析 + beat 专属 + 与 openEventId 互斥，见 scripts/check-farm-pois.mjs）
tasks.push({ name: 'check-farm-pois', cmd: ['node', join('scripts', 'check-farm-pois.mjs')] });

// 故事重访强制开场四条门（纯 node·storyOpenEvents 挂 anchor + 引用可解析 + 事件 weight0 + 与 openEventId/Pool 互斥·quirk #174·见 scripts/check-story-open-events.mjs）
tasks.push({ name: 'check-story-open-events', cmd: ['node', join('scripts', 'check-story-open-events.mjs')] });

// 持久多口洞绑定门（纯 node·caves.json 参数 sane + chart_pois caveEntry 不悬空·多口持久洞 SPEC §7·见 scripts/check-cave-bindings.mjs）
tasks.push({ name: 'check-cave-bindings', cmd: ['node', join('scripts', 'check-cave-bindings.mjs')] });

// 受影响选择器·关键 fixture 覆盖门（纯 node·改 chart 数据 fixture 必须选出 chart 行为测·把 #195/#196 焊成会红的检查·见 scripts/check-affected-edges.mjs）
tasks.push({ name: 'check-affected-edges', cmd: ['node', join('scripts', 'check-affected-edges.mjs')] });

// append-only 文档门（纯 node·CHANGELOG/QUIRKS 只在 main 改、别在 feature/auto 分支碰·机制化 quirk #130·见 scripts/check-append-only-docs.mjs）
tasks.push({ name: 'check-append-only-docs', cmd: ['node', join('scripts', 'check-append-only-docs.mjs')] });

// 工具链自测门（纯 node·node:test·守 check-branch/append-only/affected 等纯函数 + lib/{glob,args,env}·见 scripts/__tests__·Agent 审计 #6）
tasks.push({ name: 'check-tooling', cmd: ['node', join('scripts', 'run-tooling-tests.mjs')] });

// STATUS.md 新鲜度门（纯 node·顶部 blockquote 在/带日期 + 行数上限 + 点名脚本存在·机制化 CLAUDE.md 文档维护约定 + handoff 依赖）
tasks.push({ name: 'check-status-fresh', cmd: ['node', join('scripts', 'check-status-fresh.mjs')] });

// 文档死链门（README/STATUS 导航 markdown 链接不烂·纯 node·见 scripts/check-doc-links.mjs·2026-06-27 文档治理）
tasks.push({ name: 'check-doc-links', cmd: ['node', join('scripts', 'check-doc-links.mjs')] });

// flag setter scope 门（纯 node·applyFlags〔下潜域〕置位却被持久消费 → 本该 setProfileFlags·quirk #160/#161·incident #184）
tasks.push({ name: 'check-flag-setter', cmd: ['node', join('scripts', 'check-flag-setter.mjs')] });

// 数据结构门（纯 node·src/data+scenarios 全 *.json 可解析 + id 集合无重复·防新字段/坏数据静默上车）
tasks.push({ name: 'check-data-schema', cmd: ['node', join('scripts', 'check-data-schema.mjs')] });

// 月相窗门「无软锁 + schema」门（纯 node·lunarWindow 合法相位 + Ch.1 主线 anchor 无月相窗·SPEC §7·月相潮汐）
tasks.push({ name: 'check-lunar-reach', cmd: ['node', join('scripts', 'check-lunar-reach.mjs')] });

// POI 固定资源 save 级别名门（纯 node·同 POI 内两条 save 脉不得共享 itemId·quirk #163）
tasks.push({ name: 'check-poi-resources', cmd: ['node', join('scripts', 'check-poi-resources.mjs')] });

// dev 工作台漂移门（纯 node·柱 POI 接入 / 战场压力存活聚合 / tone 档位样式·把 #206 dev 面板↔引擎漂移焊成会红的检查·见 scripts/check-dev-panels.mjs）
tasks.push({ name: 'check-dev-panels', cmd: ['node', join('scripts', 'check-dev-panels.mjs')] });

// 海图 UI SSR smoke
tasks.push({ name: 'smoke-chart-ui', cmd: [tsx, join('scripts', 'smoke-chart-ui.tsx')] });

// 海图编辑器（dev 工具）SSR smoke（守数据 shape 演进别静默打挂编辑器）
tasks.push({ name: 'smoke-map-editor', cmd: [tsx, join('scripts', 'smoke-map-editor.tsx')] });

// 剧情编辑器（dev 工具·?storyeditor）SSR smoke（守事件 schema / EVENT_DB 演进别静默打挂编辑器）
tasks.push({ name: 'smoke-story-editor', cmd: [tsx, join('scripts', 'smoke-story-editor.tsx')] });

// 战斗续接图门：事件 triggerCombatId→encounter.victoryEventId 必须进 eventArc/eventRoots（弧树别断在战斗处·victoryEventId 别成假弧头·见 scripts/smoke-event-combat-arc.tsx）
tasks.push({ name: 'smoke-event-combat-arc', cmd: [tsx, join('scripts', 'smoke-event-combat-arc.tsx')] });

// POI 事件集门：剧情编辑器「POI 走查」依赖的 POI→事件集 自洽（open/story 引用完整 + poiId 专属事件均可归位·见 scripts/smoke-poi-events.tsx）
tasks.push({ name: 'smoke-poi-events', cmd: [tsx, join('scripts', 'smoke-poi-events.tsx')] });

// 装备纸娃娃（Otto 改装 / 下潜查看装备）SSR smoke（守装备 schema / 9 槽位演进别静默打挂）
tasks.push({ name: 'smoke-equipment-ui', cmd: [tsx, join('scripts', 'smoke-equipment-ui.tsx')] });

// 素材经济工作台 SSR smoke + parity（守 EconomyDevPanel 渲染 + computeMaterialStats 口径复现 CLI·见 scripts/smoke-economy-panel.tsx）
tasks.push({ name: 'smoke-economy-panel', cmd: [tsx, join('scripts', 'smoke-economy-panel.tsx')] });

// 战斗 dev 面板 SSR smoke + parity（守 CombatDevPanel 渲染 + serializer round-trip〔bonuses/wornSkin/injuries〕
// + EnemySnapshot 扩展〔phaseCount/reachable〕+ buildCombatEntryState 实战入口·见 scripts/smoke-combat-panel.tsx）
tasks.push({ name: 'smoke-combat-panel', cmd: [tsx, join('scripts', 'smoke-combat-panel.tsx')] });

// 海图 POI 调试器 SSR smoke + parity（守 ChartViewDevPanel 渲染 + poiRevealState/effectiveDistance/describeModifier 自洽·见 scripts/smoke-chart-editor.mjs）
tasks.push({ name: 'smoke-chart-editor', cmd: [tsx, join('scripts', 'smoke-chart-editor.mjs')] });

// 全部 playthrough*.ts —— 各自独立进程，可并行（#22 安全）
const playthroughs = readdirSync(join(ROOT, 'scripts'))
  .filter((f) => /^playthrough.*\.ts$/.test(f))
  .sort();
for (const f of playthroughs) {
  const name = basename(f, '.ts'); // e.g. playthrough-sonar
  // 全部 playthrough 已种子化（确定性·quirk #129）→ 不再重试：失败即真红，别拿 retry 盖回归。
  tasks.push({ name, cmd: [tsx, join('scripts', f)] });
}

// ---- 沙箱无 esbuild → 剔出 tsx 任务（保 typecheck + 静态门 + verify-tutorial 跑·全量留 Mac/nightly）----
// 按「可执行文件 == tsx」精确判定（非名字模式）：自动覆盖将来任何 tsx 任务·且不误伤 node 跑的 verify-tutorial。
let deferredTsx = [];
if (!canRunTsx) {
  deferredTsx = tasks.filter((t) => t.cmd[0] === tsx).map((t) => t.name);
  for (let i = tasks.length - 1; i >= 0; i--) if (tasks[i].cmd[0] === tsx) tasks.splice(i, 1);
  if (deferredTsx.length)
    console.log(
      `⚠  沙箱无可用 esbuild → 跳过 ${deferredTsx.length} 个 tsx 行为测/smoke（typecheck+静态门照跑）。\n` +
        '   全量留 Mac/nightly：npm run regress（或本机设 ESBUILD_BINARY_PATH 后再跑）。',
    );
}

// ---- 过滤 ----
let selected = tasks;
if (onlyTerms || onlyExact)
  selected = selected.filter(
    (t) => (onlyTerms && onlyTerms.some((q) => t.name.includes(q))) || (onlyExact && onlyExact.has(t.name)),
  );
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
// 每任务输出限尾部 256KB（断言一般在末尾·末 4k 才打印）。防跑飞/死循环 task 把 out 无界累加撑爆内存
// （40+ 并行 task 时这是最大活内存风险·Agent 审计）。
const MAX_TASK_OUTPUT = 256 * 1024;
function runOnce(task) {
  return new Promise((res) => {
    const [exe, ...args] = task.cmd;
    const child = spawn(exe, args, { cwd: ROOT, env: process.env });
    let out = '';
    const append = (d) => {
      out += d;
      if (out.length > MAX_TASK_OUTPUT) out = out.slice(out.length - MAX_TASK_OUTPUT);
    };
    child.stdout.on('data', append);
    child.stderr.on('data', append);
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
      if (/^vite\.config\.(js|ts)\.timestamp-.*\.mjs$/.test(f)) {
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
  // 沙箱子集（deferredTsx 非空）绝不打「全绿」——一眼扫过容易误读成可发布。打 SUBSET·不可发布。
  const headline = failed.length
    ? `失败 ${failed.length} ✗`
    : deferredTsx.length
      ? 'SUBSET ✓（子集·不可发布）'
      : '全绿 ✓';
  console.log(
    headline +
      ` · ${results.length - failed.length}/${results.length} 通过` +
      (flaked.length ? ` · ${flaked.length} 个重试后过` : '') +
      ` · 墙钟 ${((Date.now() - wall) / 1000).toFixed(1)}s`,
  );

  if (deferredTsx.length)
    console.log(
      `⚠  以上为沙箱子集 · ${deferredTsx.length} 个 tsx 行为测/smoke 未跑（无 esbuild）→ 须 Mac/nightly 全绿补跑·别据此判「全绿可发布」。`,
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
