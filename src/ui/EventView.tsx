import type { GameState, EventOption } from '@/types';
import { getEvent, isOptionEnabled, isOptionVisible, resolveOption } from '@/engine/events';
import { enterNodeSelection } from '@/engine/dive';
import { startCombat } from '@/engine/combat';
import { toDiveEvent, beginAscent, toGameOver } from '@/engine/transitions';
import { StatusBar } from './StatusBar';

interface Props {
  state: GameState;
  eventId: string;
  onStateChange: (s: GameState) => void;
}

export function EventView({ state, eventId, onStateChange }: Props) {
  const event = getEvent(eventId);
  if (!event || !state.run) {
    return <div>[事件未找到：{eventId}]</div>;
  }

  function handleChoose(opt: EventOption) {
    if (!isOptionEnabled(state, opt)) return;
    const result = resolveOption(state, opt);
    let next = result.state;

    // 处理 next 转移
    switch (result.next.kind) {
      case 'continueEvent':
        next = toDiveEvent(next, result.next.eventId);
        break;
      case 'startCombat':
        next = startCombat(next, result.next.combatId);
        break;
      case 'forceAscend':
        next = beginAscent(next);
        break;
      case 'death':
        next = toGameOver(next, '在深处死去');
        break;
      case 'remainOnEvent':
        // 事件无显式后续：若处于随机图下潜，进入节点选择；否则停留
        if (next.run?.map && next.run.map.zoneId !== 'zone.east_reef') {
          next = enterNodeSelection(next);
        }
        break;
    }

    onStateChange(next);
  }

  return (
    <div className="dive">
      <StatusBar run={state.run} />

      <article className={`event tone-${event.tone}`}>
        <h2 className="event-title">{event.title}</h2>
        <div className="event-body">
          {event.body.split('\n').map((line, i) => (
            <p key={i}>{line}</p>
          ))}
        </div>

        <ul className="event-options">
          {event.options
            .filter((opt) => isOptionVisible(state, opt))
            .map((opt) => {
              const enabled = isOptionEnabled(state, opt);
              return (
                <li key={opt.id}>
                  <button
                    className={`btn event-option ${opt.hallucination ? 'hallucination' : ''} ${!enabled ? 'disabled' : ''}`}
                    onClick={() => handleChoose(opt)}
                    disabled={!enabled}
                  >
                    {opt.label}
                  </button>
                </li>
              );
            })}
        </ul>
      </article>
    </div>
  );
}
