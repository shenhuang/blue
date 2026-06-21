import type { GameState } from '@/types';
import { confirmEncounter } from '@/engine/combat';
import { DiveHeader } from './DiveHeader';

interface Props {
  state: GameState;
  onStateChange: (s: GameState) => void;
}

/**
 * 高等级遭遇前序叙事屏（boss 设计蓝图 2026-06-21）。
 * 当 CombatEncounterDef.showIntro:true 且 introText 有值时，enterCombat 先落这里；
 * 玩家读完文案点「迎战」→ confirmEncounter → startCombat。
 */
export function PreCombatView({ state, onStateChange }: Props) {
  if (state.phase.kind !== 'dive' || state.phase.subPhase.kind !== 'pre_combat') return null;
  const { introText } = state.phase.subPhase;

  function handleConfirm() {
    onStateChange(confirmEncounter(state));
  }

  return (
    <div className="dive">
      <DiveHeader state={state} onStateChange={onStateChange} />

      <article className="event tone-uncanny pre-combat-intro">
        <div className="event-body">
          {introText.split('\n').map((line, i) => (
            <p key={i}>{line}</p>
          ))}
        </div>

        <ul className="event-options">
          <li>
            <button className="btn event-option" onClick={handleConfirm}>
              迎战
            </button>
          </li>
        </ul>
      </article>
    </div>
  );
}
