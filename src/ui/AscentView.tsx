import type { GameState } from '@/types';
import { executeAscent, planAscent, isAscentBlocked } from '@/engine/ascent';
import { cancelAscent } from '@/engine/transitions';
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
  const blocked = isAscentBlocked(state.run);
  // 主动上浮才带 returnTo（NodeSelect / Rest 的来处）；带了就给「取消」按钮回到原地。
  // 事件强制 / 战斗应急 / 走到死路的自动上浮无 returnTo → 不出取消（不可反悔）。
  const returnTo = state.phase.kind === 'ascent' ? state.phase.returnTo : undefined;

  function ascend(mode: 'normal' | 'rushed' | 'emergency') {
    const result = executeAscent(state, mode);
    onStateChange(result.state);
  }

  return (
    <div className="dive ascent-screen">
      {/* 左栏（桌面双栏）/ 钉顶（手机）：上浮屏状态栏锁定（氧气/氮关键值常显·与战斗同款 .dive-pinned·无抽屉）。 */}
      <div className="dive-pinned">
        <StatusBar run={state.run} />
      </div>
      <article className="event tone-realistic">
        <h2 className="event-title">上浮选择</h2>
        <div className="event-body">
          <p>
            当前深度 {state.run.currentDepth}m，氮气浓度{' '}
            {Math.round(state.run.stats.nitrogen)} / 100。
          </p>
          {blocked ? (
            <p className="warn">
              头上是岩顶。你能感觉到水道在收窄。<br />
              在这里只能凿穿洞顶——别的上浮方式行不通。
            </p>
          ) : (
            <p className="dim">
              需要 {plan.stops} 次减压停留 ・ 正常上浮共耗{' '}
              <strong>{plan.normalTurns}</strong> 回合 ・ 强行上浮{' '}
              <strong>{plan.rushedTurns}</strong> 回合（无减压）
            </p>
          )}
        </div>

        <ul className="event-options">
          <li>
            <button
              className="btn event-option ascend"
              onClick={() => ascend('normal')}
              disabled={!normalSafe || blocked}
            >
              ↑ 正常上浮（{plan.normalTurns} 回合 氧气）
              {blocked && <span className="warn"> ⚠ 洞顶挡着</span>}
              {!blocked && !normalSafe && <span className="warn"> ⚠ 氧气不够</span>}
            </button>
          </li>
          <li>
            <button
              className="btn event-option"
              onClick={() => ascend('rushed')}
              disabled={!rushedSafe || blocked}
            >
              强行上浮（{plan.rushedTurns} 回合 氧气，必得减压病）
              {blocked && <span className="warn"> ⚠ 洞顶挡着</span>}
              {!blocked && !rushedSafe && <span className="warn"> ⚠ 氧气不够</span>}
            </button>
          </li>
          <li>
            <button
              className="btn event-option danger"
              onClick={() => ascend('emergency')}
            >
              {blocked
                ? '凿穿洞顶上浮（1 回合，深处必死）'
                : '应急上浮（1 回合，深处必死）'}
            </button>
          </li>
          {returnTo && (
            <li>
              <button
                className="btn event-option cancel"
                onClick={() => onStateChange(cancelAscent(state))}
              >
                ← 取消，留在原处
              </button>
            </li>
          )}
        </ul>
      </article>
    </div>
  );
}
