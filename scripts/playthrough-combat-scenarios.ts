// scripts/playthrough-combat-scenarios.ts —— 战斗回归框架的"全部场景串跑"脚本
//
// 跑 scenarios/combat/*.json 里的每一份战斗场景，断言每个 expect 字段。
//
// 与 scripts/playthrough-scenarios.ts 同源套路：
//   - 在末尾打印 "✓ playthrough 完成" 和 "全部场景通过（N/M）"
//   - 任何断言失败用 throw 中断，exit code = 1
//
// 注意（quirk #26）：playthrough-scenarios.ts 只扫 scenarios/*.json 根目录（不递归）；
// 战斗 scenario 在 scenarios/combat/ 下由本脚本扫，互不干扰。
//
// expect 字段支持：
//   - outcome           CombatScenarioOutcome 字面量字符串
//   - turnsElapsed      number（严格相等）
//   - survived          boolean
//   - finalPhase        string
//   - enemiesAlive      number（活敌数量，严格相等）
//   - lootGained        { itemId: qty }（每个 itemId 的 qty 至少要够）
//   - statsDelta        { stat: number }（严格相等）
//   - sanityDeltaAtMost / hpDeltaAtMost / oxygenDeltaAtMost
//                       number（实际 delta ≤ 给定值；用于"至少损失这么多"断言）
//   - injuriesFinal     { defId: tier }（**精确集合匹配**：总数一致且每条档位相等；
//                       {} = 断言全程无伤。负伤 SPEC §10 baseline 用）
//   - logIncludes       string[]（每个子串须出现在战斗全程 log 里·脚本化叙事节拍断言：
//                       boss 阶段过渡 / 链鳗头节 enrage 等。注意：断言的子串=当前文案·改文案需同步更新 baseline）
//
// 详见 docs/STATUS.md "战斗回归框架（Phase 3）" 一节。

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  runCombatScenario,
  type CombatScenarioInput,
  type CombatScenarioResult,
} from '../src/engine/combatScenario';
import { makeLcg } from '../src/engine/rng';

// 焊死 flaky（同 quirk #129/#157·playthrough.ts / playthrough-corpse.ts）：本套件此前从不播种
// 全局 Math.random，战斗里的命中/分裂等 roll 走真随机 → 偶发红（如 fissure_sphere__split_trigger
// 在「分裂」RNG 落到坏路时 noActionProvided）。standalone 多数次命中、并发跑偶失＝典型未播种 flake。
// 在所有 scenario 跑之前把 Math.random 锁成确定性 LCG；SEED 经扫描选中＝复现既有 baseline 全过的那条流
// （不改任何 scenario 的 expect 数值）。新增/重排 scenario 后若 baseline 变红＝确定性（非 flaky）→
// 重扫 SEED 即可。调试：PT_SEED=<n> npx tsx scripts/playthrough-combat-scenarios.ts
const COMBAT_SCN_SEED = Number(process.env.PT_SEED) || 1;
Math.random = makeLcg(COMBAT_SCN_SEED);

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCENARIO_DIR = resolve(__dirname, '..', 'scenarios', 'combat');

interface ScenarioFile extends CombatScenarioInput {
  _comment?: string;
  expect?: {
    outcome?: string;
    turnsElapsed?: number;
    survived?: boolean;
    finalPhase?: string;
    enemiesAlive?: number;
    lootGained?: Record<string, number>;
    statsDelta?: Record<string, number>;
    sanityDeltaAtMost?: number;
    hpDeltaAtMost?: number;
    oxygenDeltaAtMost?: number;
    injuriesFinal?: Record<string, number>;
    logIncludes?: string[];
    notes?: string;
  };
}

function fail(name: string, msg: string): never {
  throw new Error(`[${name}] ${msg}`);
}

function runOne(file: string): { name: string; result: CombatScenarioResult; scenario: ScenarioFile } {
  const name = file;
  const raw = readFileSync(resolve(SCENARIO_DIR, file), 'utf8');
  const scenario = JSON.parse(raw) as ScenarioFile;
  const { _comment, expect, ...input } = scenario;
  void _comment;
  void expect;
  const result = runCombatScenario(input as CombatScenarioInput);
  return { name, result, scenario };
}

function assertScenario(name: string, result: CombatScenarioResult, expect: ScenarioFile['expect']) {
  if (result.errors.length > 0) {
    fail(name, `errors 非空: ${result.errors.join(' | ')}`);
  }

  if (!expect) return;
  const s = result.summary;

  if (expect.outcome !== undefined && s.outcome !== expect.outcome) {
    fail(name, `outcome 不符：期望 ${expect.outcome}，实际 ${s.outcome}`);
  }

  if (expect.turnsElapsed !== undefined && s.turnsElapsed !== expect.turnsElapsed) {
    fail(name, `turnsElapsed 不符：期望 ${expect.turnsElapsed}，实际 ${s.turnsElapsed}`);
  }

  if (expect.survived !== undefined && s.survived !== expect.survived) {
    fail(name, `survived 不符：期望 ${expect.survived}，实际 ${s.survived}`);
  }

  if (expect.finalPhase !== undefined && s.finalPhase !== expect.finalPhase) {
    fail(name, `finalPhase 不符：期望 ${expect.finalPhase}，实际 ${s.finalPhase}`);
  }

  if (expect.enemiesAlive !== undefined && s.enemiesAlive.length !== expect.enemiesAlive) {
    fail(
      name,
      `enemiesAlive 数量不符：期望 ${expect.enemiesAlive}，实际 ${s.enemiesAlive.length}`,
    );
  }

  if (expect.lootGained) {
    for (const [itemId, qty] of Object.entries(expect.lootGained)) {
      const got = s.lootGained.find((l) => l.itemId === itemId);
      if (!got || got.qty < qty) {
        fail(
          name,
          `lootGained.${itemId} 不符：期望 ≥ ${qty}，实际 ${got?.qty ?? 0}`,
        );
      }
    }
  }

  if (expect.statsDelta) {
    for (const [k, v] of Object.entries(expect.statsDelta)) {
      const got = (s.statsDelta as Record<string, number | undefined>)[k];
      if (got === undefined || Math.abs(got - v) > 1e-6) {
        fail(name, `statsDelta.${k} 不符：期望 ${v}，实际 ${got ?? '(未变化)'}`);
      }
    }
  }

  function atMost(field: 'sanity' | 'stamina' | 'oxygen', threshold: number, label: string) {
    const got = (s.statsDelta as Record<string, number | undefined>)[field] ?? 0;
    if (got > threshold) {
      fail(name, `${label} 不符：期望 ≤ ${threshold}，实际 ${got}`);
    }
  }

  if (expect.injuriesFinal) {
    const got = new Map(s.injuriesFinal.map((i) => [i.defId, i.tier]));
    const want = Object.entries(expect.injuriesFinal);
    if (got.size !== want.length) {
      fail(
        name,
        `injuriesFinal 数量不符：期望 ${want.length} 处，实际 ${got.size} 处（${[...got.entries()].map(([d, t]) => `${d}@${t}`).join(', ') || '无伤'}）`,
      );
    }
    for (const [defId, tier] of want) {
      if (got.get(defId) !== tier) {
        fail(name, `injuriesFinal.${defId} 不符：期望 tier ${tier}，实际 ${got.get(defId) ?? '(没有这处伤)'}`);
      }
    }
  }

  if (expect.logIncludes) {
    const allText = result.turns
      .flatMap((t) => t.log)
      .map((l) => l.text)
      .join('\n');
    for (const frag of expect.logIncludes) {
      if (!allText.includes(frag)) {
        fail(name, `logIncludes 未命中：战斗 log 里找不到子串 "${frag}"`);
      }
    }
  }

  if (expect.sanityDeltaAtMost !== undefined) {
    atMost('sanity', expect.sanityDeltaAtMost, 'sanityDeltaAtMost');
  }
  if (expect.hpDeltaAtMost !== undefined) {
    atMost('stamina', expect.hpDeltaAtMost, 'hpDeltaAtMost');
  }
  if (expect.oxygenDeltaAtMost !== undefined) {
    atMost('oxygen', expect.oxygenDeltaAtMost, 'oxygenDeltaAtMost');
  }
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

function main() {
  if (!existsSync(SCENARIO_DIR)) {
    console.error(`scenarios/combat/ 目录不存在`);
    process.exitCode = 1;
    return;
  }
  let files: string[] = [];
  try {
    files = readdirSync(SCENARIO_DIR).filter((f) => f.endsWith('.json'));
  } catch (err) {
    console.error(`无法读取 scenarios/combat/ 目录：${err}`);
    process.exitCode = 1;
    return;
  }
  files.sort();
  if (files.length === 0) {
    console.error(`scenarios/combat/ 目录里没有 .json 文件`);
    process.exitCode = 1;
    return;
  }

  console.log(`========== 战斗回归 (${files.length} scenarios) ==========`);
  let okCount = 0;
  const fails: string[] = [];
  for (const f of files) {
    let res: { name: string; result: CombatScenarioResult; scenario: ScenarioFile };
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
      const s = res.result.summary;
      console.log(
        `  ✓ ${f}  outcome=${s.outcome} turns=${s.turnsElapsed} loot=${s.lootGained.length} HP=${s.finalHp.toFixed(0)}`,
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
