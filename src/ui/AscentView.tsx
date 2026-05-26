import type { GameState } from '@/types';
import { executeAscent, planAscent } from '@/engine/ascent';
import { StatusBar } from './StatusBar';

interface Props {
  state: GameState;
  onStateChange: (s: GameState) => void;
}

export function AscentView({ state, onStateChange }: Props) {
  if (!state.run) return null;
  const plan = planAscent(state.run);
  const oxygenLeft = state.run.stats.oxygen;
  const normalSafe = oxygenLeft >= plan.normalTurns;
  const rushedSafe = oxygenLeft >= plan.rushedTurns;

  function ascend(mode: 'normal' | 'rushed' | 'emergency') {
    const result = executeAscent(state, mode);
    onStateChange(result.state);
  }

  return (
    <div className="dive ascent-screen">
      <StatusBar run={state.run} />
      <article className="event tone-realistic">
        <h2 className="event-title">上浮选择</h2>
        <div className="event-body">
          <p>
            当前深度 {state.run.currentDepth}m，氮气浓度{' '}
            {Math.round(state.run.stats.nitrogen)} / 100。
          </p>
          <p className="dim">
            需要 {plan.stops} 次减压停留 ・ 正常上浮共耗{' '}
            <strong>{plan.normalTurns}</strong> 回合 ・ 强行上浮{' '}
            <strong>{plan.rushedTurns}</strong> 回合（无减压）
          </p>
        </div>

        <ul className="event-options">
          <li>
            <button
              className="btn event-option ascend"
              onClick={() => ascend('normal')}
              disabled={!normalSafe}
            >
              ↑ 正常上浮（{plan.normalTurns} 回合 氧气）
              {!normalSafe && <span className="warn"> ⚠ 氧气不够</span>}
            </button>
          </li>
          <li>
            <button
              className="btn event-option"
              onClick={() => ascend('rushed')}
              disabled={!rushedSafe}
            >
              强行上浮（{plan.rushedTurns} 回合 氧气，必得减压病）
              {!rushedSafe && <span className="warn"> ⚠ 氧气不够</span>}
            </button>
          </li>
          <li>
            <button
              className="btn event-option danger"
              onClick={() => ascend('emergency')}
            >
              应急上浮（1 回合，深处必死）
            </button>
          </li>
        </ul>
      </article>
    </div>
  );
}
