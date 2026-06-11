import type { GameState } from '@/types';
import { enterNodeSelection, restAtNode, breatheAtAirPocket, campAtNode, beginAscentFromDive } from '@/engine/dive';
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
    // 经猎手拦截入口（06-11）：贴邻的猎手会在你转身向上时先手扑上；不贴邻照常上浮。
    onStateChange(beginAscentFromDive(state));
  }

  function handleBreathe() {
    onStateChange(breatheAtAirPocket(state));
  }

  function handleCamp(mode: 'short' | 'long') {
    onStateChange(campAtNode(state, mode));
  }

  const kind = node.kind;
  const isAscentPoint = kind === 'ascent_point';
  const title =
    kind === 'air_pocket'
      ? '气穴'
      : kind === 'camp'
        ? '扎营点'
        : isAscentPoint
          ? '上浮口'
          : '安静的水域';
  const airUsed = kind === 'air_pocket' && state.run.activeFlags.has(`air_used:${node.id}`);

  return (
    <div className="dive">
      <StatusBar run={state.run} />
      <article className="event tone-realistic">
        <h2 className="event-title">{title}</h2>
        <div className="event-body">
          <p>{node.preview}</p>
          {isAscentPoint && (
            <p className="dim">向上的礁脊在头顶。从这里上浮比较稳妥。</p>
          )}
          {kind === 'air_pocket' && (
            <p className="dim">礁顶兜住的一囊空气。能换口气——但只有这么一囊。</p>
          )}
          {kind === 'camp' && (
            <p className="dim">卡住浮力，能踏实歇一会儿。代价是流逝的氧气。</p>
          )}
        </div>
        <ul className="event-options">
          {kind === 'air_pocket' ? (
            <li>
              <button className="btn event-option" onClick={handleBreathe} disabled={airUsed}>
                {airUsed ? '气穴已被吸空' : '上去呼吸（氧气 +6 / 理智 +4）'}
              </button>
            </li>
          ) : kind === 'camp' ? (
            <>
              <li>
                <button className="btn event-option" onClick={() => handleCamp('short')}>
                  短暂休整（3 回合 · 体力 +15 · 理智 +5）
                </button>
              </li>
              <li>
                <button className="btn event-option" onClick={() => handleCamp('long')}>
                  认真扎营（6 回合 · 体力 +30 · 理智 +10 · 氮气 −5）
                </button>
              </li>
            </>
          ) : (
            <li>
              <button className="btn event-option" onClick={handleRest}>
                停下来调整呼吸（消耗 3 回合 / 体力 +15）
              </button>
            </li>
          )}
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
