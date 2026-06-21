import { runCell, COMBAT_LOG } from './player';

const N = 30, SEED = 60123;
// [zoneId, label, depthRange|null, O2 (stage-appropriate)]
const ZONES: [string, string, [number, number] | null, number][] = [
  ['zone.old_lighthouse_reef', 'reef (10-60·礁→残骸→洞)', null, 70],
  ['zone.wreck_graveyard', 'wreck (18-50)', null, 70],
  ['zone.blue_caves', 'bluecaves (12-55·封闭)', null, 90],
  ['zone.open_midwater', 'midwater (55-85)', null, 90],
  ['zone.vent_trench', 'vent (85-118·封闭)', null, 100],
  ['zone.whalefall', 'whalefall (80-110)', null, 90],
];

function enemyDist() {
  const by: Record<string, { n: number; dmin: number; dmax: number }> = {};
  for (const c of COMBAT_LOG) for (const e of c.enemies) {
    by[e] ??= { n: 0, dmin: 999, dmax: -1 };
    by[e].n++; by[e].dmin = Math.min(by[e].dmin, c.depth); by[e].dmax = Math.max(by[e].dmax, c.depth);
  }
  return Object.entries(by).sort((a, b) => b[1].n - a[1].n);
}

console.log('================ 每区试玩图谱（avoider vs fighter, n=' + N + '/style） ================\n');
for (const [zone, label, dr, o2] of ZONES) {
  const av = runCell(zone, label, dr, o2, 4, N, SEED, false);
  COMBAT_LOG.length = 0;
  const ft = runCell(zone, label, dr, o2, 4, N, SEED, true);
  const dist = enemyDist();

  console.log(`【${label}】 O2=${o2}`);
  console.log(`  存活    avoid ${(av.survival*100).toFixed(0)}%   fight ${(ft.survival*100).toFixed(0)}%`);
  console.log(`  收益    avoid 卖料 ${av.avgLootGold.toFixed(0)}g/潜   fight 卖料 ${ft.avgLootGold.toFixed(0)}g/潜`);
  console.log(`  战斗    fight ${(ft.combats/N).toFixed(2)} 次/潜   存活转身氧余 ~${ft.avgO2Turnaround.toFixed(0)}@${ft.avgDepthTurnaround.toFixed(0)}m   最低理智 ~${ft.avgMinSanity.toFixed(0)}`);
  const fmats = Object.entries(ft.drops).filter(([k]) => /chitin|eel_skin|beak|lantern_gland|shark_tooth|barracuda_jaw|grouper_maw|sulfide|nodule|concretion|crust/.test(k))
    .sort((a,b)=>b[1]-a[1]).map(([k,v]) => k.replace('item.','')+' '+(v/N).toFixed(2)+'/潜').join('  ') || '(无材料)';
  console.log(`  关键素材掉率(fight): ${fmats}`);
  console.log(`  敌人分布(fight): ${dist.map(([e,d]) => e.replace('enemy.','')+'×'+d.n+`(${d.dmin}-${d.dmax}m)`).join('  ') || '(无)'}`);
  if (Object.keys(av.deaths).length || Object.keys(ft.deaths).length)
    console.log(`  死因    avoid ${JSON.stringify(av.deaths)}  fight ${JSON.stringify(ft.deaths)}`);
  console.log('');
}
