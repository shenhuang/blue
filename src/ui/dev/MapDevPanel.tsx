// MapDevPanel —— 地图调试器（`?editor` 工作台「地图调试」tab·EditorApp 承载·不再有游戏内浮层·2026-07-09）
//
// 目的：可视化迭代迷路 mapgen 的布局，不用反复编译跑 playthrough。
//   左栏：ZONE 选择（洞穴/开阔水域两组·分类条可收起各自 zone 列表）
//   中栏：节点图 SVG / 声呐洞穴图 —— 按 layer(到入口的树距) 分列连边、按 kind 配色，标注最深点/死路/回边
//   右栏：zone 信息（depthRange/layerCount）+ 结构读数（analyzeMap 全部性质·按迷路不变量着色）·单开一栏
//
// 设计（沿用 quirk #23/#24 套路，与 Event/Combat 面板一致）：
//   - 所有计算走 engine：generateDiveMap + analyzeMap，绝不在 UI 里复刻拓扑逻辑
//   - 不写新 GamePhase；本面板只作 ?editor 工作台的一个 tab 渲染（游戏内 Shift+M 浮层 / DevPanelKind 已撤·2026-07-09）
//   - 经 EditorApp lazy() 加载（工作台专属 chunk）；game↛dev 边界（check-boundaries 规则五 + check-dev-panels）保证不进游戏主包
//   - 布局确定性：固定 LCG(1)（与 scripts/playthrough-*.ts 同算法）·同 zone 同图
//
// 详见 docs/STATUS.md「真'迷路' mapgen」+「地图调试器 dev 面板」。

import { useMemo, useState, useRef, useEffect } from 'react';
import './map-panel.css';
import { generateDiveMap, analyzeMap, resolveLayoutStyle } from '@/engine/mapgen';
import { ZONES, zoneAllowsBacktrack } from '@/engine/zones';
import { makeLcg } from '@/engine/rng';
import { deriveMapLayout } from '../mapLayout';
import { buildCaveGeometry, bakeCaveRGBA } from '../SonarScanPanel';
import { SONAR_PX_PER_M, SONAR_COL_W, CAVE_GEOM_MARGIN } from '@/engine/sonarGeometry';
import type { DiveMap, DiveNode, ZoneDef } from '@/types';

export interface MapDevPanelProps {
  onClose?: () => void;
}

const FLAGS = new Set(['flag.tutorial_complete']);

function kindClass(node: DiveNode, startId: string): string {
  if (node.id === startId) return 'dev-map-fill-entrance';
  switch (node.kind) {
    case 'ascent_point':
      return 'dev-map-fill-exit';
    case 'corpse':
      return 'dev-map-fill-corpse';
    case 'rest':
      return 'dev-map-fill-rest';
    case 'air_pocket':
      return 'dev-map-fill-air';
    case 'camp':
      return 'dev-map-fill-camp';
    case 'event':
      return 'dev-map-fill-event';
    // shop/boss 当前 mapgen 不给 DiveNode 派（仅 GamePhase 用·潜在）·复用既有色占位。
    case 'shop':
      return 'dev-map-fill-event';
    case 'boss':
      return 'dev-map-fill-corpse';
    default: {
      // 穷尽断言：NodeKind 加成员 → typecheck 在此报、逼这里补一笔色（别再静默落 default）。
      const _exhaustive: never = node.kind;
      return _exhaustive;
    }
  }
}

function kindGlyph(node: DiveNode, startId: string): string {
  if (node.id === startId) return '口';
  switch (node.kind) {
    case 'ascent_point':
      return '出';
    case 'corpse':
      return '尸';
    case 'rest':
      return '歇';
    case 'air_pocket':
      return '气';
    case 'camp':
      return '营';
    case 'event':
      return '事';
    case 'shop':
      return '市';
    case 'boss':
      return '王';
    default: {
      // 穷尽断言：NodeKind 加成员 → typecheck 在此报（与 kindClass 同·守 dev 标注不漏新 kind）。
      const _exhaustive: never = node.kind;
      return _exhaustive;
    }
  }
}

export function MapDevPanel({ onClose }: MapDevPanelProps) {
  const randomZones = useMemo<ZoneDef[]>(
    () => [...ZONES.values()].filter((z) => z.generation === 'random'),
    [],
  );
  // 按渲染类型分两类（作者 2026-06-27「洞穴和开阔水域就行」）：洞穴=maze→声呐图 / 开阔水域=layered→节点图。
  // 判据同 zoneAllowsBacktrack；左侧 tab 据此切，zone 列表只列当前类（替代旧下拉·按类型区分）。
  const caveZones = useMemo(() => randomZones.filter((z) => zoneAllowsBacktrack(z.id)), [randomZones]);
  const openZones = useMemo(() => randomZones.filter((z) => !zoneAllowsBacktrack(z.id)), [randomZones]);
  const [zoneId, setZoneId] = useState<string>(
    randomZones.find((z) => zoneAllowsBacktrack(z.id))?.id ?? randomZones[0]?.id ?? '',
  );
  // seed / ΔDEPTH / 剖面k 调试旋钮全撤（作者 2026-06-27「都没用了·seed 也多余」）：布局按固定 LCG(1)
  // 确定性生成——每座 zone 只看其确定性布局 + 结构读数；以后要看不同随机图，加回一个 reseed 即可。
  // 左栏两组（洞穴/开阔水域）各自可收起列表（「tab 做成列表上方·可收起该列表」）；初始非当前类收起（初始 zone = 洞穴）。
  const [collapsed, setCollapsed] = useState<Record<'open' | 'cave', boolean>>({ open: true, cave: false });

  const zone = ZONES.get(zoneId);

  // 左侧两类 tab + 当前类 zone 列表（zoneId 单一真相·activeCat 由它派生·不另存 state）。
  // 渲染风格游戏里按 zone 固定（resolveLayoutStyle）·不再给可选下拉（作者 2026-06-27：给「选择」纯属误导）；
  // 每座的实际风格在 zone 列表项 + 中栏图标题里只读展示。
  const TABS: Array<{ id: 'open' | 'cave'; label: string; hint: string; zones: ZoneDef[] }> = [
    { id: 'cave', label: '洞穴', hint: '声呐图', zones: caveZones },
    { id: 'open', label: '开阔水域', hint: '节点图', zones: openZones },
  ];
  const activeCat: 'open' | 'cave' = zone && zoneAllowsBacktrack(zone.id) ? 'cave' : 'open';
  const toggleCat = (cat: 'open' | 'cave') => setCollapsed((c) => ({ ...c, [cat]: !c[cat] }));
  const renderZoneItem = (z: ZoneDef) => (
    <li
      key={z.id}
      className={`dev-event-item ${z.id === zoneId ? 'selected' : ''}`}
      onClick={() => setZoneId(z.id)}
    >
      <div className="dev-event-id">{z.name}</div>
      <div className="dev-event-meta">
        <span className="dev-faint">
          {z.depthRange[0]}–{z.depthRange[1]}m · {resolveLayoutStyle(z)}
          {z.canFreeAscend === false ? ' · 封闭' : ''}
        </span>
      </div>
    </li>
  );

  const map: DiveMap | null = useMemo(() => {
    if (!zone) return null;
    return generateDiveMap({
      zone,
      profileFlags: FLAGS,
      deaths: [],
      rng: makeLcg(1),
    });
  }, [zone]);

  const analysis = useMemo(() => (map ? analyzeMap(map) : null), [map]);

  // —— 布局：抽到共享 deriveMapLayout（声呐探索图 SonarScanPanel 与本面板同一套铺点，避免漂移）——
  const layout = useMemo(() => (map ? deriveMapLayout(map) : null), [map]);

  const deepestSet = useMemo(() => new Set(analysis?.deepestNodeIds ?? []), [analysis]);
  const deadEndSet = useMemo(() => new Set(analysis?.deadEndIds ?? []), [analysis]);

  // —— 声呐洞穴概览（把玩家「有机洞穴」铺满整图·全揭示·与游戏内同一 bakeCaveRGBA·单一来源）——
  // 用与玩家取景窗同一套布局比例（SONAR_PX_PER_M/COL_W）＝洞看起来和游戏里一致（只是整图全揭、无雾无扫）。
  const isOpenWater = zone ? !zoneAllowsBacktrack(zone.id) : false;
  const caveLayout = useMemo(
    () => (map ? deriveMapLayout(map, { pxPerMeter: SONAR_PX_PER_M, colW: SONAR_COL_W }) : null),
    [map],
  );
  // 烤洞穴的世界取景框＝节点包围盒四周再扩 CAVE_GEOM_MARGIN：有机洞穴的房间/散瓣/域扭曲会鼓出节点包围盒，
  // 不留这圈则画布边缘把上下左右的洞壁裁掉（dev 把整图烤进固定画布才暴露·游戏内移动取景窗不会·margin 单一来源见 SonarScanPanel）。
  const caveRect = useMemo(
    () =>
      caveLayout
        ? {
            x: -CAVE_GEOM_MARGIN,
            y: -CAVE_GEOM_MARGIN,
            w: caveLayout.width + 2 * CAVE_GEOM_MARGIN,
            h: caveLayout.height + 2 * CAVE_GEOM_MARGIN,
          }
        : null,
    [caveLayout],
  );
  const caveGeom = useMemo(() => {
    if (!map || !caveLayout || isOpenWater) return null;
    const ids = Object.keys(map.nodes);
    const mem: Record<string, number> = {};
    for (const id of ids) mem[id] = 0; // 全揭示＝看整张洞（dev 概览·非玩家渐进揭示）
    return buildCaveGeometry(caveLayout, ids, mem);
  }, [map, caveLayout, isOpenWater]);
  // 声呐洞穴**替换**节点图：有洞（maze / 可回头 zone）→ 画洞；开阔水域无洞 → 回退原节点图。
  const showCave = !!caveGeom;

  const caveCanvasRef = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const canvas = caveCanvasRef.current;
    if (!canvas || !caveRect || !caveGeom) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    // 内部分辨率（0.75×·长边封顶防深图卡顿）；CSS 再放大到 caveRect 尺寸＝与节点覆盖层对齐。
    const SCALE = 0.75;
    const CAP = 1200;
    let ow = Math.max(1, Math.round(caveRect.w * SCALE));
    let oh = Math.max(1, Math.round(caveRect.h * SCALE));
    if (oh > CAP) {
      ow = Math.max(1, Math.round((ow * CAP) / oh));
      oh = CAP;
    }
    canvas.width = ow;
    canvas.height = oh;
    // rect 含四周 margin（覆盖洞穴鼓出·见 caveRect 注）＝边缘洞壁不再被画布裁掉。
    const rgba = bakeCaveRGBA(caveGeom, caveRect, ow, oh);
    const img = ctx.createImageData(ow, oh);
    img.data.set(rgba);
    ctx.putImageData(img, 0, 0);
  }, [caveRect, caveGeom]);

  function check(label: string, ok: boolean, detail?: string) {
    return (
      <div className="dev-map-check" key={label}>
        <span className="dev-map-check-key">{label}</span>
        <span className={ok ? 'ok' : 'bad'}>
          {ok ? '✓' : '✗'} {detail ?? ''}
        </span>
      </div>
    );
  }

  return (
    <div className="dev-panel">
      <div className="dev-panel-header">
        <div>
          <div className="dev-panel-title">地图调试器 · MapDevPanel</div>
          <div className="dev-panel-sub">
            generateDiveMap + analyzeMap · 确定性布局 LCG(1) · ?editor=map
          </div>
        </div>
        <div className="dev-panel-header-actions">
          {onClose && (
            <button className="dev-btn dev-btn-quiet" onClick={onClose}>
              关闭 ✕
            </button>
          )}
        </div>
      </div>

      <div className="dev-panel-body dev-map-body">
        {/* 左：ZONE 选择（单独一栏·两组分类条可收起各自 zone 列表） */}
        <div className="dev-col dev-col-form dev-map-zone-col">
          <h3 className="dev-col-title">ZONE 选择</h3>
          <div className="dev-section dev-map-acc">
            <div className="dev-faint" style={{ marginBottom: 6 }}>
              点分类条收起/展开列表 · 点条目选关卡
            </div>
            {TABS.map((t) => {
              const isOpen = !collapsed[t.id];
              return (
                <div className="dev-map-acc-group" key={t.id}>
                  <button
                    type="button"
                    className={`dev-map-acc-head ${activeCat === t.id ? 'on' : ''}`}
                    aria-expanded={isOpen}
                    onClick={() => toggleCat(t.id)}
                  >
                    <span className="dev-map-acc-chevron">{isOpen ? '▾' : '▸'}</span>
                    <span className="dev-map-acc-label">{t.label}</span>
                    <span className="dev-map-acc-hint">{t.hint} · {t.zones.length}</span>
                  </button>
                  {isOpen && (
                    <ul className="dev-event-list dev-map-zone-list">{t.zones.map(renderZoneItem)}</ul>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* 中：图（节点图 / 声呐洞穴图） */}
        <div className="dev-col dev-map-canvas-col">
          <h3 className="dev-col-title">
            {showCave ? '声呐洞穴图' : '节点图'} · {map?.zoneId} · 布局 {map?.layoutStyle || 'vertical'}{' '}
            <span className="dev-faint">
              {showCave
                ? '（声呐有机洞穴·整图全揭·与游戏内同一渲染·确定性同图同洞）'
                : '（开阔水域无洞壁·列 = 到入口的树距 layer）'}
            </span>
          </h3>
          {!showCave ? (
          <>
          <div className="dev-map-svg-wrap">
            {map && layout && (
              <svg
                className="dev-map-svg"
                width={layout.width}
                height={layout.height}
                viewBox={`0 0 ${layout.width} ${layout.height}`}
              >
                {/* 边 */}
                {layout.edges.map((e, i) => {
                  const pa = layout.pos[e.a];
                  const pb = layout.pos[e.b];
                  if (!pa || !pb) return null;
                  return (
                    <line
                      key={i}
                      className={`dev-map-edge ${e.chord ? 'is-chord' : ''}`}
                      x1={pa.x}
                      y1={pa.y}
                      x2={pb.x}
                      y2={pb.y}
                    />
                  );
                })}
                {/* 节点 */}
                {Object.values(map.nodes).map((n) => {
                  const p = layout.pos[n.id];
                  if (!p) return null;
                  const classes = [
                    'dev-map-node',
                    deepestSet.has(n.id) ? 'is-deepest' : '',
                    deadEndSet.has(n.id) ? 'is-deadend' : '',
                  ].join(' ');
                  return (
                    <g key={n.id} className={classes}>
                      <circle className={kindClass(n, map.startNodeId)} cx={p.x} cy={p.y} r={layout.r} />
                      <text x={p.x} y={p.y - 2}>{n.depth}m</text>
                      <text className="dev-map-node-sub" x={p.x} y={p.y + 8}>
                        {kindGlyph(n, map.startNodeId)}
                      </text>
                    </g>
                  );
                })}
              </svg>
            )}
          </div>
          <div className="dev-map-legend">
            <span><i className="dev-map-swatch dev-map-fill-entrance" />入口(口)</span>
            <span><i className="dev-map-swatch dev-map-fill-exit" />另一头出口(出)</span>
            <span><i className="dev-map-swatch dev-map-fill-event" />事件(事)</span>
            <span><i className="dev-map-swatch dev-map-fill-rest" />空水道(歇)</span>
            <span><i className="dev-map-swatch dev-map-fill-air" />气穴(气)</span>
            <span><i className="dev-map-swatch dev-map-fill-camp" />扎营(营)</span>
            <span><i className="dev-map-swatch dev-map-fill-corpse" />尸体(尸)</span>
            <span><i className="dev-map-swatch" style={{ borderColor: 'var(--warn, #d6b25e)', borderWidth: 2 }} />最深点</span>
            <span>┄ 虚线圈 = 死路 · 蓝虚线 = 回边</span>
          </div>
          </>
          ) : (
          <>
          <div className="dev-map-svg-wrap dev-map-cave-wrap">
            {map &&
              caveLayout &&
              caveRect &&
              caveGeom && (
                <div
                  className="dev-map-cave-stack"
                  style={{ width: caveRect.w, height: caveRect.h }}
                >
                  <canvas ref={caveCanvasRef} className="dev-map-cave-canvas" />
                  <svg
                    className="dev-map-cave-overlay"
                    viewBox={`${caveRect.x} ${caveRect.y} ${caveRect.w} ${caveRect.h}`}
                    width={caveRect.w}
                    height={caveRect.h}
                  >
                    {Object.values(map.nodes).map((n) => {
                      const p = caveLayout.pos[n.id];
                      if (!p) return null;
                      return (
                        <g key={n.id} className="dev-cave-node">
                          <text className="dev-cave-node-depth" x={p.x} y={p.y - 3}>
                            {n.depth}m
                          </text>
                          <text className="dev-cave-node-glyph" x={p.x} y={p.y + 7}>
                            {kindGlyph(n, map.startNodeId)}
                          </text>
                        </g>
                      );
                    })}
                  </svg>
                </div>
            )}
          </div>
          <div className="dev-map-legend">
            <span><i className="dev-map-swatch" style={{ background: '#1f8a8a' }} />水道(蓝绿)</span>
            <span><i className="dev-map-swatch" style={{ background: '#6ee8d7' }} />岩壁(发光青)</span>
            <span><i className="dev-map-swatch" style={{ background: '#0a0e12' }} />岩石(暗)</span>
            <span className="dev-faint">越深越暗 · 字 = 节点深度/类型 · 确定性（同图同洞·revisit 不变）</span>
          </div>
          </>
          )}
        </div>

        {/* 右：结构读数（analyzeMap·单独一栏） */}
        <div className="dev-col dev-map-readout-col">
          <h3 className="dev-col-title">结构读数 · analyzeMap</h3>
          {zone && (
            <div className="dev-faint" style={{ marginBottom: 8 }}>
              depthRange {zone.depthRange[0]}–{zone.depthRange[1]}m · layerCount {zone.layerCount}
              {zone.mapShape === 'maze' && zone.depthCurveRange
                ? ` · 剖面 k（实潜按 POI 派生）${zone.depthCurveRange[0]}–${zone.depthCurveRange[1]}`
                : ''}
            </div>
          )}
          {analysis && (
            <div className="dev-section">
              {check('全节点从起点可达', analysis.allReachable, `${analysis.reachableCount}/${analysis.nodeCount}`)}
              {check('双向边（无向）', analysis.isUndirected)}
              {check('存在环 / 回边', analysis.hasCycle, `环秩 ${analysis.cycleRank}`)}
              {check('存在死路', analysis.hasDeadEnd, `${analysis.deadEndIds.length} 处`)}
              {check('多个最深点', analysis.deepestNodeIds.length >= 2, `${analysis.deepestNodeIds.length} @ ${analysis.maxDepth}m`)}
              {check('局部深度极大', analysis.localMaximaIds.length >= 2, `${analysis.localMaximaIds.length} 处`)}
              {check('上浮口全部可达', analysis.allAscentReachable, `${analysis.reachableAscentCount}/${analysis.ascentPointIds.length}`)}
              {check('入口即上浮口', analysis.entranceIsAscent)}
              <div className="dev-map-check">
                <span className="dev-map-check-key">节点 / 边</span>
                <span>{analysis.nodeCount} / {analysis.edgeCount}</span>
              </div>
              <div className="dev-map-check">
                <span className="dev-map-check-key">剖面 meanDepthFrac</span>
                <span>
                  {analysis.meanDepthFrac.toFixed(2)}
                  {analysis.meanDepthFrac <= 0.42
                    ? ' · 廊+坑'
                    : analysis.meanDepthFrac >= 0.58
                      ? ' · 井+廊'
                      : ' · 匀速下行'}
                </span>
              </div>
            </div>
          )}
          <div className="dev-faint">
            注：迷路不变量（可达/双向/环/死路/多最深点/入口=口）应全绿；选开阔水域（层状）时部分项
            天然为 ✗（层状图起点是同层多入口之一、入口非上浮口），这是正常对照。
          </div>
        </div>
      </div>
    </div>
  );
}
