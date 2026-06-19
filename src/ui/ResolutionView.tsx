import type { GameState, RunOutcome, InventoryItem } from '@/types';
import { getItemDef } from '@/engine/items';
import { ItemCell } from './ItemCell';

interface Props {
  state: GameState;
  outcome: RunOutcome;
  onReturn: () => void;
}

/** 一组获得物的陈列——与物品栏同款格子（ItemCell·稀有度边框·多了自动换行·作者 #142）。 */
function LootItems({ items }: { items: InventoryItem[] }) {
  return (
    <div className="item-grid">
      {items.map((i) => (
        <ItemCell key={i.itemId} def={getItemDef(i.itemId)} itemId={i.itemId} qty={i.qty} />
      ))}
    </div>
  );
}

export function ResolutionView({ outcome, onReturn }: Props) {
  // 结算战利品：本次带回的物品全都一起陈列（不按来源分组·作者 #142），与物品栏同款格子·多了自动换行。
  return (
    <div className="resolution">
      <h2>{outcome.survived ? '回到水面' : '未能归来'}</h2>
      <div className="resolution-rows">
        <div>最深深度：{outcome.maxDepthReached}m</div>
        <div>金币：+{outcome.goldEarned}</div>
        {outcome.lootValue > 0 && (
          <div className="dim">战利品估价：~{outcome.lootValue} 金（回港找 Mira 兑现）</div>
        )}
        {outcome.cause && <div className="cause">{outcome.cause}</div>}
      </div>

      {outcome.loot.length > 0 && (
        <div className="resolution-loot">
          <h4 className="resolution-loot-beat">带回</h4>
          <LootItems items={outcome.loot} />
        </div>
      )}

      <button className="btn" onClick={onReturn}>
        回到港口
      </button>
    </div>
  );
}

export function GameOverView({ state, onRestart }: { state: GameState; onRestart: () => void }) {
  return (
    <div className="resolution gameover">
      <h2>你没能回来。</h2>
      <p>
        死亡发生在 {state.run?.currentDepth ?? 0}m。
        <br />
        本次身上的物资沉在海底，等待下一个潜水员找到。
      </p>
      <button className="btn" onClick={onRestart}>
        重开
      </button>
    </div>
  );
}
