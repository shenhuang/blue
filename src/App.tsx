import { useState, useEffect, lazy, Suspense } from 'react';
import type { GameState } from '@/types';
import { createInitialGameState, loadGame, saveGame, clearSave } from '@/engine/state';
import { handleReturnToPort as handleReturnToPortFn } from '@/engine/port';
import { toPort } from '@/engine/transitions';
import { PortView } from '@/ui/PortView';
import { PortEventView } from '@/ui/PortEventView';
import { SeaChartView } from '@/ui/SeaChartView';
import { MiraShopView } from '@/ui/MiraShopView';
import { EventView } from '@/ui/EventView';
import { NodeSelectView } from '@/ui/NodeSelectView';
import { RestView } from '@/ui/RestView';
import { AscentView } from '@/ui/AscentView';
import { CombatView } from '@/ui/CombatView';
import { CorpseView, FuneralView } from '@/ui/CorpseView';
import { ResolutionView, GameOverView } from '@/ui/ResolutionView';
import { ChangelogModal } from '@/ui/ChangelogModal';

// Dev 工具门控（作者 2026-06-06·见 quirk）：本地 dev server 恒开；**发布版也带 dev**，但默认隐藏——
// 仅当 URL 带 ?dev（如 https://shenhuang.github.io/blue/?dev）才启用，藏在 Shift+D/C/M 快捷键后，普通访客
// 看不到（地图调试器会揭示整张图，破坏迷雾/声呐设计，故必须门控）。每个发布版都带此能力（作者要求）。
// DEV_TOOLS 是**运行时**值（prod 里不是编译期 false）→ Rollup 不再 dead-code 消除三元，dev 面板进 bundle 作
// lazy chunk，但仅在 ?dev 打开某面板时才下载（普通访客零额外负载·初始 bundle 不含面板代码）。
const DEV_TOOLS =
  import.meta.env.DEV ||
  (typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('dev'));

const EventDevPanel = DEV_TOOLS
  ? lazy(() =>
      import('@/ui/dev/EventDevPanel').then((m) => ({ default: m.EventDevPanel })),
    )
  : null;
const CombatDevPanel = DEV_TOOLS
  ? lazy(() =>
      import('@/ui/dev/CombatDevPanel').then((m) => ({ default: m.CombatDevPanel })),
    )
  : null;
const MapDevPanel = DEV_TOOLS
  ? lazy(() =>
      import('@/ui/dev/MapDevPanel').then((m) => ({ default: m.MapDevPanel })),
    )
  : null;

/** 当前打开的 dev 面板（事件 / 战斗 / 地图 / 无）。各面板互斥，一次只显示一个。 */
type DevPanelKind = 'event' | 'combat' | 'map' | null;

export default function App() {
  // 启动时尝试读存档；无 / 损坏 / 版本不兼容则开新档
  const [state, setState] = useState<GameState>(() => loadGame() ?? createInitialGameState());

  // Dev 面板开关：本地 state，不进 GameState（避免污染存档版本号；quirk #23）
  const [devPanel, setDevPanel] = useState<DevPanelKind>(null);

  // 更新日志弹窗开关：同样是本地 UI state，不进 GameState（quirk #23）
  const [changelogOpen, setChangelogOpen] = useState(false);

  // Shift+D（事件）/ Shift+C（战斗）/ Shift+M（地图）切换 dev 面板；只在 dev 工具启用时（dev server 或 ?dev）注册监听
  // 互斥规则：当前打开任一面板时，按任一快捷键 = 关闭；关闭时按 D/C/M = 打开对应面板。
  useEffect(() => {
    if (!DEV_TOOLS) return;
    function onKey(e: KeyboardEvent) {
      // 在 input/textarea/select 中输入字母时不切换
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) {
        return;
      }
      if (!e.shiftKey) return;
      if (e.key === 'D' || e.key === 'd') {
        e.preventDefault();
        setDevPanel((cur) => (cur === null ? 'event' : null));
      } else if (e.key === 'C' || e.key === 'c') {
        e.preventDefault();
        setDevPanel((cur) => (cur === null ? 'combat' : null));
      } else if (e.key === 'M' || e.key === 'm') {
        e.preventDefault();
        setDevPanel((cur) => (cur === null ? 'map' : null));
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // 自动存档：state 变化即写 localStorage（回合制、频率低，无需防抖；非浏览器环境 saveGame 自动跳过）
  useEffect(() => {
    saveGame(state);
  }, [state]);

  function handleReturnToPort() {
    setState((s) => handleReturnToPortFn(s).state);
  }

  function handleRestart() {
    // 真正的清存档（gameOver 路径才走这里；funeral 自己回港不清档）
    clearSave();
    setState(createInitialGameState());
  }

  return (
    <div className="app">
      {state.phase.kind === 'port' && (
        <PortView state={state} onStateChange={setState} />
      )}

      {state.phase.kind === 'portEvent' && (
        <PortEventView
          state={state}
          eventId={state.phase.eventId}
          onStateChange={setState}
        />
      )}

      {state.phase.kind === 'chart' && (
        <SeaChartView state={state} onStateChange={setState} />
      )}

      {state.phase.kind === 'shop' && (
        <MiraShopView state={state} onStateChange={setState} />
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
          features={state.phase.subPhase.features}
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
          onReturn={() => setState((s) => toPort(s))}
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

      <footer className="app-footer">
        深海回响 ·{' '}
        <button
          type="button"
          className="changelog-trigger"
          onClick={() => setChangelogOpen(true)}
          title="查看更新日志"
        >
          v0.0.1 · 更新日志
        </button>{' '}
        · 垂直切片 · build {__BUILD_TIME__} ({__BUILD_COMMIT__})
      </footer>

      {changelogOpen && <ChangelogModal onClose={() => setChangelogOpen(false)} />}

      {/* Dev 面板覆盖层 —— 仅 dev 工具启用（dev server 或 ?dev）且面板打开时挂载；事件 / 战斗 / 地图 互斥 */}
      {DEV_TOOLS && devPanel === 'event' && EventDevPanel && (
        <Suspense fallback={null}>
          <EventDevPanel onClose={() => setDevPanel(null)} />
        </Suspense>
      )}
      {DEV_TOOLS && devPanel === 'combat' && CombatDevPanel && (
        <Suspense fallback={null}>
          <CombatDevPanel onClose={() => setDevPanel(null)} />
        </Suspense>
      )}
      {DEV_TOOLS && devPanel === 'map' && MapDevPanel && (
        <Suspense fallback={null}>
          <MapDevPanel onClose={() => setDevPanel(null)} />
        </Suspense>
      )}
    </div>
  );
}
