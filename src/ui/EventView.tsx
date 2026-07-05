import { useEffect } from 'react';
import type { GameState, EventOption } from '@/types';
import { getEvent, isOptionEnabled, isOptionVisible, resolveOption, revealAttribution } from '@/engine/events';
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
    const result = resolveOption(state, opt, event);
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
        // 事件无显式后续 → 交给引擎转移：有图进节点选择；无图（剧情编辑器合成态）退化到 rest ＝离开事件流，
        // 别停在同一事件被 oxygenTurnCost 反复空耗氧。（linearScripted 教学链从不返回 remainOnEvent；
        // layered 图包括东礁二次下潜都走 enterNodeSelection 的正常分支。）
        next = enterNodeSelection(next);
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
              // 揭示归因（感知重做 SPEC §2.1·车道 5-2）：本选项若是「带了某道具才显示」的——
              // 旁标一枚「（持有 <显示名>）」，告诉玩家是哪件解锁了它。显示名从满足的持有条件派生
              // （引擎 revealAttribution·能力→实际持有件真名·数据驱动·未来道具零改动）。非持有门 → null → 不标。
              const revealBy = revealAttribution(state, opt);
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
                    {revealBy && <span className="reveal-tag">持有 {revealBy}</span>}
                  </button>
                </li>
              );
            })}
        </ul>
      </article>
    </div>
  );
}
