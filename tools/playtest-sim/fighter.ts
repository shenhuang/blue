import { runCell } from './player';

const N = 30, SEED = 70000;
// the 3 farm zones, fighter style, stage-appropriate O2
const CELLS: [string, string, [number, number] | null, number][] = [
  ['zone.old_lighthouse_reef', 'reef farm', null, 70],
  ['zone.wreck_graveyard', 'wreck farm', null, 70],
  ['zone.blue_caves', 'bluecaves farm', null, 80],
  ['zone.blue_caves', 'bluecaves farm', null, 100],
];

console.log('=== FIGHTER (engages combat for materials) vs AVOIDER, same cells ===\n');
for (const [zone, band, dr, o2] of CELLS) {
  for (const fight of [false, true]) {
    const a = runCell(zone, band, dr, o2, 4, N, SEED, fight);
    const drops = Object.entries(a.drops).sort((x, y) => y[1] - x[1])
      .map(([k, v]) => k.replace('item.', '') + '×' + v).join(' ') || '(none)';
    console.log(
      (band + ' o2' + o2).padEnd(22),
      (fight ? 'FIGHT' : 'avoid').padEnd(6),
      ('surv ' + (a.survival * 100).toFixed(0) + '%').padEnd(10),
      ('combat/run ' + (a.combats / N).toFixed(1)).padEnd(15),
      ('loot ' + a.avgLootGold.toFixed(0) + 'g').padEnd(11),
      'deaths=' + JSON.stringify(a.deaths),
    );
    console.log('   drops:', drops);
  }
  console.log('');
}
