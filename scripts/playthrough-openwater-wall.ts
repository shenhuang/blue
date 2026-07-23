// 开阔水域「侧壁 / 峡谷」防埋点几何回归（开阔水域 SPEC §6·#330·src/ui/openWaterRender.ts 单一真相）。
//
// 背景：`buildOpenWaterGeometry` 从 zone 的 `openWaterWall` 配置 + **全部节点的 layout 位置**
// （`Object.values(layout.pos)`）确定性派生 `OwWall`（`computeWallEnvelope`）；`wallInnerX(wy, wall, side)`
// 给出某深度墙内面的世界 x（水/岩水平分界）。防埋点是**构造保证**（内面 clamp 到「节点 x 外包络 ± margin」
// 之外·§6.5），但那份保证活在 openWaterRender.ts 里——本文件把它钉成一道会在 regress 里跑真 mapgen 图
// 验证的回归，不是读源码相信它，是每次撒点都重新验一遍（同 playthrough-seabed.ts 的 #7「真 mapgen 形状门」
// 精神：不在门里重写几何，只喂真图、验真产出）。
//
// 覆盖：
//   1. 4 个侧壁 look-dev 夹具（canyon=双壁有底 / cliff=左壁+右敞 midwater / shelf=右壁+左收 taper /
//      slot=双壁无底 floorless）× 40 seed 真 generateDiveMap ⇒ geom.wall 恒非 null（zone 都声明了墙）。
//   2. 防埋点：wall.side 覆盖的每一侧，全部节点的 layout 位置都必须严格落在墙内面的水侧
//      （'left'/'both' ⇒ x > wallInnerX(y,'left')；'right'/'both' ⇒ x < wallInnerX(y,'right')）。
//   3. 双壁不夹死：side==='both' 时每个节点深度上 wallInnerX(y,'right') > wallInnerX(y,'left')
//      （正水道宽度——墙不能互相穿过把地图整个封死）。
//   4. 覆盖下限（#327「过滤写反 ⇒ 扫描范围塌成空集但仍全绿」的教训镜像）：断言实际检查过的节点数
//      远超一个荒谬的低地板，且确实扫过全部 4 个 zone——防止某处 zoneId/side 分支写错、
//      悄悄把 sweep 缩成空集却仍然"全绿"。
//   5. 负控（证明谓词有牙）：手搓 OwWall + 故意放在内面之后（岩体里）的节点，断言判定谓词真的会抓到它；
//      顺手核对水侧正常节点不被误判——两头都测，防谓词退化成永真式或永假式而让 2/3 的断言形同虚设。
//   6.（#330 对抗复审加固·NIT）形状锁——taper live：双壁夹具 zone.openwater_canyon_test 若干 seed 下，
//      浅处（小 wy）水道宽度必须明显大于深处（大 wy·deepestY）水道宽度（wide-top V/U）。锁住刚修的
//      「taper 失效退化成竖直平板」回归——那样浅深处宽度会近似相等，容差 K（远高于 2×波纹幅）直接抓现行。
//   7.（#330 对抗复审加固·NIT3）floorless bake——双壁无底裂隙夹具 zone.openwater_slot_test：
//      geom.floored===false 且 geom.wall!==null（floorless 短路不该连墙一起吞掉）；真烤一张图，
//      断言确有非水像素（墙渲染出来了）且水道正中心仍是纯水（没有被过度填充吞掉）。
//
// 跑法： npx tsx scripts/playthrough-openwater-wall.ts

import { generateDiveMap } from '../src/engine/mapgen';
import { getZone } from '../src/engine/zones';
import { deriveMapLayout } from '../src/ui/mapLayout';
import {
  buildOpenWaterGeometry,
  wallInnerX,
  bakeOpenWaterRGBA,
  type OwWall,
  type OwRect,
} from '../src/ui/openWaterRender';
import { OW_WALL_MARGIN } from '../src/engine/sonarGeometry';
import { makeHarness, type PtAssert } from './lib/pt';

const pt = makeHarness('开阔水域侧壁防埋点回归（buildOpenWaterGeometry.wall / wallInnerX·SPEC §6·#330）');
const { L } = pt;
const assert: PtAssert = pt.assert;

const makeRng = (seed: number): (() => number) => {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
};

const WALL_ZONES = [
  'zone.openwater_canyon_test', // side both·有底（rock）
  'zone.openwater_cliff_test', // side left·otherSide midwater·右敞无底
  'zone.openwater_shelf_test', // side right·otherSide taper·左收缓坡
  'zone.openwater_slot_test', // side both·midwater floorless（关键 bake 路径）
];
const SEEDS = 40;
const EPS = 1e-6; // 严格不等式的容差余量（浮点噪声·不是放宽判据）
const COVERAGE_FLOOR = 200; // 荒谬地低的下限——真实覆盖应比这高一个数量级以上

/**
 * 防埋点谓词：给定一个节点的 layout 位置与墙配置，判它有没有被墙埋住。
 * 有问题 ⇒ 返回描述字符串；没问题 ⇒ null。只检查 wall.side 覆盖到的那一侧/两侧
 * （单侧墙不检查缺席那侧——缺席侧 wallInnerX 已是 ±∞ 哨兵，检查了也恒过，白测）。
 * 抽成独立函数是为了同一份逻辑既喂真 sweep、也喂下面的负控——负控测的是**这个函数本身**有没有牙。
 */
function buriedProblem(pos: { x: number; y: number }, wall: OwWall): string | null {
  if (wall.side === 'left' || wall.side === 'both') {
    const inner = wallInnerX(pos.y, wall, 'left');
    if (!(pos.x > inner + EPS)) {
      return `x=${pos.x.toFixed(2)} 未严格大于左墙内面=${inner.toFixed(2)}（y=${pos.y.toFixed(2)}·被埋进左墙）`;
    }
  }
  if (wall.side === 'right' || wall.side === 'both') {
    const inner = wallInnerX(pos.y, wall, 'right');
    if (!(pos.x < inner - EPS)) {
      return `x=${pos.x.toFixed(2)} 未严格小于右墙内面=${inner.toFixed(2)}（y=${pos.y.toFixed(2)}·被埋进右墙）`;
    }
  }
  return null;
}

const brief = (a: string[]): string => a.slice(0, 5).join(' | ') + (a.length > 5 ? ` …（共 ${a.length} 处）` : '');

// ============================================================
// 负控（先做·证明 buriedProblem 有牙）：手搓合法形状的 OwWall（不经 computeWallEnvelope，直接摸字段），
// 用 wallInnerX 的**真实**返回值反推一个「刚好在内面之后」的坏位置——不需要知道 OW_WALL_MARGIN/TAPER/
// RIPPLE 的具体旋钮数值就能保证坏例真的坏（自洽：inner 本身就是从真实函数现算的）。
// 同时核对水侧「明显安全」的位置不被误判——两个方向都测，防谓词退化成永真式（水侧也报警）或
// 永假式（埋点也放行），那样上面①②的断言就会变成形同虚设的空跑。
// ============================================================
{
  const wLeft: OwWall = { side: 'left', otherSide: 'taper', minNodeX: 100, maxNodeX: 100, deepestY: 50, phase: 0 };
  const innerL = wallInnerX(30, wLeft, 'left');
  assert(
    buriedProblem({ x: innerL - 5, y: 30 }, wLeft) !== null,
    `负控①：左墙内面=${innerL.toFixed(2)} 之后 5 单位的节点必须被 buriedProblem 判定为「被埋」，实际未被判定——谓词失去防埋点意义`,
  );
  assert(
    buriedProblem({ x: innerL + 5, y: 30 }, wLeft) === null,
    '负控①b：左墙水侧（内面之外）的正常节点不该被误判为「被埋」',
  );

  const wRight: OwWall = { side: 'right', otherSide: 'taper', minNodeX: 100, maxNodeX: 100, deepestY: 50, phase: 0 };
  const innerR = wallInnerX(30, wRight, 'right');
  assert(
    buriedProblem({ x: innerR + 5, y: 30 }, wRight) !== null,
    `负控②：右墙内面=${innerR.toFixed(2)} 之后 5 单位的节点必须被 buriedProblem 判定为「被埋」`,
  );
  assert(
    buriedProblem({ x: innerR - 5, y: 30 }, wRight) === null,
    '负控②b：右墙水侧的正常节点不该被误判为「被埋」',
  );

  const wBoth: OwWall = { side: 'both', otherSide: 'taper', minNodeX: 100, maxNodeX: 200, deepestY: 50, phase: 0 };
  const bInnerL = wallInnerX(30, wBoth, 'left');
  const bInnerR = wallInnerX(30, wBoth, 'right');
  assert(buriedProblem({ x: bInnerL - 5, y: 30 }, wBoth) !== null, '负控③：双壁图左墙埋点必须被判定为「被埋」');
  assert(buriedProblem({ x: bInnerR + 5, y: 30 }, wBoth) !== null, '负控③b：双壁图右墙埋点必须被判定为「被埋」');
  assert(
    buriedProblem({ x: (bInnerL + bInnerR) / 2, y: 30 }, wBoth) === null,
    '负控③c：双壁图正中间的水侧节点不该被误判为「被埋」',
  );
  L('  负控：手搓的左/右/双壁埋点均被 buriedProblem 正确判定为「被埋」·水侧正常点均不误判——谓词有牙 ✓');
}

// ============================================================
// 真 sweep：4 个侧壁夹具 × 40 seed 真 generateDiveMap ⇒ geom.wall 非空 + 防埋点 + 双壁不夹死。
// ============================================================
const FLAGS = new Set(['flag.tutorial_complete']);
const buriedFails: string[] = [];
const pinchFails: string[] = [];
const visitedZones = new Set<string>();
let mapsSwept = 0;
let totalNodesChecked = 0;

for (const zoneId of WALL_ZONES) {
  const zone = getZone(zoneId);
  assert(zone, `zone ${zoneId} 应存在（侧壁 look-dev 夹具·见 src/data/zones.json）`);
  visitedZones.add(zoneId);

  for (let seed = 1; seed <= SEEDS; seed++) {
    const map = generateDiveMap({ zone, profileFlags: FLAGS, deaths: [], rng: makeRng(seed) });
    const layout = deriveMapLayout(map);
    const geom = buildOpenWaterGeometry(layout, zone, map);
    mapsSwept++;
    const tag = `${zoneId} seed=${seed}`;

    const wall = geom.wall;
    assert(wall !== null, `${tag}: geom.wall 不应为 null（该 zone 声明了 openWaterWall）——否则下面全部断言空跑`);

    for (const pos of Object.values(layout.pos)) {
      totalNodesChecked++;

      const problem = buriedProblem(pos, wall);
      if (problem) buriedFails.push(`${tag}: ${problem}`);

      if (wall.side === 'both') {
        const l = wallInnerX(pos.y, wall, 'left');
        const r = wallInnerX(pos.y, wall, 'right');
        if (!(r > l + EPS)) {
          pinchFails.push(`${tag}: 通道被夹死 y=${pos.y.toFixed(2)} 左内面=${l.toFixed(2)} 右内面=${r.toFixed(2)}`);
        }
      }
    }
  }
}

assert(
  buriedFails.length === 0,
  `②: ${buriedFails.length} 个节点被侧壁埋住（应 0）——墙内面必须恒在水侧之外：${brief(buriedFails)}`,
);
assert(
  pinchFails.length === 0,
  `③: ${pinchFails.length} 处双壁通道被夹死（应 0·side='both' 时右内面必须恒大于左内面）：${brief(pinchFails)}`,
);

// 覆盖下限（#327 镜像）：真扫过东西，不是筛子写反导致的空跑「全绿」。
assert(
  totalNodesChecked > COVERAGE_FLOOR,
  `④: 实际检查节点数 ${totalNodesChecked} 应 > ${COVERAGE_FLOOR}（过低说明 sweep 范围可能被写错的过滤条件塌成了空集）`,
);
assert(
  WALL_ZONES.every((z) => visitedZones.has(z)),
  `④b: 应扫过全部 ${WALL_ZONES.length} 个侧壁夹具 zone，实际扫过 ${visitedZones.size} 个`,
);

L(
  `  真 mapgen ${mapsSwept} 图（${WALL_ZONES.length} zone × ${SEEDS} seed）：0 埋点 · 0 处夹死通道 · ` +
    `共检查 ${totalNodesChecked} 个节点位置（> ${COVERAGE_FLOOR} 覆盖下限）✓`,
);

// ============================================================
// ⑤（#330 对抗复审加固）形状锁：taper live（wide-top V/U）——钉住刚修的埋根 bug。
// 墙必须上宽下窄；如果 taper 退化成两片竖直平板，浅处/深处量出来的通道宽度会近似相等，
// 容差 K（远高于波纹噪声）会直接抓到这种回归。只测双壁夹具（single-wall 没有「两侧都收」的对称宽度概念）。
// ============================================================
const TAPER_ZONE = 'zone.openwater_canyon_test'; // 双壁有底夹具（WALL_ZONES[0]·taper 形状门专用）
const TAPER_SEED_COUNT = 8; // 只需几个种子验证不变量——几何是确定性纯函数，不必复用全部 40 个
const TAPER_K = 20; // 远高于 2×OW_WALL_RIPPLE_AMP(4)=8 的安全边际：taper 没死的话，差值应以数十计
const taperZone = getZone(TAPER_ZONE);
assert(taperZone, `zone ${TAPER_ZONE} 应存在（taper 形状门用·双壁有底夹具）`);

const channelWidthAt = (wy: number, wall: OwWall): number =>
  wallInnerX(wy, wall, 'right') - wallInnerX(wy, wall, 'left');

const taperFails: string[] = [];
let taperMinGap = Infinity;
for (let seed = 1; seed <= TAPER_SEED_COUNT; seed++) {
  const map = generateDiveMap({ zone: taperZone, profileFlags: FLAGS, deaths: [], rng: makeRng(seed) });
  const layout = deriveMapLayout(map);
  const geom = buildOpenWaterGeometry(layout, taperZone, map);
  const wall = geom.wall;
  assert(wall !== null, `${TAPER_ZONE} seed=${seed}: geom.wall 不应为 null——否则形状门空跑`);

  const ys = Object.values(layout.pos).map((p) => p.y);
  const deepY = wall.deepestY; // 全图最深节点深度（构造上＝ Math.max(...ys)）
  const shallowY = Math.min(...ys); // 全图最浅节点深度——比 deepY 浅足够多，放大 taper 的效果

  const wDeep = channelWidthAt(deepY, wall);
  const wShallow = channelWidthAt(shallowY, wall);
  const gap = wShallow - wDeep;
  if (gap < taperMinGap) taperMinGap = gap;
  if (!(wShallow > wDeep + TAPER_K)) {
    taperFails.push(
      `seed=${seed}: 浅处(y=${shallowY.toFixed(1)})通道宽=${wShallow.toFixed(2)} 未严格大于` +
        `深处(y=${deepY.toFixed(1)})通道宽=${wDeep.toFixed(2)}+${TAPER_K}（差=${gap.toFixed(2)}——疑似 taper 失效/退化成竖直平板）`,
    );
  }
}
assert(
  taperFails.length === 0,
  `⑤: taper 形状锁失败（${taperFails.length}/${TAPER_SEED_COUNT} seed）——wide-top V/U 必须恒成立：${brief(taperFails)}`,
);
L(
  `  taper live (wide-top V/U) — #330 review：${TAPER_ZONE} × ${TAPER_SEED_COUNT} seed 均验证 ` +
    `浅处通道宽 > 深处通道宽 + ${TAPER_K}（本轮最小差值 ${taperMinGap.toFixed(2)}）✓`,
);

// ============================================================
// ⑥（#330 对抗复审加固·NIT3）floorless bake：无底裂隙仍要渲染出墙、且两墙之间的水道要真的是水
// ——不能被 floorless 短路连墙一起吞掉（回归成全水），也不能被过度填充吞掉水道中心（回归成全岩）。
// ============================================================
const SLOT_ZONE = 'zone.openwater_slot_test'; // 双壁无底裂隙夹具（关键 bake 路径）
const slotZone = getZone(SLOT_ZONE);
assert(slotZone, `zone ${SLOT_ZONE} 应存在（floorless bake 门用·双壁无底裂隙夹具）`);

const slotSeed = 1; // 单一确定性 seed 足够——bake 分支正确性取决于 geom.floored/geom.wall 的分支选择，非随机性
const slotMap = generateDiveMap({ zone: slotZone, profileFlags: FLAGS, deaths: [], rng: makeRng(slotSeed) });
const slotLayout = deriveMapLayout(slotMap);
const slotGeom = buildOpenWaterGeometry(slotLayout, slotZone, slotMap);
assert(
  slotGeom.floored === false,
  `${SLOT_ZONE} seed=${slotSeed}: geom.floored 应为 false（整图 midwater·无贴底节点＝无底裂隙）——否则下面 bake 走错分支、门空跑`,
);
assert(
  slotGeom.wall !== null,
  `${SLOT_ZONE} seed=${slotSeed}: geom.wall 不应为 null（该 zone 声明了 openWaterWall.side='both'）——floorless 短路也必须保留墙`,
);

// 取景矩形：横向按节点 x 外包络 ± 3×OW_WALL_MARGIN 框住（留够余量同时看见墙内外两侧）；
// 纵向按节点深度范围再加一点边。分辨率取适中 64×64——够数出「有没有非水像素」，不必细到画质级。
const slotXs = Object.values(slotLayout.pos).map((p) => p.x);
const slotYs = Object.values(slotLayout.pos).map((p) => p.y);
const slotX0 = Math.min(...slotXs) - 3 * OW_WALL_MARGIN;
const slotX1 = Math.max(...slotXs) + 3 * OW_WALL_MARGIN;
const slotYPad = 40;
const slotY0 = Math.min(...slotYs) - slotYPad;
const slotY1 = Math.max(...slotYs) + slotYPad;
const slotRect: OwRect = { x: slotX0, y: slotY0, w: slotX1 - slotX0, h: slotY1 - slotY0 };
const SLOT_W = 64;
const SLOT_H = 64;
const slotRgba = bakeOpenWaterRGBA(slotGeom, slotRect, SLOT_W, SLOT_H);

let slotNonWaterPixels = 0;
for (let px = 0; px < SLOT_W * SLOT_H; px++) {
  if (slotRgba[px * 4 + 3] !== 235) slotNonWaterPixels++;
}
assert(
  slotNonWaterPixels > 0,
  `⑥a: floorless slot 烤图应有非水像素（墙/发光边渲染出来）——实际 0/${SLOT_W * SLOT_H}` +
    '（geom.wall 可能在 bake 的 floorless 分支里被漏判·墙凭空消失、整窗塌成纯水）',
);

const slotCx = Math.floor(SLOT_W / 2);
const slotCy = Math.floor(SLOT_H / 2);
const slotCenterAlpha = slotRgba[(slotCy * SLOT_W + slotCx) * 4 + 3];
assert(
  slotCenterAlpha === 235,
  `⑥b: floorless slot 中心像素应是纯水（alpha=235）——实际 alpha=${slotCenterAlpha}` +
    '（两壁之间的裂隙被过度填充成岩/发光边·中心不再开阔）',
);

L(
  `  floorless slot renders walls, open center — #330 review NIT3：${SLOT_W}×${SLOT_H} 烤图共 ` +
    `${slotNonWaterPixels}/${SLOT_W * SLOT_H} 个非水像素（墙已渲染）· 中心像素 alpha=${slotCenterAlpha}（纯水）✓`,
);

pt.done();
