import { useState } from 'react';
import type { GameState, NodeChoice } from '@/types';
import { setLight, pingSonar, setSonarNext } from '@/engine/dive';
import { sonarPingCost, sonarStandingOn, sonarStandingNext } from '@/engine/clarity';
import { StatusBar } from './StatusBar';
import { SonarScanPanel } from './SonarScanPanel';
import { LootPanel } from './LootPanel';
import { EquipmentDoll } from './EquipmentDoll';

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
        {/* 传感器开关：灯 + 声呐开/关（声呐只此一个控制·关着点开＝本回合立即扫一次·#5）。 */}
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
        {/* 面板开关（互斥·SPEC §6）：声呐图 / 战利品——点开一个收起另一个；移动端全屏覆盖、桌面内联。 */}
        <div className="dive-panel-bar">
          {sonarUnlocked && (
            <button
              type="button"
              className={`btn small panel-toggle ${activePanel === 'sonar' ? 'on' : ''}`}
              aria-expanded={activePanel === 'sonar'}
              onClick={() => showPanel('sonar')}
            >
              声呐图
            </button>
          )}
          <button
            type="button"
            className={`btn small panel-toggle ${activePanel === 'loot' ? 'on' : ''}`}
            aria-expanded={activePanel === 'loot'}
            onClick={() => showPanel('loot')}
          >
            战利品
          </button>
          <button
            type="button"
            className={`btn small panel-toggle ${activePanel === 'equipment' ? 'on' : ''}`}
            aria-expanded={activePanel === 'equipment'}
            onClick={() => showPanel('equipment')}
          >
            装备
          </button>
        </div>
      </div>
      {/* 当前展开的面板（pinned·跨子阶段沿用）：移动端 .has-dive-panel 把整块 fixed 全屏覆盖、状态条留顶上。 */}
      {activePanel !== 'none' && (
        <div className="dive-panel">
          <div className="dive-panel-head">
            <span>{PANEL_LABEL[activePanel]}</span>
            <button type="button" className="btn small" onClick={() => showPanel('none')} aria-label="关闭">
              关闭 ✕
            </button>
          </div>
          {activePanel === 'sonar' ? (
            <SonarScanPanel
              state={state}
              choices={choices}
              onStateChange={onStateChange}
              pendingNodeId={pendingNodeId}
              onPendingChange={onPendingChange}
            />
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
