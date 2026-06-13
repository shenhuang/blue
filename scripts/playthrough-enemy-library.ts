// 敌人库回归（敌人库 SPEC §4）：pickEnemy / matchEnemies / enemyThreatTier。
// 验证三轴过滤（深度 ∩ 环境 ∩ 生态位）、环境隔离（"热带鱼不进极地"）、threatTier 派生、
// pickEnemy 确定性（rng 注入）与 excludeIds。纯引擎层·无 UI。

import { pickEnemy, matchEnemies, enemyThreatTier } from '../src/engine/enemyLibrary';
import { getEnemyDef } from '../src/engine/combat';

let failures = 0;
function check(label: string, cond: boolean) {
  console.log(`  ${cond ? '✓' : '✗'} ${label}`);
  if (!cond) failures++;
}

console.log('敌人库回归：');

// 1. 深度轴
const reef = matchEnemies({ band: 'zone.old_lighthouse_reef' });
check(`reef 池 ≥3（实得 ${reef.length}）`, reef.length >= 3);
check(
  'reef 池每只都标了该 zone',
  reef.every((d) => (d.bands ?? []).includes('zone.old_lighthouse_reef')),
);

// 2. 深度 ∩ 环境
const caves = matchEnemies({ band: 'zone.blue_caves', biome: 'cave_anchialine' });
check(`蓝洞 anchialine 池 ≥2（实得 ${caves.length}）`, caves.length >= 2);

// 3. 环境隔离："红树林热带鱼不进极地"
const polarReef = matchEnemies({ band: 'zone.old_lighthouse_reef', biome: 'polar_under_ice' });
check('reef 敌人不会被极地环境选中（空池）', polarReef.length === 0);

// 4. role 收窄
const reefGate = matchEnemies({ band: 'zone.old_lighthouse_reef' }, { role: 'gatekeeper' });
check(
  'reef gatekeeper 唯一＝石斑鱼',
  reefGate.length === 1 && reefGate[0].id === 'enemy.reef_grouper',
);

// 5. threatTier 派生（≤3 low / 4–6 mid / ≥7 high）
const grouper = getEnemyDef('enemy.reef_grouper'); // threat 4
const barracuda = getEnemyDef('enemy.reef_barracuda'); // threat 7
const barracudaJuv = getEnemyDef('enemy.reef_barracuda_juv'); // threat 2
check('threat 4 → mid', !!grouper && enemyThreatTier(grouper) === 'mid');
check('threat 7 → high', !!barracuda && enemyThreatTier(barracuda) === 'high');
check('threat 2 → low', !!barracudaJuv && enemyThreatTier(barracudaJuv) === 'low');

// 6. pickEnemy 确定性（rng 注入）
const firstCave = matchEnemies({ band: 'zone.blue_caves' })[0];
const picked0 = pickEnemy({ band: 'zone.blue_caves' }, { rng: () => 0 });
check('rng=0 取到匹配集第一只', !!firstCave && !!picked0 && picked0.id === firstCave.id);

// 7. excludeIds
const pickedExcl = pickEnemy({ band: 'zone.blue_caves' }, { rng: () => 0, excludeIds: [firstCave?.id ?? ''] });
check('excludeIds 生效（不取被排除的）', !!pickedExcl && pickedExcl.id !== firstCave?.id);

// 8. 无匹配 → undefined
check('无匹配返回 undefined', pickEnemy({ band: 'zone.__nonexistent__' }) === undefined);

if (failures > 0) {
  console.log(`\n✗ 敌人库回归失败：${failures} 处`);
  process.exit(1);
}
console.log('\n✓ playthrough 完成');
console.log('全部场景通过');
