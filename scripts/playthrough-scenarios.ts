// scripts/playthrough-scenarios.ts —— 事件回归框架的"全部场景串跑"脚本
//
// 跑 scenarios/*.json 里的每一份场景，断言：
//   1. result.errors 长度为 0
//   2. 如果 scenario 文件里写了 expect.steps，跑出来的 steps.length 与之一致
//   3. expect.finalPhase、expect.combatTriggered、expect.checkPassed 等字段，存在则比对
//   4. expect.loreAdded / expect.flagsAdded 是 summary.loreAdded / (profileFlagsAdded ∪ runFlagsAdded) 的子集
//   5. expect.statsDelta 的每一项与 summary.statsDelta 严格相等
//
// 这是 playthrough 套件里的"内容回归"环节——和 playthrough-bluecaves.ts 等结构完全相同：
//   - 在末尾打印 "✓ playthrough 完成" 和 "全部场景通过"
//   - 任何断言失败用 throw 中断，exit code = 1
//
// 详见 docs/STATUS.md "事件回归框架" 一节。

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { runEventScenario, type ScenarioInput, type ScenarioResult } from '../src/engine/eventScenario';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCENARIO_DIR = resolve(__dirname, '..', 'scenarios');

interface ScenarioFile extends ScenarioInput {
  _comment?: string;
  expect?: {
    steps?: number;
    finalPhase?: string;
    errors?: string[];
    loreAdded?: string[];
    flagsAdded?: string[];
    checkPassed?: boolean;
    combatTriggered?: string | null;
    statsDelta?: Record<string, number>;
    notes?: string;
  };
}

function fail(scenarioName: string, msg: string): never {
  throw new Error(`[${scenarioName}] ${msg}`);
}

function checkSubset(scenarioName: string, label: string, expected: string[], actual: string[]) {
  const set = new Set(actual);
  for (const e of expected) {
    if (!set.has(e)) {
      fail(
        scenarioName,
        `${label} 缺少 "${e}"；实际: [${actual.join(', ') || '(空)'}]`,
      );
    }
  }
}

function runOne(file: string): { name: string; result: ScenarioResult; scenario: ScenarioFile } {
  const name = file;
  const raw = readFileSync(resolve(SCENARIO_DIR, file), 'utf8');
  const scenario = JSON.parse(raw) as ScenarioFile;
  // 把 _comment / expect 摘出（这两个字段不属于 ScenarioInput）
  const { _comment, expect, ...input } = scenario;
  void _comment;
  void expect;
  const result = runEventScenario(input as ScenarioInput);
  return { name, result, scenario };
}

function assertScenario(name: string, result: ScenarioResult, expect: ScenarioFile['expect']) {
  // 1. errors 应为空
  if (result.errors.length > 0) {
    fail(name, `errors 非空: ${result.errors.join(' | ')}`);
  }

  if (!expect) return;

  if (expect.errors && expect.errors.length === 0 && result.errors.length > 0) {
    fail(name, `预期无 error，实际 ${result.errors.length} 条`);
  }

  if (expect.steps !== undefined && result.steps.length !== expect.steps) {
    fail(name, `steps 数量不符：期望 ${expect.steps}，实际 ${result.steps.length}`);
  }

  if (expect.finalPhase && result.summary.finalPhase !== expect.finalPhase) {
    fail(
      name,
      `finalPhase 不符：期望 ${expect.finalPhase}，实际 ${result.summary.finalPhase}`,
    );
  }

  if (expect.combatTriggered !== undefined) {
    const exp = expect.combatTriggered;
    const got = result.summary.combatTriggered;
    const norm = (v: string | null | undefined) => (v == null ? null : v);
    if (norm(exp) !== norm(got)) {
      fail(name, `combatTriggered 不符：期望 ${exp ?? 'null'}，实际 ${got ?? 'null'}`);
    }
  }

  if (expect.checkPassed !== undefined) {
    const stepWithCheck = result.steps.find((s) => s.checkResult !== undefined);
    if (!stepWithCheck) {
      fail(name, `checkPassed 期望 ${expect.checkPassed}，但没有任何 step 含 checkResult`);
    }
    if (stepWithCheck!.checkResult!.passed !== expect.checkPassed) {
      fail(
        name,
        `checkPassed 不符：期望 ${expect.checkPassed}，实际 ${stepWithCheck!.checkResult!.passed}`,
      );
    }
  }

  if (expect.loreAdded) {
    checkSubset(name, 'loreAdded', expect.loreAdded, result.summary.loreAdded);
  }
  if (expect.flagsAdded) {
    const allFlags = [
      ...result.summary.profileFlagsAdded,
      ...result.summary.runFlagsAdded,
    ];
    checkSubset(name, 'flagsAdded', expect.flagsAdded, allFlags);
  }
  if (expect.statsDelta) {
    for (const [k, v] of Object.entries(expect.statsDelta)) {
      const got = (result.summary.statsDelta as Record<string, number | undefined>)[k];
      if (got === undefined || Math.abs(got - v) > 1e-6) {
        fail(name, `statsDelta.${k} 不符：期望 ${v}，实际 ${got ?? '(未变化)'}`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

function main() {
  let files: string[] = [];
  try {
    files = readdirSync(SCENARIO_DIR).filter((f) => f.endsWith('.json'));
  } catch (err) {
    console.error(`无法读取 scenarios/ 目录：${err}`);
    process.exitCode = 1;
    return;
  }
  files.sort();
  if (files.length === 0) {
    console.error(`scenarios/ 目录里没有 .json 文件`);
    process.exitCode = 1;
    return;
  }

  console.log(`========== 事件回归 (${files.length} scenarios) ==========`);
  let okCount = 0;
  const fails: string[] = [];
  for (const f of files) {
    let res: { name: string; result: ScenarioResult; scenario: ScenarioFile };
    try {
      res = runOne(f);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      fails.push(`[${f}] 加载/执行异常：${msg}`);
      console.log(`  ✗ ${f}  (异常)`);
      continue;
    }
    try {
      assertScenario(res.name, res.result, res.scenario.expect);
      const stepCount = res.result.steps.length;
      const lore = res.result.summary.loreAdded.length;
      const inv = res.result.summary.inventoryGained.length;
      console.log(
        `  ✓ ${f}  steps=${stepCount} finalPhase=${res.result.summary.finalPhase} lore=${lore} inv=${inv}`,
      );
      okCount++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      fails.push(msg);
      console.log(`  ✗ ${f}`);
      console.log(`      ${msg}`);
    }
  }

  console.log('');
  if (fails.length > 0) {
    console.log(`✗ 失败 ${fails.length} / 通过 ${okCount}`);
    process.exitCode = 1;
    return;
  }
  console.log(`✓ playthrough 完成`);
  console.log(`全部场景通过（${okCount}/${files.length}）`);
}

main();
