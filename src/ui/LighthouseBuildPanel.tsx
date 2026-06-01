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
  getLighthouseTracks,
  getBuiltLevelInTrack,
  revealRadius,
} from '@/engine/lighthouses';
import { countInInventory, HOME_LIGHTHOUSE_ID } from '@/engine/state';
import { getItemDef } from '@/engine/items';

interface Props {
  state: GameState;
  onStateChange: (s: GameState) => void;
  onClose: () => void;
}

export function LighthouseBuildPanel({ state, onStateChange, onClose }: Props) {
  const tracks = getLighthouseTracks();

  function handleBuild(lighthouseId: string, upgradeId: string) {
    onStateChange(buildAtLighthouse(state, lighthouseId, upgradeId));
  }

  return (
    <div className="upgrade-panel lighthouse-build">
      <div className="upgrade-head">
        <div>
          <div className="upgrade-title">灯塔设施</div>
          <div className="upgrade-sub">
            银行 {state.profile.bankedGold} 金币 · 点亮的海更大、出海更近
          </div>
        </div>
        <button className="btn upgrade-close" onClick={onClose}>
          返回
        </button>
      </div>

      {state.profile.lighthouses.map((lh) => (
        <div key={lh.id} className="lighthouse-section">
          <div className="lighthouse-section-head">
            <span className="lighthouse-section-name">{lh.name}</span>
            <span className="dim lighthouse-section-meta">
              Lv.{lh.level} · 点亮半径 {revealRadius(lh).toFixed(2)}
            </span>
          </div>
          {tracks
            .filter((t) => !t.homeOnly || lh.id === HOME_LIGHTHOUSE_ID)
            .map((track) => (
              <LighthouseTrackCard
                key={track.id}
                track={track}
                lighthouse={lh}
                state={state}
                onBuild={handleBuild}
              />
            ))}
        </div>
      ))}
    </div>
  );
}

function LighthouseTrackCard({
  track,
  lighthouse,
  state,
  onBuild,
}: {
  track: LighthouseTrack;
  lighthouse: Lighthouse;
  state: GameState;
  onBuild: (lighthouseId: string, upgradeId: string) => void;
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
}: {
  def: LighthouseUpgradeDef;
  lighthouse: Lighthouse;
  state: GameState;
  onBuild: (lighthouseId: string, upgradeId: string) => void;
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
