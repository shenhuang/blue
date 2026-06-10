// 港口侧 cutscene 渲染。
// 复用 events.json 里的 DiveEvent schema，但不依赖 state.run；
// 玩家选完某项后，自动写入 flag.event_done.<id> 并切回 port。

import type { EventOption, GameState } from '@/types';
import { getEvent, isOptionEnabled, isOptionVisible, resolveOption } from '@/engine/events';
import { eventDoneFlag } from '@/engine/portEvents';
import { toPort } from '@/engine/transitions';

interface Props {
  state: GameState;
  eventId: string;
  onStateChange: (s: GameState) => void;
}

export function PortEventView({ state, eventId, onStateChange }: Props) {
  const event = getEvent(eventId);
  if (!event) return <div className="port">[事件未找到：{eventId}]</div>;

  function finalize(s: GameState) {
    // 写入"已播"标记，并清掉 run（如果还在），转回港口
    const flags = new Set(s.profile.flags);
    flags.add(eventDoneFlag(eventId));
    return toPort({
      ...s,
      profile: { ...s.profile, flags },
      run: null,
    });
  }

  function handleChoose(opt: EventOption) {
    if (!isOptionEnabled(state, opt)) return;
    const result = resolveOption(state, opt);
    // portEvent 阶段所有 next.kind 都按 "回到港口" 处理（cutscene 一锤子买卖）
    onStateChange(finalize(result.state));
  }

  return (
    <div className="dive">
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
                    className={`btn event-option ${opt.hallucination ? 'hallucination' : ''}`}
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
