// 港口海图选点 —— 2D 地图视图：港口在左，左→右 ≈ 离岸越远 / 越深；点位是可点的标记，
// 选中后右侧（手机为下方）信息面板显示该点详情 + 出海。
// 顶层 phase 'chart'（与 MiraShopView 同模式）。POI 数据/门控来自 engine/chart.ts；
// 实际出海走 engine/dive.ts::startDiveFromPoi。坐标来自 ChartPoi.mapX/mapY（缺省按 distance 兜底）。

import { useMemo, useState, useEffect, useRef } from 'react';
import type { GameState, ChartPoi, InventoryItem, ChartConditions } from '@/types';
import { generateChart, poiLockReason, poiBlockReason, isPoiDepartable, describeModifier, describeCaveShape } from '@/engine/chart';
import { startDiveFromPoi, carryWeightLimitFor } from '@/engine/dive';
import { poiHarvestMaterials } from '@/engine/poiMaterials';
import { MaterialIcon } from './materialIcons';
import { toPort } from '@/engine/transitions';
import {
  getHomeLighthouse,
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
import { getZone } from '@/engine/zones';
import { getUpgradeBonuses } from '@/engine/upgrades';
import { getItemDef, weightForItem } from '@/engine/items';
import { isOverloaded } from '@/engine/equipment';
import { listRecoverableCorpses } from '@/engine/death';
import { advanceDays, daysToNextLunarBoundary, waitPreview } from '@/engine/port';
import { lunarPhaseLabel, dayWithinPhase } from '@/engine/lunar';
import { MoonDisc } from './MoonDisc';
import { LighthouseBuildPanel } from './LighthouseBuildPanel';
import { ChartViewport, type ChartContentBox } from './ChartViewport';
import { HOME_LIGHTHOUSE_ID } from '@/engine/state';
import { regionForOwner, flagGatedRegions } from '@/engine/regions';
import { DEV_TOOLS } from './devMode';
import { ItemCell } from './ItemCell';

/** 地图节点弹窗选择态：点击前哨 → 建造/能源/设施/章节蛙跳。（家灯塔 + 已点亮前哨灯塔点击直接开灯塔设施面板·灯塔/蛙跳重构 step ③） */
type MapPopup = { kind: 'home' } | { kind: 'outpost'; id: string };

interface Props {
  state: GameState;
  onStateChange: (s: GameState) => void;
  /**
   * 进图时聚焦/选中的 POI id（「文献坐标」功能·作者 2026-06-18）：从物品栏「旧海图/藏宝图」点某个坐标
   * 进来时带它，初始选中该点（信息面板直接显示它）。缺省＝按 defaultId 选第一个可出海点。
   */
  focusPoiId?: string;
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

/** 海况条 JSX（§6.5「活的海图」+ 月相潮汐 §8 + 月相 HUD）：
 *  左：月相盘 + 月相/相内天数 + 大小潮/涨退/天气；右：等一天 + 等到下一相位。
 *  guard: !state.run（仅港口）同原来的单按钮。
 */
function ConditionBar({
  c,
  state,
  onStateChange,
}: {
  c: ChartConditions;
  state: GameState;
  onStateChange: (s: GameState) => void;
}) {
  const phase = c.phase ?? 'new';
  const day = state.profile.day ?? state.profile.runsCompleted ?? 0;
  const phaseDay = dayWithinPhase(day);
  const springNeap = phase === 'new' || phase === 'full' ? '大潮' : '小潮';
  const tideLabel = c.tide === 'flood' ? '涨潮' : '退潮';
  const weatherLabel = c.weather === 'clear' ? '晴' : c.weather === 'mist' ? '薄雾' : '浓雾';
  const daysLeft = daysToNextLunarBoundary(state.profile);

  // 「等到下一相位」的得失预览（SPEC §6：等待是看得见账的决定）
  const preview = !state.run ? waitPreview(state, daysLeft) : null;
  const previewParts: string[] = [];
  if (preview) {
    const nextSpringNeap = preview.targetPhase === 'new' || preview.targetPhase === 'full' ? '大潮' : '小潮';
    previewParts.push(`等 ${preview.days} 天 → ${lunarPhaseLabel(preview.targetPhase)}·${nextSpringNeap}`);
    if (preview.corpseItemsLost > 0) {
      previewParts.push(`海底遗存 −${preview.corpseItemsLost} 件`);
    }
    for (const name of preview.closing) {
      previewParts.push(`${name} 关`);
    }
    for (const name of preview.opening) {
      previewParts.push(`${name} 开`);
    }
  }
  // 只在有非平凡信息时显示（至少有遗存损耗或潮窗变化）
  const showPreview = preview !== null && previewParts.length > 1;

  return (
    <div className="chart-conditions">
      {/* Left: moon disc + two text lines */}
      <div className="chart-conditions-moon">
        <MoonDisc phase={phase} size={34} />
        <div className="chart-conditions-text">
          <span className="chart-conditions-phase">
            {lunarPhaseLabel(phase)} · 第 {phaseDay} 天
          </span>
          <span className="chart-conditions-detail">
            {springNeap} · {tideLabel} · {weatherLabel}
          </span>
        </div>
      </div>
      {/* Right: wait buttons + preview (port only) */}
      {!state.run && (
        <div className="chart-conditions-actions">
          <button
            type="button"
            className="btn small chart-wait-btn"
            onClick={() => onStateChange(advanceDays(state, 1))}
            title="在港口等一天"
          >
            等一天
          </button>
          <div className="chart-wait-phase-group">
            <button
              type="button"
              className="btn small chart-wait-btn"
              onClick={() => onStateChange(advanceDays(state, daysLeft))}
              title="在港口等到下一个月相边界——机会点随相位换一批（SPEC §6）"
            >
              等到下一相位 · 还 {daysLeft} 天
            </button>
            {showPreview && (
              <span className="chart-wait-preview">
                {previewParts.join(' · ')}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function SeaChartView({ state, onStateChange, focusPoiId }: Props) {
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
    return `${p.runsCompleted}#${p.day ?? p.runsCompleted}#${lh}#${[...p.flags].sort().join(',')}`;
  }, [state.profile]);
  const chart = useMemo(
    () => generateChart({ profile: state.profile }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chartSig],
  );

  // 世界内容包围盒（区域揭示·随解锁外扩）：可见 POI + 各灯塔点亮圈（中心 ± 有效半径）。
  // memo 同 chartSig（解锁/点亮即重算）→ ChartViewport 据 fitKey 变化 autozoom 到新边界。
  const contentBox = useMemo<ChartContentBox>(() => {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    const grow = (x: number, y: number) => {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    };
    // 海岸线在世界 x=0；取景左界固定钉在它左边一点点（COAST_VIEW_X·与家位置/半径无关＝干净的「固定细线」，
    // 作者「海岸区强制算分界线左边一点就可以了」）。可调。
    const COAST_VIEW_X = -0.02;
    // 各灯塔的揭示圈（中心 ± 有效半径）——含圈、不只中心（作者 2026-06-16：半径已小〔#125 起 0.1–0.26〕，
    // 框住圈不再撑出大片空水域；且编辑器〔?editor〕能把灯塔/点拖出旧 [0,1] 框→fit 必须动态含圈、右/下不钳死）。
    // **海岸区（家·shape:coast）例外**：贴岸半圆、左半伸进陆地——左界直接走 COAST_VIEW_X、纵向只算中心，
    // 免得它的大圈把 fit 往左（陆地）和纵向撑出去、海岸那侧露太多空白。
    for (const lh of state.profile.lighthouses) {
      const region = regionForOwner(lh.id);
      if (region?.shape === 'coast') {
        grow(COAST_VIEW_X, lh.mapY);
      } else {
        const r = revealRadius(lh);
        grow(lh.mapX - r, lh.mapY - r);
        grow(lh.mapX + r, lh.mapY + r);
      }
    }
    // flag-gated 揭示区（鲸落·已 found 才可见）的圈也算进 fit。
    for (const rg of flagGatedRegions()) {
      if (!rg.center || !rg.revealFlag || !state.profile.flags.has(rg.revealFlag)) continue;
      grow(rg.center.x - rg.radius, rg.center.y - rg.radius);
      grow(rg.center.x + rg.radius, rg.center.y + rg.radius);
    }
    for (const p of chart.pois) {
      const { x, y } = poiPos(p);
      grow(x, y);
    }
    if (minX > maxX) return { minX: 0, minY: 0, maxX: 1, maxY: 1 }; // 空 → 全图兜底
    // 下界＝海岸线 x=0 / 世界顶 y=0（圈/点的左半·上半伸进陆地，不框进去）；**右/下不再钳死 1**——
    // 容得下编辑器拖远的灯塔/点/圈（世界往右与上下「无限」、左有界）。ChartViewport 的 RING + spanX 上限仍兜底。
    return {
      minX: Math.max(COAST_VIEW_X, minX), // 左界＝海岸线左边一点（固定细线·见 COAST_VIEW_X）
      minY: Math.max(0, minY),
      maxX,
      maxY,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chartSig, chart]);

  // 打捞行会 Lv.2：出海前可选定一具尸体作为本次目标（保证出现在图里）
  const canSelectTarget = getUpgradeBonuses(state.profile).preDiveCorpseSelect;

  // 默认选中第一个"可出海"的点，保证信息面板有内容、出海按钮可见
  const defaultId =
    chart.pois.find((p) => isPoiDepartable(state.profile, p))?.id ?? chart.pois[0]?.id ?? '';
  // 「文献坐标」进图（#140 续·作者 2026-06-18）：带 focusPoiId 且该点在图上 → 初始选中它（直达该坐标）；
  // 否则按 defaultId 选第一个可出海点。仅初始化时取一次（进图即定）。
  const [selectedId, setSelectedId] = useState<string>(
    focusPoiId && chart.pois.some((p) => p.id === focusPoiId) ? focusPoiId : defaultId,
  );
  // selectedId='' （点灯塔/前哨时清空·互斥）→ **不回退 defaultId**（否则资格区等默认点仍高亮·
  // 破「同一时间只一个 POI 点亮」·作者 2026-06-14 #4）。初次进图由 useState(defaultId) 给默认选中。
  const selected = chart.pois.find((p) => p.id === selectedId) ?? null;

  // 切换点位时清掉"锁定目标"和"出发步骤"（lift 到此处，便于 useEffect 重置）
  const [target, setTarget] = useState<string>('');
  // departStep: 就地分步向导（#140·作者 2026-06-18）：
  //   none=POI信息+出海按钮 → pack=行前装包+→/下潜 → target=锁定目标+下潜
  //   切 POI 时自动回 none（不做 PanelShell 全覆盖·不做取消按钮·点别的 POI 自动重置）。
  const [departStep, setDepartStep] = useState<'none' | 'pack' | 'target'>('none');
  useEffect(() => { setTarget(''); setDepartStep('none'); }, [selected?.id]);

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
  // 承载与重量（重量制 2026-06-21）：与 createNewRun/applyCarryItems 同源（carryWeightLimitFor + items.ts::weightForItem·按 qty 线性），UI 画的承载＝真截断线（kg）。
  const carryWeight = carryWeightLimitFor(state.profile);
  const weightUsed = carryPicks.reduce((a, p) => a + weightForItem(p.itemId, p.qty), 0);
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
        <ConditionBar c={chart.conditions} state={state} onStateChange={onStateChange} />
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
        // 教学前海图本就空（潜点全压在 flag.tutorial_complete 后）——别让先点海图的玩家以为卡住：
        // 指回 Aldo（首潜唯一入口·playtest 报告 ②）。教学后仍空属边缘态，保留原提示。
        <p className="dim chart-empty">
          {state.profile.flags.has('flag.tutorial_complete')
            ? '海图上还没有你能去的点。先完成资格潜水。'
            : '海图还是空的——先去长椅那头找 Aldo（守灯人）谈谈，他会带你出第一趟资格潜水。'}
        </p>
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
              // 暗点 + 有月相窗门 → 角标月相盘（让玩家一眼看出是潮窗锁·详细原因在右侧信息面板）
              const showMoonBadge =
                poi.revealState === 'dim' &&
                poi.lunarWindow != null &&
                poi.lunarWindow.length > 0;
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
                  {showMoonBadge && (
                    <span className="chart-poi-moon-badge" aria-hidden="true">
                      <MoonDisc phase={poi.lunarWindow![0]} size={14} />
                    </span>
                  )}
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
            <span className="chart-legend-lunar">
              <MoonDisc phase="new" size={14} />
              月相徽标 = 该点潮窗；灰 pin = 知道但当下去不了（潮窗未到）
            </span>
          </div>

          {/* popup（点灯塔/前哨标记）或 POI 详情（点 POI），二者互斥。
              行前装包已移入 ChartInfo departStep='pack' 步骤（#140·就地分步向导）。 */}
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
              departStep={departStep}
              setDepartStep={setDepartStep}
              carry={carry}
              carryables={carryables}
              carryPicks={carryPicks}
              carryWeight={carryWeight}
              weightUsed={weightUsed}
              stepCarry={stepCarry}
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

/** 就地分步向导（#140·2026-06-18·作者拍板）的 Props——carry 相关打包成一组便于传递与测试 */
export interface ChartInfoCarry {
  carry: Record<string, number>;
  carryables: InventoryItem[];
  carryPicks: InventoryItem[];
  /** 背包承载上限（kg·重量制 2026-06-21）。 */
  carryWeight: number;
  /** 当前已装重量（kg）。 */
  weightUsed: number;
  stepCarry: (itemId: string, delta: number, max: number) => void;
}

/**
 * POI 详情 + 就地分步出发向导（#140·2026-06-18 作者拍板）。
 * - `none`  : POI 信息（名/区/tag/blurb）+ **出海** 按钮 → departStep='pack'
 * - `pack`  : 行前装包（背包格+储物柜格·共享 carry 态）+ →（有打捞目标可选时）或 **下潜**
 * - `target`: 锁定目标 <select> + ← 回 pack + **下潜**
 * 导出为具名函数，便于 smoke-chart-ui.tsx 直接渲染测试（不需额外 test-only prop）。
 */
export function ChartInfo({
  poi,
  state,
  canSelectTarget,
  target,
  setTarget,
  departStep,
  setDepartStep,
  carry,
  carryables,
  carryPicks,
  carryWeight,
  weightUsed,
  stepCarry,
  onDepart,
}: {
  poi: ChartPoi;
  state: GameState;
  canSelectTarget: boolean;
  target: string;
  setTarget: (v: string) => void;
  departStep: 'none' | 'pack' | 'target';
  setDepartStep: (s: 'none' | 'pack' | 'target') => void;
  onDepart: (poi: ChartPoi, targetCorpseId?: string) => void;
} & ChartInfoCarry) {
  const zone = getZone(poi.zoneId);
  const mods = describeModifier(poi.modifier);
  const caveShape = describeCaveShape(poi);
  // 「可能收获」材料（无剧透·只列 category==='material'·见 engine/poiMaterials.ts）。
  // roaming 实例 id 每次变 → 用稳定 templateId 当 key（anchor 无 templateId ⇒ 退回 id）。
  const harvest = useMemo(() => poiHarvestMaterials(poi.templateId ?? poi.id), [poi.templateId, poi.id]);
  const corpses = canSelectTarget ? listRecoverableCorpses(state.profile.deaths, poi.zoneId) : [];
  // 负重过载（武器系统·作者 2026-06-20）：全 POI 统一拦——过载无法出发（与战斗全行动封锁同源 isOverloaded）。
  // 引擎 startDiveFromPoi 亦有同判据兜底（防御性双保险）。起手装＝轻·不受影响。
  const overloaded = state.profile.equipment ? isOverloaded(state.profile.equipment) : false;
  const departable = isPoiDepartable(state.profile, poi) && !overloaded;
  const blockReason = overloaded ? '负重过载——卸下些装备再出发' : poiBlockReason(state.profile, poi);
  // 「→」（进 target 步）只在有打捞目标可选时出现
  const hasCorpseChoice = departable && corpses.length > 0;
  // 没东西可带就跳过装包（作者拍板 2026-06-25）：仓库无可携带消耗品 ⇒「出海」不进 pack 步——
  // 有打捞目标可选 → 直接 target 步；否则直接下潜。装包步只在确有东西可带时存在（单点决策·
  // 与下方「← 装包/返回」回退目标同源 hasPack，免出现空装包面板）。
  const hasPack = carryables.length > 0;
  const beginDepart = () => {
    if (hasPack) setDepartStep('pack');
    else if (hasCorpseChoice) setDepartStep('target');
    else onDepart(poi, undefined);
  };

  // ── step: target ────────────────────────────────────────────────
  if (departStep === 'target') {
    return (
      <div className="chart-info">
        <div className="chart-info-head">
          <h3 className="chart-info-name">{poi.name}</h3>
          <span className="dim chart-info-zone">锁定打捞目标</span>
        </div>
        <label className="chart-poi-target">
          <span className="dim">选定目标（打捞行会）</span>
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
        <div className="chart-info-actions">
          <button className="btn small secondary" onClick={() => setDepartStep(hasPack ? 'pack' : 'none')}>
            {hasPack ? '← 装包' : '← 返回'}
          </button>
          <button className="btn small" onClick={() => onDepart(poi, target || undefined)}>
            {target ? '下潜（带目标）' : '下潜'}
          </button>
        </div>
      </div>
    );
  }

  // ── step: pack ──────────────────────────────────────────────────
  if (departStep === 'pack') {
    return (
      <div className="chart-info">
        <div className="chart-info-head">
          <h3 className="chart-info-name">{poi.name}</h3>
          <span className="dim chart-info-zone">
            行前装包 <span className="dim">背包 {weightUsed.toFixed(1)} / {carryWeight.toFixed(1)} kg</span>
          </span>
        </div>
        {carryables.length > 0 ? (
          <>
            <p className="dim chart-carry-hint">
              点储物柜里的东西放进背包，点背包里的放回。背包按重量装，越满越接近上限。带下去的，死了就留在尸体上；活着回来自动归库。
            </p>
            <div className="item-grid chart-carry-bag">
              {carryPicks.flatMap((p) => {
                const def = getItemDef(p.itemId);
                const stack = def?.stackSize;
                // 弹药：仍按「弹匣」分格渲染（一匣 ≤stackSize 发·最后一匣可能不满）＝可读的成组显示；其余道具：一件一格。
                // 注：承载已是重量制（按 qty 线性·见 weightForItem），这里的「匣/格」纯属显示分组，不再是容量单位。
                if (stack && stack > 0) {
                  const mags = Math.ceil(p.qty / stack);
                  return Array.from({ length: mags }, (_, i) => {
                    const rounds = i < mags - 1 ? stack : p.qty - stack * (mags - 1);
                    return (
                      <ItemCell
                        key={`${p.itemId}-${i}`}
                        def={def}
                        itemId={p.itemId}
                        qty={rounds}
                        title={`${def?.name ?? p.itemId}（${rounds} 发）——点击放回一发`}
                        onClick={() => stepCarry(p.itemId, -1, Infinity)}
                      />
                    );
                  });
                }
                return Array.from({ length: p.qty }, (_, i) => (
                  <ItemCell
                    key={`${p.itemId}-${i}`}
                    def={def}
                    itemId={p.itemId}
                    title={`${def?.name ?? p.itemId}——点击放回储物柜`}
                    onClick={() => stepCarry(p.itemId, -1, Infinity)}
                  />
                ));
              })}
            </div>
            <h4 className="chart-carry-subtitle dim">储物柜（消耗品）</h4>
            <div className="item-grid chart-carry-locker">
              {carryables.map((it) => {
                const def = getItemDef(it.itemId);
                const picked = carry[it.itemId] ?? 0;
                const remaining = it.qty - picked;
                // 再装 1 件的边际重量（按 qty 线性＝单件 weight·弹药同理每发 0.05）；加上去超承载 → 禁用。
                const marginal = weightForItem(it.itemId, 1);
                const bagFull = weightUsed + marginal > carryWeight;
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
                        ? '背包到承载上限了——先点背包里的东西放回来'
                        : `${def?.name ?? it.itemId}——点击放进背包`
                    }
                    onClick={() => stepCarry(it.itemId, +1, it.qty)}
                  />
                );
              })}
            </div>
          </>
        ) : (
          <p className="dim">仓库没有可携带的消耗品。</p>
        )}
        <div className="chart-info-actions">
          {hasCorpseChoice ? (
            <button className="btn small" onClick={() => setDepartStep('target')}>→ 锁定目标</button>
          ) : (
            <button className="btn small" onClick={() => onDepart(poi, undefined)}>下潜</button>
          )}
        </div>
      </div>
    );
  }

  // ── step: none（默认·POI 信息）───────────────────────────────────
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

      {harvest.length > 0 && (
        <div className="chart-harvest">
          <div className="chart-harvest-label">可能收获</div>
          <div className="chart-harvest-chips">
            {harvest.map((m) => (
              <span
                key={m.id}
                className={`harvest-chip mat-${m.role ?? 'none'}`}
                aria-label={m.name}
              >
                <MaterialIcon id={m.id} role={m.role} />
                <span className="tip">{m.name}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {poi.mimic && (
        <p className="chart-info-tell uncanny">
          ⚠ 你数过自己点亮的每一盏灯——没有一盏在这儿。它亮着，却不在你的网里。交叉比对的结果只有一个：这不是你点的光。
        </p>
      )}

      <div className="chart-info-actions">
        {departable ? (
          <button className="btn small" onClick={beginDepart}>出海</button>
        ) : (
          <button className="btn small" disabled title={blockReason ?? undefined}>
            {blockReason ?? '去不了'}
          </button>
        )}
      </div>
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
