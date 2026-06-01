// scripts/combat-runner.ts —— 战斗回归测试框架的 CLI 包装
//
// 引擎层 API 在 src/engine/combatScenario.ts；这里只负责 argv 解析、IO、文字渲染。
// 与 scripts/event-runner.ts 同源套路（手写 argv 解析，无外部 dep）。
//
// 用法：
//   快速模式（单个 action）：
//     npx tsx scripts/combat-runner.ts <combatId> --action <id> [--target <i>] ...
//   多回合 quick mode（可重复 --action / --target，按序对齐）：
//     npx tsx scripts/combat-runner.ts combat.tutorial_shark \
//         --action action.ambush --target 0 \
//         --action action.knife_stab --target 0 \
//         --action action.knife_slash --target 0 \
//         --seed 42
//   从文件读 scenario：
//     npx tsx scripts/combat-runner.ts --from scenarios/combat/foo.json
//   从 stdin 读 JSON：
//     echo '{"combatId":"...","actions":[...]}' | npx tsx scripts/combat-runner.ts --in -
//   辅助命令：
//     npx tsx scripts/combat-runner.ts --list                    # 列所有战斗 encounter
//     npx tsx scripts/combat-runner.ts --list-enemies            # 列所有 enemy def
//     npx tsx scripts/combat-runner.ts --list-actions            # 列所有 player action
//     npx tsx scripts/combat-runner.ts --show <combatId>         # 看战斗
//     npx tsx scripts/combat-runner.ts --show-enemy <enemyId>    # 看敌人
//     npx tsx scripts/combat-runner.ts --show-action <actionId>  # 看行动
//
// 详见 docs/STATUS.md "战斗回归框架（Phase 3）" 一节。

import { readFileSync, readSync } from 'node:fs';
import {
  runCombatScenario,
  listAllCombats,
  listAllEnemies,
  listAllActions,
  describeEnemy,
  describeAction,
  type CombatScenarioInput,
  type CombatScenarioResult,
  type CombatTurnSnapshot,
  type CombatActionInput,
} from '../src/engine/combatScenario';
import { getEncounter, getEnemyDef } from '../src/engine/combat';

// ---------------------------------------------------------------------------
// argv 解析（手写）
// ---------------------------------------------------------------------------

interface CliArgs {
  combatId?: string;
  positional: string[];
  flags: Map<string, string | boolean>;
  multi: Map<string, string[]>;
}

const MULTI_FLAGS = new Set(['--action', '--target', '--enemy']);
const BOOL_FLAGS = new Set([
  '--list',
  '--list-enemies',
  '--list-actions',
  '--show',
  '--show-enemy',
  '--show-action',
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
  out.combatId = out.positional[0];
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
// 帮助
// ---------------------------------------------------------------------------

function printHelp() {
  const help = `
深海回响 · 战斗回归测试 CLI

用法：
  快速模式（多回合）：
    npx tsx scripts/combat-runner.ts <combatId> \\
        --action <id> [--target <i>] [--action <id> --target <i> ...] \\
        [--seed n] [--max-turns n] [其它覆写 flag]
  从文件读 scenario：
    npx tsx scripts/combat-runner.ts --from scenarios/combat/foo.json
  从 stdin 读 JSON：
    echo '{"combatId":"...","actions":[...]}' | npx tsx scripts/combat-runner.ts --in -
  辅助命令：
    npx tsx scripts/combat-runner.ts --list                    # 列出战斗 encounter
    npx tsx scripts/combat-runner.ts --list-enemies            # 列出 enemy def
    npx tsx scripts/combat-runner.ts --list-actions            # 列出 player action
    npx tsx scripts/combat-runner.ts --show <combatId>
    npx tsx scripts/combat-runner.ts --show-enemy <enemyId>
    npx tsx scripts/combat-runner.ts --show-action <actionId>

支持的 flag：
  --stamina <n>       起始 stamina（默认满状态）
  --oxygen <n>        起始 oxygen
  --sanity <n>        起始 sanity
  --nitrogen <n>      起始 nitrogen
  --depth <n>         起始 depth
  --zone <id>         起始 zoneId
  --seed <n>          RNG 种子（确定性）
  --max-turns <n>     回合上限（默认 30）
  --action <id>       该回合选哪个 action（可重复，按顺序对齐）
  --target <i>        该回合的 targetIndex（可重复，与 --action 按序对齐；缺省 = 第一个活敌人）
  --enemy <defId>     ad-hoc encounter：可重复，按列表组装 party（与 combatId 互斥）
  --from <file>       从 JSON 文件读 scenario
  --in -              从 stdin 读 JSON
  --out <text|json>   输出格式（默认 text）
  --help, -h          这个帮助
`.trim();
  console.log(help);
}

// ---------------------------------------------------------------------------
// 渲染
// ---------------------------------------------------------------------------

function renderTurn(t: CombatTurnSnapshot): string[] {
  const lines: string[] = [];
  const tgt = t.targetName ? `→ ${t.targetName}` : '';
  lines.push(`━━━ Turn ${t.turnIndex + 1}: ${t.actionId} ${tgt} ━━━`);
  if (!t.available) {
    lines.push(`  ✗ 不可用：${t.unavailableReason ?? '未知原因'}`);
    return lines;
  }
  for (const l of t.log) {
    lines.push(`  [${l.actor}] ${l.text}`);
  }
  const dp = t.playerStatsDelta;
  const parts = (['stamina', 'oxygen', 'sanity', 'nitrogen'] as const)
    .filter((k) => dp[k] !== undefined)
    .map((k) => `${k} ${(dp[k] as number) >= 0 ? '+' : ''}${dp[k]}`);
  if (parts.length > 0) lines.push(`  player Δ: ${parts.join(', ')}`);
  lines.push(
    `  player: HP=${t.playerStatsAfter.stamina.toFixed(0)} O2=${t.playerStatsAfter.oxygen.toFixed(1)} San=${t.playerStatsAfter.sanity.toFixed(0)} N2=${t.playerStatsAfter.nitrogen.toFixed(1)}`,
  );
  const enemyParts = t.enemiesAfter.map(
    (e) =>
      `${e.name}(hp=${e.hp}/${e.hpMax} ${e.stance}${
        e.statuses.length > 0 ? ' [' + e.statuses.map((s) => s.kind).join(',') + ']' : ''
      })`,
  );
  lines.push(`  enemies: ${enemyParts.join(', ')}`);
  lines.push(`  outcome: ${t.outcome}`);
  return lines;
}

function renderSummary(r: CombatScenarioResult): string[] {
  const s = r.summary;
  const lines: string[] = [];
  lines.push(`━━━ Summary ━━━`);
  lines.push(`  outcome:         ${s.outcome}`);
  lines.push(`  turnsElapsed:    ${s.turnsElapsed}`);
  lines.push(
    `  final stats:     HP=${s.finalHp.toFixed(0)} O2=${s.finalOxygen.toFixed(1)} San=${s.finalSanity.toFixed(0)} N2=${s.finalNitrogen.toFixed(1)}`,
  );
  const parts = (['stamina', 'oxygen', 'sanity', 'nitrogen'] as const)
    .filter((k) => s.statsDelta[k] !== undefined)
    .map((k) => `${k} ${(s.statsDelta[k] as number) >= 0 ? '+' : ''}${s.statsDelta[k]}`);
  lines.push(`  stats Δ (total): ${parts.length > 0 ? parts.join(', ') : '(无变化)'}`);
  lines.push(
    `  loot:            ${
      s.lootGained.length > 0 ? s.lootGained.map((i) => `${i.itemId}×${i.qty}`).join(', ') : '(无)'
    }`,
  );
  lines.push(
    `  enemies alive:   ${
      s.enemiesAlive.length > 0
        ? s.enemiesAlive.map((e) => `${e.name}(hp=${e.hp})`).join(', ')
        : '(全部 hp ≤ 0)'
    }`,
  );
  lines.push(`  final phase:     ${s.finalPhase}`);
  lines.push(`  survived:        ${s.survived}`);
  if (r.errors.length > 0) {
    lines.push(`  errors:`);
    for (const e of r.errors) lines.push(`    - ${e}`);
  }
  return lines;
}

function renderText(r: CombatScenarioResult): string {
  const lines: string[] = [];
  lines.push(
    `combat: ${r.input.combatId ?? `[ad-hoc ${(r.input.enemyDefIds ?? []).join(',')}]`}  (seed=${
      r.input.seed ?? '<rand>'
    }, maxTurns=${r.input.maxTurns ?? 30})`,
  );
  if (r.turns.length === 0) {
    lines.push(`(no turns — 检查 combatId / actions / errors)`);
  }
  for (const t of r.turns) {
    lines.push('');
    lines.push(...renderTurn(t));
  }
  lines.push('');
  lines.push(...renderSummary(r));
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// 输入构造
// ---------------------------------------------------------------------------

function readStdin(): string {
  const chunks: Buffer[] = [];
  const fd = 0;
  const buf = Buffer.alloc(65536);
  let bytes = 0;
  try {
    while ((bytes = readSync(fd, buf, 0, buf.length, null)) > 0) {
      chunks.push(Buffer.from(buf.subarray(0, bytes)));
    }
  } catch {
    /* EOF */
  }
  return Buffer.concat(chunks).toString('utf8');
}

function buildInput(args: CliArgs): CombatScenarioInput {
  if (flagString(args, '--from')) {
    const file = flagString(args, '--from')!;
    const raw = readFileSync(file, 'utf8');
    const parsed = JSON.parse(raw);
    // 丢弃 scenarios/*.json 的辅助字段
    const { _comment: _c, expect: _e, ...rest } = parsed;
    void _c;
    void _e;
    return rest as CombatScenarioInput;
  }
  if (args.flags.get('--in') === '-') {
    const raw = readStdin();
    const parsed = JSON.parse(raw);
    const { _comment: _c, expect: _e, ...rest } = parsed;
    void _c;
    void _e;
    return rest as CombatScenarioInput;
  }

  // ad-hoc?
  const enemyList = args.multi.get('--enemy');
  if (!args.combatId && (!enemyList || enemyList.length === 0)) {
    throw new Error('缺少 combatId（或 --enemy <defId>...）');
  }

  const input: CombatScenarioInput = {};
  if (args.combatId) input.combatId = args.combatId;
  if (enemyList && enemyList.length > 0) input.enemyDefIds = [...enemyList];

  // stats
  const stats: Partial<{ stamina: number; oxygen: number; sanity: number; nitrogen: number }> = {};
  const stamina = flagNumber(args, '--stamina');
  const oxygen = flagNumber(args, '--oxygen');
  const sanity = flagNumber(args, '--sanity');
  const nitrogen = flagNumber(args, '--nitrogen');
  if (stamina !== undefined) stats.stamina = stamina;
  if (oxygen !== undefined) stats.oxygen = oxygen;
  if (sanity !== undefined) stats.sanity = sanity;
  if (nitrogen !== undefined) stats.nitrogen = nitrogen;
  if (Object.keys(stats).length > 0) input.stats = stats;

  const depth = flagNumber(args, '--depth');
  if (depth !== undefined) input.depth = depth;
  const seed = flagNumber(args, '--seed');
  if (seed !== undefined) input.seed = seed;
  const zone = flagString(args, '--zone');
  if (zone) input.zoneId = zone;
  const maxTurns = flagNumber(args, '--max-turns');
  if (maxTurns !== undefined) input.maxTurns = maxTurns;

  // actions / targets：按 --action 的顺序对齐 --target
  const actionIds = args.multi.get('--action') ?? [];
  const targetIdxs = args.multi.get('--target') ?? [];
  if (actionIds.length > 0) {
    const arr: CombatActionInput[] = [];
    for (let i = 0; i < actionIds.length; i++) {
      const a: CombatActionInput = { actionId: actionIds[i] };
      if (targetIdxs[i] !== undefined) a.targetIndex = Number(targetIdxs[i]);
      arr.push(a);
    }
    input.actions = arr;
  }

  return input;
}

// ---------------------------------------------------------------------------
// --list / --show
// ---------------------------------------------------------------------------

function handleList(args: CliArgs) {
  const out = listAllCombats();
  if (flagString(args, '--out') === 'json') {
    process.stdout.write(JSON.stringify(out, null, 2) + '\n');
    return;
  }
  console.log(`Combats (${out.length}):`);
  for (const e of out) {
    console.log(
      `  ${e.id.padEnd(30)} party=${e.memberDefIds.join(',').padEnd(28)} ${
        e.victoryEventId ? `→ ${e.victoryEventId}` : ''
      }`,
    );
  }
}

function handleListEnemies(args: CliArgs) {
  const out = listAllEnemies();
  if (flagString(args, '--out') === 'json') {
    process.stdout.write(JSON.stringify(out, null, 2) + '\n');
    return;
  }
  console.log(`Enemy defs (${out.length}):`);
  for (const e of out) {
    console.log(
      `  ${e.id.padEnd(32)} ${e.name.padEnd(14)} tier=${e.tier.padEnd(9)} hp=${String(e.hp).padEnd(3)} armor=${e.armor} threat=${e.threat} hostility=${e.hostility} attacks=${e.attackCount}`,
    );
  }
}

function handleListActions(args: CliArgs) {
  const acts = listAllActions();
  if (flagString(args, '--out') === 'json') {
    process.stdout.write(JSON.stringify(acts, null, 2) + '\n');
    return;
  }
  console.log(`Player actions (${acts.length}):`);
  for (const a of acts) {
    console.log(
      `  ${a.id.padEnd(22)} ${a.name.padEnd(12)} costs[stam=${a.costStamina} O2=${a.costOxygenTurns}] targeting=${a.targeting} effect=${a.effect.kind}`,
    );
  }
}

function handleShow(args: CliArgs) {
  const id = flagString(args, '--show') ?? args.combatId;
  if (!id) {
    throw new Error('--show 需要 combatId');
  }
  const enc = getEncounter(id);
  if (!enc) {
    console.error(`combat "${id}" 未找到`);
    process.exitCode = 1;
    return;
  }
  if (flagString(args, '--out') === 'json') {
    process.stdout.write(JSON.stringify(enc, null, 2) + '\n');
    return;
  }
  console.log(`━━━ ${enc.id} ━━━`);
  if (enc.introText) console.log(`intro: ${enc.introText}`);
  console.log(`party (${enc.party.members.length}):`);
  for (const m of enc.party.members) {
    const def = getEnemyDef(m.defId);
    console.log(
      `  - ${m.defId}${
        def ? `  ${def.name} (hp=${def.hp}, armor=${def.armor}, threat=${def.threat}, ${def.hostility})` : ''
      }`,
    );
  }
  if (enc.victoryEventId) console.log(`victory → event: ${enc.victoryEventId}`);
}

function handleShowEnemy(args: CliArgs) {
  const id = flagString(args, '--show-enemy');
  if (!id) {
    throw new Error('--show-enemy 需要 enemyId');
  }
  const info = describeEnemy(id);
  if (!info) {
    console.error(`enemy "${id}" 未找到`);
    process.exitCode = 1;
    return;
  }
  if (flagString(args, '--out') === 'json') {
    process.stdout.write(JSON.stringify(info, null, 2) + '\n');
    return;
  }
  const d = info.def;
  console.log(`━━━ ${d.id} ${d.name} ━━━`);
  console.log(
    `tier=${d.tier} hp=${d.hp} armor=${d.armor} evasion=${d.evasion} threat=${d.threat} hostility=${d.hostility} stance=${d.initialStance} ai=${d.aiPattern}`,
  );
  console.log(`flee: ${info.fleeThresholdDescription}`);
  console.log(`attacks:`);
  for (const a of info.attackSummary) {
    const sd = a.sanityDamage ? `, sanity=${a.sanityDamage[0]}-${a.sanityDamage[1]}` : '';
    console.log(
      `  - ${a.id.padEnd(18)} ${a.name.padEnd(10)} ${a.damageType.padEnd(9)} dmg=${a.damage[0]}-${a.damage[1]}${sd} w=${a.weight}`,
    );
    console.log(`      "${a.description}"`);
  }
  console.log(`victoryConditions: [${info.victoryConditions.join(', ')}]`);
  console.log(`loot:`);
  for (const l of info.loot.guaranteed) {
    console.log(`  guaranteed: ${l.itemId} ×${l.qty[0]}-${l.qty[1]} (w=${l.weight})`);
  }
  for (const l of info.loot.rolls) {
    console.log(`  rolls: ${l.itemId} ×${l.qty[0]}-${l.qty[1]} (w=${l.weight})`);
  }
  console.log(`  rollCount: ${info.loot.rollCount}`);
}

function handleShowAction(args: CliArgs) {
  const id = flagString(args, '--show-action');
  if (!id) {
    throw new Error('--show-action 需要 actionId');
  }
  const info = describeAction(id);
  if (!info) {
    console.error(`action "${id}" 未找到`);
    process.exitCode = 1;
    return;
  }
  if (flagString(args, '--out') === 'json') {
    process.stdout.write(JSON.stringify(info, null, 2) + '\n');
    return;
  }
  const a = info.action;
  console.log(`━━━ ${a.id} ${a.name} ━━━`);
  console.log(`description: ${a.description}`);
  console.log(
    `costs: stamina=${a.costStamina}, oxygenTurns=${a.costOxygenTurns}${a.consumesItem ? '  (消耗物品)' : ''}`,
  );
  if (a.requiresEquipment) console.log(`requiresEquipment: ${a.requiresEquipment}`);
  if (a.requiresItemId) console.log(`requiresItemId: ${a.requiresItemId}`);
  if (a.minEquipmentLevel) console.log(`minEquipmentLevel: ${a.minEquipmentLevel}`);
  console.log(`targeting: ${a.targeting}`);
  console.log(`effect: ${info.effectSummary}`);
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
  if (flagBool(args, '--list-enemies')) {
    handleListEnemies(args);
    return;
  }
  if (flagBool(args, '--list-actions')) {
    handleListActions(args);
    return;
  }
  if (args.flags.has('--show')) {
    handleShow(args);
    return;
  }
  if (args.flags.has('--show-enemy')) {
    handleShowEnemy(args);
    return;
  }
  if (args.flags.has('--show-action')) {
    handleShowAction(args);
    return;
  }
  if (
    !args.combatId &&
    !flagString(args, '--from') &&
    args.flags.get('--in') !== '-' &&
    !args.multi.get('--enemy')
  ) {
    printHelp();
    return;
  }

  const input = buildInput(args);
  const result = runCombatScenario(input);
  const outFmt = flagString(args, '--out') ?? 'text';
  if (outFmt === 'json') {
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
