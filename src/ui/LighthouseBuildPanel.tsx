// 灯塔设施建造面板（基建地图 Phase C）—— 与港口修缮 UpgradePanel 平行的「每灯塔」版本。
// 列出每座已拥有灯塔可建的设施轨（信标 / 船坞…），用 engine/lighthouses.ts 的
// canBuildAt / buildAtLighthouse 双资源门控；homeOnly 轨（船坞）只对家灯塔显示。
// 由 SeaChartView 唤出（灯塔在海图上可见，建造也在海图上）。

import type {
  GameState,
  Lighthouse,
  LighthouseTrack,
  LighthouseUpgradeDef,
  LighthouseEffect,
} from '@/types';
import {
  canBuildAt,
  buildAtLighthouse,
  devBuildAtLighthouse,
  getLighthouseTracks,
  getBuiltLevelInTrack,
} from '@/engine/lighthouses';
import { getOutpostForLighthouse } from '@/engine/outposts';
import { getColumnForLighthouse } from '@/engine/columns';
import { HOME_LIGHTHOUSE_ID } from '@/engine/state';
import { PanelShell } from './PanelShell';
import { UpgradeCostView } from './UpgradeCost';
import { UpgradeEffectDelta, emptyEffectSet, mergeEffectSets, type EffectSet, type StatLine } from './UpgradeEffectDelta';
import { DEV_TOOLS } from './devMode';

// LighthouseEffect → EffectSet（全数值·作者 2026-06-20·#5·喂统一 UpgradeEffectDelta）。
// 探深轨 effects 空→空集→不渲染（见 UpgradeEffectDelta 注：stats 统一「越大越好」）。
function lighthouseEffectSet(effects: LighthouseEffect[]): EffectSet {
  const stats: StatLine[] = [];
  for (const e of effects) {
    switch (e.kind) {
      case 'rechargeBonus':
        stats.push({ label: e.kind, value: e.value, render: (v) => `出潜电量 +${v}` });
        break;
      case 'oxygenSupply':
        stats.push({ label: e.kind, value: e.value, render: (v) => `出潜氧气 +${v}` });
        break;
    }
  }
  return { stats, unlocks: [] };
}

interface Props {
  state: GameState;
  onStateChange: (s: GameState) => void;
  onClose: () => void;
  /** 只显示这一座灯塔的设施（灯塔/蛙跳重构 step ③：点海图节点 → 聚焦该灯塔；缺省＝全部·向后兼容）。 */
  focusLighthouseId?: string;
}

export function LighthouseBuildPanel({ state, onStateChange, onClose, focusLighthouseId }: Props) {
  const tracks = getLighthouseTracks();

  function handleBuild(lighthouseId: string, upgradeId: string) {
    onStateChange(buildAtLighthouse(state, lighthouseId, upgradeId));
  }

  // Dev 测试建造（#118·与港口修缮「测试解锁/一键升满」同款 quirk #110 口径）：
  // 0 成本直建；一键建满只扫**该灯塔可见轨**（trackVisible 过滤后）——别给家灯塔
  // 建出 outpostOnly 的能源设施（可见性即合法性·引擎侧已建/未知 no-op 兜底）。
  function handleDevBuild(lighthouseId: string, upgradeId: string) {
    onStateChange(devBuildAtLighthouse(state, lighthouseId, upgradeId));
  }
  function handleDevBuildAll(lighthouseId: string, visibleTracks: LighthouseTrack[]) {
    let s = state;
    for (const t of visibleTracks) for (const u of t.upgrades) s = devBuildAtLighthouse(s, lighthouseId, u.id);
    if (s !== state) onStateChange(s);
  }

  // 内容型界面统一壳（quirk #112）：金币头固定、设施轨在中间滚、返回钉底通栏（从右上挪下来，
  // 与各页跳转操作对齐）。整页替换 SeaChartView 渲染（无页眉在上）→ 用默认预算、不加修饰类。
  return (
    <PanelShell
      className="lighthouse-build"
      title="设施升级"
      sub={<>银行 {state.profile.bankedGold} 金币 · 低频声呐升级</>}
      onClose={onClose}
    >
      {state.profile.lighthouses
        .filter((lh) => !focusLighthouseId || lh.id === focusLighthouseId)
        .map((lh) => {
        // 深水区 Phase 2b：补给设施（充电/制氧）只在 OutpostDef 支撑的深水前哨可建。
        const outpost = getOutpostForLighthouse(lh.id);
        const trackVisible = (t: LighthouseTrack): boolean => {
          if (t.onlyLighthouse) return lh.id === t.onlyLighthouse;
          if (t.homeOnly) return lh.id === HOME_LIGHTHOUSE_ID;
          if (t.outpostOnly) return !!outpost;
          return true;
        };
        const visibleTracks = tracks.filter(trackVisible);
        return (
        <div key={lh.id} className="lighthouse-section">
          <div className="lighthouse-section-head">
            <span className="lighthouse-section-name">{lh.name}</span>
            <span className="dim lighthouse-section-meta">Lv.{lh.level}</span>
          </div>
          {/* dev「一键建满」单独一行（不挤进名称行·否则四字哨站名换行·作者 2026-06-14 #2）。 */}
          {DEV_TOOLS && (
            <button
              className="btn small upgrade-dev-unlock"
              onClick={() => handleDevBuildAll(lh.id, visibleTracks)}
            >
              测试：一键建满（0 成本）
            </button>
          )}
          {visibleTracks.map((track) => (
            <LighthouseTrackCard
              key={track.id}
              track={track}
              lighthouse={lh}
              state={state}
              onBuild={handleBuild}
              onDevBuild={handleDevBuild}
            />
          ))}
        </div>
        );
      })}
    </PanelShell>
  );
}

function LighthouseTrackCard({
  track,
  lighthouse,
  state,
  onBuild,
  onDevBuild,
}: {
  track: LighthouseTrack;
  lighthouse: Lighthouse;
  state: GameState;
  onBuild: (lighthouseId: string, upgradeId: string) => void;
  onDevBuild: (lighthouseId: string, upgradeId: string) => void;
}) {
  const haveLevel = getBuiltLevelInTrack(lighthouse, track);
  // 每级 before＝低级累计·after＝含本级累计（前缀和）→ 喂统一 UpgradeEffectDelta（数值前后对比·作者 2026-06-20·#5/#6）。
  // 低频声呐（探深轨·effects 空）：合成「探深至 {本档底深}m」数值——存**增量**（本档底深 − 上档底深）·前缀和后即绝对深度·
  //   故对比显「探深至 90m → 探深至 120m↑」（每级开深一档·守探深＝信息基建北极星）。
  const probeCol = track.id.startsWith('lhtrack.probe.') ? getColumnForLighthouse(lighthouse.id) : undefined;
  const rowSets: { before: EffectSet; after: EffectSet }[] = [];
  let cum = emptyEffectSet();
  let prevDepth = 0;
  track.upgrades.forEach((u, i) => {
    let thisSet: EffectSet;
    if (probeCol) {
      const depth = probeCol.tiers[i]?.depthRange[1] ?? prevDepth;
      thisSet = { stats: [{ label: 'probeDepth', value: depth - prevDepth, render: (v) => `探深至 ${v}m` }], unlocks: [] };
      prevDepth = depth;
    } else {
      thisSet = lighthouseEffectSet(u.effects);
    }
    const before = cum;
    const after = mergeEffectSets(cum, thisSet);
    rowSets.push({ before, after });
    cum = after;
  });

  return (
    <div className="upgrade-line">
      <div className="upgrade-line-head">
        <span className="upgrade-line-name">{track.name}</span>
        <span className="upgrade-line-progress">
          Lv.{haveLevel} / {track.upgrades.length}
        </span>
      </div>
      <div className="upgrade-line-desc">{track.description}</div>
      <div className="upgrade-line-rows">
        {track.upgrades.map((u, i) => (
          <LighthouseUpgradeRow
            key={u.id}
            def={u}
            level={i + 1}
            before={rowSets[i].before}
            after={rowSets[i].after}
            lighthouse={lighthouse}
            state={state}
            onBuild={onBuild}
            onDevBuild={onDevBuild}
          />
        ))}
      </div>
    </div>
  );
}

function LighthouseUpgradeRow({
  def,
  level,
  before,
  after,
  lighthouse,
  state,
  onBuild,
  onDevBuild,
}: {
  def: LighthouseUpgradeDef;
  level: number;
  before: EffectSet;
  after: EffectSet;
  lighthouse: Lighthouse;
  state: GameState;
  onBuild: (lighthouseId: string, upgradeId: string) => void;
  onDevBuild: (lighthouseId: string, upgradeId: string) => void;
}) {
  const built = lighthouse.builtUpgrades.has(def.id);
  const avail = canBuildAt(state.profile, lighthouse, def.id);
  // 账单之外的门（前置/灯塔等级）→ 传 UpgradeCostView 的 disabled + 文案；材料/金币不足由它自算（统一账单 UI·作者 2026-06-20）。
  const reason = avail.ok ? undefined : avail.reason;
  const extraBlocked = !built && (reason === 'needsPrev' || reason === 'needsLighthouseLevel');
  const extraLabel =
    reason === 'needsPrev' ? '需要前一级' : reason === 'needsLighthouseLevel' ? '灯塔等级不足' : undefined;

  return (
    <div className={`upgrade-row ${built ? 'owned' : ''}`}>
      <div className="upgrade-row-main">
        <div className="upgrade-row-name">{def.name}</div>
        <div className="upgrade-row-desc">{def.description}</div>
        <UpgradeEffectDelta
          before={before}
          after={after}
          beforeLabel={`Lv.${level - 1}`}
          afterLabel={`Lv.${level}`}
          build={level === 1}
        />
        {!built && (
          <UpgradeCostView
            cost={def.cost}
            inventory={state.profile.inventory}
            bankedGold={state.profile.bankedGold}
            actionLabel="建造"
            onConfirm={() => onBuild(lighthouse.id, def.id)}
            disabled={extraBlocked}
            disabledLabel={extraLabel}
          />
        )}
        {/* Dev 测试建造（?dev 门后·与港口修缮「测试解锁」同款 #110 口径）：跳过材料/金币/
            前置/灯塔等级，真建造路径零触碰；普通访客 DEV_TOOLS=false 不渲染。 */}
        {DEV_TOOLS && !built && (
          <button
            className="btn small upgrade-dev-unlock"
            onClick={() => onDevBuild(lighthouse.id, def.id)}
          >
            测试建造（0 成本）
          </button>
        )}
      </div>
      <div className="upgrade-row-side">
        {built && <span className="upgrade-status owned">已建</span>}
      </div>
    </div>
  );
}
