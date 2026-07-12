// 感知门·地标永不带门 门（感知门 SPEC §7·check-gate-skeleton）。
//
// 不变量（把「骨架永远通」焊成会红的检查·CLAUDE.md「约定落成机制」）：
//   地标 kind（ascent_point / air_pocket / camp / corpse / shop / boss）**永不带 gate**——
//   撒点（sprinkleGates 候选只 event/rest）+ 整潜门 seed（effectiveGate 豁免地标/Lv.1 尸体）两条路都豁免。
//   若地标挂了门 → 无灯/无声呐玩家可能在骨架节点前无路（违反「永不锁死出口」·SPEC §5/§5.1）。
//
// 两段验证：
//   ① 静态：扫 zone.gates 规格合法（只 lamp/sonar·密度 0..1·hiddenRatio 0..1）——错配置＝撒点行为不可预期。
//   ② 撒点 post 断言：给一个**合成高密度 zone.gates**（lamp/sonar 各 1.0）跑 sprinkleGates·断言生成图里
//      任何地标 kind 的节点都 node.gate===undefined（撒点只落 event/rest）。用高密度逼出「若候选筛选写错就会中招」。
//
// 跑法：npx tsx scripts/check-gate-skeleton.mjs（沙箱需 ESBUILD_BINARY_PATH·见 blue_regress_sandbox）。
// 退出码：全过=0，任一违规=1。

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { generateDiveMap } from '../src/engine/mapgen.ts';
import { sprinkleGates } from '../src/engine/mapgen-shared.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const errors = [];
function bad(msg) {
  errors.push(msg);
}

/** 地标 kind（永不带门·感知门 SPEC §7）。 */
const LANDMARK_KINDS = new Set(['ascent_point', 'air_pocket', 'camp', 'corpse', 'shop', 'boss']);

// ── ① 静态：zone.gates 规格合法 ──────────────────────────────────────────────
const zonesFile = JSON.parse(readFileSync(resolve(ROOT, 'src/data/zones.json'), 'utf-8'));
const VALID_SENSES = ['lamp', 'sonar'];
for (const zone of zonesFile.zones) {
  const gates = zone.gates;
  if (!gates) continue; // dormant（缺省·byte-identical）
  for (const sense of Object.keys(gates)) {
    if (!VALID_SENSES.includes(sense)) {
      bad(`zone ${zone.id}·gates 含非法 sense「${sense}」（合法：${VALID_SENSES.join('/')}）`);
      continue;
    }
    const d = gates[sense];
    for (const k of ['deep', 'mid', 'shallow', 'hiddenRatio']) {
      if (d[k] === undefined) continue;
      if (typeof d[k] !== 'number' || d[k] < 0 || d[k] > 1) {
        bad(`zone ${zone.id}·gates.${sense}.${k}=${d[k]} 越界（须 0..1）`);
      }
    }
  }
}

// ── ② 撒点 post 断言：合成高密度 gates → 地标节点永不带门 ────────────────────────
// 用一个真实 maze zone（含地标：入口/出口 ascent_point）跑生成 + 高密度撒门，断言地标零门。
// 高密度（deep/mid/shallow 全 1.0）＝逼出「撒点候选筛选若写错就中招」；确定性（零 rng·seedKey 固定）。
const zoneDefs = new Map(zonesFile.zones.map((z) => [z.id, z]));
const HIGH_GATES = {
  lamp: { deep: 1, mid: 1, shallow: 1, hiddenRatio: 0.5 },
  sonar: { deep: 1, mid: 1, shallow: 1, hiddenRatio: 0.5 },
};
// 取几个代表性 zone（层状开阔 + 迷路洞·各含 ascent_point 地标）。
// 白板收口（2026-07-12）：开放水域 zone〔old_lighthouse_reef/wreck_graveyard〕已删——样本 repoint 到存活 zone。
// 洞穴内容整删（2026-07-12 续）：27 条真实洞穴 zone + zone.the_deep_gate 已删——样本再 repoint 到仅存的
// zone.warren + 3 条 maze 朝向 QA 夹具（horizontal_test/vertical_test/serpentine_test）。
const SAMPLE_ZONES = ['zone.warren', 'zone.horizontal_test', 'zone.vertical_test', 'zone.serpentine_test'];
let mapsChecked = 0;
let landmarksSeen = 0;
for (const zoneId of SAMPLE_ZONES) {
  const base = zoneDefs.get(zoneId);
  if (!base) {
    bad(`样本 zone ${zoneId} 不在 zones.json（脚本样本过期）`);
    continue;
  }
  // 合成一个「配了高密度 gates」的 zone 副本（不改真实数据·只本地测撒点行为）。
  const zone = { ...base, gates: HIGH_GATES };
  for (const seedKey of ['gate-skel-a', 'gate-skel-b', 'gate-skel-c']) {
    const map = generateDiveMap({ zone, profileFlags: new Set(), seedKey });
    // generateDiveMap 已跑一遍 sprinkleGates；再显式跑一次（幂等·同 seed 同门）＝确保直接测到 sprinkleGates 逻辑。
    sprinkleGates(map, zone, seedKey);
    mapsChecked++;
    for (const node of Object.values(map.nodes)) {
      if (LANDMARK_KINDS.has(node.kind)) {
        landmarksSeen++;
        if (node.gate !== undefined) {
          bad(`zone ${zoneId}·seed ${seedKey}·地标节点 ${node.id}(${node.kind}) 竟带门 ${JSON.stringify(node.gate)}——地标永不带门（SPEC §7）`);
        }
      }
    }
  }
}

if (mapsChecked === 0) bad('未检查任何生成图（样本全失配·脚本失效）');
if (landmarksSeen === 0) bad('生成图里一个地标都没有（样本 zone 无 ascent_point？撒点 post 断言形同虚设）');

if (errors.length) {
  console.error('✘ 感知门·地标永不带门 门（check-gate-skeleton）：\n');
  for (const e of errors) console.error(`  · ${e}`);
  console.error(`\n共 ${errors.length} 处。地标 kind（${[...LANDMARK_KINDS].join('/')}）永不带 gate（撒点候选只 event/rest·整潜门豁免地标·SPEC §5/§7）。`);
  process.exit(1);
}
console.log(`✓ 感知门·地标永不带门：静态 zone.gates 合法 + ${mapsChecked} 张高密度撒门图 ${landmarksSeen} 个地标零门。`);
process.exit(0);
