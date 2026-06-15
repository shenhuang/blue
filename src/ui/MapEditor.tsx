// 海图编辑器（dev 工具·?editor 进入·与 SeaChartView/游戏完全解耦）。
// 拖 beacon（owned POI 整簇跟随）/ 拖 POI（重算相对偏移·超出 owner radius 标红）/ 调 owner radius；
// 滚轮缩放 + 背景拖拽平移（拖得更远/放更大）；海岸线(x=0)参考 + 不许拖进陆地(x<0)；
// 「保存进项目」直接写回 src/data/*.json（dev 中间件·见 vite.config.ts），或「导出」复制粘贴。
//
// 数据模型（owner-anchored·#135）：POI.mapX/mapY 是**相对 owner 声明坐标的偏移**；beacon 声明坐标全在
// lighthouse_upgrades.json（家=home·前哨/废墟=result）；owner radius 在 chart_regions.json。编辑器读这三份
// 原始 JSON、在内存改、保存/导出新 JSON。owner 全局唯一·跨章节按 mapId 分段。海岸线在世界 x=0（左侧为陆地）。
//
// 可扩展：beacon/POI 都是带 source 路径的列表，将来加「建 beacon（配升级表）」「编后续章节」只在此加面板。

import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import regionsJson from '@/data/chart_regions.json';
import lighthouseJson from '@/data/lighthouse_upgrades.json';
import poisJson from '@/data/chart_pois.json';

// ── 宽松本地类型（编辑器容忍原始 JSON 形状·只关心位置/半径/owner）──────────────
type Vec = { mapX: number; mapY: number };
interface RegionDef {
  id: string; label: string; owner?: string; revealFlag?: string;
  center?: { x: number; y: number }; palette: string; shape: string; radius: number;
}
type RegionsFile = Record<string, { regions: RegionDef[] } | string>;
interface BeaconDef { id: string; name: string; mapX: number; mapY: number; level?: number }
interface LhFile {
  home?: BeaconDef;
  outposts?: { result: BeaconDef; [k: string]: unknown }[];
  ruins?: { result: BeaconDef; [k: string]: unknown }[];
  [k: string]: unknown;
}
interface PoiDef {
  id?: string; templateId?: string; owner?: string; absolute?: boolean;
  name?: string; mapX?: number; mapY?: number; story?: unknown; [k: string]: unknown;
}
type PoisFile = Record<string, { anchors: PoiDef[]; roamingTemplates: PoiDef[] } | string>;

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const isSeg = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const PALETTE_HEX: Record<string, string> = {
  cyan: '#3cc7d6', green: '#5fae6b', blue: '#4f78d6', amber: '#d6a23c', navy: '#3a52a8', violet: '#9b6bd6', ruin: '#a07a55',
};
const VIEW = 1000; // viewBox 边长（正方·保持圆是圆）
const DATA_FILES = {
  pois: 'src/data/chart_pois.json',
  regions: 'src/data/chart_regions.json',
  lighthouses: 'src/data/lighthouse_upgrades.json',
};

type Sel = { kind: 'beacon' | 'poi' | 'radius' | 'center'; id: string } | null;
interface ViewBox { x: number; y: number; w: number } // world 单位视口（正方·height=w）

export default function MapEditor() {
  const [regionsFile, setRegionsFile] = useState<RegionsFile>(() => clone(regionsJson as unknown as RegionsFile));
  const [lhFile, setLhFile] = useState<LhFile>(() => clone(lighthouseJson as unknown as LhFile));
  const [poisFile, setPoisFile] = useState<PoisFile>(() => clone(poisJson as unknown as PoisFile));
  const mapIds = useMemo(() => Object.keys(regionsFile).filter((k) => !k.startsWith('_') && isSeg(regionsFile[k])), [regionsFile]);
  const [mapId, setMapId] = useState<string>(mapIds[0] ?? 'ch1');
  const [sel, setSel] = useState<Sel>(null);
  const [view, setView] = useState<ViewBox>({ x: -0.12, y: -0.06, w: 1.28 }); // 默认含海岸左侧 + [0,1] + 右侧余量
  const [saveMsg, setSaveMsg] = useState('');
  const [showExport, setShowExport] = useState(false);
  const [history, setHistory] = useState<{ pois: PoisFile; regions: RegionsFile; lh: LhFile }[]>([]);
  const [regress, setRegress] = useState<{ running: boolean; ok?: boolean; output?: string } | null>(null);
  const drag = useRef<Sel>(null);
  const panRef = useRef<{ cx: number; cy: number; vx: number; vy: number; w: number } | null>(null);
  const viewRef = useRef(view); viewRef.current = view;
  const svgRef = useRef<SVGSVGElement | null>(null);

  // ── 当前地图派生模型 ───────────────────────────────────────────────────────
  const regions: RegionDef[] = isSeg(regionsFile[mapId]) ? ((regionsFile[mapId] as { regions: RegionDef[] }).regions ?? []) : [];
  function ownerPos(owner: string): Vec | undefined {
    if (lhFile.home && lhFile.home.id === owner) return lhFile.home;
    const o = lhFile.outposts?.find((x) => x.result.id === owner);
    if (o) return o.result;
    const ru = lhFile.ruins?.find((x) => x.result.id === owner);
    return ru?.result;
  }
  const beacons = regions
    .filter((rg) => rg.owner)
    .map((rg) => ({ region: rg, pos: ownerPos(rg.owner!) }))
    .filter((b): b is { region: RegionDef; pos: Vec } => !!b.pos);
  const flagGated = regions.filter((rg) => rg.revealFlag && rg.center);
  const poiSeg = isSeg(poisFile[mapId]) ? (poisFile[mapId] as { anchors: PoiDef[]; roamingTemplates: PoiDef[] }) : { anchors: [], roamingTemplates: [] };
  const pois = [
    ...poiSeg.anchors.map((p) => ({ poi: p, roaming: false })),
    ...poiSeg.roamingTemplates.map((p) => ({ poi: p, roaming: true })),
  ].map(({ poi, roaming }) => {
    const id = poi.id ?? poi.templateId ?? '?';
    const base = poi.owner ? ownerPos(poi.owner) : undefined;
    const abs: Vec = poi.absolute || !base ? { mapX: poi.mapX ?? 0, mapY: poi.mapY ?? 0 } : { mapX: base.mapX + (poi.mapX ?? 0), mapY: base.mapY + (poi.mapY ?? 0) };
    const offMag = Math.hypot(poi.mapX ?? 0, poi.mapY ?? 0);
    const ownerRadius = poi.owner ? regions.find((rg) => rg.owner === poi.owner)?.radius : undefined;
    const outside = ownerRadius !== undefined && offMag > ownerRadius + 1e-9;
    const kind = poi.story ? 'story' : roaming ? 'roaming' : 'anchor';
    return { id, poi, abs, kind, outside };
  });

  // ── world ↔ 像素（含 zoom/pan）─────────────────────────────────────────────
  const scale = VIEW / view.w;
  const sx = (wx: number) => (wx - view.x) * scale;
  const sy = (wy: number) => (wy - view.y) * scale;
  function worldFromClient(cx: number, cy: number): Vec {
    const svg = svgRef.current;
    if (!svg) return { mapX: 0, mapY: 0 };
    const rect = svg.getBoundingClientRect();
    const v = viewRef.current;
    return { mapX: v.x + ((cx - rect.left) / rect.width) * v.w, mapY: v.y + ((cy - rect.top) / rect.height) * v.w };
  }

  // 滚轮缩放（非 passive·绕指针）
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = svg.getBoundingClientRect();
      const fx = (e.clientX - rect.left) / rect.width, fy = (e.clientY - rect.top) / rect.height;
      setView((v) => {
        const wx = v.x + fx * v.w, wy = v.y + fy * v.w;
        const nw = Math.min(8, Math.max(0.12, v.w * (e.deltaY > 0 ? 1.12 : 1 / 1.12))); // 缩到 8＝可俯瞰拖很远的点（世界右/上下无限·左有界）
        return { w: nw, x: wx - fx * nw, y: wy - fy * nw };
      });
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, []);

  function fitView() {
    let minX = 0, minY = 0, maxX = 1, maxY = 1; // 总是含 [0,1] 标准框
    const ext = (x: number, y: number) => { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); };
    beacons.forEach((b) => { ext(b.pos.mapX - b.region.radius, b.pos.mapY - b.region.radius); ext(b.pos.mapX + b.region.radius, b.pos.mapY + b.region.radius); });
    flagGated.forEach((rg) => { ext(rg.center!.x - rg.radius, rg.center!.y - rg.radius); ext(rg.center!.x + rg.radius, rg.center!.y + rg.radius); });
    pois.forEach((p) => ext(p.abs.mapX, p.abs.mapY));
    const m = 0.08;
    setView({ x: minX - m, y: minY - m, w: Math.max(maxX - minX, maxY - minY) + 2 * m });
  }

  // ── 拖拽（元素）+ 平移（背景）─────────────────────────────────────────────
  function applyDrag(n: Vec) {
    const d = drag.current;
    if (!d) return;
    const wx = Math.max(0, n.mapX); // 海岸线 x=0·不许拖进陆地（point 2）
    const wy = n.mapY;              // y 不硬钳·允许拖出 [0,1]（point 3：farther）
    if (d.kind === 'beacon') {
      setLhFile((prev) => {
        const next = clone(prev);
        const set = (b?: BeaconDef) => { if (b && b.id === d.id) { b.mapX = r3(wx); b.mapY = r3(wy); } };
        set(next.home); next.outposts?.forEach((o) => set(o.result)); next.ruins?.forEach((ru) => set(ru.result));
        return next;
      });
    } else if (d.kind === 'poi') {
      setPoisFile((prev) => {
        const next = clone(prev); const seg = next[mapId];
        if (!isSeg(seg)) return next;
        const list = [...((seg as { anchors: PoiDef[] }).anchors ?? []), ...((seg as { roamingTemplates: PoiDef[] }).roamingTemplates ?? [])];
        const p = list.find((x) => (x.id ?? x.templateId) === d.id);
        if (p) {
          if (p.absolute || !p.owner) { p.mapX = r3(wx); p.mapY = r3(wy); }
          else { const base = ownerPos(p.owner); if (base) { p.mapX = r3(wx - base.mapX); p.mapY = r3(wy - base.mapY); } }
        }
        return next;
      });
    } else if (d.kind === 'radius') {
      setRegionsFile((prev) => {
        const next = clone(prev); const seg = next[mapId];
        if (!isSeg(seg)) return next;
        const rg = (seg as { regions: RegionDef[] }).regions.find((x) => x.id === d.id);
        const c = rg?.owner ? ownerPos(rg.owner) : rg?.center ? { mapX: rg.center.x, mapY: rg.center.y } : undefined;
        if (rg && c) rg.radius = Math.max(0.02, r3(Math.hypot(n.mapX - c.mapX, n.mapY - c.mapY)));
        return next;
      });
    } else if (d.kind === 'center') {
      setRegionsFile((prev) => {
        const next = clone(prev); const seg = next[mapId];
        if (!isSeg(seg)) return next;
        const rg = (seg as { regions: RegionDef[] }).regions.find((x) => x.id === d.id);
        if (rg && rg.center) { rg.center.x = r3(wx); rg.center.y = r3(wy); }
        return next;
      });
    }
  }
  function startDrag(d: NonNullable<Sel>, e: ReactPointerEvent) {
    e.stopPropagation();
    pushHistory(); // 拖拽起手快照一次 → 一次拖拽 = 一步撤销
    drag.current = d;
    setSel(d.kind === 'radius' || d.kind === 'center' ? { kind: 'beacon', id: d.id } : d);
    const move = (ev: PointerEvent) => applyDrag(worldFromClient(ev.clientX, ev.clientY));
    const up = () => { drag.current = null; window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  }
  function startPan(e: ReactPointerEvent) {
    if (e.target !== svgRef.current) return; // 只在背景空白处起平移
    setSel(null);
    const v = viewRef.current;
    panRef.current = { cx: e.clientX, cy: e.clientY, vx: v.x, vy: v.y, w: v.w };
    const move = (ev: PointerEvent) => {
      const p = panRef.current, svg = svgRef.current;
      if (!p || !svg) return;
      const rect = svg.getBoundingClientRect();
      setView((cur) => ({ ...cur, x: p.vx - ((ev.clientX - p.cx) / rect.width) * p.w, y: p.vy - ((ev.clientY - p.cy) / rect.height) * p.w }));
    };
    const up = () => { panRef.current = null; window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  }

  // ── 保存 / 导出 ────────────────────────────────────────────────────────────
  const fileTexts = useMemo(() => ({
    [DATA_FILES.pois]: JSON.stringify(poisFile, null, 2) + '\n',
    [DATA_FILES.regions]: JSON.stringify(regionsFile, null, 2) + '\n',
    [DATA_FILES.lighthouses]: JSON.stringify(lhFile, null, 2) + '\n',
  }), [poisFile, regionsFile, lhFile]);

  // 撤销栈：每次交互起手 pushHistory 一次（拖拽 / 滑杆）→ 撤销回退一步。
  function pushHistory() {
    setHistory((h) => [...h.slice(-49), { pois: clone(poisFile), regions: clone(regionsFile), lh: clone(lhFile) }]);
  }
  function undo() {
    setHistory((h) => {
      if (!h.length) return h;
      const prev = h[h.length - 1];
      setPoisFile(prev.pois); setRegionsFile(prev.regions); setLhFile(prev.lh); setSel(null);
      return h.slice(0, -1);
    });
  }

  async function saveToProject() {
    setSaveMsg('保存中…');
    try {
      const res = await fetch('/__save_chart', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ files: fileTexts }) });
      if (!(res.headers.get('content-type') || '').includes('application/json')) {
        setSaveMsg('保存端点未生效——dev 中间件没加载（多半 vite.config.js 过时盖住了 .ts·重启 npm run dev 即可）。');
        setTimeout(() => setSaveMsg(''), 8000);
        return;
      }
      const j = (await res.json()) as { ok: boolean; written?: string[]; error?: string };
      setSaveMsg(j.ok ? `已保存 ${j.written?.length ?? 0} 个文件 ✓（HMR 自动刷新）` : `保存失败：${j.error}`);
    } catch (e) {
      setSaveMsg('保存失败——需在 npm run dev 下。' + String(e));
    }
    setTimeout(() => setSaveMsg(''), 6000);
  }

  async function runRegress() {
    setRegress({ running: true });
    try {
      const res = await fetch('/__run_regress', { method: 'POST' });
      if (!(res.headers.get('content-type') || '').includes('application/json')) {
        setRegress({ running: false, ok: false, output: '回归端点未生效——dev 中间件没加载（重启 npm run dev）。' });
        return;
      }
      const j = (await res.json()) as { ok: boolean; output?: string; error?: string };
      setRegress({ running: false, ok: j.ok, output: j.output ?? j.error ?? '' });
    } catch (e) {
      setRegress({ running: false, ok: false, output: '跑回归失败——需在 npm run dev 下。' + String(e) });
    }
  }

  function resetAll() {
    setRegionsFile(clone(regionsJson as unknown as RegionsFile));
    setLhFile(clone(lighthouseJson as unknown as LhFile));
    setPoisFile(clone(poisJson as unknown as PoisFile));
    setHistory([]); // 重置＝回到磁盘原始值 + 撤销栈归零（重置后没有可撤销的东西）
    setSel(null);
  }

  const palOf = (p: string) => PALETTE_HEX[p] ?? '#888';
  const selPoi = sel?.kind === 'poi' ? pois.find((p) => p.id === sel.id) : null;
  const selBeacon = sel?.kind === 'beacon' ? beacons.find((b) => b.region.owner === sel.id) : null;
  const outsidePois = pois.filter((p) => p.outside);
  const landW = Math.max(0, sx(0)); // 海岸左侧陆地宽（像素）

  return (
    <div style={{ display: 'flex', height: '100vh', background: '#0a1014', color: '#cfe3e8', font: '13px/1.5 system-ui, sans-serif' }}>
      <div style={{ flex: '1 1 auto', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, minWidth: 0 }}>
        <svg
          ref={svgRef} viewBox={`0 0 ${VIEW} ${VIEW}`} onPointerDown={startPan}
          style={{ width: 'min(92vh, 100%)', aspectRatio: '1 / 1', background: '#0d171d', border: '1px solid #1d2d36', borderRadius: 8, touchAction: 'none', cursor: 'grab' }}
        >
          {/* 陆地（x<0·海岸左侧）+ 海岸线（x=0）*/}
          {landW > 0 && <rect x={0} y={0} width={landW} height={VIEW} fill="#10241a" />}
          <line x1={sx(0)} y1={0} x2={sx(0)} y2={VIEW} stroke="#3f7a55" strokeWidth={2.5} />
          <text x={sx(0) - 6} y={26} textAnchor="end" fill="#4f8a66" fontSize={13}>陆地</text>
          {/* [0,1] 标准世界框（参考·拖出＝farther） */}
          <rect x={sx(0)} y={sy(0)} width={scale} height={scale} fill="none" stroke="#23414c" strokeWidth={1.5} strokeDasharray="3 7" />
          {/* 网格（世界 0.25 步） */}
          {[0.25, 0.5, 0.75, 1].map((g) => (
            <g key={g} stroke="#14222a" strokeWidth={1}>
              <line x1={sx(g)} y1={sy(0)} x2={sx(g)} y2={sy(1)} />
              <line x1={sx(0)} y1={sy(g)} x2={sx(1)} y2={sy(g)} />
            </g>
          ))}
          {/* reveal 圈（beacon owner） */}
          {beacons.map(({ region, pos }) => (
            <circle key={`c-${region.id}`} cx={sx(pos.mapX)} cy={sy(pos.mapY)} r={region.radius * scale}
              fill={palOf(region.palette)} fillOpacity={0.07} stroke={palOf(region.palette)} strokeOpacity={0.5} strokeWidth={1.5} />
          ))}
          {/* flag-gated 圈（owner-less·虚线） */}
          {flagGated.map((rg) => (
            <circle key={`fc-${rg.id}`} cx={sx(rg.center!.x)} cy={sy(rg.center!.y)} r={rg.radius * scale}
              fill={palOf(rg.palette)} fillOpacity={0.06} stroke={palOf(rg.palette)} strokeOpacity={0.5} strokeWidth={1.5} strokeDasharray="6 5" />
          ))}
          {/* radius 手柄（圈右缘·屏幕恒定大小） */}
          {beacons.map(({ region, pos }) => (
            <circle key={`rh-${region.id}`} cx={sx(pos.mapX + region.radius)} cy={sy(pos.mapY)} r={7}
              fill="#0d171d" stroke={palOf(region.palette)} strokeWidth={2} style={{ cursor: 'ew-resize' }}
              onPointerDown={(e) => startDrag({ kind: 'radius', id: region.id }, e)} />
          ))}
          {flagGated.map((rg) => (
            <circle key={`frh-${rg.id}`} cx={sx(rg.center!.x + rg.radius)} cy={sy(rg.center!.y)} r={7}
              fill="#0d171d" stroke={palOf(rg.palette)} strokeWidth={2} style={{ cursor: 'ew-resize' }}
              onPointerDown={(e) => startDrag({ kind: 'radius', id: rg.id }, e)} />
          ))}
          {/* POI 标记 */}
          {pois.map(({ id, abs, kind, outside }) => {
            const c = outside ? '#e0564e' : kind === 'story' ? '#e8c84a' : kind === 'roaming' ? '#7fb0c8' : '#cfe3e8';
            const on = sel?.kind === 'poi' && sel.id === id;
            return (
              <g key={`p-${id}`} style={{ cursor: 'grab' }} onPointerDown={(e) => startDrag({ kind: 'poi', id }, e)}>
                {kind === 'roaming'
                  ? <rect x={sx(abs.mapX) - 5} y={sy(abs.mapY) - 5} width={10} height={10} fill={c} stroke={on ? '#fff' : '#0a1014'} strokeWidth={on ? 2 : 1} />
                  : <circle cx={sx(abs.mapX)} cy={sy(abs.mapY)} r={6} fill={c} stroke={on ? '#fff' : '#0a1014'} strokeWidth={on ? 2 : 1} />}
              </g>
            );
          })}
          {/* flag-gated center 手柄 */}
          {flagGated.map((rg) => (
            <g key={`ct-${rg.id}`} style={{ cursor: 'grab' }} onPointerDown={(e) => startDrag({ kind: 'center', id: rg.id }, e)}>
              <circle cx={sx(rg.center!.x)} cy={sy(rg.center!.y)} r={9} fill="none" stroke={palOf(rg.palette)} strokeWidth={2} />
              <circle cx={sx(rg.center!.x)} cy={sy(rg.center!.y)} r={2.5} fill={palOf(rg.palette)} />
            </g>
          ))}
          {/* beacon 标记（菱形） */}
          {beacons.map(({ region, pos }) => {
            const on = sel?.kind === 'beacon' && sel.id === region.owner;
            const x = sx(pos.mapX), y = sy(pos.mapY);
            return (
              <g key={`b-${region.id}`} style={{ cursor: 'grab' }} onPointerDown={(e) => startDrag({ kind: 'beacon', id: region.owner! }, e)}>
                <path d={`M ${x} ${y - 10} L ${x + 10} ${y} L ${x} ${y + 10} L ${x - 10} ${y} Z`} fill={palOf(region.palette)} stroke={on ? '#fff' : '#0a1014'} strokeWidth={on ? 2.5 : 1.5} />
                <text x={x + 13} y={y + 4} fill={palOf(region.palette)} fontSize={12}>{region.label}</text>
              </g>
            );
          })}
        </svg>
      </div>

      {/* ── 侧栏 ── */}
      <div style={{ flex: '0 0 300px', borderLeft: '1px solid #1d2d36', padding: 16, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 600, color: '#eaf4f7' }}>海图编辑器</div>
          <div style={{ color: '#6f8a93', fontSize: 12 }}>owner-anchored · 滚轮缩放 · 拖背景平移</div>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', flex: 1 }}>
            <span style={{ color: '#9fb6bd' }}>章节</span>
            <select value={mapId} onChange={(e) => { setMapId(e.target.value); setSel(null); }}
              style={{ flex: 1, background: '#0d171d', color: '#cfe3e8', border: '1px solid #283b44', borderRadius: 4, padding: '4px 6px' }}>
              {mapIds.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </label>
          <button onClick={fitView} style={{ background: '#16323b', color: '#eaf4f7', border: '1px solid #2a505d', borderRadius: 4, padding: '5px 9px', cursor: 'pointer' }}>适应</button>
        </div>

        <div style={{ fontSize: 12, color: '#8aa3ab', lineHeight: 1.7 }}>
          <div>◆ beacon（拖动·owned POI 整簇跟随）</div>
          <div>● 锚点　▣ roaming（拖动·改相对偏移）</div>
          <div style={{ color: '#e8c84a' }}>● 剧情锚点（恒可达·owner 仅作坐标基准）</div>
          <div style={{ color: '#e0564e' }}>● 越出 owner 半径（regress §0b 会红）</div>
          <div>○ 圈右缘＝调半径　◎＝鲸落 center　绿线＝海岸线</div>
        </div>

        <div style={{ background: '#0d171d', border: '1px solid #1d2d36', borderRadius: 6, padding: 10, minHeight: 64 }}>
          {selBeacon && (
            <div>
              <div style={{ fontWeight: 600 }}>{selBeacon.region.label}<span style={{ color: '#6f8a93', fontWeight: 400 }}> · beacon</span></div>
              <div style={{ color: '#9fb6bd', fontSize: 12 }}>{selBeacon.region.owner}</div>
              <div style={{ marginTop: 6 }}>pos ({r3(selBeacon.pos.mapX)}, {r3(selBeacon.pos.mapY)})</div>
              <label style={{ display: 'block', marginTop: 6 }}>
                半径 {r3(selBeacon.region.radius)}
                <input type="range" min={0.02} max={0.6} step={0.005} value={selBeacon.region.radius}
                  onPointerDown={pushHistory}
                  onChange={(e) => {
                    const v = parseFloat(e.target.value);
                    setRegionsFile((prev) => {
                      const next = clone(prev); const seg = next[mapId];
                      if (isSeg(seg)) { const rg = (seg as { regions: RegionDef[] }).regions.find((x) => x.id === selBeacon.region.id); if (rg) rg.radius = r3(v); }
                      return next;
                    });
                  }}
                  style={{ width: '100%' }} />
              </label>
            </div>
          )}
          {selPoi && (
            <div>
              <div style={{ fontWeight: 600 }}>{selPoi.poi.name ?? selPoi.id}</div>
              <div style={{ color: '#9fb6bd', fontSize: 12 }}>{selPoi.id}</div>
              <div style={{ marginTop: 6 }}>owner: {selPoi.poi.owner ?? <em style={{ color: '#6f8a93' }}>（absolute）</em>}</div>
              <div>offset ({r3(selPoi.poi.mapX ?? 0)}, {r3(selPoi.poi.mapY ?? 0)})</div>
              <div>abs ({r3(selPoi.abs.mapX)}, {r3(selPoi.abs.mapY)}) · {selPoi.kind}</div>
              {selPoi.outside && <div style={{ color: '#e0564e', marginTop: 4 }}>⚠ 越出 owner 半径</div>}
            </div>
          )}
          {!selBeacon && !selPoi && <div style={{ color: '#6f8a93' }}>点选 / 拖动一个元素查看详情</div>}
        </div>

        {outsidePois.length > 0 && (
          <div style={{ color: '#e0564e', fontSize: 12 }}>
            ⚠ {outsidePois.length} 个 POI 越出 owner 半径（保存后 regress §0b 会红）：{outsidePois.map((p) => p.poi.name ?? p.id).join('、')}
          </div>
        )}
        {saveMsg && <div style={{ color: saveMsg.includes('失败') || saveMsg.includes('未生效') ? '#e0564e' : '#7fc89a', fontSize: 12 }}>{saveMsg}</div>}
        {regress && !regress.running && (
          <div style={{ border: `1px solid ${regress.ok ? '#2f7a4f' : '#5a2a2a'}`, borderRadius: 6, padding: 8 }}>
            <div style={{ color: regress.ok ? '#7fc89a' : '#e0564e', fontWeight: 600, fontSize: 12 }}>{regress.ok ? '回归通过 ✓' : '回归失败 ✗（chart 子集）'}</div>
            <pre style={{ maxHeight: 130, overflow: 'auto', margin: '4px 0 0', whiteSpace: 'pre-wrap', color: '#9fb6bd', font: '11px/1.4 ui-monospace, monospace' }}>{regress.output}</pre>
          </div>
        )}

        <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={saveToProject} style={{ flex: 1, background: '#15422c', color: '#d6f2e0', border: '1px solid #2f7a4f', borderRadius: 5, padding: '9px 10px', cursor: 'pointer', fontWeight: 600 }}>保存进项目</button>
            <button onClick={runRegress} disabled={regress?.running} style={{ background: '#16323b', color: '#eaf4f7', border: '1px solid #2a505d', borderRadius: 5, padding: '9px 10px', cursor: regress?.running ? 'wait' : 'pointer' }}>{regress?.running ? '回归中…' : '跑回归'}</button>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={undo} disabled={!history.length} style={{ flex: 1, background: history.length ? '#1a2c33' : '#121c21', color: history.length ? '#cfe3e8' : '#4a5d64', border: '1px solid #283b44', borderRadius: 5, padding: '8px 10px', cursor: history.length ? 'pointer' : 'default' }}>撤销{history.length ? ` (${history.length})` : ''}</button>
            <button onClick={() => setShowExport(true)} style={{ flex: 1, background: '#16323b', color: '#eaf4f7', border: '1px solid #2a505d', borderRadius: 5, padding: '8px 10px', cursor: 'pointer' }}>导出</button>
            <button onClick={resetAll} style={{ background: '#241418', color: '#e0a39e', border: '1px solid #5a2a2a', borderRadius: 5, padding: '8px 10px', cursor: 'pointer' }}>重置</button>
          </div>
        </div>
      </div>

      {showExport && (
        <div onClick={() => setShowExport(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, zIndex: 10 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: '#0d171d', border: '1px solid #283b44', borderRadius: 8, padding: 18, width: 'min(900px, 95vw)', maxHeight: '90vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: '#eaf4f7' }}>导出（整文件覆盖粘回 · 或直接用「保存进项目」）</div>
              <button onClick={() => setShowExport(false)} style={{ background: 'none', color: '#9fb6bd', border: 'none', fontSize: 18, cursor: 'pointer' }}>×</button>
            </div>
            <ExportBlock title={DATA_FILES.pois} text={fileTexts[DATA_FILES.pois]} />
            <ExportBlock title={DATA_FILES.regions} text={fileTexts[DATA_FILES.regions]} />
            <ExportBlock title={DATA_FILES.lighthouses} text={fileTexts[DATA_FILES.lighthouses]} />
          </div>
        </div>
      )}
    </div>
  );
}

function ExportBlock({ title, text }: { title: string; text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <span style={{ color: '#9fb6bd', fontSize: 12 }}>{title}</span>
        <button onClick={() => { navigator.clipboard?.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1200); }}
          style={{ background: '#16323b', color: '#eaf4f7', border: '1px solid #2a505d', borderRadius: 4, padding: '3px 10px', cursor: 'pointer', fontSize: 12 }}>
          {copied ? '已复制 ✓' : '复制'}
        </button>
      </div>
      <textarea readOnly value={text} style={{ width: '100%', height: 130, background: '#0a1014', color: '#a8c3cc', border: '1px solid #1d2d36', borderRadius: 4, padding: 8, font: '11px/1.4 ui-monospace, monospace', resize: 'vertical' }} />
    </div>
  );
}
