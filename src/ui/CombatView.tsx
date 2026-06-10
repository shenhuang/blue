import { useState } from 'react';
import type { GameState, EnemyInstance, CombatAction } from '@/types';
import {
  applyPlayerAction,
  listAvailableActions,
  getEnemyDef,
  triggerEmergencyAscent,
} from '@/engine/combat';
import { beginAscent } from '@/engine/transitions';
import { StatusBar } from './StatusBar';

interface Props {
  state: GameState;
  onStateChange: (s: GameState) => void;
}

export function CombatView({ state, onStateChange }: Props) {
  const [selectedTarget, setSelectedTarget] = useState<string | null>(null);

  if (state.phase.kind !== 'combat' || !state.run) return null;
  const combat = state.phase.combat;
  const aliveEnemies = combat.enemies.filter((e) => e.hp > 0);
  const actions = listAvailableActions(state);

  // 自动锁定第一个活敌人，若 selectedTarget 已死则换
  const currentTarget =
    aliveEnemies.find((e) => e.instanceId === selectedTarget) ?? aliveEnemies[0];

  function handleAction(action: CombatAction) {
    const target = action.targeting === 'single' ? currentTarget?.instanceId : undefined;
    const result = applyPlayerAction(state, action.id, target);
    onStateChange(result.state);
  }

  function handleEmergencyAscent() {
    if (!confirm('应急上浮会跳过减压，深处几乎必死。确定？')) return;
    let s = triggerEmergencyAscent(state);
    s = beginAscent(s);
    onStateChange(s);
  }

  return (
    <div className="dive combat">
      <StatusBar run={state.run} />

      <div className="combat-enemies">
        <h3>敌人</h3>
        {combat.enemies.length === 0 && <div className="dim">（空）</div>}
        <ul className="enemy-list">
          {combat.enemies.map((e) => (
            <EnemyRow
              key={e.instanceId}
              enemy={e}
              selected={currentTarget?.instanceId === e.instanceId}
              onSelect={() => setSelectedTarget(e.instanceId)}
            />
          ))}
        </ul>
      </div>

      <div className="combat-log">
        {combat.log.slice(-5).map((l, i) => (
          <div key={i} className={`log-line log-${l.actor}`}>
            {l.text}
          </div>
        ))}
      </div>

      <div className="combat-actions">
        <h3>你的行动</h3>
        <ul className="event-options">
          {actions.map(({ action, availability }) => (
            <li key={action.id}>
              <button
                className={`btn event-option ${!availability.available ? 'disabled' : ''}`}
                onClick={() => availability.available && handleAction(action)}
                disabled={!availability.available}
                title={action.description}
              >
                <div className="action-row">
                  <span className="action-name">{action.name}</span>
                  <span className="action-cost">
                    {action.costStamina > 0 && `体 -${action.costStamina} `}
                    {action.costOxygenTurns > 0 && `氧 -${action.costOxygenTurns}`}
                  </span>
                </div>
                <div className="action-desc dim">
                  {action.description}
                  {!availability.available && availability.reason && (
                    <span className="warn"> · {availability.reason}</span>
                  )}
                </div>
              </button>
            </li>
          ))}
          <li>
            <button className="btn event-option danger" onClick={handleEmergencyAscent}>
              ↑ 应急上浮（深处必死）
            </button>
          </li>
        </ul>
      </div>
    </div>
  );
}

function EnemyRow({
  enemy,
  selected,
  onSelect,
}: {
  enemy: EnemyInstance;
  selected: boolean;
  onSelect: () => void;
}) {
  const def = getEnemyDef(enemy.defId);
  if (!def) return null;
  const hpPct = Math.max(0, (enemy.hp / def.hp) * 100);
  const dead = enemy.hp <= 0;
  return (
    <li>
      <button
        className={`enemy-row ${selected ? 'selected' : ''} ${dead ? 'dead' : ''}`}
        onClick={onSelect}
        disabled={dead}
      >
        <div className="enemy-name">
          {def.name}
          <span className={`stance stance-${enemy.stance}`}>
            {stanceLabel(enemy.stance)}
          </span>
        </div>
        <div className="enemy-hp">
          <div className="hp-bar">
            <div className="hp-fill" style={{ width: `${hpPct}%` }} />
          </div>
          <span className="hp-text">
            {enemy.hp} / {def.hp}
          </span>
        </div>
      </button>
    </li>
  );
}

function stanceLabel(stance: string): string {
  switch (stance) {
    case 'unaware': return '未察觉';
    case 'alerted': return '警戒';
    case 'attacking': return '攻击中';
    case 'enraged': return '狂暴';
    case 'fleeing': return '逃跑';
    default: return stance;
  }
}
