// 物品格子（通用展示单元·作者 2026-06-10「背包/储物柜格子化·货物图标陈列」）：
// 图标占位 + 名称 + 数量/备注角标。三种形态：可点（onClick）/ 禁点（onClick+disabled·变灰）/ 纯陈列（无 onClick·不变灰）。
// 复用点：海图「行前装包」（背包格/储物柜格）+ Mira 柜台（货架/储物柜）——格子长相只此一份，别再各写各的。
// 图标：作者拍板「以后生成、现在先空着」——.item-cell-icon 是空占位框（按 category 留了 data-cat 钩子，
// 将来 CSS 按类上图或 ItemDef 加 icon 字段都不用动这里的结构）。
// 反馈动画：cellKey 随数量变化 → 元素重挂载 → 重放 .item-grid.live 的 item-pop（购买「确实进来了」的跳动）。

import type { ItemDef } from '@/types';

export function ItemCell({
  def,
  itemId,
  qty,
  note,
  onClick,
  disabled,
  title,
  variant,
  cellKey,
}: {
  def: ItemDef | undefined;
  itemId: string;
  /** 数量角标（>1 才显示 ×N；undefined＝不显示）。 */
  qty?: number;
  /** 格内底部小字备注（价格 / 库存等）。 */
  note?: string;
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
  /** 附加样式钩子（如 'short'＝钱不够红显）。 */
  variant?: string;
  /** 随数量变化的 key → 重挂载 → 重放入场动画（购买反馈）。 */
  cellKey?: string;
}) {
  const inner = (
    <>
      <span className="item-cell-icon" data-cat={def?.category ?? 'unknown'} aria-hidden="true" />
      <span className="item-cell-name">{def?.name ?? itemId}</span>
      {qty !== undefined && qty > 1 && <span className="item-cell-qty">×{qty}</span>}
      {note && <span className="item-cell-note">{note}</span>}
    </>
  );
  const cls = `item-cell ${variant ?? ''}`;
  if (!onClick) {
    // 纯陈列（储物柜一览等）：非交互元素，不走 disabled 变灰。
    return (
      <span key={cellKey} className={cls} title={title ?? def?.description}>
        {inner}
      </span>
    );
  }
  return (
    <button
      key={cellKey}
      type="button"
      className={`${cls} ${disabled ? '' : 'clickable'}`}
      onClick={onClick}
      disabled={disabled}
      title={title ?? def?.description}
    >
      {inner}
    </button>
  );
}

/** 空格占位（背包未占用的格）：虚线空框，只为「上限可见」。 */
export function EmptyCell() {
  return (
    <span className="item-cell empty" aria-label="空格">
      <span className="item-cell-icon" aria-hidden="true" />
    </span>
  );
}
