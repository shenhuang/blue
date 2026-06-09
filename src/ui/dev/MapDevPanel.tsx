// MapDevPanel —— 地图调试器 dev 面板（仅 import.meta.env.DEV 下挂载）
//
// 目的：可视化迭代迷路 mapgen 的布局，不用反复编译跑 playthrough。
//   左栏：zone / seed / depthOffset 控制 + 结构读数（analyzeMap 的全部性质，按迷路不变量着色）
//   右栏：节点图 SVG —— 按 layer(到入口的树距) 分列，连边，按 kind 配色，标注最深点 / 死路 / 回边
//
// 设计（沿用 quirk #23/#24 套路，与 Event/Combat 面板一致）：
//   - 所有计算走 engine：generateDiveMap + analyzeMap，绝不在 UI 里复刻拓扑逻辑
//   - 不写新 GamePhase；devPanel 开关只在 App.tsx 顶层 useState 里管（DevPanelKind 加 'map'）
//   - 只读 import.meta.env.DEV；prod build 时 App.tsx 的 lazy + DEV 守卫让本文件不进 bundle
//   - seeded LCG 与 scripts/playthrough-*.ts 同算法，seed 与回归脚本对得上
//
// 详见 docs/STATUS.md「真'迷路' mapgen」+「地图调试器 dev 面板」。

import { useMemo, useState, useRef, useEffect } from 'react';
import './map-panel.css';
import { generateDiveMap, analyzeMap } from '@/engine/mapgen';
import { ZONES, zoneAllowsBacktrack } from '@/engine/zones';
import { makeLcg } from '@/engine/rng';
import { deriveMapLayout } from '../mapLayout';
import { buildCaveGeometry, bakeCaveRGBA, SONAR_PX_PER_M, SONAR_COL_W } from '../SonarScanPanel';
import type { DiveMap, DiveNode, ZoneDef } from '@/types';

export interface MapDevPanelProps {
  onClose: () => void;
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
    default:
      return 'dev-map-fill-event';
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
    default:
      return '?';
  }
}

export function MapDevPanel({ onClose }: MapDevPanelProps) {
  const randomZones = useMemo<ZoneDef[]>(
    () => [...ZONES.values()].filter((z) => z.generation === 'random'),
    [],
  );
  const [zoneId, setZoneId] = useState<string>(
    randomZones.find((z) => z.mapShape === 'maze')?.id ?? randomZones[0]?.id ?? '',
  );
  const [seed, setSeed] = useState<number>(1);
  const [depthOffset, setDepthOffset] = useState<number>(0);
  // 右栏视图：节点图（schematic·结构调试）↔ 声呐洞穴（cave·玩家有机洞穴·整图全揭）。
  const [view, setView] = useState<'schematic' | 'cave'>('schematic');

  const zone = ZONES.get(zoneId);

  const map: DiveMap | null = useMemo(() => {
    if (!zone) return null;
    return generateDiveMap({
      zone,
      profileFlags: FLAGS,
      deaths: [],
      rng: makeLcg(seed),
      depthOffset,
    });
  }, [zone, seed, depthOffset]);

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
  const caveGeom = useMemo(() => {
    if (!map || !caveLayout || isOpenWater) return null;
    const ids = Object.keys(map.nodes);
    const mem: Record<string, number> = {};
    for (const id of ids) mem[id] = 0; // 全揭示＝看整张洞（dev 概览·非玩家渐进揭示）
    return buildCaveGeometry(caveLayout, ids, mem);
  }, [map, caveLayout, isOpenWater]);

  const caveCanvasRef = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    if (view !== 'cave') return;
    const canvas = caveCanvasRef.current;
    if (!canvas || !caveLayout || !caveGeom) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    // 内部分辨率（0.75×·长边封顶防深图卡顿）；CSS 再放大到布局尺寸＝与节点覆盖层对齐。
    const SCALE = 0.75;
    const CAP = 1200;
    let ow = Math.max(1, Math.round(caveLayout.width * SCALE));
    let oh = Math.max(1, Math.round(caveLayout.height * SCALE));
    if (oh > CAP) {
      ow = Math.max(1, Math.round((ow * CAP) / oh));
      oh = CAP;
    }
    canvas.width = ow;
    canvas.height = oh;
    const rgba = bakeCaveRGBA(caveGeom, { x: 0, y: 0, w: caveLayout.width, h: caveLayout.height }, ow, oh);
    const img = ctx.createImageData(ow, oh);
    img.data.set(rgba);
    ctx.putImageData(img, 0, 0);
  }, [view, caveLayout, caveGeom]);

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
            generateDiveMap + analyzeMap · seed 与回归脚本同 LCG · Shift+M 切换 / Esc 关闭
          </div>
        </div>
        <div className="dev-panel-header-actions">
          <button className="dev-btn" onClick={() => setSeed((s) => s + 1)}>
            seed +1
          </button>
          <button className="dev-btn" onClick={() => setSeed(Math.floor(Math.random() * 1_000_000))}>
            🎲 随机 seed
          </button>
          <button className="dev-btn dev-btn-quiet" onClick={onClose}>
            关闭 ✕
          </button>
        </div>
      </div>

      <div className="dev-panel-body dev-map-body">
        {/* 左：控制 + 读数 */}
        <div className="dev-col dev-col-form">
          <h3 className="dev-col-title">生成参数</h3>
          <div className="dev-section">
            <div className="dev-stack">
              <span>ZONE</span>
              <select className="dev-input" value={zoneId} onChange={(e) => setZoneId(e.target.value)}>
                {randomZones.map((z) => (
                  <option key={z.id} value={z.id}>
                    {z.name} · {z.mapShape ?? 'layered'}
                    {z.canFreeAscend === false ? ' · 封闭' : ''}
                  </option>
                ))}
              </select>
            </div>
            <div className="dev-row">
              <label className="dev-inline">
                <span>SEED</span>
                <input
                  className="dev-input dev-input-num"
                  type="number"
                  value={seed}
                  onChange={(e) => setSeed(Number(e.target.value) || 0)}
                />
              </label>
              <label className="dev-inline">
                <span>ΔDEPTH</span>
                <input
                  className="dev-input dev-input-num"
                  type="number"
                  value={depthOffset}
                  onChange={(e) => setDepthOffset(Number(e.target.value) || 0)}
                />
              </label>
            </div>
            {zone && (
              <div className="dev-faint" style={{ marginTop: 6 }}>
                depthRange {zone.depthRange[0]}–{zone.depthRange[1]}m
                {depthOffset ? ` (偏移后 ${zone.depthRange[0] + depthOffset}–${zone.depthRange[1] + depthOffset}m)` : ''}
                {' · '}layerCount {zone.layerCount}
              </div>
            )}
          </div>

          <h3 className="dev-col-title">结构读数 · analyzeMap</h3>
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
            </div>
          )}
          <div className="dev-faint">
            注：迷路不变量（可达/双向/环/死路/多最深点/入口=口）应全绿；选层状 zone 时部分项天然为
            ✗（层状图起点是同层多入口之一、入口非上浮口），这是正常对照。
          </div>
        </div>

        {/* 右：图 */}
        <div className="dev-col dev-map-canvas-col">
          <h3 className="dev-col-title dev-map-canvas-title">
            <span>
              {view === 'schematic' ? '节点图' : '声呐洞穴'} · {map?.zoneId}{' '}
              <span className="dev-faint">
                {view === 'schematic' ? '（列 = 到入口的树距 layer）' : '（整图全揭·与游戏内同一渲染·确定性）'}
              </span>
            </span>
            <span className="dev-view-toggle">
              <button
                className={`dev-btn dev-view-btn ${view === 'schematic' ? 'is-active' : ''}`}
                onClick={() => setView('schematic')}
              >
                节点图
              </button>
              <button
                className={`dev-btn dev-view-btn ${view === 'cave' ? 'is-active' : ''}`}
                onClick={() => setView('cave')}
              >
                声呐洞穴
              </button>
            </span>
          </h3>
          {view === 'schematic' ? (
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
            {isOpenWater ? (
              <div className="dev-map-cave-empty">
                这是<b>开阔水域</b>（层状·非洞穴）——声呐图里没有洞壁可循，只有黑暗里的接触。
                选 mapShape = maze 的 zone（如蓝洞群「迷路」）看有机洞穴剖面。
              </div>
            ) : (
              map &&
              caveLayout &&
              caveGeom && (
                <div
                  className="dev-map-cave-stack"
                  style={{ width: caveLayout.width, height: caveLayout.height }}
                >
                  <canvas ref={caveCanvasRef} className="dev-map-cave-canvas" />
                  <svg
                    className="dev-map-cave-overlay"
                    viewBox={`0 0 ${caveLayout.width} ${caveLayout.height}`}
                    width={caveLayout.width}
                    height={caveLayout.height}
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
              )
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
      </div>
    </div>
  );
}
