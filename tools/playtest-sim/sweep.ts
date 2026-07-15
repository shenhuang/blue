import { runCell, Agg } from './player';

const N = 24;          // runs per cell
const SEED = 40000;
const O2S = [60, 80, 100, 120];

// [zoneId, bandLabel, depthRange|null, hunts]
const TIERS: [string, string, [number, number] | null, boolean][] = [
  // base zones (new-player default dive, no band override)
  ['zone.old_lighthouse_reef', 'reef BASE', null, false],
  ['zone.rocky_slope', 'slope BASE', null, false],
  ['zone.open_midwater', 'midwater BASE', null, false],
  ['zone.vent_trench', 'vent BASE', null, false],
  ['zone.blue_caves', 'bluecaves BASE', null, false],
  ['zone.whalefall', 'whalefall BASE', null, false],
  // col.home (reef)
  ['zone.old_lighthouse_reef', 'home T1 30-40', [30, 40], false],
  ['zone.old_lighthouse_reef', 'home T2 40-60', [40, 60], false],
  // col.slope
  ['zone.rocky_slope', 'slope T1 18-50', [18, 50], false],
  ['zone.rocky_slope', 'slope T2 50-75', [50, 75], false],
  ['zone.rocky_slope', 'slope T3 75-100', [75, 100], false],
  // col.midwater
  ['zone.open_midwater', 'mid T1 30-60', [30, 60], false],
  ['zone.open_midwater', 'mid T2 60-90', [60, 90], false],
  ['zone.open_midwater', 'mid T3 90-120', [90, 120], false],
  ['zone.open_midwater', 'mid T4 120-150', [120, 150], false],
  ['zone.open_midwater', 'mid T5 150-180', [150, 180], false],
  ['zone.open_midwater', 'mid T6 180-210*', [180, 210], true],
  // col.vent
  ['zone.vent_trench', 'vent T1 25-75', [25, 75], false],
  ['zone.vent_trench', 'vent T2 75-125', [75, 125], false],
  ['zone.vent_trench', 'vent T3 125-175', [125, 175], false],
  ['zone.vent_trench', 'vent T4 175-225*', [175, 225], true],
  // col.trench (blue_caves)
  ['zone.blue_caves', 'trench T3 180-270*', [180, 270], true],
  ['zone.blue_caves', 'trench T4 270-310', [270, 310], false],
];

console.log('band'.padEnd(20), 'O2'.padEnd(4), 'surv'.padEnd(6), 'maxD'.padEnd(6), 'o2turn@d'.padEnd(11), 'loot'.padEnd(7), 'ends/deaths');
for (const [zone, band, dr, hunts] of TIERS) {
  for (const o2 of O2S) {
    const a: Agg = runCell(zone, band, dr, o2, 5, N, SEED);
    const deathsStr = Object.keys(a.deaths).length ? ' D:' + JSON.stringify(a.deaths) : '';
    const o2t = a.avgO2Turnaround.toFixed(0) + '@' + a.avgDepthTurnaround.toFixed(0) + 'm';
    console.log(
      band.padEnd(20),
      String(o2).padEnd(4),
      ((a.survival * 100).toFixed(0) + '%').padEnd(6),
      a.avgMaxDepth.toFixed(0).padEnd(6),
      o2t.padEnd(11),
      (a.avgLootGold.toFixed(0) + 'g').padEnd(7),
      JSON.stringify(a.ends) + deathsStr + (a.combats ? ' combats=' + a.combats : ''),
    );
  }
  console.log('');
}
