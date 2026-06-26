// ChartViewDevPanel —— 港口海图 POI 调试工作台（?editor=chartdev）
//
// 目的：可视化 chart_pois.json 所有锚点 + roaming 模板（含隐藏的）的揭示态/reach/修正——
// 不用翻 JSON 就能看清哪些点在当前档案下可见、为什么看不到、最近哪座灯塔、修正标签。
//
//   左栏：档案控制（runsCompleted·已建前哨灯塔·天气读出）+ 过滤（类型/揭示态）
//   右栏：POI 表格（id·类型·zone·mapX/mapY·owner·发现门·揭示态·reach·修正）
//
// 纯只读引擎派生：poiRevealState / effectiveDistance / describeModifier / chartConditions。
// chart_pois.json 直接引用（只读数据·非引擎文件·UI 可 import）；不写存档；不在 UI 造 phase。
// 边界守护：ui → engine 单向（check-boundaries 规则一/二·engine ↛ ui / 禁 phase 字面量）。
//
// 路由：EditorApp ?editor=chartdev（独立 tab·不影响 ?editor=chart 海图编辑器）。

import { useMemo, useState } from 'react';
import './dev-panel.css';
import {
  poiRevealState,
  effectiveDistance,
  describeModifier,
  chartConditions,
  REACH_NORM_PER_TIER,
} from '@/engine/chart';
import { getOutposts, nearestLighthouse, ownerAnchorPos } from '@/engine/lighthouses';
import { createInitialProfile } from '@/engine/state';
import { buildColumnPois, getColumnForLighthouse, columnProbeUpgradeId } from '@/engine/columns';
import { TUTORIAL_COMPLETE_FLAG } from '@/engine/story';
import type { ChartPoi, PoiModifier, PoiRevealState, Lighthouse } from '@/types';
import chartData from '@/data/chart_pois.json';

// ── 原始数据 flatten（镜像 chart.ts flattenChartPois·但露出 roaming 模板 + 全部 anchor） ──

interface RoamingTemplate {
  templateId: string;
  zoneId: string;
  name: string;
  distance: number;
  owner?: string;
  mapX?: number;
  mapY?: number;
  requiresFlags?: string[];
  requiresLighthouseUpgrade?: string;
  modifier?: PoiModifier;
}

function flattenAll(): { anchors: ChartPoi[]; roamingTemplates: RoamingTemplate[] } {
  const anchors: ChartPoi[] = [];
  const roamingTemplates: RoamingTemplate[] = [];
  const file = chartData as Record<string, unknown>;
  for (const key of Object.keys(file)) {
    const seg = file[key];
    if (typeof seg === 'string' || key.startsWith('_')) continue;
    const s = seg as { anchors?: ChartPoi[]; roamingTemplates?: RoamingTemplate[] };
    anchors.push(...(s.anchors ?? []));
    roamingTemplates.push(...(s.roamingTemplates ?? []));
  }
  return { anchors, roamingTemplates };
}

const RAW = flattenAll();

/** 同 chart.ts resolveOwnerCoords：owner POI 的 mapX/mapY 由相对偏移 → 绝对坐标。 */
function resolveCoords<T extends { owner?: string; mapX?: number; mapY?: number }>(poi: T): T {
  if (!poi.owner) return poi;
  const base = ownerAnchorPos(poi.owner);
  if (!base) return poi;
  return { ...poi, mapX: base.mapX + (poi.mapX ?? 0), mapY: base.mapY + (poi.mapY ?? 0) };
}

/** roaming 模板 → 临时 ChartPoi（供 poiRevealState / effectiveDistance 计算用·不入存档）。 */
function templateToPoi(t: RoamingTemplate, runsCompleted: number): ChartPoi {
  return {
    id: `poi.roam.${runsCompleted}.${t.templateId}`,
    zoneId: t.zoneId,
    name: t.name,
    blurb: '',
    distance: t.distance,
    owner: t.owner,
    mapX: t.mapX,
    mapY: t.mapY,
    modifier: t.modifier,
    persistent: false,
    requiresFlags: t.requiresFlags,
    requiresLighthouseUpgrade: t.requiresLighthouseUpgrade,
  };
}

// ── 行数据类型 ────────────────────────────────────────────────────────────────────────────────

type PoiKind = 'anchor' | 'roaming' | 'column';

/** 下潜路由标志：柱 > cave > band > abs > —（调试 startDive 走哪条路径的辅助列）。 */
function routeHintOf(poi: {
  columnId?: string;
  depthTier?: number;
  bandId?: string;
  caveEntry?: { caveId: string };
  absolute?: boolean;
}): string {
  if (poi.columnId != null)
    return `柱:${poi.columnId.replace(/^col\./, '')}${poi.depthTier != null ? `·t${poi.depthTier}` : ''}`;
  if (poi.caveEntry) return `cave:${poi.caveEntry.caveId.replace(/^cave\./, '')}`;
  if (poi.bandId) return `band:${poi.bandId.replace(/^band\./, '')}`;
  if (poi.absolute) return 'abs';
  return '—';
}

interface PoiRow {
  id: string;
  kind: PoiKind;
  name: string;
  zoneId: string;
  owner?: string;
  rawMapX?: number; // 数据文件里的原值（相对偏移·owner-anchored）
  rawMapY?: number;
  mapX?: number;   // resolve 后的绝对坐标
  mapY?: number;
  requiresFlags?: string[];
  revealState: PoiRevealState;
  reach: number; // effectiveDistance（有坐标走几何·无则写死 poi.distance）
  nearestName: string | null;
  modTags: string[];
  routeHint: string; // 下潜路由标志（柱/cave/band/abs/—·调试走哪条 startDive 路径）
}

// ── 常量 ─────────────────────────────────────────────────────────────────────────────────────

const OUTPOST_DEFS = getOutposts();

/** 某灯塔按「探深级数」派生应已建的 probe 升级 id 集合（喂 builtUpgrades → columnBuiltLevel → 柱 POI 揭示态）。
 *  无深度柱的灯塔 → 空集（不影响）。之前面板恒填 new Set() → 柱探深永远 0。 */
function buildProbeUpgrades(lighthouseId: string, level: number): Set<string> {
  const col = getColumnForLighthouse(lighthouseId);
  const set = new Set<string>();
  if (col) for (let t = 1; t <= level; t++) set.add(columnProbeUpgradeId(col.id, t));
  return set;
}

/** 家灯塔（常驻）的探深输入行——家礁柱也是一根 column，独立于前哨勾选。 */
function HomeProbeRow({
  probeLevels,
  setProbe,
}: {
  probeLevels: Map<string, number>;
  setProbe: (lighthouseId: string, level: number, maxTier: number) => void;
}) {
  const maxTier = getColumnForLighthouse('lighthouse.home')?.tiers.length ?? 0;
  if (maxTier <= 0) return null;
  return (
    <div className="dev-row" style={{ gap: 6, marginBottom: 6, alignItems: 'center' }}>
      <span style={{ fontSize: 12 }}>家灯塔（常驻）</span>
      <span className="dev-faint" style={{ fontSize: 11, marginLeft: 'auto' }}>
        探深{' '}
        <input
          className="dev-input dev-input-num"
          type="number"
          min={0}
          max={maxTier}
          style={{ width: 44 }}
          value={probeLevels.get('lighthouse.home') ?? 0}
          onChange={(e) => setProbe('lighthouse.home', Number(e.target.value) || 0, maxTier)}
        />
        /{maxTier}
      </span>
    </div>
  );
}

const STATE_LABEL: Record<PoiRevealState, string> = {
  lit: '亮·可去',
  dim: '暗·待解锁',
  hidden: '隐·未发现',
};
const STATE_CLASS: Record<PoiRevealState, string> = {
  lit: 'dev-chart-lit',
  dim: 'dev-chart-dim',
  hidden: 'dev-faint',
};
const WEATHER_LABEL: Record<string, string> = { clear: '晴', mist: '薄雾', fog: '浓雾' };
const TIDE_LABEL: Record<string, string> = { flood: '涨', ebb: '退' };

// ── 组件 ─────────────────────────────────────────────────────────────────────────────────────

export interface ChartViewDevPanelProps {
  onClose?: () => void;
}

export function ChartViewDevPanel({ onClose }: ChartViewDevPanelProps) {
  const [runsCompleted, setRunsCompleted] = useState(0);
  const [builtOutposts, setBuiltOutposts] = useState<Set<string>>(new Set());
  const [filterKind, setFilterKind] = useState<'all' | PoiKind>('all');
  const [filterReveal, setFilterReveal] = useState<'all' | PoiRevealState>('all');
  // 教学门（buildColumnPois 压在 flag.tutorial_complete 后）——默认开：柱 POI 浮现；关＝海图全空（pre-tutorial）。
  // 注：poiRevealState 对 anchor/roaming 不依赖此 flag，故此开关只影响柱 POI、不扰动锚点显示。
  const [tutorialDone, setTutorialDone] = useState(true);
  // 各灯塔探深级数（key=lighthouseId）：驱动 builtUpgrades → columnBuiltLevel → 柱 POI 揭示态。
  const [probeLevels, setProbeLevels] = useState<Map<string, number>>(new Map());

  function setProbe(lighthouseId: string, level: number, maxTier: number) {
    setProbeLevels((prev) => {
      const next = new Map(prev);
      next.set(lighthouseId, Math.max(0, Math.min(maxTier, level)));
      return next;
    });
  }

  // 按控制状态构建模拟档案（createInitialProfile 含家灯塔·勾选的前哨灯塔追加进 lighthouses）
  const profile = useMemo(() => {
    const p = createInitialProfile();
    p.runsCompleted = runsCompleted;
    if (tutorialDone) p.flags.add(TUTORIAL_COMPLETE_FLAG);
    // 档案里已有的灯塔（家灯塔）按探深级数填 builtUpgrades（之前恒空 → 家礁柱探深永远 0）。
    for (const lh of p.lighthouses) {
      lh.builtUpgrades = buildProbeUpgrades(lh.id, probeLevels.get(lh.id) ?? 0);
    }
    // 勾选的前哨灯塔（各按其探深级数填 builtUpgrades）
    for (const def of OUTPOST_DEFS) {
      if (!builtOutposts.has(def.id)) continue;
      const lh: Lighthouse = {
        id: def.result.id,
        name: def.result.name,
        mapX: def.result.mapX,
        mapY: def.result.mapY,
        level: def.result.level,
        builtUpgrades: buildProbeUpgrades(def.result.id, probeLevels.get(def.result.id) ?? 0),
      };
      p.lighthouses.push(lh);
    }
    return p;
  }, [runsCompleted, builtOutposts, tutorialDone, probeLevels]);

  const conditions = useMemo(() => chartConditions(profile), [profile]);

  // 全量 POI 行（anchors + roaming 模板·含隐藏的）
  const rows = useMemo((): PoiRow[] => {
    const result: PoiRow[] = [];

    for (const raw of RAW.anchors) {
      const poi = resolveCoords(raw); // 绝对坐标
      const state = poiRevealState(profile, poi);
      const dist = effectiveDistance(profile, poi);
      const near =
        poi.mapX != null && poi.mapY != null
          ? nearestLighthouse(profile, poi.mapX, poi.mapY)
          : null;
      result.push({
        id: poi.id,
        kind: 'anchor',
        routeHint: routeHintOf(poi),
        name: poi.name,
        zoneId: poi.zoneId,
        owner: poi.owner,
        rawMapX: raw.mapX,
        rawMapY: raw.mapY,
        mapX: poi.mapX,
        mapY: poi.mapY,
        requiresFlags: poi.requiresFlags,
        revealState: state,
        reach: dist,
        nearestName: near?.lighthouse.name ?? null,
        modTags: describeModifier(poi.modifier),
      });
    }

    for (const raw of RAW.roamingTemplates) {
      const resolved = resolveCoords(raw); // 绝对坐标
      const poi = templateToPoi(resolved, runsCompleted);
      const state = poiRevealState(profile, poi);
      const dist = effectiveDistance(profile, poi);
      const near =
        resolved.mapX != null && resolved.mapY != null
          ? nearestLighthouse(profile, resolved.mapX, resolved.mapY)
          : null;
      result.push({
        id: raw.templateId,
        kind: 'roaming',
        routeHint: '—', // roaming 模板无 band/柱/cave 路由字段（经 owner 锚点定位）
        name: raw.name,
        zoneId: raw.zoneId,
        owner: raw.owner,
        rawMapX: raw.mapX,
        rawMapY: raw.mapY,
        mapX: resolved.mapX,
        mapY: resolved.mapY,
        requiresFlags: raw.requiresFlags,
        revealState: state,
        reach: dist,
        nearestName: near?.lighthouse.name ?? null,
        modTags: describeModifier(raw.modifier),
      });
    }

    // 深度柱深入 POI（#131）——buildColumnPois 已带档位制 revealState（gated by flag.tutorial_complete + 宿主灯塔在场 +
    // columnBuiltLevel 决定档位）。之前完全漏掉：flattenAll 只读 chart_pois.json，不含 generateChart 在 chart.ts 注入的柱 POI。
    // check-dev-panels 守「本面板引用 buildColumnPois」；smoke-chart-editor 守「柱 POI 实际渲染出来」。
    for (const poi of buildColumnPois(profile)) {
      const near =
        poi.mapX != null && poi.mapY != null
          ? nearestLighthouse(profile, poi.mapX, poi.mapY)
          : null;
      result.push({
        id: poi.id,
        kind: 'column',
        routeHint: routeHintOf(poi),
        name: poi.name,
        zoneId: poi.zoneId,
        owner: poi.owner,
        rawMapX: undefined,
        rawMapY: undefined,
        mapX: poi.mapX,
        mapY: poi.mapY,
        requiresFlags: poi.requiresFlags,
        revealState: poi.revealState ?? poiRevealState(profile, poi),
        reach: effectiveDistance(profile, poi),
        nearestName: near?.lighthouse.name ?? null,
        modTags: describeModifier(poi.modifier),
      });
    }

    return result;
  }, [profile, runsCompleted]);

  const filtered = useMemo(
    () =>
      rows.filter(
        (r) =>
          (filterKind === 'all' || r.kind === filterKind) &&
          (filterReveal === 'all' || r.revealState === filterReveal),
      ),
    [rows, filterKind, filterReveal],
  );

  const counts = useMemo(
    () => ({
      lit: rows.filter((r) => r.revealState === 'lit').length,
      dim: rows.filter((r) => r.revealState === 'dim').length,
      hidden: rows.filter((r) => r.revealState === 'hidden').length,
      anchor: rows.filter((r) => r.kind === 'anchor').length,
      roaming: rows.filter((r) => r.kind === 'roaming').length,
      column: rows.filter((r) => r.kind === 'column').length,
    }),
    [rows],
  );

  function toggleOutpost(id: string) {
    setBuiltOutposts((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="dev-panel">
      <div className="dev-panel-header">
        <div>
          <div className="dev-panel-title">海图 POI 调试器 · ChartViewDevPanel</div>
          <div className="dev-panel-sub">
            只读派生 · poiRevealState / effectiveDistance / describeModifier · ?editor=chartdev
          </div>
        </div>
        {onClose && (
          <button className="dev-btn dev-btn-quiet" onClick={onClose}>
            关闭 ✕
          </button>
        )}
      </div>

      <div className="dev-panel-body dev-chart-body">
        {/* 左栏：档案控制 + 过滤 */}
        <div className="dev-col dev-col-form">
          <h3 className="dev-col-title">档案模拟</h3>
          <div className="dev-section">
            <div className="dev-stack">
              <span>runsCompleted（种子·潮汐/天气/roaming 选取）</span>
              <div className="dev-row">
                <input
                  className="dev-input dev-input-num"
                  type="number"
                  min={0}
                  max={9999}
                  value={runsCompleted}
                  onChange={(e) => setRunsCompleted(Math.max(0, Number(e.target.value) || 0))}
                />
                <span className="dev-faint">
                  {TIDE_LABEL[conditions.tide]}潮 · {WEATHER_LABEL[conditions.weather]}
                </span>
              </div>
            </div>
            <label className="dev-row" style={{ cursor: 'pointer', gap: 6, marginTop: 8 }}>
              <input
                type="checkbox"
                checked={tutorialDone}
                onChange={(e) => setTutorialDone(e.target.checked)}
              />
              <span style={{ fontSize: 12 }}>
                教学已过（flag.tutorial_complete）
                <span className="dev-faint"> · 关＝海图全空 · 开＝柱 POI 浮现</span>
              </span>
            </label>
          </div>

          <h3 className="dev-col-title">已建前哨灯塔 + 探深</h3>
          <div className="dev-section">
            <div className="dev-faint" style={{ marginBottom: 6 }}>
              家灯塔（home）始终在档案里。前哨勾选后 push 进 profile.lighthouses → 影响
              owner-anchored 点亮 + 揭示圈。
            </div>
            <HomeProbeRow probeLevels={probeLevels} setProbe={setProbe} />
            {OUTPOST_DEFS.map((def) => {
              const built = builtOutposts.has(def.id);
              const maxTier = getColumnForLighthouse(def.result.id)?.tiers.length ?? 0;
              return (
                <div
                  key={def.id}
                  className="dev-row"
                  style={{ gap: 6, marginBottom: 4, alignItems: 'center' }}
                >
                  <label className="dev-row" style={{ cursor: 'pointer', gap: 6 }}>
                    <input
                      type="checkbox"
                      checked={built}
                      onChange={() => toggleOutpost(def.id)}
                    />
                    <span style={{ fontSize: 12 }}>
                      {def.name}
                      <span className="dev-faint"> {def.result.mapX.toFixed(2)},{def.result.mapY.toFixed(2)}</span>
                    </span>
                  </label>
                  {built && maxTier > 0 && (
                    <span className="dev-faint" style={{ fontSize: 11, marginLeft: 'auto' }}>
                      探深{' '}
                      <input
                        className="dev-input dev-input-num"
                        type="number"
                        min={0}
                        max={maxTier}
                        style={{ width: 44 }}
                        value={probeLevels.get(def.result.id) ?? 0}
                        onChange={(e) => setProbe(def.result.id, Number(e.target.value) || 0, maxTier)}
                      />
                      /{maxTier}
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          <h3 className="dev-col-title">过滤</h3>
          <div className="dev-section">
            <div className="dev-stack">
              <span>类型</span>
              <select
                className="dev-input"
                value={filterKind}
                onChange={(e) => setFilterKind(e.target.value as typeof filterKind)}
              >
                <option value="all">全部（{rows.length}）</option>
                <option value="anchor">锚点 anchor（{counts.anchor}）</option>
                <option value="roaming">漂移 roaming（{counts.roaming}）</option>
                <option value="column">深度柱 column（{counts.column}）</option>
              </select>
            </div>
            <div className="dev-stack" style={{ marginTop: 6 }}>
              <span>揭示态</span>
              <select
                className="dev-input"
                value={filterReveal}
                onChange={(e) => setFilterReveal(e.target.value as typeof filterReveal)}
              >
                <option value="all">全部</option>
                <option value="lit">亮·可去（{counts.lit}）</option>
                <option value="dim">暗·待解锁（{counts.dim}）</option>
                <option value="hidden">隐·未发现（{counts.hidden}）</option>
              </select>
            </div>
          </div>

          <div className="dev-faint" style={{ marginTop: 6 }}>
            reach＝effectiveDistance（最近灯塔几何距离 ÷ {REACH_NORM_PER_TIER}·四舍五入·无坐标退回写死档位）。
            坐标列＝resolve 后绝对值（括号内为数据文件原始偏移）。
          </div>
        </div>

        {/* 右栏：POI 表格 */}
        <div className="dev-col dev-chart-table-col">
          <h3 className="dev-col-title">
            POI 列表
            <span className="dev-faint" style={{ marginLeft: 8, fontWeight: 'normal', fontSize: 11 }}>
              {filtered.length} 条 · 亮{' '}
              <span className="dev-chart-lit">{counts.lit}</span> / 暗{' '}
              <span className="dev-chart-dim">{counts.dim}</span> / 隐 {counts.hidden}
            </span>
          </h3>
          <div style={{ overflowX: 'auto' }}>
            <table className="dev-chart-table">
              <thead>
                <tr>
                  <th>类型</th>
                  <th>名称</th>
                  <th>Zone</th>
                  <th title="resolve 后绝对坐标（括号=原始偏移）">mapX (raw)</th>
                  <th title="resolve 后绝对坐标（括号=原始偏移）">mapY (raw)</th>
                  <th title="owner 灯塔 id（短名）">Owner</th>
                  <th title="requiresFlags 发现门（全满足才出现）">发现门</th>
                  <th>揭示态</th>
                  <th title="effectiveDistance = 最近灯塔距离 ÷ REACH_NORM_PER_TIER">Reach</th>
                  <th title="modifier.depthOffset / current / visibility">修正</th>
                  <th title="下潜路由：柱/band/cave/abs（startDive 走哪条路径）">路由</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => (
                  <tr
                    key={row.id}
                    className={row.revealState === 'hidden' ? 'dev-chart-row-hidden' : ''}
                  >
                    <td>
                      <span
                        className={
                          row.kind === 'anchor'
                            ? 'dev-chart-badge-anchor'
                            : row.kind === 'roaming'
                              ? 'dev-chart-badge-roam'
                              : 'dev-chart-badge-col'
                        }
                      >
                        {row.kind === 'anchor' ? '锚' : row.kind === 'roaming' ? '漂' : '柱'}
                      </span>
                    </td>
                    <td
                      title={row.id}
                      style={{
                        maxWidth: 130,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {row.name}
                    </td>
                    <td className="dev-faint" style={{ fontSize: 10, whiteSpace: 'nowrap' }}>
                      {row.zoneId.replace('zone.', '')}
                    </td>
                    <td className="dev-mono dev-chart-coord">
                      {row.mapX != null ? row.mapX.toFixed(3) : '—'}
                      {row.rawMapX != null && row.owner ? (
                        <span className="dev-faint"> ({row.rawMapX >= 0 ? '+' : ''}{row.rawMapX.toFixed(3)})</span>
                      ) : null}
                    </td>
                    <td className="dev-mono dev-chart-coord">
                      {row.mapY != null ? row.mapY.toFixed(3) : '—'}
                      {row.rawMapY != null && row.owner ? (
                        <span className="dev-faint"> ({row.rawMapY >= 0 ? '+' : ''}{row.rawMapY.toFixed(3)})</span>
                      ) : null}
                    </td>
                    <td
                      className="dev-faint dev-chart-owner"
                      title={row.owner}
                    >
                      {row.owner?.replace('lighthouse.', '') ?? '—'}
                    </td>
                    <td className="dev-faint" style={{ fontSize: 10, maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {row.requiresFlags?.join(' · ') ?? '—'}
                    </td>
                    <td>
                      <span className={STATE_CLASS[row.revealState]}>
                        {STATE_LABEL[row.revealState]}
                      </span>
                    </td>
                    <td
                      className="dev-mono"
                      title={row.nearestName ? `最近灯塔: ${row.nearestName}` : undefined}
                    >
                      {row.reach}
                    </td>
                    <td>
                      {row.modTags.length > 0 ? (
                        row.modTags.map((t, i) => (
                          <span key={i} className="dev-chart-mod-tag">
                            {t}
                          </span>
                        ))
                      ) : (
                        <span className="dev-faint">—</span>
                      )}
                    </td>
                    <td className="dev-faint dev-mono" style={{ fontSize: 10, whiteSpace: 'nowrap' }}>
                      {row.routeHint}
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={11} className="dev-faint" style={{ textAlign: 'center', padding: 16 }}>
                      过滤后无结果
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
