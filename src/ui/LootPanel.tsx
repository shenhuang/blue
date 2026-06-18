import type { GameState } from '@/types';
import { ItemGrid } from './ItemGrid';

// 潜水战利品（只读 run.inventory·SPEC §6）：本次下潜临时背包里已拿到的东西，只看不动
// （作者：「目前只要能看到战利品就行」——不做丢弃/整理）。回港后才并进 profile.inventory（§1.1）。
export function LootPanel({ state }: { state: GameState }) {
  const items = state.run?.inventory ?? [];
  const total = items.reduce((s, it) => s + it.qty, 0);
  return (
    <div className="loot-panel">
      <div className="loot-panel-head">本次下潜 · 战利品{total > 0 ? `（${total}）` : ''}</div>
      <ItemGrid items={items} rows={3} emptyText="还没捞到东西。" />
    </div>
  );
}
