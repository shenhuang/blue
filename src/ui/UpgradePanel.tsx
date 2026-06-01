// 港口修缮面板 —— 把 upgrades.json 里的升级线呈现给玩家
// 显示每条 line 的 lv1/lv2/lv3，标注已购、可购、缺前置、不够建设值

import type { GameState, UpgradeDef, UpgradeEffect, UpgradeLine } from '@/types';
import {
  canPurchase,
  getUpgradeLines,
  getUnlockedLevelInLine,
  purchaseUpgrade,
} from '@/engine/upgrades';

interface Props {
  state: GameState;
  onStateChange: (s: GameState) => void;
  onClose: () => void;
}

export function UpgradePanel({ state, onStateChange, onClose }: Props) {
  const lines = getUpgradeLines();

  function handleBuy(id: string) {
    onStateChange(purchaseUpgrade(state, id));
  }

  return (
    <div className="upgrade-panel">
      <div className="upgrade-head">
        <div>
          <div className="upgrade-title">港口修缮</div>
          <div className="upgrade-sub">建设值 {state.profile.buildingPoints}</div>
        </div>
        <button className="btn upgrade-close" onClick={onClose}>
          返回
        </button>
      </div>

      {lines.map((line) => (
        <UpgradeLineCard
          key={line.id}
          line={line}
          state={state}
          onBuy={handleBuy}
        />
      ))}
    </div>
  );
}

function UpgradeLineCard({
  line,
  state,
  onBuy,
}: {
  line: UpgradeLine;
  state: GameState;
  onBuy: (id: string) => void;
}) {
  const haveLevel = getUnlockedLevelInLine(state.profile, line);

  return (
    <div className="upgrade-line">
      <div className="upgrade-line-head">
        <span className="upgrade-line-name">{line.name}</span>
        <span className="upgrade-line-progress">
          Lv.{haveLevel} / {line.upgrades.length}
        </span>
      </div>
      <div className="upgrade-line-desc">{line.description}</div>
      <div className="upgrade-line-rows">
        {line.upgrades.map((u) => (
          <UpgradeRow key={u.id} def={u} state={state} onBuy={onBuy} />
        ))}
      </div>
    </div>
  );
}

function UpgradeRow({
  def,
  state,
  onBuy,
}: {
  def: UpgradeDef;
  state: GameState;
  onBuy: (id: string) => void;
}) {
  const owned = state.profile.unlockedUpgrades.has(def.id);
  const avail = canPurchase(state.profile, def.id);

  let statusEl: JSX.Element;
  if (owned) {
    statusEl = <span className="upgrade-status owned">已修缮</span>;
  } else if (avail.ok) {
    statusEl = (
      <button className="btn upgrade-buy" onClick={() => onBuy(def.id)}>
        修缮 · {def.cost} 建设值
      </button>
    );
  } else if (avail.reason === 'needsPrev') {
    statusEl = <span className="upgrade-status locked">需要前一级</span>;
  } else if (avail.reason === 'notEnoughPoints') {
    statusEl = (
      <button className="btn upgrade-buy" disabled>
        {def.cost} 建设值（不够）
      </button>
    );
  } else {
    statusEl = <span className="upgrade-status locked">不可用</span>;
  }

  return (
    <div className={`upgrade-row ${owned ? 'owned' : ''}`}>
      <div className="upgrade-row-main">
        <div className="upgrade-row-name">
          {def.name}
        </div>
        <div className="upgrade-row-desc">{def.description}</div>
        <div className="upgrade-effects">
          {def.effects.map((e, i) => (
            <span key={i} className="upgrade-effect-chip">
              {renderEffect(e)}
            </span>
          ))}
        </div>
      </div>
      <div className="upgrade-row-side">{statusEl}</div>
    </div>
  );
}

function renderEffect(e: UpgradeEffect): string {
  switch (e.kind) {
    case 'unlockZone':
      return `解锁海域：${zoneLabel(e.zoneId)}`;
    case 'extraConsumableSlot':
      return `背包格 +${e.value}`;
    case 'oxygenMaxBonus':
      return `氧气上限 +${e.value} 回合`;
    case 'staminaMaxBonus':
      return `体力上限 +${e.value}`;
    case 'preservationBonus':
      return `尸体保鲜 +${e.value}`;
    case 'revealCorpseHint':
      return e.value ? '海图标记尸体' : '';
    case 'preDiveCorpseSelect':
      return e.value ? '出海前可选目标尸体' : '';
    case 'currentSweepImmune':
      return e.value ? '海流不再冲走物品' : '';
    case 'unlockShopItem':
      return `解锁商店：${itemLabel(e.itemId)}`;
  }
}

function zoneLabel(id: string): string {
  switch (id) {
    case 'zone.east_reef':
      return '东礁';
    case 'zone.old_lighthouse_reef':
      return '旧灯塔礁';
    default:
      return id;
  }
}

function itemLabel(id: string): string {
  switch (id) {
    case 'item.spare_tank':
      return '备用气瓶';
    default:
      return id;
  }
}
