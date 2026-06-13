import { useState, useEffect, lazy, Suspense } from 'react';
import type { GameState } from '@/types';
import { createInitialGameState, loadGame, saveGame, clearSave } from '@/engine/state';
import { handleReturnToPort as handleReturnToPortFn } from '@/engine/port';
import { toPort } from '@/engine/transitions';
import { TUTORIAL_COMPLETE_FLAG } from '@/engine/story';
import { PortLayout } from '@/ui/PortLayout';
import { EventView } from '@/ui/EventView';
import { NodeSelectView } from '@/ui/NodeSelectView';
import { RestView } from '@/ui/RestView';
import { AscentView } from '@/ui/AscentView';
import { CombatView } from '@/ui/CombatView';
import { CorpseView, FuneralView } from '@/ui/CorpseView';
import { ResolutionView, GameOverView } from '@/ui/ResolutionView';
import { ChangelogModal } from '@/ui/ChangelogModal';

// Dev 工具门控（作者 2026-06-06·quirk #97）：定义迁至 ui/devMode.ts（#109·Mira 测试货架也要读）——
// 语义零变化：?dev 运行时门 + lazy chunk；地图调试器会揭示整张图（破坏迷雾/声呐设计）故必须门控。
import { DEV_TOOLS } from '@/ui/devMode';

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

/**
 * URL 直开 dev 面板：`?dev&panel=map|event|combat`（#107 续·作者手机验收用）。
 * 手机没有 Shift 键、Shift+D/C/M 够不着面板——URL 参数是触屏唯一入口；仍在 ?dev 门后
 * （DEV_TOOLS false 时恒 null·普通访客零变化）。桌面快捷键照常可再切换/关闭；
 * 手机上关面板＝去掉 panel 参数刷新。
 */
function initialDevPanel(): DevPanelKind {
  if (!DEV_TOOLS || typeof window === 'undefined') return null;
  const p = new URLSearchParams(window.location.search).get('panel');
  return p === 'map' || p === 'event' || p === 'combat' ? p : null;
}

export default function App() {
  // 启动时尝试读存档；无 / 损坏 / 版本不兼容则开新档。
  // dev（?dev / dev server）：进 dev 即视作已过教学——海图等教学门一律放行，方便测试（作者 2026-06-13）。
  // 普通访客 DEV_TOOLS=false 时零变化。会随自动存档落盘＝dev 档开过即标记教学完成（重开新档可清）。
  const [state, setState] = useState<GameState>(() => {
    const s = loadGame() ?? createInitialGameState();
    if (DEV_TOOLS && !s.profile.flags.has(TUTORIAL_COMPLETE_FLAG)) {
      return {
        ...s,
        profile: { ...s.profile, flags: new Set([...s.profile.flags, TUTORIAL_COMPLETE_FLAG]) },
      };
    }
    return s;
  });

  // Dev 面板开关：本地 state，不进 GameState（避免污染存档版本号；quirk #23）；?dev&panel=… 可 URL 直开（见上）
  const [devPanel, setDevPanel] = useState<DevPanelKind>(initialDevPanel);

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

  // 容器布局分阶段（作者 06-13）：港口族（port/portEvent/chart/shop）走主从布局（PortLayout·左主界面/对话·
  // 右服务面板 海图/装备/商店/行会）；下潜族（dive/combat/ascent）走左右双栏（左状态/声呐·右内容）。
  // 其余（结算/葬礼/gameOver）保持 720 居中。读 phase.kind 分流是允许的（check-boundaries 规则二只禁构造 phase 字面量）。
  const phaseKind = state.phase.kind;
  const isPort =
    phaseKind === 'port' ||
    phaseKind === 'portEvent' ||
    phaseKind === 'chart' ||
    phaseKind === 'shop';
  const isDive = phaseKind === 'dive' || phaseKind === 'combat' || phaseKind === 'ascent';
  const appClass = isPort ? 'app app-port' : isDive ? 'app app-dive' : 'app';

  return (
    <div className={appClass}>
      {/* 港口族：主从布局——主界面/对话常驻左栏，海图/装备/商店/行会作为右栏服务面板（窄屏覆盖）。 */}
      {isPort && <PortLayout state={state} onStateChange={setState} />}

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
        {/* 重开新档（#118·作者拍「不该是 dev 功能」）：玩家可见——roguelike 重开是正当需求。
            复用 gameOver 的 handleRestart（clearSave+新档）；window.confirm 防误触（唯一动真存档的按钮）。 */}
        {' '}
        ·{' '}
        <button
          type="button"
          className="changelog-trigger wipe-save"
          onClick={() => {
            if (window.confirm('删除当前存档、从头开始？（不可恢复）')) handleRestart();
          }}
          title="清空存档并立即开新档"
        >
          重开新档
        </button>
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
