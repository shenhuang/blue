import { useState } from 'react';
import type { GameState, NodeChoice } from '@/types';
import { setLight, pingSonar, setSonarNext } from '@/engine/dive';
import { sonarPingCost, sonarStandingOn, sonarStandingNext } from '@/engine/clarity';
import { StatusBar } from './StatusBar';
import { SonarScanPanel } from './SonarScanPanel';

// 声呐图「收起」选择跨子阶段持久（作者拍板：头部像状态栏一样不随子阶段消失·见下注）：每个 dive 子阶段
// （event/nodeSelect/rest/corpse）各自挂一个 DiveHeader，换阶段会重挂载——用模块级变量记住收起选择，
// 重挂载时沿用，免得一进事件声呐图就自动弹回展开。纯 UI 偏好·不入存档·SSR 默认展开。
let sonarMapCollapsed = false;

// 手机抽屉开合（作者 06-13）：下潜时「状态 / 声呐」栏默认收起·左上角按钮开合（作者拍板：默认收起·点开）。
// 模块级＝跨子阶段重挂载沿用，免得每进一个画面又弹回默认。桌面（≥1200）无视此态——CSS 强制左栏常显、
// 隐藏按钮（见 styles.css 的 .dive-header-body / .dive-header-toggle）。战斗/上浮不走 DiveHeader，
// 其 .dive-pinned 不带 .dive-header＝不进抽屉、状态栏照常 sticky 钉顶（作者：战斗状态锁顶、只滑事件）。
let diveHeaderMobileOpen = false;

interface Props {
  state: GameState;
  onStateChange: (s: GameState) => void;
  /** 移动 choices（仅 nodeSelect 传 → 声呐图画可点前往标记）；其它子阶段不传 → 只显雾、不画可点标记（你不在选点）。 */
  choices?: NodeChoice[];
  pendingNodeId?: string | null;
  onPendingChange?: (id: string | null) => void;
}

/**
 * 下潜内常驻头部（作者拍板：像状态栏一样**不随子阶段消失**）：属性栏 + 灯/声呐开关 + 可收起的声呐图。
 * 在 NodeSelect / Event / Rest / Corpse 各子阶段共用（替代各视图原来的裸 <StatusBar>），所以进事件/扎营/
 * 翻尸体时灯/声呐开关和声呐图都还在。声呐控制只一个开/关切换（关着点开＝本回合立即扫一次·#5）。
 */
export function DiveHeader({ state, onStateChange, choices = [], pendingNodeId = null, onPendingChange }: Props) {
  const [sonarOpen, setSonarOpen] = useState(!sonarMapCollapsed);
  const [mobileOpen, setMobileOpen] = useState(diveHeaderMobileOpen);
  const run = state.run;
  if (!run) return null;
  const lightOn = run.sensors.light;
  const sonarUnlocked = run.sensors.sonarUnlocked;
  const pingCost = sonarPingCost(run);
  const canPing = sonarUnlocked && run.power >= pingCost;
  const alreadyPinged = run.sensors.sonar === 'ping';
  const standingOn = sonarStandingOn(run);
  const standingNext = sonarStandingNext(run);

  return (
    <div className={`dive-pinned dive-header${mobileOpen ? ' mobile-open' : ''}`}>
      {/* 手机抽屉开关（桌面 CSS 隐藏·左栏常显）：默认收起·点开看状态/声呐（作者 06-13）。 */}
      <button
        type="button"
        className="btn small dive-header-toggle"
        onClick={() => {
          const next = !mobileOpen;
          diveHeaderMobileOpen = next; // 记住开合（跨子阶段重挂载沿用）
          setMobileOpen(next);
        }}
        aria-expanded={mobileOpen}
      >
        {mobileOpen ? '状态 / 声呐 ▾（收起）' : '状态 / 声呐 ▸（展开）'}
      </button>
      <div className="dive-header-body">
        <StatusBar run={run} />
      {/* 传感器开关：紧贴属性栏下方——灯 + 声呐开/关（声呐只此一个控制·关着点开＝本回合立即扫一次·#5）。 */}
      <div className="dive-sensor-bar">
        <div className="sensor-controls" data-divebar="1">
          <button
            className={`btn sensor-btn ${lightOn ? 'on' : ''}`}
            onClick={() => onStateChange(setLight(state, !lightOn))}
          >
            {lightOn ? '熄灯（隐蔽 / 省电）' : '开灯（看清 / 暴露）'}
          </button>
          {sonarUnlocked && (
            <button
              className={`btn sensor-btn sonar-toggle ${standingOn ? 'on' : ''}`}
              onClick={() => {
                if (standingOn) {
                  onStateChange(setSonarNext(state, false)); // 开→关：下一段路起关掉
                } else {
                  // 关→开：本回合立即开 + 立即扫一记（关态点开就扫·#5）。profile.sonarOn 跨 run 持久。
                  let s: GameState = {
                    ...state,
                    run: { ...run, sensors: { ...run.sensors, sonarOn: true, sonarNext: true } },
                    profile: { ...state.profile, sonarOn: true },
                  };
                  if (canPing && !alreadyPinged) s = pingSonar(s);
                  onStateChange(s);
                }
              }}
              title="声呐开＝每站自动成图、但一直暴露你；关＝隐蔽、只看保留的旧图。关着时点开＝本回合立即开并扫一记。"
            >
              {standingOn ? '声呐：开' : '声呐：关'}
              {standingNext !== standingOn ? (standingNext ? ' → 下回合开' : ' → 下回合关') : ''}
              {!standingOn && !canPing ? '（电量不足）' : ''}
            </button>
          )}
        </div>
      </div>
      {/* 声呐图（pinned·可收起·跨子阶段不消失）：紧跟开关下方、和属性栏一起钉住不滚动；收起时只剩一行标题条。 */}
      {sonarUnlocked && (
        <div className="sonar-collapse">
          <button
            className="btn small sonar-collapse-toggle"
            onClick={() => {
              const next = !sonarOpen;
              sonarMapCollapsed = !next; // 记住收起选择（跨子阶段重挂载沿用）
              setSonarOpen(next);
            }}
            aria-expanded={sonarOpen}
          >
            {sonarOpen ? '声呐图 ▾（收起）' : '声呐图 ▸（展开）'}
          </button>
          {sonarOpen && (
            <SonarScanPanel
              state={state}
              choices={choices}
              onStateChange={onStateChange}
              pendingNodeId={pendingNodeId}
              onPendingChange={onPendingChange}
            />
          )}
        </div>
      )}
      </div>
    </div>
  );
}
