import { useState, useEffect } from 'react';
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

// DEV_TOOLS（?dev 运行时门·单一来源 ui/devMode.ts·#109）：这里仅 withDevTutorialSkip 用。
// dev 面板/编辑器已迁出游戏、收进 ?editor 工作台（EditorApp·见 main.tsx + dev工作台 SPEC）——
// 游戏不再 import 任何 dev 工具（game↛dev 由 check-boundaries 守·SPEC §6），dev 代码不进游戏主包。
import { DEV_TOOLS } from '@/ui/devMode';

// dev 面板路由已移除：dev 工具改由 ?editor 工作台（EditorApp）承载·见 main.tsx + dev工作台 SPEC。

/**
 * dev 跳过教学（**仅 ?dev**·不含 npm-dev：本地 dev server 默认走真玩家流程·作者 2026-06-14 改）：
 * 进 ?dev 即视作已过教学——海图等教学门放行，方便测试。**load 与「重开新档」两条路径都过它**
 * （否则 handleRestart 不补标记 → 重开后丢 tutorial_complete → 看不到海图、须硬刷新才好·本次修复）。
 */
function withDevTutorialSkip(s: GameState): GameState {
  if (DEV_TOOLS && !s.profile.flags.has(TUTORIAL_COMPLETE_FLAG)) {
    return {
      ...s,
      profile: { ...s.profile, flags: new Set([...s.profile.flags, TUTORIAL_COMPLETE_FLAG]) },
    };
  }
  return s;
}

export default function App() {
  // 启动时尝试读存档；无 / 损坏 / 版本不兼容则开新档。
  // dev 跳过教学（仅 ?dev·见 withDevTutorialSkip）：load 与「重开新档」同一条路径补 tutorial_complete。
  const [state, setState] = useState<GameState>(() =>
    withDevTutorialSkip(loadGame() ?? createInitialGameState()),
  );

  // 更新日志弹窗开关：同样是本地 UI state，不进 GameState（quirk #23）
  const [changelogOpen, setChangelogOpen] = useState(false);

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
    // 与 useState 初始化同一条路径：?dev 下重开也补 tutorial_complete，否则重开新档丢标记 →
    // 看不到海图、须硬刷新才好（本次修复·作者 2026-06-14）。
    setState(withDevTutorialSkip(createInitialGameState()));
  }

  // 容器布局分阶段（作者 06-13）：港口族（port/portEvent/chart/shop）走主从布局（PortLayout·左主界面/对话·
  // 右服务面板 海图/装备/商店/行会）；下潜族（dive/combat/ascent）走左右双栏（左状态/声呐·右内容）。
  // 其余（结算/葬礼/gameOver）保持 720 居中。读 phase.kind 分流是允许的（check-boundaries 规则二只禁构造 phase 字面量）。
  //
  // portEvent（港口过场 cutscene·作者 06-14）是港口族里的特例：它本就没有右服务面板（PortLayout 的 right
  // 在该阶段恒 null·见其文件头），故宽屏不需要为面板留右侧空当——加 .app-port-cutscene 让容器回 720 居中，
  // 与紧邻它前面的结算屏（.app·720 居中）同一水平位置，消除「结算居中→过场跳到左缘」的视觉错位（仅 ≥1200px 可见）。
  const phaseKind = state.phase.kind;
  const isPortEvent = phaseKind === 'portEvent';
  const isPort =
    phaseKind === 'port' ||
    phaseKind === 'portEvent' ||
    phaseKind === 'chart' ||
    phaseKind === 'shop';
  const isDive = phaseKind === 'dive' || phaseKind === 'combat' || phaseKind === 'ascent';
  const appClass = isPort
    ? isPortEvent
      ? 'app app-port app-port-cutscene'
      : 'app app-port'
    : isDive
      ? 'app app-dive'
      : 'app';

  return (
    <div className={appClass}>
      {/* 强制竖屏（SPEC §6.4）：浏览器真锁不可靠 → 仅手机横屏时由 CSS .orientation-gate 显形盖屏提示。 */}
      <div className="orientation-gate">请将设备竖屏游玩</div>
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
    </div>
  );
}
