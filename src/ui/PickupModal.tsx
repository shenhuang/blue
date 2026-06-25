import { useEffect } from 'react';
import type { PickupBox } from '@/types';
import { getItemDef } from '@/engine/items';
import { ItemCell } from './ItemCell';

// 获得物品弹窗（玩家感知·2026-06-25）：每次「捡到东西」的动作弹一格阻塞弹窗，列出本次动作获得的全部物品
// （批量·不每件一弹·队列与入队单点见 engine/state.ts::enqueuePickup）。**点任意处 / Esc / Enter → onDismiss**
// 出队下一格（作者定：无专门关闭按钮·整屏可点·App 逐格消费 state.pendingPickups）。纯展示：复用 ItemCell
// （与背包/储物柜同一种格子·UI 工整偏好），不读写 engine。来源标签（战利品/事件/建造）走 box.source。
interface Props {
  box: PickupBox;
  onDismiss: () => void;
}

export function PickupModal({ box, onDismiss }: Props) {
  // Esc / Enter 关闭（弹窗惯例·同 ChangelogModal）。box.id 进依赖 → 连续多格时每格重挂监听、对准当前格。
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' || e.key === 'Enter') onDismiss();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onDismiss, box.id]);

  // 整屏可点关闭（含卡片本身·不 stopPropagation）：作者定「点一下任意位置就关」。
  return (
    <div className="pickup-overlay" onClick={onDismiss}>
      <div className="pickup-modal" role="dialog" aria-modal="true" aria-label="获得物品">
        <div className="pickup-head">
          <span className="pickup-title">获得物品</span>
          {box.source && <span className="pickup-source">{box.source}</span>}
        </div>

        <div className="pickup-grid">
          {box.items.map((it) => (
            <ItemCell
              key={it.itemId}
              def={getItemDef(it.itemId)}
              itemId={it.itemId}
              qty={it.qty}
              cellKey={`${it.itemId}-${it.qty}`}
            />
          ))}
        </div>

        <div className="pickup-hint">点击任意处继续</div>
      </div>
    </div>
  );
}
