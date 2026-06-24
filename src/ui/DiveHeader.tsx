import { useState } from 'react';
import type { GameState, NodeChoice } from '@/types';
import { setLight, pingSonar, setSonarNext } from '@/engine/dive';
import { sonarPingCost, sonarStandingOn, sonarStandingNext } from '@/engine/clarity';
import { StatusBar } from './StatusBar';
import { SonarScanPanel } from './SonarScanPanel';
import { LootPanel } from './LootPanel';
import { EquipmentDoll } from './EquipmentDoll';

// 图标栏 SVG 图标（inline·无依赖·currentColor 随主题·17×17 视口·aria-hidden）。
// 加图标：在此加一个 const，按钮里引用，禁止散在 JSX 里写 SVG。
// 手电筒开：筒身 + 灯头（梯形展宽）+ 三道光束。
const ICON_LIGHT = (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="2" y="9.5" width="10" height="5" rx="1.5"/>
    <path d="M12 8.5 L18 7 L18 17 L12 15.5z"/>
    <line x1="19" y1="12" x2="22" y2="12"/>
    <line x1="18.5" y1="9.5" x2="21.5" y2="7.5"/>
    <line x1="18.5" y1="14.5" x2="21.5" y2="16.5"/>
  </svg>
);
// 手电筒关：同一筒身 + 灯头，无光束。
const ICON_LIGHT_OFF = (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="2" y="9.5" width="10" height="5" rx="1.5"/>
    <path d="M12 8.5 L18 7 L18 17 L12 15.5z"/>
  </svg>
);
const ICON_SONAR = (
  <svg viewBox="0 0 20 20" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
    {/* 声源点 */}
    <circle cx="10" cy="16" r="1.5" fill="currentColor" stroke="none"/>
    {/* 向上辐射的声波弧 */}
    <path d="M6.5 12.5a5 5 0 0 1 7 0"/>
    <path d="M3.5 9a9 9 0 0 1 13 0"/>
  </svg>
);
const ICON_LOOT = (
  <svg viewBox="0 0 20 20" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {/* 袋身 */}
    <path d="M5.5 9C4.5 9.8 4 11 4 12.5v1.5A4.5 4.5 0 0 0 8.5 18.5h3A4.5 4.5 0 0 0 16 14v-1.5c0-1.5-.5-2.7-1.5-3.5"/>
    {/* 袋口 */}
    <path d="M8 9V7a2 2 0 0 1 4 0v2"/>
  </svg>
);
const ICON_EQUIP = (
  <svg viewBox="0 0 20 20" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {/* 盾牌轮廓 */}
    <path d="M10 2.5L3.5 5.5v6c0 3.8 2.8 6.8 6.5 7.8 3.7-1 6.5-4 6.5-7.8v-6z"/>
  </svg>
);

// 下潜内常驻头部（作者拍板：像状态栏一样**不随子阶段消失**）：属性栏 + 灯/声呐开关 + 互斥面板（声呐图 / 战利品 / 装备）。
// 在 NodeSelect / Event / Rest / Corpse 各子阶段共用（替代各视图原来的裸 <StatusBar>）。
//
// 移动端 HUD（SPEC §6·作者 2026-06-17）：状态条**常显**（不收进图标）；声呐图 / 战利品 / 装备做成**互斥**面板
//   （openPanel 单态·开一个收起另一个）——移动端点开＝全屏覆盖（CSS .dive-header.has-dive-panel·状态条留顶上），
//   桌面内联（声呐图默认开·保留旧「常驻声呐图」体验·再点收起）。声呐控制仍只一个开/关（关着点开＝本回合立即扫一次·#5）。
//   「装备」＝下潜侧只读看纸娃娃（EquipmentDoll readOnly·改装去港口 Otto·C 段 2026-06-19）。
type PanelKind = 'none' | 'sonar' | 'loot' | 'equipment';

// 展开面板的标题（互斥面板共用一个头部·按当前面板取名）。加面板＝在此补一条，别散在三目里。
const PANEL_LABEL: Record<Exclude<PanelKind, 'none'>, string> = {
  sonar: '声呐图',
  loot: '战利品',
  equipment: '装备',
};

// 用户显式选择（跨子阶段沿用·每个 dive 子阶段各自挂一个 DiveHeader、换阶段重挂载）：null = 还没点过 → 用上下文默认。
// 用「上下文默认」而非写死的模块默认＝避免被前一次「无声呐」的下潜把默认锁成 none（也让桌面/SSR 恒显声呐图）。纯 UI·不入存档。
let userPanelChoice: PanelKind | null = null;

interface Props {
  state: GameState;
  onStateChange: (s: GameState) => void;
  /** 移动 choices（仅 nodeSelect 传 → 声呐图画可点前往标记）；其它子阶段不传 → 只显雾、不画可点标记。 */
  choices?: NodeChoice[];
  pendingNodeId?: string | null;
  onPendingChange?: (id: string | null) => void;
}

export function DiveHeader({ state, onStateChange, choices = [], pendingNodeId = null, onPendingChange }: Props) {
  const run = state.run;
  const sonarUnlocked = !!run?.sensors.sonarUnlocked;
  const [choice, setChoice] = useState<PanelKind | null>(userPanelChoice);
  if (!run) return null;

  // 上下文默认：桌面 + 已解锁声呐 → 默认摊开声呐图（保留旧「常驻声呐图」体验）；移动端 / 未解锁 → 默认收起。
  const isMobile = typeof window !== 'undefined' && !!window.matchMedia?.('(max-width: 1199px)').matches;
  const contextDefault: PanelKind = !isMobile && sonarUnlocked ? 'sonar' : 'none';
  let activePanel: PanelKind = choice ?? contextDefault;
  if (activePanel === 'sonar' && !sonarUnlocked) activePanel = 'none'; // 防 choice/默认指向未解锁的声呐

  // 点击面板图标：开着就收起、否则切到它（天然互斥——同一时刻最多一个面板）。点过即记进 userPanelChoice 跨子阶段沿用。
  function showPanel(p: PanelKind) {
    const next = activePanel === p ? 'none' : p;
    userPanelChoice = next;
    setChoice(next);
  }

  const lightOn = run.sensors.light;
  const pingCost = sonarPingCost(run);
  const canPing = sonarUnlocked && run.power >= pingCost;
  const alreadyPinged = run.sensors.sonar === 'ping';
  const standingOn = sonarStandingOn(run);
  const standingNext = sonarStandingNext(run);

  return (
    <div className={`dive-pinned dive-header${activePanel !== 'none' ? ' has-dive-panel' : ''}`}>
      {/* 状态条常显（作者拍板：氧/体/理智一直可见·不收进图标）。 */}
      <StatusBar run={run} />
      <div className="dive-sensor-bar">
        {/* 图标栏（互斥面板·SPEC §6）：灯开关 + 声呐图（已解锁时）+ 战利品 + 装备。
            声呐开/关移至声呐面板内部。移动端点开面板＝全屏覆盖；桌面内联展开、右上 ✕ 关闭（复用 icon-close）。 */}
        <div className="dive-icon-bar">
          <button
            type="button"
            className={`dive-icon-btn dive-icon-btn--light ${lightOn ? 'on' : ''}`}
            onClick={() => onStateChange(setLight(state, !lightOn))}
            title={lightOn ? '熄灯（隐蔽 / 省电）' : '开灯（看清 / 暴露）'}
            aria-label={lightOn ? '熄灯' : '开灯'}
          >
            {lightOn ? ICON_LIGHT : ICON_LIGHT_OFF}
          </button>
          {sonarUnlocked && (
            <button
              type="button"
              className={`dive-icon-btn ${activePanel === 'sonar' ? 'on' : ''}`}
              aria-expanded={activePanel === 'sonar'}
              onClick={() => showPanel('sonar')}
              aria-label="声呐图"
              title="声呐图"
            >
              {ICON_SONAR}
            </button>
          )}
          <button
            type="button"
            className={`dive-icon-btn ${activePanel === 'loot' ? 'on' : ''}`}
            aria-expanded={activePanel === 'loot'}
            onClick={() => showPanel('loot')}
            aria-label="战利品"
            title="战利品"
          >
            {ICON_LOOT}
          </button>
          <button
            type="button"
            className={`dive-icon-btn ${activePanel === 'equipment' ? 'on' : ''}`}
            aria-expanded={activePanel === 'equipment'}
            onClick={() => showPanel('equipment')}
            aria-label="装备"
            title="装备"
          >
            {ICON_EQUIP}
          </button>
        </div>
      </div>
      {/* 当前展开的面板（pinned·跨子阶段沿用）：移动端 .has-dive-panel 把整块 fixed 全屏覆盖、状态条留顶上。 */}
      {activePanel !== 'none' && (
        <div className="dive-panel">
          <div className="dive-panel-head">
            <span className="dive-panel-head-title">{PANEL_LABEL[activePanel]}</span>
            <button type="button" className="icon-close" onClick={() => showPanel('none')} aria-label="关闭">
              ✕
            </button>
          </div>
          {activePanel === 'sonar' ? (
            <>
              {/* 声呐开/关：放在声呐面板内，关着点开＝本回合立即扫一次（#5）。 */}
              <div className="dive-sonar-controls">
                <button
                  className={`btn sensor-btn sonar-toggle ${standingOn ? 'on' : ''}`}
                  onClick={() => {
                    if (standingOn) {
                      onStateChange(setSonarNext(state, false));
                    } else {
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
              </div>
              <SonarScanPanel
                state={state}
                choices={choices}
                onStateChange={onStateChange}
                pendingNodeId={pendingNodeId}
                onPendingChange={onPendingChange}
              />
            </>
          ) : activePanel === 'loot' ? (
            <LootPanel state={state} />
          ) : (
            <EquipmentDoll state={state} />
          )}
        </div>
      )}
    </div>
  );
}
