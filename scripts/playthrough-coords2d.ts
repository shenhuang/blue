// scripts/playthrough-coords2d.ts —— 坐标诚实扫描门（地图2D坐标 SPEC §4「新增门」·warren 诚实门的泛化版）
//
// 背景（docs/spec/深海回响_地图2D坐标_SPEC.md §0/§4）：Phase 2 把 mapgen 的因果链倒过来——旧管线先按放置
// 序号窗口连边、渲染层再事后把无坐标的图铺进槽位（「近而无边」「有边画远」两种错位由此而生）；新管线先撒点
// （产真 `DiveNode.x`，y≡depth）、后按邻近图（Gabriel∪MST）连边，让「拓扑」与「坐标」不再脱钩。SPEC §0 定的
// 三条目标不变量：①位置即深度是构造保证，不是渲染层事后赋值 ②近而无边必隔节点或墙（Gabriel 性质：结构修剪
// 掉的近边必须把节点间距同步推开，声呐上有墙才是诚实） ③非相邻不假熔（warren 专属诚实门泛化成所有带坐标图
// 通用的门）。本脚本＝把这三条做成能在 `npm run regress` 里变红的扫描门（`playthrough-*.ts` 命名自动收编·
// 见 scripts/regress.mjs），而不是留成一段以后没人会重读的散文（CLAUDE.md「机制化约定」）。
//
// 常量单源在 `src/engine/mapgen-scatter.ts`（撒点/连边车道的产出，本脚本只按名 import、不摸其内部怎么撒点/
// 连边）：SCATTER_MIN_DX/DY 定义撒点用的最小间距椭圆；`scatterMetric(a,b)` 把任意两点的坐标差按该椭圆归一
// 成一个数（≈1＝正好卡在最小间距上）；NONADJ_MIN_FACTOR/EDGE_MAX_FACTOR 是本门借来判「假熔」/「画远」的
// 两条阈值。**在撒点车道落地前，下面这条 import 会让 typecheck 红——这是预期状态**：写这个文件时
// mapgen-scatter.ts 尚不存在，等契约落地后本门自动转正，不需要再改一行。
//
// 覆盖 zone×seed（SPEC §3④ 拍板「maze+layered 同批」）：
//   maze 组     zone.vertical_test / zone.hunt_test / zone.horizontal_test / zone.serpentine_test，各 seed 1–120
//   layered 组  zone.scarlet_tyrant_grounds / zone.openwater_sand_test / zone.openwater_rock_test，各 seed 1–60
// （SPEC §2④：layered 撒点域换成宽条带，连边与 maze 走同一套 Gabriel∪MST——两组共享同一批断言不是巧合。）
//
// 每图断言：
//   1. 全节点带有限 x；
//   2. 起点＝全局唯一最浅（depth 严格 < 其它所有节点——比既有「起点=图顶」的 ≤ 更强：入口钉域顶是构造
//      保证，不接受并列）；
//   3. 非相邻不假熔：任意无边对 scatterMetric ≥ NONADJ_MIN_FACTOR（点取 {x, y:depth}）；
//   4. 有边不画远：任意边 scatterMetric ≤ EDGE_MAX_FACTOR；
//   5. 结构不变量（analyzeMap·字段名照抄 src/engine/mapgen-analyze.ts，不猜）：allReachable && isUndirected
//      && hasCycle && hasDeadEnd && localMaximaIds.length ≥ 2（"局部极大"取 localMaximaIds——mapgen-maze.ts
//      的"最深点"注释本就把两者当同义词，但 analyzeMap 里它们是两个不同字段；SPEC §4 原文写的是「局部极大」，
//      按字面选 localMaximaIds，不选 deepestNodeIds）；
//   6. 确定性：每 zone 用 seed=7 生成两次，节点 (id, x, depth, 排序后 connectsTo) 逐字节相同。
//
// 断言只摸 DiveMap/analyzeMap 的公有形状 + mapgen-scatter 的五个具名导出，不碰撒点/连边车道的内部实现细节。
// fail 全部收集进列表、结尾统一报（不像 scripts/lib/pt.ts 的 assert 那样遇错即抛）——跑法仿
// scripts/playthrough-mapgen-scenarios.ts；分节 + ✓/✗ 计数的输出排版仿 scripts/playthrough-warren-mapgen.ts。
//
// 跑法： npx tsx scripts/playthrough-coords2d.ts

import { generateDiveMap, analyzeMap } from '../src/engine/mapgen';
import { getZone } from '../src/engine/zones';
import {
  SCATTER_MIN_DX,
  SCATTER_MIN_DY,
  NONADJ_MIN_FACTOR,
  EDGE_MAX_FACTOR,
  scatterMetric,
} from '../src/engine/mapgen-scatter';
import type { DiveMap, DiveNode } from '../src/types';

const FLAGS = new Set(['flag.tutorial_complete']);

const MAZE_ZONES = ['zone.vertical_test', 'zone.hunt_test', 'zone.horizontal_test', 'zone.serpentine_test'];
const LAYERED_ZONES = ['zone.scarlet_tyrant_grounds', 'zone.openwater_sand_test', 'zone.openwater_rock_test'];
const MAZE_SEEDS = 120;
const LAYERED_SEEDS = 60;
const DETERMINISM_SEED = 7;
const MAX_PRINTED_FAILS_TOTAL = 40;

// 与 scripts/playthrough-mapgen-scenarios.ts / playthrough-bluecaves.ts 等同款 LCG（种子化确定性生成）。
function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function genMap(zoneId: string, seed: number): DiveMap {
  const zone = getZone(zoneId);
  if (!zone) throw new Error(`zone ${zoneId} 不存在`);
  return generateDiveMap({ zone, profileFlags: FLAGS, deaths: [], rng: makeRng(seed) });
}

/** 已在①校验过 finite 的 x 取出成 number（调用方须先确认 missingX.length===0 再用）。 */
function xOf(n: DiveNode): number {
  return n.x!;
}

/** 节点指纹（⑥确定性比对用）：id/x/depth/排序后 connectsTo。x 缺失时序列化成 null（JSON.stringify 对
 * array 内 undefined 的既有行为）——坐标契约还没接通时两次生成仍能稳定比对，不会因此误报「非确定性」。 */
function fingerprint(map: DiveMap): string {
  return JSON.stringify(
    Object.keys(map.nodes)
      .sort()
      .map((id) => {
        const n = map.nodes[id];
        return [id, n.x ?? null, n.depth, [...n.connectsTo].sort()];
      }),
  );
}

const fails: string[] = [];
let mapsChecked = 0;

/** 对一张图跑①②③④⑤五项断言（⑥确定性按 zone 单独跑一次，见 checkDeterminism）。 */
function checkMap(tag: string, map: DiveMap): void {
  mapsChecked++;
  const nodes: DiveNode[] = Object.values(map.nodes);
  const start = map.nodes[map.startNodeId];
  if (!start) {
    fails.push(`${tag}: startNodeId=${map.startNodeId} 未在 nodes 中找到`);
    return;
  }

  // ① 全节点带有限 x
  const missingX = nodes.filter((n) => typeof n.x !== 'number' || !Number.isFinite(n.x));
  if (missingX.length > 0) {
    fails.push(
      `${tag}: ${missingX.length}/${nodes.length} 个节点无有限 x（${missingX
        .slice(0, 5)
        .map((n) => n.id)
        .join(', ')}${missingX.length > 5 ? ', …' : ''}）`,
    );
  }

  // ② 起点＝全局唯一最浅（严格 <，不接受并列）
  for (const n of nodes) {
    if (n.id === start.id) continue;
    if (!(start.depth < n.depth)) {
      fails.push(
        `${tag}: 起点 ${start.id}(depth=${start.depth}) 未严格浅于 ${n.id}(depth=${n.depth})——起点应是全局唯一最浅点`,
      );
    }
  }

  // ③④ 坐标诚实（非相邻不假熔 / 有边不画远）——x 缺失时几何判据无意义，①已经报过，这里跳过避免刷屏
  if (missingX.length === 0) {
    const adj: Record<string, Set<string>> = {};
    for (const n of nodes) adj[n.id] = new Set(n.connectsTo);
    const linked = (id1: string, id2: string): boolean => adj[id1].has(id2) || adj[id2].has(id1);

    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const na = nodes[i];
        const nb = nodes[j];
        const m = scatterMetric({ x: xOf(na), y: na.depth }, { x: xOf(nb), y: nb.depth });
        if (linked(na.id, nb.id)) {
          if (!(m <= EDGE_MAX_FACTOR)) {
            fails.push(
              `${tag}: 边 ${na.id}–${nb.id} 画远（scatterMetric=${m.toFixed(3)} > EDGE_MAX_FACTOR=${EDGE_MAX_FACTOR}）`,
            );
          }
        } else if (!(m >= NONADJ_MIN_FACTOR)) {
          fails.push(
            `${tag}: 非相邻 ${na.id}–${nb.id} 疑似假熔（scatterMetric=${m.toFixed(3)} < NONADJ_MIN_FACTOR=${NONADJ_MIN_FACTOR}）`,
          );
        }
      }
    }
  }

  // ⑤ 结构不变量（analyzeMap·字段名照抄 mapgen-analyze.ts）
  const a = analyzeMap(map);
  if (!a.allReachable) fails.push(`${tag}: allReachable=false（非全可达）`);
  if (!a.isUndirected) fails.push(`${tag}: isUndirected=false（非双向边）`);
  if (!a.hasCycle) fails.push(`${tag}: hasCycle=false（无环）`);
  if (!a.hasDeadEnd) fails.push(`${tag}: hasDeadEnd=false（无死路）`);
  if (!(a.localMaximaIds.length >= 2)) {
    fails.push(`${tag}: localMaximaIds.length=${a.localMaximaIds.length}（局部极大"最深点"应 ≥2）`);
  }
}

/** 扫一个 zone 的 seed 1..count，跑①–⑤，就地打印本 zone 的 ✓/✗ 计数。 */
function sweepZone(zoneId: string, seedCount: number): void {
  const before = fails.length;
  for (let seed = 1; seed <= seedCount; seed++) {
    checkMap(`${zoneId} seed=${seed}`, genMap(zoneId, seed));
  }
  const bad = fails.length - before;
  console.log(bad === 0 ? `  ✓ ${zoneId}：${seedCount} seed 全过` : `  ✗ ${zoneId}：${bad} 处违反（明细见结尾）`);
}

/** ⑥确定性：单个 zone 用 seed=7 生成两次，指纹须逐字节相同。就地打印本 zone 的 ✓/✗。 */
function checkDeterminism(zoneId: string): void {
  const before = fails.length;
  const m1 = genMap(zoneId, DETERMINISM_SEED);
  const m2 = genMap(zoneId, DETERMINISM_SEED);
  if (fingerprint(m1) !== fingerprint(m2)) {
    fails.push(`${zoneId}: 非确定性（seed=${DETERMINISM_SEED} 两次生成的节点 id/x/depth/connectsTo 不一致）`);
  }
  console.log(fails.length === before ? `  ✓ ${zoneId}：确定性` : `  ✗ ${zoneId}：非确定性（明细见结尾）`);
}

console.log('========== 坐标诚实扫描（地图2D坐标 SPEC §4·warren 门泛化版） ==========');
console.log(
  `  常量：SCATTER_MIN_DX=${SCATTER_MIN_DX} SCATTER_MIN_DY=${SCATTER_MIN_DY} ` +
    `NONADJ_MIN_FACTOR=${NONADJ_MIN_FACTOR} EDGE_MAX_FACTOR=${EDGE_MAX_FACTOR}`,
);

console.log(`\n========== A. maze 组（${MAZE_ZONES.length} zone × seed 1–${MAZE_SEEDS}） ==========`);
for (const zoneId of MAZE_ZONES) sweepZone(zoneId, MAZE_SEEDS);

console.log(`\n========== B. layered 组（${LAYERED_ZONES.length} zone × seed 1–${LAYERED_SEEDS}） ==========`);
for (const zoneId of LAYERED_ZONES) sweepZone(zoneId, LAYERED_SEEDS);

console.log(`\n========== C. 确定性（每 zone seed=${DETERMINISM_SEED} 生成两次） ==========`);
for (const zoneId of [...MAZE_ZONES, ...LAYERED_ZONES]) checkDeterminism(zoneId);

// D. 洞型谱 k 扫描（对抗复审 2026-07-20 补盲区）：上面 genMap 不带 seedKey ⇒ resolveDepthCurve 恒 k=1，
// ①–⑤ 此前从未在 k≠1 图上跑过——而 vertical_test 自配 depthCurveRange [0.45,2.6]、真实 POI 经 seedKey 派生
// 随时激活（末端重映射时代 k=2.6 曾 300/300 seed 破「入口唯一最浅」·修法=在最终空间采样·见 mapgen-scatter 头注）。
// 显式 depthCurve 三档 × seed 跑同款①–⑤；再补一批 seedKey 派生路径（POI 实际走的洞型解析链）。
const CURVE_KS = [0.45, 1.8, 2.6];
const CURVE_SEEDS = 40;
console.log(
  `\n========== D. 洞型谱 k 扫描（zone.vertical_test × k∈{${CURVE_KS.join(', ')}} × seed 1–${CURVE_SEEDS} + seedKey 派生×12） ==========`,
);
{
  const zone = getZone('zone.vertical_test');
  if (!zone) throw new Error('zone.vertical_test 不存在');
  const before = fails.length;
  for (const k of CURVE_KS) {
    for (let seed = 1; seed <= CURVE_SEEDS; seed++) {
      checkMap(
        `vertical_test k=${k} seed=${seed}`,
        generateDiveMap({ zone, profileFlags: FLAGS, deaths: [], rng: makeRng(seed), depthCurve: k }),
      );
    }
  }
  for (let i = 1; i <= 12; i++) {
    checkMap(
      `vertical_test seedKey=poi.k.${i}`,
      generateDiveMap({ zone, profileFlags: FLAGS, deaths: [], seedKey: `poi.k.${i}` }),
    );
  }
  console.log(
    fails.length === before ? `  ✓ k≠1 全档过①–⑤（曲线只弯剖面·不弯诚实）` : `  ✗ ${fails.length - before} 处违反（明细见结尾）`,
  );
}

console.log('');
if (fails.length > 0) {
  console.log(`✗ 失败 ${fails.length} 处（共扫 ${mapsChecked} 张图 + ${MAZE_ZONES.length + LAYERED_ZONES.length} 组确定性）：`);
  for (const f of fails.slice(0, MAX_PRINTED_FAILS_TOTAL)) console.log(`    ${f}`);
  if (fails.length > MAX_PRINTED_FAILS_TOTAL) console.log(`    …还有 ${fails.length - MAX_PRINTED_FAILS_TOTAL} 条（已截断）`);
  process.exit(1);
} else {
  console.log(
    `✓ playthrough 完成：坐标诚实扫描全绿（${mapsChecked} 张图：全节点带 x · 起点全局唯一最浅 · ` +
      `非相邻不假熔 · 有边不画远 · 结构不变量 · 确定性）`,
  );
}
