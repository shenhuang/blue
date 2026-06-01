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

  // 能见度（海图 POI 修正）：dark 时看不清前方，节点预览被遮蔽（盲航）。
  // 深度数字 + 上浮口标识仍显示——你有深度表，也分得清向上的礁脊。
  const blind = state.run.diveModifier?.visibility === 'dark';

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
          <p className="dim">{blind ? '光照不进来。前方只有几团模糊的黑影。' : '前方有几条路。'}</p>
        </div>
        <ul className="event-options">
          {choices.map((c) => {
            const isAscent = c.isAscentPoint;
            const isAir = c.kind === 'air_pocket';
            const isCamp = c.kind === 'camp';
            const isLandmark = isAscent || isAir || isCamp; // 地标：盲航也看得见
            const cur = state.run!.currentDepth;
            const dir = c.depth > cur ? '更深处。' : c.depth < cur ? '更浅处。' : '同等深度。';
            const label = isAscent
              ? '↑ 上浮口'
              : isAir
                ? '○ 气穴'
                : isCamp
                  ? '⌂ 扎营点'
                  : `${c.depth}m`;
            return (
              <li key={c.nodeId}>
                <button
                  className={`btn event-option ${c.hasCorpseHint ? 'corpse' : ''} ${isAir || isCamp ? 'landmark' : ''} ${c.visited ? 'visited' : ''}`}
                  onClick={() => handlePick(c.nodeId)}
                >
                  <div className="node-row">
                    <span className="node-depth">{label}</span>
                    <span className="node-preview">
                      {/* 盲航遮蔽前方预览，但地标（上浮口/气穴/扎营点）和"来过"的路你还认得 */}
                      {c.visited
                        ? blind && !isLandmark
                          ? '来过的方向，记得这片黑。'
                          : c.preview
                        : blind && !isLandmark
                          ? '看不清，一团黑影。'
                          : c.preview}
                    </span>
                  </div>
                  {c.hasCorpseHint && (
                    <div className="node-hint">这一带似乎有熟悉的东西…</div>
                  )}
                  {!isAscent && (
                    <div className="node-hint dim">
                      {c.visited ? `已来过 · ${dir}` : dir}
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
