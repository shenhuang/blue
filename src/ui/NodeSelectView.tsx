import type { GameState, NodeChoice } from '@/types';
import { moveToNode } from '@/engine/dive';
import { StatusBar } from './StatusBar';

interface Props {
  state: GameState;
  choices: NodeChoice[];
  onStateChange: (s: GameState) => void;
}

export function NodeSelectView({ state, choices, onStateChange }: Props) {
  if (!state.run) return null;

  function handlePick(nodeId: string) {
    onStateChange(moveToNode(state, nodeId));
  }

  function handleAscendNow() {
    onStateChange({ ...state, phase: { kind: 'ascent', targetDepth: 0 } });
  }

  return (
    <div className="dive">
      <StatusBar run={state.run} />
      <article className="event tone-realistic">
        <h2 className="event-title">下一步</h2>
        <div className="event-body">
          <p>你停在水里，向前看去。</p>
          <p className="dim">前方有几条路。</p>
        </div>
        <ul className="event-options">
          {choices.map((c) => {
            const isAscent = c.isAscentPoint;
            const deeper = c.depth > state.run!.currentDepth;
            return (
              <li key={c.nodeId}>
                <button
                  className={`btn event-option ${c.hasCorpseHint ? 'corpse' : ''}`}
                  onClick={() => handlePick(c.nodeId)}
                >
                  <div className="node-row">
                    <span className="node-depth">
                      {isAscent ? '↑ 上浮口' : `${c.depth}m`}
                    </span>
                    <span className="node-preview">{c.preview}</span>
                  </div>
                  {c.hasCorpseHint && (
                    <div className="node-hint">这一带似乎有熟悉的东西…</div>
                  )}
                  {!isAscent && (
                    <div className="node-hint dim">
                      {deeper ? '更深处。' : '同等深度。'}
                    </div>
                  )}
                </button>
              </li>
            );
          })}
          <li>
            <button className="btn event-option ascend" onClick={handleAscendNow}>
              ↑ 此处上浮
            </button>
          </li>
        </ul>
      </article>
    </div>
  );
}
