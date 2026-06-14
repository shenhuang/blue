// 港口海图选点 —— 2D 地图视图：港口在左，左→右 ≈ 离岸越远 / 越深；点位是可点的标记，
// 选中后右侧（手机为下方）信息面板显示该点详情 + 出海。
// 顶层 phase 'chart'（与 MiraShopView 同模式）。POI 数据/门控来自 engine/chart.ts；
// 实际出海走 engine/dive.ts::startDiveFromPoi。坐标来自 ChartPoi.mapX/mapY（缺省按 distance 兜底）。

import { useMemo, useState, useEffect, useRef } from 'react';
import type { GameState, ChartPoi, InventoryItem } from '@/types';
import { generateChart, poiLockReason, poiBlockReason, isPoiDepartable, describeModifier, describeCaveShape } from '@/engine/chart';
import { startDiveFromPoi, carryCapacityFor } from '@/engine/dive';
import { toPort } from '@/engine/transitions';
import {
  getHomeLighthouse,
  getLighthouse,
  getOutposts,
  outpostStage,
  nextOutpostStage,
  canAdvanceOutpost,
  advanceOutpost,
  devAdvanceOutpost,
  devRevealOutpost,
  devUnlockChapterRegion,
  isChapterOutpost,
  isOutpostDiscovered,
  outpostUnlocked,
  revealRadius,
  OUTPOST_MAX_STAGE,
  OUTPOST_USABLE_STAGE,
} from '@/engine/lighthouses';
import { outpostEnergy } from '@/engine/outposts';
import { getZone } from '@/engine/zones';
import { getUpgradeBonuses } from '@/engine/upgrades';
import { getItemDef } from '@/engine/items';
import { listRecoverableCorpses } from '@/engine/death';
import { LighthouseBuildPanel } from './LighthouseBuildPanel';
import { ChartViewport, type ChartContentBox } from './ChartViewport';
import { HOME_LIGHTHOUSE_ID } from '@/engine/state';
import { regionForOwner, flagGatedRegions } from '@/engine/regions';
import { DEV_TOOLS } from './devMode';
import { ItemCell, EmptyCell } from './ItemCell';

/** 地图节点弹窗选择态：点击前哨 → 建造/能源/设施/章节蛙跳。（家灯塔 + 已点亮前哨灯塔点击直接开灯塔设施面板·灯塔/蛙跳重构 step ③） */
type MapPopup = { kind: 'home' } | { kind: 'outpost'; id: string };

interface Props {
  state: GameState;
  onStateChange: (s: GameState) => void;
}

/**
 * 最小可视跨度（区域揭示·§10 规格④「最 zoom-in ＝ 开始场景跨度」·世界单位·tunable）。
 * 作者在场调手感最佳——这是「能放多近」的下限，不是初始取景（初始由 contentBox 全览 autozoom）。
 */
const MIN_VIEW_SPAN = 0.18; // #131 续：0.55→0.18（POI 密集时能放更近；配合标记 counter-scale 不随 zoom 放大＝点能点到）

// 揭示圈分色/形状由**区域配置**给（区域揭示配置化 SPEC·data-driven·跨章复用）：
// regionForOwner(灯塔 id) → palette(cyan/green/blue/amber/navy) + shape(circle/coast)。
// 无配置的灯塔（深脊柱前哨 / 未配置废墟）不画揭示圈、不在本图渲染（守作者「只这几片分离区」）。
// 半径仍由 revealRadius（衰减已删·#125）给——圈即 reveal 边界，诚实轴不破。

/** 标记点归一化坐标；数据缺省时按 distance 兜底（左→右 ≈ 越远） */
function poiPos(poi: ChartPoi): { x: number; y: number } {
  return {
    x: poi.mapX ?? Math.min(0.85, 0.18 + poi.distance * 0.27),
    y: poi.mapY ?? 0.5,
  };
}

/** 测绘扫描总时长（秒·区域揭示 §10 C3「扫描比声呐慢很多」·tunable·须与 .chart-survey-sweep 动画时长一致）。 */
const SWEEP_SECONDS = 5;

/**
 * POI「波到才亮」的淡入延迟（区域揭示 §10 C2·作者 2026-06-14 改 per-哨站）：只看**正在扫描的灯塔**——
 * 返回 poi 到「正在扫且覆盖它的最近灯塔」的归一化距离 / 该灯塔半径 × 总时长（扫描边缘扫到它才浮现）。
 * 没有正在扫的灯塔覆盖它 → null＝该点不参与本轮扫描动画（静态显示·如已 settled 的区 / 恒显剧情锚点）。
 */
function poiSweepDelay(
  profile: GameState['profile'],
  poi: ChartPoi,
  sweepingLhIds: Set<string>,
): number | null {
  const { x, y } = poiPos(poi);
  let best = Infinity;
  for (const lh of profile.lighthouses) {
    if (!sweepingLhIds.has(lh.id)) continue;
    const r = revealRadius(lh);
    if (r <= 0) continue;
    const d = Math.hypot(lh.mapX - x, lh.mapY - y);
    if (d <= r) best = Math.min(best, (d / r) * SWEEP_SECONDS);
  }
  return Number.isFinite(best) ? best : null;
}

/** 海况一行文案（§6.5「活的海图」）：潮汐 + 天气；浓雾时提示「有处机会点这一拍没显出来」。 */
function conditionLine(c: { tide: 'flood' | 'ebb'; weather: 'clear' | 'mist' | 'fog' }): string {
  const tide = c.tide === 'flood' ? '涨潮' : '退潮';
  const weather = c.weather === 'clear' ? '晴' : c.weather === 'mist' ? '薄雾' : '浓雾';
  const fog = c.weather === 'fog' ? '——浓雾压着，有处地方这一拍看不见，潮一退就回来' : '';
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
          `${l.id}@${l.mapX.toFixed(3)},${l.mapY.toFixed(3)}:${[...l.builtUpgrades].sort().join('+')}:${revealRadius(l).toFixed(3)}`,
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

  // 世界内容包围盒（区域揭示·随解锁外扩）：可见 POI + 各灯塔点亮圈（中心 ± 有效半径）。
  // memo 同 chartSig（解锁/点亮即重算）→ ChartViewport 据 fitKey 变化 autozoom 到新边界。
  const contentBox = useMemo<ChartContentBox>(() => {
    let minX = 1;
    let minY = 1;
    let maxX = 0;
    let maxY = 0;
    const grow = (x: number, y: number) => {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    };
    for (const lh of state.profile.lighthouses) {
      // 只取灯塔中心、不含巨大揭示半径——让 fit 贴合 POI/灯塔点，揭示圈渐变铺出框外（不撑出大片空水域·作者 2026-06-13）。
      grow(lh.mapX, lh.mapY);
    }
    for (const p of chart.pois) {
      const { x, y } = poiPos(p);
      grow(x, y);
    }
    if (minX > maxX) return { minX: 0, minY: 0, maxX: 1, maxY: 1 }; // 空 → 全图兜底
    // 钳进世界 [0,1]（海岸线在 x=0；圈左半伸进陆地不计入边界）。
    return {
      minX: Math.max(0, minX),
      minY: Math.max(0, minY),
      maxX: Math.min(1, maxX),
      maxY: Math.min(1, maxY),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chartSig, chart]);

  // 打捞行会 Lv.2：出海前可选定一具尸体作为本次目标（保证出现在图里）
  const canSelectTarget = getUpgradeBonuses(state.profile).preDiveCorpseSelect;

  // 默认选中第一个"可出海"的点，保证信息面板有内容、出海按钮可见
  const defaultId =
    chart.pois.find((p) => isPoiDepartable(state.profile, p))?.id ?? chart.pois[0]?.id ?? '';
  const [selectedId, setSelectedId] = useState<string>(defaultId);
  // selectedId='' （点灯塔/前哨时清空·互斥）→ **不回退 defaultId**（否则资格区等默认点仍高亮·
  // 破「同一时间只一个 POI 点亮」·作者 2026-06-14 #4）。初次进图由 useState(defaultId) 给默认选中。
  const selected = chart.pois.find((p) => p.id === selectedId) ?? null;

  // 切换点位时清掉"锁定目标"（lift 到此处，便于 useEffect 重置）
  const [target, setTarget] = useState<string>('');
  useEffect(() => setTarget(''), [selected?.id]);

  // 行前装包（猎手 SPEC §4 data 面·作者拍板「出发前选带·死了就没」·#108；2026-06-10 作者改拍
  // 「格子化」：背包格上限可见 + 储物柜格点击互转）：itemId → 勾选数量。
  // 仓库里的消耗品（decoy / 急救包等）勾了才随身下水；POI 出海与蛙跳共用同一份勾选。
  const [carry, setCarry] = useState<Record<string, number>>({});
  const carryables = state.profile.inventory.filter(
    (i) => i.qty > 0 && getItemDef(i.itemId)?.category === 'consumable',
  );
  const carryPicks: InventoryItem[] = Object.entries(carry)
    .filter(([, q]) => q > 0)
    .map(([itemId, qty]) => ({ itemId, qty }));
  // 容量与占格：与 createNewRun/applyCarryItems 同源（carryCapacityFor·slotsRequired），UI 画的格数＝真截断线。
  const carryCapacity = carryCapacityFor(state.profile);
  const slotsUsed = carryPicks.reduce(
    (a, p) => a + (getItemDef(p.itemId)?.slotsRequired ?? 1) * p.qty,
    0,
  );
  const stepCarry = (itemId: string, delta: number, max: number) =>
    setCarry((c) => ({ ...c, [itemId]: Math.max(0, Math.min(max, (c[itemId] ?? 0) + delta)) }));

  // 地图节点弹窗（点灯塔/前哨标记时显示；设了则压住 ChartInfo）
  const [mapPopup, setMapPopup] = useState<MapPopup | null>(null);

  // 测绘扫描持久态（Step 3·§10 C3）：
  //   sweepActive = 当前 chartSig 与上次扫描记录不同 → 播扫描动画。
  //   第一次打开图 / 灯塔/设施变动 / 新回合 → sweepActive=true；动画播过后写回 profile 不再重播。
  //   用 ref 避免写回触发的二次 effect（profile.chartSurveySig 改变会让 state 变但 chartSig 不变）。
  // 每哨站扫描（区域揭示·作者 2026-06-14：解锁/潮汐只让**受影响的灯塔**扫描，不是全图一起扫）。
  // 每座（有区域配置的）灯塔的签名＝它点亮的 POI 集（id+三态）+ 有效半径；签名变了才扫它（新灯塔=新签名=必扫）。
  // 持久 profile.outpostScanSig（per 灯塔）记各灯塔上次扫到的签名。
  const sweepSigByLh = useMemo(() => {
    const m: Record<string, string> = {};
    for (const lh of state.profile.lighthouses) {
      if (!regionForOwner(lh.id)) continue;
      const r = revealRadius(lh);
      const within = chart.pois
        .filter((p) => {
          const { x, y } = poiPos(p);
          return Math.hypot(lh.mapX - x, lh.mapY - y) <= r;
        })
        .map((p) => `${p.id}:${p.revealState ?? 'lit'}`)
        .sort();
      m[lh.id] = `${r.toFixed(3)}|${within.join(',')}`;
    }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chartSig, chart]);

  const persistedScan = state.profile.outpostScanSig ?? {};
  const sweepingLhIds = useMemo(
    () => new Set(Object.keys(sweepSigByLh).filter((id) => sweepSigByLh[id] !== persistedScan[id])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sweepSigByLh, state.profile.outpostScanSig],
  );
  const anySweeping = sweepingLhIds.size > 0;

  // 扫描动画播完 SWEEP_SECONDS 后，把正在扫的灯塔的新签名写回（之后它们 settled、不再扫）。
  // 立刻写会让本轮扫描一帧即停（之前的全局 bug 同理）——故延后到动画播完。stateRef 取最新 state 防覆盖期间其它变更。
  const scanWrittenRef = useRef<string>('');
  const stateRef = useRef(state);
  stateRef.current = state;
  const sweepKey = useMemo(
    () => [...sweepingLhIds].sort().map((id) => `${id}=${sweepSigByLh[id]}`).join('|'),
    [sweepingLhIds, sweepSigByLh],
  );
  useEffect(() => {
    if (!anySweeping || scanWrittenRef.current === sweepKey) return;
    scanWrittenRef.current = sweepKey;
    const t = setTimeout(() => {
      const s = stateRef.current;
      const merged = { ...(s.profile.outpostScanSig ?? {}) };
      for (const id of sweepingLhIds) merged[id] = sweepSigByLh[id];
      onStateChange({ ...s, profile: { ...s.profile, outpostScanSig: merged } });
    }, SWEEP_SECONDS * 1000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sweepKey, anySweeping]);

  // 「该消失的消失」：再扫时被移除的点保留渲染、随**正在扫描的灯塔**边缘到达逐个淡出（无扫描则不留尾巴）。
  const prevPoisRef = useRef<ChartPoi[]>(chart.pois);
  const currentPoiIds = new Set(chart.pois.map((p) => p.id));
  const leavingPois = anySweeping
    ? prevPoisRef.current.filter((p) => !currentPoiIds.has(p.id))
    : [];
  useEffect(() => {
    if (!anySweeping) prevPoisRef.current = chart.pois;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anySweeping, chartSig]);

  // 灯塔设施建造面板（灯塔/蛙跳重构 step ③：点海图上的灯塔/前哨节点 → 开此面板·聚焦该灯塔；不再有底部全局入口）。
  // buildFocusId: null=未开 / 灯塔 id=聚焦该灯塔。
  const [buildFocusId, setBuildFocusId] = useState<string | null>(null);
  if (buildFocusId !== null) {
    return (
      <LighthouseBuildPanel
        state={state}
        focusLighthouseId={buildFocusId || undefined}
        onStateChange={onStateChange}
        onClose={() => setBuildFocusId(null)}
      />
    );
  }

  function handleDepart(poi: ChartPoi, targetCorpseId?: string) {
    if (!isPoiDepartable(state.profile, poi)) return; // 三态：仅 lit 可出海（暗点 / 天气遮蔽挡住）
    onStateChange(startDiveFromPoi(state, poi, { targetCorpseId, carryItems: carryPicks }));
  }

  function handleLeave() {
    onStateChange(toPort(state));
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

      {/* dev 直接解锁任意大区（作者 2026-06-14）：不必先在地图上找哨站标记点开——这里一键解锁本图任一章节区。
          列出本图配置了区域、且尚未点亮的章节前哨；点击＝devUnlockChapterRegion（置 flag + 连推点亮）。 */}
      {DEV_TOOLS && (
        <div className="chart-dev-unlock">
          <span className="dim">dev · 解锁大区：</span>
          {getOutposts()
            .filter(
              (o) =>
                isChapterOutpost(o) &&
                regionForOwner(o.result.id) &&
                outpostStage(state.profile, o.id) < OUTPOST_MAX_STAGE,
            )
            .map((o) => (
              <button
                key={o.id}
                type="button"
                className="btn small chart-dev-unlock-btn"
                onClick={() => onStateChange(devUnlockChapterRegion(state, o.id))}
              >
                {regionForOwner(o.result.id)?.label ?? o.name}
              </button>
            ))}
          <button
            type="button"
            className="btn small chart-dev-unlock-btn"
            onClick={() => {
              let s = state;
              for (const o of getOutposts().filter((x) => isChapterOutpost(x) && regionForOwner(x.result.id))) {
                s = devUnlockChapterRegion(s, o.id);
              }
              onStateChange(s);
            }}
          >
            全部
          </button>
        </div>
      )}

      {chart.pois.length === 0 ? (
        <p className="dim chart-empty">海图上还没有你能去的点。先完成资格潜水。</p>
      ) : (
        <div className="chart-2d">
          <ChartViewport contentBox={contentBox} minSpan={MIN_VIEW_SPAN} fitKey={chartSig}>
            <div className="chart-coast" aria-hidden="true" />
            <span className="chart-axis" style={{ left: '20%' }}>近岸</span>
            <span className="chart-axis" style={{ left: '50%' }}>中段</span>
            <span className="chart-axis" style={{ left: '80%' }}>远海</span>

            {/* 灯塔节点 + 点亮范围（reveal）。半径用海图归一化坐标，渲染在 POI 之下。 */}
            {state.profile.lighthouses.filter((lh) => regionForOwner(lh.id)).map((lh) => {
              // 只渲染本图配置了区域的灯塔（家 + 已点亮的章节前哨）；半径随前哨衰减收缩（Phase 2b）。
              const region = regionForOwner(lh.id)!;
              const r = revealRadius(lh);
              const isHome = lh.id === HOME_LIGHTHOUSE_ID;
              // 家灯塔 → popup 蛙跳列表；前哨灯塔（点亮的前哨）→ popup 建造/维护面板。
              const outpostId = getOutposts().find((o) => o.result.id === lh.id)?.id;
              const popupTarget: MapPopup = isHome
                ? { kind: 'home' }
                : outpostId ? { kind: 'outpost', id: outpostId } : { kind: 'home' };
              const isActive = mapPopup?.kind === popupTarget.kind &&
                (popupTarget.kind === 'home' || ('id' in popupTarget && 'id' in (mapPopup ?? {}) && (mapPopup as { id: string }).id === popupTarget.id));
              return (
                <div key={`lh-${lh.id}`}>
                  {/* 每哨站测绘扫描（作者 2026-06-14）：只有该灯塔的点亮 POI 集变了（解锁/潮汐）才扫它，不全图一起扫。 */}
                  {sweepingLhIds.has(lh.id) && (
                    <span
                      className="chart-survey-sweep"
                      aria-hidden="true"
                      style={{
                        left: `${lh.mapX * 100}%`,
                        top: `${lh.mapY * 100}%`,
                        width: `${r * 2 * 100}%`,
                        height: `${r * 2 * 100}%`,
                      }}
                    />
                  )}
                  <span
                    className={`chart-light-radius chart-reveal-circle reveal-${region.palette}${region.shape === 'coast' ? ' reveal-coast' : ''}`}
                    aria-hidden="true"
                    style={{
                      left: `${lh.mapX * 100}%`,
                      top: `${lh.mapY * 100}%`,
                      width: `${r * 2 * 100}%`,
                      height: `${r * 2 * 100}%`,
                    }}
                  />
                  {/* 灯塔标记：可点击，弹出 popup（家灯塔=蛙跳选 band；前哨=建造/维护/蛙跳）。 */}
                  <button
                    type="button"
                    className={`chart-lighthouse chart-lighthouse-btn${isActive ? ' sel' : ''}`}
                    aria-label={`灯塔：${lh.name}`}
                    style={{ left: `${lh.mapX * 100}%`, top: `${lh.mapY * 100}%` }}
                    onClick={() => {
                      setSelectedId(''); // 关 POI 信息
                      // 灯塔/蛙跳重构 step ③：点灯塔节点（家/前哨）→ 弹 popup·里面有「灯塔设施」入口（家＝HomePopup·前哨＝OutpostPopup·交互一致）。
                      setMapPopup(isActive ? null : popupTarget);
                    }}
                  >
                    <span className="chart-light-dot" />
                    <span className="chart-light-name">{lh.name}</span>
                  </button>
                </div>
              );
            })}

            {/* flag-gated 揭示区（owner-less·鲸落区起·区域揭示配置化 SPEC §10）：revealFlag 满足才画——
                圈心=显式 center、半径=region.radius（无灯塔→无衰减）。与 owner 灯塔圈同款渲染（reveal-<palette>），
                但不带灯塔标记/popup（区不是哨站·§10「没有真正的哨站」）。圈内 POI 由 isLit 正常揭示。 */}
            {flagGatedRegions().map((region) => {
              if (!region.center || !region.revealFlag || !state.profile.flags.has(region.revealFlag)) return null;
              return (
                <span
                  key={`region-${region.id}`}
                  className={`chart-light-radius chart-reveal-circle reveal-${region.palette}${region.shape === 'coast' ? ' reveal-coast' : ''}`}
                  aria-hidden="true"
                  style={{
                    left: `${region.center.x * 100}%`,
                    top: `${region.center.y * 100}%`,
                    width: `${region.radius * 2 * 100}%`,
                    height: `${region.radius * 2 * 100}%`,
                  }}
                />
              );
            })}

            {/* 未点亮的前哨标记（发现后但尚未建满）：渲染在灯塔之上、POI 之下。 */}
            {getOutposts().filter((o) => {
              if (!regionForOwner(o.result.id)) return false; // 仅本图配置的区域前哨（排除深脊柱/未配置·守「只这几片区」）
              if (state.profile.lighthouses.some((l) => l.id === o.result.id)) return false; // 已点亮→上面已渲染为灯塔
              return isOutpostDiscovered(state.profile, o.id);
            }).map((o) => {
              const stage = outpostStage(state.profile, o.id);
              const unlocked = outpostUnlocked(state.profile, o.id);
              const chapter = isChapterOutpost(o);
              const isActive = mapPopup?.kind === 'outpost' && (mapPopup as { id: string }).id === o.id;
              const cls = [
                'chart-map-outpost',
                stage > 0 ? 'building' : 'unbuilt',
                chapter && !unlocked ? 'locked' : '',
                isActive ? 'sel' : '',
              ].filter(Boolean).join(' ');
              return (
                <button
                  key={`outpost-${o.id}`}
                  type="button"
                  className={cls}
                  style={{ left: `${o.result.mapX * 100}%`, top: `${o.result.mapY * 100}%` }}
                  aria-label={`前哨：${o.name}${stage > 0 ? `（修建中 ${stage}/${OUTPOST_MAX_STAGE}）` : chapter && !unlocked ? '（暗·待解锁）' : '（未动工）'}`}
                  onClick={() => {
                    setSelectedId(''); // 关 POI 信息
                    setMapPopup(isActive ? null : { kind: 'outpost', id: o.id });
                  }}
                >
                  <span className="chart-outpost-dot" />
                  <span className="chart-outpost-label">{o.name}</span>
                </button>
              );
            })}

            {chart.pois.map((poi) => {
              const { x, y } = poiPos(poi);
              const lock = poiLockReason(state.profile, poi);
              const isSel = selected?.id === poi.id;
              // 只有「正在扫描的灯塔」覆盖它才参与本轮扫描动画（per-哨站）；否则静态显示（已 settled / 恒显锚点）。
              const sd = poiSweepDelay(state.profile, poi, sweepingLhIds);
              const cls = [
                'chart-map-poi',
                poi.persistent ? 'anchor' : 'roam',
                poi.story ? 'story' : '', // #117 剧情锚点＝日志已知坐标·专属样式（不走揭示圈）
                poi.revealState === 'dim' ? 'dim' : '',
                lock ? 'locked' : '',
                isSel ? 'sel' : '',
                sd !== null ? 'chart-poi-arrive' : '',
              ]
                .filter(Boolean)
                .join(' ');
              return (
                <button
                  key={poi.id}
                  type="button"
                  className={cls}
                  style={{ left: `${x * 100}%`, top: `${y * 100}%`, animationDelay: sd !== null ? `${sd}s` : '0s' }}
                  aria-label={lock ? `${poi.name}（${lock}）` : poi.name}
                  onClick={() => { setMapPopup(null); setSelectedId(poi.id); }}
                >
                  <span className="chart-dot" />
                  <span className="chart-poi-name">{poi.name}</span>
                </button>
              );
            })}

            {/* 「该消失的消失」：再扫时被移除的点（非交互·淡出），随扫描边缘到达逐个隐去（扫描完整版）。 */}
            {leavingPois.map((poi) => {
              const { x, y } = poiPos(poi);
              return (
                <div
                  key={`leave-${poi.id}`}
                  className="chart-map-poi chart-poi-leave"
                  aria-hidden="true"
                  style={{
                    left: `${x * 100}%`,
                    top: `${y * 100}%`,
                    animationDelay: `${poiSweepDelay(state.profile, poi, sweepingLhIds) ?? 0}s`,
                  }}
                >
                  <span className="chart-dot" />
                </div>
              );
            })}
          </ChartViewport>

          <div className="chart-legend">
            <span><i className="chart-swatch anchor" />已知地点</span>
            <span><i className="chart-swatch roam" />随潮出现</span>
            <span><i className="chart-swatch locked" />还到不了</span>
          </div>

          {/* 行前装包（猎手 SPEC §4 data 面·#108；2026-06-10 作者改拍「格子化」）：
              背包格＝出发后的 run 背包（上限可见·与 applyCarryItems 截断线同源）；储物柜格＝仓库消耗品。
              点储物柜格放进背包一件、点背包格放回——默认全不带；死了进尸体（可回收）、生还自动归库。 */}
          {carryables.length > 0 && (
            <div className="chart-carry">
              <h3 className="chart-carry-title">
                行前装包 <span className="dim">背包 {slotsUsed}/{carryCapacity} 格</span>
              </h3>
              <p className="dim chart-carry-hint">
                点储物柜里的东西放进背包，点背包里的放回。带下去的，死了就留在尸体上；活着回来自动归库。
              </p>
              <div className="item-grid chart-carry-bag">
                {carryPicks.flatMap((p) =>
                  Array.from({ length: p.qty }, (_, i) => (
                    <ItemCell
                      key={`${p.itemId}-${i}`}
                      def={getItemDef(p.itemId)}
                      itemId={p.itemId}
                      title={`${getItemDef(p.itemId)?.name ?? p.itemId}——点击放回储物柜`}
                      onClick={() => stepCarry(p.itemId, -1, Infinity)}
                    />
                  )),
                )}
                {Array.from({ length: Math.max(0, carryCapacity - slotsUsed) }, (_, i) => (
                  <EmptyCell key={`empty-${i}`} />
                ))}
              </div>
              <h4 className="chart-carry-subtitle dim">储物柜（消耗品）</h4>
              <div className="item-grid chart-carry-locker">
                {carryables.map((it) => {
                  const def = getItemDef(it.itemId);
                  const picked = carry[it.itemId] ?? 0;
                  const remaining = it.qty - picked;
                  const per = def?.slotsRequired ?? 1;
                  const bagFull = slotsUsed + per > carryCapacity;
                  if (remaining <= 0) return null;
                  return (
                    <ItemCell
                      key={it.itemId}
                      def={def}
                      itemId={it.itemId}
                      qty={remaining}
                      disabled={bagFull}
                      title={
                        bagFull
                          ? '背包满了——先点背包里的东西放回来'
                          : `${def?.name ?? it.itemId}——点击放进背包`
                      }
                      onClick={() => stepCarry(it.itemId, +1, it.qty)}
                    />
                  );
                })}
              </div>
            </div>
          )}

          {/* popup（点灯塔/前哨标记）或 POI 详情（点 POI），二者互斥。 */}
          {mapPopup ? (
            mapPopup.kind === 'home' ? (
              <HomePopup
                state={state}
                onOpenFacilities={(id) => { setMapPopup(null); setBuildFocusId(id); }}
              />
            ) : (
              <OutpostPopup
                outpostId={(mapPopup as { kind: 'outpost'; id: string }).id}
                state={state}
                onStateChange={onStateChange}
                onOpenFacilities={(id) => { setMapPopup(null); setBuildFocusId(id); }}
              />
            )
          ) : selected ? (
            <ChartInfo
              poi={selected}
              state={state}
              canSelectTarget={canSelectTarget}
              target={target}
              setTarget={setTarget}
              onDepart={handleDepart}
            />
          ) : null}
        </div>
      )}

      <div className="chart-actions">
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
  const mods = describeModifier(poi.modifier);
  // 洞型情报（#114·真话·与 mapgen 同源）：只有 maze zone 的 POI 出这条
  const caveShape = describeCaveShape(poi);
  const corpses = canSelectTarget ? listRecoverableCorpses(state.profile.deaths, poi.zoneId) : [];
  // 三态：lit 才可出海；dim（深度柱档 / 能力门 / 天气遮）显示但去不了——poiBlockReason 给「怎样才能去」。
  const departable = isPoiDepartable(state.profile, poi);
  const blockReason = poiBlockReason(state.profile, poi);
  const showPicker = departable && corpses.length > 0;

  return (
    <div className={`chart-info ${departable ? '' : 'locked'}`}>
      <div className="chart-info-head">
        <h3 className="chart-info-name">{poi.name}</h3>
        <span className="dim chart-info-zone">
          {zone?.name ?? poi.zoneId}
          {!poi.persistent && ' · 随潮出现'}
        </span>
      </div>

      <div className="chart-tags">
        {mods.map((m, i) => (
          <span key={i} className="chart-tag mod">
            {m}
          </span>
        ))}
        {caveShape && <span className="chart-tag mod">{caveShape}</span>}
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

      {departable ? (
        <button className="btn small" onClick={() => onDepart(poi, target || undefined)}>
          {showPicker && target ? '出海（带着目标）' : '出海'}
        </button>
      ) : (
        <button className="btn small" disabled title={blockReason ?? undefined}>
          {blockReason ?? '去不了'}
        </button>
      )}
    </div>
  );
}

// ============================================================
// 地图节点 popup 组件（Step 4/6）
// ============================================================

/**
 * 家灯塔 popup（灯塔/蛙跳重构 step ③）：点家灯塔 → 弹此 popup·里面「灯塔设施」入口开建造面板（与前哨同款交互·一致）。
 * 家灯塔无建造阶段/无蛙跳（深脊柱走升级派生的深入 POI）——只一个设施入口。
 */
function HomePopup({
  state,
  onOpenFacilities,
}: {
  state: GameState;
  onOpenFacilities: (lighthouseId: string) => void;
}) {
  const home = getHomeLighthouse(state.profile);
  if (!home) return null;
  return (
    <div className="chart-popup chart-popup-outpost">
      <div className="chart-popup-head">
        <span className="chart-popup-title">{home.name}</span>
        <span className="dim chart-popup-status">家灯塔</span>
      </div>
      <div className="chart-outpost-actions">
        <button className="btn small chart-outpost-facilities" onClick={() => onOpenFacilities(home.id)}>
          设施升级
        </button>
      </div>
    </div>
  );
}

/**
 * 前哨 popup（Step 4/5·灯塔/蛙跳重构 step ③）：点击海图上前哨标记（未点亮 / 半亮 / 点亮的前哨灯塔）弹出，
 * 包含建造/能源 + 章节蛙跳（仅章节前哨）+「灯塔设施」入口（点亮节点）+ dev 按钮。
 * 深脊柱前哨不再出蛙跳——改走升级（探深）派生的深入 POI（HomeDivePopup 旧深脊柱蛙跳列表已删·step ③）。
 */
export function OutpostPopup({
  outpostId,
  state,
  onStateChange,
  onOpenFacilities,
}: {
  outpostId: string;
  state: GameState;
  onStateChange: (s: GameState) => void;
  /** 打开该前哨灯塔的设施面板（灯塔/蛙跳重构 step ③·点亮节点的「设施升级」入口）。可选＝SSR/测试可不传。 */
  onOpenFacilities?: (lighthouseId: string) => void;
}) {
  const o = getOutposts().find((x) => x.id === outpostId);
  if (!o) return null;

  const stage = outpostStage(state.profile, o.id);
  const lit = stage >= OUTPOST_MAX_STAGE;
  const usable = stage >= OUTPOST_USABLE_STAGE;
  const next = nextOutpostStage(state.profile, o.id);
  const canBuild = canAdvanceOutpost(state.profile, o.id);
  const chapter = isChapterOutpost(o);
  const unlocked = outpostUnlocked(state.profile, o.id);
  const lh = getLighthouse(state.profile, o.result.id);
  const energy = lh ? outpostEnergy(lh) : null;

  const status =
    chapter && !unlocked
      ? '隐约可见 · 还没路'
      : lit
        ? '灯亮着'
        : stage === 0
          ? '未动工'
          : `修建中 ${stage}/${OUTPOST_MAX_STAGE}${usable ? ' · 已可用' : ''}`;

  return (
    <div className="chart-popup chart-popup-outpost">
      <div className="chart-popup-head">
        <span className="chart-popup-title">{o.name}</span>
        <span className="dim chart-popup-status">{status}</span>
      </div>

      {energy && (
        <p className="dim chart-popup-energy">
          能源 {energy.capacity}（占用 {energy.demand}
          {energy.demand > energy.capacity ? ' · 部分设施停转' : ''}）
        </p>
      )}
      {chapter && !unlocked && (
        <p className="dim chart-popup-locked">
          这片还没探到——走到附近，它才会亮起来、能动工。
        </p>
      )}

      <div className="chart-outpost-actions">
        {next && unlocked && (
          <button
            className="btn small chart-outpost-build"
            disabled={!canBuild}
            onClick={() => onStateChange(advanceOutpost(state, o.id))}
          >
            {next.label}
          </button>
        )}
        {/* 章节前哨蛙跳已删（作者 2026-06-14·#6）：章节 band 也改走升级/剧情派生的深入 POI（与深脊柱一致）。 */}
        {/* 灯塔设施入口（灯塔/蛙跳重构 step ③：点亮节点 → 开该灯塔设施面板·建探深等）。 */}
        {lit && onOpenFacilities && (
          <button
            className="btn small chart-outpost-facilities"
            onClick={() => onOpenFacilities(o.result.id)}
          >
            设施升级
          </button>
        )}
        {/* dev 家族（#110）：免料推进 / 一键解锁本区 / 发现未发现前哨（Step 5）。 */}
        {DEV_TOOLS && !lit && (
          <button
            className="btn small chart-outpost-dev"
            onClick={() => onStateChange(devAdvanceOutpost(state, o.id))}
          >
            测试推进（dev）
          </button>
        )}
        {DEV_TOOLS && chapter && !lit && (
          <button
            className="btn small chart-outpost-dev"
            onClick={() => onStateChange(devUnlockChapterRegion(state, o.id))}
          >
            解锁本区（dev）
          </button>
        )}
        {DEV_TOOLS && !isOutpostDiscovered(state.profile, o.id) && (
          <button
            className="btn small chart-outpost-dev"
            onClick={() => onStateChange(devRevealOutpost(state, o.id))}
          >
            让它现身（dev）
          </button>
        )}
      </div>
    </div>
  );
}
