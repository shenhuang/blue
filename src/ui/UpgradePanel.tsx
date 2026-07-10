// 改装装备面板 —— 把 upgrades.json 里的升级线呈现给玩家（个人潜水装备；打捞行会=服务·已移交 Mira·作者 06-13）
// 显示每条 line 的 lv1/lv2/lv3，标注已购、可购、缺前置、材料/金币不足（缺口高亮）

import type { ReactNode } from 'react';
import type {
  GameState,
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
import { DEV_TOOLS } from './devMode';
import { PanelShell } from './PanelShell';
import { UpgradeCostView } from './UpgradeCost';
import { UpgradeEffectDelta, emptyEffectSet, mergeEffectSets, type EffectSet, type StatLine } from './UpgradeEffectDelta';

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
  // 每级 before＝低级累计·after＝含本级累计（前缀和）→ 喂统一 UpgradeEffectDelta（数值前后对比·解锁新增·作者 2026-06-20·#5）。
  const rowSets: { before: EffectSet; after: EffectSet }[] = [];
  let cum = emptyEffectSet();
  for (const u of line.upgrades) {
    const before = cum;
    const after = mergeEffectSets(cum, upgradeEffectSet(u.effects));
    rowSets.push({ before, after });
    cum = after;
  }

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
        {line.upgrades.map((u, i) => (
          <UpgradeRow
            key={u.id}
            def={u}
            before={rowSets[i].before}
            after={rowSets[i].after}
            state={state}
            onBuy={onBuy}
            onDevUnlock={onDevUnlock}
          />
        ))}
      </div>
    </div>
  );
}

function UpgradeRow({
  def,
  before,
  after,
  state,
  onBuy,
  onDevUnlock,
}: {
  def: UpgradeDef;
  before: EffectSet;
  after: EffectSet;
  state: GameState;
  onBuy: (id: string) => void;
  onDevUnlock: (id: string) => void;
}) {
  const owned = state.profile.unlockedUpgrades.has(def.id);
  const avail = canPurchase(state.profile, def.id);
  // 账单之外的门（前置）→ 传 UpgradeCostView 的 disabled + 文案；材料/金币不足由它自算（统一账单 UI·作者 2026-06-20）。
  const extraBlocked = !owned && !avail.ok && avail.reason === 'needsPrev';

  return (
    <div className={`upgrade-row ${owned ? 'owned' : ''}`}>
      <div className="upgrade-row-main">
        <div className="upgrade-row-name">{def.name}</div>
        <div className="upgrade-row-desc">{def.description}</div>
        <UpgradeEffectDelta
          before={before}
          after={after}
          beforeLabel={`Lv.${def.level - 1}`}
          afterLabel={`Lv.${def.level}`}
          build={def.level === 1}
        />
        {!owned && (
          <UpgradeCostView
            cost={def.cost}
            inventory={state.profile.inventory}
            bankedGold={state.profile.bankedGold}
            actionLabel="改装"
            onConfirm={() => onBuy(def.id)}
            disabled={extraBlocked}
            disabledLabel={extraBlocked ? '需要前一级' : undefined}
          />
        )}
        {/* Dev 测试解锁（?dev 门后·作者要求「不需要材料直接解锁任何港口升级」）：跳过材料/金币/前置，
            同 Mira 测试货架口径；普通访客不渲染。 */}
        {DEV_TOOLS && !owned && (
          <button className="btn small upgrade-dev-unlock" onClick={() => onDevUnlock(def.id)}>
            测试解锁（0 成本）
          </button>
        )}
      </div>
      <div className="upgrade-row-side">
        {owned && <span className="upgrade-status owned">已改装</span>}
      </div>
    </div>
  );
}

// UpgradeEffect → EffectSet（数值项 stats·解锁项 unlocks·作者 2026-06-20·#5·喂统一 UpgradeEffectDelta）。
function upgradeEffectSet(effects: UpgradeEffect[]): EffectSet {
  const stats: StatLine[] = [];
  const unlocks: string[] = [];
  for (const e of effects) {
    switch (e.kind) {
      case 'oxygenMaxBonus':
        stats.push({ label: e.kind, value: e.value, render: (v) => `氧气上限 +${v} 回合` });
        break;
      case 'staminaMaxBonus':
        stats.push({ label: e.kind, value: e.value, render: (v) => `体力上限 +${v}` });
        break;
      case 'preservationBonus':
        stats.push({ label: e.kind, value: e.value, render: (v) => `尸体保鲜 +${v}` });
        break;
      case 'roomFeatureChanceBonus':
        stats.push({ label: e.kind, value: e.value, render: (v) => `大房间出现率 +${Math.round(v * 100)}%` });
        break;
      case 'unlockZone':
        unlocks.push(`解锁海域：${zoneLabel(e.zoneId)}`);
        break;
      case 'revealCorpseHint':
        if (e.value) unlocks.push('海图标记尸体');
        break;
      case 'preDiveCorpseSelect':
        if (e.value) unlocks.push('出海前可选目标尸体');
        break;
      case 'currentSweepImmune':
        if (e.value) unlocks.push('海流不再冲走物品');
        break;
    }
  }
  return { stats, unlocks };
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
