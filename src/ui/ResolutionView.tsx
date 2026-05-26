import type { GameState, RunOutcome } from '@/types';

interface Props {
  state: GameState;
  outcome: RunOutcome;
  onReturn: () => void;
}

export function ResolutionView({ outcome, onReturn }: Props) {
  return (
    <div className="resolution">
      <h2>{outcome.survived ? '回到水面' : '未能归来'}</h2>
      <div className="resolution-rows">
        <div>最深深度：{outcome.maxDepthReached}m</div>
        <div>触发事件：{outcome.eventsTriggered}</div>
        <div>建设值：+{outcome.buildingPointsEarned}</div>
        <div>金币：+{outcome.goldEarned}</div>
        {outcome.cause && <div className="cause">{outcome.cause}</div>}
      </div>
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
