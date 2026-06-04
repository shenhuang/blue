// 港口修缮面板 —— 把 upgrades.json 里的升级线呈现给玩家
// 显示每条 line 的 lv1/lv2/lv3，标注已购、可购、缺前置、材料/金币不足（缺口高亮）

import type {
  GameState,
  PlayerProfile,
  UpgradeCost,
  UpgradeDef,
  UpgradeEffect,
  UpgradeLine,
} from '@/types';
import {
  canPurchase,
  getUpgradeLines,
  getUnlockedLevelInLine,
  purchaseUpgrade,
} from '@/engine/upgrades';
import { countInInventory } from '@/engine/state';
import { getItemDef } from '@/engine/items';

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
          <div className="upgrade-sub">银行 {state.profile.bankedGold} 金币 · 用带回的材料修缮</div>
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
        修缮
      </button>
    );
  } else if (avail.reason === 'needsPrev') {
    statusEl = <span className="upgrade-status locked">需要前一级</span>;
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
        {!owned && <CostLine cost={def.cost} profile={state.profile} />}
      </div>
      <div className="upgrade-row-side">{statusEl}</div>
    </div>
  );
}

/** 账单明细：逐条材料"名×需求量"，自有不足时高亮 + 标注已有数；金币同理。 */
function CostLine({ cost, profile }: { cost: UpgradeCost; profile: PlayerProfile }) {
  const goldShort = profile.bankedGold < cost.gold;
  return (
    <div className="upgrade-cost">
      <span className="upgrade-cost-label">需要：</span>
      {cost.materials.map((m) => {
        const owned = countInInventory(profile.inventory, m.itemId);
        const short = owned < m.qty;
        return (
          <span
            key={m.itemId}
            className={`upgrade-cost-mat ${short ? 'short' : 'ok'}`}
          >
            {getItemDef(m.itemId)?.name ?? m.itemId}×{m.qty}
            {short && <span className="upgrade-cost-have">（有 {owned}）</span>}
          </span>
        );
      })}
      {cost.gold > 0 && (
        <span className={`upgrade-cost-gold ${goldShort ? 'short' : 'ok'}`}>
          ＋ {cost.gold} 金
        </span>
      )}
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
    case 'unlockSonar':
      return e.value ? '解锁声呐：黑水里可发脉冲探路' : '';
    // 深水区 Phase 0 升级轨
    case 'powerMaxBonus':
      return `电池总量 +${e.value}`;
    case 'sonarPingCostReduction':
      return `声呐 ping 耗电 −${e.value}`;
    case 'lampEfficiency':
      return `黑/浊水灯耗电 −${Math.round(e.value * 100)}%`;
    case 'sonarRobustness':
      return '声呐更抗欺骗：理智更低些才开始失真';
    case 'lampRobustness':
      return '灯更抗幻觉：理智更低些灯才开始骗你';
    case 'signatureReduction':
      return `更隐蔽：被探测 −${e.value}（点灯/ping 仍会暴露）`;
    // 深水区 Phase 1 续·节点级 clarity 范围/分辨
    case 'lampRangeBonus':
      return `灯探得更深 +${e.value}m（陡降里看清更远）`;
    case 'sonarRangeBonus':
      return `声呐探得更深 +${e.value}m`;
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
