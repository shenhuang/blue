// SonarMapView —— 声呐全图概览（dev 桶·2026-07-19 自 MapDevPanel 抽取；同日 MapDevPanel 删除·本组件接棒其可视化）
//
// 给一张 DiveMap + 其 zone，烤整图声呐底 + dev 专属节点/连边拓扑覆盖层：
//   - 洞穴（可回头 zone）→ buildCaveGeometry + bakeCaveRGBA；开阔水域 → buildOpenWaterGeometry + bakeOpenWaterRGBA。
//     与游戏内 SonarScanPanel 同一渲染函数＝单一来源、观感一致（只是整图全揭·无雾无扫）。
//   - 连边/节点字覆盖层是 dev 专属（游戏内声呐不画·只 dev 面板看拓扑）。
//
// 使用方：PlaytestPanel（潜点面板中栏预览）。将来别的 dev 面板要看整图声呐也从这里进＝烤图逻辑单点。
// 样式类（dev-map-cave-* / dev-cave-*）在 map-panel.css。

import { useMemo, useRef, useEffect } from 'react';
import './map-panel.css';
import { zoneAllowsBacktrack } from '@/engine/zones';
import { deriveMapLayout } from '../mapLayout';
import { buildCaveGeometry, bakeCaveRGBA } from '../SonarScanPanel';
import { buildOpenWaterGeometry, bakeOpenWaterRGBA, owFloorBottom } from '../openWaterRender';
import { SONAR_PX_PER_M, SONAR_COL_W, CAVE_GEOM_MARGIN } from '@/engine/sonarGeometry';
import type { DiveMap, DiveNode, ZoneDef } from '@/types';

/** 节点类型 → 单字标注（dev 专属中文 kind 字·游戏内只 ↑/○/⌂·守欺骗轴）。 */
export function kindGlyph(node: DiveNode, startId: string): string {
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
      // 穷尽断言：NodeKind 加成员 → typecheck 在此报（守 dev 标注不漏新 kind）。
      const _exhaustive: never = node.kind;
      return _exhaustive;
    }
  }
}

export interface SonarMapViewProps {
  map: DiveMap;
  zone: ZoneDef;
}

/**
 * 声呐全图 stack（canvas 底 + svg 覆盖层）。外层自行包 .dev-map-svg-wrap.dev-map-cave-wrap
 * （暗底+居中容器·各面板栏高不同故不内置）。
 */
export function SonarMapView({ map, zone }: SonarMapViewProps) {
  // 与玩家取景窗同一套布局比例（SONAR_PX_PER_M/COL_W）＝洞看起来和游戏里一致。
  const caveLayout = useMemo(
    () => deriveMapLayout(map, { pxPerMeter: SONAR_PX_PER_M, colW: SONAR_COL_W }),
    [map],
  );
  const isOpenWater = !zoneAllowsBacktrack(zone.id);

  // 声呐几何（二选一·互斥）：洞穴 → buildCaveGeometry；开阔水域 → buildOpenWaterGeometry。
  // 三层解耦后 buildCaveGeometry 本就整图恒完整（背景层不吃揭示）——dev 概览天然「全揭」。
  const caveGeom = useMemo(
    () => (caveLayout && !isOpenWater ? buildCaveGeometry(caveLayout) : null),
    [caveLayout, isOpenWater],
  );
  const owGeom = useMemo(
    () => (caveLayout && isOpenWater ? buildOpenWaterGeometry(caveLayout, zone, map) : null),
    [caveLayout, isOpenWater, zone, map],
  );

  // 声呐取景框（世界矩形·四周留 margin＝烤进固定画布时边缘不被裁）：
  //   洞穴：节点包围盒 ± CAVE_GEOM_MARGIN；开阔水域：下沿扩到海床之下（owFloorBottom）。
  const sonarRect = useMemo(() => {
    if (!caveLayout) return null;
    const x = -CAVE_GEOM_MARGIN;
    const y = -CAVE_GEOM_MARGIN;
    const w = caveLayout.width + 2 * CAVE_GEOM_MARGIN;
    if (owGeom) return { x, y, w, h: owFloorBottom(owGeom) - y };
    return { x, y, w, h: caveLayout.height + 2 * CAVE_GEOM_MARGIN };
  }, [caveLayout, owGeom]);

  const sonarCanvasRef = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const canvas = sonarCanvasRef.current;
    if (!canvas || !sonarRect || !(caveGeom || owGeom)) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    // 内部分辨率（0.75×·长边封顶防深图卡顿）；CSS 再放大到 sonarRect 尺寸＝与覆盖层对齐。
    const SCALE = 0.75;
    const CAP = 1200;
    let outW = Math.max(1, Math.round(sonarRect.w * SCALE));
    let outH = Math.max(1, Math.round(sonarRect.h * SCALE));
    if (outH > CAP) {
      outW = Math.max(1, Math.round((outW * CAP) / outH));
      outH = CAP;
    }
    canvas.width = outW;
    canvas.height = outH;
    const rgba = caveGeom
      ? bakeCaveRGBA(caveGeom, sonarRect, outW, outH)
      : bakeOpenWaterRGBA(owGeom!, sonarRect, outW, outH);
    const img = ctx.createImageData(outW, outH);
    img.data.set(rgba);
    ctx.putImageData(img, 0, 0);
  }, [sonarRect, caveGeom, owGeom]);

  if (!caveLayout || !sonarRect || !(caveGeom || owGeom)) return null;

  return (
    <div className="dev-map-cave-stack" style={{ width: sonarRect.w, height: sonarRect.h }}>
      <canvas ref={sonarCanvasRef} className="dev-map-cave-canvas" />
      <svg
        className="dev-map-cave-overlay"
        viewBox={`${sonarRect.x} ${sonarRect.y} ${sonarRect.w} ${sonarRect.h}`}
        width={sonarRect.w}
        height={sonarRect.h}
      >
        {/* 连边覆盖层（dev 专属·游戏内声呐不画）：实线=主干/青虚=回边(chord)。先画边、后画字＝字压边上可读。 */}
        {caveLayout.edges.map((e, i) => {
          const pa = caveLayout.pos[e.a];
          const pb = caveLayout.pos[e.b];
          if (!pa || !pb) return null;
          return (
            <line
              key={i}
              className={`dev-cave-edge ${e.chord ? 'is-chord' : ''}`}
              x1={pa.x}
              y1={pa.y}
              x2={pb.x}
              y2={pb.y}
            />
          );
        })}
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
  );
}
