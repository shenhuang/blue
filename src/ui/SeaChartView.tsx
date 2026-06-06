// 港口海图选点 —— 2D 地图视图：港口在左，左→右 ≈ 离岸越远 / 越深；点位是可点的标记，
// 选中后右侧（手机为下方）信息面板显示该点详情 + 出海。
// 顶层 phase 'chart'（与 MiraShopView 同模式）。POI 数据/门控来自 engine/chart.ts；
// 实际出海走 engine/dive.ts::startDiveFromPoi。坐标来自 ChartPoi.mapX/mapY（缺省按 distance 兜底）。

import { useMemo, useState, useEffect } from 'react';
import type { GameState, ChartPoi } from '@/types';
import { generateChart, poiLockReason, isPoiDepartable, describeModifier } from '@/engine/chart';
import { startDiveFromPoi, startDiveFromOutpost } from '@/engine/dive';
import {
  getHomeLighthouse,
  getLighthouse,
  getOutposts,
  outpostStage,
  nextOutpostStage,
  canAdvanceOutpost,
  advanceOutpost,
  OUTPOST_MAX_STAGE,
  OUTPOST_USABLE_STAGE,
} from '@/engine/lighthouses';
import {
  effectiveRevealRadius,
  effectiveOutpostStage,
  outpostDecayLevel,
  outpostEnergy,
  maintainOutpost,
  canMaintainOutpost,
  depotCapacity,
  effectiveStored,
  storedUnits,
  depotDecayLevel,
  depositToDepot,
  withdrawFromDepot,
  canDeposit,
  OUTPOST_MAINTENANCE_COST,
} from '@/engine/outposts';
import { getBands } from '@/engine/bands';
import { getZone } from '@/engine/zones';
import { getUpgradeBonuses } from '@/engine/upgrades';
import { getItemDef } from '@/engine/items';
import { listRecoverableCorpses } from '@/engine/death';
import { LighthouseBuildPanel } from './LighthouseBuildPanel';

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

/** 海况一行文案（§6.5「活的海图」）：潮汐 + 天气；浓雾时提示「有处机会点这一拍没显出来」。 */
function conditionLine(c: { tide: 'flood' | 'ebb'; weather: 'clear' | 'mist' | 'fog' }): string {
  const tide = c.tide === 'flood' ? '涨潮' : '退潮';
  const weather = c.weather === 'clear' ? '晴' : c.weather === 'mist' ? '薄雾' : '浓雾';
  const fog = c.weather === 'fog' ? '——浓雾里有处机会点没显出来，潮一退就回来' : '';
  return `${tide} · ${weather}${fog}`;
}

export function SeaChartView({ state, onStateChange }: Props) {
  // 海图派生自 profile。除 runsCompleted（roaming 种子）外，还要在**中途点亮/升级灯塔**时重算——
  // 否则新进入灯塔范围的 POI 要等下个 run 才浮现（§6.5「即时新 POI 浮现」，#80 尾巴）。
  // 签名捕捉一切影响 reveal/可见性的 profile 态：灯塔（坐标 + 设施 + 衰减后有效半径）+ flags（requiresFlags / mimic 引诱门）。
  // roaming 选取 pool-independent（chart.ts roamingKey）→ 重算不重洗已显示的机会点，只让新点亮的浮现。
  const chartSig = useMemo(() => {
    const p = state.profile;
    const lh = p.lighthouses
      .map(
        (l) =>
          `${l.id}@${l.mapX.toFixed(3)},${l.mapY.toFixed(3)}:${[...l.builtUpgrades].sort().join('+')}:${effectiveRevealRadius(p, l).toFixed(3)}`,
      )
      .sort()
      .join('|');
    return `${p.runsCompleted}#${lh}#${[...p.flags].sort().join(',')}`;
  }, [state.profile]);
  const chart = useMemo(
    () => generateChart({ profile: state.profile }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chartSig],
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

  // 灯塔设施建造面板（灯塔在海图上可见，建造也在海图上）
  const [showBuild, setShowBuild] = useState(false);
  if (showBuild) {
    return (
      <LighthouseBuildPanel
        state={state}
        onStateChange={onStateChange}
        onClose={() => setShowBuild(false)}
      />
    );
  }

  function handleDepart(poi: ChartPoi, targetCorpseId?: string) {
    if (poiLockReason(state.profile, poi)) return;
    onStateChange(startDiveFromPoi(state, poi, { targetCorpseId }));
  }

  function handleLeave() {
    onStateChange({ ...state, phase: { kind: 'port' } });
  }

  // 深水区 Phase 1：从前哨「蛙跳」直接下到一个深度 band（本期最小版＝home 灯塔出潜）。
  // 软门控：band 不锁，列出全部——越深越黑，能不能活由装备（声呐/电量/升级）决定，不是开关。
  const home = getHomeLighthouse(state.profile);
  function handleOutpostDive(bandId: string) {
    onStateChange(startDiveFromOutpost(state, bandId));
  }

  return (
    <div className="port sea-chart">
      <header className="port-header">
        <h1>海图</h1>
        <p className="port-sub">摊在长桌上的旧海图，铅笔印一层盖一层。挑一个点。</p>
        <p className="chart-conditions">{conditionLine(chart.conditions)}</p>
        <div className="port-meta">
          银行 {state.profile.bankedGold} 金币
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

            {/* 灯塔节点 + 点亮范围（reveal）。半径用海图归一化坐标，渲染在 POI 之下。 */}
            {state.profile.lighthouses.map((lh) => {
              // 有效半径＝随前哨衰减收缩（深水区 Phase 2b 真 reveal dimming）：荒废的前哨光圈在海图上缩小。
              const r = effectiveRevealRadius(state.profile, lh);
              return (
                <div key={`lh-${lh.id}`}>
                  {/* §6.5 测绘扫描揭示：灯塔点亮/升级时播一记很慢的暖色 sweep（覆盖其点亮范围）。
                      key 绑灯塔签名 → 新灯塔或新设施时重挂＝重播（点亮的回报演出）；≠ 旋转探照灯（那是灯塔本身）。 */}
                  <span
                    key={`sweep-${lh.builtUpgrades.size}`}
                    className="chart-survey-sweep"
                    aria-hidden="true"
                    style={{
                      left: `${lh.mapX * 100}%`,
                      top: `${lh.mapY * 100}%`,
                      width: `${r * 2 * 100}%`,
                      height: `${r * 2 * 100}%`,
                    }}
                  />
                  <span
                    className="chart-light-radius"
                    aria-hidden="true"
                    style={{
                      left: `${lh.mapX * 100}%`,
                      top: `${lh.mapY * 100}%`,
                      width: `${r * 2 * 100}%`,
                      height: `${r * 2 * 100}%`,
                    }}
                  />
                  <span
                    className="chart-lighthouse"
                    aria-label={`灯塔：${lh.name}`}
                    style={{ left: `${lh.mapX * 100}%`, top: `${lh.mapY * 100}%` }}
                  >
                    <span className="chart-light-dot" />
                    <span className="chart-light-name">{lh.name}</span>
                  </span>
                </div>
              );
            })}

            {chart.pois.map((poi, idx) => {
              const { x, y } = poiPos(poi);
              const lock = poiLockReason(state.profile, poi);
              const isSel = selected?.id === poi.id;
              const cls = [
                'chart-map-poi',
                poi.persistent ? 'anchor' : 'roam',
                lock ? 'locked' : '',
                isSel ? 'sel' : '',
                'chart-poi-arrive',
              ]
                .filter(Boolean)
                .join(' ');
              return (
                <button
                  key={poi.id}
                  type="button"
                  className={cls}
                  style={{ left: `${x * 100}%`, top: `${y * 100}%`, animationDelay: `${0.12 * idx}s` }}
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

      {home && (
        <div className="chart-outpost-dive">
          <h3 className="chart-outpost-title">深潜 · 蛙跳（试验）</h3>
          <p className="dim">
            从{home.name}直接下到更深的水段。越深越黑——没有声呐和电量，别硬下。
          </p>
          <div className="chart-band-list">
            {getBands().map((b) => (
              <button
                key={b.id}
                className="btn small chart-band-btn"
                onClick={() => handleOutpostDive(b.id)}
                title={b.danger ?? ''}
              >
                {b.name}（{b.depthRange[0]}–{b.depthRange[1]}m）
              </button>
            ))}
          </div>
        </div>
      )}

      <OutpostPanel state={state} onStateChange={onStateChange} />

      <div className="chart-actions">
        <button className="btn" onClick={() => setShowBuild(true)}>
          灯塔设施
        </button>
        <button className="btn" onClick={handleLeave}>
          卷起海图（回港口）
        </button>
      </div>
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

      {poi.mimic && (
        <p className="chart-info-tell uncanny">
          ⚠ 你数过自己点亮的每一盏灯——没有一盏在这儿。它亮着，却不在你的网里。交叉比对的结果只有一个：这不是你点的光。
        </p>
      )}

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

/**
 * 深水前哨面板（深水区 Phase 2b · UI surfacing）：把 2a「建造走 dive 事件」补一个海图上的直观入口——
 * 分阶段建造（advanceOutpost）+ 维护衰减（maintainOutpost）+ 能源/衰减/半亮状态。蛙跳出潜点本身仍走上面的
 * band 列表（半亮前哨自动缩短预耗氧、收益透明）。账单从 profile 银行出（同 advanceOutpost）。
 */
function OutpostPanel({ state, onStateChange }: Props) {
  const outposts = getOutposts();
  if (outposts.length === 0) return null;

  return (
    <div className="chart-outposts">
      <h3 className="chart-outpost-title">深水前哨</h3>
      <p className="dim">
        跨次下潜分阶段修建的落脚点：半亮（{OUTPOST_USABLE_STAGE}/{OUTPOST_MAX_STAGE}）即可当蛙跳出潜点。
        水下前哨会随时间荒废——变暗、补给掉线、退回半亮，得回来维护。料从岸上家底里出。
      </p>
      <ul className="chart-outpost-list">
        {outposts.map((o) => {
          const stage = outpostStage(state.profile, o.id);
          const effStage = effectiveOutpostStage(state.profile, o.id);
          const lit = stage >= OUTPOST_MAX_STAGE;
          const usable = effStage >= OUTPOST_USABLE_STAGE;
          const decay = outpostDecayLevel(state.profile, o.id);
          const next = nextOutpostStage(state.profile, o.id);
          const canBuild = canAdvanceOutpost(state.profile, o.id);
          const lh = getLighthouse(state.profile, o.result.id);
          const energy = lh ? outpostEnergy(state.profile, lh) : null;
          const maint = canMaintainOutpost(state.profile, o.id);

          // 材料中转站（深水区 Phase 2b 续）：建了中转站（storageCapacity>0）的前哨才显示寄存区。
          const cap = depotCapacity(state.profile, o.id);
          const stored = cap > 0 ? effectiveStored(state.profile, o.id) : [];
          const depotUsed = storedUnits(stored);
          const depotDecay = cap > 0 ? depotDecayLevel(state.profile, o.id) : 0;
          // 可寄存的相关材料＝维护材料 ∪ 下一阶段材料（最常想前置到深处的料），取仓库里有的。
          const depositables =
            cap > 0
              ? Array.from(
                  new Set([
                    ...OUTPOST_MAINTENANCE_COST.materials.map((m) => m.itemId),
                    ...(next?.cost.materials.map((m) => m.itemId) ?? []),
                  ]),
                )
              : [];

          const status = lit
            ? usable
              ? '已点亮'
              : '荒废 · 蛙跳失效'
            : stage === 0
              ? '未动工'
              : `修建中 ${stage}/${OUTPOST_MAX_STAGE}${usable ? ' · 半亮可用' : ''}`;

          return (
            <li key={o.id} className="chart-outpost-item">
              <div className="chart-outpost-head">
                <span className="chart-outpost-name">{o.name}</span>
                <span className="dim chart-outpost-status" aria-label={`${o.name} 状态：${status}`}>
                  {status}
                </span>
              </div>
              {energy && (
                <span className="dim chart-outpost-energy">
                  能源 {energy.capacity}（占用 {energy.demand}
                  {energy.demand > energy.capacity ? ' · 部分补给掉线' : ''}）
                  {decay > 0 ? ` · 衰减 ${decay}` : ''}
                </span>
              )}
              <div className="chart-outpost-actions">
                {next && (
                  <button
                    className="btn small chart-outpost-build"
                    disabled={!canBuild}
                    onClick={() => onStateChange(advanceOutpost(state, o.id))}
                  >
                    {next.label}
                  </button>
                )}
                {decay > 0 && (
                  <button
                    className="btn small chart-outpost-maintain"
                    disabled={!maint.ok}
                    onClick={() => onStateChange(maintainOutpost(state, o.id))}
                  >
                    维护
                  </button>
                )}
              </div>
              {cap > 0 && (
                <div className="chart-outpost-depot">
                  <span className="dim chart-outpost-depot-head">
                    中转站 {depotUsed}/{cap}
                    {depotDecay > 0 ? ` · 锈蚀 ${depotDecay}（存料在流失，回来补一补）` : ''}
                  </span>
                  {stored.length > 0 && (
                    <ul className="chart-depot-stored">
                      {stored.map((m) => (
                        <li key={m.itemId} className="chart-depot-item">
                          <span className="chart-depot-mat">
                            {getItemDef(m.itemId)?.name ?? m.itemId}×{m.qty}
                          </span>
                          <button
                            className="btn small chart-depot-withdraw"
                            onClick={() => onStateChange(withdrawFromDepot(state, o.id, m.itemId, 1))}
                          >
                            取
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="chart-depot-deposit">
                    {depositables.map((itemId) => {
                      const have = state.profile.inventory.find((i) => i.itemId === itemId)?.qty ?? 0;
                      const dep = canDeposit(state.profile, o.id, itemId, 1);
                      return (
                        <button
                          key={itemId}
                          className="btn small chart-depot-store"
                          disabled={!dep.ok}
                          title={`岸上仓库：${have}`}
                          onClick={() => onStateChange(depositToDepot(state, o.id, itemId, 1))}
                        >
                          存 {getItemDef(itemId)?.name ?? itemId}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
