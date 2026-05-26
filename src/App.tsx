import { useState } from 'react';
import type { GameState } from '@/types';
import { createInitialGameState } from '@/engine/state';
import { PortView } from '@/ui/PortView';
import { EventView } from '@/ui/EventView';
import { NodeSelectView } from '@/ui/NodeSelectView';
import { RestView } from '@/ui/RestView';
import { AscentView } from '@/ui/AscentView';
import { CombatView } from '@/ui/CombatView';
import { CorpseView, FuneralView } from '@/ui/CorpseView';
import { ResolutionView, GameOverView } from '@/ui/ResolutionView';

export default function App() {
  const [state, setState] = useState<GameState>(() => createInitialGameState());

  function handleReturnToPort() {
    setState((s) => ({
      ...s,
      run: null,
      phase: { kind: 'port' },
    }));
  }

  function handleRestart() {
    // 真正的清存档（gameOver 路径才走这里；funeral 自己回港不清档）
    setState(createInitialGameState());
  }

  return (
    <div className="app">
      {state.phase.kind === 'port' && (
        <PortView state={state} onStateChange={setState} />
      )}

      {state.phase.kind === 'dive' && state.phase.subPhase.kind === 'event' && (
        <EventView
          state={state}
          eventId={state.phase.subPhase.eventId}
          onStateChange={setState}
        />
      )}

      {state.phase.kind === 'dive' && state.phase.subPhase.kind === 'nodeSelect' && (
        <NodeSelectView
          state={state}
          choices={state.phase.subPhase.choices}
          onStateChange={setState}
        />
      )}

      {state.phase.kind === 'dive' && state.phase.subPhase.kind === 'rest' && (
        <RestView state={state} onStateChange={setState} />
      )}

      {state.phase.kind === 'dive' && state.phase.subPhase.kind === 'corpse' && (
        <CorpseView
          state={state}
          deathRecordId={state.phase.subPhase.deathRecordId}
          onStateChange={setState}
        />
      )}

      {state.phase.kind === 'funeral' && (
        <FuneralView
          state={state}
          record={state.phase.record}
          onReturn={() => setState((s) => ({ ...s, phase: { kind: 'port' } }))}
        />
      )}

      {state.phase.kind === 'combat' && (
        <CombatView state={state} onStateChange={setState} />
      )}

      {state.phase.kind === 'ascent' && (
        <AscentView state={state} onStateChange={setState} />
      )}

      {state.phase.kind === 'resolution' && (
        <ResolutionView
          state={state}
          outcome={state.phase.outcome}
          onReturn={handleReturnToPort}
        />
      )}

      {state.phase.kind === 'gameOver' && (
        <GameOverView state={state} onRestart={handleRestart} />
      )}

      <footer className="app-footer">深海回响 · v0.0.1 · 垂直切片</footer>
    </div>
  );
}
