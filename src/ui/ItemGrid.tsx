import { useEffect, useRef, useState } from 'react';
import type { InventoryItem } from '@/types';
import { getItemDef } from '@/engine/items';
import { ItemCell } from './ItemCell';

// 响应式物品网格 + 翻页（SPEC §6.3）：列数随容器宽自适应（ResizeObserver 测量），行数固定（rows·默认 3）→
// 每页 cols*rows 个、溢出翻页。港口物品栏与潜水战利品共用同一组件——单一来源，别两处各写一套。
// 纯展示（无 onClick·走 ItemCell 的非交互形态）；稀有度边框由 variant=rarity-<rarity> 交给 CSS。

const CELL_STRIDE = 78; // .item-cell 宽 72 + gap 6（列数估算用·与 styles.css 的 .item-cell/.item-grid 同步）

export function ItemGrid({
  items,
  rows = 3,
  emptyText = '空空如也。',
}: {
  items: InventoryItem[];
  /** 每页行数（每页容量 = 列数 × rows）。 */
  rows?: number;
  emptyText?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [cols, setCols] = useState(4);
  const [page, setPage] = useState(0);

  // 列数随容器宽自适应（作者：「根据屏幕大小选择」）；SSR / 无 ResizeObserver 时退回默认 4。
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const measure = () => setCols(Math.max(1, Math.floor((el.clientWidth + 6) / CELL_STRIDE)));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const pageSize = Math.max(1, cols * rows);
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const page0 = Math.min(page, pageCount - 1); // 列数变化致页数缩水时夹住（不越界）
  const shown = items.slice(page0 * pageSize, page0 * pageSize + pageSize);

  return (
    <div className="item-grid-pager" ref={ref}>
      {items.length === 0 ? (
        <p className="item-grid-empty">{emptyText}</p>
      ) : (
        <>
          <div className="item-grid">
            {shown.map((it) => {
              const def = getItemDef(it.itemId);
              return (
                <ItemCell key={it.itemId} def={def} itemId={it.itemId} qty={it.qty} />
              );
            })}
          </div>
          {pageCount > 1 && (
            <div className="item-grid-nav">
              <button
                type="button"
                className="btn small"
                disabled={page0 === 0}
                onClick={() => setPage(page0 - 1)}
                aria-label="上一页"
              >
                ‹
              </button>
              <span className="item-grid-page">
                {page0 + 1} / {pageCount}
              </span>
              <button
                type="button"
                className="btn small"
                disabled={page0 >= pageCount - 1}
                onClick={() => setPage(page0 + 1)}
                aria-label="下一页"
              >
                ›
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
