// 感知门·无空白懵屏/死锁 门（感知门 SPEC §7·check-gate-legibility）。
//
// 不变量（把「永不空白懵屏、永不卡死、永远有出路」焊成会红的检查·感知门 SPEC §5.1）：
//   任何生成图的任一节点，在任意传感器态下驱动 enterNodeSelection，结果不得是
//   「过滤后 visible 空 + 无 feature + !canReveal + 且没进上浮」的死态。
//   即：若落 nodeSelect 且 choices 空且无 features → 必然 canReveal（有 hidden 子 + 对应 sense 现在可操作·
//   玩家能开灯/扫声呐先动一下）；否则必须落 ascent（走已有死路自动上浮）。二者必居其一。
//
// 覆盖：几个代表 zone × 多 seed × 多传感器态（灯开/关、声呐解锁/未解锁、电量满/空）——
//   现状 zone.gates 全 dormant（无门）⇒ 每父都有非门出口，天然不死锁；但**再叠一个合成高密度 gates**
//   把「若过滤/canReveal 逻辑写错就会造出死态」逼出来（守未来内容激活 zone.gates 时不引死锁）。
//
// 跑法：npx tsx scripts/check-gate-legibility.mjs（沙箱需 ESBUILD_BINARY_PATH·见 blue_regress_sandbox）。
// 退出码：全过=0，任一死态=1。

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { generateDiveMap } from '../src/engine/mapgen.ts';
import { createInitialGameState, createNewRun } from '../src/engine/state.ts';
import { enterNodeSelection } from '../src/engine/dive-select.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const errors = [];
const zonesFile = JSON.parse(readFileSync(resolve(ROOT, 'src/data/zones.json'), 'utf-8'));
const zoneDefs = new Map(zonesFile.zones.map((z) => [z.id, z]));

// 传感器态矩阵：灯开/关 × 声呐解锁/未解锁 × 电量满/空（覆盖 lamp/sonar 门的锁/解锁 + canReveal 分支）。
const SENSOR_STATES = [
  { light: true, sonarUnlocked: false, power: 40, label: '灯开·无声呐·满电' },
  { light: false, sonarUnlocked: false, power: 40, label: '灯关·无声呐·满电' },
  { light: false, sonarUnlocked: true, power: 40, label: '灯关·声呐已解锁·满电' },
  { light: false, sonarUnlocked: false, power: 0, label: '灯关·无声呐·空电' },
  { light: true, sonarUnlocked: true, power: 0, label: '灯开·声呐已解锁·空电' },
];

// 合成高密度 gates（lamp/sonar 各 1.0·hiddenRatio 0.5）——逼出「若过滤/canReveal 写错就造死态」。
const HIGH_GATES = {
  lamp: { deep: 1, mid: 1, shallow: 1, hiddenRatio: 0.5 },
  sonar: { deep: 1, mid: 1, shallow: 1, hiddenRatio: 0.5 },
};

const SAMPLE_ZONES = ['zone.old_lighthouse_reef', 'zone.blue_caves', 'zone.wreck_graveyard', 'zone.vent_trench', 'zone.open_midwater'];
// 每 zone 两组：dormant（无门·现状）+ 合成高密度门（未来激活的压力测试）。
const GATE_VARIANTS = [
  { gates: undefined, tag: 'dormant' },
  { gates: HIGH_GATES, tag: 'high-gates' },
];

const base = createInitialGameState();
let nodesChecked = 0;

/** 一个节点是否被 hidden 门挡且对应 sense「现在可操作」（镜像 dive-select senseCanReveal）。 */
function canRevealHere(map, node, run) {
  // 只看当前节点的直接子；enterNodeSelection 判定同款（effectiveGate 归一：node.gate 优先·缺省落整潜门·地标豁免）。
  // 这里用简化判据（现状测里 run.diveModifier 恒空 ⇒ 只 per-node gate 起作用），够覆盖死态判定。
  for (const id of node.connectsTo ?? []) {
    const child = map.nodes[id];
    if (!child) continue;
    const g = child.gate;
    if (!g || g.mode !== 'hidden') continue;
    if (run.visitedNodeIds.includes(id)) continue;
    if (g.sense === 'lamp' && run.equipment.light !== null) return true;
    if (g.sense === 'sonar' && run.sensors.sonarUnlocked && run.sensors.sonar !== 'ping') return true;
  }
  return false;
}

for (const zoneId of SAMPLE_ZONES) {
  const zbase = zoneDefs.get(zoneId);
  if (!zbase) {
    errors.push(`样本 zone ${zoneId} 不在 zones.json（脚本样本过期）`);
    continue;
  }
  for (const variant of GATE_VARIANTS) {
    const zone = variant.gates ? { ...zbase, gates: variant.gates } : zbase;
    for (const seedKey of ['gate-leg-1', 'gate-leg-2', 'gate-leg-3']) {
      const map = generateDiveMap({ zone, profileFlags: new Set(), seedKey });
      for (const node of Object.values(map.nodes)) {
        for (const ss of SENSOR_STATES) {
          const r0 = createNewRun({ zoneId, bonuses: { sonarUnlocked: ss.sonarUnlocked } });
          const run = {
            ...r0,
            map,
            currentNodeId: node.id,
            currentDepth: node.depth,
            visitedNodeIds: [map.startNodeId, node.id],
            sensors: { ...r0.sensors, light: ss.light },
            power: ss.power,
          };
          const s = { ...base, run, phase: { kind: 'dive', subPhase: { kind: 'nodeSelect', choices: [] } } };
          const out = enterNodeSelection(s);
          nodesChecked++;
          // 落 ascent＝走已有死路上浮（合法出路·§5.1）。
          if (out.phase.kind === 'ascent') continue;
          if (out.phase.kind !== 'dive' || out.phase.subPhase.kind !== 'nodeSelect') {
            errors.push(`${zoneId}/${variant.tag}/${seedKey}·node ${node.id}·${ss.label}：意外 phase ${out.phase.kind}/${out.phase.subPhase?.kind}`);
            continue;
          }
          const sub = out.phase.subPhase;
          const visibleEmpty = sub.choices.length === 0;
          const noFeature = !sub.features || sub.features.length === 0;
          if (visibleEmpty && noFeature) {
            // 死态判定：visible 空 + 无 feature → 必须 canReveal（否则该走 ascent 却没走＝空白懵屏死锁）。
            if (!canRevealHere(map, node, run)) {
              errors.push(
                `${zoneId}/${variant.tag}/${seedKey}·node ${node.id}(${node.kind})·${ss.label}：` +
                  `visible 空 + 无 feature + !canReveal 却落 nodeSelect（未进上浮）＝空白懵屏死锁（SPEC §5.1）`,
              );
            }
          }
        }
      }
    }
  }
}

if (nodesChecked === 0) errors.push('未检查任何节点（样本全失配·脚本失效）');

if (errors.length) {
  console.error('✘ 感知门·无空白懵屏/死锁 门（check-gate-legibility）：\n');
  for (const e of errors.slice(0, 40)) console.error(`  · ${e}`);
  if (errors.length > 40) console.error(`  …（另 ${errors.length - 40} 处）`);
  console.error(`\n共 ${errors.length} 处死态。任一生成图不得存在「visible 空 + 无 feature + !canReveal + 没进上浮」（SPEC §5.1）。`);
  process.exit(1);
}
console.log(`✓ 感知门·无空白懵屏/死锁：${nodesChecked} 个（节点×传感器态×门配比）无死态（visible 空必 canReveal 或落上浮）。`);
process.exit(0);
