// StatsDevPanel —— 内容分布统计 dev 面板（`?editor=stats` / 剧情编辑器「内容统计」按钮·游戏内浮层已撤·2026-07-09）
//
// BI 风格·两页签（ZONE 与 TONE 互不直接关联·分开切换）：
//   ZONE 分布：KPI + zone 事件量排行 + 建议补的池 + zone×深度 热力图（带色阶图例）
//   TONE 分布：tone 占比构成条 + tone×深度 堆叠（体量）+ tone×zone 构成（100%）
// 数据全走 engine/eventStats.ts::computeEventStats()（纯聚合·单一真相）——本文件只渲染。

import { useMemo, useState, useEffect } from 'react';
import './dev-panel.css';
import { computeEventStats, type EventStats } from '@/engine/eventStats';

export interface StatsDevPanelProps {
  onClose?: () => void;
}

type Tab = 'zone' | 'tone';

// tone 固定配色（ordinal：冷静蓝→失真琥珀→宇宙紫·与「越深越离奇」一致）；未知 tone 走回退色。
const TONE_COLOR: Record<string, string> = {
  realistic: '#5b8fb0',
  uncanny: '#d2a24c',
  cosmic: '#9b6fc0',
};
const FALLBACK = ['#6b8fa3', '#b08968', '#8a7fb0', '#5c9a8b', '#b56b6b'];
const toneColor = (t: string, i: number) => TONE_COLOR[t] ?? FALLBACK[i % FALLBACK.length];

const ACCENT_RGB = '94, 196, 214';
const heat = (c: number, max: number) =>
  c <= 0 || max <= 0 ? 'transparent' : `rgba(${ACCENT_RGB}, ${(0.1 + 0.7 * (c / max)).toFixed(3)})`;
const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : 0);

export function StatsDevPanel({ onClose }: StatsDevPanelProps) {
  const stats = useMemo(() => computeEventStats(), []);
  const [tab, setTab] = useState<Tab>('zone');

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

  return (
    <div className="dev-panel" role="dialog" aria-label="内容分布统计 dev 面板">
      <header className="dev-panel-header">
        <div>
          <div className="dev-panel-title">内容分布统计</div>
          <div className="dev-panel-sub">
            {stats.total} 事件 · {stats.zones.length} zone · {stats.tones.length} tone · ?editor=stats
          </div>
        </div>
        <div className="dev-panel-header-actions">
          <div className="dev-bi-tabs" role="tablist">
            <button
              role="tab"
              aria-selected={tab === 'zone'}
              className={tab === 'zone' ? 'on' : ''}
              onClick={() => setTab('zone')}
            >
              ZONE 分布
            </button>
            <button
              role="tab"
              aria-selected={tab === 'tone'}
              className={tab === 'tone' ? 'on' : ''}
              onClick={() => setTab('tone')}
            >
              TONE 分布
            </button>
          </div>
          {onClose && (
            <button className="dev-btn dev-btn-quiet" onClick={onClose}>
              关闭 (Esc)
            </button>
          )}
        </div>
      </header>

      <div className="dev-bi-body">{tab === 'zone' ? <ZoneView stats={stats} /> : <ToneView stats={stats} />}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 小部件
// ---------------------------------------------------------------------------

function Kpi({ value, label, tone }: { value: number | string; label: string; tone?: 'gap' | 'thin' }) {
  return (
    <div className={`dev-bi-kpi${tone ? ` dev-bi-kpi-${tone}` : ''}`}>
      <div className="dev-bi-kpi-num">{value}</div>
      <div className="dev-bi-kpi-label">{label}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ZONE 分布
// ---------------------------------------------------------------------------

function ZoneView({ stats }: { stats: EventStats }) {
  const maxCell = useMemo(() => Math.max(1, ...stats.matrix.flat()), [stats]);
  const totalIncid = stats.zoneTotals.reduce((a, b) => a + b, 0);
  const gaps = stats.suggestions.filter((s) => s.kind === 'gap').length;
  const thins = stats.suggestions.length - gaps;

  return (
    <>
      <div className="dev-bi-kpis">
        <Kpi value={stats.total} label="事件总数" />
        <Kpi value={stats.zones.length} label="zoneTag" />
        <Kpi value={gaps} label="深度空洞" tone="gap" />
        <Kpi value={thins} label="薄池 (≤1)" tone="thin" />
      </div>

      <section className="dev-bi-card">
        <h3 className="dev-bi-h">
          建议补的池 <span className="dev-bi-h-sub">空洞优先</span>
        </h3>
        {stats.suggestions.length === 0 ? (
          <div className="dev-bi-empty">分布较满，无明显缺口。</div>
        ) : (
          <table className="dev-bi-table">
            <thead>
              <tr>
                <th>zone</th>
                <th>深度</th>
                <th>状态</th>
                <th className="num">事件</th>
              </tr>
            </thead>
            <tbody>
              {stats.suggestions.map((s, i) => (
                <tr key={i}>
                  <td>{s.zone}</td>
                  <td>{s.bucketLabel}</td>
                  <td>
                    <span className={`dev-bi-tag ${s.kind === 'gap' ? 'dev-bi-tag-gap' : 'dev-bi-tag-thin'}`}>
                      {s.kind === 'gap' ? '空洞' : '薄'}
                    </span>
                  </td>
                  <td className="num">{s.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="dev-bi-card">
        <div className="dev-bi-h-row">
          <h3 className="dev-bi-h">Zone × 深度 热力图</h3>
          <div className="dev-bi-legend">
            <span className="dev-bi-legend-cap">0</span>
            <span className="dev-bi-legend-grad" />
            <span className="dev-bi-legend-cap">{maxCell}</span>
          </div>
        </div>
        <div className="dev-bi-matrix-wrap">
          <table className="dev-bi-matrix">
            <thead>
              <tr>
                <th className="dev-bi-corner">zone ＼ 深度(m)</th>
                {stats.buckets.map((b) => (
                  <th key={b.label} className="dev-bi-colh">
                    {b.lo}
                  </th>
                ))}
                <th className="dev-bi-rowtot">Σ</th>
              </tr>
            </thead>
            <tbody>
              {stats.zones.map((zone, zi) => (
                <tr key={zone}>
                  <th className="dev-bi-rowh">{zone}</th>
                  {stats.buckets.map((b, bi) => {
                    const c = stats.matrix[zi][bi];
                    return (
                      <td
                        key={b.label}
                        className="dev-bi-cell"
                        style={{ background: heat(c, maxCell) }}
                        title={`${zone} · ${b.label} · ${c} 个`}
                      >
                        {c || ''}
                      </td>
                    );
                  })}
                  <td className="dev-bi-rowtot">{stats.zoneTotals[zi]}</td>
                </tr>
              ))}
              <tr>
                <th className="dev-bi-rowh">Σ</th>
                {stats.bucketTotals.map((t, bi) => (
                  <td key={bi} className="dev-bi-coltot">
                    {t || ''}
                  </td>
                ))}
                <td className="dev-bi-grand">{totalIncid}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="dev-bi-note">行＝zone（按解锁顺序/代表深度排）·列＝深度桶顶深(m)·多 tag 事件在各自行各记一次·行 Σ＝该 tag 事件数。</div>
      </section>
    </>
  );
}

// ---------------------------------------------------------------------------
// TONE 分布
// ---------------------------------------------------------------------------

function ToneView({ stats }: { stats: EventStats }) {
  const { tones } = stats;
  const colors = tones.map((t, i) => toneColor(t, i));
  const toneTotals = tones.map((_, ti) => stats.toneByBucket[ti].reduce((a, b) => a + b, 0));
  const grand = toneTotals.reduce((a, b) => a + b, 0);
  const depthRowSums = stats.buckets.map((_, bi) => tones.reduce((s, _t, ti) => s + stats.toneByBucket[ti][bi], 0));
  const maxDepthRow = Math.max(1, ...depthRowSums);
  const zoneSums = stats.zones.map((_, zi) => tones.reduce((s, _t, ti) => s + stats.toneByZone[ti][zi], 0));

  return (
    <>
      <div className="dev-bi-kpis">
        {tones.map((t, ti) => (
          <div className="dev-bi-kpi" key={t}>
            <div className="dev-bi-kpi-num" style={{ color: colors[ti] }}>
              {toneTotals[ti]}
            </div>
            <div className="dev-bi-kpi-label">
              <span className="dev-bi-dot" style={{ background: colors[ti] }} />
              {t} · {pct(toneTotals[ti], grand)}%
            </div>
          </div>
        ))}
      </div>

      <section className="dev-bi-card">
        <h3 className="dev-bi-h">Tone 占比</h3>
        <div className="dev-bi-stackbar">
          {tones.map((t, ti) => {
            const w = pct(toneTotals[ti], grand);
            return w > 0 ? (
              <span
                key={t}
                className="dev-bi-stackbar-seg"
                style={{ width: `${w}%`, background: colors[ti] }}
                title={`${t}: ${toneTotals[ti]} (${w}%)`}
              >
                {w >= 8 ? `${w}%` : ''}
              </span>
            ) : null;
          })}
        </div>
        <div className="dev-bi-legendrow">
          {tones.map((t, ti) => (
            <span className="dev-bi-legenditem" key={t}>
              <span className="dev-bi-dot" style={{ background: colors[ti] }} />
              {t}
              <em>{toneTotals[ti]}</em>
            </span>
          ))}
        </div>
      </section>

      <div className="dev-bi-grid2">
        <section className="dev-bi-card">
          <h3 className="dev-bi-h">
            Tone × 深度 <span className="dev-bi-h-sub">体量·按入潜深度</span>
          </h3>
          <div className="dev-bi-stacks">
            {stats.buckets.map((b, bi) => (
              <div className="dev-bi-stack-row" key={b.label}>
                <span className="dev-bi-stack-label">{b.lo}m</span>
                <span className="dev-bi-stack-track">
                  {tones.map((t, ti) => {
                    const v = stats.toneByBucket[ti][bi];
                    const w = (v / maxDepthRow) * 100;
                    return w > 0 ? (
                      <span
                        key={t}
                        className="dev-bi-seg"
                        style={{ width: `${w}%`, background: colors[ti] }}
                        title={`${t} @ ${b.label}: ${v}`}
                      />
                    ) : null;
                  })}
                </span>
                <span className="dev-bi-stack-val">{depthRowSums[bi]}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="dev-bi-card">
          <h3 className="dev-bi-h">
            Tone × Zone <span className="dev-bi-h-sub">构成 100%·按解锁顺序</span>
          </h3>
          <div className="dev-bi-stacks">
            {stats.zones.map((zone, zi) => (
              <div className="dev-bi-stack-row" key={zone}>
                <span className="dev-bi-stack-label">{zone}</span>
                <span className="dev-bi-stack-track">
                  {tones.map((t, ti) => {
                    const v = stats.toneByZone[ti][zi];
                    const w = pct(v, zoneSums[zi]);
                    return w > 0 ? (
                      <span
                        key={t}
                        className="dev-bi-seg"
                        style={{ width: `${w}%`, background: colors[ti] }}
                        title={`${t} in ${zone}: ${v} (${w}%)`}
                      />
                    ) : null;
                  })}
                </span>
                <span className="dev-bi-stack-val">{zoneSums[zi]}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}
