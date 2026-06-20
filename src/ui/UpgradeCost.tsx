// 升级/打造账单 —— 可复用「需求清单 + 门控按钮」（作者 2026-06-20·C·复用单一来源）。
// 一处长相、处处一致：Otto 改装/打造（EquipmentDoll）、灯塔设施（LighthouseBuildPanel·beacon）、
// 打捞行会/全局升级（UpgradePanel）都用它，别再各写各的账单 + 按钮（守作者「界面工整」偏好·见 ui-tidy-preference）。
//
// 排版＝变体 B「对齐清单」（作者 2026-06-20 拍·见 #2 排版对一下）：每料一行〔图标 · 名字 · 已有/需求右对齐成列〕，
// 按钮右下对齐；**材料按稀有度排序**（稀有在前·gating 料置顶·金币恒列末）。不足标红 .short；按钮在材料/金币不足时
// disabled 并把文字换成「材料不足 / 金币不足」（满足则显 actionLabel）。账单之外的门（needsPrev/灯塔等级）→ 调用方
// 传 disabled + disabledLabel 覆盖按钮态。
// 边界：src/ui·纯展示 + 读 getItemDef（ui→engine 合法）·不构造 phase·可负担与否本组件按 cost 自算。

import { getItemDef } from '@/engine/items';
import type { ItemRarity } from '@/types/items';

export interface UpgradeCostSpec {
  materials: { itemId: string; qty: number }[];
  gold: number;
}

// 稀有度排序权重（作者 2026-06-20·账单按稀有度排序）：稀有在前（legendary→common）；同稀有保持原序（稳定排序）。
const RARITY_WEIGHT: Record<ItemRarity, number> = { legendary: 3, rare: 2, uncommon: 1, common: 0 };
function rarityWeight(itemId: string): number {
  return RARITY_WEIGHT[getItemDef(itemId)?.rarity ?? 'common'];
}

export function UpgradeCostView({
  cost,
  inventory,
  bankedGold,
  actionLabel,
  onConfirm,
  disabled = false,
  disabledLabel,
}: {
  cost: UpgradeCostSpec;
  inventory: { itemId: string; qty: number }[];
  bankedGold: number;
  /** 满足时按钮文字（如「改装」「打造」「建造」）。 */
  actionLabel: string;
  onConfirm: () => void;
  /** 账单之外的硬门（如已满级 / 需要前一级）——传 true＝按钮恒 disabled。 */
  disabled?: boolean;
  /** disabled 时的按钮文字（如「需要前一级」「灯塔等级不足」）；缺省回落 actionLabel。 */
  disabledLabel?: string;
}) {
  const ownedOf = (id: string) => inventory.find((i) => i.itemId === id)?.qty ?? 0;
  const matShort = cost.materials.some((m) => ownedOf(m.itemId) < m.qty);
  const goldShort = bankedGold < cost.gold;
  const blocked = disabled || matShort || goldShort;
  // 按钮文字传达「为什么点不了」：外部门优先（needsPrev…），再材料、再金币（与 engine 账单口径：先料后金）。
  const label = disabled
    ? disabledLabel ?? actionLabel
    : matShort
      ? '材料不足'
      : goldShort
        ? '金币不足'
        : actionLabel;

  // 按稀有度降序（稀有在前·gating 料置顶）；同稀有保持原序（稳定）。金币不在此列、恒附末行。
  const mats = [...cost.materials].sort((a, b) => rarityWeight(b.itemId) - rarityWeight(a.itemId));

  return (
    <div className="cost-block">
      <div className="cost-list">
        {mats.map((m) => {
          const have = ownedOf(m.itemId);
          const short = have < m.qty;
          const def = getItemDef(m.itemId);
          return (
            <div
              key={m.itemId}
              className={`cost-row rarity-${def?.rarity ?? 'common'} ${short ? 'short' : ''}`}
              title={`${def?.name ?? m.itemId}（已有 ${have} / 需 ${m.qty}）`}
            >
              <span className="item-cell-icon" data-cat={def?.category ?? 'material'} aria-hidden="true" />
              <span className="cost-row-name">{def?.name ?? m.itemId}</span>
              <span className="cost-row-count">{have}/{m.qty}</span>
            </div>
          );
        })}
        {cost.gold > 0 && (
          <div className={`cost-row gold ${goldShort ? 'short' : ''}`} title={`金币（持有 ${bankedGold} / 需 ${cost.gold}）`}>
            <span className="item-cell-icon" data-cat="currency" aria-hidden="true" />
            <span className="cost-row-name">金币</span>
            <span className="cost-row-count">{bankedGold}/{cost.gold}</span>
          </div>
        )}
      </div>
      <div className="cost-foot">
        <button type="button" className="btn small cost-confirm" disabled={blocked} onClick={onConfirm}>
          {label}
        </button>
      </div>
    </div>
  );
}
