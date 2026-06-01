// scripts/event-runner.ts —— 事件回归测试框架的 CLI 包装
//
// 引擎层 API 在 src/engine/eventScenario.ts；这里只负责 argv 解析、IO、文字渲染。
//
// 用法：
//   npx tsx scripts/event-runner.ts <eventId> [flags...]
//   npx tsx scripts/event-runner.ts --from scenarios/foo.json
//   echo '{"eventId":"..."}' | npx tsx scripts/event-runner.ts --in -
//   npx tsx scripts/event-runner.ts --list [--zone-tag cave]
//   npx tsx scripts/event-runner.ts --show <eventId>
//
// 详见 docs/STATUS.md "事件回归框架" 一节。

import { readFileSync, readSync } from 'node:fs';
import {
  runEventScenario,
  listAllEvents,
  describeEvent,
  type ScenarioInput,
  type ScenarioResult,
  type ScenarioStep,
} from '../src/engine/eventScenario';

// ---------------------------------------------------------------------------
// argv 解析（手写，无外部依赖）
// ---------------------------------------------------------------------------

interface CliArgs {
  eventId?: string;
  positional: string[];
  flags: Map<string, string | boolean>;
  multi: Map<string, string[]>; // 可重复 flag（--choice）
}

const MULTI_FLAGS = new Set(['--choice']);
const BOOL_FLAGS = new Set([
  '--list',
  '--show',
  '--isolated',
  '--help',
  '-h',
]);

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = {
    positional: [],
    flags: new Map(),
    multi: new Map(),
  };
  let i = 0;
  while (i < argv.length) {
    const tok = argv[i];
    if (tok.startsWith('--')) {
      if (BOOL_FLAGS.has(tok) && (i + 1 >= argv.length || argv[i + 1].startsWith('--'))) {
        out.flags.set(tok, true);
        i++;
      } else if (MULTI_FLAGS.has(tok)) {
        const value = argv[i + 1];
        if (value === undefined) throw new Error(`flag ${tok} 需要一个值`);
        const arr = out.multi.get(tok) ?? [];
        arr.push(value);
        out.multi.set(tok, arr);
        i += 2;
      } else {
        const value = argv[i + 1];
        if (value === undefined || value.startsWith('--')) {
          // 视为 bool
          out.flags.set(tok, true);
          i++;
        } else {
          out.flags.set(tok, value);
          i += 2;
        }
      }
    } else {
      out.positional.push(tok);
      i++;
    }
  }
  out.eventId = out.positional[0];
  return out;
}

function flagString(args: CliArgs, name: string): string | undefined {
  const v = args.flags.get(name);
  return typeof v === 'string' ? v : undefined;
}
function flagNumber(args: CliArgs, name: string): number | undefined {
  const v = flagString(args, name);
  return v === undefined ? undefined : Number(v);
}
function flagBool(args: CliArgs, name: string): boolean {
  return args.flags.get(name) === true;
}

// ---------------------------------------------------------------------------
// 帮助文本
// ---------------------------------------------------------------------------

function printHelp() {
  const help = `
深海回响 · 事件回归测试 CLI

用法：
  快速模式：
    npx tsx scripts/event-runner.ts <eventId> [--choice <id>...] [其它 flag]
  从文件读 scenario：
    npx tsx scripts/event-runner.ts --from scenarios/foo.json
  从 stdin 读 JSON：
    echo '{"eventId":"..."}' | npx tsx scripts/event-runner.ts --in -
  辅助命令：
    npx tsx scripts/event-runner.ts --list [--zone-tag <tag>]
    npx tsx scripts/event-runner.ts --show <eventId>

支持的 flag：
  --stamina <n>       起始 stamina（默认满状态）
  --oxygen <n>        起始 oxygen
  --sanity <n>        起始 sanity
  --nitrogen <n>      起始 nitrogen
  --depth <n>         起始 depth（默认事件 depthRange[0]）
  --zone <id>         起始 zoneId（默认从事件 zoneTags 推断）
  --seed <n>          RNG 种子（确定性）
  --choice <id>       该步选哪个 option.id（可重复，按顺序走链）
  --isolated          chain 模式 = isolated（默认 follow）
  --from <file>       从 JSON 文件读 scenario
  --in -              从 stdin 读 JSON
  --out <text|json>   输出格式（默认 text）
  --list              列出所有事件（id + title + depthRange）
  --zone-tag <tag>    配合 --list 过滤 zoneTag
  --show <eventId>    打印一个事件的完整结构
  --help, -h          这个帮助
`.trim();
  console.log(help);
}

// ---------------------------------------------------------------------------
// 文字渲染（默认 output）
// ---------------------------------------------------------------------------

function renderStep(step: ScenarioStep): string[] {
  const lines: string[] = [];
  const tag = `[tone: ${step.eventTone}]`;
  lines.push(`━━━ Step ${step.stepIndex + 1}: ${step.eventId} ${tag} ━━━`);
  lines.push(`title: ${step.eventTitle}`);
  lines.push(`body:`);
  for (const ln of step.eventBody.split('\n')) lines.push(`  ${ln}`);

  if (step.visibleOptions.length > 0) {
    lines.push(`visible options (${step.visibleOptions.length}):`);
    for (const opt of step.visibleOptions) {
      let line = `  [✓] ${opt.id.padEnd(22)}・ "${opt.label}"`;
      if (opt.checkInfo) {
        const c = opt.checkInfo;
        const pct = Math.round(c.estimatedSuccessRate * 100);
        line += `  ・ check: ${c.stat} vs ${c.dc} (≈${pct}%)`;
      }
      if (opt.hallucination) line += '  ・ [hallucination]';
      lines.push(line);
    }
  } else {
    lines.push('visible options: (none)');
  }

  if (step.hiddenOptions.length > 0) {
    lines.push(`hidden options (${step.hiddenOptions.length}):`);
    for (const opt of step.hiddenOptions) {
      lines.push(`  [✗] ${opt.id.padEnd(22)}・ "${opt.label}"  ・ ${opt.blockedBy}`);
    }
  } else {
    lines.push(`hidden options: (none)`);
  }

  if (step.chosenId) {
    lines.push(`choose: ${step.chosenId}`);
    if (step.checkResult) {
      const r = step.checkResult;
      lines.push(
        `  → check ${r.passed ? 'PASSED' : 'FAILED'} (rate ${r.rate.toFixed(3)})`,
      );
    }
    if (step.narrative.length > 0) {
      lines.push(`  narrative:`);
      for (const n of step.narrative) {
        // 跳过检定行（已在 checkResult 渲染）
        if (n.startsWith('检定 [')) continue;
        for (const sub of n.split('\n')) lines.push(`    ${sub}`);
      }
    }
    const d = step.deltas;
    const partsStats = Object.entries(d.stats)
      .map(([k, v]) => `${k} ${(v as number) >= 0 ? '+' : ''}${v}`)
      .join(', ');
    if (partsStats) lines.push(`  stats Δ: ${partsStats}`);
    if (d.inventoryAdded.length > 0) {
      lines.push(
        `  inventory +: ${d.inventoryAdded.map((i) => `${i.itemId}×${i.qty}`).join(', ')}`,
      );
    }
    if (d.flagsAdded.length > 0) lines.push(`  flags +: ${d.flagsAdded.join(', ')}`);
    if (d.goldDelta !== 0) lines.push(`  gold Δ: ${d.goldDelta}`);
    if (d.loreAdded.length > 0) lines.push(`  lore +: ${d.loreAdded.join(', ')}`);
  } else {
    lines.push(`(no choice provided — scan only)`);
  }

  const n = step.next;
  switch (n.kind) {
    case 'continueEvent':
      lines.push(`  next: continueEvent → ${n.eventId}`);
      break;
    case 'forceAscend':
      lines.push(`  next: forceAscend`);
      break;
    case 'death':
      lines.push(`  next: DEATH`);
      break;
    case 'startCombat':
      lines.push(`  next: would trigger combat ${n.combatId} (战斗边界，不自动跑)`);
      break;
    case 'remainOnEvent':
      lines.push(`  next: remainOnEvent (本事件结束)`);
      break;
    case 'end':
      lines.push(`  next: end (${n.reason})`);
      break;
  }
  return lines;
}

function renderSummary(r: ScenarioResult): string[] {
  const s = r.summary;
  const lines: string[] = [];
  lines.push(`━━━ Summary ━━━`);
  const partsStats = Object.entries(s.statsDelta)
    .map(([k, v]) => `${k} ${(v as number) >= 0 ? '+' : ''}${v}`)
    .join(', ');
  lines.push(`  stats:           ${partsStats || '(无变化)'}`);
  lines.push(
    `  inventory:       ${
      s.inventoryGained.length > 0
        ? s.inventoryGained.map((i) => `${i.itemId}×${i.qty}`).join(', ')
        : '(无变化)'
    }`,
  );
  lines.push(
    `  profile flags:   ${s.profileFlagsAdded.length > 0 ? s.profileFlagsAdded.join(', ') : '(无变化)'}`,
  );
  lines.push(
    `  run flags:       ${s.runFlagsAdded.length > 0 ? s.runFlagsAdded.join(', ') : '(无变化)'}`,
  );
  lines.push(`  banked gold:     ${s.bankedGoldDelta !== 0 ? s.bankedGoldDelta : '(无变化)'}`);
  lines.push(
    `  lore unlocked:   ${s.loreAdded.length > 0 ? s.loreAdded.join(', ') : '(无变化)'}`,
  );
  lines.push(`  final phase:     ${s.finalPhase}`);
  lines.push(`  combat:          ${s.combatTriggered ?? '(none)'}`);
  lines.push(`  survived:        ${s.survived}`);
  if (r.errors.length > 0) {
    lines.push(`  errors:`);
    for (const e of r.errors) lines.push(`    - ${e}`);
  }
  return lines;
}

function renderText(r: ScenarioResult): string {
  const lines: string[] = [];
  lines.push(
    `event: ${r.input.eventId}  (seed=${r.input.seed ?? '<rand>'}, chain=${r.input.chain ?? 'follow'})`,
  );
  if (r.steps.length === 0) {
    lines.push(`(no steps — likely event id 不存在或 maxSteps=0)`);
  }
  for (const step of r.steps) {
    lines.push('');
    lines.push(...renderStep(step));
  }
  lines.push('');
  lines.push(...renderSummary(r));
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// scenario 输入构造
// ---------------------------------------------------------------------------

function readStdin(): string {
  const chunks: Buffer[] = [];
  const fd = 0;
  const buf = Buffer.alloc(65536);
  // 同步读：tsx 跑的脚本里这种用法没问题，避免引入异步复杂度
  let bytes = 0;
  try {
    while ((bytes = readSync(fd, buf, 0, buf.length, null)) > 0) {
      chunks.push(Buffer.from(buf.subarray(0, bytes)));
    }
  } catch {
    // EOF / EAGAIN 等
  }
  return Buffer.concat(chunks).toString('utf8');
}

function buildInput(args: CliArgs): ScenarioInput {
  // 优先级：--from > --in > 快速模式 flag
  if (flagString(args, '--from')) {
    const file = flagString(args, '--from')!;
    const raw = readFileSync(file, 'utf8');
    const obj = JSON.parse(raw) as ScenarioInput;
    return obj;
  }
  if (args.flags.get('--in') === '-') {
    const raw = readStdin();
    return JSON.parse(raw) as ScenarioInput;
  }
  // 快速模式
  const eventId = args.eventId;
  if (!eventId) {
    throw new Error('缺少 eventId 参数（或用 --from / --in -）');
  }
  const stats: Partial<{
    stamina: number;
    oxygen: number;
    sanity: number;
    nitrogen: number;
  }> = {};
  const stamina = flagNumber(args, '--stamina');
  const oxygen = flagNumber(args, '--oxygen');
  const sanity = flagNumber(args, '--sanity');
  const nitrogen = flagNumber(args, '--nitrogen');
  if (stamina !== undefined) stats.stamina = stamina;
  if (oxygen !== undefined) stats.oxygen = oxygen;
  if (sanity !== undefined) stats.sanity = sanity;
  if (nitrogen !== undefined) stats.nitrogen = nitrogen;

  const input: ScenarioInput = {
    eventId,
  };
  if (Object.keys(stats).length > 0) input.stats = stats;
  const depth = flagNumber(args, '--depth');
  if (depth !== undefined) input.depth = depth;
  const seed = flagNumber(args, '--seed');
  if (seed !== undefined) input.seed = seed;
  const zone = flagString(args, '--zone');
  if (zone) input.zoneId = zone;
  if (flagBool(args, '--isolated')) input.chain = 'isolated';
  const choices = args.multi.get('--choice');
  if (choices && choices.length > 0) input.choices = choices;
  return input;
}

// ---------------------------------------------------------------------------
// --list / --show
// ---------------------------------------------------------------------------

function handleList(args: CliArgs) {
  const zoneTag = flagString(args, '--zone-tag');
  const entries = listAllEvents(zoneTag ? { zoneTag } : undefined);
  if (flagString(args, '--out') === 'json') {
    process.stdout.write(JSON.stringify(entries, null, 2) + '\n');
    return;
  }
  console.log(`Events (${entries.length}${zoneTag ? `, zoneTag=${zoneTag}` : ''}):`);
  for (const e of entries) {
    const tags = (e.zoneTags ?? []).join(',');
    console.log(
      `  ${e.id.padEnd(36)} [${e.depthRange[0]}-${e.depthRange[1]}m] [${tags}] [${e.tone}]  ${e.title}`,
    );
  }
}

function handleShow(args: CliArgs) {
  const id = flagString(args, '--show') ?? args.eventId;
  if (!id) {
    throw new Error('--show 需要事件 id');
  }
  const info = describeEvent(id);
  if (!info) {
    console.error(`event "${id}" 未找到`);
    process.exitCode = 1;
    return;
  }
  if (flagString(args, '--out') === 'json') {
    process.stdout.write(JSON.stringify(info, null, 2) + '\n');
    return;
  }
  const e = info.event;
  console.log(`━━━ ${e.id} ━━━`);
  console.log(`title: ${e.title}`);
  console.log(`tone: ${e.tone}`);
  console.log(`depth: ${e.depthRange[0]}-${e.depthRange[1]}m`);
  console.log(`zoneTags: ${(e.zoneTags ?? []).join(', ')}`);
  console.log(`weight: ${e.weight}`);
  if (e.sanityRange) console.log(`sanityRange: ${e.sanityRange[0]}-${e.sanityRange[1]}`);
  if (e.cooldown !== undefined) console.log(`cooldown: ${e.cooldown}`);
  if (e.oncePerRun) console.log(`oncePerRun: true`);
  if (e.oncePerSave) console.log(`oncePerSave: true`);
  console.log(`body:`);
  for (const ln of e.body.split('\n')) console.log(`  ${ln}`);
  console.log(`options:`);
  for (const opt of info.optionSummary) {
    console.log(`  - ${opt.id}: "${opt.label}"`);
    for (const out of opt.outcomes) console.log(`      ${out}`);
  }
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (flagBool(args, '--help') || flagBool(args, '-h')) {
    printHelp();
    return;
  }
  if (flagBool(args, '--list')) {
    handleList(args);
    return;
  }
  // --show flag with value, OR positional 但带 --show
  if (args.flags.has('--show')) {
    handleShow(args);
    return;
  }
  // 没参数 → 帮助
  if (
    !args.eventId &&
    !flagString(args, '--from') &&
    args.flags.get('--in') !== '-'
  ) {
    printHelp();
    return;
  }
  const input = buildInput(args);
  const result = runEventScenario(input);
  const outFmt = flagString(args, '--out') ?? 'text';
  if (outFmt === 'json') {
    // 把 Sets 等转成可序列化
    process.stdout.write(JSON.stringify(result, jsonReplacer, 2) + '\n');
  } else {
    console.log(renderText(result));
  }
  if (result.errors.length > 0) process.exitCode = 1;
}

function jsonReplacer(_key: string, value: unknown): unknown {
  if (value instanceof Set) return Array.from(value);
  if (value instanceof Map) return Object.fromEntries(value);
  return value;
}

try {
  main();
} catch (err) {
  console.error('error:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
}
