// 海图取景窗（区域揭示主实装块·§10 Step 2）——独立的有界 pan/zoom，零声呐依赖（不复用 SonarScanPanel）。
// 作者 5 条规格：① 可缩放 ② 可拖拽 ③ 最 zoom-out ＝ fit 当前解锁内容 + 一圈余量（非无限大）
// ④ 最 zoom-in ＝ 锁回开始场景跨度 ⑤ pan 钳进随解锁外扩的世界边框、镜头永不越框、最 zoom-out 时不可拖。
//
// 取景窗**非正方**（作者 2026-06-13：海图不必正方·世界「越往右越远」更适合横向；填满面板宽＝C7 对齐）。
// 关键：内容是各向同性的（圈要圆）——故 .chart-world 仍是**正方**层（width 100% → 边长＝框宽 W·aspect 1/1），
// 用 translate+scale 把它塞进非方框（overflow 裁掉超出的下半 / 两侧）；世界层的边沿因此落在框外＝看不到「世界矩阵的端点」。
// 变换（origin 0 0·layer 为 W×W 正方）：
//   translate(-vlx/spanX*100%, -vty/spanX*100%) scale(1/spanX)   （vlx=cx-spanX/2·vty=cy-spanY/2·spanY=spanX·H/W）
// 取景矩形 aspect ＝ 框 aspect（spanY=spanX·H/W）⇒ 各向同性、无椭圆畸变、铺满框（守 quirk #112）。

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type CSSProperties } from 'react';

// SSR 安全的 layout effect：client 用 useLayoutEffect（首帧前量框、避免闪烁），
// server（react-dom/server·smoke-chart-ui）用 useEffect 占位——后者在服务端根本不跑，
// 故不会触发「useLayoutEffect does nothing on the server」警告（区域揭示配置化 SPEC §6）。
const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

/** 解锁内容外扩的「一圈」余量（占 fit 跨度比例·§10 规格③「稍微大一圈」）。小＝贴合内容、少露空水域。 */
const RING = 0.06;
/** 缩放步进（滚轮一格 / 按钮一下）。 */
const ZOOM_STEP = 1.2;
/** 拖动判定阈值（px）：超过才算 pan、否则放行点击（防吞 POI 点击·沿声呐 pan/zoom 先例 quirk #112）。 */
const DRAG_THRESHOLD = 4;
/**
 * 触点命中半径（屏幕像素·恒定，不随 zoom 缩放）：点击/触摸落点在此半径内的候选标记中，
 * 取世界坐标距离最近的一个命中——不再依赖原生 DOM 层叠顺序（谁后画谁挡住谁）。
 * 超出半径＝落空（放行成"点在空水域"，不强行认领很远的点）。约等于 POI 标记 padding 命中盒的半宽（见 styles.css .chart-map-poi）。
 */
const TAP_HIT_RADIUS_PX = 20;

export interface ChartContentBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** 海图可点标记（POI / 灯塔 / 前哨）的命中目标：世界坐标 + 命中回调。由 SeaChartView 按当前渲染的标记构建。 */
export interface ChartHitTarget {
  id: string;
  x: number;
  y: number;
  onSelect: () => void;
}

/** 取景：中心 + 横向世界跨度 spanX（纵向跨度 spanY=spanX·H/W 由框 aspect 派生·保各向同性）。 */
interface View {
  cx: number;
  cy: number;
  spanX: number;
}

interface Props {
  /** 世界内容包围盒（归一化·随解锁外扩·建议传 POI/灯塔中心而非含巨大揭示半径——让圈铺出框、不撑出空水域）。 */
  contentBox: ChartContentBox;
  /** 最小横向可视跨度（最 zoom-in·＝开始场景跨度·世界单位）。 */
  minSpan: number;
  /** 解锁签名：变化＝世界边界变了 → 自动 fit 到新边界（autozoom·组合形态）；不变则不打扰当前取景。 */
  fitKey?: string;
  /**
   * 可点标记命中目标（POI/灯塔/前哨·世界坐标）：点击/触摸抬起时若未越过拖动阈值（真是"点"而非"拖"），
   * 按屏幕像素半径 TAP_HIT_RADIUS_PX 换算成当前 zoom 下的世界半径，取半径内世界距离最近的一个调用其 onSelect。
   * 标记按钮本身应设 `pointer-events:none`（见 styles.css），把鼠标/触摸命中全交给这条路径——
   * 键盘 Tab/Enter 走各按钮自身 onClick，不经过这里、不受影响。缺省 []：不接线时行为等同旧版原生点击透传。
   */
  hitTargets?: ChartHitTarget[];
  children: ReactNode;
}

export function ChartViewport({ contentBox, minSpan, fitKey, hitTargets, children }: Props) {
  const surfRef = useRef<HTMLDivElement>(null);
  // 框像素尺寸（算 aspect H/W + 把拖拽像素换成世界单位）。首帧未量到 → 用 16:10 占位，量到即校正。
  const [size, setSize] = useState({ w: 16, h: 10 });
  useIsomorphicLayoutEffect(() => {
    const el = surfRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) setSize({ w: r.width, h: r.height });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const aspect = size.h / size.w; // H/W：spanY = spanX·aspect

  // fit：贴合 contentBox（含一圈余量），按框 aspect 取景——「contain」使内容全可见，纵横皆不裁。
  const cw = Math.max(1e-3, contentBox.maxX - contentBox.minX);
  const ch = Math.max(1e-3, contentBox.maxY - contentBox.minY);
  const fitCx = (contentBox.minX + contentBox.maxX) / 2;
  const fitCy = (contentBox.minY + contentBox.maxY) / 2;
  // 要让 contentBox 全进框：spanX≥cw 且 spanY=spanX·aspect≥ch → spanX≥ch/aspect。取大者 + 一圈。
  const spanXFit = Math.min(2, Math.max(cw, ch / Math.max(aspect, 1e-3)) * (1 + RING));
  const spanXMin = Math.min(minSpan, spanXFit); // 世界比开始场景还小（早期）→ 无可缩放空间

  // 取景钳制：spanX∈[min,fit]；取景矩形 ⊆ fit 边框（镜头永不越框）。spanX==fit 时上下界重合＝钉死＝不可拖。
  const clamp = useCallback(
    (v: View): View => {
      const spanX = Math.max(spanXMin, Math.min(spanXFit, v.spanX));
      const spanY = spanX * aspect;
      const spanYFit = spanXFit * aspect;
      const halfX = spanX / 2;
      const halfY = spanY / 2;
      const loX = fitCx - spanXFit / 2 + halfX;
      const hiX = fitCx + spanXFit / 2 - halfX;
      const loY = fitCy - spanYFit / 2 + halfY;
      const hiY = fitCy + spanYFit / 2 - halfY;
      return {
        spanX,
        cx: loX > hiX ? fitCx : Math.max(loX, Math.min(hiX, v.cx)),
        cy: loY > hiY ? fitCy : Math.max(loY, Math.min(hiY, v.cy)),
      };
    },
    [aspect, fitCx, fitCy, spanXFit, spanXMin],
  );

  const [view, setView] = useState<View>(() => ({ cx: fitCx, cy: fitCy, spanX: spanXFit }));
  const viewRef = useRef(view);
  useIsomorphicLayoutEffect(() => {
    viewRef.current = view;
  }, [view]);

  // 解锁 → 世界边界变 → autozoom 到新边界全览。
  useEffect(() => {
    setView({ cx: fitCx, cy: fitCy, spanX: spanXFit });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey]);

  // —— 缩放（围绕给定锚点·默认中心；滚轮传光标归一位）——
  const zoomAt = useCallback(
    (factor: number, ox = 0.5, oy = 0.5) => {
      setView((v) => {
        const spanX = Math.max(spanXMin, Math.min(spanXFit, v.spanX / factor));
        if (spanX === v.spanX) return v;
        const spanYOld = v.spanX * aspect;
        const spanYNew = spanX * aspect;
        // 保持锚点下的世界点不动（x 用 spanX·y 用 spanY）。
        const wx = v.cx - v.spanX / 2 + ox * v.spanX;
        const wy = v.cy - spanYOld / 2 + oy * spanYOld;
        return clamp({ cx: wx - (ox - 0.5) * spanX, cy: wy - (oy - 0.5) * spanYNew, spanX });
      });
    },
    [clamp, aspect, spanXFit, spanXMin],
  );

  // 滚轮：native 监听（{passive:false} 才能 preventDefault·防页面滚动）。
  useEffect(() => {
    const el = surfRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (spanXMin >= spanXFit) return; // 无缩放空间
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomAt(e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP, (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAt, spanXMin, spanXFit]);

  // —— 拖拽（过阈值才捕获指针·防吞 POI 点击）——
  const drag = useRef<{ x: number; y: number; cx: number; cy: number; active: boolean } | null>(null);
  const onPointerDown = useCallback((e: React.PointerEvent) => {
    const v = viewRef.current;
    drag.current = { x: e.clientX, y: e.clientY, cx: v.cx, cy: v.cy, active: false };
  }, []);
  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const d = drag.current;
      const r = surfRef.current?.getBoundingClientRect();
      if (!d || !r) return;
      const dxPx = e.clientX - d.x;
      const dyPx = e.clientY - d.y;
      if (!d.active && Math.hypot(dxPx, dyPx) < DRAG_THRESHOLD) return; // 未过阈值＝放行点击
      if (!d.active) {
        d.active = true;
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      }
      // 世界/像素：横向 spanX/W；纵向同比例（各向同性·spanY/H = spanX/W）。
      const worldPerPx = viewRef.current.spanX / r.width;
      setView((v) => clamp({ cx: d.cx - dxPx * worldPerPx, cy: d.cy - dyPx * worldPerPx, spanX: v.spanX }));
    },
    [clamp],
  );
  // 命中分发（容器拦截+最近距离·quirk #215）：抬指针时若这轮交互始终没越过 DRAG_THRESHOLD（真是"点"），
  // 把落点换算成世界坐标，在 hitTargets 里取 TAP_HIT_RADIUS_PX 半径内世界距离最近的一个调用 onSelect——
  // 不再依赖标记按钮的原生 DOM 层叠命中（谁后画谁挡住谁·海图 POI 密集处的遮挡问题）。
  const endDrag = useCallback(
    (e: React.PointerEvent) => {
      const wasTap = !!drag.current && !drag.current.active;
      if (drag.current?.active) {
        try {
          (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
        } catch {
          /* 指针已释放·忽略 */
        }
      }
      drag.current = null;
      if (wasTap && hitTargets && hitTargets.length > 0) {
        const r = surfRef.current?.getBoundingClientRect();
        if (r && r.width > 0 && r.height > 0) {
          const v = viewRef.current;
          const spanYNow = v.spanX * aspect;
          const worldX = v.cx - v.spanX / 2 + ((e.clientX - r.left) / r.width) * v.spanX;
          const worldY = v.cy - spanYNow / 2 + ((e.clientY - r.top) / r.height) * spanYNow;
          const radiusWorld = (TAP_HIT_RADIUS_PX / r.width) * v.spanX; // px→世界·按当前 zoom（各向同性，横纵同比例）
          let best: ChartHitTarget | null = null;
          let bestD = Infinity;
          for (const t of hitTargets) {
            const d = Math.hypot(t.x - worldX, t.y - worldY);
            if (d <= radiusWorld && d < bestD) {
              bestD = d;
              best = t;
            }
          }
          best?.onSelect();
        }
      }
    },
    [hitTargets, aspect],
  );

  const spanY = view.spanX * aspect;
  const vlx = view.cx - view.spanX / 2;
  const vty = view.cy - spanY / 2;
  // layer 为 W×W 正方：x/y 的 % 都按 W 解析，故 y 也除 spanX（推导见文件头）。scale 各向同性 = 1/spanX。
  const transform = `translate(${(-vlx / view.spanX) * 100}%, ${(-vty / view.spanX) * 100}%) scale(${1 / view.spanX})`;
  const canZoom = spanXMin < spanXFit;
  const atFit = view.spanX >= spanXFit - 1e-6;

  return (
    <div className="chart-viewport">
      <div
        ref={surfRef}
        className={`chart-viewport-surface${atFit ? ' at-fit' : ''}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerLeave={endDrag}
      >
        {/* --chart-cscale=spanX：标记/文字用 scale(var(--chart-cscale)) 抵消本层 1/spanX 缩放 → 恒定屏幕大小、不随 zoom 放大（作者反馈·#131 续）。揭示圈不取它＝仍随 world 缩放。 */}
        <div
          className="chart-world"
          style={{ transform, transformOrigin: '0 0', '--chart-cscale': view.spanX } as CSSProperties}
        >
          {children}
        </div>
        {canZoom && (
          <div className="chart-zoom-controls" onPointerDown={(e) => e.stopPropagation()}>
            <button type="button" className="chart-zoom-btn" aria-label="放大" onClick={() => zoomAt(ZOOM_STEP)}>
              ＋
            </button>
            <button type="button" className="chart-zoom-btn" aria-label="缩小" onClick={() => zoomAt(1 / ZOOM_STEP)}>
              －
            </button>
            <button
              type="button"
              className="chart-zoom-btn"
              aria-label="全览"
              disabled={atFit}
              onClick={() => setView(clamp({ cx: fitCx, cy: fitCy, spanX: spanXFit }))}
            >
              ⤢
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
