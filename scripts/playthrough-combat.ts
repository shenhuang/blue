// 战斗系统 playthrough（白板收口后）：
//   「flee/scare 不掉料」硬门（#244）——跑黄金套件里两个结局场景，断言 lootGained 为空。
//   （scenario 套件的 expect.lootGained 只能断「至少有」·断「没有」收口在这里·单一场景来源。）
//
//   ⚠ 白板收口（2026-07-12）：原教学关鲨鱼战 e2e（走 aldo depart_east → 东礁 → tutorial 事件链 → engage →
//   combat.tutorial_shark → 胜利 → tutorial.deeper）随开放水域/tutorial/ch1 内容删除已移除——那条链的事件/zone 全没了。
//   实况战斗机制（startCombat/applyPlayerAction/victory 路由）由 playthrough-combat-scenarios.ts
//   （跑全部 scenarios/combat/*.json·确定性快照）覆盖；本脚本只留它测不到的「零战利品」断言
//   （flee 从不结算 loot·scare 敌自行离场被 finalizeVictory 跳过）。
//
// 跑法： npx tsx scripts/playthrough-combat.ts

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { runCombatScenario, type CombatScenarioInput } from '../src/engine/combatScenario';

const log: string[] = [];
function fail(msg: string): never {
  console.log(log.join('\n'));
  throw new Error(`[playthrough-combat] ${msg}`);
}

// —— 「flee/scare 不掉料」硬门（#244）——
// 直接跑黄金套件里两个结局场景（同一份 JSON·单一场景来源），断言战利品为空：
//   flee＝finalizeFlee 从不结算 loot；scare＝敌人自行离场（fledInstanceIds）被 finalizeVictory 跳过。
// 两遭遇本体（combat.tutorial_shark / combat.slope_spider_crab_solo）在白板后仍存活（enemies/*.json）。
const scenarioDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'scenarios', 'combat');
for (const [file, wantOutcome] of [
  ['tutorial_shark__flee_no_loot.json', 'flee'],
  ['slope_spider_crab_solo__scare_no_loot.json', 'victory'],
] as const) {
  const raw = JSON.parse(readFileSync(resolve(scenarioDir, file), 'utf8')) as Record<string, unknown>;
  const { _comment, expect, ...input } = raw;
  void _comment;
  void expect;
  const r = runCombatScenario(input as CombatScenarioInput);
  log.push(`${file}: outcome=${r.summary.outcome} · loot=${r.summary.lootGained.length} 件`);
  if (r.summary.outcome !== wantOutcome) fail(`${file}: outcome 应 ${wantOutcome}（实际 ${r.summary.outcome}）`);
  if (r.summary.lootGained.length !== 0) {
    fail(`${file}: flee/scare 结局不该有任何战利品（#244·实际 ${r.summary.lootGained.map((l) => `${l.itemId}×${l.qty}`).join(', ')}）`);
  }
}
log.push('flee/scare 零战利品门 ✓');

console.log(log.join('\n'));
console.log('\n✓ 战斗 playthrough（flee/scare 零战利品门）完成');
