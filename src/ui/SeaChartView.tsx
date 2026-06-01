// 港口海图选点 —— 2D 地图视图：港口在左，左→右 ≈ 离岸越远 / 越深；点位是可点的标记，
// 选中后右侧（手机为下方）信息面板显示该点详情 + 出海。
// 顶层 phase 'chart'（与 MiraShopView 同模式）。POI 数据/门控来自 engine/chart.ts；
// 实际出海走 engine/dive.ts::startDiveFromPoi。坐标来自 ChartPoi.mapX/mapY（缺省按 distance 兜底）。

import { useMemo, useState, useEffect } from 'react';
import type { GameState, ChartPoi } from '@/types';
import { generateChart, poiLockReason, isPoiDepartable, describeModifier } from '@/engine/chart';
import { startDiveFromPoi } from '@/engine/dive';
import { getZone } from '@/engine/zones';
import { getUpgradeBonuses } from '@/engine/upgrades';
import { listRecoverableCorpses } from '@/engine/death';

interface Props {
  state: GameState;
  onStateChange: (s: GameState) => void;
}

/** 标记点归一化坐标；数据缺省时按 distance 兜底（左→右 ≈ 越远） */
function poiPos(poi: ChartPoi): { x: number; y: number } {
  return {
    x: poi.mapX ?? Math.min(0.85, 0.18 + poi.distance * 0.27),
    y: poi.mapY ?? 0.5,
  };
}

export function SeaChartView({ state, onStateChange }: Props) {
  // 海图派生自 profile；出海前 profile 不变，按 runsCompleted 记忆即可（roaming 的种子）
  const chart = useMemo(
    () => generateChart({ profile: state.profile }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.profile.runsCompleted],
  );

  // 打捞行会 Lv.2：出海前可选定一具尸体作为本次目标（保证出现在图里）
  const canSelectTarget = getUpgradeBonuses(state.profile).preDiveCorpseSelect;

  // 默认选中第一个"可出海"的点，保证信息面板有内容、出海按钮可见
  const defaultId =
    chart.pois.find((p) => isPoiDepartable(state.profile, p))?.id ?? chart.pois[0]?.id ?? '';
  const [selectedId, setSelectedId] = useState<string>(defaultId);
  const selected =
    chart.pois.find((p) => p.id === selectedId) ??
    chart.pois.find((p) => p.id === defaultId) ??
    null;

  // 切换点位时清掉"锁定目标"（lift 到此处，便于 useEffect 重置）
  const [target, setTarget] = useState<string>('');
  useEffect(() => setTarget(''), [selected?.id]);

  function handleDepart(poi: ChartPoi, targetCorpseId?: string) {
    if (poiLockReason(state.profile, poi)) return;
    onStateChange(startDiveFromPoi(state, poi, { targetCorpseId }));
  }

  function handleLeave() {
    onStateChange({ ...state, phase: { kind: 'port' } });
  }

  return (
    <div className="port sea-chart">
      <header className="port-header">
        <h1>海图</h1>
        <p className="port-sub">摊在长桌上的旧海图，铅笔印一层盖一层。挑一个点。</p>
        <div className="port-meta">
          建设值 {state.profile.buildingPoints} ・ 银行 {state.profile.bankedGold} 金币
        </div>
      </header>

      {chart.pois.length === 0 ? (
        <p className="dim chart-empty">海图上还没有你能去的点。先完成资格潜水。</p>
      ) : (
        <div className="chart-2d">
          <div className="chart-map">
            <div className="chart-coast" aria-hidden="true" />
            <div className="chart-port">
              <span className="chart-port-dot" />港
            </div>
            <span className="chart-axis" style={{ left: '20%' }}>近岸</span>
            <span className="chart-axis" style={{ left: '50%' }}>中段</span>
            <span className="chart-axis" style={{ left: '80%' }}>远海</span>

            {chart.pois.map((poi) => {
              const { x, y } = poiPos(poi);
              const lock = poiLockReason(state.profile, poi);
              const isSel = selected?.id === poi.id;
              const cls = [
                'chart-map-poi',
                poi.persistent ? 'anchor' : 'roam',
                lock ? 'locked' : '',
                isSel ? 'sel' : '',
              ]
                .filter(Boolean)
                .join(' ');
              return (
                <button
                  key={poi.id}
                  type="button"
                  className={cls}
                  style={{ left: `${x * 100}%`, top: `${y * 100}%` }}
                  aria-label={lock ? `${poi.name}（${lock}）` : poi.name}
                  onClick={() => setSelectedId(poi.id)}
                >
                  <span className="chart-dot" />
                  <span className="chart-poi-name">{poi.name}</span>
                </button>
              );
            })}
          </div>

          <div className="chart-legend">
            <span><i className="chart-swatch anchor" />锚点</span>
            <span><i className="chart-swatch roam" />机会点（潮位常变）</span>
            <span><i className="chart-swatch locked" />未解锁</span>
          </div>

          {selected && (
            <ChartInfo
              poi={selected}
              state={state}
              canSelectTarget={canSelectTarget}
              target={target}
              setTarget={setTarget}
              onDepart={handleDepart}
            />
          )}
        </div>
      )}

      <button className="btn" onClick={handleLeave}>
        卷起海图（回港口）
      </button>
    </div>
  );
}

function ChartInfo({
  poi,
  state,
  canSelectTarget,
  target,
  setTarget,
  onDepart,
}: {
  poi: ChartPoi;
  state: GameState;
  canSelectTarget: boolean;
  target: string;
  setTarget: (v: string) => void;
  onDepart: (poi: ChartPoi, targetCorpseId?: string) => void;
}) {
  const zone = getZone(poi.zoneId);
  const lock = poiLockReason(state.profile, poi);
  const mods = describeModifier(poi.modifier);
  const corpses = canSelectTarget ? listRecoverableCorpses(state.profile.deaths, poi.zoneId) : [];
  const showPicker = !lock && corpses.length > 0;

  return (
    <div className={`chart-info ${lock ? 'locked' : ''}`}>
      <div className="chart-info-head">
        <h3 className="chart-info-name">{poi.name}</h3>
        <span className="dim chart-info-zone">
          {zone?.name ?? poi.zoneId}
          {!poi.persistent && ' · 机会点'}
        </span>
      </div>

      <div className="chart-tags">
        {poi.distance > 0 && <span className="chart-tag dist">距岸 {poi.distance}</span>}
        {mods.map((m, i) => (
          <span key={i} className="chart-tag mod">
            {m}
          </span>
        ))}
      </div>

      <p className="chart-info-blurb">{poi.blurb}</p>

      {showPicker && (
        <label className="chart-poi-target">
          <span className="dim">锁定目标（打捞行会）</span>
          <select
            className="chart-target-select"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
          >
            <option value="">不锁定 · 随缘</option>
            {corpses.map((d) => (
              <option key={d.id} value={d.id}>
                {d.diverName} · {d.depthAtDeath}m · {d.cause}（{d.inventorySnapshot.length} 件）
              </option>
            ))}
          </select>
        </label>
      )}

      {lock ? (
        <button className="btn small" disabled title={lock}>
          {lock}
        </button>
      ) : (
        <button className="btn small" onClick={() => onDepart(poi, target || undefined)}>
          {showPicker && target ? '出海（带着目标）' : '出海'}
        </button>
      )}
    </div>
  );
}
