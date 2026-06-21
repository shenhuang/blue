// EconomyDevPanel —— 素材经济可视化工作台 dev 面板（?editor=economy）
//
// 数据全走 engine/materialStats.ts::computeMaterialStats()（纯聚合·单一真相·与 CLI 同源）——本文件只渲染。
//
// 三 tab 共用**同一张** 素材×大区 热力图（材料行 × 大区列 + 总列·每格等宽等高）：
//   - 来源：格＝该区来源指数（ΣEV）·总＝总指数；点行 → 单框「来源明细」（来源/方式/概率）。
//   - 消耗：格＝该区消耗量·总＝总消耗；点行 → 单框「消耗明细」（场景/数量）。
//   - 状态：格＝每区净值（来源−消耗·绿盈红亏）·总＝状态（瓶颈/死货/死料）；点行 → 来源|消耗 左右两框对比。
// 未点行时三 tab 网格格式一致·只换内容/配色。来源框/消耗框格式跨 tab 一致（独图时单框·状态页时左右半框）。
//
// 边界：ui → engine 单向（engine ↛ ui 由 check-boundaries 规则一守）。

import { useMemo, useState, useEffect } from 'react';
import './dev-panel.css';
import {
  computeMaterialStats,
  type MaterialStat,
  type MaterialStatus,
} from '@/engine/materialStats';

export interface EconomyDevPanelProps {
  onClose?: () => void;
}

type Tab = 'source' | 'demand' | 'status';
const TABS: Array<{ key: Tab; label: string }> = [
  { key: 'source', label: '来源' },
  { key: 'demand', label: '消耗' },
  { key: 'status', label: '状态' },
];

// 配色：来源蓝·消耗琥珀·净值发散（绿盈/红亏）。
const blue = (v: number, max: number) =>
  v <= 0 || max <= 0 ? 'transparent' : `rgba(94, 196, 214, ${(0.1 + 0.7 * (v / max)).toFixed(3)})`;
const amber = (v: number, max: number) =>
  v <= 0 || max <= 0 ? 'transparent' : `rgba(210, 162, 76, ${(0.1 + 0.7 * (v / max)).toFixed(3)})`;
const diverge = (v: number, maxAbs: number) => {
  if (!v || maxAbs <= 0) return 'transparent';
  const a = (0.12 + 0.6 * (Math.abs(v) / maxAbs)).toFixed(3);
  return v > 0 ? `rgba(90, 178, 120, ${a})` : `rgba(202, 92, 80, ${a})`;
};

const STATUS_LABEL: Record<MaterialStatus, string> = {
  deadstock: '死货',
  bottleneck: '瓶颈',
  single: '单源',
  singleIdle: '纯卖',
  heavy: '重需求',
  ok: '✓',
};
function statusTag(m: MaterialStat): { label: string; cls: string } {
  if (m.deadstock) return { label: '死货', cls: 'dev-bi-tag-deadstock' };
  if (m.bottleneck) return { label: '瓶颈', cls: 'dev-bi-tag-bottleneck' };
  if (m.idle) return { label: '死料', cls: 'dev-bi-tag-idle' };
  return { label: STATUS_LABEL[m.status], cls: 'dev-bi-tag-quiet' };
}
const pct = (c: number) => `${Math.round(c * 100)}%`;
const num = (v: number) => (v ? (Number.isInteger(v) ? String(v) : v.toFixed(1)) : '');

export function EconomyDevPanel({ onClose }: EconomyDevPanelProps) {
  const stats = useMemo(() => computeMaterialStats(), []);
  const [tab, setTab] = useState<Tab>('source');
  const [tier, setTier] = useState('');
  const [selId, setSelId] = useState<string | null>(null);

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

  const tiers = useMemo(() => [...new Set(stats.materials.map((m) => m.tier))].sort(), [stats]);
  const rows = useMemo(
    () =>
      stats.materials
        .map((m, i) => ({ m, i }))
        .filter(({ m }) => !tier || m.tier === tier),
    [stats, tier],
  );

  // 各 tab 的色阶 max（只按当前显示行算）
  const maxSrc = useMemo(
    () => Math.max(1, ...rows.flatMap(({ i }) => stats.sourceIndex[i])),
    [rows, stats],
  );
  const maxDem = useMemo(
    () => Math.max(1, ...rows.flatMap(({ i }) => stats.demandMatrix[i])),
    [rows, stats],
  );
  const maxNet = useMemo(
    () => Math.max(1, ...rows.flatMap(({ i }) => stats.netMatrix[i].map(Math.abs))),
    [rows, stats],
  );

  const sel = selId ? stats.materials.find((m) => m.id === selId) ?? null : null;

  // 单格渲染（按 tab 取值 + 配色）
  function cell(mi: number, ri: number): { txt: string; bg: string } {
    if (tab === 'source') {
      const v = stats.sourceIndex[mi][ri];
      return { txt: num(v), bg: blue(v, maxSrc) };
    }
    if (tab === 'demand') {
      const v = stats.demandMatrix[mi][ri];
      return { txt: num(v), bg: amber(v, maxDem) };
    }
    const v = stats.netMatrix[mi][ri];
    return { txt: v ? (v > 0 ? `+${num(v)}` : num(v)) : '', bg: diverge(v, maxNet) };
  }
  const totalHead = tab === 'source' ? '总指数' : tab === 'demand' ? '总消耗' : '状态';

  return (
    <div className="dev-panel" role="dialog" aria-label="素材经济 dev 面板">
      <header className="dev-panel-header">
        <div>
          <div className="dev-panel-title">素材经济</div>
          <div className="dev-panel-sub">
            {stats.total} 素材 · {stats.regions.length} 大区 · 瓶颈 {stats.bottleneckCount} · 死货{' '}
            {stats.deadstockCount} · 死料 {stats.idleCount} · ?editor=economy
          </div>
        </div>
        <div className="dev-panel-header-actions">
          <div className="eco-tabs" role="tablist">
            {TABS.map((t) => (
              <button
                key={t.key}
                role="tab"
                aria-selected={tab === t.key}
                className={tab === t.key ? 'on' : ''}
                onClick={() => setTab(t.key)}
              >
                {t.label}
              </button>
            ))}
          </div>
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
              素材 × 大区{' '}
              <span className="dev-bi-h-sub">
                {tab === 'source'
                  ? '来源指数 (ΣEV·越高越好刷)'
                  : tab === 'demand'
                    ? '消耗量 (按设施所在区)'
                    : '净值 = 来源 − 消耗 (绿盈/红亏)'}
              </span>
            </h3>
            <span className="dev-bi-legend-cap">{rows.length} 行 · 点行看明细</span>
          </div>
          <div className="eco-grid-wrap">
            <table className="eco-grid">
              <thead>
                <tr>
                  <th className="eco-corner">素材 ＼ 大区</th>
                  {stats.regions.map((r) => (
                    <th key={r} className="eco-colh" title={r}>
                      {r}
                    </th>
                  ))}
                  <th className="eco-toth">{totalHead}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ m, i }) => {
                  const tg = statusTag(m);
                  return (
                    <tr
                      key={m.id}
                      className={`eco-row${selId === m.id ? ' sel' : ''}`}
                      onClick={() => setSelId(selId === m.id ? null : m.id)}
                    >
                      <th className="eco-rowhead" title={`${m.name} · ${m.id} · ${m.tier}`}>
                        {m.name}
                      </th>
                      {stats.regions.map((r, ri) => {
                        const c = cell(i, ri);
                        return (
                          <td
                            key={r}
                            className="eco-cell"
                            style={{ background: c.bg }}
                            title={`${m.name} · ${r} · ${c.txt || 0}`}
                          >
                            {c.txt}
                          </td>
                        );
                      })}
                      {tab === 'status' ? (
                        <td className="eco-total">
                          <span className={`dev-bi-tag ${tg.cls}`}>{tg.label}</span>
                        </td>
                      ) : (
                        <td
                          className="eco-total"
                          style={{
                            background:
                              tab === 'source'
                                ? blue(m.sourceIndexTotal, Math.max(1, ...rows.map((x) => x.m.sourceIndexTotal)))
                                : amber(m.totalDemand, Math.max(1, ...rows.map((x) => x.m.totalDemand))),
                          }}
                        >
                          {tab === 'source' ? num(m.sourceIndexTotal) : m.totalDemand || ''}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="eco-note">
            大区＝忠实内容标签（来源按 bands/zoneTags/zoneId·消耗按设施所在区·装备归「港口」）·每格等宽等高·
            多区来源在各区各记一次〔总指数为独立 ΣEV〕。
          </div>
        </section>

        {sel && (
          <section className="dev-bi-card">
            <div className="dev-bi-h-row">
              <h3 className="dev-bi-h">
                {sel.name} <span className="dev-bi-h-sub">{sel.id} · {sel.tier}</span>
              </h3>
              <button className="dev-btn dev-btn-tiny dev-btn-quiet" onClick={() => setSelId(null)}>
                收起
              </button>
            </div>
            <div className="eco-detail">
              {(tab === 'source' || tab === 'status') && <SourceBox m={sel} />}
              {(tab === 'demand' || tab === 'status') && <DemandBox m={sel} />}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 明细框（独图时单框·状态页左右两框·格式一致）
// ---------------------------------------------------------------------------

function methodCls(method: string): string {
  if (method === '挖矿') return 'eco-method eco-method-mine';
  if (method === '敌人') return 'eco-method eco-method-enemy';
  if (method === '深度柱') return 'eco-method eco-method-col';
  return 'eco-method';
}

function SourceBox({ m }: { m: MaterialStat }) {
  return (
    <div className="eco-detail-box">
      <div className="eco-detail-h">
        <span>来源明细</span>
        <span>{m.srcCount} 源 · 总指数 {m.sourceIndexTotal}</span>
      </div>
      {m.sources.length === 0 ? (
        <div className="eco-empty-d">无来源（死货）。</div>
      ) : (
        <table className="eco-dtable">
          <thead>
            <tr>
              <th>方式</th>
              <th>来源</th>
              <th>大区</th>
              <th className="num">概率</th>
              <th className="num">EV</th>
            </tr>
          </thead>
          <tbody>
            {m.sources.map((s, i) => (
              <tr key={i}>
                <td>
                  <span className={methodCls(s.method)}>{s.method}</span>
                </td>
                <td title={s.from}>{s.from}</td>
                <td>{s.regions.join('/') || s.zone}</td>
                <td className="num">{pct(s.chance)}</td>
                <td className="num">{s.ev}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function DemandBox({ m }: { m: MaterialStat }) {
  return (
    <div className="eco-detail-box">
      <div className="eco-detail-h">
        <span>消耗明细</span>
        <span>总消耗 {m.totalDemand}</span>
      </div>
      {m.demands.length === 0 ? (
        <div className="eco-empty-d">无消耗（纯卖 / 死料）。</div>
      ) : (
        <table className="eco-dtable">
          <thead>
            <tr>
              <th>场景</th>
              <th>大区</th>
              <th>类别</th>
              <th className="num">数量</th>
            </tr>
          </thead>
          <tbody>
            {m.demands.map((d, i) => (
              <tr key={i}>
                <td title={d.scenario}>{d.scenario}</td>
                <td>{d.region}</td>
                <td>{d.from}</td>
                <td className="num">{d.qty}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
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
