// 灯塔设施建造面板（基建地图 Phase C）—— 与港口修缮 UpgradePanel 平行的「每灯塔」版本。
// 列出每座已拥有灯塔可建的设施轨（信标 / 船坞…），用 engine/lighthouses.ts 的
// canBuildAt / buildAtLighthouse 双资源门控；homeOnly 轨（船坞）只对家灯塔显示。
// 由 SeaChartView 唤出（灯塔在海图上可见，建造也在海图上）。

import type {
  GameState,
  Lighthouse,
  LighthouseTrack,
  LighthouseUpgradeDef,
  PlayerProfile,
  UpgradeCost,
} from '@/types';
import {
  canBuildAt,
  buildAtLighthouse,
  devBuildAtLighthouse,
  getLighthouseTracks,
  getBuiltLevelInTrack,
} from '@/engine/lighthouses';
import { getOutpostForLighthouse } from '@/engine/outposts';
import { countInInventory, HOME_LIGHTHOUSE_ID } from '@/engine/state';
import { getItemDef } from '@/engine/items';
import { PanelShell } from './PanelShell';
import { DEV_TOOLS } from './devMode';

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
      sub={<>银行 {state.profile.bankedGold} 金币 · 探得更深</>}
      foot={
        <button className="btn" onClick={onClose}>
          返回
        </button>
      }
    >
      {state.profile.lighthouses
        .filter((lh) => !focusLighthouseId || lh.id === focusLighthouseId)
        .map((lh) => {
        // 深水区 Phase 2b：能源设施（充电/制氧/水力）只在 OutpostDef 支撑的深水前哨可建；水力再限水流前哨。
        const outpost = getOutpostForLighthouse(lh.id);
        const trackVisible = (t: LighthouseTrack): boolean => {
          if (t.onlyLighthouse) return lh.id === t.onlyLighthouse;
          if (t.homeOnly) return lh.id === HOME_LIGHTHOUSE_ID;
          if (t.currentOnly) return !!outpost?.current;
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
        {track.upgrades.map((u) => (
          <LighthouseUpgradeRow
            key={u.id}
            def={u}
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
  lighthouse,
  state,
  onBuild,
  onDevBuild,
}: {
  def: LighthouseUpgradeDef;
  lighthouse: Lighthouse;
  state: GameState;
  onBuild: (lighthouseId: string, upgradeId: string) => void;
  onDevBuild: (lighthouseId: string, upgradeId: string) => void;
}) {
  const built = lighthouse.builtUpgrades.has(def.id);
  const avail = canBuildAt(state.profile, lighthouse, def.id);

  let statusEl: JSX.Element;
  if (built) {
    statusEl = <span className="upgrade-status owned">已建</span>;
  } else if (avail.ok) {
    statusEl = (
      <button className="btn upgrade-buy" onClick={() => onBuild(lighthouse.id, def.id)}>
        建造
      </button>
    );
  } else if (avail.reason === 'needsPrev') {
    statusEl = <span className="upgrade-status locked">需要前一级</span>;
  } else if (avail.reason === 'needsLighthouseLevel') {
    statusEl = <span className="upgrade-status locked">灯塔等级不足</span>;
  } else if (avail.reason === 'notEnoughMaterials') {
    statusEl = (
      <button className="btn upgrade-buy" disabled>
        材料不足
      </button>
    );
  } else if (avail.reason === 'notEnoughGold') {
    statusEl = (
      <button className="btn upgrade-buy" disabled>
        金币不足（还差 {avail.goldShort}）
      </button>
    );
  } else {
    statusEl = <span className="upgrade-status locked">不可用</span>;
  }

  return (
    <div className={`upgrade-row ${built ? 'owned' : ''}`}>
      <div className="upgrade-row-main">
        <div className="upgrade-row-name">{def.name}</div>
        <div className="upgrade-row-desc">{def.description}</div>
        {!built && <LighthouseCostLine cost={def.cost} profile={state.profile} />}
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
      <div className="upgrade-row-side">{statusEl}</div>
    </div>
  );
}

/** 账单明细：逐条材料"名×需求量"，不足高亮 + 标注已有数；金币同理（镜像 UpgradePanel::CostLine）。 */
function LighthouseCostLine({ cost, profile }: { cost: UpgradeCost; profile: PlayerProfile }) {
  const goldShort = profile.bankedGold < cost.gold;
  return (
    <div className="upgrade-cost">
      <span className="upgrade-cost-label">需要：</span>
      {cost.materials.map((m) => {
        const owned = countInInventory(profile.inventory, m.itemId);
        const short = owned < m.qty;
        return (
          <span key={m.itemId} className={`upgrade-cost-mat ${short ? 'short' : 'ok'}`}>
            {getItemDef(m.itemId)?.name ?? m.itemId}×{m.qty}
            {short && <span className="upgrade-cost-have">（有 {owned}）</span>}
          </span>
        );
      })}
      {cost.gold > 0 && (
        <span className={`upgrade-cost-gold ${goldShort ? 'short' : 'ok'}`}>＋ {cost.gold} 金</span>
      )}
    </div>
  );
}
