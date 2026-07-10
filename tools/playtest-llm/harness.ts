// ─────────────────────────────────────────────────────────────────────────────
// tools/playtest-llm/harness.ts
//
// LLM-driven in-dive step/apply harness for 深海回响 / Blue.
//
// DESIGN — deterministic replay seam:
//   State token = { seed, actions } written to a JSON file. Each bash call is
//   independent; we REPLAY from (seed + action log) rather than keeping a live
//   process alive.  This mirrors tools/playtest-sim/player.ts::runCell — same
//   Math.random patch, same makeLcg call.
//
// CLI:
//   npx tsx tools/playtest-llm/harness.ts step   --token <file> [--zone <id>] [--o2 <n>]
//   npx tsx tools/playtest-llm/harness.ts apply  --token <file> --action <id>
//
// Output:
//   step / apply print a single JSON object to stdout.
//   Terminal runs append a REPORT-<timestamp>.txt to tools/playtest-llm/reports/.
// ─────────────────────────────────────────────────────────────────────────────

import { makeLcg } from '@/engine/rng';
import * as fs from 'node:fs';
import * as path from 'node:path';

// ── shared internals (factored out so campaign.ts can reuse) ─────────────────
import {
  setupDive,
  replayActionsFromState,
  buildLegalActions,
  buildSummary,
  lootGold,
  writeReport,
} from './harness-internal.js';

// ── token schema ──────────────────────────────────────────────────────────────
interface TokenFile {
  seed: number;
  zoneId: string;
  o2Max: number;
  actions: string[]; // ordered log of action ids applied at each decision point
}

// ── decision output types ─────────────────────────────────────────────────────
interface LegalAction {
  id: string;
  label: string;
  detail: string;
}

interface StepContinue {
  done: false;
  phase: string;
  depth: number;
  o2: number;
  stamina: number;
  nitrogen: number;
  turn: number;
  summary: string;
  legalActions: LegalAction[];
}

interface StepDone {
  done: true;
  outcome: string;   // resolution | funeral | gameOver | death | combat-loss | maxSteps | loop | error
  summary: string;
  stats: {
    maxDepth: number;
    turns: number;
    survived: boolean;
    deathCause?: string;
    combats: number;
    lootGold: number;
  };
  reportPath: string;
}

// StepResult union — used as the JSON shape emitted to stdout
export type StepResult = StepContinue | StepDone;

// ── replayer ──────────────────────────────────────────────────────────────────
function replayActions(token: TokenFile, actionsToApply: string[]) {
  (Math as any).random = makeLcg(token.seed);
  const initialState = setupDive(token.zoneId, token.o2Max);
  return replayActionsFromState(initialState, actionsToApply, token.seed);
}

// ── subcommand: step ──────────────────────────────────────────────────────────
function cmdStep(tokenPath: string, zone: string, o2: number): void {
  // Load or create token
  let token: TokenFile;
  if (fs.existsSync(tokenPath)) {
    token = JSON.parse(fs.readFileSync(tokenPath, 'utf8'));
  } else {
    token = {
      seed: Date.now() % 1_000_000_007,
      zoneId: zone,
      o2Max: o2,
      actions: [],
    };
    fs.mkdirSync(path.dirname(path.resolve(tokenPath)), { recursive: true });
    fs.writeFileSync(tokenPath, JSON.stringify(token, null, 2), 'utf8');
  }

  const ctx = replayActions(token, token.actions);

  if (ctx.terminal) {
    const reportPath = writeReport(token, ctx, ctx.terminal);
    const result: StepDone = {
      done: true,
      outcome: ctx.terminal.outcome,
      summary: ctx.terminal.summary,
      stats: {
        maxDepth: ctx.maxDepth,
        turns: ctx.state?.run?.turn ?? 0,
        survived: ctx.terminal.outcome === 'resolution',
        deathCause: ctx.deathCause ?? undefined,
        combats: ctx.combats,
        lootGold: lootGold(ctx.lootAccum),
      },
      reportPath,
    };
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return;
  }

  const legalActions = buildLegalActions(ctx.state);
  const summary = buildSummary(ctx.state, ctx);
  const ph = ctx.state.phase;
  const run = ctx.state.run;
  // 读模型数值四舍五入到 1 位小数（agent 读 JSON·别灌全精度浮点·playtest 报告 ⑤）；保持 number 类型供下游计算。
  const r1 = (n: number): number => Math.round(n * 10) / 10;
  const result: StepContinue = {
    done: false,
    phase: ph.kind === 'dive' ? `dive.${ph.subPhase?.kind}` : ph.kind,
    depth: r1(run?.currentDepth ?? 0),
    o2: r1(run?.stats.oxygen ?? 0),
    stamina: r1(run?.stats.stamina ?? 0),
    nitrogen: r1(run?.stats.nitrogen ?? 0),
    turn: run?.turn ?? 0,
    summary,
    legalActions,
  };
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}

// ── subcommand: apply ─────────────────────────────────────────────────────────
function cmdApply(tokenPath: string, actionId: string): void {
  if (!fs.existsSync(tokenPath)) {
    process.stderr.write(`[apply] token file not found: ${tokenPath}\n`);
    process.exit(1);
  }
  const token: TokenFile = JSON.parse(fs.readFileSync(tokenPath, 'utf8'));

  // Validate action against current legal actions
  const ctx = replayActions(token, token.actions);
  if (ctx.terminal) {
    process.stderr.write(`[apply] dive is already terminal (${ctx.terminal.outcome}) — use step to read result\n`);
    process.exit(1);
  }
  const legal = buildLegalActions(ctx.state);
  const legalIds = new Set(legal.map((a) => a.id));
  if (!legalIds.has(actionId)) {
    process.stderr.write(`[apply] illegal action "${actionId}"\n`);
    process.stderr.write(`legal: ${[...legalIds].join(', ')}\n`);
    process.exit(1);
  }

  // Append action and persist
  token.actions.push(actionId);
  fs.writeFileSync(tokenPath, JSON.stringify(token, null, 2), 'utf8');

  // Now run step to get the next decision point
  cmdStep(tokenPath, token.zoneId, token.o2Max);
}

// ── CLI entrypoint ────────────────────────────────────────────────────────────
function main(): void {
  const args = process.argv.slice(2);
  const sub = args[0];

  function flag(name: string, def = ''): string {
    const i = args.indexOf(name);
    return i !== -1 && args[i + 1] ? args[i + 1] : def;
  }

  const tokenPath = flag('--token', 'tools/playtest-llm/token.json');
  const zone = flag('--zone', 'zone.east_reef');
  const o2 = parseInt(flag('--o2', '80'), 10);

  if (sub === 'step') {
    cmdStep(tokenPath, zone, o2);
  } else if (sub === 'apply') {
    const action = flag('--action');
    if (!action) {
      process.stderr.write('Usage: harness.ts apply --token <file> --action <id>\n');
      process.exit(1);
    }
    cmdApply(tokenPath, action);
  } else {
    process.stderr.write('Usage: harness.ts <step|apply> --token <file> [--zone <id>] [--o2 <n>] [--action <id>]\n');
    process.exit(1);
  }
}

main();
