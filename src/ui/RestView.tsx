import type { GameState } from '@/types';
import { enterNodeSelection, restAtNode } from '@/engine/dive';
import { StatusBar } from './StatusBar';

interface Props {
  state: GameState;
  onStateChange: (s: GameState) => void;
}

export function RestView({ state, onStateChange }: Props) {
  if (!state.run || !state.run.map || !state.run.currentNodeId) return null;
  const node = state.run.map.nodes[state.run.currentNodeId];

  function handleRest() {
    onStateChange(restAtNode(state, 3));
  }

  function handleContinue() {
    onStateChange(enterNodeSelection(state));
  }

  function handleAscendHere() {
    onStateChange({ ...state, phase: { kind: 'ascent', targetDepth: 0 } });
  }

  const isAscentPoint = node.kind === 'ascent_point';

  return (
    <div className="dive">
      <StatusBar run={state.run} />
      <article className="event tone-realistic">
        <h2 className="event-title">
          {isAscentPoint ? '上浮口' : '安静的水域'}
        </h2>
        <div className="event-body">
          <p>{node.preview}</p>
          {isAscentPoint && (
            <p className="dim">向上的礁脊在头顶。从这里上浮比较稳妥。</p>
          )}
        </div>
        <ul className="event-options">
          <li>
            <button className="btn event-option" onClick={handleRest}>
              停下来调整呼吸（消耗 3 回合 / 体力 +15）
            </button>
          </li>
          <li>
            <button className="btn event-option" onClick={handleContinue}>
              继续下潜
            </button>
          </li>
          {isAscentPoint && (
            <li>
              <button className="btn event-option ascend" onClick={handleAscendHere}>
                ↑ 从此上浮
              </button>
            </li>
          )}
        </ul>
      </article>
    </div>
  );
}
