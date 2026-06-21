import { useEffect } from 'react';
import type { GameState, EventOption } from '@/types';
import { getEvent, isOptionEnabled, isOptionVisible, resolveOption } from '@/engine/events';
import { enterNodeSelection } from '@/engine/dive';
import { enterCombat } from '@/engine/combat';
import { toDiveEvent, beginAscent, toGameOver } from '@/engine/transitions';
import { DiveHeader } from './DiveHeader';

interface Props {
  state: GameState;
  eventId: string;
  onStateChange: (s: GameState) => void;
}

/** check.stat → 徽章用词（①根治版·#109：徽章从数据渲染·label 纯 fiction·词表与旧 lint 一致 + 氮预留）。 */
const STAT_LABEL: Record<string, string> = { sanity: '理智', stamina: '体力', oxygen: '氧气', nitrogen: '氮' };

export function EventView({ state, eventId, onStateChange }: Props) {
  // 新事件 → 滚回顶部（作者 06-13）：事件链（continueEvent）换 eventId 但 EventView 不卸载，
  // 之前读长事件滚下去的位置会残留；下潜界面随窗口滚动（非内部滚动容器），故统一把窗口滚回顶，
  // 让每条新事件都从标题读起。eventId 不变（仅选项重渲染）时不触发。hooks 必须在早退之前（规则）。
  useEffect(() => {
    if (typeof window !== 'undefined') window.scrollTo(0, 0);
  }, [eventId]);

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
        next = enterCombat(next, result.next.combatId);
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
      <DiveHeader state={state} onStateChange={onStateChange} />

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
                    {/* check 徽章（①根治版·#109）：从 check.{stat,dc} 渲染＝永不与数据失真（label 不再双写）；
                        hideCheck＝隐藏判定的设计权（惊吓/直觉类不剧透）。 */}
                    {opt.check && !opt.hideCheck && (
                      <span className="check-badge">
                        {STAT_LABEL[opt.check.stat] ?? opt.check.stat} {opt.check.dc}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
        </ul>
      </article>
    </div>
  );
}
