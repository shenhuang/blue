// EconomyDevPanel —— 素材经济可视化工作台 dev 面板（?editor=economy）
//
// 镜像 StatsDevPanel.tsx（内容分布统计）：数据全走 engine/materialStats.ts::computeMaterialStats()
// （纯聚合·单一真相·与 CLI npm run audit:materials 同源）——本文件只渲染。
//
// BI 风格·单视图：KPI（总数/瓶颈/死货/死料）+ 素材清单（源数·总需求·状态信号）+ 素材×区 热力图。
// 过滤：按 tier / zone / 状态筛清单与矩阵行（做平衡时：加来源 / 拆需求篮子改完即看瓶颈褪色）。
//
// 边界：ui → engine 单向（engine ↛ ui 由 check-boundaries 规则一守）——本文件 import engine，反之不可。

import { useMemo, useState, useEffect } from 'react';
import './dev-panel.css';
import { computeMaterialStats, type MaterialStat, type MaterialStatus } from '@/engine/materialStats';

export interface EconomyDevPanelProps {
  onClose?: () => void;
}

const ACCENT_RGB = '94, 196, 214';
const heat = (c: number, max: number) =>
  c <= 0 || max <= 0 ? 'transparent' : `rgba(${ACCENT_RGB}, ${(0.1 + 0.7 * (c / max)).toFixed(3)})`;

// 状态枚举 → 静态信号文案（瓶颈/死货/死料另有专属配色·见下 signalOf）。
const STATUS_LABEL: Record<MaterialStatus, string> = {
  deadstock: '死货',
  bottleneck: '瓶颈',
  single: '单源',
  singleIdle: '纯卖',
  heavy: '重需求',
  ok: '✓',
};

/** 一行的「最严重信号」：死货 > 瓶颈 > 死料 > 状态枚举（前三个着色·后者静）。 */
function signalOf(m: MaterialStat): { label: string; tag: string; row: '' | 'alert' | 'muted' } {
  if (m.deadstock) return { label: '死货', tag: 'dev-bi-tag-deadstock', row: 'alert' };
  if (m.bottleneck) return { label: '瓶颈', tag: 'dev-bi-tag-bottleneck', row: 'alert' };
  if (m.idle) return { label: '死料', tag: 'dev-bi-tag-idle', row: 'muted' };
  return { label: STATUS_LABEL[m.status], tag: 'dev-bi-tag-quiet', row: '' };
}

// 状态筛选项（flag 三项 + 状态枚举若干·'' ＝全部）。
const STATUS_FILTERS: Array<{ value: string; label: string }> = [
  { value: '', label: '全部状态' },
  { value: 'bottleneck', label: '瓶颈(单源·需求≥8)' },
  { value: 'deadstock', label: '死货(有需求无来源)' },
  { value: 'idle', label: '死料(有产零销)' },
  { value: 'single', label: '单源(有需求)' },
  { value: 'heavy', label: '重需求(多源)' },
  { value: 'ok', label: '✓ 健康' },
];

function matchStatus(m: MaterialStat, status: string): boolean {
  if (!status) return true;
  if (status === 'bottleneck') return m.bottleneck;
  if (status === 'deadstock') return m.deadstock;
  if (status === 'idle') return m.idle;
  return m.status === status;
}

export function EconomyDevPanel({ onClose }: EconomyDevPanelProps) {
  const stats = useMemo(() => computeMaterialStats(), []);
  const [tier, setTier] = useState('');
  const [zone, setZone] = useState('');
  const [status, setStatus] = useState('');

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose?.();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // 行原始索引（matrix 行与 stats.materials 同序）——过滤后仍能取到各素材的 zone 行。
  const indexById = useMemo(
    () => new Map(stats.materials.map((m, i) => [m.id, i] as const)),
    [stats],
  );
  const tiers = useMemo(
    () => [...new Set(stats.materials.map((m) => m.tier))].sort(),
    [stats],
  );
  const zoneIdx = zone ? stats.zones.indexOf(zone) : -1;

  const rows = useMemo(
    () =>
      stats.materials
        .map((m) => ({ m, i: indexById.get(m.id)! }))
        .filter(({ m, i }) => {
          if (tier && m.tier !== tier) return false;
          if (!matchStatus(m, status)) return false;
          if (zone && zoneIdx >= 0 && stats.matrix[i][zoneIdx] <= 0) return false;
          return true;
        }),
    [stats, indexById, tier, zone, zoneIdx, status],
  );

  const maxCell = useMemo(
    () => Math.max(1, ...rows.map(({ i }) => Math.max(0, ...stats.matrix[i]))),
    [rows, stats],
  );

  return (
    <div className="dev-panel" role="dialog" aria-label="素材经济 dev 面板">
      <header className="dev-panel-header">
        <div>
          <div className="dev-panel-title">素材经济</div>
          <div className="dev-panel-sub">
            {stats.total} 素材 · {stats.zones.length} zone · 瓶颈 {stats.bottleneckCount} · 死货{' '}
            {stats.deadstockCount} · 死料 {stats.idleCount} · ?editor=economy
          </div>
        </div>
        <div className="dev-panel-header-actions">
          <div className="dev-bi-filters">
            <select
              className="dev-input dev-bi-filter"
              value={tier}
              onChange={(e) => setTier(e.target.value)}
              aria-label="按稀有度档筛"
            >
              <option value="">全部档</option>
              {tiers.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <select
              className="dev-input dev-bi-filter"
              value={zone}
              onChange={(e) => setZone(e.target.value)}
              aria-label="按 zone 筛"
            >
              <option value="">全部 zone</option>
              {stats.zones.map((z) => (
                <option key={z} value={z}>
                  {z}
                </option>
              ))}
            </select>
            <select
              className="dev-input dev-bi-filter"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              aria-label="按状态筛"
            >
              {STATUS_FILTERS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
          {onClose && (
            <button className="dev-btn dev-btn-quiet" onClick={onClose}>
              关闭 (Esc)
            </button>
          )}
        </div>
      </header>

      <div className="dev-bi-body">
        <div className="dev-bi-kpis">
          <Kpi value={stats.total} label="素材总数" />
          <Kpi value={stats.bottleneckCount} label="瓶颈 (单源·需求≥8)" tone="alert" />
          <Kpi value={stats.deadstockCount} label="死货 (有需求无来源)" tone="alert" />
          <Kpi value={stats.idleCount} label="死料 (有产零销)" tone="muted" />
        </div>

        <section className="dev-bi-card">
          <div className="dev-bi-h-row">
            <h3 className="dev-bi-h">
              素材清单 <span className="dev-bi-h-sub">源数 · 总需求 · 状态</span>
            </h3>
            <span className="dev-bi-legend-cap">{rows.length} 行</span>
          </div>
          {rows.length === 0 ? (
            <div className="dev-bi-empty">无匹配素材（调整筛选）。</div>
          ) : (
            <table className="dev-bi-table">
              <thead>
                <tr>
                  <th>素材</th>
                  <th>档</th>
                  <th className="num">源</th>
                  <th className="num">总需求</th>
                  <th>状态</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ m }) => {
                  const sig = signalOf(m);
                  return (
                    <tr key={m.id} className={sig.row}>
                      <td className="dev-bi-rowh-mat" title={m.id}>
                        {m.name}
                      </td>
                      <td>{m.tier}</td>
                      <td className="num">{m.srcCount}</td>
                      <td className="num dev-bi-num-dem">{m.totalDemand}</td>
                      <td>
                        <span className={`dev-bi-tag ${sig.tag}`}>{sig.label}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>

        <section className="dev-bi-card">
          <div className="dev-bi-h-row">
            <h3 className="dev-bi-h">素材 × Zone 来源热力图</h3>
            <div className="dev-bi-legend">
              <span className="dev-bi-legend-cap">0</span>
              <span className="dev-bi-legend-grad" />
              <span className="dev-bi-legend-cap">{maxCell}</span>
            </div>
          </div>
          {rows.length === 0 ? (
            <div className="dev-bi-empty">无匹配素材。</div>
          ) : (
            <div className="dev-bi-matrix-wrap">
              <table className="dev-bi-matrix">
                <thead>
                  <tr>
                    <th className="dev-bi-corner">素材 ＼ zone</th>
                    {stats.zones.map((z) => (
                      <th
                        key={z}
                        className="dev-bi-colh"
                        title={z}
                        style={zone && z === zone ? { color: 'var(--accent)' } : undefined}
                      >
                        {z}
                      </th>
                    ))}
                    <th className="dev-bi-rowtot">Σ</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ m, i }) => (
                    <tr key={m.id}>
                      <th className="dev-bi-rowh" title={m.id}>
                        {m.name}
                      </th>
                      {stats.zones.map((z, zi) => {
                        const c = stats.matrix[i][zi];
                        return (
                          <td
                            key={z}
                            className="dev-bi-cell"
                            style={{ background: heat(c, maxCell) }}
                            title={`${m.name} · ${z} · ${c} 来源点`}
                          >
                            {c || ''}
                          </td>
                        );
                      })}
                      <td className="dev-bi-rowtot">{stats.rowTotals[i]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="dev-bi-note">
            格＝该素材在该 zone 的**来源点数**（敌 bands / 事件 zoneTags / 柱 zoneId·多 zone 来源各记一次）·
            行 Σ＝有 zone 标签的来源点数（≥源数）·无 zone 标签的来源点（敌无 bands / 事件无 zoneTags）不入矩阵但计入「源」。
          </div>
        </section>
      </div>
    </div>
  );
}

function Kpi({
  value,
  label,
  tone,
}: {
  value: number | string;
  label: string;
  tone?: 'alert' | 'muted';
}) {
  return (
    <div className={`dev-bi-kpi${tone ? ` dev-bi-kpi-${tone}` : ''}`}>
      <div className="dev-bi-kpi-num">{value}</div>
      <div className="dev-bi-kpi-label">{label}</div>
    </div>
  );
}
