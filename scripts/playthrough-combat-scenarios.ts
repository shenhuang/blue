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

import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
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
// 重扫 SEED 即可（或见下 per-scenario seed）。调试：PT_SEED=<n> npx tsx scripts/playthrough-combat-scenarios.ts
const COMBAT_SCN_SEED = Number(process.env.PT_SEED) || 1;

// per-scenario seed（默认关·Agent 审计 #3）：单一全局 seed 的脆点＝新增/重排 scenario 会移动**别人**脚下的
// 全局 Math.random 连续流 → 无关 scenario 莫名变红、逼人重扫 SEED（甚至诱导把 expect 改成"现状"＝静默祝福回归）。
// 置 PT_PER_SCENARIO_SEED=1：每个 scenario 的全局 Math.random 流由**文件名**派生·彼此独立·新增/重排互不影响。
// 代价：启用后所有 baseline 的 RNG 流改变 → 必须在 **Mac** 跑一遍 `--bless` 重生机械 expect 并复核 diff 再提交
// （沙箱无 esbuild·跑不了 tsx 战斗）。默认关＝现有 baseline 与连续流逐字节不变·gate 绿。
const PER_SCENARIO_SEED = process.env.PT_PER_SCENARIO_SEED === '1';
function hashStr(s: string): number {
  let h = 2166136261 >>> 0; // FNV-1a
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function seedFor(file: string): number {
  return PER_SCENARIO_SEED ? hashStr(file) || 1 : COMBAT_SCN_SEED;
}
// 默认（per-scenario 关）：单一全局 seed·连续流（现有 baseline 即此流·逐字节不变）。
Math.random = makeLcg(COMBAT_SCN_SEED);

// CLI：--bless 重生「机械派生」expect（保留人写意图字段·见 blessOne）；位置参数 = 只跑/只 bless 名字含该子串的 scenario。
const _argv = process.argv.slice(2);
const BLESS = _argv.includes('--bless');
const FILTER_TERMS = _argv.filter((a) => !a.startsWith('--'));

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
  // per-scenario seed 启用时：每个 scenario 跑前把全局 Math.random 重置成由文件名派生的独立流
  // （默认关 → 不重置·沿用模块加载时的单一连续流·现有 baseline 即此流）。
  if (PER_SCENARIO_SEED) Math.random = makeLcg(seedFor(file));
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
// --bless：重生机械派生 expect 字段（保留人写意图字段）
// ---------------------------------------------------------------------------
// 机械字段＝可从一次确定性跑派生。意图字段＝人写的阈值/叙事（*DeltaAtMost / logIncludes / notes / _comment）·bless 绝不动。
// 只刷新 expect 里**已存在**的机械字段（不新增·不改断言粒度），取代「手抄 --out json」的易错（Agent 审计 #3）。
const MECHANICAL_FIELDS = [
  'outcome', 'turnsElapsed', 'survived', 'finalPhase', 'enemiesAlive', 'lootGained', 'statsDelta', 'injuriesFinal',
] as const;

function mechanicalValue(field: (typeof MECHANICAL_FIELDS)[number], s: CombatScenarioResult['summary']): unknown {
  switch (field) {
    case 'outcome': return s.outcome;
    case 'turnsElapsed': return s.turnsElapsed;
    case 'survived': return s.survived;
    case 'finalPhase': return s.finalPhase;
    case 'enemiesAlive': return s.enemiesAlive.length;
    case 'lootGained': return Object.fromEntries(s.lootGained.map((l) => [l.itemId, l.qty]));
    case 'statsDelta': return s.statsDelta;
    case 'injuriesFinal': return Object.fromEntries(s.injuriesFinal.map((i) => [i.defId, i.tier]));
  }
}

// 风格化序列化：叶子集合（值全为基元的对象/数组）压单行·否则 2 空格展开——复刻既有 baseline 手写风格
// （statsDelta/lootGained 单行·actions 数组多行而元素单行）→ 无值变更的 bless = 逐字节不变·零格式 churn。
function stringifyStyled(value: unknown, indent = 0): string {
  const pad = '  '.repeat(indent);
  const padIn = '  '.repeat(indent + 1);
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    if (value.every((v) => v === null || typeof v !== 'object')) return '[' + value.map((v) => JSON.stringify(v)).join(', ') + ']';
    return '[\n' + value.map((v) => padIn + stringifyStyled(v, indent + 1)).join(',\n') + '\n' + pad + ']';
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return '{}';
    if (entries.every(([, v]) => v === null || typeof v !== 'object')) {
      return '{ ' + entries.map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(', ') + ' }';
    }
    return '{\n' + entries.map(([k, v]) => padIn + JSON.stringify(k) + ': ' + stringifyStyled(v, indent + 1)).join(',\n') + '\n' + pad + '}';
  }
  return JSON.stringify(value);
}

function blessOne(file: string): string[] {
  const path = resolve(SCENARIO_DIR, file);
  const scenario = JSON.parse(readFileSync(path, 'utf8')) as ScenarioFile;
  const { _comment, expect, ...input } = scenario;
  if (PER_SCENARIO_SEED) Math.random = makeLcg(seedFor(file));
  const result = runCombatScenario(input as CombatScenarioInput);
  if (result.errors.length > 0) throw new Error(`errors 非空·拒绝 bless：${result.errors.join(' | ')}`);
  if (!expect) return []; // 无 expect → 不主动加断言
  const s = result.summary;
  const changed: string[] = [];
  for (const field of MECHANICAL_FIELDS) {
    if (!(field in expect)) continue; // 只刷新已有机械断言·不新增
    const fresh = mechanicalValue(field, s);
    if (JSON.stringify((expect as Record<string, unknown>)[field]) !== JSON.stringify(fresh)) {
      (expect as Record<string, unknown>)[field] = fresh;
      changed.push(field);
    }
  }
  if (changed.length > 0) {
    const out: Record<string, unknown> = {};
    if (_comment !== undefined) out._comment = _comment;
    Object.assign(out, input);
    out.expect = expect;
    writeFileSync(path, stringifyStyled(out) + '\n');
  }
  return changed;
}

function runBless(files: string[]) {
  console.log(`========== --bless 重生机械 expect (${files.length} scenarios${PER_SCENARIO_SEED ? '·per-scenario seed' : ''}) ==========`);
  let blessed = 0;
  const errs: string[] = [];
  for (const f of files) {
    try {
      const changed = blessOne(f);
      if (changed.length) { blessed++; console.log(`  ~ ${f}  重写：${changed.join(', ')}`); }
      else console.log(`  · ${f}  无变化`);
    } catch (err) {
      errs.push(`[${f}] ${err instanceof Error ? err.message : String(err)}`);
      console.log(`  ✗ ${f}  ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  console.log('');
  if (errs.length) { console.log(`✗ bless 中 ${errs.length} 个 scenario 报错（未写）`); process.exitCode = 1; return; }
  console.log(`✓ bless 完成：${blessed} 个文件更新机械 expect（意图字段 *AtMost/logIncludes 未动）·复核 git diff 再提交。`);
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
  if (FILTER_TERMS.length) files = files.filter((f) => FILTER_TERMS.some((t) => f.includes(t)));
  if (files.length === 0) {
    console.error(`scenarios/combat/ 没有匹配的 .json${FILTER_TERMS.length ? `（过滤：${FILTER_TERMS.join(',')}）` : ''}`);
    process.exitCode = 1;
    return;
  }

  if (BLESS) { runBless(files); return; }

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
