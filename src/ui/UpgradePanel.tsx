// 改装装备面板 —— 把 upgrades.json 里的升级线呈现给玩家（个人潜水装备；打捞行会=服务·已移交 Mira·作者 06-13）
// 显示每条 line 的 lv1/lv2/lv3，标注已购、可购、缺前置、材料/金币不足（缺口高亮）

import type { ReactNode } from 'react';
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
  devUnlockUpgrade,
  getUpgradeLines,
  getUnlockedLevelInLine,
  purchaseUpgrade,
} from '@/engine/upgrades';
import { countInInventory } from '@/engine/state';
import { getItemDef } from '@/engine/items';
import { DEV_TOOLS } from './devMode';
import { PanelShell } from './PanelShell';

interface Props {
  state: GameState;
  onStateChange: (s: GameState) => void;
  onClose: () => void;
  /** 只显满足谓词的升级线（缺省＝全部）。用于把不同性质的升级摆到合理位置：
   *  港口「改装装备」只放个人潜水装备、打捞行会（服务）改由 Mira 提供（作者 06-13）。 */
  lineFilter?: (lineId: string) => boolean;
  /** 面板标题/副标题覆写（缺省＝改装装备口径）。 */
  title?: string;
  sub?: ReactNode;
}

export function UpgradePanel({ state, onStateChange, onClose, lineFilter, title, sub }: Props) {
  const lines = getUpgradeLines().filter((l) => (lineFilter ? lineFilter(l.id) : true));

  function handleBuy(id: string) {
    onStateChange(purchaseUpgrade(state, id));
  }

  // Dev 测试解锁（?dev 门后·quirk #97 同款门）：0 成本直接解锁——同 Mira 测试货架口径，
  // 真购买路径（purchaseUpgrade/canPurchase）零触碰；普通访客 DEV_TOOLS=false 不渲染按钮。
  function handleDevUnlock(id: string) {
    onStateChange(devUnlockUpgrade(state, id));
  }

  // Dev 一键升满（作者 2026-06-11 验收反馈）：全部升级线全级 devUnlockUpgrade 串一遍。
  // 引擎侧仍无门、已解锁 no-op（quirk #110 三条口径不变）——这颗按钮只是省测试者 N 次点击。
  function handleDevUnlockAll() {
    let s = state;
    for (const line of lines) for (const u of line.upgrades) s = devUnlockUpgrade(s, u.id);
    if (s !== state) onStateChange(s);
  }

  // 内容型界面统一壳（quirk #112）：金币头固定、升级线在中间滚、返回钉底通栏。
  return (
    <PanelShell
      className="under-port-header"
      title={title ?? '改装装备'}
      sub={sub ?? <>银行 {state.profile.bankedGold} 金币 · 用带回的材料改装随身装备</>}
      onClose={onClose}
    >
      {DEV_TOOLS && (
        <button className="btn small upgrade-dev-unlock" onClick={handleDevUnlockAll}>
          测试：一键升满全部（0 成本）
        </button>
      )}
      {lines.map((line) => (
        <UpgradeLineCard
          key={line.id}
          line={line}
          state={state}
          onBuy={handleBuy}
          onDevUnlock={handleDevUnlock}
        />
      ))}
    </PanelShell>
  );
}

function UpgradeLineCard({
  line,
  state,
  onBuy,
  onDevUnlock,
}: {
  line: UpgradeLine;
  state: GameState;
  onBuy: (id: string) => void;
  onDevUnlock: (id: string) => void;
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
          <UpgradeRow key={u.id} def={u} state={state} onBuy={onBuy} onDevUnlock={onDevUnlock} />
        ))}
      </div>
    </div>
  );
}

function UpgradeRow({
  def,
  state,
  onBuy,
  onDevUnlock,
}: {
  def: UpgradeDef;
  state: GameState;
  onBuy: (id: string) => void;
  onDevUnlock: (id: string) => void;
}) {
  const owned = state.profile.unlockedUpgrades.has(def.id);
  const avail = canPurchase(state.profile, def.id);

  let statusEl: JSX.Element;
  if (owned) {
    statusEl = <span className="upgrade-status owned">已改装</span>;
  } else if (avail.ok) {
    statusEl = (
      <button className="btn upgrade-buy" onClick={() => onBuy(def.id)}>
        改装
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
      <div className="upgrade-row-side">
        {statusEl}
        {/* Dev 测试解锁（?dev 门后·作者要求「不需要材料直接解锁任何港口升级」）：跳过材料/金币/前置，
            同 Mira 测试货架口径——真购买按钮照常在上面，这颗只给测试者。 */}
        {DEV_TOOLS && !owned && (
          <button className="btn small upgrade-dev-unlock" onClick={() => onDevUnlock(def.id)}>
            测试解锁（0 成本）
          </button>
        )}
      </div>
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
    // 段2（作者 2026-06-19）：传感器升级 kind 已从 UpgradeEffect 删除（声呐迁 Otto 打造的装备件·标签在
    //   EquipmentDoll；灯/规避回基线）——unlockSonar/powerMaxBonus/lamp*/sonar*/signatureReduction/soundAbsorb/camo
    //   的标签随之删。roomFeatureChanceBonus（salvage_guild lv4·仍为全局升级线）保留。
    case 'roomFeatureChanceBonus':
      return `更会翻找大洞室：开阔水域更常藏着多处可探（深处的「大房间」出现率 +${Math.round(e.value * 100)}%）`;
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
